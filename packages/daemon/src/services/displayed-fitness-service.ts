import type {
  CollectionProfileCollectionSource,
  Game,
  GameWithScore,
  PredictionSettings,
  RedundancySettings,
  NicheSettings,
  TournamentData,
} from "@shelf-judge/shared";
import type { GameService } from "./game-service.js";
import type { PredictionService } from "./prediction-service.js";
import type { StorageService } from "./storage-service.js";
import { computeNichePositions } from "./niche-engine.js";
import { computeRedundancyAdjustments } from "./redundancy-engine.js";
import {
  buildVocabulary,
  computeContinuousRanges,
  encodeGame,
  getOrderedVectorAxes,
  getVectorAxisValues,
  type FeatureVector,
} from "./feature-vector.js";
import { deriveDisplayStats } from "./tournament-service.js";

export interface DisplayedGameFitness extends GameWithScore {
  hasPredictedContribution: boolean;
  hasScoringContribution: boolean;
}

export interface DisplayedFitnessOptions {
  includePredicted: boolean;
  includeNiches?: boolean;
  /** Limits returned work to owned games. Omitted retains the established full result. */
  targetGameIds?: readonly string[];
}

export interface DisplayedFitnessService {
  listGames(options: DisplayedFitnessOptions): Promise<DisplayedGameFitness[]>;
  listGamesFromSnapshot(
    snapshot: {
      collection: CollectionProfileCollectionSource;
      tournament: TournamentData;
      predictionSettings: PredictionSettings;
      redundancySettings: RedundancySettings;
      nicheSettings?: NicheSettings;
    },
    options: DisplayedFitnessOptions,
  ): Promise<DisplayedGameFitness[]>;
}

export interface DisplayedFitnessServiceDeps {
  gameService: GameService;
  predictionService?: PredictionService;
  storageService?: StorageService;
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
): void {
  if (!settings.enabled) return;

  const computeGames = universe ?? games;
  const gamesWithBgg = collection.games.filter((game) => game.bggData);
  const vocabulary = buildVocabulary(gamesWithBgg);
  const ranges = computeContinuousRanges(gamesWithBgg);
  const vectorAxes = getOrderedVectorAxes(collection.axes);
  const vectorCache = new Map<string, FeatureVector>();
  const getFeatureVector = (game: Game): FeatureVector => {
    const cached = vectorCache.get(game.id);
    if (cached) return cached;
    const values = getVectorAxisValues(
      game,
      vectorAxes,
      deriveDisplayStats(game.id, tournamentData).normalizedScore,
    );
    const vector = encodeGame(game, vocabulary, vectorAxes, values, ranges);
    vectorCache.set(game.id, vector);
    return vector;
  };

  const adjustments = computeRedundancyAdjustments(computeGames, settings, getFeatureVector);
  for (const entry of games) {
    if (!entry.score) continue;
    const adjustment = adjustments.get(entry.game.id) ?? null;
    entry.score.redundancyAdjustment = adjustment;
    if (adjustment && settings.stage === "integrated") {
      entry.score.score = adjustment.adjustedScore;
    }
  }
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
  const { gameService, predictionService, storageService } = deps;

  return {
    async listGames(options): Promise<DisplayedGameFitness[]> {
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
        const universe =
          (!options.includePredicted || targets !== undefined) && predictionService
            ? (await getPredictedGames()).filter(
                (entry) => entry.game.ownership !== "previously-owned",
              )
            : undefined;
        if (redundancySettings.enabled) {
          const [collection, tournament] = await Promise.all([
            storageService.loadCollection(),
            storageService.loadTournament(),
          ]);
          applyRedundancy(ownedGames, redundancySettings, collection, tournament, universe);
        }
      }

      return allGames.map((entry) => ({
        ...entry,
        hasPredictedContribution: hasPredictedContribution(entry),
        hasScoringContribution: hasScoringContribution(entry),
      }));
    },

    async listGamesFromSnapshot(snapshot, options): Promise<DisplayedGameFitness[]> {
      const targets = targetIds(options);
      const collection = structuredClone(snapshot.collection);
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
      applyRedundancy(
        ownedGames,
        structuredClone(snapshot.redundancySettings),
        collection,
        tournament,
        redundancyUniverse,
      );
      return allGames.map((entry) => ({
        ...entry,
        hasPredictedContribution: hasPredictedContribution(entry),
        hasScoringContribution: hasScoringContribution(entry),
      }));
    },
  };
}
