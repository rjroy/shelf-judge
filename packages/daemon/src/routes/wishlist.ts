import { Hono } from "hono";
import { toErrorMessage, type WishlistEntry, type WishlistEntryView } from "@shelf-judge/shared";
import type { WishlistService } from "../services/wishlist-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";

export interface WishlistRoutesDeps {
  wishlistService: WishlistService;
}

function publicEntry(entry: WishlistEntry): WishlistEntryView {
  const view = { ...entry };
  delete view.bggSource;
  return view;
}

export function createWishlistRoutes(deps: WishlistRoutesDeps): RouteModule {
  const { wishlistService } = deps;
  const routes = new Hono();

  // GET /wishlist
  routes.get("/wishlist", async (c) => {
    try {
      const entries = await wishlistService.list();
      // Sort by addedAt descending (newest first)
      entries.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
      return c.json(entries.map(publicEntry));
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // Explicit heavier read: unlike progress polling, this computes one current projection.
  routes.get("/wishlist/redundancy", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      const results = await wishlistService.listWithCurrentRedundancy();
      return c.json(
        results.map(({ entry, redundancy }) => ({
          entry: publicEntry(entry as WishlistEntry),
          redundancy,
        })),
      );
    } catch {
      return c.json({ error: "Wishlist redundancy projection is unavailable" }, 503);
    }
  });

  // POST /wishlist
  routes.post("/wishlist", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body !== "object" || body === null || !("bggId" in body)) {
      return c.json({ error: "Request body must include bggId" }, 400);
    }

    const bggId = body.bggId;
    if (typeof bggId !== "number" || !Number.isFinite(bggId) || bggId <= 0) {
      return c.json({ error: "bggId must be a positive number" }, 400);
    }

    try {
      const entry = await wishlistService.add(bggId);
      return c.json({ entry: publicEntry(entry) }, 201);
    } catch (err) {
      const message = toErrorMessage(err);
      if (
        message.includes("already on your wishlist") ||
        message.includes("already in your collection")
      ) {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: message }, 500);
    }
  });

  // DELETE /wishlist (clear all, must be before :id to avoid matching)
  routes.delete("/wishlist", async (c) => {
    try {
      const removed = await wishlistService.clear();
      return c.json({ removed });
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // POST /wishlist/refresh (refresh all, must be before :id/refresh)
  routes.post("/wishlist/refresh", async (c) => {
    try {
      const result = await wishlistService.refreshAll();
      return c.json(result);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // POST /wishlist/:id/refresh
  routes.post("/wishlist/:id/refresh", async (c) => {
    const id = c.req.param("id");
    try {
      const entry = await wishlistService.refresh(id);
      return c.json({ entry: publicEntry(entry) });
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // DELETE /wishlist/:id
  routes.delete("/wishlist/:id", async (c) => {
    const id = c.req.param("id");
    try {
      await wishlistService.remove(id);
      return c.json({ removed: true });
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
      operationId: "shelf.wishlist.list",
      name: "list",
      description: "List all wishlist entries",
      invocation: { method: "GET", path: "/api/wishlist" },
      hierarchy: { root: "shelf", feature: "wishlist" },
      idempotent: true,
    },
    {
      operationId: "shelf.wishlist.list-redundancy-projection",
      name: "list-redundancy-projection",
      description:
        "List safe wishlist entries with a separate current/saved/base redundancy projection; source text is omitted",
      invocation: { method: "GET", path: "/api/wishlist/redundancy" },
      response: {
        body: {
          type: "array",
          items: {
            type: "object",
            properties: {
              entry: {
                type: "object",
                description: "Public WishlistEntryView; excludes bggSource.",
              },
              redundancy: {
                type: "object",
                properties: {
                  source: { enum: ["current", "saved-factual", "base-prediction"] },
                  adjustment: { type: ["object", "null"] },
                  orderingScore: { type: ["number", "null"] },
                },
                required: ["source", "adjustment", "orderingScore"],
                additionalProperties: false,
              },
            },
            required: ["entry", "redundancy"],
            additionalProperties: false,
          },
        },
      },
      hierarchy: { root: "shelf", feature: "wishlist" },
      idempotent: true,
    },
    {
      operationId: "shelf.wishlist.add",
      name: "add",
      description: "Add a game to the wishlist by BGG ID",
      invocation: { method: "POST", path: "/api/wishlist" },
      hierarchy: { root: "shelf", feature: "wishlist" },
      idempotent: false,
    },
    {
      operationId: "shelf.wishlist.remove",
      name: "remove",
      description: "Remove a wishlist entry",
      invocation: { method: "DELETE", path: "/api/wishlist/:id" },
      hierarchy: { root: "shelf", feature: "wishlist" },
      parameters: [{ name: "id", in: "path", description: "Wishlist entry ID", required: true }],
      idempotent: false,
    },
    {
      operationId: "shelf.wishlist.clear",
      name: "clear",
      description: "Remove all wishlist entries",
      invocation: { method: "DELETE", path: "/api/wishlist" },
      hierarchy: { root: "shelf", feature: "wishlist" },
      idempotent: false,
    },
    {
      operationId: "shelf.wishlist.refresh",
      name: "refresh",
      description: "Refresh prediction for a single wishlist entry",
      invocation: { method: "POST", path: "/api/wishlist/:id/refresh" },
      hierarchy: { root: "shelf", feature: "wishlist" },
      parameters: [{ name: "id", in: "path", description: "Wishlist entry ID", required: true }],
      idempotent: false,
    },
    {
      operationId: "shelf.wishlist.refresh-all",
      name: "refresh-all",
      description: "Refresh predictions for all wishlist entries",
      invocation: { method: "POST", path: "/api/wishlist/refresh" },
      hierarchy: { root: "shelf", feature: "wishlist" },
      idempotent: false,
    },
  ];

  return { routes, operations };
}
