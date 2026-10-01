import type { JevPairCoverageDigest, JevPairSignalCoverage } from "./jev-pair-coverage.js";
import type { JevPairReadResult } from "./jev-pair-read-service.js";
import type { JevRunProgress } from "./jev-pair-cache-service.js";

export interface JevSignalCoverageCounts {
  covered: number;
  missing: number;
  invalid: number;
  unavailable: number;
  blocked: number;
}

export interface JevPairStatus {
  status: JevPairReadResult["status"];
  eligibleGameCount: number;
  pairCount: number;
  coverage: {
    C: JevSignalCoverageCounts;
    D: JevSignalCoverageCounts;
  };
  /** Last persisted progress only; this projection does not assert a run is currently active. */
  progress: null | {
    state: "last-known-running" | "completed" | "interrupted" | "failed";
    pairCount: number;
    completedPairs: number;
    cacheHits: number;
    cacheMisses: number;
    failedPairs: number;
  };
}

function emptyCounts(): JevSignalCoverageCounts {
  return { covered: 0, missing: 0, invalid: 0, unavailable: 0, blocked: 0 };
}

function countState(counts: JevSignalCoverageCounts, coverage: JevPairSignalCoverage): void {
  switch (coverage.state) {
    case "covered":
      counts.covered++;
      break;
    case "missing-row":
      counts.missing++;
      break;
    case "invalid-row":
      counts.invalid++;
      break;
    case "unavailable":
      counts.unavailable++;
      break;
    case "blocked":
      counts.blocked++;
      break;
  }
}

function isValidProgress(progress: JevRunProgress): boolean {
  const counters = [
    progress.pairCount,
    progress.completedPairs,
    progress.cacheHits,
    progress.cacheMisses,
    progress.failedPairs,
  ];
  return (
    ["running", "completed", "interrupted", "failed"].includes(progress.state) &&
    counters.every((counter) => Number.isSafeInteger(counter) && counter >= 0) &&
    progress.completedPairs <= progress.pairCount
  );
}

function projectedProgress(progress: JevRunProgress | null): JevPairStatus["progress"] {
  if (!progress || !isValidProgress(progress)) return null;
  return {
    // A persisted "running" marker can survive a restart; never present it as a live run.
    state: progress.state === "running" ? "last-known-running" : progress.state,
    pairCount: progress.pairCount,
    completedPairs: progress.completedPairs,
    cacheHits: progress.cacheHits,
    cacheMisses: progress.cacheMisses,
    failedPairs: progress.failedPairs,
  };
}

/** Projects validated internal read inputs into a compact aggregate-only status object. */
export function projectJevPairStatus(input: {
  coverage: JevPairCoverageDigest;
  readResult: JevPairReadResult;
  progress: JevRunProgress | null;
  cacheAvailable: boolean;
}): JevPairStatus {
  const C = emptyCounts();
  const D = emptyCounts();
  for (const pair of input.coverage.pairs) {
    countState(C, pair.C);
    countState(D, pair.D);
  }

  const hasBlockedCoverage = input.coverage.pairs.some(
    (pair) => pair.C.state === "blocked" || pair.D.state === "blocked",
  );
  const hasInvalidCoverage = input.coverage.pairs.some(
    (pair) => pair.C.state === "invalid-row" || pair.D.state === "invalid-row",
  );
  const status =
    input.readResult.status !== "ready"
      ? !input.cacheAvailable && input.readResult.status === "stale"
        ? "not-ready"
        : input.readResult.status
      : !input.cacheAvailable || hasBlockedCoverage
        ? "not-ready"
        : hasInvalidCoverage
          ? "stale"
          : input.coverage.complete
            ? "ready"
            : "not-ready";
  return {
    status,
    eligibleGameCount: input.coverage.eligibleGameIds.length,
    pairCount: input.coverage.pairs.length,
    coverage: { C, D },
    progress: projectedProgress(input.progress),
  };
}
