import {
  toErrorMessage,
  type BggGameData,
  type AppConfig,
  type BggSearchResult,
} from "@shelf-judge/shared";
import {
  parseThingItems,
  parseSearchResponse,
  parseCollectionResponse,
  type BggCollectionItem,
  type ThingMetadata,
  CollectiomItemMetadata,
} from "./bgg-xml-parser.js";
import { createLogger } from "./logger.js";

const BGG_BASE_URL = "https://boardgamegeek.com/xmlapi2";
const BGG_REGISTER_URL = "https://boardgamegeek.com/using_the_xml_api";
const MAX_BATCH_SIZE = 20;
const DEFAULT_DELAY_MS = 5000;
const BACKOFF_429_MS = 30000;
const RETRY_5XX_MS = 30000;
const MAX_429_RETRIES = 3;
const MAX_5XX_RETRIES = 2;
const MAX_202_RETRIES = 3;
const BASE_202_DELAY_MS = 5000;
const FETCH_TIMEOUT_MS = 30000;

export interface BggGameResult {
  metadata: ThingMetadata;
  bggData: BggGameData;
  collectionData?: CollectiomItemMetadata;
}

export interface BatchProgressEvent {
  batchIds: number[];
  results: Map<number, BggGameResult>;
}

export interface BggClient {
  searchGames(query: string): Promise<BggSearchResult[]>;
  getGame(bggId: number): Promise<BggGameResult>;
  getGames(
    bggIds: number[],
    onBatch?: (event: BatchProgressEvent) => Promise<void> | void,
  ): Promise<Map<number, BggGameResult>>;
  getUserCollection(): Promise<BggCollectionItem[]>;
  isConfigured(): boolean;
}

export interface BggClientDeps {
  config: Pick<AppConfig, "bggAuthToken" | "username">;
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
  const logger = createLogger("bgg");

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

  async function throttledFetch(url: string, retryCount = 0): Promise<Response> {
    // Rate limiting: timestamp-based throttle. Assumes single-threaded access.
    // Concurrent calls would read the same lastRequestTime and both proceed,
    // bypassing the delay. All current callers are sequential (await in loops).
    // Post-MVP: replace with a mutex-guarded queue if parallel callers are added.
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < currentDelayMs && lastRequestTime > 0) {
      const waitMs = currentDelayMs - elapsed;
      logger.log(`throttle: waiting ${waitMs}ms before next request`);
      await delayFn(waitMs);
    }
    lastRequestTime = Date.now();

