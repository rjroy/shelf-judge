import { z } from "zod";
import { getPreferenceCurveInvalidFields } from "./curve-math";
import {
  DerivedAxisPayloadSchema,
  DERIVED_AXIS_REGISTRY,
  createDerivedAxisFromPayload,
  validateDerivedAxisPayload,
  type DerivedAxisPayloadValidationResult,
} from "./derived-axis-registry";
import {
  AXIS_VALIDATION_CODES,
  CodedAxisValidationError,
  type AxisValidationCode,
  type AxisValidationDetail,
} from "./errors";
import type {
  Axis,
  AxisBase,
  DerivedAxis,
  DisabledLegacyAxis,
  EnabledAxis,
  NativeScale,
  ToleranceLevel,
} from "./types";

export const CURRENT_COLLECTION_SCHEMA_VERSION = 2 as const;

const VetoConfigSchema = z.object({
  direction: z.enum(["below", "above"]),
  threshold: z.number(),
});

const StrictVetoConfigSchema = VetoConfigSchema.strict();

const curveFields = {
  preferenceShape: z.enum(["higher-is-better", "lower-is-better", "sweet-spot"]).optional(),
  idealValue: z.number().nullable().optional(),
  tolerance: z.enum(["flexible", "moderate", "strict"]).optional(),
  leanDirection: z.enum(["lower", "higher"]).nullable().optional(),
  veto: VetoConfigSchema.nullable().optional(),
};

const currentCurveFields = {
  ...curveFields,
  toleranceWidth: z.number().nullable().optional(),
  veto: StrictVetoConfigSchema.nullable().optional(),
};

const currentCommonFields = {
  name: z.string().min(1, "Axis name cannot be empty"),
  description: z.string().nullable().optional().default(null),
  weight: z.number().int("Weight must be an integer").min(0).max(100),
  ...currentCurveFields,
};

const currentCommonUpdateFields = {
  name: z.string().min(1, "Axis name cannot be empty").optional(),
  description: z.string().nullable().optional(),
  weight: z.number().int("Weight must be an integer").min(0).max(100).optional(),
  ...currentCurveFields,
  tolerance: z.enum(["flexible", "moderate", "strict"]).nullable().optional(),
};

const PersonalCreateAxisSchema = z
  .object({
    ...currentCommonFields,
    source: z.literal("personal").optional().default("personal"),
  })
  .strict();

const DerivedCreateAxisSchema = z
  .object({
    ...currentCommonFields,
    source: z.literal("derived"),
    derivedField: z.string(),
    configuration: z.unknown(),
  })
  .strict()
  .superRefine((value, context) => {
    const result = validateDerivedAxisPayload(derivedPayloadFrom(value));
    if (!result.success) addDerivedConfigurationIssues(value, context);
  })
  .transform((value) => ({
    ...value,
    ...DerivedAxisPayloadSchema.parse(derivedPayloadFrom(value)),
  }));

export const CreateAxisSchema = z
  .union([PersonalCreateAxisSchema, DerivedCreateAxisSchema])
  .superRefine((value, context) => {
    const scale = getCreateNativeScale(value);
    if (scale !== null) addCurveIssues(value, scale, context);
  });

export const UpdateAxisSchema = z
  .object({
    ...currentCommonUpdateFields,
    configuration: z.unknown().optional(),
  })
  .strict();

export const LegacyAxisRepairSchema = z
  .object({
    ...currentCommonUpdateFields,
    derivedField: z.string(),
    configuration: z.unknown(),
  })
  .strict()
  .superRefine((value, context) => {
    const result = validateDerivedAxisPayload(derivedPayloadFrom(value));
    if (!result.success) addDerivedConfigurationIssues(value, context);
  })
  .transform((value) => ({
    ...value,
    ...DerivedAxisPayloadSchema.parse(derivedPayloadFrom(value)),
  }));

