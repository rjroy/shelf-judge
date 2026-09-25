import { describe, expect, test } from "bun:test";
import type { WishlistEntry } from "@shelf-judge/shared";
import {
  loadWishlistSortField,
  saveWishlistSortField,
  sortEntries,
  SORT_OPTIONS,
} from "@/app/wishlist/page";

function entry(
  id: string,
  adjustedScore: number | null,
  predictedScore: number | null = 7,
): WishlistEntry {
  return {
    id,
    bggId: 1,
    name: id,
    yearPublished: null,
    thumbnailUrl: null,
    predictedScore,
    predictionConfidence: null,
    predictedBreakdown: null,
    nicheImpact: null,
    redundancyPreview:
      adjustedScore === null
        ? null
        : {
            originalScore: adjustedScore,
            adjustedScore,
            penalty: 0,
            nicheRank: 1,
            nicheSize: 1,
            nicheNeighbors: [],
          },
    addedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("wishlist redundancy sorting", () => {
  test("sorts adjusted scores descending, keeps ties stable, and puts missing data last", () => {
    const entries = [
      entry("tie-first", 7),
      entry("low", 5),
      entry("high", 9),
      entry("tie-second", 7),
      entry("no-preview", null),
      entry("no-prediction", 10, null),
    ];

    expect(sortEntries(entries, "redundancy").map(({ id }) => id)).toEqual([
      "high",
      "tie-first",
      "tie-second",
      "low",
      "no-preview",
      "no-prediction",
    ]);
  });

  test("offers the With Redundancy sort menu option", () => {
    expect(SORT_OPTIONS).toContainEqual({ value: "redundancy", label: "With Redundancy" });
  });
});

describe("wishlist sort preference", () => {
  const storageKey = "shelf-judge:wishlist-sort";

  test("loads and saves a valid sort field using the wishlist-specific key", () => {
    const values = new Map<string, string>([[storageKey, "name"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(loadWishlistSortField(storage)).toBe("name");
    saveWishlistSortField(storage, "redundancy");
    expect(values.get(storageKey)).toBe("redundancy");
  });

  test("defaults when the preference is missing, obsolete, or corrupt", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null };

    expect(loadWishlistSortField(storage)).toBe("addedAt");
    values.set(storageKey, "old-sort-mode");
    expect(loadWishlistSortField(storage)).toBe("addedAt");
    values.set(storageKey, "{broken-json");
    expect(loadWishlistSortField(storage)).toBe("addedAt");
    expect(loadWishlistSortField(null)).toBe("addedAt");
  });

  test("ignores storage methods that are unavailable or throw", () => {
    expect(
      loadWishlistSortField({
        getItem: () => {
          throw new Error("storage blocked");
        },
      }),
    ).toBe("addedAt");
    expect(() =>
      saveWishlistSortField(
        {
          setItem: () => {
            throw new Error("storage blocked");
          },
        },
        "name",
      ),
    ).not.toThrow();
    expect(() => saveWishlistSortField(null, "name")).not.toThrow();
  });
});
