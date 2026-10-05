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
import { WishlistAcquisitionRecoveryError } from "../src/services/wishlist-service.js";
import { parseBoardgameScoringThings } from "../src/services/bgg-xml-parser.js";
import {
  createJevPairCache,
  type JevPairCache,
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
import { createWishlistRunPreparationService } from "../src/services/wishlist-run-preparation.js";
import { JevRunService, type JevRunCapture } from "../src/services/jev-run-service.js";
import { JevRunController } from "../src/services/jev-run-controller.js";
import { createJevRunSourceAdapter } from "../src/services/jev-run-source-adapter.js";
import {
  prepareUnifiedJevRun,
  type PreparedUnifiedRun,
} from "../src/services/unified-jev-run-preparation.js";
import { createUnifiedScoringService } from "../src/services/unified-scoring-service.js";
import { createFitnessService } from "../src/services/fitness-service.js";
import { DEFAULT_JEV_RUN_BUDGET } from "../src/services/jev-run-budget.js";
import { createJevGateway } from "../src/services/jev/jev-gateway.js";
import { wishlistCollectionSourceIdentity } from "../src/services/wishlist-collection-source-identity.js";
import { createHydratedTestApp } from "./helpers/test-app.js";
import {
  profileSourceCoordinatorFor,
  runOutsideProfileSourceCoordinator,
  wishlistMutationGenerationFor,
  type ProfileSourceCoordinator,
} from "../src/services/profile-source-coordinator.js";

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

async function prepareUnifiedWishlist(
  scoring: ReturnType<typeof createUnifiedScoringService>,
  sourceAdapter: ReturnType<typeof createJevRunSourceAdapter>,
  cache: JevPairCache,
  selection: { kind: "all" } | { kind: "selected"; bggIds: number[] } = { kind: "all" },
): Promise<PreparedUnifiedRun> {
  const prepared = await prepareUnifiedJevRun({
    scoring,
    sourceAdapter,
    cache,
    request: { scope: "wishlist", selectedBggIds: [] },
    wishlistSelection: selection,
    budget: DEFAULT_JEV_RUN_BUDGET,
  });
  if (!prepared.wishlistPreparation) throw new Error("Expected unified wishlist preparation");
  return prepared;
}

function createTestUnifiedScoringService(storageService: StorageService, cache: JevPairCache) {
  return createUnifiedScoringService({
    storageService,
    cache,
    fitnessService: createFitnessService(),
  });
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
    expect(entry.predictedScore).toBeNull();
    expect(entry.predictionConfidence).toBeNull();
    expect(entry.predictedBreakdown).toBeNull();
    expect((await storage.loadWishlist())[0]?.predictedScore).toBe(7.5);
    expect(entry.addedAt).toBeTruthy();
    expect(entry.id).toBeTruthy();
    expect(entry.redundancyPreview).toBeNull();
    expect((await storage.loadWishlist())[0]?.bggSource).toEqual({
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

    await createWishlistService({
      storageService: storage,
      predictionService,
      gameService,
    }).add(100);

    expect((await storage.loadWishlist())[0]?.bggSource?.description).toBe(
      "  Exact & decoded text  ",
    );
    expect((await storage.loadWishlist())[0]?.bggSource?.observedAt).toBe(observedAt);
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

    const listed = await createWishlistService({
      storageService: storage,
      predictionService,
      gameService,
    }).list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: entry.id, name: entry.name, predictedScore: null });
    expect(listed[0]).not.toHaveProperty("bggSource");
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
    expect(entry.redundancyPreview).toBeNull();
    expect((await storage.loadWishlist())[0]?.redundancyPreview).not.toBeNull();
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
    ).toBeNull();
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
    expect(refreshed.redundancyPreview).toBeNull();
    expect((await storage.loadWishlist())[0]?.redundancyPreview).not.toBeNull();
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
    expect(added.redundancyPreview).toBeNull();
    const savedPreview = (await storage.loadWishlist())[0]?.redundancyPreview;
    expect(savedPreview).not.toBeNull();
    expect((await svc.list())[0]?.redundancyPreview).toBeNull();

    const refreshed = await svc.refresh(added.id);
    expect(refreshed.id).toBe(added.id);
    expect(refreshed.addedAt).toBe(added.addedAt);
    expect(refreshed.redundancyPreview).toBeNull();
    expect((await storage.loadWishlist())[0]?.redundancyPreview).toEqual(savedPreview);
    expect((await svc.list())[0]?.redundancyPreview).toBeNull();
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
    expect(refreshed.predictedScore).toBeNull();
    expect(refreshed.predictionConfidence).toBeNull();
    expect((await storage.loadWishlist())[0]?.predictedScore).toBe(7.5);
    expect((await storage.loadWishlist())[0]?.bggSource?.observedAt).toBe(NOW);
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
    expect((await service.list())[0]).toMatchObject({
      id: existing.id,
      bggId: existing.bggId,
      predictedScore: null,
      redundancyPreview: null,
    });
    expect((await storage.loadWishlist())[0]).toEqual(existing);
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
    expect((await service.list())[0]).toMatchObject({ id: existing.id, predictedScore: null });
    expect((await storage.loadWishlist())[0]).toEqual(existing);
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
    expect((await service.list())[0]).toMatchObject({ id: existing.id, predictedScore: null });
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
    expect(list[0]?.predictedScore).toBeNull(); // no source authority in this mock
    expect(list[1]?.predictedScore).toBeNull();
    expect((await storage.loadWishlist())[0]?.predictedScore).toBe(7.5); // refresh persisted history
    expect((await storage.loadWishlist())[1]?.redundancyPreview).toEqual({
      penalty: 1,
      originalScore: 5,
      adjustedScore: 4,
      nicheNeighbors: [],
      nicheRank: 2,
      nicheSize: 1,
    }); // failed refresh retains the previous stored snapshot
  });

  test("current reads return unavailable V2 rather than saved scores without source authority", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    storage = createMockStorage([existing], undefined, true);
    let legacyPredictionCalls = 0;
    const prediction: PredictionService = {
      ...createMockPredictionService(new Map()),
      listGamesWithPredictionsFromSnapshot: () => {
        legacyPredictionCalls++;
        return Promise.resolve([]);
      },
      predictBggGame: () => Promise.reject(new Error("ordinary reads must not predict")),
    };
    const service = createWishlistService({
      storageService: storage,
      predictionService: prediction,
      gameService,
    });
    const [result] = await service.listWithCurrentRedundancy();
    expect(result?.prediction).toMatchObject({
      availability: "unavailable",
      reason: "source-unavailable",
    });
    expect(result?.entry.predictedScore).toBeNull();
    expect(result?.redundancy).toEqual({
      source: "unavailable",
      adjustment: null,
      orderingScore: null,
    });
    expect(result?.entry).not.toHaveProperty("bggSource");
    expect(legacyPredictionCalls).toBe(0);
    expect((await service.list())[0]?.predictedScore).toBeNull();
  });

  test("returns unavailable when current source capture is unavailable", async () => {
    const existing = makeCurrentReadEntry("Original candidate prose");
    storage = createMockStorage([existing]);
    let scoringCalls = 0;
    const prediction: PredictionService = {
      ...createMockPredictionService(new Map()),
      listGamesWithPredictionsFromSnapshot: () => {
        scoringCalls++;
        return Promise.resolve([]);
      },
    };
    const service = createWishlistService({
      storageService: storage,
      predictionService: prediction,
      gameService,
    });
    const [result] = await service.listWithCurrentRedundancy();
    expect(result?.prediction.availability).toBe("unavailable");
    expect(result?.entry.predictedScore).toBeNull();
    expect(scoringCalls).toBe(0);
  });

  test("removed candidates are absent from subsequent current projections", async () => {
    const existing = makeCurrentReadEntry("Candidate prose before removal");
    storage = createMockStorage([existing]);
    const service = createWishlistService({
      storageService: storage,
      predictionService,
      gameService,
    });
    await service.remove(existing.id);
    expect(await service.listWithCurrentRedundancy()).toEqual([]);
    expect(await storage.loadWishlist()).toEqual([]);
  });

  test("unavailable source authority cannot publish a saved prediction after policy changes", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    storage = createMockStorage([existing]);
    const changed = await storage.loadCollection();
    changed.revision++;
    await storage.saveCollection(changed);
    const [result] = await createWishlistService({
      storageService: storage,
      predictionService,
      gameService,
    }).listWithCurrentRedundancy();
    expect(result?.prediction).toMatchObject({ availability: "unavailable", source: "current" });
    expect(result?.entry.predictedScore).toBeNull();
    expect(result?.redundancy.orderingScore).toBeNull();
  });

  test("unreadable source authority returns unavailable instead of saved prediction history", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    storage = createMockStorage([existing]);
    const unavailableStorage: StorageService = {
      ...storage,
      loadJevSourceSnapshot: () => Promise.reject(new Error("source authority unavailable")),
      sourceVector: () => {
        throw new Error("source vector unavailable");
      },
    };
    const [result] = await createWishlistService({
      storageService: unavailableStorage,
      predictionService,
      gameService,
    }).listWithCurrentRedundancy();
    expect(result?.prediction).toMatchObject({
      availability: "unavailable",
      reason: "source-unavailable",
    });
    expect(result?.entry.predictedScore).toBeNull();
    expect(result?.redundancy.orderingScore).toBeNull();
  });

  test("current wishlist reads exclude additional owned BGG IDs before scoring", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    existing.bggId = 904;
    const owner = makeGame(903, "Owned with additional BGG identity");
    owner.additionalBggIds = [existing.bggId];
    const storage = createMockStorage([existing], { games: [asDurableGame(owner)] }, true);
    const service = createWishlistService({
      storageService: storage,
      predictionService: createMockPredictionService(new Map(), [
        { game: owner, score: makeFitnessResult(5, false) },
      ]),
      gameService,
    });

    expect(await service.list()).toEqual([]);
    expect(await service.listWithCurrentRedundancy()).toEqual([]);
  });

  test("ownership read failure rejects instead of disclosing saved wishlist metadata", async () => {
    const existing = makeCurrentReadEntry("Candidate prose");
    const baseStorage = createMockStorage([existing]);
    const storageWithUnreadableOwnership: StorageService = {
      ...baseStorage,
      loadCollection: () => Promise.reject(new Error("ownership authority unavailable")),
    };
    const service = createWishlistService({
      storageService: storageWithUnreadableOwnership,
      predictionService,
      gameService,
    });
    await expectPromiseError(
      service.listWithCurrentRedundancy(),
      "ownership authority unavailable",
    );
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
      const service = createWishlistService({
        storageService: savingStorage,
        predictionService: prediction,
        gameService: {
          ...gameService,
          addGame: () => Promise.resolve({ game: acquired, bggImported: false }),
        },
        jevPairCache: cache,
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
      expect(await savingStorage.loadWishlist()).toHaveLength(1);
      expect(cache.candidateCOnlyPairs(candidateId)).toHaveLength(3);
      expect(indexBuilds).toBe(1);
      expect(ownedLookups).toBe(3);
      expect(eligibleSetSize).toBe(24);
      expect(membershipProbes).toEqual({ candidate: 3, owned: 3 });
      expect(scoringCaptureCalls).toBe(1);
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
      expect(scoringCaptureCalls).toBe(2);
      expect(await savingStorage.loadWishlist()).toHaveLength(1);
      expect(await service.listWithCurrentRedundancy()).toEqual([]);
      const transferred = cache.lookup({ gameAId: acquired.id, gameBId: other.id, signal: "C" });
      expect(transferred?.value).toBe(0.82);
      expect(transferred?.completedAt).toBe("2026-09-30T12:00:00.000Z");
      expect(cache.candidateCOnlyPairs(candidateId)).toHaveLength(0);

      failWishlistSave = false;
      expect(await service.reconcileAcquisitions()).toBe(1);
      expect(scoringCaptureCalls).toBe(3);
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

  test("wishlist Jev preparation hydrates only selected missing sources and freezes exact counts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-run-preparation-"));
    const cache = await createJevPairCache(directory);
    const context = await createHydratedTestApp({ dataDir: directory, jevPairCache: cache });
    try {
      const unavailable = makeCurrentReadEntry("Legacy candidate");
      unavailable.id = "legacy-501";
      unavailable.bggId = 501;
      unavailable.name = "Legacy candidate";
      unavailable.predictedScore = 7.25;
      delete unavailable.bggSource;
      const eligible = makeCurrentReadEntry("Saved candidate prose");
      eligible.id = "saved-502";
      eligible.bggId = 502;
      eligible.name = "Saved candidate";
      const overlap = makeCurrentReadEntry("Overlap candidate");
      overlap.id = "overlap-503";
      overlap.bggId = 503;
      const unselectedA = makeCurrentReadEntry("Unselected A");
      unselectedA.id = "unselected-504";
      unselectedA.bggId = 504;
      const unselectedB = makeCurrentReadEntry("Unselected B");
      unselectedB.id = "unselected-505";
      unselectedB.bggId = 505;

      const owned = makeGame(900, "Owned comparator");
      owned.id = "owned-comparator-900";
      if (!owned.bggData) throw new Error("owned fixture requires BGG data");
      owned.bggData.description = "Owned comparator description";
      const overlapGame = makeGame(901, "Previously owned overlap");
      overlapGame.id = "overlap-game-901";
      overlapGame.additionalBggIds = [overlap.bggId];
      overlapGame.ownership = "previously-owned";

      const storage = context.storageService;
      const axis = await context.axisService.createAxis({
        name: "Wishlist hydration owner rating",
        weight: 1,
        source: "personal",
      });
      const collection = await storage.loadCollection();
      collection.games = [asDurableGame(owned), asDurableGame(overlapGame)];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        weights: { ...collection.semanticRedundancy.settings.weights, description: 1 },
      };
      const entries = [unavailable, eligible, overlap, unselectedA, unselectedB];
      await storage.saveCollection(collection);
      await storage.saveRedundancySettings({
        ...(await storage.loadRedundancySettings()),
        enabled: true,
        componentWeights: { binary: 1, continuous: 3 },
      });
      await context.gameService.rateGame(owned.id, { [axis.id]: 6 });
      await storage.saveWishlist(entries);
      await storage.hydrateSourceVector?.();
      const listGamesWithPredictionsFromSnapshot =
        context.predictionService.listGamesWithPredictionsFromSnapshot?.bind(
          context.predictionService,
        );
      if (!listGamesWithPredictionsFromSnapshot)
        throw new Error("Test prediction service lacks snapshot prediction support");
      const sourceAdapter = createJevRunSourceAdapter({
        storageService: storage,
        predictionService: { listGamesWithPredictionsFromSnapshot },
      });
      const getBoardgameScoringInput = context.gameService.getBoardgameScoringInput?.bind(
        context.gameService,
      );
      if (!getBoardgameScoringInput)
        throw new Error("Test game service lacks BGG scoring-input support");
      const fetchedIds: number[] = [];
      const preparation = createWishlistRunPreparationService({
        storageService: storage,
        gameService: {
          ...context.gameService,
          getBoardgameScoringInput: (bggId) => {
            fetchedIds.push(bggId);
            if (bggId === unavailable.bggId)
              return Promise.reject(new Error("fake BGG transport failure"));
            return getBoardgameScoringInput(bggId);
          },
        },
        sourceAdapter,
        cache,
      });
      const unifiedScoringService = createTestUnifiedScoringService(storage, cache);
      const selection = {
        kind: "selected" as const,
        bggIds: [unavailable.bggId, eligible.bggId, overlap.bggId],
      };
      await preparation.prepare(selection);
      const selectedUnified = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
        selection,
      );
      const selected = selectedUnified.wishlistPreparation;
      if (!selected) throw new Error("Expected unified wishlist preparation");

      expect(fetchedIds).toEqual([unavailable.bggId]);
      expect(selected.selection).toEqual({
        kind: "selected",
        bggIds: [unavailable.bggId, eligible.bggId, overlap.bggId],
      });
      expect(selected.disclosure).toMatchObject({
        wishlistEntryCount: 5,
        selectedCandidateCount: 3,
        unselectedEntryCount: 2,
        ownedOverlapCandidateCount: 1,
        requestedCandidateCount: 2,
        eligibleCandidateCount: 1,
        unavailableCandidateCount: 1,
        eligibleOwnedGameCount: 1,
        comparisonPairCount: 1,
        cachedHitPairCount: 0,
        sendablePairCount: 1,
      });
      expect(selected.unavailableCandidateBggIds).toEqual([unavailable.bggId]);
      expect(selected.pairs).toHaveLength(1);
      expect(selected.pairs[0]?.state).toBe("sendable-miss");
      expect(JSON.stringify(selected.pairs)).not.toContain("ownerNote");
      expect(await selected.isCurrent()).toBe(true);

      const savedLegacy = (await storage.loadWishlist()).find(
        (entry) => entry.id === unavailable.id,
      );
      expect(savedLegacy).toMatchObject({
        id: unavailable.id,
        bggId: unavailable.bggId,
        predictedScore: unavailable.predictedScore,
        addedAt: unavailable.addedAt,
      });
      expect(savedLegacy?.bggSource).toBeUndefined();

      const owner = (await storage.loadCollection()).games[0];
      if (!owner) throw new Error("owner fixture is missing");
      const noteResult = await context.ownerGameNoteService.set(owner.id, {
        commandId: "52000000-0000-4000-8000-000000000005",
        expectedVersion: 0,
        text: "a note edit unrelated to candidate C",
      });
      expect(noteResult.ok).toBe(true);
      const ownerAfterNote = (await storage.loadCollection()).games[0];
      if (ownerAfterNote?.ownerNote?.state !== "present")
        throw new Error("Persisted owner note is missing");
      expect(ownerAfterNote.ownerNote.text).toBe("a note edit unrelated to candidate C");

      const actualLookup = cache.lookup.bind(cache);
      cache.lookup = () => {
        throw new Error("injected point-read failure");
      };
      let cacheFailure: unknown;
      try {
        await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache, {
          kind: "selected",
          bggIds: [eligible.bggId],
        });
      } catch (error) {
        cacheFailure = error;
      } finally {
        cache.lookup = actualLookup;
      }
      expect(cacheFailure).toBeDefined();

      await preparation.prepare(selection);
      const candidateUnified = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
        selection,
      );
      const candidatePreparation = candidateUnified.wishlistPreparation;
      if (!candidatePreparation) throw new Error("Expected candidate unified preparation");
      expect(JSON.stringify(candidatePreparation.pairs)).not.toContain(
        "a note edit unrelated to candidate C",
      );

      let gatewayConstructions = 0;
      let providerStarts = 0;
      let gatewayRequest: unknown;
      const candidateRun = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => Promise.reject(new Error("Frozen wishlist run must not recapture")),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => {
          gatewayConstructions++;
          return {
            evaluatePair: async (request) => {
              gatewayRequest = request;
              await admit({
                mode: "description-only",
                attemptId: "wishlist-c-only",
                start: () => {
                  providerStarts++;
                  return { response: Promise.resolve(new Response()) };
                },
              });
              return {
                description: {
                  score: 0.42,
                  confidence: 0.8,
                  modelId: JEV_JUDGMENT_CONTRACT.modelId,
                  rubricVersion: 2,
                  questionVersion: 2,
                },
                ownerNote: null,
                usage: { inputTokens: 4, outputTokens: 2 },
              };
            },
          };
        },
      });
      const candidateReservation = await candidateRun.prepareValidatedPreparedRun({
        scopeKind: "wishlist",
        unifiedPreparation: candidateUnified,
        wishlistPreparation: candidatePreparation,
        noteTransmissionAuthorized: false,
      });
      expect(candidateReservation).not.toBeNull();
      if (!candidateReservation) throw new Error("Expected frozen wishlist run reservation");
      const candidateProgress =
        await candidateRun.reserveValidatedPreparedRun(candidateReservation).completion;
      expect(candidateProgress).toMatchObject({
        state: "completed",
        pairCount: 1,
        completedPairs: 1,
        cacheMisses: 1,
        failedPairs: 0,
      });
      expect(gatewayConstructions).toBe(1);
      expect(providerStarts).toBe(1);
      expect(gatewayRequest).toMatchObject({ mode: "description-only" });
      expect(JSON.stringify(gatewayRequest)).not.toContain("ownerNote");
      expect(JSON.stringify(gatewayRequest)).not.toContain("note edit unrelated");
      const ownedForCandidateRun = candidateUnified.capture.collection.games[0];
      if (!ownedForCandidateRun) throw new Error("owned test game is missing");
      const generatedRow = cache.lookup({
        gameAId: encodeWishlistBggMember(collection.id, String(eligible.bggId)),
        gameBId: encodeOwnedLocalMember(collection.id, ownedForCandidateRun.id),
        signal: "C",
        pairDomain: "wishlist-candidate",
      });
      expect(generatedRow).toMatchObject({
        pairDomain: "wishlist-candidate",
        dependencyKind: "C_ONLY",
        value: 0.42,
      });
      expect(
        generatedRow?.dependencies.every((dependency) => dependency.noteFingerprint === undefined),
      ).toBe(true);

      const eligibleSource = eligible.bggSource;
      if (!eligibleSource) throw new Error("eligible candidate needs its saved source");
      cache.upsert(
        makeCandidateCRow(
          collection.id,
          eligible.bggId,
          eligible.name,
          eligibleSource.description ?? "",
          owned,
          0.65,
        ),
      );
      await preparation.prepare(selection);
      const cachedUnified = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
        selection,
      );
      const cached = cachedUnified.wishlistPreparation;
      if (!cached) throw new Error("Expected cached unified preparation");
      expect(cached.disclosure.cachedHitPairCount).toBe(1);
      expect(cached.disclosure.sendablePairCount).toBe(0);
      expect(cached.pairs[0]?.state).toBe("cached-hit");

      let allHitGatewayConstructions = 0;
      const allHitRun = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => Promise.reject(new Error("All-hit run must not recapture")),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: () => {
          allHitGatewayConstructions++;
          throw new Error("All-hit run must not construct a provider gateway");
        },
      });
      const allHitReservation = await allHitRun.prepareValidatedPreparedRun({
        scopeKind: "wishlist",
        unifiedPreparation: cachedUnified,
        wishlistPreparation: cached,
        noteTransmissionAuthorized: false,
      });
      expect(allHitReservation).not.toBeNull();
      if (!allHitReservation) throw new Error("Expected all-hit reservation");
      expect(
        await allHitRun.reserveValidatedPreparedRun(allHitReservation).completion,
      ).toMatchObject({
        state: "completed",
        pairCount: 1,
        completedPairs: 1,
        cacheHits: 1,
        cacheMisses: 0,
        failedPairs: 0,
      });
      expect(allHitGatewayConstructions).toBe(0);

      const candidateMember = encodeWishlistBggMember(collection.id, String(eligible.bggId));
      const ownedMember = encodeOwnedLocalMember(collection.id, ownedForCandidateRun.id);
      cache.purgePair(candidateMember, ownedMember, "C", "wishlist-candidate");
      await preparation.prepare(selection);
      const lateUnified = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
        selection,
      );
      const latePreparation = lateUnified.wishlistPreparation;
      if (!latePreparation) throw new Error("Expected late unified preparation");
      let markStarted!: () => void;
      let releaseResult!: () => void;
      const providerStarted = new Promise<void>((resolve) => (markStarted = resolve));
      const providerRelease = new Promise<void>((resolve) => (releaseResult = resolve));
      const lateRun = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => Promise.reject(new Error("Late wishlist run must not recapture")),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "wishlist-late-removal",
              start: () => {
                markStarted();
                return { response: Promise.resolve(new Response()) };
              },
            });
            await providerRelease;
            return {
              description: {
                score: 0.61,
                confidence: null,
                modelId: JEV_JUDGMENT_CONTRACT.modelId,
                rubricVersion: 2,
                questionVersion: 2,
              },
              ownerNote: null,
              usage: { inputTokens: 2, outputTokens: 1 },
            };
          },
        }),
      });
      const lateReservation = await lateRun.prepareValidatedPreparedRun({
        scopeKind: "wishlist",
        unifiedPreparation: lateUnified,
        wishlistPreparation: latePreparation,
        noteTransmissionAuthorized: false,
      });
      if (!lateReservation) throw new Error("Expected late callback reservation");
      const lateCompletion = lateRun.reserveValidatedPreparedRun(lateReservation).completion;
      await providerStarted;
      const beforeRemoval = await storage.loadWishlist();
      await storage.saveWishlist(beforeRemoval.filter((entry) => entry.id !== eligible.id));
      releaseResult();
      expect(await lateCompletion).toMatchObject({ state: "failed", failedPairs: 1 });
      expect(
        cache.lookup({
          gameAId: candidateMember,
          gameBId: ownedMember,
          signal: "C",
          pairDomain: "wishlist-candidate",
        }),
      ).toBeNull();
      await storage.saveWishlist(beforeRemoval);

      const failingTriggerDb = new Database(join(directory, "jev-pair-cache.sqlite"));
      failingTriggerDb.exec(`CREATE TRIGGER reject_wishlist_judgment
        BEFORE INSERT ON judgments WHEN NEW.pair_domain = 'wishlist-candidate'
        BEGIN SELECT RAISE(ABORT, 'injected wishlist checkpoint failure'); END`);
      await preparation.prepare(selection);
      const checkpointUnified = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
        selection,
      );
      const checkpointPreparation = checkpointUnified.wishlistPreparation;
      if (!checkpointPreparation) throw new Error("Expected checkpoint unified preparation");
      const checkpointRun = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => Promise.reject(new Error("Frozen wishlist run must not recapture")),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "wishlist-checkpoint-failure",
              start: () => ({ response: Promise.resolve(new Response()) }),
            });
            return {
              description: {
                score: 0.31,
                confidence: 0.5,
                modelId: JEV_JUDGMENT_CONTRACT.modelId,
                rubricVersion: 2,
                questionVersion: 2,
              },
              ownerNote: null,
              usage: { inputTokens: 2, outputTokens: 1 },
            };
          },
        }),
      });
      const checkpointReservation = await checkpointRun.prepareValidatedPreparedRun({
        scopeKind: "wishlist",
        unifiedPreparation: checkpointUnified,
        wishlistPreparation: checkpointPreparation,
        noteTransmissionAuthorized: false,
      });
      if (!checkpointReservation) throw new Error("Expected checkpoint-failure reservation");
      expect(
        await checkpointRun.reserveValidatedPreparedRun(checkpointReservation).completion,
      ).toMatchObject({ state: "failed", completedPairs: 0, failedPairs: 0, cacheMisses: 1 });
      expect(
        cache.lookup({
          gameAId: candidateMember,
          gameBId: ownedMember,
          signal: "C",
          pairDomain: "wishlist-candidate",
        }),
      ).toBeNull();
      expect(cache.getRunProgress()).toMatchObject({
        state: "failed",
        completedPairs: 0,
        failedPairs: 0,
      });
      failingTriggerDb.exec("DROP TRIGGER reject_wishlist_judgment");
      failingTriggerDb.close();

      const persistedEntries = await storage.loadWishlist();
      await storage.saveWishlist(
        persistedEntries.map((entry) =>
          entry.id === eligible.id && entry.bggSource
            ? {
                ...entry,
                bggSource: { ...entry.bggSource, description: "changed source" },
              }
            : entry,
        ),
      );
      expect(await cached.isCurrent()).toBe(false);
      await storage.saveWishlist(persistedEntries);
      await preparation.prepare(selection);
      const membershipUnified = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
        selection,
      );
      const membershipPrepared = membershipUnified.wishlistPreparation;
      if (!membershipPrepared) throw new Error("Expected membership unified preparation");
      await storage.saveWishlist(persistedEntries.filter((entry) => entry.id !== unselectedB.id));
      expect(await membershipPrepared.isCurrent()).toBe(false);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("prepared authorization retains an immutable source snapshot after adapter alias mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-run-immutable-capture-"));
    const cache = await createJevPairCache(directory);
    const context = await createHydratedTestApp({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
      jevPairCache: cache,
    });
    try {
      const entry = makeCurrentReadEntry("Candidate immutable snapshot");
      entry.id = "immutable-capture-entry";
      entry.bggId = 991;
      const owned = makeGame(992, "Owned immutable snapshot");
      owned.id = "owned-immutable-snapshot";
      if (!owned.bggData) throw new Error("Owned fixture requires BGG data");
      owned.bggData.description = "Original owned description";
      const storage = context.storageService;
      const unifiedScoringService = createTestUnifiedScoringService(storage, cache);
      const currentCollection = await storage.loadCollection();
      currentCollection.games = [asDurableGame(owned)];
      currentCollection.semanticRedundancy.settings = {
        ...currentCollection.semanticRedundancy.settings,
        enabled: true,
        weights: { ...currentCollection.semanticRedundancy.settings.weights, description: 1 },
      };
      await storage.saveCollection(currentCollection);
      await storage.saveRedundancySettings({
        ...(await storage.loadRedundancySettings()),
        enabled: true,
        componentWeights: { binary: 1, continuous: 3 },
      });
      await storage.saveWishlist([entry]);
      await storage.hydrateSourceVector?.();
      const listGamesWithPredictionsFromSnapshot =
        context.predictionService.listGamesWithPredictionsFromSnapshot?.bind(
          context.predictionService,
        );
      if (!listGamesWithPredictionsFromSnapshot)
        throw new Error("Test prediction service lacks snapshot prediction support");
      const sourceAdapter = createJevRunSourceAdapter({
        storageService: storage,
        predictionService: { listGamesWithPredictionsFromSnapshot },
      });
      const wishlistHydration = createWishlistRunPreparationService({
        storageService: storage,
        gameService: context.gameService,
        sourceAdapter,
        cache,
      });
      let pairLookups = 0;
      const lookup = cache.lookup.bind(cache);
      cache.lookup = (input) => {
        pairLookups++;
        return lookup(input);
      };
      const prepared = await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache, {
        kind: "selected",
        bggIds: [entry.bggId],
      });
      const ownedSnapshot = prepared.capture.collection.games[0];
      if (!ownedSnapshot?.bggData) throw new Error("Prepared capture omitted owned source");
      expect(ownedSnapshot.bggData.description).toBe("Original owned description");

      let gatewayConstructions = 0;
      const runService = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => sourceAdapter.loadCapture(),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: () => {
          gatewayConstructions++;
          return { evaluatePair: () => Promise.reject(new Error("Stale scope must not send")) };
        },
      });
      const controller = new JevRunController({
        storageService: storage,
        sourceAdapter,
        cache,
        runService,
        unifiedScoringService,
        wishlistPreparation: wishlistHydration,
      });
      const preview = await controller.previewWishlist({
        kind: "selected",
        bggIds: [entry.bggId],
      });
      expect(preview.status).toBe(200);
      if (preview.status !== 200) throw new Error("Expected wishlist preview");
      const lookupsAfterPreview = pairLookups;

      const mutableCapture = await sourceAdapter.loadCapture();
      const mutableOwned = mutableCapture.collection.games[0];
      if (!mutableOwned?.bggData) throw new Error("Mutable adapter capture omitted owned source");
      mutableOwned.bggData.description = "Mutated adapter alias description";
      mutableOwned.name = "Mutated adapter alias name";
      const durableCollection = await storage.loadCollection();
      const durableOwned = durableCollection.games[0];
      if (!durableOwned?.bggData) throw new Error("Durable collection omitted owned source");
      durableOwned.bggData.description = "Mutated adapter alias description";
      durableOwned.name = "Mutated adapter alias name";
      await storage.saveCollection(durableCollection);

      expect(prepared.capture.collection.games[0]?.bggData?.description).toBe(
        "Original owned description",
      );
      expect(await prepared.isSourceCurrent()).toBe(false);
      expect(
        await controller.start({
          requestId: preview.body.requestId,
          precondition: preview.body.precondition,
          noteTransmissionAuthorized: false,
        }),
      ).toEqual({ status: 412, body: { error: "precondition-failed" } });
      expect(gatewayConstructions).toBe(0);
      expect(pairLookups).toBe(lookupsAfterPreview);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("wishlist collection identity includes scoring axes and ordered scoring sources only", async () => {
    const axis = (id: string, weight: number) => ({
      id,
      name: id,
      description: null,
      weight,
      enabled: true as const,
      source: "personal" as const,
      createdAt: NOW,
      updatedAt: NOW,
      preferenceShape: "higher-is-better" as const,
      veto: null,
    });
    const gameA = makeGame(981, "Identity A");
    const gameB = makeGame(982, "Identity B");
    const collection = await createMockStorage([], {
      axes: [axis("axis-a", 50), axis("axis-b", 50)],
      games: [asDurableGame(gameA), asDurableGame(gameB)],
    }).loadCollection();
    const identity = wishlistCollectionSourceIdentity(collection);

    const noteOnly = structuredClone(collection);
    const noteGame = noteOnly.games[0];
    if (!noteGame) throw new Error("Expected note identity fixture game");
    noteGame.ownerNote = {
      state: "present",
      version: 1,
      updatedAt: NOW,
      text: "synthetic note excluded from C identity",
    };
    noteGame.updatedAt = "note-write-timestamp";
    expect(wishlistCollectionSourceIdentity(noteOnly)).toBe(identity);

    const axisChanged = structuredClone(collection);
    const changedAxis = axisChanged.axes[0];
    if (!changedAxis) throw new Error("Expected axis identity fixture");
    changedAxis.weight++;
    expect(wishlistCollectionSourceIdentity(axisChanged)).not.toBe(identity);

    const vetoChanged = structuredClone(collection);
    const vetoAxis = vetoChanged.axes[0];
    if (!vetoAxis) throw new Error("Expected veto identity fixture");
    vetoAxis.veto = { direction: "above", threshold: 7 };
    expect(wishlistCollectionSourceIdentity(vetoChanged)).not.toBe(identity);

    const gameChanged = structuredClone(collection);
    const scoringGame = gameChanged.games[0];
    if (!scoringGame?.bggData) throw new Error("Expected factual identity fixture");
    scoringGame.ratings = { axis: 8 };
    scoringGame.manualValues.playingTime = {
      value: 45,
      source: "manual",
      confirmedAt: NOW,
    };
    scoringGame.bggData.description = "changed factual source";
    expect(wishlistCollectionSourceIdentity(gameChanged)).not.toBe(identity);

    const gamesReordered = structuredClone(collection);
    gamesReordered.games.reverse();
    expect(wishlistCollectionSourceIdentity(gamesReordered)).not.toBe(identity);
    const axesReordered = structuredClone(collection);
    axesReordered.axes.reverse();
    expect(wishlistCollectionSourceIdentity(axesReordered)).not.toBe(identity);
  });

  test("production veto and policy changes fence wishlist preview and active sends", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-run-axis-source-fence-"));
    const cache = await createJevPairCache(directory);
    const context = await createHydratedTestApp({ jevPairCache: cache });
    try {
      const unifiedScoringService = createTestUnifiedScoringService(context.storageService, cache);
      const axis = await context.axisService.createAxis({
        name: "Synthetic veto axis",
        weight: 100,
        source: "personal",
        veto: { direction: "below", threshold: 5 },
      });
      const added = await context.gameService.addGame({ name: "Synthetic axis-fence owner" });
      const ownedId = added.game.id;
      const template = makeGame(983, "Synthetic axis-fence owner");
      if (!template.bggData) throw new Error("Synthetic game template has no BGG facts");
      const collection = await context.storageService.loadCollection();
      const owned = collection.games.find((game) => game.id === ownedId);
      if (!owned) throw new Error("Expected production-added owned game");
      owned.bggData = {
        ...template.bggData,
        description: "Synthetic owned description for candidate comparison",
      };
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        weights: {
          ...collection.semanticRedundancy.settings.weights,
          description: 1,
        },
      };
      await context.storageService.saveCollection(collection);
      await context.storageService.saveRedundancySettings({
        ...(await context.storageService.loadRedundancySettings()),
        enabled: true,
      });
      await context.gameService.rateGame(ownedId, { [axis.id]: 2 });

      const candidate = makeCurrentReadEntry("Synthetic wishlist candidate description");
      candidate.id = "synthetic-axis-candidate";
      candidate.bggId = 984;
      candidate.name = "Synthetic axis-fence candidate";
      await context.storageService.saveWishlist([candidate]);

      const listPredictionsFromSnapshot =
        context.predictionService.listGamesWithPredictionsFromSnapshot?.bind(
          context.predictionService,
        );
      if (!listPredictionsFromSnapshot)
        throw new Error("Snapshot prediction service is unavailable");
      let predictionCalls = 0;
      const sourceAdapter = createJevRunSourceAdapter({
        storageService: context.storageService,
        predictionService: {
          listGamesWithPredictionsFromSnapshot: (...args) => {
            predictionCalls++;
            return listPredictionsFromSnapshot(...args);
          },
        },
      });
      const wishlistHydration = createWishlistRunPreparationService({
        storageService: context.storageService,
        gameService: context.gameService,
        sourceAdapter,
        cache,
      });
      let pairLookups = 0;
      const actualLookup = cache.lookup.bind(cache);
      cache.lookup = (input) => {
        pairLookups++;
        return actualLookup(input);
      };
      const prepared = await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache, {
        kind: "selected",
        bggIds: [candidate.bggId],
      });
      expect(prepared.wishlistPreparation?.disclosure.eligibleOwnedGameCount).toBe(0);
      expect(prepared.wishlistPreparation?.disclosure.comparisonPairCount).toBe(1);
      expect(prepared.run.predictionPairs).toHaveLength(1);
      expect(prepared.run.redundancyPairs).toHaveLength(0);

      let gatewayConstructions = 0;
      const runService = new JevRunService({
        storageService: context.storageService,
        cache,
        loadCapture: () => sourceAdapter.loadCapture(),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: () => {
          gatewayConstructions++;
          return {
            evaluatePair: () => Promise.reject(new Error("Stale axis scope must not send")),
          };
        },
      });
      const controller = new JevRunController({
        storageService: context.storageService,
        sourceAdapter,
        cache,
        runService,
        gatewayConfigured: () => true,
        unifiedScoringService,
        wishlistPreparation: wishlistHydration,
      });
      const preview = await controller.previewWishlist({
        kind: "selected",
        bggIds: [candidate.bggId],
      });
      expect(preview.status).toBe(200);
      if (preview.status !== 200) throw new Error("Expected wishlist preview");
      const predictionsAfterPreview = predictionCalls;
      const lookupsAfterPreview = pairLookups;

      await context.axisService.updateAxis(axis.id, { veto: null });
      expect(await prepared.isSourceCurrent()).toBe(false);
      expect(
        await controller.start({
          requestId: preview.body.requestId,
          precondition: preview.body.precondition,
          noteTransmissionAuthorized: false,
        }),
      ).toEqual({ status: 412, body: { error: "precondition-failed" } });
      expect(gatewayConstructions).toBe(0);
      expect(predictionCalls).toBe(predictionsAfterPreview);
      expect(pairLookups).toBe(lookupsAfterPreview);

      const fresh = await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache, {
        kind: "selected",
        bggIds: [candidate.bggId],
      });
      expect(fresh.wishlistPreparation?.disclosure.eligibleOwnedGameCount).toBe(1);
      const cacheRevisionBeforeActiveMutation = cache.mutationRevision();
      expect(cacheRevisionBeforeActiveMutation).not.toBeNull();
      const checkpointPair = cache.checkpointPair.bind(cache);
      let stalePairCheckpoints = 0;
      cache.checkpointPair = (checkpoint) => {
        stalePairCheckpoints++;
        checkpointPair(checkpoint);
      };
      let markProviderStarted!: () => void;
      let releaseProvider!: () => void;
      const providerStarted = new Promise<void>((resolve) => (markProviderStarted = resolve));
      const providerGate = new Promise<void>((resolve) => (releaseProvider = resolve));
      let activeGatewayConstructions = 0;
      const activeRunService = new JevRunService({
        storageService: context.storageService,
        cache,
        loadCapture: () => sourceAdapter.loadCapture(),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => {
          activeGatewayConstructions++;
          return {
            evaluatePair: async () => {
              await admit({
                mode: "description-only",
                attemptId: "wishlist-policy-change-during-provider",
                start: () => {
                  markProviderStarted();
                  return { response: Promise.resolve(new Response()) };
                },
              });
              await providerGate;
              return {
                description: {
                  score: 0.5,
                  confidence: null,
                  modelId: JEV_JUDGMENT_CONTRACT.modelId,
                  rubricVersion: 2,
                  questionVersion: 2,
                },
                ownerNote: null,
                usage: { inputTokens: 2, outputTokens: 1 },
              };
            },
          };
        },
      });
      const activeController = new JevRunController({
        storageService: context.storageService,
        sourceAdapter,
        cache,
        runService: activeRunService,
        gatewayConfigured: () => true,
        unifiedScoringService,
        wishlistPreparation: wishlistHydration,
      });
      const activePreview = await activeController.previewWishlist({
        kind: "selected",
        bggIds: [candidate.bggId],
      });
      if (activePreview.status !== 200)
        throw new Error("Expected eligible wishlist preview before axis mutation");
      const activeStarted = await activeController.start({
        requestId: activePreview.body.requestId,
        precondition: activePreview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      if (activeStarted.status !== 200) throw new Error("Expected eligible wishlist run start");
      await providerStarted;
      const activeInternals = activeController as unknown as {
        activeHandle: { completion: Promise<unknown> } | null;
      };
      const activeCompletion = activeInternals.activeHandle?.completion;
      if (!activeCompletion) throw new Error("Expected active axis-race completion");
      const priorRedundancySettings = await context.storageService.loadRedundancySettings();
      await context.storageService.saveRedundancySettings({
        ...priorRedundancySettings,
        similarityThreshold: priorRedundancySettings.similarityThreshold + 0.01,
      });
      expect(cache.mutationRevision()).toBe(cacheRevisionBeforeActiveMutation);
      expect(await fresh.isSourceCurrent()).toBe(false);
      releaseProvider();
      await activeCompletion;
      expect(activeController.activeRun()).toBeNull();
      expect(cache.getRunProgress()).toMatchObject({
        state: "failed",
        completedPairs: 1,
        failedPairs: 1,
      });
      expect(stalePairCheckpoints).toBe(0);
      cache.checkpointPair = checkpointPair;
      expect(activeGatewayConstructions).toBe(1);
      expect(
        cache.lookup({
          gameAId: encodeWishlistBggMember(collection.id, String(candidate.bggId)),
          gameBId: encodeOwnedLocalMember(collection.id, ownedId),
          signal: "C",
          pairDomain: "wishlist-candidate",
        }),
      ).toBeNull();
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("wishlist preparation rejects stale or malformed selection before BGG calls", async () => {
    const entry = makeCurrentReadEntry("Candidate prose");
    const storage = createMockStorage([entry], { games: [] }, true);
    const captureCollection = await storage.loadCollection();
    const capture: JevRunCapture = {
      collection: captureCollection,
      predictionCapture: [],
      captureIdentity: {
        sourceVectorIdentity: "selection-vector",
        tournamentIdentity: "selection-tournament",
        predictionCaptureIdentity: "selection-predictions",
      },
      factualWeights: { binary: 0.4, continuous: 0.3 },
      sourceVectorIdentity: "selection-vector",
      policyIdentity: "selection-policy",
    };
    let calls = 0;
    const preparation = createWishlistRunPreparationService({
      storageService: storage,
      gameService: {
        getBoardgameScoringInput: () => {
          calls++;
          return Promise.resolve(makeScoringInput(entry.bggId, entry.name));
        },
      },
      sourceAdapter: {
        loadCapture: () => Promise.resolve(capture),
        readCurrent: () =>
          Promise.resolve({
            collection: captureCollection,
            sourceVectorIdentity: "selection-vector",
            policyIdentity: "selection-policy",
            canTransmitNotes: false,
          }),
      },
      cache: {
        available: false,
        mutationRevision: () => null,
      } as unknown as JevPairCache,
    });

    for (const invalid of [
      { kind: "selected", bggIds: [] },
      { kind: "selected", bggIds: [entry.bggId, entry.bggId] },
      { kind: "selected", bggIds: [999_999] },
      { kind: "all", unexpected: true },
    ]) {
      let error: unknown;
      try {
        await preparation.prepare(invalid as never);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "invalid-selection" });
    }
    expect(calls).toBe(0);
  });

  test("legacy source hydration persists only BGG source and preserves prediction snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-run-source-only-"));
    const cache = await createJevPairCache(directory);
    try {
      const entry = makeCurrentReadEntry("Before hydration");
      entry.id = "source-only-entry";
      entry.bggId = 611;
      entry.name = "Hydrated exact name";
      entry.predictedScore = 8.125;
      const savedPreview = structuredClone(entry.redundancyPreview);
      delete entry.bggSource;
      const storage = createMockStorage([entry], { games: [] }, true);
      const collection = await storage.loadCollection();
      const capture: JevRunCapture = {
        collection,
        predictionCapture: [],
        captureIdentity: {
          sourceVectorIdentity: "source-only-vector",
          tournamentIdentity: "source-only-tournament",
          predictionCaptureIdentity: "source-only-predictions",
        },
        factualWeights: { binary: 0.4, continuous: 0.3 },
        sourceVectorIdentity: "source-only-vector",
        policyIdentity: "source-only-policy",
      };
      let bggCalls = 0;
      const preparation = createWishlistRunPreparationService({
        storageService: storage,
        gameService: {
          getBoardgameScoringInput: (bggId) => {
            bggCalls++;
            return Promise.resolve(makeScoringInput(bggId, entry.name));
          },
        },
        sourceAdapter: {
          loadCapture: () => Promise.resolve(capture),
          readCurrent: () =>
            Promise.resolve({
              collection,
              sourceVectorIdentity: "source-only-vector",
              policyIdentity: "source-only-policy",
              canTransmitNotes: false,
            }),
        },
        cache,
      });

      const prepared = await preparation.prepare();
      const persisted = (await storage.loadWishlist())[0];
      expect(bggCalls).toBe(1);
      expect(prepared.selection).toEqual({ kind: "all" });
      expect(prepared.disclosure.unavailableCandidateCount).toBe(0);
      expect(persisted).toMatchObject({
        id: entry.id,
        bggId: entry.bggId,
        name: entry.name,
        predictedScore: entry.predictedScore,
        addedAt: entry.addedAt,
        redundancyPreview: savedPreview,
        bggSource: {
          observedAt: NOW,
          description: "  Exact BGG description  ",
        },
      });
      expect(persisted?.bggSource?.mechanics).toEqual(["Deck Building"]);
      expect(await prepared.isCurrent()).toBe(true);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("production wishlist writes monotonically revoke frozen authority across exact restoration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-generation-aba-"));
    const cache = await createJevPairCache(directory);
    const context = await createHydratedTestApp({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
      jevPairCache: cache,
    });
    try {
      const entry = makeCurrentReadEntry("Stable candidate source");
      entry.id = "aba-stable-entry";
      entry.bggId = 733;
      const owned = makeGame(799, "Persistent owned comparator");
      owned.id = "persistent-owned-comparator";
      if (!owned.bggData) throw new Error("owned test fixture requires BGG data");
      owned.bggData.description = "Stable owned description";
      const ownedSecond = makeGame(798, "Second persistent comparator");
      ownedSecond.id = "second-persistent-comparator";
      if (!ownedSecond.bggData) throw new Error("second owned fixture requires BGG data");
      ownedSecond.bggData.description = "Second stable owned description";
      owned.ratings = { personal: 6 };
      ownedSecond.ratings = { personal: 6 };
      const storage = context.storageService;
      const unifiedScoringService = createTestUnifiedScoringService(storage, cache);
      const collection = await storage.loadCollection();
      collection.axes = [
        {
          id: "personal",
          name: "Personal",
          description: null,
          weight: 1,
          enabled: true,
          source: "personal",
          createdAt: NOW,
          updatedAt: NOW,
          preferenceShape: "higher-is-better",
          veto: null,
        },
      ];
      collection.games = [asDurableGame(owned), asDurableGame(ownedSecond)];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: { ...collection.semanticRedundancy.settings.weights, factual: 1, description: 1 },
      };
      await storage.saveCollection(collection);
      await storage.saveRedundancySettings({
        ...(await storage.loadRedundancySettings()),
        enabled: true,
        componentWeights: { binary: 1, continuous: 3 },
      });
      await storage.saveWishlist([entry]);
      await storage.hydrateSourceVector?.();
      const listGamesWithPredictionsFromSnapshot =
        context.predictionService.listGamesWithPredictionsFromSnapshot?.bind(
          context.predictionService,
        );
      if (!listGamesWithPredictionsFromSnapshot)
        throw new Error("Test prediction service lacks snapshot prediction support");
      const sourceAdapter = createJevRunSourceAdapter({
        storageService: storage,
        predictionService: { listGamesWithPredictionsFromSnapshot },
      });
      const wishlistHydration = createWishlistRunPreparationService({
        storageService: storage,
        gameService: context.gameService,
        sourceAdapter,
        cache,
      });
      let refreshedScore = 7;
      const predictionRows = [
        { game: owned, score: makeValidCaptureFitnessResult(6) },
        { game: ownedSecond, score: makeValidCaptureFitnessResult(6) },
      ];
      const refreshPredictions = createMockPredictionService(new Map(), predictionRows);
      refreshPredictions.listGamesWithPredictionsFromSnapshot = (currentCollection) =>
        Promise.resolve(
          currentCollection.games.map((game) => ({
            game,
            score: makeValidCaptureFitnessResult(6),
          })),
        );
      refreshPredictions.predictBggGame = (bggId) => {
        const name = bggId === entry.bggId ? entry.name : `Transient candidate ${bggId}`;
        return Promise.resolve({
          game: makeGame(bggId, name),
          score: makeFitnessResult(refreshedScore, false),
          verifiedScoringInput: makeScoringInput(bggId, name),
          predictionUnavailable: null,
        });
      };
      let acquisitionEligibleOwnedCount = 0;
      const wishlistService = createWishlistService({
        storageService: storage,
        predictionService: refreshPredictions,
        unifiedScoringService: unifiedScoringService,
        gameService: {
          ...createMockGameService(),
          addGame: async () => {
            const acquired = makeGame(entry.bggId, entry.name);
            acquired.id = "acquired-during-wishlist-run";
            if (!acquired.bggData) throw new Error("acquired fixture requires BGG data");
            acquired.bggData.description = entry.bggSource?.description ?? "";
            const currentCollection = await storage.loadCollection();
            await storage.saveCollection({
              ...currentCollection,
              games: [...currentCollection.games, asDurableGame(acquired)],
            });
            predictionRows.push({ game: acquired, score: makeValidCaptureFitnessResult(6) });
            return { game: acquired, bggImported: false };
          },
        },
        jevPairCache: cache,
        acquisitionObserver: {
          onEligibleOwnedSetBuilt: (count) => (acquisitionEligibleOwnedCount = count),
        },
      });
      await wishlistService.refresh(entry.id);
      const refreshedA = await storage.loadWishlist();
      const refreshPrepared = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
      );
      let startGatewayConstructions = 0;
      const startRunService = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => sourceAdapter.loadCapture(),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: () => {
          startGatewayConstructions++;
          return { evaluatePair: () => Promise.reject(new Error("Stale preview must not send")) };
        },
      });
      const runController = new JevRunController({
        storageService: storage,
        sourceAdapter,
        cache,
        runService: startRunService,
        gatewayConfigured: () => true,
        unifiedScoringService: unifiedScoringService,
        wishlistPreparation: wishlistHydration,
      });
      expect((await storage.loadCollection()).semanticRedundancy.settings.enabled).toBe(true);
      expect((await storage.loadRedundancySettings()).enabled).toBe(true);
      const stalePreview = await runController.previewWishlist();
      expect(stalePreview.status).toBe(200);
      if (stalePreview.status !== 200) throw new Error("Expected production wishlist preview");
      refreshedScore = 8;
      await wishlistService.refresh(entry.id);
      refreshedScore = 7;
      await wishlistService.refresh(entry.id);
      expect(await storage.loadWishlist()).toEqual(refreshedA);
      expect(await refreshPrepared.isSourceCurrent()).toBe(false);
      expect(
        await runController.start({
          requestId: stalePreview.body.requestId,
          precondition: stalePreview.body.precondition,
          noteTransmissionAuthorized: false,
        }),
      ).toEqual({ status: 412, body: { error: "precondition-failed" } });
      expect(startGatewayConstructions).toBe(0);

      const unchanged = await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache);
      const unchangedWishlist = await storage.loadWishlist();
      await storage.saveWishlist(unchangedWishlist);
      expect(unchanged.wishlistPreparation?.wishlistMutationGeneration).toBe(
        (await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache))
          .wishlistPreparation?.wishlistMutationGeneration,
      );
      expect(await unchanged.isSourceCurrent()).toBe(true);

      let concurrentPairs = 0;
      let maxConcurrentPairs = 0;
      let serialProviderStarts = 0;
      const serialRunService = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => Promise.reject(new Error("Wishlist run must use its frozen capture")),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async () => {
            concurrentPairs++;
            maxConcurrentPairs = Math.max(maxConcurrentPairs, concurrentPairs);
            try {
              await admit({
                mode: "description-only",
                attemptId: `wishlist-serial-${serialProviderStarts}`,
                start: () => {
                  serialProviderStarts++;
                  return { response: Promise.resolve(new Response()) };
                },
              });
              return {
                description: {
                  score: 0.4,
                  confidence: null,
                  modelId: JEV_JUDGMENT_CONTRACT.modelId,
                  rubricVersion: 2,
                  questionVersion: 2,
                },
                ownerNote: null,
                usage: { inputTokens: 2, outputTokens: 1 },
              };
            } finally {
              concurrentPairs--;
            }
          },
        }),
      });
      const serialReservation = await serialRunService.prepareValidatedPreparedRun({
        scopeKind: "wishlist",
        wishlistPreparation: unchanged.wishlistPreparation!,
        unifiedPreparation: unchanged,
        noteTransmissionAuthorized: false,
      });
      if (!serialReservation) throw new Error("Expected serial wishlist reservation");
      const cacheLookup = cache.lookup.bind(cache);
      const cacheCheckpointPair = cache.checkpointPair.bind(cache);
      const candidateEnumeration = cache.candidateCOnlyPairs.bind(cache);
      let runLookups = 0;
      let pairCheckpoints = 0;
      let candidateEnumerations = 0;
      const checkpointRevisions: Array<{ before: number | null; after: number | null }> = [];
      cache.lookup = (key) => {
        runLookups++;
        return cacheLookup(key);
      };
      cache.checkpointPair = (checkpoint) => {
        pairCheckpoints++;
        const before = cache.mutationRevision();
        cacheCheckpointPair(checkpoint);
        checkpointRevisions.push({ before, after: cache.mutationRevision() });
      };
      cache.candidateCOnlyPairs = (candidateMemberId) => {
        candidateEnumerations++;
        return candidateEnumeration(candidateMemberId);
      };
      expect(
        await serialRunService.reserveValidatedPreparedRun(serialReservation).completion,
      ).toMatchObject({
        state: "completed",
        pairCount: 2,
        completedPairs: 2,
        cacheMisses: 2,
        failedPairs: 0,
      });
      expect(serialProviderStarts).toBe(2);
      expect(maxConcurrentPairs).toBe(1);
      // One pre-admission readiness scan is performed per frozen candidate; after separating
      // that scan, the runner still performs exactly three race-critical reads per pair:
      // admission currentness, provider-dispatch recheck, and checkpoint recheck.
      const frozenPairCount = unchanged.wishlistPreparation?.pairs.length;
      if (frozenPairCount === undefined) throw new Error("Expected frozen wishlist pairs");
      expect(runLookups - frozenPairCount).toBe(3 * frozenPairCount);
      expect(pairCheckpoints).toBe(2);
      expect(checkpointRevisions).toHaveLength(2);
      expect(
        checkpointRevisions.every(({ before, after }) => before !== null && after! > before),
      ).toBe(true);
      expect(candidateEnumerations).toBe(0);
      cache.lookup = cacheLookup;
      cache.checkpointPair = cacheCheckpointPair;
      cache.candidateCOnlyPairs = candidateEnumeration;
      expect(await unchanged.isSourceCurrent()).toBe(true);
      expect(
        (await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache))
          .wishlistPreparation?.wishlistMutationGeneration,
      ).toBe(unchanged.wishlistPreparation?.wishlistMutationGeneration);
      const beforeAmbiguousWrite = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
      );
      const fileOps = context.fileOps;
      const writeFileExclusive = fileOps.writeFileExclusive.bind(fileOps);
      fileOps.writeFileExclusive = (path, content) =>
        path.includes("wishlist.json")
          ? Promise.reject(new Error("injected ambiguous wishlist write"))
          : writeFileExclusive(path, content);
      let ambiguousWriteError: unknown;
      try {
        await storage.saveWishlist(await storage.loadWishlist());
      } catch (error) {
        ambiguousWriteError = error;
      }
      fileOps.writeFileExclusive = writeFileExclusive;
      expect(ambiguousWriteError).toBeInstanceOf(Error);
      expect(await beforeAmbiguousWrite.isSourceCurrent()).toBe(false);
      for (const localId of [owned.id, ownedSecond.id]) {
        cache.purgePair(
          encodeWishlistBggMember(collection.id, String(entry.bggId)),
          encodeOwnedLocalMember(collection.id, localId),
          "C",
          "wishlist-candidate",
        );
      }
      const lateProviderPreparation = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
      );

      let markProviderStarted!: () => void;
      let releaseProvider!: () => void;
      const providerStarted = new Promise<void>((resolve) => (markProviderStarted = resolve));
      const providerGate = new Promise<void>((resolve) => (releaseProvider = resolve));
      const lateCallbackRun = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => Promise.reject(new Error("Wishlist run must use its frozen capture")),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async (request) => {
            expect(request.mode).toBe("description-only");
            await admit({
              mode: "description-only",
              attemptId: "wishlist-refresh-aba",
              start: () => {
                markProviderStarted();
                return { response: Promise.resolve(new Response()) };
              },
            });
            await providerGate;
            return {
              description: {
                score: 0.73,
                confidence: null,
                modelId: JEV_JUDGMENT_CONTRACT.modelId,
                rubricVersion: 2,
                questionVersion: 2,
              },
              ownerNote: null,
              usage: { inputTokens: 2, outputTokens: 1 },
            };
          },
        }),
      });
      const lateReservation = await lateCallbackRun.prepareValidatedPreparedRun({
        scopeKind: "wishlist",
        wishlistPreparation: lateProviderPreparation.wishlistPreparation!,
        unifiedPreparation: lateProviderPreparation,
        noteTransmissionAuthorized: false,
      });
      if (!lateReservation) throw new Error("Expected production-backed wishlist reservation");
      const lateCompletion =
        lateCallbackRun.reserveValidatedPreparedRun(lateReservation).completion;
      await providerStarted;
      refreshedScore = 8;
      await wishlistService.refresh(entry.id);
      refreshedScore = 7;
      await wishlistService.refresh(entry.id);
      expect(await storage.loadWishlist()).toEqual(unchangedWishlist);
      releaseProvider();
      expect(await lateCompletion).toMatchObject({ state: "failed", failedPairs: 1 });
      expect(await lateProviderPreparation.isSourceCurrent()).toBe(false);
      for (const localId of [owned.id, ownedSecond.id])
        expect(
          cache.lookup({
            gameAId: encodeWishlistBggMember(collection.id, String(entry.bggId)),
            gameBId: encodeOwnedLocalMember(collection.id, localId),
            signal: "C",
            pairDomain: "wishlist-candidate",
          }),
        ).toBeNull();

      for (const mutation of ["remove", "clear"] as const) {
        const beforeRemoval = await storage.loadWishlist();
        const oldPreparation = await prepareUnifiedWishlist(
          unifiedScoringService,
          sourceAdapter,
          cache,
        );
        let markMutationProviderStarted!: () => void;
        let releaseMutationProvider!: () => void;
        const mutationProviderStarted = new Promise<void>(
          (resolve) => (markMutationProviderStarted = resolve),
        );
        const mutationProviderGate = new Promise<void>(
          (resolve) => (releaseMutationProvider = resolve),
        );
        const mutationRunService = new JevRunService({
          storageService: storage,
          cache,
          loadCapture: () => Promise.reject(new Error("Frozen wishlist capture is required")),
          readCurrent: () => sourceAdapter.readCurrent(),
          createGateway: (admit) => ({
            evaluatePair: async () => {
              await admit({
                mode: "description-only",
                attemptId: `wishlist-${mutation}-late-callback`,
                start: () => {
                  markMutationProviderStarted();
                  return { response: Promise.resolve(new Response()) };
                },
              });
              // This fake intentionally ignores the abort signal until released.
              await mutationProviderGate;
              return {
                description: {
                  score: 0.48,
                  confidence: null,
                  modelId: JEV_JUDGMENT_CONTRACT.modelId,
                  rubricVersion: 2,
                  questionVersion: 2,
                },
                ownerNote: null,
                usage: { inputTokens: 2, outputTokens: 1 },
              };
            },
          }),
        });
        const mutationController = new JevRunController({
          storageService: storage,
          sourceAdapter,
          cache,
          runService: mutationRunService,
          gatewayConfigured: () => true,
          unifiedScoringService: unifiedScoringService,
          wishlistPreparation: wishlistHydration,
        });
        const mutationPreview = await mutationController.previewWishlist();
        expect(mutationPreview.status).toBe(200);
        if (mutationPreview.status !== 200)
          throw new Error("Expected controller wishlist preview before source mutation");
        const mutationStarted = await mutationController.start({
          requestId: mutationPreview.body.requestId,
          precondition: mutationPreview.body.precondition,
          noteTransmissionAuthorized: false,
        });
        expect(mutationStarted.status).toBe(200);
        if (mutationStarted.status !== 200)
          throw new Error("Expected controller to start the blocked provider run");
        await mutationProviderStarted;
        const controllerInternals = mutationController as unknown as {
          activeHandle: { completion: Promise<unknown> } | null;
        };
        const mutationCompletion = controllerInternals.activeHandle?.completion;
        if (!mutationCompletion) throw new Error("Expected active controller completion");
        expect(mutationController.activeRun()).toEqual({
          runId: mutationStarted.body.runId,
          scope: "wishlist",
        });

        if (mutation === "remove") await wishlistService.remove(entry.id);
        else await wishlistService.clear();
        expect(await storage.loadWishlist()).toEqual([]);
        // Restore exactly the same persisted identity/content; this is restoration, not add/UUID ABA.
        await storage.saveWishlist(beforeRemoval);
        expect(await storage.loadWishlist()).toEqual(beforeRemoval);
        expect(await oldPreparation.isSourceCurrent()).toBe(false);

        releaseMutationProvider();
        await mutationCompletion;
        expect(mutationController.activeRun()).toBeNull();
        expect(cache.getRunProgress()).toMatchObject({ state: "failed", failedPairs: 1 });
        for (const localId of [owned.id, ownedSecond.id])
          expect(
            cache.lookup({
              gameAId: encodeWishlistBggMember(collection.id, String(entry.bggId)),
              gameBId: encodeOwnedLocalMember(collection.id, localId),
              signal: "C",
              pairDomain: "wishlist-candidate",
            }),
          ).toBeNull();
      }

      const cancelPreparation = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
      );
      let markCancelProviderStarted!: () => void;
      let releaseCancelProvider!: () => void;
      const cancelProviderStarted = new Promise<void>(
        (resolve) => (markCancelProviderStarted = resolve),
      );
      const cancelProviderGate = new Promise<void>((resolve) => (releaseCancelProvider = resolve));
      const cancelRunService = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => Promise.reject(new Error("Frozen wishlist capture is required")),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "wishlist-controller-cancel-late-callback",
              start: () => {
                markCancelProviderStarted();
                return { response: Promise.resolve(new Response()) };
              },
            });
            await cancelProviderGate;
            return {
              description: {
                score: 0.52,
                confidence: null,
                modelId: JEV_JUDGMENT_CONTRACT.modelId,
                rubricVersion: 2,
                questionVersion: 2,
              },
              ownerNote: null,
              usage: { inputTokens: 2, outputTokens: 1 },
            };
          },
        }),
      });
      const cancelController = new JevRunController({
        storageService: storage,
        sourceAdapter,
        cache,
        runService: cancelRunService,
        gatewayConfigured: () => true,
        unifiedScoringService: unifiedScoringService,
        wishlistPreparation: wishlistHydration,
      });
      const cancelPreview = await cancelController.previewWishlist();
      if (cancelPreview.status !== 200) throw new Error("Expected cancellation preview");
      const cancelStarted = await cancelController.start({
        requestId: cancelPreview.body.requestId,
        precondition: cancelPreview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      if (cancelStarted.status !== 200) throw new Error("Expected cancellation run start");
      await cancelProviderStarted;
      const cancelInternals = cancelController as unknown as {
        activeHandle: { completion: Promise<unknown> } | null;
      };
      const cancelCompletion = cancelInternals.activeHandle?.completion;
      if (!cancelCompletion) throw new Error("Expected active cancellation completion");
      expect(cancelController.activeRun()).toEqual({
        runId: cancelStarted.body.runId,
        scope: "wishlist",
      });
      expect(cancelController.cancel({ runId: cancelStarted.body.runId })).toEqual({
        status: 200,
        body: { state: "cancellation-requested" },
      });
      releaseCancelProvider();
      await cancelCompletion;
      expect(cancelController.activeRun()).toBeNull();
      expect(cache.getRunProgress()).toMatchObject({
        state: "interrupted",
        completedPairs: 0,
        failedPairs: 0,
      });
      expect(cancelPreparation.wishlistPreparation?.pairs.length).toBeGreaterThan(0);
      for (const localId of [owned.id, ownedSecond.id])
        expect(
          cache.lookup({
            gameAId: encodeWishlistBggMember(collection.id, String(entry.bggId)),
            gameBId: encodeOwnedLocalMember(collection.id, localId),
            signal: "C",
            pairDomain: "wishlist-candidate",
          }),
        ).toBeNull();

      const before = await storage.loadWishlist();
      const scopeBeforeOtherCandidate = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
      );
      const extra = await wishlistService.add(734);
      await wishlistService.remove(extra.id);
      expect(await storage.loadWishlist()).toEqual(before);
      expect(await scopeBeforeOtherCandidate.isSourceCurrent()).toBe(false);

      const beforeClear = await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache);
      await wishlistService.clear();
      await storage.saveWishlist(before);
      expect(await beforeClear.isSourceCurrent()).toBe(false);

      const beforeFailedRemove = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
      );
      cache.upsert(
        makeCandidateCRow(
          collection.id,
          entry.bggId,
          entry.name,
          entry.bggSource?.description ?? "",
          owned,
          0.55,
        ),
      );
      const durableSaveWishlist = storage.saveWishlist.bind(storage);
      storage.saveWishlist = () => Promise.reject(new Error("injected wishlist save failure"));
      let removeError: unknown;
      try {
        await wishlistService.remove(entry.id);
      } catch (error) {
        removeError = error;
      }
      storage.saveWishlist = durableSaveWishlist;
      expect(removeError).toBeInstanceOf(Error);
      expect(await storage.loadWishlist()).toEqual(before);
      expect(await beforeFailedRemove.isSourceCurrent()).toBe(false);
      expect(
        cache.lookup({
          gameAId: encodeWishlistBggMember(collection.id, String(entry.bggId)),
          gameBId: encodeOwnedLocalMember(collection.id, owned.id),
          signal: "C",
          pairDomain: "wishlist-candidate",
        }),
      ).toBeNull();

      cache.upsert(
        makeCandidateCRow(
          collection.id,
          entry.bggId,
          entry.name,
          entry.bggSource?.description ?? "",
          owned,
          0.66,
        ),
      );
      const acquisitionPreparation = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
      );
      let markAcquisitionProviderStarted!: () => void;
      let releaseAcquisitionProvider!: () => void;
      const acquisitionProviderStarted = new Promise<void>(
        (resolve) => (markAcquisitionProviderStarted = resolve),
      );
      const acquisitionProviderGate = new Promise<void>(
        (resolve) => (releaseAcquisitionProvider = resolve),
      );
      const acquisitionRaceRun = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => Promise.reject(new Error("Wishlist run must use frozen scope")),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "wishlist-acquisition-race",
              start: () => {
                markAcquisitionProviderStarted();
                return { response: Promise.resolve(new Response()) };
              },
            });
            await acquisitionProviderGate;
            return {
              description: {
                score: 0.79,
                confidence: null,
                modelId: JEV_JUDGMENT_CONTRACT.modelId,
                rubricVersion: 2,
                questionVersion: 2,
              },
              ownerNote: null,
              usage: { inputTokens: 2, outputTokens: 1 },
            };
          },
        }),
      });
      const acquisitionReservation = await acquisitionRaceRun.prepareValidatedPreparedRun({
        scopeKind: "wishlist",
        wishlistPreparation: acquisitionPreparation.wishlistPreparation!,
        unifiedPreparation: acquisitionPreparation,
        noteTransmissionAuthorized: false,
      });
      if (!acquisitionReservation) throw new Error("Expected acquisition-race reservation");
      const acquisitionCompletion =
        acquisitionRaceRun.reserveValidatedPreparedRun(acquisitionReservation).completion;
      await acquisitionProviderStarted;
      expect((await storage.loadWishlist())[0]?.bggSource?.description).toBe(
        "  Exact BGG description  ",
      );
      expect((await storage.loadCollection()).semanticRedundancy.settings.enabled).toBe(true);
      await wishlistService.acquireGame({ bggId: entry.bggId, name: entry.name });
      expect(await storage.loadWishlist()).toHaveLength(0);
      expect(acquisitionEligibleOwnedCount).toBe(3);
      const targetRow = {
        ...makeCandidateCRow(
          collection.id,
          entry.bggId,
          entry.name,
          entry.bggSource?.description ?? "",
          owned,
          0.66,
        ),
        pairDomain: "collection" as const,
        gameAId: "acquired-during-wishlist-run",
        gameBId: owned.id,
        dependencies: buildJevPairDependencies(
          "C_ONLY",
          {
            gameId: "acquired-during-wishlist-run",
            name: entry.name,
            description: entry.bggSource?.description ?? "",
          },
          { gameId: owned.id, name: owned.name, description: owned.bggData?.description ?? "" },
        ),
      };
      cache.upsert(targetRow);
      releaseAcquisitionProvider();
      expect(await acquisitionCompletion).toMatchObject({ state: "failed", failedPairs: 1 });
      for (const localId of [owned.id, ownedSecond.id, "acquired-during-wishlist-run"])
        expect(
          cache.lookup({
            gameAId: encodeWishlistBggMember(collection.id, String(entry.bggId)),
            gameBId: encodeOwnedLocalMember(collection.id, localId),
            signal: "C",
            pairDomain: "wishlist-candidate",
          }),
        ).toBeNull();
      expect(
        cache.lookup({
          gameAId: "acquired-during-wishlist-run",
          gameBId: owned.id,
          signal: "C",
        }),
      ).toMatchObject({ value: 0.66, completedAt: NOW });
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("wishlist run restart restores progress only, never active execution or preview authority", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-run-restart-authority-"));
    const fileOps = createFileOps();
    let cache = await createJevPairCache(directory);
    const context = await createHydratedTestApp({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps,
      jevPairCache: cache,
    });
    try {
      const entry = makeCurrentReadEntry("Restart candidate description");
      entry.id = "restart-candidate-entry";
      entry.bggId = 9401;
      const owned = makeGame(9402, "Restart owned comparator");
      owned.id = "restart-owned-local";
      if (!owned.bggData) throw new Error("Expected owned description fixture");
      owned.bggData.description = "Restart owned description";
      owned.ratings = { personal: 6 };
      const storage = context.storageService;
      const unifiedScoringService = createTestUnifiedScoringService(storage, cache);
      const collection = await storage.loadCollection();
      collection.axes = [
        {
          id: "personal",
          name: "Personal",
          description: null,
          weight: 1,
          enabled: true,
          source: "personal",
          createdAt: NOW,
          updatedAt: NOW,
          preferenceShape: "higher-is-better",
          veto: null,
        },
      ];
      collection.games = [asDurableGame(owned)];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: { ...collection.semanticRedundancy.settings.weights, factual: 1, description: 1 },
      };
      await storage.saveCollection(collection);
      await storage.saveRedundancySettings({
        ...(await storage.loadRedundancySettings()),
        enabled: true,
        componentWeights: { binary: 1, continuous: 3 },
      });
      await storage.saveWishlist([entry]);
      await storage.hydrateSourceVector?.();
      const listGamesWithPredictionsFromSnapshot =
        context.predictionService.listGamesWithPredictionsFromSnapshot?.bind(
          context.predictionService,
        );
      if (!listGamesWithPredictionsFromSnapshot)
        throw new Error("Test prediction service lacks snapshot prediction support");
      const sourceAdapter = createJevRunSourceAdapter({
        storageService: storage,
        predictionService: { listGamesWithPredictionsFromSnapshot },
      });
      const wishlistHydration = createWishlistRunPreparationService({
        storageService: storage,
        gameService: context.gameService,
        sourceAdapter,
        cache,
      });
      const prepared = await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache);
      expect(prepared.wishlistPreparation?.pairs).toHaveLength(1);

      let markProviderStarted!: () => void;
      let releaseProvider!: () => void;
      const providerStarted = new Promise<void>((resolve) => (markProviderStarted = resolve));
      const providerGate = new Promise<void>((resolve) => (releaseProvider = resolve));
      let gatewayConstructions = 0;
      const runService = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => sourceAdapter.loadCapture(),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => {
          gatewayConstructions++;
          return {
            evaluatePair: async () => {
              await admit({
                mode: "description-only",
                attemptId: "restart-pending-provider",
                start: () => {
                  markProviderStarted();
                  return { response: Promise.resolve(new Response()) };
                },
              });
              // Simulate an uncooperative provider; its result arrives only after release.
              await providerGate;
              return {
                description: {
                  score: 0.5,
                  confidence: null,
                  modelId: JEV_JUDGMENT_CONTRACT.modelId,
                  rubricVersion: 2,
                  questionVersion: 2,
                },
                ownerNote: null,
                usage: { inputTokens: 2, outputTokens: 1 },
              };
            },
          };
        },
      });
      const controller = new JevRunController({
        storageService: storage,
        sourceAdapter,
        cache,
        runService,
        gatewayConfigured: () => true,
        unifiedScoringService: unifiedScoringService,
        wishlistPreparation: wishlistHydration,
      });
      expect((await storage.loadCollection()).semanticRedundancy.settings.enabled).toBe(true);
      expect((await storage.loadRedundancySettings()).enabled).toBe(true);
      const preview = await controller.previewWishlist();
      if (preview.status !== 200) throw new Error("Expected restart test wishlist preview");
      const started = await controller.start({
        requestId: preview.body.requestId,
        precondition: preview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      if (started.status !== 200) throw new Error("Expected restart test run admission");
      await providerStarted;
      expect(cache.getRunProgress()).toMatchObject({ state: "running", pairCount: 1 });
      expect(controller.activeRun()).toEqual({ runId: started.body.runId, scope: "wishlist" });

      expect(controller.cancel({ runId: started.body.runId }).status).toBe(200);
      const active = controller as unknown as {
        activeHandle: { completion: Promise<unknown> } | null;
      };
      const completion = active.activeHandle?.completion;
      if (!completion) throw new Error("Expected live controller completion before restart");
      releaseProvider();
      await completion;
      expect(controller.activeRun()).toBeNull();
      expect(cache.getRunProgress()).toMatchObject({
        runId: started.body.runId,
        state: "interrupted",
        completedPairs: 0,
        failedPairs: 0,
      });
      expect(gatewayConstructions).toBe(1);
      expect(
        cache.lookup({
          gameAId: encodeWishlistBggMember(collection.id, String(entry.bggId)),
          gameBId: encodeOwnedLocalMember(collection.id, owned.id),
          signal: "C",
          pairDomain: "wishlist-candidate",
        }),
      ).toBeNull();

      cache.close();
      cache = await createJevPairCache(directory);
      const reopenedContext = await createHydratedTestApp({
        dataDir: directory,
        configPath: join(directory, "config.json"),
        fileOps: createFileOps(),
        jevPairCache: cache,
      });
      const reopenedStorage = reopenedContext.storageService;
      const reopenedUnifiedScoringService = createTestUnifiedScoringService(reopenedStorage, cache);
      const reopenedSnapshotPrediction =
        reopenedContext.predictionService.listGamesWithPredictionsFromSnapshot?.bind(
          reopenedContext.predictionService,
        );
      if (!reopenedSnapshotPrediction)
        throw new Error("Reopened prediction service lacks snapshot prediction support");
      const reopenedSourceAdapter = createJevRunSourceAdapter({
        storageService: reopenedStorage,
        predictionService: {
          listGamesWithPredictionsFromSnapshot: reopenedSnapshotPrediction,
        },
      });
      const reopenedWishlistHydration = createWishlistRunPreparationService({
        storageService: reopenedStorage,
        gameService: reopenedContext.gameService,
        sourceAdapter: reopenedSourceAdapter,
        cache,
      });
      let restartedGatewayConstructions = 0;
      const restartedService = new JevRunService({
        storageService: reopenedStorage,
        cache,
        loadCapture: () => reopenedSourceAdapter.loadCapture(),
        readCurrent: () => reopenedSourceAdapter.readCurrent(),
        createGateway: () => {
          restartedGatewayConstructions++;
          throw new Error("Restart/status reads must never dispatch a provider");
        },
      });
      const restartedController = new JevRunController({
        storageService: reopenedStorage,
        sourceAdapter: reopenedSourceAdapter,
        cache,
        runService: restartedService,
        gatewayConfigured: () => true,
        unifiedScoringService: reopenedUnifiedScoringService,
        wishlistPreparation: reopenedWishlistHydration,
      });
      expect(restartedController.activeRun()).toBeNull();
      expect(cache.getRunProgress()).toMatchObject({
        runId: started.body.runId,
        state: "interrupted",
        completedPairs: 0,
        failedPairs: 0,
      });
      expect(
        await restartedController.start({
          requestId: preview.body.requestId,
          precondition: preview.body.precondition,
          noteTransmissionAuthorized: false,
        }),
      ).toEqual({ status: 412, body: { error: "precondition-failed" } });
      expect(restartedController.activeRun()).toBeNull();
      expect(restartedGatewayConstructions).toBe(0);
      expect(
        cache.lookup({
          gameAId: encodeWishlistBggMember(collection.id, String(entry.bggId)),
          gameBId: encodeOwnedLocalMember(collection.id, owned.id),
          signal: "C",
          pairDomain: "wishlist-candidate",
        }),
      ).toBeNull();
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("production gateway preserves a valid cache-hit admission outcome without hiding source failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-gateway-admission-hit-"));
    const cache = await createJevPairCache(directory);
    const context = await createHydratedTestApp({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
      jevPairCache: cache,
    });
    try {
      const entry = makeCurrentReadEntry("Admission race candidate description");
      entry.id = "gateway-admission-candidate";
      entry.bggId = 9501;
      const owned = makeGame(9502, "Admission race owned comparator");
      owned.id = "gateway-admission-owned";
      if (!owned.bggData) throw new Error("Expected owned description fixture");
      owned.bggData.description = "Admission race owned description";
      owned.ratings = { personal: 6 };
      const storage = context.storageService;
      const unifiedScoringService = createTestUnifiedScoringService(storage, cache);
      const collection = await storage.loadCollection();
      collection.axes = [
        {
          id: "personal",
          name: "Personal",
          description: null,
          weight: 1,
          enabled: true,
          source: "personal",
          createdAt: NOW,
          updatedAt: NOW,
          preferenceShape: "higher-is-better",
          veto: null,
        },
      ];
      collection.games = [asDurableGame(owned)];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: { ...collection.semanticRedundancy.settings.weights, factual: 1, description: 1 },
      };
      await storage.saveCollection(collection);
      await storage.saveRedundancySettings({
        ...(await storage.loadRedundancySettings()),
        enabled: true,
        componentWeights: { binary: 1, continuous: 3 },
      });
      await storage.saveWishlist([entry]);
      await storage.hydrateSourceVector?.();
      const listGamesWithPredictionsFromSnapshot =
        context.predictionService.listGamesWithPredictionsFromSnapshot?.bind(
          context.predictionService,
        );
      if (!listGamesWithPredictionsFromSnapshot)
        throw new Error("Test prediction service lacks snapshot prediction support");
      const sourceAdapter = createJevRunSourceAdapter({
        storageService: storage,
        predictionService: { listGamesWithPredictionsFromSnapshot },
      });
      const prepared = await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache, {
        kind: "selected",
        bggIds: [entry.bggId],
      });
      const wishlistPreparation = prepared.wishlistPreparation;
      if (!wishlistPreparation) throw new Error("Expected unified wishlist preparation");
      expect(wishlistPreparation.pairs).toHaveLength(1);
      expect(wishlistPreparation.pairs[0]?.state).toBe("sendable-miss");
      let fetchCalls = 0;
      const transport = (): Promise<Response> => {
        fetchCalls++;
        const legend = {
          "0": "Level zero",
          "1": "Level one",
          "2": "Level two",
          "3": "Level three",
        };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: JEV_JUDGMENT_CONTRACT.modelId,
              answers: {
                description_similarity: {
                  type: "score",
                  score: 2,
                  legend,
                  probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
                  confidence: 0.7,
                },
              },
              usage: { input_tokens: 3, output_tokens: 2 },
            }),
          ),
        );
      };
      const existingCandidateRow = makeCandidateCRow(
        collection.id,
        entry.bggId,
        entry.name,
        entry.bggSource?.description ?? "",
        owned,
        0.27,
        "2025-09-08T12:34:56.000Z",
      );
      let lookupsBeforeGateway = 0;
      let revisionAfterInsertedHit: number | null = null;
      let rowAtInsert: JevPairJudgment | null = null;
      let firstLookups = 0;
      const actualLookup = cache.lookup.bind(cache);
      cache.lookup = (key) => {
        firstLookups++;
        return actualLookup(key);
      };
      const firstService = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => sourceAdapter.loadCapture(),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => {
          lookupsBeforeGateway = firstLookups;
          cache.upsert(existingCandidateRow);
          rowAtInsert = actualLookup({
            gameAId: existingCandidateRow.gameAId,
            gameBId: existingCandidateRow.gameBId,
            signal: "C",
            pairDomain: "wishlist-candidate",
          });
          revisionAfterInsertedHit = cache.mutationRevision();
          return createJevGateway({
            apiKey: "test-only-key",
            fetch: transport,
            admitAndDispatch: admit,
          });
        },
      });
      const actualUpsert = cache.upsert.bind(cache);
      let upserts = 0;
      cache.upsert = (row) => {
        upserts++;
        actualUpsert(row);
      };
      const actualCheckpoint = cache.checkpointPair.bind(cache);
      let pairCheckpoints = 0;
      cache.checkpointPair = (checkpoint) => {
        pairCheckpoints++;
        actualCheckpoint(checkpoint);
      };
      const firstReservation = await firstService.prepareValidatedPreparedRun({
        scopeKind: "wishlist",
        wishlistPreparation,
        unifiedPreparation: prepared,
        noteTransmissionAuthorized: false,
      });
      if (!firstReservation) throw new Error("Expected validated frozen wishlist run");
      const firstProgress =
        await firstService.reserveValidatedPreparedRun(firstReservation).completion;
      expect(firstProgress).toMatchObject({
        state: "completed",
        pairCount: 1,
        completedPairs: 1,
        cacheHits: 1,
        cacheMisses: 0,
        failedPairs: 0,
      });
      expect(lookupsBeforeGateway).toBeGreaterThan(0);
      expect(firstLookups).toBeGreaterThan(lookupsBeforeGateway);
      expect(upserts).toBe(1);
      expect(pairCheckpoints).toBe(0);
      expect(fetchCalls).toBe(0);
      expect(revisionAfterInsertedHit).not.toBeNull();
      expect(cache.mutationRevision()).toBe(revisionAfterInsertedHit);
      expect(rowAtInsert).toMatchObject({
        pairDomain: "wishlist-candidate",
        dependencyKind: "C_ONLY",
        value: 0.27,
        completedAt: "2025-09-08T12:34:56.000Z",
        modelId: JEV_JUDGMENT_CONTRACT.modelId,
        rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
        questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
      });
      expect(
        actualLookup({
          gameAId: existingCandidateRow.gameAId,
          gameBId: existingCandidateRow.gameBId,
          signal: "C",
          pairDomain: "wishlist-candidate",
        }),
      ).toEqual(rowAtInsert);
      expect(await prepared.isSourceCurrent()).toBe(true);

      cache.lookup = actualLookup;
      cache.upsert = actualUpsert;
      cache.checkpointPair = actualCheckpoint;
      cache.purgePair(
        existingCandidateRow.gameAId,
        existingCandidateRow.gameBId,
        "C",
        "wishlist-candidate",
      );

      const racePrepared = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
        { kind: "selected", bggIds: [entry.bggId] },
      );
      const raceWishlistPreparation = racePrepared.wishlistPreparation;
      if (!raceWishlistPreparation) throw new Error("Expected race unified wishlist preparation");
      expect(raceWishlistPreparation.pairs[0]?.state).toBe("sendable-miss");
      const raceReservationService = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => sourceAdapter.loadCapture(),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) =>
          createJevGateway({
            apiKey: "test-only-key",
            fetch: transport,
            admitAndDispatch: admit,
          }),
      });
      const raceReservation = await raceReservationService.prepareValidatedPreparedRun({
        scopeKind: "wishlist",
        wishlistPreparation: raceWishlistPreparation,
        unifiedPreparation: racePrepared,
        noteTransmissionAuthorized: false,
      });
      if (!raceReservation) throw new Error("Expected frozen race wishlist reservation");
      cache.upsert(existingCandidateRow);
      const sourceReadCurrent = sourceAdapter.readCurrent.bind(sourceAdapter);
      let observedInsertedHit = false;
      let evictedDuringSourceCurrentness = 0;
      const raceLookup = cache.lookup.bind(cache);
      cache.lookup = (key) => {
        const row = raceLookup(key);
        if (!observedInsertedHit && row?.pairDomain === "wishlist-candidate") {
          observedInsertedHit = true;
        }
        return row;
      };
      sourceAdapter.readCurrent = async () => {
        const current = await sourceReadCurrent();
        if (observedInsertedHit && evictedDuringSourceCurrentness === 0) {
          cache.purgePair(
            existingCandidateRow.gameAId,
            existingCandidateRow.gameBId,
            "C",
            "wishlist-candidate",
          );
          evictedDuringSourceCurrentness++;
        }
        return current;
      };
      const raceCheckpoint = cache.checkpointPair.bind(cache);
      let raceCheckpoints = 0;
      cache.checkpointPair = (checkpoint) => {
        raceCheckpoints++;
        raceCheckpoint(checkpoint);
      };
      const raceProgress =
        await raceReservationService.reserveValidatedPreparedRun(raceReservation).completion;
      sourceAdapter.readCurrent = sourceReadCurrent;
      cache.lookup = actualLookup;
      cache.checkpointPair = raceCheckpoint;
      expect(observedInsertedHit).toBe(true);
      expect(evictedDuringSourceCurrentness).toBe(1);
      expect(await racePrepared.isSourceCurrent()).toBe(true);
      expect(raceProgress).toMatchObject({
        state: "completed",
        pairCount: 1,
        completedPairs: 1,
        cacheHits: 0,
        cacheMisses: 1,
        failedPairs: 0,
      });
      expect(fetchCalls).toBe(1);
      expect(raceCheckpoints).toBe(1);
      expect(
        actualLookup({
          gameAId: existingCandidateRow.gameAId,
          gameBId: existingCandidateRow.gameBId,
          signal: "C",
          pairDomain: "wishlist-candidate",
        }),
      ).toMatchObject({ pairDomain: "wishlist-candidate", dependencyKind: "C_ONLY" });

      const frozenHitPrepared = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
        { kind: "selected", bggIds: [entry.bggId] },
      );
      const frozenHitPreparation = frozenHitPrepared.wishlistPreparation;
      if (!frozenHitPreparation) throw new Error("Expected frozen cache-hit preparation");
      expect(frozenHitPreparation.pairs[0]?.state).toBe("cached-hit");
      cache.purgePair(
        existingCandidateRow.gameAId,
        existingCandidateRow.gameBId,
        "C",
        "wishlist-candidate",
      );
      let evictedFrozenHitGatewayConstructions = 0;
      const evictedFrozenHitService = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => sourceAdapter.loadCapture(),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: () => {
          evictedFrozenHitGatewayConstructions++;
          throw new Error("A frozen cache hit is not authorized for transmission");
        },
      });
      const evictedFrozenHitReservation = await evictedFrozenHitService.prepareValidatedPreparedRun(
        {
          scopeKind: "wishlist",
          wishlistPreparation: frozenHitPreparation,
          unifiedPreparation: frozenHitPrepared,
          noteTransmissionAuthorized: false,
        },
      );
      if (!evictedFrozenHitReservation) throw new Error("Expected frozen cache-hit reservation");
      const evictedFrozenHitProgress = await evictedFrozenHitService.reserveValidatedPreparedRun(
        evictedFrozenHitReservation,
      ).completion;
      expect(evictedFrozenHitProgress).toMatchObject({
        state: "failed",
        pairCount: 1,
        completedPairs: 1,
        cacheHits: 0,
        cacheMisses: 0,
        failedPairs: 1,
      });
      expect(evictedFrozenHitGatewayConstructions).toBe(0);

      let secondFetchCalls = 0;
      const secondTransport = (): Promise<Response> => {
        secondFetchCalls++;
        return transport();
      };
      let policyMutationWrites = 0;
      let policyMutationReadbacks = 0;
      let expectedPolicyThreshold: number | null = null;
      let readBackPolicyThreshold: number | null = null;
      const secondService = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => sourceAdapter.loadCapture(),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: (admit) => {
          const gateway = createJevGateway({
            apiKey: "test-only-key",
            fetch: secondTransport,
            admitAndDispatch: admit,
          });
          return {
            evaluatePair: async (...args) => {
              const settings = await storage.loadRedundancySettings();
              const changedThreshold = settings.similarityThreshold + 0.01;
              expectedPolicyThreshold = changedThreshold;
              await storage.saveRedundancySettings({
                ...settings,
                similarityThreshold: changedThreshold,
              });
              policyMutationWrites++;
              const updatedSettings = await storage.loadRedundancySettings();
              readBackPolicyThreshold = updatedSettings.similarityThreshold;
              policyMutationReadbacks++;
              return gateway.evaluatePair(...args);
            },
          };
        },
      });
      const secondPrepared = await prepareUnifiedWishlist(
        unifiedScoringService,
        sourceAdapter,
        cache,
        { kind: "selected", bggIds: [entry.bggId] },
      );
      const secondWishlistPreparation = secondPrepared.wishlistPreparation;
      if (!secondWishlistPreparation)
        throw new Error("Expected second unified wishlist preparation");
      const secondReservation = await secondService.prepareValidatedPreparedRun({
        scopeKind: "wishlist",
        wishlistPreparation: secondWishlistPreparation,
        unifiedPreparation: secondPrepared,
        noteTransmissionAuthorized: false,
      });
      if (!secondReservation) throw new Error("Expected second validated frozen wishlist run");
      const revisionBeforeSourceChange = cache.mutationRevision();
      const secondProgress =
        await secondService.reserveValidatedPreparedRun(secondReservation).completion;
      expect(secondProgress).toMatchObject({
        state: "failed",
        pairCount: 1,
        completedPairs: 1,
        cacheHits: 0,
        cacheMisses: 1,
        failedPairs: 1,
      });
      expect(await secondPrepared.isSourceCurrent()).toBe(false);
      expect(policyMutationWrites).toBe(1);
      expect(policyMutationReadbacks).toBe(1);
      expect(readBackPolicyThreshold).toBe(expectedPolicyThreshold);
      expect(secondFetchCalls).toBe(0);
      expect(cache.mutationRevision()).toBe(revisionBeforeSourceChange);
      expect(
        cache.lookup({
          gameAId: existingCandidateRow.gameAId,
          gameBId: existingCandidateRow.gameBId,
          signal: "C",
          pairDomain: "wishlist-candidate",
        }),
      ).toBeNull();
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("late BGG hydration cannot recreate a removed wishlist entry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-run-hydration-race-"));
    const cache = await createJevPairCache(directory);
    try {
      const entry = makeCurrentReadEntry("Candidate prose");
      entry.bggId = 610;
      delete entry.bggSource;
      const storage = createMockStorage([entry], { games: [] }, true);
      const collection = await storage.loadCollection();
      const capture: JevRunCapture = {
        collection,
        predictionCapture: [],
        captureIdentity: {
          sourceVectorIdentity: "race-vector",
          tournamentIdentity: "race-tournament",
          predictionCaptureIdentity: "race-predictions",
        },
        factualWeights: { binary: 0.4, continuous: 0.3 },
        sourceVectorIdentity: "race-vector",
        policyIdentity: "race-policy",
      };
      let releaseFetch: (input: BoardgameScoringInput) => void = () => {};
      const pendingFetch = new Promise<BoardgameScoringInput>((resolve) => {
        releaseFetch = resolve;
      });
      let writes = 0;
      const racedStorage: StorageService = {
        ...storage,
        saveWishlist: (entries) => {
          writes++;
          return storage.saveWishlist(entries);
        },
      };
      const preparation = createWishlistRunPreparationService({
        storageService: racedStorage,
        gameService: { getBoardgameScoringInput: () => pendingFetch },
        sourceAdapter: {
          loadCapture: () => Promise.resolve(capture),
          readCurrent: () =>
            Promise.resolve({
              collection,
              sourceVectorIdentity: "race-vector",
              policyIdentity: "race-policy",
              canTransmitNotes: false,
            }),
        },
        cache,
      });
      const preparing = preparation.prepare({ kind: "selected", bggIds: [entry.bggId] });
      await Promise.resolve();
      await storage.saveWishlist([]);
      releaseFetch(makeScoringInput(entry.bggId, entry.name));
      let error: unknown;
      try {
        await preparing;
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "invalid-selection" });
      expect(await storage.loadWishlist()).toEqual([]);
      expect(writes).toBe(0);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("production owner-note mutation leaves C-only preparation current but ownership mutation does not", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-run-production-note-fence-"));
    const cache = await createJevPairCache(directory);
    const context = await createHydratedTestApp();
    try {
      const listGamesWithPredictionsFromSnapshot =
        context.predictionService.listGamesWithPredictionsFromSnapshot?.bind(
          context.predictionService,
        );
      if (!listGamesWithPredictionsFromSnapshot)
        throw new Error("Expected snapshot prediction support");
      const owned = await context.gameService.addGame({ name: "Synthetic note-fence owner" });
      const candidate = makeCurrentReadEntry("Synthetic candidate description");
      candidate.id = "synthetic-candidate-901";
      candidate.bggId = 901;
      candidate.name = "Synthetic candidate";
      await context.storageService.saveWishlist([candidate]);
      let hydrationCalls = 0;
      const preparation = createWishlistRunPreparationService({
        storageService: context.storageService,
        gameService: {
          getBoardgameScoringInput: () => {
            hydrationCalls++;
            return Promise.reject(new Error("Saved source should avoid BGG hydration"));
          },
        },
        sourceAdapter: createJevRunSourceAdapter({
          storageService: context.storageService,
          predictionService: { listGamesWithPredictionsFromSnapshot },
        }),
        cache,
      });
      const prepared = await preparation.prepare({ kind: "selected", bggIds: [candidate.bggId] });
      const beforeNote = await context.storageService.loadCollection();
      const noteResult = await context.ownerGameNoteService.set(owned.game.id, {
        commandId: "52000000-0000-4000-8000-000000000001",
        expectedVersion: 0,
        text: "Synthetic test-only private note",
      });
      expect(noteResult.ok).toBe(true);
      const afterNote = await context.storageService.loadCollection();
      expect(afterNote.semanticRedundancy.evidenceEpoch).toBeGreaterThan(
        beforeNote.semanticRedundancy.evidenceEpoch,
      );
      const capturedGame = prepared.capture.collection.games[0];
      const currentGame = afterNote.games[0];
      if (!capturedGame || !currentGame) throw new Error("Expected synthetic owned game");
      const changedGameFields = Object.keys({ ...capturedGame, ...currentGame }).filter(
        (key) =>
          key !== "ownerNote" &&
          JSON.stringify(capturedGame[key as keyof typeof capturedGame]) !==
            JSON.stringify(currentGame[key as keyof typeof currentGame]),
      );
      expect(changedGameFields).toEqual(["updatedAt"]);
      const authorityAfterNote = await createJevRunSourceAdapter({
        storageService: context.storageService,
        predictionService: { listGamesWithPredictionsFromSnapshot },
      }).readCurrent();
      expect(authorityAfterNote.policyIdentity).toBe(prepared.capture.policyIdentity);
      expect(authorityAfterNote.eligibilityIdentity).toBe(prepared.capture.eligibilityIdentity);
      if (prepared.cacheRevision !== null)
        expect(cache.mutationRevision()).toBe(prepared.cacheRevision);
      expect(await prepared.isCurrent()).toBe(true);
      expect(hydrationCalls).toBe(0);

      await context.gameService.setOwnership(owned.game.id, "previously-owned");
      expect(await prepared.isCurrent()).toBe(false);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("currentness fences a real optimistic wishlist refresh at the source coordinator", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-run-refresh-fence-"));
    const cache = await createJevPairCache(directory);
    const context = await createHydratedTestApp({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
      jevPairCache: cache,
    });
    try {
      const actualLookup = cache.lookup.bind(cache);
      let lookupCalls = 0;
      cache.lookup = (input) => {
        lookupCalls++;
        return actualLookup(input);
      };
      const entry = makeCurrentReadEntry("Old saved description");
      entry.id = "refresh-fence-entry";
      const storage = context.storageService;
      const unifiedScoringService = createTestUnifiedScoringService(storage, cache);
      const currentCollection = await storage.loadCollection();
      currentCollection.semanticRedundancy.settings = {
        ...currentCollection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: {
          ...currentCollection.semanticRedundancy.settings.weights,
          factual: 1,
          description: 1,
        },
      };
      await storage.saveCollection(currentCollection);
      await storage.saveRedundancySettings({
        ...(await storage.loadRedundancySettings()),
        enabled: true,
        componentWeights: { binary: 1, continuous: 3 },
      });
      await storage.saveWishlist([entry]);
      await storage.hydrateSourceVector?.();
      let wishlistWriteAttempts = 0;
      let persistedWishlistWrites = 0;
      const actualSaveWishlist = storage.saveWishlist.bind(storage);
      storage.saveWishlist = async (entries) => {
        wishlistWriteAttempts++;
        await actualSaveWishlist(entries);
        persistedWishlistWrites++;
      };
      let releaseAuthorityRead: () => void = () => {};
      let authorityReadStarted: () => void = () => {};
      let observationRecorded: () => void = () => {};
      const authorityGate = new Promise<void>((resolve) => {
        releaseAuthorityRead = resolve;
      });
      const authorityStarted = new Promise<void>((resolve) => {
        authorityReadStarted = resolve;
      });
      const observationReady = new Promise<void>((resolve) => {
        observationRecorded = resolve;
      });
      let pauseNextAuthorityRead = false;
      const coordinator = profileSourceCoordinatorFor(storage);
      const actualLoadJevSourceSnapshot = storage.loadJevSourceSnapshot?.bind(storage);
      if (!actualLoadJevSourceSnapshot)
        throw new Error("Test storage lacks coherent JEV source snapshots");
      let gatedObservation:
        | {
            snapshot: Awaited<ReturnType<typeof actualLoadJevSourceSnapshot>>;
            wishlist: Awaited<ReturnType<typeof storage.loadWishlist>>;
            wishlistGeneration: string;
            writeAttempts: number;
            completedWrites: number;
          }
        | undefined;
      storage.loadJevSourceSnapshot = () =>
        coordinator.runExclusive(async () => {
          if (pauseNextAuthorityRead) {
            pauseNextAuthorityRead = false;
            authorityReadStarted();
            await authorityGate;
            const snapshot = await actualLoadJevSourceSnapshot();
            const wishlist = await storage.loadWishlist();
            gatedObservation = {
              snapshot,
              wishlist,
              wishlistGeneration: wishlistMutationGenerationFor(storage),
              writeAttempts: wishlistWriteAttempts,
              completedWrites: persistedWishlistWrites,
            };
            observationRecorded();
            return snapshot;
          }
          return actualLoadJevSourceSnapshot();
        });
      const listGamesWithPredictionsFromSnapshot =
        context.predictionService.listGamesWithPredictionsFromSnapshot?.bind(
          context.predictionService,
        );
      if (!listGamesWithPredictionsFromSnapshot)
        throw new Error("Test prediction service lacks snapshot prediction support");
      const actualSourceAdapter = createJevRunSourceAdapter({
        storageService: storage,
        predictionService: { listGamesWithPredictionsFromSnapshot },
      });
      const sourceAdapter = actualSourceAdapter;
      const wishlistHydration = createWishlistRunPreparationService({
        storageService: storage,
        gameService: context.gameService,
        sourceAdapter,
        cache,
      });
      const prepared = await prepareUnifiedWishlist(unifiedScoringService, sourceAdapter, cache, {
        kind: "selected",
        bggIds: [entry.bggId],
      });
      let checkingCurrentness: Promise<boolean> | undefined;
      let commitRequests = 0;
      let commitRequestStarted: () => void = () => {};
      const commitRequested = new Promise<void>((resolve) => {
        commitRequestStarted = resolve;
      });
      const wishlistServiceCoordinator: ProfileSourceCoordinator = {
        runExclusive: <Value>(operation: () => Promise<Value>): Promise<Value> => {
          commitRequests++;
          pauseNextAuthorityRead = true;
          checkingCurrentness = prepared.isSourceCurrent();
          commitRequestStarted();
          return coordinator.runExclusive(operation);
        },
      };
      let gatewayConstructions = 0;
      const runService = new JevRunService({
        storageService: storage,
        cache,
        loadCapture: () => sourceAdapter.loadCapture(),
        readCurrent: () => sourceAdapter.readCurrent(),
        createGateway: () => {
          gatewayConstructions++;
          return { evaluatePair: () => Promise.reject(new Error("Gateway must remain unused")) };
        },
      });
      const controller = new JevRunController({
        storageService: storage,
        sourceAdapter,
        cache,
        runService,
        unifiedScoringService: unifiedScoringService,
        wishlistPreparation: wishlistHydration,
      });
      expect((await storage.loadCollection()).semanticRedundancy.settings.enabled).toBe(true);
      expect((await storage.loadRedundancySettings()).enabled).toBe(true);
      const preview = await controller.previewWishlist({ kind: "selected", bggIds: [entry.bggId] });
      expect(preview.status).toBe(200);
      if (preview.status !== 200) throw new Error("Expected selected wishlist preview");
      const lookupCountBeforeCurrentness = lookupCalls;

      const originalScoringInput = result100.verifiedScoringInput;
      if (!originalScoringInput) throw new Error("Expected verified test scoring input");
      const refreshedResult: PredictedGameResult = {
        ...result100,
        verifiedScoringInput: {
          ...originalScoringInput,
          description: "Newly refreshed description",
        },
      };
      const refreshPredictionService: PredictionService = {
        ...createMockPredictionService(new Map([[entry.bggId, refreshedResult]])),
        listGamesWithPredictions: () => Promise.resolve([]),
      };
      const wishlistService = createWishlistService({
        storageService: storage,
        predictionService: refreshPredictionService,
        unifiedScoringService: unifiedScoringService,
        gameService,
        coordinator: wishlistServiceCoordinator,
      });
      const refresh = runOutsideProfileSourceCoordinator(() => wishlistService.refresh(entry.id));
      await commitRequested;
      await authorityStarted;
      let refreshSettled = false;
      void refresh.then(
        () => {
          refreshSettled = true;
        },
        () => {
          refreshSettled = true;
        },
      );
      expect(commitRequests).toBe(1);
      expect(wishlistWriteAttempts).toBe(0);
      expect(persistedWishlistWrites).toBe(0);
      expect(refreshSettled).toBe(false);

      releaseAuthorityRead();
      await observationReady;
      if (!gatedObservation) throw new Error("Expected gated currentness observation");
      expect(gatedObservation.snapshot.collection).toEqual(prepared.frame.sources.collection);
      expect(gatedObservation.snapshot.tournament).toEqual(prepared.frame.sources.tournament);
      expect(gatedObservation.snapshot.predictionSettings).toEqual(
        prepared.frame.sources.predictionSettings,
      );
      expect(gatedObservation.snapshot.redundancySettings).toEqual(
        prepared.frame.redundancySettings,
      );
      expect(gatedObservation.snapshot.freshnessEpoch).toBe(prepared.frame.freshnessEpoch);
      expect(gatedObservation.snapshot.externalEpoch).toBe(prepared.frame.externalEpoch);
      expect(gatedObservation.wishlist[0]?.bggSource?.description).toBe("Old saved description");
      expect(gatedObservation.wishlistGeneration).toBe(prepared.frame.wishlistGeneration);
      expect(gatedObservation.writeAttempts).toBe(0);
      expect(gatedObservation.completedWrites).toBe(0);

      if (!checkingCurrentness) throw new Error("Expected independent source-currentness read");
      await checkingCurrentness;
      await refresh;
      expect(commitRequests).toBe(1);
      expect(wishlistWriteAttempts).toBe(1);
      expect(persistedWishlistWrites).toBe(1);
      expect((await storage.loadWishlist())[0]?.bggSource?.description).toBe(
        "Newly refreshed description",
      );
      expect(wishlistMutationGenerationFor(storage)).not.toBe(prepared.frame.wishlistGeneration);
      expect(await prepared.isSourceCurrent()).toBe(false);
      expect(
        await controller.start({
          requestId: preview.body.requestId,
          precondition: preview.body.precondition,
          noteTransmissionAuthorized: false,
        }),
      ).toEqual({ status: 412, body: { error: "precondition-failed" } });
      expect(gatewayConstructions).toBe(0);
      expect(lookupCalls).toBe(lookupCountBeforeCurrentness);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
