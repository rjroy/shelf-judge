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
    thumbnailUrl: null,
  },
  bggData: {
    communityRating: 8.1,
    bayesAverage: 7.9,
    weight: 2.4,
    numWeightVotes: 1200,
    description: null,
    mechanics: [{ id: 2004, name: "Set Collection" }],
    categories: [{ id: 1089, name: "Animals" }],
    families: [],
    subdomains: [],
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

    test("null rating clears an existing rating", async () => {
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      const axis = (await axisRes.json()) as Axis;

      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      // Set a rating
      await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 8 },
      });

      // Clear it with null
      const clearRes = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: null },
      });

      expect(clearRes.status).toBe(200);
      const body = (await clearRes.json()) as GameRateResponse;
      expect(body.game.ratings[axis.id]).toBeUndefined();
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
            { bggId: 266192, name: "Wingspan", yearPublished: 2019, thumbnailUrl: null },
            {
              bggId: 290837,
              name: "Wingspan: European Expansion",
              yearPublished: 2019,
              thumbnailUrl: null,
            },
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

  describe("niche position integration", () => {
    // Build a collection of 3 games sharing "Deck Building" mechanic to form a niche
    const makeBggResult = (
      bggId: number,
      name: string,
      mechanics: { id: number; name: string }[],
      categories: { id: number; name: string }[] = [],
    ): BggGameResult => ({
      metadata: {
        bggId,
        name,
        yearPublished: 2020,
        minPlayers: 2,
        maxPlayers: 4,
        playingTime: 60,
        imageUrl: null,
        thumbnailUrl: null,
      },
      bggData: {
        communityRating: 7.5,
        bayesAverage: 7.2,
        weight: 2.5,
        numWeightVotes: 100,
        description: null,
        mechanics,
        categories,
        families: [],
        subdomains: [],
        suggestedPlayerCounts: [],
        fetchedAt: new Date().toISOString(),
      },
    });

    async function setupNicheCollection() {
      const bggClient = createMockBggClient({
        getGame: (bggId: number) => {
          const games: Record<number, BggGameResult> = {
            1: makeBggResult(
              1,
              "Game Alpha",
              [{ id: 1, name: "Deck Building" }],
              [{ id: 10, name: "Card Game" }],
            ),
            2: makeBggResult(
              2,
              "Game Beta",
              [{ id: 1, name: "Deck Building" }],
              [{ id: 10, name: "Card Game" }],
            ),
            3: makeBggResult(3, "Game Gamma", [{ id: 1, name: "Deck Building" }]),
          };
          const result = games[bggId];
          if (!result) return Promise.reject(new Error(`No game found with BGG ID ${bggId}`));
          return Promise.resolve(result);
        },
      });
      ctx = createTestApp({ bggClient });

      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
      });
      const axis = (await axisRes.json()) as Axis;

      const gameIds: string[] = [];
      const ratings = [9, 7, 5]; // Alpha=9, Beta=7, Gamma=5
      for (let i = 1; i <= 3; i++) {
        const res = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: `Game ${["Alpha", "Beta", "Gamma"][i - 1]}`,
          bggId: i,
        });
        expect(res.status).toBe(201);
        const { game } = (await res.json()) as { game: { id: string } };
        gameIds.push(game.id);

        await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
          ratings: { [axis.id]: ratings[i - 1] },
        });
      }

      return { gameIds, axis };
    }

    describe("GET /api/games/:id nichePosition", () => {
      test("includes nichePosition with niche entries for a game in niches", async () => {
        const { gameIds } = await setupNicheCollection();

        const res = await jsonRequest(ctx.app, "GET", `/api/games/${gameIds[0]}`);
        expect(res.status).toBe(200);

        const body = (await res.json()) as GameWithScore;
        expect(body.nichePosition).toBeDefined();
        expect(body.nichePosition).not.toBeNull();

        const niches = body.nichePosition!.niches;
        expect(niches.length).toBeGreaterThan(0);

        // Alpha is highest rated, should be champion in Deck Building
        const deckBuilding = niches.find((n) => n.name === "Deck Building");
        expect(deckBuilding).toBeDefined();
        expect(deckBuilding!.rank).toBe(1);
        expect(deckBuilding!.isChampion).toBe(true);
        expect(deckBuilding!.size).toBe(3);
      });

      test("returns nichePosition: null for game without BGG data", async () => {
        // Add a manual game (no BGG data)
        const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: "Manual Game",
        });
        const { game } = (await addRes.json()) as { game: { id: string } };

        const res = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`);
        expect(res.status).toBe(200);

        const body = (await res.json()) as GameWithScore;
        expect(body.nichePosition).toBeNull();
      });

      test("niche entries sorted by size descending", async () => {
        const { gameIds } = await setupNicheCollection();

        // Alpha is in Deck Building (3 games) and Card Game (2 games)
        const res = await jsonRequest(ctx.app, "GET", `/api/games/${gameIds[0]}`);
        const body = (await res.json()) as GameWithScore;
        const niches = body.nichePosition!.niches;

        // Should have at least 2 niches (Deck Building size 3, Card Game size 2)
        expect(niches.length).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < niches.length - 1; i++) {
          if (niches[i].size === niches[i + 1].size) {
            // Same size: alphabetical
            expect(niches[i].name.localeCompare(niches[i + 1].name)).toBeLessThanOrEqual(0);
          } else {
            expect(niches[i].size).toBeGreaterThan(niches[i + 1].size);
          }
        }
      });

      test("neighbors are populated correctly", async () => {
        const { gameIds } = await setupNicheCollection();

        // Beta is rank 2 in Deck Building: above=[Alpha], below=[Gamma]
        const res = await jsonRequest(ctx.app, "GET", `/api/games/${gameIds[1]}`);
        const body = (await res.json()) as GameWithScore;
        const deckBuilding = body.nichePosition!.niches.find((n) => n.name === "Deck Building");

        expect(deckBuilding!.rank).toBe(2);
        expect(deckBuilding!.above.length).toBe(1);
        expect(deckBuilding!.above[0].gameName).toBe("Game Alpha");
        expect(deckBuilding!.below.length).toBe(1);
        expect(deckBuilding!.below[0].gameName).toBe("Game Gamma");
      });
    });

    describe("GET /api/games?includeNiches=true", () => {
      test("attaches nichePosition to each game when includeNiches=true", async () => {
        await setupNicheCollection();

        const res = await jsonRequest(ctx.app, "GET", "/api/games?includeNiches=true");
        expect(res.status).toBe(200);

        const games = (await res.json()) as GameWithScore[];
        for (const gws of games) {
          expect(gws.nichePosition).toBeDefined();
          // Every game has BGG data and a rating, so all should have niches
          expect(gws.nichePosition).not.toBeNull();
        }
      });

      test("nichePosition absent when includeNiches is not set", async () => {
        await setupNicheCollection();

        const res = await jsonRequest(ctx.app, "GET", "/api/games");
        expect(res.status).toBe(200);

        const games = (await res.json()) as GameWithScore[];
        for (const gws of games) {
          expect(gws.nichePosition).toBeUndefined();
        }
      });

      test("includeNiches without includePredicted returns standard list with niches", async () => {
        await setupNicheCollection();

        const withNiches = await jsonRequest(ctx.app, "GET", "/api/games?includeNiches=true");
        const withoutNiches = await jsonRequest(ctx.app, "GET", "/api/games");

        const gamesWithNiches = (await withNiches.json()) as GameWithScore[];
        const gamesWithout = (await withoutNiches.json()) as GameWithScore[];

        // Same games, same count
        expect(gamesWithNiches.length).toBe(gamesWithout.length);
        // But with niches attached
        expect(gamesWithNiches[0].nichePosition).toBeDefined();
        expect(gamesWithout[0].nichePosition).toBeUndefined();
      });

      test("includeNiches=true with includePredicted=true returns predicted games with niches", async () => {
        await setupNicheCollection();

        const res = await jsonRequest(
          ctx.app,
          "GET",
          "/api/games?includePredicted=true&includeNiches=true",
        );
        expect(res.status).toBe(200);

        const games = (await res.json()) as GameWithScore[];
        expect(games.length).toBe(3);
        for (const gws of games) {
          expect(gws.nichePosition).toBeDefined();
        }
      });
    });
  });
});
