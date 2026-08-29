import { describe, expect, test } from "bun:test";
import type { Axis, BggGameData, DerivedAxis, Game, PersonalAxis } from "../src/types";
import { resolveAxisValues } from "../src/axis-utils";
import { createInitialEntityMetadata } from "../src/useful-profile-source";

function makeBggData(overrides: Partial<BggGameData> = {}): BggGameData {
  return {
    communityRating: 7.5,
    bayesAverage: 7,
    weight: 3,
    numWeightVotes: 100,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    bestPlayerCount: null,
    fetchedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const timestamps = {
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function personal(id: string): PersonalAxis {
  return {
    id,
    name: id,
    description: null,
    weight: 50,
    enabled: true,
    source: "personal",
    ...timestamps,
  };
}

function derived(
  id: string,
  derivedField: "communityRating" | "weight",
): DerivedAxis<"communityRating"> | DerivedAxis<"weight"> {
  return {
    id,
    name: id,
    description: null,
    weight: 50,
    enabled: true,
    source: "derived",
    derivedField,
    configuration: {},
    ...timestamps,
  };
}

function playingTime(maximumScoringTime = 240): DerivedAxis<"playingTime"> {
  return {
    id: "time",
    name: "Play Time",
    description: null,
    weight: 50,
    enabled: true,
    source: "derived",
    derivedField: "playingTime",
    configuration: { maximumScoringTime },
    ...timestamps,
  };
}

function playerCount(targetPlayerCount: number): DerivedAxis<"playerCountFit"> {
  return {
    id: "players",
    name: "Player Count Fit",
    description: null,
    weight: 50,
    enabled: true,
    source: "derived",
    derivedField: "playerCountFit",
    configuration: { targetPlayerCount },
    ...timestamps,
  };
}

function makeGame(overrides: Partial<Game> = {}): Game {
  const bggId = overrides.bggId ?? null;
  return {
    id: "g1",
    bggId,
    name: "Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    ...timestamps,
    ...overrides,
    entityMetadata: overrides.entityMetadata ?? createInitialEntityMetadata(bggId),
    latestPlayCountCheck: overrides.latestPlayCountCheck ?? null,
  };
}

describe("resolveAxisValues", () => {
  test("returns personal ratings unchanged", () => {
    expect(resolveAxisValues(makeGame({ ratings: { fun: 8 } }), [personal("fun")])).toEqual({
      fun: 8,
    });
  });

  test("resolves registered factual values", () => {
    const axes: Axis[] = [derived("w", "weight"), derived("cr", "communityRating")];
    const game = makeGame({ bggData: makeBggData({ weight: 3.25, communityRating: 7.8 }) });
    expect(resolveAxisValues(game, axes)).toEqual({ w: 3.25, cr: 7.8 });
  });

  test("prefers a personal override over a derived value", () => {
    const game = makeGame({
      ratings: { cr: 9 },
      bggData: makeBggData({ communityRating: 7.5 }),
    });
    expect(resolveAxisValues(game, [derived("cr", "communityRating")])).toEqual({ cr: 9 });
  });

  test("omits missing personal and derived values", () => {
    expect(
      resolveAxisValues(makeGame(), [personal("fun"), derived("cr", "communityRating")]),
    ).toEqual({});
  });

  test("omits disabled legacy axes even when a stored rating remains", () => {
    const axis: Axis = {
      id: "legacy",
      name: "Legacy",
      description: null,
      weight: 50,
      enabled: false,
      source: "legacy",
      reason: "unknown_legacy_field",
      legacyField: "futureMetric",
      legacyPayload: {},
      ...timestamps,
    };
    expect(resolveAxisValues(makeGame({ ratings: { legacy: 10 } }), [axis])).toEqual({});
  });

  test("returns published playing time rather than the capped scoring value", () => {
    expect(resolveAxisValues(makeGame({ playingTime: 300 }), [playingTime(240)])).toEqual({
      time: 300,
    });
  });

  test("returns playing time below the configured cap", () => {
    expect(resolveAxisValues(makeGame({ playingTime: 90 }), [playingTime()])).toEqual({ time: 90 });
  });

  test("omits nonpositive playing time", () => {
    expect(resolveAxisValues(makeGame({ playingTime: 0 }), [playingTime()])).toEqual({});
  });

  test("returns the in-range player-count fit value", () => {
    const game = makeGame({ minPlayers: 2, maxPlayers: 5 });
    expect(resolveAxisValues(game, [playerCount(4)])).toEqual({ players: 8 });
  });

  test("returns the out-of-range player-count fit value", () => {
    const game = makeGame({ minPlayers: 2, maxPlayers: 5 });
    expect(resolveAxisValues(game, [playerCount(6)])).toEqual({ players: 5 });
  });

  test("omits player-count fit when bounds are missing", () => {
    expect(resolveAxisValues(makeGame(), [playerCount(4)])).toEqual({});
  });

  test("uses a stored override when derived metadata is missing", () => {
    expect(resolveAxisValues(makeGame({ ratings: { time: 8 } }), [playingTime()])).toEqual({
      time: 8,
    });
  });

  test("resolves stored tournament values", () => {
    const axis: Axis = {
      id: "tournament",
      name: "Tournament",
      description: null,
      weight: 30,
      enabled: true,
      source: "tournament",
      ...timestamps,
    };
    expect(resolveAxisValues(makeGame({ ratings: { tournament: 7.5 } }), [axis])).toEqual({
      tournament: 7.5,
    });
  });

  test("resolves mixed personal, tournament, and derived values", () => {
    const tournament: Axis = {
      id: "tournament",
      name: "Tournament",
      description: null,
      weight: 30,
      enabled: true,
      source: "tournament",
      ...timestamps,
    };
    const game = makeGame({ playingTime: 60, ratings: { fun: 8, tournament: 7 } });
    expect(resolveAxisValues(game, [personal("fun"), tournament, playingTime()])).toEqual({
      fun: 8,
      tournament: 7,
      time: 60,
    });
  });
});
