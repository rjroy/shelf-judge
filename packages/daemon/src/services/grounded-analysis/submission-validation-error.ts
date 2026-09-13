import type { z } from "zod";

export class GroundedStructuredSubmissionValidationError extends Error {
  readonly issues: readonly z.ZodIssue[];

  constructor(issues: readonly z.ZodIssue[]) {
    super(
      `Invalid structured submission: ${issues
        .map(
          (issue) =>
            `${issue.code}@${issue.path.join(".") || "root"}${issue.message ? `: ${issue.message}` : ""}`,
        )
        .join(", ")}`,
    );
    this.name = "GroundedStructuredSubmissionValidationError";
    this.issues = issues;
  }
}
