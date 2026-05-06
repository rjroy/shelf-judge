import { describe, expect, test } from "bun:test";
import type {
  Collection,
  ProfileData,
  CollectionProfile,
  WishlistEntry,
} from "@shelf-judge/shared";
import { createStorageService } from "../../src/services/storage-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

const DATA_DIR = "/test/data";
const CONFIG_PATH = "/test/config.json";
const COLLECTION_PATH = "/test/data/collection.json";
const TOURNAMENT_PATH = "/test/data/tournament.json";
const WISHLIST_PATH = "/test/data/wishlist.json";

function makeService(initialFiles?: Record<string, string>) {
  const fileOps = createMockFileOps(initialFiles);
  const service = createStorageService({
    dataDir: DATA_DIR,
    configPath: CONFIG_PATH,
    fileOps,
  });
  return { service, fileOps };
}

describe("StorageService.loadCollection", () => {
  test("returns default collection with 2 BGG axes plus tournament axis when file doesn't exist", async () => {
    const { service } = makeService();

    const collection = await service.loadCollection();

    expect(collection.name).toBe("My Collection");
    expect(collection.axes).toHaveLength(3);
    expect(collection.games).toHaveLength(0);

    const communityRating = collection.axes.find((a) => a.name === "Community Rating");
    expect(communityRating).toBeDefined();
    expect(communityRating!.source).toBe("bgg");
    expect(communityRating!.bggField).toBe("communityRating");

    const complexity = collection.axes.find((a) => a.name === "Complexity");
    expect(complexity).toBeDefined();
    expect(complexity!.source).toBe("bgg");
    expect(complexity!.bggField).toBe("weight");

    const tournament = collection.axes.find((a) => a.source === "tournament");
    expect(tournament).toBeDefined();
    expect(tournament!.name).toBe("Tournament");
    expect(tournament!.bggField).toBeNull();
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

    // Load it back. The tournament-axis migration (REQ-TAXIS-4) adds a second axis.
    const loaded = await service.loadCollection();
    expect(loaded.id).toBe("col-round");
    expect(loaded.name).toBe("Round Trip");
    expect(loaded.axes).toHaveLength(2);
    expect(loaded.axes.find((a) => a.name === "Fun")).toBeDefined();
    expect(loaded.axes.find((a) => a.source === "tournament")).toBeDefined();
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

// ---------------------------------------------------------------------------
// Tournament-axis migration (REQ-TAXIS-4, REQ-TAXIS-9)
// ---------------------------------------------------------------------------

function legacyCollectionWithoutTournamentAxis(): Collection {
  return {
    id: "col-legacy",
    name: "Legacy",
    axes: [
      {
        id: "axis-bgg",
        name: "Community Rating",
        description: null,
        weight: 50,
        source: "bgg",
        bggField: "communityRating",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    games: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeWishlistEntry(overrides: Partial<WishlistEntry> = {}): WishlistEntry {
  return {
    id: "wl-1",
    bggId: 12345,
    name: "Wishlisted Game",
    yearPublished: 2024,
    thumbnailUrl: null,
    predictedScore: 7.5,
    predictionConfidence: "moderate",
    predictedBreakdown: [{ axisName: "Community Rating", rating: 8, confidence: "moderate" }],
    nicheImpact: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("StorageService.loadCollection — tournament axis migration", () => {
  test("adds a tournament axis to legacy collection on load and rewrites the file", async () => {
    const stored = legacyCollectionWithoutTournamentAxis();
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
    });

    const loaded = await service.loadCollection();

    expect(loaded.axes).toHaveLength(2);
    const tournament = loaded.axes.find((a) => a.source === "tournament");
    expect(tournament).toBeDefined();
    expect(tournament!.name).toBe("Tournament");

    // The on-disk file must reflect the migrated collection.
    const onDisk = JSON.parse(fileOps.files.get(COLLECTION_PATH)!) as Collection;
    expect(onDisk.axes).toHaveLength(2);
    expect(onDisk.axes.some((a) => a.source === "tournament")).toBe(true);
  });

  test("a second loadCollection is a no-op (idempotent)", async () => {
    const stored = legacyCollectionWithoutTournamentAxis();
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
    });

    await service.loadCollection();
    const writeCallsAfterFirstLoad = fileOps.calls.filter((c) => c.method === "writeFile").length;

    await service.loadCollection();
    const writeCallsAfterSecondLoad = fileOps.calls.filter((c) => c.method === "writeFile").length;

    // Second load must not re-write the collection file.
    expect(writeCallsAfterSecondLoad).toBe(writeCallsAfterFirstLoad);
  });

  test("deletes profile.json when migration runs", async () => {
    const stored = legacyCollectionWithoutTournamentAxis();
    const profileData: ProfileData = {
      profile: makeEmptyProfile(),
      computedAt: "2026-01-01T00:00:00.000Z",
      narration: null,
      narrationComputedAt: null,
    };
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
      [PROFILE_PATH]: JSON.stringify(profileData),
    });

    expect(fileOps.files.has(PROFILE_PATH)).toBe(true);
    await service.loadCollection();
    expect(fileOps.files.has(PROFILE_PATH)).toBe(false);
  });

  test("is silent when profile.json is absent", async () => {
    const stored = legacyCollectionWithoutTournamentAxis();
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
    });

    expect(fileOps.files.has(PROFILE_PATH)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().resolves is thenable
    await expect(service.loadCollection()).resolves.toBeDefined();
    expect(fileOps.files.has(PROFILE_PATH)).toBe(false);
  });

  test("clears prediction fields on wishlist entries", async () => {
    const stored = legacyCollectionWithoutTournamentAxis();
    const wishlist: WishlistEntry[] = [
      makeWishlistEntry({ id: "wl-a", bggId: 1, name: "A" }),
      makeWishlistEntry({ id: "wl-b", bggId: 2, name: "B", predictedScore: 6.0 }),
    ];
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
      [WISHLIST_PATH]: JSON.stringify(wishlist),
    });

    await service.loadCollection();

    const onDisk = JSON.parse(fileOps.files.get(WISHLIST_PATH)!) as WishlistEntry[];
    expect(onDisk).toHaveLength(2);
    for (const entry of onDisk) {
      expect(entry.predictedScore).toBeNull();
      expect(entry.predictedBreakdown).toBeNull();
      expect(entry.predictionConfidence).toBeNull();
    }
    // User-owned metadata is preserved.
    expect(onDisk[0].bggId).toBe(1);
    expect(onDisk[0].name).toBe("A");
    expect(onDisk[1].bggId).toBe(2);
  });

  test("does not touch wishlist when migration is a no-op", async () => {
    // Collection already has a tournament axis, so no migration runs.
    const collection: Collection = {
      ...legacyCollectionWithoutTournamentAxis(),
      axes: [
        {
          id: "axis-t",
          name: "Tournament",
          description: null,
          weight: 30,
          source: "tournament",
          bggField: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const wishlist: WishlistEntry[] = [makeWishlistEntry({ predictedScore: 7.5 })];
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(collection),
      [WISHLIST_PATH]: JSON.stringify(wishlist),
    });

    await service.loadCollection();

    const onDisk = JSON.parse(fileOps.files.get(WISHLIST_PATH)!) as WishlistEntry[];
    expect(onDisk[0].predictedScore).toBe(7.5);
  });
});

// ---------------------------------------------------------------------------
// In-flight load lock regression (Phase 3)
//
// loadTournament/loadCollection serialize concurrent first-time loads via an
// in-flight promise map. Without the lock, two parallel callers each see the
// no-file branch, each call atomicWrite, and the writes race on the shared
// `<file>.tmp` path. The mock filesystem masks the rename ordering, but write
// counts are still observable: with the lock, exactly one writeFile + one
// rename per file; without it, two of each.
//
// To make the race deterministic, we wrap the mock's writeFile in a yield so
// both callers reliably enter their no-file branch before either side writes.
// ---------------------------------------------------------------------------

function withSlowWrite(fileOps: ReturnType<typeof createMockFileOps>) {
  const original = fileOps.writeFile.bind(fileOps);
  fileOps.writeFile = async (filePath: string, content: string): Promise<void> => {
    // Yield to the microtask queue so the second caller's exists() check can
    // resolve before this writeFile commits. Without this hop, both callers
    // could otherwise serialize naturally even without the lock.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return original(filePath, content);
  };
  return fileOps;
}

describe("StorageService — concurrent first-time load lock", () => {
  test("loadTournament: parallel calls produce one write, both resolve to equivalent data", async () => {
    const fileOps = withSlowWrite(createMockFileOps());
    const service = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps,
    });

    const [a, b] = await Promise.all([service.loadTournament(), service.loadTournament()]);

    expect(a).toEqual(b);
    expect(a.settings.kFactorThreshold).toBe(15);
    expect(a.sessions).toEqual([]);
    expect(a.gameStats).toEqual({});

    // Exactly one atomic write to tournament.json (one writeFile to the tmp,
    // one rename onto the real path). Two of either means the lock is gone.
    const tournamentWrites = fileOps.calls.filter(
      (c) => c.method === "writeFile" && c.args[0].includes("tournament.json"),
    );
    const tournamentRenames = fileOps.calls.filter(
      (c) => c.method === "rename" && c.args[1] === TOURNAMENT_PATH,
    );
    expect(tournamentWrites).toHaveLength(1);
    expect(tournamentRenames).toHaveLength(1);
  });

  test("loadCollection: parallel calls produce one write, both resolve to equivalent data", async () => {
    const fileOps = withSlowWrite(createMockFileOps());
    const service = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps,
    });

    const [a, b] = await Promise.all([service.loadCollection(), service.loadCollection()]);

    expect(a.name).toBe(b.name);
    expect(a.id).toBe(b.id);
    expect(a.axes.map((axis) => axis.name).sort()).toEqual(b.axes.map((axis) => axis.name).sort());

    const collectionWrites = fileOps.calls.filter(
      (c) => c.method === "writeFile" && c.args[0].includes("collection.json"),
    );
    const collectionRenames = fileOps.calls.filter(
      (c) => c.method === "rename" && c.args[1] === COLLECTION_PATH,
    );
    expect(collectionWrites).toHaveLength(1);
    expect(collectionRenames).toHaveLength(1);
  });
});
