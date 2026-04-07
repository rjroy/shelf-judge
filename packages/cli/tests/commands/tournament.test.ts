import { describe, test, expect } from "bun:test";
import {
  tournamentStart,
  tournamentNext,
  tournamentPick,
  tournamentStop,
  tournamentStats,
  tournamentRecalculate,
  parseFilterFlags,
} from "../../src/commands/tournament.js";
import { createMockClient } from "../helpers/mock-client.js";

// --- parseFilterFlags unit tests ---

describe("parseFilterFlags", () => {
  test("parses name filter", () => {
    const result = parseFilterFlags(["name:wingspan"]);
    expect(result).toEqual([{ type: "name", value: "wingspan" }]);
  });

  test("parses fitness filter", () => {
    const result = parseFilterFlags(["fitness:7.5"]);
    expect(result).toEqual([{ type: "minFitness", value: "7.5" }]);
  });

  test("parses tag filter", () => {
    const result = parseFilterFlags(["tag:cooperative"]);
    expect(result).toEqual([{ type: "bggTag", value: "cooperative" }]);
  });

  test("parses stale filter", () => {
    const result = parseFilterFlags(["stale:3"]);
    expect(result).toEqual([{ type: "staleness", value: "3" }]);
  });

  test("parses multiple filters", () => {
    const result = parseFilterFlags(["name:wing", "fitness:6"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "name", value: "wing" });
    expect(result[1]).toEqual({ type: "minFitness", value: "6" });
  });

  test("returns empty array for no flags", () => {
    expect(parseFilterFlags([])).toEqual([]);
  });

  test("throws on missing colon", () => {
    expect(() => parseFilterFlags(["namevalue"])).toThrow("Expected type:value");
  });

  test("throws on unknown filter type", () => {
    expect(() => parseFilterFlags(["unknown:val"])).toThrow("Unknown filter type");
  });

  test("throws on empty value", () => {
    expect(() => parseFilterFlags(["name:"])).toThrow("requires a value");
  });

  test("handles value containing colons", () => {
    const result = parseFilterFlags(["name:game:with:colons"]);
    expect(result[0].value).toBe("game:with:colons");
  });
});

// --- tournament start ---

