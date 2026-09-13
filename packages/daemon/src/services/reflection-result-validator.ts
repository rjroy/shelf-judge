import {
  REFLECTION_QUESTION_ABSTENTION_REASONS,
  ReflectionCitationSchema,
  ReflectionCompletedSchema,
  ReflectionProviderUsageSchema,
  type GroundedProviderUsage,
  type GroundedUsageUnavailable,
  type ReflectionBlock,
  type ReflectionCitation,
  type ReflectionCompleted,
  type ReflectionQuestionId,
} from "@shelf-judge/shared";
import { z } from "zod";
import type { GroundedEvidenceEntry } from "./grounded-analysis/evidence-registry.js";
import { GroundedStructuredSubmissionValidationError } from "./grounded-analysis/submission-validation-error.js";
import type { ReflectionEvidencePackage } from "./reflection-evidence-service.js";

const ReflectionModelBlockSchema = z
  .object({
    text: z.string().min(1),
    citationIds: z.array(z.string().min(1)),
    uncertainty: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(({ citationIds }, context) => {
    if (new Set(citationIds).size !== citationIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citationIds"],
        message: "Block citation IDs must be unique",
      });
    }
  });

const ReflectionModelNoteExcerptSchema = z
  .object({
    citationId: z.string().min(1),
    excerpt: z.string().trim().min(1).max(240),
  })
  .strict();
const ReflectionModelNoteExcerptsSchema = z
  .array(ReflectionModelNoteExcerptSchema)
  .superRefine((excerpts, context) => {
    const citationIds = excerpts.map(({ citationId }) => citationId);
    if (new Set(citationIds).size !== citationIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Note excerpt citation IDs must be unique",
      });
    }
  });

const ReflectionAnsweredModelBlockSchema = ReflectionModelBlockSchema.refine(
  ({ citationIds }) => citationIds.length > 0,
  { message: "Every answered block requires at least one citation ID", path: ["citationIds"] },
);

const AnsweredSubmissionSchema = z
  .object({
    outcome: z.literal("answered"),
    centralSynthesis: ReflectionAnsweredModelBlockSchema,
    supportingBlocks: z.array(ReflectionAnsweredModelBlockSchema).min(1).max(3),
    noteExcerpts: ReflectionModelNoteExcerptsSchema,
  })
  .strict();
const ALL_ABSTENTION_REASONS = [
  "no-owner-testimony",
  "insufficient-independent-testimony",
  "no-supported-pattern",
  "no-material-synthesis",
  "conflicting-evidence",
  "incomplete-scope",
  "question-not-applicable",
] as const;

function abstainedSubmissionSchema(questionId?: ReflectionQuestionId) {
  const reasons: readonly [string, ...string[]] =
    questionId === undefined
      ? ALL_ABSTENTION_REASONS
      : REFLECTION_QUESTION_ABSTENTION_REASONS[questionId];
  return z
    .object({
      outcome: z.literal("abstained"),
      reason: z.enum(reasons),
      explanation: z.string().min(1),
      supportingBlocks: z.array(ReflectionModelBlockSchema).max(3),
      noteExcerpts: ReflectionModelNoteExcerptsSchema,
    })
    .strict();
}

export function createReflectionSubmissionSchema(questionId?: ReflectionQuestionId) {
  return z
    .object({
      result: z.discriminatedUnion("outcome", [
        AnsweredSubmissionSchema,
        abstainedSubmissionSchema(questionId),
      ]),
    })
    .strict();
}

/** Broad schema retained for final validation before the question policy defense-in-depth check. */
export const ReflectionModelSubmissionSchema = createReflectionSubmissionSchema();

export type ReflectionModelSubmission = z.infer<typeof ReflectionModelSubmissionSchema>;

export interface ReflectionResultValidationInput {
  readonly questionId: ReflectionQuestionId;
  readonly submission: unknown;
  readonly evidencePackage: ReflectionEvidencePackage;
  readonly usage: GroundedProviderUsage | GroundedUsageUnavailable;
  readonly generatedAt: string;
}

export interface ReflectionResultValidator {
  validate(input: ReflectionResultValidationInput): ReflectionCompleted;
}

function cloneAndFreeze<Value>(value: Value): Value {
  const copy = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null || Object.isFrozen(candidate)) return;
    Object.freeze(candidate);
    for (const child of Object.values(candidate)) freeze(child);
  };
  freeze(copy);
  return copy;
}

function citedEntries(
  block: ReflectionBlock,
  evidencePackage: ReflectionEvidencePackage,
): readonly GroundedEvidenceEntry[] {
  return block.citationIds.map((citationId) => {
    const entry = evidencePackage.evidence.resolve(citationId);
    if (entry === undefined) {
      throw submissionValidationError(`Unknown Reflection citation: ${citationId}`, [
        "result",
        "citationIds",
      ]);
    }
    return entry;
  });
}

