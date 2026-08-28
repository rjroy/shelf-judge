import { describe, expect, test } from "bun:test";
import { FutureUsefulProfileSchema } from "@shelf-judge/shared";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";

describe("profile routes", () => {
  test("GET /api/profile passes through the complete useful profile", async () => {
    const ctx = createTestApp();
    const response = await jsonRequest(ctx.app, "GET", "/api/profile");
    const profile = FutureUsefulProfileSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(profile.status).toBe("available");
    if (profile.status !== "available") throw new Error("Expected available profile");
    expect(Object.keys(profile.identity.classes)).toEqual(["mechanic", "designer", "artist"]);
    for (const result of Object.values(profile.identity.classes)) {
      expect(result.orderings).toEqual({ rating: [], support: [], name: [] });
    }
  });

  test("narration route and operation are absent", async () => {
    const ctx = createTestApp();
    const response = await jsonRequest(ctx.app, "POST", "/api/profile/narrate");

    expect(response.status).toBe(404);
    expect(ctx.operations.some(({ operationId }) => operationId.includes("narrat"))).toBe(false);
  });

  test("returns an exact cached response on a second read", async () => {
    const ctx = createTestApp();
    const first: unknown = await (await jsonRequest(ctx.app, "GET", "/api/profile")).json();
    const second: unknown = await (await jsonRequest(ctx.app, "GET", "/api/profile")).json();
    expect(second).toEqual(first);
  });
});
