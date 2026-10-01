import { describe, expect, test } from "bun:test";
import type { CollectionV10, DurableGame, GameWithScore } from "@shelf-judge/shared";
import {
  jevRunPairSourcesChanged,
  planJevRunScope,
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

function capture(games: readonly DurableGame[]): GameWithScore[] {
  return games.map((game) => ({
    game,
    score: {
      score: 1,
      vetoed: false,
      ratedAxisCount: 1,
      predictionMeta: null,
    } as GameWithScore["score"],
  }));
}

function firstPair(scope: JevRunScope): JevRunPair | undefined {
  for (const pair of scope.pairs()) return pair;
  return undefined;
}

describe("Jev run scope planner", () => {
  test("keeps 19,900 unordered pairs lazy for 200 eligible games", () => {
    const games = Array.from({ length: 200 }, (_, i) =>
      game(`g${String(i).padStart(3, "0")}`, { description: "desc", note: "note" }),
    );
    const planned = planJevRunScope(collection(games), capture(games));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.scope.totalEligiblePairs).toBe(19_900);
    expect(planned.scope.descriptionBearingPairCount).toBe(19_900);
    expect(planned.scope.ownerNoteBearingPairCount).toBe(19_900);
    let pairCount = 0;
    let orderedPairs = true;
    for (const pair of planned.scope.pairs()) {
      if (pair.gameAId >= pair.gameBId) orderedPairs = false;
      pairCount++;
    }
    expect(pairCount).toBe(19_900);
    expect(orderedPairs).toBe(true);
    expect(Object.keys(planned.scope)).not.toContain("pairList");
    expect(Object.keys(planned.scope)).not.toContain("sourceByGameId");
    const sourceText = JSON.stringify(
      planned.scope.eligibleGameIds.map((id) => planned.scope.sourceForGame(id)),
    );
    expect(sourceText).not.toContain('"desc"');
    expect(sourceText).not.toContain('"note"');
  });

  test("source edits only stale pairs containing the changed game", () => {
    const games = [
      game("a", { description: "a", note: "note-a" }),
      game("b", { description: "b", note: "note-b" }),
      game("c", { description: "c", note: "note-c" }),
    ];
    const planned = planJevRunScope(collection(games), capture(games));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const changed = structuredClone(games);
    const target = changed.find((entry) => entry.id === "a");
    if (target?.ownerNote.state === "present") target.ownerNote.text = "edited";
    expect(jevRunPairSourcesChanged(planned.scope, collection(changed), "a", "b", "D_ONLY")).toBe(
      true,
    );
    expect(jevRunPairSourcesChanged(planned.scope, collection(changed), "b", "c", "D_ONLY")).toBe(
      false,
    );
  });

  test("captures immutable policy and exposes immutable ID/source snapshots", () => {
    const games = [
      game("a", { description: "desc-a", note: "private-note" }),
      game("b", { description: "desc-b", note: "private-note-b" }),
    ];
    const sourceCollection = collection(games);
    const planned = planJevRunScope(sourceCollection, capture(games));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    sourceCollection.semanticRedundancy.settings.cachedOwnerNoteUse = false;
    expect(planned.scope.cachedOwnerNoteUse).toBe(true);
    const pair = firstPair(planned.scope);
    expect(pair?.ownerNoteSignalRequired).toBe(true);
    expect(Reflect.set(planned.scope, "cachedOwnerNoteUse", false)).toBe(false);
    expect(Reflect.set(planned.scope.eligibleGameIds, "0", "other")).toBe(false);
    const source = planned.scope.sourceForGame("a");
    expect(source).toBeDefined();
    if (source) {
      expect(Reflect.set(source, "nameFingerprint", "changed")).toBe(false);
      expect(Reflect.set(source, "ownerNoteFingerprint", "private-note")).toBe(false);
      expect(source.ownerNoteFingerprint).not.toContain("private-note");
    }
    // Permission must still be rechecked against current collection state before dispatch.
    expect(sourceCollection.semanticRedundancy.settings.cachedOwnerNoteUse).toBe(false);
  });

  test("compares only source fields sent for each dependency kind", () => {
    const games = [
      game("a", { description: "desc-a", note: "note-a" }),
      game("b", { description: "desc-b", note: "note-b" }),
    ];
    const planned = planJevRunScope(collection(games), capture(games));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const noteChanged = structuredClone(games);
    const noteGame = noteChanged.find((entry) => entry.id === "a");
    if (noteGame?.ownerNote.state === "present") noteGame.ownerNote.text = "edited note";
    expect(
      jevRunPairSourcesChanged(planned.scope, collection(noteChanged), "a", "b", "C_ONLY"),
    ).toBe(false);
    expect(
      jevRunPairSourcesChanged(planned.scope, collection(noteChanged), "a", "b", "D_ONLY"),
    ).toBe(true);
    expect(
      jevRunPairSourcesChanged(planned.scope, collection(noteChanged), "a", "b", "SHARED_CD"),
    ).toBe(true);

    const descriptionChanged = structuredClone(games);
    const descriptionGame = descriptionChanged.find((entry) => entry.id === "a");
    if (descriptionGame?.bggData) descriptionGame.bggData.description = "edited description";
    expect(
      jevRunPairSourcesChanged(planned.scope, collection(descriptionChanged), "a", "b", "C_ONLY"),
    ).toBe(true);
    expect(
      jevRunPairSourcesChanged(planned.scope, collection(descriptionChanged), "a", "b", "D_ONLY"),
    ).toBe(false);
    expect(
      jevRunPairSourcesChanged(
        planned.scope,
        collection(descriptionChanged),
        "a",
        "b",
        "SHARED_CD",
      ),
    ).toBe(true);
  });

  test("missing notes early-out D pairs; C-only policy does not require notes", () => {
    const games = [game("a", { description: "desc-a" }), game("b", { description: "desc-b" })];
    const normal = planJevRunScope(collection(games), capture(games));
    expect(normal.ok).toBe(true);
    if (normal.ok) {
      const pair = firstPair(normal.scope);
      expect(pair?.descriptionSignalRequired).toBe(true);
      expect(pair?.ownerNoteSignalRequired).toBe(false);
      expect(normal.scope.ownerNoteBearingPairCount).toBe(0);
    }
    const cOnly = planJevRunScope(
      collection(games, { weights: { factual: 1, description: 1, ownerNote: 0 } }),
      capture(games),
    );
    expect(cOnly.ok).toBe(true);
    if (cOnly.ok) {
      const pair = firstPair(cOnly.scope);
      expect(pair?.descriptionSignalRequired).toBe(true);
      expect(pair?.ownerNoteSignalRequired).toBe(false);
      expect(pair?.ownerNoteSignalBlocked).toBe(false);
    }
  });

  test("reports positive note weight blocked when cached-note permission is absent", () => {
    const games = [
      game("a", { description: "d", note: "n1" }),
      game("b", { description: "d", note: "n2" }),
    ];
    const planned = planJevRunScope(
      collection(games, { cachedOwnerNoteUse: false }),
      capture(games),
    );
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      expect(planned.scope.ownerNoteSignalBlocked).toBe(true);
      const pair = firstPair(planned.scope);
      expect(pair?.ownerNoteSignalBlocked).toBe(true);
      expect(pair?.ownerNoteSignalRequired).toBe(false);
    }
  });
});
