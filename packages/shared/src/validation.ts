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

export const CURRENT_COLLECTION_SCHEMA_VERSION = 3 as const;
export const CURRENT_PROFILE_CONTRACT_VERSION = 6 as const;
export const CURRENT_PROFILE_ALGORITHM_VERSION = 5 as const;
export const PROFILE_NARRATION_ABSTENTION =
  "No reported trusted insights are available to narrate." as const;

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

export const GameSchema = z
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

export const CollectionSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_COLLECTION_SCHEMA_VERSION),
    id: z.string().min(1),
    name: z.string().min(1),
    axes: z.array(AxisSchema),
    games: z.array(GameSchema),
    entertainmentBenchmark: EntertainmentBenchmarkSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const FiniteNumberSchema = z.number().finite();
const NonNegativeIntegerSchema = z.number().int().safe().min(0);
const PercentageSchema = FiniteNumberSchema.min(0).max(100);
const TimestampSchema = z.string().datetime({ offset: true });

const NarrationEvidenceReferenceSchema = z
  .object({
    insightId: z.string().min(1),
    gameIds: z
      .array(z.string().min(1))
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Narration evidence game IDs must be unique",
      }),
  })
  .strict();

const NarratedClaimSchema = z
  .object({
    observation: z.string().min(1),
    interpretation: z.string().min(1).nullable(),
    evidenceReferences: z
      .tuple([NarrationEvidenceReferenceSchema])
      .rest(NarrationEvidenceReferenceSchema)
      .refine(
        (references) =>
          new Set(references.map(({ insightId }) => insightId)).size === references.length,
        { message: "Narration insight references must be unique within a claim" },
      ),
  })
  .strict();

const ProfileNarrationSchema = z
  .object({
    summary: z.array(NarratedClaimSchema),
    surprises: z.array(NarratedClaimSchema),
    tensions: z.array(NarratedClaimSchema),
    abstention: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((narration, context) => {
    const claimCount =
      narration.summary.length + narration.surprises.length + narration.tensions.length;
    if ((claimCount === 0) !== (narration.abstention !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["abstention"],
        message: "Narration must contain grounded claims or an abstention, but not both",
      });
    }
  });

const AxisDistributionSchema = z
  .object({
    axisId: z.string().min(1),
    axisName: z.string().min(1),
    mean: FiniteNumberSchema,
    median: FiniteNumberSchema,
    standardDeviation: FiniteNumberSchema.min(0),
    range: z.object({ min: FiniteNumberSchema, max: FiniteNumberSchema }).strict(),
    ratedGameCount: NonNegativeIntegerSchema,
    histogram: z.array(NonNegativeIntegerSchema).length(10),
  })
  .strict()
  .refine(({ range }) => range.min <= range.max, {
    message: "Profile axis range minimum cannot exceed maximum",
    path: ["range", "max"],
  });

const AttributeClusterSchema = z
  .object({
    name: z.string().min(1),
    count: NonNegativeIntegerSchema,
    percentage: PercentageSchema,
  })
  .strict();

const WeightRangeClusterSchema = z
  .object({
    range: z.string().min(1),
    min: FiniteNumberSchema,
    max: FiniteNumberSchema,
    count: NonNegativeIntegerSchema,
    percentage: PercentageSchema,
  })
  .strict()
  .refine(({ min, max }) => min <= max, {
    message: "Profile weight range minimum cannot exceed maximum",
    path: ["max"],
  });

const UtilityCurveDeclarationSchema = z
  .object({
    axisId: z.string().min(1),
    axisName: z.string().min(1),
    derivedField: z
      .custom<DerivedFieldId>(
        (value) => typeof value === "string" && Object.hasOwn(DERIVED_AXIS_REGISTRY, value),
      )
      .nullable(),
    shape: z.enum(["higher-is-better", "lower-is-better", "sweet-spot"]),
    idealValue: FiniteNumberSchema.nullable(),
    tolerance: z.enum(["flexible", "moderate", "strict"]).nullable(),
    toleranceWidth: FiniteNumberSchema.nullable(),
    leanDirection: z.enum(["lower", "higher"]).nullable(),
    vetoThreshold: z
      .object({ direction: z.enum(["below", "above"]), threshold: FiniteNumberSchema })
      .strict()
      .nullable(),
    nativeScale: z.object({ min: FiniteNumberSchema, max: FiniteNumberSchema }).strict(),
    unit: z.string().nullable(),
    provenance: z.string().nullable(),
    configurationSummary: z.string().nullable(),
  })
  .strict()
  .refine(({ nativeScale }) => nativeScale.min < nativeScale.max, {
    message: "Profile native scale minimum must be below maximum",
    path: ["nativeScale", "max"],
  });

const InsightMeasurementSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    value: z.union([z.string(), FiniteNumberSchema, z.boolean(), z.null()]),
    unit: z.string().nullable(),
    source: z.string().min(1),
  })
  .strict();

