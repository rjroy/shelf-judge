"use client";

import { useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import type { ManualGameValues } from "@shelf-judge/shared";

type Field = keyof ManualGameValues;
type ManualGameValuesMutation = {
  playingTime?: number | null;
  playerCount?: number | null;
};
export type ManualGameValuesFormState = {
  playingTime: string;
  playerCount: string;
  savedPlayingTime: string;
  savedPlayerCount: string;
  serverPlayingTime: string;
  serverPlayerCount: string;
  saving: Field | "both" | null;
  pending: ManualGameValuesMutation | null;
  error: string | null;
};
export type ManualGameValuesFormAction =
  | { type: "change"; field: Field; value: string }
  | { type: "sync"; playingTime: string; playerCount: string }
  | { type: "saving"; field: Field | "both"; body: ManualGameValuesMutation }
  | { type: "saved"; body: ManualGameValuesMutation }
  | { type: "failed"; error: string };

function reconciledDraft(draft: string, saved: string, incoming: string): string {
  return draft === saved ? incoming : draft;
}

function mutationValue(value: number | null): string {
  return value === null ? "" : String(value);
}

export function manualGameValuesFormReducer(
  state: ManualGameValuesFormState,
  action: ManualGameValuesFormAction,
): ManualGameValuesFormState {
  switch (action.type) {
    case "change":
      return { ...state, [action.field]: action.value };
    case "sync": {
      const playingTimePending = state.pending?.playingTime !== undefined;
      const playerCountPending = state.pending?.playerCount !== undefined;
      return {
        ...state,
        playingTime: playingTimePending
          ? state.playingTime
          : reconciledDraft(state.playingTime, state.savedPlayingTime, action.playingTime),
        playerCount: playerCountPending
          ? state.playerCount
          : reconciledDraft(state.playerCount, state.savedPlayerCount, action.playerCount),
        savedPlayingTime: playingTimePending ? state.savedPlayingTime : action.playingTime,
        savedPlayerCount: playerCountPending ? state.savedPlayerCount : action.playerCount,
        serverPlayingTime: action.playingTime,
        serverPlayerCount: action.playerCount,
      };
    }
    case "saving":
      return { ...state, saving: action.field, pending: action.body, error: null };
    case "saved":
      return {
        ...state,
        savedPlayingTime:
          action.body.playingTime === undefined
            ? state.savedPlayingTime
            : mutationValue(action.body.playingTime),
        savedPlayerCount:
          action.body.playerCount === undefined
            ? state.savedPlayerCount
            : mutationValue(action.body.playerCount),
        serverPlayingTime:
          action.body.playingTime === undefined
            ? state.serverPlayingTime
            : mutationValue(action.body.playingTime),
        serverPlayerCount:
          action.body.playerCount === undefined
            ? state.serverPlayerCount
            : mutationValue(action.body.playerCount),
        saving: null,
        pending: null,
      };
    case "failed": {
      const playingTimePending = state.pending?.playingTime !== undefined;
      const playerCountPending = state.pending?.playerCount !== undefined;
      return {
        ...state,
        playingTime: playingTimePending
          ? reconciledDraft(state.playingTime, state.savedPlayingTime, state.serverPlayingTime)
          : state.playingTime,
        playerCount: playerCountPending
          ? reconciledDraft(state.playerCount, state.savedPlayerCount, state.serverPlayerCount)
          : state.playerCount,
        savedPlayingTime: playingTimePending ? state.serverPlayingTime : state.savedPlayingTime,
        savedPlayerCount: playerCountPending ? state.serverPlayerCount : state.savedPlayerCount,
        saving: null,
        pending: null,
        error: action.error,
      };
    }
  }
}

export function createManualGameValuesFormState(
  values: ManualGameValues,
): ManualGameValuesFormState {
  const playingTime = values.playingTime === null ? "" : String(values.playingTime.value);
  const playerCount = values.playerCount === null ? "" : String(values.playerCount.value);
  return {
    playingTime,
    playerCount,
    savedPlayingTime: playingTime,
    savedPlayerCount: playerCount,
    serverPlayingTime: playingTime,
    serverPlayerCount: playerCount,
    saving: null,
    pending: null,
    error: null,
  };
}

function parsed(value: string): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function buildManualGameValuesMutation(
  state: ManualGameValuesFormState,
): ManualGameValuesMutation {
  const playingTime = parsed(state.playingTime);
  const playerCount = parsed(state.playerCount);
  return {
    ...(state.playingTime === state.savedPlayingTime || playingTime === undefined
      ? {}
      : { playingTime }),
    ...(state.playerCount === state.savedPlayerCount || playerCount === undefined
      ? {}
      : { playerCount }),
  };
}

export async function mutateManualGameValues(
  gameId: string,
  body: ManualGameValuesMutation,
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request(`/api/daemon/games/${gameId}/manual-values`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(result.error ?? `Failed: ${response.status}`);
  }
}

interface SubmitManualGameValuesOptions {
  gameId: string;
  body: ManualGameValuesMutation;
  field: Field | "both";
  dispatch: (action: ManualGameValuesFormAction) => void;
  refresh: () => void;
  request?: typeof fetch;
}

export async function submitManualGameValues({
  gameId,
  body,
  field,
  dispatch,
  refresh,
  request = fetch,
}: SubmitManualGameValuesOptions): Promise<void> {
  dispatch({ type: "saving", field, body });
  try {
    await mutateManualGameValues(gameId, body, request);
    dispatch({ type: "saved", body });
    refresh();
  } catch (error) {
    dispatch({
      type: "failed",
      error: error instanceof Error ? error.message : "Failed to save values",
    });
  }
}

export function ManualGameValuesForm({ ...props }: Omit<ManualGameValuesFormProps, "refresh">) {
  const router = useRouter();
  return <ManualGameValuesFormContent {...props} refresh={() => router.refresh()} />;
}

interface ManualGameValuesFormProps {
  gameId: string;
  values: ManualGameValues;
  sourcePlayingTime: number | null;
  sourcePlayerCount: number | null;
  request?: typeof fetch;
  refresh: () => void;
}

export function ManualGameValuesFormContent({
  gameId,
  values,
  sourcePlayingTime,
  sourcePlayerCount,
  request = fetch,
  refresh,
}: ManualGameValuesFormProps) {
  const [state, dispatch] = useReducer(
    manualGameValuesFormReducer,
    values,
    createManualGameValuesFormState,
  );

  const playingTime = values.playingTime === null ? "" : String(values.playingTime.value);
  const playerCount = values.playerCount === null ? "" : String(values.playerCount.value);
  useEffect(() => {
    dispatch({ type: "sync", playingTime, playerCount });
  }, [playingTime, playerCount]);

  function submit(body: ManualGameValuesMutation, field: Field | "both") {
    return submitManualGameValues({ gameId, body, field, dispatch, refresh, request });
  }

  return (
    <ManualGameValuesFormView
      state={state}
      sourcePlayingTime={sourcePlayingTime}
      sourcePlayerCount={sourcePlayerCount}
      onChange={(field, value) => dispatch({ type: "change", field, value })}
      onSubmit={submit}
    />
  );
}

interface ManualGameValuesFormViewProps {
  state: ManualGameValuesFormState;
  sourcePlayingTime: number | null;
  sourcePlayerCount: number | null;
  onChange: (field: Field, value: string) => void;
  onSubmit: (body: ManualGameValuesMutation, field: Field | "both") => Promise<void>;
}

export function ManualGameValuesFormView({
  state,
  sourcePlayingTime,
  sourcePlayerCount,
  onChange,
  onSubmit,
}: ManualGameValuesFormViewProps) {
  const mutation = buildManualGameValuesMutation(state);

  return (
    <div className="rating-field manual-game-values-form">
      <div className="panel-section-title">Play Details</div>
      {state.error && <div className="error-banner">{state.error}</div>}
      <label>
        Play Time (minutes)
        <input
          aria-label="Play Time (minutes)"
          type="number"
          min={1}
          step={1}
          value={state.playingTime}
          placeholder={sourcePlayingTime === null ? "No BGG value" : String(sourcePlayingTime)}
          onChange={(event) => onChange("playingTime", event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={state.savedPlayingTime === "" || state.saving !== null}
        onClick={() => {
          onChange("playingTime", "");
          void onSubmit({ playingTime: null }, "playingTime");
        }}
      >
        Clear Play Time
      </button>
      <label>
        Player Count
        <input
          aria-label="Player Count"
          type="number"
          min={1}
          step={1}
          value={state.playerCount}
          placeholder={sourcePlayerCount === null ? "No BGG value" : String(sourcePlayerCount)}
          onChange={(event) => onChange("playerCount", event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={state.savedPlayerCount === "" || state.saving !== null}
        onClick={() => {
          onChange("playerCount", "");
          void onSubmit({ playerCount: null }, "playerCount");
        }}
      >
        Clear Player Count
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={state.saving !== null || Object.keys(mutation).length === 0}
        onClick={() => {
          void onSubmit(mutation, "both");
        }}
      >
        {state.saving === "both" ? "Saving..." : "Save Play Details"}
      </button>
      <div className="derived-rating-facts">
        <span>BGG play time: {sourcePlayingTime ?? "unavailable"}</span>
        <span>BGG player count: {sourcePlayerCount ?? "unavailable"}</span>
      </div>
    </div>
  );
}
