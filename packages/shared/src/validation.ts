import { z } from "zod";
import { parseAmountInput } from "./amount";
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
  DerivedFieldId,
  DisabledLegacyAxis,
  EnabledAxis,
  NativeScale,
  ToleranceLevel,
  JsonValue,
} from "./types";

import {
  CollectionProfileEntityClassSchema,
  BggEntityLinkSchema,
  EntityClassMetadataSchema,
  EntityMetadataByClassSchema,
  LatestPlayCountCheckSchema,
  PlayIntentionBaselineSchema,
  PlayIntentionResolutionSchema,
  PlayIntentionSchema,
  IntentionCommandSchema,
  AcceptedIntentionMutationSchema,
  IntentionMutationResultSchema,
  intentionMutationResultMatchesCommand,
  IntentionMutationErrorSchema,
  IntentionCommandReceiptSchema,
  CollectionProfileSourceRecordsSchema,
  CollectionProfileEntityClassResultSchema,
  CollectionProfileAttentionItemSchema,
  ResolvedPlayIntentionHistoryItemSchema,
  ResolvedPlayIntentionHistorySchema,
  GameIntentionDetailSchema,
  CollectionProfileResultSchema,
} from "./collection-profile-validation";

export {
  CollectionProfileEntityClassSchema,
  BggEntityLinkSchema,
  EntityClassMetadataSchema,
  EntityMetadataByClassSchema,
  LatestPlayCountCheckSchema,
  PlayIntentionBaselineSchema,
  PlayIntentionResolutionSchema,
  PlayIntentionSchema,
  IntentionCommandSchema,
  AcceptedIntentionMutationSchema,
  IntentionMutationResultSchema,
  intentionMutationResultMatchesCommand,
  IntentionMutationErrorSchema,
  IntentionCommandReceiptSchema,
  CollectionProfileEntityClassResultSchema,
  CollectionProfileAttentionItemSchema,
  ResolvedPlayIntentionHistoryItemSchema,
  ResolvedPlayIntentionHistorySchema,
  GameIntentionDetailSchema,
  CollectionProfileResultSchema,
};

export const CURRENT_COLLECTION_SCHEMA_VERSION = 5 as const;
export const CURRENT_PROFILE_CONTRACT_VERSION = 7 as const;
export const CURRENT_PROFILE_ALGORITHM_VERSION = 9 as const;
const AmountInputSchema = z.string().superRefine((value, context) => {
  try {
    parseAmountInput(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Invalid amount",
    });
  }
});

export const AcquisitionMutationRequestSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unknown") }).strict(),
  z.object({ state: z.literal("gift") }).strict(),
  z.object({ state: z.literal("purchase"), amount: AmountInputSchema }).strict(),
]);

export const EntertainmentBenchmarkMutationRequestSchema = z
  .object({ amount: AmountInputSchema })
  .strict()
  .superRefine((value, context) => {
    let hundredths: number;
    try {
      hundredths = parseAmountInput(value.amount);
    } catch {
      return;
    }
    if (hundredths === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "Entertainment benchmark must be positive",
      });
    }
  });

export const ManualGameValuesMutationRequestSchema = z
  .object({
    playingTime: z.number().int().safe().positive().nullable().optional(),
    playerCount: z.number().int().safe().positive().nullable().optional(),
  })
  .strict()
  .refine((value) => value.playingTime !== undefined || value.playerCount !== undefined, {
    message: "At least one manual value must be provided",
  });

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
    best: z.number().int().safe().min(0),
    recommended: z.number().int().safe().min(0),
    notRecommended: z.number().int().safe().min(0),
  })
  .strict();
export function isUsableSuggestedPlayerPoll(
  buckets: readonly {
    playerCount: string;
    best: number;
  }[],
): boolean {
  return buckets.some((bucket) => {
    if (bucket.best <= 0 || !/^[1-9]\d*$/.test(bucket.playerCount)) return false;
    return Number.isSafeInteger(Number(bucket.playerCount));
  });
}
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);
export const InvalidEvidenceSchema = z.union([
  z.object({ presence: z.literal("missing") }).strict(),
  z.object({ presence: z.literal("present"), value: JsonValueSchema }).strict(),
]);
const EvidenceObservationSchemaFields = {
  source: z.enum([
    "manual",
    "bgg-collection",
    "bgg-thing",
    "bgg-suggested-player-poll",
    "bgg-player-range",
    "current-fitness",
    "legacy-unknown",
  ]),
  observedAt: z.string().nullable(),
};
function fieldEvidenceSchema<Value extends z.ZodTypeAny>(value: Value) {
  return z.union([
    z.object({ ...EvidenceObservationSchemaFields, status: z.literal("valid"), value }).strict(),
    z.object({ ...EvidenceObservationSchemaFields, status: z.literal("missing") }).strict(),
    z
      .object({
        ...EvidenceObservationSchemaFields,
        status: z.literal("invalid"),
        evidence: InvalidEvidenceSchema,
      })
      .strict(),
  ]);
}
export const PlayCountEvidenceSchema = fieldEvidenceSchema(z.number().int().safe().min(0));
export const DurationEvidenceSchema = fieldEvidenceSchema(z.number().int().safe().positive());
export const PlayerRangeEvidenceSchema = z.union([
  z
    .object({
      ...EvidenceObservationSchemaFields,
      status: z.literal("valid"),
      value: z
        .object({
          minPlayers: z.number().int().safe().positive(),
          maxPlayers: z.number().int().safe().positive(),
        })
        .strict(),
    })
    .strict()
    .refine(({ value }) => value.minPlayers <= value.maxPlayers, {
      message: "Minimum players cannot exceed maximum players",
      path: ["value", "maxPlayers"],
    }),
  z.object({ ...EvidenceObservationSchemaFields, status: z.literal("missing") }).strict(),
  z
    .object({
      ...EvidenceObservationSchemaFields,
      status: z.literal("invalid"),
      evidence: z
        .object({ minPlayers: InvalidEvidenceSchema, maxPlayers: InvalidEvidenceSchema })
        .strict(),
    })
    .strict(),
]);
export const SuggestedPlayerPollSchema = z.union([
  z
    .object({
      ...EvidenceObservationSchemaFields,
      status: z.literal("valid"),
      state: z.enum(["absent", "empty", "legacy-unknown"]),
      buckets: z.tuple([]),
    })
    .strict(),
  z
    .object({
      ...EvidenceObservationSchemaFields,
      status: z.literal("valid"),
      state: z.enum(["unusable", "usable"]),
      buckets: z.array(SuggestedPlayerCountSchema).nonempty(),
    })
    .strict()
    .superRefine(({ state, buckets }, context) => {
      const expectedState = isUsableSuggestedPlayerPoll(buckets) ? "usable" : "unusable";
      if (state !== expectedState) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["state"],
          message: `Suggested-player poll state must be ${expectedState}`,
        });
      }
    }),
  z
    .object({
      ...EvidenceObservationSchemaFields,
      status: z.literal("invalid"),
      state: z.literal("unusable"),
      buckets: z.tuple([]),
      evidence: InvalidEvidenceSchema,
    })
    .strict(),
]);
export const PersistedAmountSchema = z
  .object({
    hundredths: z.number().int().safe().min(0),
    source: z.literal("manual"),
    confirmedAt: z.string(),
  })
  .strict();
