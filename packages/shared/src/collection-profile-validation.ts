import { z } from "zod";
import type {
  CollectionProfileEntityPolicy,
  IntentionCommand,
  IntentionMutationResult,
  JsonValue,
} from "./types";
import { ExactRational } from "./exact-rational";
import {
  CollectionProfileEntityPolicySchema,
  DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
} from "./collection-profile-entity-policy";

const TimestampSchema = z.string().datetime({ offset: true });
const IdSchema = z.string().min(1);
const SafeCountSchema = z.number().int().safe().min(0);
const PositiveSafeIntegerSchema = z.number().int().safe().positive();
const FiniteNumberSchema = z.number().finite();

function valuesMatch(left: number, right: number): boolean {
  return Object.is(left, right);
}

function exactMean(values: number[]): ExactRational {
  return values
    .reduce(
      (sum, value) => sum.add(ExactRational.fromDecimal(value.toString())),
      new ExactRational(0n),
    )
    .divide(new ExactRational(BigInt(values.length)));
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left.normalize("NFC"), (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right.normalize("NFC"), (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    FiniteNumberSchema,
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

const InvalidEvidenceSchema = z.union([
  z.object({ presence: z.literal("missing") }).strict(),
  z
    .object({
      presence: z.literal("present"),
      value: JsonValueSchema,
    })
    .strict(),
]);

export const CollectionProfileEntityClassSchema = z.enum(["mechanic", "designer", "artist"]);
export const BggEntityLinkSchema = z
  .object({ id: PositiveSafeIntegerSchema, name: z.string().trim().min(1) })
  .strict();

const EntityMetadataRefreshFailureSchema = z
  .object({ attemptedAt: TimestampSchema, message: z.string().min(1) })
  .strict();

export const EntityClassMetadataSchema = z
  .union([
    z
      .object({
        state: z.literal("complete"),
        entities: z.array(BggEntityLinkSchema),
        observedAt: TimestampSchema,
        refreshFailure: EntityMetadataRefreshFailureSchema.nullable(),
        correctionDestination: z.null(),
      })
      .strict(),
    z
      .object({
        state: z.literal("refresh-needed"),
        entities: z.tuple([]),
        observedAt: z.null(),
        refreshFailure: EntityMetadataRefreshFailureSchema.nullable(),
        correctionDestination: z
          .object({ operationId: z.literal("shelf.game.bgg.refresh") })
          .strict(),
      })
      .strict(),
    z
      .object({
        state: z.literal("unrefreshable"),
        entities: z.tuple([]),
        observedAt: z.null(),
        refreshFailure: z.null(),
        correctionDestination: z.null(),
        explanation: z.literal(
          "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
        ),
      })
      .strict(),
  ])
  .superRefine((metadata, context) => {
    const ids = metadata.entities.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entities"],
        message: "Entity IDs must be unique within a game and class",
      });
    }
    if (
      metadata.state === "complete" &&
      metadata.refreshFailure !== null &&
      Date.parse(metadata.refreshFailure.attemptedAt) < Date.parse(metadata.observedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["refreshFailure", "attemptedAt"],
        message: "Refresh failure cannot precede the last complete observation",
      });
    }
  });

export const EntityMetadataByClassSchema = z
  .object({
    mechanic: EntityClassMetadataSchema,
    designer: EntityClassMetadataSchema,
    artist: EntityClassMetadataSchema,
  })
  .strict();

export const LatestPlayCountCheckSchema = z
  .union([
    z
      .object({ status: z.literal("valid"), value: SafeCountSchema, observedAt: TimestampSchema })
      .strict(),
    z.object({ status: z.literal("missing"), observedAt: TimestampSchema }).strict(),
    z
      .object({
        status: z.literal("invalid"),
        observedAt: TimestampSchema,
        evidence: InvalidEvidenceSchema,
      })
      .strict(),
  ])
  .nullable();

const FieldObservationSourceSchema = z.enum([
  "manual",
  "bgg-collection",
  "bgg-plays",
  "bgg-thing",
  "bgg-suggested-player-poll",
  "bgg-player-range",
  "current-fitness",
  "legacy-unknown",
]);

export const PlayIntentionBaselineSchema = z
  .object({
    playCount: SafeCountSchema,
    evidenceSource: FieldObservationSourceSchema,
    observedAt: TimestampSchema,
  })
  .strict();

export const PlayIntentionResolutionSchema = z.union([
  z
    .object({
      outcome: z.literal("completed"),
      source: z.enum(["observed-play-increase", "owner-confirmed"]),
      resolvedAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("retired"),
      source: z.literal("owner-retired"),
      resolvedAt: TimestampSchema,
    })
    .strict(),
]);

