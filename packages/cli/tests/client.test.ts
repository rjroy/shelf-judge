import { describe, expect, test } from "bun:test";
import {
  DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  type CollectionProfile,
} from "@shelf-judge/shared";
import { usefulProfileFixture } from "../../shared/tests/fixtures/useful-profile.js";
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

function clientReturning(response: unknown) {
  const fetchRequest = (): ReturnType<typeof fetch> => Promise.resolve(Response.json(response));
  const fetchFn: typeof fetch = Object.assign(fetchRequest, { preconnect: fetch.preconnect });
  return createDaemonClient({ socketPath: "/tmp/shelf-judge-test.sock", fetchFn });
}

const malformedProfileCases: ReadonlyArray<
  readonly [string, (profile: CollectionProfile) => void]
> = [
  [
    "legacy rating ordering",
    (profile) => {
      const orderings = profile.identity.classes.mechanic.orderings;
      Reflect.set(orderings, "rating", orderings.bestFit);
      Reflect.deleteProperty(orderings, "bestFit");
    },
  ],
  [
    "missing adjusted value",
    (profile) => {
      Reflect.deleteProperty(
        profile.identity.classes.mechanic.entities[0],
        "adjustedMeanCurrentFitness",
      );
    },
  ],
  [
    "forged adjusted value",
    (profile) => {
      profile.identity.classes.mechanic.entities[0].adjustedMeanCurrentFitness += 1;
    },
  ],
  [
    "wrong best-fit order",
    (profile) => {
      profile.identity.classes.mechanic.orderings.bestFit.reverse();
    },
  ],
  [
    "unsupported overview entity",
    (profile) => {
      profile.identity.classes.mechanic.overviewEntityIds = [102];
    },
  ],
];

describe("daemon profile client", () => {
  test("returns the complete useful profile response without projection", async () => {
    const response = structuredClone(usefulProfileFixture);
    expect(await clientReturning(response).getProfile()).toEqual(response);
  });

  test("returns the complete unavailable result without projection", async () => {
    const response = {
      status: "unavailable" as const,
      error: { kind: "recomputation" as const, message: "Profile source changed" },
      retryDestination: { operationId: "shelf.profile.get" as const },
    };
    expect(await clientReturning(response).getProfile()).toEqual(response);
  });

  test("validates profiles with the daemon's configured entity policy", async () => {
    const response = structuredClone(usefulProfileFixture);
    response.identity.classes.mechanic.result = "limited";
    response.identity.classes.mechanic.entities[0].support = "limited";
    response.identity.classes.mechanic.entities[1].adjustedMeanCurrentFitness = 16 / 3;
    response.identity.classes.mechanic.overviewEntityIds = [];
    const policy = {
      ...DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
      mechanic: { overviewLimit: 3, minimumSupportedGames: 4 },
    };
    response.entityPolicy = policy;

    expect(await clientReturning(response).getProfile()).toEqual(response);
  });

  test.each([
    ["projected shape", { status: "available", identity: usefulProfileFixture.identity }],
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
              associatedGameCount: 99,
            },
          },
        },
      },
    ],
  ])("rejects a malformed %s", async (_label, response) => {
    expect(await rejectionMessage(() => clientReturning(response).getProfile())).toContain(
      "Invalid profile response",
    );
  });

  test.each(malformedProfileCases)("rejects a profile with %s", async (_label, mutate) => {
    const response = structuredClone(usefulProfileFixture);
    mutate(response);

    expect(await rejectionMessage(() => clientReturning(response).getProfile())).toContain(
      "Invalid profile response",
    );
  });
});
