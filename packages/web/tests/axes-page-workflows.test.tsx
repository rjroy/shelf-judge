import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  getDerivedFieldDiscovery,
  type Axis,
  type DerivedFieldDiscoveryResponse,
} from "@shelf-judge/shared";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import AxesPage from "@/app/axes/page";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const discovery: DerivedFieldDiscoveryResponse = {
  version: 1,
  fields: getDerivedFieldDiscovery().fields.filter(
    (field) => field.id === "playerCountFit" || field.id === "playingTime",
  ),
};

const axes: Axis[] = [
  {
    id: "player-axis",
    name: "Player Count Fit",
    description: null,
    enabled: true,
    source: "derived",
    derivedField: "playerCountFit",
    configuration: { targetPlayerCount: 4 },
    weight: 50,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "play-axis",
    name: "Play Time",
    description: null,
    enabled: true,
    source: "derived",
    derivedField: "playingTime",
    configuration: { maximumScoringTime: 240 },
    weight: 50,
    preferenceShape: "sweet-spot",
    idealValue: 90,
    toleranceWidth: 30,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "legacy-axis",
    name: "Old Duration",
    description: null,
    enabled: false,
    source: "legacy",
    reason: "Unknown historical field",
    legacyField: "duration",
    legacyPayload: { bggField: "duration" },
    weight: 50,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const originalFetch = globalThis.fetch;
const originalConfirm = globalThis.confirm;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(init.body) as unknown;
}

function successfulFetch() {
  return mock((input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    if (init?.method) return Promise.resolve(json({}));
    if (url === "/api/daemon/axes") return Promise.resolve(json(axes));
    if (url === "/api/daemon/games") {
      return Promise.resolve(json([{ game: { id: "game-1", ratings: { "legacy-axis": 8 } } }]));
    }
    if (url === "/api/daemon/axes/derived-fields") return Promise.resolve(json(discovery));
    throw new Error(`Unexpected request: ${url}`);
  });
}

async function flushMutation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadPage(fetchMock = successfulFetch()): Promise<{
  renderer: ReactTestRenderer;
  fetchMock: ReturnType<typeof successfulFetch>;
}> {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<AxesPage />);
    await flushMutation();
  });
  if (!renderer) throw new Error("Expected axes page renderer");
  return { renderer, fetchMock };
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

function card(renderer: ReactTestRenderer, axisId: string): ReactTestInstance {
  return renderer.root.findByProps({ "data-axis-id": axisId });
}

function button(scope: ReactTestInstance, label: string | RegExp): ReactTestInstance {
  const match = scope.findAllByType("button").find((candidate) => {
    const content = text(candidate);
    return typeof label === "string" ? content === label : label.test(content);
  });
  if (!match) throw new Error(`Expected button ${String(label)}`);
  return match;
}

function changeInput(renderer: ReactTestRenderer, id: string, value: string): void {
  const input = renderer.root.findByProps({ id });
  act(() => input.props.onChange({ target: { value } }));
}

async function clickAndFlush(target: ReactTestInstance): Promise<void> {
  await act(async () => {
    target.props.onClick();
    await flushMutation();
  });
}

async function submitCreate(renderer: ReactTestRenderer): Promise<void> {
  const form = renderer.root.findByType("form");
  await act(async () => {
    form.props.onSubmit({ preventDefault: () => undefined });
    await flushMutation();
  });
}

function mutationBodies(fetchMock: ReturnType<typeof successfulFetch>, method: string): unknown[] {
  return fetchMock.mock.calls
    .filter((call) => call[1]?.method === method)
    .map((call) => requestBody(call[1]));
}

function deferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function validationError(
  code: "invalid_target_player_count" | "invalid_maximum_scoring_time",
  message: string,
  property: "targetPlayerCount" | "maximumScoringTime",
): Response {
  return json(
    {
      code,
      message,
      details: [{ field: property, path: ["configuration", property] }],
    },
    400,
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.confirm = originalConfirm;
});

