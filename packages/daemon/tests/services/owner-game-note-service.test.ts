import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  CollectionSchema,
  canonicalizeOwnerGameNoteRequest,
  createInitialEntityMetadata,
  type Collection,
  type DurableGame,
  type OwnerGameNote,
  type OwnerGameNoteMutationResult,
} from "@shelf-judge/shared";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import { createGameDetailSnapshotService } from "../../src/services/game-projection.js";
import type { Logger } from "../../src/services/logger.js";
import {
  createOwnerGameNoteService,
  type OwnerGameNoteInvalidationLifecycle,
} from "../../src/services/owner-game-note-service.js";
import type {
  CollectionPersistence,
  CollectionReader,
} from "../../src/services/storage-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import { createTestApp } from "../helpers/test-app.js";

const initialTime = "2026-08-30T10:00:00.000Z";
const acceptedTimes = [
  "2026-08-30T11:00:00.000Z",
  "2026-08-30T12:00:00.000Z",
  "2026-08-30T13:00:00.000Z",
  "2026-08-30T14:00:00.000Z",
];
const commandIds = [
  "44000000-0000-4000-8000-000000000001",
  "44000000-0000-4000-8000-000000000002",
  "44000000-0000-4000-8000-000000000003",
  "44000000-0000-4000-8000-000000000004",
  "44000000-0000-4000-8000-000000000005",
];

const silentLogger: Logger = {
  log() {},
  warn() {},
  error() {},
};

function game(overrides: Partial<DurableGame> = {}): DurableGame {
  return {
    id: "game-1",
    bggId: null,
    name: "Private game name",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
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
    ratings: {},
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    createdAt: initialTime,
    updatedAt: initialTime,
    ...overrides,
  };
}

function collection(sourceGame = game()): Collection {
  return {
    schemaVersion: 6,
    revision: 0,
    id: "collection-1",
    name: "Private collection name",
    axes: [],
    games: [sourceGame],
    intentions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: initialTime,
    updatedAt: initialTime,
  };
}

function harness(
  options: {
    source?: Collection;
    times?: string[];
    failSaves?: number;
    lifecycle?: OwnerGameNoteInvalidationLifecycle;
    logger?: Logger;
    hashExactString?: (value: string) => string;
  } = {},
) {
  let current = CollectionSchema.parse(options.source ?? collection());
  let saves = 0;
  let loads = 0;
  let failSaves = options.failSaves ?? 0;
  const times = [...(options.times ?? acceptedTimes)];
  const storage: CollectionReader & CollectionPersistence = {
    loadCollection() {
      loads += 1;
      return Promise.resolve(structuredClone(current));
    },
    saveCollection(next) {
      saves += 1;
      if (failSaves > 0) {
        failSaves -= 1;
        return Promise.reject(new Error("disk unavailable"));
      }
      current = structuredClone(next);
      return Promise.resolve();
    },
  };
  const coordinator = createCollectionMutationService({
    storageService: storage,
    logger: silentLogger,
  });
  const makeService = (boundary = coordinator) =>
    createOwnerGameNoteService({
      collectionMutationService: boundary,
      now: () => times.shift() ?? "2026-08-30T15:00:00.000Z",
      invalidationLifecycle: options.lifecycle,
      logger: options.logger ?? silentLogger,
      hashExactString: options.hashExactString,
    });
  return {
    storage,
    coordinator,
    makeService,
    restartService: () => {
      const restartedStorage = {
        loadCollection: () => storage.loadCollection(),
        saveCollection: (next: Collection) => storage.saveCollection(next),
      };
      return makeService(
        createCollectionMutationService({ storageService: restartedStorage, logger: silentLogger }),
      );
    },
    snapshot: () => structuredClone(current),
    saves: () => saves,
    loads: () => loads,
  };
}

