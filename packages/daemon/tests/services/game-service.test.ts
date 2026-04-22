import { describe, test, expect, beforeEach } from "bun:test";
import { createGameService } from "../../src/services/game-service.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createAxisService } from "../../src/services/axis-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import type { GameService } from "../../src/services/game-service.js";
import type { StorageService } from "../../src/services/storage-service.js";
import type { AxisService } from "../../src/services/axis-service.js";
import type { MockFileOps } from "../helpers/mock-file-ops.js";

let fileOps: MockFileOps;
let storageService: StorageService;
let gameService: GameService;
let axisService: AxisService;

beforeEach(() => {
  fileOps = createMockFileOps();
  storageService = createStorageService({
    dataDir: "/data",
    configPath: "/config/config.json",
    fileOps,
  });
  const fitnessService = createFitnessService();
  gameService = createGameService({ storageService, fitnessService });
  axisService = createAxisService({ storageService });
});

describe("GameService", () => {
  describe("addGame", () => {
    test("creates a manual game with null bggId", async () => {
      const { game } = await gameService.addGame({ name: "Custom Game" });

      expect(game.id).toBeTruthy();
      expect(game.name).toBe("Custom Game");
      expect(game.bggId).toBeNull();
      expect(game.bggData).toBeNull();
      expect(game.ratings).toEqual({});
    });

    test("creates a game with bggId for later BGG fetch", async () => {
      const { game } = await gameService.addGame({
        name: "Wingspan",
        bggId: 266192,
      });

      expect(game.bggId).toBe(266192);
      expect(game.bggData).toBeNull(); // Phase 2: not yet fetched
    });

    test("rejects duplicate bggId", async () => {
      await gameService.addGame({ name: "Wingspan", bggId: 266192 });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.addGame({ name: "Wingspan Copy", bggId: 266192 })).rejects.toThrow(
        "BGG ID 266192 already exists",
      );
    });

    test("manual games are never duplicates of each other", async () => {
      const { game: g1 } = await gameService.addGame({ name: "My Game" });
      const { game: g2 } = await gameService.addGame({ name: "My Game" });

      expect(g1.id).not.toBe(g2.id);
    });
  });

  describe("getGame", () => {
    test("returns game with computed fitness score", async () => {
      // Create an axis and rate the game
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
      });
      const { game } = await gameService.addGame({ name: "Test Game" });
      await gameService.rateGame(game.id, { [axis.id]: 8 });

      const result = await gameService.getGame(game.id);

      expect(result.game.name).toBe("Test Game");
      expect(result.score).not.toBeNull();
      expect(result.score!.score).toBe(8);
    });

    test("returns null score for unrated game", async () => {
      const { game } = await gameService.addGame({ name: "Unrated" });
      const result = await gameService.getGame(game.id);

      expect(result.score).toBeNull();
    });

    test("throws on non-existent game", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.getGame("nonexistent")).rejects.toThrow("Game not found");
    });
  });

  describe("listGames", () => {
    test("returns games sorted by fitness descending, unscored at end", async () => {
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
      });

      const { game: g1 } = await gameService.addGame({ name: "Low Score" });
      const { game: g2 } = await gameService.addGame({ name: "High Score" });
      await gameService.addGame({ name: "Unrated" });

      await gameService.rateGame(g1.id, { [axis.id]: 3 });
      await gameService.rateGame(g2.id, { [axis.id]: 9 });

      const list = await gameService.listGames();

      expect(list.length).toBe(3);
      expect(list[0].game.name).toBe("High Score");
      expect(list[0].score!.score).toBe(9);
      expect(list[1].game.name).toBe("Low Score");
      expect(list[1].score!.score).toBe(3);
      expect(list[2].game.name).toBe("Unrated");
      expect(list[2].score).toBeNull();
    });
  });

  describe("rateGame", () => {
    test("sets ratings and returns updated score", async () => {
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
      });
      const { game } = await gameService.addGame({ name: "Test" });

      const result = await gameService.rateGame(game.id, {
        [axis.id]: 7,
      });

      expect(result.game.ratings[axis.id]).toBe(7);
      expect(result.score).not.toBeNull();
      expect(result.score!.score).toBe(7);
    });

    test("rejects rating of 0", async () => {
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
      });
      const { game } = await gameService.addGame({ name: "Test" });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.rateGame(game.id, { [axis.id]: 0 })).rejects.toThrow(
        "Rating must be an integer between 1 and 10",
      );
    });

    test("rejects rating of 11", async () => {
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
      });
      const { game } = await gameService.addGame({ name: "Test" });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.rateGame(game.id, { [axis.id]: 11 })).rejects.toThrow(
        "Rating must be an integer between 1 and 10",
      );
    });

    test("rejects non-integer rating", async () => {
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
      });
      const { game } = await gameService.addGame({ name: "Test" });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.rateGame(game.id, { [axis.id]: 1.5 })).rejects.toThrow(
        "Rating must be an integer between 1 and 10",
      );
    });

    test("rejects negative rating", async () => {
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
      });
      const { game } = await gameService.addGame({ name: "Test" });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.rateGame(game.id, { [axis.id]: -1 })).rejects.toThrow(
        "Rating must be an integer between 1 and 10",
      );
    });

    test("rejects unknown axis ID", async () => {
      const { game } = await gameService.addGame({ name: "Test" });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.rateGame(game.id, { "fake-axis": 5 })).rejects.toThrow(
        "Axis not found",
      );
    });

    test("null rating clears an existing rating", async () => {
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
      });
      const { game } = await gameService.addGame({ name: "Test" });

      // Set a rating first
      await gameService.rateGame(game.id, { [axis.id]: 7 });

      // Clear it
      const result = await gameService.rateGame(game.id, { [axis.id]: null });

      expect(result.game.ratings[axis.id]).toBeUndefined();
      expect(result.score).toBeNull();
    });

    test("null rating for axis without existing rating is a no-op", async () => {
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
      });
      const { game } = await gameService.addGame({ name: "Test" });

      const result = await gameService.rateGame(game.id, { [axis.id]: null });

      expect(result.game.ratings[axis.id]).toBeUndefined();
    });

    test("can set some ratings and clear others in one call", async () => {
      const axis1 = await axisService.createAxis({ name: "Fun", weight: 50 });
      const axis2 = await axisService.createAxis({ name: "Depth", weight: 50 });
      const { game } = await gameService.addGame({ name: "Test" });

      // Set both
      await gameService.rateGame(game.id, {
        [axis1.id]: 8,
        [axis2.id]: 6,
      });

      // Clear axis1, update axis2
      const result = await gameService.rateGame(game.id, {
        [axis1.id]: null,
        [axis2.id]: 9,
      });

      expect(result.game.ratings[axis1.id]).toBeUndefined();
      expect(result.game.ratings[axis2.id]).toBe(9);
    });
  });

  describe("removeGame", () => {
    test("deletes game from collection", async () => {
      const { game } = await gameService.addGame({ name: "Doomed" });
      await gameService.removeGame(game.id);

      expect(gameService.getGame(game.id)).rejects.toThrow("Game not found");
    });

    test("removed game no longer appears in list", async () => {
      const { game } = await gameService.addGame({ name: "Doomed" });
      await gameService.removeGame(game.id);

      const list = await gameService.listGames();
      expect(list.find((g) => g.game.id === game.id)).toBeUndefined();
    });

    test("throws on non-existent game", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.removeGame("nonexistent")).rejects.toThrow("Game not found");
    });
  });
});
