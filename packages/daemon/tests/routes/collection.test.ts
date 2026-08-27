import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createTestApp, jsonRequest, type TestAppContext } from "../helpers/test-app.js";
import { createCollectionRoutes } from "../../src/routes/collection.js";
import {
  createPurchaseUtilizationService,
  type PurchaseUtilizationService,
} from "../../src/services/purchase-utilization-service.js";
import type { Logger } from "../../src/services/logger.js";
import type { OperationDefinition } from "../../src/operations.js";

let ctx: TestAppContext;

beforeEach(() => {
  ctx = createTestApp();
});

async function expectPublishedError(
  operation: OperationDefinition,
  response: Response,
): Promise<Record<string, unknown>> {
  const body = (await response.json()) as Record<string, unknown>;
  const definition = operation.errors?.find(
    ({ status, code }) => status === response.status && code === body.code,
  );
  expect(definition).toBeDefined();
  expect(Object.keys(body).sort()).toEqual(Object.keys(definition?.response ?? {}).sort());
  expect(body.code).toBe(definition?.code);
  return body;
}

describe("collection entertainment benchmark routes", () => {
  test("gets, sets, corrects, and clears the benchmark", async () => {
    const initial = await jsonRequest(ctx.app, "GET", "/api/collection/entertainment-benchmark");
    expect(await initial.json()).toEqual({ entertainmentBenchmark: null });

    const set = await jsonRequest(ctx.app, "PUT", "/api/collection/entertainment-benchmark", {
      amount: "8.00",
    });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({
      entertainmentBenchmark: {
        state: "configured",
        amount: { hundredths: 800, source: "manual" },
      },
    });

    const corrected = await jsonRequest(ctx.app, "PUT", "/api/collection/entertainment-benchmark", {
      amount: "9.5",
    });
    expect(await corrected.json()).toMatchObject({
      entertainmentBenchmark: { amount: { hundredths: 950 } },
    });

    const cleared = await jsonRequest(ctx.app, "DELETE", "/api/collection/entertainment-benchmark");
    expect(await cleared.json()).toEqual({ entertainmentBenchmark: null });
  });

  test("strictly rejects malformed, zero, excess precision, overflow, and invalid JSON", async () => {
    const payloads = [
      { amount: "0" },
      { amount: "1.234" },
      { amount: "90071992547409.92" },
      { amount: 8 },
      { amount: "8", extra: true },
      {},
    ];
    for (const payload of payloads) {
      const response = await jsonRequest(
        ctx.app,
        "PUT",
        "/api/collection/entertainment-benchmark",
        payload,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "Validation failed",
        code: "invalid_benchmark_request",
      });
    }

    const malformed = await ctx.app.request(
      new Request("http://localhost/api/collection/entertainment-benchmark", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Invalid JSON body", code: "invalid_json" });
  });

  test("logs safe HTTP validation and service persistence seams", async () => {
    const logs: unknown[][] = [];
    const logger: Logger = {
      log: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    };
    const service = createPurchaseUtilizationService({
      storageService: ctx.storageService,
      logger,
    });
    const routeModule = createCollectionRoutes({ purchaseUtilizationService: service, logger });
    const app = new Hono();
    app.route("/api", routeModule.routes);

    const rejected = await app.request("/api/collection/entertainment-benchmark", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "private-invalid", extra: true }),
    });
    expect(rejected.status).toBe(400);
    const accepted = await app.request("/api/collection/entertainment-benchmark", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "876.54" }),
    });
    expect(accepted.status).toBe(200);

    expect(logs).toContainEqual([
      "benchmark HTTP mutation rejected",
      {
        collectionId: "collection",
        requestedState: "configured",
        changedFields: ["entertainmentBenchmark"],
        outcome: "rejected",
        validationCode: "invalid_benchmark_request",
      },
    ]);
    expect(
      logs.some(
        ([message, fields]) =>
          message === "benchmark persistence completed" &&
          typeof fields === "object" &&
          fields !== null &&
          "collectionId" in fields &&
          "previousState" in fields &&
          "nextState" in fields,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("private-invalid");
    expect(serialized).not.toContain("876.54");
    expect(serialized).not.toContain("87654");
  });

  test("registers discoverable idempotent operations with body metadata", async () => {
    const operations = ctx.operations.filter(
      (operation) => operation.hierarchy.feature === "collection",
    );
    expect(operations.map((operation) => operation.invocation)).toEqual([
      { method: "GET", path: "/api/collection/entertainment-benchmark" },
      { method: "PUT", path: "/api/collection/entertainment-benchmark" },
      { method: "DELETE", path: "/api/collection/entertainment-benchmark" },
    ]);
    expect(operations.every((operation) => operation.idempotent)).toBe(true);
    expect(operations[1].parameters).toEqual([
      {
        name: "body",
        in: "body",
        description: "Strict object containing a positive decimal amount string",
        required: true,
      },
    ]);
    expect(operations[1].requestSchema?.safeParse({ amount: "8.00" }).success).toBe(true);

    const help = await jsonRequest(ctx.app, "GET", "/api/help/collection");
    expect(help.status).toBe(200);
    expect(JSON.stringify(await help.json())).toContain("set-entertainment-benchmark");
  });

  test("runtime validation and internal errors match discovery metadata", async () => {
    const operations = new Map(
      ctx.operations
        .filter(({ hierarchy }) => hierarchy.feature === "collection")
        .map((operation) => [operation.operationId, operation]),
    );
    const getOperation = operations.get("shelf.collection.get-entertainment-benchmark");
    const setOperation = operations.get("shelf.collection.set-entertainment-benchmark");
    const clearOperation = operations.get("shelf.collection.clear-entertainment-benchmark");
    if (!getOperation || !setOperation || !clearOperation) {
      throw new Error("Missing collection benchmark operations");
    }

    const malformed = await ctx.app.request("/api/collection/entertainment-benchmark", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(await expectPublishedError(setOperation, malformed)).toEqual({
      error: "Invalid JSON body",
      code: "invalid_json",
    });
    const invalid = await jsonRequest(ctx.app, "PUT", "/api/collection/entertainment-benchmark", {
      amount: "0",
    });
    const invalidBody = await expectPublishedError(setOperation, invalid);
    expect(invalidBody).toMatchObject({
      error: "Validation failed",
      code: "invalid_benchmark_request",
    });

    const rejected = () => Promise.reject(new Error("private storage failure"));
    const failingService: PurchaseUtilizationService = {
      getEntertainmentBenchmark: rejected,
      setEntertainmentBenchmark: rejected,
      clearEntertainmentBenchmark: rejected,
      setAcquisition: rejected,
      enrichGames: () => [],
    };
    const routeModule = createCollectionRoutes({ purchaseUtilizationService: failingService });
    const app = new Hono();
    app.route("/api", routeModule.routes);

    const getFailed = await app.request("/api/collection/entertainment-benchmark");
    expect(await expectPublishedError(getOperation, getFailed)).toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
    const setFailed = await jsonRequest(app, "PUT", "/api/collection/entertainment-benchmark", {
      amount: "8.00",
    });
    expect(await expectPublishedError(setOperation, setFailed)).toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
    const clearFailed = await app.request("/api/collection/entertainment-benchmark", {
      method: "DELETE",
    });
    expect(await expectPublishedError(clearOperation, clearFailed)).toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
  });
});
