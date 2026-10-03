import { describe, expect, test } from "bun:test";
import { DEFAULT_JEV_RUN_BUDGET } from "../src/index.js";

describe("shared Jev run budget defaults", () => {
  test("publishes the frozen UI-aligned per-run defaults", () => {
    expect(DEFAULT_JEV_RUN_BUDGET).toEqual({
      maxProviderAttempts: 1_000,
      reportedTokenStopThreshold: 2_000_000,
      maxRunDurationMs: 1_800_000,
    });
    expect(Object.isFrozen(DEFAULT_JEV_RUN_BUDGET)).toBe(true);
  });
});
