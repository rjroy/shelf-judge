import { describe, expect, test } from "bun:test";
import { migrateTournamentData } from "../src/services/tournament-migration";
import type { TournamentData } from "@shelf-judge/shared";

const baseSettings = {
  kFactorThreshold: 15,
  normalizationHalfWidth: 400,
  provisionalThreshold: 6,
};

function makeComparison(
  id: string,
  gameAId: string,
  gameBId: string,
  winnerId: string,
  sessionId: string,
  createdAt: string,
) {
  return { id, gameAId, gameBId, winnerId, sessionId, createdAt };
}

describe("migrateTournamentData", () => {
  test("computes correct wins and losses for 3 games with 6 comparisons", () => {
    // g1 beats g2, g1 beats g3, g2 beats g3, g1 beats g2, g3 beats g1, g2 beats g3
    // g1: 3 wins (beat g2 twice, beat g3 once), 1 loss (lost to g3)
    // g2: 1 win (beat g3), 2 losses (lost to g1 twice)  -- wait, also beat g3 twice
    // Let me recount:
    // c1: g1 vs g2, g1 wins -> g1:W g2:L
    // c2: g1 vs g3, g1 wins -> g1:W g3:L
    // c3: g2 vs g3, g2 wins -> g2:W g3:L
    // c4: g1 vs g2, g1 wins -> g1:W g2:L
    // c5: g3 vs g1, g3 wins -> g3:W g1:L
    // c6: g2 vs g3, g2 wins -> g2:W g3:L
    // g1: 3W, 1L
    // g2: 2W, 2L
    // g3: 1W, 3L
    const raw = {
      settings: baseSettings,
      sessions: [
        {
          id: "s1",
          filters: null,
          gameIds: ["g1", "g2", "g3"],
          comparisonCount: 6,
          status: "completed",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T06:00:00Z",
        },
      ],
      comparisons: [
        makeComparison("c1", "g1", "g2", "g1", "s1", "2026-01-01T01:00:00Z"),
        makeComparison("c2", "g1", "g3", "g1", "s1", "2026-01-01T02:00:00Z"),
        makeComparison("c3", "g2", "g3", "g2", "s1", "2026-01-01T03:00:00Z"),
        makeComparison("c4", "g1", "g2", "g1", "s1", "2026-01-01T04:00:00Z"),
        makeComparison("c5", "g3", "g1", "g3", "s1", "2026-01-01T05:00:00Z"),
        makeComparison("c6", "g2", "g3", "g2", "s1", "2026-01-01T06:00:00Z"),
      ],
      gameStats: {
        g1: { eloRating: 1530, comparisonCount: 4 },
        g2: { eloRating: 1500, comparisonCount: 4 },
        g3: { eloRating: 1470, comparisonCount: 4 },
      },
    };

    const { data, migrated } = migrateTournamentData(raw);
    expect(migrated).toBe(true);

    expect(data.gameStats.g1.wins).toBe(3);
    expect(data.gameStats.g1.losses).toBe(1);
    expect(data.gameStats.g2.wins).toBe(2);
    expect(data.gameStats.g2.losses).toBe(2);
    expect(data.gameStats.g3.wins).toBe(1);
    expect(data.gameStats.g3.losses).toBe(3);
  });

  test("recentComparisons are ordered most-recent-first", () => {
    const raw = {
      settings: baseSettings,
      sessions: [
        {
          id: "s1",
          filters: null,
          gameIds: ["g1", "g2"],
          comparisonCount: 3,
          status: "completed",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T03:00:00Z",
        },
      ],
      comparisons: [
        makeComparison("c1", "g1", "g2", "g1", "s1", "2026-01-01T01:00:00Z"),
        makeComparison("c2", "g1", "g2", "g2", "s1", "2026-01-01T02:00:00Z"),
        makeComparison("c3", "g1", "g2", "g1", "s1", "2026-01-01T03:00:00Z"),
      ],
      gameStats: {
        g1: { eloRating: 1510, comparisonCount: 3 },
        g2: { eloRating: 1490, comparisonCount: 3 },
      },
    };

    const { data } = migrateTournamentData(raw);

    // g1's most recent comparison first
    expect(data.gameStats.g1.recentComparisons[0].createdAt).toBe("2026-01-01T03:00:00Z");
    expect(data.gameStats.g1.recentComparisons[0].won).toBe(true);
    expect(data.gameStats.g1.recentComparisons[1].createdAt).toBe("2026-01-01T02:00:00Z");
    expect(data.gameStats.g1.recentComparisons[1].won).toBe(false);
    expect(data.gameStats.g1.recentComparisons[2].createdAt).toBe("2026-01-01T01:00:00Z");
    expect(data.gameStats.g1.recentComparisons[2].won).toBe(true);
  });

  test("caps recentComparisons at 10", () => {
    // 15 comparisons between g1 and g2
    const comparisons = Array.from({ length: 15 }, (_, i) =>
      makeComparison(
        `c${i}`,
        "g1",
        "g2",
        i % 2 === 0 ? "g1" : "g2",
        "s1",
        `2026-01-01T${String(i).padStart(2, "0")}:00:00Z`,
      ),
    );

    const raw = {
      settings: baseSettings,
      sessions: [
        {
          id: "s1",
          filters: null,
          gameIds: ["g1", "g2"],
          comparisonCount: 15,
          status: "completed",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T15:00:00Z",
        },
      ],
      comparisons,
      gameStats: {
        g1: { eloRating: 1510, comparisonCount: 15 },
        g2: { eloRating: 1490, comparisonCount: 15 },
      },
    };

    const { data } = migrateTournamentData(raw);
    expect(data.gameStats.g1.recentComparisons).toHaveLength(10);
    expect(data.gameStats.g2.recentComparisons).toHaveLength(10);

    // Most recent should be the last comparison (index 14)
    expect(data.gameStats.g1.recentComparisons[0].createdAt).toBe("2026-01-01T14:00:00Z");
  });

  test("moves active session comparisons, completed session gets empty array", () => {
    const raw = {
      settings: baseSettings,
      sessions: [
        {
          id: "s1",
          filters: null,
          gameIds: ["g1", "g2"],
          comparisonCount: 2,
          status: "completed",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T02:00:00Z",
        },
        {
          id: "s2",
          filters: null,
          gameIds: ["g1", "g2", "g3"],
          comparisonCount: 1,
          status: "active",
          createdAt: "2026-01-02T00:00:00Z",
          updatedAt: "2026-01-02T01:00:00Z",
        },
      ],
      comparisons: [
        makeComparison("c1", "g1", "g2", "g1", "s1", "2026-01-01T01:00:00Z"),
        makeComparison("c2", "g1", "g2", "g2", "s1", "2026-01-01T02:00:00Z"),
        makeComparison("c3", "g1", "g3", "g1", "s2", "2026-01-02T01:00:00Z"),
      ],
      gameStats: {
        g1: { eloRating: 1520, comparisonCount: 3 },
        g2: { eloRating: 1490, comparisonCount: 2 },
        g3: { eloRating: 1490, comparisonCount: 1 },
      },
    };

    const { data, migrated } = migrateTournamentData(raw);
    expect(migrated).toBe(true);

    // Completed session has no comparisons
    expect(data.sessions[0].comparisons).toEqual([]);

    // Active session has its comparison
    expect(data.sessions[1].comparisons).toHaveLength(1);
    expect(data.sessions[1].comparisons[0].id).toBe("c3");
  });

  test("preserves ELO ratings and comparison counts", () => {
    const raw = {
      settings: baseSettings,
      sessions: [],
      comparisons: [makeComparison("c1", "g1", "g2", "g1", "s1", "2026-01-01T01:00:00Z")],
      gameStats: {
        g1: { eloRating: 1532.7, comparisonCount: 5 },
        g2: { eloRating: 1467.3, comparisonCount: 5 },
      },
    };

    const { data } = migrateTournamentData(raw);
    expect(data.gameStats.g1.eloRating).toBe(1532.7);
    expect(data.gameStats.g1.comparisonCount).toBe(5);
    expect(data.gameStats.g2.eloRating).toBe(1467.3);
    expect(data.gameStats.g2.comparisonCount).toBe(5);
  });

  test("idempotent: already-migrated data passes through unchanged", () => {
    const alreadyMigrated = {
      settings: baseSettings,
      sessions: [
        {
          id: "s1",
          filters: null,
          gameIds: ["g1", "g2"],
          comparisonCount: 1,
          status: "completed",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T01:00:00Z",
          comparisons: [],
        },
      ],
      gameStats: {
        g1: {
          eloRating: 1516,
          comparisonCount: 1,
          wins: 1,
          losses: 0,
          recentComparisons: [
            { opponentGameId: "g2", won: true, createdAt: "2026-01-01T01:00:00Z" },
          ],
        },
        g2: {
          eloRating: 1484,
          comparisonCount: 1,
          wins: 0,
          losses: 1,
          recentComparisons: [
            { opponentGameId: "g1", won: false, createdAt: "2026-01-01T01:00:00Z" },
          ],
        },
      },
    };

    const { data, migrated } = migrateTournamentData(alreadyMigrated);
    expect(migrated).toBe(false);
    expect(data).toEqual(alreadyMigrated as TournamentData);
  });

  test("fresh tournament with no comparisons and no sessions passes through unchanged", () => {
    const fresh = {
      settings: baseSettings,
      sessions: [],
      gameStats: {},
    };

    const { data, migrated } = migrateTournamentData(fresh);
    expect(migrated).toBe(false);
    expect(data).toEqual(fresh);
  });

  test("removes top-level comparisons field from output", () => {
    const raw = {
      settings: baseSettings,
      sessions: [],
      comparisons: [makeComparison("c1", "g1", "g2", "g1", "s1", "2026-01-01T01:00:00Z")],
      gameStats: {
        g1: { eloRating: 1516, comparisonCount: 1 },
        g2: { eloRating: 1484, comparisonCount: 1 },
      },
    };

    const { data } = migrateTournamentData(raw);
    expect("comparisons" in data).toBe(false);
  });

  test("skips comparisons where both games lack gameStats entries", () => {
    const raw = {
      settings: baseSettings,
      sessions: [],
      comparisons: [
        // Both g1 and g2 have stats
        makeComparison("c1", "g1", "g2", "g1", "s1", "2026-01-01T01:00:00Z"),
        // Both deleted-a and deleted-b have no stats (both deleted)
        makeComparison("c2", "deleted-a", "deleted-b", "deleted-a", "s1", "2026-01-01T02:00:00Z"),
      ],
      gameStats: {
        g1: { eloRating: 1516, comparisonCount: 1 },
        g2: { eloRating: 1484, comparisonCount: 1 },
      },
    };

    const { data } = migrateTournamentData(raw);
    // Only g1 and g2 have stats; deleted games are not created
    expect(Object.keys(data.gameStats)).toEqual(["g1", "g2"]);
    expect(data.gameStats.g1.wins).toBe(1);
    expect(data.gameStats.g1.losses).toBe(0);
  });

  test("handles comparison where one game was deleted (has no stats entry)", () => {
    // g1 has stats, g-deleted does not. The comparison still counts for g1.
    const raw = {
      settings: baseSettings,
      sessions: [],
      comparisons: [makeComparison("c1", "g1", "g-deleted", "g1", "s1", "2026-01-01T01:00:00Z")],
      gameStats: {
        g1: { eloRating: 1516, comparisonCount: 1 },
      },
    };

    const { data } = migrateTournamentData(raw);
    // g1 wins count includes this comparison since at least one game has stats
    expect(data.gameStats.g1.wins).toBe(1);
    expect(data.gameStats.g1.recentComparisons).toHaveLength(1);
    expect(data.gameStats.g1.recentComparisons[0].opponentGameId).toBe("g-deleted");
  });

  test("recentComparisons contain correct opponentGameId and won flag", () => {
    const raw = {
      settings: baseSettings,
      sessions: [],
      comparisons: [
        makeComparison("c1", "g1", "g2", "g1", "s1", "2026-01-01T01:00:00Z"),
        makeComparison("c2", "g2", "g3", "g3", "s1", "2026-01-01T02:00:00Z"),
      ],
      gameStats: {
        g1: { eloRating: 1510, comparisonCount: 1 },
        g2: { eloRating: 1490, comparisonCount: 2 },
        g3: { eloRating: 1500, comparisonCount: 1 },
      },
    };

    const { data } = migrateTournamentData(raw);

    // g1: beat g2
    expect(data.gameStats.g1.recentComparisons).toEqual([
      { opponentGameId: "g2", won: true, createdAt: "2026-01-01T01:00:00Z" },
    ]);

    // g2: lost to g1, then lost to g3 (most recent first)
    expect(data.gameStats.g2.recentComparisons).toEqual([
      { opponentGameId: "g3", won: false, createdAt: "2026-01-01T02:00:00Z" },
      { opponentGameId: "g1", won: false, createdAt: "2026-01-01T01:00:00Z" },
    ]);

    // g3: beat g2
    expect(data.gameStats.g3.recentComparisons).toEqual([
      { opponentGameId: "g2", won: true, createdAt: "2026-01-01T02:00:00Z" },
    ]);
  });

  test("caps recentComparisons at 10 most-recent when comparisons arrive out of order", () => {
    // 15 comparisons in REVERSE chronological order (newest first in the raw array).
    // The migration must sort before capping so the 10 truly most-recent survive.
    const comparisons = Array.from({ length: 15 }, (_, i) =>
      makeComparison(
        `c${i}`,
        "g1",
        "g2",
        i % 2 === 0 ? "g1" : "g2",
        "s1",
        // i=0 is newest (T14), i=14 is oldest (T00)
        `2026-01-01T${String(14 - i).padStart(2, "0")}:00:00Z`,
      ),
    );

    const raw = {
      settings: baseSettings,
      sessions: [
        {
          id: "s1",
          filters: null,
          gameIds: ["g1", "g2"],
          comparisonCount: 15,
          status: "completed",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T15:00:00Z",
        },
      ],
      comparisons,
      gameStats: {
        g1: { eloRating: 1510, comparisonCount: 15 },
        g2: { eloRating: 1490, comparisonCount: 15 },
      },
    };

    const { data } = migrateTournamentData(raw);
    expect(data.gameStats.g1.recentComparisons).toHaveLength(10);
    expect(data.gameStats.g2.recentComparisons).toHaveLength(10);

    // Most recent (T14) should be first despite being first in the unsorted array
    expect(data.gameStats.g1.recentComparisons[0].createdAt).toBe("2026-01-01T14:00:00Z");
    // Oldest retained (T05) should be last; T00-T04 should be dropped
    expect(data.gameStats.g1.recentComparisons[9].createdAt).toBe("2026-01-01T05:00:00Z");

    // Verify the dropped comparisons (T00-T04) are NOT present
    const g1Timestamps = data.gameStats.g1.recentComparisons.map((c) => c.createdAt);
    for (let h = 0; h < 5; h++) {
      const droppedTs = `2026-01-01T${String(h).padStart(2, "0")}:00:00Z`;
      expect(g1Timestamps).not.toContain(droppedTs);
    }
  });

  test("empty top-level comparisons array triggers migration but produces clean output", () => {
    const raw = {
      settings: baseSettings,
      sessions: [],
      comparisons: [],
      gameStats: {
        g1: { eloRating: 1500, comparisonCount: 0 },
      },
    };

    const { data, migrated } = migrateTournamentData(raw);
    expect(migrated).toBe(true);
    expect("comparisons" in data).toBe(false);
    expect(data.gameStats.g1.wins).toBe(0);
    expect(data.gameStats.g1.losses).toBe(0);
    expect(data.gameStats.g1.recentComparisons).toEqual([]);
  });
});
