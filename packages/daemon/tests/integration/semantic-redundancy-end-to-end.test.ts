import { describe, expect, test } from "bun:test";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyState,
  type Collection,
  type DurableGame,
  type GameWithScore,
  type TournamentData,
} from "@shelf-judge/shared";
import { Hono } from "hono";
import { createRedundancyRoutes } from "../../src/routes/redundancy.js";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import { createOwnerGameNoteService } from "../../src/services/owner-game-note-service.js";
import { createJevGateway, JEV_MODEL_ID } from "../../src/services/jev/jev-gateway.js";
import { createSemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import { createSemanticRefreshCaptureService } from "../../src/services/semantic-refresh-capture-service.js";
import { createSemanticRefreshService } from "../../src/services/semantic-refresh-service.js";
import { createSemanticRefreshRuntime } from "../../src/services/semantic-refresh-runtime.js";
import { createSourceVectorService } from "../../src/services/source-vector.js";
import type { StorageService } from "../../src/services/storage-service.js";

const instant = "2026-01-01T00:00:00.000Z";
const fixedNow = Date.parse(instant);

function game(id: string, bggId: number, withNote = false): DurableGame {
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
      numWeightVotes: 50,
      description: `fixture description ${id}`,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: instant,
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ownerNote: withNote
      ? { state: "present", version: 1, updatedAt: instant, text: `private note ${id}` }
      : { state: "missing", version: 0, updatedAt: null },
    ratings: {},
    createdAt: instant,
    updatedAt: instant,
  };
}

function scoreRow(gameData: DurableGame): GameWithScore {
  return { game: gameData, score: { score: 0.7, vetoed: false } } as unknown as GameWithScore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error("Expected a JSON object response");
  return value;
}

function arrayProperty(value: Record<string, unknown>, key: string): unknown[] {
  const property = value[key];
  if (!Array.isArray(property)) throw new Error(`Expected ${key} to be an array`);
  return property;
}