type ValidationContext = z.RefinementCtx;
type CurveInput = {
  preferenceShape?: "higher-is-better" | "lower-is-better" | "sweet-spot";
  idealValue?: number | null;
  tolerance?: "flexible" | "moderate" | "strict";
  toleranceWidth?: number | null;
  veto?: { direction: "below" | "above"; threshold: number } | null;
};

function addCodedIssue(
  context: ValidationContext,
  code: AxisValidationCode,
  detail: AxisValidationDetail,
  message: string,
): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: [...detail.path],
    message,
    params: { axisValidationCode: code, field: detail.field },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function derivedPayloadFrom(value: Record<string, unknown>): Record<string, unknown> {
  return {
    derivedField: value.derivedField,
    ...(Object.hasOwn(value, "configuration") ? { configuration: value.configuration } : {}),
  };
}

function addDerivedConfigurationIssues(
  value: Record<string, unknown>,
  context: ValidationContext,
): void {
  const result = validateDerivedAxisPayload(derivedPayloadFrom(value));
  if (!result.success) addCodedIssue(context, result.code, result.detail, result.message);
}

function getCreateNativeScale(
  value: z.output<typeof PersonalCreateAxisSchema> | Record<string, unknown>,
): NativeScale | null {
  if (value.source === "personal") return { min: 1, max: 10 };
  const result = validateDerivedAxisPayload(derivedPayloadFrom(value));
  if (!result.success) return null;
  return DERIVED_AXIS_REGISTRY[result.data.derivedField].nativeScaleFromUnknown(
    result.data.configuration,
  );
}

function curveInvalidFields(curve: CurveInput, scale: NativeScale): string[] {
  const shape = curve.preferenceShape ?? "higher-is-better";
  const invalid = new Set(getPreferenceCurveInvalidFields(scale, shape, curve));
  if (
    curve.veto != null &&
    (curve.veto.threshold < scale.min || curve.veto.threshold > scale.max)
  ) {
    invalid.add("veto");
  }
  return [...invalid];
}

function addCurveIssues(curve: CurveInput, scale: NativeScale, context: ValidationContext): void {
  for (const field of curveInvalidFields(curve, scale)) {
    addCodedIssue(
      context,
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      { field, path: [field] },
      `${field} is invalid for native scale ${scale.min}..${scale.max}`,
    );
  }
}

function codedIssueDetails(error: z.ZodError): {
  code: AxisValidationCode;
  details: AxisValidationDetail[];
} | null {
  const coded = error.issues.flatMap((issue) => {
    if (issue.code !== z.ZodIssueCode.custom) return [];
    const params: unknown = issue.params;
    if (!isObject(params)) return [];
    const code = params.axisValidationCode;
    const field = params.field;
    if (!isAxisValidationCode(code) || typeof field !== "string") return [];
    return [{ code, detail: { field, path: issue.path } }];
  });
  const first = coded[0];
  if (first === undefined) return null;
  return {
    code: first.code,
    details: coded.filter(({ code }) => code === first.code).map(({ detail }) => detail),
  };
}

function isAxisValidationCode(value: unknown): value is AxisValidationCode {
  return Object.values(AXIS_VALIDATION_CODES).some((candidate) => candidate === value);
}

function throwCodedSchemaError(error: z.ZodError): never {
  const coded = codedIssueDetails(error);
  if (coded !== null) {
    throw new CodedAxisValidationError(error.message, coded.code, coded.details);
  }
  const details = error.issues.map((issue) => ({
    field: String(issue.path.at(-1) ?? "payload"),
    path: issue.path,
  }));
  throw new CodedAxisValidationError(
    error.message,
    AXIS_VALIDATION_CODES.INVALID_AXIS_PAYLOAD,
    details,
  );
}

