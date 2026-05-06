import { describe, expect, test } from "bun:test";
import {
  CreateAxisSchema,
  UpdateAxisSchema,
  RateGameSchema,
  AddGameSchema,
  SessionFilterSchema,
  StartSessionSchema,
  SubmitComparisonSchema,
  TournamentSettingsUpdateSchema,
  TournamentDataSchema,
  TournamentSettingsSchema,
} from "../src/index";

describe("CreateAxisSchema", () => {
  test("accepts valid input", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Visual design",
      weight: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Visual design");
      expect(result.data.weight).toBe(50);
      expect(result.data.description).toBeNull();
      expect(result.data.source).toBe("personal");
      expect(result.data.bggField).toBeNull();
    }
  });

  test("accepts BGG source with bggField", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Community Rating",
      weight: 10,
      source: "bgg",
      bggField: "communityRating",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe("bgg");
      expect(result.data.bggField).toBe("communityRating");
    }
  });

  test("rejects empty name", () => {
    const result = CreateAxisSchema.safeParse({ name: "", weight: 50 });
    expect(result.success).toBe(false);
  });

  test("accepts weight of 0 (minimum, per REQ-MVP-1)", () => {
    const result = CreateAxisSchema.safeParse({ name: "Test", weight: 0 });
    expect(result.success).toBe(true);
  });

  test("rejects weight below 0", () => {
    const result = CreateAxisSchema.safeParse({ name: "Test", weight: -1 });
    expect(result.success).toBe(false);
  });

  test("rejects weight above 100", () => {
    const result = CreateAxisSchema.safeParse({ name: "Test", weight: 101 });
    expect(result.success).toBe(false);
  });

  test("rejects non-integer weight", () => {
    const result = CreateAxisSchema.safeParse({ name: "Test", weight: 50.5 });
    expect(result.success).toBe(false);
  });

  test("accepts curve config fields", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Complexity",
      weight: 20,
      source: "bgg",
      bggField: "weight",
      preferenceShape: "sweet-spot",
      idealValue: 2.75,
      tolerance: "moderate",
      leanDirection: "lower",
    });
    expect(result.success).toBe(true);
  });

  test("accepts higher-is-better without idealValue", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Fun",
      weight: 30,
      preferenceShape: "higher-is-better",
    });
    expect(result.success).toBe(true);
  });

  test("accepts lower-is-better without idealValue", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Fiddliness",
      weight: 15,
      preferenceShape: "lower-is-better",
    });
    expect(result.success).toBe(true);
  });

  test("rejects sweet-spot without idealValue", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Complexity",
      weight: 20,
      preferenceShape: "sweet-spot",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("idealValue");
    }
  });

  test("rejects sweet-spot with null idealValue", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Complexity",
      weight: 20,
      preferenceShape: "sweet-spot",
      idealValue: null,
    });
    expect(result.success).toBe(false);
  });

  test("accepts veto config", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Wife factor",
      weight: 25,
      veto: { direction: "below", threshold: 4 },
    });
    expect(result.success).toBe(true);
  });

  test("accepts null veto (no veto)", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Fun",
      weight: 30,
      veto: null,
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid veto direction", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Fun",
      weight: 30,
      veto: { direction: "sideways", threshold: 5 },
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid preference shape", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Fun",
      weight: 30,
      preferenceShape: "bell-curve",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid tolerance level", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Complexity",
      weight: 20,
      preferenceShape: "sweet-spot",
      idealValue: 3,
      tolerance: "very-strict",
    });
    expect(result.success).toBe(false);
  });

  test("accepts existing axis payloads without curve fields", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Visual design",
      weight: 50,
      source: "personal",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferenceShape).toBeUndefined();
      expect(result.data.idealValue).toBeUndefined();
      expect(result.data.tolerance).toBeUndefined();
      expect(result.data.leanDirection).toBeUndefined();
      expect(result.data.veto).toBeUndefined();
    }
  });

  // Three-arm bggField refinement: source dictates whether bggField is allowed.

  test("rejects personal source with bggField", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Visual design",
      weight: 50,
      source: "personal",
      bggField: "communityRating",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("bggField"))).toBe(true);
    }
  });

  test("rejects bgg source without bggField", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Community Rating",
      weight: 10,
      source: "bgg",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("bggField"))).toBe(true);
    }
  });

  test("accepts tournament source without bggField", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Tournament ELO",
      weight: 20,
      source: "tournament",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe("tournament");
      expect(result.data.bggField).toBeNull();
    }
  });

  test("rejects tournament source with bggField", () => {
    const result = CreateAxisSchema.safeParse({
      name: "Tournament ELO",
      weight: 20,
      source: "tournament",
      bggField: "communityRating",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("bggField"))).toBe(true);
    }
  });
});

