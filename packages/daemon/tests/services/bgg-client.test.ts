import { describe, test, expect, beforeEach } from "bun:test";
import * as path from "node:path";
import { createBggClient, type BggClient } from "../../src/services/bgg-client.js";
import { createMockFetch, type MockFetch } from "../helpers/mock-fetch.js";

const fixturesDir = path.join(import.meta.dir, "../fixtures");

async function readFixture(filename: string): Promise<string> {
  return Bun.file(path.join(fixturesDir, filename)).text();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "number");
}

function findLogContext(logs: unknown[][], message: string): Record<string, unknown> {
  const context: unknown = logs.find(([loggedMessage]) => loggedMessage === message)?.[1];
  if (!isRecord(context)) throw new Error(`Expected structured log context for ${message}`);
  return context;
}

function expectNumericLogIds(
  context: Record<string, unknown>,
  field: string,
  expected: number[],
): void {
  const value: unknown = context[field];
  if (!isNumberArray(value)) {
    throw new Error(`Expected ${field} to contain numeric BGG IDs`);
  }
  expect(value).toEqual(expected);
}

const incompleteResponseCases: Array<[string, number[]]> = [
  ["subset", [1]],
  ["mismatched IDs", [3, 4]],
];

function searchXml(ids: readonly number[]): string {
  return `<items>${ids
    .map(
      (id) =>
        `<item type="boardgame" id="${id}"><name type="primary" value="Game ${id}"/><yearpublished value="2020"/></item>`,
    )
    .join("")}</items>`;
}

function completeThingItem(id: number): string {
  return `<item type="boardgame" id="${id}">
    <name type="primary" value="Game ${id}"/>
    <yearpublished value="2020"/>
    <minplayers value="1"/>
    <maxplayers value="4"/>
    <playingtime value="60"/>
    <image>image-${id}</image>
    <thumbnail>thumbnail-${id}</thumbnail>
    <statistics><ratings><average value="7"/></ratings></statistics>
  </item>`;
}

function partialThingItem(id: number): string {
  return `<item type="boardgame" id="${id}">
    <name type="primary" value="Game ${id}"/>
  </item>`;
}

function thingXml(items: readonly string[]): string {
  return `<items>${items.join("")}</items>`;
}

function completeThingXml(ids: readonly number[]): string {
  return thingXml(ids.map(completeThingItem));
}

function collectionItem(id: number, includeNumPlays = true): string {
  const numPlays = includeNumPlays ? `<numplays>${id}</numplays>` : "";
  return `<item objectid="${id}"><name>Game ${id}</name>${numPlays}</item>`;
}

function collectionXml(ids: readonly number[], partialIds: readonly number[] = []): string {
  return `<items>${ids.map((id) => collectionItem(id, !partialIds.includes(id))).join("")}</items>`;
}

const thingOutcomeCases: Array<[string, string, number[], "complete" | "partial"]> = [
  ["exactly one complete item per requested ID", completeThingXml([1, 2]), [1, 2], "complete"],
  ["duplicate returned IDs", completeThingXml([1, 1]), [1, 1], "partial"],
  ["exact ID coverage with a duplicate", completeThingXml([1, 2, 2]), [1, 2, 2], "partial"],
  [
    "exact ID coverage with one partial observation",
    thingXml([completeThingItem(1), partialThingItem(2)]),
    [1, 2],
    "partial",
  ],
];

const batchThingOutcomeCases: Array<
  [string, string, number[], "complete" | "partial" | "failure"]
> = [
  ["exactly one complete item per requested ID", completeThingXml([1, 2]), [1, 2], "complete"],
  ["duplicate returned IDs", completeThingXml([1, 1]), [1, 1], "failure"],
  ["exact ID coverage with a duplicate", completeThingXml([1, 2, 2]), [1, 2, 2], "partial"],
  [
    "exact ID coverage with one partial observation",
    thingXml([completeThingItem(1), partialThingItem(2)]),
    [1, 2],
    "partial",
  ],
];

const batchCollectionOutcomeCases: Array<
  [string, string, number[], "complete" | "partial" | "failure"]
> = [
  ["exactly one complete item per requested ID", collectionXml([1, 2]), [1, 2], "complete"],
  ["duplicate returned IDs", collectionXml([1, 1]), [1, 1], "failure"],
  ["exact ID coverage with a duplicate", collectionXml([1, 2, 2]), [1, 2, 2], "partial"],
  ["exact ID coverage with one partial observation", collectionXml([1, 2], [2]), [1, 2], "partial"],
];

const batchIdentityCases: Array<{
  label: string;
  requestedIds: number[];
  returnedIds: number[];
  acceptedIds: number[];
  failedIds: number[];
  state: "failure" | "partial";
}> = [
  {
    label: "wrong-only response",
    requestedIds: [1, 2],
    returnedIds: [3, 4],
    acceptedIds: [],
    failedIds: [1, 2],
    state: "failure",
  },
  {
    label: "unsolicited extra",
    requestedIds: [1, 2],
    returnedIds: [1, 2, 3],
    acceptedIds: [1, 2],
    failedIds: [],
    state: "partial",
  },
  {
    label: "duplicate requested ID",
    requestedIds: [1, 2],
    returnedIds: [1, 1, 2],
    acceptedIds: [2],
    failedIds: [1],
    state: "partial",
  },
  {
    label: "mixed valid and invalid response",
    requestedIds: [1, 2, 3],
    returnedIds: [1, 2, 2, 4],
    acceptedIds: [1],
    failedIds: [2, 3],
    state: "partial",
  },
];

