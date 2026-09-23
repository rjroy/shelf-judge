import {
  ATTENTION_CANDIDATE_ARTIFACT_INDEX_VERSION,
  ATTENTION_CANDIDATE_ARTIFACT_SCHEMA_VERSION,
  AttentionCandidateArtifactSchema,
  type AttentionCandidateArtifact,
  type AttentionCandidateArtifactIdentity,
  type AttentionCandidateEvaluation,
  type Collection,
  type PredictionSettings,
  type RedundancySettings,
  type TournamentData,
} from "@shelf-judge/shared";
import type { ProfileSourceCoordinator } from "./profile-source-coordinator.js";
import type { DisplayedFitnessService } from "./displayed-fitness-service.js";
import {
  computeAttentionCandidates,
  evaluateAttentionStoredRule,
  type AttentionStoredRuleMatch,
} from "./attention-candidate-engine.js";
import {
  PURCHASE_UTILIZATION_PROJECTION_VERSION,
  projectPurchaseUtilization,
} from "./purchase-utilization-projection.js";
import { profileSourceIdentity, type ProfileSources } from "./profile-source-coordinator.js";
import {
  ATTENTION_RULE_CATALOG_VERSION,
  ATTENTION_RULE_DEPENDENCY_VERSION,
  attentionRuleCatalog,
} from "./attention-rule-catalog.js";
import { ATTENTION_CANDIDATE_CALCULATION_VERSION } from "./attention-candidate-engine.js";

export type AttentionMutationImpact =
  | { readonly kind: "games"; readonly gameIds: readonly string[] }
  | { readonly kind: "global"; readonly reason: AttentionGlobalMutationReason };
export type AttentionGlobalMutationReason =
  | "ownership"
  | "rating"
  | "axis"
  | "metadata"
  | "tournament"
  | "prediction"
  | "redundancy"
  | "feature-vector"
  | "purchase-benchmark"
  | "recovery";

export interface AttentionCandidateClock {
  now(): Date;
}
export interface AttentionCandidateStorage {
  loadAttentionCandidates(): Promise<AttentionCandidateArtifact | null>;
  saveAttentionCandidates(artifact: AttentionCandidateArtifact): Promise<void>;
  discardAttentionCandidates(): Promise<void>;
}

/** Narrows the optional artifact methods on the broad StorageService contract. */
export function attentionCandidateStorageFor(storage: {
  loadAttentionCandidates?: () => Promise<AttentionCandidateArtifact | null>;
  saveAttentionCandidates?: (artifact: AttentionCandidateArtifact) => Promise<void>;
  discardAttentionCandidates?: () => Promise<void>;
}): AttentionCandidateStorage {
  const load = storage.loadAttentionCandidates;
  const save = storage.saveAttentionCandidates;
  const discard = storage.discardAttentionCandidates;
  if (load === undefined || save === undefined || discard === undefined) {
    throw new Error("Attention candidate storage is not configured");
  }
  return {
    loadAttentionCandidates: () => load(),
    saveAttentionCandidates: (artifact) => save(artifact),
    discardAttentionCandidates: () => discard(),
  };
}
export interface AttentionCandidateSource {
  readonly collection: Collection;
  readonly identity: AttentionCandidateArtifactIdentity;
}
export interface AttentionCandidateOracleResult {
  readonly evaluations: readonly AttentionCandidateEvaluation[];
  readonly presentations: ReadonlyMap<
    string,
    {
      readonly reason: string;
      readonly question: string;
      readonly actions: readonly string[];
      readonly correctionDestination: string | null;
    }
  >;
}
export interface AttentionCandidateOracle<
  Source extends AttentionCandidateSource = AttentionCandidateSource,
> {
  evaluate(
    source: Source,
    evaluatedAt: string,
    targetGameIds?: readonly string[],
  ): Promise<AttentionCandidateOracleResult>;
}

