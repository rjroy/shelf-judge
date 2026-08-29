"use client";

import { useEffect, useReducer, useRef, type RefObject } from "react";
import type {
  Game,
  GameIntentionDetail,
  IntentionMutationError,
  ManualPlayCorrectionResponse,
  PlayIntention,
  PlayIntentionKind,
  ResolvedPlayIntentionHistory,
} from "@shelf-judge/shared";
import { correctPlayCount, createIntention, resolveIntention } from "@/lib/browser-mutations";
import { IntentionHistory } from "@/components/intention-history";

export type FocusTarget = "status" | "play-count" | null;

interface FocusableTarget {
  focus(): void;
}

export interface IntentionControlState {
  generation: number;
  game: Game;
  activeIntention: PlayIntention | null;
  history: ResolvedPlayIntentionHistory;
  correctionOpen: boolean;
  playCountInput: string;
  pending: boolean;
  announcement: string | null;
  error: string | null;
  fieldIssues: Record<string, string>;
  staleGuidance: string | null;
  focusTarget: FocusTarget;
}

export type IntentionControlAction =
  | { type: "open-correction"; generation: number }
  | { type: "cancel-correction"; generation: number }
  | { type: "play-count-input"; value: string }
  | { type: "request-start"; generation: number }
  | {
      type: "intention-result";
      generation: number;
      result: Awaited<ReturnType<typeof createIntention>>;
      gameName: string;
    }
  | {
      type: "play-result";
      generation: number;
      result: ManualPlayCorrectionResponse;
      gameName: string;
    }
  | { type: "client-validation"; generation: number; message: string }
  | { type: "request-failure"; generation: number; message: string }
  | { type: "replace-detail"; generation: number; game: Game; detail: GameIntentionDetail }
  | { type: "focus-handled" };

function historyWith(
  history: ResolvedPlayIntentionHistory,
  intention: PlayIntention,
  gameName: string,
): ResolvedPlayIntentionHistory {
  if (intention.resolution === null) return history;
  const item = { ...intention, gameName, resolution: intention.resolution };
  return [item, ...history.filter(({ intentionId }) => intentionId !== item.intentionId)].sort(
    (left, right) =>
      Date.parse(right.resolution.resolvedAt) - Date.parse(left.resolution.resolvedAt) ||
      (left.intentionId < right.intentionId ? -1 : left.intentionId > right.intentionId ? 1 : 0),
  );
}

function issueMap(error: IntentionMutationError): Record<string, string> {
  if (error.code !== "validation") return {};
  return Object.fromEntries(error.issues.map(({ field, message }) => [field, message]));
}

function intentionErrorMessage(error: IntentionMutationError): string {
  switch (error.code) {
    case "ineligible-game":
      return `The game is not eligible for this intention (${error.reason}). Review ownership and current play evidence.`;
    case "active-intention-conflict":
      return "Another active intention already exists. Review the returned current intention.";
    case "stale-version":
      return "This intention changed after the form was opened.";
    case "validation":
      return "Review the highlighted fields and try again.";
    case "command-reuse":
      return "The command identity was already used for a different request. Refresh and review before trying again.";
    case "game-not-found":
    case "intention-not-found":
      return "This game or intention is no longer available. Refresh and review the current page.";
    case "persistence-failure":
      return error.message;
    case "history-conflict":
      return "Intention history prevents permanent deletion.";
  }
}

export function createIntentionControlState(
  game: Game,
  detail: GameIntentionDetail,
): IntentionControlState {
  return {
    generation: 0,
    game,
    activeIntention: detail.activeIntention,
    history: detail.resolvedHistory,
    correctionOpen: false,
    playCountInput: game.numPlays?.toString() ?? "",
    pending: false,
    announcement: null,
    error: null,
    fieldIssues: {},
    staleGuidance: null,
    focusTarget: null,
  };
}

