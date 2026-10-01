import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createInitialSemanticRedundancyStateV10, type Collection } from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import type { JevStatusResponse } from "../src/services/jev-pair-status";
import type { createJevStatusService } from "../src/services/jev-status-service";
import { createRedundancyRoutes } from "../src/routes/redundancy";
import { createSettingsRouteStorageStub } from "./helpers/settings-route-storage";

function harness(jevStatusService?: Pick<ReturnType<typeof createJevStatusService>, "read">) {
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
  const route = createRedundancyRoutes({ storageService: storage, jevStatusService });
  const app = new Hono();
  app.route("/api", route.routes);
  return { app, collection, operations: route.operations };
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("semantic redundancy safety quarantine", () => {
  test("V10 factual-only state is not-ready and does not disclose semantic output", async () => {
    const { app, collection } = harness();
    collection.semanticRedundancy.settings.enabled = true;
    const settings = await app.request("/api/redundancy/settings");
    const summary = await app.request("/api/redundancy/semantic/summary");
    expect(await settings.json()).toMatchObject({
      semantic: { status: { status: "not-ready", publicationStatus: "not-ready" } },
    });
    expect(await summary.json()).toMatchObject({
      status: "not-ready",
      generation: null,
      disclosure: null,
    });
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

  test("legacy inference endpoints are explicitly unavailable", async () => {
    const { app } = harness();
    const requests: [string, RequestInit][] = [
      ["/api/redundancy/semantic/disclosure", json({ signalScope: "description-only" })],
      ["/api/redundancy/semantic/disclosure/page", json({ manifestId: "m", offset: 0 })],
      ["/api/redundancy/semantic/acknowledge-and-start", json({ manifestId: "m" })],
      ["/api/redundancy/semantic/cancel", json({ commandId: "m" })],
    ];
    for (const [path, init] of requests) {
      const response = await app.request(path, init);
      expect(response.status).toBe(503);
      const responseBody = (await response.json()) as { error: string };
      expect(responseBody.error).toContain("unavailable");
    }
  });

  test("refresh-status returns only aggregate DTO fields with no-store and never invokes inference", async () => {
    let reads = 0;
    const response: JevStatusResponse = {
      status: "not-ready",
      measurement: "current",
      eligibleGameCount: 2,
      pairCount: 1,
      coverage: {
        C: { covered: 0, missing: 1, invalid: 0, unavailable: 0, blocked: 0 },
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
    ).toMatchObject({ invocation: { method: "GET" }, idempotent: true });
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
});
