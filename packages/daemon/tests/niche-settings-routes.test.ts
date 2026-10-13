import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createNicheRoutes } from "../src/routes/niche";
import type { NicheSettings } from "@shelf-judge/shared";
import type { StorageService } from "../src/services/storage-service";
import type { Logger } from "../src/services/logger";
import { createSettingsRouteStorageStub } from "./helpers/settings-route-storage";

function createMockStorageService(): StorageService & { settings: NicheSettings } {
  const mock = {
    ...createSettingsRouteStorageStub(),
    settings: { ignoredTags: [] } as NicheSettings,
    loadNicheSettings() {
      return Promise.resolve(structuredClone(mock.settings));
    },
    saveNicheSettings(s: NicheSettings) {
      mock.settings = structuredClone(s);
      return Promise.resolve();
    },
  };
  return mock;
}

describe("niche settings routes", () => {
  let app: Hono;
  let storage: ReturnType<typeof createMockStorageService>;
  let logs: Array<{ level: string; args: unknown[] }>;

  beforeEach(() => {
    storage = createMockStorageService();
    logs = [];
    const logger: Logger = {
      log: (...args) => logs.push({ level: "log", args }),
      warn: (...args) => logs.push({ level: "warn", args }),
      error: (...args) => logs.push({ level: "error", args }),
    };
    const { routes } = createNicheRoutes({ storageService: storage, logger });
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
    test("serializes concurrent ignores so neither update is lost", async () => {
      const responses = await Promise.all([
        app.request("/api/niches/settings/ignore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "mechanic", name: "Deck Building" }),
        }),
        app.request("/api/niches/settings/ignore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "category", name: "Economic" }),
        }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(storage.settings.ignoredTags).toEqual([
        { type: "mechanic", name: "Deck Building" },
        { type: "category", name: "Economic" },
      ]);
    });

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
      expect(logs).toContainEqual({
        level: "log",
        args: [
          "niche tag mutation completed",
          {
            action: "hide",
            type: "mechanic",
            name: "Deck Building",
            outcome: "changed",
            ignoredCount: 1,
          },
        ],
      });
      expect(
        logs.findIndex((entry) => entry.args[0] === "niche tag mutation attempt"),
      ).toBeLessThan(logs.findIndex((entry) => entry.args[0] === "niche tag mutation completed"));
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
      expect(logs).toContainEqual({
        level: "log",
        args: [
          "niche tag mutation completed",
          {
            action: "hide",
            type: "mechanic",
            name: "Deck Building",
            outcome: "idempotent",
            ignoredCount: 1,
          },
        ],
      });
    });

    test("rejects invalid body", async () => {
      const res = await app.request("/api/niches/settings/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "bad", name: "X" }),
      });
      expect(res.status).toBe(400);
      expect(logs).toContainEqual({
        level: "warn",
        args: [
          "niche tag mutation rejected",
          {
            action: "hide",
            outcome: "rejected",
            validationCode: "invalid_tag_filter",
          },
        ],
      });
    });

    test("logs storage failures with tag context", async () => {
      storage.saveNicheSettings = () => Promise.reject(new Error("disk unavailable"));
      const res = await app.request("/api/niches/settings/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "mechanic", name: "Deck Building" }),
      });
      expect(res.status).toBe(500);
      expect(logs).toContainEqual({
        level: "error",
        args: [
          "niche tag mutation failed",
          {
            action: "hide",
            type: "mechanic",
            name: "Deck Building",
            outcome: "failed",
            error: "disk unavailable",
          },
        ],
      });
    });

    test("logs invalid JSON as an attempted, rejected mutation", async () => {
      const res = await app.request("/api/niches/settings/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      expect(res.status).toBe(400);
      expect(logs.map((entry) => entry.args[0])).toEqual([
        "niche tag mutation attempt",
        "niche tag mutation rejected",
      ]);
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
      expect(logs).toContainEqual({
        level: "log",
        args: [
          "niche tag mutation completed",
          {
            action: "restore",
            type: "mechanic",
            name: "Deck Building",
            outcome: "changed",
            ignoredCount: 1,
          },
        ],
      });
      expect(
        logs.findIndex((entry) => entry.args[0] === "niche tag mutation attempt"),
      ).toBeLessThan(logs.findIndex((entry) => entry.args[0] === "niche tag mutation completed"));
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
      expect(logs).toContainEqual({
        level: "log",
        args: [
          "niche tag mutation completed",
          {
            action: "restore",
            type: "mechanic",
            name: "Not Present",
            outcome: "idempotent",
            ignoredCount: 1,
          },
        ],
      });
    });

    test("rejects invalid body", async () => {
      const res = await app.request("/api/niches/settings/ignore", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Missing Type" }),
      });
      expect(res.status).toBe(400);
    });

    test("logs restore storage failures with tag context", async () => {
      storage.settings = { ignoredTags: [{ type: "mechanic", name: "Deck Building" }] };
      storage.saveNicheSettings = () => Promise.reject(new Error("disk unavailable"));
      const res = await app.request("/api/niches/settings/ignore", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "mechanic", name: "Deck Building" }),
      });
      expect(res.status).toBe(500);
      expect(logs).toContainEqual({
        level: "error",
        args: [
          "niche tag mutation failed",
          {
            action: "restore",
            type: "mechanic",
            name: "Deck Building",
            outcome: "failed",
            error: "disk unavailable",
          },
        ],
      });
    });
  });
});
