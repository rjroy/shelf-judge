import { describe, test, expect, beforeEach } from "bun:test";
import {
  createTestApp,
  jsonRequest,
  type TestAppContext,
} from "../helpers/test-app.js";

describe("score routes", () => {
  let ctx: TestAppContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  describe("GET /api/games/:id/score", () => {
    test("returns score with breakdown for a rated game", async () => {
      // Create a personal axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      expect(axisRes.status).toBe(201);
      const axis = await axisRes.json();

      // Add a game
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test",
      });
      expect(gameRes.status).toBe(201);
      const gameBody = await gameRes.json();
      const gameId = gameBody.game.id;

      // Rate the game on the axis
      const rateRes = await jsonRequest(
        ctx.app,
        "PUT",
        `/api/games/${gameId}/ratings`,
        { ratings: { [axis.id]: 8 } },
      );
      expect(rateRes.status).toBe(200);

      // Fetch the score
      const scoreRes = await jsonRequest(
        ctx.app,
        "GET",
        `/api/games/${gameId}/score`,
      );
      expect(scoreRes.status).toBe(200);
      const score = await scoreRes.json();

      expect(score.gameId).toBe(gameId);
      expect(score.gameName).toBe("Test");
      expect(score.score).toBeNumber();
      expect(score.ratedAxisCount).toBe(1);
      // totalAxisCount includes the 2 default BGG axes plus our personal axis
      expect(score.totalAxisCount).toBeGreaterThanOrEqual(1);
      expect(score.breakdown).toBeArray();
      expect(score.breakdown.length).toBeGreaterThanOrEqual(1);

      const personalEntry = score.breakdown.find(
        (b: { axisId: string }) => b.axisId === axis.id,
      );
      expect(personalEntry).toBeDefined();
      expect(personalEntry.rating).toBe(8);
    });

    test("returns null score for an unrated game", async () => {
      // Add a game without rating it
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Unrated Game",
      });
      expect(gameRes.status).toBe(201);
      const gameBody = await gameRes.json();
      const gameId = gameBody.game.id;

      const scoreRes = await jsonRequest(
        ctx.app,
        "GET",
        `/api/games/${gameId}/score`,
      );
      expect(scoreRes.status).toBe(200);
      const score = await scoreRes.json();

      expect(score.gameId).toBe(gameId);
      expect(score.gameName).toBe("Unrated Game");
      expect(score.score).toBeNull();
      expect(score.status).toBe("not yet rated");
    });
  });

  describe("GET /api/scores", () => {
    test("returns scored and unscored arrays, scored sorted by fitness descending", async () => {
      // Create an axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      expect(axisRes.status).toBe(201);
      const axis = await axisRes.json();

      // Add two games
      const game1Res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Rated Game",
      });
      expect(game1Res.status).toBe(201);
      const game1 = await game1Res.json();

      const game2Res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Unrated Game",
      });
      expect(game2Res.status).toBe(201);
      const game2 = await game2Res.json();

      // Rate only the first game
      const rateRes = await jsonRequest(
        ctx.app,
        "PUT",
        `/api/games/${game1.game.id}/ratings`,
        { ratings: { [axis.id]: 7 } },
      );
      expect(rateRes.status).toBe(200);

      // Fetch the score list
      const listRes = await jsonRequest(ctx.app, "GET", "/api/scores");
      expect(listRes.status).toBe(200);
      const body = await listRes.json();

      // Scored array contains the rated game
      expect(body.scored).toBeArray();
      expect(body.scored).toHaveLength(1);
      expect(body.scored[0].gameId).toBe(game1.game.id);
      expect(body.scored[0].gameName).toBe("Rated Game");
      expect(body.scored[0].score).toBeNumber();
      expect(body.scored[0].breakdown).toBeArray();

      // Unscored array contains the unrated game
      expect(body.unscored).toBeArray();
      expect(body.unscored).toHaveLength(1);
      expect(body.unscored[0].gameId).toBe(game2.game.id);
      expect(body.unscored[0].gameName).toBe("Unrated Game");
      expect(body.unscored[0].score).toBeNull();
      expect(body.unscored[0].status).toBe("not yet rated");
    });

    test("scored array is sorted by fitness descending", async () => {
      // Create an axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      expect(axisRes.status).toBe(201);
      const axis = await axisRes.json();

      // Add two games and rate them with different scores
      const lowRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Low Score Game",
      });
      expect(lowRes.status).toBe(201);
      const lowGame = await lowRes.json();

      const highRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "High Score Game",
      });
      expect(highRes.status).toBe(201);
      const highGame = await highRes.json();

      // Rate low game with 3, high game with 9
      await jsonRequest(
        ctx.app,
        "PUT",
        `/api/games/${lowGame.game.id}/ratings`,
        { ratings: { [axis.id]: 3 } },
      );
      await jsonRequest(
        ctx.app,
        "PUT",
        `/api/games/${highGame.game.id}/ratings`,
        { ratings: { [axis.id]: 9 } },
      );

      const listRes = await jsonRequest(ctx.app, "GET", "/api/scores");
      expect(listRes.status).toBe(200);
      const body = await listRes.json();

      expect(body.scored).toHaveLength(2);
      // High score should come first (descending order)
      expect(body.scored[0].gameName).toBe("High Score Game");
      expect(body.scored[1].gameName).toBe("Low Score Game");
      expect(body.scored[0].score).toBeGreaterThan(body.scored[1].score);
    });
  });
});
