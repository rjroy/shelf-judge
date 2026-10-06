import { Hono, type Context } from "hono";
import type { JevWishlistCandidateSelection, RedundancySettings } from "@shelf-judge/shared";
import { DurableSourcePostCommitError, type StorageService } from "../services/storage-service.js";
import type { AttentionMutationImpact } from "../services/attention-candidate-service.js";
import type { OperationJsonValue, RouteModule, OperationDefinition } from "../operations.js";
import type { SemanticRedundancySettings } from "@shelf-judge/shared";
import type { SemanticRedundancyStateService } from "../services/semantic-redundancy-state-service.js";
import {
  canonicalSha256,
  profileSourceCoordinatorFor,
} from "../services/profile-source-coordinator.js";
import { collectionMutationServiceFor } from "../services/collection-mutation-service.js";
import { createSemanticRedundancyStateService } from "../services/semantic-redundancy-state-service.js";
import type { createJevStatusService } from "../services/jev-status-service.js";
import type { JevRunController } from "../services/jev-run-controller.js";
import type { createJevRefreshProgressService } from "../services/jev-refresh-progress-service.js";
import { parseJevRunBudgetQuery } from "../services/jev-run-budget.js";

type JevRunRouteController = Pick<
  JevRunController,
  "preview" | "previewWishlist" | "start" | "cancel" | "retryPublication" | "activeRun"
>;

export interface RedundancyRoutesDeps {
  storageService: StorageService;
  semanticStateService?: SemanticRedundancyStateService;
  jevStatusService?: Pick<ReturnType<typeof createJevStatusService>, "read">;
  jevRunController?: JevRunRouteController;
  jevRefreshProgressService?: Pick<ReturnType<typeof createJevRefreshProgressService>, "read">;
  afterSourceSave?: (impact: AttentionMutationImpact) => Promise<void>;
}

const SEMANTIC_PATCH_FIELDS = new Set(["enabled", "weights", "cachedOwnerNoteUse"]);

const JEV_RUN_PROGRESS_PROJECTION_SCHEMA: { [key: string]: OperationJsonValue } = {
  type: "object",
  properties: {
    state: { enum: ["last-known-running", "completed", "interrupted", "failed"] },
    scope: { enum: ["collection", "wishlist"] },
    pairCount: { type: "integer" },
    completedPairs: { type: "integer" },
    cacheHits: { type: "integer" },
    cacheMisses: { type: "integer" },
    failedPairs: { type: "integer" },
    stopReason: {
      enum: [
        "provider-limit",
        "provider-unconfigured",
        "application-attempt-limit",
        "application-token-threshold",
        "application-deadline",
        "owner-cancelled",
      ],
    },
    publication: {
      type: "object",
      properties: {
        state: { enum: ["published", "unchanged", "pending"] },
        phase: { enum: ["seal", "validate", "promote"] },
        outcomePersistence: { enum: ["sealed", "finalized", "unpersisted"] },
        reason: { type: "string" },
      },
      required: ["state", "outcomePersistence"],
      additionalProperties: false,
    },
  },
  required: ["state", "pairCount", "completedPairs", "cacheHits", "cacheMisses", "failedPairs"],
  additionalProperties: false,
};

const JEV_REFRESH_PROGRESS_ENTRY_SCHEMA: { [key: string]: OperationJsonValue } = {
  oneOf: [
    {
      type: "object",
      properties: { state: { enum: ["none", "unavailable"] } },
      required: ["state"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        state: { const: "process-local" },
        value: JEV_RUN_PROGRESS_PROJECTION_SCHEMA,
        retryRunId: { type: "string", minLength: 1 },
      },
      required: ["state", "value", "retryRunId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        state: { const: "saved" },
        relation: { enum: ["active-run", "historical", "unknown"] },
        value: JEV_RUN_PROGRESS_PROJECTION_SCHEMA,
        retryRunId: { type: "string", minLength: 1 },
      },
      required: ["state", "relation", "value"],
      additionalProperties: false,
    },
  ],
};

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

const VALID_STAGES = new Set(["annotation", "integrated"]);

type ParsedRunPreviewQuery = {
  budget: {
    maxProviderAttempts: number;
    reportedTokenStopThreshold: number;
    maxRunDurationMs: number;
  };
  selection: JevWishlistCandidateSelection | undefined;
};

