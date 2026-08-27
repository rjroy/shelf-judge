import { describe, expect, test } from "bun:test";
import { collectionBenchmark } from "../../src/commands/collection.js";
import { createMockClient } from "../helpers/mock-client.js";

async function errorMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected command to fail");
}

describe("collection benchmark", () => {
  const actions: Array<[string, string, string | undefined]> = [
    ["get", "GET", undefined],
    ["set", "PUT", "0008.50"],
    ["clear", "DELETE", undefined],
  ];
  test.each(actions)(
    "dispatches %s with the exact API contract",
    async (action, method, amount) => {
      const path = "/api/collection/entertainment-benchmark";
      const configured = {
        entertainmentBenchmark: {
          state: "configured",
          amount: { hundredths: 850, source: "manual", confirmedAt: "2026-08-26T12:00:00Z" },
        },
        exact: { numerator: "17", denominator: "2" },
      };
      const response = action === "clear" ? { entertainmentBenchmark: null } : configured;
      const client = createMockClient({
        routes: {
          [`${method} ${path}`]: { response: { ok: true, status: 200, data: response } },
        },
      });
      const originalPut = client.put.bind(client);
      let body: unknown;
      client.put = <T>(requestPath: string, nextBody?: unknown) => {
        body = nextBody;
        return originalPut<T>(requestPath, nextBody);
      };
      const args = amount === undefined ? [action] : [action, amount];
      const human = await collectionBenchmark(client, args, { json: false });
      if (action === "set") expect(body).toEqual({ amount: "0008.50" });
      if (action === "clear") expect(human).toContain("cleared to unknown");
      else expect(human).toContain("$8.50 per person-hour at fitness 6");
      expect(JSON.parse(await collectionBenchmark(client, args, { json: true }))).toEqual(response);
    },
  );

  test.each([
    [{ entertainmentBenchmark: null }, "unknown"],
    [
      {
        entertainmentBenchmark: {
          state: "invalid",
          evidence: { presence: "present", value: { amount: "private-bad" } },
        },
      },
      "invalid",
    ],
  ])("distinguishes unknown and invalid benchmark", async (response, expected) => {
    const client = createMockClient({
      routes: {
        "GET /api/collection/entertainment-benchmark": {
          response: { ok: true, status: 200, data: response },
        },
      },
    });
    expect(await collectionBenchmark(client, ["get"], { json: false })).toContain(expected);
  });

  const invalidArgumentCases: Array<[string[]]> = [
    [[]],
    [["other"]],
    [["get", "1"]],
    [["set"]],
    [["set", "1", "extra"]],
    [["clear", "1"]],
  ];
  test.each(invalidArgumentCases)("rejects missing, extra, or unknown action %#", async (args) => {
    expect(
      await errorMessage(() => collectionBenchmark(createMockClient(), args, { json: false })),
    ).toContain("Usage");
  });

  test.each(["0", "1.234", "bad"])(
    "passes invalid amount %s unchanged to daemon validation",
    async (amount) => {
      const client = createMockClient({
        routes: {
          "PUT /api/collection/entertainment-benchmark": {
            response: { ok: false, status: 400, data: { error: `Invalid benchmark ${amount}` } },
          },
        },
      });
      const originalPut = client.put.bind(client);
      let body: unknown;
      client.put = <T>(path: string, nextBody?: unknown) => {
        body = nextBody;
        return originalPut<T>(path, nextBody);
      };
      expect(
        await errorMessage(() => collectionBenchmark(client, ["set", amount], { json: false })),
      ).toContain(`Invalid benchmark ${amount}`);
      expect(body).toEqual({ amount });
    },
  );

  test("surfaces generic daemon errors", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/collection/entertainment-benchmark": {
          response: { ok: false, status: 500, data: { error: "Internal server error" } },
        },
      },
    });
    expect(await errorMessage(() => collectionBenchmark(client, ["get"], { json: false }))).toBe(
      "Internal server error",
    );
  });
});