export const PlayIntentionSchema = z
  .object({
    intentionId: IdSchema,
    gameId: IdSchema,
    kind: z.enum(["first-play", "replay"]),
    baseline: PlayIntentionBaselineSchema,
    createdAt: TimestampSchema,
    version: PositiveSafeIntegerSchema,
    resolution: PlayIntentionResolutionSchema.nullable(),
  })
  .strict()
  .superRefine((intention, context) => {
    const compatible =
      intention.kind === "first-play"
        ? intention.baseline.playCount === 0
        : intention.baseline.playCount > 0;
    if (!compatible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseline", "playCount"],
        message: "Intention kind must match its play-count baseline",
      });
    }
    if (
      intention.resolution !== null &&
      Date.parse(intention.resolution.resolvedAt) < Date.parse(intention.createdAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolution", "resolvedAt"],
        message: "Resolution cannot precede intention creation",
      });
    }
    if (Date.parse(intention.baseline.observedAt) > Date.parse(intention.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseline", "observedAt"],
        message: "Intention baseline observation cannot follow creation",
      });
    }
    const expectedVersion = intention.resolution === null ? 1 : 2;
    if (intention.version !== expectedVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["version"],
        message: `Intention version must be ${expectedVersion} for its lifecycle state`,
      });
    }
  });

const CreateIntentionCommandSchema = z
  .object({
    type: z.literal("create"),
    commandId: z.string().uuid(),
    gameId: IdSchema,
    kind: z.enum(["first-play", "replay"]),
    expectedActiveIntention: z.literal("absent"),
  })
  .strict();

const ResolveIntentionCommandSchema = z
  .object({
    type: z.enum(["complete", "retire"]),
    commandId: z.string().uuid(),
    gameId: IdSchema,
    intentionId: IdSchema,
    expectedVersion: PositiveSafeIntegerSchema,
  })
  .strict();

export const IntentionCommandSchema = z.union([
  CreateIntentionCommandSchema,
  ResolveIntentionCommandSchema,
]);

const LinkedOwnershipTransitionSchema = z
  .object({ gameId: IdSchema, from: z.literal("owned"), to: z.literal("previously-owned") })
  .strict();

export const AcceptedIntentionMutationSchema = z
  .object({
    ok: z.literal(true),
    commandId: z.string().uuid(),
    intention: PlayIntentionSchema,
    linkedOwnershipTransition: LinkedOwnershipTransitionSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.linkedOwnershipTransition?.gameId !== undefined &&
      result.linkedOwnershipTransition.gameId !== result.intention.gameId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["linkedOwnershipTransition", "gameId"],
        message: "Linked ownership transition must identify the intention game",
      });
    }
  });

const ActiveIntentionConflictSchema = z
  .object({
    code: z.literal("active-intention-conflict"),
    gameId: IdSchema,
    current: PlayIntentionSchema,
  })
  .strict()
  .superRefine((error, context) => {
    if (error.current.gameId !== error.gameId || error.current.resolution !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["current"],
        message: "Active conflict current state must be active and match the game",
      });
    }
  });

const StaleVersionConflictSchema = z
  .object({
    code: z.literal("stale-version"),
    gameId: IdSchema,
    intentionId: IdSchema,
    expectedVersion: PositiveSafeIntegerSchema,
    current: PlayIntentionSchema,
  })
  .strict()
  .superRefine((error, context) => {
    if (
      error.current.gameId !== error.gameId ||
      error.current.intentionId !== error.intentionId ||
      (error.current.version === error.expectedVersion && error.current.resolution === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["current"],
        message:
          "Stale conflict current state must match the requested identities and differ in version or resolved state",
      });
    }
  });

