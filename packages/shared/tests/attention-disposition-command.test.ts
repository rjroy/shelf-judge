import { describe, expect, test } from "bun:test";
import { AttentionDispositionCommandSchema, AttentionDispositionSchema } from "../src/index";

const command = {
  operation: "not-now",
  commandId: "a0000000-0000-4000-8000-000000000001",
  gameId: "b0000000-0000-4000-8000-000000000001",
  ruleId: "underused-purchase",
  ruleVersion: 1,
  fingerprint: "a".repeat(64),
  expectedVersion: 0,
} as const;

describe("attention disposition command schema", () => {
  test("shares durable rule-ID grammar exactly", () => {
    for (const ruleId of ["rule", "rule-1", "rule-x2-y3"] as const) {
      expect(AttentionDispositionCommandSchema.safeParse({ ...command, ruleId }).success).toBe(
        true,
      );
      expect(
        AttentionDispositionSchema.safeParse({
          gameId: "game-1",
          kind: "intentional",
          ruleId,
          ruleVersion: 1,
          fingerprint: "a".repeat(64),
          version: 1,
        }).success,
      ).toBe(true);
    }
    for (const ruleId of ["1-rule", "rule-", "rule--x", "Rule"] as const) {
      expect(AttentionDispositionCommandSchema.safeParse({ ...command, ruleId }).success).toBe(
        false,
      );
      expect(
        AttentionDispositionSchema.safeParse({
          gameId: "game-1",
          kind: "intentional",
          ruleId,
          ruleVersion: 1,
          fingerprint: "a".repeat(64),
          version: 1,
        }).success,
      ).toBe(false);
    }
  });

  test("canonicalizes UUIDs while rejecting invalid UUIDs and unknown keys", () => {
    expect(
      AttentionDispositionCommandSchema.parse({
        ...command,
        commandId: command.commandId.toUpperCase(),
        gameId: command.gameId.toUpperCase(),
      }),
    ).toMatchObject(command);
    expect(
      AttentionDispositionCommandSchema.safeParse({ ...command, gameId: "game-1" }).success,
    ).toBe(false);
    expect(AttentionDispositionCommandSchema.safeParse({ ...command, extra: true }).success).toBe(
      false,
    );
  });
});
