import { describe, expect, test } from "bun:test";
import { createFitnessService } from "../src/services/fitness-service";
import type { Game, Axis, BggGameData } from "@shelf-judge/shared";

const fitnessService = createFitnessService();

// Helpers to reduce boilerplate
function makeAxis(overrides: Partial<Axis> & { id: string; name: string }): Axis {
  return {
    weight: 50,
    description: null,
    source: "personal",
    bggField: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeGame(ratings: Record<string, number>, overrides?: Partial<Game>): Game {
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
    ratings,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeBggData(overrides?: Partial<BggGameData>): BggGameData {
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
    fetchedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("fitness-service", () => {
  describe("personal axes with no curve config (backward compatibility)", () => {
    test("personal axis with higher-is-better default produces identity scoring", () => {
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 50 })];
      const game = makeGame({ fun: 8 });
      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(8);
      expect(result!.vetoed).toBe(false);
      expect(result!.vetoedBy).toBeNull();
      expect(result!.hypotheticalScore).toBeNull();

      const entry = result!.breakdown[0];
      expect(entry.rawValue).toBe(8);
      expect(entry.effectiveRating).toBe(8);
      expect(entry.rating).toBe(8);
      expect(entry.preferenceShape).toBe("higher-is-better");
      expect(entry.curveAffected).toBe(false);
    });

    test("multiple personal axes produce weighted average identical to old behavior", () => {
      const axes = [
        makeAxis({ id: "fun", name: "Fun", weight: 60 }),
        makeAxis({ id: "art", name: "Art", weight: 40 }),
      ];
      const game = makeGame({ fun: 8, art: 6 });
      const result = fitnessService.calculateScore(game, axes, null);

      // Old behavior: (8*60 + 6*40) / (60+40) = (480+240)/100 = 7.2
      expect(result).not.toBeNull();
      expect(result!.score).toBe(7.2);
    });

    test("unrated axes are excluded from score", () => {
      const axes = [
        makeAxis({ id: "fun", name: "Fun", weight: 50 }),
        makeAxis({ id: "art", name: "Art", weight: 50 }),
      ];
      const game = makeGame({ fun: 8 }); // art not rated
      const result = fitnessService.calculateScore(game, axes, null);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(8);
      expect(result!.ratedAxisCount).toBe(1);
      expect(result!.totalAxisCount).toBe(2);
    });

    test("no rated axes returns null", () => {
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 50 })];
      const game = makeGame({});
      const result = fitnessService.calculateScore(game, axes, null);
      expect(result).toBeNull();
    });
  });

  describe("BGG axes with no curve config", () => {
    test("communityRating scores identically to old behavior", () => {
      const axes = [
        makeAxis({
          id: "cr",
          name: "Community Rating",
          weight: 50,
          source: "bgg",
          bggField: "communityRating",
        }),
      ];
      const game = makeGame({});
      const bgg = makeBggData({ communityRating: 7.5 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(7.5);

      const entry = result!.breakdown[0];
      expect(entry.rawValue).toBe(7.5);
      expect(entry.effectiveRating).toBe(7.5);
      expect(entry.source).toBe("bgg");
    });

    test("BGG weight stores raw native-scale value (not *2)", () => {
      const axes = [
        makeAxis({
          id: "wt",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
        }),
      ];
      const game = makeGame({});
      const bgg = makeBggData({ weight: 2.9 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result).not.toBeNull();
      const entry = result!.breakdown[0];
      // rawValue is native-scale (1-5), not the old *2 value
      expect(entry.rawValue).toBe(2.9);
      // effectiveRating is the curve-mapped 1-10 value
      // higher-is-better linear: 1 + 9 * (2.9 - 1) / (5 - 1) = 1 + 9 * 1.9/4 = 1 + 4.275 = 5.275
      expect(entry.effectiveRating).toBe(5.3); // rounded to 1 decimal
      expect(entry.source).toBe("bgg");
    });

    test("null BGG weight produces no rating", () => {
      const axes = [
        makeAxis({
          id: "wt",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
        }),
      ];
      const game = makeGame({});
      const bgg = makeBggData({ weight: null });
      const result = fitnessService.calculateScore(game, axes, bgg);
      expect(result).toBeNull();
    });
  });

  describe("bggOriginal semantics", () => {
    test("override source stores raw BGG value in native scale", () => {
      const axes = [
        makeAxis({
          id: "wt",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
        }),
      ];
      // User overrides the BGG weight axis with a personal 1-10 rating
      const game = makeGame({ wt: 7 });
      const bgg = makeBggData({ weight: 2.9 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result).not.toBeNull();
      const entry = result!.breakdown[0];
      expect(entry.source).toBe("override");
      // bggOriginal is now 2.9 (native scale), not 5.8 (old *2)
      expect(entry.bggOriginal).toBe(2.9);
      // User's personal rating is used as rawValue (personal scale is 1-10)
      expect(entry.rawValue).toBe(7);
      expect(entry.effectiveRating).toBe(7);
    });

    test("override on communityRating stores raw BGG value", () => {
      const axes = [
        makeAxis({
          id: "cr",
          name: "Community Rating",
          weight: 50,
          source: "bgg",
          bggField: "communityRating",
        }),
      ];
      const game = makeGame({ cr: 9 });
      const bgg = makeBggData({ communityRating: 7.5 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      const entry = result!.breakdown[0];
      expect(entry.source).toBe("override");
      expect(entry.bggOriginal).toBe(7.5);
      expect(entry.rawValue).toBe(9);
    });
  });

  describe("preference shapes", () => {
    test("higher-is-better: personal axis is identity", () => {
      const axes = [
        makeAxis({
          id: "fun",
          name: "Fun",
          weight: 50,
          preferenceShape: "higher-is-better",
        }),
      ];
      for (let r = 1; r <= 10; r++) {
        const game = makeGame({ fun: r });
        const result = fitnessService.calculateScore(game, axes, null);
        expect(result!.score).toBe(r);
      }
    });

    test("lower-is-better: inverts the scale", () => {
      const axes = [
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          preferenceShape: "lower-is-better",
        }),
      ];
      const game = makeGame({});

      // weight=1 (min) -> effective = 10 (best)
      let result = fitnessService.calculateScore(game, axes, makeBggData({ weight: 1 }));
      expect(result!.breakdown[0].effectiveRating).toBe(10);

      // weight=5 (max) -> effective = 1 (worst)
      result = fitnessService.calculateScore(game, axes, makeBggData({ weight: 5 }));
      expect(result!.breakdown[0].effectiveRating).toBe(1);

      // weight=3 (midpoint) -> effective = 10 - 9*(3-1)/(5-1) = 10 - 4.5 = 5.5
      result = fitnessService.calculateScore(game, axes, makeBggData({ weight: 3 }));
      expect(result!.breakdown[0].effectiveRating).toBe(5.5);
    });

    test("sweet-spot: ideal value produces effective 10", () => {
      const axes = [
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          preferenceShape: "sweet-spot",
          idealValue: 3,
          tolerance: "moderate",
        }),
      ];
      const game = makeGame({});
      const bgg = makeBggData({ weight: 3 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result!.breakdown[0].rawValue).toBe(3);
      expect(result!.breakdown[0].effectiveRating).toBe(10);
    });

    test("sweet-spot: endpoints produce effective 1", () => {
      const axes = [
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          preferenceShape: "sweet-spot",
          idealValue: 3,
          tolerance: "moderate",
        }),
      ];
      const game = makeGame({});

      let result = fitnessService.calculateScore(game, axes, makeBggData({ weight: 1 }));
      expect(result!.breakdown[0].effectiveRating).toBe(1);

      result = fitnessService.calculateScore(game, axes, makeBggData({ weight: 5 }));
      expect(result!.breakdown[0].effectiveRating).toBe(1);
    });

    test("sweet-spot with personal axis", () => {
      const axes = [
        makeAxis({
          id: "pace",
          name: "Pace",
          weight: 50,
          preferenceShape: "sweet-spot",
          idealValue: 5,
          tolerance: "flexible",
        }),
      ];
      const game = makeGame({ pace: 5 });
      const result = fitnessService.calculateScore(game, axes, null);

      expect(result!.breakdown[0].rawValue).toBe(5);
      expect(result!.breakdown[0].effectiveRating).toBe(10);
    });

    test("full scoring with mixed shapes", () => {
      const axes = [
        makeAxis({ id: "fun", name: "Fun", weight: 50, preferenceShape: "higher-is-better" }),
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          preferenceShape: "lower-is-better",
        }),
      ];
      const game = makeGame({ fun: 8 });
      const bgg = makeBggData({ weight: 2 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result).not.toBeNull();
      // fun: effectiveRating = 8
      // complexity: lower-is-better on 1-5 scale, weight=2
      // effective = 10 - 9*(2-1)/(5-1) = 10 - 2.25 = 7.75
      // score = (8*50 + 7.75*50) / 100 = 7.875 -> 7.9
      expect(result!.score).toBe(7.9);
    });
  });

  describe("veto handling", () => {
    test("veto below threshold sets score to 0", () => {
      const axes = [
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          veto: { direction: "above", threshold: 4 },
        }),
      ];
      const game = makeGame({});
      const bgg = makeBggData({ weight: 4.5 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(0);
      expect(result!.vetoed).toBe(true);
      expect(result!.vetoedBy).not.toBeNull();
      expect(result!.vetoedBy!.axisId).toBe("cmplx");
      expect(result!.vetoedBy!.axisName).toBe("Complexity");
      expect(result!.vetoedBy!.threshold).toBe(4);
      expect(result!.vetoedBy!.direction).toBe("above");
      expect(result!.vetoedBy!.rawValue).toBe(4.5);
    });

    test("veto produces correct hypothetical score", () => {
      const axes = [
        makeAxis({
          id: "fun",
          name: "Fun",
          weight: 50,
        }),
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          veto: { direction: "above", threshold: 3 },
        }),
      ];
      const game = makeGame({ fun: 8 });
      const bgg = makeBggData({ weight: 4 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result!.score).toBe(0);
      expect(result!.vetoed).toBe(true);
      // Hypothetical: both axes still scored
      // fun: 8*50 = 400
      // weight=4, higher-is-better: 1 + 9*(4-1)/(5-1) = 1 + 6.75 = 7.75
      // 7.75*50 = 387.5
      // (400 + 387.5) / 100 = 7.875 -> 7.9
      expect(result!.hypotheticalScore).toBe(7.9);
    });

    test("veto still produces complete breakdown", () => {
      const axes = [
        makeAxis({
          id: "fun",
          name: "Fun",
          weight: 50,
        }),
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          veto: { direction: "above", threshold: 3 },
        }),
      ];
      const game = makeGame({ fun: 8 });
      const bgg = makeBggData({ weight: 4 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result!.breakdown.length).toBe(2);
      // Both axes should have ratings computed
      for (const entry of result!.breakdown) {
        expect(entry.rating).not.toBeNull();
        expect(entry.effectiveRating).not.toBeNull();
        expect(entry.rawValue).not.toBeNull();
      }
    });

    test("at-threshold does not trigger veto (below direction)", () => {
      const axes = [
        makeAxis({
          id: "fun",
          name: "Fun",
          weight: 50,
          veto: { direction: "below", threshold: 3 },
        }),
      ];
      const game = makeGame({ fun: 3 }); // exactly at threshold
      const result = fitnessService.calculateScore(game, axes, null);

      expect(result!.vetoed).toBe(false);
      expect(result!.score).toBe(3);
    });

    test("at-threshold does not trigger veto (above direction)", () => {
      const axes = [
        makeAxis({
          id: "fun",
          name: "Fun",
          weight: 50,
          veto: { direction: "above", threshold: 8 },
        }),
      ];
      const game = makeGame({ fun: 8 });
      const result = fitnessService.calculateScore(game, axes, null);

      expect(result!.vetoed).toBe(false);
      expect(result!.score).toBe(8);
    });

    test("veto triggers below threshold", () => {
      const axes = [
        makeAxis({
          id: "fun",
          name: "Fun",
          weight: 50,
          veto: { direction: "below", threshold: 5 },
        }),
      ];
      const game = makeGame({ fun: 4 });
      const result = fitnessService.calculateScore(game, axes, null);

      expect(result!.vetoed).toBe(true);
      expect(result!.score).toBe(0);
      expect(result!.vetoedBy!.direction).toBe("below");
    });

    test("multiple vetoes: first triggering axis reported", () => {
      const axes = [
        makeAxis({
          id: "fun",
          name: "Fun",
          weight: 50,
          veto: { direction: "below", threshold: 5 },
        }),
        makeAxis({
          id: "art",
          name: "Art",
          weight: 50,
          veto: { direction: "below", threshold: 5 },
        }),
      ];
      const game = makeGame({ fun: 3, art: 2 });
      const result = fitnessService.calculateScore(game, axes, null);

      expect(result!.vetoed).toBe(true);
      expect(result!.score).toBe(0);
      // First axis in order triggers
      expect(result!.vetoedBy!.axisId).toBe("fun");
      expect(result!.vetoedBy!.rawValue).toBe(3);

      // Hypothetical score uses both axes
      // (3*50 + 2*50) / 100 = 2.5
      expect(result!.hypotheticalScore).toBe(2.5);

      // Full breakdown present
      expect(result!.breakdown.length).toBe(2);
    });

    test("personal override of BGG axis skips veto check", () => {
      const axes = [
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          veto: { direction: "above", threshold: 3 },
        }),
      ];
      // BGG weight is 4.5 (would trigger veto), but user overrides with personal rating
      const game = makeGame({ cmplx: 5 });
      const bgg = makeBggData({ weight: 4.5 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result).not.toBeNull();
      expect(result!.vetoed).toBe(false);
      expect(result!.score).toBe(5);

      const entry = result!.breakdown[0];
      expect(entry.source).toBe("override");
      expect(entry.bggOriginal).toBe(4.5);
      expect(entry.rawValue).toBe(5);
    });

    test("veto still triggers on BGG value when no personal override exists", () => {
      const axes = [
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          veto: { direction: "above", threshold: 3 },
        }),
      ];
      // No personal override, BGG weight exceeds threshold
      const game = makeGame({});
      const bgg = makeBggData({ weight: 4.5 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result!.vetoed).toBe(true);
      expect(result!.score).toBe(0);
      expect(result!.vetoedBy!.axisId).toBe("cmplx");
    });

    test("no veto when axis has no veto config", () => {
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 50 })];
      const game = makeGame({ fun: 1 });
      const result = fitnessService.calculateScore(game, axes, null);

      expect(result!.vetoed).toBe(false);
      expect(result!.score).toBe(1);
    });
  });

  describe("curveAffected highlighting", () => {
    test("higher-is-better personal axis is never curve-affected", () => {
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 50 })];
      const game = makeGame({ fun: 5 });
      const result = fitnessService.calculateScore(game, axes, null);
      expect(result!.breakdown[0].curveAffected).toBe(false);
    });

    test("lower-is-better axis is curve-affected when difference exceeds threshold", () => {
      const axes = [
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          preferenceShape: "lower-is-better",
        }),
      ];
      const game = makeGame({});
      // weight=2: higher-is-better = 1 + 9*(2-1)/4 = 3.25
      //           lower-is-better = 10 - 9*(2-1)/4 = 7.75
      //           diff = |7.75 - 3.25| = 4.5 > 0.5
      const result = fitnessService.calculateScore(game, axes, makeBggData({ weight: 2 }));
      expect(result!.breakdown[0].curveAffected).toBe(true);
    });

    test("sweet-spot with ideal matching raw is curve-affected when baseline differs", () => {
      const axes = [
        makeAxis({
          id: "cmplx",
          name: "Complexity",
          weight: 50,
          source: "bgg",
          bggField: "weight",
          preferenceShape: "sweet-spot",
          idealValue: 3,
          tolerance: "moderate",
        }),
      ];
      const game = makeGame({});
      // weight=3 (ideal): effective = 10
      // higher-is-better: 1 + 9*(3-1)/4 = 5.5
      // diff = |10 - 5.5| = 4.5 > 0.5
      const result = fitnessService.calculateScore(game, axes, makeBggData({ weight: 3 }));
      expect(result!.breakdown[0].curveAffected).toBe(true);
    });

    test("threshold boundary: exactly 0.5 difference is NOT curve-affected", () => {
      // For a personal axis (scale 1-10) with lower-is-better:
      // higher-is-better at rawValue x: hib = x (identity on 1-10)
      // lower-is-better at rawValue x: lib = 10 - 9*(x-1)/9 = 11 - x
      // diff = |11 - x - x| = |11 - 2x|
      // For diff = 0.5: |11 - 2x| = 0.5 -> x = 5.25 or x = 5.75
      // At x=5.25: hib=5.25, lib=5.75, diff=0.5 exactly -> NOT affected
      const axes = [
        makeAxis({
          id: "test",
          name: "Test",
          weight: 50,
          preferenceShape: "lower-is-better",
        }),
      ];
      const game = makeGame({ test: 5.25 });
      const result = fitnessService.calculateScore(game, axes, null);

      // diff = |11 - 2*5.25| = |11 - 10.5| = 0.5 -> threshold is >, not >=
      expect(result!.breakdown[0].curveAffected).toBe(false);
    });

    test("threshold boundary: 0.51 difference IS curve-affected", () => {
      // At x=5.255: hib=5.255, lib=5.745, diff=0.49 -> not affected
      // At x=5.0: hib=5, lib=6, diff=1 -> affected
      // Use x=4.745: hib=4.745, lib=6.255, diff=1.51 -> affected
      // Simpler: x=5.245 -> hib=5.245, lib=5.755, diff=0.51
      const axes = [
        makeAxis({
          id: "test",
          name: "Test",
          weight: 50,
          preferenceShape: "lower-is-better",
        }),
      ];
      // At 5.245: hib = 5.245, lib = 10 - 9*(5.245-1)/9 = 10 - 4.245 = 5.755
      // diff = |5.755 - 5.245| = 0.51 > 0.5
      const game = makeGame({ test: 5.245 });
      const result = fitnessService.calculateScore(game, axes, null);
      expect(result!.breakdown[0].curveAffected).toBe(true);
    });
  });

  describe("missing curve config defaults", () => {
    test("axes without preferenceShape default to higher-is-better", () => {
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 50 })];
      const game = makeGame({ fun: 7 });
      const result = fitnessService.calculateScore(game, axes, null);
      expect(result!.breakdown[0].preferenceShape).toBe("higher-is-better");
      expect(result!.breakdown[0].effectiveRating).toBe(7);
    });

    test("BGG axis without curve config uses higher-is-better normalization", () => {
      const axes = [
        makeAxis({
          id: "wt",
          name: "Weight",
          weight: 50,
          source: "bgg",
          bggField: "weight",
        }),
      ];
      const game = makeGame({});
      const bgg = makeBggData({ weight: 3 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      // higher-is-better linear: 1 + 9*(3-1)/(5-1) = 1 + 4.5 = 5.5
      expect(result!.breakdown[0].effectiveRating).toBe(5.5);
      expect(result!.breakdown[0].preferenceShape).toBe("higher-is-better");
    });
  });

  describe("removing a curve (back to higher-is-better)", () => {
    test("explicit higher-is-better produces same scores as default", () => {
      const defaultAxes = [makeAxis({ id: "fun", name: "Fun", weight: 50 })];
      const explicitAxes = [
        makeAxis({
          id: "fun",
          name: "Fun",
          weight: 50,
          preferenceShape: "higher-is-better",
        }),
      ];
      const game = makeGame({ fun: 7 });

      const defaultResult = fitnessService.calculateScore(game, defaultAxes, null);
      const explicitResult = fitnessService.calculateScore(game, explicitAxes, null);

      expect(defaultResult!.score).toBe(explicitResult!.score);
      expect(defaultResult!.breakdown[0].effectiveRating).toBe(
        explicitResult!.breakdown[0].effectiveRating,
      );
    });
  });

  describe("backward compatibility: old vs new scoring comparison", () => {
    // Constructs the same collection under old and new logic, verifies expected differences
    const personalFun = makeAxis({ id: "fun", name: "Fun", weight: 30 });
    const personalArt = makeAxis({ id: "art", name: "Art", weight: 20 });
    const bggCommunity = makeAxis({
      id: "cr",
      name: "Community Rating",
      weight: 25,
      source: "bgg",
      bggField: "communityRating",
    });
    const bggWeight = makeAxis({
      id: "wt",
      name: "Complexity",
      weight: 25,
      source: "bgg",
      bggField: "weight",
    });
    const axes = [personalFun, personalArt, bggCommunity, bggWeight];

    // Old scoring logic (inline for comparison)
    function oldResolveBggRating(axis: Axis, bggData: BggGameData | null): number | null {
      if (axis.source !== "bgg" || !axis.bggField || !bggData) return null;
      switch (axis.bggField) {
        case "communityRating":
          return bggData.communityRating;
        case "weight":
          if (bggData.weight === null) return null;
          return bggData.weight * 2;
        default:
          return null;
      }
    }

    function oldScore(game: Game, testAxes: Axis[], bggData: BggGameData | null): number | null {
      let weightedSum = 0;
      let weightSum = 0;
      let ratedCount = 0;
      for (const axis of testAxes) {
        const personalRating = game.ratings[axis.id];
        const bggRating = oldResolveBggRating(axis, bggData);
        let rating: number | null = null;
        if (personalRating !== undefined) {
          rating = personalRating;
        } else if (bggRating !== null) {
          rating = bggRating;
        }
        if (rating !== null) {
          weightedSum += rating * axis.weight;
          weightSum += axis.weight;
          ratedCount++;
        }
      }
      if (ratedCount === 0 || weightSum === 0) return null;
      return Math.round((weightedSum / weightSum) * 10) / 10;
    }

    test("personal axis scores are identical", () => {
      const personalOnly = [personalFun, personalArt];
      const game = makeGame({ fun: 8, art: 6 });

      const newResult = fitnessService.calculateScore(game, personalOnly, null);
      const oldResult = oldScore(game, personalOnly, null);

      expect(newResult!.score).toBe(oldResult!);
    });

    test("communityRating scores are identical", () => {
      const crOnly = [bggCommunity];
      const game = makeGame({});
      const bgg = makeBggData({ communityRating: 7.5 });

      const newResult = fitnessService.calculateScore(game, crOnly, bgg);
      const oldResult = oldScore(game, crOnly, bgg);

      expect(newResult!.score).toBe(oldResult!);
    });

    test("BGG weight scores differ as documented", () => {
      const wtOnly = [bggWeight];
      const game = makeGame({});

      // At weight 1.0: old=2.0, new=1 + 9*(1-1)/(5-1) = 1.0
      let bgg = makeBggData({ weight: 1.0 });
      let newResult = fitnessService.calculateScore(game, wtOnly, bgg);
      let oldResult = oldScore(game, wtOnly, bgg);
      expect(oldResult).toBe(2.0);
      expect(newResult!.score).toBe(1.0);

      // At weight 3.0: old=6.0, new=1 + 9*(3-1)/(5-1) = 5.5
      bgg = makeBggData({ weight: 3.0 });
      newResult = fitnessService.calculateScore(game, wtOnly, bgg);
      oldResult = oldScore(game, wtOnly, bgg);
      expect(oldResult).toBe(6.0);
      expect(newResult!.score).toBe(5.5);

      // At weight 5.0: old=10.0, new=1 + 9*(5-1)/(5-1) = 10.0
      bgg = makeBggData({ weight: 5.0 });
      newResult = fitnessService.calculateScore(game, wtOnly, bgg);
      oldResult = oldScore(game, wtOnly, bgg);
      expect(oldResult).toBe(10.0);
      expect(newResult!.score).toBe(10.0);
    });

    test("full collection: personal + communityRating portions identical, weight shifts", () => {
      const game = makeGame({ fun: 8, art: 6 });
      const bgg = makeBggData({ communityRating: 7.5, weight: 2.9 });

      const newResult = fitnessService.calculateScore(game, axes, bgg);
      const oldResult = oldScore(game, axes, bgg);

      // Old: (8*30 + 6*20 + 7.5*25 + 5.8*25) / 100 = (240+120+187.5+145)/100 = 6.925 -> 6.9
      expect(oldResult).toBe(6.9);

      // New: weight 2.9 -> effective = 1 + 9*(2.9-1)/4 = 5.275
      // (8*30 + 6*20 + 7.5*25 + 5.275*25) / 100 = (240+120+187.5+131.875)/100 = 6.79375 -> 6.8
      expect(newResult!.score).toBe(6.8);

      // The difference is solely from the weight axis normalization change
    });
  });

  describe("breakdown sorting", () => {
    test("override entries sort first, then bgg, then personal", () => {
      const axes = [
        makeAxis({ id: "fun", name: "Fun", weight: 25 }),
        makeAxis({
          id: "cr",
          name: "Community Rating",
          weight: 25,
          source: "bgg",
          bggField: "communityRating",
        }),
        makeAxis({
          id: "wt",
          name: "Complexity",
          weight: 25,
          source: "bgg",
          bggField: "weight",
        }),
      ];
      // Override weight axis with personal rating
      const game = makeGame({ fun: 7, wt: 8 });
      const bgg = makeBggData({ communityRating: 7.5, weight: 3 });
      const result = fitnessService.calculateScore(game, axes, bgg);

      expect(result!.breakdown[0].source).toBe("override");
      expect(result!.breakdown[1].source).toBe("bgg");
      expect(result!.breakdown[2].source).toBe("personal");
    });
  });

  describe("edge cases", () => {
    test("all axes zero weight returns null", () => {
      const axes = [makeAxis({ id: "fun", name: "Fun", weight: 0 })];
      const game = makeGame({ fun: 5 });
      const result = fitnessService.calculateScore(game, axes, null);
      // weight 0 means weightSum stays 0
      expect(result).toBeNull();
    });

    test("empty axes array returns null", () => {
      const game = makeGame({ fun: 5 });
      const result = fitnessService.calculateScore(game, [], null);
      expect(result).toBeNull();
    });
  });
});
