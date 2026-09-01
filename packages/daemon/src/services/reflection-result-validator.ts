import {
  REFLECTION_QUESTION_ABSTENTION_REASONS,
  REFLECTION_QUESTION_POLICIES,
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

const AnsweredSubmissionSchema = z
  .object({
    outcome: z.literal("answered"),
    centralSynthesis: ReflectionModelBlockSchema,
    supportingBlocks: z.array(ReflectionModelBlockSchema).min(1).max(3),
    noteExcerpts: ReflectionModelNoteExcerptsSchema,
  })
  .strict();
const AbstainedSubmissionSchema = z
  .object({
    outcome: z.literal("abstained"),
    reason: z.enum([
      "no-owner-testimony",
      "insufficient-independent-testimony",
      "no-supported-pattern",
      "no-material-synthesis",
      "conflicting-evidence",
      "incomplete-scope",
      "question-not-applicable",
    ]),
    explanation: z.string().min(1),
    supportingBlocks: z.array(ReflectionModelBlockSchema).max(3),
    noteExcerpts: ReflectionModelNoteExcerptsSchema,
  })
  .strict();

export const ReflectionModelSubmissionSchema = z
  .object({
    result: z.discriminatedUnion("outcome", [AnsweredSubmissionSchema, AbstainedSubmissionSchema]),
  })
  .strict();

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
    if (entry === undefined) throw new Error(`Unknown Reflection citation: ${citationId}`);
    return entry;
  });
}

function payloadGameIds(entry: GroundedEvidenceEntry): ReadonlySet<string> {
  if (typeof entry.payload !== "object" || entry.payload === null) return new Set();
  const payload = entry.payload as Record<string, unknown>;
  const ids = new Set<string>();
  if (typeof payload.gameId === "string") ids.add(payload.gameId);
  if (Array.isArray(payload.games)) {
    for (const game of payload.games) {
      if (typeof game !== "object" || game === null) continue;
      const gameId = (game as Record<string, unknown>).gameId;
      if (typeof gameId === "string") ids.add(gameId);
    }
  }
  return ids;
}

function validateAnsweredBlock(
  block: ReflectionBlock,
  evidencePackage: ReflectionEvidencePackage,
): void {
  const entries = citedEntries(block, evidencePackage);
  const noteGameIds = entries
    .filter(({ evidenceClass }) => evidenceClass === "owner-game-note")
    .map(({ sourceId }) => sourceId);
  const deterministicEntries = entries.filter(
    ({ evidenceClass }) => evidenceClass !== "owner-game-note",
  );
  if (noteGameIds.length === 0 || deterministicEntries.length === 0) {
    throw new Error(
      "Every answered Reflection block requires testimony and deterministic evidence",
    );
  }
  const supportedGameIds = new Set(
    deterministicEntries.flatMap((entry) => [...payloadGameIds(entry)]),
  );
  if (noteGameIds.some((gameId) => !supportedGameIds.has(gameId))) {
    throw new Error("Every cited note requires deterministic evidence for the same game");
  }
}

function validatePatternAnswer(
  centralSynthesis: ReflectionBlock,
  evidencePackage: ReflectionEvidencePackage,
): void {
  const candidateIds = evidencePackage.scope.patternCandidateIds;
  if (candidateIds === undefined) throw new Error("Pattern evidence requires complete candidates");
  const entries = citedEntries(centralSynthesis, evidencePackage);
  const profileEntries = entries.filter(
    ({ evidenceClass }) => evidenceClass === "profile-evidence",
  );
  const noteGameIds = entries
    .filter(({ evidenceClass }) => evidenceClass === "owner-game-note")
    .map(({ sourceId }) => sourceId);
  const hasSupportingCandidate = profileEntries.some((entry) => {
    if (typeof entry.payload !== "object" || entry.payload === null) return false;
    const payload = entry.payload as Record<string, unknown>;
    const candidateId = payload.candidateId;
    if (typeof candidateId !== "string" || !candidateIds.includes(candidateId)) return false;
    if (payload.support !== "supported") return false;
    const supportingGames = payloadGameIds(entry);
    return noteGameIds.every((gameId) => supportingGames.has(gameId));
  });
  if (!hasSupportingCandidate) {
    throw new Error(
      "Pattern synthesis requires one authorized candidate supporting every cited note",
    );
  }
}

function validateCompletePatternScope(evidencePackage: ReflectionEvidencePackage): void {
  const candidateIds = evidencePackage.scope.patternCandidateIds;
  if (candidateIds === undefined) throw new Error("Pattern evidence requires complete candidates");
  const profileCandidates = new Map<string, number>();
  for (const entry of evidencePackage.evidence.entries) {
    if (entry.evidenceClass !== "profile-evidence") continue;
    if (typeof entry.payload !== "object" || entry.payload === null) {
      throw new Error("Pattern candidate evidence is malformed");
    }
    const payload = entry.payload as Record<string, unknown>;
    const candidateId = payload.candidateId;
    if (
      typeof candidateId !== "string" ||
      !Array.isArray(payload.games) ||
      !Array.isArray(payload.exclusions) ||
      !Array.isArray(payload.confounders) ||
      typeof payload.comparator !== "object" ||
      payload.comparator === null
    ) {
      throw new Error("Pattern candidate evidence is incomplete");
    }
    profileCandidates.set(candidateId, (profileCandidates.get(candidateId) ?? 0) + 1);
  }
  if (
    candidateIds.some((candidateId) => profileCandidates.get(candidateId) !== 1) ||
    [...profileCandidates.keys()].some((candidateId) => !candidateIds.includes(candidateId))
  ) {
    throw new Error("Pattern evidence does not cover the complete candidate scope");
  }
}

