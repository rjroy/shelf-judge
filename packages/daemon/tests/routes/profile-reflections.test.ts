import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REFLECTION_SETTINGS,
  REFLECTION_QUESTION_IDS,
  REFLECTION_UNAVAILABLE_REASONS,
  ReflectionCompletedSchema,
  ReflectionCitationSchema,
  ReflectionGetRequestSchema,
  ReflectionGetResultSchema,
  ReflectionOperationResultSchema,
  ReflectionQuestionStateCollectionSchema,
  ReflectionSettingsSchema,
  ReflectionStreamEventSchema,
  GroundedProviderUsageSchema,
  type ReflectionQuestionId,
  type ReflectionStreamEvent,
} from "@shelf-judge/shared";
import { Hono } from "hono";
import { Compile } from "typebox/compile";
import { createProfileReflectionRoutes } from "../../src/routes/profile-reflections.js";
import {
  REFLECTION_DISCOVERY_SCHEMAS,
  REFLECTION_RUNTIME_VALIDATION_AUTHORITY,
} from "../../src/services/reflection-discovery-schema.js";
import type { GroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
import {
  ReflectionRefreshAdmissionError,
  type ReflectionRefreshRunInput,
  type ReflectionRefreshService,
} from "../../src/services/reflection-refresh-service.js";
import type {
  ReflectionCurrentSources,
  ReflectionStateService,
} from "../../src/services/reflection-state-service.js";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";

const NOW = "2026-09-01T12:00:00.000Z";
const CAPABILITY = "a".repeat(64);
const CONFIGURATION = {
  status: "configured" as const,
  identity: { providerId: "provider-1", modelId: "model-1", extensionIds: [] },
};
const SETTINGS = ReflectionSettingsSchema.parse(structuredClone(DEFAULT_REFLECTION_SETTINGS));
const QUESTIONS = ReflectionQuestionStateCollectionSchema.parse(
  SETTINGS.questions.map(({ questionId, enabled }) => ({
    questionId,
    enabled,
    cache: { state: "none" },
    attempt: { state: "idle" },
  })),
);
const SOURCES: ReflectionCurrentSources = {
  collectionId: "collection-1",
  collectionSchemaVersion: 6,
  collectionRevision: 0,
  profileContractVersion: 1,
  profileAlgorithmVersion: 1,
  providerId: "provider-1",
  modelId: "model-1",
  dependenciesByQuestion: {
    "repeated-values": [],
    "pattern-exceptions": [],
    "recurring-trade-offs": [],
  },
};

interface ReflectionHelpNode {
  description?: string;
  response?: {
    body: Record<string, unknown>;
    examples?: unknown[];
    events?: { body: Record<string, unknown>; examples: unknown[] };
  };
  children?: Record<string, ReflectionHelpNode>;
}

const RUNTIME_VALIDATION_EXTENSION = "x-shelf-judge-runtime-validation";

function collectSchemaResources(value: unknown): Record<string, unknown>[] {
  if (typeof value !== "object" || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(collectSchemaResources);
  const record = value as Record<string, unknown>;
  return [
    ...(typeof record.$id === "string" ? [record] : []),
    ...Object.values(record).flatMap(collectSchemaResources),
  ];
}

function matchesDiscoverySchema(schemaValue: unknown, value: unknown): boolean {
  if (typeof schemaValue !== "object" || schemaValue === null || Array.isArray(schemaValue)) {
    return false;
  }
  return Compile(schemaValue).Check(value);
}

function eventExampleForParity(
  type: string,
  payload: Record<string, unknown>,
  terminal = false,
): Record<string, unknown> {
  return {
    version: 1,
    operationId: "operation-1",
    sequence: 1,
    occurredAt: NOW,
    type,
    terminal,
    batchId: "batch-1",
    ...payload,
  };
}

function completed(questionId: ReflectionQuestionId) {
  return ReflectionCompletedSchema.parse({
    outcome: "abstained",
    reason: questionId === "pattern-exceptions" ? "no-supported-pattern" : "no-owner-testimony",
    explanation: "No bounded result is available.",
    supportingBlocks: [],
    citations: [],
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
      collectionId: "collection-1",
      collectionSchemaVersion: 6,
      collectionRevision: 0,
      profileContractVersion: 1,
      profileAlgorithmVersion: 1,
      providerId: "provider-1",
      modelId: "model-1",
    },
    dependencies: [],
    generatedAt: NOW,
    usage: { state: "unavailable" },
  });
}

function answered(questionId: ReflectionQuestionId = "repeated-values") {
  const citationIds = ["note-1", "note-2", "score-1"];
  return ReflectionCompletedSchema.parse({
    outcome: "answered",
    centralSynthesis: { text: "A bounded synthesis", citationIds },
    supportingBlocks: [{ text: "Supporting context", citationIds }],
    citations: [
      {
        citationId: "note-1",
        sourceId: "game-1",
        sourceVersion: "1",
        evidenceClass: "owner-game-note",
        testimony: true,
        canonicalSummary: "First owner note",
        destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
      },
      {
        citationId: "note-2",
        sourceId: "game-2",
        sourceVersion: "1",
        evidenceClass: "owner-game-note",
        testimony: true,
        canonicalSummary: "Second owner note",
        destination: { operationId: "shelf.game.get", parameters: { gameId: "game-2" } },
      },
      {
        citationId: "score-1",
        sourceId: "profile-1",
        sourceVersion: "1",
        evidenceClass: "current-scoring",
        testimony: false,
        canonicalSummary: "Current deterministic score",
        destination: { operationId: "shelf.profile.get", parameters: {} },
      },
    ],
    scope: {
      examinedPresentNoteCount: 2,
      totalPresentNoteCount: 2,
      examinedGameCount: 2,
      relevantEligibleGameCount: 2,
      excludedGameCount: 0,
      exhaustiveNotes: true,
      ...(questionId === "pattern-exceptions" ? { patternCandidateIds: ["mechanic:1"] } : {}),
    },
    evidenceIdentity: {
      manifestVersion: 1,
      questionId,
      questionVersion: 1,
      collectionId: "collection-1",
      collectionSchemaVersion: 6,
      collectionRevision: 1,
      profileContractVersion: 1,
      profileAlgorithmVersion: 1,
      providerId: "provider-1",
      modelId: "model-1",
    },
    dependencies: [
      { category: "note", gameId: "game-1", noteVersion: 1 },
      { category: "note", gameId: "game-2", noteVersion: 1 },
      { category: "scoring", sourceId: "profile-1", fingerprint: "score-1" },
    ],
    generatedAt: NOW,
    usage: { state: "reported", inferenceRoundTrips: 2, inputTokens: 10, outputTokens: 5 },
  });
}

function makeState(overrides: Partial<ReflectionStateService> = {}): ReflectionStateService {
  const state: ReflectionStateService = {
    getSettings: () => Promise.resolve(structuredClone(SETTINGS)),
    getDeletionGeneration: () => Promise.resolve("generation-1"),
    read: () => Promise.resolve(structuredClone(QUESTIONS)),
    readSnapshot: async (loadCurrentSources) => {
      const settings = await state.getSettings();
      const questions = await state.read(await loadCurrentSources());
      return { settings, questions };
    },
    setEnabled: () => Promise.resolve(),
    startAttempt: () => Promise.reject(new Error("not used")),
    completeAttempt: () => Promise.reject(new Error("not used")),
    compensateAttempt: () => Promise.reject(new Error("not used")),
    cancelAttempt: () => Promise.reject(new Error("not used")),
    failAttempt: () => Promise.reject(new Error("not used")),
    purge: () => Promise.resolve("generation-2"),
    ...overrides,
  };
  return state;
}

function acceptedEvent(
  input: ReflectionRefreshRunInput,
): Extract<ReflectionStreamEvent, { type: "accepted" }> {
  const request = input.request as {
    batchId: string;
    requestId: string;
    cancellationCapability: string;
  };
  const event = ReflectionStreamEventSchema.parse({
    version: 1,
    operationId: input.operationId,
    sequence: 0,
    occurredAt: NOW,
    type: "accepted",
    terminal: false,
    batchId: request.batchId,
    requestId: request.requestId,
    cancellationCapability: request.cancellationCapability,
    questionIds: ["repeated-values"],
  });
  if (event.type !== "accepted") throw new Error("Expected accepted Reflection test event");
  return event;
}

function makeRefresh(
  run: (input: ReflectionRefreshRunInput) => Promise<"completed" | "cancelled" | "failed"> = async (
    input,
  ) => {
    const request = input.request as { batchId: string };
    await input.emit(acceptedEvent(input));
    await input.emit(
      ReflectionStreamEventSchema.parse({
        version: 1,
        operationId: input.operationId,
        sequence: 1,
        occurredAt: NOW,
        type: "question-started",
        terminal: false,
        batchId: request.batchId,
        questionId: "repeated-values",
        questionVersion: 1,
      }),
    );
    await input.emit(
      ReflectionStreamEventSchema.parse({
        version: 1,
        operationId: input.operationId,
        sequence: 2,
        occurredAt: NOW,
        type: "validated-result",
        terminal: false,
        batchId: request.batchId,
        questionId: "repeated-values",
        result: completed("repeated-values"),
      }),
    );
    await input.emit(
      ReflectionStreamEventSchema.parse({
        version: 1,
        operationId: input.operationId,
        sequence: 3,
        occurredAt: NOW,
        type: "question-completed",
        terminal: true,
        batchId: request.batchId,
        questionId: "repeated-values",
        outcome: "abstained",
        batchComplete: true,
      }),
    );
    return "completed";
  },
  authorizedQuestionIds: readonly ReflectionQuestionId[] = ["repeated-values"],
): ReflectionRefreshService {
  return {
    run(input) {
      input.authorizeQuestions(authorizedQuestionIds);
      return run(input);
    },
    cancel: () => false,
    cancelActive: () => false,
    discover: () => [],
  };
}

function harness(options?: {
  state?: ReflectionStateService;
  refresh?: ReflectionRefreshService;
  loadCurrentSources?: () => Promise<ReflectionCurrentSources>;
}) {
  const module = createProfileReflectionRoutes({
    configurationStatus: CONFIGURATION,
    state: options?.state ?? makeState(),
    refresh: options?.refresh ?? makeRefresh(),
    loadCurrentSources: options?.loadCurrentSources ?? (() => Promise.resolve(SOURCES)),
    createOperationId: () => "operation-1",
    createTransportId: () => "transport-1",
  });
  const app = new Hono();
  app.route("/api", module.routes);
  return { app, operations: module.operations };
}

function refreshRequest() {
  return {
    batchId: "batch-1",
    requestId: "request-1",
    cancellationCapability: CAPABILITY,
    questionId: "repeated-values",
    disclosure: {
      version: 1,
      providerId: "provider-1",
      modelId: "model-1",
      acknowledged: true,
    },
  };
}

function allEnabledRefreshRequest() {
  const request = refreshRequest();
  return {
    batchId: request.batchId,
    requestId: request.requestId,
    cancellationCapability: request.cancellationCapability,
    disclosure: request.disclosure,
  };
}

async function readPossiblyRejectedStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("Missing Reflection response body");
  const decoder = new TextDecoder();
  let serialized = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      serialized += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    // Preserve bytes emitted before the route rejected an injected event.
  }
  return serialized;
}

