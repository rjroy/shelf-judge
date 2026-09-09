import { describe, test, expect } from "bun:test";
import { configGet, configSet } from "../../src/commands/config.js";
import { createMockClient } from "../helpers/mock-client.js";

const configData = {
  bggAuthToken: "***configured***",
  groundedAnalysis: { providerId: "local", modelId: "model", extensionIds: [] },
};

describe("config get", () => {
  const client = createMockClient({
    routes: {
      "GET /api/config": {
        response: { ok: true, status: 200, data: configData },
      },
    },
  });

  test("human-readable output has Key/Value table columns", async () => {
    const output = await configGet(client, [], { json: false });
    expect(output).toContain("Key");
    expect(output).toContain("Value");
    expect(output).toContain("bgg-token");
    expect(output).toContain("***configured***");
    expect(output).toContain("grounded-analysis.provider");
    expect(output).toContain("local");
  });

  test("--json outputs parseable config object", async () => {
    const output = await configGet(client, [], { json: true });
    const parsed = JSON.parse(output) as {
      bggAuthToken: string;
    };
    expect(parsed.bggAuthToken).toBe("***configured***");
  });
});

describe("config set", () => {
  const client = createMockClient({
    routes: {
      "PUT /api/config": {
        response: { ok: true, status: 200, data: configData },
      },
    },
  });

  test("human-readable output shows Updated bgg-token", async () => {
    const output = await configSet(client, ["bgg-token", "my-secret-token"], { json: false });
    expect(output).toContain("Updated bgg-token");
  });

  test("--json outputs parseable updated config object", async () => {
    const output = await configSet(client, ["bgg-token", "my-secret-token"], { json: true });
    const parsed = JSON.parse(output) as {
      bggAuthToken: string;
    };
    expect(parsed.bggAuthToken).toBe("***configured***");
  });

  test("sets and clears the complete grounded analysis identity atomically", async () => {
    const identity = '{"providerId":"local","modelId":"model","extensionIds":[]}';
    expect(await configSet(client, ["grounded-analysis", identity], { json: false })).toContain(
      "restart the daemon",
    );
    expect(await configSet(client, ["grounded-analysis", "null"], { json: false })).toContain(
      "Updated grounded-analysis",
    );
  });

  test("rejects invalid grounded analysis JSON before calling the daemon", async () => {
    let error: unknown;
    try {
      await configSet(client, ["grounded-analysis", "not-json"], { json: false });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Invalid grounded-analysis JSON");
  });
});
