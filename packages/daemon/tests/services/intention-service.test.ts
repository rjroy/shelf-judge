import { describe, expect, test } from "bun:test";
import {
  CollectionSchema,
  createInitialEntityMetadata,
  type Collection,
  type Game,
  type IntentionMutationResult,
} from "@shelf-judge/shared";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import {
  createIntentionService,
  completeIntentionFromPlayEvidence,
  isPlayEvidenceStale,
  type IntentionService,
} from "../../src/services/intention-service.js";
import type {
  CollectionPersistence,
  CollectionReader,
} from "../../src/services/storage-service.js";
import type { Logger } from "../../src/services/logger.js";

const observedAt = "2026-08-28T10:00:00.000Z";
const commandIds = {
  create: "10000000-0000-4000-8000-000000000001",
  resolve: "10000000-0000-4000-8000-000000000002",
  later: "10000000-0000-4000-8000-000000000003",
};

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    bggId: null,
    name: "Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: 0,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: observedAt,
    updatedAt: observedAt,
    ...overrides,
  };
}

function collection(sourceGame = game()): Collection {
  return {
    schemaVersion: 4,
    revision: 0,
    id: "collection",
    name: "Collection",
    axes: [],
    games: [sourceGame],
    intentions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

function harness(
  options: {
    source?: Collection;
    failSaves?: number;
    logger?: Logger;
    times?: string[];
  } = {},
) {
  let current = CollectionSchema.parse(options.source ?? collection());
  let failSaves = options.failSaves ?? 0;
  let saves = 0;
  const storage: CollectionReader & CollectionPersistence = {
    loadCollection: () => Promise.resolve(structuredClone(current)),
    saveCollection: (next) => {
      saves += 1;
      if (failSaves > 0) {
        failSaves -= 1;
        return Promise.reject(new Error("disk unavailable"));
      }
      current = structuredClone(next);
      return Promise.resolve();
    },
  };
  const coordinator = createCollectionMutationService({ storageService: storage });
  let clock = 0;
  let id = 0;
  const times = [...(options.times ?? [])];
  const serviceFor = (boundary = coordinator): IntentionService =>
    createIntentionService({
      collectionMutationService: boundary,
      now: () => times.shift() ?? `2026-08-28T10:00:0${clock++}.000Z`,
      createId: () => `intention-${++id}`,
      logger: options.logger,
    });
  return {
    storage,
    coordinator,
    makeService: serviceFor,
    restartService: () =>
      serviceFor(
        createCollectionMutationService({
          storageService: {
            loadCollection: () => storage.loadCollection(),
            saveCollection: (next) => storage.saveCollection(next),
          },
        }),
      ),
    snapshot: () => structuredClone(current),
    saves: () => saves,
  };
}

function accepted(result: IntentionMutationResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected accepted result, got ${result.error.code}`);
  return result;
}

describe("durable intention lifecycle", () => {
  test("play evidence is stale only for a strictly newer non-valid successful check", () => {
    for (const checkAt of ["2026-08-28T09:59:59.999Z", observedAt]) {
      expect(
        isPlayEvidenceStale(
          game({ latestPlayCountCheck: { status: "missing", observedAt: checkAt } }),
        ),
      ).toBe(false);
    }
    expect(
      isPlayEvidenceStale(
        game({
          latestPlayCountCheck: {
            status: "invalid",
            observedAt: "2026-08-28T10:00:00.001Z",
            evidence: { presence: "missing" },
          },
        }),
      ),
    ).toBe(true);
    expect(
      isPlayEvidenceStale(
        game({
          latestPlayCountCheck: {
            status: "valid",
            value: 0,
            observedAt: "2026-08-28T11:00:00.000Z",
          },
        }),
      ),
    ).toBe(false);
  });

  test("does not complete from evidence at the baseline observation time", () => {
    const source = collection(
      game({
        numPlays: 1,
        playCountEvidence: { status: "valid", value: 1, source: "manual", observedAt },
      }),
    );
    source.intentions.push({
      intentionId: "intention-1",
      gameId: "game-1",
      kind: "first-play",
      baseline: { playCount: 0, evidenceSource: "manual", observedAt },
      createdAt: observedAt,
      version: 1,
      resolution: null,
    });
    const sourceGame = source.games[0];
    if (sourceGame === undefined) throw new Error("Expected source game");
    expect(
      completeIntentionFromPlayEvidence(source, sourceGame, "2026-08-28T11:00:00.000Z"),
    ).toBeNull();
    expect(source.intentions[0]?.resolution).toBeNull();
  });

  test("creates first-play, remains time-invariant, completes, and later creates a new ID", async () => {
    const state = harness();
    const service = state.makeService();
    const created = accepted(
      await service.execute({
        type: "create",
        commandId: commandIds.create,
        gameId: "game-1",
        kind: "first-play",
        expectedActiveIntention: "absent",
      }),
    );
    expect(created.intention).toMatchObject({
      intentionId: "intention-1",
      version: 1,
      baseline: { playCount: 0, observedAt },
      resolution: null,
    });
    expect(
      await service.execute({
        type: "create",
        commandId: "10000000-0000-4000-8000-000000000099",
        gameId: "game-1",
        kind: "first-play",
        expectedActiveIntention: "absent",
        baseline: 99,
      }),
    ).toMatchObject({ ok: false, error: { code: "validation" } });
    const reads = [state.snapshot(), state.snapshot()];
    expect(reads[1].intentions).toEqual(reads[0].intentions);

    const completed = accepted(
      await service.execute({
        type: "complete",
        commandId: commandIds.resolve,
        gameId: "game-1",
        intentionId: created.intention.intentionId,
        expectedVersion: 1,
      }),
    );
    expect(completed.intention).toMatchObject({
      version: 2,
      resolution: { outcome: "completed", source: "owner-confirmed" },
    });
    const later = accepted(
      await service.execute({
        type: "create",
        commandId: commandIds.later,
        gameId: "game-1",
        kind: "first-play",
        expectedActiveIntention: "absent",
      }),
    );
    expect(later.intention.intentionId).toBe("intention-2");
  });

  test("derives first-play and replay eligibility from authoritative current evidence", async () => {
    for (const [sourceGame, requestedKind, reason] of [
      [game({ ownership: "previously-owned" }), "first-play", "not-owned"],
      [
        game({ playCountEvidence: { status: "missing", source: "manual", observedAt: null } }),
        "first-play",
        "missing-play-evidence",
      ],
      [
        game({
          playCountEvidence: {
            status: "invalid",
            evidence: { presence: "present", value: -1 },
            source: "manual",
            observedAt,
          },
        }),
        "first-play",
        "invalid-play-evidence",
      ],
      [
        game({
          playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt: null },
        }),
        "first-play",
        "missing-observation-time",
      ],
      [
        game({
          latestPlayCountCheck: { status: "missing", observedAt: "2026-08-28T11:00:00.000Z" },
        }),
        "first-play",
        "stale-play-evidence",
      ],
      [game(), "replay", "kind-mismatch"],
    ] as const) {
      const result = await harness({ source: collection(sourceGame) })
        .makeService()
        .execute({
          type: "create",
          commandId: commandIds.create,
          gameId: "game-1",
          kind: requestedKind,
          expectedActiveIntention: "absent",
        });
      expect(result).toMatchObject({ ok: false, error: { code: "ineligible-game", reason } });
    }

    const replayState = harness({
      source: collection(
        game({
          numPlays: 3,
          playCountEvidence: { status: "valid", value: 3, source: "manual", observedAt },
        }),
      ),
    });
    const replay = accepted(
      await replayState.makeService().execute({
        type: "create",
        commandId: commandIds.create,
        gameId: "game-1",
        kind: "replay",
        expectedActiveIntention: "absent",
      }),
    );
    expect(replay.intention.baseline.playCount).toBe(3);
    const duplicate = await replayState.makeService().execute({
      type: "create",
      commandId: commandIds.later,
      gameId: "game-1",
      kind: "replay",
      expectedActiveIntention: "absent",
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "active-intention-conflict" } });
  });

  test("rejects valid evidence without an observation time across restart without state or receipt", async () => {
    const state = harness({
      source: collection(
        game({
          playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt: null },
        }),
      ),
    });
    const before = state.snapshot();
    const command = {
      type: "create",
      commandId: commandIds.create,
      gameId: "game-1",
      kind: "first-play",
      expectedActiveIntention: "absent",
    } as const;

    for (const service of [state.makeService(), state.restartService()]) {
      expect(await service.execute(command)).toEqual({
        ok: false,
        commandId: commandIds.create,
        error: {
          code: "ineligible-game",
          gameId: "game-1",
          reason: "missing-observation-time",
        },
      });
      expect(state.snapshot()).toEqual(before);
    }
    expect(state.saves()).toBe(0);
  });

  test("replays the original result across restart and rejects changed command payload", async () => {
    const state = harness();
    const command = {
      type: "create",
      commandId: commandIds.create,
      gameId: "game-1",
      kind: "first-play",
      expectedActiveIntention: "absent",
    } as const;
    const original = await state.makeService().execute(command);
    const saveCount = state.saves();
    expect(await state.restartService().execute(command)).toEqual(original);
    expect(state.saves()).toBe(saveCount);
    expect(await state.makeService().execute({ ...command, kind: "replay" })).toMatchObject({
      ok: false,
      error: { code: "command-reuse" },
    });
    expect(state.snapshot().intentions).toHaveLength(1);
    expect(state.snapshot().commandReceipts).toHaveLength(1);
  });

  test("a persistence failure leaves no receipt or intention and retry creates exactly one", async () => {
    const state = harness({ failSaves: 1 });
    const command = {
      type: "create",
      commandId: commandIds.create,
      gameId: "game-1",
      kind: "first-play",
      expectedActiveIntention: "absent",
    } as const;
    expect(await state.makeService().execute(command)).toMatchObject({
      ok: false,
      error: { code: "persistence-failure" },
    });
    expect(state.snapshot().intentions).toEqual([]);
    accepted(await state.makeService().execute(command));
    expect(state.snapshot().intentions).toHaveLength(1);
    expect(state.snapshot().commandReceipts).toHaveLength(1);
  });

  test("manual play correction completes only for valid evidence strictly above baseline", async () => {
    const state = harness({
      source: collection(
        game({
          numPlays: 2,
          playCountEvidence: { status: "valid", value: 2, source: "manual", observedAt },
        }),
      ),
    });
    const service = state.makeService();
    accepted(
      await service.execute({
        type: "create",
        commandId: commandIds.create,
        gameId: "game-1",
        kind: "replay",
        expectedActiveIntention: "absent",
      }),
    );
    const lower = await service.setPlayCount("game-1", 1);
    const equal = await service.setPlayCount("game-1", 2);
    if (!lower.ok || !equal.ok) throw new Error("Expected newer manual corrections");
    expect(lower.linkedIntentionTransition).toBeNull();
    expect(equal.linkedIntentionTransition).toBeNull();
    const result = await service.setPlayCount("game-1", 3);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.game.playCountEvidence).toMatchObject({
      status: "valid",
      value: 3,
      source: "manual",
    });
    expect(result.linkedIntentionTransition?.resolution).toMatchObject({
      outcome: "completed",
      source: "observed-play-increase",
    });
  });

  test.each([
    ["equal", "2026-08-28T11:00:00.000Z"],
    ["older", "2026-08-28T10:59:59.999Z"],
  ])(
    "rejects an %s manual correction clock against authoritative evidence without mutation",
    async (_label, attemptedObservedAt) => {
      const source = collection(
        game({
          numPlays: 4,
          updatedAt: "2026-08-28T11:00:00.000Z",
          playCountEvidence: {
            status: "valid",
            value: 4,
            source: "bgg-collection",
            observedAt: "2026-08-28T11:00:00.000Z",
          },
          latestPlayCountCheck: {
            status: "valid",
            value: 4,
            observedAt: "2026-08-28T11:00:00.000Z",
          },
        }),
      );
      source.intentions.push({
        intentionId: "intention-1",
        gameId: "game-1",
        kind: "replay",
        baseline: { playCount: 4, evidenceSource: "manual", observedAt },
        createdAt: observedAt,
        version: 1,
        resolution: null,
      });
      const state = harness({ source, times: [attemptedObservedAt, attemptedObservedAt] });
      const before = state.snapshot();

      for (const service of [state.makeService(), state.restartService()]) {
        expect(await service.setPlayCount("game-1", 5)).toEqual({
          ok: false,
          error: {
            code: "non-monotonic-observation",
            gameId: "game-1",
            attemptedObservedAt,
            latestAcceptedAt: "2026-08-28T11:00:00.000Z",
          },
        });
        expect(state.snapshot()).toEqual(before);
      }
      expect(state.saves()).toBe(0);
    },
  );

  test("logs persisted active intention context for a rejected non-monotonic correction", async () => {
    const entries: unknown[][] = [];
    const logger: Logger = {
      log: (...args) => entries.push(args),
      warn: (...args) => entries.push(args),
      error: (...args) => entries.push(args),
    };
    const source = collection(
      game({
        updatedAt: "2026-08-28T11:00:00.000Z",
        playCountEvidence: {
          status: "valid",
          value: 4,
          source: "bgg-collection",
          observedAt: "2026-08-28T11:00:00.000Z",
        },
      }),
    );
    source.intentions.push({
      intentionId: "persisted-active-intention",
      gameId: "game-1",
      kind: "replay",
      baseline: { playCount: 4, evidenceSource: "manual", observedAt },
      createdAt: observedAt,
      version: 1,
      resolution: null,
    });
    const state = harness({
      source,
      logger,
      times: ["2026-08-28T11:00:00.000Z"],
    });
    const before = state.snapshot();

    expect(await state.makeService().setPlayCount("game-1", 5)).toMatchObject({
      ok: false,
      error: { code: "non-monotonic-observation" },
    });

    expect(
      entries.filter(([message]) => message === "automatic intention transition attempt"),
    ).toEqual([
      [
        "automatic intention transition attempt",
        {
          trigger: "owner-correction",
          gameId: "game-1",
          intentionId: "persisted-active-intention",
          priorState: "active",
          priorVersion: 1,
        },
      ],
    ]);
    expect(
      entries.filter(([message]) => message === "automatic intention transition outcome"),
    ).toEqual([
      [
        "automatic intention transition outcome",
        {
          trigger: "owner-correction",
          gameId: "game-1",
          intentionId: "persisted-active-intention",
          priorState: "active",
          priorVersion: 1,
          result: "non-monotonic-observation",
          version: 1,
          persisted: false,
        },
      ],
    ]);
    expect(state.snapshot()).toEqual(before);
    expect(state.saves()).toBe(0);
    expect(state.snapshot().commandReceipts).toEqual([]);
  });

  test.each(["resolved history", "no intention history"] as const)(
    "logs no active target without a fabricated ID for %s",
    async (history) => {
      const entries: unknown[][] = [];
      const logger: Logger = {
        log: (...args) => entries.push(args),
        warn: (...args) => entries.push(args),
        error: (...args) => entries.push(args),
      };
      const source = collection(
        game({
          updatedAt: "2026-08-28T11:00:00.000Z",
          playCountEvidence: {
            status: "valid",
            value: 4,
            source: "manual",
            observedAt: "2026-08-28T11:00:00.000Z",
          },
        }),
      );
      if (history === "resolved history") {
        source.intentions.push({
          intentionId: "resolved-intention-must-not-be-logged",
          gameId: "game-1",
          kind: "replay",
          baseline: { playCount: 3, evidenceSource: "manual", observedAt },
          createdAt: observedAt,
          version: 2,
          resolution: {
            outcome: "completed",
            source: "owner-confirmed",
            resolvedAt: "2026-08-28T10:30:00.000Z",
          },
        });
      }
      const state = harness({
        source,
        logger,
        times: ["2026-08-28T10:59:59.999Z"],
      });
      const before = state.snapshot();

      expect(await state.makeService().setPlayCount("game-1", 5)).toMatchObject({
        ok: false,
        error: { code: "non-monotonic-observation" },
      });

      const attempts = entries.filter(
        ([message]) => message === "automatic intention transition attempt",
      );
      const outcomes = entries.filter(
        ([message]) => message === "automatic intention transition outcome",
      );
      expect(attempts).toEqual([
        [
          "automatic intention transition attempt",
          {
            trigger: "owner-correction",
            gameId: "game-1",
            intentionId: null,
            priorState: "none",
            priorVersion: null,
          },
        ],
      ]);
      expect(outcomes).toEqual([
        [
          "automatic intention transition outcome",
          {
            trigger: "owner-correction",
            gameId: "game-1",
            intentionId: null,
            priorState: "none",
            priorVersion: null,
            result: "non-monotonic-observation",
            version: null,
            persisted: false,
          },
        ],
      ]);
      expect(JSON.stringify(entries)).not.toContain("resolved-intention-must-not-be-logged");
      expect(state.snapshot()).toEqual(before);
      expect(state.saves()).toBe(0);
      expect(state.snapshot().commandReceipts).toEqual([]);
    },
  );

  test("accepts a strictly newer manual correction and preserves the factual BGG check", async () => {
    const source = collection(
      game({
        numPlays: 4,
        updatedAt: "2026-08-28T11:00:00.000Z",
        playCountEvidence: {
          status: "valid",
          value: 4,
          source: "bgg-collection",
          observedAt: "2026-08-28T11:00:00.000Z",
        },
        latestPlayCountCheck: {
          status: "valid",
          value: 4,
          observedAt: "2026-08-28T11:00:00.000Z",
        },
      }),
    );
    const state = harness({ source, times: ["2026-08-28T12:00:00.000Z"] });
    const result = await state.makeService().setPlayCount("game-1", 3);
    expect(result).toMatchObject({
      ok: true,
      game: {
        playCountEvidence: {
          status: "valid",
          value: 3,
          source: "manual",
          observedAt: "2026-08-28T12:00:00.000Z",
        },
        latestPlayCountCheck: {
          status: "valid",
          value: 4,
          observedAt: "2026-08-28T11:00:00.000Z",
        },
      },
      linkedIntentionTransition: null,
    });
  });

  test("complete and retire race has exactly one winner and stale loser sees current state", async () => {
    const state = harness();
    const service = state.makeService();
    const created = accepted(
      await service.execute({
        type: "create",
        commandId: commandIds.create,
        gameId: "game-1",
        kind: "first-play",
        expectedActiveIntention: "absent",
      }),
    );
    const [complete, retire] = await Promise.all([
      service.execute({
        type: "complete",
        commandId: commandIds.resolve,
        gameId: "game-1",
        intentionId: created.intention.intentionId,
        expectedVersion: 1,
      }),
      service.execute({
        type: "retire",
        commandId: commandIds.later,
        gameId: "game-1",
        intentionId: created.intention.intentionId,
        expectedVersion: 1,
      }),
    ]);
    expect([complete, retire].filter((result) => result.ok)).toHaveLength(1);
    const loser = [complete, retire].find((result) => !result.ok);
    expect(loser).toMatchObject({
      ok: false,
      error: { code: "stale-version", current: { version: 2 } },
    });
    expect(state.snapshot().intentions).toHaveLength(1);
  });

  test("logs seam identifiers and state without unrelated collection contents", async () => {
    const entries: unknown[][] = [];
    const logger: Logger = {
      log: (...args) => entries.push(args),
      warn: (...args) => entries.push(args),
      error: (...args) => entries.push(args),
    };
    const source = collection();
    source.games.push(game({ id: "unrelated", name: "SECRET UNRELATED GAME" }));
    const service = harness({ source, logger }).makeService();
    await service.execute({
      type: "create",
      commandId: commandIds.create,
      gameId: "game-1",
      kind: "first-play",
      expectedActiveIntention: "absent",
    });
    await service.setPlayCount("game-1", 1);
    const log = JSON.stringify(entries);
    expect(log).toContain(commandIds.create);
    expect(log).toContain("game-1");
    expect(log).toContain("active");
    expect(log).not.toContain("SECRET UNRELATED GAME");
    const automaticAttempts = entries.filter(
      ([message]) => message === "automatic intention transition attempt",
    );
    const automaticOutcomes = entries.filter(
      ([message]) => message === "automatic intention transition outcome",
    );
    expect(automaticAttempts).toHaveLength(1);
    expect(automaticOutcomes).toHaveLength(1);
    expect(automaticAttempts[0]?.[1]).toEqual({
      trigger: "owner-correction",
      gameId: "game-1",
      intentionId: "intention-1",
      priorState: "active",
      priorVersion: 1,
    });
    expect(automaticOutcomes[0]?.[1]).toEqual({
      trigger: "owner-correction",
      gameId: "game-1",
      intentionId: "intention-1",
      priorState: "active",
      priorVersion: 1,
      result: "completed",
      version: 2,
      persisted: true,
    });
  });

  test("logs serialized owner-command context for success, replay, and conflicts", async () => {
    const entries: unknown[][] = [];
    const logger: Logger = {
      log: (...args) => entries.push(args),
      warn: (...args) => entries.push(args),
      error: (...args) => entries.push(args),
    };
    const service = harness({ logger }).makeService();
    const create = {
      type: "create",
      commandId: commandIds.create,
      gameId: "game-1",
      kind: "first-play",
      expectedActiveIntention: "absent",
    } as const;
    const created = accepted(await service.execute(create));
    await service.execute(create);
    await service.execute({ ...create, commandId: commandIds.later });
    accepted(
      await service.execute({
        type: "complete",
        commandId: commandIds.resolve,
        gameId: "game-1",
        intentionId: created.intention.intentionId,
        expectedVersion: 1,
      }),
    );
    for (const [type, commandId] of [
      ["complete", "10000000-0000-4000-8000-000000000004"],
      ["retire", "10000000-0000-4000-8000-000000000005"],
    ] as const) {
      await service.execute({
        type,
        commandId,
        gameId: "game-1",
        intentionId: created.intention.intentionId,
        expectedVersion: 1,
      });
    }

    const attempts = entries.filter(([message]) => message === "intention transition attempt");
    const outcomes = entries.filter(([message]) => message === "intention transition outcome");
    expect(attempts.map(([, context]) => context)).toEqual([
      expect.objectContaining({ priorState: "none", priorVersion: null, intentionId: null }),
      expect.objectContaining({ priorState: "active", priorVersion: 1 }),
      expect.objectContaining({ priorState: "active", priorVersion: 1 }),
      expect.objectContaining({ priorState: "active", priorVersion: 1 }),
      expect.objectContaining({ priorState: "resolved", priorVersion: 2 }),
      expect.objectContaining({ priorState: "resolved", priorVersion: 2 }),
    ]);
    expect(outcomes.map(([, context]) => context)).toEqual([
      expect.objectContaining({ result: "active", version: 1, persisted: true }),
      expect.objectContaining({ result: "replayed", version: 1, persisted: false }),
      expect.objectContaining({
        result: "active-intention-conflict",
        version: 1,
        persisted: false,
      }),
      expect.objectContaining({ result: "completed", version: 2, persisted: true }),
      expect.objectContaining({ result: "stale-version", version: 2, persisted: false }),
      expect.objectContaining({ result: "stale-version", version: 2, persisted: false }),
    ]);
  });
});
