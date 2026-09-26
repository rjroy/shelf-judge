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

export const ANALYST_CONTRACT_VERSION = 4 as const;
export const ANALYST_MANIFEST_VERSION = 4 as const;
export const ANALYST_DISCLOSURE_VERSION = 1 as const;

export const ANALYST_EVIDENCE_CLASSES = [
  "game-identity-ownership",
  "current-scoring",
  "imported-metadata",
  "play-acquisition",
  "collection-structure",
  "collection-summary",
  "profile-evidence",
  "owner-game-note",
  "bgg-search-observation",
  "bgg-hot-observation",
  "bgg-candidate-identity",
  "bgg-thing-facts",
  "bgg-preview-calculation",
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
      id: "collection-summary",
      fields: [
        "snapshotFingerprint",
        "groupBy",
        "measures",
        "group",
        "sourceCount",
        "gameCount",
        "averageFitness",
        "fitnessGameCount",
      ],
      sourceIdentity: "summary scope, selected group, and complete contributing source versions",
      observationTime: "none",
      canonicalSummary: "Current deterministic collection summary evidence",
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
    {
      id: "bgg-search-observation",
      fields: ["returnedCount", "emittedCount", "truncated"],
      sourceIdentity: "turn-local title search observation",
      observationTime: "observedAt",
      canonicalSummary: "Bounded BGG title search observation",
    },
    {
      id: "bgg-hot-observation",
      fields: ["returnedCount", "emittedCount", "truncated"],
      sourceIdentity: "turn-local fixed boardgame Hot observation",
      observationTime: "observedAt",
      canonicalSummary: "Bounded BGG Hot sample observation",
    },
    {
      id: "bgg-candidate-identity",
      fields: ["bggId", "primaryName", "yearPublished"],
      sourceIdentity: "verified BGG boardgame item",
      observationTime: "observedAt",
      canonicalSummary: "Verified BGG candidate identity",
    },
    {
      id: "bgg-thing-facts",
      fields: ["bggId", "primaryName", "yearPublished", "mechanics", "missingFields", "warnings"],
      sourceIdentity: "verified BGG Thing observation",
      observationTime: "observedAt",
      canonicalSummary: "Verified BGG boardgame facts",
    },
    {
      id: "bgg-preview-calculation",
      fields: ["bggId", "score", "readinessStage", "sourceVersion"],
      sourceIdentity: "local collection/profile snapshot and verified Thing input",
      observationTime: "calculatedAt",
      canonicalSummary: "Versioned local fitness preview calculation",
    },
  ],
  destinations: [
    "shelf.game.get",
    "shelf.profile.get",
    "shelf.collection.get",
    "shelf.bgg.item.get",
    "shelf.analyst.discovery.get",
    "shelf.analyst.calculation.get",
  ],
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
const BggIdSchema = PositiveSafeIntegerSchema;
const BggCitationIdSchema = z.string().min(1).max(256);
const BggText = (maxCodePoints: number) =>
  z
    .string()
    .min(1)
    .refine(
      (value) =>
        Array.from(value).length <= maxCodePoints &&
        !Array.from(value).some((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint < 32 || codePoint === 127;
        }),
      "Expected bounded plain text",
    );
const BggNameSchema = BggText(160);
const BggMechanicNameSchema = BggText(80);
const BggFailureCodeSchema = z.enum([
  "InvalidInput",
  "UnauthorizedId",
  "NotConfigured",
  "BggUnauthorized",
  "BggThrottled",
  "BggQueuedTimeout",
  "BggOutage",
  "BggParse",
  "MissingGame",
  "NonBoardgame",
  "MismatchedId",
  "BudgetExhausted",
  "ToolTimeout",
  "PredictionUnavailable",
]);
const BggFailureSchema = z
  .object({
    status: z.literal("error"),
    code: BggFailureCodeSchema,
    retryable: z.boolean(),
  })
  .strict();
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
    "shelf.bgg.item.get": z.object({ bggId: BggIdSchema }).strict(),
    "shelf.analyst.discovery.get": z.object({ citationId: BggCitationIdSchema }).strict(),
    "shelf.analyst.calculation.get": z.object({ citationId: BggCitationIdSchema }).strict(),
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
    manifestVersion: z.literal(ANALYST_MANIFEST_VERSION),
    disclosureVersion: z.literal(ANALYST_DISCLOSURE_VERSION),
    acknowledged: z.literal(true),
  })
  .strict();
