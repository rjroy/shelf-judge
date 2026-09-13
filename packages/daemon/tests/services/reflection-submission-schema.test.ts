import { describe, expect, test } from "bun:test";
import { createGroundedStructuredSubmission } from "../../src/services/grounded-analysis/structured-submission.js";
import { createReflectionSubmissionSchema } from "../../src/services/reflection-result-validator.js";

const validRepeatedValuesAbstention = {
  result: {
    outcome: "abstained" as const,
    reason: "incomplete-scope",
    explanation: "The available evidence does not cover the requested scope.",
    supportingBlocks: [],
    noteExcerpts: [],
  },
};

describe("Reflection question submission schemas", () => {
  test("accepts an allowed abstention at the submission tool boundary", () => {
    const submission = createGroundedStructuredSubmission(
      createReflectionSubmissionSchema("repeated-values"),
    );

    expect(
      submission.tool.prepareArguments?.({ submission: validRepeatedValuesAbstention }),
    ).toEqual({ submission: validRepeatedValuesAbstention });
  });

  test("rejects an abstention reason that is incompatible with the active question", () => {
    const submission = createGroundedStructuredSubmission(
      createReflectionSubmissionSchema("repeated-values"),
    );
    const incompatible = {
      submission: {
        result: { ...validRepeatedValuesAbstention.result, reason: "no-supported-pattern" },
      },
    };

    expect(() => submission.tool.prepareArguments?.(incompatible)).toThrow(
      "Invalid structured submission",
    );
    expect(submission.getAttemptState()).toMatchObject({
      toolCallAttempts: 1,
      rejectedAttempts: 1,
      validationIssues: [{ code: "invalid_enum_value", path: ["result", "reason"] }],
    });
  });
});