export const IntentionMutationErrorSchema = z.union([
  z
    .object({
      code: z.literal("validation"),
      issues: z
        .array(z.object({ field: z.string().min(1), message: z.string().min(1) }).strict())
        .nonempty(),
    })
    .strict(),
  z.object({ code: z.literal("game-not-found"), gameId: IdSchema }).strict(),
  z
    .object({ code: z.literal("intention-not-found"), gameId: IdSchema, intentionId: IdSchema })
    .strict(),
  z
    .object({
      code: z.literal("ineligible-game"),
      gameId: IdSchema,
      reason: z.enum([
        "not-owned",
        "missing-play-evidence",
        "invalid-play-evidence",
        "missing-observation-time",
        "stale-play-evidence",
        "kind-mismatch",
      ]),
    })
    .strict(),
  ActiveIntentionConflictSchema,
  StaleVersionConflictSchema,
  z.object({ code: z.literal("command-reuse"), commandId: z.string().uuid() }).strict(),
  z
    .object({
      code: z.literal("history-conflict"),
      gameId: IdSchema,
      intentionIds: z.array(IdSchema).nonempty(),
    })
    .strict(),
  z
    .object({
      code: z.literal("persistence-failure"),
      operation: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
]);

export const IntentionMutationResultSchema = z
  .union([
    AcceptedIntentionMutationSchema,
    z
      .object({
        ok: z.literal(false),
        commandId: z.string().uuid(),
        error: IntentionMutationErrorSchema,
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (
      !result.ok &&
      result.error.code === "command-reuse" &&
      result.commandId !== result.error.commandId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["error", "commandId"],
        message: "Command-reuse error must identify the attempted command",
      });
    }
  });

export function intentionMutationResultMatchesCommand(
  command: IntentionCommand,
  result: IntentionMutationResult,
): boolean {
  if (result.commandId !== command.commandId) return false;
  if (result.ok) {
    if (result.intention.gameId !== command.gameId || result.linkedOwnershipTransition !== null) {
      return false;
    }
    if (command.type === "create") {
      return (
        result.intention.kind === command.kind &&
        result.intention.version === 1 &&
        result.intention.resolution === null
      );
    }
    if (
      result.intention.intentionId !== command.intentionId ||
      result.intention.version !== command.expectedVersion + 1
    ) {
      return false;
    }
    return command.type === "complete"
      ? result.intention.resolution?.outcome === "completed" &&
          result.intention.resolution.source === "owner-confirmed"
      : result.intention.resolution?.outcome === "retired" &&
          result.intention.resolution.source === "owner-retired";
  }

  switch (result.error.code) {
    case "validation":
    case "persistence-failure":
      return true;
    case "command-reuse":
      return result.error.commandId === command.commandId;
    case "game-not-found":
      return result.error.gameId === command.gameId;
    case "ineligible-game":
      return command.type === "create" && result.error.gameId === command.gameId;
    case "active-intention-conflict":
      return command.type === "create" && result.error.gameId === command.gameId;
    case "intention-not-found":
      return (
        command.type !== "create" &&
        result.error.gameId === command.gameId &&
        result.error.intentionId === command.intentionId
      );
    case "stale-version":
      return (
        command.type !== "create" &&
        result.error.gameId === command.gameId &&
        result.error.intentionId === command.intentionId &&
        result.error.expectedVersion === command.expectedVersion
      );
    case "history-conflict":
      return false;
  }
}

export const IntentionCommandReceiptSchema = z
  .object({
    commandId: z.string().uuid(),
    request: IntentionCommandSchema,
    result: AcceptedIntentionMutationSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.commandId !== receipt.request.commandId ||
      receipt.commandId !== receipt.result.commandId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commandId"],
        message: "Receipt command IDs must match",
      });
    }
    if (receipt.request.gameId !== receipt.result.intention.gameId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "intention", "gameId"],
        message: "Receipt result must identify the requested game",
      });
    }
    if (
      receipt.request.type === "create" &&
      receipt.request.kind !== receipt.result.intention.kind
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "intention", "kind"],
        message: "Create receipt result must preserve the requested kind",
      });
    }
    if (
      receipt.request.type === "create" &&
      (receipt.result.intention.resolution !== null || receipt.result.intention.version !== 1)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "intention"],
        message: "Create command must produce a new active version-one intention",
      });
    }
    if (
      receipt.request.type !== "create" &&
      (receipt.request.intentionId !== receipt.result.intention.intentionId ||
        receipt.result.intention.version !== receipt.request.expectedVersion + 1)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "intention"],
        message: "Resolution receipt must preserve identity and advance the expected version once",
      });
    }
    if (
      receipt.request.type === "complete" &&
      (receipt.result.intention.resolution?.outcome !== "completed" ||
        receipt.result.intention.resolution.source !== "owner-confirmed")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "intention", "resolution"],
        message: "Complete command must produce an owner-confirmed completion",
      });
    }
    if (
      receipt.request.type === "retire" &&
      receipt.result.intention.resolution?.outcome !== "retired"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "intention", "resolution"],
        message: "Retire command must produce a retired intention",
      });
    }
    if (receipt.result.linkedOwnershipTransition !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "linkedOwnershipTransition"],
        message: "Intention commands cannot imply an ownership transition",
      });
    }
  });

export const CollectionProfileGameSourceExtensionSchema = z
  .object({
    gameId: IdSchema,
    entityMetadata: EntityMetadataByClassSchema,
    latestPlayCountCheck: LatestPlayCountCheckSchema,
  })
  .strict();

export const CollectionProfileSourceRecordsSchema = z
  .object({
    revision: SafeCountSchema,
    games: z.array(CollectionProfileGameSourceExtensionSchema),
    intentions: z.array(PlayIntentionSchema),
    commandReceipts: z.array(IntentionCommandReceiptSchema),
  })
  .strict()
  .superRefine((source, context) => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    if (!unique(source.games.map(({ gameId }) => gameId)))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["games"],
        message: "Future source game IDs must be unique",
      });
    if (!unique(source.intentions.map(({ intentionId }) => intentionId)))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intentions"],
        message: "Intention IDs must be unique",
      });
    if (!unique(source.commandReceipts.map(({ commandId }) => commandId)))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commandReceipts"],
        message: "Command receipt IDs must be unique",
      });
    const activeGameIds = source.intentions
      .filter(({ resolution }) => resolution === null)
      .map(({ gameId }) => gameId);
    if (!unique(activeGameIds))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intentions"],
        message: "A game may have at most one active intention",
      });
    const gameIds = new Set(source.games.map(({ gameId }) => gameId));
    if (source.intentions.some(({ gameId }) => !gameIds.has(gameId)))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intentions"],
        message: "Every intention must reference a source game",
      });
    if (source.commandReceipts.some(({ request }) => !gameIds.has(request.gameId)))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commandReceipts"],
        message: "Every command receipt must reference a source game",
      });
    const intentionIds = new Set(source.intentions.map(({ intentionId }) => intentionId));
    if (
      source.commandReceipts.some(({ result }) => !intentionIds.has(result.intention.intentionId))
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commandReceipts"],
        message: "Every accepted command receipt must reference a durable intention",
      });
    const intentionsById = new Map(
      source.intentions.map((intention) => [intention.intentionId, intention]),
    );
    for (const [receiptIndex, receipt] of source.commandReceipts.entries()) {
      const durable = intentionsById.get(receipt.result.intention.intentionId);
      if (durable === undefined) continue;
      const accepted = receipt.result.intention;
      const immutableMatches =
        durable.gameId === accepted.gameId &&
        durable.kind === accepted.kind &&
        durable.createdAt === accepted.createdAt &&
        durable.baseline.playCount === accepted.baseline.playCount &&
        durable.baseline.evidenceSource === accepted.baseline.evidenceSource &&
        durable.baseline.observedAt === accepted.baseline.observedAt;
      const resolutionMatches =
        accepted.version < durable.version ||
        JSON.stringify(accepted.resolution) === JSON.stringify(durable.resolution);
      if (!immutableMatches || !resolutionMatches || accepted.version > durable.version) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["commandReceipts", receiptIndex, "result", "intention"],
          message: "Command receipt must describe an accepted state of its durable intention",
        });
      }
    }
  });

