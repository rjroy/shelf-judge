import { Hono } from "hono";
import { toErrorMessage } from "@shelf-judge/shared";
import type { PredictionService } from "../services/prediction-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";
import { computeNicheImpact } from "../services/niche-engine.js";

export interface PredictionRoutesDeps {
  predictionService: PredictionService;
}

export function createPredictionRoutes(deps: PredictionRoutesDeps): RouteModule {
  const { predictionService } = deps;
  const routes = new Hono();

  // GET /predictions/readiness (must be before :gameId to avoid matching "readiness" as a gameId)
  routes.get("/predictions/readiness", async (c) => {
    try {
      const readiness = await predictionService.getReadiness();
      return c.json(readiness);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // GET /predictions/settings
  routes.get("/predictions/settings", async (c) => {
    try {
      const settings = await predictionService.getSettings();
      return c.json(settings);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // PATCH /predictions/settings
  routes.patch("/predictions/settings", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "Request body must be a JSON object" }, 400);
    }

    try {
      const updated = await predictionService.updateSettings(
        body as Partial<Record<string, unknown>>,
      );
      return c.json(updated);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // GET /predictions/bgg/:bggId
  routes.get("/predictions/bgg/:bggId", async (c) => {
    const bggIdParam = c.req.param("bggId");
    const bggId = Number(bggIdParam);
    if (!Number.isFinite(bggId) || bggId <= 0) {
      return c.json({ error: `Invalid BGG ID: ${bggIdParam}` }, 400);
    }
    try {
      const result = await predictionService.predictBggGame(bggId);

      // Compute niche impact: how would this candidate affect the collection's niches?
      const allGames = await predictionService.listGamesWithPredictions();
      const nicheImpact = computeNicheImpact(allGames, result.game, result.score);

      return c.json({ ...result, nicheImpact });
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("No game found with BGG ID")) {
        return c.json({ error: message }, 404);
      }
      if (message.includes("not configured")) {
        return c.json({ error: message }, 503);
      }
      if (message.includes("Failed to parse") || message.includes("returned HTTP")) {
        return c.json({ error: message }, 422);
      }
      return c.json({ error: message }, 500);
    }
  });

  // GET /predictions/:gameId
  routes.get("/predictions/:gameId", async (c) => {
    const gameId = c.req.param("gameId");
    try {
      const result = await predictionService.predictGame(gameId);
      return c.json(result);
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      if (message.includes("no BGG data")) {
        return c.json({ error: message }, 422);
      }
      return c.json({ error: message }, 500);
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.prediction.predict",
      name: "predict",
      description: "Get predicted fitness score for a game",
      invocation: { method: "GET", path: "/api/predictions/:gameId" },
      hierarchy: { root: "shelf", feature: "prediction" },
      parameters: [{ name: "gameId", in: "path", description: "Game ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.prediction.predict-bgg",
      name: "predict-bgg",
      description: "Get predicted fitness score for a game by BGG ID (preview before adding)",
      invocation: { method: "GET", path: "/api/predictions/bgg/:bggId" },
      hierarchy: { root: "shelf", feature: "prediction" },
      parameters: [{ name: "bggId", in: "path", description: "BGG game ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.prediction.readiness",
      name: "readiness",
      description: "Get prediction readiness status",
      invocation: { method: "GET", path: "/api/predictions/readiness" },
      hierarchy: { root: "shelf", feature: "prediction" },
      idempotent: true,
    },
    {
      operationId: "shelf.prediction.get-settings",
      name: "get-settings",
      description: "Get prediction settings",
      invocation: { method: "GET", path: "/api/predictions/settings" },
      hierarchy: { root: "shelf", feature: "prediction" },
      idempotent: true,
    },
    {
      operationId: "shelf.prediction.update-settings",
      name: "update-settings",
      description: "Update prediction settings",
      invocation: { method: "PATCH", path: "/api/predictions/settings" },
      hierarchy: { root: "shelf", feature: "prediction" },
      idempotent: true,
    },
  ];

  return { routes, operations };
}
