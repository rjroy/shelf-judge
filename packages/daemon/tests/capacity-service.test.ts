import { describe, expect, test } from "bun:test";
import type {
  BoxDimensions,
  Game,
  GameWithScore,
  OwnershipStatus,
  ShelfConfiguration,
  ShelfUnit,
} from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import type { GameService } from "../src/services/game-service";
import { createCapacityService } from "../src/services/capacity-service";

const NOW = "2026-04-13T12:00:00.000Z";

function makeGame(
  id: string,
  name: string,
  opts: {
    ownership?: OwnershipStatus;
    boxDimensions?: BoxDimensions | null;
    fitness?: number | null;
  } = {},
): GameWithScore {
  const game: Game = {
    id,
    bggId: null,
    name,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    ownership: opts.ownership ?? "owned",
    boxDimensions: opts.boxDimensions ?? null,
    ratings: {},
    createdAt: NOW,
    updatedAt: NOW,
  };

  const fitness = opts.fitness;
  if (fitness === null || fitness === undefined) {
    return { game, score: null };
  }

  return {
    game,
    score: {
      score: fitness,
      ratedAxisCount: 0,
      totalAxisCount: 0,
      breakdown: [],
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: null,
      redundancyAdjustment: null,
    },
  };
}

function createMockStorage(units: ShelfUnit[]): StorageService {
  const config: ShelfConfiguration = { units, createdAt: NOW, updatedAt: NOW };
  return {
    loadShelfConfig: () => Promise.resolve(structuredClone(config)),
    saveShelfConfig: () => Promise.resolve(),
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
}

function createMockGameService(games: GameWithScore[]): GameService {
  return {
    listGames: () => Promise.resolve(structuredClone(games)),
    getGame: () => Promise.reject(new Error("not implemented")),
    addGame: () => Promise.reject(new Error("not implemented")),
    rateGame: () => Promise.reject(new Error("not implemented")),
    removeGame: () => Promise.reject(new Error("not implemented")),
    refreshBggData: () => Promise.reject(new Error("not implemented")),
    refreshAllBggData: () => Promise.reject(new Error("not implemented")),
    searchGames: () => Promise.reject(new Error("not implemented")),
    importBggCollection: () => Promise.reject(new Error("not implemented")),
    setOwnership: () => Promise.reject(new Error("not implemented")),
    setBoxDimensions: () => Promise.reject(new Error("not implemented")),
  };
}

const unit = (id: string, name: string, shelves: ShelfUnit["shelves"]): ShelfUnit => ({
  id,
  name,
  shelves,
});

describe("capacity service", () => {
  describe("edge cases", () => {
    test("returns configured: false when no units exist", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([]),
        gameService: createMockGameService([]),
      });
      const result = await svc.computeCapacity();
      expect(result.configured).toBe(false);
      expect(result.totalShelfCount).toBe(0);
      expect(result.assignments).toEqual([]);
      expect(result.unfittableGames).toEqual([]);
      expect(result.overflowGames).toEqual([]);
      expect(result.overflowing).toBe(false);
    });

    test("returns configured: false when units have zero shelves", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([unit("u1", "Empty", [])]),
        gameService: createMockGameService([
          makeGame("g1", "Game 1", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 5,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.configured).toBe(false);
      expect(result.totalShelfCount).toBe(0);
    });

    test("returns empty-ish response when no games have dimensions", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Kallax", [{ id: "s1", name: "Cube", width: 13, height: 13, depth: 15 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Undim Game 1", { fitness: 5 }),
          makeGame("g2", "Undim Game 2", { fitness: 6 }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.configured).toBe(true);
      expect(result.gamesWithDimensions).toBe(0);
      expect(result.gamesWithoutDimensions).toBe(2);
      expect(result.overflowing).toBe(false);
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0].games).toEqual([]);
      expect(result.assignments[0].capacityIn3).toBe(13 * 13 * 15);
      expect(result.assignments[0].usedIn3).toBe(0);
      expect(result.assignments[0].utilization).toBe(0);
    });

    test("excludes previously-owned games from packing", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Kallax", [{ id: "s1", name: "Cube 1", width: 13, height: 13, depth: 15 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Owned", {
            ownership: "owned",
            boxDimensions: { width: 10, height: 2, depth: 10 },
            fitness: 5,
          }),
          makeGame("g2", "Previously", {
            ownership: "previously-owned",
            boxDimensions: { width: 10, height: 2, depth: 10 },
            fitness: 8,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.gamesWithDimensions).toBe(1);
      // Only the owned game should appear anywhere.
      const assignedIds = result.assignments.flatMap((a) => a.games.map((g) => g.gameId));
      expect(assignedIds).toContain("g1");
      expect(assignedIds).not.toContain("g2");
      expect(result.overflowGames.map((o) => o.gameId)).not.toContain("g2");
      expect(result.unfittableGames.map((u) => u.gameId)).not.toContain("g2");
    });

    test("counts undimensioned owned games separately", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Kallax", [{ id: "s1", name: "Cube", width: 13, height: 13, depth: 15 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Dim", {
            boxDimensions: { width: 10, height: 2, depth: 10 },
            fitness: 5,
          }),
          makeGame("g2", "No Dim", { fitness: 6 }),
          makeGame("g3", "Previously no dim", { ownership: "previously-owned", fitness: 7 }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.gamesWithDimensions).toBe(1);
      // Previously-owned games are filtered out entirely before the split.
      expect(result.gamesWithoutDimensions).toBe(1);
    });
  });

  describe("unfittable games", () => {
    test("flags a game that exceeds every shelf in width", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Kallax", [{ id: "s1", name: "Cube", width: 13, height: 13, depth: 15 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Too Wide", {
            boxDimensions: { width: 20, height: 20, depth: 20 },
            fitness: 5,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.unfittableGames).toHaveLength(1);
      expect(result.unfittableGames[0].gameId).toBe("g1");
      expect(result.unfittableGames[0].reason).toContain("20");
      // widest shelf is only 15" (depth) or 13" (width) - smallest box edge is 20
      expect(result.unfittableGames[0].reason.length).toBeGreaterThan(0);
    });

    test("allows a tall box when any shelf has unconstrained height", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Open Top", [{ id: "s1", name: "Top", width: 20, height: null, depth: 20 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Very Tall", {
            boxDimensions: { width: 10, height: 50, depth: 10 },
            fitness: 5,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.unfittableGames).toHaveLength(0);
      // capacity and utilization are null for unconstrained-height shelves
      expect(result.assignments[0].capacityIn3).toBeNull();
      expect(result.assignments[0].utilization).toBeNull();
    });

    test("flags a game whose smallest edge exceeds widest shelf", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Small", [{ id: "s1", name: "Tiny", width: 5, height: 5, depth: 5 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Big Box", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 5,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.unfittableGames).toHaveLength(1);
      expect(result.unfittableGames[0].reason).toContain("widest shelf");
    });

    test("sorts unfittable games by fitness ascending", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Tiny", [{ id: "s1", name: "Tiny", width: 3, height: 3, depth: 3 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Big A", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 8,
          }),
          makeGame("g2", "Big B", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 3,
          }),
          makeGame("g3", "Big C", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 5,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.unfittableGames.map((u) => u.gameId)).toEqual(["g2", "g3", "g1"]);
    });

    test("uses 0 fitness for unscored games in sort", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Tiny", [{ id: "s1", name: "Tiny", width: 3, height: 3, depth: 3 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Scored", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 5,
          }),
          makeGame("g2", "Unscored", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      // unscored (0) comes before scored (5)
      expect(result.unfittableGames[0].gameId).toBe("g2");
      expect(result.unfittableGames[1].gameId).toBe("g1");
    });
  });

  describe("assignments", () => {
    test("places a box that fits into the matching shelf", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Kallax", [{ id: "s1", name: "Cube", width: 13, height: 13, depth: 15 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Small Game", {
            boxDimensions: { width: 10, height: 2, depth: 10 },
            fitness: 7,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.configured).toBe(true);
      expect(result.totalShelfCount).toBe(1);
      expect(result.gamesWithDimensions).toBe(1);
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0].games).toHaveLength(1);
      expect(result.assignments[0].games[0].gameId).toBe("g1");
      expect(result.assignments[0].games[0].volumeIn3).toBe(10 * 2 * 10);
      expect(result.assignments[0].usedIn3).toBe(10 * 2 * 10);
      expect(result.assignments[0].capacityIn3).toBe(13 * 13 * 15);
      expect(result.assignments[0].utilization).toBeGreaterThan(0);
    });

    test("rotates a box that only fits rotated", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Shallow", [{ id: "s1", name: "Shelf", width: 20, height: 5, depth: 20 }]),
        ]),
        gameService: createMockGameService([
          // depth=15 is locked on axis 0 (spine) and fits shelf width (20).
          // width=12 and height=3 rotate into axes 1-2: 3 fits shelf height (5),
          // 12 fits shelf depth (20).
          makeGame("g1", "Oddly Shaped", {
            boxDimensions: { width: 12, height: 3, depth: 15 },
            fitness: 7,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.unfittableGames).toHaveLength(0);
      expect(result.assignments[0].games).toHaveLength(1);
    });

    test("reports null utilization for unconstrained shelves", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Bookcase", [{ id: "s1", name: "Top", width: 24, height: null, depth: 12 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Game", {
            boxDimensions: { width: 10, height: 2, depth: 10 },
            fitness: 6,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.assignments[0].capacityIn3).toBeNull();
      expect(result.assignments[0].utilization).toBeNull();
      // used volume is still reported
      expect(result.assignments[0].usedIn3).toBe(10 * 2 * 10);
    });

    test("axis-0 maps to depth/spine: multiple games fit spine-out in a Kallax cube", async () => {
      // Regression test for axis-0 semantic: with forceAxis0Width the item's
      // depth (spine) is locked and consumed along the shelf's width. A Wingspan
      // box (12×12×2.8) should fit ~4 copies spine-out in a 13" Kallax cube.
      // The old mapping (axis 0 = height) consumed 12 of 13 on the first game,
      // leaving room for zero more.
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Kallax", [{ id: "s1", name: "Cube", width: 13, height: 13, depth: 15 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Wingspan 1", {
            boxDimensions: { width: 12, height: 12, depth: 2.8 },
            fitness: 8,
          }),
          makeGame("g2", "Wingspan 2", {
            boxDimensions: { width: 12, height: 12, depth: 2.8 },
            fitness: 7,
          }),
          makeGame("g3", "Wingspan 3", {
            boxDimensions: { width: 12, height: 12, depth: 2.8 },
            fitness: 6,
          }),
          makeGame("g4", "Wingspan 4", {
            boxDimensions: { width: 12, height: 12, depth: 2.8 },
            fitness: 5,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      // All 4 should be assigned (not unfittable, not overflow).
      expect(result.unfittableGames).toHaveLength(0);
      const assigned = result.assignments[0].games;
      expect(assigned.length).toBeGreaterThanOrEqual(4);
    });

    test("assignment grade is present (one of S/A/B/C/D/F)", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Kallax", [{ id: "s1", name: "Cube", width: 13, height: 13, depth: 15 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Game", {
            boxDimensions: { width: 10, height: 2, depth: 10 },
            fitness: 7,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(["S", "A", "B", "C", "D", "F"]).toContain(result.assignments[0].grade);
    });
  });

  describe("overflow", () => {
    test("reports overflow when all shelves fill up", async () => {
      // Tiny shelf, many games that each exactly fit but together overflow.
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Tiny", [{ id: "s1", name: "Only", width: 10, height: 10, depth: 10 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "A", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 9,
          }),
          makeGame("g2", "B", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 5,
          }),
          makeGame("g3", "C", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 3,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.overflowing).toBe(true);
      expect(result.overflowGames.length).toBeGreaterThan(0);
      // sorted ascending by fitness
      for (let i = 1; i < result.overflowGames.length; i++) {
        expect(result.overflowGames[i - 1].fitnessScore).toBeLessThanOrEqual(
          result.overflowGames[i].fitnessScore,
        );
      }
    });

    test("unfittable and overflow are distinct", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Tiny", [{ id: "s1", name: "Only", width: 10, height: 10, depth: 10 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Fits", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 9,
          }),
          makeGame("g2", "AlsoFits", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 5,
          }),
          makeGame("g3", "TooBig", {
            boxDimensions: { width: 50, height: 50, depth: 50 },
            fitness: 7,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      const unfitIds = result.unfittableGames.map((u) => u.gameId);
      const overflowIds = result.overflowGames.map((o) => o.gameId);
      expect(unfitIds).toContain("g3");
      expect(overflowIds).not.toContain("g3");
      for (const id of overflowIds) {
        expect(unfitIds).not.toContain(id);
      }
    });
  });

  describe("multiple shelves", () => {
    test("spreads games across multiple shelves", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Kallax", [
            { id: "s1", name: "Cube 1", width: 13, height: 13, depth: 15 },
            { id: "s2", name: "Cube 2", width: 13, height: 13, depth: 15 },
          ]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "A", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 9,
          }),
          makeGame("g2", "B", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            fitness: 8,
          }),
        ]),
      });
      const result = await svc.computeCapacity();
      expect(result.assignments).toHaveLength(2);
      const totalAssigned = result.assignments.reduce((sum, a) => sum + a.games.length, 0);
      expect(totalAssigned).toBe(2);
      expect(result.overflowGames).toHaveLength(0);
    });

    test("preserves shelf ordering in response", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "A", [
            { id: "s1", name: "A top", width: 13, height: 13, depth: 15 },
            { id: "s2", name: "A bottom", width: 13, height: 13, depth: 15 },
          ]),
          unit("u2", "B", [{ id: "s3", name: "B only", width: 13, height: 13, depth: 15 }]),
        ]),
        gameService: createMockGameService([]),
      });
      const result = await svc.computeCapacity();
      expect(result.assignments.map((a) => a.shelfId)).toEqual(["s1", "s2", "s3"]);
      expect(result.assignments.map((a) => a.unitName)).toEqual(["A", "A", "B"]);
    });
  });
});
