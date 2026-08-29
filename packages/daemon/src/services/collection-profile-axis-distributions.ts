import type {
  CollectionProfileAxisDistribution,
  EnabledAxis,
  FitnessResult,
} from "@shelf-judge/shared";

/** Compute diagnostic statistics from the same effective axis values used by fitness. */
export function computeCollectionProfileAxisDistributions(
  axes: readonly EnabledAxis[],
  fitnessResults: ReadonlyMap<string, FitnessResult>,
): CollectionProfileAxisDistribution[] {
  return axes.map((axis) => {
    const ratings = [...fitnessResults.values()].flatMap((result) => {
      const rating = result.breakdown.find(({ axisId }) => axisId === axis.id)?.effectiveRating;
      return rating === null || rating === undefined ? [] : [rating];
    });
    if (ratings.length === 0) {
      return {
        axisId: axis.id,
        axisName: axis.name,
        mean: 0,
        median: 0,
        standardDeviation: 0,
        range: { min: 0, max: 0 },
        ratedGameCount: 0,
        histogram: Array<number>(10).fill(0),
      };
    }

    const sorted = ratings.toSorted((left, right) => left - right);
    const mean = sorted.reduce((sum, rating) => sum + rating, 0) / sorted.length;
    const middle = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
        : (sorted[middle] ?? 0);
    const histogram = Array<number>(10).fill(0);
    for (const rating of ratings) {
      const bucket = Math.max(0, Math.min(9, Math.round(rating) - 1));
      histogram[bucket] = (histogram[bucket] ?? 0) + 1;
    }
    return {
      axisId: axis.id,
      axisName: axis.name,
      mean,
      median,
      standardDeviation: Math.sqrt(
        sorted.reduce((sum, rating) => sum + (rating - mean) ** 2, 0) / sorted.length,
      ),
      range: { min: sorted[0] ?? 0, max: sorted.at(-1) ?? 0 },
      ratedGameCount: sorted.length,
      histogram,
    };
  });
}
