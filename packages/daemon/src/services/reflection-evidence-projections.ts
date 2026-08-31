import {
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
  REFLECTION_MANIFEST_VERSION,
  REFLECTION_QUESTION_POLICIES,
  ReflectionCitationSchema,
  ReflectionDependencySchema,
  calculatePurchaseUtilization,
  createCollectionProfileSnapshotSchema,
  projectFitnessScore,
  resolveEffectivePlayerCount,
  resolveEffectivePlayingTime,
  type CollectionProfile,
  type CollectionProfileCollectionSource,
  type CollectionProfileEntityClass,
  type CollectionProfileEntityEvidence,
  type FitnessResult,
  type Game,
  type ReflectionCitation,
  type ReflectionDependency,
  type ReflectionEvidenceClass,
  type ReflectionQuestionId,
  type ShelfConfiguration,
} from "@shelf-judge/shared";
import { z } from "zod";
import {
  type DisplayedFitnessService,
  type DisplayedGameFitness,
} from "./displayed-fitness-service.js";
import { computeCollectionProfile } from "./collection-profile-engine.js";
import { projectProfileCollectionSource } from "./game-projection.js";
import { createGroundedEvidenceRegistry } from "./grounded-analysis/evidence-registry.js";
import type {
  GroundedEvidenceSnapshot,
  GroundedExaminedSource,
} from "./grounded-analysis/evidence-registry.js";
import { canonicalSha256, profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import type { StorageService } from "./storage-service.js";
import {
  DEFAULT_REFLECTION_EVIDENCE_PAGE_SIZE,
  MAX_REFLECTION_EVIDENCE_PAGE_SIZE,
  REFLECTION_PATTERN_CLASS_ORDER,
  REFLECTION_PROJECTION_POLICIES,
  reflectionPatternCandidateIds,
} from "./reflection-question-policy.js";

const IdSchema = z.string().min(1);
const NullableTimestampSchema = z.string().datetime({ offset: true }).nullable();
const TagSchema = z.object({ id: z.number().int().safe(), name: z.string() }).strict();
const EvidenceObservationSchema = z
  .object({
    status: z.enum(["valid", "missing", "invalid"]),
    source: z.string(),
    observedAt: NullableTimestampSchema,
    value: z.number().optional(),
  })
  .strict();
const RedundancySchema = z
  .object({
    penalty: z.number(),
    originalScore: z.number(),
    adjustedScore: z.number(),
    nicheNeighbors: z.array(
      z
        .object({
          gameId: IdSchema,
          gameName: z.string(),
          similarity: z.number(),
          fitnessScore: z.number(),
          isPredicted: z.boolean(),
        })
        .strict(),
    ),
    nicheRank: z.number().int().safe().min(0),
    nicheSize: z.number().int().safe().min(0),
  })
  .strict();
const ScoringSchema = z
  .object({
    gameId: IdSchema,
    state: z.enum(["available", "unavailable"]),
    score: z.number().nullable(),
    ratedAxisCount: z.number().int().safe().min(0),
    totalAxisCount: z.number().int().safe().min(0),
    vetoed: z.boolean(),
    vetoedBy: z
      .object({
        axisId: IdSchema,
        axisName: z.string(),
        threshold: z.number(),
        direction: z.enum(["below", "above"]),
        rawValue: z.number(),
      })
      .strict()
      .nullable(),
    hypotheticalScore: z.number().nullable(),
    prediction: z
      .object({
        readinessStage: z.number().int().min(0).max(3),
        confidence: z.enum(["actual", "strong", "moderate", "weak", "insufficient"]),
        predictedAxisCount: z.number().int().safe().min(0),
        actualAxisCount: z.number().int().safe().min(0),
        referenceGameCount: z.number().int().safe().min(0),
        coveragePercent: z.number(),
      })
      .strict()
      .nullable(),
    breakdown: z.array(
      z
        .object({
          axisId: IdSchema,
          axisName: z.string(),
          weight: z.number(),
          contribution: z.number().nullable(),
          source: z.enum(["personal", "tournament", "derived", "override", "predicted"]),
          sourceValue: z.number().nullable(),
          scoringRawValue: z.number().nullable(),
          effectiveRating: z.number().nullable(),
          overridden: z.boolean(),
          overrideValue: z.number().nullable(),
          predictionConfidence: z
            .enum(["actual", "strong", "moderate", "weak", "insufficient"])
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();
const MetadataClassSchema = z
  .object({
    state: z.enum(["complete", "refresh-needed", "unrefreshable"]),
    entities: z.array(TagSchema),
    observedAt: NullableTimestampSchema,
    refreshWarning: z
      .object({ attemptedAt: z.string().datetime({ offset: true }), message: z.string() })
      .strict()
      .nullable(),
  })
  .strict();
const MetadataSchema = z
  .object({
    gameId: IdSchema,
    importedAt: NullableTimestampSchema,
    yearPublished: z.number().int().nullable(),
    minPlayers: z.number().int().nullable(),
    maxPlayers: z.number().int().nullable(),
    bestPlayers: z.number().int().nullable(),
    playingTimeMinutes: z.number().nullable(),
    weight: z.number().nullable(),
    categories: z.array(TagSchema),
    mechanics: z.array(TagSchema),
    families: z.array(TagSchema),
    subdomains: z.array(TagSchema),
    entityMetadata: z
      .object({
        mechanic: MetadataClassSchema,
        designer: MetadataClassSchema,
        artist: MetadataClassSchema,
      })
      .strict(),
  })
  .strict();
const UtilizationComponentSchema = z
  .object({
    outcome: z.enum(["calculated", "unavailable", "not-applicable", "unreachable"]),
    exact: z.object({ numerator: z.string(), denominator: z.string() }).strict().nullable(),
    wholePlays: z.string().nullable(),
  })
  .strict();
const AcquisitionProjectionSchema = z.union([
  z.object({ state: z.enum(["unknown", "gift", "invalid"]) }).strict(),
  z
    .object({
      state: z.literal("purchase"),
      amount: z
        .object({
          hundredths: z.number().int().safe(),
          source: z.literal("manual"),
          confirmedAt: z.string().datetime({ offset: true }),
        })
        .strict(),
    })
    .strict(),
]);
const PlayAcquisitionSchema = z
  .object({
    gameId: IdSchema,
    playCount: EvidenceObservationSchema,
    acquisition: AcquisitionProjectionSchema,
    utilization: z
      .object({
        outcome: z.enum(["met", "not-met", "unavailable", "not-applicable"]),
        reasons: z.array(z.string()),
        costPerRecordedPlay: UtilizationComponentSchema,
        modeledPlayerHours: UtilizationComponentSchema,
        valueMultiplier: UtilizationComponentSchema,
        valueRemaining: UtilizationComponentSchema,
        estimatedAdditionalPlays: UtilizationComponentSchema,
      })
      .strict(),
  })
  .strict();
const StructureSchema = z
  .object({
    gameId: IdSchema,
    shelf: z
      .object({ shelfId: IdSchema, shelfName: z.string(), unitId: IdSchema, unitName: z.string() })
      .strict()
      .nullable(),
    danglingShelfId: z.string().min(1).nullable(),
    redundancy: RedundancySchema.nullable(),
  })
  .strict();
const GameIdentitySchema = z
  .object({
    gameId: IdSchema,
    name: z.string(),
    bggId: z.number().int().safe().nullable(),
    ownership: z.enum(["owned", "previously-owned"]),
  })
  .strict();
const ProfileGameSchema = z
  .object({
    gameId: IdSchema,
    gameName: z.string(),
    currentFitness: z.number(),
    vetoed: z.boolean(),
  })
  .strict();
const ProfileEvidenceSchema = z
  .object({
    candidateId: IdSchema,
    entityClass: z.enum(REFLECTION_PATTERN_CLASS_ORDER),
    entityId: z.number().int().safe(),
    name: z.string(),
    support: z.enum(["limited", "supported"]),
    associatedGameCount: z.number().int().safe().min(0),
    meanCurrentFitness: z.number(),
    adjustedMeanCurrentFitness: z.number(),
    populationStandardDeviation: z.number(),
    range: z.object({ min: z.number(), max: z.number() }).strict(),
    comparator: z
      .object({
        gameCount: z.number().int().safe().min(0),
        meanCurrentFitness: z.number().nullable(),
        games: z.array(ProfileGameSchema),
      })
      .strict(),
    metadataReadiness: z
      .object({
        state: z.enum(["complete", "partial", "refresh-needed"]),
        ownedGameCount: z.number().int().safe().min(0),
        completeGameCount: z.number().int().safe().min(0),
        refreshNeededGameCount: z.number().int().safe().min(0),
        unrefreshableGameCount: z.number().int().safe().min(0),
      })
      .strict(),
    refreshWarnings: z.array(
      z
        .object({
          gameId: IdSchema,
          gameName: z.string(),
          attemptedAt: z.string().datetime({ offset: true }),
          message: z.string(),
        })
        .strict(),
    ),
    differenceFromComparator: z.number(),
    games: z.array(ProfileGameSchema),
    exclusions: z.array(
      z
        .object({
          gameId: IdSchema,
          gameName: z.string(),
          reason: z.enum([
            "predicted-fitness",
            "missing-or-invalid-fitness",
            "refresh-needed-metadata",
            "unrefreshable-metadata",
          ]),
          associationKnown: z.boolean(),
          associatedWithCandidate: z.boolean(),
        })
        .strict(),
    ),
    confounders: z.array(
      z
        .object({
          entityId: z.number().int().safe(),
          name: z.string(),
          cooccurringGameCount: z.number().int().safe().positive(),
          gameIds: z.array(IdSchema),
        })
        .strict(),
    ),
  })
  .strict();

const ReflectionEvidenceIdentitySchema = z
  .object({
    citationId: IdSchema,
    sourceId: IdSchema,
    sourceVersion: IdSchema,
    evidenceClass: z.enum([
      "game-identity-ownership",
      "current-scoring",
      "imported-metadata",
      "play-acquisition",
      "collection-structure",
      "profile-evidence",
    ]),
  })
  .strict();

export const REFLECTION_DETERMINISTIC_EVIDENCE_MANIFEST = Object.freeze({
  manifestId: "profile-reflection-deterministic",
  manifestVersion: String(REFLECTION_MANIFEST_VERSION),
  evidence: Object.freeze({
    "game-identity-ownership": GameIdentitySchema,
    "current-scoring": ScoringSchema,
    "imported-metadata": MetadataSchema,
    "play-acquisition": PlayAcquisitionSchema,
    "collection-structure": StructureSchema,
    "profile-evidence": ProfileEvidenceSchema,
  }),
});

type DeterministicEvidenceClass = Exclude<ReflectionEvidenceClass, "owner-game-note">;

interface ProjectedSource {
  identity: GroundedExaminedSource;
  citationId: string;
  payload: unknown;
  citation: ReflectionCitation;
  dependencies: ReflectionDependency[];
}

export interface ReflectionEvidencePageCursor {
  readonly snapshotFingerprint: string;
  readonly questionId: ReflectionQuestionId;
  readonly offset: number;
}

export interface ReflectionEvidencePage {
  readonly snapshotFingerprint: string;
  readonly gameIds: readonly string[];
  readonly nextCursor: ReflectionEvidencePageCursor | null;
  readonly totalGameCount: number;
}

export interface ReflectionQuestionProjection {
  readonly questionId: ReflectionQuestionId;
  readonly snapshotFingerprint: string;
  readonly gameIds: readonly string[];
  readonly excludedGameCount: number;
  readonly patternCandidateIds?: readonly string[];
  readonly evidence: GroundedEvidenceSnapshot;
  readonly citations: readonly ReflectionCitation[];
  readonly dependencies: readonly ReflectionDependency[];
  page(cursor?: ReflectionEvidencePageCursor | null, limit?: number): ReflectionEvidencePage;
}

export interface ReflectionProjectionSnapshot {
  readonly collectionId: string;
  readonly collectionSchemaVersion: number;
  readonly collectionRevision: number;
  readonly profileContractVersion: number;
  readonly profileAlgorithmVersion: number;
  readonly snapshotFingerprint: string;
  readonly projections: Readonly<Record<ReflectionQuestionId, ReflectionQuestionProjection>>;
}

export interface ReflectionProjectionSnapshotInput {
  collection: CollectionProfileCollectionSource;
  profile: CollectionProfile;
  displayedGames: readonly DisplayedGameFitness[];
  shelfConfiguration: ShelfConfiguration;
}

export interface ReflectionProjectionSnapshotService {
  capture(): Promise<ReflectionProjectionSnapshot>;
}

export interface ReflectionProjectionSnapshotServiceDeps {
  storageService: Pick<
    StorageService,
    | "loadCollection"
    | "loadConfig"
    | "loadTournament"
    | "loadPredictionSettings"
    | "loadRedundancySettings"
    | "loadShelfConfig"
  >;
  displayedFitnessService: DisplayedFitnessService;
  now?: () => string;
}

function cloneAndFreeze<Value>(value: Value): Value {
  const copy = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null || Object.isFrozen(candidate)) return;
    Object.freeze(candidate);
    for (const child of Object.values(candidate)) freeze(child);
  };
  freeze(copy);
  return copy;
}

function compareText(left: string, right: string): number {
  const leftPoints = Array.from(left.normalize("NFC"));
  const rightPoints = Array.from(right.normalize("NFC"));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference =
      (leftPoints[index]?.codePointAt(0) ?? 0) - (rightPoints[index]?.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function sortedTags(tags: readonly { id: number; name: string }[]): { id: number; name: string }[] {
  return [...new Map(tags.map((tag) => [tag.id, { id: tag.id, name: tag.name }])).values()].sort(
    (left, right) => compareText(left.name, right.name) || left.id - right.id,
  );
}

function evidenceObservation(evidence: Game["playCountEvidence"]) {
  return evidence.status === "valid"
    ? {
        status: evidence.status,
        source: evidence.source,
        observedAt: evidence.observedAt,
        value: evidence.value,
      }
    : { status: evidence.status, source: evidence.source, observedAt: evidence.observedAt };
}

function scoringPayload(gameId: string, score: FitnessResult | null) {
  if (score === null) {
    return {
      gameId,
      state: "unavailable" as const,
      score: null,
      ratedAxisCount: 0,
      totalAxisCount: 0,
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      prediction: null,
      breakdown: [],
    };
  }
  return {
    gameId,
    state: "available" as const,
    score: score.score,
    ratedAxisCount: score.ratedAxisCount,
    totalAxisCount: score.totalAxisCount,
    vetoed: score.vetoed,
    vetoedBy: score.vetoedBy,
    hypotheticalScore: score.hypotheticalScore,
    prediction: score.predictionMeta,
    breakdown: score.breakdown.map((axis) => ({
      axisId: axis.axisId,
      axisName: axis.axisName,
      weight: axis.weight,
      contribution: axis.contribution,
      source: axis.source,
      sourceValue: axis.sourceValue,
      scoringRawValue: axis.scoringRawValue,
      effectiveRating: axis.effectiveRating,
      overridden: axis.overridden,
      overrideValue: axis.overrideValue,
      predictionConfidence: axis.predictionConfidence,
    })),
  };
}

function metadataPayload(game: Game) {
  const metadataClass = (entityClass: CollectionProfileEntityClass) => {
    const metadata = game.entityMetadata[entityClass];
    return {
      state: metadata.state,
      entities: metadata.state === "complete" ? sortedTags(metadata.entities) : [],
      observedAt: metadata.state === "complete" ? metadata.observedAt : null,
      refreshWarning: metadata.refreshFailure,
    };
  };
  return {
    gameId: game.id,
    importedAt: game.bggData?.fetchedAt ?? null,
    yearPublished: game.yearPublished,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    bestPlayers: game.bestPlayers,
    playingTimeMinutes: game.playingTime,
    weight: game.bggData?.weight ?? null,
    categories: sortedTags(game.bggData?.categories ?? []),
    mechanics: sortedTags(game.bggData?.mechanics ?? []),
    families: sortedTags(game.bggData?.families ?? []),
    subdomains: sortedTags(game.bggData?.subdomains ?? []),
    entityMetadata: {
      mechanic: metadataClass("mechanic"),
      designer: metadataClass("designer"),
      artist: metadataClass("artist"),
    },
  };
}

function utilizationComponent(component: {
  outcome: "calculated" | "unavailable" | "not-applicable" | "unreachable";
  value?: { exact?: { numerator: string; denominator: string }; wholePlays?: string };
}) {
  return {
    outcome: component.outcome,
    exact: component.value?.exact ?? null,
    wholePlays: component.value?.wholePlays ?? null,
  };
}

function playAcquisitionPayload(
  game: Game,
  score: FitnessResult | null,
  collection: CollectionProfileCollectionSource,
) {
  const displayScore = score === null ? null : projectFitnessScore(String(score.score));
  const utilization = calculatePurchaseUtilization({
    acquisition: game.acquisition,
    entertainmentBenchmark: collection.entertainmentBenchmark,
    playCount: game.playCountEvidence,
    duration: resolveEffectivePlayingTime(game),
    playerRange: game.playerRangeEvidence,
    suggestedPlayerPoll: game.suggestedPlayerPoll,
    playerCountOverride: resolveEffectivePlayerCount(game, null),
    fitness: displayScore,
  });
  return {
    gameId: game.id,
    playCount: evidenceObservation(game.playCountEvidence),
    acquisition:
      game.acquisition.state === "purchase" ? game.acquisition : { state: game.acquisition.state },
    utilization: {
      outcome: utilization.outcome,
      reasons: utilization.reasons,
      costPerRecordedPlay: utilizationComponent(utilization.components.costPerRecordedPlay),
      modeledPlayerHours: utilizationComponent(utilization.components.modeledPlayerHours),
      valueMultiplier: utilizationComponent(utilization.components.valueMultiplier),
      valueRemaining: utilizationComponent(utilization.components.valueRemaining),
      estimatedAdditionalPlays: utilizationComponent(
        utilization.components.estimatedAdditionalPlays,
      ),
    },
  };
}

function shelfForGame(game: Game, shelves: ShelfConfiguration) {
  if (game.manualShelfId === null) return { shelf: null, danglingShelfId: null };
  for (const unit of shelves.units) {
    const shelf = unit.shelves.find(({ id }) => id === game.manualShelfId);
    if (shelf !== undefined) {
      return {
        shelf: { shelfId: shelf.id, shelfName: shelf.name, unitId: unit.id, unitName: unit.name },
        danglingShelfId: null,
      };
    }
  }
  return { shelf: null, danglingShelfId: game.manualShelfId };
}

function dependency(
  category: Exclude<ReflectionDependency["category"], "note">,
  sourceId: string,
  payload: unknown,
  observedAt?: string | null,
): ReflectionDependency {
  return ReflectionDependencySchema.parse({
    category,
    sourceId,
    fingerprint: canonicalSha256(payload),
    ...(observedAt == null ? {} : { observedAt }),
  });
}

function source(
  evidenceClass: DeterministicEvidenceClass,
  sourceId: string,
  payload: unknown,
  summary: string,
  destination: ReflectionCitation["destination"],
  dependencies: ReflectionDependency[],
  observedAt?: string | null,
): ProjectedSource {
  const parsedPayload =
    REFLECTION_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[evidenceClass].parse(payload);
  const sourceVersion = canonicalSha256(parsedPayload);
  const citationId = `reflection:${evidenceClass}:${sourceId}:${sourceVersion.slice(0, 16)}`;
  return {
    identity: { evidenceClass, sourceId, sourceVersion },
    citationId,
    payload: parsedPayload,
    citation: ReflectionCitationSchema.parse({
      citationId,
      sourceId,
      sourceVersion,
      evidenceClass,
      testimony: false,
      ...(observedAt == null ? {} : { observedAt }),
      canonicalSummary: summary,
      destination,
    }),
    dependencies,
  };
}

function gameSources(
  game: Game,
  displayed: DisplayedGameFitness,
  collection: CollectionProfileCollectionSource,
  shelves: ShelfConfiguration,
): ProjectedSource[] {
  const destination = { operationId: "shelf.game.get" as const, parameters: { gameId: game.id } };
  const identity = {
    gameId: game.id,
    name: game.name,
    bggId: game.bggId,
    ownership: game.ownership,
  };
  const scoring = scoringPayload(game.id, displayed.score);
  const metadata = metadataPayload(game);
  const playAcquisition = playAcquisitionPayload(game, displayed.score, collection);
  const structure = {
    gameId: game.id,
    ...shelfForGame(game, shelves),
    redundancy: displayed.score?.redundancyAdjustment ?? null,
  };
  return [
    source(
      "game-identity-ownership",
      `game:${game.id}:identity`,
      identity,
      `${game.name} (${game.ownership})`,
      destination,
      [dependency("ownership", `game:${game.id}:ownership`, identity)],
    ),
    source(
      "current-scoring",
      `game:${game.id}:scoring`,
      scoring,
      `${game.name}: current fitness ${displayed.score?.score ?? "unavailable"}`,
      destination,
      [dependency("scoring", `game:${game.id}:scoring`, scoring)],
    ),
    source(
      "imported-metadata",
      `game:${game.id}:metadata`,
      metadata,
      `${game.name}: current imported metadata`,
      destination,
      [dependency("metadata", `game:${game.id}:metadata`, metadata, metadata.importedAt)],
      metadata.importedAt,
    ),
    source(
      "play-acquisition",
      `game:${game.id}:play-acquisition`,
      playAcquisition,
      `${game.name}: current play and acquisition evidence`,
      destination,
      [
        dependency(
          "play",
          `game:${game.id}:play`,
          playAcquisition.playCount,
          playAcquisition.playCount.observedAt,
        ),
        dependency("acquisition", `game:${game.id}:acquisition`, {
          acquisition: playAcquisition.acquisition,
          utilization: playAcquisition.utilization,
        }),
      ],
    ),
    source(
      "collection-structure",
      `game:${game.id}:structure`,
      structure,
      `${game.name}: current shelf and redundancy evidence`,
      destination,
      [dependency("shelf", `game:${game.id}:structure`, structure, shelves.updatedAt)],
      shelves.updatedAt,
    ),
  ];
}

function candidateConfounders(
  entityClass: CollectionProfileEntityClass,
  entity: CollectionProfileEntityEvidence,
  gamesById: ReadonlyMap<string, Game>,
) {
  const occurrences = new Map<number, { name: string; gameIds: Set<string> }>();
  for (const evidence of entity.games) {
    const game = gamesById.get(evidence.gameId);
    const metadata = game?.entityMetadata[entityClass];
    if (metadata?.state !== "complete") continue;
    for (const collaborator of new Map(
      metadata.entities.map((entry) => [entry.id, entry]),
    ).values()) {
      if (collaborator.id === entity.entityId) continue;
      const occurrence = occurrences.get(collaborator.id) ?? {
        name: collaborator.name,
        gameIds: new Set<string>(),
      };
      occurrence.gameIds.add(evidence.gameId);
      occurrences.set(collaborator.id, occurrence);
    }
  }
  return [...occurrences]
    .map(([entityId, occurrence]) => ({
      entityId,
      name: occurrence.name,
      cooccurringGameCount: occurrence.gameIds.size,
      gameIds: [...occurrence.gameIds].sort(compareText),
    }))
    .sort(
      (left, right) =>
        right.cooccurringGameCount - left.cooccurringGameCount ||
        compareText(left.name, right.name) ||
        left.entityId - right.entityId,
    );
}

function patternSources(
  profile: CollectionProfile,
  gamesById: ReadonlyMap<string, Game>,
): ProjectedSource[] {
  return REFLECTION_PATTERN_CLASS_ORDER.flatMap((entityClass) => {
    const classResult = profile.identity.classes[entityClass];
    return classResult.overviewEntityIds.map((entityId) => {
      const entity = classResult.entities.find((candidate) => candidate.entityId === entityId);
      if (entity === undefined)
        throw new Error(`Profile candidate ${entityClass}:${entityId} is missing`);
      const candidateId = `${entityClass}:${entityId}`;
      const payload = {
        candidateId,
        entityClass,
        entityId,
        name: entity.name,
        support: entity.support,
        associatedGameCount: entity.associatedGameCount,
        meanCurrentFitness: entity.meanCurrentFitness,
        adjustedMeanCurrentFitness: entity.adjustedMeanCurrentFitness,
        populationStandardDeviation: entity.populationStandardDeviation,
        range: entity.range,
        comparator: {
          gameCount: classResult.comparator.gameCount,
          meanCurrentFitness: classResult.comparator.meanCurrentFitness,
          games: classResult.comparator.games,
        },
        metadataReadiness: classResult.metadataReadiness,
        refreshWarnings: classResult.refreshWarnings,
        differenceFromComparator: entity.differenceFromComparator,
        games: entity.games,
        exclusions: classResult.exclusions.map((exclusion) => {
          const metadata = gamesById.get(exclusion.gameId)?.entityMetadata[entityClass];
          const associationKnown = metadata?.state === "complete";
          return {
            gameId: exclusion.gameId,
            gameName: exclusion.gameName,
            reason: exclusion.reason,
            associationKnown,
            associatedWithCandidate:
              associationKnown === true && metadata.entities.some(({ id }) => id === entityId),
          };
        }),
        confounders: candidateConfounders(entityClass, entity, gamesById),
      };
      return source(
        "profile-evidence",
        `profile:${candidateId}`,
        payload,
        `${entityClass} ${entity.name}: ${entity.support} association across ${entity.associatedGameCount} games`,
        { operationId: "shelf.profile.get", parameters: {} },
        [dependency("profile", `profile:${candidateId}`, payload)],
      );
    });
  });
}

function uniqueDependencies(dependencies: readonly ReflectionDependency[]): ReflectionDependency[] {
  const byIdentity = new Map<string, ReflectionDependency>();
  for (const entry of dependencies) {
    const key =
      entry.category === "note"
        ? `${entry.category}\0${entry.gameId}`
        : `${entry.category}\0${entry.sourceId}`;
    const previous = byIdentity.get(key);
    if (previous !== undefined && canonicalSha256(previous) !== canonicalSha256(entry)) {
      throw new Error(`Conflicting Reflection dependency: ${key}`);
    }
    byIdentity.set(key, entry);
  }
  return [...byIdentity.values()].sort((left, right) => {
    const leftId = left.category === "note" ? left.gameId : left.sourceId;
    const rightId = right.category === "note" ? right.gameId : right.sourceId;
    return compareText(left.category, right.category) || compareText(leftId, rightId);
  });
}

function makePage(
  snapshotFingerprint: string,
  questionId: ReflectionQuestionId,
  gameIds: readonly string[],
  cursor?: ReflectionEvidencePageCursor | null,
  requestedLimit = DEFAULT_REFLECTION_EVIDENCE_PAGE_SIZE,
): ReflectionEvidencePage {
  if (
    !Number.isSafeInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > MAX_REFLECTION_EVIDENCE_PAGE_SIZE
  )
    throw new Error(
      `Reflection page limit must be between 1 and ${MAX_REFLECTION_EVIDENCE_PAGE_SIZE}`,
    );
  if (
    cursor !== undefined &&
    cursor !== null &&
    (cursor.snapshotFingerprint !== snapshotFingerprint || cursor.questionId !== questionId)
  )
    throw new Error("Reflection page cursor belongs to a different projection");
  const offset = cursor?.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > gameIds.length)
    throw new Error("Reflection page cursor offset is invalid");
  const pageGameIds = gameIds.slice(offset, offset + requestedLimit);
  const nextOffset = offset + pageGameIds.length;
  return cloneAndFreeze({
    snapshotFingerprint,
    gameIds: pageGameIds,
    nextCursor:
      nextOffset < gameIds.length ? { snapshotFingerprint, questionId, offset: nextOffset } : null,
    totalGameCount: gameIds.length,
  });
}

export function buildReflectionProjectionSnapshot(
  input: ReflectionProjectionSnapshotInput,
): ReflectionProjectionSnapshot {
  const collection = structuredClone(input.collection);
  const profile = createCollectionProfileSnapshotSchema(input.profile.entityPolicy).parse({
    source: collection,
    profile: structuredClone(input.profile),
  }).profile;
  if (profile.status !== "available") {
    throw new Error("Reflection projections require an available Profile snapshot");
  }
  const shelves = structuredClone(input.shelfConfiguration);
  const ownedGames = collection.games
    .filter(({ ownership }) => ownership === "owned")
    .sort((left, right) => compareText(left.id, right.id));
  const gamesById = new Map(ownedGames.map((game) => [game.id, game]));
  const displayedById = new Map<string, DisplayedGameFitness>();
  for (const entry of input.displayedGames) {
    if (displayedById.has(entry.game.id)) {
      throw new Error(`Displayed fitness snapshot contains duplicate game ${entry.game.id}`);
    }
    displayedById.set(entry.game.id, structuredClone(entry));
  }
  if (displayedById.size !== collection.games.length) {
    throw new Error("Displayed fitness snapshot must contain every collection game exactly once");
  }
  for (const game of collection.games) {
    const displayed = displayedById.get(game.id);
    if (displayed === undefined || canonicalSha256(displayed.game) !== canonicalSha256(game)) {
      throw new Error(`Displayed fitness game does not match collection snapshot for ${game.id}`);
    }
  }
  const candidates = reflectionPatternCandidateIds(profile);
  const patternEvidence = patternSources(profile, gamesById);
  for (const entityClass of REFLECTION_PATTERN_CLASS_ORDER) {
    for (const entity of profile.identity.classes[entityClass].entities) {
      for (const gameEvidence of entity.games) {
        const score = displayedById.get(gameEvidence.gameId)?.score?.score;
        if (score !== gameEvidence.currentFitness) {
          throw new Error(
            `Displayed fitness does not match Profile evidence for ${gameEvidence.gameId}`,
          );
        }
      }
    }
  }
  const patternGameIds = [
    ...new Set(
      patternEvidence.flatMap((entry) => {
        const payload = ProfileEvidenceSchema.parse(entry.payload);
        return payload.games.map(({ gameId }) => gameId);
      }),
    ),
  ].sort(compareText);
  const gameEvidenceById = new Map(
    ownedGames.map((game) => {
      const displayed = displayedById.get(game.id);
      if (displayed === undefined)
        throw new Error(`Reflection snapshot is missing game ${game.id}`);
      return [game.id, gameSources(game, displayed, collection, shelves)] as const;
    }),
  );
  const snapshotFingerprint = canonicalSha256({
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    collectionRevision: collection.revision,
    profileContractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
    profileAlgorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
    evidence: [...gameEvidenceById.values(), patternEvidence]
      .flat()
      .map(({ identity, payload }) => ({ identity, payload })),
  });
  const projections = {} as Record<ReflectionQuestionId, ReflectionQuestionProjection>;
  for (const questionId of Object.keys(REFLECTION_PROJECTION_POLICIES) as ReflectionQuestionId[]) {
    const policy = REFLECTION_PROJECTION_POLICIES[questionId];
    const gameIds = policy.includesAllOwnedGames ? ownedGames.map(({ id }) => id) : patternGameIds;
    const allowedClasses = new Set<ReflectionEvidenceClass>(policy.evidenceClasses);
    const projected = gameIds.flatMap((gameId) => {
      const evidence = gameEvidenceById.get(gameId);
      if (evidence === undefined) throw new Error(`Reflection snapshot is missing game ${gameId}`);
      return evidence.filter(({ identity }) =>
        allowedClasses.has(identity.evidenceClass as ReflectionEvidenceClass),
      );
    });
    if (policy.requiresCompletePatternCandidates) projected.push(...patternEvidence);
    const expectedSources = projected.map(({ identity }) => identity);
    const registry = createGroundedEvidenceRegistry({
      manifest: REFLECTION_DETERMINISTIC_EVIDENCE_MANIFEST,
      evidenceIdentitySchema: ReflectionEvidenceIdentitySchema,
      expectedSources,
    });
    for (const entry of projected) {
      registry.recordExamined(entry.identity);
      registry.add({ ...entry.identity, citationId: entry.citationId, payload: entry.payload });
    }
    const questionPolicy = REFLECTION_QUESTION_POLICIES[questionId];
    const dependencies = uniqueDependencies([
      ...projected.flatMap(({ dependencies: sourceDependencies }) => sourceDependencies),
      dependency("question-policy", `question:${questionId}`, questionPolicy),
      dependency("collection", `collection:${collection.id}`, {
        schemaVersion: collection.schemaVersion,
        revision: collection.revision,
      }),
    ]);
    const projection: ReflectionQuestionProjection = {
      questionId,
      snapshotFingerprint,
      gameIds: cloneAndFreeze(gameIds),
      excludedGameCount: ownedGames.length - gameIds.length,
      ...(policy.requiresCompletePatternCandidates
        ? { patternCandidateIds: cloneAndFreeze(candidates) }
        : {}),
      evidence: registry.complete(),
      citations: cloneAndFreeze(projected.map(({ citation }) => citation)),
      dependencies: cloneAndFreeze(dependencies),
      page: (cursor, limit) => makePage(snapshotFingerprint, questionId, gameIds, cursor, limit),
    };
    projections[questionId] = Object.freeze(projection);
  }
  return Object.freeze({
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    collectionRevision: collection.revision,
    profileContractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
    profileAlgorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
    snapshotFingerprint,
    projections: Object.freeze(projections),
  });
}

export function createReflectionProjectionSnapshotService(
  deps: ReflectionProjectionSnapshotServiceDeps,
): ReflectionProjectionSnapshotService {
  const coordinator = profileSourceCoordinatorFor(deps.storageService);
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    capture() {
      return coordinator.runExclusive(async () => {
        // Collection load may migrate storage, so capture dependent sources afterward.
        const durableCollection = await deps.storageService.loadCollection();
        const [config, tournament, predictionSettings, redundancySettings, shelfConfiguration] =
          await Promise.all([
            deps.storageService.loadConfig(),
            deps.storageService.loadTournament(),
            deps.storageService.loadPredictionSettings(),
            deps.storageService.loadRedundancySettings(),
            deps.storageService.loadShelfConfig(),
          ]);
        const collection = projectProfileCollectionSource(durableCollection);
        const displayedGames = await deps.displayedFitnessService.listGamesFromSnapshot(
          { collection, tournament, predictionSettings, redundancySettings },
          { includePredicted: true },
        );
        const fitnessResults = new Map<string, FitnessResult>();
        for (const entry of displayedGames) {
          if (entry.score !== null && entry.hasScoringContribution) {
            fitnessResults.set(entry.game.id, entry.score);
          }
        }
        const profile = computeCollectionProfile({
          collection,
          fitnessResults,
          computedAt: now(),
          entityPolicy: config.profileEntityPolicy,
        });
        return buildReflectionProjectionSnapshot({
          collection,
          profile,
          displayedGames,
          shelfConfiguration,
        });
      });
    },
  };
}
