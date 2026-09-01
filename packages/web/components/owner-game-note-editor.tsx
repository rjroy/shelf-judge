"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  countOwnerGameNoteCodePoints,
  normalizeOwnerGameNoteText,
  OWNER_GAME_NOTE_MAX_CODE_POINTS,
  OwnerGameNoteTextSchema,
  type OwnerGameNote,
  type OwnerGameNoteMutationError,
  type OwnerGameNoteMutationResult,
  type OwnerGameNoteSetRequest,
  type OwnerGameNoteClearRequest,
} from "@shelf-judge/shared";
import { generateBrowserUuid } from "@/lib/browser-uuid";
import { clearOwnerGameNote, setOwnerGameNote } from "@/lib/browser-mutations";

type NoteCommand =
  | ({ operation: "set" } & OwnerGameNoteSetRequest)
  | ({ operation: "clear" } & OwnerGameNoteClearRequest);
type NoteFocusTarget = "region" | "textarea" | null;

interface FocusableTarget {
  focus(): void;
}

export interface OwnerGameNoteEditorState {
  generation: number;
  baseline: OwnerGameNote;
  draft: string;
  conflict: OwnerGameNote | null;
  pending: NoteCommand | null;
  retryCommand: NoteCommand | null;
  fieldError: string | null;
  error: string | null;
  announcement: string | null;
  focusTarget: NoteFocusTarget;
}

export type OwnerGameNoteEditorAction =
  | { type: "draft-changed"; value: string }
  | { type: "client-validation"; message: string }
  | { type: "request-start"; generation: number; command: NoteCommand }
  | {
      type: "request-result";
      generation: number;
      command: NoteCommand;
      result: OwnerGameNoteMutationResult;
    }
  | { type: "request-failure"; generation: number; message: string }
  | { type: "keep-draft"; commandId: string }
  | { type: "load-saved" }
  | { type: "server-note"; generation: number; note: OwnerGameNote }
  | { type: "focus-handled" };

function noteText(note: OwnerGameNote): string {
  return note.state === "present" ? note.text : "";
}

export function ownerGameNoteIsDirty(state: OwnerGameNoteEditorState): boolean {
  return normalizeOwnerGameNoteText(state.draft) !== noteText(state.baseline);
}

export function createOwnerGameNoteEditorState(note: OwnerGameNote): OwnerGameNoteEditorState {
  return {
    generation: 0,
    baseline: note,
    draft: noteText(note),
    conflict: null,
    pending: null,
    retryCommand: null,
    fieldError: null,
    error: null,
    announcement: null,
    focusTarget: null,
  };
}

function commandMatchesState(command: NoteCommand, state: OwnerGameNoteEditorState): boolean {
  if (command.expectedVersion !== state.baseline.version) return false;
  return command.operation === "clear" || command.text === normalizeOwnerGameNoteText(state.draft);
}

function fieldIssue(error: OwnerGameNoteMutationError): string | null {
  if (error.code !== "validation") return null;
  return (
    error.issues.find(({ field }) => field === "text")?.message ?? error.issues[0]?.message ?? null
  );
}

function errorMessage(error: OwnerGameNoteMutationError): string {
  switch (error.code) {
    case "validation":
      return "Review the note text and try again.";
    case "game-not-found":
      return "This game is no longer available. Refresh and review the current page.";
    case "stale-version":
      return "The saved note changed after this editor was opened. Review both versions below.";
    case "command-reuse":
      return "This save identity was already used for a different request. Review the draft before trying again.";
    case "version-overflow":
      return "The note cannot be changed because its version limit was reached.";
    case "persistence-failure":
      return error.message;
  }
}

function acceptedNote(
  command: NoteCommand,
  result: Extract<OwnerGameNoteMutationResult, { ok: true }>,
): OwnerGameNote {
  const accepted = result.accepted;
  if (command.operation === "set") {
    if (accepted.updatedAt === null)
      throw new Error("Accepted set result omitted its update time.");
    return {
      state: "present",
      version: accepted.version,
      updatedAt: accepted.updatedAt,
      text: command.text,
    };
  }
  if (accepted.state === "missing") {
    return { state: "missing", version: 0, updatedAt: null };
  }
  if (accepted.updatedAt === null)
    throw new Error("Accepted clear result omitted its update time.");
  return { state: "cleared", version: accepted.version, updatedAt: accepted.updatedAt };
}

