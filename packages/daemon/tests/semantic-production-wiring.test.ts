import { afterEach, describe, expect, test } from "bun:test";
import type { Collection, DurableGame, GameWithScore } from "@shelf-judge/shared";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyStateV10,
} from "@shelf-judge/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp, jsonRequest } from "./helpers/test-app.js";
import { createFileOps } from "../src/services/file-ops.js";
import { createJevProductionSemanticRead } from "../src/services/jev-production-read.js";
import { computeJevPairCoverage } from "../src/services/jev-pair-coverage.js";
import { buildJevPredictionCaptureIdentity } from "../src/services/jev-prediction-capture-identity.js";
import { buildJevPairDependencies } from "../src/services/jev-pair-identity.js";
import { canonicalSha256 } from "../src/services/profile-source-coordinator.js";
import { JEV_JUDGMENT_CONTRACT } from "../src/services/jev/jev-judgment-contract.js";
import {
  createJevPairCache,
  type JevPairJudgment,
} from "../src/services/jev-pair-cache-service.js";
import { projectProfileCollectionSource } from "../src/services/game-projection.js";

const dirs: string[] = [];
afterEach(async () =>
  Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))),
);

function semanticFixture() {
  const game = (id: string): DurableGame => ({
    id,
    bggId: null,
    name: `Game ${id}`,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: {
      communityRating: 5,
      bayesAverage: 5,
      weight: null,
      numWeightVotes: 0,
      description: `Description ${id}`,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: "2026-01-01T00:00:00Z",
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
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ownerNote: {
      state: "present",
      version: 1,
      updatedAt: "2026-01-01T00:00:00Z",
      text: `PRIVATE NOTE ${id}`,
    },
  });
  const games = [game("a"), game("b")];
  const semantic = createInitialSemanticRedundancyStateV10();
  const collection = {
    id: "collection",
    name: "Fixture",
    schemaVersion: 10,
    revision: 1,
    axes: [],
    games,
    intentions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    attentionDispositions: [],
    semanticRedundancy: {
      ...semantic,
      settings: {
        enabled: true,
        weights: { factual: 0.5, description: 1, ownerNote: 1 },
        cachedOwnerNoteUse: true,
      },
      evidenceEpoch: 3,
      consentEpoch: 4,
      ownerNoteConsentEpoch: 4,
      factualWeightsEpoch: 2,
      factualWeightsFingerprint: "factual-v2",
    },
  } as unknown as Collection;
  const predictionCapture = games.map((g) => ({
    game: { ...g, ownerNote: undefined },
    score: {
      score: 3,
      ratedAxisCount: 1,
      totalAxisCount: 1,
      breakdown: [],
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      redundancyAdjustment: null,
      predictionMeta: { actualAxisCount: 1 },
    },
  })) as unknown as GameWithScore[];
  const factualWeights = { binary: 1, continuous: 1 };
  const predictionSettings = {
    stageThresholds: [5, 15, 30] as [number, number, number],
    defaultK: 5,
    minSimilarityThreshold: 0.2,
  };
  const tournament = {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
    sessions: [],
    gameStats: {},
  };
  const sourceVector = {
    available: true,
    unavailableSources: [],
    processEpoch: "fixture-process",
    changeToken: 1,
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    collectionRevision: collection.revision,
    semanticEvidenceEpoch: collection.semanticRedundancy.evidenceEpoch,
    semanticConsentEpoch: collection.semanticRedundancy.consentEpoch,
    factualWeightsEpoch: collection.semanticRedundancy.factualWeightsEpoch,
    factualWeightsFingerprint: collection.semanticRedundancy.factualWeightsFingerprint,
    redundancyWeightsFingerprint: canonicalSha256(factualWeights),
    tournamentRevision: 2,
    predictionSettingsRevision: 3,
    nicheSettingsRevision: 4,
    redundancySettingsRevision: 5,
    shelfConfigRevision: 6,
    representationVersion: 1 as const,
    algorithmVersion: 1 as const,
  };
  const captureIdentityResult = buildJevPredictionCaptureIdentity({
    collection,
    sourceVector,
    tournament,
    predictionSettings,
    factualWeights,
    predictionCapture,
  });
  if (!captureIdentityResult.ok) throw new Error(captureIdentityResult.reason);
  return {
    collection,
    games,
    predictionCapture,
    predictionSettings,
    tournament,
    sourceVector,
    redundancySettings: { enabled: true },
    factualWeights,
    captureIdentity: captureIdentityResult.identity,
  };
}

function seededRow(
  collection: Collection,
  [a, b]: DurableGame[],
  signal: "C" | "D",
): JevPairJudgment {
  const kind = signal === "C" ? "SHARED_CD" : "D_ONLY";
  const source = (g: DurableGame) => ({
    gameId: g.id,
    name: g.name,
    ...(signal === "C" ? { description: g.bggData?.description ?? "" } : {}),
    note: {
      text: g.ownerNote.state === "present" ? g.ownerNote.text : "",
      version: String(g.ownerNote.version),
    },
  });
  return {
    collectionId: collection.id,
    consentEpoch: String(
      collection.semanticRedundancy.ownerNoteConsentEpoch ??
        collection.semanticRedundancy.consentEpoch,
    ),
    gameAId: a.id,
    gameBId: b.id,
    signal,
    dependencyKind: kind,
    value: 0.7,
    modelId: JEV_JUDGMENT_CONTRACT.modelId,
    rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
    questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
    requestSchemaVersion: JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
    scoreMappingVersion: JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
    semanticPolicyId: JEV_JUDGMENT_CONTRACT.semanticPolicyId,
    completedAt: "2026-01-01T00:00:00Z",
    dependencies: buildJevPairDependencies(kind, source(a), source(b)),
  };
}

describe("semantic production app wiring", () => {
  test("the shared production composition scores partial current cache without activation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-production-wiring-"));
    dirs.push(dir);
    const cache = await createJevPairCache(dir);
    const input = semanticFixture();
    const reader = createJevProductionSemanticRead(cache);
    const initial = reader(input);
    expect(initial.result.status).toBe("factual");

    cache.upsert(seededRow(input.collection, input.games, "C"));
    const partial = reader(input);
    expect(partial.result.status).toBe("partial");
    if (partial.result.status !== "partial") throw new Error("Expected partial semantic table");
    expect(partial.result.table.pairs[0]?.factual).toBeTypeOf("number");
    expect(partial.result.table.pairs[0]?.description).toBe(0.7);
    expect(partial.result.table.pairs[0]?.ownerNote).toBeNull();
    expect(partial.proof.status).toBe("partial");
    expect(cache.getActivation()).toBeNull();

    cache.upsert(seededRow(input.collection, input.games, "D"));
    const identity = computeJevPairCoverage({ ...input, cache }).identity;
    const ready = reader(input);
    expect(ready.result.status).toBe("ready");
    expect(ready.proof).toEqual({ status: "ready", identity });
    expect(JSON.stringify(ready.proof)).not.toContain("PRIVATE NOTE");
    expect(cache.getActivation()).toBeNull();

    cache.close();
    const restarted = await createJevPairCache(dir);
    try {
      expect(createJevProductionSemanticRead(restarted)(input).result.status).toBe("ready");
      const changedCapture = input.predictionCapture.map((entry) => ({
        ...entry,
        score: entry.score === null ? null : { ...entry.score, score: entry.score.score + 1 },
      }));
      const changedIdentity = buildJevPredictionCaptureIdentity({
        ...input,
        predictionCapture: changedCapture,
      });
      if (!changedIdentity.ok) throw new Error(changedIdentity.reason);
      const changed = {
        ...input,
        predictionCapture: changedCapture,
        captureIdentity: changedIdentity.identity,
      };
      const changedRead = createJevProductionSemanticRead(restarted)(changed);
      expect(changedRead.result.status).toBe("ready");
      expect(changedRead.proof.status).toBe("ready");
      if (changedRead.proof.status !== "ready" || ready.proof.status !== "ready")
        throw new Error("Expected ready proofs");
      expect(changedRead.proof.identity).not.toBe(ready.proof.identity);
      const unavailable = createJevProductionSemanticRead(null)(input);
      expect(unavailable.result.status).toBe("not-ready");
      const revoked = {
        ...input,
        collection: {
          ...input.collection,
          semanticRedundancy: {
            ...input.collection.semanticRedundancy,
            settings: {
              ...input.collection.semanticRedundancy.settings,
              cachedOwnerNoteUse: false,
            },
          },
        },
      };
      expect(createJevProductionSemanticRead(restarted)(revoked).result.status).toBe("factual");
    } finally {
      restarted.close();
    }
  });

  test("snapshot, list, and detail routes share durable SQLite semantic reads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-production-routes-"));
    dirs.push(dir);
    const cacheDir = join(dir, "cache");
    const filesDir = join(dir, "files");
    let cache = await createJevPairCache(cacheDir);
    const input = semanticFixture();
    const makeApp = () =>
      createTestApp({
        dataDir: filesDir,
        configPath: join(filesDir, "config.json"),
        fileOps: createFileOps(),
        jevPairCache: cache,
        now: () => "2026-01-01T00:00:00.000Z",
      });
    let context = makeApp();
    try {
      const redundancy = await context.storageService.loadRedundancySettings();
      input.collection.axes = (await context.storageService.loadCollection()).axes;
      input.collection.semanticRedundancy.factualWeightsFingerprint = canonicalSha256(
        redundancy.componentWeights,
      );
      await context.storageService.saveCollection(input.collection);
      await context.storageService.saveRedundancySettings({ ...redundancy, enabled: true });
      await context.axisService.createAxis({
        name: "Fixture axis one",
        weight: 50,
        source: "personal",
      });
      await context.axisService.createAxis({
        name: "Fixture axis two",
        weight: 50,
        source: "personal",
      });
      const stored = await context.storageService.loadCollection();
      const personalAxes = stored.axes.filter((axis) => axis.source === "personal");
      expect(personalAxes.length).toBeGreaterThanOrEqual(2);
      await context.gameService.rateGame(stored.games[0].id, { [personalAxes[0].id]: 8 });
      await context.gameService.rateGame(stored.games[1].id, { [personalAxes[1].id]: 7 });
      const hydratedSourceVector = await context.storageService.hydrateSourceVector?.();

      const collection = await context.storageService.loadCollection();
      const predictionCapture = await context.predictionService.listGamesWithPredictions();
      const tournament = await context.storageService.loadTournament();
      const predictionSettings = await context.predictionService.getSettings();
      const redundancySettings = await context.storageService.loadRedundancySettings();
      const sourceVector = hydratedSourceVector ?? context.storageService.sourceVector?.();
      if (!sourceVector) throw new Error("Fixture source vector is unavailable");
      const projectedCollection = projectProfileCollectionSource(collection);
      const fullSnapshotPrediction =
        await context.predictionService.preparePredictionListFromSnapshot?.(
          collection,
          tournament,
          predictionSettings,
        );
      const projectedSnapshotPrediction =
        await context.predictionService.preparePredictionListFromSnapshot?.(
          projectedCollection,
          tournament,
          predictionSettings,
        );
      expect(fullSnapshotPrediction).toBeDefined();
      expect(projectedSnapshotPrediction).toBeDefined();
      expect(fullSnapshotPrediction?.listGames()).toEqual(projectedSnapshotPrediction?.listGames());
      expect(fullSnapshotPrediction?.semanticScoringInputProof).toEqual(
        projectedSnapshotPrediction?.semanticScoringInputProof,
      );
      expect(fullSnapshotPrediction?.isCurrent?.()).toBe(true);

      const publicDisplayedSnapshot = {
        kind: "public" as const,
        collection: projectedCollection,
        tournament,
        predictionSettings,
        redundancySettings,
      };
      const publicDisplayed = await context.displayedFitnessService.listGamesFromSnapshot(
        publicDisplayedSnapshot,
        { includePredicted: true },
      );
      expect(publicDisplayed.map(({ game }) => game)).toEqual(projectedCollection.games);
      expect(JSON.stringify(publicDisplayed)).not.toContain("ownerNote");
      expect(JSON.stringify(publicDisplayed)).not.toContain("PRIVATE NOTE");
      const changedPublicRatings = structuredClone(projectedCollection);
      changedPublicRatings.games[0].ratings = { personal: 4 };
      let changedPublicSourceError: unknown;
      try {
        await context.displayedFitnessService.listGamesFromSnapshot(
          { ...publicDisplayedSnapshot, collection: changedPublicRatings },
          { includePredicted: true },
        );
      } catch (error) {
        changedPublicSourceError = error;
      }
      expect(String(changedPublicSourceError)).toMatch(/collection/);

      async function expectSnapshotSourceMismatch(
        suppliedCollection: typeof projectedCollection,
        suppliedSettings = predictionSettings,
      ) {
        let capturedError: unknown;
        try {
          await context.predictionService.preparePredictionListFromSnapshot?.(
            suppliedCollection,
            tournament,
            suppliedSettings,
          );
        } catch (error) {
          capturedError = error;
        }
        expect(capturedError).toBeInstanceOf(Error);
        expect((capturedError as Error).message).toBe(
          "Snapshot prediction sources do not match the current private capture",
        );
      }
      const changedContent = structuredClone(projectedCollection);
      changedContent.games[0].name += " changed";
      await expectSnapshotSourceMismatch(changedContent);
      await expectSnapshotSourceMismatch(projectedCollection, {
        ...predictionSettings,
        defaultK: predictionSettings.defaultK + 1,
      });

      const factualWeights = redundancySettings.componentWeights;
      const captureIdentity = buildJevPredictionCaptureIdentity({
        collection,
        sourceVector,
        tournament,
        predictionSettings,
        factualWeights,
        predictionCapture,
      });
      expect(captureIdentity.ok).toBe(true);
      if (!captureIdentity.ok) throw new Error(captureIdentity.reason);
      const semanticInput = {
        collection,
        predictionCapture,
        tournament,
        predictionSettings,
        factualWeights,
        sourceVector,
        redundancySettings,
        captureIdentity: captureIdentity.identity,
      };
      const games = collection.games.filter((game) => game.ownership === "owned");
      expect(games.length).toBeGreaterThanOrEqual(2);
      cache.upsert(seededRow(collection, [games[0], games[1]], "C"));
      cache.upsert(seededRow(collection, [games[0], games[1]], "D"));
      const generation = computeJevPairCoverage({ ...semanticInput, cache }).identity;
      cache.setActivation({ identity: generation, activatedAt: "2026-01-01T00:00:00Z" });

      const readRoutes = async () => {
        const snapshotResponse = await jsonRequest(context.app, "GET", "/api/collection/snapshot");
        const listResponse = await jsonRequest(
          context.app,
          "GET",
          "/api/games?includePredicted=true",
        );
        const detailResponse = await jsonRequest(
          context.app,
          "GET",
          `/api/games/${games[0].id}?includePredicted=true`,
        );
        expect(snapshotResponse.status).toBe(200);
        expect(listResponse.status).toBe(200);
        expect(detailResponse.status).toBe(200);
        const snapshot = (await snapshotResponse.json()) as {
          games: {
            game: { id: string };
            predicted: { score: { score: number } | null };
            redundancySimilarityInfo: { status: string; generationId: string | null };
          }[];
        };
        const list = (await listResponse.json()) as GameWithScore[];
        const detail = (await detailResponse.json()) as GameWithScore;
        const snapshotGame = snapshot.games.find((game) => game.game.id === games[0].id)!;
        const listGame = list.find((game) => game.game.id === games[0].id)!;
        return { snapshot, snapshotGame, list, listGame, detail };
      };
      const assertReady = async () => {
        const result = await readRoutes();
        expect(result.snapshotGame.redundancySimilarityInfo.status).toBe("ready");
        expect(result.listGame.score?.redundancySimilarityInfo?.status).toBe("ready");
        expect(result.detail.score?.redundancySimilarityInfo?.status).toBe("ready");
        expect(result.snapshotGame.redundancySimilarityInfo.generationId).toBe(
          result.listGame.score?.redundancySimilarityInfo?.generationId ?? null,
        );
        expect(result.detail.score?.redundancySimilarityInfo?.generationId).toBe(
          result.listGame.score?.redundancySimilarityInfo?.generationId ?? null,
        );
        expect(result.snapshotGame.predicted.score?.score).toBe(result.listGame.score?.score);
        expect(result.detail.score?.score).toBe(result.listGame.score?.score);
        return result;
      };

      const ready = await assertReady();
      expect(JSON.stringify({ snapshot: ready.snapshot, list: ready.list })).not.toContain(
        "PRIVATE NOTE",
      );
      // The detail route currently includes ownerNote on its game projection. Keep that
      // known privacy gap visible rather than silently claiming all-route note redaction.
      const publicPayload = JSON.stringify({
        snapshot: ready.snapshot,
        list: ready.list,
        detail: ready.detail,
      });
      for (const privateValue of ["fingerprint", "cache.sqlite", "dependencyKind"])
        expect(publicPayload).not.toContain(privateValue);

      cache.close();
      cache = await createJevPairCache(cacheDir);
      context = makeApp();
      await assertReady();

      cache.purgePair(games[0].id, games[1].id, "C");
      const missing = await readRoutes();
      expect(missing.snapshotGame.redundancySimilarityInfo.status).toBe("partial");
      expect(missing.listGame.score?.redundancySimilarityInfo?.status).toBe("partial");
      expect(missing.detail.score?.redundancySimilarityInfo?.status).toBe("partial");
      const partialIdentity = missing.snapshotGame.redundancySimilarityInfo.generationId;
      // V2 is a content proof, not the legacy live generation identifier.
      expect(ready.snapshotGame.redundancySimilarityInfo.generationId).toBeNull();
      expect(partialIdentity).toBeNull();
      expect(missing.listGame.score?.redundancySimilarityInfo?.generationId).toBe(partialIdentity);
      expect(missing.detail.score?.redundancySimilarityInfo?.generationId).toBe(partialIdentity);
      expect(missing.listGame.score?.score).toBe(
        ready.listGame.score?.redundancyAdjustment?.originalScore,
      );

      const revokedCollection = await context.storageService.loadCollection();
      revokedCollection.revision += 1;
      revokedCollection.semanticRedundancy.settings.cachedOwnerNoteUse = false;
      await context.storageService.saveCollection(revokedCollection);
      const revoked = await readRoutes();
      expect(revoked.snapshotGame.redundancySimilarityInfo.status).toBe("factual");
      expect(revoked.listGame.score?.redundancySimilarityInfo?.status).toBe("factual");
      expect(revoked.detail.score?.redundancySimilarityInfo?.status).toBe("factual");
      expect(revoked.snapshotGame.redundancySimilarityInfo.generationId).toBeNull();
      expect(revoked.listGame.score?.score).toBe(
        ready.listGame.score?.redundancyAdjustment?.originalScore,
      );
      expect(JSON.stringify({ snapshot: revoked.snapshot, list: revoked.list })).not.toContain(
        "PRIVATE NOTE",
      );
    } finally {
      cache.close();
    }
  });

  test("stored-disposition mutation scores the proposal before saving and recalculates after commit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-proposed-mutation-"));
    dirs.push(dir);
    const cacheDir = join(dir, "cache");
    let cache = await createJevPairCache(cacheDir);
    const context = createTestApp({
      dataDir: join(dir, "files"),
      configPath: join(dir, "files", "config.json"),
      fileOps: createFileOps(),
      jevPairCache: cache,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const fixture = semanticFixture();
    fixture.collection.semanticRedundancy.settings.weights.ownerNote = 0;
    fixture.collection.semanticRedundancy.factualWeightsFingerprint = canonicalSha256(
      (await context.storageService.loadRedundancySettings()).componentWeights,
    );
    await context.storageService.saveCollection(fixture.collection);
    const redundancySettings = await context.storageService.loadRedundancySettings();
    await context.storageService.saveRedundancySettings({ ...redundancySettings, enabled: true });
    const firstAxis = await context.axisService.createAxis({
      name: "First weighted axis",
      weight: 50,
      source: "personal",
    });
    const secondAxis = await context.axisService.createAxis({
      name: "Second weighted axis",
      weight: 50,
      source: "personal",
    });
    const targetId = fixture.games[0].id;
    await context.gameService.rateGame(targetId, { [firstAxis.id]: 2 });
    await context.gameService.rateGame(targetId, { [secondAxis.id]: 8 });
    await context.gameService.rateGame(fixture.games[1].id, {
      [firstAxis.id]: 6,
      [secondAxis.id]: 6,
    });
    const withRule = await context.storageService.loadCollection();
    withRule.attentionDispositions = [
      {
        gameId: targetId,
        kind: "intentional",
        ruleId: "manual-underused-purchase",
        ruleVersion: 1,
        fingerprint: "a".repeat(64),
        version: 1,
      },
    ];
    await context.storageService.saveCollection(withRule);
    cache.upsert(seededRow(withRule, fixture.games, "C"));
    cache.upsert(seededRow(withRule, fixture.games, "D"));
    const changedNoteProposal = structuredClone(withRule);
    changedNoteProposal.games[0].ownerNote = {
      state: "present",
      version: fixture.games[0].ownerNote.version + 1,
      updatedAt: "2026-01-02T00:00:00.000Z",
      text: "changed private note",
    };
    const noteEvaluation = await context.unifiedScoringService.prepareProposedCollection({
      prior: withRule,
      proposed: changedNoteProposal,
    });
    const noteDraft = noteEvaluation.calculate(
      { scope: "collection-all" },
      { includeRedundancy: true },
    );
    expect(noteDraft.redundancyPairs.length).toBeGreaterThan(0);
    expect(noteDraft.evidence(noteDraft.redundancyPairs[0].pair)?.description.state).not.toBe(
      "available",
    );

    const scoreCurrent = async () => {
      const frame = await context.unifiedScoringService.capture();
      const calculation = context.unifiedScoringService.calculate(
        frame,
        { scope: "collection-targets", targetIds: [targetId] },
        { includeRedundancy: false },
      );
      return { frame, calculation, score: calculation.collectionFitness.get(targetId)?.score };
    };
    expect((await scoreCurrent()).score).toBe(5);

    let proposalScore: number | undefined;
    let draftProof: string | undefined;
    context.collectionMutationService.setDispositionWinners(async (prior, proposed) => {
      const proposal = await context.unifiedScoringService.prepareProposedCollection({
        prior,
        proposed,
      });
      const calculation = proposal.calculate(
        { scope: "collection-targets", targetIds: [targetId] },
        { includeRedundancy: false },
      );
      proposalScore = calculation.collectionFitness.get(targetId)?.score;
      draftProof = calculation.proof.identity;
      const accepted = await proposal.accept(calculation, () => ({
        winners: [
          {
            gameId: targetId,
            ruleId: "manual-underused-purchase",
            ruleVersion: 1,
            fingerprint: "a".repeat(64),
          },
        ],
        assertBaseCurrent: () => proposal.assertBaseCurrent(),
      }));
      if (!accepted) throw new Error("Proposed stored disposition calculation became stale");
      return accepted;
    });

    let scoreBeforeSave: number | undefined;
    const outcome = await context.collectionMutationService.mutate(
      { operation: "axis.update", trigger: "test:proposed-disposition" },
      (candidate) => {
        candidate.axes.find((axis) => axis.id === firstAxis.id)!.weight = 75;
        candidate.axes.find((axis) => axis.id === secondAxis.id)!.weight = 25;
        return {
          changed: true,
          value: undefined,
          beforePersistence: async () => {
            scoreBeforeSave = (await scoreCurrent()).score;
          },
        };
      },
    );
    expect(outcome.outcome).toBe("accepted");
    expect(proposalScore).toBe(3.5);
    expect(scoreBeforeSave).toBe(5);
    const committed = await context.storageService.loadCollection();
    expect(committed.axes.find((axis) => axis.id === firstAxis.id)?.weight).toBe(75);
    expect(committed.attentionDispositions).toHaveLength(1);
    const persistedCalculation = await scoreCurrent();
    expect(persistedCalculation.score).toBe(3.5);
    expect(persistedCalculation.calculation.proof.identity).not.toBe(draftProof);
    expect(persistedCalculation.calculation.proof.identity).toBe(
      context.unifiedScoringService.calculate(
        persistedCalculation.frame,
        { scope: "collection-targets", targetIds: [targetId] },
        { includeRedundancy: false },
      ).proof.identity,
    );

    let compensated = false;
    let staleMutationError: unknown;
    try {
      await context.collectionMutationService.mutate(
        { operation: "axis.update", trigger: "test:source-change" },
        (candidate) => {
          candidate.axes.find((axis) => axis.id === firstAxis.id)!.weight = 50;
          candidate.axes.find((axis) => axis.id === secondAxis.id)!.weight = 50;
          return {
            changed: true,
            value: undefined,
            beforePersistence: async () => {
              const newer = await context.storageService.loadCollection();
              newer.name = "newer concurrent authority";
              newer.revision += 1;
              await context.storageService.saveCollection(newer);
            },
            onPersistenceFailure: () => {
              compensated = true;
            },
          };
        },
      );
    } catch (error) {
      staleMutationError = error;
    }
    expect(staleMutationError).toBeInstanceOf(Error);
    expect((staleMutationError as Error).message).toBe(
      "Proposed disposition scoring baseline changed before save",
    );
    expect(compensated).toBe(true);
    const newerAuthority = await context.storageService.loadCollection();
    expect(newerAuthority.name).toBe("newer concurrent authority");
    expect(newerAuthority.axes.find((axis) => axis.id === firstAxis.id)?.weight).toBe(75);

    const preQueueCalculation = await scoreCurrent();
    let releaseFirst!: () => void;
    let firstAtBoundary!: () => void;
    const boundaryReached = new Promise<void>((resolve) => (firstAtBoundary = resolve));
    const waitAtBoundary = new Promise<void>((resolve) => (releaseFirst = resolve));
    const firstWrite = context.collectionMutationService.mutate(
      { operation: "axis.update", trigger: "test:queued-first" },
      (candidate) => {
        candidate.axes.find((axis) => axis.id === firstAxis.id)!.weight = 60;
        candidate.axes.find((axis) => axis.id === secondAxis.id)!.weight = 40;
        return {
          changed: true,
          value: undefined,
          beforePersistence: async () => {
            firstAtBoundary();
            await waitAtBoundary;
          },
        };
      },
    );
    await boundaryReached;
    const queuedWrite = context.collectionMutationService.mutate(
      { operation: "test.queued-second", trigger: "test:queued-second" },
      (candidate) => {
        candidate.name = "queued later writer";
        return { changed: true, value: undefined };
      },
    );
    releaseFirst();
    await Promise.all([firstWrite, queuedWrite]);
    expect((await context.storageService.loadCollection()).name).toBe("queued later writer");
    expect(
      await context.unifiedScoringService.publishCurrent(
        preQueueCalculation.calculation,
        () => true,
      ),
    ).toBeNull();

    const currentBeforeRevocation = await context.storageService.loadCollection();
    currentBeforeRevocation.semanticRedundancy.settings.weights.ownerNote = 1;
    await context.storageService.saveCollection(currentBeforeRevocation);
    const noteCalculationFrame = await context.unifiedScoringService.capture();
    const noteCalculation = context.unifiedScoringService.calculate(
      noteCalculationFrame,
      { scope: "collection-all" },
      { includeRedundancy: true },
    );
    expect(noteCalculation.redundancyPairs.length).toBeGreaterThan(0);
    expect(noteCalculation.evidence(noteCalculation.redundancyPairs[0].pair)?.ownerNote.state).toBe(
      "available",
    );
    cache.close();
    const revoked = await context.collectionMutationService.mutate(
      { operation: "test.owner-note-revoke", trigger: "test:closed-cache-cleanup" },
      (candidate) => {
        candidate.semanticRedundancy.settings.cachedOwnerNoteUse = false;
        return { changed: true, value: undefined };
      },
    );
    expect(revoked.cleanupPending).toBe(true);
    const revokedStored = await context.storageService.loadCollection();
    expect(revokedStored.semanticRedundancy.settings.cachedOwnerNoteUse).toBe(false);
    expect(currentBeforeRevocation.semanticRedundancy.settings.cachedOwnerNoteUse).toBe(true);
    cache = await createJevPairCache(cacheDir);
    try {
      const reopenedContext = createTestApp({
        dataDir: join(dir, "files"),
        configPath: join(dir, "files", "config.json"),
        fileOps: createFileOps(),
        jevPairCache: cache,
        now: () => "2026-01-01T00:00:00.000Z",
      });
      const revokedFrame = await reopenedContext.unifiedScoringService.capture();
      const revokedCalculation = reopenedContext.unifiedScoringService.calculate(
        revokedFrame,
        { scope: "collection-all" },
        { includeRedundancy: true },
      );
      expect(revokedCalculation.redundancyPairs.length).toBeGreaterThan(0);
      expect(
        revokedCalculation.evidence(revokedCalculation.redundancyPairs[0].pair)?.ownerNote.state,
      ).not.toBe("available");
      expect(JSON.stringify(revokedCalculation)).not.toContain("PRIVATE NOTE");
      expect(revokedCalculation.isCurrent()).toBe(true);
      const deniedBaseline = await reopenedContext.storageService.loadCollection();
      const attemptedGrant = structuredClone(deniedBaseline);
      attemptedGrant.semanticRedundancy.settings.cachedOwnerNoteUse = true;
      attemptedGrant.games[0].ownerNote = {
        state: "present",
        version: attemptedGrant.games[0].ownerNote.version + 1,
        updatedAt: "2026-01-03T00:00:00.000Z",
        text: "proposal cannot grant note consent",
      };
      const deniedProposal = await reopenedContext.unifiedScoringService.prepareProposedCollection({
        prior: deniedBaseline,
        proposed: attemptedGrant,
      });
      expect(deniedProposal.collection.semanticRedundancy.settings.cachedOwnerNoteUse).toBe(false);
      const deniedCalculation = deniedProposal.calculate(
        { scope: "collection-all" },
        { includeRedundancy: true },
      );
      expect(deniedCalculation.redundancyPairs.length).toBeGreaterThan(0);
      expect(
        deniedCalculation.evidence(deniedCalculation.redundancyPairs[0].pair)?.ownerNote.state,
      ).not.toBe("available");
    } finally {
      cache.close();
    }
  });

  test("a mutation with no stored dispositions takes the zero-scoring path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-empty-disposition-"));
    dirs.push(dir);
    let factualContextsBuilt = 0;
    const context = createTestApp({
      dataDir: join(dir, "files"),
      configPath: join(dir, "files", "config.json"),
      fileOps: createFileOps(),
      preparedObserver: {
        onFactualContextBuilt() {
          factualContextsBuilt += 1;
        },
      },
    });
    const fixture = semanticFixture();
    fixture.collection.semanticRedundancy.factualWeightsFingerprint = canonicalSha256(
      (await context.storageService.loadRedundancySettings()).componentWeights,
    );
    fixture.collection.attentionDispositions = [];
    await context.storageService.saveCollection(fixture.collection);
    const outcome = await context.collectionMutationService.mutate(
      { operation: "test.empty-stored-rules", trigger: "attention:test-empty-rules" },
      (candidate) => {
        candidate.name = "renamed without disposition scoring";
        return { changed: true, value: undefined };
      },
    );
    expect(outcome.outcome).toBe("accepted");
    expect(outcome.collection.attentionDispositions).toEqual([]);
    expect(factualContextsBuilt).toBe(0);
  });

  test("the app keeps settings available and removes retired manifest protocol routes", async () => {
    const { app } = createTestApp();

    const status = await jsonRequest(app, "GET", "/api/redundancy/settings");
    const statusBody = await status.text();
    expect(status.status).toBe(200);
    expect(statusBody).not.toContain("TYPESAFE_API_KEY");
    expect(statusBody).not.toContain("Bearer");

    const retiredRoutes = [
      ["POST", "/api/redundancy/semantic/disclosure"],
      ["POST", "/api/redundancy/semantic/disclosure/page"],
      ["POST", "/api/redundancy/semantic/acknowledge-and-start"],
    ] as const;
    for (const [method, path] of retiredRoutes) {
      const response = await jsonRequest(app, method, path, method === "POST" ? {} : undefined);
      expect(response.status).toBe(404);
    }

    const ordinarySettings = await jsonRequest(app, "PATCH", "/api/redundancy/settings", {
      enabled: false,
    });
    expect(ordinarySettings.status).toBe(200);
  });
});
