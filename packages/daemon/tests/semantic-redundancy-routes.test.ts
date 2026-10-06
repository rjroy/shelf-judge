import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  createInitialSemanticRedundancyStateV10,
  DEFAULT_JEV_RUN_BUDGET,
  type Collection,
} from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import type { JevStatusResponse } from "../src/services/jev-pair-status";
import type { createJevStatusService } from "../src/services/jev-status-service";
import type { createJevRefreshProgressService } from "../src/services/jev-refresh-progress-service";
import type { RedundancyRoutesDeps } from "../src/routes/redundancy";
import { createRedundancyRoutes } from "../src/routes/redundancy";
import { createSettingsRouteStorageStub } from "./helpers/settings-route-storage";

function harness(
  jevStatusService?: Pick<ReturnType<typeof createJevStatusService>, "read">,
  jevRunController?: RedundancyRoutesDeps["jevRunController"],
  jevRefreshProgressService?: Pick<ReturnType<typeof createJevRefreshProgressService>, "read">,
) {
  const collection: Collection = {
    schemaVersion: 10,
    revision: 0,
    id: "semantic-route-test",
    name: "Test",
    axes: [],
    games: [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: createInitialSemanticRedundancyStateV10(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const storage = {
    ...createSettingsRouteStorageStub(),
    loadCollection: () => Promise.resolve(structuredClone(collection)),
    saveCollection: (value: Collection) => {
      Object.assign(collection, structuredClone(value));
      return Promise.resolve();
    },
    loadRedundancySettings: () =>
      Promise.resolve({
        enabled: false,
        stage: "annotation" as const,
        similarityThreshold: 0.6,
        maxPenalty: 2,
        componentWeights: { binary: 4 / 7, continuous: 3 / 7 },
        minNeighbors: 1,
        expectedNeighbors: 5,
      }),
    saveRedundancySettings: () => Promise.resolve(),
  } as StorageService;
  const route = createRedundancyRoutes({
    storageService: storage,
    jevStatusService,
    jevRunController,
    jevRefreshProgressService,
  });
  const app = new Hono();
  app.route("/api", route.routes);
  return { app, collection, operations: route.operations };
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("semantic redundancy routes", () => {
  test("V10 factual-only state and compatibility summary remain not-ready", async () => {
    const { app, collection } = harness();
    collection.semanticRedundancy.settings.enabled = true;
    const settings = await app.request("/api/redundancy/settings");
    expect(await settings.json()).toMatchObject({
      semantic: { status: { status: "not-ready", publicationStatus: "not-ready" } },
    });
    const summary = await app.request("/api/redundancy/semantic/summary");
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ status: "not-ready", generation: null });
    const refreshStatus = await app.request("/api/redundancy/semantic/refresh-status");
    expect(refreshStatus.status).toBe(503);
    expect(refreshStatus.headers.get("Cache-Control")).toBe("no-store");
  });

  test("semantic preferences remain writable without activating legacy inference", async () => {
    const { app, collection } = harness();
    const response = await app.request("/api/redundancy/semantic-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        cachedOwnerNoteUse: true,
        weights: { description: 0.3 },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cleanupPending: false });
    expect(collection.semanticRedundancy.settings).toEqual({
      enabled: true,
      cachedOwnerNoteUse: true,
      weights: { factual: 7, description: 0.3, ownerNote: 0 },
    });
  });

  test("retired manifest protocol routes are removed", async () => {
    const { app } = harness();
    const requests: [string, RequestInit][] = [
      ["/api/redundancy/semantic/disclosure", json({ signalScope: "description-only" })],
      ["/api/redundancy/semantic/disclosure/page", json({ manifestId: "m", offset: 0 })],
      ["/api/redundancy/semantic/acknowledge-and-start", json({ manifestId: "m" })],
    ];
    for (const [path, init] of requests) {
      const response = await app.request(path, init);
      expect(response.status).toBe(404);
    }
  });

  test("refresh-status accepts partial aggregate coverage with no-store and never invokes inference", async () => {
    let reads = 0;
    const response: JevStatusResponse = {
      status: "partial",
      measurement: "current",
      eligibleGameCount: 2,
      pairCount: 1,
      coverage: {
        C: { covered: 1, missing: 0, invalid: 0, unavailable: 0, blocked: 0 },
        D: { covered: 0, missing: 0, invalid: 0, unavailable: 1, blocked: 0 },
      },
      progress: {
        state: "last-known-running",
        pairCount: 1,
        completedPairs: 0,
        cacheHits: 0,
        cacheMisses: 1,
        failedPairs: 0,
      },
    };
    const { app, operations } = harness({
      read: () => {
        reads++;
        return Promise.resolve(response);
      },
    });
    const status = await app.request("/api/redundancy/semantic/refresh-status");
    expect(status.status).toBe(200);
    expect(status.headers.get("Cache-Control")).toBe("no-store");
    const body = (await status.json()) as JevStatusResponse;
    expect(body).toEqual(response);
    expect(Object.keys(body).sort()).toEqual([
      "coverage",
      "eligibleGameCount",
      "measurement",
      "pairCount",
      "progress",
      "status",
    ]);
    expect(JSON.stringify(body)).not.toContain("PRIVATE NOTE");
    expect(reads).toBe(1);
    expect(
      operations.find((operation) => operation.invocation.path.endsWith("refresh-status")),
    ).toMatchObject({
      invocation: { method: "GET" },
      description: "Get aggregate semantic coverage and historical Jev Run progress",
      idempotent: true,
    });
    expect(operations.some((operation) => operation.invocation.path.endsWith("/summary"))).toBe(
      true,
    );
  });

  test("refresh-status returns a sanitized no-store 503 when its dependency throws", async () => {
    const { app } = harness({
      read: () => Promise.reject(new Error("private sentinel should not escape")),
    });
    const status = await app.request("/api/redundancy/semantic/refresh-status");
    expect(status.status).toBe(503);
    expect(status.headers.get("Cache-Control")).toBe("no-store");
    const body = (await status.json()) as { error: string };
    expect(body).toEqual({ error: "Semantic status is unavailable" });
    expect(JSON.stringify(body)).not.toContain("private sentinel");
  });

  test("refresh-progress is a distinct no-store, coverage-not-measured contract", async () => {
    const progress = {
      coverageMeasurement: "not-measured" as const,
      activity: { state: "active" as const, runId: "run-visible" },
      progress: {
        state: "saved" as const,
        relation: "active-run" as const,
        value: {
          state: "last-known-running" as const,
          scope: "wishlist" as const,
          pairCount: 3,
          completedPairs: 1,
          cacheHits: 0,
          cacheMisses: 1,
          failedPairs: 0,
        },
      },
    };
    const { app, operations } = harness(undefined, undefined, { read: () => progress });
    const response = await app.request("/api/redundancy/semantic/refresh-progress");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(progress);
    expect(
      operations.find((operation) => operation.invocation.path.endsWith("refresh-progress")),
    ).toMatchObject({ idempotent: true, invocation: { method: "GET" } });
    const unavailable = await harness().app.request("/api/redundancy/semantic/refresh-progress");
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("Cache-Control")).toBe("no-store");
  });

  test("refresh-progress publishes process-local retry capability in its declared schema", async () => {
    const processLocal = {
      coverageMeasurement: "not-measured" as const,
      activity: { state: "idle" as const },
      progress: {
        state: "process-local" as const,
        retryRunId: "run-pending",
        value: {
          state: "interrupted" as const,
          pairCount: 3,
          completedPairs: 1,
          cacheHits: 0,
          cacheMisses: 1,
          failedPairs: 0,
          stopReason: "owner-cancelled" as const,
          publication: {
            state: "pending" as const,
            phase: "seal" as const,
            outcomePersistence: "unpersisted" as const,
            reason: "seal-failed",
          },
        },
      },
    };
    const { app, operations } = harness(undefined, undefined, { read: () => processLocal });
    const response = await app.request("/api/redundancy/semantic/refresh-progress");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(processLocal);
    const operation = operations.find((item) => item.invocation.path.endsWith("refresh-progress"));
    const schemaText = JSON.stringify(operation?.response?.body);
    for (const field of [
      "process-local",
      "retryRunId",
      "publication",
      "reason",
      "owner-cancelled",
      "unpersisted",
    ])
      expect(schemaText).toContain(field);
  });

  test("Run endpoints are strict, sanitized, aggregate-only, and no-store", async () => {
    const calls: unknown[] = [];
    const controller = {
      preview: async () => {
        await Promise.resolve();
        calls.push("preview");
        return {
          status: 200,
          body: {
            requestId: "request-safe",
            precondition: "opaque-token",
            provider: "TypeSafe",
            modelId: "jev-test",
            eligibleGameCount: 2,
            pairCount: 1,
            descriptionBearingPairCount: 1,
            noteBearingPairCount: 0,
            noteTransmissionPermitted: false,
            providerConfigured: false,
            signalScope: { description: true, ownerNotes: false },
            scoringEffect: "annotation-only",
            limits: { maxEligiblePairs: 25_000, maxProviderAttempts: 100 },
            withinPairLimit: true,
            expiresAt: "2026-01-01T00:00:00.000Z",
          },
        };
      },
      start: async (input: unknown) => {
        await Promise.resolve();
        calls.push(input);
        return { status: 200, body: { state: "started", runId: "run-safe" } };
      },
      cancel: (input: unknown) => {
        calls.push(input);
        return { status: 200, body: { state: "cancellation-requested" } };
      },
      retryPublication: (input: { runId: string }) => {
        calls.push(input);
        return input.runId === "run-safe"
          ? {
              status: 200,
              body: {
                runId: input.runId,
                state: "completed",
                publication: { state: "published", outcomePersistence: "finalized" },
              },
            }
          : { status: 404, body: { error: "run-not-found" } };
      },
      activeRun: () => ({ runId: "run-safe" }),
    } as unknown as NonNullable<RedundancyRoutesDeps["jevRunController"]>;
    const { app, operations } = harness(undefined, controller);

    const preview = await app.request("/api/redundancy/semantic/run-preview", {
      headers: { "If-None-Match": "*" },
    });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Cache-Control")).toBe("no-store");
    expect(preview.headers.get("ETag")).toBeNull();
    const previewBody = (await preview.json()) as Record<string, unknown>;
    expect(previewBody).toMatchObject({
      provider: "TypeSafe",
      modelId: "jev-test",
      pairCount: 1,
      providerConfigured: false,
      noteTransmissionPermitted: false,
      signalScope: { description: true, ownerNotes: false },
      limits: { maxProviderAttempts: 100 },
    });
    expect(previewBody).not.toHaveProperty("retentionCaveat");
    expect(JSON.stringify(previewBody)).not.toMatch(/retention/i);
    expect(JSON.stringify(previewBody)).not.toContain(
      "TypeSafe's default retention duration is unspecified",
    );
    expect(JSON.stringify(previewBody)).not.toContain("do not promise provider-side erasure");

    const malformed = await app.request(
      "/api/redundancy/semantic/run",
      json({
        requestId: "id",
        precondition: "token",
        noteTransmissionAuthorized: false,
        maxProviderAttempts: 101,
      }),
    );
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("Cache-Control")).toBe("no-store");
    expect(calls).toEqual(["preview"]);
    const scopeCannotBeReselectedAtStart = await app.request(
      "/api/redundancy/semantic/run",
      json({
        requestId: "request-safe",
        precondition: "opaque-token",
        noteTransmissionAuthorized: false,
        scope: "wishlist",
        bggId: [999],
      }),
    );
    expect(scopeCannotBeReselectedAtStart.status).toBe(400);
    expect(calls).toEqual(["preview"]);

    const started = await app.request(
      "/api/redundancy/semantic/run",
      json({
        requestId: "request-safe",
        precondition: "opaque-token",
        noteTransmissionAuthorized: false,
      }),
    );
    expect(started.status).toBe(202);
    expect(started.headers.get("Cache-Control")).toBe("no-store");
    expect(await started.json()).toEqual({ state: "started", runId: "run-safe" });

    const canceled = await app.request(
      "/api/redundancy/semantic/cancel",
      json({ runId: "run-safe" }),
    );
    expect(canceled.status).toBe(202);
    expect(canceled.headers.get("Cache-Control")).toBe("no-store");
    expect(await canceled.json()).toEqual({ state: "cancellation-requested" });

    const active = await app.request("/api/redundancy/semantic/active-run");
    expect(active.status).toBe(200);
    expect(active.headers.get("Cache-Control")).toBe("no-store");
    expect(await active.json()).toEqual({ runId: "run-safe" });
    const malformedRetry = await app.request(
      "/api/redundancy/semantic/publication/retry",
      json({ runId: "" }),
    );
    expect(malformedRetry.status).toBe(400);
    const unknownRetry = await app.request(
      "/api/redundancy/semantic/publication/retry",
      json({ runId: "missing" }),
    );
    expect(unknownRetry.status).toBe(404);
    const retryOnce = await app.request(
      "/api/redundancy/semantic/publication/retry",
      json({ runId: "run-safe" }),
    );
    const retryAgain = await app.request(
      "/api/redundancy/semantic/publication/retry",
      json({ runId: "run-safe" }),
    );
    expect(retryOnce.status).toBe(200);
    expect(retryOnce.headers.get("Cache-Control")).toBe("no-store");
    const retryOnceBody: unknown = await retryOnce.json();
    const retryAgainBody: unknown = await retryAgain.json();
    expect(retryOnceBody).toEqual(retryAgainBody);
    expect(retryAgainBody).toMatchObject({
      runId: "run-safe",
      state: "completed",
      publication: { state: "published", outcomePersistence: "finalized" },
    });
    expect(calls).toContainEqual({
      requestId: "request-safe",
      precondition: "opaque-token",
      noteTransmissionAuthorized: false,
    });
    expect(calls).toContainEqual({ runId: "run-safe" });
    for (const suffix of ["run-preview", "run", "cancel", "active-run", "publication/retry"]) {
      expect(
        operations.find((operation) => operation.invocation.path.endsWith(`/semantic/${suffix}`)),
      ).toBeDefined();
    }
  });

  test("Run preview validates and forwards only explicit supported budget query values", async () => {
    const previews: unknown[] = [];
    const controller = {
      preview: async (budget: unknown) => {
        await Promise.resolve();
        previews.push(budget);
        return { status: 200, body: { limits: budget } };
      },
    } as unknown as NonNullable<RedundancyRoutesDeps["jevRunController"]>;
    const { app } = harness(undefined, controller);

    const invalid = await app.request(
      "/api/redundancy/semantic/run-preview?maxProviderAttempts=75001",
    );
    expect(invalid.status).toBe(400);
    expect(previews).toHaveLength(0);

    const valid = await app.request(
      "/api/redundancy/semantic/run-preview?maxProviderAttempts=501&reportedTokenStopThreshold=40000&maxRunDurationMs=60000",
    );
    expect(valid.status).toBe(200);
    expect(previews).toEqual([
      {
        maxProviderAttempts: 501,
        reportedTokenStopThreshold: 40_000,
        maxRunDurationMs: 60_000,
      },
    ]);
  });

  test("Run preview strictly freezes collection, all-wishlist, and repeated selected IDs", async () => {
    const collectionCalls: unknown[] = [];
    const wishlistCalls: unknown[] = [];
    const controller = {
      preview: (budget: unknown) => {
        collectionCalls.push(budget);
        return Promise.resolve({ status: 200 as const, body: { requestId: "collection-preview" } });
      },
      previewWishlist: (selection: unknown, budget: unknown) => {
        wishlistCalls.push({ selection, budget });
        return Promise.resolve({
          status: 200 as const,
          body: { requestId: "wishlist-preview", selection },
        });
      },
    } as unknown as NonNullable<RedundancyRoutesDeps["jevRunController"]>;
    const { app, operations } = harness(undefined, controller);

    expect((await app.request("/api/redundancy/semantic/run-preview")).status).toBe(200);
    expect(
      (await app.request("/api/redundancy/semantic/run-preview?scope=collection")).status,
    ).toBe(200);
    expect((await app.request("/api/redundancy/semantic/run-preview?scope=wishlist")).status).toBe(
      200,
    );
    const selected = await app.request(
      "/api/redundancy/semantic/run-preview?scope=wishlist&bggId=902&bggId=101",
    );
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({
      requestId: "wishlist-preview",
      selection: { kind: "selected", bggIds: [101, 902] },
    });
    expect(collectionCalls).toHaveLength(2);
    expect(wishlistCalls).toHaveLength(2);
    expect(wishlistCalls[0]).toMatchObject({
      selection: undefined,
      budget: DEFAULT_JEV_RUN_BUDGET,
    });
    expect(wishlistCalls[1]).toMatchObject({
      selection: { kind: "selected", bggIds: [101, 902] },
      budget: DEFAULT_JEV_RUN_BUDGET,
    });
    const previewOperation = operations.find(
      (operation) => operation.operationId === "shelf.redundancy.get-semantic-run-preview",
    );
    expect(
      previewOperation?.parameters?.some(
        (parameter) => parameter.name === "scope" && parameter.in === "query",
      ),
    ).toBe(true);
    expect(
      previewOperation?.parameters?.some(
        (parameter) => parameter.name === "bggId" && parameter.in === "query",
      ),
    ).toBe(true);
    const previewProperties = previewOperation?.response?.body.properties;
    expect(previewProperties).not.toHaveProperty("retentionCaveat");
    expect(previewOperation?.response?.body.required).not.toContain("retentionCaveat");
    const startOperation = operations.find(
      (operation) => operation.operationId === "shelf.redundancy.start-semantic-run",
    );
    expect(startOperation?.request?.body.properties).not.toHaveProperty("scope");
    expect(startOperation?.request?.body.properties).not.toHaveProperty("bggId");

    const invalidQueries = [
      "scope=wishlist&scope=collection",
      "scope=wishlist&bggId=101&bggId=101",
      "scope=wishlist&bggId=0",
      "scope=wishlist&bggId=",
      "bggId=101",
      "scope=collection&bggId=101",
      "scope=unknown",
      "scope=wishlist&unexpected=true",
    ];
    for (const query of invalidQueries) {
      const response = await app.request(`/api/redundancy/semantic/run-preview?${query}`);
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(collectionCalls).toHaveLength(2);
    expect(wishlistCalls).toHaveLength(2);
  });

  test("new Run routes fail closed when no controller is composed", async () => {
    const { app } = harness();
    const requests: [string, RequestInit?][] = [
      ["/api/redundancy/semantic/run-preview"],
      [
        "/api/redundancy/semantic/run",
        json({ requestId: "r", precondition: "p", noteTransmissionAuthorized: false }),
      ],
      ["/api/redundancy/semantic/cancel", json({ runId: "r" })],
      ["/api/redundancy/semantic/active-run"],
      ["/api/redundancy/semantic/publication/retry", json({ runId: "r" })],
    ];
    for (const [path, init] of requests) {
      const response = await app.request(path, init);
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("ETag")).toBeNull();
    }
  });

  test("controller failure details are never reflected by Run routes", async () => {
    const controller = {
      preview: async () => {
        await Promise.resolve();
        return { status: 503, body: { error: "private preview failure" } };
      },
      start: async () => {
        await Promise.resolve();
        return { status: 412, body: { error: "private precondition detail" } };
      },
      cancel: () => ({ status: 404, body: { error: "private run identifier detail" } }),
      activeRun: () => null,
    } as unknown as NonNullable<RedundancyRoutesDeps["jevRunController"]>;
    const { app } = harness(undefined, controller);
    const responses = [
      await app.request("/api/redundancy/semantic/run-preview"),
      await app.request(
        "/api/redundancy/semantic/run",
        json({ requestId: "r", precondition: "p", noteTransmissionAuthorized: false }),
      ),
      await app.request("/api/redundancy/semantic/cancel", json({ runId: "r" })),
    ];
    expect(responses.map(({ status }) => status)).toEqual([503, 412, 409]);
    for (const response of responses) {
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(JSON.stringify(await response.json())).not.toContain("private");
    }
  });
});
