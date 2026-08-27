import { describe, expect, test } from "bun:test";
import type { CollectionProfile } from "@shelf-judge/shared";
import { CollectionProfileSchema } from "@shelf-judge/shared";
import { trustedInsightProfileFixture } from "../../shared/tests/fixtures/trusted-profile.js";
import { createDaemonClient } from "../src/client.js";

async function rejectionMessage(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error("Expected action to reject");
}

describe("daemon profile client", () => {
  test("returns the complete trusted insight response without projection", async () => {
    const fetchRequest = (): ReturnType<typeof fetch> =>
      Promise.resolve(Response.json(structuredClone(trustedInsightProfileFixture)));
    const fetchFn: typeof fetch = Object.assign(fetchRequest, { preconnect: fetch.preconnect });
    const client = createDaemonClient({ socketPath: "/tmp/shelf-judge-test.sock", fetchFn });

    const profile = await client.getProfile();

    const validated: CollectionProfile = CollectionProfileSchema.parse(profile);
    expect(validated).toEqual(trustedInsightProfileFixture);
    expect(profile).toEqual(trustedInsightProfileFixture);
  });

  test.each([
    ["malformed shape", { ...trustedInsightProfileFixture, suggestions: undefined }],
    [
      "unsupported insight contract version",
      {
        ...trustedInsightProfileFixture,
        divergence: trustedInsightProfileFixture.divergence?.map((insight, index) =>
          index === 0 ? { ...insight, contractVersion: 2 } : insight,
        ),
      },
    ],
  ])("rejects a %s from getProfile", async (_label, response) => {
    const fetchRequest = (): ReturnType<typeof fetch> => Promise.resolve(Response.json(response));
    const fetchFn: typeof fetch = Object.assign(fetchRequest, { preconnect: fetch.preconnect });
    const client = createDaemonClient({ socketPath: "/tmp/shelf-judge-test.sock", fetchFn });

    expect(await rejectionMessage(() => client.getProfile())).toContain("Invalid profile response");
  });

  test("rejects a malformed successful narration profile", async () => {
    const fetchRequest = (): ReturnType<typeof fetch> =>
      Promise.resolve(Response.json({ ...trustedInsightProfileFixture, outliers: "invalid" }));
    const fetchFn: typeof fetch = Object.assign(fetchRequest, { preconnect: fetch.preconnect });
    const client = createDaemonClient({ socketPath: "/tmp/shelf-judge-test.sock", fetchFn });

    expect(await rejectionMessage(() => client.generateNarration())).toContain(
      "Invalid profile response",
    );
  });
});
