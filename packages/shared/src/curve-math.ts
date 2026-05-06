// Pure curve math functions shared between daemon (scoring) and web (live preview).
// No I/O, no service dependencies. Implements REQ-CURVE-2 through REQ-CURVE-12.

import type {
  AxisSource,
  NativeScale,
  PreferenceShape,
  ToleranceLevel,
  LeanDirection,
} from "./types";

function clamp(value: number): number {
  return Math.max(1, Math.min(10, value));
}

// Tolerance calibration constants.
// Derived from REQ-CURVE-8 anchors at center-of-scale ideal position.
// At center ideal, t at one-third range = 2/3, so (1-t) = 1/3.
// Solve: 1 + 9 * (1/3)^k = anchor_effective for each tolerance level.
//
// Flexible: effective >= 7 at range/3 -> (1/3)^k >= 6/9 -> k = ln(2/3)/ln(1/3)
// Moderate: effective ~ 4.5 at range/3 -> (1/3)^k = 3.5/9 -> k = ln(7/18)/ln(1/3)
// Strict: effective <= 2.5 at range/3 -> (1/3)^k <= 1.5/9 -> k = ln(1/6)/ln(1/3)
export const K_FLEXIBLE = Math.log(2 / 3) / Math.log(1 / 3);
export const K_MODERATE = Math.log(7 / 18) / Math.log(1 / 3);
export const K_STRICT = Math.log(1 / 6) / Math.log(1 / 3);

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

  if (source === "tournament") {
    // Tournament axes feed normalized ELO scores in the 1-10 space, same as personal.
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
      return clamp(1 + (9 * (rawValue - scale.min)) / range);
    }

    case "lower-is-better": {
      if (range === 0) return 10;
      return clamp(10 - (9 * (rawValue - scale.min)) / range);
    }

    case "sweet-spot": {
      if (config.idealValue == null) {
        throw new Error("idealValue is required for sweet-spot preference shape");
      }
      const ideal = config.idealValue;
      const tolerance = config.tolerance ?? "moderate";
      const leanDirection = config.leanDirection ?? null;
      const baseK = calibrateTolerance(tolerance);

      if (rawValue === ideal) return 10;

      if (rawValue < ideal) {
        const sideRange = ideal - scale.min;
        if (sideRange === 0) return 1;
        const t = (ideal - rawValue) / sideRange;
        const k = applyLean(baseK, leanDirection, "left");
        return clamp(1 + 9 * Math.pow(1 - t, k));
      }

      const sideRange = scale.max - ideal;
      if (sideRange === 0) return 1;
      const t = (rawValue - ideal) / sideRange;
      const k = applyLean(baseK, leanDirection, "right");
      return clamp(1 + 9 * Math.pow(1 - t, k));
    }
  }
}
