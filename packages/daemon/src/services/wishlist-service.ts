import { v4 as uuidv4 } from "uuid";
import {
  toErrorMessage,
  type WishlistEntry,
  type WishlistBreakdownEntry,
  type NicheImpact,
  type RedundancyAdjustment,
  type WishlistBggSourceSnapshot,
  type WishlistEntryReadResult,
  type AddGameInput,
  type AddGameResult,
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
import type { JevPairCache, JevPairKey } from "./jev-pair-cache-service.js";
import { encodeWishlistBggMember, parseWishlistCandidateMember } from "./jev-pair-identity.js";
import { validateWishlistCandidateCOnlyRow } from "./wishlist-candidate-read-proof.js";
import { createLogger } from "./logger.js";

export interface WishlistService {
  list(): Promise<WishlistEntry[]>;
  listWithCurrentRedundancy(): Promise<WishlistEntryReadResult[]>;
  add(bggId: number): Promise<WishlistEntry>;
  remove(id: string): Promise<void>;
  clear(): Promise<number>;
  refresh(id: string): Promise<WishlistEntry>;
  refreshAll(): Promise<{ refreshed: number; errors: string[] }>;
  removeByBggId(bggId: number): Promise<boolean>;
  /** Finalize an already committed collection acquisition; never used for ordinary removal. */
  finalizeAcquisition(bggId: number, acquiredLocalId: string): Promise<void>;
  acquireGame(input: AddGameInput): Promise<AddGameResult>;
  reconcileAcquisitions(): Promise<number>;
}

export interface WishlistServiceDeps {
  storageService: StorageService;
  predictionService: PredictionService;
  gameService: GameService;
  resolveWishlistDescriptionSignal?: WishlistDescriptionSignalResolver;
  coordinator?: ProfileSourceCoordinator;
  jevPairCache?: JevPairCache;
  acquisitionObserver?: {
    onCollectionIndexBuilt?: (gameCount: number) => void;
    onOwnedGameLookup?: (gameId: string) => void;
    onEligibleOwnedSetBuilt?: (eligibleOwnedCount: number) => void;
    onEligibilityMembershipProbe?: (domain: "candidate" | "owned") => void;
  };
}

export class WishlistAcquisitionRecoveryError extends Error {
  constructor(
    readonly committedResult: AddGameResult,
    cause: unknown,
  ) {
    super("Game was added to the collection, but wishlist/cache recovery is pending", { cause });
    this.name = "WishlistAcquisitionRecoveryError";
  }
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

function ownedBggIds(
  collection: Awaited<ReturnType<StorageService["loadCollection"]>>,
): Set<number> {
  return new Set(
    collection.games.flatMap((game) => [
      ...(game.bggId === null ? [] : [game.bggId]),
      ...(game.additionalBggIds ?? []),
    ]),
  );
}

function excludeOwnedWishlistEntries(
  entries: readonly WishlistEntry[],
  collection: Awaited<ReturnType<StorageService["loadCollection"]>>,
): WishlistEntry[] {
  const ownedIds = ownedBggIds(collection);
  return entries.filter((entry) => !ownedIds.has(entry.bggId));
}

export function createWishlistService(deps: WishlistServiceDeps): WishlistService {
  const { storageService, predictionService } = deps;
  const coordinator = deps.coordinator ?? profileSourceCoordinatorFor(storageService);
  const logger = createLogger("wishlist-acquisition");

  async function purgeCandidate(bggId: number): Promise<void> {
    if (!deps.jevPairCache) return;
    if (!deps.jevPairCache.available)
      throw new Error("Jev pair cache is unavailable for wishlist removal");
    const collection = await storageService.loadCollection();
    deps.jevPairCache.purgeGame(
      encodeWishlistBggMember(collection.id, String(bggId)),
      "C",
      "C_ONLY",
      "wishlist-candidate",
    );
  }

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
      return coordinator.runExclusive(async () => {
        const [entries, collection] = await Promise.all([
          storageService.loadWishlist(),
          storageService.loadCollection(),
        ]);
        return excludeOwnedWishlistEntries(entries, collection);
      });
    },

    async listWithCurrentRedundancy(): Promise<WishlistEntryReadResult[]> {
      if (!predictionService.listGamesWithPredictionsFromSnapshot) {
        throw new Error("Snapshot scoring is required for a coherent wishlist comparison capture");
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        let capture: Awaited<ReturnType<typeof loadReadCapture>>;
        try {
          capture = await coordinator.runExclusive(loadReadCapture);
        } catch {
          break;
        }
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
            entries: excludeOwnedWishlistEntries(capture.entries, capture.collection),
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
          const [entries, collection] = await Promise.all([
            storageService.loadWishlist(),
            storageService.loadCollection(),
          ]);
          return excludeOwnedWishlistEntries(entries, collection);
        } catch {
          // Without current ownership authority, saved entries cannot be safely disclosed.
          return [];
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
        const entry = wishlist[index];
        if (!entry) throw new Error(`Wishlist entry not found: ${id}`);
        await purgeCandidate(entry.bggId);
        wishlist.splice(index, 1);
        await storageService.saveWishlist(wishlist);
      });
    },

    async clear(): Promise<number> {
      return coordinator.runExclusive(async () => {
        const wishlist = await storageService.loadWishlist();
        for (const entry of wishlist) await purgeCandidate(entry.bggId);
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
        await purgeCandidate(bggId);
        wishlist.splice(index, 1);
        await storageService.saveWishlist(wishlist);
        return true;
      });
    },

    async finalizeAcquisition(bggId: number, acquiredLocalId: string): Promise<void> {
      await coordinator.runExclusive(async () => {
        const cache = deps.jevPairCache;
        const [collection, wishlist, tournamentData, predictionSettings] = await Promise.all([
          storageService.loadCollection(),
          storageService.loadWishlist(),
          storageService.loadTournament(),
          storageService.loadPredictionSettings(),
        ]);
        const gameById = new Map(collection.games.map((game) => [game.id, game]));
        deps.acquisitionObserver?.onCollectionIndexBuilt?.(gameById.size);
        const acquired = gameById.get(acquiredLocalId);
        if (
          !acquired ||
          (acquired.bggId !== bggId && !(acquired.additionalBggIds ?? []).includes(bggId))
        )
          throw new Error("Committed collection source does not match acquired BGG identity");
        const entry = wishlist.find((candidate) => candidate.bggId === bggId);
        if (!entry) return;
        if (!cache?.available)
          throw new Error("Jev pair cache is unavailable for acquisition recovery");
        const candidateMember = encodeWishlistBggMember(collection.id, String(bggId));
        const rows = cache.candidateCOnlyPairs(candidateMember);
        const scored = predictionService.listGamesWithPredictionsFromSnapshot
          ? await predictionService.listGamesWithPredictionsFromSnapshot(
              collection,
              tournamentData,
              predictionSettings,
            )
          : await predictionService.listGamesWithPredictions();
        const scoreById = new Map(scored.map((game) => [game.game.id, game.score]));
        const eligibleIds = collection.games.flatMap((game) => {
          const score = scoreById.get(game.id);
          return game.ownership === "owned" &&
            score &&
            Number.isFinite(score.score) &&
            score.score > 0 &&
            !score.vetoed
            ? [game.id]
            : [];
        });
        const eligibleSet = new Set(eligibleIds);
        deps.acquisitionObserver?.onEligibleOwnedSetBuilt?.(eligibleSet.size);
        const candidateBggIds = new Set([bggId]);
        const semantic = collection.semanticRedundancy.settings;
        const canTransfer =
          entry?.bggSource !== undefined &&
          semantic.enabled &&
          Number.isFinite(semantic.weights.description) &&
          semantic.weights.description > 0 &&
          eligibleSet.has(acquiredLocalId) &&
          acquired.name === entry.name &&
          acquired.bggData?.description === entry.bggSource.description;
        const transfers: Array<{
          candidateKey: JevPairKey;
          ownedLocalGameIds: readonly [string, string];
        }> = [];
        if (entry.bggSource && canTransfer) {
          for (const row of rows) {
            const candidateId = row.gameAId === candidateMember ? row.gameAId : row.gameBId;
            const ownedMemberId = row.gameAId === candidateMember ? row.gameBId : row.gameAId;
            const ownedMember = parseWishlistCandidateMember(ownedMemberId);
            if (ownedMember?.kind !== "owned-local") continue;
            deps.acquisitionObserver?.onOwnedGameLookup?.(ownedMember.localGameId);
            const ownedGame = gameById.get(ownedMember.localGameId);
            if (!ownedGame) continue;
            const valid = validateWishlistCandidateCOnlyRow(
              row,
              collection.id,
              {
                candidate: { bggId, name: entry.name, bggSource: entry.bggSource },
                ownedGame: {
                  id: ownedGame.id,
                  bggId: ownedGame.bggId,
                  name: ownedGame.name,
                  description: ownedGame.bggData?.description ?? null,
                },
              },
              {
                candidateBggIds,
                eligibleOwnedIds: eligibleSet,
                onProbe: deps.acquisitionObserver?.onEligibilityMembershipProbe,
              },
            );
            if (!valid.valid) continue;
            transfers.push({
              candidateKey: {
                gameAId: candidateId,
                gameBId: ownedMemberId,
                signal: "C",
                pairDomain: "wishlist-candidate",
              },
              ownedLocalGameIds: [acquiredLocalId, ownedMember.localGameId],
            });
          }
        }
        // One SQLite transaction transfers proven rows and purges all remaining candidate rows.
        logger.log("wishlist acquisition cache finalization attempt", {
          trigger: "collection-acquisition",
          bggId,
          candidatePairCount: rows.length,
          provenTransferCount: transfers.length,
        });
        const finalizedRows = cache.finalizeCandidateAcquisition(candidateMember, transfers);
        logger.log("wishlist acquisition cache finalization completed", {
          trigger: "collection-acquisition",
          bggId,
          finalizedRows,
          outcome: "transferred-and-purged",
        });
        if (entry) {
          logger.log("wishlist acquisition cleanup attempt", {
            trigger: "collection-acquisition",
            bggId,
            entryId: entry.id,
          });
          await storageService.saveWishlist(
            wishlist.filter((candidate) => candidate.id !== entry.id),
          );
          logger.log("wishlist acquisition cleanup completed", {
            trigger: "collection-acquisition",
            bggId,
            entryId: entry.id,
            outcome: "removed",
          });
        }
      });
    },

    async acquireGame(input: AddGameInput): Promise<AddGameResult> {
      logger.log("wishlist acquisition started", {
        trigger: "game-add",
        bggId: input.bggId ?? null,
      });
      const result = await deps.gameService.addGame(input);
      if (input.bggId === null || input.bggId === undefined) return result;
      try {
        await this.finalizeAcquisition(input.bggId, result.game.id);
      } catch (cause) {
        logger.error("wishlist acquisition recovery pending", {
          trigger: "game-add",
          bggId: input.bggId,
          gameId: result.game.id,
          outcome: "collection-committed-recovery-pending",
          errorName: cause instanceof Error ? cause.name : "UnknownError",
        });
        throw new WishlistAcquisitionRecoveryError(result, cause);
      }
      logger.log("wishlist acquisition completed", {
        trigger: "game-add",
        bggId: input.bggId,
        gameId: result.game.id,
        outcome: "complete",
      });
      return result;
    },

    async reconcileAcquisitions(): Promise<number> {
      const [collection, wishlist] = await Promise.all([
        storageService.loadCollection(),
        storageService.loadWishlist(),
      ]);
      const owned = new Set(
        collection.games.flatMap((game) => [
          ...(game.bggId === null ? [] : [game.bggId]),
          ...(game.additionalBggIds ?? []),
        ]),
      );
      let reconciled = 0;
      for (const entry of wishlist) {
        if (!owned.has(entry.bggId)) continue;
        const acquired = collection.games.find(
          (game) =>
            game.bggId === entry.bggId || (game.additionalBggIds ?? []).includes(entry.bggId),
        );
        if (!acquired) throw new Error("Owned BGG overlap has no durable collection member");
        await this.finalizeAcquisition(entry.bggId, acquired.id);
        reconciled++;
      }
      return reconciled;
    },
  };
}
