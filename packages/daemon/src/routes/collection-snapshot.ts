import { Hono } from "hono";
import { toErrorMessage } from "@shelf-judge/shared";
import type { RouteModule } from "../operations.js";
import { CollectionSnapshotUnavailableError } from "../services/collection-snapshot-service.js";
import type { CollectionSnapshotCacheService } from "../services/collection-snapshot-cache-service.js";
import { createLogger } from "../services/logger.js";

export function createCollectionSnapshotRoutes(
  service: CollectionSnapshotCacheService,
): RouteModule {
  const logger = createLogger("collection-snapshot-route");
  const routes = new Hono();
  routes.get("/collection/snapshot", async (c) => {
    logger.log("collection snapshot request attempt", {
      method: "GET",
      path: "/collection/snapshot",
    });
    try {
      const decision = await service.resolve(c.req.header("if-none-match"));
      if (decision.cacheable) {
        c.header("Cache-Control", "private, no-cache");
        c.header("ETag", decision.etag!);
      } else {
        c.header("Cache-Control", "no-store");
      }
      logger.log("collection snapshot request completed", {
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
        status,
        outcome: "failed",
        error: toErrorMessage(error),
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