const InsightEvidenceGameSchema = z
  .object({
    gameId: z.string().min(1),
    gameName: z.string().min(1),
    role: z.enum(["subject", "supporting", "comparator"]),
    measurements: z.array(InsightMeasurementSchema),
  })
  .strict();

const InsightSufficiencySchema = z
  .object({
    criterion: z.string().min(1),
    observed: FiniteNumberSchema,
    required: FiniteNumberSchema,
    met: z.boolean(),
  })
  .strict();

const SatisfiedInsightSufficiencySchema = z
  .object({
    criterion: z.string().min(1),
    observed: FiniteNumberSchema,
    required: FiniteNumberSchema,
    met: z.literal(true),
  })
  .strict();

const UnmetInsightSufficiencySchema = z
  .object({
    criterion: z.string().min(1),
    observed: FiniteNumberSchema,
    required: FiniteNumberSchema,
    met: z.literal(false),
  })
  .strict();

// Persisted percentages may be rounded to one decimal place by producers.
const INSIGHT_COVERAGE_TOLERANCE_PERCENTAGE_POINTS = 0.05;
// Expected coverage uses division and multiplication; comparison adds two subtractions.
const INSIGHT_FLOATING_POINT_ULPS = 4;
// Suggestion means and their effect are independently rounded to tenths by the producer.
const SUGGESTION_EFFECT_ROUNDING_TOLERANCE = 0.1;

function insightValuesMatch(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <=
    INSIGHT_FLOATING_POINT_ULPS * Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function exceedsInclusiveFloatingPointTolerance(
  actual: number,
  expected: number,
  tolerance: number,
): boolean {
  const difference = Math.abs(actual - expected);
  const operandScale = Math.max(
    1,
    Math.abs(actual),
    Math.abs(expected),
    Math.abs(difference),
    Math.abs(tolerance),
  );
  const representationError = INSIGHT_FLOATING_POINT_ULPS * Number.EPSILON * operandScale;
  return difference - tolerance > representationError;
}

const InsightCohortSchema = z
  .object({
    description: z.string().min(1),
    eligibleGameCount: NonNegativeIntegerSchema,
    includedGameCount: NonNegativeIntegerSchema,
    excludedGameCount: NonNegativeIntegerSchema,
    coveragePercent: PercentageSchema,
  })
  .strict()
  .superRefine((cohort, context) => {
    if (cohort.includedGameCount + cohort.excludedGameCount !== cohort.eligibleGameCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["excludedGameCount"],
        message: "Included and excluded game counts must equal eligible game count",
      });
    }
    const expectedCoverage =
      cohort.eligibleGameCount === 0
        ? 0
        : (cohort.includedGameCount / cohort.eligibleGameCount) * 100;
    if (
      (cohort.eligibleGameCount === 0 && cohort.coveragePercent !== 0) ||
      (cohort.eligibleGameCount > 0 &&
        exceedsInclusiveFloatingPointTolerance(
          cohort.coveragePercent,
          expectedCoverage,
          INSIGHT_COVERAGE_TOLERANCE_PERCENTAGE_POINTS,
        ))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coveragePercent"],
        message: `Coverage percent must match included/eligible within ${INSIGHT_COVERAGE_TOLERANCE_PERCENTAGE_POINTS} percentage points`,
      });
    }
  });

const CurrentAxisSuggestionMethodSchema = z
  .object({
    id: z.literal("directional-divergence-attribute-effect"),
    version: z.literal(1),
    description: z.string().min(1),
  })
  .strict();