export function intentionControlReducer(
  state: IntentionControlState,
  action: IntentionControlAction,
): IntentionControlState {
  if (
    "generation" in action &&
    action.type !== "request-start" &&
    action.type !== "client-validation" &&
    action.type !== "open-correction" &&
    action.type !== "cancel-correction" &&
    action.type !== "replace-detail" &&
    action.generation !== state.generation
  ) {
    return state;
  }
  switch (action.type) {
    case "open-correction":
      return {
        ...state,
        generation: action.generation,
        correctionOpen: true,
        focusTarget: "play-count",
      };
    case "cancel-correction":
      return {
        ...state,
        generation: action.generation,
        correctionOpen: false,
        pending: false,
        error: null,
        fieldIssues: {},
        focusTarget: null,
      };
    case "play-count-input":
      return { ...state, playCountInput: action.value, fieldIssues: {}, error: null };
    case "request-start":
      return {
        ...state,
        generation: action.generation,
        pending: true,
        announcement: null,
        error: null,
        fieldIssues: {},
        staleGuidance: null,
        focusTarget: null,
      };
    case "intention-result": {
      if (!action.result.ok) {
        const current =
          action.result.error.code === "stale-version" ||
          action.result.error.code === "active-intention-conflict"
            ? action.result.error.current
            : null;
        const stale = action.result.error.code === "stale-version";
        return {
          ...state,
          pending: false,
          activeIntention:
            current === null ? state.activeIntention : current.resolution === null ? current : null,
          history:
            current === null ? state.history : historyWith(state.history, current, action.gameName),
          error: intentionErrorMessage(action.result.error),
          fieldIssues: issueMap(action.result.error),
          staleGuidance: stale
            ? "Returned current state is shown below. Refresh the page, review it, then choose a new action. Shelf Judge will not retry automatically."
            : null,
          focusTarget: "status",
        };
      }
      const intention = action.result.intention;
      return {
        ...state,
        pending: false,
        activeIntention: intention.resolution === null ? intention : null,
        history: historyWith(state.history, intention, action.gameName),
        announcement:
          intention.resolution === null
            ? `${intention.kind === "first-play" ? "First-play" : "Replay"} intention created.`
            : `Intention ${intention.resolution.outcome}.`,
        focusTarget: "status",
      };
    }
    case "play-result": {
      if ("code" in action.result) {
        const fieldIssues = action.result.code === "validation" ? issueMap(action.result) : {};
        return {
          ...state,
          pending: false,
          error:
            action.result.code === "validation"
              ? "Review the play-count field and try again."
              : action.result.code === "game_not_found"
                ? action.result.error
                : action.result.message,
          fieldIssues,
          focusTarget: Object.keys(fieldIssues).length > 0 ? "play-count" : "status",
        };
      }
      if (!action.result.ok) {
        return {
          ...state,
          pending: false,
          error: `The correction was not saved because its observation time was not newer. Latest accepted evidence: ${action.result.error.latestAcceptedAt}. Refresh and review before trying again.`,
          focusTarget: "status",
        };
      }
      const transition = action.result.linkedIntentionTransition;
      return {
        ...state,
        pending: false,
        game: action.result.game,
        activeIntention: transition === null ? state.activeIntention : null,
        history:
          transition === null
            ? state.history
            : historyWith(state.history, transition, action.gameName),
        announcement:
          transition === null
            ? `Recorded play count updated to ${action.result.game.numPlays ?? 0}.`
            : `Recorded play count updated to ${action.result.game.numPlays ?? 0}. The active intention completed automatically from the observed play increase.`,
        focusTarget: "status",
      };
    }
    case "client-validation":
      return {
        ...state,
        generation: action.generation,
        pending: false,
        error: "Review the play-count field and try again.",
        fieldIssues: { playCount: action.message },
        focusTarget: "play-count",
      };
    case "request-failure":
      return { ...state, pending: false, error: action.message, focusTarget: "status" };
    case "replace-detail":
      return {
        ...state,
        generation: action.generation,
        game: action.game,
        activeIntention: action.detail.activeIntention,
        history: action.detail.resolvedHistory,
        pending: false,
      };
    case "focus-handled":
      return { ...state, focusTarget: null };
  }
}

export function isPlayEvidenceStale(game: Game): boolean {
  const evidence = game.playCountEvidence;
  const check = game.latestPlayCountCheck;
  return (
    evidence.status === "valid" &&
    check !== null &&
    check.status !== "valid" &&
    (evidence.observedAt === null || Date.parse(check.observedAt) > Date.parse(evidence.observedAt))
  );
}

export function eligibleIntentionKind(game: Game): PlayIntentionKind | null {
  if (
    game.ownership !== "owned" ||
    game.playCountEvidence.status !== "valid" ||
    game.playCountEvidence.observedAt === null ||
    isPlayEvidenceStale(game)
  ) {
    return null;
  }
  return game.playCountEvidence.value === 0 ? "first-play" : "replay";
}

