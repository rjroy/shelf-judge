import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Axis, Collection, Game, WishlistEntry } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import { createFileOps } from "../../src/services/file-ops.js";
import { createJevPairCache } from "../../src/services/jev-pair-cache-service.js";
import type {
  JevPairCache,
  JevPairJudgment,
  JevRunProgress,
} from "../../src/services/jev-pair-cache-service.js";
import { JEV_JUDGMENT_CONTRACT } from "../../src/services/jev/jev-judgment-contract.js";
import {
  buildJevPairDependencies,
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
} from "../../src/services/jev-pair-identity.js";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import { createSemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createUnifiedScoringService } from "../../src/services/unified-scoring-service.js";
import { advanceWishlistMutationGeneration } from "../../src/services/profile-source-coordinator.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import { createVerifiedWishlistRefreshOverlay } from "../../src/services/staged-similarity-capture.js";
import { createCollectionSnapshotCacheService } from "../../src/services/collection-snapshot-cache-service.js";

const observedAt = "2026-10-04T00:00:00.000Z";

function readSnapshotScore(body: string | null): number | null {
  const parsed: unknown = JSON.parse(body ?? "{}");
  if (typeof parsed !== "object" || parsed === null || !("games" in parsed))
    throw new Error("Snapshot has no games array");
  const games: unknown = parsed.games;
  if (!Array.isArray(games) || typeof games[0] !== "object" || games[0] === null)
    throw new Error("Snapshot has no first game");
  const firstGame: unknown = games[0];
  if (typeof firstGame !== "object" || firstGame === null || !("score" in firstGame))
    throw new Error("Snapshot first game has no score");
  const score: unknown = firstGame.score;
  if (score !== null && typeof score !== "number") throw new Error("Snapshot score is invalid");
  return score;
}

