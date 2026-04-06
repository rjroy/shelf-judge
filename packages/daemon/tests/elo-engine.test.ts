import { describe, expect, test } from "bun:test";
import {
  calculateExpectedScore,
  calculateNewRatings,
  recalculateAllRatings,
  normalizeElo,
  shouldDisplayRanking,
} from "../src/services/elo-engine";
import type { Comparison } from "@shelf-judge/shared";

// Helper to build a comparison with minimal boilerplate
function makeComparison(
  gameAId: string,
  gameBId: string,
  winnerId: string,
  sessionId: string,
  createdAt: string,
): Comparison {
  return {
    id: `comp-${createdAt}`,
    gameAId,
    gameBId,
    winnerId,
    sessionId,
    createdAt,
  };
}

describe("calculateExpectedScore", () => {
  test("equal ratings produce 0.5 expected score", () => {
    expect(calculateExpectedScore(1500, 1500)).toBeCloseTo(0.5, 10);
  });

  test("400 point advantage produces ~0.909 expected score", () => {
    // 1 / (1 + 10^(-400/400)) = 1 / (1 + 0.1) = 1/1.1 ≈ 0.9091
    expect(calculateExpectedScore(1900, 1500)).toBeCloseTo(1 / 1.1, 4);
  });

  test("400 point disadvantage produces ~0.091 expected score", () => {
    expect(calculateExpectedScore(1100, 1500)).toBeCloseTo(0.1 / 1.1, 4);
  });

  test("expected scores for a pair sum to 1.0", () => {
    const eA = calculateExpectedScore(1600, 1400);
    const eB = calculateExpectedScore(1400, 1600);
    expect(eA + eB).toBeCloseTo(1.0, 10);
  });
});

describe("calculateNewRatings", () => {
  test("equal ratings, A wins, both provisional (K=32)", () => {
    const { newRatingA, newRatingB } = calculateNewRatings(1500, 1500, "a", 0, 0, 15);
    // Expected: 0.5. Actual: 1 (A wins). Delta = K * (1 - 0.5) = 32 * 0.5 = 16
    expect(newRatingA).toBeCloseTo(1516, 4);
    expect(newRatingB).toBeCloseTo(1484, 4);
  });

  test("equal ratings, B wins, both provisional (K=32)", () => {
    const { newRatingA, newRatingB } = calculateNewRatings(1500, 1500, "b", 0, 0, 15);
    expect(newRatingA).toBeCloseTo(1484, 4);
    expect(newRatingB).toBeCloseTo(1516, 4);
  });

  // REQ-TOURN-6: K-factor transitions at threshold (15, not 30).
  // The spec's success criteria section says "< 30 comparisons" but REQ-TOURN-6 says
  // threshold defaults to 15. REQ-TOURN-6 is normative. Using 15.
  test("K-factor is 32 below threshold, 16 at/above threshold", () => {
    // A has 14 comparisons (below 15 threshold) -> K=32
    // B has 15 comparisons (at threshold) -> K=16
    const { newRatingA, newRatingB } = calculateNewRatings(1500, 1500, "a", 14, 15, 15);
    // A wins: expectedA = 0.5
    // A: 1500 + 32 * (1 - 0.5) = 1516
    // B: 1500 + 16 * (0 - 0.5) = 1492
    expect(newRatingA).toBeCloseTo(1516, 4);
    expect(newRatingB).toBeCloseTo(1492, 4);
  });

  test("K-factor is 16 for both when both at/above threshold", () => {
    const { newRatingA, newRatingB } = calculateNewRatings(1500, 1500, "a", 20, 20, 15);
    // A: 1500 + 16 * (1 - 0.5) = 1508
    // B: 1500 + 16 * (0 - 0.5) = 1492
    expect(newRatingA).toBeCloseTo(1508, 4);
    expect(newRatingB).toBeCloseTo(1492, 4);
  });

  test("upset win produces larger rating change for underdog", () => {
    // A (1300) beats B (1700). A is a big underdog.
    const { newRatingA, newRatingB } = calculateNewRatings(1300, 1700, "a", 0, 0, 15);
    // A's expected: ~0.0909. Actual: 1. K=32. Delta = 32 * (1 - 0.0909) ≈ 29.09
    // B's expected: ~0.9091. Actual: 0. K=32. Delta = 32 * (0 - 0.9091) ≈ -29.09
    expect(newRatingA).toBeGreaterThan(1325);
    expect(newRatingB).toBeLessThan(1675);
    // Total rating change should be symmetric when K is the same
    const deltaA = newRatingA - 1300;
    const deltaB = 1700 - newRatingB;
    expect(deltaA).toBeCloseTo(deltaB, 4);
  });
});

