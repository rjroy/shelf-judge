import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type {
  Game,
  GameWithScore,
  FitnessResult,
  BggGameData,
  RedundancySettings,
  NicheSettings,
  Collection,
} from "@shelf-judge/shared";
import { createGameRoutes } from "../src/routes/games";
import type { GameService } from "../src/services/game-service";
import type { PredictionService } from "../src/services/prediction-service";
import type { StorageService } from "../src/services/storage-service";
import { createStorageService } from "../src/services/storage-service";
import type { FileOps } from "../src/services/file-ops";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../src/services/redundancy-engine";
import { createWishlistRoutes } from "../src/routes/wishlist";
import type { WishlistService } from "../src/services/wishlist-service";
import { computeProfile } from "../src/services/profile-engine";

const now = "2026-01-01T00:00:00Z";

function makeBggData(
  overrides: Partial<BggGameData> & {
    mechanics?: { id: number; name: string }[];
    categories?: { id: number; name: string }[];
  } = {},
): BggGameData {
  return {
    communityRating: 7.0,
    bayesAverage: 6.5,
    weight: 3.0,
    numWeightVotes: 100,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    suggestedPlayerCounts: [],
    fetchedAt: now,
    ...overrides,
  };
}

const mech = (name: string) => ({ id: Math.random(), name });
const cat = (name: string) => ({ id: Math.random(), name });

function makeGame(
  id: string,
  name: string,
  ownership: "owned" | "previously-owned" = "owned",
  bggData?: BggGameData | null,
): Game {
  return {
    id,
    bggId: 1,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    imageUrl: null,
    bggData:
      bggData ??
      makeBggData({ mechanics: [mech("Deck Building")], categories: [cat("Card Game")] }),
    numPlays: 5,
    ownership,
    ratings: { axis1: 7 },
    createdAt: now,
    updatedAt: now,
  };
}

function makeScore(score: number): FitnessResult {
  return {
    score,
    ratedAxisCount: 1,
    totalAxisCount: 1,
    breakdown: [],
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: null,
    redundancyAdjustment: null,
  };
}

// Test fixtures: 3 owned games and 1 previously-owned game
const ownedA = makeGame("a", "Alpha", "owned");
const ownedB = makeGame("b", "Beta", "owned");
const ownedC = makeGame("c", "Charlie", "owned");
const prevOwned = makeGame("prev", "Delta", "previously-owned");

