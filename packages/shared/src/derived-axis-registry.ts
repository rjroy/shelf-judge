import { z } from "zod";
import {
  AXIS_VALIDATION_CODES,
  type AxisValidationCode,
  type AxisValidationDetail,
} from "./errors";
import type {
  CurrentAxis,
  CurrentAxisBase,
  DerivedAxis,
  DerivedAxisConfigurationByField,
  DerivedAxisTemplateDiscovery,
  DerivedConfigurationPropertyDiscovery,
  DerivedFieldDiscovery,
  DerivedFieldDiscoveryResponse,
  DerivedFieldId,
  DerivedValueResolution,
  EmptyDerivedAxisConfiguration,
  EnabledCurrentAxis,
  Game,
  NativeScale,
  NativeScaleDiscovery,
  PersonalAxis,
  PreferenceShape,
  TournamentAxis,
} from "./types";

export interface DerivedAxisTemplateDefaults<Configuration> {
  name: string;
  description: string;
  weight: number;
  preferenceShape: PreferenceShape;
  idealValue?: number;
  toleranceWidth?: number;
  configuration: Partial<Configuration>;
}

export interface DerivedFieldDefinition<Configuration> {
  id: DerivedFieldId;
  label: string;
  description: string;
  provenance: string;
  unit: string;
  missingValuePolicy: string;
  configurationSchema: z.ZodType<Configuration>;
  configurationValidation: {
    field: Extract<keyof Configuration, string> | null;
    invalidCode: AxisValidationCode;
  };
  configurationDiscovery: readonly DerivedConfigurationPropertyDiscovery[];
  nativeScaleDiscovery: NativeScaleDiscovery<Extract<keyof Configuration, string>>;
  defaultNativeScale: NativeScale;
  nativeScale: (configuration: Configuration) => NativeScale;
  resolve: (game: Game, configuration: Configuration) => DerivedValueResolution | null;
  templateDefaults: DerivedAxisTemplateDefaults<Configuration>;
  summarizeConfiguration: (configuration: Configuration) => string;
}

interface RuntimeDerivedFieldDefinition<
  Configuration,
> extends DerivedFieldDefinition<Configuration> {
  nativeScaleFromUnknown: (configuration: unknown) => NativeScale;
  resolveFromUnknown: (game: Game, configuration: unknown) => DerivedValueResolution | null;
  summarizeConfigurationFromUnknown: (configuration: unknown) => string;
}

interface DerivedFieldDefinitionInput<
  Field extends DerivedFieldId,
  Configuration,
> extends DerivedFieldDefinition<Configuration> {
  id: Field;
}

function defineDerivedField<Field extends DerivedFieldId, Configuration>(
  definition: DerivedFieldDefinitionInput<Field, Configuration>,
): RuntimeDerivedFieldDefinition<Configuration> & { id: Field } {
  const parseConfiguration = (configuration: unknown): Configuration =>
    definition.configurationSchema.parse(configuration);

  return {
    ...definition,
    nativeScale: (configuration) => definition.nativeScale(parseConfiguration(configuration)),
    resolve: (game, configuration) => definition.resolve(game, parseConfiguration(configuration)),
    summarizeConfiguration: (configuration) =>
      definition.summarizeConfiguration(parseConfiguration(configuration)),
    nativeScaleFromUnknown: (configuration) =>
      definition.nativeScale(parseConfiguration(configuration)),
    resolveFromUnknown: (game, configuration) =>
      definition.resolve(game, parseConfiguration(configuration)),
    summarizeConfigurationFromUnknown: (configuration) =>
      definition.summarizeConfiguration(parseConfiguration(configuration)),
  };
}

export type DerivedAxisRegistry = {
  [Field in DerivedFieldId]: RuntimeDerivedFieldDefinition<
    DerivedAxisConfigurationByField[Field]
  > & { id: Field };
};

const noConfigurationSchema: z.ZodType<EmptyDerivedAxisConfiguration> = z.object({}).strict();
const targetPlayerCountSchema = z
  .object({ targetPlayerCount: z.number().int().min(1).max(100) })
  .strict();
const playingTimeConfigurationSchema = z
  .object({ maximumScoringTime: z.number().int().min(60).max(1440) })
  .strict();

