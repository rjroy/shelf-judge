import { describe, expect, test } from "bun:test";
import {
  getNativeScale,
  applyPreferenceCurve,
  calibrateTolerance,
  applyLean,
  checkVeto,
  computeHigherIsBetterEffective,
  K_FLEXIBLE,
  K_MODERATE,
  K_STRICT,
  LEAN_GENTLE_MULTIPLIER,
  LEAN_STEEP_MULTIPLIER,
} from "../src/services/curve-engine";

// --- Native Scales (REQ-CURVE-2, REQ-CURVE-3) ---

describe("getNativeScale", () => {
  test("personal axis returns {1, 10}", () => {
    expect(getNativeScale("personal", null)).toEqual({ min: 1, max: 10 });
  });

  test("BGG communityRating returns {1, 10}", () => {
    expect(getNativeScale("bgg", "communityRating")).toEqual({ min: 1, max: 10 });
  });

  test("BGG weight returns {1, 5}", () => {
    expect(getNativeScale("bgg", "weight")).toEqual({ min: 1, max: 5 });
  });

  test("unknown BGG field throws", () => {
    expect(() => getNativeScale("bgg", "unknownField")).toThrow("Unknown BGG field");
  });

  test("personal axis ignores bggField value", () => {
    expect(getNativeScale("personal", "weight")).toEqual({ min: 1, max: 10 });
  });
});

// --- Tolerance Calibration ---

describe("calibrateTolerance", () => {
  test("returns correct k values", () => {
    expect(calibrateTolerance("flexible")).toBeCloseTo(K_FLEXIBLE, 10);
    expect(calibrateTolerance("moderate")).toBeCloseTo(K_MODERATE, 10);
    expect(calibrateTolerance("strict")).toBeCloseTo(K_STRICT, 10);
  });

  test("k values are ordered: flexible < moderate < strict", () => {
    expect(K_FLEXIBLE).toBeLessThan(K_MODERATE);
    expect(K_MODERATE).toBeLessThan(K_STRICT);
  });
});

// --- Lean ---

describe("applyLean", () => {
  const baseK = 1.0;

  test("null lean returns baseK for both sides", () => {
    expect(applyLean(baseK, null, "left")).toBe(baseK);
    expect(applyLean(baseK, null, "right")).toBe(baseK);
  });

  test("lean lower: left side gentler, right side steeper", () => {
    const kLeft = applyLean(baseK, "lower", "left");
    const kRight = applyLean(baseK, "lower", "right");
    expect(kLeft).toBeCloseTo(LEAN_GENTLE_MULTIPLIER, 10);
    expect(kRight).toBeCloseTo(LEAN_STEEP_MULTIPLIER, 10);
    expect(kLeft).toBeLessThan(kRight);
  });

  test("lean higher: right side gentler, left side steeper", () => {
    const kLeft = applyLean(baseK, "higher", "left");
    const kRight = applyLean(baseK, "higher", "right");
    expect(kLeft).toBeCloseTo(LEAN_STEEP_MULTIPLIER, 10);
    expect(kRight).toBeCloseTo(LEAN_GENTLE_MULTIPLIER, 10);
    expect(kRight).toBeLessThan(kLeft);
  });
});

// --- Fixed Points (REQ-CURVE-11) ---

