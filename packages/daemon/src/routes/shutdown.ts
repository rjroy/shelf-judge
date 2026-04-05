import { Hono } from "hono";
import type { RouteModule, OperationDefinition } from "../operations.js";

export interface ShutdownRoutesDeps {
  onShutdown: () => void;
}

export function createShutdownRoutes(deps: ShutdownRoutesDeps): RouteModule {
  const routes = new Hono();

  routes.post("/shutdown", (c) => {
    // Schedule shutdown after response is sent
    setTimeout(() => deps.onShutdown(), 100);
    return c.json({ shutting_down: true });
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.daemon.shutdown",
      name: "shutdown",
      description: "Shut down the daemon process",
      invocation: { method: "POST", path: "/api/shutdown" },
      hierarchy: { root: "shelf", feature: "daemon" },
      idempotent: false,
    },
  ];

  return { routes, operations };
}
