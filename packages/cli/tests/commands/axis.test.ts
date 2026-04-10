import { describe, test, expect } from "bun:test";
import { axisList, axisCreate, axisUpdate, axisDelete } from "../../src/commands/axis.js";
import { createMockClient } from "../helpers/mock-client.js";

const axes = [
  {
    id: "ax-1-full-uuid",
    name: "Wife will play it",
    weight: 40,
    source: "personal",
    description: null,
  },
  { id: "ax-2-full-uuid", name: "Community Rating", weight: 10, source: "bgg", description: null },
];

describe("axis list", () => {
  test("human-readable output has ID, Name, Weight, Source, Shape columns", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: axes } },
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
    expect(output).toContain("bgg");
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

describe("axis list with curve config", () => {
  const axesWithCurves = [
    {
      id: "ax-1-full-uuid",
      name: "Complexity",
      weight: 20,
      source: "bgg",
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
      },
    });

    const output = await axisList(client, [], { json: false });
    expect(output).toContain("sweet@2.75");
  });

  test("shows lower-is-better shape", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: axesWithCurves } },
      },
    });

    const output = await axisList(client, [], { json: false });
    expect(output).toContain("linear\u2193");
  });

  test("shows V indicator for veto", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: axesWithCurves } },
      },
    });

    const output = await axisList(client, [], { json: false });
    expect(output).toContain("V");
  });

  test("default shape for axes without preferenceShape", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/axes": { response: { ok: true, status: 200, data: axesWithCurves } },
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
    source: "bgg",
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
    const origPost = client.post;
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
    source: "bgg",
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
    const origPut = client.put;
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
    const origPut = client.put;
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
    const origPut = client.put;
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