const RetiredAxisSuggestionMethodSchema = z.union([
  z
    .object({
      id: z.literal("unexpressed-concentration"),
      version: z.literal(1),
      description: z.string().min(1),
    })
    .strict(),
  z
    .object({
      id: z.literal("high-variance"),
      version: z.literal(1),
      description: z.string().min(1),
    })
    .strict(),
]);

const InsightBaseFields = {
  contractVersion: z.literal(1),
  id: z.string().min(1),
  method: z
    .object({
      id: z.string().min(1),
      version: z.number().int().positive(),
      description: z.string().min(1),
    })
    .strict(),
  cohort: InsightCohortSchema,
  sufficiency: z.array(InsightSufficiencySchema),
  evidence: z.array(InsightEvidenceGameSchema),
  comparator: z
    .object({ description: z.string().min(1), gameIds: z.array(z.string().min(1)) })
    .strict()
    .nullable(),
  limitations: z.array(z.string().min(1)),
};

const TournamentDivergenceDetailsSchema = z
  .object({
    gameId: z.string().min(1),
    gameName: z.string().min(1),
    independentFitnessScore: FiniteNumberSchema,
    normalizedTournamentScore: FiniteNumberSchema,
    gap: FiniteNumberSchema.min(0),
    direction: z.enum(["tournament-outlier", "fitness-outlier"]),
    comparisonCount: NonNegativeIntegerSchema,
    provisional: z.boolean(),
  })
  .strict();

