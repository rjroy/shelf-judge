import { describe, test, expect, beforeEach } from "bun:test";
import {
  createTestApp,
  createMockBggClient,
  jsonRequest,
  type TestAppContext,
} from "../helpers/test-app.js";
import type { BggGameResult } from "../../src/services/bgg-client.js";
import type {
  Axis,
  Game,
  FitnessResult,
  AddGameResult,
  GameWithScore,
  BggSearchResult,
} from "@shelf-judge/shared";

type GameAddResponse = AddGameResult;
type GameDetailResponse = GameWithScore;
type GameListEntry = GameWithScore;

interface GameRateResponse {
  game: Game;
  score: FitnessResult | null;
}

interface RefreshResponse {
  refreshed: number;
  errors: string[];
}

let ctx: TestAppContext;

const wingspanBggResult: BggGameResult = {
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

describe("Game Routes", () => {
  beforeEach(() => {
    ctx = createTestApp();
  });

  describe("POST /api/games", () => {
    test("manual game returns 201 with game object and bggImported: false", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as GameAddResponse;
      expect(body.game).toBeDefined();
      expect(body.game.name).toBe("Test Game");
      expect(body.game.id).toBeTruthy();
      expect(body.game.bggId).toBeNull();
      expect(body.game.ratings).toEqual({});
      expect(body.bggImported).toBe(false);
    });

    test("game with bggId when BGG is configured returns 201", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.resolve(wingspanBggResult),
      });
      ctx = createTestApp({ bggClient });

      const res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as GameAddResponse;
      expect(body.game.bggId).toBe(266192);
      expect(body.game.name).toBe("Wingspan");
      expect(body.bggImported).toBe(true);
      // BGG data should have been applied
      expect(body.game.yearPublished).toBe(2019);
      expect(body.game.bggData).toBeTruthy();
    });

    test("duplicate bggId returns 409", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.resolve(wingspanBggResult),
      });
      ctx = createTestApp({ bggClient });

      // Add the first game
      const first = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });
      expect(first.status).toBe(201);

      // Try to add another with the same bggId
      const second = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan Duplicate",
        bggId: 266192,
      });

      expect(second.status).toBe(409);
      const body = (await second.json()) as { error: string };
      expect(body.error).toContain("already exists");
    });
  });

  describe("GET /api/games", () => {
    test("returns list sorted by fitness score", async () => {
      // Create a personal axis to rate on
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      expect(axisRes.status).toBe(201);
      const axis = (await axisRes.json()) as Axis;

      // Add two games
      const game1Res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Low Rated Game",
      });
      const game1 = ((await game1Res.json()) as GameAddResponse).game;

      const game2Res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "High Rated Game",
      });
      const game2 = ((await game2Res.json()) as GameAddResponse).game;

      // Rate game1 low, game2 high
      await jsonRequest(ctx.app, "PUT", `/api/games/${game1.id}/ratings`, {
        ratings: { [axis.id]: 3 },
      });
      await jsonRequest(ctx.app, "PUT", `/api/games/${game2.id}/ratings`, {
        ratings: { [axis.id]: 9 },
      });

      const listRes = await jsonRequest(ctx.app, "GET", "/api/games");
      expect(listRes.status).toBe(200);
      const games = (await listRes.json()) as GameListEntry[];

      expect(games).toBeArray();
      expect(games.length).toBe(2);
      // Higher rated game should be first
      expect(games[0].game.name).toBe("High Rated Game");
      expect(games[1].game.name).toBe("Low Rated Game");
    });
  });

  describe("GET /api/games/:id", () => {
    test("returns game with score breakdown", async () => {
      // Create a personal axis and a game
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      const axis = (await axisRes.json()) as Axis;

      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      // Rate it
      await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 7 },
      });

      const getRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`);

      expect(getRes.status).toBe(200);
      const body = (await getRes.json()) as GameDetailResponse;
      expect(body.game.id).toBe(game.id);
      expect(body.score).toBeDefined();
      expect(body.score!.breakdown).toBeArray();
      expect(body.score!.score).toBeGreaterThan(0);
    });
  });

  describe("PUT /api/games/:id/ratings", () => {
    test("updates ratings and returns new score", async () => {
      // Create a personal axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      const axis = (await axisRes.json()) as Axis;

      // Create a game
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      const rateRes = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 8 },
      });

      expect(rateRes.status).toBe(200);
      const body = (await rateRes.json()) as GameRateResponse;
      expect(body.game.ratings[axis.id]).toBe(8);
      expect(body.score).toBeDefined();
      expect(body.score!.score).toBeGreaterThan(0);
    });

    test("invalid rating returns 400", async () => {
      // Create a personal axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      const axis = (await axisRes.json()) as Axis;

      // Create a game
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      // Rating out of range (> 10)
      const rateRes = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 15 },
      });

      expect(rateRes.status).toBe(400);
      const body = (await rateRes.json()) as { error: string };
      expect(body.error).toBeDefined();
    });
  });

  describe("DELETE /api/games/:id", () => {
    test("returns 204 on successful deletion", async () => {
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Doomed Game",
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      const delRes = await jsonRequest(ctx.app, "DELETE", `/api/games/${game.id}`);
      expect(delRes.status).toBe(204);

      // Confirm it's gone
      const getRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe("GET /api/games/search", () => {
    test("returns search results when BGG is configured", async () => {
      const bggClient = createMockBggClient({
        searchGames: () =>
          Promise.resolve([
            { bggId: 266192, name: "Wingspan", yearPublished: 2019 },
            { bggId: 290837, name: "Wingspan: European Expansion", yearPublished: 2019 },
          ]),
      });
      ctx = createTestApp({ bggClient });

      const res = await jsonRequest(ctx.app, "GET", "/api/games/search?q=wingspan");

      expect(res.status).toBe(200);
      const results = (await res.json()) as BggSearchResult[];
      expect(results).toBeArray();
      expect(results.length).toBe(2);
      expect(results[0].name).toBe("Wingspan");
    });
  });

  describe("POST /api/games/refresh", () => {
    test("refreshes all BGG games and returns summary", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.resolve(wingspanBggResult),
        getGames: (ids) => {
          const results = new Map<number, BggGameResult>();
          for (const id of ids) {
            if (id === 266192) results.set(id, wingspanBggResult);
          }
          return Promise.resolve(results);
        },
      });
      ctx = createTestApp({ bggClient });

      // Add a BGG game
      await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });

      // Also add a manual game (should not be refreshed)
      await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Manual Game",
      });

      const res = await jsonRequest(ctx.app, "POST", "/api/games/refresh");
      expect(res.status).toBe(200);
      const body = (await res.json()) as RefreshResponse;
      expect(body.refreshed).toBe(1);
      expect(body.errors).toBeArray();
    });

    test("returns 503 when BGG is not configured", async () => {
      // Default: no bggClient
      const res = await jsonRequest(ctx.app, "POST", "/api/games/refresh");
      expect(res.status).toBe(503);
    });
  });

  describe("bggDataStale field", () => {
    test("game with recent BGG data has bggDataStale: false", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.resolve(wingspanBggResult),
      });
      ctx = createTestApp({ bggClient });

      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });
      const { game } = (await addRes.json()) as GameAddResponse;

      const getRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`);
      const body = (await getRes.json()) as GameDetailResponse;
      expect(body.bggDataStale).toBe(false);
    });

    test("game without BGG data has bggDataStale: undefined", async () => {
      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Manual Game",
      });
      const { game } = (await addRes.json()) as GameAddResponse;

      const getRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`);
      const body = (await getRes.json()) as GameDetailResponse;
      expect(body.bggDataStale).toBeUndefined();
    });

    test("list includes bggDataStale for each game", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.resolve(wingspanBggResult),
      });
      ctx = createTestApp({ bggClient });

      await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });
      await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Manual Game",
      });

      const listRes = await jsonRequest(ctx.app, "GET", "/api/games");
      const games = (await listRes.json()) as GameListEntry[];
      expect(games.length).toBe(2);

      const bggGame = games.find((g) => g.game.name === "Wingspan");
      const manualGame = games.find((g) => g.game.name === "Manual Game");
      expect(bggGame!.bggDataStale).toBe(false);
      expect(manualGame!.bggDataStale).toBeUndefined();
    });
  });

  describe("BGG routes without token", () => {
    test("search returns 503 with setup instructions when BGG is not configured", async () => {
      // Default createTestApp() has no bggClient
      const res = await jsonRequest(ctx.app, "GET", "/api/games/search?q=wingspan");

      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("not configured");
      expect(body.error).toContain("shelf-judge config set bgg-token");
    });
  });
});