export const AnalystConfigurationSchema = z
  .object({
    contractVersion: z.literal(ANALYST_CONTRACT_VERSION),
    manifestVersion: z.literal(ANALYST_MANIFEST_VERSION),
    disclosureVersion: z.literal(ANALYST_DISCLOSURE_VERSION),
    configuration: GroundedProviderConfigurationStatusSchema,
    bgg: z.object({ status: z.enum(["configured", "not-configured", "unauthorized"]) }).strict(),
    disclosure: z
      .object({
        evidenceClasses: z.tuple([
          z.literal("game-identity-ownership"),
          z.literal("current-scoring"),
          z.literal("imported-metadata"),
          z.literal("play-acquisition"),
          z.literal("collection-structure"),
          z.literal("collection-summary"),
          z.literal("profile-evidence"),
          z.literal("owner-game-note"),
          z.literal("bgg-search-observation"),
          z.literal("bgg-hot-observation"),
          z.literal("bgg-candidate-identity"),
          z.literal("bgg-thing-facts"),
          z.literal("bgg-preview-calculation"),
        ]),
        relevantOwnerNotesMayBeTransmitted: z.literal(true),
        selectedOwnerTitleOrBggIdsMayBeSentToBgg: z.literal(true),
        bggProcessingIsSeparateFromProviderProcessing: z.literal(true),
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
export const AnalystDiscoveryIdsSchema = z
  .array(z.object({ bggId: PositiveSafeIntegerSchema, source: z.enum(["search", "hot"]) }).strict())
  .max(20)
  .superRefine((ids, context) => {
    if (new Set(ids.map(({ bggId }) => bggId)).size !== ids.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Discovery IDs must be unique" });
    }
  });
export const AnalystDiscoveryDigestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const AnalystAssistantMessageSchema = z
  .object({
    role: z.literal("analyst"),
    content: z.string().min(1),
    outcome: z.enum(["answered", "partial", "abstained"]),
    noteDependencies: z.array(AnalystNoteDependencySchema),
    discoveryIds: AnalystDiscoveryIdsSchema.optional(),
    discoveryDigest: AnalystDiscoveryDigestSchema.optional(),
    validationAttestation: z.string().min(1),
  })
  .strict()
  .superRefine(({ noteDependencies, discoveryIds, discoveryDigest }, context) => {
    const gameIds = noteDependencies.map(({ gameId }) => gameId);
    if (new Set(gameIds).size !== gameIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["noteDependencies"],
        message: "Note dependencies must be unique by game",
      });
    }
    if ((discoveryIds === undefined) !== (discoveryDigest === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discoveryDigest"],
        message: "Discovery IDs and digest must be provided together",
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
    discoveryReceipts: z.array(z.string().min(1).max(2048)).max(20).optional(),
    messages: z.array(AnalystTranscriptMessageSchema).nonempty(),
  })
  .strict()
  .superRefine(({ messages, turnIndex, discoveryReceipts }, context) => {
    if (discoveryReceipts && new Set(discoveryReceipts).size !== discoveryReceipts.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discoveryReceipts"],
        message: "Discovery receipts must be unique",
      });
    }
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

const AnalystDiscoveryCandidateSchema = z
  .object({
    bggId: BggIdSchema,
    primaryName: BggNameSchema,
    yearPublished: z.number().int().min(1).max(9999).nullable(),
    identityCitationId: BggCitationIdSchema,
  })
  .strict();
const AnalystDiscoveryResultOkSchema = z
  .object({
    status: z.literal("ok"),
    source: z.enum(["title", "hot"]),
    observedAt: TimestampSchema,
    returnedCount: SafeCountSchema,
    emittedCount: SafeCountSchema,
    truncated: z.boolean(),
    observationCitationId: BggCitationIdSchema,
    candidates: z.array(AnalystDiscoveryCandidateSchema).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    const cap = value.source === "title" ? 10 : 20;
    if (
      value.emittedCount !== value.candidates.length ||
      value.emittedCount > cap ||
      value.returnedCount < value.emittedCount ||
      value.truncated !== value.returnedCount > value.emittedCount
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Inconsistent discovery counts" });
    }
    if (new Set(value.candidates.map(({ bggId }) => bggId)).size !== value.candidates.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidates"],
        message: "Candidate IDs must be unique",
      });
  });
export const AnalystBggDiscoveryResultSchema = z.union([
  AnalystDiscoveryResultOkSchema,
  BggFailureSchema,
]);
export const AnalystBggTitleSearchResultSchema = AnalystBggDiscoveryResultSchema.superRefine(
  (result, context) => {
    if (result.status === "ok" && result.source !== "title")
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "Title search result source must be title",
      });
  },
);
export const AnalystBggHotReviewResultSchema = AnalystBggDiscoveryResultSchema.superRefine(
  (result, context) => {
    if (result.status === "ok" && result.source !== "hot")
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "Hot result source must be hot",
      });
  },
);

