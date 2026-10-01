import { describe, expect, test } from "bun:test";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyState,
  type SemanticPairJudgment,
  type SemanticPublishedSignalJudgment,
  type CollectionV10,
} from "@shelf-judge/shared";
import type { Collection } from "@shelf-judge/shared";
import {
  SEMANTIC_FIXTURE_FINGERPRINT,
  semanticGenerationFixture,
  semanticSourceIdentityFixture,
} from "../helpers/semantic-redundancy-fixtures.js";
import {
  collectionMutationServiceFor,
  createCollectionMutationService,
  collectionRevisionStrategy,
} from "../../src/services/collection-mutation-service.js";
import {
  createSemanticRedundancyStateService,
  applySemanticEvidenceTransition,
  collectionRedundancyEvidenceIdentity,
  semanticDescriptionSourceFingerprint,
  semanticOwnerNoteSourceFingerprint,
} from "../../src/services/semantic-redundancy-state-service.js";
import { canonicalSha256 } from "../../src/services/profile-source-coordinator.js";
import type { Logger } from "../../src/services/logger.js";
import type {
  CollectionPersistence,
  CollectionReader,
} from "../../src/services/storage-service.js";
import { createCollectionArtifactContext } from "../../src/services/collection-artifacts.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

const initialTime = "2026-01-01T00:00:00.000Z";

function publishedSignal(
  judgment: SemanticPairJudgment["description"],
): SemanticPublishedSignalJudgment | null {
  if (judgment === null || judgment.status === "scored" || judgment.status === "unavailable") {
    return judgment;
  }
  throw new Error("Published semantic outcomes must be terminal");
}

