import { z } from "zod";
import {
  CancellationCapabilitySchema,
  GroundedProviderConfigurationStatusSchema,
  GroundedProviderUsageSchema,
  GroundedUsageUnavailableSchema,
  createGroundedOperationResultSchema,
  createGroundedUnavailableReasonSchema,
} from "./grounded-analysis";
import { addUniqueCitationIssues, createGroundedEvidenceSchemas } from "./grounded-evidence";
import { createGroundedStreamHistorySchema, createGroundedStreamSchemas } from "./grounded-stream";
import {
  PURCHASE_UTILIZATION_EVIDENCE_FIELD,
  WEIGHT_DERIVED_FIELD_ID,
} from "./derived-axis-registry";

export const ANALYST_CONTRACT_VERSION = 1 as const;
export const ANALYST_MANIFEST_VERSION = 1 as const;

export const ANALYST_EVIDENCE_CLASSES = [
  "game-identity-ownership",
  "current-scoring",
  "imported-metadata",
  "play-acquisition",
  "collection-structure",
  "profile-evidence",
  "owner-game-note",
] as const;

export const ANALYST_EVIDENCE_MANIFEST = {
  version: ANALYST_MANIFEST_VERSION,
  classes: [
    {
      id: "game-identity-ownership",
      fields: ["gameId", "displayName", "bggId", "ownershipState"],
      sourceIdentity: "game ID and collection revision",
      observationTime: "none",
      canonicalSummary: "Current game identity and ownership state",
    },
    {
      id: "current-scoring",
      fields: [
        "gameId",
        "displayedFitness",
        "validatedBreakdown",
        "veto",
        "predictionStatus",
        "sourceState",
      ],
      sourceIdentity: "game ID, collection revision, and Profile algorithm version",
      observationTime: "none",
      canonicalSummary: "Current validated scoring evidence",
    },
    {
      id: "imported-metadata",
      fields: [
        "gameId",
        "name",
        "description",
        "categories",
        "mechanics",
        "families",
        "subdomains",
        "designers",
        "artists",
        "playerCounts",
        "playTime",
        WEIGHT_DERIVED_FIELD_ID,
        "completeness",
        "sourceTime",
        "refreshWarnings",
      ],
      sourceIdentity: "game ID and hash of authorized imported metadata source",
      observationTime: "sourceTime when present",
      canonicalSummary: "Current validated imported metadata",
    },
    {
      id: "play-acquisition",
      fields: [
        "gameId",
        "playCount",
        "acquisitionDate",
        "acquisitionPrice",
        "source",
        "observedAt",
        PURCHASE_UTILIZATION_EVIDENCE_FIELD,
      ],
      sourceIdentity: "game ID and collection revision",
      observationTime: "observedAt when present",
      canonicalSummary: "Current play and acquisition evidence",
    },
    {
      id: "collection-structure",
      fields: ["gameId", "shelfAssignment", "redundancy"],
      sourceIdentity: "game ID and collection revision",
      observationTime: "none",
      canonicalSummary: "Current collection structure evidence",
    },
    {
      id: "profile-evidence",
      fields: [
        "entityClass",
        "entityId",
        "name",
        "entityAssociations",
        "comparatorCohort",
        "support",
        "dispersion",
        "supportingGames",
        "exclusions",
        "activeIntentions",
        "evidenceWarnings",
        "confounders",
        "associationNotPreference",
      ],
      sourceIdentity: "entity class, entity ID, profile algorithm version, and collection revision",
      observationTime: "none",
      canonicalSummary: "Current deterministic Profile evidence",
    },
    {
      id: "owner-game-note",
      fields: ["gameId", "noteVersion", "state", "text"],
      sourceIdentity: "game ID and current note version",
      observationTime: "none",
      canonicalSummary: "Current owner testimony or non-text note state",
    },
  ],
  destinations: ["shelf.game.get", "shelf.profile.get", "shelf.collection.get"],
} as const;

export const ANALYST_ABSTENTION_REASONS = [
  "no-authorized-evidence",
  "insufficient-evidence",
  "unsupported-request",
  "prohibited-action",
] as const;
export const ANALYST_UNAVAILABLE_REASONS = [
  "evidence-load",
  "model-configuration",
  "extension-binding",
  "authentication",
  "provider-refusal",
  "rate-limit",
  "provider-outage",
  "context-exhaustion",
  "output-validation",
  "transport",
  "internal",
] as const;

