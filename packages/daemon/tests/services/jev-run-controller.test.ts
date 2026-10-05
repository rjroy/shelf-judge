import { afterEach, describe, expect, test } from "bun:test";
import {
  createInitialEntityMetadata,
  DEFAULT_JEV_RUN_BUDGET,
  type Axis,
  type Collection,
  type DurableGame,
  type WishlistEntry,
} from "@shelf-judge/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileOps } from "../../src/services/file-ops.js";
import {
  createJevPairCache,
  type JevPairCache,
  type JevPairJudgment,
} from "../../src/services/jev-pair-cache-service.js";
import { JevRunController } from "../../src/services/jev-run-controller.js";
import { createJevRunWorker } from "../../src/index.js";
import { JEV_GATEWAY_LIMITS, JEV_MODEL_ID } from "../../src/services/jev/jev-gateway.js";
import { JEV_JUDGMENT_CONTRACT } from "../../src/services/jev/jev-judgment-contract.js";
import { buildJevPairDependencies } from "../../src/services/jev-pair-identity.js";
import {
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
} from "../../src/services/jev-pair-identity.js";
import { createJevRunSourceAdapter } from "../../src/services/jev-run-source-adapter.js";
import { createWishlistRunPreparationService } from "../../src/services/wishlist-run-preparation.js";
import { validateWishlistCandidateCOnlyRow } from "../../src/services/wishlist-candidate-read-proof.js";
import { createTestApp } from "../helpers/test-app.js";