export function parseCreateAxisInput(input: unknown): CreateAxisOutput {
  if (isObject(input) && input.source === "derived") {
    const payload = requireValidDerivedPayload(derivedPayloadFrom(input));
    const curve = z.object(currentCurveFields).passthrough().safeParse(input);
    if (curve.success) {
      const scale = DERIVED_AXIS_REGISTRY[payload.derivedField].nativeScaleFromUnknown(
        payload.configuration,
      );
      throwIfInvalidCurve(curve.data, scale);
    }
  }
  const result = CreateAxisSchema.safeParse(input);
  if (!result.success) throwCodedSchemaError(result.error);
  return result.data;
}

export function parseUpdateAxisInput(input: unknown): UpdateAxisOutput {
  const result = UpdateAxisSchema.safeParse(input);
  if (!result.success) throwCodedSchemaError(result.error);
  return result.data;
}

export function parseLegacyAxisRepairInput(input: unknown): LegacyAxisRepairOutput {
  if (isObject(input)) requireValidDerivedPayload(derivedPayloadFrom(input));
  const result = LegacyAxisRepairSchema.safeParse(input);
  if (!result.success) throwCodedSchemaError(result.error);
  return result.data;
}

function requireValidDerivedPayload(value: unknown) {
  const result = validateDerivedAxisPayload(value);
  if (result.success) return result.data;
  throwDerivedPayloadFailure(result);
}

function throwDerivedPayloadFailure(
  result: Extract<DerivedAxisPayloadValidationResult, { success: false }>,
): never {
  throw new CodedAxisValidationError(result.message, result.code, [result.detail]);
}

function throwIfInvalidCurve(curve: CurveInput, scale: NativeScale): void {
  const invalidFields = curveInvalidFields(curve, scale);
  if (invalidFields.length === 0) return;
  throw new CodedAxisValidationError(
    `Axis curve is invalid for native scale ${scale.min}..${scale.max}`,
    AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
    invalidFields.map((field) => ({ field, path: [field] })),
  );
}

type NormalizedAxisUpdate = Omit<UpdateAxisOutput, "tolerance"> & {
  tolerance?: ToleranceLevel;
};

function normalizeAxisUpdate(update: UpdateAxisOutput): NormalizedAxisUpdate {
  const { tolerance, ...rest } = update;
  if (tolerance === null) return { ...rest, tolerance: undefined };
  return tolerance === undefined ? rest : { ...rest, tolerance };
}

function validateEnabledAxis(axis: EnabledAxis): void {
  let scale: NativeScale = { min: 1, max: 10 };
  if (axis.source === "derived") {
    const payload = { derivedField: axis.derivedField, configuration: axis.configuration };
    const parsed = requireValidDerivedPayload(payload);
    scale = DERIVED_AXIS_REGISTRY[parsed.derivedField].nativeScaleFromUnknown(parsed.configuration);
  }
  const invalidFields = curveInvalidFields(axis, scale);
  if (invalidFields.length > 0) {
    throw new CodedAxisValidationError(
      `Axis curve is invalid for native scale ${scale.min}..${scale.max}`,
      AXIS_VALIDATION_CODES.INVALID_CURVE_FOR_NATIVE_SCALE,
      invalidFields.map((field) => ({ field, path: [field] })),
    );
  }
}

export function validateAxisForNativeScale(axis: Axis): Axis {
  if (axis.enabled) validateEnabledAxis(axis);
  return axis;
}

export function mergeAndValidateAxisUpdate(axis: Axis, update: UpdateAxisOutput): Axis {
  const normalizedUpdate = normalizeAxisUpdate(update);
  if (!axis.enabled) {
    if (update.configuration !== undefined) {
      throw new CodedAxisValidationError(
        "Disabled legacy axes require the explicit repair operation",
        AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR,
        [{ field: "configuration", path: ["configuration"] }],
      );
    }
    return { ...axis, ...normalizedUpdate };
  }
  if (axis.source !== "derived" && update.configuration !== undefined) {
    throw new CodedAxisValidationError(
      "Only derived axes accept configuration",
      AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
      [{ field: "configuration", path: ["configuration"] }],
    );
  }
  if (axis.source === "derived") {
    const configuration = update.configuration ?? axis.configuration;
    const result = validateDerivedAxisPayload({
      derivedField: axis.derivedField,
      configuration,
    });
    if (!result.success) throwDerivedPayloadFailure(result);
    const merged = createDerivedAxisFromPayload({ ...axis, ...normalizedUpdate }, result.data);
    validateEnabledAxis(merged);
    return merged;
  }
  const merged = { ...axis, ...normalizedUpdate };
  validateEnabledAxis(merged);
  return merged;
}

