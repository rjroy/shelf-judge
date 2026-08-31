import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import type {
  Collection,
  ShelfCapacityResult,
  ShelfConfiguration,
  ShelfUnit,
} from "@shelf-judge/shared";
import { createShelfRoutes } from "../src/routes/shelf";
import { createShelfService } from "../src/services/shelf-service";
import type { CapacityService } from "../src/services/capacity-service";
import type { StorageService } from "../src/services/storage-service";

const NOW = "2026-04-13T12:00:00.000Z";

function createMockStorage(): StorageService & {
  config: ShelfConfiguration;
  collection: Collection;
} {
  const mock = {
    config: {
      units: [],
      createdAt: NOW,
      updatedAt: NOW,
    } as ShelfConfiguration,
    collection: {
      schemaVersion: 6,
      revision: 0,
      id: "collection-1",
      name: "Test",
      axes: [],
      games: [],
      intentions: [],
      commandReceipts: [],
      entertainmentBenchmark: null,
      createdAt: NOW,
      updatedAt: NOW,
    } as Collection,
    loadShelfConfig() {
      return Promise.resolve(structuredClone(mock.config));
    },
    saveShelfConfig(c: ShelfConfiguration) {
      mock.config = structuredClone(c);
      return Promise.resolve();
    },
    loadCollection: () => Promise.resolve(structuredClone(mock.collection)),
    saveCollection(c: Collection) {
      mock.collection = structuredClone(c);
      return Promise.resolve();
    },
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

function createMockCapacityService(result?: ShelfCapacityResult): CapacityService & {
  lastCalled: number;
  resultOverride: ShelfCapacityResult | Error;
} {
  const defaultResult: ShelfCapacityResult = {
    configured: false,
    totalShelfCount: 0,
    gamesWithDimensions: 0,
    gamesWithoutDimensions: 0,
    overflowing: false,
    hasPlacementProblems: false,
    assignments: [],
    assignmentConflicts: [],
    unfittableGames: [],
    overflowGames: [],
  };
  const mock = {
    lastCalled: 0,
    resultOverride: (result ?? defaultResult) as ShelfCapacityResult | Error,
    computeCapacity() {
      mock.lastCalled++;
      if (mock.resultOverride instanceof Error) {
        return Promise.reject(mock.resultOverride);
      }
      return Promise.resolve(structuredClone(mock.resultOverride));
    },
  };
  return mock;
}

describe("shelf routes", () => {
  let app: Hono;
  let storage: ReturnType<typeof createMockStorage>;
  let capacityService: ReturnType<typeof createMockCapacityService>;

  beforeEach(() => {
    storage = createMockStorage();
    const shelfService = createShelfService({ storageService: storage });
    capacityService = createMockCapacityService();
    const { routes } = createShelfRoutes({ shelfService, capacityService });
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
          shelves: [
            { id: "s1", name: "Top", dimensionless: false, width: 13, height: 13, depth: 15 },
          ],
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
          shelves: [
            { id: "s1", name: "Shelf 1", dimensionless: false, width: 24, height: 12, depth: 10 },
          ],
        },
      ];

      const res = await app.request("/api/shelf/config", jsonRequest("PUT", { units }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        config: ShelfConfiguration;
        clearedAssignmentCount: number;
      };
      expect(body.config.units).toHaveLength(1);
      expect(body.config.units[0].name).toBe("Bookcase");
      expect(body.config.createdAt).toBe(NOW); // preserved
      expect(body.clearedAssignmentCount).toBe(0);
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
          shelves: [{ name: "Cube 1", dimensionless: false, width: 13, height: 13, depth: 15 }],
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
          shelves: [{ name: "Bad", dimensionless: false, width: -1, height: 10, depth: 10 }],
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
            { name: "Shelf A", dimensionless: false, width: 13, height: 13, depth: 15 },
            { name: "Shelf B", dimensionless: false, width: 13, height: 13, depth: 15 },
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
      const body = (await res.json()) as { unit: ShelfUnit; clearedAssignmentCount: number };
      expect(body.unit.name).toBe("Renamed Kallax");
      expect(body.unit.shelves).toHaveLength(2); // unchanged
    });

    test("updates shelves: add new, update existing, remove absent", async () => {
      const existingShelfId = storage.config.units[0].shelves[0].id;

      const res = await app.request(
        `/api/shelf/units/${unitId}`,
        jsonRequest("PUT", {
          shelves: [
            {
              id: existingShelfId,
              name: "Shelf A Updated",
              dimensionless: false,
              width: 14,
              height: 14,
              depth: 16,
            },
            { name: "Shelf C", dimensionless: false, width: 10, height: null, depth: 12 },
          ],
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { unit: ShelfUnit; clearedAssignmentCount: number };
      expect(body.unit.shelves).toHaveLength(2);
      expect(body.unit.shelves[0].id).toBe(existingShelfId);
      expect(body.unit.shelves[0].name).toBe("Shelf A Updated");
      expect(body.unit.shelves[1].height).toBeNull();
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
      const body = (await res.json()) as { removed: boolean; clearedAssignmentCount: number };
      expect(body.removed).toBe(true);
      expect(body.clearedAssignmentCount).toBe(0);
      expect(storage.config.units).toHaveLength(0);
    });

    test("returns 404 for nonexistent unit", async () => {
      const res = await app.request("/api/shelf/units/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/shelf/capacity", () => {
    test("returns the capacity service result verbatim", async () => {
      capacityService.resultOverride = {
        configured: true,
        totalShelfCount: 2,
        gamesWithDimensions: 3,
        gamesWithoutDimensions: 1,
        overflowing: false,
        hasPlacementProblems: false,
        assignments: [
          {
            shelfId: "s1",
            shelfName: "Top",
            unitId: "u1",
            unitName: "Kallax",
            dimensionless: false,
            capacityIn3: 2535,
            usedIn3: 200,
            utilization: 200 / 2535,
            games: [
              {
                gameId: "g1",
                gameName: "A",
                fitnessScore: 7,
                volumeIn3: 200,
                assignmentSource: "automatic",
              },
            ],
            grade: "B",
          },
        ],
        assignmentConflicts: [],
        unfittableGames: [],
        overflowGames: [],
      };

      const res = await app.request("/api/shelf/capacity");
      expect(res.status).toBe(200);
      const body = (await res.json()) as ShelfCapacityResult;
      expect(body.configured).toBe(true);
      expect(body.totalShelfCount).toBe(2);
      expect(body.assignments).toHaveLength(1);
      expect(body.assignments[0].games[0].gameId).toBe("g1");
      expect(capacityService.lastCalled).toBe(1);
    });

    test("returns configured: false when no shelves exist", async () => {
      const res = await app.request("/api/shelf/capacity");
      expect(res.status).toBe(200);
      const body = (await res.json()) as ShelfCapacityResult;
      expect(body.configured).toBe(false);
      expect(body.assignments).toEqual([]);
    });

    test("returns 500 on service failure", async () => {
      capacityService.resultOverride = new Error("boom");
      const res = await app.request("/api/shelf/capacity");
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("boom");
    });
  });
});
