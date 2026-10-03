import {
  WishlistBggSourceSnapshotSchema,
  type JevWishlistCandidateSelection,
  type JevRunScopeDisclosure,
  type WishlistBggSourceSnapshot,
  type WishlistEntry,
} from "@shelf-judge/shared";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import { encodeOwnedLocalMember, encodeWishlistBggMember } from "./jev-pair-identity.js";
import type { GameService } from "./game-service.js";
import type { JevRunCapture } from "./jev-run-service.js";
import { planJevRunScope } from "./jev-run-scope.js";
import {
  canonicalSha256,
  profileSourceCoordinatorFor,
  type ProfileSourceCoordinator,
} from "./profile-source-coordinator.js";
import type { JevRunSourceAdapter } from "./jev-run-source-adapter.js";
import type { StorageService } from "./storage-service.js";
import { validateWishlistCandidateCOnlyRow } from "./wishlist-candidate-read-proof.js";
import { wishlistCollectionSourceIdentity } from "./wishlist-collection-source-identity.js";

export type FrozenWishlistRunPair = Readonly<{
  candidateEntryId: string;
  candidateBggId: number;
  ownedGameId: string;
  gameAId: string;
  gameBId: string;
  state: "cached-hit" | "sendable-miss";
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
  readonly identity: string;
  isCurrent(): Promise<boolean>;
}

export class WishlistRunPreparationError extends Error {
  constructor(
    readonly code:
      | "invalid-selection"
      | "source-unavailable"
      | "scope-changed"
      | "cache-unavailable",
  ) {
    super(`Wishlist Jev preparation failed: ${code}`);
    this.name = "WishlistRunPreparationError";
  }
}

export type WishlistRunPreparationStorage = Pick<
  StorageService,
  "loadWishlist" | "saveWishlist" | "loadCollection" | "loadRedundancySettings"
>;

export interface WishlistRunPreparationService {
  prepare(selection?: JevWishlistCandidateSelection): Promise<PreparedWishlistRun>;
}

