import type {
  Collection,
  CollectionProfileCollectionSource,
  GameWithScore,
  PredictionSettings,
  RedundancyAdjustment,
  RedundancySimilarityInfo,
  RedundancySettings,
  NicheSettings,
  TournamentData,
  SemanticScoringInputProof,
} from "@shelf-judge/shared";
import { CollectionSchema } from "@shelf-judge/shared";
import type { GameService } from "./game-service.js";
import { isBggDataStale } from "./game-service.js";
import type { PredictionService } from "./prediction-service.js";
import type { StorageService } from "./storage-service.js";
import { computeNichePositions } from "./niche-engine.js";
import {
  computeRedundancyAnalysis,
  type RedundancyPairTable,
  type RedundancySimilarityStatus,
} from "./redundancy-engine.js";
import { createRedundancyFactualContext } from "./redundancy-factual.js";
import type { SourceVector } from "./source-vector.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import { projectProfileCollectionSource } from "./game-projection.js";
import { buildJevPredictionCaptureIdentity } from "./jev-prediction-capture-identity.js";
import type { JevPairReadProofFence } from "./jev-pair-read-service.js";
import { JEV_ACTIVATION_COVERAGE_VERSION } from "./jev-pair-coverage.js";
import type {
  UnifiedScoringService,
  ProposedCollectionEvaluation,
} from "./unified-scoring-service.js";

export interface DisplayedGameFitness extends GameWithScore {
  hasPredictedContribution: boolean;
  hasScoringContribution: boolean;
}

export interface DisplayedFitnessOptions {
  includePredicted: boolean;
  includeNiches?: boolean;
  /** Limits returned work to owned games. Omitted retains the established full result. */
  targetGameIds?: readonly string[];
  /** Internal snapshot/profile status override; never sourced from provider/cache data. */
  redundancySimilarityStatus?: Exclude<RedundancySimilarityStatus, "ready">;
}

export interface DisplayedFitnessService {
  listGames(options: DisplayedFitnessOptions): Promise<DisplayedGameFitness[]>;
  listGamesFromSnapshot(
    snapshot: DisplayedFitnessSnapshot,
    options: DisplayedFitnessOptions,
  ): Promise<DisplayedGameFitness[]>;
}

/** Internal service surface for durable scoring-input consumers. */
export interface PrivateDisplayedFitnessService extends DisplayedFitnessService {
  /** Private persistence-authority API; never accepts a public/profile projection. */
  getScoringInputFromSnapshot(snapshot: PrivateDisplayedFitnessSnapshot): Promise<{
    semanticScoringInputProof: SemanticScoringInputProof;
    isCurrent(): boolean;
  }>;
  /** Returns displayed output together with the exact scoring-input proof it consumed. */
  listGamesFromSnapshotWithProof(
    snapshot: PrivateDisplayedFitnessSnapshot,
    options: DisplayedFitnessOptions,
  ): Promise<{
    games: DisplayedGameFitness[];
    semanticScoringInputProof: SemanticScoringInputProof;
    isCurrent(): boolean;
  }>;
  /** Internal implementation seam used to feed a previously captured private universe. */
  listSnapshotGames(
    snapshot: DisplayedFitnessSnapshot,
    options: DisplayedFitnessOptions,
    prepared?: PreparedScoringInput,
  ): Promise<DisplayedGameFitness[]>;
  evaluateProposedCollection?(
    proposal: ProposedCollectionEvaluation,
    options: DisplayedFitnessOptions,
  ): Promise<ProposedDisplayedFitnessEvaluation>;
}

export interface ProposedDisplayedFitnessEvaluation {
  readonly kind: "proposed-collection";
  readonly games: readonly DisplayedGameFitness[];
  accept<Value>(acceptSync: () => Value): Promise<Value | null>;
  assertBaseCurrent(): Promise<boolean>;
}

/** Public snapshots intentionally cannot carry private semantic state. */
export interface PublicDisplayedFitnessSnapshot {
  kind: "public";
  collection: CollectionProfileCollectionSource;
  tournament: TournamentData;
  predictionSettings: PredictionSettings;
  redundancySettings: RedundancySettings;
  nicheSettings?: NicheSettings;
}

/** A coherent private capture may validate semantic publications against its captured vector. */
export interface PrivateDisplayedFitnessSnapshot {
  kind: "private-capture";
  collection: Collection;
  sourceVector: SourceVector;
  tournament: TournamentData;
  predictionSettings: PredictionSettings;
  redundancySettings: RedundancySettings;
  nicheSettings?: NicheSettings;
}

export type DisplayedFitnessSnapshot =
  | PublicDisplayedFitnessSnapshot
  | PrivateDisplayedFitnessSnapshot;

export interface DisplayedFitnessServiceDeps {
  gameService: GameService;
  predictionService?: PredictionService;
  storageService?: StorageService;
  /** Validated-generation seam. Production does not configure this until Step 5 publication. */
  resolveRedundancyPairTable?: (input: {
    universe: readonly GameWithScore[];
    settings: RedundancySettings;
    /** Captured inputs for a pure resolver; no storage access is required. */
    collection: Collection;
    tournament: TournamentData;
    /** Captured authoritative prediction input and its semantic identity. */
    predictionSettings: PredictionSettings;
    predictionSettingsHash: string;
    /** Authoritative freshness vector for validating the publication. */
    sourceVector?: SourceVector;
  }) => RedundancyPairTable | undefined;
  /** One synchronous authoritative read; ready tables require a valid current proof fence. */
  resolveSemanticRead?: (input: {
    predictionCapture: readonly GameWithScore[];
    collection: Collection;
    tournament: TournamentData;
    predictionSettings: PredictionSettings;
    redundancySettings: RedundancySettings;
    factualWeights: RedundancySettings["componentWeights"];
    captureIdentity: import("./jev-pair-coverage.js").JevPredictionCaptureIdentity;
    sourceVector: SourceVector;
  }) => JevPairReadProofFence;
  unifiedScoringService?: UnifiedScoringService;
}

