import {
  CollectionSchema,
  type Collection,
  type FutureUsefulProfileCollectionSource,
} from "@shelf-judge/shared";
import { createLogger, type Logger } from "./logger.js";
import type { CollectionPersistence, CollectionReader } from "./storage-service.js";

export interface CollectionMutationContext {
  operation: string;
  trigger: string;
  gameIds?: readonly string[];
  intentionIds?: readonly string[];
}

export type CollectionMutationDecision<Value> =
  | {
      changed: true;
      value: Value;
      onPersistenceFailure?: (error: unknown) => Promise<void> | void;
    }
  | { changed: false; value: Value };

export type CollectionMutationOutcome<Value> =
  | { outcome: "accepted"; changed: true; value: Value; collection: Collection }
  | { outcome: "no-op"; changed: false; value: Value; collection: Collection };

export interface CollectionRevisionStrategy<Source = Collection> {
  identity(collection: Source): Readonly<Record<string, string | number>>;
  advance(collection: Source): Source;
}

export const schemaV3RevisionStrategy: CollectionRevisionStrategy = {
  identity(collection) {
    return { collectionId: collection.id, schemaVersion: collection.schemaVersion };
  },
  advance(collection) {
    return collection;
  },
};

export const schemaV4RevisionStrategy: CollectionRevisionStrategy<FutureUsefulProfileCollectionSource> =
  {
    identity(collection) {
      return {
        collectionId: collection.id,
        schemaVersion: collection.schemaVersion,
        revision: collection.revision,
      };
    },
    advance(collection) {
      if (collection.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Collection revision cannot advance beyond the safe integer range");
      }
      return { ...collection, revision: collection.revision + 1 };
    },
  };

export interface CollectionMutationService {
  mutate<Value>(
    context: CollectionMutationContext,
    mutation: (
      collection: Collection,
    ) => CollectionMutationDecision<Value> | Promise<CollectionMutationDecision<Value>>,
  ): Promise<CollectionMutationOutcome<Value>>;
}

export interface CollectionMutationServiceDeps {
  storageService: CollectionReader & CollectionPersistence;
  revisionStrategy?: CollectionRevisionStrategy;
  logger?: Logger;
}

const coordinators = new WeakMap<object, CollectionMutationService>();

function hasCollectionPersistence(
  storageService: CollectionReader,
): storageService is CollectionReader & CollectionPersistence {
  return "saveCollection" in storageService && typeof storageService.saveCollection === "function";
}

export function collectionMutationServiceFor(
  storageService: CollectionReader,
): CollectionMutationService {
  const existing = coordinators.get(storageService);
  if (existing) return existing;
  if (!hasCollectionPersistence(storageService)) {
    throw new Error("Collection persistence is available only at the mutation boundary");
  }
  const created = createCollectionMutationService({ storageService });
  return created;
}

export function createCollectionMutationService(
  deps: CollectionMutationServiceDeps,
): CollectionMutationService {
  const existing = coordinators.get(deps.storageService);
  if (existing) return existing;
  const revisionStrategy = deps.revisionStrategy ?? schemaV3RevisionStrategy;
  const logger = deps.logger ?? createLogger("collection-mutation");
  let operations: Promise<void> = Promise.resolve();

  function serialize<Value>(operation: () => Promise<Value>): Promise<Value> {
    const result = operations.then(operation, operation);
    operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function compensate(
    context: Readonly<Record<string, unknown>>,
    hook: ((error: unknown) => Promise<void> | void) | undefined,
    error: unknown,
  ): Promise<void> {
    if (!hook) return;
    logger.log("collection mutation compensation attempt", context);
    try {
      await hook(error);
      logger.log("collection mutation compensation completed", context);
    } catch (compensationError) {
      logger.error("collection mutation compensation failed", {
        ...context,
        outcome: "compensation-failed",
      });
      throw compensationError;
    }
  }

  function mutate<Value>(
    context: CollectionMutationContext,
    mutation: (
      collection: Collection,
    ) => CollectionMutationDecision<Value> | Promise<CollectionMutationDecision<Value>>,
  ): Promise<CollectionMutationOutcome<Value>> {
    return serialize(async () => {
      const requestFields = {
        operation: context.operation,
        trigger: context.trigger,
        gameIds: [...(context.gameIds ?? [])],
        intentionIds: [...(context.intentionIds ?? [])],
      };
      logger.log("collection mutation load attempt", requestFields);
      let current: Collection;
      try {
        current = await deps.storageService.loadCollection();
      } catch (error) {
        logger.error("collection mutation load failed", {
          ...requestFields,
          outcome: "load-failed",
        });
        throw error;
      }
      const before = revisionStrategy.identity(current);
      const fields = {
        ...requestFields,
        before,
      };
      logger.log("collection mutation attempt", fields);

      let decision: CollectionMutationDecision<Value>;
      const candidate = structuredClone(current);
      try {
        decision = await mutation(candidate);
      } catch (error) {
        logger.warn("collection mutation rejected", { ...fields, outcome: "rejected" });
        throw error;
      }

      if (!decision.changed) {
        logger.log("collection mutation completed", {
          ...fields,
          after: before,
          changed: false,
          outcome: "no-op",
        });
        return {
          outcome: "no-op",
          changed: false,
          value: decision.value,
          collection: current,
        };
      }

      let accepted: Collection;
      try {
        accepted = CollectionSchema.parse(revisionStrategy.advance(candidate));
      } catch (error) {
        logger.warn("collection mutation rejected", {
          ...fields,
          outcome: "validation-failed",
        });
        await compensate(fields, decision.onPersistenceFailure, error);
        throw error;
      }

      const after = revisionStrategy.identity(accepted);
      logger.log("collection mutation persistence attempt", { ...fields, after });
      try {
        await deps.storageService.saveCollection(accepted);
      } catch (error) {
        logger.error("collection mutation persistence failed", {
          ...fields,
          after,
          outcome: "persistence-failed",
        });
        await compensate({ ...fields, after }, decision.onPersistenceFailure, error);
        throw error;
      }
      logger.log("collection mutation persistence completed", { ...fields, after });
      logger.log("collection mutation completed", {
        ...fields,
        after,
        changed: true,
        outcome: "accepted",
      });
      return {
        outcome: "accepted",
        changed: true,
        value: decision.value,
        collection: accepted,
      };
    });
  }

  const service = { mutate };
  coordinators.set(deps.storageService, service);
  return service;
}
