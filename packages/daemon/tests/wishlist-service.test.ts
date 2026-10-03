import { describe, expect, test, beforeEach } from "bun:test";
import type {
  WishlistEntry,
  Collection,
  NicheSettings,
  Game,
  FitnessResult,
} from "@shelf-judge/shared";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyStateV10,
} from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import type { PredictionService, PredictedGameResult } from "../src/services/prediction-service";
import type { GameService } from "../src/services/game-service";
import type { BoardgameScoringInput } from "../src/services/bgg-client";
import { createWishlistService } from "../src/services/wishlist-service";
import { parseBoardgameScoringThings } from "../src/services/bgg-xml-parser.js";

const NOW = "2026-04-12T12:00:00.000Z";

async function expectPromiseError(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) return;
    throw new Error(`Expected promise rejection containing: ${message}`, { cause: error });
  }
  throw new Error(`Expected promise rejection containing: ${message}`);
}

function makeScoringInput(bggId: number, primaryName: string): BoardgameScoringInput {
  return {
    bggId,
    type: "boardgame",
    primaryName,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: 3,
    playingTime: 60,
    weight: 3.2,
    communityRating: 7.8,
    description: "  Exact BGG description  ",
    categories: [{ id: 1, name: "Strategy" }],
    mechanics: [{ id: 2, name: "Deck Building" }],
    suggestedPlayerPoll: { state: "absent", buckets: [] },
    missingFields: [],
    observedAt: NOW,
  };
}

