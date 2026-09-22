import { describe, test, expect } from "bun:test";
import { configGet, configSet } from "../../src/commands/config.js";
import { createMockClient } from "../helpers/mock-client.js";

const configData = {
  bggAuthToken: "***configured***",
  groundedAnalysis: { providerId: "local", modelId: "model", extensionIds: [] },
  profileAttentionCardLimit: 6,
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
      profileAttentionCardLimit: number;
    };
    expect(parsed.bggAuthToken).toBe("***configured***");
    expect(parsed.profileAttentionCardLimit).toBe(6);
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

  test.each([0, 1, 6, 24])("relays valid profile attention card limit %s", async (limit) => {
    let body: unknown;
    const limitClient = createMockClient({
      routes: {
        "PUT /api/config": {
          response: (requestBody) => {
            body = requestBody;
            return { ok: true, status: 200, data: configData };
          },
        },
      },
    });
    await configSet(limitClient, ["profile-attention-card-limit", String(limit)], { json: false });
    expect(body).toEqual({ profileAttentionCardLimit: limit });
  });

  test.each(["-1", "25", "1.5", "1e1", "01", "text", " 1 "])(
    "rejects invalid profile attention card limit %s before calling daemon",
    async (value) => {
      let called = false;
      const limitClient = createMockClient({
        routes: {
          "PUT /api/config": {
            response: () => {
              called = true;
              return { ok: true, status: 200, data: configData };
            },
          },
        },
      });
      let error: unknown;
      try {
        await configSet(limitClient, ["profile-attention-card-limit", value], { json: false });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("canonical whole number");
      expect(called).toBe(false);
    },
  );

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
