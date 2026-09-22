import { describe, expect, test } from "bun:test";
import {
  attentionDispositionRequestFingerprint,
  type AttentionDispositionCommand,
  type CollectionProfileResult,
} from "@shelf-judge/shared";
import {
  canonicalUsefulProfileFixtures,
  usefulProfileFixture,
} from "../../../shared/tests/fixtures/useful-profile.js";
import { profileAttentionCommand, profileCommand } from "../../src/commands/profile.js";
import { createMockClient } from "../helpers/mock-client.js";

function clientFor(profile: CollectionProfileResult) {
  return createMockClient({
    routes: {
      "GET /api/profile": { response: { ok: true, status: 200, data: profile } },
    },
  });
}

describe("profile", () => {
  test.each(canonicalUsefulProfileFixtures)(
    "JSON deep-equals the complete canonical %s result",
    async (_label, profile) => {
      const output = await profileCommand(clientFor(profile), [], { json: false });
      expect(JSON.parse(output)).toEqual(profile);
    },
  );

  test("rejects extra arguments", () => {
    expect(
      profileCommand(clientFor(usefulProfileFixture), ["extra"], { json: true }),
    ).rejects.toThrow("Usage: shelf-judge profile");
  });
});

describe("profile attention actions", () => {
  const command: Omit<AttentionDispositionCommand, "commandId"> = {
    operation: "intentional",
    gameId: "00000000-0000-4000-8000-000000000001",
    ruleId: "never-played",
    ruleVersion: 1,
    fingerprint: "a".repeat(64),
    expectedVersion: 0,
  };
  const commandId = "00000000-0000-4000-8000-000000000002";
  const accepted = {
    receiptType: "attention-disposition" as const,
    commandId,
    operation: "intentional" as const,
    gameId: command.gameId,
    ruleId: command.ruleId,
    ruleVersion: command.ruleVersion,
    expectedVersion: command.expectedVersion,
    requestFingerprint: attentionDispositionRequestFingerprint({ ...command, commandId }),
    requestPayload: { ...command, commandId },
    accepted: {
      gameId: command.gameId,
      kind: "intentional" as const,
      ruleId: command.ruleId,
      ruleVersion: command.ruleVersion,
      fingerprint: command.fingerprint,
      version: 1,
    },
  };

  test("relays the supplied template fields and only adds the command UUID", async () => {
    let sent: unknown;
    const client = createMockClient({
      routes: {
        "POST /api/profile/attention/intentional": {
          response: (body) => {
            sent = body;
            return { ok: true, status: 200, data: { outcome: "accepted", receipt: accepted } };
          },
        },
      },
    });
    const output = await profileAttentionCommand(
      client,
      "intentional",
      [JSON.stringify(command), "--command-id", commandId],
      { json: true },
    );
    expect(sent).toEqual({ ...command, commandId });
    expect(JSON.parse(output)).toEqual({ outcome: "accepted", receipt: accepted });
  });

  test("generates a UUID when no override is supplied", async () => {
    let sent: unknown;
    const client = createMockClient({
      routes: {
        "POST /api/profile/attention/intentional": {
          response: (body) => {
            sent = body;
            return { ok: true, status: 200, data: { outcome: "replayed", receipt: accepted } };
          },
        },
      },
    });
    await profileAttentionCommand(
      client,
      "intentional",
      [JSON.stringify(command)],
      { json: true },
      { createCommandId: () => commandId, writeStderr: () => undefined },
    );
    expect(sent).toEqual({ ...command, commandId });
  });

  test("turns daemon rejected results into structured errors", async () => {
    const client = createMockClient({
      routes: {
        "POST /api/profile/attention/intentional": {
          response: {
            ok: false,
            status: 409,
            data: {
              outcome: "rejected",
              error: { code: "candidate-mismatch", gameId: command.gameId },
            },
          },
        },
      },
    });
    let error: unknown;
    try {
      await profileAttentionCommand(
        client,
        "intentional",
        [JSON.stringify(command), "--command-id", commandId],
        { json: true },
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ details: { outcome: "rejected" } });
  });
});
