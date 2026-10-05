import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionProfileResultSchema, CollectionSnapshotSchema } from "@shelf-judge/shared";
import { createFileOps } from "../../src/services/file-ops.js";
import { createJevPairCache } from "../../src/services/jev-pair-cache-service.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import type { PrivateDisplayedFitnessService } from "../../src/services/displayed-fitness-service.js";
import { createTestApp } from "../helpers/test-app.js";

function gate() {
  let release!: () => void;
  let enter!: () => void;
  return {
    promise: new Promise<void>((resolve) => (release = resolve)),
    reached: new Promise<void>((resolve) => (enter = resolve)),
    release: () => release(),
    enter: () => enter(),
  };
}

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((res) => (resolve = res));
  return { promise, resolve };
}

type ConsoleSpy = {
  mock: { calls: unknown[][] };
  mockRestore(): void;
  mockClear(): void;
};

async function bounded<Value>(promise: Promise<Value>, timeoutMs = 5_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ completed: true as const, value })),
      new Promise<{ completed: false }>((resolve) => {
        timer = setTimeout(() => resolve({ completed: false }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("Profile and collection snapshot concurrent requests", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let originalNodeDebug: string | undefined;
  let logSpy: ConsoleSpy;
  let warnSpy: ConsoleSpy;
  let errorSpy: ConsoleSpy;

  beforeEach(() => {
    originalNodeDebug = process.env.NODE_DEBUG;
    logSpy = spyOn(console, "log").mockImplementation(() => {}) as ConsoleSpy;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {}) as ConsoleSpy;
    errorSpy = spyOn(console, "error").mockImplementation(() => {}) as ConsoleSpy;
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    if (originalNodeDebug === undefined) delete process.env.NODE_DEBUG;
    else process.env.NODE_DEBUG = originalNodeDebug;
  });

  test("completes overlapping real routes when a Profile owner captures its own frame", async () => {
    delete process.env.NODE_DEBUG;
    let providerCalls = 0;
    const failProvider = () => {
      providerCalls += 1;
      return Promise.reject(new Error("synthetic provider disabled"));
    };
    const bggClient = {
      isConfigured: () => true,
      searchGames: () => failProvider(),
      getGame: () => failProvider(),
      getGames: () => failProvider(),
      getUserCollection: () => failProvider(),
      getPlayCount: () => failProvider(),
    };

    const createContext = async () => {
      const root = await mkdtemp(join(tmpdir(), "profile-snapshot-concurrency-"));
      const cache = await createJevPairCache(join(root, "sqlite-cache"));
      const ctx = createTestApp({
        dataDir: join(root, "files"),
        configPath: join(root, "files", "config.json"),
        fileOps: createFileOps(),
        jevPairCache: cache,
        bggClient,
        now: () => "2026-10-04T00:00:00.000Z",
      });
      await ctx.storageService.hydrateSourceVector?.();
      await ctx.gameService.addGame({ name: "SYNTHETIC-VW58-ALPHA" });
      await ctx.gameService.addGame({ name: "SYNTHETIC-VW58-BETA" });
      await ctx.axisService.createAxis({
        name: "SYNTHETIC-VW58-AXIS",
        weight: 100,
        source: "personal",
      });
      await ctx.storageService.hydrateSourceVector?.();
      return { root, cache, ctx };
    };

    const control = await createContext();
    cleanup = async () => {
      control.cache.close();
      await rm(control.root, { recursive: true, force: true });
    };
    const controlProfile = await control.ctx.app.request("http://localhost/api/profile");
    const controlSnapshot = await control.ctx.app.request(
      "http://localhost/api/collection/snapshot",
    );
    expect(controlProfile.status).toBe(200);
    expect(controlSnapshot.status).toBe(200);
    expect(CollectionProfileResultSchema.safeParse(await controlProfile.json()).success).toBe(true);
    const controlSnapshotBody: unknown = await controlSnapshot.json();
    expect(CollectionSnapshotSchema.safeParse(controlSnapshotBody).success).toBe(true);
    expect((controlSnapshotBody as { games: unknown[] }).games).toHaveLength(2);
    expect(providerCalls).toBe(0);

    await cleanup();
    cleanup = null;

    const run = await createContext();
    cleanup = async () => {
      run.cache.close();
      await rm(run.root, { recursive: true, force: true });
    };
    const prepGate = gate();
    const originalPrepare = run.ctx.predictionService.preparePredictionListFromSnapshot?.bind(
      run.ctx.predictionService,
    );
    if (!originalPrepare)
      throw new Error("Snapshot prediction preparation unavailable in test app");
    let prepCalls = 0;
    run.ctx.predictionService.preparePredictionListFromSnapshot = async (...args) => {
      prepCalls += 1;
      prepGate.enter();
      await prepGate.promise;
      return originalPrepare(...args);
    };
    const snapshotRequest = run.ctx.app.request("http://localhost/api/collection/snapshot");
    await prepGate.reached;

    const coordinator = profileSourceCoordinatorFor(run.ctx.storageService);
    const realRunExclusive = coordinator.runExclusive.bind(coordinator);
    let observeNextRequest = false;
    let signalQueuedCapture!: () => void;
    const queuedCapture = new Promise<void>((resolve) => (signalQueuedCapture = resolve));
    coordinator.runExclusive = ((operation: () => Promise<unknown>) => {
      if (observeNextRequest) {
        observeNextRequest = false;
        signalQueuedCapture();
      }
      return realRunExclusive(operation);
    }) as typeof coordinator.runExclusive;

    const profileConfigGate = gate();
    const cancelProfileOwner = deferred<void>();
    let configGateArmed = true;
    const originalLoadConfig = run.ctx.storageService.loadConfig.bind(run.ctx.storageService);
    run.ctx.storageService.loadConfig = async (...args) => {
      if (configGateArmed) {
        configGateArmed = false;
        profileConfigGate.enter();
        await profileConfigGate.promise;
      }
      return originalLoadConfig(...args);
    };
    const profileRequest = run.ctx.app.request("http://localhost/api/profile");
    await profileConfigGate.reached;

    const privateDisplayedFitness = run.ctx
      .displayedFitnessService as PrivateDisplayedFitnessService;
    const originalScoringInput =
      privateDisplayedFitness.getScoringInputFromSnapshot.bind(privateDisplayedFitness);
    privateDisplayedFitness.getScoringInputFromSnapshot = async (...args) =>
      Promise.race([
        originalScoringInput(...args),
        cancelProfileOwner.promise.then(() => {
          throw new Error("synthetic owner cancellation for bounded test cleanup");
        }),
      ]);

    observeNextRequest = true;
    prepGate.release();
    const queuedObserved = await bounded(queuedCapture, 2_000);
    profileConfigGate.release();

    const responses = await bounded(Promise.all([profileRequest, snapshotRequest]));
    if (!responses.completed) {
      cancelProfileOwner.resolve();
      await bounded(Promise.allSettled([profileRequest, snapshotRequest]), 2_000);
    }
    expect(queuedObserved.completed).toBe(true);
    expect(responses.completed).toBe(true);
    if (!responses.completed) return;
    const [profileResponse, snapshotResponse] = responses.value;
    expect(profileResponse.status).toBe(200);
    expect(snapshotResponse.status).toBe(200);
    const profileBody: unknown = await profileResponse.json();
    expect(CollectionProfileResultSchema.safeParse(profileBody).success).toBe(true);
    expect((profileBody as { status: string }).status).toBe("available");
    const snapshotBody: unknown = await snapshotResponse.json();
    expect(CollectionSnapshotSchema.safeParse(snapshotBody).success).toBe(true);
    expect((snapshotBody as { games: unknown[] }).games).toHaveLength(2);
    expect(prepCalls).toBe(1);
    expect(providerCalls).toBe(0);

    const healthySnapshot = await run.ctx.app.request("http://localhost/api/collection/snapshot");
    expect(healthySnapshot.status).toBe(200);
    expect(CollectionSnapshotSchema.safeParse(await healthySnapshot.json()).success).toBe(true);

    const routeSummaries = logSpy.mock.calls.filter(
      (call: unknown[]) => call[1] === "collection snapshot request completed",
    );
    expect(routeSummaries).toHaveLength(3);
    const hasDetailedMessages = (calls: unknown[][]) =>
      calls.some((call) => {
        const message = call[1];
        return (
          typeof message === "string" &&
          /coordinator wait|source load attempt|phase attempt|cache publication enqueue|response validation enqueue|capture flight registered|profile source operation start/.test(
            message,
          )
        );
      });
    expect(
      hasDetailedMessages(logSpy.mock.calls) ||
        hasDetailedMessages(warnSpy.mock.calls) ||
        hasDetailedMessages(errorSpy.mock.calls),
    ).toBe(false);
  });
});
