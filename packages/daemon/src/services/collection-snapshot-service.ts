import {
  CollectionSnapshotSchema,
  CollectionSnapshotCapacitySchema,
  FitnessResultResponseSchema,
  NichePositionResponseSchema,
  PurchaseUtilizationResultSchema,
  type CollectionSnapshot,
  type Collection,
  type GameWithScore,
  type GameWithPurchaseUtilization,
  type NicheSettings,
  type PredictionSettings,
  type RedundancySettings,
  type TournamentData,
  type SemanticScoringInputProof,
} from "@shelf-judge/shared";
import { performance } from "node:perf_hooks";
import type { StorageService } from "./storage-service.js";
import type { GameService } from "./game-service.js";
import type { PredictionService, PreparedPredictionList } from "./prediction-service.js";
import type { PurchaseUtilizationService } from "./purchase-utilization-service.js";
import { computeCapacityFromInputs } from "./capacity-service.js";
import {
  ownedPredictedCandidates,
  semanticFallbackStatus,
  withRedundancyAdjustmentsForVariants,
} from "./displayed-fitness-service.js";
import { computeNichePositions } from "./niche-engine.js";
import { deriveDisplayStats } from "./tournament-service.js";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import { createLogger, type Logger } from "./logger.js";
import { toErrorMessage } from "@shelf-judge/shared";
import type { SourceVector } from "./source-vector.js";
import { createCollectionSnapshotTimePolicy } from "./collection-snapshot-time-policy.js";
import type { RedundancyPairTable } from "./redundancy-engine.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import type { JevPairReadProofFence } from "./jev-pair-read-service.js";
import type { JevPredictionCaptureIdentity } from "./jev-pair-coverage.js";
import { buildJevPredictionCaptureIdentity } from "./jev-prediction-capture-identity.js";

export interface CollectionSnapshotSemanticReadInput {
  /** Complete prediction capture, including null, vetoed, and nonpositive scores. */
  predictionCapture: readonly GameWithScore[];
  collection: Collection;
  tournament: TournamentData;
  predictionSettings: PredictionSettings;
  redundancySettings: RedundancySettings;
  factualWeights: RedundancySettings["componentWeights"];
  captureIdentity: JevPredictionCaptureIdentity;
  sourceVector: SourceVector;
}

export interface CollectionSnapshotBuildResult {
  snapshot: CollectionSnapshot;
  sourceVector: SourceVector;
  evaluatedAtMs: number;
  expiresAtMs: number | null;
  /** Internal writer evidence only; never part of the public snapshot JSON. */
  semanticRead?:
    | { status: "not-used" }
    | ({ status: "verified" } & JevPairReadProofFence)
    | {
        status: "unified-v2";
        proof: SemanticScoringInputProof;
        isCurrent(): boolean;
      };
}

interface CapturedInputs {
  sourceVector: SourceVector;
  token: number;
  serverId: string;
  collection: Collection;
  tournament: TournamentData;
  predictionSettings?: PredictionSettings;
  redundancySettings?: RedundancySettings;
  redundancySimilarityStatus?: "disabled" | "factual" | "not-ready" | "stale" | "partial";
  nicheSettings?: NicheSettings;
  shelfConfig?: Awaited<ReturnType<StorageService["loadShelfConfig"]>>;
}

export class CollectionSnapshotUnavailableError extends Error {
  readonly status = 503;
  constructor(message = "Collection snapshot sources are unavailable") {
    super(message);
    this.name = "CollectionSnapshotUnavailableError";
  }
}

export interface CollectionSnapshotService {
  getSnapshot(): Promise<CollectionSnapshot>;
  buildSnapshot(context?: {
    requestId: string;
    operationId: string;
  }): Promise<CollectionSnapshotBuildResult>;
}

