import { describe, test, expect, beforeEach } from "bun:test";
import { createGameService, GameHistoryConflictError } from "../../src/services/game-service.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createAxisService } from "../../src/services/axis-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import type { GameService } from "../../src/services/game-service.js";
import type { StorageService } from "../../src/services/storage-service.js";
import type { AxisService } from "../../src/services/axis-service.js";
import type { MockFileOps } from "../helpers/mock-file-ops.js";
import type { Game } from "@shelf-judge/shared";
import { collectionMutationServiceFor } from "../../src/services/collection-mutation-service.js";
import { createIntentionService } from "../../src/services/intention-service.js";

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

    test("preserves min-only and max-only manual ranges as invalid evidence", async () => {
      const minOnly = (await gameService.addGame({ name: "Min only", minPlayers: 2 })).game;
      const maxOnly = (await gameService.addGame({ name: "Max only", maxPlayers: 5 })).game;

      expect(minOnly).toMatchObject({
        minPlayers: null,
        maxPlayers: null,
        playerRangeEvidence: {
          status: "invalid",
          evidence: {
            minPlayers: { presence: "present", value: 2 },
            maxPlayers: { presence: "missing" },
          },
          source: "manual",
          observedAt: minOnly.createdAt,
        },
      });
      expect(maxOnly).toMatchObject({
        minPlayers: null,
        maxPlayers: null,
        playerRangeEvidence: {
          status: "invalid",
          evidence: {
            minPlayers: { presence: "missing" },
            maxPlayers: { presence: "present", value: 5 },
          },
          source: "manual",
          observedAt: maxOnly.createdAt,
        },
      });
    });
  });

  describe("getGame", () => {
    test("returns game with computed fitness score", async () => {
      // Create an axis and rate the game
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
        source: "personal",
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
        source: "personal",
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
    test("rejects a disabled legacy axis without removing its stored rating", async () => {
      const { game } = await gameService.addGame({ name: "Legacy-rated" });
      const collection = await storageService.loadCollection();
      collection.axes.push({
        id: "legacy-axis",
        name: "Legacy",
        description: null,
        weight: 50,
        enabled: false,
        source: "legacy",
        reason: "unknown_legacy_field",
        legacyField: "futureMetric",
        legacyPayload: { originalField: "futureMetric" },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      });
      const storedGame = collection.games.find(({ id }) => id === game.id);
      expect(storedGame).toBeDefined();
      if (storedGame === undefined) return;
      storedGame.ratings["legacy-axis"] = 8;
      await storageService.saveCollection(collection);

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(gameService.rateGame(game.id, { "legacy-axis": 5 })).rejects.toThrow(
        "Axis is disabled",
      );
      const unchanged = (await storageService.loadCollection()).games.find(
        ({ id }) => id === game.id,
      );
      expect(unchanged?.ratings["legacy-axis"]).toBe(8);
    });

    test("sets ratings and returns updated score", async () => {
      const axis = await axisService.createAxis({
        name: "Fun",
        weight: 50,
        source: "personal",
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
        source: "personal",
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
        source: "personal",
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
        source: "personal",
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
        source: "personal",
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
        source: "personal",
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
        source: "personal",
      });
      const { game } = await gameService.addGame({ name: "Test" });

      const result = await gameService.rateGame(game.id, { [axis.id]: null });

      expect(result.game.ratings[axis.id]).toBeUndefined();
    });

    test("can set some ratings and clear others in one call", async () => {
      const axis1 = await axisService.createAxis({
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      const axis2 = await axisService.createAxis({
        name: "Depth",
        weight: 50,
        source: "personal",
      });
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

    test.each(["active", "resolved"] as const)(
      "coordinated service rejects deletion with %s history and preserves the whole collection",
      async (state) => {
        const { game } = await gameService.addGame({ name: "Historical", numPlays: 0 });
        const intentions = createIntentionService({
          collectionMutationService: collectionMutationServiceFor(storageService),
          createId: () => "history-intention",
        });
        const created = await intentions.execute({
          type: "create",
          commandId: "40000000-0000-4000-8000-000000000001",
          gameId: game.id,
          kind: "first-play",
          expectedActiveIntention: "absent",
        });
        if (!created.ok) throw new Error(created.error.code);
        if (state === "resolved") {
          await intentions.execute({
            type: "complete",
            commandId: "40000000-0000-4000-8000-000000000002",
            gameId: game.id,
            intentionId: created.intention.intentionId,
            expectedVersion: 1,
          });
        }
        const before = await storageService.loadCollection();

        try {
          await gameService.removeGame(game.id);
          throw new Error("Expected history conflict");
        } catch (error) {
          expect(error).toBeInstanceOf(GameHistoryConflictError);
        }
        expect(await storageService.loadCollection()).toEqual(before);
      },
    );
  });

  describe("setOwnership", () => {
    test("logs one automatic transition attempt and durable outcome without unrelated game data", async () => {
      const entries: unknown[][] = [];
      const logger = {
        log: (...args: unknown[]) => entries.push(args),
        warn: (...args: unknown[]) => entries.push(args),
        error: (...args: unknown[]) => entries.push(args),
      };
      const coordinated = createGameService({
        storageService,
        fitnessService: createFitnessService(),
        logger,
      });
      await coordinated.addGame({ name: "SECRET UNRELATED GAME" });
      const { game } = await coordinated.addGame({ name: "Ownership target", numPlays: 1 });
      const intentions = createIntentionService({
        collectionMutationService: collectionMutationServiceFor(storageService),
        createId: () => "ownership-intention",
      });
      await intentions.execute({
        type: "create",
        commandId: "40000000-0000-4000-8000-000000000010",
        gameId: game.id,
        kind: "replay",
        expectedActiveIntention: "absent",
      });
      entries.length = 0;

      const result = await coordinated.setOwnership(game.id, "previously-owned");
      expect(result.linkedIntentionTransition?.resolution?.outcome).toBe("retired");
      expect(entries).toEqual([
        [
          "automatic intention transition attempt",
          {
            trigger: "ownership-change",
            gameId: game.id,
            intentionId: "ownership-intention",
            priorState: "active",
            priorVersion: 1,
          },
        ],
        [
          "automatic intention transition outcome",
          {
            trigger: "ownership-change",
            gameId: game.id,
            intentionId: "ownership-intention",
            priorState: "active",
            priorVersion: 1,
            result: "retired",
            version: 2,
            persisted: true,
          },
        ],
      ]);
      expect(JSON.stringify(entries)).not.toContain("SECRET UNRELATED GAME");
    });
  });

  describe("setManualShelf", () => {
    async function addShelf(id: string): Promise<void> {
      await storageService.saveShelfConfig({
        units: [
          {
            id: "unit-1",
            name: "Bookcase",
            shelves: [{ id, name: "Top", dimensionless: false, width: 30, height: 12, depth: 12 }],
          },
        ],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
    }

    async function addMeasuredGame(): Promise<Game> {
      const { game } = await gameService.addGame({ name: "Measured" });
      return gameService.setBoxDimensions(game.id, { width: 10, height: 10, depth: 2 });
    }

    async function addDimensionlessShelf(id: string): Promise<void> {
      await storageService.saveShelfConfig({
        units: [
          {
            id: "unit-drawer",
            name: "Drawers",
            shelves: [
              {
                id,
                name: "Wallet drawer",
                dimensionless: true,
                width: null,
                height: null,
                depth: null,
              },
            ],
          },
        ],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
    }

    test("sets, replaces, and clears an assignment", async () => {
      await addShelf("shelf-1");
      const game = await addMeasuredGame();

      expect((await gameService.setManualShelf(game.id, "shelf-1")).manualShelfId).toBe("shelf-1");

      await addShelf("shelf-2");
      expect((await gameService.setManualShelf(game.id, "shelf-2")).manualShelfId).toBe("shelf-2");
      expect((await gameService.setManualShelf(game.id, null)).manualShelfId).toBeNull();
    });

    test("rejects unknown shelves without changing the game", async () => {
      const game = await addMeasuredGame();
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects matcher is awaitable at runtime
      await expect(gameService.setManualShelf(game.id, "missing")).rejects.toThrow(
        "Shelf not found: missing",
      );
      const persisted = (await storageService.loadCollection()).games.find(
        ({ id }) => id === game.id,
      );
      expect(persisted?.manualShelfId).toBeNull();
    });

    test("rejects unmeasured and previously-owned games", async () => {
      await addShelf("shelf-1");
      const { game: unmeasured } = await gameService.addGame({ name: "Unmeasured" });
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects matcher is awaitable at runtime
      await expect(gameService.setManualShelf(unmeasured.id, "shelf-1")).rejects.toThrow(
        "Box dimensions are required",
      );

      const measured = await addMeasuredGame();
      await gameService.setOwnership(measured.id, "previously-owned");
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects matcher is awaitable at runtime
      await expect(gameService.setManualShelf(measured.id, "shelf-1")).rejects.toThrow(
        "requires an owned game",
      );
    });

    test("allows an unmeasured game to be pinned to a dimensionless shelf", async () => {
      await addDimensionlessShelf("drawer-1");
      const { game: unmeasured } = await gameService.addGame({ name: "Love Letter" });

      const updated = await gameService.setManualShelf(unmeasured.id, "drawer-1");
      expect(updated.manualShelfId).toBe("drawer-1");
    });

    test("throws for a missing game", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects matcher is awaitable at runtime
      await expect(gameService.setManualShelf("missing", null)).rejects.toThrow(
        "Game not found: missing",
      );
    });

    test("changing ownership clears an assignment in the persisted update", async () => {
      await addShelf("shelf-1");
      const game = await addMeasuredGame();
      await gameService.setManualShelf(game.id, "shelf-1");

      const updated = await gameService.setOwnership(game.id, "previously-owned");
      expect(updated.game.manualShelfId).toBeNull();
      const collection = await storageService.loadCollection();
      expect(
        collection.games.find((candidate) => candidate.id === game.id)?.manualShelfId,
      ).toBeNull();
    });
  });
});
