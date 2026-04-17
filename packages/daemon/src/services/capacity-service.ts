// Adapter between Shelf Judge's domain model and the standalone bin-packing algorithm.
// See .lore/specs/shelf-capacity.md (REQ-SHELF-16 through REQ-SHELF-25) and
// .lore/designs/similarity-weighted-bin-packing.md.

import type {
  AssignedGame,
  BoxDimensions,
  Game,
  GameWithScore,
  OverflowEntry,
  Shelf,
  ShelfAssignment,
  ShelfCapacityResult,
  ShelfUnit,
  UnfittableEntry,
} from "@shelf-judge/shared";
import type { GameService } from "./game-service.js";
import type { StorageService } from "./storage-service.js";
import {
  DEFAULT_PACK_CONFIG,
  findBestRotation,
  pack,
  type PackBin,
  type PackConfig,
  type PackItem,
} from "./bin-packing.js";
import {
  buildVocabulary,
  compositeDistance,
  computeContinuousRanges,
  encodeGame,
  type FeatureVector,
} from "./feature-vector.js";

// Sentinel height for shelves with unconstrained height (REQ-SHELF-22).
// Large enough that any realistic box fits, small enough to stay out of infinity math.
const UNCONSTRAINED_HEIGHT_SENTINEL = 10000;

export interface CapacityService {
  computeCapacity(): Promise<ShelfCapacityResult>;
}

export interface CapacityServiceDeps {
  storageService: StorageService;
  gameService: GameService;
  packConfig?: Partial<PackConfig>;
}

interface ShelfContext {
  shelf: Shelf;
  unit: ShelfUnit;
}

export function createCapacityService(deps: CapacityServiceDeps): CapacityService {
  const { storageService, gameService, packConfig } = deps;

  return {
    async computeCapacity(): Promise<ShelfCapacityResult> {
      const shelfConfig = await storageService.loadShelfConfig();
      const shelves = flattenShelves(shelfConfig.units);

      // REQ-SHELF-23: no units configured => configured: false, no algorithm run.
      if (shelfConfig.units.length === 0 || shelves.length === 0) {
        return emptyResult(shelfConfig.units.length > 0 ? shelves.length : 0);
      }

      const allGames = await gameService.listGames();
      // Previously-owned games aren't on the shelf; capacity is about physical presence.
      const ownedGames = allGames.filter((g) => g.game.ownership !== "previously-owned");

      const dimensioned = ownedGames.filter((g) => g.game.boxDimensions !== null);
      const undimensioned = ownedGames.filter((g) => g.game.boxDimensions === null);

      // REQ-SHELF-24: no games with dimensions => valid empty-ish response.
      if (dimensioned.length === 0) {
        return {
          configured: true,
          totalShelfCount: shelves.length,
          gamesWithDimensions: 0,
          gamesWithoutDimensions: undimensioned.length,
          overflowing: false,
          assignments: shelves.map((ctx) => emptyAssignment(ctx)),
          unfittableGames: [],
          overflowGames: [],
        };
      }

      // Resolve config once so the pre-pass and pack() use the same policy.
      const resolvedConfig: PackConfig = { ...DEFAULT_PACK_CONFIG, ...packConfig };

      // REQ-SHELF-17 + REQ-SHELF-20: pre-pass geometric unfittable check.
      const { unfittable, fittable } = splitUnfittable(dimensioned, shelves, resolvedConfig);

      // Sort unfittable by fitness ascending (REQ-SHELF-20).
      unfittable.sort((a, b) => a.fitnessScore - b.fitnessScore);

      // Pre-encode feature vectors once per request; feed the compare closure.
      const vectorCache = buildVectorCache(
        ownedGames.map((g) => g.game),
        dimensioned,
      );

      // Build items/bins and run the packing algorithm.
      const items = fittable.map((gws) => buildPackItem(gws, vectorCache));
      const bins = shelves.map((ctx) => buildPackBin(ctx.shelf));

      const result = pack(items, bins, resolvedConfig);

      // Index fittable games by id for response assembly.
      const fittableById = new Map(fittable.map((gws) => [gws.game.id, gws]));

      const assignments = shelves.map((ctx) => {
        const assignment = result.assignments.get(ctx.shelf.id);
        return buildAssignment(ctx, assignment, fittableById);
      });

      const overflowGames: OverflowEntry[] = result.overflow
        .flatMap((gameId): OverflowEntry[] => {
          const gws = fittableById.get(gameId);
          if (!gws || !gws.game.boxDimensions) return [];
          return [
            {
              gameId: gws.game.id,
              gameName: gws.game.name,
              fitnessScore: fitnessOf(gws),
              volumeIn3: boxVolume(gws.game.boxDimensions),
            },
          ];
        })
        .sort((a, b) => a.fitnessScore - b.fitnessScore);

      return {
        configured: true,
        totalShelfCount: shelves.length,
        gamesWithDimensions: dimensioned.length,
        gamesWithoutDimensions: undimensioned.length,
        overflowing: overflowGames.length > 0,
        assignments,
        unfittableGames: unfittable,
        overflowGames,
      };
    },
  };
}

