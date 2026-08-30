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
import { GameSchema, type BggSearchResult, type Collection } from "@shelf-judge/shared";
import { collectionMutationServiceFor } from "../../src/services/collection-mutation-service.js";
import {
  createIntentionService,
  isPlayEvidenceStale,
} from "../../src/services/intention-service.js";

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

function completeThingXmlForService(ids: readonly number[]): string {
  return `<items>${ids
    .map(
      (id) => `<item type="boardgame" id="${id}">
        <name type="primary" value="Unexpected Game ${id}"/>
        <yearpublished value="2025"/>
        <minplayers value="1"/>
        <maxplayers value="4"/>
        <playingtime value="60"/>
        <image>unexpected-${id}</image>
        <thumbnail>unexpected-thumbnail-${id}</thumbnail>
        <link type="boardgamemechanic" id="${id}" value="Mechanic ${id}"/>
        <statistics><ratings><average value="7"/></ratings></statistics>
      </item>`,
    )
    .join("")}</items>`;
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
      await onBatch?.({ batchIds: ids, results: mapped, failures: new Map() });
      return mapped;
    },
    getUserCollection: () => Promise.resolve(collectionItems),
    getPlayCount: () => Promise.reject(new Error("No queued BGG play result")),
  };
}

function failFirstGatedSave(base: StorageService, initial: Collection, failureMessage: string) {
  let stored = structuredClone(initial);
  let signalSaveStarted = () => {};
  let releaseSave = () => {};
  const saveStarted = new Promise<void>((resolve) => {
    signalSaveStarted = resolve;
  });
  const saveRelease = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saveAttempt = 0;
  const storage = {
    loadCollection: () => Promise.resolve(structuredClone(stored)),
    saveCollection: async (collection: Collection) => {
      if (saveAttempt++ === 0) {
        signalSaveStarted();
        await saveRelease;
        throw new Error(failureMessage);
      }
      stored = structuredClone(collection);
    },
    loadTournament: () => base.loadTournament(),
    loadShelfConfig: () => base.loadShelfConfig(),
  };
  return {
    storage,
    saveStarted,
    releaseSave,
    stored: () => structuredClone(stored),
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
      expect(game.entityMetadata.mechanic).toMatchObject({
        state: "complete",
        observedAt,
        refreshFailure: null,
      });
      expect(game.entityMetadata.designer.entities.length).toBeGreaterThan(0);
      expect(game.entityMetadata.artist.entities.length).toBeGreaterThan(0);
      expect(
        new Set(Object.values(game.entityMetadata).map((metadata) => metadata.observedAt)),
      ).toEqual(new Set([observedAt]));
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
      for (const metadata of Object.values(game.entityMetadata)) {
        expect(metadata.state).toBe("refresh-needed");
        expect(metadata.refreshFailure?.message).toContain("HTTP 500");
      }
    });

    test("persists an explained unrefreshable state for a game without a BGG ID", async () => {
      const { game } = await gameService.addGame({ name: "Manual Game" });

      for (const metadata of Object.values(game.entityMetadata)) {
        expect(metadata).toEqual({
          state: "unrefreshable",
          entities: [],
          observedAt: null,
          refreshFailure: null,
          correctionDestination: null,
          explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
        });
      }
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
      expect((await service.refreshBggData(game.id)).game).toMatchObject({
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
    test("replaces the primary collection count with deduplicated related-entry plays", async () => {
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const { game } = await seedService.addGame({ name: "Wingspan", bggId: 266192 });
      await seedService.setAdditionalBggIds(game.id, [999001, 999002]);
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const requestedPlayIds: number[][] = [];
      const relatedClient: BggClient = {
        ...clientForResults([parsed]),
        getPlayCount: (bggIds) => {
          requestedPlayIds.push(bggIds);
          return Promise.resolve({
            numPlays: 7,
            observation: {
              sourceRequest: "bgg-plays",
              observedAt: "2026-08-26T13:00:00.000Z",
              state: "complete",
              fieldsReturned: ["numPlays"],
            },
          });
        },
      };
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: relatedClient,
      });

      const refreshed = await service.refreshBggData(game.id);

      expect(requestedPlayIds).toEqual([[266192, 999001, 999002]]);
      expect(refreshed.game.additionalBggIds).toEqual([999001, 999002]);
      expect(refreshed.game.numPlays).toBe(7);
      expect(refreshed.game.playCountEvidence).toMatchObject({
        status: "valid",
        value: 7,
        source: "bgg-plays",
      });
    });

    test("rejects ambiguous additional BGG ID associations", async () => {
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const first = (await service.addGame({ name: "First", bggId: 10 })).game;
      const second = (await service.addGame({ name: "Second", bggId: 20 })).game;

      expect((await service.setAdditionalBggIds(first.id, [30])).additionalBggIds).toEqual([30]);
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.setAdditionalBggIds(first.id, [10])).rejects.toThrow("primary BGG ID");
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.setAdditionalBggIds(second.id, [30])).rejects.toThrow(
        'already associated with "First"',
      );
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.setAdditionalBggIds(second.id, [40, 40])).rejects.toThrow(
        "must be unique",
      );
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.addGame({ name: "Conflicting Primary", bggId: 30 })).rejects.toThrow(
        'already exists: "First"',
      );
    });

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
      expect((await second).game.name).toBe("Newer response");
      resolveOlder(older);
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(first).rejects.toThrow("Newer BGG data was accepted");
      expect((await storageService.loadCollection()).games[0]?.name).toBe("Newer response");
    });

    test("accepts a concurrent success after an earlier failure records a warning", async () => {
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const { game } = await seedService.addGame({ name: "Wingspan", bggId: 266192 });
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const successful = structuredClone(parsed);
      successful.metadata.name = "Successful response";
      let rejectFailure: (error: Error) => void = () => {};
      let resolveSuccess: (result: BggGameResult) => void = () => {};
      const failureResult = new Promise<BggGameResult>((_resolve, reject) => {
        rejectFailure = reject;
      });
      const successResult = new Promise<BggGameResult>((resolve) => {
        resolveSuccess = resolve;
      });
      let request = 0;
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: () => (request++ === 0 ? failureResult : successResult),
        },
        now: () => "2026-08-26T11:00:00.000Z",
      });

      const failingRefresh = service.refreshBggData(game.id);
      const successfulRefresh = service.refreshBggData(game.id);
      rejectFailure(new Error("temporary BGG failure"));
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(failingRefresh).rejects.toThrow("temporary BGG failure");
      resolveSuccess(successful);

      expect((await successfulRefresh).game.name).toBe("Successful response");
      const persisted = (await storageService.loadCollection()).games[0];
      expect(persisted?.name).toBe("Successful response");
      expect(persisted?.entityMetadata).toEqual(successful.entityMetadata);
    });

    test("restores the success generation when a single-refresh save fails", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const { game } = await seed.addGame({ name: "Original", bggId: 266192 });
      const before = await storageService.loadCollection();
      const failedAt = "2026-08-26T11:00:00.000Z";
      let request = 0;
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: () =>
            request++ === 0
              ? Promise.resolve(parsed)
              : Promise.reject(new Error("later legitimate failure")),
        },
        now: () => failedAt,
      });
      const saveCollection = storageService.saveCollection.bind(storageService);
      let saveAttempt = 0;
      storageService.saveCollection = (collection) => {
        if (saveAttempt++ === 0) return Promise.reject(new Error("success save failed"));
        return saveCollection(collection);
      };

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.refreshBggData(game.id)).rejects.toThrow("success save failed");
      expect(await storageService.loadCollection()).toEqual(before);

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.refreshBggData(game.id)).rejects.toThrow("later legitimate failure");
      const persisted = (await storageService.loadCollection()).games[0];
      expect(persisted?.name).toBe("Original");
      for (const metadata of Object.values(persisted?.entityMetadata ?? {})) {
        expect(metadata.refreshFailure).toEqual({
          attemptedAt: failedAt,
          message: "later legitimate failure",
        });
      }
    });

    test("admits a second same-game success captured while the first save is pending and then fails", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const { game } = await seed.addGame({ name: "Original", bggId: 266192 });
      const gate = failFirstGatedSave(
        storageService,
        await storageService.loadCollection(),
        "first success save failed",
      );
      const firstResult = structuredClone(parsed);
      firstResult.metadata.name = "Failed first success";
      const secondResult = structuredClone(parsed);
      secondResult.metadata.name = "Durable second success";
      let request = 0;
      let signalSecondRequest = () => {};
      const secondRequestStarted = new Promise<void>((resolve) => {
        signalSecondRequest = resolve;
      });
      const service = createGameService({
        storageService: gate.storage,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: () => {
            if (request++ === 0) return Promise.resolve(firstResult);
            signalSecondRequest();
            return Promise.resolve(secondResult);
          },
        },
      });
      const first = service.refreshBggData(game.id);
      await gate.saveStarted;
      const second = service.refreshBggData(game.id);
      await secondRequestStarted;
      gate.releaseSave();

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(first).rejects.toThrow("first success save failed");
      expect((await second).game.name).toBe("Durable second success");
      expect(gate.stored().games[0]?.name).toBe("Durable second success");
    });

    test("does not let a concurrent failure warn over an earlier accepted success", async () => {
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const { game } = await seedService.addGame({ name: "Wingspan", bggId: 266192 });
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const successful = structuredClone(parsed);
      successful.metadata.name = "Successful response";
      let resolveSuccess: (result: BggGameResult) => void = () => {};
      let rejectFailure: (error: Error) => void = () => {};
      const successResult = new Promise<BggGameResult>((resolve) => {
        resolveSuccess = resolve;
      });
      const failureResult = new Promise<BggGameResult>((_resolve, reject) => {
        rejectFailure = reject;
      });
      let request = 0;
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: () => (request++ === 0 ? successResult : failureResult),
        },
        now: () => "2026-08-26T11:00:00.000Z",
      });

      const successfulRefresh = service.refreshBggData(game.id);
      const failingRefresh = service.refreshBggData(game.id);
      resolveSuccess(successful);
      expect((await successfulRefresh).game.name).toBe("Successful response");
      rejectFailure(new Error("late BGG failure"));
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(failingRefresh).rejects.toThrow("late BGG failure");

      const persisted = (await storageService.loadCollection()).games[0];
      expect(persisted?.name).toBe("Successful response");
      expect(persisted?.entityMetadata).toEqual(successful.entityMetadata);
    });

    test("does not attach a late failure after an identical success is accepted", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([parsed]),
      });
      const { game } = await seedService.addGame({ name: "Wingspan", bggId: 266192 });
      const before = structuredClone(game.entityMetadata);
      let resolveSuccess: (result: BggGameResult) => void = () => {};
      let rejectFailure: (error: Error) => void = () => {};
      const successResult = new Promise<BggGameResult>((resolve) => {
        resolveSuccess = resolve;
      });
      const failureResult = new Promise<BggGameResult>((_resolve, reject) => {
        rejectFailure = reject;
      });
      let request = 0;
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: () => (request++ === 0 ? successResult : failureResult),
        },
        now: () => observedAt,
      });

      const successfulRefresh = service.refreshBggData(game.id);
      const failingRefresh = service.refreshBggData(game.id);
      resolveSuccess(structuredClone(parsed));
      expect((await successfulRefresh).game.entityMetadata).toEqual(before);
      rejectFailure(new Error("late BGG failure"));
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(failingRefresh).rejects.toThrow("late BGG failure");

      expect((await storageService.loadCollection()).games[0]?.entityMetadata).toEqual(before);
    });

    test.each([
      ["wrong ID", completeThingXmlForService([174430])],
      ["duplicate requested ID", completeThingXmlForService([266192, 266192])],
    ])("does not persist identity or entity evidence from a %s response", async (_label, xml) => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([parsed]),
      });
      const { game } = await seedService.addGame({ name: "Wingspan", bggId: 266192 });
      const before = structuredClone(game);
      const failedFetch = createMockFetch();
      failedFetch.enqueue(200, xml);
      const failedAt = "2026-08-26T11:00:00.000Z";
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: createBggClient({
          config: { bggAuthToken: "test-token", username: null },
          fetchFn: failedFetch.fn,
          delayMs: 0,
          delayFn: () => Promise.resolve(),
          now: () => failedAt,
        }),
        now: () => failedAt,
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.refreshBggData(game.id)).rejects.toThrow(/requested BGG ID 266192/);

      const persisted = (await storageService.loadCollection()).games[0];
      if (persisted === undefined) throw new Error("Expected persisted game");
      expect(persisted.bggId).toBe(before.bggId);
      expect(persisted.name).toBe(before.name);
      expect(persisted.bggData).toEqual(before.bggData);
      for (const entityClass of ["mechanic", "designer", "artist"] as const) {
        const persistedMetadata = structuredClone(persisted.entityMetadata[entityClass]);
        expect(persistedMetadata.refreshFailure?.attemptedAt).toBe(failedAt);
        expect(persistedMetadata.refreshFailure?.message).toContain("requested BGG ID 266192");
        persistedMetadata.refreshFailure = null;
        expect(persistedMetadata).toEqual(before.entityMetadata[entityClass]);
      }
    });

    test("persists only the requested item when an unrelated item is returned first", async () => {
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const { game } = await seedService.addGame({ name: "Original", bggId: 266192 });
      const multiItemFetch = createMockFetch();
      multiItemFetch.enqueue(200, completeThingXmlForService([174430, 266192]));
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: createBggClient({
          config: { bggAuthToken: "test-token", username: null },
          fetchFn: multiItemFetch.fn,
          delayMs: 0,
          delayFn: () => Promise.resolve(),
          now: () => observedAt,
        }),
      });

      const { game: refreshed } = await service.refreshBggData(game.id);
      const persisted = (await storageService.loadCollection()).games[0];

      expect(refreshed.bggId).toBe(266192);
      expect(refreshed.name).toBe("Unexpected Game 266192");
      expect(refreshed.entityMetadata.mechanic.entities).toEqual([
        { id: 266192, name: "Mechanic 266192" },
      ]);
      expect(persisted).toEqual(refreshed);
    });

    test("persists valid thing metadata without ambiguous secondary play evidence", async () => {
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const { game } = await seedService.addGame({
        name: "Original",
        bggId: 266192,
        numPlays: 4,
      });
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const collectionXml = `<items>
        <item objectid="266192"><name>Wingspan</name><numplays>12</numplays></item>
        <item objectid="266192"><name>Wingspan</name><numplays>99</numplays></item>
      </items>`;
      const fetch = createMockFetch();
      fetch.enqueue(200, thingXml);
      fetch.enqueue(200, collectionXml);
      const clientLogs: unknown[][] = [];
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: createBggClient({
          config: { bggAuthToken: "test-token", username: "testuser" },
          fetchFn: fetch.fn,
          delayMs: 0,
          delayFn: () => Promise.resolve(),
          now: () => observedAt,
          logger: {
            log: (...args: unknown[]) => clientLogs.push(args),
            warn: (...args: unknown[]) => clientLogs.push(args),
            error: (...args: unknown[]) => clientLogs.push(args),
          },
        }),
      });

      const { game: refreshed } = await service.refreshBggData(game.id);
      const persisted = (await storageService.loadCollection()).games[0];

      expect(refreshed.name).toBe("Wingspan");
      expect(refreshed.bggData?.communityRating).toBe(8.00153);
      expect(refreshed.entityMetadata.mechanic.state).toBe("complete");
      expect(refreshed.entityMetadata.designer.entities.length).toBeGreaterThan(0);
      expect(refreshed.entityMetadata.artist.entities.length).toBeGreaterThan(0);
      expect(refreshed.numPlays).toBe(4);
      expect(refreshed.playCountEvidence).toEqual(game.playCountEvidence);
      expect(
        Object.values(refreshed.entityMetadata).every(
          ({ refreshFailure }) => refreshFailure === null,
        ),
      ).toBe(true);
      expect(persisted).toEqual(refreshed);
      const collectionOutcome = clientLogs.find(
        ([message]) => message === "collection fetch outcome",
      )?.[1];
      expect(collectionOutcome).toEqual(
        expect.objectContaining({
          bggIds: [266192],
          returnedBggIds: [266192, 266192],
          fieldsReturned: ["numPlays"],
          state: "failure",
          error:
            "BGG collection response was ambiguous for requested BGG ID 266192; returned 2 matching items",
          failures: {
            266192:
              "BGG collection response was ambiguous for requested BGG ID 266192; returned 2 matching items",
          },
        }),
      );
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
      const { game: refreshed } = await gameService.refreshBggData(game.id);

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
      expect(
        Object.values(refreshed.entityMetadata).every(({ state }) => state === "complete"),
      ).toBe(true);
    });

    test("preserves complete metadata and records exact all-class failure provenance", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const failureAt = "2026-08-26T11:00:00.000Z";
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([parsed]),
          getGame: (() => {
            let request = 0;
            return () =>
              request++ === 0
                ? Promise.resolve(parsed)
                : Promise.reject(new Error("BGG maintenance window"));
          })(),
        },
        now: () => failureAt,
      });
      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });
      const before = structuredClone(game.entityMetadata);

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.refreshBggData(game.id)).rejects.toThrow("BGG maintenance window");
      const persisted = (await storageService.loadCollection()).games[0];
      if (persisted === undefined) throw new Error("Expected persisted game");
      for (const entityClass of ["mechanic", "designer", "artist"] as const) {
        if (before[entityClass].state !== "complete") {
          throw new Error(`Expected complete ${entityClass} metadata`);
        }
        expect(persisted.entityMetadata[entityClass]).toEqual({
          ...before[entityClass],
          refreshFailure: { attemptedAt: failureAt, message: "BGG maintenance window" },
        });
      }
    });

    test("keeps migrated refresh-needed metadata ineligible after refresh failure", async () => {
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const { game } = await seed.addGame({ name: "Migrated Game", bggId: 42 });
      const failureAt = "2026-08-26T11:00:00.000Z";
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: () => Promise.reject(new Error("still unavailable")),
        },
        now: () => failureAt,
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.refreshBggData(game.id)).rejects.toThrow("still unavailable");
      const persisted = (await storageService.loadCollection()).games[0];
      if (persisted === undefined) throw new Error("Expected persisted game");
      for (const metadata of Object.values(persisted.entityMetadata)) {
        expect(metadata.state).toBe("refresh-needed");
        expect(metadata.entities).toEqual([]);
        expect(metadata.refreshFailure).toEqual({
          attemptedAt: failureAt,
          message: "still unavailable",
        });
      }
    });

    test("does not expire complete entity metadata when the injected clock advances", async () => {
      const parsed = parseThingItems(
        await readFixture("thing-wingspan-266192.xml"),
        "2020-01-01T00:00:00.000Z",
      )[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([parsed]),
        now: () => "2099-01-01T00:00:00.000Z",
      });

      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });
      await service.getGame(game.id);

      expect((await storageService.loadCollection()).games[0]?.entityMetadata).toEqual(
        parsed.entityMetadata,
      );
    });

    test("throws for manual game without bggId", async () => {
      const { game } = await gameService.addGame({ name: "Manual Game" });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.refreshBggData(game.id)).rejects.toThrow("no BGG ID");
    });

    test("records a successful missing play check while retaining other omitted field evidence", async () => {
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
        entityMetadata: parsed.entityMetadata,
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
        getPlayCount: () => Promise.reject(new Error("not implemented")),
      };
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: omittedClient,
      });

      const { game: refreshed } = await service.refreshBggData(game.id);

      expect(refreshed.playCountEvidence).toEqual({
        status: "missing",
        source: "bgg-collection",
        observedAt: "2026-08-26T11:05:00.000Z",
      });
      expect(refreshed.latestPlayCountCheck).toEqual({
        status: "missing",
        observedAt: "2026-08-26T11:05:00.000Z",
      });
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

      const { game: refreshed } = await service.refreshBggData(game.id);

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

      const { game: refreshed } = await service.refreshBggData(game.id);

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

      const { game: invalid } = await service.refreshBggData(game.id);

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
      expect((await service.refreshBggData(game.id)).game).toMatchObject({
        numPlays: 9,
        playCountEvidence: { status: "valid", value: 9, observedAt: correctedAt },
      });
    });

    test("retains prior valid evidence through invalid check and auto-completes only on later valid increase", async () => {
      const thingXml = await readFixture("thing-wingspan-266192.xml");
      const parsed = parseThingItems(thingXml, observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const baselineAt = "2026-08-26T10:05:00.000Z";
      const invalidAt = "2026-08-26T11:05:00.000Z";
      const increaseAt = "2026-08-26T12:05:00.000Z";
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([
          withCollectionPlayCount(parsed, 4, baselineAt),
          withCollectionPlayCount(parsed, Number.MAX_SAFE_INTEGER + 1, invalidAt),
          withCollectionPlayCount(parsed, 5, increaseAt),
        ]),
      });
      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });
      const intentions = createIntentionService({
        collectionMutationService: collectionMutationServiceFor(storageService),
        createId: () => "bgg-intention",
        now: () => "2026-08-26T10:10:00.000Z",
      });
      expect(
        await intentions.execute({
          type: "create",
          commandId: "30000000-0000-4000-8000-000000000001",
          gameId: game.id,
          kind: "replay",
          expectedActiveIntention: "absent",
        }),
      ).toMatchObject({ ok: true, intention: { baseline: { playCount: 4 } } });

      const { game: invalid } = await service.refreshBggData(game.id);
      expect(invalid.playCountEvidence).toMatchObject({
        status: "valid",
        value: 4,
        observedAt: baselineAt,
      });
      expect(invalid.latestPlayCountCheck).toEqual({
        status: "invalid",
        observedAt: invalidAt,
        evidence: { presence: "present", value: Number.MAX_SAFE_INTEGER + 1 },
      });
      expect((await storageService.loadCollection()).intentions[0]?.resolution).toBeNull();

      const increasedResult = await service.refreshBggData(game.id);
      const increased = increasedResult.game;
      expect(increased.latestPlayCountCheck).toEqual({
        status: "valid",
        value: 5,
        observedAt: increaseAt,
      });
      expect((await storageService.loadCollection()).intentions[0]?.resolution).toMatchObject({
        outcome: "completed",
        source: "observed-play-increase",
      });
      expect(increasedResult.linkedIntentionTransition).toEqual(
        (await storageService.loadCollection()).intentions[0],
      );
    });

    test("applies only strictly newer BGG checks across the valid, missing, and invalid matrix", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const baselineAt = "2026-08-26T10:05:00.000Z";
      const times = {
        older: "2026-08-26T10:04:59.999Z",
        equal: baselineAt,
        newer: "2026-08-26T10:05:00.001Z",
      } as const;

      for (const status of ["valid", "missing", "invalid"] as const) {
        for (const relation of ["older", "equal", "newer"] as const) {
          const playObservedAt = times[relation];
          const checked: BggGameResult =
            status === "valid"
              ? withCollectionPlayCount(parsed, 5, playObservedAt)
              : {
                  ...structuredClone(parsed),
                  collectionData: {
                    numPlays: status === "missing" ? null : Number.MAX_SAFE_INTEGER + 1,
                    observation: {
                      sourceRequest: "bgg-collection",
                      observedAt: playObservedAt,
                      state: status === "missing" ? "absent" : "complete",
                      fieldsReturned: status === "missing" ? [] : ["numPlays"],
                    },
                  },
                };
          const caseStorage = createStorageService({
            dataDir: `/matrix-${status}-${relation}`,
            configPath: "/config/config.json",
            fileOps: createMockFileOps(),
          });
          const service = createGameService({
            storageService: caseStorage,
            fitnessService: createFitnessService(),
            bggClient: clientForResults([withCollectionPlayCount(parsed, 4, baselineAt), checked]),
            now: () => "2026-08-26T11:00:00.000Z",
          });
          const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });
          const intentions = createIntentionService({
            collectionMutationService: collectionMutationServiceFor(caseStorage),
            createId: () => `matrix-${status}-${relation}`,
            now: () => "2026-08-26T10:06:00.000Z",
          });
          await intentions.execute({
            type: "create",
            commandId: `30000000-0000-4000-8000-0000000000${
              status === "valid" ? "10" : status === "missing" ? "11" : "12"
            }`,
            gameId: game.id,
            kind: "replay",
            expectedActiveIntention: "absent",
          });

          const result = await service.refreshBggData(game.id);
          const persisted = await caseStorage.loadCollection();
          if (relation !== "newer") {
            expect(result.game.latestPlayCountCheck, `${status}:${relation}`).toEqual({
              status: "valid",
              value: 4,
              observedAt: baselineAt,
            });
            expect(result.game.playCountEvidence).toMatchObject({ status: "valid", value: 4 });
            expect(result.linkedIntentionTransition).toBeNull();
            expect(persisted.intentions[0]?.resolution).toBeNull();
          } else if (status === "valid") {
            expect(result.game.latestPlayCountCheck).toEqual({
              status: "valid",
              value: 5,
              observedAt: playObservedAt,
            });
            expect(result.linkedIntentionTransition?.resolution).toMatchObject({
              outcome: "completed",
              source: "observed-play-increase",
            });
          } else {
            expect(result.game.latestPlayCountCheck?.status).toBe(status);
            expect(result.game.playCountEvidence).toMatchObject({ status: "valid", value: 4 });
            expect(isPlayEvidenceStale(result.game)).toBe(true);
            expect(result.linkedIntentionTransition).toBeNull();
            expect(persisted.intentions[0]?.resolution).toBeNull();
          }
        }
      }
    });

    test.each(["single", "batch"] as const)(
      "%s refresh logs and completes the intention present at serialized commit",
      async (mode) => {
        const parsed = parseThingItems(
          await readFixture("thing-wingspan-266192.xml"),
          observedAt,
        )[0];
        if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
        const baseline = withCollectionPlayCount(parsed, 0, "2026-08-26T10:05:00.000Z");
        const increase = withCollectionPlayCount(parsed, 1, "2026-08-26T11:05:00.000Z");
        let releaseNetwork = () => {};
        let signalNetwork = () => {};
        const networkStarted = new Promise<void>((resolve) => {
          signalNetwork = resolve;
        });
        const networkRelease = new Promise<void>((resolve) => {
          releaseNetwork = resolve;
        });
        let singularCalls = 0;
        const client: BggClient = {
          ...clientForResults([]),
          getGame: () =>
            singularCalls++ === 0 ? Promise.resolve(baseline) : networkRelease.then(() => increase),
          getGames: async (ids, onBatch) => {
            signalNetwork();
            await networkRelease;
            const results = new Map(ids.map((id) => [id, increase]));
            await onBatch?.({ batchIds: ids, results, failures: new Map() });
            return results;
          },
        };
        const entries: unknown[][] = [];
        const logger = {
          log: (...args: unknown[]) => entries.push(args),
          warn: (...args: unknown[]) => entries.push(args),
          error: (...args: unknown[]) => entries.push(args),
        };
        const coordinator = collectionMutationServiceFor(storageService);
        const service = createGameService({
          storageService,
          collectionMutationService: coordinator,
          fitnessService: createFitnessService(),
          bggClient: client,
          logger,
          now: () => "2026-08-26T12:00:00.000Z",
        });
        const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });
        let intentionNumber = 0;
        const intentions = createIntentionService({
          collectionMutationService: coordinator,
          createId: () => `race-intention-${++intentionNumber}`,
          now: () => "2026-08-26T10:10:00.000Z",
        });
        const old = await intentions.execute({
          type: "create",
          commandId: "30000000-0000-4000-8000-000000000020",
          gameId: game.id,
          kind: "first-play",
          expectedActiveIntention: "absent",
        });
        if (!old.ok) throw new Error(old.error.code);

        if (mode === "single") {
          client.getGame = () => {
            signalNetwork();
            return networkRelease.then(() => increase);
          };
        }
        const refresh =
          mode === "single" ? service.refreshBggData(game.id) : service.refreshAllBggData();
        await networkStarted;
        await intentions.execute({
          type: "retire",
          commandId: "30000000-0000-4000-8000-000000000021",
          gameId: game.id,
          intentionId: old.intention.intentionId,
          expectedVersion: 1,
        });
        const current = await intentions.execute({
          type: "create",
          commandId: "30000000-0000-4000-8000-000000000022",
          gameId: game.id,
          kind: "first-play",
          expectedActiveIntention: "absent",
        });
        if (!current.ok) throw new Error(current.error.code);
        releaseNetwork();
        await refresh;

        const persisted = await storageService.loadCollection();
        expect(
          persisted.intentions.find(
            ({ intentionId }) => intentionId === current.intention.intentionId,
          )?.resolution,
        ).toMatchObject({ outcome: "completed", source: "observed-play-increase" });
        const outcomes = entries.filter(
          ([message]) => message === "automatic intention transition outcome",
        );
        expect(outcomes).toContainEqual([
          "automatic intention transition outcome",
          expect.objectContaining({
            intentionId: current.intention.intentionId,
            priorState: "active",
            priorVersion: 1,
            result: "completed",
            version: 2,
            persisted: true,
          }),
        ]);
        expect(outcomes).not.toContainEqual([
          "automatic intention transition outcome",
          expect.objectContaining({ intentionId: old.intention.intentionId }),
        ]);
      },
    );

    test("newer successful missing check keeps intention active and network failure advances no play state", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const baselineAt = "2026-08-26T10:05:00.000Z";
      const missingAt = "2026-08-26T11:05:00.000Z";
      const missing: BggGameResult = {
        ...structuredClone(parsed),
        collectionData: {
          numPlays: null,
          observation: {
            sourceRequest: "bgg-collection",
            observedAt: missingAt,
            state: "absent",
            fieldsReturned: [],
          },
        },
      };
      const entries: unknown[][] = [];
      const logger = {
        log: (...args: unknown[]) => entries.push(args),
        warn: (...args: unknown[]) => entries.push(args),
        error: (...args: unknown[]) => entries.push(args),
      };
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([withCollectionPlayCount(parsed, 4, baselineAt), missing]),
        logger,
      });
      const { game } = await service.addGame({ name: "Wingspan", bggId: 266192 });
      const intentions = createIntentionService({
        collectionMutationService: collectionMutationServiceFor(storageService),
        createId: () => "missing-check-intention",
        now: () => "2026-08-26T10:10:00.000Z",
      });
      expect(
        await intentions.execute({
          type: "create",
          commandId: "30000000-0000-4000-8000-000000000009",
          gameId: game.id,
          kind: "replay",
          expectedActiveIntention: "absent",
        }),
      ).toMatchObject({ ok: true });

      const missingResult = await service.refreshBggData(game.id);
      expect(missingResult.linkedIntentionTransition).toBeNull();
      expect(missingResult.game.playCountEvidence).toMatchObject({
        status: "valid",
        value: 4,
        observedAt: baselineAt,
      });
      expect(missingResult.game.latestPlayCountCheck).toEqual({
        status: "missing",
        observedAt: missingAt,
      });
      expect(isPlayEvidenceStale(missingResult.game)).toBe(true);
      const beforeFailure = await storageService.loadCollection();

      const failing = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: () => Promise.reject(new Error("BGG network unavailable")),
        },
        logger,
        now: () => "2026-08-26T12:05:00.000Z",
      });
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(failing.refreshBggData(game.id)).rejects.toThrow("BGG network unavailable");
      const afterFailure = await storageService.loadCollection();
      expect(afterFailure.games[0]?.latestPlayCountCheck).toEqual(
        beforeFailure.games[0]?.latestPlayCountCheck,
      );
      expect(afterFailure.games[0]?.playCountEvidence).toEqual(
        beforeFailure.games[0]?.playCountEvidence,
      );
      expect(afterFailure.intentions).toEqual(beforeFailure.intentions);

      const attempts = entries.filter(
        ([message]) => message === "automatic intention transition attempt",
      );
      const outcomes = entries.filter(
        ([message]) => message === "automatic intention transition outcome",
      );
      expect(attempts).toHaveLength(2);
      expect(outcomes).toHaveLength(2);
      expect(outcomes.map(([, fields]) => fields)).toEqual([
        expect.objectContaining({
          trigger: "bgg-play-check",
          gameId: game.id,
          intentionId: "missing-check-intention",
          priorState: "active",
          priorVersion: 1,
          result: "unchanged",
          persisted: true,
        }),
        expect.objectContaining({
          trigger: "bgg-play-check",
          gameId: game.id,
          intentionId: "missing-check-intention",
          priorState: "active",
          priorVersion: 1,
          result: "evidence-unavailable",
          persisted: true,
        }),
      ]);
      expect(JSON.stringify(entries)).not.toContain("description");
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

      const { game: refreshed } = await service.refreshBggData(game.id);

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

    test("preserves prior play evidence when related play retrieval fails", async () => {
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const game = (await seedService.addGame({ name: "Wingspan", bggId: 266192, numPlays: 4 }))
        .game;
      await seedService.setAdditionalBggIds(game.id, [999001]);
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const failingClient: BggClient = {
        ...clientForResults([parsed]),
        getPlayCount: () => Promise.reject(new Error("related plays failed")),
      };
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: failingClient,
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.refreshBggData(game.id)).rejects.toThrow("related plays failed");
      const stored = (await storageService.loadCollection()).games[0];
      expect(stored?.numPlays).toBe(4);
      expect(stored?.playCountEvidence).toMatchObject({
        status: "valid",
        value: 4,
        source: "manual",
      });
    });
  });

  describe("refreshAllBggData", () => {
    test("aggregates related-entry plays during batch refresh", async () => {
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const game = (await seedService.addGame({ name: "Wingspan", bggId: 266192 })).game;
      await seedService.setAdditionalBggIds(game.id, [999001]);
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const requestedPlayIds: number[][] = [];
      const client: BggClient = {
        ...clientForResults([parsed]),
        getPlayCount: (bggIds) => {
          requestedPlayIds.push(bggIds);
          return Promise.resolve({
            numPlays: 9,
            observation: {
              sourceRequest: "bgg-plays",
              observedAt: "2026-08-26T13:00:00.000Z",
              state: "complete",
              fieldsReturned: ["numPlays"],
            },
          });
        },
      };
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: client,
      });

      const summary = await service.refreshAllBggData();

      expect(summary).toEqual({ refreshed: 1, errors: [] });
      expect(requestedPlayIds).toEqual([[266192, 999001]]);
      expect((await storageService.loadCollection()).games[0]?.playCountEvidence).toMatchObject({
        status: "valid",
        value: 9,
        source: "bgg-plays",
      });
    });

    test("reports related-entry failure without replacing batch play evidence", async () => {
      const seedService = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const game = (await seedService.addGame({ name: "Wingspan", bggId: 266192, numPlays: 4 }))
        .game;
      await seedService.setAdditionalBggIds(game.id, [999001]);
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const client: BggClient = {
        ...clientForResults([parsed]),
        getPlayCount: () => Promise.reject(new Error("related plays failed")),
      };
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: client,
      });

      const summary = await service.refreshAllBggData();

      expect(summary.errors).toEqual(['Play import failed for "Wingspan": related plays failed']);
      const stored = (await storageService.loadCollection()).games[0];
      expect(stored?.numPlays).toBe(4);
      expect(stored?.playCountEvidence).toMatchObject({
        status: "valid",
        value: 4,
        source: "manual",
      });
    });

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
      const revisionBeforeRefresh = (await storageService.loadCollection()).revision;

      const summary = await gameService.refreshAllBggData();

      expect(summary.refreshed).toBe(2);
      expect(summary.errors).toHaveLength(0);
      const refreshedCollection = await storageService.loadCollection();
      expect(refreshedCollection.revision).toBe(revisionBeforeRefresh + 1);
      for (const game of refreshedCollection.games.filter(({ bggId }) => bggId !== null)) {
        expect(Object.values(game.entityMetadata).every(({ state }) => state === "complete")).toBe(
          true,
        );
      }
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
      const automaticAttempts = logs.filter(
        ([message]) => message === "automatic intention transition attempt",
      );
      const automaticOutcomes = logs.filter(
        ([message]) => message === "automatic intention transition outcome",
      );
      expect(automaticAttempts).toHaveLength(2);
      expect(automaticOutcomes).toHaveLength(2);
      for (const [, fields] of [...automaticAttempts, ...automaticOutcomes]) {
        expect(fields).toMatchObject({
          trigger: "bgg-play-check-batch",
          intentionId: null,
          priorState: "none",
          priorVersion: null,
        });
        expect(fields).not.toHaveProperty("name");
        expect(fields).not.toHaveProperty("bggData");
      }
    });

    test("logs exact per-game outcomes for a mixed coordinated batch", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        now: () => "2026-08-26T08:00:00.000Z",
      });
      const completed = (await seed.addGame({ name: "Completed", bggId: 1, numPlays: 0 })).game;
      const unchanged = (await seed.addGame({ name: "Unchanged", bggId: 2, numPlays: 2 })).game;
      const unavailable = (await seed.addGame({ name: "Unavailable", bggId: 3, numPlays: 4 })).game;
      const superseded = (await seed.addGame({ name: "Superseded", bggId: 4, numPlays: 3 })).game;
      const removed = (await seed.addGame({ name: "Removed", bggId: 5 })).game;
      const intentionIds = [
        "completed-intention",
        "unchanged-intention",
        "unavailable-intention",
        "superseded-intention",
      ];
      let nextIntentionId = 0;
      const intentions = createIntentionService({
        collectionMutationService: collectionMutationServiceFor(storageService),
        createId: () => intentionIds[nextIntentionId++] ?? "unexpected-intention",
        now: () => "2026-08-26T09:00:00.000Z",
      });
      for (const [index, game] of [completed, unchanged, unavailable, superseded].entries()) {
        const created = await intentions.execute({
          type: "create",
          commandId: `50000000-0000-4000-8000-00000000000${index + 1}`,
          gameId: game.id,
          kind: game.numPlays === 0 ? "first-play" : "replay",
          expectedActiveIntention: "absent",
        });
        if (!created.ok) throw new Error(created.error.code);
      }

      function resultFor(bggId: number, numPlays: number): BggGameResult {
        const result = withCollectionPlayCount(parsed, numPlays);
        result.metadata.bggId = bggId;
        result.metadata.name = `Refreshed ${bggId}`;
        return result;
      }

      let signalBatchStarted = () => {};
      const batchStarted = new Promise<void>((resolve) => {
        signalBatchStarted = resolve;
      });
      let releaseBatch = () => {};
      const batchRelease = new Promise<void>((resolve) => {
        releaseBatch = resolve;
      });
      const entries: unknown[][] = [];
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: () => Promise.resolve(resultFor(4, 4)),
          getGames: async (ids, onBatch) => {
            signalBatchStarted();
            await batchRelease;
            const results = new Map<number, BggGameResult>([
              [1, resultFor(1, 1)],
              [2, resultFor(2, 2)],
              [4, resultFor(4, 9)],
              [5, resultFor(5, 1)],
            ]);
            const failures = new Map([[3, "per-game BGG failure"]]);
            await onBatch?.({ batchIds: ids, results, failures });
            return results;
          },
        },
        logger: {
          log: (...args: unknown[]) => entries.push(args),
          warn: (...args: unknown[]) => entries.push(args),
          error: (...args: unknown[]) => entries.push(args),
        },
        now: () => observedAt,
      });

      const batch = service.refreshAllBggData();
      await batchStarted;
      expect((await service.refreshBggData(superseded.id)).linkedIntentionTransition).toMatchObject(
        {
          intentionId: "superseded-intention",
          version: 2,
          resolution: { outcome: "completed" },
        },
      );
      await seed.removeGame(removed.id);
      releaseBatch();

      const summary = await batch;
      expect(summary.refreshed).toBe(2);
      expect(summary.errors).toHaveLength(3);
      const attempts = entries
        .filter(([message]) => message === "automatic intention transition attempt")
        .map(([, fields]) => fields)
        .filter(
          (fields): fields is Record<string, unknown> =>
            typeof fields === "object" &&
            fields !== null &&
            "trigger" in fields &&
            fields.trigger === "bgg-play-check-batch",
        );
      const outcomes = entries
        .filter(([message]) => message === "automatic intention transition outcome")
        .map(([, fields]) => fields)
        .filter(
          (fields): fields is Record<string, unknown> =>
            typeof fields === "object" &&
            fields !== null &&
            "trigger" in fields &&
            fields.trigger === "bgg-play-check-batch",
        );
      const expectedAttempts = [
        {
          trigger: "bgg-play-check-batch",
          gameId: completed.id,
          intentionId: "completed-intention",
          priorState: "active",
          priorVersion: 1,
        },
        {
          trigger: "bgg-play-check-batch",
          gameId: unchanged.id,
          intentionId: "unchanged-intention",
          priorState: "active",
          priorVersion: 1,
        },
        {
          trigger: "bgg-play-check-batch",
          gameId: unavailable.id,
          intentionId: "unavailable-intention",
          priorState: "active",
          priorVersion: 1,
        },
        {
          trigger: "bgg-play-check-batch",
          gameId: superseded.id,
          intentionId: null,
          priorState: "none",
          priorVersion: null,
        },
        {
          trigger: "bgg-play-check-batch",
          gameId: removed.id,
          intentionId: null,
          priorState: "none",
          priorVersion: null,
        },
      ] as const;
      expect(attempts).toEqual([...expectedAttempts]);
      expect(outcomes).toEqual([
        { ...expectedAttempts[0], result: "completed", version: 2, persisted: true },
        { ...expectedAttempts[1], result: "unchanged", version: 1, persisted: true },
        { ...expectedAttempts[2], result: "evidence-unavailable", version: 1, persisted: true },
        { ...expectedAttempts[3], result: "superseded", version: null, persisted: false },
        { ...expectedAttempts[4], result: "game-removed", version: null, persisted: false },
      ]);
      expect(JSON.stringify([...attempts, ...outcomes])).not.toContain("Refreshed");
    });

    test("preserves exact metadata state and parser provenance when a batch fails", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([parsed]),
      });
      const complete = (await seed.addGame({ name: "Wingspan", bggId: 266192 })).game;
      const refreshNeeded = (await seed.addGame({ name: "Migrated Game", bggId: 42 })).game;
      const completeBefore = structuredClone(complete.entityMetadata);
      const refreshNeededBefore = structuredClone(refreshNeeded.entityMetadata);
      const failureAt = "2026-08-26T11:00:00.000Z";
      const failureMessage = "Malformed BGG thing response: missing root <items> element";
      const failedFetch = createMockFetch();
      failedFetch.enqueue(200, "<<<not xml at all>>>");
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: createBggClient({
          config: { bggAuthToken: "test-token", username: null },
          fetchFn: failedFetch.fn,
          delayMs: 0,
          delayFn: () => Promise.resolve(),
          now: () => failureAt,
        }),
        now: () => failureAt,
      });

      const summary = await service.refreshAllBggData();

      expect(summary.refreshed).toBe(0);
      expect(summary.errors).toEqual([
        `Batch fetch failed for "Wingspan" (BGG ID 266192): ${failureMessage}`,
        `Batch fetch failed for "Migrated Game" (BGG ID 42): ${failureMessage}`,
      ]);
      const persisted = await storageService.loadCollection();
      const persistedComplete = persisted.games.find(({ id }) => id === complete.id);
      const persistedRefreshNeeded = persisted.games.find(({ id }) => id === refreshNeeded.id);
      if (persistedComplete === undefined || persistedRefreshNeeded === undefined) {
        throw new Error("Expected both refreshed games to remain persisted");
      }
      for (const entityClass of ["mechanic", "designer", "artist"] as const) {
        if (completeBefore[entityClass].state !== "complete") {
          throw new Error(`Expected complete ${entityClass} metadata before batch refresh`);
        }
        if (refreshNeededBefore[entityClass].state !== "refresh-needed") {
          throw new Error(`Expected refresh-needed ${entityClass} metadata before batch refresh`);
        }
        expect(persistedComplete.entityMetadata[entityClass]).toEqual({
          ...completeBefore[entityClass],
          refreshFailure: { attemptedAt: failureAt, message: failureMessage },
        });
        expect(persistedRefreshNeeded.entityMetadata[entityClass]).toEqual({
          ...refreshNeededBefore[entityClass],
          refreshFailure: { attemptedAt: failureAt, message: failureMessage },
        });
        expect(persistedRefreshNeeded.entityMetadata[entityClass].state).toBe("refresh-needed");
      }
    });

    test("restores success generations when a batch-refresh save fails", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      await seed.addGame({ name: "Original", bggId: 266192 });
      const before = await storageService.loadCollection();
      const failedAt = "2026-08-26T11:00:00.000Z";
      let request = 0;
      const entries: unknown[][] = [];
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGames: async (ids, onBatch) => {
            if (request++ === 0) {
              const results = new Map(ids.map((id) => [id, structuredClone(parsed)]));
              await onBatch?.({ batchIds: ids, results, failures: new Map() });
              return results;
            }
            const error = "later legitimate batch failure";
            await onBatch?.({ batchIds: ids, results: new Map(), failures: new Map(), error });
            return new Map();
          },
        },
        now: () => failedAt,
        logger: {
          log: (...args: unknown[]) => entries.push(args),
          warn: (...args: unknown[]) => entries.push(args),
          error: (...args: unknown[]) => entries.push(args),
        },
      });
      const saveCollection = storageService.saveCollection.bind(storageService);
      let saveAttempt = 0;
      storageService.saveCollection = (collection) => {
        if (saveAttempt++ === 0) return Promise.reject(new Error("batch success save failed"));
        return saveCollection(collection);
      };

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.refreshAllBggData()).rejects.toThrow("batch success save failed");
      expect(await storageService.loadCollection()).toEqual(before);
      expect(
        entries
          .filter(([message]) => message === "automatic intention transition outcome")
          .map(([, fields]) => fields),
      ).toEqual([
        {
          trigger: "bgg-play-check-batch",
          gameId: before.games[0]?.id,
          intentionId: null,
          priorState: "none",
          priorVersion: null,
          result: "mutation-failed",
          version: null,
          persisted: false,
        },
      ]);

      expect(await service.refreshAllBggData()).toEqual({
        refreshed: 0,
        errors: [
          'Batch fetch failed for "Original" (BGG ID 266192): later legitimate batch failure',
        ],
      });
      const persisted = (await storageService.loadCollection()).games[0];
      expect(persisted?.name).toBe("Original");
      for (const metadata of Object.values(persisted?.entityMetadata ?? {})) {
        expect(metadata.refreshFailure).toEqual({
          attemptedAt: failedAt,
          message: "later legitimate batch failure",
        });
      }
    });

    test("persists a same-game failure captured while a batch success save is pending and then fails", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const { game } = await seed.addGame({ name: "Original", bggId: 266192 });
      const gate = failFirstGatedSave(
        storageService,
        await storageService.loadCollection(),
        "batch success save failed",
      );
      const failedAt = "2026-08-26T11:00:00.000Z";
      const service = createGameService({
        storageService: gate.storage,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGames: async (ids, onBatch) => {
            const results = new Map(ids.map((id) => [id, structuredClone(parsed)]));
            await onBatch?.({ batchIds: ids, results, failures: new Map() });
            return results;
          },
          getGame: () => Promise.reject(new Error("exact concurrent failure")),
        },
        now: () => failedAt,
      });
      const batchSuccess = service.refreshAllBggData();
      await gate.saveStarted;
      const concurrentFailure = service.refreshBggData(game.id);
      void concurrentFailure.catch(() => undefined);
      gate.releaseSave();

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(batchSuccess).rejects.toThrow("batch success save failed");
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(concurrentFailure).rejects.toThrow("exact concurrent failure");
      const persisted = gate.stored().games[0];
      expect(persisted?.name).toBe("Original");
      for (const metadata of Object.values(persisted?.entityMetadata ?? {})) {
        expect(metadata.refreshFailure).toEqual({
          attemptedAt: failedAt,
          message: "exact concurrent failure",
        });
      }
    });

    test("persists only valid requested siblings from a mixed batch response", async () => {
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const first = (await seed.addGame({ name: "First original", bggId: 1 })).game;
      const second = (await seed.addGame({ name: "Second original", bggId: 2 })).game;
      const third = (await seed.addGame({ name: "Third original", bggId: 3 })).game;
      const batchFetch = createMockFetch();
      batchFetch.enqueue(200, completeThingXmlForService([1, 2, 2, 999]));
      const failedAt = "2026-08-26T11:00:00.000Z";
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: createBggClient({
          config: { bggAuthToken: "test-token", username: null },
          fetchFn: batchFetch.fn,
          delayMs: 0,
          delayFn: () => Promise.resolve(),
          now: () => failedAt,
        }),
        now: () => failedAt,
      });

      const summary = await service.refreshAllBggData();
      const persisted = await storageService.loadCollection();

      expect(summary.refreshed).toBe(1);
      expect(summary.errors).toEqual([
        'Batch fetch failed for "Second original" (BGG ID 2): BGG thing response was ambiguous for requested BGG ID 2; returned 2 matching items',
        'Batch fetch failed for "Third original" (BGG ID 3): BGG thing response did not include requested BGG ID 3; returned BGG IDs: 1, 2, 2, 999',
      ]);
      expect(persisted.games).toHaveLength(3);
      expect(persisted.games.find(({ id }) => id === first.id)?.name).toBe("Unexpected Game 1");
      expect(persisted.games.find(({ id }) => id === second.id)?.name).toBe("Second original");
      expect(persisted.games.find(({ id }) => id === third.id)?.name).toBe("Third original");
      expect(persisted.games.some(({ bggId }) => bggId === 999)).toBe(false);
      expect(
        persisted.games.find(({ id }) => id === second.id)?.entityMetadata.mechanic.refreshFailure
          ?.message,
      ).toContain("ambiguous for requested BGG ID 2");
      expect(
        persisted.games.find(({ id }) => id === third.id)?.entityMetadata.mechanic.refreshFailure
          ?.message,
      ).toContain("did not include requested BGG ID 3");
    });

    test("preserves both games when concurrent single refreshes complete", async () => {
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
      });
      const first = (await seed.addGame({ name: "First", bggId: 1 })).game;
      const second = (await seed.addGame({ name: "Second", bggId: 2 })).game;
      const parsed = parseThingItems(await readFixture("thing-entity-links.xml"), observedAt);
      const firstResult = parsed[1];
      const secondResult = parsed[2];
      if (firstResult === undefined || secondResult === undefined) {
        throw new Error("Expected entity-link fixtures");
      }
      firstResult.metadata.bggId = 1;
      firstResult.metadata.name = "First refreshed";
      secondResult.metadata.bggId = 2;
      secondResult.metadata.name = "Second refreshed";
      const results = new Map<number, BggGameResult>([
        [1, firstResult],
        [2, secondResult],
      ]);
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: (bggId) => {
            const result = results.get(bggId);
            return result === undefined
              ? Promise.reject(new Error(`Missing BGG result ${bggId}`))
              : Promise.resolve(result);
          },
        },
      });
      const revisionBefore = (await storageService.loadCollection()).revision;

      await Promise.all([service.refreshBggData(first.id), service.refreshBggData(second.id)]);

      const collection = await storageService.loadCollection();
      expect(collection.revision).toBe(revisionBefore + 2);
      expect(
        collection.games.find(({ id }) => id === first.id)?.entityMetadata.mechanic.entities,
      ).toEqual(firstResult.entityMetadata.mechanic.entities);
      expect(
        collection.games.find(({ id }) => id === second.id)?.entityMetadata.mechanic.entities,
      ).toEqual(secondResult.entityMetadata.mechanic.entities);
    });

    test("batch success prevents an earlier single-refresh failure from attaching provenance", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([parsed]),
      });
      const { game } = await seed.addGame({ name: "Wingspan", bggId: 266192 });
      let rejectFailure: (error: Error) => void = () => {};
      const failureResult = new Promise<BggGameResult>((_resolve, reject) => {
        rejectFailure = reject;
      });
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: () => failureResult,
          getGames: async (ids, onBatch) => {
            const results = new Map(ids.map((id) => [id, structuredClone(parsed)]));
            await onBatch?.({ batchIds: ids, results, failures: new Map() });
            return results;
          },
        },
        now: () => observedAt,
      });

      const failingRefresh = service.refreshBggData(game.id);
      expect(await service.refreshAllBggData()).toEqual({ refreshed: 1, errors: [] });
      rejectFailure(new Error("late single-refresh failure"));
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(failingRefresh).rejects.toThrow("late single-refresh failure");

      expect((await storageService.loadCollection()).games[0]?.entityMetadata).toEqual(
        parsed.entityMetadata,
      );
    });

    test("successful refresh of another game does not suppress failure provenance", async () => {
      const parsed = parseThingItems(await readFixture("thing-entity-links.xml"), observedAt);
      const firstResult = parsed[1];
      const secondResult = parsed[2];
      if (firstResult === undefined || secondResult === undefined) {
        throw new Error("Expected entity-link fixtures");
      }
      firstResult.metadata.bggId = 1;
      secondResult.metadata.bggId = 2;
      const seed = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults([]),
      });
      const first = (await seed.addGame({ name: "First", bggId: 1 })).game;
      const second = (await seed.addGame({ name: "Second", bggId: 2 })).game;
      let rejectFailure: (error: Error) => void = () => {};
      const failureResult = new Promise<BggGameResult>((_resolve, reject) => {
        rejectFailure = reject;
      });
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: {
          ...clientForResults([]),
          getGame: (bggId) => (bggId === 1 ? failureResult : Promise.resolve(secondResult)),
        },
        now: () => observedAt,
      });

      const failingRefresh = service.refreshBggData(first.id);
      expect((await service.refreshBggData(second.id)).game.bggId).toBe(2);
      rejectFailure(new Error("first game failed"));
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(failingRefresh).rejects.toThrow("first game failed");

      const persisted = await storageService.loadCollection();
      expect(
        persisted.games.find(({ id }) => id === first.id)?.entityMetadata.mechanic.refreshFailure,
      ).toEqual({ attemptedAt: observedAt, message: "first game failed" });
      expect(
        persisted.games.find(({ id }) => id === second.id)?.entityMetadata.mechanic.refreshFailure,
      ).toBeNull();
    });
  });

  describe("importBggCollection observations", () => {
    test("persists all entity classes from each imported thing response", async () => {
      const parsed = parseThingItems(await readFixture("thing-wingspan-266192.xml"), observedAt)[0];
      if (parsed === undefined) throw new Error("Expected Wingspan thing fixture");
      const service = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        bggClient: clientForResults(
          [parsed],
          [{ bggId: 266192, name: "Wingspan", yearPublished: 2019, numplays: 12 }],
        ),
      });
      const revisionBefore = (await storageService.loadCollection()).revision;

      expect(await service.importBggCollection()).toMatchObject({ imported: 1, errors: [] });
      const collection = await storageService.loadCollection();
      expect(collection.revision).toBe(revisionBefore + 1);
      expect(collection.games[0]?.entityMetadata).toEqual(parsed.entityMetadata);
    });

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
      expect((await service.refreshBggData(imported.id)).game).toMatchObject({
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
          entityMetadata: parsedThing.entityMetadata,
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
          getPlayCount: () => Promise.reject(new Error("not implemented")),
          getGames: async (ids, onBatch) => {
            const results = new Map([[266192, result]]);
            await onBatch?.({ batchIds: ids, results, failures: new Map() });
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
