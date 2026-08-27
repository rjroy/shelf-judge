import { describe, expect, test } from "bun:test";
import { generateNarration, getProfile } from "@/lib/api";
import { trustedInsightProfileFixture } from "../../shared/tests/fixtures/trusted-profile";

async function rejectionMessage(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error("Expected action to reject");
}

describe("web profile API boundary", () => {
  test("parses a complete trusted profile response", async () => {
    const profile = await getProfile(() =>
      Promise.resolve(structuredClone(trustedInsightProfileFixture)),
    );

    expect(profile).toEqual(trustedInsightProfileFixture);
  });

  test.each([
    ["malformed shape", { ...trustedInsightProfileFixture, outliers: "invalid" }],
    [
      "unsupported insight contract version",
      {
        ...trustedInsightProfileFixture,
        suggestions: trustedInsightProfileFixture.suggestions.map((insight, index) =>
          index === 0 ? { ...insight, contractVersion: 2 } : insight,
        ),
      },
    ],
  ])("rejects a %s", async (_label, response) => {
    expect(await rejectionMessage(() => getProfile(() => Promise.resolve(response)))).toContain(
      "Invalid profile response",
    );
  });

  test("validates generated narration responses through the same boundary", async () => {
    expect(
      await rejectionMessage(() =>
        generateNarration(() =>
          Promise.resolve({ ...trustedInsightProfileFixture, computedAt: "not-a-timestamp" }),
        ),
      ),
    ).toContain("Invalid profile response");
  });
});
