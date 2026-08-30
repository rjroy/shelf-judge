import { describe, expect, test } from "bun:test";
import type { Axis, Game, PersonalAxis, TournamentAxis } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import {
  FACTUAL_VECTOR_DIMENSIONS,
  buildVocabulary,
  computeContinuousRanges,
  encodeGame,
  jaccardDistance,
  normalizedManhattanDistance,
  compositeDistance,
  computeCentroid,
  cosineSimilarity,
  getOrderedVectorAxes,
  getVectorAxisValues,
} from "../src/services/feature-vector";
import type { FeatureVector } from "../src/services/feature-vector";

function makeGame(overrides: Partial<Game> = {}): Game {
  const game: Game = {
    id: "test-id",
    bggId: 1,
    entityMetadata: createInitialEntityMetadata(1),
    latestPlayCountCheck: null,
    name: "Test Game",
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: 3,
    playingTime: 60,
    imageUrl: null,
    bggData: {
      communityRating: 7.5,
      bayesAverage: 7.0,
      weight: 3.0,
      numWeightVotes: 100,
      description: null,
      mechanics: [
        { id: 1, name: "Dice Rolling" },
        { id: 2, name: "Hand Management" },
      ],
      categories: [{ id: 10, name: "Strategy" }],
      families: [],
      subdomains: [],
      bestPlayerCount: 3,
      fetchedAt: "2025-01-01T00:00:00.000Z",
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
  return {
    ...game,
    entityMetadata: createInitialEntityMetadata(game.bggId),
    latestPlayCountCheck: null,
  };
}

describe("buildVocabulary", () => {
  test("produces sorted, deduplicated mechanic and category lists", () => {
    const games = [
      makeGame({
        bggData: {
          ...makeGame().bggData!,
          mechanics: [
            { id: 2, name: "Hand Management" },
            { id: 1, name: "Dice Rolling" },
          ],
          categories: [{ id: 10, name: "Strategy" }],
        },
      }),
      makeGame({
        bggData: {
          ...makeGame().bggData!,
          mechanics: [
            { id: 1, name: "Dice Rolling" },
            { id: 3, name: "Worker Placement" },
          ],
          categories: [
            { id: 10, name: "Strategy" },
            { id: 11, name: "Economic" },
          ],
        },
      }),
    ];

    const vocab = buildVocabulary(games);
    expect(vocab.mechanics).toEqual(["Dice Rolling", "Hand Management", "Worker Placement"]);
    expect(vocab.categories).toEqual(["Economic", "Strategy"]);
  });

  test("handles games without BGG data", () => {
    const games = [makeGame({ bggData: null }), makeGame()];
    const vocab = buildVocabulary(games);
    expect(vocab.mechanics).toEqual(["Dice Rolling", "Hand Management"]);
    expect(vocab.categories).toEqual(["Strategy"]);
  });

  test("returns empty arrays for no games", () => {
    const vocab = buildVocabulary([]);
    expect(vocab.mechanics).toEqual([]);
    expect(vocab.categories).toEqual([]);
  });
});

describe("encodeGame", () => {
  test("requires an explicit ordered vector-axis schema at runtime", () => {
    expect(() => {
      Reflect.apply(encodeGame, undefined, [makeGame(), { mechanics: [], categories: [] }]);
    }).toThrow(/ordered vector-axis schema is required/);
  });

  test("uses the canonical factual names and exact dimensions", () => {
    expect(FACTUAL_VECTOR_DIMENSIONS).toEqual([
      "weight",
      "communityRating",
      "minPlayers",
      "maxPlayers",
      "bestPlayers",
      "playingTime",
    ]);
    const vector = encodeGame(makeGame(), { mechanics: ["Dice Rolling"], categories: [] }, []);
    expect(vector.binary).toHaveLength(1);
    expect(vector.continuous).toHaveLength(6);
    expect(vector.personalAxes).toBeNull();
  });

  test("derives stable personal and tournament slots in collection order", () => {
    const personal: PersonalAxis = {
      id: "personal",
      name: "Personal",
      description: null,
      weight: 50,
      enabled: true,
      source: "personal",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const tournament: TournamentAxis = {
      ...personal,
      id: "tournament",
      name: "Tournament",
      source: "tournament",
    };
    const derived: Axis = {
      ...personal,
      id: "time",
      name: "Play Time",
      source: "derived",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 120 },
    };
    const disabled: Axis = {
      id: "disabled",
      name: "Disabled",
      description: null,
      weight: 50,
      enabled: false,
      source: "legacy",
      reason: "unsupported",
      legacyField: null,
      legacyPayload: {},
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    expect(
      getOrderedVectorAxes([derived, tournament, disabled, personal]).map((axis) => axis.id),
    ).toEqual(["tournament", "personal"]);
    const vector = encodeGame(
      makeGame(),
      { mechanics: [], categories: [] },
      [tournament, personal],
      { tournament: 9, personal: 3 },
    );
    expect(vector.personalAxes).toEqual([8 / 9, 2 / 9]);
    expect(getVectorAxisValues(makeGame(), [tournament, personal], 9)).toEqual({
      tournament: 9,
    });
    expect(
      encodeGame(
        makeGame(),
        { mechanics: [], categories: [] },
        [tournament, personal],
        getVectorAxisValues(makeGame(), [tournament, personal], null),
      ).personalAxes,
    ).toEqual([0.5, 0.5]);
  });

  test("derived duplicates and configuration changes cannot alter vector values", () => {
    const base = {
      id: "time-a",
      name: "Play Time",
      description: null,
      weight: 50,
      enabled: true as const,
      source: "derived" as const,
      derivedField: "playingTime" as const,
      configuration: { maximumScoringTime: 60 },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const game = makeGame({ playingTime: 300 });
    const ranges = {
      minPlayers: { min: 1, max: 5 },
      maxPlayers: { min: 2, max: 6 },
      bestPlayers: { min: 2, max: 4 },
      playingTime: { min: 0, max: 600 },
    };
    const without = encodeGame(game, { mechanics: [], categories: [] }, [], undefined, ranges);
    const axes: Axis[] = [
      base,
      { ...base, id: "time-b", configuration: { maximumScoringTime: 240 } },
      {
        ...base,
        id: "players",
        derivedField: "playerCountFit",
        configuration: { targetPlayerCount: 4 },
      },
    ];
    const withDerived = encodeGame(
      game,
      { mechanics: [], categories: [] },
      getOrderedVectorAxes(axes),
      game.ratings,
      ranges,
    );
    expect(withDerived).toEqual(without);
    expect(withDerived.continuous[5]).toBe(0.5);
  });

  test("sanitizes non-finite factual and axis inputs to a finite vector", () => {
    const game = makeGame({
      minPlayers: Number.NaN,
      maxPlayers: Number.POSITIVE_INFINITY,
      bestPlayers: Number.NaN,
      playingTime: Number.NEGATIVE_INFINITY,
    });
    if (game.bggData !== null) {
      game.bggData.weight = Number.NaN;
      game.bggData.communityRating = Number.POSITIVE_INFINITY;
    }
    const axis: PersonalAxis = {
      id: "personal",
      name: "Personal",
      description: null,
      weight: 50,
      enabled: true,
      source: "personal",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const vector = encodeGame(game, { mechanics: [], categories: [] }, [axis], {
      personal: Number.NaN,
    });
    expect([...vector.continuous, ...(vector.personalAxes ?? [])].every(Number.isFinite)).toBe(
      true,
    );
    expect(vector.personalAxes).toEqual([0.5]);
  });
  test("produces correct binary flags for known mechanics", () => {
    const vocab = {
      mechanics: ["Dice Rolling", "Hand Management", "Worker Placement"],
      categories: ["Economic", "Strategy"],
    };
    const game = makeGame();
    const vec = encodeGame(game, vocab, []);

    // Dice Rolling=1, Hand Management=1, Worker Placement=0, Economic=0, Strategy=1
    expect(vec.binary).toEqual([1, 1, 0, 0, 1]);
  });

  test("normalizes continuous values to [0,1]", () => {
    const game = makeGame({ minPlayers: 1, maxPlayers: 10, bestPlayers: 5.5, playingTime: 150 });
    game.bggData!.weight = 1; // min weight
    game.bggData!.communityRating = 10; // max rating

    const vocab = { mechanics: [], categories: [] };
    const vec = encodeGame(game, vocab, []);

    // weight: (1-1)/(5-1) = 0
    expect(vec.continuous[0]).toBe(0);
    // communityRating: (10-1)/(10-1) = 1
    expect(vec.continuous[1]).toBe(1);
    // minPlayers: (1-1)/(10-1) = 0
    expect(vec.continuous[2]).toBe(0);
    // maxPlayers: (10-1)/(10-1) = 1
    expect(vec.continuous[3]).toBe(1);
    // bestPlayers: (5.5-1)/(10-1) = 0.5
    expect(vec.continuous[4]).toBe(0.5);
    // playingTime: 150/300 = 0.5
    expect(vec.continuous[5]).toBe(0.5);
  });

  test("handles null BGG data with defaults", () => {
    const game = makeGame({ bggData: null });
    const vocab = { mechanics: ["Dice Rolling"], categories: ["Strategy"] };
    const vec = encodeGame(game, vocab, []);

    // No BGG data: all binary flags 0
    expect(vec.binary).toEqual([0, 0]);
    // Continuous defaults: weight=2.5, rating=5.5, etc.
    expect(vec.continuous.length).toBe(6);
    expect(vec.continuous[0]).toBeCloseTo(0.375, 5); // (2.5-1)/4
    expect(vec.continuous[1]).toBe(0.5); // (5.5-1)/9
  });

  test("encodes personal axis ratings when provided", () => {
    const game = makeGame();
    const axisRatings = { "axis-a": 8, "axis-b": 3 };
    const axes = [
      {
        id: "axis-a",
        name: "A",
        description: null,
        weight: 50,
        enabled: true as const,
        source: "personal" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "axis-b",
        name: "B",
        description: null,
        weight: 50,
        enabled: true as const,
        source: "personal" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const vocab = { mechanics: [], categories: [] };
    const vec = encodeGame(game, vocab, axes, axisRatings);

    expect(vec.personalAxes).not.toBeNull();
    expect(vec.personalAxes!.length).toBe(2);
    // axis-a rating 8: (8-1)/9 ≈ 0.778 (default 1-10 scale when no axes passed)
    expect(vec.personalAxes![0]).toBeCloseTo(7 / 9, 5);
    // axis-b rating 3: (3-1)/9 ≈ 0.222
    expect(vec.personalAxes![1]).toBeCloseTo(2 / 9, 5);
  });

  test("derived axes never allocate vector slots", () => {
    const game = makeGame();
    const axisRatings = { w: 3.0 };
    const axes = [
      {
        id: "w",
        name: "Weight",
        description: null,
        weight: 50,
        enabled: true as const,
        source: "derived" as const,
        derivedField: "weight" as const,
        configuration: {},
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const vocab = { mechanics: [], categories: [] };
    const vec = encodeGame(game, vocab, [], axisRatings);

    expect(axes).toHaveLength(1);
    expect(vec.personalAxes).toBeNull();
  });

  test("uses midpoint for unrated axes", () => {
    const game = makeGame();
    const vocab = { mechanics: [], categories: [] };
    const axes = [
      {
        id: "axis-a",
        name: "A",
        description: null,
        weight: 50,
        enabled: true as const,
        source: "personal" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const vec = encodeGame(game, vocab, axes, { "axis-a": undefined });

    expect(vec.personalAxes![0]).toBe(0.5);
  });

  test("personalAxes is null when no axis ratings provided", () => {
    const game = makeGame();
    const vocab = { mechanics: [], categories: [] };
    const vec = encodeGame(game, vocab, []);
    expect(vec.personalAxes).toBeNull();
  });

  test("produces fixed-dimension personalAxes vector when axes list provided", () => {
    // Regression: previously encodeGame iterated over axisRatings keys, so games
    // with different resolved axis sets produced different-length vectors.
    // Pairwise distances then read past the end of the shorter vector and
    // returned NaN, which serialized to `null` in stored profiles.
    const game = makeGame();
    const vocab = { mechanics: [], categories: [] };
    const axes = [
      {
        id: "a",
        name: "A",
        description: null,
        weight: 50,
        enabled: true as const,
        source: "personal" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "b",
        name: "B",
        description: null,
        weight: 50,
        enabled: true as const,
        source: "personal" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "c",
        name: "C",
        description: null,
        weight: 50,
        enabled: true as const,
        source: "personal" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    // One game has only axis `a`, another has `b` and `c`. Both vectors must
    // have length 3 so centroid/pairwise math is well-defined.
    const vecA = encodeGame(game, vocab, axes, { a: 8 });
    const vecBC = encodeGame(game, vocab, axes, { b: 3, c: 9 });

    expect(vecA.personalAxes!.length).toBe(3);
    expect(vecBC.personalAxes!.length).toBe(3);
    // Slot 0 is axis `a`: vecA has a rating, vecBC falls back to 0.5
    expect(vecA.personalAxes![0]).toBeCloseTo(7 / 9, 5);
    expect(vecBC.personalAxes![0]).toBe(0.5);
    // Slot 1 is axis `b`: vecA falls back to 0.5, vecBC has rating 3
    expect(vecA.personalAxes![1]).toBe(0.5);
    expect(vecBC.personalAxes![1]).toBeCloseTo(2 / 9, 5);
  });

  test("tournament axis adds exactly one slot to personalAxes", () => {
    // REQ-TAXIS-8 / REQ-TAXIS-17: tournament-source axes participate in the
    // feature-vector personalAxes component. Adding a tournament axis must
    // grow the dimension by exactly 1 and not interfere with other slots.
    const game = makeGame();
    const vocab = { mechanics: [], categories: [] };
    const personalAxis = {
      id: "fun",
      name: "Fun",
      description: null,
      weight: 50,
      enabled: true as const,
      source: "personal" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const tournamentAxis = {
      id: "tournament",
      name: "Tournament",
      description: null,
      weight: 30,
      enabled: true as const,
      source: "tournament" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const withoutTournament = encodeGame(game, vocab, [personalAxis], { fun: 8 });
    const withTournament = encodeGame(game, vocab, [personalAxis, tournamentAxis], {
      fun: 8,
      tournament: 7.5,
    });

    expect(withoutTournament.personalAxes!.length).toBe(1);
    expect(withTournament.personalAxes!.length).toBe(2);
    expect(withTournament.personalAxes![0]).toBeCloseTo(7 / 9, 5); // fun=8 on 1-10
    // tournament=7.5 on 1-10 → (7.5-1)/9 ≈ 0.7222
    expect(withTournament.personalAxes![1]).toBeCloseTo(6.5 / 9, 5);
  });

  test("tournament column populated when value supplied", () => {
    // Regression for the prediction-service filter fix: without the fix the
    // tournament column would silently be 0.5 (default) for every game.
    const game = makeGame();
    const vocab = { mechanics: [], categories: [] };
    const tournamentAxis = {
      id: "t",
      name: "Tournament",
      description: null,
      weight: 30,
      enabled: true as const,
      source: "tournament" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    // Game with tournament value 10 (top of scale) should encode to 1.0
    const top = encodeGame(game, vocab, [tournamentAxis], { t: 10 });
    expect(top.personalAxes![0]).toBeCloseTo(1, 5);

    // Game with no tournament rating falls back to 0.5
    const empty = encodeGame(game, vocab, [tournamentAxis], {});
    expect(empty.personalAxes![0]).toBe(0.5);
  });

  test("cosine similarity over mixed personal+tournament axes is in [0,1]", () => {
    // Sanity: feeding both personal and tournament values into the encoder
    // and computing cosine similarity must produce finite, non-NaN values.
    const game = makeGame();
    const vocab = { mechanics: [], categories: [] };
    const axes = [
      {
        id: "fun",
        name: "Fun",
        description: null,
        weight: 50,
        enabled: true as const,
        source: "personal" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "t",
        name: "Tournament",
        description: null,
        weight: 30,
        enabled: true as const,
        source: "tournament" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const a = encodeGame(game, vocab, axes, { fun: 8, t: 7 });
    const b = encodeGame(game, vocab, axes, { fun: 6, t: 9 });

    const sim = cosineSimilarity(a.personalAxes!, b.personalAxes!);
    expect(Number.isNaN(sim)).toBe(false);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });

  test("uses observed ranges when provided", () => {
    const game = makeGame({ minPlayers: 3, maxPlayers: 6, bestPlayers: 5, playingTime: 90 });
    const vocab = { mechanics: [], categories: [] };
    const ranges = {
      minPlayers: { min: 2, max: 4 },
      maxPlayers: { min: 4, max: 8 },
      bestPlayers: { min: 3, max: 7 },
      playingTime: { min: 30, max: 120 },
    };
    const vec = encodeGame(game, vocab, [], undefined, ranges);

    // minPlayers: (3-2)/(4-2) = 0.5
    expect(vec.continuous[2]).toBeCloseTo(0.5, 10);
    // maxPlayers: (6-4)/(8-4) = 0.5
    expect(vec.continuous[3]).toBeCloseTo(0.5, 10);
    // bestPlayers: (5-3)/(7-3) = 0.5
    expect(vec.continuous[4]).toBeCloseTo(0.5, 10);
    // playingTime: (90-30)/(120-30) = 60/90 ≈ 0.667
    expect(vec.continuous[5]).toBeCloseTo(60 / 90, 10);
  });

  test("encodes missing best-player counts at the active range midpoint", () => {
    const ranges = {
      minPlayers: { min: 1, max: 5 },
      maxPlayers: { min: 2, max: 8 },
      bestPlayers: { min: 6, max: 10 },
      playingTime: { min: 30, max: 120 },
    };

    const vec = encodeGame(
      makeGame({ bestPlayers: null }),
      { mechanics: [], categories: [] },
      [],
      undefined,
      ranges,
    );

    expect(vec.continuous[4]).toBe(0.5);
  });
});

describe("computeContinuousRanges", () => {
  test("computes observed min/max from collection", () => {
    const games = [
      makeGame({ minPlayers: 2, maxPlayers: 4, bestPlayers: 3, playingTime: 30 }),
      makeGame({ minPlayers: 3, maxPlayers: 8, bestPlayers: 6, playingTime: 120 }),
      makeGame({ minPlayers: 1, maxPlayers: 6, bestPlayers: 4, playingTime: 60 }),
    ];

    const ranges = computeContinuousRanges(games);
    expect(ranges.minPlayers).toEqual({ min: 1, max: 3 });
    expect(ranges.maxPlayers).toEqual({ min: 4, max: 8 });
    expect(ranges.bestPlayers).toEqual({ min: 3, max: 6 });
    expect(ranges.playingTime).toEqual({ min: 30, max: 120 });
  });

  test("falls back to defaults when no games have the field", () => {
    const games = [
      makeGame({ minPlayers: null, maxPlayers: null, bestPlayers: null, playingTime: null }),
    ];

    const ranges = computeContinuousRanges(games);
    expect(ranges.minPlayers).toEqual({ min: 1, max: 10 });
    expect(ranges.maxPlayers).toEqual({ min: 1, max: 10 });
    expect(ranges.bestPlayers).toEqual({ min: 1, max: 10 });
    expect(ranges.playingTime).toEqual({ min: 0, max: 300 });
  });
});

describe("jaccardDistance", () => {
  test("rejects dimension mismatches", () => {
    expect(() => jaccardDistance([1, 0], [1])).toThrow(
      "jaccardDistance: dimension mismatch (a.length=2, b.length=1)",
    );
  });

  test.each([
    ["NaN", [Number.NaN], [0], "vector=a, index=0, value=NaN"],
    ["positive infinity", [0], [Number.POSITIVE_INFINITY], "vector=b, index=0, value=Infinity"],
    ["negative infinity", [Number.NEGATIVE_INFINITY], [0], "vector=a, index=0, value=-Infinity"],
  ] as const)("rejects %s elements", (_name, a, b, detail) => {
    expect(() => jaccardDistance([...a], [...b])).toThrow(
      `jaccardDistance: non-finite vector element (${detail})`,
    );
  });

  test("identical sets return 0", () => {
    expect(jaccardDistance([1, 0, 1], [1, 0, 1])).toBe(0);
  });

  test("disjoint sets return 1", () => {
    expect(jaccardDistance([1, 0, 0], [0, 1, 1])).toBe(1);
  });

  test("partial overlap returns correct fraction", () => {
    // A = {0, 2}, B = {0, 1} → intersection = {0}, union = {0, 1, 2}
    const d = jaccardDistance([1, 0, 1], [1, 1, 0]);
    expect(d).toBeCloseTo(1 - 1 / 3, 10);
  });

  test("both empty returns 0", () => {
    expect(jaccardDistance([0, 0, 0], [0, 0, 0])).toBe(0);
    expect(jaccardDistance([], [])).toBe(0);
  });

  test("handles frequency vectors (centroid comparison)", () => {
    // Game binary [1, 0, 1] vs centroid frequency [0.8, 0.2, 0.6]
    // minSum = min(1,0.8) + min(0,0.2) + min(1,0.6) = 0.8 + 0 + 0.6 = 1.4
    // maxSum = max(1,0.8) + max(0,0.2) + max(1,0.6) = 1 + 0.2 + 1 = 2.2
    // distance = 1 - 1.4/2.2 ≈ 0.3636
    const d = jaccardDistance([1, 0, 1], [0.8, 0.2, 0.6]);
    expect(d).toBeCloseTo(1 - 1.4 / 2.2, 10);
  });

  test("centroid with high frequency correctly reduces distance", () => {
    // Game has mechanic A, centroid says 80% of collection has it → low distance contribution
    // Game lacks mechanic B, centroid says 10% have it → small distance contribution
    const game = [1, 0];
    const centroid = [0.8, 0.1];
    const d = jaccardDistance(game, centroid);
    // minSum = 0.8 + 0 = 0.8, maxSum = 1 + 0.1 = 1.1
    expect(d).toBeCloseTo(1 - 0.8 / 1.1, 10);
    // Should be significantly less than 1 (not inflated)
    expect(d).toBeLessThan(0.5);
  });
});

describe("normalizedManhattanDistance", () => {
  test("rejects dimension mismatches", () => {
    expect(() => normalizedManhattanDistance([1, 0], [1])).toThrow(
      "normalizedManhattanDistance: dimension mismatch (a.length=2, b.length=1)",
    );
  });

  test.each([
    ["NaN", [Number.NaN], [0], "vector=a, index=0, value=NaN"],
    ["positive infinity", [0], [Number.POSITIVE_INFINITY], "vector=b, index=0, value=Infinity"],
    ["negative infinity", [Number.NEGATIVE_INFINITY], [0], "vector=a, index=0, value=-Infinity"],
  ] as const)("rejects %s elements", (_name, a, b, detail) => {
    expect(() => normalizedManhattanDistance([...a], [...b])).toThrow(
      `normalizedManhattanDistance: non-finite vector element (${detail})`,
    );
  });

  test("identical values return 0", () => {
    expect(normalizedManhattanDistance([0.5, 0.5], [0.5, 0.5])).toBe(0);
  });

  test("maximum difference returns 1", () => {
    expect(normalizedManhattanDistance([0, 0], [1, 1])).toBe(1);
  });

  test("partial difference returns correct value", () => {
    // |0.2 - 0.8| + |0.5 - 0.5| = 0.6, / 2 = 0.3
    expect(normalizedManhattanDistance([0.2, 0.5], [0.8, 0.5])).toBeCloseTo(0.3, 10);
  });

  test("empty vectors return 0", () => {
    expect(normalizedManhattanDistance([], [])).toBe(0);
  });
});

describe("compositeDistance", () => {
  test("returns per-component distances and weighted composite", () => {
    const a: FeatureVector = {
      binary: [1, 0, 1],
      continuous: [0.5, 0.5],
      personalAxes: [0.8, 0.2],
    };
    const b: FeatureVector = {
      binary: [1, 1, 0],
      continuous: [0.3, 0.7],
      personalAxes: [0.6, 0.4],
    };

    const result = compositeDistance(a, b);

    expect(result.binary).toBeCloseTo(1 - 1 / 3, 10); // Jaccard
    const expectedContinuous = (Math.abs(0.5 - 0.3) + Math.abs(0.5 - 0.7)) / 2;
    expect(result.continuous).toBeCloseTo(expectedContinuous, 10);
    const expectedPersonal = (Math.abs(0.8 - 0.6) + Math.abs(0.2 - 0.4)) / 2;
    expect(result.personalAxes).toBeCloseTo(expectedPersonal, 10);

    const expectedComposite =
      0.4 * result.binary + 0.3 * result.continuous + 0.3 * result.personalAxes!;
    expect(result.composite).toBeCloseTo(expectedComposite, 10);
  });

  test("redistributes weights when personal axes are null", () => {
    const a: FeatureVector = { binary: [1, 0], continuous: [0.5], personalAxes: null };
    const b: FeatureVector = { binary: [0, 1], continuous: [1.0], personalAxes: null };

    const result = compositeDistance(a, b);

    expect(result.personalAxes).toBeNull();

    // Weights redistribute: binary 0.4/(0.4+0.3) ≈ 0.571, continuous 0.3/(0.4+0.3) ≈ 0.429
    const wBinary = 0.4 / 0.7;
    const wContinuous = 0.3 / 0.7;
    const expectedComposite = wBinary * result.binary + wContinuous * result.continuous;
    expect(result.composite).toBeCloseTo(expectedComposite, 10);
  });

  test("accepts custom weights", () => {
    const a: FeatureVector = { binary: [1], continuous: [0], personalAxes: [0] };
    const b: FeatureVector = { binary: [0], continuous: [1], personalAxes: [1] };

    const result = compositeDistance(a, b, { binary: 0.5, continuous: 0.25, personalAxes: 0.25 });

    // binary: Jaccard 1, continuous: Manhattan 1, personal: Manhattan 1
    expect(result.composite).toBeCloseTo(0.5 * 1 + 0.25 * 1 + 0.25 * 1, 10);
  });

  test("rejects mismatched personalAxes dimensions", () => {
    // Regression: silently iterating off the end of the shorter vector produced
    // NaN distances that serialized to `null` in stored profiles. Dimension
    // mismatches must now surface as thrown errors so the caller knows to
    // build fixed-shape vectors before comparing.
    const a: FeatureVector = { binary: [1, 0], continuous: [0.5], personalAxes: [0.5, 0.5] };
    const b: FeatureVector = { binary: [0, 1], continuous: [0.7], personalAxes: [0.5] };

    expect(() => compositeDistance(a, b)).toThrow(/dimension mismatch/);
  });
});

describe("computeCentroid", () => {
  test("centroid of a single game equals that game's vector", () => {
    const v: FeatureVector = {
      binary: [1, 0, 1],
      continuous: [0.5, 0.8],
      personalAxes: [0.3],
    };

    const centroid = computeCentroid([v]);
    expect(centroid.binary).toEqual([1, 0, 1]);
    expect(centroid.continuous).toEqual([0.5, 0.8]);
    expect(centroid.personalAxes).toEqual([0.3]);
  });

  test("centroid of multiple games produces mean values", () => {
    const v1: FeatureVector = {
      binary: [1, 0, 1],
      continuous: [0.2, 0.6],
      personalAxes: [0.4, 0.8],
    };
    const v2: FeatureVector = {
      binary: [0, 1, 1],
      continuous: [0.8, 0.4],
      personalAxes: [0.6, 0.2],
    };

    const centroid = computeCentroid([v1, v2]);
    expect(centroid.binary).toEqual([0.5, 0.5, 1]);
    expect(centroid.continuous).toEqual([0.5, 0.5]);
    expect(centroid.personalAxes).toEqual([0.5, 0.5]);
  });

  test("handles mixed null personalAxes", () => {
    const v1: FeatureVector = { binary: [1], continuous: [0.5], personalAxes: [0.8] };
    const v2: FeatureVector = { binary: [0], continuous: [0.5], personalAxes: null };

    const centroid = computeCentroid([v1, v2]);
    expect(centroid.binary).toEqual([0.5]);
    expect(centroid.continuous).toEqual([0.5]);
    // Only v1 has personalAxes, so centroid = v1's values
    expect(centroid.personalAxes).toEqual([0.8]);
  });

  test("returns null personalAxes when all vectors have null", () => {
    const v1: FeatureVector = { binary: [1], continuous: [0.5], personalAxes: null };
    const v2: FeatureVector = { binary: [0], continuous: [0.3], personalAxes: null };

    const centroid = computeCentroid([v1, v2]);
    expect(centroid.personalAxes).toBeNull();
  });

  test("empty input returns empty centroid", () => {
    const centroid = computeCentroid([]);
    expect(centroid.binary).toEqual([]);
    expect(centroid.continuous).toEqual([]);
    expect(centroid.personalAxes).toBeNull();
  });
});

describe("cosineSimilarity", () => {
  test("rejects dimension mismatches", () => {
    expect(() => cosineSimilarity([1, 2], [1])).toThrow(/dimension mismatch/);
  });

  test.each([
    ["NaN", [Number.NaN], [0], "vector=a, index=0, value=NaN"],
    ["positive infinity", [0], [Number.POSITIVE_INFINITY], "vector=b, index=0, value=Infinity"],
    ["negative infinity", [Number.NEGATIVE_INFINITY], [0], "vector=a, index=0, value=-Infinity"],
  ] as const)("rejects %s elements", (_name, a, b, detail) => {
    expect(() => cosineSimilarity([...a], [...b])).toThrow(
      `cosineSimilarity: non-finite vector element (${detail})`,
    );
  });

  test("identical vectors return 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  test("orthogonal vectors return 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  test("proportional vectors return 1", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });

  test("zero vector returns 0", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  test("partial similarity returns correct value", () => {
    // [1,0] · [1,1] = 1, |[1,0]| = 1, |[1,1]| = sqrt(2)
    const sim = cosineSimilarity([1, 0], [1, 1]);
    expect(sim).toBeCloseTo(1 / Math.sqrt(2), 10);
  });
});
