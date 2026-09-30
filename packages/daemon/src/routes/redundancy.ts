import { Hono } from "hono";
import type { RedundancySettings } from "@shelf-judge/shared";
import { DurableSourcePostCommitError, type StorageService } from "../services/storage-service.js";
import type { AttentionMutationImpact } from "../services/attention-candidate-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";
import type { SemanticRedundancySettings } from "@shelf-judge/shared";
import type {
  SemanticRefreshRuntime,
  SemanticRefreshRuntimeFailure,
} from "../services/semantic-refresh-runtime.js";
import type { SemanticRedundancyStateService } from "../services/semantic-redundancy-state-service.js";
import type { SemanticSignalScope } from "@shelf-judge/shared";
import { SEMANTIC_CAPTURE_POLICY } from "../services/semantic-refresh-capture-service.js";
import {
  canonicalSha256,
  profileSourceCoordinatorFor,
} from "../services/profile-source-coordinator.js";
import { collectionMutationServiceFor } from "../services/collection-mutation-service.js";
import { createSemanticRedundancyStateService } from "../services/semantic-redundancy-state-service.js";

export interface RedundancyRoutesDeps {
  storageService: StorageService;
  /** Semantic endpoints fail closed when either injected boundary is unavailable. */
  semanticRuntime?: SemanticRefreshRuntime;
  semanticStateService?: SemanticRedundancyStateService;
  afterSourceSave?: (impact: AttentionMutationImpact) => Promise<void>;
}

const SEMANTIC_PAGE_SIZE = 100;
const SEMANTIC_SIGNAL_SCOPES = new Set<SemanticSignalScope>([
  "description-only",
  "owner-notes-only",
  "description-and-owner-notes",
]);
const SEMANTIC_PATCH_FIELDS = new Set(["enabled", "weights", "cachedOwnerNoteUse"]);

function validateSemanticPatch(value: unknown): value is Partial<SemanticRedundancySettings> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const patch = value as Record<string, unknown>;
  if (Object.keys(patch).some((key) => !SEMANTIC_PATCH_FIELDS.has(key))) return false;
  if ("enabled" in patch && typeof patch.enabled !== "boolean") return false;
  if ("cachedOwnerNoteUse" in patch && typeof patch.cachedOwnerNoteUse !== "boolean") return false;
  if ("weights" in patch) {
    const weights = patch.weights;
    if (typeof weights !== "object" || weights === null || Array.isArray(weights)) return false;
    const record = weights as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["factual", "description", "ownerNote"].includes(key)))
      return false;
    for (const key of ["factual", "description", "ownerNote"]) {
      if (
        key in record &&
        (typeof record[key] !== "number" || !Number.isFinite(record[key]) || record[key] < 0)
      )
        return false;
    }
  }
  return true;
}

function semanticErrorStatus(outcome: string): 400 | 403 | 409 {
  return outcome === "stale" ? 409 : outcome === "invalid-state" ? 400 : 403;
}

function safeRuntimeStatus(status: Awaited<ReturnType<SemanticRefreshRuntime["status"]>>) {
  const publicationStatus =
    typeof status.publicationStatus === "string" &&
    ["ready", "stale", "disabled", "not-ready"].includes(status.publicationStatus)
      ? status.publicationStatus
      : "not-ready";
  if (!status.manifest || !status.execution)
    return { status: publicationStatus, publicationStatus };
  return {
    status: publicationStatus,
    publicationStatus,
    manifest: {
      id: status.manifest.id,
      digest: status.manifest.digest,
      signalScope: status.manifest.signalScope,
      providerId: status.manifest.providerId,
      modelId: status.manifest.modelId,
      budget: status.manifest.budget,
      expiresAt: status.manifest.expiresAt,
      eligibleGameCount: status.manifest.eligibleGameIds.length,
    },
    execution: {
      status: status.execution.status,
      startedAt: status.execution.startedAt,
      deadlineAt: status.execution.deadlineAt,
      attemptCount: status.execution.attemptCount,
      completedPairCount: status.execution.completedPairCount,
      failedPairCount: status.execution.failedPairCount,
    },
    deliveryComplete: status.deliveryComplete === true,
    authorizationActive: status.authorizationActive === true,
    pairCount: status.pairCount ?? 0,
  };
}