describe("UpdateAxisSchema", () => {
  test("accepts partial update with name only", () => {
    const result = UpdateAxisSchema.safeParse({ name: "New name" });
    expect(result.success).toBe(true);
  });

  test("accepts partial update with weight only", () => {
    const result = UpdateAxisSchema.safeParse({ weight: 75 });
    expect(result.success).toBe(true);
  });

  test("rejects empty name", () => {
    const result = UpdateAxisSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects invalid weight", () => {
    const result = UpdateAxisSchema.safeParse({ weight: 101 });
    expect(result.success).toBe(false);
  });

  test("accepts curve config update", () => {
    const result = UpdateAxisSchema.safeParse({
      preferenceShape: "sweet-spot",
      idealValue: 3.0,
      tolerance: "strict",
      leanDirection: "higher",
    });
    expect(result.success).toBe(true);
  });

  test("accepts sweet-spot without idealValue (service layer validates with stored context)", () => {
    const result = UpdateAxisSchema.safeParse({
      preferenceShape: "sweet-spot",
    });
    expect(result.success).toBe(true);
  });

  test("accepts sweet-spot with idealValue", () => {
    const result = UpdateAxisSchema.safeParse({
      preferenceShape: "sweet-spot",
      idealValue: 5.5,
    });
    expect(result.success).toBe(true);
  });

  test("accepts veto update", () => {
    const result = UpdateAxisSchema.safeParse({
      veto: { direction: "above", threshold: 4.0 },
    });
    expect(result.success).toBe(true);
  });

  test("accepts removing veto with null", () => {
    const result = UpdateAxisSchema.safeParse({
      veto: null,
    });
    expect(result.success).toBe(true);
  });

  test("accepts update without curve fields (backward compat)", () => {
    const result = UpdateAxisSchema.safeParse({ name: "Renamed" });
    expect(result.success).toBe(true);
  });
});

describe("RateGameSchema", () => {
  test("accepts valid rating", () => {
    const result = RateGameSchema.safeParse({ axisId: "abc-123", rating: 7 });
    expect(result.success).toBe(true);
  });

  test("accepts rating of 1 (minimum)", () => {
    const result = RateGameSchema.safeParse({ axisId: "abc-123", rating: 1 });
    expect(result.success).toBe(true);
  });

  test("accepts rating of 10 (maximum)", () => {
    const result = RateGameSchema.safeParse({ axisId: "abc-123", rating: 10 });
    expect(result.success).toBe(true);
  });

  test("rejects rating of 0", () => {
    const result = RateGameSchema.safeParse({ axisId: "abc-123", rating: 0 });
    expect(result.success).toBe(false);
  });

  test("rejects rating of 11", () => {
    const result = RateGameSchema.safeParse({ axisId: "abc-123", rating: 11 });
    expect(result.success).toBe(false);
  });

  test("rejects non-integer rating", () => {
    const result = RateGameSchema.safeParse({ axisId: "abc-123", rating: 7.5 });
    expect(result.success).toBe(false);
  });

  test("rejects empty axisId", () => {
    const result = RateGameSchema.safeParse({ axisId: "", rating: 5 });
    expect(result.success).toBe(false);
  });
});

