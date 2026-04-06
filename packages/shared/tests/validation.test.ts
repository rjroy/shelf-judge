import { describe, expect, test } from "bun:test";
import {
  CreateAxisSchema,
  UpdateAxisSchema,
  RateGameSchema,
  AddGameSchema,
  SessionFilterSchema,
  StartSessionSchema,
  SubmitComparisonSchema,
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
    for (const type of ["name", "minFitness", "bggTag", "staleness"] as const) {
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