describe("fixed points", () => {
  const personal = { min: 1, max: 10 };
  const bggWeight = { min: 1, max: 5 };

  test("higher-is-better: min → 1, max → 10", () => {
    expect(applyPreferenceCurve(1, personal, "higher-is-better", {})).toBeCloseTo(1, 10);
    expect(applyPreferenceCurve(10, personal, "higher-is-better", {})).toBeCloseTo(10, 10);
  });

  test("higher-is-better on BGG weight: min → 1, max → 10", () => {
    expect(applyPreferenceCurve(1, bggWeight, "higher-is-better", {})).toBeCloseTo(1, 10);
    expect(applyPreferenceCurve(5, bggWeight, "higher-is-better", {})).toBeCloseTo(10, 10);
  });

  test("lower-is-better: min → 10, max → 1", () => {
    expect(applyPreferenceCurve(1, personal, "lower-is-better", {})).toBeCloseTo(10, 10);
    expect(applyPreferenceCurve(10, personal, "lower-is-better", {})).toBeCloseTo(1, 10);
  });

  test("lower-is-better on BGG weight: min → 10, max → 1", () => {
    expect(applyPreferenceCurve(1, bggWeight, "lower-is-better", {})).toBeCloseTo(10, 10);
    expect(applyPreferenceCurve(5, bggWeight, "lower-is-better", {})).toBeCloseTo(1, 10);
  });

  test("sweet-spot: ideal → 10, min → 1, max → 1", () => {
    expect(applyPreferenceCurve(5.5, personal, "sweet-spot", { idealValue: 5.5 })).toBeCloseTo(
      10,
      10,
    );
    expect(applyPreferenceCurve(1, personal, "sweet-spot", { idealValue: 5.5 })).toBeCloseTo(1, 10);
    expect(applyPreferenceCurve(10, personal, "sweet-spot", { idealValue: 5.5 })).toBeCloseTo(
      1,
      10,
    );
  });

  test("sweet-spot on BGG weight: ideal → 10, endpoints → 1", () => {
    expect(applyPreferenceCurve(3.0, bggWeight, "sweet-spot", { idealValue: 3.0 })).toBeCloseTo(
      10,
      10,
    );
    expect(applyPreferenceCurve(1, bggWeight, "sweet-spot", { idealValue: 3.0 })).toBeCloseTo(
      1,
      10,
    );
    expect(applyPreferenceCurve(5, bggWeight, "sweet-spot", { idealValue: 3.0 })).toBeCloseTo(
      1,
      10,
    );
  });
});

// --- Linear Identity (REQ-CURVE-6) ---

describe("linear identity", () => {
  test("personal axis higher-is-better returns x for every integer 1-10", () => {
    const scale = { min: 1, max: 10 };
    for (let x = 1; x <= 10; x++) {
      expect(applyPreferenceCurve(x, scale, "higher-is-better", {})).toBeCloseTo(x, 10);
    }
  });

  test("BGG communityRating higher-is-better is identity", () => {
    const scale = { min: 1, max: 10 };
    for (let x = 1; x <= 10; x++) {
      expect(applyPreferenceCurve(x, scale, "higher-is-better", {})).toBeCloseTo(x, 10);
    }
  });
});

// --- BGG Complexity Correction (REQ-CURVE-6) ---

describe("BGG complexity correction", () => {
  const bggWeight = { min: 1, max: 5 };

  test("at BGG weight 1.0: new linear produces 1.0 (old was 2.0)", () => {
    const newEffective = applyPreferenceCurve(1.0, bggWeight, "higher-is-better", {});
    expect(newEffective).toBeCloseTo(1.0, 10);
    // Old mapping: weight * 2 = 2.0 (documented shift)
    expect(1.0 * 2).toBe(2.0);
  });

  test("at BGG weight 3.0: new linear produces 5.5 (old was 6.0)", () => {
    const newEffective = applyPreferenceCurve(3.0, bggWeight, "higher-is-better", {});
    // 1 + 9 * (3.0 - 1) / (5 - 1) = 1 + 9 * 2/4 = 1 + 4.5 = 5.5
    expect(newEffective).toBeCloseTo(5.5, 10);
    expect(3.0 * 2).toBe(6.0);
  });

  test("at BGG weight 5.0: both map to 10.0", () => {
    const newEffective = applyPreferenceCurve(5.0, bggWeight, "higher-is-better", {});
    expect(newEffective).toBeCloseTo(10.0, 10);
    expect(5.0 * 2).toBe(10.0);
  });
});

// --- Continuity and Monotonicity (REQ-CURVE-12) ---

