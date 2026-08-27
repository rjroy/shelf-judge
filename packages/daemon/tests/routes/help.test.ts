import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, jsonRequest, type TestAppContext } from "../helpers/test-app.js";

interface PublishedSchema {
  type?: "object" | "string";
  const?: unknown;
  pattern?: string;
  required?: string[];
  properties?: Record<string, PublishedSchema>;
  additionalProperties?: boolean;
  oneOf?: PublishedSchema[];
  anyOf?: PublishedSchema[];
  not?: PublishedSchema;
}

function matchesPublishedSchema(schema: PublishedSchema, value: unknown): boolean {
  if (schema.oneOf) {
    return schema.oneOf.filter((branch) => matchesPublishedSchema(branch, value)).length === 1;
  }
  if (schema.anyOf && !schema.anyOf.some((branch) => matchesPublishedSchema(branch, value))) {
    return false;
  }
  if (schema.not && matchesPublishedSchema(schema.not, value)) return false;
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.pattern && (typeof value !== "string" || !new RegExp(schema.pattern).test(value))) {
    return false;
  }
  if (schema.type === "string") {
    return typeof value === "string";
  }
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (schema.required?.some((key) => !(key in record))) return false;
    if (
      schema.additionalProperties === false &&
      Object.keys(record).some((key) => !(key in (schema.properties ?? {})))
    ) {
      return false;
    }
    return Object.entries(schema.properties ?? {}).every(
      ([key, propertySchema]) =>
        !(key in record) || matchesPublishedSchema(propertySchema, record[key]),
    );
  }
  return true;
}

interface HelpNode {
  name: string;
  description?: string;
  invocation?: { method: string; path: string };
  idempotent?: boolean;
  parameters?: {
    name: string;
    in: string;
    description: string;
    required: boolean;
    acceptedValues?: string[];
  }[];
  request?: { body: PublishedSchema };
  errors?: {
    status: number;
    code: string;
    description: string;
    response: { error: string; code: string; [key: string]: unknown };
  }[];
  children?: Record<string, HelpNode>;
}

interface ConfigResponse {
  bggAuthToken: string | null;
}

let ctx: TestAppContext;

beforeEach(() => {
  ctx = createTestApp();
});

describe("GET /api/help", () => {
  test("returns all operations in a tree structure with root shelf node", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help");
    expect(res.status).toBe(200);

    const body = (await res.json()) as HelpNode;
    expect(body.name).toBe("shelf");
    expect(body.children).toBeDefined();
    expect(typeof body.children).toBe("object");
  });

  test("root tree has children for registered features", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help");
    const body = (await res.json()) as HelpNode;

    // The app registers multiple route modules; at minimum help and config exist
    expect(body.children!.help).toBeDefined();
    expect(body.children!.config).toBeDefined();
  });

  test("operations in tree have correct name, description, and invocation properties", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help");
    const body = (await res.json()) as HelpNode;

    // shelf.help is a two-part operationId, so it lands directly at children.help
    const helpNode = body.children!.help;
    expect(helpNode).toBeDefined();
    expect(helpNode.name).toBe("help");
    expect(typeof helpNode.description).toBe("string");
    expect(helpNode.description!.length).toBeGreaterThan(0);
    expect(helpNode.invocation).toEqual({
      method: "GET",
      path: "/api/help",
    });
  });
});

