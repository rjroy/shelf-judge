import { Hono, type Context } from "hono";
import type { RedundancySettings } from "@shelf-judge/shared";
import { DurableSourcePostCommitError, type StorageService } from "../services/storage-service.js";
import type { AttentionMutationImpact } from "../services/attention-candidate-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";
import type { SemanticRedundancySettings } from "@shelf-judge/shared";
import type { SemanticRefreshRuntime } from "../services/semantic-refresh-runtime.js";
import type { SemanticRedundancyStateService } from "../services/semantic-redundancy-state-service.js";
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
      const semanticStatus = {
        status: collection.semanticRedundancy.settings.enabled ? "not-ready" : "disabled",
        publicationStatus: collection.semanticRedundancy.settings.enabled
          ? "not-ready"
          : "disabled",
      } as const;
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

  // Legacy capture/page/acknowledge/worker endpoints are quarantined until the
  // v10 SQLite-backed explicit Run flow is implemented. Do not consult state or runtime.
  const unavailable = (c: Context) =>
    c.json({ error: "Semantic inference is unavailable during the v10 cache cutover" }, 503);
  routes.post("/redundancy/semantic/disclosure", unavailable);

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

  routes.post("/redundancy/semantic/disclosure/page", unavailable);

  routes.post("/redundancy/semantic/acknowledge-and-start", unavailable);

  routes.get("/redundancy/semantic/refresh-status", (c) =>
    c.json({ status: "not-ready", publicationStatus: "not-ready" }),
  );

  routes.post("/redundancy/semantic/cancel", unavailable);

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
