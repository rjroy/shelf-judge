import { z } from "zod";
import {
  FitnessResultResponseSchema,
  NichePositionResponseSchema,
  PurchaseUtilizationResultSchema,
} from "./validation";

const Finite = z.number().finite();
const NonNegativeFinite = Finite.nonnegative();
const PositiveFinite = Finite.positive();
const NonNegativeInteger = z.number().int().nonnegative().safe();
const Id = z.string().min(1);
const RedundancySimilarityInfoSchema = z
  .object({
    status: z.enum(["disabled", "factual", "not-ready", "stale", "partial", "ready"]),
    generationId: Id.nullable(),
  })
  .strict()
  .default({ status: "disabled", generationId: null });
const BoxDimensionsSchema = z
  .object({ width: PositiveFinite, height: PositiveFinite, depth: PositiveFinite })
  .strict()
  .nullable();

/** Deliberately small projection for a collection table; never contains owner-note text or BGG histories. */
export const CollectionSnapshotGameSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    bggId: z.number().int().safe().positive().nullable(),
    yearPublished: z.number().int().nullable(),
    imageUrl: z.string().nullable(),
    numPlays: NonNegativeInteger.nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    ratings: z.record(z.string().min(1), Finite.nullable()),
    bggData: z
      .object({
        presence: z.literal("present"),
        communityRating: Finite.min(0).max(10).nullable(),
        weight: NonNegativeFinite.max(5).nullable(),
      })
      .strict()
      .nullable(),
    boxDimensions: BoxDimensionsSchema,
    minPlayers: z.number().int().safe().positive().nullable(),
    maxPlayers: z.number().int().safe().positive().nullable(),
    bestPlayers: PositiveFinite.nullable(),
    playingTime: z.number().int().safe().positive().nullable(),
    ownership: z.enum(["owned", "previously-owned"]),
  })
  .strict()
  .superRefine((game, ctx) => {
    if (game.minPlayers !== null && game.maxPlayers !== null && game.minPlayers > game.maxPlayers) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxPlayers"],
        message: "Maximum players must not be less than minimum players",
      });
    }
  });

export const CollectionSnapshotAxisSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    source: z.enum(["personal", "tournament", "derived", "legacy"]),
    enabled: z.boolean(),
    weight: Finite,
    preferenceShape: z.enum(["higher-is-better", "lower-is-better", "sweet-spot"]).optional(),
    idealValue: Finite.nullable().optional(),
    veto: z
      .object({ direction: z.enum(["below", "above"]), threshold: Finite })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((axis, ctx) => {
    if ((axis.source === "legacy") !== !axis.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enabled"],
        message: "Only legacy axes may be disabled, and legacy axes must be disabled",
      });
    }
  });

const VariantResultSchema = z
  .object({
    score: FitnessResultResponseSchema.nullable(),
    displayScore: z.string().nullable(),
    purchaseUtilization: PurchaseUtilizationResultSchema,
  })
  .strict();

export const CollectionSnapshotGameRowSchema = z
  .object({
    game: CollectionSnapshotGameSchema,
    /** Presence only; private owner-note text is never exposed in a snapshot. */
    ownerNotePresent: z.boolean(),
    ordinary: VariantResultSchema,
    redundancySimilarityInfo: RedundancySimilarityInfoSchema,
    predicted: z.union([
      VariantResultSchema.extend({ availability: z.literal("available") }).strict(),
      z.object({ availability: z.literal("unavailable"), reason: z.string().min(1) }).strict(),
    ]),
    hasTournamentData: z.boolean(),
    tournament: z
      .object({
        eloRating: Finite,
        comparisonCount: NonNegativeInteger,
        normalizedScore: Finite.nullable(),
        displayLabel: z.string(),
        wins: NonNegativeInteger,
        losses: NonNegativeInteger,
      })
      .strict()
      .nullable(),
  })
  .strict();

const AssignedGameSchema = z
  .object({
    gameId: Id,
    gameName: z.string().min(1),
    fitnessScore: Finite,
    volumeIn3: NonNegativeFinite,
    assignmentSource: z.enum(["manual", "automatic"]),
  })
  .strict();
const ShelfAssignmentSchema = z
  .object({
    shelfId: Id,
    shelfName: z.string().min(1),
    unitId: Id,
    unitName: z.string().min(1),
    dimensionless: z.boolean(),
    capacityIn3: NonNegativeFinite.nullable(),
    usedIn3: NonNegativeFinite,
    utilization: NonNegativeFinite.nullable(),
    games: z.array(AssignedGameSchema),
    grade: z.string().min(1),
  })
  .strict();
const CapacityConflictSchema = z
  .object({
    gameId: Id,
    gameName: z.string().min(1),
    shelfId: Id,
    shelfName: z.string().min(1),
    unitId: Id,
    unitName: z.string().min(1),
    boxDimensions: BoxDimensionsSchema,
    reason: z.string(),
  })
  .strict();
