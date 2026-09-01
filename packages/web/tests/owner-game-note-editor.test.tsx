import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OwnerGameNote, OwnerGameNoteMutationResult } from "@shelf-judge/shared";
import {
  createOwnerGameNoteEditorState,
  executeOwnerGameNoteCommand,
  focusOwnerGameNoteTarget,
  OwnerGameNoteConflict,
  OwnerGameNoteEditor,
  OwnerGameNoteStateProvider,
  ownerGameNoteEditorReducer,
  ownerGameNoteIsDirty,
  selectLatestOwnerGameNote,
  shouldWarnBeforeOwnerNoteUnload,
} from "@/components/owner-game-note-editor";

const commandId = "44000000-0000-4000-8000-000000000001";
const renewedCommandId = "44000000-0000-4000-8000-000000000002";
const updatedAt = "2026-08-30T12:00:00.000Z";
const missing: OwnerGameNote = { state: "missing", version: 0, updatedAt: null };
const present: OwnerGameNote = {
  state: "present",
  version: 1,
  updatedAt,
  text: "Saved text",
};
const current: OwnerGameNote = {
  state: "present",
  version: 2,
  updatedAt: "2026-08-30T12:05:00.000Z",
  text: "Current server text",
};

const setCommand = {
  operation: "set" as const,
  commandId,
  expectedVersion: 1,
  text: "Local draft",
};

function renderEditor(note: OwnerGameNote): string {
  return renderToStaticMarkup(
    <OwnerGameNoteStateProvider initialNote={note}>
      <OwnerGameNoteEditor gameId="game-1" />
    </OwnerGameNoteStateProvider>,
  );
}

function accepted(
  overrides: Partial<Extract<OwnerGameNoteMutationResult, { ok: true }>["accepted"]> = {},
): OwnerGameNoteMutationResult {
  return {
    ok: true,
    accepted: {
      commandId,
      gameId: "game-1",
      operation: "set",
      state: "present",
      version: 2,
      updatedAt: "2026-08-30T12:06:00.000Z",
      collectionRevision: 3,
      replayed: false,
      alreadyClear: false,
      ...overrides,
    },
  };
}