describe("continuity and monotonicity", () => {
  const bggWeight = { min: 1, max: 5 };
  const numPoints = 100;

  test("sweet-spot left side is monotonically decreasing away from ideal", () => {
    const ideal = 3.0;
    const config = { idealValue: ideal, tolerance: "moderate" as const };

    // Sample points from ideal down to scale.min
    const points: number[] = [];
    for (let i = 0; i <= numPoints; i++) {
      const raw = ideal - (i / numPoints) * (ideal - bggWeight.min);
      points.push(applyPreferenceCurve(raw, bggWeight, "sweet-spot", config));
    }

    // First point should be at ideal (10), last at min (1)
    expect(points[0]).toBeCloseTo(10, 5);
    expect(points[numPoints]).toBeCloseTo(1, 5);

    // Each successive point should be <= previous (moving away from ideal)
    for (let i = 1; i <= numPoints; i++) {
      expect(points[i]).toBeLessThanOrEqual(points[i - 1] + 1e-10);
    }
  });

  test("sweet-spot right side is monotonically decreasing away from ideal", () => {
    const ideal = 3.0;
    const config = { idealValue: ideal, tolerance: "moderate" as const };

    const points: number[] = [];
    for (let i = 0; i <= numPoints; i++) {
      const raw = ideal + (i / numPoints) * (bggWeight.max - ideal);
      points.push(applyPreferenceCurve(raw, bggWeight, "sweet-spot", config));
    }

    expect(points[0]).toBeCloseTo(10, 5);
    expect(points[numPoints]).toBeCloseTo(1, 5);

    for (let i = 1; i <= numPoints; i++) {
      expect(points[i]).toBeLessThanOrEqual(points[i - 1] + 1e-10);
    }
  });

  test("sweet-spot curve is smooth (no large jumps between adjacent points)", () => {
    const ideal = 3.0;
    const config = { idealValue: ideal, tolerance: "moderate" as const };

    // Left side
    for (let i = 1; i <= numPoints; i++) {
      const raw1 = ideal - ((i - 1) / numPoints) * (ideal - bggWeight.min);
      const raw2 = ideal - (i / numPoints) * (ideal - bggWeight.min);
      const e1 = applyPreferenceCurve(raw1, bggWeight, "sweet-spot", config);
      const e2 = applyPreferenceCurve(raw2, bggWeight, "sweet-spot", config);
      // Adjacent points shouldn't differ by more than 1.0 with 100 samples
      expect(Math.abs(e1 - e2)).toBeLessThan(1.0);
    }
  });

  test("higher-is-better is monotonically increasing", () => {
    const personal = { min: 1, max: 10 };
    let prev = applyPreferenceCurve(1, personal, "higher-is-better", {});
    for (let i = 1; i <= numPoints; i++) {
      const raw = 1 + (i / numPoints) * 9;
      const curr = applyPreferenceCurve(raw, personal, "higher-is-better", {});
      expect(curr).toBeGreaterThanOrEqual(prev - 1e-10);
      prev = curr;
    }
  });

  test("lower-is-better is monotonically decreasing", () => {
    const personal = { min: 1, max: 10 };
    let prev = applyPreferenceCurve(1, personal, "lower-is-better", {});
    for (let i = 1; i <= numPoints; i++) {
      const raw = 1 + (i / numPoints) * 9;
      const curr = applyPreferenceCurve(raw, personal, "lower-is-better", {});
      expect(curr).toBeLessThanOrEqual(prev + 1e-10);
      prev = curr;
    }
  });
});

// --- Tolerance Anchors (REQ-CURVE-8) ---

describe("tolerance anchors", () => {
  test("BGG complexity (1-5), ideal 3.0, at distance 1.33 (~range/3)", () => {
    const scale = { min: 1, max: 5 };
    const ideal = 3.0;
    const distance = (scale.max - scale.min) / 3; // 1.333...
    const testValue = ideal + distance; // 4.333...

    const flexResult = applyPreferenceCurve(testValue, scale, "sweet-spot", {
      idealValue: ideal,
      tolerance: "flexible",
    });
    const modResult = applyPreferenceCurve(testValue, scale, "sweet-spot", {
      idealValue: ideal,
      tolerance: "moderate",
    });
    const strictResult = applyPreferenceCurve(testValue, scale, "sweet-spot", {
      idealValue: ideal,
      tolerance: "strict",
    });

    // Flexible: effective >= 7
    expect(flexResult).toBeGreaterThanOrEqual(7);
    // Moderate: effective 4-5
    expect(modResult).toBeGreaterThanOrEqual(4);
    expect(modResult).toBeLessThanOrEqual(5);
    // Strict: effective <= 2.5 (allowing floating point tolerance)
    expect(strictResult).toBeLessThan(2.5 + 1e-10);
  });

  test("personal axis (1-10), ideal 5.5, at distance 3 (~range/3)", () => {
    const scale = { min: 1, max: 10 };
    const ideal = 5.5;
    const distance = (scale.max - scale.min) / 3; // 3
    const testValue = ideal + distance; // 8.5

    const flexResult = applyPreferenceCurve(testValue, scale, "sweet-spot", {
      idealValue: ideal,
      tolerance: "flexible",
    });
    const modResult = applyPreferenceCurve(testValue, scale, "sweet-spot", {
      idealValue: ideal,
      tolerance: "moderate",
    });
    const strictResult = applyPreferenceCurve(testValue, scale, "sweet-spot", {
      idealValue: ideal,
      tolerance: "strict",
    });

    expect(flexResult).toBeGreaterThanOrEqual(7);
    expect(modResult).toBeGreaterThanOrEqual(4);
    expect(modResult).toBeLessThanOrEqual(5);
    // Strict: effective <= 2.5 (allowing floating point tolerance)
    expect(strictResult).toBeLessThan(2.5 + 1e-10);
  });

  test("anchors hold on the left side too", () => {
    const scale = { min: 1, max: 5 };
    const ideal = 3.0;
    const distance = (scale.max - scale.min) / 3;
    const testValue = ideal - distance; // 1.667

    const flexResult = applyPreferenceCurve(testValue, scale, "sweet-spot", {
      idealValue: ideal,
      tolerance: "flexible",
    });
    const strictResult = applyPreferenceCurve(testValue, scale, "sweet-spot", {
      idealValue: ideal,
      tolerance: "strict",
    });

    expect(flexResult).toBeGreaterThanOrEqual(7);
    // Strict: effective <= 2.5 (allowing floating point tolerance)
    expect(strictResult).toBeLessThan(2.5 + 1e-10);
  });
});

