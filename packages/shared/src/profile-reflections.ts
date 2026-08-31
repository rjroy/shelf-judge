import { z } from "zod";
import {
  GroundedDisclosureAcknowledgementSchema,
  GroundedProviderConfigurationStatusSchema,
  GroundedProviderUsageSchema,
  GroundedUsageUnavailableSchema,
  CancellationCapabilitySchema,
  createGroundedDisclosureSchema,
  createGroundedOperationResultSchema,
  createGroundedUnavailableReasonSchema,
} from "./grounded-analysis";
import { addUniqueCitationIssues, createGroundedEvidenceSchemas } from "./grounded-evidence";
import { createGroundedStreamHistorySchema, createGroundedStreamSchemas } from "./grounded-stream";

export const REFLECTION_CONTRACT_VERSION = 1 as const;
export const REFLECTION_MANIFEST_VERSION = 1 as const;
export const REFLECTION_SETTINGS_VERSION = 1 as const;

export const REFLECTION_QUESTION_IDS = [
  "repeated-values",
  "pattern-exceptions",
  "recurring-trade-offs",
] as const;

export const REFLECTION_QUESTIONS = [
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
] as const;

export const REFLECTION_EVIDENCE_CLASSES = [
  "owner-game-note",
  "game-identity-ownership",
  "current-scoring",
  "imported-metadata",
  "play-acquisition",
  "collection-structure",
  "profile-evidence",
] as const;

export const REFLECTION_EVIDENCE_CATEGORIES = [
  "note",
  "scoring",
  "ownership",
  "play",
  "acquisition",
  "metadata",
  "shelf",
  "profile",
  "question-policy",
  "provider-configuration",
  "collection",
] as const;

export const REFLECTION_UNAVAILABLE_REASONS = [
  "evidence-load",
  "model-configuration",
  "extension-binding",
  "authentication",
  "provider-refusal",
  "rate-limit",
  "provider-outage",
  "context-exhaustion",
  "output-validation",
  "persistence",
  "transport",
  "internal",
] as const;

export const REFLECTION_ABSTENTION_REASONS = [
  "no-owner-testimony",
  "insufficient-independent-testimony",
  "no-supported-pattern",
  "no-material-synthesis",
  "conflicting-evidence",
  "incomplete-scope",
  "question-not-applicable",
] as const;

const REFLECTION_NON_PATTERN_ABSTENTION_REASONS = [
  "no-owner-testimony",
  "insufficient-independent-testimony",
  "no-material-synthesis",
  "conflicting-evidence",
  "incomplete-scope",
  "question-not-applicable",
] as const satisfies readonly (typeof REFLECTION_ABSTENTION_REASONS)[number][];

export const REFLECTION_QUESTION_ABSTENTION_REASONS = {
  "repeated-values": REFLECTION_NON_PATTERN_ABSTENTION_REASONS,
  "pattern-exceptions": REFLECTION_ABSTENTION_REASONS,
  "recurring-trade-offs": REFLECTION_NON_PATTERN_ABSTENTION_REASONS,
} as const;

const QuestionIdSchema = z.enum(REFLECTION_QUESTION_IDS);
const IdSchema = z.string().min(1);
const TimestampSchema = z.string().datetime({ offset: true });
const SafeCountSchema = z.number().int().safe().min(0);
const PositiveSafeIntegerSchema = z.number().int().safe().positive();
const PositiveSafeIntegerStringSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "Note source version must be a canonical positive integer")
  .refine((value) => Number.isSafeInteger(Number(value)), {
    message: "Note source version must be a positive safe integer",
  });

const reflectionEvidence = createGroundedEvidenceSchemas({
  evidenceClasses: REFLECTION_EVIDENCE_CLASSES,
  dependencyCategories: REFLECTION_EVIDENCE_CATEGORIES,
  destinations: {
    "shelf.game.get": z.object({ gameId: IdSchema }).strict(),
    "shelf.profile.get": z.object({}).strict(),
    "shelf.game.bgg.refresh": z.object({ gameId: IdSchema }).strict(),
    "shelf.game.plays.set": z.object({ gameId: IdSchema }).strict(),
    "shelf.game.rating.set": z.object({ gameId: IdSchema }).strict(),
  },
});