function emptyResult(totalShelfCount: number): ShelfCapacityResult {
  return {
    configured: false,
    totalShelfCount,
    gamesWithDimensions: 0,
    gamesWithoutDimensions: 0,
    overflowing: false,
    assignments: [],
    unfittableGames: [],
    overflowGames: [],
  };
}

function emptyAssignment(ctx: ShelfContext): ShelfAssignment {
  const capacity = shelfCapacityIn3(ctx.shelf);
  return {
    shelfId: ctx.shelf.id,
    shelfName: ctx.shelf.name,
    unitId: ctx.unit.id,
    unitName: ctx.unit.name,
    capacityIn3: capacity,
    usedIn3: 0,
    utilization: capacity === null ? null : 0,
    games: [],
    grade: "F",
  };
}

function flattenShelves(units: ShelfUnit[]): ShelfContext[] {
  const out: ShelfContext[] = [];
  for (const unit of units) {
    for (const shelf of unit.shelves) {
      out.push({ shelf, unit });
    }
  }
  return out;
}

function shelfCapacityIn3(shelf: Shelf): number | null {
  if (shelf.height === null) return null;
  return shelf.width * shelf.height * shelf.depth;
}

function boxVolume(dims: BoxDimensions): number {
  return dims.width * dims.height * dims.depth;
}

function fitnessOf(gws: GameWithScore): number {
  return gws.score?.score ?? 0;
}

function boxToTuple(dims: BoxDimensions): [number, number, number] {
  // Algorithm axis 0 = depth/spine (the facing dimension, locked by forceAxis0Width).
  // Axis 0 is also the consumption axis — subtracted from the shelf as games are
  // placed side by side. Mapping depth here means a game's spine faces outward,
  // and each game consumes shelf-width proportional to its spine thickness.
  return [dims.depth, dims.width, dims.height];
}

function shelfToBinDims(shelf: Shelf): [number, number, number] {
  // Axis 0 = shelf width (the fill direction, consumed as games are placed).
  // Axis 1 = shelf height (constrained or sentinel). Axis 2 = shelf depth.
  const h = shelf.height === null ? UNCONSTRAINED_HEIGHT_SENTINEL : shelf.height;
  return [shelf.width, h, shelf.depth];
}

/**
 * Pre-pass geometric check: every dimensioned game tested against every shelf.
 * A game fits if findBestRotation succeeds on at least one shelf.
 */
function splitUnfittable(
  dimensioned: GameWithScore[],
  shelves: ShelfContext[],
  config: PackConfig,
): { fittable: GameWithScore[]; unfittable: UnfittableEntry[] } {
  const fittable: GameWithScore[] = [];
  const unfittable: UnfittableEntry[] = [];

  const defaultAxisPriority: [number, number, number] = [0, 1, 2];
  const defaultAxisMinimize: [boolean, boolean, boolean] = [false, true, true];

  for (const gws of dimensioned) {
    const dims = gws.game.boxDimensions;
    if (!dims) continue;
    const itemDims = boxToTuple(dims);

    let fitsAnywhere = false;
    for (const ctx of shelves) {
      const binDims = shelfToBinDims(ctx.shelf);
      const rotated = findBestRotation(
        itemDims,
        binDims,
        defaultAxisPriority,
        defaultAxisMinimize,
        config.forceAxis0Width,
      );
      if (rotated !== null) {
        fitsAnywhere = true;
        break;
      }
    }

    if (fitsAnywhere) {
      fittable.push(gws);
    } else {
      unfittable.push({
        gameId: gws.game.id,
        gameName: gws.game.name,
        fitnessScore: fitnessOf(gws),
        boxDimensions: dims,
        reason: explainUnfittable(dims, shelves),
      });
    }
  }

  return { fittable, unfittable };
}

/**
 * Human-readable reason a box doesn't fit any shelf. Picks the dimension whose
 * smallest box edge still exceeds the largest matching shelf edge.
 * Falls back to a generic message if no single axis is the sole cause.
 */
