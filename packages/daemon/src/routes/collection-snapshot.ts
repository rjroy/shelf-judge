import { Hono } from "hono";
import { toErrorMessage } from "@shelf-judge/shared";
import type { RouteModule } from "../operations.js";
import { CollectionSnapshotUnavailableError } from "../services/collection-snapshot-service.js";
import type { CollectionSnapshotCacheService } from "../services/collection-snapshot-cache-service.js";
import { createLogger } from "../services/logger.js";
import { performance } from "node:perf_hooks";

let requestSequence = 0;

export function createCollectionSnapshotRoutes(
  service: CollectionSnapshotCacheService,
): RouteModule {
  const logger = createLogger("collection-snapshot-route");
  const routes = new Hono();
  routes.get("/collection/snapshot", async (c) => {
    const requestId = `collection-${++requestSequence}`;
    const startedAt = performance.now();
    logger.log("collection snapshot request attempt", {
      requestId,
      method: "GET",
      path: "/collection/snapshot",
    });
    try {
      const decision = await service.resolve(c.req.header("if-none-match"), requestId);
      if (decision.cacheable) {
        c.header("Cache-Control", "private, no-cache");
        c.header("ETag", decision.etag!);
      } else {
        c.header("Cache-Control", "no-store");
      }
      logger.log("collection snapshot request completed", {
        requestId,
        elapsedMs: Math.max(0, performance.now() - startedAt),
        status: decision.snapshotStatus ?? decision.status,
        gameCount: decision.gameCount ?? 0,
        httpStatus: decision.status,
        outcome: "success",
      });
      if (decision.status === 304) return c.body(null, 304);
      c.header("Content-Type", "application/json; charset=UTF-8");
      return c.body(decision.body ?? "", 200);
    } catch (error) {
      const status = error instanceof CollectionSnapshotUnavailableError ? 503 : 500;
      c.header("Cache-Control", "no-store");
      logger.error("collection snapshot request failed", {
        requestId,
        elapsedMs: Math.max(0, performance.now() - startedAt),
        status,
        outcome: "failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
      return c.json({ error: toErrorMessage(error) }, status);
    }
  });
  return {
    routes,
    operations: [
      {
        operationId: "collection.snapshot",
        name: "Get collection snapshot",
        description: "Get a coherent, validated collection display snapshot.",
        invocation: { method: "GET", path: "/api/collection/snapshot" },
        response: { body: { type: "object", description: "CollectionSnapshot" } },
        hierarchy: { root: "shelf", feature: "collection" },
        idempotent: true,
        errors: [
          {
            status: 503,
            code: "snapshot_unavailable",
            description: "Required captured sources changed or could not be loaded.",
            response: { error: "string" },
          },
        ],
      },
    ],
  };
}
