import { describe, expect, test } from "bun:test";
import { applyPreferenceCurve, getNativeScale } from "../src/curve-math";

describe("getNativeScale", () => {
  test("personal source returns 1-10 scale", () => {
    expect(getNativeScale("personal", null)).toEqual({ min: 1, max: 10 });
  });

  test("tournament source returns 1-10 scale", () => {
    expect(getNativeScale("tournament", null)).toEqual({ min: 1, max: 10 });
  });

  test("bgg communityRating returns 1-10 scale", () => {
    expect(getNativeScale("bgg", "communityRating")).toEqual({ min: 1, max: 10 });
  });

  test("bgg weight returns 1-5 scale", () => {
    expect(getNativeScale("bgg", "weight")).toEqual({ min: 1, max: 5 });
  });

  test("bgg with unknown field throws", () => {
    expect(() => getNativeScale("bgg", "nonsense")).toThrow();
  });
});

describe("applyPreferenceCurve numeric tolerance width", () => {
  const playTimeScale = { min: 1, max: 240 };

  test("pins the ideal, width anchors, and endpoints", () => {
    const config = { idealValue: 90, toleranceWidth: 30 };
    expect(applyPreferenceCurve(90, playTimeScale, "sweet-spot", config)).toBe(10);
    expect(applyPreferenceCurve(60, playTimeScale, "sweet-spot", config)).toBeCloseTo(4.5, 10);
    expect(applyPreferenceCurve(120, playTimeScale, "sweet-spot", config)).toBeCloseTo(4.5, 10);
    expect(applyPreferenceCurve(1, playTimeScale, "sweet-spot", config)).toBeCloseTo(1, 10);
    expect(applyPreferenceCurve(240, playTimeScale, "sweet-spot", config)).toBeCloseTo(1, 10);
  });

  test("calibrates asymmetric sides independently", () => {
    const scale = { min: 0, max: 100 };
    const config = { idealValue: 30, toleranceWidth: 10 };
    expect(applyPreferenceCurve(20, scale, "sweet-spot", config)).toBeCloseTo(4.5, 10);
    expect(applyPreferenceCurve(40, scale, "sweet-spot", config)).toBeCloseTo(4.5, 10);
    expect(applyPreferenceCurve(0, scale, "sweet-spot", config)).toBeCloseTo(1, 10);
    expect(applyPreferenceCurve(100, scale, "sweet-spot", config)).toBeCloseTo(1, 10);
  });

  test("applies existing lean multipliers to per-side exponents", () => {
    const lowerLean = { idealValue: 90, toleranceWidth: 30, leanDirection: "lower" as const };
    const higherLean = { idealValue: 90, toleranceWidth: 30, leanDirection: "higher" as const };
    expect(applyPreferenceCurve(60, playTimeScale, "sweet-spot", lowerLean)).toBeGreaterThan(4.5);
    expect(applyPreferenceCurve(120, playTimeScale, "sweet-spot", lowerLean)).toBeLessThan(4.5);
    expect(applyPreferenceCurve(60, playTimeScale, "sweet-spot", higherLean)).toBeLessThan(4.5);
    expect(applyPreferenceCurve(120, playTimeScale, "sweet-spot", higherLean)).toBeGreaterThan(4.5);
  });

  test("rejects nonfinite, nonpositive, and endpoint-reaching widths", () => {
    for (const toleranceWidth of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 89, 150]) {
      expect(() =>
        applyPreferenceCurve(90, playTimeScale, "sweet-spot", {
          idealValue: 90,
          toleranceWidth,
        }),
      ).toThrow("toleranceWidth");
    }
  });

  test("preserves categorical moderate behavior when width is absent", () => {
    const implicit = applyPreferenceCurve(60, playTimeScale, "sweet-spot", { idealValue: 90 });
    const explicit = applyPreferenceCurve(60, playTimeScale, "sweet-spot", {
      idealValue: 90,
      tolerance: "moderate",
    });
    expect(implicit).toBe(explicit);
  });

  test("rejects simultaneous categorical and numeric tolerance", () => {
    expect(() =>
      applyPreferenceCurve(60, playTimeScale, "sweet-spot", {
        idealValue: 90,
        tolerance: "moderate",
        toleranceWidth: 30,
      }),
    ).toThrow("tolerance and toleranceWidth cannot be used together");
  });

  test("supports a dynamically capped scale", () => {
    const scale = { min: 1, max: 180 };
    const config = { idealValue: 90, toleranceWidth: 30 };
    expect(applyPreferenceCurve(120, scale, "sweet-spot", config)).toBeCloseTo(4.5, 10);
    expect(applyPreferenceCurve(180, scale, "sweet-spot", config)).toBeCloseTo(1, 10);
  });
});
