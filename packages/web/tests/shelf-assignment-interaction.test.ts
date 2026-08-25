import { describe, expect, mock, test } from "bun:test";
import {
  shelfAssignmentReducer,
  submitShelfAssignment,
  type ShelfAssignmentState,
} from "../components/shelf-assignment-form";

const initial: ShelfAssignmentState = {
  selectedShelfId: "shelf-a",
  saving: false,
  error: null,
};

describe("ShelfAssignmentForm state", () => {
  test("tracks selection and saving state", () => {
    const selected = shelfAssignmentReducer(initial, { type: "select", shelfId: "shelf-b" });
    const saving = shelfAssignmentReducer(selected, { type: "save-started" });
    const finished = shelfAssignmentReducer(saving, { type: "save-finished" });

    expect(selected.selectedShelfId).toBe("shelf-b");
    expect(saving).toMatchObject({ saving: true, error: null });
    expect(finished.saving).toBe(false);
  });

  test("wires selection through the request, saving state, and refresh", async () => {
    let state = shelfAssignmentReducer(initial, { type: "select", shelfId: "shelf-b" });
    const dispatch = (action: Parameters<typeof shelfAssignmentReducer>[1]) => {
      state = shelfAssignmentReducer(state, action);
    };
    let resolveRequest: ((response: Response) => void) | undefined;
    const requestPromise = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const requestMock = mock((input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return requestPromise;
    });
    const refresh = mock(() => undefined);

    const submission = submitShelfAssignment({
      gameId: "game-1",
      selectedShelfId: state.selectedShelfId,
      refresh,
      request: requestMock as unknown as typeof fetch,
      dispatch,
    });
    expect(state.saving).toBe(true);
    resolveRequest?.(new Response("{}", { status: 200 }));
    await submission;

    expect(state).toMatchObject({ selectedShelfId: "shelf-b", saving: false, error: null });
    expect(requestMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ shelfId: "shelf-b" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("surfaces a mutation error and leaves the form usable", () => {
    const saving = shelfAssignmentReducer(initial, { type: "save-started" });
    const failed = shelfAssignmentReducer(saving, {
      type: "save-failed",
      error: "Shelf unavailable",
    });

    expect(failed).toMatchObject({ saving: false, error: "Shelf unavailable" });
  });

  test("allows stale assignments to be cleared before restriction checks", () => {
    const cleared = shelfAssignmentReducer(initial, { type: "select", shelfId: "" });
    expect(cleared.selectedShelfId).toBe("");
  });
});