function parseRunPreviewQuery(
  params: URLSearchParams,
): { ok: true; value: ParsedRunPreviewQuery } | { ok: false } {
  const allowed = new Set([
    "maxProviderAttempts",
    "reportedTokenStopThreshold",
    "maxRunDurationMs",
    "scope",
    "bggId",
  ]);
  for (const key of params.keys()) if (!allowed.has(key)) return { ok: false };

  const scopeValues = params.getAll("scope");
  if (scopeValues.length > 1) return { ok: false };
  const scope = scopeValues[0];
  const bggValues = params.getAll("bggId");
  if (scope !== undefined && scope !== "collection" && scope !== "wishlist") return { ok: false };
  if (bggValues.length > 0 && scope !== "wishlist") return { ok: false };

  let selection: JevWishlistCandidateSelection | undefined;
  if (scope === "wishlist" && bggValues.length > 0) {
    const bggIds: number[] = [];
    for (const value of bggValues) {
      if (!/^[1-9][0-9]*$/u.test(value)) return { ok: false };
      const bggId = Number(value);
      if (!Number.isSafeInteger(bggId)) return { ok: false };
      bggIds.push(bggId);
    }
    if (new Set(bggIds).size !== bggIds.length) return { ok: false };
    selection = { kind: "selected", bggIds: bggIds.sort((a, b) => a - b) };
  }

  const budgetParams = new URLSearchParams();
  for (const key of ["maxProviderAttempts", "reportedTokenStopThreshold", "maxRunDurationMs"])
    for (const value of params.getAll(key)) budgetParams.append(key, value);
  const parsedBudget = parseJevRunBudgetQuery(budgetParams);
  return parsedBudget.ok
    ? { ok: true, value: { budget: parsedBudget.budget, selection } }
    : { ok: false };
}

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
      const legacyCacheMigration = collection.semanticRedundancy.legacyCacheMigration;
      const semanticStatus = {
        status: collection.semanticRedundancy.settings.enabled ? "not-ready" : "disabled",
        publicationStatus: collection.semanticRedundancy.settings.enabled
          ? "not-ready"
          : "disabled",
      } as const;
      return c.json({
        ...settings,
        ...(result ? { migrationNotice: result.migrationNotice } : {}),
        semantic: {
          settings: collection.semanticRedundancy.settings,
          status: semanticStatus,
          migrationNotice:
            legacyCacheMigration == null
              ? null
              : {
                  kind: legacyCacheMigration.kind,
                  discardedPairCount: legacyCacheMigration.discardedPairCount,
                },
        },
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
      return c.json({ settings, cleanupPending: result.cleanupPending ?? false });
    } catch {
      return c.json({ error: "Semantic settings are unavailable" }, 503);
    }
  });

  // The manifest protocol has been retired. The aggregate Run status below is
  // the supported read surface; Run mutations use the direct controller routes.
  // Keep the existing settings/publication summary until its CLI consumer moves
  // to the aggregate refresh-status contract.
  routes.get("/redundancy/semantic/summary", async (c) => {
    try {
      const collection = await storageService.loadCollection();
      const state = collection.semanticRedundancy;
      const publicationStatus = state.settings.enabled ? "not-ready" : "disabled";
      return c.json({
        settings: state.settings,
        status: publicationStatus,
        generation: null,
        disclosure: null,
      });
    } catch {
      return c.json({ error: "Semantic summary is unavailable" }, 503);
    }
  });

  routes.get("/redundancy/semantic/refresh-status", async (c) => {
    c.header("Cache-Control", "no-store");
    if (!deps.jevStatusService) return c.json({ error: "Semantic status is unavailable" }, 503);
    try {
      return c.json(await deps.jevStatusService.read());
    } catch {
      return c.json({ error: "Semantic status is unavailable" }, 503);
    }
  });

  routes.get("/redundancy/semantic/refresh-progress", (c) => {
    c.header("Cache-Control", "no-store");
    if (!deps.jevRefreshProgressService)
      return c.json({ error: "Semantic progress is unavailable" }, 503);
    try {
      return c.json(deps.jevRefreshProgressService.read(), 200);
    } catch {
      return c.json({ error: "Semantic progress is unavailable" }, 503);
    }
  });

  const setRunNoStore = (c: Context) => c.header("Cache-Control", "no-store");
  const controllerError = (c: Context, status: number) => {
    if (status === 400) return c.json({ error: "Invalid Run preview request" }, 400);
    if (status === 404) return c.json({ error: "Run not found" }, 404);
    if (status === 409) return c.json({ error: "Run conflict" }, 409);
    if (status === 412) return c.json({ error: "Run precondition failed" }, 412);
    return c.json({ error: "Run is unavailable" }, 503);
  };
  const readStrictObject = async (
    c: Context,
    expectedKeys: readonly string[],
  ): Promise<Record<string, unknown> | null> => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return null;
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    const record = body as Record<string, unknown>;
    return Object.keys(record).length === expectedKeys.length &&
      expectedKeys.every((key) => Object.hasOwn(record, key))
      ? record
      : null;
  };

  routes.get("/redundancy/semantic/run-preview", async (c) => {
    setRunNoStore(c);
    const controller = deps.jevRunController;
    if (!controller) return c.json({ error: "Run is unavailable" }, 503);
    const parsedQuery = parseRunPreviewQuery(new URL(c.req.url).searchParams);
    if (!parsedQuery.ok) return c.json({ error: "Invalid Run preview request" }, 400);
    try {
      const scope = new URL(c.req.url).searchParams.get("scope");
      const result =
        scope === "wishlist"
          ? await controller.previewWishlist(parsedQuery.value.selection, parsedQuery.value.budget)
          : await controller.preview(parsedQuery.value.budget);
      if (result.status === 200) return c.json(result.body, 200);
      return controllerError(c, result.status);
    } catch {
      return c.json({ error: "Run is unavailable" }, 503);
    }
  });

  routes.post("/redundancy/semantic/run", async (c) => {
    setRunNoStore(c);
    const body = await readStrictObject(c, [
      "requestId",
      "precondition",
      "noteTransmissionAuthorized",
    ]);
    if (
      !body ||
      typeof body.requestId !== "string" ||
      body.requestId.length === 0 ||
      body.requestId.length > 100 ||
      typeof body.precondition !== "string" ||
      body.precondition.length === 0 ||
      body.precondition.length > 256 ||
      typeof body.noteTransmissionAuthorized !== "boolean"
    )
      return c.json({ error: "Invalid Run request" }, 400);
    const controller = deps.jevRunController;
    if (!controller) return c.json({ error: "Run is unavailable" }, 503);
    try {
      const result = await controller.start({
        requestId: body.requestId,
        precondition: body.precondition,
        noteTransmissionAuthorized: body.noteTransmissionAuthorized,
      });
      if (result.status === 200) return c.json(result.body, 202);
      return controllerError(c, result.status);
    } catch {
      return c.json({ error: "Run is unavailable" }, 503);
    }
  });

  routes.post("/redundancy/semantic/cancel", async (c) => {
    setRunNoStore(c);
    const body = await readStrictObject(c, ["runId"]);
    if (
      !body ||
      typeof body.runId !== "string" ||
      body.runId.length === 0 ||
      body.runId.length > 100
    )
      return c.json({ error: "Invalid cancellation request" }, 400);
    const controller = deps.jevRunController;
    if (!controller) return c.json({ error: "Run is unavailable" }, 503);
    try {
      const result = controller.cancel({ runId: body.runId });
      if (result.status === 200) return c.json(result.body, 202);
      return controllerError(c, result.status === 404 ? 409 : result.status);
    } catch {
      return c.json({ error: "Run is unavailable" }, 503);
    }
  });

  routes.post("/redundancy/semantic/publication/retry", async (c) => {
    setRunNoStore(c);
    const body = await readStrictObject(c, ["runId"]);
    if (
      !body ||
      typeof body.runId !== "string" ||
      body.runId.length === 0 ||
      body.runId.length > 100
    )
      return c.json({ error: "Invalid publication retry request" }, 400);
    const controller = deps.jevRunController;
    if (!controller) return c.json({ error: "Run is unavailable" }, 503);
    const result = await controller.retryPublication({ runId: body.runId });
    if (result.status === 200) return c.json(result.body, 200);
    return controllerError(c, result.status);
  });

  routes.get("/redundancy/semantic/active-run", (c) => {
    setRunNoStore(c);
    const controller = deps.jevRunController;
    if (!controller) return c.json({ error: "Run is unavailable" }, 503);
    try {
      return c.json(controller.activeRun(), 200);
    } catch {
      return c.json({ error: "Run is unavailable" }, 503);
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
      operationId: "shelf.redundancy.get-semantic-summary",
      name: "get-semantic-summary",
      description: "Get safe semantic redundancy settings and publication summary",
      invocation: { method: "GET", path: "/api/redundancy/semantic/summary" },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.get-semantic-refresh-status",
      name: "get-semantic-refresh-status",
      description: "Get aggregate semantic coverage and historical Jev Run progress",
      invocation: { method: "GET", path: "/api/redundancy/semantic/refresh-status" },
      response: {
        body: {
          type: "object",
          properties: {
            status: {
              enum: [
                "disabled",
                "factual",
                "not-ready",
                "stale",
                "partial",
                "ready",
                "unavailable",
              ],
            },
            measurement: {
              enum: ["current", "not-applicable", "cache-unavailable", "source-unavailable"],
            },
            eligibleGameCount: { type: ["number", "null"] },
            pairCount: { type: ["number", "null"] },
            coverage: { type: ["object", "null"] },
            progress: {
              oneOf: [
                { type: "null" },
                {
                  type: "object",
                  properties: {
                    state: { enum: ["last-known-running", "completed", "interrupted", "failed"] },
                    scope: { enum: ["collection", "wishlist"] },
                    pairCount: { type: "integer" },
                    completedPairs: { type: "integer" },
                    cacheHits: { type: "integer" },
                    cacheMisses: { type: "integer" },
                    failedPairs: { type: "integer" },
                    stopReason: { type: "string" },
                  },
                  required: [
                    "state",
                    "pairCount",
                    "completedPairs",
                    "cacheHits",
                    "cacheMisses",
                    "failedPairs",
                  ],
                  additionalProperties: false,
                },
              ],
            },
          },
          required: [
            "status",
            "measurement",
            "eligibleGameCount",
            "pairCount",
            "coverage",
            "progress",
          ],
          additionalProperties: false,
        },
      },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.get-semantic-refresh-progress",
      name: "get-semantic-refresh-progress",
      description:
        "Get process activity and saved semantic Run progress without measuring coverage",
      invocation: { method: "GET", path: "/api/redundancy/semantic/refresh-progress" },
      response: {
        body: {
          type: "object",
          properties: {
            coverageMeasurement: { const: "not-measured" },
            activity: {
              oneOf: [
                {
                  type: "object",
                  properties: { state: { const: "active" }, runId: { type: "string" } },
                  required: ["state", "runId"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: { state: { enum: ["idle", "unavailable"] } },
                  required: ["state"],
                  additionalProperties: false,
                },
              ],
            },
            progress: JEV_REFRESH_PROGRESS_ENTRY_SCHEMA,
          },
          required: ["coverageMeasurement", "activity", "progress"],
          additionalProperties: false,
        },
      },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.get-semantic-run-preview",
      name: "get-semantic-run-preview",
      description: "Preview aggregate Jev Run scope without provider work",
      invocation: { method: "GET", path: "/api/redundancy/semantic/run-preview" },
      response: {
        body: {
          type: "object",
          properties: {
            requestId: { type: "string" },
            precondition: { type: "string" },
            provider: { const: "TypeSafe" },
            modelId: { type: "string" },
            eligibleGameCount: { type: "integer" },
            pairCount: { type: "integer" },
            descriptionBearingPairCount: { type: "integer" },
            noteBearingPairCount: { type: "integer" },
            noteTransmissionPermitted: { type: "boolean" },
            providerConfigured: { type: "boolean" },
            signalScope: {
              type: "object",
              properties: { description: { type: "boolean" }, ownerNotes: { type: "boolean" } },
              required: ["description", "ownerNotes"],
              additionalProperties: false,
            },
            scoringEffect: { enum: ["integrated-fitness", "annotation-only"] },
            limits: {
              type: "object",
              properties: {
                maxEligiblePairs: { type: "integer" },
                maxProviderAttempts: { type: "integer" },
                maxRetriesPerEvaluation: { type: "integer" },
                maxRunDurationMs: { type: "integer" },
                reportedTokenStopThreshold: { type: "integer" },
                reportedTokenThresholdIsBilledCeiling: { const: false },
              },
              required: [
                "maxEligiblePairs",
                "maxProviderAttempts",
                "maxRetriesPerEvaluation",
                "maxRunDurationMs",
                "reportedTokenStopThreshold",
                "reportedTokenThresholdIsBilledCeiling",
              ],
              additionalProperties: false,
            },
            withinPairLimit: { type: "boolean" },
            expiresAt: { type: "string" },
            scope: {
              type: "object",
              properties: {
                scope: { const: "wishlist" },
                wishlistEntryCount: { type: "integer" },
                selectedCandidateCount: { type: "integer" },
                unselectedEntryCount: { type: "integer" },
                ownedOverlapCandidateCount: { type: "integer" },
                requestedCandidateCount: { type: "integer" },
                eligibleCandidateCount: { type: "integer" },
                unavailableCandidateCount: { type: "integer" },
                eligibleOwnedGameCount: { type: "integer" },
                comparisonPairCount: { type: "integer" },
                cachedHitPairCount: { type: "integer" },
                sendablePairCount: { type: "integer" },
              },
              required: [
                "scope",
                "wishlistEntryCount",
                "selectedCandidateCount",
                "unselectedEntryCount",
                "ownedOverlapCandidateCount",
                "requestedCandidateCount",
                "eligibleCandidateCount",
                "unavailableCandidateCount",
                "eligibleOwnedGameCount",
                "comparisonPairCount",
                "cachedHitPairCount",
                "sendablePairCount",
              ],
              additionalProperties: false,
            },
            selection: {
              oneOf: [
                {
                  type: "object",
                  properties: { kind: { const: "all" } },
                  required: ["kind"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    kind: { const: "selected" },
                    bggIds: {
                      type: "array",
                      items: { type: "integer", minimum: 1 },
                      minItems: 1,
                      uniqueItems: true,
                    },
                  },
                  required: ["kind", "bggIds"],
                  additionalProperties: false,
                },
              ],
            },
            unavailableCandidateBggIds: { type: "array", items: { type: "integer" } },
          },
          required: [
            "requestId",
            "precondition",
            "provider",
            "modelId",
            "eligibleGameCount",
            "pairCount",
            "descriptionBearingPairCount",
            "noteBearingPairCount",
            "noteTransmissionPermitted",
            "providerConfigured",
            "signalScope",
            "scoringEffect",
            "limits",
            "withinPairLimit",
            "expiresAt",
          ],
          additionalProperties: false,
        },
      },
      hierarchy: { root: "shelf", feature: "redundancy" },
      parameters: [
        {
          name: "scope",
          in: "query",
          description: "Optional run scope; omission preserves the collection default.",
          required: false,
          acceptedValues: ["collection", "wishlist"],
        },
        {
          name: "bggId",
          in: "query",
          description:
            "Repeat for exact selected wishlist candidates; requires scope=wishlist. Omission selects all.",
          required: false,
        },
        ...(["maxProviderAttempts", "reportedTokenStopThreshold", "maxRunDurationMs"] as const).map(
          (name) => ({
            name,
            in: "query" as const,
            description: "Optional validated run budget override.",
            required: false,
          }),
        ),
      ],
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.start-semantic-run",
      name: "start-semantic-run",
      description: "Start a prepared Jev Run with per-run note transmission authorization",
      invocation: { method: "POST", path: "/api/redundancy/semantic/run" },
      request: {
        body: {
          type: "object",
          properties: {
            requestId: { type: "string", minLength: 1, maxLength: 100 },
            precondition: { type: "string", minLength: 1, maxLength: 256 },
            noteTransmissionAuthorized: { type: "boolean" },
          },
          required: ["requestId", "precondition", "noteTransmissionAuthorized"],
          additionalProperties: false,
        },
      },
      response: {
        body: {
          type: "object",
          properties: { state: { const: "started" }, runId: { type: "string" } },
          required: ["state", "runId"],
          additionalProperties: false,
        },
      },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.cancel-semantic-run",
      name: "cancel-semantic-run",
      description: "Request cancellation of the specified active Jev Run",
      invocation: { method: "POST", path: "/api/redundancy/semantic/cancel" },
      request: {
        body: {
          type: "object",
          properties: { runId: { type: "string", minLength: 1, maxLength: 100 } },
          required: ["runId"],
          additionalProperties: false,
        },
      },
      response: {
        body: {
          type: "object",
          properties: { state: { const: "cancellation-requested" } },
          required: ["state"],
          additionalProperties: false,
        },
      },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.retry-semantic-publication",
      name: "retry-semantic-publication",
      description: "Retry provider-free publication of a sealed Jev Run outcome",
      invocation: { method: "POST", path: "/api/redundancy/semantic/publication/retry" },
      request: {
        body: {
          type: "object",
          properties: { runId: { type: "string", minLength: 1, maxLength: 100 } },
          required: ["runId"],
          additionalProperties: false,
        },
      },
      response: {
        body: {
          type: "object",
          properties: {
            runId: { type: "string" },
            state: { enum: ["completed", "interrupted", "failed"] },
            publication: {
              type: "object",
              properties: {
                state: { enum: ["published", "unchanged", "pending"] },
                phase: { enum: ["seal", "validate", "promote"] },
                outcomePersistence: { enum: ["sealed", "finalized", "unpersisted"] },
              },
              required: ["state", "outcomePersistence"],
            },
          },
          required: ["runId", "state", "publication"],
        },
      },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
    {
      operationId: "shelf.redundancy.get-active-semantic-run",
      name: "get-active-semantic-run",
      description: "Get the active Jev Run identifier if one exists",
      invocation: { method: "GET", path: "/api/redundancy/semantic/active-run" },
      response: {
        body: {
          oneOf: [
            { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
            { type: "null" },
          ],
        },
      },
      hierarchy: { root: "shelf", feature: "redundancy" },
      idempotent: true,
    },
  ];

  return { routes, operations };
}
