import type { JevPairCoverageDigest, JevPairSignalCoverage } from "./jev-pair-coverage.js";
import type { JevPairReadResult } from "./jev-pair-read-service.js";
import type { JevRunProgress, JevRunStopReason } from "./jev-pair-cache-service.js";

export interface JevSignalCoverageCounts {
  covered: number;
  missing: number;
  invalid: number;
  unavailable: number;
  blocked: number;
}

export type JevStatusState =
  | "disabled"
  | "factual"
  | "not-ready"
  | "stale"
  | "ready"
  | "unavailable";
export type JevStatusProgress = null | {
  state: "last-known-running" | "completed" | "interrupted" | "failed";
  pairCount: number;
  completedPairs: number;
  cacheHits: number;
  cacheMisses: number;
  failedPairs: number;
  stopReason?: JevRunStopReason;
};

interface JevStatusBase {
  status: JevStatusState;
  progress: JevStatusProgress;
}

export type JevStatusResponse =
  | (JevStatusBase & {
      measurement: "current";
      eligibleGameCount: number;
      pairCount: number;
      coverage: { C: JevSignalCoverageCounts; D: JevSignalCoverageCounts };
    })
  | (JevStatusBase & {
      measurement: "not-applicable" | "cache-unavailable" | "source-unavailable";
      eligibleGameCount: null;
      pairCount: null;
      coverage: null;
    });

function emptyCounts(): JevSignalCoverageCounts {
  return { covered: 0, missing: 0, invalid: 0, unavailable: 0, blocked: 0 };
}

function countState(counts: JevSignalCoverageCounts, coverage: JevPairSignalCoverage): void {
  counts[
    coverage.state === "missing-row"
      ? "missing"
      : coverage.state === "invalid-row"
        ? "invalid"
        : coverage.state
  ]++;
}

function projectedProgress(progress: JevRunProgress | null): JevStatusProgress {
  if (!progress) return null;
  const counters = [
    progress.pairCount,
    progress.completedPairs,
    progress.cacheHits,
    progress.cacheMisses,
    progress.failedPairs,
  ];
  if (
    !(
      ["running", "completed", "interrupted", "failed"].includes(progress.state) &&
      counters.every((n) => Number.isSafeInteger(n) && n >= 0) &&
      progress.completedPairs <= progress.pairCount
    )
  )
    return null;
  if (
    progress.stopReason !== undefined &&
    (![
      "provider-limit",
      "provider-unconfigured",
      "application-attempt-limit",
      "application-token-threshold",
      "application-deadline",
    ].some((reason) => reason === progress.stopReason) ||
      progress.state !== "failed")
  )
    return null;
  return {
    state: progress.state === "running" ? "last-known-running" : progress.state,
    pairCount: progress.pairCount,
    completedPairs: progress.completedPairs,
    cacheHits: progress.cacheHits,
    cacheMisses: progress.cacheMisses,
    failedPairs: progress.failedPairs,
    ...(progress.stopReason ? { stopReason: progress.stopReason } : {}),
  };
}

export function projectJevPairStatus(input: {
  coverage: JevPairCoverageDigest;
  readResult: JevPairReadResult;
  progress: JevRunProgress | null;
  cacheAvailable: boolean;
}): JevStatusResponse {
  const C = emptyCounts();
  const D = emptyCounts();
  for (const pair of input.coverage.pairs) {
    countState(C, pair.C);
    countState(D, pair.D);
  }
  const hasBlocked = input.coverage.pairs.some(
    (pair) => pair.C.state === "blocked" || pair.D.state === "blocked",
  );
  const hasInvalid = input.coverage.pairs.some(
    (pair) => pair.C.state === "invalid-row" || pair.D.state === "invalid-row",
  );
  const status: JevStatusState =
    input.readResult.status !== "ready"
      ? input.readResult.status
      : !input.cacheAvailable || hasBlocked
        ? "not-ready"
        : hasInvalid
          ? "stale"
          : input.coverage.complete
            ? "ready"
            : "not-ready";
  return {
    status,
    measurement: "current",
    eligibleGameCount: input.coverage.eligibleGameIds.length,
    pairCount: input.coverage.pairs.length,
    coverage: { C, D },
    progress: projectedProgress(input.progress),
  };
}

export function unavailableJevPairStatus(
  measurement: "not-applicable" | "cache-unavailable" | "source-unavailable",
  progress: JevRunProgress | null,
  status: JevStatusState = "unavailable",
): JevStatusResponse {
  return {
    status,
    measurement,
    eligibleGameCount: null,
    pairCount: null,
    coverage: null,
    progress: projectedProgress(progress),
  };
}
