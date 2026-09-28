const BGG_DATA_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface BggFreshnessSource {
  bggData?: { fetchedAt?: unknown } | null;
}

export interface CollectionSnapshotTimePolicy {
  /** Earliest future instant at which any currently-fresh BGG record becomes stale. */
  nextBggDataStaleTransition(
    games: readonly BggFreshnessSource[],
    evaluatedAtMs?: number,
  ): number | null;
}

/**
 * Build the time-dependent portion of snapshot freshness policy.
 * The stale predicate is `now - fetchedAt > 7 days`, so its first stale
 * millisecond is fetchedAt + 7 days + 1. Invalid/missing fetch times do not
 * schedule a transition; they are not treated as fresh evidence.
 *
 * The clock is sampled per call unless an evaluation instant is supplied. If
 * wall time moves backward, this recomputes from that time rather than
 * retaining a monotonic deadline from a previous call.
 */
export function createCollectionSnapshotTimePolicy(clock: {
  now(): number;
}): CollectionSnapshotTimePolicy {
  return {
    nextBggDataStaleTransition(games, evaluatedAtMs) {
      const now = evaluatedAtMs ?? clock.now();
      if (!Number.isFinite(now)) return null;

      let nextTransition: number | null = null;
      for (const game of games) {
        const fetchedAt = game.bggData?.fetchedAt;
        if (typeof fetchedAt !== "string" || fetchedAt.length === 0) continue;
        const fetchedAtMs = Date.parse(fetchedAt);
        if (!Number.isFinite(fetchedAtMs)) continue;

        const transition = fetchedAtMs + BGG_DATA_STALE_AFTER_MS + 1;
        if (!Number.isSafeInteger(transition) || transition <= now) continue;
        if (nextTransition === null || transition < nextTransition) nextTransition = transition;
      }
      return nextTransition;
    },
  };
}
