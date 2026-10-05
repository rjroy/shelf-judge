/** Application-level limits for a single explicitly authorized Jev Run. */
export interface JevRunBudget {
  maxProviderAttempts: number;
  reportedTokenStopThreshold: number;
  maxRunDurationMs: number;
}

/** Shared per-run defaults consumed by the daemon, CLI, and clients. */
export const DEFAULT_JEV_RUN_BUDGET: Readonly<JevRunBudget> = Object.freeze({
  maxProviderAttempts: 1_000,
  reportedTokenStopThreshold: 2_000_000,
  maxRunDurationMs: 1_800_000,
});
