import { describe, test, expect, beforeEach } from "bun:test";
import {
  createTestApp,
  createMockBggClient,
  jsonRequest,
  type TestAppContext,
} from "../helpers/test-app.js";
import type {
  Axis,
  PredictionReadiness,
  PredictionSettings,
  PredictedGameResponse,
} from "@shelf-judge/shared";
import type { BggGameResult } from "../../src/services/bgg-client.js";

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

    test("returns successful prediction with predictionMeta and breakdown", async () => {
      // Set up a mock BGG client that returns distinct game data
      const makeBggResult = (bggId: number, name: string, weight: number): BggGameResult => ({
        metadata: {
          bggId,
          name,
          yearPublished: 2020,
          minPlayers: 2,
          maxPlayers: 4,
          playingTime: 60,
          imageUrl: null,
        },
        bggData: {
          communityRating: 7.5,
          bayesAverage: 7.2,
          weight,
          numWeightVotes: 100,
          description: null,
          mechanics: [{ id: 1, name: "Deck Building" }],
          categories: [{ id: 1, name: "Card Game" }],
          families: [],
          subdomains: [],
          suggestedPlayerCounts: [],
          fetchedAt: new Date().toISOString(),
        },
      });

      const bggClient = createMockBggClient({
        getGame: (bggId: number) =>
          Promise.resolve(makeBggResult(bggId, `Game-${bggId}`, 2.0 + bggId * 0.1)),
      });
      ctx = createTestApp({ bggClient });

      // Lower the stage threshold so we can reach Stage 1 with fewer games
      await jsonRequest(ctx.app, "PATCH", "/api/predictions/settings", {
        stageThresholds: [3, 8, 15],
      });

      // Create a personal axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      expect(axisRes.status).toBe(201);
      const axis = (await axisRes.json()) as Axis;

      // Add reference games with BGG data and rate them to reach Stage 1
      const refGameIds: string[] = [];
      for (let i = 1; i <= 4; i++) {
        const res = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: `Ref Game ${i}`,
          bggId: i,
        });
        expect(res.status).toBe(201);
        const { game } = (await res.json()) as { game: { id: string } };
        refGameIds.push(game.id);

        // Rate each game
        const rateRes = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
          ratings: { [axis.id]: 5 + i },
        });
        expect(rateRes.status).toBe(200);
      }

      // Add target game with BGG data but no rating
      const targetRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Target Game",
        bggId: 99,
      });
      expect(targetRes.status).toBe(201);
      const { game: targetGame } = (await targetRes.json()) as { game: { id: string } };

      // Now predict the target game
      const res = await jsonRequest(ctx.app, "GET", `/api/predictions/${targetGame.id}`);
      expect(res.status).toBe(200);

      const prediction = (await res.json()) as PredictedGameResponse;
      expect(prediction.game.id).toBe(targetGame.id);
      expect(prediction.score).toBeDefined();
      expect(prediction.score.score).toBeGreaterThan(0);
      expect(prediction.score.breakdown.length).toBeGreaterThan(0);
      expect(prediction.score.predictionMeta).not.toBeNull();
      expect(prediction.score.predictionMeta!.predictedAxisCount).toBeGreaterThan(0);
      expect(prediction.score.predictionMeta!.confidence).toBeDefined();
      expect(prediction.score.predictionMeta!.referenceGameCount).toBeGreaterThan(0);
      expect(prediction.tension).toBeDefined(); // null or object, but field exists
      expect(prediction.predictionUnavailable).toBeNull();
    });

    test("returns predictionUnavailable at Stage 0", async () => {
      const bggClient = createMockBggClient({
        getGame: (bggId: number) =>
          Promise.resolve({
            metadata: {
              bggId,
              name: `Game-${bggId}`,
              yearPublished: 2020,
              minPlayers: 2,
              maxPlayers: 4,
              playingTime: 60,
              imageUrl: null,
            },
            bggData: {
              communityRating: 7.5,
              bayesAverage: 7.2,
              weight: 2.5,
              numWeightVotes: 100,
              description: null,
              mechanics: [{ id: 1, name: "Deck Building" }],
              categories: [{ id: 1, name: "Card Game" }],
              families: [],
              subdomains: [],
              suggestedPlayerCounts: [],
              fetchedAt: new Date().toISOString(),
            },
          }),
      });
      ctx = createTestApp({ bggClient });

      // Add a game with BGG data (no ratings, so Stage 0)
      const res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Stage 0 Game",
        bggId: 42,
      });
      expect(res.status).toBe(201);
      const { game } = (await res.json()) as { game: { id: string } };

      const predRes = await jsonRequest(ctx.app, "GET", `/api/predictions/${game.id}`);
      expect(predRes.status).toBe(200);

      const prediction = (await predRes.json()) as PredictedGameResponse;
      expect(prediction.predictionUnavailable).not.toBeNull();
      expect(prediction.predictionUnavailable!.reason).toBe("stage-0");
      expect(prediction.predictionUnavailable!.gamesNeeded).toBeGreaterThan(0);
    });
  });

  describe("GET /api/predictions/bgg/:bggId", () => {
    const makeBggResult = (bggId: number, name: string): BggGameResult => ({
      metadata: {
        bggId,
        name,
        yearPublished: 2023,
        minPlayers: 1,
        maxPlayers: 4,
        playingTime: 90,
        imageUrl: null,
      },
      bggData: {
        communityRating: 7.5,
        bayesAverage: 7.2,
        weight: 2.5,
        numWeightVotes: 100,
        description: null,
        mechanics: [{ id: 1, name: "Dice Rolling" }],
        categories: [{ id: 1, name: "Strategy" }],
        families: [],
        subdomains: [],
        suggestedPlayerCounts: [],
        fetchedAt: new Date().toISOString(),
      },
    });

    test("returns prediction for a game by BGG ID", async () => {
      const bggClient = createMockBggClient({
        getGame: (bggId: number) => Promise.resolve(makeBggResult(bggId, `Game-${bggId}`)),
      });
      ctx = createTestApp({ bggClient });

      // Lower stage threshold and add rated games to get past stage 0
      await jsonRequest(ctx.app, "PATCH", "/api/predictions/settings", {
        stageThresholds: [2, 8, 15],
      });

      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      const axis = (await axisRes.json()) as Axis;

      for (let i = 1; i <= 3; i++) {
        const res = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: `Ref ${i}`,
          bggId: i,
        });
        const { game } = (await res.json()) as { game: { id: string } };
        await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
          ratings: { [axis.id]: 5 + i },
        });
      }

      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/999");
      expect(res.status).toBe(200);

      const prediction = (await res.json()) as PredictedGameResponse;
      expect(prediction.game.id).toBe("preview-999");
      expect(prediction.game.name).toBe("Game-999");
      expect(prediction.score).toBeDefined();
      expect(prediction.score.score).toBeGreaterThan(0);
    });

    test("returns existing game prediction when bggId is in collection", async () => {
      const bggClient = createMockBggClient({
        getGame: (bggId: number) => Promise.resolve(makeBggResult(bggId, `Game-${bggId}`)),
      });
      ctx = createTestApp({ bggClient });

      // Add a game with bggId 42
      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Existing Game",
        bggId: 42,
      });
      expect(addRes.status).toBe(201);

      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/42");
      expect(res.status).toBe(200);

      const prediction = (await res.json()) as PredictedGameResponse;
      // Should return the existing game, not a preview
      expect(prediction.game.id).not.toStartWith("preview-");
      expect(prediction.game.bggId).toBe(42);
    });

    test("returns 404 when BGG ID does not exist", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.reject(new Error("No game found with BGG ID 99999")),
      });
      ctx = createTestApp({ bggClient });

      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/99999");
      expect(res.status).toBe(404);
    });

    test("returns 400 for invalid BGG ID", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/notanumber");
      expect(res.status).toBe(400);
    });

    test("returns 503 when BGG client not configured", async () => {
      // Default ctx has no bggClient
      const res = await jsonRequest(ctx.app, "GET", "/api/predictions/bgg/12345");
      expect(res.status).toBe(503);
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