// --- Asymmetric Lean (REQ-CURVE-9) ---

describe("asymmetric lean", () => {
  test("lean toward lower: 1.5 scores higher than 4.0 with ideal at 2.75", () => {
    const scale = { min: 1, max: 5 };
    const ideal = 2.75;
    const config = {
      idealValue: ideal,
      tolerance: "moderate" as const,
      leanDirection: "lower" as const,
    };

    // 1.5 is 1.25 below ideal, 4.0 is 1.25 above ideal (equal distance)
    const lower = applyPreferenceCurve(1.5, scale, "sweet-spot", config);
    const higher = applyPreferenceCurve(4.0, scale, "sweet-spot", config);

    expect(lower).toBeGreaterThan(higher);
  });

  test("lean toward higher: higher side scores better at equal distance", () => {
    const scale = { min: 1, max: 5 };
    const ideal = 3.0;
    const config = {
      idealValue: ideal,
      tolerance: "moderate" as const,
      leanDirection: "higher" as const,
    };

    const lower = applyPreferenceCurve(2.0, scale, "sweet-spot", config);
    const higher = applyPreferenceCurve(4.0, scale, "sweet-spot", config);

    expect(higher).toBeGreaterThan(lower);
  });

  test("symmetric (no lean): equal distances produce equal effective ratings", () => {
    const scale = { min: 1, max: 5 };
    const ideal = 3.0;
    const config = {
      idealValue: ideal,
      tolerance: "moderate" as const,
      leanDirection: null,
    };

    const lower = applyPreferenceCurve(2.0, scale, "sweet-spot", config);
    const higher = applyPreferenceCurve(4.0, scale, "sweet-spot", config);

    expect(lower).toBeCloseTo(higher, 10);
  });
});

// --- Veto ---

describe("checkVeto", () => {
  test("below threshold triggers veto", () => {
    expect(checkVeto(3, { direction: "below", threshold: 4 })).toBe(true);
  });

  test("at threshold does not trigger veto (below direction)", () => {
    expect(checkVeto(4, { direction: "below", threshold: 4 })).toBe(false);
  });

  test("above threshold does not trigger veto (below direction)", () => {
    expect(checkVeto(5, { direction: "below", threshold: 4 })).toBe(false);
  });

  test("above threshold triggers veto (above direction)", () => {
    expect(checkVeto(5, { direction: "above", threshold: 4 })).toBe(true);
  });

  test("at threshold does not trigger veto (above direction)", () => {
    expect(checkVeto(4, { direction: "above", threshold: 4 })).toBe(false);
  });

  test("below threshold does not trigger veto (above direction)", () => {
    expect(checkVeto(3, { direction: "above", threshold: 4 })).toBe(false);
  });

  test("null veto never triggers", () => {
    expect(checkVeto(0, null)).toBe(false);
    expect(checkVeto(100, null)).toBe(false);
  });
});

// --- computeHigherIsBetterEffective ---