export function createWishlistRunPreparationService(options: {
  storageService: WishlistRunPreparationStorage & object;
  gameService: Pick<GameService, "getBoardgameScoringInput">;
  sourceAdapter: Pick<JevRunSourceAdapter, "loadCapture" | "readCurrent">;
  cache: JevPairCache;
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
    async prepare(requestedSelection): Promise<PreparedWishlistRun> {
      const selection = normalizeSelection(requestedSelection);
      await hydrateMissingSources(selection);

      let capture: JevRunCapture;
      try {
        capture = await options.sourceAdapter.loadCapture();
      } catch {
        throw new WishlistRunPreparationError("source-unavailable");
      }
      // All proof, disclosure, and currentness work must use one immutable
      // snapshot, never a mutable object retained by the source adapter.
      capture = freezeValue(structuredClone(capture));
      const finalSources = await coordinator.runExclusive(async () => {
        const [entries, collection] = await Promise.all([
          options.storageService.loadWishlist(),
          options.storageService.loadCollection(),
        ]);
        return { entries, collection };
      });
      const capturedCollection = freezeValue(structuredClone(finalSources.collection));
      const capturedEntries = freezeValue(structuredClone(finalSources.entries));
      const capturedCollectionIdentity = wishlistCollectionSourceIdentity(capturedCollection);
      if (capturedCollectionIdentity !== wishlistCollectionSourceIdentity(capture.collection))
        throw new WishlistRunPreparationError("scope-changed");

      const selectedIds = canonicalSelectionIds(selection, capturedEntries);
      if (selection.kind === "selected") {
        for (const bggId of selection.bggIds)
          if (!selectedIds.has(bggId)) throw new WishlistRunPreparationError("scope-changed");
      }
      const ownedIds = ownedBggIds(capturedCollection.games);
      const selectedEntries = capturedEntries.filter((entry) => selectedIds.has(entry.bggId));
      const requestedEntries = selectedEntries.filter((entry) => !ownedIds.has(entry.bggId));
      const eligibleEntries = requestedEntries.filter(hasSource);
      const plan = planJevRunScope(capture.collection, capture.predictionCapture);
      if (!plan.ok) throw new WishlistRunPreparationError("source-unavailable");
      const eligibleOwnedIds = plan.scope.eligibleGameIds;
      const ownedById = new Map(capture.collection.games.map((game) => [game.id, game]));
      const candidateBggIds = new Set(eligibleEntries.map((entry) => entry.bggId));
      const redundancy = await options.storageService.loadRedundancySettings();
      const semantic = capture.collection.semanticRedundancy.settings;
      const descriptionRequired =
        redundancy.enabled &&
        semantic.enabled &&
        Number.isFinite(semantic.weights.description) &&
        semantic.weights.description > 0;
      const usableCandidates = descriptionRequired
        ? eligibleEntries.filter(hasUsableSourceDescription)
        : [];
      const sendCandidates: Array<{
        entry: WishlistEntry;
        ownedGame: NonNullable<ReturnType<typeof ownedById.get>>;
      }> = [];
      for (const entry of usableCandidates) {
        for (const ownedGameId of eligibleOwnedIds) {
          const ownedGame = ownedById.get(ownedGameId);
          if (!ownedGame || !usableDescription(ownedGame.bggData?.description ?? null)) continue;
          sendCandidates.push({ entry, ownedGame });
        }
      }

      let revision: number | null = null;
      if (sendCandidates.length > 0) {
        try {
          if (!options.cache.available) throw new Error("cache unavailable");
          revision = options.cache.mutationRevision();
          if (revision === null || !Number.isSafeInteger(revision) || revision < 0)
            throw new Error("invalid revision");
        } catch {
          throw new WishlistRunPreparationError("cache-unavailable");
        }
      }

      const membership = {
        candidateBggIds,
        eligibleOwnedIds: new Set(eligibleOwnedIds),
      };
      const pairs: FrozenWishlistRunPair[] = [];
      try {
        for (const { entry, ownedGame } of sendCandidates) {
          const candidateSource = entry.bggSource;
          if (!validSource(candidateSource)) continue;
          const candidateMember = encodeWishlistBggMember(
            capture.collection.id,
            String(entry.bggId),
          );
          const ownedMember = encodeOwnedLocalMember(capture.collection.id, ownedGame.id);
          const row = options.cache.lookup({
            gameAId: candidateMember,
            gameBId: ownedMember,
            signal: "C",
            pairDomain: "wishlist-candidate",
          });
          const proof = validateWishlistCandidateCOnlyRow(
            row,
            capture.collection.id,
            {
              candidate: { bggId: entry.bggId, name: entry.name, bggSource: candidateSource },
              ownedGame: {
                id: ownedGame.id,
                bggId: ownedGame.bggId,
                name: ownedGame.name,
                description: ownedGame.bggData?.description ?? null,
              },
            },
            membership,
          );
          pairs.push(
            Object.freeze({
              candidateEntryId: entry.id,
              candidateBggId: entry.bggId,
              ownedGameId: ownedGame.id,
              gameAId: candidateMember,
              gameBId: ownedMember,
              state: proof.valid ? "cached-hit" : "sendable-miss",
              cachedValue: proof.valid ? proof.value : null,
            }),
          );
        }
        if (revision !== null && options.cache.mutationRevision() !== revision)
          throw new Error("cache changed during candidate reads");
      } catch {
        throw new WishlistRunPreparationError("cache-unavailable");
      }

      const hitCount = pairs.filter((pair) => pair.state === "cached-hit").length;
      const missCount = pairs.length - hitCount;
      const disclosure: Extract<JevRunScopeDisclosure, { scope: "wishlist" }> = Object.freeze({
        scope: "wishlist",
        wishlistEntryCount: capturedEntries.length,
        selectedCandidateCount: selectedEntries.length,
        unselectedEntryCount: capturedEntries.length - selectedEntries.length,
        ownedOverlapCandidateCount: selectedEntries.length - requestedEntries.length,
        requestedCandidateCount: requestedEntries.length,
        eligibleCandidateCount: eligibleEntries.length,
        unavailableCandidateCount: requestedEntries.length - eligibleEntries.length,
        eligibleOwnedGameCount: eligibleOwnedIds.length,
        comparisonPairCount: eligibleEntries.length * eligibleOwnedIds.length,
        cachedHitPairCount: hitCount,
        sendablePairCount: missCount,
      });
      const selectionIdentity = canonicalSha256(selection);
      const identity = canonicalSha256({
        selection,
        collectionIdentity: capturedCollectionIdentity,
        policyIdentity: capture.policyIdentity,
        eligibilityIdentity: capture.eligibilityIdentity ?? null,
        entries: selectedEntries.map((entry) => ({
          id: entry.id,
          bggId: entry.bggId,
          name: entry.name,
          bggSource: validSource(entry.bggSource) ? entry.bggSource : null,
        })),
        eligibleOwnedIds,
        pairs,
        disclosure,
        cacheRevision: revision,
      });
      const frozenEntries = freezeValue(selectedEntries.map((entry) => structuredClone(entry)));
      const frozenAllEntries = capturedEntries;
      const unavailableCandidateBggIds = freezeValue(
        requestedEntries
          .filter((entry) => !validSource(entry.bggSource))
          .map((entry) => entry.bggId),
      );
      const prepared: PreparedWishlistRun = {
        scope: "wishlist",
        selection: freezeValue(selection),
        selectionIdentity,
        capture,
        entries: frozenEntries,
        unavailableCandidateBggIds,
        eligibleOwnedIds: freezeValue([...eligibleOwnedIds]),
        pairs: freezeValue(pairs),
        disclosure,
        cacheRevision: revision,
        identity,
        isCurrent: async () =>
          isPreparedCurrent({
            selection,
            allEntries: frozenAllEntries,
            capture,
            collectionIdentity: capturedCollectionIdentity,
            revision,
            sourceAdapter: options.sourceAdapter,
            storageService: options.storageService,
            coordinator,
            cache: options.cache,
          }),
      };
      if (!(await prepared.isCurrent())) throw new WishlistRunPreparationError("scope-changed");
      return Object.freeze(prepared);
    },
  };
}

