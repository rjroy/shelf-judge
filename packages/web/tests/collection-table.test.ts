import { describe, test, expect } from "bun:test";
import type {
  Game,
  GameWithPurchaseUtilization,
  FitnessResult,
  Axis,
  BggGameData,
  TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import { calculatePurchaseUtilization } from "@shelf-judge/shared";
import {
  sortGames,
  matchesFilters,
  getScoreDisplay,
  getSeparatorLabel,
  buildSortFields,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  type FilterState,
  type SortState,
} from "@/lib/collection-utils";
import type { CollectionNavigationContextV1 } from "@/lib/collection-navigation-context";
import {
  buildCollectionGameHref,
  canRestoreCollectionProjection,
  collectionRowId,
  effectiveCollectionPredictionsOn,
  normalizeCollectionSort,
  persistCollectionPreferences,
  removeCollectionReturnTransport,
  selectCollectionReturnFocusId,
  shouldCaptureCollectionScroll,
} from "@/components/collection-table";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    bggId: null,
    name: "Test Game",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeScore(
  score: number,
  predictionMeta: FitnessResult["predictionMeta"] = null,
): FitnessResult {
  return {
    score,
    ratedAxisCount: predictionMeta ? predictionMeta.actualAxisCount : 3,
    totalAxisCount: 5,
    breakdown: [],
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta,
    redundancyAdjustment: null,
  };
}

function makeAxisScore(
  axisId: string,
  effectiveRating: number | null,
  sourceValue: number = effectiveRating ?? 1,
): FitnessResult {
  return {
    ...makeScore(effectiveRating ?? 5),
    breakdown: [
      {
        axisId,
        axisName: "Test Axis",
        weight: 50,
        contribution: effectiveRating,
        source: "derived",
        derivedField: "playingTime",
        sourceValue,
        scoringRawValue: sourceValue,
        effectiveRating,
        preferenceShape: "higher-is-better",
        curveAffected: sourceValue !== effectiveRating,
        unit: null,
        provenance: null,
        configurationSummary: null,
        overridden: false,
        overrideValue: null,
        predictionConfidence: null,
        referenceGames: null,
      },
    ],
  };
}

function makeGWS(
  gameOverrides: Partial<Game> = {},
  score: FitnessResult | null = null,
): GameWithPurchaseUtilization {
  const game = makeGame(gameOverrides);
  return {
    game,
    score,
    displayScore: score === null ? null : score.score.toFixed(1),
    purchaseUtilization: calculatePurchaseUtilization({
      acquisition: game.acquisition,
      entertainmentBenchmark: null,
      playCount: game.playCountEvidence,
      duration: game.durationEvidence,
      playerRange: game.playerRangeEvidence,
      suggestedPlayerPoll: game.suggestedPlayerPoll,
      fitness: score === null ? null : score.score.toFixed(1),
    }),
  };
}

const AXES: Axis[] = [
  {
    id: "fun",
    name: "Fun Factor",
    description: null,
    weight: 50,
    enabled: true,
    source: "personal",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

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

const EMPTY_TOURNAMENT: Record<string, TournamentGameStatsDisplay> = {};

// ---------------------------------------------------------------------------
// sortGames
// ---------------------------------------------------------------------------

describe("sortGames", () => {
  const gameA = makeGWS({ id: "a", name: "Alpha", ratings: { fun: 8 } }, makeScore(7.5));
  const gameB = makeGWS({ id: "b", name: "Bravo", ratings: { fun: 5 } }, makeScore(4.2));
  const gameC = makeGWS({ id: "c", name: "Charlie", ratings: { fun: 9 } }, makeScore(9.1));
  const gameNoScore = makeGWS({ id: "d", name: "Delta" });
  const games = [gameA, gameB, gameC, gameNoScore];

  test("sort by fitness desc", () => {
    const { withValue, withoutValue } = sortGames(games, "fitness", "desc", EMPTY_TOURNAMENT);
    expect(withValue.map((g) => g.game.name)).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(withoutValue.map((g) => g.game.name)).toEqual(["Delta"]);
  });

  test("sort by fitness asc", () => {
    const { withValue } = sortGames(games, "fitness", "asc", EMPTY_TOURNAMENT);
    expect(withValue.map((g) => g.game.name)).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  test("sort by tournament desc", () => {
    const stats: Record<string, TournamentGameStatsDisplay> = {
      a: {
        normalizedScore: 7.0,
        displayLabel: "7.0",
        isProvisional: false,
        comparisonCount: 10,
        eloRating: 1600,
        wins: 5,
        losses: 5,
        recentComparisons: [],
      },
      c: {
        normalizedScore: 8.5,
        displayLabel: "8.5",
        isProvisional: false,
        comparisonCount: 10,
        eloRating: 1700,
        wins: 5,
        losses: 5,
        recentComparisons: [],
      },
    };
    const { withValue, withoutValue } = sortGames(games, "tournament", "desc", stats);
    expect(withValue.map((g) => g.game.id)).toEqual(["c", "a"]);
    expect(withoutValue).toHaveLength(2);
  });

  test("sort by name asc", () => {
    const { withValue } = sortGames(games, "name", "asc", EMPTY_TOURNAMENT);
    expect(withValue.map((g) => g.game.name)).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
  });

  test("sort by name desc", () => {
    const { withValue } = sortGames(games, "name", "desc", EMPTY_TOURNAMENT);
    expect(withValue.map((g) => g.game.name)).toEqual(["Delta", "Charlie", "Bravo", "Alpha"]);
  });

  test("sort by yearPublished", () => {
    const g1 = makeGWS({ id: "1", name: "Old", yearPublished: 2000 });
    const g2 = makeGWS({ id: "2", name: "New", yearPublished: 2024 });
    const g3 = makeGWS({ id: "3", name: "NoYear" });
    const { withValue, withoutValue } = sortGames(
      [g1, g2, g3],
      "yearPublished",
      "desc",
      EMPTY_TOURNAMENT,
    );
    expect(withValue.map((g) => g.game.name)).toEqual(["New", "Old"]);
    expect(withoutValue.map((g) => g.game.name)).toEqual(["NoYear"]);
  });

  test("sort by createdAt", () => {
    const g1 = makeGWS({ id: "1", name: "First", createdAt: "2026-01-01T00:00:00.000Z" });
    const g2 = makeGWS({ id: "2", name: "Second", createdAt: "2026-06-01T00:00:00.000Z" });
    const { withValue } = sortGames([g1, g2], "createdAt", "desc", EMPTY_TOURNAMENT);
    expect(withValue.map((g) => g.game.name)).toEqual(["Second", "First"]);
  });

  test("sort by updatedAt", () => {
    const g1 = makeGWS({ id: "1", name: "Stale", updatedAt: "2025-01-01T00:00:00.000Z" });
    const g2 = makeGWS({ id: "2", name: "Fresh", updatedAt: "2026-06-01T00:00:00.000Z" });
    const { withValue } = sortGames([g1, g2], "updatedAt", "desc", EMPTY_TOURNAMENT);
    expect(withValue.map((g) => g.game.name)).toEqual(["Fresh", "Stale"]);
  });

  test("sort by playerCount", () => {
    const g1 = makeGWS({ id: "1", name: "Light", minPlayers: 1, maxPlayers: 2 });
    const g2 = makeGWS({ id: "2", name: "Party", minPlayers: 4, maxPlayers: 8 });
    const g3 = makeGWS({ id: "3", name: "NoInfo" });
    const { withValue, withoutValue } = sortGames(
      [g2, g1, g3],
      "playerCount",
      "asc",
      EMPTY_TOURNAMENT,
    );
    expect(withValue.map((g) => g.game.name)).toEqual(["Light", "Party"]);
    expect(withoutValue.map((g) => g.game.name)).toEqual(["NoInfo"]);
  });

  test("sort by playTime", () => {
    const g1 = makeGWS({ id: "1", name: "Quick", playingTime: 30 });
    const g2 = makeGWS({ id: "2", name: "Long", playingTime: 180 });
    const g3 = makeGWS({ id: "3", name: "Unknown" });
    const { withValue, withoutValue } = sortGames(
      [g2, g1, g3],
      "playTime",
      "asc",
      EMPTY_TOURNAMENT,
    );
    expect(withValue.map((g) => g.game.name)).toEqual(["Quick", "Long"]);
    expect(withoutValue.map((g) => g.game.name)).toEqual(["Unknown"]);
  });

  test("sort by bggRating", () => {
    const g1 = makeGWS({
      id: "1",
      name: "Low",
      bggData: {
        communityRating: 5.5,
        bayesAverage: 5.0,
        weight: null,
        numWeightVotes: 0,
        description: null,
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const g2 = makeGWS({
      id: "2",
      name: "High",
      bggData: {
        communityRating: 8.2,
        bayesAverage: 7.5,
        weight: null,
        numWeightVotes: 0,
        description: null,
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const g3 = makeGWS({ id: "3", name: "NoBgg" });
    const { withValue, withoutValue } = sortGames(
      [g1, g2, g3],
      "bggRating",
      "desc",
      EMPTY_TOURNAMENT,
    );
    expect(withValue.map((g) => g.game.name)).toEqual(["High", "Low"]);
    expect(withoutValue.map((g) => g.game.name)).toEqual(["NoBgg"]);
  });

  test("sort by bggWeight", () => {
    const makeBgg = (weight: number | null) => ({
      communityRating: 7.0,
      bayesAverage: 6.5,
      weight,
      numWeightVotes: 10,
      description: null,
      mechanics: [] as { id: number; name: string }[],
      categories: [] as { id: number; name: string }[],
      families: [] as { id: number; name: string }[],
      subdomains: [] as { id: number; name: string }[],
      bestPlayerCount: null,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });
    const g1 = makeGWS({ id: "1", name: "Light", bggData: makeBgg(1.5) });
    const g2 = makeGWS({ id: "2", name: "Heavy", bggData: makeBgg(4.2) });
    const g3 = makeGWS({ id: "3", name: "NoWeight", bggData: makeBgg(null) });
    const { withValue, withoutValue } = sortGames(
      [g1, g2, g3],
      "bggWeight",
      "desc",
      EMPTY_TOURNAMENT,
    );
    expect(withValue.map((g) => g.game.name)).toEqual(["Heavy", "Light"]);
    expect(withoutValue.map((g) => g.game.name)).toEqual(["NoWeight"]);
  });

  test("sort by axis", () => {
    const { withValue, withoutValue } = sortGames(games, "axis:fun", "desc", EMPTY_TOURNAMENT);
    expect(withValue.map((g) => g.game.name)).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(withoutValue.map((g) => g.game.name)).toEqual(["Delta"]);
  });

  test("sort by derived axis uses effective breakdown ratings", () => {
    const derivedAxes: Axis[] = [
      {
        id: "w",
        name: "Weight",
        description: null,
        weight: 50,
        enabled: true,
        source: "derived",
        derivedField: "weight",
        configuration: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const g1 = makeGWS(
      { id: "1", name: "Light", bggData: makeBggData({ weight: 1.5 }) },
      makeAxisScore("w", 2, 1.5),
    );
    const g2 = makeGWS(
      { id: "2", name: "Heavy", bggData: makeBggData({ weight: 4.0 }) },
      makeAxisScore("w", 8, 4),
    );
    const g3 = makeGWS(
      { id: "3", name: "Medium", bggData: makeBggData({ weight: 2.8 }) },
      makeAxisScore("w", 5, 2.8),
    );
    const g4 = makeGWS({ id: "4", name: "NoBgg" });

    const { withValue, withoutValue } = sortGames(
      [g1, g2, g3, g4],
      "axis:w",
      "desc",
      EMPTY_TOURNAMENT,
      derivedAxes,
    );
    expect(withValue.map((g) => g.game.name)).toEqual(["Heavy", "Medium", "Light"]);
    expect(withoutValue.map((g) => g.game.name)).toEqual(["NoBgg"]);
  });

  test("sort by Play Time axis uses effective score instead of minutes", () => {
    const playTimeAxis: Axis = {
      id: "duration",
      name: "Preferred Duration",
      description: null,
      weight: 50,
      enabled: true,
      source: "derived",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 240 },
      preferenceShape: "lower-is-better",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const quick = makeGWS(
      { id: "quick", name: "Quick", playingTime: 60 },
      makeAxisScore("duration", 8, 60),
    );
    const long = makeGWS(
      { id: "long", name: "Long", playingTime: 180 },
      makeAxisScore("duration", 3, 180),
    );
    const missing = makeGWS(
      { id: "missing", name: "Missing", playingTime: 90 },
      makeAxisScore("duration", null, 90),
    );

    const { withValue, withoutValue } = sortGames(
      [long, missing, quick],
      "axis:duration",
      "desc",
      EMPTY_TOURNAMENT,
      [playTimeAxis],
    );

    expect(withValue.map((entry) => entry.game.name)).toEqual(["Quick", "Long"]);
    expect(withoutValue.map((entry) => entry.game.name)).toEqual(["Missing"]);
  });

  test("nulls sort to bottom regardless of direction", () => {
    const scored = makeGWS({ id: "s", name: "Scored" }, makeScore(5.0));
    const unscored = makeGWS({ id: "u", name: "Unscored" });

    const descResult = sortGames([unscored, scored], "fitness", "desc", EMPTY_TOURNAMENT);
    expect(descResult.withValue.map((g) => g.game.name)).toEqual(["Scored"]);
    expect(descResult.withoutValue.map((g) => g.game.name)).toEqual(["Unscored"]);

    const ascResult = sortGames([unscored, scored], "fitness", "asc", EMPTY_TOURNAMENT);
    expect(ascResult.withValue.map((g) => g.game.name)).toEqual(["Scored"]);
    expect(ascResult.withoutValue.map((g) => g.game.name)).toEqual(["Unscored"]);
  });

  test("direction toggle reverses order", () => {
    const g1 = makeGWS({ id: "1", name: "Low" }, makeScore(3.0));
    const g2 = makeGWS({ id: "2", name: "High" }, makeScore(8.0));

    const desc = sortGames([g1, g2], "fitness", "desc", EMPTY_TOURNAMENT);
    expect(desc.withValue.map((g) => g.game.name)).toEqual(["High", "Low"]);

    const asc = sortGames([g1, g2], "fitness", "asc", EMPTY_TOURNAMENT);
    expect(asc.withValue.map((g) => g.game.name)).toEqual(["Low", "High"]);
  });

  test.each([
    ["numeric", "fitness", makeScore(5)],
    ["date", "createdAt", null],
  ] as const)(
    "keeps equal %s primary values in identity order in both directions",
    (_, field, score) => {
      const zulu = makeGWS(
        { id: "zulu", name: "Zulu", createdAt: "2026-01-01T00:00:00.000Z" },
        score,
      );
      const alpha = makeGWS(
        { id: "alpha", name: "Alpha", createdAt: "2026-01-01T00:00:00.000Z" },
        score,
      );

      for (const direction of ["asc", "desc"] as const) {
        const { withValue } = sortGames([zulu, alpha], field, direction, EMPTY_TOURNAMENT);
        expect(withValue.map((game) => game.game.id)).toEqual(["alpha", "zulu"]);
      }
    },
  );

  test("uses Unicode code-point identity order for equal generic values", () => {
    const bmp = makeGWS({ id: "bmp", name: "\uE000" }, makeScore(5));
    const supplementary = makeGWS({ id: "supplementary", name: "\u{10000}" }, makeScore(5));

    for (const direction of ["asc", "desc"] as const) {
      const { withValue } = sortGames([supplementary, bmp], "fitness", direction, EMPTY_TOURNAMENT);
      expect(withValue.map((game) => game.game.id)).toEqual(["bmp", "supplementary"]);
    }
  });

  test("uses lowercased names for the Name primary comparison", () => {
    const uppercaseInitial = makeGWS({ id: "zoo", name: "Zoo" });
    const lowercaseInitial = makeGWS({ id: "apple", name: "apple" });

    expect(
      sortGames(
        [uppercaseInitial, lowercaseInitial],
        "name",
        "asc",
        EMPTY_TOURNAMENT,
      ).withValue.map((game) => game.game.id),
    ).toEqual(["apple", "zoo"]);
    expect(
      sortGames(
        [uppercaseInitial, lowercaseInitial],
        "name",
        "desc",
        EMPTY_TOURNAMENT,
      ).withValue.map((game) => game.game.id),
    ).toEqual(["zoo", "apple"]);
  });

  test("preserves case-insensitive Name ordering and uses original name for ties", () => {
    const lowercase = makeGWS({ id: "lower", name: "alpha" });
    const uppercase = makeGWS({ id: "upper", name: "Alpha" });

    for (const direction of ["asc", "desc"] as const) {
      const { withValue } = sortGames([lowercase, uppercase], "name", direction, EMPTY_TOURNAMENT);
      expect(withValue.map((game) => game.game.id)).toEqual(["upper", "lower"]);
    }
  });

  test("normalizes identity names to NFC before falling back to stable ID", () => {
    const composed = makeGWS({ id: "b", name: "\u00e9" }, makeScore(5));
    const decomposed = makeGWS({ id: "a", name: "e\u0301" }, makeScore(5));

    for (const direction of ["asc", "desc"] as const) {
      const { withValue } = sortGames(
        [composed, decomposed],
        "fitness",
        direction,
        EMPTY_TOURNAMENT,
      );
      expect(withValue.map((game) => game.game.id)).toEqual(["a", "b"]);
    }
  });

  test("uses stable ID for identical generic names in both directions", () => {
    const later = makeGWS({ id: "id-b", name: "Same" }, makeScore(5));
    const earlier = makeGWS({ id: "id-a", name: "Same" }, makeScore(5));

    for (const direction of ["asc", "desc"] as const) {
      const { withValue } = sortGames([later, earlier], "fitness", direction, EMPTY_TOURNAMENT);
      expect(withValue.map((game) => game.game.id)).toEqual(["id-a", "id-b"]);
    }
  });

  test("sorts no-value games by complete normalized identity in both directions", () => {
    const supplementary = makeGWS({ id: "supplementary", name: "\u{10000}" });
    const bmp = makeGWS({ id: "bmp", name: "\uE000" });
    const composed = makeGWS({ id: "b", name: "\u00e9" });
    const decomposed = makeGWS({ id: "a", name: "e\u0301" });

    for (const direction of ["asc", "desc"] as const) {
      const { withoutValue } = sortGames(
        [supplementary, composed, bmp, decomposed],
        "fitness",
        direction,
        EMPTY_TOURNAMENT,
      );
      expect(withoutValue.map((game) => game.game.id)).toEqual(["a", "b", "bmp", "supplementary"]);
    }
  });

  test("withoutValue sorted by Unicode code-point name order", () => {
    const g1 = makeGWS({ id: "1", name: "Zulu" });
    const g2 = makeGWS({ id: "2", name: "Alpha" });
    const g3 = makeGWS({ id: "3", name: "Mike" });
    const { withoutValue } = sortGames([g1, g2, g3], "fitness", "desc", EMPTY_TOURNAMENT);
    expect(withoutValue.map((g) => g.game.name)).toEqual(["Alpha", "Mike", "Zulu"]);
  });

  // REQ-TAXIS-13: sorting by tournament rank and by fitness must remain
  // independent surfaces. Even though tournament is now folded into fitness,
  // the two orderings diverge whenever non-tournament axes carry weight.
  // Both orderings remain informative.
  test("tournament sort and fitness sort produce different orderings when axes disagree", () => {
    // Construct a collection where tournament rank and fitness rank disagree.
    // Game A: high fitness (driven by personal axes), low tournament score.
    // Game B: low fitness, high tournament score.
    // Game C: middling on both.
    const gameA = makeGWS({ id: "a", name: "Personal Favorite" }, makeScore(9.0));
    const gameB = makeGWS({ id: "b", name: "Tournament Champion" }, makeScore(4.5));
    const gameC = makeGWS({ id: "c", name: "Middle Ground" }, makeScore(6.5));
    const games = [gameA, gameB, gameC];

    const tournamentStats: Record<string, TournamentGameStatsDisplay> = {
      a: {
        normalizedScore: 3.0,
        displayLabel: "3.0",
        isProvisional: false,
        comparisonCount: 10,
        eloRating: 1200,
        wins: 2,
        losses: 8,
        recentComparisons: [],
      },
      b: {
        normalizedScore: 9.5,
        displayLabel: "9.5",
        isProvisional: false,
        comparisonCount: 10,
        eloRating: 1800,
        wins: 9,
        losses: 1,
        recentComparisons: [],
      },
      c: {
        normalizedScore: 6.0,
        displayLabel: "6.0",
        isProvisional: false,
        comparisonCount: 10,
        eloRating: 1500,
        wins: 5,
        losses: 5,
        recentComparisons: [],
      },
    };

    const fitnessSort = sortGames(games, "fitness", "desc", tournamentStats);
    const tournamentSort = sortGames(games, "tournament", "desc", tournamentStats);

    const fitnessOrder = fitnessSort.withValue.map((g) => g.game.id);
    const tournamentOrder = tournamentSort.withValue.map((g) => g.game.id);

    // Fitness ordering: A (9.0) > C (6.5) > B (4.5)
    expect(fitnessOrder).toEqual(["a", "c", "b"]);
    // Tournament ordering: B (9.5) > C (6.0) > A (3.0)
    expect(tournamentOrder).toEqual(["b", "c", "a"]);

    // Explicit divergence assertion: the two surfaces produce DIFFERENT
    // orderings on this constructed collection.
    expect(tournamentOrder).not.toEqual(fitnessOrder);
  });

  // REQ-TAXIS-12: standalone tournament rank surface is preserved. Sorting by
  // "tournament" reads from tournamentStats directly, NOT from the fitness
  // breakdown. This locks down that the surfaces are wired separately.
  test("tournament sort reads from tournamentStats, independent of fitness score", () => {
    // A game whose fitness score has tournament folded in but whose
    // tournamentStats reflects only the standalone ELO surface.
    const game = makeGWS({ id: "x", name: "X" }, makeScore(8.0));
    const tournamentStats: Record<string, TournamentGameStatsDisplay> = {
      x: {
        normalizedScore: 2.0,
        displayLabel: "2.0",
        isProvisional: false,
        comparisonCount: 10,
        eloRating: 1100,
        wins: 1,
        losses: 9,
        recentComparisons: [],
      },
    };
    const { withValue: byFitness } = sortGames([game], "fitness", "desc", tournamentStats);
    const { withValue: byTournament } = sortGames([game], "tournament", "desc", tournamentStats);

    // Sort modes return the same single game but reflect different score values.
    expect(byFitness[0].score?.score).toBe(8.0);
    // Tournament sort reads from tournamentStats, not score.
    const tournamentValue = tournamentStats[byTournament[0].game.id]?.normalizedScore;
    expect(tournamentValue).toBe(2.0);
  });
});

test("disabled legacy axes are excluded from sort choices", () => {
  const legacy: Axis = {
    id: "legacy",
    name: "Old field",
    description: null,
    weight: 50,
    enabled: false,
    source: "legacy",
    reason: "unknown field",
    legacyField: "old",
    legacyPayload: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const fields = buildSortFields([...AXES, legacy], false, false);
  expect(fields.some((field) => field.id === "axis:fun")).toBe(true);
  expect(fields.some((field) => field.id === "axis:legacy")).toBe(false);
});

// ---------------------------------------------------------------------------
// matchesFilters
// ---------------------------------------------------------------------------

describe("matchesFilters", () => {
  const defaultFilters: FilterState = {
    search: "",
    ratedStatus: "all",
    playedStatus: "all",
    playerCount: null,
  };

  test("default filters match everything", () => {
    expect(matchesFilters(makeGWS(), defaultFilters)).toBe(true);
  });

  test("search matches case-insensitively", () => {
    const gws = makeGWS({ name: "Wingspan" });
    expect(matchesFilters(gws, { ...defaultFilters, search: "wing" })).toBe(true);
    expect(matchesFilters(gws, { ...defaultFilters, search: "WING" })).toBe(true);
    expect(matchesFilters(gws, { ...defaultFilters, search: "catan" })).toBe(false);
  });

  test("rated status: rated includes only scored games", () => {
    const rated = makeGWS({}, makeScore(7.0));
    const unrated = makeGWS({});
    const filter: FilterState = { ...defaultFilters, ratedStatus: "rated" };
    expect(matchesFilters(rated, filter)).toBe(true);
    expect(matchesFilters(unrated, filter)).toBe(false);
  });

  test("rated status: unrated includes only unscored games", () => {
    const rated = makeGWS({}, makeScore(7.0));
    const unrated = makeGWS({});
    const filter: FilterState = { ...defaultFilters, ratedStatus: "unrated" };
    expect(matchesFilters(rated, filter)).toBe(false);
    expect(matchesFilters(unrated, filter)).toBe(true);
  });

  test("player count: minPlayers <= N <= maxPlayers", () => {
    const game = makeGWS({ minPlayers: 2, maxPlayers: 5 });
    expect(matchesFilters(game, { ...defaultFilters, playerCount: 1 })).toBe(false);
    expect(matchesFilters(game, { ...defaultFilters, playerCount: 2 })).toBe(true);
    expect(matchesFilters(game, { ...defaultFilters, playerCount: 3 })).toBe(true);
    expect(matchesFilters(game, { ...defaultFilters, playerCount: 5 })).toBe(true);
    expect(matchesFilters(game, { ...defaultFilters, playerCount: 6 })).toBe(false);
  });

  test("player count: excludes games with null player counts", () => {
    const game = makeGWS({ minPlayers: null, maxPlayers: null });
    expect(matchesFilters(game, { ...defaultFilters, playerCount: 3 })).toBe(false);
  });

  test("predicted-only game (score non-null, ratedAxisCount 0) is 'unrated'", () => {
    const predictedOnly = makeGWS(
      {},
      makeScore(6.5, {
        readinessStage: 2,
        confidence: "moderate",
        predictedAxisCount: 3,
        actualAxisCount: 0,
        referenceGameCount: 5,
        coveragePercent: 0.6,
      }),
    );
    // Has a score, but all axes are predicted, so it's "unrated"
    expect(matchesFilters(predictedOnly, { ...defaultFilters, ratedStatus: "rated" })).toBe(false);
    expect(matchesFilters(predictedOnly, { ...defaultFilters, ratedStatus: "unrated" })).toBe(true);
  });

  test("partially predicted game (some actual, some predicted) is 'rated'", () => {
    const partial = makeGWS(
      {},
      makeScore(7.2, {
        readinessStage: 2,
        confidence: "strong",
        predictedAxisCount: 2,
        actualAxisCount: 3,
        referenceGameCount: 5,
        coveragePercent: 0.8,
      }),
    );
    expect(matchesFilters(partial, { ...defaultFilters, ratedStatus: "rated" })).toBe(true);
    expect(matchesFilters(partial, { ...defaultFilters, ratedStatus: "unrated" })).toBe(false);
  });

  test("AND combination of multiple filters", () => {
    const rated = makeGWS({ name: "Wingspan", minPlayers: 1, maxPlayers: 5 }, makeScore(8.0));
    const filter: FilterState = {
      search: "wing",
      ratedStatus: "rated",
      playedStatus: "all",
      playerCount: 3,
    };
    expect(matchesFilters(rated, filter)).toBe(true);

    // Fails search
    const wrongName = makeGWS({ name: "Catan", minPlayers: 1, maxPlayers: 5 }, makeScore(8.0));
    expect(matchesFilters(wrongName, filter)).toBe(false);

    // Fails rated status
    const unrated = makeGWS({ name: "Wingspan", minPlayers: 1, maxPlayers: 5 });
    expect(matchesFilters(unrated, filter)).toBe(false);

    // Fails player count
    const twoPlayerOnly = makeGWS(
      { name: "Wingspan", minPlayers: 2, maxPlayers: 2 },
      makeScore(8.0),
    );
    expect(matchesFilters(twoPlayerOnly, filter)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getScoreDisplay
// ---------------------------------------------------------------------------

describe("getScoreDisplay", () => {
  const ratedGame = makeGWS(
    {
      id: "r",
      name: "Rated",
      yearPublished: 2020,
      minPlayers: 2,
      maxPlayers: 4,
      playingTime: 60,
      ratings: { fun: 7 },
      bggData: {
        communityRating: 7.8,
        bayesAverage: 7.2,
        weight: 3.1,
        numWeightVotes: 100,
        description: null,
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    makeScore(7.5),
  );

  const unratedGame = makeGWS({ id: "u", name: "Unrated" });

  test("fitness: shows score with dot class", () => {
    const result = getScoreDisplay(ratedGame, "fitness", EMPTY_TOURNAMENT);
    expect(result.text).toBe("7.5");
    expect(result.dotClass).toBe("high");
  });

  test("fitness: unrated shows 'not rated'", () => {
    const result = getScoreDisplay(unratedGame, "fitness", EMPTY_TOURNAMENT);
    expect(result.text).toBe("not rated");
    expect(result.className).toBe("score-unrated");
  });

  test("name sort: falls back to fitness display", () => {
    const result = getScoreDisplay(ratedGame, "name", EMPTY_TOURNAMENT);
    expect(result.text).toBe("7.5");
  });

  test("tournament: shows display label", () => {
    const stats: Record<string, TournamentGameStatsDisplay> = {
      r: {
        normalizedScore: 7.5,
        displayLabel: "7.5",
        isProvisional: false,
        comparisonCount: 10,
        eloRating: 1600,
        wins: 5,
        losses: 5,
        recentComparisons: [],
      },
    };
    const result = getScoreDisplay(ratedGame, "tournament", stats);
    expect(result.text).toBe("7.5");
  });

  test("tournament: missing stats shows dash", () => {
    const result = getScoreDisplay(ratedGame, "tournament", EMPTY_TOURNAMENT);
    expect(result.text).toBe("-");
  });

  test("yearPublished: shows year", () => {
    const result = getScoreDisplay(ratedGame, "yearPublished", EMPTY_TOURNAMENT);
    expect(result.text).toBe("2020");
  });

  test("yearPublished: null shows ---", () => {
    const result = getScoreDisplay(unratedGame, "yearPublished", EMPTY_TOURNAMENT);
    expect(result.text).toBe("---");
  });

  test("playerCount: shows range", () => {
    const result = getScoreDisplay(ratedGame, "playerCount", EMPTY_TOURNAMENT);
    expect(result.text).toBe("2-4");
  });

  test("playerCount: equal min/max shows single number", () => {
    const solo = makeGWS({ minPlayers: 1, maxPlayers: 1 });
    const result = getScoreDisplay(solo, "playerCount", EMPTY_TOURNAMENT);
    expect(result.text).toBe("1");
  });

  test("playerCount: null shows ---", () => {
    const result = getScoreDisplay(unratedGame, "playerCount", EMPTY_TOURNAMENT);
    expect(result.text).toBe("---");
  });

  test("playTime: shows minutes", () => {
    const result = getScoreDisplay(ratedGame, "playTime", EMPTY_TOURNAMENT);
    expect(result.text).toBe("60 min");
  });

  test("playTime: null shows ---", () => {
    const result = getScoreDisplay(unratedGame, "playTime", EMPTY_TOURNAMENT);
    expect(result.text).toBe("---");
  });

  test("bggRating: shows rating", () => {
    const result = getScoreDisplay(ratedGame, "bggRating", EMPTY_TOURNAMENT);
    expect(result.text).toBe("7.8");
  });

  test("bggRating: no bgg data shows ---", () => {
    const result = getScoreDisplay(unratedGame, "bggRating", EMPTY_TOURNAMENT);
    expect(result.text).toBe("---");
  });

  test("bggWeight: shows weight", () => {
    const result = getScoreDisplay(ratedGame, "bggWeight", EMPTY_TOURNAMENT);
    expect(result.text).toBe("3.1");
  });

  test("bggWeight: null weight shows ---", () => {
    const noBggWeight = makeGWS({
      bggData: {
        communityRating: 7.0,
        bayesAverage: 6.5,
        weight: null,
        numWeightVotes: 0,
        description: null,
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const result = getScoreDisplay(noBggWeight, "bggWeight", EMPTY_TOURNAMENT);
    expect(result.text).toBe("---");
  });

  test("createdAt: shows relative date", () => {
    const result = getScoreDisplay(ratedGame, "createdAt", EMPTY_TOURNAMENT);
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
  });

  test("updatedAt: shows relative date", () => {
    const result = getScoreDisplay(ratedGame, "updatedAt", EMPTY_TOURNAMENT);
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
  });

  test("axis: shows rating value", () => {
    const result = getScoreDisplay(ratedGame, "axis:fun", EMPTY_TOURNAMENT);
    expect(result.text).toBe("7");
    expect(result.className).toContain("axis-score");
  });

  test("derived axis: shows effective score instead of native value", () => {
    const axis: Axis = {
      id: "duration",
      name: "Preferred Duration",
      description: null,
      weight: 50,
      enabled: true,
      source: "derived",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 240 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const game = makeGWS({ playingTime: 120 }, makeAxisScore("duration", 8.5, 120));

    const result = getScoreDisplay(game, "axis:duration", EMPTY_TOURNAMENT, [axis]);

    expect(result.text).toBe("8.5");
  });

  test("derived axis: null effective score shows missing despite a native value", () => {
    const game = makeGWS({ playingTime: 120 }, makeAxisScore("duration", null, 120));

    const result = getScoreDisplay(game, "axis:duration", EMPTY_TOURNAMENT, [
      {
        id: "duration",
        name: "Preferred Duration",
        description: null,
        weight: 50,
        enabled: true,
        source: "derived",
        derivedField: "playingTime",
        configuration: { maximumScoringTime: 240 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    expect(result.text).toBe("---");
  });

  test("axis: no rating shows ---", () => {
    const result = getScoreDisplay(unratedGame, "axis:fun", EMPTY_TOURNAMENT);
    expect(result.text).toBe("---");
  });
});

// ---------------------------------------------------------------------------
// getSeparatorLabel
// ---------------------------------------------------------------------------

describe("getSeparatorLabel", () => {
  test("fitness: shows not yet rated", () => {
    expect(getSeparatorLabel("fitness", 3, AXES)).toBe("Not yet rated - 3 games");
  });

  test("tournament: shows not yet ranked", () => {
    expect(getSeparatorLabel("tournament", 1, AXES)).toBe("Not yet ranked - 1 game");
  });

  test("name: returns null", () => {
    expect(getSeparatorLabel("name", 5, AXES)).toBeNull();
  });

  test("playerCount: shows no player count data", () => {
    expect(getSeparatorLabel("playerCount", 2, AXES)).toBe("No player count data - 2 games");
  });

  test("playTime: shows no play time data", () => {
    expect(getSeparatorLabel("playTime", 4, AXES)).toBe("No play time data - 4 games");
  });

  test("bggRating: shows no BGG rating data", () => {
    expect(getSeparatorLabel("bggRating", 1, AXES)).toBe("No BGG rating data - 1 game");
  });

  test("bggWeight: shows no BGG weight data", () => {
    expect(getSeparatorLabel("bggWeight", 2, AXES)).toBe("No BGG weight data - 2 games");
  });

  test("yearPublished: shows no year published", () => {
    expect(getSeparatorLabel("yearPublished", 3, AXES)).toBe("No year published - 3 games");
  });

  test("createdAt: returns null", () => {
    expect(getSeparatorLabel("createdAt", 1, AXES)).toBeNull();
  });

  test("updatedAt: returns null", () => {
    expect(getSeparatorLabel("updatedAt", 1, AXES)).toBeNull();
  });

  test("axis: shows axis name", () => {
    const result = getSeparatorLabel("axis:fun", 2, AXES);
    expect(result).toBe("No rating on \u2018Fun Factor\u2019 - 2 games");
  });

  test("axis: unknown axis shows 'unknown'", () => {
    const result = getSeparatorLabel("axis:missing", 1, AXES);
    expect(result).toBe("No rating on \u2018unknown\u2019 - 1 game");
  });

  test("singular game count", () => {
    expect(getSeparatorLabel("fitness", 1, AXES)).toBe("Not yet rated - 1 game");
  });
});

describe("Collection contextual return helpers", () => {
  function navigationContext(
    overrides: Partial<CollectionNavigationContextV1["projection"]> = {},
  ): CollectionNavigationContextV1 {
    return {
      version: 1,
      key: "00000000-0000-4000-8000-000000000001",
      entries: [{ id: "game-1", name: "Game One" }],
      collectionScope: { showPreviouslyOwned: false, missingDimensionsOnly: false },
      projection: {
        sort: { field: "fitness", direction: "desc" },
        filters: DEFAULT_FILTERS,
        predictionsOn: false,
        effectivePredictionsOn: false,
        nichesOn: false,
        ...overrides,
      },
      lastAccessedAt: 1_000,
    };
  }

  function capabilities(
    overrides: Partial<Parameters<typeof canRestoreCollectionProjection>[1]> = {},
  ): Parameters<typeof canRestoreCollectionProjection>[1] {
    return {
      scope: { showPreviouslyOwned: false, missingDimensionsOnly: false },
      availableSortFields: new Set(["fitness", "tournament", "bggRating", "axis:fun"]),
      predictionSourceAvailable: true,
      nicheSourceAvailable: true,
      effectivePredictionsOn: false,
      collectionEmpty: false,
      ...overrides,
    };
  }

  test("requires exact scope and current sort capability", () => {
    const context = navigationContext();
    expect(canRestoreCollectionProjection(context, capabilities())).toBe(true);
    expect(
      canRestoreCollectionProjection(
        context,
        capabilities({
          scope: { showPreviouslyOwned: true, missingDimensionsOnly: false },
        }),
      ),
    ).toBe(false);

    for (const field of ["axis:removed", "tournament", "bggRating"]) {
      const sorted = navigationContext({ sort: { field, direction: "desc" } });
      expect(
        canRestoreCollectionProjection(
          sorted,
          capabilities({ availableSortFields: new Set(["fitness"]) }),
        ),
        field,
      ).toBe(false);
    }
  });

  test("requires enabled enrichment sources and matching effective prediction state", () => {
    const predicted = navigationContext({
      predictionsOn: true,
      effectivePredictionsOn: true,
      nichesOn: true,
    });
    expect(
      canRestoreCollectionProjection(predicted, capabilities({ effectivePredictionsOn: true })),
    ).toBe(true);
    expect(
      canRestoreCollectionProjection(
        predicted,
        capabilities({ predictionSourceAvailable: false, effectivePredictionsOn: false }),
      ),
    ).toBe(false);
    expect(
      canRestoreCollectionProjection(
        predicted,
        capabilities({ nicheSourceAvailable: false, effectivePredictionsOn: true }),
      ),
    ).toBe(false);
    expect(
      canRestoreCollectionProjection(predicted, capabilities({ effectivePredictionsOn: false })),
    ).toBe(false);
  });

  test("restores a structurally valid empty collection despite row capability loss", () => {
    const context = navigationContext({
      sort: { field: "axis:removed", direction: "asc" },
      predictionsOn: true,
      effectivePredictionsOn: true,
      nichesOn: true,
    });
    expect(
      canRestoreCollectionProjection(
        context,
        capabilities({
          availableSortFields: new Set(),
          predictionSourceAvailable: false,
          nicheSourceAvailable: false,
          effectivePredictionsOn: false,
          collectionEmpty: true,
        }),
      ),
    ).toBe(true);
    expect(
      canRestoreCollectionProjection(
        context,
        capabilities({
          scope: { showPreviouslyOwned: true, missingDimensionsOnly: false },
          collectionEmpty: true,
        }),
      ),
    ).toBe(false);
  });

  test("computes effective prediction use under source and integrated settings", () => {
    expect(effectiveCollectionPredictionsOn(true, true, 0, false)).toBe(true);
    expect(effectiveCollectionPredictionsOn(false, true, 2, true)).toBe(true);
    expect(effectiveCollectionPredictionsOn(false, true, 2, false)).toBe(false);
    expect(effectiveCollectionPredictionsOn(true, false, 2, true)).toBe(false);
  });

  test("normalizes and persists ordinary and restored preferences", () => {
    const unavailable = { field: "axis:removed", direction: "asc" } as const;
    expect(normalizeCollectionSort(unavailable, new Set(["fitness"]), false)).toEqual(DEFAULT_SORT);
    expect(normalizeCollectionSort(unavailable, new Set(), true)).toBe(unavailable);

    const writes: Array<SortState | FilterState> = [];
    persistCollectionPreferences(
      { sort: unavailable, filters: DEFAULT_FILTERS },
      (sort) => writes.push(sort),
      (filters) => writes.push(filters),
    );
    expect(writes).toEqual([unavailable, DEFAULT_FILTERS]);
  });

  test("builds atomic contextual hrefs and stable flat-row focus IDs", () => {
    const key = "00000000-0000-4000-8000-000000000001";
    expect(buildCollectionGameHref("game / one", null)).toBe("/games/game%20%2F%20one");
    expect(buildCollectionGameHref("game / one", key)).toBe(
      `/games/game%20%2F%20one?collectionContext=${key}&collectionOrigin=game+%2F+one`,
    );
    expect(collectionRowId("game / one")).toBe("collection-game-game%20%2F%20one");
  });

  test("cleans only return transport while preserving scope, other params, and fragment", () => {
    expect(
      removeCollectionReturnTransport(
        "/collection?ownership=all&collectionContext=key&dimensions=missing&collectionOrigin=game&other=1#collection-game-game",
      ),
    ).toBe("/collection?ownership=all&dimensions=missing&other=1#collection-game-game");
    expect(removeCollectionReturnTransport("/collection?collectionContext=bad#kept")).toBe(
      "/collection#kept",
    );
  });

  test("selects the origin primary link or heading without changing projection", () => {
    const entries = [{ id: "first" }, { id: "origin" }];
    expect(selectCollectionReturnFocusId("origin", entries)).toBe(collectionRowId("origin"));
    expect(selectCollectionReturnFocusId("deleted", entries)).toBe("collection-heading");
    expect(selectCollectionReturnFocusId("origin", [])).toBe("collection-heading");
  });
});

describe("Collection scroll capture activation", () => {
  const primaryActivation = {
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: null,
  };

  test("accepts unmodified primary and keyboard-generated same-tab activation", () => {
    expect(shouldCaptureCollectionScroll(primaryActivation)).toBe(true);
    expect(shouldCaptureCollectionScroll({ ...primaryActivation, target: "_self" })).toBe(true);
    expect(shouldCaptureCollectionScroll({ ...primaryActivation, target: "_SELF" })).toBe(true);
  });

  test("rejects modifiers, non-primary buttons, prevented clicks, and non-self targets", () => {
    const rejected = [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { button: 1 },
      { button: 2 },
      { defaultPrevented: true },
      { target: "_blank" },
      { target: "named-frame" },
    ];
    for (const override of rejected) {
      expect(shouldCaptureCollectionScroll({ ...primaryActivation, ...override })).toBe(false);
    }
  });
});
