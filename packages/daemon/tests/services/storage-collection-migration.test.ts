import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CollectionSchema } from "@shelf-judge/shared";
import type { Collection } from "@shelf-judge/shared";
import {
  COLLECTION_ARTIFACTS,
  type CollectionArtifactDescriptor,
} from "../../src/services/collection-artifacts.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createFileOps } from "../../src/services/file-ops.js";
import type { Logger } from "../../src/services/logger.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

const DATA_DIR = "/test/data";
const COLLECTION_PATH = `${DATA_DIR}/collection.json`;
const PROFILE_PATH = `${DATA_DIR}/profile.json`;
const WISHLIST_PATH = `${DATA_DIR}/wishlist.json`;
const NOW = "2026-01-01T00:00:00.000Z";

const historicalCollection = {
  id: "collection-1",
  name: "Historical",
  axes: [],
  games: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const wishlist = [
  {
    id: "wish-1",
    bggId: 123,
    name: "Wanted",
    yearPublished: null,
    thumbnailUrl: null,
    predictedScore: 8,
    predictionConfidence: "strong",
    predictedBreakdown: [],
    nicheImpact: null,
    addedAt: NOW,
  },
];

function logger(): Logger & { entries: string[] } {
  const entries: string[] = [];
  return {
    entries,
    log: (...args) => entries.push(args.map(String).join(" ")),
    warn: (...args) => entries.push(args.map(String).join(" ")),
    error: (...args) => entries.push(args.map(String).join(" ")),
  };
}

function firstPredictedScore(rawText: string | undefined): unknown {
  if (rawText === undefined) return undefined;
  const parsed: unknown = JSON.parse(rawText);
  if (!Array.isArray(parsed)) return undefined;
  const first: unknown = parsed[0];
  if (typeof first !== "object" || first === null || !("predictedScore" in first)) return undefined;
  return first.predictedScore;
}

function makeService(artifacts: readonly CollectionArtifactDescriptor[] = COLLECTION_ARTIFACTS) {
  const original = JSON.stringify(historicalCollection);
  const fileOps = createMockFileOps({
    [COLLECTION_PATH]: original,
    [PROFILE_PATH]: "disposable profile",
    [WISHLIST_PATH]: JSON.stringify(wishlist),
  });
  const sink = logger();
  const service = createStorageService({
    dataDir: DATA_DIR,
    configPath: "/test/config.json",
    fileOps,
    logger: sink,
    collectionArtifacts: artifacts,
    collectionMigrationDependencies: {
      createId: () => "tournament-axis",
      now: () => "2026-08-24T00:00:00.000Z",
    },
  });
  return { service, fileOps, sink, original };
}

describe("storage collection migration ordering and recovery", () => {
  test("persists and idempotently reloads a migration through the real filesystem", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "shelf-judge-migration-"));
    const collectionPath = path.join(dataDir, "collection.json");
    const profilePath = path.join(dataDir, "profile.json");
    const wishlistPath = path.join(dataDir, "wishlist.json");

    try {
      await fs.writeFile(collectionPath, JSON.stringify(historicalCollection), "utf8");
      await fs.writeFile(profilePath, "disposable profile", "utf8");
      await fs.writeFile(wishlistPath, JSON.stringify(wishlist), "utf8");
      const service = createStorageService({
        dataDir,
        configPath: path.join(dataDir, "config.json"),
        fileOps: createFileOps(),
        logger: logger(),
        collectionMigrationDependencies: {
          createId: () => "real-filesystem-tournament-axis",
          now: () => "2026-08-25T00:00:00.000Z",
        },
      });

      const migrated = await service.loadCollection();
      const persistedAfterMigration = await fs.readFile(collectionPath, "utf8");
      expect(JSON.parse(persistedAfterMigration)).toEqual(migrated);
      expect(migrated.schemaVersion).toBe(2);
      expect(
        await fs.stat(profilePath).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(JSON.parse(await fs.readFile(wishlistPath, "utf8"))).toEqual([
        {
          ...wishlist[0],
          predictedScore: null,
          predictionConfidence: null,
          predictedBreakdown: null,
        },
      ]);

      expect(await service.loadCollection()).toEqual(migrated);
      expect(await fs.readFile(collectionPath, "utf8")).toBe(persistedAfterMigration);
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  test("logs collection read, parse, migration, and validation failures at their boundaries", async () => {
    const readFiles = createMockFileOps({ [COLLECTION_PATH]: "present" });
    readFiles.readFile = () => Promise.reject(new Error("injected read failure"));
    const readLog = logger();
    const readService = createStorageService({
      dataDir: DATA_DIR,
      configPath: "/test/config.json",
      fileOps: readFiles,
      logger: readLog,
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(readService.loadCollection()).rejects.toThrow("injected read failure");
    expect(readLog.entries.some((entry) => entry.includes("collection read failed"))).toBe(true);

    const parseLog = logger();
    const parseService = createStorageService({
      dataDir: DATA_DIR,
      configPath: "/test/config.json",
      fileOps: createMockFileOps({ [COLLECTION_PATH]: "invalid JSON" }),
      logger: parseLog,
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(parseService.loadCollection()).rejects.toThrow();
    expect(parseLog.entries.some((entry) => entry.includes("collection parse failed"))).toBe(true);

    const migrationLog = logger();
    const migrationService = createStorageService({
      dataDir: DATA_DIR,
      configPath: "/test/config.json",
      fileOps: createMockFileOps({
        [COLLECTION_PATH]: JSON.stringify({ ...historicalCollection, schemaVersion: 3 }),
      }),
      logger: migrationLog,
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(migrationService.loadCollection()).rejects.toThrow(
      "Unsupported collection schema version 3",
    );
    expect(
      migrationLog.entries.some((entry) => entry.includes("collection migration failed")),
    ).toBe(true);

    const validationLog = logger();
    const validationService = createStorageService({
      dataDir: DATA_DIR,
      configPath: "/test/config.json",
      fileOps: createMockFileOps(),
      logger: validationLog,
    });
    const invalidCurrent: Collection = {
      schemaVersion: 2,
      id: "collection-1",
      name: "",
      axes: [],
      games: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(validationService.saveCollection(invalidCurrent)).rejects.toThrow();
    expect(
      validationLog.entries.some((entry) => entry.includes("collection validation failed")),
    ).toBe(true);
  });

  test("runs an injected future descriptor in manifest order before collection persistence", async () => {
    const order: string[] = [];
    const wrapped = COLLECTION_ARTIFACTS.map((artifact) => ({
      ...artifact,
      async invalidate(context: Parameters<CollectionArtifactDescriptor["invalidate"]>[0]) {
        order.push(artifact.identity);
        await artifact.invalidate(context);
      },
    }));
    const future: CollectionArtifactDescriptor = {
      identity: "future-predictions",
      dependencyVersion: 1,
      path: (dataDir) => `${dataDir}/future.json`,
      async invalidate(context): Promise<void> {
        order.push("future-predictions");
        await context.fileOps.writeFile(`${context.dataDir}/future.invalidated`, "yes");
      },
    };
    const { service, fileOps } = makeService([...wrapped, future]);

    const collection = await service.loadCollection();

    expect(order).toEqual(["collection-profile", "wishlist-predictions", "future-predictions"]);
    expect(CollectionSchema.parse(collection)).toEqual(collection);
    const futureAttempt = fileOps.calls.findIndex(
      (call) => call.method === "writeFile" && call.args[0].endsWith("future.invalidated"),
    );
    const collectionPersistence = fileOps.calls.findIndex(
      (call) => call.method === "rename" && call.args[1] === COLLECTION_PATH,
    );
    expect(futureAttempt).toBeGreaterThan(-1);
    expect(futureAttempt).toBeLessThan(collectionPersistence);
    const temporaryClaims = fileOps.calls
      .filter((call) => call.method === "writeFileExclusive" && call.args[0].endsWith(".tmp"))
      .map((call) => call.args[0]);
    expect(temporaryClaims.some((claimedPath) => claimedPath.includes("wishlist.json"))).toBe(true);
    expect(temporaryClaims.some((claimedPath) => claimedPath.includes("collection.json"))).toBe(
      true,
    );
    expect(new Set(temporaryClaims).size).toBe(temporaryClaims.length);
  });

  test("does not invalidate any artifact for an already-current valid collection", async () => {
    const initial = makeService();
    const current = await initial.service.loadCollection();
    let invalidationCount = 0;
    const failIfCalled: CollectionArtifactDescriptor = {
      identity: "must-not-run",
      dependencyVersion: 1,
      path: (dataDir) => `${dataDir}/unused.json`,
      invalidate(): Promise<void> {
        invalidationCount += 1;
        return Promise.reject(new Error("current collection invalidated"));
      },
    };
    const fileOps = createMockFileOps({ [COLLECTION_PATH]: JSON.stringify(current) });
    const service = createStorageService({
      dataDir: DATA_DIR,
      configPath: "/test/config.json",
      fileOps,
      logger: logger(),
      collectionArtifacts: [failIfCalled],
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().resolves is thenable
    await expect(service.loadCollection()).resolves.toEqual(current);
    expect(invalidationCount).toBe(0);
    expect(fileOps.calls.filter((call) => call.method === "writeFileExclusive")).toHaveLength(0);
  });

  test("invalidates collection-derived artifacts when loading a v1 collection", async () => {
    const v1 = { ...historicalCollection, schemaVersion: 1 };
    const invalidated: string[] = [];
    const artifacts: CollectionArtifactDescriptor[] = [
      {
        identity: "v1-derived-artifact",
        dependencyVersion: 2,
        path: (dataDir) => `${dataDir}/derived.json`,
        invalidate(): Promise<void> {
          invalidated.push("v1-derived-artifact");
          return Promise.resolve();
        },
      },
    ];
    const fileOps = createMockFileOps({ [COLLECTION_PATH]: JSON.stringify(v1) });
    const service = createStorageService({
      dataDir: DATA_DIR,
      configPath: "/test/config.json",
      fileOps,
      logger: logger(),
      collectionArtifacts: artifacts,
    });

    const migrated = await service.loadCollection();

    expect(migrated.schemaVersion).toBe(2);
    expect(invalidated).toEqual(["v1-derived-artifact"]);
    expect(JSON.parse(fileOps.files.get(COLLECTION_PATH) ?? "null")).toEqual(migrated);
  });

  test("failure after profile invalidation leaves old collection and retry completes", async () => {
    let failWishlist = true;
    const wishlistFailure: CollectionArtifactDescriptor = {
      ...COLLECTION_ARTIFACTS[1],
      async invalidate(context): Promise<void> {
        if (failWishlist) {
          failWishlist = false;
          throw new Error("injected wishlist boundary failure");
        }
        await COLLECTION_ARTIFACTS[1].invalidate(context);
      },
    };
    const { service, fileOps, original } = makeService([COLLECTION_ARTIFACTS[0], wishlistFailure]);

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.loadCollection()).rejects.toThrow("injected wishlist boundary failure");
    expect(fileOps.files.has(PROFILE_PATH)).toBe(false);
    expect(fileOps.files.get(COLLECTION_PATH)).toBe(original);

    const loaded = await service.loadCollection();
    expect(CollectionSchema.safeParse(loaded).success).toBe(true);
    expect(firstPredictedScore(fileOps.files.get(WISHLIST_PATH))).toBeNull();
  });

  test("failure after wishlist and future invalidation retries all idempotently", async () => {
    let futureAttempts = 0;
    const future: CollectionArtifactDescriptor = {
      identity: "future-predictions",
      dependencyVersion: 1,
      path: (dataDir) => `${dataDir}/future.json`,
      invalidate(): Promise<void> {
        futureAttempts += 1;
        if (futureAttempts === 1)
          return Promise.reject(new Error("injected future artifact failure"));
        return Promise.resolve();
      },
    };
    const { service, fileOps, original } = makeService([...COLLECTION_ARTIFACTS, future]);

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.loadCollection()).rejects.toThrow("injected future artifact failure");
    expect(fileOps.files.get(COLLECTION_PATH)).toBe(original);
    expect(firstPredictedScore(fileOps.files.get(WISHLIST_PATH))).toBeNull();

    await service.loadCollection();
    expect(futureAttempts).toBe(2);
    expect(
      CollectionSchema.safeParse(JSON.parse(fileOps.files.get(COLLECTION_PATH) ?? "null")).success,
    ).toBe(true);
  });

  test("collection rename failure keeps the old version so retry repeats invalidation", async () => {
    const { service, fileOps, original, sink } = makeService();
    const originalRename = fileOps.rename.bind(fileOps);
    let failCollectionRename = true;
    fileOps.rename = async (oldPath, newPath) => {
      if (newPath === COLLECTION_PATH && failCollectionRename) {
        failCollectionRename = false;
        throw new Error("injected collection rename failure");
      }
      await originalRename(oldPath, newPath);
    };

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.loadCollection()).rejects.toThrow("injected collection rename failure");
    expect(fileOps.files.get(COLLECTION_PATH)).toBe(original);
    expect(sink.entries.some((entry) => entry.includes("collection persistence failed"))).toBe(
      true,
    );

    await service.loadCollection();
    expect(
      CollectionSchema.safeParse(JSON.parse(fileOps.files.get(COLLECTION_PATH) ?? "null")).success,
    ).toBe(true);
  });
});