const IdSchema = z.string().min(1);
const SafeCountSchema = z.number().int().safe().min(0);
const PositiveSafeIntegerSchema = z.number().int().safe().positive();
const TimestampSchema = z.string().datetime({ offset: true });
const NoteVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .refine((value) => Number.isSafeInteger(Number(value)));

const analystEvidence = createGroundedEvidenceSchemas({
  evidenceClasses: ANALYST_EVIDENCE_CLASSES,
  dependencyCategories: ["collection", "profile", "note"] as const,
  destinations: {
    "shelf.game.get": z.object({ gameId: IdSchema }).strict(),
    "shelf.profile.get": z.object({}).strict(),
    "shelf.collection.get": z.object({}).strict(),
  },
});

export const AnalystEvidenceClassSchema = analystEvidence.EvidenceClassSchema;
export const AnalystDestinationSchema = analystEvidence.DestinationSchema;
export const AnalystCitationIdentitySchema = analystEvidence.EvidenceIdentitySchema;
export const AnalystAbstentionReasonSchema = z.enum(ANALYST_ABSTENTION_REASONS);
export const AnalystUnavailableReasonSchema = createGroundedUnavailableReasonSchema(
  ANALYST_UNAVAILABLE_REASONS,
);

export const AnalystDisclosureSchema = z
  .object({
    providerId: IdSchema,
    modelId: IdSchema,
    acknowledged: z.literal(true),
  })
  .strict();
export const AnalystConfigurationSchema = z
  .object({
    contractVersion: z.literal(ANALYST_CONTRACT_VERSION),
    manifestVersion: z.literal(ANALYST_MANIFEST_VERSION),
    configuration: GroundedProviderConfigurationStatusSchema,
    disclosure: z
      .object({
        evidenceClasses: z.tuple([
          z.literal("game-identity-ownership"),
          z.literal("current-scoring"),
          z.literal("imported-metadata"),
          z.literal("play-acquisition"),
          z.literal("collection-structure"),
          z.literal("profile-evidence"),
          z.literal("owner-game-note"),
        ]),
        relevantOwnerNotesMayBeTransmitted: z.literal(true),
        localRetention: z.string().min(1),
        providerProcessingAndRetentionFollowProviderPolicy: z.literal(true),
        applicationTokenCap: z.null(),
        applicationMonetaryCap: z.null(),
        cancellation: z.string().min(1),
        maximumTranscriptMessages: PositiveSafeIntegerSchema,
        maximumTranscriptCharacters: PositiveSafeIntegerSchema,
      })
      .strict(),
  })
  .strict();

export const AnalystNoteDependencySchema = z
  .object({ gameId: IdSchema, noteVersion: SafeCountSchema })
  .strict();
const AnalystAssistantMessageSchema = z
  .object({
    role: z.literal("analyst"),
    content: z.string().min(1),
    outcome: z.enum(["answered", "partial", "abstained"]),
    noteDependencies: z.array(AnalystNoteDependencySchema),
    validationAttestation: z.string().min(1),
  })
  .strict()
  .superRefine(({ noteDependencies }, context) => {
    const gameIds = noteDependencies.map(({ gameId }) => gameId);
    if (new Set(gameIds).size !== gameIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["noteDependencies"],
        message: "Note dependencies must be unique by game",
      });
    }
  });
const AnalystOwnerMessageSchema = z
  .object({ role: z.literal("owner"), content: z.string().min(1) })
  .strict();
export const AnalystTranscriptMessageSchema = z.union([
  AnalystOwnerMessageSchema,
  AnalystAssistantMessageSchema,
]);

export const AnalystTurnRequestSchema = z
  .object({
    conversationId: IdSchema,
    conversationCapability: CancellationCapabilitySchema,
    requestId: IdSchema,
    turnIndex: SafeCountSchema,
    disclosure: AnalystDisclosureSchema,
    messages: z.array(AnalystTranscriptMessageSchema).nonempty(),
  })
  .strict()
  .superRefine(({ messages, turnIndex }, context) => {
    const analystMessageCount = messages.filter(({ role }) => role === "analyst").length;
    if (turnIndex !== analystMessageCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["turnIndex"],
        message: "Turn index must equal completed analyst messages",
      });
    }
    for (const [index, message] of messages.entries()) {
      const expectedRole = index % 2 === 0 ? "owner" : "analyst";
      if (message.role !== expectedRole) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["messages", index, "role"],
          message: "Transcript must alternate owner and analyst messages",
        });
      }
    }
    if (messages.at(-1)?.role !== "owner") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messages"],
        message: "Transcript must end with the current owner turn",
      });
    }
  });

