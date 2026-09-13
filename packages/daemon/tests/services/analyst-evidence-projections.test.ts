import { describe, expect, test } from "bun:test";
import { createAnalystProjectionSnapshotService } from "../../src/services/analyst-evidence-projections.js";
import { createProfileService } from "../../src/services/profile-service.js";
import { createTestApp } from "../helpers/test-app.js";

describe("AnalystProjectionSnapshotService Profile cache parity", () => {
  test("does not rewrite a valid Profile cache", async () => {
    const ctx = createTestApp();
    await ctx.profileService.getProfile();
    const cachedBefore = ctx.fileOps.files.get("/test/data/profile.json");
    if (cachedBefore === undefined) throw new Error("Expected Profile cache");

    let cacheWrites = 0;
    const saveProfile = ctx.storageService.saveProfile.bind(ctx.storageService);
    ctx.storageService.saveProfile = async (profile) => {
      cacheWrites += 1;
      await saveProfile(profile);
    };

    await createAnalystProjectionSnapshotService({
      storageService: ctx.storageService,
      displayedFitnessService: ctx.displayedFitnessService,
    }).capture();

    expect(cacheWrites).toBe(0);
    expect(ctx.fileOps.files.get("/test/data/profile.json")).toBe(cachedBefore);
  });

  test("recomputes a stale Profile cache with the same Profile output as an ordinary read", async () => {
    const ctx = createTestApp();
    await ctx.profileService.getProfile();
    const staleProfile = await ctx.storageService.loadProfile();
    if (staleProfile === null) throw new Error("Expected stale Profile cache");
    await ctx.gameService.addGame({ name: "Stale Analyst cache" });

    let cacheWrites = 0;
    const saveProfile = ctx.storageService.saveProfile.bind(ctx.storageService);
    ctx.storageService.saveProfile = async (profile) => {
      cacheWrites += 1;
      await saveProfile(profile);
    };

    await createAnalystProjectionSnapshotService({
      storageService: ctx.storageService,
      displayedFitnessService: ctx.displayedFitnessService,
      now: () => "2026-09-06T00:00:00.000Z",
    }).capture();
    expect(cacheWrites).toBe(1);
    const analystProfile = await ctx.storageService.loadProfile();
    await saveProfile(staleProfile);
    const ordinaryProfile = await createProfileService({
      storageService: ctx.storageService,
      displayedFitnessService: ctx.displayedFitnessService,
      now: () => "2026-09-06T00:00:00.000Z",
    }).getProfile();

    if (ordinaryProfile.status !== "available") throw new Error("Expected available Profile");
    expect(cacheWrites).toBe(2);
    expect(analystProfile).not.toBeNull();
    expect(analystProfile?.profile).toEqual(ordinaryProfile);
  });
});
