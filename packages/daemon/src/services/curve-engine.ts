// Pure curve math functions. No I/O, no service dependencies.
// Implements REQ-CURVE-2 through REQ-CURVE-12, REQ-CURVE-25.
// Follows the elo-engine.ts pattern: exported functions, heavy unit tests.

import type {
  AxisSource,
  NativeScale,
  PreferenceShape,
  ToleranceLevel,
  LeanDirection,
  VetoConfig,
} from "@shelf-judge/shared";

// Tolerance calibration constants.
// Derived from REQ-CURVE-8 anchors at center-of-scale ideal position.
// At center ideal, t at one-third range = 2/3, so (1-t) = 1/3.
// Solve: 1 + 9 * (1/3)^k = anchor_effective for each tolerance level.
//
// Flexible: effective >= 7 at range/3 → (1/3)^k >= 6/9 → k = ln(2/3)/ln(1/3)
// Moderate: effective ≈ 4.5 at range/3 → (1/3)^k = 3.5/9 → k = ln(7/18)/ln(1/3)
// Strict: effective <= 2.5 at range/3 → (1/3)^k <= 1.5/9 → k = ln(1/6)/ln(1/3)
export const K_FLEXIBLE = Math.log(2 / 3) / Math.log(1 / 3); // ≈ 0.369
export const K_MODERATE = Math.log(7 / 18) / Math.log(1 / 3); // ≈ 0.860
export const K_STRICT = Math.log(1 / 6) / Math.log(1 / 3); // ≈ 1.631

// Lean multipliers. The preferred side gets a gentler slope (lower k),
// the avoided side gets a steeper slope (higher k).
export const LEAN_GENTLE_MULTIPLIER = 0.6;
export const LEAN_STEEP_MULTIPLIER = 1.5;

/**
 * Returns the native scale range for an axis based on its source and BGG field.
 * Personal axes are always 1-10. BGG axes depend on the field.
 */
export function getNativeScale(source: AxisSource, bggField: string | null): NativeScale {
  if (source === "personal") {
    return { min: 1, max: 10 };
  }

  switch (bggField) {
    case "communityRating":
      return { min: 1, max: 10 };
    case "weight":
      return { min: 1, max: 5 };
    default:
      throw new Error(`Unknown BGG field: ${bggField}`);
  }
}

/**
 * Returns the base k exponent for a tolerance level.
 */
export function calibrateTolerance(tolerance: ToleranceLevel): number {
  switch (tolerance) {
    case "flexible":
      return K_FLEXIBLE;
    case "moderate":
      return K_MODERATE;
    case "strict":
      return K_STRICT;
  }
}

/**
 * Applies lean direction to the base k value.
 * When lean is null (symmetric), both sides use baseK.
 * When lean is "lower", the left side (lower values) gets gentler slope.
 * When lean is "higher", the right side (higher values) gets gentler slope.
 */
export function applyLean(
  baseK: number,
  leanDirection: LeanDirection | null,
  side: "left" | "right",
): number {
  if (leanDirection === null) return baseK;

  if (leanDirection === "lower") {
    return side === "left" ? baseK * LEAN_GENTLE_MULTIPLIER : baseK * LEAN_STEEP_MULTIPLIER;
  }

  // leanDirection === "higher"
  return side === "right" ? baseK * LEAN_GENTLE_MULTIPLIER : baseK * LEAN_STEEP_MULTIPLIER;
}

/**
 * Core curve function. Maps a raw value on native scale to an effective 1-10 rating.
 *
 * Higher is better: linear map, identity when scale is 1-10.
 * Lower is better: inverted linear map.
 * Sweet spot: power curve f(t) = 1 + 9 * (1-t)^k with per-side exponent.
 */
export function applyPreferenceCurve(
  rawValue: number,
  scale: NativeScale,
  shape: PreferenceShape,
  config: {
    idealValue?: number | null;
    tolerance?: ToleranceLevel;
    leanDirection?: LeanDirection | null;
  },
): number {
  const range = scale.max - scale.min;

  switch (shape) {
    case "higher-is-better": {
      if (range === 0) return 10;
      return 1 + (9 * (rawValue - scale.min)) / range;
    }

    case "lower-is-better": {
      if (range === 0) return 10;
      return 10 - (9 * (rawValue - scale.min)) / range;
    }

    case "sweet-spot": {
      const ideal = config.idealValue ?? scale.min;
      const tolerance = config.tolerance ?? "moderate";
      const leanDirection = config.leanDirection ?? null;
      const baseK = calibrateTolerance(tolerance);

      if (rawValue === ideal) return 10;

      if (rawValue < ideal) {
        const sideRange = ideal - scale.min;
        if (sideRange === 0) return 1; // ideal is at scale min, can't go lower
        const t = (ideal - rawValue) / sideRange;
        const k = applyLean(baseK, leanDirection, "left");
        return 1 + 9 * Math.pow(1 - t, k);
      }

      // rawValue > ideal
      const sideRange = scale.max - ideal;
      if (sideRange === 0) return 1; // ideal is at scale max, can't go higher
      const t = (rawValue - ideal) / sideRange;
      const k = applyLean(baseK, leanDirection, "right");
      return 1 + 9 * Math.pow(1 - t, k);
    }
  }
}

/**
 * Returns true if the veto threshold is triggered.
 */
export function checkVeto(rawValue: number, veto: VetoConfig | null): boolean {
  if (veto === null) return false;

  if (veto.direction === "below") {
    return rawValue < veto.threshold;
  }

  // direction === "above"
  return rawValue > veto.threshold;
}

/**
 * Reference baseline for REQ-CURVE-17 highlighting.
 * Returns what the effective rating would be under higher-is-better.
 */
export function computeHigherIsBetterEffective(rawValue: number, scale: NativeScale): number {
  const range = scale.max - scale.min;
  if (range === 0) return 10;
  return 1 + (9 * (rawValue - scale.min)) / range;
}
