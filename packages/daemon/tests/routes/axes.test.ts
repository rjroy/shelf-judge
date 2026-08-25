import { beforeEach, describe, expect, test } from "bun:test";
import {
  AXIS_VALIDATION_CODES,
  getDerivedFieldDiscovery,
  type Axis,
  type DisabledLegacyAxis,
} from "@shelf-judge/shared";
import { createTestApp, jsonRequest, type TestAppContext } from "../helpers/test-app.js";

interface CodedErrorBody {
  error: string;
  message: string;
  code: string;
  details: { field: string; path: (string | number)[] }[];
}

const disabled: DisabledLegacyAxis = {
  id: "legacy-axis",
  name: "Legacy",
  description: null,
  weight: 50,
  enabled: false,
  source: "legacy",
  reason: "unknown_legacy_field",
  legacyField: "futureMetric",
  legacyPayload: { originalField: "futureMetric" },
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
};

describe("axis routes", () => {
  let ctx: TestAppContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  test("creates personal and duplicate derived axes", async () => {
    const personal = await jsonRequest(ctx.app, "POST", "/api/axes", {
      name: "Fun",
      weight: 50,
      source: "personal",
    });
    expect(personal.status).toBe(201);
    expect((await personal.json()) as Axis).toMatchObject({ source: "personal" });

    const payload = {
      name: "At four",
      weight: 40,
      source: "derived",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 4 },
    };
    expect((await jsonRequest(ctx.app, "POST", "/api/axes", payload)).status).toBe(201);
    expect((await jsonRequest(ctx.app, "POST", "/api/axes", payload)).status).toBe(201);
  });

  test.each([
    {
      derivedField: "communityRating",
      configuration: {},
      curve: {},
    },
    {
      derivedField: "weight",
      configuration: {},
      curve: {},
    },
    {
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 4 },
      curve: {},
    },
    {
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 240 },
      curve: { preferenceShape: "sweet-spot", idealValue: 90, toleranceWidth: 30 },
    },
  ])(
    "creates the $derivedField derived template",
    async ({ derivedField, configuration, curve }) => {
      const response = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: derivedField,
        weight: 50,
        source: "derived",
        derivedField,
        configuration,
        ...curve,
      });
      expect(response.status).toBe(201);
      expect((await response.json()) as Axis).toMatchObject({
        enabled: true,
        source: "derived",
        derivedField,
        configuration,
      });
    },
  );

  test("discovery response equals the shared registry projection exactly", async () => {
    const response = await jsonRequest(ctx.app, "GET", "/api/axes/derived-fields");
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual(getDerivedFieldDiscovery());
    expect(new Set(getDerivedFieldDiscovery().fields.map(({ id }) => id)).size).toBe(
      getDerivedFieldDiscovery().fields.length,
    );
  });

  test("returns stable coded create errors without message inference", async () => {
    const response = await jsonRequest(ctx.app, "POST", "/api/axes", {
      name: "Bad target",
      weight: 50,
      source: "derived",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 0 },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as CodedErrorBody;
    expect(body).toMatchObject({
      error: "Validation failed",
      code: AXIS_VALIDATION_CODES.INVALID_TARGET_PLAYER_COUNT,
    });
    expect(body.message).toBeString();
    expect(body.details).toEqual([
      { field: "targetPlayerCount", path: ["configuration", "targetPlayerCount"] },
    ]);
  });

  test.each([
    {
      name: "unknown field",
      payload: {
        name: "Unknown",
        weight: 50,
        source: "derived",
        derivedField: "futureMetric",
        configuration: {},
      },
      code: AXIS_VALIDATION_CODES.UNKNOWN_DERIVED_FIELD,
      field: "derivedField",
    },
    {
      name: "missing configuration",
      payload: {
        name: "Players",
        weight: 50,
        source: "derived",
        derivedField: "playerCountFit",
        configuration: {},
      },
      code: AXIS_VALIDATION_CODES.MISSING_DERIVED_CONFIGURATION,
      field: "targetPlayerCount",
    },
    {
      name: "unsupported configuration",
      payload: {
        name: "Community",
        weight: 50,
        source: "derived",
        derivedField: "communityRating",
        configuration: { targetPlayerCount: 4 },
      },
      code: AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
      field: "configuration",
    },
    {
      name: "invalid maximum scoring time",
      payload: {
        name: "Time",
        weight: 50,
        source: "derived",
        derivedField: "playingTime",
        configuration: { maximumScoringTime: 59 },
      },
      code: AXIS_VALIDATION_CODES.INVALID_MAXIMUM_SCORING_TIME,
      field: "maximumScoringTime",
    },
  ])("routes $name with its stable code", async ({ payload, code, field }) => {
    const response = await jsonRequest(ctx.app, "POST", "/api/axes", payload);
    expect(response.status).toBe(400);
    const body = (await response.json()) as CodedErrorBody;
    expect(body.error).toBe("Validation failed");
    expect(body.code).toBe(code);
    expect(body.details.map((detail) => detail.field)).toContain(field);
  });

  test("returns stable invalid-payload errors for malformed JSON and tournament create", async () => {
    const malformed = await ctx.app.request("http://localhost/api/axes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()) as CodedErrorBody).toMatchObject({
      code: AXIS_VALIDATION_CODES.INVALID_AXIS_PAYLOAD,
    });

    const tournament = await jsonRequest(ctx.app, "POST", "/api/axes", {
      name: "Tournament",
      weight: 30,
      source: "tournament",
    });
    expect(tournament.status).toBe(400);
    expect((await tournament.json()) as CodedErrorBody).toMatchObject({
      code: AXIS_VALIDATION_CODES.INVALID_AXIS_PAYLOAD,
    });
  });

  test("routes merged update validation with stable code and details", async () => {
    const createdResponse = await jsonRequest(ctx.app, "POST", "/api/axes", {
      name: "Time",
      weight: 50,
      source: "derived",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 240 },
      preferenceShape: "sweet-spot",
      idealValue: 90,
      toleranceWidth: 30,
      veto: { direction: "above", threshold: 180 },
    });
    const created = (await createdResponse.json()) as Axis;
    const response = await jsonRequest(ctx.app, "PUT", `/api/axes/${created.id}`, {
      configuration: { maximumScoringTime: 120 },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as CodedErrorBody;
    expect(body.code).toBe(AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE);
    expect(body.details.map(({ field }) => field)).toContain("veto");
  });

  test("returns 404 for update and repair of unknown axes", async () => {
    expect(
      (await jsonRequest(ctx.app, "PUT", "/api/axes/missing", { name: "Missing" })).status,
    ).toBe(404);
    expect(
      (
        await jsonRequest(ctx.app, "POST", "/api/axes/missing/repair", {
          derivedField: "communityRating",
          configuration: {},
        })
      ).status,
    ).toBe(404);
  });

  test("lists and repairs disabled legacy axes", async () => {
    const collection = await ctx.storageService.loadCollection();
    await ctx.storageService.saveCollection({
      ...collection,
      axes: [...collection.axes, disabled],
    });
    const list = (await (await jsonRequest(ctx.app, "GET", "/api/axes")).json()) as Axis[];
    expect(list.find(({ id }) => id === disabled.id)).toMatchObject({ enabled: false });

    const repair = await jsonRequest(ctx.app, "POST", `/api/axes/${disabled.id}/repair`, {
      derivedField: "communityRating",
      configuration: {},
    });
    expect(repair.status).toBe(200);
    expect((await repair.json()) as Axis).toMatchObject({
      id: disabled.id,
      source: "derived",
      derivedField: "communityRating",
    });

    const repeatedRepair = await jsonRequest(ctx.app, "POST", `/api/axes/${disabled.id}/repair`, {
      derivedField: "communityRating",
      configuration: {},
    });
    expect(repeatedRepair.status).toBe(400);
    expect((await repeatedRepair.json()) as CodedErrorBody).toMatchObject({
      code: AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR,
    });
  });

  test("deletes a disabled legacy axis and its ratings through DELETE", async () => {
    const gameResponse = await jsonRequest(ctx.app, "POST", "/api/games", { name: "Game" });
    const gameBody = (await gameResponse.json()) as { game: { id: string } };
    const collection = await ctx.storageService.loadCollection();
    const game = collection.games.find(({ id }) => id === gameBody.game.id);
    expect(game).toBeDefined();
    if (game === undefined) return;
    game.ratings[disabled.id] = 8;
    await ctx.storageService.saveCollection({
      ...collection,
      axes: [...collection.axes, disabled],
    });

    const response = await jsonRequest(ctx.app, "DELETE", `/api/axes/${disabled.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deletedRatingsCount: 1 });
    const persisted = await ctx.storageService.loadCollection();
    expect(persisted.axes.some(({ id }) => id === disabled.id)).toBe(false);
    expect(persisted.games[0]?.ratings[disabled.id]).toBeUndefined();
  });

  test("routes repair validation as invalid legacy repair", async () => {
    const collection = await ctx.storageService.loadCollection();
    await ctx.storageService.saveCollection({
      ...collection,
      axes: [...collection.axes, disabled],
    });
    const response = await jsonRequest(ctx.app, "POST", `/api/axes/${disabled.id}/repair`, {
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 60 },
      preferenceShape: "sweet-spot",
      idealValue: 90,
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as CodedErrorBody).toMatchObject({
      code: AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR,
    });
  });

  test("returns 500 for persistence failures", async () => {
    ctx.storageService.saveCollection = () => Promise.reject(new Error("disk failed"));
    const response = await jsonRequest(ctx.app, "POST", "/api/axes", {
      name: "Fun",
      weight: 50,
      source: "personal",
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "disk failed" });
  });

  test("protects tournament deletion with a coded response", async () => {
    const axes = (await (await jsonRequest(ctx.app, "GET", "/api/axes")).json()) as Axis[];
    const tournament = axes.find((axis) => axis.source === "tournament");
    expect(tournament).toBeDefined();
    if (tournament === undefined) return;
    const response = await jsonRequest(ctx.app, "DELETE", `/api/axes/${tournament.id}`);
    expect(response.status).toBe(400);
    expect((await response.json()) as CodedErrorBody).toMatchObject({
      code: AXIS_VALIDATION_CODES.TOURNAMENT_AXIS_MANAGED,
    });
  });

  test("rating mutation rejects a disabled axis with a stable code and preserves its rating", async () => {
    const gameResponse = await jsonRequest(ctx.app, "POST", "/api/games", { name: "Game" });
    const gameBody = (await gameResponse.json()) as { game: { id: string } };
    const collection = await ctx.storageService.loadCollection();
    const game = collection.games.find(({ id }) => id === gameBody.game.id);
    expect(game).toBeDefined();
    if (game === undefined) return;
    game.ratings[disabled.id] = 8;
    await ctx.storageService.saveCollection({
      ...collection,
      axes: [...collection.axes, disabled],
    });

    const response = await jsonRequest(ctx.app, "PUT", `/api/games/${gameBody.game.id}/ratings`, {
      ratings: { [disabled.id]: 5 },
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as CodedErrorBody).toMatchObject({
      code: AXIS_VALIDATION_CODES.DISABLED_LEGACY_AXIS,
    });
    const unchanged = (await ctx.storageService.loadCollection()).games.find(
      ({ id }) => id === gameBody.game.id,
    );
    expect(unchanged?.ratings[disabled.id]).toBe(8);
  });
});
