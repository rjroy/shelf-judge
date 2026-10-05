import { DEFAULT_JEV_RUN_BUDGET } from "@shelf-judge/shared";
import type { JevRunBudget } from "@shelf-judge/shared";

export { DEFAULT_JEV_RUN_BUDGET };
export type { JevRunBudget };

export const MAX_JEV_RUN_PROVIDER_ATTEMPTS = 75_000;
export const MIN_JEV_RUN_DURATION_MS = 60_000;
export const MAX_JEV_RUN_DURATION_MS = 43_200_000;

export function isValidJevRunBudget(value: unknown): value is JevRunBudget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const budget = value as Record<string, unknown>;
  if (
    Object.keys(budget).length !== 3 ||
    !Object.hasOwn(budget, "maxProviderAttempts") ||
    !Object.hasOwn(budget, "reportedTokenStopThreshold") ||
    !Object.hasOwn(budget, "maxRunDurationMs")
  )
    return false;
  return (
    Number.isSafeInteger(budget.maxProviderAttempts) &&
    (budget.maxProviderAttempts as number) > 0 &&
    (budget.maxProviderAttempts as number) <= MAX_JEV_RUN_PROVIDER_ATTEMPTS &&
    Number.isSafeInteger(budget.reportedTokenStopThreshold) &&
    (budget.reportedTokenStopThreshold as number) > 0 &&
    Number.isSafeInteger(budget.maxRunDurationMs) &&
    (budget.maxRunDurationMs as number) >= MIN_JEV_RUN_DURATION_MS &&
    (budget.maxRunDurationMs as number) <= MAX_JEV_RUN_DURATION_MS
  );
}

export function parseJevRunBudgetQuery(
  params: URLSearchParams,
): { ok: true; budget: JevRunBudget } | { ok: false } {
  const queryFields: Array<keyof JevRunBudget> = [
    "maxProviderAttempts",
    "reportedTokenStopThreshold",
    "maxRunDurationMs",
  ];
  const allowed = new Set<string>(queryFields);
  for (const key of params.keys()) if (!allowed.has(key)) return { ok: false };

  const budget: JevRunBudget = { ...DEFAULT_JEV_RUN_BUDGET };
  for (const key of queryFields) {
    const values = params.getAll(key);
    if (values.length > 1) return { ok: false };
    const value = values[0];
    if (value === undefined) continue;
    if (!/^[0-9]+$/.test(value)) return { ok: false };
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) return { ok: false };
    budget[key] = parsed;
  }
  return isValidJevRunBudget(budget) ? { ok: true, budget } : { ok: false };
}
