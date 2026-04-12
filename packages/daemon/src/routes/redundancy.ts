import { Hono } from "hono";
import { toErrorMessage } from "@shelf-judge/shared";
import type { RedundancySettings } from "@shelf-judge/shared";
import type { StorageService } from "../services/storage-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";

export interface RedundancyRoutesDeps {
  storageService: StorageService;
}

const VALID_STAGES = new Set(["annotation", "integrated"]);

function validatePatch(patch: Record<string, unknown>): { error: string } | null {
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
    if (typeof v !== "number" || v < 0 || v > 1) {
      return { error: "similarityThreshold must be a number between 0.0 and 1.0" };
    }
  }

  if ("maxPenalty" in patch) {
    const v = patch.maxPenalty;
    if (typeof v !== "number" || v < 0.5 || v > 5.0) {
      return { error: "maxPenalty must be a number between 0.5 and 5.0" };
    }
  }

  if ("minNeighbors" in patch) {
    const v = patch.minNeighbors;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      return { error: "minNeighbors must be an integer >= 1" };
    }
  }

  if ("componentWeights" in patch) {
    const cw = patch.componentWeights;
    if (typeof cw !== "object" || cw === null || Array.isArray(cw)) {
      return { error: "componentWeights must be an object with binary, continuous, personalAxes" };
    }
    const obj = cw as Record<string, unknown>;
    for (const key of ["binary", "continuous", "personalAxes"]) {
      if (key in obj) {
        const v = obj[key];
        if (typeof v !== "number" || v < 0) {
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
  const routes = new Hono();

  // GET /redundancy/settings
  routes.get("/redundancy/settings", async (c) => {
    try {
      const settings = await storageService.loadRedundancySettings();
      return c.json(settings);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
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

    try {
      const current = await storageService.loadRedundancySettings();
      const updated: RedundancySettings = { ...current };

      if ("enabled" in patch) updated.enabled = patch.enabled as boolean;
      if ("stage" in patch) updated.stage = patch.stage as RedundancySettings["stage"];
      if ("similarityThreshold" in patch)
        updated.similarityThreshold = patch.similarityThreshold as number;
      if ("maxPenalty" in patch) updated.maxPenalty = patch.maxPenalty as number;
      if ("minNeighbors" in patch) updated.minNeighbors = patch.minNeighbors as number;
      if ("componentWeights" in patch) {
        const cw = patch.componentWeights as Record<string, unknown>;
        updated.componentWeights = {
          binary: typeof cw.binary === "number" ? cw.binary : current.componentWeights.binary,
          continuous:
            typeof cw.continuous === "number" ? cw.continuous : current.componentWeights.continuous,
          personalAxes:
            typeof cw.personalAxes === "number"
              ? cw.personalAxes
              : current.componentWeights.personalAxes,
        };
      }

      // Post-merge validation: componentWeights sum > 0
      const { binary, continuous, personalAxes } = updated.componentWeights;
      if (binary + continuous + personalAxes === 0) {
        return c.json({ error: "componentWeights sum must be greater than 0" }, 400);
      }

      await storageService.saveRedundancySettings(updated);
      return c.json(updated);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
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
  ];

  return { routes, operations };
}
