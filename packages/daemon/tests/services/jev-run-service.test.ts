import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Collection, DurableGame, GameWithScore } from "@shelf-judge/shared";
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
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import type { JevPairResult } from "../../src/services/jev/jev-gateway.js";
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

function cacheFake() {
  const progress: JevRunProgress[] = [];
  const rows = new Map<string, JevPairJudgment>();
  let revision = 0;
  const cache = {
    available: true,
    mutationRevision: () => revision,
    lookup: () => null,
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
    expect(starts).toBe(1);
    expect(admissionCount).toBe(2);
    expect(rows.size).toBe(0);
    expect(done.state).toBe("interrupted");
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

  test("purge under coordinator with unchanged source identity cannot publish stale activation", async () => {
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
      expect(result.state).toBe("failed");
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
      expect(cache.getActivation()).toBeNull();
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("three eligible games with only two descriptions treats other pairs as non-failures", async () => {
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
      expect(cache.getActivation()).not.toBeNull();
    } finally {
      cache.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("newly eligible games are outside the original scope and prevent activation until covered", async () => {
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
      expect(result.state).toBe("failed");
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
