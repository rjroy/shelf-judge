import {
  DEFAULT_REFLECTION_SETTINGS,
  REFLECTION_CONTRACT_VERSION,
  REFLECTION_QUESTION_IDS,
  REFLECTION_UNAVAILABLE_REASONS,
  ReflectionCancelRequestSchema,
  ReflectionDeleteRequestSchema,
  ReflectionGetRequestSchema,
  ReflectionGetResultSchema,
  ReflectionOperationResultSchema,
  ReflectionRefreshRequestSchema,
  ReflectionSettingsSchema,
  ReflectionSettingsUpdateRequestSchema,
  ReflectionStreamEventHistorySchema,
  ReflectionStreamEventSchema,
  type GroundedProviderConfigurationStatus,
  type ReflectionStreamEvent,
} from "@shelf-judge/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { OperationDefinition, OperationJsonValue, RouteModule } from "../operations.js";
import {
  REFLECTION_DISCOVERY_SCHEMAS,
  REFLECTION_RUNTIME_VALIDATION_AUTHORITY,
} from "../services/reflection-discovery-schema.js";
import {
  ReflectionRefreshAdmissionError,
  type ReflectionRefreshService,
} from "../services/reflection-refresh-service.js";
import type {
  ReflectionCurrentSources,
  ReflectionStateService,
} from "../services/reflection-state-service.js";

const OPERATION_PREFIX = "shelf.profile.reflections";
const INVALID_REQUEST_ID = "invalid-request";
const JsonObjectSchema = z.record(z.string(), z.unknown());

const strictObject = (
  required: string[],
  properties: Record<string, OperationJsonValue>,
): OperationJsonValue => ({ type: "object", additionalProperties: false, required, properties });

const discoveryId = { type: "string", minLength: 1 } satisfies OperationJsonValue;
const operationResultSchema = REFLECTION_DISCOVERY_SCHEMAS.operationResult;

function requestIdFrom(body: unknown): string {
  const parsed = JsonObjectSchema.safeParse(body);
  if (!parsed.success) return INVALID_REQUEST_ID;
  const requestId = z.string().min(1).safeParse(parsed.data.requestId);
  return requestId.success ? requestId.data : INVALID_REQUEST_ID;
}

function operationResult(
  value: unknown,
  expectedRequestId: string,
): z.infer<typeof ReflectionOperationResultSchema> {
  const result = ReflectionOperationResultSchema.parse(value);
  if (result.requestId !== expectedRequestId)
    throw new Error("Reflection operation result request identity mismatch");
  return result;
}

function unavailable(requestId: string, safeDetail: string) {
  return operationResult(
    { outcome: "unavailable", requestId, reason: "internal", safeDetail },
    requestId,
  );
}