const PersistedManualValueSchema = z
  .object({
    value: z.number().int().safe().positive(),
    source: z.literal("manual"),
    confirmedAt: z.string(),
  })
  .strict();
const ManualGameValuesSchema = z
  .object({
    playingTime: PersistedManualValueSchema.nullable(),
    playerCount: PersistedManualValueSchema.nullable(),
  })
  .strict();
export const AcquisitionSchema = z.union([
  z.object({ state: z.literal("unknown") }).strict(),
  z.object({ state: z.literal("gift") }).strict(),
  z.object({ state: z.literal("purchase"), amount: PersistedAmountSchema }).strict(),
  z.object({ state: z.literal("invalid"), evidence: InvalidEvidenceSchema }).strict(),
]);
export const EntertainmentBenchmarkSchema = z
  .union([
    z.object({ state: z.literal("configured"), amount: PersistedAmountSchema }).strict(),
    z.object({ state: z.literal("invalid"), evidence: InvalidEvidenceSchema }).strict(),
  ])
  .nullable()
  .superRefine((benchmark, context) => {
    if (benchmark?.state === "configured" && benchmark.amount.hundredths === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount", "hundredths"],
        message: "Entertainment benchmark must be positive",
      });
    }
  });
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

export const CollectionGameV3Schema = z
  .object({
    id: z.string().min(1),
    bggId: z.number().int().nullable(),
    name: z.string().min(1),
    yearPublished: z.number().int().nullable(),
    minPlayers: z.number().int().safe().positive().nullable(),
    maxPlayers: z.number().int().safe().positive().nullable(),
    bestPlayers: z
      .number()
      .finite()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .optional()
      .default(null),
    playingTime: z.number().int().safe().positive().nullable(),
    imageUrl: z.string().nullable(),
    bggData: BggGameDataSchema.nullable(),
    numPlays: z.number().int().safe().min(0).nullable(),
    acquisition: AcquisitionSchema,
    playCountEvidence: PlayCountEvidenceSchema,
    durationEvidence: DurationEvidenceSchema,
    playerRangeEvidence: PlayerRangeEvidenceSchema,
    suggestedPlayerPoll: SuggestedPlayerPollSchema,
    bestPlayersInvalidEvidence: InvalidEvidenceSchema.nullable(),
    ownership: z.enum(["owned", "previously-owned"]),
    boxDimensions: BoxDimensionsSchema.nullable(),
    manualShelfId: z.string().nullable(),
    ratings: z.record(z.number().int().min(1).max(10)),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const CollectionSchemaV3 = z
  .object({
    schemaVersion: z.literal(3),
    id: z.string().min(1),
    name: z.string().min(1),
    axes: z.array(AxisSchema),
    games: z.array(CollectionGameV3Schema),
    entertainmentBenchmark: EntertainmentBenchmarkSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const CollectionGameV4Schema = CollectionGameV3Schema.extend({
  entityMetadata: EntityMetadataByClassSchema,
  latestPlayCountCheck: LatestPlayCountCheckSchema,
}).strict();

export const CollectionSchemaV4 = CollectionSchemaV3.omit({ schemaVersion: true, games: true })
  .extend({
    schemaVersion: z.literal(4),
    revision: z.number().int().safe().min(0),
    games: z.array(CollectionGameV4Schema),
    intentions: z.array(PlayIntentionSchema),
    commandReceipts: z.array(IntentionCommandReceiptSchema),
  })
  .strict();

export const GameSchema = CollectionGameV4Schema.extend({
  manualValues: ManualGameValuesSchema,
}).strict();

export const CollectionSchema = CollectionSchemaV3.omit({ schemaVersion: true, games: true })
  .extend({
    schemaVersion: z.literal(5),
    revision: z.number().int().safe().min(0),
    games: z.array(GameSchema),
    intentions: z.array(PlayIntentionSchema),
    commandReceipts: z.array(IntentionCommandReceiptSchema),
  })
  .strict()
  .superRefine((source, context) => {
    const records = CollectionProfileSourceRecordsSchema.safeParse({
      revision: source.revision,
      games: source.games.map(({ id, entityMetadata, latestPlayCountCheck }) => ({
        gameId: id,
        entityMetadata,
        latestPlayCountCheck,
      })),
      intentions: source.intentions,
      commandReceipts: source.commandReceipts,
    });
    if (!records.success) {
      for (const issue of records.error.issues) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path,
          message: issue.message,
        });
      }
    }
    const gamesById = new Map(source.games.map((game) => [game.id, game]));
    for (const [index, game] of source.games.entries()) {
      const metadata = Object.values(game.entityMetadata);
      if (game.bggId !== null && (!Number.isSafeInteger(game.bggId) || game.bggId <= 0)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["games", index, "bggId"],
          message: "Future BGG IDs must be positive safe integers",
        });
      }
      if (
        (game.bggId === null && metadata.some(({ state }) => state !== "unrefreshable")) ||
        (game.bggId !== null && metadata.some(({ state }) => state === "unrefreshable"))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["games", index, "entityMetadata"],
          message: "Entity metadata refreshability must match BGG identity",
        });
      }
      if (new Set(metadata.map(({ state }) => state)).size !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["games", index, "entityMetadata"],
          message: "One BGG thing response must update all entity classes atomically",
        });
      }
      const complete = metadata.filter(({ state }) => state === "complete");
      if (
        (complete.length > 0 && new Set(complete.map(({ observedAt }) => observedAt)).size !== 1) ||
        new Set(metadata.map(({ refreshFailure }) => JSON.stringify(refreshFailure))).size !== 1
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["games", index, "entityMetadata"],
          message: "Complete entity classes must share observation and refresh-failure provenance",
        });
      }
      if (
        game.latestPlayCountCheck?.status === "valid" &&
        !(
          (game.playCountEvidence.status === "valid" &&
            game.playCountEvidence.source === "bgg-collection" &&
            game.playCountEvidence.value === game.latestPlayCountCheck.value &&
            game.playCountEvidence.observedAt === game.latestPlayCountCheck.observedAt) ||
          (game.playCountEvidence.status === "valid" &&
            game.playCountEvidence.observedAt !== null &&
            Date.parse(game.playCountEvidence.observedAt) >
              Date.parse(game.latestPlayCountCheck.observedAt))
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["games", index, "latestPlayCountCheck"],
          message:
            "A valid latest BGG check must be current evidence unless superseded by newer valid evidence",
        });
      }
      if (
        game.latestPlayCountCheck !== null &&
        game.latestPlayCountCheck.status !== "valid" &&
        game.playCountEvidence.status !== "valid"
      ) {
        const statusMatches = game.playCountEvidence.status === game.latestPlayCountCheck.status;
        const provenanceMatches =
          game.playCountEvidence.source === "bgg-collection" &&
          game.playCountEvidence.observedAt === game.latestPlayCountCheck.observedAt;
        const invalidEvidenceMatches =
          game.latestPlayCountCheck.status !== "invalid" ||
          (game.playCountEvidence.status === "invalid" &&
            JSON.stringify(game.playCountEvidence.evidence) ===
              JSON.stringify(game.latestPlayCountCheck.evidence));
        if (!statusMatches || !provenanceMatches || !invalidEvidenceMatches) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["games", index, "latestPlayCountCheck"],
            message: "A non-valid latest BGG check must match current non-valid evidence",
          });
        }
      }
    }
    for (const [index, intention] of source.intentions.entries()) {
      if (intention.resolution === null && gamesById.get(intention.gameId)?.ownership !== "owned") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["intentions", index, "gameId"],
          message: "An active intention requires a currently owned game",
        });
      }
    }
  });

