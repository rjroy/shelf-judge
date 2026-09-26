import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { AnalystTurnRequest } from "@shelf-judge/shared";
import { createAnalystAttestationService } from "../src/services/analyst-attestation-service.js";
import { createAnalystTranscriptValidator } from "../src/services/analyst-transcript-validator.js";
import { createMockFileOps } from "./helpers/mock-file-ops.js";
import { createTestApp } from "./helpers/test-app.js";

const provider = { providerId: "provider", modelId: "model" };
const capability = "a".repeat(64);

function request(messages: AnalystTurnRequest["messages"]): AnalystTurnRequest {
  return {
    conversationId: "conversation-a",
    conversationCapability: capability,
    requestId: "request",
    turnIndex: messages.filter((message) => message.role === "analyst").length,
    disclosure: { ...provider, manifestVersion: 4, disclosureVersion: 1, acknowledged: true },
    messages,
  };
}

function prior(attestations: ReturnType<typeof createAnalystAttestationService>) {
  const authenticated = {
    conversationId: "conversation-a",
    turnIndex: 0,
    ...provider,
    content: "Validated answer",
    outcome: "answered" as const,
    noteDependencies: [{ gameId: "game-a", noteVersion: 1 }],
  };
  return {
    role: "analyst" as const,
    content: authenticated.content,
    outcome: authenticated.outcome,
    noteDependencies: authenticated.noteDependencies,
    validationAttestation: attestations.attest(authenticated),
  };
}