export interface AttentionDispositionCompatibilityOracle<
  Source extends AttentionCandidateSource = AttentionCandidateSource,
> {
  evaluateStoredRules(
    source: Source,
    evaluatedAt: string,
    storedRules: readonly { readonly gameId: string; readonly ruleId: string }[],
  ): Promise<readonly AttentionStoredRuleMatch[]>;
}
export interface AttentionCandidateProductionSource extends AttentionCandidateSource {
  readonly tournament: TournamentData;
  readonly predictionSettings: PredictionSettings;
  readonly redundancySettings: RedundancySettings;
}

/**
 * Derives persisted reverse-index entries from the same catalog consumed by the
 * oracle. Current rules have only self-local dependencies; dormant-session
 * lookup additionally records every primary/additional BGG identity.
 */
export function productionAttentionCandidateDependenciesForGame(
  gameId: string,
  source: AttentionCandidateSource,
): {
  readonly localGameIds: readonly string[];
  readonly sourceKeys: readonly string[];
  readonly bggIds: readonly number[];
} {
  const game = source.collection.games.find((candidate) => candidate.id === gameId);
  if (game === undefined) return { localGameIds: [gameId], sourceKeys: [], bggIds: [] };
  const sourceKeys = attentionRuleCatalog.flatMap((rule) =>
    rule.dependencies.flatMap((dependency) =>
      dependency.scope === "source" ? [dependency.key] : [],
    ),
  );
  return {
    localGameIds: [gameId],
    sourceKeys: sortedUnique(sourceKeys),
    bggIds: [
      ...new Set(
        [game.bggId, ...(game.additionalBggIds ?? [])].filter((id): id is number => id !== null),
      ),
    ].sort((a, b) => a - b),
  };
}

export interface AttentionCandidateSourceGeneration {
  attentionCandidateSourceGeneration(): number;
}

/**
 * Builds the one production source snapshot used by candidate maintenance.
 * Keeping this at the service boundary prevents callers from accidentally
 * mixing independently-read collection/configuration values.
 */
export function createAttentionCandidateProductionSourceLoader(storage: {
  loadCollection(): Promise<Collection>;
  loadTournament(): Promise<TournamentData>;
  loadPredictionSettings(): Promise<PredictionSettings>;
  loadRedundancySettings(): Promise<RedundancySettings>;
}): () => Promise<AttentionCandidateProductionSource> {
  return async () => {
    const [collection, tournament, predictionSettings, redundancySettings] = await Promise.all([
      storage.loadCollection(),
      storage.loadTournament(),
      storage.loadPredictionSettings(),
      storage.loadRedundancySettings(),
    ]);
    const identity = profileSourceIdentity({
      collection,
      tournament,
      predictionSettings,
      redundancySettings,
    } satisfies ProfileSources);
    return {
      collection,
      tournament,
      predictionSettings,
      redundancySettings,
      identity: {
        ...identity,
        calculationVersion: ATTENTION_CANDIDATE_CALCULATION_VERSION,
        ruleCatalogVersion: ATTENTION_RULE_CATALOG_VERSION,
        dependencyVersion: ATTENTION_RULE_DEPENDENCY_VERSION,
        projectionVersion: PURCHASE_UTILIZATION_PROJECTION_VERSION,
        catalogRuleVersions: attentionRuleCatalog
          .map((rule) => ({
            ruleId: rule.id,
            ruleVersion: rule.version,
            scoringVersion: rule.scoringVersion,
          }))
          .sort((left, right) => left.ruleId.localeCompare(right.ruleId)),
      },
    };
  };
}

