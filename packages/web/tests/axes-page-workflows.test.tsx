import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  getDerivedFieldDiscovery,
  type Axis,
  type DerivedFieldDiscoveryResponse,
} from "@shelf-judge/shared";
import type { ReactElement, ReactNode, SetStateAction } from "react";

const React = await import("react");
let states: unknown[] = [];
let stateIndex = 0;
let effects: Array<() => void> = [];
let effectIndex = 0;
let refs: Array<{ current: unknown }> = [];
let refIndex = 0;

void mock.module("react", () => ({
  ...React,
  useState: <T,>(initial: T | (() => T)) => {
    const index = stateIndex++;
    if (states.length <= index) {
      states[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    }
    const setState = (value: SetStateAction<T>) => {
      states[index] =
        typeof value === "function" ? (value as (previous: T) => T)(states[index] as T) : value;
    };
    return [states[index] as T, setState] as const;
  },
  useEffect: (effect: () => void) => {
    const index = effectIndex++;
    effects[index] ??= effect;
  },
  useRef: <T,>(initial: T) => {
    const index = refIndex++;
    refs[index] ??= { current: initial };
    return refs[index] as { current: T };
  },
}));

const { AxisCard, LegacyAxisCard, default: AxesPage } = await import("@/app/axes/page");

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

function renderPage(): ReactElement<Record<string, unknown>> {
  stateIndex = 0;
  effectIndex = 0;
  refIndex = 0;
  return AxesPage() as ReactElement<Record<string, unknown>>;
}

async function loadPage(): Promise<ReactElement<Record<string, unknown>>> {
  renderPage();
  effects[0]?.();
  await flushMutation();
  return renderPage();
}

function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) {
    if (Array.isArray(node)) return node.flatMap(descendants);
    return [];
  }
  const own = [node];
  if (typeof node.type === "function") {
    const rendered = node.type(node.props) as ReactNode;
    return [...own, ...descendants(rendered)];
  }
  return [...own, ...descendants(node.props.children as ReactNode)];
}

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<Record<string, unknown>>(node)) {
    if (typeof node.type === "function") return text(node.type(node.props) as ReactNode);
    return text(node.props.children as ReactNode);
  }
  return "";
}

function findElement(
  root: ReactElement<Record<string, unknown>>,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> {
  const element = descendants(root).find(predicate);
  if (!element) throw new Error("Expected rendered element was not found");
  return element;
}

function click(root: ReactElement<Record<string, unknown>>, label: string): void {
  const button = findElement(
    root,
    (element) => element.type === "button" && text(element) === label,
  );
  (button.props.onClick as () => void)();
}

function changeInput(root: ReactElement<Record<string, unknown>>, id: string, value: string): void {
  const input = findElement(root, (element) => element.type === "input" && element.props.id === id);
  (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}

function submitCreate(root: ReactElement<Record<string, unknown>>): void {
  const form = findElement(root, (element) => element.type === "form");
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
    preventDefault: () => undefined,
  });
}

async function flushMutation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  states = [];
  stateIndex = 0;
  effects = [];
  effectIndex = 0;
  refs = [];
  refIndex = 0;
  globalThis.fetch = originalFetch;
  globalThis.confirm = originalConfirm;
});

