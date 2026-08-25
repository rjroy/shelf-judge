import { Hono } from "hono";
import {
  AXIS_VALIDATION_CODES,
  CodedAxisValidationError,
  CreateAxisSchema,
  UpdateAxisSchema,
  LegacyAxisRepairSchema,
  NotFoundError,
  toErrorMessage,
  type AxisValidationCode,
  type AxisValidationDetail,
} from "@shelf-judge/shared";
import type { AxisService } from "../services/axis-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";

export interface AxisRoutesDeps {
  axisService: AxisService;
}

interface AxisErrorBody {
  error: string;
  message: string;
  code: AxisValidationCode;
  details: readonly AxisValidationDetail[];
}

const invalidJsonBody: AxisErrorBody = {
  error: "Validation failed",
  message: "Invalid JSON body",
  code: AXIS_VALIDATION_CODES.INVALID_AXIS_PAYLOAD,
  details: [{ field: "body", path: [] }],
};

function codedErrorBody(error: CodedAxisValidationError): AxisErrorBody {
  return {
    error: "Validation failed",
    message: error.message,
    code: error.code,
    details: error.details,
  };
}

export function createAxisRoutes(deps: AxisRoutesDeps): RouteModule {
  const { axisService } = deps;
  const routes = new Hono();

  routes.post("/axes", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(invalidJsonBody, 400);
    }
    try {
      const axis = await axisService.createAxis(body);
      return c.json(axis, 201);
    } catch (error) {
      if (error instanceof CodedAxisValidationError) return c.json(codedErrorBody(error), 400);
      return c.json({ error: toErrorMessage(error) }, 500);
    }
  });

  routes.get("/axes", async (c) => {
    try {
      return c.json(await axisService.listAxes());
    } catch (error) {
      return c.json({ error: toErrorMessage(error) }, 500);
    }
  });

  routes.get("/axes/derived-fields", (c) => c.json(axisService.getDerivedFields()));

  routes.put("/axes/:id", async (c) => {
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(invalidJsonBody, 400);
    }
    try {
      return c.json(await axisService.updateAxis(id, body));
    } catch (error) {
      if (error instanceof NotFoundError) return c.json({ error: error.message }, 404);
      if (error instanceof CodedAxisValidationError) return c.json(codedErrorBody(error), 400);
      return c.json({ error: toErrorMessage(error) }, 500);
    }
  });

  routes.post("/axes/:id/repair", async (c) => {
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(invalidJsonBody, 400);
    }
    try {
      return c.json(await axisService.repairLegacyAxis(id, body));
    } catch (error) {
      if (error instanceof NotFoundError) return c.json({ error: error.message }, 404);
      if (error instanceof CodedAxisValidationError) return c.json(codedErrorBody(error), 400);
      return c.json({ error: toErrorMessage(error) }, 500);
    }
  });

  routes.delete("/axes/:id", async (c) => {
    const id = c.req.param("id");
    try {
      return c.json(await axisService.deleteAxis(id));
    } catch (error) {
      if (error instanceof NotFoundError) return c.json({ error: error.message }, 404);
      if (error instanceof CodedAxisValidationError) return c.json(codedErrorBody(error), 400);
      return c.json({ error: toErrorMessage(error) }, 500);
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.axis.create",
      name: "create",
      description: "Create a personal or registry-backed derived rating axis",
      invocation: { method: "POST", path: "/api/axes" },
      requestSchema: CreateAxisSchema,
      hierarchy: { root: "shelf", feature: "axis" },
      idempotent: false,
    },
    {
      operationId: "shelf.axis.list",
      name: "list",
      description: "List enabled and disabled axes with weights",
      invocation: { method: "GET", path: "/api/axes" },
      hierarchy: { root: "shelf", feature: "axis" },
      idempotent: true,
    },
    {
      operationId: "shelf.axis.derived-fields",
      name: "derived-fields",
      description: "Discover versioned registry-backed derived axis fields and templates",
      invocation: { method: "GET", path: "/api/axes/derived-fields" },
      hierarchy: { root: "shelf", feature: "axis" },
      idempotent: true,
    },
    {
      operationId: "shelf.axis.update",
      name: "update",
      description: "Update axis settings without changing its source or derived field",
      invocation: { method: "PUT", path: "/api/axes/:id" },
      requestSchema: UpdateAxisSchema,
      hierarchy: { root: "shelf", feature: "axis" },
      parameters: [{ name: "id", in: "path", description: "Axis ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.axis.repair",
      name: "repair",
      description: "Repair a disabled legacy axis as a registered derived axis",
      invocation: { method: "POST", path: "/api/axes/:id/repair" },
      requestSchema: LegacyAxisRepairSchema,
      hierarchy: { root: "shelf", feature: "axis" },
      parameters: [{ name: "id", in: "path", description: "Axis ID", required: true }],
      idempotent: false,
    },
    {
      operationId: "shelf.axis.delete",
      name: "delete",
      description: "Delete a non-tournament axis and its ratings",
      invocation: { method: "DELETE", path: "/api/axes/:id" },
      hierarchy: { root: "shelf", feature: "axis" },
      parameters: [{ name: "id", in: "path", description: "Axis ID", required: true }],
      idempotent: false,
    },
  ];

  return { routes, operations };
}
