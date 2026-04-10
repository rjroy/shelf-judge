import { v4 as uuidv4 } from "uuid";
import {
  CreateAxisSchema,
  UpdateAxisSchema,
  ValidationError,
  NotFoundError,
  type Axis,
  type CreateAxisInput,
  type UpdateAxisInput,
} from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import { getNativeScale } from "./curve-engine.js";

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

      // Cross-field validation: idealValue must be within native scale for sweet-spot
      if (parsed.preferenceShape === "sweet-spot" && parsed.idealValue != null) {
        const scale = getNativeScale(parsed.source, parsed.bggField);
        if (parsed.idealValue < scale.min || parsed.idealValue > scale.max) {
          throw new ValidationError(
            `idealValue ${parsed.idealValue} is outside native scale range [${scale.min}, ${scale.max}]`,
          );
        }
      }

      const collection = await storageService.loadCollection();
      const now = new Date().toISOString();

      const axis: Axis = {
        id: uuidv4(),
        name: parsed.name,
        description: parsed.description,
        weight: parsed.weight,
        source: parsed.source,
        bggField: parsed.bggField,
        preferenceShape: parsed.preferenceShape,
        idealValue: parsed.idealValue,
        tolerance: parsed.tolerance,
        leanDirection: parsed.leanDirection,
        veto: parsed.veto,
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
        throw new NotFoundError(`Axis not found: ${id}`);
      }

      // Determine the effective preferenceShape after this update
      const effectiveShape = parsed.preferenceShape ?? axis.preferenceShape;

      if (effectiveShape === "sweet-spot") {
        // idealValue must exist: either provided in this update or already stored
        const effectiveIdealValue =
          parsed.idealValue !== undefined ? parsed.idealValue : axis.idealValue;
        if (effectiveIdealValue == null) {
          throw new ValidationError("idealValue is required when preferenceShape is sweet-spot");
        }

        // Validate idealValue is within native scale
        const scale = getNativeScale(axis.source, axis.bggField);
        if (effectiveIdealValue < scale.min || effectiveIdealValue > scale.max) {
          throw new ValidationError(
            `idealValue ${effectiveIdealValue} is outside native scale range [${scale.min}, ${scale.max}]`,
          );
        }
      }

      const now = new Date().toISOString();

      if (parsed.name !== undefined) axis.name = parsed.name;
      if (parsed.description !== undefined) axis.description = parsed.description;
      if (parsed.weight !== undefined) axis.weight = parsed.weight;

      // Curve fields
      if (parsed.preferenceShape !== undefined) {
        axis.preferenceShape = parsed.preferenceShape;

        // When changing away from sweet-spot, clear stale config
        if (parsed.preferenceShape !== "sweet-spot") {
          axis.idealValue = undefined;
          axis.tolerance = undefined;
          axis.leanDirection = undefined;
        }
      }
      if (parsed.idealValue !== undefined) axis.idealValue = parsed.idealValue;
      if (parsed.tolerance !== undefined) axis.tolerance = parsed.tolerance;
      if (parsed.leanDirection !== undefined) axis.leanDirection = parsed.leanDirection;
      if (parsed.veto !== undefined) axis.veto = parsed.veto;

      axis.updatedAt = now;
      collection.updatedAt = now;

      await storageService.saveCollection(collection);
      return axis;
    },

    async deleteAxis(id: string): Promise<{ deletedRatingsCount: number }> {
      const collection = await storageService.loadCollection();
      const axisIndex = collection.axes.findIndex((a) => a.id === id);

      if (axisIndex === -1) {
        throw new NotFoundError(`Axis not found: ${id}`);
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