export function repairAndValidateLegacyAxis(
  axis: DisabledLegacyAxis,
  repair: LegacyAxisRepairOutput,
): DerivedAxis {
  const result = validateDerivedAxisPayload(derivedPayloadFrom(repair));
  if (!result.success) {
    throw new CodedAxisValidationError(
      "Legacy axis repair has invalid derived configuration",
      AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR,
      [result.detail],
    );
  }
  const repairedBase: AxisBase = {
    id: axis.id,
    name: repair.name ?? axis.name,
    description: repair.description === undefined ? axis.description : repair.description,
    weight: repair.weight ?? axis.weight,
    enabled: true,
    preferenceShape: repair.preferenceShape ?? axis.preferenceShape,
    idealValue: repair.idealValue === undefined ? axis.idealValue : repair.idealValue,
    tolerance: repair.tolerance === null ? undefined : (repair.tolerance ?? axis.tolerance),
    toleranceWidth:
      repair.toleranceWidth === undefined ? axis.toleranceWidth : repair.toleranceWidth,
    leanDirection: repair.leanDirection === undefined ? axis.leanDirection : repair.leanDirection,
    veto: repair.veto === undefined ? axis.veto : repair.veto,
    createdAt: axis.createdAt,
    updatedAt: axis.updatedAt,
  };
  const repaired = createDerivedAxisFromPayload(repairedBase, result.data);
  try {
    validateEnabledAxis(repaired);
  } catch (error) {
    if (error instanceof CodedAxisValidationError) {
      throw new CodedAxisValidationError(
        "Legacy axis repair cannot produce a valid derived axis",
        AXIS_VALIDATION_CODES.INVALID_LEGACY_AXIS_REPAIR,
        error.details,
      );
    }
    throw error;
  }
  return repaired;
}

const AxisBaseSchemaFields = {
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  weight: z.number().int().min(0).max(100),
  enabled: z.literal(true),
  preferenceShape: z.enum(["higher-is-better", "lower-is-better", "sweet-spot"]).optional(),
  idealValue: z.number().nullable().optional(),
  tolerance: z.enum(["flexible", "moderate", "strict"]).optional(),
  toleranceWidth: z.number().nullable().optional(),
  leanDirection: z.enum(["lower", "higher"]).nullable().optional(),
  veto: StrictVetoConfigSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const PersonalAxisSchema = z
  .object({ ...AxisBaseSchemaFields, source: z.literal("personal") })
  .strict();
const TournamentAxisSchema = z
  .object({ ...AxisBaseSchemaFields, source: z.literal("tournament") })
  .strict();
const DerivedAxisSchema = z
  .object({
    ...AxisBaseSchemaFields,
    source: z.literal("derived"),
    derivedField: z.string(),
    configuration: z.unknown(),
  })
  .strict()
  .superRefine((value, context) => {
    const result = validateDerivedAxisPayload(derivedPayloadFrom(value));
    if (!result.success) addDerivedConfigurationIssues(value, context);
  })
  .transform((value) => ({
    ...value,
    ...DerivedAxisPayloadSchema.parse(derivedPayloadFrom(value)),
  }));
const DisabledLegacyAxisSchema = z
  .object({
    ...AxisBaseSchemaFields,
    enabled: z.literal(false),
    source: z.literal("legacy"),
    reason: z.string().min(1),
    legacyField: z.string().nullable(),
    legacyPayload: z.unknown(),
  })
  .strict()
  .refine((value) => Object.hasOwn(value, "legacyPayload"), {
    message: "legacyPayload is required",
    path: ["legacyPayload"],
  })
  .transform((value) => ({ ...value, legacyPayload: value.legacyPayload }));

// Persisted collections validate structure and source/configuration correlation only.
// Curve/native-scale semantics belong to create, update, and repair mutation boundaries;
// historical values must remain loadable so migration can preserve scoring behavior.
export const AxisSchema = z.union([
  PersonalAxisSchema,
  TournamentAxisSchema,
  DerivedAxisSchema,
  DisabledLegacyAxisSchema,
]);

const BggTagSchema = z.object({ id: z.number().int(), name: z.string() }).strict();
const SuggestedPlayerCountSchema = z
  .object({
    playerCount: z.string(),
    best: z.number().int().min(0),
    recommended: z.number().int().min(0),
    notRecommended: z.number().int().min(0),
  })
  .strict();
export const BggGameDataSchema = z
  .object({
    communityRating: z.number(),
    bayesAverage: z.number(),
    weight: z.number().nullable(),
    numWeightVotes: z.number().int().min(0),
    description: z.string().nullable(),
    mechanics: z.array(BggTagSchema),
    categories: z.array(BggTagSchema),
    families: z.array(BggTagSchema),
    subdomains: z.array(BggTagSchema),
    suggestedPlayerCounts: z.array(SuggestedPlayerCountSchema),
    bestPlayerCount: z.number().nullable().optional().default(null),
    fetchedAt: z.string(),
  })
  .strict();
const BoxDimensionsSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    depth: z.number().positive(),
  })
  .strict();

