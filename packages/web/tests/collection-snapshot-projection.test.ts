import { describe, expect, test } from "bun:test";
import { CollectionSnapshotSchema, type CollectionSnapshot } from "@shelf-judge/shared";
import { projectCollectionSnapshot } from "@/lib/collection-snapshot-projection";

const snapshot = {
  representationVersion: 1,
  collectionId: "collection",
  serverId: "server",
  status: "complete",
  unavailableFeatures: [],
  axes: [{ id: "axis", name: "Axis", source: "personal", enabled: true, weight: 1 }],
  ignoredTags: ["mechanism:deck-building"],
  redundancyMode: "integrated",
  games: [
    {
      game: {
        id: "g1",
        name: "Game",
        bggId: 1,
        yearPublished: 2020,
        imageUrl: null,
        numPlays: 3,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        ratings: { axis: 8 },
        bggData: null,
        boxDimensions: null,
        minPlayers: 2,
        maxPlayers: 4,
        bestPlayers: 3,
        playingTime: 60,
        ownership: "owned",
      },
      ownerNotePresent: true,
      ordinary: { score: null, displayScore: "ordinary", purchaseUtilization: {} },
      predicted: {
        availability: "available",
        score: null,
        displayScore: "predicted",
        purchaseUtilization: {},
      },
      hasTournamentData: true,
      tournament: {
        eloRating: 1500,
        comparisonCount: 2,
        normalizedScore: 8,
        displayLabel: "8.0",
        wins: 1,
        losses: 1,
      },
    },
  ],
  nichePositions: {
    availability: "available",
    positions: [{ gameId: "g1", position: { niches: [] } }],
  },
  capacity: { availability: "available", result: null },
  counts: { total: 1, rated: 0, predicted: 1, unavailablePredictions: 0 },
  averageScore: null,
} as unknown as CollectionSnapshot;

describe("collection snapshot projection", () => {
  test("preserves variant display/utilization, niche positions, tournament stats and table counts", () => {
    const props = projectCollectionSnapshot(snapshot);
    expect(props.games[0]?.displayScore).toBe("ordinary");
    expect(props.predictedGames?.[0]?.displayScore).toBe("predicted");
    expect(props.nicheGames?.[0]?.nichePosition).toEqual({ niches: [] });
    expect(props.tournamentStats.g1).toMatchObject({
      eloRating: 1500,
      comparisonCount: 2,
      recentComparisons: [],
    });
    expect(props.axes[0]?.id).toBe("axis");
    expect(props.totalGames).toBe(1);
    expect(props.ownerNotePresence).toEqual({ g1: true });
    expect(props.ratedCount).toBe(0);
    expect(props.predictedCount).toBe(1);
    expect(props.ignoredTags).toEqual([{ type: "mechanism", name: "deck-building" }]);
    expect(props.isIntegratedRedundancy).toBe(true);
  });

  test("projects cleared or missing owner notes as false without including note text", () => {
    const cleared = {
      ...snapshot,
      games: [{ ...snapshot.games[0], ownerNotePresent: false }],
    } as CollectionSnapshot;
    const props = projectCollectionSnapshot(cleared);
    expect(props.ownerNotePresence).toEqual({ g1: false });
    expect(props.games[0]?.game).not.toHaveProperty("ownerNote");
    expect(JSON.stringify(props)).not.toContain("private");
  });

  test("keeps prediction and niche features unavailable instead of inventing empty data", () => {
    const degraded = {
      ...snapshot,
      status: "degraded",
      unavailableFeatures: [{ feature: "predictions", reason: "offline" }],
      games: [
        { ...snapshot.games[0], predicted: { availability: "unavailable", reason: "offline" } },
      ],
      nichePositions: { availability: "unavailable", reason: "offline" },
    } as CollectionSnapshot;
    const props = projectCollectionSnapshot(degraded);
    expect(props.predictedGames).toBeNull();
    expect(props.nicheGames).toBeNull();
  });

  test("does not enable tournament display when its optional stats projection is unavailable", () => {
    const degraded = {
      ...snapshot,
      status: "degraded",
      unavailableFeatures: [{ feature: "tournament-display", reason: "offline" }],
      games: [{ ...snapshot.games[0], tournament: null, hasTournamentData: true }],
    } as CollectionSnapshot;
    const props = projectCollectionSnapshot(degraded);
    expect(props.hasTournamentData).toBe(false);
    expect(props.tournamentStats).toEqual({});
  });

  test("strict schema rejects owner-note leakage", () => {
    expect(
      CollectionSnapshotSchema.safeParse({ ...snapshot, ownerNote: { text: "private" } }).success,
    ).toBe(false);
  });
});
