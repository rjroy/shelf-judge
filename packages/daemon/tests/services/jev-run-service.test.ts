import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DurableGame, SemanticRedundancySettings } from "@shelf-judge/shared";
import { createInitialEntityMetadata, DEFAULT_JEV_RUN_BUDGET } from "@shelf-judge/shared";
import {
  JevRunService,
  type JevRunCapture,
  type ValidatedPreparedJevRun,
} from "../../src/services/jev-run-service.js";
import * as jevRunScope from "../../src/services/jev-run-scope.js";
import type {
  JevPairCache,
  JevPairCheckpoint,
  JevPairJudgment,
  JevRunProgress,
} from "../../src/services/jev-pair-cache-service.js";
import { createJevPairCache } from "../../src/services/jev-pair-cache-service.js";
import { computeJevPairCoverage } from "../../src/services/jev-pair-coverage.js";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import { createJevRunSourceAdapter } from "../../src/services/jev-run-source-adapter.js";
import {
  prepareUnifiedJevRun,
  type PreparedUnifiedRun,
} from "../../src/services/unified-jev-run-preparation.js";
import { createSemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import {
  computeRedundancyAdjustments,
  DEFAULT_REDUNDANCY_SETTINGS,
} from "../../src/services/redundancy-engine.js";
import { createRedundancyFactualContext } from "../../src/services/redundancy-factual.js";
import type { RedundancyPairTable } from "../../src/services/redundancy-engine.js";
import {
  profileSourceCoordinatorFor,
  runOutsideProfileSourceCoordinator,
} from "../../src/services/profile-source-coordinator.js";
import {
  createJevGateway,
  JEV_MODEL_ID,
  JevGatewayError,
  type JevPairResult,
} from "../../src/services/jev/jev-gateway.js";
import {
  JEV_JUDGMENT_CONTRACT,
  JEV_QUESTION_VERSION,
  JEV_RUBRIC_VERSION,
} from "../../src/services/jev/jev-judgment-contract.js";
import { createTestApp } from "../helpers/test-app.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

function game(id: string): DurableGame {
  return {
    id,
    bggId: null,
    name: `Game ${id}`,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: {
      communityRating: 5,
      bayesAverage: 5,
      weight: null,
      numWeightVotes: 0,
      description: `desc ${id}`,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: "2026-01-01T00:00:00Z",
    },
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
    ratings: { personal: 6 },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ownerNote: { state: "cleared", version: 1, updatedAt: "2026-01-01T00:00:00Z" },
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function recordingLogger() {
  const records: Array<{ level: string; message: unknown; fields: unknown }> = [];
  return {
    records,
    logger: {
      log: (message: unknown, fields?: unknown) => records.push({ level: "log", message, fields }),
      error: (message: unknown, fields?: unknown) =>
        records.push({ level: "error", message, fields }),
    },
  };
}

function scoreResult(): JevPairResult {
  return {
    description: {
      score: 0.5,
      confidence: null,
      modelId: JEV_JUDGMENT_CONTRACT.modelId,
      rubricVersion: JEV_RUBRIC_VERSION,
      questionVersion: JEV_QUESTION_VERSION,
    },
    ownerNote: null,
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

async function unifiedFixture(
  ids: readonly string[],
  cache: JevPairCache,
  budget: Readonly<typeof DEFAULT_JEV_RUN_BUDGET> = DEFAULT_JEV_RUN_BUDGET,
  fileOps: ReturnType<typeof createMockFileOps> = createMockFileOps(),
) {
  const context = createTestApp({ jevPairCache: cache, fileOps });
  const storage = context.storageService;
  const collection = await storage.loadCollection();
  collection.axes = [
    {
      id: "personal",
      name: "Personal",
      description: null,
      weight: 1,
      enabled: true,
      source: "personal",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  collection.games = ids.map(game);
  collection.semanticRedundancy.settings = {
    ...collection.semanticRedundancy.settings,
    enabled: true,
    cachedOwnerNoteUse: false,
    weights: { factual: 1, description: 1, ownerNote: 0 },
  };
  await storage.saveCollection(collection);
  await storage.saveRedundancySettings({
    ...(await storage.loadRedundancySettings()),
    enabled: true,
    stage: "integrated",
    similarityThreshold: 0,
    minNeighbors: 1,
    expectedNeighbors: 5,
    maxPenalty: 1,
    componentWeights: { binary: 1, continuous: 3 },
  });
  await storage.hydrateSourceVector?.();
  const snapshotPrediction = context.predictionService.listGamesWithPredictionsFromSnapshot?.bind(
    context.predictionService,
  );
  if (!snapshotPrediction) throw new Error("Test prediction service lacks snapshot support");
  const sourceAdapter = createJevRunSourceAdapter({
    storageService: storage,
    predictionService: { listGamesWithPredictionsFromSnapshot: snapshotPrediction },
  });
  const prepare = (selectedBudget = budget) =>
    prepareUnifiedJevRun({
      scoring: context.unifiedScoringService,
      sourceAdapter,
      cache,
      request: { scope: "collection-all" },
      budget: selectedBudget,
    });
  const preparation = await prepare();
  if (!preparation.collectionScope) throw new Error("Expected collection scope");
  return { context, storage, sourceAdapter, preparation, prepare };
}

async function validateUnifiedRunForTest(
  service: JevRunService,
  preparation: PreparedUnifiedRun,
  noteTransmissionAuthorized: boolean,
): Promise<ValidatedPreparedJevRun> {
  if (!preparation.collectionScope) throw new Error("Expected collection scope");
  const reservation = await service.prepareValidatedPreparedRun({
    scopeKind: "collection",
    capture: preparation.capture,
    scope: preparation.collectionScope,
    unifiedPreparation: preparation,
    noteTransmissionAuthorized,
    providerBudget: preparation.run.disclosure.budget,
  });
  if (!reservation) throw new Error("Expected validated unified preparation");
  return reservation;
}

async function reserveUnifiedRunForTest(
  service: JevRunService,
  preparation: PreparedUnifiedRun,
  noteTransmissionAuthorized: boolean,
) {
  const reservation = await validateUnifiedRunForTest(
    service,
    preparation,
    noteTransmissionAuthorized,
  );
  return service.reserveValidatedPreparedRun(reservation);
}

async function runUnifiedForTest(
  service: JevRunService,
  preparation: PreparedUnifiedRun,
  noteTransmissionAuthorized: boolean,
): Promise<JevRunProgress> {
  return (await reserveUnifiedRunForTest(service, preparation, noteTransmissionAuthorized))
    .completion;
}

function cacheFake() {
  const progress: JevRunProgress[] = [];
  const rows = new Map<string, JevPairJudgment>();
  let revision = 0;
  let lookupCalls = 0;
  const cache = {
    available: true,
    mutationRevision: () => revision,
    lookup: (key: { gameAId: string; gameBId: string; signal: string }) => {
      lookupCalls++;
      return rows.get(key.gameAId + key.gameBId + key.signal) ?? null;
    },
    upsert: () => {
      revision++;
    },
    purgePair: (a: string, b: string, signal?: string) => {
      revision++;
      for (const key of rows.keys())
        if (key.startsWith(a + b) && (!signal || key.endsWith(signal))) rows.delete(key);
      return 0;
    },
    purgeGame: () => 0,
    invalidateGame: () => 0,
    purgeDDependent: () => 0,
    saveRunProgress: (p: JevRunProgress) => progress.push({ ...p }),
    checkpointPair: ({ judgments, progress: p }: JevPairCheckpoint) => {
      for (const row of judgments) rows.set(row.gameAId + row.gameBId + row.signal, row);
      revision++;
      progress.push({ ...p });
    },
    finishRun: ({ progress: p }: { progress: JevRunProgress }) => progress.push({ ...p }),
    getRunProgress: () => progress.at(-1) ?? null,
    setActivation: () => {},
    getActivation: () => null,
    compact: () => {},
    reset: () => {},
    close: () => {},
  } as unknown as JevPairCache;
  return {
    cache,
    progress,
    rows,
    resetLookupCalls: () => {
      lookupCalls = 0;
    },
    get lookupCalls() {
      return lookupCalls;
    },
  };
}

describe("JevRunService attempt barriers", () => {
  test("builds one collection lookup across dispatches and checkpoints", async () => {
    const cacheFixture = cacheFake();
    const { cache } = cacheFixture;
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    cacheFixture.resetLookupCalls();
    let checkpoints = 0;
    const originalCheckpointPair = cache.checkpointPair.bind(cache);
    cache.checkpointPair = (checkpoint) => {
      checkpoints++;
      originalCheckpointPair(checkpoint);
    };
    const collectionLookupSpy = spyOn(jevRunScope, "createJevRunCollectionLookup");
    let lookupBuildsBeforeFinalCoverage: number | undefined;
    let dispatches = 0;
    let lookupsAtLastDispatch = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: async () => {
        lookupBuildsBeforeFinalCoverage = collectionLookupSpy.mock.calls.length;
        collectionLookupSpy.mockRestore();
        return fixtureData.sourceAdapter.loadCapture();
      },
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: `structural-${dispatches}`,
            start: () => {
              lookupsAtLastDispatch = cacheFixture.lookupCalls;
              dispatches++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          return scoreResult();
        },
      }),
    });

    try {
      const result = await runUnifiedForTest(service, fixtureData.preparation, false);
      expect(result).toMatchObject({ state: "completed", completedPairs: 3 });
      expect(dispatches).toBe(3);
      expect(checkpoints).toBe(3);
      expect(lookupBuildsBeforeFinalCoverage).toBe(1);
      // The final dispatch observes only run-time cache reads; preparation and final coverage are excluded.
      expect(lookupsAtLastDispatch).toBe(3);
    } finally {
      collectionLookupSpy.mockRestore();
    }
  });

  test("one-attempt budget stops the 200-game universe after its first checkpoint", async () => {
    const ids = Array.from({ length: 200 }, (_, index) => `game-${String(index).padStart(3, "0")}`);
    const { cache, rows } = cacheFake();
    const budget = {
      maxProviderAttempts: 1,
      reportedTokenStopThreshold: 100_000,
      maxRunDurationMs: 60_000,
    };
    const fixtureData = await unifiedFixture(ids, cache, budget);
    let transportCalls = 0;
    let gatewayConstructions = 0;
    let checkpoints = 0;
    const originalCheckpointPair = cache.checkpointPair.bind(cache);
    cache.checkpointPair = (checkpoint) => {
      checkpoints++;
      originalCheckpointPair(checkpoint);
    };
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admitAndDispatch, providerBudget) => {
        gatewayConstructions++;
        return createJevGateway({
          apiKey: "fake-test-key",
          maxRequests: providerBudget.maxProviderAttempts,
          maxReportedTokens: providerBudget.reportedTokenStopThreshold,
          wait: async () => {},
          admitAndDispatch,
          fetch: () => {
            transportCalls++;
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  model: JEV_MODEL_ID,
                  answers: {
                    description_similarity: {
                      type: "score",
                      score: 2,
                      legend: { "0": "Low", "1": "Some", "2": "High", "3": "Very high" },
                      probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
                      confidence: 0.5,
                    },
                  },
                  usage: { input_tokens: 4, output_tokens: 2 },
                }),
                { status: 200 },
              ),
            );
          },
        });
      },
    });

    expect(service.effectiveLimits.maxEligiblePairs).toBeGreaterThanOrEqual(19_900);
    const scope = fixtureData.preparation.collectionScope;
    if (!scope) throw new Error("Expected unified collection scope");
    expect(scope.totalEligiblePairs).toBe(19_900);
    expect(rows.size).toBe(0);
    const progress = await runUnifiedForTest(service, fixtureData.preparation, false);
    expect(progress).toMatchObject({
      state: "failed",
      pairCount: 19_900,
      completedPairs: 2,
      cacheMisses: 2,
      failedPairs: 1,
      stopReason: "application-attempt-limit",
    });
    expect(gatewayConstructions).toBe(1);
    expect(transportCalls).toBe(1);
    expect(checkpoints).toBe(1);
    expect(rows.size).toBe(1);
  });

  test("gateway request-budget exhaustion preserves checkpoints and stops later pairs", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    let transportCalls = 0;
    const logs = recordingLogger();
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admitAndDispatch) =>
        createJevGateway({
          apiKey: "fake-test-key",
          maxRequests: 2,
          wait: async () => {},
          admitAndDispatch,
          fetch: async () => {
            await Promise.resolve();
            transportCalls++;
            if (transportCalls === 2) return new Response("", { status: 429 });
            return new Response(
              JSON.stringify({
                model: JEV_MODEL_ID,
                answers: {
                  description_similarity: {
                    type: "score",
                    score: 2,
                    legend: { "0": "Low", "1": "Some", "2": "High", "3": "Very high" },
                    probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
                    confidence: 0.5,
                  },
                },
                usage: { input_tokens: 4, output_tokens: 2 },
              }),
              { status: 200 },
            );
          },
        }),
      logger: logs.logger,
    });

    const progress = await runUnifiedForTest(service, fixtureData.preparation, false);
    expect(transportCalls).toBe(2);
    expect(progress.cacheMisses).toBe(2);
    expect(rows.size).toBe(1);
    expect(progress).toMatchObject({
      state: "failed",
      pairCount: 3,
      completedPairs: 2,
      failedPairs: 1,
      stopReason: "application-attempt-limit",
    });
    const startEvents = logs.records.filter((record) => record.message === "Jev run started");
    const terminalEvents = logs.records.filter((record) => record.message === "Jev run terminal");
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]?.fields).toMatchObject({
      trigger: "owner-explicit",
      authorizedSignalScope: "no",
      maxProviderAttempts: DEFAULT_JEV_RUN_BUDGET.maxProviderAttempts,
      reportedTokenStopThreshold: DEFAULT_JEV_RUN_BUDGET.reportedTokenStopThreshold,
      maxRunDurationMs: 1_800_000,
      eligiblePairs: 3,
    });
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.fields).toMatchObject({
      state: "failed",
      stopReason: "application-attempt-limit",
      completedPairs: 2,
      failedPairs: 1,
      cacheHits: 0,
    });
    expect(JSON.stringify(logs.records)).not.toContain("Game a");
  });

  test("selected attempt budget above the former default reaches the transport", async () => {
    const ids = Array.from({ length: 15 }, (_, index) => `game-${index}`);
    const { cache, rows } = cacheFake();
    const budget = {
      maxProviderAttempts: 101,
      reportedTokenStopThreshold: 100_000,
      maxRunDurationMs: 60_000,
    };
    const fixtureData = await unifiedFixture(ids, cache, budget);
    let transportCalls = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admitAndDispatch, budget) =>
        createJevGateway({
          apiKey: "fake-test-key",
          maxRequests: budget.maxProviderAttempts,
          maxReportedTokens: budget.reportedTokenStopThreshold,
          wait: async () => {},
          admitAndDispatch,
          fetch: async () => {
            await Promise.resolve();
            transportCalls++;
            return new Response(
              JSON.stringify({
                model: JEV_MODEL_ID,
                answers: {
                  description_similarity: {
                    type: "score",
                    score: 2,
                    legend: { "0": "Low", "1": "Some", "2": "High", "3": "Very high" },
                    probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
                    confidence: 0.5,
                  },
                },
                usage: { input_tokens: 4, output_tokens: 2 },
              }),
              { status: 200 },
            );
          },
        }),
    });
    const progress = await runUnifiedForTest(service, fixtureData.preparation, false);

    expect(transportCalls).toBe(101);
    expect(rows.size).toBe(101);
    expect(progress).toMatchObject({
      state: "failed",
      pairCount: 105,
      completedPairs: 102,
      cacheMisses: 102,
      failedPairs: 1,
      stopReason: "application-attempt-limit",
    });
  });

  test("a threshold-crossing provider response is checkpointed before the run stops", async () => {
    const { cache, rows } = cacheFake();
    const budget = {
      maxProviderAttempts: 10,
      reportedTokenStopThreshold: 5,
      maxRunDurationMs: 60_000,
    };
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache, budget);
    let transportCalls = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admitAndDispatch, budget) =>
        createJevGateway({
          apiKey: "fake-test-key",
          maxRequests: budget.maxProviderAttempts,
          maxReportedTokens: budget.reportedTokenStopThreshold,
          admitAndDispatch,
          fetch: async () => {
            await Promise.resolve();
            transportCalls++;
            return new Response(
              JSON.stringify({
                model: JEV_MODEL_ID,
                answers: {
                  description_similarity: {
                    type: "score",
                    score: 2,
                    legend: { "0": "Low", "1": "Some", "2": "High", "3": "Very high" },
                    probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
                    confidence: 0.5,
                  },
                },
                usage: { input_tokens: 3, output_tokens: 3 },
              }),
              { status: 200 },
            );
          },
        }),
    });
    const progress = await runUnifiedForTest(service, fixtureData.preparation, false);

    expect(transportCalls).toBe(1);
    expect(rows.size).toBe(1);
    expect(progress).toMatchObject({
      state: "failed",
      completedPairs: 1,
      failedPairs: 0,
      stopReason: "application-token-threshold",
    });
  });

  test("the selected duration deadline is enforced at the exact boundary", async () => {
    const { cache } = cacheFake();
    const budget = {
      maxProviderAttempts: 100,
      reportedTokenStopThreshold: 200_000,
      maxRunDurationMs: 60_000,
    };
    const fixtureData = await unifiedFixture(["a", "b"], cache, budget);
    let clock = 1_000;
    let gatewayConstructions = 0;
    const logs = recordingLogger();
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => {
        clock += 60_000;
        return fixtureData.sourceAdapter.readCurrent();
      },
      createGateway: () => {
        gatewayConstructions++;
        return { evaluatePair: () => Promise.resolve(scoreResult()) };
      },
      now: () => new Date(clock),
      logger: logs.logger,
    });
    const progress = await runUnifiedForTest(service, fixtureData.preparation, false);

    expect(gatewayConstructions).toBe(0);
    expect(progress).toMatchObject({ state: "failed", stopReason: "application-deadline" });
    expect(logs.records.filter((record) => record.message === "Jev run started")).toHaveLength(1);
    const terminalEvents = logs.records.filter((record) => record.message === "Jev run terminal");
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.fields).toMatchObject({
      state: "failed",
      stopReason: "application-deadline",
    });
  });

  test("owner cancellation settles before a pending provider response and fences late completion", async () => {
    const { cache, progress, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const pendingProvider = deferred<JevPairResult>();
    const providerStarted = deferred<void>();
    let dispatches = 0;
    let pendingFirstProvider = true;
    const logs = recordingLogger();
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          await admit({
            mode: request.mode,
            attemptId: `provider-${dispatches + 1}`,
            start: () => {
              dispatches++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          if (pendingFirstProvider) {
            pendingFirstProvider = false;
            providerStarted.resolve();
            return pendingProvider.promise;
          }
          return scoreResult();
        },
      }),
      logger: logs.logger,
    });
    const firstPreparation = fixtureData.preparation;
    const firstReservation = await validateUnifiedRunForTest(service, firstPreparation, false);
    const canceled = service.reserveValidatedPreparedRun(firstReservation);
    await providerStarted.promise;
    canceled.cancel();
    const canceledProgress = await canceled.completion;
    expect(canceledProgress).toMatchObject({ state: "interrupted" });

    const replacementPreparation = await fixtureData.prepare();
    const replacement = await reserveUnifiedRunForTest(service, replacementPreparation, false);
    const replacementProgress = await replacement.completion;
    expect(replacementProgress).toMatchObject({ state: "completed" });
    pendingProvider.reject(new Error("PRIVATE_PROVIDER_CANARY"));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(dispatches).toBe(2);
    expect(rows.size).toBe(1);
    expect(progress.at(-1)).toMatchObject({ runId: replacement.runId, state: "completed" });
    const firstRunRecords = logs.records.filter((record) =>
      JSON.stringify(record).includes(canceled.runId),
    );
    expect(firstRunRecords.filter((record) => record.message === "Jev run started")).toHaveLength(
      1,
    );
    expect(firstRunRecords.filter((record) => record.message === "Jev run terminal")).toHaveLength(
      1,
    );
    expect(JSON.stringify(logs.records)).not.toContain("PRIVATE_PROVIDER_CANARY");
  });

  test("terminal completion settles fail-closed when terminal progress persistence fails", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const pendingProvider = deferred<JevPairResult>();
    const providerStarted = deferred<void>();
    const logs = recordingLogger();
    cache.finishRun = () => {
      throw new Error("simulated terminal persistence failure");
    };
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          await admit({
            mode: request.mode,
            attemptId: "terminal-persistence",
            start: () => ({ response: Promise.resolve(new Response()) }),
          });
          providerStarted.resolve();
          return pendingProvider.promise;
        },
      }),
      logger: logs.logger,
    });
    const reservation = await validateUnifiedRunForTest(service, fixtureData.preparation, false);
    const handle = service.reserveValidatedPreparedRun(reservation);
    await providerStarted.promise;
    handle.cancel();
    expect(await handle.completion).toMatchObject({ state: "interrupted" });
    pendingProvider.reject(new Error("late provider rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const terminalEvents = logs.records.filter((record) => record.message === "Jev run terminal");
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.fields).toMatchObject({
      persistenceFailureReason: "terminal-status-persistence-failed",
    });
    expect(JSON.stringify(logs.records)).not.toContain("simulated terminal persistence failure");
    expect(JSON.stringify(logs.records)).not.toContain("late provider rejection");
  });

  test("throwing lifecycle logger cannot strand cancellation or a later Run", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const pendingProvider = deferred<JevPairResult>();
    const providerStarted = deferred<void>();
    let pendingFirstProvider = true;
    const throwingLogger = {
      log() {
        throw new Error("private logger canary");
      },
      error() {
        throw new Error("private logger canary");
      },
    };
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          await admit({
            mode: request.mode,
            attemptId: "throwing-logger",
            start: () => ({ response: Promise.resolve(new Response()) }),
          });
          if (pendingFirstProvider) {
            pendingFirstProvider = false;
            providerStarted.resolve();
            return pendingProvider.promise;
          }
          return scoreResult();
        },
      }),
      logger: throwingLogger,
    });

    const reservation = await validateUnifiedRunForTest(service, fixtureData.preparation, false);
    const canceled = service.reserveValidatedPreparedRun(reservation);
    await providerStarted.promise;
    canceled.cancel();
    expect(await canceled.completion).toMatchObject({ state: "interrupted" });

    const nextPreparation = await fixtureData.prepare();
    const next = await reserveUnifiedRunForTest(service, nextPreparation, false);
    expect(await next.completion).toMatchObject({ runId: next.runId, state: "completed" });
    pendingProvider.reject(new Error("late provider rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  test("throwing terminal logger cannot strand deadline completion or the next Run", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache, {
      maxProviderAttempts: 10,
      reportedTokenStopThreshold: 100_000,
      maxRunDurationMs: 60_000,
    });
    let clock = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => {
        clock += 60_000;
        return fixtureData.sourceAdapter.readCurrent();
      },
      createGateway: () => {
        throw new Error("Deadline must stop before gateway construction");
      },
      now: () => new Date(clock),
      logger: {
        log() {
          throw new Error("private logger canary");
        },
        error() {
          throw new Error("private logger canary");
        },
      },
    });

    const expired = await reserveUnifiedRunForTest(service, fixtureData.preparation, false);
    expect(await expired.completion).toMatchObject({
      runId: expired.runId,
      state: "failed",
      stopReason: "application-deadline",
    });

    const nextPreparation = await fixtureData.prepare();
    const next = await reserveUnifiedRunForTest(service, nextPreparation, false);
    expect(await next.completion).toMatchObject({
      runId: next.runId,
      state: "failed",
      stopReason: "application-deadline",
    });
  });

  test("retained cancellation for completed run A cannot overwrite run B progress", async () => {
    const { cache, progress } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const queuedRead = deferred<void>();
    const releaseRead = deferred<void>();
    let armReadBarrierForNextRun = false;
    let blockNextRead = false;
    let evaluationCount = 0;
    let attemptStarts = 0;
    const originalSaveRunProgress = cache.saveRunProgress.bind(cache);
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: async () => {
        const current = await fixtureData.sourceAdapter.readCurrent();
        if (blockNextRead) {
          blockNextRead = false;
          queuedRead.resolve();
          await releaseRead.promise;
        }
        return current;
      },
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          evaluationCount++;
          await admit({
            mode: request.mode,
            attemptId: `run-${evaluationCount}`,
            start: () => {
              attemptStarts++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          return evaluationCount === 1
            ? Promise.reject(new JevGatewayError("http-failure", "fake failure"))
            : scoreResult();
        },
      }),
    });
    cache.saveRunProgress = (nextProgress) => {
      originalSaveRunProgress(nextProgress);
      if (armReadBarrierForNextRun && nextProgress.state === "running") {
        armReadBarrierForNextRun = false;
        blockNextRead = true;
      }
    };
    const runA = await reserveUnifiedRunForTest(service, fixtureData.preparation, false);
    expect(await runA.completion).toMatchObject({ state: "failed" });

    const preparationB = await fixtureData.prepare();
    const reservationB = await validateUnifiedRunForTest(service, preparationB, false);
    armReadBarrierForNextRun = true;
    const runB = service.reserveValidatedPreparedRun(reservationB);
    await queuedRead.promise;
    expect(progress.at(-1)).toMatchObject({ runId: runB.runId, state: "running" });
    const writesBeforeRetainedCancel = progress.length;
    runA.cancel();
    expect(progress).toHaveLength(writesBeforeRetainedCancel);
    expect(progress.at(-1)).toMatchObject({ runId: runB.runId, state: "running" });

    releaseRead.resolve();
    expect(await runB.completion).toMatchObject({ runId: runB.runId, state: "completed" });
    expect(attemptStarts).toBe(2);
  });

  test("a canceled run queued behind another coordinator operation skips its source read", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const coordinator = profileSourceCoordinatorFor(fixtureData.storage);
    let sourceReads = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => {
        sourceReads++;
        return fixtureData.sourceAdapter.readCurrent();
      },
      createGateway: () => {
        throw new Error("Canceled queued run must not construct a gateway");
      },
    });
    const reservation = await validateUnifiedRunForTest(service, fixtureData.preparation, false);
    const blockerStarted = deferred<void>();
    const releaseBlocker = deferred<void>();
    const blocker = coordinator.runExclusive(async () => {
      blockerStarted.resolve();
      await releaseBlocker.promise;
    });
    await blockerStarted.promise;
    const handle = service.reserveValidatedPreparedRun(reservation);
    await new Promise<void>((resolve) => setImmediate(resolve));
    handle.cancel();
    expect(await handle.completion).toMatchObject({ state: "interrupted" });
    releaseBlocker.resolve();
    await blocker;
    let queueProceeded = false;
    await coordinator.runExclusive(() => {
      queueProceeded = true;
      return Promise.resolve();
    });

    expect(sourceReads).toBe(0);
    expect(queueProceeded).toBe(true);
  });

  test("known application-attempt failure does not wait for another source read", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache, {
      maxProviderAttempts: 1,
      reportedTokenStopThreshold: 100_000,
      maxRunDurationMs: 60_000,
    });
    let evaluations = 0;
    let attemptStarts = 0;
    let attemptLimitReached = false;
    let readCountAfterFailure = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => {
        if (attemptLimitReached) {
          readCountAfterFailure++;
          return Promise.resolve(fixtureData.sourceAdapter.readCurrent());
        }
        return fixtureData.sourceAdapter.readCurrent();
      },
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          evaluations++;
          if (evaluations === 1) {
            await admit({
              mode: request.mode,
              attemptId: "before-limit",
              start: () => {
                attemptStarts++;
                return { response: Promise.resolve(new Response()) };
              },
            });
            return scoreResult();
          }
          attemptLimitReached = true;
          return Promise.reject(
            new JevGatewayError("attempt-limit-exhausted", "application attempt limit"),
          );
        },
      }),
    });

    const progress = await runUnifiedForTest(service, fixtureData.preparation, false);
    expect(progress).toMatchObject({ state: "failed", stopReason: "application-attempt-limit" });
    expect(attemptStarts).toBe(1);
    expect(readCountAfterFailure).toBe(0);
  });

  test("deadline settles independently of a blocked coordinated read and blocks its late callback", async () => {
    const { cache, progress } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache, {
      maxProviderAttempts: 10,
      reportedTokenStopThreshold: 100_000,
      maxRunDurationMs: 60_000,
    });
    const readEntered = deferred<void>();
    const pendingRead =
      deferred<Awaited<ReturnType<typeof fixtureData.sourceAdapter.readCurrent>>>();
    let blockExecutionRead = false;
    let dispatches = 0;
    const releaseReadValue = await fixtureData.sourceAdapter.readCurrent();
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: async () => {
        const current = await fixtureData.sourceAdapter.readCurrent();
        if (blockExecutionRead) {
          blockExecutionRead = false;
          readEntered.resolve();
          return pendingRead.promise;
        }
        return current;
      },
      createGateway: (admit) => {
        dispatches++;
        return {
          evaluatePair: async (request) => {
            await admit({
              mode: request.mode,
              attemptId: "blocked-read-late-callback",
              start: () => ({ response: Promise.resolve(new Response()) }),
            });
            return scoreResult();
          },
        };
      },
    });
    const reservation = await validateUnifiedRunForTest(service, fixtureData.preparation, false);
    blockExecutionRead = true;
    const timed = service.reserveValidatedPreparedRun(reservation);
    await readEntered.promise;
    const terminal = await timed.completion;
    expect(terminal).toMatchObject({ state: "failed", stopReason: "application-deadline" });

    pendingRead.resolve(releaseReadValue);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(dispatches).toBe(0);
    expect(progress.at(-1)).toMatchObject({ runId: timed.runId, state: "failed" });
  }, 70_000);

  test("cancellation releases logical activity while a coordinated read drains without stale writes", async () => {
    const { cache, progress, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const readEntered = deferred<void>();
    const pendingRead =
      deferred<Awaited<ReturnType<typeof fixtureData.sourceAdapter.readCurrent>>>();
    let blockExecutionRead = false;
    let dispatches = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: async () => {
        const current = await fixtureData.sourceAdapter.readCurrent();
        if (blockExecutionRead) {
          blockExecutionRead = false;
          readEntered.resolve();
          return pendingRead.promise;
        }
        return current;
      },
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          await admit({
            mode: request.mode,
            attemptId: "replacement-after-cancel",
            start: () => {
              dispatches++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          return scoreResult();
        },
      }),
    });
    const canceledReservation = await validateUnifiedRunForTest(
      service,
      fixtureData.preparation,
      false,
    );
    const replacementPreparation = await fixtureData.prepare();
    const replacementReservation = await validateUnifiedRunForTest(
      service,
      replacementPreparation,
      false,
    );
    const releaseReadValue = await fixtureData.sourceAdapter.readCurrent();
    blockExecutionRead = true;
    const canceled = service.reserveValidatedPreparedRun(canceledReservation);
    await readEntered.promise;
    canceled.cancel();
    expect(await canceled.completion).toMatchObject({ state: "interrupted" });

    const replacement = service.reserveValidatedPreparedRun(replacementReservation);
    pendingRead.resolve(releaseReadValue);
    const replacementProgress = await replacement.completion;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(replacementProgress).toMatchObject({ runId: replacement.runId, state: "completed" });
    expect(dispatches).toBe(1);
    expect(rows.size).toBe(1);
    expect(progress.at(-1)).toMatchObject({ runId: replacement.runId, state: "completed" });
  });

  test("not-configured is terminal instead of failing every remaining pair", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    let transportCalls = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admitAndDispatch, budget) =>
        createJevGateway({
          apiKey: "",
          maxRequests: budget.maxProviderAttempts,
          maxReportedTokens: budget.reportedTokenStopThreshold,
          wait: async () => {},
          admitAndDispatch,
          fetch: () => {
            transportCalls++;
            return Promise.resolve(new Response());
          },
        }),
    });

    const progress = await runUnifiedForTest(service, fixtureData.preparation, false);
    expect(progress.completedPairs).toBe(1);
    expect(transportCalls).toBe(0);
    expect(progress).toMatchObject({
      state: "failed",
      pairCount: 3,
      completedPairs: 1,
      failedPairs: 1,
      stopReason: "provider-unconfigured",
    });
  });

  test("ordinary gateway failures remain pair-local and have no provider stop reason", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    let evaluations = 0;
    let attemptStarts = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          evaluations++;
          await admit({
            mode: request.mode,
            attemptId: `ordinary-failure-${evaluations}`,
            start: () => {
              attemptStarts++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          return Promise.reject(new JevGatewayError("http-failure", "Temporary fake failure"));
        },
      }),
    });

    const progress = await runUnifiedForTest(service, fixtureData.preparation, false);
    expect(evaluations).toBe(3);
    expect(attemptStarts).toBe(3);
    expect(progress.state).toBe("failed");
    expect(progress.failedPairs).toBe(3);
    expect(progress.stopReason).toBeUndefined();
  });

  test("logs safe continue disposition after an invalid provider response and processes later pairs", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    const collection = await fixtureData.storage.loadCollection();
    collection.games = collection.games.map((entry) => ({
      ...entry,
      name: "PRIVATE_PAIR_NAME_SENTINEL",
      bggData: entry.bggData ? { ...entry.bggData, description: "PRIVATE_SOURCE_SENTINEL" } : null,
    }));
    await fixtureData.storage.saveCollection(collection);
    await fixtureData.storage.hydrateSourceVector?.();
    const preparation = await fixtureData.prepare();
    const logEntries: unknown[][] = [];
    let evaluations = 0;
    let attemptStarts = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      logger: {
        log: (...args) => logEntries.push(args),
        error: (...args) => logEntries.push(args),
      },
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          evaluations++;
          await admit({
            mode: request.mode,
            attemptId: `invalid-then-continue-${evaluations}`,
            start: () => {
              attemptStarts++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          if (evaluations === 1)
            throw new JevGatewayError("response-invalid", "Malformed synthetic provider result");
          return scoreResult();
        },
      }),
    });

    const progress = await runUnifiedForTest(service, preparation, false);
    expect(progress).toMatchObject({
      state: "failed",
      pairCount: 3,
      completedPairs: 3,
      failedPairs: 1,
    });
    expect(evaluations).toBe(3);
    expect(attemptStarts).toBe(3);
    const pairFailure = logEntries.find(([message]) => message === "Jev pair outcome");
    expect(pairFailure?.[1]).toEqual({
      outcome: "pair-failed",
      disposition: "continue",
      reason: "response-invalid",
    });
    const serializedLogs = JSON.stringify(logEntries);
    expect(serializedLogs).not.toContain("PRIVATE_PAIR_NAME_SENTINEL");
    expect(serializedLogs).not.toContain("PRIVATE_SOURCE_SENTINEL");
    expect(serializedLogs).not.toContain("gameAId");
    expect(serializedLogs).not.toContain("gameBId");
  });

  test("each retry re-enters the coordinator and starts only after admission", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    let attempts = 0;
    let starts = 0;
    let currentReads = 0;
    const readsAtStart: number[] = [];
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => {
        currentReads++;
        return fixtureData.sourceAdapter.readCurrent();
      },
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          for (let i = 0; i < 2; i++) {
            await admit({
              mode: request.mode,
              attemptId: `attempt-${i}`,
              start: () => {
                starts++;
                readsAtStart.push(currentReads);
                return { response: Promise.resolve(new Response()) };
              },
            });
            attempts++;
          }
          return scoreResult();
        },
      }),
    });
    const done = await runUnifiedForTest(service, fixtureData.preparation, false);
    expect(attempts).toBe(2);
    expect(starts).toBe(2);
    expect(readsAtStart).toHaveLength(2);
    expect(readsAtStart[1]).toBeGreaterThan(readsAtStart[0] ?? -1);
    expect(done.completedPairs).toBe(1);
    expect(rows.size).toBe(1);
  });

  test("cancellation at the retry barrier prevents the next dispatch and checkpoint", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    let cancel = () => {};
    let starts = 0;
    let admissionCount = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: "one",
            start: () => {
              starts++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          admissionCount++;
          cancel();
          try {
            await admit({
              mode: "description-only",
              attemptId: "retry",
              start: () => {
                starts++;
                return { response: Promise.resolve(new Response()) };
              },
            });
          } catch {
            admissionCount++;
          }
          return scoreResult();
        },
      }),
    });
    const reservation = await validateUnifiedRunForTest(service, fixtureData.preparation, false);
    const handle = service.reserveValidatedPreparedRun(reservation);
    cancel = () => handle.cancel();
    const done = await handle.completion;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(starts).toBe(1);
    expect(admissionCount).toBe(2);
    expect(rows.size).toBe(0);
    expect(done.state).toBe("interrupted");
    expect(done.stopReason).toBeUndefined();
  });

  test("real SQLite cache checkpoints a complete run and activates only complete coverage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-service-"));
    const cache = await createJevPairCache(dir);
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    let dispatches = 0;
    try {
      const service = new JevRunService({
        storageService: fixtureData.storage,
        cache,
        loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
        readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "sqlite-attempt",
              start: () => {
                dispatches++;
                return { response: Promise.resolve(new Response()) };
              },
            });
            return scoreResult();
          },
        }),
      });
      const result = await runUnifiedForTest(service, fixtureData.preparation, false);
      expect(dispatches).toBe(1);
      expect(result.state).toBe("completed");
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })?.value).toBe(0.5);
      expect(cache.getActivation()).not.toBeNull();
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each([
    {
      kind: "C_ONLY",
      before: { factual: 7, description: 1, ownerNote: 0 },
      after: { factual: 3, description: 4, ownerNote: 0 },
    },
    {
      kind: "D_ONLY",
      before: { factual: 7, description: 0, ownerNote: 1 },
      after: { factual: 3, description: 0, ownerNote: 4 },
    },
    {
      kind: "SHARED_CD",
      before: { factual: 7, description: 1, ownerNote: 1 },
      after: { factual: 3, description: 4, ownerNote: 2 },
    },
  ] as const)(
    "weight-only changes preserve $kind cache rows for explicit Runs",
    async ({ kind, before, after }) => {
      const dir = await mkdtemp(join(tmpdir(), "jev-run-weight-cache-"));
      const cache = await createJevPairCache(dir);
      const fixtureData = await unifiedFixture(["a", "b"], cache);
      const storageService = fixtureData.storage;
      const collection = await storageService.loadCollection();
      collection.games = collection.games.map((entry, index) => ({
        ...entry,
        ownerNote: {
          state: "present",
          version: 1,
          updatedAt: "2026-01-01T00:00:00Z",
          text: `private note ${index}`,
        },
      }));
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        weights: before,
        cachedOwnerNoteUse: true,
      };
      await storageService.saveCollection(collection);
      await storageService.hydrateSourceVector?.();
      const mutations = createCollectionMutationService({
        storageService,
        jevPairCache: cache,
      });
      const semanticState = createSemanticRedundancyStateService({
        collectionMutationService: mutations,
      });
      let providerCalls = 0;
      const service = new JevRunService({
        storageService,
        cache,
        loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
        readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async (request) => {
            const requestMode = request.mode;
            await admit({
              mode: requestMode,
              attemptId: `weight-cache-${kind}`,
              start: () => {
                providerCalls++;
                return { response: Promise.resolve(new Response()) };
              },
            });
            const score = {
              score: requestMode === "owner-notes-only" ? 0.8 : 0.4,
              confidence: null,
              modelId: JEV_JUDGMENT_CONTRACT.modelId,
              rubricVersion: JEV_RUBRIC_VERSION,
              questionVersion: JEV_QUESTION_VERSION,
            };
            return {
              description: requestMode === "owner-notes-only" ? null : score,
              ownerNote: requestMode === "description-only" ? null : score,
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        }),
      });

      try {
        const firstPreparation = await fixtureData.prepare();
        const first = await runUnifiedForTest(service, firstPreparation, true);
        expect(first.state).toBe("completed");
        expect(providerCalls).toBe(1);
        const cRow = cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" });
        const dRow = cache.lookup({ gameAId: "a", gameBId: "b", signal: "D" });
        expect(cRow?.dependencyKind).toBe(
          kind === "C_ONLY" ? "C_ONLY" : kind === "SHARED_CD" ? "SHARED_CD" : undefined,
        );
        expect(dRow?.dependencyKind).toBe(
          kind === "D_ONLY" ? "D_ONLY" : kind === "SHARED_CD" ? "SHARED_CD" : undefined,
        );
        const firstCapture = firstPreparation.capture;
        let stored = await storageService.loadCollection();
        const cachedOwnerNoteEpoch = stored.semanticRedundancy.ownerNoteConsentEpoch;
        const initialIdentity = computeJevPairCoverage({
          collection: firstCapture.collection,
          predictionCapture: firstCapture.predictionCapture,
          captureIdentity: firstCapture.captureIdentity,
          factualWeights: firstCapture.factualWeights,
          cache,
        }).identity;

        const updateWeights = async (weights: SemanticRedundancySettings["weights"]) => {
          const current = (await storageService.loadCollection()).semanticRedundancy;
          const result = await semanticState.updateSettings(
            { evidenceEpoch: current.evidenceEpoch, consentEpoch: current.consentEpoch },
            { ...current.settings, weights },
          );
          expect(result.outcome).toBe("accepted");
          await storageService.hydrateSourceVector?.();
        };
        await updateWeights({ factual: 3, description: 0, ownerNote: 0 });
        const zeroPreparation = await fixtureData.prepare();
        const zeroRun = await runUnifiedForTest(service, zeroPreparation, true);
        expect(zeroRun.state).toBe("completed");
        expect(providerCalls).toBe(1);

        await updateWeights(after);
        const finalPreparation = await fixtureData.prepare();
        const finalRun = await runUnifiedForTest(service, finalPreparation, true);
        expect(finalRun.state).toBe("completed");
        expect(finalRun.cacheHits).toBe(1);
        expect(providerCalls).toBe(1);
        stored = await storageService.loadCollection();
        expect(stored.semanticRedundancy.ownerNoteConsentEpoch).toBe(cachedOwnerNoteEpoch);

        const freshCoverage = computeJevPairCoverage({
          collection: finalPreparation.capture.collection,
          predictionCapture: finalPreparation.capture.predictionCapture,
          captureIdentity: finalPreparation.capture.captureIdentity,
          factualWeights: finalPreparation.capture.factualWeights,
          cache,
        });
        expect(freshCoverage.identity).not.toBe(initialIdentity);
        expect(freshCoverage.pairs[0]?.C).toMatchObject({
          state: after.description > 0 ? "covered" : "unavailable",
        });
        expect(freshCoverage.pairs[0]?.D).toMatchObject({
          state: after.ownerNote > 0 ? "covered" : "unavailable",
        });
        if (after.description > 0) expect(freshCoverage.pairs[0]?.C).toMatchObject({ score: 0.4 });
        if (after.ownerNote > 0)
          expect(freshCoverage.pairs[0]?.D).toMatchObject({ score: kind === "D_ONLY" ? 0.8 : 0.4 });
        const currentPair = freshCoverage.pairs[0];
        if (!currentPair) throw new Error("Expected one fresh coverage pair");
        const table: RedundancyPairTable = {
          status: "ready",
          identity: { generationId: "fresh", consentEpoch: "current", settingsEpoch: "current" },
          expectedIdentity: {
            generationId: "fresh",
            consentEpoch: "current",
            settingsEpoch: "current",
          },
          weights: stored.semanticRedundancy.settings.weights,
          pairs: [
            {
              gameAId: currentPair.gameAId,
              gameBId: currentPair.gameBId,
              factual: currentPair.factualScore,
              description: currentPair.C.state === "covered" ? currentPair.C.score : null,
              ownerNote: currentPair.D.state === "covered" ? currentPair.D.score : null,
            },
          ],
        };
        const factualContext = createRedundancyFactualContext(
          finalPreparation.capture.collection.games,
          finalPreparation.capture.factualWeights,
        );
        const freshScores = computeRedundancyAdjustments(
          [...finalPreparation.capture.predictionCapture],
          {
            ...DEFAULT_REDUNDANCY_SETTINGS,
            enabled: true,
            similarityThreshold: 0,
            minNeighbors: 1,
          },
          (game) => factualContext.getFeatureVector(game),
          table,
        );
        const freshSimilarity = freshScores.get("a")?.nicheNeighbors[0]?.similarity;
        const weightedComponents = [
          [after.factual, currentPair.factualScore],
          ...(after.description > 0 && currentPair.C.state === "covered"
            ? [[after.description, currentPair.C.score] as const]
            : []),
          ...(after.ownerNote > 0 && currentPair.D.state === "covered"
            ? [[after.ownerNote, currentPair.D.score] as const]
            : []),
        ] as const;
        const expectedFreshSimilarity =
          Math.round(
            (weightedComponents.reduce((sum, [weight, score]) => sum + weight * score, 0) /
              weightedComponents.reduce((sum, [weight]) => sum + weight, 0)) *
              1000,
          ) / 1000;
        expect(freshSimilarity).toBe(expectedFreshSimilarity);
      } finally {
        cache.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  test("purge after a successful scoped Run leaves it completed without stale activation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-purge-race-"));
    const cache = await createJevPairCache(dir);
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const coordinator = profileSourceCoordinatorFor(fixtureData.storage);
    const revision = cache.mutationRevision.bind(cache);
    let coverageCaptureReturned = false;
    let waitForPostDigestRevision = false;
    let purgePromise: Promise<void> | undefined;
    let coverageCapture: JevRunCapture | undefined;
    const completionActivationPublications: Array<string | null> = [];
    const publicationOrder: string[] = [];
    const finishRun = cache.finishRun.bind(cache);
    cache.finishRun = (finish) => {
      if (finish.progress.state === "completed") {
        completionActivationPublications.push(finish.activation?.identity ?? null);
        publicationOrder.push(
          finish.activation ? "completed-with-activation" : "completed-without-activation",
        );
      }
      finishRun(finish);
    };
    cache.mutationRevision = () => {
      const current = revision();
      if (coverageCaptureReturned) {
        coverageCaptureReturned = false;
        waitForPostDigestRevision = true;
      } else if (waitForPostDigestRevision && !purgePromise) {
        waitForPostDigestRevision = false;
        purgePromise = runOutsideProfileSourceCoordinator(() =>
          coordinator.runExclusive(() => {
            cache.purgePair("a", "b", "C");
            publicationOrder.push("purged");
            return Promise.resolve();
          }),
        );
      }
      return current;
    };
    try {
      const service = new JevRunService({
        storageService: fixtureData.storage,
        cache,
        loadCapture: async () => {
          const capture = await fixtureData.sourceAdapter.loadCapture();
          if (!coverageCapture) {
            coverageCapture = capture;
            coverageCaptureReturned = true;
          }
          return capture;
        },
        readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "purge-race",
              start: () => ({ response: Promise.resolve(new Response()) }),
            });
            return scoreResult();
          },
        }),
      });
      const result = await runUnifiedForTest(service, fixtureData.preparation, false);
      const completedPurge = purgePromise;
      if (!completedPurge) throw new Error("Expected coverage-phase cache purge");
      await completedPurge;
      const finalCapture = coverageCapture;
      if (!finalCapture) throw new Error("Expected actual final coverage capture");
      const current = await fixtureData.sourceAdapter.readCurrent();
      expect(finalCapture.sourceVectorIdentity).toBe(
        fixtureData.preparation.capture.sourceVectorIdentity,
      );
      expect(finalCapture.policyIdentity).toBe(fixtureData.preparation.capture.policyIdentity);
      expect(current.sourceVectorIdentity).toBe(finalCapture.sourceVectorIdentity);
      expect(current.policyIdentity).toBe(finalCapture.policyIdentity);
      expect(result.state).toBe("completed");
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
      expect(cache.getActivation()).toBeNull();
      expect(completionActivationPublications).toEqual([null]);
      expect(publicationOrder).toEqual(["purged", "completed-without-activation"]);
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("three eligible games with one genuinely missing description can complete coverage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-missing-description-"));
    const cache = await createJevPairCache(dir);
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    const collection = await fixtureData.storage.loadCollection();
    const missingDescriptionGame = collection.games[2];
    if (!missingDescriptionGame) throw new Error("Expected third fixture game");
    missingDescriptionGame.bggData = null;
    await fixtureData.storage.saveCollection(collection);
    await fixtureData.storage.hydrateSourceVector?.();
    const preparation = await fixtureData.prepare();
    let coverageCapture: JevRunCapture | undefined;
    let dispatches = 0;
    try {
      const service = new JevRunService({
        storageService: fixtureData.storage,
        cache,
        loadCapture: async () => {
          coverageCapture = await fixtureData.sourceAdapter.loadCapture();
          return coverageCapture;
        },
        readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "one-described-pair",
              start: () => {
                dispatches++;
                return { response: Promise.resolve(new Response()) };
              },
            });
            return scoreResult();
          },
        }),
      });
      const result = await runUnifiedForTest(service, preparation, false);
      expect(dispatches).toBe(1);
      expect(result.pairCount).toBe(3);
      expect(result.failedPairs).toBe(0);
      expect(result.state).toBe("completed");
      const freshCapture = coverageCapture;
      if (!freshCapture) throw new Error("Expected final coverage capture");
      const coverage = computeJevPairCoverage({
        collection: freshCapture.collection,
        predictionCapture: freshCapture.predictionCapture,
        captureIdentity: freshCapture.captureIdentity,
        factualWeights: freshCapture.factualWeights,
        cache,
      });
      expect(coverage.complete).toBe(true);
      expect(coverage.pairs.filter((pair) => pair.C.state === "covered")).toHaveLength(1);
      expect(coverage.pairs.filter((pair) => pair.C.state === "unavailable")).toHaveLength(2);
      expect(cache.getActivation()?.identity).toBe(coverage.identity);
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("newly eligible games remain outside the successful Run scope without failing its outcome", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-added-game-"));
    const cache = await createJevPairCache(dir);
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    let coverageCapture: JevRunCapture | undefined;
    let dispatches = 0;
    try {
      const service = new JevRunService({
        storageService: fixtureData.storage,
        cache,
        loadCapture: async () => {
          const collection = await fixtureData.storage.loadCollection();
          collection.games = [...collection.games, game("c")];
          await fixtureData.storage.saveCollection(collection);
          await fixtureData.storage.hydrateSourceVector?.();
          coverageCapture = await fixtureData.sourceAdapter.loadCapture();
          return coverageCapture;
        },
        readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "only-original-pair",
              start: () => {
                dispatches++;
                return { response: Promise.resolve(new Response()) };
              },
            });
            return scoreResult();
          },
        }),
      });
      const result = await runUnifiedForTest(service, fixtureData.preparation, false);
      expect(dispatches).toBe(1);
      expect(result.state).toBe("completed");
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })?.value).toBe(0.5);
      expect(cache.lookup({ gameAId: "a", gameBId: "c", signal: "C" })).toBeNull();
      expect(cache.getActivation()).toBeNull();
      const freshCapture = coverageCapture;
      if (!freshCapture) throw new Error("Expected final coverage capture after source addition");
      const coverage = computeJevPairCoverage({
        collection: freshCapture.collection,
        predictionCapture: freshCapture.predictionCapture,
        captureIdentity: freshCapture.captureIdentity,
        factualWeights: freshCapture.factualWeights,
        cache,
      });
      expect(coverage.pairs).toHaveLength(3);
      expect(coverage.complete).toBe(false);
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cancellation while final coherent capture is pending fences activation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-final-capture-cancel-"));
    const cache = await createJevPairCache(dir);
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const finalCaptureBarrier = deferred<void>();
    const releaseFinalCapture = deferred<void>();
    const finalCaptureSettled = deferred<void>();
    let captureGateReached = false;
    let gatewayCalls = 0;
    let paidDispatches = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: async () => {
        finalCaptureBarrier.resolve();
        await releaseFinalCapture.promise;
        try {
          return await fixtureData.sourceAdapter.loadCapture();
        } finally {
          finalCaptureSettled.resolve();
        }
      },
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => {
        gatewayCalls++;
        return {
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "final-barrier",
              start: () => {
                paidDispatches++;
                return { response: Promise.resolve(new Response()) };
              },
            });
            return scoreResult();
          },
        };
      },
    });
    try {
      const handle = await reserveUnifiedRunForTest(service, fixtureData.preparation, false);
      await finalCaptureBarrier.promise;
      captureGateReached = true;
      handle.cancel();
      const result = await handle.completion;
      const progressAtCancellation = cache.getRunProgress();
      releaseFinalCapture.resolve();
      await finalCaptureSettled.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(result.state).toBe("interrupted");
      expect(cache.getRunProgress()?.state).toBe("interrupted");
      expect(cache.getRunProgress()).toEqual(progressAtCancellation);
      expect(cache.getActivation()).toBeNull();
      expect(gatewayCalls).toBe(1);
      expect(paidDispatches).toBe(1);
    } finally {
      releaseFinalCapture.resolve();
      if (captureGateReached) {
        await finalCaptureSettled.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cancellation while final readCurrent is pending persists interrupted status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-final-read-cancel-"));
    const cache = await createJevPairCache(dir);
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const barrier = deferred<void>();
    const pendingRead = deferred<void>();
    let finalCoverageStarted = false;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: async () => {
        finalCoverageStarted = true;
        return fixtureData.sourceAdapter.loadCapture();
      },
      readCurrent: async () => {
        const current = await fixtureData.sourceAdapter.readCurrent();
        if (finalCoverageStarted) {
          finalCoverageStarted = false;
          barrier.resolve();
          await pendingRead.promise;
        }
        return current;
      },
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: "final-read",
            start: () => ({ response: Promise.resolve(new Response()) }),
          });
          return scoreResult();
        },
      }),
    });
    try {
      const handle = await reserveUnifiedRunForTest(service, fixtureData.preparation, false);
      await barrier.promise;
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })?.value).toBe(0.5);
      handle.cancel();
      pendingRead.resolve();
      const result = await handle.completion;
      expect(result.state).toBe("interrupted");
      expect(cache.getRunProgress()?.state).toBe("interrupted");
      expect(cache.getActivation()).toBeNull();
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("original policy change before activation persists failed without activation", async () => {
    const { cache, progress } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: async () => {
        const capture = await fixtureData.sourceAdapter.loadCapture();
        const settings = await fixtureData.storage.loadRedundancySettings();
        await fixtureData.storage.saveRedundancySettings({
          ...settings,
          similarityThreshold: settings.similarityThreshold + 0.01,
        });
        return capture;
      },
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: "policy-change",
            start: () => ({ response: Promise.resolve(new Response()) }),
          });
          return scoreResult();
        },
      }),
    });
    const result = await runUnifiedForTest(service, fixtureData.preparation, false);
    expect(result.state).toBe("failed");
    expect(progress.at(-1)?.state).toBe("failed");
    expect(cache.getActivation()).toBeNull();
  });

  test("startup reconciliation does not interfere with an active process-local run", async () => {
    const { cache, progress } = cacheFake();
    cache.saveRunProgress({
      runId: "prior",
      state: "running",
      pairCount: 1,
      completedPairs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failedPairs: 0,
      updatedAt: "before",
    });
    const pending = deferred<void>();
    let gateways = 0;
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const actualService = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => {
        gateways++;
        return {
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "active-reconciliation",
              start: () => ({ response: pending.promise.then(() => new Response()) }),
            });
            return scoreResult();
          },
        };
      },
    });
    try {
      const preparation = await fixtureData.prepare();
      const handle = await reserveUnifiedRunForTest(actualService, preparation, false);
      const reconciled = await actualService.reconcileInterruptedProgress();
      expect(reconciled?.state).toBe("running");
      pending.resolve();
      await handle.completion;
      expect(gateways).toBe(1);
      expect(progress.at(-1)?.state).not.toBe("interrupted");
    } finally {
      cache.close();
    }
  });

  test("startup reconciliation marks stale running progress without creating a gateway", async () => {
    const { cache, progress } = cacheFake();
    cache.saveRunProgress({
      runId: "crashed",
      state: "running",
      pairCount: 2,
      completedPairs: 1,
      cacheHits: 0,
      cacheMisses: 1,
      failedPairs: 0,
      updatedAt: "before",
    });
    let gateways = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.reject(new Error("must not load capture during reconcile")),
      readCurrent: () => Promise.reject(new Error("must not read current during reconcile")),
      createGateway: () => {
        gateways++;
        return { evaluatePair: () => Promise.reject(new Error("must not infer")) };
      },
    });
    const result = await service.reconcileInterruptedProgress();
    expect(result?.state).toBe("interrupted");
    expect(progress.at(-1)?.state).toBe("interrupted");
    expect(gateways).toBe(0);
  });

  test("a note edit between attempts fences retries for that original pair", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-note-edit-"));
    const cache = await createJevPairCache(dir);
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const collection = await fixtureData.storage.loadCollection();
    for (const [index, entry] of collection.games.entries()) {
      entry.ownerNote = {
        state: "present",
        version: 1,
        updatedAt: "2026-01-01T00:00:00Z",
        text: `private-${index}`,
      };
    }
    collection.semanticRedundancy.settings = {
      ...collection.semanticRedundancy.settings,
      enabled: true,
      weights: { factual: 0, description: 0, ownerNote: 1 },
      cachedOwnerNoteUse: true,
    };
    await fixtureData.storage.saveCollection(collection);
    await fixtureData.storage.hydrateSourceVector?.();
    const preparation = await fixtureData.prepare();
    let starts = 0;
    let retryRejected = false;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "owner-notes-only",
            attemptId: "note-first",
            start: () => {
              starts++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          const current = await fixtureData.storage.loadCollection();
          const firstGame = current.games[0];
          if (!firstGame) throw new Error("Expected first note-bearing game");
          firstGame.ownerNote = {
            state: "present",
            version: 2,
            updatedAt: "2026-01-02T00:00:00Z",
            text: "edited-private-note",
          };
          await fixtureData.storage.saveCollection(current);
          await fixtureData.storage.hydrateSourceVector?.();
          try {
            await admit({
              mode: "owner-notes-only",
              attemptId: "note-retry",
              start: () => {
                starts++;
                return { response: Promise.resolve(new Response()) };
              },
            });
          } catch {
            retryRejected = true;
          }
          return {
            ...scoreResult(),
            description: null,
            ownerNote: scoreResult().description,
          };
        },
      }),
    });
    try {
      const result = await runUnifiedForTest(service, preparation, true);
      expect(starts).toBe(1);
      expect(retryRejected).toBe(true);
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "D" })).toBeNull();
      expect(result.state).toBe("failed");
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an unrelated source edit fences retries for the original prepared scope", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    const preparation = await fixtureData.prepare();
    let starts = 0;
    let retryRejected = false;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: "unrelated-first",
            start: () => {
              starts++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          const current = await fixtureData.storage.loadCollection();
          const unrelated = current.games[2];
          if (!unrelated) throw new Error("Expected unrelated third game");
          unrelated.name = "Unrelated renamed game";
          await fixtureData.storage.saveCollection(current);
          await fixtureData.storage.hydrateSourceVector?.();
          try {
            await admit({
              mode: "description-only",
              attemptId: "unrelated-retry",
              start: () => {
                starts++;
                return { response: Promise.resolve(new Response()) };
              },
            });
          } catch {
            retryRejected = true;
          }
          return scoreResult();
        },
      }),
    });
    const result = await runUnifiedForTest(service, preparation, false);
    expect(starts).toBe(1);
    expect(retryRejected).toBe(true);
    expect(rows.has("abC")).toBe(false);
    expect(result.state).toBe("failed");
  });

  test("unrelated source edit before checkpoint rejects the original pair", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    const preparation = await fixtureData.prepare();
    let dispatches = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: "checkpoint-race",
            start: () => {
              dispatches++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          const current = await fixtureData.storage.loadCollection();
          const unrelated = current.games[2];
          if (!unrelated) throw new Error("Expected unrelated third game");
          unrelated.name = "Edited unrelated source";
          await fixtureData.storage.saveCollection(current);
          await fixtureData.storage.hydrateSourceVector?.();
          return scoreResult();
        },
      }),
    });
    const result = await runUnifiedForTest(service, preparation, false);
    expect(dispatches).toBe(1);
    expect(rows.has("abC")).toBe(false);
    expect(result.state).toBe("failed");
  });

  test("ownership change fences the frozen Run scope without installing refreshed pairs", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    const preparation = await fixtureData.prepare();
    let ownershipChanged = false;
    let dispatches = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: async () => {
        if (!ownershipChanged) {
          ownershipChanged = true;
          const collection = await fixtureData.storage.loadCollection();
          const firstGame = collection.games[0];
          if (!firstGame) throw new Error("Expected first owned game");
          firstGame.ownership = "previously-owned";
          await fixtureData.storage.saveCollection(collection);
          await fixtureData.storage.hydrateSourceVector?.();
        }
        return fixtureData.sourceAdapter.readCurrent();
      },
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: "ownership-change",
            start: () => {
              dispatches++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          return scoreResult();
        },
      }),
    });
    const handle = await reserveUnifiedRunForTest(service, preparation, false);
    const result = await handle.completion;
    expect(ownershipChanged).toBe(true);
    expect(preparation.collectionScope?.totalEligiblePairs).toBe(3);
    expect(result.pairCount).toBe(3);
    expect(dispatches).toBe(0);
    expect(rows.size).toBe(0);
    expect(cache.getActivation()).toBeNull();
    expect(result.state).toBe("failed");
  });

  test("checkpoint storage failure stops further paid requests", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    const preparation = await fixtureData.prepare();
    cache.checkpointPair = () => {
      throw new Error("sqlite write failed");
    };
    let dispatches = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: "storage-failure",
            start: () => {
              dispatches++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          return scoreResult();
        },
      }),
    });
    const result = await runUnifiedForTest(service, preparation, false);
    expect(dispatches).toBe(1);
    expect(result.state).toBe("failed");
  });

  test("prepared authorization is not replaced when source capture changes before first admission", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const preparation = await fixtureData.prepare();
    const originalFingerprint =
      preparation.collectionScope?.sourceForGame("a")?.descriptionFingerprint;
    let descriptionMutation: Promise<void> | undefined;
    let executionCaptureLoads = 0;
    let gatewayConstructions = 0;
    let starts = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => {
        executionCaptureLoads++;
        return fixtureData.sourceAdapter.loadCapture();
      },
      readCurrent: () => {
        if (!descriptionMutation) {
          const coordinator = profileSourceCoordinatorFor(fixtureData.storage);
          descriptionMutation = runOutsideProfileSourceCoordinator(() =>
            coordinator.runExclusive(async () => {
              const collection = await fixtureData.storage.loadCollection();
              const firstGame = collection.games[0];
              if (!firstGame?.bggData) throw new Error("Expected first game's BGG data");
              firstGame.bggData.description = "changed before first admission";
              await fixtureData.storage.saveCollection(collection);
              await fixtureData.storage.hydrateSourceVector?.();
            }),
          );
        }
        return fixtureData.sourceAdapter.readCurrent();
      },
      createGateway: (admit) => {
        gatewayConstructions++;
        return {
          evaluatePair: async () => {
            await admit({
              mode: "description-only",
              attemptId: "prepared-source-edit",
              start: () => {
                starts++;
                return { response: Promise.resolve(new Response()) };
              },
            });
            return scoreResult();
          },
        };
      },
    });

    const handle = await reserveUnifiedRunForTest(service, preparation, false);
    const result = await handle.completion;
    await descriptionMutation;
    expect(descriptionMutation).toBeDefined();
    expect(await preparation.isSourceCurrent()).toBe(false);
    expect(executionCaptureLoads).toBe(0);
    expect(gatewayConstructions).toBe(0);
    expect(starts).toBe(0);
    expect(rows.size).toBe(0);
    expect(preparation.collectionScope?.sourceForGame("a")?.descriptionFingerprint).toBe(
      originalFingerprint,
    );
    expect(result.state).toBe("failed");
  });

  test("prepared no-required-signal run never constructs its gateway", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const collection = await fixtureData.storage.loadCollection();
    collection.semanticRedundancy.settings.weights = {
      factual: 0,
      description: 0,
      ownerNote: 0,
    };
    await fixtureData.storage.saveCollection(collection);
    await fixtureData.storage.hydrateSourceVector?.();
    const preparation = await fixtureData.prepare();
    let gatewayConstructions = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: () => {
        gatewayConstructions++;
        return { evaluatePair: () => Promise.resolve(scoreResult()) };
      },
    });
    const result = await runUnifiedForTest(service, preparation, false);
    expect(gatewayConstructions).toBe(0);
    expect(preparation.collectionScope).toBeDefined();
    expect(
      preparation.capture.predictionCapture.every((entry) => (entry.score?.score ?? 0) > 0),
    ).toBe(true);
    expect(preparation.collectionScope?.totalEligiblePairs).toBe(1);
    expect(result.completedPairs).toBe(1);
    expect(result.state).toBe("completed");
  });

  test("prepared C-only pair with absent notes sends descriptions without note authorization", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const preparation = await fixtureData.prepare();
    let starts = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          expect(request.mode).toBe("description-only");
          await admit({
            mode: "description-only",
            attemptId: "prepared-c-only",
            start: () => {
              starts++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          return scoreResult();
        },
      }),
    });
    const result = await runUnifiedForTest(service, preparation, false);
    expect(starts).toBe(1);
    expect(rows.has("abC")).toBe(true);
    expect(result.state).toBe("completed");
  });

  test("prepared scope mismatch fails closed before current-state read or gateway construction", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const otherFixture = await unifiedFixture(["a", "c"], cache);
    const preparation = await fixtureData.prepare();
    const otherPreparation = await otherFixture.prepare();
    if (!otherPreparation.collectionScope) throw new Error("Expected second collection scope");
    let currentReads = 0;
    let gatewayConstructions = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => Promise.reject(new Error("Prepared execution must not recapture")),
      readCurrent: () => {
        currentReads++;
        return fixtureData.sourceAdapter.readCurrent();
      },
      createGateway: () => {
        gatewayConstructions++;
        return { evaluatePair: () => Promise.resolve(scoreResult()) };
      },
    });
    const reservation = await service.prepareValidatedPreparedRun({
      scopeKind: "collection",
      capture: preparation.capture,
      scope: otherPreparation.collectionScope,
      unifiedPreparation: otherPreparation,
      noteTransmissionAuthorized: false,
      providerBudget: preparation.run.disclosure.budget,
    });
    expect(reservation).toBeNull();
    expect(currentReads).toBe(0);
    expect(gatewayConstructions).toBe(0);
    expect(rows.size).toBe(0);
  });

  test("wishlist execution uses its typed executor and never recaptures collection scope", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const unifiedPreparation = await prepareUnifiedJevRun({
      scoring: fixtureData.context.unifiedScoringService,
      sourceAdapter: fixtureData.sourceAdapter,
      cache,
      request: { scope: "wishlist", selectedBggIds: [] },
      budget: DEFAULT_JEV_RUN_BUDGET,
    });
    if (!unifiedPreparation.wishlistPreparation)
      throw new Error("Expected prepared wishlist scope");
    let gatewayConstructions = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => Promise.reject(new Error("Wishlist scope must not recapture")),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: () => {
        gatewayConstructions++;
        return { evaluatePair: () => Promise.resolve(scoreResult()) };
      },
    });

    const reservation = await service.prepareValidatedPreparedRun({
      scopeKind: "wishlist",
      wishlistPreparation: unifiedPreparation.wishlistPreparation,
      unifiedPreparation,
      noteTransmissionAuthorized: false,
      providerBudget: unifiedPreparation.run.disclosure.budget,
    });
    expect(reservation).not.toBeNull();
    if (!reservation) throw new Error("Expected frozen wishlist reservation");
    const result = await service.reserveValidatedPreparedRun(reservation).completion;
    expect(result.state).toBe("completed");
    expect(gatewayConstructions).toBe(0);
    expect(rows.size).toBe(0);
  });

  test("validated reservation returns synchronously without cache or source reads", async () => {
    const cacheFixture = cacheFake();
    const budget = { ...DEFAULT_JEV_RUN_BUDGET, maxProviderAttempts: 1 };
    const fixtureData = await unifiedFixture(
      Array.from({ length: 200 }, (_, index) => `game-${index}`),
      cacheFixture.cache,
      budget,
    );
    const preparation = fixtureData.preparation;
    const collectionScope = preparation.collectionScope;
    if (!collectionScope) throw new Error("Expected prepared collection scope");
    let sourceReads = 0;
    let gatewayConstructions = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache: cacheFixture.cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => {
        sourceReads++;
        return fixtureData.sourceAdapter.readCurrent();
      },
      createGateway: (admit) => {
        gatewayConstructions++;
        return {
          evaluatePair: async (request) => {
            await admit({
              mode: request.mode,
              attemptId: "bounded-reservation",
              start: () => ({ response: Promise.resolve(new Response()) }),
            });
            return scoreResult();
          },
        };
      },
    });
    const loadSnapshot = fixtureData.storage.loadJevSourceSnapshot?.bind(fixtureData.storage);
    if (!loadSnapshot) throw new Error("Expected storage source snapshots");
    let sourceSnapshotReads = 0;
    let snapshotReadsWhileCoordinatorHeld = -1;
    fixtureData.storage.loadJevSourceSnapshot = async () => {
      const snapshot = await loadSnapshot();
      sourceSnapshotReads++;
      return snapshot;
    };
    const validationSettled = deferred<void>();
    let validationSettledWhileCoordinatorHeld = false;
    let validation: Promise<ValidatedPreparedJevRun | null> | undefined;
    try {
      await profileSourceCoordinatorFor(fixtureData.storage).runExclusive(async () => {
        const startedValidation = service.prepareValidatedPreparedRun({
          scopeKind: "collection",
          capture: preparation.capture,
          scope: collectionScope,
          unifiedPreparation: preparation,
          noteTransmissionAuthorized: false,
          providerBudget: preparation.run.disclosure.budget,
        });
        validation = startedValidation;
        void startedValidation.then(
          () => validationSettled.resolve(),
          () => validationSettled.resolve(),
        );
        validationSettledWhileCoordinatorHeld = await Promise.race([
          validationSettled.promise.then(() => true),
          new Promise<boolean>((resolve) => setImmediate(() => resolve(false))),
        ]);
        snapshotReadsWhileCoordinatorHeld = sourceSnapshotReads;
      });
      if (!validation) throw new Error("Validation did not start");
      const reservation = await validation;
      expect(validationSettledWhileCoordinatorHeld).toBe(false);
      expect(snapshotReadsWhileCoordinatorHeld).toBe(0);
      expect(reservation).not.toBeNull();
      if (!reservation) throw new Error("Expected validated unified preparation");
      expect(sourceSnapshotReads).toBeGreaterThan(0);
      cacheFixture.resetLookupCalls();
      const handle = service.reserveValidatedPreparedRun(reservation);
      handle.cancel();
      expect(cacheFixture.lookupCalls).toBe(0);
      expect(sourceReads).toBe(0);
      const progress = await handle.completion;
      expect(progress.state).toBe("interrupted");
      expect(preparation.collectionScope?.totalEligiblePairs).toBe(19_900);
      expect(gatewayConstructions).toBe(0);
    } finally {
      fixtureData.storage.loadJevSourceSnapshot = loadSnapshot;
    }
  });

  test("run-progress storage failure before dispatch stops all paid requests", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    const preparation = await fixtureData.prepare();
    const saveProgress = cache.saveRunProgress.bind(cache);
    const failedProgressAttempts: Array<
      Pick<JevRunProgress, "state" | "pairCount" | "completedPairs">
    > = [];
    let initialProgressFailed = false;
    cache.saveRunProgress = (progress) => {
      if (
        !initialProgressFailed &&
        progress.state === "running" &&
        progress.completedPairs === 0 &&
        progress.pairCount === 3
      ) {
        initialProgressFailed = true;
        failedProgressAttempts.push({
          state: progress.state,
          pairCount: progress.pairCount,
          completedPairs: progress.completedPairs,
        });
        throw new Error("initial run progress persistence failure");
      }
      saveProgress(progress);
    };
    let dispatches = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          await admit({
            mode: request.mode,
            attemptId: "initial-progress-failure",
            start: () => {
              dispatches++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          return scoreResult();
        },
      }),
    });
    const result = await runUnifiedForTest(service, preparation, false);
    expect(dispatches).toBe(0);
    expect(failedProgressAttempts).toEqual([{ state: "running", pairCount: 3, completedPairs: 0 }]);
    expect(result.state).toBe("failed");
  });

  test("outcome progress write failure after malformed response blocks later pairs", async () => {
    const { cache } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    const preparation = await fixtureData.prepare();
    const saveProgress = cache.saveRunProgress.bind(cache);
    const failedProgressAttempts: Array<
      Pick<JevRunProgress, "state" | "completedPairs" | "failedPairs">
    > = [];
    cache.saveRunProgress = (progress) => {
      if (
        progress.state === "running" &&
        progress.completedPairs === 1 &&
        progress.failedPairs === 1
      ) {
        failedProgressAttempts.push({
          state: progress.state,
          completedPairs: progress.completedPairs,
          failedPairs: progress.failedPairs,
        });
        throw new Error("malformed-result outcome persistence failure");
      }
      saveProgress(progress);
    };
    let paidCalls = 0;
    const description = scoreResult().description;
    if (!description) throw new Error("Expected description result fixture");
    const invalid = {
      ...scoreResult(),
      description: { ...description, score: 2 },
    };
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: "malformed",
            start: () => {
              paidCalls++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          return invalid;
        },
      }),
    });
    const result = await runUnifiedForTest(service, preparation, false);
    expect(paidCalls).toBe(1);
    expect(failedProgressAttempts).toEqual([
      { state: "running", completedPairs: 1, failedPairs: 1 },
    ]);
    expect(result.state).toBe("failed");
  });

  test("description edit before admission rejects the frozen scope without sending stale or new payloads", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b", "c"], cache);
    const preparation = await fixtureData.prepare();
    const initialReadStarted = deferred<void>();
    const releaseInitialRead = deferred<void>();
    let firstAuthorityRead = true;
    let executionCaptureLoads = 0;
    let gatewayConstructions = 0;
    const dispatched: string[] = [];
    const dispatchedDescriptions: string[] = [];
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => {
        executionCaptureLoads++;
        return fixtureData.sourceAdapter.loadCapture();
      },
      readCurrent: async () => {
        if (firstAuthorityRead) {
          firstAuthorityRead = false;
          initialReadStarted.resolve();
          await releaseInitialRead.promise;
        }
        return fixtureData.sourceAdapter.readCurrent();
      },
      createGateway: (admit) => {
        gatewayConstructions++;
        return {
          evaluatePair: async (request) => {
            if (request.mode !== "description-only") throw new Error("Unexpected note request");
            dispatched.push(`${request.gameA.name}/${request.gameB.name}`);
            dispatchedDescriptions.push(
              `${request.gameA.bggDescription}`,
              `${request.gameB.bggDescription}`,
            );
            await admit({
              mode: "description-only",
              attemptId: "description-edit",
              start: () => ({ response: Promise.resolve(new Response()) }),
            });
            return scoreResult();
          },
        };
      },
    });
    try {
      const handle = await reserveUnifiedRunForTest(service, preparation, false);
      await initialReadStarted.promise;
      const coordinator = profileSourceCoordinatorFor(fixtureData.storage);
      const mutation = runOutsideProfileSourceCoordinator(() =>
        coordinator.runExclusive(async () => {
          const collection = await fixtureData.storage.loadCollection();
          const firstGame = collection.games[0];
          if (!firstGame?.bggData) throw new Error("Expected first game's BGG data");
          firstGame.bggData.description = "edited description before admission";
          await fixtureData.storage.saveCollection(collection);
          await fixtureData.storage.hydrateSourceVector?.();
        }),
      );
      releaseInitialRead.resolve();
      const result = await handle.completion;
      await mutation;
      expect(dispatched).toEqual([]);
      expect(dispatchedDescriptions).toEqual([]);
      expect(executionCaptureLoads).toBe(0);
      expect(gatewayConstructions).toBe(0);
      expect(rows.size).toBe(0);
      expect(result.state).toBe("failed");
    } finally {
      releaseInitialRead.resolve();
    }
  });

  test("source and permission mutation under shared coordinator fences pending C and D result", async () => {
    const { cache, rows } = cacheFake();
    const fixtureData = await unifiedFixture(["a", "b"], cache);
    const coordinator = profileSourceCoordinatorFor(fixtureData.storage);
    const collection = await fixtureData.storage.loadCollection();
    for (const [index, capturedGame] of collection.games.entries()) {
      capturedGame.ownerNote = {
        state: "present",
        version: 1,
        updatedAt: "2026-01-01T00:00:00Z",
        text: `private-${index}`,
      };
    }
    collection.semanticRedundancy.settings = {
      ...collection.semanticRedundancy.settings,
      enabled: true,
      weights: { factual: 0, description: 1, ownerNote: 1 },
      cachedOwnerNoteUse: true,
    };
    await fixtureData.storage.saveCollection(collection);
    await fixtureData.storage.hydrateSourceVector?.();
    const preparation = await fixtureData.prepare();
    const providerBarrier = deferred<void>();
    const providerResponse = deferred<Response>();
    let mutationCompleted = false;
    let paidStarts = 0;
    const service = new JevRunService({
      storageService: fixtureData.storage,
      cache,
      loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
      readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          const receipt = await admit({
            mode: "description-and-owner-notes",
            attemptId: "pending-provider",
            start: () => {
              paidStarts++;
              providerBarrier.resolve();
              return { response: providerResponse.promise };
            },
          });
          await receipt.response;
          return {
            ...scoreResult(),
            ownerNote: scoreResult().description,
          };
        },
      }),
    });
    const handle = await reserveUnifiedRunForTest(service, preparation, true);
    await providerBarrier.promise;
    await coordinator.runExclusive(async () => {
      const current = await fixtureData.storage.loadCollection();
      const firstGame = current.games[0];
      if (!firstGame) throw new Error("Expected first note-bearing game");
      firstGame.ownerNote = {
        state: "present",
        version: 2,
        updatedAt: "2026-01-02T00:00:00Z",
        text: "changed while provider pending",
      };
      current.semanticRedundancy.settings.cachedOwnerNoteUse = false;
      await fixtureData.storage.saveCollection(current);
      await fixtureData.storage.hydrateSourceVector?.();
      mutationCompleted = true;
    });
    expect(mutationCompleted).toBe(true);
    providerResponse.resolve(new Response());
    const result = await handle.completion;
    expect(preparation.collectionScope?.totalEligiblePairs).toBe(1);
    expect(paidStarts).toBe(1);
    expect(rows.size).toBe(0);
    expect(cache.getActivation()).toBeNull();
    expect(result.state).toBe("failed");
  });

  test("SQLite interrupted run reopens without provider work and fresh run fills only missing pairs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-sqlite-resume-"));
    const fileOps = createMockFileOps();
    let providerCalls = 0;
    const requestedPairs: string[] = [];
    const secondProviderBarrier = deferred<void>();
    const secondProviderResponse = deferred<Response>();
    const makeService = (
      fixtureData: Awaited<ReturnType<typeof unifiedFixture>>,
      cache: JevPairCache,
      pauseSecondRequest: boolean,
    ) =>
      new JevRunService({
        storageService: fixtureData.storage,
        cache,
        loadCapture: () => fixtureData.sourceAdapter.loadCapture(),
        readCurrent: () => fixtureData.sourceAdapter.readCurrent(),
        createGateway: (admit) => ({
          evaluatePair: async (request) => {
            providerCalls++;
            requestedPairs.push(`${request.gameA.name}/${request.gameB.name}`);
            const pairNumber = providerCalls;
            const receipt = await admit({
              mode: "description-only",
              attemptId: `sqlite-resume-${pairNumber}`,
              start: () => {
                if (pauseSecondRequest && pairNumber === 2) {
                  secondProviderBarrier.resolve();
                  return { response: secondProviderResponse.promise };
                }
                return { response: Promise.resolve(new Response()) };
              },
            });
            await receipt.response;
            return scoreResult();
          },
        }),
      });
    let cache = await createJevPairCache(dir);
    const initialFixture = await unifiedFixture(
      ["a", "b", "c"],
      cache,
      DEFAULT_JEV_RUN_BUDGET,
      fileOps,
    );
    const originalCollectionId = (await initialFixture.storage.loadCollection()).id;
    try {
      const firstService = makeService(initialFixture, cache, true);
      const interruptedHandle = await reserveUnifiedRunForTest(
        firstService,
        initialFixture.preparation,
        false,
      );
      await secondProviderBarrier.promise;
      interruptedHandle.cancel();
      secondProviderResponse.resolve(new Response());
      const interrupted = await interruptedHandle.completion;
      expect(interrupted.state).toBe("interrupted");
      expect(providerCalls).toBe(2);
      expect(requestedPairs).toEqual(["Game a/Game b", "Game a/Game c"]);
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })?.value).toBe(0.5);
      expect(cache.lookup({ gameAId: "a", gameBId: "c", signal: "C" })).toBeNull();
      expect(cache.lookup({ gameAId: "b", gameBId: "c", signal: "C" })).toBeNull();
      expect(cache.getRunProgress()?.state).toBe("interrupted");

      cache.close();
      cache = await createJevPairCache(dir);
      const reopenedFixture = await unifiedFixture(
        ["a", "b", "c"],
        cache,
        DEFAULT_JEV_RUN_BUDGET,
        fileOps,
      );
      expect((await reopenedFixture.storage.loadCollection()).id).toBe(originalCollectionId);
      const reopenedService = makeService(reopenedFixture, cache, false);
      const startupProgress = await reopenedService.reconcileInterruptedProgress();
      expect(startupProgress?.state).toBe("interrupted");
      expect(cache.getRunProgress()?.state).toBe("interrupted");
      expect(providerCalls).toBe(2);
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })?.value).toBe(0.5);

      const resumed = await runUnifiedForTest(reopenedService, reopenedFixture.preparation, false);
      expect(providerCalls).toBe(4);
      expect(requestedPairs.slice(2)).toEqual(["Game a/Game c", "Game b/Game c"]);
      expect(resumed.state).toBe("completed");
      expect(cache.lookup({ gameAId: "a", gameBId: "c", signal: "C" })?.value).toBe(0.5);
      expect(cache.lookup({ gameAId: "b", gameBId: "c", signal: "C" })?.value).toBe(0.5);
      expect(cache.getActivation()).not.toBeNull();
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
