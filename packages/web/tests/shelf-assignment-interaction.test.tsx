import { describe, expect, mock, test } from "bun:test";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { ShelfAssignmentFormContent } from "../components/shelf-assignment-form";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const options = [
  { shelfId: "shelf-a", label: "Room - A", dimensionless: false },
  { shelfId: "shelf-b", label: "Room - B", dimensionless: false },
];

function renderForm({
  request,
  refresh,
  hasDimensions = true,
  isPreviouslyOwned = false,
}: {
  request: typeof fetch;
  refresh: () => void;
  hasDimensions?: boolean;
  isPreviouslyOwned?: boolean;
}): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <ShelfAssignmentFormContent
        gameId="game-1"
        currentShelfId="shelf-a"
        options={options}
        hasDimensions={hasDimensions}
        isPreviouslyOwned={isPreviouslyOwned}
        refresh={refresh}
        request={request}
      />,
    );
  });
  if (!renderer) throw new Error("Expected shelf assignment renderer");
  return renderer;
}

function select(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByType("select");
}

function saveButton(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByType("button");
}

function requestCalls(request: typeof fetch): Array<[string | URL | Request, RequestInit?]> {
  return (
    request as unknown as {
      mock: { calls: Array<[string | URL | Request, RequestInit?]> };
    }
  ).mock.calls;
}

describe("ShelfAssignmentForm stateful interaction", () => {
  test("wires selection through the request, saving state, and refresh", async () => {
    let resolveRequest!: (response: Response) => void;
    const requestPromise = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const request = mock(() => requestPromise) as unknown as typeof fetch;
    const refresh = mock(() => undefined);
    const renderer = renderForm({ request, refresh });

    act(() => select(renderer).props.onChange({ target: { value: "shelf-b" } }));
    expect(select(renderer).props.value).toBe("shelf-b");
    act(() => saveButton(renderer).props.onClick());

    expect(saveButton(renderer).props.disabled).toBe(true);
    expect(saveButton(renderer).props.children).toBe("Saving...");
    expect(request).toHaveBeenCalledTimes(1);
    expect(requestCalls(request)[0]?.[1]).toMatchObject({
      body: JSON.stringify({ shelfId: "shelf-b" }),
    });

    await act(async () => {
      resolveRequest(new Response("{}", { status: 200 }));
      await requestPromise;
    });
    expect(saveButton(renderer).props.disabled).toBe(false);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("surfaces a mutation error through component state without refreshing", async () => {
    const request = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Shelf unavailable" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;
    const refresh = mock(() => undefined);
    const renderer = renderForm({ request, refresh });

    await act(async () => {
      saveButton(renderer).props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain(
      "Shelf unavailable",
    );
    expect(saveButton(renderer).props.disabled).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  for (const restriction of [
    { label: "missing dimensions", hasDimensions: false, isPreviouslyOwned: false },
    { label: "previous ownership", hasDimensions: true, isPreviouslyOwned: true },
  ]) {
    test(`allows a stale manual assignment to be cleared despite ${restriction.label}`, async () => {
      const request = mock(() =>
        Promise.resolve(new Response("{}", { status: 200 })),
      ) as unknown as typeof fetch;
      const refresh = mock(() => undefined);
      const renderer = renderForm({ request, refresh, ...restriction });

      act(() => select(renderer).props.onChange({ target: { value: "" } }));
      await act(async () => {
        saveButton(renderer).props.onClick();
        await Promise.resolve();
      });

      expect(requestCalls(request)[0]?.[1]).toMatchObject({
        body: JSON.stringify({ shelfId: null }),
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  }
});
