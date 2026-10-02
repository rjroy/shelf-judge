import { describe, expect, test } from "bun:test";
import {
  computeRedundancyAdjustments,
  computeRedundancyAnalysis,
  factualSimilarity,
  flattenWeighted,
  DEFAULT_REDUNDANCY_SETTINGS,
} from "../src/services/redundancy-engine";
import type { FitnessResult, GameWithScore, Game, RedundancySettings } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import type { FeatureVector } from "../src/services/feature-vector";
import { cosineSimilarity } from "../src/services/feature-vector";
import {
  buildVocabulary,
  computeContinuousRanges,
  encodeGame,
} from "../src/services/feature-vector";
import { createRedundancyFactualContext } from "../src/services/redundancy-factual";
import type { RedundancyPairTable } from "../src/services/redundancy-engine";

// --- Fixture helpers ---

function makeGame(id: string, name: string): Game {
  return {
    id,
    bggId: null,
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeScore(
  score: number,
  options: { vetoed?: boolean; predictedOnly?: boolean } = {},
): FitnessResult {
  return {
    score: options.vetoed ? 0 : score,
    ratedAxisCount: options.predictedOnly ? 0 : 3,
    totalAxisCount: 5,
    breakdown: [],
    vetoed: options.vetoed ?? false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: options.predictedOnly
      ? {
          readinessStage: 2,
          confidence: "moderate",
          predictedAxisCount: 3,
          actualAxisCount: 0,
          referenceGameCount: 5,
          coveragePercent: 60,
        }
      : null,
    redundancyAdjustment: null,
  };
}

function makeGws(game: Game, score: FitnessResult | null): GameWithScore {
  return { game, score };
}

// Known feature vectors for deterministic similarity results.
// Using simple vectors where cosine similarity is easy to compute.
const vectors: Record<string, FeatureVector> = {
  // Games A and B are very similar (identical binary/continuous, similar axes)
  a: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.9, 0.7] },
  b: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.85, 0.75] },
  // Game C somewhat similar to A/B
  c: { binary: [1, 0, 1, 0], continuous: [0.7, 0.5], personalAxes: [0.8, 0.6] },
  // Game D very different from A/B
  d: { binary: [0, 0, 1, 1], continuous: [0.2, 0.9], personalAxes: [0.1, 0.3] },
  // Game E similar to A/B but no personal axes
  e: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: null },
  // Game F: vetoed
  f: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.9, 0.7] },
};

function getVector(game: Game): FeatureVector {
  return vectors[game.id] ?? { binary: [0, 0, 0, 0], continuous: [0, 0], personalAxes: null };
}

function enabledSettings(overrides: Partial<RedundancySettings> = {}): RedundancySettings {
  return {
    ...DEFAULT_REDUNDANCY_SETTINGS,
    enabled: true,
    similarityThreshold: 0.5,
    ...overrides,
  };
}

describe("flattenWeighted", () => {
  test("uses factual components only even when the vector has personal axes", () => {
    const vec: FeatureVector = { binary: [1, 0], continuous: [0.5], personalAxes: [0.8] };
    const weights = { binary: 0.4, continuous: 0.3 };
    const flat = flattenWeighted(vec, weights);
    expect(flat).toHaveLength(3); // 2 binary + 1 continuous, no personalAxes
  });

  test("personal axes do not change factual weights", () => {
    const vec: FeatureVector = { binary: [1, 0], continuous: [0.5], personalAxes: null };
    const weights = { binary: 4, continuous: 3 };
    expect(flattenWeighted(vec, weights)).toEqual(
      flattenWeighted({ ...vec, personalAxes: [0, 1] }, weights),
    );
  });
});