export function createAttentionCandidateService(
  deps: Omit<
    AttentionCandidateServiceDependencies<AttentionCandidateProductionSource>,
    "loadSource"
  > & {
    readonly loadSource?: () => Promise<AttentionCandidateProductionSource>;
    readonly productionStorage?: {
      loadCollection(): Promise<Collection>;
      loadTournament(): Promise<TournamentData>;
      loadPredictionSettings(): Promise<PredictionSettings>;
      loadRedundancySettings(): Promise<RedundancySettings>;
    } & Partial<AttentionCandidateSourceGeneration>;
  },
): AttentionCandidateService<AttentionCandidateProductionSource> {
  const loadSource =
    deps.loadSource ??
    (deps.productionStorage === undefined
      ? undefined
      : createAttentionCandidateProductionSourceLoader(deps.productionStorage));
  if (loadSource === undefined) throw new Error("Candidate source loader is required");
  return new AttentionCandidateService({
    coordinator: deps.coordinator,
    storage: deps.storage,
    clock: deps.clock,
    oracle: deps.oracle,
    dependenciesForGame: deps.dependenciesForGame,
    onMaintenanceError: deps.onMaintenanceError,
    recoveryRequired: deps.recoveryRequired,
    loadSource,
    sourceGeneration: deps.productionStorage?.attentionCandidateSourceGeneration?.bind(
      deps.productionStorage,
    ),
  });
}

/** Production-ready adapter: it delegates scoring to the accepted Phase 2 oracle. */
export function createAttentionCandidateOracle(
  displayedFitness: DisplayedFitnessService | (() => DisplayedFitnessService),
  dependencies: {
    readonly projectPurchaseUtilization?: typeof projectPurchaseUtilization;
  } = {},
): AttentionCandidateOracle<AttentionCandidateProductionSource> &
  AttentionDispositionCompatibilityOracle<AttentionCandidateProductionSource> {
  const project = dependencies.projectPurchaseUtilization ?? projectPurchaseUtilization;
  const fitnessService = () =>
    typeof displayedFitness === "function" ? displayedFitness() : displayedFitness;
  return {
    async evaluate(source, evaluatedAt, targetGameIds) {
      const fitness = await fitnessService().listGamesFromSnapshot(source, {
        includePredicted: true,
        targetGameIds,
      });
      const projections = new Map(
        fitness.map((entry) => [
          entry.game.id,
          project(entry, source.collection.entertainmentBenchmark),
        ]),
      );
      const result = computeAttentionCandidates({
        collection: source.collection,
        evaluatedAt,
        displayedFitness: fitness,
        purchaseUtilizationProjectionByGameId: projections,
        displayedFitnessSourceIdentity: source.identity,
        targetGameIds,
      });
      return {
        evaluations: result.evaluations,
        presentations: new Map(
          result.winners.map(({ gameId, presentation }) => [gameId, presentation]),
        ),
      };
    },
    async evaluateStoredRules(source, evaluatedAt, storedRules) {
      const targetGameIds = [...new Set(storedRules.map((stored) => stored.gameId))];
      const fitness = await fitnessService().listGamesFromSnapshot(source, {
        includePredicted: true,
        targetGameIds,
      });
      const projections = new Map(
        fitness.map((entry) => [
          entry.game.id,
          project(entry, source.collection.entertainmentBenchmark),
        ]),
      );
      const input = {
        collection: source.collection,
        evaluatedAt,
        displayedFitness: fitness,
        purchaseUtilizationProjectionByGameId: projections,
        displayedFitnessSourceIdentity: source.identity,
      };
      return storedRules.flatMap((stored) => {
        const match = evaluateAttentionStoredRule(input, stored.gameId, stored.ruleId);
        return match === null ? [] : [match];
      });
    },
  };
}
export interface AttentionCandidateServiceDependencies<
  Source extends AttentionCandidateSource = AttentionCandidateSource,
