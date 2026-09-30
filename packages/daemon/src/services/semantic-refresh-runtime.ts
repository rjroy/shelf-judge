import type { SemanticDisclosureManifest, SemanticSourceIdentity } from "@shelf-judge/shared";
import type { SemanticSignalScope } from "@shelf-judge/shared";
import { randomUUID } from "node:crypto";
import type { StorageService } from "./storage-service.js";
import type {
  SemanticRedundancyStateService,
  SemanticStateMutationResult,
} from "./semantic-redundancy-state-service.js";
import {
  SEMANTIC_CAPTURE_POLICY,
  type SemanticRefreshCaptureService,
} from "./semantic-refresh-capture-service.js";
import type {
  SemanticRefreshExecutionSnapshot,
  SemanticRefreshService,
} from "./semantic-refresh-service.js";
import { JEV_MODEL_ID, JEV_RUBRIC_VERSION } from "./jev/jev-gateway.js";
import { runOutsideProfileSourceCoordinator } from "./profile-source-coordinator.js";
import { isPublishedGenerationCurrent } from "./semantic-published-generation-validator.js";

const SEMANTIC_SCORING_VERSION = 1;

export type SemanticRefreshRuntimeFailure =
  | "invalid-request"
  | "not-found"
  | "not-authorized"
  | "stale"
  | "invalid-state"
  | "source-unavailable";

export interface SemanticRefreshRuntimeError extends Error {
  code: SemanticRefreshRuntimeFailure;
}

export interface SemanticRefreshRuntime {
  capture(input: {
    signalScope: SemanticSignalScope;
    budget?: Partial<SemanticDisclosureManifest["budget"]>;
  }): Promise<SemanticStateMutationResult<{ id: string; digest: string }>>;
  deliverPage(input: {
    manifestId: string;
    manifestDigest: string;
    offset: number;
    limit: number;
  }): ReturnType<SemanticRedundancyStateService["deliverDisclosurePage"]>;
  start(input: {
    manifestId: string;
    manifestDigest: string;
    sourceIdentity: SemanticSourceIdentity;
    pairCount: number;
    transmissionAuthorized: boolean;
    noteTransmissionAuthorized: boolean;
    cachedOwnerNoteUseAuthorized: boolean;
  }): Promise<SemanticStateMutationResult<unknown>>;
  status(): Promise<SemanticRefreshStatus>;
  cancel(commandId: string): ReturnType<SemanticRedundancyStateService["cancelExecution"]>;
  recoverOrphanedRun(): Promise<void>;
  isStartReceiptCurrentProcess(commandId: string): boolean;
}

export type SemanticRefreshStatus = {
  status: string;
  /** Current publication readiness, independent of the execution's terminal outcome. */
  publicationStatus?: "ready" | "stale" | "disabled" | "not-ready";
  manifest?: Pick<
    SemanticDisclosureManifest,
    | "id"
    | "digest"
    | "sourceIdentity"
    | "signalScope"
    | "providerId"
    | "modelId"
    | "rubricVersion"
    | "budget"
    | "expiresAt"
    | "eligibleGameIds"
  >;
  execution?: SemanticRefreshExecutionSnapshot["execution"] & {
    attemptCount: number;
    completedPairCount: number;
    failedPairCount: number;
  };
  deliveryComplete?: boolean;
  authorizationActive?: boolean;
  pairCount?: number;
};

function runtimeError(
  code: SemanticRefreshRuntimeFailure,
  message: string,
): SemanticRefreshRuntimeError {
  return Object.assign(new Error(message), { code });
}

