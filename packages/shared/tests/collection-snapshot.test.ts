import { describe, expect, test } from "bun:test";
import {
  CollectionSnapshotCapacitySchema,
  CollectionSnapshotGameSchema,
  CollectionSnapshotAxisSchema,
  CollectionSnapshotGameRowSchema,
  CollectionSnapshotSchema,
} from "../src";

describe("collection snapshot contract", () => {
  test("accepts empty collections and preserves legitimate null and zero values", () => {
    const snapshot = {
      representationVersion: 1,
      collectionId: "collection-1",
      serverId: "server-1",
      status: "complete",
      unavailableFeatures: [],
      axes: [],
      ignoredTags: [],
      redundancyMode: "off",
      games: [],
      nichePositions: { availability: "available", positions: [] },
      capacity: { availability: "available", result: null },
      counts: { total: 0, rated: 0, predicted: 0, unavailablePredictions: 0 },
      averageScore: null,
    };
    expect(CollectionSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  test("strictly excludes owner notes and unneeded BGG/entity data from game projection", () => {
    const game = {
      id: "game-1",
      name: "Game",
      bggId: 12,
      yearPublished: 2020,
      imageUrl: null,
      numPlays: 0,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
      ratings: { axis: 0 },
      bggData: null,
      boxDimensions: null,
      minPlayers: 1,
      maxPlayers: 4,
      bestPlayers: null,
      playingTime: 60,
      ownership: "owned",
    };
    expect(CollectionSnapshotGameSchema.safeParse(game).success).toBe(true);
    expect(
      CollectionSnapshotGameSchema.safeParse({
        ...game,
        boxDimensions: { width: 10, height: 8, depth: 4 },
      }).success,
    ).toBe(true);
    expect(
      CollectionSnapshotGameSchema.safeParse({
        ...game,
        boxDimensions: { width: 10, height: 0, depth: 4 },
      }).success,
    ).toBe(false);
    expect(
      CollectionSnapshotGameSchema.safeParse({
        ...game,
        ownerNote: { state: "missing", version: 0, updatedAt: null },
      }).success,
    ).toBe(false);
    expect(
      CollectionSnapshotGameSchema.safeParse({ ...game, bggData: { description: "unneeded" } })
        .success,
    ).toBe(false);
    expect(CollectionSnapshotGameSchema.safeParse({ ...game, entityMetadata: {} }).success).toBe(
      false,
    );
  });

  test("projects table sorting/filter fields while preserving nullable BGG and rating values", () => {
    const base = {
      id: "game-1",
      name: "Game",
      bggId: 12,
      yearPublished: 2020,
      imageUrl: null,
      numPlays: 2,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-02-01T00:00:00Z",
      ratings: { axis: 0, vetoed: null },
      bggData: { presence: "present", communityRating: null, weight: 0 },
      boxDimensions: null,
      minPlayers: 1,
      maxPlayers: 4,
      bestPlayers: null,
      playingTime: 60,
      ownership: "owned",
    };
    const second = {
      ...base,
      id: "game-2",
      numPlays: 9,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
      ratings: { axis: 8 },
      bggData: { presence: "present" as const, communityRating: 7.5, weight: 3.2 },
    };
    expect(CollectionSnapshotGameSchema.safeParse(base).success).toBe(true);
    expect(CollectionSnapshotGameSchema.safeParse(second).success).toBe(true);
    expect(CollectionSnapshotGameSchema.safeParse({ ...base, numPlays: -1 }).success).toBe(false);
    expect(
      CollectionSnapshotGameSchema.safeParse({ ...base, ratings: { axis: Number.NaN } }).success,
    ).toBe(false);
    expect(
      CollectionSnapshotGameSchema.safeParse({
        ...base,
        bggData: { presence: "present", communityRating: 11, weight: 2 },
      }).success,
    ).toBe(false);
    expect(
      CollectionSnapshotGameSchema.safeParse({
        ...base,
        bggData: { presence: "present", communityRating: null, weight: null, description: "no" },
      }).success,
    ).toBe(false);
  });

  test("allows disabled legacy axes but excludes legacy payload and incompatible enabled state", () => {
    const legacy = {
      id: "legacy-axis",
      name: "Legacy",
      source: "legacy",
      enabled: false,
      weight: 0,
      veto: { direction: "above", threshold: 0 },
    };
    expect(CollectionSnapshotAxisSchema.safeParse(legacy).success).toBe(true);
    expect(CollectionSnapshotAxisSchema.safeParse({ ...legacy, enabled: true }).success).toBe(
      false,
    );
    expect(
      CollectionSnapshotAxisSchema.safeParse({ ...legacy, legacyPayload: { secret: true } })
        .success,
    ).toBe(false);
    expect(CollectionSnapshotAxisSchema.safeParse({ ...legacy, source: "personal" }).success).toBe(
      false,
    );
  });

  test("keeps persisted tournament presence separate from synthesized display statistics", () => {
    const displayedDefaults = {
      eloRating: 0,
      comparisonCount: 0,
      normalizedScore: null,
      displayLabel: "No tournament data",
      wins: 0,
      losses: 0,
    };
    const shape = CollectionSnapshotGameRowSchema.shape;
    expect(shape.hasTournamentData.safeParse(false).success).toBe(true);
    expect(shape.hasTournamentData.safeParse(true).success).toBe(true);
    expect(shape.tournament.safeParse(displayedDefaults).success).toBe(true);
    expect(shape.tournament.safeParse(null).success).toBe(true);
  });

  test("requires owner-note presence only on the row, never note text", () => {
    const game = {
      id: "game-1",
      name: "Game",
      bggId: null,
      yearPublished: null,
      imageUrl: null,
      numPlays: null,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
      ratings: {},
      bggData: null,
      boxDimensions: null,
      minPlayers: null,
      maxPlayers: null,
      bestPlayers: null,
      playingTime: null,
      ownership: "owned",
    };
    expect(CollectionSnapshotGameRowSchema.shape.ownerNotePresent.safeParse(false).success).toBe(
      true,
    );
    expect(
      CollectionSnapshotGameRowSchema.shape.ownerNotePresent.safeParse("present").success,
    ).toBe(false);
    expect(
      CollectionSnapshotGameSchema.safeParse({ ...game, ownerNotePresent: true }).success,
    ).toBe(false);
  });

  test("capacity validates nullable legitimate values but rejects non-finite values", () => {
    const capacity = {
      configured: true,
      totalShelfCount: 0,
      gamesWithDimensions: 0,
      gamesWithoutDimensions: 0,
      overflowing: false,
      hasPlacementProblems: false,
      assignments: [],
      assignmentConflicts: [],
      unfittableGames: [],
      overflowGames: [],
    };
    expect(CollectionSnapshotCapacitySchema.safeParse(capacity).success).toBe(true);
    expect(
      CollectionSnapshotCapacitySchema.safeParse({ ...capacity, totalShelfCount: Number.NaN })
        .success,
    ).toBe(false);
  });

  test("compact representation is smaller than three full-list payload copies on an illustrative fixture", () => {
    const projection = {
      id: "game-1",
      name: "Fixture",
      bggId: 1,
      yearPublished: 2020,
      imageUrl: null,
      numPlays: 0,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
      ratings: {},
      bggData: null,
      minPlayers: 1,
      maxPlayers: 4,
      bestPlayers: 2,
      playingTime: 60,
      ownership: "owned",
    };
    const compact = JSON.stringify({
      game: projection,
      score: null,
      displayScore: "7.0",
      purchaseUtilization: { outcome: "unavailable" },
    });
    const fullListCopy = JSON.stringify({
      game: {
        ...projection,
        bggData: {
          description: "Fixture description".repeat(30),
          mechanics: [],
          categories: [],
          families: [],
        },
        ownerNote: {
          state: "present",
          version: 3,
          updatedAt: "2026-01-01T00:00:00Z",
          text: "private note".repeat(20),
        },
        entityMetadata: { history: ["metadata".repeat(20)] },
      },
      score: null,
      displayScore: "7.0",
      purchaseUtilization: { outcome: "unavailable" },
    });
    expect(Buffer.byteLength(JSON.stringify({ rows: [compact] }))).toBeLessThan(
      Buffer.byteLength(
        JSON.stringify({
          ordinary: [fullListCopy],
          predicted: [fullListCopy],
          niche: [fullListCopy],
        }),
      ),
    );
  });
});
