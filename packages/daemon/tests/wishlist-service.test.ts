import { describe, expect, test, beforeEach } from "bun:test";
import type {
  WishlistEntry,
  Collection,
  NicheSettings,
  Game,
  FitnessResult,
} from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import type { PredictionService, PredictedGameResult } from "../src/services/prediction-service";
import type { GameService } from "../src/services/game-service";
import { createWishlistService } from "../src/services/wishlist-service";

const NOW = "2026-04-12T12:00:00.000Z";

function makeGame(bggId: number, name: string): Game {
  return {
    id: `preview-${bggId}`,
    bggId,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    imageUrl: `https://example.com/${bggId}.jpg`,
    numPlays: null,
    bggData: {
      communityRating: 7.5,
      bayesAverage: 7.2,
      weight: 3.0,
      numWeightVotes: 100,
      description: null,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      suggestedPlayerCounts: [],
      fetchedAt: NOW,
    },
    ratings: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeFitnessResult(score: number, unavailable: boolean): FitnessResult {
  if (unavailable) {
    return {
      score: 0,
      ratedAxisCount: 0,
      totalAxisCount: 0,
      breakdown: [],
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: null,
      redundancyAdjustment: null,
    };
  }
  return {
    score,
    ratedAxisCount: 1,
    totalAxisCount: 1,
    breakdown: [
      {
        axisId: "ax1",
        axisName: "Fun",
        weight: 50,
        rating: 7,
        contribution: 3.5,
        source: "predicted" as const,
        bggOriginal: null,
        rawValue: 7,
        effectiveRating: 7,
        preferenceShape: "higher-is-better" as const,
        curveAffected: false,
        predictionConfidence: "strong" as const,
        referenceGames: null,
      },
    ],
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: {
      readinessStage: 2 as const,
      confidence: "strong" as const,
      predictedAxisCount: 1,
      actualAxisCount: 0,
      referenceGameCount: 5,
      coveragePercent: 1.0,
    },
    redundancyAdjustment: null,
  };
}

function createMockStorage(
  wishlist: WishlistEntry[] = [],
  collection?: Partial<Collection>,
): StorageService {
  let stored = structuredClone(wishlist);
  const coll: Collection = {
    id: "coll-1",
    name: "Test",
    axes: [],
    games: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...collection,
  };

  return {
    loadWishlist: () => Promise.resolve(structuredClone(stored)),
    saveWishlist: (entries) => {
      stored = structuredClone(entries);
      return Promise.resolve();
    },
    loadCollection: () => Promise.resolve(structuredClone(coll)),
    saveCollection: () => Promise.resolve(),
    loadNicheSettings: () => Promise.resolve({ ignoredTags: [] } as NicheSettings),
    saveNicheSettings: () => Promise.resolve(),
    // Unused stubs
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
    loadRedundancySettings: () =>
      Promise.resolve({
        enabled: false,
        stage: "annotation" as const,
        similarityThreshold: 0.6,
        maxPenalty: 2.0,
        componentWeights: { binary: 0.4, continuous: 0.3, personalAxes: 0.3 },
        minNeighbors: 1,
        expectedNeighbors: 5,
      }),
    saveRedundancySettings: () => Promise.resolve(),
  };
}

function createMockPredictionService(results: Map<number, PredictedGameResult>): PredictionService {
  return {
    predictBggGame: (bggId: number) => {
      const r = results.get(bggId);
      if (!r) return Promise.reject(new Error(`No game found with BGG ID ${bggId}`));
      return Promise.resolve(r);
    },
    listGamesWithPredictions: () => Promise.resolve([]),
    predictGame: () => Promise.reject(new Error("not implemented")),
    getReadiness: () => Promise.reject(new Error("not implemented")),
    getSettings: () => Promise.reject(new Error("not implemented")),
    updateSettings: () => Promise.reject(new Error("not implemented")),
  };
}

function createMockGameService(): GameService {
  return {
    listGames: () => Promise.resolve([]),
    getGame: () => Promise.reject(new Error("not implemented")),
    addGame: () => Promise.reject(new Error("not implemented")),
    rateGame: () => Promise.reject(new Error("not implemented")),
    removeGame: () => Promise.reject(new Error("not implemented")),
    refreshBggData: () => Promise.reject(new Error("not implemented")),
    refreshAllBggData: () => Promise.reject(new Error("not implemented")),
    searchGames: () => Promise.reject(new Error("not implemented")),
    importBggCollection: () => Promise.reject(new Error("not implemented")),
  };
}

describe("wishlist service", () => {
  const game100 = makeGame(100, "Test Game");
  const score100 = makeFitnessResult(7.5, false);
  const result100: PredictedGameResult = {
    game: game100,
    score: score100,
    tension: null,
    predictionUnavailable: null,
  };

  const game200 = makeGame(200, "Another Game");
  const score200 = makeFitnessResult(0, true);
  const result200: PredictedGameResult = {
    game: game200,
    score: score200,
    tension: null,
    predictionUnavailable: {
      reason: "stage-0",
      ratedGameCount: 2,
      gamesNeeded: 3,
    },
  };

  const predictions = new Map<number, PredictedGameResult>([
    [100, result100],
    [200, result200],
  ]);

  let storage: StorageService;
  let predictionService: PredictionService;
  let gameService: GameService;

  beforeEach(() => {
    storage = createMockStorage();
    predictionService = createMockPredictionService(predictions);
    gameService = createMockGameService();
  });

  test("add creates entry with correct fields", async () => {
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });
    const entry = await svc.add(100);

    expect(entry.bggId).toBe(100);
    expect(entry.name).toBe("Test Game");
    expect(entry.yearPublished).toBe(2020);
    expect(entry.thumbnailUrl).toBe("https://example.com/100.jpg");
    expect(entry.predictedScore).toBe(7.5);
    expect(entry.predictionConfidence).toBe("strong");
    expect(entry.predictedBreakdown).toHaveLength(1);
    expect(entry.predictedBreakdown![0].axisName).toBe("Fun");
    expect(entry.predictedBreakdown![0].rating).toBe(7);
    expect(entry.predictedBreakdown![0].confidence).toBe("strong");
    expect(entry.addedAt).toBeTruthy();
    expect(entry.id).toBeTruthy();
  });

  test("add with Stage 0 creates entry with null prediction fields", async () => {
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });
    const entry = await svc.add(200);

    expect(entry.bggId).toBe(200);
    expect(entry.name).toBe("Another Game");
    expect(entry.predictedScore).toBeNull();
    expect(entry.predictionConfidence).toBeNull();
    expect(entry.predictedBreakdown).toBeNull();
  });

  test("add rejects duplicate bggId in wishlist", async () => {
    const existing: WishlistEntry = {
      id: "existing-1",
      bggId: 100,
      name: "Test Game",
      yearPublished: 2020,
      thumbnailUrl: null,
      predictedScore: 7.5,
      predictionConfidence: "strong",
      predictedBreakdown: null,
      nicheImpact: null,
      addedAt: NOW,
    };
    storage = createMockStorage([existing]);
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- Bun's expect().rejects is thenable
    await expect(svc.add(100)).rejects.toThrow("already on your wishlist");
  });

  test("add rejects bggId already in collection", async () => {
    const collGame = makeGame(100, "Test Game");
    collGame.id = "game-1"; // real collection game ID
    storage = createMockStorage([], { games: [collGame] });
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- Bun's expect().rejects is thenable
    await expect(svc.add(100)).rejects.toThrow("already in your collection");
  });

  test("remove deletes entry by ID", async () => {
    const existing: WishlistEntry = {
      id: "entry-1",
      bggId: 100,
      name: "Test Game",
      yearPublished: 2020,
      thumbnailUrl: null,
      predictedScore: 7.5,
      predictionConfidence: "strong",
      predictedBreakdown: null,
      nicheImpact: null,
      addedAt: NOW,
    };
    storage = createMockStorage([existing]);
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });

    await svc.remove("entry-1");
    const list = await svc.list();
    expect(list).toHaveLength(0);
  });

  test("remove throws for nonexistent ID", async () => {
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- Bun's expect().rejects is thenable
    await expect(svc.remove("nonexistent")).rejects.toThrow("not found");
  });

  test("clear removes all entries and returns count", async () => {
    const entries: WishlistEntry[] = [
      {
        id: "e1",
        bggId: 100,
        name: "A",
        yearPublished: null,
        thumbnailUrl: null,
        predictedScore: null,
        predictionConfidence: null,
        predictedBreakdown: null,
        nicheImpact: null,
        addedAt: NOW,
      },
      {
        id: "e2",
        bggId: 200,
        name: "B",
        yearPublished: null,
        thumbnailUrl: null,
        predictedScore: null,
        predictionConfidence: null,
        predictedBreakdown: null,
        nicheImpact: null,
        addedAt: NOW,
      },
    ];
    storage = createMockStorage(entries);
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });

    const count = await svc.clear();
    expect(count).toBe(2);
    const list = await svc.list();
    expect(list).toHaveLength(0);
  });

  test("refresh updates prediction fields without changing addedAt", async () => {
    const originalAddedAt = "2026-01-01T00:00:00.000Z";
    const existing: WishlistEntry = {
      id: "entry-1",
      bggId: 100,
      name: "Test Game",
      yearPublished: 2020,
      thumbnailUrl: null,
      predictedScore: 5.0,
      predictionConfidence: "weak",
      predictedBreakdown: null,
      nicheImpact: null,
      addedAt: originalAddedAt,
    };
    storage = createMockStorage([existing]);
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });

    const refreshed = await svc.refresh("entry-1");
    expect(refreshed.id).toBe("entry-1");
    expect(refreshed.addedAt).toBe(originalAddedAt);
    expect(refreshed.predictedScore).toBe(7.5);
    expect(refreshed.predictionConfidence).toBe("strong");
  });

  test("removeByBggId finds and removes matching entry", async () => {
    const existing: WishlistEntry = {
      id: "entry-1",
      bggId: 100,
      name: "Test Game",
      yearPublished: 2020,
      thumbnailUrl: null,
      predictedScore: 7.5,
      predictionConfidence: "strong",
      predictedBreakdown: null,
      nicheImpact: null,
      addedAt: NOW,
    };
    storage = createMockStorage([existing]);
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });

    const removed = await svc.removeByBggId(100);
    expect(removed).toBe(true);
    const list = await svc.list();
    expect(list).toHaveLength(0);
  });

  test("removeByBggId returns false when not found", async () => {
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });
    const removed = await svc.removeByBggId(999);
    expect(removed).toBe(false);
  });

  test("refreshAll updates all entries and reports errors", async () => {
    const entries: WishlistEntry[] = [
      {
        id: "e1",
        bggId: 100,
        name: "Test Game",
        yearPublished: 2020,
        thumbnailUrl: null,
        predictedScore: 5.0,
        predictionConfidence: "weak",
        predictedBreakdown: null,
        nicheImpact: null,
        addedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "e2",
        bggId: 999, // will fail
        name: "Missing Game",
        yearPublished: null,
        thumbnailUrl: null,
        predictedScore: null,
        predictionConfidence: null,
        predictedBreakdown: null,
        nicheImpact: null,
        addedAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    storage = createMockStorage(entries);
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });

    const result = await svc.refreshAll();
    expect(result.refreshed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Missing Game");

    const list = await svc.list();
    expect(list[0].predictedScore).toBe(7.5); // updated
    expect(list[1].predictedScore).toBeNull(); // unchanged (error)
  });
});
