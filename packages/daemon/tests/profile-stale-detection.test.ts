// Integration tests for Finding 3: verify that each mutation type sets
// collection.updatedAt to a current timestamp, which triggers profile recomputation.
//
// These use the real game/axis services with in-memory storage to verify the
// full mutation chain. The tests set collection.updatedAt to a known past value,
// perform the mutation, and verify the timestamp advanced.

import { describe, test, expect, beforeEach } from "bun:test";
import { createGameService } from "../src/services/game-service.js";
import { createAxisService } from "../src/services/axis-service.js";
import { createFitnessService } from "../src/services/fitness-service.js";
import { createStorageService } from "../src/services/storage-service.js";
import { createMockFileOps } from "./helpers/mock-file-ops.js";
import type { GameService } from "../src/services/game-service.js";
import type { AxisService } from "../src/services/axis-service.js";
import type { StorageService } from "../src/services/storage-service.js";

const KNOWN_PAST = "2020-01-01T00:00:00.000Z";

let storageService: StorageService;
let gameService: GameService;
let axisService: AxisService;

beforeEach(() => {
  const fileOps = createMockFileOps();
  storageService = createStorageService({
    dataDir: "/data",
    configPath: "/config/config.json",
    socketPath: "/tmp/test.sock",
    fileOps,
  });
  const fitnessService = createFitnessService();
  gameService = createGameService({ storageService, fitnessService });
  axisService = createAxisService({ storageService });
});

async function setCollectionTimestampToPast(): Promise<void> {
  const collection = await storageService.loadCollection();
  collection.updatedAt = KNOWN_PAST;
  await storageService.saveCollection(collection);
}

async function getCollectionUpdatedAt(): Promise<string> {
  const collection = await storageService.loadCollection();
  return collection.updatedAt;
}

describe("collection.updatedAt advances on mutations (profile stale detection)", () => {
  test("game add advances collection.updatedAt", async () => {
    await setCollectionTimestampToPast();
    await gameService.addGame({ name: "New Game" });
    const after = await getCollectionUpdatedAt();
    expect(after > KNOWN_PAST).toBe(true);
  });

  test("game remove advances collection.updatedAt", async () => {
    const { game } = await gameService.addGame({ name: "To Remove" });
    await setCollectionTimestampToPast();
    await gameService.removeGame(game.id);
    const after = await getCollectionUpdatedAt();
    expect(after > KNOWN_PAST).toBe(true);
  });

  test("rating change advances collection.updatedAt", async () => {
    const axis = await axisService.createAxis({ name: "Fun", weight: 50 });
    const { game } = await gameService.addGame({ name: "To Rate" });
    await setCollectionTimestampToPast();
    await gameService.rateGame(game.id, { [axis.id]: 7 });
    const after = await getCollectionUpdatedAt();
    expect(after > KNOWN_PAST).toBe(true);
  });

  test("axis create advances collection.updatedAt", async () => {
    await setCollectionTimestampToPast();
    await axisService.createAxis({ name: "Strategy", weight: 50 });
    const after = await getCollectionUpdatedAt();
    expect(after > KNOWN_PAST).toBe(true);
  });

  test("axis update advances collection.updatedAt", async () => {
    const axis = await axisService.createAxis({ name: "Art", weight: 50 });
    await setCollectionTimestampToPast();
    await axisService.updateAxis(axis.id, { weight: 75 });
    const after = await getCollectionUpdatedAt();
    expect(after > KNOWN_PAST).toBe(true);
  });

  test("axis delete advances collection.updatedAt", async () => {
    const axis = await axisService.createAxis({ name: "Temporary", weight: 50 });
    await setCollectionTimestampToPast();
    await axisService.deleteAxis(axis.id);
    const after = await getCollectionUpdatedAt();
    expect(after > KNOWN_PAST).toBe(true);
  });
});
