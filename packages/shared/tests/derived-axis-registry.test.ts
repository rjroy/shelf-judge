import { describe, expect, test } from "bun:test";
import {
  DERIVED_AXIS_REGISTRY,
  getCurrentAxisNativeScale,
  getDerivedAxisNativeScale,
  getDerivedFieldDiscovery,
  isEnabledScoringAxis,
  isVectorEligibleAxis,
  resolveDerivedAxisValue,
  summarizeDerivedAxisConfiguration,
} from "../src/derived-axis-registry";
import { AXIS_VALIDATION_CODES } from "../src/errors";
import type {
  CurrentAxis,
  CurrentCollection,
  DerivedAxis,
  DerivedFieldId,
  Game,
  PersonalAxis,
  TournamentAxis,
} from "../src/types";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game",
    bggId: null,
    name: "Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const commonAxis = {
  id: "axis",
  name: "Axis",
  description: null,
  weight: 50,
  enabled: true as const,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("derived axis registry contract", () => {
  test("contains exactly the four approved field IDs", () => {
    expect(Object.keys(DERIVED_AXIS_REGISTRY)).toEqual([
      "communityRating",
      "weight",
      "playerCountFit",
      "playingTime",
    ] satisfies DerivedFieldId[]);
  });

  test("owns stable configuration validation metadata", () => {
    expect(
      Object.fromEntries(
        Object.entries(DERIVED_AXIS_REGISTRY).map(([id, definition]) => [
          id,
          definition.configurationValidation,
        ]),
      ),
    ).toEqual({
      communityRating: {
        field: null,
        invalidCode: AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
      },
      weight: {
        field: null,
        invalidCode: AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
      },
      playerCountFit: {
        field: "targetPlayerCount",
        invalidCode: AXIS_VALIDATION_CODES.INVALID_TARGET_PLAYER_COUNT,
      },
      playingTime: {
        field: "maximumScoringTime",
        invalidCode: AXIS_VALIDATION_CODES.INVALID_MAXIMUM_SCORING_TIME,
      },
    });
  });

  test("pins Community Rating metadata and current storage defaults", () => {
    const definition = DERIVED_AXIS_REGISTRY.communityRating;
    expect({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      provenance: definition.provenance,
      unit: definition.unit,
      missingValuePolicy: definition.missingValuePolicy,
      nativeScaleDiscovery: definition.nativeScaleDiscovery,
      defaultNativeScale: definition.defaultNativeScale,
    }).toEqual({
      id: "communityRating",
      label: "Community Rating",
      description: "BGG community average rating",
      provenance: "BoardGameGeek community average rating",
      unit: "rating",
      missingValuePolicy: "Missing when BoardGameGeek data is unavailable.",
      nativeScaleDiscovery: { type: "fixed", min: 1, max: 10 },
      defaultNativeScale: { min: 1, max: 10 },
    });
    expect(definition.templateDefaults).toEqual({
      name: "Community Rating",
      description: "BGG community average rating",
      weight: 50,
      preferenceShape: "higher-is-better",
      configuration: {},
    });
  });

  test("pins Complexity metadata and current storage defaults", () => {
    const definition = DERIVED_AXIS_REGISTRY.weight;
    expect({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      provenance: definition.provenance,
      unit: definition.unit,
      missingValuePolicy: definition.missingValuePolicy,
      nativeScaleDiscovery: definition.nativeScaleDiscovery,
      defaultNativeScale: definition.defaultNativeScale,
    }).toEqual({
      id: "weight",
      label: "Complexity",
      description: "BGG weight normalized to 1-10 scale",
      provenance: "BoardGameGeek community weight rating",
      unit: "weight",
      missingValuePolicy: "Missing when BoardGameGeek weight is unavailable.",
      nativeScaleDiscovery: { type: "fixed", min: 1, max: 5 },
      defaultNativeScale: { min: 1, max: 5 },
    });
    expect(definition.templateDefaults).toEqual({
      name: "Complexity",
      description: "BGG weight normalized to 1-10 scale",
      weight: 50,
      preferenceShape: "higher-is-better",
      configuration: {},
    });
  });

  test("pins Player Count Fit metadata, required target, and template defaults", () => {
    const definition = DERIVED_AXIS_REGISTRY.playerCountFit;
    expect({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      provenance: definition.provenance,
      unit: definition.unit,
      missingValuePolicy: definition.missingValuePolicy,
      nativeScaleDiscovery: definition.nativeScaleDiscovery,
      defaultNativeScale: definition.defaultNativeScale,
    }).toEqual({
      id: "playerCountFit",
      label: "Player Count Fit",
      description: "Checks a target player count against the publisher-declared player range.",
      provenance: "Publisher-declared minimum and maximum player count",
      unit: "fit score",
      missingValuePolicy:
        "Missing when publisher player bounds are absent, nonfinite, nonpositive, or reversed.",
      nativeScaleDiscovery: { type: "fixed", min: 1, max: 10 },
      defaultNativeScale: { min: 1, max: 10 },
    });
    expect(definition.configurationDiscovery).toEqual([
      {
        name: "targetPlayerCount",
        type: "integer",
        required: true,
        minimum: 1,
        maximum: 100,
      },
    ]);
    expect(definition.templateDefaults).toEqual({
      name: "Player Count Fit",
      description: "Checks a target player count against the publisher-declared player range.",
      weight: 50,
      preferenceShape: "higher-is-better",
      configuration: {},
    });
    expect(definition.configurationSchema.safeParse({}).success).toBe(false);
    expect(definition.configurationSchema.safeParse({ targetPlayerCount: 1 }).success).toBe(true);
    expect(definition.configurationSchema.safeParse({ targetPlayerCount: 100 }).success).toBe(true);
    expect(definition.configurationSchema.safeParse({ targetPlayerCount: 0 }).success).toBe(false);
    expect(definition.configurationSchema.safeParse({ targetPlayerCount: 101 }).success).toBe(
      false,
    );
    expect(definition.configurationSchema.safeParse({ targetPlayerCount: 1.5 }).success).toBe(
      false,
    );
  });

  test("pins Play Time metadata, cap constraints, and template defaults", () => {
    const definition = DERIVED_AXIS_REGISTRY.playingTime;
    expect({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      provenance: definition.provenance,
      unit: definition.unit,
      missingValuePolicy: definition.missingValuePolicy,
      nativeScaleDiscovery: definition.nativeScaleDiscovery,
      defaultNativeScale: definition.defaultNativeScale,
    }).toEqual({
      id: "playingTime",
      label: "Play Time",
      description: "Scores publisher-listed playing time against your preferred duration.",
      provenance: "Publisher-listed playing time imported from BoardGameGeek",
      unit: "minutes",
      missingValuePolicy:
        "Missing when publisher playing time is absent, nonfinite, or nonpositive.",
      nativeScaleDiscovery: {
        type: "configuration-bound",
        min: 1,
        maxConfigurationProperty: "maximumScoringTime",
      },
      defaultNativeScale: { min: 1, max: 240 },
    });
    expect(definition.configurationDiscovery).toEqual([
      {
        name: "maximumScoringTime",
        type: "integer",
        required: true,
        minimum: 60,
        maximum: 1440,
        default: 240,
      },
    ]);
    expect(definition.templateDefaults).toEqual({
      name: "Play Time",
      description: "Scores publisher-listed playing time against your preferred duration.",
      weight: 50,
      preferenceShape: "sweet-spot",
      idealValue: 90,
      toleranceWidth: 30,
      configuration: { maximumScoringTime: 240 },
    });
    expect(definition.configurationSchema.safeParse({}).success).toBe(false);
    expect(definition.configurationSchema.safeParse({ maximumScoringTime: 60 }).success).toBe(true);
    expect(definition.configurationSchema.safeParse({ maximumScoringTime: 1440 }).success).toBe(
      true,
    );
    expect(definition.configurationSchema.safeParse({ maximumScoringTime: 59 }).success).toBe(
      false,
    );
    expect(definition.configurationSchema.safeParse({ maximumScoringTime: 1441 }).success).toBe(
      false,
    );
    expect(definition.configurationSchema.safeParse({ maximumScoringTime: 60.5 }).success).toBe(
      false,
    );
  });

  test("serializes every discovery property including dynamic scale relationships", () => {
    const discovery = getDerivedFieldDiscovery();
    expect(discovery).toEqual({
      version: 1,
      fields: [
        {
          id: "communityRating",
          label: "Community Rating",
          description: "BGG community average rating",
          provenance: "BoardGameGeek community average rating",
          unit: "rating",
          missingValuePolicy: "Missing when BoardGameGeek data is unavailable.",
          nativeScaleDiscovery: { type: "fixed", min: 1, max: 10 },
          nativeScale: { min: 1, max: 10 },
          configuration: [],
          template: {
            name: "Community Rating",
            description: "BGG community average rating",
            weight: 50,
            preferenceShape: "higher-is-better",
            configuration: {},
          },
        },
        {
          id: "weight",
          label: "Complexity",
          description: "BGG weight normalized to 1-10 scale",
          provenance: "BoardGameGeek community weight rating",
          unit: "weight",
          missingValuePolicy: "Missing when BoardGameGeek weight is unavailable.",
          nativeScaleDiscovery: { type: "fixed", min: 1, max: 5 },
          nativeScale: { min: 1, max: 5 },
          configuration: [],
          template: {
            name: "Complexity",
            description: "BGG weight normalized to 1-10 scale",
            weight: 50,
            preferenceShape: "higher-is-better",
            configuration: {},
          },
        },
        {
          id: "playerCountFit",
          label: "Player Count Fit",
          description: "Checks a target player count against the publisher-declared player range.",
          provenance: "Publisher-declared minimum and maximum player count",
          unit: "fit score",
          missingValuePolicy:
            "Missing when publisher player bounds are absent, nonfinite, nonpositive, or reversed.",
          nativeScaleDiscovery: { type: "fixed", min: 1, max: 10 },
          nativeScale: { min: 1, max: 10 },
          configuration: [
            {
              name: "targetPlayerCount",
              type: "integer",
              required: true,
              minimum: 1,
              maximum: 100,
            },
          ],
          template: {
            name: "Player Count Fit",
            description:
              "Checks a target player count against the publisher-declared player range.",
            weight: 50,
            preferenceShape: "higher-is-better",
            configuration: {},
          },
        },
        {
          id: "playingTime",
          label: "Play Time",
          description: "Scores publisher-listed playing time against your preferred duration.",
          provenance: "Publisher-listed playing time imported from BoardGameGeek",
          unit: "minutes",
          missingValuePolicy:
            "Missing when publisher playing time is absent, nonfinite, or nonpositive.",
          nativeScaleDiscovery: {
            type: "configuration-bound",
            min: 1,
            maxConfigurationProperty: "maximumScoringTime",
          },
          nativeScale: { min: 1, max: 240 },
          configuration: [
            {
              name: "maximumScoringTime",
              type: "integer",
              required: true,
              minimum: 60,
              maximum: 1440,
              default: 240,
            },
          ],
          template: {
            name: "Play Time",
            description: "Scores publisher-listed playing time against your preferred duration.",
            weight: 50,
            preferenceShape: "sweet-spot",
            idealValue: 90,
            toleranceWidth: 30,
            configuration: { maximumScoringTime: 240 },
          },
        },
      ],
    });
    expect(JSON.parse(JSON.stringify(discovery))).toEqual(discovery);
  });

  test("retains exact direct-entry configuration types and validates generic input", () => {
    const game = makeGame({ playingTime: 120 });
    expect(DERIVED_AXIS_REGISTRY.playingTime.resolve(game, { maximumScoringTime: 240 })).toEqual({
      sourceValue: 120,
      scoringRawValue: 120,
    });
    expect(DERIVED_AXIS_REGISTRY.playingTime.nativeScale({ maximumScoringTime: 360 })).toEqual({
      min: 1,
      max: 360,
    });
    expect(
      DERIVED_AXIS_REGISTRY.playingTime.summarizeConfiguration({ maximumScoringTime: 360 }),
    ).toBe("Scoring cap: 360 minutes");

    if (game.id === "compile-time-only") {
      // @ts-expect-error Play Time accepts only PlayingTimeConfiguration.
      DERIVED_AXIS_REGISTRY.playingTime.resolve(game, { targetPlayerCount: 4 });
      // @ts-expect-error Extra configuration is rejected by direct scale lookup.
      DERIVED_AXIS_REGISTRY.playingTime.nativeScale({ maximumScoringTime: 240, extra: 1 });
      // @ts-expect-error Player Count Fit accepts only PlayerCountFitConfiguration.
      DERIVED_AXIS_REGISTRY.playerCountFit.summarizeConfiguration({ maximumScoringTime: 240 });
      // @ts-expect-error Fields without configuration reject extra properties.
      DERIVED_AXIS_REGISTRY.communityRating.resolve(game, { extra: 1 });
    }

    expect(() =>
      DERIVED_AXIS_REGISTRY.playingTime.resolveFromUnknown(game, { targetPlayerCount: 4 }),
    ).toThrow();
    expect(() =>
      DERIVED_AXIS_REGISTRY.playingTime.nativeScaleFromUnknown({
        maximumScoringTime: 240,
        extra: 1,
      }),
    ).toThrow();
    expect(() =>
      DERIVED_AXIS_REGISTRY.playerCountFit.summarizeConfigurationFromUnknown({
        targetPlayerCount: 4,
        extra: 1,
      }),
    ).toThrow();
    expect(() =>
      DERIVED_AXIS_REGISTRY.communityRating.resolveFromUnknown(game, { extra: 1 }),
    ).toThrow();
  });
});

