import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { z } from "zod";

export const GROUNDED_SUBMISSION_TOOL_NAME = "submit_grounded_analysis";

export class GroundedStructuredSubmissionValidationError extends Error {
  readonly issues: readonly z.ZodIssue[];

  constructor(issues: readonly z.ZodIssue[]) {
    super(
      `Invalid structured submission: ${issues
        .map((issue) => `${issue.code}@${issue.path.join(".") || "root"}`)
        .join(", ")}`,
    );
    this.name = "GroundedStructuredSubmissionValidationError";
    this.issues = issues;
  }
}

export function parseGroundedStructuredSubmission<Output>(
  schema: z.ZodType<Output>,
  submission: unknown,
): Output {
  const parsed = schema.safeParse(submission);
  if (!parsed.success) throw new GroundedStructuredSubmissionValidationError(parsed.error.issues);
  return parsed.data;
}

function prepareGroundedStructuredSubmission<Output>(
  schema: z.ZodType<Output>,
  parameters: unknown,
): { submission: Output } {
  const outerParameters = z.object({ submission: z.unknown() }).strict().safeParse(parameters);
  if (!outerParameters.success)
    throw new GroundedStructuredSubmissionValidationError(outerParameters.error.issues);
  return { submission: parseGroundedStructuredSubmission(schema, outerParameters.data.submission) };
}

function zodToToolSchema(schema: z.ZodTypeAny): TSchema {
  if (schema instanceof z.ZodString) {
    const checks = schema._def.checks;
    const minLength = checks.find((check) => check.kind === "min")?.value;
    const maxLength = checks.find((check) => check.kind === "max")?.value;
    return Type.String({
      ...(minLength === undefined ? {} : { minLength }),
      ...(maxLength === undefined ? {} : { maxLength }),
    });
  }
  if (schema instanceof z.ZodNumber) return Type.Number();
  if (schema instanceof z.ZodBoolean) return Type.Boolean();
  if (schema instanceof z.ZodLiteral && typeof schema.value === "string") {
    return Type.Unsafe({ type: "string", enum: [schema.value] });
  }
  if (schema instanceof z.ZodLiteral) return Type.Literal(schema.value);
  if (schema instanceof z.ZodEnum)
    return Type.Unsafe({ type: "string", enum: [...(schema.options as readonly string[])] });
  if (schema instanceof z.ZodArray) {
    const { minLength, maxLength } = schema._def;
    return Type.Array(zodToToolSchema(schema.element as z.ZodTypeAny), {
      ...(minLength === null ? {} : { minItems: minLength.value }),
      ...(maxLength === null ? {} : { maxItems: maxLength.value }),
    });
  }
  if (schema instanceof z.ZodOptional)
    return Type.Optional(zodToToolSchema(schema.unwrap() as z.ZodTypeAny));
  if (schema instanceof z.ZodEffects) return zodToToolSchema(schema.innerType() as z.ZodTypeAny);
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, TSchema> = {};
    for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      properties[key] = zodToToolSchema(value);
    }
    return Type.Object(properties, {
      additionalProperties: schema._def.unknownKeys === "passthrough",
    });
  }
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    return Type.Union(
      (schema.options as readonly z.ZodTypeAny[]).map((option) => zodToToolSchema(option)),
    );
  }
  throw new Error("Unsupported Zod submission schema");
}

export function createGroundedSubmissionOnlyToolManifest(feature: string) {
  return Object.freeze({
    feature,
    toolNames: Object.freeze([GROUNDED_SUBMISSION_TOOL_NAME] as const),
  });
}

export interface GroundedStructuredSubmission<Output> {
  tool: ToolDefinition;
  getResult(): Output | undefined;
  getAttemptState(): Readonly<{
    toolCallAttempts: number;
    rejectedAttempts: number;
    acceptedResultPresent: boolean;
    validationIssues: readonly GroundedStructuredSubmissionIssue[];
    argumentShapes: readonly GroundedStructuredSubmissionArgumentShape[];
  }>;
}

export interface GroundedStructuredSubmissionIssue {
  readonly code: z.ZodIssueCode;
  readonly path: (string | number)[];
}

export interface GroundedStructuredSubmissionArgumentShape {
  readonly topLevel: "object" | "non-object";
  readonly submission: "missing" | "object" | "non-object";
  readonly result: "missing" | "object" | "non-object";
  readonly outcome: "missing" | "answered" | "abstained" | "other-string" | "non-string";
}

