import { v4 as uuidv4 } from "uuid";
import type { WishlistEntry, WishlistBreakdownEntry, NicheImpact } from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import type { PredictionService, PredictedGameResult } from "./prediction-service.js";
import type { GameService } from "./game-service.js";
import { computeNicheImpact } from "./niche-engine.js";

export interface WishlistService {
  list(): Promise<WishlistEntry[]>;
  add(bggId: number): Promise<WishlistEntry>;
  remove(id: string): Promise<void>;
  clear(): Promise<number>;
  refresh(id: string): Promise<WishlistEntry>;
  refreshAll(): Promise<{ refreshed: number; errors: string[] }>;
  removeByBggId(bggId: number): Promise<boolean>;
}

export interface WishlistServiceDeps {
  storageService: StorageService;
  predictionService: PredictionService;
  gameService: GameService;
}

function buildEntry(
  bggId: number,
  result: PredictedGameResult,
  nicheImpact: NicheImpact,
): WishlistEntry {
  const isUnavailable = result.predictionUnavailable !== null;

  let predictedBreakdown: WishlistBreakdownEntry[] | null = null;
  if (!isUnavailable && result.score.breakdown) {
    predictedBreakdown = result.score.breakdown
      .filter((b) => b.rating !== null)
      .map((b) => ({
        axisName: b.axisName,
        rating: b.rating!,
        confidence: b.predictionConfidence ?? "strong",
      }));
  }

  return {
    id: uuidv4(),
    bggId,
    name: result.game.name,
    yearPublished: result.game.yearPublished,
    thumbnailUrl: result.game.imageUrl,
    predictedScore: isUnavailable ? null : result.score.score,
    predictionConfidence: isUnavailable ? null : (result.score.predictionMeta?.confidence ?? null),
    predictedBreakdown,
    nicheImpact: nicheImpact.wouldJoin.length > 0 ? nicheImpact : null,
    addedAt: new Date().toISOString(),
  };
}

async function computeNicheImpactForResult(
  predictionService: PredictionService,
  storageService: StorageService,
  result: PredictedGameResult,
): Promise<NicheImpact> {
  const nicheSettings = await storageService.loadNicheSettings();
  const allGames = await predictionService.listGamesWithPredictions();
  return computeNicheImpact(allGames, result.game, result.score, nicheSettings);
}

export function createWishlistService(deps: WishlistServiceDeps): WishlistService {
  const { storageService, predictionService } = deps;

  return {
    async list(): Promise<WishlistEntry[]> {
      return storageService.loadWishlist();
    },

    async add(bggId: number): Promise<WishlistEntry> {
      const wishlist = await storageService.loadWishlist();
      if (wishlist.some((e) => e.bggId === bggId)) {
        throw new Error("This game is already on your wishlist");
      }

      const collection = await storageService.loadCollection();
      if (collection.games.some((g) => g.bggId === bggId)) {
        throw new Error("This game is already in your collection");
      }

      const result = await predictionService.predictBggGame(bggId);
      const nicheImpact = await computeNicheImpactForResult(
        predictionService,
        storageService,
        result,
      );

      const entry = buildEntry(bggId, result, nicheImpact);
      wishlist.push(entry);
      await storageService.saveWishlist(wishlist);
      return entry;
    },

    async remove(id: string): Promise<void> {
      const wishlist = await storageService.loadWishlist();
      const index = wishlist.findIndex((e) => e.id === id);
      if (index === -1) {
        throw new Error(`Wishlist entry not found: ${id}`);
      }
      wishlist.splice(index, 1);
      await storageService.saveWishlist(wishlist);
    },

    async clear(): Promise<number> {
      const wishlist = await storageService.loadWishlist();
      const count = wishlist.length;
      await storageService.saveWishlist([]);
      return count;
    },

    async refresh(id: string): Promise<WishlistEntry> {
      const wishlist = await storageService.loadWishlist();
      const index = wishlist.findIndex((e) => e.id === id);
      if (index === -1) {
        throw new Error(`Wishlist entry not found: ${id}`);
      }

      const existing = wishlist[index];
      const result = await predictionService.predictBggGame(existing.bggId);
      const nicheImpact = await computeNicheImpactForResult(
        predictionService,
        storageService,
        result,
      );

      const updated = buildEntry(existing.bggId, result, nicheImpact);
      // Preserve original id and addedAt (REQ-WISH-11)
      updated.id = existing.id;
      updated.addedAt = existing.addedAt;

      wishlist[index] = updated;
      await storageService.saveWishlist(wishlist);
      return updated;
    },

    async refreshAll(): Promise<{ refreshed: number; errors: string[] }> {
      const wishlist = await storageService.loadWishlist();
      let refreshed = 0;
      const errors: string[] = [];

      for (let i = 0; i < wishlist.length; i++) {
        const existing = wishlist[i];
        try {
          const result = await predictionService.predictBggGame(existing.bggId);
          const nicheImpact = await computeNicheImpactForResult(
            predictionService,
            storageService,
            result,
          );

          const updated = buildEntry(existing.bggId, result, nicheImpact);
          updated.id = existing.id;
          updated.addedAt = existing.addedAt;
          wishlist[i] = updated;
          refreshed++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`${existing.name}: ${message}`);
        }
      }

      await storageService.saveWishlist(wishlist);
      return { refreshed, errors };
    },

    async removeByBggId(bggId: number): Promise<boolean> {
      const wishlist = await storageService.loadWishlist();
      const index = wishlist.findIndex((e) => e.bggId === bggId);
      if (index === -1) return false;
      wishlist.splice(index, 1);
      await storageService.saveWishlist(wishlist);
      return true;
    },
  };
}