const ReportedTournamentDivergenceSchema = z
  .object({
    ...InsightBaseFields,
    sufficiency: z.array(SatisfiedInsightSufficiencySchema).nonempty(),
    evidence: z
      .array(
        InsightEvidenceGameSchema.extend({
          measurements: z.array(InsightMeasurementSchema).nonempty(),
        }),
      )
      .nonempty(),
    status: z.literal("reported"),
    observation: z.string().min(1),
    interpretation: z.string().nullable(),
    details: TournamentDivergenceDetailsSchema,
    notability: z
      .object({
        metric: z.string().min(1),
        value: FiniteNumberSchema,
        threshold: FiniteNumberSchema,
        direction: z.literal("above"),
        explanation: z.string().min(1),
      })
      .strict(),
    confidence: z
      .object({ level: z.enum(["low", "moderate", "high"]), basis: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((divergence, context) => {
    const subjectEvidence = divergence.evidence.filter(({ role }) => role === "subject");
    const comparisonRequirements = divergence.sufficiency.filter(
      ({ criterion }) => criterion === "comparisons for subject game",
    );
    const comparisonRequirement = comparisonRequirements[0];
    const comparatorGameIds = divergence.comparator?.gameIds ?? [];
    const expectedGap = Math.abs(
      divergence.details.normalizedTournamentScore - divergence.details.independentFitnessScore,
    );
    const scoreDifference =
      divergence.details.normalizedTournamentScore - divergence.details.independentFitnessScore;
    const expectedDirection =
      scoreDifference > 0 ? "tournament-outlier" : scoreDifference < 0 ? "fitness-outlier" : null;
    const addContractIssue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (divergence.id !== `divergence:${divergence.details.gameId}`) {
      addContractIssue(["id"], "Divergence ID must identify the subject game");
    }
    if (
      subjectEvidence.length !== 1 ||
      subjectEvidence[0]?.gameId !== divergence.details.gameId ||
      subjectEvidence[0]?.gameName !== divergence.details.gameName
    ) {
      addContractIssue(
        ["evidence"],
        "Divergence evidence must contain exactly one matching subject game",
      );
    }
    if (comparatorGameIds.length !== 1 || comparatorGameIds[0] !== divergence.details.gameId) {
      addContractIssue(
        ["comparator", "gameIds"],
        "Divergence comparator must identify the subject game's independent fitness",
      );
    }
    if (!insightValuesMatch(divergence.details.gap, expectedGap)) {
      addContractIssue(
        ["details", "gap"],
        "Divergence gap must equal the absolute score difference",
      );
    }
    if (divergence.details.gap <= 0 || expectedDirection === null) {
      addContractIssue(
        ["details", "gap"],
        "Reported divergence requires strictly different scores and a positive gap",
      );
    }
    if (expectedDirection === null || divergence.details.direction !== expectedDirection) {
      addContractIssue(
        ["details", "direction"],
        "Divergence direction must match the score ordering",
      );
    }
    if (
      comparisonRequirements.length !== 1 ||
      comparisonRequirement === undefined ||
      comparisonRequirement.observed !== divergence.details.comparisonCount ||
      divergence.details.comparisonCount < comparisonRequirement.required
    ) {
      addContractIssue(
        ["details", "comparisonCount"],
        "Divergence comparison count must match its satisfied sufficiency requirement",
      );
    }
    if (divergence.details.provisional) {
      addContractIssue(
        ["details", "provisional"],
        "Reported divergence cannot use provisional Tournament results",
      );
    }
    if (!insightValuesMatch(divergence.notability.value, divergence.details.gap)) {
      addContractIssue(
        ["notability", "value"],
        "Divergence notability must report the absolute score gap",
      );
    }
    if (
      divergence.details.gap <= divergence.notability.threshold ||
      divergence.notability.value <= divergence.notability.threshold
    ) {
      addContractIssue(
        ["notability"],
        "Reported divergence must be strictly above its declared notability threshold",
      );
    }
  });

const AbstainedTournamentDivergenceSchema = z.union([
  z
    .object({
      ...InsightBaseFields,
      status: z.literal("insufficient"),
      reason: z.literal("insufficient-sample"),
      sufficiency: z.tuple([UnmetInsightSufficiencySchema]).rest(InsightSufficiencySchema),
      explanation: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...InsightBaseFields,
      status: z.literal("insufficient"),
      reason: z.literal("insufficient-coverage"),
      sufficiency: z.tuple([UnmetInsightSufficiencySchema]).rest(InsightSufficiencySchema),
      explanation: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...InsightBaseFields,
      status: z.literal("insufficient"),
      reason: z.literal("missing-comparator"),
      comparator: z.null(),
      explanation: z.string().min(1),
    })
    .strict(),
]);

const TournamentDivergenceInsightSchema = z.union([
  ReportedTournamentDivergenceSchema,
  AbstainedTournamentDivergenceSchema,
]);

const CollectionOutlierDriverSchema = z
  .object({
    dimension: z.enum(["mechanics", "categories", "complexity", "player-count", "playing-time"]),
    label: z.string().min(1),
    distance: FiniteNumberSchema.min(0).max(1),
    subjectValue: z.union([z.string(), FiniteNumberSchema]),
    comparatorValues: z.array(
      z
        .object({ gameId: z.string().min(1), value: z.union([z.string(), FiniteNumberSchema]) })
        .strict(),
    ),
    explanation: z.string().min(1),
  })
  .strict();

const ReportedCollectionOutlierSchema = z
  .object({
    ...InsightBaseFields,
    status: z.literal("reported"),
    sufficiency: z.array(SatisfiedInsightSufficiencySchema).nonempty(),
    evidence: z
      .array(
        InsightEvidenceGameSchema.extend({
          measurements: z.array(InsightMeasurementSchema).nonempty(),
        }),
      )
      .nonempty(),
    observation: z.string().min(1),
    interpretation: z.string().nullable(),
    details: z
      .object({
        gameId: z.string().min(1),
        gameName: z.string().min(1),
        neighborhoodDistance: FiniteNumberSchema.min(0).max(1),
        nearestComparisons: z.tuple([
          z
            .object({
              gameId: z.string().min(1),
              gameName: z.string().min(1),
              distance: FiniteNumberSchema.min(0).max(1),
            })
            .strict(),
          z
            .object({
              gameId: z.string().min(1),
              gameName: z.string().min(1),
              distance: FiniteNumberSchema.min(0).max(1),
            })
            .strict(),
        ]),
        drivers: z.array(CollectionOutlierDriverSchema).nonempty(),
        fitnessScore: FiniteNumberSchema.nullable(),
      })
      .strict(),
    notability: z
      .object({
        metric: z.string().min(1),
        value: FiniteNumberSchema,
        threshold: FiniteNumberSchema,
        direction: z.literal("above"),
        explanation: z.string().min(1),
      })
      .strict(),
    confidence: z
      .object({ level: z.enum(["low", "moderate", "high"]), basis: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((outlier, context) => {
    const comparatorGameIds = outlier.comparator?.gameIds ?? [];
    const detailComparatorGameIds = outlier.details.nearestComparisons.map(({ gameId }) => gameId);
    const comparatorEvidence = outlier.evidence.filter(({ role }) => role === "comparator");
    const evidenceComparatorGameIds = comparatorEvidence.map(({ gameId }) => gameId);
    const comparatorIds = new Set(comparatorGameIds);
    const detailComparatorIds = new Set(detailComparatorGameIds);
    const evidenceComparatorIds = new Set(evidenceComparatorGameIds);
    const subjectEvidence = outlier.evidence.filter(({ role }) => role === "subject");
    const sameIds = (left: Set<string>, right: Set<string>) =>
      left.size === right.size && [...left].every((gameId) => right.has(gameId));
    const addContractIssue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (outlier.id !== `outlier:${outlier.details.gameId}`) {
      addContractIssue(["id"], "Outlier ID must identify the subject game");
    }
    if (
      subjectEvidence.length !== 1 ||
      subjectEvidence[0]?.gameId !== outlier.details.gameId ||
      subjectEvidence[0]?.gameName !== outlier.details.gameName
    ) {
      addContractIssue(
        ["evidence"],
        "Outlier evidence must contain exactly one matching subject game",
      );
    }
    if (comparatorGameIds.length !== 2 || comparatorIds.size !== 2) {
      addContractIssue(
        ["comparator", "gameIds"],
        "Outliers must declare two distinct comparison games",
      );
    }
    if (detailComparatorIds.size !== 2) {
      addContractIssue(
        ["details", "nearestComparisons"],
        "Nearest comparisons must identify two distinct games",
      );
    }
    if (comparatorEvidence.length !== 2 || evidenceComparatorIds.size !== 2) {
      addContractIssue(["evidence"], "Outlier evidence must contain two distinct comparators");
    }
    if (!sameIds(comparatorIds, detailComparatorIds)) {
      addContractIssue(
        ["comparator", "gameIds"],
        "Comparator IDs must match the nearest comparison details",
      );
    }
    if (!sameIds(comparatorIds, evidenceComparatorIds)) {
      addContractIssue(
        ["evidence"],
        "Comparator evidence must match the declared comparison games",
      );
    }
    if (!insightValuesMatch(outlier.notability.value, outlier.details.neighborhoodDistance)) {
      addContractIssue(
        ["notability", "value"],
        "Outlier notability must report the neighborhood distance",
      );
    }
    if (
      outlier.details.neighborhoodDistance <= outlier.notability.threshold ||
      outlier.notability.value <= outlier.notability.threshold
    ) {
      addContractIssue(
        ["notability"],
        "Reported outlier must be strictly above its declared notability threshold",
      );
    }
    for (const [driverIndex, driver] of outlier.details.drivers.entries()) {
      const driverComparatorIds = new Set(driver.comparatorValues.map(({ gameId }) => gameId));
      if (
        driver.comparatorValues.length !== 2 ||
        driverComparatorIds.size !== 2 ||
        !sameIds(comparatorIds, driverComparatorIds)
      ) {
        addContractIssue(
          ["details", "drivers", driverIndex, "comparatorValues"],
          "Each driver must expose values for every comparison game",
        );
      }
    }
  });

const AbstainedCollectionOutlierSchema = z.union([
  z
    .object({
      ...InsightBaseFields,
      status: z.literal("insufficient"),
      reason: z.literal("insufficient-sample"),
      sufficiency: z.tuple([UnmetInsightSufficiencySchema]).rest(InsightSufficiencySchema),
      explanation: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...InsightBaseFields,
      status: z.literal("insufficient"),
      reason: z.literal("insufficient-coverage"),
      sufficiency: z.tuple([UnmetInsightSufficiencySchema]).rest(InsightSufficiencySchema),
      explanation: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...InsightBaseFields,
      status: z.literal("insufficient"),
      reason: z.literal("missing-comparator"),
      comparator: z.null(),
      explanation: z.string().min(1),
    })
    .strict(),
]);

const CollectionOutlierSchema = z.union([
  ReportedCollectionOutlierSchema,
  AbstainedCollectionOutlierSchema,
]);

const ReportedAxisSuggestionSchema = z
  .object({
    ...InsightBaseFields,
    method: CurrentAxisSuggestionMethodSchema,
    comparator: z
      .object({ description: z.string().min(1), gameIds: z.array(z.string().min(1)).nonempty() })
      .strict(),
    status: z.literal("reported"),
    sufficiency: z.array(SatisfiedInsightSufficiencySchema).nonempty(),
    evidence: z
      .array(
        InsightEvidenceGameSchema.extend({
          measurements: z.array(InsightMeasurementSchema).nonempty(),
        }),
      )
      .nonempty(),
    observation: z.string().min(1),
    interpretation: z
      .string()
      .min(1)
      .refine((value) => value.trim().endsWith("?"), {
        message: "Reported axis suggestions must be framed as questions",
      }),
    details: z
      .object({
        source: z.literal("divergence-repair"),
        attribute: z.string().min(1),
        attributeType: z.enum(["mechanic", "category"]),
        direction: z.enum(["tournament-outlier", "fitness-outlier"]),
        supportingGameCount: NonNegativeIntegerSchema.min(3),
        comparatorGameCount: NonNegativeIntegerSchema.min(3),
        supportingMeanGap: FiniteNumberSchema,
        comparatorMeanGap: FiniteNumberSchema,
        effect: FiniteNumberSchema.min(1.5),
      })
      .strict(),
    notability: z
      .object({
        metric: z.string().min(1),
        value: FiniteNumberSchema,
        threshold: FiniteNumberSchema,
        direction: z.literal("above"),
        explanation: z.string().min(1),
      })
      .strict(),
    confidence: z.null(),
  })
  .strict()
  .superRefine((suggestion, context) => {
    const supportingIds = new Set(
      suggestion.evidence
        .filter(({ role }) => role === "subject" || role === "supporting")
        .map(({ gameId }) => gameId),
    );
    const comparatorIds = new Set(
      suggestion.evidence.filter(({ role }) => role === "comparator").map(({ gameId }) => gameId),
    );
    const declaredComparatorIds = new Set(suggestion.comparator.gameIds);
    const addContractIssue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (supportingIds.size !== suggestion.details.supportingGameCount) {
      addContractIssue(
        ["details", "supportingGameCount"],
        "Supporting game count must match distinct positive evidence games",
      );
    }
    if (comparatorIds.size !== suggestion.details.comparatorGameCount) {
      addContractIssue(
        ["details", "comparatorGameCount"],
        "Comparator game count must match distinct comparator evidence games",
      );
    }
    if (
      comparatorIds.size !== declaredComparatorIds.size ||
      [...comparatorIds].some((gameId) => !declaredComparatorIds.has(gameId))
    ) {
      addContractIssue(
        ["comparator", "gameIds"],
        "Comparator game IDs must match comparator evidence games",
      );
    }
    if ([...supportingIds].some((gameId) => comparatorIds.has(gameId))) {
      addContractIssue(
        ["evidence"],
        "Positive and comparator evidence must contain disjoint game IDs",
      );
    }
    const expectedEffect =
      suggestion.details.direction === "tournament-outlier"
        ? suggestion.details.supportingMeanGap - suggestion.details.comparatorMeanGap
        : suggestion.details.comparatorMeanGap - suggestion.details.supportingMeanGap;
    const directionMatchesSignedMean =
      suggestion.details.direction === "tournament-outlier"
        ? suggestion.details.supportingMeanGap > 0
        : suggestion.details.supportingMeanGap < 0;
    if (!directionMatchesSignedMean) {
      addContractIssue(
        ["details", "direction"],
        "Suggestion direction must match the sign of the supporting mean gap",
      );
    }
    if (
      exceedsInclusiveFloatingPointTolerance(
        suggestion.details.effect,
        expectedEffect,
        SUGGESTION_EFFECT_ROUNDING_TOLERANCE,
      )
    ) {
      addContractIssue(
        ["details", "effect"],
        "Suggestion effect must match the direction-specific difference between rounded means",
      );
    }
    if (!insightValuesMatch(suggestion.notability.value, suggestion.details.effect)) {
      addContractIssue(
        ["notability", "value"],
        "Suggestion notability must report the measured effect",
      );
    }
    if (
      suggestion.details.effect <= suggestion.notability.threshold ||
      suggestion.notability.value <= suggestion.notability.threshold
    ) {
      addContractIssue(
        ["notability"],
        "Reported suggestion must be strictly above its declared notability threshold",
      );
    }
  });

const AbstainedAxisSuggestionSchema = z.union([
  z
    .object({
      ...InsightBaseFields,
      method: CurrentAxisSuggestionMethodSchema,
      status: z.literal("insufficient"),
      reason: z.literal("insufficient-sample"),
      sufficiency: z.tuple([UnmetInsightSufficiencySchema]).rest(InsightSufficiencySchema),
      explanation: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...InsightBaseFields,
      method: CurrentAxisSuggestionMethodSchema,
      status: z.literal("insufficient"),
      reason: z.literal("insufficient-coverage"),
      sufficiency: z.tuple([UnmetInsightSufficiencySchema]).rest(InsightSufficiencySchema),
      explanation: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...InsightBaseFields,
      method: CurrentAxisSuggestionMethodSchema,
      status: z.literal("insufficient"),
      reason: z.literal("missing-comparator"),
      comparator: z.null(),
      explanation: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...InsightBaseFields,
      method: CurrentAxisSuggestionMethodSchema,
      status: z.literal("suppressed"),
      reason: z.literal("unsupported-method"),
      explanation: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...InsightBaseFields,
      method: RetiredAxisSuggestionMethodSchema,
      status: z.literal("retired"),
      reason: z.literal("superseded"),
      explanation: z.string().min(1),
    })
    .strict(),
]);

const AxisSuggestionSchema = z.union([ReportedAxisSuggestionSchema, AbstainedAxisSuggestionSchema]);

export const CollectionProfileSchema = z
  .object({
    axisDistributions: z.array(AxisDistributionSchema),
    axisWeights: z.array(
      z
        .object({
          axisId: z.string().min(1),
          axisName: z.string().min(1),
          weight: FiniteNumberSchema.min(0),
          percentage: PercentageSchema,
        })
        .strict(),
    ),
    bggClustering: z
      .object({
        mechanics: z.array(AttributeClusterSchema),
        categories: z.array(AttributeClusterSchema),
        families: z.array(AttributeClusterSchema),
        subdomains: z.array(AttributeClusterSchema),
        weightRanges: z.array(WeightRangeClusterSchema),
      })
      .strict(),
    utilityCurves: z.array(UtilityCurveDeclarationSchema),
    divergence: z.array(TournamentDivergenceInsightSchema).nullable(),
    outliers: z.array(CollectionOutlierSchema),
    suggestions: z.array(AxisSuggestionSchema),
    narration: ProfileNarrationSchema.nullable(),
    narrationState: z.enum(["fresh", "stale", "empty"]),
    gameCount: NonNegativeIntegerSchema,
    ratedGameCount: NonNegativeIntegerSchema,
    computedAt: TimestampSchema,
  })
  .strict()
  .refine(({ gameCount, ratedGameCount }) => ratedGameCount <= gameCount, {
    message: "Rated game count cannot exceed profile game count",
    path: ["ratedGameCount"],
  })
  .superRefine((profile, context) => {
    const families = [
      ["divergence", profile.divergence ?? []],
      ["outliers", profile.outliers],
      ["suggestions", profile.suggestions],
    ] as const;
    const seenInsightIds = new Set<string>();
    const reported = new Map<
      string,
      {
        familyName: string;
        observation: string;
        interpretation: string | null;
        evidenceGameIds: Set<string>;
      }
    >();
    for (const [familyName, insights] of families) {
      for (const [insightIndex, insight] of insights.entries()) {
        if (seenInsightIds.has(insight.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [familyName, insightIndex, "id"],
            message: "Insight IDs must be unique across the profile",
          });
        }
        seenInsightIds.add(insight.id);
        if (insight.status === "reported") {
          reported.set(insight.id, {
            familyName,
            observation: insight.observation,
            interpretation: insight.interpretation,
            evidenceGameIds: new Set(insight.evidence.map(({ gameId }) => gameId)),
          });
        }
        for (const countField of [
          "eligibleGameCount",
          "includedGameCount",
          "excludedGameCount",
        ] as const) {
          if (insight.cohort[countField] > profile.gameCount) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [familyName, insightIndex, "cohort", countField],
              message: "Insight cohort count cannot exceed profile game count",
            });
          }
        }
      }
    }

    if (profile.narration === null) return;
    if (profile.narration.abstention !== null) {
      if (reported.size > 0 || profile.narration.abstention !== PROFILE_NARRATION_ABSTENTION) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["narration", "abstention"],
          message:
            "Narration may use the canonical abstention only when no reported insight exists",
        });
      }
      return;
    }
    const narrationSections = [
      ["summary", profile.narration.summary],
      ["surprises", profile.narration.surprises],
      ["tensions", profile.narration.tensions],
    ] as const;
    for (const [sectionName, claims] of narrationSections) {
      for (const [claimIndex, claim] of claims.entries()) {
        const sources = claim.evidenceReferences.map((reference, referenceIndex) => {
          const source = reported.get(reference.insightId);
          if (source === undefined) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [
                "narration",
                sectionName,
                claimIndex,
                "evidenceReferences",
                referenceIndex,
                "insightId",
              ],
              message: "Narration must reference a reported insight in this profile",
            });
            return null;
          }
          if (reference.gameIds.some((gameId) => !source.evidenceGameIds.has(gameId))) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [
                "narration",
                sectionName,
                claimIndex,
                "evidenceReferences",
                referenceIndex,
                "gameIds",
              ],
              message: "Narration game references must occur in the referenced insight evidence",
            });
          }
          if (sectionName === "tensions" && source.familyName !== "divergence") {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["narration", sectionName, claimIndex, "evidenceReferences", referenceIndex],
              message: "Narrated tensions require reported divergence evidence",
            });
          }
          return source;
        });
        if (sources.some((source) => source === null)) continue;
        const grounded = sources.filter((source) => source !== null);
        const observation = grounded.map((source) => source.observation).join(" ");
        const interpretations = grounded
          .map((source) => source.interpretation)
          .filter((interpretation): interpretation is string => interpretation !== null);
        const interpretation = interpretations.length > 0 ? interpretations.join(" ") : null;
        if (claim.observation !== observation || claim.interpretation !== interpretation) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["narration", sectionName, claimIndex],
            message: "Narration claim text must match its referenced trusted insights",
          });
        }
      }
    }
  });

