import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyState,
} from "@shelf-judge/shared";
import type { Collection } from "@shelf-judge/shared";
import {
  collectionMutationServiceFor,
  createCollectionMutationService,
  collectionRevisionStrategy,
} from "../../src/services/collection-mutation-service.js";
import type { CollectionMutationContext } from "../../src/services/collection-mutation-service.js";
import {
  createSemanticRedundancyStateService,
  applySemanticEvidenceTransition,
  collectionRedundancyEvidenceIdentity,
} from "../../src/services/semantic-redundancy-state-service.js";
import { canonicalSha256 } from "../../src/services/profile-source-coordinator.js";
import type { Logger } from "../../src/services/logger.js";
import type {
  CollectionPersistence,
  CollectionReader,
} from "../../src/services/storage-service.js";
import { createCollectionArtifactContext } from "../../src/services/collection-artifacts.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import type { JevPairCache, JevDependencyKind } from "../../src/services/jev-pair-cache-service.js";
import {
  createJevPairCache,
  type JevPairJudgment,
} from "../../src/services/jev-pair-cache-service.js";
import { purgeRevokedOwnerNoteCache } from "../../src/services/jev-owner-note-revocation.js";

const initialTime = "2026-01-01T00:00:00.000Z";
const jevTestDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    jevTestDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function realJevCache() {
  const directory = await mkdtemp(join(tmpdir(), "collection-mutation-jev-"));
  jevTestDirectories.push(directory);
  return createJevPairCache(directory);
}

function jevJudgment(
  gameAId: string,
  gameBId: string,
  dependencyKind: JevDependencyKind,
  signal: "C" | "D",
): JevPairJudgment {
  return {
    collectionId: "collection-1",
    ...(dependencyKind === "C_ONLY" ? {} : { consentEpoch: "consent-1" }),
    gameAId,
    gameBId,
    signal,
    dependencyKind,
    value: 0.5,
    confidence: 0.5,
    modelId: "model-v1",
    rubricVersion: "rubric-v1",
    questionVersion: "question-v1",
    requestSchemaVersion: "schema-v1",
    scoreMappingVersion: "mapping-v1",
    semanticPolicyId: "policy-v1",
    completedAt: initialTime,
    dependencies: [gameAId, gameBId].map((gameId) => ({
      gameId,
      nameFingerprint: "a".repeat(64),
      ...(dependencyKind !== "D_ONLY" ? { descriptionFingerprint: "b".repeat(64) } : {}),
      ...(dependencyKind !== "C_ONLY"
        ? { noteFingerprint: "c".repeat(64), noteVersion: "note-v1" }
        : {}),
    })),
  };
}

function seedPair(
  cache: JevPairCache,
  gameAId: string,
  gameBId: string,
  kinds: JevDependencyKind[],
) {
  if (kinds.includes("C_ONLY")) cache.upsert(jevJudgment(gameAId, gameBId, "C_ONLY", "C"));
  if (kinds.includes("D_ONLY")) cache.upsert(jevJudgment(gameAId, gameBId, "D_ONLY", "D"));
  if (kinds.includes("SHARED_CD")) {
    cache.upsert(jevJudgment(gameAId, gameBId, "SHARED_CD", "C"));
    cache.upsert(jevJudgment(gameAId, gameBId, "SHARED_CD", "D"));
  }
}

function collection(): Collection {
  const semanticState = createInitialSemanticRedundancyState();
  return {
    schemaVersion: 10,
    revision: 0,
    id: "collection-1",
    name: "Private collection name",
    axes: [],
    games: [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: {
      settings: semanticState.settings,
      evidenceEpoch: 0,
      consentEpoch: 0,
      factualWeightsEpoch: 0,
      factualWeightsFingerprint: null,
      firstOptInInitialized: false,
    },
    createdAt: initialTime,
    updatedAt: initialTime,
  };
}

function semanticGame(id: string, name: string, description: string, ownerNoteVersion = 1) {
  return {
    id,
    bggId: null,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: 3,
    playingTime: 60,
    imageUrl: null,
    bggData: {
      communityRating: 7,
      bayesAverage: 7,
      weight: 2,
      numWeightVotes: 10,
      description,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: 3,
      fetchedAt: initialTime,
    },
    numPlays: 4,
    acquisition: { state: "unknown" as const },
    playCountEvidence: {
      status: "valid" as const,
      value: 4,
      source: "manual" as const,
      observedAt: initialTime,
    },
    durationEvidence: {
      status: "valid" as const,
      value: 60,
      source: "manual" as const,
      observedAt: initialTime,
    },
    playerRangeEvidence: {
      status: "valid" as const,
      value: { minPlayers: 2, maxPlayers: 4 },
      source: "manual" as const,
      observedAt: initialTime,
    },
    suggestedPlayerPoll: {
      status: "valid" as const,
      state: "absent" as const,
      buckets: [] as [],
      source: "manual" as const,
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    ownership: "owned" as const,
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    ownerNote: {
      state: "present" as const,
      version: ownerNoteVersion,
      updatedAt: initialTime,
      text: `Owner note for ${id}`,
    },
    createdAt: initialTime,
    updatedAt: initialTime,
  };
}

function collectionWithSemanticGames(): Collection {
  const a = semanticGame("game-a", "A", "Description A");
  const b = semanticGame("game-b", "B", "Description B");
  const c = semanticGame("game-c", "C", "Description C");
  const source = collection();
  source.games = [a, b, c];
  source.semanticRedundancy.settings = {
    enabled: true,
    weights: { factual: 7, description: 5, ownerNote: 10 },
    cachedOwnerNoteUse: true,
  };
  source.semanticRedundancy.firstOptInInitialized = true;
  return source;
}

function controlledStorage(options: { failFirstSave?: boolean } = {}) {
  let stored = collection();
  let saveCount = 0;
  let releaseFirstSave = () => {};
  let signalFirstSaveStarted = () => {};
  const firstSaveRelease = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });
  const firstSaveStarted = new Promise<void>((resolve) => {
    signalFirstSaveStarted = resolve;
  });
  const storage: CollectionReader & CollectionPersistence = {
    loadCollection: () => Promise.resolve(structuredClone(stored)),
    saveCollection: async (next) => {
      saveCount++;
      if (saveCount === 1) {
        signalFirstSaveStarted();
        await firstSaveRelease;
        if (options.failFirstSave) throw new Error("disk unavailable");
      }
      stored = structuredClone(next);
    },
  };
  return {
    storage,
    firstSaveStarted,
    releaseFirstSave,
    saveCount: () => saveCount,
    stored: () => structuredClone(stored),
  };
}

