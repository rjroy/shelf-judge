import { describe, expect, test } from "bun:test";
import type {
  Collection,
  Acquisition,
  EntertainmentBenchmark,
  FitnessResult,
  Game,
  GameWithScore,
} from "@shelf-judge/shared";
import {
  createPurchaseUtilizationService,
  PurchaseUtilizationValidationError,
} from "../../src/services/purchase-utilization-service.js";
import type { Logger } from "../../src/services/logger.js";
import type { StorageService } from "../../src/services/storage-service.js";

const initialTime = "2026-01-01T00:00:00.000Z";
const changedTime = "2026-02-02T00:00:00.000Z";

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    bggId: null,
    name: "Test Game",
    yearPublished: null,
    minPlayers: 2,
    maxPlayers: 2,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: 1,
    acquisition: { state: "unknown" },
    playCountEvidence: {
      status: "valid",
      value: 1,
      source: "bgg-collection",
      observedAt: initialTime,
    },
    durationEvidence: {
      status: "valid",
      value: 60,
      source: "bgg-thing",
      observedAt: initialTime,
    },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 2, maxPlayers: 2 },
      source: "bgg-player-range",
      observedAt: initialTime,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "empty",
      buckets: [],
      source: "bgg-suggested-player-poll",
      observedAt: initialTime,
    },
    bestPlayersInvalidEvidence: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: initialTime,
    updatedAt: initialTime,
    ...overrides,
  };
}

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    schemaVersion: 3,
    id: "collection-1",
    name: "Test",
    axes: [],
    games: [game()],
    entertainmentBenchmark: null,
    createdAt: initialTime,
    updatedAt: initialTime,
    ...overrides,
  };
}

function score(value: number, overrides: Partial<FitnessResult> = {}): FitnessResult {
  return {
    score: value,
    ratedAxisCount: 1,
    totalAxisCount: 1,
    breakdown: [],
    vetoed: value === 0,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: null,
    redundancyAdjustment: null,
    ...overrides,
  };
}

function harness(options: { initial?: Collection; failSave?: boolean } = {}) {
  let stored = structuredClone(options.initial ?? collection());
  const saved: Collection[] = [];
  let clockCalls = 0;
  let loadCalls = 0;
  const logs: unknown[][] = [];
  const logger: Logger = {
    log: (...args) => logs.push(args),
    warn: (...args) => logs.push(args),
    error: (...args) => logs.push(args),
  };
  const storage = {
    loadCollection: () => {
      loadCalls += 1;
      return Promise.resolve(structuredClone(stored));
    },
    saveCollection: (next: Collection) => {
      saved.push(structuredClone(next));
      if (options.failSave) return Promise.reject(new Error("disk unavailable"));
      stored = structuredClone(next);
      return Promise.resolve();
    },
  } as StorageService;
  const service = createPurchaseUtilizationService({
    storageService: storage,
    now: () => {
      clockCalls += 1;
      return changedTime;
    },
    logger,
  });
  return {
    service,
    saved,
    logs,
    stored: () => structuredClone(stored),
    clockCalls: () => clockCalls,
    loadCalls: () => loadCalls,
  };
}

function concurrentHarness(initial: Collection, failFirstSave = false) {
  let stored = structuredClone(initial);
  let loadCount = 0;
  let saveCount = 0;
  let releaseFirstSave = () => {};
  let signalFirstSaveStarted = () => {};
  const firstSaveRelease = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });
  const firstSaveStarted = new Promise<void>((resolve) => {
    signalFirstSaveStarted = resolve;
  });
  const storage = {
    loadCollection: () => {
      loadCount += 1;
      return Promise.resolve(structuredClone(stored));
    },
    saveCollection: async (next: Collection) => {
      saveCount += 1;
      if (saveCount === 1) {
        signalFirstSaveStarted();
        await firstSaveRelease;
        if (failFirstSave) throw new Error("first save failed");
      }
      stored = structuredClone(next);
    },
  } as StorageService;
  return {
    service: createPurchaseUtilizationService({ storageService: storage }),
    firstSaveStarted,
    releaseFirstSave,
    stored: () => structuredClone(stored),
    loadCount: () => loadCount,
    saveCount: () => saveCount,
  };
}

