import {
  WishlistBggSourceSnapshotSchema,
  type JevWishlistCandidateSelection,
  type JevRunScopeDisclosure,
  type WishlistBggSourceSnapshot,
  type WishlistEntry,
} from "@shelf-judge/shared";
import type { FrozenStagedSimilarityRun } from "./staged-similarity-scope.js";
import type { GameService } from "./game-service.js";
import type { JevRunCapture } from "./jev-run-service.js";
import {
  canonicalSha256,
  profileSourceCoordinatorFor,
  type ProfileSourceCoordinator,
} from "./profile-source-coordinator.js";
import type { StorageService } from "./storage-service.js";

export type FrozenWishlistRunPair = Readonly<{
  candidateEntryId: string;
  candidateBggId: number;
  ownedGameId: string;
  gameAId: string;
  gameBId: string;
  state: "cached-hit" | "sendable-miss" | "unavailable";
  cachedValue: number | null;
}>;

export interface PreparedWishlistRun {
  readonly scope: "wishlist";
  readonly selection: JevWishlistCandidateSelection;
  readonly selectionIdentity: string;
  readonly capture: JevRunCapture;
  readonly entries: readonly Readonly<WishlistEntry>[];
  readonly unavailableCandidateBggIds: readonly number[];
  readonly eligibleOwnedIds: readonly string[];
  readonly pairs: readonly FrozenWishlistRunPair[];
  readonly disclosure: Extract<JevRunScopeDisclosure, { scope: "wishlist" }>;
  readonly cacheRevision: number | null;
  readonly wishlistMutationGeneration: string;
  readonly identity: string;
  /** Present only for the production unified execution path; this authorizes exact frozen U0. */
  readonly unifiedRun?: FrozenStagedSimilarityRun;
  /** Live wishlist/collection authority fence, deliberately independent of cache revision. */
  isSourceCurrent(): Promise<boolean>;
  isCurrent(): Promise<boolean>;
}

export class WishlistRunPreparationError extends Error {
  constructor(readonly code: "invalid-selection" | "source-unavailable") {
    super(`Wishlist Jev preparation failed: ${code}`);
    this.name = "WishlistRunPreparationError";
  }
}

export type WishlistRunPreparationStorage = Pick<
  StorageService,
  "loadWishlist" | "saveWishlist" | "loadCollection" | "loadRedundancySettings"
>;

export interface WishlistRunPreparationService {
  /** Explicit-run preparation may hydrate missing selected compact facts before scoring. */
  hydrateSources(selection?: JevWishlistCandidateSelection): Promise<void>;
}

export function createWishlistRunPreparationService(options: {
  storageService: WishlistRunPreparationStorage & object;
  gameService: Pick<GameService, "getBoardgameScoringInput">;
  coordinator?: ProfileSourceCoordinator;
}): WishlistRunPreparationService {
  const coordinator = options.coordinator ?? profileSourceCoordinatorFor(options.storageService);

  async function hydrateMissingSources(selection: JevWishlistCandidateSelection): Promise<void> {
    const initial = await coordinator.runExclusive(async () => {
      const [entries, collection] = await Promise.all([
        options.storageService.loadWishlist(),
        options.storageService.loadCollection(),
      ]);
      return { entries, collection };
    });
    const selectedIds = canonicalSelectionIds(selection, initial.entries);
    const ownedIds = ownedBggIds(initial.collection.games);
    const targetEntries = initial.entries.filter(
      (entry) => selectedIds.has(entry.bggId) && !ownedIds.has(entry.bggId),
    );

    for (const entry of targetEntries) {
      if (validSource(entry.bggSource)) continue;
      const expectedEntryIdentity = canonicalSha256(entry);
      const fetchScoringInput = options.gameService.getBoardgameScoringInput?.bind(
        options.gameService,
      );
      if (!fetchScoringInput) continue;

      let observedSource: WishlistBggSourceSnapshot;
      try {
        // Explicit preparation only; network work stays outside the profile coordinator.
        const scoringInput = await fetchScoringInput(entry.bggId);
        if (
          scoringInput.bggId !== entry.bggId ||
          scoringInput.type !== "boardgame" ||
          scoringInput.primaryName !== entry.name ||
          !Number.isFinite(Date.parse(scoringInput.observedAt))
        )
          continue;
        observedSource = WishlistBggSourceSnapshotSchema.parse({
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
      } catch {
        // A failed observation leaves every persisted wishlist field untouched.
        continue;
      }

      try {
        await coordinator.runExclusive(async () => {
          const [entries, collection] = await Promise.all([
            options.storageService.loadWishlist(),
            options.storageService.loadCollection(),
          ]);
          if (ownedBggIds(collection.games).has(entry.bggId)) return;
          const current = entries.find((candidate) => candidate.id === entry.id);
          if (
            !current ||
            current.bggId !== entry.bggId ||
            current.name !== entry.name ||
            validSource(current.bggSource) ||
            canonicalSha256(current) !== expectedEntryIdentity
          )
            return;
          await options.storageService.saveWishlist(
            entries.map((candidate) =>
              candidate.id === current.id ? { ...candidate, bggSource: observedSource } : candidate,
            ),
          );
        });
      } catch {
        // A failed write remains an unavailable source unless durable storage verifies it.
      }
    }
  }

  return {
    hydrateSources: async (selection) => hydrateMissingSources(normalizeSelection(selection)),
  };
}

function normalizeSelection(
  selection: JevWishlistCandidateSelection | undefined,
): JevWishlistCandidateSelection {
  if (selection === undefined) return { kind: "all" };
  if (typeof selection !== "object" || selection === null || Array.isArray(selection))
    throw new WishlistRunPreparationError("invalid-selection");
  if (selection.kind === "all" && Object.keys(selection).length === 1) return { kind: "all" };
  const requestedIds: unknown = selection.kind === "selected" ? selection.bggIds : undefined;
  if (
    selection.kind !== "selected" ||
    Object.keys(selection).length !== 2 ||
    !Array.isArray(requestedIds) ||
    requestedIds.length === 0
  )
    throw new WishlistRunPreparationError("invalid-selection");
  const bggIds: number[] = [];
  for (const candidate of requestedIds as unknown[]) {
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate <= 0)
      throw new WishlistRunPreparationError("invalid-selection");
    bggIds.push(candidate);
  }
  if (new Set(bggIds).size !== bggIds.length)
    throw new WishlistRunPreparationError("invalid-selection");
  return { kind: "selected", bggIds: bggIds.sort((a, b) => a - b) };
}

function canonicalSelectionIds(
  selection: JevWishlistCandidateSelection,
  entries: readonly WishlistEntry[],
): Set<number> {
  const allIds = entries.map((entry) => entry.bggId);
  if (new Set(allIds).size !== allIds.length)
    throw new WishlistRunPreparationError("source-unavailable");
  if (selection.kind === "all") return new Set(allIds);
  const available = new Set(allIds);
  if (selection.bggIds.some((id) => !available.has(id)))
    throw new WishlistRunPreparationError("invalid-selection");
  return new Set(selection.bggIds);
}

function validSource(value: unknown): value is WishlistBggSourceSnapshot {
  return WishlistBggSourceSnapshotSchema.safeParse(value).success;
}

function ownedBggIds(
  games: readonly { bggId: number | null; additionalBggIds?: readonly number[] }[],
): Set<number> {
  return new Set(
    games.flatMap((game) => [
      ...(game.bggId === null ? [] : [game.bggId]),
      ...(game.additionalBggIds ?? []),
    ]),
  );
}
