import { v4 as uuidv4 } from "uuid";
import {
  toErrorMessage,
  type WishlistEntry,
  type WishlistBreakdownEntry,
  type NicheImpact,
  type RedundancyAdjustment,
  type WishlistBggSourceSnapshot,
  type WishlistEntryReadResult,
  WishlistBggSourceSnapshotSchema,
} from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import type { PredictionService, PredictedGameResult } from "./prediction-service.js";
import type { GameService } from "./game-service.js";
import { computeNicheImpact } from "./niche-engine.js";
import { computeRedundancyPreview } from "./redundancy-preview.js";
import {
  computeWishlistRedundancyReadResults,
  savedWishlistRedundancyReadResults,
  WishlistRedundancyCaptureChangedError,
  type WishlistDescriptionSignalResolver,
} from "./wishlist-redundancy-scoring.js";
import {
  canonicalSha256,
  profileSourceCoordinatorFor,
  type ProfileSourceCoordinator,
} from "./profile-source-coordinator.js";

export interface WishlistService {
  list(): Promise<WishlistEntry[]>;
  listWithCurrentRedundancy(): Promise<WishlistEntryReadResult[]>;
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
  resolveWishlistDescriptionSignal?: WishlistDescriptionSignalResolver;
  coordinator?: ProfileSourceCoordinator;
}

function buildEntry(
  bggId: number,
  result: PredictedGameResult,
  nicheImpact: NicheImpact,
  redundancyPreview: RedundancyAdjustment | null,
): WishlistEntry {
  const isUnavailable = result.predictionUnavailable !== null;

  let predictedBreakdown: WishlistBreakdownEntry[] | null = null;
  if (!isUnavailable && result.score.breakdown) {
    predictedBreakdown = result.score.breakdown.flatMap((breakdown) =>
      breakdown.effectiveRating === null
        ? []
        : [
            {
              axisName: breakdown.axisName,
              rating: breakdown.effectiveRating,
              confidence: breakdown.predictionConfidence ?? "weak",
            },
          ],
    );
  }

  const scoringInput = result.verifiedScoringInput;
  if (
    !scoringInput ||
    scoringInput.bggId !== bggId ||
    scoringInput.type !== "boardgame" ||
    !scoringInput.primaryName ||
    !Number.isFinite(Date.parse(scoringInput.observedAt))
  ) {
    throw new Error(`Verified BGG scoring input unavailable or mismatched for ${bggId}`);
  }
  const bggSource: WishlistBggSourceSnapshot = WishlistBggSourceSnapshotSchema.parse({
    observedAt: scoringInput.observedAt,
    description: scoringInput.description,
    mechanics: scoringInput.mechanics.map((item) => item.name),
    categories: scoringInput.categories.map((item) => item.name),
    weight: scoringInput.weight,
    communityRating: scoringInput.communityRating,
    minPlayers: scoringInput.minPlayers,
    maxPlayers: scoringInput.maxPlayers,
    bestPlayers: scoringInput.bestPlayers,
    playingTime: scoringInput.playingTime,
  });

  return {
    id: uuidv4(),
    bggId,
    name: scoringInput?.primaryName ?? result.game.name,
    yearPublished: scoringInput?.yearPublished ?? result.game.yearPublished,
    thumbnailUrl: result.game.imageUrl,
    predictedScore: isUnavailable ? null : result.score.score,
    predictionConfidence: isUnavailable ? null : (result.score.predictionMeta?.confidence ?? null),
    predictedBreakdown,
    nicheImpact: nicheImpact.wouldJoin.length > 0 ? nicheImpact : null,
    redundancyPreview,
    bggSource,
    addedAt: new Date().toISOString(),
  };
}

function computeNicheImpactForResult(
  result: PredictedGameResult,
  allGames: Awaited<ReturnType<PredictionService["listGamesWithPredictions"]>>,
  nicheSettings: Awaited<ReturnType<StorageService["loadNicheSettings"]>>,
): NicheImpact {
  return computeNicheImpact(allGames, result.game, result.score, nicheSettings);
}

