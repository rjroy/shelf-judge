import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  DEFAULT_REFLECTION_SETTINGS,
  REFLECTION_ABSTENTION_REASONS,
  REFLECTION_EVIDENCE_CATEGORIES,
  REFLECTION_EVIDENCE_CLASSES,
  REFLECTION_QUESTIONS,
  REFLECTION_QUESTION_IDS,
  REFLECTION_QUESTION_ABSTENTION_REASONS,
  REFLECTION_QUESTION_POLICIES,
  REFLECTION_UNAVAILABLE_REASONS,
  ReflectionAttemptStateSchema,
  ReflectionCacheStateSchema,
  ReflectionCancelRequestSchema,
  ReflectionCitationSchema,
  ReflectionCompletedSchema,
  ReflectionDependencySchema,
  ReflectionDestinationSchema,
  ReflectionDisclosureSchema,
  ReflectionDeleteRequestSchema,
  ReflectionGetRequestSchema,
  ReflectionGetResultSchema,
  ReflectionOperationResultSchema,
  ReflectionProviderUsageSchema,
  ReflectionQuestionStateSchema,
  ReflectionQuestionStateCollectionSchema,
  ReflectionRefreshRequestSchema,
  ReflectionScopeSchema,
  ReflectionSettingsSchema,
  ReflectionSettingsUpdateRequestSchema,
  ReflectionStreamEventHistorySchema,
  ReflectionStreamEventSchema,
  createGroundedEvidenceSchemas,
  createGroundedOperationResultSchema,
  createGroundedStreamSchemas,
  createGroundedUnavailableReasonSchema,
  getReflectionQuestionEvidenceClassSchema,
} from "../src/index";

const time = "2026-08-30T12:00:00.000Z";
const capability = "a".repeat(64);

const ownerCitation = {
  citationId: "citation-note",
  sourceId: "game-1",
  sourceVersion: "1",
  evidenceClass: "owner-game-note" as const,
  testimony: true as const,
  canonicalSummary: "Owner testimony excerpt",
  destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
};
const deterministicCitation = {
  citationId: "citation-score",
  sourceId: "game-1-score",
  sourceVersion: "collection-2",
  evidenceClass: "current-scoring" as const,
  testimony: false as const,
  canonicalSummary: "Current score",
  destination: { operationId: "shelf.profile.get", parameters: {} },
};
const secondOwnerCitation = {
  ...ownerCitation,
  citationId: "citation-note-2",
  sourceId: "game-2",
  destination: { operationId: "shelf.game.get", parameters: { gameId: "game-2" } },
};

function completed(
  questionId: (typeof REFLECTION_QUESTION_IDS)[number] = "repeated-values",
  outcome: "answered" | "abstained" = "answered",
  deterministicEvidenceClass: Exclude<
    (typeof REFLECTION_EVIDENCE_CLASSES)[number],
    "owner-game-note"
  > = "current-scoring",
) {
  const base = {
    supportingBlocks: [
      {
        text: "Support",
        citationIds: ["citation-note", "citation-note-2", "citation-score"],
      },
    ],
    citations: [
      structuredClone(ownerCitation),
      structuredClone(secondOwnerCitation),
      { ...structuredClone(deterministicCitation), evidenceClass: deterministicEvidenceClass },
    ],
    scope: {
      examinedPresentNoteCount: 2,
      totalPresentNoteCount: 2,
      examinedGameCount: 2,
      relevantEligibleGameCount: 2,
      excludedGameCount: 0,
      exhaustiveNotes: true,
      ...(questionId === "pattern-exceptions" ? { patternCandidateIds: ["mechanic:1"] } : {}),
    },
    evidenceIdentity: {
      manifestVersion: 1,
      questionId,
      questionVersion: 1,
      collectionId: "collection",
      collectionSchemaVersion: 6,
      collectionRevision: 2,
      profileContractVersion: 9,
      profileAlgorithmVersion: 11,
      providerId: "provider",
      modelId: "model",
    },
    dependencies: [
      { category: "note" as const, gameId: "game-1", noteVersion: 1 },
      { category: "note" as const, gameId: "game-2", noteVersion: 1 },
      { category: "scoring" as const, sourceId: "game-1", fingerprint: "score-1" },
    ],
    generatedAt: time,
    usage: { state: "reported" as const, inputTokens: 1, inferenceRoundTrips: 1 },
  };
  return outcome === "answered"
    ? {
        ...base,
        outcome,
        centralSynthesis: {
          text: "A grounded synthesis",
          citationIds: ["citation-note", "citation-note-2", "citation-score"],
        },
      }
    : { ...base, outcome, reason: "no-material-synthesis", explanation: "Nothing useful to add" };
}

