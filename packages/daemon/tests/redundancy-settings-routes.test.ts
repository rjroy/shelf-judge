import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createRedundancyRoutes } from "../src/routes/redundancy";
import type { RedundancySettings } from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../src/services/redundancy-engine";

function createMockStorageService(): StorageService & { settings: RedundancySettings } {
  const mock = {
    settings: { ...DEFAULT_REDUNDANCY_SETTINGS } as RedundancySettings,
    loadRedundancySettings() {
      return Promise.resolve(structuredClone(mock.settings));
    },
    saveRedundancySettings(s: RedundancySettings) {
      mock.settings = structuredClone(s);
      return Promise.resolve();
    },
    // Stubs for unused StorageService methods
    loadCollection: () => Promise.reject(new Error("not implemented")),
    saveCollection: () => Promise.resolve(),
    loadConfig: () => Promise.reject(new Error("not implemented")),
    saveConfig: () => Promise.resolve(),
    loadTournament: () => Promise.reject(new Error("not implemented")),
    saveTournament: () => Promise.resolve(),
    loadProfile: () => Promise.resolve(null),
    saveProfile: () => Promise.resolve(),
    loadPredictionSettings: () =>
      Promise.resolve({
        stageThresholds: [5, 15, 30] as [number, number, number],
        defaultK: 5,
        minSimilarityThreshold: 0.2,
        tournamentStabilityBoost: 0.2,
      }),
    savePredictionSettings: () => Promise.resolve(),
    loadNicheSettings: () => Promise.resolve({ ignoredTags: [] }),
    saveNicheSettings: () => Promise.resolve(),
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
      expect(body.componentWeights).toEqual({ binary: 0.4, continuous: 0.3, personalAxes: 0.3 });
    });

    test("returns current settings", async () => {
      storage.settings = { ...DEFAULT_REDUNDANCY_SETTINGS, enabled: true, stage: "integrated" };
      const res = await app.request("/api/redundancy/settings");
      expect(res.status).toBe(200);
      const body = (await res.json()) as RedundancySettings;
      expect(body.enabled).toBe(true);
      expect(body.stage).toBe("integrated");
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
        patchRequest({ componentWeights: { binary: -0.1, continuous: 0.5, personalAxes: 0.5 } }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("binary");
    });

    test("validates componentWeights sum > 0", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ componentWeights: { binary: 0, continuous: 0, personalAxes: 0 } }),
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
      expect(body.componentWeights.continuous).toBe(0.3); // unchanged
      expect(body.componentWeights.personalAxes).toBe(0.3); // unchanged
    });

    test("strips unknown properties from patch", async () => {
      const res = await app.request(
        "/api/redundancy/settings",
        patchRequest({ enabled: true, unknownField: "should be stripped" }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.enabled).toBe(true);
      expect(body).not.toHaveProperty("unknownField");
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
