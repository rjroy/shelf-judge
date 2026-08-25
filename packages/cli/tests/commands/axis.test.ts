import { describe, test, expect } from "bun:test";
import { getDerivedFieldDiscovery } from "@shelf-judge/shared";
import {
  axisTemplates,
  axisList,
  axisCreate,
  axisUpdate,
  axisRepair,
  axisDelete,
} from "../../src/commands/axis.js";
import { createMockClient } from "../helpers/mock-client.js";

const axes = [
  {
    id: "ax-1-full-uuid",
    name: "Wife will play it",
    weight: 40,
    source: "personal",
    description: null,
  },
  {
    id: "ax-2-full-uuid",
    name: "Community Rating",
    weight: 10,
    source: "derived",
    derivedField: "communityRating",
    configuration: {},
    description: null,
  },
];

const discoveryRoute = {
  response: { ok: true, status: 200, data: getDerivedFieldDiscovery() },
};

describe("axis list", () => {
  test("human-readable output has ID, Name, Weight, Source, Shape columns", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: axes } },
        "GET /api/axes/derived-fields": discoveryRoute,
      },
    });

    const output = await axisList(client, [], { json: false });

    expect(output).toContain("ID");
    expect(output).toContain("Name");
    expect(output).toContain("Weight");
    expect(output).toContain("Source");
    expect(output).toContain("Shape");
    // IDs are sliced to 8 chars in the table
    expect(output).toContain("ax-1-ful");
    expect(output).toContain("Wife will play it");
    expect(output).toContain("40");
    expect(output).toContain("personal");
    expect(output).toContain("ax-2-ful");
    expect(output).toContain("Community Rating");
    expect(output).toContain("10");
    expect(output).toContain("derived:communityRating");
    // Default shape for axes without preferenceShape
    expect(output).toContain("linear\u2191");
  });

  test("--json output is a parseable JSON array", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: axes } },
      },
    });

    const output = await axisList(client, [], { json: true });
    const parsed = JSON.parse(output) as Array<{ id: string; name: string }>;

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("ax-1-full-uuid");
    expect(parsed[0].name).toBe("Wife will play it");
    expect(parsed[1].id).toBe("ax-2-full-uuid");
  });
});

describe("axis templates", () => {
  test("lists every discovery-backed template with configuration and provenance", async () => {
    const discovery = getDerivedFieldDiscovery();
    const client = createMockClient({
      routes: { "GET /api/axes/derived-fields": discoveryRoute },
    });

    const output = await axisTemplates(client, [], { json: false });

    for (const field of discovery.fields) {
      expect(output).toContain(field.id);
      expect(output).toContain(field.template.name);
      expect(output).toContain(field.provenance);
    }
    expect(output).toContain("targetPlayerCount");
    expect(output).toContain("maximumScoringTime");
  });

  test("preserves the versioned discovery response as JSON", async () => {
    const client = createMockClient({
      routes: { "GET /api/axes/derived-fields": discoveryRoute },
    });
    const output = await axisTemplates(client, [], { json: true });
    expect(JSON.parse(output)).toEqual(getDerivedFieldDiscovery());
  });
});

describe("axis create", () => {
  const created = {
    id: "new-axis-id",
    name: "Visual design",
    weight: 30,
    source: "personal",
    description: null,
  };

  test("human-readable output shows created axis name", async () => {
    const client = createMockClient({
      routes: {
        "POST /api/axes": { response: { ok: true, status: 201, data: created } },
      },
    });

    const output = await axisCreate(client, ["Visual design"], { json: false, weight: 30 });

    expect(output).toContain("Created axis: Visual design");
  });

  test("--json output is parseable JSON", async () => {
    const client = createMockClient({
      routes: {
        "POST /api/axes": { response: { ok: true, status: 201, data: created } },
      },
    });

    const output = await axisCreate(client, ["Visual design"], { json: true, weight: 30 });
    const parsed = JSON.parse(output) as { id: string; name: string; weight: number };

    expect(parsed.id).toBe("new-axis-id");
    expect(parsed.name).toBe("Visual design");
    expect(parsed.weight).toBe(30);
  });
});