function explainUnfittable(dims: BoxDimensions, shelves: ShelfContext[]): string {
  const box = boxToTuple(dims);
  const smallestBoxEdge = Math.min(box[0], box[1], box[2]);

  let maxShelfWidth = 0;
  let maxShelfDepth = 0;
  let maxShelfHeight = 0;
  let anyUnconstrainedHeight = false;

  for (const ctx of shelves) {
    if (ctx.shelf.width > maxShelfWidth) maxShelfWidth = ctx.shelf.width;
    if (ctx.shelf.depth > maxShelfDepth) maxShelfDepth = ctx.shelf.depth;
    if (ctx.shelf.height === null) {
      anyUnconstrainedHeight = true;
    } else if (ctx.shelf.height > maxShelfHeight) {
      maxShelfHeight = ctx.shelf.height;
    }
  }

  const dimStr = `${dims.width} x ${dims.height} x ${dims.depth} in`;

  // If the smallest edge of the box exceeds the largest shelf width or depth,
  // that's the hard limit.
  if (smallestBoxEdge > maxShelfWidth) {
    return `Box is ${dimStr}; widest shelf is ${maxShelfWidth} in`;
  }
  if (smallestBoxEdge > maxShelfDepth) {
    return `Box is ${dimStr}; deepest shelf is ${maxShelfDepth} in`;
  }
  if (!anyUnconstrainedHeight && smallestBoxEdge > maxShelfHeight) {
    return `Box is ${dimStr}; tallest shelf is ${maxShelfHeight} in`;
  }
  return `Box is ${dimStr}; no shelf accommodates all three dimensions`;
}

/**
 * Build feature vectors for every game that might participate in similarity
 * scoring. We cover the full owned-games universe (used to build vocabulary and
 * ranges) but only cache vectors for games that will actually be packed.
 */
function buildVectorCache(
  universe: Game[],
  participating: GameWithScore[],
): Map<string, FeatureVector> {
  const gamesWithBgg = universe.filter((g) => g.bggData);
  const vocabulary = buildVocabulary(gamesWithBgg);
  const ranges = computeContinuousRanges(gamesWithBgg);

  const cache = new Map<string, FeatureVector>();
  for (const gws of participating) {
    cache.set(gws.game.id, encodeGame(gws.game, vocabulary, gws.game.ratings, ranges));
  }
  return cache;
}

function buildPackItem(gws: GameWithScore, vectorCache: Map<string, FeatureVector>): PackItem {
  const dims = gws.game.boxDimensions!;
  const thisVector = vectorCache.get(gws.game.id) ?? null;

  return {
    id: gws.game.id,
    dimensions: boxToTuple(dims),
    priority: fitnessOf(gws),
    compare: (other: PackItem) => {
      if (!thisVector) return 0;
      const otherVector = vectorCache.get(other.id);
      if (!otherVector) return 0;
      const dist = compositeDistance(thisVector, otherVector).composite;
      return 1 - dist;
    },
  };
}

function buildPackBin(shelf: Shelf): PackBin {
  return {
    id: shelf.id,
    dimensions: shelfToBinDims(shelf),
    axisPriority: [0, 1, 2],
    axisMinimize: [false, true, true],
    layer: 0,
    neighbors: [],
  };
}

function buildAssignment(
  ctx: ShelfContext,
  assignment:
    | { itemIds: string[]; grade: string; remainingDimensions: [number, number, number] | null }
    | undefined,
  fittableById: Map<string, GameWithScore>,
): ShelfAssignment {
  const capacity = shelfCapacityIn3(ctx.shelf);

  if (!assignment) {
    return emptyAssignment(ctx);
  }

  const games: AssignedGame[] = [];
  let usedIn3 = 0;
  for (const itemId of assignment.itemIds) {
    const gws = fittableById.get(itemId);
    if (!gws || !gws.game.boxDimensions) continue;
    const vol = boxVolume(gws.game.boxDimensions);
    usedIn3 += vol;
    games.push({
      gameId: gws.game.id,
      gameName: gws.game.name,
      fitnessScore: fitnessOf(gws),
      volumeIn3: vol,
    });
  }
  // Keep the algorithm's placement order. It reflects placement priority and
  // produces a stable top-to-bottom display.

  const utilization = capacity === null ? null : capacity === 0 ? 0 : usedIn3 / capacity;

  return {
    shelfId: ctx.shelf.id,
    shelfName: ctx.shelf.name,
    unitId: ctx.unit.id,
    unitName: ctx.unit.name,
    capacityIn3: capacity,
    usedIn3,
    utilization,
    games,
    grade: assignment.grade,
  };
}
