import { describe, expect, test } from "bun:test";
import {
  calculateExpectedScore,
  calculateNewRatings,
  normalizeElo,
  shouldDisplayRanking,
} from "../src/services/elo-engine";

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

describe("calculateNewRatings edge cases", () => {
  test("winner as gameB works correctly", () => {
    const { newRatingA, newRatingB } = calculateNewRatings(1500, 1500, "b", 0, 0, 15);
    expect(newRatingB).toBeCloseTo(1516, 2);
    expect(newRatingA).toBeCloseTo(1484, 2);
  });

  test("winner as gameA works correctly", () => {
    const { newRatingA, newRatingB } = calculateNewRatings(1500, 1500, "a", 0, 0, 15);
    expect(newRatingA).toBeCloseTo(1516, 2);
    expect(newRatingB).toBeCloseTo(1484, 2);
  });
});