const AnalystThingFactSchema = z
  .object({
    bggId: BggIdSchema,
    primaryName: BggNameSchema,
    yearPublished: z.number().int().min(1).max(9999).nullable(),
    mechanics: z.array(z.object({ id: BggIdSchema, name: BggMechanicNameSchema }).strict()).max(20),
    mechanicsComplete: z.boolean(),
    missingFields: z.array(z.enum(["year", "mechanics"])).max(2),
    warnings: z.array(z.literal("partial-links")).max(1),
    observedAt: TimestampSchema,
    factCitationId: BggCitationIdSchema,
  })
  .strict()
  .superRefine((fact, context) => {
    if (new Set(fact.mechanics.map(({ id }) => id)).size !== fact.mechanics.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mechanics"],
        message: "Mechanic IDs must be unique",
      });
    if (fact.missingFields.includes("year") !== (fact.yearPublished === null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["missingFields"],
        message: "Year availability must agree",
      });
    if (fact.missingFields.includes("mechanics") === fact.mechanicsComplete)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mechanicsComplete"],
        message: "Mechanic completeness must agree",
      });
  });
const AnalystFactFailureSchema = z
  .object({
    bggId: BggIdSchema,
    code: z.enum([
      "MissingGame",
      "NonBoardgame",
      "MismatchedId",
      "BggUnauthorized",
      "BggThrottled",
      "BggQueuedTimeout",
      "BggOutage",
      "BggParse",
    ]),
    retryable: z.boolean(),
  })
  .strict();
const AnalystFactsBatchSchema = z
  .object({
    status: z.enum(["ok", "partial"]),
    requestedCount: z.number().int().safe().min(1).max(10),
    facts: z.array(AnalystThingFactSchema).max(10),
    failures: z.array(AnalystFactFailureSchema).max(10),
    coverage: z.enum(["complete", "partial"]),
  })
  .strict()
  .superRefine((result, context) => {
    const ids = [
      ...result.facts.map(({ bggId }) => bggId),
      ...result.failures.map(({ bggId }) => bggId),
    ];
    if (
      ids.length !== result.requestedCount ||
      new Set(ids).size !== ids.length ||
      result.status !== (result.failures.length ? "partial" : "ok") ||
      result.coverage !== (result.failures.length ? "partial" : "complete")
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Facts must partition requested IDs with matching coverage",
      });
  });
export const AnalystBggFactsResultSchema = z.union([AnalystFactsBatchSchema, BggFailureSchema]);

const AnalystConfidenceSchema = z.enum(["actual", "strong", "moderate", "weak", "insufficient"]);
const AnalystPreviewUnavailableReasonSchema = z
  .object({
    reason: z.literal("stage-0"),
    ratedGameCount: SafeCountSchema,
    gamesNeeded: SafeCountSchema,
  })
  .strict();
const AnalystPreviewScoreSchema = z
  .object({
    value: z.number().finite(),
    label: z.enum(["actual", "predicted"]),
    readinessStage: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    confidence: AnalystConfidenceSchema.nullable(),
    predictionUnavailable: AnalystPreviewUnavailableReasonSchema.nullable(),
    axes: z
      .array(
        z
          .object({
            axisId: z.string().min(1).max(80),
            axisName: BggNameSchema,
            value: z.number().finite().nullable(),
            source: z.enum(["actual", "predicted", "derived", "missing"]),
            confidence: AnalystConfidenceSchema.nullable(),
          })
          .strict(),
      )
      .max(20),
    referenceGames: z
      .array(z.object({ gameId: z.string().min(1).max(128), gameName: BggNameSchema }).strict())
      .max(5),
  })
  .strict();
const AnalystPreviewCommon = {
  bggId: BggIdSchema,
  calculatedAt: TimestampSchema,
  sourceVersion: z.string().min(1).max(128),
  calculationCitationId: BggCitationIdSchema,
};
const AnalystVerifiedLookup = z
  .object({
    status: z.literal("verified"),
    observedAt: TimestampSchema,
    factCitationId: BggCitationIdSchema,
  })
  .strict();
const AnalystFailedLookup = z
  .object({
    status: z.literal("failed"),
    code: z.enum([
      "MissingGame",
      "NonBoardgame",
      "MismatchedId",
      "BggUnauthorized",
      "BggThrottled",
      "BggQueuedTimeout",
      "BggOutage",
      "BggParse",
      "NotConfigured",
    ]),
    retryable: z.boolean(),
  })
  .strict();
