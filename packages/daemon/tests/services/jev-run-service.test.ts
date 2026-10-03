import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Collection,
  DurableGame,
  GameWithScore,
  SemanticRedundancySettings,
} from "@shelf-judge/shared";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyStateV10,
} from "@shelf-judge/shared";
import { JevRunService, type JevRunCapture } from "../../src/services/jev-run-service.js";
import { planJevRunScope } from "../../src/services/jev-run-scope.js";
import type {
  JevPairCache,
  JevPairCheckpoint,
  JevPairJudgment,
  JevRunProgress,
} from "../../src/services/jev-pair-cache-service.js";
import { createJevPairCache } from "../../src/services/jev-pair-cache-service.js";
import { computeJevPairCoverage } from "../../src/services/jev-pair-coverage.js";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import { createSemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import { buildJevPairDependencies } from "../../src/services/jev-pair-identity.js";
import {
  computeRedundancyAdjustments,
  DEFAULT_REDUNDANCY_SETTINGS,
} from "../../src/services/redundancy-engine.js";
import type { RedundancyPairTable } from "../../src/services/redundancy-engine.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
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
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ownerNote: { state: "cleared", version: 0, updatedAt: "2026-01-01T00:00:00Z" },
  };
}

function fixture(ids = ["a", "b"]): JevRunCapture {
  const state = createInitialSemanticRedundancyStateV10();
  const collection = {
    id: "collection",
    name: "test",
    schemaVersion: 10,
    revision: 1,
    axes: [],
    games: ids.map(game),
    intentions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: "now",
    updatedAt: "now",
    attentionDispositions: [],
    semanticRedundancy: {
      ...state,
      settings: {
        enabled: true,
        weights: { factual: 0, description: 1, ownerNote: 0 },
        cachedOwnerNoteUse: false,
      },
      consentEpoch: 0,
    },
  } as unknown as Collection;
  const predictionCapture = ids.map((id) => ({
    game: { id, ownership: "owned" },
    score: { score: 1, vetoed: false, ratedAxisCount: 1, predictionMeta: null },
  })) as unknown as GameWithScore[];
  return {
    collection,
    predictionCapture,
    captureIdentity: {
      sourceVectorIdentity: "vector",
      tournamentIdentity: "tournament",
      predictionCaptureIdentity: "capture",
    },
    factualWeights: { binary: 0, continuous: 0 },
    sourceVectorIdentity: "vector",
    policyIdentity: "policy",
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

async function runPreparedForTest(
  service: JevRunService,
  input: Parameters<JevRunService["prepareValidatedPreparedRun"]>[0],
): Promise<JevRunProgress> {
  const reservation = await service.prepareValidatedPreparedRun(input);
  if (!reservation) throw new Error("Expected a validated prepared run");
  return service.reserveValidatedPreparedRun(reservation).completion;
}

function cacheFake() {
  const progress: JevRunProgress[] = [];
  const rows = new Map<string, JevPairJudgment>();
  let revision = 0;
  const cache = {
    available: true,
    mutationRevision: () => revision,
    lookup: (key: { gameAId: string; gameBId: string; signal: string }) =>
      rows.get(key.gameAId + key.gameBId + key.signal) ?? null,
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
  return { cache, progress, rows };
}

describe("JevRunService attempt barriers", () => {
  test("reuses one capture lookup across pair preparation, dispatch, and checkpoints", async () => {
    const capture = fixture(["a", "b", "c"]);
    const games = capture.collection.games;
    const originalMap = games.map.bind(games);
    let collectionMapCalls = 0;
    games.map = ((...args: Parameters<typeof games.map>) => {
      collectionMapCalls++;
      return originalMap(...args);
    }) as typeof games.map;
    const { cache } = cacheFake();
    let dispatches = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: `structural-${dispatches}`,
            start: () => {
              dispatches++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          return scoreResult();
        },
      }),
    });

    const result = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(result).toMatchObject({ state: "completed", completedPairs: 3 });
    expect(dispatches).toBe(3);
    // One source-index build for scope planning and one lazy run lookup, independent of pair count.
    expect(collectionMapCalls).toBe(2);
  });

  test("default computational scope admits a 200-game 19,900-pair universe", async () => {
    const ids = Array.from({ length: 200 }, (_, index) => `game-${String(index).padStart(3, "0")}`);
    const capture = fixture(ids);
    const { cache, rows } = cacheFake();
    const games = new Map(capture.collection.games.map((entry) => [entry.id, entry]));
    for (let leftIndex = 0; leftIndex < ids.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex++) {
        const gameAId = ids[leftIndex];
        const gameBId = ids[rightIndex];
        const gameA = games.get(gameAId)!;
        const gameB = games.get(gameBId)!;
        rows.set(gameAId + gameBId + "C", {
          collectionId: capture.collection.id,
          gameAId,
          gameBId,
          signal: "C",
          dependencyKind: "C_ONLY",
          value: 0.5,
          modelId: JEV_JUDGMENT_CONTRACT.modelId,
          rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
          questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
          requestSchemaVersion: JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
          scoreMappingVersion: JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
          semanticPolicyId: JEV_JUDGMENT_CONTRACT.semanticPolicyId,
          completedAt: "fixture-time",
          dependencies: buildJevPairDependencies(
            "C_ONLY",
            {
              gameId: gameAId,
              name: gameA.name,
              description: gameA.bggData!.description!,
            },
            {
              gameId: gameBId,
              name: gameB.name,
              description: gameB.bggData!.description!,
            },
          ),
        });
      }
    }
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: () => {
        throw new Error("No signals require provider work");
      },
    });

    expect(service.effectiveLimits.maxEligiblePairs).toBeGreaterThanOrEqual(19_900);
    const progress = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(progress).toMatchObject({
      state: "completed",
      pairCount: 19_900,
      completedPairs: 19_900,
      cacheHits: 19_900,
      failedPairs: 0,
    });
  });

  test("gateway request-budget exhaustion preserves checkpoints and stops later pairs", async () => {
    const capture = fixture(["a", "b", "c"]);
    const { cache, rows } = cacheFake();
    let transportCalls = 0;
    const logs = recordingLogger();
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
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

    const progress = await service.startRun({ noteTransmissionAuthorized: false }).completion;
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
      maxProviderAttempts: 100,
      reportedTokenStopThreshold: 200_000,
      maxRunDurationMs: 1_800_000,
      eligiblePairs: null,
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
    const capture = fixture(ids);
    const { cache, rows } = cacheFake();
    let transportCalls = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
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
    const planned = planJevRunScope(capture.collection, capture.predictionCapture);
    if (!planned.ok) throw new Error("Expected valid 15-game scope");
    const progress = await runPreparedForTest(service, {
      capture,
      scope: planned.scope,
      noteTransmissionAuthorized: false,
      providerBudget: {
        maxProviderAttempts: 101,
        reportedTokenStopThreshold: 100_000,
        maxRunDurationMs: 60_000,
      },
    });

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
    const capture = fixture(["a", "b", "c"]);
    const { cache, rows } = cacheFake();
    let transportCalls = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
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
    const planned = planJevRunScope(capture.collection, capture.predictionCapture);
    if (!planned.ok) throw new Error("Expected valid three-game scope");
    const progress = await runPreparedForTest(service, {
      capture,
      scope: planned.scope,
      noteTransmissionAuthorized: false,
      providerBudget: {
        maxProviderAttempts: 10,
        reportedTokenStopThreshold: 5,
        maxRunDurationMs: 60_000,
      },
    });

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
    const capture = fixture();
    const { cache } = cacheFake();
    let clock = 1_000;
    let gatewayConstructions = 0;
    const logs = recordingLogger();
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () => {
        clock += 60_000;
        return Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        });
      },
      createGateway: () => {
        gatewayConstructions++;
        return { evaluatePair: () => Promise.resolve(scoreResult()) };
      },
      now: () => new Date(clock),
      logger: logs.logger,
    });
    const planned = planJevRunScope(capture.collection, capture.predictionCapture);
    if (!planned.ok) throw new Error("Expected valid one-pair scope");
    const progress = await runPreparedForTest(service, {
      capture,
      scope: planned.scope,
      noteTransmissionAuthorized: false,
      providerBudget: {
        maxProviderAttempts: 100,
        reportedTokenStopThreshold: 200_000,
        maxRunDurationMs: 60_000,
      },
    });

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

  test("owner cancellation settles before a never-ending initial capture and fences late completion", async () => {
    const capture = fixture();
    const pendingCapture = deferred<JevRunCapture>();
    const { cache, progress, rows } = cacheFake();
    let captureCalls = 0;
    let dispatches = 0;
    const logs = recordingLogger();
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => {
        captureCalls++;
        return captureCalls === 1 ? pendingCapture.promise : Promise.resolve(capture);
      },
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: () => ({
        evaluatePair: () => {
          dispatches++;
          return Promise.resolve(scoreResult());
        },
      }),
      logger: logs.logger,
    });
    const canceled = service.startRun({ noteTransmissionAuthorized: false });
    canceled.cancel();
    const canceledProgress = await canceled.completion;
    expect(canceledProgress).toMatchObject({ state: "interrupted" });

    const replacement = service.startRun({ noteTransmissionAuthorized: false });
    const replacementProgress = await replacement.completion;
    expect(replacementProgress).toMatchObject({ state: "completed" });
    pendingCapture.reject(new Error("PRIVATE_CAPTURE_CANARY"));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(dispatches).toBe(1);
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
    expect(JSON.stringify(logs.records)).not.toContain("PRIVATE_CAPTURE_CANARY");
  });

  test("terminal completion settles fail-closed when terminal progress persistence fails", async () => {
    const capture = fixture();
    const pendingCapture = deferred<JevRunCapture>();
    const { cache } = cacheFake();
    const logs = recordingLogger();
    (cache as unknown as { finishRun: () => void }).finishRun = () => {
      throw new Error("simulated terminal persistence failure");
    };
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => pendingCapture.promise,
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: () => {
        throw new Error("Canceled run must not construct a gateway");
      },
      logger: logs.logger,
    });
    const handle = service.startRun({ noteTransmissionAuthorized: false });
    handle.cancel();
    expect(await handle.completion).toMatchObject({ state: "interrupted" });
    pendingCapture.reject(new Error("late capture rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const terminalEvents = logs.records.filter((record) => record.message === "Jev run terminal");
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.fields).toMatchObject({
      persistenceFailureReason: "terminal-status-persistence-failed",
    });
    expect(JSON.stringify(logs.records)).not.toContain("simulated terminal persistence failure");
    expect(JSON.stringify(logs.records)).not.toContain("late capture rejection");
  });

  test("throwing lifecycle logger cannot strand start or cancellation and a later Run can start", async () => {
    const capture = fixture();
    const pendingCapture = deferred<JevRunCapture>();
    const { cache } = cacheFake();
    let captureCalls = 0;
    const throwingLogger = {
      log() {
        throw new Error("private logger canary");
      },
      error() {
        throw new Error("private logger canary");
      },
    };
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => {
        captureCalls++;
        return captureCalls === 1 ? pendingCapture.promise : Promise.resolve(capture);
      },
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: () => ({ evaluatePair: () => Promise.resolve(scoreResult()) }),
      logger: throwingLogger,
    });

    const canceled = service.startRun({ noteTransmissionAuthorized: false });
    canceled.cancel();
    expect(await canceled.completion).toMatchObject({ state: "interrupted" });

    const next = service.startRun({ noteTransmissionAuthorized: false });
    expect(await next.completion).toMatchObject({ runId: next.runId, state: "completed" });
    pendingCapture.reject(new Error("late capture rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  test("throwing terminal logger cannot strand deadline completion or the next Run", async () => {
    const capture = fixture();
    const { cache } = cacheFake();
    let clock = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () => {
        clock += 20;
        return Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        });
      },
      createGateway: () => {
        throw new Error("Deadline must stop before gateway construction");
      },
      now: () => new Date(clock),
      maxRunMs: 20,
      logger: {
        log() {
          throw new Error("private logger canary");
        },
        error() {
          throw new Error("private logger canary");
        },
      },
    });

    const expired = service.startRun({ noteTransmissionAuthorized: false });
    expect(await expired.completion).toMatchObject({
      runId: expired.runId,
      state: "failed",
      stopReason: "application-deadline",
    });

    const next = service.startRun({ noteTransmissionAuthorized: false });
    expect(await next.completion).toMatchObject({
      runId: next.runId,
      state: "failed",
      stopReason: "application-deadline",
    });
  });

  test("retained cancellation for completed run A cannot overwrite run B progress", async () => {
    const capture = fixture();
    const queuedRead = deferred<void>();
    const releaseRead = deferred<void>();
    const { cache, progress } = cacheFake();
    let readCount = 0;
    let evaluationCount = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: async () => {
        readCount++;
        if (readCount === 4) {
          queuedRead.resolve();
          await releaseRead.promise;
        }
        return {
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        };
      },
      createGateway: () => ({
        evaluatePair: () => {
          evaluationCount++;
          return evaluationCount === 1
            ? Promise.reject(new JevGatewayError("http-failure", "fake failure"))
            : Promise.resolve(scoreResult());
        },
      }),
    });
    const runA = service.startRun({ noteTransmissionAuthorized: false });
    expect(await runA.completion).toMatchObject({ state: "failed" });

    const runB = service.startRun({ noteTransmissionAuthorized: false });
    await queuedRead.promise;
    expect(progress.at(-1)).toMatchObject({ runId: runB.runId, state: "running" });
    const writesBeforeRetainedCancel = progress.length;
    runA.cancel();
    expect(progress).toHaveLength(writesBeforeRetainedCancel);
    expect(progress.at(-1)).toMatchObject({ runId: runB.runId, state: "running" });

    releaseRead.resolve();
    expect(await runB.completion).toMatchObject({ runId: runB.runId, state: "completed" });
  });

  test("a canceled run queued behind another coordinator operation skips its source read", async () => {
    const capture = fixture();
    const storage = {};
    const coordinator = profileSourceCoordinatorFor(storage);
    const blockerStarted = deferred<void>();
    const releaseBlocker = deferred<void>();
    const blocker = coordinator.runExclusive(async () => {
      blockerStarted.resolve();
      await releaseBlocker.promise;
    });
    await blockerStarted.promise;
    const { cache } = cacheFake();
    let sourceReads = 0;
    const service = new JevRunService({
      storageService: storage,
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () => {
        sourceReads++;
        return Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        });
      },
      createGateway: () => {
        throw new Error("Canceled queued run must not construct a gateway");
      },
    });
    const handle = service.startRun({ noteTransmissionAuthorized: false });
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
    const capture = fixture(["a", "b", "c"]);
    const { cache } = cacheFake();
    let evaluations = 0;
    let attemptLimitReached = false;
    let readCountAfterFailure = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () => {
        if (attemptLimitReached) {
          readCountAfterFailure++;
          return new Promise(() => {});
        }
        return Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        });
      },
      createGateway: () => ({
        evaluatePair: () => {
          evaluations++;
          if (evaluations === 1) return Promise.resolve(scoreResult());
          attemptLimitReached = true;
          return Promise.reject(
            new JevGatewayError("attempt-limit-exhausted", "application attempt limit"),
          );
        },
      }),
    });

    const progress = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(progress).toMatchObject({ state: "failed", stopReason: "application-attempt-limit" });
    expect(readCountAfterFailure).toBe(0);
  });

  test("deadline settles independently of a blocked coordinated read and blocks its late callback", async () => {
    const capture = fixture();
    const readEntered = deferred<void>();
    const pendingRead = deferred<{
      collection: Collection;
      sourceVectorIdentity: string;
      policyIdentity: string;
      canTransmitNotes: boolean;
    }>();
    const { cache, progress } = cacheFake();
    let reads = 0;
    let dispatches = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () => {
        reads++;
        if (reads === 1) {
          readEntered.resolve();
          return pendingRead.promise;
        }
        return Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        });
      },
      createGateway: () => {
        dispatches++;
        return { evaluatePair: () => Promise.resolve(scoreResult()) };
      },
      maxRunMs: 20,
    });
    const timed = service.startRun({ noteTransmissionAuthorized: false });
    await readEntered.promise;
    const terminal = await timed.completion;
    expect(terminal).toMatchObject({ state: "failed", stopReason: "application-deadline" });

    pendingRead.resolve({
      collection: capture.collection,
      sourceVectorIdentity: "vector",
      policyIdentity: "policy",
      canTransmitNotes: false,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(dispatches).toBe(0);
    expect(progress.at(-1)).toMatchObject({ runId: timed.runId, state: "failed" });
  });

  test("cancellation releases logical activity while a coordinated read drains without stale writes", async () => {
    const capture = fixture();
    const readEntered = deferred<void>();
    const pendingRead = deferred<{
      collection: Collection;
      sourceVectorIdentity: string;
      policyIdentity: string;
      canTransmitNotes: boolean;
    }>();
    const { cache, progress, rows } = cacheFake();
    let reads = 0;
    let dispatches = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () => {
        reads++;
        if (reads === 1) {
          readEntered.resolve();
          return pendingRead.promise;
        }
        return Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        });
      },
      createGateway: () => ({
        evaluatePair: () => {
          dispatches++;
          return Promise.resolve(scoreResult());
        },
      }),
    });
    const canceled = service.startRun({ noteTransmissionAuthorized: false });
    await readEntered.promise;
    canceled.cancel();
    expect(await canceled.completion).toMatchObject({ state: "interrupted" });

    const replacement = service.startRun({ noteTransmissionAuthorized: false });
    pendingRead.reject(new Error("late private read failure"));
    const replacementProgress = await replacement.completion;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(replacementProgress).toMatchObject({ runId: replacement.runId, state: "completed" });
    expect(dispatches).toBe(1);
    expect(rows.size).toBe(1);
    expect(progress.at(-1)).toMatchObject({ runId: replacement.runId, state: "completed" });
  });

  test("not-configured is terminal instead of failing every remaining pair", async () => {
    const capture = fixture(["a", "b", "c"]);
    const { cache } = cacheFake();
    let evaluations = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: () => ({
        evaluatePair: () => {
          evaluations++;
          return Promise.reject(
            new JevGatewayError("not-configured", "Provider is not configured"),
          );
        },
      }),
    });

    const progress = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(evaluations).toBe(1);
    expect(progress).toMatchObject({
      state: "failed",
      pairCount: 3,
      completedPairs: 1,
      failedPairs: 1,
      stopReason: "provider-unconfigured",
    });
  });

  test("ordinary gateway failures remain pair-local and have no provider stop reason", async () => {
    const capture = fixture(["a", "b", "c"]);
    const { cache } = cacheFake();
    let evaluations = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: () => ({
        evaluatePair: () => {
          evaluations++;
          return Promise.reject(new JevGatewayError("http-failure", "Temporary fake failure"));
        },
      }),
    });

    const progress = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(evaluations).toBe(3);
    expect(progress.state).toBe("failed");
    expect(progress.failedPairs).toBe(3);
    expect(progress.stopReason).toBeUndefined();
  });

  test("logs safe continue disposition after an invalid provider response and processes later pairs", async () => {
    const capture = fixture(["a", "b", "c"]);
    capture.collection.games = capture.collection.games.map((entry) => ({
      ...entry,
      name: "PRIVATE_PAIR_NAME_SENTINEL",
      bggData: entry.bggData ? { ...entry.bggData, description: "PRIVATE_SOURCE_SENTINEL" } : null,
    }));
    const { cache } = cacheFake();
    const logEntries: unknown[][] = [];
    let evaluations = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
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
            start: () => ({ response: Promise.resolve(new Response()) }),
          });
          if (evaluations === 1)
            throw new JevGatewayError("response-invalid", "Malformed synthetic provider result");
          return scoreResult();
        },
      }),
    });

    const progress = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(progress).toMatchObject({
      state: "failed",
      pairCount: 3,
      completedPairs: 3,
      failedPairs: 1,
    });
    expect(evaluations).toBe(3);
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
    const capture = fixture();
    const { cache, rows } = cacheFake();
    let attempts = 0;
    let starts = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          void request;
          for (let i = 0; i < 2; i++) {
            await admit({
              mode: "description-only",
              attemptId: `attempt-${i}`,
              start: () => {
                starts++;
                return { response: Promise.resolve(new Response()) };
              },
            });
            attempts++;
          }
          return scoreResult();
        },
      }),
    });
    const handle = service.startRun({ noteTransmissionAuthorized: false });
    const done = await handle.completion;
    expect(attempts).toBe(2);
    expect(starts).toBe(2);
    expect(done.completedPairs).toBe(1);
    expect(rows.size).toBe(1);
  });

  test("cancellation at the retry barrier prevents the next dispatch and checkpoint", async () => {
    const capture = fixture();
    const { cache, rows } = cacheFake();
    let cancel = () => {};
    let starts = 0;
    let admissionCount = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
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
    const handle = service.startRun({ noteTransmissionAuthorized: false });
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
    const capture = fixture();
    const cache = await createJevPairCache(dir);
    let dispatches = 0;
    try {
      const service = new JevRunService({
        storageService: {},
        cache,
        loadCapture: () => Promise.resolve(capture),
        readCurrent: () =>
          Promise.resolve({
            collection: capture.collection,
            sourceVectorIdentity: "vector",
            policyIdentity: "policy",
            canTransmitNotes: false,
          }),
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
      const result = await service.startRun({ noteTransmissionAuthorized: false }).completion;
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
      const base = fixture();
      const cache = await createJevPairCache(dir);
      const notedGames = base.collection.games.map((entry, index) => ({
        ...entry,
        ownerNote: {
          state: "present" as const,
          version: 1,
          updatedAt: "2026-01-01T00:00:00Z",
          text: `synthetic note ${index}`,
        },
      }));
      let stored: Collection = {
        ...base.collection,
        games: notedGames,
        semanticRedundancy: {
          ...base.collection.semanticRedundancy,
          settings: {
            enabled: true,
            weights: before,
            cachedOwnerNoteUse: true,
          },
        },
      };
      const storageService = {
        loadCollection: () => Promise.resolve(structuredClone(stored)),
        saveCollection: (next: Collection) => {
          stored = structuredClone(next);
          return Promise.resolve();
        },
      };
      const mutations = createCollectionMutationService({ storageService, jevPairCache: cache });
      const semanticState = createSemanticRedundancyStateService({
        collectionMutationService: mutations,
      });
      let providerCalls = 0;
      const loadCapture = (): Promise<JevRunCapture> =>
        Promise.resolve({
          ...base,
          collection: structuredClone(stored),
          policyIdentity: `policy-${stored.semanticRedundancy.consentEpoch}`,
        });
      const service = new JevRunService({
        storageService,
        cache,
        loadCapture,
        readCurrent: () =>
          Promise.resolve({
            collection: structuredClone(stored),
            sourceVectorIdentity: "vector",
            policyIdentity: `policy-${stored.semanticRedundancy.consentEpoch}`,
            canTransmitNotes: true,
          }),
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
        const first = await service.startRun({ noteTransmissionAuthorized: true }).completion;
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
        const cachedOwnerNoteEpoch = stored.semanticRedundancy.ownerNoteConsentEpoch;
        const initialIdentity = computeJevPairCoverage({
          collection: stored,
          predictionCapture: base.predictionCapture,
          captureIdentity: base.captureIdentity,
          factualWeights: base.factualWeights,
          cache,
        }).identity;

        const updateWeights = async (weights: SemanticRedundancySettings["weights"]) => {
          const current = stored.semanticRedundancy;
          const result = await semanticState.updateSettings(
            { evidenceEpoch: current.evidenceEpoch, consentEpoch: current.consentEpoch },
            { ...current.settings, weights },
          );
          expect(result.outcome).toBe("accepted");
        };
        await updateWeights({ factual: 3, description: 0, ownerNote: 0 });
        const zeroRun = await service.startRun({ noteTransmissionAuthorized: true }).completion;
        expect(zeroRun.state).toBe("completed");
        expect(providerCalls).toBe(1);

        await updateWeights(after);
        const finalRun = await service.startRun({ noteTransmissionAuthorized: true }).completion;
        expect(finalRun.state).toBe("completed");
        expect(finalRun.cacheHits).toBe(1);
        expect(providerCalls).toBe(1);
        expect(stored.semanticRedundancy.ownerNoteConsentEpoch).toBe(cachedOwnerNoteEpoch);

        const freshCoverage = computeJevPairCoverage({
          collection: stored,
          predictionCapture: base.predictionCapture,
          captureIdentity: base.captureIdentity,
          factualWeights: base.factualWeights,
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
        const freshScores = computeRedundancyAdjustments(
          [...base.predictionCapture],
          {
            ...DEFAULT_REDUNDANCY_SETTINGS,
            enabled: true,
            similarityThreshold: 0,
            minNeighbors: 1,
          },
          () => ({ binary: [], continuous: [], personalAxes: [] }),
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
    const capture = fixture();
    const cache = await createJevPairCache(dir);
    const storageService = {};
    const coordinator = profileSourceCoordinatorFor(storageService);
    const revision = cache.mutationRevision.bind(cache);
    let revisionReads = 0;
    let purgePromise: Promise<void> | undefined;
    cache.mutationRevision = () => {
      const current = revision();
      revisionReads++;
      if (revisionReads === 2) {
        // Models purge succeeding under the shared coordinator while collection persistence fails:
        // authoritative source identity remains unchanged, but cached coverage was withdrawn.
        purgePromise = coordinator.runExclusive(async () => {
          cache.purgePair("a", "b", "C");
          await Promise.resolve();
        });
      }
      return current;
    };
    try {
      const service = new JevRunService({
        storageService,
        cache,
        loadCapture: () => Promise.resolve(capture),
        readCurrent: () =>
          Promise.resolve({
            collection: capture.collection,
            sourceVectorIdentity: "vector",
            policyIdentity: "policy",
            canTransmitNotes: false,
          }),
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
      const result = await service.startRun({ noteTransmissionAuthorized: false }).completion;
      await purgePromise;
      expect(result.state).toBe("completed");
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
      expect(cache.getActivation()).toBeNull();
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("three eligible games with one genuinely missing description can complete coverage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-missing-description-"));
    const capture = fixture(["a", "b", "c"]);
    capture.collection.games[2].bggData = null;
    const cache = await createJevPairCache(dir);
    let dispatches = 0;
    let captureLoads = 0;
    let scopePlans = 0;
    try {
      const service = new JevRunService({
        storageService: {},
        cache,
        loadCapture: () => {
          captureLoads++;
          return Promise.resolve(capture);
        },
        readCurrent: () =>
          Promise.resolve({
            collection: capture.collection,
            sourceVectorIdentity: "vector",
            policyIdentity: "policy",
            canTransmitNotes: false,
          }),
        planScope: (collection, predictionCapture) => {
          scopePlans++;
          return planJevRunScope(collection, predictionCapture);
        },
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
      const result = await service.startRun({ noteTransmissionAuthorized: false }).completion;
      expect(dispatches).toBe(1);
      expect(captureLoads).toBe(2);
      expect(scopePlans).toBe(1);
      expect(result.pairCount).toBe(3);
      expect(result.failedPairs).toBe(0);
      expect(result.state).toBe("completed");
      const coverage = computeJevPairCoverage({
        collection: capture.collection,
        predictionCapture: capture.predictionCapture,
        captureIdentity: capture.captureIdentity,
        factualWeights: capture.factualWeights,
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
    const original = fixture();
    const expandedBase = fixture(["a", "b", "c"]);
    const expanded = {
      ...expandedBase,
      sourceVectorIdentity: "vector-after-addition",
      captureIdentity: {
        ...expandedBase.captureIdentity,
        sourceVectorIdentity: "vector-after-addition",
      },
    };
    let current = original;
    let captureCalls = 0;
    let dispatches = 0;
    const cache = await createJevPairCache(dir);
    try {
      const service = new JevRunService({
        storageService: {},
        cache,
        loadCapture: () => {
          captureCalls++;
          if (captureCalls === 2) current = expanded;
          return Promise.resolve(current);
        },
        readCurrent: () =>
          Promise.resolve({
            collection: current.collection,
            sourceVectorIdentity: current.sourceVectorIdentity,
            policyIdentity: "policy",
            canTransmitNotes: false,
          }),
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
      const result = await service.startRun({ noteTransmissionAuthorized: false }).completion;
      expect(dispatches).toBe(1);
      expect(result.state).toBe("completed");
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })?.value).toBe(0.5);
      expect(cache.lookup({ gameAId: "a", gameBId: "c", signal: "C" })).toBeNull();
      expect(cache.getActivation()).toBeNull();
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cancellation while final coherent capture is pending fences activation", async () => {
    const capture = fixture();
    const { cache, progress } = cacheFake();
    let captureCalls = 0;
    let finalCaptureReady!: () => void;
    let releaseFinalCapture!: () => void;
    const finalCaptureBarrier = new Promise<void>((resolve) => {
      finalCaptureReady = resolve;
    });
    const finalCapturePending = new Promise<JevRunCapture>((resolve) => {
      releaseFinalCapture = () => resolve(capture);
    });
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => {
        captureCalls++;
        if (captureCalls === 2) {
          finalCaptureReady();
          return finalCapturePending;
        }
        return Promise.resolve(capture);
      },
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          await admit({
            mode: "description-only",
            attemptId: "final-barrier",
            start: () => ({ response: Promise.resolve(new Response()) }),
          });
          return scoreResult();
        },
      }),
    });
    const handle = service.startRun({ noteTransmissionAuthorized: false });
    await finalCaptureBarrier;
    handle.cancel();
    releaseFinalCapture();
    const result = await handle.completion;
    expect(result.state).toBe("interrupted");
    expect(progress.at(-1)?.state).toBe("interrupted");
  });

  test("cancellation while final readCurrent is pending persists interrupted status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-final-read-cancel-"));
    const capture = fixture();
    const cache = await createJevPairCache(dir);
    let currentReads = 0;
    let finalReadStarted!: () => void;
    let releaseFinalRead!: () => void;
    const barrier = new Promise<void>((resolve) => {
      finalReadStarted = resolve;
    });
    const pendingRead = new Promise<void>((resolve) => {
      releaseFinalRead = resolve;
    });
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: async () => {
        currentReads++;
        if (currentReads === 7) {
          finalReadStarted();
          await pendingRead;
        }
        return {
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        };
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
      const handle = service.startRun({ noteTransmissionAuthorized: false });
      await barrier;
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })?.value).toBe(0.5);
      handle.cancel();
      releaseFinalRead();
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
    const capture = fixture();
    const { cache, progress } = cacheFake();
    let currentPolicy = "policy";
    let captureCalls = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => {
        captureCalls++;
        if (captureCalls === 2) currentPolicy = "changed-policy";
        return Promise.resolve(capture);
      },
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: currentPolicy,
          canTransmitNotes: false,
        }),
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
    const result = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(result.state).toBe("failed");
    expect(progress.at(-1)?.state).toBe("failed");
    expect(cache.getActivation()).toBeNull();
  });

  test("startup reconciliation does not interfere with an active process-local run", async () => {
    const capture = fixture();
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
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gateways = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: async () => {
        await pending;
        return capture;
      },
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: () => {
        gateways++;
        return { evaluatePair: () => Promise.resolve(scoreResult()) };
      },
    });
    const handle = service.startRun({ noteTransmissionAuthorized: false });
    const reconciled = await service.reconcileInterruptedProgress();
    expect(reconciled?.state).toBe("running");
    release();
    await handle.completion;
    expect(gateways).toBe(1);
    expect(progress.at(-1)?.state).not.toBe("interrupted");
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
    const capture = fixture();
    for (const [index, game] of capture.collection.games.entries()) {
      game.ownerNote = {
        state: "present",
        version: 1,
        updatedAt: "before",
        text: `private-${index}`,
      };
    }
    capture.collection.semanticRedundancy.settings = {
      enabled: true,
      weights: { factual: 0, description: 0, ownerNote: 1 },
      cachedOwnerNoteUse: true,
    };
    const cache = await createJevPairCache(dir);
    let starts = 0;
    let retryRejected = false;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: capture.sourceVectorIdentity,
          policyIdentity: "policy",
          canTransmitNotes: true,
        }),
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
          capture.collection.games[0].ownerNote = {
            state: "present",
            version: 2,
            updatedAt: "after",
            text: "edited-private-note",
          };
          capture.sourceVectorIdentity = "vector-after-note-edit";
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
      const result = await service.startRun({ noteTransmissionAuthorized: true }).completion;
      expect(starts).toBe(1);
      expect(retryRejected).toBe(true);
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "D" })).toBeNull();
      expect(result.state).toBe("failed");
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an unrelated source edit does not fence a retry for an unchanged pair", async () => {
    const capture = fixture(["a", "b", "c"]);
    const { cache, rows } = cacheFake();
    let starts = 0;
    let evaluations = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: capture.sourceVectorIdentity,
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          evaluations++;
          await admit({
            mode: "description-only",
            attemptId: "unrelated-first",
            start: () => {
              starts++;
              return { response: Promise.resolve(new Response()) };
            },
          });
          if (evaluations === 1) {
            capture.collection.games[2].name = "Unrelated renamed game";
            capture.sourceVectorIdentity = "vector-after-unrelated-edit";
            await admit({
              mode: "description-only",
              attemptId: "unrelated-retry",
              start: () => {
                starts++;
                return { response: Promise.resolve(new Response()) };
              },
            });
          }
          return scoreResult();
        },
      }),
    });
    await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(starts).toBe(2);
    expect(rows.has("abC")).toBe(true);
  });

  test("unrelated edit racing checkpoint capture retries and checkpoints unchanged pair", async () => {
    const capture = fixture(["a", "b", "c"]);
    const { cache, rows } = cacheFake();
    let vector = "vector";
    let reads = 0;
    let loads = 0;
    let scopePlans = 0;
    let dispatches = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => {
        loads++;
        return Promise.resolve(structuredClone({ ...capture, sourceVectorIdentity: vector }));
      },
      readCurrent: () => {
        reads++;
        if (reads === 6) {
          capture.collection.games[2].name = "Edited unrelated source";
          vector = "vector-after-unrelated-edit";
        }
        return Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: vector,
          policyIdentity: "policy",
          canTransmitNotes: false,
        });
      },
      planScope: (collection, predictionCapture) => {
        scopePlans++;
        return planJevRunScope(collection, predictionCapture);
      },
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
          return scoreResult();
        },
      }),
    });
    await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(dispatches).toBe(1);
    expect(loads).toBe(2);
    expect(scopePlans).toBe(2);
    expect(rows.has("abC")).toBe(true);
  });

  test("refreshed ownership scope is installed before skipping original pairs", async () => {
    const original = fixture(["a", "b", "c"]);
    const refreshedCollection = structuredClone(original.collection);
    refreshedCollection.games[0].ownership = "previously-owned";
    const refreshed = {
      ...original,
      collection: refreshedCollection,
      predictionCapture: original.predictionCapture.map((entry) =>
        entry.game.id === "a"
          ? { ...entry, game: { ...entry.game, ownership: "previously-owned" as const } }
          : entry,
      ),
      sourceVectorIdentity: "vector-after-ownership-change",
      captureIdentity: {
        ...original.captureIdentity,
        sourceVectorIdentity: "vector-after-ownership-change",
      },
    };
    const { cache, rows } = cacheFake();
    let current = original;
    let initialAuthorityRead = true;
    const requests: string[] = [];
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(current === original ? original : refreshed),
      readCurrent: () => {
        if (initialAuthorityRead) {
          initialAuthorityRead = false;
          current = refreshed;
          return Promise.resolve({
            collection: original.collection,
            sourceVectorIdentity: "vector",
            policyIdentity: "policy",
            canTransmitNotes: false,
          });
        }
        return Promise.resolve({
          collection: current.collection,
          sourceVectorIdentity: current.sourceVectorIdentity,
          policyIdentity: "policy",
          canTransmitNotes: false,
        });
      },
      createGateway: (admit) => ({
        evaluatePair: async (request) => {
          if (request.mode !== "description-only")
            throw new Error("Unexpected note-bearing request");
          requests.push(`${request.gameA.name}/${request.gameB.name}`);
          await admit({
            mode: "description-only",
            attemptId: "refreshed-scope",
            start: () => ({ response: Promise.resolve(new Response()) }),
          });
          return scoreResult();
        },
      }),
    });
    const result = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(requests).toEqual(["Game b/Game c"]);
    expect(rows.has("abC")).toBe(false);
    expect(rows.has("acC")).toBe(false);
    expect(rows.has("bcC")).toBe(true);
    expect(cache.getActivation()).toBeNull();
    expect(result.state).toBe("failed");
  });

  test("checkpoint storage failure stops further paid requests", async () => {
    const capture = fixture(["a", "b", "c"]);
    const { cache } = cacheFake();
    cache.checkpointPair = () => {
      throw new Error("sqlite write failed");
    };
    let dispatches = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
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
    const result = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(dispatches).toBe(1);
    expect(result.state).toBe("failed");
  });

  test("prepared authorization is not replaced when source capture changes before first admission", async () => {
    const original = fixture();
    const planned = planJevRunScope(original.collection, original.predictionCapture);
    if (!planned.ok) throw new Error("Expected valid prepared scope");
    const changed = structuredClone(original);
    changed.collection.games[0].bggData = {
      ...changed.collection.games[0].bggData!,
      description: "changed before first admission",
    };
    changed.sourceVectorIdentity = "vector-after-edit";
    const originalFingerprint = planned.scope.sourceForGame("a")?.descriptionFingerprint;
    const changedPlan = planJevRunScope(changed.collection, changed.predictionCapture);
    if (!changedPlan.ok) throw new Error("Expected valid changed scope");
    expect(changedPlan.scope.sourceForGame("a")?.descriptionFingerprint).not.toBe(
      originalFingerprint,
    );
    let current = original;
    let reads = 0;
    let captureLoads = 0;
    let gatewayConstructions = 0;
    let starts = 0;
    const { cache, rows } = cacheFake();
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => {
        captureLoads++;
        return Promise.resolve(changed);
      },
      readCurrent: () => {
        reads++;
        if (reads >= 2) current = changed;
        return Promise.resolve({
          collection: current.collection,
          sourceVectorIdentity: current.sourceVectorIdentity,
          policyIdentity: "policy",
          canTransmitNotes: false,
        });
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

    const result = await runPreparedForTest(service, {
      capture: original,
      scope: planned.scope,
      noteTransmissionAuthorized: false,
    });

    expect(captureLoads).toBe(1);
    expect(gatewayConstructions).toBe(0);
    expect(starts).toBe(0);
    expect(rows.size).toBe(0);
    expect(planned.scope.sourceForGame("a")?.descriptionFingerprint).toBe(originalFingerprint);
    expect(result.state).toBe("failed");
  });

  test("prepared no-required-signal run never constructs its gateway", async () => {
    const capture = fixture();
    capture.collection.semanticRedundancy.settings.weights = {
      factual: 0,
      description: 0,
      ownerNote: 0,
    };
    const planned = planJevRunScope(capture.collection, capture.predictionCapture);
    if (!planned.ok) throw new Error("Expected valid prepared scope");
    const { cache } = cacheFake();
    let gatewayConstructions = 0;
    let captureLoads = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => {
        captureLoads++;
        return Promise.resolve(capture);
      },
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: capture.sourceVectorIdentity,
          policyIdentity: capture.policyIdentity,
          canTransmitNotes: false,
        }),
      createGateway: () => {
        gatewayConstructions++;
        return { evaluatePair: () => Promise.resolve(scoreResult()) };
      },
    });
    const result = await runPreparedForTest(service, {
      capture,
      scope: planned.scope,
      noteTransmissionAuthorized: false,
    });
    expect(gatewayConstructions).toBe(0);
    expect(captureLoads).toBe(1); // final coverage only; not a replacement start capture
    expect(result.state).toBe("completed");
  });

  test("prepared C-only pair with absent notes sends descriptions without note authorization", async () => {
    const capture = fixture();
    const planned = planJevRunScope(capture.collection, capture.predictionCapture);
    if (!planned.ok) throw new Error("Expected valid prepared scope");
    const { cache, rows } = cacheFake();
    let starts = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: capture.sourceVectorIdentity,
          policyIdentity: capture.policyIdentity,
          canTransmitNotes: false,
        }),
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
    const result = await runPreparedForTest(service, {
      capture,
      scope: planned.scope,
      noteTransmissionAuthorized: false,
    });
    expect(starts).toBe(1);
    expect(rows.has("abC")).toBe(true);
    expect(result.state).toBe("completed");
  });

  test("prepared scope mismatch fails closed before current-state read or gateway construction", async () => {
    const capture = fixture(["a", "b"]);
    const wrongCapture = fixture(["a", "c"]);
    const wrongPlan = planJevRunScope(wrongCapture.collection, wrongCapture.predictionCapture);
    if (!wrongPlan.ok) throw new Error("Expected valid mismatched scope");
    const { cache, rows } = cacheFake();
    let currentReads = 0;
    let gatewayConstructions = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.reject(new Error("Prepared execution must not recapture")),
      readCurrent: () => {
        currentReads++;
        return Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: capture.sourceVectorIdentity,
          policyIdentity: capture.policyIdentity,
          canTransmitNotes: false,
        });
      },
      createGateway: () => {
        gatewayConstructions++;
        return { evaluatePair: () => Promise.resolve(scoreResult()) };
      },
    });
    const reservation = await service.prepareValidatedPreparedRun({
      capture,
      scope: wrongPlan.scope,
      noteTransmissionAuthorized: false,
    });
    expect(reservation).toBeNull();
    expect(currentReads).toBe(0);
    expect(gatewayConstructions).toBe(0);
    expect(rows.size).toBe(0);
  });

  test("prepared scope validation yields outside the coordinator and reservation does no pair scan", async () => {
    const capture = fixture(Array.from({ length: 200 }, (_, index) => `game-${index}`));
    const planned = planJevRunScope(capture.collection, capture.predictionCapture);
    if (!planned.ok) throw new Error("Expected valid 200-game scope");
    const storage = {};
    const coordinator = profileSourceCoordinatorFor(storage);
    let currentVector = capture.sourceVectorIdentity;
    let mutationCompleted = false;
    let mutationDuringValidation = false;
    let validationInProgress = true;
    let mutationPromise: Promise<void> = Promise.resolve();
    let mutationQueued = false;
    let insideAdmission = false;
    let plannerCalls = 0;
    let plannersInsideAdmission = 0;
    const suppliedScope = Object.freeze({
      ...planned.scope,
      pairs: function* () {
        if (!mutationQueued) {
          mutationQueued = true;
          mutationPromise = coordinator.runExclusive(() => {
            currentVector = "source-mutated-during-preparation";
            mutationCompleted = true;
            mutationDuringValidation = validationInProgress;
            return Promise.resolve();
          });
        }
        yield* planned.scope.pairs();
      },
    });
    const { cache } = cacheFake();
    let gatewayConstructions = 0;
    const service = new JevRunService({
      storageService: storage,
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: currentVector,
          policyIdentity: capture.policyIdentity,
          canTransmitNotes: false,
        }),
      planScope: (collection, predictions) => {
        plannerCalls++;
        if (insideAdmission) plannersInsideAdmission++;
        return planJevRunScope(collection, predictions);
      },
      createGateway: () => {
        gatewayConstructions++;
        return { evaluatePair: () => Promise.resolve(scoreResult()) };
      },
    });

    const reservation = await service.prepareValidatedPreparedRun({
      capture,
      scope: suppliedScope,
      noteTransmissionAuthorized: false,
    });
    validationInProgress = false;
    expect(reservation).not.toBeNull();
    if (!mutationQueued) throw new Error("Expected validation-triggered source mutation");
    await mutationPromise;
    expect(mutationCompleted).toBe(true);
    expect(mutationDuringValidation).toBe(true);
    expect(plannerCalls).toBe(1);
    const plannerCountBeforeAdmission = plannerCalls;
    const reservedHandles: ReturnType<JevRunService["reserveValidatedPreparedRun"]>[] = [];
    await coordinator.runExclusive(() => {
      insideAdmission = true;
      try {
        reservedHandles.push(service.reserveValidatedPreparedRun(reservation!));
      } finally {
        insideAdmission = false;
      }
      return Promise.resolve();
    });
    expect(plannerCalls).toBe(plannerCountBeforeAdmission);
    expect(plannersInsideAdmission).toBe(0);
    const handle = reservedHandles[0];
    if (!handle) throw new Error("Expected synchronous active-run reservation");
    const progress = await handle.completion;
    expect(progress.state).toBe("failed");
    expect(gatewayConstructions).toBe(0);
  });

  test("run-progress storage failure before dispatch stops all paid requests", async () => {
    const capture = fixture(["a", "b", "c"]);
    const { cache } = cacheFake();
    const saveProgress = cache.saveRunProgress.bind(cache);
    let saves = 0;
    cache.saveRunProgress = (progress) => {
      saves++;
      if (saves === 2) throw new Error("one-shot progress persistence failure");
      saveProgress(progress);
    };
    let dispatches = 0;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
      createGateway: () => ({
        evaluatePair: () => {
          dispatches++;
          return Promise.resolve(scoreResult());
        },
      }),
    });
    const result = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(dispatches).toBe(0);
    expect(saves).toBe(2);
    expect(result.state).toBe("failed");
  });

  test("outcome progress write failure after malformed response blocks later pairs", async () => {
    const capture = fixture(["a", "b", "c"]);
    const { cache } = cacheFake();
    const saveProgress = cache.saveRunProgress.bind(cache);
    let saves = 0;
    cache.saveRunProgress = (progress) => {
      saves++;
      if (saves === 3) throw new Error("one-shot outcome persistence failure");
      saveProgress(progress);
    };
    let paidCalls = 0;
    const invalid = {
      ...scoreResult(),
      description: { ...scoreResult().description!, score: 2 },
    } as JevPairResult;
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(capture),
      readCurrent: () =>
        Promise.resolve({
          collection: capture.collection,
          sourceVectorIdentity: "vector",
          policyIdentity: "policy",
          canTransmitNotes: false,
        }),
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
    const result = await service.startRun({ noteTransmissionAuthorized: false }).completion;
    expect(paidCalls).toBe(1);
    expect(saves).toBe(3);
    expect(result.state).toBe("failed");
  });

  test("description edit before first admission fences changed pairs but preserves unchanged pair", async () => {
    const original = fixture(["a", "b", "c"]);
    const edited = structuredClone(original);
    edited.collection.games[0].bggData!.description = "edited description before admission";
    edited.sourceVectorIdentity = "vector-after-description-edit";
    edited.captureIdentity = {
      ...edited.captureIdentity,
      sourceVectorIdentity: "vector-after-description-edit",
    };
    let current = original;
    let initialReadStarted!: () => void;
    let releaseInitialRead!: () => void;
    const initialReadBarrier = new Promise<void>((resolve) => {
      initialReadStarted = resolve;
    });
    const initialReadPending = new Promise<void>((resolve) => {
      releaseInitialRead = resolve;
    });
    let reads = 0;
    const { cache, rows } = cacheFake();
    const dispatched: string[] = [];
    const dispatchedDescriptions: string[] = [];
    const service = new JevRunService({
      storageService: {},
      cache,
      loadCapture: () => Promise.resolve(current),
      readCurrent: async () => {
        reads++;
        if (reads === 1) {
          initialReadStarted();
          await initialReadPending;
          return {
            collection: original.collection,
            sourceVectorIdentity: original.sourceVectorIdentity,
            policyIdentity: "policy",
            canTransmitNotes: false,
          };
        }
        return {
          collection: current.collection,
          sourceVectorIdentity: current.sourceVectorIdentity,
          policyIdentity: "policy",
          canTransmitNotes: false,
        };
      },
      createGateway: (admit) => ({
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
      }),
    });
    const handle = service.startRun({ noteTransmissionAuthorized: false });
    await initialReadBarrier;
    current = edited;
    releaseInitialRead();
    const result = await handle.completion;
    expect(dispatched).toEqual(["Game b/Game c"]);
    expect(dispatched).not.toContain("Game a/Game b");
    expect(dispatched).not.toContain("Game a/Game c");
    expect(dispatchedDescriptions).not.toContain("desc a");
    expect(dispatchedDescriptions).not.toContain("edited description before admission");
    expect(rows.has("bcC")).toBe(true);
    expect(result.state).toBe("failed");
  });

  test("source and permission mutation under shared coordinator fences pending C and D result", async () => {
    const storageService = {};
    const coordinator = profileSourceCoordinatorFor(storageService);
    const capture = fixture();
    for (const [index, capturedGame] of capture.collection.games.entries()) {
      capturedGame.ownerNote = {
        state: "present",
        version: 1,
        updatedAt: "before",
        text: `private-${index}`,
      };
    }
    capture.collection.semanticRedundancy.settings = {
      enabled: true,
      weights: { factual: 0, description: 1, ownerNote: 1 },
      cachedOwnerNoteUse: true,
    };
    const editedCapture = structuredClone(capture);
    editedCapture.collection.games[0].ownerNote = {
      state: "present",
      version: 2,
      updatedAt: "after",
      text: "changed while provider pending",
    };
    editedCapture.sourceVectorIdentity = "vector-after-note-edit";
    editedCapture.captureIdentity = {
      ...editedCapture.captureIdentity,
      sourceVectorIdentity: "vector-after-note-edit",
    };
    const { cache, rows } = cacheFake();
    let currentCapture = capture;
    let sourceIdentity = "vector";
    let canTransmitNotes = true;
    let captureLoads = 0;
    let providerStarted!: () => void;
    let resolveProvider!: (response: Response) => void;
    const providerBarrier = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const providerResponse = new Promise<Response>((resolve) => {
      resolveProvider = resolve;
    });
    let mutationCompleted = false;
    const service = new JevRunService({
      storageService,
      cache,
      loadCapture: () => {
        captureLoads++;
        return Promise.resolve(currentCapture);
      },
      readCurrent: () =>
        Promise.resolve({
          collection: currentCapture.collection,
          sourceVectorIdentity: sourceIdentity,
          policyIdentity: "policy",
          canTransmitNotes,
        }),
      createGateway: (admit) => ({
        evaluatePair: async () => {
          const receipt = await admit({
            mode: "description-and-owner-notes",
            attemptId: "pending-provider",
            start: () => {
              providerStarted();
              return { response: providerResponse };
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
    const handle = service.startRun({ noteTransmissionAuthorized: true });
    await providerBarrier;
    await coordinator.runExclusive(async () => {
      currentCapture = editedCapture;
      sourceIdentity = "vector-after-note-edit";
      canTransmitNotes = false;
      mutationCompleted = true;
      await Promise.resolve();
    });
    expect(mutationCompleted).toBe(true);
    resolveProvider(new Response());
    const result = await handle.completion;
    expect(captureLoads).toBe(2);
    expect(rows.size).toBe(0);
    expect(cache.getActivation()).toBeNull();
    expect(result.state).toBe("failed");
  });

  test("SQLite interrupted run reopens without provider work and fresh run fills only missing pairs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-run-sqlite-resume-"));
    const capture = fixture(["a", "b", "c"]);
    const storageService = {};
    let providerCalls = 0;
    const requestedPairs: string[] = [];
    let secondProviderStarted!: () => void;
    const secondProviderBarrier = new Promise<void>((resolve) => {
      secondProviderStarted = resolve;
    });
    let resolveSecondProvider!: (response: Response) => void;
    const secondProviderResponse = new Promise<Response>((resolve) => {
      resolveSecondProvider = resolve;
    });
    const makeService = (cache: JevPairCache, pauseSecondRequest: boolean) =>
      new JevRunService({
        storageService,
        cache,
        loadCapture: () => Promise.resolve(capture),
        readCurrent: () =>
          Promise.resolve({
            collection: capture.collection,
            sourceVectorIdentity: capture.sourceVectorIdentity,
            policyIdentity: "policy",
            canTransmitNotes: false,
          }),
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
                  secondProviderStarted();
                  return { response: secondProviderResponse };
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
    try {
      const firstService = makeService(cache, true);
      const interruptedHandle = firstService.startRun({ noteTransmissionAuthorized: false });
      await secondProviderBarrier;
      interruptedHandle.cancel();
      resolveSecondProvider(new Response());
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
      const reopenedService = makeService(cache, false);
      const startupProgress = await reopenedService.reconcileInterruptedProgress();
      expect(startupProgress?.state).toBe("interrupted");
      expect(cache.getRunProgress()?.state).toBe("interrupted");
      expect(providerCalls).toBe(2);
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })?.value).toBe(0.5);

      const resumed = await reopenedService.startRun({ noteTransmissionAuthorized: false })
        .completion;
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