function harness(
  harnessOptions: {
    withNotes?: boolean;
    fetch?: (signal: AbortSignal | null) => Promise<Response>;
  } = {},
) {
  const rows = [
    game("a", 1001, harnessOptions.withNotes),
    game("b", 1002, harnessOptions.withNotes),
  ];
  const collection: Collection = {
    schemaVersion: 9,
    revision: 0,
    id: "semantic-e2e",
    name: "Semantic test collection",
    axes: [],
    games: rows,
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: createInitialSemanticRedundancyState(),
    createdAt: instant,
    updatedAt: instant,
  };
  collection.semanticRedundancy.settings = {
    enabled: true,
    weights: { factual: 7, description: 5, ownerNote: harnessOptions.withNotes ? 3 : 0 },
    cachedOwnerNoteUse: harnessOptions.withNotes === true,
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
      revision: 0,
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
  const source = { collection, tournament, predictionSettings, redundancySettings };
  const storage = {
    sourceVector: () => vector.read(),
    loadCollection: () => Promise.resolve(structuredClone(source.collection)),
    saveCollection: (next: Collection) => {
      source.collection = structuredClone(next);
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
    loadTournament: () => Promise.resolve(structuredClone(source.tournament)),
    loadPredictionSettings: () => Promise.resolve(structuredClone(source.predictionSettings)),
    loadRedundancySettings: () => Promise.resolve(structuredClone(source.redundancySettings)),
    saveRedundancySettings: (next: typeof redundancySettings) => {
      source.redundancySettings = structuredClone(next);
      vector.publish("redundancy-settings", 2);
      return Promise.resolve();
    },
  } as unknown as StorageService;
  const mutations = createCollectionMutationService({ storageService: storage });
  const ownerGameNoteService = createOwnerGameNoteService({
    collectionMutationService: mutations,
    now: () => instant,
  });
  const stateService = createSemanticRedundancyStateService({
    collectionMutationService: mutations,
    now: () => fixedNow,
    validateSourceIdentity: (current, expected) =>
      expected.collectionId === current.id &&
      expected.collectionSchemaVersion === current.schemaVersion &&
      expected.collectionRevision === 0 &&
      expected.evidenceEpoch === current.semanticRedundancy.evidenceEpoch &&
      expected.consentEpoch === current.semanticRedundancy.consentEpoch &&
      expected.factualWeightsEpoch === current.semanticRedundancy.factualWeightsEpoch &&
      expected.factualWeightsFingerprint === current.semanticRedundancy.factualWeightsFingerprint,
  });
  const rowsWithScores = rows.map(scoreRow);
  const captureService = createSemanticRefreshCaptureService({
    storageService: storage,
    gameService: { listRawGamesFromSnapshot: () => rowsWithScores } as never,
    predictionService: {
      preparePredictionListFromSnapshot() {
        return Promise.resolve({ listGames: () => rowsWithScores });
      },
    } as never,
    stateService,
    options: {
      providerId: "fake-typesafe",
      modelId: JEV_MODEL_ID,
      rubricVersion: 1,
      scoringVersion: 1,
      maxSourceTextChars: 1000,
    },
    now: () => fixedNow,
  });
  let sends = 0;
  const outboundPayloads: string[] = [];
  const worker = createSemanticRefreshService({
    stateService,
    loadExecution: async (executionId) => {
      const state = (await storage.loadCollection()).semanticRedundancy;
      const execution = state.execution;
      const manifest = state.disclosureManifest;
      const authorization = state.authorization;
      if (!execution || execution.commandId !== executionId || !manifest || !authorization)
        return null;
      return {
        execution,
        manifest,
        authorizationId: authorization.id,
        deliveryComplete: state.manifestDelivery?.complete === true,
        authorizationActive: authorization.state === "active",
      };
    },
    isExecutionStartCurrentProcess: () => true,
    pairAuthority: captureService,
    generationAuthority: captureService,
    gatewayFactory: (gatewayOptions) =>
      createJevGateway({
        apiKey: "test-only-key",
        maxRequests: gatewayOptions.maxRequests,
        maxReportedTokens: gatewayOptions.maxReportedTokens,
        admitAndDispatch: gatewayOptions.admitAndDispatch,
        fetch: async (_input, init) => {
          sends += 1;
          const requestBody = typeof init?.body === "string" ? init.body : "";
          outboundPayloads.push(requestBody);
          if (harnessOptions.fetch) return harnessOptions.fetch(init?.signal ?? null);
          const isNotesRequest = requestBody.includes("notes_relevant");
          return new Response(
            JSON.stringify({
              model: JEV_MODEL_ID,
              answers: {
                description_similarity: {
                  type: "score",
                  score: 2,
                  legend: { "0": "0", "1": "1", "2": "2", "3": "3" },
                  probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
                  confidence: 0.9,
                },
                ...(isNotesRequest
                  ? {
                      notes_relevant: { type: "noul", noul: 0.9 },
                      note_similarity: {
                        type: "score",
                        score: 2,
                        legend: { "0": "0", "1": "1", "2": "2", "3": "3" },
                        probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
                        confidence: 0.9,
                      },
                    }
                  : {}),
              },
              usage: { input_tokens: 12, output_tokens: 4 },
            }),
            { status: 200 },
          );
        },
      }),
    now: () => fixedNow,
  });
  const runtime = createSemanticRefreshRuntime({
    stateService,
    captureService,
    worker,
    storageService: storage,
    now: () => fixedNow,
  });
  const routes = createRedundancyRoutes({ storageService: storage, semanticRuntime: runtime });
  const app = new Hono();
  app.route("/api", routes.routes);
  return {
    app,
    storage,
    stateService,
    runtime,
    ownerGameNoteService,
    vector,
    outboundPayloads,
    source,
    get sends() {
      return sends;
    },
  };
}

const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function publishCOnlyGeneration(h: ReturnType<typeof harness>) {
  const disclosed = await h.app.request(
    "/api/redundancy/semantic/disclosure",
    post({ signalScope: "description-only" }),
  );
  expect(disclosed.status).toBe(201);
  const manifest = (await h.storage.loadCollection()).semanticRedundancy.disclosureManifest!;
  const pageResponse = await h.app.request(
    "/api/redundancy/semantic/disclosure/page",
    post({ manifestId: manifest.id, manifestDigest: manifest.digest, offset: 0 }),
  );
  expect(pageResponse.status).toBe(200);
  const page = await responseJson(pageResponse);
  const started = await h.app.request(
    "/api/redundancy/semantic/acknowledge-and-start",
    post({
      manifestId: manifest.id,
      manifestDigest: manifest.digest,
      pairCount: arrayProperty(page, "pairs").length,
      transmissionAuthorized: true,
      noteTransmissionAuthorized: false,
      cachedOwnerNoteUseAuthorized: false,
    }),
  );
  expect(started.status).toBe(202);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await h.storage.loadCollection()).semanticRedundancy.execution?.status !== "running")
      break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return (await h.storage.loadCollection()).semanticRedundancy;
}

