import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createInitialSemanticRedundancyState, type Collection } from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import { createRedundancyRoutes } from "../src/routes/redundancy";
import { createSettingsRouteStorageStub } from "./helpers/settings-route-storage";
import { semanticGenerationFixture } from "./helpers/semantic-redundancy-fixtures";

function harness() {
  const collection: Collection = {
    schemaVersion: 9,
    revision: 0,
    id: "semantic-route-test",
    name: "Test",
    axes: [],
    games: [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: createInitialSemanticRedundancyState(),
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
  const route = createRedundancyRoutes({ storageService: storage });
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
  test("v9 published generation is not disclosed as active or stale semantic output", async () => {
    const { app, collection } = harness();
    collection.semanticRedundancy.settings.enabled = true;
    collection.semanticRedundancy.publishedGeneration = semanticGenerationFixture({
      id: "legacy-generation",
    });

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
});