/** Runtime orchestration only: no provider/gateway is constructed at this boundary. */
export function createSemanticRefreshRuntime(deps: {
  stateService: SemanticRedundancyStateService;
  captureService: SemanticRefreshCaptureService;
  worker: SemanticRefreshService;
  storageService: Pick<StorageService, "loadCollection">;
  now?: () => number;
  pageSize?: number;
}): SemanticRefreshRuntime {
  const now = deps.now ?? Date.now;
  const pageSize = deps.pageSize ?? 100;
  const launched = new Set<string>();
  const launchReceipts = new Set<string>();
  let slot: string | null = null;

  function launch(commandId: string): void {
    if (slot !== null || launched.has(commandId)) return;
    slot = commandId;
    launched.add(commandId);
    launchReceipts.add(commandId);
    // Clear the inherited AsyncLocalStorage token: queueMicrotask alone preserves it.
    queueMicrotask(() => {
      void runOutsideProfileSourceCoordinator(() => deps.worker.run(commandId))
        .catch(() => undefined)
        .finally(() => {
          if (slot === commandId) slot = null;
          launchReceipts.delete(commandId);
        });
    });
  }

  return {
    capture(input) {
      const validScopes: SemanticSignalScope[] = [
        "description-only",
        "owner-notes-only",
        "description-and-owner-notes",
      ];
      if (!validScopes.includes(input.signalScope))
        return Promise.reject(runtimeError("invalid-request", "Semantic signal scope is invalid"));

      const budget = {
        maxRequests: input.budget?.maxRequests ?? SEMANTIC_CAPTURE_POLICY.defaultBudget.maxRequests,
        maxTokens: input.budget?.maxTokens ?? SEMANTIC_CAPTURE_POLICY.defaultBudget.maxTokens,
        maxDurationMs:
          input.budget?.maxDurationMs ?? SEMANTIC_CAPTURE_POLICY.defaultBudget.maxDurationMs,
      };
      if (
        !Number.isSafeInteger(budget.maxRequests) ||
        budget.maxRequests < 0 ||
        budget.maxRequests > SEMANTIC_CAPTURE_POLICY.defaultBudget.maxRequests ||
        !Number.isSafeInteger(budget.maxTokens) ||
        budget.maxTokens < 0 ||
        budget.maxTokens > SEMANTIC_CAPTURE_POLICY.defaultBudget.maxTokens ||
        !Number.isSafeInteger(budget.maxDurationMs) ||
        budget.maxDurationMs < 1 ||
        budget.maxDurationMs > SEMANTIC_CAPTURE_POLICY.defaultBudget.maxDurationMs
      )
        return Promise.reject(
          runtimeError("invalid-request", "Semantic capture budget is invalid"),
        );

      const capturedAt = now();
      return deps.captureService.captureAndDisclose({
        signalScope: input.signalScope,
        budget,
        expiresAt: new Date(
          capturedAt + SEMANTIC_CAPTURE_POLICY.defaultBudget.maxDurationMs,
        ).toISOString(),
        id: randomUUID(),
      });
    },
    deliverPage(input) {
      if (
        !Number.isSafeInteger(input.offset) ||
        input.offset < 0 ||
        !Number.isSafeInteger(input.limit) ||
        input.limit !== pageSize
      )
        return Promise.reject(runtimeError("invalid-request", "Manifest page request is invalid"));
      return deps.storageService.loadCollection().then((collection) => {
        const manifest = collection.semanticRedundancy.disclosureManifest;
        if (
          !manifest ||
          manifest.id !== input.manifestId ||
          manifest.digest !== input.manifestDigest
        )
          return { outcome: "not-authorized" as const };
        return deps.captureService.withCurrentManifest({
          manifest,
          operation: () => deps.stateService.deliverDisclosurePage(input),
        });
      });
    },
    async start(input) {
      if (
        input.manifestId !== input.manifestId.trim() ||
        input.manifestId.length === 0 ||
        !Number.isSafeInteger(input.pairCount) ||
        input.pairCount < 0 ||
        input.transmissionAuthorized !== true
      )
        return { outcome: "not-authorized" };
      if (slot !== null && slot !== input.manifestId) return { outcome: "not-authorized" };

      const manifest = (await deps.storageService.loadCollection()).semanticRedundancy
        .disclosureManifest;
      if (
        !manifest ||
        manifest.id !== input.manifestId ||
        manifest.digest !== input.manifestDigest ||
        manifest.pairs.length !== input.pairCount
      )
        return { outcome: "not-authorized" };

      const started = await deps.captureService.withCurrentManifest({
        // The state service is still authoritative for consent, delivery, expiry, and replay.
        manifest,
        operation: async () => {
          const current = await deps.storageService.loadCollection();
          const existing = current.semanticRedundancy.execution;
          const deadlineAt =
            existing?.commandId === input.manifestId
              ? existing.deadlineAt
              : new Date(
                  Math.min(Date.parse(manifest.expiresAt), now() + manifest.budget.maxDurationMs),
                ).toISOString();
          return deps.stateService.startExecution({
            commandId: input.manifestId,
            manifestId: input.manifestId,
            manifestDigest: input.manifestDigest,
            pairCount: input.pairCount,
            sourceIdentity: input.sourceIdentity,
            transmissionAuthorized: input.transmissionAuthorized,
            noteTransmissionAuthorized: input.noteTransmissionAuthorized,
            cachedOwnerNoteUseAuthorized: input.cachedOwnerNoteUseAuthorized,
            deadlineAt,
          });
        },
      });
      if (started.outcome === "accepted" && started.value.disposition === "CREATED")
        launch(input.manifestId);
      return started;
    },
    async status() {
      const collection = await deps.storageService.loadCollection();
      const state = collection.semanticRedundancy;
      let publicationStatus: "ready" | "stale" | "disabled" | "not-ready";
      if (!state.settings.enabled) {
        publicationStatus = "disabled";
      } else if (!state.publishedGeneration) {
        publicationStatus = "not-ready";
      } else {
        try {
          const generation = state.publishedGeneration;
          const currentIdentity = await deps.captureService.validateSourceIdentity(
            collection,
            generation.sourceIdentity,
          );
          const publicationValid = isPublishedGenerationCurrent({
            collection,
            generation,
            modelId: JEV_MODEL_ID,
            rubricVersion: JEV_RUBRIC_VERSION,
            scoringVersion: SEMANTIC_SCORING_VERSION,
          });
          publicationStatus = currentIdentity && publicationValid ? "ready" : "stale";
        } catch {
          // Source availability is not evidence of a current publication.
          publicationStatus = "not-ready";
        }
      }
      const manifest = state.disclosureManifest;
      const execution = state.execution;
      if (!manifest || !execution || execution.manifestDigest !== manifest.digest)
        return { status: "not-ready", publicationStatus };
      return {
        status: execution.status,
        publicationStatus,
        manifest: {
          id: manifest.id,
          digest: manifest.digest,
          sourceIdentity: manifest.sourceIdentity,
          signalScope: manifest.signalScope,
          providerId: manifest.providerId,
          modelId: manifest.modelId,
          rubricVersion: manifest.rubricVersion,
          budget: manifest.budget,
          expiresAt: manifest.expiresAt,
          eligibleGameIds: [...manifest.eligibleGameIds],
        },
        execution: {
          commandId: execution.commandId,
          manifestDigest: execution.manifestDigest,
          sourceIdentity: execution.sourceIdentity,
          signalScope: execution.signalScope,
          noteTransmissionAuthorized: execution.noteTransmissionAuthorized,
          cachedOwnerNoteUseAuthorized: execution.cachedOwnerNoteUseAuthorized,
          status: execution.status,
          startedAt: execution.startedAt,
          deadlineAt: execution.deadlineAt,
          attemptCount: execution.attemptCount,
          completedPairCount: execution.completedPairCount,
          failedPairCount: execution.failedPairCount,
        },
        deliveryComplete: state.manifestDelivery?.complete === true,
        authorizationActive: state.authorization?.state === "active",
        pairCount: manifest.pairs.length,
      };
    },
    async cancel(commandId) {
      return deps.worker.cancel(commandId);
    },
    async recoverOrphanedRun() {
      const { semanticRedundancy } = await deps.storageService.loadCollection();
      const execution = semanticRedundancy.execution;
      if (execution?.status === "running") {
        const result = await deps.stateService.finishExecution({
          commandId: execution.commandId,
          status: "interrupted",
        });
        if (result.outcome !== "accepted")
          throw runtimeError("invalid-state", "Could not revoke orphaned semantic execution");
      }
    },
    isStartReceiptCurrentProcess: (commandId) => launchReceipts.has(commandId),
  };
}
