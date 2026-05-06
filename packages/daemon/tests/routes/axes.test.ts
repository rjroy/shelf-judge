import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, jsonRequest, type TestAppContext } from "../helpers/test-app.js";
import type { Axis, AxisSource, Game, VetoConfig } from "@shelf-judge/shared";

describe("axis routes", () => {
  let ctx: TestAppContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  describe("POST /api/axes", () => {
    test("creates axis and returns 201", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun Factor",
        weight: 50,
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as Axis;
      expect(body.name).toBe("Fun Factor");
      expect(body.weight).toBe(50);
      expect(body.id).toBeString();
      expect(body.source).toBe("personal");
    });

    test("returns 400 for weight exceeding 100", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Too Heavy",
        weight: 101,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Validation failed");
    });

    test("returns 400 for empty name", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "",
        weight: 50,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Validation failed");
    });

    test("rejects a second tournament-source axis (REQ-TAXIS-3)", async () => {
      // The default collection already contains an auto-created tournament axis
      // (REQ-TAXIS-4). Attempting to create another must be rejected.
      const res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Second Tournament",
        weight: 20,
        source: "tournament",
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("tournament_axis_already_exists");
    });
  });

  describe("GET /api/axes", () => {
    test("returns all axes including default BGG axes and the tournament axis", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/axes");

      expect(res.status).toBe(200);
      const axes = (await res.json()) as Axis[];
      expect(Array.isArray(axes)).toBe(true);
      // Default collection has 2 BGG axes + 1 tournament axis (auto-created per REQ-TAXIS-4)
      expect(axes.length).toBe(3);
      const sources = axes.map((a) => a.source);
      expect(sources.filter((s: AxisSource) => s === "bgg")).toHaveLength(2);
      expect(sources.filter((s: AxisSource) => s === "tournament")).toHaveLength(1);
    });
  });

  describe("PUT /api/axes/:id", () => {
    test("updates axis name and weight", async () => {
      // Create an axis first
      const createRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Original",
        weight: 30,
      });
      const created = (await createRes.json()) as Axis;

      const res = await jsonRequest(ctx.app, "PUT", `/api/axes/${created.id}`, {
        name: "Updated",
        weight: 70,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Axis;
      expect(body.name).toBe("Updated");
      expect(body.weight).toBe(70);
    });

    test("returns 404 for nonexistent axis", async () => {
      const res = await jsonRequest(ctx.app, "PUT", "/api/axes/nonexistent-id", { name: "Ghost" });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("not found");
    });
  });

  describe("POST /api/axes - curve configuration", () => {
    test("creates axis with full curve config", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Complexity Preference",
        weight: 40,
        source: "bgg",
        bggField: "weight",
        preferenceShape: "sweet-spot",
        idealValue: 3.0,
        tolerance: "moderate",
        leanDirection: "lower",
      });

      expect(res.status).toBe(201);
      const axis = (await res.json()) as Axis;
      expect(axis.preferenceShape).toBe("sweet-spot");
      expect(axis.idealValue).toBe(3.0);
      expect(axis.tolerance).toBe("moderate");
      expect(axis.leanDirection).toBe("lower");
    });

    test("creates axis with veto config", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Complexity Floor",
        weight: 30,
        source: "bgg",
        bggField: "weight",
        veto: { direction: "above", threshold: 4.0 },
      });

      expect(res.status).toBe(201);
      const axis = (await res.json()) as Axis;
      expect(axis.veto).toEqual({ direction: "above", threshold: 4.0 });
    });

    test("creates axis without curve fields (backward compatible)", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun Factor",
        weight: 50,
      });

      expect(res.status).toBe(201);
      const axis = (await res.json()) as Axis;
      expect(axis.preferenceShape).toBeUndefined();
      expect(axis.idealValue).toBeUndefined();
      expect(axis.veto).toBeUndefined();
    });

    test("returns 400 when sweet-spot idealValue is outside native scale", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Bad Ideal",
        weight: 30,
        source: "bgg",
        bggField: "weight",
        preferenceShape: "sweet-spot",
        idealValue: 7.0, // BGG weight scale is 1-5
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("outside native scale");
    });

    test("returns 400 when sweet-spot is missing idealValue", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Missing Ideal",
        weight: 30,
        preferenceShape: "sweet-spot",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/axes/:id - curve configuration", () => {
    test("updates axis to sweet-spot with idealValue", async () => {
      const createRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Complexity",
        weight: 40,
        source: "bgg",
        bggField: "weight",
      });
      const created = (await createRes.json()) as Axis;

      const res = await jsonRequest(ctx.app, "PUT", `/api/axes/${created.id}`, {
        preferenceShape: "sweet-spot",
        idealValue: 2.5,
        tolerance: "strict",
      });

      expect(res.status).toBe(200);
      const axis = (await res.json()) as Axis;
      expect(axis.preferenceShape).toBe("sweet-spot");
      expect(axis.idealValue).toBe(2.5);
      expect(axis.tolerance).toBe("strict");
    });

    test("updates sweet-spot axis without providing idealValue (uses stored value)", async () => {
      const createRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Complexity",
        weight: 40,
        source: "bgg",
        bggField: "weight",
        preferenceShape: "sweet-spot",
        idealValue: 3.0,
      });
      const created = (await createRes.json()) as Axis;

      // Update tolerance only, idealValue already stored
      const res = await jsonRequest(ctx.app, "PUT", `/api/axes/${created.id}`, {
        tolerance: "flexible",
      });

      expect(res.status).toBe(200);
      const axis = (await res.json()) as Axis;
      expect(axis.idealValue).toBe(3.0);
      expect(axis.tolerance).toBe("flexible");
    });

    test("returns 400 when updating to sweet-spot without idealValue and none stored", async () => {
      const createRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Plain Axis",
        weight: 30,
      });
      const created = (await createRes.json()) as Axis;

      const res = await jsonRequest(ctx.app, "PUT", `/api/axes/${created.id}`, {
        preferenceShape: "sweet-spot",
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("idealValue is required");
    });

    test("clears stale config when changing away from sweet-spot", async () => {
      // Create a sweet-spot axis
      const createRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Complexity",
        weight: 40,
        source: "bgg",
        bggField: "weight",
        preferenceShape: "sweet-spot",
        idealValue: 3.0,
        tolerance: "strict",
        leanDirection: "higher",
      });
      const created = (await createRes.json()) as Axis;

      // Change to higher-is-better
      const res = await jsonRequest(ctx.app, "PUT", `/api/axes/${created.id}`, {
        preferenceShape: "higher-is-better",
      });

      expect(res.status).toBe(200);
      const axis = (await res.json()) as Axis;
      expect(axis.preferenceShape).toBe("higher-is-better");
      expect(axis.idealValue).toBeUndefined();
      expect(axis.tolerance).toBeUndefined();
      expect(axis.leanDirection).toBeUndefined();
    });

    test("adds veto to existing axis", async () => {
      const createRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Complexity",
        weight: 40,
        source: "bgg",
        bggField: "weight",
      });
      const created = (await createRes.json()) as Axis;

      const res = await jsonRequest(ctx.app, "PUT", `/api/axes/${created.id}`, {
        veto: { direction: "below", threshold: 2.0 },
      });

      expect(res.status).toBe(200);
      const axis = (await res.json()) as Axis;
      expect(axis.veto).toEqual({ direction: "below", threshold: 2.0 });
    });

    test("removes veto from existing axis", async () => {
      const createRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Complexity",
        weight: 40,
        source: "bgg",
        bggField: "weight",
        veto: { direction: "below", threshold: 2.0 },
      });
      const created = (await createRes.json()) as Axis;

      const res = await jsonRequest(ctx.app, "PUT", `/api/axes/${created.id}`, {
        veto: null,
      });

      expect(res.status).toBe(200);
      const axis = (await res.json()) as Axis;
      expect(axis.veto).toBeNull();
    });

    test("updates only name without affecting curve fields", async () => {
      const createRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Complexity",
        weight: 40,
        source: "bgg",
        bggField: "weight",
        preferenceShape: "sweet-spot",
        idealValue: 3.0,
        tolerance: "moderate",
        veto: { direction: "above", threshold: 4.5 },
      });
      const created = (await createRes.json()) as Axis;

      const res = await jsonRequest(ctx.app, "PUT", `/api/axes/${created.id}`, {
        name: "Renamed Complexity",
      });

      expect(res.status).toBe(200);
      const axis = (await res.json()) as Axis;
      expect(axis.name).toBe("Renamed Complexity");
      expect(axis.preferenceShape).toBe("sweet-spot");
      expect(axis.idealValue).toBe(3.0);
      expect(axis.tolerance).toBe("moderate");
      expect((axis.veto as VetoConfig).threshold).toBe(4.5);
    });

    test("returns 400 when idealValue is outside native scale on update", async () => {
      const createRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Complexity",
        weight: 40,
        source: "bgg",
        bggField: "weight",
      });
      const created = (await createRes.json()) as Axis;

      const res = await jsonRequest(ctx.app, "PUT", `/api/axes/${created.id}`, {
        preferenceShape: "sweet-spot",
        idealValue: 8.0, // BGG weight is 1-5
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("outside native scale");
    });
  });

  describe("DELETE /api/axes/:id", () => {
    test("returns 200 with deletedRatingsCount", async () => {
      // Create a personal axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Replayability",
        weight: 40,
      });
      expect(axisRes.status).toBe(201);
      const axis = (await axisRes.json()) as Axis;

      // Add a game
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });
      expect(gameRes.status).toBe(201);
      const gameBody = (await gameRes.json()) as { game: Game; bggImported: boolean };
      const gameId = gameBody.game.id;

      // Rate the game on that axis
      const rateRes = await jsonRequest(ctx.app, "PUT", `/api/games/${gameId}/ratings`, {
        ratings: { [axis.id]: 7 },
      });
      expect(rateRes.status).toBe(200);

      // Delete the axis
      const deleteRes = await jsonRequest(ctx.app, "DELETE", `/api/axes/${axis.id}`);

      expect(deleteRes.status).toBe(200);
      const body = (await deleteRes.json()) as { deletedRatingsCount: number };
      expect(body.deletedRatingsCount).toBe(1);
    });
  });
});
