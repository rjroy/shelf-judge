import { describe, expect, test } from "bun:test";
import {
  ReflectionCompletedSchema,
  type ReflectionCompleted,
  type ReflectionDependency,
  type ReflectionQuestionId,
} from "@shelf-judge/shared";
import { createReflectionStateService } from "../../src/services/reflection-state-service.js";
import {
  REFLECTION_STATE_FILE,
  createReflectionStorage,
} from "../../src/services/reflection-storage.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";

const DATA_DIR = "/test/data";
const STATE_PATH = `${DATA_DIR}/${REFLECTION_STATE_FILE}`;
const TIME = "2026-08-31T12:00:00.000Z";
const GENERATIONS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
];

function completed(
  questionId: ReflectionQuestionId,
  fingerprint = `${questionId}-score-1`,
): ReflectionCompleted {
  return ReflectionCompletedSchema.parse({
    outcome: "abstained",
    reason: "no-material-synthesis",
    explanation: `No material synthesis for ${questionId}`,
    supportingBlocks: [{ text: "Captured limitation", citationIds: ["captured-score"] }],
    citations: [
      {
        citationId: "captured-score",
        sourceId: `${questionId}-score`,
        sourceVersion: "collection-2",
        evidenceClass: "current-scoring",
        testimony: false,
        canonicalSummary: `Captured score for ${questionId}`,
        destination: { operationId: "shelf.profile.get", parameters: {} },
      },
    ],
    scope: {
      examinedPresentNoteCount: 0,
      totalPresentNoteCount: 0,
      examinedGameCount: 0,
      relevantEligibleGameCount: 0,
      excludedGameCount: 0,
      exhaustiveNotes: true,
      ...(questionId === "pattern-exceptions" ? { patternCandidateIds: [] } : {}),
    },
    evidenceIdentity: {
      manifestVersion: 1,
      questionId,
      questionVersion: 1,
      collectionId: "collection",
      collectionSchemaVersion: 6,
      collectionRevision: 2,
      profileContractVersion: 9,
      profileAlgorithmVersion: 11,
      providerId: "provider",
      modelId: "model",
    },
    dependencies: [{ category: "scoring", sourceId: `${questionId}-score`, fingerprint }],
    generatedAt: TIME,
    usage: { state: "unavailable" },
  });
}

function completedWithNote(noteVersion: number): ReflectionCompleted {
  const result = completed("repeated-values");
  return ReflectionCompletedSchema.parse({
    ...result,
    supportingBlocks: [
      { text: "Captured limitation", citationIds: ["captured-score", "captured-note"] },
    ],
    citations: [
      ...result.citations,
      {
        citationId: "captured-note",
        sourceId: "game-1",
        sourceVersion: String(noteVersion),
        evidenceClass: "owner-game-note",
        testimony: true,
        canonicalSummary: "Captured owner testimony",
        destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
      },
    ],
    dependencies: [...result.dependencies, { category: "note", gameId: "game-1", noteVersion }],
  });
}

function completedWithGameDependencies(noteVersion: number): ReflectionCompleted {
  const result = completedWithNote(noteVersion);
  return ReflectionCompletedSchema.parse({
    ...result,
    dependencies: [
      ...result.dependencies,
      { category: "metadata", sourceId: "game:game-1:metadata", fingerprint: "game-present" },
    ],
  });
}

function current(overrides: Record<string, unknown> = {}) {
  const dependency = (questionId: ReflectionQuestionId): ReflectionDependency => ({
    category: "scoring",
    sourceId: `${questionId}-score`,
    fingerprint: `${questionId}-score-1`,
  });
  const dependenciesByQuestion: Record<ReflectionQuestionId, readonly ReflectionDependency[]> = {
    "repeated-values": [dependency("repeated-values")],
    "pattern-exceptions": [dependency("pattern-exceptions")],
    "recurring-trade-offs": [dependency("recurring-trade-offs")],
  };
  return {
    collectionId: "collection",
    collectionSchemaVersion: 6,
    collectionRevision: 2,
    profileContractVersion: 9,
    profileAlgorithmVersion: 11,
    providerId: "provider",
    modelId: "model",
    dependenciesByQuestion,
    ...overrides,
  };
}

