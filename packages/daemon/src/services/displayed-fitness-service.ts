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
} from "@shelf-judge/shared";
import type { GameService } from "./game-service.js";
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
}

function semanticConfigured(collection: Collection, settings: RedundancySettings): boolean {
  const semantic = collection.semanticRedundancy;
  return (
    settings.enabled &&
    semantic?.settings.enabled === true &&
    (semantic.settings.weights.description > 0 || semantic.settings.weights.ownerNote > 0)
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
  return fence.result.status === "ready" && fence.proof.status === "ready"
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
): GameWithScore[] {
  const analysis = redundancyAnalysis(
    universe,
    settings,
    collection,
    tournamentData,
    pairTable,
    fallbackStatus,
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
): { ordinary: GameWithScore[]; predicted: GameWithScore[] } {
  const analysis = redundancyAnalysis(
    universe,
    settings,
    collection,
    tournamentData,
    pairTable,
    fallbackStatus,
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

export function createDisplayedFitnessService(
  deps: DisplayedFitnessServiceDeps,
): DisplayedFitnessService {
  const {
    gameService,
    predictionService,
    storageService,
    resolveRedundancyPairTable,
    resolveSemanticRead,
  } = deps;

  return {
    async listGames(options): Promise<DisplayedGameFitness[]> {
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
        );
      }

      return allGames.map((entry) => ({
        ...entry,
        hasPredictedContribution: hasPredictedContribution(entry),
        hasScoringContribution: hasScoringContribution(entry),
      }));
    },

    async listGamesFromSnapshot(snapshot, options): Promise<DisplayedGameFitness[]> {
      const targets = targetIds(options);
      const privateCollection =
        snapshot.kind === "private-capture" ? structuredClone(snapshot.collection) : undefined;
      const collection =
        privateCollection === undefined
          ? structuredClone(snapshot.collection)
          : projectProfileCollectionSource(privateCollection);
      const tournament = structuredClone(snapshot.tournament);
      const completeGames = options.includePredicted
        ? await (() => {
            if (!predictionService?.listGamesWithPredictionsFromSnapshot) {
              throw new Error("Snapshot prediction requires prediction service");
            }
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
        const nicheUniverse = options.includePredicted
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
      const redundancyUniverse =
        targets === undefined
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
      const privateSemanticUniverse =
        snapshot.kind === "private-capture" && snapshot.redundancySettings.enabled
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
      let semanticCapture: GameWithScore[] | undefined;
      if (
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
      if (semanticConfiguredForSnapshot) {
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
      );
      return allGames.map((entry) => ({
        ...entry,
        hasPredictedContribution: hasPredictedContribution(entry),
        hasScoringContribution: hasScoringContribution(entry),
      }));
    },
  };
}
