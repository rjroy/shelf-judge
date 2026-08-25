import {
  CURRENT_COLLECTION_SCHEMA_VERSION,
  CollectionSchema,
  GameSchema,
  type Axis,
  type AxisBase,
  type Collection,
  type Game,
  type DisabledLegacyAxis,
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

const HistoricalGameSchema = GameSchema.omit({
  ownership: true,
  boxDimensions: true,
  manualShelfId: true,
})
  .extend({
    ownership: z.enum(["owned", "previously-owned"]).optional(),
    boxDimensions: z
      .object({
        width: z.number().positive(),
        height: z.number().positive(),
        depth: z.number().positive(),
      })
      .strict()
      .nullable()
      .optional(),
    manualShelfId: z.string().nullable().optional(),
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

function backfillGame(game: z.output<typeof HistoricalGameSchema>): Game {
  return GameSchema.parse({
    ...game,
    ownership: game.ownership ?? "owned",
    boxDimensions: game.boxDimensions ?? null,
    manualShelfId: game.manualShelfId ?? null,
  });
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
      games: historical.games.map(backfillGame),
      createdAt: historical.createdAt,
      updatedAt: dependencies.now(),
    },
    convertedAxisCount,
    disabledAxisCount,
  };
}

export const COLLECTION_MIGRATION_STEPS: readonly CollectionMigrationStep[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: migrateVersionZeroToOne,
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
