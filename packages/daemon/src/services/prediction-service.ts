import type {
  Game,
  GameWithScore,
  FitnessResult,
  PredictionReadiness,
  PredictionSettings,
  PredictionUnavailable,
  RevealedPreferenceTension,
} from "@shelf-judge/shared";
import { resolveAxisValues } from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import type { FitnessService } from "./fitness-service.js";
import type { TournamentService } from "./tournament-service.js";
import type { BggClient } from "./bgg-client.js";
import { buildVocabulary, computeContinuousRanges, encodeGame } from "./feature-vector.js";
import type { FeatureVector } from "./feature-vector.js";
import {
  computePredictedFitness,
  assessReadiness,
  detectRevealedPreferenceTension,
} from "./prediction-engine.js";
import type {
  ReferenceGameCandidate,
  TournamentRankedGame,
  ClusterMembership,
} from "./prediction-engine.js";

export interface PredictedGameResult {
  game: Game;
  score: FitnessResult;
  tension: RevealedPreferenceTension | null;
  predictionUnavailable: PredictionUnavailable | null;
}

export interface PredictionService {
  predictGame(gameId: string): Promise<PredictedGameResult>;
  predictBggGame(bggId: number): Promise<PredictedGameResult>;
  getReadiness(): Promise<PredictionReadiness>;
  listGamesWithPredictions(): Promise<GameWithScore[]>;
  getSettings(): Promise<PredictionSettings>;
  updateSettings(patch: Partial<PredictionSettings>): Promise<PredictionSettings>;
}

export interface PredictionServiceDeps {
  storageService: StorageService;
  fitnessService: FitnessService;
  tournamentService: TournamentService;
  bggClient?: BggClient;
}

function flattenVector(fv: FeatureVector): number[] {
  return [...fv.binary, ...fv.continuous, ...(fv.personalAxes ?? [])];
}

