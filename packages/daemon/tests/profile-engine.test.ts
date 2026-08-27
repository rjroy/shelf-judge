import { describe, expect, test } from "bun:test";
import type {
  BggGameData,
  FitnessResult,
  Axis,
  EnabledAxis,
  Game,
  PersonalAxis,
  TournamentAxis,
  TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import { CollectionProfileSchema } from "@shelf-judge/shared";
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
import type { ProfileInput } from "../src/services/profile-engine.js";

// --- Test helpers ---

function makeGame(overrides: Partial<Game> & { id: string; name: string }): Game {
  return {
    bggId: null,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
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
    bestPlayerCount: null,
    fetchedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAxis(overrides: Partial<PersonalAxis> & { id: string; name: string }): PersonalAxis {
  return {
    description: null,
    weight: 50,
    enabled: true,
    source: "personal",
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
    redundancyAdjustment: null,
  };
}

function makeDerivedAxis(
  id: string,
  name: string,
  derivedField: "communityRating" | "weight" | "playerCountFit" | "playingTime",
): EnabledAxis {
  const base = {
    id,
    name,
    description: null,
    weight: 50,
    enabled: true as const,
    source: "derived" as const,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  switch (derivedField) {
    case "communityRating":
      return { ...base, derivedField, configuration: {} };
    case "weight":
      return { ...base, derivedField, configuration: {} };
    case "playerCountFit":
      return { ...base, derivedField, configuration: { targetPlayerCount: 4 } };
    case "playingTime":
      return { ...base, derivedField, configuration: { maximumScoringTime: 240 } };
  }
}

function makeTournamentAxis(id: string, name: string): TournamentAxis {
  return {
    id,
    name,
    description: null,
    weight: 50,
    enabled: true,
    source: "tournament",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeDistributionResults(games: Game[], axes: EnabledAxis[]): Map<string, FitnessResult> {
  return new Map(
    games.map((game) => [
      game.id,
      {
        ...makeFitness(5),
        breakdown: axes.map((axis) => ({
          axisId: axis.id,
          axisName: axis.name,
          weight: axis.weight,
          contribution: null,
          source: "personal" as const,
          derivedField: axis.source === "derived" ? axis.derivedField : null,
          sourceValue: null,
          scoringRawValue: null,
          effectiveRating: game.ratings[axis.id] ?? null,
          preferenceShape: "higher-is-better" as const,
          curveAffected: false,
          unit: null,
          provenance: null,
          configurationSummary: null,
          overridden: false,
          overrideValue: null,
          predictionConfidence: null,
          referenceGames: null,
        })),
      },
    ]),
  );
}

function setEffectiveRating(
  results: Map<string, FitnessResult>,
  gameId: string,
  rating: number,
): void {
  const entry = results.get(gameId)?.breakdown[0];
  if (entry === undefined) throw new Error(`Missing distribution fixture for ${gameId}`);
  entry.effectiveRating = rating;
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
  test("uses effective ratings from fitness breakdowns, including derived overrides", () => {
    const axis = makeDerivedAxis("time", "Play Time", "playingTime");
    const result = makeFitness(8);
    result.breakdown = [
      {
        axisId: axis.id,
        axisName: axis.name,
        weight: axis.weight,
        contribution: 8,
        source: "override",
        derivedField: "playingTime",
        sourceValue: 300,
        scoringRawValue: 240,
        effectiveRating: 8,
        preferenceShape: "sweet-spot",
        curveAffected: false,
        unit: "minutes",
        provenance: "Publisher-listed playing time imported from BoardGameGeek",
        configurationSummary: "Scoring cap: 240 minutes",
        overridden: true,
        overrideValue: 8,
        predictionConfidence: null,
        referenceGames: null,
      },
    ];

    const distributions = computeAxisDistributions([axis], new Map([["game", result]]));
    expect(distributions[0].mean).toBe(8);
    expect(distributions[0].range).toEqual({ min: 8, max: 8 });
    expect(distributions[0].histogram[7]).toBe(1);
  });
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

    const result = computeAxisDistributions(axes, makeDistributionResults(games, axes));

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

    const result = computeAxisDistributions(axes, makeDistributionResults(games, axes));
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

    const result = computeAxisDistributions(axes, makeDistributionResults(games, axes));
    expect(result[0].median).toBe(6);
  });

  test("single rating returns that value for all statistics", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun" })];
    const games = [makeGame({ id: "g1", name: "G1", ratings: { a1: 7 } })];

    const result = computeAxisDistributions(axes, makeDistributionResults(games, axes));
    expect(result[0].mean).toBe(7);
    expect(result[0].median).toBe(7);
    expect(result[0].standardDeviation).toBe(0);
    expect(result[0].range).toEqual({ min: 7, max: 7 });
  });

  test("includes BGG-sourced axis values in native scale from bggData", () => {
    const axes = [makeDerivedAxis("w", "Weight", "weight")];
    const games = [
      makeGame({ id: "g1", name: "G1", bggData: makeBggData({ weight: 2.5 }) }),
      makeGame({ id: "g2", name: "G2", bggData: makeBggData({ weight: 3.5 }) }),
      makeGame({ id: "g3", name: "G3", bggData: makeBggData({ weight: 4.0 }) }),
    ];

    const fitnessResults = makeDistributionResults(games, axes);
    setEffectiveRating(fitnessResults, "g1", 4);
    setEffectiveRating(fitnessResults, "g2", 6);
    setEffectiveRating(fitnessResults, "g3", 8);
    const result = computeAxisDistributions(axes, fitnessResults);
    expect(result[0].ratedGameCount).toBe(3);
    expect(result[0].mean).toBe(6);
    expect(result[0].median).toBe(6);
    expect(result[0].range).toEqual({ min: 4, max: 8 });
  });

  test("prefers personal override for BGG axes when both exist", () => {
    const axes = [makeDerivedAxis("cr", "Rating", "communityRating")];
    const games = [
      makeGame({
        id: "g1",
        name: "G1",
        ratings: { cr: 9 },
        bggData: makeBggData({ communityRating: 7.0 }),
      }),
    ];

    const fitnessResults = makeDistributionResults(games, axes);
    setEffectiveRating(fitnessResults, "g1", 9);
    const result = computeAxisDistributions(axes, fitnessResults);
    expect(result[0].ratedGameCount).toBe(1);
    expect(result[0].mean).toBe(9);
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

  test("counts a repeated tag only once per game", () => {
    const games = [
      makeGame({
        id: "g1",
        name: "G1",
        bggData: makeBggData({
          mechanics: [
            { id: 1, name: "Deck Building" },
            { id: 2, name: "Deck Building" },
          ],
        }),
      }),
    ];

    expect(computeBggClustering(games).mechanics).toEqual([
      { name: "Deck Building", count: 1, percentage: 100 },
    ]);
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
  test("declares derived units, provenance, configuration, scale, and numeric width", () => {
    const axis = {
      ...makeDerivedAxis("time", "Play Time", "playingTime"),
      preferenceShape: "sweet-spot" as const,
      idealValue: 90,
      toleranceWidth: 30,
    };
    expect(extractUtilityCurves([axis])).toEqual([
      {
        axisId: "time",
        axisName: "Play Time",
        derivedField: "playingTime",
        shape: "sweet-spot",
        idealValue: 90,
        tolerance: null,
        toleranceWidth: 30,
        leanDirection: null,
        vetoThreshold: null,
        nativeScale: { min: 1, max: 240 },
        unit: "minutes",
        provenance: "Publisher-listed playing time imported from BoardGameGeek",
        configurationSummary: "Scoring cap: 240 minutes",
      },
    ]);
  });
  test("extracts axes with non-default curve config", () => {
    const axes = [
      makeAxis({ id: "a1", name: "Fun" }), // no curve config → excluded
      {
        ...makeDerivedAxis("a2", "Weight", "weight"),
        preferenceShape: "sweet-spot" as const,
        idealValue: 3.0,
        tolerance: "moderate" as const,
      },
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

  test("extracts an axis configured only with a numeric tolerance width", () => {
    const axis = makeAxis({ id: "width-only", name: "Width Only", toleranceWidth: 2 });

    const result = extractUtilityCurves([axis]);
    expect(result).toHaveLength(1);
    expect(result[0]?.axisId).toBe("width-only");
    expect(result[0]?.toleranceWidth).toBe(2);
  });

  test("returns empty for axes with no curve config", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun" })];
    expect(extractUtilityCurves(axes)).toEqual([]);
  });
});

// --- Divergence ---

describe("computeDivergence", () => {
  const personalAxis = makeAxis({ id: "personal", name: "Personal" });
  const tournamentAxis = makeTournamentAxis("tournament", "Tournament");
  const axes = [personalAxis, tournamentAxis];

  function scoredGame(game: Game, independentScore: number, tournamentScore = 5): FitnessResult {
    game.ratings = { personal: independentScore, tournament: tournamentScore };
    const result = makeDistributionResults([game], axes).get(game.id);
    if (result === undefined) throw new Error(`Missing fitness fixture for ${game.id}`);
    return result;
  }

  test("reports both directions using only independent fitness evidence", () => {
    const games = [
      makeGame({ id: "g1", name: "Tournament Favorite" }),
      makeGame({ id: "g2", name: "Fitness Favorite" }),
    ];
    const fitnessResults = new Map<string, FitnessResult>([
      ["g1", scoredGame(games[0], 4, 10)],
      ["g2", scoredGame(games[1], 8.5, 1)],
    ]);
    const tournamentStats = new Map<string, TournamentGameStatsDisplay>([
      ["g1", makeTournamentStats(7.0)], // high ELO → gap=3.0
      ["g2", makeTournamentStats(5.0)], // low ELO → gap=3.5
    ]);

    const result = computeDivergence(fitnessResults, tournamentStats, games, axes)!;
    expect(result.length).toBe(2);

    expect(result[0].status).toBe("reported");
    expect(result[1].status).toBe("reported");
    if (result[0].status !== "reported" || result[1].status !== "reported") return;
    expect(result[0].details).toMatchObject({
      gameName: "Fitness Favorite",
      independentFitnessScore: 8.5,
      gap: 3.5,
      direction: "fitness-outlier",
    });
    expect(result[1].details.direction).toBe("tournament-outlier");
    expect(result[0].evidence[0].measurements.map(({ key }) => key)).toContain(
      "independent-fitness-score",
    );
    expect(
      result.every((insight) => insight.status !== "reported" || insight.confidence === null),
    ).toBe(true);
  });

  test("abstains when the normalized Tournament score is unavailable", () => {
    const game = makeGame({ id: "g1", name: "Unranked Tournament Game" });
    const result = computeDivergence(
      new Map([[game.id, scoredGame(game, 5)]]),
      new Map([[game.id, makeTournamentStats(null, 10)]]),
      [game],
      axes,
    );

    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({ status: "insufficient", reason: "insufficient-coverage" });
    expect(result?.[0]?.sufficiency[0]).toEqual({
      criterion: "normalized Tournament score available",
      observed: 0,
      required: 1,
      met: false,
    });
  });

  test("provisional games expose insufficient sample evidence", () => {
    const games = [makeGame({ id: "g1", name: "G1" })];
    const fitnessResults = new Map([["g1", scoredGame(games[0], 5)]]);
    const weak = makeTournamentStats(8, 5);
    weak.isProvisional = true;
    const tournamentStats = new Map([["g1", weak]]);

    const result = computeDivergence(fitnessResults, tournamentStats, games, axes)!;
    expect(result[0].status).toBe("insufficient");
    if (result[0].status !== "insufficient") return;
    expect(result[0].reason).toBe("insufficient-sample");
    expect(result[0].cohort).toMatchObject({
      includedGameCount: 0,
      excludedGameCount: 1,
      coveragePercent: 0,
    });
    expect(result[0].sufficiency[0]).toEqual({
      criterion: "comparisons for subject game",
      observed: 5,
      required: 6,
      met: false,
    });
  });

  test("abstains when Tournament is the only scored axis", () => {
    const games = [makeGame({ id: "g1", name: "G1" })];
    games[0].ratings = { tournament: 8 };
    const fitnessResults = makeDistributionResults([games[0]], [tournamentAxis]);
    const tournamentStats = new Map([["g1", makeTournamentStats(8.0)]]);

    const result = computeDivergence(fitnessResults, tournamentStats, games, [tournamentAxis])!;
    expect(result[0]).toMatchObject({ status: "insufficient", reason: "missing-comparator" });
    expect(result[0].comparator).toBeNull();
  });

  test("returns null when tournament stats is empty", () => {
    const games = [makeGame({ id: "g1", name: "G1" })];
    const fitnessResults = new Map([["g1", makeFitness(5.0)]]);
    const tournamentStats = new Map<string, TournamentGameStatsDisplay>();

    expect(computeDivergence(fitnessResults, tournamentStats, games, axes)).toBeNull();
  });

  test("gap exactly 1.5 is not reported", () => {
    const games = [makeGame({ id: "g1", name: "G1" })];
    const fitnessResults = new Map([["g1", scoredGame(games[0], 5)]]);
    const tournamentStats = new Map([["g1", makeTournamentStats(6.5)]]);

    const result = computeDivergence(fitnessResults, tournamentStats, games, axes)!;
    expect(result.length).toBe(0);
  });

  test("Tournament weight changes and Tournament vetoes do not alter the comparator", () => {
    const game = makeGame({ id: "g1", name: "G1" });
    const fitness = scoredGame(game, 4, 9);
    fitness.vetoed = true;
    fitness.vetoedBy = {
      axisId: tournamentAxis.id,
      axisName: tournamentAxis.name,
      threshold: 5,
      direction: "below",
      rawValue: 1,
    };
    fitness.score = 0;
    const tournamentEntry = fitness.breakdown.find(({ axisId }) => axisId === tournamentAxis.id);
    if (tournamentEntry === undefined) throw new Error("Missing Tournament breakdown fixture");
    tournamentEntry.weight = 100;

    const result = computeDivergence(
      new Map([[game.id, fitness]]),
      new Map([[game.id, makeTournamentStats(8)]]),
      [game],
      [personalAxis, { ...tournamentAxis, weight: 100 }],
    )!;
    expect(result[0].status).toBe("reported");
    if (result[0].status === "reported") {
      expect(result[0].details.independentFitnessScore).toBe(4);
    }
  });

  test("a non-Tournament veto remains when a Tournament veto was recorded first", () => {
    const game = makeGame({ id: "g1", name: "G1" });
    const fitness = scoredGame(game, 4);
    fitness.vetoed = true;
    fitness.vetoedBy = {
      axisId: tournamentAxis.id,
      axisName: tournamentAxis.name,
      threshold: 5,
      direction: "below",
      rawValue: 1,
    };
    fitness.score = 0;
    const personalEntry = fitness.breakdown.find(({ axisId }) => axisId === personalAxis.id);
    if (personalEntry === undefined) throw new Error("Missing personal breakdown fixture");
    personalEntry.scoringRawValue = 4;
    const vetoedPersonalAxis = {
      ...personalAxis,
      veto: { direction: "below" as const, threshold: 5 },
    };

    const result = computeDivergence(
      new Map([[game.id, fitness]]),
      new Map([[game.id, makeTournamentStats(8)]]),
      [game],
      [vetoedPersonalAxis, tournamentAxis],
    )!;
    expect(result[0].status).toBe("reported");
    if (result[0].status === "reported") {
      expect(result[0].details.independentFitnessScore).toBe(0);
    }
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

  function deliberateOutlierFixture() {
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

    return { games, fitnessResults };
  }

  test("a deliberate outlier exposes nearest comparisons and concrete factual drivers", () => {
    const { games, fitnessResults } = deliberateOutlierFixture();
    const outliers = detectOutliers(games, fitnessResults);
    const warOutlier = outliers.find(
      (outlier) => outlier.status === "reported" && outlier.details.gameId === "war1",
    );
    expect(warOutlier).toBeDefined();
    if (warOutlier?.status !== "reported") return;
    expect(warOutlier.details.gameName).toBe("Heavy Wargame");
    expect(warOutlier.details.nearestComparisons).toHaveLength(2);
    expect(warOutlier.comparator?.gameIds).toEqual(
      warOutlier.details.nearestComparisons.map(({ gameId }) => gameId),
    );
    expect(warOutlier.details.drivers.map(({ dimension }) => dimension)).toContain("mechanics");
    expect(warOutlier.details.drivers.map(({ dimension }) => dimension)).toContain("categories");
    expect(warOutlier.evidence.every(({ measurements }) => measurements.length > 0)).toBe(true);
    expect(
      warOutlier.evidence
        .filter(({ role }) => role === "comparator")
        .every(({ measurements }) =>
          ["mechanics", "categories", "complexity", "player-count", "playing-time"].every(
            (dimension) =>
              measurements.some(
                ({ key, source }) =>
                  key === `${dimension}-distance` && source === "outlier:factual-neighborhood",
              ),
          ),
        ),
    ).toBe(true);
    const profilePayload = {
      axisDistributions: [],
      axisWeights: [],
      bggClustering: {
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        weightRanges: [],
      },
      utilityCurves: [],
      divergence: null,
      outliers,
      suggestions: [],
      narration: null,
      narrationState: "empty",
      gameCount: games.length,
      ratedGameCount: 0,
      computedAt: "2026-01-01T00:00:00Z",
    };
    expect(CollectionProfileSchema.safeParse(profilePayload).success).toBe(true);

    const malformedProfile = structuredClone(profilePayload);
    const malformedOutlier = malformedProfile.outliers.find(
      (outlier) => outlier.status === "reported",
    );
    if (malformedOutlier?.status !== "reported") return;
    malformedOutlier.details.nearestComparisons[1] = malformedOutlier.details.nearestComparisons[0];
    expect(CollectionProfileSchema.safeParse(malformedProfile).success).toBe(false);
  });

  test("personal ratings do not affect compositional detection", () => {
    const { games } = deliberateOutlierFixture();
    const baseline = detectOutliers(games, new Map());
    const withRatings = detectOutliers(
      games.map((game) => ({ ...game, ratings: { a1: game.id === "war1" ? 1 : 10 } })),
      new Map(),
    );
    expect(withRatings).toEqual(baseline);
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
    const outliers = detectOutliers(games, fitnessResults);
    const oddOne = outliers.find(
      (outlier) => outlier.status === "reported" && outlier.details.gameId === "e5",
    );
    expect(oddOne).toBeUndefined();
  });

  test("fitness context is grounded in a sourced subject measurement", () => {
    const { games } = deliberateOutlierFixture();
    const outlier = detectOutliers(games, new Map([["war1", makeFitness(8.5)]])).find(
      (result) => result.status === "reported" && result.details.gameId === "war1",
    );
    expect(outlier?.status).toBe("reported");
    if (outlier?.status !== "reported") return;
    expect(outlier.details.fitnessScore).toBe(8.5);
    expect(outlier.interpretation).toContain("Separately");
    expect(outlier.confidence).toBeNull();
    expect(
      outlier.evidence
        .find(({ role }) => role === "subject")
        ?.measurements.find(({ key }) => key === "fitness-score"),
    ).toEqual({
      key: "fitness-score",
      label: "Preference fitness",
      value: 8.5,
      unit: "rating",
      source: "Fitness engine",
    });
  });

  test("small collections expose an explicit sample abstention", () => {
    const result = detectOutliers(
      [makeEuroGame("e1", "Euro 1"), makeEuroGame("e2", "Euro 2")],
      new Map(),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: "insufficient",
      reason: "insufficient-sample",
      cohort: { eligibleGameCount: 2, includedGameCount: 2 },
    });
  });

  test("low factual metadata coverage exposes an explicit coverage abstention", () => {
    const games = [
      ...Array.from({ length: 6 }, (_, index) => makeEuroGame(`e${index}`, `Euro ${index}`)),
      ...Array.from({ length: 5 }, (_, index) =>
        makeGame({ id: `m${index}`, name: `Missing ${index}` }),
      ),
    ];
    expect(detectOutliers(games, new Map())[0]).toMatchObject({
      status: "insufficient",
      reason: "insufficient-coverage",
      cohort: { eligibleGameCount: 11, includedGameCount: 6, excludedGameCount: 5 },
    });
  });

  test("previously owned games do not participate in detection or comparisons", () => {
    const { games } = deliberateOutlierFixture();
    const historical = makeEuroGame("historical", "Historical Twin");
    historical.ownership = "previously-owned";
    const result = detectOutliers([...games, historical], new Map());
    const reported = result.find((outlier) => outlier.status === "reported");
    expect(reported?.cohort.eligibleGameCount).toBe(6);
    expect(reported?.comparator?.gameIds).not.toContain("historical");
  });

  test("multimodal collections preserve well-supported local clusters", () => {
    const euros = Array.from({ length: 3 }, (_, index) =>
      makeEuroGame(`e${index}`, `Euro ${index}`),
    );
    const wars = Array.from({ length: 3 }, (_, index) =>
      makeGame({
        id: `w${index}`,
        name: `War ${index}`,
        minPlayers: 2,
        maxPlayers: 2,
        playingTime: 240,
        bggData: makeBggData({ weight: 4.5, mechanics: warMechanics, categories: warCategories }),
      }),
    );
    expect(detectOutliers([...euros, ...wars], new Map())).toEqual([]);
  });

  test("a two-game minority mode is not mistaken for two isolated outliers", () => {
    const euros = Array.from({ length: 4 }, (_, index) =>
      makeEuroGame(`e${index}`, `Euro ${index}`),
    );
    const wars = Array.from({ length: 2 }, (_, index) =>
      makeGame({
        id: `w${index}`,
        name: `War ${index}`,
        minPlayers: 1,
        maxPlayers: 1,
        playingTime: 390,
        bggData: makeBggData({ weight: 5, mechanics: warMechanics, categories: warCategories }),
      }),
    );
    expect(detectOutliers([...euros, ...wars], new Map())).toEqual([]);
  });

  test("missing factual values remain missing rather than creating outlier evidence", () => {
    const games = Array.from({ length: 6 }, (_, index) =>
      makeEuroGame(`e${index}`, `Euro ${index}`),
    );
    games[5] = { ...games[5], playingTime: null, bggData: { ...games[5].bggData!, weight: null } };
    expect(detectOutliers(games, new Map())[0]).toMatchObject({
      status: "insufficient",
      reason: "insufficient-sample",
      cohort: { eligibleGameCount: 6, includedGameCount: 5, excludedGameCount: 1 },
    });
  });
});

// --- Suggestions ---

describe("generateSuggestions", () => {
  const preference = makeAxis({ id: "preference", name: "Preference" });
  const axes: EnabledAxis[] = [preference];

  function suggestionFixture(
    rows: {
      attribute: boolean;
      confounder?: boolean;
      independent: number;
      tournament: number;
      comparisons?: number;
    }[],
    comparisonThreshold = 6,
  ) {
    const games = rows.map((row, index) =>
      makeGame({
        id: `g${index + 1}`,
        name: `G${index + 1}`,
        ratings: { preference: row.independent },
        bggData: makeBggData({
          mechanics: [
            ...(row.attribute ? [{ id: 1, name: "Area Control" }] : []),
            ...(row.confounder ? [{ id: 2, name: "Deck Building" }] : []),
          ],
        }),
      }),
    );
    const fitnessResults = makeDistributionResults(games, axes);
    const tournamentStats = new Map(
      rows.map((row, index) => [
        `g${index + 1}`,
        makeTournamentStats(row.tournament, row.comparisons ?? 10),
      ]),
    );
    const divergence = computeDivergence(
      fitnessResults,
      tournamentStats,
      games,
      axes,
      comparisonThreshold,
    );
    return {
      games,
      fitnessResults,
      tournamentStats,
      suggestions: generateSuggestions(
        games,
        axes,
        fitnessResults,
        tournamentStats,
        divergence,
        comparisonThreshold,
      ),
    };
  }

  function suggestionsPassSchema(fixture: ReturnType<typeof suggestionFixture>): boolean {
    return CollectionProfileSchema.safeParse({
      axisDistributions: [],
      axisWeights: [],
      bggClustering: {
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        weightRanges: [],
      },
      utilityCurves: [],
      divergence: null,
      outliers: [],
      suggestions: fixture.suggestions,
      narration: null,
      narrationState: "empty",
      gameCount: fixture.games.length,
      ratedGameCount: fixture.games.length,
      computedAt: "2026-01-01T00:00:00Z",
    }).success;
  }

  test("retires concentration and variance as recommendation sources", () => {
    const games = Array.from({ length: 5 }, (_, index) =>
      makeGame({
        id: `g${index}`,
        name: `G${index}`,
        playingTime: index === 4 ? 300 : 30,
        bggData: makeBggData({ mechanics: [{ id: 1, name: "Dice Rolling" }] }),
      }),
    );

    const suggestions = generateSuggestions(games, axes, new Map(), null, null);
    expect(suggestions.map(({ status }) => status)).toEqual(["retired", "retired", "insufficient"]);
    expect(
      suggestions
        .filter((suggestion) => suggestion.status === "retired")
        .map(({ method }) => method.id),
    ).toEqual(["unexpressed-concentration", "high-variance"]);
    expect(
      CollectionProfileSchema.safeParse({
        axisDistributions: [],
        axisWeights: [],
        bggClustering: {
          mechanics: [],
          categories: [],
          families: [],
          subdomains: [],
          weightRanges: [],
        },
        utilityCurves: [],
        divergence: null,
        outliers: [],
        suggestions,
        narration: null,
        narrationState: "empty",
        gameCount: games.length,
        ratedGameCount: 0,
        computedAt: "2026-01-01T00:00:00Z",
      }).success,
    ).toBe(true);
  });

  test("exposes missing Tournament prerequisites as explicit insufficiency", () => {
    const games = Array.from({ length: 6 }, (_, index) =>
      makeGame({ id: `g${index}`, name: `G${index}`, bggData: makeBggData() }),
    );

    const suggestions = generateSuggestions(games, axes, new Map(), null, null);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      status: "insufficient",
      reason: "insufficient-coverage",
      id: "axis-suggestion:directional-divergence-attribute-effect",
    });
  });

  test("suppresses null effects even when an attribute appears in divergent games", () => {
    const fixture = suggestionFixture([
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: false, independent: 4, tournament: 8 },
      { attribute: false, independent: 4, tournament: 8 },
      { attribute: false, independent: 4, tournament: 8 },
    ]);

    expect(fixture.suggestions).toEqual([]);
  });

  test("suppresses ubiquitous attributes without an attribute-negative comparator", () => {
    const fixture = suggestionFixture(
      Array.from({ length: 6 }, () => ({ attribute: true, independent: 4, tournament: 8 })),
    );

    expect(fixture.suggestions.map(({ status }) => status)).toEqual(["retired", "insufficient"]);
    expect(fixture.suggestions[1]).toMatchObject({
      reason: "missing-comparator",
      sufficiency: [{ observed: 0, required: 3, met: false }],
    });
  });

  test("suppresses attributes confounded by near-identical collection membership", () => {
    const fixture = suggestionFixture([
      { attribute: true, confounder: true, independent: 4, tournament: 8 },
      { attribute: true, confounder: true, independent: 4, tournament: 8 },
      { attribute: true, confounder: true, independent: 4, tournament: 8 },
      { attribute: false, confounder: true, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
    ]);

    expect(fixture.suggestions.map(({ status }) => status)).toEqual(["suppressed", "suppressed"]);
    expect(
      fixture.suggestions.map((suggestion) => "reason" in suggestion && suggestion.reason),
    ).toEqual(["unsupported-method", "unsupported-method"]);
  });

  test("does not combine opposite divergence directions into support", () => {
    const fixture = suggestionFixture([
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 8, tournament: 4 },
      { attribute: false, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
    ]);

    expect(fixture.suggestions).toHaveLength(1);
    expect(fixture.suggestions[0]).toMatchObject({
      status: "insufficient",
      reason: "insufficient-sample",
      sufficiency: [{ observed: 1, required: 3, met: false }],
    });
  });

  test("suppresses weak positive and comparator samples", () => {
    const fixture = suggestionFixture([
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: false, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
    ]);

    expect(fixture.suggestions).toHaveLength(1);
    expect(fixture.suggestions[0]).toMatchObject({
      status: "insufficient",
      reason: "insufficient-sample",
      sufficiency: [{ observed: 4, required: 6, met: false }],
    });
  });

  test("enforces the method evidence floor while honoring higher comparison thresholds", () => {
    const rows = (comparisons: number) => [
      { attribute: true, independent: 4, tournament: 8, comparisons },
      { attribute: true, independent: 4, tournament: 8, comparisons },
      { attribute: true, independent: 4, tournament: 8, comparisons },
      { attribute: false, independent: 6, tournament: 6, comparisons },
      { attribute: false, independent: 6, tournament: 6, comparisons },
      { attribute: false, independent: 6, tournament: 6, comparisons },
    ];

    const belowFloor = suggestionFixture(rows(5), 5);
    expect(belowFloor.suggestions).toMatchObject([{ status: "insufficient" }]);
    expect(suggestionsPassSchema(belowFloor)).toBe(true);

    const atFloor = suggestionFixture(rows(6), 5);
    expect(atFloor.suggestions).toMatchObject([{ status: "reported" }]);
    expect(suggestionsPassSchema(atFloor)).toBe(true);

    const belowConfiguredThreshold = suggestionFixture(rows(6), 7);
    expect(belowConfiguredThreshold.suggestions).toMatchObject([{ status: "insufficient" }]);
    expect(suggestionsPassSchema(belowConfiguredThreshold)).toBe(true);
  });

  test("does not report an effect exactly at the declared threshold", () => {
    const fixture = suggestionFixture([
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: false, independent: 4, tournament: 6.5 },
      { attribute: false, independent: 4, tournament: 6.5 },
      { attribute: false, independent: 4, tournament: 6.5 },
    ]);

    expect(fixture.suggestions).toEqual([]);
    expect(suggestionsPassSchema(fixture)).toBe(true);
  });

  test("does not report a raw effect just above threshold that publishes at threshold", () => {
    const fixture = suggestionFixture([
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: false, independent: 4, tournament: 6.49 },
      { attribute: false, independent: 4, tournament: 6.49 },
      { attribute: false, independent: 4, tournament: 6.49 },
    ]);

    expect(fixture.suggestions).toEqual([]);
    expect(suggestionsPassSchema(fixture)).toBe(true);
  });

  test("reports a clearly above-threshold effect using its published rounded value", () => {
    const fixture = suggestionFixture([
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: false, independent: 4, tournament: 6.4 },
      { attribute: false, independent: 4, tournament: 6.4 },
      { attribute: false, independent: 4, tournament: 6.4 },
    ]);

    expect(fixture.suggestions).toHaveLength(1);
    expect(fixture.suggestions[0]).toMatchObject({
      status: "reported",
      details: { effect: 1.6 },
      notability: { value: 1.6, threshold: 1.5, direction: "above" },
    });
    expect(suggestionsPassSchema(fixture)).toBe(true);
  });

  test("derives published means and effect from the published per-game gaps", () => {
    const fixture = suggestionFixture([
      { attribute: true, independent: 4, tournament: 8.401 },
      { attribute: true, independent: 4, tournament: 8.401 },
      { attribute: true, independent: 4, tournament: 8.548 },
      { attribute: false, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
    ]);

    expect(fixture.suggestions).toHaveLength(1);
    const suggestion = fixture.suggestions[0];
    expect(suggestion).toMatchObject({
      status: "reported",
      details: { supportingMeanGap: 4.4, comparatorMeanGap: 0, effect: 4.4 },
      notability: { value: 4.4 },
    });
    expect(
      suggestion.evidence
        .filter(({ role }) => role !== "comparator")
        .map(
          ({ measurements }) =>
            measurements.find(({ key }) => key === "signed-preference-gap")?.value,
        ),
    ).toEqual([4.4, 4.4, 4.5]);
    expect(suggestionsPassSchema(fixture)).toBe(true);
  });

  test("retains a direction-specific effect with inspectable positive and comparator evidence", () => {
    const fixture = suggestionFixture([
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: true, independent: 4, tournament: 8 },
      { attribute: false, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
    ]);

    expect(fixture.suggestions).toHaveLength(1);
    const suggestion = fixture.suggestions[0];
    expect(suggestion.status).toBe("reported");
    if (suggestion.status !== "reported") return;
    expect(suggestion.details).toMatchObject({
      source: "divergence-repair",
      attribute: "Area Control",
      direction: "tournament-outlier",
      supportingGameCount: 3,
      comparatorGameCount: 3,
      supportingMeanGap: 4,
      comparatorMeanGap: 0,
      effect: 4,
    });
    expect(suggestion.comparator?.gameIds).toEqual(["g4", "g5", "g6"]);
    expect(suggestion.evidence.map(({ gameId }) => gameId)).toEqual([
      "g1",
      "g2",
      "g3",
      "g4",
      "g5",
      "g6",
    ]);
    expect(suggestion.sufficiency.every(({ met }) => met)).toBe(true);
    expect(suggestion.interpretation.endsWith("?")).toBe(true);
    const profile = {
      axisDistributions: [],
      axisWeights: [],
      bggClustering: {
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        weightRanges: [],
      },
      utilityCurves: [],
      divergence: null,
      outliers: [],
      suggestions: fixture.suggestions,
      narration: null,
      narrationState: "empty",
      gameCount: 6,
      ratedGameCount: 6,
      computedAt: "2026-01-01T00:00:00Z",
    };
    expect(CollectionProfileSchema.safeParse(profile).success).toBe(true);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [{ ...suggestion, comparator: null }],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [{ ...suggestion, interpretation: "Create an Area Control axis" }],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [
          {
            ...suggestion,
            details: { ...suggestion.details, effect: Number.POSITIVE_INFINITY },
            notability: { ...suggestion.notability, value: Number.POSITIVE_INFINITY },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [
          {
            ...suggestion,
            details: { ...suggestion.details, comparatorGameCount: 2, effect: 1 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [
          {
            ...suggestion,
            confidence: { level: "high", basis: "Group size alone" },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [
          {
            ...suggestion,
            evidence: [...suggestion.evidence, { ...suggestion.evidence[0], role: "comparator" }],
            comparator: {
              ...suggestion.comparator,
              gameIds: [...suggestion.comparator.gameIds, "g1"],
            },
            details: { ...suggestion.details, comparatorGameCount: 4 },
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("retains the fitness-outlier direction independently", () => {
    const fixture = suggestionFixture([
      { attribute: true, independent: 8, tournament: 4 },
      { attribute: true, independent: 8, tournament: 4 },
      { attribute: true, independent: 8, tournament: 4 },
      { attribute: false, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
      { attribute: false, independent: 6, tournament: 6 },
    ]);

    expect(fixture.suggestions).toHaveLength(1);
    const suggestion = fixture.suggestions[0];
    expect(suggestion.status).toBe("reported");
    if (suggestion.status !== "reported") return;
    expect(suggestion.details).toMatchObject({
      attribute: "Area Control",
      direction: "fitness-outlier",
      effect: 4,
    });
  });
});

// --- Full Profile (computeProfile) ---

describe("computeProfile", () => {
  const preferenceAxis = makeAxis({ id: "preference", name: "Economic Preference" });

  function realisticProfileGame(
    index: number,
    mechanic: "Area Control" | "Worker Placement",
    rating: number,
  ): Game {
    return makeGame({
      id: `profile-${index}`,
      name: `Profile Game ${index}`,
      minPlayers: 2,
      maxPlayers: 4,
      playingTime: 90,
      ratings: { [preferenceAxis.id]: rating },
      bggData: makeBggData({
        weight: 3,
        mechanics: [{ id: mechanic === "Area Control" ? 1 : 2, name: mechanic }],
        categories: [{ id: 10, name: "Economic" }],
      }),
    });
  }

  function schemaProfile(profile: ReturnType<typeof computeProfile>) {
    return {
      ...profile,
      narration: null,
      narrationState: "empty" as const,
      computedAt: "2026-08-27T12:00:00.000Z",
    };
  }

  test("produces a deterministic realistic retained profile from sufficient evidence", () => {
    const games = [
      realisticProfileGame(1, "Area Control", 4),
      realisticProfileGame(2, "Area Control", 4),
      realisticProfileGame(3, "Area Control", 4),
      realisticProfileGame(4, "Worker Placement", 6),
      realisticProfileGame(5, "Worker Placement", 6),
      realisticProfileGame(6, "Worker Placement", 6),
    ];
    const input: ProfileInput = {
      games,
      axes: [preferenceAxis],
      fitnessResults: makeDistributionResults(games, [preferenceAxis]),
      tournamentStats: new Map(
        games.map((game, index) => [game.id, makeTournamentStats(index < 3 ? 8 : 6, 10)]),
      ),
    };

    const first = computeProfile(input);
    const second = computeProfile(input);

    expect(second).toEqual(first);
    expect(first.divergence?.map(({ status }) => status)).toEqual([
      "reported",
      "reported",
      "reported",
    ]);
    expect(
      first.divergence?.every(
        (insight) => insight.status !== "reported" || insight.confidence === null,
      ),
    ).toBe(true);
    expect(first.outliers).toEqual([]);
    expect(first.suggestions).toHaveLength(1);
    expect(first.suggestions[0]).toMatchObject({
      status: "reported",
      details: { attribute: "Area Control", effect: 4 },
      confidence: null,
    });
    expect(CollectionProfileSchema.safeParse(schemaProfile(first)).success).toBe(true);
  });

  test("produces a deterministic realistic abstained profile from inadequate evidence", () => {
    const games = [
      realisticProfileGame(1, "Area Control", 4),
      realisticProfileGame(2, "Worker Placement", 6),
    ];
    const input: ProfileInput = {
      games,
      axes: [preferenceAxis],
      fitnessResults: makeDistributionResults(games, [preferenceAxis]),
      tournamentStats: new Map(games.map((game) => [game.id, makeTournamentStats(null, 10)])),
    };

    const first = computeProfile(input);
    const second = computeProfile(input);

    expect(second).toEqual(first);
    expect(
      first.divergence?.map((insight) =>
        insight.status === "reported" ? insight.status : [insight.status, insight.reason],
      ),
    ).toEqual([
      ["insufficient", "insufficient-coverage"],
      ["insufficient", "insufficient-coverage"],
    ]);
    expect(first.outliers).toHaveLength(1);
    expect(first.outliers[0]).toMatchObject({
      status: "insufficient",
      reason: "insufficient-sample",
    });
    expect(first.suggestions).toHaveLength(1);
    expect(first.suggestions[0]).toMatchObject({
      status: "insufficient",
      reason: "insufficient-sample",
    });
    expect(CollectionProfileSchema.safeParse(schemaProfile(first)).success).toBe(true);
  });

  test("does not count automatic derived or Tournament values as user ratings", () => {
    const derived = makeDerivedAxis("community", "Community", "communityRating");
    const tournament = makeTournamentAxis("tournament", "Tournament");
    const game = makeGame({
      id: "g1",
      name: "G1",
      bggData: makeBggData({ communityRating: 8 }),
    });
    const fitnessResults = makeDistributionResults([game], [derived, tournament]);
    const breakdown = fitnessResults.get(game.id)?.breakdown;
    if (breakdown === undefined) throw new Error("Missing profile fitness fixture");
    breakdown[0].effectiveRating = 8;
    breakdown[1].effectiveRating = 9;

    const profile = computeProfile({
      games: [game],
      axes: [derived, tournament],
      fitnessResults,
      tournamentStats: new Map([[game.id, makeTournamentStats(9)]]),
    });

    expect(profile.ratedGameCount).toBe(0);
  });

  test("counts personal ratings and derived overrides once per game", () => {
    const personal = makeAxis({ id: "fun", name: "Fun" });
    const derived = makeDerivedAxis("community", "Community", "communityRating");
    const games = [
      makeGame({ id: "personal", name: "Personal", ratings: { [personal.id]: 7 } }),
      makeGame({ id: "override", name: "Override", ratings: { [derived.id]: 9 } }),
    ];

    const profile = computeProfile({
      games,
      axes: [personal, derived],
      fitnessResults: makeDistributionResults(games, [personal, derived]),
      tournamentStats: null,
    });

    expect(profile.ratedGameCount).toBe(2);
  });

  test("does not count a rating stored for a disabled legacy axis", () => {
    const disabled: Axis = {
      id: "legacy",
      name: "Legacy",
      description: null,
      weight: 50,
      enabled: false,
      source: "legacy",
      reason: "unsupported",
      legacyField: "future",
      legacyPayload: {},
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const game = makeGame({ id: "g1", name: "G1", ratings: { [disabled.id]: 8 } });

    const profile = computeProfile({
      games: [game],
      axes: [disabled],
      fitnessResults: new Map(),
      tournamentStats: null,
    });

    expect(profile.ratedGameCount).toBe(0);
  });

  test("does not overcount a game with ratings on multiple enabled axes", () => {
    const fun = makeAxis({ id: "fun", name: "Fun" });
    const art = makeAxis({ id: "art", name: "Art" });
    const game = makeGame({ id: "g1", name: "G1", ratings: { fun: 7, art: 8 } });

    const profile = computeProfile({
      games: [game],
      axes: [fun, art],
      fitnessResults: makeDistributionResults([game], [fun, art]),
      tournamentStats: null,
    });

    expect(profile.ratedGameCount).toBe(1);
  });

  test("excludes disabled axes from distributions, weights, curves, and coverage", () => {
    const personal = makeAxis({ id: "fun", name: "Fun", weight: 100 });
    const disabled: Axis = {
      id: "legacy-time",
      name: "Play Time",
      description: null,
      weight: 1000,
      enabled: false,
      source: "legacy",
      reason: "disabled",
      legacyField: "playingTime",
      legacyPayload: {},
      preferenceShape: "sweet-spot",
      idealValue: 90,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const games = [
      makeGame({ id: "g1", name: "G1", ratings: { fun: 7 }, playingTime: 30 }),
      makeGame({ id: "g2", name: "G2", ratings: { fun: 8 }, playingTime: 300 }),
    ];
    const profile = computeProfile({
      games,
      axes: [personal, disabled],
      fitnessResults: makeDistributionResults(games, [personal]),
      tournamentStats: null,
    });
    expect(profile.axisDistributions.map(({ axisId }) => axisId)).toEqual(["fun"]);
    expect(profile.axisWeights).toEqual([
      { axisId: "fun", axisName: "Fun", weight: 100, percentage: 100 },
    ]);
    expect(profile.utilityCurves).toEqual([]);
    expect(profile.suggestions.map(({ status }) => status)).toEqual(["retired", "insufficient"]);
  });
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

    const fitnessResults = makeDistributionResults(games.slice(0, 2), axes);

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

    const fitnessResults = makeDistributionResults(games, axes);

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
    expect(profile.divergence![0].status).toBe("reported");
    if (profile.divergence![0].status === "reported") {
      expect(profile.divergence![0].details.gameId).toBe("g2");
      expect(profile.divergence![0].details.direction).toBe("tournament-outlier");
    }
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        narration: null,
        narrationState: "empty",
        computedAt: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
