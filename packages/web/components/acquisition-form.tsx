"use client";

import { useReducer } from "react";
import { useRouter } from "next/navigation";
import type { Acquisition, AcquisitionMutationRequest } from "@shelf-judge/shared";
import { formatStoredAmount } from "@shelf-judge/shared";

type AcquisitionStateName = AcquisitionMutationRequest["state"];

export interface AcquisitionFormState {
  selectedState: AcquisitionStateName;
  amount: string;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

type AcquisitionFormAction =
  | { type: "select"; state: AcquisitionStateName }
  | { type: "amount"; amount: string }
  | { type: "save-started" }
  | { type: "save-failed"; error: string }
  | { type: "save-finished" };

export function createAcquisitionFormState(acquisition: Acquisition): AcquisitionFormState {
  return {
    selectedState: acquisition.state === "invalid" ? "unknown" : acquisition.state,
    amount:
      acquisition.state === "purchase"
        ? formatStoredAmount(acquisition.amount.hundredths).slice(1)
        : "",
    saving: false,
    error: null,
    saved: false,
  };
}

export function acquisitionFormReducer(
  state: AcquisitionFormState,
  action: AcquisitionFormAction,
): AcquisitionFormState {
  switch (action.type) {
    case "select":
      return { ...state, selectedState: action.state, error: null, saved: false };
    case "amount":
      return { ...state, amount: action.amount, error: null, saved: false };
    case "save-started":
      return { ...state, saving: true, error: null, saved: false };
    case "save-failed":
      return { ...state, saving: false, error: action.error, saved: false };
    case "save-finished":
      return { ...state, saving: false, error: null, saved: true };
  }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export async function submitAcquisition(options: {
  gameId: string;
  state: AcquisitionStateName;
  amount: string;
  refresh: () => void;
  dispatch: (action: AcquisitionFormAction) => void;
  request?: typeof fetch;
}): Promise<void> {
  const request = options.request ?? fetch;
  options.dispatch({ type: "save-started" });
  const body: AcquisitionMutationRequest =
    options.state === "purchase"
      ? { state: "purchase", amount: options.amount }
      : { state: options.state };
  try {
    const response = await request(`/api/daemon/games/${options.gameId}/acquisition`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseError(response, "Could not save acquisition"));
    options.dispatch({ type: "save-finished" });
    options.refresh();
  } catch (error) {
    options.dispatch({
      type: "save-failed",
      error: error instanceof Error ? error.message : "Could not save acquisition",
    });
  }
}

export function AcquisitionForm({
  gameId,
  acquisition,
}: {
  gameId: string;
  acquisition: Acquisition;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    acquisitionFormReducer,
    acquisition,
    createAcquisitionFormState,
  );

  return (
    <form
      className="acquisition-form"
      aria-labelledby="acquisition-heading"
      onSubmit={(event) => {
        event.preventDefault();
        void submitAcquisition({
          gameId,
          state: state.selectedState,
          amount: state.amount,
          refresh: () => router.refresh(),
          dispatch,
        });
      }}
    >
      <div className="panel-section-title" id="acquisition-heading">
        Acquisition
      </div>
      {acquisition.state === "invalid" && (
        <div className="form-warning">
          Saved acquisition data is invalid. Choose a state to correct it.
        </div>
      )}
      <div className="acquisition-options" role="radiogroup" aria-label="Acquisition state">
        {(["unknown", "gift", "purchase"] as const).map((option) => (
          <label key={option} className="acquisition-option">
            <input
              type="radio"
              name="acquisition-state"
              checked={state.selectedState === option}
              onChange={() => dispatch({ type: "select", state: option })}
            />
            {option === "unknown" ? "Unknown" : option === "gift" ? "Gift" : "Purchase"}
          </label>
        ))}
      </div>
      {state.selectedState === "purchase" && (
        <label className="amount-field">
          <span>Lifetime landed cost</span>
          <span className="amount-input-wrap">
            <span aria-hidden="true">$</span>
            <input
              aria-label="Lifetime landed cost"
              inputMode="decimal"
              value={state.amount}
              onChange={(event) => dispatch({ type: "amount", amount: event.target.value })}
              placeholder="0.00"
            />
          </span>
        </label>
      )}
      <p className="form-help">
        Lifetime landed cost includes item price, tax, shipping, and later reacquisitions.
      </p>
      {state.error && (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      )}
      {state.saved && (
        <div className="form-success" aria-live="polite">
          Acquisition updated.
        </div>
      )}
      <button
        type="submit"
        className="btn btn-primary"
        disabled={state.saving || (state.selectedState === "purchase" && state.amount === "")}
      >
        {state.saving ? "Saving..." : "Save acquisition"}
      </button>
    </form>
  );
}
