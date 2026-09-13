import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REFLECTION_SETTINGS,
  REFLECTION_QUESTION_IDS,
  ReflectionCompletedSchema,
  ReflectionEvidenceIdentitySchema,
  ReflectionSettingsSchema,
  ReflectionScopeSchema,
  ReflectionStreamEventHistorySchema,
  type GroundedProviderConfigurationStatus,
  type ReflectionCompleted,
  type ReflectionQuestionId,
  type ReflectionStreamEvent,
} from "@shelf-judge/shared";
import type {
  GroundedAnalysisProvider,
  GroundedAnalysisRequest,
  GroundedAnalysisResult,
} from "../../src/services/grounded-analysis/provider.js";
import type {
  ReflectionEvidencePackage,
  ReflectionEvidenceTurn,
} from "../../src/services/reflection-evidence-service.js";
import {
  createReflectionRefreshService,
  ReflectionRefreshAdmissionError,
} from "../../src/services/reflection-refresh-service.js";
import { GroundedStructuredSubmissionValidationError } from "../../src/services/grounded-analysis/structured-submission.js";
import {
  ReflectionCompensationPersistenceError,
  type ReflectionStateService,
} from "../../src/services/reflection-state-service.js";

const NOW = "2026-09-01T12:00:00.000Z";
const CAPABILITY = "a".repeat(64);
const identity = { providerId: "provider-1", modelId: "model-1", extensionIds: [] as string[] };

function packageFor(questionId: ReflectionQuestionId): ReflectionEvidencePackage {
  const evidence = Object.freeze({
    manifestId: "profile-reflection",
    manifestVersion: "2",
    evidenceClasses: Object.freeze([]),
    examinedSources: Object.freeze([]),
    entries: Object.freeze([]),
    hasSource: () => false,
    resolve: () => undefined,
  });
  return Object.freeze({
    evidenceIdentity: ReflectionEvidenceIdentitySchema.parse({
      manifestVersion: 2,
      questionId,
      questionVersion: 1,
      collectionId: "collection-1",
      collectionSchemaVersion: 6,
      collectionRevision: 4,
      profileContractVersion: 1,
      profileAlgorithmVersion: 1,
      providerId: identity.providerId,
      modelId: identity.modelId,
    }),
    snapshotFingerprint: "snapshot-1",
    scope: ReflectionScopeSchema.parse({
      examinedPresentNoteCount: 0,
      totalPresentNoteCount: 0,
      examinedGameCount: 0,
      relevantEligibleGameCount: 0,
      excludedGameCount: 0,
      exhaustiveNotes: true,
      ...(questionId === "pattern-exceptions" ? { patternCandidateIds: [] } : {}),
    }),
    evidence,
    citations: Object.freeze([]),
    dependencies: Object.freeze([]),
    assembledAt: NOW,
  });
}

function request(
  batchId = "batch-1",
  requestId = "request-1",
): {
  batchId: string;
  requestId: string;
  cancellationCapability: string;
  questionId?: ReflectionQuestionId;
  disclosure: {
    version: number;
    providerId: string;
    modelId: string;
    acknowledged: boolean;
  };
} {
  return {
    batchId,
    requestId,
    cancellationCapability: CAPABILITY,
    disclosure: {
      version: 1,
      providerId: identity.providerId,
      modelId: identity.modelId,
      acknowledged: true,
    },
  };
}

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve?.() };
}

function publication(
  fence: Parameters<ReflectionStateService["completeAttempt"]>[0],
  replacementCache: Parameters<ReflectionStateService["completeAttempt"]>[1],
) {
  return { fence, priorCache: null, replacementCache };
}

