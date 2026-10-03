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
import type { WishlistDescriptionSignalCaptureRequest } from "../src/services/wishlist-redundancy-scoring.js";
import { createWishlistService } from "../src/services/wishlist-service";
import { WishlistAcquisitionRecoveryError } from "../src/services/wishlist-service.js";
import { parseBoardgameScoringThings } from "../src/services/bgg-xml-parser.js";
import {
  createJevPairCache,
  type JevPairJudgment,
} from "../src/services/jev-pair-cache-service.js";
import {
  buildJevPairDependencies,
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
} from "../src/services/jev-pair-identity.js";
import { JEV_JUDGMENT_CONTRACT } from "../src/services/jev/jev-judgment-contract.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createStorageService } from "../src/services/storage-service.js";
import { createFileOps } from "../src/services/file-ops.js";
import { createAfterWishlistAcquisitionRecovery } from "../src/services/wishlist-acquisition-startup.js";
import { createJevPairReadService } from "../src/services/jev-pair-read-service.js";

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

function asDurableGame(game: Game): Collection["games"][number] {
  return {
    ...game,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
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

function makeValidCaptureFitnessResult(score: number): FitnessResult {
  const result = makeFitnessResult(score, false);
  return {
    ...result,
    predictionMeta:
      result.predictionMeta === null
        ? null
        : { ...result.predictionMeta, actualAxisCount: result.ratedAxisCount },
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
    listGamesWithPredictionsFromSnapshot: () => Promise.resolve(allGames),
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

function makeCurrentReadEntry(description: string): WishlistEntry {
  return {
    id: "entry-live-read",
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
      description,
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
}

function makeCandidateCRow(
  collectionId: string,
  bggId: number,
  candidateName: string,
  candidateDescription: string,
  owned: Game,
  value: number,
  completedAt = NOW,
): JevPairJudgment {
  if (!owned.bggData?.description) throw new Error("owned test fixture requires description");
  const candidateMember = encodeWishlistBggMember(collectionId, String(bggId));
  const ownedMember = encodeOwnedLocalMember(collectionId, owned.id);
  const [gameAId, gameBId] = [candidateMember, ownedMember].sort();
  return {
    pairDomain: "wishlist-candidate",
    collectionId,
    gameAId,
    gameBId,
    signal: "C",
    dependencyKind: "C_ONLY",
    value,
    modelId: JEV_JUDGMENT_CONTRACT.modelId,
    rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
    questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
    requestSchemaVersion: JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
    scoreMappingVersion: JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
    semanticPolicyId: JEV_JUDGMENT_CONTRACT.semanticPolicyId,
    completedAt,
    dependencies: buildJevPairDependencies(
      "C_ONLY",
      { gameId: candidateMember, name: candidateName, description: candidateDescription },
      { gameId: ownedMember, name: owned.name, description: owned.bggData.description },
    ),
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

  test("current redundancy read projects separately without refreshing prediction or leaking source", async () => {
    const existing: WishlistEntry = {
      id: "entry-current-read",
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
        description: "Candidate prose",
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
    storage = createMockStorage([existing], undefined, true);
    let captureCount = 0;
    const basePrediction = createMockPredictionService(new Map(), []);
    const scoringPredictionService: PredictionService = {
      ...basePrediction,
      listGamesWithPredictionsFromSnapshot: () => {
        captureCount++;
        return Promise.resolve([]);
      },
      predictBggGame: () => Promise.reject(new Error("ordinary comparison must not predict")),
    };
    const service = createWishlistService({
      storageService: storage,
      predictionService: scoringPredictionService,
      gameService,
    });

    const results = await service.listWithCurrentRedundancy();
    expect(captureCount).toBe(1);
    expect(results[0].redundancy.source).toBe("current");
    expect(results[0].redundancy.adjustment?.penalty).toBe(0);
    expect(results[0].redundancy.adjustment?.originalScore).toBe(7.5);
    expect(results[0].entry).not.toHaveProperty("bggSource");
    expect(await service.list()).toEqual([existing]);
  });

  test("retries a source capture changed during owned scoring and excludes newly vetoed owners", async () => {
    const existing = makeCurrentReadEntry("Original candidate prose");
    const existingSource = existing.bggSource;
    if (!existingSource) throw new Error("wishlist fixture requires persisted BGG source");
    const owned = makeGame(900, "Eligible owner");
    if (!owned.bggData) throw new Error("owned fixture requires BGG source");
    owned.bggData.description = "Owned description";
    const baseStorage = createMockStorage([existing], { games: [asDurableGame(owned)] }, true);
    const initialCollection = await baseStorage.loadCollection();
    const initialSemantic = initialCollection.semanticRedundancy;
    let currentEntries = [existing];
    const currentCollection: Collection = {
      ...initialCollection,
      semanticRedundancy: {
        ...initialSemantic,
        settings: {
          ...initialSemantic.settings,
          enabled: true,
          weights: { ...initialSemantic.settings.weights, factual: 1, description: 1 },
        },
      },
    };
    const liveStorage: StorageService = {
      ...baseStorage,
      loadWishlist: () => Promise.resolve(structuredClone(currentEntries)),
      saveWishlist: (entries) => {
        currentEntries = structuredClone(entries);
        return Promise.resolve();
      },
      loadCollection: () => Promise.resolve(structuredClone(currentCollection)),
    };
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseFirst: () => void = () => undefined;
    const firstScoringGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let scoringCalls = 0;
    const updatedResult: PredictedGameResult = {
      ...result100,
      verifiedScoringInput: {
        ...makeScoringInput(100, "Test Game"),
        description: "Updated candidate prose",
      },
    };
    const basePrediction = createMockPredictionService(new Map([[100, updatedResult]]));
    const scoringPrediction: PredictionService = {
      ...basePrediction,
      listGamesWithPredictionsFromSnapshot: async (collection) => {
        scoringCalls++;
        if (scoringCalls === 1) {
          signalStarted();
          await firstScoringGate;
        }
        return collection.games.map((game) => {
          const score = makeFitnessResult(5, false);
          return { game, score };
        });
      },
    };
    const lastRequest: { current: WishlistDescriptionSignalCaptureRequest | null } = {
      current: null,
    };
    const resolveDescriptionSignal = Object.assign(
      (request: WishlistDescriptionSignalCaptureRequest) => {
        lastRequest.current = request;
        return Promise.resolve(request.pairs.map(() => 0.9));
      },
      {
        isCurrent: (request: WishlistDescriptionSignalCaptureRequest) =>
          request === lastRequest.current,
      },
    );
    const service = createWishlistService({
      storageService: liveStorage,
      predictionService: scoringPrediction,
      gameService,
      resolveWishlistDescriptionSignal: resolveDescriptionSignal,
    });

    const pending = service.listWithCurrentRedundancy();
    await started;
    await service.refresh(existing.id);
    releaseFirst();

    const result = await pending;
    expect(scoringCalls).toBe(2);
    expect(lastRequest.current?.pairs[0]?.candidate.bggSource.description).toBe(
      "Updated candidate prose",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.redundancy.source).toBe("current");
    expect(result[0]?.entry.predictedScore).toBe(existing.predictedScore);
    expect(result[0]?.entry).not.toHaveProperty("bggSource");
  });

  test("removed candidates are absent after a source-change retry", async () => {
    const existing = makeCurrentReadEntry("Candidate prose before removal");
    const baseStorage = createMockStorage([existing], undefined, true);
    let currentEntries = [existing];
    const liveStorage: StorageService = {
      ...baseStorage,
      loadWishlist: () => Promise.resolve(structuredClone(currentEntries)),
      saveWishlist: (entries) => {
        currentEntries = structuredClone(entries);
        return Promise.resolve();
      },
    };
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseFirst: () => void = () => undefined;
    const firstScoringGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let scoringCalls = 0;
    const basePrediction = createMockPredictionService(new Map());
    const scoringPrediction: PredictionService = {
      ...basePrediction,
      listGamesWithPredictionsFromSnapshot: async () => {
        scoringCalls++;
        if (scoringCalls === 1) {
          signalStarted();
          await firstScoringGate;
        }
        return [];
      },
    };
    const service = createWishlistService({
      storageService: liveStorage,
      predictionService: scoringPrediction,
      gameService,
    });

    const pending = service.listWithCurrentRedundancy();
    await started;
    await service.remove(existing.id);
    releaseFirst();

    expect(await pending).toEqual([]);
    expect(scoringCalls).toBe(2);
  });

  test("policy changes during capture retry before current projection publication", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    const owned = makeGame(902, "Owned");
    if (!owned.bggData) throw new Error("owned fixture requires BGG source");
    owned.bggData.description = "Owned description";
    const baseStorage = createMockStorage([existing], { games: [asDurableGame(owned)] }, true);
    const baseCollection = await baseStorage.loadCollection();
    const semantic = baseCollection.semanticRedundancy;
    let currentCollection: Collection = {
      ...baseCollection,
      semanticRedundancy: {
        ...semantic,
        settings: {
          ...semantic.settings,
          enabled: true,
          weights: { ...semantic.settings.weights, factual: 1, description: 1 },
        },
      },
    };
    const liveStorage: StorageService = {
      ...baseStorage,
      loadCollection: () => Promise.resolve(structuredClone(currentCollection)),
    };
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseFirst: () => void = () => undefined;
    const firstScoringGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let scoringCalls = 0;
    const basePrediction = createMockPredictionService(new Map(), [
      { game: owned, score: makeFitnessResult(5, false) },
    ]);
    const scoringPrediction: PredictionService = {
      ...basePrediction,
      listGamesWithPredictionsFromSnapshot: async (collection) => {
        scoringCalls++;
        if (scoringCalls === 1) {
          signalStarted();
          await firstScoringGate;
        }
        return collection.games.map((game) => {
          const score = makeFitnessResult(5, false);
          if (game.name === "Vetoed owner") score.vetoed = true;
          return { game, score };
        });
      },
    };
    let resolverCalls = 0;
    const resolveDescriptionSignal = Object.assign(
      (request: WishlistDescriptionSignalCaptureRequest) => {
        resolverCalls++;
        return Promise.resolve(request.pairs.map(() => 1));
      },
      { isCurrent: () => true },
    );
    const service = createWishlistService({
      storageService: liveStorage,
      predictionService: scoringPrediction,
      gameService,
      resolveWishlistDescriptionSignal: resolveDescriptionSignal,
    });

    const pending = service.listWithCurrentRedundancy();
    await started;
    currentCollection = {
      ...currentCollection,
      revision: currentCollection.revision + 1,
      games: [{ ...currentCollection.games[0], name: "Vetoed owner" }],
      semanticRedundancy: {
        ...currentCollection.semanticRedundancy,
        settings: {
          ...currentCollection.semanticRedundancy.settings,
          weights: {
            ...currentCollection.semanticRedundancy.settings.weights,
            description: 0,
          },
        },
      },
    };
    releaseFirst();

    const result = await pending;
    expect(scoringCalls).toBe(2);
    expect(resolverCalls).toBe(1);
    expect(result[0]?.redundancy.source).toBe("current");
    expect(result[0]?.redundancy.adjustment?.penalty).toBe(0);
    expect(result[0]?.entry.predictedScore).toBe(existing.predictedScore);
  });

  test("cache revision changes after C resolution cause current F-only publication", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    const owned = makeGame(901, "Owned");
    if (!owned.bggData) throw new Error("owned fixture requires BGG source");
    owned.bggData.description = "Owned description";
    const baseStorage = createMockStorage([existing], { games: [asDurableGame(owned)] }, true);
    const baseCollection = await baseStorage.loadCollection();
    const semantic = baseCollection.semanticRedundancy;
    const currentCollection: Collection = {
      ...baseCollection,
      semanticRedundancy: {
        ...semantic,
        settings: {
          ...semantic.settings,
          enabled: true,
          weights: { ...semantic.settings.weights, factual: 1, description: 1 },
        },
      },
    };
    let cacheRevision = 4;
    let wishlistReads = 0;
    const liveStorage: StorageService = {
      ...baseStorage,
      loadWishlist: () => {
        wishlistReads++;
        // This simulates a cache purge/upsert after resolver completion and before publication.
        if (wishlistReads === 2) cacheRevision++;
        return Promise.resolve([existing]);
      },
      loadCollection: () => Promise.resolve(structuredClone(currentCollection)),
    };
    const basePrediction = createMockPredictionService(new Map(), [
      { game: owned, score: makeFitnessResult(5, false) },
    ]);
    const lastRequest: { current: WishlistDescriptionSignalCaptureRequest | null } = {
      current: null,
    };
    let proofRevision = cacheRevision;
    const resolveDescriptionSignal = Object.assign(
      (request: WishlistDescriptionSignalCaptureRequest) => {
        lastRequest.current = request;
        proofRevision = cacheRevision;
        return Promise.resolve(request.pairs.map(() => 1));
      },
      {
        isCurrent: (request: WishlistDescriptionSignalCaptureRequest) =>
          request === lastRequest.current && proofRevision === cacheRevision,
      },
    );
    const service = createWishlistService({
      storageService: liveStorage,
      predictionService: basePrediction,
      gameService,
      resolveWishlistDescriptionSignal: resolveDescriptionSignal,
    });

    const afterInvalidation = await service.listWithCurrentRedundancy();
    const noCachedC = createWishlistService({
      storageService: liveStorage,
      predictionService: basePrediction,
      gameService,
      resolveWishlistDescriptionSignal: Object.assign(
        (request: WishlistDescriptionSignalCaptureRequest) =>
          Promise.resolve(request.pairs.map(() => null)),
        { isCurrent: () => true },
      ),
    });
    const factualOnly = await noCachedC.listWithCurrentRedundancy();
    expect(afterInvalidation[0]?.redundancy.source).toBe("current");
    expect(afterInvalidation[0]?.redundancy).toEqual(factualOnly[0]?.redundancy);
  });

  test("unreadable final source authority falls back to the saved prediction snapshot", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    const owned = makeGame(903, "Owned");
    if (!owned.bggData) throw new Error("owned fixture requires BGG source");
    owned.bggData.description = "Owned description";
    const baseStorage = createMockStorage([existing], { games: [asDurableGame(owned)] }, true);
    const baseCollection = await baseStorage.loadCollection();
    const semantic = baseCollection.semanticRedundancy;
    const currentCollection: Collection = {
      ...baseCollection,
      semanticRedundancy: {
        ...semantic,
        settings: {
          ...semantic.settings,
          enabled: true,
          weights: { ...semantic.settings.weights, factual: 1, description: 1 },
        },
      },
    };
    let collectionReads = 0;
    const liveStorage: StorageService = {
      ...baseStorage,
      loadCollection: () => {
        collectionReads++;
        if (collectionReads === 2 || collectionReads === 4)
          return Promise.reject(new Error("final authority unavailable"));
        return Promise.resolve(structuredClone(currentCollection));
      },
    };
    let scoringCalls = 0;
    const basePrediction = createMockPredictionService(new Map(), [
      { game: owned, score: makeFitnessResult(5, false) },
    ]);
    const scoringPrediction: PredictionService = {
      ...basePrediction,
      listGamesWithPredictionsFromSnapshot: () => {
        scoringCalls++;
        return Promise.resolve([{ game: owned, score: makeFitnessResult(5, false) }]);
      },
    };
    const lastRequest: { current: WishlistDescriptionSignalCaptureRequest | null } = {
      current: null,
    };
    const resolver = Object.assign(
      (request: WishlistDescriptionSignalCaptureRequest) => {
        lastRequest.current = request;
        return Promise.resolve(request.pairs.map(() => 0.8));
      },
      {
        isCurrent: (request: WishlistDescriptionSignalCaptureRequest) =>
          request === lastRequest.current,
      },
    );
    const service = createWishlistService({
      storageService: liveStorage,
      predictionService: scoringPrediction,
      gameService,
      resolveWishlistDescriptionSignal: resolver,
    });

    const result = await service.listWithCurrentRedundancy();
    expect(scoringCalls).toBe(2);
    expect(result).toHaveLength(1);
    expect(result[0]?.redundancy.source).toBe("base-prediction");
    expect(result[0]?.redundancy.orderingScore).toBe(existing.predictedScore);
  });

  test("current wishlist reads exclude additional owned BGG IDs before scoring", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    existing.bggId = 904;
    const owner = makeGame(903, "Owned with additional BGG identity");
    owner.additionalBggIds = [existing.bggId];
    const storage = createMockStorage([existing], { games: [asDurableGame(owner)] }, true);
    let resolverCalls = 0;
    const service = createWishlistService({
      storageService: storage,
      predictionService: createMockPredictionService(new Map(), [
        { game: owner, score: makeFitnessResult(5, false) },
      ]),
      gameService,
      resolveWishlistDescriptionSignal: Object.assign(
        () => {
          resolverCalls++;
          return Promise.resolve([]);
        },
        { isCurrent: () => true },
      ),
    });

    expect(await service.list()).toEqual([]);
    expect(await service.listWithCurrentRedundancy()).toEqual([]);
    expect(resolverCalls).toBe(0);
  });

  test("acquisition overlap appearing during scoring is excluded at the final source fence", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    existing.bggId = 906;
    const owner = makeGame(907, "Owner");
    if (!owner.bggData) throw new Error("owner fixture requires BGG source");
    owner.bggData.description = "Owner description";
    const baseStorage = createMockStorage([existing], { games: [asDurableGame(owner)] }, true);
    const currentCollection = await baseStorage.loadCollection();
    currentCollection.semanticRedundancy.settings = {
      ...currentCollection.semanticRedundancy.settings,
      enabled: true,
      weights: {
        ...currentCollection.semanticRedundancy.settings.weights,
        description: 1,
      },
    };
    const storage: StorageService = {
      ...baseStorage,
      loadCollection: () => Promise.resolve(structuredClone(currentCollection)),
    };
    let signalResolverCalls = 0;
    let markResolverEntered: () => void = () => {};
    let releaseResolver: () => void = () => {};
    const resolverEntered = new Promise<void>((resolve) => {
      markResolverEntered = resolve;
    });
    const resolverGate = new Promise<void>((resolve) => {
      releaseResolver = resolve;
    });
    const service = createWishlistService({
      storageService: storage,
      predictionService: createMockPredictionService(new Map(), [
        { game: owner, score: makeFitnessResult(5, false) },
      ]),
      gameService,
      resolveWishlistDescriptionSignal: Object.assign(
        async (request: WishlistDescriptionSignalCaptureRequest) => {
          signalResolverCalls++;
          markResolverEntered();
          await resolverGate;
          return request.pairs.map(() => 0.8);
        },
        { isCurrent: () => true },
      ),
    });

    const resultPromise = service.listWithCurrentRedundancy();
    await resolverEntered;
    const currentOwner = currentCollection.games[0];
    if (!currentOwner) throw new Error("owner fixture is missing from collection");
    currentOwner.additionalBggIds = [existing.bggId];
    releaseResolver();

    expect(await resultPromise).toEqual([]);
    expect(signalResolverCalls).toBe(1);
  });

  test("saved fallback fails closed when ownership membership cannot be read", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    const owner = makeGame(905, "Owned");
    const baseStorage = createMockStorage([existing], { games: [asDurableGame(owner)] }, true);
    let collectionReads = 0;
    const storage: StorageService = {
      ...baseStorage,
      loadCollection: async () => {
        collectionReads++;
        if (collectionReads > 1) throw new Error("ownership authority unavailable");
        return baseStorage.loadCollection();
      },
    };
    const service = createWishlistService({
      storageService: storage,
      predictionService: createMockPredictionService(new Map(), [
        { game: owner, score: makeFitnessResult(5, false) },
      ]),
      gameService,
      resolveWishlistDescriptionSignal: Object.assign(() => Promise.resolve([]), {
        isCurrent: () => true,
      }),
    });

    expect(await service.listWithCurrentRedundancy()).toEqual([]);
    expect(collectionReads).toBeGreaterThan(1);
  });

  test("acquisition transfers compatible C_ONLY evidence before cleanup and restart replays safely", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-acquisition-test-"));
    let cache = await createJevPairCache(directory);
    try {
      const entry = makeCurrentReadEntry("Exact candidate description");
      entry.bggId = 200;
      entry.name = "Acquired candidate";
      const acquired = makeGame(200, entry.name);
      acquired.id = "owned-acquired-200";
      if (!acquired.bggData) throw new Error("acquired fixture requires BGG data");
      acquired.bggData.description = "Exact candidate description";
      const other = makeGame(900, "Existing owned game");
      other.id = "owned-existing-900";
      if (!other.bggData) throw new Error("owned fixture requires BGG data");
      other.bggData.description = "Exact owned description";
      const otherOwners = [other];
      for (let index = 0; index < 2; index++) {
        const owner = makeGame(901 + index, `Additional owner ${index}`);
        owner.id = `owned-existing-${901 + index}`;
        if (!owner.bggData) throw new Error("owned fixture requires BGG data");
        owner.bggData.description = `Exact owner description ${index}`;
        otherOwners.push(owner);
      }
      const normalizationOnlyGames = Array.from({ length: 20 }, (_, index) => {
        const game = makeGame(1000 + index, `Normalization source ${index}`);
        game.id = `normalization-${index}`;
        return game;
      });

      const baseStorage = createMockStorage(
        [entry],
        {
          games: [
            asDurableGame(acquired),
            ...otherOwners.map(asDurableGame),
            ...normalizationOnlyGames.map(asDurableGame),
          ],
        },
        true,
      );
      const initial = await baseStorage.loadCollection();
      const semantic = initial.semanticRedundancy;
      initial.semanticRedundancy = {
        ...semantic,
        settings: {
          ...semantic.settings,
          enabled: true,
          weights: { ...semantic.settings.weights, factual: 1, description: 1 },
        },
      };
      const storage: StorageService = {
        ...baseStorage,
        loadCollection: () => Promise.resolve(structuredClone(initial)),
      };
      const predictionGames = [
        { game: acquired, score: makeFitnessResult(7, false) },
        ...otherOwners.map((owner) => ({ game: owner, score: makeFitnessResult(6, false) })),
        ...normalizationOnlyGames.map((game) => ({ game, score: makeFitnessResult(4, false) })),
      ];
      const predictionBase = createMockPredictionService(new Map(), predictionGames);
      let scoringCaptureCalls = 0;
      const prediction: PredictionService = {
        ...predictionBase,
        listGamesWithPredictionsFromSnapshot: async () => {
          scoringCaptureCalls++;
          return Promise.resolve(predictionGames);
        },
      };
      const candidateId = encodeWishlistBggMember(initial.id, "200");
      for (const [index, owner] of otherOwners.entries()) {
        cache.upsert(
          makeCandidateCRow(
            initial.id,
            200,
            entry.name,
            entry.bggSource?.description ?? "",
            owner,
            0.82 - index * 0.1,
            "2026-09-30T12:00:00.000Z",
          ),
        );
      }
      let failWishlistSave = true;
      const savingStorage: StorageService = {
        ...storage,
        saveWishlist: (entries) => {
          if (failWishlistSave) {
            failWishlistSave = false;
            return Promise.reject(new Error("injected post-transfer wishlist save failure"));
          }
          return baseStorage.saveWishlist(entries);
        },
      };
      let indexBuilds = 0;
      let ownedLookups = 0;
      let eligibleSetSize = 0;
      const membershipProbes = { candidate: 0, owned: 0 };
      let candidateResolverCalls = 0;
      const service = createWishlistService({
        storageService: savingStorage,
        predictionService: prediction,
        gameService: {
          ...gameService,
          addGame: () => Promise.resolve({ game: acquired, bggImported: false }),
        },
        jevPairCache: cache,
        resolveWishlistDescriptionSignal: Object.assign(
          (request: WishlistDescriptionSignalCaptureRequest) => {
            candidateResolverCalls++;
            return Promise.resolve(request.pairs.map(() => 0.9));
          },
          { isCurrent: () => true },
        ),
        acquisitionObserver: {
          onCollectionIndexBuilt: (gameCount) => {
            indexBuilds++;
            expect(gameCount).toBe(24);
          },
          onOwnedGameLookup: () => {
            ownedLookups++;
          },
          onEligibleOwnedSetBuilt: (count) => {
            eligibleSetSize = count;
          },
          onEligibilityMembershipProbe: (domain) => {
            membershipProbes[domain]++;
          },
        },
      });

      const failedBeforeCommit = createWishlistService({
        storageService: savingStorage,
        predictionService: prediction,
        gameService: {
          ...gameService,
          addGame: () => Promise.reject(new Error("collection write failed")),
        },
        jevPairCache: cache,
      });
      await expectPromiseError(
        failedBeforeCommit.acquireGame({ bggId: 200, name: entry.name }),
        "collection write failed",
      );
      expect(await savingStorage.loadWishlist()).toHaveLength(1);

      const cacheDb = new Database(join(directory, "jev-pair-cache.sqlite"));
      cacheDb.exec(
        "CREATE TRIGGER fail_acquisition_transfer BEFORE INSERT ON judgments WHEN NEW.pair_domain='collection' BEGIN SELECT RAISE(ABORT, 'injected transfer failure'); END;",
      );
      cacheDb.close();
      let acquisitionError: unknown;
      try {
        await service.acquireGame({ bggId: 200, name: entry.name });
      } catch (error) {
        acquisitionError = error;
      }
      expect(acquisitionError).toBeInstanceOf(WishlistAcquisitionRecoveryError);
      expect(await service.list()).toEqual([]);
      expect(await service.listWithCurrentRedundancy()).toEqual([]);
      expect(candidateResolverCalls).toBe(0);
      expect(await savingStorage.loadWishlist()).toHaveLength(1);
      expect(cache.candidateCOnlyPairs(candidateId)).toHaveLength(3);
      expect(indexBuilds).toBe(1);
      expect(ownedLookups).toBe(3);
      expect(eligibleSetSize).toBe(24);
      expect(membershipProbes).toEqual({ candidate: 3, owned: 3 });
      expect(scoringCaptureCalls).toBe(2);
      const cleanupDb = new Database(join(directory, "jev-pair-cache.sqlite"));
      cleanupDb.exec("DROP TRIGGER fail_acquisition_transfer");
      cleanupDb.close();

      await expectPromiseError(
        service.finalizeAcquisition(200, acquired.id),
        "injected post-transfer wishlist save failure",
      );
      expect(indexBuilds).toBe(2);
      expect(ownedLookups).toBe(6);
      expect(membershipProbes).toEqual({ candidate: 6, owned: 6 });
      expect(scoringCaptureCalls).toBe(3);
      expect(await savingStorage.loadWishlist()).toHaveLength(1);
      expect(await service.listWithCurrentRedundancy()).toEqual([]);
      expect(candidateResolverCalls).toBe(0);
      const transferred = cache.lookup({ gameAId: acquired.id, gameBId: other.id, signal: "C" });
      expect(transferred?.value).toBe(0.82);
      expect(transferred?.completedAt).toBe("2026-09-30T12:00:00.000Z");
      expect(cache.candidateCOnlyPairs(candidateId)).toHaveLength(0);

      failWishlistSave = false;
      expect(await service.reconcileAcquisitions()).toBe(1);
      expect(scoringCaptureCalls).toBe(5);
      expect(await savingStorage.loadWishlist()).toHaveLength(0);
      expect(cache.lookup({ gameAId: acquired.id, gameBId: other.id, signal: "C" })).toEqual(
        transferred,
      );

      cache.close();
      cache = await createJevPairCache(directory);
      const ownedReadCollection = await savingStorage.loadCollection();
      ownedReadCollection.semanticRedundancy.settings.cachedOwnerNoteUse = false;
      const predictionCapture = [acquired, ...otherOwners, ...normalizationOnlyGames].map(
        (game) => ({
          game: asDurableGame(game),
          score: makeValidCaptureFitnessResult(game.id === acquired.id ? 7 : 5),
        }),
      );
      const ownedRead = createJevPairReadService(cache).resolveWithProof({
        collection: ownedReadCollection,
        predictionCapture,
        factualWeights: { binary: 1, continuous: 1 },
        captureIdentity: {
          sourceVectorIdentity: "acquisition-source-vector",
          tournamentIdentity: "acquisition-tournament",
          predictionCaptureIdentity: "acquisition-prediction-capture",
        },
      });
      expect(ownedRead.result.status).not.toBe("not-ready");
      if (!("table" in ownedRead.result) || !ownedRead.result.table)
        throw new Error("owned read did not produce a pair table");
      expect(
        ownedRead.result.table.pairs.find(
          (pair) => pair.gameAId === acquired.id && pair.gameBId === other.id,
        ),
      ).toMatchObject({ description: 0.82, ownerNote: null });
      expect(ownedRead.proof).not.toHaveProperty("noteText");

      const removable = makeCurrentReadEntry("Removal candidate prose");
      removable.id = "ordinary-removal-entry";
      removable.bggId = 201;
      const removableMember = encodeWishlistBggMember(initial.id, "201");
      const removableOwned = encodeOwnedLocalMember(initial.id, other.id);
      const [removableA, removableB] = [removableMember, removableOwned].sort();
      cache.upsert({
        pairDomain: "wishlist-candidate",
        collectionId: initial.id,
        gameAId: removableA,
        gameBId: removableB,
        signal: "C",
        dependencyKind: "C_ONLY",
        value: 0.5,
        modelId: JEV_JUDGMENT_CONTRACT.modelId,
        rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
        questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
        requestSchemaVersion: JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
        scoreMappingVersion: JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
        semanticPolicyId: JEV_JUDGMENT_CONTRACT.semanticPolicyId,
        completedAt: NOW,
        dependencies: buildJevPairDependencies(
          "C_ONLY",
          {
            gameId: removableMember,
            name: removable.name,
            description: removable.bggSource?.description ?? undefined,
          },
          {
            gameId: removableOwned,
            name: other.name,
            description: other.bggData?.description ?? undefined,
          },
        ),
      });
      await baseStorage.saveWishlist([removable]);
      const reopenedService = createWishlistService({
        storageService: savingStorage,
        predictionService: prediction,
        gameService,
        jevPairCache: cache,
      });
      await reopenedService.remove(removable.id);
      expect(cache.candidateCOnlyPairs(removableMember)).toHaveLength(0);
      expect(await baseStorage.loadWishlist()).toHaveLength(0);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("durable startup recovery gates app creation and owned C_ONLY reads survive cache reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-acquisition-restart-"));
    let cache = await createJevPairCache(directory);
    try {
      const entry = makeCurrentReadEntry("Persisted candidate description");
      entry.id = "persisted-wishlist-entry";
      entry.bggId = 320;
      entry.name = "Persisted acquired game";
      const acquired = makeGame(320, entry.name);
      acquired.id = "persisted-owned-320";
      if (!acquired.bggData) throw new Error("acquired fixture requires BGG data");
      acquired.bggData.description = entry.bggSource?.description ?? null;
      const other = makeGame(920, "Persisted existing owner");
      other.id = "persisted-owned-920";
      if (!other.bggData) throw new Error("owned fixture requires BGG data");
      other.bggData.description = "Persisted owned description";

      const fixtureStorage = createMockStorage(
        [entry],
        { games: [asDurableGame(acquired), asDurableGame(other)] },
        true,
      );
      const collection = await fixtureStorage.loadCollection();
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: { ...collection.semanticRedundancy.settings.weights, factual: 1, description: 1 },
      };
      const persistedStorage = createStorageService({
        dataDir: directory,
        configPath: join(directory, "config.json"),
        fileOps: createFileOps(),
      });
      await persistedStorage.saveCollection(collection);
      await persistedStorage.saveWishlist([entry]);
      cache.upsert(
        makeCandidateCRow(
          collection.id,
          entry.bggId,
          entry.name,
          entry.bggSource?.description ?? "",
          other,
          0.77,
          "2026-09-29T08:30:00.000Z",
        ),
      );
      const prediction = createMockPredictionService(new Map(), [
        { game: acquired, score: makeFitnessResult(7, false) },
        { game: other, score: makeFitnessResult(6, false) },
      ]);
      const addCommittedGame = {
        ...gameService,
        addGame: () => Promise.resolve({ game: acquired, bggImported: false }),
      };
      const firstService = createWishlistService({
        storageService: persistedStorage,
        predictionService: prediction,
        gameService: addCommittedGame,
        jevPairCache: cache,
      });
      const failureDb = new Database(join(directory, "jev-pair-cache.sqlite"));
      failureDb.exec(
        "CREATE TRIGGER fail_restart_transfer BEFORE INSERT ON judgments WHEN NEW.pair_domain='collection' BEGIN SELECT RAISE(ABORT, 'injected restart transfer failure'); END;",
      );
      failureDb.close();
      let routeError: unknown;
      try {
        await firstService.acquireGame({ bggId: entry.bggId, name: entry.name });
      } catch (error) {
        routeError = error;
      }
      expect(routeError).toBeInstanceOf(WishlistAcquisitionRecoveryError);
      expect(await persistedStorage.loadWishlist()).toHaveLength(1);
      expect(await firstService.list()).toHaveLength(0);

      cache.close();
      cache = await createJevPairCache(directory);
      const restartedStorage = createStorageService({
        dataDir: directory,
        configPath: join(directory, "config.json"),
        fileOps: createFileOps(),
      });
      const restartedService = createWishlistService({
        storageService: restartedStorage,
        predictionService: prediction,
        gameService: addCommittedGame,
        jevPairCache: cache,
      });
      let appFactoryCalls = 0;
      await expectPromiseError(
        createAfterWishlistAcquisitionRecovery(restartedService, () => {
          appFactoryCalls++;
          return "app";
        }),
        "injected restart transfer failure",
      );
      expect(appFactoryCalls).toBe(0);
      const recoveryDb = new Database(join(directory, "jev-pair-cache.sqlite"));
      recoveryDb.exec("DROP TRIGGER fail_restart_transfer");
      recoveryDb.close();
      const boot = await createAfterWishlistAcquisitionRecovery(restartedService, () => {
        appFactoryCalls++;
        return "app";
      });
      expect(boot).toEqual({ application: "app", reconciledEntries: 1 });
      expect(appFactoryCalls).toBe(1);
      expect(await restartedStorage.loadWishlist()).toHaveLength(0);

      const transferred = cache.lookup({ gameAId: acquired.id, gameBId: other.id, signal: "C" });
      expect(transferred).toMatchObject({ value: 0.77, completedAt: "2026-09-29T08:30:00.000Z" });
      cache.close();
      cache = await createJevPairCache(directory);
      const readCollection = await restartedStorage.loadCollection();
      const read = createJevPairReadService(cache).resolveWithProof({
        collection: readCollection,
        predictionCapture: [
          { game: acquired, score: makeValidCaptureFitnessResult(7) },
          { game: other, score: makeValidCaptureFitnessResult(6) },
        ],
        factualWeights: { binary: 1, continuous: 1 },
        captureIdentity: {
          sourceVectorIdentity: "durable-acquisition-vector",
          tournamentIdentity: "durable-acquisition-tournament",
          predictionCaptureIdentity: "durable-acquisition-predictions",
        },
      });
      expect(read.result.status).not.toBe("not-ready");
      if (!("table" in read.result) || !read.result.table)
        throw new Error("owned reader did not produce a pair table");
      const ownedPair = read.result.table.pairs.find(
        (pair) => pair.gameAId === acquired.id && pair.gameBId === other.id,
      );
      expect(ownedPair?.description).toBe(0.77);
      expect(ownedPair?.ownerNote).toBeNull();
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("remove and clear purge only selected candidate rows and preserve collection judgments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-removal-cache-"));
    const cache = await createJevPairCache(directory);
    try {
      const first = makeCurrentReadEntry("First candidate prose");
      first.id = "candidate-one-entry";
      first.bggId = 701;
      const second = makeCurrentReadEntry("Second candidate prose");
      second.id = "candidate-two-entry";
      second.bggId = 702;
      const owner = makeGame(970, "Owned comparator");
      owner.id = "owned-comparator";
      if (!owner.bggData) throw new Error("owned fixture requires BGG data");
      owner.bggData.description = "Owned comparator description";
      const storage = createMockStorage([first, second], { games: [asDurableGame(owner)] });
      const collection = await storage.loadCollection();
      const firstMember = encodeWishlistBggMember(collection.id, String(first.bggId));
      const secondMember = encodeWishlistBggMember(collection.id, String(second.bggId));
      const firstRow = makeCandidateCRow(
        collection.id,
        first.bggId,
        first.name,
        first.bggSource?.description ?? "",
        owner,
        0.4,
      );
      const secondRow = makeCandidateCRow(
        collection.id,
        second.bggId,
        second.name,
        second.bggSource?.description ?? "",
        owner,
        0.6,
      );
      const collectionRow: JevPairJudgment = {
        collectionId: collection.id,
        gameAId: "owned-a",
        gameBId: "owned-b",
        signal: "C",
        dependencyKind: "C_ONLY",
        value: 0.9,
        modelId: JEV_JUDGMENT_CONTRACT.modelId,
        rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
        questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
        requestSchemaVersion: JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
        scoreMappingVersion: JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
        semanticPolicyId: JEV_JUDGMENT_CONTRACT.semanticPolicyId,
        completedAt: NOW,
        dependencies: buildJevPairDependencies(
          "C_ONLY",
          { gameId: "owned-a", name: "Owned A", description: "Owned A description" },
          { gameId: "owned-b", name: "Owned B", description: "Owned B description" },
        ),
      };
      cache.upsert(firstRow);
      cache.upsert(secondRow);
      cache.upsert(collectionRow);
      const service = createWishlistService({
        storageService: storage,
        predictionService: createMockPredictionService(new Map()),
        gameService,
        jevPairCache: cache,
      });

      await service.remove(first.id);
      expect(cache.candidateCOnlyPairs(firstMember)).toHaveLength(0);
      expect(cache.candidateCOnlyPairs(secondMember)).toHaveLength(1);
      expect(cache.lookup({ gameAId: "owned-a", gameBId: "owned-b", signal: "C" })).toEqual(
        collectionRow,
      );
      expect(await service.clear()).toBe(1);
      expect(cache.candidateCOnlyPairs(secondMember)).toHaveLength(0);
      expect(cache.lookup({ gameAId: "owned-a", gameBId: "owned-b", signal: "C" })).toEqual(
        collectionRow,
      );
      expect(await storage.loadWishlist()).toHaveLength(0);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("acquisition transfers only currently proven rows and purges invalid or ineligible candidates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-acquisition-proof-matrix-"));
    const cache = await createJevPairCache(directory);
    try {
      const entry = makeCurrentReadEntry("Exact candidate source");
      entry.id = "proof-matrix-entry";
      entry.bggId = 811;
      entry.name = "Proof matrix candidate";
      const acquired = makeGame(811, entry.name);
      acquired.id = "proof-matrix-acquired";
      if (!acquired.bggData) throw new Error("candidate fixture requires BGG source");
      acquired.bggData.description = entry.bggSource?.description ?? null;
      const labels = [
        "valid",
        "description",
        "name",
        "model",
        "rubric",
        "policy",
        "veto",
        "zero",
        "null",
      ];
      const owners = labels.map((label, index) => {
        const owner = makeGame(1200 + index, `Owner ${label}`);
        owner.id = `proof-owner-${label}`;
        if (!owner.bggData) throw new Error("owned fixture requires BGG source");
        owner.bggData.description = `Description ${label}`;
        return owner;
      });
      const storage = createMockStorage([entry], {
        games: [asDurableGame(acquired), ...owners.map(asDurableGame)],
      });
      const collection = await storage.loadCollection();
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        weights: { ...collection.semanticRedundancy.settings.weights, description: 1 },
      };
      const liveStorage: StorageService = {
        ...storage,
        loadCollection: () => Promise.resolve(structuredClone(collection)),
      };
      const candidateMember = encodeWishlistBggMember(collection.id, String(entry.bggId));
      for (const [index, owner] of owners.entries()) {
        const label = labels[index];
        if (!label) throw new Error("owner label missing");
        const row = makeCandidateCRow(
          collection.id,
          entry.bggId,
          entry.name,
          entry.bggSource?.description ?? "",
          owner,
          0.51 + index * 0.01,
        );
        const candidateDependency = row.dependencies.find(
          (dependency) => dependency.gameId === candidateMember,
        );
        if (!candidateDependency) throw new Error("candidate dependency missing from test row");
        if (label === "description") {
          row.dependencies = row.dependencies.map((dependency) =>
            dependency.gameId === candidateMember
              ? { ...candidateDependency, descriptionFingerprint: "a".repeat(64) }
              : dependency,
          );
        } else if (label === "name") {
          row.dependencies = row.dependencies.map((dependency) =>
            dependency.gameId === candidateMember
              ? { ...candidateDependency, nameFingerprint: "b".repeat(64) }
              : dependency,
          );
        } else if (label === "model") row.modelId = "retired-model";
        else if (label === "rubric") row.rubricVersion = "retired-rubric";
        else if (label === "policy") row.semanticPolicyId = "retired-policy";
        cache.upsert(row);
      }

      const sharedOwner = owners[0];
      if (!sharedOwner) throw new Error("shared-note fixture missing owner");
      const sharedCandidateMember = candidateMember;
      const sharedOwnerMember = encodeOwnedLocalMember(collection.id, "shared-only-member");
      const [sharedA, sharedB] = [sharedCandidateMember, sharedOwnerMember].sort();
      const sharedDependencies = buildJevPairDependencies(
        "SHARED_CD",
        {
          gameId: sharedCandidateMember,
          name: entry.name,
          description: entry.bggSource?.description ?? "",
          note: { text: "test-only synthetic note dependency", version: "1" },
        },
        {
          gameId: sharedOwnerMember,
          name: "Unowned synthetic comparison",
          description: "Synthetic description",
          note: { text: "test-only synthetic note dependency", version: "1" },
        },
      );
      const rawDb = new Database(join(directory, "jev-pair-cache.sqlite"));
      rawDb
        .query(
          "INSERT INTO judgments (pair_domain,game_a,game_b,signal,collection_id,consent_epoch,dependency_kind,value,confidence,model_id,rubric_version,question_version,request_schema_version,score_mapping_version,semantic_policy_id,completed_at,dependencies_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "wishlist-candidate",
          sharedA,
          sharedB,
          "C",
          collection.id,
          "synthetic-consent",
          "SHARED_CD",
          0.99,
          null,
          JEV_JUDGMENT_CONTRACT.modelId,
          JEV_JUDGMENT_CONTRACT.rubricVersion,
          JEV_JUDGMENT_CONTRACT.questionVersion,
          JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
          JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
          JEV_JUDGMENT_CONTRACT.semanticPolicyId,
          NOW,
          JSON.stringify(sharedDependencies),
        );
      rawDb.close();

      const predictionGames = [
        { game: acquired, score: makeFitnessResult(7, false) },
        ...owners.map((owner, index) => {
          const label = labels[index];
          const score =
            label === "null"
              ? null
              : label === "zero"
                ? makeFitnessResult(0, false)
                : label === "veto"
                  ? { ...makeFitnessResult(5, false), vetoed: true }
                  : makeFitnessResult(5, false);
          return { game: owner, score };
        }),
      ];
      const service = createWishlistService({
        storageService: liveStorage,
        predictionService: createMockPredictionService(new Map(), predictionGames),
        gameService,
        jevPairCache: cache,
      });
      await service.finalizeAcquisition(entry.bggId, acquired.id);
      expect(await liveStorage.loadWishlist()).toHaveLength(0);
      expect(cache.candidateCOnlyPairs(candidateMember)).toHaveLength(0);
      expect(
        cache.lookup({ gameAId: acquired.id, gameBId: sharedOwner.id, signal: "C" }),
      ).toMatchObject({ value: 0.51 });
      for (const owner of owners.slice(1)) {
        expect(cache.lookup({ gameAId: acquired.id, gameBId: owner.id, signal: "C" })).toBeNull();
      }
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