describe("AxesPage production workflows", () => {
  test("creates both discovered templates at configuration boundaries and permits duplicates", async () => {
    const fetchMock = successfulFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let page = await loadPage();

    click(page, "+ New Axis");
    page = renderPage();
    expect(
      findElement(page, (element) => element.props.className === "main-scroll").props.className,
    ).toBe("main-scroll");
    expect(
      findElement(page, (element) => element.props.className === "axes-content").props.className,
    ).toBe("axes-content");
    expect(
      findElement(page, (element) => element.props.className === "template-picker").props.role,
    ).toBe("group");
    const personalTemplate = findElement(
      page,
      (element) => text(element) === "Personal axisEnter your own 1-10 ratings.",
    );
    expect(personalTemplate.props["aria-pressed"]).toBe(true);

    click(
      page,
      "Player Count FitChecks a target player count against the publisher-declared player range.",
    );
    page = renderPage();
    const selectedPlayerTemplate = findElement(
      page,
      (element) => element.type === "button" && text(element).startsWith("Player Count Fit"),
    );
    expect(selectedPlayerTemplate.props["aria-pressed"]).toBe(true);
    const targetInput = findElement(
      page,
      (element) => element.props.id === "create-axis-configuration-targetPlayerCount",
    );
    expect(targetInput.props).toMatchObject({ required: true, min: 1, max: 100 });
    changeInput(page, "create-axis-configuration-targetPlayerCount", "100");
    page = renderPage();
    submitCreate(page);
    await flushMutation();

    page = renderPage();
    click(
      page,
      "Player Count FitChecks a target player count against the publisher-declared player range.",
    );
    page = renderPage();
    changeInput(page, "create-axis-configuration-targetPlayerCount", "1");
    page = renderPage();
    submitCreate(page);
    await flushMutation();

    page = renderPage();
    click(page, "Play TimeScores publisher-listed playing time against your preferred duration.");
    page = renderPage();
    const capInput = findElement(
      page,
      (element) => element.props.id === "create-axis-configuration-maximumScoringTime",
    );
    expect(capInput.props).toMatchObject({ required: true, min: 60, max: 1440 });
    changeInput(page, "create-axis-configuration-maximumScoringTime", "1440");
    page = renderPage();
    submitCreate(page);
    await flushMutation();

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
    const fetchMock = successfulFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let page = await loadPage();
    const playerCard = findElement(
      page,
      (element) => element.type === AxisCard && (element.props.axis as Axis).id === "player-axis",
    );
    (playerCard.props.onStartEdit as () => void)();
    page = renderPage();
    changeInput(page, "edit-player-axis-configuration-targetPlayerCount", "100");
    page = renderPage();
    click(page, "Save");
    await flushMutation();

    page = renderPage();
    const playCard = findElement(
      page,
      (element) => element.type === AxisCard && (element.props.axis as Axis).id === "play-axis",
    );
    (playCard.props.onStartEdit as () => void)();
    page = renderPage();
    changeInput(page, "edit-play-axis-configuration-maximumScoringTime", "1440");
    page = renderPage();
    click(page, "Save");
    await flushMutation();

    expect(mutationBodies(fetchMock, "PUT")).toEqual([
      expect.objectContaining({ configuration: { targetPlayerCount: 100 } }),
      expect.objectContaining({ configuration: { maximumScoringTime: 1440 } }),
    ]);
  });

  test("repairs and deletes a disabled legacy axis through production workflows", async () => {
    const fetchMock = successfulFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    globalThis.confirm = mock(() => true);
    let page = await loadPage();

    click(page, "Repair");
    page = renderPage();
    const repairSelect = findElement(
      page,
      (element) => element.type === "select" && element.props.value === "playerCountFit",
    );
    (repairSelect.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "playingTime" },
    });
    page = renderPage();
    changeInput(page, "repair-legacy-axis-configuration-maximumScoringTime", "60");
    page = renderPage();
    click(page, "Repair Axis");
    await flushMutation();

    page = renderPage();
    const legacyCard = findElement(page, (element) => element.type === LegacyAxisCard);
    (legacyCard.props.onDelete as () => void)();
    await flushMutation();

    const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts[0]?.[0]).toBe("/api/daemon/axes/legacy-axis/repair");
    expect(requestBody(posts[0]?.[1])).toEqual(
      expect.objectContaining({
        derivedField: "playingTime",
        configuration: { maximumScoringTime: 60 },
      }),
    );
    const deletes = fetchMock.mock.calls.filter((call) => call[1]?.method === "DELETE");
    expect(deletes[0]?.[0]).toBe("/api/daemon/axes/legacy-axis");
  });

  test("associates structured server errors with the rejected configuration input", async () => {
    const fetchMock = successfulFetch();
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          json(
            {
              code: "invalid_target_player_count",
              message: "Target is outside the supported range.",
              details: [
                {
                  field: "targetPlayerCount",
                  path: ["configuration", "targetPlayerCount"],
                },
              ],
            },
            400,
          ),
        );
      }
      const url = requestUrl(input);
      if (url === "/api/daemon/axes") return Promise.resolve(json(axes));
      if (url === "/api/daemon/games") return Promise.resolve(json([]));
      if (url === "/api/daemon/axes/derived-fields") return Promise.resolve(json(discovery));
      throw new Error(`Unexpected request: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let page = await loadPage();
    click(page, "+ New Axis");
    page = renderPage();
    click(
      page,
      "Player Count FitChecks a target player count against the publisher-declared player range.",
    );
    page = renderPage();
    changeInput(page, "create-axis-configuration-targetPlayerCount", "100");
    page = renderPage();
    submitCreate(page);
    await flushMutation();
    page = renderPage();

    const input = findElement(
      page,
      (element) => element.props.id === "create-axis-configuration-targetPlayerCount",
    );
    expect(input.props["aria-invalid"]).toBe(true);
    expect(input.props["aria-describedby"]).toBe(
      "create-axis-configuration-targetPlayerCount-error",
    );
    const error = findElement(
      page,
      (element) => element.props.id === "create-axis-configuration-targetPlayerCount-error",
    );
    expect(text(error)).toBe("Enter a whole number within the displayed bounds.");
    expect(text(page)).toContain("Target is outside the supported range.");
  });

  test("keeps create errors scoped when opening an edit workflow", async () => {
    const fetchMock = successfulFetch();
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          json(
            {
              code: "invalid_target_player_count",
              message: "Target is outside the supported range.",
              details: [
                {
                  field: "targetPlayerCount",
                  path: ["configuration", "targetPlayerCount"],
                },
              ],
            },
            400,
          ),
        );
      }
      const url = requestUrl(input);
      if (url === "/api/daemon/axes") return Promise.resolve(json(axes));
      if (url === "/api/daemon/games") return Promise.resolve(json([]));
      if (url === "/api/daemon/axes/derived-fields") return Promise.resolve(json(discovery));
      throw new Error(`Unexpected request: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let page = await loadPage();
    click(page, "+ New Axis");
    page = renderPage();
    click(
      page,
      "Player Count FitChecks a target player count against the publisher-declared player range.",
    );
    page = renderPage();
    submitCreate(page);
    await flushMutation();
    page = renderPage();
    expect(text(page)).toContain("Target is outside the supported range.");

    const playerCard = findElement(
      page,
      (element) => element.type === AxisCard && (element.props.axis as Axis).id === "player-axis",
    );
    (playerCard.props.onStartEdit as () => void)();
    page = renderPage();

    const editInput = findElement(
      page,
      (element) => element.props.id === "edit-player-axis-configuration-targetPlayerCount",
    );
    expect(editInput.props["aria-invalid"]).toBeUndefined();
    expect(editInput.props["aria-describedby"]).toBeUndefined();
    const createInput = findElement(
      page,
      (element) => element.props.id === "create-axis-configuration-targetPlayerCount",
    );
    expect(createInput.props["aria-invalid"]).toBe(true);
    expect(text(page)).toContain("Target is outside the supported range.");
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
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let page = await loadPage();
    click(page, "+ New Axis");
    page = renderPage();
    click(
      page,
      "Player Count FitChecks a target player count against the publisher-declared player range.",
    );
    page = renderPage();
    submitCreate(page);

    page = renderPage();
    const playerCard = findElement(
      page,
      (element) => element.type === AxisCard && (element.props.axis as Axis).id === "player-axis",
    );
    (playerCard.props.onStartEdit as () => void)();
    createResponse.resolve(
      validationError(
        "invalid_target_player_count",
        "The late create request was rejected.",
        "targetPlayerCount",
      ),
    );
    await flushMutation();
    page = renderPage();

    const editingCard = findElement(
      page,
      (element) => element.type === AxisCard && (element.props.axis as Axis).id === "player-axis",
    );
    expect(editingCard.props.formError).toBeUndefined();
    const editInput = findElement(
      page,
      (element) => element.props.id === "edit-player-axis-configuration-targetPlayerCount",
    );
    expect(editInput.props["aria-invalid"]).toBeUndefined();
    expect(text(editingCard)).not.toContain("The late create request was rejected.");
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
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let page = await loadPage();
    let playerCard = findElement(
      page,
      (element) => element.type === AxisCard && (element.props.axis as Axis).id === "player-axis",
    );
    (playerCard.props.onStartEdit as () => void)();
    page = renderPage();
    click(page, "Save");
    page = renderPage();
    click(page, "Cancel");

    page = renderPage();
    playerCard = findElement(
      page,
      (element) => element.type === AxisCard && (element.props.axis as Axis).id === "player-axis",
    );
    (playerCard.props.onStartEdit as () => void)();
    updateResponse.resolve(
      validationError(
        "invalid_target_player_count",
        "The cancelled update was rejected late.",
        "targetPlayerCount",
      ),
    );
    await flushMutation();
    page = renderPage();

    playerCard = findElement(
      page,
      (element) => element.type === AxisCard && (element.props.axis as Axis).id === "player-axis",
    );
    expect(playerCard.props.formError).toBeUndefined();
    expect(text(playerCard)).not.toContain("The cancelled update was rejected late.");
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
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    globalThis.confirm = mock(() => true);
    let page = await loadPage();

    const playerCard = findElement(
      page,
      (element) => element.type === AxisCard && (element.props.axis as Axis).id === "player-axis",
    );
    (playerCard.props.onStartEdit as () => void)();
    page = renderPage();
    click(page, "Save");

    page = renderPage();
    click(page, "Repair");
    page = renderPage();
    const repairSelect = findElement(page, (element) => element.type === "select");
    (repairSelect.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "playingTime" },
    });
    page = renderPage();
    click(page, "Repair Axis");

    repairResponse.resolve(
      validationError(
        "invalid_maximum_scoring_time",
        "The repair cap was rejected.",
        "maximumScoringTime",
      ),
    );
    await flushMutation();
    updateResponse.resolve(
      validationError(
        "invalid_target_player_count",
        "The late update target was rejected.",
        "targetPlayerCount",
      ),
    );
    await flushMutation();
    page = renderPage();

    const editingCard = findElement(
      page,
      (element) => element.type === AxisCard && (element.props.axis as Axis).id === "player-axis",
    );
    const updateFormError = editingCard.props.formError as {
      summary: string;
      fields: Record<string, string>;
    };
    expect(updateFormError.summary).toContain("The late update target was rejected.");
    expect(updateFormError.fields["configuration.targetPlayerCount"]).toBe(
      "Enter a whole number within the displayed bounds.",
    );
    const legacyCard = findElement(page, (element) => element.type === LegacyAxisCard);
    const repairFormError = legacyCard.props.formError as {
      summary: string;
      fields: Record<string, string>;
    };
    expect(repairFormError.summary).toContain("The repair cap was rejected.");
    expect(repairFormError.fields["configuration.maximumScoringTime"]).toBe(
      "Enter a whole number within the displayed bounds.",
    );
    expect(updateFormError.fields["configuration.maximumScoringTime"]).toBeUndefined();
    expect(repairFormError.fields["configuration.targetPlayerCount"]).toBeUndefined();
  });
});