describe("AxesPage production workflows", () => {
  test("creates both discovered templates at configuration boundaries and permits duplicates", async () => {
    const { renderer, fetchMock } = await loadPage();
    act(() => button(renderer.root, "+ New Axis").props.onClick());

    expect(renderer.root.findByProps({ className: "main-scroll" })).toBeDefined();
    expect(renderer.root.findByProps({ className: "axes-content" })).toBeDefined();
    expect(renderer.root.findByProps({ className: "template-picker" }).props.role).toBe("group");
    expect(button(renderer.root, /Personal axis/).props["aria-pressed"]).toBe(true);

    act(() => button(renderer.root, /Player Count FitScores/).props.onClick());
    expect(button(renderer.root, /Player Count FitScores/).props["aria-pressed"]).toBe(true);
    const targetInput = renderer.root.findByProps({
      id: "create-axis-configuration-targetPlayerCount",
    });
    expect(targetInput.props).toMatchObject({ required: true, min: 1, max: 100 });
    changeInput(renderer, "create-axis-configuration-targetPlayerCount", "100");
    await submitCreate(renderer);

    act(() => button(renderer.root, /Player Count FitScores/).props.onClick());
    changeInput(renderer, "create-axis-configuration-targetPlayerCount", "1");
    await submitCreate(renderer);

    act(() => button(renderer.root, /Play TimeScores/).props.onClick());
    const capInput = renderer.root.findByProps({
      id: "create-axis-configuration-maximumScoringTime",
    });
    expect(capInput.props).toMatchObject({ required: true, min: 60, max: 1440 });
    changeInput(renderer, "create-axis-configuration-maximumScoringTime", "1440");
    await submitCreate(renderer);

    expect(mutationBodies(fetchMock, "POST")).toEqual([
      expect.objectContaining({
        source: "derived",
        derivedField: "playerCountFit",
        configuration: { targetPlayerCount: 100 },
      }),
      expect.objectContaining({
        source: "derived",
        derivedField: "playerCountFit",
        configuration: { targetPlayerCount: 1 },
      }),
      expect.objectContaining({
        source: "derived",
        derivedField: "playingTime",
        configuration: { maximumScoringTime: 1440 },
        idealValue: 90,
        toleranceWidth: 30,
      }),
    ]);
  });

  test("updates Player Count Fit and Play Time through rendered production cards", async () => {
    const { renderer, fetchMock } = await loadPage();

    act(() => button(card(renderer, "player-axis"), "Edit").props.onClick());
    changeInput(renderer, "edit-player-axis-configuration-targetPlayerCount", "100");
    await clickAndFlush(button(card(renderer, "player-axis"), "Save"));

    act(() => button(card(renderer, "play-axis"), "Edit").props.onClick());
    changeInput(renderer, "edit-play-axis-configuration-maximumScoringTime", "1440");
    await clickAndFlush(button(card(renderer, "play-axis"), "Save"));

    expect(mutationBodies(fetchMock, "PUT")).toEqual([
      expect.objectContaining({ configuration: { targetPlayerCount: 100 } }),
      expect.objectContaining({ configuration: { maximumScoringTime: 1440 } }),
    ]);
  });

  test("repairs and deletes a disabled legacy axis through production workflows", async () => {
    globalThis.confirm = mock(() => true);
    const { renderer, fetchMock } = await loadPage();

    act(() => button(card(renderer, "legacy-axis"), "Repair").props.onClick());
    const repairSelect = card(renderer, "legacy-axis").findByType("select");
    act(() => repairSelect.props.onChange({ target: { value: "playingTime" } }));
    changeInput(renderer, "repair-legacy-axis-configuration-maximumScoringTime", "60");
    await clickAndFlush(button(card(renderer, "legacy-axis"), "Repair Axis"));
    await clickAndFlush(button(card(renderer, "legacy-axis"), "Delete"));

    const repair = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/daemon/axes/legacy-axis/repair",
    );
    expect(requestBody(repair?.[1])).toEqual(
      expect.objectContaining({
        derivedField: "playingTime",
        configuration: { maximumScoringTime: 60 },
      }),
    );
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(true);
  });

  test("associates structured server errors with the rejected configuration input", async () => {
    const fetchMock = successfulFetch();
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          validationError(
            "invalid_target_player_count",
            "Target is outside the supported range.",
            "targetPlayerCount",
          ),
        );
      }
      const url = requestUrl(input);
      if (url === "/api/daemon/axes") return Promise.resolve(json(axes));
      if (url === "/api/daemon/games") return Promise.resolve(json([]));
      if (url === "/api/daemon/axes/derived-fields") return Promise.resolve(json(discovery));
      throw new Error(`Unexpected request: ${url}`);
    });
    const { renderer } = await loadPage(fetchMock);
    act(() => button(renderer.root, "+ New Axis").props.onClick());
    act(() => button(renderer.root, /Player Count FitScores/).props.onClick());
    changeInput(renderer, "create-axis-configuration-targetPlayerCount", "100");
    await submitCreate(renderer);

    const input = renderer.root.findByProps({
      id: "create-axis-configuration-targetPlayerCount",
    });
    expect(input.props["aria-invalid"]).toBe(true);
    expect(input.props["aria-describedby"]).toBe(
      "create-axis-configuration-targetPlayerCount-error",
    );
    expect(
      text(
        renderer.root.findByProps({
          id: "create-axis-configuration-targetPlayerCount-error",
        }),
      ),
    ).toBe("Enter a whole number within the displayed bounds.");
    expect(text(renderer.root)).toContain("Target is outside the supported range.");
  });

  test("keeps create errors scoped when opening an edit workflow", async () => {
    const fetchMock = successfulFetch();
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          validationError(
            "invalid_target_player_count",
            "Target is outside the supported range.",
            "targetPlayerCount",
          ),
        );
      }
      const url = requestUrl(input);
      if (url === "/api/daemon/axes") return Promise.resolve(json(axes));
      if (url === "/api/daemon/games") return Promise.resolve(json([]));
      if (url === "/api/daemon/axes/derived-fields") return Promise.resolve(json(discovery));
      throw new Error(`Unexpected request: ${url}`);
    });
    const { renderer } = await loadPage(fetchMock);
    act(() => button(renderer.root, "+ New Axis").props.onClick());
    act(() => button(renderer.root, /Player Count FitScores/).props.onClick());
    changeInput(renderer, "create-axis-configuration-targetPlayerCount", "100");
    await submitCreate(renderer);

    act(() => button(card(renderer, "player-axis"), "Edit").props.onClick());
    const editInput = renderer.root.findByProps({
      id: "edit-player-axis-configuration-targetPlayerCount",
    });
    const createInput = renderer.root.findByProps({
      id: "create-axis-configuration-targetPlayerCount",
    });
    expect(editInput.props["aria-invalid"]).toBeUndefined();
    expect(editInput.props["aria-describedby"]).toBeUndefined();
    expect(createInput.props["aria-invalid"]).toBe(true);
  });

  test("does not apply a late create response to an edit form", async () => {
    const createResponse = deferredResponse();
    const fetchMock = successfulFetch();
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST" && requestUrl(input) === "/api/daemon/axes") {
        return createResponse.promise;
      }
      const url = requestUrl(input);
      if (url === "/api/daemon/axes") return Promise.resolve(json(axes));
      if (url === "/api/daemon/games") return Promise.resolve(json([]));
      if (url === "/api/daemon/axes/derived-fields") return Promise.resolve(json(discovery));
      throw new Error(`Unexpected request: ${url}`);
    });
    const { renderer } = await loadPage(fetchMock);
    act(() => button(renderer.root, "+ New Axis").props.onClick());
    act(() => button(renderer.root, /Player Count FitScores/).props.onClick());
    act(() => {
      renderer.root.findByType("form").props.onSubmit({ preventDefault: () => undefined });
    });
    act(() => button(card(renderer, "player-axis"), "Edit").props.onClick());

    await act(async () => {
      createResponse.resolve(
        validationError(
          "invalid_target_player_count",
          "The late create request was rejected.",
          "targetPlayerCount",
        ),
      );
      await flushMutation();
    });

    expect(text(card(renderer, "player-axis"))).not.toContain(
      "The late create request was rejected.",
    );
    expect(
      renderer.root.findByProps({
        id: "edit-player-axis-configuration-targetPlayerCount",
      }).props["aria-invalid"],
    ).toBeUndefined();
  });

  test("ignores an in-flight update response after cancellation and reopening", async () => {
    const updateResponse = deferredResponse();
    const fetchMock = successfulFetch();
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      if (init?.method === "PUT" && url === "/api/daemon/axes/player-axis") {
        return updateResponse.promise;
      }
      if (url === "/api/daemon/axes") return Promise.resolve(json(axes));
      if (url === "/api/daemon/games") return Promise.resolve(json([]));
      if (url === "/api/daemon/axes/derived-fields") return Promise.resolve(json(discovery));
      throw new Error(`Unexpected request: ${url}`);
    });
    const { renderer } = await loadPage(fetchMock);
    act(() => button(card(renderer, "player-axis"), "Edit").props.onClick());
    act(() => button(card(renderer, "player-axis"), "Save").props.onClick());
    act(() => button(card(renderer, "player-axis"), "Cancel").props.onClick());
    act(() => button(card(renderer, "player-axis"), "Edit").props.onClick());

    await act(async () => {
      updateResponse.resolve(
        validationError(
          "invalid_target_player_count",
          "The cancelled update was rejected late.",
          "targetPlayerCount",
        ),
      );
      await flushMutation();
    });

    expect(text(card(renderer, "player-axis"))).not.toContain(
      "The cancelled update was rejected late.",
    );
  });

  test("isolates update and repair errors when responses complete out of order", async () => {
    const updateResponse = deferredResponse();
    const repairResponse = deferredResponse();
    const fetchMock = successfulFetch();
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      if (init?.method === "PUT" && url === "/api/daemon/axes/player-axis") {
        return updateResponse.promise;
      }
      if (init?.method === "POST" && url === "/api/daemon/axes/legacy-axis/repair") {
        return repairResponse.promise;
      }
      if (url === "/api/daemon/axes") return Promise.resolve(json(axes));
      if (url === "/api/daemon/games") return Promise.resolve(json([]));
      if (url === "/api/daemon/axes/derived-fields") return Promise.resolve(json(discovery));
      throw new Error(`Unexpected request: ${url}`);
    });
    globalThis.confirm = mock(() => true);
    const { renderer } = await loadPage(fetchMock);

    act(() => button(card(renderer, "player-axis"), "Edit").props.onClick());
    act(() => button(card(renderer, "player-axis"), "Save").props.onClick());
    act(() => button(card(renderer, "legacy-axis"), "Repair").props.onClick());
    const repairSelect = card(renderer, "legacy-axis").findByType("select");
    act(() => repairSelect.props.onChange({ target: { value: "playingTime" } }));
    act(() => button(card(renderer, "legacy-axis"), "Repair Axis").props.onClick());

    await act(async () => {
      repairResponse.resolve(
        validationError(
          "invalid_maximum_scoring_time",
          "The repair cap was rejected.",
          "maximumScoringTime",
        ),
      );
      await flushMutation();
    });
    await act(async () => {
      updateResponse.resolve(
        validationError(
          "invalid_target_player_count",
          "The late update target was rejected.",
          "targetPlayerCount",
        ),
      );
      await flushMutation();
    });

    const playerText = text(card(renderer, "player-axis"));
    const legacyText = text(card(renderer, "legacy-axis"));
    expect(playerText).toContain("The late update target was rejected.");
    expect(playerText).toContain("Enter a whole number within the displayed bounds.");
    expect(legacyText).toContain("The repair cap was rejected.");
    expect(legacyText).toContain("Enter a whole number within the displayed bounds.");
    expect(playerText).not.toContain("The repair cap was rejected.");
    expect(legacyText).not.toContain("The late update target was rejected.");
  });
});
