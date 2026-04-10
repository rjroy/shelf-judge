import type {
  Game,
  Axis,
  BggGameData,
  FitnessResult,
  FitnessBreakdownEntry,
  FitnessBreakdownSource,
} from "@shelf-judge/shared";

export interface FitnessService {
  calculateScore(game: Game, axes: Axis[], bggData: BggGameData | null): FitnessResult | null;
}

function resolveBggRating(axis: Axis, bggData: BggGameData | null): number | null {
  if (axis.source !== "bgg" || !axis.bggField || !bggData) return null;

  switch (axis.bggField) {
    case "communityRating":
      return bggData.communityRating;
    case "weight":
      if (bggData.weight === null) return null;
      // BGG weight is 1-5 scale; multiply by 2 to map to 1-10 rating scale
      return bggData.weight * 2;
    default:
      return null;
  }
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function createFitnessService(): FitnessService {
  return {
    calculateScore(game: Game, axes: Axis[], bggData: BggGameData | null): FitnessResult | null {
      const breakdown: FitnessBreakdownEntry[] = [];
      let weightedSum = 0;
      let weightSum = 0;
      let ratedCount = 0;

      for (const axis of axes) {
        const personalRating = game.ratings[axis.id];
        const bggRating = resolveBggRating(axis, bggData);

        let rating: number | null = null;
        let source: FitnessBreakdownSource = axis.source === "bgg" ? "bgg" : "personal";
        let bggOriginal: number | null = null;

        if (personalRating !== undefined) {
          rating = personalRating;
          if (bggRating !== null) {
            // User overrode a BGG-derived axis
            source = "override";
            bggOriginal = roundToOneDecimal(bggRating);
          } else {
            source = "personal";
          }
        } else if (bggRating !== null) {
          rating = bggRating;
          source = "bgg";
        }

        // Display values are rounded; accumulation uses raw values
        const displayedRating = rating !== null ? roundToOneDecimal(rating) : null;
        const rawContribution = rating !== null ? rating * axis.weight : null;

        breakdown.push({
          axisId: axis.id,
          axisName: axis.name,
          rating: displayedRating,
          weight: axis.weight,
          contribution: rawContribution !== null ? roundToOneDecimal(rawContribution) : null,
          source,
          bggOriginal,
          rawValue: displayedRating,
          effectiveRating: displayedRating,
          preferenceShape: "higher-is-better",
          curveAffected: false,
        });

        if (rawContribution !== null) {
          weightedSum += rawContribution;
          weightSum += axis.weight;
          ratedCount++;
        }
      }

      for (const entry of breakdown) {
        if (entry.contribution !== null && weightSum > 0) {
          // Recalculate contribution percentage based on final score to ensure consistency
          entry.contribution = roundToOneDecimal((entry.rating! * entry.weight) / weightSum);
        }
      }

      breakdown.sort((a, b) => {
        // Override entries first, then BGG, then personal; within each group, sort by contribution desc
        const sourceOrder = { override: 0, bgg: 1, personal: 2 };
        if (sourceOrder[a.source] !== sourceOrder[b.source]) {
          return sourceOrder[a.source] - sourceOrder[b.source];
        }
        return (b.contribution || 0) - (a.contribution || 0);
      });

      if (ratedCount === 0) return null;
      if (weightSum === 0) return null;

      const score = roundToOneDecimal(weightedSum / weightSum);

      return {
        score,
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
