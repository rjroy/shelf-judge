import {
  GroundedProviderConfigurationStatusSchema,
  GroundedProviderIdentitySchema,
  GroundedUsageUnavailableSchema,
  PositiveSafeIntegerStringSchema,
  REFLECTION_EVIDENCE_CLASSES,
  REFLECTION_QUESTION_ABSTENTION_REASONS,
  REFLECTION_QUESTION_IDS,
  ReflectionBlockSchema,
  ReflectionCacheStateSchema,
  ReflectionCitationSchema,
  ReflectionCompletedSchema,
  ReflectionDestinationSchema,
  ReflectionGetResultSchema,
  ReflectionOperationResultSchema,
  ReflectionProviderUsageSchema,
  ReflectionQuestionStateCollectionSchema,
  ReflectionQuestionStateSchema,
  ReflectionScopeSchema,
  ReflectionSettingsSchema,
  ReflectionStreamEventSchema,
} from "@shelf-judge/shared";
import { z } from "zod";
import type { OperationJsonValue } from "../operations.js";

type JsonSchema = { [key: string]: OperationJsonValue };
type Projection = (schema: JsonSchema) => JsonSchema;

const definitionEntries = [
  ["GroundedProviderConfigurationStatus", GroundedProviderConfigurationStatusSchema],
  ["GroundedProviderIdentity", GroundedProviderIdentitySchema],
  ["GroundedUsageUnavailable", GroundedUsageUnavailableSchema],
  ["PositiveSafeIntegerString", PositiveSafeIntegerStringSchema],
  ["ReflectionBlock", ReflectionBlockSchema],
  ["ReflectionCacheState", ReflectionCacheStateSchema],
  ["ReflectionCitation", ReflectionCitationSchema],
  ["ReflectionCompleted", ReflectionCompletedSchema],
  ["ReflectionDestination", ReflectionDestinationSchema],
  ["ReflectionGetResult", ReflectionGetResultSchema],
  ["ReflectionOperationResult", ReflectionOperationResultSchema],
  ["ReflectionProviderUsage", ReflectionProviderUsageSchema],
  ["ReflectionQuestionState", ReflectionQuestionStateSchema],
  ["ReflectionQuestionStateCollection", ReflectionQuestionStateCollectionSchema],
  ["ReflectionScope", ReflectionScopeSchema],
  ["ReflectionSettings", ReflectionSettingsSchema],
  ["ReflectionStreamEvent", ReflectionStreamEventSchema],
] as const;

const definitionNames = new Map<z.ZodTypeAny, string>(
  definitionEntries.map(([name, schema]) => [schema, name]),
);

const strictObject = (
  required: string[],
  properties: Record<string, OperationJsonValue>,
): JsonSchema => ({ type: "object", additionalProperties: false, required, properties });

const propertyEquals = (path: string[], value: OperationJsonValue): JsonSchema => {
  let schema: JsonSchema = { const: value };
  for (const property of path.toReversed()) {
    schema = { type: "object", required: [property], properties: { [property]: schema } };
  }
  return schema;
};

const condition = (ifSchema: JsonSchema, thenSchema: JsonSchema, elseSchema?: JsonSchema) => ({
  if: ifSchema,
  then: thenSchema,
  ...(elseSchema === undefined ? {} : { else: elseSchema }),
});

function withConstraints(schema: JsonSchema, constraints: JsonSchema[]): JsonSchema {
  return constraints.length === 0 ? schema : { allOf: [schema, ...constraints] };
}

function questionResultIdentity(questionId: (typeof REFLECTION_QUESTION_IDS)[number]): JsonSchema {
  return propertyEquals(["evidenceIdentity", "questionId"], questionId);
}