export const AnalystCitationSchema = z
  .object({
    citationId: IdSchema,
    sourceId: IdSchema,
    sourceVersion: z.string().min(1),
    evidenceClass: AnalystEvidenceClassSchema,
    observedAt: TimestampSchema.optional(),
    canonicalSummary: z.string().min(1),
    testimony: z.boolean(),
    destination: AnalystDestinationSchema,
  })
  .strict()
  .superRefine((citation, context) => {
    if (citation.evidenceClass !== "owner-game-note" && citation.testimony) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["testimony"],
        message: "Only owner notes may be testimony",
      });
    }
    if (
      citation.evidenceClass === "owner-game-note" &&
      !NoteVersionSchema.safeParse(citation.sourceVersion).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceVersion"],
        message: "Owner note versions must be canonical positive safe integers",
      });
    }
  });
export const AnalystAnswerBlockSchema = z
  .object({
    text: z.string().min(1),
    citationIds: z.array(IdSchema),
    uncertainty: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(({ citationIds }, context) => {
    if (new Set(citationIds).size !== citationIds.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citationIds"],
        message: "Block citation IDs must be unique",
      });
  });

const AnalystFinalBase = {
  blocks: z.array(AnalystAnswerBlockSchema).min(1),
  citations: z.array(AnalystCitationSchema),
  usage: z.union([GroundedProviderUsageSchema, GroundedUsageUnavailableSchema]),
};
const AnsweredOrPartialAnalystFinalSchema = z
  .object({ ...AnalystFinalBase, outcome: z.enum(["answered", "partial"]) })
  .strict();
const AbstainedAnalystFinalSchema = z
  .object({
    ...AnalystFinalBase,
    outcome: z.literal("abstained"),
    reason: AnalystAbstentionReasonSchema,
  })
  .strict();
export const AnalystFinalSchema = z
  .union([AnsweredOrPartialAnalystFinalSchema, AbstainedAnalystFinalSchema])
  .superRefine((result, context) => {
    addUniqueCitationIssues(result.citations, context);
    const citationIds = new Set(result.citations.map(({ citationId }) => citationId));
    for (const [index, block] of result.blocks.entries()) {
      if (block.citationIds.some((citationId) => !citationIds.has(citationId))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blocks", index, "citationIds"],
          message: "Block citations must resolve within the turn",
        });
      }
    }
    const referencedCitationIds = new Set(result.blocks.flatMap(({ citationIds }) => citationIds));
    if (result.citations.some(({ citationId }) => !referencedCitationIds.has(citationId))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citations"],
        message: "Every citation must be referenced by an answer block",
      });
    }
    if (
      result.outcome === "partial" &&
      !result.blocks.some(({ uncertainty }) => uncertainty !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocks"],
        message: "Partial responses require a limitation or uncertainty",
      });
    }
  });

export const AnalystCancelledSchema = z.object({ outcome: z.literal("cancelled") }).strict();
export const AnalystUnavailableSchema = z
  .object({
    outcome: z.literal("unavailable"),
    reason: AnalystUnavailableReasonSchema,
    safeDetail: z.string().min(1).optional(),
  })
  .strict();

export const AnalystCancelRequestSchema = z
  .object({
    conversationId: IdSchema,
    conversationCapability: CancellationCapabilitySchema,
    requestId: IdSchema,
  })
  .strict();
export const AnalystCitationInspectRequestSchema = z
  .object({ citation: AnalystCitationIdentitySchema })
  .strict();
