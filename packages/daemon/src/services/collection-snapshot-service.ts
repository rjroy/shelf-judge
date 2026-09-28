import {
  CollectionSnapshotSchema,
  CollectionSnapshotCapacitySchema,
  FitnessResultResponseSchema,
  NichePositionResponseSchema,
  PurchaseUtilizationResultSchema,
  type CollectionSnapshot,
  type CollectionProfileCollectionSource,
  type GameWithScore,
  type GameWithPurchaseUtilization,
  type NicheSettings,
  type PredictionSettings,
  type RedundancySettings,
  type TournamentData,
} from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import type { GameService } from "./game-service.js";
import type { PredictionService, PreparedPredictionList } from "./prediction-service.js";
import type { PurchaseUtilizationService } from "./purchase-utilization-service.js";
import { computeCapacityFromInputs } from "./capacity-service.js";
import {
  ownedPredictedCandidates,
  withRedundancyAdjustmentsForVariants,
} from "./displayed-fitness-service.js";
import { computeNichePositions } from "./niche-engine.js";
import { deriveDisplayStats } from "./tournament-service.js";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import { createLogger, type Logger } from "./logger.js";
import { toErrorMessage } from "@shelf-judge/shared";
import type { SourceVector } from "./source-vector.js";
import { createCollectionSnapshotTimePolicy } from "./collection-snapshot-time-policy.js";

interface CapturedInputs {
  sourceVector: SourceVector;
  token: number;
  serverId: string;
  collection: CollectionProfileCollectionSource;
  tournament: TournamentData;
  predictionSettings?: PredictionSettings;
  redundancySettings?: RedundancySettings;
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
  buildSnapshot(): Promise<{
    snapshot: CollectionSnapshot;
    sourceVector: SourceVector;
    evaluatedAtMs: number;
    expiresAtMs: number | null;
  }>;
}

export interface CollectionSnapshotServiceDeps {
  storageService: StorageService;
  gameService: GameService;
  predictionService: PredictionService;
  purchaseUtilizationService: PurchaseUtilizationService;
  logger?: Logger;
  clock?: { now(): number };
}

