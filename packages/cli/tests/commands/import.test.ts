import { describe, test, expect } from "bun:test";
import { importBggCollection } from "../../src/commands/import.js";
import { createMockClient } from "../helpers/mock-client.js";

describe("import bgg-collection", () => {
  const client = createMockClient({
    sseRoutes: {
      "/api/import/bgg": {
        events: [
          { event: "progress", data: JSON.stringify({ imported: 1, total: 3, current: "Wingspan" }) },
          { event: "progress", data: JSON.stringify({ imported: 2, total: 3, current: "Gloomhaven" }) },
          { event: "complete", data: JSON.stringify({ imported: 2, skipped: 1, errors: [] }) },
        ],
      },
    },
  });

  test("human-readable output shows import summary", async () => {
    const output = await importBggCollection(client, ["testuser"], { json: false });
    expect(output).toContain("Import complete: 2 imported, 1 skipped");
  });

  test("--json outputs parseable result with imported/skipped/errors", async () => {
    const output = await importBggCollection(client, ["testuser"], { json: true });
    const parsed = JSON.parse(output);
    expect(parsed.imported).toBe(2);
    expect(parsed.skipped).toBe(1);
    expect(Array.isArray(parsed.errors)).toBe(true);
    expect(parsed.errors.length).toBe(0);
  });
});

describe("import bgg-collection with errors", () => {
  const client = createMockClient({
    sseRoutes: {
      "/api/import/bgg": {
        events: [
          { event: "progress", data: JSON.stringify({ imported: 1, total: 3, current: "Wingspan" }) },
          { event: "progress", data: JSON.stringify({ imported: 2, total: 3, current: "Gloomhaven" }) },
          {
            event: "complete",
            data: JSON.stringify({ imported: 2, skipped: 0, errors: ["Failed to fetch: Pandemic"] }),
          },
        ],
      },
    },
  });

  test("human-readable output lists errors", async () => {
    const output = await importBggCollection(client, ["testuser"], { json: false });
    expect(output).toContain("Import complete: 2 imported, 0 skipped");
    expect(output).toContain("Errors (1):");
    expect(output).toContain("Failed to fetch: Pandemic");
  });

  test("--json outputs parseable result with errors array populated", async () => {
    const output = await importBggCollection(client, ["testuser"], { json: true });
    const parsed = JSON.parse(output);
    expect(parsed.imported).toBe(2);
    expect(parsed.skipped).toBe(0);
    expect(Array.isArray(parsed.errors)).toBe(true);
    expect(parsed.errors[0]).toBe("Failed to fetch: Pandemic");
  });
});
