import type { Game, GameWithScore, RedundancySettings } from "@shelf-judge/shared";
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

async function applyRedundancy(
  games: GameWithScore[],
  settings: RedundancySettings,
  storageService: StorageService,
  universe?: GameWithScore[],
): Promise<void> {
  if (!settings.enabled) return;

  const computeGames = universe ?? games;
  const [collection, tournamentData] = await Promise.all([
    storageService.loadCollection(),
    storageService.loadTournament(),
  ]);
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
        await applyRedundancy(ownedGames, redundancySettings, storageService, universe);
      }

      return allGames.map((entry) => ({
        ...entry,
        hasPredictedContribution: hasPredictedContribution(entry),
        hasScoringContribution: hasScoringContribution(entry),
      }));
    },
  };
}
