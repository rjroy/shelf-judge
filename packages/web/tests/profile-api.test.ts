import { describe, expect, test } from "bun:test";
import { DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY } from "@shelf-judge/shared";
import { getProfile } from "@/lib/api";
import {
  canonicalUsefulProfileFixtures,
  usefulProfileFixture,
} from "../../shared/tests/fixtures/useful-profile";

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
  test.each(canonicalUsefulProfileFixtures)(
    "runtime-validates and preserves canonical %s",
    async (_label, fixture) => {
      const response = structuredClone(fixture);
      expect(await getProfile(() => Promise.resolve(response))).toEqual(fixture);
    },
  );

  test("preserves a validated daemon unavailable response", async () => {
    const response = {
      status: "unavailable" as const,
      error: { kind: "recomputation" as const, message: "Profile source changed" },
      retryDestination: { operationId: "shelf.profile.get" as const },
    };

    expect(await getProfile(() => Promise.resolve(response))).toEqual(response);
  });

  test("validates profiles with the daemon's configured entity policy", async () => {
    const response = structuredClone(usefulProfileFixture);
    response.identity.classes.mechanic.result = "limited";
    response.identity.classes.mechanic.entities[0].support = "limited";
    response.identity.classes.mechanic.overviewEntityIds = [];
    const policy = {
      ...DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
      mechanic: { overviewLimit: 3, minimumSupportedGames: 4 },
    };
    response.entityPolicy = policy;

    expect(await getProfile(() => Promise.resolve(response))).toEqual(response);
  });

  test.each([
    ["projected response", { status: "available", identity: usefulProfileFixture.identity }],
    [
      "altered aggregate",
      {
        ...structuredClone(usefulProfileFixture),
        identity: {
          ...structuredClone(usefulProfileFixture.identity),
          classes: {
            ...structuredClone(usefulProfileFixture.identity.classes),
            mechanic: {
              ...structuredClone(usefulProfileFixture.identity.classes.mechanic),
              entities: usefulProfileFixture.identity.classes.mechanic.entities.map(
                (entity, index) => (index === 0 ? { ...entity, meanCurrentFitness: 99 } : entity),
              ),
            },
          },
        },
      },
    ],
    [
      "altered ordering",
      {
        ...structuredClone(usefulProfileFixture),
        identity: {
          ...structuredClone(usefulProfileFixture.identity),
          classes: {
            ...structuredClone(usefulProfileFixture.identity.classes),
            mechanic: {
              ...structuredClone(usefulProfileFixture.identity.classes.mechanic),
              orderings: {
                ...usefulProfileFixture.identity.classes.mechanic.orderings,
                rating: [101, 102],
              },
            },
          },
        },
      },
    ],
  ])("rejects a %s rather than projecting or recomputing it", async (_label, response) => {
    expect(await rejectionMessage(() => getProfile(() => Promise.resolve(response)))).toContain(
      "Invalid profile response",
    );
  });
});
