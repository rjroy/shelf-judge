import { Hono } from "hono";
import { toErrorMessage } from "@shelf-judge/shared";
import type { NicheTagFilter } from "@shelf-judge/shared";
import type { StorageService } from "../services/storage-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";

export interface NicheRoutesDeps {
  storageService: StorageService;
}

const VALID_TYPES = new Set(["mechanic", "category", "family"]);

function isValidTagFilter(value: unknown): value is NicheTagFilter {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.type === "string" &&
    VALID_TYPES.has(obj.type) &&
    typeof obj.name === "string" &&
    obj.name.length > 0
  );
}

export function createNicheRoutes(deps: NicheRoutesDeps): RouteModule {
  const { storageService } = deps;
  const routes = new Hono();

  // GET /niches/settings
  routes.get("/niches/settings", async (c) => {
    try {
      const settings = await storageService.loadNicheSettings();
      return c.json(settings);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // PATCH /niches/settings
  routes.patch("/niches/settings", async (c) => {
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

    if ("ignoredTags" in patch) {
      if (!Array.isArray(patch.ignoredTags)) {
        return c.json({ error: "ignoredTags must be an array" }, 400);
      }
      for (const tag of patch.ignoredTags) {
        if (!isValidTagFilter(tag)) {
          return c.json(
            {
              error:
                'Each ignoredTag must have a "type" (mechanic|category|family) and a non-empty "name"',
            },
            400,
          );
        }
      }
    }

    try {
      const current = await storageService.loadNicheSettings();
      const updated = { ...current, ...patch };
      await storageService.saveNicheSettings(updated);
      return c.json(updated);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // POST /niches/settings/ignore
  routes.post("/niches/settings/ignore", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!isValidTagFilter(body)) {
      return c.json(
        {
          error: 'Body must have a "type" (mechanic|category|family) and a non-empty "name"',
        },
        400,
      );
    }

    try {
      const settings = await storageService.loadNicheSettings();
      const alreadyIgnored = settings.ignoredTags.some(
        (t) => t.type === body.type && t.name === body.name,
      );
      if (!alreadyIgnored) {
        settings.ignoredTags.push({ type: body.type, name: body.name });
        await storageService.saveNicheSettings(settings);
      }
      return c.json(settings);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // DELETE /niches/settings/ignore
  routes.delete("/niches/settings/ignore", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!isValidTagFilter(body)) {
      return c.json(
        {
          error: 'Body must have a "type" (mechanic|category|family) and a non-empty "name"',
        },
        400,
      );
    }

    try {
      const settings = await storageService.loadNicheSettings();
      settings.ignoredTags = settings.ignoredTags.filter(
        (t) => !(t.type === body.type && t.name === body.name),
      );
      await storageService.saveNicheSettings(settings);
      return c.json(settings);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.niche.get-settings",
      name: "get-settings",
      description: "Get niche filtering settings",
      invocation: { method: "GET", path: "/api/niches/settings" },
      hierarchy: { root: "shelf", feature: "niche" },
      idempotent: true,
    },
    {
      operationId: "shelf.niche.update-settings",
      name: "update-settings",
      description: "Update niche filtering settings",
      invocation: { method: "PATCH", path: "/api/niches/settings" },
      hierarchy: { root: "shelf", feature: "niche" },
      idempotent: true,
    },
    {
      operationId: "shelf.niche.ignore-tag",
      name: "ignore-tag",
      description: "Add a tag to the niche ignore list",
      invocation: { method: "POST", path: "/api/niches/settings/ignore" },
      hierarchy: { root: "shelf", feature: "niche" },
      idempotent: true,
    },
    {
      operationId: "shelf.niche.unignore-tag",
      name: "unignore-tag",
      description: "Remove a tag from the niche ignore list",
      invocation: { method: "DELETE", path: "/api/niches/settings/ignore" },
      hierarchy: { root: "shelf", feature: "niche" },
      idempotent: true,
    },
  ];

  return { routes, operations };
}