describe("Owner game note editor reducer", () => {
  test("runCommand omits the UI-only operation discriminator from its strict request", async () => {
    const requests: unknown[] = [];
    const client = {
      set: (_gameId, request) => {
        requests.push(request);
        return Promise.resolve(accepted());
      },
      clear: (_gameId, request) => {
        requests.push(request);
        return Promise.resolve(
          accepted({ operation: "clear", state: "cleared", alreadyClear: false }),
        );
      },
    } satisfies Parameters<typeof executeOwnerGameNoteCommand>[2];
    const setResult = await executeOwnerGameNoteCommand("game-1", setCommand, client);
    const clearResult = await executeOwnerGameNoteCommand(
      "game-1",
      { operation: "clear", commandId, expectedVersion: 1 },
      client,
    );

    expect(setResult.ok).toBe(true);
    expect(clearResult.ok).toBe(true);
    expect(requests).toEqual([
      { commandId, expectedVersion: 1, text: "Local draft" },
      { commandId, expectedVersion: 1 },
    ]);
    expect(requests.every((request) => !Object.hasOwn(request as object, "operation"))).toBe(true);
  });

  test("tracks normalized dirty state and Unicode code points without autosaving", () => {
    let state = createOwnerGameNoteEditorState({ ...present, text: "Line one\n😀" });
    expect(ownerGameNoteIsDirty(state)).toBe(false);
    state = ownerGameNoteEditorReducer(state, { type: "draft-changed", value: "Line one\r\n😀" });
    expect(ownerGameNoteIsDirty(state)).toBe(false);

    const html = renderEditor({ ...present, text: "<script>alert(1)</script>\n😀" });
    expect(html).toContain("Owner note text");
    expect(html).toContain("27 / 10,000 code points");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('aria-describedby="owner-note-help owner-note-count"');
    expect(html).toContain('aria-live="polite"');
  });

  test("preserves the exact command after an ambiguous failure until the request changes", () => {
    let state = createOwnerGameNoteEditorState(present);
    state = ownerGameNoteEditorReducer(state, { type: "draft-changed", value: "Local draft" });
    state = ownerGameNoteEditorReducer(state, {
      type: "request-start",
      generation: 1,
      command: setCommand,
    });
    state = ownerGameNoteEditorReducer(state, {
      type: "request-failure",
      generation: 1,
      message: "Connection lost",
    });
    expect(state.draft).toBe("Local draft");
    expect(state.retryCommand).toEqual(setCommand);
    expect(shouldWarnBeforeOwnerNoteUnload(state)).toBe(true);

    state = ownerGameNoteEditorReducer(state, { type: "draft-changed", value: "Local draft!" });
    expect(state.retryCommand).toBeNull();
    expect(state.draft).toBe("Local draft!");
  });

  test("retains an ambiguous clear identity when only the local draft changes", () => {
    const clearCommand = {
      operation: "clear" as const,
      commandId,
      expectedVersion: 1,
    };
    let state = createOwnerGameNoteEditorState(present);
    state = ownerGameNoteEditorReducer(state, {
      type: "request-start",
      generation: 1,
      command: clearCommand,
    });
    state = ownerGameNoteEditorReducer(state, {
      type: "request-failure",
      generation: 1,
      message: "Connection lost",
    });
    state = ownerGameNoteEditorReducer(state, {
      type: "draft-changed",
      value: "A local draft that is not part of clear",
    });
    expect(state.retryCommand).toEqual(clearCommand);
  });

  test("applies accepted, replayed, clear, and already-clear results without losing metadata", () => {
    let state = createOwnerGameNoteEditorState(present);
    state = ownerGameNoteEditorReducer(state, { type: "draft-changed", value: "Local draft" });
    state = ownerGameNoteEditorReducer(state, {
      type: "request-start",
      generation: 1,
      command: setCommand,
    });
    state = ownerGameNoteEditorReducer(state, {
      type: "request-result",
      generation: 1,
      command: setCommand,
      result: accepted({ replayed: true }),
    });
    expect(state.baseline).toEqual({
      state: "present",
      version: 2,
      updatedAt: "2026-08-30T12:06:00.000Z",
      text: "Local draft",
    });
    expect(state.announcement).toContain("Replayed");
    expect(ownerGameNoteIsDirty(state)).toBe(false);
    expect(state.focusTarget).toBe("region");

    const clearCommand = {
      operation: "clear" as const,
      commandId,
      expectedVersion: 2,
    };
    state = ownerGameNoteEditorReducer(state, {
      type: "request-start",
      generation: 2,
      command: clearCommand,
    });
    state = ownerGameNoteEditorReducer(state, {
      type: "request-result",
      generation: 2,
      command: clearCommand,
      result: accepted({ operation: "clear", state: "cleared", version: 3, alreadyClear: false }),
    });
    expect(state.baseline.state).toBe("cleared");
    expect(state.draft).toBe("");
    expect(state.announcement).toContain("cannot be restored");

    state = ownerGameNoteEditorReducer(createOwnerGameNoteEditorState(missing), {
      type: "request-result",
      generation: 0,
      command: { ...clearCommand, expectedVersion: 0 },
      result: accepted({
        operation: "clear",
        state: "missing",
        version: 0,
        updatedAt: null,
        alreadyClear: true,
      }),
    });
    expect(state.baseline).toEqual(missing);
    expect(state.announcement).toContain("already clear");
  });

  test("preserves both sides of stale conflicts and requires an explicit resolution", () => {
    let state = createOwnerGameNoteEditorState(present);
    state = ownerGameNoteEditorReducer(state, { type: "draft-changed", value: "Local draft" });
    state = ownerGameNoteEditorReducer(state, {
      type: "request-start",
      generation: 1,
      command: setCommand,
    });
    state = ownerGameNoteEditorReducer(state, {
      type: "request-result",
      generation: 1,
      command: setCommand,
      result: {
        ok: false,
        commandId,
        error: { code: "stale-version", gameId: "game-1", expectedVersion: 1, current },
      },
    });
    expect(state.draft).toBe("Local draft");
    expect(state.conflict).toEqual(current);
    expect(state.retryCommand).toBeNull();

    const conflictHtml = renderToStaticMarkup(
      <OwnerGameNoteConflict
        draft={'<img src=x onerror="alert(1)">\nLocal draft'}
        current={current}
        onKeepDraft={() => undefined}
        onLoadSaved={() => undefined}
      />,
    );
    expect(conflictHtml).toContain("Review conflicting note versions");
    expect(conflictHtml).toContain("Local draft");
    expect(conflictHtml).toContain("Current server text");
    expect(conflictHtml).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(conflictHtml).not.toContain("<img");
    expect(conflictHtml).toContain("Keep my draft");
    expect(conflictHtml).toContain("Load saved note");

    const kept = ownerGameNoteEditorReducer(state, {
      type: "keep-draft",
      commandId: renewedCommandId,
    });
    expect(kept.baseline).toEqual(current);
    expect(kept.draft).toBe("Local draft");
    expect(kept.retryCommand).toEqual({
      operation: "set",
      commandId: renewedCommandId,
      expectedVersion: 2,
      text: "Local draft",
    });

    const loaded = ownerGameNoteEditorReducer(state, { type: "load-saved" });
    expect(loaded.draft).toBe("Current server text");
    expect(loaded.conflict).toBeNull();
    expect(ownerGameNoteIsDirty(loaded)).toBe(false);
  });

  test("keeps validation failures and delayed completions from replacing the draft", () => {
    let state = createOwnerGameNoteEditorState(present);
    state = ownerGameNoteEditorReducer(state, { type: "draft-changed", value: "   " });
    state = ownerGameNoteEditorReducer(state, {
      type: "client-validation",
      message: "Note text cannot contain only whitespace",
    });
    expect(state.draft).toBe("   ");
    expect(state.fieldError).toContain("whitespace");
    expect(state.focusTarget).toBe("textarea");

    state = ownerGameNoteEditorReducer(state, {
      type: "request-start",
      generation: 2,
      command: setCommand,
    });
    const pending = state;
    state = ownerGameNoteEditorReducer(state, {
      type: "request-result",
      generation: 1,
      command: setCommand,
      result: accepted(),
    });
    expect(state).toBe(pending);
  });

  test("invalidates an older completion when a newer server note arrives", () => {
    let state = createOwnerGameNoteEditorState(present);
    state = ownerGameNoteEditorReducer(state, { type: "draft-changed", value: "Local draft" });
    state = ownerGameNoteEditorReducer(state, {
      type: "request-start",
      generation: 1,
      command: setCommand,
    });
    state = ownerGameNoteEditorReducer(state, {
      type: "server-note",
      generation: 2,
      note: current,
    });
    expect(state.conflict).toEqual(current);
    expect(state.generation).toBe(2);
    const refreshed = state;
    state = ownerGameNoteEditorReducer(state, {
      type: "request-result",
      generation: 1,
      command: setCommand,
      result: accepted(),
    });
    expect(state).toBe(refreshed);
    expect(state.conflict).toEqual(current);
  });

  test("never lets a late server refresh downgrade accepted note state", () => {
    expect(selectLatestOwnerGameNote(current, present)).toBe(current);
    expect(selectLatestOwnerGameNote(present, current)).toBe(current);
    expect(
      selectLatestOwnerGameNote(present, { ...present, text: "Canonical version one" }),
    ).toEqual({ ...present, text: "Canonical version one" });
  });

  test("renders accessible missing, present, and cleared state controls", () => {
    const missingHtml = renderEditor(missing);
    const presentHtml = renderEditor(present);
    const clearedHtml = renderEditor({ state: "cleared", version: 2, updatedAt });
    expect(missingHtml).toContain("Never authored");
    expect(missingHtml).not.toContain("Clear note");
    expect(presentHtml).toContain("Clear note");
    expect(presentHtml).toContain("Last saved");
    expect(clearedHtml).toContain("Cleared");
    expect(clearedHtml).not.toContain("Clear note");
    expect(presentHtml).toContain('tabindex="-1"');
  });

  test("focuses mutation feedback and textarea targets", () => {
    let focused: string | null = null;
    const region = { current: { focus: () => (focused = "region") } };
    const textarea = { current: { focus: () => (focused = "textarea") } };
    focusOwnerGameNoteTarget("region", region, textarea);
    expect(focused).toBe("region");
    focusOwnerGameNoteTarget("textarea", region, textarea);
    expect(focused).toBe("textarea");
  });

  test("keeps note text and actions responsive without horizontal overflow", async () => {
    const css = await Bun.file(new URL("../app/globals.css", import.meta.url)).text();
    expect(css).toMatch(/\.owner-note-panel \{[\s\S]*?overflow: hidden;/);
    expect(css).toMatch(
      /\.owner-note-panel textarea \{[\s\S]*?font-size: 16px;[\s\S]*?overflow-wrap: anywhere;/,
    );
    expect(css).toMatch(
      /\.owner-note-actions \.btn \{[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.owner-note-conflict-grid \{\s*grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(/\.owner-note-conflict pre \{[\s\S]*?white-space: pre-wrap;/);
  });
});
