import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  ReflectionCompletedSchema,
  type Collection,
  type ReflectionCompleted,
  type ReflectionQuestionId,
} from "@shelf-judge/shared";
import {
  createCollectionMutationService,
  collectionDurableIdentity,
} from "../../src/services/collection-mutation-service.js";
import { createFileOps, getTempPath, type FileOps } from "../../src/services/file-ops.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createGameService } from "../../src/services/game-service.js";
import { createOwnerGameNoteService } from "../../src/services/owner-game-note-service.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import {
  createReflectionStateService,
  type ReflectionCurrentSources,
} from "../../src/services/reflection-state-service.js";
import {
  REFLECTION_STAGE_PREFIX,
  REFLECTION_SETTINGS_FILE,
  REFLECTION_SETTINGS_STAGE_PREFIX,
  REFLECTION_STATE_FILE,
  createReflectionStorage,
} from "../../src/services/reflection-storage.js";
import {
  REFLECTION_RECOVERY_FILE,
  REFLECTION_TRANSACTION_FILE,
  ReflectionTransactionJournalSchema,
  createReflectionGameDeletionLifecycle,
  createReflectionNoteInvalidationLifecycle,
  createReflectionTransactionService,
} from "../../src/services/reflection-transaction-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createReflectionStartupValidator } from "../../src/services/reflection-startup-validation.js";

const TIME = "2026-08-31T12:00:00.000Z";
const PRIVATE_TEXT = "NOTE_TEXT_MUST_NOT_RETURN_661f";
const RAW_TEMP_TEXT = "RAW_TEMP_NOTE_TEXT_MUST_NOT_RETURN_8c42";
const silentLogger = { log() {}, warn() {}, error() {} };

function completed(
  questionId: ReflectionQuestionId,
  dependency: ReflectionCompleted["dependencies"][number],
  collection: Collection,
): ReflectionCompleted {
  return ReflectionCompletedSchema.parse({
    outcome: "abstained",
    reason: "no-material-synthesis",
    explanation: dependency.category === "note" ? PRIVATE_TEXT : `safe-${questionId}`,
    supportingBlocks: [
      {
        text: dependency.category === "note" ? PRIVATE_TEXT : `safe-${questionId}`,
        citationIds: ["citation"],
      },
    ],
    citations: [
      dependency.category === "note"
        ? {
            citationId: "citation",
            sourceId: dependency.gameId,
            sourceVersion: String(dependency.noteVersion),
            evidenceClass: "owner-game-note",
            testimony: true,
            canonicalSummary: PRIVATE_TEXT,
            destination: {
              operationId: "shelf.game.get",
              parameters: { gameId: dependency.gameId },
            },
          }
        : {
            citationId: "citation",
            sourceId: dependency.sourceId,
            sourceVersion: "1",
            evidenceClass: "imported-metadata",
            testimony: false,
            canonicalSummary: `safe-${questionId}`,
            destination: {
              operationId: "shelf.game.get",
              parameters: {
                gameId: dependency.sourceId.split(":")[1] ?? dependency.sourceId,
              },
            },
          },
    ],
    scope: {
      examinedPresentNoteCount: dependency.category === "note" ? 1 : 0,
      totalPresentNoteCount: dependency.category === "note" ? 1 : 0,
      examinedGameCount: 1,
      relevantEligibleGameCount: 1,
      excludedGameCount: 0,
      exhaustiveNotes: true,
      ...(questionId === "pattern-exceptions" ? { patternCandidateIds: [] } : {}),
    },
    evidenceIdentity: {
      manifestVersion: 1,
      questionId,
      questionVersion: 1,
      collectionId: collection.id,
      collectionSchemaVersion: collection.schemaVersion,
      collectionRevision: collection.revision,
      profileContractVersion: 1,
      profileAlgorithmVersion: 1,
      providerId: "provider",
      modelId: "model",
    },
    dependencies: [dependency],
    generatedAt: TIME,
    usage: { state: "unavailable" },
  });
}

function currentSources(
  result: ReflectionCompleted,
  collection: Collection,
): ReflectionCurrentSources {
  return {
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    collectionRevision: collection.revision,
    profileContractVersion: result.evidenceIdentity.profileContractVersion,
    profileAlgorithmVersion: result.evidenceIdentity.profileAlgorithmVersion,
    providerId: result.evidenceIdentity.providerId,
    modelId: result.evidenceIdentity.modelId,
    dependenciesByQuestion: {
      "repeated-values":
        result.evidenceIdentity.questionId === "repeated-values" ? result.dependencies : [],
      "pattern-exceptions":
        result.evidenceIdentity.questionId === "pattern-exceptions" ? result.dependencies : [],
      "recurring-trade-offs":
        result.evidenceIdentity.questionId === "recurring-trade-offs" ? result.dependencies : [],
    },
  };
}