export const DerivedAxisPayloadSchema = z.discriminatedUnion("derivedField", [
  z
    .object({
      derivedField: z.literal("communityRating"),
      configuration: noConfigurationSchema,
    })
    .strict(),
  z
    .object({
      derivedField: z.literal("weight"),
      configuration: noConfigurationSchema,
    })
    .strict(),
  z
    .object({
      derivedField: z.literal("playerCountFit"),
      configuration: targetPlayerCountSchema,
    })
    .strict(),
  z
    .object({
      derivedField: z.literal("playingTime"),
      configuration: playingTimeConfigurationSchema,
    })
    .strict(),
]);

export const DerivedAxisConfigurationSchema = z.union([
  noConfigurationSchema,
  targetPlayerCountSchema,
  playingTimeConfigurationSchema,
]);

export type DerivedAxisPayload = z.output<typeof DerivedAxisPayloadSchema>;

export type DerivedAxisPayloadValidationResult =
  | { success: true; data: DerivedAxisPayload }
  | {
      success: false;
      code: AxisValidationCode;
      detail: AxisValidationDetail;
      message: string;
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDerivedFieldId(value: unknown): value is DerivedFieldId {
  return typeof value === "string" && Object.hasOwn(DERIVED_AXIS_REGISTRY, value);
}

interface LocatedZodIssue {
  issue: z.ZodIssue;
  path: (string | number)[];
}

function locateZodIssue(issue: z.ZodIssue): LocatedZodIssue[] {
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    return issue.keys.map((key) => ({ issue, path: [...issue.path, key] }));
  }
  return [{ issue, path: issue.path }];
}

export function validateDerivedAxisPayload(value: unknown): DerivedAxisPayloadValidationResult {
  if (!isObject(value) || !isDerivedFieldId(value.derivedField)) {
    return {
      success: false,
      code: AXIS_VALIDATION_CODES.UNKNOWN_DERIVED_FIELD,
      detail: { field: "derivedField", path: ["derivedField"] },
      message: "Derived field is not registered",
    };
  }
  if (!Object.hasOwn(value, "configuration")) {
    return {
      success: false,
      code: AXIS_VALIDATION_CODES.MISSING_DERIVED_CONFIGURATION,
      detail: { field: "configuration", path: ["configuration"] },
      message: "Derived configuration is required",
    };
  }

  const definition = DERIVED_AXIS_REGISTRY[value.derivedField];
  const validation = definition.configurationValidation;
  const configuration = value.configuration;
  const parsed = DerivedAxisPayloadSchema.safeParse(value);
  if (parsed.success) return parsed;

  const payloadIssue = parsed.error.issues
    .flatMap(locateZodIssue)
    .find(({ path }) => path[0] !== "configuration");
  if (payloadIssue !== undefined) {
    return {
      success: false,
      code: AXIS_VALIDATION_CODES.INVALID_AXIS_PAYLOAD,
      detail: {
        field: String(payloadIssue.path.at(-1) ?? "payload"),
        path: payloadIssue.path,
      },
      message: payloadIssue.issue.message,
    };
  }

  if (!isObject(configuration)) {
    return {
      success: false,
      code:
        validation.field === null
          ? AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION
          : AXIS_VALIDATION_CODES.MISSING_DERIVED_CONFIGURATION,
      detail: { field: "configuration", path: ["configuration"] },
      message: "Derived configuration must be an object",
    };
  }

  const unsupportedKey = Object.keys(configuration).find((key) => key !== validation.field);
  if (unsupportedKey !== undefined) {
    return {
      success: false,
      code: AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
      detail: { field: "configuration", path: ["configuration", unsupportedKey] },
      message: `Unsupported derived configuration property: ${unsupportedKey}`,
    };
  }
  if (validation.field !== null && !Object.hasOwn(configuration, validation.field)) {
    return {
      success: false,
      code: AXIS_VALIDATION_CODES.MISSING_DERIVED_CONFIGURATION,
      detail: { field: validation.field, path: ["configuration", validation.field] },
      message: `Missing derived configuration property: ${validation.field}`,
    };
  }

  const field = validation.field ?? "configuration";
  return {
    success: false,
    code: validation.invalidCode,
    detail: { field, path: ["configuration", ...(validation.field === null ? [] : [field])] },
    message: parsed.error.message,
  };
}

export function createDerivedAxisFromPayload(
  base: CurrentAxisBase,
  payload: DerivedAxisPayload,
): DerivedAxis {
  switch (payload.derivedField) {
    case "communityRating":
    case "weight":
    case "playerCountFit":
    case "playingTime":
      return { ...base, source: "derived", ...payload };
  }
}