function semanticConfigured(collection: Collection, settings: RedundancySettings): boolean {
  const semantic = collection.semanticRedundancy;
  return (
    settings.enabled &&
    semantic?.settings.enabled === true &&
    (semantic.settings.weights.description > 0 || semantic.settings.weights.ownerNote > 0)
  );
}

function sameSource(left: SourceVector, right: SourceVector): boolean {
  return (
    left.collectionId === right.collectionId &&
    left.collectionSchemaVersion === right.collectionSchemaVersion &&
    left.collectionRevision === right.collectionRevision &&
    left.processEpoch === right.processEpoch &&
    left.changeToken === right.changeToken
  );
}

function verifiedSemanticTable(
  fence: JevPairReadProofFence | undefined,
): RedundancyPairTable | undefined {
  if (
    !fence ||
    typeof fence.isCurrent !== "function" ||
    !fence.proof ||
    fence.proof.status !== fence.result.status ||
    !fence.isCurrent()
  )
    return undefined;
  return "table" in fence.result && fence.result.table && fence.proof.status === fence.result.status
    ? fence.result.table
    : undefined;
}

export function semanticFallbackStatus(
  collection: {
    semanticRedundancy?: {
      settings: { enabled: boolean };
    };
  },
  factualEnabled: boolean,
): Exclude<RedundancySimilarityStatus, "ready"> {
  const semantic = collection.semanticRedundancy;
  if (!semantic?.settings.enabled) return factualEnabled ? "factual" : "disabled";
  // Embedded v9 generations are quarantined until the v10 pair cache exists.
  return "not-ready";
}

function currentProof(identity: string): SemanticScoringInputProof {
  return {
    version: 2,
    mode: "unified-similarity",
    algorithmVersion: "unified-jaccard-manhattan-jev-v1",
    identity,
    demandedPairsIdentity: canonicalSha256({ identity, demand: [] }),
    examinedComponentsIdentity: canonicalSha256({ identity, examined: [] }),
  };
}

function sourceKey(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => (entry === undefined ? null : entry));
}

function hasPredictedContribution(entry: GameWithScore): boolean {
  return (entry.score?.predictionMeta?.predictedAxisCount ?? 0) > 0;
}

function hasScoringContribution(entry: GameWithScore): boolean {
  return entry.score?.breakdown.some((axis) => axis.contribution !== null) ?? false;
}

function applyRedundancy(
  games: GameWithScore[],
  settings: RedundancySettings,
  collection: Pick<CollectionProfileCollectionSource, "games" | "axes">,
  tournamentData: TournamentData,
  universe?: GameWithScore[],
  pairTable?: RedundancyPairTable,
  fallbackStatus?: Exclude<RedundancySimilarityStatus, "ready">,
  allowFactualFallback = true,
): void {
  const computeGames = universe ?? games;
  const effectiveStatus =
    pairTable?.status === "not-ready" || pairTable?.status === "stale"
      ? pairTable.status
      : fallbackStatus;
  const analysis = redundancyAnalysis(
    computeGames,
    settings,
    collection,
    tournamentData,
    pairTable,
    effectiveStatus,
    allowFactualFallback,
  );
  applyAdjustments(games, settings, analysis.adjustments);
  applySimilarityInfo(games, analysis.similarityInfo, analysis.defaultSimilarityInfo);
}

function redundancyAnalysis(
  computeGames: readonly GameWithScore[],
  settings: RedundancySettings,
  collection: Pick<CollectionProfileCollectionSource, "games" | "axes">,
  tournamentData: TournamentData,
  pairTable?: RedundancyPairTable,
  fallbackStatus?: Exclude<RedundancySimilarityStatus, "ready">,
  allowFactualFallback = true,
) {
  // Factual similarity intentionally excludes personal/tournament axes. Sharing the
  // same context factory keeps pair-table validation aligned with display scoring.
  void tournamentData;
  const factualContext = createRedundancyFactualContext(
    collection.games,
    settings.componentWeights,
  );
  const getFeatureVector = (game: Parameters<typeof factualContext.getFeatureVector>[0]) =>
    factualContext.getFeatureVector(game);

  const effectiveStatus =
    pairTable?.status === "not-ready" || pairTable?.status === "stale"
      ? pairTable.status
      : fallbackStatus;
  return computeRedundancyAnalysis(
    [...computeGames],
    settings,
    getFeatureVector,
    pairTable,
    effectiveStatus,
    allowFactualFallback,
  );
}

function applySimilarityInfo(
  games: GameWithScore[],
  info: Map<string, RedundancySimilarityInfo>,
  defaultInfo: RedundancySimilarityInfo,
): void {
  for (const entry of games) {
    if (!entry.score) continue;
    entry.score.redundancySimilarityInfo = info.get(entry.game.id) ?? defaultInfo;
  }
}

function applyAdjustments(
  games: GameWithScore[],
  settings: RedundancySettings,
  adjustments: Map<string, RedundancyAdjustment>,
): void {
  for (const entry of games) {
    if (!entry.score) continue;
    const adjustment = adjustments.get(entry.game.id) ?? null;
    entry.score.redundancyAdjustment = adjustment;
    if (adjustment && settings.stage === "integrated") {
      entry.score.score = adjustment.adjustedScore;
    }
  }
}

/** Owned pre-redundancy predicted universe used by niche ranking and adjustments. */
export function ownedPredictedCandidates(entries: readonly GameWithScore[]): GameWithScore[] {
  return entries.filter((entry) => entry.game.ownership !== "previously-owned");
}