describe("derived value resolution", () => {
  const communityAxis: DerivedAxis<"communityRating"> = {
    ...commonAxis,
    source: "derived",
    derivedField: "communityRating",
    configuration: {},
  };
  const weightAxis: DerivedAxis<"weight"> = {
    ...commonAxis,
    source: "derived",
    derivedField: "weight",
    configuration: {},
  };
  const playerAxis: DerivedAxis<"playerCountFit"> = {
    ...commonAxis,
    source: "derived",
    derivedField: "playerCountFit",
    configuration: { targetPlayerCount: 4 },
  };
  const timeAxis: DerivedAxis<"playingTime"> = {
    ...commonAxis,
    source: "derived",
    derivedField: "playingTime",
    configuration: { maximumScoringTime: 240 },
  };

  test("preserves Community Rating and Complexity BGG-data behavior", () => {
    const game = makeGame({
      bggData: {
        communityRating: 7.8,
        bayesAverage: 7.2,
        weight: 3.4,
        numWeightVotes: 10,
        description: null,
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        suggestedPlayerCounts: [],
        fetchedAt: "2026-01-01T00:00:00Z",
      },
    });
    expect(resolveDerivedAxisValue(communityAxis, game)).toEqual({
      sourceValue: 7.8,
      scoringRawValue: 7.8,
    });
    expect(resolveDerivedAxisValue(weightAxis, game)).toEqual({
      sourceValue: 3.4,
      scoringRawValue: 3.4,
    });
    expect(resolveDerivedAxisValue(weightAxis, makeGame())).toBeNull();
  });

  test("uses inclusive publisher player bounds", () => {
    expect(resolveDerivedAxisValue(playerAxis, makeGame({ minPlayers: 4, maxPlayers: 8 }))).toEqual(
      {
        sourceValue: 10,
        scoringRawValue: 10,
      },
    );
    expect(resolveDerivedAxisValue(playerAxis, makeGame({ minPlayers: 1, maxPlayers: 4 }))).toEqual(
      {
        sourceValue: 10,
        scoringRawValue: 10,
      },
    );
    expect(resolveDerivedAxisValue(playerAxis, makeGame({ minPlayers: 5, maxPlayers: 8 }))).toEqual(
      {
        sourceValue: 1,
        scoringRawValue: 1,
      },
    );
  });

  test("accepts target 100 within imported bounds above 100", () => {
    const target100: DerivedAxis<"playerCountFit"> = {
      ...playerAxis,
      configuration: { targetPlayerCount: 100 },
    };
    expect(
      resolveDerivedAxisValue(target100, makeGame({ minPlayers: 1, maxPlayers: 500 })),
    ).toEqual({
      sourceValue: 10,
      scoringRawValue: 10,
    });
  });

  test("treats every malformed player-bound position as missing", () => {
    for (const game of [
      makeGame({ minPlayers: null, maxPlayers: 4 }),
      makeGame({ minPlayers: 1, maxPlayers: null }),
      makeGame({ minPlayers: 0, maxPlayers: 4 }),
      makeGame({ minPlayers: 1, maxPlayers: 0 }),
      makeGame({ minPlayers: -1, maxPlayers: 4 }),
      makeGame({ minPlayers: 1, maxPlayers: -4 }),
      makeGame({ minPlayers: Number.NaN, maxPlayers: 4 }),
      makeGame({ minPlayers: 1, maxPlayers: Number.NaN }),
      makeGame({ minPlayers: Number.POSITIVE_INFINITY, maxPlayers: 4 }),
      makeGame({ minPlayers: 5, maxPlayers: 4 }),
      makeGame({ minPlayers: 1, maxPlayers: Number.POSITIVE_INFINITY }),
    ]) {
      expect(resolveDerivedAxisValue(playerAxis, game)).toBeNull();
    }
  });

  test("retains published time while dynamically capping scoring input", () => {
    expect(resolveDerivedAxisValue(timeAxis, makeGame({ playingTime: 120 }))).toEqual({
      sourceValue: 120,
      scoringRawValue: 120,
    });
    expect(resolveDerivedAxisValue(timeAxis, makeGame({ playingTime: 240 }))).toEqual({
      sourceValue: 240,
      scoringRawValue: 240,
    });
    expect(resolveDerivedAxisValue(timeAxis, makeGame({ playingTime: 300 }))).toEqual({
      sourceValue: 300,
      scoringRawValue: 240,
    });
    expect(resolveDerivedAxisValue(timeAxis, makeGame({ playingTime: 0 }))).toBeNull();
    expect(
      resolveDerivedAxisValue(timeAxis, makeGame({ playingTime: Number.POSITIVE_INFINITY })),
    ).toBeNull();
    expect(resolveDerivedAxisValue(timeAxis, makeGame())).toBeNull();

    const shorterCap: DerivedAxis<"playingTime"> = {
      ...timeAxis,
      configuration: { maximumScoringTime: 180 },
    };
    expect(getDerivedAxisNativeScale(shorterCap)).toEqual({ min: 1, max: 180 });
    expect(resolveDerivedAxisValue(shorterCap, makeGame({ playingTime: 200 }))).toEqual({
      sourceValue: 200,
      scoringRawValue: 180,
    });
  });
});