export function ownerGameNoteEditorReducer(
  state: OwnerGameNoteEditorState,
  action: OwnerGameNoteEditorAction,
): OwnerGameNoteEditorState {
  if (
    "generation" in action &&
    action.type !== "request-start" &&
    action.type !== "server-note" &&
    action.generation !== state.generation
  ) {
    return state;
  }

  switch (action.type) {
    case "draft-changed": {
      const next = {
        ...state,
        draft: action.value,
        fieldError: null,
        error: null,
        announcement: null,
      };
      return {
        ...next,
        retryCommand:
          state.retryCommand !== null && commandMatchesState(state.retryCommand, next)
            ? state.retryCommand
            : null,
      };
    }
    case "client-validation":
      return {
        ...state,
        pending: null,
        fieldError: action.message,
        error: "Review the note text and try again.",
        announcement: null,
        focusTarget: "textarea",
      };
    case "request-start":
      return {
        ...state,
        generation: action.generation,
        pending: action.command,
        retryCommand: action.command,
        fieldError: null,
        error: null,
        announcement: null,
        focusTarget: null,
      };
    case "request-failure":
      return {
        ...state,
        pending: null,
        error: action.message,
        announcement: null,
        focusTarget: "region",
      };
    case "request-result": {
      if (!action.result.ok) {
        const mutationError = action.result.error;
        const staleCurrent = mutationError.code === "stale-version" ? mutationError.current : null;
        return {
          ...state,
          pending: null,
          retryCommand: null,
          conflict: staleCurrent ?? state.conflict,
          fieldError: fieldIssue(mutationError),
          error: errorMessage(mutationError),
          announcement: null,
          focusTarget: fieldIssue(mutationError) === null ? "region" : "textarea",
        };
      }
      const baseline = acceptedNote(action.command, action.result);
      const replayed = action.result.accepted.replayed
        ? " Replayed the original accepted command."
        : "";
      const alreadyClear = action.result.accepted.alreadyClear;
      return {
        ...state,
        baseline,
        draft: noteText(baseline),
        conflict: null,
        pending: null,
        retryCommand: null,
        fieldError: null,
        error: null,
        announcement:
          action.command.operation === "set"
            ? `Owner note saved.${replayed}`
            : alreadyClear
              ? `Owner note was already clear.${replayed}`
              : `Owner note cleared. Its prior text cannot be restored by Shelf Judge.${replayed}`,
        focusTarget: "region",
      };
    }
    case "keep-draft": {
      if (state.conflict === null) return state;
      const baseline = state.conflict;
      return {
        ...state,
        baseline,
        conflict: null,
        retryCommand: {
          operation: "set",
          commandId: action.commandId,
          expectedVersion: baseline.version,
          text: normalizeOwnerGameNoteText(state.draft),
        },
        error: null,
        announcement: "Saved version adopted. Review your draft, then save it as a new command.",
        focusTarget: "textarea",
      };
    }
    case "load-saved": {
      if (state.conflict === null) return state;
      const baseline = state.conflict;
      return {
        ...state,
        baseline,
        draft: noteText(baseline),
        conflict: null,
        retryCommand: null,
        fieldError: null,
        error: null,
        announcement: "Loaded the current saved note and discarded the local draft.",
        focusTarget: "textarea",
      };
    }
    case "server-note": {
      if (action.note.version === state.baseline.version) return state;
      if (ownerGameNoteIsDirty(state)) {
        return {
          ...state,
          generation: action.generation,
          conflict: action.note,
          pending: null,
          retryCommand: null,
          error: "The saved note changed while this draft was open. Review both versions below.",
          focusTarget: "region",
        };
      }
      return { ...createOwnerGameNoteEditorState(action.note), generation: action.generation };
    }
    case "focus-handled":
      return { ...state, focusTarget: null };
  }
}

export function focusOwnerGameNoteTarget(
  target: NoteFocusTarget,
  region: RefObject<FocusableTarget | null>,
  textarea: RefObject<FocusableTarget | null>,
): void {
  if (target === "region") region.current?.focus();
  if (target === "textarea") textarea.current?.focus();
}

export function shouldWarnBeforeOwnerNoteUnload(state: OwnerGameNoteEditorState): boolean {
  return ownerGameNoteIsDirty(state) || state.pending !== null;
}

interface OwnerGameNoteStateValue {
  note: OwnerGameNote;
  setNote: Dispatch<SetStateAction<OwnerGameNote>>;
}

const OwnerGameNoteStateContext = createContext<OwnerGameNoteStateValue | null>(null);

