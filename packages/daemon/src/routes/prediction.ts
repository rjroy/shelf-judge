import { Hono } from "hono";
import { createInitialEntityMetadata, toErrorMessage } from "@shelf-judge/shared";
import type { Game } from "@shelf-judge/shared";
import type { PredictionService } from "../services/prediction-service.js";
import type { StorageService } from "../services/storage-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";
import { projectPredictedGameResponse } from "../services/game-projection.js";
import { calculateBggFitnessPreview } from "../services/bgg-fitness-preview-service.js";

export interface PredictionRoutesDeps {
  predictionService: PredictionService;
  storageService?: StorageService;
}

function localOnlyUnverifiedGame(game: Game): Game {
  return {
    ...game,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    playCountEvidence: { status: "missing", source: "bgg-collection", observedAt: null },
    durationEvidence: { status: "missing", source: "bgg-thing", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "bgg-player-range", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "bgg-suggested-player-poll",
      observedAt: null,
    },
    entityMetadata: createInitialEntityMetadata(game.bggId),
    latestPlayCountCheck: null,
    acquisition: { state: "unknown" },
    bestPlayersInvalidEvidence: null,
    boxDimensions: null,
    manualShelfId: null,
    manualValues: { playingTime: null, playerCount: null },
    ratings: {},
  };
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
      const updated = await predictionService.updateSettings(body);
      return c.json(updated);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // GET /predictions/bgg/:bggId
  routes.get("/predictions/bgg/:bggId", async (c) => {
    const bggIdParam = c.req.param("bggId");
    const bggId = Number(bggIdParam);
    if (!Number.isSafeInteger(bggId) || bggId <= 0) {
      return c.json({ error: `Invalid BGG ID: ${bggIdParam}` }, 400);
    }
    try {
      const { result, nicheImpact, redundancyPreview } = await calculateBggFitnessPreview(
        predictionService,
        storageService,
        bggId,
        { signal: c.req.raw.signal },
      );

      const response = projectPredictedGameResponse({
        game:
          result.bggVerification?.status === "existing-local-unverified"
            ? localOnlyUnverifiedGame(result.game)
            : result.game,
        score: result.score,
        predictionUnavailable: result.predictionUnavailable,
        nicheImpact,
        redundancyPreview,
      });
      if (
        response.game.bggId !== bggId &&
        !(response.game.additionalBggIds ?? []).includes(bggId)
      ) {
        return c.json({ error: "Internal server error" }, 500);
      }
      return c.json({
        ...response,
        previewIdentity: result.previewIdentity,
        bggVerification: result.bggVerification,
      });
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
      if (message.includes("verification failed")) return c.json({ error: message }, 422);
      if (message.includes("Ambiguous collection match")) return c.json({ error: message }, 409);
      return c.json({ error: message }, 500);
    }
  });

  // GET /predictions/:gameId
  routes.get("/predictions/:gameId", async (c) => {
    const gameId = c.req.param("gameId");
    try {
      const result = await predictionService.predictGame(gameId);
      const response = projectPredictedGameResponse({
        game: result.game,
        score: result.score,
        predictionUnavailable: result.predictionUnavailable,
        redundancyPreview: null,
      });
      if (response.game.id !== gameId) return c.json({ error: "Internal server error" }, 500);
      return c.json(response);
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
