import { Hono } from "hono";
import {
  StartSessionSchema,
  SubmitComparisonSchema,
  TournamentSettingsUpdateSchema,
  toErrorMessage,
} from "@shelf-judge/shared";
import type { TournamentService } from "../services/tournament-service.js";
import type { GameService } from "../services/game-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";

export interface TournamentRoutesDeps {
  tournamentService: TournamentService;
  gameService: GameService;
}

export function createTournamentRoutes(deps: TournamentRoutesDeps): RouteModule {
  const { tournamentService, gameService } = deps;
  const routes = new Hono();

  // POST /tournament/sessions - Start a new session
  routes.post("/tournament/sessions", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const parsed = StartSessionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    try {
      const games = await gameService.listGames();
      const session = await tournamentService.startSession(parsed.data.filters, games);
      return c.json({ session }, 201);
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("At least 4 games")) {
        return c.json({ error: message }, 400);
      }
      return c.json({ error: message }, 500);
    }
  });

  // GET /tournament/sessions/active - Get the active session
  routes.get("/tournament/sessions/active", async (c) => {
    try {
      const session = await tournamentService.getActiveSession();
      if (!session) {
        return c.json({ error: "No active session" }, 404);
      }
      return c.json({ session });
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // GET /tournament/sessions - List all sessions
  routes.get("/tournament/sessions", async (c) => {
    try {
      const sessions = await tournamentService.listSessions();
      return c.json(sessions);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // POST /tournament/sessions/:id/end - End a session
  routes.post("/tournament/sessions/:id/end", async (c) => {
    const id = c.req.param("id");
    try {
      const session = await tournamentService.endSession(id);
      return c.json({ session });
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // GET /tournament/sessions/:id/next - Get next pair for comparison
  routes.get("/tournament/sessions/:id/next", async (c) => {
    const id = c.req.param("id");
    try {
      const pair = await tournamentService.getNextPair(id);
      if (!pair) {
        return c.json({ done: true });
      }

      const [gameAResult, gameBResult, gameAStats, gameBStats] = await Promise.all([
        gameService.getGame(pair.gameA),
        gameService.getGame(pair.gameB),
        tournamentService.getGameStats(pair.gameA),
        tournamentService.getGameStats(pair.gameB),
      ]);

      return c.json({
        gameA: gameAResult.game,
        gameB: gameBResult.game,
        gameAFitness: gameAResult.score?.score ?? null,
        gameBFitness: gameBResult.score?.score ?? null,
        gameAStats,
        gameBStats,
      });
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // POST /tournament/sessions/:id/compare - Submit comparison result
  routes.post("/tournament/sessions/:id/compare", async (c) => {
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = SubmitComparisonSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    try {
      const comparison = await tournamentService.submitComparison(
        id,
        parsed.data.gameAId,
        parsed.data.gameBId,
        parsed.data.winnerId,
      );

      const [gameAStats, gameBStats] = await Promise.all([
        tournamentService.getGameStats(parsed.data.gameAId),
        tournamentService.getGameStats(parsed.data.gameBId),
      ]);

      return c.json({
        comparison,
        updatedStats: { gameA: gameAStats, gameB: gameBStats },
      });
    } catch (err) {
      const message = toErrorMessage(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      if (
        message.includes("must be one of") ||
        message.includes("must be part of") ||
        message.includes("already completed")
      ) {
        return c.json({ error: message }, 400);
      }
      return c.json({ error: message }, 500);
    }
  });

  // GET /tournament/games/:id/stats - Tournament stats for a game (enriched with opponent names)
  routes.get("/tournament/games/:id/stats", async (c) => {
    const id = c.req.param("id");
    try {
      const [stats, games] = await Promise.all([
        tournamentService.getGameStats(id),
        gameService.listGames(),
      ]);

      const nameMap = new Map(games.map((g) => [g.game.id, g.game.name]));
      for (const comp of stats.recentComparisons) {
        comp.opponentGameName = nameMap.get(comp.opponentGameId) ?? null;
      }

      return c.json(stats);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // GET /tournament/stats - All game tournament stats (enriched with game names)
  routes.get("/tournament/stats", async (c) => {
    try {
      const [stats, games] = await Promise.all([
        tournamentService.getAllGameStats(),
        gameService.listGames(),
      ]);

      const nameMap = new Map(games.map((g) => [g.game.id, g.game.name]));
      const result = Object.entries(stats).map(([gameId, gameStats]) => ({
        gameId,
        gameName: nameMap.get(gameId) ?? "(deleted)",
        stats: gameStats,
      }));

      return c.json(result);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // POST /tournament/normalize-fitness - Normalize fitness scores based on current tournament ELO ratings
  routes.post("/tournament/normalize-fitness", async (c) => {
    try {
      const result = await tournamentService.normalizeFitness();
      return c.json(result);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // GET /tournament/settings - Get tournament settings
  routes.get("/tournament/settings", async (c) => {
    try {
      const settings = await tournamentService.getSettings();
      return c.json(settings);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  // PUT /tournament/settings - Update tournament settings
  routes.put("/tournament/settings", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = TournamentSettingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    try {
      const settings = await tournamentService.updateSettings(parsed.data);
      return c.json(settings);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.tournament.start-session",
      name: "start-session",
      description: "Start a new tournament session",
      invocation: { method: "POST", path: "/api/tournament/sessions" },
      hierarchy: { root: "shelf", feature: "tournament" },
      idempotent: false,
    },
    {
      operationId: "shelf.tournament.get-active",
      name: "get-active",
      description: "Get the active tournament session",
      invocation: { method: "GET", path: "/api/tournament/sessions/active" },
      hierarchy: { root: "shelf", feature: "tournament" },
      idempotent: true,
    },
    {
      operationId: "shelf.tournament.end-session",
      name: "end-session",
      description: "End a tournament session",
      invocation: { method: "POST", path: "/api/tournament/sessions/:id/end" },
      hierarchy: { root: "shelf", feature: "tournament" },
      parameters: [{ name: "id", in: "path", description: "Session ID", required: true }],
      idempotent: false,
    },
    {
      operationId: "shelf.tournament.list-sessions",
      name: "list-sessions",
      description: "List all tournament sessions",
      invocation: { method: "GET", path: "/api/tournament/sessions" },
      hierarchy: { root: "shelf", feature: "tournament" },
      idempotent: true,
    },
    {
      operationId: "shelf.tournament.next-pair",
      name: "next-pair",
      description: "Get the next pair for comparison in a session",
      invocation: { method: "GET", path: "/api/tournament/sessions/:id/next" },
      hierarchy: { root: "shelf", feature: "tournament" },
      parameters: [{ name: "id", in: "path", description: "Session ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.tournament.submit-comparison",
      name: "submit-comparison",
      description: "Submit a comparison result",
      invocation: { method: "POST", path: "/api/tournament/sessions/:id/compare" },
      hierarchy: { root: "shelf", feature: "tournament" },
      parameters: [{ name: "id", in: "path", description: "Session ID", required: true }],
      idempotent: false,
    },
    {
      operationId: "shelf.tournament.game-stats",
      name: "game-stats",
      description: "Get tournament stats for a specific game",
      invocation: { method: "GET", path: "/api/tournament/games/:id/stats" },
      hierarchy: { root: "shelf", feature: "tournament" },
      parameters: [{ name: "id", in: "path", description: "Game ID", required: true }],
      idempotent: true,
    },
    {
      operationId: "shelf.tournament.all-stats",
      name: "all-stats",
      description: "Get tournament stats for all games",
      invocation: { method: "GET", path: "/api/tournament/stats" },
      hierarchy: { root: "shelf", feature: "tournament" },
      idempotent: true,
    },
    {
      operationId: "shelf.tournament.get-settings",
      name: "get-settings",
      description: "Get tournament settings",
      invocation: { method: "GET", path: "/api/tournament/settings" },
      hierarchy: { root: "shelf", feature: "tournament" },
      idempotent: true,
    },
    {
      operationId: "shelf.tournament.update-settings",
      name: "update-settings",
      description: "Update tournament settings",
      invocation: { method: "PUT", path: "/api/tournament/settings" },
      hierarchy: { root: "shelf", feature: "tournament" },
      idempotent: true,
    },
  ];

  return { routes, operations };
}
