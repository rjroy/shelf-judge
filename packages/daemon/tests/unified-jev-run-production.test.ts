import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Axis, DurableGame, WishlistEntry } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import { createFileOps } from "../src/services/file-ops.js";
import { createJevPairCache } from "../src/services/jev-pair-cache-service.js";
import type { JevPairJudgment } from "../src/services/jev-pair-cache-service.js";
import type { JevRunProgress } from "../src/services/jev-pair-cache-service.js";
import { JEV_JUDGMENT_CONTRACT } from "../src/services/jev/jev-judgment-contract.js";
import { buildJevPairDependencies } from "../src/services/jev-pair-identity.js";
import { JEV_MODEL_ID } from "../src/services/jev/jev-gateway.js";
import { createJevRunWorker, composeJevRunController } from "../src/index.js";
import { createTestApp } from "./helpers/test-app.js";

const observedAt = "2026-10-04T00:00:00.000Z";
const directories: string[] = [];

afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

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

function game(id: string, rating: number | null, ownership: DurableGame["ownership"]): DurableGame {
  const digits = Number(id.replace(/\D/g, "")) || 100;
  return {
    id,
    bggId: digits,
    entityMetadata: createInitialEntityMetadata(digits),
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
      description: `Shared board game description for ${id}`,
      mechanics: [{ id: 1, name: "Draft" }],
      categories: [{ id: 2, name: "Strategy" }],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: observedAt,
    },
    ownership,
    boxDimensions: null,
    manualShelfId: null,
    ratings: rating === null ? {} : { personal: rating },
    createdAt: observedAt,
    updatedAt: observedAt,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
  };
}