describe("PurchaseUtilizationService mutations", () => {
  test("rejects malformed direct mutation inputs before load, clock, or save effects", async () => {
    const cases: Array<{
      call: (ctx: ReturnType<typeof harness>) => Promise<unknown>;
      code: "invalid_acquisition_request" | "invalid_benchmark_request";
    }> = [
      {
        call: (ctx) => ctx.service.setAcquisition("game-1", { state: "gift", amount: "1.00" }),
        code: "invalid_acquisition_request",
      },
      {
        call: (ctx) => ctx.service.setAcquisition("game-1", { state: "purchase" }),
        code: "invalid_acquisition_request",
      },
      {
        call: (ctx) => ctx.service.setEntertainmentBenchmark({ amount: "0", extra: true }),
        code: "invalid_benchmark_request",
      },
      {
        call: (ctx) => ctx.service.setEntertainmentBenchmark({ amount: "0" }),
        code: "invalid_benchmark_request",
      },
    ];

    for (const testCase of cases) {
      const ctx = harness();
      try {
        await testCase.call(ctx);
        throw new Error("Expected mutation to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(PurchaseUtilizationValidationError);
        expect((error as PurchaseUtilizationValidationError).code).toBe(testCase.code);
      }
      expect(ctx.loadCalls()).toBe(0);
      expect(ctx.clockCalls()).toBe(0);
      expect(ctx.saved).toHaveLength(0);
      expect(
        ctx.logs.some(
          ([, fields]) =>
            typeof fields === "object" &&
            fields !== null &&
            "validationCode" in fields &&
            fields.validationCode === testCase.code,
        ),
      ).toBe(true);
    }
  });

  test("serializes concurrent acquisitions for different games", async () => {
    const ctx = concurrentHarness(
      collection({ games: [game(), game({ id: "game-2", name: "Second Game" })] }),
    );
    const first = ctx.service.setAcquisition("game-1", { state: "gift" });
    await ctx.firstSaveStarted;
    const second = ctx.service.setAcquisition("game-2", {
      state: "purchase",
      amount: "12.34",
    });
    await Promise.resolve();
    expect(ctx.loadCount()).toBe(1);
    ctx.releaseFirstSave();
    await Promise.all([first, second]);

    const stored = ctx.stored();
    expect(stored.games.find(({ id }) => id === "game-1")?.acquisition).toEqual({
      state: "gift",
    });
    expect(stored.games.find(({ id }) => id === "game-2")?.acquisition).toMatchObject({
      state: "purchase",
      amount: { hundredths: 1234 },
    });
    expect(ctx.loadCount()).toBe(2);
    expect(ctx.saveCount()).toBe(2);
  });

  test("serializes concurrent benchmark and acquisition mutations", async () => {
    const ctx = concurrentHarness(collection());
    const benchmark = ctx.service.setEntertainmentBenchmark({ amount: "8.00" });
    await ctx.firstSaveStarted;
    const acquisition = ctx.service.setAcquisition("game-1", { state: "gift" });
    await Promise.resolve();
    expect(ctx.loadCount()).toBe(1);
    ctx.releaseFirstSave();
    await Promise.all([benchmark, acquisition]);

    expect(ctx.stored().entertainmentBenchmark).toMatchObject({
      state: "configured",
      amount: { hundredths: 800 },
    });
    expect(ctx.stored().games[0].acquisition).toEqual({ state: "gift" });
  });

  test("failed mutation releases the queue for the next mutation", async () => {
    const ctx = concurrentHarness(collection(), true);
    const failed = ctx.service.setAcquisition("game-1", { state: "gift" });
    await ctx.firstSaveStarted;
    const next = ctx.service.setEntertainmentBenchmark({ amount: "8.00" });
    ctx.releaseFirstSave();
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(failed).rejects.toThrow("first save failed");
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().resolves is thenable
    await expect(next).resolves.toMatchObject({
      state: "configured",
      amount: { hundredths: 800 },
    });
    expect(ctx.stored().games[0].acquisition).toEqual({ state: "unknown" });
    expect(ctx.stored().entertainmentBenchmark).toMatchObject({
      state: "configured",
      amount: { hundredths: 800 },
    });
    expect(ctx.loadCount()).toBe(2);
    expect(ctx.saveCount()).toBe(2);
  });

  test("rejected mutation releases the queue for the next mutation", async () => {
    const ctx = harness();
    const rejected = ctx.service.setEntertainmentBenchmark({ amount: "invalid" });
    const next = ctx.service.setAcquisition("game-1", { state: "gift" });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(rejected).rejects.toThrow();
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().resolves is thenable
    await expect(next).resolves.toMatchObject({ acquisition: { state: "gift" } });
    expect(ctx.stored().entertainmentBenchmark).toBeNull();
    expect(ctx.stored().games[0].acquisition).toEqual({ state: "gift" });
    expect(ctx.saved).toHaveLength(1);
  });

  test("sets unknown, gift, zero purchase, and positive purchase with manual provenance", async () => {
    const states: Array<{
      input: { state: "gift" } | { state: "unknown" } | { state: "purchase"; amount: string };
      expected: Acquisition;
    }> = [
      { input: { state: "gift" } as const, expected: { state: "gift" } },
      {
        input: { state: "purchase", amount: "0" } as const,
        expected: {
          state: "purchase",
          amount: { hundredths: 0, source: "manual", confirmedAt: changedTime },
        },
      },
      {
        input: { state: "purchase", amount: "12.34" } as const,
        expected: {
          state: "purchase",
          amount: { hundredths: 1234, source: "manual", confirmedAt: changedTime },
        },
      },
      { input: { state: "unknown" } as const, expected: { state: "unknown" } },
    ];

    for (const { input, expected } of states) {
      const ctx = harness({
        initial:
          input.state === "unknown"
            ? collection({ games: [game({ acquisition: { state: "gift" } })] })
            : undefined,
      });
      const updated = await ctx.service.setAcquisition("game-1", input);
      expect(updated.acquisition).toEqual(expected);
      expect(updated.updatedAt).toBe(changedTime);
      expect(ctx.stored().updatedAt).toBe(changedTime);
      expect(ctx.saved).toHaveLength(1);
      expect(ctx.clockCalls()).toBe(1);
    }
  });

  test("corrects persisted invalid variants only after valid normalization", async () => {
    const invalid = collection({
      games: [
        game({
          acquisition: {
            state: "invalid",
            evidence: { presence: "present", value: { amount: "private-value" } },
          },
        }),
      ],
    });
    const ctx = harness({ initial: invalid });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      ctx.service.setAcquisition("game-1", { state: "purchase", amount: "1.234" }),
    ).rejects.toThrow();
    expect(ctx.stored()).toEqual(invalid);
    expect(ctx.saved).toHaveLength(0);
    expect(ctx.clockCalls()).toBe(0);

    const corrected = await ctx.service.setAcquisition("game-1", {
      state: "purchase",
      amount: "1.23",
    });
    expect(corrected.acquisition).toEqual({
      state: "purchase",
      amount: { hundredths: 123, source: "manual", confirmedAt: changedTime },
    });
  });

  test("normalized acquisition no-op preserves timestamps and skips persistence and clock", async () => {
    const existing = collection({
      games: [
        game({
          acquisition: {
            state: "purchase",
            amount: { hundredths: 500, source: "manual", confirmedAt: initialTime },
          },
        }),
      ],
    });
    const ctx = harness({ initial: existing });
    const result = await ctx.service.setAcquisition("game-1", {
      state: "purchase",
      amount: "5.0",
    });
    expect(result.updatedAt).toBe(initialTime);
    expect(result.acquisition).toEqual(existing.games[0].acquisition);
    expect(ctx.stored()).toEqual(existing);
    expect(ctx.saved).toHaveLength(0);
    expect(ctx.clockCalls()).toBe(0);
  });

  test("missing game and persistence failure leave durable state unchanged", async () => {
    const missing = harness();
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(missing.service.setAcquisition("missing", { state: "gift" })).rejects.toThrow(
      "Game not found",
    );
    expect(missing.saved).toHaveLength(0);
    expect(missing.clockCalls()).toBe(0);

    const original = collection();
    const failing = harness({ initial: original, failSave: true });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(failing.service.setAcquisition("game-1", { state: "gift" })).rejects.toThrow(
      "disk unavailable",
    );
    expect(failing.stored()).toEqual(original);
  });

  test("sets, corrects, clears, and no-ops the benchmark", async () => {
    const ctx = harness();
    expect(await ctx.service.setEntertainmentBenchmark({ amount: "8" })).toEqual({
      state: "configured",
      amount: { hundredths: 800, source: "manual", confirmedAt: changedTime },
    });
    expect(ctx.saved).toHaveLength(1);

    const persistedTimestamp = ctx.stored().updatedAt;
    await ctx.service.setEntertainmentBenchmark({ amount: "8.00" });
    expect(ctx.saved).toHaveLength(1);
    expect(ctx.stored().updatedAt).toBe(persistedTimestamp);

    await ctx.service.clearEntertainmentBenchmark();
    expect(ctx.stored().entertainmentBenchmark).toBeNull();
    expect(ctx.saved).toHaveLength(2);
    await ctx.service.clearEntertainmentBenchmark();
    expect(ctx.saved).toHaveLength(2);
  });

  test("rejects zero benchmark and preserves an invalid persisted benchmark", async () => {
    const invalidBenchmark: EntertainmentBenchmark = {
      state: "invalid",
      evidence: { presence: "present", value: "private-value" },
    };
    const ctx = harness({ initial: collection({ entertainmentBenchmark: invalidBenchmark }) });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(ctx.service.setEntertainmentBenchmark({ amount: "0.00" })).rejects.toThrow(
      "Validation failed",
    );
    expect(ctx.stored().entertainmentBenchmark).toEqual(invalidBenchmark);
    expect(ctx.saved).toHaveLength(0);
  });

  test("benchmark persistence failure logs the collection transition and preserves durable state", async () => {
    const original = collection({
      entertainmentBenchmark: {
        state: "configured",
        amount: { hundredths: 500, source: "manual", confirmedAt: initialTime },
      },
    });
    const ctx = harness({ initial: original, failSave: true });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(ctx.service.setEntertainmentBenchmark({ amount: "8.00" })).rejects.toThrow(
      "disk unavailable",
    );
    expect(ctx.stored()).toEqual(original);
    expect(ctx.logs).toContainEqual([
      "benchmark persistence attempt",
      {
        collectionId: "collection-1",
        previousState: "configured",
        nextState: "configured",
        changedFields: ["entertainmentBenchmark", "updatedAt"],
      },
    ]);
    expect(ctx.logs).toContainEqual([
      "benchmark persistence failed",
      {
        collectionId: "collection-1",
        previousState: "configured",
        nextState: "configured",
        changedFields: ["entertainmentBenchmark", "updatedAt"],
        outcome: "failed",
      },
    ]);
  });

  test("benchmark logs include safe transitions, outcomes, and service validation codes", async () => {
    const ctx = harness();
    await ctx.service.setEntertainmentBenchmark({ amount: "8.00" });
    await ctx.service.clearEntertainmentBenchmark();
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(ctx.service.setEntertainmentBenchmark({ amount: "0" })).rejects.toThrow();
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(ctx.service.setEntertainmentBenchmark({ amount: "invalid" })).rejects.toThrow();

    expect(ctx.logs).toContainEqual([
      "benchmark mutation attempt",
      { collectionId: "collection-1", previousState: "unknown", nextState: "configured" },
    ]);
    expect(ctx.logs).toContainEqual([
      "benchmark persistence completed",
      {
        collectionId: "collection-1",
        previousState: "unknown",
        nextState: "configured",
        changedFields: ["entertainmentBenchmark", "updatedAt"],
        outcome: "persisted",
      },
    ]);
    expect(ctx.logs).toContainEqual([
      "benchmark mutation completed",
      {
        collectionId: "collection-1",
        previousState: "configured",
        nextState: "unknown",
        changed: true,
        changedFields: ["entertainmentBenchmark", "updatedAt"],
        outcome: "changed",
      },
    ]);
    expect(ctx.logs).toContainEqual([
      "benchmark mutation rejected",
      {
        collectionId: "collection",
        previousState: "unavailable",
        nextState: "configured",
        changedFields: ["entertainmentBenchmark"],
        outcome: "rejected",
        validationCode: "invalid_benchmark_request",
      },
    ]);
    expect(JSON.stringify(ctx.logs)).not.toContain("8.00");
  });

  test("logs mutation seams without amount strings or stored values", async () => {
    const ctx = harness({
      initial: collection({
        games: [
          game({
            acquisition: {
              state: "invalid",
              evidence: { presence: "present", value: "never-log-this" },
            },
          }),
        ],
      }),
    });
    await ctx.service.setAcquisition("game-1", { state: "purchase", amount: "9876.54" });
    await ctx.service.setEntertainmentBenchmark({ amount: "123.45" });
    const serialized = JSON.stringify(ctx.logs);
    expect(serialized).not.toContain("9876.54");
    expect(serialized).not.toContain("123.45");
    expect(serialized).not.toContain("never-log-this");
    expect(serialized).toContain("mutation attempt");
    expect(serialized).toContain("mutation completed");
  });
});