const UnfittableSchema = z
  .object({
    gameId: Id,
    gameName: z.string().min(1),
    fitnessScore: Finite,
    boxDimensions: z
      .object({ width: PositiveFinite, height: PositiveFinite, depth: PositiveFinite })
      .strict(),
    reason: z.string(),
  })
  .strict();
const OverflowSchema = z
  .object({
    gameId: Id,
    gameName: z.string().min(1),
    fitnessScore: Finite,
    volumeIn3: NonNegativeFinite,
  })
  .strict();
export const CollectionSnapshotCapacitySchema = z
  .object({
    configured: z.boolean(),
    totalShelfCount: NonNegativeInteger,
    gamesWithDimensions: NonNegativeInteger,
    gamesWithoutDimensions: NonNegativeInteger,
    overflowing: z.boolean(),
    hasPlacementProblems: z.boolean(),
    assignments: z.array(ShelfAssignmentSchema),
    assignmentConflicts: z.array(CapacityConflictSchema),
    unfittableGames: z.array(UnfittableSchema),
    overflowGames: z.array(OverflowSchema),
  })
  .strict();

const UnavailableFeatureSchema = z
  .object({ feature: z.string().min(1), reason: z.string().min(1) })
  .strict();
export const CollectionSnapshotSchema = z
  .object({
    representationVersion: z.literal(1),
    collectionId: Id,
    serverId: Id,
    status: z.enum(["complete", "degraded"]),
    unavailableFeatures: z.array(UnavailableFeatureSchema),
    axes: z.array(CollectionSnapshotAxisSchema),
    ignoredTags: z.array(z.string()),
    redundancyMode: z.enum(["off", "annotation", "integrated"]),
    games: z.array(CollectionSnapshotGameRowSchema),
    nichePositions: z.union([
      z
        .object({
          availability: z.literal("available"),
          positions: z.array(
            z.object({ gameId: Id, position: NichePositionResponseSchema }).strict(),
          ),
        })
        .strict(),
      z.object({ availability: z.literal("unavailable"), reason: z.string().min(1) }).strict(),
    ]),
    capacity: z.union([
      z
        .object({
          availability: z.literal("available"),
          result: CollectionSnapshotCapacitySchema.nullable(),
        })
        .strict(),
      z.object({ availability: z.literal("unavailable"), reason: z.string().min(1) }).strict(),
    ]),
    counts: z
      .object({
        total: NonNegativeInteger,
        rated: NonNegativeInteger,
        predicted: NonNegativeInteger,
        unavailablePredictions: NonNegativeInteger,
      })
      .strict(),
    averageScore: Finite.nullable(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const axisIds = new Set<string>();
    snapshot.axes.forEach((axis, index) => {
      if (axisIds.has(axis.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["axes", index, "id"],
          message: "Duplicate axis id",
        });
      axisIds.add(axis.id);
    });
    const ids = new Set<string>();
    snapshot.games.forEach((row, index) => {
      if (ids.has(row.game.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["games", index, "game", "id"],
          message: "Duplicate game id",
        });
      ids.add(row.game.id);
    });
    if (snapshot.nichePositions.availability === "available") {
      const nicheGameIds = new Set<string>();
      snapshot.nichePositions.positions.forEach((entry, index) => {
        if (nicheGameIds.has(entry.gameId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nichePositions", "positions", index, "gameId"],
            message: "Duplicate niche-position game id",
          });
        nicheGameIds.add(entry.gameId);
        if (!ids.has(entry.gameId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nichePositions", "positions", index, "gameId"],
            message: "Niche position references unknown game",
          });
      });
    }
    const capacity = snapshot.capacity;
    if (capacity.availability === "available" && capacity.result) {
      const refs = [
        ...capacity.result.assignments.flatMap((a) => a.games.map((g) => g.gameId)),
        ...capacity.result.assignmentConflicts.map((x) => x.gameId),
        ...capacity.result.unfittableGames.map((x) => x.gameId),
        ...capacity.result.overflowGames.map((x) => x.gameId),
      ];
      refs.forEach((id) => {
        if (!ids.has(id))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["capacity"],
            message: `Capacity result references unknown game: ${id}`,
          });
      });
    }
    if (snapshot.counts.total !== snapshot.games.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["counts", "total"],
        message: "Total count must match game rows",
      });
    if (snapshot.status === "complete" && snapshot.unavailableFeatures.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unavailableFeatures"],
        message: "Complete snapshots cannot have unavailable features",
      });
    if (snapshot.status === "degraded" && !snapshot.unavailableFeatures.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unavailableFeatures"],
        message: "Degraded snapshots must identify unavailable features",
      });
  });

export type CollectionSnapshotGame = z.infer<typeof CollectionSnapshotGameSchema>;
export type CollectionSnapshotGameRow = z.infer<typeof CollectionSnapshotGameRowSchema>;
export type CollectionSnapshotCapacity = z.infer<typeof CollectionSnapshotCapacitySchema>;
export type CollectionSnapshot = z.infer<typeof CollectionSnapshotSchema>;
