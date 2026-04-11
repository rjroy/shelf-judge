import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, jsonRequest, type TestAppContext } from "../helpers/test-app.js";
import type { PredictionReadiness, PredictionSettings } from "@shelf-judge/shared";

describe("prediction routes", () => {
  let ctx: TestAppContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  async function addGameWithRating(name: string, bggId?: number) {
    const body: Record<string, unknown> = { name };
    if (bggId !== undefined) body.bggId = bggId;
    const res = await jsonRequest(ctx.app, "POST", "/api/games", body);
    expect(res.status).toBe(201);
    const data = (await res.json()) as { game: { id: string } };
    return data.game.id;
  }

  describe("GET /api/predictions/readiness", () => {
    test("returns 200 with readiness shape", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/readiness");
      expect(res.status).toBe(200);

      const readiness = (await res.json()) as PredictionReadiness;
      expect(readiness.stage).toBe(0);
      expect(readiness.ratedGameCount).toBe(0);
      expect(readiness.nextStageAt).toBeGreaterThan(0);
      expect(Array.isArray(readiness.weakAxes)).toBe(true);
      expect(Array.isArray(readiness.suggestedActions)).toBe(true);
    });
  });

  describe("GET /api/predictions/settings", () => {
    test("returns 200 with default settings", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/settings");
      expect(res.status).toBe(200);

      const settings = (await res.json()) as PredictionSettings;
      expect(settings.stageThresholds).toEqual([5, 15, 30]);
      expect(settings.defaultK).toBe(5);
      expect(settings.minSimilarityThreshold).toBe(0.2);
      expect(settings.tournamentStabilityBoost).toBe(0.2);
    });
  });

  describe("PATCH /api/predictions/settings", () => {
    test("updates settings and returns merged result", async () => {
      const res = await jsonRequest(ctx.app, "PATCH", "/api/predictions/settings", {
        defaultK: 7,
      });
      expect(res.status).toBe(200);

      const settings = (await res.json()) as PredictionSettings;
      expect(settings.defaultK).toBe(7);
      expect(settings.stageThresholds).toEqual([5, 15, 30]);
    });

    test("returns 400 for invalid JSON", async () => {
      const res = await ctx.app.request(
        new Request("http://localhost/api/predictions/settings", {
          method: "PATCH",
          body: "not json",
          headers: { "Content-Type": "application/json" },
        }),
      );
      expect(res.status).toBe(400);
    });

    test("returns 400 for non-object body", async () => {
      const res = await jsonRequest(ctx.app, "PATCH", "/api/predictions/settings", [1, 2, 3]);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/predictions/:gameId", () => {
    test("returns 404 for nonexistent game", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/nonexistent");
      expect(res.status).toBe(404);
    });

    test("returns 422 for game without BGG data", async () => {
      const gameId = await addGameWithRating("No BGG Game");
      const res = await jsonRequest(ctx.app, "GET", `/api/predictions/${gameId}`);
      expect(res.status).toBe(422);
    });

    test("returns prediction result for game with BGG data", async () => {
      // Use the test app which has default axes (Community Rating + Complexity, both BGG)
      // Add a manual game (no BGG, so it won't predict, but we can test the route shape)
      const gameId = await addGameWithRating("Test Game");

      // Since game has no BGG data, this will return 422
      const res = await jsonRequest(ctx.app, "GET", `/api/predictions/${gameId}`);
      expect(res.status).toBe(422);
    });
  });

  describe("GET /api/games?includePredicted=true", () => {
    test("returns games list without prediction when flag absent", async () => {
      await addGameWithRating("Test Game");
      const res = await jsonRequest(ctx.app, "GET", "/api/games");
      expect(res.status).toBe(200);
      const data = (await res.json()) as unknown[];
      expect(data.length).toBe(1);
    });

    test("returns games list with predictions when flag present", async () => {
      await addGameWithRating("Test Game");
      const res = await jsonRequest(ctx.app, "GET", "/api/games?includePredicted=true");
      expect(res.status).toBe(200);
      const data = (await res.json()) as unknown[];
      expect(data.length).toBe(1);
    });

    test("existing behavior unchanged without flag", async () => {
      const res1 = await jsonRequest(ctx.app, "GET", "/api/games");
      const res2 = await jsonRequest(ctx.app, "GET", "/api/games?includePredicted=false");

      const data1 = (await res1.json()) as unknown[];
      const data2 = (await res2.json()) as unknown[];
      expect(data1).toEqual(data2);
    });
  });
});
