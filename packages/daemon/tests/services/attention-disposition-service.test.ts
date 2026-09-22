import { describe, expect, test } from "bun:test";
import {
  CollectionSchema,
  createInitialEntityMetadata,
  type Collection,
  type DurableGame,
} from "@shelf-judge/shared";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import {
  createAttentionDispositionService,
  type CurrentAttentionSelection,
} from "../../src/services/attention-disposition-service.js";
import { clearIncompatibleAttentionDispositions } from "../../src/services/attention-disposition-compatibility.js";
import { createAttentionDispositionGlobalMaintenance } from "../../src/services/attention-disposition-maintenance.js";
import { createAttentionCandidateMaintenanceRecovery } from "../../src/services/attention-disposition-maintenance.js";
import type {
  CollectionPersistence,
  CollectionReader,
} from "../../src/services/storage-service.js";

const now = "2026-03-08T12:34:56.789Z";
const gameId = "a0000000-0000-4000-8000-000000000001";
const commandId = "20000000-0000-4000-8000-000000000001";
const fingerprint = "a".repeat(64);

function game(overrides: Partial<DurableGame> = {}): DurableGame {
  return {
    id: gameId,
    bggId: null,
    name: "Addressed game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: 0,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt: now },
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
    manualValues: { playingTime: null, playerCount: null },
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    ratings: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function collection(sourceGame = game()): Collection {
  return {
    schemaVersion: 8,
    revision: 0,
    id: "collection",
    name: "Collection",
    axes: [],
    games: [sourceGame],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: now,
    updatedAt: now,
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    operation: "not-now",
    commandId,
    gameId,
    ruleId: "underused-purchase",
    ruleVersion: 1,
    fingerprint,
    expectedVersion: 0,
    ...overrides,
  };
}

function selection(overrides: Partial<CurrentAttentionSelection> = {}): CurrentAttentionSelection {
  return { gameId, ruleId: "underused-purchase", ruleVersion: 1, fingerprint, ...overrides };
}

function harness(
  options: {
    source?: Collection;
    selected?: CurrentAttentionSelection | null;
    failSave?: boolean;
    persistThenReject?: boolean;
    maintenance?: "available" | "unavailable" | "throw";
  } = {},
) {
  let stored = CollectionSchema.parse(options.source ?? collection());
  let saves = 0;
  let selections = 0;
  let maintenanceCalls = 0;
  const storage: CollectionReader & CollectionPersistence = {
    loadCollection: () => Promise.resolve(structuredClone(stored)),
    saveCollection: (next) => {
      saves += 1;
      if (options.failSave) return Promise.reject(new Error("disk unavailable"));
      stored = structuredClone(next);
      if (options.persistThenReject) return Promise.reject(new Error("response lost"));
      return Promise.resolve();
    },
  };
  const maintenanceState = options.maintenance ?? "available";
  let selected = options.selected === undefined ? selection() : options.selected;
  const service = createAttentionDispositionService({
    collectionMutations: createCollectionMutationService({ storageService: storage }),
    clock: { now: () => new Date(now) },
    currentSelection: () => {
      selections += 1;
      return Promise.resolve(selected);
    },
    maintenance: {
      maintainAfterCollectionCommit: () => {
        maintenanceCalls += 1;
        if (maintenanceState === "throw") {
          return Promise.reject(new Error("candidate storage unavailable"));
        }
        return Promise.resolve({ state: maintenanceState });
      },
    },
  });
  return {
    service,
    mutations: createCollectionMutationService({ storageService: storage }),
    snapshot: () => structuredClone(stored),
    saves: () => saves,
    selections: () => selections,
    maintenanceCalls: () => maintenanceCalls,
    setSelection: (next: CurrentAttentionSelection | null) => {
      selected = next;
    },
    clearDispositionRetainingReceipts: () => {
      stored = { ...stored, attentionDispositions: [] };
    },
  };
}

function compatibilityHarness(source: Collection, winnerFingerprint = fingerprint) {
  let stored = CollectionSchema.parse(source);
  let saves = 0;
  let maintenance = 0;
  const storage: CollectionReader & CollectionPersistence = {
    loadCollection: () => Promise.resolve(structuredClone(stored)),
    saveCollection(next) {
      saves += 1;
      stored = structuredClone(next);
      return Promise.resolve();
    },
  };
  const mutations = createCollectionMutationService({
    storageService: storage,
    postCommitObserver: async () => {
      await Promise.resolve();
      maintenance += 1;
    },
  });
  mutations.setDispositionWinners(async (_prior, accepted, _context, gameIds) => {
    await Promise.resolve();
    return gameIds.flatMap((id) =>
      accepted.games.some((candidate) => candidate.id === id && candidate.ownership === "owned")
        ? [{ gameId: id, ruleId: "never-played", ruleVersion: 1, fingerprint: winnerFingerprint }]
        : [],
    );
  });
  return {
    mutations,
    snapshot: () => structuredClone(stored),
    saves: () => saves,
    maintenance: () => maintenance,
  };
}

describe("AttentionDispositionService", () => {
  test("table-drives declared local families through the collection boundary", async () => {
    const cases = [
      "shelf.game.plays.set",
      "game.bgg.refresh-failed",
      "purchase.acquisition.set",
      "game.intention.update",
    ] as const;
    for (const operation of cases) {
      const source = collection();
      source.attentionDispositions = [
        {
          gameId,
          kind: "intentional",
          ruleId: "never-played",
          ruleVersion: 1,
          fingerprint,
          version: 1,
        },
      ];
      const state = compatibilityHarness(source, "b".repeat(64));
      const outcome = await state.mutations.mutate(
        { operation, trigger: "dependency", gameIds: [gameId] },
        (candidate) => {
          candidate.name = `${operation} changed`;
          return { changed: true, value: undefined };
        },
      );
      expect(outcome.collection.revision).toBe(1);
      expect(state.snapshot().attentionDispositions).toEqual([]);
      expect(state.saves()).toBe(1);
      expect(state.maintenance()).toBe(1);
    }
  });

  test("preserves intentional state for unrelated and no-op mutations at the boundary", async () => {
    const source = collection();
    source.attentionDispositions = [
      {
        gameId,
        kind: "intentional",
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint,
        version: 1,
      },
    ];
    const state = compatibilityHarness(source, "b".repeat(64));
    await state.mutations.mutate(
      { operation: "game.dimensions.set", trigger: "unrelated", gameIds: [gameId] },
      (candidate) => {
        candidate.name = "unrelated";
        return { changed: true, value: undefined };
      },
    );
    await state.mutations.mutate(
      { operation: "game.intention.detail", trigger: "no-op", gameIds: [gameId] },
      () => ({ changed: false, value: undefined }),
    );
    expect(state.snapshot().attentionDispositions).toHaveLength(1);
    expect(state.saves()).toBe(1);
    expect(state.maintenance()).toBe(1);
  });

  test("clears both dispositions for ownership loss in one persisted revision", async () => {
    for (const disposition of [
      {
        gameId,
        kind: "snoozed" as const,
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint,
        responseAt: now,
        expiresAt: "2026-04-07T12:34:56.789Z",
        version: 1,
      },
      {
        gameId,
        kind: "intentional" as const,
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint,
        version: 1,
      },
    ]) {
      const source = collection();
      source.attentionDispositions = [disposition];
      const state = compatibilityHarness(source);
      await state.mutations.mutate(
        { operation: "game.remove", trigger: "ownership-loss", gameIds: [gameId] },
        (candidate) => {
          candidate.games = [];
          return { changed: true, value: undefined };
        },
      );
      expect(state.snapshot().attentionDispositions).toEqual([]);
      expect(state.snapshot().revision).toBe(1);
      expect(state.saves()).toBe(1);
    }
  });

  test("globally clears incompatible intentional state before one candidate rebuild and preserves snoozes", async () => {
    const source = collection();
    source.attentionDispositions = [
      {
        gameId,
        kind: "intentional",
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint,
        version: 1,
      },
    ];
    const state = compatibilityHarness(source);
    let fallbackMaintenances = 0;
    const maintain = createAttentionDispositionGlobalMaintenance({
      collectionMutations: state.mutations,
      winners: async () => {
        await Promise.resolve();
        return [{ gameId, ruleId: "never-played", ruleVersion: 2, fingerprint }];
      },
      maintainCandidates: async () => {
        await Promise.resolve();
        fallbackMaintenances += 1;
      },
    });
    await maintain({ kind: "global", reason: "tournament" });
    expect(state.snapshot().attentionDispositions).toEqual([]);
    expect(state.snapshot().revision).toBe(1);
    expect(state.saves()).toBe(1);
    expect(state.maintenance()).toBe(0);
    expect(fallbackMaintenances).toBe(1);
  });

  test("matching global state preserves the disposition and rebuilds once without a collection save", async () => {
    const source = collection();
    source.attentionDispositions = [
      {
        gameId,
        kind: "snoozed",
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint,
        responseAt: now,
        expiresAt: "2026-04-07T12:34:56.789Z",
        version: 1,
      },
    ];
    const state = compatibilityHarness(source);
    let rebuilds = 0;
    await createAttentionDispositionGlobalMaintenance({
      collectionMutations: state.mutations,
      winners: async () => {
        await Promise.resolve();
        return [];
      },
      maintainCandidates: async () => {
        await Promise.resolve();
        rebuilds += 1;
      },
    })({ kind: "global", reason: "prediction" });
    expect(state.snapshot().attentionDispositions).toHaveLength(1);
    expect(state.saves()).toBe(0);
    expect(state.maintenance()).toBe(0);
    expect(rebuilds).toBe(1);
  });

  test("clears ownership-loss and checked intentional mismatches without restoring receipts", () => {
    const prior = collection();
    prior.attentionDispositions = [
      {
        gameId,
        kind: "snoozed",
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint,
        responseAt: now,
        expiresAt: "2026-04-07T12:34:56.789Z",
        version: 1,
      },
    ];
    const ownershipLost = structuredClone(prior);
    ownershipLost.games = [];
    expect(clearIncompatibleAttentionDispositions(prior, ownershipLost, [], new Set())).toEqual([
      gameId,
    ]);
    expect(ownershipLost.attentionDispositions).toEqual([]);

    const intentional = collection();
    intentional.attentionDispositions = [
      {
        gameId,
        kind: "intentional",
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint,
        version: 1,
      },
    ];
    const changed = structuredClone(intentional);
    expect(
      clearIncompatibleAttentionDispositions(
        intentional,
        changed,
        [{ gameId, ruleId: "never-played", ruleVersion: 1, fingerprint: "b".repeat(64) }],
        new Set([gameId]),
      ),
    ).toEqual([gameId]);
    expect(changed.attentionDispositions).toEqual([]);
  });

  test("preserves snoozes and intentional dispositions outside a typed local impact", () => {
    const prior = collection();
    prior.attentionDispositions = [
      {
        gameId,
        kind: "snoozed",
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint,
        responseAt: now,
        expiresAt: "2026-04-07T12:34:56.789Z",
        version: 1,
      },
    ];
    const accepted = structuredClone(prior);
    expect(clearIncompatibleAttentionDispositions(prior, accepted, [], new Set<string>())).toEqual(
      [],
    );
    expect(accepted.attentionDispositions).toEqual(prior.attentionDispositions);
  });

  test("writes an exact 720-hour whole-game snooze and canonical durable receipt", async () => {
    const state = harness();
    const result = await state.service.execute(command());
    expect(result).toMatchObject({
      outcome: "accepted",
      receipt: { operation: "not-now", ruleVersion: 1 },
    });
    expect(state.snapshot().attentionDispositions).toEqual([
      {
        gameId,
        kind: "snoozed",
        ruleId: "underused-purchase",
        ruleVersion: 1,
        fingerprint,
        responseAt: now,
        expiresAt: "2026-04-07T12:34:56.789Z",
        version: 1,
      },
    ]);
    const receipt = state
      .snapshot()
      .commandReceipts.find(
        (candidate) =>
          "receiptType" in candidate && candidate.receiptType === "attention-disposition",
      );
    if (receipt === undefined || !("receiptType" in receipt)) {
      throw new Error("Expected durable attention receipt");
    }
    expect(receipt.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(state.snapshot().intentions).toEqual([]);
    expect(state.snapshot().games[0]?.ownership).toBe("owned");
  });

  test("writes an intentional suppression and runs exact-game maintenance after commit", async () => {
    const state = harness({ maintenance: "available" });
    expect(await state.service.execute(command({ operation: "intentional" }))).toMatchObject({
      outcome: "accepted",
    });
    expect(state.snapshot().attentionDispositions).toMatchObject([
      { kind: "intentional", version: 1, fingerprint },
    ]);
    expect(state.maintenanceCalls()).toBe(1);
  });

  test("replays only the canonical identical request without selection, save, or maintenance", async () => {
    const state = harness({ maintenance: "available" });
    const first = await state.service.execute(command());
    const replay = await state.service.execute(command());
    if (first.outcome === "rejected") throw new Error("Expected accepted first command");
    expect(replay).toEqual({ outcome: "replayed", receipt: first.receipt });
    expect(state.saves()).toBe(1);
    expect(state.selections()).toBe(1);
    expect(state.maintenanceCalls()).toBe(1);
  });

  test("rejects changed command-ID reuse without mutation", async () => {
    const state = harness();
    await state.service.execute(command());
    expect(await state.service.execute(command({ ruleVersion: 2 }))).toEqual({
      outcome: "rejected",
      error: { code: "command-reuse", commandId },
    });
    expect(state.saves()).toBe(1);
  });

  test("rejects stale, missing, non-owned, and mismatched selected candidates without persistence", async () => {
    const stale = harness({
      source: {
        ...collection(),
        attentionDispositions: [
          {
            gameId,
            kind: "intentional",
            ruleId: "underused-purchase",
            ruleVersion: 1,
            fingerprint,
            version: 1,
          },
        ],
      },
    });
    expect(await stale.service.execute(command())).toMatchObject({
      error: { code: "stale-version" },
    });
    const missing = harness();
    expect(
      await missing.service.execute(command({ gameId: "10000000-0000-4000-8000-000000000099" })),
    ).toMatchObject({ error: { code: "game-not-found" } });
    const nonOwned = harness({ source: collection(game({ ownership: "previously-owned" })) });
    expect(await nonOwned.service.execute(command())).toMatchObject({
      error: { code: "ineligible-game" },
    });
    const mismatch = harness({ selected: selection({ fingerprint: "b".repeat(64) }) });
    expect(await mismatch.service.execute(command())).toMatchObject({
      error: { code: "candidate-mismatch" },
    });
    expect(stale.saves() + missing.saves() + nonOwned.saves() + mismatch.saves()).toBe(0);
  });

  test("preserves durable state on source persistence failure and reports post-commit candidate failure honestly", async () => {
    const rejected = harness({ failSave: true });
    expect(await rejected.service.execute(command())).toEqual({
      outcome: "rejected",
      error: { code: "persistence-failure" },
    });
    expect(rejected.snapshot().revision).toBe(0);
    const committed = harness({ maintenance: "throw" });
    expect(await committed.service.execute(command())).toMatchObject({
      outcome: "accepted",
      attentionUnavailable: true,
    });
    expect(committed.snapshot().revision).toBe(1);
    expect(committed.maintenanceCalls()).toBe(1);
  });
});

describe("AttentionDispositionService correction evidence", () => {
  test("keeps the attention version monotonic across authorized clearing and replays both receipts", async () => {
    const state = harness();
    const first = command();
    expect(await state.service.execute(first)).toMatchObject({ outcome: "accepted" });
    state.clearDispositionRetainingReceipts();
    const second = command({
      commandId: "20000000-0000-4000-8000-000000000002",
      ruleId: "underused-purchase-v2",
      fingerprint: "b".repeat(64),
      expectedVersion: 1,
    });
    state.setSelection(selection({ ruleId: "underused-purchase-v2", fingerprint: "b".repeat(64) }));
    expect(await state.service.execute(second)).toMatchObject({
      outcome: "accepted",
      receipt: { accepted: { version: 2 } },
    });
    expect(await state.service.execute(first)).toMatchObject({ outcome: "replayed" });
    expect(await state.service.execute(second)).toMatchObject({ outcome: "replayed" });
    expect(
      await state.service.execute(
        command({ commandId: "20000000-0000-4000-8000-000000000003", expectedVersion: 0 }),
      ),
    ).toMatchObject({ error: { code: "stale-version" } });
  });

  test("classifies committed-response loss but never accepts a pre-persistence rejection", async () => {
    const recovered = harness({ persistThenReject: true, maintenance: "available" });
    expect(await recovered.service.execute(command())).toMatchObject({ outcome: "accepted" });
    expect(recovered.snapshot().commandReceipts).toHaveLength(1);
    expect(recovered.maintenanceCalls()).toBe(1);

    const rejected = harness({ failSave: true, maintenance: "available" });
    expect(await rejected.service.execute(command())).toEqual({
      outcome: "rejected",
      error: { code: "persistence-failure" },
    });
    expect(rejected.snapshot().revision).toBe(0);
    expect(rejected.maintenanceCalls()).toBe(0);
  });

  test("reports exactly one integrated maintenance result while retaining the source commit", async () => {
    const available = harness({ maintenance: "available" });
    expect(await available.service.execute(command())).toMatchObject({ outcome: "accepted" });
    expect(available.maintenanceCalls()).toBe(1);

    const unavailable = harness({ maintenance: "unavailable" });
    expect(await unavailable.service.execute(command())).toMatchObject({
      outcome: "accepted",
      attentionUnavailable: true,
    });
    expect(unavailable.maintenanceCalls()).toBe(1);
    expect(unavailable.snapshot().revision).toBe(1);
  });
});

describe("AttentionDispositionService canonical UUID replay", () => {
  test("canonicalizes equivalent UUID spellings into one durable receipt", async () => {
    const state = harness();
    const lower = command({ commandId: "b0000000-0000-4000-8000-000000000001" });
    const upper = {
      ...lower,
      commandId: lower.commandId.toUpperCase(),
      gameId: lower.gameId.toUpperCase(),
    };
    expect(await state.service.execute(upper)).toMatchObject({ outcome: "accepted" });
    expect(await state.service.execute(lower)).toMatchObject({ outcome: "replayed" });
    expect(state.snapshot().commandReceipts).toHaveLength(1);
    expect(state.maintenanceCalls()).toBe(1);
  });
});

describe("AttentionDisposition global maintenance boundary", () => {
  function globalHarness(
    source: Collection,
    options: { readonly publication?: "available" | "unavailable" } = {},
  ) {
    let stored = CollectionSchema.parse(source);
    let saves = 0;
    let publications = 0;
    let availability: "available" | "unavailable" = "available";
    const events: string[] = [];
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(stored)),
      saveCollection: (next) => {
        events.push("source-save");
        saves += 1;
        stored = structuredClone(next);
        return Promise.resolve();
      },
    };
    const mutations = createCollectionMutationService({
      storageService: storage,
      postCommitObserver: () => {
        events.push("candidate-publication");
        publications += 1;
        availability = options.publication ?? "available";
        return Promise.resolve();
      },
    });
    return {
      mutations,
      snapshot: () => structuredClone(stored),
      saves: () => saves,
      publications: () => publications,
      availability: () => availability,
      events: () => [...events],
      record: (event: string) => events.push(event),
      publishRecovery: () => {
        events.push("candidate-recovery");
        publications += 1;
        availability = "available";
        return Promise.resolve();
      },
    };
  }

  function intentionalSource(): Collection {
    const source = collection();
    source.attentionDispositions = [
      {
        gameId,
        kind: "intentional",
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint,
        version: 1,
      },
    ];
    return source;
  }

  test("uses the injected pure winner path to clear dependency and scoring incompatibilities before publication", async () => {
    for (const scenario of [
      {
        reason: "prediction" as const,
        winner: { gameId, ruleId: "never-played", ruleVersion: 2, fingerprint },
      },
      {
        reason: "redundancy" as const,
        winner: { gameId, ruleId: "never-played", ruleVersion: 1, fingerprint: "b".repeat(64) },
      },
    ]) {
      const state = globalHarness(intentionalSource());
      let fallbackPublications = 0;
      const maintain = createAttentionDispositionGlobalMaintenance({
        collectionMutations: state.mutations,
        winners: (gameIds) => {
          expect(gameIds).toEqual([gameId]);
          state.record("pure-oracle");
          return Promise.resolve([scenario.winner]);
        },
        maintainCandidates: () => {
          fallbackPublications += 1;
          return Promise.resolve();
        },
      });

      await maintain({ kind: "global", reason: scenario.reason });

      expect(state.snapshot().attentionDispositions).toEqual([]);
      expect(state.snapshot().revision).toBe(1);
      expect(state.saves()).toBe(1);
      expect(state.publications()).toBe(0);
      expect(fallbackPublications).toBe(1);
      expect(state.events()).toEqual(["pure-oracle", "source-save"]);
    }
  });

  test("preserves matching intentional state and every snooze during global maintenance without a source save", async () => {
    const matching = intentionalSource();
    const snoozed = structuredClone(matching);
    snoozed.attentionDispositions = [
      {
        gameId,
        kind: "snoozed",
        ruleId: "never-played",
        ruleVersion: 1,
        fingerprint,
        responseAt: now,
        expiresAt: "2026-04-07T12:34:56.789Z",
        version: 1,
      },
    ];
    for (const [index, source] of [matching, snoozed].entries()) {
      const state = globalHarness(source);
      let fallbackPublications = 0;
      await createAttentionDispositionGlobalMaintenance({
        collectionMutations: state.mutations,
        winners: () =>
          Promise.resolve([
            {
              gameId,
              ruleId: "never-played",
              ruleVersion: 1,
              fingerprint: index === 0 ? fingerprint : "b".repeat(64),
            },
          ]),
        maintainCandidates: () => {
          fallbackPublications += 1;
          return Promise.resolve();
        },
      })({ kind: "global", reason: "tournament" });
      expect(state.snapshot().attentionDispositions).toHaveLength(1);
      expect(state.saves()).toBe(0);
      expect(state.publications()).toBe(0);
      expect(fallbackPublications).toBe(1);
    }
  });

  test("preserves a stored underused rule when explicit intention becomes the current winner", async () => {
    const source = collection();
    source.attentionDispositions = [
      {
        gameId,
        kind: "intentional",
        ruleId: "underused-purchase",
        ruleVersion: 1,
        fingerprint,
        version: 1,
      },
    ];
    const state = globalHarness(source);
    let rebuilds = 0;
    await createAttentionDispositionGlobalMaintenance({
      collectionMutations: state.mutations,
      storedRuleMatches: (dispositions) => {
        expect(dispositions).toMatchObject([{ ruleId: "underused-purchase" }]);
        return Promise.resolve([
          { gameId, ruleId: "underused-purchase", ruleVersion: 1, fingerprint },
        ]);
      },
      maintainCandidates: () => {
        rebuilds += 1;
        return Promise.resolve();
      },
    })({ kind: "global", reason: "prediction" });
    expect(state.snapshot().attentionDispositions).toHaveLength(1);
    expect(state.saves()).toBe(0);
    expect(rebuilds).toBe(1);
  });

  test("does not reject a committed global writer when stored-rule resolution fails", async () => {
    const state = globalHarness(intentionalSource());
    let invalidations = 0;
    let attempts = 0;
    let publications = 0;
    const maintain = createAttentionDispositionGlobalMaintenance({
      collectionMutations: state.mutations,
      storedRuleMatches: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("oracle unavailable"))
          : Promise.resolve([{ gameId, ruleId: "never-played", ruleVersion: 2, fingerprint }]);
      },
      maintainCandidates: () => {
        publications += 1;
        return Promise.resolve();
      },
      invalidateCandidates: () => {
        invalidations += 1;
        return Promise.resolve();
      },
    });
    await maintain({ kind: "global", reason: "tournament" });
    expect(state.snapshot().revision).toBe(0);
    expect(state.saves()).toBe(0);
    expect(invalidations).toBe(1);
    await maintain.recover();
    expect(state.snapshot().attentionDispositions).toEqual([]);
    expect(state.snapshot().revision).toBe(1);
    expect(state.saves()).toBe(1);
    expect(publications).toBe(0);
  });

  test("publishes a committed global clear once and does not use a second source write as recovery", async () => {
    const state = globalHarness(intentionalSource());
    const events: string[] = [];
    const maintain = createAttentionDispositionGlobalMaintenance({
      collectionMutations: state.mutations,
      winners: () =>
        Promise.resolve([{ gameId, ruleId: "never-played", ruleVersion: 2, fingerprint }]),
      maintainCandidates: () => {
        events.push("candidate-publication");
        return Promise.resolve();
      },
    });
    const recovery = createAttentionCandidateMaintenanceRecovery({
      recoverCompatibility: () => maintain.recover(),
      ensureFresh: () => {
        events.push("candidate-recovery");
        return Promise.resolve({ state: "unavailable", retryable: true });
      },
    });

    await maintain({ kind: "global", reason: "prediction" });
    expect(state.snapshot().attentionDispositions).toEqual([]);
    expect(state.snapshot().revision).toBe(1);
    expect(state.saves()).toBe(1);
    expect(events).toEqual(["candidate-publication"]);

    await recovery.recover();
    expect(state.snapshot().revision).toBe(1);
    expect(state.saves()).toBe(1);
    expect(events).toEqual(["candidate-publication", "candidate-recovery"]);
  });

  test("retains receipts across a global clear and advances the next command version monotonically", async () => {
    const state = harness({ maintenance: "available" });
    const first = command({ operation: "intentional" });
    expect(await state.service.execute(first)).toMatchObject({ outcome: "accepted" });
    const clear = createAttentionDispositionGlobalMaintenance({
      collectionMutations: state.mutations,
      winners: () =>
        Promise.resolve([{ gameId, ruleId: "underused-purchase", ruleVersion: 2, fingerprint }]),
      maintainCandidates: async () => Promise.resolve(),
    });
    await clear({ kind: "global", reason: "prediction" });
    expect(state.snapshot().attentionDispositions).toEqual([]);
    expect(state.snapshot().commandReceipts).toHaveLength(1);

    state.setSelection(selection({ ruleVersion: 2 }));
    expect(
      await state.service.execute(
        command({
          commandId: "20000000-0000-4000-8000-000000000004",
          operation: "intentional",
          ruleVersion: 2,
          expectedVersion: 1,
        }),
      ),
    ).toMatchObject({ outcome: "accepted", receipt: { accepted: { version: 2 } } });
    expect(state.snapshot().commandReceipts).toHaveLength(2);
  });
});