function errorReason(error: unknown): string {
  return toErrorMessage(error);
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

  async function capture(): Promise<CapturedInputs> {
    return coordinator.runExclusive(async () => {
      let before = storageService.sourceVector?.();
      const hasStartupMarker = before?.unavailableSources.some(
        (source) => source === "startup" || source === "startup-hydration",
      );
      if (hasStartupMarker && storageService.hydrateSourceVector) {
        logger.log("collection snapshot startup hydration attempt", {
          changeToken: before?.changeToken ?? null,
        });
        try {
          await storageService.hydrateSourceVector();
          logger.log("collection snapshot startup hydration completed", {
            changeToken: storageService.sourceVector?.()?.changeToken ?? null,
            outcome: "hydrated",
          });
        } catch (error) {
          logger.warn("collection snapshot startup hydration failed", {
            changeToken: storageService.sourceVector?.()?.changeToken ?? null,
            outcome: "retrying-sources",
            error: errorReason(error),
          });
        }
        before = storageService.sourceVector?.();
      }
      logger.log("collection snapshot capture attempt", {
        changeToken: before?.changeToken ?? null,
        available: before?.available ?? false,
      });
      if (!before) throw new CollectionSnapshotUnavailableError();
      const load = <Value>(source: string, read: () => Promise<Value>): Promise<Value> => {
        logger.log("collection snapshot source load attempt", {
          source,
          changeToken: before.changeToken,
        });
        return read().then(
          (value) => {
            logger.log("collection snapshot source load completed", {
              source,
              outcome: "loaded",
              changeToken: before.changeToken,
            });
            return value;
          },
          (error: unknown) => {
            logger.error("collection snapshot source load failed", {
              source,
              outcome: "failed",
              changeToken: before.changeToken,
              error: errorReason(error),
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
          collection:
            collectionResult.status === "rejected"
              ? errorReason(collectionResult.reason)
              : "loaded",
          tournament:
            tournamentResult.status === "rejected"
              ? errorReason(tournamentResult.reason)
              : "loaded",
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
      logger.log("collection snapshot capture completed", {
        collectionId: collectionResult.value.id,
        changeToken: after.changeToken,
        degradedSourceCount: [predictionResult, redundancyResult, nicheResult, shelfResult].filter(
          (result) => result.status === "rejected",
        ).length,
        outcome: "captured",
      });
      return {
        sourceVector: after,
        token: after.changeToken,
        serverId: after.processEpoch,
        collection: collectionResult.value,
        tournament: tournamentResult.value,
        ...(predictionResult.status === "fulfilled"
          ? { predictionSettings: predictionResult.value }
          : {}),
        ...(redundancyResult.status === "fulfilled"
          ? { redundancySettings: redundancyResult.value }
          : {}),
        ...(nicheResult.status === "fulfilled" ? { nicheSettings: nicheResult.value } : {}),
        ...(shelfResult.status === "fulfilled" && !optionalFailures.has("shelf-config")
          ? { shelfConfig: shelfResult.value }
          : {}),
      };
    });
  }

  async function stillCurrent(token: number, capturedVector: SourceVector): Promise<void> {
    await coordinator.runExclusive(() =>
      Promise.resolve().then(() => {
        logger.log("collection snapshot source verification attempt", { changeToken: token });
        const current = storageService.sourceVector?.();
        if (
          !current ||
          current.processEpoch !== capturedVector.processEpoch ||
          current.changeToken !== token
        ) {
          logger.warn("collection snapshot source verification failed", {
            changeToken: token,
            currentChangeToken: current?.changeToken ?? null,
            outcome: "stale",
          });
          throw new CollectionSnapshotUnavailableError(
            "Collection snapshot sources changed during computation",
          );
        }
        logger.log("collection snapshot source verification completed", {
          changeToken: token,
          outcome: "current",
        });
      }),
    );
  }

  return {
    async buildSnapshot() {
      const input = await capture();
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
      try {
        if (!gameService.listRawGamesFromSnapshot)
          throw new Error("Raw snapshot scoring helper is unavailable");
        ordinary = gameService.listRawGamesFromSnapshot(input.collection, input.tournament);
        for (const entry of ordinary) {
          if (entry.score !== null) FitnessResultResponseSchema.parse(entry.score);
        }
      } catch (error) {
        logger.error("collection snapshot ordinary scoring failed", {
          collectionId: input.collection.id,
          outcome: "unavailable",
          error: errorReason(error),
        });
        throw new CollectionSnapshotUnavailableError("Ordinary scoring is unavailable");
      }

      let prepared: PreparedPredictionList | undefined;
      if (input.predictionSettings) {
        try {
          if (!predictionService.preparePredictionListFromSnapshot)
            throw new Error("Snapshot prediction context is unavailable");
          prepared = await predictionService.preparePredictionListFromSnapshot(
            input.collection,
            input.tournament,
            input.predictionSettings,
          );
        } catch (error) {
          noteDegraded("predictions", errorReason(error));
        }
      } else noteDegraded("predictions", "Prediction settings are unavailable");

      const ordinaryScores = new Map(ordinary.map((entry) => [entry.game.id, entry.score]));
      let predicted: GameWithScore[] | undefined;
      if (prepared) {
        try {
          predicted = prepared.listGames(ordinaryScores);
          for (const entry of predicted) {
            if (entry.score !== null) FitnessResultResponseSchema.parse(entry.score);
          }
        } catch (error) {
          predicted = undefined;
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
      let redundancyMode: "off" | "annotation" | "integrated" = input.redundancySettings?.enabled
        ? input.redundancySettings.stage
        : "off";
      if (input.redundancySettings?.enabled && predicted) {
        try {
          const adjusted = withRedundancyAdjustmentsForVariants(
            ordinary.filter((entry) => entry.game.ownership !== "previously-owned"),
            predicted.filter((entry) => entry.game.ownership !== "previously-owned"),
            input.redundancySettings,
            input.collection,
            input.tournament,
            predictedCandidates,
          );
          for (const entry of [...adjusted.ordinary, ...adjusted.predicted]) {
            if (entry.score !== null) FitnessResultResponseSchema.parse(entry.score);
          }
          ordinaryDisplay = mergeByGame(ordinary, adjusted.ordinary);
          predictedDisplay = mergeByGame(predicted, adjusted.predicted);
        } catch (error) {
          redundancyMode = "off";
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
      await stillCurrent(input.token, input.sourceVector);
      return { snapshot, sourceVector: input.sourceVector, evaluatedAtMs, expiresAtMs };
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