export function OwnerGameNoteStateProvider({
  initialNote,
  children,
}: {
  initialNote: OwnerGameNote;
  children: ReactNode;
}) {
  const [note, setNote] = useState(initialNote);
  const signature = `${initialNote.state}:${initialNote.version}:${initialNote.updatedAt ?? ""}`;
  useEffect(
    () => setNote((current) => selectLatestOwnerGameNote(current, initialNote)),
    [signature, initialNote],
  );
  return (
    <OwnerGameNoteStateContext value={{ note, setNote }}>{children}</OwnerGameNoteStateContext>
  );
}

export function selectLatestOwnerGameNote(
  current: OwnerGameNote,
  incoming: OwnerGameNote,
): OwnerGameNote {
  return incoming.version >= current.version ? incoming : current;
}

export function useOwnerGameNoteState(): OwnerGameNoteStateValue {
  const value = useContext(OwnerGameNoteStateContext);
  if (value === null) throw new Error("Owner game note controls require their state provider.");
  return value;
}

export function OwnerGameNoteConflict({
  draft,
  current,
  onKeepDraft,
  onLoadSaved,
}: {
  draft: string;
  current: OwnerGameNote;
  onKeepDraft: () => void;
  onLoadSaved: () => void;
}) {
  return (
    <div className="owner-note-conflict" role="group" aria-labelledby="owner-note-conflict-heading">
      <h3 id="owner-note-conflict-heading">Review conflicting note versions</h3>
      <p>Ordinary save is disabled until you choose which version to continue with.</p>
      <div className="owner-note-conflict-grid">
        <div>
          <h4>Your local draft</h4>
          <pre>{draft}</pre>
        </div>
        <div>
          <h4>Current saved note, version {current.version}</h4>
          <pre>{noteText(current) || "(No current text)"}</pre>
        </div>
      </div>
      <div className="owner-note-actions">
        <button type="button" className="btn btn-primary" onClick={onKeepDraft}>
          Keep my draft
        </button>
        <button type="button" className="btn btn-secondary" onClick={onLoadSaved}>
          Load saved note
        </button>
      </div>
    </div>
  );
}