export interface CollectionSnapshotServiceDeps {
  storageService: StorageService;
  gameService: GameService;
  predictionService: PredictionService;
  purchaseUtilizationService: PurchaseUtilizationService;
  logger?: Logger;
  clock?: { now(): number };
  /** Test seam for a caller-validated complete generation; production remains factual-only. */
  resolveRedundancyPairTable?: (input: {
    universe: readonly GameWithScore[];
    settings: RedundancySettings;
    /** Captured source context for a pure resolver; no storage access is required. */
    collection: Collection;
    tournament: TournamentData;
    predictionSettings: PredictionSettings;
    predictionSettingsHash: string;
    /** Captured authoritative vector used to validate publication freshness. */
    sourceVector?: SourceVector;
  }) => RedundancyPairTable | undefined;
  /** Production semantic adapter. A single fenced read supplies both status and pair table. */
  resolveSemanticRead?: (input: CollectionSnapshotSemanticReadInput) => JevPairReadProofFence;
}

function errorReason(error: unknown): string {
  return toErrorMessage(error);
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function assertFiniteTournamentStats(stats: ReturnType<typeof deriveDisplayStats>): void {
  const finiteFields = [stats.eloRating, stats.normalizedScore];
  if (finiteFields.some((value) => value !== null && !Number.isFinite(value))) {
    throw new Error("Tournament display stats contain a non-finite number");
  }
  if (
    !Number.isSafeInteger(stats.comparisonCount) ||
    stats.comparisonCount < 0 ||
    !Number.isSafeInteger(stats.wins) ||
    stats.wins < 0 ||
    !Number.isSafeInteger(stats.losses) ||
    stats.losses < 0 ||
    typeof stats.displayLabel !== "string"
  ) {
    throw new Error("Tournament display stats are invalid");
  }
}

export function createCollectionSnapshotService(
  deps: CollectionSnapshotServiceDeps,
): CollectionSnapshotService {
  const { storageService, gameService, predictionService, purchaseUtilizationService } = deps;
  const logger = deps.logger ?? createLogger("collection-snapshot");
  const coordinator = profileSourceCoordinatorFor(storageService);
  const clock = deps.clock ?? { now: () => Date.now() };
  const timePolicy = createCollectionSnapshotTimePolicy(clock);
  let buildSequence = 0;

  async function capture(context: {
    requestId: string;
    operationId: string;
  }): Promise<CapturedInputs> {
    const queueStartedAt = performance.now();
    logger.debug?.("collection snapshot coordinator wait", {
      ...context,
      phase: "attempt",
      operation: "capture",
    });
    return coordinator.runExclusive(async () => {
      logger.debug?.("collection snapshot coordinator acquired", {
        ...context,
        operation: "capture",
        waitMs: Math.max(0, performance.now() - queueStartedAt),
      });
      let before = storageService.sourceVector?.();
      const hasStartupMarker = before?.unavailableSources.some(
        (source) => source === "startup" || source === "startup-hydration",
      );
      if (hasStartupMarker && storageService.hydrateSourceVector) {
        const hydrationStartedAt = performance.now();
        logger.debug?.("collection snapshot startup hydration attempt", {
          ...context,
          changeToken: before?.changeToken ?? null,
        });
        try {
          await storageService.hydrateSourceVector();
          logger.debug?.("collection snapshot startup hydration completed", {
            ...context,
            changeToken: storageService.sourceVector?.()?.changeToken ?? null,
            elapsedMs: Math.max(0, performance.now() - hydrationStartedAt),
            outcome: "hydrated",
          });
        } catch (error) {
          logger.warn("collection snapshot startup hydration failed", {
            ...context,
            changeToken: storageService.sourceVector?.()?.changeToken ?? null,
            elapsedMs: Math.max(0, performance.now() - hydrationStartedAt),
            outcome: "retrying-sources",
            errorClass: errorClass(error),
          });
        }
        before = storageService.sourceVector?.();
      }
      logger.debug?.("collection snapshot capture attempt", {
        ...context,
        changeToken: before?.changeToken ?? null,
        available: before?.available ?? false,
      });
      if (!before) throw new CollectionSnapshotUnavailableError();
      const load = <Value>(source: string, read: () => Promise<Value>): Promise<Value> => {
        const loadStartedAt = performance.now();
        logger.debug?.("collection snapshot source load attempt", {
          ...context,
          source,
          changeToken: before.changeToken,
        });
        return read().then(
          (value) => {
            logger.debug?.("collection snapshot source load completed", {
              ...context,
              source,
              outcome: "loaded",
              changeToken: before.changeToken,
              elapsedMs: Math.max(0, performance.now() - loadStartedAt),
            });
            return value;
          },
          (error: unknown) => {
            logger.error("collection snapshot source load failed", {
              ...context,
              source,
              outcome: "failed",
              changeToken: before.changeToken,
              elapsedMs: Math.max(0, performance.now() - loadStartedAt),
              errorClass: errorClass(error),
            });
            throw error;
          },
        );
      };
      const [
        collectionResult,
        tournamentResult,
        predictionResult,
        redundancyResult,
        nicheResult,
        shelfResult,
      ] = await Promise.allSettled([
        load("collection", () => storageService.loadCollection()),
        load("tournament", () => storageService.loadTournament()),
        load("prediction-settings", () => storageService.loadPredictionSettings()),
        load("redundancy-settings", () => storageService.loadRedundancySettings()),
        load("niche-settings", () => storageService.loadNicheSettings()),
        load("shelf-config", () => storageService.loadShelfConfig()),
      ]);
      if (collectionResult.status === "rejected" || tournamentResult.status === "rejected") {
        logger.error("collection snapshot required source failed", {
          ...context,
          collection: collectionResult.status === "rejected" ? "failed" : "loaded",
          collectionErrorClass:
            collectionResult.status === "rejected" ? errorClass(collectionResult.reason) : null,
          tournament: tournamentResult.status === "rejected" ? "failed" : "loaded",
          tournamentErrorClass:
            tournamentResult.status === "rejected" ? errorClass(tournamentResult.reason) : null,
          outcome: "unavailable",
        });
        throw new CollectionSnapshotUnavailableError();
      }
      const optionalFailures = new Set<string>();
      if (predictionResult.status === "rejected") optionalFailures.add("prediction-settings");
      if (redundancyResult.status === "rejected") optionalFailures.add("redundancy-settings");
      if (nicheResult.status === "rejected") optionalFailures.add("niche-settings");
      if (shelfResult.status === "rejected") optionalFailures.add("shelf-config");
      // A malformed shelf config is deliberately replaced with a standalone fallback
      // by storage. Its unavailable vector means capacity cannot be certified.
      const after = storageService.sourceVector?.();
      if (after?.unavailableSources.includes("shelf-config")) {
        optionalFailures.add("shelf-config");
      }
      const unavailableAreOptional =
        after?.unavailableSources.every(
          (source) =>
            source === "startup" || source === "startup-hydration" || optionalFailures.has(source),
        ) ?? false;
      if (!after || after.processEpoch !== before.processEpoch || !unavailableAreOptional) {
        throw new CollectionSnapshotUnavailableError(
          "Collection snapshot sources changed during capture",
        );
      }
      logger.debug?.("collection snapshot capture completed", {
        ...context,
        collectionId: collectionResult.value.id,
        changeToken: after.changeToken,
        degradedSourceCount: [predictionResult, redundancyResult, nicheResult, shelfResult].filter(
          (result) => result.status === "rejected",
        ).length,
        outcome: "captured",
      });
      const captured = {
        sourceVector: after,
        token: after.changeToken,
        serverId: after.processEpoch,
        collection: collectionResult.value,
        tournament: tournamentResult.value,
        ...(predictionResult.status === "fulfilled"
          ? { predictionSettings: predictionResult.value }
          : {}),
        ...(redundancyResult.status === "fulfilled"
          ? {
              redundancySettings: redundancyResult.value,
              redundancySimilarityStatus: semanticFallbackStatus(
                collectionResult.value,
                redundancyResult.value.enabled,
              ),
            }
          : {}),
        ...(nicheResult.status === "fulfilled" ? { nicheSettings: nicheResult.value } : {}),
        ...(shelfResult.status === "fulfilled" && !optionalFailures.has("shelf-config")
          ? { shelfConfig: shelfResult.value }
          : {}),
      };
      return captured;
    });
  }

  async function stillCurrent(
    token: number,
    capturedVector: SourceVector,
    context: { requestId: string; operationId: string },
  ): Promise<void> {
    const queueStartedAt = performance.now();
    logger.debug?.("collection snapshot coordinator wait", {
      ...context,
      phase: "attempt",
      operation: "publication-check",
    });
    await coordinator.runExclusive(() =>
      Promise.resolve().then(() => {
        logger.debug?.("collection snapshot coordinator acquired", {
          ...context,
          operation: "publication-check",
          waitMs: Math.max(0, performance.now() - queueStartedAt),
        });
        logger.debug?.("collection snapshot source verification attempt", {
          ...context,
          changeToken: token,
        });
        const current = storageService.sourceVector?.();
        if (
          !current ||
          current.processEpoch !== capturedVector.processEpoch ||
          current.changeToken !== token
        ) {
          logger.warn("collection snapshot source verification failed", {
            ...context,
            changeToken: token,
            currentChangeToken: current?.changeToken ?? null,
            outcome: "stale",
          });
          throw new CollectionSnapshotUnavailableError(
            "Collection snapshot sources changed during computation",
          );
        }
        logger.debug?.("collection snapshot source verification completed", {
          ...context,
          changeToken: token,
          outcome: "current",
        });
      }),
    );
  }

  return {
    async buildSnapshot(context) {
      const operationId = context?.operationId ?? `snapshot-build-${++buildSequence}`;
      const requestId = context?.requestId ?? operationId;
      const operationStartedAt = performance.now();
      logger.debug?.("collection snapshot build attempt", {
        requestId,
        operationId,
        phase: "capture",
      });
      const input = await capture({ requestId, operationId });
      logger.debug?.("collection snapshot phase completed", {
        requestId,
        operationId,
        phase: "capture",
        elapsedMs: Math.max(0, performance.now() - operationStartedAt),
        gameCount: input.collection.games.length,
        changeToken: input.token,
      });
      // BGG freshness belongs to the captured source generation and is evaluated
      // before any potentially long scoring or projection work.
      const evaluatedAtMs = clock.now();
      const expiresAtMs = timePolicy.nextBggDataStaleTransition(
        input.collection.games,
        evaluatedAtMs,
      );
      const degraded: Array<{ feature: string; reason: string }> = [];
      const noteDegraded = (feature: string, reason: string) => degraded.push({ feature, reason });
      let ordinary: GameWithScore[];
      const ordinaryStartedAt = performance.now();
      logger.debug?.("collection snapshot phase attempt", {
        requestId,
        operationId,
        phase: "ordinary-scoring",
        gameCount: input.collection.games.length,
      });
      try {
        if (!gameService.listRawGamesFromSnapshot)
          throw new Error("Raw snapshot scoring helper is unavailable");
        ordinary = gameService.listRawGamesFromSnapshot(input.collection, input.tournament);
        for (const entry of ordinary) {
          if (entry.score !== null) FitnessResultResponseSchema.parse(entry.score);
        }
        logger.debug?.("collection snapshot phase completed", {
          requestId,
          operationId,
          phase: "ordinary-scoring",
          elapsedMs: Math.max(0, performance.now() - ordinaryStartedAt),
          gameCount: ordinary.length,
        });
      } catch (error) {
        logger.error("collection snapshot ordinary scoring failed", {
          requestId,
          operationId,
          elapsedMs: Math.max(0, performance.now() - ordinaryStartedAt),
          collectionId: input.collection.id,
          outcome: "unavailable",
          errorClass: errorClass(error),
        });
        throw new CollectionSnapshotUnavailableError("Ordinary scoring is unavailable");
      }

      let prepared: PreparedPredictionList | undefined;
      if (input.predictionSettings) {
        const preparedStartedAt = performance.now();
        logger.debug?.("collection snapshot phase attempt", {
          requestId,
          operationId,
          phase: "prediction-preparation",
          gameCount: input.collection.games.length,
        });
        try {
          if (!predictionService.preparePredictionListFromSnapshot)
            throw new Error("Snapshot prediction context is unavailable");
          prepared = await predictionService.preparePredictionListFromSnapshot(
            input.collection,
            input.tournament,
            input.predictionSettings,
            { requestId, operationId },
          );
          logger.debug?.("collection snapshot phase completed", {
            requestId,
            operationId,
            phase: "prediction-preparation",
            elapsedMs: Math.max(0, performance.now() - preparedStartedAt),
            outcome: "prepared",
          });
        } catch (error) {
          logger.error("collection snapshot phase failed", {
            requestId,
            operationId,
            phase: "prediction-preparation",
            elapsedMs: Math.max(0, performance.now() - preparedStartedAt),
            errorClass: errorClass(error),
          });
          noteDegraded("predictions", errorReason(error));
        }
      } else noteDegraded("predictions", "Prediction settings are unavailable");

      const ordinaryScores = new Map(ordinary.map((entry) => [entry.game.id, entry.score]));
      let predicted: GameWithScore[] | undefined;
      if (prepared) {
        const predictionStartedAt = performance.now();
        logger.debug?.("collection snapshot phase attempt", {
          requestId,
          operationId,
          phase: "prediction-resolution",
          gameCount: ordinary.length,
        });
        try {
          if (prepared.listActualGames) ordinary = prepared.listActualGames();
          predicted = prepared.listGames(ordinaryScores);
          for (const entry of predicted) {
            if (entry.score !== null) FitnessResultResponseSchema.parse(entry.score);
          }
          logger.debug?.("collection snapshot phase completed", {
            requestId,
            operationId,
            phase: "prediction-resolution",
            elapsedMs: Math.max(0, performance.now() - predictionStartedAt),
            gameCount: predicted.length,
          });
        } catch (error) {
          predicted = undefined;
          logger.error("collection snapshot phase failed", {
            requestId,
            operationId,
            phase: "prediction-resolution",
            elapsedMs: Math.max(0, performance.now() - predictionStartedAt),
            errorClass: errorClass(error),
          });
          noteDegraded("predictions", errorReason(error));
        }
      }
      const predictedCandidates = predicted ? ownedPredictedCandidates(predicted) : [];
      let nichePositions: CollectionSnapshot["nichePositions"] = {
        availability: "unavailable",
        reason: "Niche settings are unavailable",
      };
      if (input.nicheSettings && predicted) {
        try {
          const positions = computeNichePositions(predictedCandidates, input.nicheSettings);
          for (const position of positions.values()) NichePositionResponseSchema.parse(position);
          nichePositions = {
            availability: "available",
            positions: [...positions].map(([gameId, position]) => ({ gameId, position })),
          };
        } catch (error) {
          nichePositions = { availability: "unavailable", reason: errorReason(error) };
          noteDegraded("niches", errorReason(error));
        }
      } else {
        const reason = input.nicheSettings
          ? "Predictions are unavailable"
          : "Niche settings are unavailable";
        nichePositions = { availability: "unavailable", reason };
        noteDegraded("niches", reason);
      }

      let ordinaryDisplay = ordinary;
      let predictedDisplay = predicted;
      const unifiedCalculated = prepared?.semanticScoringInputProof !== undefined;
      let semanticRead: CollectionSnapshotBuildResult["semanticRead"] =
        prepared?.semanticScoringInputProof
          ? {
              status: "unified-v2",
              proof: prepared.semanticScoringInputProof,
              isCurrent: () => prepared?.isCurrent?.() ?? false,
            }
          : { status: "not-used" };
      let snapshotSimilarityStatus = input.redundancySimilarityStatus;
      if (unifiedCalculated && input.redundancySettings?.enabled)
        snapshotSimilarityStatus = "factual";
      let redundancyMode: "off" | "annotation" | "integrated" = input.redundancySettings?.enabled
        ? input.redundancySettings.stage
        : "off";
      if (
        input.redundancySettings?.enabled &&
        predicted &&
        input.predictionSettings &&
        !unifiedCalculated
      ) {
        const redundancyStartedAt = performance.now();
        logger.debug?.("collection snapshot phase attempt", {
          requestId,
          operationId,
          phase: "redundancy-adjustment",
          gameCount: predicted.length,
        });
        try {
          const semanticConfigured =
            input.collection.semanticRedundancy?.settings.enabled === true &&
            (input.collection.semanticRedundancy.settings.weights.description > 0 ||
              input.collection.semanticRedundancy.settings.weights.ownerNote > 0);
          let pairTable: RedundancyPairTable | undefined;
          let similarityStatus = input.redundancySimilarityStatus ?? "factual";
          if (deps.resolveSemanticRead && semanticConfigured) {
            const captureIdentity = buildJevPredictionCaptureIdentity({
              collection: input.collection,
              sourceVector: input.sourceVector,
              tournament: input.tournament,
              predictionSettings: input.predictionSettings,
              factualWeights: input.redundancySettings.componentWeights,
              predictionCapture: predicted,
            });
            if (!captureIdentity.ok) {
              // An incoherent capture cannot authorize any semantic result. Keep the
              // ordinary factual projection and report semantic readiness honestly.
              similarityStatus = "not-ready";
              snapshotSimilarityStatus = "not-ready";
            } else {
              const fence = deps.resolveSemanticRead({
                predictionCapture: predicted,
                collection: input.collection,
                tournament: input.tournament,
                predictionSettings: input.predictionSettings,
                redundancySettings: input.redundancySettings,
                factualWeights: input.redundancySettings.componentWeights,
                captureIdentity: captureIdentity.identity,
                sourceVector: input.sourceVector,
              });
              if (
                !fence ||
                typeof fence.isCurrent !== "function" ||
                !fence.proof ||
                fence.proof.status !== fence.result.status
              ) {
                throw new Error("Semantic redundancy read proof is unavailable");
              }
              semanticRead = { status: "verified", ...fence };
              if ("table" in fence.result && fence.result.table) pairTable = fence.result.table;
              if (!("table" in fence.result && fence.result.table)) {
                similarityStatus = fence.result.status as Exclude<
                  typeof fence.result.status,
                  "ready"
                >;
                snapshotSimilarityStatus = similarityStatus;
              }
            }
          } else {
            pairTable = deps.resolveRedundancyPairTable?.({
              universe: predictedCandidates.filter(
                ({ score }) => score !== null && !score.vetoed && score.score > 0,
              ),
              settings: input.redundancySettings,
              collection: input.collection,
              tournament: input.tournament,
              predictionSettings: input.predictionSettings,
              predictionSettingsHash: canonicalSha256(input.predictionSettings),
              sourceVector: input.sourceVector,
            });
            // The old test seam cannot authorize a dynamic semantic result: it carries no read fence.
            if (pairTable?.status === "ready") {
              throw new Error("Semantic redundancy read proof is unavailable");
            }
          }
          const adjusted = withRedundancyAdjustmentsForVariants(
            ordinary.filter((entry) => entry.game.ownership !== "previously-owned"),
            predicted.filter((entry) => entry.game.ownership !== "previously-owned"),
            input.redundancySettings,
            input.collection,
            input.tournament,
            predictedCandidates,
            pairTable,
            similarityStatus,
            input.collection.semanticRedundancy?.settings.weights.factual !== 0,
          );
          for (const entry of [...adjusted.ordinary, ...adjusted.predicted]) {
            if (entry.score !== null) FitnessResultResponseSchema.parse(entry.score);
          }
          ordinaryDisplay = mergeByGame(ordinary, adjusted.ordinary);
          predictedDisplay = mergeByGame(predicted, adjusted.predicted);
          logger.debug?.("collection snapshot phase completed", {
            requestId,
            operationId,
            phase: "redundancy-adjustment",
            elapsedMs: Math.max(0, performance.now() - redundancyStartedAt),
            outcome: "adjusted",
          });
        } catch (error) {
          redundancyMode = "off";
          logger.error("collection snapshot phase failed", {
            requestId,
            operationId,
            phase: "redundancy-adjustment",
            elapsedMs: Math.max(0, performance.now() - redundancyStartedAt),
            errorClass: errorClass(error),
          });
          noteDegraded("redundancy", errorReason(error));
        }
      } else if (!input.redundancySettings)
        noteDegraded("redundancy", "Redundancy settings are unavailable");
      else if (input.redundancySettings.enabled && !predicted) {
        redundancyMode = "off";
        noteDegraded("redundancy", "Predicted owned universe is unavailable");
      }

      const ordinaryUtilized = purchaseUtilizationService.enrichGames(
        ordinaryDisplay,
        input.collection.entertainmentBenchmark,
        "list",
      );
      let predictedUtilized: GameWithPurchaseUtilization[] | undefined;
      if (predictedDisplay) {
        try {
          predictedUtilized = purchaseUtilizationService.enrichGames(
            predictedDisplay,
            input.collection.entertainmentBenchmark,
            "list",
          );
          for (const entry of predictedUtilized) {
            if (entry.score !== null) FitnessResultResponseSchema.parse(entry.score);
            PurchaseUtilizationResultSchema.parse(entry.purchaseUtilization);
          }
        } catch (error) {
          predictedUtilized = undefined;
          noteDegraded("predictions", errorReason(error));
        }
      }
      let capacity: CollectionSnapshot["capacity"];
      if (input.shelfConfig) {
        try {
          const result = computeCapacityFromInputs({
            shelfConfig: input.shelfConfig,
            rawOrdinaryGames: ordinary,
            axes: input.collection.axes,
            tournament: input.tournament,
          });
          capacity = {
            availability: "available",
            result: CollectionSnapshotCapacitySchema.parse(result),
          };
        } catch (error) {
          capacity = { availability: "unavailable", reason: errorReason(error) };
          noteDegraded("capacity", errorReason(error));
        }
      } else {
        capacity = { availability: "unavailable", reason: "Shelf configuration is unavailable" };
        noteDegraded("capacity", "Shelf configuration is unavailable");
      }

      const predictedById = new Map(predictedUtilized?.map((entry) => [entry.game.id, entry]));
      const ordinaryById = new Map(ordinaryUtilized.map((entry) => [entry.game.id, entry]));
      const ownerNotePresenceByGameId = new Map(
        input.collection.games.map((game) => [game.id, game.ownerNote.state === "present"]),
      );
      let displayStatsUnavailable: string | undefined;
      const games = ordinary.map((raw) => {
        const ordinaryEntry = ordinaryById.get(raw.game.id)!;
        const predictedEntry = predictedById.get(raw.game.id);
        let tournamentStats: CollectionSnapshot["games"][number]["tournament"] = null;
        const hasTournamentData = Object.hasOwn(input.tournament.gameStats, raw.game.id);
        try {
          if (hasTournamentData) {
            const stats = deriveDisplayStats(raw.game.id, input.tournament);
            assertFiniteTournamentStats(stats);
            tournamentStats = {
              eloRating: stats.eloRating,
              comparisonCount: stats.comparisonCount,
              normalizedScore: stats.normalizedScore,
              displayLabel: stats.displayLabel,
              wins: stats.wins,
              losses: stats.losses,
            };
          }
        } catch (error) {
          displayStatsUnavailable = errorReason(error);
        }
        const ratings = structuredClone(raw.game.ratings);
        return {
          ownerNotePresent: ownerNotePresenceByGameId.get(raw.game.id) ?? false,
          game: {
            id: raw.game.id,
            name: raw.game.name,
            bggId: raw.game.bggId,
            yearPublished: raw.game.yearPublished,
            imageUrl: raw.game.imageUrl,
            numPlays: raw.game.numPlays,
            createdAt: raw.game.createdAt,
            updatedAt: raw.game.updatedAt,
            ratings,
            bggData: raw.game.bggData
              ? {
                  presence: "present" as const,
                  communityRating: raw.game.bggData.communityRating,
                  weight: raw.game.bggData.weight,
                }
              : null,
            boxDimensions: raw.game.boxDimensions,
            minPlayers: raw.game.minPlayers,
            maxPlayers: raw.game.maxPlayers,
            bestPlayers: raw.game.bestPlayers,
            playingTime: raw.game.playingTime,
            ownership: raw.game.ownership,
          },
          ordinary: {
            score: ordinaryEntry.score,
            displayScore: ordinaryEntry.displayScore,
            purchaseUtilization: ordinaryEntry.purchaseUtilization,
          },
          redundancySimilarityInfo: predictedEntry?.score?.redundancySimilarityInfo ??
            ordinaryEntry.score?.redundancySimilarityInfo ?? {
              status:
                snapshotSimilarityStatus ??
                (input.redundancySettings?.enabled ? "factual" : "disabled"),
              generationId: null,
            },
          predicted: predictedEntry
            ? {
                availability: "available" as const,
                score: predictedEntry.score,
                displayScore: predictedEntry.displayScore,
                purchaseUtilization: predictedEntry.purchaseUtilization,
              }
            : { availability: "unavailable" as const, reason: "Prediction is unavailable" },
          tournament: tournamentStats,
          hasTournamentData,
        };
      });
      if (displayStatsUnavailable) noteDegraded("tournament-display", displayStatsUnavailable);
      const availablePredictions = games.filter(
        (row) => (row.predicted.score?.predictionMeta?.predictedAxisCount ?? 0) > 0,
      ).length;
      const snapshot = CollectionSnapshotSchema.parse({
        representationVersion: 1,
        collectionId: input.collection.id,
        serverId: input.serverId,
        status: degraded.length === 0 ? "complete" : "degraded",
        unavailableFeatures: dedupeDegraded(degraded),
        axes: input.collection.axes.map(
          ({ id, name, source, weight, enabled, preferenceShape, idealValue, veto }) => ({
            id,
            name,
            source,
            enabled: source === "legacy" ? false : enabled,
            weight,
            ...(preferenceShape === undefined ? {} : { preferenceShape }),
            ...(idealValue === undefined ? {} : { idealValue }),
            ...(veto === undefined ? {} : { veto }),
          }),
        ),
        ignoredTags: input.nicheSettings?.ignoredTags.map((tag) => `${tag.type}:${tag.name}`) ?? [],
        redundancyMode,
        games,
        nichePositions,
        capacity,
        counts: {
          total: games.length,
          rated: ordinaryUtilized.filter(
            (entry) => entry.game.ownership !== "previously-owned" && entry.score !== null,
          ).length,
          predicted: availablePredictions,
          unavailablePredictions: games.filter(
            (row) => row.predicted.availability === "unavailable",
          ).length,
        },
        averageScore: average(
          ordinaryUtilized
            .filter((entry) => entry.game.ownership !== "previously-owned")
            .map((entry) => entry.score?.score ?? null),
        ),
      });
      logger.debug?.("collection snapshot phase completed", {
        requestId,
        operationId,
        phase: "public-projection",
        gameCount: games.length,
        outcome: "projected",
      });
      if (prepared?.isCurrent && !prepared.isCurrent())
        throw new CollectionSnapshotUnavailableError(
          "Unified scoring inputs changed before snapshot publication",
        );
      await stillCurrent(input.token, input.sourceVector, { requestId, operationId });
      logger.debug?.("collection snapshot build completed", {
        requestId,
        operationId,
        elapsedMs: Math.max(0, performance.now() - operationStartedAt),
        gameCount: snapshot.games.length,
        outcome: "current",
      });
      return {
        snapshot,
        sourceVector: input.sourceVector,
        evaluatedAtMs,
        expiresAtMs,
        semanticRead,
      };
    },
    async getSnapshot() {
      return (await this.buildSnapshot()).snapshot;
    },
  };
}

function mergeByGame(original: GameWithScore[], replacements: GameWithScore[]): GameWithScore[] {
  const byId = new Map(replacements.map((entry) => [entry.game.id, entry]));
  return original.map((entry) => byId.get(entry.game.id) ?? entry);
}

function dedupeDegraded(
  entries: Array<{ feature: string; reason: string }>,
): Array<{ feature: string; reason: string }> {
  return [...new Map(entries.map((entry) => [entry.feature, entry])).values()];
}

function average(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length === 0
    ? null
    : available.reduce((sum, value) => sum + value, 0) / available.length;
}
