import { describe, expect, test } from "bun:test";
import {
  ReflectionCitationSchema,
  ReflectionDependencySchema,
  ReflectionEvidenceIdentitySchema,
  ReflectionScopeSchema,
  type ReflectionCitation,
  type ReflectionQuestionId,
} from "@shelf-judge/shared";
import type {
  GroundedEvidenceEntry,
  GroundedExaminedSource,
  GroundedEvidenceSnapshot,
} from "../../src/services/grounded-analysis/evidence-registry.js";
import type { ReflectionEvidencePackage } from "../../src/services/reflection-evidence-service.js";
import {
  createReflectionResultValidator,
  ReflectionModelSubmissionSchema,
} from "../../src/services/reflection-result-validator.js";

const GENERATED_AT = "2026-09-01T12:00:00.000Z";

function evidencePackage(questionId: ReflectionQuestionId): ReflectionEvidencePackage {
  const entries: GroundedEvidenceEntry[] = [
    {
      citationId: "note-1",
      sourceId: "game-1",
      sourceVersion: "1",
      evidenceClass: "owner-game-note",
      payload: { gameId: "game-1", text: "I value quick setup. Unrelated private detail." },
    },
    {
      citationId: "note-2",
      sourceId: "game-2",
      sourceVersion: "2",
      evidenceClass: "owner-game-note",
      payload: { gameId: "game-2", text: "Quick setup gets this played." },
    },
    {
      citationId: "identity-1",
      sourceId: "game:game-1:identity",
      sourceVersion: "v1",
      evidenceClass: "game-identity-ownership",
      payload: { gameId: "game-1", name: "Game 1", bggId: null, ownership: "owned" },
    },
    {
      citationId: "identity-2",
      sourceId: "game:game-2:identity",
      sourceVersion: "v1",
      evidenceClass: "game-identity-ownership",
      payload: { gameId: "game-2", name: "Game 2", bggId: null, ownership: "owned" },
    },
  ];
  if (questionId === "pattern-exceptions") {
    entries.push({
      citationId: "profile-1",
      sourceId: "profile:mechanic:1",
      sourceVersion: "v1",
      evidenceClass: "profile-evidence",
      payload: {
        candidateId: "mechanic:1",
        support: "supported",
        games: [{ gameId: "game-1" }, { gameId: "game-2" }],
        exclusions: [],
        confounders: [],
        comparator: { games: [] },
      },
    });
  }
  const citations: ReflectionCitation[] = entries.map((entry) =>
    ReflectionCitationSchema.parse({
      citationId: entry.citationId,
      sourceId: entry.sourceId,
      sourceVersion: entry.sourceVersion,
      evidenceClass: entry.evidenceClass,
      testimony: entry.evidenceClass === "owner-game-note",
      canonicalSummary: `Canonical ${entry.citationId}`,
      destination:
        entry.evidenceClass === "profile-evidence"
          ? { operationId: "shelf.profile.get", parameters: {} }
          : {
              operationId: "shelf.game.get",
              parameters: {
                gameId:
                  typeof entry.payload === "object" && entry.payload !== null
                    ? String((entry.payload as { gameId?: string }).gameId ?? "game-1")
                    : "game-1",
              },
            },
    }),
  );
  const byCitation = new Map(entries.map((entry) => [entry.citationId, entry]));
  const evidence: GroundedEvidenceSnapshot = Object.freeze({
    manifestId: "profile-reflection",
    manifestVersion: "1",
    evidenceClasses: Object.freeze([...new Set(entries.map(({ evidenceClass }) => evidenceClass))]),
    examinedSources: Object.freeze(
      entries.map(({ sourceId, sourceVersion, evidenceClass }) => ({
        sourceId,
        sourceVersion,
        evidenceClass,
      })),
    ),
    entries: Object.freeze(entries),
    hasSource: ({ sourceId, sourceVersion, evidenceClass }: GroundedExaminedSource) =>
      entries.some(
        (entry) =>
          entry.sourceId === sourceId &&
          entry.sourceVersion === sourceVersion &&
          entry.evidenceClass === evidenceClass,
      ),
    resolve: (citationId: string) => byCitation.get(citationId),
  });
  return Object.freeze({
    evidenceIdentity: ReflectionEvidenceIdentitySchema.parse({
      manifestVersion: 1,
      questionId,
      questionVersion: 1,
      collectionId: "collection-1",
      collectionSchemaVersion: 6,
      collectionRevision: 4,
      profileContractVersion: 1,
      profileAlgorithmVersion: 1,
      providerId: "provider-1",
      modelId: "model-1",
    }),
    snapshotFingerprint: "snapshot-1",
    scope: ReflectionScopeSchema.parse({
      examinedPresentNoteCount: 2,
      totalPresentNoteCount: 2,
      examinedGameCount: 2,
      relevantEligibleGameCount: 2,
      excludedGameCount: 0,
      exhaustiveNotes: true,
      ...(questionId === "pattern-exceptions" ? { patternCandidateIds: ["mechanic:1"] } : {}),
    }),
    evidence,
    citations: Object.freeze(citations),
    dependencies: Object.freeze([
      ReflectionDependencySchema.parse({ category: "note", gameId: "game-1", noteVersion: 1 }),
      ReflectionDependencySchema.parse({ category: "note", gameId: "game-2", noteVersion: 2 }),
      ReflectionDependencySchema.parse({
        category: "collection",
        sourceId: "collection-1",
        fingerprint: "collection-v4",
      }),
    ]),
    assembledAt: GENERATED_AT,
  });
}

