import { createHash } from "node:crypto";

import type { Collection, DurableGame } from "@shelf-judge/shared";
import type { JevDependencyKind } from "./jev-pair-cache-service.js";

export interface JevRunGameSource {
  readonly gameId: string;
  readonly nameFingerprint: string;
  readonly descriptionPresent: boolean;
  readonly descriptionFingerprint: string | null;
  readonly ownerNotePresent: boolean;
  readonly ownerNoteFingerprint: string | null;
  readonly ownerNoteVersion: number | null;
}

export interface JevRunPair {
  readonly gameAId: string;
  readonly gameBId: string;
  readonly descriptionSignalRequired: boolean;
  readonly ownerNoteSignalRequired: boolean;
  readonly ownerNoteSignalBlocked: boolean;
}

export interface JevRunScope {
  readonly eligibleGameIds: readonly string[];
  readonly totalEligiblePairs: number;
  readonly descriptionBearingPairCount: number;
  readonly ownerNoteBearingPairCount: number;
  readonly ownerNoteSignalBlocked: boolean;
  readonly cachedOwnerNoteUse: boolean;
  sourceForGame(gameId: string): JevRunGameSource | undefined;
  /** Looks up a canonical eligible pair without enumerating the pair set. */
  pairForIds(gameAId: string, gameBId: string): JevRunPair | undefined;
  /** Recreates unordered pairs on demand; the plan intentionally retains no pair manifest. */
  pairs(): IterableIterator<JevRunPair>;
}

/** Explicit game index tied to one capture; validates its array and indexed entries on access. */
export interface JevRunCollectionLookup {
  readonly collection: Collection;
  gameForId(gameId: string): DurableGame | undefined;
}

export function createJevRunCollectionLookup(collection: Collection): JevRunCollectionLookup {
  let indexedGames = collection.games;
  let byId = new Map(indexedGames.map((game, index) => [game.id, { index, game }] as const));
  const rebuild = (): void => {
    indexedGames = collection.games;
    byId = new Map(indexedGames.map((game, index) => [game.id, { index, game }] as const));
  };
  return Object.freeze({
    collection,
    gameForId: (gameId: string) => {
      if (collection.games !== indexedGames) rebuild();
      let entry = byId.get(gameId);
      if (entry && (indexedGames[entry.index] !== entry.game || entry.game.id !== gameId)) {
        rebuild();
        entry = byId.get(gameId);
      }
      return entry?.game;
    },
  });
}

