import { v4 as uuidv4 } from "uuid";
import {
  AddGameSchema,
  type Game,
  type AddGameInput,
  type FitnessResult,
} from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import type { FitnessService } from "./fitness-service.js";

export interface GameWithScore {
  game: Game;
  score: FitnessResult | null;
}

export interface GameService {
  addGame(input: AddGameInput): Promise<Game>;
  getGame(id: string): Promise<GameWithScore>;
  listGames(): Promise<GameWithScore[]>;
  rateGame(
    id: string,
    ratings: Record<string, number>,
  ): Promise<GameWithScore>;
  removeGame(id: string): Promise<void>;
}

export interface GameServiceDeps {
  storageService: StorageService;
  fitnessService: FitnessService;
}

export function createGameService(deps: GameServiceDeps): GameService {
  const { storageService, fitnessService } = deps;

  function computeScore(game: Game, axes: import("@shelf-judge/shared").Axis[]): FitnessResult | null {
    return fitnessService.calculateScore(game, axes, game.bggData);
  }

  return {
    async addGame(input: AddGameInput): Promise<Game> {
      const parsed = AddGameSchema.parse(input);
      const collection = await storageService.loadCollection();

      // Duplicate detection: reject if bggId already exists
      if (parsed.bggId !== null && parsed.bggId !== undefined) {
        const existing = collection.games.find(
          (g) => g.bggId === parsed.bggId,
        );
        if (existing) {
          throw new Error(
            `A game with BGG ID ${parsed.bggId} already exists: "${existing.name}"`,
          );
        }
      }

      const now = new Date().toISOString();
      const game: Game = {
        id: uuidv4(),
        bggId: parsed.bggId ?? null,
        name: parsed.name,
        yearPublished: parsed.yearPublished ?? null,
        minPlayers: parsed.minPlayers ?? null,
        maxPlayers: parsed.maxPlayers ?? null,
        playingTime: parsed.playingTime ?? null,
        imageUrl: parsed.imageUrl ?? null,
        bggData: null,
        ratings: {},
        createdAt: now,
        updatedAt: now,
      };

      collection.games.push(game);
      collection.updatedAt = now;
      await storageService.saveCollection(collection);

      return game;
    },

    async getGame(id: string): Promise<GameWithScore> {
      const collection = await storageService.loadCollection();
      const game = collection.games.find((g) => g.id === id);

      if (!game) {
        throw new Error(`Game not found: ${id}`);
      }

      const score = computeScore(game, collection.axes);
      return { game, score };
    },

    async listGames(): Promise<GameWithScore[]> {
      const collection = await storageService.loadCollection();
      const results: GameWithScore[] = collection.games.map((game) => ({
        game,
        score: computeScore(game, collection.axes),
      }));

      // Sort by fitness descending, unscored at end
      results.sort((a, b) => {
        if (a.score !== null && b.score !== null) {
          return b.score.score - a.score.score;
        }
        if (a.score !== null) return -1;
        if (b.score !== null) return 1;
        return 0;
      });

      return results;
    },

    async rateGame(
      id: string,
      ratings: Record<string, number>,
    ): Promise<GameWithScore> {
      const collection = await storageService.loadCollection();
      const game = collection.games.find((g) => g.id === id);

      if (!game) {
        throw new Error(`Game not found: ${id}`);
      }

      // Validate each rating
      for (const [axisId, rating] of Object.entries(ratings)) {
        const axis = collection.axes.find((a) => a.id === axisId);
        if (!axis) {
          throw new Error(`Axis not found: ${axisId}`);
        }
        if (
          !Number.isInteger(rating) ||
          rating < 1 ||
          rating > 10
        ) {
          throw new Error(
            `Rating must be an integer between 1 and 10, got ${rating} for axis "${axis.name}"`,
          );
        }
      }

      // Apply ratings
      for (const [axisId, rating] of Object.entries(ratings)) {
        game.ratings[axisId] = rating;
      }

      game.updatedAt = new Date().toISOString();
      collection.updatedAt = game.updatedAt;
      await storageService.saveCollection(collection);

      const score = computeScore(game, collection.axes);
      return { game, score };
    },

    async removeGame(id: string): Promise<void> {
      const collection = await storageService.loadCollection();
      const index = collection.games.findIndex((g) => g.id === id);

      if (index === -1) {
        throw new Error(`Game not found: ${id}`);
      }

      collection.games.splice(index, 1);
      collection.updatedAt = new Date().toISOString();
      await storageService.saveCollection(collection);
    },
  };
}
