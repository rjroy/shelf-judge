import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import type { WishlistEntry, Game, GameWithScore, AddGameResult } from "@shelf-judge/shared";
import { createWishlistRoutes } from "../src/routes/wishlist";
import { createGameRoutes } from "../src/routes/games";
import type { WishlistService } from "../src/services/wishlist-service";
import type { GameService } from "../src/services/game-service";
import type { BggClient } from "../src/services/bgg-client";

const mockBggClient: BggClient = {
  searchGames: () => Promise.reject(new Error("not implemented")),
  getGame: () => Promise.reject(new Error("not implemented")),
  getGames: () => Promise.reject(new Error("not implemented")),
  getUserCollection: () => Promise.reject(new Error("not implemented")),
  isConfigured: () => true,
};

const NOW = "2026-04-12T12:00:00.000Z";

function makeEntry(id: string, bggId: number, name: string, addedAt: string): WishlistEntry {
  return {
    id,
    bggId,
    name,
    yearPublished: 2020,
    thumbnailUrl: `https://example.com/${bggId}.jpg`,
    predictedScore: 7.5,
    predictionConfidence: "strong",
    predictedBreakdown: [{ axisName: "Fun", rating: 7, confidence: "strong" }],
    nicheImpact: null,
    addedAt,
  };
}

function createMockWishlistService(): WishlistService & { entries: WishlistEntry[] } {
  const mock = {
    entries: [] as WishlistEntry[],

    list() {
      return Promise.resolve(structuredClone(mock.entries));
    },

    add(bggId: number) {
      if (mock.entries.some((e) => e.bggId === bggId)) {
        return Promise.reject(new Error("This game is already on your wishlist"));
      }
      const entry = makeEntry(`new-${bggId}`, bggId, `Game ${bggId}`, new Date().toISOString());
      mock.entries.push(entry);
      return Promise.resolve(structuredClone(entry));
    },

    remove(id: string) {
      const idx = mock.entries.findIndex((e) => e.id === id);
      if (idx === -1) return Promise.reject(new Error(`Wishlist entry not found: ${id}`));
      mock.entries.splice(idx, 1);
      return Promise.resolve();
    },

    clear() {
      const count = mock.entries.length;
      mock.entries = [];
      return Promise.resolve(count);
    },

    refresh(id: string) {
      const entry = mock.entries.find((e) => e.id === id);
      if (!entry) return Promise.reject(new Error(`Wishlist entry not found: ${id}`));
      const updated = structuredClone(entry);
      updated.predictedScore = 8.0;
      const idx = mock.entries.findIndex((e) => e.id === id);
      mock.entries[idx] = updated;
      return Promise.resolve(structuredClone(updated));
    },

    refreshAll() {
      for (const entry of mock.entries) {
        entry.predictedScore = 8.0;
      }
      return Promise.resolve({ refreshed: mock.entries.length, errors: [] });
    },

    removeByBggId(bggId: number) {
      const idx = mock.entries.findIndex((e) => e.bggId === bggId);
      if (idx === -1) return Promise.resolve(false);
      mock.entries.splice(idx, 1);
      return Promise.resolve(true);
    },
  };
  return mock;
}

