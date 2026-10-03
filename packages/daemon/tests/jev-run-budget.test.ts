import { describe, expect, test } from "bun:test";
import { DEFAULT_JEV_RUN_BUDGET as sharedDefault } from "@shelf-judge/shared";
import {
  DEFAULT_JEV_RUN_BUDGET,
  MAX_JEV_RUN_PROVIDER_ATTEMPTS,
  MAX_JEV_RUN_DURATION_MS,
  MIN_JEV_RUN_DURATION_MS,
  isValidJevRunBudget,
  parseJevRunBudgetQuery,
} from "../src/services/jev-run-budget.js";

describe("daemon Jev run budget", () => {
  test("uses the shared frozen default when no query values are supplied", () => {
    expect(DEFAULT_JEV_RUN_BUDGET).toBe(sharedDefault);
    expect(parseJevRunBudgetQuery(new URLSearchParams())).toEqual({
      ok: true,
      budget: {
        maxProviderAttempts: 1_000,
        reportedTokenStopThreshold: 2_000_000,
        maxRunDurationMs: 1_800_000,
      },
    });
  });

  test("keeps the existing positive-safe-integer and run-duration bounds", () => {
    expect(
      isValidJevRunBudget({
        maxProviderAttempts: MAX_JEV_RUN_PROVIDER_ATTEMPTS,
        reportedTokenStopThreshold: Number.MAX_SAFE_INTEGER,
        maxRunDurationMs: MAX_JEV_RUN_DURATION_MS,
      }),
    ).toBe(true);
    for (const invalid of [
      { ...DEFAULT_JEV_RUN_BUDGET, maxProviderAttempts: 0 },
      { ...DEFAULT_JEV_RUN_BUDGET, maxProviderAttempts: MAX_JEV_RUN_PROVIDER_ATTEMPTS + 1 },
      { ...DEFAULT_JEV_RUN_BUDGET, reportedTokenStopThreshold: 0 },
      { ...DEFAULT_JEV_RUN_BUDGET, reportedTokenStopThreshold: Number.MAX_SAFE_INTEGER + 1 },
      { ...DEFAULT_JEV_RUN_BUDGET, maxRunDurationMs: MIN_JEV_RUN_DURATION_MS - 1 },
      { ...DEFAULT_JEV_RUN_BUDGET, maxRunDurationMs: MAX_JEV_RUN_DURATION_MS + 1 },
    ])
      expect(isValidJevRunBudget(invalid)).toBe(false);
  });

  test("accepts explicit budget overrides and rejects duplicate query values", () => {
    expect(
      parseJevRunBudgetQuery(
        new URLSearchParams({
          maxProviderAttempts: "250",
          reportedTokenStopThreshold: "350000",
          maxRunDurationMs: "5400000",
        }),
      ),
    ).toEqual({
      ok: true,
      budget: {
        maxProviderAttempts: 250,
        reportedTokenStopThreshold: 350_000,
        maxRunDurationMs: 5_400_000,
      },
    });
    expect(
      parseJevRunBudgetQuery(
        new URLSearchParams("maxProviderAttempts=250&maxProviderAttempts=500"),
      ),
    ).toEqual({ ok: false });
  });
});
