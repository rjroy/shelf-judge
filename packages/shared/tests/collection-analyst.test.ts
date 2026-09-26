import { describe, expect, test } from "bun:test";
import {
  ANALYST_ABSTENTION_REASONS,
  ANALYST_EVIDENCE_CLASSES,
  ANALYST_EVIDENCE_MANIFEST,
  ANALYST_UNAVAILABLE_REASONS,
  AnalystBggTitleSearchResultSchema,
  AnalystBggHotReviewResultSchema,
  AnalystBggFactsResultSchema,
  AnalystBggFitnessPreviewResultSchema,
  AnalystAnswerBlockSchema,
  AnalystCancelRequestSchema,
  AnalystCancelResultSchema,
  AnalystCitationInspectRequestSchema,
  AnalystCitationInspectResultSchema,
  AnalystCitationInspectionRecordSchema,
  AnalystCitationInspectionUnsignedRecordSchema,
  AnalystCitationInspectionAttestedUnsignedRecordSchema,
  AnalystCitationInspectionsSchema,
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
const disclosure = {
  providerId: "provider",
  modelId: "model",
  manifestVersion: 4 as const,
  disclosureVersion: 1 as const,
  acknowledged: true as const,
};

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
      "collection-summary",
      "profile-evidence",
      "owner-game-note",
      "bgg-search-observation",
      "bgg-hot-observation",
      "bgg-candidate-identity",
      "bgg-thing-facts",
      "bgg-preview-calculation",
    ]);
    expect(ANALYST_EVIDENCE_MANIFEST).toEqual({
      version: 4,
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
          sourceIdentity:
            "summary scope, selected group, and complete contributing source versions",
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
          fields: [
            "bggId",
            "primaryName",
            "yearPublished",
            "mechanics",
            "missingFields",
            "warnings",
          ],
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

  test("requires canonical BGG destinations matched to the citation evidence class", () => {
    const bggCitation = {
      ...citation,
      evidenceClass: "bgg-candidate-identity",
      testimony: false,
      destination: { operationId: "shelf.bgg.item.get", parameters: { bggId: 174430 } },
    };
    expect(AnalystCitationSchema.safeParse(bggCitation).success).toBe(true);
    for (const destination of [
      { operationId: "shelf.game.get", parameters: { gameId: "174430" } },
      {
        operationId: "shelf.bgg.item.get",
        parameters: { bggId: 174430, url: "https://evil.test" },
      },
    ])
      expect(AnalystCitationSchema.safeParse({ ...bggCitation, destination }).success).toBe(false);
    expect(
      AnalystCitationSchema.safeParse({
        ...bggCitation,
        evidenceClass: "bgg-search-observation",
        destination: { operationId: "shelf.bgg.item.get", parameters: { bggId: 174430 } },
      }).success,
    ).toBe(false);
  });
});