async function isPreparedCurrent(input: {
  selection: JevWishlistCandidateSelection;
  allEntries: readonly WishlistEntry[];
  capture: JevRunCapture;
  collectionIdentity: string;
  revision: number | null;
  sourceAdapter: Pick<JevRunSourceAdapter, "readCurrent">;
  storageService: WishlistRunPreparationStorage;
  coordinator: ProfileSourceCoordinator;
  cache: JevPairCache;
}): Promise<boolean> {
  try {
    return await input.coordinator.runExclusive(async () => {
      const authority = await input.sourceAdapter.readCurrent();
      const [entries, collection] = await Promise.all([
        input.storageService.loadWishlist(),
        input.storageService.loadCollection(),
      ]);
      const liveCollectionIdentity = wishlistCollectionSourceIdentity(collection);
      const authorityCollectionMatches =
        input.capture.eligibilityIdentity !== undefined &&
        authority.eligibilityIdentity !== undefined
          ? authority.eligibilityIdentity === input.capture.eligibilityIdentity
          : wishlistCollectionSourceIdentity(authority.collection) === input.collectionIdentity;
      if (
        authority.policyIdentity !== input.capture.policyIdentity ||
        !authorityCollectionMatches ||
        liveCollectionIdentity !== input.collectionIdentity
      )
        return false;
      const selectedIds = canonicalSelectionIds(input.selection, entries);
      if (
        input.selection.kind === "selected" &&
        input.selection.bggIds.some((bggId) => !selectedIds.has(bggId))
      )
        return false;
      if (
        canonicalSha256(entries.map((entry) => canonicalSha256(entry)).sort()) !==
        canonicalSha256(input.allEntries.map((entry) => canonicalSha256(entry)).sort())
      )
        return false;
      if (input.revision !== null && input.cache.mutationRevision() !== input.revision)
        return false;
      return true;
    });
  } catch {
    return false;
  }
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

function hasSource(
  entry: WishlistEntry,
): entry is WishlistEntry & { bggSource: WishlistBggSourceSnapshot } {
  return validSource(entry.bggSource);
}

function hasUsableSourceDescription(
  entry: WishlistEntry,
): entry is WishlistEntry & { bggSource: WishlistBggSourceSnapshot } {
  return hasSource(entry) && usableDescription(entry.bggSource.description);
}

function usableDescription(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
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

function freezeValue<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeValue(child);
  }
  return value;
}
