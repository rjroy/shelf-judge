import { describe, test, expect, beforeEach } from "bun:test";
import { createTournamentService } from "../src/services/tournament-service.js";
import type { TournamentService } from "../src/services/tournament-service.js";
import type { StorageService } from "../src/services/storage-service.js";
import type { TournamentData, Game, BggGameData, GameWithScore } from "@shelf-judge/shared";

// In-memory storage stub for tournament data
function createStubStorage(): StorageService & { tournamentData: TournamentData } {
  const defaultData: TournamentData = {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
    sessions: [],
    comparisons: [],
    gameStats: {},
  };

  const stub = {
    tournamentData: structuredClone(defaultData),

    loadTournament(): Promise<TournamentData> {
      return Promise.resolve(structuredClone(stub.tournamentData));
    },

    saveTournament(data: TournamentData): Promise<void> {
      stub.tournamentData = structuredClone(data);
      return Promise.resolve();
    },

    // Unused stubs required by the interface
    loadCollection(): Promise<never> {
      return Promise.resolve({} as never);
    },
    saveCollection(): Promise<void> {
      return Promise.resolve();
    },
    loadConfig(): Promise<never> {
      return Promise.resolve({} as never);
    },
    saveConfig(): Promise<void> {
      return Promise.resolve();
    },
  };

  return stub;
}

