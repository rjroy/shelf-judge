"use client";

import { useEffect, useReducer, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ManualGameValues } from "@shelf-judge/shared";

type Field = keyof ManualGameValues;
type FieldStatus = "idle" | "saving" | "clearing" | "refreshing";
type ManualGameValuesRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ManualGameValuesMutation =
  | { playingTime: number | null; playerCount?: never }
  | { playerCount: number | null; playingTime?: never };

export interface ManualGameValueFieldState {
  draft: string;
  baseline: string;
  status: FieldStatus;
  error: string | null;
}

export type ManualGameValueFieldAction =
  | { type: "change"; value: string }
  | { type: "sync"; value: string }
  | { type: "saving" }
  | { type: "clearing" }
  | { type: "saved"; value: string }
  | { type: "failed"; error: string }
  | { type: "settled" };

export function manualGameValueFieldReducer(
  state: ManualGameValueFieldState,
  action: ManualGameValueFieldAction,
): ManualGameValueFieldState {
  switch (action.type) {
    case "change":
      return { ...state, draft: action.value, error: null };
    case "sync":
      return {
        ...state,
        draft:
          state.status === "idle" && state.draft === state.baseline ? action.value : state.draft,
        baseline: action.value,
      };
    case "saving":
      return { ...state, status: "saving", error: null };
    case "clearing":
      return { ...state, status: "clearing", error: null };
    case "saved":
      return { ...state, draft: action.value, baseline: action.value, status: "refreshing" };
    case "failed":
      return { ...state, status: "idle", error: action.error };
    case "settled":
      return { ...state, status: "idle" };
  }
}

function valueFromProps(value: ManualGameValues[Field]): string {
  return value === null ? "" : String(value.value);
}

export function createManualGameValueFieldState(value: string): ManualGameValueFieldState {
  return { draft: value, baseline: value, status: "idle", error: null };
}