const AnalystPreviewWithScore = AnalystPreviewScoreSchema;
const AnalystOwnershipSchema = z.enum(["owned", "previously-owned", "other"]);
const AnalystPreviewOk = z
  .object({
    ...AnalystPreviewCommon,
    status: z.literal("ok"),
    state: z.literal("predicted"),
    primaryName: BggNameSchema,
    bggLookup: AnalystVerifiedLookup,
    score: AnalystPreviewWithScore,
  })
  .strict();
const AnalystPreviewExisting = z
  .object({
    ...AnalystPreviewCommon,
    status: z.literal("ok"),
    state: z.literal("existing"),
    primaryName: BggNameSchema,
    bggLookup: AnalystVerifiedLookup,
    collectionGameId: z.string().min(1).max(128),
    ownership: AnalystOwnershipSchema,
    collectionCitationId: BggCitationIdSchema,
    score: AnalystPreviewWithScore,
  })
  .strict();
const AnalystPreviewLocal = z
  .object({
    ...AnalystPreviewCommon,
    status: z.literal("partial"),
    state: z.literal("existing-local-unverified"),
    bggLookup: AnalystFailedLookup,
    collectionGameId: z.string().min(1).max(128),
    collectionName: BggNameSchema,
    ownership: AnalystOwnershipSchema,
    collectionCitationId: BggCitationIdSchema,
    score: AnalystPreviewWithScore,
  })
  .strict();
const AnalystPreviewUnavailable = z
  .object({
    status: z.literal("unavailable"),
    state: z.literal("unavailable"),
    bggId: BggIdSchema,
    code: BggFailureCodeSchema,
    retryable: z.boolean(),
    predictionUnavailable: AnalystPreviewUnavailableReasonSchema.nullable(),
  })
  .strict();
const AnalystPreviewAmbiguous = z
  .object({
    status: z.literal("partial"),
    state: z.literal("ambiguous"),
    bggId: BggIdSchema,
    collectionGameIds: z.array(z.string().min(1).max(128)).min(1).max(10),
    code: z.literal("AmbiguousCollectionMatch"),
  })
  .strict();
export const AnalystBggFitnessPreviewResultSchema = z.union([
  AnalystPreviewOk,
  AnalystPreviewExisting,
  AnalystPreviewLocal,
  AnalystPreviewUnavailable,
  AnalystPreviewAmbiguous,
  BggFailureSchema,
]);

/** Bounded daemon-authored ephemeral views attached atomically to a terminal turn. */
export const AnalystDiscoveryViewSchema = z.array(AnalystBggDiscoveryResultSchema).max(20);
export const AnalystFitnessPreviewViewSchema = z
  .array(AnalystBggFitnessPreviewResultSchema)
  .max(10);
