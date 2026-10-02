import { createHash } from "node:crypto";

import type { Collection, DurableGame, GameWithScore } from "@shelf-judge/shared";
import { projectJevOwnedPredictionCapture } from "./jev-pair-coverage.js";
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

export type JevRunScopeResult = { ok: true; scope: JevRunScope } | { ok: false; reason: string };

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

/** Plans the eligible owned universe and per-game source identities without materializing pairs. */
export function planJevRunScope(
  collection: Collection,
  predictionCapture: readonly GameWithScore[],
): JevRunScopeResult {
  const projection = projectJevOwnedPredictionCapture(collection, predictionCapture);
  if (!projection.ok) return projection;
  const settings = collection.semanticRedundancy?.settings;
  if (
    !settings ||
    typeof settings.enabled !== "boolean" ||
    !settings.weights ||
    ![settings.weights.factual, settings.weights.description, settings.weights.ownerNote].every(
      (weight) => Number.isFinite(weight) && weight >= 0,
    ) ||
    typeof settings.cachedOwnerNoteUse !== "boolean"
  ) {
    return { ok: false, reason: "invalid collection semantic authority or policy" };
  }

  const scoreById = new Map(projection.predictionScores.map((score) => [score.gameId, score]));
  const eligibleGameIds = projection.ownedGameIds.filter((id) => {
    const score = scoreById.get(id);
    return (
      score?.score !== null && score !== undefined && score.score > 0 && score.vetoed === false
    );
  });
  const gameById = new Map(collection.games.map((game) => [game.id, game]));
  const sourceByGameId = new Map<string, JevRunGameSource>();
  for (const id of eligibleGameIds) {
    const game = gameById.get(id);
    if (!game) return { ok: false, reason: "owned game missing from collection" };
    sourceByGameId.set(id, sourceFor(game));
  }

  let descriptions = 0;
  let notes = 0;
  for (const source of sourceByGameId.values()) {
    if (source.descriptionPresent) descriptions++;
    if (source.ownerNotePresent) notes++;
  }
  const frozenEligibleGameIds = Object.freeze([...eligibleGameIds].sort());
  const eligibleGameIdSet = new Set(frozenEligibleGameIds);
  const count = frozenEligibleGameIds.length;
  const totalEligiblePairs = (count * (count - 1)) / 2;
  const descriptionRequired = settings.enabled && settings.weights.description > 0;
  const ownerNoteRequired = settings.enabled && settings.weights.ownerNote > 0;
  const cachedOwnerNoteUse = settings.cachedOwnerNoteUse;
  const descriptionBearingPairCount = descriptionRequired
    ? Math.max(0, (descriptions * (descriptions - 1)) / 2)
    : 0;
  const ownerNoteBearingPairCount = ownerNoteRequired ? Math.max(0, (notes * (notes - 1)) / 2) : 0;
  // Counts above describe source availability. Signal activation additionally obeys semantic policy.
  const ownerNoteSignalBlocked = ownerNoteRequired && !cachedOwnerNoteUse;

  function pairForSources(
    gameAId: string,
    gameBId: string,
    sourceA: JevRunGameSource,
    sourceB: JevRunGameSource,
  ): JevRunPair {
    return Object.freeze({
      gameAId,
      gameBId,
      descriptionSignalRequired:
        descriptionRequired && sourceA.descriptionPresent && sourceB.descriptionPresent,
      ownerNoteSignalRequired:
        ownerNoteRequired &&
        cachedOwnerNoteUse &&
        sourceA.ownerNotePresent &&
        sourceB.ownerNotePresent,
      ownerNoteSignalBlocked,
    });
  }

  function pairForIds(gameAId: string, gameBId: string): JevRunPair | undefined {
    if (
      typeof gameAId !== "string" ||
      typeof gameBId !== "string" ||
      gameAId >= gameBId ||
      !eligibleGameIdSet.has(gameAId) ||
      !eligibleGameIdSet.has(gameBId)
    ) {
      return undefined;
    }
    const sourceA = sourceByGameId.get(gameAId);
    const sourceB = sourceByGameId.get(gameBId);
    return sourceA && sourceB ? pairForSources(gameAId, gameBId, sourceA, sourceB) : undefined;
  }

  function* pairs(): IterableIterator<JevRunPair> {
    for (let i = 0; i < frozenEligibleGameIds.length; i++) {
      const gameAId = frozenEligibleGameIds[i];
      if (gameAId === undefined) continue;
      const sourceA = sourceByGameId.get(gameAId);
      if (!sourceA) continue;
      for (let j = i + 1; j < frozenEligibleGameIds.length; j++) {
        const gameBId = frozenEligibleGameIds[j];
        if (gameBId === undefined) continue;
        const sourceB = sourceByGameId.get(gameBId);
        if (!sourceB) continue;
        yield pairForSources(gameAId, gameBId, sourceA, sourceB);
      }
    }
  }

  const scope: JevRunScope = {
    eligibleGameIds: frozenEligibleGameIds,
    totalEligiblePairs,
    descriptionBearingPairCount,
    ownerNoteBearingPairCount,
    ownerNoteSignalBlocked,
    cachedOwnerNoteUse,
    sourceForGame: (gameId) => sourceByGameId.get(gameId),
    pairForIds,
    pairs,
  };
  return { ok: true, scope: Object.freeze(scope) };
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
