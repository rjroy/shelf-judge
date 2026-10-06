import type { JevRefreshProgressResponse } from "@shelf-judge/shared";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import { projectJevRunProgress } from "./jev-pair-status.js";
import type { JevRunCompletion } from "./jev-run-service.js";

export type { JevRefreshProgressResponse } from "@shelf-judge/shared";

/** Synchronous cache/controller-only read; deliberately does not inspect coverage or sources. */
export function createJevRefreshProgressService(options: {
  cache: JevPairCache | null;
  activeRun?: () => { runId: string; scope?: "collection" | "wishlist" } | null;
  processPendingProgress?: () => JevRunCompletion | null;
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
      const processPending = options.processPendingProgress?.() ?? null;
      const saved = cache.getRunProgressRead();
      const activityAfter = options.activeRun?.() ?? null;
      const batch = cache.getRunBatch?.() ?? null;
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
      const processPendingOwned =
        processPending?.publication.state === "pending" &&
        processPending.publication.outcomePersistence === "unpersisted" &&
        batch?.runId === processPending.runId;
      if (processPendingOwned && processPending) {
        const value = projectJevRunProgress(processPending);
        if (!value) return unavailable();
        return {
          coverageMeasurement: "not-measured",
          activity,
          progress: { state: "process-local", value, retryRunId: processPending.runId },
        };
      }
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
      const savedPublication = saved.progress.publication;
      const retryableSavedBatch =
        batch?.state === "sealed" &&
        batch.runId === saved.progress.runId &&
        saved.progress.state !== "running" &&
        (savedPublication === undefined ||
          (savedPublication.state === "pending" &&
            savedPublication.outcomePersistence === "sealed"));
      return {
        coverageMeasurement: "not-measured",
        activity,
        progress: {
          state: "saved",
          relation,
          value,
          ...(retryableSavedBatch ? { retryRunId: saved.progress.runId } : {}),
        },
      };
    } catch {
      return unavailable();
    }
  }
  return { read };
}
