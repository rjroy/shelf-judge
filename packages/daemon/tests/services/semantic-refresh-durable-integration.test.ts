import { describe, expect, test } from "bun:test";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyState,
  type Collection,
  type DurableGame,
  type GameWithScore,
  type SemanticSignalJudgment,
  type TournamentData,
} from "@shelf-judge/shared";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import {
  createJevGateway,
  JEV_MODEL_ID,
  JEV_RUBRIC_VERSION,
} from "../../src/services/jev/jev-gateway.js";
import {
  createSemanticRedundancyStateService,
  semanticDescriptionSourceFingerprint,
  semanticOwnerNoteSourceFingerprint,
} from "../../src/services/semantic-redundancy-state-service.js";
import {
  createSemanticRefreshCaptureService,
  SEMANTIC_CAPTURE_POLICY,
} from "../../src/services/semantic-refresh-capture-service.js";
import {
  createSemanticRefreshService,
  type SemanticRefreshExecutionSnapshot,
} from "../../src/services/semantic-refresh-service.js";
import { createSemanticRefreshRuntime } from "../../src/services/semantic-refresh-runtime.js";
import { createSourceVectorService } from "../../src/services/source-vector.js";
import type { StorageService } from "../../src/services/storage-service.js";

const fixedNow = Date.parse("2026-01-01T00:00:00.000Z");
const instant = "2026-01-01T00:00:00.000Z";

function durableGame(id: string, bggId: number, withNote = false): DurableGame {
  return {
    id,
    name: `Game ${id}`,
    bggId,
    additionalBggIds: [],
    entityMetadata: createInitialEntityMetadata(bggId),
    latestPlayCountCheck: null,
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
      description: `private description ${id}`,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: instant,
    },
    numPlays: 4,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "valid", value: 60, source: "manual", observedAt: instant },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 2, maxPlayers: 4 },
      source: "manual",
      observedAt: instant,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: instant,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    ownerNote: withNote
      ? { state: "present", version: 1, updatedAt: instant, text: `private note ${id}` }
      : { state: "missing", version: 0, updatedAt: null },
    createdAt: instant,
    updatedAt: instant,
  };
}

function scoreRow(game: DurableGame): GameWithScore {
  return { game, score: { score: 0.8, vetoed: false } } as unknown as GameWithScore;
}