async function harness() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "shelf-judge-reflection-tx-"));
  const baseFileOps = createFileOps();
  let fileOps: FileOps = baseFileOps;
  const serializedLogs: string[] = [];
  const logger = {
    log: (...args: unknown[]) => serializedLogs.push(JSON.stringify(args)),
    warn: (...args: unknown[]) => serializedLogs.push(JSON.stringify(args)),
    error: (...args: unknown[]) => serializedLogs.push(JSON.stringify(args)),
  };
  const forwardedFileOps = (): FileOps => ({
    readFile: (...args) => fileOps.readFile(...args),
    writeFile: (...args) => fileOps.writeFile(...args),
    writeFileExclusive: (...args) => fileOps.writeFileExclusive(...args),
    rename: (...args) => fileOps.rename(...args),
    exists: (...args) => fileOps.exists(...args),
    mkdir: (...args) => fileOps.mkdir(...args),
    listFiles: (...args) => fileOps.listFiles(...args),
    unlink: (...args) => fileOps.unlink(...args),
  });
  const storageService = createStorageService({
    dataDir,
    configPath: path.join(dataDir, "config.json"),
    fileOps: forwardedFileOps(),
    logger,
  });
  await storageService.loadCollection();
  const coordinator = profileSourceCoordinatorFor(storageService);
  const mutationService = createCollectionMutationService({ storageService, logger });
  const games = createGameService({
    storageService,
    collectionMutationService: mutationService,
    fitnessService: createFitnessService(),
    now: () => TIME,
    logger,
  });
  const affected = (await games.addGame({ name: "Affected" })).game;
  const unrelated = (await games.addGame({ name: "Unrelated" })).game;
  await mutationService.mutate(
    { operation: "test.seed-owner-note", trigger: "test", gameIds: [affected.id] },
    (collection) => {
      const game = collection.games.find(({ id }) => id === affected.id);
      if (game === undefined) throw new Error("Expected affected game");
      game.ownerNote = { state: "present", version: 1, text: "initial note", updatedAt: TIME };
      return { changed: true, value: undefined };
    },
  );
  const reflectionStorage = createReflectionStorage({
    dataDir,
    fileOps: forwardedFileOps(),
    logger,
  });
  const source = await storageService.loadCollection();
  const state = await reflectionStorage.loadState();
  state.questions[0].cache = completed(
    "repeated-values",
    { category: "note", gameId: affected.id, noteVersion: 1 },
    source,
  );
  state.questions[1].cache = completed(
    "pattern-exceptions",
    { category: "metadata", sourceId: `game:${affected.id}:metadata`, fingerprint: "a" },
    source,
  );
  state.questions[2].cache = completed(
    "recurring-trade-offs",
    { category: "metadata", sourceId: `game:${unrelated.id}:metadata`, fingerprint: "b" },
    source,
  );
  await reflectionStorage.saveState(state);
  let generation = 0;
  const makeTransactions = () =>
    createReflectionTransactionService({
      dataDir,
      fileOps: forwardedFileOps(),
      storage: reflectionStorage,
      collectionReader: storageService,
      coordinator,
      logger,
      createGeneration: () => `20000000-0000-4000-8000-${String(++generation).padStart(12, "0")}`,
    });
  const transactions = makeTransactions();
  const notes = createOwnerGameNoteService({
    collectionMutationService: mutationService,
    invalidationLifecycle: createReflectionNoteInvalidationLifecycle(transactions),
    now: () => TIME,
    logger,
  });
  const restart = (options?: {
    validateStartup?: boolean;
    failStartupValidation?: boolean;
    providerIdentity?: { providerId: string; modelId: string } | null;
    questionVersions?: Partial<Record<ReflectionQuestionId, number>>;
  }) => {
    const restartedStorageService = createStorageService({
      dataDir,
      configPath: path.join(dataDir, "config.json"),
      fileOps: forwardedFileOps(),
      logger,
    });
    const restartedCoordinator = profileSourceCoordinatorFor(restartedStorageService);
    const restartedReflectionStorage = createReflectionStorage({
      dataDir,
      fileOps: forwardedFileOps(),
      logger,
    });
    const startupValidator = createReflectionStartupValidator({
      storage: restartedReflectionStorage,
      collectionReader: restartedStorageService,
      providerIdentity: options?.providerIdentity ?? { providerId: "provider", modelId: "model" },
      createGeneration: () => `20000000-0000-4000-8000-${String(++generation).padStart(12, "0")}`,
      now: () => TIME,
      logger,
      questionVersions: options?.questionVersions,
    });
    let startupValidated = false;
    const restartedTransactions = createReflectionTransactionService({
      dataDir,
      fileOps: forwardedFileOps(),
      storage: restartedReflectionStorage,
      collectionReader: restartedStorageService,
      coordinator: restartedCoordinator,
      logger,
      createGeneration: () => `20000000-0000-4000-8000-${String(++generation).padStart(12, "0")}`,
      validateAfterRecovery: options?.validateStartup
        ? async () => {
            if (startupValidated) return;
            if (options.failStartupValidation) throw new Error("startup source unavailable");
            await startupValidator();
            startupValidated = true;
          }
        : undefined,
    });
    const restartedMutationService = createCollectionMutationService({
      storageService: restartedStorageService,
      logger,
    });
    return {
      affected,
      storageService: restartedStorageService,
      reflectionStorage: restartedReflectionStorage,
      coordinator: restartedCoordinator,
      transactions: restartedTransactions,
      notes: createOwnerGameNoteService({
        collectionMutationService: restartedMutationService,
        invalidationLifecycle: createReflectionNoteInvalidationLifecycle(restartedTransactions),
        logger,
      }),
    };
  };
  return {
    dataDir,
    affected,
    unrelated,
    storageService,
    mutationService,
    reflectionStorage,
    coordinator,
    notes,
    games,
    transactions,
    makeTransactions,
    restart,
    inject(next: FileOps) {
      fileOps = next;
    },
    baseFileOps,
    logger,
    serializedLogs,
    cleanup: () => fs.rm(dataDir, { recursive: true, force: true }),
  };
}

function interruptRename(
  base: FileOps,
  matches: (from: string, to: string) => boolean,
  afterRename = false,
): FileOps {
  let interrupted = false;
  return {
    ...base,
    async rename(from, to) {
      if (!interrupted && matches(from, to)) {
        interrupted = true;
        if (afterRename) await base.rename(from, to);
        throw new Error("named interruption");
      }
      await base.rename(from, to);
    },
  };
}

function interruptUnlink(
  base: FileOps,
  matches: (filePath: string) => boolean,
  afterUnlink = false,
) {
  let interrupted = false;
  return {
    ...base,
    async unlink(filePath: string) {
      if (!interrupted && matches(filePath)) {
        interrupted = true;
        if (afterUnlink) await base.unlink(filePath);
        throw new Error("named interruption");
      }
      await base.unlink(filePath);
    },
  } satisfies FileOps;
}

async function expectNotePairing(
  ctx: Pick<
    Awaited<ReturnType<typeof harness>>,
    "storageService" | "reflectionStorage" | "affected"
  >,
  expected: "prior" | "target",
) {
  const collection = await ctx.storageService.loadCollection();
  const state = await ctx.reflectionStorage.loadState();
  const affected = collection.games.find(({ id }) => id === ctx.affected.id);
  if (affected === undefined) throw new Error("Expected affected game to remain present");
  expect(affected.ownerNote.version).toBe(expected === "target" ? 2 : 1);
  expect(state.questions.map(({ cache }) => cache === null)).toEqual(
    expected === "target" ? [true, true, false] : [false, false, false],
  );
}