export function focusIntentionControlTarget(
  target: FocusTarget,
  status: RefObject<FocusableTarget | null>,
  playCount: RefObject<FocusableTarget | null>,
): void {
  if (target === "status") status.current?.focus();
  if (target === "play-count") playCount.current?.focus();
}

export function IntentionFeedback({
  state,
  statusRef,
}: {
  state: Pick<
    IntentionControlState,
    "announcement" | "error" | "staleGuidance" | "activeIntention"
  >;
  statusRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={statusRef} tabIndex={-1} className="intention-live-status" aria-live="polite">
      {state.announcement}
      {state.error !== null && (
        <div className="error-banner" role="alert">
          {state.error}
        </div>
      )}
      {state.staleGuidance !== null && (
        <div className="intention-warning" role="status">
          <strong>Refresh and review:</strong> {state.staleGuidance}
          {state.activeIntention !== null && (
            <span>
              {` Returned current intention ${state.activeIntention.intentionId}, version ${state.activeIntention.version}, state ${state.activeIntention.resolution?.outcome ?? "active"}.`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceStatus({ game }: { game: Game }) {
  const evidence = game.playCountEvidence;
  if (isPlayEvidenceStale(game)) {
    const check = game.latestPlayCountCheck;
    return (
      <p className="intention-warning">
        <strong>Evidence warning:</strong> A newer BGG check did not provide a valid play count.
        {check !== null && ` Latest successful check: ${check.status} at ${check.observedAt}.`}
      </p>
    );
  }
  if (evidence.status !== "valid") {
    return (
      <p className="intention-warning">
        <strong>Evidence warning:</strong> Current play evidence is {evidence.status}.
      </p>
    );
  }
  if (evidence.observedAt === null) {
    return (
      <p className="intention-warning">Evidence warning: the play count has no observation time.</p>
    );
  }
  return (
    <p className="intention-evidence">
      Current evidence: {evidence.value} plays from {evidence.source}, observed{" "}
      {evidence.observedAt}.
    </p>
  );
}

export function ActiveIntentionControl({
  game,
  active,
  pending,
  onAction,
}: {
  game: Game;
  active: PlayIntention | null;
  pending: boolean;
  onAction: (action: "complete" | "retire") => void;
}) {
  if (active === null) return null;
  return (
    <div className="intention-active">
      <p className="intention-status-label">Active {active.kind} intention</p>
      <p>
        Baseline: {active.baseline.playCount} plays from {active.baseline.evidenceSource}, observed{" "}
        {active.baseline.observedAt}. Intention ID {active.intentionId}, version {active.version}.
      </p>
      <EvidenceStatus game={game} />
      <div className="intention-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => onAction("complete")}
        >
          Mark complete from personal knowledge
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => onAction("retire")}
        >
          Retire intention
        </button>
        <span className="intention-leave-active">Leave active (no change)</span>
      </div>
    </div>
  );
}

export function IntentionControls({
  game: initialGame,
  detail,
}: {
  game: Game;
  detail: GameIntentionDetail;
}) {
  const [state, dispatch] = useReducer(intentionControlReducer, undefined, () =>
    createIntentionControlState(initialGame, detail),
  );
  const generation = useRef(0);
  const statusRef = useRef<HTMLDivElement>(null);
  const playCountRef = useRef<HTMLInputElement>(null);
  const serverSignature = `${initialGame.updatedAt}:${detail.activeIntention?.version ?? "none"}:${detail.resolvedHistory.map(({ intentionId, version }) => `${intentionId}:${version}`).join(",")}`;

  useEffect(() => {
    generation.current += 1;
    dispatch({
      type: "replace-detail",
      generation: generation.current,
      game: initialGame,
      detail,
    });
  }, [serverSignature, initialGame, detail]);

  useEffect(() => {
    focusIntentionControlTarget(state.focusTarget, statusRef, playCountRef);
    if (state.focusTarget !== null) dispatch({ type: "focus-handled" });
  }, [state.focusTarget]);

  function nextGeneration(): number {
    generation.current += 1;
    return generation.current;
  }

  async function runIntention(action: "create" | "complete" | "retire") {
    const requestGeneration = nextGeneration();
    dispatch({ type: "request-start", generation: requestGeneration });
    try {
      const active = state.activeIntention;
      const result =
        action === "create"
          ? await createIntention(state.game.id, eligibleIntentionKind(state.game) ?? "first-play")
          : active === null
            ? null
            : await resolveIntention(state.game.id, active.intentionId, active.version, action);
      if (result === null) {
        dispatch({
          type: "request-failure",
          generation: requestGeneration,
          message: "The active intention changed. Refresh and review before choosing an action.",
        });
        return;
      }
      dispatch({
        type: "intention-result",
        generation: requestGeneration,
        result,
        gameName: state.game.name,
      });
    } catch (error) {
      dispatch({
        type: "request-failure",
        generation: requestGeneration,
        message: error instanceof Error ? error.message : "The intention request failed.",
      });
    }
  }

  async function submitPlayCount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestGeneration = nextGeneration();
    const playCount = Number(state.playCountInput);
    if (state.playCountInput.trim() === "" || !Number.isSafeInteger(playCount) || playCount < 0) {
      dispatch({
        type: "client-validation",
        generation: requestGeneration,
        message: "Enter a nonnegative whole number within the safe integer range.",
      });
      return;
    }
    dispatch({ type: "request-start", generation: requestGeneration });
    try {
      dispatch({
        type: "play-result",
        generation: requestGeneration,
        result: await correctPlayCount(state.game.id, playCount),
        gameName: state.game.name,
      });
    } catch (error) {
      dispatch({
        type: "request-failure",
        generation: requestGeneration,
        message: error instanceof Error ? error.message : "The play-count correction failed.",
      });
    }
  }

  const kind = eligibleIntentionKind(state.game);
  const active = state.activeIntention;
  const fieldIssue = state.fieldIssues.playCount;

  return (
    <>
      <section className="intention-panel" aria-labelledby="play-intention-heading">
        <h2 id="play-intention-heading">Play intention</h2>
        <IntentionFeedback state={state} statusRef={statusRef} />

        {active === null ? (
          <div className="intention-create">
            <EvidenceStatus game={state.game} />
            {kind !== null ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={state.pending}
                onClick={() => void runIntention("create")}
              >
                {state.pending
                  ? "Saving..."
                  : kind === "first-play"
                    ? "Create first-play intention"
                    : "Create replay intention"}
              </button>
            ) : (
              <p className="intention-ineligible">
                {state.game.ownership !== "owned"
                  ? "Only currently owned games can have an active play intention. Mark this game as owned before creating one."
                  : "A valid, current play count is required before Shelf Judge can choose first play or replay."}
              </p>
            )}
          </div>
        ) : (
          <ActiveIntentionControl
            game={state.game}
            active={active}
            pending={state.pending}
            onAction={(action) => void runIntention(action)}
          />
        )}

        {state.game.ownership === "owned" && (
          <div className="play-correction" id="play-count-correction">
            {!state.correctionOpen ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const requestGeneration = nextGeneration();
                  dispatch({ type: "open-correction", generation: requestGeneration });
                }}
              >
                Correct recorded play count
              </button>
            ) : (
              <form onSubmit={(event) => void submitPlayCount(event)} noValidate>
                <label htmlFor="intention-play-count">Recorded play count</label>
                <input
                  ref={playCountRef}
                  id="intention-play-count"
                  name="playCount"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={state.playCountInput}
                  aria-invalid={fieldIssue === undefined ? undefined : true}
                  aria-describedby={
                    fieldIssue === undefined
                      ? "play-count-help"
                      : "play-count-help play-count-error"
                  }
                  onChange={(event) =>
                    dispatch({ type: "play-count-input", value: event.currentTarget.value })
                  }
                />
                <p id="play-count-help" className="intention-help">
                  Works for owned BGG and manual games. A valid increase above the active baseline
                  completes it automatically.
                </p>
                {fieldIssue !== undefined && (
                  <p id="play-count-error" className="field-error">
                    {fieldIssue}
                  </p>
                )}
                <div className="intention-actions">
                  <button type="submit" className="btn btn-primary" disabled={state.pending}>
                    {state.pending ? "Saving..." : "Save play count"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      const requestGeneration = nextGeneration();
                      dispatch({ type: "cancel-correction", generation: requestGeneration });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {state.game.bggId !== null && (
              <a className="game-link intention-refresh-link" href="#bgg-refresh">
                Or refresh current play evidence from BGG
              </a>
            )}
          </div>
        )}
      </section>
      <IntentionHistory history={state.history} />
    </>
  );
}