export const CollectionProfileCollectionSourceSchema = CollectionSchema;

function compareNormalizedCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left.normalize("NFC"), (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right.normalize("NFC"), (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

export const CollectionProfileSnapshotSchema = z
  .object({
    source: CollectionProfileCollectionSourceSchema,
    profile: CollectionProfileResultSchema,
  })
  .strict()
  .superRefine(({ source, profile }, context) => {
    if (profile.status !== "available") return;
    const ownedGames = new Map(
      source.games
        .filter(({ ownership }) => ownership === "owned")
        .map(({ id, name }) => [id, name]),
    );
    for (const entityClass of ["mechanic", "designer", "artist"] as const) {
      const result = profile.identity.classes[entityClass];
      const projectedGames = new Map(
        [...result.comparator.games, ...result.exclusions].map(({ gameId, gameName }) => [
          gameId,
          gameName,
        ]),
      );
      if (
        projectedGames.size !== ownedGames.size ||
        [...ownedGames].some(([gameId, gameName]) => projectedGames.get(gameId) !== gameName)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profile", "identity", "classes", entityClass],
          message: "Identity class must correspond exactly to currently owned source games",
        });
      }
    }
    const activeIntentions = source.intentions
      .filter(({ resolution }) => resolution === null)
      .sort((left, right) => {
        const leftName = source.games.find(({ id }) => id === left.gameId)?.name ?? "";
        const rightName = source.games.find(({ id }) => id === right.gameId)?.name ?? "";
        return (
          compareNormalizedCodePoints(leftName, rightName) ||
          compareNormalizedCodePoints(left.gameId, right.gameId)
        );
      });
    if (
      profile.attention.items.length !== activeIntentions.length ||
      profile.attention.items.some((item, index) => {
        const sourceIntention = activeIntentions[index];
        const sourceGame = source.games.find(({ id }) => id === sourceIntention?.gameId);
        return (
          sourceIntention === undefined ||
          sourceGame === undefined ||
          item.gameName !== sourceGame.name ||
          JSON.stringify(item.intention) !== JSON.stringify(sourceIntention)
        );
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", "attention", "items"],
        message: "Attention items must correspond exactly to every durable active intention",
      });
    }
    for (const [itemIndex, item] of profile.attention.items.entries()) {
      const game = source.games.find(({ id }) => id === item.intention.gameId);
      if (game === undefined) continue;
      const evidence = game.playCountEvidence;
      const latestCheck = game.latestPlayCountCheck;
      const stale =
        evidence.status === "valid" &&
        latestCheck !== null &&
        latestCheck.status !== "valid" &&
        (evidence.observedAt === null ||
          Date.parse(latestCheck.observedAt) > Date.parse(evidence.observedAt));
      const expectedEvidence =
        evidence.status === "valid" && !stale
          ? {
              status: "valid" as const,
              playCount: evidence.value,
              source: evidence.source,
              observedAt: evidence.observedAt,
              stale: false as const,
            }
          : evidence.status === "valid"
            ? {
                status: "stale" as const,
                playCount: evidence.value,
                source: evidence.source,
                observedAt: evidence.observedAt,
                warning: "A newer BGG check did not provide a valid play count." as const,
              }
            : evidence.status === "invalid" || latestCheck?.status === "invalid"
              ? {
                  status: "invalid" as const,
                  playCount: null,
                  source: evidence.source,
                  observedAt: evidence.observedAt,
                  warning: "Current play evidence is invalid." as const,
                }
              : {
                  status: "missing" as const,
                  playCount: null,
                  source: evidence.source,
                  observedAt: evidence.observedAt,
                  warning: "Current play evidence is missing." as const,
                };
      const expectedOperation =
        expectedEvidence.status === "valid" || game.bggId === null
          ? "shelf.game.plays.set"
          : "shelf.game.bgg.refresh";
      if (
        JSON.stringify(item.currentPlayEvidence) !== JSON.stringify(expectedEvidence) ||
        item.evidenceDestination.operationId !== expectedOperation
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profile", "attention", "items", itemIndex, "currentPlayEvidence"],
          message: "Attention play evidence and destination must match durable current evidence",
        });
      }
    }
    for (const entityClass of ["mechanic", "designer", "artist"] as const) {
      const classResult = profile.identity.classes[entityClass];
      const sourceById = new Map(source.games.map((game) => [game.id, game]));
      const readinessCounts = { complete: 0, "refresh-needed": 0, unrefreshable: 0 };
      for (const game of source.games.filter(({ ownership }) => ownership === "owned")) {
        readinessCounts[game.entityMetadata[entityClass].state] += 1;
      }
      if (
        classResult.metadataReadiness.completeGameCount !== readinessCounts.complete ||
        classResult.metadataReadiness.refreshNeededGameCount !==
          readinessCounts["refresh-needed"] ||
        classResult.metadataReadiness.unrefreshableGameCount !== readinessCounts.unrefreshable
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profile", "identity", "classes", entityClass, "metadataReadiness"],
          message: "Metadata readiness must match durable entity metadata",
        });
      }
      for (const [exclusionIndex, exclusion] of classResult.exclusions.entries()) {
        const metadata = sourceById.get(exclusion.gameId)?.entityMetadata[entityClass];
        const expectedMetadataReason =
          metadata?.state === "refresh-needed"
            ? "refresh-needed-metadata"
            : metadata?.state === "unrefreshable"
              ? "unrefreshable-metadata"
              : null;
        const expectedAssociation = metadata?.state === "complete" && metadata.entities.length > 0;
        if (
          (expectedMetadataReason !== null && exclusion.reason !== expectedMetadataReason) ||
          exclusion.hasEntityAssociation !== expectedAssociation
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["profile", "identity", "classes", entityClass, "exclusions", exclusionIndex],
            message: "Metadata exclusion must match durable class metadata",
          });
        }
      }
      const expectedWarnings = source.games
        .flatMap((game) => {
          if (game.ownership !== "owned") return [];
          const metadata = game.entityMetadata[entityClass];
          if (metadata.state !== "complete" || metadata.refreshFailure === null) return [];
          return [{ gameId: game.id, gameName: game.name, ...metadata.refreshFailure }];
        })
        .sort((left, right) => compareNormalizedCodePoints(left.gameId, right.gameId));
      if (JSON.stringify(classResult.refreshWarnings) !== JSON.stringify(expectedWarnings)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profile", "identity", "classes", entityClass, "refreshWarnings"],
          message: "Refresh warnings must match durable failure provenance",
        });
      }
      const expectedEntityIds = new Set(
        classResult.comparator.games.flatMap((evidence) => {
          const metadata = sourceById.get(evidence.gameId)?.entityMetadata[entityClass];
          return metadata?.state === "complete" ? metadata.entities.map(({ id }) => id) : [];
        }),
      );
      if (
        expectedEntityIds.size !== classResult.entities.length ||
        classResult.entities.some(({ entityId }) => !expectedEntityIds.has(entityId))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profile", "identity", "classes", entityClass, "entities"],
          message: "Entity results must contain every eligible durable BGG association once",
        });
      }
      for (const [entityIndex, entity] of profile.identity.classes[
        entityClass
      ].entities.entries()) {
        const observations = source.games.flatMap((game) => {
          if (game.ownership !== "owned") return [];
          const metadata = game.entityMetadata[entityClass];
          if (metadata.state !== "complete") return [];
          return metadata.entities
            .filter(({ id }) => id === entity.entityId)
            .map(({ name }) => ({ name, observedAt: metadata.observedAt, gameId: game.id }));
        });
        observations.sort(
          (left, right) =>
            Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
            compareNormalizedCodePoints(left.name, right.name) ||
            compareNormalizedCodePoints(left.gameId, right.gameId),
        );
        if (observations[0]?.name !== entity.name) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["profile", "identity", "classes", entityClass, "entities", entityIndex, "name"],
            message: "Entity name must match the canonical current source observation",
          });
        }
        const expectedGameIds = classResult.comparator.games
          .filter((evidence) => {
            const metadata = sourceById.get(evidence.gameId)?.entityMetadata[entityClass];
            return (
              metadata?.state === "complete" &&
              metadata.entities.some(({ id }) => id === entity.entityId)
            );
          })
          .map(({ gameId }) => gameId);
        if (entity.games.map(({ gameId }) => gameId).join(",") !== expectedGameIds.join(",")) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["profile", "identity", "classes", entityClass, "entities", entityIndex, "games"],
            message: "Entity memberships must match durable BGG links in eligible games",
          });
        }
      }
    }
  });

