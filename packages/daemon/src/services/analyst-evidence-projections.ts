import {
  ANALYST_MANIFEST_VERSION,
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
  calculatePurchaseUtilization,
  createCollectionProfileSnapshotSchema,
  projectFitnessScore,
  resolveEffectivePlayerCount,
  resolveEffectivePlayingTime,
  type AnalystEvidenceClass,
  type CollectionProfile,
  type CollectionProfileCollectionSource,
  type CollectionProfileEntityClass,
  type Game,
  type ShelfConfiguration,
} from "@shelf-judge/shared";
import { z } from "zod";
import type { DisplayedGameFitness, DisplayedFitnessService } from "./displayed-fitness-service.js";
import { projectProfileCollectionSource } from "./game-projection.js";
import { canonicalSha256, profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import { createProfileService } from "./profile-service.js";
import type { StorageService } from "./storage-service.js";

const IdSchema = z.string().min(1);
const TimestampSchema = z.string().datetime({ offset: true });
const TagSchema = z.object({ id: z.number().int().safe(), name: z.string() }).strict();
const VetoSchema = z
  .object({
    axisId: IdSchema,
    axisName: z.string(),
    threshold: z.number(),
    direction: z.enum(["below", "above"]),
    rawValue: z.number(),
  })
  .strict();
const PredictionSchema = z
  .object({
    readinessStage: z.number().int().min(0).max(3),
    confidence: z.enum(["actual", "strong", "moderate", "weak", "insufficient"]),
    predictedAxisCount: z.number().int().min(0),
    actualAxisCount: z.number().int().min(0),
    referenceGameCount: z.number().int().min(0),
    coveragePercent: z.number(),
  })
  .strict();
const ReferenceGameSchema = z
  .object({ gameId: IdSchema, gameName: z.string().min(1), similarity: z.number() })
  .strict();
const FitnessBreakdownEntrySchema = z
  .object({
    axisId: IdSchema,
    axisName: z.string().min(1),
    weight: z.number(),
    contribution: z.number().nullable(),
    source: z.enum(["personal", "tournament", "derived", "override", "predicted"]),
    derivedField: z.string().min(1).nullable(),
    sourceValue: z.number().nullable(),
    scoringRawValue: z.number().nullable(),
    effectiveRating: z.number().nullable(),
    preferenceShape: z.enum(["higher-is-better", "lower-is-better", "sweet-spot"]),
    curveAffected: z.boolean(),
    unit: z.string().nullable(),
    provenance: z.string().nullable(),
    configurationSummary: z.string().nullable(),
    overridden: z.boolean(),
    overrideValue: z.number().nullable(),
    predictionConfidence: z
      .enum(["actual", "strong", "moderate", "weak", "insufficient"])
      .nullable(),
    referenceGames: z.array(ReferenceGameSchema).nullable(),
  })
  .strict();
const RefreshWarningSchema = z
  .object({ attemptedAt: TimestampSchema, message: z.string() })
  .strict();
const PlayCountSchema = z.union([
  z
    .object({
      status: z.literal("valid"),
      source: z.string(),
      observedAt: TimestampSchema.nullable(),
      value: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      status: z.enum(["missing", "invalid"]),
      source: z.string(),
      observedAt: TimestampSchema.nullable(),
    })
    .strict(),
]);
const AcquisitionPriceSchema = z
  .object({
    hundredths: z.number().int().safe(),
    source: z.literal("manual"),
    confirmedAt: TimestampSchema,
  })
  .strict();
const PurchaseUtilizationComponentSchema = z
  .object({
    outcome: z.enum(["calculated", "unavailable", "not-applicable", "unreachable"]),
    exact: z.object({ numerator: z.string(), denominator: z.string() }).strict().nullable(),
    wholePlays: z.string().nullable(),
  })
  .strict();
const PurchaseUtilizationSchema = z
  .object({
    outcome: z.enum(["met", "not-met", "unavailable", "not-applicable"]),
    reasons: z.array(z.string()),
    costPerRecordedPlay: PurchaseUtilizationComponentSchema,
    modeledPlayerHours: PurchaseUtilizationComponentSchema,
    valueMultiplier: PurchaseUtilizationComponentSchema,
    valueRemaining: PurchaseUtilizationComponentSchema,
    estimatedAdditionalPlays: PurchaseUtilizationComponentSchema,
  })
  .strict();
const ShelfAssignmentSchema = z.union([
  z.null(),
  z
    .object({ shelfId: IdSchema, shelfName: z.string(), unitId: IdSchema, unitName: z.string() })
    .strict(),
  z.object({ danglingShelfId: IdSchema }).strict(),
]);
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
    nicheRank: z.number().int().min(0),
    nicheSize: z.number().int().min(0),
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
const ExclusionSchema = z
  .object({
    gameId: IdSchema,
    gameName: z.string(),
    reason: z.enum([
      "predicted-fitness",
      "missing-or-invalid-fitness",
      "refresh-needed-metadata",
      "unrefreshable-metadata",
    ]),
    hasEntityAssociation: z.boolean(),
    correctionDestination: z.union([
      z.null(),
      z
        .object({ operationId: z.enum(["shelf.game.bgg.refresh", "shelf.game.rating.set"]) })
        .strict(),
    ]),
  })
  .strict();
const ConfounderSchema = z
  .object({
    entityId: z.number().int().safe(),
    name: z.string(),
    cooccurringGameCount: z.number().int().positive(),
    gameIds: z.array(IdSchema),
  })
  .strict();
const ActiveIntentionSchema = z
  .object({
    intentionId: IdSchema,
    gameId: IdSchema,
    gameName: z.string(),
    kind: z.enum(["first-play", "replay"]),
    baseline: z
      .object({
        playCount: z.number().int().min(0).nullable(),
        evidenceSource: z.string().nullable(),
        observedAt: TimestampSchema.nullable(),
      })
      .strict(),
    createdAt: TimestampSchema,
    version: z.number().int().safe().positive(),
    currentPlayEvidence: z.union([
      z
        .object({
          status: z.literal("valid"),
          playCount: z.number().int().min(0),
          source: z.string(),
          observedAt: TimestampSchema,
          stale: z.literal(false),
        })
        .strict(),
      z
        .object({
          status: z.enum(["missing", "invalid", "stale"]),
          playCount: z.number().int().min(0).nullable(),
          source: z.string().nullable(),
          observedAt: TimestampSchema.nullable(),
          warning: z.string(),
        })
        .strict(),
    ]),
  })
  .strict();
const ProfileEvidenceSharedSchema = {
  entityClass: z.enum(["mechanic", "designer", "artist"]),
  name: z.string(),
  entityAssociations: z.array(ProfileGameSchema),
  comparatorCohort: z
    .object({
      gameCount: z.number().int().min(0),
      meanCurrentFitness: z.number().nullable(),
      games: z.array(ProfileGameSchema),
    })
    .strict(),
  exclusions: z.array(ExclusionSchema),
  activeIntentions: z.array(ActiveIntentionSchema),
  evidenceWarnings: z.array(
    RefreshWarningSchema.extend({ gameId: IdSchema, gameName: z.string() }),
  ),
  confounders: z.array(ConfounderSchema),
  associationNotPreference: z.literal(true),
};
const ProfileEvidenceSchema = z.union([
  z
    .object({
      ...ProfileEvidenceSharedSchema,
      entityId: z.number().int(),
      support: z.enum(["limited", "supported"]),
      dispersion: z
        .object({
          populationStandardDeviation: z.number(),
          range: z.object({ min: z.number(), max: z.number() }).strict(),
        })
        .strict(),
      supportingGames: z.array(ProfileGameSchema),
    })
    .strict(),
  z
    .object({
      ...ProfileEvidenceSharedSchema,
      entityId: z.null(),
      support: z.null(),
      dispersion: z.null(),
      supportingGames: z.array(ProfileGameSchema).length(0),
      entityAssociations: z.array(ProfileGameSchema).length(0),
      confounders: z.array(ConfounderSchema).length(0),
    })
    .strict(),
]);
const OwnerGameNoteEvidenceSchema = z.discriminatedUnion("state", [
  z
    .object({
      gameId: IdSchema,
      noteVersion: z.literal(0),
      state: z.literal("missing"),
      text: z.null(),
    })
    .strict(),
  z
    .object({
      gameId: IdSchema,
      noteVersion: z.number().int().safe().positive(),
      state: z.literal("present"),
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      gameId: IdSchema,
      noteVersion: z.number().int().safe().positive(),
      state: z.literal("cleared"),
      text: z.null(),
    })
    .strict(),
]);

/** The only serialized fields that may cross the Analyst evidence boundary. */
export const ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST = Object.freeze({
  manifestId: "collection-analyst-deterministic",
  manifestVersion: String(ANALYST_MANIFEST_VERSION),
  evidence: Object.freeze({
    "owner-game-note": OwnerGameNoteEvidenceSchema,
    "game-identity-ownership": z
      .object({
        gameId: IdSchema,
        displayName: z.string(),
        bggId: z.number().int().nullable(),
        ownershipState: z.enum(["owned", "previously-owned"]),
      })
      .strict(),
    "current-scoring": z
      .object({
        gameId: IdSchema,
        displayedFitness: z.number().nullable(),
        validatedBreakdown: z.array(FitnessBreakdownEntrySchema),
        veto: VetoSchema.nullable(),
        predictionStatus: PredictionSchema.nullable(),
        sourceState: z.enum(["available", "unavailable"]),
      })
      .strict(),
    "imported-metadata": z
      .object({
        gameId: IdSchema,
        name: z.string(),
        description: z.string().nullable(),
        categories: z.array(TagSchema),
        mechanics: z.array(TagSchema),
        families: z.array(TagSchema),
        subdomains: z.array(TagSchema),
        designers: z.array(TagSchema),
        artists: z.array(TagSchema),
        playerCounts: z
          .object({
            min: z.number().int().nullable(),
            max: z.number().int().nullable(),
            best: z.number().int().nullable(),
          })
          .strict(),
        playTime: z.number().nullable(),
        weight: z.number().nullable(),
        completeness: z
          .object({
            designer: z.enum(["complete", "refresh-needed", "unrefreshable"]),
            artist: z.enum(["complete", "refresh-needed", "unrefreshable"]),
            mechanic: z.enum(["complete", "refresh-needed", "unrefreshable"]),
          })
          .strict(),
        sourceTime: TimestampSchema.nullable(),
        refreshWarnings: z.array(RefreshWarningSchema),
      })
      .strict(),
    "play-acquisition": z
      .object({
        gameId: IdSchema,
        playCount: PlayCountSchema,
        acquisitionDate: TimestampSchema.nullable(),
        acquisitionPrice: AcquisitionPriceSchema.nullable(),
        source: z.string(),
        observedAt: TimestampSchema.nullable(),
        purchaseUtilization: PurchaseUtilizationSchema,
      })
      .strict(),
    "collection-structure": z
      .object({
        gameId: IdSchema,
        shelfAssignment: ShelfAssignmentSchema,
        redundancy: RedundancySchema.nullable(),
      })
      .strict(),
    "profile-evidence": ProfileEvidenceSchema,
  }),
});

export interface AnalystEvidencePageCursor {
  readonly snapshotFingerprint: string;
  readonly offset: number;
}
export interface AnalystEvidenceSource {
  readonly evidenceClass: AnalystEvidenceClass;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly citationId: string;
  readonly payload: unknown;
  readonly canonicalSummary: string;
  readonly observedAt?: string;
  readonly destination: {
    readonly operationId: "shelf.game.get" | "shelf.profile.get";
    readonly parameters: { readonly gameId?: string };
  };
}
export interface AnalystProjectionSnapshot {
  readonly collectionId: string;
  readonly collectionRevision: number;
  readonly snapshotFingerprint: string;
  readonly sources: readonly AnalystEvidenceSource[];
  page(
    cursor?: AnalystEvidencePageCursor | null,
    limit?: number,
  ): {
    readonly sources: readonly AnalystEvidenceSource[];
    readonly nextCursor: AnalystEvidencePageCursor | null;
    readonly totalSourceCount: number;
  };
}

function freeze<Value>(value: Value): Value {
  const copy = structuredClone(value);
  const visit = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null || Object.isFrozen(candidate)) return;
    Object.freeze(candidate);
    for (const child of Object.values(candidate)) visit(child);
  };
  visit(copy);
  return copy;
}
function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "variant" });
}
function tags(values: readonly { id: number; name: string }[]) {
  return [
    ...new Map(values.map((value) => [value.id, { id: value.id, name: value.name }])).values(),
  ].sort((a, b) => compareText(a.name, b.name) || a.id - b.id);
}
function source(
  evidenceClass: AnalystEvidenceSource["evidenceClass"],
  sourceId: string,
  sourceIdentity: unknown,
  payload: unknown,
  canonicalSummary: string,
  destination: AnalystEvidenceSource["destination"],
  observedAt?: string,
): AnalystEvidenceSource {
  const parsed = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[evidenceClass].parse(payload);
  const sourceVersion = canonicalSha256({ sourceIdentity, payload: parsed });
  return freeze({
    evidenceClass,
    sourceId,
    sourceVersion,
    citationId: `analyst:${evidenceClass}:${sourceId}:${sourceVersion.slice(0, 16)}`,
    payload: parsed,
    canonicalSummary,
    ...(observedAt === undefined ? {} : { observedAt }),
    destination,
  });
}
function shelfAssignment(game: Game, shelves: ShelfConfiguration): unknown {
  if (game.manualShelfId === null) return null;
  for (const unit of shelves.units) {
    const shelf = unit.shelves.find((entry) => entry.id === game.manualShelfId);
    if (shelf)
      return { shelfId: shelf.id, shelfName: shelf.name, unitId: unit.id, unitName: unit.name };
  }
  return { danglingShelfId: game.manualShelfId };
}
function purchaseUtilization(
  game: Game,
  score: DisplayedGameFitness["score"],
  collection: CollectionProfileCollectionSource,
) {
  const utilization = calculatePurchaseUtilization({
    acquisition: game.acquisition,
    entertainmentBenchmark: collection.entertainmentBenchmark,
    playCount: game.playCountEvidence,
    duration: resolveEffectivePlayingTime(game),
    playerRange: game.playerRangeEvidence,
    suggestedPlayerPoll: game.suggestedPlayerPoll,
    playerCountOverride: resolveEffectivePlayerCount(game, null),
    fitness: score === null ? null : projectFitnessScore(String(score.score)),
  });
  const component = (
    value: (typeof utilization.components)[keyof typeof utilization.components],
  ) => {
    if (value.outcome !== "calculated") {
      return { outcome: value.outcome, exact: null, wholePlays: null };
    }
    return {
      outcome: value.outcome,
      exact: "exact" in value.value ? value.value.exact : null,
      wholePlays: "wholePlays" in value.value ? value.value.wholePlays : null,
    };
  };
  return {
    outcome: utilization.outcome,
    reasons: utilization.reasons,
    costPerRecordedPlay: component(utilization.components.costPerRecordedPlay),
    modeledPlayerHours: component(utilization.components.modeledPlayerHours),
    valueMultiplier: component(utilization.components.valueMultiplier),
    valueRemaining: component(utilization.components.valueRemaining),
    estimatedAdditionalPlays: component(utilization.components.estimatedAdditionalPlays),
  };
}
function gameSources(
  game: Game,
  displayed: DisplayedGameFitness,
  shelves: ShelfConfiguration,
  collection: CollectionProfileCollectionSource,
): AnalystEvidenceSource[] {
  const destination = { operationId: "shelf.game.get" as const, parameters: { gameId: game.id } };
  const score = displayed.score;
  const metadata = game.bggData;
  const classes = game.entityMetadata;
  const sourceTime = metadata?.fetchedAt ?? null;
  return [
    source(
      "game-identity-ownership",
      `game:${game.id}:identity`,
      { gameId: game.id, collectionRevision: collection.revision },
      {
        gameId: game.id,
        displayName: game.name,
        bggId: game.bggId,
        ownershipState: game.ownership,
      },
      "Current game identity and ownership state",
      destination,
    ),
    source(
      "current-scoring",
      `game:${game.id}:scoring`,
      {
        gameId: game.id,
        collectionRevision: collection.revision,
        profileAlgorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
      },
      {
        gameId: game.id,
        displayedFitness: score?.score ?? null,
        validatedBreakdown:
          score?.breakdown.map((axis) => ({
            axisId: axis.axisId,
            axisName: axis.axisName,
            weight: axis.weight,
            contribution: axis.contribution,
            source: axis.source,
            derivedField: axis.derivedField,
            sourceValue: axis.sourceValue,
            scoringRawValue: axis.scoringRawValue,
            effectiveRating: axis.effectiveRating,
            preferenceShape: axis.preferenceShape,
            curveAffected: axis.curveAffected,
            unit: axis.unit,
            provenance: axis.provenance,
            configurationSummary: axis.configurationSummary,
            overridden: axis.overridden,
            overrideValue: axis.overrideValue,
            predictionConfidence: axis.predictionConfidence,
            referenceGames: axis.referenceGames,
          })) ?? [],
        veto: score?.vetoedBy ?? null,
        predictionStatus: score?.predictionMeta ?? null,
        sourceState: score === null ? "unavailable" : "available",
      },
      "Current validated scoring evidence",
      destination,
    ),
    source(
      "imported-metadata",
      `game:${game.id}:metadata`,
      {
        gameId: game.id,
        authorizedMetadata: {
          description: metadata?.description ?? null,
          categories: tags(metadata?.categories ?? []),
          mechanics: tags(metadata?.mechanics ?? []),
          families: tags(metadata?.families ?? []),
          subdomains: tags(metadata?.subdomains ?? []),
          designers: classes.designer.state === "complete" ? tags(classes.designer.entities) : [],
          artists: classes.artist.state === "complete" ? tags(classes.artist.entities) : [],
          playerCounts: { min: game.minPlayers, max: game.maxPlayers, best: game.bestPlayers },
          playTime: game.playingTime,
          weight: metadata?.weight ?? null,
          completeness: {
            designer: classes.designer.state,
            artist: classes.artist.state,
            mechanic: classes.mechanic.state,
          },
          sourceTime,
          refreshWarnings: [classes.designer, classes.artist, classes.mechanic].flatMap((entry) =>
            entry.refreshFailure === null ? [] : [entry.refreshFailure],
          ),
          observations: {
            mechanic: {
              state: classes.mechanic.state,
              observedAt:
                classes.mechanic.state === "complete" ? classes.mechanic.observedAt : null,
              refreshAttemptedAt: classes.mechanic.refreshFailure?.attemptedAt ?? null,
            },
            designer: {
              state: classes.designer.state,
              observedAt:
                classes.designer.state === "complete" ? classes.designer.observedAt : null,
              refreshAttemptedAt: classes.designer.refreshFailure?.attemptedAt ?? null,
            },
            artist: {
              state: classes.artist.state,
              observedAt: classes.artist.state === "complete" ? classes.artist.observedAt : null,
              refreshAttemptedAt: classes.artist.refreshFailure?.attemptedAt ?? null,
            },
          },
        },
      },
      {
        gameId: game.id,
        name: game.name,
        description: metadata?.description ?? null,
        categories: tags(metadata?.categories ?? []),
        mechanics: tags(metadata?.mechanics ?? []),
        families: tags(metadata?.families ?? []),
        subdomains: tags(metadata?.subdomains ?? []),
        designers: classes.designer.state === "complete" ? tags(classes.designer.entities) : [],
        artists: classes.artist.state === "complete" ? tags(classes.artist.entities) : [],
        playerCounts: { min: game.minPlayers, max: game.maxPlayers, best: game.bestPlayers },
        playTime: game.playingTime,
        weight: metadata?.weight ?? null,
        completeness: {
          designer: classes.designer.state,
          artist: classes.artist.state,
          mechanic: classes.mechanic.state,
        },
        sourceTime,
        refreshWarnings: [classes.designer, classes.artist, classes.mechanic].flatMap((entry) =>
          entry.refreshFailure === null ? [] : [entry.refreshFailure],
        ),
      },
      "Current validated imported metadata",
      destination,
      sourceTime ?? undefined,
    ),
    source(
      "play-acquisition",
      `game:${game.id}:play-acquisition`,
      { gameId: game.id, collectionRevision: collection.revision },
      {
        gameId: game.id,
        playCount: game.playCountEvidence,
        acquisitionDate: null,
        acquisitionPrice: game.acquisition.state === "purchase" ? game.acquisition.amount : null,
        source: game.playCountEvidence.source,
        observedAt: game.playCountEvidence.observedAt,
        purchaseUtilization: purchaseUtilization(game, score, collection),
      },
      "Current play and acquisition evidence",
      destination,
      game.playCountEvidence.observedAt ?? undefined,
    ),
    source(
      "collection-structure",
      `game:${game.id}:structure`,
      { gameId: game.id, collectionRevision: collection.revision },
      {
        gameId: game.id,
        shelfAssignment: shelfAssignment(game, shelves),
        redundancy: score?.redundancyAdjustment ?? null,
      },
      "Current collection structure evidence",
      destination,
    ),
  ];
}
function candidateConfounders(
  entityClass: CollectionProfileEntityClass,
  entity: CollectionProfile["identity"]["classes"][typeof entityClass]["entities"][number],
  gamesById: ReadonlyMap<string, Game>,
) {
  const occurrences = new Map<number, { name: string; gameIds: Set<string> }>();
  for (const evidence of entity.games) {
    const metadata = gamesById.get(evidence.gameId)?.entityMetadata[entityClass];
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

function profileSources(
  profile: CollectionProfile,
  gamesById: ReadonlyMap<string, Game>,
  collectionRevision: number,
): AnalystEvidenceSource[] {
  if (profile.status !== "available") return [];
  const activeIntentions = profile.attention.items.map(
    ({ intention, gameName, currentPlayEvidence }) => ({
      intentionId: intention.intentionId,
      gameId: intention.gameId,
      gameName,
      kind: intention.kind,
      baseline: intention.baseline,
      createdAt: intention.createdAt,
      version: intention.version,
      currentPlayEvidence,
    }),
  );
  const entityClasses: CollectionProfileEntityClass[] = ["mechanic", "designer", "artist"];
  return entityClasses.flatMap((entityClass) => {
    const result = profile.identity.classes[entityClass];
    const classLabel = `${entityClass[0].toUpperCase()}${entityClass.slice(1)} profile`;
    const classSummary = source(
      "profile-evidence",
      `profile:${entityClass}:summary`,
      {
        entityClass,
        entityId: null,
        collectionRevision,
        profileAlgorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
      },
      {
        entityClass,
        entityId: null,
        name: classLabel,
        entityAssociations: [],
        comparatorCohort: result.comparator,
        support: null,
        dispersion: null,
        supportingGames: [],
        exclusions: result.exclusions,
        activeIntentions,
        evidenceWarnings: result.refreshWarnings,
        confounders: [],
        associationNotPreference: true,
      },
      "Current deterministic Profile class summary evidence",
      { operationId: "shelf.profile.get", parameters: {} },
    );
    const entitySources = result.entities.map((entity) =>
      source(
        "profile-evidence",
        `profile:${entityClass}:${entity.entityId}`,
        {
          entityClass,
          entityId: entity.entityId,
          collectionRevision,
          profileAlgorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        },
        {
          entityClass,
          entityId: entity.entityId,
          name: entity.name,
          entityAssociations: entity.games,
          comparatorCohort: result.comparator,
          support: entity.support,
          dispersion: {
            populationStandardDeviation: entity.populationStandardDeviation,
            range: entity.range,
          },
          supportingGames: entity.games,
          exclusions: result.exclusions,
          activeIntentions,
          evidenceWarnings: result.refreshWarnings,
          confounders: candidateConfounders(entityClass, entity, gamesById),
          associationNotPreference: true,
        },
        "Current deterministic Profile evidence",
        { operationId: "shelf.profile.get", parameters: {} },
      ),
    );
    return [classSummary, ...entitySources];
  });
}

export function buildAnalystProjectionSnapshot(input: {
  collection: CollectionProfileCollectionSource;
  profile: CollectionProfile;
  displayedGames: readonly DisplayedGameFitness[];
  shelfConfiguration: ShelfConfiguration;
}): AnalystProjectionSnapshot {
  const collection = structuredClone(input.collection);
  const profile = createCollectionProfileSnapshotSchema(input.profile.entityPolicy).parse({
    source: collection,
    profile: structuredClone(input.profile),
  }).profile;
  const displayed = new Map(input.displayedGames.map((entry) => [entry.game.id, entry]));
  if (displayed.size !== collection.games.length)
    throw new Error("Analyst snapshot must contain every collection game exactly once");
  const gamesById = new Map(collection.games.map((game) => [game.id, game]));
  const profileEvidence =
    profile.status === "available" ? profileSources(profile, gamesById, collection.revision) : [];
  const sources = collection.games
    .slice()
    .sort((a, b) => compareText(a.id, b.id))
    .flatMap((game) => {
      const entry = displayed.get(game.id);
      if (!entry || canonicalSha256(entry.game) !== canonicalSha256(game))
        throw new Error(`Analyst fitness source mismatch for ${game.id}`);
      return gameSources(game, entry, input.shelfConfiguration, collection);
    })
    .concat(profileEvidence)
    .sort(
      (a, b) =>
        compareText(a.evidenceClass, b.evidenceClass) || compareText(a.sourceId, b.sourceId),
    );
  const snapshotFingerprint = canonicalSha256({
    collectionId: collection.id,
    collectionRevision: collection.revision,
    profileContractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
    profileAlgorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
    sources: sources.map(({ evidenceClass, sourceId, sourceVersion }) => ({
      evidenceClass,
      sourceId,
      sourceVersion,
    })),
  });
  const page = (cursor?: AnalystEvidencePageCursor | null, limit = 25) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Analyst page limit must be between 1 and 100");
    if (cursor && cursor.snapshotFingerprint !== snapshotFingerprint)
      throw new Error("Analyst page cursor belongs to a different snapshot");
    const offset = cursor?.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > sources.length)
      throw new Error("Analyst page cursor offset is invalid");
    const entries = sources.slice(offset, offset + limit);
    const next = offset + entries.length;
    return freeze({
      sources: entries,
      nextCursor: next < sources.length ? { snapshotFingerprint, offset: next } : null,
      totalSourceCount: sources.length,
    });
  };
  return Object.freeze({
    collectionId: collection.id,
    collectionRevision: collection.revision,
    snapshotFingerprint,
    sources: freeze(sources),
    page,
  });
}

