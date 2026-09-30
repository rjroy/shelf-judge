import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createRedundancyRoutes } from "../src/routes/redundancy";
import {
  createInitialSemanticRedundancyState,
  type Collection,
  type RedundancySettings,
} from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../src/services/redundancy-engine";
import { createSettingsRouteStorageStub } from "./helpers/settings-route-storage";
import { canonicalSha256 } from "../src/services/profile-source-coordinator";
import { DurableSourcePostCommitError } from "../src/services/storage-service";
import {
  semanticGenerationFixture,
  semanticSourceIdentityFixture,
} from "./helpers/semantic-redundancy-fixtures";

function createMockStorageService(): StorageService & {
  settings: RedundancySettings;
  migrationNotice: string | null;
  collection: Collection;
  collectionWrites: number;
  settingsWrites: number;
  failCollectionSave: boolean;
  failSettingsSave: boolean;
} {
  const initialTime = "2026-01-01T00:00:00.000Z";
  const mock = {
    ...createSettingsRouteStorageStub(),
    settings: { ...DEFAULT_REDUNDANCY_SETTINGS },
    migrationNotice: null as string | null,
    collection: {
      schemaVersion: 9 as const,
      revision: 0,
      id: "route-test-collection",
      name: "Route test",
      axes: [],
      games: [],
      intentions: [],
      attentionDispositions: [],
      commandReceipts: [],
      entertainmentBenchmark: null,
      semanticRedundancy: createInitialSemanticRedundancyState(),
      createdAt: initialTime,
      updatedAt: initialTime,
    } as Collection,
    collectionWrites: 0,
    settingsWrites: 0,
    failCollectionSave: false,
    failSettingsSave: false,
    loadCollection() {
      return Promise.resolve(structuredClone(mock.collection));
    },
    saveCollection(collection: Collection) {
      mock.collectionWrites += 1;
      if (mock.failCollectionSave) return Promise.reject(new Error("collection write failed"));
      mock.collection = structuredClone(collection);
      return Promise.resolve();
    },
    loadRedundancySettings() {
      return Promise.resolve(structuredClone(mock.settings));
    },
    loadRedundancySettingsRead() {
      return Promise.resolve({
        settings: structuredClone(mock.settings),
        migrationNotice: mock.migrationNotice,
      });
    },
    saveRedundancySettings(s: RedundancySettings) {
      mock.settingsWrites += 1;
      if (mock.failSettingsSave) return Promise.reject(new Error("settings write failed"));
      mock.settings = structuredClone(s);
      return Promise.resolve();
    },
  };
  return mock;
}