const projections = new Map<z.ZodTypeAny, Projection>([
  [
    PositiveSafeIntegerStringSchema,
    (schema) => ({
      ...schema,
      pattern:
        "^(?:[1-9]\\d{0,14}|[1-8]\\d{15}|900[0-6]\\d{12}|90070\\d{11}|90071[0-8]\\d{10}|900719[0-8]\\d{9}|9007199[01]\\d{8}|90071992[0-4]\\d{7}|900719925[0-3]\\d{6}|9007199254[0-6]\\d{5}|90071992547[0-3]\\d{4}|9007199254740[0-8]\\d{2}|90071992547409[0-8]\\d|900719925474099[01])$",
    }),
  ],
  [
    GroundedProviderIdentitySchema,
    (schema) =>
      withConstraints(schema, [
        { properties: { extensionIds: { type: "array", uniqueItems: true } } },
      ]),
  ],
  [
    ReflectionProviderUsageSchema,
    (schema) =>
      withConstraints(schema, [{ properties: { inferenceRoundTrips: { enum: [1, 2] } } }]),
  ],
  [
    ReflectionScopeSchema,
    (schema) =>
      withConstraints(schema, [
        { properties: { patternCandidateIds: { type: "array", uniqueItems: true } } },
      ]),
  ],
  [
    ReflectionBlockSchema,
    (schema) =>
      withConstraints(schema, [
        { properties: { citationIds: { type: "array", uniqueItems: true } } },
      ]),
  ],
  [
    ReflectionCompletedSchema,
    (schema) => {
      const constraints: JsonSchema[] = [
        {
          properties: {
            citations: { type: "array", uniqueItems: true },
            dependencies: { type: "array", uniqueItems: true },
          },
        },
        ...REFLECTION_QUESTION_IDS.map((questionId) =>
          condition(
            propertyEquals(["evidenceIdentity", "questionId"], questionId),
            withConstraints(
              {
                properties: {
                  citations: {
                    type: "array",
                    items: {
                      properties: {
                        evidenceClass: {
                          enum: [
                            ...(questionId === "pattern-exceptions"
                              ? REFLECTION_EVIDENCE_CLASSES
                              : REFLECTION_EVIDENCE_CLASSES.filter(
                                  (evidenceClass) => evidenceClass !== "profile-evidence",
                                )),
                          ],
                        },
                      },
                    },
                  },
                },
              },
              [
                condition(propertyEquals(["outcome"], "abstained"), {
                  properties: {
                    reason: { enum: [...REFLECTION_QUESTION_ABSTENTION_REASONS[questionId]] },
                  },
                }),
              ],
            ),
          ),
        ),
      ];
      constraints.push(
        condition(
          propertyEquals(["evidenceIdentity", "questionId"], "pattern-exceptions"),
          { properties: { scope: { required: ["patternCandidateIds"] } } },
          { properties: { scope: { not: { required: ["patternCandidateIds"] } } } },
        ),
      );
      return withConstraints(schema, constraints);
    },
  ],
  [
    ReflectionCacheStateSchema,
    (schema) =>
      withConstraints(schema, [
        { properties: { changedCategories: { type: "array", uniqueItems: true } } },
      ]),
  ],
  [
    ReflectionQuestionStateSchema,
    (schema) => {
      const constraints: JsonSchema[] = [
        condition(propertyEquals(["enabled"], false), {
          properties: {
            cache: propertyEquals(["state"], "none"),
            attempt: propertyEquals(["state"], "idle"),
          },
        }),
        condition(propertyEquals(["attempt", "state"], "purged"), {
          properties: { cache: propertyEquals(["state"], "none") },
        }),
      ];
      for (const questionId of REFLECTION_QUESTION_IDS) {
        constraints.push(
          condition(propertyEquals(["questionId"], questionId), {
            properties: {
              cache: {
                properties: { result: questionResultIdentity(questionId) },
              },
            },
          }),
        );
      }
      return withConstraints(schema, constraints);
    },
  ],
  [
    ReflectionQuestionStateCollectionSchema,
    (schema) =>
      withConstraints(schema, [
        {
          items: REFLECTION_QUESTION_IDS.map((questionId) =>
            withConstraints({ $ref: "#/definitions/ReflectionQuestionState" }, [
              propertyEquals(["questionId"], questionId),
            ]),
          ),
        },
      ]),
  ],
  [
    ReflectionGetResultSchema,
    (schema) => {
      const settingsParity = Array.from(
        { length: 2 ** REFLECTION_QUESTION_IDS.length },
        (_, mask) => ({
          properties: {
            settings: {
              properties: {
                questions: {
                  items: REFLECTION_QUESTION_IDS.map((_questionId, index) => ({
                    properties: { enabled: { const: (mask & (1 << index)) !== 0 } },
                  })),
                },
              },
            },
            questions: {
              items: REFLECTION_QUESTION_IDS.map((_questionId, index) => ({
                properties: { enabled: { const: (mask & (1 << index)) !== 0 } },
              })),
            },
          },
        }),
      );
      return withConstraints(schema, [{ anyOf: settingsParity }]);
    },
  ],
  [
    ReflectionStreamEventSchema,
    (schema) => {
      const canonicalQuestionSelections = Array.from(
        { length: 2 ** REFLECTION_QUESTION_IDS.length - 1 },
        (_, selection) =>
          REFLECTION_QUESTION_IDS.filter(
            (_questionId, index) => ((selection + 1) & (1 << index)) !== 0,
          ),
      );
      const constraints: JsonSchema[] = [
        condition(propertyEquals(["type"], "accepted"), {
          properties: { questionIds: { enum: canonicalQuestionSelections } },
        }),
      ];
      for (const questionId of REFLECTION_QUESTION_IDS) {
        constraints.push(
          condition(
            withConstraints(propertyEquals(["type"], "validated-result"), [
              propertyEquals(["questionId"], questionId),
            ]),
            { properties: { result: questionResultIdentity(questionId) } },
          ),
        );
      }
      return withConstraints(schema, constraints);
    },
  ],
]);