describe("serialized Reflection questions", () => {
  test("locks exactly three version-one questions in fixed order and default settings", () => {
    expect(REFLECTION_QUESTIONS).toEqual([
      {
        id: "repeated-values",
        version: 1,
        wording: "What qualities do I repeatedly value in my games?",
        userJob:
          "Articulate a criterion the owner has expressed across games but has not represented as a structured axis or deterministic Profile card.",
        requiredEvidence:
          "Present notes from at least two distinct games that independently express the same bounded quality, plus current evidence for each cited game's identity and at least one of current fitness, score breakdown, play evidence, imported metadata, ownership, or supported Profile association.",
        usefulAnswerTest:
          "The answer names the repeated criterion in language no stronger than the notes, explains how current evidence supports or limits it, and includes a material counterexample or says that no material counterexample appears in the retrieved scope. It must not merely concatenate or summarize notes.",
        abstentionRule:
          "Abstain when fewer than two independent present notes support one criterion; the apparent repetition depends on copied, boilerplate, or semantically empty text; current evidence cannot connect the testimony to the collection; a counterexample materially defeats the synthesis; or the result would only restate an existing axis, ranking, or note.",
        enabledByDefault: true,
      },
      {
        id: "pattern-exceptions",
        version: 1,
        wording: "Where does my experience complicate my collection's strongest patterns?",
        userJob:
          "Understand where owner-described experience qualifies a supported deterministic mechanic, designer, or artist association.",
        requiredEvidence:
          "The complete deterministic candidate set consisting of every class's current `overviewEntityIds` (at most the configured overview limit, currently three, from each class's exact `bestFit` ordering); complete comparator, support, dispersion, exclusions, confounders, and supporting-game evidence for every candidate; present notes on at least two supporting games of the selected candidate; and at least one note-backed material exception, competing explanation, or meaningful difference within that association. The daemon examines candidates in class order `mechanic`, `designer`, `artist`, then their serialized overview order. It records coverage of the complete candidate set before answering or abstaining.",
        usefulAnswerTest:
          "The answer leaves the deterministic association intact, identifies a specific qualification that changes how the owner might describe it, and discloses co-occurrence, collaborator, veto, sparse-note, or metadata confounders that could change the interpretation.",
        abstentionRule:
          "Abstain when no entity is supported, fewer than two supporting games have relevant present notes, no material qualification exists, the qualification depends only on a low score or outlier calculation, or the answer would repeat the entity card and arithmetic.",
        enabledByDefault: true,
      },
      {
        id: "recurring-trade-offs",
        version: 1,
        wording: "What trade-offs recur in how I describe my games?",
        userJob:
          "Give the owner concise language for a recurring positive-versus-limiting consideration they have already expressed across different games.",
        requiredEvidence:
          "Present notes from at least two distinct games, each independently expressing both the positive and limiting side of the same trade-off, plus relevant current game identity and deterministic evidence that tests the stated context. Splitting the positive side into one note and the limiting side into another establishes disagreement, not recurrence, and does not qualify.",
        usefulAnswerTest:
          "The answer names both sides, identifies where the trade-off recurs and where it does not, and distinguishes testimony from metadata or computed association. It gives the owner a proposition they can reject or refine without turning it into advice.",
        abstentionRule:
          'Abstain when one side is inferred from missing notes, low plays, age, ownership, rating, or another proxy; only one game expresses the trade-off; current evidence materially contradicts the synthesis; or generic language such as "depth versus accessibility" is not traceable to specific testimony.',
        enabledByDefault: true,
      },
    ]);
    expect(ReflectionSettingsSchema.parse(DEFAULT_REFLECTION_SETTINGS)).toEqual({
      ...DEFAULT_REFLECTION_SETTINGS,
      questions: [...DEFAULT_REFLECTION_SETTINGS.questions],
    });
    expect(
      ReflectionSettingsSchema.safeParse({
        ...DEFAULT_REFLECTION_SETTINGS,
        questions: [...DEFAULT_REFLECTION_SETTINGS.questions].reverse(),
      }).success,
    ).toBe(false);
  });

  test("locks exact narrowed evidence authorization for each question", () => {
    const gameEvidence = [
      "owner-game-note",
      "game-identity-ownership",
      "current-scoring",
      "imported-metadata",
      "play-acquisition",
      "collection-structure",
    ] as const;
    expect(REFLECTION_QUESTION_POLICIES).toEqual({
      "repeated-values": {
        questionVersion: 1,
        authorizedEvidenceClasses: gameEvidence,
        minimumIndependentNotes: 2,
        requiresCompletePatternCandidates: false,
      },
      "pattern-exceptions": {
        questionVersion: 1,
        authorizedEvidenceClasses: [
          "owner-game-note",
          "game-identity-ownership",
          "current-scoring",
          "imported-metadata",
          "play-acquisition",
          "collection-structure",
          "profile-evidence",
        ],
        minimumIndependentNotes: 2,
        requiresCompletePatternCandidates: true,
      },
      "recurring-trade-offs": {
        questionVersion: 1,
        authorizedEvidenceClasses: gameEvidence,
        minimumIndependentNotes: 2,
        requiresCompletePatternCandidates: false,
      },
    });
    const manifest = new Set(REFLECTION_EVIDENCE_CLASSES);
    for (const policy of Object.values(REFLECTION_QUESTION_POLICIES)) {
      expect(
        policy.authorizedEvidenceClasses.every((evidenceClass) => manifest.has(evidenceClass)),
      ).toBe(true);
    }
    expect(
      getReflectionQuestionEvidenceClassSchema("pattern-exceptions").safeParse("profile-evidence")
        .success,
    ).toBe(true);
    for (const questionId of ["repeated-values", "recurring-trade-offs"] as const) {
      expect(
        getReflectionQuestionEvidenceClassSchema(questionId).safeParse("profile-evidence").success,
        questionId,
      ).toBe(false);

      const unauthorizedResult = completed(questionId, "answered", "profile-evidence");
      expect(ReflectionCompletedSchema.safeParse(unauthorizedResult).success, questionId).toBe(
        false,
      );
    }
    const authorizedPatternResult = completed("pattern-exceptions", "answered", "profile-evidence");
    expect(ReflectionCompletedSchema.safeParse(authorizedPatternResult).success).toBe(true);
  });
});

