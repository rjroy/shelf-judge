import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Game, GameWithScore, BoxDimensions } from "@shelf-judge/shared";
import { createGameRoutes } from "../src/routes/games";
import type { GameService } from "../src/services/game-service";

const now = "2026-01-01T00:00:00Z";

function makeGame(id: string, name: string, boxDimensions: BoxDimensions | null = null): Game {
  return {
    id,
    bggId: 1,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    ownership: "owned",
    boxDimensions,
    ratings: {},
    createdAt: now,
    updatedAt: now,
  };
}

function createTestApp() {
  let storedGame = makeGame("game-1", "Test Game");

  const gameService: GameService = {
    addGame() {
      throw new Error("not implemented");
    },
    getGame(id: string): Promise<GameWithScore> {
      if (id !== storedGame.id) throw new Error(`Game not found: ${id}`);
      return Promise.resolve({ game: storedGame, score: null });
    },
    listGames() {
      return Promise.resolve([]);
    },
    rateGame() {
      throw new Error("not implemented");
    },
    removeGame() {
      throw new Error("not implemented");
    },
    searchGames() {
      return Promise.resolve([]);
    },
    refreshBggData() {
      throw new Error("not implemented");
    },
    refreshAllBggData() {
      return Promise.resolve({ refreshed: 0, errors: [] as string[] });
    },
    setOwnership() {
      throw new Error("not implemented");
    },
    setBoxDimensions(id: string, dimensions: BoxDimensions | null): Promise<Game> {
      if (id !== storedGame.id) throw new Error(`Game not found: ${id}`);
      storedGame = {
        ...storedGame,
        boxDimensions: dimensions,
        updatedAt: new Date().toISOString(),
      };
      return Promise.resolve(storedGame);
    },
    importBggCollection() {
      return Promise.resolve({ imported: 0, skipped: 0, errors: [] as string[] });
    },
  };

  const routeModule = createGameRoutes({ gameService });
  const app = new Hono();
  app.route("/api", routeModule.routes);
  return { app, getStoredGame: () => storedGame };
}

describe("PUT /api/games/:id/dimensions", () => {
  test("sets valid dimensions", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/games/game-1/dimensions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 11.4, height: 11.4, depth: 2.75 }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { game: Game };
    expect(data.game.boxDimensions).toEqual({
      width: 11.4,
      height: 11.4,
      depth: 2.75,
    });
  });

  test("clears dimensions with { clear: true }", async () => {
    const { app } = createTestApp();
    // First set dimensions
    await app.request("/api/games/game-1/dimensions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 10, height: 10, depth: 5 }),
    });
    // Then clear
    const res = await app.request("/api/games/game-1/dimensions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { game: Game };
    expect(data.game.boxDimensions).toBeNull();
  });

  test("rejects partial dimensions (width only)", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/games/game-1/dimensions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 10 }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects dimensions <= 0", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/games/game-1/dimensions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 0, height: 10, depth: 5 }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects dimensions > 40", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/games/game-1/dimensions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 41, height: 10, depth: 5 }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 404 for nonexistent game", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/games/nonexistent/dimensions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 10, height: 10, depth: 5 }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 400 for invalid JSON", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/games/game-1/dimensions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});