const FiniteNumberSchema = z.number().finite();
const NonNegativeIntegerSchema = z.number().int().safe().min(0);
const TimestampSchema = z.string().datetime({ offset: true });
const DerivedFieldIdSchema = z.custom<DerivedFieldId>(
  (value) => typeof value === "string" && Object.hasOwn(DERIVED_AXIS_REGISTRY, value),
);

const PurchaseUtilizationReasonSchema = z.enum([
  "missing-acquisition",
  "invalid-acquisition",
  "no-owner-cost",
  "missing-benchmark",
  "invalid-benchmark",
  "missing-play-count",
  "invalid-play-count",
  "missing-modeled-duration",
  "invalid-modeled-duration",
  "missing-modeled-player-count",
  "invalid-modeled-player-count",
  "missing-fitness",
  "invalid-fitness",
  "unreachable-at-current-fitness",
]);

const ExactUtilizationValueSchema = z
  .object({
    exact: z.object({ numerator: z.string(), denominator: z.string() }).strict(),
  })
  .strict();

function utilizationComponentSchema<ValueSchema extends z.ZodTypeAny>(value: ValueSchema) {
  const base = { label: z.string(), reasons: z.array(PurchaseUtilizationReasonSchema) };
  return z.union([
    z
      .object({
        ...base,
        outcome: z.literal("calculated"),
        value,
        display: z.string(),
        reasons: z.tuple([]),
      })
      .strict(),
    z
      .object({ ...base, outcome: z.literal("unavailable"), display: z.literal("Unavailable") })
      .strict(),
    z.object({ ...base, outcome: z.literal("not-applicable"), display: z.string() }).strict(),
    z
      .object({
        ...base,
        outcome: z.literal("unreachable"),
        display: z.literal("Unreachable at current fitness"),
        reasons: z.tuple([z.literal("unreachable-at-current-fitness")]),
      })
      .strict(),
  ]);
}