export const AnalystCitationInspectionViewSchema = z.union([
  z.object({ kind: z.literal("item"), result: AnalystBggFactsResultSchema }).strict(),
  z.object({ kind: z.literal("discovery"), result: AnalystBggDiscoveryResultSchema }).strict(),
  z
    .object({ kind: z.literal("calculation"), result: AnalystBggFitnessPreviewResultSchema })
    .strict(),
]);
const AnalystCitationInspectionRecordShape = {
  version: z.literal(1),
  conversationId: IdSchema,
  requestId: IdSchema,
  turnIndex: SafeCountSchema,
  citation: z.lazy(() => AnalystCitationSchema),
  view: AnalystCitationInspectionViewSchema,
};
type AnalystCitationInspectionFields = {
  citation: AnalystCitation;
  view: AnalystCitationInspectionView;
};
function refineCitationInspectionRecord(
  record: AnalystCitationInspectionFields,
  context: z.RefinementCtx,
): void {
  const { citation, view } = record;
  const bggId = citation.sourceId;
  const destination = citation.destination;
  if (
    (destination.operationId === "shelf.analyst.discovery.get" ||
      destination.operationId === "shelf.analyst.calculation.get") &&
    destination.parameters.citationId !== citation.citationId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["citation", "destination"],
      message: "Destination citation ID mismatch",
    });
  }
  if (
    destination.operationId === "shelf.bgg.item.get" &&
    String(destination.parameters.bggId) !== bggId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["citation", "destination"],
      message: "Destination BGG ID mismatch",
    });
  }
  if (view.kind === "discovery") {
    const isCandidateIdentity = citation.evidenceClass === "bgg-candidate-identity";
    const discoveryMatches =
      view.result.status === "ok" &&
      (isCandidateIdentity
        ? view.result.candidates.some(
            ({ bggId: id, identityCitationId }) =>
              String(id) === bggId && identityCitationId === citation.citationId,
          )
        : view.result.observationCitationId === citation.citationId);
    const expectedDestination = isCandidateIdentity
      ? "shelf.bgg.item.get"
      : "shelf.analyst.discovery.get";
    if (
      citation.destination.operationId !== expectedDestination ||
      !["bgg-search-observation", "bgg-hot-observation", "bgg-candidate-identity"].includes(
        citation.evidenceClass,
      ) ||
      !discoveryMatches
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["view"],
        message: "Discovery view does not match citation",
      });
    }
  } else if (view.kind === "item") {
    const matching =
      view.result.status === "error"
        ? false
        : view.result.facts.some(
            ({ bggId: id, factCitationId }) =>
              String(id) === bggId && factCitationId === citation.citationId,
          );
    if (
      citation.destination.operationId !== "shelf.bgg.item.get" ||
      citation.evidenceClass !== "bgg-thing-facts" ||
      !matching
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["view"],
        message: "Item view does not match citation",
      });
    }
  } else {
    const result = view.result;
    const matching =
      "bggId" in result &&
      String(result.bggId) === bggId &&
      ("calculationCitationId" in result
        ? result.calculationCitationId === citation.citationId
        : false);
    if (
      citation.destination.operationId !== "shelf.analyst.calculation.get" ||
      citation.evidenceClass !== "bgg-preview-calculation" ||
      !matching
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["view"],
        message: "Calculation view does not match citation",
      });
    }
  }
  if (
    new TextEncoder().encode(JSON.stringify(record)).byteLength >
    ANALYST_CITATION_INSPECTION_MAX_RECORD_BYTES
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Citation inspection record exceeds byte limit",
    });
  }
}
export const AnalystCitationInspectionUnsignedRecordSchema = z
  .object(AnalystCitationInspectionRecordShape)
  .strict()
  .superRefine(refineCitationInspectionRecord);
export const AnalystCitationInspectionAttestedUnsignedRecordSchema = z
  .object({
    ...AnalystCitationInspectionRecordShape,
    attestationDigest: AnalystDiscoveryDigestSchema,
  })
  .strict()
  .superRefine(refineCitationInspectionRecord);
export const AnalystCitationInspectionRecordSchema = z
  .object({
    ...AnalystCitationInspectionRecordShape,
    attestationDigest: AnalystDiscoveryDigestSchema,
    authenticationToken: z.string().min(1).max(2048),
  })
  .strict()
  .superRefine(refineCitationInspectionRecord);
// A single Hot discovery can require 20 candidate identities plus its
// observation record. Keep a bounded turn-wide ceiling above that minimum.
export const ANALYST_CITATION_INSPECTION_MAX_COUNT = 64;
export const ANALYST_CITATION_INSPECTION_MAX_RECORD_BYTES = 16_384;
export const ANALYST_CITATION_INSPECTION_MAX_TOTAL_BYTES = 131_072;
export const AnalystCitationInspectionsSchema = z
  .array(AnalystCitationInspectionRecordSchema)
  .max(ANALYST_CITATION_INSPECTION_MAX_COUNT)
  .superRefine((records, context) => {
    let totalBytes = 0;
    for (const [index, record] of records.entries()) {
      const bytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
      totalBytes += bytes;
      if (bytes > ANALYST_CITATION_INSPECTION_MAX_RECORD_BYTES) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "Citation inspection record exceeds byte limit",
        });
      }
    }
    if (totalBytes > ANALYST_CITATION_INSPECTION_MAX_TOTAL_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Citation inspection records exceed total byte limit",
      });
    }
  });
function addDiscoveryIdentityPairIssue(
  value: { discoveryIds?: unknown; discoveryDigest?: unknown },
  context: z.RefinementCtx,
  path: (string | number)[] = [],
): void {
  if ((value.discoveryIds === undefined) !== (value.discoveryDigest === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "discoveryDigest"],
      message: "Discovery IDs and digest must be provided together",
    });
  }
}
export const AnalystDiscoveryReceiptsSchema = z
  .array(z.string().min(1).max(2048))
  .max(20)
  .superRefine((receipts, context) => {
    if (new Set(receipts).size !== receipts.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Discovery receipts must be unique",
      });
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
    const bggClass = citation.evidenceClass.startsWith("bgg-");
    if (bggClass) {
      const expected =
        citation.evidenceClass === "bgg-preview-calculation"
          ? "shelf.analyst.calculation.get"
          : citation.evidenceClass === "bgg-search-observation" ||
              citation.evidenceClass === "bgg-hot-observation"
            ? "shelf.analyst.discovery.get"
            : "shelf.bgg.item.get";
      if (citation.destination.operationId !== expected) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destination"],
          message: "BGG citation destination must match its evidence class",
        });
      }
    }
  });
