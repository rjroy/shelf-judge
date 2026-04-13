import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createGameRoutes } from "../src/routes/games";
import { createPredictionRoutes } from "../src/routes/prediction";
import type {
  Game,
  GameWithScore,
  FitnessResult,
  BggGameData,
  NicheSettings,
  Collection,
} from "@shelf-judge/shared";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../src/services/redundancy-engine";
import type { GameService } from "../src/services/game-service";
import type { PredictionService } from "../src/services/prediction-service";
import type { StorageService } from "../src/services/storage-service";

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
    suggestedPlayerCounts: [],
    fetchedAt: "2026-01-01T00:00:00Z",
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
const mech = (name: string) => ({ id: Math.random(), name });
const cat = (name: string) => ({ id: Math.random(), name });

const gameA = makeGame(
  "a",
  "Alpha",
  makeBggData({ mechanics: [mech("Deck Building")], categories: [cat("Card Game")] }),
);
const gameB = makeGame(
  "b",
  "Beta",
  makeBggData({ mechanics: [mech("Deck Building")], categories: [cat("Card Game")] }),
);
const gameC = makeGame(
  "c",
  "Charlie",
  makeBggData({ mechanics: [mech("Deck Building"), mech("Worker Placement")] }),
);

const allGamesWithScores: GameWithScore[] = [
  { game: gameA, score: makeScore(8.0) },
  { game: gameB, score: makeScore(7.0) },
  { game: gameC, score: makeScore(6.0) },
];

// --- Mock factories ---

const defaultCollection: Collection = {
  id: "collection-1",
  name: "Test",
  axes: [],
  games: [gameA, gameB, gameC],
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
      // Return a new candidate game that shares "Deck Building" mechanic
      const candidateGame = makeGame(
        "candidate",
        "Candidate",
        makeBggData({ mechanics: [mech("Deck Building")] }),
      );
      return Promise.resolve({
        game: candidateGame,
        score: makeScore(7.5),
        tension: null,
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

describe("niche settings integration: GET /games?includeNiches=true passthrough", () => {
  test("niche positions reflect ignored tags (includePredicted=false)", async () => {
    // Without ignored tags: games should have "Deck Building" niche
    const appNoFilter = new Hono();
    const { routes: routesNoFilter } = createGameRoutes({
      gameService: createMockGameService() as GameService,
      predictionService: createMockPredictionService() as PredictionService,
      storageService: createMockStorageService({ ignoredTags: [] }) as StorageService,
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
