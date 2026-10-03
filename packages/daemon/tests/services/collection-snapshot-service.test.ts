import { describe, expect, test } from "bun:test";
import type {
  Axis,
  Collection,
  CollectionSnapshot,
  DurableGame,
  FitnessResult,
  Game,
  GameWithScore,
  NicheSettings,
  PredictionSettings,
  RedundancySettings,
  ShelfConfiguration,
  TournamentData,
} from "@shelf-judge/shared";
import { createSourceVectorService } from "../../src/services/source-vector.js";
import { buildJevPredictionCaptureIdentity } from "../../src/services/jev-prediction-capture-identity.js";
import { canonicalSha256 } from "../../src/services/profile-source-coordinator.js";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyStateV10,
} from "@shelf-judge/shared";
import { createCollectionSnapshotService } from "../../src/services/collection-snapshot-service.js";
import type { CollectionSnapshotSemanticReadInput } from "../../src/services/collection-snapshot-service.js";
import type { JevPairReadProofFence } from "../../src/services/jev-pair-read-service.js";
import type { RedundancyPairTable } from "../../src/services/redundancy-engine.js";
import { createCollectionSnapshotCacheService } from "../../src/services/collection-snapshot-cache-service.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import { enrichGameWithPurchaseUtilization } from "../../src/services/purchase-utilization-projection.js";
import type { StorageService } from "../../src/services/storage-service.js";
import type { GameService } from "../../src/services/game-service.js";
import type { PredictionService } from "../../src/services/prediction-service.js";
import type { PurchaseUtilizationService } from "../../src/services/purchase-utilization-service.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createGameService } from "../../src/services/game-service.js";
import { createPredictionService } from "../../src/services/prediction-service.js";
import { createDisplayedFitnessService } from "../../src/services/displayed-fitness-service.js";
import { createPurchaseUtilizationService } from "../../src/services/purchase-utilization-service.js";
import { createCapacityService } from "../../src/services/capacity-service.js";
import type { TournamentService } from "../../src/services/tournament-service.js";
import type { CollectionMutationService } from "../../src/services/collection-mutation-service.js";
import { createCollectionSnapshotRoutes } from "../../src/routes/collection-snapshot.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import {
  projectGameWithScore,
  projectProfileCollectionSource,
} from "../../src/services/game-projection.js";

type GameWithNote = Game & { ownerNote: { state: "missing"; version: 0; updatedAt: null } };

function scoreWithSimilarityDefault(score: FitnessResult | null):
  | (FitnessResult & {
      redundancySimilarityInfo: NonNullable<FitnessResult["redundancySimilarityInfo"]>;
    })
  | null {
  return score === null
    ? null
    : {
        ...score,
        redundancySimilarityInfo: score.redundancySimilarityInfo ?? {
          status: "disabled",
          generationId: null,
        },
      };
}

