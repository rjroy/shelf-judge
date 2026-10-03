import { describe, expect, test } from "bun:test";
import { wishlistAdd, wishlistList, wishlistRefresh } from "../../src/commands/wishlist.js";
import { createMockClient } from "../helpers/mock-client.js";

const preview = {
  penalty: 1.2,
  originalScore: 8,
  adjustedScore: 6.8,
  nicheNeighbors: [
    { gameId: "1", gameName: "Game One", similarity: 0.9, fitnessScore: 8 },
    { gameId: "2", gameName: "Game Two", similarity: 0.8, fitnessScore: 7 },
    { gameId: "3", gameName: "Game Three", similarity: 0.7, fitnessScore: 6 },
    { gameId: "4", gameName: "Game Four", similarity: 0.6, fitnessScore: 5 },
  ],
  nicheRank: 4,
  nicheSize: 5,
};

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
  addedAt: "2026-01-01T00:00:00Z",
  redundancyPreview: preview,
};

describe("wishlist redundancy preview", () => {
  test("list shows adjusted score, penalty, and at most three similar games", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/wishlist/redundancy": {
          response: {
            ok: true,
            status: 200,
            data: [
              {
                entry,
                redundancy: { source: "current", adjustment: preview, orderingScore: 6.8 },
              },
            ],
          },
        },
      },
    });

    const output = await wishlistList(client, [], { json: false });
    expect(output).toContain("6.8 (current; -1.2)");
    expect(output).toContain("Game One, Game Two, Game Three");
    expect(output).not.toContain("Game Four");
  });

  test("add and refresh explain the adjusted score and penalty", async () => {
    const client = createMockClient({
      routes: {
        "POST /api/wishlist": { response: { ok: true, status: 200, data: { entry } } },
        "POST /api/wishlist/entry-1/refresh": {
          response: { ok: true, status: 200, data: { entry } },
        },
      },
    });

    const added = await wishlistAdd(client, ["123"], { json: false });
    const refreshed = await wishlistRefresh(client, ["entry-1"], { json: false });
    for (const output of [added, refreshed]) {
      expect(output).toContain("Adjusted score: 6.8 (redundancy penalty: -1.2)");
      expect(output).toContain("Top similar collection games: Game One, Game Two, Game Three");
      expect(output).not.toContain("Game Four");
    }
  });

  test("null preview does not imply a reduction and JSON labels its factual-only semantics", async () => {
    const noPreview = { ...entry, redundancyPreview: null };
    const client = createMockClient({
      routes: {
        "GET /api/wishlist/redundancy": {
          response: {
            ok: true,
            status: 200,
            data: [
              {
                entry: noPreview,
                redundancy: { source: "base-prediction", adjustment: null, orderingScore: 8 },
              },
            ],
          },
        },
        "POST /api/wishlist": { response: { ok: true, status: 200, data: { entry: noPreview } } },
      },
    });

    const listed = await wishlistList(client, [], { json: false });
    const addedJson = await wishlistAdd(client, ["123"], { json: true });
    expect(listed).toContain("8.0 (base-prediction)");
    expect(listed).not.toContain("penalty");
    expect(JSON.parse(addedJson)).toEqual({ ...noPreview, redundancyPreviewMode: "factual-only" });
  });

  test("list renders current, saved-factual, then base fallback without recalculating penalties", async () => {
    const results = [
      {
        entry: { ...entry, name: "Current" },
        redundancy: { source: "current", adjustment: preview, orderingScore: 6.8 },
      },
      {
        entry: { ...entry, name: "Saved" },
        redundancy: { source: "saved-factual", adjustment: preview, orderingScore: 6.8 },
      },
      {
        entry: { ...entry, name: "Base" },
        redundancy: { source: "base-prediction", adjustment: null, orderingScore: 8 },
      },
    ];
    const client = createMockClient({
      routes: {
        "GET /api/wishlist/redundancy": {
          response: { ok: true, status: 200, data: results },
        },
      },
    });

    const human = await wishlistList(client, [], { json: false });
    expect(human).toContain("6.8 (current; -1.2)");
    expect(human).toContain("6.8 (saved-factual; -1.2)");
    expect(human).toContain("8.0 (base-prediction)");
    const json = JSON.parse(await wishlistList(client, [], { json: true })) as Array<{
      entry: { bggSource?: unknown };
      redundancy: { source: string; orderingScore: number | null };
    }>;
    expect(json.map((result) => result.redundancy.source)).toEqual([
      "current",
      "saved-factual",
      "base-prediction",
    ]);
    expect(json[2]?.redundancy.orderingScore).toBe(8);
    expect(json[2]?.entry.bggSource).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("bggSource");
  });
});