function submissionValidationError(
  message: string,
  path: readonly (string | number)[],
): GroundedStructuredSubmissionValidationError {
  return new GroundedStructuredSubmissionValidationError([
    { code: z.ZodIssueCode.custom, message, path: [...path] },
  ]);
}

function canonicalCitations(
  blocks: readonly ReflectionBlock[],
  evidencePackage: ReflectionEvidencePackage,
  noteExcerpts: readonly { citationId: string; excerpt: string }[],
): readonly ReflectionCitation[] {
  const requested = new Set(blocks.flatMap(({ citationIds }) => citationIds));
  const excerptsByCitation = new Map(
    noteExcerpts.map(({ citationId, excerpt }) => [citationId, excerpt]),
  );
  for (const citationId of requested) {
    const entry = evidencePackage.evidence.resolve(citationId);
    if (entry === undefined) {
      throw submissionValidationError(`Unknown Reflection citation: ${citationId}`, [
        "result",
        "citationIds",
      ]);
    }
    if (entry.citationMetadata === undefined) {
      throw new Error(`Reflection citation metadata is unavailable: ${citationId}`);
    }
    if (entry.evidenceClass === "owner-game-note") {
      const excerpt = excerptsByCitation.get(citationId);
      const payload = entry.payload;
      const noteText =
        typeof payload === "object" && payload !== null
          ? (payload as Record<string, unknown>).text
          : undefined;
      if (excerpt === undefined || typeof noteText !== "string" || !noteText.includes(excerpt)) {
        throw submissionValidationError(
          `Reflection note excerpt is not exact current testimony: ${citationId}`,
          ["result", "noteExcerpts"],
        );
      }
    } else if (excerptsByCitation.has(citationId)) {
      throw submissionValidationError(
        `Deterministic citations cannot have note excerpts: ${citationId}`,
        ["result", "noteExcerpts"],
      );
    }
  }
  for (const citationId of excerptsByCitation.keys()) {
    if (!requested.has(citationId))
      throw submissionValidationError(`Uncited Reflection note excerpt: ${citationId}`, [
        "result",
        "noteExcerpts",
      ]);
  }
  return evidencePackage.evidence.entries.flatMap((entry) => {
    if (!requested.has(entry.citationId)) return [];
    if (entry.citationMetadata === undefined)
      throw new Error(`Reflection citation metadata is unavailable: ${entry.citationId}`);
    const citation = ReflectionCitationSchema.parse(entry.citationMetadata);
    return [
      ReflectionCitationSchema.parse({
        ...citation,
        citationId: entry.citationId,
        sourceId: entry.sourceId,
        sourceVersion: entry.sourceVersion,
        evidenceClass: entry.evidenceClass,
        testimony: entry.evidenceClass === "owner-game-note",
        ...(entry.evidenceClass === "owner-game-note"
          ? { canonicalSummary: excerptsByCitation.get(entry.citationId) as string }
          : {}),
      }),
    ];
  });
}

export function createReflectionResultValidator(): ReflectionResultValidator {
  return Object.freeze({
    validate(input: ReflectionResultValidationInput): ReflectionCompleted {
      const submission = ReflectionModelSubmissionSchema.parse(input.submission).result;
      if (input.evidencePackage.evidenceIdentity.questionId !== input.questionId) {
        throw new Error("Reflection evidence package does not match the selected question");
      }
      if (
        submission.outcome === "abstained" &&
        !REFLECTION_QUESTION_ABSTENTION_REASONS[input.questionId].some(
          (reason) => reason === submission.reason,
        )
      ) {
        throw submissionValidationError(
          "Abstention reason is not authorized for the selected question",
          ["result", "reason"],
        );
      }

      const blocks =
        submission.outcome === "answered"
          ? [submission.centralSynthesis, ...submission.supportingBlocks]
          : submission.supportingBlocks;
      if (submission.outcome === "answered") {
        for (const block of blocks) citedEntries(block, input.evidencePackage);
      }

      const usage =
        input.usage.state === "reported"
          ? ReflectionProviderUsageSchema.parse(input.usage)
          : input.usage;
      const { noteExcerpts, ...modelResult } = submission;
      const result = ReflectionCompletedSchema.parse({
        ...modelResult,
        citations: canonicalCitations(blocks, input.evidencePackage, noteExcerpts),
        scope: input.evidencePackage.scope,
        evidenceIdentity: input.evidencePackage.evidenceIdentity,
        dependencies: input.evidencePackage.dependencies,
        generatedAt: input.generatedAt,
        usage,
      });
      return cloneAndFreeze(result);
    },
  });
}
