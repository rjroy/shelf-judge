import { describe, expect, test } from "bun:test";
import type { AnalystTurnRequest } from "@shelf-judge/shared";
import { createAnalystAttestationService } from "../src/services/analyst-attestation-service.js";
import { createAnalystTranscriptValidator } from "../src/services/analyst-transcript-validator.js";

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
    expect(await validator.validate(request(messages))).toEqual({ valid: true });
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
});
