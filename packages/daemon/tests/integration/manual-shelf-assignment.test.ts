import { describe, expect, test } from "bun:test";
import { createCapacityService } from "../../src/services/capacity-service.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createGameService } from "../../src/services/game-service.js";
import { createShelfService } from "../../src/services/shelf-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

describe("manual shelf assignment persisted flow", () => {
  test("persists, clears, falls back after shelf deletion, and excludes unowned games", async () => {
    const storageService = createStorageService({
      dataDir: "/data",
      configPath: "/config/config.json",
      fileOps: createMockFileOps(),
    });
    const gameService = createGameService({
      storageService,
      fitnessService: createFitnessService(),
    });
    const shelfService = createShelfService({ storageService });
    const capacityService = createCapacityService({ storageService, gameService });

    await storageService.saveShelfConfig({
      units: [
        {
          id: "unit-1",
          name: "Bookcase",
          shelves: [
            {
              id: "fallback",
              name: "Fallback",
              dimensionless: false,
              width: 12,
              height: 12,
              depth: 12,
            },
            {
              id: "manual",
              name: "Manual",
              dimensionless: false,
              width: 12,
              height: 12,
              depth: 12,
            },
          ],
        },
      ],
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });

    const { game } = await gameService.addGame({ name: "Persisted Game" });
    await gameService.setBoxDimensions(game.id, { width: 10, height: 10, depth: 2 });
    await gameService.setManualShelf(game.id, "manual");

    let persisted = (await storageService.loadCollection()).games.find(
      (candidate) => candidate.id === game.id,
    );
    expect(persisted?.manualShelfId).toBe("manual");
    let capacity = await capacityService.computeCapacity();
    expect(
      capacity.assignments.find((assignment) => assignment.shelfId === "manual")?.games[0],
    ).toMatchObject({ gameId: game.id, assignmentSource: "manual" });

    await gameService.setManualShelf(game.id, null);
    persisted = (await storageService.loadCollection()).games.find(
      (candidate) => candidate.id === game.id,
    );
    expect(persisted?.manualShelfId).toBeNull();
    capacity = await capacityService.computeCapacity();
    const automaticPlacement = capacity.assignments
      .flatMap((assignment) => assignment.games)
      .find((assignedGame) => assignedGame.gameId === game.id);
    expect(automaticPlacement?.assignmentSource).toBe("automatic");

    await gameService.setManualShelf(game.id, "manual");
    const deletion = await shelfService.updateUnit("unit-1", {
      shelves: [
        {
          id: "fallback",
          name: "Fallback",
          dimensionless: false,
          width: 12,
          height: 12,
          depth: 12,
        },
      ],
    });
    expect(deletion.clearedAssignmentCount).toBe(1);
    expect((await shelfService.getConfig()).units[0].shelves.map((shelf) => shelf.id)).toEqual([
      "fallback",
    ]);
    persisted = (await storageService.loadCollection()).games.find(
      (candidate) => candidate.id === game.id,
    );
    expect(persisted?.manualShelfId).toBeNull();
    capacity = await capacityService.computeCapacity();
    expect(capacity.assignmentConflicts).toEqual([]);
    expect(capacity.assignments[0].games[0]).toMatchObject({
      gameId: game.id,
      assignmentSource: "automatic",
    });

    await gameService.setOwnership(game.id, "previously-owned");
    capacity = await capacityService.computeCapacity();
    expect(capacity.gamesWithDimensions).toBe(0);
    expect(capacity.assignments[0].games).toEqual([]);
  });
});