export const ProfileDataSchema = z
  .object({
    contractVersion: z.literal(CURRENT_PROFILE_CONTRACT_VERSION),
    algorithmVersion: z.literal(CURRENT_PROFILE_ALGORITHM_VERSION),
    tournamentSettings: z
      .object({
        kFactorThreshold: z.number().int().min(1),
        normalizationHalfWidth: z.number().positive(),
        provisionalThreshold: z.number().int().min(0),
      })
      .strict(),
    profile: CollectionProfileSchema,
    computedAt: TimestampSchema,
    narration: ProfileNarrationSchema.nullable(),
    narrationComputedAt: TimestampSchema.nullable(),
  })
  .strict()
  .superRefine((data, context) => {
    if (data.profile.computedAt !== data.computedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", "computedAt"],
        message: "Profile timestamps must match",
      });
    }
    if ((data.narration === null) !== (data.narrationComputedAt === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["narrationComputedAt"],
        message: "Narration and its timestamp must both be present or absent",
      });
    }
    if (data.narration !== null) {
      const groundedProfile = CollectionProfileSchema.safeParse({
        ...data.profile,
        narration: data.narration,
        narrationState: "fresh",
      });
      if (!groundedProfile.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["narration"],
          message: "Persisted narration must match the persisted profile evidence",
        });
      }
    }
  });

export const RateGameSchema = z.object({
  axisId: z.string().min(1),
  rating: z.number().int("Rating must be an integer").min(1).max(10),
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