function makeGame(bggId: number, name: string): Game {
  return {
    id: `preview-${bggId}`,
    bggId,
    entityMetadata: createInitialEntityMetadata(bggId),
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: `https://example.com/${bggId}.jpg`,
    numPlays: null,
    latestPlayCountCheck: null,
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
    bggData: {
      communityRating: 7.5,
      bayesAverage: 7.2,
      weight: 3.0,
      numWeightVotes: 100,
      description: null,
      mechanics: [{ id: 1, name: "Deck Building" }],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: NOW,
    },
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
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
        contribution: 3.5,
        source: "predicted" as const,
        derivedField: null,
        sourceValue: null,
        scoringRawValue: 7,
        effectiveRating: 7,
        preferenceShape: "higher-is-better" as const,
        curveAffected: false,
        unit: null,
        provenance: null,
        configurationSummary: null,
        overridden: false,
        overrideValue: null,
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
  redundancyEnabled = false,
): StorageService {
  let stored = structuredClone(wishlist);
  const coll: Collection = {
    schemaVersion: 10,
    revision: 0,
    id: "coll-1",
    name: "Test",
    axes: [],
    games: [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: createInitialSemanticRedundancyStateV10(),
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
    loadRedundancySettings: () =>
      Promise.resolve({
        enabled: redundancyEnabled,
        stage: "annotation" as const,
        similarityThreshold: 0.6,
        maxPenalty: 2.0,
        componentWeights: { binary: 0.4, continuous: 0.3 },
        minNeighbors: 1,
        expectedNeighbors: 5,
      }),
    saveRedundancySettings: () => Promise.resolve(),
    loadShelfConfig: () => Promise.resolve({ units: [], createdAt: "", updatedAt: "" }),
    saveShelfConfig: () => Promise.resolve(),
  };
}

function createMockPredictionService(
  results: Map<number, PredictedGameResult>,
  allGames: { game: Game; score: FitnessResult | null }[] = [],
): PredictionService {
  return {
    predictBggGame: (bggId: number) => {
      const r = results.get(bggId);
      if (!r) return Promise.reject(new Error(`No game found with BGG ID ${bggId}`));
      return Promise.resolve(r);
    },
    listGamesWithPredictions: () => Promise.resolve(allGames),
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
    setOwnership: () => Promise.reject(new Error("not implemented")),
    setBoxDimensions: () => Promise.reject(new Error("not implemented")),
    setManualValues: () => Promise.reject(new Error("not implemented")),
    setManualShelf: () => Promise.reject(new Error("not implemented")),
    setAdditionalBggIds: () => Promise.reject(new Error("not implemented")),
  };
}

describe("wishlist service", () => {
  const game100 = makeGame(100, "Test Game");
  const score100 = makeFitnessResult(7.5, false);
  const result100: PredictedGameResult = {
    game: game100,
    score: score100,
    predictionUnavailable: null,
    verifiedScoringInput: makeScoringInput(100, "Test Game"),
    bggVerification: { status: "verified" },
  };

  const game200 = makeGame(200, "Another Game");
  const score200 = makeFitnessResult(0, true);
  const result200: PredictedGameResult = {
    game: game200,
    score: score200,
    predictionUnavailable: {
      reason: "stage-0",
      ratedGameCount: 2,
      gamesNeeded: 3,
    },
    verifiedScoringInput: makeScoringInput(200, "Another Game"),
    bggVerification: { status: "verified" },
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
    let predictionCalls = 0;
    predictionService = {
      ...predictionService,
      predictBggGame: (bggId) => {
        predictionCalls++;
        return Promise.resolve(predictions.get(bggId) ?? result100);
      },
    };
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
    expect(entry.redundancyPreview).toBeNull();
    expect(entry.bggSource).toEqual({
      observedAt: NOW,
      description: "  Exact BGG description  ",
      mechanics: ["Deck Building"],
      categories: ["Strategy"],
      weight: 3.2,
      communityRating: 7.8,
      minPlayers: 2,
      maxPlayers: 4,
      bestPlayers: 3,
      playingTime: 60,
    });
    expect(predictionCalls).toBe(1);
  });

  test("persists decoded description whitespace from the verified XML scoring input", async () => {
    const observedAt = "2026-04-12T12:00:00.000Z";
    const sourceXml = `<items><item type="boardgame" id="100">
      <name type="primary" value="Test Game"/>
      <description>  Exact &amp; decoded text  </description>
      <minplayers value="2"/><maxplayers value="4"/><playingtime value="60"/>
    </item></items>`;
    const parsedThing = parseBoardgameScoringThings(sourceXml, observedAt)[0];
    if (!parsedThing) throw new Error("XML fixture did not produce a scoring Thing");
    const scoringInput: BoardgameScoringInput = { ...parsedThing, observedAt };
    let scoringObservationCalls = 0;
    predictionService = {
      ...createMockPredictionService(predictions),
      predictBggGame: () => {
        scoringObservationCalls++;
        return Promise.resolve({ ...result100, verifiedScoringInput: scoringInput });
      },
    };

    const entry = await createWishlistService({
      storageService: storage,
      predictionService,
      gameService,
    }).add(100);

    expect(entry.bggSource?.description).toBe("  Exact & decoded text  ");
    expect(entry.bggSource?.observedAt).toBe(observedAt);
    expect(scoringObservationCalls).toBe(1);
  });

  test("add with Stage 0 creates entry with null prediction fields", async () => {
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });
    const entry = await svc.add(200);

    expect(entry.bggId).toBe(200);
    expect(entry.name).toBe("Another Game");
    expect(entry.predictedScore).toBeNull();
    expect(entry.predictionConfidence).toBeNull();
    expect(entry.predictedBreakdown).toBeNull();
    expect(entry.redundancyPreview).toBeNull();
  });

  test("ordinary list reads persisted source without invoking prediction or BGG", async () => {
    const entry: WishlistEntry = {
      id: "offline-entry",
      bggId: 100,
      name: "Test Game",
      yearPublished: 2020,
      thumbnailUrl: null,
      predictedScore: 7.5,
      predictionConfidence: "strong",
      predictedBreakdown: null,
      nicheImpact: null,
      redundancyPreview: null,
      addedAt: NOW,
      bggSource: {
        observedAt: NOW,
        description: "Description",
        mechanics: ["Deck Building"],
        categories: ["Strategy"],
        weight: 3.2,
        communityRating: 7.8,
        minPlayers: 2,
        maxPlayers: 4,
        bestPlayers: 3,
        playingTime: 60,
      },
    };
    storage = createMockStorage([entry]);
    predictionService = {
      ...predictionService,
      predictBggGame: () => Promise.reject(new Error("ordinary reads must stay offline")),
    };

    expect(
      await createWishlistService({
        storageService: storage,
        predictionService,
        gameService,
      }).list(),
    ).toEqual([entry]);
  });

  test("add stores candidate-only redundancy preview when enabled", async () => {
    const peer = makeGame(300, "Higher Scoring Peer");
    peer.id = "collection-peer";
    const peerScore = makeFitnessResult(9, false);
    storage = createMockStorage(
      [],
      {
        games: [{ ...peer, ownerNote: { state: "missing", version: 0, updatedAt: null } }],
      },
      true,
    );
    predictionService = createMockPredictionService(predictions, [
      { game: peer, score: peerScore },
    ]);

    const entry = await createWishlistService({
      storageService: storage,
      predictionService,
      gameService,
    }).add(100);
    expect(entry.redundancyPreview).not.toBeNull();
    expect(entry.redundancyPreview?.originalScore).toBe(7.5);
    expect(entry.redundancyPreview?.penalty).toBeGreaterThan(0);
    expect(entry.redundancyPreview?.nicheNeighbors.map((neighbor) => neighbor.gameId)).toEqual([
      "collection-peer",
    ]);
    expect((await storage.loadCollection()).games.map((game) => game.id)).toEqual([
      "collection-peer",
    ]);
    expect(
      (
        await createWishlistService({
          storageService: storage,
          predictionService,
          gameService,
        }).list()
      )[0].redundancyPreview,
    ).toEqual(entry.redundancyPreview);
  });

  test("single refresh recomputes the redundancy preview", async () => {
    const peer = makeGame(300, "Higher Scoring Peer");
    peer.id = "collection-peer";
    const existing: WishlistEntry = {
      id: "entry-refresh",
      bggId: 100,
      name: "Test Game",
      yearPublished: 2020,
      thumbnailUrl: null,
      predictedScore: 5,
      predictionConfidence: "weak",
      predictedBreakdown: null,
      nicheImpact: null,
      redundancyPreview: null,
      addedAt: NOW,
    };
    storage = createMockStorage(
      [existing],
      {
        games: [{ ...peer, ownerNote: { state: "missing", version: 0, updatedAt: null } }],
      },
      true,
    );
    predictionService = createMockPredictionService(predictions, [
      { game: peer, score: makeFitnessResult(9, false) },
    ]);

    const refreshed = await createWishlistService({
      storageService: storage,
      predictionService,
      gameService,
    }).refresh(existing.id);
    expect(refreshed.id).toBe(existing.id);
    expect(refreshed.addedAt).toBe(existing.addedAt);
    expect(refreshed.redundancyPreview).not.toBeNull();
    expect(refreshed.redundancyPreview?.originalScore).toBe(7.5);
  });

  test("semantic-enabled wishlist add and refresh keep factual snapshots independent of C/D", async () => {
    const peer = makeGame(300, "Higher Scoring Peer");
    peer.id = "collection-peer";
    const peerScore = makeFitnessResult(9, false);
    const collection = {
      games: [
        {
          ...peer,
          ownerNote: {
            state: "present" as const,
            text: "Private owner-note signal",
            version: 1,
            updatedAt: NOW,
          },
        },
      ],
      semanticRedundancy: createInitialSemanticRedundancyStateV10(),
    };
    collection.semanticRedundancy.settings.enabled = true;
    storage = createMockStorage([], collection, true);
    predictionService = createMockPredictionService(predictions, [
      { game: peer, score: peerScore },
    ]);
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });

    const added = await svc.add(100);
    expect(added.redundancyPreview).not.toBeNull();
    expect(added.redundancyPreview?.originalScore).toBe(7.5);
    expect(added.redundancyPreview?.penalty).toBeGreaterThan(0);
    expect(added.redundancyPreview?.nicheNeighbors.map(({ gameId }) => gameId)).toEqual([
      "collection-peer",
    ]);
    const savedPreview = structuredClone(added.redundancyPreview);
    expect((await svc.list())[0].redundancyPreview).toEqual(savedPreview);

    const refreshed = await svc.refresh(added.id);
    expect(refreshed.id).toBe(added.id);
    expect(refreshed.addedAt).toBe(added.addedAt);
    expect(refreshed.redundancyPreview).toEqual(savedPreview);
    expect((await svc.list())[0].redundancyPreview).toEqual(savedPreview);
    expect(JSON.stringify(refreshed)).not.toContain("Private owner-note signal");
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
      redundancyPreview: null,
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
    storage = createMockStorage([], {
      games: [{ ...collGame, ownerNote: { state: "missing", version: 0, updatedAt: null } }],
    });
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
      redundancyPreview: null,
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
        redundancyPreview: null,
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
        redundancyPreview: null,
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
      redundancyPreview: null,
      addedAt: originalAddedAt,
    };
    storage = createMockStorage([existing]);
    const svc = createWishlistService({ storageService: storage, predictionService, gameService });

    const refreshed = await svc.refresh("entry-1");
    expect(refreshed.id).toBe("entry-1");
    expect(refreshed.addedAt).toBe(originalAddedAt);
    expect(refreshed.predictedScore).toBe(7.5);
    expect(refreshed.predictionConfidence).toBe("strong");
    expect(refreshed.bggSource?.observedAt).toBe(NOW);
  });

  test("failed verified refresh retains the complete previous entry", async () => {
    const existing: WishlistEntry = {
      id: "entry-failed-source",
      bggId: 100,
      name: "Test Game",
      yearPublished: 2020,
      thumbnailUrl: null,
      predictedScore: 5,
      predictionConfidence: "weak",
      predictedBreakdown: null,
      nicheImpact: null,
      redundancyPreview: null,
      addedAt: "2026-01-01T00:00:00.000Z",
      bggSource: {
        observedAt: "2025-01-01T00:00:00.000Z",
        description: null,
        mechanics: [],
        categories: [],
        weight: null,
        communityRating: null,
        minPlayers: null,
        maxPlayers: null,
        bestPlayers: null,
        playingTime: null,
      },
    };
    storage = createMockStorage([existing]);
    predictionService = {
      ...createMockPredictionService(predictions),
      predictBggGame: () =>
        Promise.resolve({
          ...result100,
          bggVerification: { status: "existing-local-unverified", failure: "unavailable" },
        }),
    };
    const service = createWishlistService({
      storageService: storage,
      predictionService,
      gameService,
    });

    await expectPromiseError(service.refresh(existing.id), "BGG Thing verification failed");
    expect(await service.list()).toEqual([existing]);
  });

  test("mismatched Thing identity cannot replace a saved wishlist snapshot", async () => {
    const existing: WishlistEntry = {
      id: "entry-mismatch",
      bggId: 100,
      name: "Test Game",
      yearPublished: 2020,
      thumbnailUrl: null,
      predictedScore: 5,
      predictionConfidence: "weak",
      predictedBreakdown: null,
      nicheImpact: null,
      redundancyPreview: null,
      addedAt: "2026-01-01T00:00:00.000Z",
      bggSource: {
        observedAt: "2025-01-01T00:00:00.000Z",
        description: null,
        mechanics: [],
        categories: [],
        weight: null,
        communityRating: null,
        minPlayers: null,
        maxPlayers: null,
        bestPlayers: null,
        playingTime: null,
      },
    };
    storage = createMockStorage([existing]);
    predictionService = {
      ...createMockPredictionService(predictions),
      predictBggGame: () =>
        Promise.resolve({
          ...result100,
          verifiedScoringInput: makeScoringInput(101, "Mismatched Game"),
        }),
    };
    const service = createWishlistService({
      storageService: storage,
      predictionService,
      gameService,
    });

    await expectPromiseError(service.refresh(existing.id), "unavailable or mismatched");
    expect(await service.list()).toEqual([existing]);
  });

  test("failed refresh persistence keeps the prior durable entry unchanged", async () => {
    const existing: WishlistEntry = {
      id: "entry-save-failure",
      bggId: 100,
      name: "Test Game",
      yearPublished: 2020,
      thumbnailUrl: null,
      predictedScore: 5,
      predictionConfidence: "weak",
      predictedBreakdown: null,
      nicheImpact: null,
      redundancyPreview: null,
      addedAt: "2026-01-01T00:00:00.000Z",
      bggSource: {
        observedAt: "2025-01-01T00:00:00.000Z",
        description: "old source",
        mechanics: [],
        categories: [],
        weight: null,
        communityRating: null,
        minPlayers: null,
        maxPlayers: null,
        bestPlayers: null,
        playingTime: null,
      },
    };
    storage = createMockStorage([existing]);
    storage.saveWishlist = () => Promise.reject(new Error("injected wishlist write failure"));
    const service = createWishlistService({
      storageService: storage,
      predictionService,
      gameService,
    });

    await expectPromiseError(service.refresh(existing.id), "injected wishlist write failure");
    expect(await storage.loadWishlist()).toEqual([existing]);
    expect(await service.list()).toEqual([existing]);
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
      redundancyPreview: null,
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
        redundancyPreview: null,
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
        redundancyPreview: {
          penalty: 1,
          originalScore: 5,
          adjustedScore: 4,
          nicheNeighbors: [],
          nicheRank: 2,
          nicheSize: 1,
        },
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
    expect(list[1].redundancyPreview).toEqual({
      penalty: 1,
      originalScore: 5,
      adjustedScore: 4,
      nicheNeighbors: [],
      nicheRank: 2,
      nicheSize: 1,
    }); // failed refresh retains the previous snapshot
  });
});
