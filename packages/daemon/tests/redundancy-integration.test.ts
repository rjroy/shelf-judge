import { describe, expect, test } from "bun:test";
import { semanticGenerationFixture } from "./helpers/semantic-redundancy-fixtures";
import { Hono } from "hono";
import { createGameRoutes } from "../src/routes/games";
import { createPredictionRoutes } from "../src/routes/prediction";
import type {
  GameWithScore,
  GameWithPurchaseUtilization,
  FitnessResult,
  BggGameData,
  RedundancySettings,
  NicheSettings,
  Collection,
  PredictedGameResponse,
  DurableGame,
} from "@shelf-judge/shared";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyState,
} from "@shelf-judge/shared";
import type { GameService } from "../src/services/game-service";
import type { PredictionService } from "../src/services/prediction-service";
import type { StorageService } from "../src/services/storage-service";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../src/services/redundancy-engine";
import { createTestPurchaseUtilizationService } from "./helpers/test-app";

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
    bestPlayerCount: null,
    fetchedAt: now,
    ...overrides,
  };
}

function makeGame(
  id: string,
  name: string,
  bggData: BggGameData | null,
  overrides: Partial<DurableGame> = {},
): DurableGame {
  const game: DurableGame = {
    id,
    bggId: bggData ? 12345 : null,
    entityMetadata: createInitialEntityMetadata(bggData ? 12345 : null),
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return {
    ...game,
    entityMetadata: createInitialEntityMetadata(game.bggId),
    latestPlayCountCheck: null,
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

const mech = (name: string) => ({ id: name.length, name });
const cat = (name: string) => ({ id: name.length, name });

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
  { minPlayers: 1, maxPlayers: 2, playingTime: 180 },
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
  schemaVersion: 9,
  revision: 0,
  id: "collection-1",
  name: "Test",
  axes: [
    {
      id: "players",
      name: "Player Count Fit",
      description: null,
      weight: 50,
      enabled: true,
      source: "derived",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 4 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "time",
      name: "Play Time",
      description: null,
      weight: 50,
      enabled: true,
      source: "derived",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 90 },
      createdAt: now,
      updatedAt: now,
    },
  ],
  games: [gameA, gameB, gameC],
  entertainmentBenchmark: null,
  semanticRedundancy: createInitialSemanticRedundancyState(),
  intentions: [],
  attentionDispositions: [],
  commandReceipts: [],
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
    loadTournament: () =>
      Promise.resolve({
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
        sessions: [],
        gameStats: {},
      }),
    saveTournament: () => Promise.resolve(),
    loadProfile: () => Promise.resolve(null),
    saveProfile: () => Promise.resolve(),
    loadPredictionSettings: () =>
      Promise.resolve({
        stageThresholds: [5, 15, 30] as [number, number, number],
        defaultK: 5,
        minSimilarityThreshold: 0.2,
      }),
    savePredictionSettings: () => Promise.resolve(),
  };
}

function createMockGameService(games: GameWithScore[] = allGamesWithScores): Partial<GameService> {
  return {
    getGame: (id: string) => {
      const gws = games.find((g) => g.game.id === id);
      if (!gws) return Promise.reject(new Error(`Game not found: ${id}`));
      return Promise.resolve(structuredClone(gws));
    },
    listGames: () => Promise.resolve(structuredClone(games)),
    listGamesFromSnapshot: () => structuredClone(games),
  };
}

