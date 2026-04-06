import { describe, test, expect, beforeEach } from "bun:test";
import { createAxisService } from "../../src/services/axis-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import type { AxisService } from "../../src/services/axis-service.js";
import type { StorageService } from "../../src/services/storage-service.js";
import type { MockFileOps } from "../helpers/mock-file-ops.js";

let fileOps: MockFileOps;
let storageService: StorageService;
let axisService: AxisService;

beforeEach(() => {
  fileOps = createMockFileOps();
  storageService = createStorageService({
    dataDir: "/data",
    configPath: "/config/config.json",
    fileOps,
  });
  axisService = createAxisService({ storageService });
});

describe("AxisService", () => {
  describe("createAxis", () => {
    test("creates an axis with generated UUID", async () => {
      const axis = await axisService.createAxis({
        name: "Fun Factor",
        weight: 30,
      });

      expect(axis.id).toBeTruthy();
      expect(axis.name).toBe("Fun Factor");
      expect(axis.weight).toBe(30);
      expect(axis.source).toBe("personal");
      expect(axis.bggField).toBeNull();
      expect(axis.description).toBeNull();
    });

    test("stores axis in collection", async () => {
      await axisService.createAxis({ name: "Fun", weight: 50 });
      const axes = await axisService.listAxes();

      // Default collection has 2 BGG axes + our new one
      const fun = axes.find((a) => a.name === "Fun");
      expect(fun).toBeTruthy();
    });

    test("rejects invalid weight (0 is allowed by schema, 101 is not)", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(axisService.createAxis({ name: "Bad", weight: 101 })).rejects.toThrow();
    });

    test("rejects negative weight", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(axisService.createAxis({ name: "Bad", weight: -1 })).rejects.toThrow();
    });

    test("rejects non-integer weight", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(axisService.createAxis({ name: "Bad", weight: 5.5 })).rejects.toThrow();
    });
  });

  describe("listAxes", () => {
    test("returns default BGG-derived axes on fresh collection", async () => {
      const axes = await axisService.listAxes();

      expect(axes.length).toBe(2);
      expect(axes.find((a) => a.name === "Community Rating")).toBeTruthy();
      expect(axes.find((a) => a.name === "Complexity")).toBeTruthy();
    });
  });

  describe("updateAxis", () => {
    test("updates name and preserves other fields", async () => {
      const axis = await axisService.createAxis({
        name: "Original",
        weight: 50,
        description: "Original desc",
      });

      const updated = await axisService.updateAxis(axis.id, {
        name: "Renamed",
      });

      expect(updated.name).toBe("Renamed");
      expect(updated.weight).toBe(50);
      expect(updated.description).toBe("Original desc");
    });

    test("updates weight", async () => {
      const axis = await axisService.createAxis({
        name: "Test",
        weight: 50,
      });

      const updated = await axisService.updateAxis(axis.id, { weight: 75 });
      expect(updated.weight).toBe(75);
    });

    test("throws on non-existent axis", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(axisService.updateAxis("nonexistent", { name: "Nope" })).rejects.toThrow(
        "Axis not found",
      );
    });
  });

  describe("deleteAxis", () => {
    test("removes axis from collection", async () => {
      const axis = await axisService.createAxis({
        name: "Doomed",
        weight: 50,
      });

      await axisService.deleteAxis(axis.id);

      const axes = await axisService.listAxes();
      expect(axes.find((a) => a.id === axis.id)).toBeUndefined();
    });

    test("cascade deletes ratings on that axis from all games", async () => {
      // Set up: create an axis, manually add games with ratings on it
      const axis = await axisService.createAxis({
        name: "Cascade Test",
        weight: 50,
      });

      // Manually add games with ratings via storage
      const collection = await storageService.loadCollection();
      collection.games.push(
        {
          id: "g1",
          bggId: null,
          name: "Game 1",
          yearPublished: null,
          minPlayers: null,
          maxPlayers: null,
          playingTime: null,
          imageUrl: null,
          bggData: null,
          ratings: { [axis.id]: 8, "other-axis": 5 },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "g2",
          bggId: null,
          name: "Game 2",
          yearPublished: null,
          minPlayers: null,
          maxPlayers: null,
          playingTime: null,
          imageUrl: null,
          bggData: null,
          ratings: { [axis.id]: 6 },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "g3",
          bggId: null,
          name: "Game 3 (no rating on this axis)",
          yearPublished: null,
          minPlayers: null,
          maxPlayers: null,
          playingTime: null,
          imageUrl: null,
          bggData: null,
          ratings: { "other-axis": 7 },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      );
      await storageService.saveCollection(collection);

      const result = await axisService.deleteAxis(axis.id);

      expect(result.deletedRatingsCount).toBe(2);

      // Verify ratings are gone
      const updated = await storageService.loadCollection();
      const g1 = updated.games.find((g) => g.id === "g1")!;
      expect(g1.ratings[axis.id]).toBeUndefined();
      expect(g1.ratings["other-axis"]).toBe(5); // other ratings preserved

      const g2 = updated.games.find((g) => g.id === "g2")!;
      expect(g2.ratings[axis.id]).toBeUndefined();
    });

    test("returns zero count when no games have ratings on the axis", async () => {
      const axis = await axisService.createAxis({
        name: "Unused",
        weight: 50,
      });

      const result = await axisService.deleteAxis(axis.id);
      expect(result.deletedRatingsCount).toBe(0);
    });

    test("throws on non-existent axis", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(axisService.deleteAxis("nonexistent")).rejects.toThrow("Axis not found");
    });
  });
});
