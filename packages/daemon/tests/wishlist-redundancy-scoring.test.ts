import { describe, expect, test } from "bun:test";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyStateV10,
  type Collection,
  type DurableGame,
  type FitnessResult,
  type Game,
  type RedundancyAdjustment,
  type RedundancySettings,
  type WishlistEntry,
  WishlistBggSourceSnapshotSchema,
} from "@shelf-judge/shared";
import { computeWishlistRedundancyReadResults } from "../src/services/wishlist-redundancy-scoring.js";
import type {
  WishlistDescriptionPairRequest,
  WishlistDescriptionSignalResolver,
} from "../src/services/wishlist-redundancy-scoring.js";
import {
  composeRedundancySignals,
  DEFAULT_REDUNDANCY_SETTINGS,
} from "../src/services/redundancy-engine.js";

const observedAt = "2026-10-03T00:00:00.000Z";

function makeGame(
  id: string,
  options: {
    bggId?: number | null;
    name?: string;
    ownership?: Game["ownership"];
    score?: number | null;
    vetoed?: boolean;
    bggData?: Game["bggData"];
    minPlayers?: number | null;
    maxPlayers?: number | null;
    bestPlayers?: number | null;
    playingTime?: number | null;
  } = {},
): DurableGame {
  return {
    id,
    bggId: options.bggId ?? null,
    entityMetadata: createInitialEntityMetadata(options.bggId ?? null),
    latestPlayCountCheck: null,
    name: options.name ?? id,
    yearPublished: 2020,
    minPlayers: options.minPlayers ?? 2,
    maxPlayers: options.maxPlayers ?? 4,
    bestPlayers: options.bestPlayers ?? 3,
    playingTime: options.playingTime ?? 60,
    imageUrl: null,
    bggData: options.bggData ?? makeBggData(["Shared"], ["Strategy"]),
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
    ownership: options.ownership ?? "owned",
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

function makeBggData(mechanics: string[], categories: string[], description = "Owned prose") {
  return {
    communityRating: 7,
    bayesAverage: 7,
    weight: 2.5,
    numWeightVotes: 1,
    description,
    mechanics: mechanics.map((name, index) => ({ id: index + 1, name })),
    categories: categories.map((name, index) => ({ id: index + 1, name })),
    families: [],
    subdomains: [],
    bestPlayerCount: null,
    fetchedAt: observedAt,
  };
}

function makeScore(
  score: number | null,
  options: { vetoed?: boolean; predicted?: boolean } = {},
): FitnessResult | null {
  if (score === null) return null;
  return {
    score,
    ratedAxisCount: options.predicted ? 0 : 1,
    totalAxisCount: 1,
    breakdown: [],
    vetoed: options.vetoed ?? false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: options.predicted
      ? {
          readinessStage: 2,
          confidence: "moderate",
          predictedAxisCount: 1,
          actualAxisCount: 0,
          referenceGameCount: 2,
          coveragePercent: 100,
        }
      : null,
    redundancyAdjustment: null,
  };
}

function makeEntry(
  bggId: number,
  options: {
    predictedScore?: number | null;
    withSource?: boolean;
    saved?: number | null;
    mechanics?: string[];
    categories?: string[];
    description?: string | null;
    minPlayers?: number | null;
    maxPlayers?: number | null;
  } = {},
): WishlistEntry {
  const entry: WishlistEntry = {
    id: `entry-${bggId}`,
    bggId,
    name: `Candidate ${bggId}`,
    yearPublished: 2020,
    thumbnailUrl: null,
    predictedScore: options.predictedScore === undefined ? 5 : options.predictedScore,
    predictionConfidence: "moderate",
    predictedBreakdown: null,
    nicheImpact: null,
    redundancyPreview:
      options.saved === undefined || options.saved === null
        ? null
        : makeAdjustment(options.saved, 2),
    addedAt: observedAt,
  };
  if (options.withSource === false) return entry;
  entry.bggSource = {
    observedAt,
    description: options.description === undefined ? "Candidate prose" : options.description,
    mechanics: options.mechanics ?? ["Shared"],
    categories: options.categories ?? ["Strategy"],
    weight: 2.5,
    communityRating: 7,
    minPlayers: options.minPlayers ?? 2,
    maxPlayers: options.maxPlayers ?? 4,
    bestPlayers: 3,
    playingTime: 60,
  };
  return entry;
}

function makeAdjustment(adjustedScore: number, originalScore: number): RedundancyAdjustment {
  return {
    penalty: originalScore - adjustedScore,
    originalScore,
    adjustedScore,
    nicheNeighbors: [],
    nicheRank: 1,
    nicheSize: 0,
  };
}

function makeCollection(games: DurableGame[]): Collection {
  const semanticRedundancy = createInitialSemanticRedundancyStateV10();
  semanticRedundancy.settings = {
    enabled: true,
    weights: { factual: 1, description: 1, ownerNote: 99 },
    cachedOwnerNoteUse: false,
  };
  return {
    schemaVersion: 10,
    revision: 1,
    id: "collection-1",
    name: "Collection",
    axes: [],
    games,
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy,
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

function makeScoringSettings(overrides: Partial<RedundancySettings> = {}): RedundancySettings {
  return {
    ...DEFAULT_REDUNDANCY_SETTINGS,
    enabled: true,
    similarityThreshold: 0.5,
    expectedNeighbors: 1,
    maxPenalty: 2,
    ...overrides,
  };
}

function makeInput(
  entries: WishlistEntry[],
  games: DurableGame[],
  overrides: Partial<RedundancySettings> = {},
  scoredOverrides: Record<string, FitnessResult | null> = {},
) {
  const collection = makeCollection(games);
  return {
    entries,
    collection,
    scoredGames: games.map((game) => ({
      game,
      score: Object.hasOwn(scoredOverrides, game.id)
        ? (scoredOverrides[game.id] ?? null)
        : makeScore(8, { predicted: true }),
    })),
    redundancySettings: makeScoringSettings(overrides),
  };
}

function resolvePairs(
  resolvePair: (pair: WishlistDescriptionPairRequest) => number | null,
): WishlistDescriptionSignalResolver {
  return ({ pairs }) => Promise.resolve(pairs.map(resolvePair));
}

describe("wishlist candidate redundancy scoring", () => {
  test("composes F and C with exact available-weight denominators; valid C=0 counts", async () => {
    expect(
      composeRedundancySignals(
        { factual: 1, description: 0, ownerNote: null },
        { factual: 1, description: 0, ownerNote: 0 },
      ),
    ).toBe(1);
    expect(
      composeRedundancySignals(
        { factual: 1, description: 0.5, ownerNote: null },
        { factual: 1, description: 1, ownerNote: 0 },
      ),
    ).toBe(0.75);
    expect(
      composeRedundancySignals(
        { factual: 1, description: 0, ownerNote: null },
        { factual: 3, description: 1, ownerNote: 0 },
      ),
    ).toBe(0.75);
    expect(
      composeRedundancySignals(
        { factual: 1, description: null, ownerNote: null },
        { factual: 1, description: 3, ownerNote: 0 },
      ),
    ).toBe(1);
    expect(
      composeRedundancySignals(
        { factual: 1, description: 0, ownerNote: null },
        { factual: 0, description: 1, ownerNote: 0 },
      ),
    ).toBe(0);
    expect(
      composeRedundancySignals(
        { factual: 0, description: null, ownerNote: null },
        { factual: 0, description: 0, ownerNote: 0 },
      ),
    ).toBeNull();

    const owner = makeGame("owned-1");
    const input = makeInput([makeEntry(100)], [owner]);
    input.collection.semanticRedundancy.settings.weights = {
      factual: 3,
      description: 1,
      ownerNote: 50,
    };
    const result = await computeWishlistRedundancyReadResults({
      ...input,
      resolveDescriptionSignal: resolvePairs(() => 0),
    });
    expect(result[0].redundancy.source).toBe("current");
    expect(result[0].redundancy.adjustment?.nicheNeighbors[0]?.similarity).toBe(0.75);
    expect(result[0].redundancy.adjustment?.penalty).toBe(2);
    expect(result[0].redundancy.adjustment?.adjustedScore).toBe(3);
  });

  test("disabled and zero-weight signals do not fabricate a current blend", async () => {
    const owner = makeGame("owned-1");
    const factualOnlyInput = makeInput([makeEntry(99)], [owner]);
    factualOnlyInput.collection.semanticRedundancy.settings.weights = {
      factual: 7,
      description: 0,
      ownerNote: 0,
    };
    const factualOnly = await computeWishlistRedundancyReadResults(factualOnlyInput);
    expect(factualOnly[0].redundancy.source).toBe("current");
    expect(factualOnly[0].redundancy.adjustment?.nicheNeighbors[0]?.similarity).toBe(1);
    expect(factualOnly[0].redundancy.adjustment?.penalty).toBe(2);

    const input = makeInput([makeEntry(100, { saved: 6 })], [owner]);
    input.collection.semanticRedundancy.settings.enabled = false;
    input.collection.semanticRedundancy.settings.weights = {
      factual: 0,
      description: 1,
      ownerNote: 0,
    };
    const result = await computeWishlistRedundancyReadResults({
      ...input,
      resolveDescriptionSignal: resolvePairs(() => 1),
    });
    expect(result[0].redundancy.source).toBe("saved-factual");
    expect(result[0].redundancy.orderingScore).toBe(6);

    input.collection.semanticRedundancy.settings.enabled = true;
    input.collection.semanticRedundancy.settings.weights = {
      factual: 0,
      description: 0,
      ownerNote: 100,
    };
    const noSignals = await computeWishlistRedundancyReadResults({
      ...input,
      resolveDescriptionSignal: resolvePairs(() => 1),
    });
    expect(noSignals[0].redundancy.source).toBe("saved-factual");
  });

  test("heterogeneous pairs omit unavailable C, while matching eligibility excludes ineligible games", async () => {
    const owner1 = makeGame("owned-1", { name: "Better" });
    const owner2 = makeGame("owned-2", { name: "Lower" });
    const previous = makeGame("previous", { ownership: "previously-owned", score: 9 });
    const vetoed = makeGame("vetoed", { score: 9 });
    const nullScore = makeGame("null-score", { score: null });
    const nonpositive = makeGame("nonpositive", { score: 0 });
    const input = makeInput(
      [makeEntry(100)],
      [owner1, owner2, previous, vetoed, nullScore, nonpositive],
      {},
      {
        "owned-1": makeScore(9),
        "owned-2": makeScore(4),
        previous: makeScore(9),
        vetoed: makeScore(9, { vetoed: true }),
        "null-score": null,
        nonpositive: makeScore(0),
      },
    );
    const pairs: string[] = [];
    let descriptionCaptures = 0;
    input.collection.semanticRedundancy.settings.weights = {
      factual: 1,
      description: 1,
      ownerNote: 0,
    };
    const results = await computeWishlistRedundancyReadResults({
      ...input,
      resolveDescriptionSignal: ({
        collectionId,
        candidateBggIds,
        eligibleOwnedIds,
        semanticPolicy,
        pairs: requestedPairs,
      }) => {
        descriptionCaptures++;
        expect(collectionId).toBe("collection-1");
        expect(requestedPairs.map((pair) => pair.ownedGame.id)).toEqual(["owned-1", "owned-2"]);
        expect(candidateBggIds).toEqual([100]);
        expect(eligibleOwnedIds).toEqual(["owned-1", "owned-2"]);
        expect(requestedPairs[0]?.ownedGame).not.toHaveProperty("ownerNote");
        expect(semanticPolicy).toEqual({
          enabled: true,
          weights: { factual: 1, description: 1 },
        });
        return Promise.resolve([0.2, null]);
      },
      observer: { onCandidateOwnedPair: (_candidateId, ownerId) => pairs.push(ownerId) },
    });
    expect(pairs).toEqual(["owned-1", "owned-2"]);
    expect(descriptionCaptures).toBe(1);
    expect(results[0].redundancy.source).toBe("current");
    expect(
      results[0].redundancy.adjustment?.nicheNeighbors.map((neighbor) => neighbor.gameId),
    ).toEqual(["owned-2", "owned-1"]);
    expect(results[0].redundancy.adjustment?.nicheNeighbors[0]?.similarity).toBe(1);
    expect(results[0].redundancy.adjustment?.nicheNeighbors[1]?.similarity).toBe(0.6);
  });

  test("an ineligible BGG game changes factual vocabulary/ranges but is never a neighbor", async () => {
    const candidate = makeEntry(100, {
      mechanics: ["Shared", "Vocabulary from noneligible game"],
      maxPlayers: 8,
    });
    const owner = makeGame("owned", { maxPlayers: 4 });
    const unscored = makeGame("normalization-only", {
      score: null,
      ownership: "previously-owned",
      maxPlayers: 12,
      bggData: makeBggData(["Vocabulary from noneligible game"], ["Rare category"]),
    });
    const withSource = await computeWishlistRedundancyReadResults({
      ...makeInput([candidate], [owner, unscored], { similarityThreshold: 0.01 }),
    });
    const withoutSource = await computeWishlistRedundancyReadResults({
      ...makeInput([candidate], [owner], { similarityThreshold: 0.01 }),
    });
    expect(withSource[0].redundancy.source).toBe("current");
    expect(withoutSource[0].redundancy.source).toBe("current");
    expect(withSource[0].redundancy.adjustment?.nicheNeighbors).toHaveLength(1);
    expect(withSource[0].redundancy.adjustment?.nicheNeighbors[0]?.gameId).toBe("owned");
    expect(withSource[0].redundancy.adjustment?.nicheNeighbors[0]?.similarity).not.toBe(
      withoutSource[0].redundancy.adjustment?.nicheNeighbors[0]?.similarity,
    );
  });

  test("one capture builds one factual context, memoizes vectors, and visits only candidate-owned pairs", async () => {
    const owners = [makeGame("owned-1"), makeGame("owned-2"), makeGame("owned-3")];
    const candidates = [makeEntry(100), makeEntry(101), makeEntry(102), makeEntry(103)];
    const counters = {
      ownedIndexBuilds: 0,
      contextVocabulary: 0,
      ranges: 0,
      encodes: [] as string[],
      pairs: [] as string[],
    };
    const results = await computeWishlistRedundancyReadResults({
      ...makeInput(candidates, owners),
      observer: {
        onEligibleOwnedIndexBuilt: (count) => {
          counters.ownedIndexBuilds++;
          expect(count).toBe(3);
        },
        onFactualVocabularyBuilt: () => counters.contextVocabulary++,
        onFactualRangesBuilt: () => counters.ranges++,
        onFactualVectorEncoded: (gameId) => counters.encodes.push(gameId),
        onCandidateOwnedPair: (candidateId, ownerId) =>
          counters.pairs.push(`${candidateId}:${ownerId}`),
      },
    });
    expect(results).toHaveLength(4);
    expect(counters.ownedIndexBuilds).toBe(1);
    expect(counters.contextVocabulary).toBe(1);
    expect(counters.ranges).toBe(1);
    expect(counters.pairs).toHaveLength(12);
    expect(new Set(counters.pairs).size).toBe(12);
    expect(counters.encodes).toHaveLength(7);
    expect(new Set(counters.encodes)).toEqual(
      new Set([
        "owned-1",
        "owned-2",
        "owned-3",
        '["wishlist-bgg",100]',
        '["wishlist-bgg",101]',
        '["wishlist-bgg",102]',
        '["wishlist-bgg",103]',
      ]),
    );
  });

  test("candidate and local IDs cannot collide in the factual-vector memo", async () => {
    const bggId = 900;
    const sameStringAsCandidateIdentity = JSON.stringify(["wishlist-bgg", bggId]);
    const owner = makeGame(sameStringAsCandidateIdentity);
    const encoded: string[] = [];
    const results = await computeWishlistRedundancyReadResults({
      ...makeInput([makeEntry(bggId)], [owner]),
      observer: { onFactualVectorEncoded: (gameId) => encoded.push(gameId) },
    });
    expect(results[0].redundancy.source).toBe("current");
    expect(encoded).toEqual([sameStringAsCandidateIdentity, sameStringAsCandidateIdentity]);
  });

  test("no-neighbor yields a current zero penalty; absent source falls back saved then base", async () => {
    const current = await computeWishlistRedundancyReadResults({
      ...makeInput([makeEntry(100, { saved: 2 })], []),
    });
    expect(current[0].redundancy.source).toBe("current");
    expect(current[0].redundancy.adjustment?.penalty).toBe(0);
    expect(current[0].redundancy.adjustment?.adjustedScore).toBe(5);

    let legacyResolverCalls = 0;
    const legacySaved = await computeWishlistRedundancyReadResults({
      ...makeInput([makeEntry(101, { withSource: false, saved: 3 })], [makeGame("owned")]),
      resolveDescriptionSignal: () => {
        legacyResolverCalls++;
        return Promise.resolve([1]);
      },
    });
    expect(legacySaved[0].redundancy.source).toBe("saved-factual");
    expect(legacySaved[0].redundancy.orderingScore).toBe(3);
    expect(legacyResolverCalls).toBe(0);

    const legacyBase = await computeWishlistRedundancyReadResults({
      ...makeInput([makeEntry(102, { withSource: false, saved: null })], [makeGame("owned")]),
    });
    expect(legacyBase[0].redundancy.source).toBe("base-prediction");
    expect(legacyBase[0].redundancy.orderingScore).toBe(5);
  });

  test("a wishlist BGG ID already present in the collection is excluded from candidate comparisons", async () => {
    const acquired = makeGame("owned-same-bgg", { bggId: 100 });
    const input = makeInput([makeEntry(100, { saved: 4 })], [acquired]);
    const result = await computeWishlistRedundancyReadResults(input);
    expect(result[0].redundancy.source).toBe("saved-factual");
    expect(result[0].redundancy.orderingScore).toBe(4);
  });

  test("current adjustment uses base score once and never mutates saved snapshots or exposes source", async () => {
    const entry = makeEntry(100, { saved: 2, predictedScore: 5 });
    const before = JSON.stringify(entry);
    const result = await computeWishlistRedundancyReadResults({
      ...makeInput([entry], [makeGame("owned")]),
      resolveDescriptionSignal: resolvePairs(() => null),
    });
    expect(result[0].redundancy.source).toBe("current");
    expect(result[0].redundancy.adjustment?.originalScore).toBe(5);
    expect(result[0].redundancy.adjustment?.adjustedScore).toBe(3);
    expect(result[0].entry).not.toHaveProperty("bggSource");
    expect(JSON.stringify(entry)).toBe(before);
    expect(entry.predictedScore).toBe(5);
    expect(entry.redundancyPreview?.adjustedScore).toBe(2);
  });

  test("invalid or unavailable C falls back to F, while unusable signals use saved adjustment", async () => {
    const owner = makeGame("owned");
    const factualFallback = await computeWishlistRedundancyReadResults({
      ...makeInput([makeEntry(100, { saved: 2 })], [owner]),
      resolveDescriptionSignal: () => Promise.reject(new Error("cache proof unavailable")),
    });
    expect(factualFallback[0].redundancy.source).toBe("current");
    expect(factualFallback[0].redundancy.adjustment?.nicheNeighbors[0]?.similarity).toBe(1);

    const unavailableInput = makeInput([makeEntry(101, { saved: 2, description: null })], [owner]);
    unavailableInput.collection.semanticRedundancy.settings.weights = {
      factual: 0,
      description: 1,
      ownerNote: 0,
    };
    const noUsablePair = await computeWishlistRedundancyReadResults(unavailableInput);
    expect(noUsablePair[0].redundancy.source).toBe("saved-factual");
  });

  test("drops C after a failed final cache fence without rebuilding factual context", async () => {
    const owner = makeGame("owned-final-fence");
    const input = makeInput([makeEntry(100)], [owner]);
    const vocabulary: number[] = [];
    const ranges: number[] = [];
    const validations: boolean[] = [];
    const result = await computeWishlistRedundancyReadResults({
      ...input,
      resolveDescriptionSignal: resolvePairs(() => 1),
      observer: {
        onFactualVocabularyBuilt: () => vocabulary.push(1),
        onFactualRangesBuilt: () => ranges.push(1),
      },
      validateCaptureBeforePublish: (_request, usedDescriptionSignal) => {
        validations.push(usedDescriptionSignal);
        return Promise.resolve(validations.length === 1 ? "cache-changed" : "current");
      },
    });

    const factualOnly = await computeWishlistRedundancyReadResults({
      ...input,
      resolveDescriptionSignal: () => Promise.resolve([null]),
    });
    expect(result[0]?.redundancy).toEqual(factualOnly[0]?.redundancy);
    expect(result[0]?.redundancy.source).toBe("current");
    expect(validations).toEqual([true, false]);
    expect(vocabulary).toHaveLength(1);
    expect(ranges).toHaveLength(1);
  });

  test("reloaded compact source reproduces F and source text is never returned", async () => {
    const original = makeEntry(100);
    const raw: unknown = JSON.parse(JSON.stringify(original));
    if (typeof raw !== "object" || raw === null || !("bggSource" in raw)) {
      throw new Error("Serialized wishlist fixture lost its source");
    }
    const persisted: WishlistEntry = {
      ...original,
      bggSource: WishlistBggSourceSnapshotSchema.parse(raw.bggSource),
    };
    const owner = makeGame("owned");
    const first = await computeWishlistRedundancyReadResults({
      ...makeInput([original], [owner]),
    });
    const offline = await computeWishlistRedundancyReadResults({
      ...makeInput([persisted], [owner]),
    });
    expect(offline[0].redundancy).toEqual(first[0].redundancy);
    expect(JSON.stringify(offline[0])).not.toContain("Candidate prose");
  });
});