describe("Analyst ephemeral transcript authentication", () => {
  test("signs complete inspection records with domain and turn binding", () => {
    const key = new Uint8Array(32).fill(9);
    const attestations = createAnalystAttestationService(key);
    const binding = {
      conversationId: "conversation-a",
      requestId: "request-a",
      turnIndex: 0,
      attestationDigest: "a".repeat(43),
    };
    const unsignedRecord = {
      version: 1 as const,
      ...binding,
      citation: {
        citationId: "search-citation",
        sourceId: "search-source",
        sourceVersion: "1",
        evidenceClass: "bgg-search-observation" as const,
        observedAt: "2026-09-25T00:00:00.000Z",
        canonicalSummary: "A bounded BGG title search",
        testimony: false,
        destination: {
          operationId: "shelf.analyst.discovery.get" as const,
          parameters: { citationId: "search-citation" },
        },
      },
      view: {
        kind: "discovery" as const,
        result: {
          status: "ok" as const,
          source: "title" as const,
          observedAt: "2026-09-25T00:00:00.000Z",
          returnedCount: 0,
          emittedCount: 0,
          truncated: false,
          observationCitationId: "search-citation",
          candidates: [],
        },
      },
    };
    const record = attestations.issueInspectionRecord(unsignedRecord);
    expect(record.authenticationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(attestations.verifyInspectionRecord(record, binding)).toEqual(record);
    expect(
      attestations.verifyInspectionRecord(
        {
          ...record,
          authenticationToken: `${record.authenticationToken.slice(0, -1)}${record.authenticationToken.endsWith("x") ? "y" : "x"}`,
        },
        binding,
      ),
    ).toBeNull();
    expect(
      attestations.verifyInspectionRecord(
        { ...record, citation: { ...record.citation, canonicalSummary: "altered" } },
        binding,
      ),
    ).toBeNull();
    expect(
      attestations.verifyInspectionRecord(record, { ...binding, conversationId: "conversation-b" }),
    ).toBeNull();
    expect(
      attestations.verifyInspectionRecord(record, { ...binding, requestId: "request-b" }),
    ).toBeNull();
    expect(attestations.verifyInspectionRecord(record, { ...binding, turnIndex: 1 })).toBeNull();
    expect(
      attestations.verifyInspectionRecord(record, {
        ...binding,
        attestationDigest: "b".repeat(43),
      }),
    ).toBeNull();
    expect(
      createAnalystAttestationService(new Uint8Array(32).fill(10)).verifyInspectionRecord(
        record,
        binding,
      ),
    ).toBeNull();
    expect(
      attestations.verifyInspectionRecord({ ...record, extra: "not allowed" }, binding),
    ).toBeNull();
    expect(
      attestations.verifyInspectionRecord(
        { ...record, authenticationToken: "x".repeat(2049) },
        binding,
      ),
    ).toBeNull();
    expect(() =>
      attestations.issueInspectionRecord({
        ...unsignedRecord,
        citation: { ...unsignedRecord.citation, canonicalSummary: "x".repeat(16_500) },
      }),
    ).toThrow("Citation inspection record exceeds byte limit");
  });

  test("rejects tampering, restart, provider changes, and malformed role order", async () => {
    const attestations = createAnalystAttestationService(new Uint8Array(32).fill(1));
    const validator = createAnalystTranscriptValidator({
      attestationService: attestations,
      provider,
    });
    const assistantMessage = prior(attestations);
    const messages: AnalystTurnRequest["messages"] = [
      { role: "owner", content: "First" },
      assistantMessage,
      { role: "owner", content: "Next" },
    ];
    expect(await validator.validate(request(messages))).toEqual({
      valid: false,
      outcome: "stale-transcript",
    });
    expect(await validator.validate({ ...request(messages), messages: [messages[1]] })).toEqual({
      valid: false,
      outcome: "invalid-transcript",
    });
    expect(
      await validator.validate(
        request([{ ...messages[0] }, { ...messages[1], content: "altered" }, messages[2]]),
      ),
    ).toEqual({ valid: false, outcome: "invalid-transcript" });
    expect(
      await createAnalystTranscriptValidator({
        attestationService: createAnalystAttestationService(new Uint8Array(32).fill(2)),
        provider,
      }).validate(request(messages)),
    ).toEqual({ valid: false, outcome: "invalid-transcript" });
    expect(
      await validator.validate({ ...request(messages), conversationId: "conversation-b" }),
    ).toEqual({ valid: false, outcome: "invalid-transcript" });
    expect(
      await validator.validate({
        ...request(messages),
        conversationCapability: assistantMessage.validationAttestation,
      }),
    ).toEqual({ valid: false, outcome: "invalid-transcript" });
    expect(
      await createAnalystTranscriptValidator({
        attestationService: attestations,
        provider: { providerId: "provider", modelId: "changed-model" },
      }).validate(request(messages)),
    ).toEqual({ valid: false, outcome: "invalid-transcript" });
  });

  test("uses the injected note seam after authentication", async () => {
    const attestations = createAnalystAttestationService(new Uint8Array(32).fill(1));
    const validator = createAnalystTranscriptValidator({
      attestationService: attestations,
      provider,
      compareNoteDependencies: () => "stale",
    });
    const messages: AnalystTurnRequest["messages"] = [
      { role: "owner", content: "First" },
      prior(attestations),
      { role: "owner", content: "Next" },
    ];
    expect(await validator.validate(request(messages))).toEqual({
      valid: false,
      outcome: "stale-transcript",
    });
  });

  test("authenticates every message then checks one deduplicated dependency set", async () => {
    const attestations = createAnalystAttestationService(new Uint8Array(32).fill(1));
    const second = {
      ...prior(attestations),
      content: "Another validated answer",
      noteDependencies: [{ gameId: "game-b", noteVersion: 2 }],
    };
    second.validationAttestation = attestations.attest({
      conversationId: "conversation-a",
      turnIndex: 1,
      ...provider,
      content: second.content,
      outcome: second.outcome,
      noteDependencies: second.noteDependencies,
    });
    const compared: unknown[] = [];
    const validator = createAnalystTranscriptValidator({
      attestationService: attestations,
      provider,
      compareNoteDependencies: (dependencies) => {
        compared.push(dependencies);
        return "current";
      },
    });
    expect(
      await validator.validate(
        request([
          { role: "owner", content: "First" },
          prior(attestations),
          { role: "owner", content: "Second" },
          second,
          { role: "owner", content: "Third" },
        ]),
      ),
    ).toEqual({ valid: true, discoveryIds: [] });
    expect(compared).toEqual([
      [
        { gameId: "game-a", noteVersion: 1 },
        { gameId: "game-b", noteVersion: 2 },
      ],
    ]);
  });

  test("accepts only receipts bound to an earlier attested emitted ID", async () => {
    const attestations = createAnalystAttestationService(new Uint8Array(32).fill(7));
    const ids = [{ bggId: 123, source: "search" as const }];
    const discoveryDigest = attestations.discoveryDigest(ids);
    const validationAttestation = attestations.attest({
      conversationId: "conversation-a",
      turnIndex: 0,
      ...provider,
      content: "Found candidate",
      outcome: "answered",
      noteDependencies: [],
      discoveryDigest,
    });
    const assistant = {
      role: "analyst" as const,
      content: "Found candidate",
      outcome: "answered" as const,
      noteDependencies: [],
      discoveryIds: ids,
      discoveryDigest,
      validationAttestation,
    };
    const receipt = attestations.issueDiscoveryReceipt({
      conversationId: "conversation-a",
      turnIndex: 0,
      attestationDigest: createHash("sha256").update(validationAttestation).digest("base64url"),
      bggId: 123,
      source: "search",
    });
    const validator = createAnalystTranscriptValidator({
      attestationService: attestations,
      provider,
    });
    const valid = request([
      { role: "owner", content: "Find something" },
      assistant,
      { role: "owner", content: "Tell me more" },
    ]);
    valid.discoveryReceipts = [receipt];
    expect(await validator.validate(valid)).toEqual({ valid: true, discoveryIds: ids });
    expect(await validator.validate({ ...valid, conversationId: "other" })).toEqual({
      valid: false,
      outcome: "invalid-transcript",
    });
    expect(
      await validator.validate({ ...valid, discoveryReceipts: [receipt.slice(0, -2) + "aa"] }),
    ).toEqual({ valid: false, outcome: "invalid-transcript" });
    const wrongSource = attestations.issueDiscoveryReceipt({
      conversationId: "conversation-a",
      turnIndex: 0,
      attestationDigest: attestations.attestationDigest(validationAttestation),
      bggId: 123,
      source: "hot",
    });
    expect(await validator.validate({ ...valid, discoveryReceipts: [wrongSource] })).toEqual({
      valid: false,
      outcome: "invalid-transcript",
    });
    expect(await validator.validate({ ...valid, discoveryReceipts: [receipt, receipt] })).toEqual({
      valid: false,
      outcome: "invalid-transcript",
    });
    const forged = {
      ...valid,
      messages: [
        valid.messages[0],
        { ...assistant, discoveryIds: [{ bggId: 456, source: "search" }] },
        valid.messages[2],
      ],
    };
    expect(await validator.validate(forged)).toEqual({
      valid: false,
      outcome: "invalid-transcript",
    });
  });

  test("deduplicates verified receipts by BGG ID across independently attested sources", async () => {
    const attestations = createAnalystAttestationService(new Uint8Array(32).fill(8));
    const makeAssistant = (turnIndex: number, source: "search" | "hot") => {
      const ids = [{ bggId: 123, source }];
      const discoveryDigest = attestations.discoveryDigest(ids);
      const validationAttestation = attestations.attest({
        conversationId: "conversation-a",
        turnIndex,
        ...provider,
        content: `Found via ${source}`,
        outcome: "answered",
        noteDependencies: [],
        discoveryDigest,
      });
      const assistant = {
        role: "analyst" as const,
        content: `Found via ${source}`,
        outcome: "answered" as const,
        noteDependencies: [],
        discoveryIds: ids,
        discoveryDigest,
        validationAttestation,
      };
      const receipt = attestations.issueDiscoveryReceipt({
        conversationId: "conversation-a",
        turnIndex,
        attestationDigest: attestations.attestationDigest(validationAttestation),
        bggId: 123,
        source,
      });
      return { assistant, receipt };
    };
    const first = makeAssistant(0, "search");
    const second = makeAssistant(1, "hot");
    const validator = createAnalystTranscriptValidator({
      attestationService: attestations,
      provider,
    });
    const valid = request([
      { role: "owner", content: "Find a game" },
      first.assistant,
      { role: "owner", content: "Search another source" },
      second.assistant,
      { role: "owner", content: "Continue" },
    ]);
    valid.discoveryReceipts = [first.receipt, second.receipt];

    expect(await validator.validate(valid)).toEqual({
      valid: true,
      discoveryIds: [{ bggId: 123, source: "search" }],
    });
    expect(
      await validator.validate({
        ...valid,
        discoveryReceipts: [
          first.receipt,
          attestations.issueDiscoveryReceipt({
            conversationId: "conversation-a",
            turnIndex: 1,
            attestationDigest: attestations.attestationDigest(
              second.assistant.validationAttestation,
            ),
            bggId: 123,
            source: "search",
          }),
        ],
      }),
    ).toEqual({ valid: false, outcome: "invalid-transcript" });
  });

  test("rejects a real owner-note update as a stale transcript", async () => {
    const app = createTestApp({ fileOps: createMockFileOps() });
    const { game } = await app.gameService.addGame({ name: "Transcript game" });
    await app.ownerGameNoteService.set(game.id, {
      commandId: "66000000-0000-4000-8000-000000000001",
      expectedVersion: 0,
      text: "first",
    });
    const attestations = createAnalystAttestationService(new Uint8Array(32).fill(1));
    const message = prior(attestations);
    message.noteDependencies = [{ gameId: game.id, noteVersion: 1 }];
    message.validationAttestation = attestations.attest({
      conversationId: "conversation-a",
      turnIndex: 0,
      ...provider,
      content: message.content,
      outcome: message.outcome,
      noteDependencies: message.noteDependencies,
    });
    const validator = createAnalystTranscriptValidator({
      attestationService: attestations,
      provider,
      compareNoteDependencies: (dependencies) =>
        app.ownerGameNoteService
          .get(dependencies[0]?.gameId ?? "")
          .then((current) =>
            current.note.version === dependencies[0]?.noteVersion ? "current" : "stale",
          ),
    });
    await app.ownerGameNoteService.clear(game.id, {
      commandId: "66000000-0000-4000-8000-000000000002",
      expectedVersion: 1,
    });
    expect(
      await validator.validate(
        request([{ role: "owner", content: "First" }, message, { role: "owner", content: "Next" }]),
      ),
    ).toEqual({ valid: false, outcome: "stale-transcript" });
  });
});