const CollectionProfileGameFitnessEvidenceSchema = z
  .object({
    gameId: IdSchema,
    gameName: z.string().min(1),
    currentFitness: FiniteNumberSchema.min(0).max(10),
    vetoed: z.boolean(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.vetoed && evidence.currentFitness !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentFitness"],
        message: "Vetoed game evidence must use displayed fitness zero",
      });
    }
  });
const CollectionProfileClassExclusionSchema = z
  .object({
    gameId: IdSchema,
    gameName: z.string().min(1),
    reason: z.enum([
      "predicted-fitness",
      "missing-or-invalid-fitness",
      "refresh-needed-metadata",
      "unrefreshable-metadata",
    ]),
    hasEntityAssociation: z.boolean(),
    correctionDestination: z
      .object({ operationId: z.enum(["shelf.game.bgg.refresh", "shelf.game.rating.set"]) })
      .strict()
      .nullable(),
  })
  .strict();

const CollectionProfileMetadataReadinessSchema = z
  .object({
    state: z.enum(["complete", "partial", "refresh-needed"]),
    ownedGameCount: SafeCountSchema,
    completeGameCount: SafeCountSchema,
    refreshNeededGameCount: SafeCountSchema,
    unrefreshableGameCount: SafeCountSchema,
  })
  .strict()
  .superRefine((readiness, context) => {
    if (
      readiness.completeGameCount +
        readiness.refreshNeededGameCount +
        readiness.unrefreshableGameCount !==
      readiness.ownedGameCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownedGameCount"],
        message: "Metadata readiness counts must equal owned games",
      });
    }
    const expected =
      readiness.completeGameCount === readiness.ownedGameCount
        ? "complete"
        : readiness.completeGameCount === 0
          ? "refresh-needed"
          : "partial";
    if (readiness.state !== expected)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: `Metadata readiness state must be ${expected}`,
      });
  });

const CollectionProfileEntityEvidenceSchema = z
  .object({
    entityId: PositiveSafeIntegerSchema,
    name: z.string().min(1),
    support: z.enum(["limited", "supported"]),
    associatedGameCount: PositiveSafeIntegerSchema,
    meanCurrentFitness: FiniteNumberSchema,
    adjustedMeanCurrentFitness: FiniteNumberSchema,
    populationStandardDeviation: FiniteNumberSchema.min(0),
    range: z.object({ min: FiniteNumberSchema, max: FiniteNumberSchema }).strict(),
    comparatorMeanCurrentFitness: FiniteNumberSchema,
    differenceFromComparator: FiniteNumberSchema,
    games: z.array(CollectionProfileGameFitnessEvidenceSchema).nonempty(),
  })
  .strict()
  .superRefine((entity, context) => {
    const values = entity.games.map(({ currentFitness }) => currentFitness);
    const ids = entity.games.map(({ gameId }) => gameId);
    const mean = exactMean(values).toNumber();
    const deviation = Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
    );
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (new Set(ids).size !== ids.length)
      issue(["games"], "Entity game contributions must be unique");
    if (entity.associatedGameCount !== values.length)
      issue(["associatedGameCount"], "Entity count must match game evidence");
    if (!valuesMatch(entity.meanCurrentFitness, mean))
      issue(["meanCurrentFitness"], "Entity mean must match game evidence");
    if (!valuesMatch(entity.populationStandardDeviation, deviation))
      issue(["populationStandardDeviation"], "Entity deviation must match game evidence");
    if (
      !valuesMatch(entity.range.min, Math.min(...values)) ||
      !valuesMatch(entity.range.max, Math.max(...values))
    )
      issue(["range"], "Entity range must match game evidence");
    if (
      !valuesMatch(
        entity.differenceFromComparator,
        entity.meanCurrentFitness - entity.comparatorMeanCurrentFitness,
      )
    )
      issue(["differenceFromComparator"], "Entity difference must match its means");
  });