function acceptedNote(result: OwnerGameNoteMutationResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected acceptance, got ${result.error.code}`);
  return result.accepted;
}

function deferredSignal(): { promise: Promise<void>; resolve(): void } {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => (resolve = complete));
  return { promise, resolve };
}

describe("OwnerGameNoteService", () => {
  test("executes the complete state lifecycle with exact timestamps and revisions", async () => {
    const state = harness();
    const service = state.makeService();

    const first = acceptedNote(
      await service.set("game-1", {
        commandId: commandIds[0],
        expectedVersion: 0,
        text: "first\r\nline",
      }),
    );
    expect(first).toEqual({
      commandId: commandIds[0],
      gameId: "game-1",
      operation: "set",
      state: "present",
      version: 1,
      updatedAt: acceptedTimes[0],
      collectionRevision: 1,
      replayed: false,
      alreadyClear: false,
    });
    expect(state.snapshot().games[0]).toMatchObject({
      ownerNote: { state: "present", version: 1, updatedAt: acceptedTimes[0], text: "first\nline" },
      updatedAt: acceptedTimes[0],
    });

    acceptedNote(
      await service.set("game-1", {
        commandId: commandIds[1],
        expectedVersion: 1,
        text: "first\nline",
      }),
    );
    expect(state.snapshot().games[0]?.ownerNote).toEqual({
      state: "present",
      version: 2,
      updatedAt: acceptedTimes[1],
      text: "first\nline",
    });

    acceptedNote(await service.clear("game-1", { commandId: commandIds[2], expectedVersion: 2 }));
    expect(state.snapshot().games[0]).toMatchObject({
      ownerNote: { state: "cleared", version: 3, updatedAt: acceptedTimes[2] },
      updatedAt: acceptedTimes[2],
    });

    acceptedNote(
      await service.set("game-1", {
        commandId: commandIds[3],
        expectedVersion: 3,
        text: "authored again",
      }),
    );
    expect(state.snapshot()).toMatchObject({
      revision: 4,
      updatedAt: acceptedTimes[3],
      games: [{ ownerNote: { state: "present", version: 4, text: "authored again" } }],
    });
    expect(state.snapshot().commandReceipts).toHaveLength(4);
    expect(JSON.stringify(state.snapshot().commandReceipts)).not.toContain("first");
    expect(JSON.stringify(state.snapshot().commandReceipts)).not.toContain("authored again");
  });

  test.each([
    ["missing", { state: "missing", version: 0, updatedAt: null } satisfies OwnerGameNote],
    ["cleared", { state: "cleared", version: 2, updatedAt: initialTime } satisfies OwnerGameNote],
  ])("persists clear of %s while preserving all game metadata", async (_label, ownerNote) => {
    const sourceGame = game({ ownerNote, updatedAt: "2026-08-30T10:15:00.000Z" });
    const state = harness({ source: collection(sourceGame) });
    const beforeGame = structuredClone(sourceGame);
    const result = acceptedNote(
      await state.makeService().clear("game-1", {
        commandId: commandIds[0],
        expectedVersion: ownerNote.version,
      }),
    );

    expect(result).toMatchObject({
      state: ownerNote.state,
      version: ownerNote.version,
      updatedAt: ownerNote.updatedAt,
      collectionRevision: 1,
      alreadyClear: true,
    });
    expect(state.snapshot().games[0]).toEqual(beforeGame);
    expect(state.snapshot().updatedAt).toBe(acceptedTimes[0]);
    expect(state.saves()).toBe(1);
  });

  test("reads a clone through the serialized no-op boundary without side effects", async () => {
    const note: OwnerGameNote = {
      state: "present",
      version: 3,
      updatedAt: initialTime,
      text: "read sentinel",
    };
    const state = harness({ source: collection(game({ ownerNote: note })) });
    const before = state.snapshot();
    const result = await state.makeService().get("game-1");
    if (result.note.state !== "present") throw new Error("Expected present note");
    result.note.text = "mutated clone";

    expect(state.snapshot()).toEqual(before);
    expect(state.saves()).toBe(0);
    expect(state.loads()).toBe(1);
  });

  test("rejects malformed reads before queueing and logs a paired metadata-only outcome", async () => {
    const entries: unknown[][] = [];
    const logger: Logger = {
      log: (...args) => entries.push(args),
      warn: (...args) => entries.push(args),
      error: (...args) => entries.push(args),
    };
    const state = harness({ logger });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(state.makeService().get({ privateText: "READ_SENTINEL" })).rejects.toThrow();
    expect(state.loads()).toBe(0);
    expect(entries.map(([message]) => message)).toEqual([
      "owner game note attempt",
      "owner game note outcome",
    ]);
    expect(JSON.stringify(entries)).not.toContain("READ_SENTINEL");
  });

  test("hashes the exact canonical string and replays line-ending-equivalent requests after restart", async () => {
    const hashed: string[] = [];
    const state = harness({
      hashExactString(value) {
        hashed.push(value);
        return createHash("sha256").update(value, "utf8").digest("hex");
      },
    });
    const command = { commandId: commandIds[0], expectedVersion: 0, text: "a\r\nb\rc" };
    const original = acceptedNote(await state.makeService().set("game-1", command));
    const replay = acceptedNote(
      await state.restartService().set("game-1", { ...command, text: "a\nb\nc" }),
    );

    expect(hashed[0]).toBe(
      canonicalizeOwnerGameNoteRequest({
        operation: "set",
        gameId: "game-1",
        commandId: command.commandId,
        expectedVersion: 0,
        text: "a\nb\nc",
      }),
    );
    expect(hashed[0]?.startsWith('"')).toBe(false);
    expect(replay).toEqual({ ...original, replayed: true });
    expect(state.saves()).toBe(1);
    expect(state.snapshot().revision).toBe(1);
  });

  test("replays historical acceptance metadata without replacing newer current state", async () => {
    const state = harness();
    const service = state.makeService();
    const historicalCommand = {
      commandId: commandIds[0],
      expectedVersion: 0,
      text: "historical text",
    };
    const historical = acceptedNote(await service.set("game-1", historicalCommand));
    acceptedNote(
      await service.set("game-1", {
        commandId: commandIds[1],
        expectedVersion: 1,
        text: "current text",
      }),
    );
    const beforeReplay = state.snapshot();

    expect(acceptedNote(await state.restartService().set("game-1", historicalCommand))).toEqual({
      ...historical,
      replayed: true,
    });
    expect(state.snapshot()).toEqual(beforeReplay);
    expect(state.snapshot().games[0]?.ownerNote).toMatchObject({
      state: "present",
      version: 2,
      text: "current text",
    });
  });

  test("rejects changed and cross-family command reuse before game or version checks", async () => {
    const source = collection();
    source.commandReceipts.push({
      commandId: commandIds[0],
      request: {
        type: "create",
        commandId: commandIds[0],
        gameId: "missing-game",
        kind: "first-play",
        expectedActiveIntention: "absent",
      },
      result: {
        ok: true,
        commandId: commandIds[0],
        intention: {
          intentionId: "historical",
          gameId: "missing-game",
          kind: "first-play",
          baseline: { playCount: 0, evidenceSource: "manual", observedAt: initialTime },
          createdAt: initialTime,
          version: 1,
          resolution: null,
        },
        linkedOwnershipTransition: null,
      },
    });
    source.games.push(game({ id: "missing-game" }));
    source.intentions.push(
      source.commandReceipts[0] && "request" in source.commandReceipts[0]
        ? structuredClone(source.commandReceipts[0].result.intention)
        : (() => {
            throw new Error("Expected intention receipt");
          })(),
    );
    const state = harness({ source });
    const before = state.snapshot();
    expect(
      await state.makeService().set("does-not-exist", {
        commandId: commandIds[0],
        expectedVersion: 99,
        text: "changed",
      }),
    ).toMatchObject({ ok: false, error: { code: "command-reuse" } });
    expect(state.snapshot()).toEqual(before);

    const clean = harness();
    const command = { commandId: commandIds[1], expectedVersion: 0, text: "original" };
    acceptedNote(await clean.makeService().set("game-1", command));
    for (const attempt of [
      () => clean.makeService().set("game-1", { ...command, text: "changed" }),
      () => clean.makeService().set("other-game", command),
      () => clean.makeService().set("game-1", { ...command, expectedVersion: 1 }),
      () =>
        clean.makeService().clear("game-1", { commandId: command.commandId, expectedVersion: 0 }),
    ]) {
      expect(await attempt()).toMatchObject({ ok: false, error: { code: "command-reuse" } });
    }
    expect(clean.saves()).toBe(1);
  });

  test("returns validation, missing, stale, and both overflow failures without writes", async () => {
    const state = harness();
    const service = state.makeService();
    const malformed = await service.set("game-1", {
      commandId: commandIds[0],
      expectedVersion: 0,
      text: "   ",
      extra: true,
    });
    expect(malformed).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(
      await service.set("missing", {
        commandId: commandIds[0],
        expectedVersion: 0,
        text: "valid",
      }),
    ).toMatchObject({ ok: false, error: { code: "game-not-found" } });
    acceptedNote(
      await service.set("game-1", {
        commandId: commandIds[0],
        expectedVersion: 0,
        text: "current full note",
      }),
    );
    expect(
      await service.clear("game-1", {
        commandId: commandIds[1],
        expectedVersion: 0,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "stale-version", current: { state: "present", text: "current full note" } },
    });
    expect(state.saves()).toBe(1);

    const maxNote = harness({
      source: collection(
        game({
          ownerNote: {
            state: "present",
            version: Number.MAX_SAFE_INTEGER,
            updatedAt: initialTime,
            text: "max",
          },
        }),
      ),
    });
    expect(
      await maxNote.makeService().clear("game-1", {
        commandId: commandIds[2],
        expectedVersion: Number.MAX_SAFE_INTEGER,
      }),
    ).toMatchObject({ ok: false, error: { code: "version-overflow", target: "note" } });
    const maxCollection = collection();
    maxCollection.revision = Number.MAX_SAFE_INTEGER;
    const revisionState = harness({ source: maxCollection });
    expect(
      await revisionState.makeService().set("game-1", {
        commandId: commandIds[3],
        expectedVersion: 0,
        text: "blocked",
      }),
    ).toMatchObject({ ok: false, error: { code: "version-overflow", target: "collection" } });
    expect(maxNote.saves()).toBe(0);
    expect(revisionState.saves()).toBe(0);
  });

  test("rejects malformed direct inputs before entering the mutation queue", async () => {
    const state = harness();
    expect(
      await state.makeService().set(42, {
        commandId: "not-a-command-id",
        expectedVersion: -1,
        text: "valid text",
      }),
    ).toMatchObject({
      ok: false,
      commandId: "00000000-0000-0000-0000-000000000000",
      error: { code: "validation" },
    });
    expect(state.loads()).toBe(0);
    expect(state.saves()).toBe(0);
  });

  test("compensates invalidation and persistence failures, releases the queue, and accepts exact retry", async () => {
    const events: string[] = [];
    let invalidationFailures = 1;
    const lifecycle: OwnerGameNoteInvalidationLifecycle = {
      beforePersistence() {
        events.push("invalidate");
        if (invalidationFailures-- > 0) throw new Error("invalidation failed");
      },
      onPersistenceFailure(_context, error) {
        events.push(`compensate:${error instanceof Error ? error.message : String(error)}`);
      },
    };
    const state = harness({ lifecycle, failSaves: 1 });
    const command = { commandId: commandIds[0], expectedVersion: 0, text: "retry sentinel" };

    expect(await state.makeService().set("game-1", command)).toMatchObject({
      ok: false,
      error: { code: "persistence-failure" },
    });
    expect(await state.makeService().set("game-1", command)).toMatchObject({
      ok: false,
      error: { code: "persistence-failure" },
    });
    const accepted = acceptedNote(await state.makeService().set("game-1", command));

    expect(accepted).toMatchObject({ version: 1, collectionRevision: 1 });
    expect(events).toEqual([
      "invalidate",
      "compensate:invalidation failed",
      "invalidate",
      "compensate:disk unavailable",
      "invalidate",
    ]);
    expect(state.snapshot().commandReceipts).toHaveLength(1);
    expect(state.snapshot().revision).toBe(1);
  });

  test("does not compensate candidate validation rejected before invalidation starts", async () => {
    const events: string[] = [];
    const lifecycle: OwnerGameNoteInvalidationLifecycle = {
      beforePersistence() {
        events.push("invalidate");
      },
      onPersistenceFailure() {
        events.push("compensate");
      },
    };
    const state = harness({ lifecycle, times: ["not-a-timestamp"] });

    expect(
      await state.makeService().set("game-1", {
        commandId: commandIds[0],
        expectedVersion: 0,
        text: "candidate rejected",
      }),
    ).toMatchObject({ ok: false, error: { code: "persistence-failure" } });
    expect(events).toEqual([]);
    expect(state.saves()).toBe(0);
    expect(state.snapshot()).toEqual(collection());
  });

  test("runs invalidation before persistence and accepted visibility without artifact behavior by default", async () => {
    const events: string[] = [];
    let current = collection();
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(current)),
      saveCollection(next) {
        events.push("persist");
        current = structuredClone(next);
        return Promise.resolve();
      },
    };
    const lifecycle: OwnerGameNoteInvalidationLifecycle = {
      beforePersistence(context) {
        events.push(`invalidate:${context.resultingCollectionRevision}`);
      },
      onPersistenceFailure() {
        events.push("compensate");
      },
    };
    const service = createOwnerGameNoteService({
      collectionMutationService: createCollectionMutationService({
        storageService: storage,
        logger: silentLogger,
      }),
      now: () => acceptedTimes[0],
      invalidationLifecycle: lifecycle,
      logger: silentLogger,
    });
    acceptedNote(
      await service.set("game-1", {
        commandId: commandIds[0],
        expectedVersion: 0,
        text: "private",
      }),
    );
    events.push("visible");
    expect(events).toEqual(["invalidate:1", "persist", "visible"]);

    const noLifecycle = harness();
    acceptedNote(
      await noLifecycle.makeService().set("game-1", {
        commandId: commandIds[1],
        expectedVersion: 0,
        text: "no artifact calls",
      }),
    );
    expect(noLifecycle.saves()).toBe(1);
  });

  test("keeps note content, canonical requests, and fingerprints out of lifecycle metadata and failures", async () => {
    const supersededText = "NOTE_SUPERSEDED_7d08f4";
    const currentText = `NOTE_CURRENT_31ac92_${"f".repeat(64)}`;
    const failedText = "NOTE_FAILED_58be13";
    const fingerprint = "e".repeat(64);
    const canonicalRequest = canonicalizeOwnerGameNoteRequest({
      operation: "set",
      gameId: "game-1",
      commandId: commandIds[1],
      expectedVersion: 1,
      text: currentText,
    });
    const lifecycleEvents: unknown[] = [];
    const logEntries: unknown[][] = [];
    const logger: Logger = {
      log: (...args) => logEntries.push(args),
      warn: (...args) => logEntries.push(args),
      error: (...args) => logEntries.push(args),
    };
    const lifecycle: OwnerGameNoteInvalidationLifecycle = {
      beforePersistence(context) {
        lifecycleEvents.push({ phase: "before", context: structuredClone(context) });
        if (context.commandId === commandIds[2]) {
          throw new Error(
            `private failure ${supersededText} ${currentText} ${canonicalRequest} ${fingerprint}`,
          );
        }
      },
      onPersistenceFailure(context) {
        lifecycleEvents.push({ phase: "failure", context: structuredClone(context) });
      },
    };
    const state = harness({ lifecycle, logger, hashExactString: () => fingerprint });
    acceptedNote(
      await state.makeService().set("game-1", {
        commandId: commandIds[0],
        expectedVersion: 0,
        text: supersededText,
      }),
    );
    acceptedNote(
      await state.makeService().set("game-1", {
        commandId: commandIds[1],
        expectedVersion: 1,
        text: currentText,
      }),
    );
    const failed = await state.makeService().set("game-1", {
      commandId: commandIds[2],
      expectedVersion: 2,
      text: failedText,
    });

    expect(failed).toEqual({
      ok: false,
      commandId: commandIds[2],
      error: {
        code: "persistence-failure",
        operation: "shelf.game.note.set",
        message: "Owner game note mutation failed",
      },
    });
    expect(lifecycleEvents.map((event) => JSON.stringify(event))).toHaveLength(4);
    for (const serialized of [
      JSON.stringify(lifecycleEvents),
      JSON.stringify(logEntries),
      JSON.stringify(failed),
    ]) {
      expect(serialized).not.toContain(supersededText);
      expect(serialized).not.toContain(currentText);
      expect(serialized).not.toContain(failedText);
      expect(serialized).not.toContain(canonicalRequest);
      expect(serialized).not.toContain(fingerprint);
      expect(serialized).not.toContain("requestFingerprint");
    }
    expect(state.snapshot().games[0]?.ownerNote).toMatchObject({
      state: "present",
      version: 2,
      text: currentText,
    });

    const hashFailureLogs: unknown[][] = [];
    const hashFailureState = harness({
      logger: {
        log: (...args) => hashFailureLogs.push(args),
        warn: (...args) => hashFailureLogs.push(args),
        error: (...args) => hashFailureLogs.push(args),
      },
      hashExactString() {
        throw new Error(`${currentText} ${canonicalRequest} ${fingerprint}`);
      },
    });
    const hashFailure = await hashFailureState.makeService().set("game-1", {
      commandId: commandIds[2],
      expectedVersion: 0,
      text: currentText,
    });
    const serializedHashFailure = JSON.stringify([hashFailure, hashFailureLogs]);
    expect(serializedHashFailure).not.toContain(currentText);
    expect(serializedHashFailure).not.toContain(canonicalRequest);
    expect(serializedHashFailure).not.toContain(fingerprint);
    expect(hashFailureState.loads()).toBe(0);
    expect(hashFailureState.saves()).toBe(0);
  });

  test("leaves state unchanged after invalidation failure and exact retry reruns invalidation before persistence", async () => {
    const entries: unknown[][] = [];
    const logger: Logger = {
      log: (...args) => entries.push(args),
      warn: (...args) => entries.push(args),
      error: (...args) => entries.push(args),
    };
    const events: string[] = [];
    let current = collection();
    let failInvalidation = true;
    const lifecycle: OwnerGameNoteInvalidationLifecycle = {
      beforePersistence() {
        events.push("invalidate");
        if (failInvalidation) {
          failInvalidation = false;
          throw new Error("invalidation failed");
        }
      },
      onPersistenceFailure(_context, error) {
        events.push(`compensate:${error instanceof Error ? error.message : String(error)}`);
      },
    };
    const storage: CollectionReader & CollectionPersistence = {
      loadCollection: () => Promise.resolve(structuredClone(current)),
      saveCollection(next) {
        events.push("persist");
        current = structuredClone(next);
        return Promise.resolve();
      },
    };
    const service = createOwnerGameNoteService({
      collectionMutationService: createCollectionMutationService({
        storageService: storage,
        logger: silentLogger,
      }),
      now: () => acceptedTimes[0],
      invalidationLifecycle: lifecycle,
      logger,
    });
    const before = structuredClone(current);
    const command = { commandId: commandIds[0], expectedVersion: 0, text: "retry" };

    expect(await service.set("game-1", command)).toEqual({
      ok: false,
      commandId: commandIds[0],
      error: {
        code: "persistence-failure",
        operation: "shelf.game.note.set",
        message: "Owner game note mutation failed",
      },
    });
    expect(current).toEqual(before);
    expect(events).toEqual(["invalidate", "compensate:invalidation failed"]);

    expect(acceptedNote(await service.set("game-1", command))).toMatchObject({
      replayed: false,
      collectionRevision: 1,
    });
    expect(events).toEqual([
      "invalidate",
      "compensate:invalidation failed",
      "invalidate",
      "persist",
    ]);
    expect(current).toMatchObject({
      revision: 1,
      games: [{ ownerNote: { state: "present", version: 1, text: "retry" } }],
      commandReceipts: [{ commandId: commandIds[0] }],
    });
    expect(
      entries.some(
        ([message, context]) =>
          message === "owner game note outcome" &&
          typeof context === "object" &&
          context !== null &&
          "persisted" in context &&
          context.persisted === false,
      ),
    ).toBe(true);
  });

  test.each([
    ["set", "snapshot-first"],
    ["set", "mutation-first"],
    ["clear", "snapshot-first"],
    ["clear", "mutation-first"],
  ] as const)(
    "returns a coherent detail snapshot when %s is queued %s",
    async (operation, ordering) => {
      const priorNote: OwnerGameNote =
        operation === "set"
          ? { state: "missing", version: 0, updatedAt: null }
          : { state: "present", version: 1, updatedAt: initialTime, text: "clear me" };
      const resultingNote: OwnerGameNote =
        operation === "set"
          ? { state: "present", version: 1, updatedAt: acceptedTimes[0], text: "set value" }
          : { state: "cleared", version: 2, updatedAt: acceptedTimes[0] };
      const state = harness({ source: collection(game({ ownerNote: priorNote })) });
      const service = state.makeService();
      const detailService = createGameDetailSnapshotService(state.storage);
      const started = deferredSignal();
      const release = deferredSignal();
      const mutation = () =>
        operation === "set"
          ? service.set("game-1", {
              commandId: commandIds[0],
              expectedVersion: 0,
              text: "set value",
            })
          : service.clear("game-1", { commandId: commandIds[0], expectedVersion: 1 });

      let detail: ReturnType<typeof detailService.capture>;
      let mutationResult: Promise<OwnerGameNoteMutationResult>;
      if (ordering === "snapshot-first") {
        const loadCollection = state.storage.loadCollection.bind(state.storage);
        let holdFirstLoad = true;
        state.storage.loadCollection = async () => {
          if (holdFirstLoad) {
            holdFirstLoad = false;
            started.resolve();
            await release.promise;
          }
          return loadCollection();
        };
        detail = detailService.capture("game-1");
        await started.promise;
        mutationResult = mutation();
      } else {
        const saveCollection = state.storage.saveCollection.bind(state.storage);
        let holdFirstSave = true;
        state.storage.saveCollection = async (next) => {
          if (holdFirstSave) {
            holdFirstSave = false;
            started.resolve();
            await release.promise;
          }
          return saveCollection(next);
        };
        mutationResult = mutation();
        await started.promise;
        detail = detailService.capture("game-1");
      }

      release.resolve();
      const [snapshot, result] = await Promise.all([detail, mutationResult]);
      acceptedNote(result);
      expect(snapshot.collectionRevision).toBe(ordering === "snapshot-first" ? 0 : 1);
      expect(snapshot.game.ownerNote).toEqual(
        ordering === "snapshot-first" ? priorNote : resultingNote,
      );
      expect(snapshot.collection.revision).toBe(snapshot.collectionRevision);
      expect(state.snapshot().games[0]?.ownerNote).toEqual(resultingNote);
      expect(state.snapshot().revision).toBe(1);
    },
  );

  test("serializes an unrelated mutation behind a blocked note write without losing either update", async () => {
    const state = harness();
    const saveCollection = state.storage.saveCollection.bind(state.storage);
    const saveStarted = deferredSignal();
    const releaseSave = deferredSignal();
    let holdFirstSave = true;
    state.storage.saveCollection = async (next) => {
      if (holdFirstSave) {
        holdFirstSave = false;
        saveStarted.resolve();
        await releaseSave.promise;
      }
      return saveCollection(next);
    };
    const note = state.makeService().set("game-1", {
      commandId: commandIds[0],
      expectedVersion: 0,
      text: "coherent",
    });
    await saveStarted.promise;
    const unrelated = state.coordinator.mutate(
      { operation: "game.rate", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        const sourceGame = candidate.games[0];
        if (sourceGame === undefined) throw new Error("Expected game");
        sourceGame.ratings.axis = 8;
        return { changed: true, value: undefined };
      },
    );
    await Promise.resolve();
    expect(state.saves()).toBe(0);
    releaseSave.resolve();
    await Promise.all([note, unrelated]);

    expect(state.snapshot().games[0]).toMatchObject({
      ratings: { axis: 8 },
      ownerNote: { state: "present", version: 1, text: "coherent" },
    });
    expect(state.snapshot().revision).toBe(2);
    expect(state.saves()).toBe(2);
  });

  test("logs metadata only and removes superseded text from current durable state", async () => {
    const entries: unknown[][] = [];
    const logger: Logger = {
      log: (...args) => entries.push(args),
      warn: (...args) => entries.push(args),
      error: (...args) => entries.push(args),
    };
    const state = harness({ logger });
    acceptedNote(
      await state.makeService().set("game-1", {
        commandId: commandIds[0],
        expectedVersion: 0,
        text: "SUPERSEDED_SENTINEL",
      }),
    );
    acceptedNote(
      await state.makeService().set("game-1", {
        commandId: commandIds[1],
        expectedVersion: 1,
        text: "CURRENT_SENTINEL",
      }),
    );
    acceptedNote(
      await state.makeService().clear("game-1", {
        commandId: commandIds[2],
        expectedVersion: 2,
      }),
    );

    const durable = JSON.stringify(state.snapshot());
    const logs = JSON.stringify(entries);
    expect(durable).not.toContain("SUPERSEDED_SENTINEL");
    expect(durable).not.toContain("CURRENT_SENTINEL");
    expect(logs).not.toContain("SUPERSEDED_SENTINEL");
    expect(logs).not.toContain("CURRENT_SENTINEL");
    expect(logs).not.toContain("requestFingerprint");
    expect(logs).not.toContain("Private game name");
    expect(logs).not.toContain("Private collection name");
    expect(logs).toContain(commandIds[0]);
    expect(logs).toContain("collectionRevision");
  });

  test("cleans interrupted temporary files and retries exactly through real storage", async () => {
    const fileOps = createMockFileOps();
    const app = createTestApp({ fileOps, now: () => initialTime });
    const { game: created } = await app.gameService.addGame({ name: "Stored game" });
    const service = createOwnerGameNoteService({
      collectionMutationService: app.collectionMutationService,
      now: () => acceptedTimes[0],
      logger: silentLogger,
    });
    const rename = fileOps.rename.bind(fileOps);
    let interrupt = true;
    fileOps.rename = (from, to) => {
      if (interrupt && to.endsWith("collection.json")) {
        interrupt = false;
        return Promise.reject(new Error("rename interrupted"));
      }
      return rename(from, to);
    };
    const command = {
      commandId: commandIds[0],
      expectedVersion: 0,
      text: "TEMPORARY_FILE_SENTINEL",
    };

    expect(await service.set(created.id, command)).toMatchObject({
      ok: false,
      error: { code: "persistence-failure" },
    });
    expect([...fileOps.files.keys()].some((path) => path.endsWith(".tmp"))).toBe(false);
    expect(JSON.stringify([...fileOps.files.values()])).not.toContain("TEMPORARY_FILE_SENTINEL");

    expect(acceptedNote(await service.set(created.id, command))).toMatchObject({
      version: 1,
      collectionRevision: 2,
    });
    expect((await app.storageService.loadCollection()).commandReceipts).toHaveLength(1);
  });

  test("reads real storage without changing bytes, write operations, temp files, or artifacts", async () => {
    const fileOps = createMockFileOps();
    const app = createTestApp({ fileOps, now: () => initialTime });
    const { game: created } = await app.gameService.addGame({ name: "Read-only stored game" });
    const lifecycleEvents: string[] = [];
    const lifecycle: OwnerGameNoteInvalidationLifecycle = {
      beforePersistence() {
        lifecycleEvents.push("before");
      },
      onPersistenceFailure() {
        lifecycleEvents.push("failure");
      },
    };
    const service = createOwnerGameNoteService({
      collectionMutationService: app.collectionMutationService,
      invalidationLifecycle: lifecycle,
      logger: silentLogger,
    });
    const collectionPath = "/test/data/collection.json";
    const bytesBefore = fileOps.files.get(collectionPath);
    if (bytesBefore === undefined) throw new Error("Expected collection file");
    const filesBefore = [...fileOps.files.entries()];
    const writeCallsBefore = fileOps.calls.filter(({ method }) =>
      ["writeFile", "writeFileExclusive", "rename", "unlink"].includes(method),
    ).length;

    expect(await service.get(created.id)).toEqual({
      gameId: created.id,
      note: { state: "missing", version: 0, updatedAt: null },
    });

    expect(fileOps.files.get(collectionPath)).toBe(bytesBefore);
    expect([...fileOps.files.entries()]).toEqual(filesBefore);
    expect(
      fileOps.calls.filter(({ method }) =>
        ["writeFile", "writeFileExclusive", "rename", "unlink"].includes(method),
      ),
    ).toHaveLength(writeCallsBefore);
    expect([...fileOps.files.keys()].some((path) => path.endsWith(".tmp"))).toBe(false);
    expect(lifecycleEvents).toEqual([]);
  });
});
