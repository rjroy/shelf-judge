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
      retryRunId?: string;
    }
  | { state: "process-local"; value: unknown; retryRunId: string }
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
        ...(typeof value.retryRunId === "string" && value.retryRunId.length > 0
          ? { retryRunId: value.retryRunId }
          : {}),
      };
    } else if (
      value.state === "process-local" &&
      value.value &&
      typeof value.value === "object" &&
      typeof value.retryRunId === "string" &&
      value.retryRunId.length > 0
    ) {
      progress = { state: "process-local", value: value.value, retryRunId: value.retryRunId };
    }
  }
  return { activity: readLiveActivity(payload), progress };
}

export type PublicRunPublication = {
  state: "published" | "unchanged" | "pending";
  phase?: "seal" | "validate" | "promote";
  outcomePersistence: "sealed" | "finalized" | "unpersisted";
  reason?: string;
};

export function readRunPublication(value: unknown): PublicRunPublication | null {
  if (!value || typeof value !== "object") return null;
  const publication = (value as Record<string, unknown>).publication;
  if (!publication || typeof publication !== "object") return null;
  const raw = publication as Record<string, unknown>;
  const validPersistence =
    raw.outcomePersistence === "sealed" ||
    raw.outcomePersistence === "finalized" ||
    raw.outcomePersistence === "unpersisted";
  if (!validPersistence || (raw.reason !== undefined && typeof raw.reason !== "string"))
    return null;
  if (raw.state === "pending") {
    if (raw.phase !== "seal" && raw.phase !== "validate" && raw.phase !== "promote") return null;
    return {
      state: "pending",
      phase: raw.phase,
      outcomePersistence: raw.outcomePersistence as PublicRunPublication["outcomePersistence"],
      ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
    };
  }
  if (
    (raw.state !== "published" && raw.state !== "unchanged") ||
    raw.phase !== undefined ||
    raw.outcomePersistence !== "finalized"
  )
    return null;
  return {
    state: raw.state,
    outcomePersistence: "finalized",
    ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
  };
}

export function publicationState(value: unknown): PublicRunPublication["state"] | null {
  return readRunPublication(value)?.state ?? null;
}

export function publicationRetryRunId(progress: RunProgressSnapshot): string | null {
  if (
    (progress.state === "saved" || progress.state === "process-local") &&
    typeof progress.retryRunId === "string" &&
    progress.retryRunId.length > 0
  )
    return progress.retryRunId;
  return null;
}

export function publicationAllowsScoreRefresh(value: unknown): boolean {
  const state = publicationState(value);
  return state === "published" || state === "unchanged";
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
