import { expect, test } from "bun:test";
import { z } from "zod";
import {
  createGroundedStructuredSubmission,
  GroundedStructuredSubmissionValidationError,
  parseGroundedStructuredSubmission,
} from "../src/services/grounded-analysis/structured-submission.js";
import { mapGroundedAnalysisFailure } from "../src/services/grounded-analysis/failure-mapping.js";
import { ReflectionModelSubmissionSchema } from "../src/services/reflection-result-validator.js";

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
              { type: "object", properties: { outcome: { const: "answered" } } },
              { type: "object", properties: { outcome: { const: "abstained" } } },
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
