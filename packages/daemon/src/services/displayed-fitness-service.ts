import type {
  CollectionProfileCollectionSource,
  Game,
  GameWithScore,
  PredictionSettings,
  RedundancySettings,
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
}

export interface DisplayedFitnessService {
  listGames(options: DisplayedFitnessOptions): Promise<DisplayedGameFitness[]>;
  listGamesFromSnapshot(
    snapshot: {
      collection: CollectionProfileCollectionSource;
      tournament: TournamentData;
      predictionSettings: PredictionSettings;
      redundancySettings: RedundancySettings;
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

export function createDisplayedFitnessService(
  deps: DisplayedFitnessServiceDeps,
): DisplayedFitnessService {
  const { gameService, predictionService, storageService } = deps;

  return {
    async listGames(options): Promise<DisplayedGameFitness[]> {
      let predictedGames: GameWithScore[] | undefined;
      const getPredictedGames = async (): Promise<GameWithScore[]> => {
        if (!predictionService) return gameService.listGames();
        predictedGames ??= await predictionService.listGamesWithPredictions();
        return predictedGames;
      };

      const allGames =
        options.includePredicted && predictionService
          ? await getPredictedGames()
          : await gameService.listGames();
      const ownedGames = allGames.filter((entry) => entry.game.ownership !== "previously-owned");

      if (options.includeNiches && predictionService) {
        const nicheSettings = storageService ? await storageService.loadNicheSettings() : undefined;
        const nicheUniverse = options.includePredicted
          ? ownedGames
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
          !options.includePredicted && predictionService
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
      if (!predictionService?.listGamesWithPredictionsFromSnapshot) {
        throw new Error("Snapshot fitness requires prediction service");
      }
      if (!options.includePredicted) {
        throw new Error("Snapshot fitness currently supports prediction-enabled display only");
      }
      const collection = structuredClone(snapshot.collection);
      const tournament = structuredClone(snapshot.tournament);
      const predicted = await predictionService.listGamesWithPredictionsFromSnapshot(
        collection,
        tournament,
        structuredClone(snapshot.predictionSettings),
      );
      const allGames = predicted;
      const ownedGames = allGames.filter((entry) => entry.game.ownership !== "previously-owned");
      applyRedundancy(
        ownedGames,
        structuredClone(snapshot.redundancySettings),
        collection,
        tournament,
      );
      return allGames.map((entry) => ({
        ...entry,
        hasPredictedContribution: hasPredictedContribution(entry),
        hasScoringContribution: hasScoringContribution(entry),
      }));
    },
  };
}
