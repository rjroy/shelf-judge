export type RunScope = "collection" | "wishlist";

export type LiveActivity =
  | { state: "active"; runId: string; scope: RunScope | null }
  | { state: "idle" }
  | { state: "unavailable" };

export type RunProgressSnapshot =
  | {
      state: "saved";
      relation: "active-run" | "historical" | "unknown";
      scope: RunScope | null;
      value: unknown;
    }
  | { state: "none" | "unavailable" };

export type RunStatusSnapshot = { activity: LiveActivity; progress: RunProgressSnapshot };

/** Only live activity can establish run ownership; progress scope is informational. */
export function readLiveActivity(payload: unknown): LiveActivity {
  if (!payload || typeof payload !== "object") return { state: "unavailable" };
  const activity = (payload as { activity?: unknown }).activity;
  if (!activity || typeof activity !== "object") return { state: "unavailable" };

  const value = activity as { state?: unknown; runId?: unknown; scope?: unknown };
  if (value.state === "idle") return { state: "idle" };
  if (value.state === "unavailable") return { state: "unavailable" };
  if (value.state !== "active" || typeof value.runId !== "string" || value.runId.length === 0)
    return { state: "unavailable" };

  return {
    state: "active",
    runId: value.runId,
    scope: value.scope === "collection" || value.scope === "wishlist" ? value.scope : null,
  };
}

export function readRunStatusSnapshot(payload: unknown): RunStatusSnapshot {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const raw = body.progress;
  let progress: RunProgressSnapshot = { state: "unavailable" };
  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    if (value.state === "none") progress = { state: "none" };
    else if (value.state === "unavailable") progress = { state: "unavailable" };
    else if (
      value.state === "saved" &&
      (value.relation === "active-run" ||
        value.relation === "historical" ||
        value.relation === "unknown")
    ) {
      const savedValue =
        value.value && typeof value.value === "object"
          ? (value.value as Record<string, unknown>)
          : null;
      const savedScope = savedValue?.scope;
      progress = {
        state: "saved",
        relation: value.relation,
        scope: savedScope === "collection" || savedScope === "wishlist" ? savedScope : null,
        value: value.value,
      };
    }
  }
  return { activity: readLiveActivity(payload), progress };
}

export function activityLabel(activity: LiveActivity, pageScope: RunScope): string | null {
  if (activity.state !== "active") return null;
  if (activity.scope === pageScope)
    return pageScope === "wishlist"
      ? "Wishlist comparison is running."
      : "Collection comparison is running.";
  if (activity.scope)
    return activity.scope === "wishlist"
      ? "A wishlist comparison is active; it cannot be cancelled from this page."
      : "A collection comparison is active; it cannot be cancelled from this page.";
  return "A comparison is active, but its scope is unknown.";
}

export function progressBelongsToActivity(
  activity: LiveActivity,
  relation: string | undefined,
  progressScope: unknown,
): boolean {
  if (activity.state !== "active" || activity.scope === null || relation !== "active-run")
    return false;
  return progressScope === activity.scope;
}

export function runProgressSummary(value: unknown): string | null {
  const progress = readDisplayRunProgress(value);
  if (!progress) return null;
  return `${progress.completedPairs} of ${progress.pairCount} pairs · ${progress.cacheHits} cached · ${progress.cacheMisses} misses · ${progress.failedPairs} errors · ${progress.state}`;
}

export type DisplayRunProgress = {
  state: string;
  pairCount: number;
  completedPairs: number;
  cacheHits: number;
  cacheMisses: number;
  failedPairs: number;
};

export function readDisplayRunProgress(value: unknown): DisplayRunProgress | null {
  if (!value || typeof value !== "object") return null;
  const progress = value as Record<string, unknown>;
  const keys = ["pairCount", "completedPairs", "cacheHits", "cacheMisses", "failedPairs"] as const;
  if (
    typeof progress.state !== "string" ||
    keys.some((key) => {
      const field = progress[key];
      return typeof field !== "number" || !Number.isSafeInteger(field) || field < 0;
    })
  )
    return null;
  return {
    state: progress.state,
    pairCount: Number(progress.pairCount),
    completedPairs: Number(progress.completedPairs),
    cacheHits: Number(progress.cacheHits),
    cacheMisses: Number(progress.cacheMisses),
    failedPairs: Number(progress.failedPairs),
  };
}
