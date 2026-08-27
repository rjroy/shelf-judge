import { Hono, type Context } from "hono";
import {
  AcquisitionMutationRequestSchema,
  AddGameSchema,
  CodedAxisValidationError,
  NotFoundError,
  toErrorMessage,
} from "@shelf-judge/shared";
import type { GameWithScore, Game, RedundancySettings } from "@shelf-judge/shared";
import { z } from "zod";
import type { GameService } from "../services/game-service.js";
import type { BggClient } from "../services/bgg-client.js";
import type { PredictionService } from "../services/prediction-service.js";
import type { StorageService } from "../services/storage-service.js";
import {
  UNSAFE_STORED_AMOUNT_SCHEMA,
  type RouteModule,
  type OperationDefinition,
} from "../operations.js";
import { computeNichePositions } from "../services/niche-engine.js";
import { computeRedundancyAdjustments } from "../services/redundancy-engine.js";
import {
  buildVocabulary,
  computeContinuousRanges,
  encodeGame,
  getOrderedVectorAxes,
  getVectorAxisValues,
} from "../services/feature-vector.js";
import type { FeatureVector } from "../services/feature-vector.js";

import type { WishlistService } from "../services/wishlist-service.js";
import { deriveDisplayStats } from "../services/tournament-service.js";
import type { PurchaseUtilizationService } from "../services/purchase-utilization-service.js";
import { PurchaseUtilizationValidationError } from "../services/purchase-utilization-service.js";
import { createLogger, type Logger } from "../services/logger.js";

const INTERNAL_ERROR_RESPONSE = { error: "Internal server error", code: "internal_error" } as const;

function gameNotFoundResponse(gameId: string) {
  return { error: `Game not found: ${gameId}`, code: "game_not_found" } as const;
}

export interface GameRoutesDeps {
  gameService: GameService;
  bggClient?: BggClient;
  predictionService?: PredictionService;
  storageService?: StorageService;
  wishlistService?: WishlistService;
  purchaseUtilizationService: PurchaseUtilizationService;
  logger?: Logger;
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

const ShelfAssignmentBodySchema = z.object({
  shelfId: z.string().min(1).nullable(),
});

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

  const [collection, tournamentData] = await Promise.all([
    storageService.loadCollection(),
    storageService.loadTournament(),
  ]);
  const gamesWithBgg = collection.games.filter((g) => g.bggData);
  const vocabulary = buildVocabulary(gamesWithBgg);
  const ranges = computeContinuousRanges(gamesWithBgg);
  const vectorAxes = getOrderedVectorAxes(collection.axes);