describe("recalculateAllRatings - 5-game 10-comparison worked example", () => {
  // Games: A, B, C, D, E. All start at 1500. kThreshold = 15 (all provisional, K=32).
  //
  // This is the hand-calculated worked example required by the spec's AI validation criteria.
  // Each step documents the expected ELO after the comparison.

  const SESSION = "session-1";

  const comparisons: Comparison[] = [
    // Step 1: A vs B, A wins. Both at 1500, count=0.
    // Expected(A) = 0.5. A: 1500 + 32*(1-0.5) = 1516. B: 1500 + 32*(0-0.5) = 1484.
    makeComparison("A", "B", "A", SESSION, "2026-01-01T00:01:00Z"),

    // Step 2: C vs D, C wins. Both at 1500, count=0.
    // C: 1516. D: 1484.
    makeComparison("C", "D", "C", SESSION, "2026-01-01T00:02:00Z"),

    // Step 3: A vs C, C wins. A=1516 (count=1), C=1516 (count=1).
    // Expected(A) = 0.5. A: 1516 + 32*(0-0.5) = 1500. C: 1516 + 32*(1-0.5) = 1532.
    makeComparison("A", "C", "C", SESSION, "2026-01-01T00:03:00Z"),

    // Step 4: B vs D, B wins. B=1484 (count=1), D=1484 (count=1).
    // Expected(B) = 0.5. B: 1484 + 32*(1-0.5) = 1500. D: 1484 + 32*(0-0.5) = 1468.
    makeComparison("B", "D", "B", SESSION, "2026-01-01T00:04:00Z"),

    // Step 5: E vs A, E wins. E=1500 (count=0), A=1500 (count=2).
    // Expected(E) = 0.5. E: 1516. A: 1484.
    makeComparison("E", "A", "E", SESSION, "2026-01-01T00:05:00Z"),

    // Step 6: E vs C, C wins. E=1516 (count=1), C=1532 (count=2).
    // Expected(E) = 1/(1+10^((1532-1516)/400)) = 1/(1+10^(16/400)) = 1/(1+10^0.04)
    // 10^0.04 ≈ 1.0965. Expected(E) ≈ 1/2.0965 ≈ 0.4770.
    // E: 1516 + 32*(0-0.4770) ≈ 1516 - 15.26 ≈ 1500.74
    // C: 1532 + 32*(1-0.5230) ≈ 1532 + 15.26 ≈ 1547.26
    makeComparison("E", "C", "C", SESSION, "2026-01-01T00:06:00Z"),

    // Step 7: A vs D, A wins. A=1484 (count=3), D=1468 (count=2).
    // Expected(A) = 1/(1+10^((1468-1484)/400)) = 1/(1+10^(-16/400)) = 1/(1+10^(-0.04))
    // 10^(-0.04) ≈ 0.9120. Expected(A) ≈ 1/1.9120 ≈ 0.5230.
    // A: 1484 + 32*(1-0.5230) ≈ 1484 + 15.26 ≈ 1499.26
    // D: 1468 + 32*(0-0.4770) ≈ 1468 - 15.26 ≈ 1452.74
    makeComparison("A", "D", "A", SESSION, "2026-01-01T00:07:00Z"),

    // Step 8: B vs E, B wins. B=1500 (count=2), E≈1500.74 (count=2).
    // Expected(B) = 1/(1+10^((1500.74-1500)/400)) ≈ 0.4997
    // B: 1500 + 32*(1-0.4997) ≈ 1500 + 16.01 ≈ 1516.01
    // E: 1500.74 + 32*(0-0.5003) ≈ 1500.74 - 16.01 ≈ 1484.73
    makeComparison("B", "E", "B", SESSION, "2026-01-01T00:08:00Z"),

    // Step 9: C vs B, C wins. C≈1547.26 (count=3), B≈1516.01 (count=3).
    // Expected(C) = 1/(1+10^((1516.01-1547.26)/400)) = 1/(1+10^(-31.25/400))
    // 10^(-0.0781) ≈ 0.8354. Expected(C) ≈ 1/1.8354 ≈ 0.5449
    // C: 1547.26 + 32*(1-0.5449) ≈ 1547.26 + 14.56 ≈ 1561.82
    // B: 1516.01 + 32*(0-0.4551) ≈ 1516.01 - 14.56 ≈ 1501.45
    makeComparison("C", "B", "C", SESSION, "2026-01-01T00:09:00Z"),

    // Step 10: D vs E, E wins. D≈1452.74 (count=3), E≈1484.73 (count=3).
    // Expected(D) = 1/(1+10^((1484.73-1452.74)/400)) = 1/(1+10^(31.99/400))
    // 10^(0.0800) ≈ 1.2023. Expected(D) ≈ 1/2.2023 ≈ 0.4541
    // D: 1452.74 + 32*(0-0.4541) ≈ 1452.74 - 14.53 ≈ 1438.21
    // E: 1484.73 + 32*(1-0.5459) ≈ 1484.73 + 14.53 ≈ 1499.26
    makeComparison("D", "E", "E", SESSION, "2026-01-01T00:10:00Z"),
  ];

  test("produces correct final ratings after 10 comparisons", () => {
    const stats = recalculateAllRatings(comparisons, 15);

    // Final ranking should be: C > B > A ≈ E > D
    // C won the most (4 wins), D lost the most.
    expect(stats["C"].eloRating).toBeGreaterThan(stats["B"].eloRating);
    expect(stats["B"].eloRating).toBeGreaterThan(stats["A"].eloRating);
    expect(stats["A"].eloRating).toBeGreaterThan(stats["D"].eloRating);

    // All games should have 4 comparisons each (10 comparisons, 5 games, 2 per comparison)
    expect(stats["A"].comparisonCount).toBe(4);
    expect(stats["B"].comparisonCount).toBe(4);
    expect(stats["C"].comparisonCount).toBe(4);
    expect(stats["D"].comparisonCount).toBe(4);
    expect(stats["E"].comparisonCount).toBe(4);

    // C should be highest rated (4 wins: vs D, vs A, vs E, vs B)
    expect(stats["C"].eloRating).toBeGreaterThan(1550);

    // D should be lowest rated (0 wins)
    expect(stats["D"].eloRating).toBeLessThan(1450);
  });

  test("step-by-step ELO matches hand calculations", () => {
    // Verify step by step using incremental recalculation at each step
    for (let i = 1; i <= 10; i++) {
      const partial = recalculateAllRatings(comparisons.slice(0, i), 15);

      if (i === 1) {
        // After step 1: A vs B, A wins
        expect(partial["A"].eloRating).toBeCloseTo(1516, 2);
        expect(partial["B"].eloRating).toBeCloseTo(1484, 2);
      }
      if (i === 2) {
        // After step 2: C vs D, C wins
        expect(partial["C"].eloRating).toBeCloseTo(1516, 2);
        expect(partial["D"].eloRating).toBeCloseTo(1484, 2);
      }
      if (i === 3) {
        // After step 3: A vs C, C wins (both at 1516)
        expect(partial["A"].eloRating).toBeCloseTo(1500, 2);
        expect(partial["C"].eloRating).toBeCloseTo(1532, 2);
      }
      if (i === 4) {
        // After step 4: B vs D, B wins (both at 1484)
        expect(partial["B"].eloRating).toBeCloseTo(1500, 2);
        expect(partial["D"].eloRating).toBeCloseTo(1468, 2);
      }
      if (i === 5) {
        // After step 5: E vs A, E wins (both at 1500)
        expect(partial["E"].eloRating).toBeCloseTo(1516, 2);
        expect(partial["A"].eloRating).toBeCloseTo(1484, 2);
      }
    }
  });

  test("total ELO is conserved when all K-factors are equal", () => {
    // With kThreshold=15 and max 4 comparisons per game, all games stay provisional (K=32).
    // Total ELO should be 5 * 1500 = 7500 throughout.
    const stats = recalculateAllRatings(comparisons, 15);
    const totalElo =
      stats["A"].eloRating +
      stats["B"].eloRating +
      stats["C"].eloRating +
      stats["D"].eloRating +
      stats["E"].eloRating;
    expect(totalElo).toBeCloseTo(7500, 2);
  });
});