/** Apply one universe's adjustments to a separate score projection without mutating source scores. */
export function withRedundancyAdjustments(
  entries: readonly GameWithScore[],
  settings: RedundancySettings,
  collection: Pick<CollectionProfileCollectionSource, "games" | "axes">,
  tournamentData: TournamentData,
  universe: readonly GameWithScore[] = entries,
  pairTable?: RedundancyPairTable,
  fallbackStatus?: Exclude<RedundancySimilarityStatus, "ready">,
  allowFactualFallback = true,
): GameWithScore[] {
  const analysis = redundancyAnalysis(
    universe,
    settings,
    collection,
    tournamentData,
    pairTable,
    fallbackStatus,
    allowFactualFallback,
  );
  return withRedundancyMaps(
    entries,
    settings,
    analysis.adjustments,
    analysis.similarityInfo,
    analysis.defaultSimilarityInfo,
  );
}

/** Compute the owned predicted universe once and apply it to both score variants. */
export function withRedundancyAdjustmentsForVariants(
  ordinaryEntries: readonly GameWithScore[],
  predictedEntries: readonly GameWithScore[],
  settings: RedundancySettings,
  collection: Pick<CollectionProfileCollectionSource, "games" | "axes">,
  tournamentData: TournamentData,
  universe: readonly GameWithScore[],
  pairTable?: RedundancyPairTable,
  fallbackStatus?: Exclude<RedundancySimilarityStatus, "ready">,
  allowFactualFallback = true,
): { ordinary: GameWithScore[]; predicted: GameWithScore[] } {
  const analysis = redundancyAnalysis(
    universe,
    settings,
    collection,
    tournamentData,
    pairTable,
    fallbackStatus,
    allowFactualFallback,
  );
  return {
    ordinary: withRedundancyMaps(
      ordinaryEntries,
      settings,
      analysis.adjustments,
      analysis.similarityInfo,
      analysis.defaultSimilarityInfo,
    ),
    predicted: withRedundancyMaps(
      predictedEntries,
      settings,
      analysis.adjustments,
      analysis.similarityInfo,
      analysis.defaultSimilarityInfo,
    ),
  };
}

function withRedundancyMaps(
  entries: readonly GameWithScore[],
  settings: RedundancySettings,
  adjustments: Map<string, RedundancyAdjustment>,
  similarityInfo: Map<string, RedundancySimilarityInfo>,
  defaultSimilarityInfo: RedundancySimilarityInfo,
): GameWithScore[] {
  const projected = entries.map((entry) => ({
    ...entry,
    score: entry.score === null ? null : { ...entry.score },
  }));
  applyAdjustments(projected, settings, adjustments);
  applySimilarityInfo(projected, similarityInfo, defaultSimilarityInfo);
  return projected;
}

function targetIds(options: DisplayedFitnessOptions): readonly string[] | undefined {
  return options.targetGameIds === undefined
    ? undefined
    : [...new Set(options.targetGameIds)].sort();
}

function targetEntries(
  entries: GameWithScore[],
  targets: readonly string[] | undefined,
): GameWithScore[] {
  if (targets === undefined) return entries;
  const requested = new Set(targets);
  return entries.filter(
    (entry) => entry.game.ownership !== "previously-owned" && requested.has(entry.game.id),
  );
}

type PreparedScoringInput = {
  capture: GameWithScore[];
  table?: RedundancyPairTable;
  proof: SemanticScoringInputProof;
  fence?: JevPairReadProofFence;
};

