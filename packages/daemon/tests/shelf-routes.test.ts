import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import type { ShelfConfiguration, ShelfUnit } from "@shelf-judge/shared";
import { createShelfRoutes } from "../src/routes/shelf";
import { createShelfService } from "../src/services/shelf-service";
import type { StorageService } from "../src/services/storage-service";

const NOW = "2026-04-13T12:00:00.000Z";

function createMockStorage(): StorageService & { config: ShelfConfiguration } {
  const mock = {
    config: {
      units: [],
      createdAt: NOW,
      updatedAt: NOW,
    } as ShelfConfiguration,
    loadShelfConfig() {
      return Promise.resolve(structuredClone(mock.config));
    },
    saveShelfConfig(c: ShelfConfiguration) {
      mock.config = structuredClone(c);
      return Promise.resolve();
    },
    loadCollection: () => Promise.reject(new Error("not implemented")),
    saveCollection: () => Promise.resolve(),
    loadConfig: () => Promise.reject(new Error("not implemented")),
    saveConfig: () => Promise.resolve(),
    loadTournament: () => Promise.reject(new Error("not implemented")),
    saveTournament: () => Promise.resolve(),
    loadProfile: () => Promise.resolve(null),
    saveProfile: () => Promise.resolve(),
    loadPredictionSettings: () => Promise.reject(new Error("not implemented")),
    savePredictionSettings: () => Promise.resolve(),
    loadNicheSettings: () => Promise.reject(new Error("not implemented")),
    saveNicheSettings: () => Promise.resolve(),
    loadRedundancySettings: () => Promise.reject(new Error("not implemented")),
    saveRedundancySettings: () => Promise.resolve(),
    loadWishlist: () => Promise.resolve([]),
    saveWishlist: () => Promise.resolve(),
  };
  return mock;
}

