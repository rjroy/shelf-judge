import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, jsonRequest, type TestAppContext } from "../helpers/test-app.js";
import type {
  TournamentSession,
  TournamentSettings,
  TournamentGameStatsDisplay,
  Comparison,
  Game,
} from "@shelf-judge/shared";

let ctx: TestAppContext;

async function addGames(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const res = await jsonRequest(ctx.app, "POST", "/api/games", {
      name: `Game ${i + 1}`,
    });
    const body = (await res.json()) as { game: Game };
    ids.push(body.game.id);
  }
  return ids;
}

async function startSession(filters?: Array<{ type: string; value: string }>) {
  return jsonRequest(ctx.app, "POST", "/api/tournament/sessions", filters ? { filters } : {});
}

describe("Tournament Routes", () => {
  beforeEach(() => {
    ctx = createTestApp();
  });

  describe("POST /api/tournament/sessions", () => {
    test("starts a session with enough games", async () => {
      await addGames(5);
      const res = await startSession();
      expect(res.status).toBe(201);
      const body = (await res.json()) as { session: TournamentSession };
      expect(body.session).toBeDefined();
      expect(body.session.status).toBe("active");
      expect(body.session.gameIds.length).toBe(5);
    });

    test("returns 400 when fewer than 4 games exist", async () => {
      await addGames(3);
      const res = await startSession();
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
    });

    test("accepts filters in request body", async () => {
      await addGames(5);
      const res = await startSession([{ type: "name", value: "Game" }]);
      expect(res.status).toBe(201);
    });

    test("returns 400 for invalid filter type", async () => {
      await addGames(5);
      const res = await jsonRequest(ctx.app, "POST", "/api/tournament/sessions", {
        filters: [{ type: "invalid", value: "x" }],
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/tournament/sessions/active", () => {
    test("returns 404 when no active session", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/tournament/sessions/active");
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("No active session");
    });

    test("returns active session after starting one", async () => {
      await addGames(5);
      await startSession();

      const res = await jsonRequest(ctx.app, "GET", "/api/tournament/sessions/active");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { session: TournamentSession };
      expect(body.session.status).toBe("active");
    });
  });

  describe("GET /api/tournament/sessions", () => {
    test("returns empty array initially", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/tournament/sessions");
      expect(res.status).toBe(200);
      const body = (await res.json()) as TournamentSession[];
      expect(body).toEqual([]);
    });

    test("returns sessions after creating one", async () => {
      await addGames(5);
      await startSession();

      const res = await jsonRequest(ctx.app, "GET", "/api/tournament/sessions");
      expect(res.status).toBe(200);
      const body = (await res.json()) as TournamentSession[];
      expect(body.length).toBe(1);
    });
  });

  describe("POST /api/tournament/sessions/:id/end", () => {
    test("ends an active session", async () => {
      await addGames(5);
      const startRes = await startSession();
      const { session } = (await startRes.json()) as { session: TournamentSession };

      const res = await jsonRequest(ctx.app, "POST", `/api/tournament/sessions/${session.id}/end`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { session: TournamentSession };
      expect(body.session.status).toBe("completed");
    });

    test("returns 404 for non-existent session", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/tournament/sessions/nonexistent/end");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/tournament/sessions/:id/next", () => {
    test("returns a pair of games with stats", async () => {
      await addGames(5);
      const startRes = await startSession();
      const { session } = (await startRes.json()) as { session: TournamentSession };

      const res = await jsonRequest(ctx.app, "GET", `/api/tournament/sessions/${session.id}/next`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        gameA: Game;
        gameB: Game;
        gameAFitness: number | null;
        gameBFitness: number | null;
        gameAStats: TournamentGameStatsDisplay;
        gameBStats: TournamentGameStatsDisplay;
      };
      expect(body.gameA).toBeDefined();
      expect(body.gameB).toBeDefined();
      expect(body.gameA.id).not.toBe(body.gameB.id);
      expect(body.gameAStats).toBeDefined();
      expect(body.gameBStats).toBeDefined();
      // Fitness scores included (null when no axis ratings)
      expect("gameAFitness" in body).toBe(true);
      expect("gameBFitness" in body).toBe(true);
    });

    test("returns 404 for non-existent session", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/tournament/sessions/nonexistent/next");
      expect(res.status).toBe(404);
    });

    test("returns done:true when all pairs are exhausted", async () => {
      // 4 games = C(4,2) = 6 comparisons to exhaust all pairs
      await addGames(4);
      const startRes = await startSession();
      const { session } = (await startRes.json()) as { session: TournamentSession };

      // Submit all 6 pair comparisons
      for (let i = 0; i < 6; i++) {
        const nextRes = await jsonRequest(
          ctx.app,
          "GET",
          `/api/tournament/sessions/${session.id}/next`,
        );
        const pair = (await nextRes.json()) as { gameA: Game; gameB: Game; done?: boolean };
        if (pair.done) break;

        await jsonRequest(ctx.app, "POST", `/api/tournament/sessions/${session.id}/compare`, {
          gameAId: pair.gameA.id,
          gameBId: pair.gameB.id,
          winnerId: pair.gameA.id,
        });
      }

      // Next request should return done
      const doneRes = await jsonRequest(
        ctx.app,
        "GET",
        `/api/tournament/sessions/${session.id}/next`,
      );
      expect(doneRes.status).toBe(200);
      const body = (await doneRes.json()) as { done: boolean };
      expect(body.done).toBe(true);
    });
  });

  describe("POST /api/tournament/sessions/:id/compare", () => {
    test("submits a comparison and returns updated stats", async () => {
      await addGames(5);
      const startRes = await startSession();
      const { session } = (await startRes.json()) as { session: TournamentSession };

      // Get next pair
      const nextRes = await jsonRequest(
        ctx.app,
        "GET",
        `/api/tournament/sessions/${session.id}/next`,
      );
      const pair = (await nextRes.json()) as { gameA: Game; gameB: Game };

      // Submit comparison
      const res = await jsonRequest(
        ctx.app,
        "POST",
        `/api/tournament/sessions/${session.id}/compare`,
        {
          gameAId: pair.gameA.id,
          gameBId: pair.gameB.id,
          winnerId: pair.gameA.id,
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        comparison: Comparison;
        updatedStats: {
          gameA: TournamentGameStatsDisplay;
          gameB: TournamentGameStatsDisplay;
        };
      };
      expect(body.comparison).toBeDefined();
      expect(body.comparison.winnerId).toBe(pair.gameA.id);
      expect(body.updatedStats.gameA).toBeDefined();
      expect(body.updatedStats.gameB).toBeDefined();
    });

    test("returns 400 for invalid winnerId", async () => {
      await addGames(5);
      const startRes = await startSession();
      const { session } = (await startRes.json()) as { session: TournamentSession };

      const res = await jsonRequest(
        ctx.app,
        "POST",
        `/api/tournament/sessions/${session.id}/compare`,
        {
          gameAId: "a",
          gameBId: "b",
          winnerId: "c",
        },
      );
      expect(res.status).toBe(400);
    });

    test("returns 400 for missing fields", async () => {
      await addGames(5);
      const startRes = await startSession();
      const { session } = (await startRes.json()) as { session: TournamentSession };

      const res = await jsonRequest(
        ctx.app,
        "POST",
        `/api/tournament/sessions/${session.id}/compare`,
        { gameAId: "a" },
      );
      expect(res.status).toBe(400);
    });

    test("returns 404 for non-existent session", async () => {
      const res = await jsonRequest(
        ctx.app,
        "POST",
        "/api/tournament/sessions/nonexistent/compare",
        {
          gameAId: "a",
          gameBId: "b",
          winnerId: "a",
        },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/tournament/games/:id/stats", () => {
    test("returns stats for a game", async () => {
      const ids = await addGames(1);
      const res = await jsonRequest(ctx.app, "GET", `/api/tournament/games/${ids[0]}/stats`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as TournamentGameStatsDisplay;
      expect(body.eloRating).toBe(1500);
      expect(body.comparisonCount).toBe(0);
    });

    test("recent comparisons include opponent game names", async () => {
      const ids = await addGames(5);
      const startRes = await startSession();
      const { session } = (await startRes.json()) as { session: TournamentSession };

      const nextRes = await jsonRequest(
        ctx.app,
        "GET",
        `/api/tournament/sessions/${session.id}/next`,
      );
      const pair = (await nextRes.json()) as { gameA: Game; gameB: Game };
      await jsonRequest(ctx.app, "POST", `/api/tournament/sessions/${session.id}/compare`, {
        gameAId: pair.gameA.id,
        gameBId: pair.gameB.id,
        winnerId: pair.gameA.id,
      });

      const res = await jsonRequest(ctx.app, "GET", `/api/tournament/games/${pair.gameA.id}/stats`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as TournamentGameStatsDisplay;
      expect(body.recentComparisons.length).toBe(1);
      expect(body.recentComparisons[0].opponentGameName).toBeTruthy();
    });
  });

  describe("GET /api/tournament/stats", () => {
    test("returns empty array initially", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/tournament/stats");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        gameId: string;
        gameName: string;
        stats: TournamentGameStatsDisplay;
      }>;
      expect(body).toEqual([]);
    });

    test("returns enriched array with gameId and gameName after comparisons", async () => {
      const ids = await addGames(5);
      const startRes = await startSession();
      const { session } = (await startRes.json()) as { session: TournamentSession };

      // Get and submit one comparison
      const nextRes = await jsonRequest(
        ctx.app,
        "GET",
        `/api/tournament/sessions/${session.id}/next`,
      );
      const pair = (await nextRes.json()) as { gameA: Game; gameB: Game };
      await jsonRequest(ctx.app, "POST", `/api/tournament/sessions/${session.id}/compare`, {
        gameAId: pair.gameA.id,
        gameBId: pair.gameB.id,
        winnerId: pair.gameA.id,
      });

      const res = await jsonRequest(ctx.app, "GET", "/api/tournament/stats");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        gameId: string;
        gameName: string;
        stats: TournamentGameStatsDisplay;
      }>;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);
      for (const entry of body) {
        expect(entry.gameId).toBeTruthy();
        expect(entry.gameName).toBeTruthy();
        expect(entry.stats.eloRating).toBeDefined();
      }
    });
  });

  describe("POST /api/tournament/recalculate", () => {
    test("recalculates and returns games updated count", async () => {
      const res = await jsonRequest(ctx.app, "POST", "/api/tournament/recalculate");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { gamesUpdated: number };
      expect(body.gamesUpdated).toBe(0);
    });
  });

  describe("GET /api/tournament/settings", () => {
    test("returns default settings", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/tournament/settings");
      expect(res.status).toBe(200);
      const body = (await res.json()) as TournamentSettings;
      expect(body.kFactorThreshold).toBe(15);
      expect(body.normalizationHalfWidth).toBe(400);
      expect(body.provisionalThreshold).toBe(6);
    });
  });

  describe("PUT /api/tournament/settings", () => {
    test("updates settings partially", async () => {
      const res = await jsonRequest(ctx.app, "PUT", "/api/tournament/settings", {
        kFactorThreshold: 20,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as TournamentSettings;
      expect(body.kFactorThreshold).toBe(20);
      expect(body.normalizationHalfWidth).toBe(400);
    });

    test("returns 400 for unknown fields (strict mode)", async () => {
      const res = await jsonRequest(ctx.app, "PUT", "/api/tournament/settings", {
        kFactorThreshold: 20,
        garbage: true,
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Validation failed");
    });

    test("returns 400 for wrong field types", async () => {
      const res = await jsonRequest(ctx.app, "PUT", "/api/tournament/settings", {
        kFactorThreshold: "banana",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Validation failed");
    });

    test("returns 400 for invalid JSON", async () => {
      const res = await ctx.app.request(
        new Request("http://localhost/api/tournament/settings", {
          method: "PUT",
          body: "not json",
          headers: { "Content-Type": "application/json" },
        }),
      );
      expect(res.status).toBe(400);
    });
  });
});
