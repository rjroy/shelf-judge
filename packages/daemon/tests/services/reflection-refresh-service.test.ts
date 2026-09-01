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
  type ReflectionQuestionId,
  type ReflectionStreamEvent,
} from "@shelf-judge/shared";
import type {
  GroundedAnalysisProvider,
  GroundedAnalysisRequest,
  GroundedAnalysisResult,
} from "../../src/services/grounded-analysis/provider.js";
import type { ReflectionEvidencePackage } from "../../src/services/reflection-evidence-service.js";
import {
  createReflectionRefreshService,
  ReflectionRefreshAdmissionError,
} from "../../src/services/reflection-refresh-service.js";
import type { ReflectionStateService } from "../../src/services/reflection-state-service.js";

const NOW = "2026-09-01T12:00:00.000Z";
const CAPABILITY = "a".repeat(64);
const identity = { providerId: "provider-1", modelId: "model-1", extensionIds: [] as string[] };

function packageFor(questionId: ReflectionQuestionId): ReflectionEvidencePackage {
  const evidence = Object.freeze({
    manifestId: "profile-reflection",
    manifestVersion: "1",
    evidenceClasses: Object.freeze([]),
    examinedSources: Object.freeze([]),
    entries: Object.freeze([]),
    hasSource: () => false,
    resolve: () => undefined,
  });
  return Object.freeze({
    evidenceIdentity: ReflectionEvidenceIdentitySchema.parse({
      manifestVersion: 1,
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
      return runAnalysis(analysisRequest).then(
        (result) => result as GroundedAnalysisResult<Output>,
      );
    },
  };
  const state: ReflectionStateService = {
    getSettings: () =>
      Promise.resolve(ReflectionSettingsSchema.parse(structuredClone(DEFAULT_REFLECTION_SETTINGS))),
    getDeletionGeneration: () => Promise.resolve("generation-1"),
    read: () => Promise.reject(new Error("not used")),
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
    completeAttempt: () => Promise.resolve(true),
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
    transportId: `${operationId}-transport`,
    request: requestValue,
    emit(event: ReflectionStreamEvent) {
      events.push(event);
    },
  };
}

describe("ReflectionRefreshService", () => {
  test("runs every enabled question sequentially in fixed order with one operation each", async () => {
    const state = harness();
    expect(await state.service.run(runInput(state.events))).toBe("completed");

    expect(state.started).toEqual([...REFLECTION_QUESTION_IDS]);
    expect(state.analyzed).toEqual([...REFLECTION_QUESTION_IDS]);
    expect(
      state.events.flatMap((event) =>
        event.type === "question-started" ? [event.questionId] : [],
      ),
    ).toEqual([...REFLECTION_QUESTION_IDS]);
    expect(ReflectionStreamEventHistorySchema.safeParse(state.events).success).toBe(true);
    expect(state.logs).toHaveLength(6);
    expect(JSON.stringify(state.logs)).not.toContain(CAPABILITY);
    expect(state.logs[0]).toMatchObject({
      recordType: "reflection-refresh-attempt",
      questionId: "repeated-values",
      modelOperationLimit: 1,
      maximumProviderRoundTrips: 2,
    });
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
    const state = harness({
      analyze: async (analysisRequest) => {
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
    gate.resolve();
    expect(await first).toBe("completed");

    await expectAdmission(state.service.run(runInput([], request(), "operation-3")), {
      reason: "duplicate-batch",
    });
    await expectAdmission(
      state.service.run(runInput([], request("batch-3", "request-1"), "operation-4")),
      { reason: "request-reuse" },
    );
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
    state.state.completeAttempt = async () => {
      entered.resolve();
      await release.promise;
      return true;
    };
    const running = state.service.run(
      runInput(state.events, { ...request(), questionId: "repeated-values" }),
    );
    await entered.promise;
    expect(state.service.cancel("batch-1", CAPABILITY)).toBe(false);
    release.resolve();
    expect(await running).toBe("completed");
    expect(state.events.at(-1)?.type).toBe("question-completed");
  });

  test("linearizes non-final publication before accepting cancellation", async () => {
    const entered = deferred();
    const release = deferred();
    const state = harness();
    let completions = 0;
    state.state.completeAttempt = async () => {
      completions += 1;
      if (completions === 1) {
        entered.resolve();
        await release.promise;
      }
      return true;
    };
    const running = state.service.run(runInput(state.events));
    await entered.promise;
    expect(state.service.cancel("batch-1", CAPABILITY)).toBe(false);
    release.resolve();
    expect(await running).toBe("completed");
    expect(completions).toBe(3);
  });

  test("reports disconnect as transport failure and prevents later questions", async () => {
    const entered = deferred();
    const disconnect = new AbortController();
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
    const running = state.service.run({
      ...runInput(state.events),
      disconnectSignal: disconnect.signal,
    });
    await entered.promise;
    disconnect.abort();
    expect(await running).toBe("failed");
    expect(state.started).toEqual(["repeated-values"]);
    expect(state.failed).toEqual([{ questionId: "repeated-values", reason: "transport" }]);
    expect(state.events.at(-1)).toMatchObject({ type: "failed", reason: "transport" });
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

  test("maps every result-validator rejection to output-validation", async () => {
    const state = harness({ validationError: new Error("unknown citation") });
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
  });
});