const ModeledPlayerCountValueSchema = ExactUtilizationValueSchema.extend({
  ...EvidenceObservationSchemaFields,
  resolution: z.enum(["manual", "poll-winner", "poll-tie-average", "player-range-midpoint"]),
  winningBestVotes: NonNegativeIntegerSchema.nullable(),
  winningPlayerCounts: z.array(z.string()),
}).strict();

const PurchaseUtilizationFitnessInputSchema = z.union([
  z
    .object({
      ...EvidenceObservationSchemaFields,
      status: z.literal("valid"),
      value: z.string(),
    })
    .strict(),
  z
    .object({
      ...EvidenceObservationSchemaFields,
      status: z.literal("missing"),
    })
    .strict(),
  z
    .object({
      ...EvidenceObservationSchemaFields,
      status: z.literal("invalid"),
      value: z.string(),
    })
    .strict(),
]);

const PurchaseUtilizationResultSchema = z
  .object({
    outcome: z.enum(["met", "not-met", "unavailable", "not-applicable"]),
    outcomeLabel: z.enum([
      "Value threshold met",
      "Value threshold not yet met",
      "Purchase value unavailable",
      "Purchase value not applicable",
    ]),
    reasons: z.array(PurchaseUtilizationReasonSchema),
    components: z
      .object({
        costPerRecordedPlay: utilizationComponentSchema(ExactUtilizationValueSchema),
        modeledPlayerCount: utilizationComponentSchema(ModeledPlayerCountValueSchema),
        modeledPlayerHours: utilizationComponentSchema(ExactUtilizationValueSchema),
        costPerModeledPlayerHour: utilizationComponentSchema(ExactUtilizationValueSchema),
        fitnessAdjustedHourlyBenchmark: utilizationComponentSchema(ExactUtilizationValueSchema),
        valueMultiplier: utilizationComponentSchema(
          ExactUtilizationValueSchema.extend({ status: z.enum(["met", "not-met"]) }).strict(),
        ),
        valueRemaining: utilizationComponentSchema(ExactUtilizationValueSchema),
        estimatedAdditionalPlays: utilizationComponentSchema(
          z.object({ wholePlays: z.string() }).strict(),
        ),
      })
      .strict(),
    evidence: z
      .object({
        acquisition: AcquisitionSchema,
        entertainmentBenchmark: EntertainmentBenchmarkSchema,
        playCount: PlayCountEvidenceSchema,
        duration: DurationEvidenceSchema,
        playerRange: PlayerRangeEvidenceSchema,
        suggestedPlayerPoll: SuggestedPlayerPollSchema,
        fitness: PurchaseUtilizationFitnessInputSchema,
      })
      .strict(),
    assumptions: z
      .object({
        modeledSessions: z.literal(
          "Models each recorded play at the shown duration and player count; actual sessions may differ.",
        ),
        futurePlays: z.literal(
          "Estimated additional plays assumes future plays use the shown duration, player count, fitness, and entertainment benchmark.",
        ),
        fitnessAdjustment: z.literal(
          "The fitness-adjusted hourly benchmark changes in direct proportion to current fitness; fitness 6 uses the collection benchmark.",
        ),
      })
      .strict(),
    sort: z
      .object({
        valueRemainingHundredths: z.string().nullable(),
        estimatedAdditionalPlays: z.union([
          z.object({ category: z.literal("finite"), wholePlays: z.string() }).strict(),
          z
            .object({
              category: z.enum(["unreachable", "unavailable", "not-applicable"]),
              wholePlays: z.null(),
            })
            .strict(),
        ]),
      })
      .strict(),
  })
  .strict();

