import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { z } from "zod";

export const GROUNDED_SUBMISSION_TOOL_NAME = "submit_grounded_analysis";

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
    attempts: number;
    rejectedAttempts: number;
  }>;
}

export function createGroundedStructuredSubmission<Output>(
  schema: z.ZodType<Output>,
): GroundedStructuredSubmission<Output> {
  let result: Output | undefined;
  let attempts = 0;
  let rejectedAttempts = 0;
  const tool = defineTool({
    name: GROUNDED_SUBMISSION_TOOL_NAME,
    label: "Submit grounded analysis",
    description:
      "Submit the complete grounded-analysis result. This is the only valid output path.",
    parameters: Type.Object({ submission: Type.Unknown() }, { additionalProperties: false }),
    execute(_toolCallId, parameters) {
      attempts += 1;
      try {
        if (result !== undefined) throw new Error("A grounded result was already submitted");
        result = schema.parse(parameters.submission);
      } catch (error) {
        rejectedAttempts += 1;
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
    getAttemptState: () => Object.freeze({ attempts, rejectedAttempts }),
  };
}
