import {
  CollectionSchema,
  type Collection,
  type CollectionProfileCollectionSource,
} from "@shelf-judge/shared";
import { createLogger, type Logger } from "./logger.js";
import type { CollectionPersistence, CollectionReader } from "./storage-service.js";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import {
  attentionImpactForCollectionMutation,
  type CollectionMutationOperation,
  type TestCollectionMutationOperation,
} from "./attention-mutation-impact.js";
import type { AttentionDispositionWinner } from "./attention-disposition-compatibility.js";
import { clearIncompatibleAttentionDispositions } from "./attention-disposition-compatibility.js";
import type { AttentionMutationImpact } from "./attention-candidate-service.js";
import { applySemanticEvidenceTransition } from "./semantic-redundancy-state-service.js";
import type { CollectionArtifactContext } from "./collection-artifacts.js";
import { purgeSemanticDisplayArtifacts } from "./collection-artifacts.js";
import { planJevMutationImpact } from "./jev-mutation-impact.js";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import { purgeRevokedOwnerNoteCache } from "./jev-owner-note-revocation.js";

export interface CollectionMutationContext {
  operation:
    | CollectionMutationOperation
    | TestCollectionMutationOperation
    | "attention-disposition"
    | "attention-disposition-maintenance"
    | "semantic-redundancy.settings.update"
    | "semantic-redundancy.execution.start"
    | "semantic-redundancy.execution.cancel"
    | "semantic-redundancy.execution.reserve-attempt"
    | "semantic-redundancy.execution.finish"
    | "semantic-redundancy.judgments.checkpoint"
    | "semantic-redundancy.generation.publish"
    | "semantic-redundancy.factual-weights.invalidate";
  trigger: string;
  gameIds?: readonly string[];
  intentionIds?: readonly string[];
  /** Coordinator-only global source maintenance after a non-Collection writer saves. */
  maintenanceImpact?: AttentionMutationImpact;
}

export interface CollectionMutationPostCommitEvent {
  readonly context: CollectionMutationContext;
  readonly prior: Collection;
  readonly accepted: Collection;
  readonly impact: ReturnType<typeof attentionImpactForCollectionMutation>;
}

export interface CollectionDurableIdentity {
  collectionId: string;
  schemaVersion: number;
  revision: number;
  contentHash: string;
}

export function collectionDurableIdentity(collection: Collection): CollectionDurableIdentity {
  const normalized = CollectionSchema.parse(collection);
  return {
    collectionId: normalized.id,
    schemaVersion: normalized.schemaVersion,
    revision: normalized.revision,
    contentHash: canonicalSha256(normalized),
  };
}

export type CollectionMutationDecision<Value> =
  | {
      changed: true;
      value: Value;
      beforePersistence?: (accepted: Collection, prior: Collection) => Promise<void> | void;
      onPersistenceFailure?: (error: unknown) => Promise<void> | void;
      onPersistenceSuccess?: () => Promise<void> | void;
      classifyPersistenceOutcome?: boolean;
    }
  | { changed: false; value: Value };

export type CollectionMutationOutcome<Value> =
  | {
      outcome: "accepted";
      changed: true;
      value: Value;
      collection: Collection;
      cleanupPending: boolean;
    }
  | {
      outcome: "no-op";
      changed: false;
      value: Value;
      collection: Collection;
      cleanupPending: false;
    };

export interface CollectionRevisionStrategy<Source = Collection> {
  identity(collection: Source): Readonly<Record<string, string | number>>;
  advance(collection: Source, current: Source): Source;
}

export const collectionRevisionStrategy: CollectionRevisionStrategy<CollectionProfileCollectionSource> =
  {
    identity(collection) {
      return {
        collectionId: collection.id,
        schemaVersion: collection.schemaVersion,
        revision: collection.revision,
      };
    },
    advance(collection, current) {
      if (current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Collection revision cannot advance beyond the safe integer range");
      }
      return { ...collection, revision: current.revision + 1 };
    },
  };

export interface CollectionMutationService {
  mutate<Value>(
    context: CollectionMutationContext,
    mutation: (
      collection: Collection,
    ) => CollectionMutationDecision<Value> | Promise<CollectionMutationDecision<Value>>,
  ): Promise<CollectionMutationOutcome<Value>>;
  setDispositionWinners(
    resolver: NonNullable<CollectionMutationServiceDeps["dispositionWinners"]>,
  ): void;
}