export const GameSchema = z
  .object({
    id: z.string().min(1),
    bggId: z.number().int().nullable(),
    name: z.string().min(1),
    yearPublished: z.number().int().nullable(),
    minPlayers: z.number().int().nullable(),
    maxPlayers: z.number().int().nullable(),
    bestPlayers: z.number().nullable().optional().default(null),
    playingTime: z.number().int().nullable(),
    imageUrl: z.string().nullable(),
    bggData: BggGameDataSchema.nullable(),
    numPlays: z.number().int().min(0).nullable(),
    ownership: z.enum(["owned", "previously-owned"]),
    boxDimensions: BoxDimensionsSchema.nullable(),
    manualShelfId: z.string().nullable(),
    ratings: z.record(z.number().int().min(1).max(10)),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const CollectionSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_COLLECTION_SCHEMA_VERSION),
    id: z.string().min(1),
    name: z.string().min(1),
    axes: z.array(AxisSchema),
    games: z.array(GameSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const RateGameSchema = z.object({
  axisId: z.string().min(1),
  rating: z.number().int("Rating must be an integer").min(1).max(10),
});

const AddGameBaseFields = {
  yearPublished: z.number().int().nullable().optional().default(null),
  minPlayers: z.number().int().min(1).nullable().optional().default(null),
  maxPlayers: z.number().int().min(1).nullable().optional().default(null),
  bestPlayers: z.number().int().min(1).nullable().optional().default(null),
  playingTime: z.number().int().min(0).nullable().optional().default(null),
  imageUrl: z.string().url().nullable().optional().default(null),
  numPlays: z.number().int().min(0).nullable().optional().default(null),
};

// Union: { bggId: number } | { name: string, yearPublished?: number }
// Both can coexist, but at least one of bggId or name must be present.
export const AddGameSchema = z
  .object({
    name: z.string().min(1, "Game name cannot be empty").optional(),
    bggId: z.number().int().nullable().optional().default(null),
    ...AddGameBaseFields,
  })
  .refine(
    (data) =>
      (data.name !== undefined && data.name.length > 0) ||
      (data.bggId !== null && data.bggId !== undefined),
    { message: "Either name or bggId must be provided" },
  );

// Tournament schemas

export const SessionFilterSchema = z.object({
  type: z.enum(["name", "minFitness", "maxFitness", "bggTag", "staleness"]),
  value: z.string().min(1, "Filter value cannot be empty"),
});

export const StartSessionSchema = z.object({
  filters: z.array(SessionFilterSchema).nullable().optional().default(null),
});

export const SubmitComparisonSchema = z
  .object({
    gameAId: z.string().min(1, "gameAId is required"),
    gameBId: z.string().min(1, "gameBId is required"),
    winnerId: z.string().min(1, "winnerId is required"),
  })
  .refine((data) => data.winnerId === data.gameAId || data.winnerId === data.gameBId, {
    message: "winnerId must equal gameAId or gameBId",
    path: ["winnerId"],
  });

export const TournamentSettingsUpdateSchema = z
  .object({
    kFactorThreshold: z.number().optional(),
    normalizationHalfWidth: z.number().optional(),
    provisionalThreshold: z.number().optional(),
  })
  .strict();

// Storage format schemas (used by loadTournament for validation and migration)

export const TournamentSettingsSchema = z.object({
  kFactorThreshold: z.number(),
  normalizationHalfWidth: z.number(),
  provisionalThreshold: z.number(),
});

const CachedRecentComparisonSchema = z.object({
  opponentGameId: z.string(),
  won: z.boolean(),
  createdAt: z.string(),
});

const ComparisonSchema = z.object({
  id: z.string(),
  gameAId: z.string(),
  gameBId: z.string(),
  winnerId: z.string(),
  sessionId: z.string(),
  createdAt: z.string(),
});

const TournamentGameStatsSchema = z.object({
  eloRating: z.number(),
  comparisonCount: z.number(),
  wins: z.number().optional().default(0),
  losses: z.number().optional().default(0),
  recentComparisons: z.array(CachedRecentComparisonSchema).optional().default([]),
});

const TournamentSessionSchema = z.object({
  id: z.string(),
  filters: z.array(SessionFilterSchema).nullable(),
  gameIds: z.array(z.string()),
  comparisonCount: z.number(),
  status: z.enum(["active", "completed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  comparisons: z.array(ComparisonSchema).optional().default([]),
});

export const TournamentDataSchema = z.object({
  settings: TournamentSettingsSchema,
  sessions: z.array(TournamentSessionSchema),
  comparisons: z.array(ComparisonSchema).optional(), // pre-migration only
  gameStats: z.record(TournamentGameStatsSchema),
});

// Shelf configuration schemas (used by loadShelfConfig for validation)

const ShelfSchema = z.object({
  id: z.string(),
  name: z.string(),
  dimensionless: z.boolean().default(false), // legacy shelves without the field default to measured
  width: z.number().positive().nullable(),
  height: z.number().positive().nullable(),
  depth: z.number().positive().nullable(),
});

const ShelfUnitSchema = z.object({
  id: z.string(),
  name: z.string(),
  shelves: z.array(ShelfSchema),
});

export const ShelfConfigurationSchema = z.object({
  units: z.array(ShelfUnitSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateAxisInput = z.input<typeof CreateAxisSchema>;
export type CreateAxisOutput = z.output<typeof CreateAxisSchema>;
export type UpdateAxisInput = z.input<typeof UpdateAxisSchema>;
export type UpdateAxisOutput = z.output<typeof UpdateAxisSchema>;
export type LegacyAxisRepairInput = z.input<typeof LegacyAxisRepairSchema>;
export type LegacyAxisRepairOutput = z.output<typeof LegacyAxisRepairSchema>;
export type RateGameInput = z.input<typeof RateGameSchema>;
export type AddGameInput = z.input<typeof AddGameSchema>;
export type SessionFilterInput = z.input<typeof SessionFilterSchema>;
export type StartSessionInput = z.input<typeof StartSessionSchema>;
export type SubmitComparisonInput = z.input<typeof SubmitComparisonSchema>;
export type TournamentSettingsUpdateInput = z.input<typeof TournamentSettingsUpdateSchema>;
