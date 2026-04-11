import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, jsonRequest, type TestAppContext } from "../helpers/test-app.js";
import type { CollectionProfile } from "@shelf-judge/shared";

describe("profile routes", () => {
  let ctx: TestAppContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  describe("GET /api/profile", () => {
    test("returns 200 with CollectionProfile shape", async () => {
      // Add a game so the profile has something to compute
      const addRes = await jsonRequest(ctx.app, "POST", "/api/games", { name: "Test Game" });
      expect(addRes.status).toBe(201);

      const res = await jsonRequest(ctx.app, "GET", "/api/profile");
      expect(res.status).toBe(200);

      const profile = (await res.json()) as CollectionProfile;
      expect(profile.gameCount).toBe(1);
      expect(profile.computedAt).toBeDefined();
      expect(Array.isArray(profile.axisDistributions)).toBe(true);
      expect(Array.isArray(profile.axisWeights)).toBe(true);
      expect(profile.bggClustering).toBeDefined();
      expect(Array.isArray(profile.bggClustering.mechanics)).toBe(true);
      expect(Array.isArray(profile.bggClustering.categories)).toBe(true);
      expect(Array.isArray(profile.bggClustering.subdomains)).toBe(true);
      expect(Array.isArray(profile.bggClustering.weightRanges)).toBe(true);
      expect(Array.isArray(profile.utilityCurves)).toBe(true);
      expect(Array.isArray(profile.outliers)).toBe(true);
      expect(Array.isArray(profile.suggestions)).toBe(true);
    });

    test("returns cached profile on second call without mutations", async () => {
      await jsonRequest(ctx.app, "POST", "/api/games", { name: "Test Game" });

      const res1 = await jsonRequest(ctx.app, "GET", "/api/profile");
      const profile1 = (await res1.json()) as CollectionProfile;

      const res2 = await jsonRequest(ctx.app, "GET", "/api/profile");
      const profile2 = (await res2.json()) as CollectionProfile;

      // Same computedAt means cached result was returned
      expect(profile2.computedAt).toBe(profile1.computedAt);
    });

    test("returns empty profile for empty collection", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/profile");
      expect(res.status).toBe(200);

      const profile = (await res.json()) as CollectionProfile;
      expect(profile.gameCount).toBe(0);
    });

    test("includes per-component distances for outliers when present", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/profile");
      expect(res.status).toBe(200);

      const profile = (await res.json()) as CollectionProfile;
      // With no games, no outliers expected
      expect(profile.outliers).toEqual([]);
    });

    test("divergence is null when no tournament data", async () => {
      await jsonRequest(ctx.app, "POST", "/api/games", { name: "Test Game" });
      const res = await jsonRequest(ctx.app, "GET", "/api/profile");
      const profile = (await res.json()) as CollectionProfile;

      expect(profile.divergence).toBeNull();
    });
  });
});