export interface CollectionMutationServiceDeps {
  storageService: CollectionReader & CollectionPersistence;
  revisionStrategy?: CollectionRevisionStrategy;
  logger?: Logger;
  postCommitObserver?: (event: CollectionMutationPostCommitEvent) => Promise<void>;
  /** Derives unsuppressed post-mutation winners from authoritative source inputs. */
  dispositionWinners?: (
    prior: Collection,
    accepted: Collection,
    context: CollectionMutationContext,
    affectedGameIds: readonly string[],
  ) => Promise<readonly AttentionDispositionWinner[]>;
  /** Optional production wiring for purging persisted D-derived display caches. */
  semanticDisplayArtifactContext?: CollectionArtifactContext;
  /** Daemon-local SQLite cache; absent in isolated/test callers that do not own it. */
  jevPairCache?: JevPairCache | null;
}

const coordinators = new WeakMap<object, CollectionMutationService>();

function hasCollectionPersistence(
  storageService: CollectionReader,
): storageService is CollectionReader & CollectionPersistence {
  return "saveCollection" in storageService && typeof storageService.saveCollection === "function";
}

function isAttentionDispositionOperation(
  operation: CollectionMutationContext["operation"],
): operation is "attention-disposition" {
  return operation === "attention-disposition";
}

type SemanticRedundancyMutationOperation =
  | "semantic-redundancy.settings.update"
  | "semantic-redundancy.execution.start"
  | "semantic-redundancy.execution.cancel"
  | "semantic-redundancy.execution.reserve-attempt"
  | "semantic-redundancy.execution.finish"
  | "semantic-redundancy.judgments.checkpoint"
  | "semantic-redundancy.generation.publish"
  | "semantic-redundancy.factual-weights.invalidate";

function isSemanticRedundancyOperation(
  operation: CollectionMutationContext["operation"],
): operation is SemanticRedundancyMutationOperation {
  return operation.startsWith("semantic-redundancy.");
}

function mutationImpact(context: CollectionMutationContext) {
  if (isSemanticRedundancyOperation(context.operation)) return null;
  if (context.operation === "attention-disposition-maintenance")
    return context.maintenanceImpact ?? null;
  if (context.operation === "attention-disposition")
    return { kind: "games" as const, gameIds: [...(context.gameIds ?? [])] };
  return attentionImpactForCollectionMutation(context.operation, context.gameIds);
}