describe("GET /api/help/:feature", () => {
  test("returns game operations subtree", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help/game");
    expect(res.status).toBe(200);

    const body = (await res.json()) as HelpNode;
    expect(body.name).toBe("shelf");
    expect(body.children).toBeDefined();
    expect(body.children!.game).toBeDefined();
  });

  test("registers derived-field discovery and disabled-axis repair", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help/axis");
    expect(res.status).toBe(200);
    const body = (await res.json()) as HelpNode;
    const axis = body.children?.axis;
    const discovery = axis?.children?.["derived-fields"];
    expect(discovery).toMatchObject({
      name: "derived-fields",
      description: "Discover versioned registry-backed derived axis fields and templates",
      idempotent: true,
    });
    expect(discovery?.invocation).toEqual({
      method: "GET",
      path: "/api/axes/derived-fields",
    });
    const repair = axis?.children?.repair;
    expect(repair).toMatchObject({
      name: "repair",
      description: "Repair a disabled legacy axis as a registered derived axis",
      idempotent: false,
      parameters: [{ name: "id", in: "path", description: "Axis ID", required: true }],
    });
    expect(repair?.invocation).toEqual({
      method: "POST",
      path: "/api/axes/:id/repair",
    });

    const discoveryOperation = ctx.operations.find(
      ({ operationId }) => operationId === "shelf.axis.derived-fields",
    );
    const repairOperation = ctx.operations.find(
      ({ operationId }) => operationId === "shelf.axis.repair",
    );
    expect(discoveryOperation?.requestSchema).toBeUndefined();
    expect(repairOperation?.requestSchema).toBeDefined();
    expect(repairOperation?.idempotent).toBe(false);
    expect(
      repairOperation?.requestSchema?.safeParse({
        derivedField: "communityRating",
        configuration: {},
      }).success,
    ).toBe(true);
  });

  test("exposes complete purchase operation errors and detail query constraints", async () => {
    const gameResponse = await jsonRequest(ctx.app, "GET", "/api/help/game");
    const gameHelp = (await gameResponse.json()) as HelpNode;
    const game = gameHelp.children?.game;
    expect(
      game?.children?.get?.parameters?.find(({ name }) => name === "includePredicted"),
    ).toEqual({
      name: "includePredicted",
      in: "query",
      description: "Use predicted score",
      required: false,
      acceptedValues: ["true", "false"],
    });
    expect(game?.children?.get?.errors?.map(({ status, code }) => [status, code])).toEqual([
      [400, "invalid_include_predicted"],
      [404, "game_not_found"],
      [500, "internal_error"],
    ]);
    expect(
      game?.children?.["set-acquisition"]?.errors?.map(({ status, code }) => [status, code]),
    ).toEqual([
      [400, "invalid_json"],
      [400, "invalid_acquisition_request"],
      [404, "game_not_found"],
      [500, "internal_error"],
    ]);
    expect(
      game?.children?.["set-acquisition"]?.errors?.find(
        ({ code }) => code === "invalid_acquisition_request",
      )?.response,
    ).toHaveProperty("details");

    const collectionResponse = await jsonRequest(ctx.app, "GET", "/api/help/collection");
    const collectionHelp = (await collectionResponse.json()) as HelpNode;
    const collection = collectionHelp.children?.collection?.children;
    expect(
      collection?.["get-entertainment-benchmark"]?.errors?.map(({ status, code }) => [
        status,
        code,
      ]),
    ).toEqual([[500, "internal_error"]]);
    expect(
      collection?.["set-entertainment-benchmark"]?.errors?.map(({ status, code }) => [
        status,
        code,
      ]),
    ).toEqual([
      [400, "invalid_json"],
      [400, "invalid_benchmark_request"],
      [500, "internal_error"],
    ]);
    expect(
      collection?.["clear-entertainment-benchmark"]?.errors?.map(({ status, code }) => [
        status,
        code,
      ]),
    ).toEqual([[500, "internal_error"]]);
    const benchmark = collection?.["set-entertainment-benchmark"];
    expect(benchmark?.request?.body).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["amount"],
    });
    expect(
      benchmark?.errors?.find(({ code }) => code === "invalid_benchmark_request")?.response,
    ).toHaveProperty("details");
  });

  test("publishes semantically strict acquisition and benchmark request schemas", async () => {
    const gameHelp = (await (
      await jsonRequest(ctx.app, "GET", "/api/help/game")
    ).json()) as HelpNode;
    const acquisition = gameHelp.children?.game?.children?.["set-acquisition"]?.request?.body;
    if (!acquisition) throw new Error("Missing acquisition request schema");
    expect(acquisition?.oneOf).toHaveLength(3);
    for (const branch of acquisition?.oneOf ?? []) {
      expect(branch).toMatchObject({ type: "object", additionalProperties: false });
      expect(branch.properties).toBeDefined();
    }
    for (const value of [
      { state: "unknown" },
      { state: "gift" },
      { state: "purchase", amount: "0" },
      { state: "purchase", amount: "12.34" },
      { state: "purchase", amount: "90071992547409.91" },
    ]) {
      expect(matchesPublishedSchema(acquisition, value)).toBe(true);
    }
    for (const value of [
      { state: "unknown", amount: "1" },
      { state: "gift", amount: "1" },
      { state: "purchase" },
      { state: "purchase", amount: "1.234" },
      { state: "purchase", amount: "90071992547409.92" },
      { state: "purchase", amount: 1 },
      { state: "other" },
      { state: "gift", extra: true },
    ]) {
      expect(matchesPublishedSchema(acquisition, value)).toBe(false);
    }

    const collectionHelp = (await (
      await jsonRequest(ctx.app, "GET", "/api/help/collection")
    ).json()) as HelpNode;
    const benchmark =
      collectionHelp.children?.collection?.children?.["set-entertainment-benchmark"]?.request?.body;
    if (!benchmark) throw new Error("Missing benchmark request schema");
    expect(benchmark).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["amount"],
    });
    for (const value of [
      { amount: "0.01" },
      { amount: "8" },
      { amount: "12.34" },
      { amount: "90071992547409.91" },
    ]) {
      expect(matchesPublishedSchema(benchmark, value)).toBe(true);
    }
    for (const value of [
      { amount: "0" },
      { amount: "0.00" },
      { amount: "1.234" },
      { amount: "90071992547409.92" },
      { amount: 8 },
      { amount: "8", extra: true },
      {},
    ]) {
      expect(matchesPublishedSchema(benchmark, value)).toBe(false);
    }
  });

  test("returns 404 for nonexistent feature", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/help/nonexistent");
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("nonexistent");
  });
});

describe("GET /api/config", () => {
  test("returns config with masked token", async () => {
    const res = await jsonRequest(ctx.app, "GET", "/api/config");
    expect(res.status).toBe(200);

    const body = (await res.json()) as ConfigResponse;
    // Default config has no token, so bggAuthToken should be null
    expect(body.bggAuthToken).toBeNull();
  });
});

describe("PUT /api/config", () => {
  test("updates config and returns masked token", async () => {
    const putRes = await jsonRequest(ctx.app, "PUT", "/api/config", {
      bggAuthToken: "test-token",
    });
    expect(putRes.status).toBe(200);

    const putBody = (await putRes.json()) as ConfigResponse;
    expect(putBody.bggAuthToken).toBe("***configured***");

    // Verify GET also shows the masked token
    const getRes = await jsonRequest(ctx.app, "GET", "/api/config");
    const getBody = (await getRes.json()) as ConfigResponse;
    expect(getBody.bggAuthToken).toBe("***configured***");
  });
});
