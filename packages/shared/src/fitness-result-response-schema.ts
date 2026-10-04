import { z } from "zod";
import { DERIVED_AXIS_REGISTRY } from "./derived-axis-registry";
import type { DerivedFieldId } from "./types";

const FiniteNumberSchema = z.number().finite();
const NonNegativeIntegerSchema = z.number().int().safe().min(0);
const DerivedFieldIdSchema = z.custom<DerivedFieldId>(
  (value) => typeof value === "string" && Object.hasOwn(DERIVED_AXIS_REGISTRY, value),
);

export const FitnessResultResponseSchema = z
  .object({
    score: FiniteNumberSchema,
    ratedAxisCount: NonNegativeIntegerSchema,
    totalAxisCount: NonNegativeIntegerSchema,
    breakdown: z.array(
      z
        .object({
          axisId: z.string().min(1),
          axisName: z.string().min(1),
          weight: FiniteNumberSchema,
          contribution: FiniteNumberSchema.nullable(),
          source: z.enum(["personal", "tournament", "derived", "override", "predicted"]),
          derivedField: DerivedFieldIdSchema.nullable(),
          sourceValue: FiniteNumberSchema.nullable(),
          scoringRawValue: FiniteNumberSchema.nullable(),
          playerCountFact: z
            .object({
              source: z.enum(["manual", "bestPlayers", "publisherRange"]),
              minPlayers: z.number().int().safe().positive(),
              maxPlayers: z.number().int().safe().positive(),
            })
            .strict()
            .refine(({ minPlayers, maxPlayers }) => minPlayers <= maxPlayers, {
              message: "Minimum players cannot exceed maximum players",
              path: ["maxPlayers"],
            })
            .optional(),
          effectiveRating: FiniteNumberSchema.nullable(),
          preferenceShape: z.enum(["higher-is-better", "lower-is-better", "sweet-spot"]),
          curveAffected: z.boolean(),
          unit: z.string().nullable(),
          provenance: z.string().nullable(),
          configurationSummary: z.string().nullable(),
          overridden: z.boolean(),
          overrideValue: FiniteNumberSchema.nullable(),
          predictionConfidence: z
            .enum(["actual", "strong", "moderate", "weak", "insufficient"])
            .nullable(),
          referenceGames: z
            .array(
              z
                .object({
                  gameId: z.string().min(1),
                  gameName: z.string().min(1),
                  similarity: FiniteNumberSchema,
                })
                .strict(),
            )
            .nullable(),
        })
        .strict(),
    ),
    vetoed: z.boolean(),
    vetoedBy: z
      .object({
        axisId: z.string().min(1),
        axisName: z.string().min(1),
        threshold: FiniteNumberSchema,
        direction: z.enum(["below", "above"]),
        rawValue: FiniteNumberSchema,
      })
      .strict()
      .nullable(),
    hypotheticalScore: FiniteNumberSchema.nullable(),
    predictionMeta: z
      .object({
        readinessStage: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        confidence: z.enum(["actual", "strong", "moderate", "weak", "insufficient"]),
        predictedAxisCount: NonNegativeIntegerSchema,
        actualAxisCount: NonNegativeIntegerSchema,
        referenceGameCount: NonNegativeIntegerSchema,
        coveragePercent: FiniteNumberSchema,
      })
      .strict()
      .nullable(),
    redundancyAdjustment: z
      .object({
        penalty: FiniteNumberSchema,
        originalScore: FiniteNumberSchema,
        adjustedScore: FiniteNumberSchema,
        nicheNeighbors: z.array(
          z
            .object({
              gameId: z.string().min(1),
              gameName: z.string().min(1),
              similarity: FiniteNumberSchema,
              fitnessScore: FiniteNumberSchema,
              isPredicted: z.boolean(),
            })
            .strict(),
        ),
        nicheRank: NonNegativeIntegerSchema,
        nicheSize: NonNegativeIntegerSchema,
      })
      .strict()
      .nullable(),
    redundancySimilarityInfo: z
      .object({
        status: z.enum(["disabled", "factual", "not-ready", "stale", "partial", "ready"]),
        generationId: z.string().min(1).nullable(),
      })
      .strict()
      .default({ status: "disabled", generationId: null }),
  })
  .strict();