function validateEventLifecycle(
  history: readonly ReflectionStreamEvent[],
  event: ReflectionStreamEvent,
  expectedQuestionIds: readonly (typeof REFLECTION_QUESTION_IDS)[number][] | undefined,
): void {
  if (history.length === 0) {
    if (event.type !== "accepted") throw new Error("Reflection stream must begin with acceptance");
    if (event.sequence !== 0) throw new Error("Reflection acceptance sequence must begin at zero");
    if (
      expectedQuestionIds === undefined ||
      event.questionIds.length !== expectedQuestionIds.length ||
      event.questionIds.some((questionId, index) => questionId !== expectedQuestionIds[index])
    ) {
      throw new Error("Reflection acceptance does not match the admitted questions");
    }
    return;
  }

  const accepted = history[0];
  if (accepted?.type !== "accepted" || event.type === "accepted") {
    throw new Error("Reflection stream acceptance lifecycle is invalid");
  }
  if (history.at(-1)?.terminal || event.sequence !== history.length) {
    throw new Error("Reflection stream event sequence or terminal lifecycle is invalid");
  }
  if (event.batchId !== accepted.batchId) {
    throw new Error("Reflection stream event does not match the accepted batch");
  }
  const completedQuestions = history.filter(({ type }) => type === "question-completed").length;
  const lastStarted = history.findLast(({ type }) => type === "question-started");
  const lastCompleted = history.findLast(({ type }) => type === "question-completed");
  const activeQuestion =
    lastStarted?.type === "question-started" &&
    (lastCompleted === undefined || lastStarted.sequence > lastCompleted.sequence)
      ? lastStarted.questionId
      : undefined;

  if (event.type === "question-started") {
    if (
      activeQuestion !== undefined ||
      event.questionId !== accepted.questionIds[completedQuestions]
    ) {
      throw new Error("Reflection question start does not match the accepted order");
    }
    return;
  }
  if (event.type === "validated-result") {
    if (
      history.some(
        (prior) => prior.type === "validated-result" && prior.questionId === event.questionId,
      )
    ) {
      throw new Error("Reflection question emitted more than one validated result");
    }
  }
  if (event.type === "question-completed") {
    const validated = history.findLast(
      (prior) => prior.type === "validated-result" && prior.questionId === event.questionId,
    );
    if (
      validated?.type !== "validated-result" ||
      validated.result.outcome !== event.outcome ||
      event.batchComplete !== (completedQuestions === accepted.questionIds.length - 1)
    ) {
      throw new Error("Reflection question completion does not match its accepted lifecycle");
    }
  }
  if ("questionId" in event && event.questionId !== undefined) {
    if (event.questionId !== activeQuestion) {
      throw new Error("Reflection event does not match the active accepted question");
    }
  }
}

async function readJson(context: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}

export interface ProfileReflectionRoutesDeps {
  readonly configurationStatus: GroundedProviderConfigurationStatus;
  readonly state: ReflectionStateService;
  readonly refresh: ReflectionRefreshService;
  readonly loadCurrentSources: () => Promise<ReflectionCurrentSources>;
  readonly createOperationId?: () => string;
  readonly createTransportId?: () => string;
}

