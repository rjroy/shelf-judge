import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, jsonRequest, type TestAppContext } from "../helpers/test-app.js";
import type { Axis, AxisSource, Game } from "@shelf-judge/shared";

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
  });

  describe("GET /api/axes", () => {
    test("returns all axes including default BGG axes", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/axes");

      expect(res.status).toBe(200);
      const axes = (await res.json()) as Axis[];
      expect(Array.isArray(axes)).toBe(true);
      // Default collection has 2 BGG axes
      expect(axes.length).toBe(2);
      const sources = axes.map((a) => a.source);
      expect(sources.every((s: AxisSource) => s === "bgg")).toBe(true);
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