const RedundancyAdjustmentResponseSchema = z
  .object({
    penalty: FiniteNumberSchema,
    originalScore: FiniteNumberSchema,
    adjustedScore: FiniteNumberSchema,
    nicheNeighbors: z.array(
      z
        .object({
          gameId: z.string().min(1),
          gameName: z.string().min(1),
          similarity: FiniteNumberSchema,
          fitnessScore: FiniteNumberSchema,
          isPredicted: z.boolean(),
        })
        .strict(),
    ),
    nicheRank: NonNegativeIntegerSchema,
    nicheSize: NonNegativeIntegerSchema,
  })
  .strict();

const FitnessResultResponseSchema = z
  .object({
    score: FiniteNumberSchema,
    ratedAxisCount: NonNegativeIntegerSchema,
    totalAxisCount: NonNegativeIntegerSchema,
    breakdown: z.array(
      z
        .object({
          axisId: z.string().min(1),
          axisName: z.string().min(1),
          weight: FiniteNumberSchema,
          contribution: FiniteNumberSchema.nullable(),
          source: z.enum(["personal", "tournament", "derived", "override", "predicted"]),
          derivedField: DerivedFieldIdSchema.nullable(),
          sourceValue: FiniteNumberSchema.nullable(),
          scoringRawValue: FiniteNumberSchema.nullable(),
          effectiveRating: FiniteNumberSchema.nullable(),
          preferenceShape: z.enum(["higher-is-better", "lower-is-better", "sweet-spot"]),
          curveAffected: z.boolean(),
          unit: z.string().nullable(),
          provenance: z.string().nullable(),
          configurationSummary: z.string().nullable(),
          overridden: z.boolean(),
          overrideValue: FiniteNumberSchema.nullable(),
          predictionConfidence: z
            .enum(["actual", "strong", "moderate", "weak", "insufficient"])
            .nullable(),
          referenceGames: z
            .array(
              z
                .object({
                  gameId: z.string().min(1),
                  gameName: z.string().min(1),
                  similarity: FiniteNumberSchema,
                })
                .strict(),
            )
            .nullable(),
        })
        .strict(),
    ),
    vetoed: z.boolean(),
    vetoedBy: z
      .object({
        axisId: z.string().min(1),
        axisName: z.string().min(1),
        threshold: FiniteNumberSchema,
        direction: z.enum(["below", "above"]),
        rawValue: FiniteNumberSchema,
      })
      .strict()
      .nullable(),
    hypotheticalScore: FiniteNumberSchema.nullable(),
    predictionMeta: z
      .object({
        readinessStage: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        confidence: z.enum(["actual", "strong", "moderate", "weak", "insufficient"]),
        predictedAxisCount: NonNegativeIntegerSchema,
        actualAxisCount: NonNegativeIntegerSchema,
        referenceGameCount: NonNegativeIntegerSchema,
        coveragePercent: FiniteNumberSchema,
      })
      .strict()
      .nullable(),
    redundancyAdjustment: RedundancyAdjustmentResponseSchema.nullable(),
  })
  .strict();

const NicheNeighborResponseSchema = z
  .object({
    gameId: z.string().min(1),
    gameName: z.string().min(1),
    fitnessScore: FiniteNumberSchema,
    isPredicted: z.boolean(),
  })
  .strict();

const NichePositionResponseSchema = z
  .object({
    niches: z.array(
      z
        .object({
          type: z.enum(["mechanic", "category", "family"]),
          name: z.string().min(1),
          size: NonNegativeIntegerSchema,
          rank: NonNegativeIntegerSchema,
          isChampion: z.boolean(),
          champion: NicheNeighborResponseSchema,
          above: z.array(NicheNeighborResponseSchema),
          below: z.array(NicheNeighborResponseSchema),
        })
        .strict(),
    ),
  })
  .strict();