describe("AddGameSchema", () => {
  test("accepts valid game with name only", () => {
    const result = AddGameSchema.safeParse({ name: "Wingspan" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Wingspan");
      expect(result.data.bggId).toBeNull();
    }
  });

  test("accepts game with all fields", () => {
    const result = AddGameSchema.safeParse({
      name: "Wingspan",
      bggId: 266192,
      yearPublished: 2019,
      minPlayers: 1,
      maxPlayers: 5,
      playingTime: 70,
      imageUrl: "https://example.com/wingspan.jpg",
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty name", () => {
    const result = AddGameSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects invalid image URL", () => {
    const result = AddGameSchema.safeParse({
      name: "Test",
      imageUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("SessionFilterSchema", () => {
  test("accepts valid filter types", () => {
    for (const type of ["name", "minFitness", "maxFitness", "bggTag", "staleness"] as const) {
      const result = SessionFilterSchema.safeParse({ type, value: "test" });
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid filter type", () => {
    const result = SessionFilterSchema.safeParse({ type: "invalid", value: "test" });
    expect(result.success).toBe(false);
  });

  test("rejects empty value", () => {
    const result = SessionFilterSchema.safeParse({ type: "name", value: "" });
    expect(result.success).toBe(false);
  });

  test("rejects missing value", () => {
    const result = SessionFilterSchema.safeParse({ type: "name" });
    expect(result.success).toBe(false);
  });

  test("rejects missing type", () => {
    const result = SessionFilterSchema.safeParse({ value: "test" });
    expect(result.success).toBe(false);
  });
});

describe("StartSessionSchema", () => {
  test("accepts filters array", () => {
    const result = StartSessionSchema.safeParse({
      filters: [{ type: "name", value: "Catan" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filters).toEqual([{ type: "name", value: "Catan" }]);
    }
  });

  test("accepts null filters (unfiltered session)", () => {
    const result = StartSessionSchema.safeParse({ filters: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filters).toBeNull();
    }
  });

  test("defaults to null when filters omitted", () => {
    const result = StartSessionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filters).toBeNull();
    }
  });

  test("rejects invalid filter inside array", () => {
    const result = StartSessionSchema.safeParse({
      filters: [{ type: "bogus", value: "test" }],
    });
    expect(result.success).toBe(false);
  });

  test("accepts multiple filters", () => {
    const result = StartSessionSchema.safeParse({
      filters: [
        { type: "name", value: "Catan" },
        { type: "minFitness", value: "7.5" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filters!.length).toBe(2);
    }
  });
});

describe("SubmitComparisonSchema", () => {
  test("accepts valid comparison", () => {
    const result = SubmitComparisonSchema.safeParse({
      gameAId: "game-1",
      gameBId: "game-2",
      winnerId: "game-1",
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing winnerId", () => {
    const result = SubmitComparisonSchema.safeParse({
      gameAId: "game-1",
      gameBId: "game-2",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty winnerId", () => {
    const result = SubmitComparisonSchema.safeParse({
      gameAId: "game-1",
      gameBId: "game-2",
      winnerId: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing gameAId", () => {
    const result = SubmitComparisonSchema.safeParse({
      gameBId: "game-2",
      winnerId: "game-2",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing gameBId", () => {
    const result = SubmitComparisonSchema.safeParse({
      gameAId: "game-1",
      winnerId: "game-1",
    });
    expect(result.success).toBe(false);
  });

  test("rejects winnerId that is neither gameAId nor gameBId", () => {
    const result = SubmitComparisonSchema.safeParse({
      gameAId: "game-1",
      gameBId: "game-2",
      winnerId: "game-3",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("winnerId must equal gameAId or gameBId");
    }
  });

  test("accepts winnerId equal to gameBId", () => {
    const result = SubmitComparisonSchema.safeParse({
      gameAId: "game-1",
      gameBId: "game-2",
      winnerId: "game-2",
    });
    expect(result.success).toBe(true);
  });
});

describe("TournamentSettingsUpdateSchema", () => {
  test("accepts valid partial update", () => {
    const result = TournamentSettingsUpdateSchema.safeParse({ kFactorThreshold: 20 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kFactorThreshold).toBe(20);
    }
  });

  test("accepts empty object", () => {
    const result = TournamentSettingsUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("accepts all fields", () => {
    const result = TournamentSettingsUpdateSchema.safeParse({
      kFactorThreshold: 20,
      normalizationHalfWidth: 300,
      provisionalThreshold: 10,
    });
    expect(result.success).toBe(true);
  });

  test("rejects non-number values", () => {
    const result = TournamentSettingsUpdateSchema.safeParse({ kFactorThreshold: "banana" });
    expect(result.success).toBe(false);
  });

  test("rejects unknown fields (strict)", () => {
    const result = TournamentSettingsUpdateSchema.safeParse({
      kFactorThreshold: 20,
      garbage: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("TournamentSettingsSchema", () => {
  test("accepts valid settings", () => {
    const result = TournamentSettingsSchema.safeParse({
      kFactorThreshold: 15,
      normalizationHalfWidth: 400,
      provisionalThreshold: 6,
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing required fields", () => {
    const result = TournamentSettingsSchema.safeParse({ kFactorThreshold: 15 });
    expect(result.success).toBe(false);
  });
});

describe("TournamentDataSchema", () => {
  const baseSettings = {
    kFactorThreshold: 15,
    normalizationHalfWidth: 400,
    provisionalThreshold: 6,
  };

  test("accepts pre-migration format (top-level comparisons, no new fields)", () => {
    const preMigration = {
      settings: baseSettings,
      sessions: [
        {
          id: "s1",
          filters: null,
          gameIds: ["g1", "g2"],
          comparisonCount: 1,
          status: "active",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          // no comparisons field on session
        },
      ],
      comparisons: [
        {
          id: "c1",
          gameAId: "g1",
          gameBId: "g2",
          winnerId: "g1",
          sessionId: "s1",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      gameStats: {
        g1: { eloRating: 1516, comparisonCount: 1 },
        g2: { eloRating: 1484, comparisonCount: 1 },
      },
    };
    const result = TournamentDataSchema.safeParse(preMigration);
    expect(result.success).toBe(true);
    if (result.success) {
      // defaults applied for missing optional fields
      expect(result.data.gameStats.g1.wins).toBe(0);
      expect(result.data.gameStats.g1.losses).toBe(0);
      expect(result.data.gameStats.g1.recentComparisons).toEqual([]);
      expect(result.data.sessions[0].comparisons).toEqual([]);
    }
  });

  test("accepts post-migration format (no top-level comparisons, all new fields)", () => {
    const postMigration = {
      settings: baseSettings,
      sessions: [
        {
          id: "s1",
          filters: null,
          gameIds: ["g1", "g2"],
          comparisonCount: 1,
          status: "completed",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
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
            { opponentGameId: "g2", won: true, createdAt: "2026-01-01T00:00:00Z" },
          ],
        },
        g2: {
          eloRating: 1484,
          comparisonCount: 1,
          wins: 0,
          losses: 1,
          recentComparisons: [
            { opponentGameId: "g1", won: false, createdAt: "2026-01-01T00:00:00Z" },
          ],
        },
      },
    };
    const result = TournamentDataSchema.safeParse(postMigration);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comparisons).toBeUndefined();
      expect(result.data.gameStats.g1.wins).toBe(1);
      expect(result.data.sessions[0].comparisons).toEqual([]);
    }
  });

  test("applies defaults for missing optional fields", () => {
    const minimal = {
      settings: baseSettings,
      sessions: [],
      gameStats: {
        g1: { eloRating: 1500, comparisonCount: 0 },
      },
    };
    const result = TournamentDataSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gameStats.g1.wins).toBe(0);
      expect(result.data.gameStats.g1.losses).toBe(0);
      expect(result.data.gameStats.g1.recentComparisons).toEqual([]);
    }
  });

  test("rejects missing settings", () => {
    const result = TournamentDataSchema.safeParse({
      sessions: [],
      gameStats: {},
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid session status", () => {
    const result = TournamentDataSchema.safeParse({
      settings: baseSettings,
      sessions: [
        {
          id: "s1",
          filters: null,
          gameIds: [],
          comparisonCount: 0,
          status: "invalid",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      gameStats: {},
    });
    expect(result.success).toBe(false);
  });
});
