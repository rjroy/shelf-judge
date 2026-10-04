import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { FitnessResult, WishlistEntry } from "@shelf-judge/shared";
import { WishlistCurrentProjectionCard } from "@/components/wishlist-current-projection";
import {
  sortCurrentWishlistRows,
  toCurrentWishlistRow,
} from "@/lib/wishlist-current-projection-view-model";

const entry: WishlistEntry = {
  id: "synthetic-entry",
  bggId: 999999,
  name: "Synthetic test game",
  yearPublished: null,
  thumbnailUrl: null,
  predictedScore: 9.8,
  predictionConfidence: "strong",
  predictedBreakdown: null,
  nicheImpact: null,
  redundancyPreview: null,
  addedAt: "2026-01-01T00:00:00.000Z",
};

const prediction: FitnessResult = {
  score: 0,
  ratedAxisCount: 1,
  totalAxisCount: 2,
  breakdown: [
    {
      axisId: "synthetic-axis",
      axisName: "Synthetic axis",
      weight: 1,
      contribution: 0,
      source: "predicted",
      derivedField: null,
      sourceValue: null,
      scoringRawValue: null,
      effectiveRating: 0,
      preferenceShape: "higher-is-better",
      curveAffected: false,
      unit: null,
      provenance: null,
      configurationSummary: null,
      overridden: false,
      overrideValue: null,
      predictionConfidence: "weak",
      referenceGames: null,
    },
  ],
  vetoed: false,
  vetoedBy: null,
  hypotheticalScore: null,
  predictionMeta: {
    readinessStage: 1,
    confidence: "weak",
    predictedAxisCount: 1,
    actualAxisCount: 0,
    referenceGameCount: 1,
    coveragePercent: 0,
  },
  redundancyAdjustment: null,
};

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    entry,
    prediction: {
      availability: "available",
      source: "current",
      result: prediction,
      predictionUnavailable: null,
    },
    redundancy: { source: "current", adjustment: null, orderingScore: 0 },
    ...overrides,
  };
}

describe("isolated current wishlist projection", () => {
  test("uses one current score and breakdown, including a genuine zero", () => {
    const row = toCurrentWishlistRow(envelope());
    expect(row?.prediction?.score).toBe(0);
    expect(row?.predictionAvailable).toBe(true);
    const html = renderToString(<WishlistCurrentProjectionCard row={row!} />);
    expect(html).toContain("Current prediction");
    expect(row?.prediction?.breakdown[0]?.axisName).toBe("Synthetic axis");
    expect(html).toContain("Per-axis breakdown");
    expect(html).toContain("0.0");
    expect(html).not.toContain("9.8");
  });

  test("does not restore historic fields for missing or unavailable current shapes", () => {
    expect(toCurrentWishlistRow({ entry, redundancy: {} })).toBeNull();
    const row = toCurrentWishlistRow({
      entry,
      prediction: {
        availability: "unavailable",
        source: "current",
        result: null,
        reason: "missing-source",
        predictionUnavailable: null,
      },
      redundancy: { source: "unavailable", adjustment: null, orderingScore: null },
    });
    expect(row?.prediction).toBeNull();
    expect(row?.unavailableMessage).toBe("Refresh factual details to calculate it.");
    expect(row?.redundancyScore).toBeNull();
    expect(
      toCurrentWishlistRow({
        ...envelope(),
        entry: { ...entry, bggSource: { secret: "private" } },
      }),
    ).toBeNull();
  });

  test("uses provided adjusted/base ordering scores once and leaves unavailable rows last", () => {
    const high = toCurrentWishlistRow(
      envelope({
        redundancy: { source: "current", adjustment: null, orderingScore: 8 },
      }),
    )!;
    const low = toCurrentWishlistRow(
      envelope({
        redundancy: { source: "base-prediction", adjustment: null, orderingScore: 3 },
      }),
    )!;
    const unavailable = toCurrentWishlistRow({
      entry,
      prediction: {
        availability: "unavailable",
        source: "current",
        result: null,
        reason: "source-unavailable",
        predictionUnavailable: null,
      },
      redundancy: { source: "unavailable", adjustment: null, orderingScore: null },
    })!;
    expect(sortCurrentWishlistRows([low, unavailable, high]).map((r) => r.redundancyScore)).toEqual(
      [8, 3, null],
    );
    expect(
      sortCurrentWishlistRows([high, low, unavailable], "asc").map((r) => r.redundancyScore),
    ).toEqual([3, 8, null]);
    expect(sortCurrentWishlistRows([unavailable, low, high], "asc", "name").at(-1)).toBe(
      unavailable,
    );
    expect(sortCurrentWishlistRows([unavailable, low, high], "desc", "addedAt").at(-1)).toBe(
      unavailable,
    );
  });
});