export const GameDetailWithPurchaseUtilizationSchema = z
  .object({
    game: GameSchema,
    score: FitnessResultResponseSchema.nullable(),
    bggDataStale: z.boolean().optional(),
    nichePosition: NichePositionResponseSchema.nullable().optional(),
    displayScore: z.string().nullable(),
    purchaseUtilization: PurchaseUtilizationResultSchema,
    intentions: GameIntentionDetailSchema,
  })
  .strict()
  .superRefine((detail, context) => {
    if (
      detail.intentions.activeIntention !== null &&
      detail.intentions.activeIntention.gameId !== detail.game.id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intentions", "activeIntention", "gameId"],
        message: "Active intention must belong to the detail game",
      });
    }
    for (const [index, intention] of detail.intentions.resolvedHistory.entries()) {
      if (intention.gameId !== detail.game.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["intentions", "resolvedHistory", index, "gameId"],
          message: "Resolved intention must belong to the detail game",
        });
      }
    }
  });

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const ProfileSourceIdentitySchema = z
  .object({
    collectionId: z.string().min(1),
    collectionSchemaVersion: z.literal(CURRENT_COLLECTION_SCHEMA_VERSION),
    collectionRevision: z.number().int().nonnegative().safe(),
    tournamentHash: Sha256Schema,
    predictionSettingsHash: Sha256Schema,
    redundancySettingsHash: Sha256Schema,
  })
  .strict();

export const PredictionSettingsSchema = z
  .object({
    stageThresholds: z
      .tuple([
        z.number().int().nonnegative(),
        z.number().int().nonnegative(),
        z.number().int().nonnegative(),
      ])
      .refine(([first, second, third]) => first <= second && second <= third, {
        message: "Prediction stage thresholds must be ordered",
      }),
    defaultK: z.number().int().positive(),
    minSimilarityThreshold: z.number().min(0).max(1),
    tournamentStabilityBoost: z.number().nonnegative(),
  })
  .strict();

export const RedundancySettingsSchema = z
  .object({
    enabled: z.boolean(),
    stage: z.enum(["annotation", "integrated"]),
    similarityThreshold: z.number().min(0).max(1),
    maxPenalty: z.number().min(0.5).max(5),
    componentWeights: z
      .object({
        binary: z.number().nonnegative(),
        continuous: z.number().nonnegative(),
        personalAxes: z.number().nonnegative(),
      })
      .strict()
      .refine(({ binary, continuous, personalAxes }) => binary + continuous + personalAxes > 0, {
        message: "Redundancy component weights must have a positive sum",
      }),
    minNeighbors: z.number().int().positive(),
    expectedNeighbors: z.number().int().positive(),
  })
  .strict();

export const ProfileDataSchema = z
  .object({
    contractVersion: z.literal(CURRENT_PROFILE_CONTRACT_VERSION),
    algorithmVersion: z.literal(CURRENT_PROFILE_ALGORITHM_VERSION),
    sourceIdentity: ProfileSourceIdentitySchema,
    profile: CollectionProfileResultSchema.refine((profile) => profile.status === "available", {
      message: "Unavailable profiles are not cacheable",
    }),
    computedAt: TimestampSchema,
  })
  .strict()
  .superRefine((data, context) => {
    if (data.profile.status === "available" && data.profile.computedAt !== data.computedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", "computedAt"],
        message: "Profile timestamps must match",
      });
    }
  });

export const RateGameSchema = z.object({
  axisId: z.string().min(1),
  rating: z.number().int("Rating must be an integer").min(1).max(10),
});

