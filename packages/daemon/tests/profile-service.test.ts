import { describe, expect, test } from "bun:test";
import { CollectionProfileResultSchema, ProfileDataSchema } from "@shelf-judge/shared";
import type { DisplayedFitnessService } from "../src/services/displayed-fitness-service.js";
import { createProfileService } from "../src/services/profile-service.js";
import type { StorageService } from "../src/services/storage-service.js";
import { ZodError } from "zod";
import {
  canonicalJson,
  canonicalSha256,
  profileSourceIdentity,
  type ProfileSources,
} from "../src/services/profile-source-coordinator.js";
import { createMockFileOps } from "./helpers/mock-file-ops.js";
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
  test("publishes disabled, ranked, and exact post-ranking cap prefixes", async () => {
    const ctx = createTestApp();
    for (let index = 0; index < 8; index += 1)
      await ctx.gameService.addGame({
        name: `Unplayed ${String(index).padStart(2, "0")}`,
        numPlays: 0,
      });

    const config = await ctx.storageService.loadConfig();
    await ctx.storageService.saveConfig({ ...config, profileAttentionCardLimit: 24 });
    const uncapped = await ctx.profileService.getProfile();
    if (uncapped.status !== "available") throw new Error("Expected an available uncapped Profile");
    const rankedIds = uncapped.attention.cards.map(({ id }) => id);
    expect(rankedIds).toHaveLength(8);
    const candidateBytes = ctx.fileOps.files.get("/test/data/attention-candidates.json");

    for (const limit of [0, 1, 6, 24]) {
      const currentConfig = await ctx.storageService.loadConfig();
      await ctx.storageService.saveConfig({ ...currentConfig, profileAttentionCardLimit: limit });
      const result = await ctx.profileService.getProfile();
      expect(result.status).toBe("available");
      if (result.status !== "available") continue;
      expect(CollectionProfileResultSchema.safeParse(result).success).toBe(true);
      expect(result.attention.cards.map(({ id }) => id)).toEqual(rankedIds.slice(0, limit));
      expect(result.attention.state).toBe(limit === 0 ? "disabled" : "ranked");
      expect(ctx.fileOps.files.get("/test/data/attention-candidates.json")).toBe(candidateBytes);
    }
  });

  test("omits note-only source differences from Profile output and profile.json", async () => {
    const ctx = createTestApp();
    await ctx.gameService.addGame({ name: "Note-isolated source" });
    const baseline = await ctx.profileService.getProfile();
    const loadCollection = ctx.storageService.loadCollection.bind(ctx.storageService);
    const sentinel = "PROFILE-NOTE-SENTINEL-1d4.4";
    ctx.storageService.loadCollection = async () => {
      const collection = await loadCollection();
      return {
        ...collection,
        games: collection.games.map((game) => ({
          ...game,
          ownerNote: {
            state: "present" as const,
            version: 1,
            updatedAt: "2026-08-31T12:00:00.000Z",
            text: sentinel,
          },
        })),
      };
    };

    const withNote = await createProfileService({
      storageService: ctx.storageService,
      attentionCandidates: ctx.attentionCandidateService,
      displayedFitnessService: ctx.displayedFitnessService,
    }).getProfile();
    const persisted = ctx.fileOps.files.get("/test/data/profile.json");

    expect(withNote).toEqual(baseline);
    expect(persisted).toBeDefined();
    expect(persisted).not.toContain("ownerNote");
    expect(persisted).not.toContain(sentinel);
  });

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
      attentionCandidates: ctx.attentionCandidateService,
      displayedFitnessService,
      now: () => `2026-08-28T00:00:0${clock++}.000Z`,
    });

    const first = await service.getProfile();
    const firstIdentity = (await ctx.storageService.loadProfile())!.publicationIdentity.source;
    expect(first.status).toBe("available");
    expect(await service.getProfile()).toEqual(first);
    expect(computations).toBe(1);

    await jsonRequest(ctx.app, "POST", "/api/games", { name: "Changed collection" });
    await service.getProfile();
    const collectionIdentity = (await ctx.storageService.loadProfile())!.publicationIdentity.source;
    expect(collectionIdentity.collectionRevision).toBeGreaterThan(firstIdentity.collectionRevision);

    await ctx.tournamentService.updateSettings({ normalizationHalfWidth: 450 });
    await service.getProfile();
    const tournamentIdentity = (await ctx.storageService.loadProfile())!.publicationIdentity.source;
    expect(tournamentIdentity.tournamentHash).not.toBe(collectionIdentity.tournamentHash);

    await ctx.predictionService.updateSettings({ defaultK: 6 });
    await service.getProfile();
    const predictionIdentity = (await ctx.storageService.loadProfile())!.publicationIdentity.source;
    expect(predictionIdentity.predictionSettingsHash).not.toBe(
      tournamentIdentity.predictionSettingsHash,
    );

    await jsonRequest(ctx.app, "PATCH", "/api/redundancy/settings", { enabled: true });
    await service.getProfile();
    const redundancyIdentity = (await ctx.storageService.loadProfile())!.publicationIdentity.source;
    expect(redundancyIdentity.redundancySettingsHash).not.toBe(
      predictionIdentity.redundancySettingsHash,
    );
    expect(computations).toBe(5);
  });

  test("discards older and malformed attention Profile caches", async () => {
    const ctx = createTestApp();
    const created = await ctx.gameService.addGame({ name: "Unplayed intention" });
    const collection = await ctx.storageService.loadCollection();
    const game = collection.games.find(({ id }) => id === created.game.id);
    if (!game) throw new Error("Expected created game");
    game.numPlays = 0;
    game.playCountEvidence = {
      status: "valid",
      value: 0,
      source: "manual",
      observedAt: "2026-09-20T00:00:00.000Z",
    };
    collection.intentions.push({
      intentionId: "unplayed-intention",
      gameId: game.id,
      kind: "want-to-play",
      baseline: null,
      createdAt: "2026-09-20T00:00:00.000Z",
      version: 1,
      resolution: null,
    });
    collection.revision += 1;
    collection.updatedAt = "2026-09-20T00:00:00.000Z";
    await ctx.storageService.saveCollection(collection);

    const current = await ctx.profileService.getProfile();
    expect(current.status).toBe("available");
    const cached = await ctx.storageService.loadProfile();
    if (!cached) throw new Error("Expected current profile cache");
    const oldGeneric = structuredClone(cached);
    oldGeneric.algorithmVersion = 12 as never;
    (oldGeneric.profile.attention as unknown as Record<string, unknown>) = {
      state: "empty",
      cardLimit: 6,
      items: [],
    };
    const oldGenericCache = JSON.stringify(oldGeneric);
    ctx.fileOps.files.set("/test/data/profile.json", oldGenericCache);

    let computations = 0;
    const service = createProfileService({
      storageService: ctx.storageService,
      attentionCandidates: ctx.attentionCandidateService,
      displayedFitnessService: {
        ...ctx.displayedFitnessService,
        async listGamesFromSnapshot(snapshot, options) {
          computations += 1;
          return ctx.displayedFitnessService.listGamesFromSnapshot(snapshot, options);
        },
      },
    });

    const result = await service.getProfile();
    expect(computations).toBe(1);
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected available profile");
    expect(result.attention.state).toBe("ranked");
    expect(result.attention.cards).toHaveLength(1);
    expect((await ctx.storageService.loadProfile())?.algorithmVersion).toBe(13);
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
      attentionCandidates: ctx.attentionCandidateService,
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
      attentionCandidates: ctx.attentionCandidateService,
      displayedFitnessService: {
        listGames: () => Promise.resolve([]),
        listGamesFromSnapshot: () => Promise.reject(new Error("fitness failed")),
      },
    }).getProfile();

    expect(result.status).toBe("unavailable");
    expect(await ctx.storageService.loadProfile()).toBeNull();
  });

  test("publishes the captured identity before each of the four source mutations", async () => {
    const sourcePaths = {
      collection: "/test/data/collection.json",
      tournament: "/test/data/tournament.json",
      prediction: "/test/data/prediction-settings.json",
      redundancy: "/test/data/redundancy-settings.json",
    } as const;

    for (const source of Object.keys(sourcePaths) as Array<keyof typeof sourcePaths>) {
      const fileOps = createMockFileOps();
      const ctx = createTestApp({ fileOps });
      await ctx.gameService.addGame({ name: "Profile source baseline" });
      await ctx.storageService.loadTournament();

      let snapshotCaptured!: () => void;
      let releaseComputation!: () => void;
      let profilePublished!: () => void;
      let releasePublication!: () => void;
      const snapshotCapturedPromise = new Promise<void>((resolve) => (snapshotCaptured = resolve));
      const releaseComputationPromise = new Promise<void>(
        (resolve) => (releaseComputation = resolve),
      );
      const profilePublishedPromise = new Promise<void>((resolve) => (profilePublished = resolve));
      const releasePublicationPromise = new Promise<void>(
        (resolve) => (releasePublication = resolve),
      );
      let capturedSources: ProfileSources | null = null;
      let sourcePersistenceStarted = false;
      let armed = false;
      const rename = fileOps.rename.bind(fileOps);
      fileOps.rename = async (from, to) => {
        if (armed && to === "/test/data/profile.json") {
          await rename(from, to);
          profilePublished();
          await releasePublicationPromise;
          return;
        }
        if (armed && to === sourcePaths[source]) sourcePersistenceStarted = true;
        await rename(from, to);
      };
      const displayedFitnessService: DisplayedFitnessService = {
        ...ctx.displayedFitnessService,
        async listGamesFromSnapshot(snapshot, options) {
          capturedSources = structuredClone(snapshot);
          snapshotCaptured();
          await releaseComputationPromise;
          return ctx.displayedFitnessService.listGamesFromSnapshot(snapshot, options);
        },
      };
      const service = createProfileService({
        storageService: ctx.storageService,
        attentionCandidates: ctx.attentionCandidateService,
        displayedFitnessService,
      });

      armed = true;
      const profileRead = service.getProfile();
      await snapshotCapturedPromise;
      const mutation =
        source === "collection"
          ? ctx.gameService.addGame({ name: "Concurrent source" })
          : source === "tournament"
            ? ctx.tournamentService.updateSettings({ normalizationHalfWidth: 450 })
            : source === "prediction"
              ? ctx.predictionService.updateSettings({ defaultK: 7 })
              : jsonRequest(ctx.app, "PATCH", "/api/redundancy/settings", { enabled: true });
      await Promise.resolve();
      expect(sourcePersistenceStarted).toBe(false);

      releaseComputation();
      await profilePublishedPromise;
      expect(sourcePersistenceStarted).toBe(false);
      if (capturedSources === null) throw new Error("Profile source snapshot was not captured");
      const firstCacheRaw = fileOps.files.get("/test/data/profile.json");
      if (firstCacheRaw === undefined) throw new Error("First profile cache was not published");
      const firstIdentity = profileSourceIdentity(capturedSources);
      expect(ProfileDataSchema.parse(JSON.parse(firstCacheRaw)).publicationIdentity.source).toEqual(
        firstIdentity,
      );

      releasePublication();
      expect((await profileRead).status).toBe("available");
      await mutation;
      expect(sourcePersistenceStarted).toBe(true);

      expect((await service.getProfile()).status).toBe("available");
      const [collection, tournament, predictionSettings, redundancySettings] = await Promise.all([
        ctx.storageService.loadCollection(),
        ctx.storageService.loadTournament(),
        ctx.storageService.loadPredictionSettings(),
        ctx.storageService.loadRedundancySettings(),
      ]);
      const secondIdentity = profileSourceIdentity({
        collection,
        tournament,
        predictionSettings,
        redundancySettings,
      });
      expect(secondIdentity).not.toEqual(firstIdentity);
      expect((await ctx.storageService.loadProfile())?.publicationIdentity.source).toEqual(
        secondIdentity,
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
      attentionCandidates: ctx.attentionCandidateService,
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
      attentionCandidates: ctx.attentionCandidateService,
      displayedFitnessService: ctx.displayedFitnessService,
    });

    const profileRead = service.getProfile();
    await saveCompletedPromise;
    let mutationFinished = false;
    const mutation = ctx.tournamentService
      .updateSettings({ normalizationHalfWidth: 450 })
      .then(() => {
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
      attentionCandidates: ctx.attentionCandidateService,
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
      attentionCandidates: validationContext.attentionCandidateService,
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
      attentionCandidates: validationContext.attentionCandidateService,
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
      attentionCandidates: transportContext.attentionCandidateService,
      displayedFitnessService: transportContext.displayedFitnessService,
    }).getProfile();
    expect(transport).toEqual({
      status: "unavailable",
      error: { kind: "transport", message: "disk unavailable" },
      retryDestination: { operationId: "shelf.profile.get" },
    });
  });
});
