import { describe, expect, test } from "bun:test";
import type {
  DerivedAxis,
  DisabledLegacyAxis,
  Game,
  PersonalAxis,
  TournamentAxis,
  TournamentData,
} from "@shelf-judge/shared";
import { AxisSchema } from "@shelf-judge/shared";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { migrateCollection } from "../../src/services/collection-migration.js";

const service = createFitnessService();
const timestamp = "2026-01-01T00:00:00.000Z";

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    bggId: null,
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function personal(overrides: Partial<PersonalAxis> = {}): PersonalAxis {
  return {
    id: "personal",
    name: "Personal",
    description: null,
    weight: 50,
    enabled: true,
    source: "personal",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function derived(
  field: DerivedAxis["derivedField"],
  configuration: DerivedAxis["configuration"],
  overrides: Partial<DerivedAxis> = {},
): DerivedAxis {
  const axis = AxisSchema.parse({
    id: field,
    name: field,
    description: null,
    weight: 50,
    enabled: true,
    source: "derived",
    derivedField: field,
    configuration,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  });
  if (axis.source !== "derived") throw new Error("Expected a derived test axis");
  return axis;
}

function entry(result: ReturnType<typeof service.calculateScore>, axisId: string) {
  const found = result?.breakdown.find((row) => row.axisId === axisId);
  expect(found).toBeDefined();
  if (found === undefined) throw new Error(`Missing breakdown row ${axisId}`);
  return found;
}

describe("derived fitness", () => {
  test.each([
    [2, 4, 2, 8],
    [2, 4, 4, 8],
    [2, 4, 3, 9],
    [2, 4, 1, 6],
    [2, 4, 5, 6],
    [4, 4, 4, 10],
    [2, 2, 4, 6],
    [10, 20, 4, 1],
    [null, 4, 3, null],
    [2, null, 3, null],
    [0, 4, 3, null],
    [4, 2, 3, null],
  ] as const)(
    "resolves player bounds min=%p max=%p target=%p",
    (minPlayers, maxPlayers, targetPlayerCount, expected) => {
      const axis = derived("playerCountFit", { targetPlayerCount });
      const result = service.calculateScore(game({ minPlayers, maxPlayers }), [axis]);
      if (expected === null) {
        expect(result).toBeNull();
      } else {
        expect(result?.score).toBe(expected);
        expect(entry(result, axis.id)).toMatchObject({
          sourceValue: expected,
          scoringRawValue: expected,
          effectiveRating: expected,
          unit: "fit score",
          provenance:
            "BoardGameGeek suggested-player-count poll with publisher-declared bounds fallback",
          configurationSummary: `Target: ${targetPlayerCount} player${targetPlayerCount === 1 ? "" : "s"}`,
        });
      }
    },
  );

  test.each([
    [90, 240, 90, 90],
    [0, 240, null, null],
    [null, 240, null, null],
    [240, 240, 240, 240],
    [300, 240, 300, 240],
  ] as const)(
    "keeps play-time source and capped scoring values for %p minutes",
    (playingTime, cap, sourceValue, scoringRawValue) => {
      const axis = derived("playingTime", { maximumScoringTime: cap });
      const result = service.calculateScore(game({ playingTime }), [axis]);
      if (sourceValue === null) {
        expect(result).toBeNull();
      } else {
        expect(entry(result, axis.id)).toMatchObject({ sourceValue, scoringRawValue });
      }
    },
  );

  test("applies lower-is-better at the minimum, interior, cap, and above-cap", () => {
    const axis = derived(
      "playingTime",
      { maximumScoringTime: 120 },
      { preferenceShape: "lower-is-better" },
    );
    expect(service.calculateScore(game({ playingTime: 1 }), [axis])?.score).toBe(10);
    expect(service.calculateScore(game({ playingTime: 60 }), [axis])?.score).toBe(5.5);
    expect(service.calculateScore(game({ playingTime: 120 }), [axis])?.score).toBe(1);
    expect(service.calculateScore(game({ playingTime: 300 }), [axis])?.score).toBe(1);
  });

  test("applies numeric sweet-spot width and responds immediately to cap changes", () => {
    const base = {
      preferenceShape: "sweet-spot" as const,
      idealValue: 90,
      toleranceWidth: 30,
    };
    const cap240 = derived("playingTime", { maximumScoringTime: 240 }, base);
    expect(service.calculateScore(game({ playingTime: 90 }), [cap240])?.score).toBe(10);
    expect(service.calculateScore(game({ playingTime: 60 }), [cap240])?.score).toBe(4.5);
    expect(service.calculateScore(game({ playingTime: 120 }), [cap240])?.score).toBe(4.5);
    expect(service.calculateScore(game({ playingTime: 240 }), [cap240])?.score).toBe(1);

    const lower240 = derived(
      "playingTime",
      { maximumScoringTime: 240 },
      { preferenceShape: "lower-is-better" },
    );
    const lower120 = derived(
      "playingTime",
      { maximumScoringTime: 120 },
      { preferenceShape: "lower-is-better" },
    );
    const stored = game({ playingTime: 180 });
    expect(service.calculateScore(stored, [lower240])?.score).toBe(3.3);
    expect(service.calculateScore(stored, [lower120])?.score).toBe(1);
    expect(stored.playingTime).toBe(180);
  });

  test("shows missing derived rows without changing the denominator", () => {
    const missing = derived("playingTime", { maximumScoringTime: 240 }, { weight: 100 });
    const rated = personal({ weight: 25 });
    const result = service.calculateScore(game({ ratings: { [rated.id]: 8 } }), [missing, rated]);

    expect(result?.score).toBe(8);
    expect(result?.ratedAxisCount).toBe(1);
    expect(result?.totalAxisCount).toBe(2);
    expect(entry(result, missing.id)).toMatchObject({
      source: "derived",
      sourceValue: null,
      scoringRawValue: null,
      effectiveRating: null,
      contribution: null,
      unit: "minutes",
      provenance: "Publisher-listed playing time imported from BoardGameGeek",
      configurationSummary: "Scoring cap: 240 minutes",
      overridden: false,
    });
  });

  test("invalid minute-native override is direct, retains facts, and bypasses veto", () => {
    const axis = derived(
      "playingTime",
      { maximumScoringTime: 240 },
      {
        preferenceShape: "sweet-spot",
        idealValue: 90,
        toleranceWidth: 30,
        veto: { direction: "above", threshold: 6 },
      },
    );
    const result = service.calculateScore(game({ playingTime: 300, ratings: { [axis.id]: 7 } }), [
      axis,
    ]);

    expect(result).toMatchObject({ score: 7, vetoed: false });
    expect(entry(result, axis.id)).toMatchObject({
      source: "override",
      sourceValue: 300,
      scoringRawValue: 240,
      effectiveRating: 7,
      overrideValue: 7,
      contribution: 7,
      overridden: true,
      curveAffected: false,
    });
  });

  test("invalid minute-native override is direct without inventing missing facts", () => {
    const axis = derived(
      "playingTime",
      { maximumScoringTime: 240 },
      { preferenceShape: "sweet-spot", idealValue: 90, toleranceWidth: 30 },
    );
    const result = service.calculateScore(game({ ratings: { [axis.id]: 9 } }), [axis]);
    expect(result?.score).toBe(9);
    expect(entry(result, axis.id)).toMatchObject({
      source: "override",
      sourceValue: null,
      scoringRawValue: null,
      effectiveRating: 9,
      overrideValue: 9,
      contribution: 9,
      overridden: true,
      curveAffected: false,
    });
  });

  test("valid personal-scale sweet-spot override preserves legacy curve and bypasses veto", () => {
    const axis = derived(
      "communityRating",
      {},
      {
        preferenceShape: "sweet-spot",
        idealValue: 8,
        tolerance: "moderate",
        veto: { direction: "below", threshold: 10 },
      },
    );
    const result = service.calculateScore(
      game({
        ratings: { [axis.id]: 9 },
        bggData: {
          communityRating: 7.5,
          bayesAverage: 7,
          weight: 3,
          numWeightVotes: 1,
          description: null,
          mechanics: [],
          categories: [],
          families: [],
          subdomains: [],
          bestPlayerCount: null,
          fetchedAt: timestamp,
        },
      }),
      [axis],
    );

    expect(result).toMatchObject({ score: 6, vetoed: false });
    expect(entry(result, axis.id)).toMatchObject({
      source: "override",
      sourceValue: 7.5,
      scoringRawValue: 7.5,
      effectiveRating: 6,
      overrideValue: 9,
      contribution: 6,
      overridden: true,
      curveAffected: true,
    });
  });

  test("valid lower and higher personal-scale overrides preserve configured behavior", () => {
    const lower = derived(
      "weight",
      {},
      {
        preferenceShape: "lower-is-better",
        veto: { direction: "above", threshold: 2 },
      },
    );
    const higher = derived(
      "communityRating",
      {},
      {
        id: "higher",
        preferenceShape: "higher-is-better",
        veto: { direction: "below", threshold: 5 },
      },
    );
    const result = service.calculateScore(game({ ratings: { [lower.id]: 3, [higher.id]: 4 } }), [
      lower,
      higher,
    ]);

    expect(result).toMatchObject({ score: 6, vetoed: false });
    expect(entry(result, lower.id)).toMatchObject({
      effectiveRating: 8,
      contribution: 4,
      overridden: true,
      curveAffected: true,
    });
    expect(entry(result, higher.id)).toMatchObject({
      effectiveRating: 4,
      contribution: 2,
      overridden: true,
      curveAffected: false,
    });
  });

  test("preserves legacy-before and current-after scores, curves, weights, vetoes, and overrides", () => {
    const bggData = {
      communityRating: 7.5,
      bayesAverage: 7,
      weight: 3,
      numWeightVotes: 1,
      description: null,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: timestamp,
    };
    const legacyGame = (overrides: Record<string, unknown> = {}) => ({
      id: "game-1",
      bggId: null,
      name: "Game",
      yearPublished: null,
      minPlayers: null,
      maxPlayers: null,
      bestPlayers: null,
      playingTime: null,
      imageUrl: null,
      bggData: null,
      numPlays: null,
      ratings: {},
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    });
    const raw = {
      id: "collection",
      name: "Legacy",
      axes: [
        {
          id: "community",
          name: "Community",
          description: null,
          weight: 60,
          source: "bgg",
          bggField: "communityRating",
          preferenceShape: "sweet-spot",
          idealValue: 8,
          tolerance: "moderate",
          veto: { direction: "below", threshold: 4 },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "weight",
          name: "Weight",
          description: null,
          weight: 40,
          source: "bgg",
          bggField: "weight",
          preferenceShape: "lower-is-better",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      games: [
        legacyGame({
          id: "ordinary",
          bggData,
        }),
        legacyGame({
          id: "override",
          ratings: { community: 9 },
          bggData,
        }),
        legacyGame({
          id: "veto",
          bggData: { ...bggData, communityRating: 3.5 },
        }),
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const migrated = migrateCollection(raw, {
      createId: () => "tournament",
      now: () => timestamp,
    }).data;
    const migratedLegacyAxes = migrated.axes.filter((axis) => axis.source === "derived");

    expect(migratedLegacyAxes).toHaveLength(2);
    expect(migratedLegacyAxes[0]).toMatchObject({
      id: "community",
      source: "derived",
      derivedField: "communityRating",
      configuration: {},
      weight: 60,
      preferenceShape: "sweet-spot",
      idealValue: 8,
      tolerance: "moderate",
      veto: { direction: "below", threshold: 4 },
    });
    expect(migratedLegacyAxes[1]).toMatchObject({
      id: "weight",
      source: "derived",
      derivedField: "weight",
      configuration: {},
      weight: 40,
      preferenceShape: "lower-is-better",
    });

    const ordinary = service.calculateScore(migrated.games[0], migratedLegacyAxes);
    expect(ordinary).toMatchObject({ score: 7.9, vetoed: false, hypotheticalScore: null });
    expect(entry(ordinary, "community")).toMatchObject({
      sourceValue: 7.5,
      scoringRawValue: 7.5,
      effectiveRating: 9.4,
      contribution: 5.6,
      weight: 60,
      overridden: false,
    });
    expect(entry(ordinary, "weight")).toMatchObject({
      sourceValue: 3,
      scoringRawValue: 3,
      effectiveRating: 5.5,
      contribution: 2.2,
      weight: 40,
      overridden: false,
    });

    const result = service.calculateScore(migrated.games[1], migratedLegacyAxes);

    expect(result?.score).toBe(5.8);
    expect(entry(result, "community")).toMatchObject({
      effectiveRating: 6,
      contribution: 3.6,
      weight: 60,
      sourceValue: 7.5,
      scoringRawValue: 7.5,
      overridden: true,
      curveAffected: true,
    });
    expect(entry(result, "weight")).toMatchObject({
      effectiveRating: 5.5,
      weight: 40,
      sourceValue: 3,
      scoringRawValue: 3,
      overridden: false,
    });
    const vetoed = service.calculateScore(migrated.games[2], migratedLegacyAxes);
    expect(vetoed).toMatchObject({
      score: 0,
      vetoed: true,
      hypotheticalScore: 5,
      vetoedBy: { axisId: "community", rawValue: 3.5, direction: "below", threshold: 4 },
    });
    expect(entry(vetoed, "community")).toMatchObject({
      sourceValue: 3.5,
      scoringRawValue: 3.5,
      effectiveRating: 4.7,
      contribution: 2.8,
      overridden: false,
    });
    expect(entry(vetoed, "weight")).toMatchObject({
      sourceValue: 3,
      scoringRawValue: 3,
      effectiveRating: 5.5,
      contribution: 2.2,
      overridden: false,
    });
  });

  test("excludes disabled legacy axes from rows, counts, weights, and vetoes", () => {
    const disabled: DisabledLegacyAxis = {
      id: "legacy",
      name: "Legacy",
      description: null,
      weight: 100,
      enabled: false,
      source: "legacy",
      reason: "unknown",
      legacyField: "future",
      legacyPayload: {},
      veto: { direction: "below", threshold: 10 },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const rated = personal();
    const result = service.calculateScore(game({ ratings: { [disabled.id]: 1, [rated.id]: 8 } }), [
      disabled,
      rated,
    ]);
    expect(result).toMatchObject({ score: 8, ratedAxisCount: 1, totalAxisCount: 1, vetoed: false });
    expect(result?.breakdown.map(({ axisId }) => axisId)).toEqual([rated.id]);
  });
});

describe("tournament regression", () => {
  test("keeps normalized tournament scoring and excludes missing rankings", () => {
    const axis: TournamentAxis = {
      id: "tournament",
      name: "Tournament",
      description: null,
      weight: 40,
      enabled: true,
      source: "tournament",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const stats = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [
        `game-${index + 1}`,
        {
          eloRating: index === 0 ? 1900 : 1500,
          comparisonCount: 6,
          wins: 0,
          losses: 0,
          recentComparisons: [],
        },
      ]),
    );
    const tournament: TournamentData = {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
      sessions: [],
      gameStats: stats,
    };
    expect(service.calculateScore(game(), [axis], tournament)?.score).toBe(10);
    expect(service.calculateScore(game({ id: "unranked" }), [axis], tournament)).toBeNull();
  });
});
