import { afterEach, describe, expect, test } from "bun:test";
import {
  createInitialEntityMetadata,
  type Axis,
  type Collection,
  type FitnessResult,
  type Game,
} from "@shelf-judge/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJevRunWorker, composeJevRunController } from "../src/index.js";
import type { PredictionService, PredictedGameResult } from "../src/services/prediction-service.js";
import type { GameService } from "../src/services/game-service.js";
import { createFileOps } from "../src/services/file-ops.js";
import { createJevPairCache } from "../src/services/jev-pair-cache-service.js";
import { createWishlistService } from "../src/services/wishlist-service.js";
import { createStorageService } from "../src/services/storage-service.js";
import { createJevRunSourceAdapter } from "../src/services/jev-run-source-adapter.js";
import { parseBoardgameScoringThings } from "../src/services/bgg-xml-parser.js";
import { createJevPairReadService } from "../src/services/jev-pair-read-service.js";
import { createUnifiedScoringService } from "../src/services/unified-scoring-service.js";
import { createFitnessService } from "../src/services/fitness-service.js";
import { encodeWishlistBggMember } from "../src/services/jev-pair-identity.js";
import { JEV_MODEL_ID } from "../src/services/jev/jev-gateway.js";
import type { StorageService } from "../src/services/storage-service.js";