> {
  readonly coordinator: ProfileSourceCoordinator;
  readonly storage: AttentionCandidateStorage;
  readonly clock: AttentionCandidateClock;
  readonly loadSource: () => Promise<Source>;
  /** This seam owns canonical displayed-fitness and projection calculation. */
  readonly oracle: AttentionCandidateOracle<Source>;
  readonly dependenciesForGame?: (
    gameId: string,
    source: AttentionCandidateSource,
  ) => {
    readonly localGameIds: readonly string[];
    readonly sourceKeys: readonly string[];
    readonly bggIds: readonly number[];
  };
  /** Read-only, process-local source token used only by an already validated cache. */
  readonly sourceGeneration?: () => number;
  /** Test observer for the error intentionally converted to retryable unavailability. */
  readonly onMaintenanceError?: (error: unknown) => void;
  /** Durable disposition reconciliation must finish before candidates can publish. */
  readonly recoveryRequired?: () => boolean;
}

export type AttentionCandidateAvailability =
  | { readonly state: "available"; readonly artifact: AttentionCandidateArtifact }
  | { readonly state: "unavailable"; readonly retryable: true };

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
function instant(now: Date): string {
  return now.toISOString();
}
function sameIdentity(
  left: AttentionCandidateArtifactIdentity,
  right: AttentionCandidateArtifactIdentity,
): boolean {
  return (
    left.collectionId === right.collectionId &&
    left.collectionSchemaVersion === right.collectionSchemaVersion &&
    left.collectionRevision === right.collectionRevision &&
    left.tournamentHash === right.tournamentHash &&
    left.predictionSettingsHash === right.predictionSettingsHash &&
    left.redundancySettingsHash === right.redundancySettingsHash &&
    left.calculationVersion === right.calculationVersion &&
    left.ruleCatalogVersion === right.ruleCatalogVersion &&
    left.dependencyVersion === right.dependencyVersion &&
    left.projectionVersion === right.projectionVersion &&
    left.catalogRuleVersions.length === right.catalogRuleVersions.length &&
    left.catalogRuleVersions.every(
      (rule, index) =>
        rule.ruleId === right.catalogRuleVersions[index]?.ruleId &&
        rule.ruleVersion === right.catalogRuleVersions[index]?.ruleVersion &&
        rule.scoringVersion === right.catalogRuleVersions[index]?.scoringVersion,
    )
  );
}

function canRebaseCollectionRevision(
  artifact: AttentionCandidateArtifact,
  source: AttentionCandidateSource,
): boolean {
  const left = artifact.identity;
  const right = source.identity;
  return (
    left.collectionId === right.collectionId &&
    left.collectionSchemaVersion === right.collectionSchemaVersion &&
    left.tournamentHash === right.tournamentHash &&
    left.predictionSettingsHash === right.predictionSettingsHash &&
    left.redundancySettingsHash === right.redundancySettingsHash &&
    left.calculationVersion === right.calculationVersion &&
    left.ruleCatalogVersion === right.ruleCatalogVersion &&
    left.dependencyVersion === right.dependencyVersion &&
    left.projectionVersion === right.projectionVersion &&
    left.catalogRuleVersions.length === right.catalogRuleVersions.length &&
    left.catalogRuleVersions.every(
      (rule, index) =>
        rule.ruleId === right.catalogRuleVersions[index]?.ruleId &&
        rule.ruleVersion === right.catalogRuleVersions[index]?.ruleVersion &&
        rule.scoringVersion === right.catalogRuleVersions[index]?.scoringVersion,
    )
  );
}

function isCompleteForSource(
  artifact: AttentionCandidateArtifact,
  source: AttentionCandidateSource,
): boolean {
  const ownedGameIds = new Set(
    source.collection.games.filter((game) => game.ownership === "owned").map((game) => game.id),
  );
  return (
    artifact.rows.length === ownedGameIds.size &&
    artifact.rows.every((row) => ownedGameIds.delete(row.gameId)) &&
    ownedGameIds.size === 0
  );
}

export class AttentionCandidateService<
  Source extends AttentionCandidateSource = AttentionCandidateSource,
