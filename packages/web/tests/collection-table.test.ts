import { describe, test, expect } from "bun:test";
import type {
  Game,
  GameWithScore,
  FitnessResult,
  Axis,
  TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import {
  sortGames,
  matchesFilters,
  getScoreDisplay,
  getSeparatorLabel,
  type FilterState,
} from "@/lib/collection-utils";

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
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeScore(score: number): FitnessResult {
  return {
    score,
    ratedAxisCount: 3,
    totalAxisCount: 5,
    breakdown: [],
  };
}

function makeGWS(
  gameOverrides: Partial<Game> = {},
  score: FitnessResult | null = null,
): GameWithScore {
  return { game: makeGame(gameOverrides), score };
}

const AXES: Axis[] = [
  {
    id: "fun",
    name: "Fun Factor",
    description: null,
    weight: 50,
    source: "personal",
    bggField: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

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
        suggestedPlayerCounts: [],
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
        suggestedPlayerCounts: [],
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
      suggestedPlayerCounts: [] as {
        playerCount: string;
        best: number;
        recommended: number;
        notRecommended: number;
      }[],
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

  test("withoutValue sorted alphabetically by name", () => {
    const g1 = makeGWS({ id: "1", name: "Zulu" });
    const g2 = makeGWS({ id: "2", name: "Alpha" });
    const g3 = makeGWS({ id: "3", name: "Mike" });
    const { withoutValue } = sortGames([g1, g2, g3], "fitness", "desc", EMPTY_TOURNAMENT);
    expect(withoutValue.map((g) => g.game.name)).toEqual(["Alpha", "Mike", "Zulu"]);
  });
});

// ---------------------------------------------------------------------------
// matchesFilters
// ---------------------------------------------------------------------------

describe("matchesFilters", () => {
  const defaultFilters: FilterState = { search: "", ratedStatus: "all", playedStatus: "all", playerCount: null };

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

  test("AND combination of multiple filters", () => {
    const rated = makeGWS({ name: "Wingspan", minPlayers: 1, maxPlayers: 5 }, makeScore(8.0));
    const filter: FilterState = { search: "wing", ratedStatus: "rated", playedStatus: "all" , playerCount: 3 };
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
        suggestedPlayerCounts: [],
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
        suggestedPlayerCounts: [],
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
