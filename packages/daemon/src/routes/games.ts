import { Hono, type Context } from "hono";
import { AddGameSchema, toErrorMessage } from "@shelf-judge/shared";
import type { Game, GameWithScore, RedundancySettings } from "@shelf-judge/shared";
import { z } from "zod";
import type { GameService } from "../services/game-service.js";
import type { BggClient } from "../services/bgg-client.js";
import type { PredictionService } from "../services/prediction-service.js";
import type { StorageService } from "../services/storage-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";
import { computeNichePositions } from "../services/niche-engine.js";
import { computeRedundancyAdjustments } from "../services/redundancy-engine.js";
import {
  buildVocabulary,
  computeContinuousRanges,
  encodeGame,
} from "../services/feature-vector.js";
import type { FeatureVector } from "../services/feature-vector.js";

import type { WishlistService } from "../services/wishlist-service.js";

export interface GameRoutesDeps {
  gameService: GameService;
  bggClient?: BggClient;
  predictionService?: PredictionService;
  storageService?: StorageService;
  wishlistService?: WishlistService;
}

const RatingsBodySchema = z.object({
  ratings: z.record(z.string(), z.number().int().min(1).max(10).nullable()),
});

const OwnershipBodySchema = z.object({
  ownership: z.enum(["owned", "previously-owned"]),
});

const BoxDimensionsSchema = z.object({
  width: z.number().gt(0).lte(40),
  height: z.number().gt(0).lte(40),
  depth: z.number().gt(0).lte(40),
});

const SetDimensionsBodySchema = z.union([
  BoxDimensionsSchema,
  z.object({ clear: z.literal(true) }),
]);

function isBggConfigured(bggClient?: BggClient): boolean {
  return bggClient !== undefined && bggClient.isConfigured();
}

function bggNotConfiguredResponse(c: Context) {
  return c.json(
    {
      error:
        "BGG integration is not configured. Register at https://boardgamegeek.com/using_the_xml_api and run `shelf-judge config set bgg-token YOUR_TOKEN`.",
    },
    503,
  );
}

/**
 * Build a getFeatureVector callback and apply redundancy adjustments to scored games.
 * Shared logic for GET /games and GET /games/:id.
 * Order: scores first, niches second (on pre-redundancy scores per REQ-REDUN-26),
 * redundancy third.
 *
 * When `universe` is provided, pairwise similarity and penalties are computed against
 * the universe (e.g. prediction-enriched games), but only `games` are annotated.
 * This ensures the same game gets the same penalty regardless of which route returns it.
 */
async function applyRedundancy(
  games: GameWithScore[],
  settings: RedundancySettings,
  storageService: StorageService,
  universe?: GameWithScore[],
): Promise<void> {
  if (!settings.enabled) return;

  const computeGames = universe ?? games;

  const collection = await storageService.loadCollection();
  const gamesWithBgg = collection.games.filter((g) => g.bggData);
  const vocabulary = buildVocabulary(gamesWithBgg);
  const ranges = computeContinuousRanges(gamesWithBgg);

  // Per-request feature vector cache (Open Question 1 from the plan)
  const vectorCache = new Map<string, FeatureVector>();
  const getFeatureVector = (game: Game): FeatureVector => {
    const cached = vectorCache.get(game.id);
    if (cached) return cached;
    const vec = encodeGame(game, vocabulary, game.ratings, ranges, collection.axes);
    vectorCache.set(game.id, vec);
    return vec;
  };

  const adjustments = computeRedundancyAdjustments(computeGames, settings, getFeatureVector);

  for (const gws of games) {
    if (!gws.score) continue;
    const adj = adjustments.get(gws.game.id) ?? null;
    gws.score.redundancyAdjustment = adj;
    if (adj && settings.stage === "integrated") {
      gws.score.score = adj.adjustedScore;
    }
  }
}

function filterByOwnership(games: GameWithScore[], ownership: string): GameWithScore[] {
  if (ownership === "all") return games;
  if (ownership === "previously-owned") {
    return games.filter((g) => g.game.ownership === "previously-owned");
  }
  // Default: "owned" (backward-compatible)
  return games.filter((g) => g.game.ownership !== "previously-owned");
}

