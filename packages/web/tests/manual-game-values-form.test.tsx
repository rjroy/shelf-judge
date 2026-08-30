import { describe, expect, mock, test } from "bun:test";
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
    expect(html).toContain('aria-describedby="playing-time-status"');
    expect(html).toContain('aria-describedby="player-count-status"');
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
});
