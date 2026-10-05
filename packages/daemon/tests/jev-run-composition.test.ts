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
  WishlistEntry,
} from "@shelf-judge/shared";
import { createInitialSemanticRedundancyStateV10 } from "@shelf-judge/shared";
import {
  composeJevRunController,
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
import { createJevRefreshProgressService } from "../src/services/jev-refresh-progress-service.js";

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

async function waitForWishlistProgress(
  request: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<unknown> {
  for (let turn = 0; turn < 100; turn++) {
    const response = await request("/api/redundancy/semantic/refresh-progress");
    const value = (await response.json()) as unknown;
    if (!isRecord(value) || !isRecord(value.progress) || !isRecord(value.progress.value)) continue;
    if (value.progress.value.state === "completed") return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Wishlist Jev run did not finish within the bounded event-loop turns");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("Jev run production composition", () => {
  test("existing Run routes admit only the exact selected wishlist scope and expose scoped progress", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-wishlist-run-routes-"));
    const cache = await createJevPairCache(directory);
    const sources = runtimeSources();
    const storage = sources.storage as unknown as StorageService & {
      sourceVector(): SourceVector;
      loadWishlist(): Promise<WishlistEntry[]>;
      saveWishlist(entries: WishlistEntry[]): Promise<void>;
    };
    let entries: WishlistEntry[] = [501, 502].map((bggId) => ({
      id: `wishlist-${bggId}`,
      bggId,
      name: `Candidate ${bggId}`,
      yearPublished: 2020,
      thumbnailUrl: null,
      predictedScore: 7,
      predictionConfidence: null,
      predictedBreakdown: null,
      nicheImpact: null,
      redundancyPreview: null,
      addedAt: "2026-01-01T00:00:00.000Z",
      bggSource: {
        observedAt: "2026-01-01T00:00:00.000Z",
        description: `candidate description ${bggId}`,
        mechanics: [],
        categories: [],
        weight: null,
        communityRating: null,
        minPlayers: null,
        maxPlayers: null,
        bestPlayers: null,
        playingTime: null,
      },
    }));
    storage.loadWishlist = () => Promise.resolve(structuredClone(entries));
    storage.saveWishlist = (next) => {
      entries = structuredClone(next);
      return Promise.resolve();
    };
    const collection = await storage.loadCollection();
    collection.games[0].ownerNote = {
      state: "present",
      version: 1,
      updatedAt: "synthetic-note-time",
      text: "private wishlist-run note sentinel",
    };
    storage.loadCollection = () => Promise.resolve(structuredClone(collection));
    const currentVector = storage.sourceVector();
    storage.sourceVector = () => structuredClone(currentVector);
    const redundancySettings: RedundancySettings = {
      enabled: true,
      stage: "integrated",
      similarityThreshold: 0.7,
      maxPenalty: 0.2,
      componentWeights: { binary: 0, continuous: 0 },
      minNeighbors: 1,
      expectedNeighbors: 5,
    };
    storage.loadRedundancySettings = () => Promise.resolve(redundancySettings);
    let hydrationCalls = 0;
    let transportCalls = 0;
    let lastBody = "";
    const firstTransport = deferred<Response>();
    process.env.TYPESAFE_API_KEY = "integration-fake-key";
    try {
      const worker = createJevRunWorker({
        storageService: storage,
        predictionService: sources.predictionService,
        cache,
        fetch: (_url, init) => {
          transportCalls++;
          lastBody = typeof init?.body === "string" ? init.body : "";
          if (transportCalls === 1) return firstTransport.promise;
          return Promise.resolve(gatewayResponse());
        },
      });
      const controller = composeJevRunController({
        storageService: storage,
        predictionService: sources.predictionService,
        gameService: {
          getBoardgameScoringInput: () => {
            hydrationCalls++;
            return Promise.reject(new Error("Established source must not hydrate"));
          },
        } as never,
        cache,
        runService: worker,
      });
      if (!controller) throw new Error("Expected composed run controller");
      const progressService = createJevRefreshProgressService({
        cache,
        activeRun: () => controller.activeRun(),
      });
      const { routes } = createRedundancyRoutes({
        storageService: storage,
        jevRunController: controller,
        jevRefreshProgressService: progressService,
      });
      const app = new Hono();
      app.route("/api", routes);
      const request = async (path: string, init?: RequestInit): Promise<Response> =>
        await app.fetch(new Request(`http://daemon.test${path}`, init));

      const preview = await request(
        "/api/redundancy/semantic/run-preview?scope=wishlist&bggId=502",
      );
      expect(preview.status).toBe(200);
      const disclosure = (await preview.json()) as {
        requestId: string;
        precondition: string;
        selection: { kind: string; bggIds?: number[] };
        scope: {
          scope: string;
          wishlistEntryCount: number;
          selectedCandidateCount: number;
          unselectedEntryCount: number;
          comparisonPairCount: number;
          sendablePairCount: number;
        };
      };
      expect(disclosure.selection).toEqual({ kind: "selected", bggIds: [502] });
      expect(disclosure.scope).toMatchObject({
        scope: "wishlist",
        wishlistEntryCount: 2,
        selectedCandidateCount: 1,
        unselectedEntryCount: 1,
        comparisonPairCount: 2,
        sendablePairCount: 2,
      });
      expect(disclosure).not.toHaveProperty("bggSource");
      expect(JSON.stringify(disclosure)).not.toContain("candidate description");
      expect(hydrationCalls).toBe(0);
      expect(transportCalls).toBe(0);

      const forbiddenNoteAuthorization = await request(
        "/api/redundancy/semantic/run",
        json({
          requestId: disclosure.requestId,
          precondition: disclosure.precondition,
          noteTransmissionAuthorized: true,
        }),
      );
      expect(forbiddenNoteAuthorization.status).toBe(412);
      expect(transportCalls).toBe(0);
      const start = await request(
        "/api/redundancy/semantic/run",
        json({
          requestId: disclosure.requestId,
          precondition: disclosure.precondition,
          noteTransmissionAuthorized: false,
        }),
      );
      expect(start.status).toBe(202);
      const started = (await start.json()) as { runId: string };
      const liveProgress = await request("/api/redundancy/semantic/refresh-progress");
      expect(await liveProgress.json()).toMatchObject({
        activity: { state: "active", runId: started.runId, scope: "wishlist" },
      });
      firstTransport.resolve(gatewayResponse());
      const progress = await waitForWishlistProgress(request);
      expect(progress).toMatchObject({
        progress: {
          state: "saved",
          value: { state: "completed", scope: "wishlist", pairCount: 2, completedPairs: 2 },
        },
      });
      expect(transportCalls).toBe(2);
      expect(lastBody).not.toContain("owner_note");
      expect(lastBody).not.toContain("private wishlist-run note sentinel");
      expect(hydrationCalls).toBe(0);
      expect(cache.getRunProgress()?.scope).toBe("wishlist");
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
      if (originalApiKey === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = originalApiKey;
    }
  });

  test("real Run HTTP boundary keeps reads provider-free and fences explicit note-authorized work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-run-routes-integration-"));
    const cache = await createJevPairCache(directory);
    const sources = runtimeSources();
    const storage = sources.storage as unknown as {
      loadCollection(): Promise<Collection>;
      loadRedundancySettings(): Promise<RedundancySettings>;
      sourceVector(): SourceVector;
    };
    let collection = await storage.loadCollection();
    for (const game of collection.games) {
      game.ownerNote = {
        state: "present",
        version: 1,
        updatedAt: "synthetic-fixture",
        text: `synthetic-private-note-${game.id}`,
      };
    }
    collection.semanticRedundancy.settings.weights.ownerNote = 1;
    collection.semanticRedundancy.settings.cachedOwnerNoteUse = true;
    let vector = storage.sourceVector();
    storage.loadCollection = () => Promise.resolve(structuredClone(collection));
    storage.loadRedundancySettings = () =>
      Promise.resolve({
        enabled: true,
        stage: "integrated",
        similarityThreshold: 0.7,
        maxPenalty: 0.2,
        componentWeights: { binary: 0, continuous: 0 },
        minNeighbors: 1,
        expectedNeighbors: 5,
      });
    storage.sourceVector = () => structuredClone(vector);
    const mutateCollection = (mutation: (next: Collection) => void) => {
      collection = structuredClone(collection);
      mutation(collection);
      collection.revision++;
      vector = {
        ...vector,
        collectionRevision: collection.revision,
        semanticConsentEpoch: collection.semanticRedundancy.consentEpoch,
        semanticEvidenceEpoch: collection.semanticRedundancy.evidenceEpoch,
      };
    };

    process.env.TYPESAFE_API_KEY = "integration-fake-key";
    let transportCalls = 0;
    let lastTransportBody = "";
    const transportStarted = deferred<void>();
    const releaseTransport = deferred<Response>();
    try {
      const worker = createJevRunWorker({
        storageService: sources.storage,
        predictionService: sources.predictionService,
        cache,
        fetch: async (_url, init) => {
          await Promise.resolve();
          transportCalls++;
          lastTransportBody = typeof init?.body === "string" ? init.body : "";
          transportStarted.resolve();
          return releaseTransport.promise;
        },
      });
      const controller = composeJevRunController({
        storageService: sources.storage,
        predictionService: sources.predictionService,
        cache,
        runService: worker,
      });
      const statusService = composeJevStatusService({
        storageService: sources.storage,
        predictionService: sources.predictionService,
        cache,
      });
      expect(worker).not.toBeNull();
      expect(controller).not.toBeNull();
      expect(statusService).not.toBeNull();
      const { routes } = createRedundancyRoutes({
        storageService: sources.storage,
        jevStatusService: statusService!,
        jevRunController: controller!,
        jevRefreshProgressService: createJevRefreshProgressService({
          cache,
          activeRun: () => controller!.activeRun(),
        }),
      });
      const app = new Hono();
      app.route("/api", routes);
      const request = (path: string, init?: RequestInit) =>
        app.fetch(new Request(`http://daemon.test${path}`, init));

      await recoverJevRunOnStartup(worker);
      expect((await request("/api/redundancy/settings")).status).toBe(200);
      expect((await request("/api/redundancy/semantic/refresh-status")).status).toBe(200);
      expect(await (await request("/api/redundancy/semantic/active-run")).json()).toBeNull();
      expect(transportCalls).toBe(0);

      const invalidPreview = await request("/api/redundancy/semantic/run-preview");
      expect(invalidPreview.status).toBe(200);
      expect(invalidPreview.headers.get("Cache-Control")).toBe("no-store");
      expect(transportCalls).toBe(0);
      const invalidDisclosure = (await invalidPreview.json()) as {
        requestId: string;
        precondition: string;
      };
      const invalid = await request(
        "/api/redundancy/semantic/run",
        json({
          requestId: invalidDisclosure.requestId,
          precondition: "invalid-precondition",
          noteTransmissionAuthorized: true,
        }),
      );
      expect(invalid.status).toBe(412);
      expect(transportCalls).toBe(0);

      const controllerInternals = controller as unknown as {
        options: { now?: () => Date; preconditionTtlMs?: number };
      };
      let fakeNow = Date.now();
      controllerInternals.options.now = () => new Date(fakeNow);
      controllerInternals.options.preconditionTtlMs = 5;
      const expiredPreview = await request("/api/redundancy/semantic/run-preview");
      expect(expiredPreview.status).toBe(200);
      const expiredBody = (await expiredPreview.json()) as {
        requestId: string;
        precondition: string;
      };
      fakeNow += 6;
      const expired = await request(
        "/api/redundancy/semantic/run",
        json({
          requestId: expiredBody.requestId,
          precondition: expiredBody.precondition,
          noteTransmissionAuthorized: true,
        }),
      );
      expect(expired.status).toBe(412);
      expect(transportCalls).toBe(0);
      controllerInternals.options.preconditionTtlMs = 120_000;

      for (const mutation of ["note", "consent"] as const) {
        const preview = await request("/api/redundancy/semantic/run-preview");
        const body = (await preview.json()) as { requestId: string; precondition: string };
        mutateCollection((next) => {
          if (mutation === "note") {
            next.games[0].ownerNote = {
              state: "present",
              version: 2,
              updatedAt: "changed-synthetic-fixture",
              text: "changed-synthetic-private-note",
            };
          } else {
            next.semanticRedundancy.consentEpoch++;
            next.semanticRedundancy.settings.cachedOwnerNoteUse = false;
          }
        });
        const stale = await request(
          "/api/redundancy/semantic/run",
          json({
            requestId: body.requestId,
            precondition: body.precondition,
            noteTransmissionAuthorized: true,
          }),
        );
        expect(stale.status).toBe(412);
        expect(transportCalls).toBe(0);
      }

      mutateCollection((next) => {
        next.semanticRedundancy.settings.cachedOwnerNoteUse = true;
      });
      const validPreview = await request("/api/redundancy/semantic/run-preview");
      const validDisclosure = (await validPreview.json()) as {
        requestId: string;
        precondition: string;
        noteBearingPairCount: number;
      };
      expect(validDisclosure.noteBearingPairCount).toBe(1);
      const startRequest = {
        requestId: validDisclosure.requestId,
        precondition: validDisclosure.precondition,
        noteTransmissionAuthorized: false,
      };
      const start = await request("/api/redundancy/semantic/run", json(startRequest));
      expect(start.status).toBe(202);
      expect(start.headers.get("Cache-Control")).toBe("no-store");
      const run = (await start.json()) as { runId: string; state: string };
      await transportStarted.promise;
      expect(transportCalls).toBe(1);
      expect(lastTransportBody).not.toContain("synthetic-private-note");
      expect(lastTransportBody).not.toContain("owner_note");

      const duplicate = await request("/api/redundancy/semantic/run", json(startRequest));
      expect(duplicate.status).toBe(202);
      expect(await duplicate.json()).toEqual(run);
      expect(transportCalls).toBe(1);
      expect(await (await request("/api/redundancy/semantic/active-run")).json()).toEqual({
        runId: run.runId,
        scope: "collection",
      });
      expect(
        await (await request("/api/redundancy/semantic/refresh-progress")).json(),
      ).toMatchObject({ activity: { state: "active", runId: run.runId, scope: "collection" } });
      expect(transportCalls).toBe(1);

      const canceled = await request("/api/redundancy/semantic/cancel", json({ runId: run.runId }));
      expect(canceled.status).toBe(202);
      expect(await canceled.json()).toEqual({ state: "cancellation-requested" });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await (await request("/api/redundancy/semantic/active-run")).json()) {
          await Promise.resolve();
        } else break;
      }
      releaseTransport.resolve(gatewayResponse());
      await Promise.resolve();
      expect(transportCalls).toBe(1);
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
      expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "D" })).toBeNull();
      expect(cache.getRunProgress()?.state).toBe("interrupted");
      expect(cache.getRunProgress()?.scope).toBe("collection");
      expect(transportCalls).toBe(1);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("composes an internal controller from the lifecycle worker/cache without preview transport", async () => {
    const originalApiKey = process.env.TYPESAFE_API_KEY;
    let directory: string | null = null;
    let cache: JevPairCache | null = null;
    let transportCalls = 0;
    try {
      delete process.env.TYPESAFE_API_KEY;
      directory = await mkdtemp(join(tmpdir(), "jev-run-controller-composition-"));
      cache = await createJevPairCache(directory);
      const sources = runtimeSources();
      sources.storage.loadRedundancySettings = () =>
        Promise.resolve({
          enabled: true,
          stage: "integrated",
          similarityThreshold: 0.7,
          maxPenalty: 0.2,
          componentWeights: { binary: 0, continuous: 0 },
          minNeighbors: 1,
          expectedNeighbors: 5,
        });
      const worker = createJevRunWorker({
        storageService: sources.storage,
        predictionService: sources.predictionService,
        cache,
        fetch: async () => {
          await Promise.resolve();
          transportCalls++;
          return gatewayResponse();
        },
      });
      const controller = composeJevRunController({
        storageService: sources.storage,
        predictionService: sources.predictionService,
        cache,
        runService: worker,
      });
      expect(worker).not.toBeNull();
      expect(controller).not.toBeNull();
      expect(
        composeJevRunController({
          storageService: sources.storage,
          predictionService: sources.predictionService,
          cache: { available: false } as JevPairCache,
          runService: worker,
        }),
      ).toBeNull();
      const preview = await controller!.preview();
      expect(preview.status).toBe(200);
      if (preview.status !== 200) throw new Error("Expected provider-free Run preview");
      expect(preview.body.providerConfigured).toBe(false);
      expect(preview.body.pairCount).toBe(1);
      expect(transportCalls).toBe(0);

      process.env.TYPESAFE_API_KEY = "composition-test-key";
      const configuredPreview = await controller!.preview();
      expect(configuredPreview.status).toBe(200);
      if (configuredPreview.status !== 200)
        throw new Error("Expected provider-free configured Run preview");
      expect(configuredPreview.body.providerConfigured).toBe(true);
      expect(transportCalls).toBe(0);
    } finally {
      if (originalApiKey === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = originalApiKey;
      cache?.close();
      if (directory !== null) await rm(directory, { recursive: true, force: true });
    }
  });

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
