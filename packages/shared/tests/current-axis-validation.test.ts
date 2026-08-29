import { describe, expect, test } from "bun:test";
import {
  AXIS_VALIDATION_CODES,
  CodedAxisValidationError,
  CreateAxisSchema,
  CollectionSchema,
  CURRENT_COLLECTION_SCHEMA_VERSION,
  UpdateAxisSchema,
  LegacyAxisRepairSchema,
  ValidationError,
  mergeAndValidateAxisUpdate,
  parseCreateAxisInput,
  parseUpdateAxisInput,
  parseLegacyAxisRepairInput,
  repairAndValidateLegacyAxis,
  validateDerivedAxisPayload,
  type DerivedAxis,
  type DisabledLegacyAxis,
} from "../src";

const commonCreate = { name: "Test axis", weight: 50 };
const timestamp = "2026-08-24T00:00:00.000Z";

function playingTimeAxis(
  overrides: Partial<DerivedAxis<"playingTime">> = {},
): DerivedAxis<"playingTime"> {
  return {
    id: "axis-1",
    name: "Play Time",
    description: null,
    weight: 50,
    enabled: true,
    source: "derived",
    derivedField: "playingTime",
    configuration: { maximumScoringTime: 240 },
    preferenceShape: "sweet-spot",
    idealValue: 90,
    toleranceWidth: 30,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function playerCountAxis(): DerivedAxis<"playerCountFit"> {
  return {
    id: "axis-player-count",
    name: "Player Count Fit",
    description: null,
    weight: 50,
    enabled: true,
    source: "derived",
    derivedField: "playerCountFit",
    configuration: { targetPlayerCount: 4 },
    preferenceShape: "higher-is-better",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function communityRatingAxis(): DerivedAxis<"communityRating"> {
  return {
    id: "axis-community",
    name: "Community Rating",
    description: null,
    weight: 50,
    enabled: true,
    source: "derived",
    derivedField: "communityRating",
    configuration: {},
    preferenceShape: "higher-is-better",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function legacyAxis(overrides: Partial<DisabledLegacyAxis> = {}): DisabledLegacyAxis {
  return {
    id: "legacy-1",
    name: "Old axis",
    description: "Preserve me",
    weight: 25,
    enabled: false,
    source: "legacy",
    reason: "unknown_field",
    legacyField: "oldTime",
    legacyPayload: { originalSource: "external", originalField: "oldTime" },
    preferenceShape: "sweet-spot",
    idealValue: 90,
    tolerance: "moderate",
    veto: { direction: "above", threshold: 200 },
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function expectCodedError(
  action: () => unknown,
  code: (typeof AXIS_VALIDATION_CODES)[keyof typeof AXIS_VALIDATION_CODES],
  field: string,
): void {
  try {
    action();
    throw new Error("Expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CodedAxisValidationError);
    if (!(error instanceof CodedAxisValidationError)) return;
    expect(error.code).toBe(code);
    expect(error.details.map((detail) => detail.field)).toContain(field);
    expect(error.details.find((detail) => detail.field === field)?.path).toContain(field);
    expect(error.message.length).toBeGreaterThan(0);
  }
}

describe("CreateAxisSchema", () => {
  test("accepts personal and all four registered derived fields", () => {
    expect(CreateAxisSchema.safeParse({ ...commonCreate, source: "personal" }).success).toBe(true);
    for (const payload of [
      { derivedField: "communityRating", configuration: {} },
      { derivedField: "weight", configuration: {} },
      { derivedField: "playerCountFit", configuration: { targetPlayerCount: 4 } },
      { derivedField: "playingTime", configuration: { maximumScoringTime: 240 } },
    ]) {
      expect(
        CreateAxisSchema.safeParse({ ...commonCreate, source: "derived", ...payload }).success,
      ).toBe(true);
    }
  });

  test("rejects tournament creation and unknown derived IDs", () => {
    expect(CreateAxisSchema.safeParse({ ...commonCreate, source: "tournament" }).success).toBe(
      false,
    );
    expectCodedError(
      () =>
        parseCreateAxisInput({
          ...commonCreate,
          source: "derived",
          derivedField: "futureField",
          configuration: {},
        }),
      AXIS_VALIDATION_CODES.UNKNOWN_DERIVED_FIELD,
      "derivedField",
    );
  });

  test("requires exact registry-owned configuration", () => {
    for (const derivedField of ["communityRating", "weight"] as const) {
      expectCodedError(
        () =>
          parseCreateAxisInput({
            ...commonCreate,
            source: "derived",
            derivedField,
            configuration: { unsupported: true },
          }),
        AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
        "configuration",
      );
    }
    expectCodedError(
      () =>
        parseCreateAxisInput({
          ...commonCreate,
          source: "derived",
          derivedField: "playerCountFit",
        }),
      AXIS_VALIDATION_CODES.MISSING_DERIVED_CONFIGURATION,
      "configuration",
    );
    expectCodedError(
      () =>
        parseCreateAxisInput({
          ...commonCreate,
          source: "derived",
          derivedField: "playingTime",
          configuration: { targetPlayerCount: 4 },
        }),
      AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
      "configuration",
    );
    expectCodedError(
      () =>
        parseCreateAxisInput({
          ...commonCreate,
          source: "derived",
          derivedField: "playerCountFit",
          configuration: { targetPlayerCount: 4, unsupported: true },
        }),
      AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
      "configuration",
    );
  });

  test("enforces integer target count boundaries", () => {
    for (const targetPlayerCount of [1, 100]) {
      expect(
        CreateAxisSchema.safeParse({
          ...commonCreate,
          source: "derived",
          derivedField: "playerCountFit",
          configuration: { targetPlayerCount },
        }).success,
      ).toBe(true);
    }
    for (const targetPlayerCount of [0, 101, 1.5]) {
      expectCodedError(
        () =>
          parseCreateAxisInput({
            ...commonCreate,
            source: "derived",
            derivedField: "playerCountFit",
            configuration: { targetPlayerCount },
          }),
        AXIS_VALIDATION_CODES.INVALID_TARGET_PLAYER_COUNT,
        "targetPlayerCount",
      );
    }
  });

  test("enforces integer playing-time cap boundaries", () => {
    for (const maximumScoringTime of [60, 1440]) {
      expect(
        CreateAxisSchema.safeParse({
          ...commonCreate,
          source: "derived",
          derivedField: "playingTime",
          configuration: { maximumScoringTime },
        }).success,
      ).toBe(true);
    }
    for (const maximumScoringTime of [59, 1441, 60.5]) {
      expectCodedError(
        () =>
          parseCreateAxisInput({
            ...commonCreate,
            source: "derived",
            derivedField: "playingTime",
            configuration: { maximumScoringTime },
          }),
        AXIS_VALIDATION_CODES.INVALID_MAXIMUM_SCORING_TIME,
        "maximumScoringTime",
      );
    }
  });

  test("returns stable curve code and field details independently of messages", () => {
    expectCodedError(
      () =>
        parseCreateAxisInput({
          ...commonCreate,
          source: "derived",
          derivedField: "playingTime",
          configuration: { maximumScoringTime: 240 },
          preferenceShape: "sweet-spot",
          idealValue: 90,
          tolerance: "moderate",
          toleranceWidth: 30,
        }),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "toleranceWidth",
    );
  });

  test("validates personal curves against the 1..10 native scale", () => {
    expectCodedError(
      () =>
        parseCreateAxisInput({
          ...commonCreate,
          source: "personal",
          preferenceShape: "sweet-spot",
          idealValue: 11,
          toleranceWidth: 1,
        }),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "idealValue",
    );
  });

  test("rejects numeric width but preserves categorical tolerance outside sweet-spot curves", () => {
    expectCodedError(
      () =>
        parseCreateAxisInput({
          ...commonCreate,
          source: "personal",
          preferenceShape: "higher-is-better",
          toleranceWidth: 1,
        }),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "toleranceWidth",
    );
    const categorical = parseCreateAxisInput({
      ...commonCreate,
      source: "personal",
      preferenceShape: "lower-is-better",
      tolerance: "moderate",
    });
    expect(categorical.tolerance).toBe("moderate");
  });

  test("distinguishes extra payload keys from extra configuration keys", () => {
    const extraPayload = validateDerivedAxisPayload({
      derivedField: "communityRating",
      configuration: {},
      unsupported: true,
    });
    expect(extraPayload.success).toBe(false);
    if (extraPayload.success) return;
    expect(extraPayload.code).toBe(AXIS_VALIDATION_CODES.INVALID_AXIS_PAYLOAD);
    expect(extraPayload.detail).toEqual({ field: "unsupported", path: ["unsupported"] });
    expect(extraPayload.message.length).toBeGreaterThan(0);

    const extraConfiguration = validateDerivedAxisPayload({
      derivedField: "communityRating",
      configuration: { unsupported: true },
    });
    expect(extraConfiguration.success).toBe(false);
    if (extraConfiguration.success) return;
    expect(extraConfiguration.code).toBe(AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION);
    expect(extraConfiguration.detail).toEqual({
      field: "configuration",
      path: ["configuration", "unsupported"],
    });
    expect(extraConfiguration.message.length).toBeGreaterThan(0);
  });

  test("requires strict veto objects only for replacement create payloads", () => {
    expect(
      CreateAxisSchema.safeParse({
        ...commonCreate,
        source: "personal",
        veto: { direction: "above", threshold: 8, unsupported: true },
      }).success,
    ).toBe(false);
  });
});

describe("current axis updates", () => {
  test("schema cannot mutate source or derivedField", () => {
    expect(UpdateAxisSchema.safeParse({ source: "personal" }).success).toBe(false);
    expect(UpdateAxisSchema.safeParse({ derivedField: "weight" }).success).toBe(false);
  });

  test("defers malformed configuration to stored playing-time context", () => {
    for (const maximumScoringTime of [59, 1441, 60.5]) {
      const update = parseUpdateAxisInput({ configuration: { maximumScoringTime } });
      expectCodedError(
        () => mergeAndValidateAxisUpdate(playingTimeAxis(), update),
        AXIS_VALIDATION_CODES.INVALID_MAXIMUM_SCORING_TIME,
        "maximumScoringTime",
      );
    }
  });

  test("defers malformed configuration to stored player-count context", () => {
    for (const targetPlayerCount of [0, 101, 1.5]) {
      const update = parseUpdateAxisInput({ configuration: { targetPlayerCount } });
      expectCodedError(
        () => mergeAndValidateAxisUpdate(playerCountAxis(), update),
        AXIS_VALIDATION_CODES.INVALID_TARGET_PLAYER_COUNT,
        "targetPlayerCount",
      );
    }
  });

  test("reports missing and unsupported merged configuration from registry metadata", () => {
    expectCodedError(
      () =>
        mergeAndValidateAxisUpdate(playerCountAxis(), parseUpdateAxisInput({ configuration: {} })),
      AXIS_VALIDATION_CODES.MISSING_DERIVED_CONFIGURATION,
      "targetPlayerCount",
    );
    expectCodedError(
      () =>
        mergeAndValidateAxisUpdate(
          communityRatingAxis(),
          parseUpdateAxisInput({ configuration: { unsupported: true } }),
        ),
      AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
      "configuration",
    );
    expectCodedError(
      () =>
        mergeAndValidateAxisUpdate(
          playerCountAxis(),
          parseUpdateAxisInput({ configuration: { maximumScoringTime: 240 } }),
        ),
      AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
      "configuration",
    );
  });

  test("rejects conflicting tolerance and endpoint-reaching widths", () => {
    const axis = playingTimeAxis({ tolerance: "moderate" });
    expectCodedError(
      () => mergeAndValidateAxisUpdate(axis, parseUpdateAxisInput({})),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "toleranceWidth",
    );
    expectCodedError(
      () =>
        mergeAndValidateAxisUpdate(playingTimeAxis(), parseUpdateAxisInput({ toleranceWidth: 89 })),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "toleranceWidth",
    );
  });

  test("validates tolerance forms against merged preference shape", () => {
    expectCodedError(
      () =>
        mergeAndValidateAxisUpdate(
          playingTimeAxis(),
          parseUpdateAxisInput({ preferenceShape: "higher-is-better" }),
        ),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "toleranceWidth",
    );
    const retainedCategorical = mergeAndValidateAxisUpdate(
      communityRatingAxis(),
      parseUpdateAxisInput({ tolerance: "moderate" }),
    );
    expect(retainedCategorical.tolerance).toBe("moderate");

    const categorical = mergeAndValidateAxisUpdate(
      playingTimeAxis({ toleranceWidth: null, tolerance: "moderate" }),
      parseUpdateAxisInput({ name: "Categorical tolerance remains valid" }),
    );
    expect(categorical.tolerance).toBe("moderate");
  });

  test("requires strict veto objects for replacement updates", () => {
    expect(
      UpdateAxisSchema.safeParse({
        veto: { direction: "above", threshold: 8, unsupported: true },
      }).success,
    ).toBe(false);
  });

  test("rejects ideal and veto outside the native scale", () => {
    expectCodedError(
      () =>
        mergeAndValidateAxisUpdate(playingTimeAxis(), parseUpdateAxisInput({ idealValue: 241 })),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "idealValue",
    );
    expectCodedError(
      () =>
        mergeAndValidateAxisUpdate(
          playingTimeAxis(),
          parseUpdateAxisInput({ veto: { direction: "above", threshold: 241 } }),
        ),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "veto",
    );
  });

  test("rejects cap changes invalidating ideal, width, or veto", () => {
    expectCodedError(
      () =>
        mergeAndValidateAxisUpdate(
          playingTimeAxis(),
          parseUpdateAxisInput({ configuration: { maximumScoringTime: 80 } }),
        ),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "idealValue",
    );
    expectCodedError(
      () =>
        mergeAndValidateAxisUpdate(
          playingTimeAxis(),
          parseUpdateAxisInput({ configuration: { maximumScoringTime: 120 } }),
        ),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "toleranceWidth",
    );
    expectCodedError(
      () =>
        mergeAndValidateAxisUpdate(
          playingTimeAxis({ veto: { direction: "above", threshold: 200 } }),
          parseUpdateAxisInput({ configuration: { maximumScoringTime: 180 } }),
        ),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "veto",
    );
  });

  test("accepts a valid merged cap edit", () => {
    const result = mergeAndValidateAxisUpdate(
      playingTimeAxis({ veto: { direction: "above", threshold: 150 } }),
      parseUpdateAxisInput({ configuration: { maximumScoringTime: 180 } }),
    );
    expect(result.source).toBe("derived");
    if (result.source === "derived")
      expect(result.configuration).toEqual({ maximumScoringTime: 180 });
  });

  test("ordinary updates preserve disabled legacy state", () => {
    const result = mergeAndValidateAxisUpdate(
      legacyAxis(),
      parseUpdateAxisInput({ name: "Still disabled" }),
    );
    expect(result.source).toBe("legacy");
    expect(result.enabled).toBe(false);
  });
});

describe("legacy axis repair", () => {
  test("repairs atomically with replacement configuration, curve, veto, and common fields", () => {
    const repair = parseLegacyAxisRepairInput({
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 180 },
      name: "Repaired time",
      idealValue: 90,
      tolerance: null,
      toleranceWidth: 30,
      veto: { direction: "above", threshold: 150 },
    });
    expect(LegacyAxisRepairSchema.safeParse(repair).success).toBe(true);
    const result = repairAndValidateLegacyAxis(legacyAxis(), repair);
    expect(result).toMatchObject({
      id: "legacy-1",
      name: "Repaired time",
      source: "derived",
      enabled: true,
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 180 },
      toleranceWidth: 30,
      veto: { direction: "above", threshold: 150 },
    });
    expect(result.tolerance).toBeUndefined();
  });

  test("returns the repair-specific code when the resulting axis is invalid", () => {
    const repair = parseLegacyAxisRepairInput({
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 120 },
      tolerance: null,
    });
    expectCodedError(
      () => repairAndValidateLegacyAxis(legacyAxis(), repair),
      AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR,
      "veto",
    );
  });

  test("preserves categorical tolerance while rejecting numeric width and non-strict veto repairs", () => {
    const categorical = parseLegacyAxisRepairInput({
      derivedField: "communityRating",
      configuration: {},
      preferenceShape: "higher-is-better",
      idealValue: null,
      tolerance: "moderate",
      veto: null,
    });
    const categoricalRepair = repairAndValidateLegacyAxis(legacyAxis(), categorical);
    expect(categoricalRepair.tolerance).toBe("moderate");
    const behaviorlessWidth = parseLegacyAxisRepairInput({
      derivedField: "communityRating",
      configuration: {},
      preferenceShape: "higher-is-better",
      idealValue: 5,
      tolerance: null,
      toleranceWidth: 1,
      veto: null,
    });
    expectCodedError(
      () => repairAndValidateLegacyAxis(legacyAxis(), behaviorlessWidth),
      AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR,
      "toleranceWidth",
    );
    expect(
      LegacyAxisRepairSchema.safeParse({
        derivedField: "communityRating",
        configuration: {},
        veto: { direction: "above", threshold: 8, unsupported: true },
      }).success,
    ).toBe(false);
  });
});

describe("legacy contracts", () => {
  test("keeps ValidationError constructor behavior unchanged", () => {
    const error = new ValidationError("legacy message");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ValidationError");
    expect(error.message).toBe("legacy message");
  });
});

describe("current persisted collection validation", () => {
  const currentCollection = {
    schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
    revision: 0,
    id: "collection-1",
    name: "Current",
    axes: [communityRatingAxis()],
    games: [],
    intentions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  test("accepts the strict current schema", () => {
    expect(CollectionSchema.parse(currentCollection)).toEqual(currentCollection);
  });

  test("rejects historical game shapes outside migration", () => {
    const oldGame = {
      id: "game-1",
      bggId: 1,
      name: "Existing Game",
      yearPublished: 2020,
      minPlayers: 2,
      maxPlayers: 4,
      playingTime: 60,
      imageUrl: null,
      bggData: {
        communityRating: 7,
        bayesAverage: 6.5,
        weight: null,
        numWeightVotes: 0,
        description: null,
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        fetchedAt: timestamp,
      },
      numPlays: null,
      ownership: "owned",
      boxDimensions: null,
      manualShelfId: null,
      ratings: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(CollectionSchema.safeParse({ ...currentCollection, games: [oldGame] }).success).toBe(
      false,
    );
  });

  test("preserves explicit null best-player fields in persisted output", () => {
    const oldCollection = CollectionSchema.parse({
      ...currentCollection,
      games: [
        {
          id: "game-1",
          bggId: null,
          name: "Poll-less Game",
          yearPublished: null,
          minPlayers: null,
          maxPlayers: null,
          bestPlayers: null,
          playingTime: null,
          imageUrl: null,
          bggData: {
            communityRating: 0,
            bayesAverage: 0,
            weight: null,
            numWeightVotes: 0,
            description: null,
            mechanics: [],
            categories: [],
            families: [],
            subdomains: [],
            bestPlayerCount: null,
            fetchedAt: timestamp,
          },
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
          entityMetadata: {
            mechanic: {
              state: "unrefreshable",
              entities: [],
              observedAt: null,
              refreshFailure: null,
              correctionDestination: null,
              explanation:
                "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
            },
            designer: {
              state: "unrefreshable",
              entities: [],
              observedAt: null,
              refreshFailure: null,
              correctionDestination: null,
              explanation:
                "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
            },
            artist: {
              state: "unrefreshable",
              entities: [],
              observedAt: null,
              refreshFailure: null,
              correctionDestination: null,
              explanation:
                "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
            },
          },
          latestPlayCountCheck: null,
          ownership: "owned",
          boxDimensions: null,
          manualShelfId: null,
          ratings: {},
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    expect(oldCollection.games[0]?.bestPlayers).toBeNull();
    expect(oldCollection.games[0]?.bggData?.bestPlayerCount).toBeNull();
  });

  test("rejects malformed amount and evidence payloads at the strict runtime boundary", () => {
    expect(
      CollectionSchema.safeParse({
        ...currentCollection,
        entertainmentBenchmark: {
          state: "configured",
          amount: { hundredths: -1, source: "manual", confirmedAt: timestamp },
        },
      }).success,
    ).toBe(false);
    expect(
      CollectionSchema.safeParse({
        ...currentCollection,
        games: [
          {
            id: "invalid",
            bggId: null,
            name: "Invalid",
            yearPublished: null,
            minPlayers: null,
            maxPlayers: null,
            bestPlayers: null,
            playingTime: null,
            imageUrl: null,
            bggData: null,
            numPlays: null,
            acquisition: { state: "purchase", amount: { hundredths: "10" } },
            playCountEvidence: { status: "invalid", evidence: { presence: "present" } },
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
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("keeps persisted structural validation separate from mutation curve semantics", () => {
    const historicalCurve: DerivedAxis<"communityRating"> = {
      ...communityRatingAxis(),
      preferenceShape: "sweet-spot",
      idealValue: 12,
      veto: { direction: "below", threshold: -2 },
    };
    expect(
      CollectionSchema.safeParse({ ...currentCollection, axes: [historicalCurve] }).success,
    ).toBe(true);
    expectCodedError(
      () =>
        parseCreateAxisInput({
          name: historicalCurve.name,
          weight: historicalCurve.weight,
          source: "derived",
          derivedField: "communityRating",
          configuration: {},
          preferenceShape: historicalCurve.preferenceShape,
          idealValue: historicalCurve.idealValue,
          veto: historicalCurve.veto,
        }),
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      "idealValue",
    );
  });

  test("rejects future versions and extra persisted fields", () => {
    expect(CollectionSchema.safeParse({ ...currentCollection, schemaVersion: 6 }).success).toBe(
      false,
    );
    expect(CollectionSchema.safeParse({ ...currentCollection, unexpected: true }).success).toBe(
      false,
    );
    expect(
      CollectionSchema.safeParse({
        ...currentCollection,
        axes: [{ ...communityRatingAxis(), unsupportedPersistedField: true }],
      }).success,
    ).toBe(false);
  });

  test("requires disabled legacy snapshots", () => {
    const withoutSnapshot: Record<string, unknown> = { ...legacyAxis() };
    Reflect.deleteProperty(withoutSnapshot, "legacyPayload");
    expect(
      CollectionSchema.safeParse({ ...currentCollection, axes: [withoutSnapshot] }).success,
    ).toBe(false);
  });
});