export const DERIVED_AXIS_REGISTRY = {
  communityRating: defineDerivedField({
    id: "communityRating",
    label: "Community Rating",
    description: "BGG community average rating",
    provenance: "BoardGameGeek community average rating",
    unit: "rating",
    missingValuePolicy: "Missing when BoardGameGeek data is unavailable.",
    configurationSchema: noConfigurationSchema,
    configurationValidation: {
      field: null,
      invalidCode: AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
    },
    configurationDiscovery: [],
    nativeScaleDiscovery: { type: "fixed", min: 1, max: 10 },
    defaultNativeScale: { min: 1, max: 10 },
    nativeScale: () => ({ min: 1, max: 10 }),
    resolve: (game) => {
      const value = game.bggData?.communityRating;
      return value == null ? null : { sourceValue: value, scoringRawValue: value };
    },
    templateDefaults: {
      name: "Community Rating",
      description: "BGG community average rating",
      weight: 50,
      preferenceShape: "higher-is-better",
      configuration: {},
    },
    summarizeConfiguration: () => "No configuration",
  }),
  weight: defineDerivedField({
    id: "weight",
    label: "Complexity",
    description: "BGG weight normalized to 1-10 scale",
    provenance: "BoardGameGeek community weight rating",
    unit: "weight",
    missingValuePolicy: "Missing when BoardGameGeek weight is unavailable.",
    configurationSchema: noConfigurationSchema,
    configurationValidation: {
      field: null,
      invalidCode: AXIS_VALIDATION_CODES.UNSUPPORTED_DERIVED_CONFIGURATION,
    },
    configurationDiscovery: [],
    nativeScaleDiscovery: { type: "fixed", min: 1, max: 5 },
    defaultNativeScale: { min: 1, max: 5 },
    nativeScale: () => ({ min: 1, max: 5 }),
    resolve: (game) => {
      const value = game.bggData?.weight;
      return value == null ? null : { sourceValue: value, scoringRawValue: value };
    },
    templateDefaults: {
      name: "Complexity",
      description: "BGG weight normalized to 1-10 scale",
      weight: 50,
      preferenceShape: "higher-is-better",
      configuration: {},
    },
    summarizeConfiguration: () => "No configuration",
  }),
  playerCountFit: defineDerivedField({
    id: "playerCountFit",
    label: "Player Count Fit",
    description: "Checks a target player count against the publisher-declared player range.",
    provenance: "Publisher-declared minimum and maximum player count",
    unit: "fit score",
    missingValuePolicy:
      "Missing when publisher player bounds are absent, nonfinite, nonpositive, or reversed.",
    configurationSchema: targetPlayerCountSchema,
    configurationValidation: {
      field: "targetPlayerCount",
      invalidCode: AXIS_VALIDATION_CODES.INVALID_TARGET_PLAYER_COUNT,
    },
    configurationDiscovery: [
      {
        name: "targetPlayerCount",
        type: "integer",
        required: true,
        minimum: 1,
        maximum: 100,
      },
    ],
    nativeScaleDiscovery: { type: "fixed", min: 1, max: 10 },
    defaultNativeScale: { min: 1, max: 10 },
    nativeScale: () => ({ min: 1, max: 10 }),
    resolve: (game, configuration) => {
      const minimum = game.minPlayers;
      const maximum = game.maxPlayers;
      if (
        minimum == null ||
        maximum == null ||
        !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) ||
        minimum <= 0 ||
        maximum <= 0 ||
        minimum > maximum
      ) {
        return null;
      }
      const value =
        configuration.targetPlayerCount >= minimum && configuration.targetPlayerCount <= maximum
          ? 10
          : 1;
      return { sourceValue: value, scoringRawValue: value };
    },
    templateDefaults: {
      name: "Player Count Fit",
      description: "Checks a target player count against the publisher-declared player range.",
      weight: 50,
      preferenceShape: "higher-is-better",
      configuration: {},
    },
    summarizeConfiguration: ({ targetPlayerCount }) =>
      `Target: ${targetPlayerCount} ${targetPlayerCount === 1 ? "player" : "players"}`,
  }),
  playingTime: defineDerivedField({
    id: "playingTime",
    label: "Play Time",
    description: "Scores publisher-listed playing time against your preferred duration.",
    provenance: "Publisher-listed playing time imported from BoardGameGeek",
    unit: "minutes",
    missingValuePolicy: "Missing when publisher playing time is absent, nonfinite, or nonpositive.",
    configurationSchema: playingTimeConfigurationSchema,
    configurationValidation: {
      field: "maximumScoringTime",
      invalidCode: AXIS_VALIDATION_CODES.INVALID_MAXIMUM_SCORING_TIME,
    },
    configurationDiscovery: [
      {
        name: "maximumScoringTime",
        type: "integer",
        required: true,
        minimum: 60,
        maximum: 1440,
        default: 240,
      },
    ],
    nativeScaleDiscovery: {
      type: "configuration-bound",
      min: 1,
      maxConfigurationProperty: "maximumScoringTime",
    },
    defaultNativeScale: { min: 1, max: 240 },
    nativeScale: ({ maximumScoringTime }) => ({ min: 1, max: maximumScoringTime }),
    resolve: (game, { maximumScoringTime }) => {
      const value = game.playingTime;
      if (value == null || !Number.isFinite(value) || value <= 0) return null;
      return { sourceValue: value, scoringRawValue: Math.min(value, maximumScoringTime) };
    },
    templateDefaults: {
      name: "Play Time",
      description: "Scores publisher-listed playing time against your preferred duration.",
      weight: 50,
      preferenceShape: "sweet-spot",
      idealValue: 90,
      toleranceWidth: 30,
      configuration: { maximumScoringTime: 240 },
    },
    summarizeConfiguration: ({ maximumScoringTime }) =>
      `Scoring cap: ${maximumScoringTime} minutes`,
  }),
} satisfies DerivedAxisRegistry;

