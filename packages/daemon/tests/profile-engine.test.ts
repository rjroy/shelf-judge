import { describe, expect, test } from "bun:test";
import type {
  Axis,
  BggGameData,
  FitnessResult,
  Game,
  TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import {
  computeAxisDistributions,
  computeAxisWeights,
  computeBggClustering,
  computeDivergence,
  computeProfile,
  detectOutliers,
  extractUtilityCurves,
  generateSuggestions,
} from "../src/services/profile-engine.js";

// --- Test helpers ---

function makeGame(overrides: Partial<Game> & { id: string; name: string }): Game {
  return {
    bggId: null,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeBggData(overrides: Partial<BggGameData> = {}): BggGameData {
  return {
    communityRating: 7.5,
    bayesAverage: 7.0,
    weight: 3.0,
    numWeightVotes: 100,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    suggestedPlayerCounts: [],
    fetchedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAxis(overrides: Partial<Axis> & { id: string; name: string }): Axis {
  return {
    description: null,
    weight: 50,
    source: "personal",
    bggField: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFitness(score: number, vetoed = false): FitnessResult {
  return {
    score,
    ratedAxisCount: 1,
    totalAxisCount: 1,
    breakdown: [],
    vetoed,
    vetoedBy: null,
    hypotheticalScore: vetoed ? score : null,
    predictionMeta: null,
  };
}

function makeTournamentStats(
  normalizedScore: number | null,
  comparisonCount = 10,
): TournamentGameStatsDisplay {
  return {
    eloRating: 1500,
    comparisonCount,
    normalizedScore,
    isProvisional: false,
    displayLabel: normalizedScore !== null ? `${normalizedScore}` : "not yet ranked",
    wins: 5,
    losses: 5,
    recentComparisons: [],
  };
}

// --- Axis Distributions ---

describe("computeAxisDistributions", () => {
  test("hand-calculated mean/median/stddev/range for a 5-game, 3-axis dataset", () => {
    const axes = [
      makeAxis({ id: "a1", name: "Fun" }),
      makeAxis({ id: "a2", name: "Strategy" }),
      makeAxis({ id: "a3", name: "Art" }),
    ];

    // Fun ratings: 2, 4, 6, 8, 10
    // Mean = 6, Median = 6, StdDev = sqrt(((4+1+0+1+4)*4)/5... let me compute
    // Variance = ((2-6)^2 + (4-6)^2 + (6-6)^2 + (8-6)^2 + (10-6)^2) / 5
    //          = (16 + 4 + 0 + 4 + 16) / 5 = 40/5 = 8
    // StdDev = sqrt(8) ≈ 2.828
    const games = [
      makeGame({ id: "g1", name: "G1", ratings: { a1: 2, a2: 5, a3: 7 } }),
      makeGame({ id: "g2", name: "G2", ratings: { a1: 4, a2: 5, a3: 8 } }),
      makeGame({ id: "g3", name: "G3", ratings: { a1: 6, a2: 5, a3: 9 } }),
      makeGame({ id: "g4", name: "G4", ratings: { a1: 8, a2: 7 } }),
      makeGame({ id: "g5", name: "G5", ratings: { a1: 10, a2: 3 } }),
    ];

    const result = computeAxisDistributions(games, axes);

    // Fun: [2,4,6,8,10] → mean=6, median=6, stddev=sqrt(8)
    const fun = result.find((d) => d.axisId === "a1")!;
    expect(fun.mean).toBe(6);
    expect(fun.median).toBe(6);
    expect(fun.standardDeviation).toBeCloseTo(Math.sqrt(8), 10);
    expect(fun.range).toEqual({ min: 2, max: 10 });
    expect(fun.ratedGameCount).toBe(5);
    // Histogram: bucket[1]=1(rating 2), bucket[3]=1(rating 4), bucket[5]=1(rating 6),
    //            bucket[7]=1(rating 8), bucket[9]=1(rating 10)
    expect(fun.histogram).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);

    // Strategy: [5,5,5,7,3] → mean=5, median=5
    // Variance = (0+0+0+4+4)/5 = 1.6, stddev = sqrt(1.6)
    const strategy = result.find((d) => d.axisId === "a2")!;
    expect(strategy.mean).toBe(5);
    expect(strategy.median).toBe(5);
    expect(strategy.standardDeviation).toBeCloseTo(Math.sqrt(1.6), 10);
    expect(strategy.range).toEqual({ min: 3, max: 7 });
    expect(strategy.ratedGameCount).toBe(5);
    // Histogram: bucket[2]=1(rating 3), bucket[4]=3(rating 5), bucket[6]=1(rating 7)
    expect(strategy.histogram).toEqual([0, 0, 1, 0, 3, 0, 1, 0, 0, 0]);

    // Art: [7,8,9] → mean=8, median=8
    // Variance = (1+0+1)/3 = 2/3, stddev = sqrt(2/3)
    const art = result.find((d) => d.axisId === "a3")!;
    expect(art.mean).toBe(8);
    expect(art.median).toBe(8);
    expect(art.standardDeviation).toBeCloseTo(Math.sqrt(2 / 3), 10);
    expect(art.range).toEqual({ min: 7, max: 9 });
    expect(art.ratedGameCount).toBe(3);
    // Histogram: bucket[6]=1(rating 7), bucket[7]=1(rating 8), bucket[8]=1(rating 9)
    expect(art.histogram).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 0]);
  });

  test("axis with no ratings returns zeroed distribution", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun" })];
    const games = [makeGame({ id: "g1", name: "G1" })];

    const result = computeAxisDistributions(games, axes);
    expect(result[0].mean).toBe(0);
    expect(result[0].median).toBe(0);
    expect(result[0].standardDeviation).toBe(0);
    expect(result[0].ratedGameCount).toBe(0);
    expect(result[0].histogram).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("median for even number of ratings averages middle two", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun" })];
    // Ratings: 3, 5, 7, 9 → median = (5+7)/2 = 6
    const games = [
      makeGame({ id: "g1", name: "G1", ratings: { a1: 3 } }),
      makeGame({ id: "g2", name: "G2", ratings: { a1: 5 } }),
      makeGame({ id: "g3", name: "G3", ratings: { a1: 7 } }),
      makeGame({ id: "g4", name: "G4", ratings: { a1: 9 } }),
    ];

    const result = computeAxisDistributions(games, axes);
    expect(result[0].median).toBe(6);
  });

  test("single rating returns that value for all statistics", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun" })];
    const games = [makeGame({ id: "g1", name: "G1", ratings: { a1: 7 } })];

    const result = computeAxisDistributions(games, axes);
    expect(result[0].mean).toBe(7);
    expect(result[0].median).toBe(7);
    expect(result[0].standardDeviation).toBe(0);
    expect(result[0].range).toEqual({ min: 7, max: 7 });
  });
});

// --- Axis Weights ---

describe("computeAxisWeights", () => {
  test("computes percentages and sorts descending", () => {
    const axes = [
      makeAxis({ id: "a1", name: "Fun", weight: 60 }),
      makeAxis({ id: "a2", name: "Strategy", weight: 30 }),
      makeAxis({ id: "a3", name: "Art", weight: 10 }),
    ];

    const result = computeAxisWeights(axes);
    expect(result[0].axisName).toBe("Fun");
    expect(result[0].percentage).toBe(60);
    expect(result[1].axisName).toBe("Strategy");
    expect(result[1].percentage).toBe(30);
    expect(result[2].axisName).toBe("Art");
    expect(result[2].percentage).toBe(10);
  });

  test("returns empty array for no axes", () => {
    expect(computeAxisWeights([])).toEqual([]);
  });

  test("single axis gets 100%", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun", weight: 42 })];
    const result = computeAxisWeights(axes);
    expect(result[0].percentage).toBe(100);
  });
});

// --- BGG Clustering ---

describe("computeBggClustering", () => {
  test("correct counts and percentages for mechanics, categories, subdomains", () => {
    const games = [
      makeGame({
        id: "g1",
        name: "G1",
        bggData: makeBggData({
          mechanics: [
            { id: 1, name: "Dice Rolling" },
            { id: 2, name: "Hand Management" },
          ],
          categories: [{ id: 10, name: "Adventure" }],
          families: [{ id: 50, name: "Eurogames" }],
          subdomains: [{ id: 100, name: "Strategy Games" }],
        }),
      }),
      makeGame({
        id: "g2",
        name: "G2",
        bggData: makeBggData({
          mechanics: [{ id: 2, name: "Hand Management" }],
          categories: [
            { id: 10, name: "Adventure" },
            { id: 11, name: "Fantasy" },
          ],
          families: [{ id: 50, name: "Eurogames" }],
          subdomains: [{ id: 100, name: "Strategy Games" }],
        }),
      }),
      makeGame({
        id: "g3",
        name: "G3",
        bggData: makeBggData({
          mechanics: [{ id: 3, name: "Worker Placement" }],
          categories: [{ id: 12, name: "Economic" }],
          families: [{ id: 51, name: "Ameritrash" }],
          subdomains: [{ id: 101, name: "Family Games" }],
        }),
      }),
      // Game without BGG data: excluded from denominators
      makeGame({ id: "g4", name: "G4" }),
    ];

    const result = computeBggClustering(games);

    // Mechanics: Hand Management=2 (66.7%), Dice Rolling=1, Worker Placement=1
    expect(result.mechanics[0]).toEqual({
      name: "Hand Management",
      count: 2,
      percentage: (2 / 3) * 100,
    });
    expect(result.mechanics.length).toBe(3);

    // Categories: Adventure=2 (66.7%), Fantasy=1, Economic=1
    expect(result.categories[0]).toEqual({
      name: "Adventure",
      count: 2,
      percentage: (2 / 3) * 100,
    });

    // Subdomains: Strategy Games=2, Family Games=1
    expect(result.subdomains[0]).toEqual({
      name: "Strategy Games",
      count: 2,
      percentage: (2 / 3) * 100,
    });

    // Families: Eurogames=2, Ameritrash=1
    expect(result.families[0]).toEqual({
      name: "Eurogames",
      count: 2,
      percentage: (2 / 3) * 100,
    });
  });

  test("weight range boundaries: 2.0 goes in Medium-Light, 3.5 goes in Heavy", () => {
    const games = [
      makeGame({ id: "g1", name: "G1", bggData: makeBggData({ weight: 1.0 }) }), // Light
      makeGame({ id: "g2", name: "G2", bggData: makeBggData({ weight: 2.0 }) }), // Medium-Light (boundary)
      makeGame({ id: "g3", name: "G3", bggData: makeBggData({ weight: 2.5 }) }), // Medium (boundary)
      makeGame({ id: "g4", name: "G4", bggData: makeBggData({ weight: 3.0 }) }), // Medium-Heavy (boundary)
      makeGame({ id: "g5", name: "G5", bggData: makeBggData({ weight: 3.5 }) }), // Heavy (boundary)
      makeGame({ id: "g6", name: "G6", bggData: makeBggData({ weight: 5.0 }) }), // Heavy (max)
    ];

    const result = computeBggClustering(games);
    const ranges = result.weightRanges;

    const light = ranges.find((r) => r.range === "Light")!;
    expect(light.count).toBe(1); // only 1.0

    const medLight = ranges.find((r) => r.range === "Medium-Light")!;
    expect(medLight.count).toBe(1); // 2.0

    const medium = ranges.find((r) => r.range === "Medium")!;
    expect(medium.count).toBe(1); // 2.5

    const medHeavy = ranges.find((r) => r.range === "Medium-Heavy")!;
    expect(medHeavy.count).toBe(1); // 3.0

    const heavy = ranges.find((r) => r.range === "Heavy")!;
    expect(heavy.count).toBe(2); // 3.5 and 5.0
  });

  test("games without BGG weight excluded from weight range denominator", () => {
    const games = [
      makeGame({ id: "g1", name: "G1", bggData: makeBggData({ weight: 2.0 }) }),
      makeGame({ id: "g2", name: "G2", bggData: makeBggData({ weight: null }) }),
    ];

    const result = computeBggClustering(games);
    const medLight = result.weightRanges.find((r) => r.range === "Medium-Light")!;
    expect(medLight.count).toBe(1);
    expect(medLight.percentage).toBe(100); // 1/1, not 1/2
  });

  test("empty collection returns empty clusters", () => {
    const result = computeBggClustering([]);
    expect(result.mechanics).toEqual([]);
    expect(result.categories).toEqual([]);
    expect(result.subdomains).toEqual([]);
    expect(result.families).toEqual([]);
    expect(result.weightRanges.every((r) => r.count === 0)).toBe(true);
  });
});

// --- Utility Curves ---

describe("extractUtilityCurves", () => {
  test("extracts axes with non-default curve config", () => {
    const axes = [
      makeAxis({ id: "a1", name: "Fun" }), // no curve config → excluded
      makeAxis({
        id: "a2",
        name: "Weight",
        source: "bgg",
        bggField: "weight",
        preferenceShape: "sweet-spot",
        idealValue: 3.0,
        tolerance: "moderate",
      }),
      makeAxis({
        id: "a3",
        name: "Depth",
        preferenceShape: "higher-is-better",
        veto: { direction: "below", threshold: 3 },
      }),
    ];

    const result = extractUtilityCurves(axes);
    expect(result.length).toBe(2);
    expect(result[0].axisId).toBe("a2");
    expect(result[0].shape).toBe("sweet-spot");
    expect(result[0].idealValue).toBe(3.0);
    expect(result[0].nativeScale).toEqual({ min: 1, max: 5 });
    expect(result[1].axisId).toBe("a3");
    expect(result[1].vetoThreshold).toEqual({ direction: "below", threshold: 3 });
    expect(result[1].nativeScale).toEqual({ min: 1, max: 10 });
  });

  test("returns empty for axes with no curve config", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun" })];
    expect(extractUtilityCurves(axes)).toEqual([]);
  });
});

// --- Divergence ---

describe("computeDivergence", () => {
  test("games above 1.5-point threshold flagged in both directions", () => {
    const games = [
      makeGame({ id: "g1", name: "Tournament Favorite" }),
      makeGame({ id: "g2", name: "Fitness Favorite" }),
    ];
    const fitnessResults = new Map<string, FitnessResult>([
      ["g1", makeFitness(4.0)], // low fitness
      ["g2", makeFitness(8.5)], // high fitness
    ]);
    const tournamentStats = new Map<string, TournamentGameStatsDisplay>([
      ["g1", makeTournamentStats(7.0)], // high ELO → gap=3.0
      ["g2", makeTournamentStats(5.0)], // low ELO → gap=3.5
    ]);

    const result = computeDivergence(fitnessResults, tournamentStats, games)!;
    expect(result.length).toBe(2);

    // Sorted by gap descending
    expect(result[0].gameName).toBe("Fitness Favorite");
    expect(result[0].gap).toBe(3.5);
    expect(result[0].direction).toBe("fitness-outlier"); // high fitness, low ELO

    expect(result[1].gameName).toBe("Tournament Favorite");
    expect(result[1].gap).toBe(3.0);
    expect(result[1].direction).toBe("tournament-outlier"); // high ELO, low fitness
  });

  test("games with null normalized score excluded", () => {
    const games = [makeGame({ id: "g1", name: "G1" })];
    const fitnessResults = new Map([["g1", makeFitness(5.0)]]);
    const tournamentStats = new Map([["g1", makeTournamentStats(null, 0)]]);

    const result = computeDivergence(fitnessResults, tournamentStats, games)!;
    expect(result.length).toBe(0);
  });

  test("games with zero fitness (vetoed) excluded", () => {
    const games = [makeGame({ id: "g1", name: "G1" })];
    const fitnessResults = new Map([["g1", makeFitness(0, true)]]);
    const tournamentStats = new Map([["g1", makeTournamentStats(8.0)]]);

    const result = computeDivergence(fitnessResults, tournamentStats, games)!;
    expect(result.length).toBe(0);
  });

  test("returns null when tournament stats is empty", () => {
    const games = [makeGame({ id: "g1", name: "G1" })];
    const fitnessResults = new Map([["g1", makeFitness(5.0)]]);
    const tournamentStats = new Map<string, TournamentGameStatsDisplay>();

    expect(computeDivergence(fitnessResults, tournamentStats, games)).toBeNull();
  });

  test("gap exactly 1.5 is not flagged (> not >=)", () => {
    const games = [makeGame({ id: "g1", name: "G1" })];
    const fitnessResults = new Map([["g1", makeFitness(5.0)]]);
    const tournamentStats = new Map([["g1", makeTournamentStats(6.5)]]);

    const result = computeDivergence(fitnessResults, tournamentStats, games)!;
    expect(result.length).toBe(0);
  });
});

// --- Outlier Detection ---

describe("detectOutliers", () => {
  // Build a collection of similar medium euro games + one heavy wargame outlier
  const euroMechanics = [
    { id: 1, name: "Worker Placement" },
    { id: 2, name: "Set Collection" },
  ];
  const euroCategories = [{ id: 10, name: "Economic" }];
  const warMechanics = [
    { id: 3, name: "Hex-and-Counter" },
    { id: 4, name: "Dice Rolling" },
  ];
  const warCategories = [{ id: 11, name: "Wargame" }];

  function makeEuroGame(id: string, name: string): Game {
    return makeGame({
      id,
      name,
      minPlayers: 2,
      maxPlayers: 4,
      playingTime: 90,
      bggData: makeBggData({
        weight: 3.0,
        communityRating: 7.5,
        mechanics: euroMechanics,
        categories: euroCategories,
        subdomains: [{ id: 100, name: "Strategy Games" }],
      }),
      ratings: { a1: 7 },
    });
  }

  const axes = [makeAxis({ id: "a1", name: "Fun" })];

  test("a deliberate outlier (heavy wargame in medium euros) is flagged", () => {
    const games = [
      makeEuroGame("e1", "Euro 1"),
      makeEuroGame("e2", "Euro 2"),
      makeEuroGame("e3", "Euro 3"),
      makeEuroGame("e4", "Euro 4"),
      makeEuroGame("e5", "Euro 5"),
      makeGame({
        id: "war1",
        name: "Heavy Wargame",
        minPlayers: 2,
        maxPlayers: 2,
        playingTime: 240,
        bggData: makeBggData({
          weight: 4.5,
          communityRating: 8.0,
          mechanics: warMechanics,
          categories: warCategories,
          subdomains: [{ id: 101, name: "War Games" }],
        }),
        ratings: { a1: 6 },
      }),
    ];

    const fitnessResults = new Map<string, FitnessResult>([
      ["e1", makeFitness(7.0)],
      ["e2", makeFitness(7.2)],
      ["e3", makeFitness(6.8)],
      ["e4", makeFitness(7.1)],
      ["e5", makeFitness(7.3)],
      ["war1", makeFitness(6.0)],
    ]);

    const outliers = detectOutliers(games, axes, fitnessResults);
    const warOutlier = outliers.find((o) => o.gameId === "war1");
    expect(warOutlier).toBeDefined();
    expect(warOutlier!.gameName).toBe("Heavy Wargame");
  });

  test("game unusual on only one dimension is not flagged", () => {
    // All euros but one has slightly different weight
    const games = [
      makeEuroGame("e1", "Euro 1"),
      makeEuroGame("e2", "Euro 2"),
      makeEuroGame("e3", "Euro 3"),
      makeEuroGame("e4", "Euro 4"),
      makeGame({
        id: "e5",
        name: "Slightly Heavy Euro",
        minPlayers: 2,
        maxPlayers: 4,
        playingTime: 90,
        bggData: makeBggData({
          weight: 3.8, // only different dimension
          communityRating: 7.5,
          mechanics: euroMechanics,
          categories: euroCategories,
          subdomains: [{ id: 100, name: "Strategy Games" }],
        }),
        ratings: { a1: 7 },
      }),
    ];

    const fitnessResults = new Map<string, FitnessResult>();
    const outliers = detectOutliers(games, axes, fitnessResults);
    const oddOne = outliers.find((o) => o.gameId === "e5");
    expect(oddOne).toBeUndefined();
  });

  test("category orphan classification: game in unique category", () => {
    const games = [
      makeEuroGame("e1", "Euro 1"),
      makeEuroGame("e2", "Euro 2"),
      makeEuroGame("e3", "Euro 3"),
      makeEuroGame("e4", "Euro 4"),
      makeEuroGame("e5", "Euro 5"),
      makeGame({
        id: "war1",
        name: "Lone Wargame",
        minPlayers: 2,
        maxPlayers: 2,
        playingTime: 240,
        bggData: makeBggData({
          weight: 4.5,
          communityRating: 8.0,
          mechanics: warMechanics,
          categories: warCategories, // "Wargame" only appears once
          subdomains: [{ id: 101, name: "War Games" }],
        }),
        ratings: { a1: 6 },
      }),
    ];

    const fitnessResults = new Map<string, FitnessResult>();
    const outliers = detectOutliers(games, axes, fitnessResults);
    const warOutlier = outliers.find((o) => o.gameId === "war1");
    expect(warOutlier).toBeDefined();
    expect(warOutlier!.classifications).toContain("category-orphan");
  });

  test("lone wolf classification: game sharing zero mechanics with others", () => {
    const games = [
      makeEuroGame("e1", "Euro 1"),
      makeEuroGame("e2", "Euro 2"),
      makeEuroGame("e3", "Euro 3"),
      makeEuroGame("e4", "Euro 4"),
      makeEuroGame("e5", "Euro 5"),
      makeGame({
        id: "odd1",
        name: "Truly Unique",
        minPlayers: 1,
        maxPlayers: 1,
        playingTime: 300,
        bggData: makeBggData({
          weight: 4.8,
          communityRating: 9.0,
          mechanics: [{ id: 99, name: "Totally Unique Mechanic" }],
          categories: [{ id: 99, name: "Totally Unique Category" }],
          subdomains: [],
        }),
        ratings: { a1: 2 },
      }),
    ];

    const fitnessResults = new Map<string, FitnessResult>();
    const outliers = detectOutliers(games, axes, fitnessResults);
    const oddOutlier = outliers.find((o) => o.gameId === "odd1");
    expect(oddOutlier).toBeDefined();
    expect(oddOutlier!.classifications).toContain("lone-wolf");
  });

  test("high-fitness outlier classification: game with fitness score and outlier distance", () => {
    const games = [
      makeEuroGame("e1", "Euro 1"),
      makeEuroGame("e2", "Euro 2"),
      makeEuroGame("e3", "Euro 3"),
      makeEuroGame("e4", "Euro 4"),
      makeEuroGame("e5", "Euro 5"),
      makeGame({
        id: "war1",
        name: "Fit Wargame",
        minPlayers: 2,
        maxPlayers: 2,
        playingTime: 240,
        bggData: makeBggData({
          weight: 4.5,
          communityRating: 8.0,
          mechanics: warMechanics,
          categories: warCategories,
          subdomains: [],
        }),
        ratings: { a1: 9 },
      }),
    ];

    const fitnessResults = new Map<string, FitnessResult>([["war1", makeFitness(8.5)]]);

    const outliers = detectOutliers(games, axes, fitnessResults);
    const warOutlier = outliers.find((o) => o.gameId === "war1");
    expect(warOutlier).toBeDefined();
    expect(warOutlier!.classifications).toContain("high-fitness-outlier");
    expect(warOutlier!.fitnessScore).toBe(8.5);
  });

  test("low-fitness outlier does NOT get high-fitness-outlier classification", () => {
    const games = [
      makeEuroGame("e1", "Euro 1"),
      makeEuroGame("e2", "Euro 2"),
      makeEuroGame("e3", "Euro 3"),
      makeEuroGame("e4", "Euro 4"),
      makeEuroGame("e5", "Euro 5"),
      makeGame({
        id: "war1",
        name: "Poor Fit Wargame",
        minPlayers: 2,
        maxPlayers: 2,
        playingTime: 240,
        bggData: makeBggData({
          weight: 4.5,
          communityRating: 8.0,
          mechanics: warMechanics,
          categories: warCategories,
          subdomains: [],
        }),
        ratings: { a1: 2 },
      }),
    ];

    // Low fitness: axes say "don't keep it"
    const fitnessResults = new Map<string, FitnessResult>([["war1", makeFitness(2.5)]]);

    const outliers = detectOutliers(games, axes, fitnessResults);
    const warOutlier = outliers.find((o) => o.gameId === "war1");
    if (warOutlier) {
      expect(warOutlier.classifications).not.toContain("high-fitness-outlier");
    }
  });

  test("games without BGG data excluded from outlier detection", () => {
    const games = [
      makeEuroGame("e1", "Euro 1"),
      makeEuroGame("e2", "Euro 2"),
      makeEuroGame("e3", "Euro 3"),
      makeEuroGame("e4", "Euro 4"),
      makeGame({ id: "noBgg", name: "No BGG Data" }), // no bggData
    ];

    const fitnessResults = new Map<string, FitnessResult>();
    const outliers = detectOutliers(games, axes, fitnessResults);
    expect(outliers.every((o) => o.gameId !== "noBgg")).toBe(true);
  });

  test("fewer than 3 games with BGG data returns empty", () => {
    const games = [makeEuroGame("e1", "Euro 1"), makeEuroGame("e2", "Euro 2")];
    const fitnessResults = new Map<string, FitnessResult>();
    expect(detectOutliers(games, axes, fitnessResults)).toEqual([]);
  });
});

// --- Suggestions ---

describe("generateSuggestions", () => {
  test("unexpressed concentration: mechanic in 80%+ games with no axis", () => {
    // 5 games, 4 have "Dice Rolling" (80%)
    const games = [
      makeGame({
        id: "g1",
        name: "G1",
        bggData: makeBggData({ mechanics: [{ id: 1, name: "Dice Rolling" }] }),
      }),
      makeGame({
        id: "g2",
        name: "G2",
        bggData: makeBggData({ mechanics: [{ id: 1, name: "Dice Rolling" }] }),
      }),
      makeGame({
        id: "g3",
        name: "G3",
        bggData: makeBggData({ mechanics: [{ id: 1, name: "Dice Rolling" }] }),
      }),
      makeGame({
        id: "g4",
        name: "G4",
        bggData: makeBggData({ mechanics: [{ id: 1, name: "Dice Rolling" }] }),
      }),
      makeGame({
        id: "g5",
        name: "G5",
        bggData: makeBggData({ mechanics: [{ id: 2, name: "Hand Management" }] }),
      }),
    ];

    const axes = [makeAxis({ id: "a1", name: "Fun" })]; // no axis referencing "Dice Rolling"
    const suggestions = generateSuggestions(games, axes, null);

    const concentration = suggestions.filter((s) => s.source === "unexpressed-concentration");
    expect(concentration.length).toBe(1);
    expect(concentration[0].attribute).toBe("Dice Rolling");
    expect(concentration[0].evidence.percentage).toBe(80);
  });

  test("no suggestion when axis name references the mechanic", () => {
    const games = [
      makeGame({
        id: "g1",
        name: "G1",
        bggData: makeBggData({ mechanics: [{ id: 1, name: "Dice Rolling" }] }),
      }),
      makeGame({
        id: "g2",
        name: "G2",
        bggData: makeBggData({ mechanics: [{ id: 1, name: "Dice Rolling" }] }),
      }),
    ];

    // Axis name contains "dice rolling" (case-insensitive)
    const axes = [makeAxis({ id: "a1", name: "Dice Rolling Appeal" })];
    const suggestions = generateSuggestions(games, axes, null);
    const concentration = suggestions.filter((s) => s.source === "unexpressed-concentration");
    expect(concentration.length).toBe(0);
  });

  test("high-variance BGG attribute with no axis triggers suggestion", () => {
    // Play times: 30, 30, 30, 30, 240 → mean=72, stddev ≈ 84, CV ≈ 1.17
    const games = [
      makeGame({ id: "g1", name: "G1", playingTime: 30 }),
      makeGame({ id: "g2", name: "G2", playingTime: 30 }),
      makeGame({ id: "g3", name: "G3", playingTime: 30 }),
      makeGame({ id: "g4", name: "G4", playingTime: 30 }),
      makeGame({ id: "g5", name: "G5", playingTime: 240 }),
    ];

    const axes: Axis[] = []; // no bgg axis for play time
    const suggestions = generateSuggestions(games, axes, null);

    const variance = suggestions.filter((s) => s.source === "high-variance");
    const playTimeSuggestion = variance.find((s) => s.attribute === "play time");
    expect(playTimeSuggestion).toBeDefined();
    expect(playTimeSuggestion!.evidence.variance).toBeGreaterThan(0.5);
  });

  test("no high-variance suggestion when bgg axis already maps the field", () => {
    const games = [
      makeGame({ id: "g1", name: "G1", playingTime: 30 }),
      makeGame({ id: "g2", name: "G2", playingTime: 240 }),
    ];

    const axes = [makeAxis({ id: "a1", name: "Duration", source: "bgg", bggField: "playingTime" })];
    const suggestions = generateSuggestions(games, axes, null);
    const variance = suggestions.filter(
      (s) => s.source === "high-variance" && s.attribute === "play time",
    );
    expect(variance.length).toBe(0);
  });

  test("divergence repair: shared attributes across divergent games", () => {
    const games = [
      makeGame({
        id: "g1",
        name: "G1",
        bggData: makeBggData({
          mechanics: [
            { id: 1, name: "Area Control" },
            { id: 2, name: "Hand Management" },
          ],
        }),
      }),
      makeGame({
        id: "g2",
        name: "G2",
        bggData: makeBggData({
          mechanics: [
            { id: 1, name: "Area Control" },
            { id: 3, name: "Dice Rolling" },
          ],
        }),
      }),
    ];

    const divergent = [
      {
        gameId: "g1",
        gameName: "G1",
        fitnessScore: 4.0,
        normalizedTournamentScore: 8.0,
        gap: 4.0,
        direction: "tournament-outlier" as const,
      },
      {
        gameId: "g2",
        gameName: "G2",
        fitnessScore: 3.0,
        normalizedTournamentScore: 7.0,
        gap: 4.0,
        direction: "tournament-outlier" as const,
      },
    ];

    const axes: Axis[] = [];
    const suggestions = generateSuggestions(games, axes, divergent);
    const repair = suggestions.filter((s) => s.source === "divergence-repair");
    expect(repair.some((s) => s.attribute === "Area Control")).toBe(true);
  });

  test("no divergence repair when fewer than 2 divergent games", () => {
    const games = [
      makeGame({
        id: "g1",
        name: "G1",
        bggData: makeBggData({ mechanics: [{ id: 1, name: "Area Control" }] }),
      }),
    ];

    const divergent = [
      {
        gameId: "g1",
        gameName: "G1",
        fitnessScore: 4.0,
        normalizedTournamentScore: 8.0,
        gap: 4.0,
        direction: "tournament-outlier" as const,
      },
    ];

    const axes: Axis[] = [];
    const suggestions = generateSuggestions(games, axes, divergent);
    expect(suggestions.filter((s) => s.source === "divergence-repair").length).toBe(0);
  });
});

// --- Full Profile (computeProfile) ---

describe("computeProfile", () => {
  test("assembles all sections correctly", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun", weight: 50 })];
    const games = [
      makeGame({
        id: "g1",
        name: "G1",
        ratings: { a1: 7 },
        bggData: makeBggData({
          mechanics: [{ id: 1, name: "Worker Placement" }],
          categories: [{ id: 10, name: "Economic" }],
        }),
      }),
      makeGame({
        id: "g2",
        name: "G2",
        ratings: { a1: 8 },
        bggData: makeBggData({
          mechanics: [{ id: 1, name: "Worker Placement" }],
          categories: [{ id: 10, name: "Economic" }],
        }),
      }),
      makeGame({ id: "g3", name: "G3" }), // no ratings, no BGG data
    ];

    const fitnessResults = new Map<string, FitnessResult>([
      ["g1", makeFitness(7.0)],
      ["g2", makeFitness(8.0)],
    ]);

    const profile = computeProfile({
      games,
      axes,
      fitnessResults,
      tournamentStats: null,
    });

    expect(profile.gameCount).toBe(3);
    expect(profile.ratedGameCount).toBe(2);
    expect(profile.axisDistributions.length).toBe(1);
    expect(profile.axisWeights.length).toBe(1);
    expect(profile.bggClustering.mechanics.length).toBe(1);
    expect(profile.divergence).toBeNull(); // no tournament data
  });

  test("deterministic: identical results on repeated calls", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun", weight: 50 })];
    const games = [
      makeGame({
        id: "g1",
        name: "G1",
        ratings: { a1: 7 },
        bggData: makeBggData({
          mechanics: [{ id: 1, name: "Worker Placement" }],
        }),
      }),
      makeGame({
        id: "g2",
        name: "G2",
        ratings: { a1: 8 },
        bggData: makeBggData({
          mechanics: [{ id: 1, name: "Worker Placement" }],
        }),
      }),
    ];

    const fitnessResults = new Map<string, FitnessResult>([
      ["g1", makeFitness(7.0)],
      ["g2", makeFitness(8.0)],
    ]);

    const input = { games, axes, fitnessResults, tournamentStats: null };
    const profile1 = computeProfile(input);
    const profile2 = computeProfile(input);

    // Compare all sections except computedAt (timestamps will differ)
    expect(profile1.axisDistributions).toEqual(profile2.axisDistributions);
    expect(profile1.axisWeights).toEqual(profile2.axisWeights);
    expect(profile1.bggClustering).toEqual(profile2.bggClustering);
    expect(profile1.utilityCurves).toEqual(profile2.utilityCurves);
    expect(profile1.divergence).toEqual(profile2.divergence);
    expect(profile1.outliers).toEqual(profile2.outliers);
    expect(profile1.suggestions).toEqual(profile2.suggestions);
    expect(profile1.gameCount).toBe(profile2.gameCount);
    expect(profile1.ratedGameCount).toBe(profile2.ratedGameCount);
  });

  test("with tournament data, divergence section is populated", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun" })];
    const games = [
      makeGame({ id: "g1", name: "G1", ratings: { a1: 7 } }),
      makeGame({ id: "g2", name: "G2", ratings: { a1: 3 } }),
    ];

    const fitnessResults = new Map<string, FitnessResult>([
      ["g1", makeFitness(7.0)],
      ["g2", makeFitness(3.0)],
    ]);

    const tournamentStats = new Map<string, TournamentGameStatsDisplay>([
      ["g1", makeTournamentStats(7.0)], // no divergence
      ["g2", makeTournamentStats(8.0)], // gap = 5.0
    ]);

    const profile = computeProfile({
      games,
      axes,
      fitnessResults,
      tournamentStats,
    });

    expect(profile.divergence).not.toBeNull();
    expect(profile.divergence!.length).toBe(1);
    expect(profile.divergence![0].gameId).toBe("g2");
    expect(profile.divergence![0].direction).toBe("tournament-outlier");
  });
});
