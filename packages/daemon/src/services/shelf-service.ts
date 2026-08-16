import { v4 as uuidv4 } from "uuid";
import type {
  ShelfConfiguration,
  ShelfConfigMutationResult,
  ShelfUnit,
  ShelfUnitMutationResult,
  ShelfUnitRemovalResult,
  Shelf,
} from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";

export interface ShelfInput {
  id?: string;
  name: string;
  dimensionless: boolean;
  width: number | null;
  height: number | null;
  depth: number | null;
}

export interface AddUnitInput {
  name: string;
  shelves: ShelfInput[];
}

export interface UpdateUnitInput {
  name?: string;
  shelves?: ShelfInput[];
}

export interface ShelfService {
  getConfig(): Promise<ShelfConfiguration>;
  setConfig(units: ShelfUnit[]): Promise<ShelfConfigMutationResult>;
  addUnit(input: AddUnitInput): Promise<ShelfUnit>;
  updateUnit(id: string, input: UpdateUnitInput): Promise<ShelfUnitMutationResult>;
  removeUnit(id: string): Promise<ShelfUnitRemovalResult>;
}

export interface ShelfServiceDeps {
  storageService: StorageService;
}

function validateShelfInput(shelf: ShelfInput): string | null {
  if (!shelf.name || shelf.name.trim().length === 0) {
    return "Shelf name must be non-empty";
  }
  if (shelf.dimensionless) {
    // Dimensionless shelves are assignment-only buckets: no capacity math applies,
    // so dimensions are neither required nor meaningful.
    return null;
  }
  if (typeof shelf.width !== "number" || shelf.width <= 0) {
    return "Shelf width must be greater than 0";
  }
  if (shelf.height !== null && (typeof shelf.height !== "number" || shelf.height <= 0)) {
    return "Shelf height must be greater than 0 or null";
  }
  if (typeof shelf.depth !== "number" || shelf.depth <= 0) {
    return "Shelf depth must be greater than 0";
  }
  return null;
}

function validateUnitName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return "Unit name must be non-empty";
  }
  return null;
}

function buildShelf(input: ShelfInput): Shelf {
  return {
    id: input.id ?? uuidv4(),
    name: input.name,
    dimensionless: input.dimensionless,
    width: input.dimensionless ? null : input.width,
    height: input.dimensionless ? null : input.height,
    depth: input.dimensionless ? null : input.depth,
  };
}

export class ShelfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShelfValidationError";
  }
}

export class ShelfNotFoundError extends Error {
  constructor(id: string) {
    super(`Shelf unit not found: ${id}`);
    this.name = "ShelfNotFoundError";
  }
}

