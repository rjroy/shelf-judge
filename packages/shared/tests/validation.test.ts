import { describe, expect, test } from "bun:test";
import {
  CreateAxisSchema,
  UpdateAxisSchema,
  RateGameSchema,
  AddGameSchema,
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