describe("computeHigherIsBetterEffective", () => {
  test("matches applyPreferenceCurve with higher-is-better", () => {
    const scale = { min: 1, max: 5 };
    for (const raw of [1, 2, 3, 3.5, 4, 5]) {
      expect(computeHigherIsBetterEffective(raw, scale)).toBeCloseTo(
        applyPreferenceCurve(raw, scale, "higher-is-better", {}),
        10,
      );
    }
  });

  test("handles zero-range scale", () => {
    expect(computeHigherIsBetterEffective(5, { min: 5, max: 5 })).toBe(10);
  });
});

// --- Edge Cases ---

describe("edge cases", () => {
  test("raw value at scale minimum", () => {
    expect(applyPreferenceCurve(1, { min: 1, max: 10 }, "higher-is-better", {})).toBeCloseTo(1, 10);
    expect(applyPreferenceCurve(1, { min: 1, max: 10 }, "lower-is-better", {})).toBeCloseTo(10, 10);
  });

  test("raw value at scale maximum", () => {
    expect(applyPreferenceCurve(10, { min: 1, max: 10 }, "higher-is-better", {})).toBeCloseTo(
      10,
      10,
    );
    expect(applyPreferenceCurve(10, { min: 1, max: 10 }, "lower-is-better", {})).toBeCloseTo(1, 10);
  });

  test("ideal at scale minimum: left side has zero width", () => {
    const scale = { min: 1, max: 10 };
    const config = { idealValue: 1 };

    // At ideal
    expect(applyPreferenceCurve(1, scale, "sweet-spot", config)).toBeCloseTo(10, 10);
    // Right of ideal
    expect(applyPreferenceCurve(10, scale, "sweet-spot", config)).toBeCloseTo(1, 10);
    // Midpoint right
    const mid = applyPreferenceCurve(5.5, scale, "sweet-spot", config);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(10);
  });

  test("ideal at scale maximum: right side has zero width", () => {
    const scale = { min: 1, max: 10 };
    const config = { idealValue: 10 };

    // At ideal
    expect(applyPreferenceCurve(10, scale, "sweet-spot", config)).toBeCloseTo(10, 10);
    // Left of ideal
    expect(applyPreferenceCurve(1, scale, "sweet-spot", config)).toBeCloseTo(1, 10);
    // Midpoint left
    const mid = applyPreferenceCurve(5.5, scale, "sweet-spot", config);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(10);
  });

  test("zero-range scale: higher-is-better returns 10", () => {
    expect(applyPreferenceCurve(5, { min: 5, max: 5 }, "higher-is-better", {})).toBe(10);
  });

  test("zero-range scale: lower-is-better returns 10", () => {
    expect(applyPreferenceCurve(5, { min: 5, max: 5 }, "lower-is-better", {})).toBe(10);
  });

  test("raw value outside scale bounds is handled gracefully", () => {
    const scale = { min: 1, max: 10 };
    // Below minimum
    const below = applyPreferenceCurve(0, scale, "higher-is-better", {});
    expect(below).toBeLessThan(1);
    // Above maximum
    const above = applyPreferenceCurve(11, scale, "higher-is-better", {});
    expect(above).toBeGreaterThan(10);
  });

  test("sweet-spot defaults to moderate tolerance when not specified", () => {
    const scale = { min: 1, max: 10 };
    const withDefault = applyPreferenceCurve(7, scale, "sweet-spot", { idealValue: 5.5 });
    const withModerate = applyPreferenceCurve(7, scale, "sweet-spot", {
      idealValue: 5.5,
      tolerance: "moderate",
    });
    expect(withDefault).toBeCloseTo(withModerate, 10);
  });
});

// --- Exported Constants ---

describe("exported constants", () => {
  test("K_FLEXIBLE is approximately 0.37", () => {
    expect(K_FLEXIBLE).toBeCloseTo(0.369, 2);
  });

  test("K_MODERATE is approximately 0.86", () => {
    expect(K_MODERATE).toBeCloseTo(0.86, 2);
  });

  test("K_STRICT is approximately 1.63", () => {
    expect(K_STRICT).toBeCloseTo(1.631, 2);
  });

  test("lean multipliers are correct", () => {
    expect(LEAN_GENTLE_MULTIPLIER).toBe(0.6);
    expect(LEAN_STEEP_MULTIPLIER).toBe(1.5);
  });
});
