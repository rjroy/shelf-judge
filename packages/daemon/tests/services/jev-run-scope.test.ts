import { describe, expect, test } from "bun:test";
import type { CollectionV10, DurableGame } from "@shelf-judge/shared";
import {
  createJevRunCollectionLookup,
  createJevRunScopeFromExactPairs,
  jevRunPairSourcesChanged,
  type JevRunPair,
  type JevRunScope,
} from "../../src/services/jev-run-scope.js";

function game(id: string, options: { description?: string; note?: string } = {}): DurableGame {
  return {
    id,
    name: `Game ${id}`,
    ownership: "owned",
    bggData: options.description === undefined ? null : { description: options.description },
    ownerNote:
      options.note === undefined
        ? { state: "missing", version: 0, updatedAt: null }
        : { state: "present", version: 1, updatedAt: "t1", text: options.note },
  } as DurableGame;
}

function collection(
  games: DurableGame[],
  settings?: Partial<CollectionV10["semanticRedundancy"]["settings"]>,
): CollectionV10 {
  return {
    id: "collection",
    games,
    semanticRedundancy: {
      settings: {
        enabled: true,
        weights: { factual: 1, description: 1, ownerNote: 1 },
        cachedOwnerNoteUse: true,
        ...settings,
      },
    },
  } as CollectionV10;
}

function exactScope(source: CollectionV10, games: readonly DurableGame[]): JevRunScope {
  const pairs = [];
  for (let i = 0; i < games.length; i++) {
    for (let j = i + 1; j < games.length; j++) {
      const gameA = games[i];
      const gameB = games[j];
      if (!gameA || !gameB) continue;
      pairs.push({
        gameAId: gameA.id,
        gameBId: gameB.id,
        descriptionSignalRequired: true,
        ownerNoteSignalRequired: true,
      });
    }
  }
  return createJevRunScopeFromExactPairs(source, pairs);
}

function firstPair(scope: JevRunScope): JevRunPair | undefined {
  for (const pair of scope.pairs()) return pair;
  return undefined;
}

