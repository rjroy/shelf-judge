import { resolveDerivedAxisValue } from "./derived-axis-registry";
import type { Axis, Game } from "./types";

/**
 * For each axis, resolve the effective value for a game:
 * 1. Personal rating (from game.ratings) takes priority
 * 2. Falls back to the registry-resolved factual value for derived axes
 *
 * Returns a map of axisId to resolved value in the axis's native scale.
 * Axes with no value (no personal rating AND no BGG data) are omitted.
 */
export function resolveAxisValues(game: Game, axes: Axis[]): Record<string, number> {
  const result: Record<string, number> = {};

  for (const axis of axes) {
    if (!axis.enabled) continue;
    const personalRating = game.ratings[axis.id];
    if (personalRating !== undefined) {
      result[axis.id] = personalRating;
      continue;
    }

    if (axis.source === "derived") {
      const resolution = resolveDerivedAxisValue(axis, game);
      if (resolution !== null) result[axis.id] = resolution.sourceValue;
    }
  }

  return result;
}