function expectedEntityOrders(
  entities: Array<z.infer<typeof CollectionProfileEntityEvidenceSchema>>,
  adjustedMeans: ReadonlyMap<number, ExactRational>,
) {
  const evidenceMean = (entity: (typeof entities)[number]) =>
    exactMean(entity.games.map(({ currentFitness }) => currentFitness));
  const adjustedMean = (entity: (typeof entities)[number]) =>
    adjustedMeans.get(entity.entityId) ?? new ExactRational(0n);
  const bestFit = [...entities].sort(
    (left, right) =>
      adjustedMean(right).compare(adjustedMean(left)) ||
      right.associatedGameCount - left.associatedGameCount ||
      compareCodePoints(left.name, right.name) ||
      left.entityId - right.entityId,
  );
  const support = [...entities].sort(
    (left, right) =>
      right.associatedGameCount - left.associatedGameCount ||
      evidenceMean(right).compare(evidenceMean(left)) ||
      compareCodePoints(left.name, right.name) ||
      left.entityId - right.entityId,
  );
  const name = [...entities].sort(
    (left, right) => compareCodePoints(left.name, right.name) || left.entityId - right.entityId,
  );
  return {
    bestFit: bestFit.map(({ entityId }) => entityId),
    support: support.map(({ entityId }) => entityId),
    name: name.map(({ entityId }) => entityId),
  };
}

