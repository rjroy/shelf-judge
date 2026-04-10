// Pure migration functions for tournament data format.
// Converts pre-migration format (top-level comparisons array) to post-migration format
// (per-game cached stats, session-scoped comparisons). No I/O, no service dependencies.

import type {
  TournamentData,
  CachedRecentComparison,
  Comparison,
  TournamentGameStats,
  TournamentSession,
} from "@shelf-judge/shared";

const RECENT_COMPARISONS_CAP = 10;

interface MigrationResult {
  data: TournamentData;
  migrated: boolean;
}

/**
 * Migrate tournament data from pre-migration format to post-migration format.
 * Pre-migration: top-level `comparisons` array, gameStats without wins/losses/recentComparisons,
 *                sessions without comparisons field.
 * Post-migration: no top-level comparisons, gameStats with cached stats,
 *                 active session holds its own comparisons.
 *
 * Idempotent: already-migrated data passes through unchanged.
 *
 * Caller must validate the returned data with TournamentDataSchema. The non-migration
 * path returns raw data without structural verification.
 */
export function migrateTournamentData(raw: Record<string, unknown>): MigrationResult {
  const topComparisons = raw.comparisons;

  // If no top-level comparisons array, data is already migrated (or fresh)
  if (!Array.isArray(topComparisons)) {
    return { data: raw as unknown as TournamentData, migrated: false };
  }

  const comparisons = topComparisons as Comparison[];
  const sessions = (raw.sessions ?? []) as TournamentSession[];
  const existingStats = (raw.gameStats ?? {}) as Record<string, TournamentGameStats>;

  // Build per-game win/loss counts and recent comparisons from the full history
  const winsMap = new Map<string, number>();
  const lossesMap = new Map<string, number>();
  const recentMap = new Map<string, CachedRecentComparison[]>();

  // Sort chronologically (oldest first) so we process in order
  const sorted = [...comparisons].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  for (const comp of sorted) {
    const winnerId = comp.winnerId;
    const loserId = comp.gameAId === winnerId ? comp.gameBId : comp.gameAId;

    // Skip comparisons where both games lack gameStats entries (deleted games)
    if (!(comp.gameAId in existingStats) && !(comp.gameBId in existingStats)) {
      continue;
    }

    winsMap.set(winnerId, (winsMap.get(winnerId) ?? 0) + 1);
    lossesMap.set(loserId, (lossesMap.get(loserId) ?? 0) + 1);

    // Push recent comparison entries for both games
    if (!recentMap.has(winnerId)) recentMap.set(winnerId, []);
    recentMap.get(winnerId)!.push({
      opponentGameId: loserId,
      won: true,
      createdAt: comp.createdAt,
    });

    if (!recentMap.has(loserId)) recentMap.set(loserId, []);
    recentMap.get(loserId)!.push({
      opponentGameId: winnerId,
      won: false,
      createdAt: comp.createdAt,
    });
  }

  // Build migrated gameStats: preserve ELO and comparisonCount, add wins/losses/recentComparisons
  const migratedStats: Record<string, TournamentGameStats> = {};
  for (const [gameId, stats] of Object.entries(existingStats)) {
    const recent = recentMap.get(gameId) ?? [];
    // Sort most-recent-first, then cap at 10
    recent.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    migratedStats[gameId] = {
      eloRating: stats.eloRating,
      comparisonCount: stats.comparisonCount,
      wins: winsMap.get(gameId) ?? 0,
      losses: lossesMap.get(gameId) ?? 0,
      recentComparisons: recent.slice(0, RECENT_COMPARISONS_CAP),
    };
  }

  // Find the active session (if any) and collect its comparisons by sessionId
  const activeSessionId = sessions.find((s) => s.status === "active")?.id;
  const activeComparisons = activeSessionId
    ? comparisons.filter((c) => c.sessionId === activeSessionId)
    : [];

  // Build migrated sessions: all get comparisons: [], active one gets its comparisons
  const migratedSessions: TournamentSession[] = sessions.map((s) => ({
    ...s,
    comparisons: s.id === activeSessionId ? activeComparisons : [],
  }));

  const data: TournamentData = {
    settings: raw.settings as TournamentData["settings"],
    sessions: migratedSessions,
    gameStats: migratedStats,
  };

  return { data, migrated: true };
}