export const ReflectionEvidenceClassSchema = reflectionEvidence.EvidenceClassSchema;
export const ReflectionEvidenceCategorySchema = reflectionEvidence.DependencyCategorySchema;
export const ReflectionDestinationSchema = reflectionEvidence.DestinationSchema;
export const ReflectionUnavailableReasonSchema = createGroundedUnavailableReasonSchema(
  REFLECTION_UNAVAILABLE_REASONS,
);
export const ReflectionAbstentionReasonSchema = z.enum(REFLECTION_ABSTENTION_REASONS);
const GroundedReflectionDisclosureSchema = createGroundedDisclosureSchema(
  REFLECTION_EVIDENCE_CLASSES,
);
type ReflectionDisclosure = z.infer<typeof GroundedReflectionDisclosureSchema> & {
  relevantOwnerNotesMayBeTransmitted: true;
};

export const ReflectionDisclosureSchema = GroundedReflectionDisclosureSchema.refine(
  (disclosure): disclosure is ReflectionDisclosure => disclosure.relevantOwnerNotesMayBeTransmitted,
  {
    path: ["relevantOwnerNotesMayBeTransmitted"],
    message: "Reflection disclosure must state that relevant owner notes may be transmitted",
  },
).superRefine((disclosure, context) => {
  if (disclosure.maximumProviderRoundTrips !== disclosure.modelOperationCount * 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maximumProviderRoundTrips"],
      message: "Reflection disclosure must allow exactly two provider round trips per operation",
    });
  }
});

const REFLECTION_GAME_EVIDENCE_CLASSES = [
  "owner-game-note",
  "game-identity-ownership",
  "current-scoring",
  "imported-metadata",
  "play-acquisition",
  "collection-structure",
] as const satisfies readonly (typeof REFLECTION_EVIDENCE_CLASSES)[number][];

export const REFLECTION_QUESTION_POLICIES = {
  "repeated-values": {
    questionVersion: 1,
    authorizedEvidenceClasses: REFLECTION_GAME_EVIDENCE_CLASSES,
    minimumIndependentNotes: 2,
    requiresCompletePatternCandidates: false,
  },
  "pattern-exceptions": {
    questionVersion: 1,
    authorizedEvidenceClasses: REFLECTION_EVIDENCE_CLASSES,
    minimumIndependentNotes: 2,
    requiresCompletePatternCandidates: true,
  },
  "recurring-trade-offs": {
    questionVersion: 1,
    authorizedEvidenceClasses: REFLECTION_GAME_EVIDENCE_CLASSES,
    minimumIndependentNotes: 2,
    requiresCompletePatternCandidates: false,
  },
} as const;

const ReflectionQuestionEvidenceClassSchemas = {
  "repeated-values": z.enum(
    REFLECTION_QUESTION_POLICIES["repeated-values"].authorizedEvidenceClasses,
  ),
  "pattern-exceptions": z.enum(
    REFLECTION_QUESTION_POLICIES["pattern-exceptions"].authorizedEvidenceClasses,
  ),
  "recurring-trade-offs": z.enum(
    REFLECTION_QUESTION_POLICIES["recurring-trade-offs"].authorizedEvidenceClasses,
  ),
} as const;

export function getReflectionQuestionEvidenceClassSchema(
  questionId: (typeof REFLECTION_QUESTION_IDS)[number],
) {
  return ReflectionQuestionEvidenceClassSchemas[questionId];
}

export const ReflectionEvidenceIdentitySchema = z
  .object({
    manifestVersion: z.literal(REFLECTION_MANIFEST_VERSION),
    questionId: QuestionIdSchema,
    questionVersion: z.literal(1),
    collectionId: IdSchema,
    collectionSchemaVersion: PositiveSafeIntegerSchema,
    collectionRevision: SafeCountSchema,
    profileContractVersion: PositiveSafeIntegerSchema,
    profileAlgorithmVersion: PositiveSafeIntegerSchema,
    providerId: IdSchema,
    modelId: IdSchema,
  })
  .strict();

const NoteDependencySchema = z
  .object({
    category: z.literal("note"),
    gameId: IdSchema,
    noteVersion: SafeCountSchema,
  })
  .strict();
const NonNoteDependencySchema = z
  .object({
    category: z.enum(
      REFLECTION_EVIDENCE_CATEGORIES.filter((value) => value !== "note") as [
        Exclude<(typeof REFLECTION_EVIDENCE_CATEGORIES)[number], "note">,
        ...Exclude<(typeof REFLECTION_EVIDENCE_CATEGORIES)[number], "note">[],
      ],
    ),
    sourceId: IdSchema,
    fingerprint: z.string().min(1),
    observedAt: TimestampSchema.optional(),
  })
  .strict();
