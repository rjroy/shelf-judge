import { describe, expect, test } from "bun:test";
import {
  activityLabel,
  progressBelongsToActivity,
  publicationState,
  publicationAllowsScoreRefresh,
  readRunPublication,
  readRunStatusSnapshot,
  runProgressSummary,
} from "@/lib/live-run-status";

describe("live run scope", () => {
  test("uses only authoritative active activity for scope and ownership", () => {
    const status = readRunStatusSnapshot({
      activity: { state: "active", runId: "w-1", scope: "wishlist" },
      progress: {
        state: "saved",
        relation: "active-run",
        value: { scope: "wishlist", state: "last-known-running" },
      },
    });
    expect(status.activity).toEqual({ state: "active", runId: "w-1", scope: "wishlist" });
    expect(activityLabel(status.activity, "wishlist")).toBe("Wishlist comparison is running.");
    expect(progressBelongsToActivity(status.activity, "active-run", "wishlist")).toBe(true);
    expect(progressBelongsToActivity(status.activity, "active-run", "collection")).toBe(false);
    expect(status.progress.state === "saved" && status.progress.scope).toBe("wishlist");
  });

  test("legacy active responses and invalid activity never acquire a scoped cancellation authority", () => {
    expect(
      readRunStatusSnapshot({
        activity: { state: "active", runId: "legacy" },
        progress: {
          state: "saved",
          relation: "active-run",
          value: { scope: "wishlist", state: "last-known-running" },
        },
      }).activity,
    ).toEqual({ state: "active", runId: "legacy", scope: null });
    expect(activityLabel({ state: "active", runId: "legacy", scope: null }, "wishlist")).toContain(
      "scope is unknown",
    );
    expect(readRunStatusSnapshot({ activity: { state: "active" } }).activity).toEqual({
      state: "unavailable",
    });
  });

  test("historical progress and unknown relations cannot describe a live run", () => {
    const active = { state: "active", runId: "new", scope: "collection" } as const;
    expect(progressBelongsToActivity(active, "historical", "collection")).toBe(false);
    expect(progressBelongsToActivity(active, "unknown", "collection")).toBe(false);
    expect(progressBelongsToActivity(active, "active-run", "wishlist")).toBe(false);
    const summary = runProgressSummary({
      state: "completed",
      pairCount: 4,
      completedPairs: 4,
      cacheHits: 1,
      cacheMisses: 3,
      failedPairs: 0,
    });
    expect(summary).toContain("4 of 4 pairs");
    expect(runProgressSummary({ state: "completed", pairCount: "4" })).toBeNull();
  });

  test("reads scope from the production nested progress value and rejects envelope scope", () => {
    const activity = { state: "active", runId: "c-1", scope: "collection" } as const;
    const nested = readRunStatusSnapshot({
      activity,
      progress: {
        state: "saved",
        relation: "active-run",
        value: { scope: "collection", state: "last-known-running" },
      },
    });
    expect(nested.progress.state === "saved" && nested.progress.scope).toBe("collection");
    expect(
      progressBelongsToActivity(
        activity,
        "active-run",
        nested.progress.state === "saved" ? nested.progress.scope : null,
      ),
    ).toBe(true);

    const envelopeOnly = readRunStatusSnapshot({
      activity,
      progress: {
        state: "saved",
        relation: "active-run",
        scope: "collection",
        value: { state: "last-known-running" },
      },
    });
    expect(envelopeOnly.progress.state === "saved" && envelopeOnly.progress.scope).toBeNull();
    expect(progressBelongsToActivity(activity, "active-run", null)).toBe(false);
  });

  test("status loss and idle are distinct snapshots", () => {
    expect(readRunStatusSnapshot({ activity: { state: "unavailable" } }).activity).toEqual({
      state: "unavailable",
    });
    expect(readRunStatusSnapshot({ activity: { state: "idle" } }).activity).toEqual({
      state: "idle",
    });
  });

  test("preserves pending publication retry authority without confusing idle for completion", () => {
    const saved = readRunStatusSnapshot({
      activity: { state: "idle" },
      coverageMeasurement: "not-measured",
      progress: {
        state: "saved",
        relation: "historical",
        retryRunId: "r-1",
        value: {
          state: "failed",
          stopReason: "owner-cancelled",
          publication: { state: "pending", phase: "validate", outcomePersistence: "sealed" },
        },
      },
    });
    expect(saved.progress.state).toBe("saved");
    if (saved.progress.state === "saved") {
      expect(saved.progress.retryRunId).toBe("r-1");
      expect(publicationState(saved.progress.value)).toBe("pending");
    }
    const local = readRunStatusSnapshot({
      activity: { state: "idle" },
      progress: {
        state: "process-local",
        retryRunId: "r-2",
        value: {
          state: "failed",
          publication: { state: "pending", phase: "seal", outcomePersistence: "unpersisted" },
        },
      },
    });
    expect(local.progress.state).toBe("process-local");
    expect(
      publicationState(local.progress.state === "process-local" ? local.progress.value : null),
    ).toBe("pending");
    expect(publicationState({ state: "completed" })).toBeNull();
    expect(
      publicationAllowsScoreRefresh({
        publication: { state: "pending", phase: "promote", outcomePersistence: "sealed" },
      }),
    ).toBe(false);
    expect(
      publicationAllowsScoreRefresh({
        publication: { state: "published", outcomePersistence: "finalized" },
      }),
    ).toBe(true);
    expect(
      publicationAllowsScoreRefresh({
        publication: { state: "unchanged", outcomePersistence: "finalized" },
      }),
    ).toBe(true);
    expect(
      readRunPublication({
        publication: { state: "pending", phase: "promote", outcomePersistence: "sealed" },
      }),
    ).toEqual({ state: "pending", phase: "promote", outcomePersistence: "sealed" });
    expect(
      readRunPublication({ publication: { state: "pending", outcomePersistence: "sealed" } }),
    ).toBeNull();
    expect(
      readRunPublication({ publication: { state: "published", outcomePersistence: "finalized" } }),
    ).toEqual({ state: "published", outcomePersistence: "finalized" });
    expect(readRunPublication({ publication: { state: "published" } })).toBeNull();
    expect(
      readRunStatusSnapshot({
        activity: { state: "idle" },
        progress: { state: "process-local", value: {} },
      }).progress.state,
    ).toBe("unavailable");
  });

  test("parses publication from the complete retry completion response", () => {
    const completion = (publication: unknown) => ({
      runId: "retry-run-1",
      state: "failed",
      scope: "collection",
      pairCount: 2,
      completedPairs: 1,
      cacheHits: 0,
      cacheMisses: 2,
      failedPairs: 0,
      stopReason: "application-attempt-limit",
      updatedAt: "2026-10-05T00:00:00.000Z",
      publication,
    });

    expect(
      readRunPublication(
        completion({ state: "pending", phase: "promote", outcomePersistence: "sealed" }),
      ),
    ).toEqual({ state: "pending", phase: "promote", outcomePersistence: "sealed" });
    expect(
      readRunPublication(completion({ state: "published", outcomePersistence: "finalized" })),
    ).toEqual({ state: "published", outcomePersistence: "finalized" });
    expect(
      readRunPublication(completion({ state: "unchanged", outcomePersistence: "finalized" })),
    ).toEqual({ state: "unchanged", outcomePersistence: "finalized" });
    expect(readRunPublication(completion({ state: "published" }))).toBeNull();
    expect(readRunPublication({ publication: completion({ state: "published" }) })).toBeNull();
  });
});
