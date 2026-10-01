import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Collection, GameWithScore, RedundancySettings } from "@shelf-judge/shared";
import { createInitialSemanticRedundancyStateV10 } from "@shelf-judge/shared";
import {
  createJevPairCache,
  type JevPairCache,
  type JevPairJudgment,
} from "../../src/services/jev-pair-cache-service.js";
import { computeJevPairCoverage } from "../../src/services/jev-pair-coverage.js";
import { buildJevPairDependencies } from "../../src/services/jev-pair-identity.js";
import { JEV_JUDGMENT_CONTRACT } from "../../src/services/jev/jev-judgment-contract.js";
import type { JevRunSourceAdapter } from "../../src/services/jev-run-source-adapter.js";
import { createJevStatusService } from "../../src/services/jev-status-service.js";

const dirs: string[] = [];
afterEach(async () =>
  Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))),
);

function fixture(gameIds: string[] = []) {
  const semantic = {
    ...createInitialSemanticRedundancyStateV10(),
    evidenceEpoch: 1,
    consentEpoch: 2,
    factualWeightsEpoch: 1,
    factualWeightsFingerprint: "factual-v1",
    settings: {
      enabled: true,
      weights: { factual: 0, description: 1, ownerNote: 0 },
      cachedOwnerNoteUse: false,
    },
  };
  const collection = {
    id: "status-fixture",
    name: "status fixture",
    schemaVersion: 10,
    revision: 1,
    axes: [],
    games: gameIds.map((id) => ({
      id,
      name: `Game ${id}`,
      ownership: "owned",
      bggData: {
        description: `Description ${id}`,
        mechanics: [],
        categories: [],
        communityRating: 5,
        bayesAverage: 5,
        weight: 2,
      },
      minPlayers: 2,
      maxPlayers: 4,
      bestPlayers: null,
      playingTime: 60,
      ratings: {},
      ownerNote: { state: "cleared", version: 0, updatedAt: "fixture" },
    })),
    semanticRedundancy: semantic,
  } as unknown as Collection;
  const predictionCapture = collection.games.map((game) => ({
    game: { id: game.id, ownership: game.ownership },
    score: { score: 1, vetoed: false, ratedAxisCount: 1, predictionMeta: null },
  })) as unknown as GameWithScore[];
  const capture = {
    collection,
    predictionCapture,
    factualWeights: { binary: 0, continuous: 0 },
    captureIdentity: {
      sourceVectorIdentity: "vector",
      tournamentIdentity: "tournament",
      predictionCaptureIdentity: "predictions",
    },
    sourceVectorIdentity: "live-vector",
    policyIdentity: "policy",
  };
  const redundancySettings = {
    enabled: true,
    componentWeights: { binary: 0, continuous: 0 },
  } as RedundancySettings;
  const storage = {
    loadCollection: () => Promise.resolve(structuredClone(collection)),
    loadRedundancySettings: () => Promise.resolve(structuredClone(redundancySettings)),
  };
  let loadCount = 0;
  let currentVector = "live-vector";
  let currentPolicy = "policy";
  let loadFails = false;
  const sourceAdapter: JevRunSourceAdapter = {
    loadCapture: () => {
      loadCount++;
      if (loadFails) return Promise.reject(new Error("source unavailable"));
      return Promise.resolve(structuredClone(capture));
    },
    readCurrent: () =>
      Promise.resolve({
        collection: structuredClone(collection),
        sourceVectorIdentity: currentVector,
        policyIdentity: currentPolicy,
        canTransmitNotes: false,
      }),
  };
  return {
    capture,
    storage,
    sourceAdapter,
    get loadCount() {
      return loadCount;
    },
    set currentVector(value: string) {
      currentVector = value;
    },
    set currentPolicy(value: string) {
      currentPolicy = value;
    },
    set factualEnabled(value: boolean) {
      redundancySettings.enabled = value;
    },
    disableSemantic() {
      collection.semanticRedundancy.settings.enabled = false;
    },
    zeroSemanticWeights() {
      collection.semanticRedundancy.settings.weights.description = 0;
      collection.semanticRedundancy.settings.weights.ownerNote = 0;
    },
    failSource() {
      loadFails = true;
    },
  };
}

async function cacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jev-status-"));
  dirs.push(dir);
  return dir;
}