function makeGame(id: string, name: string, overrides?: Partial<Game>): Game {
  const now = new Date().toISOString();
  return {
    id,
    bggId: null,
    name,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    ratings: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeGameWithScore(
  id: string,
  name: string,
  score: number | null = null,
  overrides?: Partial<Game>,
): GameWithScore {
  return {
    game: makeGame(id, name, overrides),
    score: score !== null ? { score, ratedAxisCount: 1, totalAxisCount: 1, breakdown: [] } : null,
  };
}

function makeBggData(mechanics: string[] = [], categories: string[] = []): BggGameData {
  return {
    communityRating: 7.0,
    bayesAverage: 6.5,
    weight: 3.0,
    numWeightVotes: 100,
    mechanics: mechanics.map((name, i) => ({ id: i + 1, name })),
    categories: categories.map((name, i) => ({ id: i + 100, name })),
    subdomains: [],
    suggestedPlayerCounts: [],
    fetchedAt: new Date().toISOString(),
  };
}

describe("TournamentService", () => {
  let storage: ReturnType<typeof createStubStorage>;
  let service: TournamentService;

  const games = [
    makeGameWithScore("g1", "Alpha"),
    makeGameWithScore("g2", "Beta"),
    makeGameWithScore("g3", "Gamma"),
    makeGameWithScore("g4", "Delta"),
    makeGameWithScore("g5", "Epsilon"),
  ];

  beforeEach(() => {
    storage = createStubStorage();
    service = createTournamentService({ storageService: storage });
  });

  describe("startSession", () => {
    test("creates session with no filters", async () => {
      const session = await service.startSession(null, games);
      expect(session.status).toBe("active");
      expect(session.gameIds).toHaveLength(5);
      expect(session.comparisonCount).toBe(0);
      expect(session.filters).toBeNull();
    });

    test("rejects when fewer than 4 games match", async () => {
      const twoGames = games.slice(0, 2);
      try {
        await service.startSession(null, twoGames);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("At least 4 games are required");
      }
    });

    test("completes previous active session when starting a new one", async () => {
      const first = await service.startSession(null, games);
      expect(first.status).toBe("active");

      const second = await service.startSession(null, games);
      expect(second.status).toBe("active");

      // First session should now be completed
      const sessions = await service.listSessions();
      const firstUpdated = sessions.find((s) => s.id === first.id);
      expect(firstUpdated?.status).toBe("completed");
    });

    test("filters by name (case-insensitive substring)", async () => {
      // Alpha, Beta, Gamma, Delta all contain 'a'. Epsilon does not.
      const session = await service.startSession([{ type: "name", value: "a" }], games);
      expect(session.gameIds).toHaveLength(4);
      expect(session.gameIds).not.toContain("g5"); // Epsilon
    });

    test("filters by minFitness rejects when too few games", async () => {
      const scoredGames = [
        makeGameWithScore("g1", "Alpha", 8.0),
        makeGameWithScore("g2", "Beta", 6.0),
        makeGameWithScore("g3", "Gamma", 7.5),
        makeGameWithScore("g4", "Delta", 9.0),
        makeGameWithScore("g5", "Epsilon", null),
      ];
      try {
        await service.startSession([{ type: "minFitness", value: "7.0" }], scoredGames);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("At least 4 games are required");
      }
    });

    test("filters by minFitness allows when enough games", async () => {
      const scoredGames = [
        makeGameWithScore("g1", "Alpha", 8.0),
        makeGameWithScore("g2", "Beta", 7.0),
        makeGameWithScore("g3", "Gamma", 7.5),
        makeGameWithScore("g4", "Delta", 9.0),
        makeGameWithScore("g5", "Epsilon", null),
      ];
      const session = await service.startSession(
        [{ type: "minFitness", value: "7.0" }],
        scoredGames,
      );
      expect(session.gameIds).toHaveLength(4);
      expect(session.gameIds).not.toContain("g5");
    });

    test("filters by bggTag with fuzzy token matching (positive: 'deck building' matches 'Deck, Bag, and Pool Building')", async () => {
      const bggGames = [
        makeGameWithScore("g1", "Alpha", null, {
          bggData: makeBggData(["Deck, Bag, and Pool Building"], []),
        }),
        makeGameWithScore("g2", "Beta", null, {
          bggData: makeBggData(["Deck, Bag, and Pool Building"], ["Strategy"]),
        }),
        makeGameWithScore("g3", "Gamma", null, {
          bggData: makeBggData(["Worker Placement"], []),
        }),
        makeGameWithScore("g4", "Delta", null, {
          bggData: makeBggData(["Deck, Bag, and Pool Building"], []),
        }),
        makeGameWithScore("g5", "Epsilon", null, { bggData: makeBggData([], []) }),
        makeGameWithScore("g6", "Zeta", null, {
          bggData: makeBggData([], ["Deck, Bag, and Pool Building"]),
        }),
      ];
      const session = await service.startSession(
        [{ type: "bggTag", value: "deck building" }],
        bggGames,
      );
      expect(session.gameIds).toHaveLength(4);
      expect(session.gameIds).toContain("g1");
      expect(session.gameIds).toContain("g2");
      expect(session.gameIds).toContain("g4");
      expect(session.gameIds).toContain("g6");
      expect(session.gameIds).not.toContain("g3");
      expect(session.gameIds).not.toContain("g5");
    });

    test("filters by bggTag rejects when query token has no substring match (negative: 'decks building')", async () => {
      const bggGames = [
        makeGameWithScore("g1", "Alpha", null, {
          bggData: makeBggData(["Deck, Bag, and Pool Building"], []),
        }),
        makeGameWithScore("g2", "Beta", null, {
          bggData: makeBggData(["Deck, Bag, and Pool Building"], []),
        }),
        makeGameWithScore("g3", "Gamma", null, {
          bggData: makeBggData(["Deck, Bag, and Pool Building"], []),
        }),
        makeGameWithScore("g4", "Delta", null, {
          bggData: makeBggData(["Deck, Bag, and Pool Building"], []),
        }),
      ];
      try {
        await service.startSession([{ type: "bggTag", value: "decks building" }], bggGames);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("only 0 matched");
      }
    });

    test("filters by bggTag enforces per-tag matching (negative: 'worker deck' across two mechanics)", async () => {
      const bggGames = [
        makeGameWithScore("g1", "Alpha", null, {
          bggData: makeBggData(["Worker Placement", "Deck Building"], []),
        }),
        makeGameWithScore("g2", "Beta", null, {
          bggData: makeBggData(["Worker Placement", "Deck Building"], []),
        }),
        makeGameWithScore("g3", "Gamma", null, {
          bggData: makeBggData(["Worker Placement", "Deck Building"], []),
        }),
        makeGameWithScore("g4", "Delta", null, {
          bggData: makeBggData(["Worker Placement", "Deck Building"], []),
        }),
      ];
      try {
        await service.startSession([{ type: "bggTag", value: "worker deck" }], bggGames);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("only 0 matched");
      }
    });

    test("filters by bggTag with empty value matches no games", async () => {
      const bggGames = [
        makeGameWithScore("g1", "Alpha", null, { bggData: makeBggData(["Deck Building"], []) }),
        makeGameWithScore("g2", "Beta", null, { bggData: makeBggData(["Deck Building"], []) }),
        makeGameWithScore("g3", "Gamma", null, { bggData: makeBggData(["Deck Building"], []) }),
        makeGameWithScore("g4", "Delta", null, { bggData: makeBggData(["Deck Building"], []) }),
      ];
      try {
        await service.startSession([{ type: "bggTag", value: "" }], bggGames);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("only 0 matched");
      }
    });

    test("filters by staleness (games with low comparison count)", async () => {
      // Pre-seed some stats
      storage.tournamentData.gameStats = {
        g1: { eloRating: 1550, comparisonCount: 10 },
        g2: { eloRating: 1500, comparisonCount: 3 },
        g3: { eloRating: 1480, comparisonCount: 0 },
        // g4 and g5 have no stats (count=0, always match)
      };

      const session = await service.startSession([{ type: "staleness", value: "5" }], games);
      // g1 has 10 comparisons (>= 5), excluded
      // g2 has 3 (< 5), included
      // g3 has 0 (< 5), included
      // g4 no stats, included
      // g5 no stats, included
      expect(session.gameIds).not.toContain("g1");
      expect(session.gameIds).toContain("g2");
      expect(session.gameIds).toContain("g3");
      expect(session.gameIds).toContain("g4");
      expect(session.gameIds).toContain("g5");
    });

    test("AND-combines multiple filters", async () => {
      const bggGames = [
        makeGameWithScore("g1", "Alpha Game", 8.0, { bggData: makeBggData(["Deck Building"], []) }),
        makeGameWithScore("g2", "Beta Game", 7.5, { bggData: makeBggData(["Deck Building"], []) }),
        makeGameWithScore("g3", "Gamma Game", 9.0, { bggData: makeBggData(["Deck Building"], []) }),
        makeGameWithScore("g4", "Delta Game", 8.5, { bggData: makeBggData(["Deck Building"], []) }),
        makeGameWithScore("g5", "Epsilon", 6.0, { bggData: makeBggData(["Deck Building"], []) }),
      ];
      const session = await service.startSession(
        [
          { type: "bggTag", value: "deck building" },
          { type: "minFitness", value: "7.0" },
        ],
        bggGames,
      );
      // All have Deck Building. Alpha(8), Beta(7.5), Gamma(9), Delta(8.5) pass minFitness.
      // Epsilon(6) doesn't. 4 games remain.
      expect(session.gameIds).toHaveLength(4);
      expect(session.gameIds).not.toContain("g5");
    });

    test("persists session via atomic write", async () => {
      await service.startSession(null, games);
      // Verify the data was saved
      expect(storage.tournamentData.sessions).toHaveLength(1);
      expect(storage.tournamentData.sessions[0].status).toBe("active");
    });
  });

  describe("getActiveSession / endSession", () => {
    test("returns null when no active session", async () => {
      const result = await service.getActiveSession();
      expect(result).toBeNull();
    });

    test("returns active session", async () => {
      const session = await service.startSession(null, games);
      const active = await service.getActiveSession();
      expect(active?.id).toBe(session.id);
    });

    test("endSession marks session completed", async () => {
      const session = await service.startSession(null, games);
      const ended = await service.endSession(session.id);
      expect(ended.status).toBe("completed");

      const active = await service.getActiveSession();
      expect(active).toBeNull();
    });

    test("endSession throws for unknown session", async () => {
      try {
        await service.endSession("nonexistent");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("Session not found");
      }
    });

    test("endSession throws for already-completed session", async () => {
      const session = await service.startSession(null, games);
      await service.endSession(session.id);
      try {
        await service.endSession(session.id);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("Session already completed");
      }
    });
  });

  describe("adaptive pairing", () => {
    test("prioritizes games with 0 comparisons", async () => {
      // Give g1 and g2 existing stats, leave g3-g5 at 0
      storage.tournamentData.gameStats = {
        g1: { eloRating: 1600, comparisonCount: 10 },
        g2: { eloRating: 1400, comparisonCount: 8 },
      };

      const session = await service.startSession(null, games);
      const pair = await service.getNextPair(session.id);

      // The pair should include games with 0 comparisons (g3, g4, or g5)
      // because their sum (0+0=0) is lower than any pair involving g1(10) or g2(8)
      expect(pair).not.toBeNull();
      const pairGames = [pair!.gameA, pair!.gameB];
      const zeroCompGames = ["g3", "g4", "g5"];
      expect(pairGames.some((g) => zeroCompGames.includes(g))).toBe(true);
    });

    test("throws for non-existent session", async () => {
      try {
        await service.getNextPair("nonexistent");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("Session not found");
      }
    });

    test("does not repeat pairs within the same session", async () => {
      const fourGames = games.slice(0, 4);
      const session = await service.startSession(null, fourGames);

      const seenPairs = new Set<string>();
      // 4 games = 6 possible pairs. After 6 comparisons, should be exhausted.
      for (let i = 0; i < 6; i++) {
        const pair = await service.getNextPair(session.id);
        if (!pair) break;

        const key = [pair.gameA, pair.gameB].sort().join("|");
        expect(seenPairs.has(key)).toBe(false);
        seenPairs.add(key);

        // Submit so we can get the next pair
        await service.submitComparison(session.id, pair.gameA, pair.gameB, pair.gameA);
      }

      // After exhausting all 6 pairs, next call returns null (session auto-completed)
      const exhausted = await service.getNextPair(session.id);
      expect(exhausted).toBeNull();
    });

    test("returns null and completes session when all pairs exhausted", async () => {
      const fourGames = games.slice(0, 4);
      const session = await service.startSession(null, fourGames);

      // Submit all 6 possible pairs
      for (let i = 0; i < 6; i++) {
        const pair = await service.getNextPair(session.id);
        if (!pair) break;
        await service.submitComparison(session.id, pair.gameA, pair.gameB, pair.gameA);
      }

      // One more getNextPair triggers auto-complete when no candidates remain
      const exhausted = await service.getNextPair(session.id);
      expect(exhausted).toBeNull();

      const sessions = await service.listSessions();
      const updated = sessions.find((s) => s.id === session.id);
      expect(updated?.status).toBe("completed");
    });
  });

  describe("submitComparison", () => {
    test("records comparison and updates ELO", async () => {
      const session = await service.startSession(null, games);
      const comparison = await service.submitComparison(session.id, "g1", "g2", "g1");

      expect(comparison.gameAId).toBe("g1");
      expect(comparison.gameBId).toBe("g2");
      expect(comparison.winnerId).toBe("g1");
      expect(comparison.sessionId).toBe(session.id);

      // Check that ELO was updated
      const stats = storage.tournamentData.gameStats;
      expect(stats["g1"].eloRating).toBeGreaterThan(1500);
      expect(stats["g2"].eloRating).toBeLessThan(1500);
      expect(stats["g1"].comparisonCount).toBe(1);
      expect(stats["g2"].comparisonCount).toBe(1);
    });

    test("increments session comparisonCount", async () => {
      const session = await service.startSession(null, games);
      await service.submitComparison(session.id, "g1", "g2", "g1");
      await service.submitComparison(session.id, "g3", "g4", "g3");

      const sessions = await service.listSessions();
      const updated = sessions.find((s) => s.id === session.id);
      expect(updated?.comparisonCount).toBe(2);
    });

    test("throws for completed session", async () => {
      const session = await service.startSession(null, games);
      await service.endSession(session.id);
      try {
        await service.submitComparison(session.id, "g1", "g2", "g1");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("Session already completed");
      }
    });

    test("throws for invalid winnerId", async () => {
      const session = await service.startSession(null, games);
      try {
        await service.submitComparison(session.id, "g1", "g2", "g999");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("winnerId must be one of the compared games");
      }
    });

    test("throws for games not in session", async () => {
      const session = await service.startSession(null, games.slice(0, 4));
      try {
        await service.submitComparison(session.id, "g1", "g5", "g1");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("Both games must be part of the active session");
      }
    });
  });

  describe("game deletion", () => {
    test("retains comparisons involving deleted game", async () => {
      const session = await service.startSession(null, games);
      await service.submitComparison(session.id, "g1", "g2", "g1");

      await service.onGameDeleted("g1");

      // Comparisons should still exist
      expect(storage.tournamentData.comparisons).toHaveLength(1);
      expect(storage.tournamentData.comparisons[0].gameAId).toBe("g1");
    });

    test("removes cached ELO for deleted game", async () => {
      const session = await service.startSession(null, games);
      await service.submitComparison(session.id, "g1", "g2", "g1");

      expect(storage.tournamentData.gameStats["g1"]).toBeDefined();
      await service.onGameDeleted("g1");
      expect(storage.tournamentData.gameStats["g1"]).toBeUndefined();
    });

    test("removes deleted game from active session gameIds", async () => {
      await service.startSession(null, games);
      expect(storage.tournamentData.sessions[0].gameIds).toContain("g1");

      await service.onGameDeleted("g1");
      expect(storage.tournamentData.sessions[0].gameIds).not.toContain("g1");
    });

    test("auto-completes session when deletions reduce available games below 4", async () => {
      const fourGames = games.slice(0, 4);
      await service.startSession(null, fourGames);
      expect(storage.tournamentData.sessions[0].status).toBe("active");

      // Delete one game, reducing to 3
      await service.onGameDeleted("g1");
      expect(storage.tournamentData.sessions[0].status).toBe("completed");
    });

    test("does not auto-complete when 4+ games remain after deletion", async () => {
      await service.startSession(null, games); // 5 games
      await service.onGameDeleted("g1"); // 4 remain
      expect(storage.tournamentData.sessions[0].status).toBe("active");
    });
  });

  describe("getGameStats / getAllGameStats", () => {
    test("returns default stats for unranked game", async () => {
      const stats = await service.getGameStats("unknown-id");
      expect(stats.eloRating).toBe(1500);
      expect(stats.comparisonCount).toBe(0);
      expect(stats.displayLabel).toBe("not yet ranked");
      expect(stats.normalizedScore).toBeNull();
      expect(stats.wins).toBe(0);
      expect(stats.losses).toBe(0);
      expect(stats.recentComparisons).toHaveLength(0);
    });

    test("derives wins/losses from comparisons", async () => {
      const session = await service.startSession(null, games);
      await service.submitComparison(session.id, "g1", "g2", "g1"); // g1 wins
      await service.submitComparison(session.id, "g1", "g3", "g3"); // g1 loses
      await service.submitComparison(session.id, "g1", "g4", "g1"); // g1 wins

      const stats = await service.getGameStats("g1");
      expect(stats.wins).toBe(2);
      expect(stats.losses).toBe(1);
      expect(stats.recentComparisons).toHaveLength(3);
    });

    test("getAllGameStats returns stats for all tracked games", async () => {
      const session = await service.startSession(null, games);
      await service.submitComparison(session.id, "g1", "g2", "g1");

      const allStats = await service.getAllGameStats();
      expect(Object.keys(allStats)).toContain("g1");
      expect(Object.keys(allStats)).toContain("g2");
      expect(allStats["g1"].eloRating).toBeGreaterThan(1500);
    });
  });

  describe("recalculate", () => {
    test("rebuilds gameStats from comparison history", async () => {
      const session = await service.startSession(null, games);
      await service.submitComparison(session.id, "g1", "g2", "g1");
      await service.submitComparison(session.id, "g3", "g4", "g3");

      // Capture current stats
      const beforeG1 = storage.tournamentData.gameStats["g1"].eloRating;
      const beforeG3 = storage.tournamentData.gameStats["g3"].eloRating;

      // Corrupt stats manually
      storage.tournamentData.gameStats["g1"].eloRating = 9999;

      const result = await service.recalculate();
      expect(result.gamesUpdated).toBe(4);

      // Should match the original incremental results
      expect(storage.tournamentData.gameStats["g1"].eloRating).toBeCloseTo(beforeG1, 5);
      expect(storage.tournamentData.gameStats["g3"].eloRating).toBeCloseTo(beforeG3, 5);
    });
  });

  describe("settings", () => {
    test("returns default settings", async () => {
      const settings = await service.getSettings();
      expect(settings.kFactorThreshold).toBe(15);
      expect(settings.normalizationHalfWidth).toBe(400);
      expect(settings.provisionalThreshold).toBe(6);
    });

    test("updates settings with partial patch", async () => {
      const updated = await service.updateSettings({ kFactorThreshold: 20 });
      expect(updated.kFactorThreshold).toBe(20);
      expect(updated.normalizationHalfWidth).toBe(400); // Unchanged
    });
  });

  describe("atomic writes", () => {
    test("saveTournament is called on every mutation", async () => {
      let saveCount = 0;
      const originalSave = storage.saveTournament.bind(storage);
      storage.saveTournament = async (data: TournamentData) => {
        saveCount++;
        await originalSave(data);
      };

      await service.startSession(null, games);
      expect(saveCount).toBe(1);

      const sessions = await service.listSessions();
      const sessionId = sessions[0].id;

      await service.submitComparison(sessionId, "g1", "g2", "g1");
      expect(saveCount).toBe(2);

      await service.endSession(sessionId);
      expect(saveCount).toBe(3);
    });
  });
});
