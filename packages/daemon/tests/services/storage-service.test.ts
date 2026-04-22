import * as os from "os";
import * as path from "path";
import { describe, expect, test } from "bun:test";
import type { Collection, ProfileData, CollectionProfile } from "@shelf-judge/shared";
import { createStorageService } from "../../src/services/storage-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

const DATA_DIR = "/test/data";
const CONFIG_PATH = "/test/config.json";
const COLLECTION_PATH = "/test/data/collection.json";

function makeService(initialFiles?: Record<string, string>) {
  const fileOps = createMockFileOps(initialFiles);
  const service = createStorageService({
    dataDir: DATA_DIR,
    configPath: CONFIG_PATH,
    socketPath: "/tmp/test.sock",
    fileOps,
  });
  return { service, fileOps };
}

describe("StorageService.loadCollection", () => {
  test("returns default collection with 2 BGG axes when file doesn't exist", async () => {
    const { service } = makeService();

    const collection = await service.loadCollection();

    expect(collection.name).toBe("My Collection");
    expect(collection.axes).toHaveLength(2);
    expect(collection.games).toHaveLength(0);

    const communityRating = collection.axes.find((a) => a.name === "Community Rating");
    expect(communityRating).toBeDefined();
    expect(communityRating!.source).toBe("bgg");
    expect(communityRating!.bggField).toBe("communityRating");

    const complexity = collection.axes.find((a) => a.name === "Complexity");
    expect(complexity).toBeDefined();
    expect(complexity!.source).toBe("bgg");
    expect(complexity!.bggField).toBe("weight");
  });

  test("loads collection from valid JSON file", async () => {
    const stored: Collection = {
      id: "col-1",
      name: "Test Collection",
      axes: [],
      games: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { service } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
    });

    const collection = await service.loadCollection();

    expect(collection.id).toBe("col-1");
    expect(collection.name).toBe("Test Collection");
  });

  test("throws on malformed JSON", async () => {
    const { service } = makeService({
      [COLLECTION_PATH]: "{ not valid json !!!",
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.loadCollection()).rejects.toThrow();
  });
});

describe("StorageService.saveCollection", () => {
  test("writes to temp file then renames (atomic write)", async () => {
    const { service, fileOps } = makeService();
    const collection: Collection = {
      id: "col-1",
      name: "Test",
      axes: [],
      games: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await service.saveCollection(collection);

    // Verify the call sequence: mkdir, writeFile (to tmp), rename (tmp -> real)
    const writeCalls = fileOps.calls.filter(
      (c) => c.method === "writeFile" || c.method === "rename",
    );
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[0].method).toBe("writeFile");
    expect(writeCalls[0].args[0]).toContain(".tmp");
    expect(writeCalls[1].method).toBe("rename");
    expect(writeCalls[1].args[0]).toContain(".tmp");
    expect(writeCalls[1].args[1]).toBe(COLLECTION_PATH);
  });

  test("produces valid JSON that round-trips through load", async () => {
    const { service, fileOps } = makeService();
    const original: Collection = {
      id: "col-round",
      name: "Round Trip",
      axes: [
        {
          id: "axis-1",
          name: "Fun",
          description: null,
          weight: 50,
          source: "personal",
          bggField: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      games: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await service.saveCollection(original);

    // The file should now be in the mock filesystem at the collection path
    expect(fileOps.files.has(COLLECTION_PATH)).toBe(true);

    // Load it back
    const loaded = await service.loadCollection();
    expect(loaded.id).toBe("col-round");
    expect(loaded.name).toBe("Round Trip");
    expect(loaded.axes).toHaveLength(1);
    expect(loaded.axes[0].name).toBe("Fun");
  });

  test("sequential saves result in last-write-wins", async () => {
    const { service } = makeService();
    const base: Collection = {
      id: "col-1",
      name: "First",
      axes: [],
      games: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await service.saveCollection({ ...base, name: "First" });
    await service.saveCollection({ ...base, name: "Second" });

    const loaded = await service.loadCollection();
    expect(loaded.name).toBe("Second");
  });
});

describe("StorageService.loadConfig", () => {
  test("returns default config when file doesn't exist", async () => {
    const { service } = makeService();

    const config = await service.loadConfig();

    expect(config.bggAuthToken).toBeNull();
    expect(config.dataDir).toBe(DATA_DIR);
    expect(config.socketPath).toBe(path.join(os.homedir(), ".shelf-judge", "shelf-judge.sock"));
  });

  test("loads config from existing file", async () => {
    const stored = {
      bggAuthToken: "test-token",
      dataDir: "/custom/data",
      socketPath: "/custom/sock",
    };
    const { service } = makeService({
      [CONFIG_PATH]: JSON.stringify(stored),
    });

    const config = await service.loadConfig();

    expect(config.bggAuthToken).toBe("test-token");
    expect(config.dataDir).toBe("/custom/data");
  });
});

describe("StorageService.saveConfig", () => {
  test("uses atomic write for config", async () => {
    const { service, fileOps } = makeService();

    await service.saveConfig({
      bggAuthToken: "tok",
      username: null,
      dataDir: DATA_DIR,
      socketPath: "/tmp/shelf-judge.sock",
    });

    const writeCalls = fileOps.calls.filter(
      (c) => c.method === "writeFile" || c.method === "rename",
    );
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[0].method).toBe("writeFile");
    expect(writeCalls[0].args[0]).toContain(".tmp");
    expect(writeCalls[1].method).toBe("rename");
  });
});

const PROFILE_PATH = "/test/data/profile.json";

function makeEmptyProfile(): CollectionProfile {
  return {
    axisDistributions: [],
    axisWeights: [],
    bggClustering: {
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      weightRanges: [],
    },
    utilityCurves: [],
    divergence: null,
    outliers: [],
    suggestions: [],
    gameCount: 0,
    ratedGameCount: 0,
    computedAt: "2026-01-01T00:00:00.000Z",
    narration: null,
    narrationState: "empty",
  };
}

describe("StorageService.loadProfile", () => {
  test("returns null when file doesn't exist", async () => {
    const { service } = makeService();
    const profile = await service.loadProfile();
    expect(profile).toBeNull();
  });

  test("loads profile from valid JSON file", async () => {
    const profileData: ProfileData = {
      profile: makeEmptyProfile(),
      computedAt: "2026-01-01T00:00:00.000Z",
      narration: null,
      narrationComputedAt: null,
    };
    const { service } = makeService({
      [PROFILE_PATH]: JSON.stringify(profileData),
    });

    const loaded = await service.loadProfile();
    expect(loaded).not.toBeNull();
    expect(loaded!.computedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(loaded!.profile.gameCount).toBe(0);
  });
});

describe("StorageService.saveProfile", () => {
  test("writes and loads correctly (round-trip)", async () => {
    const { service } = makeService();
    const profileData: ProfileData = {
      profile: { ...makeEmptyProfile(), gameCount: 42 },
      computedAt: "2026-03-15T12:00:00.000Z",
      narration: null,
      narrationComputedAt: null,
    };

    await service.saveProfile(profileData);
    const loaded = await service.loadProfile();

    expect(loaded).not.toBeNull();
    expect(loaded!.computedAt).toBe("2026-03-15T12:00:00.000Z");
    expect(loaded!.profile.gameCount).toBe(42);
  });
});