function invalidatesSemanticDisplayArtifacts(prior: Collection, accepted: Collection): boolean {
  return (
    prior.semanticRedundancy.evidenceEpoch !== accepted.semanticRedundancy.evidenceEpoch ||
    prior.semanticRedundancy.consentEpoch !== accepted.semanticRedundancy.consentEpoch ||
    prior.semanticRedundancy.factualWeightsEpoch !==
      accepted.semanticRedundancy.factualWeightsEpoch ||
    prior.semanticRedundancy.factualWeightsFingerprint !==
      accepted.semanticRedundancy.factualWeightsFingerprint
  );
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
  const revisionStrategy = deps.revisionStrategy ?? collectionRevisionStrategy;
  let dispositionWinners = deps.dispositionWinners;
  const logger = deps.logger ?? createLogger("collection-mutation");
  const profileSourceCoordinator = profileSourceCoordinatorFor(deps.storageService);
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
    return profileSourceCoordinator.runExclusive(() =>
      serialize(async (): Promise<CollectionMutationOutcome<Value>> => {
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
            cleanupPending: false,
          };
        }

        let accepted: Collection;
        try {
          if (
            dispositionWinners &&
            !isAttentionDispositionOperation(context.operation) &&
            context.operation !== "attention-disposition-maintenance" &&
            !isSemanticRedundancyOperation(context.operation)
          ) {
            const impact = mutationImpact(context);
            const affectedGameIds =
              impact?.kind === "global"
                ? candidate.attentionDispositions.map((disposition) => disposition.gameId)
                : (impact?.gameIds ?? []);
            const winners = await dispositionWinners(current, candidate, context, affectedGameIds);
            clearIncompatibleAttentionDispositions(
              current,
              candidate,
              winners,
              new Set(affectedGameIds),
            );
          }
          applySemanticEvidenceTransition(current, candidate);
          accepted = CollectionSchema.parse(revisionStrategy.advance(candidate, current));
        } catch (error) {
          logger.warn("collection mutation rejected", {
            ...fields,
            outcome: "validation-failed",
          });
          await compensate(fields, decision.onPersistenceFailure, error);
          throw error;
        }

        const after = revisionStrategy.identity(accepted);
        const cachedOwnerNoteRevocation =
          current.semanticRedundancy.settings.cachedOwnerNoteUse &&
          !accepted.semanticRedundancy.settings.cachedOwnerNoteUse;
        const cachedOwnerNoteReenable =
          !current.semanticRedundancy.settings.cachedOwnerNoteUse &&
          accepted.semanticRedundancy.settings.cachedOwnerNoteUse;
        const jevImpact = planJevMutationImpact(current, accepted);
        const requiresJevRowPurge = jevImpact.sourceInvalidations.length > 0;
        if (cachedOwnerNoteReenable && "jevPairCache" in deps) {
          const cache = deps.jevPairCache;
          logger.log("JEV owner-note re-enable cache fence attempt", {
            ...fields,
            outcome: "attempting",
          });
          if (!cache || !cache.available) {
            logger.error("JEV owner-note re-enable cache fence failed", {
              ...fields,
              outcome: "cache-unavailable",
            });
            throw new Error("JEV pair cache is unavailable to safely re-enable owner-note use");
          }
          try {
            const purgedRows = cache.purgeDDependent();
            logger.log("JEV owner-note re-enable cache fence completed", {
              ...fields,
              purgedRows,
              outcome: "stale-rows-purged",
            });
          } catch (error) {
            logger.error("JEV owner-note re-enable cache fence failed", {
              ...fields,
              outcome: "sqlite-write-failed",
            });
            throw error;
          }
        }
        if (
          requiresJevRowPurge &&
          !cachedOwnerNoteRevocation &&
          !cachedOwnerNoteReenable &&
          "jevPairCache" in deps
        ) {
          const impactFields = {
            operation: context.operation,
            trigger: context.trigger,
            affectedGameIds: jevImpact.sourceInvalidations.map(({ gameId }) => gameId),
            affectedGameCount: jevImpact.sourceInvalidations.length,
            gameDependencies: jevImpact.sourceInvalidations.map(({ gameId, kinds }) => ({
              gameId,
              kinds,
            })),
            withdrawAdvisory: jevImpact.withdrawAdvisory,
          };
          logger.log("JEV mutation cache invalidation attempt", impactFields);
          const cache = deps.jevPairCache;
          if (!cache || !cache.available) {
            logger.error("JEV mutation cache invalidation failed", {
              ...impactFields,
              outcome: "cache-unavailable",
            });
            throw new Error(
              "JEV pair cache is unavailable for required collection mutation impact",
            );
          }
          try {
            let purgedRows = 0;
            for (const { gameId, kinds } of jevImpact.sourceInvalidations) {
              purgedRows += cache.invalidateGame(gameId, kinds);
            }
            if (jevImpact.withdrawAdvisory) cache.setActivation(null);
            logger.log("JEV mutation cache invalidation completed", {
              ...impactFields,
              gameCount: jevImpact.sourceInvalidations.length,
              purgedRows,
              activationWithdrawn: jevImpact.withdrawAdvisory,
              outcome: "invalidated",
            });
          } catch (error) {
            logger.error("JEV mutation cache invalidation failed", {
              ...impactFields,
              outcome: "sqlite-write-failed",
            });
            throw error;
          }
        } else if (
          jevImpact.withdrawAdvisory &&
          !requiresJevRowPurge &&
          !cachedOwnerNoteRevocation &&
          "jevPairCache" in deps
        ) {
          const cache = deps.jevPairCache;
          if (cache?.available) {
            logger.log("JEV advisory activation withdrawal attempt", {
              operation: context.operation,
              trigger: context.trigger,
              outcome: "attempting",
            });
            try {
              cache.setActivation(null);
              logger.log("JEV advisory activation withdrawal completed", {
                operation: context.operation,
                trigger: context.trigger,
                outcome: "withdrawn",
              });
            } catch {
              // The accepted collection's current fence remains authoritative if cache cleanup is unavailable.
              logger.warn("JEV advisory activation withdrawal deferred", {
                operation: context.operation,
                trigger: context.trigger,
                outcome: "collection-fence-required",
              });
            }
          } else {
            logger.warn("JEV advisory activation withdrawal deferred", {
              operation: context.operation,
              trigger: context.trigger,
              outcome: "collection-fence-required",
            });
          }
        }
        if (
          deps.semanticDisplayArtifactContext &&
          !cachedOwnerNoteRevocation &&
          invalidatesSemanticDisplayArtifacts(current, accepted)
        ) {
          logger.log("collection semantic display artifact purge attempt", { ...fields, after });
          try {
            await purgeSemanticDisplayArtifacts(deps.semanticDisplayArtifactContext);
            logger.log("collection semantic display artifact purge completed", {
              ...fields,
              after,
            });
          } catch (error) {
            logger.error("collection semantic display artifact purge failed", {
              ...fields,
              after,
              outcome: "pre-persistence-failed",
            });
            await compensate({ ...fields, after }, decision.onPersistenceFailure, error);
            throw error;
          }
        }
        if (decision.beforePersistence) {
          logger.log("collection mutation pre-persistence attempt", { ...fields, after });
          try {
            await decision.beforePersistence(accepted, current);
            logger.log("collection mutation pre-persistence completed", { ...fields, after });
          } catch (error) {
            logger.error("collection mutation pre-persistence failed", {
              ...fields,
              after,
              outcome: "pre-persistence-failed",
            });
            await compensate({ ...fields, after }, decision.onPersistenceFailure, error);
            throw error;
          }
        }
        logger.log("collection mutation persistence attempt", { ...fields, after });
        let persistenceResponseFailed = false;
        try {
          await deps.storageService.saveCollection(accepted);
        } catch (error) {
          logger.error("collection mutation persistence failed", {
            ...fields,
            after,
            outcome: "persistence-failed",
          });
          if (decision.classifyPersistenceOutcome !== true) {
            await compensate({ ...fields, after }, decision.onPersistenceFailure, error);
            throw error;
          }
          persistenceResponseFailed = true;
          let durable: Collection | null = null;
          try {
            durable = await deps.storageService.loadCollection();
          } catch {
            // The lifecycle performs fail-closed recovery when durable identity is unavailable.
          }
          if (
            durable === null ||
            collectionDurableIdentity(durable).contentHash !==
              collectionDurableIdentity(accepted).contentHash
          ) {
            await compensate({ ...fields, after }, decision.onPersistenceFailure, error);
            throw error;
          }
          logger.warn("collection mutation persistence response lost after durable commit", {
            ...fields,
            after,
            outcome: "committed-response-lost",
          });
        }
        logger.log("collection mutation persistence completed", {
          ...fields,
          after,
          responseRecovered: persistenceResponseFailed,
        });
        let cleanupPending = false;
        if (cachedOwnerNoteRevocation) {
          const cache = "jevPairCache" in deps ? deps.jevPairCache : null;
          const cleanupFields = {
            operation: context.operation,
            trigger: context.trigger,
            affectedGameIds: jevImpact.affectedGameIds,
            affectedGameCount: jevImpact.affectedGameIds.length,
            sourceInvalidationCount: jevImpact.sourceInvalidations.length,
          };
          cleanupPending = !purgeRevokedOwnerNoteCache(cache, logger, cleanupFields);
          if (
            deps.semanticDisplayArtifactContext &&
            invalidatesSemanticDisplayArtifacts(current, accepted)
          ) {
            logger.log("collection semantic display artifact revocation cleanup attempt", {
              ...fields,
              after,
            });
            try {
              await purgeSemanticDisplayArtifacts(deps.semanticDisplayArtifactContext);
              logger.log("collection semantic display artifact revocation cleanup completed", {
                ...fields,
                after,
              });
            } catch (error) {
              cleanupPending = true;
              logger.error("collection semantic display artifact revocation cleanup failed", {
                ...fields,
                after,
                reason: error instanceof Error ? error.message : String(error),
                outcome: "authority-effective-cleanup-pending",
              });
            }
          }
        }
        if (decision.onPersistenceSuccess) {
          logger.log("collection mutation post-commit attempt", { ...fields, after });
          try {
            await decision.onPersistenceSuccess();
            logger.log("collection mutation post-commit completed", { ...fields, after });
          } catch (error) {
            logger.error("collection mutation post-commit failed", {
              ...fields,
              after,
              outcome: "post-commit-failed",
            });
            throw error;
          }
        }
        if (
          deps.postCommitObserver &&
          !isAttentionDispositionOperation(context.operation) &&
          context.operation !== "attention-disposition-maintenance" &&
          !isSemanticRedundancyOperation(context.operation)
        ) {
          await deps.postCommitObserver({
            context,
            prior: current,
            accepted,
            impact: mutationImpact(context),
          });
        }
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
          cleanupPending,
        };
      }),
    );
  }

  const service: CollectionMutationService = {
    mutate,
    setDispositionWinners(resolver) {
      dispositionWinners = resolver;
    },
  };
  coordinators.set(deps.storageService, service);
  return service;
}
