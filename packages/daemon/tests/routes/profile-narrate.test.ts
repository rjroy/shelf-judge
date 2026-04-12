import { describe, test, expect } from "bun:test";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";
import type { CollectionProfile, ProfileNarration } from "@shelf-judge/shared";
import type { NarrationService } from "../../src/services/narration-service.js";

const sampleNarration: ProfileNarration = {
  summary: "A well-curated collection emphasizing strategy.",
  surprises: ["High weight concentration in medium games"],
  tensions: ["Fun vs complexity trade-off"],
  blindSpots: ["No party games"],
  curveInsights: [],
};

function createMockNarrationService(overrides?: Partial<NarrationService>): NarrationService {
  return {
    isAvailable: () => true,
    generateNarration: () => Promise.resolve(sampleNarration),
    ...overrides,
  };
}

describe("profile narrate routes", () => {
  describe("POST /api/profile/narrate", () => {
    test("returns 503 when narration service is unavailable", async () => {
      const ctx = createTestApp({
        narrationService: createMockNarrationService({ isAvailable: () => false }),
      });

      const res = await jsonRequest(ctx.app, "POST", "/api/profile/narrate");
      expect(res.status).toBe(503);

      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("unavailable");
    });

    test("returns 503 when no narration service is provided", async () => {
      const ctx = createTestApp();

      const res = await jsonRequest(ctx.app, "POST", "/api/profile/narrate");
      expect(res.status).toBe(503);
    });

    test("returns 200 with narration when SDK is available", async () => {
      const ctx = createTestApp({
        narrationService: createMockNarrationService(),
      });

      // Add a game so profile can be computed
      await jsonRequest(ctx.app, "POST", "/api/games", { name: "Test Game" });

      const res = await jsonRequest(ctx.app, "POST", "/api/profile/narrate");
      expect(res.status).toBe(200);

      const profile = (await res.json()) as CollectionProfile;
      expect(profile.narration).not.toBeNull();
      expect(profile.narration!.summary).toBe(sampleNarration.summary);
      expect(profile.narrationState).toBe("fresh");
    });

    test("returns 502 on SDK error", async () => {
      const ctx = createTestApp({
        narrationService: createMockNarrationService({
          generateNarration: () => Promise.reject(new Error("SDK auth failed")),
        }),
      });

      await jsonRequest(ctx.app, "POST", "/api/games", { name: "Test Game" });

      const res = await jsonRequest(ctx.app, "POST", "/api/profile/narrate");
      expect(res.status).toBe(502);

      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("SDK auth failed");
    });

    test("narration persists across GET requests", async () => {
      const ctx = createTestApp({
        narrationService: createMockNarrationService(),
      });

      await jsonRequest(ctx.app, "POST", "/api/games", { name: "Test Game" });

      // Generate narration
      const postRes = await jsonRequest(ctx.app, "POST", "/api/profile/narrate");
      expect(postRes.status).toBe(200);

      // GET should include the narration
      const getRes = await jsonRequest(ctx.app, "GET", "/api/profile");
      expect(getRes.status).toBe(200);

      const profile = (await getRes.json()) as CollectionProfile;
      expect(profile.narration).not.toBeNull();
      expect(profile.narrationState).toBe("fresh");
    });

    test("GET /api/profile never auto-generates narration (REQ-PROFILE-27)", async () => {
      let narrationCalled = false;
      const ctx = createTestApp({
        narrationService: createMockNarrationService({
          generateNarration: () => {
            narrationCalled = true;
            return Promise.resolve(sampleNarration);
          },
        }),
      });

      await jsonRequest(ctx.app, "POST", "/api/games", { name: "Test Game" });

      // GET without POST /narrate first
      const res = await jsonRequest(ctx.app, "GET", "/api/profile");
      expect(res.status).toBe(200);

      const profile = (await res.json()) as CollectionProfile;
      expect(profile.narration).toBeNull();
      expect(profile.narrationState).toBe("empty");
      expect(narrationCalled).toBe(false);
    });
  });
});
