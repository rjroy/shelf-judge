import { Hono } from "hono";
import { EntertainmentBenchmarkMutationRequestSchema } from "@shelf-judge/shared";
import {
  UNSAFE_STORED_AMOUNT_SCHEMA,
  type RouteModule,
  type OperationDefinition,
} from "../operations.js";
import {
  PurchaseUtilizationValidationError,
  type PurchaseUtilizationService,
} from "../services/purchase-utilization-service.js";
import { createLogger, type Logger } from "../services/logger.js";

const COLLECTION_BOUNDARY_ID = "collection";
const INTERNAL_ERROR_RESPONSE = { error: "Internal server error", code: "internal_error" } as const;

export interface CollectionRoutesDeps {
  purchaseUtilizationService: PurchaseUtilizationService;
  logger?: Logger;
}

export function createCollectionRoutes(deps: CollectionRoutesDeps): RouteModule {
  const { purchaseUtilizationService } = deps;
  const logger = deps.logger ?? createLogger("purchase-utilization-routes");
  const routes = new Hono();

  routes.get("/collection/entertainment-benchmark", async (c) => {
    try {
      const entertainmentBenchmark = await purchaseUtilizationService.getEntertainmentBenchmark();
      return c.json({ entertainmentBenchmark });
    } catch {
      return c.json(INTERNAL_ERROR_RESPONSE, 500);
    }
  });

  routes.put("/collection/entertainment-benchmark", async (c) => {
    const changedFields = ["entertainmentBenchmark"];
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      logger.log("benchmark HTTP mutation attempt", {
        collectionId: COLLECTION_BOUNDARY_ID,
        requestedState: "configured",
        changedFields,
      });
      logger.warn("benchmark HTTP mutation rejected", {
        collectionId: COLLECTION_BOUNDARY_ID,
        requestedState: "configured",
        changedFields,
        outcome: "rejected",
        validationCode: "invalid_json",
      });
      return c.json({ error: "Invalid JSON body", code: "invalid_json" }, 400);
    }
    logger.log("benchmark HTTP mutation attempt", {
      collectionId: COLLECTION_BOUNDARY_ID,
      requestedState: "configured",
      changedFields,
    });
    const parsed = EntertainmentBenchmarkMutationRequestSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("benchmark HTTP mutation rejected", {
        collectionId: COLLECTION_BOUNDARY_ID,
        requestedState: "configured",
        changedFields,
        outcome: "rejected",
        validationCode: "invalid_benchmark_request",
      });
      return c.json(
        {
          error: "Validation failed",
          code: "invalid_benchmark_request",
          details: parsed.error.issues,
        },
        400,
      );
    }
    try {
      const entertainmentBenchmark = await purchaseUtilizationService.setEntertainmentBenchmark(
        parsed.data,
      );
      return c.json({ entertainmentBenchmark });
    } catch (error) {
      if (error instanceof PurchaseUtilizationValidationError) {
        return c.json({ error: error.message, code: error.code, details: error.details }, 400);
      }
      logger.error("benchmark HTTP mutation failed", {
        collectionId: COLLECTION_BOUNDARY_ID,
        requestedState: "configured",
        changedFields,
        outcome: "failed",
        validationCode: "persistence_failed",
      });
      return c.json(INTERNAL_ERROR_RESPONSE, 500);
    }
  });

  routes.delete("/collection/entertainment-benchmark", async (c) => {
    const changedFields = ["entertainmentBenchmark"];
    logger.log("benchmark HTTP mutation attempt", {
      collectionId: COLLECTION_BOUNDARY_ID,
      requestedState: "unknown",
      changedFields,
    });
    try {
      const entertainmentBenchmark = await purchaseUtilizationService.clearEntertainmentBenchmark();
      logger.log("benchmark HTTP mutation completed", {
        collectionId: COLLECTION_BOUNDARY_ID,
        requestedState: "unknown",
        changedFields,
        outcome: "completed",
      });
      return c.json({ entertainmentBenchmark });
    } catch {
      logger.error("benchmark HTTP mutation failed", {
        collectionId: COLLECTION_BOUNDARY_ID,
        requestedState: "unknown",
        changedFields,
        outcome: "failed",
        validationCode: "persistence_failed",
      });
      return c.json(INTERNAL_ERROR_RESPONSE, 500);
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.collection.get-entertainment-benchmark",
      name: "get-entertainment-benchmark",
      description: "Get the collection entertainment benchmark",
      invocation: { method: "GET", path: "/api/collection/entertainment-benchmark" },
      hierarchy: { root: "shelf", feature: "collection" },
      errors: [
        {
          status: 500,
          code: "internal_error",
          description: "Entertainment benchmark loading failed",
          response: INTERNAL_ERROR_RESPONSE,
        },
      ],
      idempotent: true,
    },
    {
      operationId: "shelf.collection.set-entertainment-benchmark",
      name: "set-entertainment-benchmark",
      description: "Set or correct the positive collection entertainment benchmark",
      invocation: { method: "PUT", path: "/api/collection/entertainment-benchmark" },
      requestSchema: EntertainmentBenchmarkMutationRequestSchema,
      request: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["amount"],
          properties: {
            amount: {
              type: "string",
              pattern: "^(?=.*[1-9])\\d+(?:\\.\\d{1,2})?$",
              not: UNSAFE_STORED_AMOUNT_SCHEMA,
              description:
                "Positive exact decimal amount, at most two fractional digits and safe when stored as hundredths",
            },
          },
        },
      },
      hierarchy: { root: "shelf", feature: "collection" },
      parameters: [
        {
          name: "body",
          in: "body",
          description: "Strict object containing a positive decimal amount string",
          required: true,
        },
      ],
      errors: [
        {
          status: 400,
          code: "invalid_json",
          description: "Request body is not valid JSON",
          response: { error: "Invalid JSON body", code: "invalid_json" },
        },
        {
          status: 400,
          code: "invalid_benchmark_request",
          description: "Request body does not contain a positive exact amount string",
          response: {
            error: "Validation failed",
            code: "invalid_benchmark_request",
            details: [],
          },
        },
        {
          status: 500,
          code: "internal_error",
          description: "Entertainment benchmark persistence failed",
          response: INTERNAL_ERROR_RESPONSE,
        },
      ],
      idempotent: true,
    },
    {
      operationId: "shelf.collection.clear-entertainment-benchmark",
      name: "clear-entertainment-benchmark",
      description: "Clear the collection entertainment benchmark to unknown",
      invocation: { method: "DELETE", path: "/api/collection/entertainment-benchmark" },
      hierarchy: { root: "shelf", feature: "collection" },
      errors: [
        {
          status: 500,
          code: "internal_error",
          description: "Entertainment benchmark clearing failed",
          response: INTERNAL_ERROR_RESPONSE,
        },
      ],
      idempotent: true,
    },
  ];

  return { routes, operations };
}