describe("axis create from template", () => {
  test("creates all discovery templates and permits duplicates", async () => {
    const discovery = getDerivedFieldDiscovery();
    const capturedBodies: unknown[] = [];
    const client = createMockClient({
      routes: {
        "GET /api/axes/derived-fields": discoveryRoute,
        "POST /api/axes": {
          response: {
            ok: true,
            status: 201,
            data: {
              id: "new-derived-axis",
              name: "Derived",
              weight: 50,
              source: "derived",
              derivedField: "communityRating",
              configuration: {},
            },
          },
        },
      },
    });
    const originalPost = client.post.bind(client);
    client.post = <T>(path: string, body?: unknown) => {
      capturedBodies.push(body);
      return originalPost<T>(path, body);
    };

    for (const field of discovery.fields) {
      const options = {
        json: false,
        template: field.id,
        targetPlayerCount: field.configuration.some(({ name }) => name === "targetPlayerCount")
          ? 4
          : undefined,
        maximumScoringTime: field.configuration.some(({ name }) => name === "maximumScoringTime")
          ? 240
          : undefined,
      };
      await axisCreate(client, [], options);
      await axisCreate(client, [], options);
    }

    expect(capturedBodies).toHaveLength(discovery.fields.length * 2);
    const playerCountBodies = capturedBodies.filter(
      (body) => (body as { derivedField?: string }).derivedField === "playerCountFit",
    );
    expect(playerCountBodies).toHaveLength(2);
    expect(playerCountBodies[0]).toMatchObject({
      source: "derived",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 4 },
    });
    const playTime = capturedBodies.find(
      (body) => (body as { derivedField?: string }).derivedField === "playingTime",
    );
    expect(playTime).toMatchObject({
      configuration: { maximumScoringTime: 240 },
      idealValue: 90,
      toleranceWidth: 30,
    });
  });

  test("requires configuration without a default and applies discovered defaults", async () => {
    const capturedBodies: unknown[] = [];
    const client = createMockClient({
      routes: {
        "GET /api/axes/derived-fields": discoveryRoute,
        "POST /api/axes": {
          response: {
            ok: true,
            status: 201,
            data: {
              id: "play-time",
              name: "Play Time",
              weight: 50,
              source: "derived",
              derivedField: "playingTime",
              configuration: { maximumScoringTime: 240 },
            },
          },
        },
      },
    });
    const originalPost = client.post.bind(client);
    client.post = <T>(path: string, body?: unknown) => {
      capturedBodies.push(body);
      return originalPost<T>(path, body);
    };
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects pattern requires await
    await expect(
      axisCreate(client, [], { json: false, template: "playerCountFit" }),
    ).rejects.toThrow("--target-player-count is required");
    await axisCreate(client, [], { json: false, template: "playingTime" });
    expect(capturedBodies).toEqual([
      expect.objectContaining({ configuration: { maximumScoringTime: 240 } }),
    ]);
  });

  test("surfaces stable validation codes and fields", async () => {
    const client = createMockClient({
      routes: {
        "POST /api/axes": {
          response: {
            ok: false,
            status: 400,
            data: {
              error: "Validation failed",
              message: "Target player count is invalid",
              code: "invalid_target_player_count",
              details: [{ field: "targetPlayerCount", path: ["configuration"] }],
            },
          },
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects pattern requires await
    await expect(axisCreate(client, ["Personal"], { json: false })).rejects.toThrow(
      "Provide a whole target player count within the bounds shown by `axis templates`. [invalid_target_player_count] Fields: targetPlayerCount. Server: Target player count is invalid",
    );
  });
});

describe("axis update", () => {
  const updated = {
    id: "ax-1-full-uuid",
    name: "Wife will play it",
    weight: 50,
    source: "personal",
    description: null,
  };

  test("human-readable output shows updated axis", async () => {
    const client = createMockClient({
      routes: {
        "PUT /api/axes/ax-1-full-uuid": { response: { ok: true, status: 200, data: updated } },
      },
    });

    const output = await axisUpdate(client, ["ax-1-full-uuid"], { json: false, weight: 50 });

    expect(output).toContain("Updated axis");
  });

  test("--json output is parseable JSON", async () => {
    const client = createMockClient({
      routes: {
        "PUT /api/axes/ax-1-full-uuid": { response: { ok: true, status: 200, data: updated } },
      },
    });

    const output = await axisUpdate(client, ["ax-1-full-uuid"], { json: true, weight: 50 });
    const parsed = JSON.parse(output) as { id: string; weight: number };

    expect(parsed.id).toBe("ax-1-full-uuid");
    expect(parsed.weight).toBe(50);
  });
});

describe("axis update derived configuration", () => {
  test("merges a target update with the current configuration", async () => {
    let capturedBody: unknown;
    const derivedAxis = {
      ...axes[1],
      id: "player-axis",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 2 },
    };
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: [derivedAxis] } },
        "GET /api/axes/derived-fields": discoveryRoute,
        "PUT /api/axes/player-axis": {
          response: { ok: true, status: 200, data: derivedAxis },
        },
      },
    });
    const originalPut = client.put.bind(client);
    client.put = <T>(path: string, body?: unknown) => {
      capturedBody = body;
      return originalPut<T>(path, body);
    };

    await axisUpdate(client, ["player-axis"], { json: false, targetPlayerCount: 6 });

    expect(capturedBody).toEqual({ configuration: { targetPlayerCount: 6 } });
  });

  test("updates scoring cap and native-unit tolerance together", async () => {
    let capturedBody: unknown;
    const derivedAxis = {
      ...axes[1],
      id: "time-axis",
      derivedField: "playingTime",
      configuration: { maximumScoringTime: 240 },
    };
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: [derivedAxis] } },
        "GET /api/axes/derived-fields": discoveryRoute,
        "PUT /api/axes/time-axis": {
          response: { ok: true, status: 200, data: derivedAxis },
        },
      },
    });
    const originalPut = client.put.bind(client);
    client.put = <T>(path: string, body?: unknown) => {
      capturedBody = body;
      return originalPut<T>(path, body);
    };

    await axisUpdate(client, ["time-axis"], {
      json: false,
      maximumScoringTime: 300,
      toleranceWidth: 45,
    });

    expect(capturedBody).toEqual({
      toleranceWidth: 45,
      configuration: { maximumScoringTime: 300 },
    });
  });

  test("clears categorical tolerance when setting a native-unit width", async () => {
    let capturedBody: unknown;
    const client = createMockClient({
      routes: {
        "PUT /api/axes/time-axis": {
          response: {
            ok: true,
            status: 200,
            data: { ...axes[1], id: "time-axis", source: "derived" },
          },
        },
      },
    });
    const originalPut = client.put.bind(client);
    client.put = <T>(path: string, body?: unknown) => {
      capturedBody = body;
      return originalPut<T>(path, body);
    };

    await axisUpdate(client, ["time-axis"], {
      json: false,
      noTolerance: true,
      toleranceWidth: 30,
    });

    expect(capturedBody).toEqual({ tolerance: null, toleranceWidth: 30 });
  });

  test("clears native-unit tolerance when setting a categorical tolerance", async () => {
    let capturedBody: unknown;
    const client = createMockClient({
      routes: {
        "PUT /api/axes/time-axis": {
          response: {
            ok: true,
            status: 200,
            data: { ...axes[1], id: "time-axis", source: "derived" },
          },
        },
      },
    });
    const originalPut = client.put.bind(client);
    client.put = <T>(path: string, body?: unknown) => {
      capturedBody = body;
      return originalPut<T>(path, body);
    };

    await axisUpdate(client, ["time-axis"], {
      json: false,
      tolerance: "moderate",
      noToleranceWidth: true,
    });

    expect(capturedBody).toEqual({ tolerance: "moderate", toleranceWidth: null });
  });
});