function scoreAnswer(score: number) {
  return {
    type: "score",
    score,
    legend: { "0": "0", "1": "1", "2": "2", "3": "3" },
    probabilities: { "0": 0, "1": 0.5, "2": 0.5, "3": 0 },
    confidence: 0.8,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeHarness(
  options: {
    revokeDuringRetry?: boolean;
    retryOnce?: boolean;
    multiPair?: boolean;
    changeSourceBeforePublish?: boolean;
    invalidAtSend?: number;
    cachedDUse?: boolean;
    ownerNoteWeight?: number;
    withNotes?: boolean;
    zeroPairs?: boolean;
    fetchStarted?: () => void;
    fetchResponse?: Promise<Response>;
    noCredentials?: boolean;
  } = {},
) {
  const games = [
    durableGame("game-a", 1001, options.withNotes ?? options.cachedDUse),
    durableGame("game-b", 1002, options.withNotes ?? options.cachedDUse),
  ];
  if (options.zeroPairs) games.splice(1);
  if (options.multiPair)
    games.push(durableGame("game-c", 1003, options.withNotes ?? options.cachedDUse));
  const semanticRedundancy = createInitialSemanticRedundancyState();
  semanticRedundancy.settings = {
    enabled: true,
    weights: {
      factual: 7,
      description: 5,
      ownerNote: options.ownerNoteWeight ?? (options.cachedDUse ? 10 : 0),
    },
    cachedOwnerNoteUse: options.cachedDUse === true,
  };
  const collection: Collection = {
    schemaVersion: 9,
    revision: 1,
    id: "durable-refresh-test",
    name: "No owner data fixture",
    axes: [],
    games,
    intentions: [],
    bggPlaySessions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy,
    createdAt: instant,
    updatedAt: instant,
  };
  const tournament: TournamentData = {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
    sessions: [],
    gameStats: {},
  };
  const predictionSettings = {
    stageThresholds: [5, 15, 30] as [number, number, number],
    defaultK: 5,
    minSimilarityThreshold: 0.2,
  };
  const redundancySettings = {
    enabled: false,
    stage: "annotation" as const,
    similarityThreshold: 0.6,
    maxPenalty: 2,
    componentWeights: { binary: 0.4, continuous: 0.3 },
    minNeighbors: 1,
    expectedNeighbors: 5,
  };
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
  vector.publishRedundancyWeightsFingerprint("a".repeat(64));
  const sources = { collection, tournament, predictionSettings, redundancySettings };
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
  let currentNow = fixedNow;
  let fireDeadline: (() => void) | null = null;
  const stateService = createSemanticRedundancyStateService({
    collectionMutationService: mutations,
    now: () => currentNow,
    validateSourceIdentity: (current, expected) =>
      expected.collectionId === current.id &&
      expected.collectionSchemaVersion === current.schemaVersion &&
      expected.collectionRevision === 0 &&
      expected.evidenceEpoch === current.semanticRedundancy.evidenceEpoch &&
      expected.consentEpoch === current.semanticRedundancy.consentEpoch &&
      expected.factualWeightsEpoch === current.semanticRedundancy.factualWeightsEpoch &&
      expected.factualWeightsFingerprint === current.semanticRedundancy.factualWeightsFingerprint,
  });
  let reservationCalls = 0;
  const reserveExecutionAttempt = stateService.reserveExecutionAttempt.bind(stateService);
  stateService.reserveExecutionAttempt = async (...args) => {
    reservationCalls += 1;
    return reserveExecutionAttempt(...args);
  };
  const rows = games.map(scoreRow);
  const captureService = createSemanticRefreshCaptureService({
    storageService: storage,
    gameService: { listRawGamesFromSnapshot: () => rows } as never,
    predictionService: {
      preparePredictionListFromSnapshot() {
        return Promise.resolve({ listGames: () => rows });
      },
    } as never,
    stateService,
    options: {
      providerId: "fake-typesafe",
      modelId: JEV_MODEL_ID,
      rubricVersion: JEV_RUBRIC_VERSION,
      scoringVersion: 1,
      maxSourceTextChars: 1000,
    },
    now: () => fixedNow,
  });
  let persistApprovedStart = false;
  const fakeResponse = () =>
    new Response(
      JSON.stringify({
        model: JEV_MODEL_ID,
        answers: { description_similarity: scoreAnswer(1.5) },
        usage: { input_tokens: 12, output_tokens: 3 },
      }),
      { status: 200 },
    );
  let sends = 0;
  const createRefresh = () =>
    createSemanticRefreshService({
      stateService,
      loadExecution: async (executionId) => {
        const current = await storage.loadCollection();
        const state = current.semanticRedundancy;
        const execution = state.execution;
        const manifest = state.disclosureManifest;
        const authorization = state.authorization;
        if (!execution || !manifest || !authorization || execution.commandId !== executionId)
          return null;
        const snapshot: SemanticRefreshExecutionSnapshot = {
          execution,
          manifest,
          authorizationId: authorization.id,
          deliveryComplete: state.manifestDelivery?.complete === true,
          authorizationActive: authorization.state === "active",
        };
        return snapshot;
      },
      isExecutionStartCurrentProcess: () => persistApprovedStart,
      pairAuthority: captureService,
      generationAuthority: options.changeSourceBeforePublish
        ? {
            async withCurrentGeneration(input) {
              const changed = await storage.loadCollection();
              changed.games[0].bggData!.description = "changed after final checkpoint";
              await storage.saveCollection(changed);
              return captureService.withCurrentGeneration(input);
            },
          }
        : captureService,
      gatewayFactory: (gatewayOptions) =>
        createJevGateway({
          apiKey: options.noCredentials ? undefined : "fake-key",
          maxRequests: gatewayOptions.maxRequests,
          maxReportedTokens: gatewayOptions.maxReportedTokens,
          admitAndDispatch: gatewayOptions.admitAndDispatch,
          wait: async () => {
            if (options.revokeDuringRetry) {
              await stateService.updateSettings(
                { evidenceEpoch: 0, consentEpoch: 0 },
                {
                  ...sources.collection.semanticRedundancy.settings,
                  enabled: false,
                },
              );
            }
          },
          fetch: async () => {
            sends += 1;
            options.fetchStarted?.();
            if (options.fetchResponse) return options.fetchResponse;
            if (options.invalidAtSend === sends)
              return new Response(
                JSON.stringify({
                  model: JEV_MODEL_ID,
                  answers: {},
                  usage: { input_tokens: 1, output_tokens: 1 },
                }),
                { status: 200 },
              );
            return (options.revokeDuringRetry || options.retryOnce) && sends === 1
              ? new Response("", { status: 429, headers: { "retry-after": "0" } })
              : fakeResponse();
          },
        }),
      now: () => currentNow,
      setTimer: (callback: () => void, delay: number) => {
        fireDeadline = callback;
        return setTimeout(callback, delay);
      },
      clearTimer: (handle) => clearTimeout(handle),
    });
  return {
    storage,
    stateService,
    captureService,
    createRefresh,
    createRuntime() {
      return createSemanticRefreshRuntime({
        stateService,
        captureService,
        worker: createRefresh(),
        storageService: storage,
        now: () => currentNow,
      });
    },
    get reservationCalls() {
      return reservationCalls;
    },
    cachedDUse: options.cachedDUse === true,
    revoke: () =>
      stateService.updateSettings(
        { evidenceEpoch: 0, consentEpoch: 0 },
        { ...sources.collection.semanticRedundancy.settings, enabled: false },
      ),
    expireExecution: () => {
      currentNow = Date.parse("2026-01-01T00:00:30.000Z");
      fireDeadline?.();
    },
    setStarted: () => {
      persistApprovedStart = true;
    },
    simulateRestart: () => {
      persistApprovedStart = false;
    },
    get sends() {
      return sends;
    },
  };
}

async function discloseAndStart(h: ReturnType<typeof makeHarness>) {
  const created = await h.captureService.captureAndDisclose({
    signalScope: "description-only",
    budget: SEMANTIC_CAPTURE_POLICY.defaultBudget,
    expiresAt: "2026-01-02T00:00:00.000Z",
    id: "manifest-int-test",
  });
  expect(created.outcome).toBe("accepted");
  if (created.outcome !== "accepted") throw new Error("disclosure failed");
  const manifest = (await h.storage.loadCollection()).semanticRedundancy.disclosureManifest!;
  const delivered = await h.stateService.deliverDisclosurePage({
    manifestId: manifest.id,
    manifestDigest: manifest.digest,
    offset: 0,
    limit: 100,
  });
  expect(delivered.outcome).toBe("accepted");
  if (delivered.outcome !== "accepted") throw new Error("disclosure page delivery failed");
  expect(delivered.value.receipt.complete).toBe(true);
  const started = await h.stateService.startExecution({
    commandId: manifest.id,
    manifestId: manifest.id,
    manifestDigest: manifest.digest,
    pairCount: delivered.value.pairs.length,
    sourceIdentity: manifest.sourceIdentity,
    transmissionAuthorized: true,
    noteTransmissionAuthorized: false,
    cachedOwnerNoteUseAuthorized: h.cachedDUse,
    deadlineAt: "2026-01-01T00:00:30.000Z",
  });
  expect(started.outcome).toBe("accepted");
  h.setStarted();
}

describe("semantic refresh durable integration", () => {
  test("runtime completes empty work without credentials and safely fails required inference without POST", async () => {
    const previousKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      for (const zeroPairs of [true, false]) {
        const h = makeHarness({ zeroPairs, noCredentials: true });
        const runtime = h.createRuntime();
        const captured = await h.captureService.captureAndDisclose({
          signalScope: "description-only",
          budget: SEMANTIC_CAPTURE_POLICY.defaultBudget,
          expiresAt: "2026-01-02T00:00:00.000Z",
          id: zeroPairs ? "credentialless-empty" : "credentialless-inference",
        });
        expect(captured.outcome).toBe("accepted");
        if (captured.outcome !== "accepted") throw new Error("disclosure failed");
        const manifest = (await h.storage.loadCollection()).semanticRedundancy.disclosureManifest!;
        const delivered = await runtime.deliverPage({
          manifestId: manifest.id,
          manifestDigest: manifest.digest,
          offset: 0,
          limit: 100,
        });
        expect(delivered.outcome).toBe("accepted");
        if (delivered.outcome !== "accepted") throw new Error("manifest delivery failed");
        h.setStarted();
        const started = await runtime.start({
          manifestId: manifest.id,
          manifestDigest: manifest.digest,
          sourceIdentity: manifest.sourceIdentity,
          pairCount: delivered.value.pairs.length,
          transmissionAuthorized: true,
          noteTransmissionAuthorized: false,
          cachedOwnerNoteUseAuthorized: false,
        });
        expect(started.outcome).toBe("accepted");

        let state = (await h.storage.loadCollection()).semanticRedundancy;
        for (
          let attempt = 0;
          attempt < 100 && state.execution?.status === "running";
          attempt += 1
        ) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          state = (await h.storage.loadCollection()).semanticRedundancy;
        }
        expect(h.sends).toBe(0);
        if (zeroPairs) {
          expect(state.execution?.status).toBe("completed");
          expect(state.authorization?.state).toBe("consumed");
          expect(state.publishedGeneration?.pairOutcomes).toEqual([]);
        } else {
          expect(state.execution?.status).toBe("failed");
          expect(state.authorization?.state).toBe("revoked");
          expect(state.publishedGeneration).toBeNull();
        }
      }
    } finally {
      if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = previousKey;
    }
  });

  test("explicit zero-pair worker run publishes empty ready generation without provider I/O", async () => {
    const h = makeHarness({ zeroPairs: true });
    await discloseAndStart(h);
    expect(h.sends).toBe(0);
    await h.createRefresh().run("manifest-int-test");
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.sends).toBe(0);
    expect(state.publishedGeneration?.pairOutcomes).toEqual([]);
    expect(state.execution?.status).toBe("completed");
    expect(state.authorization?.state).toBe("consumed");
  });

  test("publishes complete durable snapshot atomically and does not auto-resume after restart", async () => {
    const h = makeHarness({ multiPair: true });
    await discloseAndStart(h);
    const refresh = h.createRefresh();
    expect(h.sends).toBe(0); // Reads/capture/start never instantiate a gateway.
    await refresh.run("manifest-int-test");
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.sends).toBe(3);
    expect(state.execution?.attemptCount).toBe(3);
    expect(state.execution?.completedPairCount).toBe(3);
    expect(state.execution?.status).toBe("completed");
    expect(state.authorization?.state).toBe("consumed");
    expect(state.pairJudgments).toHaveLength(3);
    expect(state.pairJudgments[0]?.description).toMatchObject({ status: "scored", score: 0.5 });
    expect(JSON.stringify(state.pairJudgments)).not.toContain("private description");
    expect(state.publishedGeneration?.pairOutcomes).toHaveLength(3);
    expect(state.publishedGeneration?.weights).toEqual({
      factual: 7,
      description: 5,
      ownerNote: 0,
    });
    const publishedSnapshot = structuredClone(state.publishedGeneration);

    const workingCopy = await h.storage.loadCollection();
    const workingDescription = workingCopy.semanticRedundancy.pairJudgments[0]?.description;
    if (workingDescription?.status !== "scored")
      throw new Error("Expected completed description judgment in working cache");
    workingDescription.score = 0.1;
    await h.storage.saveCollection(workingCopy);
    expect((await h.storage.loadCollection()).semanticRedundancy.publishedGeneration).toEqual(
      publishedSnapshot,
    );

    h.simulateRestart();
    await h.createRefresh().run("manifest-int-test");
    expect(h.sends).toBe(3);
    expect((await h.storage.loadCollection()).semanticRedundancy.publishedGeneration).toEqual(
      publishedSnapshot,
    );
  });

  test("source change after final checkpoint prevents publication", async () => {
    const h = makeHarness({ multiPair: true, changeSourceBeforePublish: true });
    await discloseAndStart(h);
    await h.createRefresh().run("manifest-int-test");
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.sends).toBe(3);
    expect(state.pairJudgments).toHaveLength(3);
    expect(state.publishedGeneration).toBeNull();
    expect(state.authorization?.state).toBe("revoked");
    expect(state.execution?.status).toBe("failed");
  });

  test("failed pair judgment cannot publish partial required coverage", async () => {
    const h = makeHarness({ multiPair: true, invalidAtSend: 2 });
    await discloseAndStart(h);
    await h.createRefresh().run("manifest-int-test");
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.sends).toBe(2);
    expect(state.pairJudgments).toHaveLength(1);
    expect(state.publishedGeneration).toBeNull();
    expect(state.authorization?.state).toBe("revoked");
    expect(state.execution?.status).toBe("failed");
  });

  test("state publisher rejects missing and failed required pair outcomes", async () => {
    for (const failed of [false, true]) {
      const h = makeHarness({ multiPair: true });
      await discloseAndStart(h);
      const collection = await h.storage.loadCollection();
      const manifest = collection.semanticRedundancy.disclosureManifest!;
      const pair = manifest.pairs[0];
      const judgments = (failed ? manifest.pairs : [pair]).map((currentPair, index) => ({
        gameA: currentPair.gameA,
        gameB: currentPair.gameB,
        description:
          failed && index === 0
            ? ({ status: "failed" as const, reason: "provider" as const } as const)
            : {
                status: "scored" as const,
                score: 0.5,
                confidence: 0.8,
                modelId: JEV_MODEL_ID,
                rubricVersion: JEV_RUBRIC_VERSION,
                sourceFingerprintA: currentPair.descriptionFingerprintA!,
                sourceFingerprintB: currentPair.descriptionFingerprintB!,
                noteVersionA: null,
                noteVersionB: null,
                requestContext: {
                  kind: "description-only" as const,
                  descriptionRepresentationVersion: 1 as const,
                },
              },
        ownerNote: null,
      }));
      expect(
        (
          await h.stateService.checkpointJudgments({
            expected: { evidenceEpoch: 0, consentEpoch: 0 },
            authorizationId: manifest.id,
            judgments,
          })
        ).outcome,
      ).toBe("accepted");
      const result = await h.stateService.publishGeneration({
        expected: { evidenceEpoch: 0, consentEpoch: 0 },
        authorizationId: manifest.id,
        manifest,
        eligibleGameIds: manifest.eligibleGameIds,
        sourceIdentity: manifest.sourceIdentity,
        generation: {
          id: manifest.id,
          evidenceEpoch: 0,
          consentEpoch: 0,
          manifestDigest: manifest.digest,
          modelId: manifest.modelId,
          rubricVersion: manifest.rubricVersion,
          scoringVersion: manifest.scoringVersion,
          sourceIdentity: manifest.sourceIdentity,
          signalScope: manifest.signalScope,
          publishedAt: instant,
        },
      });
      expect(result.outcome).toBe("invalid-state");
      const after = (await h.storage.loadCollection()).semanticRedundancy;
      expect(after.publishedGeneration).toBeNull();
      expect(after.authorization?.state).toBe("active");
      expect(after.execution?.status).toBe("running");
    }
  });

  test("publishes D-positive C-only coverage when every owner note is genuinely absent", async () => {
    const h = makeHarness({ ownerNoteWeight: 3, withNotes: false });
    await discloseAndStart(h);
    await h.createRefresh().run("manifest-int-test");
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.sends).toBe(1);
    expect(state.execution?.status).toBe("completed");
    expect(state.authorization?.state).toBe("consumed");
    expect(state.publishedGeneration?.weights.ownerNote).toBe(3);
    expect(state.publishedGeneration?.pairOutcomes[0]?.ownerNote).toMatchObject({
      status: "unavailable",
      reason: "missing-source",
    });
  });

  test("refuses C-only publication for present-note pairs without authorized D use", async () => {
    const h = makeHarness({ ownerNoteWeight: 3, withNotes: true });
    await discloseAndStart(h);
    await h.createRefresh().run("manifest-int-test");
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.sends).toBe(1);
    expect(state.publishedGeneration).toBeNull();
    expect(state.execution?.status).toBe("failed");
    expect(state.authorization?.state).toBe("revoked");
  });

  test("cached D requires exact model and rubric provenance; compatible D publishes without sending notes", async () => {
    for (const mismatch of ["model", "rubric", "compatible"] as const) {
      const h = makeHarness({ cachedDUse: true });
      await discloseAndStart(h);
      const collection = await h.storage.loadCollection();
      const state = collection.semanticRedundancy;
      const manifest = state.disclosureManifest!;
      const authorization = state.authorization!;
      const pairJudgments = manifest.pairs.map((pair) => {
        const gameA = collection.games.find(({ id }) => id === pair.gameA)!;
        const gameB = collection.games.find(({ id }) => id === pair.gameB)!;
        const description: SemanticSignalJudgment = {
          status: "scored",
          score: 0.5,
          confidence: 0.8,
          modelId: manifest.modelId,
          rubricVersion: manifest.rubricVersion,
          sourceFingerprintA: semanticDescriptionSourceFingerprint(gameA)!,
          sourceFingerprintB: semanticDescriptionSourceFingerprint(gameB)!,
          noteVersionA: null,
          noteVersionB: null,
          requestContext: {
            kind: "description-only",
            descriptionRepresentationVersion: 1,
          },
        };
        const ownerNote: SemanticSignalJudgment = {
          status: "scored",
          score: 0.6,
          confidence: 0.8,
          modelId: mismatch === "model" ? `${manifest.modelId}-old` : manifest.modelId,
          rubricVersion:
            mismatch === "rubric" ? manifest.rubricVersion + 1 : manifest.rubricVersion,
          sourceFingerprintA: semanticOwnerNoteSourceFingerprint(gameA)!,
          sourceFingerprintB: semanticOwnerNoteSourceFingerprint(gameB)!,
          noteVersionA: gameA.ownerNote.version,
          noteVersionB: gameB.ownerNote.version,
          requestContext: { kind: "owner-notes-only", ownerNoteRepresentationVersion: 1 },
        };
        return { gameA: pair.gameA, gameB: pair.gameB, description, ownerNote };
      });
      state.pairJudgments = pairJudgments;
      state.publishedGeneration = {
        id: "prior-valid-generation",
        evidenceEpoch: manifest.sourceIdentity.evidenceEpoch,
        consentEpoch: manifest.sourceIdentity.consentEpoch,
        manifestDigest: manifest.digest,
        modelId: manifest.modelId,
        rubricVersion: manifest.rubricVersion,
        scoringVersion: manifest.scoringVersion,
        sourceIdentity: manifest.sourceIdentity,
        signalScope: manifest.signalScope,
        eligibleGameIds: manifest.eligibleGameIds,
        weights: { ...state.settings.weights },
        pairOutcomes: manifest.pairs.map(({ gameA, gameB }) => ({
          gameA,
          gameB,
          description: null,
          ownerNote: null,
        })),
        publishedAt: instant,
      };
      await h.storage.saveCollection(collection);

      const publish = await h.captureService.withCurrentGeneration({
        executionId: "manifest-int-test",
        manifest,
        operation: (authority) =>
          h.stateService.publishGeneration({
            expected: {
              evidenceEpoch: manifest.sourceIdentity.evidenceEpoch,
              consentEpoch: manifest.sourceIdentity.consentEpoch,
            },
            authorizationId: authorization.id,
            manifest,
            eligibleGameIds: authority.eligibleGameIds,
            sourceIdentity: authority.sourceIdentity,
            generation: {
              id: manifest.id,
              evidenceEpoch: manifest.sourceIdentity.evidenceEpoch,
              consentEpoch: manifest.sourceIdentity.consentEpoch,
              manifestDigest: manifest.digest,
              modelId: manifest.modelId,
              rubricVersion: manifest.rubricVersion,
              scoringVersion: manifest.scoringVersion,
              sourceIdentity: authority.sourceIdentity,
              signalScope: manifest.signalScope,
              publishedAt: instant,
            },
          }),
      });
      const after = (await h.storage.loadCollection()).semanticRedundancy;
      expect(h.sends).toBe(0);
      if (mismatch === "compatible") {
        expect(publish.outcome).toBe("accepted");
        expect(after.authorization?.state).toBe("consumed");
        expect(after.publishedGeneration?.id).toBe(manifest.id);
        expect(after.publishedGeneration?.pairOutcomes[0]?.ownerNote?.status).toBe("scored");
      } else {
        expect(publish.outcome).toBe("invalid-state");
        expect(after.authorization?.state).toBe("active");
        expect(after.execution?.status).toBe("running");
        expect(after.publishedGeneration?.id).toBe("prior-valid-generation");
      }
    }
  });

  test("real gateway retry rechecks revoked consent before the second POST", async () => {
    const h = makeHarness({ revokeDuringRetry: true });
    await discloseAndStart(h);
    await h.createRefresh().run("manifest-int-test");
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.sends).toBe(1);
    expect(state.pairJudgments).toHaveLength(0);
    expect(state.publishedGeneration).toBeNull();
  });

  test("real gateway sends the second POST when retry consent remains active", async () => {
    const h = makeHarness({ retryOnce: true });
    await discloseAndStart(h);
    await h.createRefresh().run("manifest-int-test");
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.sends).toBe(2);
    expect(state.pairJudgments).toHaveLength(1);
  });

  test("dispatch starts inside durable admission; revocation completes before stale response checkpoint", async () => {
    const started = deferred();
    const responseGate = deferred<Response>();
    const events: string[] = [];
    const h = makeHarness({
      fetchStarted: () => {
        events.push("fetch-start");
        started.resolve();
      },
      fetchResponse: responseGate.promise,
    });
    const originalReservationService = h.stateService.reserveExecutionAttempt.bind(h.stateService);
    h.stateService.reserveExecutionAttempt = async (...args) => {
      events.push("reservation");
      return originalReservationService(...args);
    };
    await discloseAndStart(h);
    const running = h.createRefresh().run("manifest-int-test");

    await started.promise;
    const admittedState = (await h.storage.loadCollection()).semanticRedundancy;
    expect(admittedState.execution?.attemptCount).toBe(1);
    expect(h.reservationCalls).toBe(1);
    const revoked = await h.revoke();
    expect(revoked.outcome).toBe("accepted");
    events.push("revocation-committed");
    expect(events).toEqual(["reservation", "fetch-start", "revocation-committed"]);
    const duringRequest = (await h.storage.loadCollection()).semanticRedundancy;
    expect(duringRequest.execution).toBeNull();
    expect(duringRequest.pairJudgments).toHaveLength(0);

    responseGate.resolve(
      new Response(
        JSON.stringify({
          model: JEV_MODEL_ID,
          answers: { description_similarity: scoreAnswer(1.5) },
          usage: { input_tokens: 12, output_tokens: 3 },
        }),
        { status: 200 },
      ),
    );
    await running;
    const finalState = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.sends).toBe(1);
    expect(finalState.pairJudgments).toHaveLength(0);
  });

  test("revocation before admission causes neither reservation nor POST", async () => {
    const h = makeHarness();
    await discloseAndStart(h);
    const revoked = await h.revoke();
    expect(revoked.outcome).toBe("accepted");

    await h.createRefresh().run("manifest-int-test");
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.reservationCalls).toBe(0);
    expect(h.sends).toBe(0);
    expect(state.execution).toBeNull();
    expect(state.pairJudgments).toHaveLength(0);
  });

  test("deadline aborts a signal-ignoring fetch; late response cannot checkpoint or retry", async () => {
    const started = deferred();
    const responseGate = deferred<Response>();
    const h = makeHarness({
      fetchStarted: () => started.resolve(),
      fetchResponse: responseGate.promise,
    });
    await discloseAndStart(h);
    const running = h.createRefresh().run("manifest-int-test");
    await started.promise;
    h.expireExecution();
    await running;

    responseGate.resolve(new Response("", { status: 429, headers: { "retry-after": "0" } }));
    await Promise.resolve();
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(h.sends).toBe(1);
    expect(state.execution?.status).toBe("interrupted");
    expect(state.pairJudgments).toHaveLength(0);
  });
});