describe("semantic redundancy route-to-worker integration", () => {
  test("C-only disclosure, full page receipt, acknowledged start, and durable completion", async () => {
    const h = harness();
    const ordinary = await h.app.request("/api/redundancy/settings");
    expect(ordinary.status).toBe(200);
    expect(h.sends).toBe(0);

    const disclosed = await h.app.request(
      "/api/redundancy/semantic/disclosure",
      post({ signalScope: "description-only" }),
    );
    expect(disclosed.status).toBe(201);
    const disclosure = await responseJson(disclosed);
    expect(disclosure.signalScope).toBe("description-only");
    expect(disclosure.eligibleGameCount).toBe(2);
    expect(JSON.stringify(disclosure)).not.toContain("fixture description");

    const manifest = (await h.storage.loadCollection()).semanticRedundancy.disclosureManifest!;
    const pageResponse = await h.app.request(
      "/api/redundancy/semantic/disclosure/page",
      post({ manifestId: manifest.id, manifestDigest: manifest.digest, offset: 0 }),
    );
    expect(pageResponse.status).toBe(200);
    const page = await responseJson(pageResponse);
    expect(page.complete).toBe(true);
    expect(arrayProperty(page, "pairs")).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain("fixture description");
    expect(JSON.stringify(page)).not.toContain("Fingerprint");

    const acknowledgement = {
      manifestId: manifest.id,
      manifestDigest: manifest.digest,
      pairCount: arrayProperty(page, "pairs").length,
      transmissionAuthorized: true,
      noteTransmissionAuthorized: false,
      cachedOwnerNoteUseAuthorized: false,
    };
    const started = await h.app.request(
      "/api/redundancy/semantic/acknowledge-and-start",
      post(acknowledgement),
    );
    expect(started.status).toBe(202);
    expect(await responseJson(started)).toMatchObject({ status: "running" });
    const replay = await h.app.request(
      "/api/redundancy/semantic/acknowledge-and-start",
      post(acknowledgement),
    );
    expect(replay.status).toBe(200);
    expect((await responseJson(replay)).disposition).toBe("REPLAYED");

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = (await h.storage.loadCollection()).semanticRedundancy;
      if (state.execution?.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(state.execution?.status).toBe("completed");
    expect(state.authorization?.state).toBe("consumed");
    expect(state.publishedGeneration?.pairOutcomes).toHaveLength(1);
    expect(h.sends).toBe(1);
    expect(
      await responseJson(await h.app.request("/api/redundancy/semantic/summary")),
    ).toMatchObject({
      status: "ready",
    });
    expect(
      await responseJson(await h.app.request("/api/redundancy/semantic/refresh-status")),
    ).toMatchObject({
      status: "ready",
      execution: { status: "completed" },
      publicationStatus: "ready",
    });
    const sendsAfterCompletion = h.sends;
    expect(
      (
        await h.app.request("/api/redundancy/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        })
      ).status,
    ).toBe(200);
    expect(h.sends).toBe(sendsAfterCompletion);
  });

  test("authorized C+D sends note text only after exact-scope acknowledgement and replay is one-shot", async () => {
    const h = harness({ withNotes: true });
    const disclosed = await h.app.request(
      "/api/redundancy/semantic/disclosure",
      post({ signalScope: "description-and-owner-notes" }),
    );
    expect(disclosed.status).toBe(201);
    expect(await responseJson(disclosed)).toMatchObject({
      signalScope: "description-and-owner-notes",
      eligibleGameCount: 2,
    });
    const manifest = (await h.storage.loadCollection()).semanticRedundancy.disclosureManifest!;
    const pageResponse = await h.app.request(
      "/api/redundancy/semantic/disclosure/page",
      post({ manifestId: manifest.id, manifestDigest: manifest.digest, offset: 0 }),
    );
    expect(pageResponse.status).toBe(200);
    const page = await responseJson(pageResponse);
    expect(arrayProperty(page, "pairs")[0]).toMatchObject({
      hasOwnerNoteA: true,
      hasOwnerNoteB: true,
    });
    expect(JSON.stringify(page)).not.toContain("private note");

    const ack = {
      manifestId: manifest.id,
      manifestDigest: manifest.digest,
      pairCount: arrayProperty(page, "pairs").length,
      transmissionAuthorized: true,
      noteTransmissionAuthorized: true,
      cachedOwnerNoteUseAuthorized: true,
    };
    const started = await h.app.request(
      "/api/redundancy/semantic/acknowledge-and-start",
      post(ack),
    );
    expect(started.status).toBe(202);
    const replay = await h.app.request("/api/redundancy/semantic/acknowledge-and-start", post(ack));
    expect(replay.status).toBe(200);
    expect((await responseJson(replay)).disposition).toBe("REPLAYED");

    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await h.storage.loadCollection()).semanticRedundancy.execution?.status !== "running")
        break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect((await h.storage.loadCollection()).semanticRedundancy.execution?.status).toBe(
      "completed",
    );
    expect(h.outboundPayloads.length).toBeGreaterThan(0);
    const outbound = h.outboundPayloads.join("\n");
    expect(outbound).toContain("private note a");
    expect(outbound).toContain("private note b");
    expect(h.sends).toBe(h.outboundPayloads.length);
    expect(h.sends).toBeLessThanOrEqual(2);
    const payload: unknown = JSON.parse(h.outboundPayloads[0]);
    if (!isRecord(payload) || !isRecord(payload.state) || !isRecord(payload.questions)) {
      throw new Error("Expected a provider payload with state and questions objects");
    }
    expect(payload.state).toEqual({
      game_a: {
        name: "Game a",
        bgg_description: "fixture description a",
        owner_note: "private note a",
      },
      game_b: {
        name: "Game b",
        bgg_description: "fixture description b",
        owner_note: "private note b",
      },
    });
    expect(Object.keys(payload.questions).sort()).toEqual([
      "description_similarity",
      "note_similarity",
      "notes_relevant",
    ]);
  });

  test("cancellation aborts an in-flight fake transport and prevents publication", async () => {
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const h = harness({
      fetch: (signal) =>
        new Promise<Response>((_resolve, reject) => {
          markFetchStarted();
          if (signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    });
    const disclosed = await h.app.request(
      "/api/redundancy/semantic/disclosure",
      post({ signalScope: "description-only" }),
    );
    expect(disclosed.status).toBe(201);
    const manifest = (await h.storage.loadCollection()).semanticRedundancy.disclosureManifest!;
    const delivered = await h.app.request(
      "/api/redundancy/semantic/disclosure/page",
      post({ manifestId: manifest.id, manifestDigest: manifest.digest, offset: 0 }),
    );
    const page = await responseJson(delivered);
    const startResponse = await h.app.request(
      "/api/redundancy/semantic/acknowledge-and-start",
      post({
        manifestId: manifest.id,
        manifestDigest: manifest.digest,
        pairCount: arrayProperty(page, "pairs").length,
        transmissionAuthorized: true,
        noteTransmissionAuthorized: false,
        cachedOwnerNoteUseAuthorized: false,
      }),
    );
    expect(startResponse.status).toBe(202);
    await fetchStarted;

    const cancelled = await h.app.request(
      "/api/redundancy/semantic/cancel",
      post({ commandId: manifest.id }),
    );
    expect(cancelled.status).toBe(200);
    expect(await responseJson(cancelled)).toEqual({ outcome: "accepted" });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await h.storage.loadCollection()).semanticRedundancy.execution?.status !== "running")
        break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(state.execution?.status).toBe("cancelled");
    expect(state.publishedGeneration).toBeNull();
    expect(h.sends).toBe(1);
  });

  test("orphan recovery interrupts persisted work and a late response cannot publish", async () => {
    let markFetchStarted!: () => void;
    let resolveResponse!: (response: Response) => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const delayedResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const h = harness({
      fetch: async () => {
        markFetchStarted();
        return delayedResponse;
      },
    });
    const disclosed = await h.app.request(
      "/api/redundancy/semantic/disclosure",
      post({ signalScope: "description-only" }),
    );
    expect(disclosed.status).toBe(201);
    const manifest = (await h.storage.loadCollection()).semanticRedundancy.disclosureManifest!;
    const delivered = await h.app.request(
      "/api/redundancy/semantic/disclosure/page",
      post({ manifestId: manifest.id, manifestDigest: manifest.digest, offset: 0 }),
    );
    const page = await responseJson(delivered);
    const started = await h.app.request(
      "/api/redundancy/semantic/acknowledge-and-start",
      post({
        manifestId: manifest.id,
        manifestDigest: manifest.digest,
        pairCount: arrayProperty(page, "pairs").length,
        transmissionAuthorized: true,
        noteTransmissionAuthorized: false,
        cachedOwnerNoteUseAuthorized: false,
      }),
    );
    expect(started.status).toBe(202);
    await fetchStarted;
    await h.runtime.recoverOrphanedRun();
    expect((await h.storage.loadCollection()).semanticRedundancy.execution?.status).toBe(
      "interrupted",
    );

    resolveResponse(
      new Response(
        JSON.stringify({
          model: JEV_MODEL_ID,
          answers: {
            description_similarity: {
              type: "score",
              score: 2,
              legend: { "0": "0", "1": "1", "2": "2", "3": "3" },
              probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
              confidence: 0.9,
            },
          },
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
        { status: 200 },
      ),
    );
    for (let attempt = 0; attempt < 100; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    const state = (await h.storage.loadCollection()).semanticRedundancy;
    expect(state.execution?.status).toBe("interrupted");
    expect(state.publishedGeneration).toBeNull();
    expect(h.sends).toBe(1);
  });

  test("an actual owner-note edit invalidates the generation without provider work", async () => {
    const h = harness();
    const published = await publishCOnlyGeneration(h);
    expect(published.execution?.status).toBe("completed");
    expect(published.publishedGeneration).not.toBeNull();
    const sendsBeforeNoteEdit = h.sends;

    const changed = await h.ownerGameNoteService.set("a", {
      commandId: "00000000-0000-4000-8000-000000000001",
      expectedVersion: 0,
      text: "new private owner note",
    });
    expect(changed.ok).toBe(true);
    expect((await h.storage.loadCollection()).semanticRedundancy.publishedGeneration).toBeNull();
    expect(h.sends).toBe(sendsBeforeNoteEdit);
    expect(
      await responseJson(await h.app.request("/api/redundancy/semantic/summary")),
    ).toMatchObject({
      status: "not-ready",
    });
    expect(
      await responseJson(await h.app.request("/api/redundancy/semantic/refresh-status")),
    ).toMatchObject({ publicationStatus: "not-ready" });
  });

  test.each([
    ["tournament", (h: ReturnType<typeof harness>) => h.vector.publish("tournament", 2)],
    [
      "prediction settings",
      (h: ReturnType<typeof harness>) => h.vector.publish("prediction-settings", 2),
    ],
    [
      "factual weights",
      (h: ReturnType<typeof harness>) =>
        h.vector.publishRedundancyWeightsFingerprint("b".repeat(64)),
    ],
  ] as const)(
    "a %s source change reports stale publication independently of completed execution",
    async (_label, change) => {
      const h = harness();
      const published = await publishCOnlyGeneration(h);
      expect(published.execution?.status).toBe("completed");
      change(h);
      expect(
        await responseJson(await h.app.request("/api/redundancy/semantic/summary")),
      ).toMatchObject({
        status: "stale",
      });
      expect(
        await responseJson(await h.app.request("/api/redundancy/semantic/refresh-status")),
      ).toMatchObject({ publicationStatus: "stale", execution: { status: "completed" } });
    },
  );
});