function wishlistEntry(bggId: number, overrides: Partial<WishlistEntry> = {}): WishlistEntry {
  return {
    id: `wishlist-${bggId}`,
    bggId,
    name: `Wishlist ${bggId}`,
    yearPublished: 2024,
    thumbnailUrl: null,
    predictedScore: null,
    predictionConfidence: null,
    predictedBreakdown: null,
    nicheImpact: null,
    redundancyPreview: null,
    addedAt: observedAt,
    bggSource: {
      observedAt,
      description: null,
      mechanics: ["Draft"],
      categories: ["Strategy"],
      weight: 3,
      communityRating: 7.5,
      minPlayers: 2,
      maxPlayers: 4,
      bestPlayers: 3,
      playingTime: 90,
    },
    ...overrides,
  };
}

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

  test("ordinary unified scoring remains published-only through staging, cold reads, source change, and promotion", async () => {
    directory = await mkdtemp(join(tmpdir(), "unified-staged-published-boundary-"));
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
        game("rated-reference-1", 2),
        game("rated-reference-2", 4),
        game("rated-reference-3", 6),
        game("rated-reference-4", 8),
        game("rated-reference-5", 10),
      ];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: { factual: 1, description: 1, ownerNote: 0 },
      };
      await storage.saveCollection(collection);
      if (!storage.hydrateSourceVector) throw new Error("Source vector hydration unavailable");
      await storage.hydrateSourceVector();

      const makeService = () =>
        createUnifiedScoringService({
          storageService: storage,
          cache,
          fitnessService: createFitnessService(),
        });
      const service = makeService();
      const frame = await service.capture();
      const request = { scope: "predict-game" as const, gameId: "target" };
      const requestOptions = { includeRedundancy: true };
      const initial = service.calculate(frame, request, requestOptions);
      const firstPair =
        initial.calculationDependencyPairs.find(({ pair }) => pair.domain === "collection")?.pair ??
        initial.predictionPairs.find(({ pair }) => pair.domain === "collection")?.pair ??
        initial.redundancyPairs.find(({ pair }) => pair.domain === "collection")?.pair;
      if (!firstPair || firstPair.domain !== "collection")
        throw new Error("Expected a collection semantic dependency pair");
      const gameA = frame.sources.collection.games.find((item) => item.id === firstPair.gameAId);
      const gameB = frame.sources.collection.games.find((item) => item.id === firstPair.gameBId);
      if (!gameA?.bggData?.description || !gameB?.bggData?.description)
        throw new Error("Expected described semantic pair sources");
      const row: JevPairJudgment = {
        collectionId: frame.sources.collection.id,
        gameAId: firstPair.gameAId,
        gameBId: firstPair.gameBId,
        signal: "C",
        dependencyKind: "C_ONLY",
        value: 0.2,
        confidence: 1,
        ...JEV_JUDGMENT_CONTRACT,
        completedAt: observedAt,
        dependencies: buildJevPairDependencies(
          "C_ONLY",
          { gameId: gameA.id, name: gameA.name, description: gameA.bggData.description },
          { gameId: gameB.id, name: gameB.name, description: gameB.bggData.description },
        ),
      };
      cache.upsert(row);
      const publishedRead = service.calculate(frame, request, requestOptions);
      expect(publishedRead.evidence(firstPair)?.description).toMatchObject({
        state: "available",
        value: 0.2,
      });

      const reserve = cache.reserveRunBatch?.bind(cache);
      const checkpoint = cache.checkpointStagedPair?.bind(cache);
      const stage = cache.stagedSnapshot?.bind(cache);
      const seal = cache.sealRunBatch?.bind(cache);
      const promote = cache.promoteRunBatch?.bind(cache);
      if (!reserve || !checkpoint || !stage || !seal || !promote)
        throw new Error("Expected durable staging cache API");
      const running = {
        runId: "run-unified-stage-proof",
        state: "running" as const,
        scope: "collection" as const,
        pairCount: 1,
        completedPairs: 0,
        cacheHits: 0,
        cacheMisses: 1,
        failedPairs: 0,
        updatedAt: observedAt,
      };
      reserve.call(cache, running);
      const staged = { ...row, value: 0.9 };
      checkpoint.call(cache, { judgments: [staged], progress: { ...running, completedPairs: 1 } });
      expect(
        cache.lookupForRun?.(running.runId, {
          gameAId: row.gameAId,
          gameBId: row.gameBId,
          signal: "C",
        })?.value,
      ).toBe(0.9);
      expect(cache.lookup({ gameAId: row.gameAId, gameBId: row.gameBId, signal: "C" })?.value).toBe(
        0.2,
      );

      const coldService = makeService();
      const coldFrame = await coldService.capture();
      const coldRead = coldService.calculate(coldFrame, request, requestOptions);
      expect(coldRead.evidence(firstPair)?.description).toMatchObject({
        state: "available",
        value: 0.2,
      });

      const currentPredictionSettings = await storage.loadPredictionSettings();
      await storage.savePredictionSettings({
        ...currentPredictionSettings,
        defaultK: currentPredictionSettings.defaultK + 1,
      });
      if (!storage.hydrateSourceVector) throw new Error("Source vector hydration unavailable");
      await storage.hydrateSourceVector();
      const changedService = makeService();
      const changedFrame = await changedService.capture();
      const changedRead = changedService.calculate(changedFrame, request, requestOptions);
      expect(changedRead.evidence(firstPair)?.description).toMatchObject({
        state: "available",
        value: 0.2,
      });
      expect(
        cache.lookupForRun?.(running.runId, {
          gameAId: row.gameAId,
          gameBId: row.gameBId,
          signal: "C",
        })?.value,
      ).toBe(0.9);

      const terminal = { ...running, state: "completed" as const, completedPairs: 1 };
      seal.call(cache, terminal);
      const snapshot = stage.call(cache, running.runId);
      if (!snapshot) throw new Error("Expected sealed staged snapshot");
      const publication = promote.call(cache, {
        runId: running.runId,
        expectedStagingRevision: snapshot.revision,
        eligibleJudgments: [staged],
        progress: terminal,
      });
      expect(publication.status).toBe("published");
      const finalService = makeService();
      const finalFrame = await finalService.capture();
      const finalRead = finalService.calculate(finalFrame, request, requestOptions);
      expect(finalRead.evidence(firstPair)?.description).toMatchObject({
        state: "available",
        value: 0.9,
      });
      expect(cache.stagedSnapshot?.(running.runId)).toBeNull();
    } finally {
      cache.close();
    }
  });

  test("real SQLite scoring proof keeps snapshot validators through staging and refreshes after promotion", async () => {
    directory = await mkdtemp(join(tmpdir(), "unified-snapshot-cache-proof-"));
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
        game("snapshot-reference-1", 2),
        game("snapshot-reference-2", 4),
        game("snapshot-reference-3", 6),
        game("snapshot-reference-4", 8),
        game("snapshot-reference-5", 10),
      ];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: false,
        weights: { factual: 1, description: 1, ownerNote: 0 },
      };
      await storage.saveCollection(collection);
      if (!storage.hydrateSourceVector) throw new Error("Source vector hydration unavailable");
      await storage.hydrateSourceVector();
      const scoring = createUnifiedScoringService({
        storageService: storage,
        cache,
        fitnessService: createFitnessService(),
      });
      const initialFrame = await scoring.capture();
      const initialCalculation = scoring.calculate(
        initialFrame,
        { scope: "predict-game", gameId: "target" },
        { includeRedundancy: true },
      );
      const dependency = initialCalculation.predictionPairs.find(
        ({ pair }) => pair.domain === "collection",
      )?.pair;
      if (!dependency || dependency.domain !== "collection")
        throw new Error("Expected a semantic prediction dependency");
      const sourceGames = new Map(
        initialFrame.sources.collection.games.map((item) => [item.id, item]),
      );
      const gameA = sourceGames.get(dependency.gameAId);
      const gameB = sourceGames.get(dependency.gameBId);
      if (!gameA || !gameB) throw new Error("Expected captured semantic dependency sources");
      const publishedRow: JevPairJudgment = {
        collectionId: collection.id,
        gameAId: dependency.gameAId,
        gameBId: dependency.gameBId,
        signal: "C",
        dependencyKind: "C_ONLY",
        value: 0.2,
        confidence: 1,
        ...JEV_JUDGMENT_CONTRACT,
        completedAt: observedAt,
        dependencies: buildJevPairDependencies(
          "C_ONLY",
          {
            gameId: gameA.id,
            name: gameA.name,
            description: gameA.bggData?.description ?? undefined,
          },
          {
            gameId: gameB.id,
            name: gameB.name,
            description: gameB.bggData?.description ?? undefined,
          },
        ),
      };
      cache.upsert(publishedRow);
      let builds = 0;
      let serializations = 0;
      const snapshotCache = createCollectionSnapshotCacheService({
        storageService: storage,
        coordinator: profileSourceCoordinatorFor(storage),
        clock: { now: () => Date.parse(observedAt) },
        serialize: (snapshot) => {
          serializations++;
          return JSON.stringify(snapshot);
        },
        builder: {
          async buildSnapshot() {
            builds++;
            const frame = await scoring.capture();
            const calculation = scoring.calculate(
              frame,
              { scope: "predict-game", gameId: "target" },
              { includeRedundancy: true },
            );
            const score = calculation.targetFitness.get("target")?.score ?? null;
            return {
              snapshot: {
                representationVersion: 1,
                collectionId: collection.id,
                serverId: "real-scoring-test",
                status: "complete",
                unavailableFeatures: [],
                axes: [],
                ignoredTags: [],
                redundancyMode: "integrated",
                games: [{ gameId: "target", score }],
                nichePositions: { availability: "available", positions: [] },
                capacity: { availability: "available", result: null },
                counts: { total: 1, rated: 1, predicted: 1, unavailablePredictions: 0 },
                averageScore: score,
              } as unknown as import("@shelf-judge/shared").CollectionSnapshot,
              sourceVector: frame.sources.sourceVector,
              evaluatedAtMs: Date.parse(observedAt),
              expiresAtMs: null,
              semanticRead: {
                status: "unified-v2",
                proof: calculation.proof,
                isCurrent: () => calculation.isCurrent(),
                isReusable: () => calculation.isReusable(),
                validateCurrent: async () =>
                  (await scoring.publishCurrent(calculation, () => true)) === true,
              },
            };
          },
        },
      });
      const first = await snapshotCache.resolve();
      expect(first.status).toBe(200);
      expect(first.cacheable).toBe(true);
      const firstEtag = first.etag;
      const firstBody = first.body;
      expect((await snapshotCache.resolve(firstEtag)).status).toBe(304);
      expect({ builds, serializations }).toEqual({ builds: 1, serializations: 1 });

      const shelfRevision = storage.sourceVector?.().shelfConfigRevision;
      const shelfConfigPath = join(directory, "shelf-config.json");
      await writeFile(shelfConfigPath, `${await readFile(shelfConfigPath, "utf8")}\n`, "utf8");
      const afterExternalEdit = await snapshotCache.resolve(firstEtag);
      expect(afterExternalEdit.status).toBe(200);
      expect(afterExternalEdit.etag).not.toBe(firstEtag);
      expect(storage.sourceVector?.().shelfConfigRevision).toBe(shelfRevision);
      expect({ builds, serializations }).toEqual({ builds: 2, serializations: 2 });
      const stableEtag = afterExternalEdit.etag;

      const running: JevRunProgress = {
        runId: "snapshot-staged-run",
        state: "running",
        scope: "collection",
        pairCount: 1,
        completedPairs: 0,
        cacheHits: 0,
        cacheMisses: 1,
        failedPairs: 0,
        updatedAt: observedAt,
      };
      const stagedRow = { ...publishedRow, value: 0.9 };
      cache.reserveRunBatch?.(running);
      cache.checkpointStagedPair?.({
        judgments: [stagedRow],
        progress: { ...running, completedPairs: 1 },
      });
      expect((await snapshotCache.resolve(stableEtag)).status).toBe(304);
      expect({ builds, serializations }).toEqual({ builds: 2, serializations: 2 });

      const terminal: JevRunProgress = {
        ...running,
        state: "completed",
        completedPairs: 1,
      };
      cache.sealRunBatch?.(terminal);
      const staged = cache.stagedSnapshot?.(running.runId);
      if (!staged) throw new Error("Expected staged snapshot evidence");
      cache.promoteRunBatch?.({
        runId: running.runId,
        expectedStagingRevision: staged.revision,
        eligibleJudgments: [stagedRow],
        progress: terminal,
      });
      const afterPublication = await snapshotCache.resolve(stableEtag);
      expect(afterPublication.status).toBe(200);
      expect(afterPublication.cacheable).toBe(true);
      expect(afterPublication.etag).not.toBe(stableEtag);
      expect(afterPublication.body).not.toBe(afterExternalEdit.body);
      const afterPublicationScore = readSnapshotScore(afterPublication.body);
      const initialScore = readSnapshotScore(firstBody);
      expect(afterPublicationScore).not.toBe(initialScore);
      expect({ builds, serializations }).toEqual({ builds: 3, serializations: 3 });
    } finally {
      cache.close();
    }
  });

  test("re-reads retained wishlist C_ONLY evidence after durable note revocation and cleanup failure", async () => {
    directory = await mkdtemp(join(tmpdir(), "unified-scoring-note-revocation-"));
    const storage = createStorageService({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
    });
    const cache = await createJevPairCache(directory);
    try {
      const collection = await storage.loadCollection();
      collection.axes = [axis()];
      const ownedA = game("owned-101", 5);
      const ownedB = game("owned-102", 8);
      ownedA.ownerNote = {
        state: "present",
        version: 1,
        updatedAt: observedAt,
        text: "Private note for ownedA",
      };
      ownedB.ownerNote = {
        state: "present",
        version: 1,
        updatedAt: observedAt,
        text: "Private note for ownedB",
      };
      collection.games = [ownedA, ownedB];
      collection.semanticRedundancy.settings = {
        ...collection.semanticRedundancy.settings,
        enabled: true,
        cachedOwnerNoteUse: true,
        weights: { factual: 1, description: 1, ownerNote: 0 },
      };
      await storage.saveCollection(collection);
      const initialEntry = wishlistEntry(901);
      if (!initialEntry.bggSource) throw new Error("Wishlist fixture requires BGG source facts");
      const entry = wishlistEntry(901, {
        predictedScore: 8,
        bggSource: {
          ...initialEntry.bggSource,
          description: "Candidate description",
        },
      });
      await storage.saveWishlist([entry]);
      if (!storage.hydrateSourceVector) throw new Error("Source vector hydration unavailable");
      await storage.hydrateSourceVector();

      const candidateMember = encodeWishlistBggMember(collection.id, String(entry.bggId));
      const ownedMember = encodeOwnedLocalMember(collection.id, ownedA.id);
      const addJudgment = (input: {
        gameAId: string;
        gameBId: string;
        dependencyKind: "C_ONLY" | "SHARED_CD";
        signal: "C" | "D";
        left: { name: string; description?: string; note?: { text: string; version: string } };
        right: { name: string; description?: string; note?: { text: string; version: string } };
        pairDomain?: "wishlist-candidate";
      }) => {
        const { gameAId, gameBId, dependencyKind, signal, left, right, pairDomain } = input;
        cache.upsert({
          ...(pairDomain ? { pairDomain } : {}),
          collectionId: collection.id,
          ...(dependencyKind === "C_ONLY"
            ? {}
            : {
                consentEpoch: String(
                  collection.semanticRedundancy.ownerNoteConsentEpoch ??
                    collection.semanticRedundancy.consentEpoch,
                ),
              }),
          gameAId,
          gameBId,
          signal,
          dependencyKind,
          value: 0.6,
          confidence: 1,
          ...JEV_JUDGMENT_CONTRACT,
          completedAt: observedAt,
          dependencies: buildJevPairDependencies(
            dependencyKind,
            { gameId: gameAId, ...left },
            { gameId: gameBId, ...right },
          ),
        });
      };

      const noteSource = (item: Collection["games"][number]) => ({
        name: item.name,
        description: item.bggData?.description ?? undefined,
        note: {
          text: item.ownerNote.state === "present" ? item.ownerNote.text : "",
          version: String(item.ownerNote.version),
        },
      });
      addJudgment({
        gameAId: ownedA.id,
        gameBId: ownedB.id,
        dependencyKind: "SHARED_CD",
        signal: "C",
        left: noteSource(ownedA),
        right: noteSource(ownedB),
      });
      addJudgment({
        gameAId: ownedA.id,
        gameBId: ownedB.id,
        dependencyKind: "SHARED_CD",
        signal: "D",
        left: noteSource(ownedA),
        right: noteSource(ownedB),
      });
      addJudgment({
        gameAId: candidateMember,
        gameBId: ownedMember,
        dependencyKind: "C_ONLY",
        signal: "C",
        pairDomain: "wishlist-candidate",
        left: { name: entry.name, description: entry.bggSource?.description ?? undefined },
        right: {
          name: ownedA.name,
          description: ownedA.bggData?.description ?? undefined,
        },
      });

      const sharedC = cache.lookup({ gameAId: ownedA.id, gameBId: ownedB.id, signal: "C" });
      const sharedD = cache.lookup({ gameAId: ownedA.id, gameBId: ownedB.id, signal: "D" });
      if (!sharedC || !sharedD) throw new Error("Expected published shared C and D evidence");
      const reserve = cache.reserveRunBatch?.bind(cache);
      const checkpoint = cache.checkpointStagedPair?.bind(cache);
      if (!reserve || !checkpoint) throw new Error("Expected staged cache methods");
      const runProgress: JevRunProgress = {
        runId: "run-note-revocation",
        state: "running",
        scope: "collection",
        pairCount: 1,
        completedPairs: 0,
        cacheHits: 0,
        cacheMisses: 1,
        failedPairs: 0,
        updatedAt: observedAt,
      };
      reserve.call(cache, runProgress);
      checkpoint.call(cache, { judgments: [sharedC, sharedD], progress: runProgress });

      const service = createUnifiedScoringService({
        storageService: storage,
        cache,
        fitnessService: createFitnessService(),
      });
      const beforeRevocationFrame = await service.capture();
      const beforeRevocationRead = service.calculate(
        beforeRevocationFrame,
        { scope: "predict-game", gameId: ownedA.id },
        { includeRedundancy: true },
      );
      expect(
        beforeRevocationRead.evidence({
          domain: "collection",
          gameAId: ownedA.id,
          gameBId: ownedB.id,
        })?.description,
      ).toMatchObject({ state: "available", noteDependent: true });

      let failCleanup = true;
      const failingCache: JevPairCache = {
        ...cache,
        purgeDDependent: () => {
          if (failCleanup) {
            failCleanup = false;
            throw new Error("injected SQLite cleanup failure");
          }
          return cache.purgeDDependent();
        },
      };
      const mutationService = createCollectionMutationService({
        storageService: storage,
        jevPairCache: failingCache,
      });
      const semanticState = createSemanticRedundancyStateService({
        collectionMutationService: mutationService,
      });
      const revoked = await semanticState.updateSettings(
        { evidenceEpoch: collection.semanticRedundancy.evidenceEpoch, consentEpoch: 0 },
        { ...collection.semanticRedundancy.settings, cachedOwnerNoteUse: false },
      );
      expect(revoked).toMatchObject({ outcome: "accepted", cleanupPending: true });
      expect(beforeRevocationRead.isCurrent()).toBe(false);
      expect(
        cache.lookup({ gameAId: ownedA.id, gameBId: ownedB.id, signal: "C" })?.dependencyKind,
      ).toBe("SHARED_CD");
      expect(
        cache.lookup({
          gameAId: candidateMember,
          gameBId: ownedMember,
          signal: "C",
          pairDomain: "wishlist-candidate",
        })?.dependencyKind,
      ).toBe("C_ONLY");
      expect(cache.stagedSnapshot?.(runProgress.runId)?.judgments).toHaveLength(2);

      const collectionFrame = await service.capture();
      const collectionRead = service.calculate(
        collectionFrame,
        { scope: "predict-game", gameId: ownedA.id },
        { includeRedundancy: true },
      );
      expect(
        collectionRead.evidence({ domain: "collection", gameAId: ownedA.id, gameBId: ownedB.id })
          ?.description.state,
      ).not.toBe("available");

      const wishlistFrame = await service.capture({ includeWishlist: true });
      const wishlistRead = service.calculate(
        wishlistFrame,
        { scope: "wishlist", selectedBggIds: [entry.bggId] },
        { includeRedundancy: true },
      );
      expect(
        wishlistRead.evidence({
          domain: "wishlist-candidate",
          candidateBggId: entry.bggId,
          ownedGameId: ownedA.id,
        }),
      ).toMatchObject({
        description: { state: "available", value: 0.6, noteDependent: false },
        ownerNote: { state: "not-requested" },
      });

      const disabledState = await storage.loadCollection();
      const reenabled = await createSemanticRedundancyStateService({
        collectionMutationService: mutationService,
      }).updateSettings(
        {
          evidenceEpoch: disabledState.semanticRedundancy.evidenceEpoch,
          consentEpoch: disabledState.semanticRedundancy.consentEpoch,
        },
        { ...disabledState.semanticRedundancy.settings, cachedOwnerNoteUse: true },
      );
      expect(reenabled).toMatchObject({ outcome: "accepted", cleanupPending: false });
      expect(cache.lookup({ gameAId: ownedA.id, gameBId: ownedB.id, signal: "C" })).toBeNull();
      expect(cache.lookup({ gameAId: ownedA.id, gameBId: ownedB.id, signal: "D" })).toBeNull();
      expect(cache.stagedSnapshot?.(runProgress.runId)?.judgments).toHaveLength(0);
      const seal = cache.sealRunBatch?.bind(cache);
      const promote = cache.promoteRunBatch?.bind(cache);
      if (!seal || !promote) throw new Error("Expected terminal staged cache methods");
      const terminal: JevRunProgress = { ...runProgress, state: "failed" };
      seal.call(cache, terminal);
      const snapshot = cache.stagedSnapshot?.(runProgress.runId);
      if (!snapshot) throw new Error("Expected remaining sealed batch");
      expect(
        promote.call(cache, {
          runId: runProgress.runId,
          expectedStagingRevision: snapshot.revision,
          eligibleJudgments: [],
          progress: terminal,
        }).status,
      ).toBe("unchanged");
      expect(cache.lookup({ gameAId: ownedA.id, gameBId: ownedB.id, signal: "C" })).toBeNull();
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

  test("fences an ordinary captured wishlist candidate against direct durable edits and removal", async () => {
    directory = await mkdtemp(join(tmpdir(), "unified-wishlist-direct-edit-"));
    const storage = createStorageService({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
    });
    const cache = await createJevPairCache(join(directory, "cache"));
    try {
      const collection = await storage.loadCollection();
      collection.axes = [axis()];
      collection.games = [game("target"), game("rated-1", 2), game("rated-2", 4)];
      await storage.saveCollection(collection);
      await storage.saveWishlist([wishlistEntry(93501)]);
      await storage.savePredictionSettings({
        ...(await storage.loadPredictionSettings()),
        stageThresholds: [1, 2, 3],
      });
      if (!storage.hydrateSourceVector) throw new Error("Source vector hydration unavailable");
      await storage.hydrateSourceVector();
      const service = createUnifiedScoringService({
        storageService: storage,
        cache,
        fitnessService: createFitnessService(),
      });

      const changedFrame = await service.capture({ includeWishlist: true });
      const changedCalculation = service.calculate(
        changedFrame,
        { scope: "wishlist", selectedBggIds: [93501] },
        { includeRedundancy: false },
      );
      const changed = wishlistEntry(93501, {
        name: "Edited directly",
        bggSource: { ...wishlistEntry(93501).bggSource!, communityRating: 8.347 },
      });
      await writeFile(join(directory, "wishlist.json"), JSON.stringify([changed]));
      let publishedChanged = false;
      expect(
        await service.publishCurrent(changedCalculation, () => (publishedChanged = true)),
      ).toBe(null);
      expect(publishedChanged).toBe(false);
      expect(await service.isSourceCurrent(changedFrame)).toBe(false);

      const removedFrame = await service.capture({ includeWishlist: true });
      const removedCalculation = service.calculate(
        removedFrame,
        { scope: "wishlist", selectedBggIds: [93501] },
        { includeRedundancy: false },
      );
      await writeFile(join(directory, "wishlist.json"), "[]");
      expect(await service.isSourceCurrent(removedFrame)).toBe(false);
      let publishedRemoved = false;
      expect(
        await service.publishCurrent(removedCalculation, () => (publishedRemoved = true)),
      ).toBe(null);
      expect(publishedRemoved).toBe(false);

      const noFactsRow = wishlistEntry(93504);
      delete noFactsRow.bggSource;
      await storage.saveWishlist([wishlistEntry(93501), noFactsRow]);
      const unrelatedFrame = await service.capture({ includeWishlist: true });
      const unrelatedCalculation = service.calculate(
        unrelatedFrame,
        { scope: "wishlist", selectedBggIds: [93501] },
        { includeRedundancy: false },
      );
      const editedNoFactsRow = { ...noFactsRow, name: "Unrelated row edited directly" };
      await writeFile(
        join(directory, "wishlist.json"),
        JSON.stringify([wishlistEntry(93501), editedNoFactsRow]),
      );
      expect(await service.isSourceCurrent(unrelatedFrame)).toBe(false);
      let unrelatedPublished = false;
      expect(
        await service.publishCurrent(unrelatedCalculation, () => (unrelatedPublished = true)),
      ).toBe(null);
      expect(unrelatedPublished).toBe(false);
    } finally {
      cache.close();
    }
  });

  test("memoizes wishlist calculations only within the same private durable baseline", async () => {
    directory = await mkdtemp(join(tmpdir(), "unified-wishlist-baseline-memo-"));
    const storage = createStorageService({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
    });
    const cache = await createJevPairCache(join(directory, "cache"));
    try {
      const collection = await storage.loadCollection();
      collection.axes = [axis()];
      collection.games = [game("target"), game("rated-1", 2), game("rated-2", 4)];
      const unrelated = wishlistEntry(93511);
      delete unrelated.bggSource;
      await storage.saveCollection(collection);
      await storage.saveWishlist([wishlistEntry(93510), unrelated]);
      await storage.savePredictionSettings({
        ...(await storage.loadPredictionSettings()),
        stageThresholds: [1, 2, 3],
      });
      if (!storage.hydrateSourceVector) throw new Error("Source vector hydration unavailable");
      await storage.hydrateSourceVector();

      let pairDemandCount = 0;
      const service = createUnifiedScoringService({
        storageService: storage,
        cache,
        fitnessService: createFitnessService(),
        wishlistObserver: {
          onSourceCapture() {
            pairDemandCount += 1;
          },
        },
      });
      const request = { scope: "wishlist" as const, selectedBggIds: [93510] };
      const requestOptions = { includeRedundancy: false };
      const originalFrame = await service.capture({ includeWishlist: true });
      const originalCalculation = service.calculate(originalFrame, request, requestOptions);
      const initialPairDemandCount = pairDemandCount;
      expect(initialPairDemandCount).toBeGreaterThan(0);

      // Simulate a direct durable edit without advancing the in-process wishlist generation.
      await writeFile(
        join(directory, "wishlist.json"),
        JSON.stringify([wishlistEntry(93510), { ...unrelated, name: "Renamed externally" }]),
      );
      expect(await service.isSourceCurrent(originalFrame)).toBe(false);
      let stalePublished = false;
      expect(
        await service.publishCurrent(originalCalculation, () => (stalePublished = true)),
      ).toBeNull();
      expect(stalePublished).toBe(false);

      const freshFrame = await service.capture({ includeWishlist: true });
      expect(await service.isSourceCurrent(freshFrame)).toBe(true);
      const freshCalculation = service.calculate(freshFrame, request, requestOptions);
      expect(freshCalculation).not.toBe(originalCalculation);
      expect(pairDemandCount).toBeGreaterThan(initialPairDemandCount);
      let freshPublishCount = 0;
      expect(await service.publishCurrent(freshCalculation, () => ++freshPublishCount)).toBe(1);
      expect(freshPublishCount).toBe(1);

      const postFreshCalculationPairDemandCount = pairDemandCount;
      expect(service.calculate(freshFrame, request, requestOptions)).toBe(freshCalculation);
      expect(pairDemandCount).toBe(postFreshCalculationPairDemandCount);
      let repeatedPublishCount = 0;
      expect(await service.publishCurrent(freshCalculation, () => ++repeatedPublishCount)).toBe(1);
      expect(repeatedPublishCount).toBe(1);
    } finally {
      cache.close();
    }
  });

  test("verified refresh overlays retain and fence their original persisted baseline", async () => {
    directory = await mkdtemp(join(tmpdir(), "unified-wishlist-refresh-overlay-"));
    const storage = createStorageService({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
    });
    const cache = await createJevPairCache(join(directory, "cache"));
    try {
      const collection = await storage.loadCollection();
      collection.axes = [axis()];
      collection.games = [game("target"), game("rated-1", 2), game("rated-2", 4)];
      await storage.saveCollection(collection);
      await storage.saveWishlist([wishlistEntry(93502)]);
      await storage.savePredictionSettings({
        ...(await storage.loadPredictionSettings()),
        stageThresholds: [1, 2, 3],
      });
      if (!storage.hydrateSourceVector) throw new Error("Source vector hydration unavailable");
      await storage.hydrateSourceVector();
      const service = createUnifiedScoringService({
        storageService: storage,
        cache,
        fitnessService: createFitnessService(),
      });
      const refreshedSource = {
        ...wishlistEntry(93502).bggSource!,
        communityRating: 8.347,
        observedAt: "2026-10-04T00:01:00.000Z",
      };
      const overlay = createVerifiedWishlistRefreshOverlay({
        bggId: 93502,
        name: "Verified current name",
        bggSource: refreshedSource,
      });
      const overlayFrame = await service.capture({
        includeWishlist: true,
        verifiedRefreshOverlays: [overlay],
      });
      expect(overlayFrame.sources.wishlistCandidates?.[0]).toEqual({
        bggId: 93502,
        name: "Verified current name",
        bggSource: refreshedSource,
      });
      expect(overlayFrame.wishlistEntries[0]?.bggSource?.communityRating).toBe(8.347);
      const overlayCalculation = service.calculate(
        overlayFrame,
        { scope: "wishlist", selectedBggIds: [93502] },
        { includeRedundancy: false },
      );
      expect(await service.isSourceCurrent(overlayFrame)).toBe(true);
      expect(
        await service.publishCurrent(overlayCalculation, () => "published-current-overlay"),
      ).toBe("published-current-overlay");

      const changedEntry = wishlistEntry(93502, {
        name: "Edited directly",
        bggSource: { ...wishlistEntry(93502).bggSource!, weight: 4 },
      });
      await writeFile(join(directory, "wishlist.json"), JSON.stringify([changedEntry]));
      expect(await service.isSourceCurrent(overlayFrame)).toBe(false);
      let changedOverlayPublished = false;
      expect(
        await service.publishCurrent(overlayCalculation, () => (changedOverlayPublished = true)),
      ).toBe(null);
      expect(changedOverlayPublished).toBe(false);

      // A newly captured, explicit verified overlay authorizes scoring against the changed
      // durable baseline; the stale overlay remains fenced, but does not poison future memo use.
      const recapturedOverlayFrame = await service.capture({
        includeWishlist: true,
        verifiedRefreshOverlays: [overlay],
      });
      expect(await service.isSourceCurrent(recapturedOverlayFrame)).toBe(true);
      const recapturedOverlayCalculation = service.calculate(
        recapturedOverlayFrame,
        { scope: "wishlist", selectedBggIds: [93502] },
        { includeRedundancy: false },
      );
      expect(recapturedOverlayCalculation).not.toBe(overlayCalculation);
      let recapturedOverlayPublishCount = 0;
      expect(
        await service.publishCurrent(
          recapturedOverlayCalculation,
          () => ++recapturedOverlayPublishCount,
        ),
      ).toBe(1);
      expect(recapturedOverlayPublishCount).toBe(1);

      await storage.saveWishlist([wishlistEntry(93502)]);
      const removedOverlayFrame = await service.capture({
        includeWishlist: true,
        verifiedRefreshOverlays: [overlay],
      });
      const removedOverlayCalculation = service.calculate(
        removedOverlayFrame,
        { scope: "wishlist", selectedBggIds: [93502] },
        { includeRedundancy: false },
      );
      await writeFile(join(directory, "wishlist.json"), "[]");
      expect(await service.isSourceCurrent(removedOverlayFrame)).toBe(false);
      let removedOverlayPublished = false;
      expect(
        await service.publishCurrent(
          removedOverlayCalculation,
          () => (removedOverlayPublished = true),
        ),
      ).toBe(null);
      expect(removedOverlayPublished).toBe(false);

      const absentOverlay = createVerifiedWishlistRefreshOverlay({
        bggId: 93503,
        name: "New verified candidate",
        bggSource: refreshedSource,
      });
      const absentFrame = await service.capture({
        includeWishlist: true,
        verifiedRefreshOverlays: [absentOverlay],
      });
      const absentCalculation = service.calculate(
        absentFrame,
        { scope: "wishlist", selectedBggIds: [93503] },
        { includeRedundancy: false },
      );
      expect(await service.isSourceCurrent(absentFrame)).toBe(true);
      expect(await service.publishCurrent(absentCalculation, () => "published-new-candidate")).toBe(
        "published-new-candidate",
      );

      await writeFile(
        join(directory, "wishlist.json"),
        JSON.stringify([wishlistEntry(93503, { name: "Inserted after capture" })]),
      );
      expect(await service.isSourceCurrent(absentFrame)).toBe(false);
      let insertedPublished = false;
      expect(
        await service.publishCurrent(absentCalculation, () => (insertedPublished = true)),
      ).toBe(null);
      expect(insertedPublished).toBe(false);

      // Once the verified source is durably committed, a new ordinary capture uses that exact
      // persisted source; the old overlay frame remains stale.
      const committed = wishlistEntry(93503, {
        name: "New verified candidate",
        bggSource: refreshedSource,
      });
      await storage.saveWishlist([committed]);
      expect(await service.isSourceCurrent(absentFrame)).toBe(false);
      const committedFrame = await service.capture({ includeWishlist: true });
      expect(committedFrame.sources.wishlistCandidates?.[0]?.bggSource).toEqual(refreshedSource);
      expect(await service.isSourceCurrent(committedFrame)).toBe(true);
      const committedCalculation = service.calculate(
        committedFrame,
        { scope: "wishlist", selectedBggIds: [93503] },
        { includeRedundancy: false },
      );
      expect(
        await service.publishCurrent(committedCalculation, () => "published-persisted-source"),
      ).toBe("published-persisted-source");
    } finally {
      cache.close();
    }
  });
});
