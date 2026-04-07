import { v4 as uuidv4 } from "uuid";
import {
  AddGameSchema,
  toErrorMessage,
  type Game,
  type AddGameInput,
  type FitnessResult,
  type GameWithScore,
  type AddGameResult,
  type BggSearchResult,
} from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import type { FitnessService } from "./fitness-service.js";
import type { BggClient, BggGameResult } from "./bgg-client.js";
import type { BggCollectionItem } from "./bgg-xml-parser.js";
import { createLogger } from "./logger.js";

const STALE_THRESHOLD_DAYS = 7;
const STALE_THRESHOLD_MS = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

export interface RefreshSummary {
  refreshed: number;
  errors: string[];
}

export interface ImportProgressEvent {
  phase: "fetching-collection" | "importing-games";
  current: number;
  total: number;
  importedSoFar: number;
  gameName?: string;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface GameService {
  addGame(input: AddGameInput): Promise<AddGameResult>;
  getGame(id: string): Promise<GameWithScore>;
  listGames(): Promise<GameWithScore[]>;
  rateGame(id: string, ratings: Record<string, number>): Promise<GameWithScore>;
  removeGame(id: string): Promise<void>;
  searchGames(query: string): Promise<BggSearchResult[]>;
  refreshBggData(gameId: string): Promise<Game>;
  refreshAllBggData(): Promise<RefreshSummary>;
  importBggCollection(
    username: string,
    onProgress?: (event: ImportProgressEvent) => Promise<void> | void,
  ): Promise<ImportSummary>;
}

export interface GameServiceDeps {
  storageService: StorageService;
  fitnessService: FitnessService;
  bggClient?: BggClient;
  onGameDeleted?: (gameId: string) => Promise<void>;
}

function applyBggResult(game: Game, result: BggGameResult): void {
  game.name = result.metadata.name;
  game.yearPublished = result.metadata.yearPublished;
  game.minPlayers = result.metadata.minPlayers;
  game.maxPlayers = result.metadata.maxPlayers;
  game.playingTime = result.metadata.playingTime;
  game.imageUrl = result.metadata.imageUrl;
  game.bggData = result.bggData;
}

function isBggDataStale(game: Game): boolean | undefined {
  if (!game.bggData?.fetchedAt) return undefined;
  const fetchedAt = new Date(game.bggData.fetchedAt).getTime();
  return Date.now() - fetchedAt > STALE_THRESHOLD_MS;
}

export function createGameService(deps: GameServiceDeps): GameService {
  const { storageService, fitnessService, bggClient } = deps;
  const logger = createLogger("import");

  function computeScore(
    game: Game,
    axes: import("@shelf-judge/shared").Axis[],
  ): FitnessResult | null {
    return fitnessService.calculateScore(game, axes, game.bggData);
  }

  function assertBggConfigured(): void {
    if (!bggClient || !bggClient.isConfigured()) {
      throw new Error(
        "BGG integration is not configured. Register at https://boardgamegeek.com/using_the_xml_api and run `shelf-judge config set bgg-token YOUR_TOKEN`.",
      );
    }
  }

  return {
    async addGame(input: AddGameInput): Promise<AddGameResult> {
      const parsed = AddGameSchema.parse(input);
      const collection = await storageService.loadCollection();

      // Duplicate detection: reject if bggId already exists
      if (parsed.bggId !== null && parsed.bggId !== undefined) {
        const existing = collection.games.find((g) => g.bggId === parsed.bggId);
        if (existing) {
          throw new Error(`A game with BGG ID ${parsed.bggId} already exists: "${existing.name}"`);
        }
      }

      const now = new Date().toISOString();
      const game: Game = {
        id: uuidv4(),
        bggId: parsed.bggId ?? null,
        name: parsed.name ?? "",
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

      // Fetch BGG data if bggId is provided and client is available
      let warning: string | undefined;
      let bggImported = false;
      if (game.bggId !== null && bggClient?.isConfigured()) {
        try {
          const result = await bggClient.getGame(game.bggId);
          applyBggResult(game, result);
          bggImported = true;
        } catch (err) {
          warning = `Game added but BGG data could not be fetched: ${toErrorMessage(err)}`;
        }
      }

      collection.games.push(game);
      collection.updatedAt = now;
      await storageService.saveCollection(collection);

      return { game, bggImported, warning };
    },

    async getGame(id: string): Promise<GameWithScore> {
      const collection = await storageService.loadCollection();
      const game = collection.games.find((g) => g.id === id);

      if (!game) {
        throw new Error(`Game not found: ${id}`);
      }

      const score = computeScore(game, collection.axes);
      return { game, score, bggDataStale: isBggDataStale(game) };
    },

    async listGames(): Promise<GameWithScore[]> {
      const collection = await storageService.loadCollection();
      const results: GameWithScore[] = collection.games.map((game) => ({
        game,
        score: computeScore(game, collection.axes),
        bggDataStale: isBggDataStale(game),
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

    async rateGame(id: string, ratings: Record<string, number>): Promise<GameWithScore> {
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
        if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
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
      return { game, score, bggDataStale: isBggDataStale(game) };
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
      await deps.onGameDeleted?.(id);
    },

    async searchGames(query: string): Promise<BggSearchResult[]> {
      assertBggConfigured();
      return bggClient!.searchGames(query);
    },

    async refreshBggData(gameId: string): Promise<Game> {
      assertBggConfigured();
      const collection = await storageService.loadCollection();
      const game = collection.games.find((g) => g.id === gameId);

      if (!game) {
        throw new Error(`Game not found: ${gameId}`);
      }

      if (game.bggId === null) {
        throw new Error(
          `Game "${game.name}" has no BGG ID. Cannot refresh BGG data for manual games.`,
        );
      }

      const result = await bggClient!.getGame(game.bggId);
      applyBggResult(game, result);
      game.updatedAt = new Date().toISOString();
      collection.updatedAt = game.updatedAt;
      await storageService.saveCollection(collection);

      return game;
    },

    async refreshAllBggData(): Promise<RefreshSummary> {
      assertBggConfigured();
      const collection = await storageService.loadCollection();
      const bggGames = collection.games.filter((g) => g.bggId !== null);

      let refreshed = 0;
      const errors: string[] = [];

      // Batch fetch all BGG IDs
      const bggIds = bggGames.map((g) => g.bggId!);
      let bggResults: Map<number, BggGameResult>;
      try {
        bggResults = await bggClient!.getGames(bggIds);
      } catch (err) {
        return {
          refreshed: 0,
          errors: [`Batch fetch failed: ${toErrorMessage(err)}`],
        };
      }

      for (const game of bggGames) {
        const result = bggResults.get(game.bggId!);
        if (result) {
          applyBggResult(game, result);
          game.updatedAt = new Date().toISOString();
          refreshed++;
        } else {
          errors.push(`No BGG data returned for "${game.name}" (BGG ID ${game.bggId})`);
        }
      }

      if (refreshed > 0) {
        collection.updatedAt = new Date().toISOString();
        await storageService.saveCollection(collection);
      }

      return { refreshed, errors };
    },

    async importBggCollection(
      username: string,
      onProgress?: (event: ImportProgressEvent) => Promise<void> | void,
    ): Promise<ImportSummary> {
      assertBggConfigured();
      logger.log(`starting BGG import for "${username}"`);

      await onProgress?.({
        phase: "fetching-collection",
        current: 0,
        total: 0,
        importedSoFar: 0,
      });

      let collectionItems: BggCollectionItem[];
      try {
        collectionItems = await bggClient!.getUserCollection(username);
      } catch (err) {
        logger.error(`failed to fetch collection: ${toErrorMessage(err)}`);
        throw new Error(`Failed to fetch BGG collection for "${username}": ${toErrorMessage(err)}`);
      }

      const collection = await storageService.loadCollection();
      const existingBggIds = new Set(
        collection.games.filter((g) => g.bggId !== null).map((g) => g.bggId!),
      );

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      const total = collectionItems.length;

      const newItems = collectionItems.filter((item) => !existingBggIds.has(item.bggId));
      skipped = collectionItems.length - newItems.length;
      logger.log(`collection: ${total} total, ${newItems.length} new, ${skipped} already exist`);

      // Signal the total before batch fetch starts so the UI can show "0 / N"
      // during the slow BGG API calls instead of "0 / 0".
      await onProgress?.({
        phase: "importing-games",
        current: skipped,
        total,
        importedSoFar: 0,
      });

      const itemsByBggId = new Map(newItems.map((item) => [item.bggId, item]));

      // Process each batch as it arrives so progress events are paced by
      // actual network requests instead of firing all at once.
      if (newItems.length > 0) {
        const newBggIds = newItems.map((item) => item.bggId);
        try {
          await bggClient!.getGames(newBggIds, async (batch) => {
            for (const [bggId, result] of batch.results) {
              const item = itemsByBggId.get(bggId);
              const gameName = item?.name ?? result.metadata.name;

              await onProgress?.({
                phase: "importing-games",
                current: skipped + imported + errors.length + 1,
                total,
                importedSoFar: imported,
                gameName,
              });

              const now = new Date().toISOString();
              const game: Game = {
                id: uuidv4(),
                bggId,
                name: result.metadata.name,
                yearPublished: result.metadata.yearPublished,
                minPlayers: result.metadata.minPlayers,
                maxPlayers: result.metadata.maxPlayers,
                playingTime: result.metadata.playingTime,
                imageUrl: result.metadata.imageUrl,
                bggData: result.bggData,
                ratings: {},
                createdAt: now,
                updatedAt: now,
              };

              collection.games.push(game);
              imported++;
            }

            for (const id of batch.batchIds) {
              if (!batch.results.has(id)) {
                const item = itemsByBggId.get(id);
                const name = item?.name ?? `BGG ID ${id}`;
                logger.warn(`no BGG data for "${name}" (BGG ID ${id})`);
                errors.push(`Failed to fetch full data for "${name}" (BGG ID ${id})`);
              }
            }
          });
        } catch (err) {
          logger.error(`batch fetch failed: ${toErrorMessage(err)}`);
          errors.push(`Batch fetch failed: ${toErrorMessage(err)}`);
        }
      }

      if (imported > 0) {
        collection.updatedAt = new Date().toISOString();
        await storageService.saveCollection(collection);
      }
      logger.log(`complete: ${imported} imported, ${skipped} skipped, ${errors.length} errors`);

      return { imported, skipped, errors };
    },
  };
}
