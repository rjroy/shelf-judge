import { Hono } from "hono";
import { toErrorMessage } from "@shelf-judge/shared";
import type { ShelfUnit } from "@shelf-judge/shared";
import type { RouteModule, OperationDefinition } from "../operations.js";
import type { ShelfService, ShelfInput } from "../services/shelf-service.js";
import { ShelfValidationError, ShelfNotFoundError } from "../services/shelf-service.js";

export interface ShelfRoutesDeps {
  shelfService: ShelfService;
}

export function createShelfRoutes(deps: ShelfRoutesDeps): RouteModule {
  const { shelfService } = deps;
  const routes = new Hono();

  // GET /shelf/config
  routes.get("/shelf/config", async (c) => {
    try {
      const config = await shelfService.getConfig();
      return c.json(config);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // PUT /shelf/config
  routes.put("/shelf/config", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "Request body must be a JSON object" }, 400);
    }

    const { units } = body as { units?: ShelfUnit[] };
    if (!Array.isArray(units)) {
      return c.json({ error: "units must be an array" }, 400);
    }

    try {
      const config = await shelfService.setConfig(units);
      return c.json(config);
    } catch (err) {
      if (err instanceof ShelfValidationError) {
        return c.json({ error: err.message }, 400);
      }
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // POST /shelf/units
  routes.post("/shelf/units", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "Request body must be a JSON object" }, 400);
    }

    const { name, shelves } = body as { name?: string; shelves?: ShelfInput[] };
    if (typeof name !== "string") {
      return c.json({ error: "name is required" }, 400);
    }
    if (!Array.isArray(shelves)) {
      return c.json({ error: "shelves must be an array" }, 400);
    }

    try {
      const unit = await shelfService.addUnit({ name, shelves });
      return c.json(unit, 201);
    } catch (err) {
      if (err instanceof ShelfValidationError) {
        return c.json({ error: err.message }, 400);
      }
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // PUT /shelf/units/:id
  routes.put("/shelf/units/:id", async (c) => {
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "Request body must be a JSON object" }, 400);
    }

    const { name, shelves } = body as { name?: string; shelves?: ShelfInput[] };

    try {
      const unit = await shelfService.updateUnit(id, { name, shelves });
      return c.json(unit);
    } catch (err) {
      if (err instanceof ShelfNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      if (err instanceof ShelfValidationError) {
        return c.json({ error: err.message }, 400);
      }
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // DELETE /shelf/units/:id
  routes.delete("/shelf/units/:id", async (c) => {
    const id = c.req.param("id");

    try {
      await shelfService.removeUnit(id);
      return c.json({ removed: true });
    } catch (err) {
      if (err instanceof ShelfNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.config.get",
      name: "get-config",
      description: "Get full shelf configuration",
      invocation: { method: "GET", path: "/api/shelf/config" },
      hierarchy: { root: "shelf", feature: "config" },
      idempotent: true,
    },
    {
      operationId: "shelf.config.set",
      name: "set-config",
      description: "Replace full shelf configuration",
      invocation: { method: "PUT", path: "/api/shelf/config" },
      hierarchy: { root: "shelf", feature: "config" },
      idempotent: true,
    },
    {
      operationId: "shelf.units.add",
      name: "add-unit",
      description: "Add a shelf unit",
      invocation: { method: "POST", path: "/api/shelf/units" },
      hierarchy: { root: "shelf", feature: "config" },
      idempotent: false,
    },
    {
      operationId: "shelf.units.update",
      name: "update-unit",
      description: "Update a shelf unit (name and shelves)",
      invocation: { method: "PUT", path: "/api/shelf/units/:id" },
      hierarchy: { root: "shelf", feature: "config" },
      parameters: [{ name: "id", in: "path", description: "Shelf unit ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.units.remove",
      name: "remove-unit",
      description: "Remove a shelf unit",
      invocation: { method: "DELETE", path: "/api/shelf/units/:id" },
      hierarchy: { root: "shelf", feature: "config" },
      parameters: [{ name: "id", in: "path", description: "Shelf unit ID", required: true }],
      idempotent: true,
    },
  ];

  return { routes, operations };
}