describe("feature-isolated grounded registries", () => {
  test("does not authorize evidence, destinations, or reasons from another feature", () => {
    const reflection = createGroundedEvidenceSchemas({
      evidenceClasses: ["reflection-note", "reflection-score"],
      dependencyCategories: ["note", "score"],
      destinations: { reflection: z.object({ gameId: z.string() }).strict() },
    });
    const analyst = createGroundedEvidenceSchemas({
      evidenceClasses: ["analyst-note", "analyst-search"],
      dependencyCategories: ["note", "search"],
      destinations: { analyst: z.object({ queryId: z.string() }).strict() },
    });
    expect(reflection.EvidenceClassSchema.safeParse("analyst-search").success).toBe(false);
    expect(analyst.EvidenceClassSchema.safeParse("reflection-score").success).toBe(false);
    expect(
      reflection.DestinationSchema.safeParse({
        operationId: "analyst",
        parameters: { queryId: "q" },
      }).success,
    ).toBe(false);
    expect(
      analyst.DestinationSchema.safeParse({
        operationId: "reflection",
        parameters: { gameId: "g" },
      }).success,
    ).toBe(false);

    const reflectionReasons = createGroundedUnavailableReasonSchema(["reflection-failure"]);
    const analystReasons = createGroundedUnavailableReasonSchema(["analyst-failure"]);
    expect(reflectionReasons.safeParse("analyst-failure").success).toBe(false);
    expect(analystReasons.safeParse("reflection-failure").success).toBe(false);

    const reflectionEvents = createGroundedStreamSchemas([
      { type: "reflection-event", terminal: true, payload: { reflectionId: z.string() } },
    ]);
    const analystEvents = createGroundedStreamSchemas([
      { type: "analyst-event", terminal: true, payload: { turnId: z.string() } },
    ]);
    const envelope = {
      version: 1,
      operationId: "op",
      sequence: 0,
      occurredAt: time,
      terminal: true,
    };
    expect(
      reflectionEvents.EventSchema.safeParse({
        ...envelope,
        type: "analyst-event",
        turnId: "turn",
      }).success,
    ).toBe(false);
    expect(
      analystEvents.EventSchema.safeParse({
        ...envelope,
        type: "reflection-event",
        reflectionId: "reflection",
      }).success,
    ).toBe(false);

    const reflectionResults = createGroundedOperationResultSchema([
      { outcome: "reflection-result", payload: { reflectionId: z.string() } },
    ]);
    const analystResults = createGroundedOperationResultSchema([
      { outcome: "analyst-result", payload: { turnId: z.string() } },
    ]);
    expect(reflectionResults.safeParse({ outcome: "analyst-result", turnId: "turn" }).success).toBe(
      false,
    );
    expect(
      analystResults.safeParse({ outcome: "reflection-result", reflectionId: "reflection" })
        .success,
    ).toBe(false);
  });
});

