import { describe, test, expect } from "bun:test";
import type {
  Axis,
  Collection,
  Game,
  PredictionSettings,
  TournamentGameStatsDisplay,
  TournamentSettings,
} from "@shelf-judge/shared";
import { createPredictionService } from "../../src/services/prediction-service.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import type { BggGameData } from "@shelf-judge/shared";
import type { StorageService } from "../../src/services/storage-service.js";
import type { TournamentService } from "../../src/services/tournament-service.js";
import type { BggClient, BggGameResult } from "../../src/services/bgg-client.js";
import { DEFAULT_PREDICTION_SETTINGS } from "../../src/services/prediction-engine.js";

const now = new Date().toISOString();

function makeAxis(id: string, name: string, source: "personal" | "bgg", weight = 50): Axis {
  return {
    id,
    name,
    description: "",
    weight,
    source,
    bggField: source === "bgg" ? "communityRating" : null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeGame(
  id: string,
  name: string,
  ratings: Record<string, number> = {},
  hasBgg = true,
): Game {
  return {
    id,
    bggId: hasBgg ? 12345 : null,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    numPlays: null,
    ratings,
    imageUrl: null,
    bggData: hasBgg
      ? {
          communityRating: 7.5,
          bayesAverage: 7.0,
          weight: 3.0,
          numWeightVotes: 100,
          description: null,
          mechanics: [{ id: 1, name: "Dice Rolling" }],
          categories: [{ id: 1, name: "Strategy" }],
          families: [],
          subdomains: [],
          suggestedPlayerCounts: [],
          fetchedAt: now,
        }
      : null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeCollection(games: Game[], axes: Axis[]): Collection {
  return {
    id: "test-col",
    name: "Test Collection",
    axes,
    games,
    createdAt: now,
    updatedAt: now,
  };
}

function createStubStorage(
  collection: Collection,
  predictionSettings?: PredictionSettings,
): StorageService {
  return {
    loadCollection: () => Promise.resolve(structuredClone(collection)),
    saveCollection: () => Promise.resolve(),
    loadConfig: () => Promise.resolve({} as never),
    saveConfig: () => Promise.resolve(),
    loadTournament: () =>
      Promise.resolve({
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
        sessions: [],
        gameStats: {},
      }),
    saveTournament: () => Promise.resolve(),
    loadProfile: () => Promise.resolve(null),
    saveProfile: () => Promise.resolve(),
    loadPredictionSettings: () =>
      Promise.resolve(predictionSettings ?? { ...DEFAULT_PREDICTION_SETTINGS }),
    savePredictionSettings: () => Promise.resolve(),
    loadNicheSettings: () => Promise.resolve({ ignoredTags: [] }),
    saveNicheSettings: () => Promise.resolve(),
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
    loadWishlist: () => Promise.resolve([]),
    saveWishlist: () => Promise.resolve(),
  };
}

function createStubTournamentService(
  stats?: Record<string, TournamentGameStatsDisplay>,
  settings?: TournamentSettings,
): TournamentService {
  return {
    getAllGameStats: () => Promise.resolve(stats ?? {}),
    getGameStats: () => Promise.reject(new Error("not implemented")),
    startSession: () => Promise.reject(new Error("not implemented")),
    getActiveSession: () => Promise.resolve(null),
    endSession: () => Promise.reject(new Error("not implemented")),
    getNextPair: () => Promise.reject(new Error("not implemented")),
    submitComparison: () => Promise.reject(new Error("not implemented")),
    listSessions: () => Promise.resolve([]),
    normalizeFitness: () => Promise.reject(new Error("not implemented")),
    onGameDeleted: () => Promise.resolve(),
    getSettings: () =>
      Promise.resolve(
        settings ?? {
          kFactorThreshold: 15,
          normalizationHalfWidth: 400,
          provisionalThreshold: 6,
        },
      ),
    updateSettings: () => Promise.reject(new Error("not implemented")),
  };
}

describe("prediction-service", () => {
  const themeAxis = makeAxis("theme", "Theme", "personal");
  const complexityAxis = makeAxis("complexity", "Complexity", "bgg");

  function buildRatedCollection(ratedCount: number) {
    const axes = [themeAxis, complexityAxis];
    const games: Game[] = [];
    for (let i = 0; i < ratedCount; i++) {
      games.push(makeGame(`rated-${i}`, `Rated Game ${i}`, { theme: 5 + (i % 6) }));
    }
    // Add an unrated target game
    games.push(makeGame("target", "Target Game", {}));
    return makeCollection(games, axes);
  }

  describe("predictGame", () => {
    test("returns predicted fitness for unrated game with enough reference data", async () => {
      const collection = buildRatedCollection(6); // stage 1
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const result = await service.predictGame("target");
      expect(result.game.id).toBe("target");
      expect(result.score).toBeDefined();
      // BGG axis should be "actual", theme axis should be predicted
      const themeEntry = result.score.breakdown.find((e) => e.axisId === "theme");
      expect(themeEntry).toBeDefined();
      if (themeEntry?.predictionConfidence !== null) {
        expect(["strong", "moderate", "weak"]).toContain(themeEntry!.predictionConfidence);
      }
    });

    test("returns actual fitness with null predictionMeta when all axes rated", async () => {
      const axes = [themeAxis, complexityAxis];
      const games = [
        makeGame("g1", "Game 1", { theme: 7 }),
        makeGame("g2", "Game 2", { theme: 8 }),
        makeGame("g3", "Game 3", { theme: 6 }),
        makeGame("g4", "Game 4", { theme: 5 }),
        makeGame("g5", "Game 5", { theme: 9 }),
        makeGame("fully-rated", "Fully Rated", { theme: 7 }),
      ];
      const collection = makeCollection(games, axes);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const result = await service.predictGame("fully-rated");
      expect(result.score.predictionMeta).toBeNull();
    });

    test("throws for nonexistent game", async () => {
      const collection = makeCollection([], []);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.predictGame("no-such-game")).rejects.toThrow("not found");
    });

    test("throws for game without BGG data", async () => {
      const game = makeGame("no-bgg", "No BGG", {}, false);
      const collection = makeCollection([game], [themeAxis]);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.predictGame("no-bgg")).rejects.toThrow("no BGG data");
    });

    test("stage 0 strips predicted personal axis entries", async () => {
      const collection = buildRatedCollection(3); // < 5, stage 0
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const result = await service.predictGame("target");
      // In stage 0, personal axis predictions are not produced (readinessStage passed as 0)
      const themeEntry = result.score.breakdown.find((e) => e.axisId === "theme");
      // Theme axis should exist but with null prediction confidence (no prediction at stage 0)
      expect(themeEntry).toBeDefined();
      expect(themeEntry!.predictionConfidence).toBeNull();
    });
  });

  describe("getReadiness", () => {
    test("returns stage 0 with no rated games", async () => {
      const collection = makeCollection([makeGame("g1", "Game 1")], [themeAxis]);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const readiness = await service.getReadiness();
      expect(readiness.stage).toBe(0);
      expect(readiness.ratedGameCount).toBe(0);
      expect(readiness.nextStageAt).toBe(5);
    });

    test("returns correct stage for rated games", async () => {
      const games: Game[] = [];
      for (let i = 0; i < 16; i++) {
        games.push(makeGame(`g${i}`, `Game ${i}`, { theme: 7 }));
      }
      const collection = makeCollection(games, [themeAxis]);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const readiness = await service.getReadiness();
      expect(readiness.stage).toBe(2); // 16 >= 15
      expect(readiness.ratedGameCount).toBe(16);
      expect(readiness.nextStageAt).toBe(30);
    });

    test("includes weak axes", async () => {
      const axes = [themeAxis, makeAxis("fun", "Fun Factor", "personal")];
      // Only rate theme, not fun
      const games = [
        makeGame("g1", "Game 1", { theme: 7 }),
        makeGame("g2", "Game 2", { theme: 8 }),
        makeGame("g3", "Game 3", { theme: 6 }),
        makeGame("g4", "Game 4", { theme: 5 }),
        makeGame("g5", "Game 5", { theme: 9 }),
      ];
      const collection = makeCollection(games, axes);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const readiness = await service.getReadiness();
      const funWeak = readiness.weakAxes.find((a) => a.axisId === "fun");
      expect(funWeak).toBeDefined();
      expect(funWeak!.ratedCount).toBe(0);
    });
  });

  describe("listGamesWithPredictions", () => {
    test("includes predicted scores for unrated games", async () => {
      const collection = buildRatedCollection(6);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const results = await service.listGamesWithPredictions();
      expect(results.length).toBe(7); // 6 rated + 1 target
      const target = results.find((r) => r.game.id === "target");
      expect(target).toBeDefined();
      expect(target!.score).not.toBeNull();
    });

    test("returns sorted by fitness descending", async () => {
      const collection = buildRatedCollection(6);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const results = await service.listGamesWithPredictions();
      for (let i = 0; i < results.length - 1; i++) {
        const scoreA = results[i].score?.score ?? -Infinity;
        const scoreB = results[i + 1].score?.score ?? -Infinity;
        expect(scoreA).toBeGreaterThanOrEqual(scoreB);
      }
    });

    test("skips prediction for games without BGG data", async () => {
      const noBgg = makeGame("no-bgg", "No BGG", {}, false);
      const collection = buildRatedCollection(6);
      collection.games.push(noBgg);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const results = await service.listGamesWithPredictions();
      const noBggResult = results.find((r) => r.game.id === "no-bgg");
      expect(noBggResult).toBeDefined();
      // Should have null score since no BGG data and no ratings
      expect(noBggResult!.score).toBeNull();
    });
  });

  describe("getSettings / updateSettings", () => {
    test("returns default settings when none saved", async () => {
      const collection = makeCollection([], []);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const settings = await service.getSettings();
      expect(settings).toEqual(DEFAULT_PREDICTION_SETTINGS);
    });

    test("updateSettings merges with current", async () => {
      const saved: PredictionSettings[] = [];
      const stubStorage = createStubStorage(makeCollection([], []));
      stubStorage.savePredictionSettings = (s) => {
        saved.push(s);
        return Promise.resolve();
      };

      const service = createPredictionService({
        storageService: stubStorage,
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const updated = await service.updateSettings({ defaultK: 7 });
      expect(updated.defaultK).toBe(7);
      expect(updated.stageThresholds).toEqual([5, 15, 30]);
      expect(saved.length).toBe(1);
      expect(saved[0].defaultK).toBe(7);
    });
  });

  describe("tension detection", () => {
    test("returns null tension when no tournament data", async () => {
      const collection = buildRatedCollection(6);
      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
      });

      const result = await service.predictGame("target");
      expect(result.tension).toBeNull();
    });
  });

  describe("predictBggGame", () => {
    const makeBggData = (
      mechanics: string[] = ["Dice Rolling"],
      categories: string[] = ["Strategy"],
    ): BggGameData => ({
      communityRating: 7.5,
      bayesAverage: 7.0,
      weight: 3.0,
      numWeightVotes: 100,
      description: null,
      mechanics: mechanics.map((name, i) => ({ id: i + 1, name })),
      categories: categories.map((name, i) => ({ id: i + 1, name })),
      families: [],
      subdomains: [],
      suggestedPlayerCounts: [],
      fetchedAt: now,
    });

    const makeBggResult = (name: string, bggData?: BggGameData): BggGameResult => ({
      metadata: {
        bggId: 99999,
        name,
        yearPublished: 2023,
        minPlayers: 1,
        maxPlayers: 4,
        playingTime: 90,
        imageUrl: null,
        thumbnailUrl: null,
      },
      bggData: bggData ?? makeBggData(),
    });

    function createStubBggClient(getGameResult?: BggGameResult, getGameError?: Error): BggClient {
      return {
        searchGames: () => Promise.reject(new Error("not implemented")),
        getGame: getGameError
          ? () => Promise.reject(getGameError)
          : () => Promise.resolve(getGameResult ?? makeBggResult("Test Game")),
        getGames: () => Promise.reject(new Error("not implemented")),
        getUserCollection: () => Promise.reject(new Error("not implemented")),
        isConfigured: () => true,
      };
    }

    test("returns prediction for a game not in collection", async () => {
      const collection = buildRatedCollection(6);
      const bggClient = createStubBggClient(makeBggResult("New Game"));

      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
        bggClient,
      });

      const result = await service.predictBggGame(99999);
      expect(result.game.id).toBe("preview-99999");
      expect(result.game.name).toBe("New Game");
      expect(result.game.bggId).toBe(99999);
      expect(result.score).toBeDefined();
      // Temporary game has no ratings, so all personal axes should be predicted
      const themeEntry = result.score.breakdown.find((e) => e.axisId === "theme");
      expect(themeEntry).toBeDefined();
    });

    test("delegates to predictGame when bggId exists in collection", async () => {
      const collection = buildRatedCollection(6);
      // Give one game a specific bggId
      collection.games[0].bggId = 42;
      const bggClient = createStubBggClient();

      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
        bggClient,
      });

      const result = await service.predictBggGame(42);
      // Should return the existing game, not a preview
      expect(result.game.id).toBe("rated-0");
      expect(result.game.bggId).toBe(42);
    });

    test("throws when BGG returns no game (404)", async () => {
      const collection = buildRatedCollection(6);
      const bggClient = createStubBggClient(
        undefined,
        new Error("No game found with BGG ID 99999"),
      );

      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
        bggClient,
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.predictBggGame(99999)).rejects.toThrow("No game found with BGG ID");
    });

    test("throws when bggClient is not configured", async () => {
      const collection = buildRatedCollection(6);

      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
        // no bggClient
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.predictBggGame(99999)).rejects.toThrow("not configured");
    });

    test("produces prediction even with empty mechanics/categories", async () => {
      const collection = buildRatedCollection(6);
      const bggResult = makeBggResult("Bare Game", makeBggData([], []));
      const bggClient = createStubBggClient(bggResult);

      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
        bggClient,
      });

      const result = await service.predictBggGame(99999);
      expect(result.game.id).toBe("preview-99999");
      expect(result.score).toBeDefined();
      // Should still produce a score (from BGG-derived axes at least)
      expect(typeof result.score.score).toBe("number");
    });

    test("does not persist the temporary game", async () => {
      const collection = buildRatedCollection(6);
      const bggClient = createStubBggClient(makeBggResult("Temp Game"));
      let savedCollection = false;

      const stubStorage = createStubStorage(collection);
      stubStorage.saveCollection = () => {
        savedCollection = true;
        return Promise.resolve();
      };

      const service = createPredictionService({
        storageService: stubStorage,
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
        bggClient,
      });

      await service.predictBggGame(99999);
      expect(savedCollection).toBe(false);
    });

    test("returns predictionUnavailable at stage 0", async () => {
      const collection = buildRatedCollection(3); // stage 0
      const bggClient = createStubBggClient(makeBggResult("Preview Game"));

      const service = createPredictionService({
        storageService: createStubStorage(collection),
        fitnessService: createFitnessService(),
        tournamentService: createStubTournamentService(),
        bggClient,
      });

      const result = await service.predictBggGame(99999);
      expect(result.predictionUnavailable).not.toBeNull();
      expect(result.predictionUnavailable!.reason).toBe("stage-0");
      expect(result.predictionUnavailable!.gamesNeeded).toBe(2); // 5 - 3
    });
  });
});