describe("recalculateAllRatings - incremental matches full recalculation", () => {
  test("adding comparisons one at a time matches batch recalculation", () => {
    const comparisons: Comparison[] = [
      makeComparison("X", "Y", "X", "s1", "2026-01-01T00:01:00Z"),
      makeComparison("Y", "Z", "Y", "s1", "2026-01-01T00:02:00Z"),
      makeComparison("X", "Z", "Z", "s1", "2026-01-01T00:03:00Z"),
      makeComparison("X", "Y", "Y", "s1", "2026-01-01T00:04:00Z"),
      makeComparison("Z", "Y", "Z", "s1", "2026-01-01T00:05:00Z"),
    ];

    const batchResult = recalculateAllRatings(comparisons, 15);

    // Simulate incremental: recalculate after each comparison added
    let incrementalResult: Record<string, { eloRating: number; comparisonCount: number }> = {};
    for (let i = 1; i <= comparisons.length; i++) {
      incrementalResult = recalculateAllRatings(comparisons.slice(0, i), 15);
    }

    // They should be identical since recalculate always replays from scratch
    expect(incrementalResult["X"].eloRating).toBeCloseTo(batchResult["X"].eloRating, 10);
    expect(incrementalResult["Y"].eloRating).toBeCloseTo(batchResult["Y"].eloRating, 10);
    expect(incrementalResult["Z"].eloRating).toBeCloseTo(batchResult["Z"].eloRating, 10);
  });

  test("chronological ordering is enforced regardless of input order", () => {
    const comparisons: Comparison[] = [
      makeComparison("A", "B", "A", "s1", "2026-01-01T00:02:00Z"), // Second chronologically
      makeComparison("A", "B", "B", "s1", "2026-01-01T00:01:00Z"), // First chronologically
    ];

    const stats = recalculateAllRatings(comparisons, 15);

    // First: B wins (A=1484, B=1516)
    // Second: A wins with A=1484, B=1516.
    // Expected(A) = 1/(1+10^((1516-1484)/400)) = 1/(1+10^(32/400))
    // This is different from if A won first then B won.
    // Verify the order matters by comparing with reversed input
    const reversed: Comparison[] = [
      makeComparison("A", "B", "B", "s1", "2026-01-01T00:01:00Z"),
      makeComparison("A", "B", "A", "s1", "2026-01-01T00:02:00Z"),
    ];
    const statsReversed = recalculateAllRatings(reversed, 15);

    // Both should produce identical results since they're sorted by createdAt
    expect(stats["A"].eloRating).toBeCloseTo(statsReversed["A"].eloRating, 10);
    expect(stats["B"].eloRating).toBeCloseTo(statsReversed["B"].eloRating, 10);
  });
});

