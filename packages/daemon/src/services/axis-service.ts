import { v4 as uuidv4 } from "uuid";
import {
  CreateAxisSchema,
  UpdateAxisSchema,
  type Axis,
  type CreateAxisInput,
  type UpdateAxisInput,
} from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";

export interface AxisService {
  createAxis(input: CreateAxisInput): Promise<Axis>;
  listAxes(): Promise<Axis[]>;
  updateAxis(id: string, input: UpdateAxisInput): Promise<Axis>;
  deleteAxis(id: string): Promise<{ deletedRatingsCount: number }>;
}

export interface AxisServiceDeps {
  storageService: StorageService;
}

export function createAxisService(deps: AxisServiceDeps): AxisService {
  const { storageService } = deps;

  return {
    async createAxis(input: CreateAxisInput): Promise<Axis> {
      const parsed = CreateAxisSchema.parse(input);
      const collection = await storageService.loadCollection();
      const now = new Date().toISOString();

      const axis: Axis = {
        id: uuidv4(),
        name: parsed.name,
        description: parsed.description,
        weight: parsed.weight,
        source: parsed.source,
        bggField: parsed.bggField,
        createdAt: now,
        updatedAt: now,
      };

      collection.axes.push(axis);
      collection.updatedAt = now;
      await storageService.saveCollection(collection);

      return axis;
    },

    async listAxes(): Promise<Axis[]> {
      const collection = await storageService.loadCollection();
      return collection.axes;
    },

    async updateAxis(id: string, input: UpdateAxisInput): Promise<Axis> {
      const parsed = UpdateAxisSchema.parse(input);
      const collection = await storageService.loadCollection();
      const axis = collection.axes.find((a) => a.id === id);

      if (!axis) {
        throw new Error(`Axis not found: ${id}`);
      }

      const now = new Date().toISOString();

      if (parsed.name !== undefined) axis.name = parsed.name;
      if (parsed.description !== undefined) axis.description = parsed.description;
      if (parsed.weight !== undefined) axis.weight = parsed.weight;
      axis.updatedAt = now;
      collection.updatedAt = now;

      await storageService.saveCollection(collection);
      return axis;
    },

    async deleteAxis(id: string): Promise<{ deletedRatingsCount: number }> {
      const collection = await storageService.loadCollection();
      const axisIndex = collection.axes.findIndex((a) => a.id === id);

      if (axisIndex === -1) {
        throw new Error(`Axis not found: ${id}`);
      }

      collection.axes.splice(axisIndex, 1);

      let deletedRatingsCount = 0;
      for (const game of collection.games) {
        if (id in game.ratings) {
          delete game.ratings[id];
          deletedRatingsCount++;
        }
      }

      collection.updatedAt = new Date().toISOString();
      await storageService.saveCollection(collection);

      return { deletedRatingsCount };
    },
  };
}
