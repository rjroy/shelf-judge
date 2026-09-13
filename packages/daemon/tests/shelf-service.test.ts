/* eslint-disable @typescript-eslint/await-thenable */
import { describe, expect, test, beforeEach } from "bun:test";
import type { Collection, DurableGame, ShelfConfiguration } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import {
  createShelfService,
  ShelfValidationError,
  ShelfNotFoundError,
} from "../src/services/shelf-service";
import type { ShelfService } from "../src/services/shelf-service";
import { createGameService } from "../src/services/game-service";
import { createFitnessService } from "../src/services/fitness-service";

const NOW = "2026-04-13T12:00:00.000Z";

function createMockStorage(): StorageService & {
  config: ShelfConfiguration;
  collection: Collection;
  shelfSaveFailures: Array<Error | null>;
  collectionSaveFailure: Error | null;
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
    shelfSaveFailures: [] as Array<Error | null>,
    collectionSaveFailure: null as Error | null,
    loadShelfConfig() {
      return Promise.resolve(structuredClone(mock.config));
    },
    saveShelfConfig(c: ShelfConfiguration) {
      const failure = mock.shelfSaveFailures.shift();
      if (failure) return Promise.reject(failure);
      mock.config = structuredClone(c);
      return Promise.resolve();
    },
    // Stubs for unused StorageService methods
    loadCollection: () => Promise.resolve(structuredClone(mock.collection)),
    saveCollection(c: Collection) {
      if (mock.collectionSaveFailure) return Promise.reject(mock.collectionSaveFailure);
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

function assignedGame(id: string, shelfId: string): DurableGame {
  return {
    id,
    bggId: null,
    entityMetadata: createInitialEntityMetadata(null),
    name: id,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    latestPlayCountCheck: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    ownership: "owned",
    boxDimensions: { width: 10, height: 10, depth: 2 },
    manualShelfId: shelfId,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    ratings: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
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

  test("serializes shelf removal with manual assignment validation", async () => {
    storage.config.units = [
      {
        id: "unit-1",
        name: "Unit",
        shelves: [
          {
            id: "shelf-1",
            name: "Shelf",
            dimensionless: false,
            width: 20,
            height: 20,
            depth: 20,
          },
        ],
      },
    ];
    storage.collection.games = [assignedGame("game-1", "shelf-1")];
    let signalSaveStarted = () => {};
    let releaseSave = () => {};
    const saveStarted = new Promise<void>((resolve) => {
      signalSaveStarted = resolve;
    });
    const saveRelease = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    storage.saveCollection = async (next) => {
      signalSaveStarted();
      await saveRelease;
      storage.collection = structuredClone(next);
    };
    const gameService = createGameService({
      storageService: storage,
      fitnessService: createFitnessService(),
    });

    const removal = service.removeUnit("unit-1");
    await saveStarted;
    const assignment = gameService.setManualShelf("game-1", "shelf-1");
    releaseSave();
    await removal;
    await expect(assignment).rejects.toThrow("Shelf not found: shelf-1");

    expect(storage.config.units).toEqual([]);
    expect(storage.collection.games[0]?.manualShelfId).toBeNull();
  });

  describe("addUnit", () => {
    test("creates a unit with generated IDs", async () => {
      const unit = await service.addUnit({
        name: "Living Room Kallax",
        shelves: [
          { name: "Top shelf", dimensionless: false, width: 13, height: 13, depth: 15 },
          { name: "Bottom shelf", dimensionless: false, width: 13, height: 13, depth: 15 },
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
        shelves: [{ name: "On top", dimensionless: false, width: 13, height: null, depth: 15 }],
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
          shelves: [{ name: "", dimensionless: false, width: 13, height: 13, depth: 15 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("rejects shelf with width <= 0", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "Shelf", dimensionless: false, width: 0, height: 13, depth: 15 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("rejects shelf with negative width", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "Shelf", dimensionless: false, width: -5, height: 13, depth: 15 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("rejects shelf with depth <= 0", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "Shelf", dimensionless: false, width: 13, height: 13, depth: 0 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("rejects shelf with height <= 0 (not null)", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "Shelf", dimensionless: false, width: 13, height: 0, depth: 15 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("rejects shelf with negative height", async () => {
      await expect(
        service.addUnit({
          name: "Kallax",
          shelves: [{ name: "Shelf", dimensionless: false, width: 13, height: -3, depth: 15 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("creates a dimensionless shelf with no dimensions required", async () => {
      const unit = await service.addUnit({
        name: "Drawer Unit",
        shelves: [
          {
            name: "Wallet game drawer",
            dimensionless: true,
            width: null,
            height: null,
            depth: null,
          },
        ],
      });

      expect(unit.shelves[0].dimensionless).toBe(true);
      expect(unit.shelves[0].width).toBeNull();
      expect(unit.shelves[0].height).toBeNull();
      expect(unit.shelves[0].depth).toBeNull();
    });

    test("forces dimensions to null for a dimensionless shelf even if provided", async () => {
      const unit = await service.addUnit({
        name: "Drawer Unit",
        shelves: [{ name: "Drawer", dimensionless: true, width: 10, height: 10, depth: 10 }],
      });

      expect(unit.shelves[0].width).toBeNull();
      expect(unit.shelves[0].height).toBeNull();
      expect(unit.shelves[0].depth).toBeNull();
    });
  });

  describe("updateUnit", () => {
    test("updates unit name", async () => {
      const unit = await service.addUnit({
        name: "Old Name",
        shelves: [{ name: "Shelf", dimensionless: false, width: 13, height: 13, depth: 15 }],
      });

      const { unit: updated } = await service.updateUnit(unit.id, { name: "New Name" });
      expect(updated.name).toBe("New Name");
      expect(updated.shelves).toHaveLength(1); // shelves unchanged
    });

    test("updates shelves: add new, update existing, remove absent", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [
          { name: "Shelf A", dimensionless: false, width: 13, height: 13, depth: 15 },
          { name: "Shelf B", dimensionless: false, width: 13, height: 13, depth: 15 },
        ],
      });

      const shelfAId = unit.shelves[0].id;

      // Update Shelf A, drop Shelf B, add Shelf C
      const { unit: updated } = await service.updateUnit(unit.id, {
        shelves: [
          {
            id: shelfAId,
            name: "Shelf A Updated",
            dimensionless: false,
            width: 14,
            height: 14,
            depth: 16,
          },
          { name: "Shelf C", dimensionless: false, width: 10, height: 10, depth: 12 },
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

    test("rejects phantom shelf ID that doesn't match any existing shelf", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [{ name: "Shelf A", dimensionless: false, width: 13, height: 13, depth: 15 }],
      });

      await expect(
        service.updateUnit(unit.id, {
          shelves: [
            {
              id: "nonexistent-shelf-id",
              name: "Ghost",
              dimensionless: false,
              width: 10,
              height: 10,
              depth: 10,
            },
          ],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("validates shelf dimensions on update", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [],
      });

      await expect(
        service.updateUnit(unit.id, {
          shelves: [{ name: "Bad shelf", dimensionless: false, width: -1, height: 10, depth: 10 }],
        }),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("clears only assignments to shelves removed by an update", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [
          { name: "Keep", dimensionless: false, width: 13, height: 13, depth: 15 },
          { name: "Remove", dimensionless: false, width: 13, height: 13, depth: 15 },
        ],
      });
      const [keptShelf, removedShelf] = unit.shelves;
      storage.collection.games = [
        assignedGame("keep-game", keptShelf.id),
        assignedGame("clear-game", removedShelf.id),
      ];

      const result = await service.updateUnit(unit.id, {
        shelves: [
          {
            id: keptShelf.id,
            name: "Renamed",
            dimensionless: false,
            width: 14,
            height: 13,
            depth: 15,
          },
        ],
      });

      expect(result.clearedAssignmentCount).toBe(1);
      expect(storage.collection.games[0].manualShelfId).toBe(keptShelf.id);
      expect(storage.collection.games[1].manualShelfId).toBeNull();
    });
  });

  describe("removeUnit", () => {
    test("removes an existing unit", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [{ name: "Shelf", dimensionless: false, width: 13, height: 13, depth: 15 }],
      });

      await service.removeUnit(unit.id);
      const config = await service.getConfig();
      expect(config.units).toHaveLength(0);
    });

    test("clears assignments to shelves in a removed unit", async () => {
      const unit = await service.addUnit({
        name: "Kallax",
        shelves: [{ name: "Shelf", dimensionless: false, width: 13, height: 13, depth: 15 }],
      });
      storage.collection.games = [assignedGame("game-1", unit.shelves[0].id)];

      const result = await service.removeUnit(unit.id);
      expect(result).toEqual({ removed: true, clearedAssignmentCount: 1 });
      expect(storage.collection.games[0].manualShelfId).toBeNull();
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
        shelves: [{ name: "Shelf", dimensionless: false, width: 13, height: 13, depth: 15 }],
      });

      const newUnits = [
        {
          id: "unit-1",
          name: "New Unit A",
          shelves: [
            {
              id: "shelf-1",
              name: "Shelf 1",
              dimensionless: false,
              width: 20,
              height: 15,
              depth: 12,
            },
          ],
        },
        {
          id: "unit-2",
          name: "New Unit B",
          shelves: [],
        },
      ];

      const { config } = await service.setConfig(newUnits);
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
            shelves: [
              { id: "s1", name: "Bad", dimensionless: false, width: 0, height: 10, depth: 10 },
            ],
          },
        ]),
      ).rejects.toThrow(ShelfValidationError);
    });

    test("empty units array clears configuration", async () => {
      await service.addUnit({ name: "Unit", shelves: [] });
      const { config } = await service.setConfig([]);
      expect(config.units).toHaveLength(0);
    });

    test("full replacement clears only assignments to removed shelf IDs", async () => {
      storage.config.units = [
        {
          id: "unit-1",
          name: "Unit",
          shelves: [
            { id: "keep", name: "Keep", dimensionless: false, width: 10, height: 10, depth: 10 },
            {
              id: "remove",
              name: "Remove",
              dimensionless: false,
              width: 10,
              height: 10,
              depth: 10,
            },
          ],
        },
      ];
      storage.collection.games = [
        assignedGame("keep-game", "keep"),
        assignedGame("clear", "remove"),
      ];

      const result = await service.setConfig([
        {
          id: "unit-1",
          name: "Renamed",
          shelves: [
            { id: "keep", name: "Resized", dimensionless: false, width: 20, height: 10, depth: 10 },
          ],
        },
      ]);

      expect(result.clearedAssignmentCount).toBe(1);
      expect(storage.collection.games.map((game) => game.manualShelfId)).toEqual(["keep", null]);
    });

    test("a shelf write failure leaves collection and configuration unchanged", async () => {
      storage.config.units = [
        {
          id: "unit-1",
          name: "Unit",
          shelves: [
            {
              id: "remove",
              name: "Remove",
              dimensionless: false,
              width: 10,
              height: 10,
              depth: 10,
            },
          ],
        },
      ];
      storage.collection.games = [assignedGame("game-1", "remove")];
      storage.shelfSaveFailures.push(new Error("shelf write failed"));

      await expect(service.setConfig([])).rejects.toThrow("shelf write failed");
      expect(storage.config.units).toHaveLength(1);
      expect(storage.collection.games[0].manualShelfId).toBe("remove");
    });

    test("a collection write failure rolls back the shelf configuration", async () => {
      storage.config.units = [
        {
          id: "unit-1",
          name: "Unit",
          shelves: [
            {
              id: "remove",
              name: "Remove",
              dimensionless: false,
              width: 10,
              height: 10,
              depth: 10,
            },
          ],
        },
      ];
      storage.collection.games = [assignedGame("game-1", "remove")];
      storage.collectionSaveFailure = new Error("collection write failed");

      await expect(service.setConfig([])).rejects.toThrow("collection write failed");
      expect(storage.config.units[0].shelves[0].id).toBe("remove");
      expect(storage.collection.games[0].manualShelfId).toBe("remove");
    });

    test("reports a hard error when rollback also fails", async () => {
      storage.config.units = [
        {
          id: "unit-1",
          name: "Unit",
          shelves: [
            {
              id: "remove",
              name: "Remove",
              dimensionless: false,
              width: 10,
              height: 10,
              depth: 10,
            },
          ],
        },
      ];
      storage.collection.games = [assignedGame("game-1", "remove")];
      storage.collectionSaveFailure = new Error("collection write failed");
      storage.shelfSaveFailures.push(null, new Error("rollback failed"));

      await expect(service.setConfig([])).rejects.toThrow(
        "cleanup failed and shelf configuration rollback failed",
      );
    });
  });
});
