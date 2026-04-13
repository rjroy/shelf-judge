import { describe, expect, test } from "bun:test";
import type { Axis, BggGameData, Game } from "../src/types";
import { resolveBggRawValue, resolveAxisValues } from "../src/axis-utils";

function makeBggData(overrides: Partial<BggGameData> = {}): BggGameData {
  return {
    communityRating: 7.5,
    bayesAverage: 7.0,
    weight: 3.0,
    numWeightVotes: 100,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    suggestedPlayerCounts: [],
    fetchedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAxis(overrides: Partial<Axis> & { id: string; name: string }): Axis {
  return {
    description: null,
    weight: 50,
    source: "personal",
    bggField: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeGame(overrides: Partial<Game> & { id: string; name: string }): Game {
  return {
    bggId: null,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    ownership: "owned",
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("resolveBggRawValue", () => {
  test("returns communityRating for bgg axis with bggField communityRating", () => {
    const axis = makeAxis({ id: "cr", name: "Rating", source: "bgg", bggField: "communityRating" });
    const bgg = makeBggData({ communityRating: 8.2 });
    expect(resolveBggRawValue(axis, bgg)).toBe(8.2);
  });

  test("returns weight for bgg axis with bggField weight", () => {
    const axis = makeAxis({ id: "w", name: "Weight", source: "bgg", bggField: "weight" });
    const bgg = makeBggData({ weight: 3.5 });
    expect(resolveBggRawValue(axis, bgg)).toBe(3.5);
  });

  test("returns null for personal axes", () => {
    const axis = makeAxis({ id: "fun", name: "Fun", source: "personal" });
    const bgg = makeBggData();
    expect(resolveBggRawValue(axis, bgg)).toBeNull();
  });

  test("returns null when bggData is null", () => {
    const axis = makeAxis({ id: "cr", name: "Rating", source: "bgg", bggField: "communityRating" });
    expect(resolveBggRawValue(axis, null)).toBeNull();
  });

  test("returns null for weight when bgg weight is null", () => {
    const axis = makeAxis({ id: "w", name: "Weight", source: "bgg", bggField: "weight" });
    const bgg = makeBggData({ weight: null });
    expect(resolveBggRawValue(axis, bgg)).toBeNull();
  });
});

describe("resolveAxisValues", () => {
  test("returns personal ratings unchanged for personal axes", () => {
    const axes = [makeAxis({ id: "fun", name: "Fun" })];
    const game = makeGame({ id: "g1", name: "Game", ratings: { fun: 8 } });
    expect(resolveAxisValues(game, axes)).toEqual({ fun: 8 });
  });

  test("returns native-scale BGG values for BGG axes", () => {
    const axes = [
      makeAxis({ id: "w", name: "Weight", source: "bgg", bggField: "weight" }),
      makeAxis({ id: "cr", name: "Rating", source: "bgg", bggField: "communityRating" }),
    ];
    const game = makeGame({
      id: "g1",
      name: "Game",
      bggData: makeBggData({ weight: 3.25, communityRating: 7.8 }),
    });
    const result = resolveAxisValues(game, axes);
    expect(result.w).toBe(3.25);
    expect(result.cr).toBe(7.8);
  });

  test("prefers personal override when both personal rating and BGG data exist", () => {
    const axes = [
      makeAxis({ id: "cr", name: "Rating", source: "bgg", bggField: "communityRating" }),
    ];
    const game = makeGame({
      id: "g1",
      name: "Game",
      ratings: { cr: 9 },
      bggData: makeBggData({ communityRating: 7.5 }),
    });
    expect(resolveAxisValues(game, axes)).toEqual({ cr: 9 });
  });

  test("omits axes with no value (no rating, no bggData)", () => {
    const axes = [
      makeAxis({ id: "fun", name: "Fun" }),
      makeAxis({ id: "cr", name: "Rating", source: "bgg", bggField: "communityRating" }),
    ];
    const game = makeGame({ id: "g1", name: "Game" });
    expect(resolveAxisValues(game, axes)).toEqual({});
  });

  test("mixed axes: personal rated, BGG resolved, and omitted", () => {
    const axes = [
      makeAxis({ id: "fun", name: "Fun" }),
      makeAxis({ id: "w", name: "Weight", source: "bgg", bggField: "weight" }),
      makeAxis({ id: "depth", name: "Depth" }),
    ];
    const game = makeGame({
      id: "g1",
      name: "Game",
      ratings: { fun: 7 },
      bggData: makeBggData({ weight: 2.5 }),
    });
    const result = resolveAxisValues(game, axes);
    expect(result).toEqual({ fun: 7, w: 2.5 });
  });
});