describe("PurchaseUtilizationService response enrichment", () => {
  test("projects final score once and passes the exact display score into utilization", () => {
    const ctx = harness();
    const record = game({
      acquisition: {
        state: "purchase",
        amount: { hundredths: 2000, source: "manual", confirmedAt: initialTime },
      },
    });
    const input: GameWithScore = { game: record, score: score(7.95) };
    const [result] = ctx.service.enrichGames(
      [input],
      {
        state: "configured",
        amount: { hundredths: 800, source: "manual", confirmedAt: initialTime },
      },
      "detail",
    );
    expect(result.displayScore).toBe("8.0");
    expect(result.purchaseUtilization.evidence.fitness).toMatchObject({
      status: "valid",
      value: "8.0",
    });
    expect(result.score?.score).toBe(7.95);
    expect(input).not.toHaveProperty("displayScore");
  });

  test("keeps null score null and recalculates from benchmark without changing records", () => {
    const ctx = harness();
    const record = game({
      acquisition: {
        state: "purchase",
        amount: { hundredths: 2000, source: "manual", confirmedAt: initialTime },
      },
    });
    const snapshot = structuredClone(record);
    const [withoutScore] = ctx.service.enrichGames([{ game: record, score: null }], null, "detail");
    expect(withoutScore.displayScore).toBeNull();
    expect(withoutScore.purchaseUtilization.evidence.fitness.status).toBe("missing");

    const entry = { game: record, score: score(6) };
    const [low] = ctx.service.enrichGames(
      [entry],
      {
        state: "configured",
        amount: { hundredths: 100, source: "manual", confirmedAt: initialTime },
      },
      "list",
    );
    const [high] = ctx.service.enrichGames(
      [entry],
      {
        state: "configured",
        amount: { hundredths: 1000, source: "manual", confirmedAt: initialTime },
      },
      "list",
    );
    expect(low.purchaseUtilization.components.valueRemaining.display).not.toBe(
      high.purchaseUtilization.components.valueRemaining.display,
    );
    expect(record).toEqual(snapshot);
  });

  test("uses tournament-influenced and vetoed final fitness", () => {
    const ctx = harness();
    const record = game({
      acquisition: {
        state: "purchase",
        amount: { hundredths: 2000, source: "manual", confirmedAt: initialTime },
      },
    });
    const benchmark: EntertainmentBenchmark = {
      state: "configured",
      amount: { hundredths: 800, source: "manual", confirmedAt: initialTime },
    };
    const tournament = score(9, {
      breakdown: [
        {
          axisId: "tournament",
          axisName: "Tournament",
          weight: 100,
          contribution: 9,
          source: "tournament",
          derivedField: null,
          sourceValue: 9,
          scoringRawValue: 9,
          effectiveRating: 9,
          preferenceShape: "higher-is-better",
          curveAffected: false,
          unit: null,
          provenance: null,
          configurationSummary: null,
          overridden: false,
          overrideValue: null,
          predictionConfidence: null,
          referenceGames: null,
        },
      ],
    });
    const vetoed = score(0, { vetoed: true, hypotheticalScore: 9 });

    const [tournamentResult] = ctx.service.enrichGames(
      [{ game: record, score: tournament }],
      benchmark,
      "detail",
    );
    const [vetoedResult] = ctx.service.enrichGames(
      [{ game: record, score: vetoed }],
      benchmark,
      "detail",
    );
    expect(tournamentResult.displayScore).toBe("9.0");
    expect(tournamentResult.purchaseUtilization.evidence.fitness).toMatchObject({
      status: "valid",
      value: "9.0",
    });
    expect(tournamentResult.score?.breakdown[0]?.source).toBe("tournament");
    expect(vetoedResult.displayScore).toBe("0.0");
    expect(vetoedResult.purchaseUtilization.outcome).toBe("not-met");
    expect(vetoedResult.purchaseUtilization.components.valueRemaining.display).toBe("$20.00");
    expect(vetoedResult.purchaseUtilization.components.estimatedAdditionalPlays.outcome).toBe(
      "unreachable",
    );
  });

  test("fitness changes recalculate utilization without changing acquisition or evidence", () => {
    const ctx = harness();
    const record = game({
      acquisition: {
        state: "purchase",
        amount: { hundredths: 2000, source: "manual", confirmedAt: initialTime },
      },
    });
    const persistedInputs = {
      acquisition: structuredClone(record.acquisition),
      playCountEvidence: structuredClone(record.playCountEvidence),
      durationEvidence: structuredClone(record.durationEvidence),
      playerRangeEvidence: structuredClone(record.playerRangeEvidence),
      suggestedPlayerPoll: structuredClone(record.suggestedPlayerPoll),
    };
    const benchmark: EntertainmentBenchmark = {
      state: "configured",
      amount: { hundredths: 800, source: "manual", confirmedAt: initialTime },
    };
    const [low] = ctx.service.enrichGames([{ game: record, score: score(3) }], benchmark, "detail");
    const [high] = ctx.service.enrichGames(
      [{ game: record, score: score(9) }],
      benchmark,
      "detail",
    );
    expect(low.purchaseUtilization.components.valueRemaining.display).not.toBe(
      high.purchaseUtilization.components.valueRemaining.display,
    );
    expect({
      acquisition: record.acquisition,
      playCountEvidence: record.playCountEvidence,
      durationEvidence: record.durationEvidence,
      playerRangeEvidence: record.playerRangeEvidence,
      suggestedPlayerPoll: record.suggestedPlayerPoll,
    }).toEqual(persistedInputs);
  });

  test("calculates base game and expansion records independently", () => {
    const ctx = harness();
    const base = game({
      id: "base",
      name: "Base Game",
      acquisition: {
        state: "purchase",
        amount: { hundredths: 2000, source: "manual", confirmedAt: initialTime },
      },
    });
    const expansion = game({
      id: "expansion",
      name: "Base Game: Expansion",
      acquisition: {
        state: "purchase",
        amount: { hundredths: 6000, source: "manual", confirmedAt: initialTime },
      },
      numPlays: 10,
      playCountEvidence: {
        status: "valid",
        value: 10,
        source: "bgg-collection",
        observedAt: changedTime,
      },
    });
    const snapshots = structuredClone([base, expansion]);
    const results = ctx.service.enrichGames(
      [
        { game: base, score: score(6) },
        { game: expansion, score: score(6) },
      ],
      {
        state: "configured",
        amount: { hundredths: 800, source: "manual", confirmedAt: initialTime },
      },
      "list",
    );
    expect(results[0].purchaseUtilization.evidence.acquisition).toEqual(base.acquisition);
    expect(results[0].purchaseUtilization.evidence.playCount).toEqual(base.playCountEvidence);
    expect(results[1].purchaseUtilization.evidence.acquisition).toEqual(expansion.acquisition);
    expect(results[1].purchaseUtilization.evidence.playCount).toEqual(expansion.playCountEvidence);
    expect(results[0].purchaseUtilization.components.valueRemaining.display).not.toBe(
      results[1].purchaseUtilization.components.valueRemaining.display,
    );
    expect([base, expansion]).toEqual(snapshots);
  });

  test("logs only aggregate response outcomes without persisted amount values", () => {
    const ctx = harness();
    const paid = game({
      acquisition: {
        state: "purchase",
        amount: { hundredths: 987654, source: "manual", confirmedAt: initialTime },
      },
    });
    const gift = game({ id: "gift", acquisition: { state: "gift" } });
    ctx.service.enrichGames(
      [
        { game: paid, score: score(6) },
        { game: gift, score: score(6) },
      ],
      {
        state: "configured",
        amount: { hundredths: 123456, source: "manual", confirmedAt: initialTime },
      },
      "list",
    );
    expect(ctx.logs).toEqual([
      [
        "purchase utilization response enrichment completed",
        {
          responseKind: "list",
          gameCount: 2,
          outcomes: { "not-met": 1, "not-applicable": 1 },
        },
      ],
    ]);
    const serialized = JSON.stringify(ctx.logs);
    expect(serialized).not.toContain("987654");
    expect(serialized).not.toContain("123456");
  });
});
