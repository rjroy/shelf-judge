import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createInitialSemanticRedundancyState, type Collection } from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import type { SemanticRefreshRuntime } from "../src/services/semantic-refresh-runtime";
import { createRedundancyRoutes } from "../src/routes/redundancy";
import { createSettingsRouteStorageStub } from "./helpers/settings-route-storage";
import {
  semanticGenerationFixture,
  semanticSourceIdentityFixture,
} from "./helpers/semantic-redundancy-fixtures";

function harness(runtime?: SemanticRefreshRuntime) {
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
  const route = createRedundancyRoutes({ storageService: storage, semanticRuntime: runtime });
  const app = new Hono();
  app.route("/api", route.routes);
  return { app, collection, operations: route.operations };
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error("Expected a JSON object response");
  return value;
}

function arrayProperty(value: Record<string, unknown>, key: string): unknown[] {
  const property = value[key];
  if (!Array.isArray(property)) throw new Error(`Expected ${key} to be an array`);
  return property;
}

describe("semantic redundancy routes", () => {
  test("settings, summary, and refresh status expose stale publication separately from completed execution", async () => {
    const runtime = {
      status: () =>
        Promise.resolve({
          status: "completed",
          publicationStatus: "stale",
          manifest: {
            id: "manifest",
            digest: "a".repeat(64),
            sourceIdentity: semanticSourceIdentityFixture({ collectionId: "semantic-route-test" }),
            signalScope: "description-only",
            providerId: "provider",
            modelId: "model",
            rubricVersion: 1,
            budget: { maxRequests: 1, maxTokens: 10, maxDurationMs: 1000 },
            expiresAt: "2099-01-01T00:00:00.000Z",
            eligibleGameIds: [],
          },
          execution: {
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            deadlineAt: "2026-01-01T00:01:00.000Z",
            attemptCount: 1,
            completedPairCount: 1,
            failedPairCount: 0,
          },
        }),
    } as unknown as SemanticRefreshRuntime;
    const { app, collection } = harness(runtime);
    collection.semanticRedundancy.settings.enabled = true;
    collection.semanticRedundancy.publishedGeneration = semanticGenerationFixture({
      id: "generation",
      sourceIdentity: semanticSourceIdentityFixture({ collectionId: collection.id }),
    });

    const settings = await app.request("/api/redundancy/settings");
    const summary = await app.request("/api/redundancy/semantic/summary");
    const refresh = await app.request("/api/redundancy/semantic/refresh-status");
    const settingsBody = await responseJson(settings);
    if (!isRecord(settingsBody.semantic)) throw new Error("Expected semantic settings object");
    expect(settingsBody.semantic.status).toMatchObject({ status: "stale" });
    expect(await responseJson(summary)).toMatchObject({ status: "stale" });
    expect(await responseJson(refresh)).toMatchObject({
      status: "stale",
      execution: { status: "completed" },
    });
  });

  test("strict semantic settings are separate and persist to collection state", async () => {
    const { app, collection } = harness();
    const invalid = await app.request("/api/redundancy/semantic-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, provider: "caller" }),
    });
    expect(invalid.status).toBe(400);
    expect(collection.semanticRedundancy.settings.enabled).toBe(false);
    const valid = await app.request("/api/redundancy/semantic-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        cachedOwnerNoteUse: true,
        weights: { description: 0.3 },
      }),
    });
    expect(valid.status).toBe(200);
    expect(collection.semanticRedundancy.settings).toEqual({
      enabled: true,
      cachedOwnerNoteUse: true,
      weights: { factual: 7, description: 0.3, ownerNote: 0 },
    });
  });

  test("ordinary reads and settings updates cannot launch refresh work", async () => {
    let calls = 0;
    const runtime = {
      capture: () => {
        calls++;
        return Promise.reject(new Error("not expected"));
      },
      deliverPage: () => {
        calls++;
        return Promise.reject(new Error("not expected"));
      },
      start: () => {
        calls++;
        return Promise.reject(new Error("not expected"));
      },
      status: () => Promise.resolve({ status: "not-ready" as const }),
      cancel: () => {
        calls++;
        return Promise.reject(new Error("not expected"));
      },
      recoverOrphanedRun: () => Promise.resolve(),
      isStartReceiptCurrentProcess: () => false,
    } as unknown as SemanticRefreshRuntime;
    const { app } = harness(runtime);
    expect((await app.request("/api/redundancy/settings")).status).toBe(200);
    expect((await app.request("/api/redundancy/semantic/summary")).status).toBe(200);
    expect((await app.request("/api/redundancy/semantic/refresh-status")).status).toBe(200);
    expect(
      (
        await app.request("/api/redundancy/semantic-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        })
      ).status,
    ).toBe(200);
    expect(calls).toBe(0);
  });

  test("disclosure page exposes exact IDs and flags only, with bounded receipt", async () => {
    const runtime = {
      capture: () => Promise.resolve({ outcome: "not-authorized" }),
      deliverPage: () =>
        Promise.resolve({
          outcome: "accepted",
          value: {
            manifestId: "m",
            manifestDigest: "a".repeat(64),
            offset: 0,
            nextOffset: 1,
            complete: true,
            pairs: [
              {
                gameA: "a",
                gameB: "b",
                hasDescriptionA: true,
                hasDescriptionB: false,
                hasOwnerNoteA: true,
                hasOwnerNoteB: true,
                descriptionFingerprintA: "secret",
                descriptionFingerprintB: null,
                noteVersionA: 2,
                noteVersionB: 3,
              },
            ],
            receipt: { pageIndex: 0, nextOffset: 1, complete: true },
          },
        }),
      start: () => Promise.resolve({ outcome: "not-authorized" }),
      status: () => Promise.resolve({ status: "not-ready" }),
      cancel: () => Promise.resolve({ outcome: "invalid-state" }),
      recoverOrphanedRun: () => Promise.resolve(),
      isStartReceiptCurrentProcess: () => false,
    } as unknown as SemanticRefreshRuntime;
    const { app } = harness(runtime);
    const response = await app.request(
      "/api/redundancy/semantic/disclosure/page",
      json({ manifestId: "m", manifestDigest: "a".repeat(64), offset: 0 }),
    );
    expect(response.status).toBe(200);
    const result = await responseJson(response);
    expect(arrayProperty(result, "pairs")).toEqual([
      {
        gameA: "a",
        gameB: "b",
        hasDescriptionA: true,
        hasDescriptionB: false,
        hasOwnerNoteA: true,
        hasOwnerNoteB: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(
      (
        await app.request(
          "/api/redundancy/semantic/disclosure/page",
          json({ manifestId: "m", manifestDigest: "a", offset: 0, pairs: [] }),
        )
      ).status,
    ).toBe(400);
  });

  test("disclosure requires a scope, accepts only bounded reductions, and returns effective scope and cap", async () => {
    const calls: unknown[] = [];
    const manifest = {
      id: "manifest-1",
      digest: "a".repeat(64),
      signalScope: "owner-notes-only",
      providerId: "fixed-provider",
      modelId: "fixed-model",
      budget: { maxRequests: 3, maxTokens: 1000, maxDurationMs: 5000 },
      expiresAt: "2099-01-01T00:00:00.000Z",
      eligibleGameIds: ["a", "b"],
      pairs: [{ hasOwnerNoteA: true, hasOwnerNoteB: true }],
    };
    const runtime = {
      capture: (input: unknown) => {
        calls.push(input);
        return Promise.resolve({
          outcome: "accepted",
          value: { id: manifest.id, digest: manifest.digest },
        });
      },
      deliverPage: () => Promise.resolve({ outcome: "invalid-state" }),
      start: () => Promise.resolve({ outcome: "not-authorized" }),
      status: () => Promise.resolve({ status: "not-ready" }),
      cancel: () => Promise.resolve({ outcome: "invalid-state" }),
      recoverOrphanedRun: () => Promise.resolve(),
      isStartReceiptCurrentProcess: () => false,
    } as unknown as SemanticRefreshRuntime;
    const { app, collection } = harness(runtime);
    collection.semanticRedundancy.disclosureManifest = manifest as never;

    expect((await app.request("/api/redundancy/semantic/disclosure", json({}))).status).toBe(400);
    expect(
      (
        await app.request(
          "/api/redundancy/semantic/disclosure",
          json({ signalScope: "description-only", providerId: "caller" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/api/redundancy/semantic/disclosure",
          json({ signalScope: "description-only", budget: { maxTokens: 250_000_001 } }),
        )
      ).status,
    ).toBe(400);

    const response = await app.request(
      "/api/redundancy/semantic/disclosure",
      json({ signalScope: "owner-notes-only", budget: { maxRequests: 3, maxTokens: 1000 } }),
    );
    expect(response.status).toBe(201);
    expect(calls).toEqual([
      {
        signalScope: "owner-notes-only",
        budget: { maxRequests: 3, maxTokens: 1000 },
      },
    ]);
    expect(await responseJson(response)).toMatchObject({
      signalScope: "owner-notes-only",
      budget: { maxRequests: 3, maxTokens: 1000, maxDurationMs: 5000 },
      eligibleGameCount: 2,
    });
  });

  test("acknowledgement reports replay and maps stale, expired, and refusal outcomes", async () => {
    const calls: unknown[] = [];
    const runtime = {
      capture: () => Promise.resolve({ outcome: "not-authorized" }),
      deliverPage: () => Promise.resolve({ outcome: "invalid-state" }),
      start: (input: unknown) => {
        calls.push(input);
        return Promise.resolve({
          outcome: "accepted",
          value: {
            disposition: "REPLAYED",
            status: "running",
            commandId: "manifest-1",
            deadlineAt: "2099-01-01T00:00:00.000Z",
          },
        });
      },
      status: () => Promise.resolve({ status: "not-ready" }),
      cancel: () => Promise.resolve({ outcome: "invalid-state" }),
      recoverOrphanedRun: () => Promise.resolve(),
      isStartReceiptCurrentProcess: () => false,
    } as unknown as SemanticRefreshRuntime;
    const { app, collection } = harness(runtime);
    const manifest = {
      id: "manifest-1",
      digest: "b".repeat(64),
      sourceIdentity: {
        collectionId: collection.id,
        collectionSchemaVersion: 9 as const,
        collectionRevision: 0,
        evidenceEpoch: 0,
        consentEpoch: 0,
        factualWeightsEpoch: 0,
        factualWeightsFingerprint: null,
        tournamentHash: "c".repeat(64),
        predictionSettingsHash: "d".repeat(64),
        redundancySettingsHash: "e".repeat(64),
      },
      scoringVersion: 1,
      signalScope: "description-only" as const,
      providerId: "test-provider",
      modelId: "test-model",
      rubricVersion: 1,
      budget: { maxRequests: 1, maxTokens: 10, maxDurationMs: 1000 },
      expiresAt: "2099-01-01T00:00:00.000Z",
      eligibleGameIds: [],
      pairs: [],
    };
    collection.semanticRedundancy.disclosureManifest = manifest;
    const startRequest = () =>
      app.request(
        "/api/redundancy/semantic/acknowledge-and-start",
        json({
          manifestId: manifest.id,
          manifestDigest: manifest.digest,
          pairCount: 0,
          transmissionAuthorized: true,
          noteTransmissionAuthorized: false,
          cachedOwnerNoteUseAuthorized: false,
        }),
      );
    const replay = await startRequest();
    expect(replay.status).toBe(200);
    expect(await responseJson(replay)).toMatchObject({
      disposition: "REPLAYED",
      status: "running",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      transmissionAuthorized: true,
      noteTransmissionAuthorized: false,
      cachedOwnerNoteUseAuthorized: false,
    });

    for (const [outcome, expectedStatus] of [
      ["stale", 409],
      ["invalid-state", 400],
      ["not-authorized", 403],
    ] as const) {
      const failingRuntime = {
        ...runtime,
        start: () => Promise.resolve({ outcome }),
      } as unknown as SemanticRefreshRuntime;
      const { app: failingApp, collection: failingCollection } = harness(failingRuntime);
      failingCollection.semanticRedundancy.disclosureManifest = {
        ...manifest,
        sourceIdentity: { ...manifest.sourceIdentity, collectionId: failingCollection.id },
      };
      const response = await failingApp.request(
        "/api/redundancy/semantic/acknowledge-and-start",
        json({
          manifestId: manifest.id,
          manifestDigest: manifest.digest,
          pairCount: 0,
          transmissionAuthorized: true,
          noteTransmissionAuthorized: false,
          cachedOwnerNoteUseAuthorized: false,
        }),
      );
      expect(response.status).toBe(expectedStatus);
    }
  });

  test("all semantic operations are discoverable and missing runtime fails closed", async () => {
    const { app, operations } = harness();
    expect(operations.map(({ operationId }) => operationId)).toContain(
      "shelf.redundancy.acknowledge-and-start-semantic-refresh",
    );
    expect(
      (
        await app.request(
          "/api/redundancy/semantic/disclosure",
          json({ signalScope: "description-only" }),
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await app.request(
          "/api/redundancy/semantic/acknowledge-and-start",
          json({ manifestId: "m" }),
        )
      ).status,
    ).toBe(400);
  });
});
