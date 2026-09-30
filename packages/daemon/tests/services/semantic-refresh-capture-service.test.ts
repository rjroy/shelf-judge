import { describe, expect, test } from "bun:test";
import {
  createInitialSemanticRedundancyState,
  createInitialEntityMetadata,
  type Collection,
  type DurableGame,
  type GameWithScore,
  type PredictionSettings,
  type RedundancySettings,
  type TournamentData,
} from "@shelf-judge/shared";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import { createGameService } from "../../src/services/game-service.js";
import { createPredictionService } from "../../src/services/prediction-service.js";
import { createSemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import {
  createSemanticRefreshCaptureService,
  SEMANTIC_CAPTURE_POLICY,
} from "../../src/services/semantic-refresh-capture-service.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import { createSourceVectorService } from "../../src/services/source-vector.js";
import type { StorageService } from "../../src/services/storage-service.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const predictionSettings: PredictionSettings = {
  stageThresholds: [5, 15, 30],
  defaultK: 5,
  minSimilarityThreshold: 0.2,
};
const redundancySettings: RedundancySettings = {
  enabled: false,
  stage: "annotation",
  similarityThreshold: 0.6,
  maxPenalty: 2,
  componentWeights: { binary: 0.4, continuous: 0.3 },
  minNeighbors: 1,
  expectedNeighbors: 5,
};
const tournament: TournamentData = {
  settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
  sessions: [],
  gameStats: {},
};

function game(
  id: string,
  options: {
    ownership?: DurableGame["ownership"];
    note?: string | null;
    description?: string | null;
  } = {},
): DurableGame {
  const bggId = [...id].reduce((value, char) => value * 31 + char.charCodeAt(0), 7);
  return {
    id,
    name: `Game ${id}`,
    bggId,
    entityMetadata: createInitialEntityMetadata(bggId),
    latestPlayCountCheck: null,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: {
      communityRating: 7,
      bayesAverage: 7,
      weight: 2,
      numWeightVotes: 100,
      description: options.description === undefined ? `description ${id}` : options.description,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: timestamp,
    },
    numPlays: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "valid", value: 60, source: "manual", observedAt: timestamp },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 2, maxPlayers: 2 },
      source: "manual",
      observedAt: timestamp,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: timestamp,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    ownership: options.ownership ?? "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    ownerNote:
      options.note === null
        ? { state: "missing", version: 0, updatedAt: null }
        : {
            state: "present",
            version: 1,
            text: options.note ?? `private note ${id}`,
            updatedAt: timestamp,
          },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function scored(entryGame: DurableGame, score = 0.8, vetoed = false): GameWithScore {
  return { game: entryGame, score: { score, vetoed } } as unknown as GameWithScore;
}