export function resolveDerivedAxisValue<Field extends DerivedFieldId>(
  axis: DerivedAxis<Field>,
  game: Game,
): DerivedValueResolution | null {
  const definition = DERIVED_AXIS_REGISTRY[axis.derivedField];
  return definition.resolveFromUnknown(game, axis.configuration);
}

export function getCurrentAxisNativeScale(axis: EnabledCurrentAxis): NativeScale {
  if (axis.source !== "derived") return { min: 1, max: 10 };
  return getDerivedAxisNativeScale(axis);
}

export function getDerivedAxisNativeScale<Field extends DerivedFieldId>(
  axis: DerivedAxis<Field>,
): NativeScale {
  return DERIVED_AXIS_REGISTRY[axis.derivedField].nativeScaleFromUnknown(axis.configuration);
}

export function isEnabledScoringAxis(axis: CurrentAxis): axis is EnabledCurrentAxis {
  return axis.enabled;
}

export function isVectorEligibleAxis(axis: CurrentAxis): axis is PersonalAxis | TournamentAxis {
  return axis.enabled && (axis.source === "personal" || axis.source === "tournament");
}

export function summarizeDerivedAxisConfiguration<Field extends DerivedFieldId>(
  axis: DerivedAxis<Field>,
): string {
  return DERIVED_AXIS_REGISTRY[axis.derivedField].summarizeConfigurationFromUnknown(
    axis.configuration,
  );
}

function serializeTemplate(
  template: DerivedAxisTemplateDefaults<DerivedAxisConfigurationByField[DerivedFieldId]>,
): DerivedAxisTemplateDiscovery {
  return {
    name: template.name,
    description: template.description,
    weight: template.weight,
    preferenceShape: template.preferenceShape,
    ...(template.idealValue === undefined ? {} : { idealValue: template.idealValue }),
    ...(template.toleranceWidth === undefined ? {} : { toleranceWidth: template.toleranceWidth }),
    configuration: template.configuration,
  };
}

export function getDerivedFieldDiscovery(): DerivedFieldDiscoveryResponse {
  const fields: DerivedFieldDiscovery[] = Object.values(DERIVED_AXIS_REGISTRY).map(
    (definition) => ({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      provenance: definition.provenance,
      unit: definition.unit,
      missingValuePolicy: definition.missingValuePolicy,
      nativeScaleDiscovery: definition.nativeScaleDiscovery,
      nativeScale: definition.defaultNativeScale,
      configuration: [...definition.configurationDiscovery],
      template: serializeTemplate(definition.templateDefaults),
    }),
  );
  return { version: 1, fields };
}
