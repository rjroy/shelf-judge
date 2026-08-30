import {
  AcquisitionMutationRequestSchema,
  calculatePurchaseUtilization,
  EntertainmentBenchmarkMutationRequestSchema,
  NotFoundError,
  parseAmountInput,
  projectFitnessScore,
  resolveEffectivePlayingTime,
  resolveEffectivePlayerCount,
  type AcquisitionMutationRequest,
  type EntertainmentBenchmark,
  type Game,
  type GameWithPurchaseUtilization,
  type GameWithScore,
} from "@shelf-judge/shared";
import type { CollectionPersistence, StorageService } from "./storage-service.js";
import {
  collectionMutationServiceFor,
  type CollectionMutationService,
} from "./collection-mutation-service.js";
import { createLogger, type Logger } from "./logger.js";

export interface PurchaseUtilizationService {
  getEntertainmentBenchmark(): Promise<EntertainmentBenchmark>;
  setEntertainmentBenchmark(input: unknown): Promise<EntertainmentBenchmark>;
  clearEntertainmentBenchmark(): Promise<EntertainmentBenchmark>;
  setAcquisition(gameId: string, input: unknown): Promise<Game>;
  enrichGames(
    games: GameWithScore[],
    entertainmentBenchmark: EntertainmentBenchmark,
    responseKind: "list" | "detail",
  ): GameWithPurchaseUtilization[];
}

export type PurchaseUtilizationValidationCode =
  | "invalid_acquisition_request"
  | "invalid_benchmark_request";

export class PurchaseUtilizationValidationError extends Error {
  constructor(
    public readonly code: PurchaseUtilizationValidationCode,
    public readonly details: readonly unknown[],
  ) {
    super("Validation failed");
    this.name = "PurchaseUtilizationValidationError";
  }
}

export type PurchaseUtilizationServiceDeps = {
  now?: () => string;
  logger?: Logger;
} & (
  | {
      storageService: Pick<StorageService, "loadCollection">;
      collectionMutationService: CollectionMutationService;
    }
  | {
      storageService: Pick<StorageService, "loadCollection"> & CollectionPersistence;
      collectionMutationService?: undefined;
    }
);

function acquisitionMatches(
  game: Game,
  input: AcquisitionMutationRequest,
  purchaseHundredths: number | null,
): boolean {
  if (input.state !== game.acquisition.state) return false;
  if (input.state !== "purchase" || game.acquisition.state !== "purchase") return true;
  return game.acquisition.amount.hundredths === purchaseHundredths;
}

function benchmarkState(benchmark: EntertainmentBenchmark): "unknown" | "configured" | "invalid" {
  return benchmark?.state ?? "unknown";
}

function requestedAcquisitionState(input: unknown): "unknown" | "gift" | "purchase" | "invalid" {
  if (typeof input !== "object" || input === null || !("state" in input)) return "invalid";
  return input.state === "unknown" || input.state === "gift" || input.state === "purchase"
    ? input.state
    : "invalid";
}