describe("createRedundancyFactualContext", () => {
  test("matches the existing factual-vector calculation exactly, across the full collection", () => {
    const first: Game = {
      ...makeGame("factual-a", "A"),
      minPlayers: 2,
      maxPlayers: 4,
      playingTime: 30,
      bggData: {
        communityRating: 7.3,
        bayesAverage: 7.1,
        weight: 2.4,
        numWeightVotes: 10,
        description: null,
        mechanics: [{ id: 1, name: "Drafting" }],
        categories: [{ id: 1, name: "Cards" }],
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: "2026-01-01T00:00:00Z",
      },
      ratings: { personal: 1 },
    };
    const second: Game = {
      ...makeGame("factual-b", "B"),
      minPlayers: 4,
      maxPlayers: 6,
      playingTime: 90,
      bggData: {
        communityRating: 8.1,
        bayesAverage: 7.9,
        weight: 3.8,
        numWeightVotes: 10,
        description: null,
        mechanics: [{ id: 2, name: "Set Collection" }],
        categories: [{ id: 2, name: "Strategy" }],
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: "2026-01-01T00:00:00Z",
      },
      ratings: { personal: 10 },
    };
    // This previously-owned, noneligible entry changes range normalization and
    // vocabulary even though it is not one of the compared pair.
    const rangeChanger: Game = {
      ...makeGame("range-changer", "Previously owned"),
      ownership: "previously-owned",
      // This BGG outlier expands the max-player range beyond both pair members.
      minPlayers: 1,
      maxPlayers: 12,
      playingTime: 300,
      bggData: {
        communityRating: 5,
        bayesAverage: 5,
        weight: 1,
        numWeightVotes: 10,
        description: null,
        mechanics: [{ id: 3, name: "Worker Placement" }],
        categories: [{ id: 3, name: "Previously Owned" }],
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    };
    const collection = [first, second, rangeChanger];
    const weights = { binary: 4 / 7, continuous: 3 / 7 };
    const context = createRedundancyFactualContext(collection, weights);
    const vocabulary = buildVocabulary(collection);
    const ranges = computeContinuousRanges(collection);
    const oldCallback = (game: Game) => encodeGame(game, vocabulary, [], {}, ranges);
    const expected = cosineSimilarity(
      flattenWeighted(oldCallback(first), weights),
      flattenWeighted(oldCallback(second), weights),
    );

    expect(context.getFeatureVector(first)).toEqual(oldCallback(first));
    expect(context.similarity(first, second)).toBe(expected);
    expect(context.similarity(second, first)).toBe(expected);
    expect(context.getFeatureVector(first)).toBe(context.getFeatureVector(first));
    expect(context.getFeatureVector(first).personalAxes).toBeNull();

    const pairOnly = createRedundancyFactualContext([first, second], weights);
    // Continuous dimensions are weight, rating, min players, max players, ... .
    // The outlier changes the second game's max-player normalization from 1 to 0.25.
    expect(context.getFeatureVector(second).continuous[3]).toBe(0.25);
    expect(pairOnly.getFeatureVector(second).continuous[3]).toBe(1);
    expect(context.similarity(first, second)).not.toBe(pairOnly.similarity(first, second));
  });

  test("returns exact, unrounded similarity and zero similarity for zero vectors", () => {
    const a: FeatureVector = { binary: [1, 1], continuous: [1], personalAxes: [0] };
    const b: FeatureVector = { binary: [1, 0], continuous: [0], personalAxes: [1] };
    const weights = { binary: 1, continuous: 1 };
    expect(factualSimilarity(a, b, weights)).toBeCloseTo(1 / Math.sqrt(3), 14);
    expect(factualSimilarity(b, a, weights)).toBe(factualSimilarity(a, b, weights));
    expect(
      factualSimilarity(
        { binary: [0], continuous: [0], personalAxes: [1] },
        { binary: [0], continuous: [0], personalAxes: [0] },
        weights,
      ),
    ).toBe(0);
  });
});

describe("computeRedundancyAdjustments", () => {
  const pairTable = (
    pairs: RedundancyPairTable["pairs"],
    overrides: Partial<RedundancyPairTable> = {},
  ): RedundancyPairTable => ({
    status: "ready",
    identity: { generationId: "g1", consentEpoch: "c1", settingsEpoch: "s1" },
    expectedIdentity: { generationId: "g1", consentEpoch: "c1", settingsEpoch: "s1" },
    weights: { factual: 0.5, description: 0.5, ownerNote: 0 },
    pairs,
    ...overrides,
  });

  test("ready complete table composes symmetrically; unavailable descriptions fall back to factual", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9)),
      makeGws(makeGame("b", "B"), makeScore(7)),
    ];
    const factual = cosineSimilarity(
      flattenWeighted(getVector(games[0].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
      flattenWeighted(getVector(games[1].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
    );
    const table = pairTable([{ gameAId: "b", gameBId: "a", factual, description: 0 }]);
    const result = computeRedundancyAnalysis(games, enabledSettings(), getVector, table);
    expect(result.adjustments.get("a")?.nicheNeighbors[0]?.similarity).toBe(
      result.adjustments.get("b")?.nicheNeighbors[0]?.similarity,
    );
    expect(result.similarityInfo.get("a")).toEqual({ status: "ready", generationId: "g1" });

    const missingDescription = pairTable([
      { gameAId: "a", gameBId: "b", factual, description: null },
    ]);
    expect(
      computeRedundancyAdjustments(games, enabledSettings(), getVector, missingDescription).get("b")
        ?.nicheNeighbors[0]?.similarity,
    ).toBe(Math.round(factual * 1000) / 1000);
  });

  test("semantic scores can cross threshold, while not-ready tables fall back to factual", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9)),
      makeGws(makeGame("c", "C"), makeScore(7)),
    ];
    const factual = cosineSimilarity(
      flattenWeighted(getVector(games[0].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
      flattenWeighted(getVector(games[1].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
    );
    const table = pairTable([{ gameAId: "a", gameBId: "c", factual, description: 1 }]);
    const settings = enabledSettings({ similarityThreshold: 0.7 });
    expect(computeRedundancyAdjustments(games, settings, getVector, table).size).toBe(2);
    expect(computeRedundancyAdjustments(games, settings, getVector).size).toBe(0);
    const partial = pairTable([{ gameAId: "a", gameBId: "c", factual, description: null }], {
      status: "not-ready",
    });
    const fallback = computeRedundancyAnalysis(games, settings, getVector, partial);
    expect(fallback.adjustments.size).toBe(0);
    expect(fallback.similarityInfo.get("a")?.status).toBe("not-ready");
  });

  test("normalizes F7/C5/D10 over available signals for C-only, D-only, and both", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9)),
      makeGws(makeGame("c", "C"), makeScore(7)),
    ];
    const factual = cosineSimilarity(
      flattenWeighted(getVector(games[0].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
      flattenWeighted(getVector(games[1].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
    );
    const weights = { factual: 7, description: 5, ownerNote: 10 };
    const expected = (description?: number | null, ownerNote?: number | null) => {
      const parts: [number, number][] = [[7, factual]];
      if (description != null) parts.push([5, description]);
      if (ownerNote != null) parts.push([10, ownerNote]);
      return (
        parts.reduce((sum, [weight, score]) => sum + weight * score, 0) /
        parts.reduce((sum, [weight]) => sum + weight, 0)
      );
    };
    const actual = (
      description?: number | null,
      ownerNote?: number | null,
      pairWeights = weights,
    ) => {
      const table = pairTable([{ gameAId: "a", gameBId: "c", factual, description, ownerNote }], {
        weights: pairWeights,
      });
      return computeRedundancyAdjustments(
        games,
        enabledSettings({ similarityThreshold: 0 }),
        getVector,
        table,
      ).get("a")!.nicheNeighbors[0].similarity;
    };

    expect(actual(0.2, null)).toBe(Math.round(expected(0.2) * 1000) / 1000); // C only; D omitted
    expect(actual(null, 0.8)).toBe(Math.round(expected(null, 0.8) * 1000) / 1000); // D only; C omitted
    expect(actual(0.2, 0.8)).toBe(Math.round(expected(0.2, 0.8) * 1000) / 1000); // C + D
    expect(actual(Number.NaN, Number.NaN, { factual: 7, description: 0, ownerNote: 0 })).toBe(
      Math.round(factual * 1000) / 1000,
    ); // zero-weight scores are ignored
    expect(actual(null, null, { factual: 7, description: 0, ownerNote: 0 })).toBe(
      Math.round(expected(undefined, undefined) * 1000) / 1000,
    ); // factual-only ready generation
  });

  test("rejects nonfinite semantic scores, finite factual mismatches, bad keys, and missing identity", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9)),
      makeGws(makeGame("b", "B"), makeScore(7)),
    ];
    const factual = cosineSimilarity(
      flattenWeighted(getVector(games[0].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
      flattenWeighted(getVector(games[1].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
    );
    for (const bad of [
      pairTable([{ gameAId: "a", gameBId: "b", factual, description: Number.NaN }]),
      pairTable([{ gameAId: "a", gameBId: "b", factual, ownerNote: Number.POSITIVE_INFINITY }], {
        weights: { factual: 7, description: 0, ownerNote: 10 },
      }),
      pairTable([{ gameAId: "a", gameBId: "b", factual: factual / 2 }]),
      pairTable([{ gameAId: "a", gameBId: "missing", factual }]),
      pairTable([{ gameAId: "a", gameBId: "b", factual }], {
        identity: { generationId: "", consentEpoch: "c1", settingsEpoch: "s1" },
      }),
    ]) {
      expect(() =>
        computeRedundancyAdjustments(games, enabledSettings(), getVector, bad),
      ).toThrow();
    }
    const noSignals = pairTable([{ gameAId: "a", gameBId: "b", factual }], {
      status: "partial",
      weights: { factual: 0, description: 5, ownerNote: 10 },
    });
    expect(
      computeRedundancyAdjustments(
        games,
        enabledSettings({ similarityThreshold: 0 }),
        getVector,
        noSignals,
      ),
    ).toEqual(new Map());
  });

  test("zero factual weight never restores factual neighbors at threshold zero", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9)),
      makeGws(makeGame("b", "B"), makeScore(7)),
    ];
    const factual = factualSimilarity(
      getVector(games[0].game),
      getVector(games[1].game),
      DEFAULT_REDUNDANCY_SETTINGS.componentWeights,
    );
    const noSignals = pairTable(
      [{ gameAId: "a", gameBId: "b", factual, description: null, ownerNote: null }],
      {
        status: "not-ready",
        weights: { factual: 0, description: 1, ownerNote: 1 },
      },
    );
    expect(
      computeRedundancyAdjustments(
        games,
        enabledSettings({ similarityThreshold: 0 }),
        getVector,
        noSignals,
      ),
    ).toEqual(new Map());
    expect(
      computeRedundancyAdjustments(
        games,
        enabledSettings({ similarityThreshold: 0 }),
        getVector,
        undefined,
        false,
      ),
    ).toEqual(new Map());
  });

  test("predicted positive-score games remain in the complete pair universe", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9)),
      makeGws(makeGame("b", "B"), makeScore(7, { predictedOnly: true })),
    ];
    const factual = cosineSimilarity(
      flattenWeighted(getVector(games[0].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
      flattenWeighted(getVector(games[1].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
    );
    const table = pairTable([{ gameAId: "a", gameBId: "b", factual, description: null }]);
    const result = computeRedundancyAnalysis(games, enabledSettings(), getVector, table);
    expect(result.similarityInfo.has("b")).toBe(true);
    expect(result.adjustments.get("b")?.nicheNeighbors[0]?.gameId).toBe("a");
  });

  test("rejects incomplete, duplicate, extra, nonfinite, and identity-mismatched ready tables", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9)),
      makeGws(makeGame("b", "B"), makeScore(7)),
      makeGws(makeGame("c", "C"), makeScore(5)),
    ];
    const score = (a: string, b: string) =>
      cosineSimilarity(
        flattenWeighted(getVector(makeGame(a, a)), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
        flattenWeighted(getVector(makeGame(b, b)), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
      );
    const validPair = { gameAId: "a", gameBId: "b", factual: score("a", "b") };
    for (const bad of [
      pairTable([validPair]),
      pairTable([
        validPair,
        validPair,
        { gameAId: "a", gameBId: "c", factual: score("a", "c") },
        { gameAId: "b", gameBId: "c", factual: score("b", "c") },
      ]),
      pairTable([
        { ...validPair, factual: Number.NaN },
        { gameAId: "a", gameBId: "c", factual: score("a", "c") },
        { gameAId: "b", gameBId: "c", factual: score("b", "c") },
      ]),
      pairTable([
        { ...validPair, gameAId: "x" },
        { gameAId: "a", gameBId: "c", factual: score("a", "c") },
        { gameAId: "b", gameBId: "c", factual: score("b", "c") },
      ]),
      pairTable(
        [
          { ...validPair, factual: score("a", "b") },
          { gameAId: "a", gameBId: "c", factual: score("a", "c") },
          { gameAId: "b", gameBId: "c", factual: score("b", "c") },
        ],
        { expectedIdentity: { generationId: "other", consentEpoch: "c1", settingsEpoch: "s1" } },
      ),
    ])
      expect(() =>
        computeRedundancyAdjustments(games, enabledSettings(), getVector, bad),
      ).toThrow();
  });

  test("uses validated map lookups for a large factual pair universe", () => {
    const count = 40;
    const syntheticVectors = new Map<string, FeatureVector>();
    const games = Array.from({ length: count }, (_, index) => {
      const id = `synthetic-${index}`;
      const group = index % 5;
      const binary = Array.from({ length: 5 }, (_, axis) => Number(axis === group));
      syntheticVectors.set(id, { binary, continuous: [], personalAxes: null });
      return makeGws(makeGame(id, id), makeScore(count - index));
    });
    const localGetVector = (game: Game) => syntheticVectors.get(game.id)!;
    const pairs: RedundancyPairTable["pairs"] = [];
    for (let i = 0; i < games.length; i++) {
      for (let j = i + 1; j < games.length; j++) {
        pairs.push({
          gameAId: games[i].game.id,
          gameBId: games[j].game.id,
          factual: Number(i % 5 === j % 5),
        });
      }
    }
    // Validation must still iterate the complete table, but analysis must not
    // perform a fresh linear search for each pair in the quadratic game loop.
    const guardedPairs = new Proxy(pairs, {
      get(target, property, receiver) {
        if (property === "find") throw new Error("pair table linear search is forbidden");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const table = pairTable(guardedPairs, {
      weights: { factual: 1, description: 0, ownerNote: 0 },
    });
    const result = computeRedundancyAnalysis(
      games,
      enabledSettings({ similarityThreshold: 0.5 }),
      localGetVector,
      table,
    );

    expect(pairs).toHaveLength((count * (count - 1)) / 2);
    for (const game of games) {
      const adjustment = result.adjustments.get(game.game.id);
      expect(adjustment).toBeDefined();
      expect(adjustment!.nicheSize).toBe(7);
      const gameGroup = Number(game.game.id.split("-")[1]) % 5;
      expect(
        adjustment!.nicheNeighbors.every(
          (neighbor) => Number(neighbor.gameId.split("-")[1]) % 5 === gameGroup,
        ),
      ).toBe(true);
    }
  });

  test("fails closed for malformed factual pairs", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9)),
      makeGws(makeGame("b", "B"), makeScore(7)),
      makeGws(makeGame("c", "C"), makeScore(5)),
    ];
    const factual = (a: string, b: string) =>
      factualSimilarity(
        getVector(makeGame(a, a)),
        getVector(makeGame(b, b)),
        DEFAULT_REDUNDANCY_SETTINGS.componentWeights,
      );
    const completePairs = [
      { gameAId: "a", gameBId: "b", factual: factual("a", "b") },
      { gameAId: "a", gameBId: "c", factual: factual("a", "c") },
      { gameAId: "b", gameBId: "c", factual: factual("b", "c") },
    ];
    const malformedTables = [
      pairTable(completePairs.slice(1)),
      pairTable([{ ...completePairs[0], factual: Number.NaN }, ...completePairs.slice(1)]),
      pairTable([{ ...completePairs[0], gameBId: "a" }, ...completePairs.slice(1)]),
      pairTable(completePairs, {
        identity: { generationId: "wrong", consentEpoch: "c1", settingsEpoch: "s1" },
      }),
    ];

    for (const table of malformedTables) {
      expect(() => computeRedundancyAnalysis(games, enabledSettings(), getVector, table)).toThrow();
    }
  });

  test("no-neighbor analysis still reports status and uses only positive non-vetoed score universe", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9)),
      makeGws(makeGame("b", "B"), makeScore(7)),
      makeGws(makeGame("f", "F"), makeScore(6, { vetoed: true })),
      makeGws(makeGame("zero", "Zero"), makeScore(0)),
    ];
    const factual = cosineSimilarity(
      flattenWeighted(getVector(games[0].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
      flattenWeighted(getVector(games[1].game), DEFAULT_REDUNDANCY_SETTINGS.componentWeights),
    );
    const table = pairTable([{ gameAId: "a", gameBId: "b", factual }]);
    const result = computeRedundancyAnalysis(
      games,
      enabledSettings({ similarityThreshold: 1.01 }),
      getVector,
      table,
    );
    expect(result.adjustments.size).toBe(0);
    expect(result.similarityInfo.get("a")).toEqual({ status: "ready", generationId: "g1" });
    expect(result.similarityInfo.has("f")).toBe(false);
    expect(result.similarityInfo.has("zero")).toBe(false);
  });

  test("returns empty map when settings.enabled is false", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    const result = computeRedundancyAdjustments(
      games,
      { ...DEFAULT_REDUNDANCY_SETTINGS, enabled: false },
      getVector,
    );
    expect(result.size).toBe(0);
  });

  test("no neighbors above threshold: no adjustment", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("d", "D"), makeScore(7.0)),
    ];
    // A and D are very different, similarity below threshold
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.99 }),
      getVector,
    );
    expect(result.size).toBe(0);
  });

  test("fewer neighbors than minNeighbors: no adjustment", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    // A and B are similar, but minNeighbors=5 means we need at least 5 neighbors
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ minNeighbors: 5 }),
      getVector,
    );
    expect(result.size).toBe(0);
  });

  test("highest-scoring game gets zero penalty", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    const result = computeRedundancyAdjustments(games, enabledSettings(), getVector);
    const adjA = result.get("a");
    expect(adjA).toBeDefined();
    expect(adjA!.penalty).toBe(0);
    expect(adjA!.adjustedScore).toBe(9.0);
    expect(adjA!.nicheRank).toBe(1);
  });

  test("penalty capped at maxPenalty", () => {
    // A=9.0, B=7.0: B has 1 better neighbor out of 1, so coverage=1.0, penalty=maxPenalty
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    const settings = enabledSettings({ maxPenalty: 2.0, expectedNeighbors: 1 });
    const result = computeRedundancyAdjustments(games, settings, getVector);
    const adjB = result.get("b");
    expect(adjB).toBeDefined();
    expect(adjB!.penalty).toBe(2.0);
    expect(adjB!.adjustedScore).toBe(5.0);
  });

  test("penalty proportional to coverageRatio", () => {
    // A=9.0, B=9.0, C=7.0: B has 1 better neighbor out of 2, so coverage=0.5, penalty=maxPenalty * 0.5
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(8.0)),
      makeGws(makeGame("c", "C"), makeScore(7.0)),
    ];
    const settings = enabledSettings({ maxPenalty: 2.0, expectedNeighbors: 1 });
    const result = computeRedundancyAdjustments(games, settings, getVector);
    const adjB = result.get("b");
    expect(adjB).toBeDefined();
    expect(adjB!.penalty).toBe(1.0);
    expect(adjB!.adjustedScore).toBe(7.0);
  });

  test("penalty proportional to coverageRatio adjusted for expectedNeighbors", () => {
    // A=9.0, B=7.0: B has 1 better neighbor out of 1 but expected 2, so coverage=0.5, penalty=maxPenalty * 0.5
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    const settings = enabledSettings({ maxPenalty: 2.0, expectedNeighbors: 2 });
    const result = computeRedundancyAdjustments(games, settings, getVector);
    const adjB = result.get("b");
    expect(adjB).toBeDefined();
    expect(adjB!.penalty).toBe(1.0);
    expect(adjB!.adjustedScore).toBe(6.0);
  });

  test("score floor at 1.0", () => {
    // Game with score 2.0 and penalty > 1.0 should floor at 1.0
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(2.0)),
    ];
    const settings = enabledSettings({ maxPenalty: 5.0 });
    const result = computeRedundancyAdjustments(games, settings, getVector);
    const adjB = result.get("b");
    expect(adjB).toBeDefined();
    expect(adjB!.adjustedScore).toBe(1.0);
  });

  test("tied games don't count as better", () => {
    // A=8.002, B=8.004: both round to 800 at 2 decimal places, so they're tied
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.002)),
      makeGws(makeGame("b", "B"), makeScore(8.004)),
    ];
    const result = computeRedundancyAdjustments(games, enabledSettings(), getVector);
    const adjA = result.get("a");
    const adjB = result.get("b");
    // Neither counts the other as "better" since they're tied
    expect(adjA!.penalty).toBe(0);
    expect(adjB!.penalty).toBe(0);
  });

  test("vetoed games excluded entirely", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("f", "F"), makeScore(7.0, { vetoed: true })),
    ];
    const result = computeRedundancyAdjustments(games, enabledSettings(), getVector);
    // F is vetoed, so A has no neighbors
    expect(result.has("f")).toBe(false);
    expect(result.size).toBe(0); // A has no eligible neighbors
  });

  test("predicted games don't penalize actual-scored games (REQ-REDUN-12)", () => {
    // A is actual with score 7.0, B is predicted with score 9.0
    // B is "better" but shouldn't count against A because B is fully predicted
    const games = [
      makeGws(makeGame("a", "A"), makeScore(7.0)),
      makeGws(makeGame("b", "B"), makeScore(9.0, { predictedOnly: true })),
    ];
    const result = computeRedundancyAdjustments(games, enabledSettings(), getVector);
    const adjA = result.get("a");
    expect(adjA).toBeDefined();
    expect(adjA!.penalty).toBe(0); // predicted B doesn't count as "better" for actual A
  });

  test("predicted games ARE penalized by actual-scored neighbors normally", () => {
    // B is predicted with score 7.0, A is actual with score 9.0
    // A counts as "better" against predicted B
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0, { predictedOnly: true })),
    ];
    const result = computeRedundancyAdjustments(games, enabledSettings(), getVector);
    const adjB = result.get("b");
    expect(adjB).toBeDefined();
    expect(adjB!.penalty).toBeGreaterThan(0);
  });

  test("componentWeights influence similarity", () => {
    // With all weight on binary, A and E are very similar (same binary vector)
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("e", "E"), makeScore(7.0)),
    ];

    // High binary weight: should find neighbors
    const binaryResult = computeRedundancyAdjustments(
      games,
      enabledSettings({ componentWeights: { binary: 1.0, continuous: 0 } }),
      getVector,
    );
    expect(binaryResult.size).toBeGreaterThan(0);
  });

  test("personal-axis values cannot change redundancy neighbors", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9)),
      makeGws(makeGame("b", "B"), makeScore(7)),
    ];
    const radicallyDifferentAxes: Record<string, FeatureVector> = {
      a: { binary: [1, 0], continuous: [0.5], personalAxes: [0, 0] },
      b: { binary: [1, 0], continuous: [0.5], personalAxes: [1, 1] },
    };
    const identicalAxes: Record<string, FeatureVector> = {
      a: { ...radicallyDifferentAxes.a, personalAxes: [0.4, 0.6] },
      b: { ...radicallyDifferentAxes.b, personalAxes: [0.4, 0.6] },
    };
    const settings = enabledSettings({ similarityThreshold: 0.99 });
    const first = computeRedundancyAdjustments(
      games,
      settings,
      (game) => radicallyDifferentAxes[game.id],
    );
    const second = computeRedundancyAdjustments(games, settings, (game) => identicalAxes[game.id]);
    expect(first).toEqual(second);
  });

  test("similarityThreshold changes neighbor set", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("c", "C"), makeScore(7.0)),
    ];

    // Low threshold: C is a neighbor of A
    const lowThreshold = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.3 }),
      getVector,
    );
    // High threshold: C is not a neighbor of A
    const highThreshold = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.99 }),
      getVector,
    );
    expect(lowThreshold.size).toBeGreaterThanOrEqual(highThreshold.size);
  });

  test("neighbors sorted by similarity descending", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(8.0)),
      makeGws(makeGame("c", "C"), makeScore(7.0)),
    ];
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.3 }),
      getVector,
    );

    // Check that neighbors for any game with multiple neighbors are sorted
    for (const [, adj] of result) {
      for (let i = 1; i < adj.nicheNeighbors.length; i++) {
        expect(adj.nicheNeighbors[i - 1].similarity).toBeGreaterThanOrEqual(
          adj.nicheNeighbors[i].similarity,
        );
      }
    }
  });

  test("3 games with identical scores and high similarity all get zero penalty", () => {
    // Spec AI Validation: "3 games with identical fitness scores and high mutual similarity,
    // verifying all receive zero penalty (no game is 'better')."
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("b", "B"), makeScore(8.0)),
      makeGws(makeGame("c", "C"), makeScore(8.0)),
    ];
    // A, B, C all have similar vectors (a/b are near-identical, c is somewhat similar)
    // Use low threshold so all are neighbors
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.3 }),
      getVector,
    );
    for (const [, adj] of result) {
      expect(adj.penalty).toBe(0);
      expect(adj.nicheRank).toBe(1);
    }
  });

  test("5 neighbors where 3 score higher: penalty is (3/5) * maxPenalty", () => {
    // Spec AI Validation: "A game with 5 neighbors where 3 score higher,
    // verifying penalty is (3/5) * maxPenalty."
    // Need 6 games total: the subject + 5 neighbors.
    // All use similar vectors so they're all neighbors at a low threshold.
    const extraVectors: Record<string, FeatureVector> = {
      g1: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.9, 0.7] },
      g2: { binary: [1, 1, 0, 0], continuous: [0.8, 0.5], personalAxes: [0.85, 0.75] },
      g3: { binary: [1, 1, 0, 0], continuous: [0.7, 0.6], personalAxes: [0.9, 0.65] },
      g4: { binary: [1, 1, 0, 0], continuous: [0.75, 0.55], personalAxes: [0.88, 0.72] },
      g5: { binary: [1, 1, 0, 0], continuous: [0.8, 0.55], personalAxes: [0.87, 0.73] },
      subject: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.9, 0.7] },
    };
    const localGetVector = (game: Game): FeatureVector => extraVectors[game.id];

    const games = [
      makeGws(makeGame("g1", "G1"), makeScore(9.0)), // better
      makeGws(makeGame("g2", "G2"), makeScore(8.5)), // better
      makeGws(makeGame("g3", "G3"), makeScore(8.0)), // better
      makeGws(makeGame("g4", "G4"), makeScore(6.0)), // worse
      makeGws(makeGame("g5", "G5"), makeScore(5.0)), // worse
      makeGws(makeGame("subject", "Subject"), makeScore(7.0)),
    ];
    const settings = enabledSettings({ similarityThreshold: 0.3, maxPenalty: 2.0 });
    const result = computeRedundancyAdjustments(games, settings, localGetVector);
    const adj = result.get("subject");
    expect(adj).toBeDefined();
    // 3 better out of 5 neighbors = 0.6 coverage, penalty = 0.6 * 2.0 = 1.2
    expect(adj!.penalty).toBe(1.2);
    expect(adj!.adjustedScore).toBe(5.8);
  });

  test("zero-sum componentWeights returns empty map instead of NaN", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    const settings = enabledSettings({
      componentWeights: { binary: 0, continuous: 0 },
    });
    const result = computeRedundancyAdjustments(games, settings, getVector);
    expect(result.size).toBe(0);
  });

  test("zero-magnitude feature vectors produce zero similarity, not NaN", () => {
    const zeroVectors: Record<string, FeatureVector> = {
      z1: { binary: [0, 0, 0, 0], continuous: [0, 0], personalAxes: null },
      z2: { binary: [0, 0, 0, 0], continuous: [0, 0], personalAxes: null },
      e1: { binary: [], continuous: [], personalAxes: null },
      e2: { binary: [], continuous: [], personalAxes: null },
    };
    const localGetVector = (game: Game): FeatureVector => zeroVectors[game.id];
    const zeroGames = [
      makeGws(makeGame("z1", "Z1"), makeScore(8.0)),
      makeGws(makeGame("z2", "Z2"), makeScore(7.0)),
    ];
    const emptyGames = [
      makeGws(makeGame("e1", "E1"), makeScore(6.0)),
      makeGws(makeGame("e2", "E2"), makeScore(5.0)),
    ];
    // Threshold 0 so zero similarity would still need to meet >= 0 to be a neighbor
    const settings = enabledSettings({ similarityThreshold: 0 });
    const zeroResult = computeRedundancyAdjustments(zeroGames, settings, localGetVector);
    const emptyResult = computeRedundancyAdjustments(emptyGames, settings, localGetVector);
    // Zero/empty vectors produce similarity=0, which meets threshold=0.
    const weightedZero = flattenWeighted(zeroVectors.z1, { binary: 0.4, continuous: 0.3 });
    const weightedEmpty = flattenWeighted(zeroVectors.e1, { binary: 0.4, continuous: 0.3 });
    const zeroSimilarity = cosineSimilarity(weightedZero, weightedZero);
    const emptySimilarity = cosineSimilarity(weightedEmpty, weightedEmpty);
    expect(Number.isFinite(zeroSimilarity)).toBe(true);
    expect(Number.isFinite(1 - zeroSimilarity)).toBe(true);
    expect(Number.isFinite(emptySimilarity)).toBe(true);
    expect(Number.isFinite(1 - emptySimilarity)).toBe(true);
    for (const result of [zeroResult, emptyResult]) {
      expect(result.size).toBe(2);
      for (const [, adj] of result) {
        expect(Number.isFinite(adj.penalty)).toBe(true);
        expect(Number.isFinite(adj.originalScore)).toBe(true);
        expect(Number.isFinite(adj.adjustedScore)).toBe(true);
        for (const n of adj.nicheNeighbors) {
          expect(Number.isFinite(n.similarity)).toBe(true);
          expect(Number.isFinite(n.fitnessScore)).toBe(true);
        }
      }
    }
  });

  test("nicheRank respects predicted authority (matches penalty semantics)", () => {
    // A is actual score=7.0, B is predicted score=9.0, C is actual score=8.0
    // For A: B is predicted (doesn't count), C is actual and better
    // betterCount=1, nicheRank should be 2 (not 3)
    const games = [
      makeGws(makeGame("a", "A"), makeScore(7.0)),
      makeGws(makeGame("b", "B"), makeScore(9.0, { predictedOnly: true })),
      makeGws(makeGame("c", "C"), makeScore(8.0)),
    ];
    // Need all to be neighbors; use c's vector similar to a/b
    const localVectors: Record<string, FeatureVector> = {
      a: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.9, 0.7] },
      b: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.85, 0.75] },
      c: { binary: [1, 1, 0, 0], continuous: [0.8, 0.5], personalAxes: [0.88, 0.72] },
    };
    const localGetVector = (game: Game): FeatureVector => localVectors[game.id];
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.3 }),
      localGetVector,
    );
    const adjA = result.get("a");
    expect(adjA).toBeDefined();
    // Only C counts as better (B is predicted), so nicheRank=2
    expect(adjA!.nicheRank).toBe(2);
  });

  test("deterministic output (same input, same result)", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
      makeGws(makeGame("c", "C"), makeScore(5.0)),
    ];
    const settings = enabledSettings({ similarityThreshold: 0.3 });

    const result1 = computeRedundancyAdjustments(games, settings, getVector);
    const result2 = computeRedundancyAdjustments(games, settings, getVector);

    expect(result1.size).toBe(result2.size);
    for (const [id, adj1] of result1) {
      const adj2 = result2.get(id);
      expect(adj2).toBeDefined();
      expect(adj1.penalty).toBe(adj2!.penalty);
      expect(adj1.adjustedScore).toBe(adj2!.adjustedScore);
      expect(adj1.nicheRank).toBe(adj2!.nicheRank);
    }
  });
});
