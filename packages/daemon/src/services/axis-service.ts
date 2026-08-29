import { v4 as uuidv4 } from "uuid";
import {
  AXIS_VALIDATION_CODES,
  CodedAxisValidationError,
  NotFoundError,
  createDerivedAxisFromPayload,
  getDerivedFieldDiscovery,
  mergeAndValidateAxisUpdate,
  parseCreateAxisInput,
  parseUpdateAxisInput,
  parseLegacyAxisRepairInput,
  repairAndValidateLegacyAxis,
  type Axis,
  type AxisBase,
  type DerivedFieldDiscoveryResponse,
} from "@shelf-judge/shared";
import type { CollectionPersistence, StorageService } from "./storage-service.js";
import {
  collectionMutationServiceFor,
  type CollectionMutationService,
} from "./collection-mutation-service.js";
import { createLogger, type Logger } from "./logger.js";

export interface AxisService {
  createAxis(input: unknown): Promise<Axis>;
  listAxes(): Promise<Axis[]>;
  getDerivedFields(): DerivedFieldDiscoveryResponse;
  updateAxis(id: string, input: unknown): Promise<Axis>;
  repairLegacyAxis(id: string, input: unknown): Promise<Axis>;
  deleteAxis(id: string): Promise<{ deletedRatingsCount: number }>;
}

export type AxisServiceDeps = {
  logger?: Logger;
  createId?: () => string;
  now?: () => string;
} & (
  | {
      storageService: Pick<StorageService, "loadCollection">;
      collectionMutationService: CollectionMutationService;
    }
  | {
      storageService: Pick<StorageService, "loadCollection"> & CollectionPersistence;
      collectionMutationService?: undefined;
    }
);

function axisContext(axis: Axis): string {
  const field = axis.source === "derived" ? axis.derivedField : "none";
  return `axisId=${axis.id} source=${axis.source} derivedField=${field}`;
}

function isInputRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function inputRecord(input: unknown): Record<string, unknown> | null {
  return isInputRecord(input) ? input : null;
}

function changedConfigurationKeys(input: unknown): string {
  const record = inputRecord(input);
  if (record === null || !("configuration" in record)) return "none";
  const configuration = record.configuration;
  if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration)) {
    return "invalid";
  }
  return Object.keys(configuration).sort().join(",") || "none";
}

function attemptedSource(input: unknown): string {
  const source = inputRecord(input)?.source;
  return typeof source === "string" ? source : "unknown";
}

function attemptedDerivedField(input: unknown): string {
  const field = inputRecord(input)?.derivedField;
  return typeof field === "string" ? field : "none";
}

function validationContext(error: CodedAxisValidationError): string {
  return `code=${error.code} details=${JSON.stringify(error.details)}`;
}

