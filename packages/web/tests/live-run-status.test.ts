import { describe, expect, test } from "bun:test";
import {
  activityLabel,
  progressBelongsToActivity,
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
});