export function createCollectionProfileEntityClassResultSchema(
  policy: CollectionProfileEntityPolicy,
) {
  return z
    .object({
      entityClass: CollectionProfileEntityClassSchema,
      result: z.enum([
        "supported",
        "limited",
        "no-eligible-ratings",
        "evaluated-empty",
        "not-evaluated",
      ]),
      metadataReadiness: CollectionProfileMetadataReadinessSchema,
      associatedGameCount: SafeCountSchema,
      comparator: z
        .object({
          gameCount: SafeCountSchema,
          meanCurrentFitness: FiniteNumberSchema.nullable(),
          games: z.array(CollectionProfileGameFitnessEvidenceSchema),
        })
        .strict(),
      exclusions: z.array(CollectionProfileClassExclusionSchema),
      refreshWarnings: z.array(
        z
          .object({
            gameId: IdSchema,
            gameName: z.string().min(1),
            attemptedAt: TimestampSchema,
            message: z.string().min(1),
          })
          .strict(),
      ),
      entities: z.array(CollectionProfileEntityEvidenceSchema),
      overviewEntityIds: z.array(PositiveSafeIntegerSchema),
      orderings: z
        .object({
          bestFit: z.array(PositiveSafeIntegerSchema),
          support: z.array(PositiveSafeIntegerSchema),
          name: z.array(PositiveSafeIntegerSchema),
        })
        .strict(),
    })
    .strict()
    .superRefine((result, context) => {
      const classPolicy = policy[result.entityClass];
      const issue = (path: (string | number)[], message: string) =>
        context.addIssue({ code: z.ZodIssueCode.custom, path, message });
      const entityIds = result.entities.map(({ entityId }) => entityId);
      const comparatorIds = result.comparator.games.map(({ gameId }) => gameId);
      const exclusionIds = result.exclusions.map(({ gameId }) => gameId);
      if (new Set(entityIds).size !== entityIds.length)
        issue(["entities"], "Entity identities must be unique");
      if (new Set(comparatorIds).size !== comparatorIds.length)
        issue(["comparator", "games"], "Comparator games must be unique");
      const sortedComparatorIds = [...comparatorIds].sort(compareCodePoints);
      if (comparatorIds.join(",") !== sortedComparatorIds.join(","))
        issue(["comparator", "games"], "Comparator games must be ordered by stable game ID");
      if (new Set(exclusionIds).size !== exclusionIds.length)
        issue(["exclusions"], "Each excluded game must have exactly one reason");
      if (exclusionIds.some((gameId) => new Set(comparatorIds).has(gameId)))
        issue(["exclusions"], "A game cannot be both included and excluded");
      if (
        result.comparator.games.length + result.exclusions.length !==
        result.metadataReadiness.ownedGameCount
      )
        issue(
          ["metadataReadiness", "ownedGameCount"],
          "Every owned game must occur once in the comparator or exclusions",
        );
      if (
        result.exclusions.filter(({ reason }) => reason === "refresh-needed-metadata").length !==
        result.metadataReadiness.refreshNeededGameCount
      )
        issue(
          ["metadataReadiness", "refreshNeededGameCount"],
          "Refresh-needed count must match exclusions",
        );
      if (
        result.exclusions.filter(({ reason }) => reason === "unrefreshable-metadata").length !==
        result.metadataReadiness.unrefreshableGameCount
      )
        issue(
          ["metadataReadiness", "unrefreshableGameCount"],
          "Unrefreshable count must match exclusions",
        );
      for (const [index, exclusion] of result.exclusions.entries()) {
        const expectedOperation =
          exclusion.reason === "refresh-needed-metadata"
            ? "shelf.game.bgg.refresh"
            : exclusion.reason === "missing-or-invalid-fitness"
              ? "shelf.game.rating.set"
              : null;
        if (
          exclusion.correctionDestination?.operationId !== expectedOperation &&
          !(expectedOperation === null && exclusion.correctionDestination === null)
        )
          issue(
            ["exclusions", index, "correctionDestination"],
            "Exclusion correction destination must match its reason",
          );
      }
      if (result.comparator.gameCount !== result.comparator.games.length)
        issue(["comparator", "gameCount"], "Comparator count must match evidence");
      const exactComparatorMean =
        result.comparator.games.length === 0
          ? null
          : exactMean(result.comparator.games.map(({ currentFitness }) => currentFitness));
      const comparatorMean = exactComparatorMean?.toNumber() ?? null;
      if (
        (comparatorMean === null) !== (result.comparator.meanCurrentFitness === null) ||
        (comparatorMean !== null &&
          result.comparator.meanCurrentFitness !== null &&
          !valuesMatch(comparatorMean, result.comparator.meanCurrentFitness))
      )
        issue(["comparator", "meanCurrentFitness"], "Comparator mean must match evidence");
      const adjustedMeans = new Map<number, ExactRational>();
      for (const [index, entity] of result.entities.entries()) {
        const expectedSupport =
          entity.games.length >= classPolicy.minimumSupportedGames ? "supported" : "limited";
        if (entity.support !== expectedSupport)
          issue(["entities", index, "support"], `Entity support must be ${expectedSupport}`);
        if (
          result.comparator.meanCurrentFitness === null ||
          !valuesMatch(entity.comparatorMeanCurrentFitness, result.comparator.meanCurrentFitness)
        )
          issue(
            ["entities", index, "comparatorMeanCurrentFitness"],
            "Entity comparator must match its class cohort",
          );
        if (entity.games.some(({ gameId }) => !new Set(comparatorIds).has(gameId)))
          issue(
            ["entities", index, "games"],
            "Entity games must belong to the class comparator cohort",
          );
        const comparatorById = new Map(result.comparator.games.map((game) => [game.gameId, game]));
        if (
          entity.games.some((game) => {
            const comparator = comparatorById.get(game.gameId);
            return (
              comparator === undefined ||
              comparator.gameName !== game.gameName ||
              comparator.currentFitness !== game.currentFitness ||
              comparator.vetoed !== game.vetoed
            );
          })
        )
          issue(
            ["entities", index, "games"],
            "Entity game evidence must exactly match the class comparator evidence",
          );
        const entityGameIds = entity.games.map(({ gameId }) => gameId);
        if (entityGameIds.join(",") !== [...entityGameIds].sort(compareCodePoints).join(","))
          issue(["entities", index, "games"], "Entity games must be ordered by stable game ID");
        if (exactComparatorMean === null) {
          issue(["entities", index], "Entity evidence requires a non-empty class comparator");
        } else {
          const entityCount = new ExactRational(BigInt(entity.games.length));
          const priorWeight = new ExactRational(BigInt(classPolicy.minimumSupportedGames));
          const adjustedMean = exactMean(entity.games.map(({ currentFitness }) => currentFitness))
            .multiply(entityCount)
            .add(exactComparatorMean.multiply(priorWeight))
            .divide(entityCount.add(priorWeight));
          adjustedMeans.set(entity.entityId, adjustedMean);
          if (!valuesMatch(entity.adjustedMeanCurrentFitness, adjustedMean.toNumber()))
            issue(
              ["entities", index, "adjustedMeanCurrentFitness"],
              "Entity adjusted mean must match its evidence, comparator, and class policy",
            );
        }
      }
      const associatedIds = new Set(
        result.entities.flatMap(({ games }) => games.map(({ gameId }) => gameId)),
      );
      for (const exclusion of result.exclusions)
        if (exclusion.hasEntityAssociation) associatedIds.add(exclusion.gameId);
      if (result.associatedGameCount !== associatedIds.size)
        issue(["associatedGameCount"], "Associated game count must match evidence and exclusions");
      const expectedResult = result.entities.some(({ support }) => support === "supported")
        ? "supported"
        : result.entities.length > 0
          ? "limited"
          : result.associatedGameCount > 0
            ? "no-eligible-ratings"
            : result.metadataReadiness.completeGameCount > 0
              ? "evaluated-empty"
              : "not-evaluated";
      if (result.result !== expectedResult)
        issue(["result"], `Class result must be ${expectedResult}`);
      const orders = expectedEntityOrders(result.entities, adjustedMeans);
      for (const ordering of ["bestFit", "support", "name"] as const)
        if (result.orderings[ordering].join(",") !== orders[ordering].join(","))
          issue(
            ["orderings", ordering],
            `${ordering} ordering must contain every entity in deterministic order`,
          );
      const expectedOverview = orders.bestFit
        .filter(
          (id) => result.entities.find((entity) => entity.entityId === id)?.support === "supported",
        )
        .slice(0, classPolicy.overviewLimit);
      if (result.overviewEntityIds.join(",") !== expectedOverview.join(","))
        issue(
          ["overviewEntityIds"],
          `Overview must contain the first ${classPolicy.overviewLimit} supported best-fit entities`,
        );
    });
}

