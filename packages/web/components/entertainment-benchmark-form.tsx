"use client";

import { useReducer } from "react";
import { useRouter } from "next/navigation";
import type { EntertainmentBenchmark } from "@shelf-judge/shared";
import { formatStoredAmount } from "@shelf-judge/shared";

export interface BenchmarkFormState {
  amount: string;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

type BenchmarkFormAction =
  | { type: "amount"; amount: string }
  | { type: "save-started" }
  | { type: "save-failed"; error: string }
  | { type: "save-finished"; amount: string };

export function createBenchmarkFormState(benchmark: EntertainmentBenchmark): BenchmarkFormState {
  return {
    amount:
      benchmark?.state === "configured"
        ? formatStoredAmount(benchmark.amount.hundredths).slice(1)
        : "",
    saving: false,
    error: null,
    saved: false,
  };
}

export function benchmarkFormReducer(
  state: BenchmarkFormState,
  action: BenchmarkFormAction,
): BenchmarkFormState {
  switch (action.type) {
    case "amount":
      return { ...state, amount: action.amount, error: null, saved: false };
    case "save-started":
      return { ...state, saving: true, error: null, saved: false };
    case "save-failed":
      return { ...state, saving: false, error: action.error, saved: false };
    case "save-finished":
      return { amount: action.amount, saving: false, error: null, saved: true };
  }
}

export async function submitBenchmark(options: {
  amount: string;
  clear: boolean;
  refresh: () => void;
  dispatch: (action: BenchmarkFormAction) => void;
  request?: typeof fetch;
}): Promise<void> {
  const request = options.request ?? fetch;
  options.dispatch({ type: "save-started" });
  try {
    const response = await request("/api/daemon/collection/entertainment-benchmark", {
      method: options.clear ? "DELETE" : "PUT",
      headers: options.clear ? undefined : { "Content-Type": "application/json" },
      body: options.clear ? undefined : JSON.stringify({ amount: options.amount }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Could not save entertainment benchmark");
    }
    options.dispatch({ type: "save-finished", amount: options.clear ? "" : options.amount });
    options.refresh();
  } catch (error) {
    options.dispatch({
      type: "save-failed",
      error: error instanceof Error ? error.message : "Could not save entertainment benchmark",
    });
  }
}

export function EntertainmentBenchmarkForm({ benchmark }: { benchmark: EntertainmentBenchmark }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(benchmarkFormReducer, benchmark, createBenchmarkFormState);
  const canClear = benchmark !== null;

  return (
    <form
      className="benchmark-card"
      id="entertainment-benchmark"
      onSubmit={(event) => {
        event.preventDefault();
        void submitBenchmark({
          amount: state.amount,
          clear: false,
          refresh: () => router.refresh(),
          dispatch,
        });
      }}
    >
      <div className="panel-section-title">Entertainment Benchmark</div>
      {benchmark?.state === "invalid" && (
        <div className="form-warning">
          Saved benchmark data is invalid. Enter a value to correct it.
        </div>
      )}
      <p>
        Choose what one person-hour of entertainment is worth for a fitness-6 game. The benchmark
        and purchase costs use your same implicit personal currency.
      </p>
      <div className="benchmark-example">
        <strong>Movie-ticket method</strong>
        <span>$16 / 2 hours = $8 per person-hour</span>
      </div>
      <label className="amount-field">
        <span>Fitness-6 cost per person-hour</span>
        <span className="amount-input-wrap">
          <span aria-hidden="true">$</span>
          <input
            aria-label="Fitness-6 cost per person-hour"
            inputMode="decimal"
            value={state.amount}
            onChange={(event) => dispatch({ type: "amount", amount: event.target.value })}
            placeholder="8.00"
          />
        </span>
      </label>
      {state.error && (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      )}
      {state.saved && (
        <div className="form-success" aria-live="polite">
          Benchmark updated.
        </div>
      )}
      <div className="benchmark-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={state.saving || state.amount === ""}
        >
          {state.saving ? "Saving..." : benchmark === null ? "Set benchmark" : "Update benchmark"}
        </button>
        {canClear && (
          <button
            type="button"
            className="btn btn-danger-ghost"
            disabled={state.saving}
            onClick={() =>
              void submitBenchmark({
                amount: state.amount,
                clear: true,
                refresh: () => router.refresh(),
                dispatch,
              })
            }
          >
            Clear to unknown
          </button>
        )}
      </div>
    </form>
  );
}