export function createPurchaseUtilizationService(
  deps: PurchaseUtilizationServiceDeps,
): PurchaseUtilizationService {
  const { storageService } = deps;
  const collectionMutationService =
    deps.collectionMutationService ?? collectionMutationServiceFor(storageService);
  const now = deps.now ?? (() => new Date().toISOString());
  const logger = deps.logger ?? createLogger("purchase-utilization");
  return {
    async getEntertainmentBenchmark() {
      return (await storageService.loadCollection()).entertainmentBenchmark;
    },

    async setEntertainmentBenchmark(input) {
      const parsed = EntertainmentBenchmarkMutationRequestSchema.safeParse(input);
      if (!parsed.success) {
        logger.warn("benchmark mutation rejected", {
          collectionId: "collection",
          previousState: "unavailable",
          nextState: "configured",
          changedFields: ["entertainmentBenchmark"],
          outcome: "rejected",
          validationCode: "invalid_benchmark_request",
        });
        throw new PurchaseUtilizationValidationError(
          "invalid_benchmark_request",
          parsed.error.issues,
        );
      }
      let persistenceContext:
        | {
            collectionId: string;
            previousState: "unknown" | "configured" | "invalid";
            nextState: "configured";
            changedFields: string[];
          }
        | undefined;
      try {
        const result = await collectionMutationService.mutate(
          { operation: "purchase.benchmark.set", trigger: "owner" },
          (current) => {
            const transition = {
              collectionId: current.id,
              previousState: benchmarkState(current.entertainmentBenchmark),
              nextState: "configured" as const,
            };
            logger.log("benchmark mutation attempt", transition);

            const hundredths = parseAmountInput(parsed.data.amount);
            if (
              current.entertainmentBenchmark?.state === "configured" &&
              current.entertainmentBenchmark.amount.hundredths === hundredths
            ) {
              logger.log("benchmark mutation completed", {
                ...transition,
                changed: false,
                changedFields: [],
                outcome: "unchanged",
              });
              return { changed: false, value: current.entertainmentBenchmark };
            }

            const changedAt = now();
            const changedFields = ["entertainmentBenchmark", "updatedAt"];
            persistenceContext = { ...transition, changedFields };
            logger.log("benchmark persistence attempt", persistenceContext);
            current.entertainmentBenchmark = {
              state: "configured",
              amount: { hundredths, source: "manual", confirmedAt: changedAt },
            };
            current.updatedAt = changedAt;
            return { changed: true, value: current.entertainmentBenchmark };
          },
        );
        if (result.changed && persistenceContext) {
          logger.log("benchmark persistence completed", {
            ...persistenceContext,
            outcome: "persisted",
          });
          logger.log("benchmark mutation completed", {
            ...persistenceContext,
            changed: true,
            outcome: "changed",
          });
        }
        return result.value;
      } catch (error) {
        if (persistenceContext) {
          logger.error("benchmark persistence failed", {
            ...persistenceContext,
            outcome: "failed",
          });
        }
        throw error;
      }
    },

    async clearEntertainmentBenchmark() {
      let persistenceContext:
        | {
            collectionId: string;
            previousState: "unknown" | "configured" | "invalid";
            nextState: "unknown";
            changedFields: string[];
          }
        | undefined;
      try {
        const result = await collectionMutationService.mutate(
          { operation: "purchase.benchmark.clear", trigger: "owner" },
          (current) => {
            const transition = {
              collectionId: current.id,
              previousState: benchmarkState(current.entertainmentBenchmark),
              nextState: "unknown" as const,
            };
            logger.log("benchmark mutation attempt", transition);
            if (current.entertainmentBenchmark === null) {
              logger.log("benchmark mutation completed", {
                ...transition,
                changed: false,
                changedFields: [],
                outcome: "unchanged",
              });
              return { changed: false, value: null };
            }

            const changedAt = now();
            const changedFields = ["entertainmentBenchmark", "updatedAt"];
            persistenceContext = { ...transition, changedFields };
            logger.log("benchmark persistence attempt", persistenceContext);
            current.entertainmentBenchmark = null;
            current.updatedAt = changedAt;
            return { changed: true, value: null };
          },
        );
        if (result.changed && persistenceContext) {
          logger.log("benchmark persistence completed", {
            ...persistenceContext,
            outcome: "persisted",
          });
          logger.log("benchmark mutation completed", {
            ...persistenceContext,
            changed: true,
            outcome: "changed",
          });
        }
        return result.value;
      } catch (error) {
        if (persistenceContext) {
          logger.error("benchmark persistence failed", {
            ...persistenceContext,
            outcome: "failed",
          });
        }
        throw error;
      }
    },

    async setAcquisition(gameId, input) {
      const parsed = AcquisitionMutationRequestSchema.safeParse(input);
      if (!parsed.success) {
        logger.warn("acquisition mutation rejected", {
          collectionId: "collection",
          gameId,
          previousState: "unavailable",
          nextState: requestedAcquisitionState(input),
          changedFields: ["acquisition"],
          outcome: "rejected",
          validationCode: "invalid_acquisition_request",
        });
        throw new PurchaseUtilizationValidationError(
          "invalid_acquisition_request",
          parsed.error.issues,
        );
      }
      let persistenceContext:
        | {
            collectionId: string;
            gameId: string;
            previousState: string;
            nextState: string;
            changedFields: string[];
          }
        | undefined;
      try {
        const result = await collectionMutationService.mutate(
          { operation: "purchase.acquisition.set", trigger: "owner", gameIds: [gameId] },
          (current) => {
            const currentGame = current.games.find((game) => game.id === gameId);
            if (!currentGame) {
              logger.warn("acquisition mutation rejected", {
                collectionId: current.id,
                gameId,
                previousState: "unavailable",
                nextState: parsed.data.state,
                changedFields: ["acquisition"],
                outcome: "rejected",
                validationCode: "game_not_found",
              });
              throw new NotFoundError(`Game not found: ${gameId}`);
            }
            const transition = {
              collectionId: current.id,
              gameId,
              previousState: currentGame.acquisition.state,
              nextState: parsed.data.state,
            };
            logger.log("acquisition mutation attempt", {
              ...transition,
              changedFields: ["acquisition"],
            });

            const purchaseHundredths =
              parsed.data.state === "purchase" ? parseAmountInput(parsed.data.amount) : null;
            if (acquisitionMatches(currentGame, parsed.data, purchaseHundredths)) {
              logger.log("acquisition mutation completed", {
                ...transition,
                changed: false,
                changedFields: [],
                outcome: "unchanged",
              });
              return { changed: false, value: currentGame };
            }

            const game = current.games.find((candidate) => candidate.id === gameId);
            if (!game) throw new NotFoundError(`Game not found: ${gameId}`);
            const changedAt = now();
            if (parsed.data.state === "purchase") {
              if (purchaseHundredths === null) throw new Error("Purchase amount is required");
              game.acquisition = {
                state: "purchase",
                amount: {
                  hundredths: purchaseHundredths,
                  source: "manual",
                  confirmedAt: changedAt,
                },
              };
            } else {
              game.acquisition = { state: parsed.data.state };
            }
            game.updatedAt = changedAt;
            current.updatedAt = changedAt;
            const changedFields = ["acquisition", "game.updatedAt", "collection.updatedAt"];
            persistenceContext = { ...transition, changedFields };
            logger.log("acquisition persistence attempt", persistenceContext);
            return { changed: true, value: game };
          },
        );
        if (result.changed && persistenceContext) {
          logger.log("acquisition persistence completed", {
            ...persistenceContext,
            outcome: "persisted",
          });
          logger.log("acquisition mutation completed", {
            ...persistenceContext,
            changed: true,
            outcome: "changed",
          });
        }
        return result.value;
      } catch (error) {
        if (persistenceContext) {
          logger.error("acquisition persistence failed", {
            ...persistenceContext,
            outcome: "failed",
          });
        }
        throw error;
      }
    },

    enrichGames(games, entertainmentBenchmark, responseKind) {
      const enriched = games.map((entry): GameWithPurchaseUtilization => {
        const displayScore =
          entry.score === null ? null : projectFitnessScore(String(entry.score.score));
        return {
          ...entry,
          displayScore,
          purchaseUtilization: calculatePurchaseUtilization({
            acquisition: entry.game.acquisition,
            entertainmentBenchmark,
            playCount: entry.game.playCountEvidence,
            duration: resolveEffectivePlayingTime(entry.game),
            playerRange: entry.game.playerRangeEvidence,
            suggestedPlayerPoll: entry.game.suggestedPlayerPoll,
            playerCountOverride: resolveEffectivePlayerCount(entry.game, null),
            fitness: displayScore,
          }),
        };
      });
      logger.log("purchase utilization response enrichment completed", {
        responseKind,
        gameCount: enriched.length,
      });
      return enriched;
    },
  };
}