function setup(
  options: {
    tournamentFailure?: boolean;
    nicheFailure?: boolean;
    malformedShelfFallback?: boolean;
    bumpDuringPrediction?: boolean;
    game?: GameWithNote;
    clock?: { now(): number };
    beforePrediction?: () => Promise<void>;
  } = {},
) {
  const vector = createSourceVectorService();
  vector.hydrate(
    { id: "collection-id", schemaVersion: 10, revision: 1 },
    {
      tournament: 1,
      predictionSettings: 1,
      nicheSettings: 1,
      redundancySettings: 1,
      shelfConfig: 1,
    },
  );
  const collection: Collection = {
    schemaVersion: 10,
    revision: 1,
    id: "collection-id",
    name: "Collection",
    axes: [],
    games: options.game ? [options.game] : [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: createInitialSemanticRedundancyStateV10(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let tournamentUnavailable = options.tournamentFailure ?? false;
  const tournament: TournamentData = {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
    sessions: [],
    gameStats: {
      partial: {
        eloRating: 1610,
        comparisonCount: 2,
        wins: 2,
        losses: 0,
        recentComparisons: [],
      },
    },
  };
  let nicheUnavailable = options.nicheFailure ?? false;
  if (nicheUnavailable) vector.markUnavailable("niche-settings");
  const storage = {
    sourceVector: () => vector.read(),
    loadCollection: () => Promise.resolve(structuredClone(collection)),
    loadTournament: () => {
      if (tournamentUnavailable) return Promise.reject(new Error("tournament missing"));
      vector.publish("tournament", 1);
      return Promise.resolve(structuredClone(tournament));
    },
    loadPredictionSettings: () =>
      Promise.resolve({
        stageThresholds: [5, 15, 30] as [number, number, number],
        defaultK: 5,
        minSimilarityThreshold: 0.2,
      }),
    loadRedundancySettings: () =>
      Promise.resolve({
        enabled: false,
        stage: "annotation" as const,
        similarityThreshold: 0.6,
        maxPenalty: 2,
        componentWeights: { binary: 0.4, continuous: 0.3 },
        minNeighbors: 1,
        expectedNeighbors: 5,
      }),
    loadNicheSettings: () => {
      if (nicheUnavailable) {
        vector.markUnavailable("niche-settings");
        return Promise.reject(new Error("niche settings unavailable"));
      }
      vector.publish("niche-settings", 1);
      return Promise.resolve({ ignoredTags: [] });
    },
    loadShelfConfig: () => {
      if (options.malformedShelfFallback) vector.markUnavailable("shelf-config");
      return Promise.resolve({
        units: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    },
  } as unknown as StorageService;
  const gameService = {
    listRawGamesFromSnapshot: () =>
      options.game ? [{ game: options.game, score: null, bggDataStale: false }] : [],
  } as unknown as GameService;
  const predictionService = {
    async preparePredictionListFromSnapshot() {
      if (options.bumpDuringPrediction) vector.publish("prediction-settings", 2);
      await options.beforePrediction?.();
      const game = options.game;
      return {
        listGames: () => (game ? [{ game, score: null }] : []),
      };
    },
  } as unknown as PredictionService;
  const purchaseUtilizationService = {
    enrichGames: (entries: GameWithScore[], benchmark: Collection["entertainmentBenchmark"]) =>
      entries.map((entry) => enrichGameWithPurchaseUtilization(entry, benchmark)),
  } as unknown as PurchaseUtilizationService;
  const service = createCollectionSnapshotService({
    storageService: storage,
    gameService,
    predictionService,
    purchaseUtilizationService,
    clock: options.clock,
  });
  const cache = createCollectionSnapshotCacheService({
    builder: service,
    storageService: storage,
    coordinator: profileSourceCoordinatorFor(storage),
    clock: options.clock,
  });
  return {
    service,
    cache,
    route: createCollectionSnapshotRoutes(cache).routes,
    recoverNicheSettings: () => {
      nicheUnavailable = false;
    },
    recoverTournament: () => {
      tournamentUnavailable = false;
    },
  };
}

function parityFixture(
  stage: RedundancySettings["stage"],
  enabled = true,
  resolveSemanticRead?: (input: CollectionSnapshotSemanticReadInput) => JevPairReadProofFence,
  resolveRedundancyPairTable?: () => RedundancyPairTable | undefined,
) {
  const now = "2026-02-01T00:00:00.000Z";
  const personalAxis = (id: string, name: string, veto = false): Axis => ({
    id,
    name,
    description: null,
    weight: 100,
    enabled: true,
    source: "personal",
    preferenceShape: "higher-is-better",
    veto: veto ? { direction: "below", threshold: 2 } : null,
    createdAt: now,
    updatedAt: now,
  });
  const axes = [personalAxis("fun", "Fun", true), personalAxis("theme", "Theme")];
  const makeGame = (
    id: string,
    name: string,
    ratings: Record<string, number>,
    ownership: "owned" | "previously-owned" = "owned",
  ): DurableGame => ({
    id,
    bggId: Number(id.replaceAll(/\D/g, "")) || 100,
    additionalBggIds: [],
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: {
      communityRating: 7,
      bayesAverage: 7,
      weight: 2,
      numWeightVotes: 100,
      description: null,
      mechanics: [{ id: 1, name: "Dice Rolling" }],
      categories: [{ id: 1, name: "Strategy" }],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: now,
    },
    numPlays: 10,
    acquisition: {
      state: "purchase",
      amount: { hundredths: 1000, source: "manual", confirmedAt: now },
    },
    playCountEvidence: { status: "valid", value: 10, source: "manual", observedAt: now },
    durationEvidence: { status: "valid", value: 60, source: "manual", observedAt: now },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 2, maxPlayers: 4 },
      source: "manual",
      observedAt: now,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    entityMetadata: createInitialEntityMetadata(Number(id.replaceAll(/\D/g, "")) || 100),
    latestPlayCountCheck: null,
    ownership,
    boxDimensions: id === "prediction-only" ? null : { width: 3, height: 3, depth: 3 },
    manualShelfId: null,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    ratings,
    createdAt: now,
    updatedAt: now,
  });
  const games = [
    ...Array.from({ length: 5 }, (_, index) =>
      makeGame(`ref-${index}`, `Reference ${index}`, {
        fun: index === 0 ? 1 : 5 + index,
        theme: 4 + index,
      }),
    ),
    makeGame("partial", "Partially rated", { fun: 8 }),
    makeGame("prediction-only", "Prediction only", {}),
    makeGame("retired", "Previously owned", { fun: 10, theme: 10 }, "previously-owned"),
  ];
  games.find((game) => game.id === "prediction-only")!.ratings["unconfigured-null"] =
    null as unknown as number;
  const collection: Collection = {
    schemaVersion: 10,
    revision: 1,
    id: "parity-collection",
    name: "Parity collection",
    axes,
    games,
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: {
      state: "configured",
      amount: { hundredths: 500, source: "manual", confirmedAt: now },
    },
    semanticRedundancy: createInitialSemanticRedundancyStateV10(),
    createdAt: now,
    updatedAt: now,
  };
  const tournament: TournamentData = {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
    sessions: [],
    gameStats: {
      partial: {
        eloRating: 1610,
        comparisonCount: 2,
        wins: 2,
        losses: 0,
        recentComparisons: [],
      },
    },
  };
  const predictionSettings: PredictionSettings = {
    stageThresholds: [5, 10, 20],
    defaultK: 5,
    minSimilarityThreshold: 0.1,
  };
  const redundancySettings: RedundancySettings = {
    enabled,
    stage,
    similarityThreshold: 0.05,
    maxPenalty: 2,
    componentWeights: { binary: 1, continuous: 0 },
    minNeighbors: 1,
    expectedNeighbors: 2,
  };
  const nicheSettings: NicheSettings = {
    ignoredTags: [{ type: "category", name: "Ignored category" }],
  };
  const shelfConfig: ShelfConfiguration = {
    units: [
      {
        id: "unit-1",
        name: "Unit 1",
        shelves: [
          {
            id: "shelf-1",
            name: "Shelf 1",
            dimensionless: false,
            width: 20,
            height: 20,
            depth: 20,
          },
        ],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const vector = createSourceVectorService();
  vector.hydrate(
    {
      id: collection.id,
      schemaVersion: 10,
      revision: 1,
      semanticEvidenceEpoch: collection.semanticRedundancy.evidenceEpoch,
      semanticConsentEpoch: collection.semanticRedundancy.consentEpoch,
      factualWeightsEpoch: collection.semanticRedundancy.factualWeightsEpoch,
      factualWeightsFingerprint: collection.semanticRedundancy.factualWeightsFingerprint,
    },
    {
      tournament: 1,
      predictionSettings: 1,
      nicheSettings: 1,
      redundancySettings: 1,
      shelfConfig: 1,
    },
  );
  vector.publishRedundancyWeightsFingerprint(canonicalSha256(redundancySettings.componentWeights));
  const storage = {
    sourceVector: () => vector.read(),
    loadCollection: () => Promise.resolve(structuredClone(collection)),
    loadTournament: () => Promise.resolve(structuredClone(tournament)),
    loadPredictionSettings: () => Promise.resolve(structuredClone(predictionSettings)),
    loadRedundancySettings: () => Promise.resolve(structuredClone(redundancySettings)),
    loadNicheSettings: () => Promise.resolve(structuredClone(nicheSettings)),
    loadShelfConfig: () => Promise.resolve(structuredClone(shelfConfig)),
  } as unknown as StorageService;
  const fitnessService = createFitnessService();
  const gameService = createGameService({
    storageService: storage,
    collectionMutationService: {} as CollectionMutationService,
    fitnessService,
  });
  let rawPassCount = 0;
  let legacyListCount = 0;
  const rawPass = gameService.listRawGamesFromSnapshot!.bind(gameService);
  const legacyList = gameService.listGames.bind(gameService);
  gameService.listRawGamesFromSnapshot = (source, data) => {
    rawPassCount += 1;
    return rawPass(source, data);
  };
  gameService.listGames = () => {
    legacyListCount += 1;
    return legacyList();
  };
  const tournamentService = {} as TournamentService;
  const predictionService = createPredictionService({
    storageService: storage,
    fitnessService,
    tournamentService,
  });
  let predictionContextCount = 0;
  let predictionFailure = false;
  const preparePrediction =
    predictionService.preparePredictionListFromSnapshot!.bind(predictionService);
  predictionService.preparePredictionListFromSnapshot = async (...args) => {
    predictionContextCount += 1;
    if (predictionFailure) throw new Error("prediction context unavailable");
    return preparePrediction(...args);
  };
  const purchaseUtilizationService = createPurchaseUtilizationService({
    storageService: storage,
    collectionMutationService: {} as CollectionMutationService,
  });
  const snapshotService = createCollectionSnapshotService({
    storageService: storage,
    gameService,
    predictionService,
    purchaseUtilizationService,
    ...(resolveSemanticRead ? { resolveSemanticRead } : {}),
    ...(resolveRedundancyPairTable ? { resolveRedundancyPairTable } : {}),
  });
  const snapshotCache = createCollectionSnapshotCacheService({
    builder: snapshotService,
    storageService: storage,
    coordinator: profileSourceCoordinatorFor(storage),
  });
  const snapshotRoute = createCollectionSnapshotRoutes(snapshotCache).routes;
  const displayedService = createDisplayedFitnessService({
    gameService,
    predictionService,
    storageService: storage,
  });
  const capacityService = createCapacityService({ storageService: storage, gameService });
  return {
    collection,
    tournament,
    predictionSettings,
    redundancySettings,
    shelfConfig,
    snapshotService,
    snapshotRoute,
    displayedService,
    purchaseUtilizationService,
    capacityService,
    failPredictions: () => {
      predictionFailure = true;
    },
    recoverPredictions: () => {
      predictionFailure = false;
    },
    counts: () => ({ rawPassCount, legacyListCount, predictionContextCount }),
  };
}

describe("CollectionSnapshotService", () => {
  test("semantic snapshot scoring uses one fenced read over the complete prediction capture", async () => {
    let readInput: CollectionSnapshotSemanticReadInput | undefined;
    const fixture = parityFixture("integrated", true, (input) => {
      readInput = input;
      const identity = {
        generationId: "semantic-generation",
        consentEpoch: "1",
        settingsEpoch: "1:1",
      };
      const result = {
        status: "ready" as const,
        summary: "Semantic redundancy is ready.",
        table: {
          status: "ready" as const,
          identity,
          expectedIdentity: identity,
          weights: { factual: 0.4, description: 0.4, ownerNote: 0.2 },
          pairs: [],
        },
      };
      return {
        result,
        proof: { status: "ready", identity: "semantic-generation" },
        isCurrent: () => true,
      };
    });
    fixture.collection.semanticRedundancy.settings.enabled = true;
    fixture.collection.semanticRedundancy.settings.weights.description = 1;
    const built = await fixture.snapshotService.buildSnapshot();
    expect(readInput?.predictionCapture).toHaveLength(fixture.collection.games.length);
    expect(readInput?.predictionCapture.some(({ game }) => game.id === "retired")).toBe(true);
    expect(readInput?.captureIdentity.sourceVectorIdentity).toMatch(/^[a-f0-9]{64}$/);
    if (!readInput) throw new Error("Expected the complete semantic read input");
    const identityInput = {
      collection: readInput.collection,
      sourceVector: readInput.sourceVector,
      tournament: readInput.tournament,
      predictionSettings: readInput.predictionSettings,
      factualWeights: readInput.factualWeights,
      predictionCapture: readInput.predictionCapture,
    };
    const baselineIdentity = buildJevPredictionCaptureIdentity(identityInput);
    if (!baselineIdentity.ok) throw new Error(baselineIdentity.reason);
    expect(baselineIdentity.identity).toEqual(readInput.captureIdentity);
    expect(
      buildJevPredictionCaptureIdentity({
        ...identityInput,
        sourceVector: {
          ...identityInput.sourceVector,
          processEpoch: "another-process",
          changeToken: identityInput.sourceVector.changeToken + 100,
        },
      }),
    ).toEqual(baselineIdentity);
    const revisedCollection = { ...identityInput.collection, revision: 2 };
    expect(
      buildJevPredictionCaptureIdentity({
        ...identityInput,
        collection: revisedCollection,
        sourceVector: { ...identityInput.sourceVector, collectionRevision: 2 },
      }),
    ).toEqual(baselineIdentity);
    const reorderedCapture = identityInput.predictionCapture.map((entry) => ({
      score: entry.score,
      game: Object.fromEntries(
        Object.entries({
          ...entry.game,
          name: `Presentation only: ${entry.game.name}`,
        }).reverse(),
      ) as unknown as typeof entry.game,
    }));
    expect(
      buildJevPredictionCaptureIdentity({ ...identityInput, predictionCapture: reorderedCapture }),
    ).toEqual(baselineIdentity);
    expect(built.semanticRead?.status).toBe("verified");
    expect(
      built.semanticRead?.status === "verified" &&
        built.semanticRead.result.status === "ready" &&
        built.semanticRead.result.table.identity.generationId,
    ).toBe("semantic-generation");
    expect(JSON.stringify(built.snapshot)).not.toMatch(
      /semantic-generation|semanticRedundancy|ownerNote/,
    );
    expect(built.semanticRead?.status === "verified" && built.semanticRead.isCurrent()).toBe(true);
  });

  test("incoherent capture identity fails closed to factual not-ready without a semantic read", async () => {
    let semanticReadCalls = 0;
    const fixture = parityFixture("integrated", true, () => {
      semanticReadCalls += 1;
      throw new Error("incoherent capture must not reach semantic read");
    });
    fixture.collection.semanticRedundancy.settings.enabled = true;
    fixture.collection.semanticRedundancy.settings.weights.description = 1;
    // The collection has advanced without its authoritative source vector advancing.
    fixture.collection.revision += 1;

    const built = await fixture.snapshotService.buildSnapshot();

    expect(semanticReadCalls).toBe(0);
    expect(built.semanticRead).toEqual({ status: "not-used" });
    expect(built.snapshot.redundancyMode).toBe("integrated");
    expect(
      built.snapshot.games.every(
        (row) =>
          row.game.ownership === "previously-owned" ||
          row.ordinary.score === null ||
          row.ordinary.score.redundancySimilarityInfo?.status === "not-ready",
      ),
    ).toBe(true);
    expect(
      built.snapshot.games.every((row) => row.redundancySimilarityInfo.generationId === null),
    ).toBe(true);
  });

  test("not-ready semantic fallback retains its read fence", async () => {
    const fixture = parityFixture("integrated", true, () => ({
      result: { status: "not-ready", summary: "Semantic redundancy is not ready." },
      proof: { status: "not-ready", summary: "Semantic redundancy is not ready." },
      isCurrent: () => true,
    }));
    fixture.collection.semanticRedundancy.settings.enabled = true;
    fixture.collection.semanticRedundancy.settings.weights.description = 1;
    const built = await fixture.snapshotService.buildSnapshot();
    expect(built.semanticRead?.status).toBe("verified");
    expect(built.semanticRead?.status === "verified" && built.semanticRead.result.status).toBe(
      "not-ready",
    );
    expect(built.semanticRead?.status === "verified" && built.semanticRead.isCurrent()).toBe(true);
  });

  test("legacy ready pair tables cannot bypass semantic read proof when semantic settings are disabled", async () => {
    let legacyResolverCalls = 0;
    let semanticProviderCalls = 0;
    const fixture = parityFixture(
      "integrated",
      true,
      () => {
        semanticProviderCalls += 1;
        throw new Error(
          "Semantic provider should not be called when semantic settings are disabled",
        );
      },
      () => {
        legacyResolverCalls += 1;
        const identity = {
          generationId: "unfenced-generation",
          consentEpoch: "1",
          settingsEpoch: "1:1",
        };
        return {
          status: "ready",
          identity,
          expectedIdentity: identity,
          weights: { factual: 1, description: 0, ownerNote: 0 },
          pairs: [],
        };
      },
    );

    const built = await fixture.snapshotService.buildSnapshot();

    expect(fixture.collection.semanticRedundancy.settings.enabled).toBe(false);
    expect(legacyResolverCalls).toBe(1);
    expect(semanticProviderCalls).toBe(0);
    expect(built.semanticRead).toEqual({ status: "not-used" });
    expect(built.snapshot.redundancyMode).toBe("off");
    expect(built.snapshot.unavailableFeatures).toContainEqual({
      feature: "redundancy",
      reason: "Semantic redundancy read proof is unavailable",
    });
    for (const row of built.snapshot.games) {
      expect(row.redundancySimilarityInfo.status).not.toBe("ready");
      expect(row.redundancySimilarityInfo.generationId).toBeNull();
      expect(row.ordinary.score?.redundancySimilarityInfo?.status).not.toBe("ready");
      expect(row.ordinary.score?.redundancySimilarityInfo?.generationId ?? null).toBeNull();
      if (row.predicted.availability === "available") {
        expect(row.predicted.score?.redundancySimilarityInfo?.status).not.toBe("ready");
        expect(row.predicted.score?.redundancySimilarityInfo?.generationId ?? null).toBeNull();
      }
    }
    expect(JSON.stringify(built.snapshot)).not.toContain("unfenced-generation");
  });

  test("semantic publication remains not-ready while factual scoring is shared by list and snapshot", async () => {
    const fixture = parityFixture("integrated", true);
    fixture.redundancySettings.similarityThreshold = 1.01;
    fixture.collection.semanticRedundancy.settings.enabled = true;
    const snapshot = (await fixture.snapshotService.buildSnapshot()).snapshot;
    const listed = await fixture.displayedService.listGames({ includePredicted: true });
    const detail = await fixture.displayedService.listGames({
      includePredicted: true,
      targetGameIds: ["ref-1"],
    });
    const row = snapshot.games.find(({ game }) => game.id === "ref-1")!;
    const entry = listed.find(({ game }) => game.id === "ref-1")!;
    expect(snapshot.status).toBe("complete");
    expect(JSON.stringify(snapshot)).not.toMatch(/semanticRedundancy|pairOutcomes|ownerNote/);
    expect(row.ordinary.score?.redundancySimilarityInfo).toEqual({
      status: "not-ready",
      generationId: null,
    });
    expect(entry.score?.redundancySimilarityInfo).toEqual({
      status: "not-ready",
      generationId: null,
    });
    expect(detail.find(({ game }) => game.id === "ref-1")?.score?.score).toBe(entry.score?.score);
    expect(row.ordinary.score?.score).toBe(entry.score?.score);
    expect(row.ordinary.score?.redundancyAdjustment).toBeNull();
  });

  test("real scoring engines preserve legacy variants, niches, utilization, and raw capacity", async () => {
    for (const mode of [
      { stage: "annotation" as const, enabled: false },
      { stage: "annotation" as const, enabled: true },
      { stage: "integrated" as const, enabled: true },
    ]) {
      const fixture = parityFixture(mode.stage, mode.enabled);
      const capturedDimensions = new Map(
        fixture.collection.games.map((game) => [
          game.id,
          structuredClone(game.boxDimensions ?? null),
        ]),
      );
      const response = await fixture.snapshotRoute.request("/collection/snapshot");
      expect(response.status).toBe(200);
      const snapshot = (await response.json()) as CollectionSnapshot;
      expect(snapshot.status).toBe("complete");
      expect(snapshot.counts.total).toBe(fixture.collection.games.length);
      expect(snapshot.counts.unavailablePredictions).toBe(0);
      expect(snapshot.counts.rated).toBe(
        snapshot.games.filter(
          (row) => row.game.ownership === "owned" && row.ordinary.score !== null,
        ).length,
      );
      expect(snapshot.counts.predicted).toBe(
        snapshot.games.filter(
          (row) =>
            row.predicted.availability === "available" &&
            (row.predicted.score?.predictionMeta?.predictedAxisCount ?? 0) > 0,
        ).length,
      );
      expect(fixture.counts()).toEqual({
        rawPassCount: 1,
        legacyListCount: 0,
        predictionContextCount: 1,
      });

      const ordinaryLegacy = fixture.purchaseUtilizationService.enrichGames(
        await fixture.displayedService.listGames({ includePredicted: false, includeNiches: true }),
        fixture.collection.entertainmentBenchmark,
        "list",
      );
      const predictedLegacy = fixture.purchaseUtilizationService.enrichGames(
        await fixture.displayedService.listGames({ includePredicted: true, includeNiches: true }),
        fixture.collection.entertainmentBenchmark,
        "list",
      );
      const byId = new Map(snapshot.games.map((row) => [row.game.id, row]));
      for (const game of fixture.collection.games) {
        expect(byId.get(game.id)?.game.boxDimensions).toEqual(
          capturedDimensions.get(game.id) ?? null,
        );
        expect(game.boxDimensions ?? null).toEqual(capturedDimensions.get(game.id) ?? null);
        expect(Object.keys(byId.get(game.id)!.game.ratings)).toEqual(Object.keys(game.ratings));
        expect(byId.get(game.id)!.game.ratings).toEqual(game.ratings);
      }
      expect(byId.get("ref-0")?.ordinary.score).toMatchObject({ score: 0, vetoed: true });
      expect(byId.get("partial")?.ordinary.score?.ratedAxisCount).toBe(1);
      expect(byId.get("prediction-only")?.ordinary.score).toBeNull();
      const predictionOnly = byId.get("prediction-only")?.predicted;
      expect(
        predictionOnly?.availability === "available"
          ? predictionOnly.score?.predictionMeta?.predictedAxisCount
          : 0,
      ).toBeGreaterThan(0);
      for (const legacy of ordinaryLegacy) {
        const row = byId.get(legacy.game.id);
        expect(row?.ordinary.score).toEqual(scoreWithSimilarityDefault(legacy.score));
        expect(row?.ordinary.displayScore).toEqual(legacy.displayScore);
        expect(row?.ordinary.purchaseUtilization).toEqual(legacy.purchaseUtilization);
      }
      for (const legacy of predictedLegacy) {
        const row = byId.get(legacy.game.id);
        expect(row?.predicted.availability).toBe("available");
        if (row?.predicted.availability !== "available") continue;
        expect(row.predicted.score).toEqual(scoreWithSimilarityDefault(legacy.score));
        expect(row.predicted.displayScore).toEqual(legacy.displayScore);
        expect(row.predicted.purchaseUtilization).toEqual(legacy.purchaseUtilization);
      }
      const nicheById = new Map(
        snapshot.nichePositions.availability === "available"
          ? snapshot.nichePositions.positions.map((entry) => [entry.gameId, entry.position])
          : [],
      );
      for (const legacy of ordinaryLegacy) {
        expect(nicheById.get(legacy.game.id) ?? null).toEqual(legacy.nichePosition ?? null);
      }
      for (const legacy of predictedLegacy) {
        expect(nicheById.get(legacy.game.id) ?? null).toEqual(legacy.nichePosition ?? null);
      }
      expect(nicheById.has("retired")).toBe(false);
      expect(snapshot.games.find((row) => row.game.id === "retired")?.game.ownership).toBe(
        "previously-owned",
      );
      expect(snapshot.games.every((row) => !("ownerNote" in row.game))).toBe(true);
      for (const row of snapshot.games) {
        if (row.game.id === "partial") {
          expect(row.tournament).toMatchObject({
            eloRating: 1610,
            comparisonCount: 2,
            normalizedScore: null,
            displayLabel: "not yet ranked",
            wins: 2,
            losses: 0,
          });
          expect(row.hasTournamentData).toBe(true);
        } else {
          expect(row.tournament).toBeNull();
          expect(row.hasTournamentData).toBe(false);
        }
      }
      expect(snapshot.games.find((row) => row.game.id === "partial")?.tournament).toMatchObject({
        eloRating: 1610,
        comparisonCount: 2,
        wins: 2,
        losses: 0,
      });
      expect(
        snapshot.games.find((row) => row.game.id === "retired")?.ordinary.score?.score,
      ).toBeGreaterThan(
        Math.max(
          ...snapshot.games
            .filter((row) => row.game.ownership === "owned")
            .map((row) => row.ordinary.score?.score ?? -1),
        ),
      );
      expect(snapshot.averageScore).toBeCloseTo(
        ordinaryLegacy
          .filter((entry) => entry.game.ownership !== "previously-owned" && entry.score !== null)
          .reduce((sum, entry, _, all) => sum + (entry.score?.score ?? 0) / all.length, 0),
      );
      if (mode.stage === "integrated") {
        expect(
          snapshot.games.some(
            (row) =>
              row.predicted.availability === "available" &&
              row.ordinary.score?.score !== row.predicted.score?.score,
          ),
        ).toBe(true);
        expect(
          snapshot.games.some(
            (row) =>
              row.ordinary.purchaseUtilization.sort.valueRemainingHundredths !==
              (row.predicted.availability === "available"
                ? row.predicted.purchaseUtilization.sort.valueRemainingHundredths
                : null),
          ),
        ).toBe(true);
      }
      expect(snapshot.capacity).toMatchObject({ availability: "available" });
      if (snapshot.capacity.availability === "available") {
        expect(snapshot.capacity.result?.gamesWithDimensions).toBe(6);
        expect(snapshot.capacity.result?.gamesWithoutDimensions).toBe(1);
        const capacityGameIds = [
          ...(snapshot.capacity.result?.assignments.flatMap((assignment) =>
            assignment.games.map((game) => game.gameId),
          ) ?? []),
          ...(snapshot.capacity.result?.assignmentConflicts.map((entry) => entry.gameId) ?? []),
          ...(snapshot.capacity.result?.unfittableGames.map((entry) => entry.gameId) ?? []),
          ...(snapshot.capacity.result?.overflowGames.map((entry) => entry.gameId) ?? []),
        ];
        expect(capacityGameIds).not.toContain("retired");
        expect(snapshot.capacity.result).toEqual(await fixture.capacityService.computeCapacity());
      }
    }
  });

  function gameWithPrivateNote(): GameWithNote {
    return {
      id: "row-game",
      bggId: null,
      name: "Row game",
      yearPublished: null,
      minPlayers: null,
      maxPlayers: null,
      bestPlayers: null,
      playingTime: null,
      imageUrl: null,
      bggData: null,
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
      entityMetadata: createInitialEntityMetadata(null),
      latestPlayCountCheck: null,
      ownership: "owned",
      boxDimensions: null,
      manualShelfId: null,
      ratings: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ownerNote: { state: "missing", version: 0, updatedAt: null },
    };
  }

  test("returns a complete empty snapshot rather than confusing empty with unavailable", async () => {
    const { service } = setup();
    const built = await service.buildSnapshot();
    const snapshot = built.snapshot;
    expect(snapshot.status).toBe("complete");
    expect(snapshot.games).toEqual([]);
    expect(snapshot.counts).toEqual({
      total: 0,
      rated: 0,
      predicted: 0,
      unavailablePredictions: 0,
    });
    expect(snapshot.capacity).toMatchObject({
      availability: "available",
      result: { configured: false },
    });
    expect(built.expiresAtMs).toBeNull();
  });

  test("buildSnapshot returns captured source and BGG expiry metadata for complete and degraded bodies", async () => {
    const fetchedAtMs = Date.UTC(2026, 0, 1);
    const evaluatedAtMs = fetchedAtMs + 1_000;
    const game = {
      ...gameWithPrivateNote(),
      bggData: {
        communityRating: 7,
        bayesAverage: 7,
        weight: 2,
        numWeightVotes: 1,
        description: null,
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: new Date(fetchedAtMs).toISOString(),
      },
    } as GameWithNote;
    const completeFixture = setup({ game, clock: { now: () => evaluatedAtMs } });
    const complete = await completeFixture.service.buildSnapshot();
    expect(complete.snapshot.status).toBe("complete");
    expect(complete.sourceVector.changeToken).toBeGreaterThan(0);
    expect(complete.snapshot.collectionId === complete.sourceVector.collectionId).toBe(true);
    expect(complete.evaluatedAtMs).toBe(evaluatedAtMs);
    expect(complete.expiresAtMs).toBe(fetchedAtMs + 7 * 24 * 60 * 60 * 1000 + 1);

    const degradedFixture = setup({
      nicheFailure: true,
      game,
      clock: { now: () => evaluatedAtMs },
    });
    const degraded = await degradedFixture.service.buildSnapshot();
    expect(degraded.snapshot.status).toBe("degraded");
    expect(degraded.sourceVector.unavailableSources).toContain("niche-settings");
    expect(degraded.sourceVector.changeToken).toBeGreaterThan(0);
    expect(degraded.evaluatedAtMs).toBe(evaluatedAtMs);
    expect(degraded.expiresAtMs).toBe(complete.expiresAtMs);
  });

  test("cache rejects a real assembler build that crosses BGG expiry or moves backward", async () => {
    const fetchedAtMs = Date.UTC(2026, 0, 1);
    const firstStaleMs = fetchedAtMs + 7 * 24 * 60 * 60 * 1000 + 1;
    const game = {
      ...gameWithPrivateNote(),
      bggData: {
        communityRating: 7,
        bayesAverage: 7,
        weight: 2,
        numWeightVotes: 1,
        description: null,
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: new Date(fetchedAtMs).toISOString(),
      },
    } as GameWithNote;

    for (const { initialTime, moveTo } of [
      { initialTime: firstStaleMs - 1, moveTo: firstStaleMs },
      { initialTime: firstStaleMs - 10_000, moveTo: firstStaleMs - 20_000 },
    ]) {
      let now = initialTime;
      let predictionBuilds = 0;
      let releasePrediction!: () => void;
      let signalPrediction!: () => void;
      let firstPrediction = true;
      const predictionStarted = new Promise<void>((resolve) => {
        signalPrediction = resolve;
      });
      const fixture = setup({
        game,
        clock: { now: () => now },
        beforePrediction: async () => {
          predictionBuilds += 1;
          if (!firstPrediction) return;
          firstPrediction = false;
          signalPrediction();
          await new Promise<void>((resolve) => {
            releasePrediction = resolve;
          });
        },
      });

      const pending = fixture.cache.resolve();
      await predictionStarted;
      now = moveTo;
      releasePrediction();
      const result = await pending;
      expect(result.status).toBe(200);
      expect(result.snapshotStatus).toBe("complete");
      expect(result.cacheable).toBe(true);
      expect(predictionBuilds).toBe(2);
    }
  });

  test("projects one narrow row without owner notes", async () => {
    const { service } = setup({ game: gameWithPrivateNote() });
    const snapshot = await service.getSnapshot();
    expect(snapshot.games).toHaveLength(1);
    expect(snapshot.games[0]?.game).toEqual({
      id: "row-game",
      name: "Row game",
      bggId: null,
      yearPublished: null,
      imageUrl: null,
      numPlays: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ratings: {},
      bggData: null,
      boxDimensions: null,
      minPlayers: null,
      maxPlayers: null,
      bestPlayers: null,
      playingTime: null,
      ownership: "owned",
    });
    expect(snapshot.games[0]?.game).not.toHaveProperty("ownerNote");
    expect(snapshot.games[0]?.hasTournamentData).toBe(false);
    expect(snapshot.games[0]?.tournament).toBeNull();
  });

  test("required tournament failure rejects instead of returning fabricated scores", () => {
    const { service } = setup({ tournamentFailure: true });
    return expect(service.getSnapshot()).rejects.toThrow(
      "Collection snapshot sources are unavailable",
    );
  });

  test("required tournament route failure is retryable 503", async () => {
    const { route } = setup({ tournamentFailure: true });
    const response = await route.request("/collection/snapshot");
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error?: unknown };
    expect(typeof body.error).toBe("string");
  });

  test("optional niche-source failure returns an explicit degraded non-cacheable snapshot", async () => {
    const { route, recoverNicheSettings } = setup({ nicheFailure: true });
    const degradedResponse = await route.request("/collection/snapshot");
    expect(degradedResponse.status).toBe(200);
    expect(degradedResponse.headers.get("cache-control")).toBe("no-store");
    expect(degradedResponse.headers.get("etag")).toBeNull();
    const snapshot = (await degradedResponse.json()) as CollectionSnapshot;
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.nichePositions.availability).toBe("unavailable");
    expect(snapshot.unavailableFeatures).toContainEqual({
      feature: "niches",
      reason: "Niche settings are unavailable",
    });
    const repeatedDegradedResponse = await route.request("/collection/snapshot");
    expect(repeatedDegradedResponse.status).toBe(200);
    expect(((await repeatedDegradedResponse.json()) as CollectionSnapshot).status).toBe("degraded");
    recoverNicheSettings();
    const recoveredResponse = await route.request("/collection/snapshot");
    expect(recoveredResponse.status).toBe(200);
    expect(recoveredResponse.headers.get("cache-control")).toBe("private, no-cache");
    expect(recoveredResponse.headers.get("etag")).toMatch(/^W\/"cs1-/);
    const recoveredSnapshot = (await recoveredResponse.json()) as CollectionSnapshot;
    expect(recoveredSnapshot.status).toBe("complete");
  });

  test("required tournament failure can recover on a later capture", async () => {
    const { route, recoverTournament } = setup({ tournamentFailure: true });
    expect((await route.request("/collection/snapshot")).status).toBe(503);
    recoverTournament();
    const recovered = await route.request("/collection/snapshot");
    expect(recovered.status).toBe(200);
    expect(((await recovered.json()) as CollectionSnapshot).status).toBe("complete");
  });

  test("a fulfilled malformed-shelf fallback does not certify capacity", async () => {
    const { route } = setup({ malformedShelfFallback: true });
    const response = await route.request("/collection/snapshot");
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as CollectionSnapshot;
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.capacity.availability).toBe("unavailable");
    expect(snapshot.games).toHaveLength(0);
  });

  test("capacity numeric overflow degrades capacity while retaining ordinary rows", async () => {
    const fixture = parityFixture("annotation", false);
    fixture.collection.games[0].boxDimensions = {
      width: 1e308,
      height: 2,
      depth: 2,
    };
    fixture.shelfConfig.units[0].shelves[0].width = 1e308;
    fixture.shelfConfig.units[0].shelves[0].height = 2;
    fixture.shelfConfig.units[0].shelves[0].depth = 2;
    const snapshot = await fixture.snapshotService.getSnapshot();
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.capacity.availability).toBe("unavailable");
    expect(snapshot.games).toHaveLength(fixture.collection.games.length);
    expect(snapshot.games[0]?.ordinary.score).not.toBeNull();
    const firstRow = snapshot.games[0];
    expect(firstRow?.ordinary.score).not.toBeNull();
    if (!firstRow || firstRow.ordinary.score === null) {
      throw new Error("Expected a scored snapshot row");
    }
    expect(firstRow.redundancySimilarityInfo).toEqual(
      firstRow.ordinary.score.redundancySimilarityInfo,
    );
  });

  test("list, targeted detail, and snapshot preserve note-free similarity status with no neighbor", async () => {
    const fixture = parityFixture("annotation", true);
    fixture.redundancySettings.similarityThreshold = 1.01;
    const publicCollection = projectProfileCollectionSource({
      ...fixture.collection,
      games: fixture.collection.games.map((game) => ({
        ...game,
        ratings: Object.fromEntries(
          Object.entries(game.ratings).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          ),
        ),
      })),
    });
    const source = {
      kind: "public" as const,
      collection: publicCollection,
      tournament: fixture.tournament,
      predictionSettings: fixture.predictionSettings,
      redundancySettings: fixture.redundancySettings,
    };
    const list = await fixture.displayedService.listGames({ includePredicted: false });
    const snapshot = await fixture.snapshotService.getSnapshot();
    const snapshotRows = new Map(snapshot.games.map((row) => [row.game.id, row]));
    const target = list.find((entry) => {
      const row = snapshotRows.get(entry.game.id);
      return (
        entry.game.ownership === "owned" &&
        entry.score !== null &&
        !entry.score.vetoed &&
        entry.score.score > 0 &&
        entry.score.redundancyAdjustment === null &&
        row !== undefined &&
        row.ordinary.score !== null
      );
    });
    if (!target?.score)
      throw new Error("Expected an eligible scored game with no redundancy neighbor");
    const targetInfo = target.score.redundancySimilarityInfo;
    if (!targetInfo) throw new Error("Expected similarity status on the scored list entry");
    const detail = await fixture.displayedService.listGamesFromSnapshot(source, {
      includePredicted: false,
      targetGameIds: [target.game.id],
    });
    const detailEntry = detail.find(({ game }) => game.id === target.game.id);
    const row = snapshotRows.get(target.game.id);
    if (!detailEntry?.score || !row?.ordinary.score) {
      throw new Error("Expected matching scored detail and snapshot entries");
    }
    expect(target.score.redundancyAdjustment).toBeNull();
    expect(detailEntry.score.redundancyAdjustment).toBeNull();
    expect(row.ordinary.score.redundancyAdjustment).toBeNull();
    expect(detailEntry.score.redundancySimilarityInfo).toEqual(targetInfo);
    expect(row.redundancySimilarityInfo).toEqual(targetInfo);
    // The fixture intentionally gives a different, scoreless game a null rating to
    // exercise snapshot projection. Collection/Game validation rejects that shape;
    // project only the valid shared scored game for this public note-leak assertion.
    expect(
      JSON.stringify([projectGameWithScore(target), projectGameWithScore(detailEntry), snapshot]),
    ).not.toContain("ownerNote");
  });

  test("redundancy is reported off when prediction fails and returns after prediction recovery", async () => {
    const fixture = parityFixture("integrated", true);
    const baselineFixture = parityFixture("integrated", false);
    const baseline = await baselineFixture.snapshotService.getSnapshot();
    fixture.failPredictions();
    const degraded = await fixture.snapshotService.getSnapshot();
    expect(degraded.status).toBe("degraded");
    expect(degraded.redundancyMode).toBe("off");
    expect(degraded.unavailableFeatures).toContainEqual({
      feature: "redundancy",
      reason: "Predicted owned universe is unavailable",
    });
    for (const baselineRow of baseline.games) {
      const degradedRow = degraded.games.find((row) => row.game.id === baselineRow.game.id);
      expect(degradedRow?.ordinary.score).toEqual(baselineRow.ordinary.score);
    }

    fixture.recoverPredictions();
    const recovered = await fixture.snapshotService.getSnapshot();
    expect(recovered.status).toBe("complete");
    expect(recovered.redundancyMode).toBe("integrated");
    expect(
      recovered.games.some(
        (row) => row.ordinary.score?.redundancyAdjustment !== null && row.ordinary.score !== null,
      ),
    ).toBe(true);
    expect(
      recovered.games.some((row) => {
        const previous = degraded.games.find((entry) => entry.game.id === row.game.id);
        return previous?.ordinary.score?.score !== row.ordinary.score?.score;
      }),
    ).toBe(true);
  });

  test("projects disabled legacy axes and nullable rating filter inputs", async () => {
    const fixture = parityFixture("annotation", false);
    fixture.collection.axes.push({
      id: "legacy-rating",
      name: "Legacy rating",
      description: null,
      weight: 0,
      enabled: false,
      source: "legacy",
      reason: "legacy source",
      legacyField: "oldScore",
      legacyPayload: { ownerNote: "must not be projected" },
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    const snapshot = await fixture.snapshotService.getSnapshot();
    expect(snapshot.axes.find((axis) => axis.id === "legacy-rating")?.enabled).toBe(false);
    expect(snapshot.axes.find((axis) => axis.id === "legacy-rating")?.source).toBe("legacy");
    expect(snapshot.games.every((row) => !Object.hasOwn(row.game.ratings, "legacy-rating"))).toBe(
      true,
    );
    expect(JSON.stringify(snapshot)).not.toContain("legacyPayload");
    expect(JSON.stringify(snapshot)).not.toContain("ownerNote");
  });

  test("rejects a degraded snapshot when its source vector changes during computation", () => {
    const { service } = setup({ nicheFailure: true, bumpDuringPrediction: true });
    return expect(service.getSnapshot()).rejects.toThrow("changed during computation");
  });

  test("revisioned storage retries an optional failure until it recovers without external publish", async () => {
    const dataDir = "/snapshot-revisioned/data";
    const fileOps = createMockFileOps();
    const initializer = createStorageService({
      dataDir,
      configPath: "/snapshot-revisioned/config.json",
      fileOps,
    });
    if (!initializer.hydrateSourceVector) throw new Error("Source hydration is unavailable");
    await initializer.hydrateSourceVector();
    const storage = createStorageService({
      dataDir,
      configPath: "/snapshot-revisioned/config.json",
      fileOps,
    });
    const nichePath = `${dataDir}/niche-settings.json`;
    const readFile = fileOps.readFile.bind(fileOps);
    let failNicheRead = true;
    fileOps.readFile = (filePath) =>
      filePath === nichePath && failNicheRead
        ? Promise.reject(new Error("transient niche read failure"))
        : readFile(filePath);
    if (!storage.hydrateSourceVector) throw new Error("Source hydration is unavailable");
    let hydrationFailure: unknown;
    try {
      await storage.hydrateSourceVector();
    } catch (error) {
      hydrationFailure = error;
    }
    expect(hydrationFailure).toBeInstanceOf(Error);
    expect((hydrationFailure as Error).message).toContain("transient niche read failure");
    const service = createCollectionSnapshotService({
      storageService: storage,
      gameService: {
        listRawGamesFromSnapshot: () => [],
      } as unknown as GameService,
      predictionService: {
        preparePredictionListFromSnapshot: () => ({ listGames: () => [] }),
      } as unknown as PredictionService,
      purchaseUtilizationService: {
        enrichGames: () => [],
      } as unknown as PurchaseUtilizationService,
    });
    const cache = createCollectionSnapshotCacheService({
      builder: service,
      storageService: storage,
      coordinator: profileSourceCoordinatorFor(storage),
    });
    const route = createCollectionSnapshotRoutes(cache).routes;

    const first = await route.request("/collection/snapshot");
    expect(first.status).toBe(200);
    expect(((await first.json()) as CollectionSnapshot).status).toBe("degraded");
    const second = await route.request("/collection/snapshot");
    expect(second.status).toBe(200);
    expect(((await second.json()) as CollectionSnapshot).status).toBe("degraded");

    failNicheRead = false;
    const recovered = await route.request("/collection/snapshot");
    expect(recovered.status).toBe(200);
    expect(((await recovered.json()) as CollectionSnapshot).status).toBe("complete");
    const recoveredVector = storage.sourceVector?.();
    expect(recoveredVector?.available).toBe(true);
    expect(recoveredVector?.unavailableSources).not.toContain("startup");
    expect(recoveredVector?.unavailableSources).not.toContain("startup-hydration");
    expect(typeof recoveredVector?.collectionId).toBe("string");
    for (const revision of [
      recoveredVector?.collectionRevision,
      recoveredVector?.tournamentRevision,
      recoveredVector?.predictionSettingsRevision,
      recoveredVector?.nicheSettingsRevision,
      recoveredVector?.redundancySettingsRevision,
      recoveredVector?.shelfConfigRevision,
    ]) {
      expect(Number.isSafeInteger(revision)).toBe(true);
    }
    const recoveredToken = recoveredVector?.changeToken;
    const unchanged = await route.request("/collection/snapshot");
    expect(unchanged.status).toBe(200);
    expect(((await unchanged.json()) as CollectionSnapshot).status).toBe("complete");
    expect(storage.sourceVector?.().changeToken).toBe(recoveredToken);
  });
});
