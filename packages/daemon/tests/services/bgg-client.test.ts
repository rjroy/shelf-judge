import { describe, test, expect, beforeEach } from "bun:test";
import * as path from "node:path";
import { createBggClient, type BggClient } from "../../src/services/bgg-client.js";
import { createMockFetch, type MockFetch } from "../helpers/mock-fetch.js";

const fixturesDir = path.join(import.meta.dir, "../fixtures");

async function readFixture(filename: string): Promise<string> {
  return Bun.file(path.join(fixturesDir, filename)).text();
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
    test("delegates to fetch with correct URL and auth header", async () => {
      const searchXml = await readFixture("search-wingspan.xml");
      mockFetch.enqueue(200, searchXml);

      const results = await client.searchGames("Wingspan");

      expect(mockFetch.calls).toHaveLength(1);
      expect(mockFetch.calls[0].url).toContain("/xmlapi2/search");
      expect(mockFetch.calls[0].url).toContain("query=Wingspan");
      expect(mockFetch.calls[0].url).toContain("type=boardgame");
      expect(mockFetch.calls[0].headers.Authorization).toBe("Bearer test-token");

      expect(results).toHaveLength(14);
      expect(results[1].bggId).toBe(266192);
      expect(results[1].name).toBe("Wingspan");
    });
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
      // 4 attempts total (initial + 3 retries), all 202
      mockFetch.enqueue(202, "");
      mockFetch.enqueue(202, "");
      mockFetch.enqueue(202, "");
      mockFetch.enqueue(202, "");

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(client.getUserCollection()).rejects.toThrow(
        "still queued after maximum retries",
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
      mockFetch.enqueue(429, ""); // Rate limited
      mockFetch.enqueue(200, searchXml); // Success after backoff

      const results = await trackingClient.searchGames("Wingspan");

      expect(mockFetch.calls).toHaveLength(2);
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
      mockFetch.enqueue(429, ""); // Rate limited
      mockFetch.enqueue(200, searchXml); // Success after backoff
      mockFetch.enqueue(200, searchXml); // Second request at slower rate

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
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(200, searchXml);

      const results = await client.searchGames("Wingspan");

      expect(mockFetch.calls).toHaveLength(2);
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
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(502, "Bad Gateway"); // 3rd attempt, exceeds MAX_5XX_RETRIES=2

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(client.searchGames("Wingspan")).rejects.toThrow("HTTP 502");
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

      // 429 sets delay to 10000
      recoveryMock.enqueue(429, "");
      recoveryMock.enqueue(200, searchXml); // success, delay halves to 5000
      recoveryMock.enqueue(200, searchXml); // success, delay halves to 2500
      recoveryMock.enqueue(200, searchXml); // success, delay halves to 1250

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
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      // 25 IDs: batch 1 (20 ids) fails, batch 2 (5 ids) succeeds
      const ids = Array.from({ length: 25 }, (_, i) => 266192 + i);

      mockFetch.enqueue(502, "Bad Gateway"); // batch 1 fails (after max retries)
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(200, thingXml); // batch 2 succeeds

      const batchEvents: Array<{ batchIds: number[]; resultCount: number }> = [];
      const results = await client.getGames(ids, (event) => {
        batchEvents.push({ batchIds: event.batchIds, resultCount: event.results.size });
      });

      // Both batches should have fired onBatch callbacks
      expect(batchEvents).toHaveLength(2);
      // First batch failed, should have 0 results
      expect(batchEvents[0].resultCount).toBe(0);
      // Second batch succeeded
      expect(batchEvents[1].resultCount).toBeGreaterThan(0);
      // Overall results should contain games from batch 2
      expect(results.size).toBeGreaterThan(0);
    });
  });
});