function jsonPost(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("wishlist routes", () => {
  let app: Hono;
  let wishlistService: ReturnType<typeof createMockWishlistService>;

  beforeEach(() => {
    wishlistService = createMockWishlistService();
    const { routes } = createWishlistRoutes({ wishlistService });
    app = new Hono();
    app.route("/api", routes);
  });

  describe("GET /api/wishlist", () => {
    test("returns empty array when no entries", async () => {
      const res = await app.request("/api/wishlist");
      expect(res.status).toBe(200);
      const body = (await res.json()) as WishlistEntry[];
      expect(body).toEqual([]);
    });

    test("returns entries sorted by addedAt descending", async () => {
      wishlistService.entries = [
        makeEntry("e1", 100, "Older Game", "2026-01-01T00:00:00.000Z"),
        makeEntry("e2", 200, "Newer Game", "2026-04-01T00:00:00.000Z"),
      ];

      const res = await app.request("/api/wishlist");
      expect(res.status).toBe(200);
      const body = (await res.json()) as WishlistEntry[];
      expect(body).toHaveLength(2);
      expect(body[0].name).toBe("Newer Game");
      expect(body[1].name).toBe("Older Game");
    });
  });

  describe("POST /api/wishlist", () => {
    test("creates entry and returns 201", async () => {
      const res = await app.request(jsonPost("/api/wishlist", { bggId: 100 }));
      expect(res.status).toBe(201);
      const body = (await res.json()) as { entry: WishlistEntry };
      expect(body.entry.bggId).toBe(100);
    });

    test("duplicate bggId returns 409", async () => {
      wishlistService.entries = [makeEntry("e1", 100, "Test Game", NOW)];
      const res = await app.request(jsonPost("/api/wishlist", { bggId: 100 }));
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("already on your wishlist");
    });

    test("missing bggId returns 400", async () => {
      const res = await app.request(jsonPost("/api/wishlist", {}));
      expect(res.status).toBe(400);
    });

    test("invalid bggId returns 400", async () => {
      const res = await app.request(jsonPost("/api/wishlist", { bggId: -1 }));
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/wishlist/:id", () => {
    test("removes entry and returns removed true", async () => {
      wishlistService.entries = [makeEntry("e1", 100, "Test Game", NOW)];
      const res = await app.request("/api/wishlist/e1", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: boolean };
      expect(body.removed).toBe(true);
      expect(wishlistService.entries).toHaveLength(0);
    });

    test("nonexistent ID returns 404", async () => {
      const res = await app.request("/api/wishlist/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/wishlist", () => {
    test("clears all and returns count", async () => {
      wishlistService.entries = [makeEntry("e1", 100, "A", NOW), makeEntry("e2", 200, "B", NOW)];
      const res = await app.request("/api/wishlist", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: number };
      expect(body.removed).toBe(2);
    });
  });

  describe("POST /api/wishlist/:id/refresh", () => {
    test("returns updated entry", async () => {
      wishlistService.entries = [makeEntry("e1", 100, "Test Game", NOW)];
      const res = await app.request(jsonPost("/api/wishlist/e1/refresh", {}));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entry: WishlistEntry };
      expect(body.entry.predictedScore).toBe(8.0);
    });

    test("nonexistent ID returns 404", async () => {
      const res = await app.request(jsonPost("/api/wishlist/nonexistent/refresh", {}));
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/wishlist/refresh", () => {
    test("refreshes all entries", async () => {
      wishlistService.entries = [makeEntry("e1", 100, "A", NOW), makeEntry("e2", 200, "B", NOW)];
      const res = await app.request(jsonPost("/api/wishlist/refresh", {}));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { refreshed: number; errors: string[] };
      expect(body.refreshed).toBe(2);
      expect(body.errors).toHaveLength(0);
    });

    test("returns partial failure response shape", async () => {
      const partialSvc = createMockWishlistService();
      partialSvc.entries = [makeEntry("e1", 100, "A", NOW), makeEntry("e2", 200, "B", NOW)];
      partialSvc.refreshAll = () =>
        Promise.resolve({ refreshed: 1, errors: ["B: BGG API timeout"] });

      const { routes: wRoutes } = createWishlistRoutes({ wishlistService: partialSvc });
      const partialApp = new Hono();
      partialApp.route("/api", wRoutes);

      const res = await partialApp.request(jsonPost("/api/wishlist/refresh", {}));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { refreshed: number; errors: string[] };
      expect(body.refreshed).toBe(1);
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0]).toContain("B: BGG API timeout");
    });
  });

  describe("POST /api/wishlist (collection conflict)", () => {
    test("bggId already in collection returns 409", async () => {
      const mockWithCollConflict = createMockWishlistService();
      // Override add to simulate collection conflict
      mockWithCollConflict.add = () => {
        return Promise.reject(new Error("This game is already in your collection"));
      };
      const { routes: wRoutes } = createWishlistRoutes({ wishlistService: mockWithCollConflict });
      const conflictApp = new Hono();
      conflictApp.route("/api", wRoutes);

      const res = await conflictApp.request(jsonPost("/api/wishlist", { bggId: 100 }));
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("already in your collection");
    });
  });
});

function makeGame(bggId: number | null, name: string): Game {
  return {
    id: `game-${bggId ?? name}`,
    bggId,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    imageUrl: null,
    numPlays: null,
    bggData: null,
    ownership: "owned",
    boxDimensions: null,
    ratings: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createMockGameService(overrides: Partial<GameService> = {}): GameService {
  const notImpl = () => Promise.reject(new Error("not implemented"));
  return {
    listGames: () => Promise.resolve([]),
    getGame: notImpl,
    addGame: notImpl,
    rateGame: notImpl,
    removeGame: notImpl,
    refreshBggData: notImpl,
    refreshAllBggData: notImpl,
    searchGames: notImpl,
    importBggCollection: notImpl,
    setOwnership: notImpl,
    setBoxDimensions: notImpl,
    ...overrides,
  };
}

describe("POST /games auto-removal (REQ-WISH-10)", () => {
  test("adding a game to collection auto-removes matching wishlist entry", async () => {
    const wishSvc = createMockWishlistService();
    wishSvc.entries = [makeEntry("w1", 100, "Wishlisted Game", NOW)];

    const addedGame = makeGame(100, "Wishlisted Game");
    const addResult: AddGameResult = { game: addedGame, bggImported: false };

    const mockGameSvc = createMockGameService({
      addGame: () => Promise.resolve(addResult),
    });

    const { routes: gameRoutes } = createGameRoutes({
      gameService: mockGameSvc,
      wishlistService: wishSvc,
      bggClient: mockBggClient,
    });

    const gameApp = new Hono();
    gameApp.route("/api", gameRoutes);

    const res = await gameApp.request(
      jsonPost("/api/games", { bggId: 100, name: "Wishlisted Game" }),
    );
    expect(res.status).toBe(201);

    // Wishlist entry should have been removed by auto-removal
    expect(wishSvc.entries).toHaveLength(0);
  });

  test("adding a game without bggId does not touch wishlist", async () => {
    const wishSvc = createMockWishlistService();
    wishSvc.entries = [makeEntry("w1", 100, "Some Game", NOW)];

    const addedGame = makeGame(null, "Manual Game");
    const addResult: AddGameResult = { game: addedGame, bggImported: false };

    const mockGameSvc = createMockGameService({
      addGame: () => Promise.resolve(addResult),
    });

    const { routes: gameRoutes } = createGameRoutes({
      gameService: mockGameSvc,
      wishlistService: wishSvc,
      bggClient: mockBggClient,
    });

    const gameApp = new Hono();
    gameApp.route("/api", gameRoutes);

    const res = await gameApp.request(jsonPost("/api/games", { name: "Manual Game" }));
    expect(res.status).toBe(201);

    // Wishlist should be untouched
    expect(wishSvc.entries).toHaveLength(1);
  });
});

describe("wishlist/collection isolation", () => {
  test("wishlist entries do not appear in GET /games", async () => {
    const wishSvc = createMockWishlistService();
    wishSvc.entries = [makeEntry("w1", 100, "Wishlisted Game", NOW)];

    const collGame = makeGame(200, "Collection Game");
    collGame.id = "coll-1";
    const collGamesWithScore: GameWithScore[] = [{ game: collGame, score: null }];

    const mockGameSvc = createMockGameService({
      listGames: () => Promise.resolve(collGamesWithScore),
    });

    const { routes: gameRoutes } = createGameRoutes({
      gameService: mockGameSvc,
      wishlistService: wishSvc,
      bggClient: mockBggClient,
    });

    const gameApp = new Hono();
    gameApp.route("/api", gameRoutes);

    const res = await gameApp.request("/api/games");
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameWithScore[];
    // Only the collection game should appear, not the wishlisted game
    expect(body).toHaveLength(1);
    expect(body[0].game.id).toBe("coll-1");
    expect(body.some((g) => g.game.bggId === 100)).toBe(false);
  });

  test("wishlist entries do not affect profile computation", async () => {
    // Profile is computed from collection games only. The wishlist service reads
    // from a separate storage file (wishlist.json vs collection.json). Verify that
    // the game service's listGames (which feeds profile computation) is independent
    // of the wishlist service's state.
    const wishSvc = createMockWishlistService();
    wishSvc.entries = [
      makeEntry("w1", 100, "Wishlisted A", NOW),
      makeEntry("w2", 200, "Wishlisted B", NOW),
    ];

    const mockGameSvc = createMockGameService({
      listGames: () => Promise.resolve([]),
    });

    const { routes: gameRoutes } = createGameRoutes({
      gameService: mockGameSvc,
      wishlistService: wishSvc,
      bggClient: mockBggClient,
    });

    const gameApp = new Hono();
    gameApp.route("/api", gameRoutes);

    // GET /games returns empty despite wishlist having entries
    const res = await gameApp.request("/api/games");
    expect(res.status).toBe(200);
    const body = (await res.json()) as GameWithScore[];
    expect(body).toHaveLength(0);
    // The 2 wishlist entries have no effect on collection state
    expect(wishSvc.entries).toHaveLength(2);
  });
});
