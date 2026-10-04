import { describe, expect, test } from "bun:test";
import {
  CurrentPredictionProjectionSchemaV2,
  WishlistEntryReadResultSchemaV2,
  WishlistRedundancyProjectionSchemaV2,
} from "../src/wishlist-current-projection-v2.js";

const result = {
  score: 0,
  ratedAxisCount: 0,
  totalAxisCount: 1,
  breakdown: [],
  vetoed: true,
  vetoedBy: {
    axisId: "personal",
    axisName: "Personal",
    threshold: 2,
    direction: "below" as const,
    rawValue: 1,
  },
  hypotheticalScore: 0,
  predictionMeta: null,
  redundancyAdjustment: null,
  redundancySimilarityInfo: { status: "disabled" as const, generationId: null },
};

const entry = {
  id: "entry-1",
  bggId: 21,
  name: "Saved title",
  yearPublished: null,
  thumbnailUrl: null,
  predictedScore: 0,
  predictionConfidence: null,
  predictedBreakdown: null,
  nicheImpact: null,
  redundancyPreview: null,
  addedAt: "2026-01-01T00:00:00.000Z",
};

describe("wishlist current projection v2 contracts", () => {
  test("accepts genuine current veto-zero as available and rejects saved-derived source", () => {
    expect(
      CurrentPredictionProjectionSchemaV2.safeParse({
        availability: "available",
        source: "current",
        result,
        predictionUnavailable: null,
      }).success,
    ).toBe(true);
    expect(
      WishlistRedundancyProjectionSchemaV2.safeParse({
        source: "saved-factual",
        adjustment: null,
        orderingScore: 3,
      }).success,
    ).toBe(false);
  });

  test("requires explicit unavailable semantics and rejects private/unknown payload fields", () => {
    expect(
      CurrentPredictionProjectionSchemaV2.safeParse({
        availability: "unavailable",
        source: "current",
        result: null,
        reason: "missing-source",
        predictionUnavailable: null,
      }).success,
    ).toBe(true);
    expect(
      CurrentPredictionProjectionSchemaV2.safeParse({
        availability: "unavailable",
        source: "current",
        result: null,
        reason: "missing-source",
        predictionUnavailable: null,
        savedScore: 8,
      }).success,
    ).toBe(false);
    expect(
      WishlistEntryReadResultSchemaV2.safeParse({
        entry: { ...entry, bggSource: { description: "private source" } },
        prediction: {
          availability: "unavailable",
          source: "current",
          result: null,
          reason: "missing-source",
          predictionUnavailable: null,
        },
        redundancy: { source: "unavailable", adjustment: null, orderingScore: null },
      }).success,
    ).toBe(false);
  });

  test("accepts a strict safe read result", () => {
    expect(
      WishlistEntryReadResultSchemaV2.safeParse({
        entry,
        prediction: {
          availability: "available",
          source: "current",
          result,
          predictionUnavailable: null,
        },
        redundancy: { source: "base-prediction", adjustment: null, orderingScore: 0 },
      }).success,
    ).toBe(true);
  });
});
