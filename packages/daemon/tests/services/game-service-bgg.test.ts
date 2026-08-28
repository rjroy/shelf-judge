import { describe, test, expect, beforeEach } from "bun:test";
import * as path from "node:path";
import { createGameService } from "../../src/services/game-service.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createBggClient } from "../../src/services/bgg-client.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import { createMockFetch } from "../helpers/mock-fetch.js";
import type { GameService } from "../../src/services/game-service.js";
import type { StorageService } from "../../src/services/storage-service.js";
import type { BggClient } from "../../src/services/bgg-client.js";
import type { MockFileOps } from "../helpers/mock-file-ops.js";
import { parseThingItems } from "../../src/services/bgg-xml-parser.js";
import type { BggGameResult } from "../../src/services/bgg-client.js";
import { GameSchema, type BggSearchResult } from "@shelf-judge/shared";

type BggRequestObservation = NonNullable<BggSearchResult["searchObservation"]>;

const fixturesDir = path.join(import.meta.dir, "../fixtures");

async function readFixture(filename: string): Promise<string> {
  return Bun.file(path.join(fixturesDir, filename)).text();
}

let fileOps: MockFileOps;
let storageService: StorageService;
let gameService: GameService;
let bggClient: BggClient;
let mockFetch: ReturnType<typeof createMockFetch>;
let logs: unknown[][];

const observedAt = "2026-08-26T10:00:00.000Z";

