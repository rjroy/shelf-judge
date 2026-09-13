import {
  GroundedProviderConfigurationStatusSchema,
  type GroundedProviderConfigurationStatus,
} from "@shelf-judge/shared";
import { Hono } from "hono";
import type { OperationDefinition, RouteModule } from "../operations.js";

export function createGroundedAnalysisRoutes(options: {
  configurationStatus: GroundedProviderConfigurationStatus;
}): RouteModule {
  const configurationStatus = GroundedProviderConfigurationStatusSchema.parse(
    structuredClone(options.configurationStatus),
  );
  const routes = new Hono();

  routes.get("/grounded-analysis/configuration", (context) => context.json(configurationStatus));

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.grounded-analysis.configuration.get",
      name: "get",
      description: "Inspect the non-secret grounded-analysis provider configuration status",
      invocation: { method: "GET", path: "/api/grounded-analysis/configuration" },
      response: {
        body: {
          oneOf: [
            {
              type: "object",
              required: ["status", "identity"],
              additionalProperties: false,
              properties: {
                status: { const: "configured" },
                identity: {
                  type: "object",
                  required: ["providerId", "modelId", "extensionIds"],
                  additionalProperties: false,
                  properties: {
                    providerId: { type: "string" },
                    modelId: { type: "string" },
                    extensionIds: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
            {
              type: "object",
              required: ["status", "reason", "correctionDestination"],
              additionalProperties: false,
              properties: {
                status: { const: "unavailable" },
                reason: { type: "string" },
                safeDetail: { type: "string" },
                correctionDestination: {
                  type: "object",
                  required: ["operationId"],
                  additionalProperties: false,
                  properties: {
                    operationId: { const: "shelf.grounded-analysis.configuration.get" },
                  },
                },
              },
            },
          ],
        },
      },
      hierarchy: { root: "shelf", feature: "grounded-analysis" },
      idempotent: true,
    },
  ];

  return { routes, operations };
}