function canonicalCitations(
  blocks: readonly ReflectionBlock[],
  evidencePackage: ReflectionEvidencePackage,
  noteExcerpts: readonly { citationId: string; excerpt: string }[],
): readonly ReflectionCitation[] {
  const requested = new Set(blocks.flatMap(({ citationIds }) => citationIds));
  const byId = new Map(
    evidencePackage.citations.map((citation) => [citation.citationId, citation]),
  );
  const excerptsByCitation = new Map(
    noteExcerpts.map(({ citationId, excerpt }) => [citationId, excerpt]),
  );
  for (const citationId of requested) {
    const citation = byId.get(citationId);
    const entry = evidencePackage.evidence.resolve(citationId);
    if (
      citation === undefined ||
      entry === undefined ||
      citation.sourceId !== entry.sourceId ||
      citation.sourceVersion !== entry.sourceVersion ||
      citation.evidenceClass !== entry.evidenceClass
    ) {
      throw new Error(`Reflection citation does not match canonical evidence: ${citationId}`);
    }
    if (citation.evidenceClass === "owner-game-note") {
      const excerpt = excerptsByCitation.get(citationId);
      const payload = entry.payload;
      const noteText =
        typeof payload === "object" && payload !== null
          ? (payload as Record<string, unknown>).text
          : undefined;
      if (excerpt === undefined || typeof noteText !== "string" || !noteText.includes(excerpt)) {
        throw new Error(`Reflection note excerpt is not exact current testimony: ${citationId}`);
      }
      if (
        !blocks.some(
          (block) => block.citationIds.includes(citationId) && block.text.includes(`"${excerpt}"`),
        )
      ) {
        throw new Error(
          `Reflection note excerpt must be visibly quoted by a citing block: ${citationId}`,
        );
      }
    } else if (excerptsByCitation.has(citationId)) {
      throw new Error(`Deterministic citations cannot have note excerpts: ${citationId}`);
    }
  }
  for (const citationId of excerptsByCitation.keys()) {
    if (!requested.has(citationId))
      throw new Error(`Uncited Reflection note excerpt: ${citationId}`);
  }
  return evidencePackage.citations
    .filter(({ citationId }) => requested.has(citationId))
    .map((citation) =>
      citation.evidenceClass === "owner-game-note"
        ? { ...citation, canonicalSummary: excerptsByCitation.get(citation.citationId) as string }
        : citation,
    );
}

export function createReflectionResultValidator(): ReflectionResultValidator {
  return Object.freeze({
    validate(input: ReflectionResultValidationInput): ReflectionCompleted {
      const submission = ReflectionModelSubmissionSchema.parse(input.submission).result;
      if (input.evidencePackage.evidenceIdentity.questionId !== input.questionId) {
        throw new Error("Reflection evidence package does not match the selected question");
      }
      if (
        input.evidencePackage.scope.exhaustiveNotes !== true ||
        input.evidencePackage.scope.examinedPresentNoteCount !==
          input.evidencePackage.scope.totalPresentNoteCount
      ) {
        throw new Error("Reflection validation requires complete note scope");
      }
      if (input.questionId === "pattern-exceptions") {
        validateCompletePatternScope(input.evidencePackage);
      }
      if (
        submission.outcome === "abstained" &&
        !REFLECTION_QUESTION_ABSTENTION_REASONS[input.questionId].some(
          (reason) => reason === submission.reason,
        )
      ) {
        throw new Error("Abstention reason is not authorized for the selected question");
      }

      const blocks =
        submission.outcome === "answered"
          ? [submission.centralSynthesis, ...submission.supportingBlocks]
          : submission.supportingBlocks;
      if (submission.outcome === "answered") {
        for (const block of blocks) validateAnsweredBlock(block, input.evidencePackage);
        const centralEntries = citedEntries(submission.centralSynthesis, input.evidencePackage);
        const independentNotes = new Set(
          centralEntries
            .filter(({ evidenceClass }) => evidenceClass === "owner-game-note")
            .map(({ sourceId }) => sourceId),
        );
        if (
          independentNotes.size <
          REFLECTION_QUESTION_POLICIES[input.questionId].minimumIndependentNotes
        ) {
          throw new Error("Central synthesis has insufficient independent testimony");
        }
        if (input.questionId === "pattern-exceptions") {
          validatePatternAnswer(submission.centralSynthesis, input.evidencePackage);
        }
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
