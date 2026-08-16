import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

const React = await import("react");
const refresh = mock(() => undefined);
let states: unknown[] = [];
let stateIndex = 0;

void mock.module("react", () => ({
  ...React,
  useCallback: <T,>(callback: T) => callback,
  useState: <T,>(initial: T) => {
    const index = stateIndex++;
    if (states.length <= index) states[index] = initial;
    return [states[index] as T, (value: T) => (states[index] = value)] as const;
  },
}));

void mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { ShelfAssignmentForm } = await import("../components/shelf-assignment-form");
type ShelfAssignmentFields =
  typeof import("../components/shelf-assignment-form").ShelfAssignmentFields;

function renderForm(
  overrides: Partial<Parameters<typeof ShelfAssignmentForm>[0]> = {},
): ReactElement<Parameters<ShelfAssignmentFields>[0]> {
  stateIndex = 0;
  return ShelfAssignmentForm({
    gameId: "game-1",
    currentShelfId: "shelf-a",
    options: [
      { shelfId: "shelf-a", label: "Room — A", dimensionless: false },
      { shelfId: "shelf-b", label: "Room — B", dimensionless: false },
    ],
    hasDimensions: true,
    isPreviouslyOwned: false,
    ...overrides,
  }) as ReactElement<Parameters<ShelfAssignmentFields>[0]>;
}

async function flushMutation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  states = [];
  stateIndex = 0;
  refresh.mockClear();
  mock.restore();
});

describe("ShelfAssignmentForm stateful interaction", () => {
  test("wires selection through the request, saving state, and refresh", async () => {
    let resolveRequest!: (response: Response) => void;
    const request = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = mock(() => request);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let form = renderForm();
    form.props.onSelectionChange?.("shelf-b");
    form = renderForm();
    expect(form.props.selectedShelfId).toBe("shelf-b");

    form.props.onSave?.();
    form = renderForm();
    expect(form.props.saving).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ shelfId: "shelf-b" }),
    });

    resolveRequest(new Response("{}", { status: 200 }));
    await flushMutation();
    form = renderForm();
    expect(form.props.saving).toBe(false);
    expect(form.props.error).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("surfaces a mutation error through component state without refreshing", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Shelf unavailable" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    let form = renderForm();
    form.props.onSave?.();
    await flushMutation();
    form = renderForm();

    expect(form.props.saving).toBe(false);
    expect(form.props.error).toBe("Shelf unavailable");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("allows a stale manual assignment to be cleared when manual choices are blocked", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let form = renderForm({ hasDimensions: false });
    expect(form.props.selectedShelfId).toBe("shelf-a");
    form.props.onSelectionChange?.("");
    form = renderForm({ hasDimensions: false });
    expect(form.props.selectedShelfId).toBe("");

    form.props.onSave?.();
    await flushMutation();

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ shelfId: null }),
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("allows a previously-owned game's stale manual assignment to be cleared", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let form = renderForm({ isPreviouslyOwned: true });
    expect(form.props.selectedShelfId).toBe("shelf-a");
    form.props.onSelectionChange?.("");
    form = renderForm({ isPreviouslyOwned: true });
    expect(form.props.selectedShelfId).toBe("");

    form.props.onSave?.();
    await flushMutation();

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ shelfId: null }),
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
