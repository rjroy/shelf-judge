import { Hono } from "hono";
import { CreateAxisSchema, UpdateAxisSchema, toErrorMessage } from "@shelf-judge/shared";
import type { AxisService } from "../services/axis-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";

export interface AxisRoutesDeps {
  axisService: AxisService;
}

export function createAxisRoutes(deps: AxisRoutesDeps): RouteModule {
  const { axisService } = deps;
  const routes = new Hono();

  // POST /axes
  routes.post("/axes", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = CreateAxisSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    try {
      const axis = await axisService.createAxis(parsed.data);
      return c.json(axis, 201);
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("idealValue") || message.includes("outside native scale")) {
        return c.json({ error: message }, 400);
      }
      return c.json({ error: message }, 500);
    }
  });

  // GET /axes
  routes.get("/axes", async (c) => {
    try {
      const axes = await axisService.listAxes();
      return c.json(axes);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // PUT /axes/:id
  routes.put("/axes/:id", async (c) => {
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = UpdateAxisSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    try {
      const axis = await axisService.updateAxis(id, parsed.data);
      return c.json(axis);
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      if (message.includes("idealValue") || message.includes("outside native scale")) {
        return c.json({ error: message }, 400);
      }
      return c.json({ error: message }, 500);
    }
  });

  // DELETE /axes/:id
  routes.delete("/axes/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const result = await axisService.deleteAxis(id);
      return c.json({ deletedRatingsCount: result.deletedRatingsCount });
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.axis.create",
      name: "create",
      description: "Create a new rating axis with optional curve and veto configuration",
      invocation: { method: "POST", path: "/api/axes" },
      hierarchy: { root: "shelf", feature: "axis" },
      idempotent: false,
    },
    {
      operationId: "shelf.axis.list",
      name: "list",
      description: "List all axes with weights",
      invocation: { method: "GET", path: "/api/axes" },
      hierarchy: { root: "shelf", feature: "axis" },
      idempotent: true,
    },
    {
      operationId: "shelf.axis.update",
      name: "update",
      description: "Update axis name, description, weight, curve, or veto configuration",
      invocation: { method: "PUT", path: "/api/axes/:id" },
      hierarchy: { root: "shelf", feature: "axis" },
      parameters: [{ name: "id", in: "path", description: "Axis ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.axis.delete",
      name: "delete",
      description: "Delete an axis (removes all ratings on it)",
      invocation: { method: "DELETE", path: "/api/axes/:id" },
      hierarchy: { root: "shelf", feature: "axis" },
      parameters: [{ name: "id", in: "path", description: "Axis ID", required: true }],
      idempotent: false,
    },
  ];

  return { routes, operations };
}