export function createGameRoutes(deps: GameRoutesDeps): RouteModule {
  const { gameService, bggClient, predictionService, storageService, wishlistService } = deps;
  const routes = new Hono();

  // GET /games/search?q={query}
  routes.get("/games/search", async (c) => {
    const query = c.req.query("q");
    if (!query) {
      return c.json({ error: "Missing required query parameter: q" }, 400);
    }

    if (!isBggConfigured(bggClient)) {
      return bggNotConfiguredResponse(c);
    }

    try {
      const results = await gameService.searchGames(query);
      return c.json(results);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // POST /games
  routes.post("/games", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = AddGameSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    // If adding by bggId, check BGG is configured
    if (
      parsed.data.bggId !== null &&
      parsed.data.bggId !== undefined &&
      !isBggConfigured(bggClient)
    ) {
      return bggNotConfiguredResponse(c);
    }

    try {
      const result = await gameService.addGame(parsed.data);

      // REQ-WISH-10: auto-remove matching wishlist entry (fire-and-forget on error, not on completion)
      if (parsed.data.bggId && wishlistService) {
        await wishlistService.removeByBggId(parsed.data.bggId).catch(() => {});
      }

      return c.json(result, 201);
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("already exists")) {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: message }, 500);
    }
  });

  // GET /games
  routes.get("/games", async (c) => {
    try {
      const includePredicted = c.req.query("includePredicted") === "true";
      const includeNiches = c.req.query("includeNiches") === "true";
      const ownershipFilter = c.req.query("ownership") ?? "owned";

      if (includePredicted && predictionService) {
        const allGames = await predictionService.listGamesWithPredictions();

        // Owned-only set for niche/redundancy computation (REQ-PREV-19)
        const ownedGames = allGames.filter((g) => g.game.ownership !== "previously-owned");

        if (includeNiches) {
          const nicheSettings = storageService
            ? await storageService.loadNicheSettings()
            : undefined;
          const nicheMap = computeNichePositions(ownedGames, nicheSettings);
          for (const gws of allGames) {
            gws.nichePosition = nicheMap.get(gws.game.id) ?? null;
          }
        }
        // Redundancy: after niches (which use pre-redundancy scores per REQ-REDUN-26)
        if (storageService) {
          const redundancySettings = await storageService.loadRedundancySettings();
          await applyRedundancy(ownedGames, redundancySettings, storageService);
        }

        const response = filterByOwnership(allGames, ownershipFilter);
        return c.json(response);
      }

      const allGames = await gameService.listGames();

      // Owned-only set for niche/redundancy computation (REQ-PREV-19)
      const ownedGames = allGames.filter((g) => g.game.ownership !== "previously-owned");

      if (includeNiches && predictionService) {
        // Niche ranking needs predicted scores (REQ-NICHE-4), but the client
        // didn't ask for predicted games in the response. Compute niches from
        // the owned set with predictions, then attach positions to the response set.
        const nicheSettings = storageService ? await storageService.loadNicheSettings() : undefined;
        const ownedWithPredictions = (await predictionService.listGamesWithPredictions()).filter(
          (g) => g.game.ownership !== "previously-owned",
        );
        const nicheMap = computeNichePositions(ownedWithPredictions, nicheSettings);
        for (const gws of allGames) {
          gws.nichePosition = nicheMap.get(gws.game.id) ?? null;
        }
      }

      // Redundancy: after niches, computed against owned prediction-enriched universe
      if (storageService) {
        const redundancySettings = await storageService.loadRedundancySettings();
        const universe = predictionService
          ? (await predictionService.listGamesWithPredictions()).filter(
              (g) => g.game.ownership !== "previously-owned",
            )
          : undefined;
        await applyRedundancy(ownedGames, redundancySettings, storageService, universe);
      }

      const response = filterByOwnership(allGames, ownershipFilter);
      return c.json(response);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // GET /games/:id
  routes.get("/games/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const result = await gameService.getGame(id);

      // Compute niche position from owned-only set with predicted scores (REQ-PREV-19)
      if (predictionService) {
        const nicheSettings = storageService ? await storageService.loadNicheSettings() : undefined;
        const allGames = await predictionService.listGamesWithPredictions();
        const ownedGames = allGames.filter((g) => g.game.ownership !== "previously-owned");
        const nicheMap = computeNichePositions(ownedGames, nicheSettings);
        result.nichePosition = nicheMap.get(id) ?? null;
      } else {
        result.nichePosition = null;
      }

      // Redundancy: use owned prediction-enriched set (REQ-PREV-19)
      if (storageService) {
        const redundancySettings = await storageService.loadRedundancySettings();
        if (redundancySettings.enabled) {
          const allGames = predictionService
            ? await predictionService.listGamesWithPredictions()
            : await gameService.listGames();
          const ownedGames = allGames.filter((g) => g.game.ownership !== "previously-owned");
          await applyRedundancy(ownedGames, redundancySettings, storageService);
          const thisGame = ownedGames.find((g) => g.game.id === id);
          if (result.score && thisGame?.score) {
            result.score.redundancyAdjustment = thisGame.score.redundancyAdjustment;
            if (redundancySettings.stage === "integrated" && thisGame.score.redundancyAdjustment) {
              result.score.score = thisGame.score.redundancyAdjustment.adjustedScore;
            }
          }
        }
      }

      return c.json(result);
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // PUT /games/:id/ratings
  routes.put("/games/:id/ratings", async (c) => {
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = RatingsBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    try {
      const result = await gameService.rateGame(id, parsed.data.ratings);
      return c.json(result);
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      if (message.includes("must be an integer") || message.includes("Axis not found")) {
        return c.json({ error: message }, 400);
      }
      return c.json({ error: message }, 500);
    }
  });

  // DELETE /games/:id
  routes.delete("/games/:id", async (c) => {
    const id = c.req.param("id");
    try {
      await gameService.removeGame(id);
      return c.body(null, 204);
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // PATCH /games/:id/ownership
  routes.patch("/games/:id/ownership", async (c) => {
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: 'Invalid ownership status. Must be "owned" or "previously-owned"' },
        400,
      );
    }

    const parsed = OwnershipBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'Invalid ownership status. Must be "owned" or "previously-owned"' },
        400,
      );
    }

    try {
      const game = await gameService.setOwnership(id, parsed.data.ownership);
      return c.json({ game });
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // PUT /games/:id/dimensions
  routes.put("/games/:id/dimensions", async (c) => {
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = SetDimensionsBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    try {
      const dimensions = "clear" in parsed.data ? null : parsed.data;
      const game = await gameService.setBoxDimensions(id, dimensions);
      return c.json({ game });
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // POST /games/refresh - refresh all BGG data (must be before :id/refresh)
  routes.post("/games/refresh", async (c) => {
    if (!isBggConfigured(bggClient)) {
      return bggNotConfiguredResponse(c);
    }

    try {
      const summary = await gameService.refreshAllBggData();
      return c.json(summary);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // POST /games/:id/refresh
  routes.post("/games/:id/refresh", async (c) => {
    const id = c.req.param("id");

    if (!isBggConfigured(bggClient)) {
      return bggNotConfiguredResponse(c);
    }

    try {
      const game = await gameService.refreshBggData(id);
      return c.json({ game });
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
      operationId: "shelf.game.search",
      name: "search",
      description: "Search BGG for games by name",
      invocation: { method: "GET", path: "/api/games/search" },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [{ name: "q", in: "query", description: "Search query", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.game.add",
      name: "add",
      description: "Add a game (by BGG ID or manually)",
      invocation: { method: "POST", path: "/api/games" },
      hierarchy: { root: "shelf", feature: "game" },
      idempotent: false,
    },
    {
      operationId: "shelf.game.list",
      name: "list",
      description: "List all games with fitness scores",
      invocation: { method: "GET", path: "/api/games" },
      hierarchy: { root: "shelf", feature: "game" },
      idempotent: true,
    },
    {
      operationId: "shelf.game.get",
      name: "get",
      description: "Get a game with current fitness score",
      invocation: { method: "GET", path: "/api/games/:id" },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.game.rate",
      name: "rate",
      description: "Set ratings for a game on one or more axes",
      invocation: { method: "PUT", path: "/api/games/:id/ratings" },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.game.set-status",
      name: "set-status",
      description: "Change a game's ownership status",
      invocation: { method: "PATCH", path: "/api/games/:id/ownership" },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.game.dimensions",
      name: "set-dimensions",
      description: "Set or clear box dimensions for a game",
      invocation: { method: "PUT", path: "/api/games/:id/dimensions" },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.game.remove",
      name: "remove",
      description: "Remove a game from the collection",
      invocation: { method: "DELETE", path: "/api/games/:id" },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
      idempotent: false,
    },
    {
      operationId: "shelf.game.refresh-bgg",
      name: "refresh-bgg",
      description: "Re-fetch BGG data for a game",
      invocation: { method: "POST", path: "/api/games/:id/refresh" },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
      idempotent: false,
    },
    {
      operationId: "shelf.game.refresh-all-bgg",
      name: "refresh-all-bgg",
      description: "Re-fetch BGG data for all games in the collection",
      invocation: { method: "POST", path: "/api/games/refresh" },
      hierarchy: { root: "shelf", feature: "game" },
      idempotent: false,
    },
  ];

  return { routes, operations };
}
