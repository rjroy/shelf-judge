import { z } from "zod";
import type {
  FitnessResult,
  PredictionUnavailable,
  RedundancyAdjustment,
  WishlistEntryView,
} from "./types.js";
import { FitnessResultResponseSchema } from "./validation.js";

const finite = z.number().finite();
const confidence = z.enum(["actual", "strong", "moderate", "weak", "insufficient"]);
const neighborSchema = z
  .object({
    gameId: z.string().min(1),
    gameName: z.string().min(1),
    similarity: finite,
    fitnessScore: finite,
    isPredicted: z.boolean(),
  })
  .strict();

export const RedundancyAdjustmentSchemaV2 = z
  .object({
    penalty: finite,
    originalScore: finite,
    adjustedScore: finite,
    nicheNeighbors: z.array(neighborSchema),
    nicheRank: z.number().int().nonnegative(),
    nicheSize: z.number().int().nonnegative(),
  })
  .strict();

const predictionUnavailableSchema = z
  .object({
    reason: z.literal("stage-0"),
    ratedGameCount: z.number().int().nonnegative(),
    gamesNeeded: z.number().int().nonnegative(),
  })
  .strict();

const projectionReasonSchema = z.enum([
  "missing-source",
  "source-unavailable",
  "source-changed",
  "no-scoring-contribution",
]);

export const CurrentPredictionProjectionSchemaV2 = z.discriminatedUnion("availability", [
  z
    .object({
      availability: z.literal("available"),
      source: z.literal("current"),
      result: FitnessResultResponseSchema,
      predictionUnavailable: predictionUnavailableSchema.nullable(),
    })
    .strict(),
  z
    .object({
      availability: z.literal("unavailable"),
      source: z.literal("current"),
      result: z.null(),
      reason: projectionReasonSchema,
      predictionUnavailable: predictionUnavailableSchema.nullable(),
    })
    .strict(),
]);

export const WishlistRedundancyProjectionSchemaV2 = z
  .object({
    source: z.enum(["current", "base-prediction", "unavailable"]),
    adjustment: RedundancyAdjustmentSchemaV2.nullable(),
    orderingScore: finite.nullable(),
  })
  .strict();

const nicheNeighborSchema = neighborSchema.omit({ similarity: true });
const nicheImpactSchema = z
  .object({
    wouldJoin: z.array(
      z
        .object({
          type: z.enum(["mechanic", "category", "family"]),
          name: z.string().min(1),
          currentSize: z.number().int().nonnegative(),
          projectedRank: z.number().int().nonnegative(),
          currentChampion: nicheNeighborSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();

const wishlistEntryViewSchema = z
  .object({
    id: z.string().min(1),
    bggId: z.number().int().positive(),
    name: z.string().min(1),
    yearPublished: finite.nullable(),
    thumbnailUrl: z.string().nullable(),
    predictedScore: finite.nullable(),
    predictionConfidence: confidence.nullable(),
    predictedBreakdown: z
      .array(z.object({ axisName: z.string().min(1), rating: finite, confidence }).strict())
      .nullable(),
    nicheImpact: nicheImpactSchema.nullable(),
    redundancyPreview: RedundancyAdjustmentSchemaV2.nullable(),
    addedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const WishlistEntryReadResultSchemaV2 = z
  .object({
    entry: wishlistEntryViewSchema,
    prediction: CurrentPredictionProjectionSchemaV2,
    redundancy: WishlistRedundancyProjectionSchemaV2,
  })
  .strict();

export type CurrentPredictionProjectionV2 =
  | {
      readonly availability: "available";
      readonly source: "current";
      readonly result: FitnessResult;
      readonly predictionUnavailable: PredictionUnavailable | null;
    }
  | {
      readonly availability: "unavailable";
      readonly source: "current";
      readonly result: null;
      readonly reason:
        | "missing-source"
        | "source-unavailable"
        | "source-changed"
        | "no-scoring-contribution";
      readonly predictionUnavailable: PredictionUnavailable | null;
    };

export type WishlistRedundancyProjectionV2 = {
  readonly source: "current" | "base-prediction" | "unavailable";
  readonly adjustment: RedundancyAdjustment | null;
  readonly orderingScore: number | null;
};

export interface WishlistEntryReadResultV2 {
  readonly entry: WishlistEntryView;
  readonly prediction: CurrentPredictionProjectionV2;
  readonly redundancy: WishlistRedundancyProjectionV2;
}

export function validateCurrentPredictionProjectionV2(
  value: unknown,
): CurrentPredictionProjectionV2 {
  return CurrentPredictionProjectionSchemaV2.parse(value);
}

export function validateWishlistRedundancyProjectionV2(
  value: unknown,
): WishlistRedundancyProjectionV2 {
  return WishlistRedundancyProjectionSchemaV2.parse(value);
}

export function validateWishlistEntryReadResultV2(value: unknown): WishlistEntryReadResultV2 {
  return WishlistEntryReadResultSchemaV2.parse(value);
}