export const ReflectionDependencySchema = z.union([NoteDependencySchema, NonNoteDependencySchema]);

const CitationBaseFields = {
  citationId: IdSchema,
  sourceId: IdSchema,
  sourceVersion: z.string().min(1),
  observedAt: TimestampSchema.optional(),
  canonicalSummary: z.string().min(1),
  destination: ReflectionDestinationSchema,
};
const OwnerNoteCitationSchema = z
  .object({
    ...CitationBaseFields,
    sourceVersion: PositiveSafeIntegerStringSchema,
    evidenceClass: z.literal("owner-game-note"),
    testimony: z.literal(true),
  })
  .strict();
const DeterministicCitationSchema = z
  .object({
    ...CitationBaseFields,
    evidenceClass: z.enum(
      REFLECTION_EVIDENCE_CLASSES.slice(1) as [
        Exclude<(typeof REFLECTION_EVIDENCE_CLASSES)[number], "owner-game-note">,
        ...Exclude<(typeof REFLECTION_EVIDENCE_CLASSES)[number], "owner-game-note">[],
      ],
    ),
    testimony: z.literal(false),
  })
  .strict();
export const ReflectionCitationSchema = z.union([
  OwnerNoteCitationSchema,
  DeterministicCitationSchema,
]);

export const ReflectionScopeSchema = z
  .object({
    examinedPresentNoteCount: SafeCountSchema,
    totalPresentNoteCount: SafeCountSchema,
    examinedGameCount: SafeCountSchema,
    relevantEligibleGameCount: SafeCountSchema,
    excludedGameCount: SafeCountSchema,
    exhaustiveNotes: z.boolean(),
    patternCandidateIds: z.array(IdSchema).optional(),
  })
  .strict()
  .superRefine((scope, context) => {
    if (scope.examinedPresentNoteCount > scope.totalPresentNoteCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["examinedPresentNoteCount"],
        message: "Examined notes cannot exceed total notes",
      });
    }
    if (scope.examinedGameCount > scope.relevantEligibleGameCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["examinedGameCount"],
        message: "Examined games cannot exceed relevant eligible games",
      });
    }
    if (
      scope.exhaustiveNotes !==
      (scope.examinedPresentNoteCount === scope.totalPresentNoteCount)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exhaustiveNotes"],
        message: "Notes are exhaustive exactly when examined and total counts match",
      });
    }
    if (
      scope.patternCandidateIds !== undefined &&
      new Set(scope.patternCandidateIds).size !== scope.patternCandidateIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["patternCandidateIds"],
        message: "Pattern candidate IDs must be unique",
      });
    }
  });

type ReflectionReportedUsage = z.infer<typeof GroundedProviderUsageSchema> & {
  inferenceRoundTrips: 1 | 2;
};

export const ReflectionProviderUsageSchema = GroundedProviderUsageSchema.refine(
  (usage): usage is ReflectionReportedUsage =>
    usage.inferenceRoundTrips === 1 || usage.inferenceRoundTrips === 2,
  { path: ["inferenceRoundTrips"], message: "Reflection usage permits one or two round trips" },
);

