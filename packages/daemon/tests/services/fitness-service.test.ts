import { describe, test, expect } from "bun:test";
import { createFitnessService } from "../../src/services/fitness-service.js";
import type { Game, Axis, BggGameData, TournamentData } from "@shelf-judge/shared";

const fitnessService = createFitnessService();

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
    ownership: "owned",
    boxDimensions: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeAxis(overrides: Partial<Axis> & { id: string; name: string; weight: number }): Axis {
  return {
    description: null,
    source: "personal",
    bggField: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeBggData(overrides: Partial<BggGameData> = {}): BggGameData {
  return {
    communityRating: 7.0,
    bayesAverage: 6.5,
    weight: 3.0,
    numWeightVotes: 100,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    suggestedPlayerCounts: [],
    fetchedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("FitnessService", () => {
  describe("Wingspan example from design doc", () => {
    test("produces score 7.9 with correct breakdown", () => {
      const axes: Axis[] = [
        makeAxis({ id: "wife", name: "Wife will play it", weight: 40 }),
        makeAxis({ id: "visual", name: "Visual design", weight: 30 }),
        makeAxis({
          id: "complexity",
          name: "Complexity",
          weight: 20,
          source: "bgg",
          bggField: "weight",
        }),
        makeAxis({
          id: "community",
          name: "Community Rating",
          weight: 10,
          source: "bgg",
          bggField: "communityRating",
        }),
      ];

      const game = makeGame({
        ratings: { wife: 8, visual: 9 },
      });

      const bggData = makeBggData({
        communityRating: 8.1,
        weight: 2.9,
      });

      const result = fitnessService.calculateScore(game, axes, bggData);

      expect(result).not.toBeNull();
      // Score shifted from 7.9 to 7.8 due to corrected BGG weight normalization:
      // Old: weight 2.9 * 2 = 5.8, New: 1 + 9*(2.9-1)/(5-1) = 5.275 -> 5.3
      expect(result!.score).toBe(7.8);
      expect(result!.ratedAxisCount).toBe(4);
      expect(result!.totalAxisCount).toBe(4);

      // Verify breakdown
      const wife = result!.breakdown.find((b) => b.axisId === "wife")!;
      expect(wife.rating).toBe(8);
      expect(wife.source).toBe("personal");
      expect(wife.contribution).toBeCloseTo(3.2);

      const visual = result!.breakdown.find((b) => b.axisId === "visual")!;
      expect(visual.rating).toBe(9);
      expect(visual.source).toBe("personal");
      expect(visual.contribution).toBeCloseTo(2.7);

      const complexity = result!.breakdown.find((b) => b.axisId === "complexity")!;
      // Raw BGG weight 2.9 on 1-5 scale, higher-is-better: 1 + 9*(2.9-1)/4 = 5.275 -> 5.3
      expect(complexity.rating).toBe(5.3);
      expect(complexity.rawValue).toBe(2.9);
      expect(complexity.source).toBe("bgg");
      expect(complexity.contribution).toBeCloseTo(1.1);

      const community = result!.breakdown.find((b) => b.axisId === "community")!;
      expect(community.rating).toBe(8.1);
      expect(community.source).toBe("bgg");
      expect(community.contribution).toBeCloseTo(0.8);

      // Verify the math: (320 + 270 + 105.5 + 81) / 100 = 7.765 -> 7.8
      const totalContribution = result!.breakdown
        .filter((b) => b.contribution !== null)
        .reduce((sum, b) => sum + b.contribution!, 0);
      const totalWeight = result!.breakdown
        .filter((b) => b.rating !== null)
        .reduce((sum, b) => sum + b.weight, 0);
      expect(totalContribution).toBeCloseTo(7.8);
      expect(totalWeight).toBeCloseTo(100);
    });
  });

  describe("single axis", () => {
    test("score equals the rating", () => {
      const axes = [makeAxis({ id: "a1", name: "Fun", weight: 50 })];
      const game = makeGame({ ratings: { a1: 7 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(7);
    });
  });

  describe("multiple axes, equal weights", () => {
    test("produces simple average", () => {
      const axes = [
        makeAxis({ id: "a1", name: "Fun", weight: 10 }),
        makeAxis({ id: "a2", name: "Theme", weight: 10 }),
      ];
      const game = makeGame({ ratings: { a1: 6, a2: 8 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(7);
    });
  });

  describe("missing ratings", () => {
    test("excludes unrated axes from calculation", () => {
      const axes = [
        makeAxis({ id: "a1", name: "Fun", weight: 10 }),
        makeAxis({ id: "a2", name: "Theme", weight: 10 }),
        makeAxis({ id: "a3", name: "Art", weight: 10 }),
      ];
      // Only rate a1 and a3
      const game = makeGame({ ratings: { a1: 6, a3: 8 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(7); // (6+8)/2 = 7
      expect(result!.ratedAxisCount).toBe(2);
      expect(result!.totalAxisCount).toBe(3);

      const unrated = result!.breakdown.find((b) => b.axisId === "a2")!;
      expect(unrated.rating).toBeNull();
      expect(unrated.contribution).toBeNull();
    });
  });

  describe("zero rated axes", () => {
    test("returns null when no axes have ratings", () => {
      const axes = [makeAxis({ id: "a1", name: "Fun", weight: 10 })];
      const game = makeGame({ ratings: {} });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).toBeNull();
    });
  });

  describe("all-zero weights on rated axes", () => {
    test("returns null to avoid division by zero", () => {
      const axes = [
        makeAxis({ id: "a1", name: "Fun", weight: 0 }),
        makeAxis({ id: "a2", name: "Theme", weight: 0 }),
      ];
      const game = makeGame({ ratings: { a1: 5, a2: 8 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).toBeNull();
    });
  });

  describe("BGG-derived axis with no BGG data", () => {
    test("excludes axis when bggData is null", () => {
      const axes = [
        makeAxis({ id: "a1", name: "Fun", weight: 10 }),
        makeAxis({
          id: "bgg1",
          name: "Community Rating",
          weight: 10,
          source: "bgg",
          bggField: "communityRating",
        }),
      ];
      const game = makeGame({ ratings: { a1: 8 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(8);
      expect(result!.ratedAxisCount).toBe(1);
    });

    test("excludes complexity axis when BGG weight is null", () => {
      const axes = [
        makeAxis({ id: "a1", name: "Fun", weight: 10 }),
        makeAxis({ id: "bgg1", name: "Complexity", weight: 10, source: "bgg", bggField: "weight" }),
      ];
      const game = makeGame({ ratings: { a1: 8 } });
      const bggData = makeBggData({ weight: null });

      const result = fitnessService.calculateScore(game, axes, bggData);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(8);
      expect(result!.ratedAxisCount).toBe(1);
    });
  });

  describe("override of BGG-derived axis", () => {
    test("uses personal rating with override source and preserves bggOriginal", () => {
      const axes = [
        makeAxis({
          id: "bgg1",
          name: "Community Rating",
          weight: 10,
          source: "bgg",
          bggField: "communityRating",
        }),
      ];
      const game = makeGame({ ratings: { bgg1: 9 } });
      const bggData = makeBggData({ communityRating: 7.5 });

      const result = fitnessService.calculateScore(game, axes, bggData);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(9);

      const entry = result!.breakdown[0];
      expect(entry.source).toBe("override");
      expect(entry.bggOriginal).toBe(7.5);
      expect(entry.rating).toBe(9);
    });
  });

  describe("rounding to one decimal place", () => {
    test("7.84 rounds to 7.8", () => {
      // (8 * 84 + 7 * 16) / 100 = (672 + 112) / 100 = 7.84
      const axes = [
        makeAxis({ id: "a1", name: "A", weight: 84 }),
        makeAxis({ id: "a2", name: "B", weight: 16 }),
      ];
      const game = makeGame({ ratings: { a1: 8, a2: 7 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(7.8);
    });

    test("7.85 rounds to 7.9", () => {
      // (8 * 85 + 7 * 15) / 100 = (680 + 105) / 100 = 7.85
      const axes = [
        makeAxis({ id: "a1", name: "A", weight: 85 }),
        makeAxis({ id: "a2", name: "B", weight: 15 }),
      ];
      const game = makeGame({ ratings: { a1: 8, a2: 7 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(7.9);
    });

    test("7.94 rounds to 7.9", () => {
      // (8 * 94 + 7 * 6) / 100 = (752 + 42) / 100 = 7.94
      const axes = [
        makeAxis({ id: "a1", name: "A", weight: 94 }),
        makeAxis({ id: "a2", name: "B", weight: 6 }),
      ];
      const game = makeGame({ ratings: { a1: 8, a2: 7 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(7.9);
    });

    test("7.95 rounds to 8.0", () => {
      // (8 * 95 + 7 * 5) / 100 = (760 + 35) / 100 = 7.95
      const axes = [
        makeAxis({ id: "a1", name: "A", weight: 95 }),
        makeAxis({ id: "a2", name: "B", weight: 5 }),
      ];
      const game = makeGame({ ratings: { a1: 8, a2: 7 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(8);
    });
  });

  describe("breakdown consistency", () => {
    test("contribution uses raw rating for accuracy, displays rounded", () => {
      // communityRating 7.666 rounds to displayed rating 7.7
      // contribution = roundToOneDecimal(7.666 * 30) = roundToOneDecimal(229.98) = 230
      // Score uses raw 7.666, not rounded 7.7, to avoid compounding rounding error
      const axes = [
        makeAxis({ id: "a1", name: "A", weight: 30, source: "bgg", bggField: "communityRating" }),
      ];
      const game = makeGame({ ratings: {} });
      const bggData = makeBggData({ communityRating: 7.666 });

      const result = fitnessService.calculateScore(game, axes, bggData);

      expect(result).not.toBeNull();
      const entry = result!.breakdown[0];

      // Displayed rating is rounded
      expect(entry.rating).toBe(7.7);
      // Contribution is rounded from raw: roundToOneDecimal(7.666 * 30 / 30) = 7.7
      expect(entry.contribution).toBe(7.7);
      // Score uses raw value: 7.666 * 30 / 30 = 7.666, rounded to 7.7
      expect(result!.score).toBe(7.7);
    });

    test("score is derivable from breakdown contributions", () => {
      // Use BGG ratings with multi-decimal precision across multiple axes
      const axes = [
        makeAxis({ id: "a1", name: "A", weight: 40 }),
        makeAxis({ id: "a2", name: "B", weight: 30, source: "bgg", bggField: "communityRating" }),
        makeAxis({ id: "a3", name: "C", weight: 30, source: "bgg", bggField: "weight" }),
      ];
      const game = makeGame({ ratings: { a1: 7 } });
      const bggData = makeBggData({ communityRating: 8.347, weight: 3.14 });

      const result = fitnessService.calculateScore(game, axes, bggData);

      expect(result).not.toBeNull();
      const totalContribution = result!.breakdown
        .filter((b) => b.contribution !== null)
        .reduce((sum, b) => sum + b.contribution!, 0);
      const totalWeight = result!.breakdown
        .filter((b) => b.rating !== null)
        .reduce((sum, b) => sum + b.weight, 0);
      expect(result!.score).toBeCloseTo(totalContribution);
      expect(totalWeight).toBeCloseTo(100);
    });
  });

  describe("source field accuracy", () => {
    test("unrated BGG axis shows source as bgg, not personal", () => {
      const axes = [
        makeAxis({ id: "a1", name: "Fun", weight: 10 }),
        makeAxis({
          id: "bgg1",
          name: "Community Rating",
          weight: 10,
          source: "bgg",
          bggField: "communityRating",
        }),
      ];
      const game = makeGame({ ratings: { a1: 8 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      const bggEntry = result!.breakdown.find((b) => b.axisId === "bgg1")!;
      expect(bggEntry.rating).toBeNull();
      expect(bggEntry.source).toBe("bgg");
    });
  });

  describe("tournament axis", () => {
    function makeTournament(
      gameStats: Record<string, { eloRating: number; comparisonCount: number }>,
      overrides?: Partial<TournamentData["settings"]>,
    ): TournamentData {
      return {
        settings: {
          kFactorThreshold: 15,
          normalizationHalfWidth: 400,
          provisionalThreshold: 6,
          ...overrides,
        },
        sessions: [],
        gameStats: Object.fromEntries(
          Object.entries(gameStats).map(([id, s]) => [
            id,
            { ...s, wins: 0, losses: 0, recentComparisons: [] },
          ]),
        ),
      };
    }

    function tournamentAxis(weight = 50): Axis {
      return makeAxis({
        id: "tournament",
        name: "Tournament",
        weight,
        source: "tournament",
        bggField: null,
      });
    }

    test("contributes normalized score when cohort has 5+ ranked games", () => {
      // Build a cohort of 5 games each with one comparison so shouldDisplayRanking returns true.
      // The target game gets a high ELO so its normalized score is also high.
      const tournament = makeTournament({
        "game-1": { eloRating: 1900, comparisonCount: 8 }, // > provisional threshold
        "game-2": { eloRating: 1500, comparisonCount: 6 },
        "game-3": { eloRating: 1500, comparisonCount: 6 },
        "game-4": { eloRating: 1500, comparisonCount: 6 },
        "game-5": { eloRating: 1500, comparisonCount: 6 },
      });
      const axes = [tournamentAxis(50)];
      const game = makeGame({ id: "game-1" });

      const result = fitnessService.calculateScore(game, axes, null, tournament);

      expect(result).not.toBeNull();
      // ELO 1900 with halfWidth 400 -> 1 + 9*(1900 - 1100)/800 = 1 + 9 = 10
      expect(result!.score).toBe(10);
      const entry = result!.breakdown.find((b) => b.axisId === "tournament")!;
      expect(entry.source).toBe("tournament");
      expect(entry.rating).toBe(10);
      expect(entry.contribution).toBeCloseTo(10);
      expect(result!.ratedAxisCount).toBe(1);
    });

    test("provisional games still contribute their normalized score", () => {
      // game-1 has only 2 comparisons (< default provisionalThreshold of 6) but cohort
      // is large enough to display. Per REQ-TOURN-10, provisional games still rank.
      const tournament = makeTournament({
        "game-1": { eloRating: 1700, comparisonCount: 2 },
        "game-2": { eloRating: 1500, comparisonCount: 1 },
        "game-3": { eloRating: 1500, comparisonCount: 1 },
        "game-4": { eloRating: 1500, comparisonCount: 1 },
        "game-5": { eloRating: 1500, comparisonCount: 1 },
      });
      const axes = [tournamentAxis(50)];
      const game = makeGame({ id: "game-1" });

      const result = fitnessService.calculateScore(game, axes, null, tournament);

      expect(result).not.toBeNull();
      // ELO 1700 -> 1 + 9*(1700 - 1100)/800 = 1 + 6.75 = 7.75 -> 7.8
      expect(result!.score).toBe(7.8);
      const entry = result!.breakdown.find((b) => b.axisId === "tournament")!;
      expect(entry.source).toBe("tournament");
      expect(entry.rating).toBe(7.8);
    });

    test("excludes axis when cohort has < 5 ranked games", () => {
      // Only 4 games with comparisons -> shouldDisplayRanking is false -> normalizedScore null.
      const tournament = makeTournament({
        "game-1": { eloRating: 1900, comparisonCount: 8 },
        "game-2": { eloRating: 1500, comparisonCount: 1 },
        "game-3": { eloRating: 1500, comparisonCount: 1 },
        "game-4": { eloRating: 1500, comparisonCount: 1 },
      });
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 50 }), tournamentAxis(50)];
      const game = makeGame({ id: "game-1", ratings: { fun: 7 } });

      const result = fitnessService.calculateScore(game, axes, null, tournament);

      expect(result).not.toBeNull();
      // Tournament axis excluded; only fun=7 contributes
      expect(result!.score).toBe(7);
      expect(result!.ratedAxisCount).toBe(1);
      const entry = result!.breakdown.find((b) => b.axisId === "tournament")!;
      expect(entry.rating).toBeNull();
      expect(entry.contribution).toBeNull();
      expect(entry.source).toBe("tournament");
    });

    test("excludes axis when game has zero comparisons", () => {
      // Cohort is large enough overall but the target game has no comparisons.
      const tournament = makeTournament({
        "other-1": { eloRating: 1500, comparisonCount: 6 },
        "other-2": { eloRating: 1500, comparisonCount: 6 },
        "other-3": { eloRating: 1500, comparisonCount: 6 },
        "other-4": { eloRating: 1500, comparisonCount: 6 },
        "other-5": { eloRating: 1500, comparisonCount: 6 },
      });
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 50 }), tournamentAxis(50)];
      const game = makeGame({ id: "game-1", ratings: { fun: 7 } });

      const result = fitnessService.calculateScore(game, axes, null, tournament);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(7);
      expect(result!.ratedAxisCount).toBe(1);
      const entry = result!.breakdown.find((b) => b.axisId === "tournament")!;
      expect(entry.rating).toBeNull();
    });

    test("excludes axis when tournamentData is null", () => {
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 50 }), tournamentAxis(50)];
      const game = makeGame({ id: "game-1", ratings: { fun: 7 } });

      const result = fitnessService.calculateScore(game, axes, null, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(7);
      const entry = result!.breakdown.find((b) => b.axisId === "tournament")!;
      expect(entry.rating).toBeNull();
    });

    test("excludes axis when tournamentData argument is omitted", () => {
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 50 }), tournamentAxis(50)];
      const game = makeGame({ id: "game-1", ratings: { fun: 7 } });

      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(7);
      const entry = result!.breakdown.find((b) => b.axisId === "tournament")!;
      expect(entry.rating).toBeNull();
    });

    test("composes with other axes via weighted average", () => {
      const tournament = makeTournament({
        "game-1": { eloRating: 1900, comparisonCount: 8 }, // normalized -> 10
        "game-2": { eloRating: 1500, comparisonCount: 6 },
        "game-3": { eloRating: 1500, comparisonCount: 6 },
        "game-4": { eloRating: 1500, comparisonCount: 6 },
        "game-5": { eloRating: 1500, comparisonCount: 6 },
      });
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 60 }), tournamentAxis(40)];
      const game = makeGame({ id: "game-1", ratings: { fun: 5 } });

      const result = fitnessService.calculateScore(game, axes, null, tournament);

      expect(result).not.toBeNull();
      // (5*60 + 10*40) / 100 = 7.0
      expect(result!.score).toBe(7);
      expect(result!.ratedAxisCount).toBe(2);
    });
  });
});