function zodToJsonSchema(schema: z.ZodTypeAny, currentDefinition?: z.ZodTypeAny): JsonSchema {
  const definitionName = definitionNames.get(schema);
  if (definitionName !== undefined && schema !== currentDefinition) {
    return { $ref: `#/definitions/${definitionName}` };
  }

  let converted: JsonSchema;
  if (schema instanceof z.ZodEffects) {
    const effectSchema = schema as z.ZodEffects<z.ZodTypeAny>;
    converted = zodToJsonSchema(effectSchema.innerType(), currentDefinition);
  } else if (schema instanceof z.ZodOptional) {
    const optionalSchema = schema as z.ZodOptional<z.ZodTypeAny>;
    converted = zodToJsonSchema(optionalSchema.unwrap(), currentDefinition);
  } else if (schema instanceof z.ZodNullable) {
    const nullableSchema = schema as z.ZodNullable<z.ZodTypeAny>;
    converted = {
      anyOf: [zodToJsonSchema(nullableSchema.unwrap(), currentDefinition), { type: "null" }],
    };
  } else if (schema instanceof z.ZodString) {
    converted = { type: "string" };
    for (const check of schema._def.checks) {
      if (check.kind === "min") converted.minLength = check.value;
      else if (check.kind === "max") converted.maxLength = check.value;
      else if (check.kind === "regex") converted.pattern = check.regex.source;
      else if (check.kind === "datetime") converted.format = "date-time";
    }
  } else if (schema instanceof z.ZodNumber) {
    converted = {
      type: schema._def.checks.some(({ kind }) => kind === "int") ? "integer" : "number",
    };
    for (const check of schema._def.checks) {
      if (check.kind === "min")
        converted[check.inclusive ? "minimum" : "exclusiveMinimum"] = check.value;
      else if (check.kind === "max")
        converted[check.inclusive ? "maximum" : "exclusiveMaximum"] = check.value;
    }
  } else if (schema instanceof z.ZodBoolean) {
    converted = { type: "boolean" };
  } else if (schema instanceof z.ZodNull) {
    converted = { type: "null" };
  } else if (schema instanceof z.ZodLiteral) {
    converted = { const: schema.value as OperationJsonValue };
  } else if (schema instanceof z.ZodEnum) {
    const enumSchema = schema as z.ZodEnum<[string, ...string[]]>;
    converted = { type: "string", enum: [...enumSchema.options] };
  } else if (schema instanceof z.ZodArray) {
    const arraySchema = schema as z.ZodArray<z.ZodTypeAny>;
    converted = { type: "array", items: zodToJsonSchema(arraySchema.element, currentDefinition) };
    if (arraySchema._def.minLength !== null) converted.minItems = arraySchema._def.minLength.value;
    if (arraySchema._def.maxLength !== null) converted.maxItems = arraySchema._def.maxLength.value;
    if (arraySchema._def.exactLength !== null) {
      converted.minItems = arraySchema._def.exactLength.value;
      converted.maxItems = arraySchema._def.exactLength.value;
    }
  } else if (schema instanceof z.ZodTuple) {
    const tupleSchema = schema as z.ZodTuple<[z.ZodTypeAny, ...z.ZodTypeAny[]]>;
    converted = {
      type: "array",
      items: tupleSchema.items.map((item: z.ZodTypeAny) =>
        zodToJsonSchema(item, currentDefinition),
      ),
      additionalItems: false,
      minItems: tupleSchema.items.length,
      maxItems: tupleSchema.items.length,
    };
  } else if (schema instanceof z.ZodObject) {
    const objectSchema = schema as z.ZodObject<z.ZodRawShape>;
    const shape = objectSchema.shape;
    const required = Object.entries(shape)
      .filter(([, propertySchema]) => !propertySchema.isOptional())
      .map(([name]) => name);
    converted = strictObject(
      required,
      Object.fromEntries(
        Object.entries(shape).map(([name, propertySchema]) => [
          name,
          zodToJsonSchema(propertySchema, currentDefinition),
        ]),
      ),
    );
  } else if (schema instanceof z.ZodUnion) {
    const unionSchema = schema as z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>;
    converted = {
      oneOf: unionSchema.options.map((option: z.ZodTypeAny) =>
        zodToJsonSchema(option, currentDefinition),
      ),
    };
  } else if (schema instanceof z.ZodNever) {
    converted = { not: {} };
  } else {
    throw new Error(`Unsupported Reflection discovery schema node: ${schema.constructor.name}`);
  }

  return projections.get(schema)?.(converted) ?? converted;
}

