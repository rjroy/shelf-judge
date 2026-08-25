import { z } from "zod";
import {
  AXIS_VALIDATION_CODES,
  type AxisValidationCode,
  type AxisValidationDetail,
} from "./errors";
import type {
  Axis,
  AxisBase,
  DerivedAxis,
  DerivedAxisConfigurationByField,
  DerivedAxisTemplateDiscovery,
  DerivedConfigurationPropertyDiscovery,
  DerivedFieldDiscovery,
  DerivedFieldDiscoveryResponse,
  DerivedFieldId,
  DerivedValueResolution,
  EmptyDerivedAxisConfiguration,
  EnabledAxis,
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

export interface DerivedSuggestionAnalysis {
  attribute: string;
  projectValue: (game: Game) => number | null;
}

export interface DerivedSuggestionProjection extends DerivedSuggestionAnalysis {
  derivedField: DerivedFieldId;
}

export interface DerivedFieldDefinition<Configuration> {
  id: DerivedFieldId;
  includedInFreshCollection: boolean;
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
  suggestionAnalysis: DerivedSuggestionAnalysis | null;
  templateDefaults: DerivedAxisTemplateDefaults<Configuration>;
  summarizeConfiguration: (configuration: Configuration) => string;
}

type DerivedAxisPayloadFor<Field extends DerivedFieldId> = {
  derivedField: Field;
  configuration: DerivedAxisConfigurationByField[Field];
};

export type DerivedAxisPayloadByField = {
  [Field in DerivedFieldId]: DerivedAxisPayloadFor<Field>;
};

export type DerivedAxisPayload = DerivedAxisPayloadByField[DerivedFieldId];

interface RuntimeDerivedFieldDefinition<
  Field extends DerivedFieldId,
  Configuration,
> extends DerivedFieldDefinition<Configuration> {
  id: Field;
  parseConfigurationPayload: (
    configuration: unknown,
  ) =>
    | { success: true; data: DerivedAxisPayloadFor<Field> }
    | { success: false; error: z.ZodError };
  nativeScaleFromUnknown: (configuration: unknown) => NativeScale;
  resolveFromUnknown: (game: Game, configuration: unknown) => DerivedValueResolution | null;
  summarizeConfigurationFromUnknown: (configuration: unknown) => string;
  createAxisFromUnknown: (
    base: AxisBase,
    configuration: unknown,
  ) => AxisBase & {
    source: "derived";
    derivedField: Field;
    configuration: DerivedAxisConfigurationByField[Field];
  };
}

interface DerivedFieldDefinitionInput<
  Field extends DerivedFieldId,
  Configuration,
> extends DerivedFieldDefinition<Configuration> {
  id: Field;
}

function defineDerivedField<Field extends DerivedFieldId>(
  definition: DerivedFieldDefinitionInput<Field, DerivedAxisConfigurationByField[Field]>,
): RuntimeDerivedFieldDefinition<Field, DerivedAxisConfigurationByField[Field]> {
  type Configuration = DerivedAxisConfigurationByField[Field];
  const parseConfiguration = (configuration: unknown): Configuration =>
    definition.configurationSchema.parse(configuration);
  return {
    ...definition,
    parseConfigurationPayload: (configuration) => {
      const parsed = definition.configurationSchema.safeParse(configuration);
      return parsed.success
        ? {
            success: true,
            data: { derivedField: definition.id, configuration: parsed.data },
          }
        : parsed;
    },
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
    createAxisFromUnknown: (base, configuration) => ({
      ...base,
      source: "derived",
      derivedField: definition.id,
      configuration: parseConfiguration(configuration),
    }),
  };
}

export type DerivedAxisRegistry = {
  [Field in DerivedFieldId]: RuntimeDerivedFieldDefinition<
    Field,
    DerivedAxisConfigurationByField[Field]
  >;
};

const noConfigurationSchema: z.ZodType<EmptyDerivedAxisConfiguration> = z.object({}).strict();
const targetPlayerCountSchema = z
  .object({ targetPlayerCount: z.number().int().min(1).max(100) })
  .strict();
const playingTimeConfigurationSchema = z
  .object({ maximumScoringTime: z.number().int().min(60).max(1440) })
  .strict();

function projectCommunityRating(game: Game): number | null {
  return game.bggData?.communityRating ?? null;
}

function projectWeight(game: Game): number | null {
  return game.bggData?.weight ?? null;
}

function projectPlayerCountMean(game: Game): number | null {
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
  return (maximum + minimum) / 2;
}

function projectBestPlayerCount(game: Game): number | null {
  const best = game.bestPlayers;
  return best != null && Number.isFinite(best) && best > 0 ? best : projectPlayerCountMean(game);
}

function projectPlayingTime(game: Game): number | null {
  const value = game.playingTime;
  return value == null || !Number.isFinite(value) || value <= 0 ? null : value;
}

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
  const unsupportedPayloadKey = Object.keys(value).find(
    (key) => key !== "derivedField" && key !== "configuration",
  );
  if (unsupportedPayloadKey !== undefined) {
    return {
      success: false,
      code: AXIS_VALIDATION_CODES.INVALID_AXIS_PAYLOAD,
      detail: { field: unsupportedPayloadKey, path: [unsupportedPayloadKey] },
      message: `Unsupported derived axis payload property: ${unsupportedPayloadKey}`,
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

  const parsed = definition.parseConfigurationPayload(configuration);
  if (parsed.success) return { success: true, data: parsed.data };

  const field = validation.field ?? "configuration";
  return {
    success: false,
    code: validation.invalidCode,
    detail: { field, path: ["configuration", ...(validation.field === null ? [] : [field])] },
    message: parsed.error.message,
  };
}

export function createDerivedAxisFromPayload<Field extends DerivedFieldId>(
  base: AxisBase,
  payload: DerivedAxisPayloadByField[Field],
): DerivedAxis<Field>;
export function createDerivedAxisFromPayload(
  base: AxisBase,
  payload: DerivedAxisPayload,
): DerivedAxis {
  return DERIVED_AXIS_REGISTRY[payload.derivedField].createAxisFromUnknown(
    base,
    payload.configuration,
  );
}

export const DERIVED_AXIS_REGISTRY = {
  communityRating: defineDerivedField({
    id: "communityRating",
    includedInFreshCollection: true,
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
      const value = projectCommunityRating(game);
      return value == null ? null : { sourceValue: value, scoringRawValue: value };
    },
    suggestionAnalysis: {
      attribute: "community rating",
      projectValue: projectCommunityRating,
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
    includedInFreshCollection: true,
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
      const value = projectWeight(game);
      return value == null ? null : { sourceValue: value, scoringRawValue: value };
    },
    suggestionAnalysis: {
      attribute: "BGG weight",
      projectValue: projectWeight,
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
    includedInFreshCollection: false,
    label: "Player Count Fit",
    description:
      "Scores a target player count using BGG suggested-player-count poll data, falling back to publisher bounds.",
    provenance: "BoardGameGeek suggested-player-count poll with publisher-declared bounds fallback",
    unit: "fit score",
    missingValuePolicy:
      "Falls back to publisher bounds when poll data is unavailable; missing only when neither source is valid.",
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
      const target = configuration.targetPlayerCount;
      const best = game.bestPlayers;
      if (best != null && Number.isFinite(best) && best > 0) {
        // Best might be multiple votes, so consider it a valid range.
        const minBest = Math.floor(best);
        const maxBest = Math.ceil(best);
        const penalty = 2 * Math.min(Math.abs(target - minBest), Math.abs(target - maxBest));
        const value = Math.min(10, Math.max(1, 10 - penalty));
        return { sourceValue: value, scoringRawValue: value };
      }
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
      const penalty =
        target >= minimum && target <= maximum
          ? Math.max(target - minimum, maximum - target)
          : Math.abs(target - minimum) + Math.abs(target - maximum);
      const value = Math.min(10, Math.max(1, 10 - penalty));
      return { sourceValue: value, scoringRawValue: value };
    },
    suggestionAnalysis: {
      attribute: "best player count or publisher range midpoint",
      projectValue: projectBestPlayerCount,
    },
    templateDefaults: {
      name: "Player Count Fit",
      description:
        "Scores a target player count using BGG suggested-player-count poll data, falling back to publisher bounds.",
      weight: 50,
      preferenceShape: "higher-is-better",
      configuration: {},
    },
    summarizeConfiguration: ({ targetPlayerCount }) =>
      `Target: ${targetPlayerCount} ${targetPlayerCount === 1 ? "player" : "players"}`,
  }),
  playingTime: defineDerivedField({
    id: "playingTime",
    includedInFreshCollection: false,
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
      const value = projectPlayingTime(game);
      if (value === null) return null;
      return { sourceValue: value, scoringRawValue: Math.min(value, maximumScoringTime) };
    },
    suggestionAnalysis: {
      attribute: "play time",
      projectValue: projectPlayingTime,
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

export const DerivedAxisPayloadSchema: z.ZodType<DerivedAxisPayload> = z.custom<DerivedAxisPayload>(
  (value): value is DerivedAxisPayload => validateDerivedAxisPayload(value).success,
  "Invalid derived axis payload",
);

export function createFreshCollectionDerivedAxes(
  createId: () => string,
  timestamp: string,
): DerivedAxis[] {
  return Object.values(DERIVED_AXIS_REGISTRY)
    .filter((definition) => definition.includedInFreshCollection)
    .map((definition) => {
      const template = definition.templateDefaults;
      const payload = DerivedAxisPayloadSchema.parse({
        derivedField: definition.id,
        configuration: template.configuration,
      });
      return createDerivedAxisFromPayload(
        {
          id: createId(),
          name: template.name,
          description: template.description,
          weight: template.weight,
          enabled: true,
          preferenceShape: template.preferenceShape,
          ...(template.idealValue === undefined ? {} : { idealValue: template.idealValue }),
          ...(template.toleranceWidth === undefined
            ? {}
            : { toleranceWidth: template.toleranceWidth }),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        payload,
      );
    });
}

export function resolveDerivedAxisValue<Field extends DerivedFieldId>(
  axis: DerivedAxis<Field>,
  game: Game,
): DerivedValueResolution | null {
  const definition = DERIVED_AXIS_REGISTRY[axis.derivedField];
  return definition.resolveFromUnknown(game, axis.configuration);
}

export function getDerivedSuggestionProjections(): DerivedSuggestionProjection[] {
  return Object.values(DERIVED_AXIS_REGISTRY).flatMap((definition) => {
    const analysis = definition.suggestionAnalysis;
    return analysis === null
      ? []
      : [
          {
            derivedField: definition.id,
            attribute: analysis.attribute,
            projectValue: analysis.projectValue,
          },
        ];
  });
}

export function getAxisNativeScale(axis: EnabledAxis): NativeScale {
  if (axis.source !== "derived") return { min: 1, max: 10 };
  return getDerivedAxisNativeScale(axis);
}

export function getDerivedAxisNativeScale<Field extends DerivedFieldId>(
  axis: DerivedAxis<Field>,
): NativeScale {
  return DERIVED_AXIS_REGISTRY[axis.derivedField].nativeScaleFromUnknown(axis.configuration);
}

export function isEnabledScoringAxis(axis: Axis): axis is EnabledAxis {
  return axis.enabled;
}

export function isVectorEligibleAxis(axis: Axis): axis is PersonalAxis | TournamentAxis {
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
    configuration: { ...template.configuration },
  };
}

function serializeNativeScaleDiscovery(
  discovery: NativeScaleDiscovery<string>,
): NativeScaleDiscovery {
  return discovery.type === "fixed"
    ? { type: "fixed", min: discovery.min, max: discovery.max }
    : {
        type: "configuration-bound",
        min: discovery.min,
        maxConfigurationProperty: discovery.maxConfigurationProperty,
      };
}

function serializeConfigurationProperty(
  property: DerivedConfigurationPropertyDiscovery,
): DerivedConfigurationPropertyDiscovery {
  return {
    name: property.name,
    type: property.type,
    required: property.required,
    minimum: property.minimum,
    maximum: property.maximum,
    ...(property.default === undefined ? {} : { default: property.default }),
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
      nativeScaleDiscovery: serializeNativeScaleDiscovery(definition.nativeScaleDiscovery),
      nativeScale: {
        min: definition.defaultNativeScale.min,
        max: definition.defaultNativeScale.max,
      },
      configuration: definition.configurationDiscovery.map(serializeConfigurationProperty),
      template: serializeTemplate(definition.templateDefaults),
    }),
  );
  return { version: 1, fields };
}
