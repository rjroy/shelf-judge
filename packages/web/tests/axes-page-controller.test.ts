import { describe, expect, mock, test } from "bun:test";
import { getDerivedFieldDiscovery, type Axis } from "@shelf-judge/shared";
import {
  AxisFormRequestTracker,
  buildCreateAxisBody,
  buildRepairAxisBody,
  buildUpdateAxisBody,
  createAxis,
  deleteAxis,
  repairAxis,
  updateAxis,
} from "@/lib/axis-page-controller";
import { DEFAULT_CURVE, curveStateFromAxis } from "@/lib/axis-curve-state";
import { configurationDraftFromField } from "@/lib/derived-axis-web";

const discovery = getDerivedFieldDiscovery();
const playerCountField = discovery.fields.find((field) => field.id === "playerCountFit");
const playingTimeField = discovery.fields.find((field) => field.id === "playingTime");
if (!playerCountField || !playingTimeField) throw new Error("Expected derived field discovery");

const playerAxis: Axis = {
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
};

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(init.body) as unknown;
}

describe("axis page controller", () => {
  test("builds discovered create requests at configuration boundaries", () => {
    const playerBody = buildCreateAxisBody({
      name: playerCountField.template.name,
      description: playerCountField.template.description,
      weight: String(playerCountField.template.weight),
      curve: DEFAULT_CURVE,
      derivedField: playerCountField,
      configuration: { targetPlayerCount: "100" },
    });
    const timeBody = buildCreateAxisBody({
      name: playingTimeField.template.name,
      description: playingTimeField.template.description,
      weight: String(playingTimeField.template.weight),
      curve: {
        ...DEFAULT_CURVE,
        shape: playingTimeField.template.preferenceShape,
        idealValue: String(playingTimeField.template.idealValue),
        toleranceWidth: String(playingTimeField.template.toleranceWidth),
      },
      derivedField: playingTimeField,
      configuration: { maximumScoringTime: "1440" },
    });

    expect(playerBody).toMatchObject({
      source: "derived",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 100 },
    });
    expect(timeBody).toMatchObject({
      source: "derived",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 1440 },
      idealValue: 90,
      toleranceWidth: 30,
    });
  });

  test("builds derived update and legacy repair requests", () => {
    expect(
      buildUpdateAxisBody({
        axis: playerAxis,
        name: playerAxis.name,
        description: "",
        weight: "50",
        curve: curveStateFromAxis(playerAxis),
        derivedField: playerCountField,
        configuration: { targetPlayerCount: "1" },
      }),
    ).toMatchObject({ configuration: { targetPlayerCount: 1 } });

    expect(
      buildRepairAxisBody(
        playingTimeField,
        { maximumScoringTime: "60" },
        {
          ...DEFAULT_CURVE,
          shape: "sweet-spot",
          idealValue: "90",
          toleranceWidth: "30",
        },
      ),
    ).toMatchObject({
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 60 },
      idealValue: 90,
      toleranceWidth: 30,
    });
  });

  test("sends create, update, and repair bodies to their production endpoints", async () => {
    const requestMock = mock((input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const request = requestMock as unknown as typeof fetch;
    const createInput = {
      name: playerCountField.template.name,
      description: playerCountField.template.description,
      weight: "50",
      curve: DEFAULT_CURVE,
      derivedField: playerCountField,
      configuration: { targetPlayerCount: "100" },
    };
    const updateInput = {
      axis: playerAxis,
      name: playerAxis.name,
      description: "",
      weight: "50",
      curve: curveStateFromAxis(playerAxis),
      derivedField: playerCountField,
      configuration: { targetPlayerCount: "1" },
    };

    await createAxis(createInput, request);
    await updateAxis(playerAxis.id, updateInput, request);
    await repairAxis(
      "legacy-axis",
      playingTimeField,
      { maximumScoringTime: "60" },
      DEFAULT_CURVE,
      request,
    );
    await deleteAxis("legacy-axis", request);

    expect(requestMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/daemon/axes", "POST"],
      ["/api/daemon/axes/player-axis", "PUT"],
      ["/api/daemon/axes/legacy-axis/repair", "POST"],
      ["/api/daemon/axes/legacy-axis", "DELETE"],
    ]);
    expect(requestMock.mock.calls.slice(0, 3).map(([, init]) => requestBody(init))).toEqual([
      buildCreateAxisBody(createInput),
      buildUpdateAxisBody(updateInput),
      buildRepairAxisBody(playingTimeField, { maximumScoringTime: "60" }, DEFAULT_CURVE),
    ]);
  });

  test("rejects stale responses without coupling independent form scopes", () => {
    const tracker = new AxisFormRequestTracker();
    const firstUpdate = tracker.begin("update:player-axis");
    const repair = tracker.begin("repair:legacy-axis");
    const secondUpdate = tracker.begin("update:player-axis");

    expect(tracker.isCurrent("update:player-axis", firstUpdate)).toBe(false);
    expect(tracker.isCurrent("update:player-axis", secondUpdate)).toBe(true);
    expect(tracker.isCurrent("repair:legacy-axis", repair)).toBe(true);
    expect(tracker.isCurrent("create", firstUpdate)).toBe(false);
  });

  test("uses discovered defaults when preparing update drafts", () => {
    expect(configurationDraftFromField(playerCountField, playerAxis.configuration)).toEqual({
      targetPlayerCount: "4",
    });
  });
});
