import {
  DERIVED_AXIS_REGISTRY,
  applyPreferenceCurve,
  getAxisNativeScale,
  isPreferenceCurveApplicable,
  isEnabledScoringAxis,
  resolveDerivedAxisValue,
  summarizeDerivedAxisConfiguration,
  type Axis,
  type FitnessBreakdownEntry,
  type FitnessBreakdownSource,
  type FitnessResult,
  type Game,
  type TournamentData,
} from "@shelf-judge/shared";
import { checkVeto, computeHigherIsBetterEffective } from "./curve-engine";
import { deriveDisplayStats } from "./tournament-service";

const EMPTY_TOURNAMENT: TournamentData = {
  settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
  sessions: [],
  gameStats: {},
};

export interface FitnessService {
  calculateScore(
    game: Game,
    axes: Axis[],
    tournamentData?: TournamentData | null,
  ): FitnessResult | null;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

const CURVE_AFFECTED_THRESHOLD = 0.5;

export function createFitnessService(): FitnessService {
  return {
    calculateScore(game, axes, tournamentData) {
      const scoringAxes = axes.filter(isEnabledScoringAxis);
      const breakdown: FitnessBreakdownEntry[] = [];
      let weightedSum = 0;
      let weightSum = 0;
      let ratedCount = 0;
      let vetoInfo: FitnessResult["vetoedBy"] = null;

      for (const axis of scoringAxes) {
        const shape = axis.preferenceShape ?? "higher-is-better";
        const curveConfig = {
          idealValue: axis.idealValue,
          tolerance: axis.tolerance,
          toleranceWidth: axis.toleranceWidth,
          leanDirection: axis.leanDirection,
        };
        const personalRating = game.ratings[axis.id];
        const resolution = axis.source === "derived" ? resolveDerivedAxisValue(axis, game) : null;
        const nativeScale = getAxisNativeScale(axis);
        let source: FitnessBreakdownSource = axis.source;
        let scoringValue: number | null = null;
        let valueScale = nativeScale;
        let overridden = false;
        let applyConfiguredCurve = true;

        if (axis.source === "tournament") {
          scoringValue = deriveDisplayStats(
            game.id,
            tournamentData ?? EMPTY_TOURNAMENT,
          ).normalizedScore;
        } else if (personalRating !== undefined) {
          scoringValue = personalRating;
          valueScale = { min: 1, max: 10 };
          if (axis.source === "derived") {
            source = "override";
            overridden = true;
            applyConfiguredCurve = isPreferenceCurveApplicable(valueScale, shape, curveConfig);
          }
        } else if (resolution !== null) {
          scoringValue = resolution.scoringRawValue;
        }

        if (scoringValue !== null && vetoInfo === null && !overridden) {
          if (checkVeto(scoringValue, axis.veto ?? null)) {
            vetoInfo = {
              axisId: axis.id,
              axisName: axis.name,
              threshold: axis.veto!.threshold,
              direction: axis.veto!.direction,
              rawValue: scoringValue,
            };
          }
        }

        const effectiveRating =
          scoringValue === null
            ? null
            : overridden && !applyConfiguredCurve
              ? scoringValue
              : applyPreferenceCurve(scoringValue, valueScale, shape, curveConfig);
        const displayedRating =
          effectiveRating === null ? null : roundToOneDecimal(effectiveRating);
        const contribution = effectiveRating === null ? null : effectiveRating * axis.weight;
        const definition =
          axis.source === "derived" ? DERIVED_AXIS_REGISTRY[axis.derivedField] : null;

        breakdown.push({
          axisId: axis.id,
          axisName: axis.name,
          weight: axis.weight,
          contribution: contribution === null ? null : roundToOneDecimal(contribution),
          source,
          derivedField: axis.source === "derived" ? axis.derivedField : null,
          sourceValue:
            resolution !== null
              ? resolution.sourceValue
              : axis.source === "derived" || scoringValue === null
                ? null
                : scoringValue,
          scoringRawValue:
            resolution !== null
              ? resolution.scoringRawValue
              : axis.source === "derived" || scoringValue === null
                ? null
                : scoringValue,
          effectiveRating: displayedRating,
          preferenceShape: shape,
          curveAffected:
            scoringValue !== null &&
            effectiveRating !== null &&
            (!overridden || applyConfiguredCurve)
              ? Math.abs(
                  effectiveRating - computeHigherIsBetterEffective(scoringValue, valueScale),
                ) > CURVE_AFFECTED_THRESHOLD
              : false,
          unit: definition?.unit ?? null,
          provenance: definition?.provenance ?? null,
          configurationSummary:
            axis.source === "derived" ? summarizeDerivedAxisConfiguration(axis) : null,
          overridden,
          predictionConfidence: null,
          referenceGames: null,
        });

        if (contribution !== null) {
          weightedSum += contribution;
          weightSum += axis.weight;
          ratedCount++;
        }
      }

      for (const entry of breakdown) {
        if (entry.contribution !== null && entry.effectiveRating !== null && weightSum > 0) {
          entry.contribution = roundToOneDecimal(
            (entry.effectiveRating * entry.weight) / weightSum,
          );
        }
      }

      const sourceOrder: Record<FitnessBreakdownSource, number> = {
        override: 0,
        derived: 1,
        tournament: 2,
        personal: 3,
        predicted: 4,
      };
      breakdown.sort((a, b) =>
        sourceOrder[a.source] === sourceOrder[b.source]
          ? (b.contribution ?? 0) - (a.contribution ?? 0)
          : sourceOrder[a.source] - sourceOrder[b.source],
      );

      if (ratedCount === 0 || weightSum === 0) return null;

      const hypotheticalScore = roundToOneDecimal(weightedSum / weightSum);
      return {
        score: vetoInfo === null ? hypotheticalScore : 0,
        ratedAxisCount: ratedCount,
        totalAxisCount: scoringAxes.length,
        breakdown,
        vetoed: vetoInfo !== null,
        vetoedBy: vetoInfo,
        hypotheticalScore: vetoInfo === null ? null : hypotheticalScore,
        predictionMeta: null,
        redundancyAdjustment: null,
      };
    },
  };
}