function harness(options?: {
  analyze?: (request: GroundedAnalysisRequest<unknown>) => Promise<GroundedAnalysisResult<unknown>>;
  onAssemble?: (questionId: ReflectionQuestionId) => void;
  configuration?: () => GroundedProviderConfigurationStatus;
  validationError?: Error;
}) {
  const events: ReflectionStreamEvent[] = [];
  const analyzed: ReflectionQuestionId[] = [];
  const logs: unknown[] = [];
  const started: ReflectionQuestionId[] = [];
  const failed: Array<{ questionId: ReflectionQuestionId; reason: string }> = [];
  let attempt = 0;
  const runAnalysis =
    options?.analyze ??
    ((analysisRequest: GroundedAnalysisRequest<unknown>) => {
      const payload = JSON.parse(analysisRequest.prompt) as {
        evidenceIdentity: { questionId: ReflectionQuestionId };
      };
      analyzed.push(payload.evidenceIdentity.questionId);
      return Promise.resolve({
        output: {
          result: {
            outcome: "abstained",
            reason: "no-owner-testimony",
            explanation: "No current testimony.",
            supportingBlocks: [],
            noteExcerpts: [],
          },
        },
        usage: { state: "reported", inferenceRoundTrips: 1 },
      });
    });
  const provider: GroundedAnalysisProvider = {
    get configurationStatus() {
      return options?.configuration?.() ?? { status: "configured", identity };
    },
    analyze<Output>(analysisRequest: GroundedAnalysisRequest<Output>) {
      return runAnalysis(analysisRequest).then(async (result) => {
        const typed = result as GroundedAnalysisResult<Output>;
        await analysisRequest.acceptSubmission?.(typed.output, typed.usage);
        return typed;
      });
    },
  };
  const state: ReflectionStateService = {
    getSettings: () =>
      Promise.resolve(ReflectionSettingsSchema.parse(structuredClone(DEFAULT_REFLECTION_SETTINGS))),
    getDeletionGeneration: () => Promise.resolve("generation-1"),
    read: () => Promise.reject(new Error("not used")),
    readSnapshot: () => Promise.reject(new Error("not used")),
    setEnabled: () => Promise.reject(new Error("not used")),
    startAttempt(questionId, batchId) {
      started.push(questionId);
      attempt += 1;
      return Promise.resolve({
        questionId,
        batchId,
        attemptId: `attempt-${attempt}`,
        deletionGeneration: "generation-1",
      });
    },
    completeAttempt: (fence, result) => Promise.resolve(publication(fence, result)),
    compensateAttempt: () => Promise.resolve({ outcome: "restored", cacheTransition: "none" }),
    cancelAttempt: () => Promise.resolve(true),
    failAttempt(fence, reason) {
      failed.push({ questionId: fence.questionId, reason });
      return Promise.resolve(true);
    },
    purge: () => Promise.reject(new Error("not used")),
  };
  const service = createReflectionRefreshService({
    provider,
    evidence: {
      assemble(questionId) {
        options?.onAssemble?.(questionId);
        return Promise.resolve(packageFor(questionId));
      },
      start(questionId) {
        options?.onAssemble?.(questionId);
        // This service double never executes provider tools. Tool execution is
        // covered by the real-session integration tests.
        return Promise.resolve({ initial: packageFor(questionId) } as ReflectionEvidenceTurn);
      },
      finish(turn) {
        return Promise.resolve(turn.initial);
      },
      revalidate: () => Promise.resolve({ valid: true }),
    },
    state,
    validator: {
      validate({ questionId, evidencePackage, usage, generatedAt }) {
        if (options?.validationError !== undefined) throw options.validationError;
        return ReflectionCompletedSchema.parse({
          outcome: "abstained",
          reason:
            questionId === "pattern-exceptions" ? "no-supported-pattern" : "no-owner-testimony",
          explanation: "No bounded answer is available.",
          supportingBlocks: [],
          citations: [],
          scope: evidencePackage.scope,
          evidenceIdentity: evidencePackage.evidenceIdentity,
          dependencies: evidencePackage.dependencies,
          generatedAt,
          usage,
        });
      },
    },
    now: () => NOW,
    logger: { log: (record) => logs.push(record) },
  });
  return { service, provider, state, events, analyzed, started, failed, logs };
}

