import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, createMockBggClient, type TestAppContext } from "../helpers/test-app.js";
import type { BggGameResult } from "../../src/services/bgg-client.js";
import type { BggCollectionItem } from "../../src/services/bgg-xml-parser.js";

let ctx: TestAppContext;

beforeEach(() => {
  ctx = createTestApp();
});

async function postImportBgg(app: TestAppContext["app"], username: string): Promise<Response> {
  return app.request(
    new Request("http://localhost/api/import/bgg", {
      method: "POST",
      body: JSON.stringify({ username }),
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function parseSSEEvents(text: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  const blocks = text.split("\n\n").filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        data = line.slice("data:".length).trim();
      }
    }
    if (event || data) {
      events.push({ event, data });
    }
  }

  return events;
}

describe("POST /api/import/bgg", () => {
  test("returns 503 when BGG is not configured", async () => {
    // Default createTestApp has no bggClient
    const res = await postImportBgg(ctx.app, "testuser");
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.error).toContain("not configured");
  });

  test("returns SSE stream with progress and complete events", async () => {
    const collectionItems: BggCollectionItem[] = [
      { bggId: 1, name: "Game 1", yearPublished: 2020 },
      { bggId: 2, name: "Game 2", yearPublished: 2021 },
    ];

    const gameResults = new Map<number, BggGameResult>();
    gameResults.set(1, {
      metadata: {
        bggId: 1,
        name: "Game 1",
        yearPublished: 2020,
        minPlayers: 1,
        maxPlayers: 4,
        playingTime: 60,
        imageUrl: "https://example.com/game1.jpg",
      },
      bggData: {
        communityRating: 7.5,
        bayesAverage: 7.2,
        weight: 2.5,
        numWeightVotes: 100,
        mechanics: [],
        categories: [],
        subdomains: [],
        suggestedPlayerCounts: [],
        fetchedAt: new Date().toISOString(),
      },
    });
    gameResults.set(2, {
      metadata: {
        bggId: 2,
        name: "Game 2",
        yearPublished: 2021,
        minPlayers: 2,
        maxPlayers: 6,
        playingTime: 90,
        imageUrl: "https://example.com/game2.jpg",
      },
      bggData: {
        communityRating: 8.0,
        bayesAverage: 7.8,
        weight: 3.0,
        numWeightVotes: 200,
        mechanics: [],
        categories: [],
        subdomains: [],
        suggestedPlayerCounts: [],
        fetchedAt: new Date().toISOString(),
      },
    });

    const mockClient = createMockBggClient({
      getUserCollection: async () => collectionItems,
      getGames: async (_ids, onBatch) => {
        await onBatch?.({ batchIds: _ids, results: gameResults });
        return gameResults;
      },
    });

    ctx = createTestApp({ bggClient: mockClient });

    const res = await postImportBgg(ctx.app, "testuser");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSSEEvents(text);

    // Should have at least one progress event and one complete event
    const progressEvents = events.filter((e) => e.event === "progress");
    const completeEvents = events.filter((e) => e.event === "complete");

    expect(progressEvents.length).toBeGreaterThan(0);
    expect(completeEvents.length).toBe(1);

    const complete = JSON.parse(completeEvents[0].data);
    expect(complete.imported).toBe(2);
    expect(complete.skipped).toBe(0);
    expect(complete.errors).toEqual([]);
  });
});