/**
 * A model-selected local ranking. `fitness` is the current-scoring
 * displayedFitness scalar, not an owner rating; unavailable scores rank after
 * numeric scores. Equal values (including unavailable values) break by game ID.
 */
export const AnalystTopRequestSchema = z
  .object({
    snapshotFingerprint: IdSchema,
    rankBy: z.literal("fitness"),
    limit: PositiveSafeIntegerSchema.max(100).optional(),
    cursor: z
      .object({ snapshotFingerprint: IdSchema, token: z.string().uuid() })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export const AnalystTopEntrySchema = z
  .object({
    gameId: IdSchema,
    name: z.string(),
    fitness: z.number().nullable(),
    breakdown: z.array(
      z
        .object({
          axisId: IdSchema,
          axisName: z.string().min(1),
          contribution: z.number().nullable(),
        })
        .strict(),
    ),
    citations: z.array(AnalystCitationSchema).length(2),
  })
  .strict();
export const AnalystTopScopeSchema = z
  .object({
    totalGameCount: SafeCountSchema,
    matchingGameCount: SafeCountSchema,
    examinedGameCount: SafeCountSchema,
    exhaustive: z.boolean(),
  })
  .strict();
export const AnalystTopResultSchema = z
  .object({
    snapshotFingerprint: IdSchema,
    entries: z.array(AnalystTopEntrySchema),
    scope: AnalystTopScopeSchema,
    nextCursor: z
      .object({ snapshotFingerprint: IdSchema, token: z.string().uuid() })
      .strict()
      .nullable(),
    truncated: z.boolean(),
  })
  .strict();
/**
 * Grep patterns are literal, case-insensitive Unicode text, not regular
 * expressions. This keeps local search deterministic and immune to regex
 * backtracking while still allowing punctuation to be searched.
 */
export const AnalystGrepRequestSchema = z
  .object({
    snapshotFingerprint: IdSchema,
    pattern: z
      .string()
      .min(1)
      .max(128)
      .refine(
        (value) =>
          !Array.from(value).some((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint < 32 || codePoint === 127;
          }),
        { message: "Grep pattern must not contain control characters" },
      ),
    allowedFields: z
      .array(z.enum(["notes", "metadata.mechanics", "metadata.categories", "metadata.description"]))
      .min(1),
    gameIds: z.array(IdSchema).min(1).max(100),
    cursor: z
      .object({ snapshotFingerprint: IdSchema, token: z.string().uuid() })
      .strict()
      .nullable()
      .optional(),
    limit: PositiveSafeIntegerSchema.max(50).optional(),
  })
  .strict()
  .superRefine(({ allowedFields, gameIds }, context) => {
    if (new Set(allowedFields).size !== allowedFields.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedFields"],
        message: "Grep allowed fields must be unique",
      });
    if (new Set(gameIds).size !== gameIds.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gameIds"],
        message: "Grep game IDs must be unique",
      });
  });
export const AnalystGrepMatchSchema = z
  .object({
    gameId: IdSchema,
    field: z.enum(["note", "metadata.mechanic", "metadata.category", "metadata.description"]),
    snippet: z.string().min(1).max(280),
    sourceId: IdSchema,
    sourceVersion: z.string().min(1),
    citationId: IdSchema,
    evidenceClass: z.enum(["owner-game-note", "imported-metadata"]),
  })
  .strict();
export const AnalystGrepResultSchema = z
  .object({
    snapshotFingerprint: IdSchema,
    matches: z.array(AnalystGrepMatchSchema),
    scope: z
      .object({
        totalSourceCount: SafeCountSchema,
        matchingSourceCount: SafeCountSchema,
        examinedSourceCount: SafeCountSchema,
        exhaustive: z.boolean(),
      })
      .strict(),
    nextCursor: z
      .object({ snapshotFingerprint: IdSchema, token: z.string().uuid() })
      .strict()
      .nullable(),
    truncated: z.boolean(),
  })
  .strict();