export function createShelfService(deps: ShelfServiceDeps): ShelfService {
  const { storageService } = deps;

  async function persistRemovingShelves(
    previousConfig: ShelfConfiguration,
    nextConfig: ShelfConfiguration,
  ): Promise<number> {
    const nextShelfIds = new Set(
      nextConfig.units.flatMap((unit) => unit.shelves.map((shelf) => shelf.id)),
    );
    const removedShelfIds = new Set(
      previousConfig.units
        .flatMap((unit) => unit.shelves.map((shelf) => shelf.id))
        .filter((id) => !nextShelfIds.has(id)),
    );

    if (removedShelfIds.size === 0) {
      await storageService.saveShelfConfig(nextConfig);
      return 0;
    }

    const previousCollection = await storageService.loadCollection();
    const nextCollection = structuredClone(previousCollection);
    const now = new Date().toISOString();
    let clearedAssignmentCount = 0;
    for (const game of nextCollection.games) {
      if (game.manualShelfId !== null && removedShelfIds.has(game.manualShelfId)) {
        game.manualShelfId = null;
        game.updatedAt = now;
        clearedAssignmentCount++;
      }
    }
    if (clearedAssignmentCount > 0) {
      nextCollection.updatedAt = now;
    }

    await storageService.saveShelfConfig(nextConfig);
    if (clearedAssignmentCount === 0) return 0;

    try {
      await storageService.saveCollection(nextCollection);
    } catch (writeError) {
      try {
        await storageService.saveShelfConfig(previousConfig);
      } catch (rollbackError) {
        throw new Error(
          `Shelf assignment cleanup failed and shelf configuration rollback failed: ${String(writeError)}; rollback: ${String(rollbackError)}`,
        );
      }
      throw writeError;
    }

    return clearedAssignmentCount;
  }

  return {
    async getConfig(): Promise<ShelfConfiguration> {
      return storageService.loadShelfConfig();
    },

    async setConfig(units: ShelfUnit[]): Promise<ShelfConfigMutationResult> {
      // Validate all units and their shelves
      for (const unit of units) {
        const nameErr = validateUnitName(unit.name);
        if (nameErr) throw new ShelfValidationError(nameErr);

        for (const shelf of unit.shelves) {
          const shelfErr = validateShelfInput(shelf);
          if (shelfErr) throw new ShelfValidationError(shelfErr);
        }
      }

      const now = new Date().toISOString();
      const existing = await storageService.loadShelfConfig();
      const config: ShelfConfiguration = {
        units,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      const clearedAssignmentCount = await persistRemovingShelves(existing, config);
      return { config, clearedAssignmentCount };
    },

    async addUnit(input: AddUnitInput): Promise<ShelfUnit> {
      const nameErr = validateUnitName(input.name);
      if (nameErr) throw new ShelfValidationError(nameErr);

      for (const shelf of input.shelves) {
        const shelfErr = validateShelfInput(shelf);
        if (shelfErr) throw new ShelfValidationError(shelfErr);
      }

      const unit: ShelfUnit = {
        id: uuidv4(),
        name: input.name,
        shelves: input.shelves.map((s) => buildShelf({ ...s, id: undefined })),
      };

      const config = await storageService.loadShelfConfig();
      config.units.push(unit);
      config.updatedAt = new Date().toISOString();
      await storageService.saveShelfConfig(config);
      return unit;
    },

    async updateUnit(id: string, input: UpdateUnitInput): Promise<ShelfUnitMutationResult> {
      const previousConfig = await storageService.loadShelfConfig();
      const config = structuredClone(previousConfig);
      const unitIndex = config.units.findIndex((u) => u.id === id);
      if (unitIndex === -1) throw new ShelfNotFoundError(id);

      const unit = config.units[unitIndex];

      if (input.name !== undefined) {
        const nameErr = validateUnitName(input.name);
        if (nameErr) throw new ShelfValidationError(nameErr);
        unit.name = input.name;
      }

      if (input.shelves !== undefined) {
        for (const shelf of input.shelves) {
          const shelfErr = validateShelfInput(shelf);
          if (shelfErr) throw new ShelfValidationError(shelfErr);
        }

        // Shelves with id: update existing. Without id: add new. Absent: removed.
        const existingShelfIds = new Set(unit.shelves.map((s) => s.id));
        const newShelves: Shelf[] = [];

        for (const shelfInput of input.shelves) {
          if (shelfInput.id) {
            if (!existingShelfIds.has(shelfInput.id)) {
              throw new ShelfValidationError(
                `Shelf id "${shelfInput.id}" does not match any existing shelf in this unit`,
              );
            }
            // Update existing shelf
            newShelves.push(buildShelf({ ...shelfInput, id: shelfInput.id }));
          } else {
            // Add new shelf (generate id)
            newShelves.push(buildShelf({ ...shelfInput, id: undefined }));
          }
        }

        unit.shelves = newShelves;
      }

      config.units[unitIndex] = unit;
      config.updatedAt = new Date().toISOString();
      const clearedAssignmentCount = await persistRemovingShelves(previousConfig, config);
      return { unit, clearedAssignmentCount };
    },

    async removeUnit(id: string): Promise<ShelfUnitRemovalResult> {
      const previousConfig = await storageService.loadShelfConfig();
      const config = structuredClone(previousConfig);
      const unitIndex = config.units.findIndex((u) => u.id === id);
      if (unitIndex === -1) throw new ShelfNotFoundError(id);

      config.units.splice(unitIndex, 1);
      config.updatedAt = new Date().toISOString();
      const clearedAssignmentCount = await persistRemovingShelves(previousConfig, config);
      return { removed: true, clearedAssignmentCount };
    },
  };
}