const startSessionData = {
  session: {
    id: "sess-1",
    filters: [{ type: "name", value: "wing" }],
    gameIds: ["g1", "g2", "g3", "g4", "g5"],
    comparisonCount: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
};

describe("tournament start", () => {
  const client = createMockClient({
    routes: {
      "POST /api/tournament/sessions": {
        response: { ok: true, status: 201, data: startSessionData },
      },
    },
  });

  test("human-readable output shows game count and filters", async () => {
    const output = await tournamentStart(client, [], {
      json: false,
      filterFlags: ["name:wing"],
    });
    expect(output).toContain("Session started");
    expect(output).toContain("5 games");
    expect(output).toContain("name:wing");
  });

  test("--json outputs parseable JSON", async () => {
    const output = await tournamentStart(client, [], {
      json: true,
      filterFlags: ["name:wing"],
    });
    const parsed = JSON.parse(output) as { session: { id: string; gameIds: string[] } };
    expect(parsed.session.id).toBe("sess-1");
    expect(parsed.session.gameIds).toHaveLength(5);
  });
});

// --- tournament next ---

const activeSession = {
  session: {
    id: "sess-1",
    filters: null,
    gameIds: ["g1", "g2", "g3", "g4"],
    comparisonCount: 2,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
};

const nextPairData = {
  gameA: { id: "g1", name: "Wingspan" },
  gameB: { id: "g2", name: "Gloomhaven" },
  gameAStats: {
    eloRating: 1520,
    comparisonCount: 3,
    normalizedScore: 7.2,
    isProvisional: true,
    displayLabel: "7.2 (provisional)",
    wins: 2,
    losses: 1,
    recentComparisons: [],
  },
  gameBStats: {
    eloRating: 1480,
    comparisonCount: 3,
    normalizedScore: 6.8,
    isProvisional: true,
    displayLabel: "6.8 (provisional)",
    wins: 1,
    losses: 2,
    recentComparisons: [],
  },
};

describe("tournament next", () => {
  const client = createMockClient({
    routes: {
      "GET /api/tournament/sessions/active": {
        response: { ok: true, status: 200, data: activeSession },
      },
      "GET /api/tournament/sessions/sess-1/next": {
        response: { ok: true, status: 200, data: nextPairData },
      },
    },
  });

  test("human-readable output shows two games in a table", async () => {
    const output = await tournamentNext(client, [], { json: false });
    expect(output).toContain("Which would you keep?");
    expect(output).toContain("Wingspan");
    expect(output).toContain("Gloomhaven");
    expect(output).toContain("sj tournament pick");
  });

  test("--json outputs parseable JSON with both games", async () => {
    const output = await tournamentNext(client, [], { json: true });
    const parsed = JSON.parse(output) as {
      gameA: { name: string };
      gameB: { name: string };
    };
    expect(parsed.gameA.name).toBe("Wingspan");
    expect(parsed.gameB.name).toBe("Gloomhaven");
  });
});

describe("tournament next (session complete)", () => {
  const client = createMockClient({
    routes: {
      "GET /api/tournament/sessions/active": {
        response: { ok: true, status: 200, data: activeSession },
      },
      "GET /api/tournament/sessions/sess-1/next": {
        response: { ok: true, status: 200, data: { done: true } },
      },
    },
  });

  test("human-readable output shows session complete", async () => {
    const output = await tournamentNext(client, [], { json: false });
    expect(output).toContain("Session complete");
  });

  test("--json outputs done: true", async () => {
    const output = await tournamentNext(client, [], { json: true });
    const parsed = JSON.parse(output) as { done: boolean };
    expect(parsed.done).toBe(true);
  });
});

// --- tournament pick ---

const comparisonData = {
  comparison: { id: "comp-1", winnerId: "g1" },
  updatedStats: {
    gameA: {
      eloRating: 1530,
      comparisonCount: 4,
      normalizedScore: 7.4,
      isProvisional: true,
      displayLabel: "7.4 (provisional)",
      wins: 3,
      losses: 1,
      recentComparisons: [],
    },
    gameB: {
      eloRating: 1470,
      comparisonCount: 4,
      normalizedScore: 6.6,
      isProvisional: true,
      displayLabel: "6.6 (provisional)",
      wins: 1,
      losses: 3,
      recentComparisons: [],
    },
  },
};

describe("tournament pick", () => {
  const client = createMockClient({
    routes: {
      "GET /api/tournament/sessions/active": {
        response: { ok: true, status: 200, data: activeSession },
      },
      "GET /api/tournament/sessions/sess-1/next": {
        response: { ok: true, status: 200, data: nextPairData },
      },
      "POST /api/tournament/sessions/sess-1/compare": {
        response: { ok: true, status: 200, data: comparisonData },
      },
    },
  });

  test("human-readable output shows winner name", async () => {
    const output = await tournamentPick(client, ["g1"], { json: false });
    expect(output).toContain("Picked: Wingspan");
  });

  test("--json outputs parseable JSON with comparison result", async () => {
    const output = await tournamentPick(client, ["g1"], { json: true });
    const parsed = JSON.parse(output) as {
      comparison: { winnerId: string };
      updatedStats: { gameA: { eloRating: number } };
    };
    expect(parsed.comparison.winnerId).toBe("g1");
    expect(parsed.updatedStats.gameA.eloRating).toBe(1530);
  });

  test("throws when no game-id provided", async () => {
    try {
      await tournamentPick(client, [], { json: false });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("Usage: sj tournament pick <game-id>");
    }
  });
});

// --- tournament stop ---

const endedSession = {
  session: {
    id: "sess-1",
    filters: null,
    gameIds: ["g1", "g2", "g3", "g4"],
    comparisonCount: 8,
    status: "completed",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T01:00:00Z",
  },
};

describe("tournament stop", () => {
  const client = createMockClient({
    routes: {
      "GET /api/tournament/sessions/active": {
        response: { ok: true, status: 200, data: activeSession },
      },
      "POST /api/tournament/sessions/sess-1/end": {
        response: { ok: true, status: 200, data: endedSession },
      },
    },
  });

  test("human-readable output shows session ended with comparison count", async () => {
    const output = await tournamentStop(client, [], { json: false });
    expect(output).toContain("Session ended");
    expect(output).toContain("8 comparisons");
  });

  test("--json outputs parseable JSON", async () => {
    const output = await tournamentStop(client, [], { json: true });
    const parsed = JSON.parse(output) as { session: { status: string; comparisonCount: number } };
    expect(parsed.session.status).toBe("completed");
    expect(parsed.session.comparisonCount).toBe(8);
  });
});

// --- tournament stats (single game) ---

const singleGameStats = {
  eloRating: 1580,
  comparisonCount: 12,
  normalizedScore: 8.1,
  isProvisional: false,
  displayLabel: "8.1",
  wins: 8,
  losses: 4,
  recentComparisons: [
    {
      opponentGameId: "g2",
      opponentGameName: "Gloomhaven",
      won: true,
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      opponentGameId: "g3",
      opponentGameName: "Catan",
      won: false,
      createdAt: "2026-01-01T00:01:00Z",
    },
  ],
};

describe("tournament stats (single game)", () => {
  const client = createMockClient({
    routes: {
      "GET /api/tournament/games/g1/stats": {
        response: { ok: true, status: 200, data: singleGameStats },
      },
    },
  });

  test("human-readable output shows ELO, rank, record, and recent comparisons", async () => {
    const output = await tournamentStats(client, ["g1"], { json: false });
    expect(output).toContain("ELO: 1580");
    expect(output).toContain("Rank: 8.1");
    expect(output).toContain("8W / 4L");
    expect(output).toContain("Recent comparisons:");
    expect(output).toContain("vs Gloomhaven - won");
    expect(output).toContain("vs Catan - lost");
  });

  test("--json outputs parseable JSON", async () => {
    const output = await tournamentStats(client, ["g1"], { json: true });
    const parsed = JSON.parse(output) as { eloRating: number; wins: number; losses: number };
    expect(parsed.eloRating).toBe(1580);
    expect(parsed.wins).toBe(8);
    expect(parsed.losses).toBe(4);
  });
});

// --- tournament stats (all games summary) ---

const allStatsData = [
  {
    gameId: "g1",
    gameName: "Wingspan",
    stats: {
      eloRating: 1580,
      comparisonCount: 12,
      normalizedScore: 8.1,
      isProvisional: false,
      displayLabel: "8.1",
      wins: 8,
      losses: 4,
      recentComparisons: [],
    },
  },
  {
    gameId: "g2",
    gameName: "Gloomhaven",
    stats: {
      eloRating: 1420,
      comparisonCount: 12,
      normalizedScore: 5.9,
      isProvisional: false,
      displayLabel: "5.9",
      wins: 4,
      losses: 8,
      recentComparisons: [],
    },
  },
  {
    gameId: "g3",
    gameName: "New Game",
    stats: {
      eloRating: 1500,
      comparisonCount: 0,
      normalizedScore: null,
      isProvisional: true,
      displayLabel: "not yet ranked",
      wins: 0,
      losses: 0,
      recentComparisons: [],
    },
  },
];

describe("tournament stats (all games)", () => {
  const client = createMockClient({
    routes: {
      "GET /api/tournament/stats": {
        response: { ok: true, status: 200, data: allStatsData },
      },
    },
  });

  test("human-readable output shows ranked table sorted by score", async () => {
    const output = await tournamentStats(client, [], { json: false });
    expect(output).toContain("#");
    expect(output).toContain("Name");
    expect(output).toContain("Rank");
    expect(output).toContain("Wingspan");
    expect(output).toContain("Gloomhaven");
    expect(output).toContain("not yet ranked");
    // Wingspan (8.1) should appear before Gloomhaven (5.9)
    const wingIdx = output.indexOf("Wingspan");
    const gloomIdx = output.indexOf("Gloomhaven");
    expect(wingIdx).toBeLessThan(gloomIdx);
  });

  test("--json outputs parseable JSON array", async () => {
    const output = await tournamentStats(client, [], { json: true });
    const parsed = JSON.parse(output) as Array<{ gameName: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });
});

// --- tournament recalculate ---

describe("tournament recalculate", () => {
  const client = createMockClient({
    routes: {
      "POST /api/tournament/recalculate": {
        response: { ok: true, status: 200, data: { gamesUpdated: 15 } },
      },
    },
  });

  test("human-readable output shows games updated count", async () => {
    const output = await tournamentRecalculate(client, [], { json: false });
    expect(output).toContain("Recalculated ELO for 15 game(s)");
  });

  test("--json outputs parseable JSON", async () => {
    const output = await tournamentRecalculate(client, [], { json: true });
    const parsed = JSON.parse(output) as { gamesUpdated: number };
    expect(parsed.gamesUpdated).toBe(15);
  });
});

// --- error cases ---

describe("tournament next (no active session)", () => {
  const client = createMockClient({
    routes: {
      "GET /api/tournament/sessions/active": {
        response: { ok: false, status: 404, data: { error: "No active session" } },
      },
    },
  });

  test("throws descriptive error", async () => {
    try {
      await tournamentNext(client, [], { json: false });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("No active session");
    }
  });
});

describe("tournament stop (no active session)", () => {
  const client = createMockClient({
    routes: {
      "GET /api/tournament/sessions/active": {
        response: { ok: false, status: 404, data: { error: "No active session" } },
      },
    },
  });

  test("throws descriptive error", async () => {
    try {
      await tournamentStop(client, [], { json: false });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("No active session");
    }
  });
});
