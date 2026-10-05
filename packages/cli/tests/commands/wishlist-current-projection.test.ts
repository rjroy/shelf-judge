import { describe, expect, test } from "bun:test";
import {
  formatWishlistCurrentProjectionList,
  formatWishlistCurrentProjectionSavedMessage,
} from "../../src/commands/wishlist-current-projection.js";

const available = {
  entry: {
    id: "entry-1",
    bggId: 10,
    name: "Current game",
    yearPublished: 2020,
    thumbnailUrl: null,
    predictedScore: 9,
    predictionConfidence: "strong" as const,
    predictedBreakdown: null,
    nicheImpact: null,
    redundancyPreview: null,
    addedAt: "2026-01-01T00:00:00.000Z",
  },
  prediction: {
    availability: "available" as const,
    source: "current" as const,
    result: {
      score: 7.4,
      ratedAxisCount: 0,
      totalAxisCount: 1,
      breakdown: [],
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: {
        readinessStage: 1 as const,
        confidence: "moderate" as const,
        predictedAxisCount: 1,
        actualAxisCount: 0,
        referenceGameCount: 2,
        coveragePercent: 0.5,
      },
      redundancyAdjustment: null,
      redundancySimilarityInfo: { status: "disabled" as const, generationId: null },
    },
    predictionUnavailable: null,
  },
  redundancy: { source: "base-prediction" as const, adjustment: null, orderingScore: 7.4 },
};

const unavailable = {
  ...available,
  entry: { ...available.entry, id: "entry-2", name: "Old score must not leak", predictedScore: 9 },
  prediction: {
    availability: "unavailable" as const,
    source: "current" as const,
    result: null,
    reason: "missing-source" as const,
    predictionUnavailable: null,
  },
  redundancy: { source: "unavailable" as const, adjustment: null, orderingScore: null },
};

describe("staged CLI wishlist current projection", () => {
  test("formats current prediction, not saved score aliases", () => {
    const output = formatWishlistCurrentProjectionList([available, unavailable], { json: false });
    expect(output).toContain("7.4");
    expect(output).toContain("Current prediction unavailable");
    expect(output).not.toContain("9.0");
  });

  test("saved-message copy distinguishes factual source from current prediction", () => {
    expect(formatWishlistCurrentProjectionSavedMessage(available)).toContain(
      "Factual source saved. Current prediction: 7.4 (moderate).",
    );
    expect(formatWishlistCurrentProjectionSavedMessage(unavailable)).toContain(
      "Factual source saved. Current prediction unavailable (missing-source).",
    );
  });

  test("JSON mode returns only validated current projections", () => {
    const output = JSON.parse(
      formatWishlistCurrentProjectionList([unavailable], { json: true }),
    ) as Array<{ prediction: { availability: string }; entry: { bggSource?: unknown } }>;
    expect(output[0]?.prediction.availability).toBe("unavailable");
    expect(output[0]?.entry.bggSource).toBeUndefined();
    expect(() =>
      formatWishlistCurrentProjectionList([{ ...unavailable, savedScore: 9 }], { json: true }),
    ).toThrow();
  });
});