describe("axis repair", () => {
  test("repairs a disabled axis using discovery-backed configuration", async () => {
    let capturedBody: unknown;
    const repaired = {
      ...axes[1],
      id: "legacy-axis",
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 4 },
    };
    const client = createMockClient({
      routes: {
        "GET /api/axes/derived-fields": discoveryRoute,
        "POST /api/axes/legacy-axis/repair": {
          response: { ok: true, status: 200, data: repaired },
        },
      },
    });
    const originalPost = client.post.bind(client);
    client.post = <T>(path: string, body?: unknown) => {
      capturedBody = body;
      return originalPost<T>(path, body);
    };

    const output = await axisRepair(client, ["legacy-axis"], {
      json: false,
      template: "playerCountFit",
      targetPlayerCount: 4,
    });

    expect(capturedBody).toEqual({
      derivedField: "playerCountFit",
      configuration: { targetPlayerCount: 4 },
    });
    expect(output).toContain("Repaired axis");
    expect(output).toContain("derived:playerCountFit");
  });
});

describe("axis list disabled legacy guidance", () => {
  test("shows repair and delete commands", async () => {
    const disabled = {
      id: "legacy-axis-id",
      name: "Old Metadata",
      description: null,
      weight: 20,
      enabled: false,
      source: "legacy",
      reason: "Unknown legacy field",
      legacyField: "oldField",
      legacyPayload: {},
    };
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: [disabled] } },
        "GET /api/axes/derived-fields": discoveryRoute,
      },
    });

    const output = await axisList(client, [], { json: false });
    expect(output).toContain("legacy (disabled)");
    expect(output).toContain("Unknown legacy field");
    expect(output).toContain("axis repair legacy-axis-id --template <id>");
    expect(output).toContain("axis delete legacy-axis-id");
  });
});

