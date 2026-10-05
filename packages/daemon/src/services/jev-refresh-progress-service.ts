import type { JevPairCache } from "./jev-pair-cache-service.js";
import { projectJevRunProgress, type JevStatusProgress } from "./jev-pair-status.js";

export type JevRefreshProgressResponse = {
  coverageMeasurement: "not-measured";
  activity:
    | { state: "active"; runId: string; scope?: "collection" | "wishlist" }
    | { state: "idle" }
    | { state: "unavailable" };
  progress:
    | { state: "none" }
    | { state: "unavailable" }
    | {
        state: "saved";
        relation: "active-run" | "historical" | "unknown";
        value: Exclude<JevStatusProgress, null>;
      };
};

/** Synchronous cache/controller-only read; deliberately does not inspect coverage or sources. */
export function createJevRefreshProgressService(options: {
  cache: JevPairCache | null;
  activeRun?: () => { runId: string; scope?: "collection" | "wishlist" } | null;
}) {
  function read(): JevRefreshProgressResponse {
    const unavailable = (): JevRefreshProgressResponse => ({
      coverageMeasurement: "not-measured",
      activity: { state: "unavailable" },
      progress: { state: "unavailable" },
    });
    const cache = options.cache;
    if (!cache?.available) return unavailable();
    try {
      const activityBefore = options.activeRun?.() ?? null;
      const saved = cache.getRunProgressRead();
      const activityAfter = options.activeRun?.() ?? null;
      // If the process-local run changed around the singleton read, its association is ambiguous.
      if (
        activityBefore?.runId !== activityAfter?.runId ||
        activityBefore?.scope !== activityAfter?.scope
      )
        return unavailable();
      const activity = options.activeRun
        ? activityAfter
          ? {
              state: "active" as const,
              runId: activityAfter.runId,
              ...(activityAfter.scope ? { scope: activityAfter.scope } : {}),
            }
          : { state: "idle" as const }
        : { state: "unavailable" as const };
      if (saved.status === "unavailable" || saved.status === "invalid") return unavailable();
      if (saved.status === "none") {
        return { coverageMeasurement: "not-measured", activity, progress: { state: "none" } };
      }
      if (saved.status !== "available") return unavailable();
      const value = projectJevRunProgress(saved.progress);
      if (!value) return unavailable();
      const relation = !options.activeRun
        ? "unknown"
        : !activityAfter
          ? "historical"
          : activityAfter.runId === saved.progress.runId
            ? "active-run"
            : "historical";
      return {
        coverageMeasurement: "not-measured",
        activity,
        progress: { state: "saved", relation, value },
      };
    } catch {
      return unavailable();
    }
  }
  return { read };
}