const MAX_SAFE_VALIDATION_ISSUES = 8;

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function argumentShape(parameters: unknown): GroundedStructuredSubmissionArgumentShape {
  const topLevel = objectValue(parameters);
  if (topLevel === undefined)
    return {
      topLevel: "non-object",
      submission: "missing",
      result: "missing",
      outcome: "missing",
    };
  const submissionValue = topLevel.submission;
  const submission = objectValue(submissionValue);
  if (submission === undefined)
    return {
      topLevel: "object",
      submission: submissionValue === undefined ? "missing" : "non-object",
      result: "missing",
      outcome: "missing",
    };
  const resultValue = submission.result;
  const result = objectValue(resultValue);
  if (result === undefined)
    return {
      topLevel: "object",
      submission: "object",
      result: resultValue === undefined ? "missing" : "non-object",
      outcome: "missing",
    };
  const outcome = result.outcome;
  return {
    topLevel: "object",
    submission: "object",
    result: "object",
    outcome:
      outcome === undefined
        ? "missing"
        : outcome === "answered" || outcome === "abstained"
          ? outcome
          : typeof outcome === "string"
            ? "other-string"
            : "non-string",
  };
}

function schemaKeys(schema: z.ZodTypeAny, keys = new Set<string>()): ReadonlySet<string> {
  if (schema instanceof z.ZodObject) {
    for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      keys.add(key);
      schemaKeys(value, keys);
    }
  } else if (schema instanceof z.ZodArray) {
    schemaKeys(schema.element as z.ZodTypeAny, keys);
  } else if (schema instanceof z.ZodOptional || schema instanceof z.ZodEffects) {
    schemaKeys(
      schema instanceof z.ZodOptional
        ? (schema.unwrap() as z.ZodTypeAny)
        : (schema.innerType() as z.ZodTypeAny),
      keys,
    );
  } else if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    for (const option of schema.options as readonly z.ZodTypeAny[]) schemaKeys(option, keys);
  }
  return keys;
}

function safeValidationIssues(
  schema: z.ZodTypeAny,
  issues: readonly z.ZodIssue[],
): readonly GroundedStructuredSubmissionIssue[] {
  const keys = schemaKeys(schema);
  return issues.slice(0, MAX_SAFE_VALIDATION_ISSUES).map(({ code, path }) => ({
    code,
    path: path.filter(
      (segment): segment is string | number =>
        typeof segment === "number" || (typeof segment === "string" && keys.has(segment)),
    ),
  }));
}

export function createGroundedStructuredSubmission<Output>(
  schema: z.ZodType<Output>,
): GroundedStructuredSubmission<Output> {
  let result: Output | undefined;
  let toolCallAttempts = 0;
  let rejectedAttempts = 0;
  let validationIssues: readonly GroundedStructuredSubmissionIssue[] = [];
  const argumentShapes: GroundedStructuredSubmissionArgumentShape[] = [];
  let preparedInvocationPending = false;
  const tool = defineTool({
    name: GROUNDED_SUBMISSION_TOOL_NAME,
    label: "Submit grounded analysis",
    description:
      "Submit the complete grounded-analysis result. This is the only valid output path.",
    parameters: Type.Object(
      { submission: zodToToolSchema(schema) },
      { additionalProperties: false },
    ),
    prepareArguments(parameters) {
      toolCallAttempts += 1;
      if (argumentShapes.length < 2) argumentShapes.push(argumentShape(parameters));
      try {
        if (result !== undefined) throw new Error("A grounded result was already submitted");
        const prepared = prepareGroundedStructuredSubmission(schema, parameters);
        preparedInvocationPending = true;
        return prepared;
      } catch (error) {
        rejectedAttempts += 1;
        if (error instanceof GroundedStructuredSubmissionValidationError) {
          validationIssues = safeValidationIssues(schema, error.issues);
        }
        throw error;
      }
    },
    execute(_toolCallId, parameters) {
      if (!preparedInvocationPending) toolCallAttempts += 1;
      if (!preparedInvocationPending && argumentShapes.length < 2)
        argumentShapes.push(argumentShape(parameters));
      preparedInvocationPending = false;
      try {
        if (result !== undefined) throw new Error("A grounded result was already submitted");
        result = parseGroundedStructuredSubmission(schema, parameters.submission);
      } catch (error) {
        rejectedAttempts += 1;
        if (error instanceof GroundedStructuredSubmissionValidationError) {
          validationIssues = safeValidationIssues(schema, error.issues);
        }
        if (error instanceof z.ZodError)
          throw new GroundedStructuredSubmissionValidationError(error.issues);
        throw error;
      }
      return Promise.resolve({
        content: [{ type: "text", text: "Grounded result accepted." }],
        details: undefined,
      });
    },
  });

  return {
    tool,
    getResult: () => result,
    getAttemptState: () =>
      Object.freeze({
        toolCallAttempts,
        rejectedAttempts,
        acceptedResultPresent: result !== undefined,
        validationIssues,
        argumentShapes,
      }),
  };
}
