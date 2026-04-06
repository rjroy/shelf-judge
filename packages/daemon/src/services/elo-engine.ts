// Pure ELO calculation functions. No I/O, no service dependencies.
// Implements REQ-TOURN-5 (standard ELO), REQ-TOURN-6 (K-factor),
// REQ-TOURN-7 (recalculate from history), REQ-TOURN-9 (normalization).

import type { Comparison, TournamentGameStats } from "@shelf-judge/shared";

/**
 * Standard ELO expected score: 1 / (1 + 10^((ratingB - ratingA) / 400))
 */
export function calculateExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate new ELO ratings after a comparison.
 * K-factor: 32 when a game's comparison count < kThreshold, 16 otherwise.
 * REQ-TOURN-6: threshold defaults to 15 (not 30; spec inconsistency resolved in favor of REQ-TOURN-6).
 */
export function calculateNewRatings(
  ratingA: number,
  ratingB: number,
  winnerId: "a" | "b",
  compCountA: number,
  compCountB: number,
  kThreshold: number,
): { newRatingA: number; newRatingB: number } {
  const expectedA = calculateExpectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;

  const actualA = winnerId === "a" ? 1 : 0;
  const actualB = 1 - actualA;

  const kA = compCountA < kThreshold ? 32 : 16;
  const kB = compCountB < kThreshold ? 32 : 16;

  return {
    newRatingA: ratingA + kA * (actualA - expectedA),
    newRatingB: ratingB + kB * (actualB - expectedB),
  };
}

/**
 * Replay all comparisons in chronological order from default 1500.
 * Returns fresh gameStats map. This is the authoritative calculation;
 * incremental updates must produce identical results.
 */
export function recalculateAllRatings(
  comparisons: Comparison[],
  kThreshold: number,
): Record<string, TournamentGameStats> {
  const stats: Record<string, TournamentGameStats> = {};

  const getOrCreate = (gameId: string): TournamentGameStats => {
    if (!stats[gameId]) {
      stats[gameId] = { eloRating: 1500, comparisonCount: 0 };
    }
    return stats[gameId];
  };

  // Sort by createdAt to ensure chronological replay
  const sorted = [...comparisons].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  for (const comp of sorted) {
    const statsA = getOrCreate(comp.gameAId);
    const statsB = getOrCreate(comp.gameBId);

    const winnerId: "a" | "b" = comp.winnerId === comp.gameAId ? "a" : "b";

    const { newRatingA, newRatingB } = calculateNewRatings(
      statsA.eloRating,
      statsB.eloRating,
      winnerId,
      statsA.comparisonCount,
      statsB.comparisonCount,
      kThreshold,
    );

    statsA.eloRating = newRatingA;
    statsB.eloRating = newRatingB;
    statsA.comparisonCount++;
    statsB.comparisonCount++;
  }

  return stats;
}

/**
 * Normalize ELO to 1.0-10.0 using a reference window of 1500 ± halfWidth.
 * Formula: clamp(1 + 9 * (elo - (1500 - halfWidth)) / (2 * halfWidth), 1.0, 10.0)
 * Always returns a number. Use shouldDisplayRanking() to decide whether to show the result.
 * Phase 3 composes both to produce TournamentGameStatsDisplay.normalizedScore: number | null.
 */
export function normalizeElo(elo: number, halfWidth: number): number {
  const minElo = 1500 - halfWidth;
  const range = 2 * halfWidth;
  const normalized = 1 + (9 * (elo - minElo)) / range;
  return Math.max(1.0, Math.min(10.0, normalized));
}

/**
 * Returns false when fewer than 5 games have at least one comparison.
 * When false, normalized scores should not be displayed.
 */
export function shouldDisplayRanking(gamesWithComparisons: number): boolean {
  return gamesWithComparisons >= 5;
}