describe("Jev run scope", () => {
  test("frozen explicit run scope iterates and looks up only authorized pairs", () => {
    const games = [game("a", { description: "a" }), game("b", { description: "b" }), game("c")];
    const scope = createJevRunScopeFromExactPairs(collection(games), [
      {
        gameAId: "a",
        gameBId: "b",
        descriptionSignalRequired: true,
        ownerNoteSignalRequired: false,
      },
      {
        gameAId: "a",
        gameBId: "c",
        descriptionSignalRequired: false,
        ownerNoteSignalRequired: false,
      },
    ]);

    expect(scope.totalEligiblePairs).toBe(2);
    expect([...scope.pairs()].map(({ gameAId, gameBId }) => [gameAId, gameBId])).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
    expect(scope.pairForIds("a", "b")?.descriptionSignalRequired).toBe(true);
    expect(scope.pairForIds("a", "c")).toBeDefined();
    expect(scope.pairForIds("b", "c")).toBeUndefined();
    expect(scope.pairForIds("c", "a")).toBeDefined();
  });

  test("source edits only stale exact pairs containing the changed game", () => {
    const games = [
      game("a", { description: "a", note: "note-a" }),
      game("b", { description: "b", note: "note-b" }),
      game("c", { description: "c", note: "note-c" }),
    ];
    const scope = exactScope(collection(games), games);
    const changed = structuredClone(games);
    const target = changed.find((entry) => entry.id === "a");
    if (target?.ownerNote.state === "present") target.ownerNote.text = "edited";
    expect(jevRunPairSourcesChanged(scope, collection(changed), "a", "b", "D_ONLY")).toBe(true);
    expect(jevRunPairSourcesChanged(scope, collection(changed), "b", "c", "D_ONLY")).toBe(false);
  });

  test("captures immutable exact scope and source identities without exposing notes", () => {
    const games = [
      game("a", { description: "desc-a", note: "private-note" }),
      game("b", { description: "desc-b", note: "private-note-b" }),
    ];
    const sourceCollection = collection(games);
    const scope = exactScope(sourceCollection, games);
    sourceCollection.semanticRedundancy.settings.cachedOwnerNoteUse = false;
    expect(scope.cachedOwnerNoteUse).toBe(true);
    expect(firstPair(scope)?.ownerNoteSignalRequired).toBe(true);
    expect(Reflect.set(scope, "cachedOwnerNoteUse", false)).toBe(false);
    expect(Reflect.set(scope.eligibleGameIds, "0", "other")).toBe(false);
    const source = scope.sourceForGame("a");
    expect(source).toBeDefined();
    if (source) {
      expect(Reflect.set(source, "nameFingerprint", "changed")).toBe(false);
      expect(Reflect.set(source, "ownerNoteFingerprint", "private-note")).toBe(false);
      expect(source.ownerNoteFingerprint).not.toContain("private-note");
    }
    expect(sourceCollection.semanticRedundancy.settings.cachedOwnerNoteUse).toBe(false);
  });

  test("compares only source fields sent for each dependency kind", () => {
    const games = [
      game("a", { description: "desc-a", note: "note-a" }),
      game("b", { description: "desc-b", note: "note-b" }),
    ];
    const scope = exactScope(collection(games), games);
    const noteChanged = structuredClone(games);
    const noteGame = noteChanged.find((entry) => entry.id === "a");
    if (noteGame?.ownerNote.state === "present") noteGame.ownerNote.text = "edited note";
    expect(jevRunPairSourcesChanged(scope, collection(noteChanged), "a", "b", "C_ONLY")).toBe(
      false,
    );
    expect(jevRunPairSourcesChanged(scope, collection(noteChanged), "a", "b", "D_ONLY")).toBe(true);
    expect(jevRunPairSourcesChanged(scope, collection(noteChanged), "a", "b", "SHARED_CD")).toBe(
      true,
    );

    const descriptionChanged = structuredClone(games);
    const descriptionGame = descriptionChanged.find((entry) => entry.id === "a");
    if (descriptionGame?.bggData) descriptionGame.bggData.description = "edited description";
    expect(
      jevRunPairSourcesChanged(scope, collection(descriptionChanged), "a", "b", "C_ONLY"),
    ).toBe(true);
    expect(
      jevRunPairSourcesChanged(scope, collection(descriptionChanged), "a", "b", "D_ONLY"),
    ).toBe(false);
    expect(
      jevRunPairSourcesChanged(scope, collection(descriptionChanged), "a", "b", "SHARED_CD"),
    ).toBe(true);
  });

  test("reuses an explicit lookup for one capture and rebuilds on a changed capture", () => {
    const games = [
      game("a", { description: "desc-a", note: "note-a" }),
      game("b", { description: "desc-b", note: "note-b" }),
    ];
    const capturedCollection = collection(games);
    const changedGames = structuredClone(games);
    const changedA = changedGames.find((entry) => entry.id === "a");
    if (changedA?.ownerNote.state === "present") changedA.ownerNote.text = "new note";
    const scope = exactScope(capturedCollection, games);
    let mapCalls = 0;
    const originalMap = games.map.bind(games);
    games.map = ((...args: Parameters<typeof games.map>) => {
      mapCalls++;
      return originalMap(...args);
    }) as typeof games.map;
    const lookup = createJevRunCollectionLookup(capturedCollection);

    expect(jevRunPairSourcesChanged(scope, capturedCollection, "a", "b", "C_ONLY", lookup)).toBe(
      false,
    );
    expect(jevRunPairSourcesChanged(scope, capturedCollection, "a", "b", "D_ONLY", lookup)).toBe(
      false,
    );
    expect(mapCalls).toBe(1);

    const changedCollection = collection(changedGames);
    expect(jevRunPairSourcesChanged(scope, changedCollection, "a", "b", "D_ONLY", lookup)).toBe(
      true,
    );
  });

  test("refreshes a lookup when its captured games array or indexed entry is replaced", () => {
    const games = [
      game("a", { description: "desc-a", note: "note-a" }),
      game("b", { description: "desc-b", note: "note-b" }),
    ];
    const capturedCollection = collection(games);
    const scope = exactScope(capturedCollection, games);
    const lookup = createJevRunCollectionLookup(capturedCollection);

    capturedCollection.games = structuredClone(games);
    const replacedArrayA = capturedCollection.games.find((entry) => entry.id === "a");
    if (replacedArrayA?.ownerNote.state === "present") replacedArrayA.ownerNote.text = "array edit";
    expect(jevRunPairSourcesChanged(scope, capturedCollection, "a", "b", "D_ONLY", lookup)).toBe(
      true,
    );

    const replacementA = structuredClone(capturedCollection.games[0]);
    if (replacementA?.ownerNote.state === "present") replacementA.ownerNote.text = "entry edit";
    if (replacementA) capturedCollection.games[0] = replacementA;
    expect(jevRunPairSourcesChanged(scope, capturedCollection, "a", "b", "D_ONLY", lookup)).toBe(
      true,
    );
  });
});
