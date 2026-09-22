import { describe, expect, test } from "bun:test";
import { attentionCandidateStorageFor } from "../src/services/attention-candidate-service.js";
import { createAnalystProjectionSnapshotService } from "../src/services/analyst-evidence-projections.js";
import { recoverAttentionCandidatesOnStartup } from "../src/index.js";
import { createProfileService } from "../src/services/profile-service.js";
import { createPredictionService } from "../src/services/prediction-service.js";
import { createTournamentService } from "../src/services/tournament-service.js";
import type { DisplayedFitnessService } from "../src/services/displayed-fitness-service.js";
import { createTestApp, jsonRequest } from "./helpers/test-app.js";

describe("Phase 3 direct integration evidence", () => {
  test("global writers save before maintenance and a shared Profile read cannot interleave", async () => {
    const ctx = createTestApp();
    const events: string[] = [];
    let releaseMaintenance!: () => void;
    let maintenanceStarted!: () => void;
    const maintenanceGate = new Promise<void>((resolve) => (releaseMaintenance = resolve));
    const maintenanceStartedGate = new Promise<void>((resolve) => (maintenanceStarted = resolve));
    const saveTournament = ctx.storageService.saveTournament.bind(ctx.storageService);
    ctx.storageService.saveTournament = async (value) => {
      await saveTournament(value);
      events.push("saved");
    };
    const tournament = createTournamentService({
      storageService: ctx.storageService,
      afterSourceSave: async (impact) => {
        expect(impact).toEqual({ kind: "global", reason: "tournament" });
        events.push("maintenance");
        maintenanceStarted();
        await maintenanceGate;
      },
    });
    let profileStarted = false;
    const fitness: DisplayedFitnessService = {
      ...ctx.displayedFitnessService,
      async listGamesFromSnapshot(snapshot, options) {
        profileStarted = true;
        return ctx.displayedFitnessService.listGamesFromSnapshot(snapshot, options);
      },
    };
    const profile = createProfileService({
      storageService: ctx.storageService,
      displayedFitnessService: fitness,
    });

    const write = tournament.updateSettings({ normalizationHalfWidth: 401 });
    await maintenanceStartedGate;
    const read = profile.getProfile();
    await Promise.resolve();
    expect(events).toEqual(["saved", "maintenance"]);
    expect(profileStarted).toBe(false);
    releaseMaintenance();
    await write;
    expect((await read).status).toBe("available");

    const prediction = createPredictionService({
      storageService: ctx.storageService,
      fitnessService: ctx.fitnessService,
      tournamentService: ctx.tournamentService,
      afterSourceSave: (impact) => {
        if (impact.kind === "global") events.push(impact.reason);
        return Promise.resolve();
      },
    });
    await prediction.updateSettings({ defaultK: 6 });
    expect(events).toContain("prediction");
    const maintain = ctx.attentionCandidateService.maintain.bind(ctx.attentionCandidateService);
    ctx.attentionCandidateService.maintain = (impact) => {
      events.push(impact.kind === "global" ? impact.reason : "games");
      return maintain(impact);
    };
    expect(
      (await jsonRequest(ctx.app, "PATCH", "/api/redundancy/settings", { enabled: true })).status,
    ).toBe(200);
    expect(events).toContain("redundancy");
  });

  test("failed global save never invokes its maintenance callback", async () => {
    const ctx = createTestApp();
    let maintenance = 0;
    ctx.storageService.saveTournament = () => Promise.reject(new Error("disk failed"));
    const tournament = createTournamentService({
      storageService: ctx.storageService,
      afterSourceSave: () => {
        maintenance += 1;
        return Promise.resolve();
      },
    });
    let failure: Error | null = null;
    try {
      await tournament.updateSettings({ normalizationHalfWidth: 401 });
    } catch (error) {
      if (error instanceof Error) failure = error;
    }
    expect(failure?.message).toBe("disk failed");
    expect(maintenance).toBe(0);
  });

  test("config-only writes preserve candidate bytes, invalidate Profile, and do no candidate work", async () => {
    const ctx = createTestApp();
    const candidatePath = "/test/data/attention-candidates.json";
    const exactBytes = '{\n  "candidate": "unchanged"\n}';
    await ctx.profileService.getProfile();
    ctx.fileOps.files.set(candidatePath, exactBytes);
    let candidateLoads = 0;
    const candidateStorage = attentionCandidateStorageFor(ctx.storageService);
    const loadCandidates = () => candidateStorage.loadAttentionCandidates();
    ctx.storageService.loadAttentionCandidates = async () => {
      candidateLoads += 1;
      return loadCandidates();
    };

    const cap = await jsonRequest(ctx.app, "PUT", "/api/config", { profileAttentionCardLimit: 4 });
    expect(cap.status).toBe(200);
    expect(await ctx.storageService.loadProfile()).toBeNull();
    expect(ctx.fileOps.files.get(candidatePath)).toBe(exactBytes);
    expect(candidateLoads).toBe(0);
    const profileEntityPolicy = (await ctx.storageService.loadConfig()).profileEntityPolicy;
    const policy = await jsonRequest(ctx.app, "PUT", "/api/config", { profileEntityPolicy });
    expect(policy.status).toBe(200);
    const unrelated = await jsonRequest(ctx.app, "PUT", "/api/config", { username: "other" });
    expect(unrelated.status).toBe(200);
    expect(candidateLoads).toBe(0);
  });

  test("candidate failure after committed collection source is recoverable without replay", async () => {
    const ctx = createTestApp();
    let candidateSaveFailures = 0;
    const rename = ctx.fileOps.rename.bind(ctx.fileOps);
    ctx.fileOps.rename = async (from, to) => {
      if (to === "/test/data/attention-candidates.json" && candidateSaveFailures++ === 0)
        throw new Error("candidate disk unavailable");
      await rename(from, to);
    };
    const added = await ctx.gameService.addGame({ name: "Committed once" });
    const committed = await ctx.storageService.loadCollection();
    expect(committed.games.map((game) => game.id)).toContain(added.game.id);
    expect(
      await attentionCandidateStorageFor(ctx.storageService).loadAttentionCandidates(),
    ).toBeNull();
    expect((await ctx.attentionCandidateService.ensureFresh()).state).toBe("available");
    const recovered = await ctx.storageService.loadCollection();
    expect(recovered.revision).toBe(committed.revision);
    expect(recovered.games.filter((game) => game.id === added.game.id)).toHaveLength(1);
  });

  test("candidate unavailability gates an otherwise valid Profile cache", async () => {
    const ctx = createTestApp();
    const baseline = await ctx.profileService.getProfile();
    expect(baseline.status).toBe("available");
    let computations = 0;
    const service = createProfileService({
      storageService: ctx.storageService,
      displayedFitnessService: {
        ...ctx.displayedFitnessService,
        listGamesFromSnapshot() {
          computations += 1;
          return Promise.resolve([]);
        },
      },
      attentionCandidates: {
        ensureFresh: () => Promise.resolve({ state: "unavailable", retryable: true }),
      },
    });
    const result = await service.getProfile();
    expect(result.status).toBe("unavailable");
    expect(computations).toBe(0);
  });

  test("startup candidate recovery failure is logged while independent app construction remains available", async () => {
    const messages: string[] = [];
    await recoverAttentionCandidatesOnStartup(
      { ensureFresh: async () => Promise.reject(new Error("recovery failed")) },
      {
        log: (message: string) => messages.push(message),
        error: (message: string) => messages.push(message),
      },
    );
    expect(messages).toEqual([
      "attention candidate recovery started",
      "attention candidate recovery failed",
    ]);
    const ctx = createTestApp();
    expect((await jsonRequest(ctx.app, "GET", "/api/config")).status).toBe(200);
  });

  test("analyst projections use the injected Profile service rather than constructing an ungated one", async () => {
    const ctx = createTestApp();
    let profileReads = 0;
    const projection = createAnalystProjectionSnapshotService({
      storageService: ctx.storageService,
      displayedFitnessService: ctx.displayedFitnessService,
      profileService: {
        getProfile: async () => {
          profileReads += 1;
          return ctx.profileService.getProfile();
        },
      },
    });
    await projection.capture();
    expect(profileReads).toBe(1);
  });
});