export const ReflectionBlockSchema = z
  .object({
    text: z.string().min(1),
    citationIds: z.array(IdSchema),
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

const CompletedBaseFields = {
  supportingBlocks: z.array(ReflectionBlockSchema).max(3),
  citations: z.array(ReflectionCitationSchema),
  scope: ReflectionScopeSchema,
  evidenceIdentity: ReflectionEvidenceIdentitySchema,
  dependencies: z.array(ReflectionDependencySchema),
  generatedAt: TimestampSchema,
  usage: z.union([ReflectionProviderUsageSchema, GroundedUsageUnavailableSchema]),
};
const AnsweredReflectionSchema = z
  .object({
    ...CompletedBaseFields,
    outcome: z.literal("answered"),
    centralSynthesis: ReflectionBlockSchema,
    supportingBlocks: z.array(ReflectionBlockSchema).min(1).max(3),
  })
  .strict();
const AbstainedReflectionSchema = z
  .object({
    ...CompletedBaseFields,
    outcome: z.literal("abstained"),
    reason: ReflectionAbstentionReasonSchema,
    explanation: z.string().min(1),
  })
  .strict();

export const ReflectionCompletedSchema = z
  .union([AnsweredReflectionSchema, AbstainedReflectionSchema])
  .superRefine((result, context) => {
    addUniqueCitationIssues(result.citations, context);
    const citationIds = new Set(result.citations.map(({ citationId }) => citationId));
    const blocks: Array<{ block: ReflectionBlock; path: (string | number)[] }> =
      result.supportingBlocks.map((block, index) => ({
        block,
        path: ["supportingBlocks", index, "citationIds"],
      }));
    if (result.outcome === "answered") {
      blocks.push({
        block: result.centralSynthesis,
        path: ["centralSynthesis", "citationIds"],
      });
    }
    for (const { block, path } of blocks) {
      if (block.citationIds.some((citationId) => !citationIds.has(citationId))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path],
          message: "Every block citation must resolve within the result",
        });
      }
      if (result.outcome === "answered") {
        const blockCitations = result.citations.filter(({ citationId }) =>
          block.citationIds.includes(citationId),
        );
        if (!blockCitations.some(({ testimony }) => testimony)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path],
            message: "A substantive block requires owner testimony",
          });
        }
        if (!blockCitations.some(({ testimony }) => !testimony)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path],
            message: "A substantive block requires computed or imported evidence",
          });
        }
      }
    }
    if (result.outcome === "answered") {
      const centralCitationIds = new Set(result.centralSynthesis.citationIds);
      const citedOwnerSources = new Set(
        result.citations
          .filter((citation) => citation.testimony && centralCitationIds.has(citation.citationId))
          .map(({ sourceId }) => sourceId),
      );
      const minimumIndependentNotes =
        REFLECTION_QUESTION_POLICIES[result.evidenceIdentity.questionId].minimumIndependentNotes;
      if (citedOwnerSources.size < minimumIndependentNotes) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["centralSynthesis", "citationIds"],
          message: `Central synthesis requires testimony from at least ${minimumIndependentNotes} distinct games`,
        });
      }
    }
    const authorizedEvidenceClasses: ReadonlySet<(typeof REFLECTION_EVIDENCE_CLASSES)[number]> =
      new Set(
        REFLECTION_QUESTION_POLICIES[result.evidenceIdentity.questionId].authorizedEvidenceClasses,
      );
    if (
      result.citations.some(({ evidenceClass }) => !authorizedEvidenceClasses.has(evidenceClass))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citations"],
        message: "Reflection citations must be authorized for the selected question",
      });
    }
    if (
      result.outcome === "abstained" &&
      !REFLECTION_QUESTION_ABSTENTION_REASONS[result.evidenceIdentity.questionId].some(
        (reason) => reason === result.reason,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Abstention reason is not authorized for the selected question",
      });
    }
    const dependencyKeys = result.dependencies.map((dependency) =>
      dependency.category === "note"
        ? `${dependency.category}\u0000${dependency.gameId}`
        : `${dependency.category}\u0000${dependency.sourceId}`,
    );
    if (new Set(dependencyKeys).size !== dependencyKeys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dependencies"],
        message: "Dependency identities must be unique",
      });
    }
    for (const citation of result.citations) {
      if (citation.evidenceClass !== "owner-game-note") continue;
      const noteVersion = Number(citation.sourceVersion);
      if (
        !result.dependencies.some(
          (dependency) =>
            dependency.category === "note" &&
            dependency.gameId === citation.sourceId &&
            dependency.noteVersion === noteVersion,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dependencies"],
          message: `Owner note citation ${citation.citationId} requires its exact note dependency`,
        });
      }
    }
    const hasPatternCandidates = result.scope.patternCandidateIds !== undefined;
    if (hasPatternCandidates !== (result.evidenceIdentity.questionId === "pattern-exceptions")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "patternCandidateIds"],
        message: "Pattern candidate IDs are required only for pattern-exceptions results",
      });
    }
  });

export const ReflectionCacheStateSchema = z.union([
  z.object({ state: z.literal("none") }).strict(),
  z.object({ state: z.literal("current"), result: ReflectionCompletedSchema }).strict(),
  z
    .object({
      state: z.literal("stale"),
      changedCategories: z.array(ReflectionEvidenceCategorySchema).nonempty(),
      result: ReflectionCompletedSchema,
    })
    .strict()
    .superRefine(({ changedCategories }, context) => {
      if (new Set(changedCategories).size !== changedCategories.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["changedCategories"],
          message: "Changed categories must be unique",
        });
      }
    }),
]);