export function createAxisService(deps: AxisServiceDeps): AxisService {
  const { storageService } = deps;
  const collectionMutationService =
    deps.collectionMutationService ?? collectionMutationServiceFor(storageService);
  const logger = deps.logger ?? createLogger("axes");
  const createId = deps.createId ?? uuidv4;
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    async createAxis(input: unknown): Promise<Axis> {
      logger.log(
        `axis create attempt source=${attemptedSource(input)} derivedField=${attemptedDerivedField(input)} configurationKeys=${changedConfigurationKeys(input)}`,
      );
      try {
        const parsed = parseCreateAxisInput(input);
        const timestamp = now();
        const base: AxisBase = {
          id: createId(),
          name: parsed.name,
          description: parsed.description,
          weight: parsed.weight,
          enabled: true,
          preferenceShape: parsed.preferenceShape,
          idealValue: parsed.idealValue,
          tolerance: parsed.tolerance,
          toleranceWidth: parsed.toleranceWidth,
          leanDirection: parsed.leanDirection,
          veto: parsed.veto,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const axis: Axis =
          parsed.source === "derived"
            ? createDerivedAxisFromPayload(base, parsed)
            : { ...base, source: "personal" };
        await collectionMutationService.mutate(
          { operation: "axis.create", trigger: "owner" },
          (collection) => {
            collection.axes.push(axis);
            collection.updatedAt = timestamp;
            return { changed: true, value: axis };
          },
        );
        logger.log(`axis create completed ${axisContext(axis)}`);
        return axis;
      } catch (error) {
        if (error instanceof CodedAxisValidationError) {
          logger.warn(`axis create rejected ${validationContext(error)}`);
        } else {
          logger.error(
            `axis create persistence failed source=${attemptedSource(input)} derivedField=${attemptedDerivedField(input)}`,
            error,
          );
        }
        throw error;
      }
    },

    async listAxes(): Promise<Axis[]> {
      const collection = await storageService.loadCollection();
      return collection.axes;
    },

    getDerivedFields(): DerivedFieldDiscoveryResponse {
      return getDerivedFieldDiscovery();
    },

    async updateAxis(id: string, input: unknown): Promise<Axis> {
      let targetContext = `axisId=${id} source=unknown derivedField=none`;
      logger.log(
        `axis update attempt axisId=${id} configurationKeys=${changedConfigurationKeys(input)}`,
      );
      try {
        const parsed = parseUpdateAxisInput(input);
        const timestamp = now();
        const { value: persisted } = await collectionMutationService.mutate(
          { operation: "axis.update", trigger: "owner" },
          (collection) => {
            const axis = collection.axes.find((candidate) => candidate.id === id);
            if (axis === undefined) throw new NotFoundError(`Axis not found: ${id}`);
            targetContext = axisContext(axis);
            logger.log(
              `axis update target ${axisContext(axis)} configurationKeys=${changedConfigurationKeys(input)}`,
            );
            if (!axis.enabled) {
              throw new CodedAxisValidationError(
                "Disabled legacy axes require the explicit repair operation",
                AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR,
                [{ field: "axisId", path: ["id"] }],
              );
            }
            const persisted = { ...mergeAndValidateAxisUpdate(axis, parsed), updatedAt: timestamp };
            collection.axes = collection.axes.map((candidate) =>
              candidate.id === id ? persisted : candidate,
            );
            collection.updatedAt = timestamp;
            return { changed: true, value: persisted };
          },
        );
        logger.log(`axis update completed ${axisContext(persisted)}`);
        return persisted;
      } catch (error) {
        if (error instanceof CodedAxisValidationError) {
          logger.warn(`axis update rejected ${targetContext} ${validationContext(error)}`);
        } else if (error instanceof NotFoundError) {
          logger.warn(`axis update failed axisId=${id} reason=not_found`);
        } else {
          logger.error(`axis update persistence failed ${targetContext}`, error);
        }
        throw error;
      }
    },

    async repairLegacyAxis(id: string, input: unknown): Promise<Axis> {
      logger.log(
        `axis repair attempt axisId=${id} source=legacy derivedField=${attemptedDerivedField(input)} configurationKeys=${changedConfigurationKeys(input)}`,
      );
      try {
        const parsed = parseLegacyAxisRepairInput(input);
        const timestamp = now();
        const { value: repaired } = await collectionMutationService.mutate(
          { operation: "axis.repair", trigger: "owner" },
          (collection) => {
            const axis = collection.axes.find((candidate) => candidate.id === id);
            if (axis === undefined) throw new NotFoundError(`Axis not found: ${id}`);
            logger.log(
              `axis repair target ${axisContext(axis)} selectedDerivedField=${parsed.derivedField}`,
            );
            if (axis.enabled) {
              throw new CodedAxisValidationError(
                "Only disabled legacy axes can be repaired",
                AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR,
                [{ field: "axisId", path: ["id"] }],
              );
            }
            const repaired = {
              ...repairAndValidateLegacyAxis(axis, parsed),
              updatedAt: timestamp,
            };
            collection.axes = collection.axes.map((candidate) =>
              candidate.id === id ? repaired : candidate,
            );
            collection.updatedAt = timestamp;
            return { changed: true, value: repaired };
          },
        );
        logger.log(`axis repair completed ${axisContext(repaired)}`);
        return repaired;
      } catch (error) {
        if (error instanceof CodedAxisValidationError) {
          logger.warn(`axis repair rejected axisId=${id} ${validationContext(error)}`);
        } else if (error instanceof NotFoundError) {
          logger.warn(`axis repair failed axisId=${id} reason=not_found`);
        } else {
          logger.error(
            `axis repair persistence failed axisId=${id} source=legacy derivedField=${attemptedDerivedField(input)}`,
            error,
          );
        }
        throw error;
      }
    },

    async deleteAxis(id: string): Promise<{ deletedRatingsCount: number }> {
      let targetContext = `axisId=${id} source=unknown derivedField=none`;
      logger.log(`axis delete attempt axisId=${id}`);
      try {
        const timestamp = now();
        const { value } = await collectionMutationService.mutate(
          { operation: "axis.delete", trigger: "owner" },
          (collection) => {
            const axis = collection.axes.find((candidate) => candidate.id === id);
            if (axis === undefined) throw new NotFoundError(`Axis not found: ${id}`);
            targetContext = axisContext(axis);
            logger.log(`axis delete target ${axisContext(axis)}`);
            if (axis.source === "tournament") {
              throw new CodedAxisValidationError(
                "Tournament axes are service-managed and cannot be deleted",
                AXIS_VALIDATION_CODES.TOURNAMENT_AXIS_MANAGED,
                [{ field: "source", path: ["source"] }],
              );
            }
            let deletedRatingsCount = 0;
            collection.games = collection.games.map((game) => {
              if (!(id in game.ratings)) return game;
              deletedRatingsCount++;
              const { [id]: removed, ...ratings } = game.ratings;
              void removed;
              return { ...game, ratings };
            });
            collection.axes = collection.axes.filter((candidate) => candidate.id !== id);
            collection.updatedAt = timestamp;
            return { changed: true, value: { axis, deletedRatingsCount } };
          },
        );
        const { axis, deletedRatingsCount } = value;
        logger.log(
          `axis delete completed ${axisContext(axis)} deletedRatingsCount=${deletedRatingsCount}`,
        );
        return { deletedRatingsCount };
      } catch (error) {
        if (error instanceof CodedAxisValidationError) {
          logger.warn(`axis delete rejected ${targetContext} ${validationContext(error)}`);
        } else if (error instanceof NotFoundError) {
          logger.warn(`axis delete failed axisId=${id} reason=not_found`);
        } else {
          logger.error(`axis delete persistence failed ${targetContext}`, error);
        }
        throw error;
      }
    },
  };
}