export function createDisplayedFitnessService(
  deps: DisplayedFitnessServiceDeps,
): PrivateDisplayedFitnessService {
  const {
    gameService,
    predictionService,
    storageService,
    resolveRedundancyPairTable,
    resolveSemanticRead,
    unifiedScoringService,
  } = deps;

  async function calculateUnifiedSnapshot(snapshot: DisplayedFitnessSnapshot) {
    if (!unifiedScoringService) throw new Error("Unified scoring is not configured");
    for (let attempt = 0; attempt < 2; attempt++) {
      const frame = await unifiedScoringService.capture();
      if (
        (snapshot.kind === "private-capture"
          ? !sameSource(snapshot.sourceVector, frame.sourceVector) ||
            canonicalSha256(CollectionSchema.parse(snapshot.collection)) !==
              canonicalSha256(frame.sources.collection)
          : canonicalSha256(snapshot.collection) !==
            canonicalSha256(projectProfileCollectionSource(frame.sources.collection))) ||
        sourceKey(frame.sources.tournament) !== sourceKey(snapshot.tournament) ||
        sourceKey(frame.sources.predictionSettings) !== sourceKey(snapshot.predictionSettings) ||
        sourceKey(frame.redundancySettings) !== sourceKey(snapshot.redundancySettings)
      )
        throw new Error(
          `Displayed fitness snapshot differs from current capture: ${[
            sourceKey(
              snapshot.kind === "private-capture"
                ? frame.sources.collection
                : projectProfileCollectionSource(frame.sources.collection),
            ) !== sourceKey(snapshot.collection) && "collection",
            sourceKey(frame.sources.tournament) !== sourceKey(snapshot.tournament) && "tournament",
            sourceKey(frame.sources.predictionSettings) !==
              sourceKey(snapshot.predictionSettings) && "prediction-settings",
            sourceKey(frame.redundancySettings) !== sourceKey(snapshot.redundancySettings) &&
              "redundancy-settings",
          ]
            .filter(Boolean)
            .join(",")}`,
        );
      const calculation = unifiedScoringService.calculate(
        frame,
        { scope: "collection-all" },
        { includeRedundancy: true },
      );
      const current = await unifiedScoringService.publishCurrent(calculation, () => true);
      if (current) return { frame, calculation };
    }
    throw new Error("Displayed fitness snapshot changed before publication");
  }

  function unifiedDisplayedGames(
    collection: Collection,
    redundancySettings: RedundancySettings,
    calculation: import("./unified-scoring-service.js").UnifiedCalculation,
    options: DisplayedFitnessOptions,
    outputCollection: Collection | CollectionProfileCollectionSource = collection,
  ): DisplayedGameFitness[] {
    const targets = targetIds(options);
    const requested = targets === undefined ? null : new Set(targets);
    const scores = options.includePredicted
      ? calculation.collectionFitness
      : calculation.actualFitness;
    const outputGames = new Map(outputCollection.games.map((game) => [game.id, game]));
    const entries: DisplayedGameFitness[] = collection.games
      .filter((game) => requested === null || requested.has(game.id))
      .map((game) => {
        const outputGame = outputGames.get(game.id);
        if (!outputGame)
          throw new Error("Displayed fitness output source is missing a scored game");
        const score = scores.get(game.id) ?? null;
        if (score === null)
          return {
            game: outputGame,
            score: null,
            bggDataStale: isBggDataStale(game),
            hasPredictedContribution: false,
            hasScoringContribution: false,
          };
        const current = structuredClone(score);
        const adjustment = calculation.redundancyAdjustments.get(game.id) ?? null;
        current.redundancyAdjustment = adjustment;
        current.redundancySimilarityInfo = {
          status: calculation.redundancySimilarityStatus(game.id),
          generationId: null,
        };
        if (adjustment && redundancySettings.stage === "integrated")
          current.score = adjustment.adjustedScore;
        return {
          game: outputGame,
          score: current,
          bggDataStale: isBggDataStale(game),
          hasPredictedContribution: hasPredictedContribution({ game, score: current }),
          hasScoringContribution: hasScoringContribution({ game, score: current }),
        };
      });
    if (options.includeNiches) {
      const nicheMap = computeNichePositions(
        entries.filter((entry) => entry.game.ownership !== "previously-owned"),
      );
      for (const entry of entries) entry.nichePosition = nicheMap.get(entry.game.id) ?? null;
    }
    return entries.sort((left, right) => {
      if (left.score !== null && right.score !== null) return right.score.score - left.score.score;
      if (left.score !== null) return -1;
      if (right.score !== null) return 1;
      return 0;
    });
  }

  function evaluateProposedCollection(
    proposal: ProposedCollectionEvaluation,
    options: DisplayedFitnessOptions,
  ): Promise<ProposedDisplayedFitnessEvaluation> {
    if (!unifiedScoringService || proposal.kind !== "proposed-collection")
      throw new Error("Proposed collection scoring is unavailable");
    const targets = targetIds(options);
    const calculation = proposal.calculate(
      targets === undefined
        ? { scope: "collection-all" }
        : { scope: "collection-targets", targetIds: targets },
      { includeRedundancy: true },
    );
    const games = unifiedDisplayedGames(
      proposal.collection,
      proposal.redundancySettings,
      calculation,
      options,
    );
    return Promise.resolve(
      Object.freeze({
        kind: "proposed-collection" as const,
        games: Object.freeze(games),
        accept: <Value>(acceptSync: () => Value) => proposal.accept(calculation, acceptSync),
        assertBaseCurrent: () => proposal.assertBaseCurrent(),
      }),
    );
  }

  // This cache is deliberately private and singular. The token is part of the key (unlike the
  // durable identity) so a staged same-revision collection cannot borrow a persisted capture.
  let scoringMemo:
    | {
        key: string;
        capture: GameWithScore[];
        table?: RedundancyPairTable;
        proof: SemanticScoringInputProof;
        fence?: JevPairReadProofFence;
        vector: SourceVector;
        semanticConfigured: boolean;
      }
    | undefined;

  async function captureScoringInput(snapshot: PrivateDisplayedFitnessSnapshot) {
    const collection = structuredClone(snapshot.collection);
    const vector = snapshot.sourceVector;
    const current = storageService?.sourceVector?.();
    if (
      !vector.available ||
      !current?.available ||
      !sameSource(vector, current) ||
      vector.collectionId !== collection.id ||
      vector.collectionRevision !== collection.revision ||
      vector.collectionSchemaVersion !== collection.schemaVersion
    ) {
      throw new Error("Displayed fitness scoring input is unavailable or stale");
    }
    const configured = semanticConfigured(collection, snapshot.redundancySettings);
    const mode = configured
      ? "semantic"
      : snapshot.redundancySettings.enabled
        ? "factual-only"
        : "disabled";
    const memoSource = {
      collection,
      tournament: snapshot.tournament,
      predictionSettings: snapshot.predictionSettings,
      redundancySettings: snapshot.redundancySettings,
      mode,
    };
    const key = canonicalSha256({
      ...memoSource,
      ...(configured ? { processEpoch: vector.processEpoch, changeToken: vector.changeToken } : {}),
    });
    if (scoringMemo?.key === key) {
      if (!configured) {
        // The durable inactive identity is process-independent. Refresh only the current-source
        // fence while reusing its already-complete local prediction capture.
        scoringMemo = { ...scoringMemo, vector };
        return scoringMemo;
      }
      if (scoringMemo.fence?.reusable === true && scoringMemo.fence.isCurrent()) return scoringMemo;
    }
    let proof: SemanticScoringInputProof;
    if (!predictionService?.listGamesWithPredictionsFromSnapshot)
      throw new Error("Complete scoring prediction capture is unavailable");
    const capture = await predictionService.listGamesWithPredictionsFromSnapshot(
      projectProfileCollectionSource(collection),
      structuredClone(snapshot.tournament),
      structuredClone(snapshot.predictionSettings),
    );
    const afterCapture = storageService?.sourceVector?.();
    if (!afterCapture?.available || !sameSource(vector, afterCapture))
      throw new Error("Displayed fitness scoring input changed during prediction capture");
    let table: RedundancyPairTable | undefined;
    let fence: JevPairReadProofFence | undefined;
    if (!configured) {
      const inactiveMode = snapshot.redundancySettings.enabled ? "factual-only" : "disabled";
      proof = currentProof(
        canonicalSha256({
          domain: "semantic-scoring-input-v1",
          mode: inactiveMode,
          collection: {
            id: collection.id,
            schemaVersion: collection.schemaVersion,
            axes: collection.axes,
            games: collection.games.map((game) =>
              Object.fromEntries(Object.entries(game).filter(([key]) => key !== "entityMetadata")),
            ),
          },
          tournament: snapshot.tournament,
          predictionSettings: snapshot.predictionSettings,
          redundancy: {
            enabled: snapshot.redundancySettings.enabled,
            componentWeights: snapshot.redundancySettings.componentWeights,
          },
        }),
      );
    } else {
      if (!resolveSemanticRead) throw new Error("Semantic scoring input proof is unavailable");
      const identity = buildJevPredictionCaptureIdentity({
        collection,
        sourceVector: vector,
        tournament: snapshot.tournament,
        predictionSettings: snapshot.predictionSettings,
        factualWeights: snapshot.redundancySettings.componentWeights,
        predictionCapture: capture,
      });
      if (!identity.ok) throw new Error("Semantic scoring input capture is incoherent");
      fence = resolveSemanticRead({
        predictionCapture: capture,
        collection,
        tournament: snapshot.tournament,
        predictionSettings: snapshot.predictionSettings,
        redundancySettings: snapshot.redundancySettings,
        factualWeights: snapshot.redundancySettings.componentWeights,
        captureIdentity: identity.identity,
        sourceVector: vector,
      });
      if (
        !fence ||
        fence.reusable !== true ||
        !fence.proof ||
        fence.proof.status !== fence.result.status ||
        !fence.isCurrent()
      )
        throw new Error("Semantic scoring input proof is unavailable or stale");
      const semanticStatus = fence.result.status;
      const coverageIdentity =
        "identity" in fence.proof
          ? fence.proof.identity
          : "table" in fence.result
            ? fence.result.table?.identity.generationId
            : undefined;
      if (!coverageIdentity) throw new Error("Semantic scoring input identity is unavailable");
      if (
        !(
          semanticStatus === "ready" ||
          semanticStatus === "partial" ||
          semanticStatus === "factual" ||
          semanticStatus === "not-ready"
        )
      )
        throw new Error("Semantic scoring input status is unavailable");
      proof = {
        version: 2,
        mode: "unified-similarity",
        algorithmVersion: "unified-jaccard-manhattan-jev-v1",
        identity: canonicalSha256({ coverageIdentity, semanticStatus }),
        demandedPairsIdentity: canonicalSha256({ coverageIdentity, domain: "legacy-demand" }),
        examinedComponentsIdentity: canonicalSha256({
          coverageIdentity,
          coverageVersion: JEV_ACTIVATION_COVERAGE_VERSION,
        }),
      };
      if ("table" in fence.result) table = fence.result.table;
    }
    const result = { key, capture, table, proof, fence, vector, semanticConfigured: configured };
    scoringMemo = result;
    return result;
  }

  function isCapturedCurrent(captured: Awaited<ReturnType<typeof captureScoringInput>>): boolean {
    try {
      const current = storageService?.sourceVector?.();
      return (
        current !== undefined &&
        current.available &&
        sameSource(captured.vector, current) &&
        (!captured.semanticConfigured ||
          (captured.fence?.reusable === true && captured.fence.isCurrent()))
      );
    } catch {
      return false;
    }
  }

  return {
    evaluateProposedCollection,
    async getScoringInputFromSnapshot(snapshot): Promise<{
      semanticScoringInputProof: SemanticScoringInputProof;
      isCurrent(): boolean;
    }> {
      if (unifiedScoringService) {
        const { calculation } = await calculateUnifiedSnapshot(snapshot);
        return {
          semanticScoringInputProof: structuredClone(calculation.proof),
          isCurrent: () => calculation.isCurrent(),
        };
      }
      const captured = await captureScoringInput(snapshot);
      return {
        semanticScoringInputProof: structuredClone(captured.proof),
        isCurrent: () => isCapturedCurrent(captured),
      };
    },

    async listGamesFromSnapshotWithProof(snapshot, options) {
      if (unifiedScoringService) {
        const { frame, calculation } = await calculateUnifiedSnapshot(snapshot);
        const result = await unifiedScoringService.publishCurrent(calculation, () => ({
          games: unifiedDisplayedGames(
            frame.sources.collection,
            frame.redundancySettings,
            calculation,
            options,
            snapshot.kind === "private-capture" ? frame.sources.collection : snapshot.collection,
          ),
          semanticScoringInputProof: structuredClone(calculation.proof),
          isCurrent: () => calculation.isCurrent(),
        }));
        if (!result) throw new Error("Displayed fitness changed before publication");
        return result;
      }
      const captured = await captureScoringInput(snapshot);
      const beforeScoring = storageService?.sourceVector?.();
      if (
        !beforeScoring?.available ||
        !sameSource(captured.vector, beforeScoring) ||
        (captured.semanticConfigured &&
          (captured.fence?.reusable !== true || !captured.fence.isCurrent()))
      )
        throw new Error("Displayed fitness scoring input changed before snapshot calculation");
      const games = await (
        this as unknown as {
          listSnapshotGames(
            snapshot: PrivateDisplayedFitnessSnapshot,
            options: DisplayedFitnessOptions,
            prepared: PreparedScoringInput,
          ): Promise<DisplayedGameFitness[]>;
        }
      ).listSnapshotGames(snapshot, options, captured);
      const current = storageService?.sourceVector?.();
      if (
        !current?.available ||
        !sameSource(captured.vector, current) ||
        (captured.semanticConfigured &&
          (captured.fence?.reusable !== true || !captured.fence.isCurrent()))
      )
        throw new Error("Displayed fitness scoring input changed during snapshot calculation");
      return {
        games,
        semanticScoringInputProof: structuredClone(captured.proof),
        isCurrent: () => isCapturedCurrent(captured),
      };
    },

    async listGames(options): Promise<DisplayedGameFitness[]> {
      if (unifiedScoringService) {
        const frame = await unifiedScoringService.capture();
        const targets = targetIds(options);
        const calculation = unifiedScoringService.calculate(
          frame,
          targets === undefined
            ? { scope: "collection-all" }
            : { scope: "collection-targets", targetIds: targets },
          { includeRedundancy: true },
        );
        const current = await unifiedScoringService.publishCurrent(calculation, () => {
          const sourceScores = options.includePredicted
            ? calculation.collectionFitness
            : calculation.actualFitness;
          const requested = targets === undefined ? null : new Set(targets);
          const projected: DisplayedGameFitness[] = frame.sources.collection.games
            .filter(
              (game) =>
                game.ownership !== "previously-owned" && (!requested || requested.has(game.id)),
            )
            .map((game) => {
              const score = sourceScores.get(game.id) ?? null;
              if (score === null)
                return {
                  game,
                  score: null,
                  bggDataStale: isBggDataStale(game),
                  hasPredictedContribution: false,
                  hasScoringContribution: false,
                };
              const adjustment = calculation.redundancyAdjustments.get(game.id) ?? null;
              const output = structuredClone(score);
              output.redundancyAdjustment = adjustment;
              output.redundancySimilarityInfo = {
                status: calculation.redundancySimilarityStatus(game.id),
                generationId: null,
              };
              if (adjustment && frame.redundancySettings.stage === "integrated")
                output.score = adjustment.adjustedScore;
              return {
                game,
                score: output,
                bggDataStale: isBggDataStale(game),
                hasPredictedContribution: hasPredictedContribution({ game, score: output }),
                hasScoringContribution: hasScoringContribution({ game, score: output }),
              };
            });
          if (options.includeNiches) {
            const nicheMap = computeNichePositions(
              projected.filter((entry) => entry.game.ownership !== "previously-owned"),
            );
            for (const entry of projected)
              entry.nichePosition = nicheMap.get(entry.game.id) ?? null;
          }
          return projected.sort((left, right) => {
            if (left.score !== null && right.score !== null)
              return right.score.score - left.score.score;
            if (left.score !== null) return -1;
            if (right.score !== null) return 1;
            return 0;
          });
        });
        if (current === null)
          throw new Error("Displayed fitness sources changed before publication");
        return current;
      }
      const initialSourceVector = storageService?.sourceVector?.();
      const targets = targetIds(options);
      let predictedGames: GameWithScore[] | undefined;
      const getPredictedGames = async (
        targetGameIds?: readonly string[],
      ): Promise<GameWithScore[]> => {
        if (!predictionService) return gameService.listGames();
        if (targetGameIds === undefined) {
          predictedGames ??= await predictionService.listGamesWithPredictions();
          return predictedGames;
        }
        return predictionService.listGamesWithPredictions(targetGameIds);
      };

      const completeGames =
        options.includePredicted && predictionService
          ? await getPredictedGames(targets)
          : await gameService.listGames();
      const allGames = targetEntries(completeGames, targets);
      const ownedGames = allGames.filter((entry) => entry.game.ownership !== "previously-owned");

      if (options.includeNiches && predictionService) {
        const nicheSettings = storageService ? await storageService.loadNicheSettings() : undefined;
        const nicheUniverse = options.includePredicted
          ? targets === undefined
            ? ownedGames
            : (await getPredictedGames()).filter(
                (entry) => entry.game.ownership !== "previously-owned",
              )
          : (await getPredictedGames()).filter(
              (entry) => entry.game.ownership !== "previously-owned",
            );
        const nicheMap = computeNichePositions(nicheUniverse, nicheSettings);
        for (const entry of allGames) {
          entry.nichePosition = nicheMap.get(entry.game.id) ?? null;
        }
      }

      if (storageService) {
        const redundancySettings = await storageService.loadRedundancySettings();
        const predictionSettings = await storageService
          .loadPredictionSettings()
          .catch(() => undefined);
        const universe =
          (!options.includePredicted || targets !== undefined) && predictionService
            ? (await getPredictedGames()).filter(
                (entry) => entry.game.ownership !== "previously-owned",
              )
            : undefined;
        const collection = await storageService.loadCollection();
        const tournament = redundancySettings.enabled
          ? await storageService.loadTournament()
          : {
              settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
              sessions: [],
              gameStats: {},
            };
        let semanticCapture: GameWithScore[] | undefined;
        const configured = semanticConfigured(collection, redundancySettings);
        if (configured && predictionService) {
          try {
            semanticCapture = await getPredictedGames();
          } catch {
            semanticCapture = undefined;
          }
        }
        const pairUniverse = universe ?? ownedGames;
        const eligiblePairUniverse = pairUniverse.filter(
          ({ score }) => score !== null && !score.vetoed && score.score > 0,
        );
        const vectorAfter = storageService.sourceVector?.();
        const coherentCapture =
          predictionSettings !== undefined &&
          initialSourceVector !== undefined &&
          vectorAfter !== undefined &&
          initialSourceVector.processEpoch === vectorAfter.processEpoch &&
          initialSourceVector.changeToken === vectorAfter.changeToken &&
          vectorAfter.available;
        let pairTable: RedundancyPairTable | undefined;
        let semanticStatus: Exclude<RedundancySimilarityStatus, "ready"> | undefined;
        if (configured) {
          semanticStatus = "not-ready";
          if (coherentCapture && semanticCapture && resolveSemanticRead && vectorAfter) {
            const identity = buildJevPredictionCaptureIdentity({
              collection,
              sourceVector: vectorAfter,
              tournament,
              predictionSettings,
              factualWeights: redundancySettings.componentWeights,
              predictionCapture: semanticCapture,
            });
            if (identity.ok) {
              try {
                const fence = resolveSemanticRead({
                  predictionCapture: semanticCapture,
                  collection,
                  tournament,
                  predictionSettings,
                  redundancySettings,
                  factualWeights: redundancySettings.componentWeights,
                  captureIdentity: identity.identity,
                  sourceVector: vectorAfter,
                });
                const verified = verifiedSemanticTable(fence);
                pairTable = verified;
                semanticStatus = verified
                  ? undefined
                  : fence?.proof?.status !== undefined && fence.proof.status !== "ready"
                    ? fence.proof.status
                    : "not-ready";
              } catch {
                semanticStatus = "not-ready";
              }
            }
          }
        } else if (redundancySettings.enabled && coherentCapture) {
          const legacyTable = resolveRedundancyPairTable?.({
            universe: eligiblePairUniverse,
            settings: redundancySettings,
            collection,
            tournament,
            predictionSettings,
            predictionSettingsHash: canonicalSha256(predictionSettings),
            sourceVector: vectorAfter,
          });
          pairTable = legacyTable?.status === "ready" ? undefined : legacyTable;
        }
        applyRedundancy(
          ownedGames,
          redundancySettings,
          collection,
          tournament,
          pairUniverse,
          pairTable,
          options.redundancySimilarityStatus ??
            semanticStatus ??
            semanticFallbackStatus(collection, redundancySettings.enabled),
          collection.semanticRedundancy === undefined ||
            collection.semanticRedundancy.settings.weights.factual > 0,
        );
      }

      return allGames.map((entry) => ({
        ...entry,
        hasPredictedContribution: hasPredictedContribution(entry),
        hasScoringContribution: hasScoringContribution(entry),
      }));
    },

    async listGamesFromSnapshot(snapshot, options): Promise<DisplayedGameFitness[]> {
      return (
        this as unknown as {
          listSnapshotGames(
            snapshot: DisplayedFitnessSnapshot,
            options: DisplayedFitnessOptions,
          ): Promise<DisplayedGameFitness[]>;
        }
      ).listSnapshotGames(snapshot, options);
    },

    async listSnapshotGames(
      snapshot: DisplayedFitnessSnapshot,
      options: DisplayedFitnessOptions,
      prepared?: PreparedScoringInput,
    ): Promise<DisplayedGameFitness[]> {
      if (unifiedScoringService) {
        const { frame, calculation } = await calculateUnifiedSnapshot(snapshot);
        const games = await unifiedScoringService.publishCurrent(calculation, () =>
          unifiedDisplayedGames(
            frame.sources.collection,
            frame.redundancySettings,
            calculation,
            options,
            snapshot.kind === "private-capture" ? frame.sources.collection : snapshot.collection,
          ),
        );
        if (!games) throw new Error("Displayed fitness changed before publication");
        return games;
      }
      const targets = targetIds(options);
      const privateCollection =
        snapshot.kind === "private-capture" ? structuredClone(snapshot.collection) : undefined;
      const collection =
        privateCollection === undefined
          ? structuredClone(snapshot.collection)
          : projectProfileCollectionSource(privateCollection);
      const tournament = structuredClone(snapshot.tournament);
      const completeGames =
        prepared && options.includePredicted
          ? structuredClone(prepared.capture)
          : prepared || options.includePredicted
            ? await (() => {
                if (prepared) {
                  if (!gameService.listGamesFromSnapshot)
                    throw new Error("Snapshot fitness requires snapshot-capable game service");
                  return gameService.listGamesFromSnapshot(
                    targets === undefined
                      ? collection
                      : {
                          ...collection,
                          games: collection.games.filter((game) => targets.includes(game.id)),
                        },
                    tournament,
                  );
                }
                if (!predictionService?.listGamesWithPredictionsFromSnapshot)
                  throw new Error("Snapshot prediction requires prediction service");
                return predictionService.listGamesWithPredictionsFromSnapshot(
                  collection,
                  tournament,
                  structuredClone(snapshot.predictionSettings),
                  targets,
                );
              })()
            : (() => {
                if (gameService.listGamesFromSnapshot === undefined) {
                  throw new Error("Snapshot fitness requires snapshot-capable game service");
                }
                return gameService.listGamesFromSnapshot(
                  targets === undefined
                    ? collection
                    : {
                        ...collection,
                        games: collection.games.filter((game) => targets.includes(game.id)),
                      },
                  tournament,
                );
              })();
      const allGames = targetEntries(completeGames, targets);
      const ownedGames = allGames.filter((entry) => entry.game.ownership !== "previously-owned");
      if (options.includeNiches && predictionService) {
        if (predictionService.listGamesWithPredictionsFromSnapshot === undefined) {
          throw new Error("Snapshot niches require snapshot-capable prediction service");
        }
        const nicheUniverse = prepared
          ? structuredClone(prepared.capture).filter(
              (entry) => entry.game.ownership !== "previously-owned",
            )
          : options.includePredicted
            ? targets === undefined
              ? ownedGames
              : (
                  await predictionService.listGamesWithPredictionsFromSnapshot(
                    collection,
                    tournament,
                    structuredClone(snapshot.predictionSettings),
                  )
                ).filter((entry) => entry.game.ownership !== "previously-owned")
            : (
                await predictionService.listGamesWithPredictionsFromSnapshot(
                  collection,
                  tournament,
                  structuredClone(snapshot.predictionSettings),
                )
              ).filter((entry) => entry.game.ownership !== "previously-owned");
        const nicheMap = computeNichePositions(nicheUniverse, snapshot.nicheSettings);
        for (const entry of allGames) entry.nichePosition = nicheMap.get(entry.game.id) ?? null;
      }
      const redundancyUniverse = prepared
        ? structuredClone(prepared.capture).filter(
            (entry) => entry.game.ownership !== "previously-owned",
          )
        : targets === undefined
          ? undefined
          : options.includePredicted
            ? predictionService?.listGamesWithPredictionsFromSnapshot === undefined
              ? undefined
              : (
                  await predictionService.listGamesWithPredictionsFromSnapshot(
                    collection,
                    tournament,
                    structuredClone(snapshot.predictionSettings),
                  )
                ).filter((entry) => entry.game.ownership !== "previously-owned")
            : (() => {
                if (gameService.listGamesFromSnapshot === undefined)
                  throw new Error("Snapshot redundancy requires snapshot-capable game service");
                return gameService
                  .listGamesFromSnapshot(collection, tournament)
                  .filter((entry) => entry.game.ownership !== "previously-owned");
              })();
      const privateSemanticUniverse = prepared
        ? Promise.resolve(
            structuredClone(prepared.capture).filter(
              (entry) => entry.game.ownership !== "previously-owned",
            ),
          )
        : snapshot.kind === "private-capture" && snapshot.redundancySettings.enabled
          ? options.includePredicted && targets === undefined
            ? Promise.resolve(ownedGames)
            : options.includePredicted && redundancyUniverse !== undefined
              ? Promise.resolve(redundancyUniverse)
              : (() => {
                  if (predictionService?.listGamesWithPredictionsFromSnapshot === undefined) {
                    throw new Error(
                      "Private semantic snapshot requires snapshot-capable prediction service",
                    );
                  }
                  return predictionService
                    .listGamesWithPredictionsFromSnapshot(
                      collection,
                      tournament,
                      structuredClone(snapshot.predictionSettings),
                    )
                    .then((entries) =>
                      entries.filter((entry) => entry.game.ownership !== "previously-owned"),
                    );
                })()
          : undefined;
      const semanticUniverse = await privateSemanticUniverse;
      const semanticConfiguredForSnapshot =
        privateCollection !== undefined &&
        semanticConfigured(privateCollection, snapshot.redundancySettings);
      let semanticCapture: GameWithScore[] | undefined = prepared
        ? structuredClone(prepared.capture)
        : undefined;
      if (
        !prepared &&
        semanticConfiguredForSnapshot &&
        predictionService?.listGamesWithPredictionsFromSnapshot
      ) {
        try {
          semanticCapture = await predictionService.listGamesWithPredictionsFromSnapshot(
            collection,
            tournament,
            structuredClone(snapshot.predictionSettings),
          );
        } catch {
          semanticCapture = undefined;
        }
      }
      const currentSourceVector =
        snapshot.kind === "private-capture" ? storageService?.sourceVector?.() : undefined;
      const sourceVectorIsCurrent =
        snapshot.kind === "private-capture" &&
        snapshot.sourceVector.available &&
        currentSourceVector !== undefined &&
        currentSourceVector.available &&
        snapshot.sourceVector.collectionId === privateCollection?.id &&
        snapshot.sourceVector.collectionSchemaVersion === privateCollection?.schemaVersion &&
        snapshot.sourceVector.collectionRevision === privateCollection?.revision &&
        snapshot.sourceVector.collectionId === currentSourceVector.collectionId &&
        snapshot.sourceVector.collectionSchemaVersion ===
          currentSourceVector.collectionSchemaVersion &&
        snapshot.sourceVector.collectionRevision === currentSourceVector.collectionRevision &&
        snapshot.sourceVector.processEpoch === currentSourceVector.processEpoch &&
        snapshot.sourceVector.changeToken === currentSourceVector.changeToken;
      let semanticPairTable: RedundancyPairTable | undefined;
      let semanticStatus: Exclude<RedundancySimilarityStatus, "ready"> | undefined;
      if (prepared) {
        semanticPairTable = prepared.table;
        if (
          prepared.proof.mode === "unified-similarity" &&
          prepared.fence?.result.status !== "ready"
        )
          semanticStatus = prepared.fence?.result.status ?? "not-ready";
      } else if (semanticConfiguredForSnapshot) {
        semanticStatus = "not-ready";
        if (semanticCapture && privateCollection && sourceVectorIsCurrent && resolveSemanticRead) {
          const identity = buildJevPredictionCaptureIdentity({
            collection: privateCollection,
            sourceVector: snapshot.sourceVector,
            tournament,
            predictionSettings: snapshot.predictionSettings,
            factualWeights: snapshot.redundancySettings.componentWeights,
            predictionCapture: semanticCapture,
          });
          if (identity.ok) {
            try {
              const fence = resolveSemanticRead({
                predictionCapture: semanticCapture,
                collection: privateCollection,
                tournament,
                predictionSettings: structuredClone(snapshot.predictionSettings),
                redundancySettings: structuredClone(snapshot.redundancySettings),
                factualWeights: snapshot.redundancySettings.componentWeights,
                captureIdentity: identity.identity,
                sourceVector: snapshot.sourceVector,
              });
              semanticPairTable = verifiedSemanticTable(fence);
              semanticStatus = semanticPairTable
                ? undefined
                : fence?.proof?.status !== undefined && fence.proof.status !== "ready"
                  ? fence.proof.status
                  : "not-ready";
            } catch {
              semanticStatus = "not-ready";
            }
          }
        }
      }
      const legacyPairTable =
        !prepared &&
        !semanticConfiguredForSnapshot &&
        snapshot.kind === "private-capture" &&
        privateCollection !== undefined &&
        sourceVectorIsCurrent &&
        snapshot.redundancySettings.enabled
          ? resolveRedundancyPairTable?.({
              universe: (semanticUniverse ?? redundancyUniverse ?? ownedGames).filter(
                ({ score }) => score !== null && !score.vetoed && score.score > 0,
              ),
              settings: snapshot.redundancySettings,
              collection: privateCollection,
              tournament,
              predictionSettings: structuredClone(snapshot.predictionSettings),
              predictionSettingsHash: canonicalSha256(snapshot.predictionSettings),
              sourceVector: snapshot.sourceVector,
            })
          : undefined;
      applyRedundancy(
        ownedGames,
        structuredClone(snapshot.redundancySettings),
        collection,
        tournament,
        semanticUniverse ?? redundancyUniverse,
        semanticPairTable ?? (legacyPairTable?.status === "ready" ? undefined : legacyPairTable),
        options.redundancySimilarityStatus ??
          semanticStatus ??
          (privateCollection === undefined
            ? snapshot.redundancySettings.enabled
              ? "factual"
              : "disabled"
            : semanticFallbackStatus(privateCollection, snapshot.redundancySettings.enabled)),
        privateCollection === undefined ||
          privateCollection.semanticRedundancy?.settings.weights.factual !== 0,
      );
      return allGames.map((entry) => ({
        ...entry,
        hasPredictedContribution: hasPredictedContribution(entry),
        hasScoringContribution: hasScoringContribution(entry),
      }));
    },
  };
}