export const ReflectionAttemptStateSchema = z.union([
  z.object({ state: z.literal("idle") }).strict(),
  z
    .object({ state: z.literal("refreshing"), batchId: IdSchema, startedAt: TimestampSchema })
    .strict(),
  z.object({ state: z.literal("cancelled"), occurredAt: TimestampSchema }).strict(),
  z
    .object({
      state: z.literal("unavailable"),
      reason: ReflectionUnavailableReasonSchema,
      safeDetail: z.string().min(1).optional(),
      occurredAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("purged"),
      reason: z.enum(["note-changed", "game-deleted", "owner-deleted"]),
      occurredAt: TimestampSchema,
    })
    .strict(),
]);

export const ReflectionQuestionStateSchema = z
  .object({
    questionId: QuestionIdSchema,
    enabled: z.boolean(),
    cache: ReflectionCacheStateSchema,
    attempt: ReflectionAttemptStateSchema,
  })
  .strict()
  .superRefine(({ questionId, cache }, context) => {
    if (cache.state !== "none" && cache.result.evidenceIdentity.questionId !== questionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cache", "result", "evidenceIdentity", "questionId"],
        message: "Cached Reflection result must match its question state",
      });
    }
  })
  .superRefine(({ enabled, cache, attempt }, context) => {
    if (!enabled && (cache.state !== "none" || attempt.state !== "idle")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [cache.state !== "none" ? "cache" : "attempt"],
        message: "A disabled Reflection question must have no cache and an idle attempt",
      });
    }
    if (attempt.state === "purged" && cache.state !== "none") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attempt"],
        message: "A purged Reflection attempt cannot retain a cached result",
      });
    }
  });

export const ReflectionSettingsSchema = z
  .object({
    version: z.literal(REFLECTION_SETTINGS_VERSION),
    questions: z.tuple([
      z.object({ questionId: z.literal("repeated-values"), enabled: z.boolean() }).strict(),
      z.object({ questionId: z.literal("pattern-exceptions"), enabled: z.boolean() }).strict(),
      z.object({ questionId: z.literal("recurring-trade-offs"), enabled: z.boolean() }).strict(),
    ]),
  })
  .strict();

export const DEFAULT_REFLECTION_SETTINGS = {
  version: REFLECTION_SETTINGS_VERSION,
  questions: [
    { questionId: "repeated-values", enabled: true },
    { questionId: "pattern-exceptions", enabled: true },
    { questionId: "recurring-trade-offs", enabled: true },
  ],
} as const;

export const ReflectionQuestionStateCollectionSchema = z.tuple([
  ReflectionQuestionStateSchema.refine(({ questionId }) => questionId === "repeated-values"),
  ReflectionQuestionStateSchema.refine(({ questionId }) => questionId === "pattern-exceptions"),
  ReflectionQuestionStateSchema.refine(({ questionId }) => questionId === "recurring-trade-offs"),
]);

export const ReflectionGetRequestSchema = z.object({}).strict();
export const ReflectionGetResultSchema = z
  .object({
    contractVersion: z.literal(REFLECTION_CONTRACT_VERSION),
    configuration: GroundedProviderConfigurationStatusSchema,
    settings: ReflectionSettingsSchema,
    questions: ReflectionQuestionStateCollectionSchema,
  })
  .strict()
  .superRefine(({ settings, questions }, context) => {
    for (const [index, question] of questions.entries()) {
      if (question.enabled !== settings.questions[index].enabled) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", index, "enabled"],
          message: "Question state enabled flags must match settings",
        });
      }
    }
  });
export const ReflectionSettingsUpdateRequestSchema = z
  .object({ requestId: IdSchema, questionId: QuestionIdSchema, enabled: z.boolean() })
  .strict();
export const ReflectionRefreshRequestSchema = z
  .object({
    batchId: IdSchema,
    requestId: IdSchema,
    cancellationCapability: CancellationCapabilitySchema,
    questionId: QuestionIdSchema.optional(),
    disclosure: GroundedDisclosureAcknowledgementSchema,
  })
  .strict();