export const AnalystCitationInspectResultSchema = z.union([
  z.object({ state: z.literal("current"), destination: AnalystDestinationSchema }).strict(),
  z.object({ state: z.literal("superseded"), destination: AnalystDestinationSchema }).strict(),
]);
export const AnalystConfigurationGetRequestSchema = z.object({}).strict();
export const AnalystOperationResultSchema = createGroundedOperationResultSchema([
  { outcome: "accepted", payload: { requestId: IdSchema } },
  { outcome: "busy", payload: { requestId: IdSchema, activeRequestId: IdSchema } },
  { outcome: "invalid-transcript", payload: { requestId: IdSchema } },
  { outcome: "stale-transcript", payload: { requestId: IdSchema } },
  { outcome: "disclosure-mismatch", payload: { requestId: IdSchema } },
  { outcome: "request-id-misuse", payload: { requestId: IdSchema } },
  { outcome: "unauthorized", payload: { requestId: IdSchema } },
  {
    outcome: "unavailable",
    payload: {
      requestId: IdSchema,
      reason: AnalystUnavailableReasonSchema,
      safeDetail: z.string().min(1).optional(),
    },
  },
]);

const analystStream = createGroundedStreamSchemas([
  {
    type: "accepted",
    terminal: false,
    payload: { conversationId: IdSchema, requestId: IdSchema, turnIndex: SafeCountSchema },
  },
  {
    type: "evidence-status",
    terminal: false,
    payload: {
      conversationId: IdSchema,
      requestId: IdSchema,
      status: z.enum(["started", "completed"]),
      examinedItemCount: SafeCountSchema,
    },
  },
  {
    type: "model-status",
    terminal: false,
    payload: {
      conversationId: IdSchema,
      requestId: IdSchema,
      status: z.enum(["started", "awaiting-submission", "validating"]),
    },
  },
  {
    type: "validated-block",
    terminal: false,
    payload: { conversationId: IdSchema, requestId: IdSchema, block: AnalystAnswerBlockSchema },
  },
  {
    type: "provider-usage",
    terminal: false,
    payload: {
      conversationId: IdSchema,
      requestId: IdSchema,
      usage: z.union([GroundedProviderUsageSchema, GroundedUsageUnavailableSchema]),
    },
  },
  {
    type: "completed",
    terminal: true,
    payload: {
      conversationId: IdSchema,
      requestId: IdSchema,
      result: AnalystFinalSchema,
      noteDependencies: z.array(AnalystNoteDependencySchema),
      validationAttestation: z.string().min(1),
    },
  },
  { type: "cancelled", terminal: true, payload: { conversationId: IdSchema, requestId: IdSchema } },
  {
    type: "failed",
    terminal: true,
    payload: {
      conversationId: IdSchema,
      requestId: IdSchema,
      reason: AnalystUnavailableReasonSchema,
      safeDetail: z.string().min(1).optional(),
    },
  },
]);
export const AnalystCancelResultSchema = createGroundedOperationResultSchema([
  { outcome: "accepted", payload: { requestId: IdSchema } },
  { outcome: "not-found", payload: { requestId: IdSchema } },
  { outcome: "request-id-misuse", payload: { requestId: IdSchema } },
  { outcome: "unauthorized", payload: { requestId: IdSchema } },
]);

export const AnalystStreamEventSchema = analystStream.EventSchema;
export const AnalystStreamEventHistorySchema = createGroundedStreamHistorySchema(
  AnalystStreamEventSchema,
).superRefine((events, context) => {
  const accepted = events[0];
  if (accepted?.type !== "accepted") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [0],
      message: "Analyst streams must begin with acceptance",
    });
    return;
  }
  if (events.slice(1).some(({ type }) => type === "accepted")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Analyst stream histories may contain only one acceptance event",
    });
  }
  for (const [index, event] of events.entries()) {
    if (index === 0) continue;
    if (
      event.conversationId !== accepted.conversationId ||
      event.requestId !== accepted.requestId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: "All stream events must match the accepted turn",
      });
    }
  }
});

export type AnalystEvidenceClass = (typeof ANALYST_EVIDENCE_CLASSES)[number];
export type AnalystAbstentionReason = (typeof ANALYST_ABSTENTION_REASONS)[number];
export type AnalystUnavailableReason = (typeof ANALYST_UNAVAILABLE_REASONS)[number];
export type AnalystTurnRequest = z.infer<typeof AnalystTurnRequestSchema>;
export type AnalystCitation = z.infer<typeof AnalystCitationSchema>;
export type AnalystAnswerBlock = z.infer<typeof AnalystAnswerBlockSchema>;
export type AnalystFinal = z.infer<typeof AnalystFinalSchema>;
export type AnalystStreamEvent = z.infer<typeof AnalystStreamEventSchema>;