function jsonRequest(method: string, body: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("shelf routes", () => {
  let app: Hono;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    storage = createMockStorage();
    const shelfService = createShelfService({ storageService: storage });
    const { routes } = createShelfRoutes({ shelfService });
    app = new Hono();
    app.route("/api", routes);
  });

  describe("GET /api/shelf/config", () => {
    test("returns empty config when no file exists", async () => {
      const res = await app.request("/api/shelf/config");
      expect(res.status).toBe(200);
      const body = (await res.json()) as ShelfConfiguration;
      expect(body.units).toEqual([]);
      expect(body.createdAt).toBe(NOW);
    });

    test("returns config with units", async () => {
      storage.config.units = [
        {
          id: "u1",
          name: "Kallax",
          shelves: [{ id: "s1", name: "Top", width: 13, height: 13, depth: 15 }],
        },
      ];
      const res = await app.request("/api/shelf/config");
      expect(res.status).toBe(200);
      const body = (await res.json()) as ShelfConfiguration;
      expect(body.units).toHaveLength(1);
      expect(body.units[0].name).toBe("Kallax");
    });
  });

  describe("PUT /api/shelf/config", () => {
    test("replaces entire config", async () => {
      const units = [
        {
          id: "u1",
          name: "Bookcase",
          shelves: [{ id: "s1", name: "Shelf 1", width: 24, height: 12, depth: 10 }],
        },
      ];

      const res = await app.request("/api/shelf/config", jsonRequest("PUT", { units }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as ShelfConfiguration;
      expect(body.units).toHaveLength(1);
      expect(body.units[0].name).toBe("Bookcase");
      expect(body.createdAt).toBe(NOW); // preserved
    });

    test("returns 400 for missing units array", async () => {
      const res = await app.request("/api/shelf/config", jsonRequest("PUT", {}));
      expect(res.status).toBe(400);
    });

    test("returns 400 for invalid JSON", async () => {
      const res = await app.request("/api/shelf/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    test("returns 400 for validation errors", async () => {
      const res = await app.request(
        "/api/shelf/config",
        jsonRequest("PUT", { units: [{ id: "u1", name: "", shelves: [] }] }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("name");
    });
  });

  describe("POST /api/shelf/units", () => {
    test("adds unit with generated IDs and returns 201", async () => {
      const res = await app.request(
        "/api/shelf/units",
        jsonRequest("POST", {
          name: "Kallax",
          shelves: [{ name: "Cube 1", width: 13, height: 13, depth: 15 }],
        }),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as ShelfUnit;
      expect(body.id).toBeTruthy();
      expect(body.name).toBe("Kallax");
      expect(body.shelves).toHaveLength(1);
      expect(body.shelves[0].id).toBeTruthy();
      expect(body.shelves[0].name).toBe("Cube 1");
    });

    test("persists to storage", async () => {
      await app.request(
        "/api/shelf/units",
        jsonRequest("POST", {
          name: "Bookcase",
          shelves: [],
        }),
      );
      expect(storage.config.units).toHaveLength(1);
      expect(storage.config.units[0].name).toBe("Bookcase");
    });

    test("returns 400 for missing name", async () => {
      const res = await app.request("/api/shelf/units", jsonRequest("POST", { shelves: [] }));
      expect(res.status).toBe(400);
    });

    test("returns 400 for missing shelves", async () => {
      const res = await app.request("/api/shelf/units", jsonRequest("POST", { name: "Kallax" }));
      expect(res.status).toBe(400);
    });

    test("returns 400 for invalid shelf dimensions", async () => {
      const res = await app.request(
        "/api/shelf/units",
        jsonRequest("POST", {
          name: "Kallax",
          shelves: [{ name: "Bad", width: -1, height: 10, depth: 10 }],
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/shelf/units/:id", () => {
    let unitId: string;

    beforeEach(async () => {
      const res = await app.request(
        "/api/shelf/units",
        jsonRequest("POST", {
          name: "Kallax",
          shelves: [
            { name: "Shelf A", width: 13, height: 13, depth: 15 },
            { name: "Shelf B", width: 13, height: 13, depth: 15 },
          ],
        }),
      );
      const body = (await res.json()) as ShelfUnit;
      unitId = body.id;
    });

    test("updates unit name", async () => {
      const res = await app.request(
        `/api/shelf/units/${unitId}`,
        jsonRequest("PUT", { name: "Renamed Kallax" }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ShelfUnit;
      expect(body.name).toBe("Renamed Kallax");
      expect(body.shelves).toHaveLength(2); // unchanged
    });

    test("updates shelves: add new, update existing, remove absent", async () => {
      const existingShelfId = storage.config.units[0].shelves[0].id;

      const res = await app.request(
        `/api/shelf/units/${unitId}`,
        jsonRequest("PUT", {
          shelves: [
            { id: existingShelfId, name: "Shelf A Updated", width: 14, height: 14, depth: 16 },
            { name: "Shelf C", width: 10, height: null, depth: 12 },
          ],
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ShelfUnit;
      expect(body.shelves).toHaveLength(2);
      expect(body.shelves[0].id).toBe(existingShelfId);
      expect(body.shelves[0].name).toBe("Shelf A Updated");
      expect(body.shelves[1].height).toBeNull();
    });

    test("returns 404 for nonexistent unit", async () => {
      const res = await app.request(
        "/api/shelf/units/nonexistent",
        jsonRequest("PUT", { name: "Whatever" }),
      );
      expect(res.status).toBe(404);
    });

    test("returns 400 for validation errors", async () => {
      const res = await app.request(`/api/shelf/units/${unitId}`, jsonRequest("PUT", { name: "" }));
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/shelf/units/:id", () => {
    let unitId: string;

    beforeEach(async () => {
      const res = await app.request(
        "/api/shelf/units",
        jsonRequest("POST", { name: "Doomed", shelves: [] }),
      );
      const body = (await res.json()) as ShelfUnit;
      unitId = body.id;
    });

    test("removes unit and returns removed: true", async () => {
      const res = await app.request(`/api/shelf/units/${unitId}`, { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: boolean };
      expect(body.removed).toBe(true);
      expect(storage.config.units).toHaveLength(0);
    });

    test("returns 404 for nonexistent unit", async () => {
      const res = await app.request("/api/shelf/units/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });
});
