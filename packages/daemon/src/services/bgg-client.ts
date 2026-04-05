import type { BggGameData, AppConfig } from "@shelf-judge/shared";
import {
  parseThingResponse,
  parseThingMetadata,
  parseSearchResponse,
  parseCollectionResponse,
  type BggSearchResult,
  type BggCollectionItem,
  type ThingMetadata,
} from "./bgg-xml-parser.js";

const BGG_BASE_URL = "https://boardgamegeek.com/xmlapi2";
const BGG_REGISTER_URL = "https://boardgamegeek.com/using_the_xml_api";
const MAX_BATCH_SIZE = 250;
const DEFAULT_DELAY_MS = 5000;
const BACKOFF_429_MS = 30000;
const RETRY_5XX_MS = 30000;
const MAX_429_RETRIES = 3;
const MAX_5XX_RETRIES = 2;
const MAX_202_RETRIES = 3;
const BASE_202_DELAY_MS = 5000;

export interface BggGameResult {
  metadata: ThingMetadata;
  bggData: BggGameData;
}

export interface BggClient {
  searchGames(query: string): Promise<BggSearchResult[]>;
  getGame(bggId: number): Promise<BggGameResult>;
  getGames(bggIds: number[]): Promise<Map<number, BggGameResult>>;
  getUserCollection(username: string): Promise<BggCollectionItem[]>;
  isConfigured(): boolean;
}

export interface BggClientDeps {
  config: Pick<AppConfig, "bggAuthToken">;
  fetchFn?: typeof fetch;
  delayMs?: number;
  delayFn?: (ms: number) => Promise<void>;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createBggClient(deps: BggClientDeps): BggClient {
  const { config, delayMs = DEFAULT_DELAY_MS } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const delayFn = deps.delayFn ?? defaultDelay;

  let lastRequestTime = 0;
  let currentDelayMs = delayMs;

  function assertConfigured(): void {
    if (!config.bggAuthToken) {
      throw new Error(
        `BGG application token not configured. Register at ${BGG_REGISTER_URL} and run \`shelf-judge config set bgg-token YOUR_TOKEN\`.`,
      );
    }
  }

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.bggAuthToken}`,
    };
  }

  let rateLimitRetries = 0;

  async function throttledFetch(
    url: string,
    retryCount = 0,
  ): Promise<Response> {
    // Rate limiting: wait until enough time has passed since last request
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < currentDelayMs && lastRequestTime > 0) {
      await delayFn(currentDelayMs - elapsed);
    }
    lastRequestTime = Date.now();

    let response: Response;
    try {
      response = await fetchFn(url, { headers: authHeaders() });
    } catch (err) {
      throw new Error(
        `BGG API request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Handle 429 rate limiting with bounded retries
    if (response.status === 429) {
      rateLimitRetries++;
      if (rateLimitRetries > MAX_429_RETRIES) {
        throw new Error(
          `BGG API rate limited after ${MAX_429_RETRIES} retries. Try again later.`,
        );
      }
      await delayFn(BACKOFF_429_MS);
      currentDelayMs = 10000; // Slow recovery: 1 req/10s after backoff
      return throttledFetch(url, retryCount);
    }

    // Successful non-429 response: gradually recover rate
    if (rateLimitRetries > 0) {
      rateLimitRetries = 0;
      // Will naturally decay back to delayMs on next successful requests
      currentDelayMs = Math.max(delayMs, currentDelayMs / 2);
    }

    // Handle 502/503 server errors with retry
    if (
      (response.status === 502 || response.status === 503) &&
      retryCount < MAX_5XX_RETRIES
    ) {
      await delayFn(RETRY_5XX_MS);
      return throttledFetch(url, retryCount + 1);
    }

    if (!response.ok && response.status !== 202) {
      throw new Error(
        `BGG API returned HTTP ${response.status}: ${await response.text()}`,
      );
    }

    return response;
  }

  async function fetchWithRetry202(url: string): Promise<string> {
    for (let attempt = 0; attempt <= MAX_202_RETRIES; attempt++) {
      const response = await throttledFetch(url);

      if (response.status === 200) {
        return response.text();
      }

      if (response.status === 202) {
        if (attempt === MAX_202_RETRIES) {
          throw new Error(
            "BGG collection request still queued after maximum retries. Try again later.",
          );
        }
        // Exponential backoff: 5s, 10s, 20s
        const backoffMs = BASE_202_DELAY_MS * Math.pow(2, attempt);
        await delayFn(backoffMs);
        continue;
      }

      throw new Error(`Unexpected BGG response status: ${response.status}`);
    }

    throw new Error("BGG collection request failed after retries.");
  }

  return {
    isConfigured(): boolean {
      return config.bggAuthToken !== null && config.bggAuthToken !== "";
    },

    async searchGames(query: string): Promise<BggSearchResult[]> {
      assertConfigured();
      const url = `${BGG_BASE_URL}/search?query=${encodeURIComponent(query)}&type=boardgame`;
      const response = await throttledFetch(url);
      const xml = await response.text();

      try {
        return parseSearchResponse(xml);
      } catch (err) {
        throw new Error(
          `Failed to parse BGG search response: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async getGame(bggId: number): Promise<BggGameResult> {
      assertConfigured();
      const url = `${BGG_BASE_URL}/thing?id=${bggId}&stats=1&type=boardgame`;
      const response = await throttledFetch(url);
      const xml = await response.text();

      let bggDataList: BggGameData[];
      let metadataList: ThingMetadata[];
      try {
        bggDataList = parseThingResponse(xml);
        metadataList = parseThingMetadata(xml);
      } catch (err) {
        throw new Error(
          `Failed to parse BGG thing response: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (bggDataList.length === 0 || metadataList.length === 0) {
        throw new Error(`No game found with BGG ID ${bggId}`);
      }

      return {
        metadata: metadataList[0],
        bggData: bggDataList[0],
      };
    },

    async getGames(bggIds: number[]): Promise<Map<number, BggGameResult>> {
      assertConfigured();
      const results = new Map<number, BggGameResult>();

      // Batch in chunks of MAX_BATCH_SIZE
      for (let i = 0; i < bggIds.length; i += MAX_BATCH_SIZE) {
        const batch = bggIds.slice(i, i + MAX_BATCH_SIZE);
        const idList = batch.join(",");
        const url = `${BGG_BASE_URL}/thing?id=${idList}&stats=1&type=boardgame`;
        const response = await throttledFetch(url);
        const xml = await response.text();

        let bggDataList: BggGameData[];
        let metadataList: ThingMetadata[];
        try {
          bggDataList = parseThingResponse(xml);
          metadataList = parseThingMetadata(xml);
        } catch (err) {
          throw new Error(
            `Failed to parse BGG batch thing response: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        for (let j = 0; j < metadataList.length; j++) {
          const meta = metadataList[j];
          const data = bggDataList[j];
          if (meta && data) {
            results.set(meta.bggId, { metadata: meta, bggData: data });
          }
        }
      }

      return results;
    },

    async getUserCollection(username: string): Promise<BggCollectionItem[]> {
      assertConfigured();
      const url = `${BGG_BASE_URL}/collection?username=${encodeURIComponent(username)}&own=1&subtype=boardgame&stats=1`;
      const xml = await fetchWithRetry202(url);

      try {
        return parseCollectionResponse(xml);
      } catch (err) {
        throw new Error(
          `Failed to parse BGG collection response: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
