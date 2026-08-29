import { describe, expect, test } from "bun:test";
import { CollectionProfileResultSchema, type CollectionProfileResult } from "@shelf-judge/shared";
import { canonicalUsefulProfileFixtures } from "../../../shared/tests/fixtures/useful-profile.js";
import { createProfileRoutes } from "../../src/routes/profile.js";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";

describe("profile routes", () => {
  test.each(canonicalUsefulProfileFixtures)(
    "passes through and contract-validates the canonical %s fixture",
    async (_label, fixture) => {
      const { routes } = createProfileRoutes({
        profileService: { getProfile: () => Promise.resolve(structuredClone(fixture)) },
      });
      const response = await routes.request("/profile");
      const parsed: CollectionProfileResult = CollectionProfileResultSchema.parse(
        await response.json(),
      );

      expect(response.status).toBe(200);
      expect(parsed).toEqual(fixture);
    },
  );

  test("GET /api/profile passes through the complete useful profile", async () => {
    const ctx = createTestApp();
    const response = await jsonRequest(ctx.app, "GET", "/api/profile");
    const profile = CollectionProfileResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(profile.status).toBe("available");
    if (profile.status !== "available") throw new Error("Expected available profile");
    expect(Object.keys(profile.identity.classes)).toEqual(["mechanic", "designer", "artist"]);
    for (const result of Object.values(profile.identity.classes)) {
      expect(result.orderings).toEqual({ rating: [], support: [], name: [] });
    }
  });

  test("returns an exact cached response on a second read", async () => {
    const ctx = createTestApp();
    const first: unknown = await (await jsonRequest(ctx.app, "GET", "/api/profile")).json();
    const second: unknown = await (await jsonRequest(ctx.app, "GET", "/api/profile")).json();
    expect(second).toEqual(first);
  });
});
