import { describe, expect, test } from "bun:test";
import { wishlistAdd, wishlistList, wishlistRefresh } from "../../src/commands/wishlist.js";
import { createMockClient } from "../helpers/mock-client.js";

const entry = {
  id: "entry-1",
  bggId: 123,
  name: "Wishlist Game",
  yearPublished: 2024,
  thumbnailUrl: null,
  predictedScore: 8,
  predictionConfidence: "strong" as const,
  predictedBreakdown: null,
  nicheImpact: null,
  redundancyPreview: null,
  addedAt: "2026-01-01T00:00:00Z",
};

const available = {
  entry,
  prediction: {
    availability: "available" as const,
    source: "current" as const,
    result: {
      score: 7.25,
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
        referenceGameCount: 1,
        coveragePercent: 1,
      },
      redundancyAdjustment: null,
      redundancySimilarityInfo: { status: "disabled" as const, generationId: null },
    },
    predictionUnavailable: null,
  },
  redundancy: { source: "base-prediction" as const, adjustment: null, orderingScore: 7.25 },
};

const unavailable = {
  ...available,
  entry: { ...entry, predictedScore: null, predictionConfidence: null },
  prediction: {
    availability: "unavailable" as const,
    source: "current" as const,
    result: null,
    reason: "missing-source" as const,
    predictionUnavailable: null,
  },
  redundancy: { source: "unavailable" as const, adjustment: null, orderingScore: null },
};

describe("active CLI wishlist current projection", () => {
  test("list formats V2 current values and never falls back to saved aliases", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/wishlist/redundancy": {
          response: { ok: true, status: 200, data: [available, unavailable] },
        },
      },
    });
    const human = await wishlistList(client, [], { json: false });
    expect(human).toContain("7.3");
    expect(human).toContain("Current prediction unavailable");
    expect(human).not.toContain("8.0");
    const json = JSON.parse(await wishlistList(client, [], { json: true })) as unknown[];
    expect(json).toHaveLength(2);
    expect(JSON.stringify(json)).not.toContain("bggSource");
  });

  test("add and refresh print current aliases rather than historical preview fields", async () => {
    const currentEntry = { ...entry, predictedScore: 7.25, predictionConfidence: "moderate" };
    const client = createMockClient({
      routes: {
        "POST /api/wishlist": {
          response: { ok: true, status: 201, data: { entry: currentEntry } },
        },
        "POST /api/wishlist/entry-1/refresh": {
          response: { ok: true, status: 200, data: { entry: currentEntry } },
        },
      },
    });
    expect(await wishlistAdd(client, ["123"], { json: false })).toContain("available: 7.3");
    expect(await wishlistRefresh(client, ["entry-1"], { json: false })).toContain("available: 7.3");
  });

  test("unavailable current projection is explicit in list JSON", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/wishlist/redundancy": {
          response: { ok: true, status: 200, data: [unavailable] },
        },
      },
    });
    const parsed = JSON.parse(await wishlistList(client, [], { json: true })) as Array<{
      prediction: { availability: string; reason?: string };
    }>;
    expect(parsed[0]?.prediction).toMatchObject({
      availability: "unavailable",
      reason: "missing-source",
    });
  });
});
