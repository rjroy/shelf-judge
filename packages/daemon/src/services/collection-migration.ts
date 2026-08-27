import {
  CURRENT_COLLECTION_SCHEMA_VERSION,
  CollectionSchema,
  isUsableSuggestedPlayerPoll,
  type Axis,
  type AxisBase,
  type Collection,
  type DisabledLegacyAxis,
  type InvalidEvidence,
  type JsonValue,
} from "@shelf-judge/shared";
import { z } from "zod";

export interface CollectionMigrationResult {
  data: Collection;
  migrated: boolean;
  sourceVersion: number;
  convertedAxisCount: number;
  disabledAxisCount: number;
}

export interface CollectionMigrationDependencies {
  createId(): string;
  now(): string;
}

export interface CollectionMigrationStepResult {
  data: unknown;
  convertedAxisCount: number;
  disabledAxisCount: number;
}

export interface CollectionMigrationStep {
  fromVersion: number;
  toVersion: number;
  migrate(
    raw: unknown,
    dependencies: CollectionMigrationDependencies,
  ): CollectionMigrationStepResult;
}

const defaultDependencies: CollectionMigrationDependencies = {
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

const legacyCurveFields = {
  preferenceShape: z.enum(["higher-is-better", "lower-is-better", "sweet-spot"]).optional(),
  idealValue: z.number().nullable().optional(),
  tolerance: z.enum(["flexible", "moderate", "strict"]).optional(),
  toleranceWidth: z.number().nullable().optional(),
  leanDirection: z.enum(["lower", "higher"]).nullable().optional(),
  veto: z
    .object({ direction: z.enum(["below", "above"]), threshold: z.number() })
    .strict()
    .nullable()
    .optional(),
};

const LegacyAxisSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    weight: z.number().int().min(0).max(100),
    source: z.unknown(),
    bggField: z.unknown().optional(),
    ...legacyCurveFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

type LegacyAxisInput = z.output<typeof LegacyAxisSchema>;

const HistoricalBggTagSchema = z.object({ id: z.number().int(), name: z.string() }).strict();
const HistoricalBggDataSchema = z
  .object({
    communityRating: z.number(),
    bayesAverage: z.number(),
    weight: z.number().nullable(),
    numWeightVotes: z.number().int().min(0),
    description: z.string().nullable(),
    mechanics: z.array(HistoricalBggTagSchema),
    categories: z.array(HistoricalBggTagSchema),
    families: z.array(HistoricalBggTagSchema),
    subdomains: z.array(HistoricalBggTagSchema),
    suggestedPlayerCounts: z.unknown().optional(),
    bestPlayerCount: z.unknown().optional(),
    fetchedAt: z.string(),
  })
  .strict();

const HistoricalBoxDimensionsSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    depth: z.number().positive(),
  })
  .strict();

