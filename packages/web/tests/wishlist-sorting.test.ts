import { describe, expect, test } from "bun:test";
import type { WishlistEntry } from "@shelf-judge/shared";
import {
  loadWishlistSortField,
  saveWishlistSortField,
  sortEntries,
  SORT_OPTIONS,
  validateWishlistRunBudget,
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
      "no-preview",
      "low",
      "no-prediction",
    ]);
  });

  test("offers the With Redundancy sort menu option", () => {
    expect(SORT_OPTIONS).toContainEqual({ value: "redundancy", label: "With Redundancy" });
  });

  test("uses current projection first, saved factual adjustment next, and base score last", () => {
    const rows = [
      { ...entry("current-first", 1, 2), bggId: 1 },
      { ...entry("saved-second", 9, 5), bggId: 2 },
      { ...entry("base-third", null, 4), bggId: 3 },
    ];
    const projections = new Map([
      [1, { source: "current" as const, adjustment: null, orderingScore: 10 }],
      [2, { source: "saved-factual" as const, adjustment: null, orderingScore: 3 }],
      [3, { source: "base-prediction" as const, adjustment: null, orderingScore: 4 }],
    ]);
    expect(sortEntries(rows, "redundancy", projections).map(({ id }) => id)).toEqual([
      "current-first",
      "base-third",
      "saved-second",
    ]);
    expect(sortEntries(rows, "predictedScore", projections).map(({ id }) => id)).toEqual([
      "saved-second",
      "base-third",
      "current-first",
    ]);
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

describe("wishlist run budget validation", () => {
  test("converts valid per-run values and enforces whole-number limits", () => {
    expect(validateWishlistRunBudget("1000", "2000000", "30")).toEqual({
      budget: {
        maxProviderAttempts: 1000,
        reportedTokenStopThreshold: 2_000_000,
        maxRunDurationMs: 1_800_000,
      },
      error: null,
    });
    expect(validateWishlistRunBudget("75001", "2000000", "30").error).toContain(
      "cannot exceed 75,000",
    );
    expect(validateWishlistRunBudget("10", "0", "30").error).toContain("positive, safe");
    expect(validateWishlistRunBudget("10", "1000", "721").error).toContain("12 hours");
  });
});