export function createProfileReflectionRoutes(deps: ProfileReflectionRoutesDeps): RouteModule {
  const configuration = structuredClone(deps.configurationStatus);
  const createOperationId = deps.createOperationId ?? (() => crypto.randomUUID());
  const createTransportId = deps.createTransportId ?? (() => crypto.randomUUID());
  const routes = new Hono();

  routes.get("/profile/reflections", async (context) => {
    if (!ReflectionGetRequestSchema.safeParse(context.req.queries()).success)
      return context.json(unavailable(INVALID_REQUEST_ID, "invalid-reflection-get-request"), 400);
    try {
      const { settings, questions } = await deps.state.readSnapshot(deps.loadCurrentSources);
      return context.json(
        ReflectionGetResultSchema.parse({
          contractVersion: REFLECTION_CONTRACT_VERSION,
          configuration,
          settings,
          questions,
        }),
      );
    } catch {
      return context.json(unavailable(INVALID_REQUEST_ID, "reflection-read-failed"), 500);
    }
  });

  routes.put("/profile/reflections/settings", async (context) => {
    const body = await readJson(context);
    const parsed = ReflectionSettingsUpdateRequestSchema.safeParse(body);
    if (!parsed.success)
      return context.json(
        unavailable(requestIdFrom(body), "invalid-reflection-settings-request"),
        400,
      );
    try {
      if (!parsed.data.enabled) deps.refresh.cancelActive();
      await deps.state.setEnabled(parsed.data.questionId, parsed.data.enabled);
      const settings = ReflectionSettingsSchema.parse(await deps.state.getSettings());
      const changed = settings.questions.find(
        ({ questionId }) => questionId === parsed.data.questionId,
      );
      if (changed?.enabled !== parsed.data.enabled)
        throw new Error("Reflection settings response identity mismatch");
      return context.json(
        operationResult(
          { outcome: "accepted", requestId: parsed.data.requestId },
          parsed.data.requestId,
        ),
      );
    } catch {
      return context.json(
        unavailable(parsed.data.requestId, "reflection-settings-update-failed"),
        500,
      );
    }
  });

  routes.post("/profile/reflections/cancel", async (context) => {
    const body = await readJson(context);
    const parsed = ReflectionCancelRequestSchema.safeParse(body);
    if (!parsed.success)
      return context.json(
        unavailable(INVALID_REQUEST_ID, "invalid-reflection-cancel-request"),
        400,
      );
    const requestId = parsed.data.batchId;
    const cancelled = deps.refresh.cancel(parsed.data.batchId, parsed.data.capability);
    return context.json(
      operationResult(
        cancelled ? { outcome: "accepted", requestId } : { outcome: "unauthorized", requestId },
        requestId,
      ),
      cancelled ? 200 : 403,
    );
  });

  routes.delete("/profile/reflections", async (context) => {
    const body = await readJson(context);
    const parsed = ReflectionDeleteRequestSchema.safeParse(body);
    if (!parsed.success)
      return context.json(
        unavailable(requestIdFrom(body), "invalid-reflection-delete-request"),
        400,
      );
    try {
      deps.refresh.cancelActive();
      await deps.state.purge(REFLECTION_QUESTION_IDS, "owner-deleted");
      return context.json(
        operationResult(
          { outcome: "accepted", requestId: parsed.data.requestId },
          parsed.data.requestId,
        ),
      );
    } catch {
      return context.json(unavailable(parsed.data.requestId, "reflection-delete-failed"), 500);
    }
  });

  routes.post("/profile/reflections/refresh", async (context) => {
    const body = await readJson(context);
    const parsed = ReflectionRefreshRequestSchema.safeParse(body);
    if (!parsed.success)
      return context.json(
        unavailable(requestIdFrom(body), "invalid-reflection-refresh-request"),
        400,
      );

    const operationId = createOperationId();
    const transportId = createTransportId();
    let acceptedResolve: (() => void) | undefined;
    let acceptedReject: ((error: unknown) => void) | undefined;
    const accepted = new Promise<void>((resolve, reject) => {
      acceptedResolve = resolve;
      acceptedReject = reject;
    });
    const history: ReflectionStreamEvent[] = [];
    let expectedQuestionIds: readonly (typeof REFLECTION_QUESTION_IDS)[number][] | undefined;
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        deps.refresh.cancel(parsed.data.batchId, parsed.data.cancellationCapability);
      },
    });
    const abortController = new AbortController();
    context.req.raw.signal.addEventListener("abort", () => abortController.abort(), { once: true });

    try {
      const running = deps.refresh.run({
        operationId,
        transportId,
        request: parsed.data,
        disconnectSignal: abortController.signal,
        authorizeQuestions(questionIds) {
          if (expectedQuestionIds !== undefined) {
            throw new Error("Reflection questions were authorized more than once");
          }
          expectedQuestionIds = [...questionIds];
        },
        emit(value) {
          const event = ReflectionStreamEventSchema.parse(value);
          if (event.operationId !== operationId || event.batchId !== parsed.data.batchId)
            throw new Error("Reflection stream returned an operation or batch identity mismatch");
          if (
            event.type === "accepted" &&
            (event.requestId !== parsed.data.requestId ||
              event.cancellationCapability !== parsed.data.cancellationCapability)
          )
            throw new Error("Reflection stream returned an acceptance identity mismatch");
          validateEventLifecycle(history, event, expectedQuestionIds);
          const candidateHistory = [...history, event];
          if (event.terminal) ReflectionStreamEventHistorySchema.parse(candidateHistory);
          history.push(event);
          streamController?.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
          if (event.type === "accepted") acceptedResolve?.();
        },
      });
      void running.then(
        () => streamController?.close(),
        (error) => {
          acceptedReject?.(error);
          streamController?.error(error);
        },
      );
    } catch (error) {
      acceptedReject?.(error);
    }

    try {
      await accepted;
    } catch (error) {
      if (error instanceof ReflectionRefreshAdmissionError) {
        const status = error.reason === "model-configuration" ? 503 : 409;
        const result =
          error.reason === "busy"
            ? {
                outcome: "busy" as const,
                requestId: parsed.data.requestId,
                activeBatchId: error.activeBatchId ?? parsed.data.batchId,
              }
            : {
                outcome: "unavailable" as const,
                requestId: parsed.data.requestId,
                reason: error.reason === "model-configuration" ? "model-configuration" : "internal",
                safeDetail: error.reason,
              };
        return context.json(operationResult(result, parsed.data.requestId), status);
      }
      return context.json(
        unavailable(parsed.data.requestId, "reflection-refresh-admission-failed"),
        500,
      );
    }
    return context.body(stream, 200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
  });

  const requestId = discoveryId;
  const questionId = {
    type: "string",
    enum: [...REFLECTION_QUESTION_IDS],
  } satisfies OperationJsonValue;
  const streamEventSchema = REFLECTION_DISCOVERY_SCHEMAS.streamEvent;
  const completedExample = {
    outcome: "abstained",
    reason: "no-owner-testimony",
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
    },
    evidenceIdentity: {
      manifestVersion: 1,
      questionId: "repeated-values",
      questionVersion: 1,
      collectionId: "example-collection",
      collectionSchemaVersion: 6,
      collectionRevision: 0,
      profileContractVersion: 1,
      profileAlgorithmVersion: 1,
      providerId: "example-provider",
      modelId: "example-model",
    },
    dependencies: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
    usage: { state: "unavailable" },
  } satisfies OperationJsonValue;
  const eventExample = (
    sequence: number,
    type: string,
    terminal: boolean,
    payload: Record<string, OperationJsonValue>,
  ): OperationJsonValue => ({
    version: 1,
    operationId: "example-operation",
    sequence,
    occurredAt: "2026-01-01T00:00:00.000Z",
    type,
    terminal,
    batchId: "example-batch",
    ...payload,
  });
  const streamEventExamples: OperationJsonValue[] = [
    eventExample(1, "question-started", false, {
      questionId: "repeated-values",
      questionVersion: 1,
    }),
    eventExample(2, "evidence-retrieval", false, {
      questionId: "repeated-values",
      status: "completed",
      examinedItemCount: 0,
    }),
    eventExample(3, "model-status", false, {
      questionId: "repeated-values",
      status: "validating",
    }),
    eventExample(4, "validated-result", false, {
      questionId: "repeated-values",
      result: completedExample,
    }),
    eventExample(5, "provider-usage", false, {
      questionId: "repeated-values",
      usage: { state: "unavailable" },
    }),
    eventExample(5, "provider-usage", false, {
      questionId: "repeated-values",
      usage: {
        state: "reported",
        inferenceRoundTrips: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 1,
        cacheWriteTokens: 1,
        monetaryCost: { amount: "0.01", currency: "USD" },
      },
    }),
    eventExample(6, "cache-outcome", false, {
      questionId: "repeated-values",
      outcome: "replaced",
    }),
    eventExample(7, "question-completed", false, {
      questionId: "repeated-values",
      outcome: "abstained",
      batchComplete: false,
    }),
    eventExample(7, "question-completed", true, {
      questionId: "repeated-values",
      outcome: "abstained",
      batchComplete: true,
    }),
    eventExample(2, "cancelled", true, { questionId: "repeated-values" }),
    ...REFLECTION_UNAVAILABLE_REASONS.map((reason) =>
      eventExample(2, "failed", true, {
        questionId: "repeated-values",
        reason,
        safeDetail: `example-${reason}`,
      }),
    ),
  ];
  const operationResultExamples: OperationJsonValue[] = [
    { outcome: "accepted", requestId: "example-request" },
    { outcome: "not-found", requestId: "example-request" },
    { outcome: "busy", requestId: "example-request", activeBatchId: "example-batch" },
    { outcome: "unauthorized", requestId: "example-request" },
    {
      outcome: "unavailable",
      requestId: "example-request",
      reason: "internal",
    },
    ...REFLECTION_UNAVAILABLE_REASONS.map((reason) => ({
      outcome: "unavailable",
      requestId: "example-request",
      reason,
      safeDetail: `example-${reason}`,
    })),
  ];
  const getResultSchema = REFLECTION_DISCOVERY_SCHEMAS.getResult;
  const getResultExample = {
    contractVersion: REFLECTION_CONTRACT_VERSION,
    configuration,
    settings: {
      version: DEFAULT_REFLECTION_SETTINGS.version,
      questions: DEFAULT_REFLECTION_SETTINGS.questions.map(({ questionId, enabled }) => ({
        questionId,
        enabled,
      })),
    },
    questions: DEFAULT_REFLECTION_SETTINGS.questions.map(({ questionId, enabled }) => ({
      questionId,
      enabled,
      cache: { state: "none" },
      attempt: { state: "idle" },
    })),
  } satisfies OperationJsonValue;
  const commonErrors = [
    {
      status: 400,
      code: "validation",
      description: "The strict request contract was not satisfied",
      response: { outcome: "unavailable", requestId: INVALID_REQUEST_ID, reason: "internal" },
    },
    {
      status: 500,
      code: "internal",
      description: "A service result failed validation or the operation could not persist",
      response: { outcome: "unavailable", requestId: "request-1", reason: "internal" },
    },
  ];
  const streamErrors = REFLECTION_UNAVAILABLE_REASONS.map((reason) => ({
    status: 200,
    code: `stream-${reason}`,
    description: `The accepted stream terminated with the ${reason} category`,
    response: eventExample(2, "failed", true, {
      questionId: "repeated-values",
      reason,
      safeDetail: `example-${reason}`,
    }) as { [key: string]: OperationJsonValue },
  }));
  const refreshConflictErrors = [
    {
      status: 409,
      code: "refresh-busy",
      description: "Another Reflection batch is active",
      response: { outcome: "busy", requestId: "request-1", activeBatchId: "active-batch" },
    },
    ...(["question-disabled", "duplicate-batch", "request-reuse"] as const).map((safeDetail) => ({
      status: 409,
      code: safeDetail,
      description: {
        "question-disabled": "The requested question is disabled",
        "duplicate-batch": "The batch identity was already used",
        "request-reuse": "A batch or request identity was reused with a changed pairing",
      }[safeDetail],
      response: {
        outcome: "unavailable",
        requestId: "request-1",
        reason: "internal",
        safeDetail,
      },
    })),
  ] satisfies NonNullable<OperationDefinition["errors"]>;
  const operations: OperationDefinition[] = [
    {
      operationId: `${OPERATION_PREFIX}.get`,
      name: "get",
      description: `Read Reflection settings, provider status, and cached states without model work. ${REFLECTION_RUNTIME_VALIDATION_AUTHORITY}`,
      invocation: { method: "GET", path: "/api/profile/reflections" },
      requestSchema: ReflectionGetRequestSchema,
      parameters: [],
      request: {
        body: strictObject([], {}) as { [key: string]: OperationJsonValue },
      },
      response: {
        body: { oneOf: [getResultSchema, operationResultSchema] },
        examples: [getResultExample, ...operationResultExamples],
      },
      errors: commonErrors,
      hierarchy: { root: "shelf", feature: "profile" },
      idempotent: true,
    },
    {
      operationId: `${OPERATION_PREFIX}.settings.update`,
      name: "update",
      description: `Enable or disable one Reflection question, cancelling and deleting when disabled. ${REFLECTION_RUNTIME_VALIDATION_AUTHORITY}`,
      invocation: { method: "PUT", path: "/api/profile/reflections/settings" },
      requestSchema: ReflectionSettingsUpdateRequestSchema,
      request: {
        body: strictObject(["requestId", "questionId", "enabled"], {
          requestId,
          questionId,
          enabled: { type: "boolean" },
        }) as { [key: string]: OperationJsonValue },
      },
      response: { body: operationResultSchema },
      errors: commonErrors,
      hierarchy: { root: "shelf", feature: "profile" },
      idempotent: false,
    },
    {
      operationId: `${OPERATION_PREFIX}.refresh.stream`,
      name: "stream",
      description: `Explicitly refresh enabled Reflections as validated SSE events. ${REFLECTION_RUNTIME_VALIDATION_AUTHORITY}`,
      invocation: { method: "POST", path: "/api/profile/reflections/refresh" },
      requestSchema: ReflectionRefreshRequestSchema,
      request: {
        body: strictObject(["batchId", "requestId", "cancellationCapability", "disclosure"], {
          batchId: discoveryId,
          requestId,
          cancellationCapability: {
            type: "string",
            pattern: "^[0-9a-f]{64}$",
          },
          questionId,
          disclosure: strictObject(["version", "providerId", "modelId", "acknowledged"], {
            version: { const: 1 },
            providerId: discoveryId,
            modelId: discoveryId,
            acknowledged: { const: true },
          }),
        }) as { [key: string]: OperationJsonValue },
      },
      response: {
        body: {
          oneOf: [{ type: "string", contentMediaType: "text/event-stream" }, operationResultSchema],
        },
        examples: operationResultExamples,
        events: {
          body: streamEventSchema,
          examples: streamEventExamples,
        },
      },
      errors: [
        commonErrors[0],
        ...refreshConflictErrors,
        {
          status: 503,
          code: "model-configuration",
          description: "The acknowledgement does not match the configured provider and model",
          response: {
            outcome: "unavailable",
            requestId: "request-1",
            reason: "model-configuration",
          },
        },
        commonErrors[1],
        ...streamErrors,
      ],
      hierarchy: { root: "shelf", feature: "profile" },
      idempotent: false,
    },
    {
      operationId: `${OPERATION_PREFIX}.cancel`,
      name: "cancel",
      description: `Cancel the exact active Reflection batch with its cancellation capability. ${REFLECTION_RUNTIME_VALIDATION_AUTHORITY}`,
      invocation: { method: "POST", path: "/api/profile/reflections/cancel" },
      requestSchema: ReflectionCancelRequestSchema,
      request: {
        body: strictObject(["batchId", "capability"], {
          batchId: discoveryId,
          capability: { type: "string", pattern: "^[0-9a-f]{64}$" },
        }) as { [key: string]: OperationJsonValue },
      },
      response: { body: operationResultSchema },
      errors: [
        commonErrors[0],
        {
          status: 403,
          code: "unauthorized",
          description: "The batch and cancellation capability do not identify the active operation",
          response: { outcome: "unauthorized", requestId: "batch-1" },
        },
      ],
      hierarchy: { root: "shelf", feature: "profile" },
      idempotent: false,
    },
    {
      operationId: `${OPERATION_PREFIX}.delete`,
      name: "delete",
      description: `Delete all Reflection output while preserving sources, settings, and provider configuration. ${REFLECTION_RUNTIME_VALIDATION_AUTHORITY}`,
      invocation: { method: "DELETE", path: "/api/profile/reflections" },
      requestSchema: ReflectionDeleteRequestSchema,
      request: {
        body: strictObject(["requestId", "confirmed"], {
          requestId,
          confirmed: { const: true },
        }) as { [key: string]: OperationJsonValue },
      },
      response: { body: operationResultSchema },
      errors: commonErrors,
      hierarchy: { root: "shelf", feature: "profile" },
      idempotent: false,
    },
  ];

  return { routes, operations };
}
