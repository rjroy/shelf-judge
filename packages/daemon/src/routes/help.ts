import { Hono } from "hono";
import {
  buildOperationTree,
  filterOperationsByFeature,
  type RouteModule,
  type OperationDefinition,
} from "../operations.js";

export interface HelpRoutesDeps {
  operations: OperationDefinition[];
}

export function createHelpRoutes(deps: HelpRoutesDeps): RouteModule {
  const { operations } = deps;
  const routes = new Hono();

  // GET /help
  routes.get("/help", (c) => {
    const tree = buildOperationTree(operations);
    return c.json(tree);
  });

  // GET /help/:feature
  routes.get("/help/:feature", (c) => {
    const feature = c.req.param("feature");
    const featureOps = filterOperationsByFeature(operations, feature);

    if (featureOps.length === 0) {
      return c.json({ error: `No operations found for feature: ${feature}` }, 404);
    }

    const tree = buildOperationTree(featureOps);
    return c.json(tree);
  });

  const helpOperations: OperationDefinition[] = [
    {
      operationId: "shelf.help",
      name: "help",
      description: "Operations registry (CLI discovery root)",
      invocation: { method: "GET", path: "/api/help" },
      hierarchy: { root: "shelf", feature: "help" },
      idempotent: true,
    },
    {
      operationId: "shelf.help.feature",
      name: "feature",
      description: "Operations for a feature subtree",
      invocation: { method: "GET", path: "/api/help/:feature" },
      hierarchy: { root: "shelf", feature: "help" },
      parameters: [{ name: "feature", in: "path", description: "Feature name", required: true }],
      idempotent: true,
    },
  ];

  return { routes, operations: helpOperations };
}