describe("Reflection result and evidence contracts", () => {
  test("accepts answered and every question-specific abstained result", () => {
    for (const questionId of REFLECTION_QUESTION_IDS) {
      expect(ReflectionCompletedSchema.safeParse(completed(questionId)).success, questionId).toBe(
        true,
      );
    }
    expect(REFLECTION_QUESTION_ABSTENTION_REASONS).toEqual({
      "repeated-values": [
        "no-owner-testimony",
        "insufficient-independent-testimony",
        "no-material-synthesis",
        "conflicting-evidence",
        "incomplete-scope",
        "question-not-applicable",
      ],
      "pattern-exceptions": [...REFLECTION_ABSTENTION_REASONS],
      "recurring-trade-offs": [
        "no-owner-testimony",
        "insufficient-independent-testimony",
        "no-material-synthesis",
        "conflicting-evidence",
        "incomplete-scope",
        "question-not-applicable",
      ],
    });
    for (const questionId of REFLECTION_QUESTION_IDS) {
      const permitted = new Set<string>(REFLECTION_QUESTION_ABSTENTION_REASONS[questionId]);
      for (const reason of REFLECTION_ABSTENTION_REASONS) {
        const value = completed(questionId, "abstained");
        if (value.outcome !== "abstained") throw new Error("Expected abstained fixture");
        value.reason = reason;
        expect(ReflectionCompletedSchema.safeParse(value).success, `${questionId}:${reason}`).toBe(
          permitted.has(reason),
        );
      }
    }
  });

  test("accepts citation and dependency variants and rejects invalid identities", () => {
    expect(ReflectionCitationSchema.safeParse(ownerCitation).success).toBe(true);
    for (const evidenceClass of REFLECTION_EVIDENCE_CLASSES.slice(1)) {
      expect(
        ReflectionCitationSchema.safeParse({ ...deterministicCitation, evidenceClass }).success,
        evidenceClass,
      ).toBe(true);
    }
    for (const category of REFLECTION_EVIDENCE_CATEGORIES) {
      const dependency =
        category === "note"
          ? { category, gameId: "g", noteVersion: 1 }
          : { category, sourceId: "source", fingerprint: "fingerprint" };
      expect(ReflectionDependencySchema.safeParse(dependency).success, category).toBe(true);
    }
    for (const noteVersion of [0, 1, 2]) {
      expect(
        ReflectionDependencySchema.safeParse({ category: "note", gameId: "g", noteVersion })
          .success,
        String(noteVersion),
      ).toBe(true);
    }
    for (const noteVersion of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        ReflectionDependencySchema.safeParse({ category: "note", gameId: "g", noteVersion })
          .success,
        String(noteVersion),
      ).toBe(false);
    }
    expect(ReflectionCitationSchema.safeParse({ ...ownerCitation, testimony: false }).success).toBe(
      false,
    );
    expect(
      ReflectionCitationSchema.safeParse({ ...deterministicCitation, testimony: true }).success,
    ).toBe(false);
    expect(
      ReflectionDependencySchema.safeParse({ category: "note", sourceId: "g", fingerprint: "f" })
        .success,
    ).toBe(false);

    const duplicateCitationId = completed();
    duplicateCitationId.citations[2].citationId = duplicateCitationId.citations[0].citationId;
    expect(ReflectionCompletedSchema.safeParse(duplicateCitationId).success).toBe(false);
    const duplicateSource = completed();
    duplicateSource.citations[2] = {
      ...duplicateSource.citations[2],
      sourceId: duplicateSource.citations[0].sourceId,
      sourceVersion: duplicateSource.citations[0].sourceVersion,
      evidenceClass: duplicateSource.citations[0].evidenceClass,
      testimony: true,
    } as (typeof duplicateSource.citations)[number];
    expect(ReflectionCompletedSchema.safeParse(duplicateSource).success).toBe(false);
    const duplicateDependency = completed();
    duplicateDependency.dependencies.push({ category: "note", gameId: "game-1", noteVersion: 2 });
    expect(ReflectionCompletedSchema.safeParse(duplicateDependency).success).toBe(false);
    const missingNoteDependency = completed();
    missingNoteDependency.dependencies = missingNoteDependency.dependencies.filter(
      (dependency) => dependency.category !== "note" || dependency.gameId !== "game-2",
    );
    expect(ReflectionCompletedSchema.safeParse(missingNoteDependency).success).toBe(false);
    const mismatchedNoteDependency = completed();
    const gameTwoDependency = mismatchedNoteDependency.dependencies.find(
      (dependency) => dependency.category === "note" && dependency.gameId === "game-2",
    );
    if (gameTwoDependency?.category !== "note") throw new Error("Expected note dependency");
    gameTwoDependency.noteVersion = 2;
    expect(ReflectionCompletedSchema.safeParse(mismatchedNoteDependency).success).toBe(false);
    expect(
      ReflectionCitationSchema.safeParse({ ...ownerCitation, sourceVersion: "0" }).success,
    ).toBe(false);
    expect(
      ReflectionCitationSchema.safeParse({ ...ownerCitation, sourceVersion: "01" }).success,
    ).toBe(false);
    expect(
      ReflectionCitationSchema.safeParse({
        ...ownerCitation,
        sourceVersion: String(Number.MAX_SAFE_INTEGER + 1),
      }).success,
    ).toBe(false);
    const unresolved = completed();
    if (unresolved.outcome !== "answered") throw new Error("Expected answered fixture");
    unresolved.centralSynthesis.citationIds = ["missing"];
    expect(ReflectionCompletedSchema.safeParse(unresolved).success).toBe(false);

    const insufficientTestimony = completed();
    insufficientTestimony.citations = insufficientTestimony.citations.filter(
      ({ citationId }) => citationId !== "citation-note-2",
    );
    insufficientTestimony.supportingBlocks[0].citationIds = ["citation-note", "citation-score"];
    if (insufficientTestimony.outcome !== "answered") throw new Error("Expected answered fixture");
    insufficientTestimony.centralSynthesis.citationIds = ["citation-note", "citation-score"];
    expect(ReflectionCompletedSchema.safeParse(insufficientTestimony).success).toBe(false);

    const secondNoteOnlyInSupport = completed();
    if (secondNoteOnlyInSupport.outcome !== "answered")
      throw new Error("Expected answered fixture");
    secondNoteOnlyInSupport.centralSynthesis.citationIds = ["citation-note", "citation-score"];
    expect(ReflectionCompletedSchema.safeParse(secondNoteOnlyInSupport).success).toBe(false);

    const missingDeterministicClass = completed();
    missingDeterministicClass.supportingBlocks[0].citationIds = [
      "citation-note",
      "citation-note-2",
    ];
    expect(ReflectionCompletedSchema.safeParse(missingDeterministicClass).success).toBe(false);

    const uncitedCentralSynthesis = completed();
    if (uncitedCentralSynthesis.outcome !== "answered")
      throw new Error("Expected answered fixture");
    uncitedCentralSynthesis.centralSynthesis.citationIds = [];
    expect(ReflectionCompletedSchema.safeParse(uncitedCentralSynthesis).success).toBe(false);

    const uncitedSupportingBlock = completed();
    uncitedSupportingBlock.supportingBlocks[0].citationIds = [];
    expect(ReflectionCompletedSchema.safeParse(uncitedSupportingBlock).success).toBe(false);

    const abstainedLimitation = completed("repeated-values", "abstained");
    abstainedLimitation.supportingBlocks = [{ text: "No evidence was available", citationIds: [] }];
    expect(ReflectionCompletedSchema.safeParse(abstainedLimitation).success).toBe(true);
  });

  test("rejects arbitrary destinations and destination parameters", () => {
    expect(
      ReflectionDestinationSchema.safeParse({ operationId: "https://example.com", parameters: {} })
        .success,
    ).toBe(false);
    expect(
      ReflectionDestinationSchema.safeParse({
        operationId: "shelf.game.get",
        parameters: { gameId: "g", secret: "x" },
      }).success,
    ).toBe(false);
  });

  test("enforces scope totals and pattern candidate combinations", () => {
    expect(ReflectionScopeSchema.safeParse(completed().scope).success).toBe(true);
    for (const scope of [
      { ...completed().scope, examinedPresentNoteCount: 3 },
      { ...completed().scope, examinedGameCount: 3 },
      { ...completed().scope, exhaustiveNotes: false },
      { ...completed("pattern-exceptions").scope, patternCandidateIds: ["x", "x"] },
    ]) {
      expect(ReflectionScopeSchema.safeParse(scope).success).toBe(false);
    }
    const wrongQuestion = completed();
    wrongQuestion.scope.patternCandidateIds = ["x"];
    expect(ReflectionCompletedSchema.safeParse(wrongQuestion).success).toBe(false);
    const missingCandidates = completed("pattern-exceptions");
    delete missingCandidates.scope.patternCandidateIds;
    expect(ReflectionCompletedSchema.safeParse(missingCandidates).success).toBe(false);
  });

  test("rejects invalid variants, nested unknown fields, counters, costs, and currencies", () => {
    const answered = completed() as Record<string, unknown>;
    answered.reason = "no-owner-testimony";
    expect(ReflectionCompletedSchema.safeParse(answered).success).toBe(false);
    const abstained = completed("repeated-values", "abstained") as Record<string, unknown>;
    abstained.centralSynthesis = { text: "forbidden", citationIds: [] };
    expect(ReflectionCompletedSchema.safeParse(abstained).success).toBe(false);
    const unknown = completed();
    unknown.citations[0].destination.parameters = { gameId: "game-1", unknown: "x" };
    expect(ReflectionCompletedSchema.safeParse(unknown).success).toBe(false);
    expect(
      ReflectionProviderUsageSchema.safeParse({ state: "reported", inferenceRoundTrips: 0 })
        .success,
    ).toBe(false);
    expect(
      ReflectionProviderUsageSchema.safeParse({ state: "reported", inferenceRoundTrips: 3 })
        .success,
    ).toBe(false);
    for (const amount of ["-1", "+1", "01", ".5", "1."]) {
      expect(
        ReflectionProviderUsageSchema.safeParse({
          state: "reported",
          inferenceRoundTrips: 1,
          monetaryCost: { amount, currency: "USD" },
        }).success,
        amount,
      ).toBe(false);
    }
    expect(
      ReflectionProviderUsageSchema.safeParse({
        state: "reported",
        inferenceRoundTrips: 1,
        monetaryCost: { amount: "1.25", currency: "ZZZ" },
      }).success,
    ).toBe(false);
    expect(
      ReflectionScopeSchema.safeParse({
        ...completed().scope,
        examinedGameCount: Number.MAX_SAFE_INTEGER + 1,
        relevantEligibleGameCount: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      ReflectionProviderUsageSchema.safeParse({
        state: "reported",
        inputTokens: Number.MAX_SAFE_INTEGER + 1,
        inferenceRoundTrips: 1,
      }).success,
    ).toBe(false);
  });
});

describe("Reflection state, disclosure, operations, and streams", () => {
  test("covers every cache and attempt state and unavailable reason", () => {
    for (const cache of [
      { state: "none" },
      { state: "current", result: completed() },
      { state: "stale", changedCategories: ["collection"], result: completed() },
    ]) {
      expect(ReflectionCacheStateSchema.safeParse(cache).success).toBe(true);
    }
    const attempts = [
      { state: "idle" },
      { state: "refreshing", batchId: "b", startedAt: time },
      { state: "cancelled", occurredAt: time },
      { state: "purged", reason: "note-changed", occurredAt: time },
      { state: "purged", reason: "game-deleted", occurredAt: time },
      { state: "purged", reason: "owner-deleted", occurredAt: time },
      ...REFLECTION_UNAVAILABLE_REASONS.map((reason) => ({
        state: "unavailable",
        reason,
        occurredAt: time,
      })),
    ];
    for (const attempt of attempts) {
      expect(ReflectionAttemptStateSchema.safeParse(attempt).success, JSON.stringify(attempt)).toBe(
        true,
      );
    }
    expect(
      ReflectionAttemptStateSchema.safeParse({
        state: "unavailable",
        reason: "analyst-only",
        occurredAt: time,
      }).success,
    ).toBe(false);
  });

  test("enforces disabled, purged, and preserved-prior-cache state invariants", () => {
    const currentCache = { state: "current" as const, result: completed() };
    const staleCache = {
      state: "stale" as const,
      changedCategories: ["collection" as const],
      result: completed(),
    };
    for (const cache of [currentCache, staleCache]) {
      expect(
        ReflectionQuestionStateSchema.safeParse({
          questionId: "repeated-values",
          enabled: false,
          cache,
          attempt: { state: "idle" },
        }).success,
      ).toBe(false);
    }
    for (const attempt of [
      { state: "refreshing", batchId: "b", startedAt: time },
      { state: "cancelled", occurredAt: time },
      { state: "unavailable", reason: "transport", occurredAt: time },
      { state: "purged", reason: "owner-deleted", occurredAt: time },
    ]) {
      expect(
        ReflectionQuestionStateSchema.safeParse({
          questionId: "repeated-values",
          enabled: false,
          cache: { state: "none" },
          attempt,
        }).success,
        attempt.state,
      ).toBe(false);
    }
    for (const cache of [currentCache, staleCache]) {
      expect(
        ReflectionQuestionStateSchema.safeParse({
          questionId: "repeated-values",
          enabled: true,
          cache,
          attempt: { state: "purged", reason: "note-changed", occurredAt: time },
        }).success,
      ).toBe(false);
    }
    expect(
      ReflectionQuestionStateSchema.safeParse({
        questionId: "repeated-values",
        enabled: true,
        cache: { state: "none" },
        attempt: { state: "purged", reason: "note-changed", occurredAt: time },
      }).success,
    ).toBe(true);
    for (const attempt of [
      { state: "cancelled", occurredAt: time },
      { state: "unavailable", reason: "transport", occurredAt: time },
    ]) {
      expect(
        ReflectionQuestionStateSchema.safeParse({
          questionId: "repeated-values",
          enabled: true,
          cache: currentCache,
          attempt,
        }).success,
      ).toBe(true);
    }
  });

  test("validates exact cancellation, disclosure, and operation result variants", () => {
    expect(ReflectionCancelRequestSchema.safeParse({ batchId: "b", capability }).success).toBe(
      true,
    );
    for (const invalid of [capability.toUpperCase(), "a".repeat(63), "g".repeat(64)]) {
      expect(
        ReflectionCancelRequestSchema.safeParse({ batchId: "b", capability: invalid }).success,
      ).toBe(false);
    }
    const disclosure = {
      version: 1,
      provider: { providerId: "p", modelId: "m", extensionIds: [] },
      evidenceClasses: ["owner-game-note"],
      relevantOwnerNotesMayBeTransmitted: true,
      providerProcessingAndRetentionFollowProviderPolicy: true,
      localRetention: "Validated result and safe citation snapshots",
      applicationTokenCap: null,
      applicationMonetaryCap: null,
      modelOperationCount: 3,
      maximumProviderRoundTrips: 6,
      cancellation: "Stop the active batch",
    };
    expect(ReflectionDisclosureSchema.safeParse(disclosure).success).toBe(true);
    expect(
      ReflectionDisclosureSchema.safeParse({
        ...disclosure,
        relevantOwnerNotesMayBeTransmitted: false,
      }).success,
    ).toBe(false);
    const operationResults = [
      { outcome: "accepted", requestId: "r" },
      { outcome: "not-found", requestId: "r" },
      { outcome: "busy", requestId: "r", activeBatchId: "b" },
      { outcome: "unauthorized", requestId: "r" },
      { outcome: "unavailable", requestId: "r", reason: "transport" },
    ];
    for (const result of operationResults) {
      expect(ReflectionOperationResultSchema.safeParse(result).success).toBe(true);
    }
    expect(ReflectionGetRequestSchema.safeParse({}).success).toBe(true);
    expect(ReflectionGetRequestSchema.safeParse({ unknown: true }).success).toBe(false);
    expect(
      ReflectionSettingsUpdateRequestSchema.safeParse({
        requestId: "r",
        questionId: "repeated-values",
        enabled: false,
      }).success,
    ).toBe(true);
    expect(
      ReflectionRefreshRequestSchema.safeParse({
        batchId: "b",
        requestId: "r",
        cancellationCapability: capability,
        questionId: "pattern-exceptions",
        disclosure: { version: 1, providerId: "p", modelId: "m", acknowledged: true },
      }).success,
    ).toBe(true);
    expect(
      ReflectionDeleteRequestSchema.safeParse({ requestId: "r", confirmed: true }).success,
    ).toBe(true);

    const questionStates = REFLECTION_QUESTION_IDS.map((questionId) => ({
      questionId,
      enabled: true,
      cache: { state: "none" },
      attempt: { state: "idle" },
    }));
    expect(ReflectionQuestionStateCollectionSchema.safeParse(questionStates).success).toBe(true);
    expect(
      ReflectionQuestionStateCollectionSchema.safeParse([...questionStates].reverse()).success,
    ).toBe(false);
  });

  test("binds cached and streamed results to their outer question identities", () => {
    for (const state of ["current", "stale"] as const) {
      const cache =
        state === "current"
          ? { state, result: completed("pattern-exceptions") }
          : {
              state,
              changedCategories: ["collection"],
              result: completed("pattern-exceptions"),
            };
      expect(
        ReflectionQuestionStateSchema.safeParse({
          questionId: "repeated-values",
          enabled: true,
          cache,
          attempt: { state: "idle" },
        }).success,
        state,
      ).toBe(false);
    }

    const questions = REFLECTION_QUESTION_IDS.map((questionId) => ({
      questionId,
      enabled: true,
      cache: { state: "current", result: completed(questionId) },
      attempt: { state: "idle" },
    }));
    const getResult = {
      contractVersion: 1,
      configuration: {
        status: "configured",
        identity: { providerId: "p", modelId: "m", extensionIds: [] },
      },
      settings: DEFAULT_REFLECTION_SETTINGS,
      questions,
    };
    expect(ReflectionGetResultSchema.safeParse(getResult).success).toBe(true);
    const mismatchedResult = structuredClone(getResult);
    mismatchedResult.questions[0].cache.result = completed("pattern-exceptions");
    expect(ReflectionGetResultSchema.safeParse(mismatchedResult).success).toBe(false);
    const mismatchedSettings = {
      ...getResult,
      settings: {
        ...getResult.settings,
        questions: [
          { questionId: "repeated-values", enabled: false },
          ...getResult.settings.questions.slice(1),
        ],
      },
    };
    expect(ReflectionGetResultSchema.safeParse(mismatchedSettings).success).toBe(false);

    expect(
      ReflectionStreamEventSchema.safeParse({
        version: 1,
        operationId: "op",
        sequence: 0,
        occurredAt: time,
        type: "validated-result",
        terminal: false,
        batchId: "b",
        questionId: "repeated-values",
        result: completed("pattern-exceptions"),
      }).success,
    ).toBe(false);
  });

  test("covers every typed event and enforces terminal sequence history", () => {
    const base = { version: 1, operationId: "op", occurredAt: time, terminal: false };
    const events = [
      {
        ...base,
        sequence: 0,
        type: "accepted",
        batchId: "b",
        requestId: "r",
        cancellationCapability: capability,
        questionIds: ["repeated-values"],
      },
      {
        ...base,
        sequence: 1,
        type: "question-started",
        batchId: "b",
        questionId: "repeated-values",
        questionVersion: 1,
      },
      {
        ...base,
        sequence: 2,
        type: "evidence-retrieval",
        batchId: "b",
        questionId: "repeated-values",
        status: "completed",
        examinedItemCount: 2,
      },
      {
        ...base,
        sequence: 3,
        type: "model-status",
        batchId: "b",
        questionId: "repeated-values",
        status: "validating",
      },
      {
        ...base,
        sequence: 4,
        type: "validated-result",
        batchId: "b",
        questionId: "repeated-values",
        result: completed(),
      },
      {
        ...base,
        sequence: 5,
        type: "provider-usage",
        batchId: "b",
        questionId: "repeated-values",
        usage: { state: "unavailable" },
      },
      {
        ...base,
        sequence: 6,
        type: "cache-outcome",
        batchId: "b",
        questionId: "repeated-values",
        outcome: "replaced",
      },
      {
        ...base,
        sequence: 7,
        type: "question-completed",
        batchId: "b",
        questionId: "repeated-values",
        outcome: "answered",
        batchComplete: false,
      },
      {
        ...base,
        sequence: 8,
        type: "question-completed",
        terminal: true,
        batchId: "b",
        questionId: "repeated-values",
        outcome: "answered",
        batchComplete: true,
      },
    ];
    for (const event of events) {
      expect(ReflectionStreamEventSchema.safeParse(event).success, event.type).toBe(true);
    }
    for (const terminal of [
      { ...base, sequence: 0, type: "cancelled", terminal: true, batchId: "b" },
      { ...base, sequence: 0, type: "failed", terminal: true, batchId: "b", reason: "transport" },
    ]) {
      expect(ReflectionStreamEventSchema.safeParse(terminal).success).toBe(true);
    }
    for (const questionIds of [
      ["repeated-values", "repeated-values"],
      ["pattern-exceptions", "repeated-values"],
      ["unknown-question"],
    ]) {
      expect(
        ReflectionStreamEventSchema.safeParse({ ...events[0], questionIds }).success,
        questionIds.join(","),
      ).toBe(false);
    }
    const validSingleQuestionHistory = [...events.slice(0, 7), { ...events[8], sequence: 7 }];
    expect(ReflectionStreamEventHistorySchema.safeParse(validSingleQuestionHistory).success).toBe(
      true,
    );
    expect(ReflectionStreamEventHistorySchema.safeParse([]).success).toBe(false);
    expect(ReflectionStreamEventHistorySchema.safeParse(events.slice(0, -1)).success).toBe(false);
    expect(ReflectionStreamEventHistorySchema.safeParse([events[0], events[2]]).success).toBe(
      false,
    );
    expect(
      ReflectionStreamEventHistorySchema.safeParse([
        events[0],
        { ...events[1], sequence: 0 },
        ...events.slice(2),
      ]).success,
    ).toBe(false);
    const outOfOrderHistory = [
      {
        ...events[0],
        sequence: 0,
        questionIds: ["repeated-values", "pattern-exceptions"],
      },
      { ...events[1], sequence: 1, questionId: "pattern-exceptions" },
      {
        ...base,
        sequence: 2,
        type: "failed",
        terminal: true,
        batchId: "b",
        questionId: "pattern-exceptions",
        reason: "transport",
      },
    ];
    expect(ReflectionStreamEventHistorySchema.safeParse(outOfOrderHistory).success).toBe(false);

    const cancelledPartialHistory = [
      {
        ...events[0],
        sequence: 0,
        questionIds: ["repeated-values", "pattern-exceptions"],
      },
      { ...events[1], sequence: 1 },
      {
        ...base,
        sequence: 2,
        type: "cancelled",
        terminal: true,
        batchId: "b",
        questionId: "repeated-values",
      },
    ];
    expect(ReflectionStreamEventHistorySchema.safeParse(cancelledPartialHistory).success).toBe(
      true,
    );

    const completeOrderedHistory = [
      {
        ...events[0],
        sequence: 0,
        questionIds: ["repeated-values", "pattern-exceptions"],
      },
      { ...events[1], sequence: 1 },
      { ...events[4], sequence: 2 },
      {
        ...events[7],
        sequence: 3,
        questionId: "repeated-values",
        batchComplete: false,
        terminal: false,
      },
      { ...events[1], sequence: 4, questionId: "pattern-exceptions" },
      {
        ...events[4],
        sequence: 5,
        questionId: "pattern-exceptions",
        result: completed("pattern-exceptions"),
      },
      {
        ...events[8],
        sequence: 6,
        questionId: "pattern-exceptions",
        batchComplete: true,
        terminal: true,
      },
    ];
    expect(ReflectionStreamEventHistorySchema.safeParse(completeOrderedHistory).success).toBe(true);

    const fullyCorrelatedHistory = [
      {
        ...events[0],
        sequence: 0,
        questionIds: ["repeated-values", "pattern-exceptions"],
      },
      ...events.slice(1, 8).map((event, index) => ({ ...event, sequence: index + 1 })),
      { ...events[1], sequence: 8, questionId: "pattern-exceptions" },
      {
        ...events[4],
        sequence: 9,
        questionId: "pattern-exceptions",
        result: completed("pattern-exceptions"),
      },
      {
        ...events[8],
        sequence: 10,
        questionId: "pattern-exceptions",
        batchComplete: true,
        terminal: true,
      },
    ];
    expect(ReflectionStreamEventHistorySchema.safeParse(fullyCorrelatedHistory).success).toBe(true);
    for (let index = 1; index < fullyCorrelatedHistory.length; index += 1) {
      const crossBatch = structuredClone(fullyCorrelatedHistory);
      crossBatch[index].batchId = "other-batch";
      expect(
        ReflectionStreamEventHistorySchema.safeParse(crossBatch).success,
        `cross-batch:${crossBatch[index].type}`,
      ).toBe(false);
    }
    for (const terminalHistory of [
      cancelledPartialHistory,
      [
        { ...events[0], sequence: 0 },
        { ...events[1], sequence: 1 },
        {
          ...base,
          sequence: 2,
          type: "failed",
          terminal: true,
          batchId: "b",
          questionId: "repeated-values",
          reason: "transport",
        },
      ],
    ]) {
      const crossBatch = structuredClone(terminalHistory);
      crossBatch[crossBatch.length - 1].batchId = "other-batch";
      expect(ReflectionStreamEventHistorySchema.safeParse(crossBatch).success).toBe(false);
    }

    const mismatchedCompletionOutcome = validSingleQuestionHistory.map((event, index) =>
      index === validSingleQuestionHistory.length - 1 ? { ...event, outcome: "abstained" } : event,
    );
    expect(ReflectionStreamEventHistorySchema.safeParse(mismatchedCompletionOutcome).success).toBe(
      false,
    );
    const prematurelyCompletedBatch = [
      {
        ...events[0],
        sequence: 0,
        questionIds: ["repeated-values", "pattern-exceptions"],
      },
      { ...events[1], sequence: 1 },
      { ...events[4], sequence: 2 },
      { ...events[8], sequence: 3, batchComplete: true, terminal: true },
    ];
    expect(ReflectionStreamEventHistorySchema.safeParse(prematurelyCompletedBatch).success).toBe(
      false,
    );
    expect(
      ReflectionStreamEventHistorySchema.safeParse([
        { ...base, sequence: 0, type: "cancelled", terminal: true, batchId: "b" },
        { ...events[0], sequence: 1 },
      ]).success,
    ).toBe(false);
    expect(
      ReflectionStreamEventSchema.safeParse({ ...events[0], rawTokens: ["secret"] }).success,
    ).toBe(false);
  });
});
