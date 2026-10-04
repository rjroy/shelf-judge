import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Axis, Collection, DurableGame, WishlistEntry } from "@shelf-judge/shared";
import {
  createInitialSemanticRedundancyStateV10,
  WishlistBggSourceSnapshotSchema,
} from "@shelf-judge/shared";
import { WishlistEntryReadResultSchemaV2 } from "../../../shared/src/wishlist-current-projection-v2.js";
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
import { createPreparedSimilarity } from "../../src/services/prepared-similarity.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { computeUnifiedWishlistProjection } from "../../src/services/unified-wishlist-projection.js";
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
const bggSource = WishlistBggSourceSnapshotSchema.parse({
  observedAt: now,
  description: "Candidate game description",
  mechanics: ["Draft"],
  categories: ["Strategy"],
  weight: 2.5,
  communityRating: 7,
  minPlayers: 2,
  maxPlayers: 4,
  bestPlayers: 3,
  playingTime: 60,
});

function game(id: string, rating?: number): DurableGame {
  return {
    id,
    bggId: 100 + id.length,
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: rating === undefined ? {} : { personal: rating },
    createdAt: now,
    updatedAt: now,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
  } as unknown as DurableGame;
}

function sources(): StagedSimilaritySources {
  const initial = createInitialSemanticRedundancyStateV10();
  const semanticSettings = {
    ...initial.settings,
    enabled: true,
    cachedOwnerNoteUse: false,
    weights: { factual: 1, description: 2, ownerNote: 0 },
  };
  const semantic = {
    ...initial,
    settings: semanticSettings,
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
    id: "wishlist-stage-test",
    name: "Wishlist staged test",
    schemaVersion: 10,
    revision: 1,
    axes,
    games: [game("owned-target"), game("ref-four", 4), game("ref-eight", 8)],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: semantic,
    createdAt: now,
    updatedAt: now,
  } as unknown as Collection;
  const redundancy = {
    ...DEFAULT_REDUNDANCY_SETTINGS,
    enabled: true,
    similarityThreshold: 0,
    minNeighbors: 1,
    expectedNeighbors: 2,
    maxPenalty: 2,
    componentWeights: { binary: 1, continuous: 3 },
  };
  const similaritySettings = captureSimilaritySettings(redundancy, semanticSettings);
  const sourceVector = {
    available: true,
    unavailableSources: [],
    processEpoch: "wishlist-test-process",
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
  } as StagedSimilaritySources["sourceVector"];
  const wishlist = {
    id: "wishlist-1",
    bggId: 901,
    name: "Candidate",
    yearPublished: 2024,
    thumbnailUrl: null,
    predictedScore: 9,
    predictionConfidence: "strong" as const,
    predictedBreakdown: [{ axisName: "old", rating: 9, confidence: "strong" as const }],
    nicheImpact: { wouldJoin: [] },
    redundancyPreview: null,
    bggSource,
    addedAt: now,
  } satisfies WishlistEntry;
  return {
    collection,
    tournament: {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
      sessions: [],
      gameStats: {},
    },
    predictionSettings: { stageThresholds: [1, 2, 3], defaultK: 5, minSimilarityThreshold: 0 },
    similaritySettings,
    sourceVector,
    wishlistCandidates: [{ bggId: wishlist.bggId, name: wishlist.name, bggSource }],
  };
}

