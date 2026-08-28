import { describe, expect, test } from "bun:test";
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
});
