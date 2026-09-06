import { describe, expect, test } from "bun:test";
import {
  ANALYST_ABSTENTION_REASONS,
  ANALYST_EVIDENCE_CLASSES,
  ANALYST_EVIDENCE_MANIFEST,
  ANALYST_UNAVAILABLE_REASONS,
  AnalystAnswerBlockSchema,
  AnalystCancelRequestSchema,
  AnalystCancelResultSchema,
  AnalystCitationInspectRequestSchema,
  AnalystCitationInspectResultSchema,
  AnalystCitationSchema,
  AnalystConfigurationGetRequestSchema,
  AnalystConfigurationSchema,
  AnalystDestinationSchema,
  AnalystFinalSchema,
  AnalystOperationResultSchema,
  AnalystStreamEventHistorySchema,
  AnalystStreamEventSchema,
  AnalystTurnRequestSchema,
  AnalystUnavailableSchema,
  createGroundedEvidenceSchemas,
  createGroundedOperationResultSchema,
  createGroundedStreamSchemas,
} from "../src/index";
import type { AnalystTurnRequest } from "../src/index";

const capability = "a".repeat(64);
const time = "2026-09-06T12:00:00.000Z";
const citation = {
  citationId: "citation-1",
  sourceId: "game-1",
  sourceVersion: "1",
  evidenceClass: "owner-game-note" as const,
  canonicalSummary: "Owner testimony for game one",
  testimony: true,
  destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
};
const block = { text: "The owner described a useful quality.", citationIds: ["citation-1"] };
const disclosure = { providerId: "provider", modelId: "model", acknowledged: true as const };

function request(
  messages: AnalystTurnRequest["messages"] = [{ role: "owner", content: "What fits best?" }],
) {
  return {
    conversationId: "conversation-1",
    conversationCapability: capability,
    requestId: "request-1",
    turnIndex: messages.filter(({ role }) => role === "analyst").length,
    disclosure,
    messages,
  };
}

function final(outcome: "answered" | "partial" | "abstained" = "answered") {
  const base = {
    blocks: [block],
    citations: [citation],
    usage: { state: "reported" as const, inputTokens: 1, inferenceRoundTrips: 3 },
  };
  if (outcome === "abstained")
    return { ...base, outcome, reason: "insufficient-evidence" as const };
  return outcome === "partial"
    ? {
        ...base,
        outcome,
        blocks: [{ ...block, uncertainty: "The remaining scope was not examined." }],
      }
    : { ...base, outcome };
}

describe("Collection Analyst closed manifest", () => {
  test("locks every approved class, field, identity, observation rule, summary, and destination", () => {
    expect(ANALYST_EVIDENCE_CLASSES).toEqual([
      "game-identity-ownership",
      "current-scoring",
      "imported-metadata",
      "play-acquisition",
      "collection-structure",
      "profile-evidence",
      "owner-game-note",
    ]);
    expect(ANALYST_EVIDENCE_MANIFEST).toEqual({
      version: 1,
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
            "weight",
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
            "purchaseUtilization",
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
          sourceIdentity:
            "entity class, entity ID, profile algorithm version, and collection revision",
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
    });
  });

  test("keeps Analyst registries isolated from Reflection-shaped evidence, destinations, events, and results", () => {
    const reflection = createGroundedEvidenceSchemas({
      evidenceClasses: ["reflection-evidence"] as const,
      dependencyCategories: ["reflection-dependency"] as const,
      destinations: { "shelf.reflection.get": AnalystConfigurationGetRequestSchema },
    });
    expect(reflection.EvidenceClassSchema.safeParse("owner-game-note").success).toBe(false);
    expect(
      AnalystCitationSchema.safeParse({ ...citation, evidenceClass: "reflection-evidence" })
        .success,
    ).toBe(false);
    expect(
      AnalystDestinationSchema.safeParse({ operationId: "shelf.reflection.get", parameters: {} })
        .success,
    ).toBe(false);
    const reflectionEvents = createGroundedStreamSchemas([
      { type: "reflection", terminal: true, payload: {} },
    ]);
    expect(
      reflectionEvents.EventSchema.safeParse({
        version: 1,
        operationId: "op",
        sequence: 0,
        occurredAt: time,
        type: "completed",
        terminal: true,
      }).success,
    ).toBe(false);
    const reflectionResults = createGroundedOperationResultSchema([
      { outcome: "reflection", payload: {} },
    ]);
    expect(reflectionResults.safeParse({ outcome: "accepted", requestId: "r" }).success).toBe(
      false,
    );
  });
});

