// Client-side curve math for live preview in the axes configuration UI.
// Duplicates the pure functions from packages/daemon/src/services/curve-engine.ts.
// These are stable math functions (~50 lines) that enable instant preview without API round-trips.

import type {
  AxisSource,
  NativeScale,
  PreferenceShape,
  ToleranceLevel,
  LeanDirection,
} from "@shelf-judge/shared";

function clamp(value: number): number {
  return Math.max(1, Math.min(10, value));
}

// Tolerance calibration constants (same as curve-engine.ts)
export const K_FLEXIBLE = Math.log(2 / 3) / Math.log(1 / 3);
export const K_MODERATE = Math.log(7 / 18) / Math.log(1 / 3);
export const K_STRICT = Math.log(1 / 6) / Math.log(1 / 3);

const LEAN_GENTLE_MULTIPLIER = 0.6;
const LEAN_STEEP_MULTIPLIER = 1.5;

export function getNativeScale(source: AxisSource, bggField: string | null): NativeScale {
  if (source === "personal") return { min: 1, max: 10 };
  switch (bggField) {
    case "communityRating":
      return { min: 1, max: 10 };
    case "weight":
      return { min: 1, max: 5 };
    default:
      return { min: 1, max: 10 };
  }
}

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

function applyLean(
  baseK: number,
  leanDirection: LeanDirection | null,
  side: "left" | "right",
): number {
  if (leanDirection === null) return baseK;
  if (leanDirection === "lower") {
    return side === "left" ? baseK * LEAN_GENTLE_MULTIPLIER : baseK * LEAN_STEEP_MULTIPLIER;
  }
  return side === "right" ? baseK * LEAN_GENTLE_MULTIPLIER : baseK * LEAN_STEEP_MULTIPLIER;
}

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
      if (config.idealValue == null) return 5;
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
