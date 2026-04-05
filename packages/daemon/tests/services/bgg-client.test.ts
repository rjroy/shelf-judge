import { describe, test, expect, beforeEach } from "bun:test";
import * as path from "node:path";
import { createBggClient, type BggClient } from "../../src/services/bgg-client.js";

const fixturesDir = path.join(import.meta.dir, "../fixtures");

async function readFixture(filename: string): Promise<string> {
  return Bun.file(path.join(fixturesDir, filename)).text();
}

type MockFetch = ReturnType<typeof createMockFetch>;

function createMockFetch() {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const responses: Array<{ status: number; body: string }> = [];

  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = (init?.headers as Record<string, string>) ?? {};
    calls.push({ url, headers });

    const next = responses.shift();
    if (!next) {
      throw new Error(`No mock response configured for: ${url}`);
    }

    return new Response(next.body, {
      status: next.status,
      headers: { "Content-Type": "application/xml" },
    });
  };

  return {
    fn: fn as unknown as typeof fetch,
    calls,
    responses,
    enqueue(status: number, body: string) {
      responses.push({ status, body });
    },
  };
}

describe("BggClient", () => {
  let client: BggClient;
  let mockFetch: MockFetch;

  beforeEach(() => {
    mockFetch = createMockFetch();
    client = createBggClient({
      config: { bggAuthToken: "test-token" },
      fetchFn: mockFetch.fn,
      delayMs: 0,
      delayFn: async () => {},
    });
  });

  describe("isConfigured", () => {
    test("returns true when token is set", () => {
      expect(client.isConfigured()).toBe(true);
    });

    test("returns false when token is null", () => {
      const unconfigured = createBggClient({
        config: { bggAuthToken: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
      });
      expect(unconfigured.isConfigured()).toBe(false);
    });

    test("returns false when token is empty string", () => {
      const unconfigured = createBggClient({
        config: { bggAuthToken: "" },
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

      expect(results).toHaveLength(3);
      expect(results[0].bggId).toBe(266192);
      expect(results[0].name).toBe("Wingspan");
    });
  });

  describe("getGame", () => {
    test("fetches with stats=1 and returns parsed data", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      mockFetch.enqueue(200, thingXml);

      const result = await client.getGame(266192);

      expect(mockFetch.calls[0].url).toContain("id=266192");
      expect(mockFetch.calls[0].url).toContain("stats=1");
      expect(mockFetch.calls[0].url).toContain("type=boardgame");

      expect(result.metadata.bggId).toBe(266192);
      expect(result.metadata.name).toBe("Wingspan");
      expect(result.bggData.communityRating).toBe(8.1);
      expect(result.bggData.weight).toBe(2.45);
    });
  });

  describe("getGames (batch)", () => {
    test("batches up to 250 IDs per request", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      // Create 300 IDs to force 2 batches
      const ids = Array.from({ length: 300 }, (_, i) => 266192 + i);

      mockFetch.enqueue(200, thingXml); // First batch returns Wingspan
      mockFetch.enqueue(200, thingXml); // Second batch

      const results = await client.getGames(ids);

      // Should have made 2 requests: 250 + 50
      expect(mockFetch.calls).toHaveLength(2);
      const firstUrl = mockFetch.calls[0].url;
      const firstIds = new URL(firstUrl).searchParams.get("id")!.split(",");
      expect(firstIds).toHaveLength(250);
    });
  });

  describe("getUserCollection", () => {
    test("returns parsed collection items", async () => {
      const collectionXml = await readFixture("collection-testuser.xml");
      mockFetch.enqueue(200, collectionXml);

      const results = await client.getUserCollection("testuser");

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

      const results = await client.getUserCollection("testuser");

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

      await expect(client.getUserCollection("testuser")).rejects.toThrow(
        "still queued after maximum retries",
      );
    });
  });

  describe("429 backoff", () => {
    test("retries after 429 with correct delay timing", async () => {
      const delayCalls: number[] = [];
      const trackingClient = createBggClient({
        config: { bggAuthToken: "test-token" },
        fetchFn: mockFetch.fn,
        delayMs: 0,
        delayFn: async (ms: number) => {
          delayCalls.push(ms);
        },
      });

      const searchXml = await readFixture("search-wingspan.xml");
      mockFetch.enqueue(429, ""); // Rate limited
      mockFetch.enqueue(200, searchXml); // Success after backoff

      const results = await trackingClient.searchGames("Wingspan");

      expect(mockFetch.calls).toHaveLength(2);
      expect(results).toHaveLength(3);

      // Should have called delayFn with BACKOFF_429_MS (30000)
      expect(delayCalls).toContain(30000);
    });

    test("sets slower rate after 429 recovery", async () => {
      const delayCalls: number[] = [];
      const trackingClient = createBggClient({
        config: { bggAuthToken: "test-token" },
        fetchFn: mockFetch.fn,
        delayMs: 0,
        delayFn: async (ms: number) => {
          delayCalls.push(ms);
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
      expect(results).toHaveLength(3);
    });

    test("retries on 503", async () => {
      const thingXml = await readFixture("thing-gloomhaven-174430.xml");
      mockFetch.enqueue(503, "Service Unavailable");
      mockFetch.enqueue(200, thingXml);

      const result = await client.getGame(174430);

      expect(mockFetch.calls).toHaveLength(2);
      expect(result.metadata.name).toBe("Gloomhaven");
    });

    test("gives up after max 502 retries", async () => {
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(502, "Bad Gateway");
      mockFetch.enqueue(502, "Bad Gateway"); // 3rd attempt, exceeds MAX_5XX_RETRIES=2

      await expect(client.searchGames("Wingspan")).rejects.toThrow("HTTP 502");
    });
  });

  describe("malformed XML", () => {
    test("returns empty results for garbage XML", async () => {
      mockFetch.enqueue(200, "<<<not xml at all>>>");

      // fast-xml-parser is lenient; garbage input returns empty results
      const results = await client.searchGames("Anything");
      expect(results).toHaveLength(0);
    });

    test("getGame throws when no items in response", async () => {
      mockFetch.enqueue(200, `<?xml version="1.0"?><items></items>`);

      await expect(client.getGame(99999)).rejects.toThrow("No game found with BGG ID 99999");
    });
  });

  describe("fetch timeout", () => {
    test("aborts request after timeout and throws descriptive error", async () => {
      // Create a fetch that hangs until aborted
      const hangingFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        return new Promise((_resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      };

      const timeoutClient = createBggClient({
        config: { bggAuthToken: "test-token" },
        fetchFn: hangingFetch as unknown as typeof fetch,
        delayMs: 0,
        delayFn: async () => {},
      });

      await expect(timeoutClient.searchGames("Wingspan")).rejects.toThrow("timed out");
    }, 35000);
  });

  describe("missing token", () => {
    test("returns clear error with registration URL", async () => {
      const unconfigured = createBggClient({
        config: { bggAuthToken: null },
        fetchFn: mockFetch.fn,
        delayMs: 0,
      });

      await expect(unconfigured.searchGames("Wingspan")).rejects.toThrow(
        "BGG application token not configured",
      );
      await expect(unconfigured.searchGames("Wingspan")).rejects.toThrow(
        "boardgamegeek.com/using_the_xml_api",
      );
    });
  });
});
