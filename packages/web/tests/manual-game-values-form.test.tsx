import { describe, expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createManualGameValuesFormState,
  manualGameValuesFormReducer,
  ManualGameValuesFormContent,
  type ManualGameValuesFormAction,
  type ManualGameValuesFormState,
  ManualGameValuesFormView,
  submitManualGameValues,
} from "@/components/manual-game-values-form";

const populatedValues = {
  playingTime: { value: 90, source: "manual" as const, confirmedAt: "initial-time" },
  playerCount: { value: 4, source: "manual" as const, confirmedAt: "initial-count" },
};

interface InteractiveProps {
  children?: ReactNode;
  "aria-label"?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onClick?: () => void;
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<InteractiveProps>) => boolean,
): ReactElement<InteractiveProps> {
  if (isValidElement(node)) {
    const element = node as ReactElement<InteractiveProps>;
    if (predicate(element)) return element;
    const children = element.props.children;
    const childNodes = Array.isArray(children) ? (children as ReactNode[]) : [children];
    for (const child of childNodes) {
      try {
        return findElement(child, predicate);
      } catch {
        // Continue through siblings until the rendered control is found.
      }
    }
  }
  throw new Error("Rendered control not found");
}

function createRenderedForm(
  request: typeof fetch,
  initialState: ManualGameValuesFormState = createManualGameValuesFormState(populatedValues),
) {
  let state = initialState;
  let submission: Promise<void> | undefined;
  const dispatch = (action: ManualGameValuesFormAction) => {
    state = manualGameValuesFormReducer(state, action);
  };
  const render = () =>
    ManualGameValuesFormView({
      state,
      sourcePlayingTime: 60,
      sourcePlayerCount: 2,
      onChange: (field, value) => dispatch({ type: "change", field, value }),
      onSubmit: (body, field) => {
        submission = submitManualGameValues({
          gameId: "game-1",
          body,
          field,
          dispatch,
          refresh: () => undefined,
          request,
        });
        return submission;
      },
    });
  return {
    render,
    dispatch,
    state: () => state,
    submission: () => submission ?? Promise.resolve(),
  };
}

function changeInput(rendered: ReactNode, label: string, value: string): void {
  findElement(rendered, (element) => element.props["aria-label"] === label).props.onChange?.({
    target: { value },
  });
}

function clickButton(rendered: ReactNode, label: string): void {
  findElement(rendered, (element) => element.props.children === label).props.onClick?.();
}

describe("ManualGameValuesForm", () => {
  test("renders native units, source evidence, and independent clear controls", () => {
    const html = renderToStaticMarkup(
      <ManualGameValuesFormContent
        gameId="game-1"
        values={{
          playingTime: { value: 90, source: "manual", confirmedAt: "2026-01-01" },
          playerCount: null,
        }}
        sourcePlayingTime={60}
        sourcePlayerCount={2}
        refresh={() => undefined}
      />,
    );

    expect(html).toContain("Play Time (minutes)");
    expect(html).toContain('value="90"');
    expect(html).toContain("Player Count");
    expect(html).toContain("Clear Play Time");
    expect(html).toContain("Clear Player Count");
    expect(html).toContain("BGG play time: 60");
    expect(html).toContain("BGG player count: 2");
  });

  test("editing one populated field submits only that field", async () => {
    const request = mock(() => Promise.resolve(new Response("{}")));
    const form = createRenderedForm(request as unknown as typeof fetch);

    changeInput(form.render(), "Play Time (minutes)", "120");
    clickButton(form.render(), "Save Play Details");
    await form.submission();

    expect(request.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ playingTime: 120 }));
    expect(form.state()).toMatchObject({ savedPlayingTime: "120", savedPlayerCount: "4" });
  });

  test("a refreshed prop update changes an untouched field while preserving a dirty field", () => {
    const form = createRenderedForm(fetch);
    changeInput(form.render(), "Play Time (minutes)", "120");

    form.dispatch({ type: "sync", playingTime: "100", playerCount: "5" });

    const html = renderToStaticMarkup(form.render());
    expect(html).toContain('value="120"');
    expect(html).toContain('value="5"');
    expect(form.state()).toMatchObject({
      savedPlayingTime: "100",
      savedPlayerCount: "5",
    });
  });

  test("a failed rendered save remains retryable", async () => {
    let attempt = 0;
    const request = mock(() => {
      attempt += 1;
      return Promise.resolve(
        attempt === 1
          ? new Response(JSON.stringify({ error: "Daemon unavailable" }), { status: 503 })
          : new Response("{}"),
      );
    });
    const form = createRenderedForm(request as unknown as typeof fetch);
    changeInput(form.render(), "Player Count", "6");

    clickButton(form.render(), "Save Play Details");
    await form.submission();
    expect(renderToStaticMarkup(form.render())).toContain("Daemon unavailable");

    clickButton(form.render(), "Save Play Details");
    await form.submission();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ playerCount: 6 }));
    expect(form.state()).toMatchObject({ savedPlayerCount: "6", error: null });
  });

  test("an independent rendered clear sends only its field", async () => {
    const request = mock(() => Promise.resolve(new Response("{}")));
    const form = createRenderedForm(request as unknown as typeof fetch);

    clickButton(form.render(), "Clear Player Count");
    await form.submission();

    expect(request.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ playerCount: null }));
    expect(form.state()).toMatchObject({ playerCount: "", savedPlayerCount: "" });
  });

  test("an in-flight refresh does not overwrite submitted or repeated edits", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const request = mock(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const form = createRenderedForm(request as unknown as typeof fetch);
    changeInput(form.render(), "Play Time (minutes)", "120");
    clickButton(form.render(), "Save Play Details");

    form.dispatch({ type: "sync", playingTime: "95", playerCount: "5" });
    changeInput(form.render(), "Play Time (minutes)", "130");
    resolveRequest?.(new Response("{}"));
    await form.submission();

    expect(form.state()).toMatchObject({
      playingTime: "130",
      savedPlayingTime: "120",
      playerCount: "5",
      savedPlayerCount: "5",
    });
  });
});
