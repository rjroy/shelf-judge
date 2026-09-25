import { describe, expect, test } from "bun:test";
import {
  redundancyDisable,
  redundancyEnable,
  redundancySet,
  redundancySettings,
  redundancyStage,
} from "../../src/commands/redundancy.js";
import { createMockClient } from "../helpers/mock-client.js";

describe("redundancy command errors", () => {
  const cases = [
    {
      name: "settings",
      route: "GET /api/redundancy/settings",
      run: redundancySettings,
      args: [],
      fallback: "Failed to load redundancy settings",
    },
    {
      name: "enable",
      route: "PATCH /api/redundancy/settings",
      run: redundancyEnable,
      args: [],
      fallback: "Failed to enable redundancy",
    },
    {
      name: "disable",
      route: "PATCH /api/redundancy/settings",
      run: redundancyDisable,
      args: [],
      fallback: "Failed to disable redundancy",
    },
    {
      name: "stage",
      route: "PATCH /api/redundancy/settings",
      run: redundancyStage,
      args: ["integrated"],
      fallback: "Failed to set redundancy stage",
    },
    {
      name: "set",
      route: "PATCH /api/redundancy/settings",
      run: redundancySet,
      args: ["enabled", "true"],
      fallback: "Failed to set enabled",
    },
  ];

  for (const { name, route, run, args, fallback } of cases) {
    test(`${name} retains server-provided errors`, () => {
      const client = createMockClient({
        routes: {
          [route]: { response: { ok: false, status: 400, data: { error: "Server error" } } },
        },
      });
      expect(run(client, args, { json: false })).rejects.toThrow("Server error");
    });

    test(`${name} retains its fallback error`, () => {
      const client = createMockClient({
        routes: { [route]: { response: { ok: false, status: 500, data: {} } } },
      });
      expect(run(client, args, { json: false })).rejects.toThrow(fallback);
    });
  }
});