export const ReflectionCancelRequestSchema = z
  .object({ batchId: IdSchema, capability: CancellationCapabilitySchema })
  .strict();
export const ReflectionDeleteRequestSchema = z
  .object({ requestId: IdSchema, confirmed: z.literal(true) })
  .strict();

export const ReflectionOperationResultSchema = createGroundedOperationResultSchema([
  { outcome: "accepted", payload: { requestId: IdSchema } },
  { outcome: "not-found", payload: { requestId: IdSchema } },
  { outcome: "busy", payload: { requestId: IdSchema, activeBatchId: IdSchema } },
  { outcome: "unauthorized", payload: { requestId: IdSchema } },
  {
    outcome: "unavailable",
    payload: {
      requestId: IdSchema,
      reason: ReflectionUnavailableReasonSchema,
      safeDetail: z.string().min(1).optional(),
    },
  },
]);

const reflectionStream = createGroundedStreamSchemas([
  {
    type: "accepted",
    terminal: false,
    payload: {
      batchId: IdSchema,
      requestId: IdSchema,
      cancellationCapability: CancellationCapabilitySchema,
      questionIds: z
        .array(QuestionIdSchema)
        .nonempty()
        .superRefine((questionIds, context) => {
          if (new Set(questionIds).size !== questionIds.length) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Accepted Reflection question IDs must be unique",
            });
          }
          const positions = questionIds.map((questionId) =>
            REFLECTION_QUESTION_IDS.indexOf(questionId),
          );
          if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Accepted Reflection questions must preserve fixed question order",
            });
          }
        }),
    },
  },
  {
    type: "question-started",
    terminal: false,
    payload: { batchId: IdSchema, questionId: QuestionIdSchema, questionVersion: z.literal(1) },
  },
  {
    type: "evidence-retrieval",
    terminal: false,
    payload: {
      batchId: IdSchema,
      questionId: QuestionIdSchema,
      status: z.enum(["started", "completed"]),
      examinedItemCount: SafeCountSchema,
    },
  },
  {
    type: "model-status",
    terminal: false,
    payload: {
      batchId: IdSchema,
      questionId: QuestionIdSchema,
      status: z.enum(["started", "awaiting-submission", "validating"]),
    },
  },
  {
    type: "validated-result",
    terminal: false,
    payload: { batchId: IdSchema, questionId: QuestionIdSchema, result: ReflectionCompletedSchema },
  },
  {
    type: "provider-usage",
    terminal: false,
    payload: {
      batchId: IdSchema,
      questionId: QuestionIdSchema,
      usage: z.union([ReflectionProviderUsageSchema, GroundedUsageUnavailableSchema]),
    },
  },
  {
    type: "cache-outcome",
    terminal: false,
    payload: {
      batchId: IdSchema,
      questionId: QuestionIdSchema,
      outcome: z.enum(["replaced", "preserved", "purged"]),
    },
  },
  {
    type: "question-completed",
    terminal: false,
    payload: {
      batchId: IdSchema,
      questionId: QuestionIdSchema,
      outcome: z.enum(["answered", "abstained"]),
      batchComplete: z.literal(false),
    },
  },
  {
    type: "question-completed",
    terminal: true,
    payload: {
      batchId: IdSchema,
      questionId: QuestionIdSchema,
      outcome: z.enum(["answered", "abstained"]),
      batchComplete: z.literal(true),
    },
  },
  {
    type: "cancelled",
    terminal: true,
    payload: { batchId: IdSchema, questionId: QuestionIdSchema.optional() },
  },
  {
    type: "failed",
    terminal: true,
    payload: {
      batchId: IdSchema,
      questionId: QuestionIdSchema.optional(),
      reason: ReflectionUnavailableReasonSchema,
      safeDetail: z.string().min(1).optional(),
    },
  },
]);