export const PlayEvidenceMutationResultSchema = z
  .object({
    game: GameSchema,
    linkedIntentionTransition: PlayIntentionSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    const transition = result.linkedIntentionTransition;
    const evidence = result.game.playCountEvidence;
    const latestCheck = result.game.latestPlayCountCheck;
    const evidenceObservedAt = evidence.observedAt;
    const evidenceObservedTime =
      evidenceObservedAt === null ? null : Date.parse(evidenceObservedAt);
    const latestCheckTime = latestCheck === null ? null : Date.parse(latestCheck.observedAt);
    const mutationTime = Date.parse(result.game.updatedAt);
    const matchesValidLatestCheck =
      evidence.status === "valid" &&
      evidence.source === "bgg-collection" &&
      latestCheck?.status === "valid" &&
      evidence.value === latestCheck.value &&
      evidence.observedAt === latestCheck.observedAt;
    const supersedesLatestCheck =
      evidence.status === "valid" &&
      evidenceObservedTime !== null &&
      latestCheckTime !== null &&
      evidenceObservedTime > latestCheckTime;

    if (!Number.isFinite(mutationTime)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game", "updatedAt"],
        message: "The game mutation timestamp must be a valid date",
      });
    }
    if (evidenceObservedAt !== null && !Number.isFinite(evidenceObservedTime)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game", "playCountEvidence", "observedAt"],
        message: "The play-count evidence timestamp must be a valid date",
      });
    }
    if (latestCheck !== null && !Number.isFinite(latestCheckTime)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game", "latestPlayCountCheck", "observedAt"],
        message: "The latest BGG play-count check timestamp must be a valid date",
      });
    }
    if (latestCheck?.status === "valid" && !matchesValidLatestCheck && !supersedesLatestCheck) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game", "latestPlayCountCheck"],
        message:
          "A valid latest BGG check must be current evidence unless superseded by newer valid evidence",
      });
    }
    if (
      latestCheck !== null &&
      latestCheck.status !== "valid" &&
      evidence.status !== "valid" &&
      (evidence.status !== latestCheck.status ||
        evidence.source !== "bgg-collection" ||
        evidence.observedAt !== latestCheck.observedAt ||
        (latestCheck.status === "invalid" &&
          evidence.status === "invalid" &&
          JSON.stringify(evidence.evidence) !== JSON.stringify(latestCheck.evidence)))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game", "latestPlayCountCheck"],
        message: "A non-valid latest BGG check must match current non-valid evidence",
      });
    }
    if (evidenceObservedTime !== null && evidenceObservedTime > mutationTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game", "playCountEvidence", "observedAt"],
        message: "Play-count evidence cannot be observed after the game mutation",
      });
    }
    if (latestCheckTime !== null && latestCheckTime > mutationTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game", "latestPlayCountCheck", "observedAt"],
        message: "The latest BGG play-count check cannot be observed after the game mutation",
      });
    }
    if (transition !== null && transition.gameId !== result.game.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["linkedIntentionTransition", "gameId"],
        message: "Linked intention transition must belong to the returned game",
      });
    }
    if (transition === null) return;
    const authoritativeFreshEvidence =
      evidence.status === "valid" &&
      evidenceObservedTime !== null &&
      (latestCheck === null ||
        matchesValidLatestCheck ||
        (latestCheckTime !== null && evidenceObservedTime >= latestCheckTime));
    if (
      transition.resolution?.outcome !== "completed" ||
      transition.resolution.source !== "observed-play-increase" ||
      transition.version !== 2
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["linkedIntentionTransition"],
        message: "Linked play-evidence transition must be an observed version-two completion",
      });
    }
    if (
      evidence.status !== "valid" ||
      evidence.observedAt === null ||
      !authoritativeFreshEvidence ||
      evidence.value <= transition.baseline.playCount ||
      Date.parse(evidence.observedAt) <= Date.parse(transition.baseline.observedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game", "playCountEvidence"],
        message:
          "Linked completion requires valid non-stale evidence above and newer than its baseline",
      });
    }
    if (transition.resolution?.resolvedAt !== result.game.updatedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["linkedIntentionTransition", "resolution", "resolvedAt"],
        message: "Linked completion and returned game must describe the same mutation",
      });
    }
    if (
      evidenceObservedTime !== null &&
      transition.resolution !== null &&
      evidenceObservedTime > Date.parse(transition.resolution.resolvedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game", "playCountEvidence", "observedAt"],
        message: "Completion evidence cannot be observed after the linked completion",
      });
    }
  });

export const ManualPlayCorrectionResultSchema = z
  .discriminatedUnion("ok", [
    z
      .object({
        ok: z.literal(true),
        game: GameSchema,
        linkedIntentionTransition: PlayIntentionSchema.nullable(),
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        error: z
          .object({
            code: z.literal("non-monotonic-observation"),
            gameId: z.string().min(1),
            attemptedObservedAt: TimestampSchema,
            latestAcceptedAt: TimestampSchema,
          })
          .strict(),
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (result.ok) {
      const parsed = PlayEvidenceMutationResultSchema.safeParse({
        game: result.game,
        linkedIntentionTransition: result.linkedIntentionTransition,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) context.addIssue(issue);
      }
    } else {
      if (
        Date.parse(result.error.attemptedObservedAt) > Date.parse(result.error.latestAcceptedAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["error", "attemptedObservedAt"],
          message: "A rejected observation must not be newer than the latest accepted timestamp",
        });
      }
    }
  });

export const ManualPlayCorrectionResponseSchema = z.union([
  ManualPlayCorrectionResultSchema,
  IntentionMutationErrorSchema.refine(
    (error) => error.code === "validation" || error.code === "persistence-failure",
    { message: "Unsupported manual play-correction error" },
  ),
  z.object({ code: z.literal("game_not_found"), error: z.string().min(1) }).strict(),
]);

export const OwnershipMutationResultSchema = z
  .object({
    game: GameSchema,
    linkedIntentionTransition: PlayIntentionSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    const transition = result.linkedIntentionTransition;
    if (transition === null) return;
    if (
      transition.gameId !== result.game.id ||
      result.game.ownership !== "previously-owned" ||
      transition.version !== 2 ||
      transition.resolution?.outcome !== "retired" ||
      transition.resolution.source !== "owner-retired" ||
      transition.resolution.resolvedAt !== result.game.updatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["linkedIntentionTransition"],
        message: "Linked ownership transition must be the retirement caused by this relinquishment",
      });
    }
  });

const AddGameBaseFields = {
  yearPublished: z.number().int().nullable().optional().default(null),
  minPlayers: z.number().int().safe().min(1).nullable().optional().default(null),
  maxPlayers: z.number().int().safe().min(1).nullable().optional().default(null),
  bestPlayers: z.number().safe().positive().nullable().optional().default(null),
  playingTime: z.number().int().safe().positive().nullable().optional().default(null),
  imageUrl: z.string().url().nullable().optional().default(null),
  numPlays: z.number().int().safe().min(0).nullable().optional().default(null),
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
  )
  .refine(
    (data) =>
      data.minPlayers === null || data.maxPlayers === null || data.minPlayers <= data.maxPlayers,
    { message: "Minimum players cannot exceed maximum players", path: ["maxPlayers"] },
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
    kFactorThreshold: z.number().int().min(1).optional(),
    normalizationHalfWidth: z.number().positive().optional(),
    provisionalThreshold: z.number().int().min(0).optional(),
  })
  .strict();

// Storage format schemas (used by loadTournament for validation and migration)

export const TournamentSettingsSchema = z.object({
  kFactorThreshold: z.number().int().min(1),
  normalizationHalfWidth: z.number().positive(),
  provisionalThreshold: z.number().int().min(0),
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
