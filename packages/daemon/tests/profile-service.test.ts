import { describe, expect, test } from "bun:test";
import type { DisplayedFitnessService } from "../src/services/displayed-fitness-service.js";
import { createProfileService } from "../src/services/profile-service.js";
import type { StorageService } from "../src/services/storage-service.js";
import { ZodError } from "zod";
import {
  canonicalJson,
  canonicalSha256,
  profileSourceIdentity,
} from "../src/services/profile-source-coordinator.js";
import { createTestApp, jsonRequest } from "./helpers/test-app.js";

describe("profile source identity", () => {
  test("canonicalizes recursively sorted object keys before hashing", () => {
    const left = { z: [{ b: 2, a: 1 }], a: { y: true, x: null } };
    const right = { a: { x: null, y: true }, z: [{ a: 1, b: 2 }] };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalSha256(left)).toBe(canonicalSha256(right));
    expect(canonicalSha256(left)).toMatch(/^[a-f0-9]{64}$/);
  });

  test("rejects non-finite canonical values", () => {
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow("non-finite");
  });
});

describe("ProfileService", () => {
  test("reuses only an exact current source identity and recomputes for all four sources", async () => {
    const ctx = createTestApp();
    let clock = 0;
    let computations = 0;
    const displayedFitnessService: DisplayedFitnessService = {
      ...ctx.displayedFitnessService,
      async listGamesFromSnapshot(snapshot, options) {
        computations += 1;
        return ctx.displayedFitnessService.listGamesFromSnapshot(snapshot, options);
      },
    };
    const service = createProfileService({
      storageService: ctx.storageService,
      displayedFitnessService,
      now: () => `2026-08-28T00:00:0${clock++}.000Z`,
    });

    const first = await service.getProfile();
    const firstIdentity = (await ctx.storageService.loadProfile())!.sourceIdentity;
    expect(first.status).toBe("available");
    expect(await service.getProfile()).toEqual(first);
    expect(computations).toBe(1);

    await jsonRequest(ctx.app, "POST", "/api/games", { name: "Changed collection" });
    await service.getProfile();
    const collectionIdentity = (await ctx.storageService.loadProfile())!.sourceIdentity;
    expect(collectionIdentity.collectionRevision).toBeGreaterThan(firstIdentity.collectionRevision);

    await ctx.tournamentService.updateSettings({ provisionalThreshold: 7 });
    await service.getProfile();
    const tournamentIdentity = (await ctx.storageService.loadProfile())!.sourceIdentity;
    expect(tournamentIdentity.tournamentHash).not.toBe(collectionIdentity.tournamentHash);

    await ctx.predictionService.updateSettings({ defaultK: 6 });
    await service.getProfile();
    const predictionIdentity = (await ctx.storageService.loadProfile())!.sourceIdentity;
    expect(predictionIdentity.predictionSettingsHash).not.toBe(
      tournamentIdentity.predictionSettingsHash,
    );

    await jsonRequest(ctx.app, "PATCH", "/api/redundancy/settings", { enabled: true });
    await service.getProfile();
    const redundancyIdentity = (await ctx.storageService.loadProfile())!.sourceIdentity;
    expect(redundancyIdentity.redundancySettingsHash).not.toBe(
      predictionIdentity.redundancySettingsHash,
    );
    expect(computations).toBe(5);
  });

  test("recomputes a current-identity cache that does not match the collection source", async () => {
    const ctx = createTestApp();
    await jsonRequest(ctx.app, "POST", "/api/games", { name: "Source game" });
    const first = await ctx.profileService.getProfile();
    expect(first.status).toBe("available");
    const cached = (await ctx.storageService.loadProfile())!;
    for (const entityClass of ["mechanic", "designer", "artist"] as const) {
      const exclusion = cached.profile.identity.classes[entityClass].exclusions[0];
      if (!exclusion) throw new Error("Expected incomplete metadata exclusion");
      exclusion.gameName = "Forged name";
    }
    await ctx.storageService.saveProfile(cached);

    let computations = 0;
    const service = createProfileService({
      storageService: ctx.storageService,
      displayedFitnessService: {
        ...ctx.displayedFitnessService,
        async listGamesFromSnapshot(snapshot, options) {
          computations += 1;
          return ctx.displayedFitnessService.listGamesFromSnapshot(snapshot, options);
        },
      },
    });

    const result = await service.getProfile();
    expect(result.status).toBe("available");
    expect(computations).toBe(1);
    if (result.status !== "available") throw new Error("Expected available profile");
    expect(result.identity.classes.mechanic.exclusions[0]?.gameName).toBe("Source game");
  });

  test("discards a source-invalid cache before a failed recomputation", async () => {
    const ctx = createTestApp();
    await jsonRequest(ctx.app, "POST", "/api/games", { name: "Source game" });
    await ctx.profileService.getProfile();
    const cached = (await ctx.storageService.loadProfile())!;
    for (const entityClass of ["mechanic", "designer", "artist"] as const) {
      const exclusion = cached.profile.identity.classes[entityClass].exclusions[0];
      if (!exclusion) throw new Error("Expected incomplete metadata exclusion");
      exclusion.gameName = "Forged name";
    }
    await ctx.storageService.saveProfile(cached);

    const result = await createProfileService({
      storageService: ctx.storageService,
      displayedFitnessService: {
        listGames: () => Promise.resolve([]),
        listGamesFromSnapshot: () => Promise.reject(new Error("fitness failed")),
      },
    }).getProfile();

    expect(result.status).toBe("unavailable");
    expect(await ctx.storageService.loadProfile()).toBeNull();
  });

  test("serializes all four source mutations through snapshot, save, and return", async () => {
    for (const source of ["collection", "tournament", "prediction", "redundancy"] as const) {
      const ctx = createTestApp();
      let release!: () => void;
      let captured!: () => void;
      const capturedPromise = new Promise<void>((resolve) => {
        captured = resolve;
      });
      const releasePromise = new Promise<void>((resolve) => {
        release = resolve;
      });
      const displayedFitnessService: DisplayedFitnessService = {
        ...ctx.displayedFitnessService,
        async listGamesFromSnapshot(snapshot, options) {
          captured();
          await releasePromise;
          return ctx.displayedFitnessService.listGamesFromSnapshot(snapshot, options);
        },
      };
      const service = createProfileService({
        storageService: ctx.storageService,
        displayedFitnessService,
      });

      const profileRead = service.getProfile();
      await capturedPromise;
      let mutationFinished = false;
      const mutationOperation =
        source === "collection"
          ? ctx.collectionMutationService.mutate(
              { operation: "test.profile-source", trigger: "test" },
              (collection) => {
                collection.name = "Changed while profile computes";
                return { changed: true, value: undefined };
              },
            )
          : source === "tournament"
            ? ctx.tournamentService.updateSettings({ provisionalThreshold: 7 })
            : source === "prediction"
              ? ctx.predictionService.updateSettings({ defaultK: 7 })
              : jsonRequest(ctx.app, "PATCH", "/api/redundancy/settings", { enabled: true });
      const mutation = mutationOperation.then(() => {
        mutationFinished = true;
      });
      await Promise.resolve();
      expect(mutationFinished).toBe(false);

      release();
      expect((await profileRead).status).toBe("available");
      await mutation;
      expect(mutationFinished).toBe(true);

      expect((await service.getProfile()).status).toBe("available");
      const [collection, tournament, predictionSettings, redundancySettings] = await Promise.all([
        ctx.storageService.loadCollection(),
        ctx.storageService.loadTournament(),
        ctx.storageService.loadPredictionSettings(),
        ctx.storageService.loadRedundancySettings(),
      ]);
      expect((await ctx.storageService.loadProfile())?.sourceIdentity).toEqual(
        profileSourceIdentity({
          collection,
          tournament,
          predictionSettings,
          redundancySettings,
        }),
      );
    }
  });

  test("does not read between linked collection and Tournament deletion writes", async () => {
    const ctx = createTestApp();
    const created = await ctx.gameService.addGame({ name: "Deleted game" });
    let releaseTournamentSave!: () => void;
    let tournamentSaveStarted!: () => void;
    const releaseTournamentSavePromise = new Promise<void>((resolve) => {
      releaseTournamentSave = resolve;
    });
    const tournamentSaveStartedPromise = new Promise<void>((resolve) => {
      tournamentSaveStarted = resolve;
    });
    const saveTournament = ctx.storageService.saveTournament.bind(ctx.storageService);
    ctx.storageService.saveTournament = async (data) => {
      tournamentSaveStarted();
      await releaseTournamentSavePromise;
      await saveTournament(data);
    };
    let snapshotCaptured = false;
    const service = createProfileService({
      storageService: ctx.storageService,
      displayedFitnessService: {
        ...ctx.displayedFitnessService,
        async listGamesFromSnapshot(snapshot, options) {
          snapshotCaptured = true;
          return ctx.displayedFitnessService.listGamesFromSnapshot(snapshot, options);
        },
      },
    });

    const deletion = ctx.gameService.removeGame(created.game.id);
    await tournamentSaveStartedPromise;
    const profileRead = service.getProfile();
    await Promise.resolve();
    expect(snapshotCaptured).toBe(false);

    releaseTournamentSave();
    await deletion;
    const profile = await profileRead;
    expect(profile.status).toBe("available");
    expect(snapshotCaptured).toBe(true);
    const collection = await ctx.storageService.loadCollection();
    const tournament = await ctx.storageService.loadTournament();
    expect(collection.games.some(({ id }) => id === created.game.id)).toBe(false);
    expect(tournament.gameStats[created.game.id]).toBeUndefined();
  });

  test("holds source mutations after atomic cache save until the profile operation returns", async () => {
    const ctx = createTestApp();
    let releaseSave!: () => void;
    let saveCompleted!: () => void;
    const releaseSavePromise = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const saveCompletedPromise = new Promise<void>((resolve) => {
      saveCompleted = resolve;
    });
    const saveProfile = ctx.storageService.saveProfile.bind(ctx.storageService);
    ctx.storageService.saveProfile = async (data) => {
      await saveProfile(data);
      saveCompleted();
      await releaseSavePromise;
    };
    const service = createProfileService({
      storageService: ctx.storageService,
      displayedFitnessService: ctx.displayedFitnessService,
    });

    const profileRead = service.getProfile();
    await saveCompletedPromise;
    let mutationFinished = false;
    const mutation = ctx.tournamentService.updateSettings({ provisionalThreshold: 7 }).then(() => {
      mutationFinished = true;
    });
    await Promise.resolve();
    expect(mutationFinished).toBe(false);

    releaseSave();
    expect((await profileRead).status).toBe("available");
    await mutation;
    expect(mutationFinished).toBe(true);
  });

  test("returns retryable unavailable on recomputation failure without mutating collection", async () => {
    const ctx = createTestApp();
    const before = await ctx.storageService.loadCollection();
    const service = createProfileService({
      storageService: ctx.storageService,
      displayedFitnessService: {
        listGames: () => Promise.resolve([]),
        listGamesFromSnapshot: () => Promise.reject(new Error("fitness failed")),
      },
    });

    const result = await service.getProfile();

    expect(result).toEqual({
      status: "unavailable",
      error: { kind: "recomputation", message: "fitness failed" },
      retryDestination: { operationId: "shelf.profile.get" },
    });
    expect(await ctx.storageService.loadCollection()).toEqual(before);
    expect(await ctx.storageService.loadProfile()).toBeNull();
  });

  test("distinguishes source validation and cache transport failures", async () => {
    const validationContext = createTestApp();
    const invalidStorage: StorageService = {
      ...validationContext.storageService,
      loadPredictionSettings: () => Promise.reject(new ZodError([])),
    };
    const validation = await createProfileService({
      storageService: invalidStorage,
      displayedFitnessService: validationContext.displayedFitnessService,
    }).getProfile();
    expect(validation.status).toBe("unavailable");
    if (validation.status !== "unavailable") throw new Error("Expected unavailable profile");
    expect(validation.error.kind).toBe("validation");

    const malformedStorage: StorageService = {
      ...validationContext.storageService,
      loadPredictionSettings: () => Promise.reject(new SyntaxError("Malformed JSON")),
    };
    const malformed = await createProfileService({
      storageService: malformedStorage,
      displayedFitnessService: validationContext.displayedFitnessService,
    }).getProfile();
    expect(malformed.status).toBe("unavailable");
    if (malformed.status !== "unavailable") throw new Error("Expected unavailable profile");
    expect(malformed.error.kind).toBe("validation");

    const transportContext = createTestApp();
    const failingStorage: StorageService = {
      ...transportContext.storageService,
      saveProfile: () => Promise.reject(new Error("disk unavailable")),
    };
    const transport = await createProfileService({
      storageService: failingStorage,
      displayedFitnessService: transportContext.displayedFitnessService,
    }).getProfile();
    expect(transport).toEqual({
      status: "unavailable",
      error: { kind: "transport", message: "disk unavailable" },
      retryDestination: { operationId: "shelf.profile.get" },
    });
  });
});