export function createPredictionService(deps: PredictionServiceDeps): PredictionService {
  const { storageService, fitnessService, tournamentService, bggClient } = deps;

  async function loadPredictionContext() {
    const [collection, settings] = await Promise.all([
      storageService.loadCollection(),
      storageService.loadPredictionSettings(),
    ]);
    // Tournament calls share loadTournament() internally, so serialize them
    // to avoid concurrent writes to the same file on first access.
    const tournamentSettings = await tournamentService.getSettings();
    const allGameStats = await tournamentService.getAllGameStats();

    const { games, axes } = collection;
    const gamesWithBgg = games.filter((g) => g.bggData !== null && g.bggData !== undefined);

    const vocabulary = buildVocabulary(gamesWithBgg);
    const ranges = computeContinuousRanges(gamesWithBgg);

    // Build game ratings map and feature vectors
    const gameRatings = new Map<string, Record<string, number>>();
    const gameVectors = new Map<string, number[]>();

    for (const game of games) {
      const ratings: Record<string, number> = {};
      for (const axis of axes) {
        if (axis.source === "personal" && game.ratings?.[axis.id] !== undefined) {
          ratings[axis.id] = game.ratings[axis.id];
        }
      }
      if (Object.keys(ratings).length > 0) {
        gameRatings.set(game.id, ratings);
      }

      if (game.bggData) {
        const resolved = resolveAxisValues(game, axes);
        const fv = encodeGame(
          game,
          vocabulary,
          Object.keys(resolved).length > 0 ? resolved : undefined,
          ranges,
          axes,
        );
        gameVectors.set(game.id, flattenVector(fv));
      }
    }

    // Build reference game candidates: games with at least one personal axis rating and BGG data
    const referenceGames: ReferenceGameCandidate[] = [];
    for (const game of games) {
      const ratings = gameRatings.get(game.id);
      const vector = gameVectors.get(game.id);
      if (!ratings || !vector) continue;

      const stats = allGameStats[game.id];
      const comparisonCount = stats?.comparisonCount ?? 0;
      const provisionalThreshold = tournamentSettings.provisionalThreshold;

      // REQ-PRED-18: when no tournament data, stability is 1.0
      let tournamentStability = 1.0;
      if (comparisonCount >= provisionalThreshold) {
        tournamentStability = 1.0 + settings.tournamentStabilityBoost;
      }

      referenceGames.push({
        gameId: game.id,
        gameName: game.name,
        vector,
        ratings,
        tournamentStability,
      });
    }

    // Count rated games (games with at least one personal axis rating)
    const ratedGameCount = gameRatings.size;

    // Compute readiness stage
    const [t1, t2, t3] = settings.stageThresholds;
    let readinessStage: 0 | 1 | 2 | 3;
    if (ratedGameCount >= t3) readinessStage = 3;
    else if (ratedGameCount >= t2) readinessStage = 2;
    else if (ratedGameCount >= t1) readinessStage = 1;
    else readinessStage = 0;

    // Build tournament-ranked games for tension detection
    const tournamentRankedGames: TournamentRankedGame[] = [];
    for (const game of games) {
      const stats = allGameStats[game.id];
      if (!stats || stats.normalizedScore === null) continue;
      const vector = gameVectors.get(game.id);
      if (!vector) continue;

      tournamentRankedGames.push({
        gameId: game.id,
        gameName: game.name,
        vector,
        normalizedScore: stats.normalizedScore,
      });
    }

    return {
      games,
      axes,
      vocabulary,
      ranges,
      gameRatings,
      gameVectors,
      referenceGames,
      ratedGameCount,
      readinessStage,
      settings,
      tournamentRankedGames,
    };
  }

  return {
    async predictGame(gameId: string): Promise<PredictedGameResult> {
      const ctx = await loadPredictionContext();
      const game = ctx.games.find((g) => g.id === gameId);
      if (!game) throw new Error(`Game not found: ${gameId}`);
      if (!game.bggData)
        throw new Error(`Game "${game.name}" has no BGG data; prediction requires BGG data.`);

      const targetVector = ctx.gameVectors.get(gameId);
      if (!targetVector) {
        throw new Error(`Could not compute feature vector for game "${game.name}".`);
      }

      const { fitnessResult } = computePredictedFitness(
        game,
        ctx.axes,
        game.bggData,
        ctx.referenceGames,
        targetVector,
        ctx.settings,
        ctx.readinessStage,
        (g, a, b) => fitnessService.calculateScore(g, a, b),
      );

      // Detect revealed preference tension if tournament data exists
      let tension: RevealedPreferenceTension | null = null;
      if (ctx.tournamentRankedGames.length > 0 && fitnessResult.predictionMeta) {
        tension = detectRevealedPreferenceTension(
          fitnessResult.score,
          targetVector,
          ctx.tournamentRankedGames,
          ctx.settings.defaultK,
          ctx.settings.minSimilarityThreshold,
        );
      }

      // REQ-PRED-22: indicate when personal-axis prediction is unavailable at Stage 0
      let predictionUnavailable: PredictionUnavailable | null = null;
      if (ctx.readinessStage === 0) {
        const nextStageAt = ctx.settings.stageThresholds[0];
        predictionUnavailable = {
          reason: "stage-0",
          ratedGameCount: ctx.ratedGameCount,
          gamesNeeded: nextStageAt - ctx.ratedGameCount,
        };
      }

      return { game, score: fitnessResult, tension, predictionUnavailable };
    },

    async predictBggGame(bggId: number): Promise<PredictedGameResult> {
      if (!bggClient) {
        throw new Error("BGG integration is not configured. Cannot predict games by BGG ID.");
      }

      // Check if this bggId already exists in the collection
      const ctx = await loadPredictionContext();
      const existingGame = ctx.games.find((g) => g.bggId === bggId);
      if (existingGame) {
        // Delegate to existing predictGame path
        return this.predictGame(existingGame.id);
      }

      // Fetch BGG data for the game
      const bggResult = await bggClient.getGame(bggId);

      // Build a temporary Game object (not persisted)
      const now = new Date().toISOString();
      const tempGame: Game = {
        id: `preview-${bggId}`,
        bggId,
        name: bggResult.metadata.name,
        yearPublished: bggResult.metadata.yearPublished,
        minPlayers: bggResult.metadata.minPlayers,
        maxPlayers: bggResult.metadata.maxPlayers,
        playingTime: bggResult.metadata.playingTime,
        imageUrl: bggResult.metadata.imageUrl,
        numPlays: bggResult.collectionData?.numPlays ?? null,
        bggData: bggResult.bggData,
        ownership: "owned",
        boxDimensions: null,
        ratings: {},
        createdAt: now,
        updatedAt: now,
      };

      // Encode the temporary game using the collection's vocabulary and ranges
      const resolved = resolveAxisValues(tempGame, ctx.axes);
      const fv = encodeGame(
        tempGame,
        ctx.vocabulary,
        Object.keys(resolved).length > 0 ? resolved : undefined,
        ctx.ranges,
        ctx.axes,
      );
      const targetVector = flattenVector(fv);

      const { fitnessResult } = computePredictedFitness(
        tempGame,
        ctx.axes,
        bggResult.bggData,
        ctx.referenceGames,
        targetVector,
        ctx.settings,
        ctx.readinessStage,
        (g, a, b) => fitnessService.calculateScore(g, a, b),
      );

      // Detect revealed preference tension if tournament data exists
      let tension: RevealedPreferenceTension | null = null;
      if (ctx.tournamentRankedGames.length > 0 && fitnessResult.predictionMeta) {
        tension = detectRevealedPreferenceTension(
          fitnessResult.score,
          targetVector,
          ctx.tournamentRankedGames,
          ctx.settings.defaultK,
          ctx.settings.minSimilarityThreshold,
        );
      }

      // REQ-PRED-22: indicate when personal-axis prediction is unavailable at Stage 0
      let predictionUnavailable: PredictionUnavailable | null = null;
      if (ctx.readinessStage === 0) {
        const nextStageAt = ctx.settings.stageThresholds[0];
        predictionUnavailable = {
          reason: "stage-0",
          ratedGameCount: ctx.ratedGameCount,
          gamesNeeded: nextStageAt - ctx.ratedGameCount,
        };
      }

      return { game: tempGame, score: fitnessResult, tension, predictionUnavailable };
    },

    async getReadiness(): Promise<PredictionReadiness> {
      const [collection, settings] = await Promise.all([
        storageService.loadCollection(),
        storageService.loadPredictionSettings(),
      ]);

      const { games, axes } = collection;
      const gamesWithBgg = games.filter((g) => g.bggData !== null && g.bggData !== undefined);
      const vocabulary = buildVocabulary(gamesWithBgg);

      const gameRatings = new Map<string, Record<string, number>>();
      for (const game of games) {
        const ratings: Record<string, number> = {};
        for (const axis of axes) {
          if (axis.source === "personal" && game.ratings?.[axis.id] !== undefined) {
            ratings[axis.id] = game.ratings[axis.id];
          }
        }
        if (Object.keys(ratings).length > 0) {
          gameRatings.set(game.id, ratings);
        }
      }

      // Build cluster membership for suggested actions
      const clusterMembership: ClusterMembership = new Map();
      for (const game of games) {
        if (!game.bggData) continue;
        for (const mech of game.bggData.mechanics) {
          if (!clusterMembership.has(mech.name)) {
            clusterMembership.set(mech.name, new Set());
          }
          clusterMembership.get(mech.name)!.add(game.id);
        }
        for (const cat of game.bggData.categories) {
          if (!clusterMembership.has(cat.name)) {
            clusterMembership.set(cat.name, new Set());
          }
          clusterMembership.get(cat.name)!.add(game.id);
        }
      }

      return assessReadiness(
        gameRatings.size,
        axes,
        gameRatings,
        vocabulary,
        settings,
        clusterMembership,
      );
    },

    async listGamesWithPredictions(): Promise<GameWithScore[]> {
      const ctx = await loadPredictionContext();
      const results: GameWithScore[] = [];

      for (const game of ctx.games) {
        const actualScore = fitnessService.calculateScore(game, ctx.axes, game.bggData ?? null);

        // If all axes are rated (or no prediction possible), use actual score
        const allRated = actualScore && actualScore.ratedAxisCount === ctx.axes.length;
        const noBggData = !game.bggData;

        if (allRated || noBggData) {
          results.push({ game, score: actualScore });
          continue;
        }

        // Run prediction for this game
        const targetVector = ctx.gameVectors.get(game.id);
        if (!targetVector) {
          results.push({ game, score: actualScore });
          continue;
        }

        const { fitnessResult } = computePredictedFitness(
          game,
          ctx.axes,
          game.bggData,
          ctx.referenceGames,
          targetVector,
          ctx.settings,
          ctx.readinessStage,
          (g, a, b) => fitnessService.calculateScore(g, a, b),
        );

        results.push({ game, score: fitnessResult });
      }

      // Sort by fitness descending, unscored at end
      results.sort((a, b) => {
        if (a.score !== null && b.score !== null) return b.score.score - a.score.score;
        if (a.score !== null) return -1;
        if (b.score !== null) return 1;
        return 0;
      });

      return results;
    },

    async getSettings(): Promise<PredictionSettings> {
      return storageService.loadPredictionSettings();
    },

    async updateSettings(patch: Partial<PredictionSettings>): Promise<PredictionSettings> {
      const current = await storageService.loadPredictionSettings();
      const updated: PredictionSettings = { ...current, ...patch };
      await storageService.savePredictionSettings(updated);
      return updated;
    },
  };
}