describe("Profile Reflection routes", () => {
  test("passively reads and validates the complete result without model work", async () => {
    let refreshCalls = 0;
    const context = harness({
      refresh: makeRefresh(() => {
        refreshCalls += 1;
        return Promise.resolve("failed");
      }),
    });
    const response = await jsonRequest(context.app, "GET", "/api/profile/reflections");
    expect(response.status).toBe(200);
    expect(ReflectionGetResultSchema.safeParse(await response.json()).success).toBe(true);
    expect(refreshCalls).toBe(0);
  });

  test("strictly rejects unsupported get query input before passive state work", async () => {
    let stateCalls = 0;
    const state = makeState({
      getSettings: () => {
        stateCalls += 1;
        return Promise.resolve(structuredClone(SETTINGS));
      },
      read: () => {
        stateCalls += 1;
        return Promise.resolve(structuredClone(QUESTIONS));
      },
    });
    const response = await jsonRequest(
      harness({
        state,
        loadCurrentSources: () => {
          stateCalls += 1;
          return Promise.resolve(SOURCES);
        },
      }).app,
      "GET",
      "/api/profile/reflections?extra=private",
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      outcome: "unavailable",
      requestId: "invalid-request",
      reason: "internal",
      safeDetail: "invalid-reflection-get-request",
    });
    expect(stateCalls).toBe(0);
  });

  test("rejects malformed injected read results at the response gate", async () => {
    const state = makeState({
      read: () => Promise.resolve([{ questionId: "private-mismatch" }] as never),
    });
    const response = await jsonRequest(harness({ state }).app, "GET", "/api/profile/reflections");
    expect(response.status).toBe(500);
    expect(ReflectionOperationResultSchema.parse(await response.json())).toMatchObject({
      outcome: "unavailable",
      safeDetail: "reflection-read-failed",
    });
  });

  test("strictly rejects unknown request fields before settings, refresh, cancel, or delete work", async () => {
    let calls = 0;
    const state = makeState({
      setEnabled: () => {
        calls += 1;
        return Promise.resolve();
      },
      purge: () => {
        calls += 1;
        return Promise.resolve("generation-2");
      },
    });
    const refresh = makeRefresh(() => {
      calls += 1;
      return Promise.resolve("failed");
    });
    refresh.cancel = () => {
      calls += 1;
      return false;
    };
    const app = harness({ state, refresh }).app;
    for (const [method, path, body] of [
      [
        "PUT",
        "/api/profile/reflections/settings",
        { requestId: "r", questionId: "repeated-values", enabled: false, extra: true },
      ],
      ["POST", "/api/profile/reflections/refresh", { ...refreshRequest(), extra: true }],
      [
        "POST",
        "/api/profile/reflections/cancel",
        { batchId: "batch-1", capability: CAPABILITY, extra: true },
      ],
      ["DELETE", "/api/profile/reflections", { requestId: "r", confirmed: true, extra: true }],
    ] as const) {
      expect((await jsonRequest(app, method, path, body)).status).toBe(400);
    }
    expect(calls).toBe(0);
  });

  test("disabling and delete-all use trusted cancellation and preserve unrelated settings", async () => {
    let cancelCalls = 0;
    let purgeArguments: readonly ReflectionQuestionId[] = [];
    const refresh = makeRefresh();
    refresh.cancelActive = () => {
      cancelCalls += 1;
      return true;
    };
    const localSettings = ReflectionSettingsSchema.parse(
      structuredClone(DEFAULT_REFLECTION_SETTINGS),
    );
    const state = makeState({
      getSettings: () => Promise.resolve(structuredClone(localSettings)),
      setEnabled(questionId, enabled) {
        const question = localSettings.questions.find(
          (candidate) => candidate.questionId === questionId,
        );
        if (question === undefined) throw new Error("Unknown test Reflection question");
        question.enabled = enabled;
        return Promise.resolve();
      },
      purge(questionIds) {
        purgeArguments = questionIds;
        return Promise.resolve("generation-2");
      },
    });
    const app = harness({ state, refresh }).app;
    const settings = await jsonRequest(app, "PUT", "/api/profile/reflections/settings", {
      requestId: "settings-1",
      questionId: "repeated-values",
      enabled: false,
    });
    expect(settings.status).toBe(200);
    expect(await settings.json()).toEqual({ outcome: "accepted", requestId: "settings-1" });
    const deletion = await jsonRequest(app, "DELETE", "/api/profile/reflections", {
      requestId: "delete-1",
      confirmed: true,
    });
    expect(deletion.status).toBe(200);
    expect(cancelCalls).toBe(2);
    expect(purgeArguments).toEqual([
      "repeated-values",
      "pattern-exceptions",
      "recurring-trade-offs",
    ]);
    expect(localSettings.questions.slice(1).every(({ enabled }) => enabled)).toBe(true);
  });

  test("rejects a settings service identity mismatch at the response gate", async () => {
    const state = makeState({
      getSettings: () => Promise.resolve(structuredClone(SETTINGS)),
      setEnabled: () => Promise.resolve(),
    });
    const response = await jsonRequest(
      harness({ state }).app,
      "PUT",
      "/api/profile/reflections/settings",
      { requestId: "settings-1", questionId: "repeated-values", enabled: false },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      outcome: "unavailable",
      requestId: "settings-1",
      safeDetail: "reflection-settings-update-failed",
    });
  });

  test("requires the exact batch capability and validates the cancel result", async () => {
    const refresh = makeRefresh();
    refresh.cancel = (batchId, capability) => batchId === "batch-1" && capability === CAPABILITY;
    const app = harness({ refresh }).app;
    expect(
      (
        await jsonRequest(app, "POST", "/api/profile/reflections/cancel", {
          batchId: "batch-1",
          capability: "b".repeat(64),
        })
      ).status,
    ).toBe(403);
    const accepted = await jsonRequest(app, "POST", "/api/profile/reflections/cancel", {
      batchId: "batch-1",
      capability: CAPABILITY,
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ outcome: "accepted", requestId: "batch-1" });
  });

  test("validates and serializes a complete identity-corresponding SSE history", async () => {
    const response = await jsonRequest(
      harness().app,
      "POST",
      "/api/profile/reflections/refresh",
      refreshRequest(),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("event: accepted");
    expect(text).toContain("event: question-completed");
    expect(text).not.toContain("private");
  });

  test("rejects returned stream identity mismatch before serialization", async () => {
    const refresh = makeRefresh(async (input) => {
      await input.emit({ ...acceptedEvent(input), batchId: "other-batch" });
      return "failed";
    });
    const response = await jsonRequest(
      harness({ refresh }).app,
      "POST",
      "/api/profile/reflections/refresh",
      refreshRequest(),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      outcome: "unavailable",
      requestId: "request-1",
      safeDetail: "reflection-refresh-admission-failed",
    });
  });

  test("rejects acceptance for a different selected question before emitting stream bytes", async () => {
    const refresh = makeRefresh(async (input) => {
      await input.emit({
        ...acceptedEvent(input),
        questionIds: ["pattern-exceptions"],
      });
      return "failed";
    });
    const response = await jsonRequest(
      harness({ refresh }).app,
      "POST",
      "/api/profile/reflections/refresh",
      refreshRequest(),
    );
    expect(response.status).toBe(500);
    const serialized = await response.text();
    expect(serialized).not.toContain("event: accepted");
    expect(serialized).not.toContain("pattern-exceptions");
  });

  test.each([
    ["subset", ["pattern-exceptions"]],
    ["superset", [...REFLECTION_QUESTION_IDS]],
    ["wrong order", ["pattern-exceptions", "repeated-values"]],
  ] as const)(
    "rejects an all-enabled %s acceptance before serializing event or capability bytes",
    async (_case, acceptedQuestionIds) => {
      let modelCalls = 0;
      const authorizedQuestionIds = ["repeated-values", "pattern-exceptions"] as const;
      const refresh = makeRefresh(async (input) => {
        modelCalls += 1;
        await input.emit({
          ...acceptedEvent(input),
          questionIds: [...acceptedQuestionIds],
        });
        modelCalls += 1;
        return "failed";
      }, authorizedQuestionIds);
      const response = await jsonRequest(
        harness({ refresh }).app,
        "POST",
        "/api/profile/reflections/refresh",
        allEnabledRefreshRequest(),
      );
      const serialized = await response.text();

      expect(response.status).toBe(500);
      expect(serialized).not.toContain("event: accepted");
      expect(serialized).not.toContain(CAPABILITY);
      expect(modelCalls).toBe(1);
    },
  );

  test("rejects an all-enabled wrong intermediate event before its bytes or a second model call", async () => {
    let modelCalls = 0;
    const authorizedQuestionIds = ["repeated-values", "pattern-exceptions"] as const;
    const refresh = makeRefresh(async (input) => {
      const request = input.request as { batchId: string };
      modelCalls += 1;
      await input.emit({
        ...acceptedEvent(input),
        questionIds: [...authorizedQuestionIds],
      });
      await input.emit(
        ReflectionStreamEventSchema.parse({
          version: 1,
          operationId: input.operationId,
          sequence: 1,
          occurredAt: NOW,
          type: "question-started",
          terminal: false,
          batchId: request.batchId,
          questionId: "pattern-exceptions",
          questionVersion: 1,
        }),
      );
      modelCalls += 1;
      return "failed";
    }, authorizedQuestionIds);
    const response = await jsonRequest(
      harness({ refresh }).app,
      "POST",
      "/api/profile/reflections/refresh",
      allEnabledRefreshRequest(),
    );
    const serialized = await readPossiblyRejectedStream(response);

    expect(response.status).toBe(200);
    expect(serialized).not.toContain("event: question-started");
    expect(modelCalls).toBe(1);
  });

  test("rejects a wrong intermediate question before emitting its bytes", async () => {
    const refresh = makeRefresh(async (input) => {
      await input.emit(acceptedEvent(input));
      await input.emit(
        ReflectionStreamEventSchema.parse({
          version: 1,
          operationId: input.operationId,
          sequence: 1,
          occurredAt: NOW,
          type: "question-started",
          terminal: false,
          batchId: refreshRequest().batchId,
          questionId: "pattern-exceptions",
          questionVersion: 1,
        }),
      );
      return "failed";
    });
    const response = await jsonRequest(
      harness({ refresh }).app,
      "POST",
      "/api/profile/reflections/refresh",
      refreshRequest(),
    );
    expect(response.status).toBe(200);
    const serialized = await readPossiblyRejectedStream(response);
    expect(serialized).not.toContain("event: question-started");
    expect(serialized).not.toContain("pattern-exceptions");
  });

  test("rejects malformed injected stream events after acceptance", async () => {
    const refresh = makeRefresh(async (input) => {
      await input.emit(acceptedEvent(input));
      await input.emit({
        ...acceptedEvent(input),
        sequence: 1,
        type: "private-event",
      } as never);
      return "failed";
    });
    const response = await jsonRequest(
      harness({ refresh }).app,
      "POST",
      "/api/profile/reflections/refresh",
      refreshRequest(),
    );
    expect(response.status).toBe(200);
    let rejected = false;
    try {
      await response.text();
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  test("maps every admission result without provider work", async () => {
    for (const [reason, status, discoveryCode] of [
      ["busy", 409, "refresh-busy"],
      ["question-disabled", 409, "question-disabled"],
      ["duplicate-batch", 409, "duplicate-batch"],
      ["request-reuse", 409, "request-reuse"],
      ["model-configuration", 503, "model-configuration"],
    ] as const) {
      const refresh = makeRefresh(() => {
        throw new ReflectionRefreshAdmissionError(
          reason,
          reason === "busy" ? "active-batch" : undefined,
        );
      });
      const context = harness({ refresh });
      const response = await jsonRequest(
        context.app,
        "POST",
        "/api/profile/reflections/refresh",
        refreshRequest(),
      );
      expect(response.status, reason).toBe(status);
      const body = ReflectionOperationResultSchema.parse(await response.json());
      if (status === 409) {
        const operation = context.operations.find(
          ({ operationId }) => operationId === "shelf.profile.reflections.refresh.stream",
        );
        expect(operation?.errors?.find(({ code }) => code === discoveryCode)?.response).toEqual(
          body,
        );
      }
    }
  });
});

describe("production-equivalent passive composition", () => {
  test("startup, cache-miss reads, ordinary profile reads, and source mutations invoke no model work", async () => {
    let modelCalls = 0;
    const provider: GroundedAnalysisProvider = {
      configurationStatus: CONFIGURATION,
      analyze() {
        modelCalls += 1;
        return Promise.reject(new Error("Passive operations must not invoke the model"));
      },
    };
    const context = createTestApp({ groundedAnalysisProvider: provider });
    expect(modelCalls).toBe(0);
    expect((await jsonRequest(context.app, "GET", "/api/profile/reflections")).status).toBe(200);
    expect((await jsonRequest(context.app, "GET", "/api/profile")).status).toBe(200);
    const game = (await context.gameService.addGame({ name: "Passive source mutation" })).game;
    await context.ownerGameNoteService.set(game.id, {
      commandId: "52000000-0000-4000-8000-000000000001",
      expectedVersion: 0,
      text: "A source mutation must remain passive.",
    });
    expect(modelCalls).toBe(0);
  });
});

describe("Profile Reflection operation discovery", () => {
  test("publishes exactly five complete operations with strict schemas and reachable errors", async () => {
    const context = createTestApp();
    const operations = context.operations.filter(({ operationId }) =>
      operationId.startsWith("shelf.profile.reflections."),
    );
    expect(operations.map(({ operationId }) => operationId)).toEqual([
      "shelf.profile.reflections.get",
      "shelf.profile.reflections.settings.update",
      "shelf.profile.reflections.refresh.stream",
      "shelf.profile.reflections.cancel",
      "shelf.profile.reflections.delete",
    ]);
    expect(operations.every(({ response }) => response !== undefined)).toBe(true);
    expect(operations.every(({ requestSchema }) => requestSchema !== undefined)).toBe(true);
    const get = operations[0];
    expect(get.requestSchema).toBe(ReflectionGetRequestSchema);
    expect(get.requestSchema?.safeParse({}).success).toBe(true);
    expect(get.requestSchema?.safeParse({ extra: "private" }).success).toBe(false);
    expect(get.parameters).toEqual([]);
    expect(get.request?.body).toEqual({
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    });
    expect(operations.every(({ errors }) => (errors?.length ?? 0) > 0)).toBe(true);

    const refresh = operations.find(
      ({ operationId }) => operationId === "shelf.profile.reflections.refresh.stream",
    );
    const conflicts = refresh?.errors?.filter(({ status }) => status === 409);
    expect(conflicts?.map(({ code }) => code)).toEqual([
      "refresh-busy",
      "question-disabled",
      "duplicate-batch",
      "request-reuse",
    ]);
    expect(conflicts?.map(({ response }) => response)).toEqual([
      { outcome: "busy", requestId: "request-1", activeBatchId: "active-batch" },
      {
        outcome: "unavailable",
        requestId: "request-1",
        reason: "internal",
        safeDetail: "question-disabled",
      },
      {
        outcome: "unavailable",
        requestId: "request-1",
        reason: "internal",
        safeDetail: "duplicate-batch",
      },
      {
        outcome: "unavailable",
        requestId: "request-1",
        reason: "internal",
        safeDetail: "request-reuse",
      },
    ]);
    for (const conflict of conflicts ?? []) {
      expect(ReflectionOperationResultSchema.safeParse(conflict.response).success).toBe(true);
    }

    const response = await jsonRequest(context.app, "GET", "/api/help/profile");
    expect(response.status).toBe(200);
    const serialized = await response.text();
    for (const sentinel of [
      "PRIVATE_NOTE_SENTINEL",
      "GENERATED_PROSE_SENTINEL",
      CAPABILITY,
      "0".repeat(64),
      "RAW_EVIDENCE_SENTINEL",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(serialized).toContain("shelf.profile.reflections.refresh.stream");
  });

  test("discloses runtime validation authority in every resource and operation", async () => {
    const response = await jsonRequest(createTestApp().app, "GET", "/api/help/profile");
    const help = (await response.json()) as ReflectionHelpNode;
    const operations = help.children?.profile?.children?.reflections?.children;
    if (operations === undefined) throw new Error("Missing serialized Reflection operations");

    const leaves = [
      operations.get,
      operations.settings?.children?.update,
      operations.refresh?.children?.stream,
      operations.cancel,
      operations.delete,
    ];
    expect(leaves.every((operation) => operation?.description?.includes("authoritative"))).toBe(
      true,
    );
    expect(
      leaves.every((operation) =>
        operation?.description?.includes(
          "request/event lifecycle identity/order/terminal relationships",
        ),
      ),
    ).toBe(true);

    const resources = collectSchemaResources(help);
    const resourcesById = new Map(resources.map((resource) => [resource.$id, resource]));
    expect([...resourcesById.keys()].sort()).toEqual(
      Object.values(REFLECTION_DISCOVERY_SCHEMAS)
        .map((resource) => resource.$id)
        .sort(),
    );
    for (const resource of resourcesById.values()) {
      expect(resource.description).toBe(REFLECTION_RUNTIME_VALIDATION_AUTHORITY);
      expect(resource[RUNTIME_VALIDATION_EXTENSION]).toEqual({
        authoritative: true,
        omittedCategories: [
          "cross-field-count-equivalence",
          "citation-dependency-uniqueness-resolution-composition",
          "request-event-lifecycle-identity-order-terminal-relationships",
        ],
      });
    }
  });

  test("keeps owner-note positive-safe-integer strings in runtime and draft-07 parity", async () => {
    const response = await jsonRequest(createTestApp().app, "GET", "/api/help/profile");
    const help = (await response.json()) as ReflectionHelpNode;
    const eventContract =
      help.children?.profile?.children?.reflections?.children?.refresh?.children?.stream?.response
        ?.events?.body;
    if (eventContract === undefined)
      throw new Error("Missing serialized Reflection event contract");
    const citationContract = {
      ...eventContract,
      $ref: "#/definitions/ReflectionCitation",
    };
    const citation = answered().citations[0];
    const accepted = [
      "1",
      "9",
      "10",
      "999999999999999",
      "1000000000000000",
      "8999999999999999",
      "9000000000000000",
      String(Number.MAX_SAFE_INTEGER),
    ];
    const rejected = [
      String(Number.MAX_SAFE_INTEGER + 1),
      "9999999999999999",
      "10000000000000000",
      "0",
      "01",
      "+1",
      "-1",
      "1.0",
      "1e1",
    ];
    for (const sourceVersion of accepted) {
      const candidate = { ...citation, sourceVersion };
      expect(ReflectionCitationSchema.safeParse(candidate).success).toBe(true);
      expect(matchesDiscoverySchema(citationContract, candidate)).toBe(true);
    }
    for (const sourceVersion of rejected) {
      const candidate = { ...citation, sourceVersion };
      expect(ReflectionCitationSchema.safeParse(candidate).success).toBe(false);
      expect(matchesDiscoverySchema(citationContract, candidate)).toBe(false);
    }
  });

  test("publishes schema-valid examples for every strict result and stream event variant", async () => {
    const response = await jsonRequest(createTestApp().app, "GET", "/api/help/profile");
    const help = (await response.json()) as ReflectionHelpNode;
    const operations = help.children?.profile?.children?.reflections?.children;
    const get = operations?.get?.response;
    const refresh = operations?.refresh?.children?.stream?.response;
    if (get === undefined || refresh?.events === undefined) {
      throw new Error("Missing serialized Reflection discovery contracts");
    }
    expect(JSON.stringify(get.body)).not.toContain("strict-reflection-get-result");
    expect(JSON.stringify({ get: get.body, events: refresh.events.body })).not.toContain(
      "schemaId",
    );
    expect(get.body).toHaveProperty("oneOf.0.definitions.ReflectionGetResult");
    expect(refresh.events.body).toHaveProperty("definitions.ReflectionCompleted");
    const getExample = get.examples?.find(
      (example) => typeof example === "object" && example !== null && "contractVersion" in example,
    );
    expect(ReflectionGetResultSchema.safeParse(getExample).success).toBe(true);
    expect(matchesDiscoverySchema(get.body, getExample)).toBe(true);
    const resultExamples = (get.examples ?? []).filter(
      (example) => typeof example === "object" && example !== null && "outcome" in example,
    );
    for (const example of resultExamples) {
      expect(ReflectionOperationResultSchema.safeParse(example).success).toBe(true);
    }
    expect(
      new Set(resultExamples.map((example) => (example as { outcome: string }).outcome)),
    ).toEqual(new Set(["accepted", "not-found", "busy", "unauthorized", "unavailable"]));
    expect(
      new Set(
        resultExamples.flatMap((example) =>
          (example as { outcome: string; reason?: string }).outcome === "unavailable" &&
          "reason" in example &&
          typeof example.reason === "string"
            ? [example.reason]
            : [],
        ),
      ),
    ).toEqual(new Set(REFLECTION_UNAVAILABLE_REASONS));

    const eventExamples = refresh.events.examples;
    const eventParityFixtures = [
      eventExampleForParity("accepted", {
        requestId: "example-request",
        cancellationCapability: CAPABILITY,
        questionIds: ["repeated-values"],
      }),
      ...eventExamples,
    ];
    for (const example of eventParityFixtures) {
      expect(ReflectionStreamEventSchema.safeParse(example).success).toBe(true);
      expect(matchesDiscoverySchema(refresh.events.body, example)).toBe(true);
    }
    expect(
      new Set(eventParityFixtures.map((example) => (example as { type: string }).type)),
    ).toEqual(
      new Set([
        "accepted",
        "question-started",
        "evidence-retrieval",
        "model-status",
        "validated-result",
        "provider-usage",
        "cache-outcome",
        "question-completed",
        "cancelled",
        "failed",
      ]),
    );
    expect(
      new Set(
        eventExamples.flatMap((example) =>
          (example as { type: string; reason?: string }).type === "failed"
            ? [(example as { reason: string }).reason]
            : [],
        ),
      ),
    ).toEqual(new Set(REFLECTION_UNAVAILABLE_REASONS));
    expect(
      eventExamples.some(
        (example) =>
          (example as { type: string; terminal: boolean }).type === "question-completed" &&
          (example as { terminal: boolean }).terminal,
      ),
    ).toBe(true);
  });

  test("keeps serialized operation-result and optional stream contracts in shared-schema parity", async () => {
    const response = await jsonRequest(createTestApp().app, "GET", "/api/help/profile");
    const help = (await response.json()) as ReflectionHelpNode;
    const operations = help.children?.profile?.children?.reflections?.children;
    const resultContract = operations?.refresh?.children?.stream?.response?.body;
    const eventContract = operations?.refresh?.children?.stream?.response?.events?.body;
    if (resultContract === undefined || eventContract === undefined) {
      throw new Error("Missing serialized Reflection parity contracts");
    }

    const operationResults: unknown[] = [
      { outcome: "accepted", requestId: "request-1" },
      { outcome: "not-found", requestId: "request-1" },
      { outcome: "busy", requestId: "request-1", activeBatchId: "batch-1" },
      { outcome: "unauthorized", requestId: "request-1" },
      ...REFLECTION_UNAVAILABLE_REASONS.flatMap((reason) => [
        { outcome: "unavailable", requestId: "request-1", reason },
        { outcome: "unavailable", requestId: "request-1", reason, safeDetail: "safe" },
      ]),
    ];
    for (const result of operationResults) {
      expect(ReflectionOperationResultSchema.safeParse(result).success).toBe(true);
      expect(matchesDiscoverySchema(resultContract, result)).toBe(true);
    }
    for (const rejected of [
      { outcome: "unavailable", requestId: "request-1", reason: "internal", extra: true },
      { outcome: "unavailable", requestId: "request-1", reason: "internal", safeDetail: "" },
    ]) {
      expect(ReflectionOperationResultSchema.safeParse(rejected).success).toBe(false);
      expect(matchesDiscoverySchema(resultContract, rejected)).toBe(false);
    }

    const optionalUsage = [
      ["inputTokens", 11],
      ["outputTokens", 7],
      ["cacheReadTokens", 5],
      ["cacheWriteTokens", 3],
      ["monetaryCost", { amount: "0.01", currency: "USD" }],
    ] as const;
    const usageEvents = Array.from({ length: 1 << optionalUsage.length }, (_, mask) => {
      const usage: Record<string, unknown> = { state: "reported", inferenceRoundTrips: 1 };
      optionalUsage.forEach(([field, value], index) => {
        if ((mask & (1 << index)) !== 0) usage[field] = value;
      });
      return eventExampleForParity("provider-usage", { questionId: "repeated-values", usage });
    });
    usageEvents.push(
      eventExampleForParity("provider-usage", {
        questionId: "repeated-values",
        usage: { state: "unavailable" },
      }),
    );
    for (const event of usageEvents) {
      expect(ReflectionStreamEventSchema.safeParse(event).success).toBe(true);
      expect(matchesDiscoverySchema(eventContract, event)).toBe(true);
    }

    const optionalTerminalEvents = [
      eventExampleForParity("cancelled", {}, true),
      eventExampleForParity("cancelled", { questionId: "repeated-values" }, true),
      ...REFLECTION_UNAVAILABLE_REASONS.flatMap((reason) =>
        [false, true].flatMap((withQuestion) =>
          [false, true].map((withDetail) =>
            eventExampleForParity(
              "failed",
              {
                reason,
                ...(withQuestion ? { questionId: "repeated-values" } : {}),
                ...(withDetail ? { safeDetail: "safe" } : {}),
              },
              true,
            ),
          ),
        ),
      ),
    ];
    for (const event of optionalTerminalEvents) {
      expect(ReflectionStreamEventSchema.safeParse(event).success).toBe(true);
      expect(matchesDiscoverySchema(eventContract, event)).toBe(true);
    }

    const validBoundaryEvents = [
      {
        ...eventExampleForParity("accepted", {
          requestId: "request-1",
          cancellationCapability: CAPABILITY,
          questionIds: ["repeated-values", "recurring-trade-offs"],
        }),
        sequence: Number.MAX_SAFE_INTEGER,
      },
      eventExampleForParity("evidence-retrieval", {
        questionId: "repeated-values",
        status: "completed",
        examinedItemCount: Number.MAX_SAFE_INTEGER,
      }),
    ];
    for (const event of validBoundaryEvents) {
      expect(ReflectionStreamEventSchema.safeParse(event).success).toBe(true);
      expect(matchesDiscoverySchema(eventContract, event)).toBe(true);
    }
    for (let selection = 1; selection < 2 ** REFLECTION_QUESTION_IDS.length; selection += 1) {
      const event = eventExampleForParity("accepted", {
        requestId: "request-1",
        cancellationCapability: CAPABILITY,
        questionIds: REFLECTION_QUESTION_IDS.filter(
          (_questionId, index) => (selection & (1 << index)) !== 0,
        ),
      });
      expect(ReflectionStreamEventSchema.safeParse(event).success).toBe(true);
      expect(matchesDiscoverySchema(eventContract, event)).toBe(true);
    }

    const invalidParityEvents = [
      eventExampleForParity("accepted", {
        requestId: "request-1",
        cancellationCapability: CAPABILITY,
        questionIds: ["pattern-exceptions", "repeated-values"],
      }),
      {
        ...eventExampleForParity("model-status", {
          questionId: "repeated-values",
          status: "started",
        }),
        sequence: Number.MAX_SAFE_INTEGER + 1,
      },
      eventExampleForParity("evidence-retrieval", {
        questionId: "repeated-values",
        status: "completed",
        examinedItemCount: Number.MAX_SAFE_INTEGER + 1,
      }),
    ];
    for (const event of invalidParityEvents) {
      expect(ReflectionStreamEventSchema.safeParse(event).success).toBe(false);
      expect(matchesDiscoverySchema(eventContract, event)).toBe(false);
    }

    for (const usage of [
      { state: "reported", inferenceRoundTrips: 0 },
      { state: "reported", inferenceRoundTrips: 1, totalTokens: 18 },
      { state: "reported", inferenceRoundTrips: 1, cacheReadTokens: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const event = eventExampleForParity("provider-usage", {
        questionId: "repeated-values",
        usage,
      });
      expect(GroundedProviderUsageSchema.safeParse(usage).success).toBe(false);
      expect(ReflectionStreamEventSchema.safeParse(event).success).toBe(false);
      expect(matchesDiscoverySchema(eventContract, event)).toBe(false);
    }
  });

  test("rejects malformed nested GET, completed-result, usage, and event contracts in runtime and discovery", async () => {
    const response = await jsonRequest(createTestApp().app, "GET", "/api/help/profile");
    const help = (await response.json()) as ReflectionHelpNode;
    const operations = help.children?.profile?.children?.reflections?.children;
    const getContract = operations?.get?.response?.body;
    const eventContract = operations?.refresh?.children?.stream?.response?.events?.body;
    if (getContract === undefined || eventContract === undefined) {
      throw new Error("Missing serialized Reflection contracts");
    }

    const validGet = {
      contractVersion: 1,
      configuration: {
        status: "configured" as const,
        identity: { providerId: "provider-1", modelId: "model-1", extensionIds: ["ext-1"] },
      },
      settings: structuredClone(SETTINGS),
      questions: [
        {
          questionId: "repeated-values" as const,
          enabled: true,
          cache: { state: "current" as const, result: answered() },
          attempt: { state: "idle" as const },
        },
        {
          questionId: "pattern-exceptions" as const,
          enabled: true,
          cache: {
            state: "stale" as const,
            changedCategories: ["collection" as const],
            result: completed("pattern-exceptions"),
          },
          attempt: { state: "unavailable" as const, reason: "transport" as const, occurredAt: NOW },
        },
        {
          questionId: "recurring-trade-offs" as const,
          enabled: true,
          cache: { state: "none" as const },
          attempt: { state: "refreshing" as const, batchId: "batch-1", startedAt: NOW },
        },
      ],
    };
    expect(ReflectionGetResultSchema.safeParse(validGet).success).toBe(true);
    expect(matchesDiscoverySchema(getContract, validGet)).toBe(true);

    const invalidGets: unknown[] = [];
    const malformedConfiguration = structuredClone(validGet);
    malformedConfiguration.configuration.identity.extensionIds.push("ext-1");
    invalidGets.push(malformedConfiguration);
    const malformedSettings = structuredClone(validGet);
    malformedSettings.settings.questions.reverse();
    invalidGets.push(malformedSettings);
    const malformedQuestionState = structuredClone(validGet);
    malformedQuestionState.settings.questions[0].enabled = false;
    malformedQuestionState.questions[0].enabled = false;
    invalidGets.push(malformedQuestionState);
    const duplicateChangedCategory = structuredClone(validGet);
    const staleCache = duplicateChangedCategory.questions[1]?.cache;
    if (staleCache?.state !== "stale") throw new Error("Expected stale Reflection test cache");
    staleCache.changedCategories.push("collection");
    invalidGets.push(duplicateChangedCategory);
    const unknownGetField = structuredClone(validGet) as Record<string, unknown>;
    unknownGetField.privateNote = "not discoverable";
    invalidGets.push(unknownGetField);
    for (const invalid of invalidGets) {
      expect(ReflectionGetResultSchema.safeParse(invalid).success).toBe(false);
      expect(matchesDiscoverySchema(getContract, invalid)).toBe(false);
    }

    const validResultEvents = [
      eventExampleForParity("validated-result", {
        questionId: "repeated-values",
        result: answered(),
      }),
      eventExampleForParity("validated-result", {
        questionId: "pattern-exceptions",
        result: completed("pattern-exceptions"),
      }),
    ];
    for (const event of validResultEvents) {
      expect(ReflectionStreamEventSchema.safeParse(event).success).toBe(true);
      expect(matchesDiscoverySchema(eventContract, event)).toBe(true);
    }

    const invalidEvents: unknown[] = [];
    const malformedAnswered = structuredClone(validResultEvents[0]);
    const answeredResult = malformedAnswered.result as Record<string, unknown>;
    answeredResult.reason = "no-owner-testimony";
    invalidEvents.push(malformedAnswered);
    const malformedAbstained = structuredClone(validResultEvents[1]);
    const abstainedResult = malformedAbstained.result as Record<string, unknown>;
    abstainedResult.centralSynthesis = { text: "forbidden", citationIds: [] };
    invalidEvents.push(malformedAbstained);
    const malformedDestination = structuredClone(validResultEvents[0]);
    const destinationResult = malformedDestination.result as ReturnType<typeof answered>;
    destinationResult.citations[0].destination.parameters = { gameId: "game-1", secret: "x" };
    invalidEvents.push(malformedDestination);
    const malformedCitation = structuredClone(validResultEvents[0]);
    const citationResult = malformedCitation.result as ReturnType<typeof answered>;
    citationResult.citations[0] = { ...citationResult.citations[0], testimony: false } as never;
    invalidEvents.push(malformedCitation);
    for (const inferenceRoundTrips of [0, 3]) {
      invalidEvents.push(
        eventExampleForParity("provider-usage", {
          questionId: "repeated-values",
          usage: { state: "reported", inferenceRoundTrips },
        }),
      );
    }
    invalidEvents.push({
      ...eventExampleForParity("model-status", {
        questionId: "repeated-values",
        status: "started",
      }),
      sequence: Number.MAX_SAFE_INTEGER + 1,
    });
    invalidEvents.push({
      ...eventExampleForParity("model-status", {
        questionId: "repeated-values",
        status: "started",
      }),
      rawProviderEvent: "private",
    });
    for (const invalid of invalidEvents) {
      expect(ReflectionStreamEventSchema.safeParse(invalid).success).toBe(false);
      expect(matchesDiscoverySchema(eventContract, invalid)).toBe(false);
    }
  });
});