function createMockPredictionService(
  games: GameWithScore[] = allGamesWithScores,
): Partial<PredictionService> {
  return {
    listGamesWithPredictions: () => Promise.resolve(structuredClone(games)),
    listGamesWithPredictionsFromSnapshot: () => Promise.resolve(structuredClone(games)),
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

function buildApp(
  redundancySettings: RedundancySettings,
  collection: Collection = defaultCollection,
  games: GameWithScore[] = allGamesWithScores,
) {
  const storage = createMockStorageService(redundancySettings, undefined, collection);
  const gameRoutes = createGameRoutes({
    gameService: createMockGameService(games) as GameService,
    predictionService: createMockPredictionService(games) as PredictionService,
    storageService: storage as StorageService,
    purchaseUtilizationService: createTestPurchaseUtilizationService(storage as StorageService),
  });
  const predictionRoutes = createPredictionRoutes({
    predictionService: createMockPredictionService(games) as PredictionService,
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

  test("vetoed scored games retain collection status on list and detail without pair eligibility", async () => {
    const collection = structuredClone(defaultCollection);
    collection.semanticRedundancy.settings.enabled = true;
    const games = structuredClone(allGamesWithScores);
    const vetoed = games.find(({ game }) => game.id === "a");
    if (!vetoed?.score) throw new Error("Expected vetoed-game fixture score");
    vetoed.score.score = 0;
    vetoed.score.vetoed = true;
    vetoed.score.vetoedBy = {
      axisId: "fun",
      axisName: "Fun",
      threshold: 2,
      direction: "below",
      rawValue: 1,
    };
    vetoed.score.hypotheticalScore = 8;
    const app = buildApp(enabledAnnotation, collection, games);
    const listResponse = await app.request("/api/games");
    const detailResponse = await app.request("/api/games/a");
    const list = (await listResponse.json()) as GameWithPurchaseUtilization[];
    const detail = (await detailResponse.json()) as GameWithPurchaseUtilization;
    const listEntry = list.find(({ game }) => game.id === "a");
    if (!listEntry?.score || !detail.score) throw new Error("Expected vetoed scored entries");
    expect(listEntry.score.vetoed).toBe(true);
    expect(detail.score.vetoed).toBe(true);
    expect(listEntry.score.redundancyAdjustment).toBeNull();
    expect(detail.score.redundancyAdjustment).toBeNull();
    expect(listEntry.score.redundancySimilarityInfo).toEqual({
      status: "not-ready",
      generationId: null,
    });
    expect(detail.score.redundancySimilarityInfo).toEqual(listEntry.score.redundancySimilarityInfo);
  });

  test("semantic enabled without a published generation reports the same note-free status on list and detail", async () => {
    const collection = structuredClone(defaultCollection);
    collection.semanticRedundancy.settings.enabled = true;
    const settings = { ...enabledAnnotation, similarityThreshold: 1.01 };
    const app = buildApp(settings, collection);
    const listResponse = await app.request("/api/games");
    const detailResponse = await app.request("/api/games/c");
    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    const list = (await listResponse.json()) as GameWithPurchaseUtilization[];
    const detail = (await detailResponse.json()) as GameWithPurchaseUtilization;
    const listEntry = list.find(({ game }) => game.id === "c");
    if (!listEntry?.score || !detail.score) throw new Error("Expected scored list/detail entries");
    expect(listEntry.score.redundancyAdjustment).toBeNull();
    expect(detail.score.redundancyAdjustment).toBeNull();
    expect(listEntry.score.redundancySimilarityInfo).toEqual({
      status: "not-ready",
      generationId: null,
    });
    expect(detail.score.redundancySimilarityInfo).toEqual(listEntry.score.redundancySimilarityInfo);
    expect(JSON.stringify(listEntry)).not.toContain("ownerNote");
    expect(detail.game).toHaveProperty("ownerNote");
    expect(JSON.stringify(detail.score.redundancySimilarityInfo)).not.toContain("ownerNote");

    // This valid-shaped generation intentionally carries the fixture source identity and is stale.
    collection.semanticRedundancy.publishedGeneration = semanticGenerationFixture({
      id: "published-generation",
      evidenceEpoch: collection.semanticRedundancy.evidenceEpoch,
      consentEpoch: collection.semanticRedundancy.consentEpoch,
      modelId: "pinned-model",
      publishedAt: now,
    });
    const staleApp = buildApp(settings, collection);
    const staleListResponse = await staleApp.request("/api/games");
    const staleDetailResponse = await staleApp.request("/api/games/c");
    const staleList = (await staleListResponse.json()) as GameWithPurchaseUtilization[];
    const staleDetail = (await staleDetailResponse.json()) as GameWithPurchaseUtilization;
    const staleEntry = staleList.find(({ game }) => game.id === "c");
    if (!staleEntry?.score || !staleDetail.score)
      throw new Error("Expected scored stale list/detail entries");
    expect(staleEntry.score.redundancySimilarityInfo).toEqual({
      status: "stale",
      generationId: null,
    });
    expect(staleDetail.score.redundancySimilarityInfo).toEqual(
      staleEntry.score.redundancySimilarityInfo,
    );
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

describe("redundancy integration: BGG candidate preview", () => {
  test("semantic-enabled current C/D generation does not change the factual candidate preview", async () => {
    const withoutSemanticGeneration = structuredClone(defaultCollection);
    const factualApp = buildApp(enabledAnnotation, withoutSemanticGeneration);
    const factualResponse = await factualApp.request("/api/predictions/bgg/12345");
    expect(factualResponse.status).toBe(200);
    const factualBody = (await factualResponse.json()) as PredictedGameResponse;

    const semanticCollection = structuredClone(defaultCollection);
    semanticCollection.semanticRedundancy.settings.enabled = true;
    semanticCollection.semanticRedundancy.publishedGeneration = semanticGenerationFixture({
      id: "current-c-d-generation",
      signalScope: "description-and-owner-notes",
      weights: { factual: 0, description: 100, ownerNote: 100 },
      pairOutcomes: [
        {
          gameA: "a",
          gameB: "candidate",
          description: null,
          ownerNote: {
            status: "scored",
            score: 0,
            confidence: 1,
            modelId: "fixture-model",
            rubricVersion: 1,
            sourceFingerprintA: "a".repeat(64),
            sourceFingerprintB: "b".repeat(64),
            noteVersionA: 1,
            noteVersionB: null,
            requestContext: { kind: "owner-notes-only", ownerNoteRepresentationVersion: 1 },
          },
        },
      ],
    });
    const semanticApp = buildApp(enabledAnnotation, semanticCollection);
    const semanticResponse = await semanticApp.request("/api/predictions/bgg/12345");
    expect(semanticResponse.status).toBe(200);
    const semanticBody = (await semanticResponse.json()) as PredictedGameResponse;

    expect(factualBody.redundancyPreview).not.toBeNull();
    expect(factualBody.redundancyPreview?.penalty).toBeGreaterThan(0);
    expect(semanticBody.redundancyPreview).toEqual(factualBody.redundancyPreview);
    expect(JSON.stringify(semanticBody)).not.toContain("ownerNote");
    expect(JSON.stringify(semanticBody)).not.toContain("Private");
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
  test("integrated list and detail use the same adjusted score for utilization", async () => {
    const app = buildApp(enabledIntegrated);
    const listResponse = await app.request("/api/games");
    const detailResponse = await app.request("/api/games/c");
    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    const list = (await listResponse.json()) as GameWithPurchaseUtilization[];
    const detail = (await detailResponse.json()) as GameWithPurchaseUtilization;
    const listEntry = list.find((entry) => entry.game.id === "c");
    expect(listEntry).toBeDefined();
    expect(listEntry?.score?.score).toBe(detail.score?.score);
    expect(listEntry?.score?.redundancySimilarityInfo).toEqual(
      detail.score?.redundancySimilarityInfo,
    );
    expect(listEntry?.displayScore).toBe(detail.displayScore);
    expect(listEntry?.purchaseUtilization).toEqual(detail.purchaseUtilization);
    expect(detail.score?.score).toBe(detail.score?.redundancyAdjustment?.adjustedScore);
    expect(detail.purchaseUtilization.evidence.fitness).toMatchObject({
      status: "valid",
      value: detail.displayScore,
    });
  });

  test("derived axes do not change redundancy results or introduce non-finite values", async () => {
    const withoutDerived = { ...defaultCollection, axes: [] };
    const withDerivedResponse = await buildApp(enabledAnnotation).request("/api/games");
    const withoutDerivedResponse = await buildApp(enabledAnnotation, withoutDerived).request(
      "/api/games",
    );
    const withDerived = (await withDerivedResponse.json()) as GameWithScore[];
    const baseline = (await withoutDerivedResponse.json()) as GameWithScore[];

    expect(withDerived).toEqual(baseline);
    for (const game of withDerived) {
      const adjustment = game.score?.redundancyAdjustment;
      if (!adjustment) continue;
      expect(Number.isFinite(adjustment.penalty)).toBe(true);
      expect(Number.isFinite(adjustment.adjustedScore)).toBe(true);
      expect(
        adjustment.nicheNeighbors.every((neighbor) => Number.isFinite(neighbor.similarity)),
      ).toBe(true);
    }
  });

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
      expect(detail.score!.redundancySimilarityInfo).toEqual(gws.score.redundancySimilarityInfo);
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