const priorApiKey = process.env.TYPESAFE_API_KEY;
afterEach(() => {
  if (priorApiKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = priorApiKey;
});

const observedAt = "2026-09-30T12:00:00.000Z";
const ownerNoteSentinel = "phase7-private-owner-note-sentinel";

function personalAxis(): Axis {
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

/** In-process stand-in for one verified BGG Thing response; no network is opened. */
function fakeBggThingTransport(bggId: number, name: string, description: string): string {
  return `<items><item type="boardgame" id="${bggId}"><name type="primary" value="${name}"/><yearpublished value="2020"/><description>${description}</description><minplayers value="2"/><maxplayers value="4"/><playingtime value="60"/></item></items>`;
}

function makeGame(bggId: number, name: string, description: string): Game {
  return {
    id: `local-${bggId}`,
    bggId,
    entityMetadata: createInitialEntityMetadata(bggId),
    name,
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
      communityRating: 7.5,
      bayesAverage: 7.2,
      weight: 3,
      numWeightVotes: 100,
      description,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: observedAt,
    },
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

function durable(game: Game): Collection["games"][number] {
  return {
    ...game,
    ownerNote: {
      state: "present",
      version: 1,
      updatedAt: observedAt,
      text: ownerNoteSentinel,
    },
  };
}

function validScore(score: number): FitnessResult {
  return {
    score,
    ratedAxisCount: 1,
    totalAxisCount: 1,
    breakdown: [],
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: {
      readinessStage: 2,
      confidence: "strong",
      predictedAxisCount: 1,
      actualAxisCount: 1,
      referenceGameCount: 3,
      coveragePercent: 1,
    },
    redundancyAdjustment: null,
  };
}

function scoringInput(bggId: number, name: string, description: string) {
  const parsed = parseBoardgameScoringThings(
    fakeBggThingTransport(bggId, name, description),
    observedAt,
  )[0];
  if (!parsed) throw new Error("fixture did not parse as a verified BGG Thing");
  return { ...parsed, observedAt };
}

function gatewayResponse(): Response {
  const legend = [
    "Unrelated premises and activities.",
    "A broad shared theme, otherwise different.",
    "Substantially similar, with meaningful differences.",
    "Very similar, with minor differences.",
  ];
  return Response.json({
    model: JEV_MODEL_ID,
    answers: {
      description_similarity: {
        type: "score",
        score: 2,
        legend: Object.fromEntries(legend.map((line, index) => [String(index), line])),
        probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
        confidence: 0.75,
      },
    },
    usage: { input_tokens: 12, output_tokens: 4 },
  });
}

async function waitForRun(cache: Awaited<ReturnType<typeof createJevPairCache>>, runId: string) {
  for (let turn = 0; turn < 100; turn++) {
    const progress = cache.getRunProgress();
    if (
      progress?.runId === runId &&
      (progress.state === "completed" || progress.state === "failed") &&
      progress.publication?.state !== "pending"
    )
      return progress;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("bounded Jev run did not finish");
}

function fakePredictionService(
  storage: StorageService,
  failBggIds = new Set<number>(),
  descriptions = new Map<number, string>(),
) {
  let bggObservations = 0;
  const predictions: PredictionService = {
    predictBggGame(bggId): Promise<PredictedGameResult> {
      bggObservations++;
      if (failBggIds.has(bggId)) return Promise.reject(new Error("injected BGG Thing outage"));
      const thing = scoringInput(
        bggId,
        `Candidate ${bggId}`,
        descriptions.get(bggId) ?? `Candidate description ${bggId}`,
      );
      const primaryName = thing.primaryName;
      if (!primaryName) throw new Error("verified Thing fixture requires a primary name");
      const game = makeGame(bggId, primaryName, thing.description ?? "");
      return Promise.resolve({
        game,
        score: validScore(7),
        predictionUnavailable: null,
        verifiedScoringInput: thing,
        bggVerification: { status: "verified" },
      });
    },
    async listGamesWithPredictions() {
      const collection = await storage.loadCollection();
      return collection.games.map((game) => ({ game, score: validScore(6) }));
    },
    listGamesWithPredictionsFromSnapshot(collection) {
      return Promise.resolve(collection.games.map((game) => ({ game, score: validScore(6) })));
    },
    predictGame() {
      return Promise.reject(new Error("unused in this integration"));
    },
    getReadiness() {
      return Promise.reject(new Error("unused in this integration"));
    },
    getSettings() {
      return Promise.reject(new Error("unused in this integration"));
    },
    updateSettings() {
      return Promise.reject(new Error("unused in this integration"));
    },
  };
  return { predictions, getBggObservationCount: () => bggObservations };
}

async function loadCapture(storage: StorageService, prediction: PredictionService) {
  const snapshotPrediction = prediction.listGamesWithPredictionsFromSnapshot?.bind(prediction);
  if (!snapshotPrediction) throw new Error("fixture requires complete snapshot prediction");
  return createJevRunSourceAdapter({
    storageService: storage,
    predictionService: {
      listGamesWithPredictionsFromSnapshot: (collection, tournament, settings, targetGameIds) =>
        snapshotPrediction(collection, tournament, settings, targetGameIds),
    },
  }).loadCapture();
}

describe("wishlist Jev phase 7 durable integration", () => {
  test("persists verified source, runs only disclosed C misses, reuses after restart, and transfers on acquisition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-jev-phase7-durable-"));
    let cache = await createJevPairCache(directory);
    const fileOps = createFileOps();
    const oldKey = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = "phase7-fake-key";
    let providerRequests = 0;
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let storage = createStorageService({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps,
    });
    try {
      const owned = makeGame(9200, "Owned comparison", "Owned description");
      owned.ratings = { personal: 6 };
      const collection = await storage.loadCollection();
      collection.axes = [personalAxis()];
      collection.games = [durable(owned)];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: {
          ...collection.semanticRedundancy.settings.weights,
          factual: 1,
          description: 1,
          ownerNote: 1,
        },
      };
      await storage.saveCollection(collection);
      const redundancy = await storage.loadRedundancySettings();
      await storage.saveRedundancySettings({
        ...redundancy,
        enabled: true,
        stage: "integrated",
      });
      if (!storage.hydrateSourceVector)
        throw new Error("storage source vector hydration unavailable");
      await storage.hydrateSourceVector();

      const prediction = fakePredictionService(storage);
      const gameService = {
        async addGame(input: { bggId?: number | null; name?: string | null }) {
          const bggId = input.bggId;
          if (bggId === null || bggId === undefined) throw new Error("expected BGG acquisition");
          const entry = (await storage.loadWishlist()).find((item) => item.bggId === bggId);
          if (!entry?.bggSource) throw new Error("expected persisted candidate source");
          const acquired = makeGame(bggId, entry.name, entry.bggSource.description ?? "");
          acquired.id = `acquired-${bggId}`;
          const current = await storage.loadCollection();
          await storage.saveCollection({
            ...current,
            games: [...current.games, durable(acquired)],
          });
          return { game: acquired, bggImported: false };
        },
        getBoardgameScoringInput() {
          return Promise.reject(new Error("established source must not hydrate"));
        },
      } as unknown as GameService;
      const wishlist = createWishlistService({
        storageService: storage,
        predictionService: prediction.predictions,
        gameService,
        jevPairCache: cache,
      });

      const first = await wishlist.add(9301);
      const second = await wishlist.add(9302);
      expect((await storage.loadWishlist())[0]?.bggSource?.description).toBe(
        "Candidate description 9301",
      );
      expect((await storage.loadWishlist())[1]?.bggSource?.description).toBe(
        "Candidate description 9302",
      );
      expect(await storage.loadWishlist()).toHaveLength(2);
      expect(prediction.getBggObservationCount()).toBe(2);

      const worker = createJevRunWorker({
        storageService: storage,
        predictionService: prediction.predictions,
        cache,
        fetch: async (_input, init) => {
          providerRequests++;
          activeRequests++;
          maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
          const body = typeof init?.body === "string" ? init.body : "";
          expect(body).toContain("Candidate description");
          expect(body).toContain("Owned description");
          expect(body).not.toContain(ownerNoteSentinel);
          expect(body).not.toContain("owner_note");
          await Promise.resolve();
          activeRequests--;
          return gatewayResponse();
        },
      });
      const controller = composeJevRunController({
        storageService: storage,
        predictionService: prediction.predictions,
        unifiedScoringService: createUnifiedScoringService({
          storageService: storage,
          cache,
          fitnessService: createFitnessService(),
        }),
        gameService,
        cache,
        runService: worker,
      });
      if (!controller) throw new Error("expected composed run controller");
      const preview = await controller.previewWishlist();
      if (preview.status !== 200)
        throw new Error(`initial preview failed: ${JSON.stringify(preview)}`);
      expect(preview.status).toBe(200);
      if (preview.status !== 200 || !("scope" in preview.body))
        throw new Error("expected wishlist disclosure");
      expect(preview.body.scope).toMatchObject({
        scope: "wishlist",
        selectedCandidateCount: 2,
        eligibleOwnedGameCount: 1,
        comparisonPairCount: 2,
        cachedHitPairCount: 0,
        sendablePairCount: 2,
      });
      expect(preview.body.noteTransmissionPermitted).toBe(false);
      expect(preview.body.noteBearingPairCount).toBe(0);
      const started = await controller.start({
        requestId: preview.body.requestId,
        precondition: preview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      expect(started.status).toBe(200);
      if (started.status !== 200) throw new Error("initial run did not start");
      expect(await waitForRun(cache, started.body.runId)).toMatchObject({
        state: "completed",
        scope: "wishlist",
        pairCount: 2,
        completedPairs: 2,
        cacheHits: 0,
        cacheMisses: 2,
        failedPairs: 0,
      });
      expect(providerRequests).toBe(2);
      expect(maxActiveRequests).toBe(1);

      const current = await wishlist.listWithCurrentRedundancy();
      expect(current).toHaveLength(2);
      expect(current.every((item) => item.prediction.source === "current")).toBe(true);
      expect(current.every((item) => item.redundancy.source !== ("saved-factual" as string))).toBe(
        true,
      );
      expect(current.every((item) => item.entry.predictedScore === null)).toBe(true);
      expect(current.every((item) => item.prediction.availability === "unavailable")).toBe(true);
      // Reopen both durable services. Read and all-hit execution must stay offline.
      cache.close();
      cache = await createJevPairCache(directory);
      storage = createStorageService({
        dataDir: directory,
        configPath: join(directory, "config.json"),
        fileOps,
      });
      if (!storage.hydrateSourceVector)
        throw new Error("reopened source vector hydration unavailable");
      await storage.hydrateSourceVector();
      const restartedPrediction = fakePredictionService(storage);
      const restartedWishlist = createWishlistService({
        storageService: storage,
        predictionService: restartedPrediction.predictions,
        gameService,
        jevPairCache: cache,
      });
      const offlineRead = await restartedWishlist.listWithCurrentRedundancy();
      expect(offlineRead).toHaveLength(2);
      expect(restartedPrediction.getBggObservationCount()).toBe(0);
      const restartedWorker = createJevRunWorker({
        storageService: storage,
        predictionService: restartedPrediction.predictions,
        cache,
        fetch: () => {
          providerRequests++;
          return Promise.resolve(gatewayResponse());
        },
      });
      const restartedController = composeJevRunController({
        storageService: storage,
        predictionService: restartedPrediction.predictions,
        unifiedScoringService: createUnifiedScoringService({
          storageService: storage,
          cache,
          fitnessService: createFitnessService(),
        }),
        gameService,
        cache,
        runService: restartedWorker,
      });
      if (!restartedController) throw new Error("expected restarted controller");
      const restartedPreview = await restartedController.previewWishlist();
      expect(restartedPreview.status).toBe(200);
      if (restartedPreview.status !== 200 || !("scope" in restartedPreview.body))
        throw new Error("expected restarted wishlist disclosure");
      expect(restartedPreview.body.scope).toMatchObject({
        cachedHitPairCount: 2,
        sendablePairCount: 0,
      });
      const restartedStart = await restartedController.start({
        requestId: restartedPreview.body.requestId,
        precondition: restartedPreview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      expect(restartedStart).toMatchObject({ status: 200 });
      if (restartedStart.status !== 200) throw new Error("restarted run did not start");
      expect(await waitForRun(cache, restartedStart.body.runId)).toMatchObject({
        state: "completed",
        scope: "wishlist",
        pairCount: 2,
        completedPairs: 2,
        cacheHits: 2,
        cacheMisses: 0,
        failedPairs: 0,
      });
      expect(providerRequests).toBe(2);
      expect(restartedPrediction.getBggObservationCount()).toBe(0);

      const acquired = await restartedWishlist.acquireGame({
        bggId: first.bggId,
        name: first.name,
      });
      expect(acquired.game.id).toBe(`acquired-${first.bggId}`);
      expect((await storage.loadWishlist()).map((entry) => entry.bggId)).toEqual([second.bggId]);
      const candidateMember = encodeWishlistBggMember(collection.id, String(first.bggId));
      expect(cache.candidateCOnlyPairs(candidateMember)).toHaveLength(0);
      const ownedPair = cache.lookup({
        gameAId: acquired.game.id,
        gameBId: owned.id,
        signal: "C",
      });
      expect(ownedPair).toMatchObject({ value: 2 / 3 });
      const ownedCapture = await loadCapture(storage, restartedPrediction.predictions);
      const proofRead = createJevPairReadService(cache).resolveWithProof({
        collection: ownedCapture.collection,
        predictionCapture: ownedCapture.predictionCapture,
        factualWeights: ownedCapture.factualWeights,
        captureIdentity: ownedCapture.captureIdentity,
      });
      expect(proofRead.result.status).not.toBe("not-ready");
      if (!("table" in proofRead.result) || !proofRead.result.table)
        throw new Error("transferred owned proof table unavailable");
      expect(
        proofRead.result.table.pairs.find(
          (pair) => pair.gameAId === acquired.game.id && pair.gameBId === owned.id,
        )?.ownerNote,
      ).toBeNull();
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
      if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = oldKey;
    }
  });

  test("refresh failure preserves saved data, changed source falls back, and removal fences blocked provider completion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wishlist-jev-phase7-fences-"));
    const cache = await createJevPairCache(directory);
    const fileOps = createFileOps();
    const oldKey = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = "phase7-fake-key";
    const storage = createStorageService({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps,
    });
    const failBggIds = new Set<number>();
    const descriptions = new Map<number, string>();
    let providerGate: Promise<void> | null = null;
    let releaseProvider!: () => void;
    let providerStarted!: () => void;
    let waitingForProvider = false;
    try {
      const owned = makeGame(9201, "Owned fence comparator", "Owned fence description");
      owned.ratings = { personal: 6 };
      const collection = await storage.loadCollection();
      collection.axes = [personalAxis()];
      collection.games = [durable(owned)];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: {
          ...collection.semanticRedundancy.settings.weights,
          factual: 1,
          description: 1,
          ownerNote: 1,
        },
      };
      await storage.saveCollection(collection);
      const redundancy = await storage.loadRedundancySettings();
      await storage.saveRedundancySettings({ ...redundancy, enabled: true, stage: "integrated" });
      if (!storage.hydrateSourceVector)
        throw new Error("storage source vector hydration unavailable");
      await storage.hydrateSourceVector();

      const prediction = fakePredictionService(storage, failBggIds, descriptions);
      const gameService = {
        addGame() {
          return Promise.reject(new Error("acquisition is not part of this race fixture"));
        },
        getBoardgameScoringInput() {
          return Promise.reject(
            new Error("persisted source must not hydrate during currentness checks"),
          );
        },
      } as unknown as GameService;
      const wishlist = createWishlistService({
        storageService: storage,
        predictionService: prediction.predictions,
        gameService,
        jevPairCache: cache,
      });
      const refreshedEntry = await wishlist.add(9401);
      const fetch = () => Promise.resolve(gatewayResponse());
      const worker = createJevRunWorker({
        storageService: storage,
        predictionService: prediction.predictions,
        cache,
        fetch,
      });
      const controller = composeJevRunController({
        storageService: storage,
        predictionService: prediction.predictions,
        unifiedScoringService: createUnifiedScoringService({
          storageService: storage,
          cache,
          fitnessService: createFitnessService(),
        }),
        gameService,
        cache,
        runService: worker,
      });
      if (!controller) throw new Error("expected composed run controller");
      const preview = await controller.previewWishlist();
      if (preview.status !== 200 || !("scope" in preview.body))
        throw new Error("expected initial wishlist disclosure");
      const start = await controller.start({
        requestId: preview.body.requestId,
        precondition: preview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      if (start.status !== 200) throw new Error("initial provider comparison did not start");
      expect((await waitForRun(cache, start.body.runId))?.state).toBe("completed");
      expect(
        cache.candidateCOnlyPairs(encodeWishlistBggMember(collection.id, "9401")),
      ).toHaveLength(1);

      descriptions.set(9401, "Changed verified candidate description");
      const changed = await wishlist.refresh(refreshedEntry.id);
      expect((await storage.loadWishlist())[0]?.bggSource?.description).toBe(
        "Changed verified candidate description",
      );
      const afterChange = await wishlist.listWithCurrentRedundancy();
      expect(afterChange[0]?.prediction.source).toBe("current");
      expect(afterChange[0]?.redundancy.source).not.toBe("saved-factual");
      const factualOnlyWishlist = createWishlistService({
        storageService: storage,
        predictionService: prediction.predictions,
        gameService,
      });
      const factualOnly = await factualOnlyWishlist.listWithCurrentRedundancy();
      expect(afterChange[0]?.redundancy.adjustment).toEqual(factualOnly[0]?.redundancy.adjustment);

      failBggIds.add(9401);
      let refreshError: unknown;
      try {
        await wishlist.refresh(refreshedEntry.id);
      } catch (error) {
        refreshError = error;
      }
      expect(refreshError).toBeInstanceOf(Error);
      expect((refreshError as Error).message).toContain("injected BGG Thing outage");
      const afterFailedRefresh = (await storage.loadWishlist())[0];
      expect(afterFailedRefresh?.bggSource?.description).toBe(
        "Changed verified candidate description",
      );
      expect(afterFailedRefresh?.predictedScore).toBe(7);
      expect(changed.predictedScore).toBeNull();

      // A separate selected candidate makes the blocked completion's membership unambiguous.
      failBggIds.delete(9401);
      const removedEntry = await wishlist.add(9402);
      let markStarted!: () => void;
      let release!: () => void;
      const startedProvider = new Promise<void>((resolve) => (markStarted = resolve));
      providerGate = new Promise<void>((resolve) => (release = resolve));
      releaseProvider = release;
      providerStarted = markStarted;
      waitingForProvider = true;
      let httpRequests = 0;
      const blockedWorker = createJevRunWorker({
        storageService: storage,
        predictionService: prediction.predictions,
        cache,
        fetch: async () => {
          httpRequests++;
          if (waitingForProvider) {
            waitingForProvider = false;
            providerStarted();
            const gate = providerGate;
            if (gate) await gate;
          }
          return gatewayResponse();
        },
      });
      const blockedController = composeJevRunController({
        storageService: storage,
        predictionService: prediction.predictions,
        unifiedScoringService: createUnifiedScoringService({
          storageService: storage,
          cache,
          fitnessService: createFitnessService(),
        }),
        gameService,
        cache,
        runService: blockedWorker,
      });
      if (!blockedController) throw new Error("expected blocked controller");
      const selection = {
        kind: "selected",
        bggIds: [removedEntry.bggId],
      } as const;
      const selectedPreview = await blockedController.previewWishlist(selection);
      if (selectedPreview.status !== 200 || !("scope" in selectedPreview.body))
        throw new Error("expected selected candidate disclosure");
      await wishlist.remove(removedEntry.id);
      const revokedStart = await blockedController.start({
        requestId: selectedPreview.body.requestId,
        precondition: selectedPreview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      expect(revokedStart.status).toBe(412);
      expect(httpRequests).toBe(0);

      const lateEntry = await wishlist.add(removedEntry.bggId);
      const latePreview = await blockedController.previewWishlist({
        kind: "selected",
        bggIds: [lateEntry.bggId],
      });
      if (latePreview.status !== 200 || !("scope" in latePreview.body))
        throw new Error("expected fresh selected candidate disclosure");
      const blockedStart = await blockedController.start({
        requestId: latePreview.body.requestId,
        precondition: latePreview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      if (blockedStart.status !== 200) throw new Error("selected run did not start");
      await startedProvider;
      await wishlist.remove(lateEntry.id);
      expect((await storage.loadWishlist()).some((entry) => entry.id === lateEntry.id)).toBe(false);
      const cacheRevisionAfterRemoval = cache.mutationRevision();
      releaseProvider();
      const terminal = await waitForRun(cache, blockedStart.body.runId);
      expect(terminal?.state).toBe("failed");
      expect(terminal?.failedPairs).toBe(1);
      expect(httpRequests).toBe(1);
      expect(cache.mutationRevision()).toBe(cacheRevisionAfterRemoval);
      expect(
        cache.candidateCOnlyPairs(encodeWishlistBggMember(collection.id, "9402")),
      ).toHaveLength(0);
    } finally {
      if (providerGate) releaseProvider();
      cache.close();
      await rm(directory, { recursive: true, force: true });
      if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = oldKey;
    }
  });
});