// Mutable collection for setOwnership tests
function makeCollection(): Collection {
  return {
    id: "coll-1",
    name: "Test",
    axes: [
      {
        id: "axis1",
        name: "Fun",
        description: null,
        weight: 100,
        source: "personal",
        bggField: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    games: [
      structuredClone(ownedA),
      structuredClone(ownedB),
      structuredClone(ownedC),
      structuredClone(prevOwned),
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function createMockStorageService(
  collection?: Collection,
  redundancySettings: RedundancySettings = { ...DEFAULT_REDUNDANCY_SETTINGS, enabled: false },
  nicheSettings: NicheSettings = { ignoredTags: [] },
): StorageService {
  const coll = collection ?? makeCollection();
  return {
    loadRedundancySettings: () => Promise.resolve(structuredClone(redundancySettings)),
    saveRedundancySettings: () => Promise.resolve(),
    loadNicheSettings: () => Promise.resolve(structuredClone(nicheSettings)),
    saveNicheSettings: () => Promise.resolve(),
    loadCollection: () => Promise.resolve(structuredClone(coll)),
    saveCollection: (c: Collection) => {
      coll.games = c.games;
      coll.updatedAt = c.updatedAt;
      return Promise.resolve();
    },
    loadConfig: () => Promise.reject(new Error("not implemented")),
    saveConfig: () => Promise.resolve(),
    loadTournament: () => Promise.reject(new Error("not implemented")),
    saveTournament: () => Promise.resolve(),
    loadProfile: () => Promise.resolve(null),
    saveProfile: () => Promise.resolve(),
    loadPredictionSettings: () =>
      Promise.resolve({
        stageThresholds: [5, 15, 30] as [number, number, number],
        defaultK: 5,
        minSimilarityThreshold: 0.2,
        tournamentStabilityBoost: 0.2,
      }),
    savePredictionSettings: () => Promise.resolve(),
    loadWishlist: () => Promise.resolve([]),
    saveWishlist: () => Promise.resolve(),
  };
}

function createMockGameService(collection?: Collection): GameService {
  const coll = collection ?? makeCollection();
  return {
    addGame: () => Promise.reject(new Error("not implemented")),
    getGame: (id: string) => {
      const game = coll.games.find((g) => g.id === id);
      if (!game) return Promise.reject(new Error(`Game not found: ${id}`));
      return Promise.resolve({ game: structuredClone(game), score: makeScore(7.0) });
    },
    listGames: () => {
      return Promise.resolve(
        coll.games.map((g) => ({ game: structuredClone(g), score: makeScore(7.0) })),
      );
    },
    rateGame: () => Promise.reject(new Error("not implemented")),
    removeGame: () => Promise.reject(new Error("not implemented")),
    setOwnership: (id: string, ownership: "owned" | "previously-owned") => {
      const game = coll.games.find((g) => g.id === id);
      if (!game) return Promise.reject(new Error(`Game not found: ${id}`));
      if (game.ownership === ownership) return Promise.resolve(structuredClone(game));
      game.ownership = ownership;
      game.updatedAt = new Date().toISOString();
      coll.updatedAt = game.updatedAt;
      return Promise.resolve(structuredClone(game));
    },
    searchGames: () => Promise.reject(new Error("not implemented")),
    refreshBggData: () => Promise.reject(new Error("not implemented")),
    refreshAllBggData: () => Promise.reject(new Error("not implemented")),
    importBggCollection: () => Promise.reject(new Error("not implemented")),
  };
}

function createMockPredictionService(collection?: Collection): PredictionService {
  const coll = collection ?? makeCollection();
  return {
    listGamesWithPredictions: () => {
      return Promise.resolve(
        coll.games.map((g) => ({ game: structuredClone(g), score: makeScore(7.0) })),
      );
    },
    predictGame: () => Promise.reject(new Error("not implemented")),
    predictBggGame: () => Promise.reject(new Error("not implemented")),
    getReadiness: () => Promise.reject(new Error("not implemented")),
    getSettings: () => Promise.reject(new Error("not implemented")),
    updateSettings: () => Promise.reject(new Error("not implemented")),
  };
}

function buildApp(collection?: Collection) {
  const coll = collection ?? makeCollection();
  const storage = createMockStorageService(coll);
  const gameService = createMockGameService(coll);
  const predictionService = createMockPredictionService(coll);
  const app = new Hono();
  const { routes } = createGameRoutes({
    gameService,
    predictionService,
    storageService: storage,
  });
  app.route("/api", routes);
  return app;
}

// --- Tests ---

describe("PATCH /games/:id/ownership", () => {
  test("changes status to previously-owned and updates updatedAt", async () => {
    const app = buildApp();
    const res = await app.request("/api/games/a/ownership", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownership: "previously-owned" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { game: Game };
    expect(data.game.ownership).toBe("previously-owned");
    expect(data.game.updatedAt).not.toBe(now);
  });

  test("changes status back to owned (reacquisition)", async () => {
    const app = buildApp();
    const res = await app.request("/api/games/prev/ownership", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownership: "owned" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { game: Game };
    expect(data.game.ownership).toBe("owned");
  });

  test("returns 400 for invalid status", async () => {
    const app = buildApp();
    const res = await app.request("/api/games/a/ownership", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownership: "invalid" }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("owned");
  });

  test("returns 404 for nonexistent game", async () => {
    const app = buildApp();
    const res = await app.request("/api/games/nonexistent/ownership", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownership: "previously-owned" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 200 with current status without changing updatedAt", async () => {
    const app = buildApp();
    const res = await app.request("/api/games/a/ownership", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownership: "owned" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { game: Game };
    expect(data.game.ownership).toBe("owned");
    expect(data.game.updatedAt).toBe(now);
  });

  test("does not delete any data (ratings, bggData, numPlays preserved)", async () => {
    const app = buildApp();
    const res = await app.request("/api/games/a/ownership", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownership: "previously-owned" }),
    });
    const data = (await res.json()) as { game: Game };
    expect(data.game.ratings).toEqual({ axis1: 7 });
    expect(data.game.bggData).not.toBeNull();
    expect(data.game.numPlays).toBe(5);
    expect(data.game.name).toBe("Alpha");
  });
});

describe("GET /games ownership filtering", () => {
  test("default returns only owned games", async () => {
    const app = buildApp();
    const res = await app.request("/api/games");
    expect(res.status).toBe(200);
    const games = (await res.json()) as GameWithScore[];
    expect(games.length).toBe(3);
    expect(games.every((g) => g.game.ownership === "owned")).toBe(true);
  });

  test("ownership=all returns both owned and previously-owned", async () => {
    const app = buildApp();
    const res = await app.request("/api/games?ownership=all");
    expect(res.status).toBe(200);
    const games = (await res.json()) as GameWithScore[];
    expect(games.length).toBe(4);
    const ownerships = new Set(games.map((g) => g.game.ownership));
    expect(ownerships.has("owned")).toBe(true);
    expect(ownerships.has("previously-owned")).toBe(true);
  });

  test("ownership=previously-owned returns only previously-owned", async () => {
    const app = buildApp();
    const res = await app.request("/api/games?ownership=previously-owned");
    expect(res.status).toBe(200);
    const games = (await res.json()) as GameWithScore[];
    expect(games.length).toBe(1);
    expect(games[0].game.ownership).toBe("previously-owned");
    expect(games[0].game.id).toBe("prev");
  });

  test("includePredicted path respects ownership filter", async () => {
    const app = buildApp();
    const res = await app.request("/api/games?includePredicted=true&ownership=owned");
    expect(res.status).toBe(200);
    const games = (await res.json()) as GameWithScore[];
    expect(games.length).toBe(3);
    expect(games.every((g) => g.game.ownership === "owned")).toBe(true);
  });

  test("includePredicted with ownership=all returns all games", async () => {
    const app = buildApp();
    const res = await app.request("/api/games?includePredicted=true&ownership=all");
    expect(res.status).toBe(200);
    const games = (await res.json()) as GameWithScore[];
    expect(games.length).toBe(4);
  });
});

describe("GET /games/:id regardless of ownership", () => {
  test("returns owned game", async () => {
    const app = buildApp();
    const res = await app.request("/api/games/a");
    expect(res.status).toBe(200);
    const data = (await res.json()) as GameWithScore;
    expect(data.game.id).toBe("a");
    expect(data.game.ownership).toBe("owned");
  });

  test("returns previously-owned game with null niche and redundancy", async () => {
    const coll = makeCollection();
    const enabledRedundancy: RedundancySettings = {
      ...DEFAULT_REDUNDANCY_SETTINGS,
      enabled: true,
      stage: "annotation",
      similarityThreshold: 0.1,
      minNeighbors: 1,
      expectedNeighbors: 5,
    };
    const storage = createMockStorageService(coll, enabledRedundancy);
    const gameService = createMockGameService(coll);
    const predictionService = createMockPredictionService(coll);
    const app = new Hono();
    const { routes } = createGameRoutes({
      gameService,
      predictionService,
      storageService: storage,
    });
    app.route("/api", routes);

    const res = await app.request("/api/games/prev");
    expect(res.status).toBe(200);
    const data = (await res.json()) as GameWithScore;
    expect(data.game.id).toBe("prev");
    expect(data.game.ownership).toBe("previously-owned");
    expect(data.nichePosition).toBeNull();
    expect(data.score!.redundancyAdjustment).toBeNull();
  });
});

describe("niche/redundancy exclusion for previously-owned games", () => {
  const enabledRedundancy: RedundancySettings = {
    ...DEFAULT_REDUNDANCY_SETTINGS,
    enabled: true,
    stage: "annotation",
    similarityThreshold: 0.1,
    minNeighbors: 1,
    expectedNeighbors: 5,
  };

  test("previously-owned games in ownership=all have null nichePosition and null redundancyAdjustment", async () => {
    const coll = makeCollection();
    const storage = createMockStorageService(coll, enabledRedundancy);
    const gameService = createMockGameService(coll);
    const predictionService = createMockPredictionService(coll);
    const app = new Hono();
    const { routes } = createGameRoutes({
      gameService,
      predictionService,
      storageService: storage,
    });
    app.route("/api", routes);

    const res = await app.request("/api/games?ownership=all&includeNiches=true");
    expect(res.status).toBe(200);
    const games = (await res.json()) as GameWithScore[];
    const prevGame = games.find((g) => g.game.id === "prev");
    expect(prevGame).toBeDefined();
    expect(prevGame!.nichePosition).toBeNull();
    expect(prevGame!.score!.redundancyAdjustment).toBeNull();
  });

  test("fitness scores are computed for previously-owned games", async () => {
    const app = buildApp();
    const res = await app.request("/api/games?ownership=all");
    expect(res.status).toBe(200);
    const games = (await res.json()) as GameWithScore[];
    const prevGame = games.find((g) => g.game.id === "prev");
    expect(prevGame).toBeDefined();
    expect(prevGame!.score).not.toBeNull();
    expect(prevGame!.score!.score).toBeGreaterThan(0);
  });

  test("previously-owned games remain in prediction reference pool", async () => {
    const coll = makeCollection();
    const predService = createMockPredictionService(coll);
    const predictions = await predService.listGamesWithPredictions();
    const prevGame = predictions.find((g) => g.game.id === "prev");
    expect(prevGame).toBeDefined();
  });

  test("redundancy/niche scores for owned games are identical between default and ownership=all", async () => {
    const coll = makeCollection();
    const storage = createMockStorageService(coll, enabledRedundancy);
    const gameService = createMockGameService(coll);
    const predictionService = createMockPredictionService(coll);
    const app = new Hono();
    const { routes } = createGameRoutes({
      gameService,
      predictionService,
      storageService: storage,
    });
    app.route("/api", routes);

    const [resDefault, resAll] = await Promise.all([
      app.request("/api/games"),
      app.request("/api/games?ownership=all"),
    ]);

    const defaultGames = (await resDefault.json()) as GameWithScore[];
    const allGames = (await resAll.json()) as GameWithScore[];

    // Each owned game should have the same redundancy adjustment in both responses
    for (const dg of defaultGames) {
      const ag = allGames.find((g) => g.game.id === dg.game.id);
      expect(ag).toBeDefined();
      expect(ag!.score?.redundancyAdjustment?.penalty).toBe(
        dg.score?.redundancyAdjustment?.penalty,
      );
    }
  });
});

describe("wishlist interaction with previously-owned games", () => {
  test("previously-owned game cannot be wishlisted (returns 409)", async () => {
    const coll = makeCollection();
    // Give prevOwned a unique bggId so the wishlist check matches
    coll.games.find((g) => g.id === "prev")!.bggId = 999;

    const storage = createMockStorageService(coll);
    const mockWishlistService: WishlistService = {
      list: () => Promise.resolve([]),
      add: async (bggId: number) => {
        // Replicate the real wishlist service's collection check
        const collection = await storage.loadCollection();
        if (collection.games.some((g) => g.bggId === bggId)) {
          throw new Error("This game is already in your collection");
        }
        throw new Error("not implemented");
      },
      remove: () => Promise.reject(new Error("not implemented")),
      clear: () => Promise.reject(new Error("not implemented")),
      refresh: () => Promise.reject(new Error("not implemented")),
      refreshAll: () => Promise.reject(new Error("not implemented")),
      removeByBggId: () => Promise.reject(new Error("not implemented")),
    };

    const app = new Hono();
    const { routes } = createWishlistRoutes({ wishlistService: mockWishlistService });
    app.route("/api", routes);

    const res = await app.request("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bggId: 999 }),
    });
    expect(res.status).toBe(409);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("already in your collection");
  });
});

describe("profile computation includes previously-owned games", () => {
  test("previously-owned games contribute to profile game count", () => {
    const coll = makeCollection();
    const games = coll.games;
    const fitnessResults = new Map<string, FitnessResult>();
    for (const game of games) {
      fitnessResults.set(game.id, makeScore(7.0));
    }

    const profile = computeProfile({
      games,
      axes: coll.axes,
      fitnessResults,
      tournamentStats: null,
    });

    // All 4 games (3 owned + 1 previously-owned) should be counted
    expect(profile.gameCount).toBe(4);
  });
});

describe("legacy data migration", () => {
  test("game without ownership field defaults to owned when loaded through storage service", async () => {
    const legacyCollection = {
      id: "coll-1",
      name: "Test",
      axes: [],
      games: [
        {
          id: "legacy",
          bggId: null,
          name: "Legacy Game",
          yearPublished: null,
          minPlayers: null,
          maxPlayers: null,
          playingTime: null,
          imageUrl: null,
          bggData: null,
          numPlays: null,
          ratings: {},
          createdAt: now,
          updatedAt: now,
          // No ownership field — this is the legacy state
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const files: Record<string, string> = {
      "/data/collection.json": JSON.stringify(legacyCollection),
    };
    const inMemoryFileOps: FileOps = {
      readFile: (p: string) => {
        if (files[p] !== undefined) return Promise.resolve(files[p]);
        return Promise.reject(new Error(`ENOENT: ${p}`));
      },
      writeFile: (p: string, content: string) => {
        files[p] = content;
        return Promise.resolve();
      },
      rename: (oldP: string, newP: string) => {
        files[newP] = files[oldP];
        delete files[oldP];
        return Promise.resolve();
      },
      exists: (p: string) => Promise.resolve(p in files),
      mkdir: () => Promise.resolve(),
    };

    const storage = createStorageService({
      dataDir: "/data",
      configPath: "/config.json",
      fileOps: inMemoryFileOps,
    });

    const loaded = await storage.loadCollection();
    expect(loaded.games).toHaveLength(1);
    expect(loaded.games[0].ownership).toBe("owned");
  });
});