const HistoricalGameSchema = z
  .object({
    id: z.string().min(1),
    bggId: z.number().int().nullable(),
    name: z.string().min(1),
    yearPublished: z.number().int().nullable(),
    minPlayers: z.unknown().optional(),
    maxPlayers: z.unknown().optional(),
    bestPlayers: z.unknown().optional(),
    playingTime: z.unknown().optional(),
    imageUrl: z.string().nullable(),
    bggData: HistoricalBggDataSchema.nullable(),
    numPlays: z.unknown().optional(),
    ownership: z.enum(["owned", "previously-owned"]).optional(),
    boxDimensions: HistoricalBoxDimensionsSchema.nullable().optional(),
    manualShelfId: z.string().nullable().optional(),
    ratings: z.record(z.number().int().min(1).max(10)),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const HistoricalCollectionSchema = z
  .object({
    schemaVersion: z.literal(0).optional(),
    id: z.string().min(1),
    name: z.string().min(1),
    axes: z.array(LegacyAxisSchema),
    games: z.array(HistoricalGameSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const TOURNAMENT_AXIS_DESCRIPTION =
  "Derived from head-to-head tournament comparisons. Each game's score is its normalized ELO display value.";

function currentBase(axis: LegacyAxisInput): AxisBase {
  return {
    id: axis.id,
    name: axis.name,
    description: axis.description,
    weight: axis.weight,
    enabled: true,
    ...(axis.preferenceShape === undefined ? {} : { preferenceShape: axis.preferenceShape }),
    ...(axis.idealValue === undefined ? {} : { idealValue: axis.idealValue }),
    ...(axis.tolerance === undefined ? {} : { tolerance: axis.tolerance }),
    ...(axis.toleranceWidth === undefined ? {} : { toleranceWidth: axis.toleranceWidth }),
    ...(axis.leanDirection === undefined ? {} : { leanDirection: axis.leanDirection }),
    ...(axis.veto === undefined ? {} : { veto: axis.veto }),
    createdAt: axis.createdAt,
    updatedAt: axis.updatedAt,
  };
}

function disableLegacyAxis(
  axis: LegacyAxisInput,
  original: unknown,
  reason: string,
): DisabledLegacyAxis {
  const base = currentBase(axis);
  return {
    ...base,
    enabled: false,
    source: "legacy",
    reason,
    legacyField: typeof axis.bggField === "string" ? axis.bggField : null,
    legacyPayload: original,
  };
}

function migrateAxis(original: unknown): {
  axis: Axis;
  converted: boolean;
  disabled: boolean;
} {
  const axis = LegacyAxisSchema.parse(original);
  const base = currentBase(axis);

  if (axis.source === "personal" && (axis.bggField === null || axis.bggField === undefined)) {
    return { axis: { ...base, source: "personal" }, converted: false, disabled: false };
  }
  if (axis.source === "tournament" && (axis.bggField === null || axis.bggField === undefined)) {
    return { axis: { ...base, source: "tournament" }, converted: false, disabled: false };
  }
  if (axis.source === "bgg" && axis.bggField === "communityRating") {
    return {
      axis: { ...base, source: "derived", derivedField: "communityRating", configuration: {} },
      converted: true,
      disabled: false,
    };
  }
  if (axis.source === "bgg" && axis.bggField === "weight") {
    return {
      axis: { ...base, source: "derived", derivedField: "weight", configuration: {} },
      converted: true,
      disabled: false,
    };
  }

  const reason =
    axis.source === "bgg" && typeof axis.bggField === "string"
      ? "unknown_legacy_field"
      : "malformed_legacy_source_field";
  return { axis: disableLegacyAxis(axis, original, reason), converted: false, disabled: true };
}

function backfillHistoricalGame(game: z.output<typeof HistoricalGameSchema>): unknown {
  return {
    ...game,
    ownership: game.ownership ?? "owned",
    boxDimensions: game.boxDimensions ?? null,
    manualShelfId: game.manualShelfId ?? null,
  };
}

function createTournamentAxis(dependencies: CollectionMigrationDependencies): Axis {
  const now = dependencies.now();
  return {
    id: dependencies.createId(),
    name: "Tournament",
    description: TOURNAMENT_AXIS_DESCRIPTION,
    weight: 30,
    enabled: true,
    source: "tournament",
    createdAt: now,
    updatedAt: now,
  };
}

function migrateVersionZeroToOne(
  raw: unknown,
  dependencies: CollectionMigrationDependencies,
): CollectionMigrationStepResult {
  const historical = HistoricalCollectionSchema.parse(raw);
  let convertedAxisCount = 0;
  let disabledAxisCount = 0;
  const axes = historical.axes.map((axis) => {
    const result = migrateAxis(axis);
    if (result.converted) convertedAxisCount += 1;
    if (result.disabled) disabledAxisCount += 1;
    return result.axis;
  });
  if (!axes.some((axis) => axis.source === "tournament")) {
    axes.push(createTournamentAxis(dependencies));
  }

  return {
    data: {
      schemaVersion: 1,
      id: historical.id,
      name: historical.name,
      axes,
      games: historical.games.map(backfillHistoricalGame),
      createdAt: historical.createdAt,
      updatedAt: dependencies.now(),
    },
    convertedAxisCount,
    disabledAxisCount,
  };
}

const VersionOneGameSchema = HistoricalGameSchema.extend({
  ownership: z.enum(["owned", "previously-owned"]),
  boxDimensions: HistoricalBoxDimensionsSchema.nullable(),
  manualShelfId: z.string().nullable(),
}).strict();

const historicalCurrentCollectionFields = {
  id: z.string().min(1),
  name: z.string().min(1),
  axes: z.array(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const VersionOneCollectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    ...historicalCurrentCollectionFields,
    games: z.array(VersionOneGameSchema),
  })
  .strict();

function validBestPlayerCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
}

function migrateVersionOneToTwo(raw: unknown): CollectionMigrationStepResult {
  const historical = VersionOneCollectionSchema.parse(raw);
  return {
    data: {
      ...historical,
      schemaVersion: 2,
      games: historical.games.map((game) => {
        const bestPlayerCount = validBestPlayerCount(game.bggData?.bestPlayerCount);
        return {
          ...game,
          bestPlayers: validBestPlayerCount(game.bestPlayers) ?? bestPlayerCount,
          bggData: game.bggData === null ? null : { ...game.bggData, bestPlayerCount },
        };
      }),
    },
    convertedAxisCount: 0,
    disabledAxisCount: 0,
  };
}

const VersionTwoCollectionSchema = z
  .object({
    schemaVersion: z.literal(2),
    ...historicalCurrentCollectionFields,
    games: z.array(VersionOneGameSchema),
  })
  .strict();

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

function invalidEvidence(value: unknown, present: boolean): InvalidEvidence {
  if (!present) return { presence: "missing" };
  if (!isJsonValue(value)) throw new Error("Malformed persisted evidence is not JSON-safe");
  return { presence: "present", value };
}

function hasOwn(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function migratePlayCount(game: z.output<typeof VersionOneGameSchema>) {
  const present = hasOwn(game, "numPlays");
  const value = game.numPlays;
  if (!present) {
    return {
      compatibility: null,
      evidence: {
        status: "invalid" as const,
        evidence: invalidEvidence(undefined, false),
        source: "legacy-unknown" as const,
        observedAt: null,
      },
    };
  }
  if (value === null) {
    return {
      compatibility: null,
      evidence: { status: "missing" as const, source: "legacy-unknown" as const, observedAt: null },
    };
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return {
      compatibility: value,
      evidence: {
        status: "valid" as const,
        value,
        source: "legacy-unknown" as const,
        observedAt: null,
      },
    };
  }
  return {
    compatibility: null,
    evidence: {
      status: "invalid" as const,
      evidence: invalidEvidence(value, true),
      source: "legacy-unknown" as const,
      observedAt: null,
    },
  };
}

function migrateDuration(game: z.output<typeof VersionOneGameSchema>) {
  const present = hasOwn(game, "playingTime");
  const value = game.playingTime;
  if (!present) {
    return {
      compatibility: null,
      evidence: {
        status: "invalid" as const,
        evidence: invalidEvidence(undefined, false),
        source: "legacy-unknown" as const,
        observedAt: null,
      },
    };
  }
  if (value === null) {
    return {
      compatibility: null,
      evidence: { status: "missing" as const, source: "legacy-unknown" as const, observedAt: null },
    };
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return {
      compatibility: value,
      evidence: {
        status: "valid" as const,
        value,
        source: "legacy-unknown" as const,
        observedAt: null,
      },
    };
  }
  return {
    compatibility: null,
    evidence: {
      status: "invalid" as const,
      evidence: invalidEvidence(value, true),
      source: "legacy-unknown" as const,
      observedAt: null,
    },
  };
}

function migratePlayerRange(game: z.output<typeof VersionOneGameSchema>) {
  const minPresent = hasOwn(game, "minPlayers");
  const maxPresent = hasOwn(game, "maxPlayers");
  const min = game.minPlayers;
  const max = game.maxPlayers;
  if (minPresent && maxPresent && min === null && max === null) {
    return {
      minPlayers: null,
      maxPlayers: null,
      evidence: { status: "missing" as const, source: "legacy-unknown" as const, observedAt: null },
    };
  }
  if (
    minPresent &&
    maxPresent &&
    typeof min === "number" &&
    Number.isSafeInteger(min) &&
    min > 0 &&
    typeof max === "number" &&
    Number.isSafeInteger(max) &&
    max > 0 &&
    min <= max
  ) {
    return {
      minPlayers: min,
      maxPlayers: max,
      evidence: {
        status: "valid" as const,
        value: { minPlayers: min, maxPlayers: max },
        source: "legacy-unknown" as const,
        observedAt: null,
      },
    };
  }
  return {
    minPlayers: null,
    maxPlayers: null,
    evidence: {
      status: "invalid" as const,
      evidence: {
        minPlayers: invalidEvidence(min, minPresent),
        maxPlayers: invalidEvidence(max, maxPresent),
      },
      source: "legacy-unknown" as const,
      observedAt: null,
    },
  };
}

function isSuggestedPlayerBucket(value: unknown): value is {
  playerCount: string;
  best: number;
  recommended: number;
  notRecommended: number;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (
    !("playerCount" in value) ||
    !("best" in value) ||
    !("recommended" in value) ||
    !("notRecommended" in value)
  ) {
    return false;
  }
  return (
    typeof value.playerCount === "string" &&
    typeof value.best === "number" &&
    Number.isSafeInteger(value.best) &&
    value.best >= 0 &&
    typeof value.recommended === "number" &&
    Number.isSafeInteger(value.recommended) &&
    value.recommended >= 0 &&
    typeof value.notRecommended === "number" &&
    Number.isSafeInteger(value.notRecommended) &&
    value.notRecommended >= 0 &&
    Object.keys(value).every((key) =>
      ["playerCount", "best", "recommended", "notRecommended"].includes(key),
    )
  );
}

function emptySuggestedPlayerBuckets(): [] {
  return [];
}

function migrateSuggestedPlayerPoll(game: z.output<typeof VersionOneGameSchema>) {
  if (game.bggData === null) {
    return {
      bggData: null,
      poll: {
        status: "valid" as const,
        state: "absent" as const,
        buckets: [],
        source: "legacy-unknown" as const,
        observedAt: null,
      },
    };
  }
  const { suggestedPlayerCounts, ...bggData } = game.bggData;
  const present = hasOwn(game.bggData, "suggestedPlayerCounts");
  if (!present || !Array.isArray(suggestedPlayerCounts)) {
    return {
      bggData: { ...bggData, bestPlayerCount: validBestPlayerCount(bggData.bestPlayerCount) },
      poll: {
        status: "invalid" as const,
        state: "unusable" as const,
        buckets: emptySuggestedPlayerBuckets(),
        evidence: invalidEvidence(suggestedPlayerCounts, present),
        source: "legacy-unknown" as const,
        observedAt: null,
      },
    };
  }
  if (!suggestedPlayerCounts.every(isSuggestedPlayerBucket)) {
    return {
      bggData: { ...bggData, bestPlayerCount: validBestPlayerCount(bggData.bestPlayerCount) },
      poll: {
        status: "invalid" as const,
        state: "unusable" as const,
        buckets: emptySuggestedPlayerBuckets(),
        evidence: invalidEvidence(suggestedPlayerCounts, true),
        source: "legacy-unknown" as const,
        observedAt: null,
      },
    };
  }
  const [firstBucket, ...remainingBuckets] = suggestedPlayerCounts;
  if (firstBucket === undefined) {
    return {
      bggData: { ...bggData, bestPlayerCount: validBestPlayerCount(bggData.bestPlayerCount) },
      poll: {
        status: "valid" as const,
        state: "legacy-unknown" as const,
        buckets: emptySuggestedPlayerBuckets(),
        source: "legacy-unknown" as const,
        observedAt: null,
      },
    };
  }
  const buckets: [typeof firstBucket, ...typeof remainingBuckets] = [
    firstBucket,
    ...remainingBuckets,
  ];
  const usable = isUsableSuggestedPlayerPoll(buckets);
  return {
    bggData: { ...bggData, bestPlayerCount: validBestPlayerCount(bggData.bestPlayerCount) },
    poll: {
      status: "valid" as const,
      state: usable ? ("usable" as const) : ("unusable" as const),
      buckets,
      source: "legacy-unknown" as const,
      observedAt: null,
    },
  };
}

function migrateVersionTwoToThree(raw: unknown): CollectionMigrationStepResult {
  const historical = VersionTwoCollectionSchema.parse(raw);
  return {
    data: {
      ...historical,
      schemaVersion: 3,
      entertainmentBenchmark: null,
      games: historical.games.map((game) => {
        const playCount = migratePlayCount(game);
        const duration = migrateDuration(game);
        const range = migratePlayerRange(game);
        const poll = migrateSuggestedPlayerPoll(game);
        const bestPlayersValid = validBestPlayerCount(game.bestPlayers);
        const bestPlayersPresent = hasOwn(game, "bestPlayers");
        const bestPlayersCompatibility = bestPlayersPresent
          ? bestPlayersValid
          : validBestPlayerCount(game.bggData?.bestPlayerCount);
        const bestPlayersInvalidEvidence =
          bestPlayersValid !== null || (bestPlayersPresent && game.bestPlayers === null)
            ? null
            : invalidEvidence(game.bestPlayers, bestPlayersPresent);
        return {
          ...game,
          minPlayers: range.minPlayers,
          maxPlayers: range.maxPlayers,
          bestPlayers: bestPlayersCompatibility,
          playingTime: duration.compatibility,
          bggData: poll.bggData,
          numPlays: playCount.compatibility,
          acquisition: { state: "unknown" as const },
          playCountEvidence: playCount.evidence,
          durationEvidence: duration.evidence,
          playerRangeEvidence: range.evidence,
          suggestedPlayerPoll: poll.poll,
          bestPlayersInvalidEvidence,
        };
      }),
    },
    convertedAxisCount: 0,
    disabledAxisCount: 0,
  };
}

export const COLLECTION_MIGRATION_STEPS: readonly CollectionMigrationStep[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: migrateVersionZeroToOne,
  },
  {
    fromVersion: 1,
    toVersion: 2,
    migrate: migrateVersionOneToTwo,
  },
  {
    fromVersion: 2,
    toVersion: 3,
    migrate: migrateVersionTwoToThree,
  },
];

function readSchemaVersion(raw: unknown): number {
  if (typeof raw !== "object" || raw === null || !("schemaVersion" in raw)) return 0;
  const version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new Error(`Invalid collection schema version: ${String(version)}`);
  }
  return version;
}

export function migrateCollection(
  raw: unknown,
  dependencies: CollectionMigrationDependencies = defaultDependencies,
): CollectionMigrationResult {
  const sourceVersion = readSchemaVersion(raw);
  if (sourceVersion > CURRENT_COLLECTION_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported collection schema version ${sourceVersion}; current version is ${CURRENT_COLLECTION_SCHEMA_VERSION}`,
    );
  }

  let version = sourceVersion;
  let working: unknown = raw;
  let convertedAxisCount = 0;
  let disabledAxisCount = 0;
  while (version < CURRENT_COLLECTION_SCHEMA_VERSION) {
    const step = COLLECTION_MIGRATION_STEPS.find(({ fromVersion }) => fromVersion === version);
    if (step === undefined || step.toVersion <= version) {
      throw new Error(
        `No collection migration step from version ${version} to ${CURRENT_COLLECTION_SCHEMA_VERSION}`,
      );
    }
    const result = step.migrate(working, dependencies);
    working = result.data;
    convertedAxisCount += result.convertedAxisCount;
    disabledAxisCount += result.disabledAxisCount;
    version = step.toVersion;
  }

  const data = CollectionSchema.parse(working);
  return {
    data,
    migrated: sourceVersion !== CURRENT_COLLECTION_SCHEMA_VERSION,
    sourceVersion,
    convertedAxisCount,
    disabledAxisCount,
  };
}