export function OwnerGameNoteEditor({
  gameId,
  createCommandId = generateBrowserUuid,
}: {
  gameId: string;
  createCommandId?: () => string;
}) {
  const { note: initialNote, setNote } = useOwnerGameNoteState();
  const [state, dispatch] = useReducer(
    ownerGameNoteEditorReducer,
    initialNote,
    createOwnerGameNoteEditorState,
  );
  const generation = useRef(0);
  const regionRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialSignature = `${initialNote.state}:${initialNote.version}:${initialNote.updatedAt ?? ""}`;
  const dirty = ownerGameNoteIsDirty(state);
  const count = countOwnerGameNoteCodePoints(normalizeOwnerGameNoteText(state.draft));
  const conflict = state.conflict;

  useEffect(() => {
    const baselineSignature = `${state.baseline.state}:${state.baseline.version}:${state.baseline.updatedAt ?? ""}`;
    if (initialSignature === baselineSignature) return;
    generation.current += 1;
    dispatch({ type: "server-note", generation: generation.current, note: initialNote });
  }, [initialSignature, initialNote, state.baseline]);

  useEffect(() => {
    if (!shouldWarnBeforeOwnerNoteUnload(state)) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty, state.pending, state]);

  useEffect(() => {
    focusOwnerGameNoteTarget(state.focusTarget, regionRef, textareaRef);
    if (state.focusTarget !== null) dispatch({ type: "focus-handled" });
  }, [state.focusTarget]);

  function nextGeneration(): number {
    generation.current += 1;
    return generation.current;
  }

  async function runCommand(command: NoteCommand): Promise<void> {
    const requestGeneration = nextGeneration();
    dispatch({ type: "request-start", generation: requestGeneration, command });
    try {
      const result =
        command.operation === "set"
          ? await setOwnerGameNote(gameId, command)
          : await clearOwnerGameNote(gameId, command);
      if (requestGeneration !== generation.current) return;
      if (result.ok) {
        const accepted = acceptedNote(command, result);
        setNote((current) => selectLatestOwnerGameNote(current, accepted));
      } else if (result.error.code === "stale-version") {
        const staleCurrent = result.error.current;
        setNote((current) => selectLatestOwnerGameNote(current, staleCurrent));
      }
      dispatch({ type: "request-result", generation: requestGeneration, command, result });
    } catch (error) {
      dispatch({
        type: "request-failure",
        generation: requestGeneration,
        message:
          error instanceof Error
            ? `${error.message} Retry without changing the request to reuse the same command identity.`
            : "The owner note request failed. Retry without changing it to reuse the same command identity.",
      });
    }
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = OwnerGameNoteTextSchema.safeParse(state.draft);
    if (!parsed.success) {
      dispatch({
        type: "client-validation",
        message: parsed.error.issues[0]?.message ?? "Invalid note text",
      });
      return;
    }
    const retry = state.retryCommand;
    const command: NoteCommand =
      retry !== null && retry.operation === "set" && commandMatchesState(retry, state)
        ? retry
        : {
            operation: "set",
            commandId: createCommandId(),
            expectedVersion: state.baseline.version,
            text: parsed.data,
          };
    void runCommand(command);
  }

  function clear(): void {
    const warning = dirty
      ? "Clear the saved Owner note and discard the unsaved draft? Prior text cannot be restored by Shelf Judge."
      : "Clear this Owner note? Its prior text cannot be restored by Shelf Judge.";
    if (!confirm(warning)) return;
    const retry = state.retryCommand;
    const command: NoteCommand =
      retry?.operation === "clear" && retry.expectedVersion === state.baseline.version
        ? retry
        : {
            operation: "clear",
            commandId: createCommandId(),
            expectedVersion: state.baseline.version,
          };
    void runCommand(command);
  }

  function loadSaved(): void {
    if (conflict === null) return;
    if (
      normalizeOwnerGameNoteText(state.draft) !== noteText(conflict) &&
      !confirm("Discard your local draft and load the current saved note?")
    ) {
      return;
    }
    dispatch({ type: "load-saved" });
  }

  const describedBy = [
    "owner-note-help",
    "owner-note-count",
    state.fieldError ? "owner-note-error" : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");

  return (
    <section
      ref={regionRef}
      tabIndex={-1}
      className="owner-note-panel"
      aria-labelledby="owner-note-heading"
    >
      <div className="owner-note-heading-row">
        <h2 id="owner-note-heading">Owner note</h2>
        <span className={`owner-note-state owner-note-state-${state.baseline.state}`}>
          {state.baseline.state === "missing"
            ? "Never authored"
            : state.baseline.state === "cleared"
              ? "Cleared"
              : "Saved"}
        </span>
      </div>
      <p id="owner-note-help" className="owner-note-help">
        Private owner-authored context for this game. Plain text only; saving is explicit.
        {state.baseline.updatedAt !== null && ` Last saved ${state.baseline.updatedAt}.`}
      </p>

      <div className="owner-note-live-status" aria-live="polite">
        {state.announcement}
        {state.error !== null && (
          <div className="error-banner" role="alert">
            {state.error}
          </div>
        )}
      </div>

      <form onSubmit={save} noValidate>
        <label htmlFor="owner-note-text">Owner note text</label>
        <textarea
          ref={textareaRef}
          id="owner-note-text"
          name="text"
          rows={8}
          value={state.draft}
          aria-describedby={describedBy}
          aria-invalid={state.fieldError === null ? undefined : true}
          disabled={state.pending !== null}
          onChange={(event) =>
            dispatch({ type: "draft-changed", value: event.currentTarget.value })
          }
        />
        <div className="owner-note-meta">
          <span className="owner-note-dirty-status">
            {state.pending !== null
              ? "Saving request pending"
              : dirty
                ? "Unsaved changes"
                : "No unsaved changes"}
          </span>
          <span
            id="owner-note-count"
            className={count > OWNER_GAME_NOTE_MAX_CODE_POINTS ? "field-error" : undefined}
          >
            {count.toLocaleString()} / {OWNER_GAME_NOTE_MAX_CODE_POINTS.toLocaleString()} code
            points
          </span>
        </div>
        {state.fieldError !== null && (
          <p id="owner-note-error" className="field-error">
            {state.fieldError}
          </p>
        )}
        <div className="owner-note-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!dirty || state.pending !== null || conflict !== null}
          >
            {state.pending?.operation === "set" ? "Saving..." : "Save note"}
          </button>
          {state.baseline.state === "present" && (
            <button
              type="button"
              className="btn btn-danger-outline"
              disabled={state.pending !== null || conflict !== null}
              onClick={clear}
            >
              {state.pending?.operation === "clear" ? "Clearing..." : "Clear note"}
            </button>
          )}
        </div>
      </form>

      {conflict !== null && (
        <OwnerGameNoteConflict
          draft={state.draft}
          current={conflict}
          onKeepDraft={() => dispatch({ type: "keep-draft", commandId: createCommandId() })}
          onLoadSaved={loadSaved}
        />
      )}
    </section>
  );
}