function patchRequest(body: unknown) {
  return {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("redundancy settings routes", () => {
  let app: Hono;
  let storage: ReturnType<typeof createMockStorageService>;

  beforeEach(() => {
    storage = createMockStorageService();
    const { routes } = createRedundancyRoutes({ storageService: storage });
    app = new Hono();
    app.route("/api", routes);
  });

  describe("GET /api/redundancy/settings", () => {
    test("returns defaults when no file exists", async () => {
      const res = await app.request("/api/redundancy/settings");
      expect(res.status).toBe(200);
      const body = (await res.json()) as RedundancySettings;
      expect(body.enabled).toBe(false);
      expect(body.stage).toBe("annotation");
      expect(body.similarityThreshold).toBe(0.6);
      expect(body.maxPenalty).toBe(2.0);
      expect(body.minNeighbors).toBe(1);
      expect(body.componentWeights).toEqual({ binary: 4 / 7, continuous: 3 / 7 });
    });

    test("returns current settings", async () => {
      storage.settings = { ...DEFAULT_REDUNDANCY_SETTINGS, enabled: true, stage: "integrated" };
      const res = await app.request("/api/redundancy/settings");
      expect(res.status).toBe(200);
      const body = (await res.json()) as RedundancySettings;
      expect(body.enabled).toBe(true);
      expect(body.stage).toBe("integrated");
    });

    test("includes legacy factual-weight migration notice", async () => {
      storage.migrationNotice = "Legacy weights migrated to factual 4:3.";
      const res = await app.request("/api/redundancy/settings");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        componentWeights: { binary: 4 / 7, continuous: 3 / 7 },
        migrationNotice: "Legacy weights migrated to factual 4:3.",
      });
    });
  });

  describe("PATCH /api/redundancy/settings", () => {
    test("merges partial updates correctly", async () => {
      const res = await app.request("/api/redundancy/settings", patchRequest({ enabled: true }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as RedundancySettings;
      expect(body.enabled).toBe(true);
      expect(body.stage).toBe("annotation"); // unchanged
      expect(body.similarityThreshold).toBe(0.6); // unchanged
      expect(storage.settings.enabled).toBe(true);
    });

    test("updates stage", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ stage: "integrated" }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as RedundancySettings;
      expect(body.stage).toBe("integrated");
    });

    test("rejects invalid stage", async () => {
      const res = await app.request("/api/redundancy/settings", patchRequest({ stage: "invalid" }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("stage");
    });

    test("rejects non-boolean enabled", async () => {
      const res = await app.request("/api/redundancy/settings", patchRequest({ enabled: "yes" }));
      expect(res.status).toBe(400);
    });

    test("validates similarityThreshold lower bound", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ similarityThreshold: -0.1 }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("similarityThreshold");
    });

    test("validates similarityThreshold upper bound", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ similarityThreshold: 1.5 }),
      );
      expect(res.status).toBe(400);
    });

    test("accepts similarityThreshold at boundaries", async () => {
      let res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ similarityThreshold: 0.0 }),
      );
      expect(res.status).toBe(200);

      res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ similarityThreshold: 1.0 }),
      );
      expect(res.status).toBe(200);
    });

    test("validates maxPenalty lower bound", async () => {
      const res = await app.request("/api/redundancy/settings", patchRequest({ maxPenalty: 0.1 }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("maxPenalty");
    });

    test("validates maxPenalty upper bound", async () => {
      const res = await app.request("/api/redundancy/settings", patchRequest({ maxPenalty: 6.0 }));
      expect(res.status).toBe(400);
    });

    test("accepts maxPenalty at boundaries", async () => {
      let res = await app.request("/api/redundancy/settings", patchRequest({ maxPenalty: 0.5 }));
      expect(res.status).toBe(200);

      res = await app.request("/api/redundancy/settings", patchRequest({ maxPenalty: 5.0 }));
      expect(res.status).toBe(200);
    });

    test("validates minNeighbors >= 1", async () => {
      const res = await app.request("/api/redundancy/settings", patchRequest({ minNeighbors: 0 }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("minNeighbors");
    });

    test("rejects non-integer minNeighbors", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ minNeighbors: 1.5 }),
      );
      expect(res.status).toBe(400);
    });

    test("validates componentWeights values >= 0", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: -0.1, continuous: 0.5 } }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("binary");
    });

    test("validates componentWeights sum > 0", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: 0, continuous: 0 } }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("sum");
    });

    test("partial componentWeights merge with current", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: 0.8 } }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as RedundancySettings;
      expect(body.componentWeights.binary).toBe(0.8);
      expect(body.componentWeights.continuous).toBe(3 / 7); // unchanged
    });

    test("rejects personal-axis redundancy weights", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: 1, continuous: 0, personalAxes: 2 } }),
      );
      expect(res.status).toBe(400);
    });

    test("strictly rejects unknown and semantic properties", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ enabled: true, unknownField: "should be stripped" }),
      );
      expect(res.status).toBe(400);
      expect(storage.settings.enabled).toBe(false);

      const semantic = await app.request(
        "/api/redundancy/settings",
        patchRequest({ semanticRedundancy: { enabled: true } }),
      );
      expect(semantic.status).toBe(400);
      const nested = await app.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: 1, continuous: 1, semantic: 4 } }),
      );
      expect(nested.status).toBe(400);
    });

    test("weight PATCH commits collection fence before settings and aborts on collection failure", async () => {
      storage.failCollectionSave = true;
      const response = await app.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: 0.8 } }),
      );
      expect(response.status).toBe(500);
      expect(storage.collectionWrites).toBe(1);
      expect(storage.settingsWrites).toBe(0);
      expect(storage.settings.componentWeights).toEqual(
        DEFAULT_REDUNDANCY_SETTINGS.componentWeights,
      );
    });

    test("settings failure leaves old file with semantic generation already withdrawn", async () => {
      storage.collection.semanticRedundancy.publishedGeneration = semanticGenerationFixture({
        id: "generation-1",
        sourceIdentity: semanticSourceIdentityFixture({ collectionId: storage.collection.id }),
      });
      storage.collection.semanticRedundancy.authorization = {
        id: "authorization-1",
        manifestDigest: "a".repeat(64),
        evidenceEpoch: 0,
        consentEpoch: 0,
        pairCount: 0,
        notePairCount: 0,
        expiresAt: "2099-01-01T00:00:00.000Z",
        state: "active",
      };
      storage.collection.semanticRedundancy.disclosure = {
        id: "authorization-1",
        manifestDigest: "a".repeat(64),
        evidenceEpoch: 0,
        consentEpoch: 0,
        pairCount: 0,
        notePairCount: 0,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
      storage.failSettingsSave = true;

      const response = await app.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: 0.8 } }),
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        factualSettingsPersisted: false,
        semanticGenerationWithdrawn: true,
      });
      expect(storage.settings.componentWeights).toEqual(
        DEFAULT_REDUNDANCY_SETTINGS.componentWeights,
      );
      expect(storage.collection.semanticRedundancy.factualWeightsEpoch).toBe(1);
      expect(storage.collection.semanticRedundancy.publishedGeneration).toBeNull();
      expect(storage.collection.semanticRedundancy.authorization?.state).toBe("revoked");
    });

    test("reports a durable factual settings write when profile invalidation fails afterward", async () => {
      storage.saveRedundancySettings = (settings) => {
        storage.settings = structuredClone(settings);
        storage.settingsWrites += 1;
        return Promise.reject(new DurableSourcePostCommitError("profile invalidation failed"));
      };
      const response = await app.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: 0.8 } }),
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        factualSettingsPersisted: true,
        semanticGenerationWithdrawn: true,
        profileInvalidationFailed: true,
      });
      expect(storage.settings.componentWeights.binary).toBe(0.8);
      expect(storage.collection.semanticRedundancy.publishedGeneration).toBeNull();
    });

    test("stage-only factual settings retain semantic generation and do not write collection", async () => {
      storage.collection.semanticRedundancy.publishedGeneration = semanticGenerationFixture({
        id: "generation-1",
        sourceIdentity: semanticSourceIdentityFixture({ collectionId: storage.collection.id }),
      });
      const response = await app.request(
        "/api/redundancy/settings",
        patchRequest({ stage: "integrated" }),
      );
      expect(response.status).toBe(200);
      expect(storage.collectionWrites).toBe(0);
      expect(storage.collection.semanticRedundancy.publishedGeneration?.id).toBe("generation-1");
    });

    test("factual weights A to B to A advance a durable fence across route restart", async () => {
      storage.collection.semanticRedundancy.publishedGeneration = semanticGenerationFixture({
        id: "generation-before-A-B-A",
        sourceIdentity: semanticSourceIdentityFixture({ collectionId: storage.collection.id }),
      });
      const first = await app.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: 0.8 } }),
      );
      expect(first.status).toBe(200);
      const afterB = storage.collection.semanticRedundancy.factualWeightsEpoch;
      const fingerprintB = storage.collection.semanticRedundancy.factualWeightsFingerprint;
      expect(afterB).toBe(1);
      expect(storage.collection.semanticRedundancy.publishedGeneration).toBeNull();

      const { routes } = createRedundancyRoutes({ storageService: storage });
      const restarted = new Hono();
      restarted.route("/api", routes);
      const backToA = await restarted.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: 4 / 7 } }),
      );
      expect(backToA.status).toBe(200);
      expect(storage.collection.semanticRedundancy.factualWeightsEpoch).toBe(2);
      expect(storage.collection.semanticRedundancy.factualWeightsFingerprint).not.toBe(
        fingerprintB,
      );
      expect(storage.collection.semanticRedundancy.factualWeightsFingerprint).toBe(
        canonicalSha256({ binary: 4 / 7, continuous: 3 / 7 }),
      );
      expect(storage.collection.semanticRedundancy.publishedGeneration).toBeNull();
    });

    test("rejects non-object body", async () => {
      const res = await app.request("/api/redundancy/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("not-an-object"),
      });
      expect(res.status).toBe(400);
    });

    test("rejects invalid JSON", async () => {
      const res = await app.request("/api/redundancy/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });
});