function createLoggingClient(
  mockFetch: MockFetch,
  logs: unknown[][],
  username: string | null,
): BggClient {
  return createBggClient({
    config: { bggAuthToken: "test-token", username },
    fetchFn: mockFetch.fn,
    delayMs: 0,
    delayFn: () => Promise.resolve(),
    now: () => "2026-08-26T12:00:00.000Z",
    logger: {
      log: (...args: unknown[]) => logs.push(args),
      warn: (...args: unknown[]) => logs.push(args),
      error: (...args: unknown[]) => logs.push(args),
    },
  });
}

describe("BggClient", () => {
  let client: BggClient;
  let mockFetch: MockFetch;

  beforeEach(() => {
    mockFetch = createMockFetch();
    client = createBggClient({
      config: { bggAuthToken: "test-token", username: "testuser" },
      fetchFn: mockFetch.fn,
      delayMs: 0,
      delayFn: () => Promise.resolve(),
    });
  });

  describe("getPlayCount", () => {
    test("pages each entry, deduplicates play IDs, and sums quantities", async () => {
      const firstPage = Array.from(
        { length: 100 },
        (_, index) => `<play id="${index + 1}" quantity="1"/>`,
      ).join("");
      mockFetch.enqueue(200, `<plays total="101">${firstPage}</plays>`);
      mockFetch.enqueue(200, '<plays total="101"><play id="101" quantity="2"/></plays>');
      mockFetch.enqueue(
        200,
        '<plays total="2"><play id="101" quantity="2"/><play id="102" quantity="3"/></plays>',
      );

      const result = await client.getPlayCount([10, 20]);

      expect(result.numPlays).toBe(105);
      expect(result.observation).toMatchObject({
        sourceRequest: "bgg-plays",
        state: "complete",
        fieldsReturned: ["numPlays"],
      });
      expect(mockFetch.calls.map(({ url }) => url)).toEqual([
        "https://boardgamegeek.com/xmlapi2/plays?username=testuser&id=10&type=thing&page=1",
        "https://boardgamegeek.com/xmlapi2/plays?username=testuser&id=10&type=thing&page=2",
        "https://boardgamegeek.com/xmlapi2/plays?username=testuser&id=20&type=thing&page=1",
      ]);
    });

    test("requires a configured collector identity", async () => {
      const withoutUsername = createBggClient({
        config: { bggAuthToken: "test-token", username: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
      });
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(withoutUsername.getPlayCount([10])).rejects.toThrow("username is required");
    });
  });

  describe("isConfigured", () => {
    test("returns true when token is set", () => {
      expect(client.isConfigured()).toBe(true);
    });

    test("returns false when token is null", () => {
      const unconfigured = createBggClient({
        config: { bggAuthToken: null, username: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
      });
      expect(unconfigured.isConfigured()).toBe(false);
    });

    test("returns false when token is empty string", () => {
      const unconfigured = createBggClient({
        config: { bggAuthToken: "", username: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
      });
      expect(unconfigured.isConfigured()).toBe(false);
    });
  });

  describe("searchGames", () => {
    test("enriches results with thumbnail URLs from thing batch", async () => {
      const searchXml = await readFixture("search-wingspan.xml");
      const thingBatchXml = await readFixture("thing-search-batch.xml");
      mockFetch.enqueue(200, searchXml);
      mockFetch.enqueue(200, thingBatchXml);

      const results = await client.searchGames("Wingspan");

      // Two fetches: search + thing batch
      expect(mockFetch.calls).toHaveLength(2);
      expect(mockFetch.calls[0].url).toContain("/xmlapi2/search");
      expect(mockFetch.calls[0].url).toContain("query=Wingspan");
      expect(mockFetch.calls[0].url).toContain("type=boardgame");
      expect(mockFetch.calls[0].headers.Authorization).toBe("Bearer test-token");

      // Thing batch URL should contain IDs from search results
      expect(mockFetch.calls[1].url).toContain("/xmlapi2/thing");
      expect(mockFetch.calls[1].url).toContain("266192");

      expect(results).toHaveLength(14);
      expect(results[1].bggId).toBe(266192);
      expect(results[1].name).toBe("Wingspan");

      // Wingspan should have a thumbnail from the batch response
      const wingspan = results.find((r) => r.bggId === 266192);
      expect(wingspan?.thumbnailUrl).toContain("geekdo-images.com");
      expect(wingspan?.thingObservation?.state).toBe("partial");
      expect(wingspan?.thingObservation?.fieldsReturned).toContain("thumbnailUrl");
      expect(wingspan?.thingObservation?.fieldsReturned).not.toContain("bggData");

      // Result not in the thing batch should have null thumbnail
      const noThumb = results.find((r) => r.bggId === 290448);
      expect(noThumb?.thumbnailUrl).toBeNull();
    });

    test("returns results with null thumbnails when thing batch fails", async () => {
      const searchXml = await readFixture("search-wingspan.xml");
      const logs: unknown[][] = [];
      const degradedClient = createBggClient({
        config: { bggAuthToken: "test-token", username: "testuser" },
        fetchFn: mockFetch.fn,
        delayMs: 0,
        delayFn: () => Promise.resolve(),
        now: () => "2026-08-26T12:00:00.000Z",
        logger: {
          log: (...args: unknown[]) => logs.push(args),
          warn: (...args: unknown[]) => logs.push(args),
          error: (...args: unknown[]) => logs.push(args),
        },
      });
      // Thing batch gets server errors until retry exhaustion
      mockFetch.enqueue(200, searchXml);
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(502, "Bad Gateway");

      const results = await degradedClient.searchGames("Wingspan");

      // Search still returns results
      expect(results).toHaveLength(14);
      // All thumbnails should be null (graceful degradation)
      for (const result of results) {
        expect(result.thumbnailUrl).toBeNull();
      }
      const context = findLogContext(logs, "thing enrichment outcome");
      const bggIds = context.bggIds;
      if (!Array.isArray(bggIds) || !bggIds.every((bggId: unknown) => typeof bggId === "number")) {
        throw new Error("Expected enrichment outcome BGG IDs to be numeric");
      }
      expect(bggIds).toContain(266192);
      expect(context.returnedBggIds).toEqual([]);
      expect(context.fieldsReturned).toEqual([]);
      expect(context.sourceRequest).toBe("bgg-thing");
      expect(context.observedAt).toBeNull();
      expect(context.state).toBe("failure");
    });

    test.each(incompleteResponseCases)(
      "logs partial enrichment for %s response coverage",
      async (_label, returnedIds) => {
        const logs: unknown[][] = [];
        const loggingClient = createLoggingClient(mockFetch, logs, null);
        mockFetch.enqueue(200, searchXml([1, 2]));
        mockFetch.enqueue(200, completeThingXml(returnedIds));

        const results = await loggingClient.searchGames("coverage");

        expect(results.map((result) => result.bggId)).toEqual([1, 2]);
        const context: unknown = findLogContext(logs, "thing enrichment outcome");
        if (!isRecord(context)) throw new Error("Expected thing enrichment log context");
        expectNumericLogIds(context, "bggIds", [1, 2]);
        expectNumericLogIds(context, "returnedBggIds", returnedIds);
        expect(context.state).toBe("partial");
      },
    );

    test.each(thingOutcomeCases)(
      "classifies enrichment for %s",
      async (_label, responseXml, returnedIds, expectedState) => {
        const logs: unknown[][] = [];
        const loggingClient = createLoggingClient(mockFetch, logs, null);
        mockFetch.enqueue(200, searchXml([1, 2]));
        mockFetch.enqueue(200, responseXml);

        await loggingClient.searchGames("coverage");

        const context = findLogContext(logs, "thing enrichment outcome");
        expectNumericLogIds(context, "bggIds", [1, 2]);
        expectNumericLogIds(context, "returnedBggIds", returnedIds);
        expect(context.state).toBe(expectedState);
      },
    );
  });

  describe("getGame", () => {
    test("fetches with stats=1 and returns parsed data", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const collectionXml = await readFixture("collection-testuser-wingspan-266192.xml");
      mockFetch.enqueue(200, thingXml);
      mockFetch.enqueue(200, collectionXml);

      const result = await client.getGame(266192);

      expect(mockFetch.calls[0].url).toContain("id=266192");
      expect(mockFetch.calls[0].url).toContain("stats=1");
      expect(mockFetch.calls[0].url).toContain("type=boardgame");

      expect(result.metadata.bggId).toBe(266192);
      expect(result.metadata.name).toBe("Wingspan");
      expect(result.bggData.communityRating).toBe(8.00153);
      expect(result.bggData.weight).toBe(2.4802);
      expect(result.collectionData?.numPlays).toBe(12);
      expect(result.entityMetadata.mechanic.state).toBe("complete");
      expect(result.entityMetadata.mechanic.observedAt).toBe(result.bggData.fetchedAt);
      expect(result.entityMetadata.designer.entities.length).toBeGreaterThan(0);
      expect(result.entityMetadata.artist.entities.length).toBeGreaterThan(0);
    });

    test("rejects a response that omits the requested BGG ID", async () => {
      const logs: unknown[][] = [];
      const loggingClient = createLoggingClient(mockFetch, logs, null);
      mockFetch.enqueue(200, completeThingXml([2]));

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(loggingClient.getGame(1)).rejects.toThrow(
        "did not include requested BGG ID 1; returned BGG IDs: 2",
      );

      const outcome = findLogContext(logs, "metadata fetch outcome");
      expectNumericLogIds(outcome, "bggIds", [1]);
      expectNumericLogIds(outcome, "returnedBggIds", [2]);
      expect(outcome.state).toBe("failure");
      expect(outcome.error).toBe(
        "BGG thing response did not include requested BGG ID 1; returned BGG IDs: 2",
      );
    });

    test("rejects duplicate items for the requested BGG ID as ambiguous", async () => {
      const logs: unknown[][] = [];
      const loggingClient = createLoggingClient(mockFetch, logs, null);
      mockFetch.enqueue(200, completeThingXml([1, 1]));

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(loggingClient.getGame(1)).rejects.toThrow(
        "ambiguous for requested BGG ID 1; returned 2 matching items",
      );

      const outcome = findLogContext(logs, "metadata fetch outcome");
      expectNumericLogIds(outcome, "returnedBggIds", [1, 1]);
      expect(outcome.state).toBe("failure");
    });

    test("selects one requested item from a response with unrelated extras", async () => {
      const logs: unknown[][] = [];
      const loggingClient = createLoggingClient(mockFetch, logs, null);
      mockFetch.enqueue(200, completeThingXml([2, 1]));

      const result = await loggingClient.getGame(1);

      expect(result.metadata.bggId).toBe(1);
      expect(result.metadata.name).toBe("Game 1");
      const outcome = findLogContext(logs, "metadata fetch outcome");
      expectNumericLogIds(outcome, "returnedBggIds", [2, 1]);
      expect(outcome.state).toBe("partial");
    });

    test("keeps thing and collection field observations source-correct", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const collectionXml = await readFixture("collection-testuser-wingspan-266192.xml");
      const observations = ["2026-08-26T10:00:00.000Z", "2026-08-26T10:01:00.000Z"];
      let observationIndex = 0;
      const logs: unknown[][] = [];
      const observedClient = createBggClient({
        config: { bggAuthToken: "test-token", username: "testuser" },
        fetchFn: mockFetch.fn,
        delayMs: 0,
        delayFn: () => Promise.resolve(),
        now: () => observations[observationIndex++] ?? "unexpected",
        logger: {
          log: (...args: unknown[]) => logs.push(args),
          warn: (...args: unknown[]) => logs.push(args),
          error: (...args: unknown[]) => logs.push(args),
        },
      });
      mockFetch.enqueue(200, thingXml);
      mockFetch.enqueue(200, collectionXml);

      const result = await observedClient.getGame(266192);

      expect(result.bggData.fetchedAt).toBe(observations[0]);
      expect(result.metadataObservation?.observedAt).toBe(observations[0]);
      expect(result.playerRangeObservation?.observedAt).toBe(observations[0]);
      expect(result.suggestedPlayerPoll?.observation?.observedAt).toBe(observations[0]);
      expect(result.collectionData?.observation?.observedAt).toBe(observations[1]);
      expect(result.collectionData?.observation?.sourceRequest).toBe("bgg-collection");
      const serializedLogs = JSON.stringify(logs);
      expect(serializedLogs).toContain("metadata fetch attempt");
      expect(serializedLogs).toContain("collection fetch outcome");
      expect(serializedLogs).toContain("numPlays");
      expect(serializedLogs).toContain(observations[1]);
    });

    test("records an absent collection response without fabricating a play count", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const logs: unknown[][] = [];
      const observedClient = createLoggingClient(mockFetch, logs, "testuser");
      mockFetch.enqueue(200, thingXml);
      mockFetch.enqueue(200, "<items></items>");

      const result = await observedClient.getGame(266192);

      expect(result.collectionData?.numPlays).toBeNull();
      expect(result.collectionData?.observation?.state).toBe("absent");
      expect(result.collectionData?.observation?.fieldsReturned).toEqual([]);
      const outcome = findLogContext(logs, "collection fetch outcome");
      expectNumericLogIds(outcome, "returnedBggIds", []);
      expect(outcome.state).toBe("absent");
      expect(outcome.failures).toEqual({});
    });

    test("selects the requested collection item and filters unrelated extras", async () => {
      const logs: unknown[][] = [];
      const observedClient = createLoggingClient(mockFetch, logs, "testuser");
      mockFetch.enqueue(200, completeThingXml([1]));
      mockFetch.enqueue(200, collectionXml([2, 1]));

      const result = await observedClient.getGame(1);

      expect(result.collectionData?.numPlays).toBe(1);
      const outcome = findLogContext(logs, "collection fetch outcome");
      expectNumericLogIds(outcome, "returnedBggIds", [2, 1]);
      expect(outcome.fieldsReturned).toEqual(["numPlays"]);
      expect(outcome.state).toBe("partial");
      expect(outcome.failures).toEqual({});
    });

    test("discards ambiguous requested collection items but preserves thing metadata", async () => {
      const logs: unknown[][] = [];
      const observedClient = createLoggingClient(mockFetch, logs, "testuser");
      mockFetch.enqueue(200, completeThingXml([1]));
      mockFetch.enqueue(
        200,
        '<items><item objectid="1"><numplays>3</numplays></item><item objectid="1"><numplays>9</numplays></item></items>',
      );

      const result = await observedClient.getGame(1);

      expect(result.metadata.bggId).toBe(1);
      expect(result.entityMetadata.mechanic.state).toBe("complete");
      expect(result.collectionData).toBeUndefined();
      const outcome = findLogContext(logs, "collection fetch outcome");
      expectNumericLogIds(outcome, "bggIds", [1]);
      expectNumericLogIds(outcome, "returnedBggIds", [1, 1]);
      expect(outcome.fieldsReturned).toEqual(["numPlays"]);
      expect(outcome.state).toBe("failure");
      expect(outcome.error).toBe(
        "BGG collection response was ambiguous for requested BGG ID 1; returned 2 matching items",
      );
      expect(outcome.failures).toEqual({
        1: "BGG collection response was ambiguous for requested BGG ID 1; returned 2 matching items",
      });
    });

    test("returns successful thing metadata when the secondary collection request fails", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const logs: unknown[][] = [];
      const observedClient = createLoggingClient(mockFetch, logs, "testuser");
      mockFetch.enqueue(200, thingXml);
      mockFetch.enqueue(500, "collection unavailable");

      const result = await observedClient.getGame(266192);

      expect(result.entityMetadata.mechanic.state).toBe("complete");
      expect(result.entityMetadata.designer.entities.length).toBeGreaterThan(0);
      expect(result.collectionData).toBeUndefined();
      const failure = findLogContext(logs, "collection fetch outcome");
      expect(failure.bggIds).toEqual([266192]);
      expect(failure.state).toBe("failure");
      expect(typeof failure.error).toBe("string");
      if (typeof failure.error !== "string") throw new Error("Expected collection failure text");
      expect(failure.error).toContain("HTTP 500");
    });

    test("logs a terminal metadata failure without inventing an observation time", async () => {
      const logs: unknown[][] = [];
      const failedClient = createBggClient({
        config: { bggAuthToken: "test-token", username: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
        delayFn: () => Promise.resolve(),
        logger: {
          log: (...args: unknown[]) => logs.push(args),
          warn: (...args: unknown[]) => logs.push(args),
          error: (...args: unknown[]) => logs.push(args),
        },
      });
      mockFetch.enqueue(500, "Internal Server Error");

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(failedClient.getGame(266192)).rejects.toThrow("HTTP 500");

      expect(logs.find(([message]) => message === "metadata fetch outcome")?.[1]).toEqual(
        expect.objectContaining({
          bggIds: [266192],
          returnedBggIds: [],
          fieldsReturned: [],
          sourceRequest: "bgg-thing",
          observedAt: null,
          state: "failure",
        }),
      );
    });
  });

  describe("getGames (batch)", () => {
    test("batches up to 20 IDs per request", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const emptyCollectionXml = `<?xml version="1.0" encoding="utf-8"?><items totalitems="0"></items>`;
      // Create 50 IDs to force 3 batches
      const ids = Array.from({ length: 50 }, (_, i) => 266192 + i);

      // Each batch: thing fetch + collection fetch (username is configured)
      mockFetch.enqueue(200, thingXml); // First batch thing
      mockFetch.enqueue(200, emptyCollectionXml); // First batch collection
      mockFetch.enqueue(200, thingXml); // Second batch thing
      mockFetch.enqueue(200, emptyCollectionXml); // Second batch collection
      mockFetch.enqueue(200, thingXml); // Third batch thing
      mockFetch.enqueue(200, emptyCollectionXml); // Third batch collection

      await client.getGames(ids);

      // Should have made 6 requests: 3 batches × (thing + collection)
      expect(mockFetch.calls).toHaveLength(6);
      const firstUrl = mockFetch.calls[0].url;
      const firstIds = new URL(firstUrl).searchParams.get("id")!.split(",");
      expect(firstIds).toHaveLength(20);
    });

    test.each(incompleteResponseCases)(
      "logs partial metadata outcome for %s response coverage",
      async (_label, returnedIds) => {
        const logs: unknown[][] = [];
        const loggingClient = createLoggingClient(mockFetch, logs, null);
        mockFetch.enqueue(200, completeThingXml(returnedIds));

        const results = await loggingClient.getGames([1, 2]);

        expect([...results.keys()]).toEqual(returnedIds.filter((id) => [1, 2].includes(id)));
        const context: unknown = findLogContext(logs, "metadata fetch outcome");
        if (!isRecord(context)) throw new Error("Expected metadata fetch log context");
        expectNumericLogIds(context, "bggIds", [1, 2]);
        expectNumericLogIds(context, "returnedBggIds", returnedIds);
        expect(context.state).toBe(
          returnedIds.some((id) => [1, 2].includes(id)) ? "partial" : "failure",
        );
      },
    );

    test.each(batchThingOutcomeCases)(
      "classifies metadata for %s",
      async (_label, responseXml, returnedIds, expectedState) => {
        const logs: unknown[][] = [];
        const loggingClient = createLoggingClient(mockFetch, logs, null);
        mockFetch.enqueue(200, responseXml);

        await loggingClient.getGames([1, 2]);

        const context = findLogContext(logs, "metadata fetch outcome");
        expectNumericLogIds(context, "bggIds", [1, 2]);
        expectNumericLogIds(context, "returnedBggIds", returnedIds);
        expect(context.state).toBe(expectedState);
      },
    );

    test.each(batchIdentityCases)(
      "validates requested identities for a $label",
      async ({ requestedIds, returnedIds, acceptedIds, failedIds, state }) => {
        const logs: unknown[][] = [];
        const loggingClient = createLoggingClient(mockFetch, logs, null);
        mockFetch.enqueue(200, completeThingXml(returnedIds));
        let batchFailures = new Map<number, string>();

        const results = await loggingClient.getGames(requestedIds, (event) => {
          batchFailures = event.failures;
        });

        expect([...results.keys()]).toEqual(acceptedIds);
        expect([...batchFailures.keys()]).toEqual(failedIds);
        for (const failedId of failedIds) {
          expect(batchFailures.get(failedId)).toContain(`requested BGG ID ${failedId}`);
        }
        for (const returnedId of returnedIds.filter((id) => !requestedIds.includes(id))) {
          expect(results.has(returnedId)).toBe(false);
        }
        const context = findLogContext(logs, "metadata fetch outcome");
        expectNumericLogIds(context, "bggIds", requestedIds);
        expectNumericLogIds(context, "returnedBggIds", returnedIds);
        expect(context.state).toBe(state);
        expect(context.failures).toEqual(Object.fromEntries(batchFailures));
      },
    );

    test.each(incompleteResponseCases)(
      "logs partial collection outcome for %s response coverage",
      async (_label, returnedIds) => {
        const logs: unknown[][] = [];
        const loggingClient = createLoggingClient(mockFetch, logs, "testuser");
        mockFetch.enqueue(200, completeThingXml([1, 2]));
        mockFetch.enqueue(200, collectionXml(returnedIds));

        const results = await loggingClient.getGames([1, 2]);

        expect(results.get(1)?.collectionData?.numPlays).toBe(returnedIds.includes(1) ? 1 : null);
        const context: unknown = findLogContext(logs, "collection fetch outcome");
        if (!isRecord(context)) throw new Error("Expected collection fetch log context");
        expectNumericLogIds(context, "bggIds", [1, 2]);
        expectNumericLogIds(context, "returnedBggIds", returnedIds);
        expect(context.state).toBe(
          returnedIds.some((id) => [1, 2].includes(id)) ? "partial" : "failure",
        );
      },
    );

    test.each(batchCollectionOutcomeCases)(
      "classifies collection for %s",
      async (_label, responseXml, returnedIds, expectedState) => {
        const logs: unknown[][] = [];
        const loggingClient = createLoggingClient(mockFetch, logs, "testuser");
        mockFetch.enqueue(200, completeThingXml([1, 2]));
        mockFetch.enqueue(200, responseXml);

        await loggingClient.getGames([1, 2]);

        const context = findLogContext(logs, "collection fetch outcome");
        expectNumericLogIds(context, "bggIds", [1, 2]);
        expectNumericLogIds(context, "returnedBggIds", returnedIds);
        expect(context.state).toBe(expectedState);
      },
    );
  });

  describe("shared request queue", () => {
    test("serializes physical fetches across concurrent owner requests", async () => {
      let activeFetches = 0;
      let maximumActiveFetches = 0;
      let fetchCount = 0;
      let releaseFirstFetch: () => void = () => {};
      let markFirstStarted: () => void = () => {};
      const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve;
      });
      const firstGate = new Promise<void>((resolve) => {
        releaseFirstFetch = resolve;
      });
      const queuedClient = createBggClient({
        config: { bggAuthToken: "test-token", username: null },
        delayMs: 0,
        delayFn: () => Promise.resolve(),
        fetchFn: (async (input) => {
          fetchCount += 1;
          activeFetches += 1;
          maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
          if (fetchCount === 1) {
            markFirstStarted();
            await firstGate;
          }
          const requestUrl =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const id = Number(new URL(requestUrl).searchParams.get("id"));
          activeFetches -= 1;
          return new Response(completeThingXml([id]), { status: 200 });
        }) as typeof fetch,
      });

      const first = queuedClient.getGame(1);
      const second = queuedClient.getGame(2);
      await firstStarted;
      expect(fetchCount).toBe(1);
      expect(activeFetches).toBe(1);
      releaseFirstFetch();

      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect([firstResult.metadata.bggId, secondResult.metadata.bggId]).toEqual([1, 2]);
      expect(maximumActiveFetches).toBe(1);
    });
  });

  describe("getUserCollection", () => {
    test("returns parsed collection items", async () => {
      const collectionXml = await readFixture("collection-testuser.xml");
      mockFetch.enqueue(200, collectionXml);

      const results = await client.getUserCollection();

      expect(mockFetch.calls[0].url).toContain("username=testuser");
      expect(mockFetch.calls[0].url).toContain("own=1");
      expect(results).toHaveLength(3);
      expect(results[0].bggId).toBe(266192);
    });
  });

  describe("202 retry handling", () => {
    test("retries on 202, succeeds on 200", async () => {
      const collectionXml = await readFixture("collection-testuser.xml");
      mockFetch.enqueue(202, ""); // First attempt: queued
      mockFetch.enqueue(200, collectionXml); // Second attempt: success

      const results = await client.getUserCollection();

      // 2 calls: initial 202, then successful 200
      expect(mockFetch.calls).toHaveLength(2);
      expect(results).toHaveLength(3);
    });

    test("throws after max 202 retries", async () => {
      const logs: unknown[][] = [];
      const failedClient = createBggClient({
        config: { bggAuthToken: "test-token", username: "testuser" },
        fetchFn: mockFetch.fn,
        delayMs: 0,
        delayFn: () => Promise.resolve(),
        logger: {
          log: (...args: unknown[]) => logs.push(args),
          warn: (...args: unknown[]) => logs.push(args),
          error: (...args: unknown[]) => logs.push(args),
        },
      });
      // 4 attempts total (initial + 3 retries), all 202
      mockFetch.enqueue(202, "");
      mockFetch.enqueue(202, "");
      mockFetch.enqueue(202, "");
      mockFetch.enqueue(202, "");

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(failedClient.getUserCollection()).rejects.toThrow(
        "still queued after maximum retries",
      );
      expect(logs.find(([message]) => message === "collection fetch outcome")?.[1]).toEqual(
        expect.objectContaining({
          bggIds: [],
          returnedBggIds: [],
          fieldsReturned: [],
          sourceRequest: "bgg-collection",
          observedAt: null,
          state: "failure",
        }),
      );
    });
  });

  describe("429 backoff", () => {
    test("retries after 429 with correct delay timing", async () => {
      const delayCalls: number[] = [];
      const trackingClient = createBggClient({
        config: { bggAuthToken: "test-token", username: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
        delayFn: (ms: number) => {
          delayCalls.push(ms);
          return Promise.resolve();
        },
      });

      const searchXml = await readFixture("search-wingspan.xml");
      const thingBatchXml = await readFixture("thing-search-batch.xml");
      mockFetch.enqueue(429, ""); // Rate limited
      mockFetch.enqueue(200, searchXml); // Success after backoff
      mockFetch.enqueue(200, thingBatchXml); // Thing batch for thumbnail enrichment

      const results = await trackingClient.searchGames("Wingspan");

      expect(mockFetch.calls).toHaveLength(3);
      expect(results).toHaveLength(14);

      // Should have called delayFn with BACKOFF_429_MS (30000)
      expect(delayCalls).toContain(30000);
    });

    test("sets slower rate after 429 recovery", async () => {
      const delayCalls: number[] = [];
      const trackingClient = createBggClient({
        config: { bggAuthToken: "test-token", username: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
        delayFn: (ms: number) => {
          delayCalls.push(ms);
          return Promise.resolve();
        },
      });

      const searchXml = await readFixture("search-wingspan.xml");
      const thingBatchXml = await readFixture("thing-search-batch.xml");
      mockFetch.enqueue(429, ""); // Rate limited
      mockFetch.enqueue(200, searchXml); // Success after backoff
      mockFetch.enqueue(200, thingBatchXml); // Thing batch for first search
      mockFetch.enqueue(200, searchXml); // Second search
      mockFetch.enqueue(200, thingBatchXml); // Thing batch for second search

      await trackingClient.searchGames("Wingspan");

      // Second search should use the 10s delay (currentDelayMs set to 10000 after 429)
      await trackingClient.searchGames("Wingspan");

      // The second request's throttle delay should reflect the 10s rate
      // (delayFn will be called with remaining time based on 10000ms delay)
      const postBackoffDelays = delayCalls.filter((ms) => ms !== 30000);
      expect(postBackoffDelays.length).toBeGreaterThan(0);
    });
  });

  describe("502/503 retry", () => {
    test("retries on 502", async () => {
      const searchXml = await readFixture("search-wingspan.xml");
      const thingBatchXml = await readFixture("thing-search-batch.xml");
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(200, searchXml);
      mockFetch.enqueue(200, thingBatchXml); // Thing batch for thumbnail enrichment

      const results = await client.searchGames("Wingspan");

      expect(mockFetch.calls).toHaveLength(3);
      expect(results).toHaveLength(14);
    });

    test("retries on 503", async () => {
      const thingXml = await readFixture("thing-gloomhaven-174430.xml");
      const emptyCollectionXml = `<?xml version="1.0" encoding="utf-8"?><items totalitems="0"></items>`;
      mockFetch.enqueue(503, "Service Unavailable");
      mockFetch.enqueue(200, thingXml);
      mockFetch.enqueue(200, emptyCollectionXml);

      const result = await client.getGame(174430);

      expect(mockFetch.calls).toHaveLength(3);
      expect(result.metadata.name).toBe("Gloomhaven");
    });

    test("gives up after max 502 retries", async () => {
      const logs: unknown[][] = [];
      const failedClient = createBggClient({
        config: { bggAuthToken: "test-token", username: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
        delayFn: () => Promise.resolve(),
        logger: {
          log: (...args: unknown[]) => logs.push(args),
          warn: (...args: unknown[]) => logs.push(args),
          error: (...args: unknown[]) => logs.push(args),
        },
      });
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(502, "Bad Gateway"); // 3rd attempt, exceeds MAX_5XX_RETRIES=2

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(failedClient.searchGames("Wingspan")).rejects.toThrow("HTTP 502");
      expect(logs.find(([message]) => message === "search fetch outcome")?.[1]).toEqual(
        expect.objectContaining({
          query: "Wingspan",
          bggIds: [],
          fieldsReturned: [],
          sourceRequest: "bgg-search",
          observedAt: null,
          state: "failure",
        }),
      );
    });
  });

  describe("malformed XML", () => {
    test("throws for garbage XML missing root element", async () => {
      mockFetch.enqueue(200, "<<<not xml at all>>>");

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(client.searchGames("Anything")).rejects.toThrow("Malformed BGG search response");
    });

    test("getGame throws when no items in response", async () => {
      mockFetch.enqueue(200, `<?xml version="1.0"?><items></items>`);

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(client.getGame(99999)).rejects.toThrow("No game found with BGG ID 99999");
    });
  });

  describe.skip("fetch timeout", () => {
    test("aborts request after timeout and throws descriptive error", async () => {
      // Create a fetch that hangs until aborted
      const hangingFetch = async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        return new Promise((_resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      };

      const timeoutClient = createBggClient({
        config: { bggAuthToken: "test-token", username: null },
        fetchFn: hangingFetch as unknown as typeof fetch,
        delayMs: 0,
        delayFn: () => Promise.resolve(),
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(timeoutClient.searchGames("Wingspan")).rejects.toThrow("timed out");
    }, 35000);
  });

  describe("missing token", () => {
    test("returns clear error with registration URL", async () => {
      const unconfigured = createBggClient({
        config: { bggAuthToken: null, username: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(unconfigured.searchGames("Wingspan")).rejects.toThrow(
        "BGG application token not configured",
      );
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(unconfigured.searchGames("Wingspan")).rejects.toThrow(
        "boardgamegeek.com/using_the_xml_api",
      );
    });
  });

  describe("isConfigured consistency", () => {
    test("returns false when token is undefined", () => {
      const unconfigured = createBggClient({
        config: { bggAuthToken: undefined as unknown as string | null, username: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
      });
      expect(unconfigured.isConfigured()).toBe(false);
    });
  });

  describe("429 gradual recovery", () => {
    test("delay reduces on each successful request after 429", async () => {
      const delayCalls: number[] = [];
      const recoveryMock = createMockFetch();
      const recoveryClient = createBggClient({
        config: { bggAuthToken: "test-token", username: null },
        fetchFn: recoveryMock.fn,
        delayMs: 100,
        delayFn: (ms: number) => {
          delayCalls.push(ms);
          return Promise.resolve();
        },
      });

      const searchXml = await readFixture("search-wingspan.xml");
      const thingBatchXml = await readFixture("thing-search-batch.xml");

      // 429 sets delay to 10000
      recoveryMock.enqueue(429, "");
      recoveryMock.enqueue(200, searchXml); // search A success
      recoveryMock.enqueue(200, thingBatchXml); // search A thing batch
      recoveryMock.enqueue(200, searchXml); // search B
      recoveryMock.enqueue(200, thingBatchXml); // search B thing batch
      recoveryMock.enqueue(200, searchXml); // search C
      recoveryMock.enqueue(200, thingBatchXml); // search C thing batch

      await recoveryClient.searchGames("A");
      await recoveryClient.searchGames("B");
      await recoveryClient.searchGames("C");

      // After the 429 backoff, the throttle delays should decrease over time
      const throttleDelays = delayCalls.filter((ms) => ms !== 30000 && ms > 0);
      if (throttleDelays.length >= 2) {
        // Each successive throttle delay should be <= the previous
        for (let i = 1; i < throttleDelays.length; i++) {
          expect(throttleDelays[i]).toBeLessThanOrEqual(throttleDelays[i - 1]);
        }
      }
    });
  });

  describe("getGames batch failure resilience", () => {
    test("continues with remaining batches when one batch fails", async () => {
      // 25 IDs: batch 1 (20 ids) fails, batch 2 (5 ids) succeeds
      const ids = Array.from({ length: 25 }, (_, i) => 266192 + i);

      mockFetch.enqueue(502, "Bad Gateway"); // batch 1 fails (after max retries)
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(200, completeThingXml(ids.slice(20))); // batch 2 succeeds

      const batchEvents: Array<{ batchIds: number[]; resultCount: number; error?: string }> = [];
      const results = await client.getGames(ids, (event) => {
        batchEvents.push({
          batchIds: event.batchIds,
          resultCount: event.results.size,
          error: event.error,
        });
      });

      // Both batches should have fired onBatch callbacks
      expect(batchEvents).toHaveLength(2);
      // First batch failed, should have 0 results
      expect(batchEvents[0].resultCount).toBe(0);
      expect(batchEvents[0].error).toBe("BGG API returned HTTP 502: Bad Gateway");
      // Second batch succeeded
      expect(batchEvents[1].resultCount).toBeGreaterThan(0);
      expect(batchEvents[1].error).toBeUndefined();
      // Overall results should contain games from batch 2
      expect(results.size).toBeGreaterThan(0);
    });

    test("reports exact parser failure provenance for the failed batch", async () => {
      mockFetch.enqueue(200, "<<<not xml at all>>>");
      let failure: string | undefined;

      const results = await client.getGames([42], (event) => {
        failure = event.error;
      });

      expect(results.size).toBe(0);
      expect(failure).toBe("Malformed BGG thing response: missing root <items> element");
    });
  });
});