describe("recalculateAllRatings - K-factor transition", () => {
  test("K transitions from 32 to 16 at kThreshold", () => {
    // Create a scenario where a game crosses the threshold mid-sequence.
    // Use kThreshold=2 for easy testing.
    // Game A plays 3 times against different opponents. First 2 at K=32, third at K=16.
    const comparisons: Comparison[] = [
      // A's count=0, B's count=0. Both K=32.
      makeComparison("A", "B", "A", "s1", "2026-01-01T00:01:00Z"),
      // A's count=1, C's count=0. Both K=32 (A < 2, C < 2).
      makeComparison("A", "C", "A", "s1", "2026-01-01T00:02:00Z"),
      // A's count=2, D's count=0. A: K=16 (count >= 2), D: K=32 (count < 2).
      makeComparison("A", "D", "A", "s1", "2026-01-01T00:03:00Z"),
    ];

    const stats = recalculateAllRatings(comparisons, 2);

    // After comp 1: A=1516, B=1484
    // After comp 2: A has 1516 vs C at 1500.
    //   Expected(A) = 1/(1+10^((1500-1516)/400)) = 1/(1+10^(-0.04)) ≈ 0.5230
    //   A: 1516 + 32*(1-0.5230) ≈ 1531.26. C: 1500 + 32*(0-0.4770) ≈ 1484.74
    // After comp 3: A has count=2 (K=16), D has count=0 (K=32).
    //   A≈1531.26 vs D=1500. Expected(A) ≈ 1/(1+10^((1500-1531.26)/400)) ≈ 0.5449
    //   A: 1531.26 + 16*(1-0.5449) ≈ 1531.26 + 7.28 ≈ 1538.54
    //   D: 1500 + 32*(0-0.4551) ≈ 1500 - 14.56 ≈ 1485.44

    // Key assertion: A's third win gives less ELO than the first two (K=16 vs K=32)
    // The jump from comp2 to comp3 should be smaller than comp1 to comp2
    const statsAfter2 = recalculateAllRatings(comparisons.slice(0, 2), 2);
    const statsAfter3 = recalculateAllRatings(comparisons, 2);

    const jump2to3 = statsAfter3["A"].eloRating - statsAfter2["A"].eloRating;
    const jump1to2 =
      statsAfter2["A"].eloRating - recalculateAllRatings(comparisons.slice(0, 1), 2)["A"].eloRating;

    expect(jump2to3).toBeLessThan(jump1to2);
    expect(stats["A"].comparisonCount).toBe(3);
  });
});