function jevCache(options: { available?: boolean; throwOnInvalidate?: boolean } = {}) {
  const invalidations: Array<{ gameId: string; kinds: JevDependencyKind[] }> = [];
  const activations: Array<null> = [];
  const cache = {
    available: options.available ?? true,
    invalidateGame(gameId: string, kinds: readonly JevDependencyKind[]) {
      if (options.throwOnInvalidate) throw new Error("sqlite write failed");
      invalidations.push({ gameId, kinds: [...kinds] });
      return 1;
    },
    setActivation(activation: null) {
      activations.push(activation);
    },
  } as unknown as JevPairCache;
  return { cache, invalidations, activations };
}

describe("CollectionMutationService", () => {
  test("omits undefined optional axis evidence and persists ordinary axis mutations", async () => {
    const initial = collection();
    const axis = {
      id: "axis-1",
      name: "Preference",
      description: null,
      weight: 1,
      enabled: true,
      source: "personal",
      createdAt: initialTime,
      updatedAt: initialTime,
    } satisfies Collection["axes"][number];
    initial.axes = [axis];
    const expectedInitialIdentity = canonicalSha256({
      axes: [{ id: "axis-1", weight: 1, enabled: true, source: "personal" }],
      games: [],
      entertainmentBenchmark: null,
      bggPlaySessions: [],
    });
    expect(collectionRedundancyEvidenceIdentity(initial)).toBe(expectedInitialIdentity);

    let stored = structuredClone(initial);
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const mutations = createCollectionMutationService({ storageService: storage });
    await mutations.mutate({ operation: "axis.update", trigger: "owner" }, (candidate) => {
      candidate.axes[0].weight = 2;
      return { changed: true, value: undefined };
    });

    expect(stored.axes[0]?.weight).toBe(2);
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(1);
    expect(collectionRedundancyEvidenceIdentity(stored)).not.toBe(expectedInitialIdentity);
  });

  test("v10 evidence transitions advance only the retained evidence epoch", () => {
    const initial = collection();
    const prior: Collection = {
      ...initial,
      schemaVersion: 10,
      semanticRedundancy: {
        settings: initial.semanticRedundancy.settings,
        evidenceEpoch: 3,
        consentEpoch: 2,
        factualWeightsEpoch: 4,
        factualWeightsFingerprint: "a".repeat(64),
        firstOptInInitialized: true,
      },
    };
    const candidate: Collection = structuredClone(prior);
    candidate.entertainmentBenchmark = {
      state: "configured",
      amount: { hundredths: 500, source: "manual", confirmedAt: initialTime },
    };

    applySemanticEvidenceTransition(prior, candidate);

    expect(candidate.semanticRedundancy).toEqual({
      ...prior.semanticRedundancy,
      evidenceEpoch: 4,
    });
  });

  test("deleting a game persists without touching wishlist", async () => {
    const initial = collection();
    initial.games = [
      semanticGame("game-a", "A", "description"),
      semanticGame("game-b", "B", "description"),
    ];
    let stored = structuredClone(initial);
    const wishlist = [{ id: "wishlist-entry" }];
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const mutations = createCollectionMutationService({ storageService: storage });

    await mutations.mutate({ operation: "game.remove", trigger: "owner" }, (candidate) => {
      candidate.games = candidate.games.filter(({ id }) => id !== "game-a");
      return { changed: true, value: undefined };
    });

    expect(stored.games.map(({ id }) => id)).toEqual(["game-b"]);
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(1);
    expect(wishlist).toEqual([{ id: "wishlist-entry" }]);
  });

  test("uses monotonic collection revision semantics", () => {
    const source: Collection = {
      ...collection(),
      revision: 7,
    };

    expect(collectionRevisionStrategy.identity(source)).toEqual({
      collectionId: "collection-1",
      schemaVersion: 10,
      revision: 7,
    });
    expect(collectionRevisionStrategy.advance(source, source).revision).toBe(8);
    expect(source.revision).toBe(7);
    expect(() =>
      collectionRevisionStrategy.advance(
        { ...source, revision: 0 },
        { ...source, revision: Number.MAX_SAFE_INTEGER },
      ),
    ).toThrow("safe integer range");
  });

  test("serializes different writer operations against the latest accepted collection", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });

    const gameWriter = service.mutate(
      { operation: "game.ownership.set", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        candidate.name = "Game writer accepted";
        candidate.revision = 99;
        return { changed: true, value: "game" };
      },
    );
    await ctx.firstSaveStarted;
    const axisWriter = service.mutate(
      { operation: "axis.create", trigger: "owner" },
      (candidate) => {
        candidate.entertainmentBenchmark = {
          state: "configured",
          amount: { hundredths: 800, source: "manual", confirmedAt: initialTime },
        };
        return { changed: true, value: "axis" };
      },
    );

    await Promise.resolve();
    expect(ctx.saveCount()).toBe(1);
    ctx.releaseFirstSave();
    await Promise.all([gameWriter, axisWriter]);

    expect(ctx.stored().name).toBe("Game writer accepted");
    expect(ctx.stored().entertainmentBenchmark).toMatchObject({
      state: "configured",
      amount: { hundredths: 800 },
    });
    expect(ctx.saveCount()).toBe(2);
    expect(ctx.stored().revision).toBe(2);
  });

  test("does not persist no-ops or advance the revision", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });

    const outcome = await service.mutate(
      { operation: "purchase.benchmark.clear", trigger: "owner" },
      (candidate) => ({ changed: false, value: candidate.id }),
    );

    expect(outcome).toMatchObject({
      outcome: "no-op",
      changed: false,
      value: "collection-1",
      collection: { schemaVersion: 10, revision: 0, id: "collection-1", updatedAt: initialTime },
    });
    expect(ctx.saveCount()).toBe(0);
  });

  test("purges semantic display artifacts after validation and before persistence hooks", async () => {
    const ctx = controlledStorage();
    const fileOps = createMockFileOps({
      "/test/data/profile.json": "stale profile",
      "/test/data/attention-candidates.json": "stale candidates",
      "/test/data/wishlist.json": "wishlist bytes",
    });
    const service = createCollectionMutationService({
      storageService: ctx.storage,
      semanticDisplayArtifactContext: createCollectionArtifactContext("/test/data", fileOps, {
        log: () => {},
        warn: () => {},
        error: () => {},
      }),
    });

    const mutation = service.mutate(
      { operation: "purchase.benchmark.set", trigger: "owner" },
      (candidate) => {
        candidate.entertainmentBenchmark = {
          state: "configured",
          amount: { hundredths: 500, source: "manual", confirmedAt: initialTime },
        };
        return {
          changed: true,
          value: undefined,
          beforePersistence() {
            expect(fileOps.files.has("/test/data/profile.json")).toBe(false);
            expect(fileOps.files.has("/test/data/attention-candidates.json")).toBe(false);
          },
        };
      },
    );
    await ctx.firstSaveStarted;
    ctx.releaseFirstSave();
    await mutation;

    expect(fileOps.files.get("/test/data/wishlist.json")).toBe("wishlist bytes");
    expect(ctx.saveCount()).toBe(1);
  });

  test("factual-weight durable fence changes purge semantic artifacts without touching wishlist", async () => {
    let stored = collection();
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const fileOps = createMockFileOps({
      "/test/data/profile.json": "stale profile",
      "/test/data/attention-candidates.json": "stale candidates",
      "/test/data/wishlist.json": "wishlist bytes",
    });
    const service = createCollectionMutationService({
      storageService: storage,
      semanticDisplayArtifactContext: createCollectionArtifactContext("/test/data", fileOps, {
        log: () => {},
        warn: () => {},
        error: () => {},
      }),
    });

    await service.mutate(
      { operation: "semantic-redundancy.factual-weights.invalidate", trigger: "test" },
      (candidate) => {
        candidate.semanticRedundancy.factualWeightsEpoch += 1;
        candidate.semanticRedundancy.factualWeightsFingerprint = "c".repeat(64);
        return { changed: true, value: undefined };
      },
    );

    expect(fileOps.files.has("/test/data/profile.json")).toBe(false);
    expect(fileOps.files.has("/test/data/attention-candidates.json")).toBe(false);
    expect(fileOps.files.get("/test/data/wishlist.json")).toBe("wishlist bytes");
  });

  test("does not purge on no-op or semantic bookkeeping-only checkpoint writes", async () => {
    const initial = collection();
    let stored = structuredClone(initial);
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const fileOps = createMockFileOps({
      "/test/data/profile.json": "profile",
      "/test/data/attention-candidates.json": "candidates",
    });
    const service = createCollectionMutationService({
      storageService: storage,
      semanticDisplayArtifactContext: createCollectionArtifactContext("/test/data", fileOps, {
        log: () => {},
        warn: () => {},
        error: () => {},
      }),
    });

    await service.mutate({ operation: "test.read", trigger: "test" }, () => ({
      changed: false,
      value: undefined,
    }));
    expect(fileOps.files.has("/test/data/profile.json")).toBe(true);
    await service.mutate(
      { operation: "semantic-redundancy.judgments.checkpoint", trigger: "refresh" },
      () => ({ changed: true, value: undefined }),
    );
    expect(fileOps.files.has("/test/data/profile.json")).toBe(true);
    expect(fileOps.files.has("/test/data/attention-candidates.json")).toBe(true);
  });

  test("purges when accepted consent changes invalidate the published semantic display", async () => {
    let stored = collection();
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const fileOps = createMockFileOps({
      "/test/data/profile.json": "profile",
      "/test/data/attention-candidates.json": "candidates",
    });
    const mutations = createCollectionMutationService({
      storageService: storage,
      semanticDisplayArtifactContext: createCollectionArtifactContext("/test/data", fileOps, {
        log: () => {},
        warn: () => {},
        error: () => {},
      }),
    });
    const semantic = createSemanticRedundancyStateService({ collectionMutationService: mutations });

    const result = await semantic.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 0 },
      {
        enabled: true,
        weights: { factual: 7, description: 5, ownerNote: 10 },
        cachedOwnerNoteUse: false,
      },
    );

    expect(result.outcome).toBe("accepted");
    expect(stored.semanticRedundancy.consentEpoch).toBe(1);
    expect(fileOps.files.has("/test/data/profile.json")).toBe(false);
    expect(fileOps.files.has("/test/data/attention-candidates.json")).toBe(false);
  });

  test("purges when a durable factual-weight fence changes", async () => {
    let stored = collection();
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const fileOps = createMockFileOps({
      "/test/data/profile.json": "profile",
      "/test/data/attention-candidates.json": "candidates",
    });
    const service = createCollectionMutationService({
      storageService: storage,
      semanticDisplayArtifactContext: createCollectionArtifactContext("/test/data", fileOps, {
        log: () => {},
        warn: () => {},
        error: () => {},
      }),
    });

    await service.mutate(
      { operation: "semantic-redundancy.factual-weights.invalidate", trigger: "refresh" },
      (candidate) => {
        candidate.semanticRedundancy.factualWeightsEpoch += 1;
        candidate.semanticRedundancy.factualWeightsFingerprint = "d".repeat(64);
        return { changed: true, value: undefined };
      },
    );

    expect(stored.semanticRedundancy.factualWeightsEpoch).toBe(1);
    expect(fileOps.files.has("/test/data/profile.json")).toBe(false);
    expect(fileOps.files.has("/test/data/attention-candidates.json")).toBe(false);
  });

  test("aborts collection persistence when a semantic display purge fails", async () => {
    const ctx = controlledStorage();
    const fileOps = createMockFileOps({ "/test/data/profile.json": "stale profile" });
    fileOps.unlink = (filePath) => {
      if (filePath.endsWith("profile.json")) return Promise.reject(new Error("purge unavailable"));
      return Promise.resolve();
    };
    const service = createCollectionMutationService({
      storageService: ctx.storage,
      semanticDisplayArtifactContext: createCollectionArtifactContext("/test/data", fileOps, {
        log: () => {},
        warn: () => {},
        error: () => {},
      }),
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      service.mutate({ operation: "purchase.benchmark.set", trigger: "owner" }, (candidate) => {
        candidate.entertainmentBenchmark = {
          state: "configured",
          amount: { hundredths: 500, source: "manual", confirmedAt: initialTime },
        };
        return { changed: true, value: undefined };
      }),
    ).rejects.toThrow("purge unavailable");
    expect(ctx.saveCount()).toBe(0);
    expect(ctx.stored()).toEqual(collection());
  });

  test("leaves purged display artifacts absent when collection persistence fails", async () => {
    const ctx = controlledStorage({ failFirstSave: true });
    const fileOps = createMockFileOps({
      "/test/data/profile.json": "stale profile",
      "/test/data/attention-candidates.json": "stale candidates",
    });
    const service = createCollectionMutationService({
      storageService: ctx.storage,
      semanticDisplayArtifactContext: createCollectionArtifactContext("/test/data", fileOps, {
        log: () => {},
        warn: () => {},
        error: () => {},
      }),
    });
    const mutation = service.mutate(
      { operation: "purchase.benchmark.set", trigger: "owner" },
      (candidate) => {
        candidate.entertainmentBenchmark = {
          state: "configured",
          amount: { hundredths: 500, source: "manual", confirmedAt: initialTime },
        };
        return { changed: true, value: undefined };
      },
    );
    await ctx.firstSaveStarted;
    ctx.releaseFirstSave();
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(mutation).rejects.toThrow("disk unavailable");

    expect(fileOps.files.has("/test/data/profile.json")).toBe(false);
    expect(fileOps.files.has("/test/data/attention-candidates.json")).toBe(false);
    expect(ctx.stored()).toEqual(collection());
  });

  test("advances evidence epoch and withdraws semantic state only for evidence changes", async () => {
    const initial = collection();
    let stored = structuredClone(initial);
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const mutations = createCollectionMutationService({ storageService: storage });

    await mutations.mutate({ operation: "game.rate", trigger: "owner" }, (candidate) => {
      candidate.updatedAt = "2026-01-01T00:01:00.000Z";
      return { changed: true, value: undefined };
    });
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(0);

    await mutations.mutate(
      { operation: "purchase.benchmark.set", trigger: "owner" },
      (candidate) => {
        candidate.entertainmentBenchmark = {
          state: "configured",
          amount: { hundredths: 500, source: "manual", confirmedAt: initialTime },
        };
        return { changed: true, value: undefined };
      },
    );
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(1);
    expect(stored.semanticRedundancy.consentEpoch).toBe(0);
  });

  test("rejects an evidence change when the semantic epoch cannot advance safely", async () => {
    const initial = collection();
    initial.semanticRedundancy.evidenceEpoch = Number.MAX_SAFE_INTEGER;
    let stored = structuredClone(initial);
    let saves = 0;
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        saves += 1;
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const mutations = createCollectionMutationService({ storageService: storage });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      mutations.mutate({ operation: "purchase.benchmark.set", trigger: "owner" }, (candidate) => {
        candidate.entertainmentBenchmark = {
          state: "configured",
          amount: { hundredths: 500, source: "manual", confirmedAt: initialTime },
        };
        return { changed: true, value: undefined };
      }),
    ).rejects.toThrow("Semantic evidence epoch cannot advance beyond the safe integer range");
    expect(saves).toBe(0);
    expect(stored).toEqual(initial);
  });

  test("semantic settings advance consent epoch", async () => {
    const initial = collection();
    let stored = structuredClone(initial);
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const mutations = createCollectionMutationService({ storageService: storage });
    const semantic = createSemanticRedundancyStateService({ collectionMutationService: mutations });

    expect(
      (
        await semantic.updateSettings(
          { evidenceEpoch: 1, consentEpoch: 0 },
          {
            enabled: true,
            weights: { factual: 7, description: 5, ownerNote: 10 },
            cachedOwnerNoteUse: false,
          },
        )
      ).outcome,
    ).toBe("stale");
    const settingsUpdate = await semantic.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 0 },
      {
        enabled: true,
        weights: { factual: 7, description: 5, ownerNote: 10 },
        cachedOwnerNoteUse: false,
      },
    );
    expect(settingsUpdate.outcome).toBe("accepted");
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(0);
    expect(stored.semanticRedundancy.consentEpoch).toBe(1);
    expect(stored.semanticRedundancy.firstOptInInitialized).toBe(true);
    expect(
      (
        await semantic.updateSettings(
          { evidenceEpoch: 0, consentEpoch: 1 },
          {
            enabled: true,
            weights: { factual: 7, description: 5, ownerNote: 10 },
            cachedOwnerNoteUse: false,
          },
        )
      ).outcome,
    ).toBe("accepted");
    expect(stored.semanticRedundancy.consentEpoch).toBe(1);

    expect(stored.semanticRedundancy.evidenceEpoch).toBe(0);
    expect(stored.semanticRedundancy.consentEpoch).toBe(1);
  });

  test("revocation persists authority before purging SQLite D-dependent rows and reports pending cleanup", async () => {
    const initial = collection();
    initial.semanticRedundancy.settings.cachedOwnerNoteUse = true;
    let stored = structuredClone(initial);
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const cache = await realJevCache();
    seedPair(cache, "game-a", "game-b", ["C_ONLY", "D_ONLY"]);
    const mutations = createCollectionMutationService({
      storageService: storage,
      jevPairCache: cache,
    });
    const semantic = createSemanticRedundancyStateService({ collectionMutationService: mutations });
    const result = await semantic.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 0 },
      { ...initial.semanticRedundancy.settings, cachedOwnerNoteUse: false },
    );
    expect(result).toMatchObject({ outcome: "accepted", cleanupPending: false });
    expect(stored.semanticRedundancy.settings.cachedOwnerNoteUse).toBe(false);
    expect(stored.semanticRedundancy.consentEpoch).toBe(1);
    expect(
      cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "C" })?.dependencyKind,
    ).toBe("C_ONLY");
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "D" })).toBeNull();
    // A stale row from an interrupted/older cleanup is fenced before reauthorization.
    seedPair(cache, "game-a", "game-b", ["D_ONLY"]);
    const reenabled = await semantic.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 1 },
      { ...initial.semanticRedundancy.settings, cachedOwnerNoteUse: true },
    );
    expect(reenabled.outcome).toBe("accepted");
    expect(stored.semanticRedundancy.settings.cachedOwnerNoteUse).toBe(true);
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "D" })).toBeNull();
    cache.close();
  });

  test("revocation cleanup failure is non-throwing and re-enable purges stale rows before authority", async () => {
    const initial = collection();
    initial.semanticRedundancy.settings.cachedOwnerNoteUse = true;
    let stored = structuredClone(initial);
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const cache = await realJevCache();
    seedPair(cache, "game-a", "game-b", ["D_ONLY"]);
    const failingCache: JevPairCache = {
      ...cache,
      purgeDDependent: () => {
        throw new Error("sqlite locked");
      },
    };
    const semantic = createSemanticRedundancyStateService({
      collectionMutationService: createCollectionMutationService({
        storageService: storage,
        jevPairCache: failingCache,
      }),
    });
    const revoked = await semantic.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 0 },
      { ...initial.semanticRedundancy.settings, cachedOwnerNoteUse: false },
    );
    expect(revoked).toMatchObject({ outcome: "accepted", cleanupPending: true });
    expect(stored.semanticRedundancy.settings.cachedOwnerNoteUse).toBe(false);
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "D" })).not.toBeNull();

    const beforeReenable = structuredClone(stored);
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      semantic.updateSettings(
        { evidenceEpoch: 0, consentEpoch: 1 },
        { ...initial.semanticRedundancy.settings, cachedOwnerNoteUse: true },
      ),
    ).rejects.toThrow("sqlite locked");
    expect(stored).toEqual(beforeReenable);
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "D" })).not.toBeNull();
    cache.close();
  });

  test("failed collection save cannot report successful revocation", async () => {
    const initial = collection();
    initial.semanticRedundancy.settings.cachedOwnerNoteUse = true;
    const stored = structuredClone(initial);
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: () => Promise.reject(new Error("json save failed")),
    };
    const cache = await realJevCache();
    seedPair(cache, "game-a", "game-b", ["D_ONLY"]);
    const semantic = createSemanticRedundancyStateService({
      collectionMutationService: createCollectionMutationService({
        storageService: storage,
        jevPairCache: cache,
      }),
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      semantic.updateSettings(
        { evidenceEpoch: 0, consentEpoch: 0 },
        { ...initial.semanticRedundancy.settings, cachedOwnerNoteUse: false },
      ),
    ).rejects.toThrow("json save failed");
    expect(stored.semanticRedundancy.settings.cachedOwnerNoteUse).toBe(true);
    expect(stored.semanticRedundancy.consentEpoch).toBe(0);
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "D" })).not.toBeNull();
    cache.close();
  });

  test("save response loss after durable revocation classifies commit and still purges SQLite cache", async () => {
    const initial = collection();
    initial.semanticRedundancy.settings.cachedOwnerNoteUse = true;
    let stored = structuredClone(initial);
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.reject(new Error("response lost after write"));
      },
    };
    const cache = await realJevCache();
    seedPair(cache, "game-a", "game-b", ["C_ONLY", "D_ONLY"]);
    const semantic = createSemanticRedundancyStateService({
      collectionMutationService: createCollectionMutationService({
        storageService: storage,
        jevPairCache: cache,
      }),
    });
    const result = await semantic.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 0 },
      { ...initial.semanticRedundancy.settings, cachedOwnerNoteUse: false },
    );
    expect(result).toMatchObject({ outcome: "accepted", cleanupPending: false });
    expect(stored.semanticRedundancy.settings.cachedOwnerNoteUse).toBe(false);
    expect(stored.semanticRedundancy.consentEpoch).toBe(1);
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "C" })).not.toBeNull();
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "D" })).toBeNull();
    cache.close();
  });

  test("durable permission=false recovery retries cleanup on a later startup when cache returns", async () => {
    const cache = await realJevCache();
    seedPair(cache, "game-a", "game-b", ["C_ONLY", "D_ONLY"]);
    const logger: Logger = { log: () => {}, warn: () => {}, error: () => {} };
    const unavailable: JevPairCache = { ...cache, available: false };
    expect(purgeRevokedOwnerNoteCache(unavailable, logger, { trigger: "daemon-startup" })).toBe(
      false,
    );
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "D" })).not.toBeNull();
    // Persisted permission=false makes the next daemon startup retry this idempotent cleanup.
    expect(purgeRevokedOwnerNoteCache(cache, logger, { trigger: "daemon-startup" })).toBe(true);
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "C" })).not.toBeNull();
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "D" })).toBeNull();
    cache.close();
  });

  test("factual-weight invalidation advances its own collection epoch without changing semantic epochs", async () => {
    let stored = collection();
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const mutations = createCollectionMutationService({ storageService: storage });
    const semantic = createSemanticRedundancyStateService({ collectionMutationService: mutations });
    const first = await semantic.invalidateForFactualWeights("b".repeat(64));
    expect(first.outcome).toBe("accepted");
    expect(stored.semanticRedundancy.factualWeightsEpoch).toBe(1);
    expect(stored.semanticRedundancy.factualWeightsFingerprint).toBe("b".repeat(64));
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(0);
    expect(stored.semanticRedundancy.consentEpoch).toBe(0);
    const revisionAfterFirst = stored.revision;

    await semantic.invalidateForFactualWeights("b".repeat(64));
    expect(stored.revision).toBe(revisionAfterFirst);
    await semantic.invalidateForFactualWeights("a".repeat(64));
    expect(stored.semanticRedundancy.factualWeightsEpoch).toBe(2);
    expect(stored.semanticRedundancy.factualWeightsFingerprint).toBe("a".repeat(64));
  });

  test("note and BGG evidence changes advance the epoch", async () => {
    let stored = collectionWithSemanticGames();
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const mutations = createCollectionMutationService({ storageService: storage });
    const initialEpoch = stored.semanticRedundancy.evidenceEpoch;

    await mutations.mutate(
      { operation: "game.note.set", trigger: "owner", gameIds: ["game-a"] },
      (candidate) => {
        const game = candidate.games.find(({ id }) => id === "game-a")!;
        // Identical text is still a new source version and invalidates dependent requests.
        if (game.ownerNote.state !== "present") throw new Error("Expected a present owner note");
        const note = game.ownerNote;
        game.ownerNote = {
          state: "present",
          version: note.version + 1,
          updatedAt: note.updatedAt,
          text: note.text,
        };
        return { changed: true, value: undefined };
      },
    );
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(initialEpoch + 1);
    const afterNoteSetEpoch = stored.semanticRedundancy.evidenceEpoch;

    await mutations.mutate(
      { operation: "game.note.set", trigger: "owner", gameIds: ["game-a"] },
      (candidate) => {
        const game = candidate.games.find(({ id }) => id === "game-a")!;
        if (game.ownerNote.state !== "present") throw new Error("Expected a present owner note");
        game.ownerNote = {
          state: "cleared",
          version: game.ownerNote.version + 1,
          updatedAt: game.ownerNote.updatedAt,
        };
        return { changed: true, value: undefined };
      },
    );
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(afterNoteSetEpoch + 1);

    await mutations.mutate(
      { operation: "game.bgg.refresh", trigger: "owner", gameIds: ["game-b"] },
      (candidate) => {
        candidate.games.find(({ id }) => id === "game-b")!.bggData!.description =
          "Changed description B";
        return { changed: true, value: undefined };
      },
    );

    await mutations.mutate(
      { operation: "game.ownership.set", trigger: "owner", gameIds: ["game-c"] },
      (candidate) => {
        candidate.games.find(({ id }) => id === "game-c")!.ownership = "previously-owned";
        return { changed: true, value: undefined };
      },
    );
    const afterOwnershipEpoch = stored.semanticRedundancy.evidenceEpoch;

    await mutations.mutate(
      { operation: "game.rate", trigger: "owner", gameIds: ["game-c"] },
      (candidate) => {
        candidate.games.find(({ id }) => id === "game-c")!.bggData!.communityRating = 8;
        return { changed: true, value: undefined };
      },
    );
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(afterOwnershipEpoch + 1);

    const restarted = createCollectionMutationService({ storageService: storage });
    const reopened = await restarted.mutate(
      { operation: "test.read", trigger: "test" },
      (candidate) => ({
        changed: false,
        value: candidate.semanticRedundancy.evidenceEpoch,
      }),
    );
    expect(reopened.value).toBe(stored.semanticRedundancy.evidenceEpoch);
  });

  test("game deletion persists and advances the evidence epoch", async () => {
    let stored = collectionWithSemanticGames();
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const mutations = createCollectionMutationService({ storageService: storage });

    await mutations.mutate(
      { operation: "game.remove", trigger: "owner", gameIds: ["game-b"] },
      (candidate) => {
        candidate.games = candidate.games.filter(({ id }) => id !== "game-b");
        return { changed: true, value: undefined };
      },
    );

    expect(stored.games.some(({ id }) => id === "game-b")).toBe(false);
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(1);
  });

  test("invalidates JEV cache dependencies from accepted source differences", async () => {
    const run = async (
      mutate: (candidate: Collection) => void,
      operation: CollectionMutationContext["operation"] = "game.bgg.refresh",
      gameIds: string[] = ["game-a"],
    ) => {
      let stored = collectionWithSemanticGames();
      const storage: CollectionReader & CollectionPersistence = {
        loadCollection: () => Promise.resolve(structuredClone(stored)),
        saveCollection: (next) => {
          stored = structuredClone(next);
          return Promise.resolve();
        },
      };
      const cache = jevCache();
      const service = createCollectionMutationService({
        storageService: storage,
        jevPairCache: cache.cache,
      });
      await service.mutate({ operation, trigger: "test", gameIds }, (candidate) => {
        mutate(candidate);
        return { changed: true, value: undefined };
      });
      return cache;
    };

    const renamed = await run((candidate) => {
      candidate.games.find(({ id }) => id === "game-a")!.name = "Renamed";
    });
    expect(renamed.invalidations).toEqual([
      { gameId: "game-a", kinds: ["C_ONLY", "D_ONLY", "SHARED_CD"] },
    ]);

    const description = await run((candidate) => {
      candidate.games.find(({ id }) => id === "game-a")!.bggData!.description = "Updated";
    });
    expect(description.invalidations).toEqual([
      { gameId: "game-a", kinds: ["C_ONLY", "SHARED_CD"] },
    ]);

    const note = await run((candidate) => {
      const game = candidate.games.find(({ id }) => id === "game-a")!;
      if (game.ownerNote.state !== "present") throw new Error("Expected present note");
      game.ownerNote = { ...game.ownerNote, version: game.ownerNote.version + 1 };
    }, "game.note.set");
    expect(note.invalidations).toEqual([{ gameId: "game-a", kinds: ["D_ONLY", "SHARED_CD"] }]);
    expect(description.invalidations.some(({ kinds }) => kinds.includes("D_ONLY"))).toBe(false);
    expect(note.invalidations.some(({ kinds }) => kinds.includes("C_ONLY"))).toBe(false);

    const deletion = await run(
      (candidate) => {
        candidate.games = candidate.games.filter(({ id }) => id !== "game-b");
      },
      "game.remove",
      ["game-b"],
    );
    expect(deletion.invalidations).toContainEqual({
      gameId: "game-b",
      kinds: ["C_ONLY", "D_ONLY", "SHARED_CD"],
    });
    expect(deletion.invalidations).toHaveLength(1);
    expect(deletion.activations).toEqual([null]);
  });

  test("SQLite cache retains unrelated pairs after one-game source edits", async () => {
    const cache = await realJevCache();
    seedPair(cache, "game-a", "game-b", ["C_ONLY", "D_ONLY"]);
    seedPair(cache, "game-a", "game-c", ["SHARED_CD"]);
    seedPair(cache, "game-b", "game-c", ["C_ONLY", "D_ONLY"]);
    const stored = collectionWithSemanticGames();
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: () => Promise.resolve(),
    };
    const service = createCollectionMutationService({
      storageService: storage,
      jevPairCache: cache,
    });

    await service.mutate(
      { operation: "game.bgg.refresh", trigger: "test", gameIds: ["game-a"] },
      (candidate) => {
        candidate.games.find(({ id }) => id === "game-a")!.bggData!.description = "new description";
        return { changed: true, value: undefined };
      },
    );

    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "C" })).toBeNull();
    expect(
      cache.lookup({ gameAId: "game-a", gameBId: "game-b", signal: "D" })?.dependencyKind,
    ).toBe("D_ONLY");
    expect(
      cache.lookup({ gameAId: "game-b", gameBId: "game-c", signal: "C" })?.dependencyKind,
    ).toBe("C_ONLY");
    expect(
      cache.lookup({ gameAId: "game-b", gameBId: "game-c", signal: "D" })?.dependencyKind,
    ).toBe("D_ONLY");
    cache.close();
  });

  test("SQLite cache removes every deleted-game row in a compound source mutation", async () => {
    const cache = await realJevCache();
    seedPair(cache, "game-a", "game-b", ["C_ONLY", "D_ONLY"]);
    seedPair(cache, "game-a", "game-c", ["D_ONLY"]);
    seedPair(cache, "game-b", "game-c", ["SHARED_CD"]);
    seedPair(cache, "game-b", "game-d", ["D_ONLY"]);
    const stored = collectionWithSemanticGames();
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: () => Promise.resolve(),
    };
    const service = createCollectionMutationService({
      storageService: storage,
      jevPairCache: cache,
    });

    await service.mutate(
      { operation: "game.remove", trigger: "test", gameIds: ["game-b"] },
      (candidate) => {
        candidate.games = candidate.games.filter(({ id }) => id !== "game-b");
        candidate.games.find(({ id }) => id === "game-a")!.bggData!.description = "new description";
        return { changed: true, value: undefined };
      },
    );

    for (const pair of [
      ["game-a", "game-b"],
      ["game-b", "game-c"],
      ["game-b", "game-d"],
    ] as const) {
      expect(cache.lookup({ gameAId: pair[0], gameBId: pair[1], signal: "C" })).toBeNull();
      expect(cache.lookup({ gameAId: pair[0], gameBId: pair[1], signal: "D" })).toBeNull();
    }
    expect(cache.lookup({ gameAId: "game-a", gameBId: "game-c", signal: "C" })).toBeNull();
    expect(
      cache.lookup({ gameAId: "game-a", gameBId: "game-c", signal: "D" })?.dependencyKind,
    ).toBe("D_ONLY");
    cache.close();
  });

  test("JEV cache failures abort affected edits, while unaffected and no-op edits need no cache", async () => {
    for (const badCache of [
      jevCache({ available: false }),
      jevCache({ throwOnInvalidate: true }),
    ]) {
      let stored = collectionWithSemanticGames();
      const storage: CollectionReader & CollectionPersistence = {
        loadCollection: () => Promise.resolve(structuredClone(stored)),
        saveCollection: (next) => {
          stored = structuredClone(next);
          return Promise.resolve();
        },
      };
      const service = createCollectionMutationService({
        storageService: storage,
        jevPairCache: badCache.cache,
      });
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(
        service.mutate({ operation: "game.bgg.refresh", trigger: "test" }, (candidate) => {
          candidate.games[0].bggData!.description = "Changed";
          return { changed: true, value: undefined };
        }),
      ).rejects.toThrow();
      expect(stored.games[0]?.bggData?.description).toBe("Description A");
    }

    let stored = collection();
    let saves = 0;
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        saves++;
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const unavailable = jevCache({ available: false });
    const service = createCollectionMutationService({
      storageService: storage,
      jevPairCache: unavailable.cache,
    });
    await service.mutate({ operation: "test.unaffected", trigger: "test" }, (candidate) => {
      // The submitted revision is replaced by the mutation boundary and is not a JEV source.
      candidate.revision = 88;
      return { changed: true, value: undefined };
    });
    await service.mutate({ operation: "test.noop", trigger: "test" }, () => ({
      changed: false,
      value: undefined,
    }));
    await service.mutate(
      { operation: "semantic-redundancy.settings.update", trigger: "test" },
      (candidate) => {
        candidate.semanticRedundancy.settings.enabled = true;
        return { changed: true, value: undefined };
      },
    );
    expect(saves).toBe(2);
    expect(unavailable.invalidations).toEqual([]);
  });

  test("does not restore invalidated JEV rows when JSON persistence fails", async () => {
    const initial = collectionWithSemanticGames();
    const stored = initial;
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: () => {
        throw new Error("disk unavailable");
      },
    };
    const cache = jevCache();
    const service = createCollectionMutationService({
      storageService: storage,
      jevPairCache: cache.cache,
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      service.mutate({ operation: "game.bgg.refresh", trigger: "test" }, (candidate) => {
        candidate.games[0].bggData!.description = "Changed";
        return { changed: true, value: undefined };
      }),
    ).rejects.toThrow("disk unavailable");
    expect(cache.invalidations.length).toBeGreaterThan(0);
    expect(stored.games[0]?.bggData?.description).toBe("Description A");
  });

  test("changing cached owner-note preference advances consent", async () => {
    let stored = collectionWithSemanticGames();
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const mutations = createCollectionMutationService({ storageService: storage });
    const semantic = createSemanticRedundancyStateService({ collectionMutationService: mutations });
    const result = await semantic.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 0 },
      {
        enabled: true,
        weights: { factual: 7, description: 5, ownerNote: 10 },
        cachedOwnerNoteUse: false,
      },
    );
    expect(result.outcome).toBe("accepted");
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(0);
    expect(stored.semanticRedundancy.consentEpoch).toBe(1);
  });

  test("isolates rejected and invalid candidates from active state", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      service.mutate({ operation: "game.rate", trigger: "owner" }, (candidate) => {
        candidate.name = "must not leak";
        throw new Error("domain rejected");
      }),
    ).rejects.toThrow("domain rejected");
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      service.mutate({ operation: "axis.create", trigger: "owner" }, (candidate) => {
        candidate.name = "";
        (candidate as { schemaVersion: number }).schemaVersion = 99;
        return { changed: true, value: undefined };
      }),
    ).rejects.toThrow();

    expect(ctx.stored()).toEqual(collection());
    expect(ctx.saveCount()).toBe(0);
  });

  test("releases the queue after persistence failure and retries from durable state", async () => {
    const ctx = controlledStorage({ failFirstSave: true });
    const service = createCollectionMutationService({ storageService: ctx.storage });
    const failed = service.mutate(
      { operation: "game.rate", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        candidate.name = "failed candidate";
        return { changed: true, value: undefined };
      },
    );
    await ctx.firstSaveStarted;
    const retry = service.mutate(
      { operation: "game.rate", trigger: "retry", gameIds: ["game-1"] },
      (candidate) => {
        expect(candidate.name).toBe("Private collection name");
        candidate.name = "retry accepted";
        return { changed: true, value: undefined };
      },
    );

    ctx.releaseFirstSave();
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(failed).rejects.toThrow("disk unavailable");
    await retry;
    expect(ctx.stored().name).toBe("retry accepted");
    expect(ctx.stored().revision).toBe(1);
    expect(ctx.saveCount()).toBe(2);
  });

  test("runs post-commit work after persistence and before the next mutation", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });
    const events: string[] = [];
    const first = service.mutate(
      { operation: "game.bgg.refresh", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        candidate.name = "accepted";
        return {
          changed: true,
          value: undefined,
          onPersistenceSuccess() {
            expect(ctx.stored().name).toBe("accepted");
            events.push("post-commit");
          },
        };
      },
    );
    await ctx.firstSaveStarted;
    const second = service.mutate(
      { operation: "game.bgg.refresh-failed", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        events.push("second-mutation");
        expect(candidate.name).toBe("accepted");
        return { changed: false, value: undefined };
      },
    );

    ctx.releaseFirstSave();
    await Promise.all([first, second]);

    expect(events).toEqual(["post-commit", "second-mutation"]);
  });

  test("compensates persistence failure without running post-commit work", async () => {
    const ctx = controlledStorage({ failFirstSave: true });
    const service = createCollectionMutationService({ storageService: ctx.storage });
    const events: string[] = [];
    const mutation = service.mutate(
      { operation: "game.bgg.refresh", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        candidate.name = "failed";
        return {
          changed: true,
          value: undefined,
          onPersistenceFailure() {
            events.push("compensated");
          },
          onPersistenceSuccess() {
            events.push("post-commit");
          },
        };
      },
    );
    await ctx.firstSaveStarted;
    ctx.releaseFirstSave();

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(mutation).rejects.toThrow("disk unavailable");
    expect(events).toEqual(["compensated"]);
    expect(ctx.stored()).toEqual(collection());
  });

  test("runs pre-persistence work after validation and compensates its failure without saving", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });
    const events: string[] = [];

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      service.mutate({ operation: "game.note.set", trigger: "owner" }, (candidate) => {
        candidate.name = "candidate";
        return {
          changed: true,
          value: undefined,
          beforePersistence() {
            events.push("invalidate");
            throw new Error("invalidation unavailable");
          },
          onPersistenceFailure(error) {
            events.push(`compensate:${String(error)}`);
          },
          onPersistenceSuccess() {
            events.push("complete");
          },
        };
      }),
    ).rejects.toThrow("invalidation unavailable");

    expect(events).toEqual(["invalidate", "compensate:Error: invalidation unavailable"]);
    expect(ctx.saveCount()).toBe(0);
    expect(ctx.stored()).toEqual(collection());
  });

  test("propagates post-commit failure after durable persistence and releases the queue", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });
    const first = service.mutate(
      { operation: "game.bgg.refresh", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        candidate.name = "durably accepted";
        return {
          changed: true,
          value: undefined,
          onPersistenceSuccess() {
            throw new Error("generation update failed");
          },
        };
      },
    );
    await ctx.firstSaveStarted;
    ctx.releaseFirstSave();

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(first).rejects.toThrow("generation update failed");
    expect(ctx.stored().name).toBe("durably accepted");
    await service.mutate({ operation: "game.rate", trigger: "owner" }, (candidate) => {
      expect(candidate.name).toBe("durably accepted");
      return { changed: false, value: undefined };
    });
  });

  test("logs seam identity and affected IDs without collection contents", async () => {
    const ctx = controlledStorage();
    const entries: unknown[][] = [];
    const logger: Logger = {
      log: (...values) => entries.push(values),
      warn: (...values) => entries.push(values),
      error: (...values) => entries.push(values),
    };
    const service = createCollectionMutationService({ storageService: ctx.storage, logger });
    const operation = service.mutate(
      {
        operation: "game.bgg.refresh",
        trigger: "owner",
        gameIds: ["game-1"],
        intentionIds: ["intention-1"],
      },
      (candidate) => {
        candidate.name = "Secret replacement";
        return { changed: true, value: undefined };
      },
    );
    await ctx.firstSaveStarted;
    ctx.releaseFirstSave();
    await operation;

    const serialized = JSON.stringify(entries);
    expect(serialized).toContain("game.bgg.refresh");
    expect(serialized).toContain("game-1");
    expect(serialized).toContain("intention-1");
    expect(serialized).toContain("collection-1");
    expect(serialized).toContain("accepted");
    expect(serialized).not.toContain("Private collection name");
    expect(serialized).not.toContain("Secret replacement");
  });

  test("logs primary persistence and compensation failures", async () => {
    const ctx = controlledStorage({ failFirstSave: true });
    const entries: unknown[][] = [];
    const logger: Logger = {
      log: (...values) => entries.push(values),
      warn: (...values) => entries.push(values),
      error: (...values) => entries.push(values),
    };
    const service = createCollectionMutationService({ storageService: ctx.storage, logger });
    const mutation = service.mutate(
      { operation: "shelf.unit.remove", trigger: "owner" },
      (candidate) => {
        candidate.name = "candidate";
        return {
          changed: true,
          value: undefined,
          onPersistenceFailure() {
            throw new Error("rollback unavailable");
          },
        };
      },
    );
    await ctx.firstSaveStarted;
    ctx.releaseFirstSave();

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(mutation).rejects.toThrow("rollback unavailable");
    expect(entries.some(([message]) => message === "collection mutation persistence failed")).toBe(
      true,
    );
    expect(entries.some(([message]) => message === "collection mutation compensation failed")).toBe(
      true,
    );
  });

  test("returns one coordinator for every service sharing a storage boundary", () => {
    const ctx = controlledStorage();
    const explicit = createCollectionMutationService({ storageService: ctx.storage });
    expect(collectionMutationServiceFor(ctx.storage)).toBe(explicit);
    expect(createCollectionMutationService({ storageService: ctx.storage })).toBe(explicit);
  });
});