function setup() {
  const fileOps = createMockFileOps();
  let generation = 0;
  const nextGeneration = () => GENERATIONS[generation++] ?? crypto.randomUUID();
  const storage = createReflectionStorage({
    dataDir: DATA_DIR,
    fileOps,
    createGeneration: nextGeneration,
    temporaryPathForAttempt: (filePath, attempt) => `${filePath}.${attempt}.tmp`,
    logger: { log() {}, warn() {}, error() {} },
  });
  const coordinator = profileSourceCoordinatorFor(storage);
  const createService = () =>
    createReflectionStateService({
      storage,
      now: () => TIME,
      createGeneration: nextGeneration,
      coordinator,
    });
  return { fileOps, storage, coordinator, createService };
}

async function publish(
  service: ReturnType<typeof createReflectionStateService>,
  questionId: ReflectionQuestionId,
  result = completed(questionId),
) {
  const fence = await service.startAttempt(questionId, `batch-${questionId}`);
  const sources = current();
  sources.dependenciesByQuestion[questionId] = result.dependencies;
  expect(await service.completeAttempt(fence, result, () => sources)).toBe(true);
}

describe("Reflection state service", () => {
  test("covers cache and attempt transitions while replacing only the selected question", async () => {
    const { createService } = setup();
    const service = createService();
    expect(
      (await service.read(current())).map(({ cache, attempt }) => [cache.state, attempt.state]),
    ).toEqual([
      ["none", "idle"],
      ["none", "idle"],
      ["none", "idle"],
    ]);

    const firstFence = await service.startAttempt("repeated-values", "batch-1");
    expect((await service.read(current()))[0].attempt.state).toBe("refreshing");
    expect(
      await service.completeAttempt(firstFence, completed("repeated-values"), () => current()),
    ).toBe(true);
    await publish(service, "pattern-exceptions");

    let questions = await service.read(current());
    expect(questions.map(({ cache }) => cache.state)).toEqual(["current", "current", "none"]);
    const cancelledFence = await service.startAttempt("repeated-values", "batch-cancelled");
    expect(await service.cancelAttempt(cancelledFence)).toBe(true);
    questions = await service.read(current());
    expect(questions[0].cache.state).toBe("current");
    expect(questions[0].attempt.state).toBe("cancelled");
    expect(questions[1].cache.state).toBe("current");

    const failedFence = await service.startAttempt("repeated-values", "batch-failed");
    expect(await service.failAttempt(failedFence, "provider-outage", "retry-later")).toBe(true);
    questions = await service.read(current());
    expect(questions[0].cache.state).toBe("current");
    expect(questions[0].attempt).toEqual({
      state: "unavailable",
      reason: "provider-outage",
      safeDetail: "retry-later",
      occurredAt: TIME,
    });

    await service.purge(["repeated-values"], "owner-deleted");
    questions = await service.read(current());
    expect(questions[0].cache.state).toBe("none");
    expect(questions[0].attempt.state).toBe("purged");
    expect(questions[1].cache.state).toBe("current");
  });

  test("derives ordered staleness categories on read and retains captured citations", async () => {
    const { createService } = setup();
    const service = createService();
    await publish(service, "repeated-values");

    const [question] = await service.read(
      current({
        collectionRevision: 3,
        profileAlgorithmVersion: 12,
        providerId: "new-provider",
        manifestVersion: 2,
        dependenciesByQuestion: {
          ...current().dependenciesByQuestion,
          "repeated-values": [
            { category: "scoring", sourceId: "repeated-values-score", fingerprint: "changed" },
            { category: "metadata", sourceId: "new-source", fingerprint: "new" },
          ],
        },
      }),
    );
    expect(question.cache.state).toBe("stale");
    if (question.cache.state !== "stale") throw new Error("Expected stale cache");
    expect(question.cache.changedCategories).toEqual([
      "scoring",
      "metadata",
      "profile",
      "question-policy",
      "provider-configuration",
      "collection",
    ]);
    expect(question.cache.result.citations[0].canonicalSummary).toBe(
      "Captured score for repeated-values",
    );

    const reread = await service.read(current());
    expect(reread[0].cache.state).toBe("current");
  });

  test("reconciles an interrupted active attempt after restart and preserves its prior cache", async () => {
    const { createService } = setup();
    const firstProcess = createService();
    await publish(firstProcess, "repeated-values");
    await firstProcess.startAttempt("repeated-values", "interrupted-batch");

    const restarted = createService();
    const [question] = await restarted.read(current());
    expect(question.cache.state).toBe("current");
    expect(question.attempt).toEqual({
      state: "unavailable",
      reason: "internal",
      safeDetail: "daemon-restarted",
      occurredAt: TIME,
    });
  });

  test("rejects late completion and terminal updates from an older attempt", async () => {
    const { createService } = setup();
    const service = createService();
    const oldFence = await service.startAttempt("repeated-values", "old-batch");
    expect(await service.cancelAttempt(oldFence)).toBe(true);
    const currentFence = await service.startAttempt("repeated-values", "old-batch");

    expect(
      await service.completeAttempt(oldFence, completed("repeated-values"), () => current()),
    ).toBe(false);
    expect(await service.failAttempt(oldFence, "internal")).toBe(false);
    expect(
      await service.completeAttempt(currentFence, completed("repeated-values"), () => current()),
    ).toBe(true);
    expect((await service.read(current()))[0].cache.state).toBe("current");
  });

  test("rejects final cache publication when a currently available source fence changed", async () => {
    const { createService } = setup();
    const service = createService();
    const fence = await service.startAttempt("repeated-values", "stale-source-batch");
    expect(
      await service.completeAttempt(fence, completed("repeated-values"), () =>
        current({ collectionRevision: 3 }),
      ),
    ).toBe(false);
    expect((await service.read(current()))[0].cache.state).toBe("none");
  });

  test("rejects final publication for every current-source mismatch", async () => {
    const { createService } = setup();
    const service = createService();
    const result = completedWithGameDependencies(1);
    const sources = current();
    sources.dependenciesByQuestion["repeated-values"] = result.dependencies;
    const fence = await service.startAttempt("repeated-values", "source-fence-batch");
    const mismatches = [
      { name: "collection revision", apply: () => ({ ...sources, collectionRevision: 3 }) },
      {
        name: "note version",
        apply: () => ({
          ...sources,
          dependenciesByQuestion: {
            ...sources.dependenciesByQuestion,
            "repeated-values": result.dependencies.map((dependency) =>
              dependency.category === "note" ? { ...dependency, noteVersion: 2 } : dependency,
            ),
          },
        }),
      },
      {
        name: "game existence",
        apply: () => ({
          ...sources,
          dependenciesByQuestion: {
            ...sources.dependenciesByQuestion,
            "repeated-values": result.dependencies.filter(
              (dependency) =>
                dependency.category !== "note" &&
                !(
                  dependency.category === "metadata" &&
                  dependency.sourceId.startsWith("game:game-1:")
                ),
            ),
          },
        }),
      },
      { name: "provider", apply: () => ({ ...sources, providerId: "replacement-provider" }) },
      { name: "model", apply: () => ({ ...sources, modelId: "replacement-model" }) },
    ];

    for (const mismatch of mismatches) {
      expect(
        await service.completeAttempt(fence, result, () => mismatch.apply()),
        mismatch.name,
      ).toBe(false);
    }
    expect((await service.read(sources))[0].cache.state).toBe("none");
  });

  test("rejects final publication after enabled, generation, and attempt fences change", async () => {
    const disabledSetup = setup();
    const disabledService = disabledSetup.createService();
    const disabledFence = await disabledService.startAttempt("repeated-values", "disabled-batch");
    await disabledService.setEnabled("repeated-values", false);
    expect(
      await disabledService.completeAttempt(disabledFence, completed("repeated-values"), () =>
        current(),
      ),
    ).toBe(false);

    const generationSetup = setup();
    const generationService = generationSetup.createService();
    const generationFence = await generationService.startAttempt(
      "repeated-values",
      "generation-batch",
    );
    await generationService.purge(["pattern-exceptions"], "owner-deleted");
    expect(
      await generationService.completeAttempt(generationFence, completed("repeated-values"), () =>
        current(),
      ),
    ).toBe(false);

    const attemptSetup = setup();
    const attemptService = attemptSetup.createService();
    const oldFence = await attemptService.startAttempt("repeated-values", "attempt-batch");
    await attemptService.cancelAttempt(oldFence);
    await attemptService.startAttempt("repeated-values", "attempt-batch");
    expect(
      await attemptService.completeAttempt(oldFence, completed("repeated-values"), () => current()),
    ).toBe(false);
  });

  test("loads final current sources and publishes while holding the collection coordinator", async () => {
    const { coordinator, createService } = setup();
    const service = createService();
    const fence = await service.startAttempt("repeated-values", "coordinated-publication");
    let releaseSourceLoad = () => {};
    let signalSourceLoad = () => {};
    const sourceLoadReached = new Promise<void>((resolve) => (signalSourceLoad = resolve));
    const sourceLoadRelease = new Promise<void>((resolve) => (releaseSourceLoad = resolve));
    let unrelatedMutationCompleted = false;

    const publication = service.completeAttempt(fence, completed("repeated-values"), async () => {
      signalSourceLoad();
      await sourceLoadRelease;
      return current();
    });
    await sourceLoadReached;
    const unrelatedMutation = coordinator.runExclusive(() => {
      unrelatedMutationCompleted = true;
      return Promise.resolve();
    });
    await Promise.resolve();
    expect(unrelatedMutationCompleted).toBe(false);

    releaseSourceLoad();
    expect(await publication).toBe(true);
    await unrelatedMutation;
    expect(unrelatedMutationCompleted).toBe(true);
    expect((await service.read(current()))[0].cache.state).toBe("current");
  });

  test("clears output before publishing settings changes so interrupted writes cannot restore it", async () => {
    const { storage, createService } = setup();
    const initial = createService();
    await publish(initial, "repeated-values");
    let failSettingsWrite = true;
    const interruptedStorage = {
      ...storage,
      saveSettings: async (...args: Parameters<typeof storage.saveSettings>) => {
        if (failSettingsWrite) throw new Error("injected settings interruption");
        await storage.saveSettings(...args);
      },
    };
    const interrupted = createReflectionStateService({
      storage: interruptedStorage,
      now: () => TIME,
      createGeneration: () => GENERATIONS[3],
      coordinator: profileSourceCoordinatorFor(interruptedStorage),
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
    await expect(interrupted.setEnabled("repeated-values", false)).rejects.toThrow(
      "injected settings interruption",
    );
    expect((await interrupted.read(current()))[0]).toMatchObject({
      enabled: true,
      cache: { state: "none" },
    });

    failSettingsWrite = false;
    await interrupted.setEnabled("repeated-values", false);
    await interrupted.setEnabled("repeated-values", true);
    expect((await interrupted.read(current()))[0]).toMatchObject({
      enabled: true,
      cache: { state: "none" },
      attempt: { state: "idle" },
    });
  });

  test("purges note-bearing output instead of exposing changed testimony as stale", async () => {
    const { createService } = setup();
    const service = createService();
    await publish(service, "repeated-values", completedWithNote(1));
    const generation = await service.getDeletionGeneration();
    const sources = current();
    sources.dependenciesByQuestion["repeated-values"] = [
      ...sources.dependenciesByQuestion["repeated-values"],
      { category: "note", gameId: "game-1", noteVersion: 2 },
    ];

    const [question] = await service.read(sources);
    expect(question.cache.state).toBe("none");
    expect(question.attempt).toMatchObject({ state: "purged", reason: "note-changed" });
    expect(await service.getDeletionGeneration()).not.toBe(generation);
  });

  test("disable preserves other questions and fences a late completion from the prior generation", async () => {
    const { createService } = setup();
    const service = createService();
    await publish(service, "pattern-exceptions");
    const lateFence = await service.startAttempt("repeated-values", "late-batch");
    const priorGeneration = lateFence.deletionGeneration;

    await service.setEnabled("repeated-values", false);
    expect(
      await service.completeAttempt(lateFence, completed("repeated-values"), () => current()),
    ).toBe(false);
    expect(await service.getDeletionGeneration()).not.toBe(priorGeneration);
    let questions = await service.read(current());
    expect(questions[0]).toMatchObject({
      enabled: false,
      cache: { state: "none" },
      attempt: { state: "idle" },
    });
    expect(questions[1].cache.state).toBe("current");

    await service.setEnabled("repeated-values", true);
    questions = await service.read(current());
    expect(questions[0]).toMatchObject({
      enabled: true,
      cache: { state: "none" },
      attempt: { state: "idle" },
    });
  });

  test("recovers corrupt state under a new generation while valid settings survive", async () => {
    const { fileOps, storage, createService } = setup();
    const service = createService();
    await service.setEnabled("pattern-exceptions", false);
    const oldGeneration = await service.getDeletionGeneration();
    fileOps.files.set(STATE_PATH, "corrupt note-bearing state");

    const restarted = createReflectionStateService({
      storage,
      now: () => TIME,
      createGeneration: () => GENERATIONS[3],
      coordinator: profileSourceCoordinatorFor(storage),
    });
    const settings = await restarted.getSettings();
    expect(settings.questions[1].enabled).toBe(false);
    expect(await restarted.getDeletionGeneration()).not.toBe(oldGeneration);
    expect([...fileOps.files.keys()].some((file) => file.includes("quarantine"))).toBe(false);
  });
});
