import { describe, expect, test } from "bun:test";
import { nicheIgnore, nicheIgnored, nicheUnignore } from "../../src/commands/niche.js";
import { createMockClient } from "../helpers/mock-client.js";

describe("niche command errors", () => {
  const cases = [
    {
      name: "ignored",
      route: "GET /api/niches/settings",
      run: nicheIgnored,
      args: [],
      fallback: "Failed to load niche settings",
    },
    {
      name: "ignore",
      route: "POST /api/niches/settings/ignore",
      run: nicheIgnore,
      args: ["mechanic", "Drafting"],
      fallback: "Failed to ignore tag",
    },
    {
      name: "unignore",
      route: "DELETE /api/niches/settings/ignore",
      run: nicheUnignore,
      args: ["mechanic", "Drafting"],
      fallback: "Failed to unignore tag",
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
