import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import type { WishlistEntry } from "@shelf-judge/shared";
import { createWishlistRoutes } from "../src/routes/wishlist";
import type { WishlistService } from "../src/services/wishlist-service";

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
  });
});
