import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import {
  createTestApp,
  createMockBggClient,
  jsonRequest,
  type TestAppContext,
} from "../helpers/test-app.js";
import type { BggGameResult } from "../../src/services/bgg-client.js";
import { createGameRoutes } from "../../src/routes/games.js";
import { createPurchaseUtilizationService } from "../../src/services/purchase-utilization-service.js";
import type { Logger } from "../../src/services/logger.js";
import type { OperationDefinition } from "../../src/operations.js";
import type {
  Axis,
  Game,
  FitnessResult,
  AddGameResult,
  GameWithScore,
  GameWithPurchaseUtilization,
  GameDetailWithPurchaseUtilization,
  BggSearchResult,
} from "@shelf-judge/shared";
import { createCompleteEntityMetadata } from "@shelf-judge/shared";

type GameAddResponse = AddGameResult;
type GameDetailResponse = GameWithPurchaseUtilization;
type GameListEntry = GameWithPurchaseUtilization;

interface GameRateResponse {
  game: Game;
  score: FitnessResult | null;
}

interface RefreshResponse {
  refreshed: number;
  errors: string[];
}

async function expectPublishedError(
  operation: OperationDefinition,
  response: Response,
): Promise<Record<string, unknown>> {
  const body = (await response.json()) as Record<string, unknown>;
  const definition = operation.errors?.find(
    ({ status, code }) => status === response.status && code === body.code,
  );
  expect(definition).toBeDefined();
  expect(Object.keys(body).sort()).toEqual(Object.keys(definition?.response ?? {}).sort());
  expect(body.code).toBe(definition?.code);
  return body;
}

let ctx: TestAppContext;

const wingspanBggResult: BggGameResult = {
  entityMetadata: createCompleteEntityMetadata(
    { mechanic: [{ id: 2004, name: "Set Collection" }], designer: [], artist: [] },
    "2026-08-28T00:00:00.000Z",
  ),
  metadata: {
    bggId: 266192,
    name: "Wingspan",
    yearPublished: 2019,
    minPlayers: 1,
    maxPlayers: 5,
    playingTime: 70,
    imageUrl: "https://example.com/wingspan.jpg",
    thumbnailUrl: null,
  },
  bggData: {
    communityRating: 8.1,
    bayesAverage: 7.9,
    weight: 2.4,
    numWeightVotes: 1200,
    description: null,
    mechanics: [{ id: 2004, name: "Set Collection" }],
    categories: [{ id: 1089, name: "Animals" }],
    families: [],
    subdomains: [],
    bestPlayerCount: null,
    fetchedAt: new Date().toISOString(),
  },
};