describe("normalizeElo", () => {
  test("ELO at center (1500) normalizes to 5.5", () => {
    expect(normalizeElo(1500, 400)).toBeCloseTo(5.5, 4);
  });

  test("ELO at lower bound (1100 with halfWidth=400) normalizes to 1.0", () => {
    expect(normalizeElo(1100, 400)).toBeCloseTo(1.0, 4);
  });

  test("ELO at upper bound (1900 with halfWidth=400) normalizes to 10.0", () => {
    expect(normalizeElo(1900, 400)).toBeCloseTo(10.0, 4);
  });

  test("ELO below reference range clamps to 1.0", () => {
    expect(normalizeElo(900, 400)).toBe(1.0);
  });

  test("ELO above reference range clamps to 10.0", () => {
    expect(normalizeElo(2100, 400)).toBe(10.0);
  });

  test("all-equal ELO (1500) normalizes to 5.5", () => {
    // When all games have the same ELO (1500), they should all be 5.5
    const result = normalizeElo(1500, 400);
    expect(result).toBeCloseTo(5.5, 4);
  });

  test("different halfWidth changes the scale", () => {
    // With halfWidth=200, range is 1300-1700
    expect(normalizeElo(1300, 200)).toBeCloseTo(1.0, 4);
    expect(normalizeElo(1700, 200)).toBeCloseTo(10.0, 4);
    expect(normalizeElo(1500, 200)).toBeCloseTo(5.5, 4);
  });

  test("linear interpolation between bounds", () => {
    // 1/4 of the way from bottom (1100) to top (1900) = 1300
    // Should be 1/4 of the way from 1.0 to 10.0 = 1 + 9*0.25 = 3.25
    expect(normalizeElo(1300, 400)).toBeCloseTo(3.25, 4);
  });
});

describe("shouldDisplayRanking", () => {
  test("returns false when fewer than 5 games have comparisons", () => {
    expect(shouldDisplayRanking(0)).toBe(false);
    expect(shouldDisplayRanking(1)).toBe(false);
    expect(shouldDisplayRanking(4)).toBe(false);
  });

  test("returns true when 5 or more games have comparisons", () => {
    expect(shouldDisplayRanking(5)).toBe(true);
    expect(shouldDisplayRanking(10)).toBe(true);
    expect(shouldDisplayRanking(100)).toBe(true);
  });
});

describe("edge cases", () => {
  test("recalculateAllRatings with empty comparisons returns empty stats", () => {
    const stats = recalculateAllRatings([], 15);
    expect(Object.keys(stats).length).toBe(0);
  });

  test("recalculateAllRatings with single comparison", () => {
    const comparisons: Comparison[] = [makeComparison("A", "B", "A", "s1", "2026-01-01T00:01:00Z")];
    const stats = recalculateAllRatings(comparisons, 15);
    expect(stats["A"].eloRating).toBeCloseTo(1516, 2);
    expect(stats["B"].eloRating).toBeCloseTo(1484, 2);
    expect(stats["A"].comparisonCount).toBe(1);
    expect(stats["B"].comparisonCount).toBe(1);
  });

  test("winner as gameB works correctly", () => {
    const comparisons: Comparison[] = [makeComparison("A", "B", "B", "s1", "2026-01-01T00:01:00Z")];
    const stats = recalculateAllRatings(comparisons, 15);
    // B wins, so B should gain and A should lose
    expect(stats["B"].eloRating).toBeCloseTo(1516, 2);
    expect(stats["A"].eloRating).toBeCloseTo(1484, 2);
  });

  test("winner as gameA works correctly", () => {
    const comparisons: Comparison[] = [makeComparison("A", "B", "A", "s1", "2026-01-01T00:01:00Z")];
    const stats = recalculateAllRatings(comparisons, 15);
    expect(stats["A"].eloRating).toBeCloseTo(1516, 2);
    expect(stats["B"].eloRating).toBeCloseTo(1484, 2);
  });
});
