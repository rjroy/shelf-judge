import { describe, expect, test } from "bun:test";
import type { CollectionV10, DurableGame } from "@shelf-judge/shared";
import { planJevMutationImpact } from "../../src/services/jev-mutation-impact.js";

function game(id: string): DurableGame {
  return {
    id,
    name: `Game ${id}`,
    bggData: { description: "description" },
    ownerNote: { state: "present", version: 1, updatedAt: "t1", text: "note" },
    ownership: "owned",
    updatedAt: "t1",
  } as DurableGame;
}

function collection(games: DurableGame[]): CollectionV10 {
  return {
    games,
    semanticRedundancy: {
      settings: {
        enabled: true,
        weights: { factual: 1, description: 1, ownerNote: 1 },
        cachedOwnerNoteUse: true,
      },
      evidenceEpoch: 1,
      consentEpoch: 1,
      factualWeightsEpoch: 1,
      factualWeightsFingerprint: "weights",
    },
  } as CollectionV10;
}

describe("planJevMutationImpact", () => {
  test("maps exact name, description and note changes to source dependency kinds", () => {
    const original = [game("a"), game("b"), game("c")];
    const changed = structuredClone(original);
    changed[0].name = "Renamed";
    changed[1].bggData!.description = "new description";
    changed[2].ownerNote = { state: "present", version: 2, updatedAt: "t2", text: "note" };

    const impact = planJevMutationImpact(collection(original), collection(changed));
    expect(impact.sourceInvalidations).toEqual([
      { gameId: "a", kinds: ["C_ONLY", "D_ONLY", "SHARED_CD"] },
      { gameId: "b", kinds: ["C_ONLY", "SHARED_CD"] },
      { gameId: "c", kinds: ["D_ONLY", "SHARED_CD"] },
    ]);
    expect(impact.withdrawAdvisory).toBe(false);
  });

  test("preserves unrelated pair rows and ignores timestamp-only changes", () => {
    const original = [game("a"), game("b"), game("c")];
    const changed = structuredClone(original);
    changed[0].bggData!.description = "updated";
    changed[1].updatedAt = "later";
    changed[1].bggData!.fetchedAt = "later";
    changed[1].ownerNote.updatedAt = "later";

    expect(planJevMutationImpact(collection(original), collection(changed))).toEqual({
      sourceInvalidations: [{ gameId: "a", kinds: ["C_ONLY", "SHARED_CD"] }],
      withdrawAdvisory: false,
      affectedGameIds: [],
    });
  });

  test("withdraws advisory activation for additions and policy epoch changes", () => {
    const prior = collection([game("a"), game("b")]);
    const added = collection([game("a"), game("b"), game("c")]);
    const addedImpact = planJevMutationImpact(prior, added);
    expect(addedImpact.withdrawAdvisory).toBe(true);
    expect(addedImpact.affectedGameIds).toEqual(["c"]);
    expect(addedImpact.sourceInvalidations).toEqual([]);

    const changedPolicy = collection([game("a"), game("b")]);
    changedPolicy.semanticRedundancy.evidenceEpoch++;
    expect(planJevMutationImpact(prior, changedPolicy)).toMatchObject({
      withdrawAdvisory: true,
      sourceInvalidations: [],
      affectedGameIds: [],
    });
  });

  test("deletes all dependency classes only for a removed source game", () => {
    const prior = collection([game("a"), game("b"), game("c")]);
    const accepted = collection([game("a"), game("c")]);
    accepted.games[0].bggData!.description = "updated";
    expect(planJevMutationImpact(prior, accepted).sourceInvalidations).toEqual([
      { gameId: "a", kinds: ["C_ONLY", "SHARED_CD"] },
      { gameId: "b", kinds: ["C_ONLY", "D_ONLY", "SHARED_CD"] },
    ]);
  });
});
