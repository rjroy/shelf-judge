import { Hono, type Context } from "hono";
import {
  AcquisitionMutationRequestSchema,
  AddGameSchema,
  CodedAxisValidationError,
  NotFoundError,
  toErrorMessage,
  type IntentionCommand,
  type IntentionMutationResult,
  IntentionMutationResultSchema,
  intentionMutationResultMatchesCommand,
  ManualPlayCorrectionResultSchema,
  PlayEvidenceMutationResultSchema,
  OwnershipMutationResultSchema,
} from "@shelf-judge/shared";
import type { GameWithScore } from "@shelf-judge/shared";
import { z } from "zod";
import { GameHistoryConflictError, type GameService } from "../services/game-service.js";
import type { BggClient } from "../services/bgg-client.js";
import type { PredictionService } from "../services/prediction-service.js";
import type { StorageService } from "../services/storage-service.js";
import {
  UNSAFE_STORED_AMOUNT_SCHEMA,
  type RouteModule,
  type OperationDefinition,
  type OperationJsonValue,
} from "../operations.js";
import type { WishlistService } from "../services/wishlist-service.js";
import type { PurchaseUtilizationService } from "../services/purchase-utilization-service.js";
import { PurchaseUtilizationValidationError } from "../services/purchase-utilization-service.js";
import { createLogger, type Logger } from "../services/logger.js";
import {
  createDisplayedFitnessService,
  type DisplayedFitnessService,
} from "../services/displayed-fitness-service.js";
import type { IntentionService } from "../services/intention-service.js";

const INTERNAL_ERROR_RESPONSE = { error: "Internal server error", code: "internal_error" } as const;

function gameNotFoundResponse(gameId: string) {
  return { error: `Game not found: ${gameId}`, code: "game_not_found" } as const;
}

const DISCOVERY_COMMAND_ID = "10000000-0000-4000-8000-000000000001";
const DISCOVERY_ACTIVE_INTENTION = {
  intentionId: ":intentionId",
  gameId: ":id",
  kind: "first-play",
  baseline: {
    playCount: 0,
    evidenceSource: "manual",
    observedAt: "2026-08-28T10:00:00.000Z",
  },
  createdAt: "2026-08-28T10:01:00.000Z",
  version: 1,
  resolution: null,
} as const;

function intentionOperationErrors(
  type: "create" | "complete" | "retire",
): OperationDefinition["errors"] {
  const result = (error: Record<string, OperationJsonValue>) => ({
    ok: false,
    commandId: DISCOVERY_COMMAND_ID,
    error,
  });
  const common: OperationDefinition["errors"] = [
    {
      status: 400,
      code: "validation",
      description: "The body does not match the strict command payload",
      response: result({
        code: "validation",
        issues: [{ field: "commandId", message: "Invalid UUID" }],
      }),
    },
    {
      status: 404,
      code: "game-not-found",
      description: "The game does not exist",
      response: result({ code: "game-not-found", gameId: ":id" }),
    },
    {
      status: 409,
      code: "command-reuse",
      description: "The command ID was already accepted with another canonical payload",
      response: result({ code: "command-reuse", commandId: DISCOVERY_COMMAND_ID }),
    },
    {
      status: 500,
      code: "persistence-failure",
      description: "The durable collection write failed",
      response: result({
        code: "persistence-failure",
        operation: `game.intention.${type}`,
        message: "Persistence failed",
      }),
    },
  ];
  const commandSpecific: OperationDefinition["errors"] =
    type === "create"
      ? [
          {
            status: 400,
            code: "ineligible-game",
            description: "Ownership or current play evidence does not permit creation",
            response: result({ code: "ineligible-game", gameId: ":id", reason: "kind-mismatch" }),
          },
          {
            status: 409,
            code: "active-intention-conflict",
            description: "The game already has an active intention",
            response: result({
              code: "active-intention-conflict",
              gameId: ":id",
              current: DISCOVERY_ACTIVE_INTENTION,
            }),
          },
        ]
      : [
          {
            status: 404,
            code: "intention-not-found",
            description: "The intention does not exist for the game",
            response: result({
              code: "intention-not-found",
              gameId: ":id",
              intentionId: ":intentionId",
            }),
          },
          {
            status: 409,
            code: "stale-version",
            description: "The expected version or active state is stale",
            response: result({
              code: "stale-version",
              gameId: ":id",
              intentionId: ":intentionId",
              expectedVersion: 2,
              current: DISCOVERY_ACTIVE_INTENTION,
            }),
          },
        ];
  return [...common.slice(0, 2), ...commandSpecific, ...common.slice(2)];
}

