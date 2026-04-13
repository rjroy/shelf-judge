import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createGameRoutes } from "../src/routes/games";
import { createPredictionRoutes } from "../src/routes/prediction";
import type {
  Game,
  GameWithScore,
  FitnessResult,
  BggGameData,
  RedundancySettings,
  NicheSettings,
  Collection,
  PredictedGameResponse,
} from "@shelf-judge/shared";
import type { GameService } from "../src/services/game-service";
import type { PredictionService } from "../src/services/prediction-service";
import type { StorageService } from "../src/services/storage-service";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../src/services/redundancy-engine";

// --- Fixture helpers ---

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

function makeGame(id: string, name: string, bggData: BggGameData | null): Game {
  return {
    id,
    bggId: bggData ? 1 : null,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    imageUrl: null,
    bggData,
    numPlays: null,
    ownership: "owned",
    ratings: {},
    createdAt: now,
    updatedAt: now,
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

const mech = (name: string) => ({ id: Math.random(), name });
const cat = (name: string) => ({ id: Math.random(), name });

// Three games with identical mechanics (high similarity) and different scores.
// This ensures the redundancy engine finds niche neighbors.
const gameA = makeGame(
  "a",
  "Alpha",
  makeBggData({
    mechanics: [mech("Deck Building"), mech("Hand Management")],
    categories: [cat("Card Game")],
  }),
);
const gameB = makeGame(
  "b",
  "Beta",
  makeBggData({
    mechanics: [mech("Deck Building"), mech("Hand Management")],
    categories: [cat("Card Game")],
  }),
);
const gameC = makeGame(
  "c",
  "Charlie",
  makeBggData({
    mechanics: [mech("Deck Building"), mech("Hand Management")],
    categories: [cat("Card Game")],
  }),
);

const allGamesWithScores: GameWithScore[] = [
  { game: gameA, score: makeScore(8.0) },
  { game: gameB, score: makeScore(6.0) },
  { game: gameC, score: makeScore(4.0) },
];

const defaultCollection: Collection = {
  id: "collection-1",
  name: "Test",
  axes: [],
  games: [gameA, gameB, gameC],
  createdAt: now,
  updatedAt: now,
};

// --- Mock factories ---

function createMockStorageService(
  redundancySettings: RedundancySettings,
  nicheSettings: NicheSettings = { ignoredTags: [] },
  collection: Collection = defaultCollection,
): Partial<StorageService> {
  return {
    loadRedundancySettings: () => Promise.resolve(structuredClone(redundancySettings)),
    saveRedundancySettings: () => Promise.resolve(),
    loadNicheSettings: () => Promise.resolve(structuredClone(nicheSettings)),
    saveNicheSettings: () => Promise.resolve(),
    loadCollection: () => Promise.resolve(structuredClone(collection)),
    saveCollection: () => Promise.resolve(),
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
  };
}

function createMockPredictionService(): Partial<PredictionService> {
  return {
    listGamesWithPredictions: () => Promise.resolve(structuredClone(allGamesWithScores)),
    predictBggGame: () => {
      // Return a candidate sharing the same mechanics (high similarity)
      const candidateGame = makeGame(
        "candidate",
        "Candidate",
        makeBggData({
          mechanics: [mech("Deck Building"), mech("Hand Management")],
          categories: [cat("Card Game")],
        }),
      );
      return Promise.resolve({
        game: candidateGame,
        score: makeScore(5.0),
        tension: null,
        predictionUnavailable: null,
      });
    },
  };
}

// Enabled settings with low threshold to ensure neighbors are found
const enabledAnnotation: RedundancySettings = {
  ...DEFAULT_REDUNDANCY_SETTINGS,
  enabled: true,
  stage: "annotation",
  similarityThreshold: 0.1, // low threshold to guarantee neighbors
  minNeighbors: 1,
  expectedNeighbors: 5,
};

const enabledIntegrated: RedundancySettings = {
  ...enabledAnnotation,
  stage: "integrated",
};

function buildApp(redundancySettings: RedundancySettings) {
  const storage = createMockStorageService(redundancySettings);
  const gameRoutes = createGameRoutes({
    gameService: createMockGameService() as GameService,
    predictionService: createMockPredictionService() as PredictionService,
    storageService: storage as StorageService,
  });
  const predictionRoutes = createPredictionRoutes({
    predictionService: createMockPredictionService() as PredictionService,
    storageService: storage as StorageService,
  });
  const app = new Hono();
  app.route("/api", gameRoutes.routes);
  app.route("/api", predictionRoutes.routes);
  return app;
}

// --- Tests ---

describe("redundancy integration: GET /games/:id", () => {
  test("includes redundancyAdjustment when enabled", async () => {
    const app = buildApp(enabledAnnotation);
    const res = await app.request("/api/games/b");
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameWithScore;
    expect(body.score!.redundancyAdjustment).not.toBeNull();
    expect(body.score!.redundancyAdjustment!.penalty).toBeGreaterThanOrEqual(0);
    expect(body.score!.redundancyAdjustment!.nicheNeighbors.length).toBeGreaterThanOrEqual(1);
  });

  test("redundancyAdjustment is null when disabled", async () => {
    const app = buildApp({ ...DEFAULT_REDUNDANCY_SETTINGS, enabled: false });
    const res = await app.request("/api/games/a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameWithScore;
    expect(body.score!.redundancyAdjustment).toBeNull();
  });

  test("annotation mode: score.score unchanged, adjustedScore reflects penalty", async () => {
    const app = buildApp(enabledAnnotation);
    // Game C (score 4.0) has two better neighbors, should get a penalty
    const res = await app.request("/api/games/c");
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameWithScore;
    const adj = body.score!.redundancyAdjustment!;
    expect(adj).not.toBeNull();
    // In annotation mode, score.score should remain original
    expect(body.score!.score).toBe(adj.originalScore);
    expect(adj.adjustedScore).toBeLessThanOrEqual(adj.originalScore);
  });

  test("integrated mode: score.score equals adjustedScore", async () => {
    const app = buildApp(enabledIntegrated);
    // Game C should have penalty applied to score.score
    const res = await app.request("/api/games/c");
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameWithScore;
    const adj = body.score!.redundancyAdjustment!;
    expect(adj).not.toBeNull();
    expect(body.score!.score).toBe(adj.adjustedScore);
  });
});

describe("redundancy integration: GET /games", () => {
  test("includes adjustments on all games when enabled", async () => {
    const app = buildApp(enabledAnnotation);
    const res = await app.request("/api/games");
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameWithScore[];
    // At least one game should have a non-null adjustment
    const withAdjustment = body.filter((g) => g.score?.redundancyAdjustment !== null);
    expect(withAdjustment.length).toBeGreaterThanOrEqual(1);
  });

  test("adjustments present with includePredicted=true", async () => {
    const app = buildApp(enabledAnnotation);
    const res = await app.request("/api/games?includePredicted=true");
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameWithScore[];
    const withAdjustment = body.filter((g) => g.score?.redundancyAdjustment !== null);
    expect(withAdjustment.length).toBeGreaterThanOrEqual(1);
  });

  test("no adjustments when disabled", async () => {
    const app = buildApp({ ...DEFAULT_REDUNDANCY_SETTINGS, enabled: false });
    const res = await app.request("/api/games");
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameWithScore[];
    for (const g of body) {
      expect(g.score?.redundancyAdjustment).toBeNull();
    }
  });
});

describe("redundancy integration: GET /predictions/bgg/:bggId", () => {
  test("includes redundancyPreview when enabled", async () => {
    const app = buildApp(enabledAnnotation);
    const res = await app.request("/api/predictions/bgg/12345");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PredictedGameResponse;
    // The candidate shares mechanics with existing games, so preview should be non-null
    expect(body.redundancyPreview).not.toBeNull();
    expect(body.redundancyPreview!.nicheNeighbors.length).toBeGreaterThanOrEqual(1);

    // REQ-REDUN-23: preview uses pre-redundancy scores for existing games.
    // Neighbor fitness scores should match the original fixture scores (8.0, 6.0, 4.0).
    const neighborScores = body.redundancyPreview!.nicheNeighbors.map((n) => n.fitnessScore);
    const knownScores = [8.0, 6.0, 4.0];
    for (const ns of neighborScores) {
      expect(knownScores).toContain(ns);
    }
  });

  test("redundancyPreview is null when disabled", async () => {
    const app = buildApp({ ...DEFAULT_REDUNDANCY_SETTINGS, enabled: false });
    const res = await app.request("/api/predictions/bgg/12345");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PredictedGameResponse;
    expect(body.redundancyPreview).toBeNull();
  });
});

describe("redundancy integration: penalty consistency across routes", () => {
  test("GET /games/:id penalties match GET /games penalties", async () => {
    const app = buildApp(enabledAnnotation);

    // Fetch collection
    const listRes = await app.request("/api/games");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as GameWithScore[];

    // Fetch each game individually and compare penalties
    for (const gws of list) {
      if (!gws.score?.redundancyAdjustment) continue;
      const detailRes = await app.request(`/api/games/${gws.game.id}`);
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as GameWithScore;
      expect(detail.score!.redundancyAdjustment!.penalty).toBe(
        gws.score.redundancyAdjustment.penalty,
      );
      expect(detail.score!.redundancyAdjustment!.adjustedScore).toBe(
        gws.score.redundancyAdjustment.adjustedScore,
      );
    }
  });

  test("GET /games and GET /games?includePredicted=true produce same penalties", async () => {
    const app = buildApp(enabledAnnotation);

    const plainRes = await app.request("/api/games");
    const predictedRes = await app.request("/api/games?includePredicted=true");
    expect(plainRes.status).toBe(200);
    expect(predictedRes.status).toBe(200);

    const plain = (await plainRes.json()) as GameWithScore[];
    const predicted = (await predictedRes.json()) as GameWithScore[];

    for (const pg of plain) {
      const match = predicted.find((g) => g.game.id === pg.game.id);
      if (!pg.score?.redundancyAdjustment || !match?.score?.redundancyAdjustment) continue;
      expect(pg.score.redundancyAdjustment.penalty).toBe(match.score.redundancyAdjustment.penalty);
    }
  });
});

describe("redundancy integration: niche positions use pre-redundancy scores", () => {
  test("niche rankings are not affected by redundancy in integrated mode", async () => {
    // Build two apps: one annotation, one integrated
    const appAnnotation = buildApp(enabledAnnotation);
    const appIntegrated = buildApp(enabledIntegrated);

    const resAnnotation = await appAnnotation.request("/api/games/a");
    const resIntegrated = await appIntegrated.request("/api/games/a");

    const bodyAnnotation = (await resAnnotation.json()) as GameWithScore;
    const bodyIntegrated = (await resIntegrated.json()) as GameWithScore;

    // Niche positions should be the same because they're computed on pre-redundancy scores
    // (niches run before redundancy in both modes)
    expect(bodyAnnotation.nichePosition).not.toBeNull();
    expect(bodyIntegrated.nichePosition).not.toBeNull();
    if (bodyAnnotation.nichePosition && bodyIntegrated.nichePosition) {
      expect(bodyAnnotation.nichePosition.niches.length).toBe(
        bodyIntegrated.nichePosition.niches.length,
      );
      for (let i = 0; i < bodyAnnotation.nichePosition.niches.length; i++) {
        expect(bodyAnnotation.nichePosition.niches[i].rank).toBe(
          bodyIntegrated.nichePosition.niches[i].rank,
        );
      }
    }
  });
});
