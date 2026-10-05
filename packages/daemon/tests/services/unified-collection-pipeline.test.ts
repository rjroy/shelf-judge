import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Axis, Collection, DurableGame } from "@shelf-judge/shared";
import { createInitialSemanticRedundancyStateV10 } from "@shelf-judge/shared";
import { canonicalSha256 } from "../../src/services/profile-source-coordinator.js";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../../src/services/redundancy-engine.js";
import {
  createJevPairCache,
  type JevPairJudgment,
} from "../../src/services/jev-pair-cache-service.js";
import { JEV_JUDGMENT_CONTRACT } from "../../src/services/jev/jev-judgment-contract.js";
import {
  buildJevPairDependencies,
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
} from "../../src/services/jev-pair-identity.js";
import { captureSimilaritySettings } from "../../src/services/unified-similarity.js";
import { captureStagedSimilaritySources } from "../../src/services/staged-similarity-capture.js";
import type { StagedSimilaritySources } from "../../src/services/staged-similarity-capture.js";
import { prepareUnifiedCollectionPipeline } from "../../src/services/unified-collection-pipeline.js";
import { createPreparedSimilarity } from "../../src/services/prepared-similarity.js";
import type { StagedSimilarityPair } from "../../src/services/prepared-similarity.js";
import { computeUnifiedPrediction } from "../../src/services/unified-prediction.js";
import type { UnifiedCollectionPipelineObserver } from "../../src/services/unified-collection-pipeline.js";
import {
  stagedRunBudgetIdentity,
  stagedRunSelectionIdentity,
} from "../../src/services/staged-similarity-scope.js";

const now = "2026-10-04T00:00:00.000Z";
const budget = {
  maxProviderAttempts: 1000,
  reportedTokenStopThreshold: 2_000_000,
  maxRunDurationMs: 30 * 60_000,
};

function personalAxis(id: string, name = id): Axis {
  return {
    id,
    name,
    description: null,
    weight: 1,
    enabled: true,
    source: "personal",
    createdAt: now,
    updatedAt: now,
  };
}

function runPipeline(
  sources: StagedSimilaritySources,
  request: Parameters<typeof stagedRunSelectionIdentity>[0],
  redundancySettings: ReturnType<typeof enabledRedundancySettings>,
  observer?: UnifiedCollectionPipelineObserver,
) {
  const capture = captureStagedSimilaritySources(sources, { readCurrent: () => sources });
  return prepareUnifiedCollectionPipeline({
    capture,
    cache: { available: true, mutationRevision: () => 1, lookup: () => null },
    request,
    budget,
    redundancySettings,
    observer,
    authorizationReader: {
      readCurrent: () => ({
        mutationGeneration: 1,
        policyIdentity: "phase4-unit-policy",
        selectionIdentity: stagedRunSelectionIdentity(request),
        budgetIdentity: stagedRunBudgetIdentity(budget),
      }),
    },
  });
}

function enabledRedundancySettings(overrides: Partial<typeof DEFAULT_REDUNDANCY_SETTINGS> = {}) {
  return {
    ...DEFAULT_REDUNDANCY_SETTINGS,
    enabled: true,
    similarityThreshold: 0,
    expectedNeighbors: 3,
    maxPenalty: 3,
    ...overrides,
  };
}

