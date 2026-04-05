// Integration tests: full-stack scenarios exercising HTTP -> routes -> services -> storage.
// Mocked only at external boundaries: filesystem (mock-file-ops) and BGG API (mock client).
import { describe, test, expect, beforeEach } from "bun:test";
import {
  createTestApp,
  createMockBggClient,
  jsonRequest,
  type TestAppContext,
} from "../helpers/test-app.js";
import type { BggGameResult } from "../../src/services/bgg-client.js";
import type { BggCollectionItem } from "../../src/services/bgg-xml-parser.js";

// Shared fixtures
const wingspanBgg: BggGameResult = {
  metadata: {
    bggId: 266192,
    name: "Wingspan",
    yearPublished: 2019,
    minPlayers: 1,
    maxPlayers: 5,
    playingTime: 70,
    imageUrl: "https://example.com/wingspan.jpg",
  },
  bggData: {
    communityRating: 8.1,
    bayesAverage: 7.9,
    weight: 2.4,
    numWeightVotes: 1200,
    mechanics: [{ id: 2004, name: "Set Collection" }],
    categories: [{ id: 1089, name: "Animals" }],
    subdomains: ["familygames"],
    suggestedPlayerCounts: [],
    fetchedAt: new Date().toISOString(),
  },
};

const gloomhavenBgg: BggGameResult = {
  metadata: {
    bggId: 174430,
    name: "Gloomhaven",
    yearPublished: 2017,
    minPlayers: 1,
    maxPlayers: 4,
    playingTime: 120,
    imageUrl: "https://example.com/gloomhaven.jpg",
  },
  bggData: {
    communityRating: 8.7,
    bayesAverage: 8.5,
    weight: 3.86,
    numWeightVotes: 2500,
    mechanics: [{ id: 2023, name: "Cooperative Play" }],
    categories: [{ id: 1010, name: "Fantasy" }],
    subdomains: ["strategygames"],
    suggestedPlayerCounts: [],
    fetchedAt: new Date().toISOString(),
  },
};

