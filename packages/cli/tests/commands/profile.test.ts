import { describe, expect, test } from "bun:test";
import type { FutureUsefulProfileResult } from "@shelf-judge/shared";
import {
  canonicalUsefulProfileFixtures,
  usefulProfileFixture,
} from "../../../shared/tests/fixtures/useful-profile.js";
import { profileCommand } from "../../src/commands/profile.js";
import { createMockClient } from "../helpers/mock-client.js";

function clientFor(profile: FutureUsefulProfileResult) {
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
