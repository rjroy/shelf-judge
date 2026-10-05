import { describe, expect, test } from "bun:test";
import type { JevPairCache, JevRunProgress } from "../src/services/jev-pair-cache-service.js";
import { createJevRefreshProgressService } from "../src/services/jev-refresh-progress-service.js";

const saved: JevRunProgress = {
  runId: "private-run-id",
  state: "running",
  pairCount: 7,
  completedPairs: 3,
  cacheHits: 1,
  cacheMisses: 2,
  failedPairs: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function fakeCache(overrides: Record<string, unknown> = {}) {
  const calls = { progress: 0, lookup: 0, revision: 0 };
  const cache = {
    available: true,
    mutationRevision: () => {
      calls.revision++;
      return 1;
    },
    lookup: () => {
      calls.lookup++;
      return null;
    },
    getRunProgressRead: () => {
      calls.progress++;
      return { status: "available", progress: saved };
    },
    ...overrides,
  } as unknown as JevPairCache;
  return { cache, calls };
}

describe("Jev refresh progress", () => {
  test("returns live scope with projected progress and never exposes historical run IDs", () => {
    const { cache, calls } = fakeCache();
    let activeReads = 0;
    const service = createJevRefreshProgressService({
      cache,
      activeRun: () => {
        activeReads++;
        return { runId: "private-run-id", scope: "wishlist" };
      },
    });

    const result = service.read();
    expect(result).toEqual({
      coverageMeasurement: "not-measured",
      activity: { state: "active", runId: "private-run-id", scope: "wishlist" },
      progress: {
        state: "saved",
        relation: "active-run",
        value: {
          state: "last-known-running",
          pairCount: 7,
          completedPairs: 3,
          cacheHits: 1,
          cacheMisses: 2,
          failedPairs: 0,
        },
      },
    });
    expect(JSON.stringify(result.progress)).not.toContain("private-run-id");
    expect(calls).toEqual({ progress: 1, lookup: 0, revision: 0 });
    expect(activeReads).toBe(2);
  });

  test("distinguishes no checkpoint and restart history from a matching active run", () => {
    const empty = fakeCache({ getRunProgressRead: () => ({ status: "none" }) });
    expect(
      createJevRefreshProgressService({ cache: empty.cache, activeRun: () => null }).read(),
    ).toEqual({
      coverageMeasurement: "not-measured",
      activity: { state: "idle" },
      progress: { state: "none" },
    });

    const restarted = fakeCache();
    const result = createJevRefreshProgressService({
      cache: restarted.cache,
      activeRun: () => null,
    }).read();
    expect(result.activity).toEqual({ state: "idle" });
    expect(result.progress).toMatchObject({ state: "saved", relation: "historical" });
  });

  test("mismatched association is historical and checkpoint changes do not hide saved progress", () => {
    const stale = fakeCache();
    expect(
      createJevRefreshProgressService({
        cache: stale.cache,
        activeRun: () => ({ runId: "different-run" }),
      }).read().progress,
    ).toMatchObject({ state: "saved", relation: "historical" });

    let reads = 0;
    const mutating = fakeCache({
      getRunProgressRead: () => {
        reads++;
        return { status: "available", progress: { ...saved, completedPairs: reads } };
      },
    });
    const result = createJevRefreshProgressService({
      cache: mutating.cache,
      activeRun: () => null,
    }).read();
    expect(result).toMatchObject({
      coverageMeasurement: "not-measured",
      activity: { state: "idle" },
      progress: { state: "saved", value: { completedPairs: 1 } },
    });
    expect(mutating.calls.progress).toBe(0);
    expect(mutating.calls.revision).toBe(0);
    expect(reads).toBe(1);
  });

  test("historical progress cannot supply live scope and scope replacement between reads fails closed", () => {
    const historical = fakeCache();
    const historicalResult = createJevRefreshProgressService({
      cache: historical.cache,
      activeRun: () => null,
    }).read();
    expect(historicalResult.activity).toEqual({ state: "idle" });
    expect(historicalResult.progress).toMatchObject({ state: "saved", relation: "historical" });
    expect(historicalResult.activity).not.toHaveProperty("scope");

    let reads = 0;
    const replaced = fakeCache();
    const result = createJevRefreshProgressService({
      cache: replaced.cache,
      activeRun: () => {
        reads++;
        return reads === 1
          ? { runId: "same-run-id", scope: "collection" }
          : { runId: "same-run-id", scope: "wishlist" };
      },
    }).read();
    expect(result.activity).toEqual({ state: "unavailable" });
    expect(result.progress).toEqual({ state: "unavailable" });
  });

  test("invalid saved progress remains distinct from a genuinely empty cache", () => {
    const { cache } = fakeCache({ getRunProgressRead: () => ({ status: "invalid" }) });
    expect(
      createJevRefreshProgressService({ cache, activeRun: () => null }).read().progress,
    ).toEqual({ state: "unavailable" });
  });
});
