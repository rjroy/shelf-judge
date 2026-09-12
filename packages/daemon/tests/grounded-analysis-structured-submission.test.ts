import { expect, test } from "bun:test";
import { z } from "zod";
import {
  createGroundedStructuredSubmission,
  GroundedStructuredSubmissionValidationError,
  parseGroundedStructuredSubmission,
} from "../src/services/grounded-analysis/structured-submission.js";
import { mapGroundedAnalysisFailure } from "../src/services/grounded-analysis/failure-mapping.js";
import { ReflectionModelSubmissionSchema } from "../src/services/reflection-result-validator.js";
import { createGroundedToolLifecycleDiagnostics } from "../src/services/grounded-analysis/tool-lifecycle.js";

const schema = z
  .object({
    result: z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("answered"), text: z.string().min(1) }).strict(),
      z.object({ outcome: z.literal("abstained"), reason: z.enum(["insufficient"]) }).strict(),
    ]),
  })
  .strict();

test("structured submission exposes nested Zod constraints to pi", () => {
  const submission = createGroundedStructuredSubmission(schema);
  expect(submission.tool.parameters).toMatchObject({
    type: "object",
    additionalProperties: false,
    properties: {
      submission: {
        type: "object",
        additionalProperties: false,
        properties: {
          result: {
            anyOf: [
              {
                type: "object",
                properties: { outcome: { type: "string", enum: ["answered"] } },
              },
              {
                type: "object",
                properties: { outcome: { type: "string", enum: ["abstained"] } },
              },
            ],
          },
        },
      },
    },
  });
});

test("structured submission conveys enum constraints directly instead of a union of constants", () => {
  const submission = createGroundedStructuredSubmission(ReflectionModelSubmissionSchema);
  expect(submission.tool.parameters).toMatchObject({
    properties: {
      submission: {
        properties: {
          result: {
            anyOf: [
              {},
              {
                properties: {
                  outcome: { type: "string", enum: ["abstained"] },
                  reason: {
                    type: "string",
                    enum: [
                      "no-owner-testimony",
                      "insufficient-independent-testimony",
                      "no-supported-pattern",
                      "no-material-synthesis",
                      "conflicting-evidence",
                      "incomplete-scope",
                      "question-not-applicable",
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    },
  });
});

test("Reflection's production submission schema converts without weakening its union", () => {
  expect(() => createGroundedStructuredSubmission(ReflectionModelSubmissionSchema)).not.toThrow();
});

test("structured submission remains fail-closed with privacy-safe diagnostics", () => {
  expect(() =>
    parseGroundedStructuredSubmission(schema, { result: { outcome: "answered" } }),
  ).toThrow(GroundedStructuredSubmissionValidationError);
  expect(() =>
    parseGroundedStructuredSubmission(schema, { result: { outcome: "answered" } }),
  ).toThrow("invalid_type@result.text");
});

test("structured submission retains bounded schema-path validation diagnostics", () => {
  const submission = createGroundedStructuredSubmission(schema);
  const execute = submission.tool.execute.bind(submission.tool);
  expect(() => {
    Reflect.apply(execute, undefined, [
      "call",
      { submission: { result: { outcome: "answered", leaked: "private fixture evidence" } } },
    ]);
  }).toThrow(GroundedStructuredSubmissionValidationError);
  expect(submission.getAttemptState().validationIssues).toEqual([
    { code: "invalid_type", path: ["result", "text"] },
    { code: "unrecognized_keys", path: ["result"] },
  ]);
  expect(submission.getAttemptState().argumentShapes).toEqual([
    {
      topLevel: "object",
      submission: "object",
      result: "object",
      outcome: "answered",
    },
  ]);
});

test("structured submission records only safe discriminator shape for rejected arguments", () => {
  const submission = createGroundedStructuredSubmission(ReflectionModelSubmissionSchema);
  const execute = submission.tool.execute.bind(submission.tool);
  expect(() => {
    Reflect.apply(execute, undefined, [
      "call",
      {
        submission: {
          result: {
            outcome: "private-unrecognized-enum",
            explanation: "private fixture testimony must never be retained",
          },
        },
      },
    ]);
  }).toThrow(GroundedStructuredSubmissionValidationError);
  expect(submission.getAttemptState().argumentShapes).toEqual([
    {
      topLevel: "object",
      submission: "object",
      result: "object",
      outcome: "other-string",
    },
  ]);
  expect(JSON.stringify(submission.getAttemptState().argumentShapes)).not.toContain(
    "private-unrecognized-enum",
  );
});

test("structured submission failures remain output-validation failures", () => {
  const error = new GroundedStructuredSubmissionValidationError([
    {
      code: "invalid_type",
      expected: "string",
      received: "undefined",
      path: ["result", "text"],
      message: "",
    },
  ]);
  expect(mapGroundedAnalysisFailure(error)).toMatchObject({
    reason: "output-validation",
    safeDetail: "invalid-structured-submission",
  });
});

test("structured submission records privacy-safe dispatch and validation outcomes", async () => {
  const lifecycle = createGroundedToolLifecycleDiagnostics();
  const rejected = createGroundedStructuredSubmission(schema, lifecycle);
  const rejectedExecute = rejected.tool.execute.bind(rejected.tool);
  expect(() => {
    Reflect.apply(rejectedExecute, undefined, [
      "call",
      { submission: { result: { outcome: "answered", leaked: "private reflection text" } } },
    ]);
  }).toThrow(GroundedStructuredSubmissionValidationError);

  const acceptedLifecycle = createGroundedToolLifecycleDiagnostics();
  const accepted = createGroundedStructuredSubmission(schema, acceptedLifecycle);
  const acceptedExecute = accepted.tool.execute.bind(accepted.tool);
  await Reflect.apply(acceptedExecute, undefined, [
    "call",
    { submission: { result: { outcome: "answered", text: "ok" } } },
  ]);

  expect(lifecycle.snapshot()).toEqual([
    {
      toolName: "submit_grounded_analysis",
      toolKind: "submission",
      phase: "dispatch",
      outcome: "attempted",
      callIndex: 0,
    },
    {
      toolName: "submit_grounded_analysis",
      toolKind: "submission",
      phase: "handling",
      outcome: "rejected",
      callIndex: 0,
    },
  ]);
  expect(acceptedLifecycle.snapshot()).toEqual([
    {
      toolName: "submit_grounded_analysis",
      toolKind: "submission",
      phase: "dispatch",
      outcome: "attempted",
      callIndex: 0,
    },
    {
      toolName: "submit_grounded_analysis",
      toolKind: "submission",
      phase: "handling",
      outcome: "accepted",
      callIndex: 0,
    },
  ]);
  expect(JSON.stringify(lifecycle.snapshot())).not.toContain("private reflection text");
});