describe("Collection Analyst requests and results", () => {
  test("enforces capability, ordered transcript, current owner turn, turn identity, and prior attestations", () => {
    expect(AnalystTurnRequestSchema.safeParse(request()).success).toBe(true);
    expect(
      AnalystTurnRequestSchema.safeParse({ ...request(), discoveryReceipts: ["r".repeat(2049)] })
        .success,
    ).toBe(false);
    expect(
      AnalystTurnRequestSchema.safeParse({
        ...request(),
        discoveryReceipts: ["receipt", "receipt"],
      }).success,
    ).toBe(false);
    expect(
      AnalystTurnRequestSchema.safeParse({
        ...request(),
        discoveryReceipts: Array.from({ length: 21 }, (_, i) => `r${i}`),
      }).success,
    ).toBe(false);
    expect(
      AnalystTurnRequestSchema.safeParse({ ...request(), discoveryReceipts: ["receipt"] }).success,
    ).toBe(true);
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
    const emittedIds = [{ bggId: 174430, source: "search" as const }];
    const emittedDigest = "d".repeat(43);
    expect(
      AnalystTurnRequestSchema.safeParse(
        request([
          { role: "owner", content: "First" },
          { ...prior, discoveryIds: emittedIds, discoveryDigest: emittedDigest },
          { role: "owner", content: "Follow-up" },
        ]),
      ).success,
    ).toBe(true);
    expect(
      AnalystTurnRequestSchema.safeParse(
        request([
          { role: "owner", content: "First" },
          { ...prior, discoveryIds: emittedIds },
          { role: "owner", content: "Follow-up" },
        ]),
      ).success,
    ).toBe(false);
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
          noteDependencies: [{ gameId: "game-1", noteVersion: -1 }],
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
        destination: evidenceClass.startsWith("bgg-")
          ? evidenceClass === "bgg-preview-calculation"
            ? {
                operationId: "shelf.analyst.calculation.get",
                parameters: { citationId: "calculation-1" },
              }
            : evidenceClass === "bgg-search-observation" || evidenceClass === "bgg-hot-observation"
              ? {
                  operationId: "shelf.analyst.discovery.get",
                  parameters: { citationId: "discovery-1" },
                }
              : { operationId: "shelf.bgg.item.get", parameters: { bggId: 174430 } }
          : citation.destination,
      };
      expect(AnalystCitationSchema.safeParse(candidate).success, evidenceClass).toBe(true);
    }
    expect(AnalystCitationSchema.safeParse({ ...citation, sourceVersion: "01" }).success).toBe(
      false,
    );
    expect(AnalystCitationSchema.safeParse({ ...citation, sourceVersion: "0" }).success).toBe(true);
    expect(AnalystCitationSchema.safeParse({ ...citation, testimony: false }).success).toBe(true);
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
      contractVersion: 4,
      manifestVersion: 4,
      disclosureVersion: 1,
      configuration: {
        status: "configured",
        identity: { providerId: "provider", modelId: "model", extensionIds: [] },
      },
      bgg: { status: "configured" },
      disclosure: {
        evidenceClasses: [...ANALYST_EVIDENCE_CLASSES],
        relevantOwnerNotesMayBeTransmitted: true,
        selectedOwnerTitleOrBggIdsMayBeSentToBgg: true,
        bggProcessingIsSeparateFromProviderProcessing: true,
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
      AnalystConfigurationSchema.safeParse({
        ...configuration,
        bgg: { status: "configured", token: "secret" },
      }).success,
    ).toBe(false);
    expect(
      AnalystConfigurationSchema.safeParse({ ...configuration, manifestVersion: 3 }).success,
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

  test("validates signed historical BGG inspection records and bounds terminal metadata", () => {
    const inspectionCitation = {
      citationId: "search-citation",
      sourceId: "search-source",
      sourceVersion: "1",
      evidenceClass: "bgg-search-observation" as const,
      observedAt: time,
      canonicalSummary: "A bounded BGG title search",
      testimony: false,
      destination: {
        operationId: "shelf.analyst.discovery.get" as const,
        parameters: { citationId: "search-citation" },
      },
    };
    const result = {
      status: "ok" as const,
      source: "title" as const,
      observedAt: time,
      returnedCount: 0,
      emittedCount: 0,
      truncated: false,
      observationCitationId: inspectionCitation.citationId,
      candidates: [],
    };
    const record = {
      version: 1 as const,
      conversationId: "conversation-1",
      requestId: "request-1",
      turnIndex: 0,
      attestationDigest: "a".repeat(43),
      citation: inspectionCitation,
      view: { kind: "discovery" as const, result },
      authenticationToken: "daemon-signature",
    };
    expect(AnalystCitationInspectionRecordSchema.safeParse(record).success).toBe(true);
    const unsignedRecord = {
      version: record.version,
      conversationId: record.conversationId,
      requestId: record.requestId,
      turnIndex: record.turnIndex,
      citation: record.citation,
      view: record.view,
    };
    expect(AnalystCitationInspectionUnsignedRecordSchema.safeParse(unsignedRecord).success).toBe(
      true,
    );
    expect(AnalystCitationInspectionUnsignedRecordSchema.safeParse(record).success).toBe(false);
    const attestedUnsignedRecord = {
      ...unsignedRecord,
      attestationDigest: record.attestationDigest,
    };
    expect(
      AnalystCitationInspectionAttestedUnsignedRecordSchema.safeParse(attestedUnsignedRecord)
        .success,
    ).toBe(true);
    expect(AnalystCitationInspectionAttestedUnsignedRecordSchema.safeParse(record).success).toBe(
      false,
    );
    const candidateCitation = {
      citationId: "candidate-identity",
      sourceId: "174430",
      sourceVersion: "1",
      evidenceClass: "bgg-candidate-identity" as const,
      observedAt: time,
      canonicalSummary: "Candidate identity from BGG discovery",
      testimony: false,
      destination: { operationId: "shelf.bgg.item.get" as const, parameters: { bggId: 174430 } },
    };
    const candidateResult = {
      ...result,
      candidates: [
        {
          bggId: 174430,
          primaryName: "The Game",
          yearPublished: 2020,
          identityCitationId: candidateCitation.citationId,
        },
      ],
      emittedCount: 1,
      returnedCount: 1,
    };
    const candidateRecord = {
      ...record,
      citation: candidateCitation,
      view: { kind: "discovery" as const, result: candidateResult },
    };
    expect(AnalystCitationInspectionRecordSchema.safeParse(candidateRecord).success).toBe(true);
    expect(
      AnalystCitationInspectionRecordSchema.safeParse({
        ...candidateRecord,
        citation: { ...candidateCitation, destination: inspectionCitation.destination },
      }).success,
    ).toBe(false);
    expect(
      AnalystCitationInspectionRecordSchema.safeParse({
        ...candidateRecord,
        view: {
          ...candidateRecord.view,
          result: {
            ...candidateResult,
            candidates: [
              { ...candidateResult.candidates[0], identityCitationId: "forged-citation" },
            ],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      AnalystCitationInspectRequestSchema.safeParse({
        citation: {
          citationId: inspectionCitation.citationId,
          sourceId: inspectionCitation.sourceId,
          sourceVersion: "1",
          evidenceClass: "bgg-search-observation",
        },
        inspection: record,
      }).success,
    ).toBe(true);
    expect(
      AnalystCitationInspectRequestSchema.safeParse({
        citation: {
          citationId: "tampered",
          sourceId: inspectionCitation.sourceId,
          sourceVersion: "1",
          evidenceClass: "bgg-search-observation",
        },
        inspection: record,
      }).success,
    ).toBe(false);
    expect(
      AnalystCitationInspectionRecordSchema.safeParse({ ...record, authenticationToken: "" })
        .success,
    ).toBe(false);
    expect(
      AnalystCitationInspectionRecordSchema.safeParse({ ...record, extra: "raw payload" }).success,
    ).toBe(false);
    expect(
      AnalystCitationInspectionRecordSchema.safeParse({
        ...record,
        view: { ...record.view, result: { ...result, observationCitationId: "other" } },
      }).success,
    ).toBe(false);
    expect(
      AnalystCitationInspectionRecordSchema.safeParse({
        ...record,
        citation: {
          ...inspectionCitation,
          destination: { operationId: "shelf.bgg.item.get", parameters: { bggId: 1 } },
        },
      }).success,
    ).toBe(false);
    expect(
      AnalystCitationInspectResultSchema.safeParse({
        state: "historical",
        destination: inspectionCitation.destination,
        inspectedAt: time,
        view: record.view,
        authenticationToken: record.authenticationToken,
      }).success,
    ).toBe(true);
    expect(
      AnalystCitationInspectResultSchema.safeParse({
        state: "historical",
        destination: { operationId: "shelf.bgg.item.get", parameters: { bggId: 1 } },
        inspectedAt: time,
        view: record.view,
        authenticationToken: record.authenticationToken,
      }).success,
    ).toBe(false);
    const oversized = {
      ...record,
      citation: { ...inspectionCitation, canonicalSummary: "x".repeat(17_000) },
    };
    expect(AnalystCitationInspectionRecordSchema.safeParse(oversized).success).toBe(false);
    expect(AnalystCitationInspectionsSchema.safeParse([oversized]).success).toBe(false);
    expect(
      AnalystCitationInspectRequestSchema.safeParse({
        citation: {
          citationId: inspectionCitation.citationId,
          sourceId: inspectionCitation.sourceId,
          sourceVersion: "1",
          evidenceClass: "bgg-search-observation",
        },
        inspection: oversized,
      }).success,
    ).toBe(false);
    expect(
      AnalystCitationInspectionsSchema.safeParse(Array.from({ length: 65 }, () => record)).success,
    ).toBe(false);
    const largeRecords = Array.from({ length: 15 }, (_, index) => ({
      ...record,
      citation: {
        ...inspectionCitation,
        citationId: `citation-${index}`,
        destination: {
          ...inspectionCitation.destination,
          parameters: { citationId: `citation-${index}` },
        },
        canonicalSummary: "x".repeat(9_000),
      },
      view: {
        kind: "discovery" as const,
        result: { ...result, observationCitationId: `citation-${index}` },
      },
    }));
    expect(AnalystCitationInspectionsSchema.safeParse(largeRecords).success).toBe(false);
  });
});

describe("Collection Analyst BGG result contracts", () => {
  const candidate = {
    bggId: 174430,
    primaryName: "The Game",
    yearPublished: 2020,
    identityCitationId: "opaque-identity",
  };
  test("strictly parses bounded title and Hot observation envelopes", () => {
    const title = {
      status: "ok",
      source: "title",
      observedAt: time,
      returnedCount: 1,
      emittedCount: 1,
      truncated: false,
      observationCitationId: "opaque-observation",
      candidates: [candidate],
    };
    expect(AnalystBggTitleSearchResultSchema.safeParse(title).success).toBe(true);
    expect(AnalystBggHotReviewResultSchema.safeParse({ ...title, source: "hot" }).success).toBe(
      true,
    );
    expect(AnalystBggTitleSearchResultSchema.safeParse({ ...title, source: "hot" }).success).toBe(
      false,
    );
    expect(AnalystBggTitleSearchResultSchema.safeParse({ ...title, extra: true }).success).toBe(
      false,
    );
    expect(
      AnalystBggTitleSearchResultSchema.safeParse({ ...title, returnedCount: 0 }).success,
    ).toBe(false);
    expect(
      AnalystBggTitleSearchResultSchema.safeParse({
        ...title,
        candidates: [{ ...candidate, primaryName: "x".repeat(161) }],
      }).success,
    ).toBe(false);
    expect(
      AnalystBggTitleSearchResultSchema.safeParse({
        ...title,
        candidates: [{ ...candidate, bggId: 0 }],
      }).success,
    ).toBe(false);
    expect(
      AnalystBggTitleSearchResultSchema.safeParse({
        status: "error",
        code: "BggOutage",
        retryable: true,
      }).success,
    ).toBe(true);
  });

  test("parses facts batch partitioning and preview variants with strict bounds", () => {
    const facts = {
      status: "ok",
      requestedCount: 1,
      coverage: "complete",
      failures: [],
      facts: [
        {
          bggId: 174430,
          primaryName: "The Game",
          yearPublished: null,
          mechanics: [{ id: 1, name: "Cooperative" }],
          mechanicsComplete: true,
          missingFields: ["year"],
          warnings: [],
          observedAt: time,
          factCitationId: "fact-citation",
        },
      ],
    };
    expect(AnalystBggFactsResultSchema.safeParse(facts).success).toBe(true);
    expect(AnalystBggFactsResultSchema.safeParse({ ...facts, extra: 1 }).success).toBe(false);
    expect(AnalystBggFactsResultSchema.safeParse({ ...facts, requestedCount: 2 }).success).toBe(
      false,
    );
    expect(
      AnalystBggFactsResultSchema.safeParse({
        ...facts,
        facts: [
          {
            ...facts.facts[0],
            mechanics: Array.from({ length: 21 }, (_, id) => ({ id: id + 1, name: "Mechanic" })),
          },
        ],
      }).success,
    ).toBe(false);
    const score = {
      value: 0,
      label: "predicted",
      readinessStage: 0,
      confidence: "insufficient",
      predictionUnavailable: { reason: "stage-0", ratedGameCount: 0, gamesNeeded: 5 },
      axes: [],
      referenceGames: [],
    };
    const preview = {
      status: "ok",
      state: "predicted",
      bggId: 174430,
      primaryName: "The Game",
      bggLookup: { status: "verified", observedAt: time, factCitationId: "fact" },
      calculatedAt: time,
      sourceVersion: "fitness-v2",
      calculationCitationId: "calc",
      score,
    };
    expect(AnalystBggFitnessPreviewResultSchema.safeParse(preview).success).toBe(true);
    expect(
      AnalystBggFitnessPreviewResultSchema.safeParse({ ...preview, rawXml: "forbidden" }).success,
    ).toBe(false);
    expect(
      AnalystBggFitnessPreviewResultSchema.safeParse({
        status: "unavailable",
        state: "unavailable",
        bggId: 174430,
        code: "PredictionUnavailable",
        retryable: false,
        predictionUnavailable: null,
      }).success,
    ).toBe(true);
  });
});

describe("Collection Analyst strict variant regressions", () => {
  test("rejects empty final blocks and unknown configuration fields", () => {
    expect(AnalystFinalSchema.safeParse({ ...final(), blocks: [] }).success).toBe(false);
    const configuration = {
      contractVersion: 4,
      manifestVersion: 4,
      disclosureVersion: 1,
      configuration: {
        status: "configured" as const,
        identity: { providerId: "provider", modelId: "model", extensionIds: [] },
      },
      bgg: { status: "configured" },
      disclosure: {
        evidenceClasses: [...ANALYST_EVIDENCE_CLASSES],
        relevantOwnerNotesMayBeTransmitted: true as const,
        selectedOwnerTitleOrBggIdsMayBeSentToBgg: true as const,
        bggProcessingIsSeparateFromProviderProcessing: true as const,
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
        noteDependencies: [],
        validationAttestation: "attestation",
      },
    ];
    for (const event of events)
      expect(AnalystStreamEventSchema.safeParse(event).success, event.type).toBe(true);
    expect(
      AnalystStreamEventSchema.safeParse({
        ...events[5],
        discoveryReceipts: ["opaque"],
        discovery: [
          {
            status: "ok",
            source: "title",
            observedAt: time,
            returnedCount: 1,
            emittedCount: 1,
            truncated: false,
            observationCitationId: "obs",
            candidates: [
              { bggId: 174430, primaryName: "Game", yearPublished: null, identityCitationId: "id" },
            ],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      AnalystStreamEventSchema.safeParse({
        ...events[5],
        discoveryReceipts: Array.from({ length: 21 }, (_, i) => `r${i}`),
      }).success,
    ).toBe(false);
    const identityFields = {
      discoveryIds: [{ bggId: 174430, source: "search" as const }],
      discoveryDigest: "d".repeat(43),
    };
    expect(AnalystStreamEventSchema.safeParse({ ...events[5], ...identityFields }).success).toBe(
      true,
    );
    expect(
      AnalystStreamEventSchema.safeParse({
        ...events[5],
        discoveryIds: identityFields.discoveryIds,
      }).success,
    ).toBe(false);
    expect(
      AnalystStreamEventSchema.safeParse({
        ...events[5],
        ...identityFields,
        discoveryIds: Array.from({ length: 21 }, (_, i) => ({
          bggId: i + 1,
          source: "hot" as const,
        })),
      }).success,
    ).toBe(false);
    expect(
      AnalystStreamEventSchema.safeParse({
        ...events[5],
        ...identityFields,
        discoveryIds: [{ bggId: 174430, source: "other" }],
      }).success,
    ).toBe(false);
    expect(
      AnalystStreamEventSchema.safeParse({ ...events[5], ...identityFields, surprise: true })
        .success,
    ).toBe(false);
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
