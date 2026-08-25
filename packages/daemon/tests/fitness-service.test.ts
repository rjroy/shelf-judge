import { describe, expect, test } from "bun:test";
import type {
  BggGameData,
  DerivedAxis,
  Game,
  PersonalAxis,
  TournamentAxis,
  TournamentData,
} from "@shelf-judge/shared";
import { createFitnessService } from "../src/services/fitness-service.js";

const service = createFitnessService();
const now = "2026-01-01T00:00:00.000Z";

function bgg(overrides: Partial<BggGameData> = {}): BggGameData {
  return {
    communityRating: 7.5,
    bayesAverage: 7.2,
    weight: 2.9,
    numWeightVotes: 100,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    suggestedPlayerCounts: [],
    fetchedAt: now,
    ...overrides,
  };
}

function game(ratings: Record<string, number> = {}, overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    bggId: null,
    name: "Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function personal(id: string, weight = 50, overrides: Partial<PersonalAxis> = {}): PersonalAxis {
  return {
    id,
    name: id,
    description: null,
    weight,
    enabled: true,
    source: "personal",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function community(
  overrides: Partial<DerivedAxis<"communityRating">> = {},
): DerivedAxis<"communityRating"> {
  return {
    id: "community",
    name: "Community Rating",
    description: null,
    weight: 50,
    enabled: true,
    source: "derived",
    derivedField: "communityRating",
    configuration: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function complexity(overrides: Partial<DerivedAxis<"weight">> = {}): DerivedAxis<"weight"> {
  return {
    id: "complexity",
    name: "Complexity",
    description: null,
    weight: 50,
    enabled: true,
    source: "derived",
    derivedField: "weight",
    configuration: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function row(result: ReturnType<typeof service.calculateScore>, axisId: string) {
  const value = result?.breakdown.find((entry) => entry.axisId === axisId);
  if (value === undefined) throw new Error(`Missing row ${axisId}`);
  return value;
}

function tournamentData(
  stats: Record<string, { eloRating: number; comparisonCount: number }>,
): TournamentData {
  return {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
    sessions: [],
    gameStats: Object.fromEntries(
      Object.entries(stats).map(([id, value]) => [
        id,
        { ...value, wins: 0, losses: 0, recentComparisons: [] },
      ]),
    ),
  };
}

function tournament(weight = 50): TournamentAxis {
  return {
    id: "tournament",
    name: "Tournament",
    description: null,
    weight,
    enabled: true,
    source: "tournament",
    createdAt: now,
    updatedAt: now,
  };
}

describe("fitness service current-contract regression", () => {
  test("personal higher-is-better defaults to identity", () => {
    const result = service.calculateScore(game({ fun: 8 }), [personal("fun")]);
    expect(result).toMatchObject({ score: 8, vetoed: false, hypotheticalScore: null });
    expect(row(result, "fun")).toMatchObject({
      sourceValue: 8,
      scoringRawValue: 8,
      effectiveRating: 8,
      preferenceShape: "higher-is-better",
      curveAffected: false,
    });
  });

  test("multiple personal axes preserve weighted scoring", () => {
    expect(
      service.calculateScore(game({ fun: 8, art: 6 }), [personal("fun", 60), personal("art", 40)])
        ?.score,
    ).toBe(7.2);
  });

  test("equal weights produce a simple average", () => {
    expect(
      service.calculateScore(game({ fun: 6, art: 8 }), [personal("fun", 10), personal("art", 10)])
        ?.score,
    ).toBe(7);
  });

  test("unrated personal axes are excluded from the denominator", () => {
    const result = service.calculateScore(game({ fun: 8 }), [personal("fun"), personal("art")]);
    expect(result).toMatchObject({ score: 8, ratedAxisCount: 1, totalAxisCount: 2 });
    expect(row(result, "art")).toMatchObject({ effectiveRating: null, contribution: null });
  });

  test("no rated axes returns null", () => {
    expect(service.calculateScore(game(), [personal("fun")])).toBeNull();
  });

  test("all-zero rated weights return null", () => {
    expect(service.calculateScore(game({ fun: 5 }), [personal("fun", 0)])).toBeNull();
  });

  test("empty axes return null", () => {
    expect(service.calculateScore(game({ fun: 5 }), [])).toBeNull();
  });

  test("community rating derived axis preserves identity scoring", () => {
    const target = game({}, { bggData: bgg({ communityRating: 7.5 }) });
    const result = service.calculateScore(target, [community()]);
    expect(result?.score).toBe(7.5);
    expect(row(result, "community")).toMatchObject({
      source: "derived",
      sourceValue: 7.5,
      scoringRawValue: 7.5,
      effectiveRating: 7.5,
    });
  });

  test("weight derived axis uses the native 1-5 scale", () => {
    const result = service.calculateScore(game({}, { bggData: bgg({ weight: 2.9 }) }), [
      complexity(),
    ]);
    expect(result?.score).toBe(5.3);
    expect(row(result, "complexity")).toMatchObject({ sourceValue: 2.9, scoringRawValue: 2.9 });
  });

  test("missing BGG data leaves community visible but unrated", () => {
    const result = service.calculateScore(game({ fun: 8 }), [personal("fun"), community()]);
    expect(result?.score).toBe(8);
    expect(row(result, "community")).toMatchObject({
      source: "derived",
      sourceValue: null,
      scoringRawValue: null,
      effectiveRating: null,
    });
  });

  test("null BGG weight leaves complexity unrated", () => {
    const result = service.calculateScore(game({ fun: 8 }, { bggData: bgg({ weight: null }) }), [
      personal("fun"),
      complexity(),
    ]);
    expect(result?.score).toBe(8);
    expect(row(result, "complexity").effectiveRating).toBeNull();
  });

  test("derived override retains native factual values", () => {
    const result = service.calculateScore(
      game({ complexity: 7 }, { bggData: bgg({ weight: 2.9 }) }),
      [complexity()],
    );
    expect(result?.score).toBe(7);
    expect(row(result, "complexity")).toMatchObject({
      source: "override",
      sourceValue: 2.9,
      scoringRawValue: 2.9,
      effectiveRating: 7,
      overridden: true,
    });
  });

  test("community override retains its factual value", () => {
    const result = service.calculateScore(
      game({ community: 9 }, { bggData: bgg({ communityRating: 7.5 }) }),
      [community()],
    );
    expect(row(result, "community")).toMatchObject({ source: "override", sourceValue: 7.5 });
  });

  test("higher-is-better personal values remain identity across the scale", () => {
    const axis = personal("fun", 50, { preferenceShape: "higher-is-better" });
    for (let rating = 1; rating <= 10; rating++) {
      expect(service.calculateScore(game({ fun: rating }), [axis])?.score).toBe(rating);
    }
  });

  test("lower-is-better derived weight inverts minimum interior and maximum", () => {
    const axis = complexity({ preferenceShape: "lower-is-better" });
    expect(service.calculateScore(game({}, { bggData: bgg({ weight: 1 }) }), [axis])?.score).toBe(
      10,
    );
    expect(service.calculateScore(game({}, { bggData: bgg({ weight: 3 }) }), [axis])?.score).toBe(
      5.5,
    );
    expect(service.calculateScore(game({}, { bggData: bgg({ weight: 5 }) }), [axis])?.score).toBe(
      1,
    );
  });

  test("sweet-spot derived weight scores its ideal as ten", () => {
    const axis = complexity({
      preferenceShape: "sweet-spot",
      idealValue: 3,
      tolerance: "moderate",
    });
    expect(service.calculateScore(game({}, { bggData: bgg({ weight: 3 }) }), [axis])?.score).toBe(
      10,
    );
  });

  test("sweet-spot derived weight scores both endpoints as one", () => {
    const axis = complexity({
      preferenceShape: "sweet-spot",
      idealValue: 3,
      tolerance: "moderate",
    });
    expect(service.calculateScore(game({}, { bggData: bgg({ weight: 1 }) }), [axis])?.score).toBe(
      1,
    );
    expect(service.calculateScore(game({}, { bggData: bgg({ weight: 5 }) }), [axis])?.score).toBe(
      1,
    );
  });

  test("sweet-spot personal axes use the personal scale", () => {
    const axis = personal("pace", 50, {
      preferenceShape: "sweet-spot",
      idealValue: 5,
      tolerance: "flexible",
    });
    expect(service.calculateScore(game({ pace: 5 }), [axis])?.score).toBe(10);
  });

  test("mixed preference shapes compose through weighted scoring", () => {
    const result = service.calculateScore(game({ fun: 8 }, { bggData: bgg({ weight: 2 }) }), [
      personal("fun"),
      complexity({ preferenceShape: "lower-is-better" }),
    ]);
    expect(result?.score).toBe(7.9);
  });

  test("derived veto above threshold activates on scoringRawValue", () => {
    const axis = complexity({ veto: { direction: "above", threshold: 4 } });
    const result = service.calculateScore(game({}, { bggData: bgg({ weight: 4.5 }) }), [axis]);
    expect(result).toMatchObject({
      score: 0,
      vetoed: true,
      hypotheticalScore: 8.9,
      vetoedBy: {
        axisId: "complexity",
        direction: "above",
        threshold: 4,
        rawValue: 4.5,
      },
    });
    expect(row(result, axis.id)).toMatchObject({
      source: "derived",
      sourceValue: 4.5,
      scoringRawValue: 4.5,
      overridden: false,
    });
  });

  test("veto hypothetical score includes every rated axis", () => {
    const result = service.calculateScore(game({ fun: 8 }, { bggData: bgg({ weight: 4 }) }), [
      personal("fun"),
      complexity({ veto: { direction: "above", threshold: 3 } }),
    ]);
    expect(result).toMatchObject({ score: 0, vetoed: true, hypotheticalScore: 7.9 });
  });

  test("veto results retain a complete breakdown", () => {
    const result = service.calculateScore(game({ fun: 8 }, { bggData: bgg({ weight: 4 }) }), [
      personal("fun"),
      complexity({ veto: { direction: "above", threshold: 3 } }),
    ]);
    expect(result?.breakdown).toHaveLength(2);
    for (const entry of result?.breakdown ?? []) expect(entry.effectiveRating).not.toBeNull();
  });

  test("below veto does not trigger at its threshold", () => {
    const axis = personal("fun", 50, { veto: { direction: "below", threshold: 3 } });
    expect(service.calculateScore(game({ fun: 3 }), [axis])).toMatchObject({
      score: 3,
      vetoed: false,
    });
  });

  test("above veto does not trigger at its threshold", () => {
    const axis = personal("fun", 50, { veto: { direction: "above", threshold: 8 } });
    expect(service.calculateScore(game({ fun: 8 }), [axis])).toMatchObject({
      score: 8,
      vetoed: false,
    });
  });

  test("below veto triggers below its threshold", () => {
    const axis = personal("fun", 50, { veto: { direction: "below", threshold: 5 } });
    expect(service.calculateScore(game({ fun: 4 }), [axis])).toMatchObject({
      score: 0,
      vetoed: true,
    });
  });

  test("the first triggering veto is reported", () => {
    const result = service.calculateScore(game({ fun: 3, art: 2 }), [
      personal("fun", 50, { veto: { direction: "below", threshold: 5 } }),
      personal("art", 50, { veto: { direction: "below", threshold: 5 } }),
    ]);
    expect(result).toMatchObject({
      hypotheticalScore: 2.5,
      vetoedBy: { axisId: "fun", rawValue: 3 },
    });
  });

  test("derived personal override bypasses native veto", () => {
    const axis = complexity({ veto: { direction: "above", threshold: 3 } });
    const result = service.calculateScore(
      game({ complexity: 5 }, { bggData: bgg({ weight: 4.5 }) }),
      [axis],
    );
    expect(result).toMatchObject({ score: 5, vetoed: false });
  });

  test("the same derived value triggers veto without an override", () => {
    const axis = complexity({ veto: { direction: "above", threshold: 3 } });
    expect(
      service.calculateScore(game({}, { bggData: bgg({ weight: 4.5 }) }), [axis]),
    ).toMatchObject({
      score: 0,
      vetoed: true,
    });
  });

  test("axis without veto never vetoes", () => {
    expect(service.calculateScore(game({ fun: 1 }), [personal("fun")])).toMatchObject({
      score: 1,
      vetoed: false,
    });
  });

  test("higher-is-better is not curve affected", () => {
    expect(
      row(service.calculateScore(game({ fun: 5 }), [personal("fun")]), "fun").curveAffected,
    ).toBe(false);
  });

  test("lower-is-better is curve affected away from midpoint", () => {
    const result = service.calculateScore(game({}, { bggData: bgg({ weight: 2 }) }), [
      complexity({ preferenceShape: "lower-is-better" }),
    ]);
    expect(row(result, "complexity").curveAffected).toBe(true);
  });

  test("sweet-spot ideal is curve affected when baseline differs", () => {
    const result = service.calculateScore(game({}, { bggData: bgg({ weight: 3 }) }), [
      complexity({ preferenceShape: "sweet-spot", idealValue: 3, tolerance: "moderate" }),
    ]);
    expect(row(result, "complexity").curveAffected).toBe(true);
  });

  test("curveAffected excludes an exact 0.5 difference", () => {
    const axis = personal("test", 50, { preferenceShape: "lower-is-better" });
    expect(row(service.calculateScore(game({ test: 5.25 }), [axis]), "test").curveAffected).toBe(
      false,
    );
  });

  test("curveAffected includes a 0.51 difference", () => {
    const axis = personal("test", 50, { preferenceShape: "lower-is-better" });
    expect(row(service.calculateScore(game({ test: 5.245 }), [axis]), "test").curveAffected).toBe(
      true,
    );
  });

  test("default and explicit higher-is-better are equivalent", () => {
    const target = game({ fun: 7 });
    expect(service.calculateScore(target, [personal("fun")])?.score).toBe(
      service.calculateScore(target, [personal("fun", 50, { preferenceShape: "higher-is-better" })])
        ?.score,
    );
  });

  test("breakdown ordering is override then derived then personal", () => {
    const result = service.calculateScore(
      game({ fun: 7, complexity: 8 }, { bggData: bgg({ communityRating: 7.5, weight: 3 }) }),
      [personal("fun"), community(), complexity()],
    );
    expect(result?.breakdown.map(({ source }) => source)).toEqual([
      "override",
      "derived",
      "personal",
    ]);
  });

  test("7.84 rounds to 7.8", () => {
    expect(
      service.calculateScore(game({ a: 8, b: 7 }), [personal("a", 84), personal("b", 16)])?.score,
    ).toBe(7.8);
  });

  test("7.85 rounds to 7.9", () => {
    expect(
      service.calculateScore(game({ a: 8, b: 7 }), [personal("a", 85), personal("b", 15)])?.score,
    ).toBe(7.9);
  });

  test("7.94 rounds to 7.9", () => {
    expect(
      service.calculateScore(game({ a: 8, b: 7 }), [personal("a", 94), personal("b", 6)])?.score,
    ).toBe(7.9);
  });

  test("7.95 rounds to 8.0", () => {
    expect(
      service.calculateScore(game({ a: 8, b: 7 }), [personal("a", 95), personal("b", 5)])?.score,
    ).toBe(8);
  });

  test("factual precision is retained while effective rating is rounded", () => {
    const result = service.calculateScore(game({}, { bggData: bgg({ communityRating: 7.666 }) }), [
      community(),
    ]);
    expect(row(result, "community")).toMatchObject({ sourceValue: 7.666, effectiveRating: 7.7 });
    expect(result?.score).toBe(7.7);
  });

  test("normalized contributions reconstruct the displayed score", () => {
    const result = service.calculateScore(
      game({ fun: 7 }, { bggData: bgg({ communityRating: 8.347, weight: 3.14 }) }),
      [personal("fun", 40), community({ weight: 30 }), complexity({ weight: 30 })],
    );
    const total = result?.breakdown.reduce((sum, entry) => sum + (entry.contribution ?? 0), 0);
    expect(total).toBeCloseTo(result?.score ?? 0, 1);
  });

  test("Tournament contributes normalized score for a five-game cohort", () => {
    const data = tournamentData({
      "game-1": { eloRating: 1900, comparisonCount: 8 },
      "game-2": { eloRating: 1500, comparisonCount: 6 },
      "game-3": { eloRating: 1500, comparisonCount: 6 },
      "game-4": { eloRating: 1500, comparisonCount: 6 },
      "game-5": { eloRating: 1500, comparisonCount: 6 },
    });
    expect(service.calculateScore(game(), [tournament()], data)?.score).toBe(10);
  });

  test("provisional Tournament games still contribute", () => {
    const data = tournamentData({
      "game-1": { eloRating: 1700, comparisonCount: 2 },
      "game-2": { eloRating: 1500, comparisonCount: 1 },
      "game-3": { eloRating: 1500, comparisonCount: 1 },
      "game-4": { eloRating: 1500, comparisonCount: 1 },
      "game-5": { eloRating: 1500, comparisonCount: 1 },
    });
    expect(service.calculateScore(game(), [tournament()], data)?.score).toBe(7.8);
  });

  test("Tournament is excluded below cohort floor or without comparisons", () => {
    const data = tournamentData({
      "other-1": { eloRating: 1500, comparisonCount: 6 },
      "other-2": { eloRating: 1500, comparisonCount: 6 },
      "other-3": { eloRating: 1500, comparisonCount: 6 },
      "other-4": { eloRating: 1500, comparisonCount: 6 },
    });
    const result = service.calculateScore(game({ fun: 7 }), [personal("fun"), tournament()], data);
    expect(result).toMatchObject({ score: 7, ratedAxisCount: 1 });
    expect(row(result, "tournament").effectiveRating).toBeNull();
  });

  test("Tournament is excluded below the cohort floor despite target comparisons", () => {
    const data = tournamentData({
      "game-1": { eloRating: 1900, comparisonCount: 8 },
      "game-2": { eloRating: 1500, comparisonCount: 6 },
      "game-3": { eloRating: 1500, comparisonCount: 6 },
      "game-4": { eloRating: 1500, comparisonCount: 6 },
    });
    const result = service.calculateScore(game({ fun: 7 }), [personal("fun"), tournament()], data);

    expect(result).toMatchObject({ score: 7, ratedAxisCount: 1 });
    expect(row(result, "tournament")).toMatchObject({
      source: "tournament",
      effectiveRating: null,
      contribution: null,
    });
  });

  test("Tournament is excluded when tournament data is null or omitted", () => {
    const target = game({ fun: 7 });
    const axes = [personal("fun"), tournament()];

    for (const result of [
      service.calculateScore(target, axes, null),
      service.calculateScore(target, axes),
    ]) {
      expect(result).toMatchObject({ score: 7, ratedAxisCount: 1 });
      expect(row(result, "tournament")).toMatchObject({
        source: "tournament",
        effectiveRating: null,
        contribution: null,
      });
    }
  });

  test("Tournament composes with personal axes by weight", () => {
    const data = tournamentData({
      "game-1": { eloRating: 1900, comparisonCount: 8 },
      "game-2": { eloRating: 1500, comparisonCount: 6 },
      "game-3": { eloRating: 1500, comparisonCount: 6 },
      "game-4": { eloRating: 1500, comparisonCount: 6 },
      "game-5": { eloRating: 1500, comparisonCount: 6 },
    });
    expect(
      service.calculateScore(game({ fun: 5 }), [personal("fun", 60), tournament(40)], data)?.score,
    ).toBe(7);
  });
});