function setup(
  options: {
    games?: GameWithScore[];
    durableGames?: DurableGame[];
    beforePrediction?: (sources: MutableSources) => void | Promise<void>;
    maxSourceTextChars?: number;
  } = {},
) {
  const collection: Collection = {
    schemaVersion: 9,
    revision: 1,
    id: "capture-collection",
    name: "Capture test",
    axes: [],
    games:
      options.durableGames ?? (options.games ?? []).map(({ game: entry }) => entry as DurableGame),
    bggPlaySessions: [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: createInitialSemanticRedundancyState(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  collection.semanticRedundancy.settings.enabled = true;
  collection.semanticRedundancy.settings.weights.description = 1;
  collection.semanticRedundancy.settings.weights.ownerNote = 1;
  collection.semanticRedundancy.settings.cachedOwnerNoteUse = true;
  const vector = createSourceVectorService();
  vector.hydrate(
    {
      id: collection.id,
      schemaVersion: 9,
      revision: collection.revision,
      semanticEvidenceEpoch: 0,
      semanticConsentEpoch: 0,
      factualWeightsEpoch: 0,
      factualWeightsFingerprint: null,
    },
    {
      tournament: 1,
      predictionSettings: 1,
      nicheSettings: 1,
      redundancySettings: 1,
      shelfConfig: 1,
    },
  );
  vector.publishRedundancyWeightsFingerprint("d".repeat(64));
  const sources: MutableSources = {
    collection,
    tournament: structuredClone(tournament),
    predictionSettings: structuredClone(predictionSettings),
    redundancySettings: structuredClone(redundancySettings),
    vector,
  };
  const storage = {
    sourceVector: () => vector.read(),
    loadCollection: () => Promise.resolve(structuredClone(sources.collection)),
    saveCollection: (next: Collection) => {
      sources.collection = structuredClone(next);
      vector.publishCollection({
        id: next.id,
        schemaVersion: next.schemaVersion,
        revision: next.revision,
        semanticEvidenceEpoch: next.semanticRedundancy.evidenceEpoch,
        semanticConsentEpoch: next.semanticRedundancy.consentEpoch,
        factualWeightsEpoch: next.semanticRedundancy.factualWeightsEpoch,
        factualWeightsFingerprint: next.semanticRedundancy.factualWeightsFingerprint,
      });
      return Promise.resolve();
    },
    loadTournament: () => Promise.resolve(structuredClone(sources.tournament)),
    loadPredictionSettings: () => Promise.resolve(structuredClone(sources.predictionSettings)),
    loadRedundancySettings: () => Promise.resolve(structuredClone(sources.redundancySettings)),
  } as unknown as StorageService;
  const mutations = createCollectionMutationService({ storageService: storage });
  const stateService = createSemanticRedundancyStateService({
    collectionMutationService: mutations,
    validateSourceIdentity: () => true,
    now: () => Date.parse(timestamp),
  });
  const gameService = {
    listRawGamesFromSnapshot: () => options.games ?? [],
  } as unknown as ReturnType<typeof createGameService>;
  const predictionService = {
    preparePredictionListFromSnapshot: () =>
      Promise.resolve(options.beforePrediction?.(sources)).then(() => ({
        listGames: () => options.games ?? [],
      })),
  } as unknown as ReturnType<typeof createPredictionService>;
  const service = createSemanticRefreshCaptureService({
    storageService: storage,
    gameService,
    predictionService,
    stateService,
    options: {
      providerId: "pinned-provider",
      modelId: "pinned-model",
      rubricVersion: 1,
      scoringVersion: 1,
      maxSourceTextChars: options.maxSourceTextChars ?? 10_000,
    },
    now: () => Date.parse(timestamp),
  });
  return {
    service,
    sources,
    storage,
    read: () => structuredClone(sources.collection),
  };
}

interface MutableSources {
  collection: Collection;
  tournament: TournamentData;
  predictionSettings: PredictionSettings;
  redundancySettings: RedundancySettings;
  vector: ReturnType<typeof createSourceVectorService>;
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function request(
  signalScope:
    | "description-only"
    | "owner-notes-only"
    | "description-and-owner-notes" = "description-and-owner-notes",
  budget: { maxRequests: number; maxTokens: number; maxDurationMs: number } | undefined = undefined,
  expiresAt = "2026-01-02T00:00:00.000Z",
) {
  return {
    signalScope,
    budget: budget ?? SEMANTIC_CAPTURE_POLICY.defaultBudget,
    expiresAt,
    id: "capture-manifest",
  };
}

describe("semantic refresh capture", () => {
  test("freezes three predicted eligible games into all sorted pairs without source text", async () => {
    const entries = [
      scored(game("g-c")),
      scored(game("g-a")),
      scored(game("g-b")),
      scored(game("g-veto"), 0.9, true),
      scored(game("g-retired", { ownership: "previously-owned" })),
      scored(game("g-zero"), 0),
    ];
    const { service, read } = setup({ games: entries });
    const result = await service.captureAndDisclose(request());
    expect(result).toMatchObject({ outcome: "accepted", value: { id: "capture-manifest" } });
    const state = read().semanticRedundancy;
    expect(state.disclosure?.pairCount).toBe(3);
    expect(state.disclosureManifest?.sourceIdentity.collectionRevision).toBe(0);
    expect(state.disclosureManifest?.budget).toEqual({
      maxRequests: 19_900,
      maxTokens: 250_000_000,
      maxDurationMs: 24 * 60 * 60 * 1_000,
    });
    expect(state.disclosureManifest?.eligibleGameIds).toEqual(["g-a", "g-b", "g-c"]);
    expect(state.disclosureManifest?.pairs.map(({ gameA, gameB }) => [gameA, gameB])).toEqual([
      ["g-a", "g-b"],
      ["g-a", "g-c"],
      ["g-b", "g-c"],
    ]);
    expect(
      state.disclosureManifest?.pairs.every((pair) => pair.hasOwnerNoteA && pair.hasOwnerNoteB),
    ).toBe(true);
    expect(JSON.stringify(state.disclosureManifest)).not.toContain("private note");
    expect(JSON.stringify(state.disclosureManifest)).not.toContain("description g-");
  });

  test("generation authority matches disclosure eligibility and covers zero or every pair exactly", async () => {
    const entries = [
      scored(game("g-c")),
      scored(game("g-a")),
      scored(game("g-b")),
      scored(game("g-veto"), 0.9, true),
      scored(game("g-retired", { ownership: "previously-owned" })),
      scored(game("g-zero"), 0),
    ];
    const h = setup({ games: entries });
    await h.service.captureAndDisclose(request());
    const manifest = h.read().semanticRedundancy.disclosureManifest!;
    const authority = await h.service.withCurrentGeneration({
      executionId: "execution",
      manifest,
      operation: (value) => Promise.resolve(value),
    });
    expect(authority.eligibleGameIds).toEqual(manifest.eligibleGameIds);
    expect(manifest.pairs).toHaveLength(3);

    const empty = setup({ games: [] });
    await empty.service.captureAndDisclose(request());
    const emptyManifest = empty.read().semanticRedundancy.disclosureManifest!;
    expect(emptyManifest.pairs).toEqual([]);
    expect(
      await empty.service.withCurrentGeneration({
        executionId: "empty",
        manifest: emptyManifest,
        operation: (value) => Promise.resolve(value.eligibleGameIds),
      }),
    ).toEqual([]);
  });

  test("revalidates the complete manifest at each runtime boundary without an execution ID", async () => {
    const games = [scored(game("g-a")), scored(game("g-b"))];
    const h = setup({ games });
    await h.service.captureAndDisclose(request());
    const manifest = h.read().semanticRedundancy.disclosureManifest!;

    expect(
      h.service.withCurrentManifest({ manifest, operation: () => Promise.resolve("page") }),
    ).resolves.toBe("page");
    h.sources.tournament.settings.kFactorThreshold += 1;
    h.sources.vector.publish("tournament", 2);
    expect(
      h.service.withCurrentManifest({ manifest, operation: () => Promise.resolve("stale start") }),
    ).rejects.toMatchObject({ reason: "source-changed" });
    h.sources.tournament.settings.kFactorThreshold -= 1;
    h.sources.vector.publish("tournament", 1);
    // The vector and source identity stay unchanged, but eligibility is a separately verified
    // projection and must not be inferred from the manifest or an earlier page check.
    games.pop();
    expect(
      h.service.withCurrentManifest({ manifest, operation: () => Promise.resolve("stale page") }),
    ).rejects.toMatchObject({ reason: "source-changed" });
    games.push(scored(game("g-b")));
    expect(
      h.service.withCurrentManifest({ manifest, operation: () => Promise.resolve("start") }),
    ).resolves.toBe("start");
  });

  test("source identity validator catches external revisions and accepts them only when restored", async () => {
    const h = setup({ games: [scored(game("g-a")), scored(game("g-b"))] });
    await h.service.captureAndDisclose(request());
    const manifest = h.read().semanticRedundancy.disclosureManifest!;
    expect(await h.service.validateSourceIdentity(h.read(), manifest.sourceIdentity)).toBe(true);

    h.sources.tournament.settings.kFactorThreshold += 1;
    h.sources.vector.publish("tournament", 2);
    expect(await h.service.validateSourceIdentity(h.read(), manifest.sourceIdentity)).toBe(false);
    h.sources.tournament.settings.kFactorThreshold -= 1;
    h.sources.vector.publish("tournament", 1);
    expect(await h.service.validateSourceIdentity(h.read(), manifest.sourceIdentity)).toBe(true);
  });

  test.each(["extra", "missing"] as const)(
    "generation authority rejects %s pair coverage",
    async (change) => {
      const h = setup({ games: [scored(game("g-a")), scored(game("g-b"))] });
      await h.service.captureAndDisclose(request());
      const manifest = structuredClone(h.read().semanticRedundancy.disclosureManifest!);
      if (change === "missing") manifest.pairs.pop();
      else {
        const firstPair = manifest.pairs[0];
        if (firstPair === undefined) throw new Error("Expected a disclosed pair");
        manifest.pairs.push({ ...firstPair, gameA: "g-a", gameB: "g-extra" });
      }
      const { id, digest, ...unsigned } = manifest;
      void id;
      void digest;
      manifest.digest = (await import("@shelf-judge/shared")).semanticDisclosureManifestDigest(
        unsigned,
      );
      expect(
        h.service.withCurrentGeneration({
          executionId: "execution",
          manifest,
          operation: () => Promise.resolve(undefined),
        }),
      ).rejects.toMatchObject({ reason: "source-changed" });
    },
  );

  test("generation authority rejects durable source edits but ignores its own collection write revision", async () => {
    const h = setup({ games: [scored(game("g-a")), scored(game("g-b"))] });
    await h.service.captureAndDisclose(request());
    const manifest = h.read().semanticRedundancy.disclosureManifest!;
    const next = h.read();
    next.revision += 1;
    h.sources.collection = next;
    h.sources.vector.publishCollection({
      id: next.id,
      schemaVersion: next.schemaVersion,
      revision: next.revision,
      semanticEvidenceEpoch: next.semanticRedundancy.evidenceEpoch,
      semanticConsentEpoch: next.semanticRedundancy.consentEpoch,
      factualWeightsEpoch: next.semanticRedundancy.factualWeightsEpoch,
      factualWeightsFingerprint: next.semanticRedundancy.factualWeightsFingerprint,
    });
    expect(
      h.service.withCurrentGeneration({
        executionId: "execution",
        manifest,
        operation: (value) => Promise.resolve(value.eligibleGameIds),
      }),
    ).resolves.toEqual(["g-a", "g-b"]);

    h.sources.tournament.settings.kFactorThreshold += 1;
    h.sources.vector.publish("tournament", 2);
    expect(
      h.service.withCurrentGeneration({
        executionId: "execution",
        manifest,
        operation: () => Promise.resolve(undefined),
      }),
    ).rejects.toMatchObject({ reason: "source-changed" });
  });

  test.each(["ownership", "prediction", "factual"] as const)(
    "generation authority rejects a %s source edit",
    async (source) => {
      const h = setup({ games: [scored(game("g-a")), scored(game("g-b"))] });
      await h.service.captureAndDisclose(request());
      const manifest = h.read().semanticRedundancy.disclosureManifest!;
      if (source === "ownership") {
        h.sources.collection.games[0].ownership = "previously-owned";
      } else if (source === "prediction") {
        h.sources.predictionSettings.defaultK += 1;
        h.sources.vector.publish("prediction-settings", 2);
      } else {
        h.sources.vector.publishRedundancyWeightsFingerprint("f".repeat(64));
      }
      expect(
        h.service.withCurrentGeneration({
          executionId: "execution",
          manifest,
          operation: () => Promise.resolve(undefined),
        }),
      ).rejects.toMatchObject({ reason: "source-changed" });
    },
  );

  test("runs the authority operation while the source coordinator is held", async () => {
    const h = setup({ games: [scored(game("g-a")), scored(game("g-b"))] });
    await h.service.captureAndDisclose(request());
    const manifest = h.read().semanticRedundancy.disclosureManifest!;
    const entered = deferred<void>();
    const resume = deferred<void>();
    const authorityRun = h.service.withCurrentGeneration({
      executionId: "execution",
      manifest,
      operation: async () => {
        entered.resolve(undefined);
        await resume.promise;
      },
    });
    await entered.promise;
    let secondOperationEntered = false;
    const secondRun = profileSourceCoordinatorFor(h.storage).runExclusive(() => {
      secondOperationEntered = true;
      return Promise.resolve();
    });
    await Promise.resolve();
    expect(secondOperationEntered).toBe(false);
    resume.resolve(undefined);
    await Promise.all([authorityRun, secondRun]);
    expect(secondOperationEntered).toBe(true);
  });

  test.each(["collection", "tournament", "prediction", "factual"] as const)(
    "refuses persistence if %s source changes after scoring capture",
    (source) => {
      const entries = [scored(game("g-a")), scored(game("g-b"))];
      const { service, sources, read } = setup({
        games: entries,
        beforePrediction(current) {
          if (source === "collection") {
            current.collection.semanticRedundancy.settings.weights.description = 4;
          } else if (source === "tournament") {
            current.tournament.settings.kFactorThreshold += 1;
            current.vector.publish("tournament", 2);
          } else if (source === "prediction") {
            current.predictionSettings.defaultK += 1;
            current.vector.publish("prediction-settings", 2);
          } else {
            current.vector.publishRedundancyWeightsFingerprint("e".repeat(64));
          }
        },
      });
      expect(sources.collection.semanticRedundancy.disclosureManifest).toBeNull();
      expect(service.captureAndDisclose(request())).rejects.toMatchObject({
        reason: "source-changed",
      });
      expect(read().semanticRedundancy.disclosureManifest).toBeNull();
    },
  );

  test("accepts the 200-game/19,900-pair boundary and refuses larger universes", async () => {
    const twoHundred = Array.from({ length: 200 }, (_, index) =>
      scored(game(`g-${index}`, { description: null, note: null })),
    );
    const accepted = setup({ games: twoHundred });
    expect(
      await accepted.service.captureAndDisclose(
        request("description-only", { maxRequests: 0, maxTokens: 0, maxDurationMs: 60_000 }),
      ),
    ).toMatchObject({ outcome: "accepted" });
    expect(accepted.read().semanticRedundancy.disclosure?.pairCount).toBe(19_900);

    const oversized = setup({ games: [...twoHundred, scored(game("g-extra"))] });
    expect(oversized.service.captureAndDisclose(request())).rejects.toMatchObject({
      reason: "too-many-eligible-games",
    });
  });

  test("default policy admits 200 high-text games within its disclosed token and time caps", () => {
    const highTextGames = Array.from({ length: 200 }, (_, index) =>
      scored(
        game(`high-${index}`, {
          description: "d".repeat(10_000),
          note: "n".repeat(10_000),
        }),
      ),
    );
    const { service, read } = setup({ games: highTextGames, maxSourceTextChars: 10_000 });
    expect(service.captureAndDisclose(request())).resolves.toMatchObject({
      outcome: "accepted",
    });
    expect(read().semanticRedundancy.disclosure?.pairCount).toBe(19_900);
    expect(read().semanticRedundancy.disclosureManifest?.budget).toEqual(
      SEMANTIC_CAPTURE_POLICY.defaultBudget,
    );
    // This is an admission cap only; a provider is not guaranteed to finish within the duration.
  });

  test("rejects oversized source text before disclosure persistence", () => {
    const { service, read } = setup({
      games: [scored(game("g-a", { description: "x".repeat(101) })), scored(game("g-b"))],
      maxSourceTextChars: 100,
    });
    expect(service.captureAndDisclose(request())).rejects.toMatchObject({
      reason: "source-text-too-large",
    });
    expect(read().semanticRedundancy.disclosureManifest).toBeNull();
  });

  test("preflights request budget without truncating pair coverage", () => {
    const { service, read } = setup({
      games: [scored(game("g-a")), scored(game("g-b")), scored(game("g-c"))],
    });
    expect(
      service.captureAndDisclose(
        request("description-and-owner-notes", {
          maxRequests: 2,
          maxTokens: 10_000,
          maxDurationMs: 60_000,
        }),
      ),
    ).rejects.toMatchObject({
      reason: "request-budget-exceeded",
    });
    expect(read().semanticRedundancy.disclosureManifest).toBeNull();
  });

  test("rejects scored IDs absent from captured durable source", () => {
    const { service, read } = setup({ games: [scored(game("g-predicted"))], durableGames: [] });
    expect(service.captureAndDisclose(request())).rejects.toMatchObject({
      reason: "invalid-capture",
    });
    expect(read().semanticRedundancy.disclosureManifest).toBeNull();
  });

  test("releases the source coordinator during delayed scoring and revalidates afterward", async () => {
    const scoringStarted = deferred<void>();
    const resumeScoring = deferred<void>();
    const h = setup({
      games: [scored(game("g-a")), scored(game("g-b"))],
      beforePrediction: () => {
        scoringStarted.resolve(undefined);
        return resumeScoring.promise;
      },
    });
    const capture = h.service.captureAndDisclose(request());
    await scoringStarted.promise;

    let sourceMutationCompleted = false;
    await profileSourceCoordinatorFor(h.storage).runExclusive(() => {
      h.sources.tournament.settings.kFactorThreshold += 1;
      h.sources.vector.publish("tournament", 2);
      sourceMutationCompleted = true;
      return Promise.resolve();
    });
    expect(sourceMutationCompleted).toBe(true);

    resumeScoring.resolve(undefined);
    expect(capture).rejects.toMatchObject({ reason: "source-changed" });
    expect(h.read().semanticRedundancy.disclosureManifest).toBeNull();
  });

  test("uses a fresh expiry on each disclosure invocation", () => {
    let clock = Date.parse(timestamp);
    const h = setup({ games: [scored(game("g-a")), scored(game("g-b"))] });
    // Service clock is intentionally advanced after construction; expiry is invocation-scoped.
    const late = createSemanticRefreshCaptureService({
      storageService: h.storage,
      gameService: {
        listRawGamesFromSnapshot: () => [scored(game("g-a")), scored(game("g-b"))],
      } as unknown as ReturnType<typeof createGameService>,
      predictionService: {
        preparePredictionListFromSnapshot: () =>
          Promise.resolve({ listGames: () => [scored(game("g-a")), scored(game("g-b"))] }),
      } as unknown as ReturnType<typeof createPredictionService>,
      stateService: createSemanticRedundancyStateService({
        collectionMutationService: createCollectionMutationService({ storageService: h.storage }),
        validateSourceIdentity: () => true,
        now: () => clock,
      }),
      options: {
        providerId: "pinned-provider",
        modelId: "pinned-model",
        rubricVersion: 1,
        scoringVersion: 1,
        maxSourceTextChars: 10_000,
      },
      now: () => clock,
    });
    clock += 60_000;
    expect(
      late.captureAndDisclose(request("description-only", undefined, "2026-01-01T00:02:00.000Z")),
    ).resolves.toMatchObject({ outcome: "accepted" });
  });

  test("accepts C-only without D settings and rejects unauthorized scope and unsafe budgets", () => {
    const h = setup({ games: [scored(game("g-a")), scored(game("g-b"))] });
    h.sources.collection.semanticRedundancy.settings.weights.ownerNote = 0;
    h.sources.collection.semanticRedundancy.settings.cachedOwnerNoteUse = false;
    expect(h.service.captureAndDisclose(request("description-only"))).resolves.toMatchObject({
      outcome: "accepted",
    });

    const dOnly = setup({ games: [scored(game("g-a")), scored(game("g-b"))] });
    dOnly.sources.collection.semanticRedundancy.settings.weights.description = 0;
    expect(dOnly.service.captureAndDisclose(request("owner-notes-only"))).resolves.toMatchObject({
      outcome: "accepted",
    });
    dOnly.sources.collection.semanticRedundancy.settings.weights.ownerNote = 0;
    expect(
      dOnly.service.captureAndDisclose(request("description-and-owner-notes")),
    ).rejects.toMatchObject({
      reason: "invalid-capture",
    });
    expect(
      dOnly.service.captureAndDisclose(
        request("description-only", {
          maxRequests: 19_901,
          maxTokens: 250_000_000,
          maxDurationMs: 24 * 60 * 60 * 1_000,
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid-capture" });
    expect(
      dOnly.service.captureAndDisclose({
        ...request("description-only"),
        expiresAt: "2026-02-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ reason: "invalid-capture" });
    expect(
      dOnly.service.captureAndDisclose({
        ...request("description-only"),
        id: "x".repeat(129),
      }),
    ).rejects.toMatchObject({ reason: "invalid-capture" });
    expect(
      dOnly.service.captureAndDisclose(
        request("description-only", {
          maxRequests: 1,
          maxTokens: 1_000_000_001,
          maxDurationMs: 24 * 60 * 60 * 1_000,
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid-capture" });
    expect(
      dOnly.service.captureAndDisclose(
        request("description-only", {
          maxRequests: 1,
          maxTokens: 1_000,
          maxDurationMs: 7 * 24 * 60 * 60 * 1_000 + 1,
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid-capture" });
  });
});