describe("current-axis helpers", () => {
  const personal: PersonalAxis = { ...commonAxis, source: "personal" };
  const tournament: TournamentAxis = { ...commonAxis, source: "tournament" };
  const derived: DerivedAxis<"playerCountFit"> = {
    ...commonAxis,
    source: "derived",
    derivedField: "playerCountFit",
    configuration: { targetPlayerCount: 3 },
  };
  const disabled: CurrentAxis = {
    ...commonAxis,
    source: "legacy",
    enabled: false,
    reason: "Unsupported field",
    legacyField: "unknown",
    legacyPayload: { bggField: "unknown" },
  };

  test("filters scoring and vector axes independently", () => {
    expect([personal, tournament, derived, disabled].filter(isEnabledScoringAxis)).toEqual([
      personal,
      tournament,
      derived,
    ]);
    expect([personal, tournament, derived, disabled].filter(isVectorEligibleAxis)).toEqual([
      personal,
      tournament,
    ]);
  });

  test("looks up native scales and stable configuration summaries", () => {
    expect(getCurrentAxisNativeScale(personal)).toEqual({ min: 1, max: 10 });
    expect(getCurrentAxisNativeScale(derived)).toEqual({ min: 1, max: 10 });
    expect(summarizeDerivedAxisConfiguration(derived)).toBe("Target: 3 players");
    const time: DerivedAxis<"playingTime"> = {
      ...commonAxis,
      source: "derived",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 360 },
    };
    expect(getCurrentAxisNativeScale(time)).toEqual({ min: 1, max: 360 });
    expect(summarizeDerivedAxisConfiguration(time)).toBe("Scoring cap: 360 minutes");
  });

  test("supports an additive versioned persisted collection contract", () => {
    const collection: CurrentCollection = {
      schemaVersion: 1,
      id: "collection",
      name: "Collection",
      axes: [personal, tournament, derived, disabled],
      games: [makeGame()],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    expect(collection.schemaVersion).toBe(1);
    expect(collection.axes).toEqual([personal, tournament, derived, disabled]);
  });
});