function collection(): Collection {
  return {
    schemaVersion: 9,
    revision: 0,
    id: "collection-1",
    name: "Private collection name",
    axes: [],
    games: [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: createInitialSemanticRedundancyState(),
    createdAt: initialTime,
    updatedAt: initialTime,
  };
}

function withActiveSemanticRefresh(source: Collection): Collection {
  const digest = SEMANTIC_FIXTURE_FINGERPRINT;
  const sourceIdentity = semanticSourceIdentityFixture({
    collectionId: source.id,
    collectionRevision: source.revision,
    evidenceEpoch: source.semanticRedundancy.evidenceEpoch,
    consentEpoch: source.semanticRedundancy.consentEpoch,
  });
  source.semanticRedundancy.disclosure = {
    id: "authorization-1",
    manifestDigest: digest,
    evidenceEpoch: source.semanticRedundancy.evidenceEpoch,
    consentEpoch: source.semanticRedundancy.consentEpoch,
    pairCount: source.semanticRedundancy.pairJudgments.length,
    notePairCount: source.semanticRedundancy.pairJudgments.filter(
      ({ description, ownerNote }) =>
        (description?.status === "scored" && description.noteVersionA !== null) ||
        ownerNote?.status === "scored",
    ).length,
    expiresAt: "2099-01-02T00:00:00.000Z",
  };
  source.semanticRedundancy.authorization = {
    ...source.semanticRedundancy.disclosure,
    state: "active",
  };
  source.semanticRedundancy.publishedGeneration = semanticGenerationFixture({
    id: "generation-0",
    manifestDigest: digest,
    sourceIdentity,
    eligibleGameIds: source.games.map(({ id }) => id).sort(),
    pairOutcomes: source.semanticRedundancy.pairJudgments.map((pair) => ({
      gameA: pair.gameA,
      gameB: pair.gameB,
      description: publishedSignal(pair.description),
      ownerNote: publishedSignal(pair.ownerNote),
    })),
  });
  return source;
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

function scoredPair(
  gameA: ReturnType<typeof semanticGame>,
  gameB: ReturnType<typeof semanticGame>,
  mode: "description-only" | "description-and-owner-notes" | "owner-notes-only",
): SemanticPairJudgment {
  const descriptionA = semanticDescriptionSourceFingerprint(gameA);
  const descriptionB = semanticDescriptionSourceFingerprint(gameB);
  const ownerNoteA = semanticOwnerNoteSourceFingerprint(gameA);
  const ownerNoteB = semanticOwnerNoteSourceFingerprint(gameB);
  if (!descriptionA || !descriptionB || !ownerNoteA || !ownerNoteB)
    throw new Error("Test games must have all semantic sources");
  const context =
    mode === "description-only"
      ? { kind: mode, descriptionRepresentationVersion: 1 as const }
      : mode === "description-and-owner-notes"
        ? {
            kind: mode,
            descriptionRepresentationVersion: 1 as const,
            ownerNoteRepresentationVersion: 1 as const,
            descriptionFingerprintA: descriptionA,
            descriptionFingerprintB: descriptionB,
          }
        : { kind: mode, ownerNoteRepresentationVersion: 1 as const };
  const description =
    mode === "owner-notes-only"
      ? null
      : {
          status: "scored" as const,
          score: 0.75,
          confidence: null,
          modelId: "jev-pinned",
          rubricVersion: 1,
          sourceFingerprintA: descriptionA,
          sourceFingerprintB: descriptionB,
          noteVersionA: mode === "description-only" ? null : gameA.ownerNote.version,
          noteVersionB: mode === "description-only" ? null : gameB.ownerNote.version,
          requestContext: context,
        };
  const ownerNote =
    mode === "description-only"
      ? null
      : {
          status: "scored" as const,
          score: 0.5,
          confidence: null,
          modelId: "jev-pinned",
          rubricVersion: 1,
          sourceFingerprintA: ownerNoteA,
          sourceFingerprintB: ownerNoteB,
          noteVersionA: gameA.ownerNote.version,
          noteVersionB: gameB.ownerNote.version,
          requestContext: context,
        };
  return {
    gameA: gameA.id,
    gameB: gameB.id,
    description,
    ownerNote,
  };
}

function collectionWithSemanticPairs(): Collection {
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
  source.semanticRedundancy.pairJudgments = [
    {
      ...scoredPair(a, b, "description-only"),
      ownerNote: scoredPair(a, b, "owner-notes-only").ownerNote,
    },
    scoredPair(a, c, "description-and-owner-notes"),
    {
      ...scoredPair(b, c, "description-only"),
      ownerNote: scoredPair(b, c, "owner-notes-only").ownerNote,
    },
  ];
  return withActiveSemanticRefresh(source);
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
    const v9 = collection();
    const prior: CollectionV10 = {
      ...v9,
      schemaVersion: 10,
      semanticRedundancy: {
        settings: v9.semanticRedundancy.settings,
        evidenceEpoch: 3,
        consentEpoch: 2,
        factualWeightsEpoch: 4,
        factualWeightsFingerprint: "a".repeat(64),
        firstOptInInitialized: true,
      },
    };
    const candidate: CollectionV10 = structuredClone(prior);
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

  test("deleting a game clears orphaned v9 judgments before validation without touching wishlist", async () => {
    const initial = collection();
    initial.games = [
      semanticGame("game-a", "A", "description"),
      semanticGame("game-b", "B", "description"),
    ];
    initial.semanticRedundancy.pairJudgments = [
      { gameA: "game-a", gameB: "game-b", description: null, ownerNote: null },
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
    expect(stored.semanticRedundancy.pairJudgments).toEqual([]);
    expect(wishlist).toEqual([{ id: "wishlist-entry" }]);
  });

  test("uses monotonic collection revision semantics", () => {
    const source: Collection = {
      ...collection(),
      revision: 7,
    };

    expect(collectionRevisionStrategy.identity(source)).toEqual({
      collectionId: "collection-1",
      schemaVersion: 9,
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
      collection: { schemaVersion: 9, revision: 0, id: "collection-1", updatedAt: initialTime },
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
    const initial = withActiveSemanticRefresh(collection());
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
      (candidate) => {
        candidate.semanticRedundancy.pairJudgments = structuredClone(
          candidate.semanticRedundancy.pairJudgments,
        );
        return { changed: true, value: undefined };
      },
    );
    expect(fileOps.files.has("/test/data/profile.json")).toBe(true);
    expect(fileOps.files.has("/test/data/attention-candidates.json")).toBe(true);
  });

  test("purges when accepted consent changes invalidate the published semantic display", async () => {
    let stored = withActiveSemanticRefresh(collection());
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

  test("purges when a published generation is withdrawn", async () => {
    let stored = withActiveSemanticRefresh(collection());
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
      { operation: "semantic-redundancy.generation.publish", trigger: "refresh" },
      (candidate) => {
        candidate.semanticRedundancy.publishedGeneration = null;
        return { changed: true, value: undefined };
      },
    );

    expect(stored.semanticRedundancy.publishedGeneration).toBeNull();
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
    const initial = withActiveSemanticRefresh(collection());
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
    expect(stored.semanticRedundancy.authorization?.state).toBe("active");
    expect(stored.semanticRedundancy.publishedGeneration?.id).toBe("generation-0");

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
    expect(stored.semanticRedundancy.disclosure).toBeNull();
    expect(stored.semanticRedundancy.authorization).toBeNull();
    expect(stored.semanticRedundancy.disclosureManifest).toBeNull();
    expect(stored.semanticRedundancy.manifestDelivery).toBeNull();
    expect(stored.semanticRedundancy.execution).toBeNull();
    expect(stored.semanticRedundancy.publishedGeneration).toBeNull();
    expect(stored.semanticRedundancy.pairJudgments).toEqual([]);
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

  test("semantic settings advance consent epoch and discard deprecated v9 payloads", async () => {
    const initial = withActiveSemanticRefresh(collection());
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
    expect(stored.semanticRedundancy.authorization).toBeNull();
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
    expect(stored.semanticRedundancy.authorization).toBeNull();
    expect(stored.semanticRedundancy.publishedGeneration).toBeNull();
  });

  test("factual-weight invalidation advances its own collection epoch without changing semantic epochs", async () => {
    let stored = withActiveSemanticRefresh(collection());
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
    expect(stored.semanticRedundancy.authorization).toBeNull();
    expect(stored.semanticRedundancy.publishedGeneration).toBeNull();
    expect(stored.semanticRedundancy.pairJudgments).toEqual([]);
    const revisionAfterFirst = stored.revision;

    await semantic.invalidateForFactualWeights("b".repeat(64));
    expect(stored.revision).toBe(revisionAfterFirst);
    await semantic.invalidateForFactualWeights("a".repeat(64));
    expect(stored.semanticRedundancy.factualWeightsEpoch).toBe(2);
    expect(stored.semanticRedundancy.factualWeightsFingerprint).toBe("a".repeat(64));
  });

  test("note and BGG evidence changes advance the epoch and discard v9 judgments", async () => {
    let stored = collectionWithSemanticPairs();
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
    expect(stored.semanticRedundancy.authorization).toBeNull();
    expect(stored.semanticRedundancy.publishedGeneration).toBeNull();
    expect(stored.semanticRedundancy.pairJudgments).toEqual([]);
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
    expect(stored.semanticRedundancy.pairJudgments).toEqual([]);

    await mutations.mutate(
      { operation: "game.bgg.refresh", trigger: "owner", gameIds: ["game-b"] },
      (candidate) => {
        candidate.games.find(({ id }) => id === "game-b")!.bggData!.description =
          "Changed description B";
        return { changed: true, value: undefined };
      },
    );
    expect(stored.semanticRedundancy.pairJudgments).toEqual([]);

    await mutations.mutate(
      { operation: "game.ownership.set", trigger: "owner", gameIds: ["game-c"] },
      (candidate) => {
        candidate.games.find(({ id }) => id === "game-c")!.ownership = "previously-owned";
        return { changed: true, value: undefined };
      },
    );
    expect(stored.semanticRedundancy.pairJudgments).toEqual([]);
    const afterOwnershipEpoch = stored.semanticRedundancy.evidenceEpoch;

    await mutations.mutate(
      { operation: "game.rate", trigger: "owner", gameIds: ["game-c"] },
      (candidate) => {
        candidate.games.find(({ id }) => id === "game-c")!.bggData!.communityRating = 8;
        return { changed: true, value: undefined };
      },
    );
    expect(stored.semanticRedundancy.evidenceEpoch).toBe(afterOwnershipEpoch + 1);
    expect(stored.semanticRedundancy.pairJudgments).toEqual([]);

    const restarted = createCollectionMutationService({ storageService: storage });
    const reopened = await restarted.mutate(
      { operation: "test.read", trigger: "test" },
      (candidate) => ({
        changed: false,
        value: candidate.semanticRedundancy.pairJudgments,
      }),
    );
    expect(reopened.value).toEqual([]);
  });

  test("game deletion persists after discarding legacy semantic references", async () => {
    let stored = collectionWithSemanticPairs();
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
    expect(stored.semanticRedundancy.pairJudgments).toEqual([]);
    expect(stored.semanticRedundancy.publishedGeneration).toBeNull();
  });

  test("changing cached owner-note preference advances consent and discards historical scores", async () => {
    let stored = collectionWithSemanticPairs();
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
    expect(stored.semanticRedundancy.pairJudgments).toEqual([]);
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
        candidate.schemaVersion = 99 as 9;
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
