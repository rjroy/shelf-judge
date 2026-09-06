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
    disclosure: { ...provider, acknowledged: true },
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
    ).toEqual({ valid: true });
    expect(compared).toEqual([
      [
        { gameId: "game-a", noteVersion: 1 },
        { gameId: "game-b", noteVersion: 2 },
      ],
    ]);
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
