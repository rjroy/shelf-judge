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
  vetoed: true,
  vetoedBy: {
    axisId: "synthetic-axis",
    axisName: "Synthetic axis",
    threshold: 1,
    direction: "below",
    rawValue: 0,
  },
  hypotheticalScore: 4.5,
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
  test("keeps current Community Rating breakdown on effective rating, not factual inputs", () => {
    const communityRating = {
      ...prediction.breakdown[0],
      axisId: "community-rating",
      axisName: "Community Rating",
      source: "derived" as const,
      derivedField: "communityRating" as const,
      sourceValue: 8,
      scoringRawValue: 7,
      effectiveRating: 6,
      contribution: 6,
      predictionConfidence: "actual" as const,
    };
    const row = toCurrentWishlistRow(
      envelope({
        entry: {
          ...entry,
          predictedBreakdown: [{ axisName: "Community Rating", rating: 1, confidence: "actual" }],
        },
        prediction: {
          availability: "available",
          source: "current",
          result: { ...prediction, breakdown: [communityRating] },
          predictionUnavailable: null,
        },
      }),
    )!;

    // Current projection wins over the historical saved breakdown; the axis display value
    // is the server-provided effective rating, not sourceValue or scoringRawValue.
    expect(row.prediction?.breakdown[0]?.effectiveRating).toBe(6);
    expect(row.prediction?.breakdown[0]?.sourceValue).toBe(8);
    expect(row.prediction?.breakdown[0]?.scoringRawValue).toBe(7);
    expect(row.entry.predictedBreakdown?.[0]?.rating).toBe(1);
  });

  test("preserves a missing current effective rating and a genuine zero", () => {
    const missing = {
      ...prediction.breakdown[0],
      axisId: "community-rating",
      axisName: "Community Rating",
      source: "derived" as const,
      derivedField: "communityRating" as const,
      sourceValue: null,
      scoringRawValue: null,
      effectiveRating: null,
      contribution: null,
      predictionConfidence: "actual" as const,
    };
    const zero = { ...missing, axisId: "zero-axis", axisName: "Zero axis", effectiveRating: 0 };
    const row = toCurrentWishlistRow(
      envelope({
        prediction: {
          availability: "available",
          source: "current",
          result: { ...prediction, breakdown: [missing, zero] },
          predictionUnavailable: null,
        },
      }),
    )!;
    expect(row.prediction?.breakdown.map((axis) => axis.effectiveRating)).toEqual([null, 0]);
    expect(row.prediction?.breakdown[0]?.sourceValue).toBeNull();
  });

  test("rejects omitted required current rating metadata instead of coercing it", () => {
    const malformed = envelope({
      prediction: {
        availability: "available",
        source: "current",
        result: {
          ...prediction,
          breakdown: [{ ...prediction.breakdown[0], effectiveRating: undefined }],
        },
        predictionUnavailable: null,
      },
    });
    expect(toCurrentWishlistRow(malformed)).toBeNull();
  });

  test("uses one current score and breakdown, including a genuine zero", () => {
    const row = toCurrentWishlistRow(envelope());
    expect(row?.prediction?.score).toBe(0);
    expect(row?.predictionAvailable).toBe(true);
    const html = renderToString(
      <WishlistCurrentProjectionCard
        row={row!}
        onRemove={() => {}}
        onRefresh={async () => {}}
        onAddToCollection={async () => {}}
      />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain("Current prediction");
    expect(row?.prediction?.breakdown[0]?.axisName).toBe("Synthetic axis");
    expect(html).toContain("Per-axis breakdown");
    expect(html).toContain("0.0");
    expect(html).toContain("Vetoed");
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

  test("displays the supplied current adjustment without applying its penalty again", () => {
    const row = toCurrentWishlistRow(
      envelope({
        redundancy: {
          source: "current",
          orderingScore: 7.1,
          adjustment: {
            originalScore: 8.4,
            adjustedScore: 7.1,
            penalty: 1.3,
            nicheRank: 1,
            nicheSize: 2,
            nicheNeighbors: [
              {
                gameId: "synthetic-owned",
                gameName: "Synthetic owned game",
                similarity: 0.91,
                fitnessScore: 8,
                isPredicted: false,
              },
            ],
          },
        },
      }),
    );
    const html = renderToString(
      <WishlistCurrentProjectionCard
        row={row!}
        onRemove={() => {}}
        onRefresh={async () => {}}
        onAddToCollection={async () => {}}
      />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain("With redundancy:");
    expect(html).toContain("7.1");
    expect(html).toContain("-1.3");
    expect(html).toContain("Synthetic owned game");
    expect(html).not.toContain("5.8");
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
    const zeroScore = toCurrentWishlistRow(
      envelope({
        prediction: {
          availability: "available",
          source: "current",
          result: prediction,
          predictionUnavailable: null,
        },
      }),
    )!;
    const elevatedScore = toCurrentWishlistRow(
      envelope({
        prediction: {
          availability: "available",
          source: "current",
          result: {
            ...prediction,
            score: 8,
            vetoed: false,
            vetoedBy: null,
            hypotheticalScore: null,
          },
          predictionUnavailable: null,
        },
      }),
    )!;
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
    expect(
      sortCurrentWishlistRows([unavailable, zeroScore, elevatedScore], "asc", "score").map(
        (row) => row.prediction?.score ?? null,
      ),
    ).toEqual([0, 8, null]);
    expect(
      sortCurrentWishlistRows([unavailable, zeroScore, elevatedScore], "desc", "score").map(
        (row) => row.prediction?.score ?? null,
      ),
    ).toEqual([8, 0, null]);
  });
});
