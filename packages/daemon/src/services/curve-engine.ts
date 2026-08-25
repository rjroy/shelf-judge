// Curve engine for the daemon. Re-exports shared pure math and adds
// daemon-only functions (veto checks, reference baselines).

import type { NativeScale, VetoConfig } from "@shelf-judge/shared";

// Re-export shared curve math used by daemon consumers.
export {
  K_FLEXIBLE,
  K_MODERATE,
  K_STRICT,
  LEAN_GENTLE_MULTIPLIER,
  LEAN_STEEP_MULTIPLIER,
  calibrateTolerance,
  applyLean,
  applyPreferenceCurve,
} from "@shelf-judge/shared";

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