/** Explicit, bounded fields available through the local game evidence reader. */
export const AnalystReadGamesFieldSchema = z.enum([
  "game-identity-ownership",
  "current-scoring",
  "imported-metadata",
  "play-acquisition",
  "collection-structure",
  "owner-game-note",
]);
export const AnalystReadGamesRequestSchema = z
  .object({
    snapshotFingerprint: IdSchema,
    gameIds: z.array(IdSchema).min(1).max(10),
    fields: z.array(AnalystReadGamesFieldSchema).min(1),
  })
  .strict()
  .superRefine(({ gameIds, fields }, context) => {
    if (new Set(gameIds).size !== gameIds.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gameIds"],
        message: "Read game IDs must be unique",
      });
    if (new Set(fields).size !== fields.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: "Read fields must be unique",
      });
  });
export const AnalystReadGamesItemSchema = z
  .object({
    gameId: IdSchema,
    state: z.enum(["found", "not-found"]),
    citations: z.array(AnalystCitationSchema),
    fields: z.array(
      z
        .object({
          field: AnalystReadGamesFieldSchema,
          state: z.enum(["available", "missing", "cleared", "not-found"]),
          covered: z.boolean(),
          source: z
            .object({
              citationId: IdSchema,
              sourceId: IdSchema,
              sourceVersion: z.string().min(1),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export const AnalystReadGamesResultSchema = z
  .object({
    snapshotFingerprint: IdSchema,
    items: z.array(AnalystReadGamesItemSchema),
    scope: z
      .object({
        totalSourceCount: SafeCountSchema,
        matchingSourceCount: SafeCountSchema,
        examinedSourceCount: SafeCountSchema,
        exhaustive: z.boolean(),
      })
      .strict(),
    truncated: z.literal(false),
  })
  .strict();

/**
 * Purpose-limited collection aggregation. A game belongs to every distinct
 * normalized value in its selected multi-valued metadata field; it is never
 * assigned to a synthetic "missing" group.
 */
export const AnalystSummarizeRequestSchema = z
  .object({
    snapshotFingerprint: IdSchema,
    groupBy: z.enum(["metadata.mechanics", "metadata.categories"]),
    measures: z
      .array(z.enum(["gameCount", "averageFitness"]))
      .min(1)
      .max(2),
    cursor: z
      .object({ snapshotFingerprint: IdSchema, token: z.string().uuid() })
      .strict()
      .nullable()
      .optional(),
    limit: PositiveSafeIntegerSchema.max(50).optional(),
  })
  .strict()
  .superRefine(({ measures }, context) => {
    if (new Set(measures).size !== measures.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["measures"],
        message: "Summarize measures must be unique",
      });
  });
export const AnalystSummaryEntrySchema = z
  .object({
    group: z.object({ id: SafeCountSchema, name: z.string().min(1) }).strict(),
    gameCount: SafeCountSchema.optional(),
    averageFitness: z.number().finite().nullable().optional(),
    fitnessGameCount: SafeCountSchema,
    citation: AnalystCitationSchema,
  })
  .strict();
export const AnalystSummarizeResultSchema = z
  .object({
    snapshotFingerprint: IdSchema,
    groupBy: z.enum(["metadata.mechanics", "metadata.categories"]),
    measures: z
      .array(z.enum(["gameCount", "averageFitness"]))
      .min(1)
      .max(2),
    entries: z.array(AnalystSummaryEntrySchema),
    scope: z
      .object({
        totalGameCount: SafeCountSchema,
        metadataSourceGameCount: SafeCountSchema,
        groupValueGameCount: SafeCountSchema,
        missingGroupValueGameCount: SafeCountSchema,
        fitnessGameCount: SafeCountSchema,
        missingFitnessGameCount: SafeCountSchema,
        examinedGameCount: SafeCountSchema,
        exhaustive: z.boolean(),
      })
      .strict(),
    citation: AnalystCitationSchema,
    nextCursor: z
      .object({ snapshotFingerprint: IdSchema, token: z.string().uuid() })
      .strict()
      .nullable(),
    truncated: z.boolean(),
  })
  .strict();
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
  .object({
    citation: AnalystCitationIdentitySchema,
    inspection: AnalystCitationInspectionRecordSchema.optional(),
  })
  .strict()
  .superRefine(({ citation, inspection }, context) => {
    if (
      inspection &&
      (citation.citationId !== inspection.citation.citationId ||
        citation.sourceId !== inspection.citation.sourceId ||
        citation.sourceVersion !== inspection.citation.sourceVersion ||
        citation.evidenceClass !== inspection.citation.evidenceClass)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inspection", "citation"],
        message: "Inspection citation identity mismatch",
      });
    }
  });
export const AnalystCitationInspectResultSchema = z
  .union([
    z.object({ state: z.literal("current"), destination: AnalystDestinationSchema }).strict(),
    z.object({ state: z.literal("superseded"), destination: AnalystDestinationSchema }).strict(),
    z
      .object({
        state: z.literal("historical"),
        destination: AnalystDestinationSchema,
        inspectedAt: TimestampSchema,
        view: AnalystCitationInspectionViewSchema,
        authenticationToken: z.string().min(1).max(2048),
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (result.state !== "historical") return;
    const expected =
      result.view.kind === "item"
        ? "shelf.bgg.item.get"
        : result.view.kind === "discovery"
          ? "shelf.analyst.discovery.get"
          : "shelf.analyst.calculation.get";
    if (result.destination.operationId !== expected)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destination"],
        message: "Historical destination does not match view",
      });
  });
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
      discovery: AnalystDiscoveryViewSchema.optional(),
      fitnessPreview: AnalystFitnessPreviewViewSchema.optional(),
      discoveryReceipts: AnalystDiscoveryReceiptsSchema.optional(),
      discoveryIds: AnalystDiscoveryIdsSchema.optional(),
      discoveryDigest: AnalystDiscoveryDigestSchema.optional(),
      citationInspections: AnalystCitationInspectionsSchema.optional(),
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

export const AnalystStreamEventSchema = analystStream.EventSchema.superRefine((event, context) => {
  if (event.type === "completed") {
    addDiscoveryIdentityPairIssue(event, context);
    const inspections = event.citationInspections;
    if (
      inspections &&
      inspections.some(
        (record) =>
          record.conversationId !== event.conversationId || record.requestId !== event.requestId,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citationInspections"],
        message: "Citation inspections must match terminal turn",
      });
    }
  }
});

export type AnalystReadGamesItem = z.infer<typeof AnalystReadGamesItemSchema>;
export type AnalystReadGamesResult = z.infer<typeof AnalystReadGamesResultSchema>;
export type AnalystReadGamesField = z.infer<typeof AnalystReadGamesFieldSchema>;
export type AnalystSummarizeResult = z.infer<typeof AnalystSummarizeResultSchema>;
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
    if (
      event.type === "completed" &&
      event.citationInspections?.some(({ turnIndex }) => turnIndex !== accepted.turnIndex)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "citationInspections"],
        message: "Citation inspections must match accepted turn index",
      });
    }
  }
});