function appliedBggLogs(): unknown[] {
  return logs.filter(([message]) => message === "applied BGG result").map(([, data]) => data);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function clientForResults(
  results: BggGameResult[],
  collectionItems: Awaited<ReturnType<BggClient["getUserCollection"]>> = [],
): BggClient {
  let nextResult = 0;
  return {
    isConfigured: () => true,
    searchGames: () => Promise.resolve([]),
    getGame: () => {
      const result = results[nextResult++];
      if (result === undefined) return Promise.reject(new Error("No queued BGG result"));
      return Promise.resolve(result);
    },
    getGames: async (ids, onBatch) => {
      const result = results[nextResult++] ?? results[results.length - 1];
      if (result === undefined) throw new Error("No queued BGG result");
      const mapped = new Map(ids.map((id) => [id, result]));
      await onBatch?.({ batchIds: ids, results: mapped });
      return mapped;
    },
    getUserCollection: () => Promise.resolve(collectionItems),
  };
}

function withPollBestVotes(result: BggGameResult, best: number): BggGameResult {
  const malformed = structuredClone(result);
  const bucket = malformed.suggestedPlayerPoll?.buckets[0];
  if (bucket === undefined) throw new Error("Expected a suggested-player poll bucket");
  bucket.best = best;
  return malformed;
}

function withCollectionPlayCount(
  result: BggGameResult,
  numPlays: number,
  playObservedAt = observedAt,
): BggGameResult {
  return {
    ...structuredClone(result),
    collectionData: {
      numPlays,
      observation: {
        sourceRequest: "bgg-collection",
        observedAt: playObservedAt,
        state: "complete",
        fieldsReturned: ["numPlays"],
      },
    },
  };
}

function withUnsafePollLabel(result: BggGameResult): BggGameResult {
  const malformed = structuredClone(result);
  const poll = malformed.suggestedPlayerPoll;
  if (poll === undefined) throw new Error("Expected a suggested-player poll");
  const bucket = poll.buckets[0];
  if (bucket === undefined) throw new Error("Expected a suggested-player poll bucket");
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  poll.buckets = [{ ...bucket, playerCount: String(unsafe) }];
  malformed.bggData.bestPlayerCount = unsafe;
  return malformed;
}

beforeEach(() => {
  fileOps = createMockFileOps();
  storageService = createStorageService({
    dataDir: "/data",
    configPath: "/config/config.json",
    fileOps,
  });
  mockFetch = createMockFetch();
  logs = [];
  bggClient = createBggClient({
    config: { bggAuthToken: "test-token", username: null },
    fetchFn: mockFetch.fn,
    delayMs: 0,
    delayFn: () => Promise.resolve(),
    now: () => observedAt,
  });
  const fitnessService = createFitnessService();
  gameService = createGameService({
    storageService,
    fitnessService,
    bggClient,
    logger: {
      log: (...args: unknown[]) => logs.push(args),
      warn: (...args: unknown[]) => logs.push(args),
      error: (...args: unknown[]) => logs.push(args),
    },
  });
});

describe("GameService BGG Integration", () => {
  describe("addGame with bggId", () => {
    test("fetches BGG data when bggId provided", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      mockFetch.enqueue(200, thingXml);

      const { game } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      expect(game.bggId).toBe(266192);
      expect(game.bggData).not.toBeNull();
      expect(game.bggData!.communityRating).toBe(8.00153);
      expect(game.bggData!.weight).toBe(2.4802);
      expect(game.name).toBe("Wingspan");
      expect(game.yearPublished).toBe(2019);
      expect(game.minPlayers).toBe(1);
      expect(game.maxPlayers).toBe(5);
      expect(game.bggData!.bestPlayerCount).toBe(3);
      expect(game.bestPlayers).toBe(3);
      expect(game.acquisition).toEqual({ state: "unknown" });
      expect(game.durationEvidence).toEqual({
        status: "valid",
        value: 70,
        source: "bgg-thing",
        observedAt,
      });
      expect(game.playerRangeEvidence).toEqual({
        status: "valid",
        value: { minPlayers: 1, maxPlayers: 5 },
        source: "bgg-player-range",
        observedAt,
      });
      expect(game.suggestedPlayerPoll).toMatchObject({
        status: "valid",
        state: "usable",
        source: "bgg-suggested-player-poll",
        observedAt,
      });
      expect(game.bggData).not.toHaveProperty("suggestedPlayerCounts");
      const observations = appliedBggLogs();
      expect(observations).toHaveLength(1);
      const observation = observations[0];
      if (
        typeof observation !== "object" ||
        observation === null ||
        !("thingFieldsReturned" in observation) ||
        !isStringArray(observation.thingFieldsReturned)
      ) {
        throw new Error("Expected an applied BGG observation");
      }
      expect(observation).toMatchObject({
        bggId: 266192,
        thingObservedAt: observedAt,
        playerRangeState: "complete",
        pollState: "usable",
        collectionState: "absent",
      });
      expect(observation.thingFieldsReturned).toContain("name");
      expect(observation.thingFieldsReturned).toContain("bggData");
    });

    test("adds game with warning when BGG unavailable", async () => {
      mockFetch.enqueue(500, "Internal Server Error");
      mockFetch.enqueue(500, "Internal Server Error");
      mockFetch.enqueue(500, "Internal Server Error");

      const { game, warning } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      expect(game.bggId).toBe(266192);
      expect(game.bggData).toBeNull();
      expect(warning).toBeDefined();
      expect(warning).toContain("BGG data could not be fetched");
    });

    test("persists malformed live poll buckets as invalid evidence on add", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const result = withPollBestVotes(parsed, -1);
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([result]),
      });

      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });

      expect(game.suggestedPlayerPoll).toMatchObject({
        status: "invalid",
        state: "unusable",
        buckets: [],
        source: "bgg-suggested-player-poll",
        observedAt,
        evidence: { presence: "present", value: result.suggestedPlayerPoll?.buckets },
      });
      expect((await storageService.loadCollection()).games[0]?.suggestedPlayerPoll).toEqual(
        game.suggestedPlayerPoll,
      );
    });

    test("persists a negative live play count as exact invalid evidence and permits correction", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const correctedAt = "2026-08-26T11:00:00.000Z";
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([
          withCollectionPlayCount(parsed, -1),
          withCollectionPlayCount(parsed, 7, correctedAt),
        ]),
      });

      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });

      expect(game.numPlays).toBeNull();
      expect(game.playCountEvidence).toEqual({
        status: "invalid",
        evidence: { presence: "present", value: -1 },
        source: "bgg-collection",
        observedAt,
      });
      expect(GameSchema.safeParse((await storageService.loadCollection()).games[0]).success).toBe(
        true,
      );
      expect(await service.refreshBggData(game.id)).toMatchObject({
        numPlays: 7,
        playCountEvidence: { status: "valid", value: 7, observedAt: correctedAt },
      });
    });

    test("persists an unsafe poll label as unusable with strict-safe compatibility on add", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const unsafe = withUnsafePollLabel(parsed);
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([unsafe]),
      });

      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });

      expect(game.bestPlayers).toBeNull();
      expect(game.bggData?.bestPlayerCount).toBeNull();
      expect(game.suggestedPlayerPoll).toMatchObject({
        status: "valid",
        state: "unusable",
        buckets: unsafe.suggestedPlayerPoll?.buckets,
      });
      expect(GameSchema.safeParse(game).success).toBe(true);
    });
  });

  describe("searchGames", () => {
    test("returns search results from BGG", async () => {
      const searchXml = await readFixture("search-wingspan.xml");
      const thingBatchXml = await readFixture("thing-search-batch.xml");
      mockFetch.enqueue(200, searchXml);
      mockFetch.enqueue(200, thingBatchXml);

      const results = await gameService.searchGames("Wingspan");

      expect(results).toHaveLength(14);
      expect(results[1].bggId).toBe(266192);
      expect(results[1].name).toBe("Wingspan");
      expect(results[1].searchObservation).toEqual({
        sourceRequest: "bgg-search",
        observedAt,
        state: "complete",
        fieldsReturned: ["bggId", "name", "yearPublished"],
      });
    });

    test("throws when BGG not configured", async () => {
      const noBggService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(noBggService.searchGames("Wingspan")).rejects.toThrow(
        "BGG integration is not configured",
      );
    });
  });

  describe("refreshBggData", () => {
    test("rejects an older response after a newer concurrent refresh is accepted", async () => {
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const { game } = await seedService.addGame({ name: "Wingspan", bggId: 266192 });
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const older = structuredClone(parsed);
      older.metadata.name = "Older response";
      const newer = structuredClone(parsed);
      newer.metadata.name = "Newer response";
      let resolveOlder: (result: BggGameResult) => void = () => {};
      let resolveNewer: (result: BggGameResult) => void = () => {};
      const olderResult = new Promise<BggGameResult>((resolve) => {
        resolveOlder = resolve;
      });
      const newerResult = new Promise<BggGameResult>((resolve) => {
        resolveNewer = resolve;
      });
      let request = 0;
      const concurrentClient: BggClient = {
        ...clientForResults([]),
        getGame: () => (request++ === 0 ? olderResult : newerResult),
      };
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: concurrentClient,
      });

      const first = service.refreshBggData(game.id);
      const second = service.refreshBggData(game.id);
      resolveNewer(newer);
      expect((await second).name).toBe("Newer response");
      resolveOlder(older);
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(first).rejects.toThrow("Newer BGG data was accepted");
      expect((await storageService.loadCollection()).games[0]?.name).toBe("Newer response");
    });

    test("updates bggData and preserves user overrides", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      // First fetch for addGame
      mockFetch.enqueue(200, thingXml);

      const { game } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      // Rate a BGG-derived axis (override)
      const collection = await storageService.loadCollection();
      const complexityAxis = collection.axes.find(
        (axis) => axis.source === "derived" && axis.derivedField === "weight",
      );
      expect(complexityAxis).toBeDefined();
      await gameService.rateGame(game.id, { [complexityAxis!.id]: 7 });
      const beforeRefresh = await storageService.loadCollection();
      beforeRefresh.games[0].bestPlayers = null;
      await storageService.saveCollection(beforeRefresh);

      // Refresh: second fetch
      mockFetch.enqueue(200, thingXml);
      const refreshed = await gameService.refreshBggData(game.id);

      // bggData should be updated (fetchedAt changed)
      expect(refreshed.bggData).not.toBeNull();
      expect(refreshed.bggData!.communityRating).toBe(8.00153);
      expect(refreshed.bggData!.bestPlayerCount).toBe(3);
      expect(refreshed.bestPlayers).toBe(3);

      // User override should be preserved
      expect(refreshed.ratings[complexityAxis!.id]).toBe(7);
      const observations = appliedBggLogs();
      expect(observations).toHaveLength(2);
      const observation = observations[1];
      if (
        typeof observation !== "object" ||
        observation === null ||
        !("thingFieldsReturned" in observation) ||
        !isStringArray(observation.thingFieldsReturned)
      ) {
        throw new Error("Expected a refreshed BGG observation");
      }
      expect(observation).toMatchObject({
        bggId: 266192,
        thingObservedAt: observedAt,
        playerRangeState: "complete",
        pollState: "usable",
        collectionState: "absent",
      });
      expect(observation.thingFieldsReturned).toContain("name");
      expect(observation.thingFieldsReturned).toContain("bggData");
    });

    test("throws for manual game without bggId", async () => {
      const { game } = await gameService.addGame({ name: "Manual Game" });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.refreshBggData(game.id)).rejects.toThrow("no BGG ID");
    });

    test("retains persisted field evidence when a refresh omits those fields", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      mockFetch.enqueue(200, thingXml);
      const { game } = await gameService.addGame({ name: "Wingspan", bggId: 266192 });
      const before = structuredClone(game);
      const parsed = parseThingItems(thingXml, "2026-08-26T11:00:00.000Z")[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const omittedResult: BggGameResult = {
        metadata: {
          ...parsed.metadata,
          minPlayers: null,
          maxPlayers: null,
          playingTime: null,
        },
        bggData: parsed.bggData,
        metadataObservation: {
          ...parsed.metadataObservation,
          state: "partial",
          fieldsReturned: parsed.metadataObservation.fieldsReturned.filter(
            (field) => !["minPlayers", "maxPlayers", "playingTime"].includes(field),
          ),
        },
        playerRangeObservation: {
          ...parsed.playerRangeObservation,
          state: "absent",
          fieldsReturned: [],
        },
        suggestedPlayerPoll: {
          buckets: [],
          state: "absent",
          observation: {
            sourceRequest: "bgg-thing",
            observedAt: "2026-08-26T11:00:00.000Z",
            state: "absent",
            fieldsReturned: [],
          },
        },
        collectionData: {
          numPlays: null,
          observation: {
            sourceRequest: "bgg-collection",
            observedAt: "2026-08-26T11:05:00.000Z",
            state: "absent",
            fieldsReturned: [],
          },
        },
      };
      const omittedClient: BggClient = {
        isConfigured: () => true,
        searchGames: () => Promise.resolve([]),
        getGame: () => Promise.resolve(omittedResult),
        getGames: () => Promise.resolve(new Map([[266192, omittedResult]])),
        getUserCollection: () => Promise.resolve([]),
      };
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: omittedClient,
      });

      const refreshed = await service.refreshBggData(game.id);

      expect(refreshed.playCountEvidence).toEqual(before.playCountEvidence);
      expect(refreshed.durationEvidence).toEqual(before.durationEvidence);
      expect(refreshed.playerRangeEvidence).toEqual(before.playerRangeEvidence);
      expect(refreshed.suggestedPlayerPoll).toEqual(before.suggestedPlayerPoll);
    });

    test("retains an existing absent poll byte-for-byte when refresh also omits it", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const initial = structuredClone(parsed);
      initial.suggestedPlayerPoll = {
        buckets: [],
        state: "absent",
        observation: {
          sourceRequest: "bgg-thing",
          observedAt,
          state: "absent",
          fieldsReturned: [],
        },
      };
      const refreshedResult = structuredClone(initial);
      if (refreshedResult.suggestedPlayerPoll?.observation === undefined) {
        throw new Error("Expected absent poll observation");
      }
      refreshedResult.suggestedPlayerPoll.observation.observedAt = "2026-08-26T11:00:00.000Z";
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([initial, refreshedResult]),
      });
      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });
      const before = JSON.stringify(game.suggestedPlayerPoll);

      const refreshed = await service.refreshBggData(game.id);

      expect(JSON.stringify(refreshed.suggestedPlayerPoll)).toBe(before);
    });

    test("persists malformed live poll buckets on refresh", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const malformed = withPollBestVotes(parsed, Number.MAX_SAFE_INTEGER + 1);
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([parsed, malformed]),
      });
      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });

      const refreshed = await service.refreshBggData(game.id);

      expect(refreshed.suggestedPlayerPoll).toMatchObject({
        status: "invalid",
        evidence: { presence: "present", value: malformed.suggestedPlayerPoll?.buckets },
        source: "bgg-suggested-player-poll",
        observedAt,
      });
    });

    test("persists an unsafe live play count on refresh and permits correction", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const correctedAt = "2026-08-26T12:00:00.000Z";
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([
          parsed,
          withCollectionPlayCount(parsed, Number.MAX_SAFE_INTEGER + 1),
          withCollectionPlayCount(parsed, 9, correctedAt),
        ]),
      });
      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });

      const invalid = await service.refreshBggData(game.id);

      expect(invalid.numPlays).toBeNull();
      expect(invalid.playCountEvidence).toEqual({
        status: "invalid",
        evidence: { presence: "present", value: Number.MAX_SAFE_INTEGER + 1 },
        source: "bgg-collection",
        observedAt,
      });
      expect(GameSchema.safeParse((await storageService.loadCollection()).games[0]).success).toBe(
        true,
      );
      expect(await service.refreshBggData(game.id)).toMatchObject({
        numPlays: 9,
        playCountEvidence: { status: "valid", value: 9, observedAt: correctedAt },
      });
    });

    test("persists an unsafe poll label as unusable with strict-safe compatibility on refresh", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const unsafe = withUnsafePollLabel(parsed);
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([parsed, unsafe]),
      });
      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });

      const refreshed = await service.refreshBggData(game.id);

      expect(refreshed.bestPlayers).toBeNull();
      expect(refreshed.bggData?.bestPlayerCount).toBeNull();
      expect(refreshed.suggestedPlayerPoll).toMatchObject({
        status: "valid",
        state: "unusable",
        buckets: unsafe.suggestedPlayerPoll?.buckets,
      });
      expect(GameSchema.safeParse(refreshed).success).toBe(true);
    });

    test("does not change old poll evidence when refresh fails", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      mockFetch.enqueue(200, thingXml);
      const { game } = await gameService.addGame({ name: "Wingspan", bggId: 266192 });
      const before = structuredClone(game.suggestedPlayerPoll);
      const failingClient: BggClient = {
        ...clientForResults([]),
        getGame: () => Promise.reject(new Error("refresh failed")),
      };
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: failingClient,
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.refreshBggData(game.id)).rejects.toThrow("refresh failed");
      expect((await storageService.loadCollection()).games[0]?.suggestedPlayerPoll).toEqual(before);
    });
  });

  describe("refreshAllBggData", () => {
    test("refreshes all games with bggIds", async () => {
      const wingspanXml = await readFixture("thing-wingspan-266192.xml");
      const gloomhavenXml = await readFixture("thing-gloomhaven-174430.xml");

      // Add two BGG games
      mockFetch.enqueue(200, wingspanXml);
      await gameService.addGame({ name: "Wingspan", bggId: 266192 });

      mockFetch.enqueue(200, gloomhavenXml);
      await gameService.addGame({ name: "Gloomhaven", bggId: 174430 });

      // Add a manual game (should be skipped in refresh)
      await gameService.addGame({ name: "Manual Game" });

      // Prepare batch response containing both games
      const batchXml = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  ${wingspanXml.replace(/<\?xml[^?]*\?>/, "").replace(/<\/?items[^>]*>/g, "")}
  ${gloomhavenXml.replace(/<\?xml[^?]*\?>/, "").replace(/<\/?items[^>]*>/g, "")}
</items>`;
      mockFetch.enqueue(200, batchXml);

      const summary = await gameService.refreshAllBggData();

      expect(summary.refreshed).toBe(2);
      expect(summary.errors).toHaveLength(0);
      expect(appliedBggLogs().slice(-2)).toEqual([
        expect.objectContaining({
          bggId: 266192,
          thingObservedAt: observedAt,
          playerRangeState: "complete",
          pollState: "usable",
        }),
        expect.objectContaining({
          bggId: 174430,
          thingObservedAt: observedAt,
          playerRangeState: "complete",
          pollState: "usable",
        }),
      ]);
    });
  });

  describe("importBggCollection observations", () => {
    test("persists malformed live poll buckets as invalid evidence on import", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const malformed = withPollBestVotes(parsed, 1.5);
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults(
          [malformed],
          [
            {
              bggId: 266192,
              name: "Wingspan",
              yearPublished: 2019,
              numplays: 12,
            },
          ],
        ),
      });

      const summary = await service.importBggCollection();
      const imported = (await storageService.loadCollection()).games[0];

      expect(summary).toMatchObject({ imported: 1, errors: [] });
      expect(imported?.suggestedPlayerPoll).toMatchObject({
        status: "invalid",
        evidence: { presence: "present", value: malformed.suggestedPlayerPoll?.buckets },
        source: "bgg-suggested-player-poll",
        observedAt,
      });
    });

    test("persists a fractional live play count as exact invalid evidence and permits correction", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const correctedAt = "2026-08-26T13:00:00.000Z";
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults(
          [withCollectionPlayCount(parsed, 1.5), withCollectionPlayCount(parsed, 11, correctedAt)],
          [
            {
              bggId: 266192,
              name: "Wingspan",
              yearPublished: 2019,
              numplays: 1.5,
            },
          ],
        ),
      });

      expect(await service.importBggCollection()).toMatchObject({ imported: 1, errors: [] });
      const imported = (await storageService.loadCollection()).games[0];
      if (imported === undefined) throw new Error("Expected imported game");
      expect(imported.numPlays).toBeNull();
      expect(imported.playCountEvidence).toEqual({
        status: "invalid",
        evidence: { presence: "present", value: 1.5 },
        source: "bgg-collection",
        observedAt,
      });
      expect(GameSchema.safeParse(imported).success).toBe(true);
      expect(await service.refreshBggData(imported.id)).toMatchObject({
        numPlays: 11,
        playCountEvidence: { status: "valid", value: 11, observedAt: correctedAt },
      });
    });

    test("persists an unsafe poll label as unusable with strict-safe compatibility on import", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const unsafe = withUnsafePollLabel(parsed);
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults(
          [unsafe],
          [{ bggId: 266192, name: "Wingspan", yearPublished: 2019, numplays: 12 }],
        ),
      });

      expect(await service.importBggCollection()).toMatchObject({ imported: 1, errors: [] });
      const imported = (await storageService.loadCollection()).games[0];

      expect(imported?.bestPlayers).toBeNull();
      expect(imported?.bggData?.bestPlayerCount).toBeNull();
      expect(imported?.suggestedPlayerPoll).toMatchObject({
        status: "valid",
        state: "unusable",
        buckets: unsafe.suggestedPlayerPoll?.buckets,
      });
      expect(GameSchema.safeParse(imported).success).toBe(true);
    });

    test("uses complete secondary plays and retains initial plays for absent or partial responses", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const initialObservedAt = "2026-08-26T10:00:00.000Z";
      const secondaryObservedAt = "2026-08-26T10:05:00.000Z";
      const parsedThing = parseThingItems(thingXml, "2026-08-26T10:03:00.000Z")[0];
      if (!parsedThing) throw new Error("Expected Wingspan thing fixture");

      const cases: Array<{
        secondaryPlays: number | null;
        observation: BggRequestObservation | undefined;
        expectedPlays: number;
        expectedSource: string;
      }> = [
        {
          secondaryPlays: 99,
          observation: {
            sourceRequest: "bgg-collection",
            observedAt: secondaryObservedAt,
            state: "complete",
            fieldsReturned: ["numPlays"],
          },
          expectedPlays: 99,
          expectedSource: "secondary-batch",
        },
        {
          secondaryPlays: null,
          observation: {
            sourceRequest: "bgg-collection",
            observedAt: secondaryObservedAt,
            state: "absent",
            fieldsReturned: [],
          },
          expectedPlays: 12,
          expectedSource: "initial-import",
        },
        {
          secondaryPlays: null,
          observation: {
            sourceRequest: "bgg-collection",
            observedAt: secondaryObservedAt,
            state: "partial",
            fieldsReturned: [],
          },
          expectedPlays: 12,
          expectedSource: "initial-import",
        },
        {
          secondaryPlays: 88,
          observation: undefined,
          expectedPlays: 12,
          expectedSource: "initial-import",
        },
        {
          secondaryPlays: 77,
          observation: {
            sourceRequest: "bgg-collection",
            observedAt: secondaryObservedAt,
            state: "complete",
            fieldsReturned: [],
          },
          expectedPlays: 12,
          expectedSource: "initial-import",
        },
        {
          secondaryPlays: 66,
          observation: {
            sourceRequest: "bgg-thing",
            observedAt: secondaryObservedAt,
            state: "complete",
            fieldsReturned: ["numPlays"],
          },
          expectedPlays: 12,
          expectedSource: "initial-import",
        },
      ];

      for (const testCase of cases) {
        const caseFileOps = createMockFileOps();
        const caseStorage = createStorageService({
          dataDir: "/data",
          configPath: "/config/config.json",
          fileOps: caseFileOps,
        });
        const logs: unknown[][] = [];
        const result: BggGameResult = {
          metadata: parsedThing.metadata,
          bggData: parsedThing.bggData,
          metadataObservation: parsedThing.metadataObservation,
          playerRangeObservation: parsedThing.playerRangeObservation,
          suggestedPlayerPoll: parsedThing.suggestedPlayerPoll,
          collectionData: {
            numPlays: testCase.secondaryPlays,
            observation: testCase.observation,
          },
        };
        const caseClient: BggClient = {
          isConfigured: () => true,
          searchGames: () => Promise.resolve([]),
          getGame: () => Promise.resolve(result),
          getUserCollection: () =>
            Promise.resolve([
              {
                bggId: 266192,
                name: "Wingspan",
                yearPublished: 2019,
                numplays: 12,
                playCountObservation: {
                  sourceRequest: "bgg-collection",
                  observedAt: initialObservedAt,
                  state: "complete",
                  fieldsReturned: ["numPlays"],
                },
              },
            ]),
          getGames: async (ids, onBatch) => {
            const results = new Map([[266192, result]]);
            await onBatch?.({ batchIds: ids, results });
            return results;
          },
        };
        const service = createGameService({
          storageService: caseStorage,
          fitnessService: createFitnessService(),
          bggClient: caseClient,
          logger: {
            log: (...args: unknown[]) => logs.push(args),
            warn: (...args: unknown[]) => logs.push(args),
            error: (...args: unknown[]) => logs.push(args),
          },
        });

        const summary = await service.importBggCollection();
        const collection = await caseStorage.loadCollection();
        const serializedLogs = JSON.stringify(logs);

        expect(summary.imported).toBe(1);
        expect(collection.games[0]?.numPlays).toBe(testCase.expectedPlays);
        expect(collection.games[0]?.playCountEvidence).toMatchObject({
          status: "valid",
          value: testCase.expectedPlays,
          source: "bgg-collection",
          observedAt:
            testCase.expectedSource === "secondary-batch" ? secondaryObservedAt : initialObservedAt,
        });
        expect(serializedLogs).toContain(testCase.expectedSource);
        expect(serializedLogs).toContain(
          testCase.expectedSource === "secondary-batch" ? secondaryObservedAt : initialObservedAt,
        );
      }
    });
  });

  describe("fitness score with BGG-derived axes", () => {
    test("includes BGG-derived axes when bggData present", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      mockFetch.enqueue(200, thingXml);

      const { game } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      const result = await gameService.getGame(game.id);

      // Default axes are Community Rating and Complexity, both BGG-derived
      expect(result.score).not.toBeNull();
      expect(result.score!.ratedAxisCount).toBe(2);

      // Community Rating: 8.00153 (1-10 scale, identity)
      // Complexity: 2.4802 on 1-5 scale, higher-is-better: 1 + 9*(2.4802-1)/4 = 4.33
      // Equal weights (50/50): (8.00153 + 4.33) / 2 ≈ 6.17 -> 6.2
      expect(result.score!.score).toBe(6.2);
    });

    test("excludes BGG-derived axes when bggData absent", async () => {
      const { game } = await gameService.addGame({ name: "Manual Game" });

      const result = await gameService.getGame(game.id);

      // No personal ratings, no BGG data -> no score
      expect(result.score).toBeNull();
    });

    test("override of BGG-derived axis shows in breakdown", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      mockFetch.enqueue(200, thingXml);

      const { game } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      const collection = await storageService.loadCollection();
      const complexityAxis = collection.axes.find(
        (axis) => axis.source === "derived" && axis.derivedField === "weight",
      );

      // Override the complexity axis
      await gameService.rateGame(game.id, { [complexityAxis!.id]: 7 });

      const result = await gameService.getGame(game.id);
      expect(result.score).not.toBeNull();

      const complexityBreakdown = result.score!.breakdown.find(
        (b) => b.axisId === complexityAxis!.id,
      );
      expect(complexityBreakdown).toBeDefined();
      expect(complexityBreakdown!.source).toBe("override");
      expect(complexityBreakdown!.effectiveRating).toBe(7);
      expect(complexityBreakdown!.sourceValue).toBe(2.4802);
    });
  });
});
