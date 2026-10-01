import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Collection,
  GameWithScore,
  PredictionSettings,
  RedundancySettings,
  TournamentData,
} from "@shelf-judge/shared";
import { createInitialSemanticRedundancyStateV10 } from "@shelf-judge/shared";
import {
  composeJevStatusService,
  createJevRunWorker,
  recoverJevRunOnStartup,
} from "../src/index.js";
import { createJevPairCache } from "../src/services/jev-pair-cache-service.js";
import type { JevPairCache } from "../src/services/jev-pair-cache-service.js";
import type { JevRunHandle } from "../src/services/jev-run-service.js";
import { canonicalSha256 } from "../src/services/profile-source-coordinator.js";
import type { StorageService } from "../src/services/storage-service.js";
import type { SourceVector } from "../src/services/source-vector.js";
import { JEV_MODEL_ID } from "../src/services/jev/jev-gateway.js";
import { createRedundancyRoutes } from "../src/routes/redundancy.js";

const originalApiKey = process.env.TYPESAFE_API_KEY;
afterEach(() => {
  if (originalApiKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = originalApiKey;
});

function runtimeSources() {
  const semanticRedundancy = {
    ...createInitialSemanticRedundancyStateV10(),
    settings: {
      enabled: true,
      weights: { factual: 0, description: 1, ownerNote: 0 },
      cachedOwnerNoteUse: false,
    },
  };
  const collection = {
    id: "composition-test",
    name: "composition test",
    schemaVersion: 10,
    revision: 1,
    axes: [],
    games: ["a", "b"].map((id) => ({
      id,
      name: `Game ${id}`,
      ownership: "owned",
      bggData: { description: `Description ${id}` },
      ownerNote: { state: "cleared", version: 0, updatedAt: "test" },
    })),
    semanticRedundancy,
  } as unknown as Collection;
  const factualWeights = { binary: 0, continuous: 0 };
  const vector: SourceVector = {
    available: true,
    unavailableSources: [],
    processEpoch: "composition-test-process",
    changeToken: 1,
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    collectionRevision: collection.revision,
    semanticEvidenceEpoch: semanticRedundancy.evidenceEpoch,
    semanticConsentEpoch: semanticRedundancy.consentEpoch,
    factualWeightsEpoch: semanticRedundancy.factualWeightsEpoch,
    factualWeightsFingerprint: semanticRedundancy.factualWeightsFingerprint,
    redundancyWeightsFingerprint: canonicalSha256(factualWeights),
    tournamentRevision: 1,
    predictionSettingsRevision: 1,
    nicheSettingsRevision: 1,
    redundancySettingsRevision: 1,
    shelfConfigRevision: 1,
    representationVersion: 1,
    algorithmVersion: 1,
  };
  const tournament = { settings: {}, sessions: [], gameStats: {} } as unknown as TournamentData;
  const predictionSettings: PredictionSettings = {
    stageThresholds: [5, 15, 30],
    defaultK: 5,
    minSimilarityThreshold: 0.2,
  };
  const redundancySettings: RedundancySettings = {
    enabled: false,
    stage: "annotation",
    similarityThreshold: 0.7,
    maxPenalty: 0.2,
    componentWeights: factualWeights,
    minNeighbors: 2,
    expectedNeighbors: 5,
  };
  const storage = {
    loadCollection: () => Promise.resolve(structuredClone(collection)),
    loadTournament: () => Promise.resolve(structuredClone(tournament)),
    loadPredictionSettings: () => Promise.resolve(structuredClone(predictionSettings)),
    loadRedundancySettings: () => Promise.resolve(structuredClone(redundancySettings)),
    saveCollection: () => Promise.resolve(),
    sourceVector: () => structuredClone(vector),
  } as unknown as StorageService;
  const predictionService = {
    listGamesWithPredictionsFromSnapshot: (snapshot: Collection) =>
      Promise.resolve(
        snapshot.games.map((game) => ({
          game: { id: game.id, ownership: game.ownership },
          score: { score: 1, vetoed: false, ratedAxisCount: 1, predictionMeta: null },
        })) as unknown as GameWithScore[],
      ),
  } as unknown as Parameters<typeof createJevRunWorker>[0]["predictionService"];
  return { storage, predictionService };
}

function gatewayResponse(): Response {
  const legend = [
    "The descriptions portray unrelated premises and activities.",
    "They share a broad theme or activity but portray substantially different premises.",
    "They portray substantially similar premises and activities, with meaningful differences.",
    "They portray very similar premises and activities, with only minor differences.",
  ];
  return Response.json({
    model: JEV_MODEL_ID,
    answers: {
      description_similarity: {
        type: "score",
        score: 1,
        legend: Object.fromEntries(legend.map((entry, index) => [String(index), entry])),
        probabilities: { "0": 0, "1": 1, "2": 0, "3": 0 },
        confidence: 0.8,
      },
    },
    usage: { input_tokens: 10, output_tokens: 5 },
  });
}

describe("Jev run production composition", () => {
  test("composes aggregate status with the actual source adapter when lifecycle cache is absent", async () => {
    const sources = runtimeSources();
    sources.storage.loadRedundancySettings = () =>
      Promise.resolve({
        enabled: true,
        stage: "annotation",
        similarityThreshold: 0.7,
        maxPenalty: 0.2,
        componentWeights: { binary: 0, continuous: 0 },
        minNeighbors: 2,
        expectedNeighbors: 5,
      });
    let predictionCalls = 0;
    const predictionService = {
      listGamesWithPredictionsFromSnapshot: () => {
        predictionCalls++;
        return Promise.resolve([]);
      },
    } as unknown as typeof sources.predictionService;
    const statusService = composeJevStatusService({
      storageService: sources.storage,
      predictionService,
      cache: null,
    });

    expect(statusService).not.toBeNull();
    const { routes } = createRedundancyRoutes({
      storageService: sources.storage,
      jevStatusService: statusService!,
    });
    const app = new Hono();
    app.route("/api", routes);
    const response = await app.request("/api/redundancy/semantic/refresh-status");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "not-ready",
      measurement: "cache-unavailable",
      eligibleGameCount: null,
      pairCount: null,
      coverage: null,
    });
    expect(predictionCalls).toBe(0);
  });

  test("unavailable lifecycle cache produces no worker and startup recovery is skipped", async () => {
    let predictionCalls = 0;
    const sources = runtimeSources();
    const worker = createJevRunWorker({
      storageService: sources.storage,
      predictionService: sources.predictionService,
      cache: { available: false } as JevPairCache,
      fetch: () => {
        predictionCalls++;
        return Promise.resolve(gatewayResponse());
      },
    });
    const events: unknown[][] = [];
    await recoverJevRunOnStartup(worker, {
      log: (...args) => events.push(args),
      error: (...args) => events.push(args),
    });
    expect(worker).toBeNull();
    expect(predictionCalls).toBe(0);
    expect(events.some((event) => JSON.stringify(event).includes("no-usable-cache-worker"))).toBe(
      true,
    );
  });

  test("startup reconciliation interrupts prior progress without transport or predictions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-run-startup-recovery-"));
    const cache = await createJevPairCache(directory);
    const sources = runtimeSources();
    let transportCalls = 0;
    let predictionCalls = 0;
    const predictionService = {
      listGamesWithPredictionsFromSnapshot: (
        ...args: Parameters<
          NonNullable<typeof sources.predictionService.listGamesWithPredictionsFromSnapshot>
        >
      ) => {
        predictionCalls++;
        return sources.predictionService.listGamesWithPredictionsFromSnapshot!(...args);
      },
    } as unknown as typeof sources.predictionService;
    cache.saveRunProgress({
      runId: "interrupted-before-restart",
      state: "running",
      pairCount: 1,
      completedPairs: 0,
      cacheHits: 0,
      cacheMisses: 1,
      failedPairs: 0,
      updatedAt: "before-restart",
    });
    try {
      const worker = createJevRunWorker({
        storageService: sources.storage,
        predictionService,
        cache,
        fetch: () => {
          transportCalls++;
          return Promise.resolve(gatewayResponse());
        },
      });
      expect(worker).not.toBeNull();
      await recoverJevRunOnStartup(worker);
      expect(cache.getRunProgress()?.state).toBe("interrupted");
      expect(transportCalls).toBe(0);
      expect(predictionCalls).toBe(0);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("each explicit run creates a gated gateway that uses only the fake transport", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-run-explicit-composition-"));
    const cache = await createJevPairCache(directory);
    const sources = runtimeSources();
    let transportCalls = 0;
    let handle: JevRunHandle | null = null;
    process.env.TYPESAFE_API_KEY = "composition-test-key";
    try {
      const worker = createJevRunWorker({
        storageService: sources.storage,
        predictionService: sources.predictionService,
        cache,
        fetch: () => {
          transportCalls++;
          // The gateway's one-shot fetch is initiated by the worker's admission hook.
          handle?.cancel();
          return Promise.resolve(gatewayResponse());
        },
      });
      expect(worker).not.toBeNull();
      expect(transportCalls).toBe(0);
      handle = worker!.startRun({ noteTransmissionAuthorized: false });
      const progress = await handle.completion;
      expect(transportCalls).toBe(1);
      expect(progress.state).toBe("interrupted");
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