describe("Game Routes", () => {
  beforeEach(() => {
    ctx = createTestApp();
  });

  describe("POST /api/games", () => {
    test("manual game returns 201 with game object and bggImported: false", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as GameAddResponse;
      expect(body.game).toBeDefined();
      expect(body.game.name).toBe("Test Game");
      expect(body.game.id).toBeTruthy();
      expect(body.game.bggId).toBeNull();
      expect(body.game.ratings).toEqual({});
      expect(body.bggImported).toBe(false);
      expect(body.game.entityMetadata.mechanic).toEqual({
        state: "unrefreshable",
        entities: [],
        observedAt: null,
        refreshFailure: null,
        correctionDestination: null,
        explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
      });
    });

    test("game with bggId when BGG is configured returns 201", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.resolve(wingspanBggResult),
      });
      ctx = createTestApp({ bggClient });

      const res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as GameAddResponse;
      expect(body.game.bggId).toBe(266192);
      expect(body.game.name).toBe("Wingspan");
      expect(body.bggImported).toBe(true);
      // BGG data should have been applied
      expect(body.game.yearPublished).toBe(2019);
      expect(body.game.bggData).toBeTruthy();
    });

    test("duplicate bggId returns 409", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.resolve(wingspanBggResult),
      });
      ctx = createTestApp({ bggClient });

      // Add the first game
      const first = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });
      expect(first.status).toBe(201);

      // Try to add another with the same bggId
      const second = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan Duplicate",
        bggId: 266192,
      });

      expect(second.status).toBe(409);
      const body = (await second.json()) as { error: string };
      expect(body.error).toContain("already exists");
    });
  });

  describe("GET /api/games", () => {
    test("returns list sorted by fitness score", async () => {
      // Create a personal axis to rate on
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      expect(axisRes.status).toBe(201);
      const axis = (await axisRes.json()) as Axis;

      // Add two games
      const game1Res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Low Rated Game",
      });
      const game1 = ((await game1Res.json()) as GameAddResponse).game;

      const game2Res = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "High Rated Game",
      });
      const game2 = ((await game2Res.json()) as GameAddResponse).game;

      // Rate game1 low, game2 high
      await jsonRequest(ctx.app, "PUT", `/api/games/${game1.id}/ratings`, {
        ratings: { [axis.id]: 3 },
      });
      await jsonRequest(ctx.app, "PUT", `/api/games/${game2.id}/ratings`, {
        ratings: { [axis.id]: 9 },
      });

      const listRes = await jsonRequest(ctx.app, "GET", "/api/games");
      expect(listRes.status).toBe(200);
      const games = (await listRes.json()) as GameListEntry[];

      expect(games).toBeArray();
      expect(games.length).toBe(2);
      // Higher rated game should be first
      expect(games[0].game.name).toBe("High Rated Game");
      expect(games[1].game.name).toBe("Low Rated Game");
    });
  });

  describe("GET /api/games/:id", () => {
    test("returns game with score breakdown", async () => {
      // Create a personal axis and a game
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      const axis = (await axisRes.json()) as Axis;

      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      // Rate it
      await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 7 },
      });

      const getRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`);

      expect(getRes.status).toBe(200);
      const body = (await getRes.json()) as GameDetailResponse;
      expect(body.game.id).toBe(game.id);
      expect(body.score).toBeDefined();
      expect(body.score!.breakdown).toBeArray();
      expect(body.score!.score).toBeGreaterThan(0);
      expect(body.displayScore).toBe("7.0");
      expect(body.purchaseUtilization.evidence.fitness).toMatchObject({
        status: "valid",
        value: "7.0",
      });
    });

    test("defaults to actual fitness and matches list/detail response assembly", async () => {
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      const axis = (await axisRes.json()) as Axis;
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", { name: "Parity" });
      const game = ((await gameRes.json()) as GameAddResponse).game;
      await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 8 },
      });

      const list = (await (
        await jsonRequest(ctx.app, "GET", "/api/games?includeNiches=true")
      ).json()) as GameWithPurchaseUtilization[];
      const detail = (await (
        await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`)
      ).json()) as GameDetailWithPurchaseUtilization;
      const sharedDetail: GameWithPurchaseUtilization = {
        game: detail.game,
        score: detail.score,
        bggDataStale: detail.bggDataStale,
        nichePosition: detail.nichePosition,
        displayScore: detail.displayScore,
        purchaseUtilization: detail.purchaseUtilization,
      };
      expect(list).toContainEqual(sharedDetail);
    });

    test("previously owned detail is enriched but remains outside niche and redundancy universes", async () => {
      const { game } = await ctx.gameService.addGame({ name: "Former Game" });
      await ctx.gameService.setOwnership(game.id, "previously-owned");
      const detail = (await (
        await jsonRequest(ctx.app, "GET", `/api/games/${game.id}?includePredicted=true`)
      ).json()) as GameWithPurchaseUtilization;
      expect(detail.game.ownership).toBe("previously-owned");
      expect(detail.nichePosition).toBeNull();
      expect(detail.score?.redundancyAdjustment ?? null).toBeNull();
      expect(detail.purchaseUtilization).toBeDefined();
    });

    test("rejects malformed includePredicted detail values with a stable contract", async () => {
      const { game } = await ctx.gameService.addGame({ name: "Query Contract" });
      for (const value of ["yes", "TRUE", "1", ""]) {
        const response = await jsonRequest(
          ctx.app,
          "GET",
          `/api/games/${game.id}?includePredicted=${value}`,
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "Validation failed",
          code: "invalid_include_predicted",
          message: 'includePredicted must be "true" or "false"',
        });
      }

      const operation = ctx.operations.find(({ operationId }) => operationId === "shelf.game.get");
      expect(operation?.parameters?.find(({ name }) => name === "includePredicted")).toMatchObject({
        required: false,
        acceptedValues: ["true", "false"],
      });
      expect(operation?.errors).toContainEqual({
        status: 400,
        code: "invalid_include_predicted",
        description: "includePredicted was not true or false",
        response: {
          error: "Validation failed",
          code: "invalid_include_predicted",
          message: 'includePredicted must be "true" or "false"',
        },
      });
    });

    test("runtime validation, not-found, and internal errors match discovery metadata", async () => {
      const operation = ctx.operations.find(({ operationId }) => operationId === "shelf.game.get");
      if (!operation) throw new Error("Missing game detail operation");

      const invalid = await jsonRequest(ctx.app, "GET", "/api/games/missing?includePredicted=yes");
      expect(await expectPublishedError(operation, invalid)).toEqual({
        error: "Validation failed",
        code: "invalid_include_predicted",
        message: 'includePredicted must be "true" or "false"',
      });

      const missing = await jsonRequest(ctx.app, "GET", "/api/games/missing");
      expect(await expectPublishedError(operation, missing)).toEqual({
        error: "Game not found: missing",
        code: "game_not_found",
      });

      const routeModule = createGameRoutes({
        gameService: {
          ...ctx.gameService,
          listGames: () => Promise.reject(new Error("private assembly failure")),
        },
        storageService: ctx.storageService,
        purchaseUtilizationService: createPurchaseUtilizationService({
          storageService: ctx.storageService,
        }),
      });
      const app = new Hono();
      app.route("/api", routeModule.routes);
      const failed = await app.request("/api/games/anything");
      expect(await expectPublishedError(operation, failed)).toEqual({
        error: "Internal server error",
        code: "internal_error",
      });
    });
  });

  describe("PUT /api/games/:id/acquisition", () => {
    test("sets all states, permits zero purchase, and corrects invalid persisted data", async () => {
      const added = await ctx.gameService.addGame({ name: "Acquisition" });
      const id = added.game.id;
      for (const [payload, expected] of [
        [{ state: "gift" }, { state: "gift" }],
        [
          { state: "purchase", amount: "0" },
          { state: "purchase", amount: { hundredths: 0, source: "manual" } },
        ],
        [
          { state: "purchase", amount: "12.34" },
          { state: "purchase", amount: { hundredths: 1234, source: "manual" } },
        ],
        [{ state: "unknown" }, { state: "unknown" }],
      ] as const) {
        const response = await jsonRequest(ctx.app, "PUT", `/api/games/${id}/acquisition`, payload);
        expect(response.status).toBe(200);
        expect(((await response.json()) as { game: Game }).game.acquisition).toMatchObject(
          expected,
        );
      }

      const stored = await ctx.storageService.loadCollection();
      stored.games[0].acquisition = {
        state: "invalid",
        evidence: { presence: "present", value: "malformed" },
      };
      await ctx.storageService.saveCollection(stored);
      const corrected = await jsonRequest(ctx.app, "PUT", `/api/games/${id}/acquisition`, {
        state: "purchase",
        amount: "5.00",
      });
      expect(corrected.status).toBe(200);
      expect(((await corrected.json()) as { game: Game }).game.acquisition).toMatchObject({
        state: "purchase",
        amount: { hundredths: 500, source: "manual" },
      });
    });

    test("strictly rejects invalid payloads and preserves acquisition", async () => {
      const { game } = await ctx.gameService.addGame({ name: "Strict" });
      const payloads = [
        { state: "unknown", amount: "1" },
        { state: "gift", amount: "1" },
        { state: "purchase" },
        { state: "purchase", amount: "1.234" },
        { state: "purchase", amount: "90071992547409.92" },
        { state: "other" },
        { state: "unknown", extra: true },
      ];
      for (const payload of payloads) {
        const response = await jsonRequest(
          ctx.app,
          "PUT",
          `/api/games/${game.id}/acquisition`,
          payload,
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: "Validation failed",
          code: "invalid_acquisition_request",
        });
      }
      expect((await ctx.storageService.loadCollection()).games[0].acquisition).toEqual({
        state: "unknown",
      });

      const malformed = await ctx.app.request(
        new Request(`http://localhost/api/games/${game.id}/acquisition`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "{",
        }),
      );
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({ error: "Invalid JSON body", code: "invalid_json" });
    });

    test("returns stable not-found behavior and operation discovery", async () => {
      const missing = await jsonRequest(ctx.app, "PUT", "/api/games/missing/acquisition", {
        state: "gift",
      });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({
        error: "Game not found: missing",
        code: "game_not_found",
      });

      const operation = ctx.operations.find(
        ({ operationId }) => operationId === "shelf.game.set-acquisition",
      );
      expect(operation).toMatchObject({
        invocation: { method: "PUT", path: "/api/games/:id/acquisition" },
        idempotent: true,
      });
      expect(operation?.parameters?.map(({ in: location }) => location)).toEqual(["path", "body"]);
      expect(operation?.requestSchema?.safeParse({ state: "purchase", amount: "0" }).success).toBe(
        true,
      );
    });

    test("runtime validation, not-found, and internal errors match discovery metadata", async () => {
      const operation = ctx.operations.find(
        ({ operationId }) => operationId === "shelf.game.set-acquisition",
      );
      if (!operation) throw new Error("Missing acquisition operation");
      const { game } = await ctx.gameService.addGame({ name: "Acquisition Error Parity" });

      const malformed = await ctx.app.request(`/api/games/${game.id}/acquisition`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      expect(await expectPublishedError(operation, malformed)).toEqual({
        error: "Invalid JSON body",
        code: "invalid_json",
      });

      const invalid = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/acquisition`, {
        state: "gift",
        amount: "1.00",
      });
      const invalidBody = await expectPublishedError(operation, invalid);
      expect(invalidBody).toMatchObject({
        error: "Validation failed",
        code: "invalid_acquisition_request",
      });

      const missing = await jsonRequest(ctx.app, "PUT", "/api/games/missing/acquisition", {
        state: "gift",
      });
      expect(await expectPublishedError(operation, missing)).toEqual({
        error: "Game not found: missing",
        code: "game_not_found",
      });

      ctx.storageService.saveCollection = () => Promise.reject(new Error("private disk failure"));
      const failed = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/acquisition`, {
        state: "gift",
      });
      expect(await expectPublishedError(operation, failed)).toEqual({
        error: "Internal server error",
        code: "internal_error",
      });
    });

    test("logs safe HTTP, service persistence, and failed persistence outcomes", async () => {
      const logs: unknown[][] = [];
      const logger: Logger = {
        log: (...args) => logs.push(args),
        warn: (...args) => logs.push(args),
        error: (...args) => logs.push(args),
      };
      const { game } = await ctx.gameService.addGame({ name: "Logged Acquisition" });
      const service = createPurchaseUtilizationService({
        storageService: ctx.storageService,
        logger,
      });
      const routeModule = createGameRoutes({
        gameService: ctx.gameService,
        storageService: ctx.storageService,
        purchaseUtilizationService: service,
        logger,
      });
      const app = new Hono();
      app.route("/api", routeModule.routes);

      const rejected = await app.request(`/api/games/${game.id}/acquisition`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "gift", amount: "private-invalid" }),
      });
      expect(rejected.status).toBe(400);
      const accepted = await app.request(`/api/games/${game.id}/acquisition`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "purchase", amount: "432.10" }),
      });
      expect(accepted.status).toBe(200);

      ctx.storageService.saveCollection = () => Promise.reject(new Error("disk failed"));
      const failed = await app.request(`/api/games/${game.id}/acquisition`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "gift" }),
      });
      expect(failed.status).toBe(500);
      expect(logs).toContainEqual([
        "acquisition HTTP mutation rejected",
        {
          gameId: game.id,
          requestedState: "gift",
          changedFields: ["acquisition"],
          outcome: "rejected",
          validationCode: "invalid_acquisition_request",
        },
      ]);
      expect(
        logs.some(
          ([message, fields]) =>
            message === "acquisition persistence completed" &&
            typeof fields === "object" &&
            fields !== null &&
            "collectionId" in fields &&
            "previousState" in fields &&
            "nextState" in fields,
        ),
      ).toBe(true);
      expect(
        logs.some(
          ([message, fields]) =>
            message === "acquisition persistence failed" &&
            typeof fields === "object" &&
            fields !== null &&
            "outcome" in fields &&
            fields.outcome === "failed",
        ),
      ).toBe(true);
      expect(logs).toContainEqual([
        "acquisition HTTP mutation failed",
        {
          gameId: game.id,
          requestedState: "gift",
          changedFields: ["acquisition"],
          outcome: "failed",
          validationCode: "persistence_failed",
        },
      ]);
      const serialized = JSON.stringify(logs);
      expect(serialized).not.toContain("private-invalid");
      expect(serialized).not.toContain("432.10");
      expect(serialized).not.toContain("43210");
    });
  });

  describe("PUT /api/games/:id/ratings", () => {
    test("updates ratings and returns new score", async () => {
      // Create a personal axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      const axis = (await axisRes.json()) as Axis;

      // Create a game
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      const rateRes = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 8 },
      });

      expect(rateRes.status).toBe(200);
      const body = (await rateRes.json()) as GameRateResponse;
      expect(body.game.ratings[axis.id]).toBe(8);
      expect(body.score).toBeDefined();
      expect(body.score!.score).toBeGreaterThan(0);
      expect(body).not.toHaveProperty("displayScore");
      expect(body).not.toHaveProperty("purchaseUtilization");
    });

    test("invalid rating returns 400", async () => {
      // Create a personal axis
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      const axis = (await axisRes.json()) as Axis;

      // Create a game
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      // Rating out of range (> 10)
      const rateRes = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 15 },
      });

      expect(rateRes.status).toBe(400);
      const body = (await rateRes.json()) as { error: string };
      expect(body.error).toBeDefined();
    });

    test("null rating clears an existing rating", async () => {
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      const axis = (await axisRes.json()) as Axis;

      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      // Set a rating
      await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 8 },
      });

      // Clear it with null
      const clearRes = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: null },
      });

      expect(clearRes.status).toBe(200);
      const body = (await clearRes.json()) as GameRateResponse;
      expect(body.game.ratings[axis.id]).toBeUndefined();
    });

    test("rejects score overrides for native-value derived axes", async () => {
      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Play Time",
        weight: 50,
        source: "derived",
        derivedField: "playingTime",
        configuration: { maximumScoringTime: 240 },
        preferenceShape: "sweet-spot",
        idealValue: 90,
        toleranceWidth: 30,
      });
      const axis = (await axisRes.json()) as Axis;
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", { name: "Test Game" });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      const response = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
        ratings: { [axis.id]: 8 },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "Play Time accepts native game values, not 1-10 score overrides",
      });
    });
  });

  describe("PUT /api/games/:id/manual-values", () => {
    test("registers a discoverable strict idempotent operation", () => {
      const operation = ctx.operations.find(
        ({ operationId }) => operationId === "shelf.game.set-manual-values",
      );

      expect(operation).toMatchObject({
        invocation: { method: "PUT", path: "/api/games/:id/manual-values" },
        idempotent: true,
      });
      expect(operation?.requestSchema?.safeParse({ playingTime: 90 }).success).toBe(true);
      expect(operation?.requestSchema?.safeParse({ playerCount: null }).success).toBe(true);
      expect(operation?.requestSchema?.safeParse({}).success).toBe(false);
      expect(operation?.requestSchema?.safeParse({ playingTime: 0 }).success).toBe(false);
    });

    test("sets one field, preserves source data and the other field, then clears independently", async () => {
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Test Game",
        playingTime: 60,
        minPlayers: 2,
        maxPlayers: 4,
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      const setTime = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/manual-values`, {
        playingTime: 90,
      });
      expect(setTime.status).toBe(200);
      const afterTime = (await setTime.json()) as { game: Game };
      expect(afterTime.game.manualValues.playingTime).toMatchObject({
        value: 90,
        source: "manual",
      });
      expect(afterTime.game.manualValues.playerCount).toBeNull();
      expect(afterTime.game.playingTime).toBe(60);
      expect(afterTime.game.durationEvidence).toMatchObject({ value: 60 });

      const setCount = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/manual-values`, {
        playerCount: 3,
      });
      const afterCount = (await setCount.json()) as { game: Game };
      expect(afterCount.game.manualValues.playingTime?.value).toBe(90);
      expect(afterCount.game.manualValues.playerCount?.value).toBe(3);

      const clearTime = await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/manual-values`, {
        playingTime: null,
      });
      const cleared = (await clearTime.json()) as { game: Game };
      expect(cleared.game.manualValues.playingTime).toBeNull();
      expect(cleared.game.manualValues.playerCount?.value).toBe(3);
      expect(cleared.game.playingTime).toBe(60);
    });

    test("validates native values and missing games", async () => {
      const invalid = await jsonRequest(ctx.app, "PUT", "/api/games/missing/manual-values", {
        playerCount: 0,
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ code: "invalid_manual_values" });

      const missing = await jsonRequest(ctx.app, "PUT", "/api/games/missing/manual-values", {
        playerCount: 2,
      });
      expect(missing.status).toBe(404);
    });
  });

  describe("DELETE /api/games/:id", () => {
    test("returns 204 on successful deletion", async () => {
      const gameRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Doomed Game",
      });
      const game = ((await gameRes.json()) as GameAddResponse).game;

      const delRes = await jsonRequest(ctx.app, "DELETE", `/api/games/${game.id}`);
      expect(delRes.status).toBe(204);

      // Confirm it's gone
      const getRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe("GET /api/games/search", () => {
    test("returns search results when BGG is configured", async () => {
      const bggClient = createMockBggClient({
        searchGames: () =>
          Promise.resolve([
            { bggId: 266192, name: "Wingspan", yearPublished: 2019, thumbnailUrl: null },
            {
              bggId: 290837,
              name: "Wingspan: European Expansion",
              yearPublished: 2019,
              thumbnailUrl: null,
            },
          ]),
      });
      ctx = createTestApp({ bggClient });

      const res = await jsonRequest(ctx.app, "GET", "/api/games/search?q=wingspan");

      expect(res.status).toBe(200);
      const results = (await res.json()) as BggSearchResult[];
      expect(results).toBeArray();
      expect(results.length).toBe(2);
      expect(results[0].name).toBe("Wingspan");
    });
  });

  describe("POST /api/games/refresh", () => {
    test("refreshes all BGG games and returns summary", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.resolve(wingspanBggResult),
        getGames: (ids) => {
          const results = new Map<number, BggGameResult>();
          for (const id of ids) {
            if (id === 266192) results.set(id, wingspanBggResult);
          }
          return Promise.resolve(results);
        },
      });
      ctx = createTestApp({ bggClient });

      // Add a BGG game
      await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });

      // Also add a manual game (should not be refreshed)
      await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Manual Game",
      });

      const res = await jsonRequest(ctx.app, "POST", "/api/games/refresh");
      expect(res.status).toBe(200);
      const body = (await res.json()) as RefreshResponse;
      expect(body.refreshed).toBe(1);
      expect(body.errors).toBeArray();
    });

    test("returns 503 when BGG is not configured", async () => {
      // Default: no bggClient
      const res = await jsonRequest(ctx.app, "POST", "/api/games/refresh");
      expect(res.status).toBe(503);
    });
  });

  describe("bggDataStale field", () => {
    test("game with recent BGG data has bggDataStale: false", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.resolve(wingspanBggResult),
      });
      ctx = createTestApp({ bggClient });

      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });
      const { game } = (await addRes.json()) as GameAddResponse;

      const getRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`);
      const body = (await getRes.json()) as GameDetailResponse;
      expect(body.bggDataStale).toBe(false);
    });

    test("game without BGG data has bggDataStale: undefined", async () => {
      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Manual Game",
      });
      const { game } = (await addRes.json()) as GameAddResponse;

      const getRes = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`);
      const body = (await getRes.json()) as GameDetailResponse;
      expect(body.bggDataStale).toBeUndefined();
    });

    test("list includes bggDataStale for each game", async () => {
      const bggClient = createMockBggClient({
        getGame: () => Promise.resolve(wingspanBggResult),
      });
      ctx = createTestApp({ bggClient });

      await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      });
      await jsonRequest(ctx.app, "POST", "/api/games", {
        name: "Manual Game",
      });

      const listRes = await jsonRequest(ctx.app, "GET", "/api/games");
      const games = (await listRes.json()) as GameListEntry[];
      expect(games.length).toBe(2);

      const bggGame = games.find((g) => g.game.name === "Wingspan");
      const manualGame = games.find((g) => g.game.name === "Manual Game");
      expect(bggGame!.bggDataStale).toBe(false);
      expect(manualGame!.bggDataStale).toBeUndefined();
    });
  });

  describe("BGG routes without token", () => {
    test("search returns 503 with setup instructions when BGG is not configured", async () => {
      // Default createTestApp() has no bggClient
      const res = await jsonRequest(ctx.app, "GET", "/api/games/search?q=wingspan");

      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("not configured");
      expect(body.error).toContain("shelf-judge config set bgg-token");
    });
  });

  describe("niche position integration", () => {
    // Build a collection of 3 games sharing "Deck Building" mechanic to form a niche
    const makeBggResult = (
      bggId: number,
      name: string,
      mechanics: { id: number; name: string }[],
      categories: { id: number; name: string }[] = [],
    ): BggGameResult => ({
      entityMetadata: createCompleteEntityMetadata(
        { mechanic: mechanics, designer: [], artist: [] },
        "2026-08-28T00:00:00.000Z",
      ),
      metadata: {
        bggId,
        name,
        yearPublished: 2020,
        minPlayers: 2,
        maxPlayers: 4,
        playingTime: 60,
        imageUrl: null,
        thumbnailUrl: null,
      },
      bggData: {
        communityRating: 7.5,
        bayesAverage: 7.2,
        weight: 2.5,
        numWeightVotes: 100,
        description: null,
        mechanics,
        categories,
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: new Date().toISOString(),
      },
    });

    async function setupNicheCollection() {
      const bggClient = createMockBggClient({
        getGame: (bggId: number) => {
          const games: Record<number, BggGameResult> = {
            1: makeBggResult(
              1,
              "Game Alpha",
              [{ id: 1, name: "Deck Building" }],
              [{ id: 10, name: "Card Game" }],
            ),
            2: makeBggResult(
              2,
              "Game Beta",
              [{ id: 1, name: "Deck Building" }],
              [{ id: 10, name: "Card Game" }],
            ),
            3: makeBggResult(3, "Game Gamma", [{ id: 1, name: "Deck Building" }]),
          };
          const result = games[bggId];
          if (!result) return Promise.reject(new Error(`No game found with BGG ID ${bggId}`));
          return Promise.resolve(result);
        },
      });
      ctx = createTestApp({ bggClient });

      const axisRes = await jsonRequest(ctx.app, "POST", "/api/axes", {
        name: "Fun",
        weight: 50,
        source: "personal",
      });
      const axis = (await axisRes.json()) as Axis;

      const gameIds: string[] = [];
      const ratings = [9, 7, 5]; // Alpha=9, Beta=7, Gamma=5
      for (let i = 1; i <= 3; i++) {
        const res = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: `Game ${["Alpha", "Beta", "Gamma"][i - 1]}`,
          bggId: i,
        });
        expect(res.status).toBe(201);
        const { game } = (await res.json()) as { game: { id: string } };
        gameIds.push(game.id);

        await jsonRequest(ctx.app, "PUT", `/api/games/${game.id}/ratings`, {
          ratings: { [axis.id]: ratings[i - 1] },
        });
      }

      return { gameIds, axis };
    }

    describe("GET /api/games/:id nichePosition", () => {
      test("includes nichePosition with niche entries for a game in niches", async () => {
        const { gameIds } = await setupNicheCollection();

        const res = await jsonRequest(ctx.app, "GET", `/api/games/${gameIds[0]}`);
        expect(res.status).toBe(200);

        const body = (await res.json()) as GameWithScore;
        expect(body.nichePosition).toBeDefined();
        expect(body.nichePosition).not.toBeNull();

        const niches = body.nichePosition!.niches;
        expect(niches.length).toBeGreaterThan(0);

        // Alpha is highest rated, should be champion in Deck Building
        const deckBuilding = niches.find((n) => n.name === "Deck Building");
        expect(deckBuilding).toBeDefined();
        expect(deckBuilding!.rank).toBe(1);
        expect(deckBuilding!.isChampion).toBe(true);
        expect(deckBuilding!.size).toBe(3);
      });

      test("returns nichePosition: null for game without BGG data", async () => {
        // Add a manual game (no BGG data)
        const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: "Manual Game",
        });
        const { game } = (await addRes.json()) as { game: { id: string } };

        const res = await jsonRequest(ctx.app, "GET", `/api/games/${game.id}`);
        expect(res.status).toBe(200);

        const body = (await res.json()) as GameWithScore;
        expect(body.nichePosition).toBeNull();
      });

      test("niche entries sorted by size descending", async () => {
        const { gameIds } = await setupNicheCollection();

        // Alpha is in Deck Building (3 games) and Card Game (2 games)
        const res = await jsonRequest(ctx.app, "GET", `/api/games/${gameIds[0]}`);
        const body = (await res.json()) as GameWithScore;
        const niches = body.nichePosition!.niches;

        // Should have at least 2 niches (Deck Building size 3, Card Game size 2)
        expect(niches.length).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < niches.length - 1; i++) {
          if (niches[i].size === niches[i + 1].size) {
            // Same size: alphabetical
            expect(niches[i].name.localeCompare(niches[i + 1].name)).toBeLessThanOrEqual(0);
          } else {
            expect(niches[i].size).toBeGreaterThan(niches[i + 1].size);
          }
        }
      });

      test("neighbors are populated correctly", async () => {
        const { gameIds } = await setupNicheCollection();

        // Beta is rank 2 in Deck Building: above=[Alpha], below=[Gamma]
        const res = await jsonRequest(ctx.app, "GET", `/api/games/${gameIds[1]}`);
        const body = (await res.json()) as GameWithScore;
        const deckBuilding = body.nichePosition!.niches.find((n) => n.name === "Deck Building");

        expect(deckBuilding!.rank).toBe(2);
        expect(deckBuilding!.above.length).toBe(1);
        expect(deckBuilding!.above[0].gameName).toBe("Game Alpha");
        expect(deckBuilding!.below.length).toBe(1);
        expect(deckBuilding!.below[0].gameName).toBe("Game Gamma");
      });
    });

    describe("GET /api/games?includeNiches=true", () => {
      test("attaches nichePosition to each game when includeNiches=true", async () => {
        await setupNicheCollection();

        const res = await jsonRequest(ctx.app, "GET", "/api/games?includeNiches=true");
        expect(res.status).toBe(200);

        const games = (await res.json()) as GameWithScore[];
        for (const gws of games) {
          expect(gws.nichePosition).toBeDefined();
          // Every game has BGG data and a rating, so all should have niches
          expect(gws.nichePosition).not.toBeNull();
        }
      });

      test("nichePosition absent when includeNiches is not set", async () => {
        await setupNicheCollection();

        const res = await jsonRequest(ctx.app, "GET", "/api/games");
        expect(res.status).toBe(200);

        const games = (await res.json()) as GameWithScore[];
        for (const gws of games) {
          expect(gws.nichePosition).toBeUndefined();
        }
      });

      test("includeNiches without includePredicted returns standard list with niches", async () => {
        await setupNicheCollection();

        const withNiches = await jsonRequest(ctx.app, "GET", "/api/games?includeNiches=true");
        const withoutNiches = await jsonRequest(ctx.app, "GET", "/api/games");

        const gamesWithNiches = (await withNiches.json()) as GameWithScore[];
        const gamesWithout = (await withoutNiches.json()) as GameWithScore[];

        // Same games, same count
        expect(gamesWithNiches.length).toBe(gamesWithout.length);
        // But with niches attached
        expect(gamesWithNiches[0].nichePosition).toBeDefined();
        expect(gamesWithout[0].nichePosition).toBeUndefined();
      });

      test("includeNiches=true with includePredicted=true returns predicted games with niches", async () => {
        await setupNicheCollection();

        const res = await jsonRequest(
          ctx.app,
          "GET",
          "/api/games?includePredicted=true&includeNiches=true",
        );
        expect(res.status).toBe(200);

        const games = (await res.json()) as GameWithScore[];
        expect(games.length).toBe(3);
        for (const gws of games) {
          expect(gws.nichePosition).toBeDefined();
        }
      });
    });
  });
});

describe("PUT /api/games/:id/shelf-assignment", () => {
  beforeEach(() => {
    ctx = createTestApp();
  });

  async function setupMeasuredGame(): Promise<Game> {
    await ctx.storageService.saveShelfConfig({
      units: [
        {
          id: "unit-1",
          name: "Bookcase",
          shelves: [
            { id: "shelf-1", name: "Top", dimensionless: false, width: 30, height: 12, depth: 12 },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const { game } = await ctx.gameService.addGame({ name: "Measured" });
    return ctx.gameService.setBoxDimensions(game.id, { width: 10, height: 10, depth: 2 });
  }

  test("sets and clears a shelf assignment", async () => {
    const game = await setupMeasuredGame();
    const setResponse = await jsonRequest(
      ctx.app,
      "PUT",
      `/api/games/${game.id}/shelf-assignment`,
      { shelfId: "shelf-1" },
    );
    expect(setResponse.status).toBe(200);
    expect(((await setResponse.json()) as { game: Game }).game.manualShelfId).toBe("shelf-1");

    const clearResponse = await jsonRequest(
      ctx.app,
      "PUT",
      `/api/games/${game.id}/shelf-assignment`,
      { shelfId: null },
    );
    expect(clearResponse.status).toBe(200);
    expect(((await clearResponse.json()) as { game: Game }).game.manualShelfId).toBeNull();
  });

  test("returns stable client errors", async () => {
    const game = await setupMeasuredGame();
    const unknownShelf = await jsonRequest(
      ctx.app,
      "PUT",
      `/api/games/${game.id}/shelf-assignment`,
      { shelfId: "missing" },
    );
    expect(unknownShelf.status).toBe(404);

    const { game: unmeasured } = await ctx.gameService.addGame({ name: "Unmeasured" });
    const noDimensions = await jsonRequest(
      ctx.app,
      "PUT",
      `/api/games/${unmeasured.id}/shelf-assignment`,
      { shelfId: "shelf-1" },
    );
    expect(noDimensions.status).toBe(400);

    const previouslyOwned = await setupMeasuredGame();
    await ctx.gameService.setOwnership(previouslyOwned.id, "previously-owned");
    const wrongOwnership = await jsonRequest(
      ctx.app,
      "PUT",
      `/api/games/${previouslyOwned.id}/shelf-assignment`,
      { shelfId: "shelf-1" },
    );
    expect(wrongOwnership.status).toBe(400);

    const missingGame = await jsonRequest(ctx.app, "PUT", "/api/games/missing/shelf-assignment", {
      shelfId: null,
    });
    expect(missingGame.status).toBe(404);
  });

  test("rejects invalid request bodies", async () => {
    const game = await setupMeasuredGame();
    const response = await jsonRequest(
      ctx.app,
      "PUT",
      `/api/games/${game.id}/shelf-assignment`,
      {},
    );
    expect(response.status).toBe(400);
  });

  test("registers an idempotent operation", () => {
    const operation = ctx.operations.find(
      (candidate) => candidate.operationId === "shelf.game.shelf-assignment",
    );
    expect(operation?.invocation).toEqual({
      method: "PUT",
      path: "/api/games/:id/shelf-assignment",
    });
    expect(operation?.idempotent).toBe(true);
    expect(operation?.description).toContain("owned game with complete box dimensions");
  });
});