const observedAt = "2026-10-04T00:00:00.000Z";
const directories: string[] = [];
const caches: JevPairCache[] = [];
const initialApiKey = process.env.TYPESAFE_API_KEY;
afterEach(async () => {
  if (initialApiKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = initialApiKey;
  for (const cache of caches.splice(0)) cache.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function axis(): Axis {
  return {
    id: "personal",
    name: "Personal",
    description: null,
    weight: 1,
    enabled: true,
    source: "personal",
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

function game(id: string, rating: number | null, notes = false): DurableGame {
  const bggId = Number(id.replace(/\D/g, "")) || id.charCodeAt(0) + 500;
  return {
    id,
    bggId,
    entityMetadata: createInitialEntityMetadata(bggId),
    name: `Game ${id}`,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: 3,
    playingTime: 60,
    imageUrl: null,
    numPlays: null,
    latestPlayCountCheck: null,
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
    bggData: {
      communityRating: 7,
      bayesAverage: 7,
      weight: 2.5,
      numWeightVotes: 3,
      description: `Description ${id}`,
      mechanics: [{ id: 1, name: "Draft" }],
      categories: [{ id: 2, name: "Strategy" }],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: observedAt,
    },
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: rating === null ? {} : { personal: rating },
    createdAt: observedAt,
    updatedAt: observedAt,
    ownerNote: notes
      ? { state: "present", version: 1, updatedAt: observedAt, text: `Private note ${id}` }
      : { state: "cleared", version: 1, updatedAt: observedAt },
  };
}

function wishlistEntry(bggId = 501): WishlistEntry {
  return {
    id: `wishlist-${bggId}`,
    bggId,
    name: `Wishlist ${bggId}`,
    yearPublished: 2024,
    thumbnailUrl: null,
    predictedScore: 5,
    predictionConfidence: "weak",
    predictedBreakdown: [],
    nicheImpact: null,
    redundancyPreview: null,
    addedAt: observedAt,
    bggSource: {
      observedAt,
      description: `Candidate ${bggId}`,
      mechanics: ["Draft"],
      categories: ["Strategy"],
      weight: 2.5,
      communityRating: 7,
      minPlayers: 2,
      maxPlayers: 4,
      bestPlayers: 3,
      playingTime: 60,
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

async function harness(
  options: {
    ids?: string[];
    notes?: boolean;
    pending?: boolean;
    gatewayConfigured?: boolean;
    maxPairs?: number;
    receiptTtlMs?: number;
    maxReceipts?: number;
    afterValidated?: (
      armAfterAuthorityRead: (callback: () => void | Promise<void>) => void,
    ) => void | Promise<void>;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "jev-controller-"));
  directories.push(dir);
  const cache = await createJevPairCache(join(dir, "cache"));
  caches.push(cache);
  const context = createTestApp({
    dataDir: join(dir, "data"),
    configPath: join(dir, "config.json"),
    fileOps: createFileOps(),
    jevPairCache: cache,
    bggClient: { getGame: () => Promise.reject(new Error("Unexpected BGG hydration")) } as never,
  });
  const storage = context.storageService;
  const collection = await storage.loadCollection();
  collection.axes = [axis()];
  collection.games = (options.ids ?? ["a", "b"]).map((id) => game(id, 6, options.notes));
  collection.semanticRedundancy.settings = {
    ...collection.semanticRedundancy.settings,
    enabled: true,
    cachedOwnerNoteUse: options.notes ?? false,
    weights: { factual: 1, description: 1, ownerNote: options.notes ? 1 : 0 },
  };
  await storage.saveCollection(collection);
  await storage.saveRedundancySettings({
    ...(await storage.loadRedundancySettings()),
    enabled: true,
    stage: "integrated",
    similarityThreshold: 0,
    minNeighbors: 1,
    expectedNeighbors: 5,
    maxPenalty: 1,
    componentWeights: { binary: 1, continuous: 3 },
  });
  await storage.saveWishlist([wishlistEntry()]);
  await storage.hydrateSourceVector?.();
  process.env.TYPESAFE_API_KEY = "controller-test-key";
  let fakeNow = Date.now();
  let gatewayConfigured = options.gatewayConfigured ?? true;
  let gatewayCalls = 0;
  const requests: unknown[] = [];
  const forwardedBudgets: unknown[] = [];
  const started = deferred();
  let pendingProvider = options.pending ?? false;
  let release = deferred();
  const listGamesWithPredictionsFromSnapshot =
    context.predictionService.listGamesWithPredictionsFromSnapshot?.bind(context.predictionService);
  if (!listGamesWithPredictionsFromSnapshot)
    throw new Error("Test prediction service lacks snapshot prediction support");
  const sourceAdapterBase = createJevRunSourceAdapter({
    storageService: storage,
    predictionService: { listGamesWithPredictionsFromSnapshot },
  });
  let afterAuthorityRead: (() => void | Promise<void>) | undefined;
  const sourceAdapter = {
    ...sourceAdapterBase,
    readCurrent: async () => {
      const current = await sourceAdapterBase.readCurrent();
      const callback = afterAuthorityRead;
      afterAuthorityRead = undefined;
      await callback?.();
      return current;
    },
  };
  const runService = createJevRunWorker({
    storageService: storage,
    predictionService: context.predictionService,
    cache,
    fetch: async (_url, init) => {
      gatewayCalls++;
      requests.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      started.resolve();
      if (pendingProvider) await release.promise;
      return Response.json({
        model: JEV_MODEL_ID,
        answers: {
          description_similarity: {
            type: "score",
            score: 1,
            legend: { "0": "unrelated", "1": "broad", "2": "similar", "3": "very similar" },
            probabilities: { "0": 0, "1": 1, "2": 0, "3": 0 },
            confidence: 0.8,
          },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });
  if (!runService) throw new Error("Expected a cache-backed worker");
  const prepareValidated = runService.prepareValidatedPreparedRun.bind(runService);
  runService.prepareValidatedPreparedRun = async (input) => {
    forwardedBudgets.push(input.providerBudget);
    const prepared = await prepareValidated(input);
    await options.afterValidated?.((callback) => {
      afterAuthorityRead = callback;
    });
    return prepared;
  };
  if (options.maxPairs !== undefined)
    Object.defineProperty(runService, "effectiveLimits", {
      value: { ...runService.effectiveLimits, maxEligiblePairs: options.maxPairs },
    });
  const controller = new JevRunController({
    storageService: storage,
    sourceAdapter,
    cache,
    runService,
    wishlistPreparation: createWishlistRunPreparationService({
      storageService: storage,
      gameService: context.gameService,
      sourceAdapter,
      cache,
    }),
    unifiedScoringService: context.unifiedScoringService,
    now: () => new Date(fakeNow),
    gatewayConfigured: () => gatewayConfigured,
    ...(options.receiptTtlMs === undefined ? {} : { receiptTtlMs: options.receiptTtlMs }),
    ...(options.maxReceipts === undefined ? {} : { maxReceipts: options.maxReceipts }),
  });
  return {
    controller,
    cache,
    requests,
    sourceAdapter,
    storage,
    runService,
    unifiedScoringService: context.unifiedScoringService,
    started: started.promise,
    release: () => release.resolve(),
    setProviderPending: (value: boolean) => {
      pendingProvider = value;
      if (value) release = deferred();
    },
    forwardedBudgets,
    setGatewayConfigured: (value: boolean) => {
      gatewayConfigured = value;
    },
    advanceTime: (milliseconds: number) => {
      fakeNow += milliseconds;
    },
    setCollection: async (value: Awaited<ReturnType<typeof storage.loadCollection>>) => {
      await storage.saveCollection(value);
      await storage.hydrateSourceVector?.();
    },
    get gatewayCalls() {
      return gatewayCalls;
    },
  };
}

async function waitForRun(cache: JevPairCache, runId?: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const progress = cache.getRunProgress();
    if (progress && (!runId || progress.runId === runId) && progress.state !== "running") return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("JEV run did not finish within bounded event-loop turns");
}

async function waitForGatewayCalls(h: { gatewayCalls: number }, count: number): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (h.gatewayCalls >= count) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("JEV gateway call did not begin within bounded event-loop turns");
}

function collectionCOnlyJudgment(collection: Collection): JevPairJudgment {
  const [a, b] = collection.games;
  if (!a || !b || !a.bggData?.description || !b.bggData?.description)
    throw new Error("Expected persisted descriptions for the first pair");
  return {
    collectionId: collection.id,
    gameAId: a.id,
    gameBId: b.id,
    signal: "C",
    dependencyKind: "C_ONLY",
    value: 0.6,
    confidence: 1,
    ...JEV_JUDGMENT_CONTRACT,
    completedAt: observedAt,
    dependencies: buildJevPairDependencies(
      "C_ONLY",
      { gameId: a.id, name: a.name, description: a.bggData.description },
      { gameId: b.id, name: b.name, description: b.bggData.description },
    ),
  };
}

describe("JevRunController unified lifecycle", () => {
  test("previews actual durable collection facts without exposing private values and binds budget", async () => {
    const h = await harness({ ids: ["a", "b", "c"], notes: true });
    const budget = {
      maxProviderAttempts: 501,
      reportedTokenStopThreshold: 40_000,
      maxRunDurationMs: 60_000,
    };
    const preview = await h.controller.preview(budget);
    expect(preview.status).toBe(200);
    if (preview.status !== 200) throw new Error("Expected preview");
    expect(preview.body).toMatchObject({
      pairCount: 3,
      noteBearingPairCount: 3,
      signalScope: { description: true, ownerNotes: true },
    });
    expect(preview.body.limits).toMatchObject(budget);
    expect(JSON.stringify(preview.body)).not.toContain("Private note");
    expect(h.gatewayCalls).toBe(0);
    expect(
      await h.controller.start({
        requestId: preview.body.requestId,
        precondition: preview.body.precondition,
        noteTransmissionAuthorized: false,
      }),
    ).toMatchObject({ status: 200, body: { state: "started" } });
    await waitForRun(h.cache);
    expect(h.forwardedBudgets).toEqual([budget]);
    expect(h.requests.join(" ")).not.toContain("Private note");
    expect(h.runService.effectiveLimits.maxEligiblePairs).toBeGreaterThan(0);
    expect(
      (await h.controller.preview({ ...DEFAULT_JEV_RUN_BUDGET, maxProviderAttempts: 0 })).status,
    ).toBe(400);
    expect(JEV_GATEWAY_LIMITS.maxRetriesPerEvaluation).toBeGreaterThan(0);
  });

  test("over-limit start returns 409; keyless misses return 503 without consuming authorization and can retry", async () => {
    const limited = await harness({ ids: ["a", "b", "c"], maxPairs: 2 });
    const over = await limited.controller.preview();
    if (over.status !== 200) throw new Error("Expected truthful over-limit preview");
    expect(over.body.withinPairLimit).toBe(false);
    expect(
      await limited.controller.start({
        requestId: over.body.requestId,
        precondition: over.body.precondition,
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: 409, body: { error: "scope-over-limit" } });
    expect(limited.gatewayCalls).toBe(0);

    const h = await harness({ gatewayConfigured: false });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const request = {
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    };
    expect(await h.controller.start(request)).toEqual({
      status: 503,
      body: { error: "run-unavailable" },
    });
    expect(h.gatewayCalls).toBe(0);
    h.setGatewayConfigured(true);
    expect((await h.controller.start(request)).status).toBe(200);
    await waitForRun(h.cache);

    const evicted = await harness({ gatewayConfigured: false });
    const collection = await evicted.storage.loadCollection();
    const row = collectionCOnlyJudgment(collection);
    evicted.cache.upsert(row);
    const cachedPreview = await evicted.controller.preview();
    if (cachedPreview.status !== 200) throw new Error("Expected cached preview");
    expect(evicted.cache.purgePair(row.gameAId, row.gameBId, "C", "collection")).toBe(1);
    const cachedRequest = {
      requestId: cachedPreview.body.requestId,
      precondition: cachedPreview.body.precondition,
      noteTransmissionAuthorized: false,
    };
    expect(await evicted.controller.start(cachedRequest)).toEqual({
      status: 503,
      body: { error: "run-unavailable" },
    });
    expect(evicted.gatewayCalls).toBe(0);
    evicted.cache.upsert(row);
    expect((await evicted.controller.start(cachedRequest)).status).toBe(200);
    await waitForRun(evicted.cache);
    expect(evicted.gatewayCalls).toBe(0);
  });

  test("keyless readiness rescans when C_ONLY evidence appears after preview", async () => {
    const h = await harness({ gatewayConfigured: false });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const row = collectionCOnlyJudgment(await h.storage.loadCollection());
    h.cache.upsert(row);
    const response = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(response).toMatchObject({ status: 200 });
    await waitForRun(h.cache);
    expect(h.gatewayCalls).toBe(0);
  });

  test("keyless admission rescans after cache mutation during final authority read", async () => {
    let mutate = false;
    const h = await harness({
      gatewayConfigured: false,
      afterValidated: (armAfterRead) => {
        if (!mutate) return;
        mutate = false;
        armAfterRead(async () =>
          h.cache.upsert(collectionCOnlyJudgment(await h.storage.loadCollection())),
        );
      },
    });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    mutate = true;
    const response = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(response).toMatchObject({ status: 200 });
    await waitForRun(h.cache);
    expect(h.gatewayCalls).toBe(0);
  });

  test("missing description and unauthorized D-only work do not require a provider", async () => {
    const h = await harness({ gatewayConfigured: false, notes: true });
    const collection = await h.storage.loadCollection();
    const firstGame = collection.games[0];
    if (!firstGame?.bggData) throw new Error("Expected persisted source facts");
    firstGame.bggData.description = null;
    await h.setCollection(collection);
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const response = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(response).toMatchObject({ status: 200 });
    await waitForRun(h.cache);
    expect(h.gatewayCalls).toBe(0);
  });

  test("source edits and expiration after final authority await reject before provider admission", async () => {
    const changedHarness = await harness();
    const preview = await changedHarness.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const changed = await changedHarness.storage.loadCollection();
    changed.games[0].name = "Persisted concurrent change";
    await changedHarness.setCollection(changed);
    expect(
      await changedHarness.controller.start({
        requestId: preview.body.requestId,
        precondition: preview.body.precondition,
        noteTransmissionAuthorized: false,
      }),
    ).toMatchObject({ status: 412 });
    expect(changedHarness.gatewayCalls).toBe(0);

    let expireAfterPreparation = false;
    const expiring = await harness({
      afterValidated: (armAfterRead) => {
        if (!expireAfterPreparation) return;
        expireAfterPreparation = false;
        armAfterRead(() => expiring.advanceTime(120_001));
      },
    });
    const expiringPreview = await expiring.controller.preview();
    if (expiringPreview.status !== 200) throw new Error("Expected preview");
    expireAfterPreparation = true;
    expect(
      await expiring.controller.start({
        requestId: expiringPreview.body.requestId,
        precondition: expiringPreview.body.precondition,
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: 412, body: { error: "precondition-failed" } });
    expect(expiring.gatewayCalls).toBe(0);
  });

  test("unified admission source mutation fences reservation after preparation", async () => {
    let mutateAfterValidation = false;
    let mutate: () => Promise<void> = () => Promise.resolve();
    const h = await harness({ afterValidated: () => mutate() });
    mutate = async () => {
      if (!mutateAfterValidation) return;
      mutateAfterValidation = false;
      const current = await h.storage.loadCollection();
      current.games[0].name = "Changed after validated preparation";
      await h.setCollection(current);
    };
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    mutateAfterValidation = true;
    expect(
      await h.controller.start({
        requestId: preview.body.requestId,
        precondition: preview.body.precondition,
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: 412, body: { error: "precondition-failed" } });
    expect(h.gatewayCalls).toBe(0);
  });

  test("C_ONLY evidence can satisfy the real cache without provider configuration", async () => {
    const h = await harness({ gatewayConfigured: false });
    const semanticCollection = await h.storage.loadCollection();
    semanticCollection.semanticRedundancy.settings.weights.factual = 0;
    await h.setCollection(semanticCollection);
    const collection = await h.storage.loadCollection();
    const [a, b] = collection.games;
    if (!a || !b) throw new Error("Expected persisted games");
    const descriptionA = a.bggData?.description;
    const descriptionB = b.bggData?.description;
    if (!descriptionA || !descriptionB) throw new Error("Expected persisted game descriptions");
    h.cache.upsert({
      collectionId: collection.id,
      gameAId: "a",
      gameBId: "b",
      signal: "C",
      dependencyKind: "C_ONLY",
      value: 0.6,
      confidence: 1,
      ...JEV_JUDGMENT_CONTRACT,
      completedAt: observedAt,
      dependencies: buildJevPairDependencies(
        "C_ONLY",
        { gameId: a.id, name: a.name, description: descriptionA },
        { gameId: b.id, name: b.name, description: descriptionB },
      ),
    } satisfies JevPairJudgment);
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected cache preview");
    const started = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(started.status).toBe(200);
    if (started.status === 200) expect(started.body.state).toBe("started");
    await waitForRun(h.cache);
    expect(h.gatewayCalls).toBe(0);
  });

  test("duplicate starts, conflicting starts, cancellation, receipt replay and restart remain fenced", async () => {
    const h = await harness({ pending: true, receiptTtlMs: 50, maxReceipts: 2 });
    const first = await h.controller.preview();
    const second = await h.controller.preview();
    if (first.status !== 200 || second.status !== 200) throw new Error("Expected previews");
    const request = {
      requestId: first.body.requestId,
      precondition: first.body.precondition,
      noteTransmissionAuthorized: false,
    };
    const [accepted, duplicate] = await Promise.all([
      h.controller.start(request),
      h.controller.start(request),
    ]);
    expect(accepted).toEqual(duplicate);
    if (accepted.status !== 200) throw new Error("Expected accepted run");
    await h.started;
    expect(
      (await h.controller.start({ ...request, noteTransmissionAuthorized: true })).status,
    ).toBe(409);
    const conflicting = await h.controller.start({
      requestId: second.body.requestId,
      precondition: second.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(conflicting).toEqual({ status: 409, body: { error: "run-conflict" } });
    h.advanceTime(51);
    expect(await h.controller.start(request)).toEqual(accepted);
    expect(h.controller.cancel({ runId: accepted.body.runId }).status).toBe(200);
    h.release();
    await waitForRun(h.cache, accepted.body.runId);
    expect(await h.controller.start(request)).toEqual(accepted);
    const restarted = new JevRunController({
      storageService: h.storage,
      sourceAdapter: h.sourceAdapter,
      cache: h.cache,
      runService: h.runService,
      unifiedScoringService: h.unifiedScoringService,
      gatewayConfigured: () => true,
    });
    expect((await restarted.start(request)).status).toBe(412);
  });

  test("active receipts survive TTL and enforce receipt-capacity pressure", async () => {
    const h = await harness({ pending: true, receiptTtlMs: 50, maxReceipts: 1 });
    const activePreview = await h.controller.preview();
    const pressurePreview = await h.controller.preview();
    if (activePreview.status !== 200 || pressurePreview.status !== 200)
      throw new Error("Expected previews");
    const request = {
      requestId: activePreview.body.requestId,
      precondition: activePreview.body.precondition,
      noteTransmissionAuthorized: false,
    };
    const accepted = await h.controller.start(request);
    if (accepted.status !== 200) throw new Error("Expected accepted run");
    await h.started;
    h.advanceTime(51);
    expect(
      await h.controller.start({
        requestId: pressurePreview.body.requestId,
        precondition: pressurePreview.body.precondition,
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: 503, body: { error: "run-unavailable" } });
    expect(await h.controller.start(request)).toEqual(accepted);
    h.release();
    await waitForRun(h.cache, accepted.body.runId);
    expect(await h.controller.start(request)).toEqual(accepted);
  });

  test("completion from an earlier handle cannot clear the current active handle", async () => {
    const h = await harness({ pending: true });
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    const started = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    if (started.status !== 200) throw new Error("Expected run start");
    await h.started;

    type Handle = { runId: string; completion: Promise<unknown>; cancel(): void };
    const internals = h.controller as unknown as { activeHandle: Handle | null };
    const oldHandle = internals.activeHandle;
    if (!oldHandle) throw new Error("Expected active handle");
    const replacement: Handle = {
      runId: crypto.randomUUID(),
      completion: Promise.resolve(),
      cancel: () => {},
    };
    internals.activeHandle = replacement;
    h.release();
    await oldHandle.completion;
    expect(h.controller.activeRun()).toEqual({ runId: replacement.runId });
    internals.activeHandle = null;
  });

  test("cancelling an earlier run ID cannot affect a newly active run", async () => {
    const h = await harness();
    const firstPreview = await h.controller.preview();
    if (firstPreview.status !== 200) throw new Error("Expected first preview");
    const first = await h.controller.start({
      requestId: firstPreview.body.requestId,
      precondition: firstPreview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    if (first.status !== 200) throw new Error("Expected first run start");
    await waitForRun(h.cache, first.body.runId);

    const changed = await h.storage.loadCollection();
    const firstGame = changed.games[0];
    if (!firstGame) throw new Error("Expected persisted game");
    firstGame.name = "Changed source for second run";
    await h.setCollection(changed);
    h.setProviderPending(true);
    const secondPreview = await h.controller.preview();
    if (secondPreview.status !== 200) throw new Error("Expected second preview");
    const second = await h.controller.start({
      requestId: secondPreview.body.requestId,
      precondition: secondPreview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    if (second.status !== 200) throw new Error("Expected second run start");
    await waitForGatewayCalls(h, 2);
    expect(h.controller.activeRun()).toEqual({ runId: second.body.runId, scope: "collection" });
    expect(h.controller.cancel({ runId: first.body.runId })).toEqual({
      status: 409,
      body: { error: "run-conflict" },
    });
    expect(h.controller.activeRun()).toEqual({ runId: second.body.runId, scope: "collection" });
    expect(h.controller.cancel({ runId: second.body.runId }).status).toBe(200);
    h.release();
    await waitForRun(h.cache, second.body.runId);
  });

  test("invalid opaque request does not prevent the same authorized request from starting", async () => {
    const h = await harness();
    const preview = await h.controller.preview();
    if (preview.status !== 200) throw new Error("Expected preview");
    expect(
      await h.controller.start({
        requestId: preview.body.requestId,
        precondition: "not-the-preview-token",
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: 412, body: { error: "precondition-failed" } });
    expect(
      (
        await h.controller.start({
          requestId: preview.body.requestId,
          precondition: preview.body.precondition,
          noteTransmissionAuthorized: false,
        })
      ).status,
    ).toBe(200);
    await waitForRun(h.cache);
  });

  test("wishlist preview uses persisted candidate and collection pairs, never fabricated misses", async () => {
    const h = await harness();
    const preview = await h.controller.previewWishlist({ kind: "selected", bggIds: [501] });
    expect(preview.status).toBe(200);
    if (preview.status !== 200) throw new Error("Expected wishlist preview");
    expect(preview.body).toMatchObject({
      selection: { kind: "selected", bggIds: [501] },
      scope: {
        scope: "wishlist",
        selectedCandidateCount: 1,
        eligibleOwnedGameCount: 2,
        comparisonPairCount: 2,
        sendablePairCount: 2,
      },
      noteTransmissionPermitted: false,
    });
    expect(JSON.stringify(preview.body)).not.toContain("Private note");
    expect(
      (
        await h.controller.start({
          requestId: preview.body.requestId,
          precondition: preview.body.precondition,
          noteTransmissionAuthorized: false,
        })
      ).status,
    ).toBe(200);
    await waitForRun(h.cache);
    expect(h.gatewayCalls).toBe(2);
  });

  test("wishlist readiness recognizes a frozen sendable miss satisfied after preview", async () => {
    const h = await harness({ gatewayConfigured: false, ids: ["a"] });
    const preview = await h.controller.previewWishlist({ kind: "selected", bggIds: [501] });
    if (preview.status !== 200) throw new Error("Expected wishlist preview");
    const collection = await h.storage.loadCollection();
    const owned = collection.games[0];
    const entry = (await h.storage.loadWishlist())[0];
    if (!owned?.bggData?.description || !entry?.bggSource)
      throw new Error("Expected persisted wishlist and owned descriptions");
    const candidateMember = encodeWishlistBggMember(collection.id, String(entry.bggId));
    const ownedMember = encodeOwnedLocalMember(collection.id, owned.id);
    h.cache.upsert({
      pairDomain: "wishlist-candidate",
      collectionId: collection.id,
      gameAId: candidateMember,
      gameBId: ownedMember,
      signal: "C",
      dependencyKind: "C_ONLY",
      value: 0.6,
      confidence: 1,
      ...JEV_JUDGMENT_CONTRACT,
      completedAt: observedAt,
      dependencies: buildJevPairDependencies(
        "C_ONLY",
        {
          gameId: candidateMember,
          name: entry.name,
          description: entry.bggSource.description ?? undefined,
        },
        { gameId: ownedMember, name: owned.name, description: owned.bggData.description },
      ),
    } satisfies JevPairJudgment);
    expect(
      validateWishlistCandidateCOnlyRow(
        h.cache.lookup({
          gameAId: candidateMember,
          gameBId: ownedMember,
          signal: "C",
          pairDomain: "wishlist-candidate",
        }),
        collection.id,
        {
          candidate: { bggId: entry.bggId, name: entry.name, bggSource: entry.bggSource },
          ownedGame: {
            id: owned.id,
            bggId: owned.bggId,
            name: owned.name,
            description: owned.bggData.description,
          },
        },
        {
          candidateBggIds: new Set([entry.bggId]),
          eligibleOwnedIds: new Set(collection.games.map((item) => item.id)),
        },
      ).valid,
    ).toBe(true);
    const response = await h.controller.start({
      requestId: preview.body.requestId,
      precondition: preview.body.precondition,
      noteTransmissionAuthorized: false,
    });
    expect(response).toMatchObject({ status: 200 });
    await waitForRun(h.cache);
    expect(h.gatewayCalls).toBe(0);
  });
});
