import { describe, test, expect, beforeEach } from "bun:test";
import { createTestApp, jsonRequest, type TestAppContext } from "../helpers/test-app.js";
import type { CollectionProfile } from "@shelf-judge/shared";
import {
  CollectionProfileSchema,
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
} from "@shelf-judge/shared";
import { trustedInsightProfileFixture } from "../../../shared/tests/fixtures/trusted-profile.js";

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

      const profile: CollectionProfile = CollectionProfileSchema.parse(await res.json());
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

    test("passes the complete trusted insight union through without projection", async () => {
      for (let index = 1; index <= trustedInsightProfileFixture.gameCount; index++) {
        const addRes = await jsonRequest(ctx.app, "POST", "/api/games", {
          name: `Game ${index}`,
        });
        expect(addRes.status).toBe(201);
      }
      const tournament = await ctx.storageService.loadTournament();
      await ctx.storageService.saveProfile({
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
        algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        tournamentSettings: tournament.settings,
        profile: structuredClone(trustedInsightProfileFixture),
        computedAt: trustedInsightProfileFixture.computedAt,
        narration: null,
        narrationComputedAt: null,
      });

      const res = await jsonRequest(ctx.app, "GET", "/api/profile");
      expect(res.status).toBe(200);
      const profile: CollectionProfile = CollectionProfileSchema.parse(await res.json());

      expect(profile).toEqual(trustedInsightProfileFixture);
      expect(profile.divergence?.map(({ status }) => status)).toEqual(["reported", "insufficient"]);
      expect(profile.outliers.map(({ status }) => status)).toEqual(["reported", "insufficient"]);
      expect(profile.suggestions.map(({ status }) => status)).toEqual([
        "reported",
        "insufficient",
        "suppressed",
        "retired",
      ]);
    });

    test("returns cached profile on second call without mutations", async () => {
      await jsonRequest(ctx.app, "POST", "/api/games", { name: "Test Game" });

      const res1 = await jsonRequest(ctx.app, "GET", "/api/profile");
      const profile1: CollectionProfile = CollectionProfileSchema.parse(await res1.json());

      const res2 = await jsonRequest(ctx.app, "GET", "/api/profile");
      const profile2: CollectionProfile = CollectionProfileSchema.parse(await res2.json());

      // Same computedAt means cached result was returned
      expect(profile2.computedAt).toBe(profile1.computedAt);
    });

    test("returns empty profile for empty collection", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/profile");
      expect(res.status).toBe(200);

      const profile: CollectionProfile = CollectionProfileSchema.parse(await res.json());
      expect(profile.gameCount).toBe(0);
    });

    test("exposes outlier abstention evidence for an empty collection", async () => {
      const res = await jsonRequest(ctx.app, "GET", "/api/profile");
      expect(res.status).toBe(200);

      const profile: CollectionProfile = CollectionProfileSchema.parse(await res.json());
      expect(profile.outliers).toHaveLength(1);
      expect(profile.outliers[0]).toMatchObject({
        status: "insufficient",
        reason: "insufficient-sample",
        cohort: { eligibleGameCount: 0, includedGameCount: 0, coveragePercent: 0 },
      });
      expect(profile.outliers[0]?.sufficiency[0]).toEqual({
        criterion: "usable-owned-games",
        observed: 0,
        required: 6,
        met: false,
      });
    });

    test("divergence is null when no tournament data", async () => {
      await jsonRequest(ctx.app, "POST", "/api/games", { name: "Test Game" });
      const res = await jsonRequest(ctx.app, "GET", "/api/profile");
      const profile: CollectionProfile = CollectionProfileSchema.parse(await res.json());

      expect(profile.divergence).toBeNull();
    });
  });
});