function providerResponse(): Response {
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

async function waitUntilFinished(
  cache: { getRunProgress(): JevRunProgress | null },
  expectedRunId?: string,
) {
  for (let i = 0; i < 300; i++) {
    const progress = cache.getRunProgress();
    if (progress && progress.runId === expectedRunId && progress.state !== "running")
      return progress;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Unified run did not settle within bounded event-loop turns");
}

describe("production unified Jev run preparation", () => {
  test("collection and wishlist preview/start use the same exact P∪R scope", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unified-jev-run-"));
    directories.push(directory);
    const cache = await createJevPairCache(join(directory, "cache"));
    const context = createTestApp({
      dataDir: join(directory, "data"),
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
      jevPairCache: cache,
      bggClient: {
        getGame: () => Promise.reject(new Error("Run preparation must not hydrate BGG")),
      } as never,
    });
    let providerCalls = 0;
    const originalApiKey = process.env.TYPESAFE_API_KEY;
    try {
      const collection = await context.storageService.loadCollection();
      collection.axes = [axis()];
      collection.games = [
        game("candidate-target", null, "owned"),
        game("rated-low", 2, "owned"),
        game("rated-high", 8, "owned"),
        game("previous-reference", 6, "previously-owned"),
      ];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: { factual: 1, description: 1, ownerNote: 0 },
      };
      await context.storageService.saveCollection(collection);
      await context.storageService.savePredictionSettings({
        ...(await context.storageService.loadPredictionSettings()),
        stageThresholds: [1, 2, 3],
      });
      await context.storageService.saveRedundancySettings({
        ...(await context.storageService.loadRedundancySettings()),
        enabled: true,
        stage: "integrated",
        similarityThreshold: 0,
        minNeighbors: 1,
        expectedNeighbors: 2,
        maxPenalty: 1,
        componentWeights: { binary: 1, continuous: 3 },
      });
      await context.storageService.saveWishlist([
        {
          id: "wishlist-candidate",
          bggId: 88001,
          name: "Wishlist game",
          yearPublished: 2024,
          thumbnailUrl: null,
          predictedScore: 9,
          predictionConfidence: "strong",
          predictedBreakdown: [{ axisName: "historic", rating: 9, confidence: "strong" }],
          nicheImpact: null,
          redundancyPreview: null,
          addedAt: observedAt,
          bggSource: {
            observedAt,
            description: "Verified wishlist description",
            mechanics: ["Draft"],
            categories: ["Strategy"],
            weight: 2.5,
            communityRating: 7,
            minPlayers: 2,
            maxPlayers: 4,
            bestPlayers: 3,
            playingTime: 60,
          },
        } satisfies WishlistEntry,
      ]);
      await context.storageService.hydrateSourceVector?.();

      process.env.TYPESAFE_API_KEY = "unified-run-test-key";
      const worker = createJevRunWorker({
        storageService: context.storageService,
        predictionService: context.predictionService,
        cache,
        fetch: async () => {
          providerCalls++;
          return await Promise.resolve(providerResponse());
        },
      });
      if (!worker) throw new Error("Expected the production run worker");
      const controller = composeJevRunController({
        storageService: context.storageService,
        predictionService: context.predictionService,
        unifiedScoringService: context.unifiedScoringService,
        gameService: context.gameService,
        cache,
        runService: worker,
      });
      if (!controller) throw new Error("Expected the production run controller");

      const collectionPreview = await controller.preview();
      expect(collectionPreview.status).toBe(200);
      if (collectionPreview.status !== 200 || "scope" in collectionPreview.body)
        throw new Error("Collection run preview unavailable");
      // P includes the previously-owned rated reference; R includes current owned positive targets.
      // Their exact deduplicated union is four pairs, not the three-pair R-only collection universe.
      expect(collectionPreview.body.pairCount).toBe(4);
      expect(collectionPreview.body.descriptionBearingPairCount).toBe(4);
      const exactHitSources = [collection.games[0], collection.games[1]];
      if (!exactHitSources[0] || !exactHitSources[1]) throw new Error("Run source fixture missing");
      const [hitA, hitB] = exactHitSources.sort((a, b) => a.id.localeCompare(b.id));
      const cacheHit: JevPairJudgment = {
        collectionId: collection.id,
        gameAId: hitA.id,
        gameBId: hitB.id,
        signal: "C",
        dependencyKind: "C_ONLY",
        value: 0.25,
        confidence: 1,
        ...JEV_JUDGMENT_CONTRACT,
        completedAt: observedAt,
        dependencies: buildJevPairDependencies(
          "C_ONLY",
          { gameId: hitA.id, name: hitA.name, description: hitA.bggData?.description ?? undefined },
          { gameId: hitB.id, name: hitB.name, description: hitB.bggData?.description ?? undefined },
        ),
      };
      cache.upsert(cacheHit);
      const collectionStart = await controller.start({
        requestId: collectionPreview.body.requestId,
        precondition: collectionPreview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      expect(collectionStart.status).toBe(200);
      if (collectionStart.status !== 200) throw new Error("Collection run did not start");
      const collectionProgress = await waitUntilFinished(cache, collectionStart.body.runId);
      expect(collectionProgress.pairCount).toBe(4);
      expect(collectionProgress.completedPairs).toBe(4);
      expect(collectionProgress.cacheHits).toBe(1);
      expect(providerCalls).toBe(3);

      const wishlistPreview = await controller.previewWishlist({ kind: "all" });
      expect(wishlistPreview.status).toBe(200);
      if (wishlistPreview.status !== 200 || !("scope" in wishlistPreview.body))
        throw new Error("Wishlist run preview unavailable");
      // Wishlist P contains the three rated references (including previously-owned); eligible
      // owned R is a subset, so the exact authorized wishlist-domain U0 remains three pairs.
      expect(wishlistPreview.body.scope.comparisonPairCount).toBe(3);
      expect(wishlistPreview.body.scope.sendablePairCount).toBe(3);
      expect(wishlistPreview.body.noteBearingPairCount).toBe(0);
      const deniedNotes = await controller.start({
        requestId: wishlistPreview.body.requestId,
        precondition: wishlistPreview.body.precondition,
        noteTransmissionAuthorized: true,
      });
      expect(deniedNotes.status).toBe(412);
      const wishlistStart = await controller.start({
        requestId: wishlistPreview.body.requestId,
        precondition: wishlistPreview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      expect(wishlistStart.status).toBe(200);
      if (wishlistStart.status !== 200) throw new Error("Wishlist run did not start");
      const wishlistProgress = await waitUntilFinished(cache, wishlistStart.body.runId);
      expect(wishlistProgress.scope).toBe("wishlist");
      expect(wishlistProgress.pairCount).toBe(3);
      expect(wishlistProgress.completedPairs).toBe(3);
      expect(providerCalls).toBe(6);

      const stalePreview = await controller.preview();
      expect(stalePreview.status).toBe(200);
      if (stalePreview.status !== 200 || "scope" in stalePreview.body)
        throw new Error("Precondition regression preview unavailable");
      const changedCollection = await context.storageService.loadCollection();
      changedCollection.name = "Changed after frozen preview";
      await context.storageService.saveCollection(changedCollection);
      const staleStart = await controller.start({
        requestId: stalePreview.body.requestId,
        precondition: stalePreview.body.precondition,
        noteTransmissionAuthorized: false,
      });
      expect(staleStart.status).toBe(412);
      expect(providerCalls).toBe(6);
    } finally {
      if (originalApiKey === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = originalApiKey;
      cache.close();
    }
  });
});