function parsed(value: string): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export async function mutateManualGameValues(
  gameId: string,
  body: ManualGameValuesMutation,
  request: ManualGameValuesRequest = fetch,
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

interface MutationLock {
  current: boolean;
}

interface SubmitManualGameValueOptions {
  gameId: string;
  body: ManualGameValuesMutation;
  operation: "saving" | "clearing";
  savedValue: string;
  dispatch: (action: ManualGameValueFieldAction) => void;
  beginRefresh: () => void;
  lock: MutationLock;
  request?: ManualGameValuesRequest;
}

export async function submitManualGameValue({
  gameId,
  body,
  operation,
  savedValue,
  dispatch,
  beginRefresh,
  lock,
  request = fetch,
}: SubmitManualGameValueOptions): Promise<void> {
  if (lock.current) return;

  lock.current = true;
  dispatch({ type: operation });
  try {
    await mutateManualGameValues(gameId, body, request);
    dispatch({ type: "saved", value: savedValue });
    beginRefresh();
  } catch (error) {
    dispatch({
      type: "failed",
      error: error instanceof Error ? error.message : "Failed to save value",
    });
    lock.current = false;
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
  request?: ManualGameValuesRequest;
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
  const [playingTime, dispatchPlayingTime] = useReducer(
    manualGameValueFieldReducer,
    valueFromProps(values.playingTime),
    createManualGameValueFieldState,
  );
  const [playerCount, dispatchPlayerCount] = useReducer(
    manualGameValueFieldReducer,
    valueFromProps(values.playerCount),
    createManualGameValueFieldState,
  );
  const [isRefreshPending, startRefresh] = useTransition();
  const mutationLock = useRef(false);
  const refreshObserved = useRef(false);

  const incomingPlayingTime = valueFromProps(values.playingTime);
  const incomingPlayerCount = valueFromProps(values.playerCount);
  useEffect(() => {
    dispatchPlayingTime({ type: "sync", value: incomingPlayingTime });
  }, [incomingPlayingTime, values.playingTime?.source, values.playingTime?.confirmedAt]);
  useEffect(() => {
    dispatchPlayerCount({ type: "sync", value: incomingPlayerCount });
  }, [incomingPlayerCount, values.playerCount?.source, values.playerCount?.confirmedAt]);

  const refreshingField =
    playingTime.status === "refreshing"
      ? "playingTime"
      : playerCount.status === "refreshing"
        ? "playerCount"
        : null;
  useEffect(() => {
    if (refreshingField === null) return;
    if (isRefreshPending) {
      refreshObserved.current = true;
      return;
    }
    if (!refreshObserved.current) return;

    if (refreshingField === "playingTime") dispatchPlayingTime({ type: "settled" });
    else dispatchPlayerCount({ type: "settled" });
    refreshObserved.current = false;
    mutationLock.current = false;
  }, [isRefreshPending, refreshingField]);

  function submit(
    body: ManualGameValuesMutation,
    operation: "saving" | "clearing",
    savedValue: string,
    dispatch: (action: ManualGameValueFieldAction) => void,
  ) {
    return submitManualGameValue({
      gameId,
      body,
      operation,
      savedValue,
      dispatch,
      beginRefresh: () => startRefresh(() => refresh()),
      lock: mutationLock,
      request,
    });
  }

  return (
    <ManualGameValuesFormView
      playingTime={playingTime}
      playerCount={playerCount}
      sourcePlayingTime={sourcePlayingTime}
      sourcePlayerCount={sourcePlayerCount}
      onPlayingTimeChange={(value) => dispatchPlayingTime({ type: "change", value })}
      onPlayerCountChange={(value) => dispatchPlayerCount({ type: "change", value })}
      onSavePlayingTime={(value) =>
        submit({ playingTime: value }, "saving", String(value), dispatchPlayingTime)
      }
      onClearPlayingTime={() => submit({ playingTime: null }, "clearing", "", dispatchPlayingTime)}
      onSavePlayerCount={(value) =>
        submit({ playerCount: value }, "saving", String(value), dispatchPlayerCount)
      }
      onClearPlayerCount={() => submit({ playerCount: null }, "clearing", "", dispatchPlayerCount)}
    />
  );
}

interface ManualGameValuesFormViewProps {
  playingTime: ManualGameValueFieldState;
  playerCount: ManualGameValueFieldState;
  sourcePlayingTime: number | null;
  sourcePlayerCount: number | null;
  onPlayingTimeChange: (value: string) => void;
  onPlayerCountChange: (value: string) => void;
  onSavePlayingTime: (value: number) => Promise<void>;
  onClearPlayingTime: () => Promise<void>;
  onSavePlayerCount: (value: number) => Promise<void>;
  onClearPlayerCount: () => Promise<void>;
}

interface ManualValueControlProps {
  label: string;
  fieldName: "Play Time" | "Player Count";
  state: ManualGameValueFieldState;
  placeholder: string;
  statusId: string;
  formPending: boolean;
  onChange: (value: string) => void;
  onSave: (value: number) => Promise<void>;
  onClear: () => Promise<void>;
}

function ManualValueControl({
  label,
  fieldName,
  state,
  placeholder,
  statusId,
  formPending,
  onChange,
  onSave,
  onClear,
}: ManualValueControlProps) {
  const value = parsed(state.draft);
  const pending = state.status !== "idle";
  const status =
    state.status === "saving"
      ? `Saving ${fieldName}...`
      : state.status === "clearing"
        ? `Clearing ${fieldName}...`
        : state.status === "refreshing"
          ? `Refreshing ${fieldName}...`
          : null;

  return (
    <div className="manual-game-value-control">
      <label>
        {label}
        <input
          aria-label={label}
          aria-describedby={statusId}
          type="number"
          min={1}
          step={1}
          value={state.draft}
          placeholder={placeholder}
          disabled={pending}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn-secondary"
        aria-describedby={statusId}
        disabled={formPending || state.draft === state.baseline || value === undefined}
        onClick={() => value !== undefined && void onSave(value)}
      >
        {state.status === "saving" ? `Saving ${fieldName}...` : `Save ${fieldName}`}
      </button>
      <button
        type="button"
        aria-describedby={statusId}
        disabled={formPending || state.baseline === ""}
        onClick={() => void onClear()}
      >
        {state.status === "clearing" ? `Clearing ${fieldName}...` : `Clear ${fieldName}`}
      </button>
      {state.error ? (
        <div id={statusId} className="error-banner" role="alert">
          {state.error}
        </div>
      ) : status ? (
        <div id={statusId} role="status" aria-live="polite">
          {status}
        </div>
      ) : (
        <div id={statusId} />
      )}
    </div>
  );
}

export function ManualGameValuesFormView({
  playingTime,
  playerCount,
  sourcePlayingTime,
  sourcePlayerCount,
  onPlayingTimeChange,
  onPlayerCountChange,
  onSavePlayingTime,
  onClearPlayingTime,
  onSavePlayerCount,
  onClearPlayerCount,
}: ManualGameValuesFormViewProps) {
  const formPending = playingTime.status !== "idle" || playerCount.status !== "idle";

  return (
    <div className="rating-field manual-game-values-form">
      <div className="panel-section-title">Play Details</div>
      <ManualValueControl
        label="Play Time (minutes)"
        fieldName="Play Time"
        state={playingTime}
        placeholder={sourcePlayingTime === null ? "No BGG value" : String(sourcePlayingTime)}
        statusId="playing-time-status"
        formPending={formPending}
        onChange={onPlayingTimeChange}
        onSave={onSavePlayingTime}
        onClear={onClearPlayingTime}
      />
      <ManualValueControl
        label="Player Count"
        fieldName="Player Count"
        state={playerCount}
        placeholder={sourcePlayerCount === null ? "No BGG value" : String(sourcePlayerCount)}
        statusId="player-count-status"
        formPending={formPending}
        onChange={onPlayerCountChange}
        onSave={onSavePlayerCount}
        onClear={onClearPlayerCount}
      />
      <div className="derived-rating-facts">
        <span>BGG play time: {sourcePlayingTime ?? "unavailable"}</span>
        <span>BGG player count: {sourcePlayerCount ?? "unavailable"}</span>
      </div>
    </div>
  );
}