function derivedAxis(
  id: string,
  field: "communityRating" | "weight" | "playingTime",
  overrides: Partial<Axis> = {},
): Axis {
  return {
    id,
    name: id,
    description: null,
    weight: 1,
    enabled: true,
    source: "derived",
    derivedField: field,
    configuration: field === "playingTime" ? { maximumScoringTime: 60 } : {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Axis;
}

function descriptionJudgment(
  current: StagedSimilaritySources,
  left: { id: string; name: string; description: string },
  right: { id: string; name: string; description: string },
  value: number,
  domain: "collection" | "wishlist-candidate" = "collection",
): JevPairJudgment {
  const [gameAId, gameBId] = [left.id, right.id].sort();
  return {
    ...(domain === "wishlist-candidate" ? { pairDomain: domain } : {}),
    collectionId: current.collection.id,
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
      { gameId: left.id, name: left.name, description: left.description },
      { gameId: right.id, name: right.name, description: right.description },
    ),
  };
}

function projection(
  current: StagedSimilaritySources,
  cache: Parameters<typeof computeUnifiedWishlistProjection>[0]["cache"],
  entries: readonly WishlistEntry[],
) {
  const capture = captureStagedSimilaritySources(current, { readCurrent: () => current });
  const request = {
    scope: "wishlist" as const,
    selectedBggIds: entries.map((entry) => entry.bggId),
  };
  return computeUnifiedWishlistProjection({
    capture,
    cache,
    entries,
    budget,
    redundancySettings: {
      ...DEFAULT_REDUNDANCY_SETTINGS,
      enabled: true,
      similarityThreshold: 0,
      minNeighbors: 1,
      expectedNeighbors: 2,
      maxPenalty: 2,
      componentWeights: { binary: 1, continuous: 3 },
    },
    authorizationReader: {
      readCurrent: () => ({
        mutationGeneration: 1,
        policyIdentity: "wishlist-projection-test",
        selectionIdentity: stagedRunSelectionIdentity(request),
        budgetIdentity: stagedRunBudgetIdentity(budget),
      }),
    },
  });
}

describe("staged unified wishlist projection", () => {
  test("keeps a factual-vetoed candidate at ordering zero despite eligible similar owned games", async () => {
    const base = sources();
    const candidate = base.wishlistCandidates?.[0];
    if (!candidate) throw new Error("Wishlist source fixture missing");
    const entry: WishlistEntry = {
      id: "wishlist-veto",
      bggId: candidate.bggId,
      name: candidate.name,
      yearPublished: 2024,
      thumbnailUrl: null,
      predictedScore: 9,
      predictionConfidence: "strong",
      predictedBreakdown: null,
      nicheImpact: null,
      redundancyPreview: null,
      bggSource: candidate.bggSource,
      addedAt: now,
    };
    const axes = [
      derivedAxis("community", "communityRating"),
      derivedAxis("time-veto", "playingTime", {
        weight: 1,
        veto: { direction: "above", threshold: 30 },
      }),
    ];
    const current: StagedSimilaritySources = {
      ...base,
      collection: {
        ...base.collection,
        axes,
        games: base.collection.games.map((owned) => ({ ...owned, playingTime: 20 })),
      },
    };
    const directory = await mkdtemp(join(tmpdir(), "staged-wishlist-veto-neighbors-"));
    const cache = await createJevPairCache(directory);
    try {
      const candidateMember = encodeWishlistBggMember(current.collection.id, String(entry.bggId));
      for (const owned of current.collection.games) {
        const candidateSide = {
          id: candidateMember,
          name: entry.name,
          description: candidate.bggSource.description ?? "",
        };
        const ownedSide = {
          id: encodeOwnedLocalMember(current.collection.id, owned.id),
          name: owned.name,
          description: owned.bggData?.description ?? "",
        };
        const [left, right] = [candidateSide, ownedSide].sort((a, b) => a.id.localeCompare(b.id));
        cache.upsert(descriptionJudgment(current, left, right, 1, "wishlist-candidate"));
      }

      const capture = captureStagedSimilaritySources(current, { readCurrent: () => current });
      const prepared = createPreparedSimilarity({ capture, cache });
      const eligibleOwned = current.collection.games
        .map((owned) => ({
          owned,
          fitness: createFitnessService().calculateScore(owned, axes, current.tournament),
        }))
        .filter((item) => item.fitness !== null && !item.fitness.vetoed && item.fitness.score > 0);
      expect(eligibleOwned.length).toBeGreaterThan(0);
      const ownedReference = eligibleOwned[0];
      if (!ownedReference?.fitness) throw new Error("Expected a positive non-vetoed owned game");
      const vetoPair = {
        domain: "wishlist-candidate",
        candidateBggId: entry.bggId,
        ownedGameId: ownedReference.owned.id,
      } as const;
      prepared.resolvePairs([vetoPair]);
      const similarity = prepared.similarity(vetoPair);
      expect(prepared.evidence(vetoPair)).not.toBeNull();
      expect(similarity).toBe(1);
      expect(similarity).toBeGreaterThan(DEFAULT_REDUNDANCY_SETTINGS.similarityThreshold);

      const result = projection(current, cache, [entry])[0];
      if (!result || result.prediction.availability !== "available")
        throw new Error("Vetoed current prediction unavailable");
      expect(result.prediction.result).toMatchObject({ score: 0, vetoed: true });
      expect(result.redundancy).toEqual({
        source: "base-prediction",
        adjustment: null,
        orderingScore: 0,
      });
      expect(result.entry.predictedScore).toBe(0);
      expect(result.entry.redundancyPreview).toBeNull();
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("uses verified candidate facts for stage-0 scoring and preserves genuine factual veto zero", async () => {
    const current = sources();
    const candidate = current.wishlistCandidates?.[0];
    if (!candidate) throw new Error("Wishlist source fixture missing");
    current.collection.axes = [derivedAxis("community", "communityRating")];
    current.predictionSettings.stageThresholds = [2, 3, 4];
    const entry: WishlistEntry = {
      id: "wishlist-1",
      bggId: candidate.bggId,
      name: candidate.name,
      yearPublished: 2024,
      thumbnailUrl: null,
      predictedScore: 9,
      predictionConfidence: "strong",
      predictedBreakdown: null,
      nicheImpact: null,
      redundancyPreview: null,
      bggSource: candidate.bggSource,
      addedAt: now,
    };
    const directory = await mkdtemp(join(tmpdir(), "staged-wishlist-stage-zero-facts-"));
    const cache = await createJevPairCache(directory);
    try {
      const scored = projection(current, cache, [entry])[0];
      if (!scored || scored.prediction.availability !== "available")
        throw new Error("Candidate factual score unavailable");
      expect(scored.prediction.result.score).toBe(7);
      const communityBreakdown = scored.prediction.result.breakdown.find(
        (part) => part.axisId === "community",
      );
      expect(communityBreakdown?.source).toBe("derived");
      expect(communityBreakdown?.effectiveRating).toBe(7);
      expect(scored.prediction.predictionUnavailable).toEqual({
        reason: "stage-0",
        ratedGameCount: 0,
        gamesNeeded: 2,
      });
      const failedProjection = projection(current, cache, [{ ...entry, bggSource: undefined }])[0];
      expect(failedProjection?.prediction.availability).toBe("unavailable");
      expect(failedProjection?.prediction.predictionUnavailable).toEqual(
        scored.prediction.predictionUnavailable,
      );

      current.collection.axes = [
        derivedAxis("community", "communityRating"),
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
      const candidateMember = encodeWishlistBggMember(current.collection.id, String(entry.bggId));
      for (const [reference, value] of [
        [current.collection.games[1], 0.5],
        [current.collection.games[2], 1],
      ] as const) {
        if (!reference) throw new Error("Candidate reference fixture missing");
        const candidateSide = {
          id: candidateMember,
          name: entry.name,
          description: bggSource.description ?? "",
        };
        const ownedSide = {
          id: encodeOwnedLocalMember(current.collection.id, reference.id),
          name: reference.name,
          description: reference.bggData?.description ?? "",
        };
        cache.upsert(
          descriptionJudgment(current, candidateSide, ownedSide, value, "wishlist-candidate"),
        );
      }
      const mixed = projection(current, cache, [entry])[0];
      if (!mixed || mixed.prediction.availability !== "available")
        throw new Error("Mixed actual/predicted candidate score unavailable");
      expect(mixed.prediction.result.predictionMeta).toMatchObject({
        actualAxisCount: 1,
        predictedAxisCount: 1,
      });
      expect(mixed.prediction.result.breakdown.some((part) => part.source === "derived")).toBe(
        true,
      );
      expect(mixed.prediction.result.breakdown.some((part) => part.source === "predicted")).toBe(
        true,
      );

      current.collection.axes = [
        derivedAxis("community", "communityRating"),
        derivedAxis("time-veto", "playingTime", {
          weight: 1,
          veto: { direction: "above", threshold: 30 },
        }),
      ];
      const vetoed = projection(current, cache, [entry])[0];
      if (!vetoed || vetoed.prediction.availability !== "available")
        throw new Error("Candidate factual veto was treated as unavailable");
      expect(vetoed.prediction.result).toMatchObject({ score: 0, vetoed: true });
      expect(vetoed.redundancy.orderingScore).toBe(0);

      const noFacts = structuredClone(candidate.bggSource);
      noFacts.communityRating = null;
      noFacts.weight = null;
      noFacts.minPlayers = null;
      noFacts.maxPlayers = null;
      noFacts.bestPlayers = null;
      noFacts.playingTime = null;
      const noFactsCurrent = {
        ...current,
        wishlistCandidates: [{ ...candidate, bggSource: noFacts }],
      };
      const absentEntry = { ...entry, bggSource: noFacts };
      const unavailable = projection(noFactsCurrent, cache, [absentEntry])[0];
      expect(unavailable?.prediction).toMatchObject({
        availability: "unavailable",
        reason: "no-scoring-contribution",
        result: null,
      });
      expect(unavailable?.entry.predictedScore).toBeNull();
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("uses one SQLite cache-only P/S/R run, current aliases, and no storage mutation", async () => {
    const current = sources();
    const [ownedTarget, refFour, refEight] = current.collection.games;
    if (!ownedTarget || !refFour || !refEight) throw new Error("Collection fixture missing");
    const entry: WishlistEntry = {
      id: "wishlist-1",
      bggId: 901,
      name: "Candidate",
      yearPublished: 2024,
      thumbnailUrl: null,
      predictedScore: 9,
      predictionConfidence: "strong",
      predictedBreakdown: [{ axisName: "old", rating: 9, confidence: "strong" }],
      nicheImpact: { wouldJoin: [] },
      redundancyPreview: null,
      bggSource,
      addedAt: now,
    };
    const originalIdentity = canonicalSha256({ collection: current.collection, entry });
    const candidateMember = encodeWishlistBggMember(current.collection.id, String(entry.bggId));
    const directory = await mkdtemp(join(tmpdir(), "staged-wishlist-projection-"));
    const cache = await createJevPairCache(directory);
    try {
      const ownedDescription = (game: DurableGame) => ({
        id: game.id,
        name: game.name,
        description: game.bggData?.description ?? "",
      });
      for (const [owned, value] of [
        [refFour, 0],
        [refEight, 1],
      ] as const) {
        const source = {
          id: candidateMember,
          name: entry.name,
          description: bggSource.description ?? "",
        };
        const ownedSource = {
          ...ownedDescription(owned),
          id: encodeOwnedLocalMember(current.collection.id, owned.id),
        };
        const [a, b] = [source, ownedSource].sort((left, right) => left.id.localeCompare(right.id));
        cache.upsert(descriptionJudgment(current, a, b, value, "wishlist-candidate"));
      }
      const ownedTargetRow = (reference: DurableGame, value: number) => {
        const pair = [ownedDescription(ownedTarget), ownedDescription(reference)].sort((a, b) =>
          a.id.localeCompare(b.id),
        );
        const [left, right] = pair;
        if (!left || !right) throw new Error("Collection pair fixture missing");
        cache.upsert(descriptionJudgment(current, left, right, value));
      };
      ownedTargetRow(refFour, 0);
      ownedTargetRow(refEight, 1);

      const first = projection(current, cache, [entry]);
      expect(first).toHaveLength(1);
      const initial = first[0];
      if (!initial || initial.prediction.availability !== "available")
        throw new Error("Current prediction unavailable");
      expect(initial.entry.predictedScore).toBe(initial.prediction.result.score);
      expect(initial.entry.predictionConfidence).toBe(
        initial.prediction.result.predictionMeta?.confidence ?? null,
      );
      expect(initial.entry.predictedBreakdown?.map((axis) => axis.rating)).toEqual(
        initial.prediction.result.breakdown.flatMap((axis) =>
          axis.effectiveRating === null ? [] : [axis.effectiveRating],
        ),
      );
      expect(initial.redundancy.source).toBe("current");
      expect(initial.redundancy.adjustment?.originalScore ?? null).toBe(
        initial.prediction.result.score,
      );
      expect(initial.redundancy.orderingScore).toBe(
        initial.redundancy.adjustment?.adjustedScore ?? null,
      );
      expect(initial.entry.predictedScore).not.toBe(9);
      expect(initial.entry.predictedBreakdown?.[0]?.axisName).not.toBe("old");
      expect("bggSource" in initial.entry).toBe(false);
      expect(JSON.stringify(initial)).not.toContain("Candidate game description");
      expect(WishlistEntryReadResultSchemaV2.safeParse(initial).success).toBe(true);
      expect(canonicalSha256({ collection: current.collection, entry })).toBe(originalIdentity);
      expect(cache.available).toBe(true);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reuses factual-only prediction when C is absent and marks missing facts unavailable, never saved fallback", async () => {
    const current = sources();
    const entry: WishlistEntry = {
      id: "wishlist-1",
      bggId: 901,
      name: "Candidate",
      yearPublished: 2024,
      thumbnailUrl: null,
      predictedScore: 9,
      predictionConfidence: "strong",
      predictedBreakdown: [{ axisName: "old", rating: 9, confidence: "strong" }],
      nicheImpact: { wouldJoin: [] },
      redundancyPreview: null,
      bggSource,
      addedAt: now,
    };
    const missingSource = {
      ...entry,
      id: "wishlist-2",
      bggId: 902,
      name: "No source",
      bggSource: undefined,
    };
    const directory = await mkdtemp(join(tmpdir(), "staged-wishlist-factual-only-"));
    const cache = await createJevPairCache(directory);
    try {
      const result = projection(current, cache, [entry, missingSource]);
      expect(result[0]?.prediction.availability).toBe("available");
      expect(result[0]?.redundancy.adjustment?.originalScore ?? null).toBe(
        result[0]?.prediction.availability === "available"
          ? result[0].prediction.result.score
          : null,
      );
      expect(result[1]?.prediction).toMatchObject({
        availability: "unavailable",
        reason: "missing-source",
        result: null,
      });
      expect(result[1]?.entry.predictedScore).toBeNull();
      expect(result[1]?.entry.predictionConfidence).toBeNull();
      expect(result[1]?.entry.predictedBreakdown).toBeNull();
      expect(result[1]?.redundancy).toEqual({
        source: "unavailable",
        adjustment: null,
        orderingScore: null,
      });
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("cache judgment changes recalculate current score and adjustment without changing facts", async () => {
    const current = sources();
    const [ownedTarget, refFour, refEight] = current.collection.games;
    if (!ownedTarget || !refFour || !refEight) throw new Error("Collection fixture missing");
    const entry: WishlistEntry = {
      id: "wishlist-1",
      bggId: 901,
      name: "Candidate",
      yearPublished: 2024,
      thumbnailUrl: null,
      predictedScore: 9,
      predictionConfidence: "strong",
      predictedBreakdown: null,
      nicheImpact: null,
      redundancyPreview: null,
      bggSource,
      addedAt: now,
    };
    const sourceIdentity = canonicalSha256({ entry, collection: current.collection });
    const directory = await mkdtemp(join(tmpdir(), "staged-wishlist-cache-change-"));
    const cache = await createJevPairCache(directory);
    try {
      const before = projection(current, cache, [entry])[0];
      if (!before || before.prediction.availability !== "available")
        throw new Error("Factual current result unavailable");
      const candidateMember = encodeWishlistBggMember(current.collection.id, String(entry.bggId));
      for (const owned of [refFour, refEight]) {
        const left = {
          id: candidateMember,
          name: entry.name,
          description: bggSource.description ?? "",
        };
        const right = {
          id: encodeOwnedLocalMember(current.collection.id, owned.id),
          name: owned.name,
          description: owned.bggData?.description ?? "",
        };
        const pair = [left, right].sort((a, b) => a.id.localeCompare(b.id));
        const [candidateSource, ownedSource] = pair;
        if (!candidateSource || !ownedSource) throw new Error("Candidate pair fixture missing");
        cache.upsert(
          descriptionJudgment(
            current,
            candidateSource,
            ownedSource,
            owned.id === refEight.id ? 1 : 0,
            "wishlist-candidate",
          ),
        );
      }
      const after = projection(current, cache, [entry])[0];
      if (!after || after.prediction.availability !== "available")
        throw new Error("Cache-updated current result unavailable");
      expect(after.prediction.result.score).not.toBe(before.prediction.result.score);
      expect(after.entry.predictedScore).toBe(after.prediction.result.score);
      expect(after.redundancy.source).toBe("current");
      expect(after.redundancy.adjustment?.originalScore ?? null).toBe(
        after.prediction.result.score,
      );
      expect(canonicalSha256({ entry, collection: current.collection })).toBe(sourceIdentity);
    } finally {
      cache.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