function answeredSubmission(questionId: ReflectionQuestionId) {
  const citationIds = [
    "note-1",
    "note-2",
    "identity-1",
    "identity-2",
    ...(questionId === "pattern-exceptions" ? ["profile-1"] : []),
  ];
  return {
    result: {
      outcome: "answered" as const,
      centralSynthesis: {
        text: 'The notes say "I value quick setup." and "Quick setup gets this played." This is bounded.',
        citationIds,
      },
      supportingBlocks: [
        {
          text: 'Inspect "I value quick setup." and "Quick setup gets this played." directly.',
          citationIds,
        },
      ],
      noteExcerpts: [
        { citationId: "note-1", excerpt: "I value quick setup." },
        { citationId: "note-2", excerpt: "Quick setup gets this played." },
      ],
    },
  };
}

describe("ReflectionResultValidator", () => {
  const validator = createReflectionResultValidator();

  test.each(["repeated-values", "pattern-exceptions", "recurring-trade-offs"] as const)(
    "validates answered and abstained %s results independently",
    (questionId) => {
      const answered = validator.validate({
        questionId,
        submission: answeredSubmission(questionId),
        evidencePackage: evidencePackage(questionId),
        usage: { state: "reported", inferenceRoundTrips: 2, inputTokens: 12, outputTokens: 4 },
        generatedAt: GENERATED_AT,
      });
      expect(answered.outcome).toBe("answered");

      const abstained = validator.validate({
        questionId,
        submission: {
          result: {
            outcome: "abstained",
            reason:
              questionId === "pattern-exceptions" ? "no-supported-pattern" : "no-owner-testimony",
            explanation: "The bounded evidence is insufficient.",
            supportingBlocks: [],
            noteExcerpts: [],
          },
        },
        evidencePackage: evidencePackage(questionId),
        usage: { state: "unavailable" },
        generatedAt: GENERATED_AT,
      });
      expect(abstained.outcome).toBe("abstained");
    },
  );

  test("reconstructs all protected fields from the canonical evidence package", () => {
    const source = evidencePackage("repeated-values");
    const result = validator.validate({
      questionId: "repeated-values",
      submission: answeredSubmission("repeated-values"),
      evidencePackage: source,
      usage: { state: "reported", inferenceRoundTrips: 1 },
      generatedAt: GENERATED_AT,
    });

    expect(
      result.citations.find(({ citationId }) => citationId === "note-1")?.canonicalSummary,
    ).toBe("I value quick setup.");
    expect(JSON.stringify(result)).not.toContain("Unrelated private detail");
    expect(result.dependencies).toEqual([...source.dependencies]);
    expect(result.scope).toEqual(source.scope);
    expect(result.evidenceIdentity).toEqual(source.evidenceIdentity);
    expect(result.generatedAt).toBe(GENERATED_AT);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.dependencies)).toBe(true);
    expect(
      ReflectionModelSubmissionSchema.safeParse({
        ...answeredSubmission("repeated-values"),
        usage: { state: "reported", inferenceRoundTrips: 1 },
      }).success,
    ).toBe(false);
  });

  test("rejects unknown citations, unrelated deterministic support, and invalid usage ceilings", () => {
    const source = evidencePackage("repeated-values");
    const unknown = answeredSubmission("repeated-values");
    unknown.result.centralSynthesis.citationIds = ["note-1", "note-2", "unknown"];
    expect(() =>
      validator.validate({
        questionId: "repeated-values",
        submission: unknown,
        evidencePackage: source,
        usage: { state: "unavailable" },
        generatedAt: GENERATED_AT,
      }),
    ).toThrow("Unknown Reflection citation");

    const unrelated = answeredSubmission("repeated-values");
    unrelated.result.centralSynthesis.citationIds = ["note-1", "note-2", "identity-1"];
    expect(() =>
      validator.validate({
        questionId: "repeated-values",
        submission: unrelated,
        evidencePackage: source,
        usage: { state: "unavailable" },
        generatedAt: GENERATED_AT,
      }),
    ).toThrow("same game");

    expect(() =>
      validator.validate({
        questionId: "repeated-values",
        submission: answeredSubmission("repeated-values"),
        evidencePackage: source,
        usage: { state: "reported", inferenceRoundTrips: 3 },
        generatedAt: GENERATED_AT,
      }),
    ).toThrow();
  });

  test("rejects note excerpts that are not visibly quoted by a citing block", () => {
    const submission = answeredSubmission("repeated-values");
    submission.result.centralSynthesis.text = "A paraphrase without the cited testimony.";
    const supportingBlock = submission.result.supportingBlocks[0];
    if (supportingBlock === undefined) throw new Error("invalid test fixture");
    supportingBlock.text = "Another paraphrase.";
    expect(() =>
      validator.validate({
        questionId: "repeated-values",
        submission,
        evidencePackage: evidencePackage("repeated-values"),
        usage: { state: "unavailable" },
        generatedAt: GENERATED_AT,
      }),
    ).toThrow("quoted by a citing block");
  });

  test("requires a complete selected pattern candidate that supports every cited note", () => {
    const source = evidencePackage("pattern-exceptions");
    const submission = answeredSubmission("pattern-exceptions");
    submission.result.centralSynthesis.citationIds =
      submission.result.centralSynthesis.citationIds.filter(
        (citationId) => citationId !== "profile-1",
      );
    expect(() =>
      validator.validate({
        questionId: "pattern-exceptions",
        submission,
        evidencePackage: source,
        usage: { state: "unavailable" },
        generatedAt: GENERATED_AT,
      }),
    ).toThrow("authorized candidate");
  });

  test("rejects unsupported or incomplete pattern candidates", () => {
    const unsupported = evidencePackage("pattern-exceptions");
    const profile = unsupported.evidence.entries.find(
      ({ citationId }) => citationId === "profile-1",
    );
    if (profile === undefined || typeof profile.payload !== "object" || profile.payload === null) {
      throw new Error("invalid test fixture");
    }
    (profile.payload as Record<string, unknown>).support = "limited";
    expect(() =>
      validator.validate({
        questionId: "pattern-exceptions",
        submission: answeredSubmission("pattern-exceptions"),
        evidencePackage: unsupported,
        usage: { state: "unavailable" },
        generatedAt: GENERATED_AT,
      }),
    ).toThrow("authorized candidate");

    const incomplete = evidencePackage("pattern-exceptions");
    const incompleteProfile = incomplete.evidence.entries.find(
      ({ citationId }) => citationId === "profile-1",
    );
    if (
      incompleteProfile === undefined ||
      typeof incompleteProfile.payload !== "object" ||
      incompleteProfile.payload === null
    ) {
      throw new Error("invalid test fixture");
    }
    delete (incompleteProfile.payload as Record<string, unknown>).confounders;
    expect(() =>
      validator.validate({
        questionId: "pattern-exceptions",
        submission: answeredSubmission("pattern-exceptions"),
        evidencePackage: incomplete,
        usage: { state: "unavailable" },
        generatedAt: GENERATED_AT,
      }),
    ).toThrow("incomplete");
  });
});