export const CollectionProfileEntityClassResultSchema =
  createCollectionProfileEntityClassResultSchema(DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY);

const AttentionPlayEvidenceSchema = z.union([
  z
    .object({
      status: z.literal("valid"),
      playCount: SafeCountSchema,
      source: FieldObservationSourceSchema,
      observedAt: TimestampSchema,
      stale: z.literal(false),
    })
    .strict(),
  z
    .object({
      status: z.enum(["missing", "invalid", "stale"]),
      playCount: SafeCountSchema.nullable(),
      source: FieldObservationSourceSchema.nullable(),
      observedAt: TimestampSchema.nullable(),
      warning: z.enum([
        "Current play evidence is missing.",
        "Current play evidence is invalid.",
        "A newer BGG check did not provide a valid play count.",
      ]),
    })
    .strict(),
]);

export const CollectionProfileAttentionItemSchema = z
  .object({
    id: IdSchema,
    decisionFamily: z.literal("play-intention"),
    intention: PlayIntentionSchema,
    gameName: z.string().min(1),
    question: z.string().min(1),
    whyNow: z.literal("You asked Shelf Judge to keep this intention visible."),
    currentPlayEvidence: AttentionPlayEvidenceSchema,
    responses: z.tuple([
      z.literal("leave-visible"),
      z.literal("complete"),
      z.literal("retire"),
      z.literal("correct-or-refresh-evidence"),
    ]),
    abstentionBasis: z.literal("Only an explicit active intention qualifies."),
    resolution: z.null(),
    reopenCondition: z.literal("Create a new explicit intention after resolution."),
    destination: z
      .object({ gameId: IdSchema, operationId: z.literal("shelf.game.intention.manage") })
      .strict(),
    evidenceDestination: z
      .object({
        gameId: IdSchema,
        operationId: z.enum(["shelf.game.plays.set", "shelf.game.bgg.refresh"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((item, context) => {
    const expectedQuestion =
      item.intention.kind === "first-play"
        ? `Do you still intend to play ${item.gameName}?`
        : `Do you still intend to replay ${item.gameName}?`;
    if (item.intention.resolution !== null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intention", "resolution"],
        message: "Attention requires an active intention",
      });
    if (item.id !== `attention:${item.intention.intentionId}`)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Attention ID must derive from the intention ID",
      });
    if (item.question !== expectedQuestion)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["question"],
        message: "Attention question must match the game and intention kind",
      });
    if (
      item.destination.gameId !== item.intention.gameId ||
      item.evidenceDestination.gameId !== item.intention.gameId
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destination"],
        message: "Attention destinations must identify the intention game",
      });
    if (
      item.currentPlayEvidence.status === "valid" &&
      item.evidenceDestination.operationId !== "shelf.game.plays.set"
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceDestination"],
        message: "Valid play evidence must retain the manual correction destination",
      });
    if (
      item.currentPlayEvidence.status === "valid" &&
      item.currentPlayEvidence.playCount > item.intention.baseline.playCount
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentPlayEvidence", "playCount"],
        message: "A current play increase must already have completed the intention",
      });
  });

export const ResolvedPlayIntentionHistoryItemSchema = z
  .object({
    intentionId: IdSchema,
    gameId: IdSchema,
    gameName: z.string().min(1),
    kind: z.enum(["first-play", "replay"]),
    baseline: PlayIntentionBaselineSchema,
    createdAt: TimestampSchema,
    version: PositiveSafeIntegerSchema,
    resolution: PlayIntentionResolutionSchema,
  })
  .strict()
  .superRefine((item, context) => {
    const intention = PlayIntentionSchema.safeParse({
      intentionId: item.intentionId,
      gameId: item.gameId,
      kind: item.kind,
      baseline: item.baseline,
      createdAt: item.createdAt,
      version: item.version,
      resolution: item.resolution,
    });
    if (!intention.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseline"],
        message: "Resolved history must satisfy the intention lifecycle",
      });
    }
  });

export const ResolvedPlayIntentionHistorySchema = z
  .array(ResolvedPlayIntentionHistoryItemSchema)
  .superRefine((history, context) => {
    const ids = history.map(({ intentionId }) => intentionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resolved history intention IDs must be unique",
      });
    }
    const sorted = [...history].sort(
      (left, right) =>
        Date.parse(right.resolution.resolvedAt) - Date.parse(left.resolution.resolvedAt) ||
        compareCodePoints(left.intentionId, right.intentionId),
    );
    if (sorted.map(({ intentionId }) => intentionId).join(",") !== ids.join(",")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resolved history must be ordered by resolution time descending then intention ID",
      });
    }
  });

export const GameIntentionDetailSchema = z
  .object({
    activeIntention: PlayIntentionSchema.nullable(),
    resolvedHistory: ResolvedPlayIntentionHistorySchema,
  })
  .strict()
  .superRefine((detail, context) => {
    if (detail.activeIntention !== null && detail.activeIntention.resolution !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeIntention"],
        message: "The active game-detail intention must be unresolved",
      });
    }
    const gameIds = [
      ...(detail.activeIntention === null ? [] : [detail.activeIntention.gameId]),
      ...detail.resolvedHistory.map(({ gameId }) => gameId),
    ];
    if (new Set(gameIds).size > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Game-detail intentions must all belong to one game",
      });
    }
  });