function runtimeFailureStatus(error: unknown): 400 | 404 | 409 | 503 {
  const code = (error as { code?: SemanticRefreshRuntimeFailure } | null)?.code;
  return code === "invalid-request"
    ? 400
    : code === "not-found"
      ? 404
      : code === "stale"
        ? 409
        : 503;
}

const VALID_STAGES = new Set(["annotation", "integrated"]);

function validatePatch(patch: Record<string, unknown>): { error: string } | null {
  const allowed = new Set([
    "enabled",
    "stage",
    "similarityThreshold",
    "maxPenalty",
    "minNeighbors",
    "expectedNeighbors",
    "componentWeights",
  ]);
  const unknown = Object.keys(patch).find((key) => !allowed.has(key));
  if (unknown) return { error: `Unknown redundancy setting: ${unknown}` };
  if ("enabled" in patch && typeof patch.enabled !== "boolean") {
    return { error: "enabled must be a boolean" };
  }

  if ("stage" in patch) {
    if (typeof patch.stage !== "string" || !VALID_STAGES.has(patch.stage)) {
      return { error: 'stage must be "annotation" or "integrated"' };
    }
  }

  if ("similarityThreshold" in patch) {
    const v = patch.similarityThreshold;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      return { error: "similarityThreshold must be a number between 0.0 and 1.0" };
    }
  }

  if ("maxPenalty" in patch) {
    const v = patch.maxPenalty;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0.5 || v > 5.0) {
      return { error: "maxPenalty must be a number between 0.5 and 5.0" };
    }
  }

  if ("minNeighbors" in patch) {
    const v = patch.minNeighbors;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      return { error: "minNeighbors must be an integer >= 1" };
    }
  }

  if ("expectedNeighbors" in patch) {
    const v = patch.expectedNeighbors;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      return { error: "expectedNeighbors must be an integer >= 1" };
    }
  }

  if ("componentWeights" in patch) {
    const cw = patch.componentWeights;
    if (typeof cw !== "object" || cw === null || Array.isArray(cw)) {
      return { error: "componentWeights must be an object with binary and continuous" };
    }
    const obj = cw as Record<string, unknown>;
    const unknown = Object.keys(obj).find((key) => key !== "binary" && key !== "continuous");
    if (unknown) return { error: `Unknown componentWeights field: ${unknown}` };
    for (const key of ["binary", "continuous"]) {
      if (key in obj) {
        const v = obj[key];
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
          return { error: `componentWeights.${key} must be a number >= 0` };
        }
      }
    }
    // Sum > 0 is enforced post-merge at line 131, which correctly handles partial patches.
  }

  return null;
}

