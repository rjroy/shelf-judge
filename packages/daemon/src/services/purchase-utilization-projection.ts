import {
  calculatePurchaseUtilization,
  projectFitnessScore,
  resolveEffectivePlayerCount,
  resolveEffectivePlayingTime,
  type EntertainmentBenchmark,
  type GameWithPurchaseUtilization,
  type GameWithScore,
  type PurchaseUtilizationInput,
  type PurchaseUtilizationResult,
} from "@shelf-judge/shared";

/** Bump when the resolved inputs or calculation delegated by this projection change. */
export const PURCHASE_UTILIZATION_PROJECTION_VERSION = 1;
export const PURCHASE_UTILIZATION_DEPENDENCY_VERSION = 1;

export interface PurchaseUtilizationProjection {
  readonly displayScore: string | null;
  readonly input: PurchaseUtilizationInput;
  readonly purchaseUtilization: PurchaseUtilizationResult;
  readonly calculationVersion: number;
  readonly dependencyVersion: number;
}

/**
 * The single daemon assembly point for the shared purchase-utilization calculator.
 * It deliberately retains the list/detail service's established input resolution.
 */
export function projectPurchaseUtilization(
  entry: GameWithScore,
  entertainmentBenchmark: EntertainmentBenchmark,
): PurchaseUtilizationProjection {
  const displayScore = entry.score === null ? null : projectFitnessScore(String(entry.score.score));
  const input: PurchaseUtilizationInput = {
    acquisition: entry.game.acquisition,
    entertainmentBenchmark,
    playCount: entry.game.playCountEvidence,
    duration: resolveEffectivePlayingTime(entry.game),
    playerRange: entry.game.playerRangeEvidence,
    suggestedPlayerPoll: entry.game.suggestedPlayerPoll,
    playerCountOverride: resolveEffectivePlayerCount(entry.game, null),
    fitness: displayScore,
  };
  const purchaseUtilization = calculatePurchaseUtilization(input);
  return {
    displayScore,
    input,
    purchaseUtilization,
    calculationVersion: PURCHASE_UTILIZATION_PROJECTION_VERSION,
    dependencyVersion: PURCHASE_UTILIZATION_DEPENDENCY_VERSION,
  };
}

export function enrichGameWithPurchaseUtilization(
  entry: GameWithScore,
  entertainmentBenchmark: EntertainmentBenchmark,
): GameWithPurchaseUtilization {
  const { displayScore, purchaseUtilization } = projectPurchaseUtilization(
    entry,
    entertainmentBenchmark,
  );
  return { ...entry, displayScore, purchaseUtilization };
}