    logger.log(`fetch: ${url}`);
    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        response = await fetchFn(url, { headers: authHeaders(), signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        logger.error(`timeout after ${FETCH_TIMEOUT_MS / 1000}s: ${url}`);
        throw new Error(`BGG API request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
      }
      logger.error(`fetch error: ${toErrorMessage(err)}`);
      throw new Error(`BGG API request failed: ${toErrorMessage(err)}`);
    }

    logger.log(`response: ${response.status} from ${url}`);

    // Handle 429 rate limiting with bounded retries
    if (response.status === 429) {
      rateLimitRetries++;
      logger.warn(`rate limited (429), retry ${rateLimitRetries}/${MAX_429_RETRIES}`);
      if (rateLimitRetries > MAX_429_RETRIES) {
        throw new Error(`BGG API rate limited after ${MAX_429_RETRIES} retries. Try again later.`);
      }
      await delayFn(BACKOFF_429_MS);
      currentDelayMs = 10000; // Slow recovery: 1 req/10s after backoff
      return throttledFetch(url, retryCount);
    }

    // Successful non-429 response: reset retry counter and gradually recover rate.
    // Recovery halves the delay on each success until back to baseline.
    if (rateLimitRetries > 0) {
      rateLimitRetries = 0;
    }
    if (currentDelayMs > delayMs) {
      currentDelayMs = Math.max(delayMs, Math.floor(currentDelayMs / 2));
    }

    // Handle 502/503 server errors with retry
    if ((response.status === 502 || response.status === 503) && retryCount < MAX_5XX_RETRIES) {
      logger.warn(`server error (${response.status}), retry ${retryCount + 1}/${MAX_5XX_RETRIES}`);
      await delayFn(RETRY_5XX_MS);
      return throttledFetch(url, retryCount + 1);
    }

    if (!response.ok && response.status !== 202) {
      const body = await response.text();
      logger.error(`HTTP ${response.status}: ${body}`);
      throw new Error(`BGG API returned HTTP ${response.status}: ${body}`);
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
          logger.error(`collection still queued after ${MAX_202_RETRIES} retries`);
          throw new Error(
            "BGG collection request still queued after maximum retries. Try again later.",
          );
        }
        // Exponential backoff: 5s, 10s, 20s
        const backoffMs = BASE_202_DELAY_MS * Math.pow(2, attempt);
        logger.log(
          `collection queued (202), retry ${attempt + 1}/${MAX_202_RETRIES} in ${backoffMs}ms`,
        );
        await delayFn(backoffMs);
        continue;
      }

      throw new Error(`Unexpected BGG response status: ${response.status}`);
    }

    throw new Error("BGG collection request failed after retries.");
  }

  return {
    isConfigured(): boolean {
      return Boolean(config.bggAuthToken);
    },

    async searchGames(query: string): Promise<BggSearchResult[]> {
      assertConfigured();
      const url = `${BGG_BASE_URL}/search?query=${encodeURIComponent(query)}&type=boardgame`;
      const response = await throttledFetch(url);
      const xml = await response.text();

      let results: BggSearchResult[];
      try {
        results = parseSearchResponse(xml);
      } catch (err) {
        throw new Error(`Failed to parse BGG search response: ${toErrorMessage(err)}`);
      }

      // Enrich first 20 results with thumbnail URLs from the /thing endpoint
      if (results.length > 0) {
        const enrichIds = results.slice(0, MAX_BATCH_SIZE).map((r) => r.bggId);
        try {
          const thingUrl = `${BGG_BASE_URL}/thing?id=${enrichIds.join(",")}&type=boardgame`;
          const thingResponse = await throttledFetch(thingUrl);
          const thingXml = await thingResponse.text();
          const thingItems = parseThingItems(thingXml);

          const thumbnailMap = new Map<number, string>();
          for (const item of thingItems) {
            if (item.metadata.thumbnailUrl) {
              thumbnailMap.set(item.bggId, item.metadata.thumbnailUrl);
            }
          }

          for (const result of results) {
            result.thumbnailUrl = thumbnailMap.get(result.bggId) ?? null;
          }
        } catch (err) {
          logger.warn(
            `thumbnail enrichment failed, returning results without thumbnails: ${toErrorMessage(err)}`,
          );
        }
      }

      return results;
    },

    async getGame(bggId: number): Promise<BggGameResult> {
      assertConfigured();
      const url = `${BGG_BASE_URL}/thing?id=${bggId}&stats=1&type=boardgame`;
      const response = await throttledFetch(url);
      const xml = await response.text();

      let items: Array<{ metadata: ThingMetadata; bggData: BggGameData }>;
      try {
        items = parseThingItems(xml);
      } catch (err) {
        throw new Error(`Failed to parse BGG thing response: ${toErrorMessage(err)}`);
      }

      if (items.length === 0) {
        throw new Error(`No game found with BGG ID ${bggId}`);
      }

      if (config.username) {
        logger.log(
          `getGame: fetched data for "${items[0].metadata.name}", checking collection for "${config.username}"`,
        );
        const collectionUrl = `${BGG_BASE_URL}/collection?username=${encodeURIComponent(config.username)}&id=${bggId}&stats=1`;
        const collectionXml = await fetchWithRetry202(collectionUrl);
        const collectionItems = parseCollectionResponse(collectionXml);
        if (collectionItems.length > 0) {
          return {
            metadata: items[0].metadata,
            bggData: items[0].bggData,
            collectionData: {
              numPlays: collectionItems[0].numplays,
            },
          };
        }
      }

      return {
        metadata: items[0].metadata,
        bggData: items[0].bggData,
      };
    },

    async getGames(
      bggIds: number[],
      onBatch?: (event: BatchProgressEvent) => Promise<void> | void,
    ): Promise<Map<number, BggGameResult>> {
      assertConfigured();
      const results = new Map<number, BggGameResult>();
      const totalBatches = Math.ceil(bggIds.length / MAX_BATCH_SIZE);
      logger.log(`getGames: fetching ${bggIds.length} games in ${totalBatches} batches`);

      for (let i = 0; i < bggIds.length; i += MAX_BATCH_SIZE) {
        const batchNum = Math.floor(i / MAX_BATCH_SIZE) + 1;
        const batchIds = bggIds.slice(i, i + MAX_BATCH_SIZE);
        const idList = batchIds.join(",");
        logger.log(`batch ${batchNum}/${totalBatches}: ${batchIds.length} ids`);
        const url = `${BGG_BASE_URL}/thing?id=${idList}&stats=1&type=boardgame`;

        const batchResults = new Map<number, BggGameResult>();
        try {
          const response = await throttledFetch(url);
          const xml = await response.text();
          const items = parseThingItems(xml);

          logger.log(`batch ${batchNum}: parsed ${items.length} games`);
          for (const item of items) {
            const entry = { metadata: item.metadata, bggData: item.bggData };
            results.set(item.bggId, entry);
            batchResults.set(item.bggId, entry);
          }
          if (config.username) {
            logger.log(`batch ${batchNum}: checking collection for "${config.username}"`);
            const collectionUrl = `${BGG_BASE_URL}/collection?username=${encodeURIComponent(config.username)}&id=${idList}&stats=1`;
            const collectionXml = await fetchWithRetry202(collectionUrl);
            const collectionItems = parseCollectionResponse(collectionXml);
            logger.log(`batch ${batchNum}: found ${collectionItems.length} items in collection`);

            for (const colItem of collectionItems) {
              const gameResult = results.get(colItem.bggId);
              if (gameResult) {
                gameResult.collectionData = {
                  numPlays: colItem.numplays,
                };
                batchResults.set(colItem.bggId, gameResult);
              }
            }
          }
        } catch (err) {
          logger.error(`batch ${batchNum} failed: ${toErrorMessage(err)}`);
        }

        await onBatch?.({ batchIds, results: batchResults });
      }

      logger.log(`getGames: complete, ${results.size}/${bggIds.length} results`);
      return results;
    },

    async getUserCollection(): Promise<BggCollectionItem[]> {
      if (!config.username) {
        throw new Error("Username not configured. Set a username to fetch collection data.");
      }

      assertConfigured();
      logger.log(`getUserCollection: fetching for "${config.username}"`);
      const url = `${BGG_BASE_URL}/collection?username=${encodeURIComponent(config.username)}&own=1&subtype=boardgame&stats=1`;
      const xml = await fetchWithRetry202(url);

      try {
        const items = parseCollectionResponse(xml);
        logger.log(`getUserCollection: ${items.length} items for "${config.username}"`);
        return items;
      } catch (err) {
        logger.error(`collection parse error: ${toErrorMessage(err)}`);
        throw new Error(`Failed to parse BGG collection response: ${toErrorMessage(err)}`);
      }
    },
  };
}
