import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createManualGameValueFieldState,
  manualGameValueFieldReducer,
  ManualGameValuesFormContent,
  mutateManualGameValues,
} from "@/components/manual-game-values-form";

describe("ManualGameValuesForm", () => {
  test("renders native units, source evidence, independent controls, and associations", () => {
    const html = renderToStaticMarkup(
      <ManualGameValuesFormContent
        gameId="game-1"
        values={{
          playingTime: { value: 90, source: "manual", confirmedAt: "initial-time" },
          playerCount: null,
        }}
        sourcePlayingTime={60}
        sourcePlayerCount={2}
        refresh={() => undefined}
      />,
    );

    expect(html).toContain("Play Time (minutes)");
    expect(html).toContain("Save Play Time");
    expect(html).toContain("Clear Play Time");
    expect(html).toContain("Save Player Count");
    expect(html).toContain("Clear Player Count");
    expect(html).toContain('class="manual-game-value-control"');
    expect(html).toContain('class="manual-game-value-label"');
    expect(html).toContain('class="manual-game-value-input"');
    expect(html).toContain('class="manual-game-value-actions"');
    expect(html).toContain('class="manual-game-value-status"');
    expect(html).toContain('class="btn btn-secondary"');
    expect(html).toMatch(/<label class="manual-game-value-label" for="[^"]+-input">/);
    expect(html).toMatch(/aria-describedby="[^\"]+-playing-time-status"/);
    expect(html).toMatch(/aria-describedby="[^\"]+-player-count-status"/);
    expect(html).toMatch(
      /id="[^\"]+-playing-time-status" class="manual-game-value-status"><\/div>/,
    );
    expect(html).toMatch(
      /id="[^\"]+-player-count-status" class="manual-game-value-status"><\/div>/,
    );
    expect(html).toContain("BGG play time: 60");
    expect(html).toContain("BGG player count: 2");
  });

  test("sends the exact single-field mutation body", async () => {
    const request = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response("{}"));
    });

    await mutateManualGameValues("game-1", { playingTime: 120 }, request);
    await mutateManualGameValues("game-1", { playerCount: null }, request);

    const firstInit = request.mock.calls[0]?.[1];
    const secondInit = request.mock.calls[1]?.[1];
    expect(firstInit?.body).toBe(JSON.stringify({ playingTime: 120 }));
    expect(secondInit?.body).toBe(JSON.stringify({ playerCount: null }));
  });

  test("reconciles clean, dirty, and pending fields against new props", () => {
    const initial = createManualGameValueFieldState("90");
    const clean = manualGameValueFieldReducer(initial, { type: "sync", value: "100" });
    expect(clean).toMatchObject({ draft: "100", baseline: "100" });

    const dirty = manualGameValueFieldReducer(
      manualGameValueFieldReducer(initial, { type: "change", value: "125" }),
      { type: "sync", value: "100" },
    );
    expect(dirty).toMatchObject({ draft: "125", baseline: "100", status: "idle" });

    const pending = manualGameValueFieldReducer(
      manualGameValueFieldReducer(initial, { type: "saving" }),
      { type: "sync", value: "100" },
    );
    expect(pending).toMatchObject({ draft: "90", baseline: "100", status: "saving" });
  });

  test("failed clear preserves the exact dirty draft and newest baseline", () => {
    let state = createManualGameValueFieldState("90");
    state = manualGameValueFieldReducer(state, { type: "change", value: "125" });
    state = manualGameValueFieldReducer(state, { type: "clearing" });
    state = manualGameValueFieldReducer(state, { type: "sync", value: "100" });
    state = manualGameValueFieldReducer(state, { type: "failed", error: "Clear failed" });

    expect(state).toEqual({
      draft: "125",
      baseline: "100",
      status: "idle",
      error: "Clear failed",
    });
  });

  test("uses shared parent tracks and keeps idle status regions out of the layout", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

    expect(css).toContain(".manual-game-values-form {");
    expect(css).toContain(
      "grid-template-columns: minmax(9.5rem, 1fr) minmax(7rem, 8rem) max-content max-content;",
    );
    expect(css).toContain(".manual-game-value-control {");
    expect(css).toContain("grid-template-columns: subgrid;");
    expect(css).toContain(".manual-game-value-actions {\n  display: contents;");
    expect(css).toContain(".manual-game-value-status:empty {\n  display: none;");
    expect(css).toContain("@container (max-width: 540px)");
    expect(css).toContain("@container (max-width: 400px)");
  });
});