function game(
  id: string,
  rating?: number,
  ownership: "owned" | "previously-owned" = "owned",
): DurableGame {
  return {
    id,
    bggId: 100,
    name: id,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: 3,
    playingTime: 60,
    imageUrl: null,
    bggData: {
      communityRating: 7,
      bayesAverage: 7,
      weight: 2.5,
      numWeightVotes: 1,
      description: `Description ${id}`,
      mechanics: [{ id: 1, name: "Draft" }],
      categories: [{ id: 2, name: "Strategy" }],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: now,
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
    entityMetadata: { status: "unknown" },
    latestPlayCountCheck: null,
    ownership,
    boxDimensions: null,
    manualShelfId: null,
    ratings: rating === undefined ? {} : { personal: rating },
    createdAt: now,
    updatedAt: now,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
  } as unknown as DurableGame;
}

function fixture(semanticFactualWeight = 1): StagedSimilaritySources {
  const initialSemantic = createInitialSemanticRedundancyStateV10();
  const semantic = {
    ...initialSemantic,
    settings: {
      ...initialSemantic.settings,
      enabled: true,
      cachedOwnerNoteUse: false,
      weights: { factual: semanticFactualWeight, description: 3, ownerNote: 0 },
    },
    evidenceEpoch: 2,
    consentEpoch: 3,
    ownerNoteConsentEpoch: 3,
    factualWeightsEpoch: 4,
  };
  const axes: Axis[] = [
    {
      id: "personal",
      name: "Personal",
      description: null,
      weight: 1,
      enabled: true,
      source: "personal",
      createdAt: now,
      updatedAt: now,
    },
  ];
  const collection = {
    id: "phase4-fixture",
    name: "Fixture",
    schemaVersion: 10,
    revision: 1,
    axes,
    games: [
      game("target"),
      game("ref-4", 4),
      game("ref-8", 8),
      game("previous-ref", 4, "previously-owned"),
    ],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: semantic,
    createdAt: now,
    updatedAt: now,
  } as unknown as Collection;
  const similaritySettings = captureSimilaritySettings(
    {
      ...DEFAULT_REDUNDANCY_SETTINGS,
      componentWeights: { binary: 1, continuous: 3 },
    },
    semantic.settings,
  );
  const sourceVector = {
    available: true,
    unavailableSources: [],
    processEpoch: "test-process",
    changeToken: 1,
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    collectionRevision: collection.revision,
    semanticEvidenceEpoch: semantic.evidenceEpoch,
    semanticConsentEpoch: semantic.consentEpoch,
    factualWeightsEpoch: semantic.factualWeightsEpoch,
    factualWeightsFingerprint: semantic.factualWeightsFingerprint,
    redundancyWeightsFingerprint: canonicalSha256(similaritySettings.factual),
    tournamentRevision: 1,
    predictionSettingsRevision: 1,
    nicheSettingsRevision: 1,
    redundancySettingsRevision: 1,
    shelfConfigRevision: 1,
    representationVersion: 1,
    algorithmVersion: 1,
  };
  return {
    collection,
    tournament: {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
      sessions: [],
      gameStats: {},
    },
    predictionSettings: { stageThresholds: [1, 2, 3], defaultK: 5, minSimilarityThreshold: 0.2 },
    similaritySettings,
    sourceVector: sourceVector as StagedSimilaritySources["sourceVector"],
    wishlistCandidates: [
      {
        bggId: 999,
        name: "target",
        bggSource: {
          observedAt: now,
          description: "Description target",
          mechanics: ["Draft"],
          categories: ["Strategy"],
          weight: 2.5,
          communityRating: 7,
          minPlayers: 2,
          maxPlayers: 4,
          bestPlayers: 3,
          playingTime: 60,
        },
      },
    ],
  };
}

function descriptionJudgment(
  sources: StagedSimilaritySources,
  left: DurableGame,
  right: DurableGame,
  value: number,
): JevPairJudgment {
  const [gameAId, gameBId] = [left.id, right.id].sort();
  const dependencySource = (game: DurableGame) => ({
    gameId: game.id,
    name: game.name,
    description: game.bggData?.description ?? undefined,
  });
  return {
    collectionId: sources.collection.id,
    gameAId,
    gameBId,
    signal: "C",
    dependencyKind: "C_ONLY",
    value,
    confidence: 1,
    ...JEV_JUDGMENT_CONTRACT,
    completedAt: now,
    dependencies: buildJevPairDependencies(
      "C_ONLY",
      dependencySource(left),
      dependencySource(right),
    ),
  };
}

function wishlistDescriptionJudgment(
  sources: StagedSimilaritySources,
  candidate: NonNullable<StagedSimilaritySources["wishlistCandidates"]>[number],
  owned: DurableGame,
  value: number,
): JevPairJudgment {
  const candidateId = encodeWishlistBggMember(sources.collection.id, String(candidate.bggId));
  const ownedId = encodeOwnedLocalMember(sources.collection.id, owned.id);
  const [gameAId, gameBId] = [candidateId, ownedId].sort();
  return {
    pairDomain: "wishlist-candidate",
    collectionId: sources.collection.id,
    gameAId,
    gameBId,
    signal: "C",
    dependencyKind: "C_ONLY",
    value,
    confidence: 1,
    ...JEV_JUDGMENT_CONTRACT,
    completedAt: now,
    dependencies: buildJevPairDependencies(
      "C_ONLY",
      {
        gameId: candidateId,
        name: candidate.name,
        description: candidate.bggSource.description ?? undefined,
      },
      {
        gameId: ownedId,
        name: owned.name,
        description: owned.bggData?.description ?? undefined,
      },
    ),
  };
}

describe("inert unified collection pipeline", () => {
  test("redundancy excludes only fully predicted neighbors when the target has actual-axis strength", () => {
    const mixedNeighborSources = fixture();
    mixedNeighborSources.collection.axes.push(personalAxis("enjoyment"));
    const actualTarget = game("actual-target", 5);
    actualTarget.ratings.enjoyment = 5;
    const mixedNeighbor = game("mixed-neighbor", 10);
    const lowActual = game("low-actual", 6);
    lowActual.ratings.enjoyment = 6;
    const highActual = game("high-actual", 10);
    highActual.ratings.enjoyment = 10;
    mixedNeighborSources.collection.games = [actualTarget, mixedNeighbor, lowActual, highActual];
    const actualTargetRun = runPipeline(
      mixedNeighborSources,
      { scope: "collection-targets", targetIds: ["mixed-neighbor"] },
      enabledRedundancySettings(),
    );
    expect(actualTargetRun.ok).toBe(true);
    if (!actualTargetRun.ok) return;
    expect(actualTargetRun.value.fitness.get("actual-target")?.predictionMeta).toBeNull();
    expect(actualTargetRun.value.fitness.get("mixed-neighbor")?.predictionMeta).toMatchObject({
      actualAxisCount: 1,
    });
    expect(actualTargetRun.value.fitness.get("actual-target")?.score).toBe(5);
    expect(actualTargetRun.value.fitness.get("mixed-neighbor")?.score).toBeGreaterThan(5);
    const actualTargetAdjustment = actualTargetRun.value.redundancyAdjustments.get("actual-target");
    expect(actualTargetAdjustment?.penalty).toBe(3);
    expect(
      actualTargetAdjustment?.nicheNeighbors.find(
        (neighbor) => neighbor.gameId === "mixed-neighbor",
      )?.isPredicted,
    ).toBe(false);

    const mixedTargetSources = fixture();
    mixedTargetSources.collection.axes.push(personalAxis("enjoyment"));
    const mixedTarget = game("mixed-target", 1);
    const fullyPredictedNeighbor = game("fully-predicted");
    const referenceA = game("reference-a", 10);
    referenceA.ratings.enjoyment = 2;
    const referenceB = game("reference-b", 10);
    referenceB.ratings.enjoyment = 2;
    mixedTargetSources.collection.games = [
      mixedTarget,
      fullyPredictedNeighbor,
      referenceA,
      referenceB,
    ];
    const mixedTargetRun = runPipeline(
      mixedTargetSources,
      { scope: "collection-targets", targetIds: ["mixed-target", "fully-predicted"] },
      enabledRedundancySettings(),
    );
    expect(mixedTargetRun.ok).toBe(true);
    if (!mixedTargetRun.ok) return;
    expect(mixedTargetRun.value.fitness.get("mixed-target")?.predictionMeta).toMatchObject({
      actualAxisCount: 1,
    });
    expect(
      mixedTargetRun.value.fitness.get("fully-predicted")?.predictionMeta?.actualAxisCount,
    ).toBe(0);
    expect(mixedTargetRun.value.fitness.get("mixed-target")?.score).toBe(1.5);
    expect(mixedTargetRun.value.fitness.get("fully-predicted")?.score).toBe(5.8);
    const mixedAdjustment = mixedTargetRun.value.redundancyAdjustments.get("mixed-target");
    expect(mixedAdjustment?.penalty).toBe(2);
    expect(
      mixedAdjustment?.nicheNeighbors.find((neighbor) => neighbor.gameId === "fully-predicted"),
    ).toMatchObject({ isPredicted: true, fitnessScore: 5.8 });
    expect(
      mixedAdjustment?.nicheNeighbors.find((neighbor) => neighbor.gameId === "reference-a"),
    ).toMatchObject({ isPredicted: false, fitnessScore: 6 });
  });

  test("rounds displayed penalty separately from the score deducted", () => {
    const sources = fixture();
    sources.collection.games = [game("target", 5), game("higher", 8), game("lower", 4)];
    const result = runPipeline(
      sources,
      { scope: "collection-all" },
      enabledRedundancySettings({ expectedNeighbors: 2, maxPenalty: 2.25 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.redundancyAdjustments.get("target")).toMatchObject({
      penalty: 1.13,
      originalScore: 5,
      adjustedScore: 3.88,
      nicheSize: 2,
    });
  });

  test("indexes demanded axis pairs once and visits each target's own indexed slice", () => {
    const sources = fixture(0);
    const ratedReferences = [game("ref-a", 6), game("ref-b", 7), game("ref-c", 8)];
    const targets = Array.from({ length: 24 }, (_, index) => game(`target-${index}`));
    sources.collection.games = [...ratedReferences, ...targets];
    const counts = { builds: 0, indexed: 0, consumed: 0, lookups: 0, related: 0 };
    const observer: UnifiedCollectionPipelineObserver = {
      onAxisPairIndexBuilt(count) {
        counts.builds++;
        expect(count).toBe(72);
      },
      onAxisPairIndexed() {
        counts.indexed++;
      },
      onTargetAxisPairIndexLookup(_targetId, relatedPairCount) {
        counts.lookups++;
        counts.related += relatedPairCount;
        expect(relatedPairCount).toBe(3);
      },
      onAxisPairConsumed() {
        counts.consumed++;
      },
    };
    const result = runPipeline(
      sources,
      { scope: "collection-targets", targetIds: targets.map((target) => target.id) },
      { ...DEFAULT_REDUNDANCY_SETTINGS, enabled: false },
      observer,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.run.predictionPairs).toHaveLength(72);
    expect(counts).toEqual({ builds: 1, indexed: 72, consumed: 72, lookups: 24, related: 72 });
  });

  test("runs SQLite-cached semantic P through the shared predictor, current fitness, then frozen R", async () => {
    const sources = fixture();
    expect(sources.similaritySettings.factual).toEqual({ binary: 1, continuous: 3 });
    const request = { scope: "collection-targets", targetIds: ["target"] } as const;
    const capture = captureStagedSimilaritySources(sources, { readCurrent: () => sources });
    const directory = await mkdtemp(join(tmpdir(), "unified-collection-pipeline-"));
    const cache = await createJevPairCache(directory);
    try {
      const [targetGame, lowReference, highReference, previousReference] = sources.collection.games;
      if (!targetGame || !lowReference || !highReference || !previousReference) {
        throw new Error("Fixture members missing");
      }
      cache.upsert(descriptionJudgment(sources, targetGame, lowReference, 0));
      cache.upsert(descriptionJudgment(sources, targetGame, highReference, 1));
      cache.upsert(descriptionJudgment(sources, targetGame, previousReference, 0));
      const wishlistCandidate = sources.wishlistCandidates?.[0];
      if (!wishlistCandidate) throw new Error("Wishlist candidate fixture missing");
      for (const [reference, descriptionValue] of [
        [lowReference, 0],
        [highReference, 1],
        [previousReference, 0],
      ] as const) {
        cache.upsert(
          wishlistDescriptionJudgment(sources, wishlistCandidate, reference, descriptionValue),
        );
      }
      const result = prepareUnifiedCollectionPipeline({
        capture,
        cache,
        request,
        budget,
        redundancySettings: {
          ...DEFAULT_REDUNDANCY_SETTINGS,
          enabled: true,
          similarityThreshold: 0,
          expectedNeighbors: 1,
        },
        authorizationReader: {
          readCurrent: () => ({
            mutationGeneration: 1,
            policyIdentity: "phase4-test-policy",
            selectionIdentity: stagedRunSelectionIdentity(request),
            budgetIdentity: stagedRunBudgetIdentity(budget),
          }),
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const targetFitness = result.value.fitness.get("target");
      expect(
        targetFitness?.breakdown.find((entry) => entry.axisId === "personal")?.effectiveRating,
      ).toBe(7.2);
      expect(result.value.run.predictionPairs).toHaveLength(3);
      expect(result.value.run.redundancyPairs).toHaveLength(3);
      expect(result.value.run.disclosure.overlapPairCount).toBe(2);
      expect(result.value.pairSimilarities.size).toBe(4);
      expect(result.value.run.disclosure.previousOwnedReferenceIds).toEqual(["previous-ref"]);
      const predictionKeys = new Set(result.value.run.predictionPairs.map((pair) => pair.key));
      const overlap = result.value.run.redundancyPairs.filter((pair) =>
        predictionKeys.has(pair.key),
      );
      expect(overlap).toHaveLength(2);
      expect(
        overlap.every((pair) => typeof result.value.pairSimilarities.get(pair.key) === "number"),
      ).toBe(true);
      expect(result.value.redundancyAdjustments.size).toBe(3);
      expect(result.value.redundancyAdjustments.get("target")).toMatchObject({
        penalty: 1,
        originalScore: 7.2,
        adjustedScore: 6.2,
        nicheSize: 2,
      });
      expect(result.value.redundancyAdjustments.get("ref-4")).toMatchObject({
        penalty: 1,
        originalScore: 4,
        adjustedScore: 3,
      });
      expect(result.value.redundancyAdjustments.get("ref-8")).toMatchObject({
        penalty: 0,
        originalScore: 8,
        adjustedScore: 8,
      });
      expect(targetFitness?.predictionMeta).toMatchObject({
        readinessStage: 3,
        confidence: "weak",
        predictedAxisCount: 1,
        actualAxisCount: 0,
        coveragePercent: 0,
      });
      expect(result.value.run.isAuthorized()).toBe(true);
      const sameResolver = createPreparedSimilarity({ capture, cache });
      const collectionPairs = [lowReference, highReference, previousReference].map((reference) => ({
        domain: "collection" as const,
        gameAId: targetGame.id,
        gameBId: reference.id,
      }));
      const candidatePairs = [lowReference, highReference, previousReference].map((reference) => ({
        domain: "wishlist-candidate" as const,
        candidateBggId: wishlistCandidate.bggId,
        ownedGameId: reference.id,
      }));
      sameResolver.resolvePairs([...collectionPairs, ...candidatePairs]);
      sameResolver.sealProof();
      const actualReferences = [lowReference, highReference, previousReference];
      const referencePredictions = (pairs: readonly StagedSimilarityPair[]) =>
        actualReferences.map((reference, index) => ({
          gameId: reference.id,
          gameName: reference.name,
          rating: reference.ratings.personal,
          similarity: sameResolver.similarity(pairs[index]),
        }));
      const collectionEstimator = computeUnifiedPrediction({
        axisIds: ["personal"],
        referencesByAxis: new Map([["personal", referencePredictions(collectionPairs)]]),
        settings: sources.predictionSettings,
      });
      const wishlistEstimator = computeUnifiedPrediction({
        axisIds: ["personal"],
        referencesByAxis: new Map([["personal", referencePredictions(candidatePairs)]]),
        settings: sources.predictionSettings,
      });
      expect(wishlistEstimator).toEqual(collectionEstimator);
      expect(wishlistEstimator.get("personal")?.prediction?.rating).toBeCloseTo(7.2);

      for (const scopeRequest of [
        { scope: "collection-all" } as const,
        { scope: "predict-game", gameId: "target" } as const,
      ]) {
        const sameScope = prepareUnifiedCollectionPipeline({
          capture,
          cache,
          request: scopeRequest,
          budget,
          redundancySettings: { ...DEFAULT_REDUNDANCY_SETTINGS, enabled: false },
          authorizationReader: {
            readCurrent: () => ({
              mutationGeneration: 1,
              policyIdentity: "phase4-test-policy",
              selectionIdentity: stagedRunSelectionIdentity(scopeRequest),
              budgetIdentity: stagedRunBudgetIdentity(budget),
            }),
          },
        });
        expect(sameScope.ok).toBe(true);
        if (sameScope.ok) {
          expect(sameScope.value.fitness.get("target")?.score).toBe(7.2);
          expect(sameScope.value.fitness.get("target")?.breakdown).toEqual(
            targetFitness?.breakdown,
          );
          expect(sameScope.value.fitness.get("target")?.predictionMeta).toEqual(
            targetFitness?.predictionMeta,
          );
        }
      }
      const noNeighborRun = prepareUnifiedCollectionPipeline({
        capture,
        cache,
        request,
        budget,
        redundancySettings: {
          ...DEFAULT_REDUNDANCY_SETTINGS,
          enabled: true,
          similarityThreshold: 2,
        },
        authorizationReader: {
          readCurrent: () => ({
            mutationGeneration: 1,
            policyIdentity: "phase4-test-policy",
            selectionIdentity: stagedRunSelectionIdentity(request),
            budgetIdentity: stagedRunBudgetIdentity(budget),
          }),
        },
      });
      expect(noNeighborRun.ok).toBe(true);
      if (noNeighborRun.ok) {
        expect(noNeighborRun.value.redundancyAdjustments.get("target")).toMatchObject({
          penalty: 0,
          originalScore: 7.2,
          adjustedScore: 7.2,
          nicheSize: 0,
        });
      }
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("cache-only semantic rows change real target fitness and therefore frozen R membership", async () => {
    const sources = fixture(0);
    const request = { scope: "collection-targets", targetIds: ["target"] } as const;
    const capture = captureStagedSimilaritySources(sources, { readCurrent: () => sources });
    const [target, lowReference, highReference, previousReference] = sources.collection.games;
    if (!target || !lowReference || !highReference || !previousReference)
      throw new Error("Fixture members missing");
    const directory = await mkdtemp(join(tmpdir(), "unified-collection-fitness-change-"));
    const cache = await createJevPairCache(directory);
    const run = () =>
      prepareUnifiedCollectionPipeline({
        capture,
        cache,
        request,
        budget,
        redundancySettings: { ...DEFAULT_REDUNDANCY_SETTINGS, enabled: false },
        authorizationReader: {
          readCurrent: () => ({
            mutationGeneration: 1,
            policyIdentity: "phase4-cache-change-policy",
            selectionIdentity: stagedRunSelectionIdentity(request),
            budgetIdentity: stagedRunBudgetIdentity(budget),
          }),
        },
      });
    try {
      cache.upsert(descriptionJudgment(sources, target, lowReference, 0));
      cache.upsert(descriptionJudgment(sources, target, highReference, 0));
      cache.upsert(descriptionJudgment(sources, target, previousReference, 0));
      const unavailable = run();
      expect(unavailable.ok).toBe(true);
      if (!unavailable.ok) return;
      expect(unavailable.value.fitness.has("target")).toBe(false);
      expect(unavailable.value.run.redundancyPairs).toHaveLength(1);

      cache.upsert(descriptionJudgment(sources, target, lowReference, 1));
      cache.upsert(descriptionJudgment(sources, target, highReference, 1));
      cache.upsert(descriptionJudgment(sources, target, previousReference, 1));
      const available = run();
      expect(available.ok).toBe(true);
      if (!available.ok) return;
      expect(available.value.fitness.get("target")?.score).toBe(6);
      expect(available.value.run.redundancyPairs).toHaveLength(3);
      expect(unavailable.value.run.isCalculationCurrent()).toBe(false);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