export function createAnalystProjectionSnapshotService(deps: {
  storageService: StorageService;
  displayedFitnessService: DisplayedFitnessService;
  now?: () => string;
}) {
  const coordinator = profileSourceCoordinatorFor(deps.storageService);
  const profileService = createProfileService({
    storageService: deps.storageService,
    displayedFitnessService: deps.displayedFitnessService,
    now: deps.now,
  });
  return Object.freeze({
    capture: () =>
      coordinator.runExclusive(async () => {
        // Reuse the ordinary Profile path so a valid cache remains untouched and a
        // stale cache is recomputed and persisted exactly once under this turn lock.
        const profile = await profileService.getProfile();
        if (profile.status !== "available")
          throw new Error(`Analyst Profile is unavailable: ${profile.error.kind}`);
        const durable = await deps.storageService.loadCollection();
        const [tournament, predictionSettings, redundancySettings, shelfConfiguration] =
          await Promise.all([
            deps.storageService.loadTournament(),
            deps.storageService.loadPredictionSettings(),
            deps.storageService.loadRedundancySettings(),
            deps.storageService.loadShelfConfig(),
          ]);
        const collection = projectProfileCollectionSource(durable);
        const displayedGames = await deps.displayedFitnessService.listGamesFromSnapshot(
          { collection, tournament, predictionSettings, redundancySettings },
          { includePredicted: true },
        );
        return buildAnalystProjectionSnapshot({
          collection,
          profile,
          displayedGames,
          shelfConfiguration,
        });
      }),
  });
}