async function expectAdmission(
  promise: Promise<unknown>,
  expected: Partial<ReflectionRefreshAdmissionError>,
): Promise<void> {
  let rejection: unknown;
  try {
    await promise;
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeInstanceOf(ReflectionRefreshAdmissionError);
  expect(rejection).toMatchObject(expected);
}

function runInput(
  events: ReflectionStreamEvent[],
  requestValue = request(),
  operationId = "operation-1",
) {
  return {
    operationId,
    request: requestValue,
    authorizeQuestions() {},
    emit(event: ReflectionStreamEvent) {
      events.push(event);
    },
  };
}

describe("ReflectionRefreshService", () => {
  test("runs every enabled question sequentially in fixed order with one operation each", async () => {
    const state = harness();
    let authorizedQuestionIds: readonly ReflectionQuestionId[] = [];
    expect(
      await state.service.run({
        ...runInput(state.events),
        authorizeQuestions(questionIds) {
          authorizedQuestionIds = [...questionIds];
        },
      }),
    ).toBe("completed");

    expect(authorizedQuestionIds).toEqual([...REFLECTION_QUESTION_IDS]);
    expect(state.started).toEqual([...REFLECTION_QUESTION_IDS]);
    expect(state.analyzed).toEqual([...REFLECTION_QUESTION_IDS]);
    expect(
      state.events.flatMap((event) =>
        event.type === "question-started" ? [event.questionId] : [],
      ),
    ).toEqual([...REFLECTION_QUESTION_IDS]);
    expect(ReflectionStreamEventHistorySchema.safeParse(state.events).success).toBe(true);
    expect(state.logs).toHaveLength(19);
    expect(JSON.stringify(state.logs)).not.toContain(CAPABILITY);
    expect(state.logs).toContainEqual(
      expect.objectContaining({
        recordType: "reflection-refresh-attempt",
        questionId: "repeated-values",
        modelOperationLimit: 1,
      }),
    );
  });

  test("refreshes one selected question and rejects disclosure mismatch before evidence", async () => {
    let assemblies = 0;
    const state = harness({ onAssemble: () => (assemblies += 1) });
    expect(
      await state.service.run(
        runInput(state.events, { ...request(), questionId: "recurring-trade-offs" }),
      ),
    ).toBe("completed");
    expect(state.analyzed).toEqual(["recurring-trade-offs"]);

    const mismatch = harness({ onAssemble: () => (assemblies += 1) });
    await expectAdmission(
      mismatch.service.run(
        runInput(mismatch.events, {
          ...request("batch-2", "request-2"),
          disclosure: {
            version: 1,
            providerId: "other-provider",
            modelId: identity.modelId,
            acknowledged: true,
          },
        }),
      ),
      { reason: "model-configuration" },
    );
    expect(assemblies).toBe(1);
  });

  test("rejects concurrent batches, duplicate batches, and request reuse without model work", async () => {
    const gate = deferred();
    const entered = deferred();
    let modelCalls = 0;
    const state = harness({
      analyze: async (analysisRequest) => {
        modelCalls += 1;
        entered.resolve();
        await gate.promise;
        analysisRequest.signal.throwIfAborted();
        return {
          output: {
            result: {
              outcome: "abstained",
              reason: "no-owner-testimony",
              explanation: "No testimony.",
              supportingBlocks: [],
              noteExcerpts: [],
            },
          },
          usage: { state: "unavailable" },
        };
      },
    });
    const first = state.service.run(runInput(state.events));
    await entered.promise;
    await expectAdmission(
      state.service.run(runInput([], request("batch-2", "request-2"), "operation-2")),
      { reason: "busy", activeBatchId: "batch-1" },
    );
    expect(modelCalls).toBe(1);
    gate.resolve();
    expect(await first).toBe("completed");

    await expectAdmission(state.service.run(runInput([], request(), "operation-3")), {
      reason: "duplicate-batch",
    });
    await expectAdmission(
      state.service.run(runInput([], request("batch-3", "request-1"), "operation-4")),
      { reason: "request-reuse" },
    );
    await expectAdmission(
      state.service.run(runInput([], request("batch-1", "request-3"), "operation-5")),
      { reason: "request-reuse" },
    );
    expect(modelCalls).toBe(3);
  });

  test("requires the exact cancellation capability and stops later questions", async () => {
    const entered = deferred();
    const state = harness({
      analyze: (analysisRequest) =>
        new Promise((_resolve, reject) => {
          entered.resolve();
          analysisRequest.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Operation aborted", "AbortError")),
            { once: true },
          );
        }),
    });
    const running = state.service.run(runInput(state.events));
    await entered.promise;
    expect(state.service.cancel("batch-1", "b".repeat(64))).toBe(false);
    expect(state.started).toEqual(["repeated-values"]);
    expect(state.service.cancel("batch-1", CAPABILITY)).toBe(true);
    expect(await running).toBe("cancelled");
    expect(state.started).toEqual(["repeated-values"]);
    expect(state.events.at(-1)?.type).toBe("cancelled");
    expect(ReflectionStreamEventHistorySchema.safeParse(state.events).success).toBe(true);
  });

  test("detects a provider identity race before transmission and preserves the attempt", async () => {
    let changed = false;
    let modelCalls = 0;
    const state = harness({
      configuration: () => ({
        status: "configured",
        identity: changed ? { ...identity, modelId: "model-2" } : identity,
      }),
      onAssemble: () => {
        changed = true;
      },
      analyze: () => {
        modelCalls += 1;
        return Promise.reject(new Error("must not run"));
      },
    });
    expect(await state.service.run(runInput(state.events))).toBe("failed");
    expect(modelCalls).toBe(0);
    expect(state.failed).toEqual([
      { questionId: "repeated-values", reason: "model-configuration" },
    ]);
    expect(state.events.at(-1)).toMatchObject({
      type: "failed",
      reason: "model-configuration",
    });
  });

  test("linearizes final publication before accepting a late cancellation", async () => {
    const entered = deferred();
    const release = deferred();
    const state = harness();
    state.state.completeAttempt = async (fence, result) => {
      entered.resolve();
      await release.promise;
      return publication(fence, result);
    };
    const running = state.service.run(
      runInput(state.events, { ...request(), questionId: "repeated-values" }),
    );
    await entered.promise;
    expect(state.service.cancel("batch-1", CAPABILITY)).toBe(false);
    expect(state.events.at(-1)?.type).not.toBe("question-completed");
    release.resolve();
    expect(await running).toBe("completed");
    expect(state.events.at(-1)?.type).toBe("question-completed");
    expect(state.service.cancel("batch-1", CAPABILITY)).toBe(false);
  });

  test("keeps a committed non-final publication when cancellation arrives after commit begins", async () => {
    const entered = deferred();
    const release = deferred();
    const state = harness();
    let completions = 0;
    let cache: ReflectionCompleted | null = null;
    let attemptState = "refreshing";
    state.state.completeAttempt = async (fence, result) => {
      completions += 1;
      if (completions === 1) {
        cache = result;
        attemptState = "idle";
        entered.resolve();
        await release.promise;
        return { fence, priorCache: null, replacementCache: result };
      }
      return publication(fence, result);
    };
    const running = state.service.run(runInput(state.events));
    await entered.promise;
    expect(state.service.cancel("batch-1", CAPABILITY)).toBe(false);
    release.resolve();
    expect(await running).toBe("completed");
    expect(completions).toBe(3);
    expect(state.analyzed).toEqual([...REFLECTION_QUESTION_IDS]);
    expect(cache).not.toBeNull();
    expect(attemptState).toBe("idle");
    expect(state.events.at(-1)?.type).toBe("question-completed");
    expect(ReflectionStreamEventHistorySchema.safeParse(state.events).success).toBe(true);
  });

  test("keeps an admitted job alive when its stream observer disconnects", async () => {
    const entered = deferred();
    const release = deferred();
    const state = harness();
    let cache: ReflectionCompleted | null = null;
    let attemptState: unknown = "refreshing";
    let completions = 0;
    state.state.completeAttempt = async (fence, result) => {
      completions += 1;
      cache = result;
      attemptState = "idle";
      entered.resolve();
      await release.promise;
      return { fence, priorCache: null, replacementCache: result };
    };
    const running = state.service.run({
      ...runInput(state.events, { ...request(), questionId: "repeated-values" }),
      emit(event) {
        if (event.type === "model-status" && event.status === "started")
          throw new Error("stream observer closed");
        state.events.push(event);
      },
    });
    await entered.promise;

    release.resolve();

    expect(await running).toBe("completed");
    expect(cache).not.toBeNull();
    expect(attemptState).toBe("idle");
    expect(completions).toBe(1);
    expect(state.analyzed).toEqual(["repeated-values"]);
    expect(state.failed).toEqual([]);
    expect(state.events.some((event) => event.type === "cache-outcome")).toBe(false);
  });

  test("keeps a committed result when cancellation arrives during publication", async () => {
    for (const hasPriorCache of [true, false]) {
      const entered = deferred();
      const release = deferred();
      const state = harness();
      let durableCache: ReflectionCompleted | null = null;
      let replacement: ReflectionCompleted | undefined;
      state.state.completeAttempt = async (fence, result) => {
        const priorCache = hasPriorCache
          ? ReflectionCompletedSchema.parse({ ...result, explanation: "Prior cache sentinel." })
          : null;
        replacement = result;
        durableCache = result;
        entered.resolve();
        await release.promise;
        return { fence, priorCache, replacementCache: result };
      };
      state.state.compensateAttempt = () =>
        Promise.reject(
          new ReflectionCompensationPersistenceError({
            outcome: "superseded",
            cacheTransition: "written",
          }),
        );
      const running = state.service.run({
        ...runInput(state.events),
      });
      await entered.promise;
      expect(state.service.cancel("batch-1", CAPABILITY)).toBe(false);
      release.resolve();

      expect(await running).toBe("completed");
      expect(JSON.stringify(durableCache)).toBe(JSON.stringify(replacement));
      expect(state.analyzed).toEqual([...REFLECTION_QUESTION_IDS]);
      expect(state.failed).toEqual([]);
      expect(state.events.some((event) => event.type === "cache-outcome")).toBe(true);
      expect(state.events.at(-1)).toMatchObject({ type: "question-completed" });
      expect(JSON.stringify(state.logs)).not.toContain("Prior cache sentinel");
    }
  });

  test("does not restore a prior cache after cancellation loses the publication reservation", async () => {
    {
      const entered = deferred();
      const release = deferred();
      const state = harness();
      let durableCache: ReflectionCompleted | null = null;
      let priorCache: ReflectionCompleted | null = null;
      state.state.completeAttempt = async (fence, result) => {
        priorCache = ReflectionCompletedSchema.parse({
          ...result,
          explanation: "Durably restored prior sentinel.",
        });
        durableCache = result;
        entered.resolve();
        await release.promise;
        return { fence, priorCache, replacementCache: result };
      };
      state.state.compensateAttempt = () => {
        durableCache = priorCache;
        return Promise.resolve({ outcome: "restored", cacheTransition: "none" });
      };
      const running = state.service.run({
        ...runInput(state.events),
      });
      await entered.promise;
      expect(state.service.cancel("batch-1", CAPABILITY)).toBe(false);
      release.resolve();

      expect(await running).toBe("completed");
      expect(durableCache).not.toEqual(priorCache);
      expect(state.analyzed).toEqual([...REFLECTION_QUESTION_IDS]);
      expect(state.events.at(-1)).toMatchObject({ type: "question-completed" });
    }
  });

  test("does not run destructive compensation after a committed publication", async () => {
    {
      const entered = deferred();
      const release = deferred();
      const state = harness();
      let durableCache: ReflectionCompleted | null = null;
      state.state.completeAttempt = async (fence, result) => {
        const priorCache = ReflectionCompletedSchema.parse({
          ...result,
          explanation: "Purged prior sentinel.",
        });
        durableCache = result;
        entered.resolve();
        await release.promise;
        return { fence, priorCache, replacementCache: result };
      };
      state.state.compensateAttempt = () => {
        durableCache = null;
        return Promise.resolve({ outcome: "superseded", cacheTransition: "invalidated" });
      };
      const running = state.service.run({
        ...runInput(state.events),
      });
      await entered.promise;
      expect(state.service.cancel("batch-1", CAPABILITY)).toBe(false);
      release.resolve();

      expect(await running).toBe("completed");
      expect(durableCache).not.toBeNull();
      expect(state.analyzed).toEqual([...REFLECTION_QUESTION_IDS]);
      expect(JSON.stringify(state.logs)).not.toContain("Purged prior sentinel");
    }
  });

  test("does not latch a guessed capability during non-final publication", async () => {
    const entered = deferred();
    const release = deferred();
    const state = harness();
    let completions = 0;
    state.state.completeAttempt = async (fence, result) => {
      completions += 1;
      if (completions === 1) {
        entered.resolve();
        await release.promise;
      }
      return publication(fence, result);
    };
    const running = state.service.run(runInput(state.events));
    await entered.promise;
    expect(state.service.cancel("batch-1", "b".repeat(64))).toBe(false);
    expect(state.service.cancel("other-batch", CAPABILITY)).toBe(false);
    release.resolve();
    expect(await running).toBe("completed");
    expect(completions).toBe(3);
    expect(state.analyzed).toEqual([...REFLECTION_QUESTION_IDS]);
  });

  test("delete-all during non-final publication fences late cache restoration", async () => {
    const entered = deferred();
    const release = deferred();
    const state = harness();
    let deletionGeneration = "generation-1";
    let cachePresent = true;
    const settingsBefore = await state.state.getSettings();
    const providerBefore = state.provider.configurationStatus;
    state.state.completeAttempt = async (fence, result) => {
      cachePresent = true;
      entered.resolve();
      await release.promise;
      return publication(fence, result);
    };
    state.state.compensateAttempt = (receipt) => {
      if (receipt.fence.deletionGeneration !== deletionGeneration) {
        return Promise.resolve({ outcome: "superseded", cacheTransition: "invalidated" });
      }
      cachePresent = receipt.priorCache !== null;
      return Promise.resolve({ outcome: "restored", cacheTransition: "none" });
    };
    state.state.purge = () => {
      deletionGeneration = "generation-2";
      cachePresent = false;
      return Promise.resolve(deletionGeneration);
    };

    const running = state.service.run(runInput(state.events));
    await entered.promise;
    expect(state.service.cancelActive()).toBe(false);
    await state.state.purge(REFLECTION_QUESTION_IDS, "owner-deleted");
    release.resolve();

    expect(await running).toBe("completed");
    expect(cachePresent).toBe(true);
    expect(await state.state.getSettings()).toEqual(settingsBefore);
    expect(state.provider.configurationStatus).toEqual(providerBefore);
    expect(state.analyzed).toEqual([...REFLECTION_QUESTION_IDS]);
    expect(state.events.at(-1)?.type).toBe("question-completed");
  });

  test("disabling the active question during publication cannot erase a committed result", async () => {
    const entered = deferred();
    const release = deferred();
    const state = harness();
    let deletionGeneration = "generation-1";
    let cachePresent = true;
    const settings = ReflectionSettingsSchema.parse(structuredClone(DEFAULT_REFLECTION_SETTINGS));
    state.state.getSettings = () => Promise.resolve(structuredClone(settings));
    state.state.completeAttempt = async (fence, result) => {
      cachePresent = true;
      entered.resolve();
      await release.promise;
      return publication(fence, result);
    };
    state.state.compensateAttempt = (receipt) => {
      const enabled = settings.questions.find(
        ({ questionId }) => questionId === receipt.fence.questionId,
      )?.enabled;
      if (receipt.fence.deletionGeneration !== deletionGeneration || !enabled) {
        return Promise.resolve({ outcome: "superseded", cacheTransition: "invalidated" });
      }
      cachePresent = receipt.priorCache !== null;
      return Promise.resolve({ outcome: "restored", cacheTransition: "none" });
    };
    state.state.setEnabled = (questionId, enabled) => {
      const question = settings.questions.find((candidate) => candidate.questionId === questionId);
      if (question === undefined) throw new Error("Unknown Reflection test question");
      question.enabled = enabled;
      if (!enabled) {
        deletionGeneration = "generation-2";
        cachePresent = false;
      }
      return Promise.resolve();
    };

    const running = state.service.run(runInput(state.events));
    await entered.promise;
    expect(state.service.cancelActive()).toBe(false);
    await state.state.setEnabled("repeated-values", false);
    release.resolve();

    expect(await running).toBe("completed");
    expect(cachePresent).toBe(true);
    expect(settings.questions.map(({ enabled }) => enabled)).toEqual([false, true, true]);
    expect(state.analyzed).toEqual([...REFLECTION_QUESTION_IDS]);
    expect(state.events.at(-1)?.type).toBe("question-completed");
  });

  test("maps cache write failure to persistence even if attempt recording also fails", async () => {
    const state = harness();
    state.state.completeAttempt = () => Promise.reject(new Error("disk unavailable"));
    state.state.failAttempt = () => Promise.reject(new Error("disk still unavailable"));
    expect(
      await state.service.run(
        runInput(state.events, { ...request(), questionId: "repeated-values" }),
      ),
    ).toBe("failed");
    expect(state.events.at(-1)).toMatchObject({ type: "failed", reason: "persistence" });
  });

  test("maps validator rejections to output-validation with a safe semantic diagnostic", async () => {
    const state = harness({
      validationError: new GroundedStructuredSubmissionValidationError([
        { code: "custom", message: "unknown citation", path: ["result", "citationIds"] },
      ]),
    });
    expect(
      await state.service.run(
        runInput(state.events, { ...request(), questionId: "repeated-values" }),
      ),
    ).toBe("failed");
    expect(state.failed).toEqual([{ questionId: "repeated-values", reason: "output-validation" }]);
    expect(state.events.at(-1)).toMatchObject({
      type: "failed",
      reason: "output-validation",
      safeDetail: "invalid-reflection-output",
    });
    expect(state.logs).toContainEqual(
      expect.objectContaining({
        recordType: "reflection-validation-boundary",
        outcome: "rejected",
        diagnostic: { reason: "validator-rejected" },
        questionId: "repeated-values",
      }),
    );
    expect(state.logs).toContainEqual(
      expect.objectContaining({
        recordType: "reflection-refresh-terminal-emission",
        terminalType: "failed",
        delivery: "emitted",
        failureCategory: "output-validation",
        questionId: "repeated-values",
      }),
    );
  });

  test("does not let a failed stream sink change the job outcome", async () => {
    const state = harness({
      validationError: new GroundedStructuredSubmissionValidationError([
        { code: "custom", message: "PRIVATE_REFLECTION_CONTENT", path: ["result"] },
      ]),
    });
    const events: ReflectionStreamEvent[] = [];
    expect(
      await state.service.run({
        ...runInput(events, { ...request(), questionId: "repeated-values" }),
        emit: (event) => {
          if (event.terminal) throw new Error("transport disconnected");
          events.push(event);
        },
      }),
    ).toBe("failed");
    expect(state.logs).toContainEqual(
      expect.objectContaining({
        recordType: "reflection-refresh-terminal-emission",
        terminalType: "failed",
        delivery: "emitted",
        failureCategory: "output-validation",
        questionId: "repeated-values",
      }),
    );
    const serialized = JSON.stringify(state.logs);
    expect(serialized).not.toContain("PRIVATE_REFLECTION_CONTENT");
    expect(serialized).not.toContain(CAPABILITY);
  });
});
