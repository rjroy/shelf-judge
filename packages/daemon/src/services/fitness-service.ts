import type {
  Game,
  Axis,
  BggGameData,
  FitnessResult,
  FitnessBreakdownEntry,
  FitnessBreakdownSource,
} from "@shelf-judge/shared";
import {
  getNativeScale,
  applyPreferenceCurve,
  checkVeto,
  computeHigherIsBetterEffective,
} from "./curve-engine";

export interface FitnessService {
  calculateScore(game: Game, axes: Axis[], bggData: BggGameData | null): FitnessResult | null;
}

/**
 * Returns the raw native-scale BGG value for an axis.
 * No normalization: weight returns 1-5, communityRating returns 1-10.
 */
function resolveBggRawValue(axis: Axis, bggData: BggGameData | null): number | null {
  if (axis.source !== "bgg" || !axis.bggField || !bggData) return null;

  switch (axis.bggField) {
    case "communityRating":
      return bggData.communityRating;
    case "weight":
      return bggData.weight;
    default:
      return null;
  }
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

// Threshold for curveAffected highlighting (REQ-CURVE-17).
// When the effective rating differs from the higher-is-better baseline by more than
// this amount, the axis is flagged as curve-affected.
const CURVE_AFFECTED_THRESHOLD = 0.5;

export function createFitnessService(): FitnessService {
  return {
    calculateScore(game: Game, axes: Axis[], bggData: BggGameData | null): FitnessResult | null {
      const breakdown: FitnessBreakdownEntry[] = [];
      let weightedSum = 0;
      let weightSum = 0;
      let ratedCount = 0;
      let vetoTriggered = false;
      let vetoInfo: FitnessResult["vetoedBy"] = null;

      for (const axis of axes) {
        const personalRating = game.ratings[axis.id];
        const bggRawValue = resolveBggRawValue(axis, bggData);
        const scale = getNativeScale(axis.source, axis.bggField);
        const shape = axis.preferenceShape ?? "higher-is-better";

        // Determine raw value, source, and the appropriate native scale for curve application.
        // Personal overrides use the personal scale (1-10), not the BGG axis scale.
        let rawValue: number | null = null;
        let source: FitnessBreakdownSource = axis.source === "bgg" ? "bgg" : "personal";
        let bggOriginal: number | null = null;
        let valueScale = scale;

        if (personalRating !== undefined) {
          rawValue = personalRating;
          // Personal ratings are always on the 1-10 scale, even when overriding a BGG axis
          valueScale = getNativeScale("personal", null);
          if (bggRawValue !== null) {
            source = "override";
            bggOriginal = roundToOneDecimal(bggRawValue);
          } else {
            source = "personal";
          }
        } else if (bggRawValue !== null) {
          rawValue = bggRawValue;
          source = "bgg";
        }

        // Check veto on raw value (before curve application).
        // Veto thresholds are in native scale, so use the axis scale for BGG values
        // and personal scale for personal/override values.
        if (rawValue !== null && !vetoTriggered) {
          const vetoed = checkVeto(rawValue, axis.veto ?? null);
          if (vetoed) {
            vetoTriggered = true;
            vetoInfo = {
              axisId: axis.id,
              axisName: axis.name,
              threshold: axis.veto!.threshold,
              direction: axis.veto!.direction,
              rawValue,
            };
          }
        }

        // Apply preference curve to get effective rating (1-10)
        let effectiveRating: number | null = null;
        if (rawValue !== null) {
          effectiveRating = applyPreferenceCurve(rawValue, valueScale, shape, {
            idealValue: axis.idealValue,
            tolerance: axis.tolerance,
            leanDirection: axis.leanDirection,
          });
        }

        // Compute higher-is-better baseline for curveAffected highlighting
        let curveAffected = false;
        if (rawValue !== null && effectiveRating !== null) {
          const baseline = computeHigherIsBetterEffective(rawValue, valueScale);
          curveAffected = Math.abs(effectiveRating - baseline) > CURVE_AFFECTED_THRESHOLD;
        }

        const displayedRating =
          effectiveRating !== null ? roundToOneDecimal(effectiveRating) : null;
        const displayedRawValue = rawValue !== null ? roundToOneDecimal(rawValue) : null;
        const rawContribution = effectiveRating !== null ? effectiveRating * axis.weight : null;

        breakdown.push({
          axisId: axis.id,
          axisName: axis.name,
          rating: displayedRating,
          weight: axis.weight,
          contribution: rawContribution !== null ? roundToOneDecimal(rawContribution) : null,
          source,
          bggOriginal,
          rawValue: displayedRawValue,
          effectiveRating: displayedRating,
          preferenceShape: shape,
          curveAffected,
        });

        if (rawContribution !== null) {
          weightedSum += rawContribution;
          weightSum += axis.weight;
          ratedCount++;
        }
      }

      // Recalculate contribution as weighted contribution to final score
      for (const entry of breakdown) {
        if (entry.contribution !== null && weightSum > 0) {
          entry.contribution = roundToOneDecimal((entry.rating! * entry.weight) / weightSum);
        }
      }

      breakdown.sort((a, b) => {
        const sourceOrder = { override: 0, bgg: 1, personal: 2 };
        if (sourceOrder[a.source] !== sourceOrder[b.source]) {
          return sourceOrder[a.source] - sourceOrder[b.source];
        }
        return (b.contribution || 0) - (a.contribution || 0);
      });

      if (ratedCount === 0) return null;
      if (weightSum === 0) return null;

      const hypotheticalScore = roundToOneDecimal(weightedSum / weightSum);

      if (vetoTriggered) {
        return {
          score: 0,
          ratedAxisCount: ratedCount,
          totalAxisCount: axes.length,
          breakdown,
          vetoed: true,
          vetoedBy: vetoInfo,
          hypotheticalScore,
        };
      }

      return {
        score: hypotheticalScore,
        ratedAxisCount: ratedCount,
        totalAxisCount: axes.length,
        breakdown,
        vetoed: false,
        vetoedBy: null,
        hypotheticalScore: null,
      };
    },
  };
}
