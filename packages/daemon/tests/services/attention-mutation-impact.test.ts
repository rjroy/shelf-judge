import { describe, expect, test } from "bun:test";
import {
  CollectionMutationOperation,
  attentionImpactForCollectionMutation,
} from "../../src/services/attention-mutation-impact.js";

describe("collection attention mutation policy", () => {
  test("classifies every closed production operation", () => {
    const impacts = Object.values(CollectionMutationOperation).map((operation) =>
      attentionImpactForCollectionMutation(operation, ["b", "a", "b"]),
    );
    expect(impacts).toHaveLength(Object.keys(CollectionMutationOperation).length);
    expect(impacts.every((impact) => impact !== undefined)).toBe(true);
    expect(
      attentionImpactForCollectionMutation(CollectionMutationOperation.gameRate, ["a"]),
    ).toEqual({
      kind: "global",
      reason: "rating",
    });
    expect(attentionImpactForCollectionMutation(CollectionMutationOperation.axisUpdate)).toEqual({
      kind: "global",
      reason: "axis",
    });
    expect(attentionImpactForCollectionMutation(CollectionMutationOperation.benchmarkSet)).toEqual({
      kind: "global",
      reason: "purchase-benchmark",
    });
  });

  test("keeps exact, identity-only, and read impacts distinct", () => {
    expect(
      attentionImpactForCollectionMutation(CollectionMutationOperation.acquisitionSet, [
        "b",
        "a",
        "b",
      ]),
    ).toEqual({ kind: "games", gameIds: ["a", "b"] });
    expect(
      attentionImpactForCollectionMutation(CollectionMutationOperation.gameDimensionsSet, ["a"]),
    ).toEqual({ kind: "games", gameIds: [] });
    expect(attentionImpactForCollectionMutation(CollectionMutationOperation.noteGet)).toBeNull();
    expect(
      attentionImpactForCollectionMutation(CollectionMutationOperation.intentionDetail),
    ).toBeNull();
  });
});