  // Per-request feature vector cache (Open Question 1 from the plan)
  const vectorCache = new Map<string, FeatureVector>();
  const getFeatureVector = (game: Game): FeatureVector => {
    const cached = vectorCache.get(game.id);
    if (cached) return cached;
    const values = getVectorAxisValues(
      game,
      vectorAxes,
      deriveDisplayStats(game.id, tournamentData).normalizedScore,
    );
    const vec = encodeGame(game, vocabulary, vectorAxes, values, ranges);
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
  const {
    gameService,
    bggClient,
    predictionService,
    storageService,
    wishlistService,
    purchaseUtilizationService,
  } = deps;
  const logger = deps.logger ?? createLogger("purchase-utilization-routes");
  const routes = new Hono();

  async function assembleFinalGames(
    includePredicted: boolean,
    includeNiches: boolean,
  ): Promise<GameWithScore[]> {
    let predictedGames: GameWithScore[] | undefined;
    const getPredictedGames = async (): Promise<GameWithScore[]> => {
      if (!predictionService) return gameService.listGames();
      predictedGames ??= await predictionService.listGamesWithPredictions();
      return predictedGames;
    };

    const allGames =
      includePredicted && predictionService
        ? await getPredictedGames()
        : await gameService.listGames();
    const ownedGames = allGames.filter((entry) => entry.game.ownership !== "previously-owned");

    if (includeNiches && predictionService) {
      const nicheSettings = storageService ? await storageService.loadNicheSettings() : undefined;
      const nicheUniverse = includePredicted
        ? ownedGames
        : (await getPredictedGames()).filter(
            (entry) => entry.game.ownership !== "previously-owned",
          );
      const nicheMap = computeNichePositions(nicheUniverse, nicheSettings);
      for (const entry of allGames) {
        entry.nichePosition = nicheMap.get(entry.game.id) ?? null;
      }
    }

    if (storageService) {
      const redundancySettings = await storageService.loadRedundancySettings();
      const universe =
        !includePredicted && predictionService
          ? (await getPredictedGames()).filter(
              (entry) => entry.game.ownership !== "previously-owned",
            )
          : undefined;
      await applyRedundancy(ownedGames, redundancySettings, storageService, universe);
    }

    return allGames;
  }

  async function enrichFinalGames(games: GameWithScore[], responseKind: "list" | "detail") {
    const benchmark = await purchaseUtilizationService.getEntertainmentBenchmark();
    return purchaseUtilizationService.enrichGames(games, benchmark, responseKind);
  }

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
      const assembled = await assembleFinalGames(includePredicted, includeNiches);
      const response = filterByOwnership(assembled, ownershipFilter);
      return c.json(await enrichFinalGames(response, "list"));
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // GET /games/:id
  routes.get("/games/:id", async (c) => {
    const id = c.req.param("id");
    const includePredictedQuery = c.req.query("includePredicted");
    if (
      includePredictedQuery !== undefined &&
      includePredictedQuery !== "true" &&
      includePredictedQuery !== "false"
    ) {
      return c.json(
        {
          error: "Validation failed",
          code: "invalid_include_predicted",
          message: 'includePredicted must be "true" or "false"',
        },
        400,
      );
    }
    try {
      const includePredicted = includePredictedQuery === "true";
      const assembled = await assembleFinalGames(includePredicted, true);
      const result = assembled.find((entry) => entry.game.id === id);
      if (!result) throw new NotFoundError(`Game not found: ${id}`);
      const [enriched] = await enrichFinalGames([result], "detail");
      return c.json(enriched);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json(gameNotFoundResponse(id), 404);
      }
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json(gameNotFoundResponse(id), 404);
      }
      return c.json(INTERNAL_ERROR_RESPONSE, 500);
    }
  });

  routes.put("/games/:id/acquisition", async (c) => {
    const id = c.req.param("id");
    const changedFields = ["acquisition"];
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      logger.log("acquisition HTTP mutation attempt", {
        gameId: id,
        requestedState: "unavailable",
        changedFields,
      });
      logger.warn("acquisition HTTP mutation rejected", {
        gameId: id,
        requestedState: "unavailable",
        changedFields,
        outcome: "rejected",
        validationCode: "invalid_json",
      });
      return c.json({ error: "Invalid JSON body", code: "invalid_json" }, 400);
    }
    const requestedState =
      typeof body === "object" &&
      body !== null &&
      "state" in body &&
      (body.state === "unknown" || body.state === "gift" || body.state === "purchase")
        ? body.state
        : "invalid";
    logger.log("acquisition HTTP mutation attempt", { gameId: id, requestedState, changedFields });
    const parsed = AcquisitionMutationRequestSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("acquisition HTTP mutation rejected", {
        gameId: id,
        requestedState,
        changedFields,
        outcome: "rejected",
        validationCode: "invalid_acquisition_request",
      });
      return c.json(
        {
          error: "Validation failed",
          code: "invalid_acquisition_request",
          details: parsed.error.issues,
        },
        400,
      );
    }
    try {
      const game = await purchaseUtilizationService.setAcquisition(id, parsed.data);
      return c.json({ game });
    } catch (error) {
      if (error instanceof PurchaseUtilizationValidationError) {
        return c.json({ error: error.message, code: error.code, details: error.details }, 400);
      }
      if (error instanceof NotFoundError) {
        logger.warn("acquisition HTTP mutation rejected", {
          gameId: id,
          requestedState,
          changedFields,
          outcome: "rejected",
          validationCode: "game_not_found",
        });
        return c.json(gameNotFoundResponse(id), 404);
      }
      logger.error("acquisition HTTP mutation failed", {
        gameId: id,
        requestedState,
        changedFields,
        outcome: "failed",
        validationCode: "persistence_failed",
      });
      return c.json(INTERNAL_ERROR_RESPONSE, 500);
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
      if (err instanceof CodedAxisValidationError) {
        return c.json(
          {
            error: "Validation failed",
            message: err.message,
            code: err.code,
            details: err.details,
          },
          400,
        );
      }
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

  // PUT /games/:id/shelf-assignment
  routes.put("/games/:id/shelf-assignment", async (c) => {
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = ShelfAssignmentBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    try {
      const game = await gameService.setManualShelf(id, parsed.data.shelfId);
      return c.json({ game });
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      if (
        message.includes("requires an owned game") ||
        message.includes("dimensions are required")
      ) {
        return c.json({ error: message }, 400);
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
      parameters: [
        {
          name: "includePredicted",
          in: "query",
          description: "Use predicted scores",
          required: false,
        },
        {
          name: "includeNiches",
          in: "query",
          description: "Include niche annotations",
          required: false,
        },
        {
          name: "ownership",
          in: "query",
          description: "owned, previously-owned, or all",
          required: false,
        },
      ],
      idempotent: true,
    },
    {
      operationId: "shelf.game.get",
      name: "get",
      description: "Get a game with current fitness score",
      invocation: { method: "GET", path: "/api/games/:id" },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [
        { name: "id", in: "path", description: "Game ID", required: true },
        {
          name: "includePredicted",
          in: "query",
          description: "Use predicted score",
          required: false,
          acceptedValues: ["true", "false"],
        },
      ],
      errors: [
        {
          status: 400,
          code: "invalid_include_predicted",
          description: "includePredicted was not true or false",
          response: {
            error: "Validation failed",
            code: "invalid_include_predicted",
            message: 'includePredicted must be "true" or "false"',
          },
        },
        {
          status: 404,
          code: "game_not_found",
          description: "No game exists with the requested ID",
          response: { error: "Game not found: :id", code: "game_not_found" },
        },
        {
          status: 500,
          code: "internal_error",
          description: "Game response assembly failed",
          response: INTERNAL_ERROR_RESPONSE,
        },
      ],
      idempotent: true,
    },
    {
      operationId: "shelf.game.set-acquisition",
      name: "set-acquisition",
      description: "Set or correct a game's lifetime acquisition state and landed cost",
      invocation: { method: "PUT", path: "/api/games/:id/acquisition" },
      requestSchema: AcquisitionMutationRequestSchema,
      request: {
        body: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["state"],
              properties: { state: { const: "unknown" } },
              description: "Unknown acquisition; amount is forbidden",
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["state"],
              properties: { state: { const: "gift" } },
              description: "Gift acquisition; amount is forbidden",
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["state", "amount"],
              properties: {
                state: { const: "purchase" },
                amount: {
                  type: "string",
                  pattern: "^\\d+(?:\\.\\d{1,2})?$",
                  not: UNSAFE_STORED_AMOUNT_SCHEMA,
                  description:
                    "Required non-negative exact decimal amount, at most two fractional digits and safe when stored as hundredths",
                },
              },
              description: "Purchase acquisition; amount is required",
            },
          ],
        },
      },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [
        { name: "id", in: "path", description: "Game ID", required: true },
        {
          name: "body",
          in: "body",
          description: "Strict acquisition state payload",
          required: true,
        },
      ],
      errors: [
        {
          status: 400,
          code: "invalid_json",
          description: "Request body is not valid JSON",
          response: { error: "Invalid JSON body", code: "invalid_json" },
        },
        {
          status: 400,
          code: "invalid_acquisition_request",
          description: "Request body does not match the strict acquisition contract",
          response: {
            error: "Validation failed",
            code: "invalid_acquisition_request",
            details: [],
          },
        },
        {
          status: 404,
          code: "game_not_found",
          description: "No game exists with the requested ID",
          response: { error: "Game not found: :id", code: "game_not_found" },
        },
        {
          status: 500,
          code: "internal_error",
          description: "Acquisition persistence failed",
          response: INTERNAL_ERROR_RESPONSE,
        },
      ],
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
      operationId: "shelf.game.shelf-assignment",
      name: "assign-shelf",
      description:
        "Set or clear a game's manual shelf assignment; assigning requires an owned game with complete box dimensions",
      invocation: { method: "PUT", path: "/api/games/:id/shelf-assignment" },
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
