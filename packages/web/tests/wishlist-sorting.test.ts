import { describe, expect, test } from "bun:test";
import type { WishlistEntry } from "@shelf-judge/shared";
import { sortEntries, SORT_OPTIONS } from "@/app/wishlist/page";

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