describe("Integration: End-to-end scenarios", () => {
  describe("Scenario 1: Add game, rate on 2+ axes, verify score", () => {
    let ctx: TestAppContext;

    beforeEach(() => {
      ctx = createTestApp();
    });

    test("manual game addition, rating, and score calculation", async () => {
      // Step 1: Add a manual game
      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "My Card Game",
      });
      expect(addRes.status).toBe(201);
      const { game } = await addRes.json();
      const gameId = game.id;

      // Step 2: Get the default axes (Community Rating, Complexity)
      const axesRes = await jsonRequest(ctx.app, "GET", "/api/axes");
      expect(axesRes.status).toBe(200);
      const axes = await axesRes.json();
      expect(axes.length).toBe(2);

      // Step 3: Create a personal axis
      const createAxisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun Factor",
        weight: 60,
      });
      expect(createAxisRes.status).toBe(201);
      const funAxis = await createAxisRes.json();

      // Step 4: Create another personal axis
      const createAxis2Res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Replay Value",
        weight: 40,
      });
      expect(createAxis2Res.status).toBe(201);
      const replayAxis = await createAxis2Res.json();

      // Step 5: Rate the game on both personal axes
      const rateRes = await jsonRequest(ctx.app, "PUT", `/api/games/${gameId}/ratings`, {
        ratings: {
          [funAxis.id]: 8,
          [replayAxis.id]: 6,
        },
      });
      expect(rateRes.status).toBe(200);
      const rated = await rateRes.json();

      // Step 6: Verify the score
      // score = (8*60 + 6*40) / (60+40) = (480 + 240) / 100 = 7.2
      expect(rated.score).not.toBeNull();
      expect(rated.score.score).toBe(7.2);

      // Step 7: Verify via score endpoint
      const scoreRes = await jsonRequest(ctx.app, "GET", `/api/games/${gameId}/score`);
      expect(scoreRes.status).toBe(200);
      const scoreData = await scoreRes.json();
      expect(scoreData.score).toBe(7.2);
      expect(scoreData.breakdown).toBeDefined();
      expect(scoreData.breakdown.length).toBe(4); // 2 default + 2 personal
      expect(scoreData.ratedAxisCount).toBe(2);
      expect(scoreData.totalAxisCount).toBe(4);

      // Step 8: Verify via game list
      const listRes = await jsonRequest(ctx.app, "GET", "/api/games");
      expect(listRes.status).toBe(200);
      const games = await listRes.json();
      expect(games.length).toBe(1);
      expect(games[0].score.score).toBe(7.2);
    });
  });

  describe("Scenario 2: Custom axis with score changes", () => {
    let ctx: TestAppContext;

    beforeEach(() => {
      ctx = createTestApp();
    });

    test("creating and modifying axes changes scores", async () => {
      // Add a game
      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Strategy Game",
      });
      const { game } = await addRes.json();

      // Create axis and rate
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Depth",
        weight: 100,
      });
      const axis = await axisRes.json();

      await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 9 },
      });

      // Score should be 9.0
      let scoreRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}/score`);
      let scoreData = await scoreRes.json();
      expect(scoreData.score).toBe(9);

      // Update axis weight
      await jsonRequest(ctx.app, "PUT", `/api/axes/${axis.id}`, { weight: 50 });

      // Create second axis with different weight and rate it
      const axis2Res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Accessibility",
        weight: 50,
      });
      const axis2 = await axis2Res.json();

      await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis2.id]: 5 },
      });

      // Score should now be (9*50 + 5*50) / (50+50) = 700/100 = 7.0
      scoreRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}/score`);
      scoreData = await scoreRes.json();
      expect(scoreData.score).toBe(7);
      expect(scoreData.ratedAxisCount).toBe(2);
    });
  });

  describe("Scenario 3: Import BGG collection (mocked)", () => {
    test("imports games from BGG, skips duplicates, reports summary", async () => {
      const collectionItems: BggCollectionItem[] = [
        { bggId: 266192, name: "Wingspan", yearPublished: 2019 },
        { bggId: 174430, name: "Gloomhaven", yearPublished: 2017 },
        { bggId: 999999, name: "Unknown Game", yearPublished: 2020 },
      ];

      const bggResults = new Map<number, BggGameResult>([
        [266192, wingspanBgg],
        [174430, gloomhavenBgg],
        // 999999 intentionally missing to test error handling
      ]);

      const bggClient = createMockBggClient({
        getUserCollection: async () => collectionItems,
        getGames: async () => bggResults,
        getGame: async (id) => {
          const result = bggResults.get(id);
          if (!result) throw new Error(`Not found: ${id}`);
          return result;
        },
      });

      const ctx = createTestApp({ bggClient });

      // Import via the service directly (SSE endpoints are harder to test via app.request)
      const summary = await ctx.gameService.importBggCollection("testuser");

      expect(summary.imported).toBe(2); // Wingspan + Gloomhaven
      expect(summary.skipped).toBe(0);
      expect(summary.errors.length).toBe(1); // Unknown Game failed
      expect(summary.errors[0]).toContain("Unknown Game");

      // Verify games exist in the collection
      const listRes = await jsonRequest(ctx.app, "GET", "/api/games");
      const games = await listRes.json();
      expect(games.length).toBe(2);

      const names = games.map((g: { game: { name: string } }) => g.game.name).sort();
      expect(names).toEqual(["Gloomhaven", "Wingspan"]);

      // Import again: should skip both existing games
      const summary2 = await ctx.gameService.importBggCollection("testuser");
      expect(summary2.imported).toBe(0);
      expect(summary2.skipped).toBe(2);

      // Collection should still have only 2 games
      const listRes2 = await jsonRequest(ctx.app, "GET", "/api/games");
      const games2 = await listRes2.json();
      expect(games2.length).toBe(2);
    });
  });

  describe("Scenario 4: Delete axis, verify cascade", () => {
    let ctx: TestAppContext;

    beforeEach(() => {
      ctx = createTestApp();
    });

    test("deleting an axis removes all its ratings and recalculates scores", async () => {
      // Create two personal axes
      const axis1Res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 60,
      });
      const axis1 = await axis1Res.json();

      const axis2Res = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Theme",
        weight: 40,
      });
      const axis2 = await axis2Res.json();

      // Add two games and rate both on both axes
      const game1Res = await jsonRequest(ctx.app, "POST", "/api/games", { name: "Game A" });
      const game1 = (await game1Res.json()).game;

      const game2Res = await jsonRequest(ctx.app, "POST", "/api/games", { name: "Game B" });
      const game2 = (await game2Res.json()).game;

      await jsonRequest(ctx.app, "PUT", `/api/games/${game1.id}/ratings`, {
        ratings: { [axis1.id]: 8, [axis2.id]: 6 },
      });
      await jsonRequest(ctx.app, "PUT", `/api/games/${game2.id}/ratings`, {
        ratings: { [axis1.id]: 5, [axis2.id]: 9 },
      });

      // Verify scores before deletion
      let score1 = await (await jsonRequest(ctx.app, "GET", `/api/games/${game1.id}/score`)).json();
      // (8*60 + 6*40) / 100 = 7.2
      expect(score1.score).toBe(7.2);

      // Delete axis1 (Fun)
      const deleteRes = await jsonRequest(ctx.app, "DELETE", `/api/axes/${axis1.id}`);
      expect(deleteRes.status).toBe(200);
      const deleteBody = await deleteRes.json();
      expect(deleteBody.deletedRatingsCount).toBe(2);

      // Score should now be based only on axis2 (Theme)
      score1 = await (await jsonRequest(ctx.app, "GET", `/api/games/${game1.id}/score`)).json();
      expect(score1.score).toBe(6); // Only Theme axis: 6*40/40 = 6
      expect(score1.ratedAxisCount).toBe(1);

      const score2 = await (await jsonRequest(ctx.app, "GET", `/api/games/${game2.id}/score`)).json();
      expect(score2.score).toBe(9); // Only Theme axis: 9*40/40 = 9
    });
  });

  describe("Scenario 5: Refresh BGG data, verify overrides preserved", () => {
    test("refresh updates BGG data but preserves user overrides", async () => {
      let refreshed = false;
      const updatedWingspan: BggGameResult = {
        ...wingspanBgg,
        bggData: {
          ...wingspanBgg.bggData,
          communityRating: 8.5,
          fetchedAt: new Date().toISOString(),
        },
      };

      const bggClient = createMockBggClient({
        getGame: async () => (refreshed ? updatedWingspan : wingspanBgg),
        getGames: async (ids) => {
          const results = new Map<number, BggGameResult>();
          for (const id of ids) {
            if (id === 266192) results.set(id, updatedWingspan);
          }
          return results;
        },
      });

      const ctx = createTestApp({ bggClient });

      // Add game with BGG data
      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });
      const { game } = await addRes.json();

      // Get default axes: Community Rating and Complexity are BGG-derived
      const axesRes = await jsonRequest(ctx.app, "GET", "/api/axes");
      const axes = await axesRes.json();
      const communityAxis = axes.find((a: { name: string }) => a.name === "Community Rating");

      // Override the BGG community rating with a personal value
      await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [communityAxis.id]: 7 },
      });

      // Get score: should use override value
      let scoreRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}/score`);
      let scoreData = await scoreRes.json();
      const communityEntry = scoreData.breakdown.find(
        (b: { axisName: string }) => b.axisName === "Community Rating",
      );
      expect(communityEntry.rating).toBe(7);
      expect(communityEntry.source).toBe("override");
      expect(communityEntry.bggOriginal).toBe(8.1);

      // Refresh BGG data for this game (now returns updated data)
      refreshed = true;
      const refreshRes = await jsonRequest(ctx.app, "POST", `/api/games/${game.id}/refresh`);
      expect(refreshRes.status).toBe(200);

      // Score should still use the override, but bggOriginal should be updated
      scoreRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}/score`);
      scoreData = await scoreRes.json();
      const updatedEntry = scoreData.breakdown.find(
        (b: { axisName: string }) => b.axisName === "Community Rating",
      );
      expect(updatedEntry.rating).toBe(7); // Override preserved
      expect(updatedEntry.source).toBe("override");
      // bggOriginal reflects the refreshed BGG data
      expect(updatedEntry.bggOriginal).toBe(8.5);

      // Refresh all games
      const refreshAllRes = await jsonRequest(ctx.app, "POST", "/api/games/refresh");
      expect(refreshAllRes.status).toBe(200);
      const refreshSummary = await refreshAllRes.json();
      expect(refreshSummary.refreshed).toBe(1);
    });
  });

  describe("Scenario 6: Daemon without BGG token", () => {
    let ctx: TestAppContext;

    beforeEach(() => {
      // No BGG client = daemon running without BGG token
      ctx = createTestApp();
    });

    test("manual operations work, BGG operations return 503", async () => {
      // Manual game creation works
      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Manual Game",
      });
      expect(addRes.status).toBe(201);
      const { game } = await addRes.json();

      // Axis CRUD works
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Personal Axis",
        weight: 50,
      });
      expect(axisRes.status).toBe(201);
      const axis = await axisRes.json();

      // Rating works
      const rateRes = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 8 },
      });
      expect(rateRes.status).toBe(200);

      // Score works
      const scoreRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}/score`);
      expect(scoreRes.status).toBe(200);
      const scoreData = await scoreRes.json();
      expect(scoreData.score).toBe(8);

      // BGG search returns 503
      const searchRes = await jsonRequest(ctx.app, "GET", "/api/games/search?q=wingspan");
      expect(searchRes.status).toBe(503);
      const searchErr = await searchRes.json();
      expect(searchErr.error).toContain("not configured");

      // BGG refresh returns 503
      const refreshRes = await jsonRequest(ctx.app, "POST", `/api/games/${game.id}/refresh`);
      expect(refreshRes.status).toBe(503);

      // Refresh all returns 503
      const refreshAllRes = await jsonRequest(ctx.app, "POST", "/api/games/refresh");
      expect(refreshAllRes.status).toBe(503);

      // Game with bggId returns 503
      const bggAddRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        bggId: 266192,
      });
      expect(bggAddRes.status).toBe(503);
    });
  });

  describe("Scenario 7: CLI --json output matches API response shapes", () => {
    let ctx: TestAppContext;

    beforeEach(() => {
      ctx = createTestApp();
    });

    test("API responses have consistent shapes for CLI consumption", async () => {
      // Add a game
      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "JSON Test Game",
      });
      expect(addRes.status).toBe(201);
      const addBody = await addRes.json();
      // Shape: { game: Game, bggImported: boolean, warning?: string }
      expect(addBody).toHaveProperty("game");
      expect(addBody).toHaveProperty("bggImported");
      expect(addBody.game).toHaveProperty("id");
      expect(addBody.game).toHaveProperty("name");
      expect(addBody.game).toHaveProperty("ratings");

      const gameId = addBody.game.id;

      // Create axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Test Axis",
        weight: 50,
      });
      const axis = await axisRes.json();
      // Shape: Axis
      expect(axis).toHaveProperty("id");
      expect(axis).toHaveProperty("name");
      expect(axis).toHaveProperty("weight");

      // Rate
      const rateRes = await jsonRequest(ctx.app, "PUT", `/api/games/${gameId}/ratings`, {
        ratings: { [axis.id]: 7 },
      });
      const rateBody = await rateRes.json();
      // Shape: { game: Game, score: FitnessResult | null }
      expect(rateBody).toHaveProperty("game");
      expect(rateBody).toHaveProperty("score");
      expect(rateBody.score).toHaveProperty("score");
      expect(rateBody.score).toHaveProperty("breakdown");

      // List games
      const listRes = await jsonRequest(ctx.app, "GET", "/api/games");
      const listBody = await listRes.json();
      // Shape: GameWithScore[]
      expect(Array.isArray(listBody)).toBe(true);
      expect(listBody[0]).toHaveProperty("game");
      expect(listBody[0]).toHaveProperty("score");

      // Get game
      const getRes = await jsonRequest(ctx.app, "GET", `/api/games/${gameId}`);
      const getBody = await getRes.json();
      // Shape: { game: Game, score: FitnessResult | null, bggDataStale?: boolean }
      expect(getBody).toHaveProperty("game");
      expect(getBody).toHaveProperty("score");

      // Score list
      const scoresRes = await jsonRequest(ctx.app, "GET", "/api/scores");
      const scoresBody = await scoresRes.json();
      // Shape: { scored: [...], unscored: [...] }
      expect(scoresBody).toHaveProperty("scored");
      expect(scoresBody).toHaveProperty("unscored");
      expect(Array.isArray(scoresBody.scored)).toBe(true);
      expect(scoresBody.scored[0]).toHaveProperty("gameId");
      expect(scoresBody.scored[0]).toHaveProperty("gameName");
      expect(scoresBody.scored[0]).toHaveProperty("score");
      expect(scoresBody.scored[0]).toHaveProperty("breakdown");

      // Score get
      const scoreGetRes = await jsonRequest(ctx.app, "GET", `/api/games/${gameId}/score`);
      const scoreGetBody = await scoreGetRes.json();
      // Shape: { gameId, gameName, score, ratedAxisCount, totalAxisCount, breakdown }
      expect(scoreGetBody).toHaveProperty("gameId");
      expect(scoreGetBody).toHaveProperty("gameName");
      expect(scoreGetBody).toHaveProperty("score");
      expect(scoreGetBody).toHaveProperty("breakdown");

      // Axes list
      const axesListRes = await jsonRequest(ctx.app, "GET", "/api/axes");
      const axesList = await axesListRes.json();
      expect(Array.isArray(axesList)).toBe(true);
      // Each axis has required fields
      for (const a of axesList) {
        expect(a).toHaveProperty("id");
        expect(a).toHaveProperty("name");
        expect(a).toHaveProperty("weight");
        expect(a).toHaveProperty("source");
      }

      // Delete game
      const deleteRes = await jsonRequest(ctx.app, "DELETE", `/api/games/${gameId}`);
      expect(deleteRes.status).toBe(204);

      // Verify deleted
      const getDeletedRes = await jsonRequest(ctx.app, "GET", `/api/games/${gameId}`);
      expect(getDeletedRes.status).toBe(404);
    });
  });
});