/** A lookup is only reusable with the exact collection capture from which it was built. */
export function jevRunCollectionLookupFor(
  collection: Collection,
  lookup?: JevRunCollectionLookup,
): JevRunCollectionLookup {
  return lookup?.collection === collection ? lookup : createJevRunCollectionLookup(collection);
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hasDescription(game: DurableGame): boolean {
  return (
    typeof game.bggData?.description === "string" && game.bggData.description.trim().length > 0
  );
}

function hasNote(game: DurableGame): boolean {
  return (
    game.ownerNote.state === "present" &&
    Number.isSafeInteger(game.ownerNote.version) &&
    game.ownerNote.version > 0 &&
    game.ownerNote.text.trim().length > 0
  );
}

function sourceFor(game: DurableGame): JevRunGameSource {
  const descriptionPresent = hasDescription(game);
  const ownerNotePresent = hasNote(game);
  return Object.freeze({
    gameId: game.id,
    nameFingerprint: fingerprint(game.name),
    descriptionPresent,
    descriptionFingerprint: descriptionPresent
      ? fingerprint(game.bggData?.description ?? "")
      : null,
    ownerNotePresent,
    ownerNoteFingerprint:
      ownerNotePresent && game.ownerNote.state === "present"
        ? fingerprint(game.ownerNote.text)
        : null,
    ownerNoteVersion:
      ownerNotePresent && game.ownerNote.state === "present" ? game.ownerNote.version : null,
  });
}

/** Wrap a previously frozen P∪R pair set without expanding it into an endpoint cartesian product. */
export function createJevRunScopeFromExactPairs(
  collection: Collection,
  pairInputs: readonly Pick<
    JevRunPair,
    "gameAId" | "gameBId" | "descriptionSignalRequired" | "ownerNoteSignalRequired"
  >[],
): JevRunScope {
  const gameById = new Map(collection.games.map((game) => [game.id, game]));
  const pairByKey = new Map<string, JevRunPair>();
  const members = new Set<string>();
  let descriptions = 0;
  let notes = 0;
  const cachedOwnerNoteUse = collection.semanticRedundancy.settings.cachedOwnerNoteUse;
  const ownerNoteSignalBlocked =
    collection.semanticRedundancy.settings.enabled &&
    collection.semanticRedundancy.settings.weights.ownerNote > 0 &&
    !cachedOwnerNoteUse;

  for (const input of pairInputs) {
    const [gameAId, gameBId] = [input.gameAId, input.gameBId].sort();
    if (!gameAId || !gameBId || gameAId === gameBId)
      throw new TypeError("Exact Jev run scope contains an invalid pair");
    const gameA = gameById.get(gameAId);
    const gameB = gameById.get(gameBId);
    if (!gameA || !gameB) throw new TypeError("Exact Jev run scope references a missing game");
    const sourceA = sourceFor(gameA);
    const sourceB = sourceFor(gameB);
    const pair = Object.freeze({
      gameAId,
      gameBId,
      descriptionSignalRequired:
        input.descriptionSignalRequired && sourceA.descriptionPresent && sourceB.descriptionPresent,
      ownerNoteSignalRequired:
        input.ownerNoteSignalRequired &&
        cachedOwnerNoteUse &&
        sourceA.ownerNotePresent &&
        sourceB.ownerNotePresent,
      ownerNoteSignalBlocked: input.ownerNoteSignalRequired && !cachedOwnerNoteUse,
    });
    const key = JSON.stringify([gameAId, gameBId]);
    if (pairByKey.has(key)) throw new TypeError("Exact Jev run scope contains duplicate pairs");
    pairByKey.set(key, pair);
    members.add(gameAId);
    members.add(gameBId);
    if (pair.descriptionSignalRequired) descriptions++;
    if (pair.ownerNoteSignalRequired) notes++;
  }

  const eligibleGameIds = Object.freeze([...members].sort());
  const sources = new Map(
    eligibleGameIds.flatMap((gameId) => {
      const game = gameById.get(gameId);
      return game ? [[gameId, sourceFor(game)] as const] : [];
    }),
  );
  const pairForIds = (a: string, b: string): JevRunPair | undefined => {
    if (a === b) return undefined;
    const [left, right] = [a, b].sort();
    return pairByKey.get(JSON.stringify([left, right]));
  };
  function* pairs(): IterableIterator<JevRunPair> {
    yield* pairByKey.values();
  }
  return Object.freeze({
    eligibleGameIds,
    totalEligiblePairs: pairByKey.size,
    descriptionBearingPairCount: descriptions,
    ownerNoteBearingPairCount: notes,
    ownerNoteSignalBlocked,
    cachedOwnerNoteUse,
    sourceForGame: (id: string) => sources.get(id),
    pairForIds,
    pairs,
  });
}

/** Returns whether either member's local source identity differs from the planned pair snapshot. */
export function jevRunPairSourcesChanged(
  scope: JevRunScope,
  collection: Collection,
  gameAId: string,
  gameBId: string,
  dependencyKind: JevDependencyKind,
  lookup?: JevRunCollectionLookup,
): boolean {
  const plannedA = scope.sourceForGame(gameAId);
  const plannedB = scope.sourceForGame(gameBId);
  let gameA: DurableGame | undefined;
  let gameB: DurableGame | undefined;
  if (lookup) {
    const currentLookup = jevRunCollectionLookupFor(collection, lookup);
    gameA = currentLookup.gameForId(gameAId);
    gameB = currentLookup.gameForId(gameBId);
  } else {
    // Fresh authoritative reads are intentionally scanned directly, not checked against a
    // possibly older capture index or indexed into a new full-collection Map per fence.
    for (const game of collection.games) {
      if (game.id === gameAId) gameA = game;
      if (game.id === gameBId) gameB = game;
      if (gameA && gameB) break;
    }
  }
  if (!plannedA || !plannedB || !gameA || !gameB) return true;
  return (
    !sameSource(plannedA, sourceFor(gameA), dependencyKind) ||
    !sameSource(plannedB, sourceFor(gameB), dependencyKind)
  );
}

function sameSource(
  left: JevRunGameSource,
  right: JevRunGameSource,
  dependencyKind: JevDependencyKind,
): boolean {
  if (left.gameId !== right.gameId || left.nameFingerprint !== right.nameFingerprint) return false;
  const comparesDescription = dependencyKind !== "D_ONLY";
  const comparesNote = dependencyKind !== "C_ONLY";
  return (
    (!comparesDescription ||
      (left.descriptionPresent === right.descriptionPresent &&
        left.descriptionFingerprint === right.descriptionFingerprint)) &&
    (!comparesNote ||
      (left.ownerNotePresent === right.ownerNotePresent &&
        left.ownerNoteFingerprint === right.ownerNoteFingerprint &&
        left.ownerNoteVersion === right.ownerNoteVersion))
  );
}