function createAvailableCollectionProfileSchema(policy: CollectionProfileEntityPolicy) {
  const entityClassResultSchema = createCollectionProfileEntityClassResultSchema(policy);
  return z
    .object({
      status: z.literal("available"),
      entityPolicy: CollectionProfileEntityPolicySchema,
      identity: z
        .object({
          collectionState: z.enum(["populated", "empty"]),
          classes: z
            .object({
              mechanic: entityClassResultSchema,
              designer: entityClassResultSchema,
              artist: entityClassResultSchema,
            })
            .strict(),
          axisDistributions: z.array(
            z
              .object({
                axisId: IdSchema,
                axisName: z.string().min(1),
                mean: FiniteNumberSchema,
                median: FiniteNumberSchema,
                standardDeviation: FiniteNumberSchema.min(0),
                range: z.object({ min: FiniteNumberSchema, max: FiniteNumberSchema }).strict(),
                ratedGameCount: SafeCountSchema,
                histogram: z.array(SafeCountSchema).length(10),
              })
              .strict(),
          ),
        })
        .strict(),
      attention: z
        .object({
          state: z.enum(["active", "nothing-to-decide", "empty-collection"]),
          items: z.array(CollectionProfileAttentionItemSchema),
        })
        .strict(),
      computedAt: TimestampSchema,
    })
    .strict()
    .superRefine((profile, context) => {
      if (JSON.stringify(profile.entityPolicy) !== JSON.stringify(policy))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entityPolicy"],
          message: "Profile entity policy must match the validating policy",
        });
      for (const entityClass of ["mechanic", "designer", "artist"] as const)
        if (profile.identity.classes[entityClass].entityClass !== entityClass)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["identity", "classes", entityClass, "entityClass"],
            message: "Class map key must match entity class",
          });
      const expectedAttentionState =
        profile.attention.items.length > 0
          ? "active"
          : profile.identity.collectionState === "empty"
            ? "empty-collection"
            : "nothing-to-decide";
      if (profile.attention.state !== expectedAttentionState)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attention", "state"],
          message: `Attention state must be ${expectedAttentionState}`,
        });
      const itemIds = profile.attention.items.map(({ intention }) => intention.intentionId);
      const gameIds = profile.attention.items.map(({ intention }) => intention.gameId);
      if (new Set(itemIds).size !== itemIds.length || new Set(gameIds).size !== gameIds.length)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attention", "items"],
          message: "Attention items must map one-to-one to active intentions and games",
        });
      const sorted = [...profile.attention.items].sort(
        (left, right) =>
          compareCodePoints(left.gameName, right.gameName) ||
          compareCodePoints(left.intention.gameId, right.intention.gameId),
      );
      if (
        sorted.map(({ id }) => id).join(",") !==
        profile.attention.items.map(({ id }) => id).join(",")
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attention", "items"],
          message: "Attention items must use deterministic name and game-ID order",
        });
      const ownedCounts = Object.values(profile.identity.classes).map(
        ({ metadataReadiness }) => metadataReadiness.ownedGameCount,
      );
      const expectedCollectionState = ownedCounts.every((count) => count === 0)
        ? "empty"
        : "populated";
      if (
        ownedCounts.some((count) => count !== ownedCounts[0]) ||
        profile.identity.collectionState !== expectedCollectionState
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["identity", "collectionState"],
          message: "Collection state and class owned-game counts must agree",
        });
      const classUniverses = Object.values(profile.identity.classes).map(
        (result) =>
          new Map(
            [...result.comparator.games, ...result.exclusions].map((game) => [
              game.gameId,
              game.gameName,
            ]),
          ),
      );
      const firstUniverse = classUniverses[0] ?? new Map<string, string>();
      if (
        classUniverses.some(
          (universe) =>
            universe.size !== firstUniverse.size ||
            [...firstUniverse].some(([gameId, gameName]) => universe.get(gameId) !== gameName),
        )
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["identity", "classes"],
          message: "Every identity class must describe the same owned-game universe",
        });
      if (
        profile.attention.items.some(({ intention }) => !firstUniverse.has(intention.gameId)) ||
        (profile.identity.collectionState === "empty" && profile.attention.items.length > 0)
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attention", "items"],
          message: "Attention items must reference currently owned games",
        });
    });
}

const UnavailableCollectionProfileSchema = z
  .object({
    status: z.literal("unavailable"),
    error: z
      .object({
        kind: z.enum(["transport", "validation", "recomputation"]),
        message: z.string().min(1),
      })
      .strict(),
    retryDestination: z.object({ operationId: z.literal("shelf.profile.get") }).strict(),
  })
  .strict();

export function createCollectionProfileResultSchema(policy: CollectionProfileEntityPolicy) {
  return z.union([
    createAvailableCollectionProfileSchema(policy),
    UnavailableCollectionProfileSchema,
  ]);
}

export const CollectionProfileResultSchema = createCollectionProfileResultSchema(
  DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
);