describe("Collection Analyst requests and results", () => {
  test("enforces capability, ordered transcript, current owner turn, turn identity, and prior attestations", () => {
    expect(AnalystTurnRequestSchema.safeParse(request()).success).toBe(true);
    const prior = {
      role: "analyst" as const,
      content: "A cited answer",
      outcome: "answered" as const,
      noteDependencies: [{ gameId: "game-1", noteVersion: 1 }],
      validationAttestation: "attestation",
    };
    expect(
      AnalystTurnRequestSchema.safeParse(
        request([
          { role: "owner", content: "First" },
          prior,
          { role: "owner", content: "Follow-up" },
        ]),
      ).success,
    ).toBe(true);
    for (const invalid of [
      { ...request(), conversationCapability: "a".repeat(63) },
      { ...request(), turnIndex: 1 },
      request([
        {
          role: "analyst",
          content: "Wrong first",
          outcome: "answered",
          noteDependencies: [],
          validationAttestation: "a",
        },
      ]),
      request([
        { role: "owner", content: "First" },
        {
          ...prior,
          noteDependencies: [{ gameId: "game-1", noteVersion: 0 }],
        },
        { role: "owner", content: "Follow-up" },
      ]),
      request([{ role: "owner", content: "Missing current turn" }, prior]),
      request([
        { role: "owner", content: "First" },
        {
          ...prior,
          noteDependencies: [
            { gameId: "game-1", noteVersion: 1 },
            { gameId: "game-1", noteVersion: 2 },
          ],
        },
        { role: "owner", content: "Follow-up" },
      ]),
    ]) {
      expect(AnalystTurnRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  test("enforces citations, blocks, all final outcomes and their reason distinctions", () => {
    expect(AnalystCitationSchema.safeParse(citation).success).toBe(true);
    for (const evidenceClass of ANALYST_EVIDENCE_CLASSES) {
      const candidate = {
        ...citation,
        evidenceClass,
        testimony: evidenceClass === "owner-game-note",
      };
      expect(AnalystCitationSchema.safeParse(candidate).success, evidenceClass).toBe(true);
    }
    expect(AnalystCitationSchema.safeParse({ ...citation, sourceVersion: "01" }).success).toBe(
      false,
    );
    expect(AnalystCitationSchema.safeParse({ ...citation, testimony: false }).success).toBe(false);
    expect(
      AnalystAnswerBlockSchema.safeParse({ ...block, citationIds: ["citation-1", "citation-1"] })
        .success,
    ).toBe(false);
    expect(AnalystFinalSchema.safeParse(final()).success).toBe(true);
    expect(AnalystFinalSchema.safeParse(final("partial")).success).toBe(true);
    for (const reason of ANALYST_ABSTENTION_REASONS)
      expect(AnalystFinalSchema.safeParse({ ...final("abstained"), reason }).success, reason).toBe(
        true,
      );
    expect(AnalystFinalSchema.safeParse({ ...final("partial"), blocks: [block] }).success).toBe(
      false,
    );
    expect(
      AnalystFinalSchema.safeParse({
        ...final(),
        blocks: [{ text: "This restates the owner's question.", citationIds: [] }, block],
      }).success,
    ).toBe(true);
    expect(
      AnalystFinalSchema.safeParse({
        ...final(),
        blocks: [{ ...block, citationIds: ["invented"] }],
      }).success,
    ).toBe(false);
    expect(
      AnalystFinalSchema.safeParse({
        ...final(),
        citations: [{ ...citation, citationId: "unreferenced" }],
      }).success,
    ).toBe(false);
    expect(
      AnalystFinalSchema.safeParse({ ...final(), citations: [{ ...citation }, { ...citation }] })
        .success,
    ).toBe(false);
    expect(
      AnalystFinalSchema.safeParse({
        ...final(),
        blocks: [{ ...block, citationIds: ["citation-1", "citation-2"] }],
        citations: [
          { ...citation, citationId: "citation-1" },
          { ...citation, citationId: "citation-2" },
        ],
      }).success,
    ).toBe(false);
    expect(
      AnalystFinalSchema.safeParse({
        ...final(),
        blocks: [{ ...block, citationIds: ["citation-1", "citation-2"] }],
        citations: [
          {
            ...citation,
            sourceId: "a\u0000b",
            sourceVersion: "c",
            evidenceClass: "current-scoring",
            testimony: false,
          },
          {
            ...citation,
            citationId: "citation-2",
            sourceId: "a",
            sourceVersion: "b\u0000c",
            evidenceClass: "current-scoring",
            testimony: false,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      AnalystFinalSchema.safeParse({ ...final(), citations: [{ ...citation, unknown: true }] })
        .success,
    ).toBe(false);
    expect(
      AnalystFinalSchema.safeParse({
        ...final(),
        usage: { state: "reported", inferenceRoundTrips: 0 },
      }).success,
    ).toBe(false);
  });

  test("serializes every unavailable reason separately from completed assistant messages", () => {
    for (const reason of ANALYST_UNAVAILABLE_REASONS) {
      expect(AnalystUnavailableSchema.safeParse({ outcome: "unavailable", reason }).success).toBe(
        true,
      );
    }
  });

  test("defines configuration, all operation results, and deterministic citation inspection without source text", () => {
    expect(AnalystConfigurationGetRequestSchema.safeParse({}).success).toBe(true);
    expect(AnalystConfigurationGetRequestSchema.safeParse({ unknown: true }).success).toBe(false);
    const configuration = {
      contractVersion: 1,
      manifestVersion: 1,
      configuration: {
        status: "configured",
        identity: { providerId: "provider", modelId: "model", extensionIds: [] },
      },
      disclosure: {
        evidenceClasses: [...ANALYST_EVIDENCE_CLASSES],
        relevantOwnerNotesMayBeTransmitted: true,
        localRetention: "Ephemeral client memory",
        providerProcessingAndRetentionFollowProviderPolicy: true,
        applicationTokenCap: null,
        applicationMonetaryCap: null,
        cancellation: "Cancel the active turn",
        maximumTranscriptMessages: 8,
        maximumTranscriptCharacters: 4000,
      },
    };
    expect(AnalystConfigurationSchema.safeParse(configuration).success).toBe(true);
    expect(
      AnalystConfigurationSchema.safeParse({ ...configuration, manifestVersion: 2 }).success,
    ).toBe(false);
    for (const outcome of [
      "accepted",
      "busy",
      "invalid-transcript",
      "stale-transcript",
      "disclosure-mismatch",
      "request-id-misuse",
      "unauthorized",
      "unavailable",
    ] as const) {
      const value =
        outcome === "busy"
          ? { outcome, requestId: "r", activeRequestId: "active" }
          : outcome === "unavailable"
            ? { outcome, requestId: "r", reason: "transport" }
            : { outcome, requestId: "r" };
      expect(AnalystOperationResultSchema.safeParse(value).success, outcome).toBe(true);
    }
    const inspectionIdentity = {
      citationId: citation.citationId,
      sourceId: citation.sourceId,
      sourceVersion: citation.sourceVersion,
      evidenceClass: citation.evidenceClass,
    };
    expect(
      AnalystCitationInspectRequestSchema.safeParse({ citation: inspectionIdentity }).success,
    ).toBe(true);
    for (const malformed of [
      { citation: { ...inspectionIdentity, canonicalSummary: citation.canonicalSummary } },
      { citation: { ...inspectionIdentity, observedAt: time } },
      { citation: { ...inspectionIdentity, testimony: true } },
      { citation: { ...inspectionIdentity, sourceVersion: "" } },
    ]) {
      expect(AnalystCitationInspectRequestSchema.safeParse(malformed).success).toBe(false);
    }
    for (const state of ["current", "superseded"] as const) {
      expect(
        AnalystCitationInspectResultSchema.safeParse({ state, destination: citation.destination })
          .success,
        state,
      ).toBe(true);
    }
    expect(
      AnalystCitationInspectResultSchema.safeParse({
        state: "current",
        destination: citation.destination,
        text: "forbidden",
      }).success,
    ).toBe(false);
  });

  test("requires exact cancellation identity and rejects malformed operation and configuration variants", () => {
    expect(
      AnalystCancelRequestSchema.safeParse({
        conversationId: "conversation-1",
        conversationCapability: capability,
        requestId: "request-1",
      }).success,
    ).toBe(true);
    for (const invalidCapability of [
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "g".repeat(64),
    ]) {
      expect(
        AnalystCancelRequestSchema.safeParse({
          conversationId: "conversation-1",
          conversationCapability: invalidCapability,
          requestId: "request-1",
        }).success,
      ).toBe(false);
    }
    expect(
      AnalystCancelRequestSchema.safeParse({
        conversationId: "c",
        conversationCapability: capability,
      }).success,
    ).toBe(false);
    expect(
      AnalystOperationResultSchema.safeParse({ outcome: "accepted", requestId: "r", unknown: true })
        .success,
    ).toBe(false);
  });
});

describe("Collection Analyst strict variant regressions", () => {
  test("rejects empty final blocks and unknown configuration fields", () => {
    expect(AnalystFinalSchema.safeParse({ ...final(), blocks: [] }).success).toBe(false);
    const configuration = {
      contractVersion: 1,
      manifestVersion: 1,
      configuration: {
        status: "configured" as const,
        identity: { providerId: "provider", modelId: "model", extensionIds: [] },
      },
      disclosure: {
        evidenceClasses: [...ANALYST_EVIDENCE_CLASSES],
        relevantOwnerNotesMayBeTransmitted: true as const,
        localRetention: "Ephemeral client memory",
        providerProcessingAndRetentionFollowProviderPolicy: true as const,
        applicationTokenCap: null,
        applicationMonetaryCap: null,
        cancellation: "Cancel the active turn",
        maximumTranscriptMessages: 8,
        maximumTranscriptCharacters: 4000,
      },
    };
    expect(AnalystConfigurationSchema.safeParse({ ...configuration, unknown: true }).success).toBe(
      false,
    );
  });
});

describe("Collection Analyst cancellation result contract", () => {
  test("covers every cancel result and rejects unknown result fields", () => {
    for (const outcome of ["accepted", "not-found", "request-id-misuse", "unauthorized"] as const) {
      expect(
        AnalystCancelResultSchema.safeParse({ outcome, requestId: "r" }).success,
        outcome,
      ).toBe(true);
    }
    expect(
      AnalystCancelResultSchema.safeParse({ outcome: "accepted", requestId: "r", unknown: true })
        .success,
    ).toBe(false);
  });
});

describe("Collection Analyst stream contracts", () => {
  test("covers every event, unavailable reason, and terminal history rule", () => {
    const base = {
      version: 1,
      operationId: "shelf.analyst.turn.stream",
      occurredAt: time,
      conversationId: "conversation-1",
      requestId: "request-1",
    };
    const events = [
      { ...base, sequence: 0, type: "accepted", terminal: false, turnIndex: 0 },
      {
        ...base,
        sequence: 1,
        type: "evidence-status",
        terminal: false,
        status: "started",
        examinedItemCount: 0,
      },
      { ...base, sequence: 2, type: "model-status", terminal: false, status: "validating" },
      { ...base, sequence: 3, type: "validated-block", terminal: false, block },
      {
        ...base,
        sequence: 4,
        type: "provider-usage",
        terminal: false,
        usage: { state: "unavailable" },
      },
      {
        ...base,
        sequence: 5,
        type: "completed",
        terminal: true,
        result: final(),
        validationAttestation: "attestation",
      },
    ];
    for (const event of events)
      expect(AnalystStreamEventSchema.safeParse(event).success, event.type).toBe(true);
    for (const status of ["started", "completed"] as const) {
      expect(
        AnalystStreamEventSchema.safeParse({ ...events[1], status }).success,
        `evidence:${status}`,
      ).toBe(true);
    }
    for (const status of ["started", "awaiting-submission", "validating"] as const) {
      expect(
        AnalystStreamEventSchema.safeParse({ ...events[2], status }).success,
        `model:${status}`,
      ).toBe(true);
    }
    for (const reason of ANALYST_UNAVAILABLE_REASONS)
      expect(
        AnalystStreamEventSchema.safeParse({
          ...base,
          sequence: 1,
          type: "failed",
          terminal: true,
          reason,
        }).success,
        reason,
      ).toBe(true);
    expect(
      AnalystStreamEventSchema.safeParse({
        ...base,
        sequence: 1,
        type: "cancelled",
        terminal: true,
      }).success,
    ).toBe(true);
    expect(
      AnalystStreamEventSchema.safeParse({ ...events[0], rawTokens: ["forbidden"] }).success,
    ).toBe(false);
    expect(AnalystStreamEventHistorySchema.safeParse(events).success).toBe(true);
    expect(AnalystStreamEventHistorySchema.safeParse(events.slice(1)).success).toBe(false);
    expect(AnalystStreamEventHistorySchema.safeParse(events.slice(0, -1)).success).toBe(false);
    expect(
      AnalystStreamEventHistorySchema.safeParse([
        ...events.slice(0, -1),
        { ...events[5], requestId: "other" },
      ]).success,
    ).toBe(false);
    expect(
      AnalystStreamEventHistorySchema.safeParse([
        events[0],
        { ...events[0], sequence: 1 },
        { ...events[5], sequence: 2 },
      ]).success,
    ).toBe(false);
  });
});
