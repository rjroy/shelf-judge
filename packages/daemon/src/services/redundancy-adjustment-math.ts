import type { RedundancySettings } from "@shelf-judge/shared";

export interface RedundancyPenaltyNeighbor {
  readonly score: number;
  readonly isPredicted: boolean;
}

export interface RedundancyPenaltyResult {
  readonly betterCount: number;
  readonly penalty: number;
  readonly adjustedScore: number;
}

/** Shared penalty math; callers retain ownership of eligibility, ordering, and output details. */
export function calculateRedundancyPenalty(
  targetScore: number,
  targetIsFullyPredicted: boolean,
  neighbors: readonly RedundancyPenaltyNeighbor[],
  settings: Pick<RedundancySettings, "expectedNeighbors" | "maxPenalty">,
): RedundancyPenaltyResult {
  let betterCount = 0;
  for (const neighbor of neighbors) {
    if (Math.round(targetScore * 100) === Math.round(neighbor.score * 100)) continue;
    if (!targetIsFullyPredicted && neighbor.isPredicted) continue;
    if (neighbor.score > targetScore) betterCount++;
  }
  const rawPenalty =
    (betterCount / Math.max(neighbors.length, settings.expectedNeighbors)) * settings.maxPenalty;
  return {
    betterCount,
    penalty: Math.round(rawPenalty * 100) / 100,
    adjustedScore: Math.round(Math.max(1, targetScore - rawPenalty) * 100) / 100,
  };
}
