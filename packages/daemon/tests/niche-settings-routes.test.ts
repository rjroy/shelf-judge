import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createNicheRoutes } from "../src/routes/niche";
import type { NicheSettings } from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";

function createMockStorageService(): StorageService & { settings: NicheSettings } {
  const mock = {
    settings: { ignoredTags: [] } as NicheSettings,
    loadNicheSettings() {
      return Promise.resolve(structuredClone(mock.settings));
    },
    saveNicheSettings(s: NicheSettings) {
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
  };
  return mock;
}

describe("niche settings routes", () => {
  let app: Hono;
  let storage: ReturnType<typeof createMockStorageService>;

  beforeEach(() => {
    storage = createMockStorageService();
    const { routes } = createNicheRoutes({ storageService: storage });
    app = new Hono();
    app.route("/api", routes);
  });

  describe("GET /api/niches/settings", () => {
    test("returns defaults when no file exists", async () => {
      const res = await app.request("/api/niches/settings");
      expect(res.status).toBe(200);
      const body = (await res.json()) as NicheSettings;
      expect(body).toEqual({ ignoredTags: [] });
    });

    test("returns current settings", async () => {
      storage.settings = { ignoredTags: [{ type: "mechanic", name: "Deck Building" }] };
      const res = await app.request("/api/niches/settings");
      expect(res.status).toBe(200);
      const body = (await res.json()) as NicheSettings;
      expect(body.ignoredTags).toHaveLength(1);
      expect(body.ignoredTags[0]).toEqual({ type: "mechanic", name: "Deck Building" });
    });
  });

  describe("PATCH /api/niches/settings", () => {
    test("adds ignored tags", async () => {
      const res = await app.request("/api/niches/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ignoredTags: [{ type: "family", name: "Crowdfunding: Kickstarter" }],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as NicheSettings;
      expect(body.ignoredTags).toHaveLength(1);
      expect(storage.settings.ignoredTags).toHaveLength(1);
    });

    test("rejects invalid type", async () => {
      const res = await app.request("/api/niches/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignoredTags: [{ type: "invalid", name: "Test" }] }),
      });
      expect(res.status).toBe(400);
    });

    test("rejects empty name", async () => {
      const res = await app.request("/api/niches/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignoredTags: [{ type: "mechanic", name: "" }] }),
      });
      expect(res.status).toBe(400);
    });

    test("strips unknown properties from patch", async () => {
      const res = await app.request("/api/niches/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ignoredTags: [{ type: "mechanic", name: "Deck Building" }],
          arbitraryField: "should be stripped",
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ignoredTags).toHaveLength(1);
      expect(body).not.toHaveProperty("arbitraryField");
      // Verify storage also doesn't have it
      expect(storage.settings).not.toHaveProperty("arbitraryField");
    });

    test("rejects non-array ignoredTags", async () => {
      const res = await app.request("/api/niches/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignoredTags: "not-an-array" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/niches/settings/ignore", () => {
    test("adds a single tag", async () => {
      const res = await app.request("/api/niches/settings/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "mechanic", name: "Deck Building" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as NicheSettings;
      expect(body.ignoredTags).toHaveLength(1);
      expect(body.ignoredTags[0]).toEqual({ type: "mechanic", name: "Deck Building" });
    });

    test("is idempotent (does not add duplicates)", async () => {
      storage.settings = { ignoredTags: [{ type: "mechanic", name: "Deck Building" }] };
      const res = await app.request("/api/niches/settings/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "mechanic", name: "Deck Building" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as NicheSettings;
      expect(body.ignoredTags).toHaveLength(1);
    });

    test("rejects invalid body", async () => {
      const res = await app.request("/api/niches/settings/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "bad", name: "X" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/niches/settings/ignore", () => {
    test("removes a tag", async () => {
      storage.settings = {
        ignoredTags: [
          { type: "mechanic", name: "Deck Building" },
          { type: "category", name: "Strategy" },
        ],
      };
      const res = await app.request("/api/niches/settings/ignore", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "mechanic", name: "Deck Building" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as NicheSettings;
      expect(body.ignoredTags).toHaveLength(1);
      expect(body.ignoredTags[0]).toEqual({ type: "category", name: "Strategy" });
    });

    test("removing non-existent tag is a no-op", async () => {
      storage.settings = { ignoredTags: [{ type: "mechanic", name: "Deck Building" }] };
      const res = await app.request("/api/niches/settings/ignore", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "mechanic", name: "Not Present" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as NicheSettings;
      expect(body.ignoredTags).toHaveLength(1);
    });

    test("rejects invalid body", async () => {
      const res = await app.request("/api/niches/settings/ignore", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Missing Type" }),
      });
      expect(res.status).toBe(400);
    });
  });
});