describe("Jev status service", () => {
  test("measures an empty eligible universe as zero and reports persisted running progress historically", async () => {
    const f = fixture();
    const cache = await createJevPairCache(await cacheDir());
    const digest = computeJevPairCoverage({ ...f.capture, cache });
    cache.setActivation({ identity: digest.identity, activatedAt: "now" });
    cache.saveRunProgress({
      runId: "secret-run",
      state: "running",
      pairCount: 0,
      completedPairs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failedPairs: 0,
      updatedAt: "secret-time",
    });
    const status = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache,
    }).read();
    expect(status).toMatchObject({
      status: "ready",
      measurement: "current",
      eligibleGameCount: 0,
      pairCount: 0,
      coverage: { C: { covered: 0 }, D: { covered: 0 } },
      progress: { state: "last-known-running" },
    });
    expect(JSON.stringify(status)).not.toContain("secret");
    cache.close();
  });

  test("does no capture for disabled or factual status and returns null measurements", async () => {
    const f = fixture();
    const cache = await createJevPairCache(await cacheDir());
    f.factualEnabled = false;
    const disabled = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache,
    }).read();
    expect(disabled).toMatchObject({
      status: "disabled",
      measurement: "not-applicable",
      eligibleGameCount: null,
      pairCount: null,
      coverage: null,
    });
    expect(f.loadCount).toBe(0);
    f.factualEnabled = true;
    f.disableSemantic();
    const factual = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache,
    }).read();
    expect(factual).toMatchObject({
      status: "factual",
      measurement: "not-applicable",
      eligibleGameCount: null,
    });
    expect(f.loadCount).toBe(0);
    cache.close();
  });

  test("zero semantic weights are factual before cache or prediction traversal", async () => {
    const f = fixture(["a", "b"]);
    f.zeroSemanticWeights();
    const status = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache: null,
    }).read();
    expect(status).toMatchObject({
      status: "factual",
      measurement: "not-applicable",
      eligibleGameCount: null,
      pairCount: null,
      coverage: null,
    });
    expect(f.loadCount).toBe(0);
  });

  test("fails closed with null counts for unavailable cache or source", async () => {
    const f = fixture(["a", "b"]);
    const noCache = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache: null,
    }).read();
    expect(noCache).toMatchObject({
      status: "not-ready",
      measurement: "cache-unavailable",
      eligibleGameCount: null,
      pairCount: null,
      coverage: null,
    });
    const usableCache = await createJevPairCache(await cacheDir());
    const revisionUnknown: JevPairCache = {
      ...usableCache,
      mutationRevision: () => null,
    };
    const unknownRevision = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache: revisionUnknown,
    }).read();
    expect(unknownRevision).toMatchObject({
      status: "not-ready",
      measurement: "cache-unavailable",
      eligibleGameCount: null,
      pairCount: null,
      coverage: null,
    });
    expect(f.loadCount).toBe(0);
    usableCache.close();
    const cache = await createJevPairCache(await cacheDir());
    f.failSource();
    const noSource = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache,
    }).read();
    expect(noSource).toMatchObject({
      status: "unavailable",
      measurement: "source-unavailable",
      eligibleGameCount: null,
    });
    cache.close();
  });

  test("reports partial cache coverage without identifiers or note details", async () => {
    const f = fixture(["private-a", "private-b"]);
    const cache = await createJevPairCache(await cacheDir());
    const status = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache,
    }).read();
    expect(status).toMatchObject({
      status: "not-ready",
      measurement: "current",
      eligibleGameCount: 2,
      pairCount: 1,
      coverage: { C: { missing: 1 }, D: { unavailable: 1 } },
    });
    expect(JSON.stringify(status)).not.toContain("private-");
    cache.close();
  });

  test("reports ready coverage for a covered eligible pair", async () => {
    const f = fixture(["a", "b"]);
    const cache = await createJevPairCache(await cacheDir());
    const sources = f.capture.collection.games.map((game) => ({
      gameId: game.id,
      name: game.name,
      description: game.bggData!.description!,
    }));
    const judgment: JevPairJudgment = {
      collectionId: f.capture.collection.id,
      gameAId: "a",
      gameBId: "b",
      signal: "C",
      dependencyKind: "C_ONLY",
      value: 0.7,
      modelId: JEV_JUDGMENT_CONTRACT.modelId,
      rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
      questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
      requestSchemaVersion: JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
      scoreMappingVersion: JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
      semanticPolicyId: JEV_JUDGMENT_CONTRACT.semanticPolicyId,
      completedAt: "fixture-time",
      dependencies: buildJevPairDependencies("C_ONLY", sources[0], sources[1]),
    };
    cache.upsert(judgment);
    const digest = computeJevPairCoverage({ ...f.capture, cache });
    cache.setActivation({ identity: digest.identity, activatedAt: "now" });
    const status = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache,
    }).read();
    expect(status).toMatchObject({
      status: "ready",
      measurement: "current",
      eligibleGameCount: 2,
      pairCount: 1,
      coverage: { C: { covered: 1 }, D: { unavailable: 1 } },
    });
    cache.close();
  });

  test("source movement during final verification yields bounded source-unavailable result", async () => {
    const f = fixture(["a", "b"]);
    const cache = await createJevPairCache(await cacheDir());
    f.currentVector = "moved-vector";
    const status = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache,
    }).read();
    expect(status.measurement).toBe("source-unavailable");
    expect(status.eligibleGameCount).toBeNull();
    expect(f.loadCount).toBe(2);
    cache.close();
  });

  test("cache mutation during coverage causes retry rather than mixing revision snapshots", async () => {
    const f = fixture(["a", "b"]);
    const cache = await createJevPairCache(await cacheDir());
    let purged = false;
    const observedCache: JevPairCache = {
      ...cache,
      lookup(key) {
        const result = cache.lookup(key);
        if (!purged) {
          purged = true;
          cache.purgePair("a", "b");
        }
        return result;
      },
    };
    const status = await createJevStatusService({
      storageService: f.storage,
      sourceAdapter: f.sourceAdapter,
      cache: observedCache,
    }).read();
    expect(status.measurement).toBe("current");
    expect(status.pairCount).toBe(1);
    expect(f.loadCount).toBe(2);
    cache.close();
  });
});