export type AnalystEvidenceClass = (typeof ANALYST_EVIDENCE_CLASSES)[number];
export type AnalystAbstentionReason = (typeof ANALYST_ABSTENTION_REASONS)[number];
export type AnalystUnavailableReason = (typeof ANALYST_UNAVAILABLE_REASONS)[number];
export type AnalystTurnRequest = z.infer<typeof AnalystTurnRequestSchema>;
export type AnalystBggDiscoveryResult = z.infer<typeof AnalystBggDiscoveryResultSchema>;
export type AnalystBggTitleSearchResult = z.infer<typeof AnalystBggTitleSearchResultSchema>;
export type AnalystBggHotReviewResult = z.infer<typeof AnalystBggHotReviewResultSchema>;
export type AnalystBggFactsResult = z.infer<typeof AnalystBggFactsResultSchema>;
export type AnalystBggFitnessPreviewResult = z.infer<typeof AnalystBggFitnessPreviewResultSchema>;
export type AnalystCitationInspectionRecord = z.infer<typeof AnalystCitationInspectionRecordSchema>;
export type AnalystCitationInspectionView = z.infer<typeof AnalystCitationInspectionViewSchema>;
export type AnalystCitationInspectionUnsignedRecord = z.infer<
  typeof AnalystCitationInspectionUnsignedRecordSchema
>;
export type AnalystCitationInspectionAttestedUnsignedRecord = z.infer<
  typeof AnalystCitationInspectionAttestedUnsignedRecordSchema
>;
export type AnalystCitation = z.infer<typeof AnalystCitationSchema>;
export type AnalystTopRequest = z.infer<typeof AnalystTopRequestSchema>;
export type AnalystTopResult = z.infer<typeof AnalystTopResultSchema>;
export type AnalystGrepMatch = z.infer<typeof AnalystGrepMatchSchema>;
export type AnalystGrepResult = z.infer<typeof AnalystGrepResultSchema>;
export type AnalystAnswerBlock = z.infer<typeof AnalystAnswerBlockSchema>;
export type AnalystFinal = z.infer<typeof AnalystFinalSchema>;
export type AnalystStreamEvent = z.infer<typeof AnalystStreamEventSchema>;