describe("Reflection purge transactions on real files", () => {
  test("restart destroys raw note-bearing stage and active-state temps left before rename", async () => {
    const ctx = await harness();
    try {
      const stageTarget = path.join(
        ctx.dataDir,
        `${REFLECTION_STAGE_PREFIX}33000000-0000-4000-8000-000000000001.${"a".repeat(64)}.json`,
      );
      const rawStageTemp = getTempPath(stageTarget, "44000000-0000-4000-8000-000000000001");
      const rawStateTemp = getTempPath(
        path.join(ctx.dataDir, REFLECTION_STATE_FILE),
        "44000000-0000-4000-8000-000000000002",
      );
      await fs.writeFile(rawStageTemp, RAW_TEMP_TEXT, "utf8");
      await fs.writeFile(rawStateTemp, RAW_TEMP_TEXT, "utf8");
      const unrelatedTemp = path.join(ctx.dataDir, ".profile-reflections-unrelated.raw.tmp");
      const stateBackup = path.join(ctx.dataDir, ".profile-reflections.json.backup");
      const stageLookalike = path.join(ctx.dataDir, ".profile-reflections.stage.user-backup");
      const malformedStageTemp = path.join(
        ctx.dataDir,
        `.${path.basename(stageTarget)}.raw-stage-crash.tmp`,
      );
      await fs.writeFile(unrelatedTemp, "unrelated", "utf8");
      await fs.writeFile(stateBackup, "unrelated", "utf8");
      await fs.writeFile(stageLookalike, "unrelated", "utf8");
      await fs.writeFile(malformedStageTemp, "unrelated", "utf8");

      const restarted = ctx.restart();
      await restarted.transactions.recover();

      const files = await fs.readdir(ctx.dataDir);
      expect(files).not.toContain(path.basename(rawStageTemp));
      expect(files).not.toContain(path.basename(rawStateTemp));
      expect(files).toContain(path.basename(unrelatedTemp));
      expect(files).toContain(path.basename(stateBackup));
      expect(files).toContain(path.basename(stageLookalike));
      expect(files).toContain(path.basename(malformedStageTemp));
      const serializedFiles = await Promise.all(
        files.map((name) => fs.readFile(path.join(ctx.dataDir, name), "utf8")),
      );
      expect(serializedFiles.join("\n")).not.toContain(RAW_TEMP_TEXT);
    } finally {
      await ctx.cleanup();
    }
  });

  test("restart cleans raw settings stage and active-settings temps without replacing valid settings", async () => {
    const ctx = await harness();
    try {
      const settings = await ctx.reflectionStorage.loadSettings();
      settings.questions[1].enabled = false;
      await ctx.reflectionStorage.saveSettings(settings);
      const settingsStageTarget = path.join(
        ctx.dataDir,
        `${REFLECTION_SETTINGS_STAGE_PREFIX}33000000-0000-4000-8000-000000000002.${"b".repeat(64)}.json`,
      );
      const rawStageTemp = getTempPath(settingsStageTarget, "44000000-0000-4000-8000-000000000003");
      const rawSettingsTemp = getTempPath(
        path.join(ctx.dataDir, REFLECTION_SETTINGS_FILE),
        "44000000-0000-4000-8000-000000000004",
      );
      await fs.writeFile(rawStageTemp, "TEXT_FREE_SETTINGS_TEMP", "utf8");
      await fs.writeFile(rawSettingsTemp, "TEXT_FREE_SETTINGS_TEMP", "utf8");

      const restarted = ctx.restart();
      await restarted.transactions.recover();

      const files = await fs.readdir(ctx.dataDir);
      expect(files).not.toContain(path.basename(rawStageTemp));
      expect(files).not.toContain(path.basename(rawSettingsTemp));
      expect((await restarted.reflectionStorage.loadSettings()).questions[1].enabled).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  test("no-journal startup validation purges changed-note output and fences its stale generation", async () => {
    const ctx = await harness();
    try {
      const stateService = createReflectionStateService({
        storage: ctx.reflectionStorage,
        coordinator: ctx.coordinator,
      });
      const staleFence = await stateService.startAttempt("recurring-trade-offs", "stale-process");
      const priorGeneration = staleFence.deletionGeneration;
      const sourceOnlyNotes = createOwnerGameNoteService({
        collectionMutationService: ctx.mutationService,
        logger: ctx.logger,
      });
      expect(
        await sourceOnlyNotes.set(ctx.affected.id, {
          commandId: "33000000-0000-4000-8000-000000000003",
          expectedVersion: 1,
          text: PRIVATE_TEXT,
        }),
      ).toMatchObject({ ok: true });

      const restarted = ctx.restart({ validateStartup: true });
      await restarted.transactions.recover();
      const state = await restarted.reflectionStorage.loadState();
      expect(state.deletionGeneration).not.toBe(priorGeneration);
      expect(state.questions[0]).toMatchObject({
        cache: null,
        attempt: { state: "purged", reason: "note-changed" },
      });
      expect(state.questions[1].cache).not.toBeNull();
      expect(state.questions[2].cache).not.toBeNull();
      expect(state.questions[2].attempt).toMatchObject({
        state: "unavailable",
        safeDetail: "daemon-restarted",
      });

      const collection = await restarted.storageService.loadCollection();
      const lateResult = completed(
        "recurring-trade-offs",
        { category: "metadata", sourceId: `game:${ctx.unrelated.id}:metadata`, fingerprint: "b" },
        collection,
      );
      const restartedStateService = createReflectionStateService({
        storage: restarted.reflectionStorage,
        coordinator: restarted.coordinator,
      });
      expect(
        await restartedStateService.completeAttempt(staleFence, lateResult, () =>
          currentSources(lateResult, collection),
        ),
      ).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  test("no-journal startup validation purges every cache that examined a deleted game", async () => {
    const ctx = await harness();
    try {
      const priorGeneration = (await ctx.reflectionStorage.loadState()).deletionGeneration;
      await ctx.mutationService.mutate(
        {
          operation: "test.source-only-delete",
          trigger: "test",
          gameIds: [ctx.affected.id],
        },
        (collection) => {
          collection.games = collection.games.filter(({ id }) => id !== ctx.affected.id);
          collection.commandReceipts = collection.commandReceipts.filter(
            (receipt) => !("gameId" in receipt && receipt.gameId === ctx.affected.id),
          );
          return { changed: true, value: undefined };
        },
      );

      const restarted = ctx.restart({ validateStartup: true });
      await restarted.transactions.recover();
      const state = await restarted.reflectionStorage.loadState();
      expect(state.deletionGeneration).not.toBe(priorGeneration);
      expect(state.questions.map(({ cache }) => cache === null)).toEqual([true, true, false]);
      expect(state.questions[0].attempt).toMatchObject({
        state: "purged",
        reason: "game-deleted",
      });
      expect(state.questions[1].attempt).toMatchObject({
        state: "purged",
        reason: "game-deleted",
      });
    } finally {
      await ctx.cleanup();
    }
  });

  test("startup preserves provider, model, question-policy, and revision drift as stale", async () => {
    const ctx = await harness();
    try {
      const state = await ctx.reflectionStorage.loadState();
      const questions = structuredClone(state.questions);
      if (
        questions[0].cache === null ||
        questions[1].cache === null ||
        questions[2].cache === null
      ) {
        throw new Error("Expected seeded Reflection caches");
      }
      questions[0].cache.evidenceIdentity.providerId = "old-provider";
      questions[2].cache.evidenceIdentity.modelId = "old-model";
      await ctx.reflectionStorage.saveState({ ...state, questions });
      await ctx.mutationService.mutate(
        { operation: "test.non-note-revision", trigger: "test" },
        (collection) => {
          collection.name = "Revision-only drift";
          return { changed: true, value: undefined };
        },
      );

      const restarted = ctx.restart({
        validateStartup: true,
        providerIdentity: { providerId: "provider", modelId: "model" },
        questionVersions: { "pattern-exceptions": 2 },
      });
      await restarted.transactions.recover();
      const validated = await restarted.reflectionStorage.loadState();
      expect(validated.questions.every(({ cache }) => cache !== null)).toBe(true);

      const collection = await restarted.storageService.loadCollection();
      const readService = createReflectionStateService({
        storage: restarted.reflectionStorage,
        coordinator: restarted.coordinator,
      });
      const projection = await readService.read({
        collectionId: collection.id,
        collectionSchemaVersion: collection.schemaVersion,
        collectionRevision: collection.revision,
        profileContractVersion: 1,
        profileAlgorithmVersion: 1,
        providerId: "provider",
        modelId: "model",
        questionVersions: {
          "pattern-exceptions": 2,
        },
        dependenciesByQuestion: {
          "repeated-values": questions[0].cache.dependencies,
          "pattern-exceptions": questions[1].cache.dependencies,
          "recurring-trade-offs": questions[2].cache.dependencies,
        },
      });
      expect(projection.every(({ cache }) => cache.state === "stale")).toBe(true);
      if (projection[0].cache.state !== "stale" || projection[1].cache.state !== "stale") {
        throw new Error("Expected stale provider and policy projections");
      }
      expect(projection[0].cache.changedCategories).toContain("provider-configuration");
      expect(projection[1].cache.changedCategories).toContain("question-policy");
    } finally {
      await ctx.cleanup();
    }
  });

  test("startup removes hidden disabled caches while preserving valid settings and other caches", async () => {
    const ctx = await harness();
    try {
      const stateService = createReflectionStateService({
        storage: ctx.reflectionStorage,
        coordinator: ctx.coordinator,
      });
      const disabledFence = await stateService.startAttempt("repeated-values", "disabled-restart");
      const priorState = await ctx.reflectionStorage.loadState();
      const settings = await ctx.reflectionStorage.loadSettings();
      settings.questions[0].enabled = false;
      await ctx.reflectionStorage.saveSettings(settings);

      const restarted = ctx.restart({ validateStartup: true });
      await restarted.transactions.recover();
      const state = await restarted.reflectionStorage.loadState();
      expect((await restarted.reflectionStorage.loadSettings()).questions[0].enabled).toBe(false);
      expect(state.deletionGeneration).not.toBe(priorState.deletionGeneration);
      expect(state.deletionGeneration).not.toBe(disabledFence.deletionGeneration);
      expect(state.questions[0]).toMatchObject({ cache: null, attempt: { state: "idle" } });
      expect(state.questions[1].cache).not.toBeNull();
      expect(state.questions[2].cache).not.toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });

  test("startup validation failure resets note-bearing state and records a text-free diagnostic", async () => {
    const ctx = await harness();
    try {
      const priorGeneration = (await ctx.reflectionStorage.loadState()).deletionGeneration;
      const settings = await ctx.reflectionStorage.loadSettings();
      settings.questions[2].enabled = false;
      await ctx.reflectionStorage.saveSettings(settings);

      const restarted = ctx.restart({ validateStartup: true, failStartupValidation: true });
      await restarted.transactions.recover();
      const recoveredState = await restarted.reflectionStorage.loadState();
      expect(recoveredState.questions.every(({ cache }) => cache === null)).toBe(true);
      expect(recoveredState.deletionGeneration).not.toBe(priorGeneration);
      expect((await restarted.reflectionStorage.loadSettings()).questions[2].enabled).toBe(false);
      const diagnostic = await fs.readFile(
        path.join(ctx.dataDir, REFLECTION_RECOVERY_FILE),
        "utf8",
      );
      expect(diagnostic).toContain("startup-validation-failed");
      expect(diagnostic).not.toContain(PRIVATE_TEXT);
    } finally {
      await ctx.cleanup();
    }
  });

  for (const boundary of [
    { name: "before-stage-write", target: "stage" as const, after: false },
    { name: "after-stage-write", target: "stage" as const, after: true },
    { name: "before-journal-publication", target: "journal" as const, after: false },
    { name: "after-journal-publication", target: "journal" as const, after: true },
  ]) {
    test(`recovers the ${boundary.name} failpoint to the prior pairing`, async () => {
      const ctx = await harness();
      try {
        const prior = await ctx.storageService.loadCollection();
        const target = { ...prior, revision: prior.revision + 1 };
        ctx.inject(
          interruptRename(
            ctx.baseFileOps,
            (_from, to) =>
              boundary.target === "stage"
                ? path.basename(to).startsWith(REFLECTION_STAGE_PREFIX)
                : to.endsWith(REFLECTION_TRANSACTION_FILE),
            boundary.after,
          ),
        );
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
        await expect(
          ctx.transactions.beforeSourcePersistence({
            priorSourceIdentity: collectionDurableIdentity(prior),
            targetSourceIdentity: collectionDurableIdentity(target),
            affectedGameIds: [ctx.affected.id],
            reason: "note-changed",
          }),
        ).rejects.toThrow("named interruption");

        ctx.inject(ctx.baseFileOps);
        const restarted = ctx.restart();
        await restarted.transactions.recover();
        await expectNotePairing(restarted, "prior");
        expect(await fs.readdir(ctx.dataDir)).not.toContain(REFLECTION_TRANSACTION_FILE);
        expect(
          (await fs.readdir(ctx.dataDir)).some((name) => name.startsWith(REFLECTION_STAGE_PREFIX)),
        ).toBe(false);
      } finally {
        await ctx.cleanup();
      }
    });
  }

  for (const boundary of [
    { name: "before-collection-rename", kind: "collection" as const, after: false },
    { name: "after-collection-rename-response-loss", kind: "collection" as const, after: true },
    { name: "before-promotion", kind: "promotion" as const, after: false },
    { name: "after-promotion", kind: "promotion" as const, after: true },
    { name: "before-journal-cleanup", kind: "cleanup" as const, after: false },
    { name: "after-journal-cleanup", kind: "cleanup" as const, after: true },
  ]) {
    test(`recovers the ${boundary.name} failpoint to a valid pairing`, async () => {
      const ctx = await harness();
      try {
        ctx.inject(
          boundary.kind === "cleanup"
            ? interruptUnlink(
                ctx.baseFileOps,
                (filePath) => filePath.endsWith(REFLECTION_TRANSACTION_FILE),
                boundary.after,
              )
            : interruptRename(
                ctx.baseFileOps,
                (from, to) =>
                  boundary.kind === "collection"
                    ? to.endsWith("collection.json")
                    : from.includes(REFLECTION_STAGE_PREFIX) && to.endsWith(REFLECTION_STATE_FILE),
                boundary.after,
              ),
        );
        const request = {
          commandId: `31000000-0000-4000-8000-00000000000${
            [
              "before-collection-rename",
              "after-collection-rename-response-loss",
              "before-promotion",
              "after-promotion",
              "before-journal-cleanup",
              "after-journal-cleanup",
            ].indexOf(boundary.name) + 1
          }`,
          expectedVersion: 1,
          text: "replacement note",
        };
        const result = await ctx.notes.set(ctx.affected.id, request);
        if (boundary.kind === "collection" && boundary.after) {
          expect(result).toMatchObject({ ok: true });
        } else {
          expect(result).toMatchObject({ ok: false, error: { code: "persistence-failure" } });
        }

        ctx.inject(ctx.baseFileOps);
        const restarted = ctx.restart();
        await restarted.transactions.recover();
        await expectNotePairing(
          restarted,
          boundary.kind === "collection" && !boundary.after ? "prior" : "target",
        );
        if (boundary.kind !== "collection" || boundary.after) {
          expect(await restarted.notes.set(ctx.affected.id, request)).toMatchObject({
            ok: true,
            accepted: { replayed: true },
          });
        }
        expect(await fs.readdir(ctx.dataDir)).not.toContain(REFLECTION_TRANSACTION_FILE);
      } finally {
        await ctx.cleanup();
      }
    });
  }

  test("reconstructs services after an operation response is lost and replays the committed receipt", async () => {
    const ctx = await harness();
    try {
      const request = {
        commandId: "31000000-0000-4000-8000-000000000007",
        expectedVersion: 1,
        text: "replacement note",
      };
      await ctx.notes.set(ctx.affected.id, request);

      const restarted = ctx.restart();
      await restarted.transactions.recover();
      expect(await restarted.notes.set(ctx.affected.id, request)).toMatchObject({
        ok: true,
        accepted: { replayed: true },
      });
      await expectNotePairing(restarted, "target");
    } finally {
      await ctx.cleanup();
    }
  });

  test("an interrupted stage write leaves the prior state active and recovery removes debris", async () => {
    const ctx = await harness();
    try {
      const priorSource = await ctx.storageService.loadCollection();
      const priorState = await ctx.reflectionStorage.loadState();
      const targetSource = { ...priorSource, revision: priorSource.revision + 1 };
      ctx.inject(
        interruptRename(ctx.baseFileOps, (_from, to) =>
          path.basename(to).startsWith(REFLECTION_STAGE_PREFIX),
        ),
      );
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
      await expect(
        ctx.transactions.beforeSourcePersistence({
          priorSourceIdentity: collectionDurableIdentity(priorSource),
          targetSourceIdentity: collectionDurableIdentity(targetSource),
          affectedGameIds: [ctx.affected.id],
          reason: "note-changed",
        }),
      ).rejects.toThrow("named interruption");
      expect(await ctx.reflectionStorage.loadState()).toEqual(priorState);
      expect(await fs.readdir(ctx.dataDir)).not.toContain(REFLECTION_TRANSACTION_FILE);

      ctx.inject(ctx.baseFileOps);
      await ctx.makeTransactions().recover();
      expect(
        (await fs.readdir(ctx.dataDir)).some((name) => name.startsWith(REFLECTION_STAGE_PREFIX)),
      ).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  test("stages before journal publication and removes an orphan after interrupted journal publication", async () => {
    const ctx = await harness();
    try {
      const prior = await ctx.storageService.loadCollection();
      const target = { ...prior, revision: prior.revision + 1 };
      ctx.inject(
        interruptRename(ctx.baseFileOps, (_from, to) => to.endsWith(REFLECTION_TRANSACTION_FILE)),
      );
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
      await expect(
        ctx.transactions.beforeSourcePersistence({
          priorSourceIdentity: collectionDurableIdentity(prior),
          targetSourceIdentity: collectionDurableIdentity(target),
          affectedGameIds: [ctx.affected.id],
          reason: "note-changed",
        }),
      ).rejects.toThrow("named interruption");
      expect(
        (await fs.readdir(ctx.dataDir)).some((name) => name.startsWith(REFLECTION_STAGE_PREFIX)),
      ).toBe(true);
      ctx.inject(ctx.baseFileOps);
      await ctx.makeTransactions().recover();
      expect(
        (await fs.readdir(ctx.dataDir)).some((name) => name.startsWith(REFLECTION_STAGE_PREFIX)),
      ).toBe(false);
      expect((await ctx.reflectionStorage.loadState()).questions[0].cache).not.toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });

  test("definite collection rename failure compensates and preserves prior cache and attempt metadata", async () => {
    const ctx = await harness();
    try {
      const before = await ctx.reflectionStorage.loadState();
      ctx.inject(interruptRename(ctx.baseFileOps, (_from, to) => to.endsWith("collection.json")));
      const result = await ctx.notes.set(ctx.affected.id, {
        commandId: "30000000-0000-4000-8000-000000000001",
        expectedVersion: 1,
        text: "replacement note",
      });
      expect(result).toMatchObject({ ok: false, error: { code: "persistence-failure" } });
      expect(await ctx.reflectionStorage.loadState()).toEqual(before);
      expect(await fs.readdir(ctx.dataDir)).not.toContain(REFLECTION_TRANSACTION_FILE);
    } finally {
      await ctx.cleanup();
    }
  });

  test("published journal and purged stage contain no changed note or generated text", async () => {
    const ctx = await harness();
    try {
      const prior = await ctx.storageService.loadCollection();
      const target = { ...prior, revision: prior.revision + 1 };
      await ctx.transactions.beforeSourcePersistence({
        priorSourceIdentity: collectionDurableIdentity(prior),
        targetSourceIdentity: collectionDurableIdentity(target),
        affectedGameIds: [ctx.affected.id],
        reason: "note-changed",
      });
      const files = await fs.readdir(ctx.dataDir);
      const journal = await fs.readFile(
        path.join(ctx.dataDir, REFLECTION_TRANSACTION_FILE),
        "utf8",
      );
      const stageName = files.find((name) => name.startsWith(REFLECTION_STAGE_PREFIX));
      if (stageName === undefined) throw new Error("Expected a staged Reflection artifact");
      const stage = await fs.readFile(path.join(ctx.dataDir, stageName), "utf8");
      expect(journal).not.toContain(PRIVATE_TEXT);
      expect(stage).not.toContain(PRIVATE_TEXT);
      await ctx.transactions.onSourcePersistenceFailure();
    } finally {
      await ctx.cleanup();
    }
  });

  test("journal binds the transaction, source mutation, affected scope, and staged artifact", async () => {
    const ctx = await harness();
    try {
      const priorSource = await ctx.storageService.loadCollection();
      const priorState = await ctx.reflectionStorage.loadState();
      const targetSource = { ...priorSource, revision: priorSource.revision + 1 };
      await ctx.transactions.beforeSourcePersistence({
        priorSourceIdentity: collectionDurableIdentity(priorSource),
        targetSourceIdentity: collectionDurableIdentity(targetSource),
        affectedGameIds: [ctx.affected.id],
        reason: "note-changed",
      });

      const journal = ReflectionTransactionJournalSchema.parse(
        JSON.parse(await fs.readFile(path.join(ctx.dataDir, REFLECTION_TRANSACTION_FILE), "utf8")),
      );
      expect(journal.transactionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(journal.priorSourceIdentity).toEqual(collectionDurableIdentity(priorSource));
      expect(journal.targetSourceIdentity).toEqual(collectionDurableIdentity(targetSource));
      expect(journal.affectedGameIds).toEqual([ctx.affected.id]);
      expect(journal.affectedQuestionIds).toEqual(["repeated-values", "pattern-exceptions"]);
      expect(journal.priorActiveArtifactIdentity).toBe(
        ctx.reflectionStorage.stateIdentity(priorState),
      );
      const staged = await ctx.reflectionStorage.loadStagedState(journal.stagedTarget);
      if (staged === null) throw new Error("Expected journaled staged state");
      expect(journal.stagedTarget.identity).toBe(ctx.reflectionStorage.stateIdentity(staged));
      expect(journal.stagedTarget.fileName).toStartWith(REFLECTION_STAGE_PREFIX);

      await ctx.transactions.onSourcePersistenceFailure();
    } finally {
      await ctx.cleanup();
    }
  });

  test("durable deletion identity changes at the same revision when the game and note receipt disappear", async () => {
    const ctx = await harness();
    try {
      const noteService = createOwnerGameNoteService({
        collectionMutationService: createCollectionMutationService({
          storageService: ctx.storageService,
          logger: silentLogger,
        }),
        logger: silentLogger,
      });
      await noteService.set(ctx.affected.id, {
        commandId: "31000000-0000-4000-8000-000000000008",
        expectedVersion: 1,
        text: "deleted note",
      });
      const prior = await ctx.storageService.loadCollection();
      const target = structuredClone(prior);
      target.games = target.games.filter(({ id }) => id !== ctx.affected.id);
      target.commandReceipts = target.commandReceipts.filter(
        (receipt) => !("gameId" in receipt && receipt.gameId === ctx.affected.id),
      );
      target.revision = prior.revision;

      const priorIdentity = collectionDurableIdentity(prior);
      const targetIdentity = collectionDurableIdentity(target);
      expect(targetIdentity.revision).toBe(priorIdentity.revision);
      expect(targetIdentity.contentHash).not.toBe(priorIdentity.contentHash);
      expect(target.games.some(({ id }) => id === ctx.affected.id)).toBe(false);
      expect(
        target.commandReceipts.some(
          (receipt) => "gameId" in receipt && receipt.gameId === ctx.affected.id,
        ),
      ).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  test("lost collection save response is classified by reload and purge is promoted before acceptance", async () => {
    const ctx = await harness();
    try {
      ctx.inject(
        interruptRename(ctx.baseFileOps, (_from, to) => to.endsWith("collection.json"), true),
      );
      const result = await ctx.notes.set(ctx.affected.id, {
        commandId: "30000000-0000-4000-8000-000000000002",
        expectedVersion: 1,
        text: "replacement note",
      });
      expect(result.ok).toBe(true);
      const state = await ctx.reflectionStorage.loadState();
      expect(state.questions.map(({ cache }) => cache === null)).toEqual([true, true, false]);
      const serializedFiles = await Promise.all(
        (await fs.readdir(ctx.dataDir)).map((name) =>
          fs.readFile(path.join(ctx.dataDir, name), "utf8"),
        ),
      );
      expect(serializedFiles.join("\n")).not.toContain(PRIVATE_TEXT);
      expect(await fs.readdir(ctx.dataDir)).not.toContain(REFLECTION_TRANSACTION_FILE);
    } finally {
      await ctx.cleanup();
    }
  });

  test("restart promotes after interrupted promotion and cleans an already-promoted stage-absent journal", async () => {
    for (const boundary of ["promotion", "journal-cleanup"] as const) {
      const ctx = await harness();
      try {
        ctx.inject(
          boundary === "promotion"
            ? interruptRename(
                ctx.baseFileOps,
                (from, to) =>
                  from.includes(REFLECTION_STAGE_PREFIX) && to.endsWith(REFLECTION_STATE_FILE),
              )
            : {
                ...ctx.baseFileOps,
                unlink: async (filePath) => {
                  if (filePath.endsWith(REFLECTION_TRANSACTION_FILE))
                    throw new Error("named interruption");
                  await ctx.baseFileOps.unlink(filePath);
                },
              },
        );
        const result = await ctx.notes.set(ctx.affected.id, {
          commandId:
            boundary === "promotion"
              ? "30000000-0000-4000-8000-000000000003"
              : "30000000-0000-4000-8000-000000000004",
          expectedVersion: 1,
          text: "replacement note",
        });
        expect(result).toMatchObject({ ok: false, error: { code: "persistence-failure" } });
        ctx.inject(ctx.baseFileOps);
        await ctx.makeTransactions().recover();
        const state = await ctx.reflectionStorage.loadState();
        expect(state.questions.map(({ cache }) => cache === null)).toEqual([true, true, false]);
        expect(await fs.readdir(ctx.dataDir)).not.toContain(REFLECTION_TRANSACTION_FILE);
        expect(
          (await fs.readdir(ctx.dataDir)).some((name) => name.startsWith(REFLECTION_STAGE_PREFIX)),
        ).toBe(false);
        const replay = await createOwnerGameNoteService({
          collectionMutationService: createCollectionMutationService({
            storageService: ctx.storageService,
            logger: silentLogger,
          }),
          invalidationLifecycle: createReflectionNoteInvalidationLifecycle(ctx.makeTransactions()),
          logger: silentLogger,
        }).set(ctx.affected.id, {
          commandId:
            boundary === "promotion"
              ? "30000000-0000-4000-8000-000000000003"
              : "30000000-0000-4000-8000-000000000004",
          expectedVersion: 1,
          text: "replacement note",
        });
        expect(replay).toMatchObject({ ok: true, accepted: { replayed: true } });
      } finally {
        await ctx.cleanup();
      }
    }
  });

  test("permanent deletion purges every dependency representation before success and removes note receipts", async () => {
    const ctx = await harness();
    try {
      const uncoordinatedNote = createOwnerGameNoteService({
        collectionMutationService: createCollectionMutationService({
          storageService: ctx.storageService,
          logger: ctx.logger,
        }),
        now: () => TIME,
        logger: ctx.logger,
      });
      expect(
        await uncoordinatedNote.set(ctx.affected.id, {
          commandId: "30000000-0000-4000-8000-000000000005",
          expectedVersion: 1,
          text: PRIVATE_TEXT,
        }),
      ).toMatchObject({ ok: true });
      const deletionService = createGameService({
        storageService: ctx.storageService,
        collectionMutationService: createCollectionMutationService({
          storageService: ctx.storageService,
          logger: ctx.logger,
        }),
        fitnessService: createFitnessService(),
        deletionLifecycle: createReflectionGameDeletionLifecycle(ctx.transactions),
        now: () => TIME,
        logger: ctx.logger,
      });

      await deletionService.removeGame(ctx.affected.id);

      const state = await ctx.reflectionStorage.loadState();
      expect(state.questions.map(({ cache }) => cache === null)).toEqual([true, true, false]);
      const collection = await ctx.storageService.loadCollection();
      expect(collection.games.some(({ id }) => id === ctx.affected.id)).toBe(false);
      expect(
        collection.commandReceipts.some(
          (receipt) => "gameId" in receipt && receipt.gameId === ctx.affected.id,
        ),
      ).toBe(false);

      ctx.inject(ctx.baseFileOps);
      const restarted = ctx.restart();
      await restarted.transactions.recover();
      const restartedState = createReflectionStateService({
        storage: restarted.reflectionStorage,
        coordinator: restarted.coordinator,
        recoverBeforeUse: () => restarted.transactions.recover(),
      });
      const projection = await restartedState.read({
        collectionId: collection.id,
        collectionSchemaVersion: collection.schemaVersion,
        collectionRevision: collection.revision,
        profileContractVersion: 1,
        profileAlgorithmVersion: 1,
        providerId: "provider",
        modelId: "model",
        dependenciesByQuestion: {
          "repeated-values": [],
          "pattern-exceptions": [],
          "recurring-trade-offs": [
            {
              category: "metadata",
              sourceId: `game:${ctx.unrelated.id}:metadata`,
              fingerprint: "b",
            },
          ],
        },
      });
      const serializedFiles = await Promise.all(
        (await fs.readdir(ctx.dataDir)).map((name) =>
          fs.readFile(path.join(ctx.dataDir, name), "utf8"),
        ),
      );
      expect(serializedFiles.join("\n")).not.toContain(PRIVATE_TEXT);
      expect(ctx.serializedLogs.join("\n")).not.toContain(PRIVATE_TEXT);
      expect(JSON.stringify(projection)).not.toContain(PRIVATE_TEXT);
    } finally {
      await ctx.cleanup();
    }
  });

  test("invalid recovery destroys note-bearing state, preserves settings, advances the generation, and fences late completion", async () => {
    const ctx = await harness();
    try {
      const settings = await ctx.reflectionStorage.loadSettings();
      settings.questions[2].enabled = false;
      await ctx.reflectionStorage.saveSettings(settings);
      const service = createReflectionStateService({
        storage: ctx.reflectionStorage,
        coordinator: ctx.coordinator,
        recoverBeforeUse: () => ctx.makeTransactions().recover(),
      });
      const fence = await service.startAttempt("repeated-values", "late-batch");
      await fs.writeFile(
        path.join(ctx.dataDir, REFLECTION_TRANSACTION_FILE),
        `{${PRIVATE_TEXT}`,
        "utf8",
      );
      await ctx.makeTransactions().recover();
      const collection = await ctx.storageService.loadCollection();
      const lateResult = completed(
        "repeated-values",
        { category: "note", gameId: ctx.affected.id, noteVersion: 1 },
        collection,
      );
      expect(
        await service.completeAttempt(fence, lateResult, () =>
          currentSources(lateResult, collection),
        ),
      ).toBe(false);
      expect(
        (await ctx.reflectionStorage.loadState()).questions.every(({ cache }) => cache === null),
      ).toBe(true);
      expect((await ctx.reflectionStorage.loadSettings()).questions[2].enabled).toBe(false);
      expect(
        await fs.readFile(path.join(ctx.dataDir, REFLECTION_RECOVERY_FILE), "utf8"),
      ).not.toContain(PRIVATE_TEXT);
    } finally {
      await ctx.cleanup();
    }
  });

  test("settings and purged state recover as one journaled publication", async () => {
    const ctx = await harness();
    try {
      const transactions = ctx.makeTransactions();
      const service = createReflectionStateService({
        storage: ctx.reflectionStorage,
        coordinator: ctx.coordinator,
        recoverBeforeUse: () => transactions.recover(),
        publishSettingsChange: (questionId, enabled) =>
          transactions.publishSettingsChange(questionId, enabled),
      });
      ctx.inject(
        interruptRename(
          ctx.baseFileOps,
          (from, to) =>
            from.includes(REFLECTION_SETTINGS_STAGE_PREFIX) &&
            to.endsWith(REFLECTION_SETTINGS_FILE),
        ),
      );
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
      await expect(service.setEnabled("repeated-values", false)).rejects.toThrow(
        "named interruption",
      );
      ctx.inject(ctx.baseFileOps);
      await ctx.makeTransactions().recover();
      expect((await ctx.reflectionStorage.loadSettings()).questions[0].enabled).toBe(false);
      expect((await ctx.reflectionStorage.loadState()).questions[0].cache).toBeNull();
      expect(await fs.readdir(ctx.dataDir)).not.toContain(REFLECTION_TRANSACTION_FILE);
    } finally {
      await ctx.cleanup();
    }
  });

  test("concurrent Reflection reads and note mutation share the coordinator without deadlock", async () => {
    const ctx = await harness();
    try {
      let releaseJournal = () => {};
      let signalJournal = () => {};
      const journalReached = new Promise<void>((resolve) => (signalJournal = resolve));
      const journalRelease = new Promise<void>((resolve) => (releaseJournal = resolve));
      ctx.inject({
        ...ctx.baseFileOps,
        async rename(from, to) {
          if (to.endsWith(REFLECTION_TRANSACTION_FILE)) {
            signalJournal();
            await journalRelease;
          }
          await ctx.baseFileOps.rename(from, to);
        },
      });
      const service = createReflectionStateService({
        storage: ctx.reflectionStorage,
        coordinator: ctx.coordinator,
        recoverBeforeUse: () => ctx.makeTransactions().recover(),
      });
      const mutation = ctx.notes.set(ctx.affected.id, {
        commandId: "30000000-0000-4000-8000-000000000006",
        expectedVersion: 1,
        text: "replacement note",
      });
      await journalReached;
      let readCompleted = false;
      const read = service.getDeletionGeneration().then((value) => {
        readCompleted = true;
        return value;
      });
      await Promise.resolve();
      expect(readCompleted).toBe(false);
      releaseJournal();
      const [result] = await Promise.race([
        Promise.all([mutation, read]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("deadlock")), 1_000)),
      ]);
      expect(result).toMatchObject({ ok: true });
      expect(readCompleted).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });

  test("an unrelated collection mutation serializes a Reflection read before affected-only purge", async () => {
    const ctx = await harness();
    try {
      const unrelatedCache = structuredClone(
        (await ctx.reflectionStorage.loadState()).questions[2].cache,
      );
      let releaseMutation = () => {};
      let signalMutation = () => {};
      const mutationReached = new Promise<void>((resolve) => (signalMutation = resolve));
      const mutationRelease = new Promise<void>((resolve) => (releaseMutation = resolve));
      const unrelatedMutation = ctx.mutationService.mutate(
        {
          operation: "test.unrelated-game-mutation",
          trigger: "test",
          gameIds: [ctx.unrelated.id],
        },
        async (collection) => {
          signalMutation();
          await mutationRelease;
          const game = collection.games.find(({ id }) => id === ctx.unrelated.id);
          if (game === undefined) throw new Error("Expected unrelated game");
          game.name = "Unrelated updated";
          return { changed: true, value: undefined };
        },
      );
      await mutationReached;

      const stateService = createReflectionStateService({
        storage: ctx.reflectionStorage,
        coordinator: ctx.coordinator,
        recoverBeforeUse: () => ctx.transactions.recover(),
      });
      let readCompleted = false;
      const read = stateService.getDeletionGeneration().then((generation) => {
        readCompleted = true;
        return generation;
      });
      await Promise.resolve();
      expect(readCompleted).toBe(false);
      releaseMutation();
      await Promise.race([
        Promise.all([unrelatedMutation, read]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("deadlock")), 1_000)),
      ]);
      expect(readCompleted).toBe(true);

      expect(
        await ctx.notes.set(ctx.affected.id, {
          commandId: "31000000-0000-4000-8000-000000000009",
          expectedVersion: 1,
          text: "replacement note",
        }),
      ).toMatchObject({ ok: true });
      const state = await ctx.reflectionStorage.loadState();
      expect(state.questions.map(({ cache }) => cache === null)).toEqual([true, true, false]);
      expect(state.questions[2].cache).toEqual(unrelatedCache);
    } finally {
      await ctx.cleanup();
    }
  });
});
