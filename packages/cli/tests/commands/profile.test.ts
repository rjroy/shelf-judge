import { describe, test, expect } from "bun:test";
import { profileCommand } from "../../src/commands/profile.js";
import { createMockClient } from "../helpers/mock-client.js";
import type { CollectionProfile } from "@shelf-judge/shared";

const sampleProfile: CollectionProfile = {
  axisDistributions: [
    {
      axisId: "fun",
      axisName: "Fun",
      mean: 7.5,
      median: 8,
      standardDeviation: 1.2,
      range: { min: 3, max: 10 },
      ratedGameCount: 10,
    },
  ],
  axisWeights: [{ axisId: "fun", axisName: "Fun", weight: 50, percentage: 100 }],
  bggClustering: {
    mechanics: [{ attribute: "Deck Building", count: 5, percentage: 50 }],
    categories: [],
    subdomains: [],
    weightRanges: [{ range: "Medium", min: 2.5, max: 3.0, count: 4, percentage: 40 }],
  },
  utilityCurves: [],
  divergence: null,
  outliers: [],
  suggestions: [],
  gameCount: 10,
  ratedGameCount: 8,
  computedAt: "2026-04-10T12:00:00.000Z",
};

const client = createMockClient({
  routes: {
    "GET /api/profile": {
      response: { ok: true, status: 200, data: sampleProfile },
    },
  },
});

describe("profile", () => {
  test("outputs valid JSON containing profile data", async () => {
    const output = await profileCommand(client, [], { json: false });
    const parsed = JSON.parse(output) as CollectionProfile;
    expect(parsed.gameCount).toBe(10);
    expect(parsed.ratedGameCount).toBe(8);
    expect(parsed.axisDistributions).toHaveLength(1);
    expect(parsed.axisDistributions[0].axisName).toBe("Fun");
    expect(parsed.computedAt).toBe("2026-04-10T12:00:00.000Z");
  });

  test("outputs valid JSON when --json flag is passed", async () => {
    const output = await profileCommand(client, [], { json: true });
    const parsed = JSON.parse(output) as CollectionProfile;
    expect(parsed.gameCount).toBe(10);
  });

  test("includes all profile sections", async () => {
    const output = await profileCommand(client, [], { json: false });
    const parsed = JSON.parse(output) as CollectionProfile;
    expect(parsed.bggClustering.mechanics).toHaveLength(1);
    expect(parsed.divergence).toBeNull();
    expect(parsed.outliers).toHaveLength(0);
    expect(parsed.suggestions).toHaveLength(0);
  });
});
