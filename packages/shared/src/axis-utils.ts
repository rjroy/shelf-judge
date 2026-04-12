import type { Axis, BggGameData, Game } from "./types";

/**
 * Returns the raw native-scale BGG value for an axis.
 * No normalization: weight returns 1-5, communityRating returns 1-10.
 */
export function resolveBggRawValue(axis: Axis, bggData: BggGameData | null): number | null {
  if (axis.source !== "bgg" || !axis.bggField || !bggData) return null;

  switch (axis.bggField) {
    case "communityRating":
      return bggData.communityRating;
    case "weight":
      return bggData.weight;
    default:
      return null;
  }
}

/**
 * For each axis, resolve the effective value for a game:
 * 1. Personal rating (from game.ratings) takes priority
 * 2. Falls back to native-scale BGG value from bggData
 *
 * Returns a map of axisId to resolved value in the axis's native scale.
 * Axes with no value (no personal rating AND no BGG data) are omitted.
 */
export function resolveAxisValues(game: Game, axes: Axis[]): Record<string, number> {
  const result: Record<string, number> = {};

  for (const axis of axes) {
    const personalRating = game.ratings[axis.id];
    if (personalRating !== undefined) {
      result[axis.id] = personalRating;
      continue;
    }

    const bggValue = resolveBggRawValue(axis, game.bggData ?? null);
    if (bggValue !== null) {
      result[axis.id] = bggValue;
    }
  }

  return result;
}