function discoverySchema(root: z.ZodTypeAny): JsonSchema {
  const definitions = Object.fromEntries(
    definitionEntries.map(([name, schema]) => [name, zodToJsonSchema(schema, schema)]),
  );
  const rootName = definitionNames.get(root);
  if (rootName === undefined) throw new Error("Reflection discovery root is not registered");
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `https://shelf-judge.local/schemas/${rootName}.json`,
    description: REFLECTION_RUNTIME_VALIDATION_AUTHORITY,
    "x-shelf-judge-runtime-validation": {
      authoritative: true,
      omittedCategories: [
        "cross-field-count-equivalence",
        "citation-dependency-uniqueness-resolution-composition",
        "request-event-lifecycle-identity-order-terminal-relationships",
      ],
    },
    definitions,
    $ref: `#/definitions/${rootName}`,
  };
}

export const REFLECTION_RUNTIME_VALIDATION_AUTHORITY =
  "Shared runtime Zod validation is authoritative. This structurally strict draft-07 resource omits refinements for cross-field count/equivalence, citation/dependency uniqueness and resolution/composition, and request/event lifecycle identity/order/terminal relationships.";

export const REFLECTION_DISCOVERY_SCHEMAS = Object.freeze({
  getResult: discoverySchema(ReflectionGetResultSchema),
  operationResult: discoverySchema(ReflectionOperationResultSchema),
  streamEvent: discoverySchema(ReflectionStreamEventSchema),
});
