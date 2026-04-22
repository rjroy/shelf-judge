import { describe, test, expect } from "bun:test";
import { configGet, configSet } from "../../src/commands/config.js";
import { createMockClient } from "../helpers/mock-client.js";

const configData = {
  bggAuthToken: "***configured***",
  dataDir: "/home/user/.shelf-judge/data",
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
    expect(output).toContain("data-dir");
    expect(output).toContain("/home/user/.shelf-judge/data");
  });

  test("--json outputs parseable config object", async () => {
    const output = await configGet(client, [], { json: true });
    const parsed = JSON.parse(output) as {
      bggAuthToken: string;
      dataDir: string;
    };
    expect(parsed.bggAuthToken).toBe("***configured***");
    expect(parsed.dataDir).toBe("/home/user/.shelf-judge/data");
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
      dataDir: string;
    };
    expect(parsed.bggAuthToken).toBe("***configured***");
    expect(parsed.dataDir).toBe("/home/user/.shelf-judge/data");
  });
});