export function createWishlistService(deps: WishlistServiceDeps): WishlistService {
  const { storageService, predictionService } = deps;
  const coordinator = deps.coordinator ?? profileSourceCoordinatorFor(storageService);

  async function loadReadCapture() {
    const [entries, collection, redundancySettings, predictionSettings, tournamentData] =
      await Promise.all([
        storageService.loadWishlist(),
        storageService.loadCollection(),
        storageService.loadRedundancySettings(),
        storageService.loadPredictionSettings(),
        storageService.loadTournament(),
      ]);
    return { entries, collection, redundancySettings, predictionSettings, tournamentData };
  }

  function readCaptureIdentity(capture: Awaited<ReturnType<typeof loadReadCapture>>): string {
    return canonicalSha256(capture);
  }

  return {
    async list(): Promise<WishlistEntry[]> {
      return storageService.loadWishlist();
    },

    async listWithCurrentRedundancy(): Promise<WishlistEntryReadResult[]> {
      if (!predictionService.listGamesWithPredictionsFromSnapshot) {
        throw new Error("Snapshot scoring is required for a coherent wishlist comparison capture");
      }
      let lastEntries: WishlistEntry[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        let capture: Awaited<ReturnType<typeof loadReadCapture>>;
        try {
          capture = await coordinator.runExclusive(loadReadCapture);
        } catch {
          break;
        }
        lastEntries = capture.entries;
        let identity: string;
        try {
          identity = readCaptureIdentity(capture);
        } catch {
          break;
        }
        const scoredGames = await predictionService.listGamesWithPredictionsFromSnapshot(
          capture.collection,
          capture.tournamentData,
          capture.predictionSettings,
        );
        try {
          return await computeWishlistRedundancyReadResults({
            entries: capture.entries,
            collection: capture.collection,
            scoredGames,
            redundancySettings: capture.redundancySettings,
            resolveDescriptionSignal: deps.resolveWishlistDescriptionSignal,
            async validateCaptureBeforePublish(request, usedDescriptionSignal) {
              return coordinator.runExclusive(async () => {
                try {
                  const current = await loadReadCapture();
                  if (readCaptureIdentity(current) !== identity) return "source-changed";
                  if (request === null || !usedDescriptionSignal) return "current";
                  return deps.resolveWishlistDescriptionSignal?.isCurrent?.(request)
                    ? "current"
                    : "cache-changed";
                } catch {
                  return "source-changed";
                }
              });
            },
          });
        } catch (error) {
          if (!(error instanceof WishlistRedundancyCaptureChangedError)) throw error;
        }
      }

      const fallbackEntries = await coordinator.runExclusive(async () => {
        try {
          return (await storageService.loadWishlist()) ?? lastEntries;
        } catch {
          return lastEntries;
        }
      });
      return savedWishlistRedundancyReadResults(fallbackEntries);
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
      if (result.bggVerification?.status === "existing-local-unverified") {
        throw new Error(
          `BGG Thing verification failed (${result.bggVerification.failure}) for ${bggId}`,
        );
      }
      const [nicheSettings, allGames, redundancySettings, tournamentData] = await Promise.all([
        storageService.loadNicheSettings(),
        predictionService.listGamesWithPredictions(),
        storageService.loadRedundancySettings(),
        storageService.loadTournament(),
      ]);
      const nicheImpact = computeNicheImpactForResult(result, allGames, nicheSettings);
      const redundancyPreview =
        result.predictionUnavailable === null
          ? computeRedundancyPreview(
              { game: result.game, score: result.score },
              collection,
              tournamentData,
              allGames,
              redundancySettings,
            )
          : null;

      const entry = buildEntry(bggId, result, nicheImpact, redundancyPreview);
      await coordinator.runExclusive(async () => {
        const currentWishlist = await storageService.loadWishlist();
        const currentCollection = await storageService.loadCollection();
        if (currentWishlist.some((candidate) => candidate.bggId === bggId)) {
          throw new Error("This game is already on your wishlist");
        }
        if (currentCollection.games.some((game) => game.bggId === bggId)) {
          throw new Error("This game is already in your collection");
        }
        currentWishlist.push(entry);
        await storageService.saveWishlist(currentWishlist);
      });
      return entry;
    },

    async remove(id: string): Promise<void> {
      await coordinator.runExclusive(async () => {
        const wishlist = await storageService.loadWishlist();
        const index = wishlist.findIndex((e) => e.id === id);
        if (index === -1) throw new Error(`Wishlist entry not found: ${id}`);
        wishlist.splice(index, 1);
        await storageService.saveWishlist(wishlist);
      });
    },

    async clear(): Promise<number> {
      return coordinator.runExclusive(async () => {
        const wishlist = await storageService.loadWishlist();
        await storageService.saveWishlist([]);
        return wishlist.length;
      });
    },

    async refresh(id: string): Promise<WishlistEntry> {
      const wishlist = await storageService.loadWishlist();
      const index = wishlist.findIndex((e) => e.id === id);
      if (index === -1) {
        throw new Error(`Wishlist entry not found: ${id}`);
      }

      const existing = wishlist[index];
      const result = await predictionService.predictBggGame(existing.bggId);
      if (result.bggVerification?.status === "existing-local-unverified") {
        throw new Error(
          `BGG Thing verification failed (${result.bggVerification.failure}) for ${existing.bggId}`,
        );
      }
      const [collection, nicheSettings, redundancySettings, tournamentData, allGames] =
        await Promise.all([
          storageService.loadCollection(),
          storageService.loadNicheSettings(),
          storageService.loadRedundancySettings(),
          storageService.loadTournament(),
          predictionService.listGamesWithPredictions(),
        ]);
      const nicheImpact = computeNicheImpactForResult(result, allGames, nicheSettings);

      const redundancyPreview =
        result.predictionUnavailable === null
          ? computeRedundancyPreview(
              { game: result.game, score: result.score },
              collection,
              tournamentData,
              allGames,
              redundancySettings,
            )
          : null;
      const updated = buildEntry(existing.bggId, result, nicheImpact, redundancyPreview);
      // Preserve original id and addedAt (REQ-WISH-11)
      updated.id = existing.id;
      updated.addedAt = existing.addedAt;

      return coordinator.runExclusive(async () => {
        const current = await storageService.loadWishlist();
        const currentIndex = current.findIndex((entry) => entry.id === existing.id);
        if (currentIndex < 0) throw new Error(`Wishlist entry not found: ${existing.id}`);
        const currentEntry = current[currentIndex];
        if (canonicalSha256(currentEntry) !== canonicalSha256(existing)) {
          throw new Error("Wishlist entry changed during refresh; retry the refresh");
        }
        updated.id = currentEntry.id;
        updated.addedAt = currentEntry.addedAt;
        current[currentIndex] = updated;
        await storageService.saveWishlist(current);
        return updated;
      });
    },

    async refreshAll(): Promise<{ refreshed: number; errors: string[] }> {
      const wishlist = await storageService.loadWishlist();
      let refreshed = 0;
      const errors: string[] = [];
      const stagedUpdates = new Map<string, { original: WishlistEntry; updated: WishlistEntry }>();

      // Preload shared data once rather than per-entry
      const [nicheSettings, allGames, collection, redundancySettings, tournamentData] =
        await Promise.all([
          storageService.loadNicheSettings(),
          predictionService.listGamesWithPredictions(),
          storageService.loadCollection(),
          storageService.loadRedundancySettings(),
          storageService.loadTournament(),
        ]);

      for (let i = 0; i < wishlist.length; i++) {
        const existing = wishlist[i];
        try {
          const result = await predictionService.predictBggGame(existing.bggId);
          if (result.bggVerification?.status === "existing-local-unverified") {
            throw new Error(
              `BGG Thing verification failed (${result.bggVerification.failure}) for ${existing.bggId}`,
            );
          }
          const nicheImpact = computeNicheImpactForResult(result, allGames, nicheSettings);

          const redundancyPreview =
            result.predictionUnavailable === null
              ? computeRedundancyPreview(
                  { game: result.game, score: result.score },
                  collection,
                  tournamentData,
                  allGames,
                  redundancySettings,
                )
              : null;

          const updated = buildEntry(existing.bggId, result, nicheImpact, redundancyPreview);
          updated.id = existing.id;
          updated.addedAt = existing.addedAt;
          stagedUpdates.set(existing.id, { original: existing, updated });
        } catch (err) {
          const message = toErrorMessage(err);
          errors.push(`${existing.name}: ${message}`);
        }
      }

      await coordinator.runExclusive(async () => {
        const current = await storageService.loadWishlist();
        for (const [id, staged] of stagedUpdates) {
          const currentIndex = current.findIndex((entry) => entry.id === id);
          const currentEntry = current[currentIndex];
          if (
            currentIndex < 0 ||
            !currentEntry ||
            canonicalSha256(currentEntry) !== canonicalSha256(staged.original)
          ) {
            errors.push(`${staged.original.name}: wishlist entry changed during refresh`);
            continue;
          }
          staged.updated.id = currentEntry.id;
          staged.updated.addedAt = currentEntry.addedAt;
          current[currentIndex] = staged.updated;
          refreshed++;
        }
        if (refreshed > 0) await storageService.saveWishlist(current);
      });
      return { refreshed, errors };
    },

    async removeByBggId(bggId: number): Promise<boolean> {
      return coordinator.runExclusive(async () => {
        const wishlist = await storageService.loadWishlist();
        const index = wishlist.findIndex((e) => e.bggId === bggId);
        if (index === -1) return false;
        wishlist.splice(index, 1);
        await storageService.saveWishlist(wishlist);
        return true;
      });
    },
  };
}
