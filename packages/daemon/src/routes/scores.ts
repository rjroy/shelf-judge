import { Hono } from "hono";
import type { GameService } from "../services/game-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";

export interface ScoreRoutesDeps {
  gameService: GameService;
}

export function createScoreRoutes(deps: ScoreRoutesDeps): RouteModule {
  const { gameService } = deps;
  const routes = new Hono();

  // GET /games/:id/score
  routes.get("/games/:id/score", async (c) => {
    const id = c.req.param("id");
    try {
      const { game, score } = await gameService.getGame(id);
      if (score === null) {
        return c.json({ gameId: game.id, gameName: game.name, score: null, status: "not yet rated" });
      }
      return c.json({ gameId: game.id, gameName: game.name, ...score });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // GET /scores
  routes.get("/scores", async (c) => {
    try {
      const games = await gameService.listGames();

      const scored = games.filter((g) => g.score !== null).map((g) => ({
        gameId: g.game.id,
        gameName: g.game.name,
        score: g.score!.score,
        ratedAxisCount: g.score!.ratedAxisCount,
        totalAxisCount: g.score!.totalAxisCount,
        breakdown: g.score!.breakdown,
      }));

      const unscored = games.filter((g) => g.score === null).map((g) => ({
        gameId: g.game.id,
        gameName: g.game.name,
        score: null as null,
        status: "not yet rated" as const,
      }));

      return c.json({ scored, unscored });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.score.get",
      name: "get",
      description: "Get fitness score with full breakdown for a game",
      invocation: { method: "GET", path: "/api/games/:id/score" },
      hierarchy: { root: "shelf", feature: "score" },
      parameters: [
        { name: "id", in: "path", description: "Game ID", required: true },
      ],
      idempotent: true,
    },
    {
      operationId: "shelf.score.list",
      name: "list",
      description: "Get all games ranked by fitness score",
      invocation: { method: "GET", path: "/api/scores" },
      hierarchy: { root: "shelf", feature: "score" },
      idempotent: true,
    },
  ];

  return { routes, operations };
}