export interface GameRoutesDeps {
  gameService: GameService;
  bggClient?: BggClient;
  predictionService?: PredictionService;
  storageService?: StorageService;
  wishlistService?: WishlistService;
  purchaseUtilizationService: PurchaseUtilizationService;
  displayedFitnessService?: DisplayedFitnessService;
  intentionService?: IntentionService;
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

const CreateIntentionBodySchema = z
  .object({
    commandId: z.string().uuid(),
    kind: z.enum(["first-play", "replay"]),
    expectedActiveIntention: z.literal("absent"),
  })
  .strict();

const ResolveIntentionBodySchema = z
  .object({ commandId: z.string().uuid(), expectedVersion: z.number().int().safe().positive() })
  .strict();

const SetPlayCountBodySchema = z.object({ playCount: z.number().int().safe().min(0) }).strict();

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

function filterByOwnership(games: GameWithScore[], ownership: string): GameWithScore[] {
  if (ownership === "all") return games;
  if (ownership === "previously-owned") {
    return games.filter((g) => g.game.ownership === "previously-owned");
  }
  // Default: "owned" (backward-compatible)
  return games.filter((g) => g.game.ownership !== "previously-owned");
}

function toPublicGameWithScore(entry: GameWithScore): GameWithScore {
  return {
    game: entry.game,
    score: entry.score,
    bggDataStale: entry.bggDataStale,
    nichePosition: entry.nichePosition,
  };
}

export function createGameRoutes(deps: GameRoutesDeps): RouteModule {
  const { gameService, bggClient, wishlistService, purchaseUtilizationService, intentionService } =
    deps;

  function intentions(): IntentionService {
    if (intentionService === undefined) throw new Error("Intention service is not configured");
    return intentionService;
  }
  const displayedFitnessService =
    deps.displayedFitnessService ??
    createDisplayedFitnessService({
      gameService,
      predictionService: deps.predictionService,
      storageService: deps.storageService,
    });
  const logger = deps.logger ?? createLogger("purchase-utilization-routes");
  const routes = new Hono();

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
      const assembled = await displayedFitnessService.listGames({
        includePredicted,
        includeNiches,
      });
      const publicGames = assembled.map(toPublicGameWithScore);
      const response = filterByOwnership(publicGames, ownershipFilter);
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
      const assembled = await displayedFitnessService.listGames({
        includePredicted,
        includeNiches: true,
      });
      const assembledResult = assembled.find((entry) => entry.game.id === id);
      if (!assembledResult) throw new NotFoundError(`Game not found: ${id}`);
      const result = toPublicGameWithScore(assembledResult);
      const [enriched] = await enrichFinalGames([result], "detail");
      const intentionDetail =
        intentionService === undefined
          ? { activeIntention: null, resolvedHistory: [] }
          : await intentionService.getGameDetail(enriched.game.id, enriched.game.name);
      return c.json({ ...enriched, intentions: intentionDetail });
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
      if (err instanceof GameHistoryConflictError) {
        if (err.error.gameId !== id) return c.json(INTERNAL_ERROR_RESPONSE, 500);
        return c.json(err.error, 409);
      }
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
      const result = OwnershipMutationResultSchema.parse(
        await gameService.setOwnership(id, parsed.data.ownership),
      );
      if (result.game.id !== id || result.game.ownership !== parsed.data.ownership) {
        return c.json(INTERNAL_ERROR_RESPONSE, 500);
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

  async function intentionResponse(
    resultPromise: Promise<IntentionMutationResult>,
    command: IntentionCommand,
  ): Promise<Response> {
    let result: IntentionMutationResult;
    try {
      result = IntentionMutationResultSchema.parse(await resultPromise);
      if (!intentionMutationResultMatchesCommand(command, result)) {
        return Response.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
      }
    } catch {
      return Response.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
    if (result.ok) return Response.json(result);
    const status =
      result.error.code === "game-not-found" || result.error.code === "intention-not-found"
        ? 404
        : result.error.code === "persistence-failure"
          ? 500
          : result.error.code === "active-intention-conflict" ||
              result.error.code === "stale-version" ||
              result.error.code === "command-reuse"
            ? 409
            : 400;
    return Response.json(result, { status });
  }

  function intentionValidationResponse(body: unknown, error: z.ZodError): Response {
    const parsedCommandId =
      typeof body === "object" && body !== null && "commandId" in body
        ? z.string().uuid().safeParse(body.commandId)
        : null;
    return Response.json(
      {
        ok: false,
        commandId:
          parsedCommandId?.success === true
            ? parsedCommandId.data
            : "00000000-0000-0000-0000-000000000000",
        error: {
          code: "validation",
          issues: error.issues.map((issue) => ({
            field: issue.path.join(".") || "request",
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  routes.post("/games/:id/intention", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }
    const parsed = CreateIntentionBodySchema.safeParse(body);
    if (!parsed.success) return intentionValidationResponse(body, parsed.error);
    const command = {
      type: "create",
      commandId: parsed.data.commandId,
      gameId: c.req.param("id"),
      kind: parsed.data.kind,
      expectedActiveIntention: parsed.data.expectedActiveIntention,
    } satisfies IntentionCommand;
    return intentionResponse(intentions().execute(command), command);
  });

  for (const type of ["complete", "retire"] as const) {
    routes.post(`/games/:id/intention/:intentionId/${type}`, async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        body = null;
      }
      const parsed = ResolveIntentionBodySchema.safeParse(body);
      if (!parsed.success) return intentionValidationResponse(body, parsed.error);
      const command = {
        type,
        commandId: parsed.data.commandId,
        gameId: c.req.param("id"),
        intentionId: c.req.param("intentionId"),
        expectedVersion: parsed.data.expectedVersion,
      } satisfies IntentionCommand;
      return intentionResponse(intentions().execute(command), command);
    });
  }

  routes.put("/games/:id/plays", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { code: "validation", issues: [{ field: "request", message: "Invalid JSON" }] },
        400,
      );
    }
    const parsed = SetPlayCountBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          code: "validation",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join(".") || "request",
            message: issue.message,
          })),
        },
        400,
      );
    }
    try {
      const gameId = c.req.param("id");
      const result = ManualPlayCorrectionResultSchema.parse(
        await intentions().setPlayCount(gameId, parsed.data.playCount),
      );
      if (result.ok ? result.game.id !== gameId : result.error.gameId !== gameId) {
        return c.json(INTERNAL_ERROR_RESPONSE, 500);
      }
      return result.ok ? c.json(result) : c.json(result, 409);
    } catch (error) {
      const message = toErrorMessage(error);
      if (message.includes("not found"))
        return c.json(gameNotFoundResponse(c.req.param("id")), 404);
      return c.json(
        { code: "persistence-failure", operation: "shelf.game.plays.set", message },
        500,
      );
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
      const result = PlayEvidenceMutationResultSchema.parse(await gameService.refreshBggData(id));
      if (result.game.id !== id) return c.json(INTERNAL_ERROR_RESPONSE, 500);
      return c.json(result);
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
      operationId: "shelf.game.intention.set",
      name: "set",
      description: "Create the eligible first-play or replay intention for an owned game",
      invocation: { method: "POST", path: "/api/games/:id/intention" },
      requestSchema: CreateIntentionBodySchema,
      request: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["commandId", "kind", "expectedActiveIntention"],
          properties: {
            commandId: { type: "string", format: "uuid" },
            kind: { type: "string", enum: ["first-play", "replay"] },
            expectedActiveIntention: { const: "absent" },
          },
        },
      },
      response: { body: { oneOf: ["accepted-intention-mutation", "intention-mutation-error"] } },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
      errors: intentionOperationErrors("create"),
      idempotent: true,
    },
    ...(["complete", "retire"] as const).map(
      (type): OperationDefinition => ({
        operationId: `shelf.game.intention.${type}`,
        name: type,
        description: `${type === "complete" ? "Complete" : "Retire"} an active intention at its expected version`,
        invocation: {
          method: "POST",
          path: `/api/games/:id/intention/:intentionId/${type}`,
        },
        requestSchema: ResolveIntentionBodySchema,
        request: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["commandId", "expectedVersion"],
            properties: {
              commandId: { type: "string", format: "uuid" },
              expectedVersion: { type: "integer", minimum: 1 },
            },
          },
        },
        response: { body: { oneOf: ["accepted-intention-mutation", "intention-mutation-error"] } },
        hierarchy: { root: "shelf", feature: "game" },
        parameters: [
          { name: "id", in: "path", description: "Game ID", required: true },
          {
            name: "intentionId",
            in: "path",
            description: "Intention ID",
            required: true,
          },
        ],
        errors: intentionOperationErrors(type),
        idempotent: true,
      }),
    ),
    {
      operationId: "shelf.game.plays.set",
      name: "set",
      description: "Set current manual play-count evidence and return any automatic completion",
      invocation: { method: "PUT", path: "/api/games/:id/plays" },
      requestSchema: SetPlayCountBodySchema,
      request: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["playCount"],
          properties: { playCount: { type: "integer", minimum: 0 } },
        },
      },
      response: {
        body: {
          oneOf: ["accepted-manual-play-correction", "manual-play-correction-conflict"],
        },
      },
      hierarchy: { root: "shelf", feature: "game" },
      parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
      errors: [
        {
          status: 400,
          code: "validation",
          description: "Invalid play count",
          response: {
            code: "validation",
            issues: [{ field: "playCount", message: "Must be a nonnegative safe integer" }],
          },
        },
        {
          status: 404,
          code: "game_not_found",
          description: "Game not found",
          response: { error: "Game not found: :id", code: "game_not_found" },
        },
        {
          status: 409,
          code: "non-monotonic-observation",
          description: "The daemon clock cannot produce a newer truthful observation",
          response: {
            ok: false,
            error: {
              code: "non-monotonic-observation",
              gameId: ":id",
              attemptedObservedAt: "2026-08-28T10:00:00.000Z",
              latestAcceptedAt: "2026-08-28T10:00:00.000Z",
            },
          },
        },
        {
          status: 500,
          code: "persistence-failure",
          description: "Persistence failed",
          response: {
            code: "persistence-failure",
            operation: "shelf.game.plays.set",
            message: "Persistence failed",
          },
        },
      ],
      idempotent: false,
    },
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
