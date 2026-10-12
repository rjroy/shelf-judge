import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createGameRoutes } from "../src/routes/games";
import { createNicheRoutes } from "../src/routes/niche";
import { createPredictionRoutes } from "../src/routes/prediction";
import type {
  GameWithScore,
  FitnessResult,
  BggGameData,
  NicheSettings,
  Collection,
  DurableGame,
} from "@shelf-judge/shared";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyStateV10,
} from "@shelf-judge/shared";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../src/services/redundancy-engine";
import { projectProfileCollectionSource } from "../src/services/game-projection";
import type { GameService } from "../src/services/game-service";
import type { PredictionService } from "../src/services/prediction-service";
import type { StorageService } from "../src/services/storage-service";
import { createDisplayedFitnessService } from "../src/services/displayed-fitness-service";
import type { UnifiedScoringService } from "../src/services/unified-scoring-service";
import { createTestPurchaseUtilizationService } from "./helpers/test-app";
import { createFileOps } from "../src/services/file-ops";
import { createStorageService } from "../src/services/storage-service";
import { createFitnessService } from "../src/services/fitness-service";
import { createUnifiedScoringService } from "../src/services/unified-scoring-service";

// --- Fixture helpers (shared with niche-engine.test.ts pattern) ---

function makeBggData(
  overrides: Partial<BggGameData> & {
    mechanics?: { id: number; name: string }[];
    categories?: { id: number; name: string }[];
    families?: { id: number; name: string }[];
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
    bestPlayerCount: null,
    fetchedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeGame(id: string, name: string, bggData: BggGameData | null): DurableGame {
  const bggId = bggData ? 12345 : null;
  return {
    id,
    bggId,
    entityMetadata: createInitialEntityMetadata(bggId),
    latestPlayCountCheck: null,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData,
    numPlays: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeScore(score: number): FitnessResult {
  return {
    score,
    ratedAxisCount: 3,
    totalAxisCount: 5,
    breakdown: [],
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: null,
    redundancyAdjustment: null,
  };
}

// Three games sharing "Deck Building" mechanic (forms a niche of size 3).
// Two of those also share "Card Game" category (forms a niche of size 2).
// One game has unique "Worker Placement" mechanic (no niche, <2 members).
const mech = (name: string) => ({ id: name.length, name });
const cat = (name: string) => ({ id: name.length, name });

const gameA = makeGame(
  "a",
  "Alpha",
  makeBggData({
    mechanics: [mech("Deck Building")],
    categories: [cat("Card Game")],
    families: [{ id: 1, name: "Digital Implementations: Board Game Arena" }],
  }),
);
const gameB = makeGame(
  "b",
  "Beta",
  makeBggData({
    mechanics: [mech("Deck Building")],
    categories: [cat("Card Game")],
    families: [{ id: 1, name: "Digital Implementations: Board Game Arena" }],
  }),
);
const gameC = makeGame(
  "c",
  "Charlie",
  makeBggData({
    mechanics: [mech("Deck Building"), mech("Worker Placement")],
    families: [{ id: 1, name: "Digital Implementations: Board Game Arena" }],
  }),
);

const allGamesWithScores: GameWithScore[] = [
  { game: gameA, score: makeScore(8.0) },
  { game: gameB, score: makeScore(7.0) },
  { game: gameC, score: makeScore(6.0) },
];

// --- Mock factories ---

const defaultCollection: Collection = {
  schemaVersion: 10,
  revision: 0,
  id: "collection-1",
  name: "Test",
  axes: [],
  games: [gameA, gameB, gameC],
  entertainmentBenchmark: null,
  semanticRedundancy: createInitialSemanticRedundancyStateV10(),
  intentions: [],
  attentionDispositions: [],
  commandReceipts: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function createMockStorageService(nicheSettings: NicheSettings): Partial<StorageService> {
  return {
    loadNicheSettings: () => Promise.resolve(structuredClone(nicheSettings)),
    saveNicheSettings: () => Promise.resolve(),
    // Redundancy defaults to disabled, so loadCollection won't be called, but must exist
    loadRedundancySettings: () => Promise.resolve({ ...DEFAULT_REDUNDANCY_SETTINGS }),
    loadCollection: () => Promise.resolve(structuredClone(defaultCollection)),
    loadTournament: () =>
      Promise.resolve({
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
        sessions: [],
        gameStats: {},
      }),
    loadPredictionSettings: () =>
      Promise.resolve({
        stageThresholds: [5, 15, 30],
        defaultK: 5,
        minSimilarityThreshold: 0.2,
      }),
  };
}

function createMockGameService(): Partial<GameService> {
  return {
    getGame: (id: string) => {
      const gws = allGamesWithScores.find((g) => g.game.id === id);
      if (!gws) return Promise.reject(new Error(`Game not found: ${id}`));
      return Promise.resolve(structuredClone(gws));
    },
    listGames: () => Promise.resolve(structuredClone(allGamesWithScores)),
    listGamesFromSnapshot: () => structuredClone(allGamesWithScores),
  };
}

function createMockPredictionService(): Partial<PredictionService> {
  return {
    listGamesWithPredictions: () => Promise.resolve(structuredClone(allGamesWithScores)),
    listGamesWithPredictionsFromSnapshot: () =>
      Promise.resolve(structuredClone(allGamesWithScores)),
    predictBggGame: () => {
      // Return a new candidate game that shares "Deck Building" mechanic
      const candidateGame = makeGame(
        "candidate",
        "Candidate",
        makeBggData({ mechanics: [mech("Deck Building")] }),
      );
      return Promise.resolve({
        game: candidateGame,
        score: makeScore(7.5),
        predictionUnavailable: null,
      });
    },
  };
}

describe("niche settings integration: GET /games/:id passthrough", () => {
  test("niche positions reflect ignored tags", async () => {
    // Without ignored tags: game A should be in both "Deck Building" and "Card Game" niches
    const appNoFilter = new Hono();
    const { routes: routesNoFilter } = createGameRoutes({
      gameService: createMockGameService() as GameService,
      predictionService: createMockPredictionService() as PredictionService,
      storageService: createMockStorageService({ ignoredTags: [] }) as StorageService,
      purchaseUtilizationService: createTestPurchaseUtilizationService(),
    });
    appNoFilter.route("/api", routesNoFilter);

    const resNoFilter = await appNoFilter.request("/api/games/a");
    expect(resNoFilter.status).toBe(200);
    const bodyNoFilter = (await resNoFilter.json()) as GameWithScore;
    const nichesNoFilter = bodyNoFilter.nichePosition!.niches;
    const nicheNames = nichesNoFilter.map((n) => n.name);
    expect(nicheNames).toContain("Deck Building");
    expect(nicheNames).toContain("Card Game");

    // With "Deck Building" ignored: game A should only be in "Card Game" niche
    const appWithFilter = new Hono();
    const { routes: routesWithFilter } = createGameRoutes({
      gameService: createMockGameService() as GameService,
      predictionService: createMockPredictionService() as PredictionService,
      storageService: createMockStorageService({
        ignoredTags: [{ type: "mechanic", name: "Deck Building" }],
      }) as StorageService,
      purchaseUtilizationService: createTestPurchaseUtilizationService(),
    });
    appWithFilter.route("/api", routesWithFilter);

    const resFiltered = await appWithFilter.request("/api/games/a");
    expect(resFiltered.status).toBe(200);
    const bodyFiltered = (await resFiltered.json()) as GameWithScore;
    const nichesFiltered = bodyFiltered.nichePosition!.niches;
    const filteredNames = nichesFiltered.map((n) => n.name);
    expect(filteredNames).not.toContain("Deck Building");
    expect(filteredNames).toContain("Card Game");
  });
});

describe("niche settings integration: unified scoring", () => {
  test("live and snapshot displays honor exact family ignores and restore other niches", async () => {
    const predictionSettings = {
      stageThresholds: [5, 15, 30] as [number, number, number],
      defaultK: 5,
      minSimilarityThreshold: 0.2,
    };
    const tournament = {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
      sessions: [],
      gameStats: {},
    };
    const scores = new Map(allGamesWithScores.map(({ game, score }) => [game.id, score]));
    const calculation = {
      actualFitness: scores,
      collectionFitness: scores,
      redundancyAdjustments: new Map(),
      redundancySimilarityStatus: () => "disabled",
      proof: { version: 2 },
      isCurrent: () => true,
    };
    let capturedSettings: NicheSettings = { ignoredTags: [] };
    const frame = () => ({
      kind: "current" as const,
      sources: {
        collection: defaultCollection,
        tournament,
        predictionSettings,
      },
      redundancySettings: { ...DEFAULT_REDUNDANCY_SETTINGS },
      nicheSettings: structuredClone(capturedSettings),
      sourceVector: { available: true },
    });
    const unifiedScoringService = {
      capture: () => Promise.resolve(frame()),
      calculate: () => calculation,
      publishCurrent: (_calculation: unknown, publish: () => unknown) => Promise.resolve(publish()),
    } as unknown as UnifiedScoringService;
    const gameService = createMockGameService() as GameService;
    const predictionService = createMockPredictionService() as PredictionService;
    const service = createDisplayedFitnessService({
      gameService,
      predictionService,
      unifiedScoringService,
    });
    const ignoredFamily: NicheSettings = {
      ignoredTags: [{ type: "family", name: "Digital Implementations: Board Game Arena" }],
    };
    const namesForA = (entries: GameWithScore[]) =>
      entries.find(({ game }) => game.id === "a")?.nichePosition?.niches.map(({ name }) => name) ??
      [];

    capturedSettings = ignoredFamily;
    const liveIgnored = await service.listGames({ includePredicted: false, includeNiches: true });
    expect(namesForA(liveIgnored)).not.toContain("Digital Implementations: Board Game Arena");
    expect(namesForA(liveIgnored)).toContain("Deck Building");
    expect(namesForA(liveIgnored)).toContain("Card Game");

    const snapshot = {
      kind: "public" as const,
      collection: projectProfileCollectionSource(defaultCollection),
      tournament,
      predictionSettings,
      redundancySettings: { ...DEFAULT_REDUNDANCY_SETTINGS },
      nicheSettings: ignoredFamily,
    };
    const snapshotIgnored = await service.listGamesFromSnapshot(snapshot, {
      includePredicted: false,
      includeNiches: true,
    });
    expect(namesForA(snapshotIgnored)).not.toContain("Digital Implementations: Board Game Arena");
    expect(namesForA(snapshotIgnored)).toContain("Deck Building");
    expect(namesForA(snapshotIgnored)).toContain("Card Game");

    capturedSettings = { ignoredTags: [] };
    const restored = await service.listGames({ includePredicted: false, includeNiches: true });
    expect(namesForA(restored)).toContain("Digital Implementations: Board Game Arena");
  });

  test("POST, settings GET, detail GET, restore, and detail GET share live unified storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "niche-settings-unified-http-"));
    try {
      const storage = createStorageService({
        dataDir: directory,
        configPath: join(directory, "config.json"),
        fileOps: createFileOps(),
      });
      const collection = await storage.loadCollection();
      collection.axes = [
        {
          id: "personal",
          name: "Personal",
          description: null,
          weight: 1,
          enabled: true,
          source: "personal",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      collection.games = structuredClone(defaultCollection.games).map((entry) => ({
        ...entry,
        ratings: { personal: 7 },
      }));
      await storage.saveCollection(collection);
      await storage.hydrateSourceVector?.();

      const unifiedScoringService = createUnifiedScoringService({
        storageService: storage,
        cache: null,
        fitnessService: createFitnessService(),
      });
      const app = new Hono();
      app.route("/api", createNicheRoutes({ storageService: storage }).routes);
      const gameRoutes = createGameRoutes({
        gameService: createMockGameService() as GameService,
        predictionService: createMockPredictionService() as PredictionService,
        storageService: storage,
        purchaseUtilizationService: createTestPurchaseUtilizationService(),
        displayedFitnessService: createDisplayedFitnessService({
          gameService: createMockGameService() as GameService,
          predictionService: createMockPredictionService() as PredictionService,
          storageService: storage,
          unifiedScoringService,
        }),
      });
      app.route("/api", gameRoutes.routes);

      const ignoredTags: NicheSettings["ignoredTags"] = [
        { type: "family", name: "Digital Implementations: Board Game Arena" },
        { type: "mechanic", name: "Deck Building" },
        { type: "category", name: "Card Game" },
      ];
      for (const ignoredTag of ignoredTags) {
        const post = await app.request("/api/niches/settings/ignore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ignoredTag),
        });
        expect(post.status).toBe(200);
        const persistedSettings = (await post.json()) as NicheSettings;
        expect(persistedSettings.ignoredTags).toContainEqual(ignoredTag);

        const settingsResponse = await app.request("/api/niches/settings");
        expect(settingsResponse.status).toBe(200);
        const settings = (await settingsResponse.json()) as NicheSettings;
        expect(settings.ignoredTags).toContainEqual(ignoredTag);
        for (const otherTag of ignoredTags.filter((tag) => tag !== ignoredTag)) {
          expect(settings.ignoredTags).not.toContainEqual(otherTag);
        }

        const detailResponse = await app.request("/api/games/a");
        expect(detailResponse.status).toBe(200);
        const detail = (await detailResponse.json()) as GameWithScore;
        const nicheNames = detail.nichePosition?.niches.map(({ name }) => name) ?? [];
        expect(nicheNames).not.toContain(ignoredTag.name);
        for (const otherTag of ignoredTags.filter((tag) => tag !== ignoredTag)) {
          expect(nicheNames).toContain(otherTag.name);
        }
        const restore = await app.request("/api/niches/settings/ignore", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ignoredTag),
        });
        expect(restore.status).toBe(200);
        const restoredSettings = (await restore.json()) as NicheSettings;
        expect(restoredSettings.ignoredTags).not.toContainEqual(ignoredTag);

        const restoredDetailResponse = await app.request("/api/games/a");
        expect(restoredDetailResponse.status).toBe(200);
        const restoredDetail = (await restoredDetailResponse.json()) as GameWithScore;
        expect(restoredDetail.nichePosition?.niches.map(({ name }) => name)).toContain(
          ignoredTag.name,
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("niche settings integration: GET /games?includeNiches=true passthrough", () => {
  test("niche positions reflect ignored tags (includePredicted=false)", async () => {
    // Without ignored tags: games should have "Deck Building" niche
    const appNoFilter = new Hono();
    const { routes: routesNoFilter } = createGameRoutes({
      gameService: createMockGameService() as GameService,
      predictionService: createMockPredictionService() as PredictionService,
      storageService: createMockStorageService({ ignoredTags: [] }) as StorageService,
      purchaseUtilizationService: createTestPurchaseUtilizationService(),
    });
    appNoFilter.route("/api", routesNoFilter);

    const resNoFilter = await appNoFilter.request("/api/games?includeNiches=true");
    expect(resNoFilter.status).toBe(200);
    const bodyNoFilter = (await resNoFilter.json()) as GameWithScore[];
    const gameANoFilter = bodyNoFilter.find((g) => g.game.id === "a")!;
    const nicheNames = gameANoFilter.nichePosition!.niches.map((n) => n.name);
    expect(nicheNames).toContain("Deck Building");
    expect(nicheNames).toContain("Card Game");

    // With "Deck Building" ignored: games should not have that niche
    const appWithFilter = new Hono();
    const { routes: routesWithFilter } = createGameRoutes({
      gameService: createMockGameService() as GameService,
      predictionService: createMockPredictionService() as PredictionService,
      storageService: createMockStorageService({
        ignoredTags: [{ type: "mechanic", name: "Deck Building" }],
      }) as StorageService,
      purchaseUtilizationService: createTestPurchaseUtilizationService(),
    });
    appWithFilter.route("/api", routesWithFilter);

    const resFiltered = await appWithFilter.request("/api/games?includeNiches=true");
    expect(resFiltered.status).toBe(200);
    const bodyFiltered = (await resFiltered.json()) as GameWithScore[];
    const gameAFiltered = bodyFiltered.find((g) => g.game.id === "a")!;
    const filteredNames = gameAFiltered.nichePosition!.niches.map((n) => n.name);
    expect(filteredNames).not.toContain("Deck Building");
    expect(filteredNames).toContain("Card Game");
  });

  test("niche positions reflect ignored tags (includePredicted=true)", async () => {
    // Without ignored tags: games should have "Deck Building" niche
    const appNoFilter = new Hono();
    const { routes: routesNoFilter } = createGameRoutes({
      gameService: createMockGameService() as GameService,
      predictionService: createMockPredictionService() as PredictionService,
      storageService: createMockStorageService({ ignoredTags: [] }) as StorageService,
      purchaseUtilizationService: createTestPurchaseUtilizationService(),
    });
    appNoFilter.route("/api", routesNoFilter);

    const resNoFilter = await appNoFilter.request(
      "/api/games?includeNiches=true&includePredicted=true",
    );
    expect(resNoFilter.status).toBe(200);
    const bodyNoFilter = (await resNoFilter.json()) as GameWithScore[];
    const gameANoFilter = bodyNoFilter.find((g) => g.game.id === "a")!;
    const nicheNames = gameANoFilter.nichePosition!.niches.map((n) => n.name);
    expect(nicheNames).toContain("Deck Building");

    // With "Deck Building" ignored
    const appWithFilter = new Hono();
    const { routes: routesWithFilter } = createGameRoutes({
      gameService: createMockGameService() as GameService,
      predictionService: createMockPredictionService() as PredictionService,
      storageService: createMockStorageService({
        ignoredTags: [{ type: "mechanic", name: "Deck Building" }],
      }) as StorageService,
      purchaseUtilizationService: createTestPurchaseUtilizationService(),
    });
    appWithFilter.route("/api", routesWithFilter);

    const resFiltered = await appWithFilter.request(
      "/api/games?includeNiches=true&includePredicted=true",
    );
    expect(resFiltered.status).toBe(200);
    const bodyFiltered = (await resFiltered.json()) as GameWithScore[];
    const gameAFiltered = bodyFiltered.find((g) => g.game.id === "a")!;
    const filteredNames = gameAFiltered.nichePosition!.niches.map((n) => n.name);
    expect(filteredNames).not.toContain("Deck Building");
  });
});

describe("niche settings integration: GET /predictions/bgg/:bggId passthrough", () => {
  test("niche impact excludes ignored tags", async () => {
    // Without ignored tags: candidate's "Deck Building" should appear in impact
    const appNoFilter = new Hono();
    const { routes: routesNoFilter } = createPredictionRoutes({
      predictionService: createMockPredictionService() as PredictionService,
      storageService: createMockStorageService({ ignoredTags: [] }) as StorageService,
    });
    appNoFilter.route("/api", routesNoFilter);

    const resNoFilter = await appNoFilter.request("/api/predictions/bgg/12345");
    expect(resNoFilter.status).toBe(200);
    const bodyNoFilter = (await resNoFilter.json()) as {
      nicheImpact: { wouldJoin: { name: string }[] };
    };
    const impactNames = bodyNoFilter.nicheImpact.wouldJoin.map((e) => e.name);
    expect(impactNames).toContain("Deck Building");

    // With "Deck Building" ignored: candidate's impact should not include it
    const appWithFilter = new Hono();
    const { routes: routesWithFilter } = createPredictionRoutes({
      predictionService: createMockPredictionService() as PredictionService,
      storageService: createMockStorageService({
        ignoredTags: [{ type: "mechanic", name: "Deck Building" }],
      }) as StorageService,
    });
    appWithFilter.route("/api", routesWithFilter);

    const resFiltered = await appWithFilter.request("/api/predictions/bgg/12345");
    expect(resFiltered.status).toBe(200);
    const bodyFiltered = (await resFiltered.json()) as {
      nicheImpact: { wouldJoin: { name: string }[] };
    };
    const filteredImpact = bodyFiltered.nicheImpact.wouldJoin.map((e) => e.name);
    expect(filteredImpact).not.toContain("Deck Building");
  });
});