> {
  private cached: {
    readonly artifact: AttentionCandidateArtifact;
    readonly generation: number;
  } | null = null;

  constructor(private readonly dependencies: AttentionCandidateServiceDependencies<Source>) {}

  async ensureFresh(): Promise<AttentionCandidateAvailability> {
    if (this.dependencies.recoveryRequired?.()) return { state: "unavailable", retryable: true };
    const cached = this.cached;
    const generation = this.dependencies.sourceGeneration?.();
    const now = this.dependencies.clock.now();
    if (
      cached !== null &&
      generation !== undefined &&
      cached.generation === generation &&
      (cached.artifact.earliestBoundary === null ||
        Date.parse(cached.artifact.earliestBoundary) > now.getTime())
    )
      return { state: "available", artifact: cached.artifact };
    return this.dependencies.coordinator.runExclusive(async () => {
      try {
        if (this.dependencies.recoveryRequired?.())
          return { state: "unavailable", retryable: true };
        const source = await this.dependencies.loadSource();
        const loaded = await this.dependencies.storage.loadAttentionCandidates();
        const artifact = loaded === null ? null : AttentionCandidateArtifactSchema.parse(loaded);
        const now = instant(this.dependencies.clock.now());
        if (
          artifact !== null &&
          sameIdentity(artifact.identity, source.identity) &&
          isCompleteForSource(artifact, source) &&
          (artifact.earliestBoundary === null ||
            Date.parse(artifact.earliestBoundary) > Date.parse(now))
        ) {
          this.publishCache(artifact);
          return { state: "available", artifact };
        }
        return {
          state: "available",
          artifact: await this.maintainLocked(source, artifact, now, null, false),
        };
      } catch {
        this.cached = null;
        return { state: "unavailable", retryable: true };
      }
    });
  }

  async maintain(impact: AttentionMutationImpact): Promise<AttentionCandidateAvailability> {
    return this.dependencies.coordinator.runExclusive(async () => {
      try {
        const source = await this.dependencies.loadSource();
        const existing = await this.dependencies.storage.loadAttentionCandidates();
        const now = instant(this.dependencies.clock.now());
        const targets = impact.kind === "games" ? sortedUnique(impact.gameIds) : null;
        return {
          state: "available",
          artifact: await this.maintainLocked(
            source,
            existing,
            now,
            targets,
            impact.kind === "global",
          ),
        };
      } catch {
        return { state: "unavailable", retryable: true };
      }
    });
  }

  /** Fail closed after an authoritative source commit cannot be reconciled. */
  async invalidate(): Promise<void> {
    this.cached = null;
    try {
      await this.dependencies.storage.discardAttentionCandidates();
    } catch {
      // Freshness validation still prevents a stale artifact from publication.
    }
  }

  /** Rebase a previous collection revision after its durable commit. */
  async maintainAfterCollectionCommit(
    impact: AttentionMutationImpact,
  ): Promise<AttentionCandidateAvailability> {
    return this.dependencies.coordinator.runExclusive(async () => {
      try {
        const source = await this.dependencies.loadSource();
        const existing = await this.dependencies.storage.loadAttentionCandidates();
        const now = instant(this.dependencies.clock.now());
        const reusable =
          existing !== null &&
          canRebaseCollectionRevision(existing, source) &&
          isCompleteForSource(existing, source);
        const full = impact.kind === "global" || !reusable;
        const due = reusable
          ? existing.dueBuckets
              .filter((bucket) => Date.parse(bucket.boundary) <= Date.parse(now))
              .flatMap((bucket) => bucket.gameIds)
          : [];
        const targets =
          impact.kind === "games" ? this.expandTargets(existing, [...impact.gameIds, ...due]) : [];
        const evaluation =
          !full && targets.length === 0
            ? { evaluations: [], presentations: new Map() }
            : await this.dependencies.oracle.evaluate(source, now, full ? undefined : targets);
        const staged = this.buildArtifact(
          source,
          now,
          reusable && !full ? existing : null,
          evaluation,
          full ? undefined : targets,
        );
        const reread = await this.dependencies.loadSource();
        if (!sameIdentity(source.identity, reread.identity))
          throw new Error("Attention candidate source changed after collection commit");
        await this.dependencies.storage.saveAttentionCandidates(staged);
        this.publishCache(staged);
        return { state: "available", artifact: staged };
      } catch (error) {
        this.cached = null;
        this.dependencies.onMaintenanceError?.(error);
        try {
          await this.dependencies.storage.discardAttentionCandidates();
        } catch {
          // The disposable artifact is already gated by Profile freshness.
        }
        return { state: "unavailable", retryable: true };
      }
    });
  }

  private async maintainLocked(
    source: Source,
    existing: AttentionCandidateArtifact | null,
    now: string,
    requestedTargets: readonly string[] | null,
    forceFull: boolean,
    retries = 1,
  ): Promise<AttentionCandidateArtifact> {
    const validExisting =
      existing !== null &&
      sameIdentity(existing.identity, source.identity) &&
      isCompleteForSource(existing, source);
    const dueTargets = validExisting
      ? existing.dueBuckets
          .filter((bucket) => Date.parse(bucket.boundary) <= Date.parse(now))
          .flatMap((bucket) => bucket.gameIds)
      : [];
    const targets =
      requestedTargets === null
        ? dueTargets
        : this.expandTargets(existing, [...requestedTargets, ...dueTargets]);
    const full = forceFull || !validExisting;
    const evaluation = await this.dependencies.oracle.evaluate(
      source,
      now,
      full ? undefined : targets,
    );
    const staged = this.buildArtifact(
      source,
      now,
      validExisting && !full ? existing : null,
      evaluation,
      full ? undefined : targets,
    );
    const reread = await this.dependencies.loadSource();
    if (!sameIdentity(source.identity, reread.identity)) {
      if (retries === 0)
        throw new Error("Attention candidate source identity changed during maintenance");
      return this.maintainLocked(reread, null, now, null, true, retries - 1);
    }
    await this.dependencies.storage.saveAttentionCandidates(staged);
    this.publishCache(staged);
    return staged;
  }

  private publishCache(artifact: AttentionCandidateArtifact): void {
    const generation = this.dependencies.sourceGeneration?.();
    this.cached = generation === undefined ? null : { artifact, generation };
  }

  private expandTargets(
    existing: AttentionCandidateArtifact | null,
    targets: readonly string[],
  ): string[] {
    if (existing === null) return sortedUnique(targets);
    const dependents = new Map(
      existing.localDependencyIndex.map((entry) => [entry.gameId, entry.dependentGameIds]),
    );
    return sortedUnique([...targets, ...targets.flatMap((gameId) => dependents.get(gameId) ?? [])]);
  }

  private buildArtifact(
    source: Source,
    evaluatedAt: string,
    base: AttentionCandidateArtifact | null,
    result: AttentionCandidateOracleResult,
    targetGameIds?: readonly string[],
  ): AttentionCandidateArtifact {
    const ownedGameIds = new Set(
      source.collection.games.filter((game) => game.ownership === "owned").map((game) => game.id),
    );
    const expectedEvaluationIds =
      base === null
        ? ownedGameIds
        : new Set((targetGameIds ?? []).filter((gameId) => ownedGameIds.has(gameId)));
    const evaluationIds = result.evaluations.map((evaluation) => evaluation.gameId);
    if (
      evaluationIds.length !== new Set(evaluationIds).size ||
      evaluationIds.length !== expectedEvaluationIds.size ||
      evaluationIds.some((gameId) => !expectedEvaluationIds.has(gameId)) ||
      evaluationIds.some((gameId) => !ownedGameIds.has(gameId))
    )
      throw new Error("Candidate oracle results must exactly cover owned evaluation targets");
    const evaluations = new Map(
      result.evaluations.map((evaluation) => [evaluation.gameId, evaluation]),
    );
    const rows = new Map(base?.rows.map((row) => [row.gameId, row]) ?? []);
    for (const game of source.collection.games) {
      if (game.ownership !== "owned") {
        rows.delete(game.id);
        continue;
      }
      const evaluation = evaluations.get(game.id);
      if (!evaluation) continue;
      const dependencies = this.dependencies.dependenciesForGame?.(game.id, source) ?? {
        localGameIds: [game.id],
        sourceKeys: [],
        bggIds: [],
      };
      rows.set(game.id, {
        gameId: game.id,
        nameOrderingKey: game.name.normalize("NFC"),
        evaluation,
        winnerPresentation:
          evaluation.winner === null
            ? null
            : (() => {
                const presentation = result.presentations.get(game.id);
                return presentation === undefined
                  ? null
                  : {
                      reason: presentation.reason,
                      question: presentation.question,
                      actions: [...presentation.actions],
                      correctionDestination: presentation.correctionDestination,
                    };
              })(),
        nonClockFingerprint: evaluation.winner?.fingerprint ?? null,
        localDependencyGameIds: sortedUnique(dependencies.localGameIds),
        sourceDependencyKeys: sortedUnique(dependencies.sourceKeys),
        bggIds: [...new Set(dependencies.bggIds)].sort((a, b) => a - b),
      });
    }
    const completeRows = [...rows.values()].sort((a, b) => a.gameId.localeCompare(b.gameId));
    if (
      completeRows.length !==
      source.collection.games.filter((game) => game.ownership === "owned").length
    )
      throw new Error("Candidate oracle did not provide every owned game");
    const bucket = new Map<string, string[]>();
    const local = new Map<string, string[]>();
    const sourceKeys = new Map<string, string[]>();
    const bgg = new Map<number, string[]>();
    for (const row of completeRows) {
      if (row.evaluation.nextEvaluationBoundary !== null)
        bucket.set(row.evaluation.nextEvaluationBoundary, [
          ...(bucket.get(row.evaluation.nextEvaluationBoundary) ?? []),
          row.gameId,
        ]);
      for (const id of row.localDependencyGameIds)
        local.set(id, [...(local.get(id) ?? []), row.gameId]);
      for (const key of row.sourceDependencyKeys)
        sourceKeys.set(key, [...(sourceKeys.get(key) ?? []), row.gameId]);
      for (const id of row.bggIds) bgg.set(id, [...(bgg.get(id) ?? []), row.gameId]);
    }
    const dueBuckets = [...bucket]
      .map(([boundary, gameIds]) => ({ boundary, gameIds: sortedUnique(gameIds) }))
      .sort(
        (a, b) =>
          Date.parse(a.boundary) - Date.parse(b.boundary) || a.boundary.localeCompare(b.boundary),
      );
    return AttentionCandidateArtifactSchema.parse({
      schemaVersion: ATTENTION_CANDIDATE_ARTIFACT_SCHEMA_VERSION,
      indexVersion: ATTENTION_CANDIDATE_ARTIFACT_INDEX_VERSION,
      identity: source.identity,
      evaluatedAt,
      rows: completeRows,
      dueBuckets,
      earliestBoundary: dueBuckets[0]?.boundary ?? null,
      localDependencyIndex: [...local]
        .map(([gameId, dependentGameIds]) => ({
          gameId,
          dependentGameIds: sortedUnique(dependentGameIds),
        }))
        .sort((a, b) => a.gameId.localeCompare(b.gameId)),
      sourceDependencyIndex: [...sourceKeys]
        .map(([key, gameIds]) => ({ key, gameIds: sortedUnique(gameIds) }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      bggIdentityIndex: [...bgg]
        .map(([bggId, gameIds]) => ({ bggId, gameIds: sortedUnique(gameIds) }))
        .sort((a, b) => a.bggId - b.bggId),
    });
  }
}