describe("axis list with curve config", () => {
  const axesWithCurves = [
    {
      id: "ax-1-full-uuid",
      name: "Complexity",
      weight: 20,
      source: "derived",
      derivedField: "weight",
      configuration: {},
      description: null,
      preferenceShape: "sweet-spot",
      idealValue: 2.75,
      tolerance: "moderate",
      leanDirection: "lower",
      veto: null,
    },
    {
      id: "ax-2-full-uuid",
      name: "Play Time",
      weight: 15,
      source: "personal",
      description: null,
      preferenceShape: "lower-is-better",
      veto: { direction: "above" as const, threshold: 8 },
    },
    {
      id: "ax-3-full-uuid",
      name: "Fun Factor",
      weight: 40,
      source: "personal",
      description: null,
    },
  ];

  test("shows sweet-spot shape with ideal value", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: axesWithCurves } },
        "GET /api/axes/derived-fields": discoveryRoute,
      },
    });

    const output = await axisList(client, [], { json: false });
    expect(output).toContain("sweet@2.75");
  });

  test("shows lower-is-better shape", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: axesWithCurves } },
        "GET /api/axes/derived-fields": discoveryRoute,
      },
    });

    const output = await axisList(client, [], { json: false });
    expect(output).toContain("linear\u2193");
  });

  test("shows V indicator for veto", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: axesWithCurves } },
        "GET /api/axes/derived-fields": discoveryRoute,
      },
    });

    const output = await axisList(client, [], { json: false });
    expect(output).toContain("V");
  });

  test("default shape for axes without preferenceShape", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: axesWithCurves } },
        "GET /api/axes/derived-fields": discoveryRoute,
      },
    });

    const output = await axisList(client, [], { json: false });
    expect(output).toContain("linear\u2191");
  });
});

