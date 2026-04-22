import { Hono } from "hono";
import { toErrorMessage } from "@shelf-judge/shared";
import { z } from "zod";
import type { StorageService } from "../services/storage-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";

export interface ConfigRoutesDeps {
  storageService: StorageService;
}

const UpdateConfigSchema = z.object({
  bggAuthToken: z.string().nullable().optional(),
  username: z.string().optional(),
});

export function createConfigRoutes(deps: ConfigRoutesDeps): RouteModule {
  const { storageService } = deps;
  const routes = new Hono();

  // GET /config
  routes.get("/config", async (c) => {
    try {
      const config = await storageService.loadConfig();
      // Mask the token for security
      return c.json({
        ...config,
        bggAuthToken: config.bggAuthToken ? "***configured***" : null,
      });
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // PUT /config
  routes.put("/config", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = UpdateConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    try {
      const config = await storageService.loadConfig();

      if (parsed.data.bggAuthToken !== undefined) {
        config.bggAuthToken = parsed.data.bggAuthToken;
      }
      if (parsed.data.username !== undefined) {
        config.username = parsed.data.username;
      }

      await storageService.saveConfig(config);

      return c.json({
        ...config,
        bggAuthToken: config.bggAuthToken ? "***configured***" : null,
      });
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.config.get",
      name: "get",
      description: "Current configuration",
      invocation: { method: "GET", path: "/api/config" },
      hierarchy: { root: "shelf", feature: "config" },
      idempotent: true,
    },
    {
      operationId: "shelf.config.set",
      name: "set",
      description: "Update configuration",
      invocation: { method: "PUT", path: "/api/config" },
      hierarchy: { root: "shelf", feature: "config" },
      idempotent: true,
    },
  ];

  return { routes, operations };
}
