import { describe, test, expect } from "bun:test";
import type {
  Collection,
  TournamentData,
  ProfileData,
  Game,
  CollectionProfile,
  TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import {
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
  createInitialEntityMetadata,
} from "@shelf-judge/shared";
import { createProfileService } from "../src/services/profile-service.js";
import type { StorageService } from "../src/services/storage-service.js";
import type { GameService } from "../src/services/game-service.js";
import type { TournamentService } from "../src/services/tournament-service.js";
import { trustedInsightProfileFixture } from "../../shared/tests/fixtures/trusted-profile.js";

function makeGame(id: string, name: string): Game {
  const now = new Date().toISOString();
  return {
    id,
    bggId: null,
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    name,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    imageUrl: null,
    bggData: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeCollection(updatedAt?: string): Collection {
  const now = updatedAt ?? new Date().toISOString();
  return {
    schemaVersion: 4,
    revision: 0,
    id: "test-col",
    name: "Test Collection",
    axes: [],
    games: [],
    entertainmentBenchmark: null,
    intentions: [],
    commandReceipts: [],
    createdAt: now,
    updatedAt: now,
  };
}

function defaultTournament(): TournamentData {
  return {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
    sessions: [],
    gameStats: {},
  };
}

function createStubStorage(overrides?: {
  collection?: Collection;
  tournament?: TournamentData;
  profile?: ProfileData | null;
}): StorageService & {
  savedProfile: ProfileData | null;
} {
  const collectionData = overrides?.collection ?? makeCollection();
  const tournamentData = overrides?.tournament ?? defaultTournament();

  const stub = {
    savedProfile: null as ProfileData | null,
    loadCollection() {
      return Promise.resolve(structuredClone(collectionData));
    },
    saveCollection() {
      return Promise.resolve();
    },
    loadConfig() {
      return Promise.resolve({} as never);
    },
    saveConfig() {
      return Promise.resolve();
    },
    loadTournament() {
      return Promise.resolve(structuredClone(tournamentData));
    },
    saveTournament() {
      return Promise.resolve();
    },
    loadProfile(): Promise<ProfileData | null> {
      return Promise.resolve(
        overrides?.profile !== undefined ? structuredClone(overrides.profile) : null,
      );
    },
    saveProfile(data: ProfileData) {
      stub.savedProfile = structuredClone(data);
      return Promise.resolve();
    },
    loadPredictionSettings() {
      return Promise.resolve({
        stageThresholds: [5, 15, 30] as [number, number, number],
        defaultK: 5,
        minSimilarityThreshold: 0.2,
        tournamentStabilityBoost: 0.2,
      });
    },
    savePredictionSettings() {
      return Promise.resolve();
    },
    loadNicheSettings() {
      return Promise.resolve({ ignoredTags: [] });
    },
    saveNicheSettings() {
      return Promise.resolve();
    },
    loadRedundancySettings() {
      return Promise.resolve({
        enabled: false,
        stage: "annotation" as const,
        similarityThreshold: 0.6,
        maxPenalty: 2.0,
        componentWeights: { binary: 0.4, continuous: 0.3, personalAxes: 0.3 },
        minNeighbors: 1,
        expectedNeighbors: 5,
      });
    },
    saveRedundancySettings() {
      return Promise.resolve();
    },
    loadWishlist() {
      return Promise.resolve([]);
    },
    saveWishlist() {
      return Promise.resolve();
    },
    loadShelfConfig() {
      return Promise.resolve({ units: [], createdAt: "", updatedAt: "" });
    },
    saveShelfConfig() {
      return Promise.resolve();
    },
  };

  return stub;
}

function createStubGameService(games: Game[]): GameService {
  return {
    listGames() {
      return Promise.resolve(games.map((game) => ({ game, score: null })));
    },
    getGame(id: string) {
      const game = games.find((g) => g.id === id);
      if (!game) return Promise.reject(new Error(`Game not found: ${id}`));
      return Promise.resolve({ game, score: null });
    },
    addGame: () => Promise.reject(new Error("not implemented")),
    rateGame: () => Promise.reject(new Error("not implemented")),
    removeGame: () => Promise.reject(new Error("not implemented")),
    searchGames: () => Promise.reject(new Error("not implemented")),
    refreshBggData: () => Promise.reject(new Error("not implemented")),
    refreshAllBggData: () => Promise.reject(new Error("not implemented")),
    importBggCollection: () => Promise.reject(new Error("not implemented")),
    setOwnership: () => Promise.reject(new Error("not implemented")),
    setBoxDimensions: () => Promise.reject(new Error("not implemented")),
    setManualShelf: () => Promise.reject(new Error("not implemented")),
  };
}

function createStubTournamentService(
  stats?: Record<string, TournamentGameStatsDisplay>,
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
    getSettings: () => Promise.reject(new Error("not implemented")),
    updateSettings: () => Promise.reject(new Error("not implemented")),
  };
}

describe("ProfileService", () => {
  test("drops persisted narration when recomputation replaces its trusted evidence", async () => {
    const oldComputedAt = "2026-01-01T00:00:00.000Z";
    const cachedProfile: CollectionProfile = {
      ...structuredClone(trustedInsightProfileFixture),
      computedAt: oldComputedAt,
      narration: {
        summary: [
          {
            observation: "Game 3 is compositionally distant from its two nearest comparison games",
            interpretation: "Separately, its current preference fitness score is 8.0",
            evidenceReferences: [{ insightId: "outlier:game-3", gameIds: ["game-3"] }],
          },
        ],
        surprises: [],
        tensions: [],
        abstention: null,
      },
      narrationState: "fresh",
    };
    const storage = createStubStorage({
      collection: makeCollection("2026-01-02T00:00:00.000Z"),
      profile: {
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
        algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        tournamentSettings: defaultTournament().settings,
        profile: cachedProfile,
        computedAt: oldComputedAt,
        narration: cachedProfile.narration,
        narrationComputedAt: oldComputedAt,
      },
    });
    const service = createProfileService({
      storageService: storage,
      gameService: createStubGameService([]),
      tournamentService: createStubTournamentService(),
    });

    const profile = await service.getProfile();

    expect(profile.narration).toBeNull();
    expect(profile.narrationState).toBe("empty");
    expect(storage.savedProfile?.narration).toBeNull();
  });

  test("loads the collection before its dependent profile artifact", async () => {
    const storage = createStubStorage();
    const loadCollection = storage.loadCollection.bind(storage);
    const loadProfile = storage.loadProfile.bind(storage);
    let collectionLoaded = false;
    storage.loadCollection = async () => {
      const collection = await loadCollection();
      collectionLoaded = true;
      return collection;
    };
    storage.loadProfile = () => {
      if (!collectionLoaded) return Promise.reject(new Error("profile loaded before collection"));
      return loadProfile();
    };
    const service = createProfileService({
      storageService: storage,
      gameService: createStubGameService([]),
      tournamentService: createStubTournamentService(),
    });

    await service.getProfile();

    expect(collectionLoaded).toBe(true);
  });

  test("computes fresh profile when no stored profile exists", async () => {
    const games = [makeGame("g1", "Game 1"), makeGame("g2", "Game 2")];
    const storage = createStubStorage();
    const service = createProfileService({
      storageService: storage,
      gameService: createStubGameService(games),
      tournamentService: createStubTournamentService(),
    });

    const profile = await service.getProfile();

    expect(profile).toBeDefined();
    expect(profile.gameCount).toBe(2);
    expect(profile.computedAt).toBeDefined();
    expect(storage.savedProfile).not.toBeNull();
  });

  test("returns cached profile when not stale", async () => {
    const games = [makeGame("g1", "Game 1")];
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const pastDate = new Date(Date.now() - 60_000).toISOString();

    const cachedProfile: CollectionProfile = {
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
      narration: null,
      narrationState: "empty",
      gameCount: 99,
      ratedGameCount: 0,
      computedAt: futureDate,
    };

    const storage = createStubStorage({
      collection: makeCollection(pastDate),
      profile: {
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
        algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        tournamentSettings: defaultTournament().settings,
        profile: cachedProfile,
        computedAt: futureDate,
        narration: null,
        narrationComputedAt: null,
      },
    });

    const service = createProfileService({
      storageService: storage,
      gameService: createStubGameService(games),
      tournamentService: createStubTournamentService(),
    });

    const profile = await service.getProfile();

    // Should return cached (gameCount 99), not recompute (gameCount 1)
    expect(profile.gameCount).toBe(99);
    expect(storage.savedProfile).toBeNull();
  });

  test("recomputes when the Tournament comparison threshold changes", async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const cachedProfile: CollectionProfile = {
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
      narration: null,
      narrationState: "empty",
      gameCount: 99,
      ratedGameCount: 0,
      computedAt: futureDate,
    };
    const tournament = defaultTournament();
    tournament.settings.provisionalThreshold = 8;
    const storage = createStubStorage({
      collection: makeCollection(pastDate),
      tournament,
      profile: {
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
        algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        tournamentSettings: defaultTournament().settings,
        profile: cachedProfile,
        computedAt: futureDate,
        narration: null,
        narrationComputedAt: null,
      },
    });
    const service = createProfileService({
      storageService: storage,
      gameService: createStubGameService([makeGame("g1", "Game 1")]),
      tournamentService: createStubTournamentService(),
    });

    const profile = await service.getProfile();

    expect(profile.gameCount).toBe(1);
    expect(storage.savedProfile?.tournamentSettings.provisionalThreshold).toBe(8);
  });

  test("recomputes when Tournament normalization changes", async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const cachedProfile: CollectionProfile = {
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
      narration: null,
      narrationState: "empty",
      gameCount: 99,
      ratedGameCount: 0,
      computedAt: futureDate,
    };
    const tournament = defaultTournament();
    tournament.settings.normalizationHalfWidth = 300;
    const storage = createStubStorage({
      collection: makeCollection(pastDate),
      tournament,
      profile: {
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
        algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        tournamentSettings: defaultTournament().settings,
        profile: cachedProfile,
        computedAt: futureDate,
        narration: null,
        narrationComputedAt: null,
      },
    });
    const service = createProfileService({
      storageService: storage,
      gameService: createStubGameService([makeGame("g1", "Game 1")]),
      tournamentService: createStubTournamentService(),
    });

    const profile = await service.getProfile();

    expect(profile.gameCount).toBe(1);
    expect(storage.savedProfile?.tournamentSettings.normalizationHalfWidth).toBe(300);
  });

  test("recomputes when collection.updatedAt > computedAt", async () => {
    const games = [makeGame("g1", "Game 1")];
    const middleDate = new Date(Date.now() - 60_000).toISOString();
    const recentDate = new Date(Date.now() - 1_000).toISOString();

    const cachedProfile: CollectionProfile = {
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
      narration: null,
      narrationState: "empty",
      gameCount: 99,
      ratedGameCount: 0,
      computedAt: middleDate,
    };

    const storage = createStubStorage({
      collection: makeCollection(recentDate),
      profile: {
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
        algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        tournamentSettings: defaultTournament().settings,
        profile: cachedProfile,
        computedAt: middleDate,
        narration: null,
        narrationComputedAt: null,
      },
    });

    const service = createProfileService({
      storageService: storage,
      gameService: createStubGameService(games),
      tournamentService: createStubTournamentService(),
    });

    const profile = await service.getProfile();

    // Should recompute (gameCount 1), not return cached (gameCount 99)
    expect(profile.gameCount).toBe(1);
    expect(storage.savedProfile).not.toBeNull();
  });

  test("recomputes when tournament data is newer than computedAt", async () => {
    const games = [makeGame("g1", "Game 1")];
    const middleDate = new Date(Date.now() - 60_000).toISOString();
    const recentDate = new Date(Date.now() - 1_000).toISOString();
    const oldDate = new Date(Date.now() - 120_000).toISOString();

    const cachedProfile: CollectionProfile = {
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
      narration: null,
      narrationState: "empty",
      gameCount: 99,
      ratedGameCount: 0,
      computedAt: middleDate,
    };

    const storage = createStubStorage({
      collection: makeCollection(oldDate),
      tournament: {
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
        gameStats: {},
        sessions: [
          {
            id: "s1",
            status: "completed",
            comparisonCount: 1,
            createdAt: oldDate,
            updatedAt: recentDate,
            comparisons: [],
            gameIds: ["g1"],
            filters: [],
          },
        ],
      },
      profile: {
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
        algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        tournamentSettings: defaultTournament().settings,
        profile: cachedProfile,
        computedAt: middleDate,
        narration: null,
        narrationComputedAt: null,
      },
    });

    const service = createProfileService({
      storageService: storage,
      gameService: createStubGameService(games),
      tournamentService: createStubTournamentService(),
    });

    const profile = await service.getProfile();

    // Session updatedAt > computedAt, should recompute
    expect(profile.gameCount).toBe(1);
    expect(storage.savedProfile).not.toBeNull();
  });

  test("recomputes when comparison createdAt is newer than computedAt", async () => {
    const games = [makeGame("g1", "Game 1"), makeGame("g2", "Game 2")];
    const oldDate = new Date(Date.now() - 120_000).toISOString();
    const middleDate = new Date(Date.now() - 60_000).toISOString();
    const recentDate = new Date(Date.now() - 1_000).toISOString();

    const cachedProfile: CollectionProfile = {
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
      narration: null,
      narrationState: "empty",
      gameCount: 99,
      ratedGameCount: 0,
      computedAt: middleDate,
    };

    const storage = createStubStorage({
      collection: makeCollection(oldDate),
      tournament: {
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
        gameStats: {},
        sessions: [
          {
            id: "s1",
            status: "active",
            comparisonCount: 1,
            createdAt: oldDate,
            updatedAt: oldDate,
            comparisons: [
              {
                id: "c1",
                gameAId: "g1",
                gameBId: "g2",
                winnerId: "g1",
                sessionId: "s1",
                createdAt: recentDate,
              },
            ],
            gameIds: ["g1", "g2"],
            filters: [],
          },
        ],
      },
      profile: {
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
        algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        tournamentSettings: defaultTournament().settings,
        profile: cachedProfile,
        computedAt: middleDate,
        narration: null,
        narrationComputedAt: null,
      },
    });

    const service = createProfileService({
      storageService: storage,
      gameService: createStubGameService(games),
      tournamentService: createStubTournamentService(),
    });

    const profile = await service.getProfile();

    // Comparison createdAt > computedAt, should recompute
    expect(profile.gameCount).toBe(2);
    expect(storage.savedProfile).not.toBeNull();
  });

  test("saves computed profile to storage", async () => {
    const games = [makeGame("g1", "Game 1")];
    const storage = createStubStorage();

    const service = createProfileService({
      storageService: storage,
      gameService: createStubGameService(games),
      tournamentService: createStubTournamentService(),
    });

    await service.getProfile();

    expect(storage.savedProfile).not.toBeNull();
    expect(storage.savedProfile!.computedAt).toBeDefined();
    expect(storage.savedProfile!.profile.gameCount).toBe(1);
  });
});
