import { describe, expect, test } from "bun:test";
import type { JevRunScopeDisclosure, JevRunScopeSelector } from "../src/index.js";

describe("wishlist Jev run scope contract", () => {
  test("expresses legacy collection, all wishlist, and explicit selected scopes", () => {
    const omittedScope: JevRunScopeSelector = {};
    const explicitCollection: JevRunScopeSelector = { scope: "collection" };
    const allWishlist: JevRunScopeSelector = { scope: "wishlist" };
    const selectedWishlist: JevRunScopeSelector = {
      scope: "wishlist",
      selection: { kind: "selected", bggIds: [41, 73] },
    };

    expect(omittedScope.scope).toBeUndefined();
    expect(explicitCollection.scope).toBe("collection");
    expect(allWishlist.selection).toBeUndefined();
    expect(selectedWishlist.selection).toEqual({ kind: "selected", bggIds: [41, 73] });
  });

  test("partitions selected, overlapping, eligible, and unavailable counts", () => {
    const disclosure = {
      scope: "wishlist",
      wishlistEntryCount: 5,
      selectedCandidateCount: 3,
      unselectedEntryCount: 2,
      ownedOverlapCandidateCount: 1,
      requestedCandidateCount: 2,
      eligibleCandidateCount: 1,
      unavailableCandidateCount: 1,
      eligibleOwnedGameCount: 1,
      comparisonPairCount: 1,
      cachedHitPairCount: 0,
      sendablePairCount: 0,
    } satisfies JevRunScopeDisclosure;

    expect(disclosure.wishlistEntryCount).toBe(
      disclosure.selectedCandidateCount + disclosure.unselectedEntryCount,
    );
    expect(disclosure.selectedCandidateCount).toBe(
      disclosure.ownedOverlapCandidateCount + disclosure.requestedCandidateCount,
    );
    expect(disclosure.requestedCandidateCount).toBe(
      disclosure.eligibleCandidateCount + disclosure.unavailableCandidateCount,
    );
  });
});
