import { v4 as uuidv4 } from "uuid";
import type {
  ShelfConfiguration,
  ShelfConfigMutationResult,
  ShelfUnit,
  ShelfUnitMutationResult,
  ShelfUnitRemovalResult,
  Shelf,
} from "@shelf-judge/shared";
import type { CollectionPersistence, StorageService } from "./storage-service.js";
import {
  collectionMutationServiceFor,
  type CollectionMutationService,
} from "./collection-mutation-service.js";

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

type ShelfStorage = Pick<StorageService, "loadCollection" | "loadShelfConfig" | "saveShelfConfig">;

export type ShelfServiceDeps =
  | { storageService: ShelfStorage; collectionMutationService: CollectionMutationService }
  | {
      storageService: ShelfStorage & CollectionPersistence;
      collectionMutationService?: undefined;
    };

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
  const collectionMutationService =
    deps.collectionMutationService ?? collectionMutationServiceFor(storageService);

  async function mutateConfig<Value>(
    operation: string,
    update: (previous: ShelfConfiguration) => { next: ShelfConfiguration; value: Value },
  ): Promise<{ value: Value; clearedAssignmentCount: number }> {
    const outcome = await collectionMutationService.mutate(
      { operation, trigger: "owner" },
      async (collection) => {
        const previous = await storageService.loadShelfConfig();
        const { next, value } = update(structuredClone(previous));
        const nextShelfIds = new Set(
          next.units.flatMap((unit) => unit.shelves.map((shelf) => shelf.id)),
        );
        const removedShelfIds = new Set(
          previous.units
            .flatMap((unit) => unit.shelves.map((shelf) => shelf.id))
            .filter((id) => !nextShelfIds.has(id)),
        );
        const changedAt = new Date().toISOString();
        let clearedAssignmentCount = 0;
        for (const game of collection.games) {
          if (game.manualShelfId !== null && removedShelfIds.has(game.manualShelfId)) {
            game.manualShelfId = null;
            game.updatedAt = changedAt;
            clearedAssignmentCount++;
          }
        }

        await storageService.saveShelfConfig(next);
        const result = { value, clearedAssignmentCount };
        if (clearedAssignmentCount === 0) return { changed: false, value: result };
        collection.updatedAt = changedAt;
        return {
          changed: true,
          value: result,
          async onPersistenceFailure(writeError: unknown) {
            try {
              await storageService.saveShelfConfig(previous);
            } catch (rollbackError) {
              throw new Error(
                `Shelf assignment cleanup failed and shelf configuration rollback failed: ${String(writeError)}; rollback: ${String(rollbackError)}`,
              );
            }
          },
        };
      },
    );
    return outcome.value;
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

      const { value: config, clearedAssignmentCount } = await mutateConfig(
        "shelf.config.set",
        (existing) => {
          const next = {
            units,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
          };
          return { next, value: next };
        },
      );
      return { config, clearedAssignmentCount };
    },

    async addUnit(input: AddUnitInput): Promise<ShelfUnit> {
      const nameErr = validateUnitName(input.name);
      if (nameErr) throw new ShelfValidationError(nameErr);

      for (const shelf of input.shelves) {
        const shelfErr = validateShelfInput(shelf);
        if (shelfErr) throw new ShelfValidationError(shelfErr);
      }

      const { value: unit } = await mutateConfig("shelf.unit.add", (config) => {
        const unit: ShelfUnit = {
          id: uuidv4(),
          name: input.name,
          shelves: input.shelves.map((s) => buildShelf({ ...s, id: undefined })),
        };
        config.units.push(unit);
        config.updatedAt = new Date().toISOString();
        return { next: config, value: unit };
      });
      return unit;
    },

    async updateUnit(id: string, input: UpdateUnitInput): Promise<ShelfUnitMutationResult> {
      const { value: unit, clearedAssignmentCount } = await mutateConfig(
        "shelf.unit.update",
        (config) => {
          const unitIndex = config.units.findIndex((unit) => unit.id === id);
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
            const existingShelfIds = new Set(unit.shelves.map((shelf) => shelf.id));
            const newShelves: Shelf[] = [];
            for (const shelfInput of input.shelves) {
              if (shelfInput.id && !existingShelfIds.has(shelfInput.id)) {
                throw new ShelfValidationError(
                  `Shelf id "${shelfInput.id}" does not match any existing shelf in this unit`,
                );
              }
              newShelves.push(buildShelf(shelfInput));
            }
            unit.shelves = newShelves;
          }
          config.units[unitIndex] = unit;
          config.updatedAt = new Date().toISOString();
          return { next: config, value: unit };
        },
      );
      return { unit, clearedAssignmentCount };
    },

    async removeUnit(id: string): Promise<ShelfUnitRemovalResult> {
      const { clearedAssignmentCount } = await mutateConfig("shelf.unit.remove", (config) => {
        const unitIndex = config.units.findIndex((unit) => unit.id === id);
        if (unitIndex === -1) throw new ShelfNotFoundError(id);
        config.units.splice(unitIndex, 1);
        config.updatedAt = new Date().toISOString();
        return { next: config, value: undefined };
      });
      return { removed: true, clearedAssignmentCount };
    },
  };
}
