import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Axis, Collection, Game } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import { createFileOps } from "../../src/services/file-ops.js";
import { createJevPairCache } from "../../src/services/jev-pair-cache-service.js";
import type { JevPairJudgment } from "../../src/services/jev-pair-cache-service.js";
import { JEV_JUDGMENT_CONTRACT } from "../../src/services/jev/jev-judgment-contract.js";
import { buildJevPairDependencies } from "../../src/services/jev-pair-identity.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createUnifiedScoringService } from "../../src/services/unified-scoring-service.js";
import { advanceWishlistMutationGeneration } from "../../src/services/profile-source-coordinator.js";

const observedAt = "2026-10-04T00:00:00.000Z";

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

function game(id: string, rating?: number): Collection["games"][number] {
  const bggId = Number(id.replace(/\D/g, "")) || 100;
  const value: Game = {
    id,
    bggId,
    entityMetadata: createInitialEntityMetadata(bggId),
    name: id,
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
      numWeightVotes: 1,
      description: `Description for ${id}`,
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
    ratings: rating === undefined ? {} : { personal: rating },
    createdAt: observedAt,
    updatedAt: observedAt,
  };
  return {
    ...value,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
  };
}

describe("unified scoring storage composition", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = null;
  });

  test("captures real storage sources once, calculates from the cache-only kernel, and fences acceptance", async () => {
    directory = await mkdtemp(join(tmpdir(), "unified-scoring-storage-"));
    const storage = createStorageService({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
    });
    const cache = await createJevPairCache(directory);
    try {
      const collection = await storage.loadCollection();
      collection.axes = [axis()];
      collection.games = [
        game("target"),
        game("rated-1", 2),
        game("rated-2", 4),
        game("rated-3", 6),
        game("rated-4", 8),
        game("rated-5", 10),
      ];
      collection.games[0].ownerNote = {
        state: "present",
        version: 1,
        updatedAt: observedAt,
        text: "PRIVATE_UNIFIED_SCORING_NOTE",
      };
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: { factual: 1, description: 3, ownerNote: 0 },
      };
      await storage.saveCollection(collection);
      if (!storage.hydrateSourceVector) throw new Error("Source vector hydration unavailable");
      await storage.hydrateSourceVector();

      let axisIndexBuilds = 0;
      let indexedPairs = 0;
      let factualContextsBuilt = 0;
      let vectorsEncoded = 0;
      let cachePointReads = 0;
      const service = createUnifiedScoringService({
        storageService: storage,
        cache,
        fitnessService: createFitnessService(),
        collectionObserver: {
          onAxisPairIndexBuilt() {
            axisIndexBuilds++;
          },
          onAxisPairIndexed() {
            indexedPairs++;
          },
        },
        preparedObserver: {
          onFactualContextBuilt() {
            factualContextsBuilt++;
          },
          onVectorEncoded() {
            vectorsEncoded++;
          },
          onCachePointRead() {
            cachePointReads++;
          },
        },
      });
      const frame = await service.capture();
      expect(Object.isFrozen(frame.sources)).toBe(true);
      expect(Object.isFrozen(frame.sources.collection.games)).toBe(true);
      const calculation = service.calculate(
        frame,
        { scope: "predict-game", gameId: "target" },
        { includeRedundancy: false },
      );
      expect(calculation.proof.version).toBe(2);
      expect(calculation.collectionFitness.has("target")).toBe(true);
      expect(calculation.collectionFitness.get("target")?.score).toBe(7.3);
      expect(calculation.targetFitness.get("target")?.score).toBe(7.3);
      expect("set" in calculation.collectionFitness).toBe(false);
      expect(Object.isFrozen(calculation.collectionFitness.get("target"))).toBe(true);
      expect(JSON.stringify(calculation)).not.toContain("PRIVATE_UNIFIED_SCORING_NOTE");
      expect(calculation.isCurrent()).toBe(true);
      expect(factualContextsBuilt).toBe(1);
      const vectorsAfterFirstCalculation = vectorsEncoded;
      const cacheReadsAfterFirstCalculation = cachePointReads;
      const indexedAfterFirstCalculation = indexedPairs;
      const buildsAfterFirstCalculation = axisIndexBuilds;
      expect(
        service.calculate(
          frame,
          { scope: "predict-game", gameId: "target" },
          { includeRedundancy: false },
        ),
      ).toBe(calculation);
      expect(indexedPairs).toBe(indexedAfterFirstCalculation);
      expect(axisIndexBuilds).toBe(buildsAfterFirstCalculation);
      expect(cachePointReads).toBe(cacheReadsAfterFirstCalculation);
      let accepted = false;
      expect(await service.publishCurrent(calculation, () => (accepted = true))).toBe(true);
      expect(accepted).toBe(true);

      const sourceGames = new Map(frame.sources.collection.games.map((item) => [item.id, item]));
      const target = sourceGames.get("target");
      const reference = sourceGames.get("rated-5");
      if (!target || !reference) throw new Error("Expected captured source games");
      const [gameAId, gameBId] = [target.id, reference.id].sort();
      const row: JevPairJudgment = {
        collectionId: frame.sources.collection.id,
        gameAId,
        gameBId,
        signal: "C",
        dependencyKind: "C_ONLY",
        value: 0,
        confidence: 1,
        ...JEV_JUDGMENT_CONTRACT,
        completedAt: observedAt,
        dependencies: buildJevPairDependencies(
          "C_ONLY",
          {
            gameId: target.id,
            name: target.name,
            description: target.bggData?.description ?? undefined,
          },
          {
            gameId: reference.id,
            name: reference.name,
            description: reference.bggData?.description ?? undefined,
          },
        ),
      };
      cache.upsert(row);
      const changedCacheCalculation = service.calculate(
        frame,
        { scope: "predict-game", gameId: "target" },
        { includeRedundancy: false },
      );
      expect(changedCacheCalculation.collectionFitness.get("target")?.score).not.toBe(
        calculation.collectionFitness.get("target")?.score,
      );
      expect(changedCacheCalculation.proof.identity).not.toBe(calculation.proof.identity);
      expect(cachePointReads).toBeGreaterThan(cacheReadsAfterFirstCalculation);
      expect(factualContextsBuilt).toBe(1);
      expect(vectorsEncoded).toBe(vectorsAfterFirstCalculation);
      expect(calculation.isCurrent()).toBe(false);

      const staleFrame = await service.capture();
      const stale = service.calculate(
        staleFrame,
        { scope: "predict-game", gameId: "target" },
        { includeRedundancy: false },
      );
      cache.reset();
      expect(stale.isCurrent()).toBe(false);
      let staleAccepted = false;
      expect(await service.publishCurrent(stale, () => (staleAccepted = true))).toBeNull();
      expect(staleAccepted).toBe(false);

      const sourceStaleFrame = await service.capture();
      const sourceStale = service.calculate(
        sourceStaleFrame,
        { scope: "predict-game", gameId: "target" },
        { includeRedundancy: false },
      );
      const currentSettings = await storage.loadPredictionSettings();
      await storage.savePredictionSettings({
        ...currentSettings,
        defaultK: currentSettings.defaultK + 1,
      });
      expect(sourceStale.isCurrent()).toBe(false);
      expect(await service.publishCurrent(sourceStale, () => true)).toBeNull();
    } finally {
      cache.close();
    }
  });

  test("keeps wishlist authorization pairs separate from cache-only owned-fitness dependencies", async () => {
    directory = await mkdtemp(join(tmpdir(), "unified-scoring-wishlist-"));
    const storage = createStorageService({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
    });
    const cache = await createJevPairCache(directory);
    try {
      const collection = await storage.loadCollection();
      collection.axes = [axis()];
      collection.games = [
        game("target"),
        game("rated-1", 2),
        game("rated-2", 4),
        game("rated-3", 6),
        game("rated-4", 8),
        game("rated-5", 10),
      ];
      await storage.saveCollection(collection);
      if (!storage.hydrateSourceVector) throw new Error("Source vector hydration unavailable");
      await storage.hydrateSourceVector();
      const bggSource = {
        observedAt,
        description: "Candidate compact description",
        mechanics: ["Draft"],
        categories: ["Strategy"],
        weight: 2.5,
        communityRating: 7,
        minPlayers: 2,
        maxPlayers: 4,
        bestPlayers: 3,
        playingTime: 60,
      };
      await storage.saveWishlist([
        {
          id: randomUUID(),
          bggId: 99001,
          name: "Wishlist candidate",
          yearPublished: 2020,
          thumbnailUrl: null,
          predictedScore: 2,
          predictionConfidence: "weak",
          predictedBreakdown: null,
          nicheImpact: null,
          redundancyPreview: null,
          bggSource,
          addedAt: observedAt,
        },
      ]);
      const service = createUnifiedScoringService({
        storageService: storage,
        cache,
        fitnessService: createFitnessService(),
      });
      const frame = await service.capture({ includeWishlist: true });
      const calculation = service.calculate(
        frame,
        { scope: "wishlist", selectedBggIds: [99001] },
        { includeRedundancy: false },
      );
      expect(calculation.targetFitness.get("wishlist:99001")?.score).toBe(7.3);
      expect(calculation.predictionPairs.length).toBeGreaterThan(0);
      expect(
        calculation.predictionPairs.every((item) => item.pair.domain === "wishlist-candidate"),
      ).toBe(true);
      expect(calculation.calculationDependencyPairs.length).toBeGreaterThan(0);
      expect(
        calculation.calculationDependencyPairs.every((item) => item.pair.domain === "collection"),
      ).toBe(true);
      expect("bggSource" in (calculation.wishlistResults[0]?.entry ?? {})).toBe(false);
      expect(JSON.stringify(calculation)).not.toContain(bggSource.description);
      expect(calculation.isCurrent()).toBe(true);
      advanceWishlistMutationGeneration(storage);
      expect(calculation.isCurrent()).toBe(false);
      expect(await service.publishCurrent(calculation, () => true)).toBeNull();
    } finally {
      cache.close();
    }
  });

  test("evaluates a private proposed collection without changing or publishing the persisted baseline", async () => {
    directory = await mkdtemp(join(tmpdir(), "unified-scoring-proposal-"));
    const storage = createStorageService({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
    });
    const cache = await createJevPairCache(directory);
    try {
      const collection = await storage.loadCollection();
      const first = { ...axis(), id: "first", name: "First", weight: 1 };
      const second = { ...axis(), id: "second", name: "Second", weight: 1 };
      collection.axes = [first, second];
      collection.games = [game("target")];
      collection.games[0].ratings = { first: 2, second: 8 };
      await storage.saveCollection(collection);
      if (!storage.hydrateSourceVector) throw new Error("Source vector hydration unavailable");
      await storage.hydrateSourceVector();
      const service = createUnifiedScoringService({
        storageService: storage,
        cache,
        fitnessService: createFitnessService(),
      });
      const prior = await storage.loadCollection();
      const proposed = structuredClone(prior);
      proposed.axes[0].weight = 3;
      const evaluation = await service.prepareProposedCollection({ prior, proposed });
      const calculation = evaluation.calculate(
        { scope: "collection-targets", targetIds: ["target"] },
        { includeRedundancy: false },
      );
      expect(calculation.collectionFitness.get("target")?.score).toBe(3.5);
      expect((await storage.loadCollection()).axes[0]?.weight).toBe(1);
      expect(await service.publishCurrent(calculation, () => "published")).toBeNull();
      expect(await evaluation.assertBaseCurrent()).toBe(true);
      expect(calculation.isCurrent()).toBe(true);
      expect(
        await evaluation.accept(
          calculation,
          () => calculation.collectionFitness.get("target")?.score,
        ),
      ).toBe(3.5);
      expect((await storage.loadCollection()).axes[0]?.weight).toBe(1);

      const stalePrior = await storage.loadCollection();
      const staleProposal = structuredClone(stalePrior);
      staleProposal.axes[0].weight = 3;
      const staleEvaluation = await service.prepareProposedCollection({
        prior: stalePrior,
        proposed: staleProposal,
      });
      const staleCalculation = staleEvaluation.calculate(
        { scope: "collection-targets", targetIds: ["target"] },
        { includeRedundancy: false },
      );
      const predictionSettings = await storage.loadPredictionSettings();
      await storage.savePredictionSettings({
        ...predictionSettings,
        defaultK: predictionSettings.defaultK + 1,
      });
      expect(await staleEvaluation.assertBaseCurrent()).toBe(false);
      expect(await staleEvaluation.accept(staleCalculation, () => true)).toBeNull();
    } finally {
      cache.close();
    }
  });
});
