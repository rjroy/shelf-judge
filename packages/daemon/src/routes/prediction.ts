import { Hono } from "hono";
import { toErrorMessage } from "@shelf-judge/shared";
import type { Game, GameWithScore, RedundancyAdjustment } from "@shelf-judge/shared";
import type { PredictionService } from "../services/prediction-service.js";
import type { StorageService } from "../services/storage-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";
import { computeNicheImpact } from "../services/niche-engine.js";
import { computeRedundancyAdjustments } from "../services/redundancy-engine.js";
import {
  buildVocabulary,
  computeContinuousRanges,
  encodeGame,
} from "../services/feature-vector.js";
import type { FeatureVector } from "../services/feature-vector.js";

export interface PredictionRoutesDeps {
  predictionService: PredictionService;
  storageService?: StorageService;
}

export function createPredictionRoutes(deps: PredictionRoutesDeps): RouteModule {
  const { predictionService, storageService } = deps;
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
        body,
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
      const nicheSettings = storageService ? await storageService.loadNicheSettings() : undefined;
      const allGames = await predictionService.listGamesWithPredictions();
      const nicheImpact = computeNicheImpact(allGames, result.game, result.score, nicheSettings);

      // Compute redundancy preview (REQ-REDUN-22): temporarily include the candidate
      // in the redundancy pass, extract its adjustment as preview.
      let redundancyPreview: RedundancyAdjustment | null = null;
      if (storageService) {
        const redundancySettings = await storageService.loadRedundancySettings();
        if (redundancySettings.enabled) {
          const collection = await storageService.loadCollection();
          const gamesWithBgg = collection.games.filter((g) => g.bggData);
          const vocabulary = buildVocabulary(gamesWithBgg);
          const ranges = computeContinuousRanges(gamesWithBgg);

          const vectorCache = new Map<string, FeatureVector>();
          const getFeatureVector = (game: Game): FeatureVector => {
            const cached = vectorCache.get(game.id);
            if (cached) return cached;
            const vec = encodeGame(game, vocabulary, game.ratings, ranges, collection.axes);
            vectorCache.set(game.id, vec);
            return vec;
          };

          // Create temporary GameWithScore for the candidate
          const candidateGws: GameWithScore = {
            game: result.game,
            score: result.score,
          };

          // Run full redundancy pass with candidate included.
          // Pre-redundancy scores are used for existing games (REQ-REDUN-23).
          const adjustments = computeRedundancyAdjustments(
            [...allGames, candidateGws],
            redundancySettings,
            getFeatureVector,
          );
          redundancyPreview = adjustments.get(result.game.id) ?? null;
        }
      }

      return c.json({ ...result, nicheImpact, redundancyPreview });
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