describe("axis create with curve flags", () => {
  const created = {
    id: "new-axis-id",
    name: "Complexity",
    weight: 20,
    source: "derived",
    derivedField: "weight",
    configuration: {},
    description: null,
    preferenceShape: "sweet-spot",
    idealValue: 2.75,
    tolerance: "moderate",
  };

  test("passes curve config in request body", async () => {
    let capturedBody: unknown;
    const client = createMockClient({
      routes: {
        "POST /api/axes": { response: { ok: true, status: 201, data: created } },
      },
    });
    // Override post to capture body
    const origPost = client.post.bind(client);
    client.post = <T>(path: string, body?: unknown) => {
      capturedBody = body;
      return origPost<T>(path, body);
    };

    await axisCreate(client, ["Complexity"], {
      json: false,
      weight: 20,
      shape: "sweet-spot",
      ideal: 2.75,
      tolerance: "moderate",
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body.preferenceShape).toBe("sweet-spot");
    expect(body.idealValue).toBe(2.75);
    expect(body.tolerance).toBe("moderate");
  });
});

describe("axis update with curve flags", () => {
  const updated = {
    id: "ax-1-full-uuid",
    name: "Complexity",
    weight: 20,
    source: "derived",
    derivedField: "weight",
    configuration: {},
    description: null,
    preferenceShape: "sweet-spot",
    idealValue: 2.75,
  };

  test("passes veto config in request body", async () => {
    let capturedBody: unknown;
    const client = createMockClient({
      routes: {
        "PUT /api/axes/ax-1-full-uuid": { response: { ok: true, status: 200, data: updated } },
      },
    });
    const origPut = client.put.bind(client);
    client.put = <T>(path: string, body?: unknown) => {
      capturedBody = body;
      return origPut<T>(path, body);
    };

    await axisUpdate(client, ["ax-1-full-uuid"], {
      json: false,
      vetoBelow: 2,
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body.veto).toEqual({ direction: "below", threshold: 2 });
  });

  test("--no-veto sends null veto", async () => {
    let capturedBody: unknown;
    const client = createMockClient({
      routes: {
        "PUT /api/axes/ax-1-full-uuid": { response: { ok: true, status: 200, data: updated } },
      },
    });
    const origPut = client.put.bind(client);
    client.put = <T>(path: string, body?: unknown) => {
      capturedBody = body;
      return origPut<T>(path, body);
    };

    await axisUpdate(client, ["ax-1-full-uuid"], {
      json: false,
      noVeto: true,
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body.veto).toBeNull();
  });

  test("--lean none sends null leanDirection", async () => {
    let capturedBody: unknown;
    const client = createMockClient({
      routes: {
        "PUT /api/axes/ax-1-full-uuid": { response: { ok: true, status: 200, data: updated } },
      },
    });
    const origPut = client.put.bind(client);
    client.put = <T>(path: string, body?: unknown) => {
      capturedBody = body;
      return origPut<T>(path, body);
    };

    await axisUpdate(client, ["ax-1-full-uuid"], {
      json: false,
      lean: "none",
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body.leanDirection).toBeNull();
  });
});

describe("axis delete", () => {
  const deleteResult = { deletedRatingsCount: 3 };

  test("human-readable output shows deleted axis and rating count", async () => {
    const client = createMockClient({
      routes: {
        "DELETE /api/axes/ax-1-full-uuid": {
          response: { ok: true, status: 200, data: deleteResult },
        },
      },
    });

    const output = await axisDelete(client, ["ax-1-full-uuid"], { json: false });

    expect(output).toContain("Deleted axis");
    expect(output).toContain("3 rating(s)");
  });

  test("--json output is parseable JSON with deletedRatingsCount", async () => {
    const client = createMockClient({
      routes: {
        "DELETE /api/axes/ax-1-full-uuid": {
          response: { ok: true, status: 200, data: deleteResult },
        },
      },
    });

    const output = await axisDelete(client, ["ax-1-full-uuid"], { json: true });
    const parsed = JSON.parse(output) as { deletedRatingsCount: number };

    expect(parsed.deletedRatingsCount).toBe(3);
  });
});
