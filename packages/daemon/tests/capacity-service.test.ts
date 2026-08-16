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
    manualShelfId?: string | null;
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
    manualShelfId: opts.manualShelfId ?? null,
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
    loadCollection: () =>
      Promise.resolve({
        id: "mock",
        name: "Mock",
        games: [],
        axes: [],
        createdAt: NOW,
        updatedAt: NOW,
      }),
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
    setManualShelf: () => Promise.reject(new Error("not implemented")),
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
      expect(result.assignmentConflicts).toEqual([]);
      expect(result.hasPlacementProblems).toBe(false);
      expect(result.gamesWithDimensions).toBe(0);
    });

    test("reports dangling manual assignments when configuration is empty", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([]),
        gameService: createMockGameService([
          makeGame("b-game", "Pinned B", {
            boxDimensions: { width: 10, height: 10, depth: 2 },
            manualShelfId: "deleted-b",
          }),
          makeGame("a-game", "Pinned A", {
            boxDimensions: { width: 10, height: 10, depth: 2 },
            manualShelfId: "deleted-a",
          }),
          makeGame("automatic", "Automatic", {
            boxDimensions: { width: 10, height: 10, depth: 2 },
          }),
        ]),
      });

      const result = await svc.computeCapacity();
      expect(result.configured).toBe(false);
      expect(result.assignments).toEqual([]);
      expect(result.assignmentConflicts.map((conflict) => conflict.gameId)).toEqual([
        "a-game",
        "b-game",
      ]);
      const firstConflict = result.assignmentConflicts[0];
      expect(firstConflict.shelfId).toBe("deleted-a");
      expect(firstConflict.shelfName).toBe("Unknown shelf");
      expect(firstConflict.unitName).toBe("Unknown unit");
      expect(firstConflict.reason).toBe("Selected shelf no longer exists");
      expect(result.hasPlacementProblems).toBe(true);
      expect(result.overflowing).toBe(false);
      expect(result.unfittableGames).toEqual([]);
      expect(result.overflowGames).toEqual([]);
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
      expect(result.assignments[0].games[0].assignmentSource).toBe("automatic");
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
          // Free rotation: axis 0 (shelf width, minimize=false) picks the
          // largest fitting face, depth=15. Axis 1 (shelf height=5,
          // minimize=true) then picks the smallest remaining fit, height=3
          // (width=12 doesn't fit height 5). Axis 2 (shelf depth=20) takes
          // the remaining width=12.
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

    test("free rotation fills axis 0 with the largest fitting face, not the spine", async () => {
      // Rotation is unconstrained (no forced spine-out lock): axis 0 uses
      // axisMinimize[0] = false ("maximize"), so findBestRotation picks the
      // largest item dimension that fits the shelf's width, not necessarily
      // the box's depth. A Wingspan box (12x12x2.8) fits axis 0 with its 12"
      // face, consuming 12 of the cube's 13" width on the first game and
      // leaving room for none of the other three. This is the accepted
      // tradeoff of dropping the spine-out lock: single-item-per-shelf-run
      // packing for boxes whose face is close to the shelf's width.
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
      const assigned = result.assignments[0].games;
      expect(assigned.length).toBe(1);
      expect(result.overflowGames.length + result.unfittableGames.length).toBe(3);
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

  describe("manual assignments", () => {
    test("honors a nonpreferred shelf before placing automatic games", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Bookcase", [
            { id: "s1", name: "First", width: 10, height: 10, depth: 10 },
            { id: "s2", name: "Pinned target", width: 10, height: 10, depth: 10 },
          ]),
        ]),
        gameService: createMockGameService([
          makeGame("pinned", "Pinned", {
            boxDimensions: { width: 10, height: 10, depth: 6 },
            fitness: 1,
            manualShelfId: "s2",
          }),
          makeGame("automatic", "Automatic", {
            boxDimensions: { width: 10, height: 10, depth: 6 },
            fitness: 9,
          }),
        ]),
      });

      const result = await svc.computeCapacity();
      expect(result.assignments.find((assignment) => assignment.shelfId === "s2")?.games).toEqual([
        expect.objectContaining({ gameId: "pinned", assignmentSource: "manual" }),
      ]);
      expect(result.assignments.find((assignment) => assignment.shelfId === "s1")?.games).toEqual([
        expect.objectContaining({ gameId: "automatic", assignmentSource: "automatic" }),
      ]);
    });

    test("processes pinned games in stable game-ID order", async () => {
      const games = [
        makeGame("z-game", "Z", {
          boxDimensions: { width: 10, height: 10, depth: 3 },
          manualShelfId: "s1",
        }),
        makeGame("a-game", "A", {
          boxDimensions: { width: 10, height: 10, depth: 3 },
          manualShelfId: "s1",
        }),
      ];
      const create = () =>
        createCapacityService({
          storageService: createMockStorage([
            unit("u1", "Bookcase", [{ id: "s1", name: "Shelf", width: 10, height: 10, depth: 10 }]),
          ]),
          gameService: createMockGameService(games),
        });

      const first = await create().computeCapacity();
      const second = await create().computeCapacity();
      // Pinned games are always processed a-game before z-game (stable ID
      // order). With free rotation, a-game's 10" face fills the shelf's full
      // 10" width, so z-game is rejected on remaining capacity rather than
      // placed alongside it — deterministically, on every run.
      expect(first.assignments[0].games.map((game) => game.gameId)).toEqual(["a-game"]);
      expect(second.assignments).toEqual(first.assignments);
    });

    test("reports selected-shelf shape failures only as assignment conflicts", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Bookcase", [
            { id: "tiny", name: "Tiny", width: 5, height: 5, depth: 5 },
            { id: "large", name: "Large", width: 20, height: 20, depth: 20 },
          ]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Wrong Shelf", {
            boxDimensions: { width: 10, height: 10, depth: 10 },
            manualShelfId: "tiny",
          }),
        ]),
      });

      const result = await svc.computeCapacity();
      expect(result.assignmentConflicts).toHaveLength(1);
      const conflict = result.assignmentConflicts[0];
      expect(conflict.gameId).toBe("g1");
      expect(conflict.shelfId).toBe("tiny");
      expect(conflict.shelfName).toBe("Tiny");
      expect(conflict.unitId).toBe("u1");
      expect(conflict.unitName).toBe("Bookcase");
      expect(conflict.boxDimensions).toEqual({ width: 10, height: 10, depth: 10 });
      expect(result.assignmentConflicts[0].reason).toContain("do not fit");
      expect(result.unfittableGames).toEqual([]);
      expect(result.overflowGames).toEqual([]);
      expect(result.overflowing).toBe(false);
      expect(result.hasPlacementProblems).toBe(true);
    });

    test("reports cumulative fixed capacity conflicts without automatic fallback", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Bookcase", [
            { id: "s1", name: "Shelf", width: 10, height: 10, depth: 10 },
            { id: "s2", name: "Fallback", width: 20, height: 10, depth: 10 },
          ]),
        ]),
        gameService: createMockGameService([
          makeGame("a", "First", {
            boxDimensions: { width: 10, height: 10, depth: 6 },
            manualShelfId: "s1",
          }),
          makeGame("b", "Second", {
            boxDimensions: { width: 10, height: 10, depth: 6 },
            manualShelfId: "s1",
          }),
        ]),
      });

      const result = await svc.computeCapacity();
      expect(result.assignments[0].games.map((game) => game.gameId)).toEqual(["a"]);
      expect(result.assignments[1].games).toEqual([]);
      expect(result.assignmentConflicts).toHaveLength(1);
      expect(result.assignmentConflicts[0].gameId).toBe("b");
      expect(result.assignmentConflicts[0].shelfId).toBe("s1");
      expect(result.assignmentConflicts[0].reason).toContain("remaining capacity");
      expect(result.unfittableGames).toEqual([]);
      expect(result.overflowGames).toEqual([]);
    });

    test("reports defensive dangling shelf IDs as conflicts", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Bookcase", [{ id: "s1", name: "Shelf", width: 10, height: 10, depth: 10 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Dangling", {
            boxDimensions: { width: 5, height: 5, depth: 5 },
            manualShelfId: "deleted-shelf",
          }),
        ]),
      });

      const result = await svc.computeCapacity();
      expect(result.assignmentConflicts).toHaveLength(1);
      expect(result.assignmentConflicts[0].gameId).toBe("g1");
      expect(result.assignmentConflicts[0].shelfId).toBe("deleted-shelf");
      expect(result.assignmentConflicts[0].shelfName).toBe("Unknown shelf");
      expect(result.assignmentConflicts[0].unitName).toBe("Unknown unit");
      expect(result.assignmentConflicts[0].reason).toContain("no longer exists");
    });

    test("includes successful manual placements in volume and utilization", async () => {
      const svc = createCapacityService({
        storageService: createMockStorage([
          unit("u1", "Bookcase", [{ id: "s1", name: "Shelf", width: 10, height: 10, depth: 10 }]),
        ]),
        gameService: createMockGameService([
          makeGame("g1", "Pinned", {
            boxDimensions: { width: 5, height: 10, depth: 2 },
            manualShelfId: "s1",
          }),
        ]),
      });

      const result = await svc.computeCapacity();
      expect(result.assignments[0].usedIn3).toBe(100);
      expect(result.assignments[0].utilization).toBe(0.1);
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
