/** Inert staged predictor shared by the future collection and wishlist adapters. */
import type { PredictionConfidence, PredictionSettings } from "@shelf-judge/shared";
import { predictAxisRating, type SimilarityMatch } from "./prediction-engine.js";

export interface UnifiedPredictionReference {
  readonly gameId: string;
  readonly gameName: string;
  readonly rating: number;
  /** null means the demanded cache-only pair has no usable similarity. */
  readonly similarity: number | null;
}

export interface UnifiedAxisPrediction {
  readonly axisId: string;
  readonly matches: readonly SimilarityMatch[];
  readonly prediction: ReturnType<typeof predictAxisRating>;
}

/**
 * Use the one staged S table for axis-specific neighbor ranking and estimation.
 * Labels are supplied as actual ratings by the caller; this function never derives
 * a label from another prediction. A valid zero is retained as a value, while an
 * absent similarity is excluded rather than treated as zero.
 */
export function computeUnifiedPrediction(input: {
  readonly axisIds: readonly string[];
  readonly referencesByAxis: ReadonlyMap<string, readonly UnifiedPredictionReference[]>;
  readonly settings: PredictionSettings;
}): ReadonlyMap<string, UnifiedAxisPrediction> {
  const result = new Map<string, UnifiedAxisPrediction>();
  for (const axisId of input.axisIds) {
    const matches = (input.referencesByAxis.get(axisId) ?? [])
      .filter(
        (reference) =>
          Number.isFinite(reference.rating) &&
          reference.rating > 0 &&
          reference.similarity !== null &&
          reference.similarity > 0 &&
          reference.similarity >= input.settings.minSimilarityThreshold,
      )
      .map((reference) => ({
        gameId: reference.gameId,
        gameName: reference.gameName,
        rating: reference.rating,
        similarity: reference.similarity!,
      }))
      .sort(
        (left, right) =>
          right.similarity - left.similarity || left.gameId.localeCompare(right.gameId),
      )
      .slice(0, input.settings.defaultK);
    result.set(
      axisId,
      Object.freeze({
        axisId,
        matches: Object.freeze(matches),
        prediction: predictAxisRating(matches),
      }),
    );
  }
  return result;
}

export function unifiedConfidenceRank(confidence: PredictionConfidence): number {
  switch (confidence) {
    case "insufficient":
      return 0;
    case "weak":
      return 1;
    case "moderate":
      return 2;
    case "strong":
      return 3;
    case "actual":
      return 4;
  }
}
