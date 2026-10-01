import { describe, expect, test } from "bun:test";
import type { JevPairCoverageDigest } from "../../src/services/jev-pair-coverage.js";
import type { JevPairReadResult } from "../../src/services/jev-pair-read-service.js";
import type { JevRunProgress } from "../../src/services/jev-pair-cache-service.js";
import { projectJevPairStatus } from "../../src/services/jev-pair-status.js";

const covered = { state: "covered", rowIdentity: "private-row-id", score: 0.75 } as const;
const mixedIncompleteDigest = {
  version: "jev-activation-coverage-v4",
  complete: false,
  identity: "private-fingerprint",
  eligibleGameIds: ["private-game-a", "private-game-b", "private-game-c"],
  pairs: [
    {
      gameAId: "private-game-a",
      gameBId: "private-game-b",
      factualScore: 0.2,
      C: covered,
      D: { state: "missing-row" },
    },
    {
      gameAId: "private-game-a",
      gameBId: "private-game-c",
      factualScore: 0.3,
      C: { state: "invalid-row" },
      D: { state: "unavailable", reason: "missing-source" },
    },
    {
      gameAId: "private-game-b",
      gameBId: "private-game-c",
      factualScore: 0.4,
      C: { state: "unavailable", reason: "zero-weight" },
      D: { state: "blocked", reason: "note-use-not-permitted" },
    },
  ],
} as unknown as JevPairCoverageDigest;

const completeDigest = {
  version: "jev-activation-coverage-v4",
  complete: true,
  identity: "private-complete-fingerprint",
  eligibleGameIds: ["private-ready-a", "private-ready-b"],
  pairs: [
    {
      gameAId: "private-ready-a",
      gameBId: "private-ready-b",
      factualScore: 0.2,
      C: covered,
      D: covered,
    },
  ],
} as unknown as JevPairCoverageDigest;

const ready = {
  status: "ready",
  summary: "Semantic redundancy is ready.",
  table: { status: "ready", identity: {}, expectedIdentity: {}, weights: {}, pairs: [] },
} as unknown as JevPairReadResult;
const progress: JevRunProgress = {
  runId: "private-run-id",
  state: "running",
  pairCount: 5,
  completedPairs: 3,
  cacheHits: 1,
  cacheMisses: 2,
  failedPairs: 1,
  updatedAt: "private-time",
};

describe("projectJevPairStatus", () => {
  test("projects ready status and aggregate C/D counts without detail", () => {
    const result = projectJevPairStatus({
      coverage: completeDigest,
      readResult: ready,
      progress,
      cacheAvailable: true,
    });

    expect(result).toEqual({
      status: "ready",
      eligibleGameCount: 2,
      pairCount: 1,
      coverage: {
        C: { covered: 1, missing: 0, invalid: 0, unavailable: 0, blocked: 0 },
        D: { covered: 1, missing: 0, invalid: 0, unavailable: 0, blocked: 0 },
      },
      progress: {
        state: "last-known-running",
        pairCount: 5,
        completedPairs: 3,
        cacheHits: 1,
        cacheMisses: 2,
        failedPairs: 1,
      },
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      "private-row-id",
      "private-fingerprint",
      "private-ready-a",
      "private-run-id",
      "private-time",
      "0.75",
      "PRIVATE NOTE",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  test("aggregates mixed incomplete coverage and downgrades contradictory ready results", () => {
    const result = projectJevPairStatus({
      coverage: mixedIncompleteDigest,
      readResult: ready,
      progress: null,
      cacheAvailable: true,
    });
    expect(result.status).toBe("not-ready");
    expect(result.coverage).toEqual({
      C: { covered: 1, missing: 0, invalid: 1, unavailable: 1, blocked: 0 },
      D: { covered: 0, missing: 1, invalid: 0, unavailable: 1, blocked: 1 },
    });

    const invalidOnly = {
      ...mixedIncompleteDigest,
      pairs: [mixedIncompleteDigest.pairs[1]],
    } as JevPairCoverageDigest;
    expect(
      projectJevPairStatus({
        coverage: invalidOnly,
        readResult: ready,
        progress: null,
        cacheAvailable: true,
      }).status,
    ).toBe("stale");
  });

  test("preserves not-ready/stale fallbacks and does not claim cached progress is active", () => {
    for (const status of ["not-ready", "stale"] as const) {
      const result = projectJevPairStatus({
        coverage: mixedIncompleteDigest,
        readResult: { status, summary: "fallback" },
        progress: { ...progress, state: "interrupted" },
        cacheAvailable: true,
      });
      expect(result.status).toBe(status);
      expect(result.progress?.state).toBe("interrupted");
    }
  });

  test("downgrades a ready read when cache availability says the cache is missing", () => {
    const result = projectJevPairStatus({
      coverage: completeDigest,
      readResult: ready,
      progress: null,
      cacheAvailable: false,
    });
    expect(result.status).toBe("not-ready");
    expect(result.progress).toBeNull();
  });

  test("omits malformed or impossible persisted progress", () => {
    const malformed: unknown[] = [
      { ...progress, completedPairs: 6 },
      { ...progress, cacheHits: -1 },
      { ...progress, pairCount: 1.5 },
      { ...progress, failedPairs: Number.NaN },
      { ...progress, state: "active" },
    ];
    for (const persisted of malformed) {
      const result = projectJevPairStatus({
        coverage: completeDigest,
        readResult: ready,
        progress: persisted as JevRunProgress,
        cacheAvailable: true,
      });
      expect(result.progress).toBeNull();
    }
  });

  test("retains two-signal misses and a failure before any pair completes", () => {
    const result = projectJevPairStatus({
      coverage: completeDigest,
      readResult: ready,
      progress: {
        ...progress,
        state: "failed",
        pairCount: 1,
        completedPairs: 0,
        cacheHits: 0,
        cacheMisses: 2,
        failedPairs: 1,
      },
      cacheAvailable: true,
    });

    expect(result.progress).toEqual({
      state: "failed",
      pairCount: 1,
      completedPairs: 0,
      cacheHits: 0,
      cacheMisses: 2,
      failedPairs: 1,
    });
  });
});