export const ReflectionStreamEventSchema = reflectionStream.EventSchema.superRefine(
  (event, context) => {
    if (
      event.type === "validated-result" &&
      event.result.evidenceIdentity.questionId !== event.questionId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "evidenceIdentity", "questionId"],
        message: "Validated result must match the stream event question",
      });
    }
  },
);
export const ReflectionStreamEventHistorySchema = createGroundedStreamHistorySchema(
  ReflectionStreamEventSchema,
).superRefine((events, context) => {
  const accepted = events[0];
  if (accepted === undefined) return;
  if (accepted.type !== "accepted") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [0, "type"],
      message: "Reflection stream history must begin with acceptance",
    });
    return;
  }
  if (events.slice(1).some(({ type }) => type === "accepted")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Reflection stream history may contain only one acceptance event",
    });
  }

  let completedCount = 0;
  let activeQuestion: (typeof REFLECTION_QUESTION_IDS)[number] | undefined;
  const validatedOutcomes = new Map<
    (typeof REFLECTION_QUESTION_IDS)[number],
    "answered" | "abstained"
  >();
  for (const [index, event] of events.entries()) {
    if (index === 0) continue;
    if (event.batchId !== accepted.batchId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "batchId"],
        message: "Every Reflection stream event must match the accepted batch",
      });
    }
    if (event.type === "question-started") {
      const expectedQuestion = accepted.questionIds[completedCount];
      if (activeQuestion !== undefined || event.questionId !== expectedQuestion) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "questionId"],
          message: "Question starts must follow the accepted question order",
        });
      }
      activeQuestion = event.questionId;
      continue;
    }
    if (event.type === "validated-result") {
      if (validatedOutcomes.has(event.questionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "questionId"],
          message: "A question may emit only one validated result",
        });
      }
      validatedOutcomes.set(event.questionId, event.result.outcome);
    }
    if (event.type === "question-completed") {
      if (activeQuestion === undefined || event.questionId !== activeQuestion) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "questionId"],
          message: "Question completion must match the active accepted question",
        });
      }
      if (validatedOutcomes.get(event.questionId) !== event.outcome) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "outcome"],
          message: "Question completion must match its validated result outcome",
        });
      }
      const isLastAcceptedQuestion = completedCount === accepted.questionIds.length - 1;
      if (event.batchComplete !== isLastAcceptedQuestion) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "batchComplete"],
          message: "Batch completion must match the accepted question lifecycle",
        });
      }
      completedCount += 1;
      activeQuestion = undefined;
      continue;
    }
    if (
      "questionId" in event &&
      event.questionId !== undefined &&
      event.type !== "cancelled" &&
      event.type !== "failed" &&
      event.questionId !== activeQuestion
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "questionId"],
        message: "Question-scoped events must belong to the active accepted question",
      });
    }
    if (
      (event.type === "cancelled" || event.type === "failed") &&
      event.questionId !== undefined &&
      event.questionId !== activeQuestion
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "questionId"],
        message: "Terminal question identity must match the active question",
      });
    }
  }

  if (
    events.at(-1)?.type === "question-completed" &&
    completedCount !== accepted.questionIds.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Completed Reflection streams must finish every accepted question",
    });
  }
});

export type ReflectionQuestionId = (typeof REFLECTION_QUESTION_IDS)[number];
export type ReflectionEvidenceClass = (typeof REFLECTION_EVIDENCE_CLASSES)[number];
export type ReflectionEvidenceCategory = (typeof REFLECTION_EVIDENCE_CATEGORIES)[number];
export type ReflectionUnavailableReason = (typeof REFLECTION_UNAVAILABLE_REASONS)[number];
export type ReflectionAbstentionReason = (typeof REFLECTION_ABSTENTION_REASONS)[number];
export type ReflectionEvidenceIdentity = z.infer<typeof ReflectionEvidenceIdentitySchema>;
export type ReflectionDependency = z.infer<typeof ReflectionDependencySchema>;
export type ReflectionCitation = z.infer<typeof ReflectionCitationSchema>;
export type ReflectionScope = z.infer<typeof ReflectionScopeSchema>;
export type ReflectionProviderUsage = z.infer<typeof ReflectionProviderUsageSchema>;
export type ReflectionBlock = z.infer<typeof ReflectionBlockSchema>;
export type ReflectionCompleted = z.infer<typeof ReflectionCompletedSchema>;
export type ReflectionCacheState = z.infer<typeof ReflectionCacheStateSchema>;
export type ReflectionAttemptState = z.infer<typeof ReflectionAttemptStateSchema>;
export type ReflectionQuestionState = z.infer<typeof ReflectionQuestionStateSchema>;
export type ReflectionSettings = z.infer<typeof ReflectionSettingsSchema>;
export type ReflectionGetResult = z.infer<typeof ReflectionGetResultSchema>;
export type ReflectionStreamEvent = z.infer<typeof ReflectionStreamEventSchema>;
