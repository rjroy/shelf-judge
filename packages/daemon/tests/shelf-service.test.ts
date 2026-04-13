import { describe, expect, test, beforeEach } from "bun:test";
import type { ShelfConfiguration } from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import {
  createShelfService,
  ShelfValidationError,
  ShelfNotFoundError,
} from "../src/services/shelf-service";
import type { ShelfService } from "../src/services/shelf-service";

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
    // Stubs for unused StorageService methods
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

describe("shelf service", () => {
  let storage: ReturnType<typeof createMockStorage>;
  let service: ShelfService;

  beforeEach(() => {
    storage = createMockStorage();
    service = createShelfService({ storageService: storage });
  });

  describe("getConfig", () => {
    test("returns empty config initially", async () => {
      const config = await service.getConfig();
      expect(config.units).toEqual([]);
      expect(config.createdAt).toBe(NOW);
    });
  });

  describe("addUnit", () => {
    test("creates a unit with generated IDs", async () => {
      const unit = await service.addUnit({
        name: "Living Room Kallax",
        shelves: [
          { name: "Top shelf", width: 13, height: 13, depth: 15 },
          { name: "Bottom shelf", width: 13, height: 13, depth: 15 },
        ],
      });

      expect(unit.id).toBeTruthy();
      expect(unit.name).toBe("Living Room Kallax");
      expect(unit.shelves).toHaveLength(2);
      expect(unit.shelves[0].id).toBeTruthy();
      expect(unit.shelves[0].name).toBe("Top shelf");
      expect(unit.shelves[0].width).toBe(13);
      expect(unit.shelves[0].height).toBe(13);
      expect(unit.shelves[0].depth).toBe(15);

      // Persisted
      expect(storage.config.units).toHaveLength(1);
      expect(storage.config.units[0].id).toBe(unit.id);
    });

    test("allows null height for unconstrained shelves", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [{ name: "On top", width: 13, height: null, depth: 15 }],
      });

      expect(unit.shelves[0].height).toBeNull();
    });

    test("rejects empty unit name", async () => {
      await expect(service.addUnit({ name: "", shelves: [] })).rejects.toThrow(
        ShelfValidationError,
      );
    });

    test("rejects whitespace-only unit name", async () => {
      await expect(service.addUnit({ name: "   ", shelves: [] })).rejects.toThrow(
        ShelfValidationError,
      );
    });

    test("rejects shelf with empty name", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "", width: 13, height: 13, depth: 15 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("rejects shelf with width <= 0", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "Shelf", width: 0, height: 13, depth: 15 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("rejects shelf with negative width", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "Shelf", width: -5, height: 13, depth: 15 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("rejects shelf with depth <= 0", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "Shelf", width: 13, height: 13, depth: 0 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("rejects shelf with height <= 0 (not null)", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "Shelf", width: 13, height: 0, depth: 15 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("rejects shelf with negative height", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "Shelf", width: 13, height: -3, depth: 15 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });
  });

  describe("updateUnit", () => {
    test("updates unit name", async () => {
      const unit = await service.addUnit({
        name: "Old Name",
        shelves: [{ name: "Shelf", width: 13, height: 13, depth: 15 }],
      });

      const updated = await service.updateUnit(unit.id, { name: "New Name" });
      expect(updated.name).toBe("New Name");
      expect(updated.shelves).toHaveLength(1); // shelves unchanged
    });

    test("updates shelves: add new, update existing, remove absent", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [
          { name: "Shelf A", width: 13, height: 13, depth: 15 },
          { name: "Shelf B", width: 13, height: 13, depth: 15 },
        ],
      });

      const shelfAId = unit.shelves[0].id;

      // Update Shelf A, drop Shelf B, add Shelf C
      const updated = await service.updateUnit(unit.id, {
        shelves: [
          { id: shelfAId, name: "Shelf A Updated", width: 14, height: 14, depth: 16 },
          { name: "Shelf C", width: 10, height: 10, depth: 12 },
        ],
      });

      expect(updated.shelves).toHaveLength(2);
      // Shelf A retained its ID and was updated
      expect(updated.shelves[0].id).toBe(shelfAId);
      expect(updated.shelves[0].name).toBe("Shelf A Updated");
      expect(updated.shelves[0].width).toBe(14);
      // Shelf C is new with a new ID
      expect(updated.shelves[1].id).toBeTruthy();
      expect(updated.shelves[1].id).not.toBe(shelfAId);
      expect(updated.shelves[1].name).toBe("Shelf C");
    });

    test("throws ShelfNotFoundError for nonexistent unit", async () => {
      await expect(service.updateUnit("nonexistent-id", { name: "Whatever" })).rejects.toThrow(
        ShelfNotFoundError,
      );
    });

    test("rejects empty name on update", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [],
      });

      await expect(service.updateUnit(unit.id, { name: "" })).rejects.toThrow(ShelfValidationError);
    });

    test("validates shelf dimensions on update", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [],
      });

      await expect(
        service.updateUnit(unit.id, {
          shelves: [{ name: "Bad shelf", width: -1, height: 10, depth: 10 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });
  });

  describe("removeUnit", () => {
    test("removes an existing unit", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [{ name: "Shelf", width: 13, height: 13, depth: 15 }],
      });

      await service.removeUnit(unit.id);
      const config = await service.getConfig();
      expect(config.units).toHaveLength(0);
    });

    test("throws ShelfNotFoundError for nonexistent unit", async () => {
      await expect(service.removeUnit("nonexistent-id")).rejects.toThrow(ShelfNotFoundError);
    });
  });

  describe("setConfig", () => {
    test("replaces entire configuration", async () => {
      // Add a unit first
      await service.addUnit({
        name: "Old Unit",
        shelves: [{ name: "Shelf", width: 13, height: 13, depth: 15 }],
      });

      const newUnits = [
        {
          id: "unit-1",
          name: "New Unit A",
          shelves: [{ id: "shelf-1", name: "Shelf 1", width: 20, height: 15, depth: 12 }],
        },
        {
          id: "unit-2",
          name: "New Unit B",
          shelves: [],
        },
      ];

      const config = await service.setConfig(newUnits);
      expect(config.units).toHaveLength(2);
      expect(config.units[0].name).toBe("New Unit A");
      expect(config.units[1].name).toBe("New Unit B");
      expect(config.createdAt).toBe(NOW); // preserved
    });

    test("validates units on full config set", async () => {
      await expect(
        service.setConfig([
          {
            id: "u1",
            name: "",
            shelves: [],
          },
        ]),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("validates shelves on full config set", async () => {
      await expect(
        service.setConfig([
          {
            id: "u1",
            name: "Valid Unit",
            shelves: [{ id: "s1", name: "Bad", width: 0, height: 10, depth: 10 }],
          },
        ]),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("empty units array clears configuration", async () => {
      await service.addUnit({ name: "Unit", shelves: [] });
      const config = await service.setConfig([]);
      expect(config.units).toHaveLength(0);
    });
  });
});