export function createRedundancyRoutes(deps: RedundancyRoutesDeps): RouteModule {
  const { storageService } = deps;
  const profileSourceCoordinator = profileSourceCoordinatorFor(storageService);
  const semanticState = createSemanticRedundancyStateService({
    collectionMutationService: collectionMutationServiceFor(storageService),
  });
  const routes = new Hono();

  // GET /redundancy/settings
  routes.get("/redundancy/settings", async (c) => {
    try {
      const result = await storageService.loadRedundancySettingsRead?.();
      const settings = result?.settings ?? (await storageService.loadRedundancySettings());
      const collection = await storageService.loadCollection();
      const semanticStatus = deps.semanticRuntime
        ? safeRuntimeStatus(await deps.semanticRuntime.status())
        : { status: "unavailable" as const };
      return c.json({
        ...settings,
        ...(result ? { migrationNotice: result.migrationNotice } : {}),
        semantic: { settings: collection.semanticRedundancy.settings, status: semanticStatus },
      });
    } catch {
      return c.json({ error: "Redundancy settings are unavailable" }, 500);
    }
  });

  // Semantic settings have their own collection-owned authority and never share the
  // factual settings PATCH surface.
  routes.patch("/redundancy/semantic-settings", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (!validateSemanticPatch(body))
      return c.json({ error: "Invalid semantic settings patch" }, 400);
    const stateService = deps.semanticStateService ?? semanticState;
    try {
      const collection = await storageService.loadCollection();
      const current = collection.semanticRedundancy;
      const patch = body;
      const settings: SemanticRedundancySettings = {
        ...current.settings,
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
        ...(patch.cachedOwnerNoteUse === undefined
          ? {}
          : { cachedOwnerNoteUse: patch.cachedOwnerNoteUse }),
        ...(patch.weights === undefined
          ? {}
          : { weights: { ...current.settings.weights, ...patch.weights } }),
      };
      if (settings.weights.factual + settings.weights.description + settings.weights.ownerNote <= 0)
        return c.json({ error: "At least one semantic weight must be greater than zero" }, 400);
      const result = await stateService.updateSettings(
        { evidenceEpoch: current.evidenceEpoch, consentEpoch: current.consentEpoch },
        settings,
      );
      if (result.outcome !== "accepted")
        return c.json(
          { error: "Semantic settings update rejected", outcome: result.outcome },
          semanticErrorStatus(result.outcome),
        );
      return c.json({ settings });
    } catch {
      return c.json({ error: "Semantic settings are unavailable" }, 503);
    }
  });

  // Explicit user-triggered disclosure. This persists only a frozen manifest; it does
  // not start worker execution or reach the provider.
  routes.post("/redundancy/semantic/disclosure", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return c.json({ error: "Request body must be an object" }, 400);
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).some((key) => key !== "signalScope" && key !== "budget") ||
      typeof input.signalScope !== "string" ||
      !SEMANTIC_SIGNAL_SCOPES.has(input.signalScope as SemanticSignalScope)
    )
      return c.json({ error: "Invalid disclosure request" }, 400);
    let budget: { maxRequests?: number; maxTokens?: number; maxDurationMs?: number } | undefined;
    if (input.budget !== undefined) {
      if (typeof input.budget !== "object" || input.budget === null || Array.isArray(input.budget))
        return c.json({ error: "Invalid disclosure budget" }, 400);
      const requested = input.budget as Record<string, unknown>;
      const limits = SEMANTIC_CAPTURE_POLICY.defaultBudget;
      if (
        Object.keys(requested).some(
          (key) => key !== "maxRequests" && key !== "maxTokens" && key !== "maxDurationMs",
        ) ||
        ("maxRequests" in requested &&
          (!Number.isSafeInteger(requested.maxRequests) ||
            (requested.maxRequests as number) < 0 ||
            (requested.maxRequests as number) > limits.maxRequests)) ||
        ("maxTokens" in requested &&
          (!Number.isSafeInteger(requested.maxTokens) ||
            (requested.maxTokens as number) < 0 ||
            (requested.maxTokens as number) > limits.maxTokens)) ||
        ("maxDurationMs" in requested &&
          (!Number.isSafeInteger(requested.maxDurationMs) ||
            (requested.maxDurationMs as number) < 1 ||
            (requested.maxDurationMs as number) > limits.maxDurationMs))
      )
        return c.json({ error: "Invalid disclosure budget" }, 400);
      budget = requested;
    }
    if (!deps.semanticRuntime) return c.json({ error: "Semantic refresh is unavailable" }, 503);
    try {
      const created = await deps.semanticRuntime.capture({
        signalScope: input.signalScope as SemanticSignalScope,
        ...(budget === undefined ? {} : { budget }),
      });
      if (created.outcome !== "accepted")
        return c.json(
          { error: "Disclosure could not be created", outcome: created.outcome },
          semanticErrorStatus(created.outcome),
        );
      const collection = await storageService.loadCollection();
      const manifest = collection.semanticRedundancy.disclosureManifest;
      if (!manifest || manifest.id !== created.value.id || manifest.digest !== created.value.digest)
        return c.json({ error: "Disclosure state is unavailable" }, 503);
      return c.json(
        {
          id: manifest.id,
          digest: manifest.digest,
          signalScope: manifest.signalScope,
          providerId: manifest.providerId,
          modelId: manifest.modelId,
          budget: manifest.budget,
          expiresAt: manifest.expiresAt,
          eligibleGameCount: manifest.eligibleGameIds.length,
          pairCount: manifest.pairs.length,
          notePairCount: manifest.pairs.filter((pair) => pair.hasOwnerNoteA && pair.hasOwnerNoteB)
            .length,
          pageSize: SEMANTIC_PAGE_SIZE,
        },
        201,
      );
    } catch (error) {
      const status = runtimeFailureStatus(error);
      return c.json(
        { error: status === 400 ? "Invalid disclosure request" : "Disclosure capture failed" },
        status,
      );
    }
  });

  routes.get("/redundancy/semantic/summary", async (c) => {
    try {
      const collection = await storageService.loadCollection();
      const state = collection.semanticRedundancy;
      const generation = state.publishedGeneration;
      const runtimeStatus = deps.semanticRuntime
        ? safeRuntimeStatus(await deps.semanticRuntime.status())
        : { status: "not-ready" as const, publicationStatus: "not-ready" as const };
      const publicationStatus = !state.settings.enabled
        ? "disabled"
        : generation
          ? runtimeStatus.publicationStatus === "ready"
            ? "ready"
            : runtimeStatus.publicationStatus === "disabled"
              ? "not-ready"
              : runtimeStatus.publicationStatus
          : "not-ready";
      return c.json({
        settings: state.settings,
        status: publicationStatus,
        generation: generation
          ? {
              id: generation.id,
              signalScope: generation.signalScope,
              publishedAt: generation.publishedAt,
              pairCount: generation.pairOutcomes.length,
            }
          : null,
        disclosure: state.disclosure
          ? {
              id: state.disclosure.id,
              digest: state.disclosure.manifestDigest,
              pairCount: state.disclosure.pairCount,
              notePairCount: state.disclosure.notePairCount,
              expiresAt: state.disclosure.expiresAt,
            }
          : null,
      });
    } catch {
      return c.json({ error: "Semantic summary is unavailable" }, 503);
    }
  });

  routes.post("/redundancy/semantic/disclosure/page", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return c.json({ error: "Request body must be an object" }, 400);
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).some((key) => !["manifestId", "manifestDigest", "offset"].includes(key)) ||
      typeof input.manifestId !== "string" ||
      typeof input.manifestDigest !== "string" ||
      !Number.isSafeInteger(input.offset) ||
      (input.offset as number) < 0
    )
      return c.json({ error: "Invalid disclosure page request" }, 400);
    if (!deps.semanticRuntime) return c.json({ error: "Semantic refresh is unavailable" }, 503);
    try {
      const page = await deps.semanticRuntime.deliverPage({
        manifestId: input.manifestId,
        manifestDigest: input.manifestDigest,
        offset: input.offset as number,
        limit: SEMANTIC_PAGE_SIZE,
      });
      if (page.outcome !== "accepted")
        return c.json(
          { error: "Disclosure page rejected", outcome: page.outcome },
          semanticErrorStatus(page.outcome),
        );
      const value = page.value;
      return c.json({
        manifestId: value.manifestId,
        manifestDigest: value.manifestDigest,
        offset: value.offset,
        nextOffset: value.nextOffset,
        complete: value.complete,
        pairs: value.pairs.map(
          ({ gameA, gameB, hasDescriptionA, hasDescriptionB, hasOwnerNoteA, hasOwnerNoteB }) => ({
            gameA,
            gameB,
            hasDescriptionA,
            hasDescriptionB,
            hasOwnerNoteA,
            hasOwnerNoteB,
          }),
        ),
        receipt: value.receipt,
      });
    } catch {
      return c.json({ error: "Disclosure page unavailable" }, 503);
    }
  });

  routes.post("/redundancy/semantic/acknowledge-and-start", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return c.json({ error: "Request body must be an object" }, 400);
    const input = body as Record<string, unknown>;
    const allowed = [
      "manifestId",
      "manifestDigest",
      "pairCount",
      "transmissionAuthorized",
      "noteTransmissionAuthorized",
      "cachedOwnerNoteUseAuthorized",
    ];
    if (
      Object.keys(input).some((key) => !allowed.includes(key)) ||
      typeof input.manifestId !== "string" ||
      typeof input.manifestDigest !== "string" ||
      !Number.isSafeInteger(input.pairCount) ||
      (input.pairCount as number) < 0 ||
      input.transmissionAuthorized !== true ||
      typeof input.noteTransmissionAuthorized !== "boolean" ||
      typeof input.cachedOwnerNoteUseAuthorized !== "boolean"
    )
      return c.json({ error: "Invalid acknowledgement" }, 400);
    if (!deps.semanticRuntime) return c.json({ error: "Semantic refresh is unavailable" }, 503);
    try {
      const collection = await storageService.loadCollection();
      const manifest = collection.semanticRedundancy.disclosureManifest;
      if (!manifest || manifest.id !== input.manifestId || manifest.digest !== input.manifestDigest)
        return c.json({ error: "Disclosure is not current" }, 409);
      const started = await deps.semanticRuntime.start({
        manifestId: manifest.id,
        manifestDigest: manifest.digest,
        sourceIdentity: manifest.sourceIdentity,
        pairCount: input.pairCount as number,
        transmissionAuthorized: true,
        noteTransmissionAuthorized: input.noteTransmissionAuthorized,
        cachedOwnerNoteUseAuthorized: input.cachedOwnerNoteUseAuthorized,
      });
      if (started.outcome !== "accepted")
        return c.json(
          { error: "Acknowledgement rejected", outcome: started.outcome },
          semanticErrorStatus(started.outcome),
        );
      const execution = started.value as {
        disposition: "CREATED" | "REPLAYED";
        status: string;
        commandId: string;
        deadlineAt: string;
      };
      return c.json(
        {
          disposition: execution.disposition,
          status: execution.status,
          commandId: execution.commandId,
          deadlineAt: execution.deadlineAt,
        },
        execution.disposition === "CREATED" ? 202 : 200,
      );
    } catch {
      return c.json({ error: "Semantic execution could not start" }, 503);
    }
  });

  routes.get("/redundancy/semantic/refresh-status", async (c) => {
    if (!deps.semanticRuntime) return c.json({ error: "Semantic refresh is unavailable" }, 503);
    try {
      return c.json(safeRuntimeStatus(await deps.semanticRuntime.status()));
    } catch {
      return c.json({ error: "Semantic refresh status is unavailable" }, 503);
    }
  });

  routes.post("/redundancy/semantic/cancel", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "commandId") ||
      typeof (body as Record<string, unknown>).commandId !== "string"
    )
      return c.json({ error: "Invalid cancel request" }, 400);
    if (!deps.semanticRuntime) return c.json({ error: "Semantic refresh is unavailable" }, 503);
    try {
      const result = await deps.semanticRuntime.cancel((body as { commandId: string }).commandId);
      if (result.outcome !== "accepted")
        return c.json(
          { error: "Cancellation rejected", outcome: result.outcome },
          semanticErrorStatus(result.outcome),
        );
      return c.json({ outcome: "accepted" });
    } catch {
      return c.json({ error: "Semantic cancellation failed" }, 503);
    }
  });

  // PATCH /redundancy/settings
  routes.patch("/redundancy/settings", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "Request body must be a JSON object" }, 400);
    }

    const patch = body as Record<string, unknown>;

    const validation = validatePatch(patch);
    if (validation) {
      return c.json({ error: validation.error }, 400);
    }

    let collectionFenced = false;
    let factualSettingsPersisted = false;
    try {
      return await profileSourceCoordinator.runExclusive(async () => {
        const current = await storageService.loadRedundancySettings();
        const updated: RedundancySettings = { ...current };

        if ("enabled" in patch) updated.enabled = patch.enabled as boolean;
        if ("stage" in patch) updated.stage = patch.stage as RedundancySettings["stage"];
        if ("similarityThreshold" in patch)
          updated.similarityThreshold = patch.similarityThreshold as number;
        if ("maxPenalty" in patch) updated.maxPenalty = patch.maxPenalty as number;
        if ("minNeighbors" in patch) updated.minNeighbors = patch.minNeighbors as number;
        if ("expectedNeighbors" in patch)
          updated.expectedNeighbors = patch.expectedNeighbors as number;
        if ("componentWeights" in patch) {
          const cw = patch.componentWeights as Record<string, unknown>;
          updated.componentWeights = {
            binary: typeof cw.binary === "number" ? cw.binary : current.componentWeights.binary,
            continuous:
              typeof cw.continuous === "number"
                ? cw.continuous
                : current.componentWeights.continuous,
          };
        }

        // Post-merge validation: componentWeights sum > 0
        const { binary, continuous } = updated.componentWeights;
        if (!Number.isFinite(binary + continuous) || binary + continuous === 0) {
          return c.json({ error: "componentWeights sum must be greater than 0" }, 400);
        }

        const factualWeightsChanged =
          updated.componentWeights.binary !== current.componentWeights.binary ||
          updated.componentWeights.continuous !== current.componentWeights.continuous;
        if (factualWeightsChanged) {
          const weightsFingerprint = canonicalSha256(updated.componentWeights);
          const result = await semanticState.invalidateForFactualWeights(weightsFingerprint);
          if (result.outcome !== "accepted") {
            return c.json(
              {
                error:
                  "Could not durably fence semantic generation before changing factual weights",
                factualSettingsPersisted: false,
              },
              500,
            );
          }
          collectionFenced = true;
        }

        await storageService.saveRedundancySettings(updated);
        factualSettingsPersisted = true;
        try {
          await deps.afterSourceSave?.({ kind: "global", reason: "redundancy" });
        } catch {
          return c.json(
            {
              error: "Post-save invalidation failed",
              factualSettingsPersisted,
              semanticGenerationWithdrawn: collectionFenced,
              afterSourceSaveFailed: true,
            },
            500,
          );
        }
        return c.json(updated);
      });
    } catch (err) {
      if (err instanceof DurableSourcePostCommitError) {
        return c.json(
          {
            error: "Factual settings were saved but profile invalidation failed",
            factualSettingsPersisted: err.durable,
            semanticGenerationWithdrawn: true,
            profileInvalidationFailed: true,
          },
          500,
        );
      }
      return c.json(
        {
          error: "Redundancy settings update failed",
          factualSettingsPersisted,
          semanticGenerationWithdrawn: collectionFenced,
        },
        500,
      );
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.redundancy.get-settings",
      name: "get-settings",
      description: "Get redundancy scoring settings",
      invocation: { method: "GET", path: "/api/redundancy/settings" },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.update-settings",
      name: "update-settings",
      description: "Update redundancy scoring settings",
      invocation: { method: "PATCH", path: "/api/redundancy/settings" },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.update-semantic-settings",
      name: "update-semantic-settings",
      description: "Update opt-in semantic redundancy settings",
      invocation: { method: "PATCH", path: "/api/redundancy/semantic-settings" },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.create-semantic-disclosure",
      name: "create-semantic-disclosure",
      description: "Create a scoped, bounded disclosure for an explicit semantic refresh",
      invocation: { method: "POST", path: "/api/redundancy/semantic/disclosure" },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: false,
    },
    {
      operationId: "shelf.redundancy.get-semantic-summary",
      name: "get-semantic-summary",
      description: "Get safe semantic redundancy settings and publication summary",
      invocation: { method: "GET", path: "/api/redundancy/semantic/summary" },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.deliver-semantic-disclosure-page",
      name: "deliver-semantic-disclosure-page",
      description: "Deliver and record one page of exact disclosed pair IDs and note-bearing flags",
      invocation: { method: "POST", path: "/api/redundancy/semantic/disclosure/page" },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.acknowledge-and-start-semantic-refresh",
      name: "acknowledge-and-start-semantic-refresh",
      description:
        "Acknowledge the complete disclosed pair set and explicitly authorize one refresh",
      invocation: { method: "POST", path: "/api/redundancy/semantic/acknowledge-and-start" },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.get-semantic-refresh-status",
      name: "get-semantic-refresh-status",
      description: "Get bounded semantic refresh progress",
      invocation: { method: "GET", path: "/api/redundancy/semantic/refresh-status" },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.cancel-semantic-refresh",
      name: "cancel-semantic-refresh",
      description: "Cancel the current explicitly authorized semantic refresh",
      invocation: { method: "POST", path: "/api/redundancy/semantic/cancel" },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
  ];

  return { routes, operations };
}
