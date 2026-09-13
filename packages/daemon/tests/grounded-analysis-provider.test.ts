import { describe, expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import {
  GroundedAnalysisError,
  mapGroundedAnalysisFailure,
} from "../src/services/grounded-analysis/failure-mapping.js";
import { createGroundedAnalysisProvider } from "../src/services/grounded-analysis/provider.js";
import { createAnalystTurnService } from "../src/services/analyst-turn-service.js";
import { AnalystEvidenceSourceChangedError } from "../src/services/analyst-evidence-service.js";
import {
  createAnalystEvidenceService,
  type AnalystEvidenceService,
} from "../src/services/analyst-evidence-service.js";
import type { AnalystProjectionSnapshot } from "../src/services/analyst-evidence-projections.js";
import {
  createGroundedModelLogger,
  groundedProviderFailureDiagnostics,
  type GroundedModelLogRecord,
} from "../src/services/grounded-analysis/model-logger.js";
import {
  createPiGroundedAnalysisSessionFactory,
  GroundedSessionRunError,
  latestTerminalAssistantFailure,
} from "../src/services/grounded-analysis/session-factory.js";
import {
  createOllamaProviderExtension,
  createOllamaRequestPayloadHook,
} from "../src/services/grounded-analysis/ollama-provider-extension.js";
import {
  COLLECTION_EVIDENCE_TOOL_NAMES,
  COLLECTION_EVIDENCE_WITH_SUBMISSION_TOOL_NAMES,
  createCollectionAnalystToolManifest,
  createGroundedSubmissionOnlyToolManifest,
  createProfileReflectionToolManifest,
  GROUNDED_SUBMISSION_TOOL_NAME,
} from "../src/services/grounded-analysis/structured-submission.js";
import {
  createGroundedToolLifecycleDiagnostics,
  GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT,
} from "../src/services/grounded-analysis/tool-lifecycle.js";

const providerId = "shelf-judge-local";
const modelId = "deterministic-v1";
const submissionSchema = z.object({ answer: z.string() }).strict();

interface LocalProviderControls {
  transmissions: Array<{ systemPrompt: string; messages: Context["messages"] }>;
  /** Explicit test-script termination, checked before cloning model context. */
  expectedRequests?: number;
  fixtureFailures?: string[];
  mode?:
    | "submit"
    | "cancel"
    | "free-text"
    | "submit-then-free-text"
    | "submit-with-text"
    | "malformed-with-text"
    | "no-submission"
    | "length"
    | "malformed"
    | "malformed-then-valid"
    | "unrelated-tool-then-valid"
    | "provider-error"
    | "throw"
    | "cancel-no-message"
    | "repeat-malformed"
    | "repeat-duplicate"
    | "same-turn-duplicate"
    | "retrieve-then-submit"
    | "retrieve-three-then-submit"
    | "retrieve-twenty-five-then-submit"
    | "retrieve-until-exhausted";
  monetaryCosts?: readonly number[];
  modelLogs?: GroundedModelLogRecord[];
}

function expectedScenarioRequests(mode: LocalProviderControls["mode"]): number {
  switch (mode) {
    case "retrieve-then-submit":
      return 2;
    case "retrieve-three-then-submit":
      return 4;
    case "retrieve-twenty-five-then-submit":
      return 26;
    case "retrieve-until-exhausted":
      return 5;
    case "malformed-then-valid":
    case "malformed":
    case "malformed-with-text":
    case "unrelated-tool-then-valid":
      return 2;
    case "repeat-malformed":
    case "repeat-duplicate":
      return 3;
    default:
      return 1;
  }
}

function assistantMessage(
  model: Model<Api>,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
  roundTrip: number,
  monetaryCostUsd = 0,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: roundTrip,
      output: roundTrip + 1,
      cacheRead: roundTrip + 2,
      cacheWrite: roundTrip + 3,
      totalTokens: roundTrip * 4 + 6,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: monetaryCostUsd,
      },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function collectionTestTools(top: ReturnType<typeof defineTool>) {
  const noArguments = Type.Object({}, { additionalProperties: false });
  return [
    top,
    defineTool({
      name: "grep",
      label: "Search collection evidence",
      description: "Unused test collection search",
      parameters: noArguments,
      execute: () => Promise.resolve({ content: [], details: undefined }),
    }),
    defineTool({
      name: "readGames",
      label: "Read selected games",
      description: "Unused test collection read",
      parameters: noArguments,
      execute: () => Promise.resolve({ content: [], details: undefined }),
    }),
    defineTool({
      name: "summarize",
      label: "Summarize collection",
      description: "Unused test collection summary",
      parameters: noArguments,
      execute: () => Promise.resolve({ content: [], details: undefined }),
    }),
  ];
}

function localProviderExtension(controls: LocalProviderControls): ExtensionFactory {
  return (pi) => {
    pi.registerProvider(providerId, {
      name: "Shelf Judge deterministic local provider",
      baseUrl: "http://127.0.0.1.invalid",
      apiKey: "local-test-key",
      api: "openai-completions",
      models: [
        {
          id: modelId,
          name: "Deterministic v1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 512,
        },
      ],
      streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
        const stream = createAssistantMessageEventStream();
        const roundTrip = controls.transmissions.length + 1;
        const expectedRequests =
          controls.expectedRequests ?? expectedScenarioRequests(controls.mode);
        if (roundTrip > expectedRequests) {
          controls.fixtureFailures?.push("test fixture exceeded expected scenario requests");
          queueMicrotask(() => {
            const message = assistantMessage(model, [], "error", roundTrip);
            message.errorMessage = "test fixture exceeded expected scenario requests";
            stream.push({ type: "error", reason: "error", error: message });
            stream.end();
          });
          return stream;
        }
        controls.transmissions.push({
          systemPrompt: context.systemPrompt ?? "",
          messages: structuredClone(context.messages),
        });
        void options?.onPayload?.({ context }, model);
        const monetaryCostUsd = controls.monetaryCosts?.[roundTrip - 1] ?? 0;

        if (controls.mode === "throw") throw new Error("request transport threw");

        queueMicrotask(() => {
          if (controls.mode === "cancel" || controls.mode === "cancel-no-message") {
            const abort = () => {
              const message = assistantMessage(model, [], "aborted", roundTrip, monetaryCostUsd);
              if (controls.mode === "cancel") message.errorMessage = "Request was aborted";
              stream.push({ type: "error", reason: "aborted", error: message });
              stream.end();
            };
            if (options?.signal?.aborted) abort();
            else options?.signal?.addEventListener("abort", abort, { once: true });
            return;
          }

          if (controls.mode === "provider-error") {
            const message = assistantMessage(model, [], "error", roundTrip, monetaryCostUsd);
            message.errorMessage = "socket network timeout";
            stream.push({ type: "error", reason: "error", error: message });
            stream.end();
            return;
          }

          const hasToolResult = context.messages.some((message) => message.role === "toolResult");
          const repeatedSubmission =
            controls.mode === "repeat-malformed" || controls.mode === "repeat-duplicate";
          const requiresSecondToolCall =
            controls.mode === "malformed-then-valid" ||
            controls.mode === "unrelated-tool-then-valid" ||
            controls.mode === "retrieve-then-submit" ||
            controls.mode === "retrieve-three-then-submit" ||
            controls.mode === "retrieve-twenty-five-then-submit" ||
            controls.mode === "retrieve-until-exhausted";
          const retrievalRound =
            controls.mode === "retrieve-then-submit"
              ? roundTrip === 1
              : controls.mode === "retrieve-three-then-submit"
                ? roundTrip <= 3
                : controls.mode === "retrieve-twenty-five-then-submit"
                  ? roundTrip <= 25
                  : controls.mode === "retrieve-until-exhausted";
          if (
            (!hasToolResult || repeatedSubmission || requiresSecondToolCall) &&
            !(controls.mode === "retrieve-until-exhausted" && roundTrip > 4) &&
            !(repeatedSubmission && roundTrip > 2) &&
            controls.mode !== "no-submission" &&
            controls.mode !== "length" &&
            controls.mode !== "free-text"
          ) {
            const toolCall: ToolCall = {
              type: "toolCall",
              id: `submission-${roundTrip}`,
              name:
                (controls.mode === "unrelated-tool-then-valid" && roundTrip === 1) || retrievalRound
                  ? retrievalRound
                    ? "top"
                    : "unrelated_tool"
                  : "submit_grounded_analysis",
              arguments: {
                ...(retrievalRound
                  ? { rankBy: "fitness" }
                  : {
                      submission: {
                        answer:
                          controls.mode === "malformed" ||
                          controls.mode === "malformed-with-text" ||
                          controls.mode === "repeat-malformed" ||
                          (controls.mode === "malformed-then-valid" && roundTrip === 1)
                            ? 42
                            : "grounded",
                      },
                    }),
              },
            };
            const toolCalls =
              controls.mode === "same-turn-duplicate"
                ? [toolCall, { ...toolCall, id: `submission-duplicate-${roundTrip}` }]
                : [toolCall];
            const content =
              controls.mode === "submit-with-text" || controls.mode === "malformed-with-text"
                ? [...toolCalls, { type: "text" as const, text: "not allowed" }]
                : toolCalls;
            const message = assistantMessage(model, content, "toolUse", roundTrip, monetaryCostUsd);
            stream.push({ type: "start", partial: message });
            stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
            stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
            if (toolCalls.length === 2) {
              const duplicate = toolCalls[1];
              if (duplicate === undefined) throw new Error("Expected duplicate tool call");
              stream.push({ type: "toolcall_start", contentIndex: 1, partial: message });
              stream.push({
                type: "toolcall_end",
                contentIndex: 1,
                toolCall: duplicate,
                partial: message,
              });
            }
            if (controls.mode === "submit-with-text") {
              const textIndex = toolCalls.length;
              stream.push({ type: "text_start", contentIndex: textIndex, partial: message });
              stream.push({
                type: "text_end",
                contentIndex: textIndex,
                content: "not allowed",
                partial: message,
              });
            }
            stream.push({ type: "done", reason: "toolUse", message });
            stream.end();
            return;
          }

          const content =
            controls.mode === "free-text" || controls.mode === "submit-then-free-text"
              ? [{ type: "text" as const, text: "not allowed" }]
              : [];
          const message = assistantMessage(
            model,
            content,
            controls.mode === "length" ? "length" : "stop",
            roundTrip,
            monetaryCostUsd,
          );
          stream.push({ type: "start", partial: message });
          if (content.length > 0) {
            stream.push({ type: "text_start", contentIndex: 0, partial: message });
            stream.push({
              type: "text_end",
              contentIndex: 0,
              content: "not allowed",
              partial: message,
            });
          }
          stream.push({ type: "done", reason: "stop", message });
          stream.end();
        });
        return stream;
      },
    });
  };
}

function configuredProvider(
  controls: LocalProviderControls,
  extraExtensions: ExtensionFactory[] = [],
  lifecycle: string[] = [],
  traceAssistantContent = false,
) {
  return createGroundedAnalysisProvider({
    configuration: {
      status: "configured",
      providerId,
      modelId,
      extensionIds: ["local-provider"],
    },
    sessionFactory: createPiGroundedAnalysisSessionFactory({
      cwd: process.cwd(),
      extensionIds: [],
      extensionFactories: [localProviderExtension(controls), ...extraExtensions],
      onLifecycleStage: (stage) => lifecycle.push(stage),
    }),
    modelLogger: createGroundedModelLogger({
      write: (record) => controls.modelLogs?.push(record),
    }),
    traceAssistantContent,
  });
}

function request(signal = new AbortController().signal) {
  return {
    systemPrompt: "EXACT POLICY",
    prompt: "EXACT EVIDENCE",
    submissionSchema,
    signal,
    audit: {
      operationId: "operation-1",
      batchId: "batch-1",
      requestId: "request-1",
      feature: "feature-a",
      trigger: "owner-request",
      evidenceManifestId: "feature-a-manifest",
      evidenceManifestVersion: "v1",
      evidenceClassCounts: [{ evidenceClass: "feature-a", count: 1 }],
      evidenceIdentityHash: "d".repeat(64),
    },
    allowedTools: createGroundedSubmissionOnlyToolManifest("feature-a"),
  };
}

async function captureFailure(promise: Promise<unknown>): Promise<GroundedAnalysisError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GroundedAnalysisError) return error;
    throw error;
  }
  throw new Error("Expected grounded analysis to fail");
}

describe("grounded-analysis provider lifecycle", () => {
  test("writes a correlated chronological round, tool, text, and terminal-error trace", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "free-text",
      modelLogs: [],
    };
    await captureFailure(
      configuredProvider(controls, [], [], true).analyze({
        ...request(),
        prompt: "ordinary assistant text",
      }),
    );

    const trace = controls.modelLogs?.filter(
      (record) => record.recordType === "grounded-model-trace",
    );
    expect(trace).toMatchObject([
      { event: "model-request-start", roundIndex: 1, requestId: "request-1" },
      {
        event: "model-response-end",
        roundIndex: 1,
        stopReason: "stop",
        assistantText: "not allowed",
        assistantTextLength: 11,
        assistantTextTruncated: false,
      },
    ]);
    expect(trace?.[1]?.durationMs).toBeNumber();

    const failedControls: LocalProviderControls = {
      transmissions: [],
      mode: "provider-error",
      modelLogs: [],
    };
    await captureFailure(configuredProvider(failedControls).analyze(request()));
    const terminalTrace = failedControls.modelLogs?.find(
      (record): record is Extract<GroundedModelLogRecord, { recordType: "grounded-model-trace" }> =>
        record.recordType === "grounded-model-trace" && record.event === "session-error",
    );
    expect(terminalTrace?.requestId).toBe("request-1");
    expect(terminalTrace?.roundIndex).toBe(1);
    expect(terminalTrace?.durationMs).toBeNumber();
    expect(terminalTrace?.failure?.primary.message).toBe("socket network timeout");

    const thrownControls: LocalProviderControls = {
      transmissions: [],
      mode: "throw",
      modelLogs: [],
    };
    await captureFailure(configuredProvider(thrownControls).analyze(request()));
    const thrownTerminalTraces = thrownControls.modelLogs?.filter(
      (record): record is Extract<GroundedModelLogRecord, { recordType: "grounded-model-trace" }> =>
        record.recordType === "grounded-model-trace" && record.event === "session-error",
    );
    expect(thrownTerminalTraces).toHaveLength(1);
    expect(thrownTerminalTraces?.[0]).toMatchObject({
      roundIndex: 1,
      failure: { primary: { message: "request transport threw" } },
    });
  });

  test("keeps live tool tracing uncapped while retaining a bounded diagnostic snapshot", () => {
    const trace: Array<{ callIndex: number }> = [];
    const lifecycle = createGroundedToolLifecycleDiagnostics({
      onTrace: (event) => trace.push({ callIndex: event.callIndex }),
    });
    for (let index = 0; index < GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT + 1; index += 1) {
      const callIndex = lifecycle.dispatch("top", "retrieval");
      lifecycle.handling("top", "retrieval", callIndex, "accepted");
    }
    expect(lifecycle.snapshot()).toHaveLength(GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT);
    expect(trace).toHaveLength((GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT + 1) * 2);
    expect(trace.at(-1)).toEqual({ callIndex: GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT });
  });

  test("correlates retrieval and submission tool traces to their generating model rounds", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "retrieve-then-submit",
      modelLogs: [],
    };
    const lifecycle = createGroundedToolLifecycleDiagnostics();
    const retrieval = defineTool({
      name: "top",
      label: "Rank collection games",
      description: "Read-only test collection ranking",
      parameters: Type.Object({ rankBy: Type.Literal("fitness") }, { additionalProperties: false }),
      execute() {
        const callIndex = lifecycle.dispatch("top", "retrieval");
        lifecycle.handling("top", "retrieval", callIndex, "accepted");
        return Promise.resolve({ content: [], details: undefined });
      },
    });
    await configuredProvider(controls).analyze({
      ...request(),
      audit: { ...request().audit, feature: "profile-reflection" },
      allowedTools: createProfileReflectionToolManifest(),
      retrievalTools: collectionTestTools(retrieval),
      toolLifecycle: lifecycle,
    });
    const toolTrace = controls.modelLogs?.filter(
      (record): record is Extract<GroundedModelLogRecord, { recordType: "grounded-model-trace" }> =>
        record.recordType === "grounded-model-trace" &&
        (record.event === "tool-dispatch" || record.event === "tool-outcome"),
    );
    expect(toolTrace?.map(({ toolName, roundIndex }) => ({ toolName, roundIndex }))).toEqual([
      { toolName: "top", roundIndex: 1 },
      { toolName: "top", roundIndex: 1 },
      { toolName: "submit_grounded_analysis", roundIndex: 2 },
      { toolName: "submit_grounded_analysis", roundIndex: 2 },
    ]);
    expect(toolTrace?.[1]?.durationMs).toBeNumber();
    expect(toolTrace?.[3]?.durationMs).toBeNumber();
  });

  test("publishes the exact model-directed collection manifests for Analyst and Reflection", () => {
    expect(COLLECTION_EVIDENCE_TOOL_NAMES).toEqual(["top", "grep", "readGames", "summarize"]);
    expect(COLLECTION_EVIDENCE_WITH_SUBMISSION_TOOL_NAMES).toEqual([
      "top",
      "grep",
      "readGames",
      "summarize",
      "submit_grounded_analysis",
    ]);
    expect(createCollectionAnalystToolManifest()).toEqual({
      feature: "collection-analyst",
      toolNames: COLLECTION_EVIDENCE_TOOL_NAMES,
    });
    expect(createProfileReflectionToolManifest()).toEqual({
      feature: "profile-reflection",
      toolNames: COLLECTION_EVIDENCE_WITH_SUBMISSION_TOOL_NAMES,
    });
  });

  test("accepts the exact collection tool set for profile reflection", async () => {
    const collectionTools = COLLECTION_EVIDENCE_TOOL_NAMES.map((name) =>
      defineTool({
        name,
        label: name,
        description: "Read-only collection evidence",
        parameters: Type.Object({}, { additionalProperties: false }),
        execute: () => Promise.resolve({ content: [], details: undefined }),
      }),
    );

    const result = await configuredProvider({ transmissions: [] }).analyze({
      ...request(),
      audit: { ...request().audit, feature: "profile-reflection" },
      allowedTools: createProfileReflectionToolManifest(),
      retrievalTools: collectionTools,
    });

    expect(result).toMatchObject({ output: { answer: "grounded" } });
  });

  test("serializes Ollama's documented token budget and thinking disable controls", async () => {
    let requestPayload: unknown;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (requestPayload !== undefined) {
          return new Response("test fixture exceeded expected scenario requests", { status: 503 });
        }
        expect(new URL(request.url).pathname).toBe("/v1/chat/completions");
        requestPayload = await request.json();
        const toolArguments = JSON.stringify({ submission: { answer: "grounded" } });
        const response = [
          `data: ${JSON.stringify({
            id: "mock-completion",
            object: "chat.completion.chunk",
            created: 0,
            model: "ollama-test",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: GROUNDED_SUBMISSION_TOOL_NAME, arguments: toolArguments },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          })}\n\n`,
          `data: ${JSON.stringify({
            id: "mock-completion",
            object: "chat.completion.chunk",
            created: 0,
            model: "ollama-test",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
          })}\n\n`,
          "data: [DONE]\n\n",
        ].join("");
        return new Response(response, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    try {
      const maxTokens = 123;
      const modelLogs: GroundedModelLogRecord[] = [];
      const provider = createGroundedAnalysisProvider({
        configuration: {
          status: "configured",
          providerId: "ollama",
          modelId: "ollama-transport-diagnostic-test",
          extensionIds: ["ollama-transport-diagnostic-test"],
        },
        sessionFactory: createPiGroundedAnalysisSessionFactory({
          cwd: process.cwd(),
          extensionIds: [],
          createExtensionFactories: (sink) => [
            createOllamaProviderExtension(
              "ollama-transport-diagnostic-test",
              maxTokens,
              `http://127.0.0.1:${server.port}/v1`,
              sink,
            ),
          ],
          onPayload: createOllamaRequestPayloadHook(maxTokens),
        }),
        modelLogger: createGroundedModelLogger({ write: (record) => modelLogs.push(record) }),
      });

      const result = await provider.analyze(request());
      expect(result).toMatchObject({
        output: { answer: "grounded" },
      });
      expect(requestPayload).toMatchObject({
        max_tokens: maxTokens,
        reasoning_effort: "none",
      });
      const transportTrace = modelLogs.find(
        (
          record,
        ): record is import("../src/services/grounded-analysis/model-logger.js").GroundedModelTraceEvent =>
          record.recordType === "grounded-model-trace" && record.event === "provider-transport",
      );
      expect(transportTrace?.roundIndex).toBe(1);
      expect(transportTrace?.transport).toMatchObject({
        phase: "awaiting-headers",
        outcome: "headers-received",
      });
      expect(requestPayload).not.toHaveProperty("think");
    } finally {
      await server.stop(true);
    }
  });

  test("submits structured output after cumulative provider payloads exceed one MiB", async () => {
    let requests = 0;
    const toolResponse = (name: string, argumentsValue: object) =>
      [
        `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${requests}`,
                    type: "function",
                    function: { name, arguments: JSON.stringify(argumentsValue) },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
    const server = Bun.serve({
      port: 0,
      fetch() {
        requests += 1;
        if (requests > 2) {
          return new Response("test fixture exceeded expected scenario requests", { status: 503 });
        }
        const firstTurn = requests % 2 === 1;
        return new Response(
          toolResponse(
            firstTurn ? "top" : GROUNDED_SUBMISSION_TOOL_NAME,
            firstTurn ? {} : { submission: { answer: "grounded" } },
          ),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    const collectionTools = COLLECTION_EVIDENCE_TOOL_NAMES.map((name) =>
      defineTool({
        name,
        label: name,
        description: "Read-only collection evidence",
        parameters: Type.Object({}, { additionalProperties: false }),
        execute: () =>
          Promise.resolve({
            content: [{ type: "text", text: "tool response" }],
            details: undefined,
          }),
      }),
    );
    const configuration = {
      status: "configured" as const,
      providerId: "ollama",
      modelId: "ollama-test",
      extensionIds: ["ollama-test"],
    };
    const createSessionFactory = (onPayload?: SimpleStreamOptions["onPayload"]) =>
      createPiGroundedAnalysisSessionFactory({
        cwd: process.cwd(),
        extensionIds: [],
        extensionFactories: [
          createOllamaProviderExtension("ollama-test", 123, `http://127.0.0.1:${server.port}/v1`),
        ],
        onPayload,
      });
    const analysisRequest = {
      ...request(),
      audit: { ...request().audit, feature: "profile-reflection" },
      allowedTools: createProfileReflectionToolManifest(),
      retrievalTools: collectionTools,
    };
    try {
      const payloadBytes: number[] = [];
      const result = await createGroundedAnalysisProvider({
        configuration,
        sessionFactory: createSessionFactory((payload) => {
          const padded = {
            ...(payload as object),
            shelfJudgeBudgetRegressionPadding: "x".repeat(1024 * 1024),
          };
          payloadBytes.push(new TextEncoder().encode(JSON.stringify(padded)).byteLength);
          return padded;
        }),
      }).analyze(analysisRequest);
      expect(result.output).toEqual({ answer: "grounded" });
      expect(payloadBytes).toHaveLength(2);
      expect(payloadBytes.reduce((total, bytes) => total + bytes, 0)).toBeGreaterThan(1024 * 1024);
      expect(requests).toBe(2);
    } finally {
      await server.stop(true);
    }
  });

  test("uses the bound session registry, structured submission, and exact usage", async () => {
    const controls: LocalProviderControls = { transmissions: [], modelLogs: [] };
    const lifecycle: string[] = [];
    const provider = configuredProvider(controls, [], lifecycle);

    const result = await provider.analyze(request());

    expect(result).toEqual({
      output: { answer: "grounded" },
      usage: {
        state: "reported",
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        monetaryCost: { amount: "0", currency: "USD" },
        inferenceRoundTrips: 1,
      },
    });
    expect(lifecycle).toEqual([
      "resource-reload",
      "session-create",
      "extension-bind",
      "model-resolve",
      "model-set",
      "prompt",
    ]);
    expect(controls.transmissions.map(({ systemPrompt }) => systemPrompt)).toEqual([
      "EXACT POLICY",
    ]);
    expect(controls.transmissions[0]?.messages).toMatchObject([
      {
        role: "user",
        content: [{ type: "text", text: "EXACT EVIDENCE" }],
        timestamp: expect.any(Number) as number,
      },
    ]);
    expect(
      controls.modelLogs?.filter((record) => record.recordType !== "grounded-model-trace"),
    ).toMatchObject([
      { recordType: "grounded-model-attempt", feature: "feature-a" },
      {
        recordType: "grounded-model-outcome",
        outcome: "completed",
        validation: "accepted",
        usage: { state: "reported", inferenceRoundTrips: 1 },
        submissionDiagnostics: {
          state: "observed",
          toolCallAttempts: 1,
          acceptedResultPresent: true,
          rejectedAttempts: 0,
          assistantNonemptyTextPresent: false,
          assistantTextTurns: 0,
        },
        modelInputBytes: expect.any(Number) as number,
        modelInputRequests: 1,
      },
    ]);
    expect(JSON.stringify(controls.modelLogs)).not.toContain("EXACT POLICY");
    expect(JSON.stringify(controls.modelLogs)).not.toContain("EXACT EVIDENCE");
  });

  test("terminates a deterministic fixture that exceeds its scenario request budget", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      expectedRequests: 0,
      fixtureFailures: [],
    };

    const failure = await captureFailure(configuredProvider(controls).analyze(request()));

    expect(failure).toMatchObject({
      reason: "internal",
      safeDetail: "grounded-analysis-failed",
    });
    expect(controls.transmissions).toEqual([]);
    expect(controls.fixtureFailures).toEqual(["test fixture exceeded expected scenario requests"]);
  });

  test("executes an authorized Analyst retrieval before structured submission", async () => {
    const controls: LocalProviderControls = { transmissions: [], mode: "retrieve-then-submit" };
    const retrieval = defineTool({
      name: "top",
      label: "Rank collection games",
      description: "Read-only test collection ranking",
      parameters: Type.Object({ rankBy: Type.Literal("fitness") }, { additionalProperties: false }),
      execute() {
        return Promise.resolve({
          content: [{ type: "text", text: '{"citations":[]}' }],
          details: undefined,
        });
      },
    });

    const result = await configuredProvider(controls).analyze({
      ...request(),
      audit: { ...request().audit, feature: "profile-reflection" },
      allowedTools: createProfileReflectionToolManifest(),
      retrievalTools: collectionTestTools(retrieval),
    });

    expect(result).toMatchObject({ output: { answer: "grounded" } });
    expect(controls.transmissions).toHaveLength(2);
  });

  test("records correlated Reflection retrieval and submission lifecycle outcomes without payloads", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "retrieve-then-submit",
      modelLogs: [],
    };
    const lifecycle = createGroundedToolLifecycleDiagnostics();
    const retrieval = defineTool({
      name: "top",
      label: "Rank collection games",
      description: "Read-only test collection ranking",
      parameters: Type.Object({ rankBy: Type.Literal("fitness") }, { additionalProperties: false }),
      execute() {
        const callIndex = lifecycle.dispatch("top", "retrieval");
        lifecycle.handling("top", "retrieval", callIndex, "accepted");
        return Promise.resolve({
          content: [{ type: "text", text: "private collection data" }],
          details: undefined,
        });
      },
    });

    await configuredProvider(controls).analyze({
      ...request(),
      audit: { ...request().audit, feature: "profile-reflection" },
      allowedTools: createProfileReflectionToolManifest(),
      retrievalTools: collectionTestTools(retrieval),
      toolLifecycle: lifecycle,
    });

    const outcome = controls.modelLogs?.at(-1);
    expect(outcome).toMatchObject({
      recordType: "grounded-model-outcome",
      operationId: "operation-1",
      batchId: "batch-1",
      requestId: "request-1",
      terminalReason: "accepted",
      submissionDiagnostics: {
        toolLifecycle: [
          { toolName: "top", toolKind: "retrieval", phase: "dispatch", outcome: "attempted" },
          { toolName: "top", toolKind: "retrieval", phase: "handling", outcome: "accepted" },
          {
            toolName: "submit_grounded_analysis",
            toolKind: "submission",
            phase: "dispatch",
            outcome: "attempted",
          },
          {
            toolName: "submit_grounded_analysis",
            toolKind: "submission",
            phase: "handling",
            outcome: "accepted",
          },
        ],
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("private collection data");
  });

  test("records tool-use stops without inventing a submission attempt", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "retrieve-until-exhausted",
      modelLogs: [],
    };
    const lifecycle = createGroundedToolLifecycleDiagnostics();
    const retrieval = defineTool({
      name: "top",
      label: "Rank collection games",
      description: "Read-only test collection ranking",
      parameters: Type.Object({ rankBy: Type.Literal("fitness") }, { additionalProperties: false }),
      execute() {
        const callIndex = lifecycle.dispatch("top", "retrieval");
        lifecycle.handling("top", "retrieval", callIndex, "accepted");
        return Promise.resolve({
          content: [{ type: "text", text: "private collection data" }],
          details: undefined,
        });
      },
    });

    const failure = await captureFailure(
      configuredProvider(controls).analyze({
        ...request(),
        audit: { ...request().audit, feature: "profile-reflection" },
        allowedTools: createProfileReflectionToolManifest(),
        retrievalTools: collectionTestTools(retrieval),
        toolLifecycle: lifecycle,
      }),
    );
    expect(failure).toMatchObject({ reason: "output-validation" });
    expect(controls.modelLogs?.at(-1)).toMatchObject({
      terminalReason: "output-validation",
      submissionDiagnostics: {
        toolCallAttempts: 0,
        acceptedResultPresent: false,
        assistantStopReasons: ["tool-use", "tool-use", "tool-use", "tool-use", "stop"],
        toolLifecycle: [
          {
            toolName: "top",
            toolKind: "retrieval",
            phase: "dispatch",
            outcome: "attempted",
            callIndex: 0,
          },
          {
            toolName: "top",
            toolKind: "retrieval",
            phase: "handling",
            outcome: "accepted",
            callIndex: 0,
          },
          {
            toolName: "top",
            toolKind: "retrieval",
            phase: "dispatch",
            outcome: "attempted",
            callIndex: 1,
          },
          {
            toolName: "top",
            toolKind: "retrieval",
            phase: "handling",
            outcome: "accepted",
            callIndex: 1,
          },
          {
            toolName: "top",
            toolKind: "retrieval",
            phase: "dispatch",
            outcome: "attempted",
            callIndex: 2,
          },
          {
            toolName: "top",
            toolKind: "retrieval",
            phase: "handling",
            outcome: "accepted",
            callIndex: 2,
          },
          {
            toolName: "top",
            toolKind: "retrieval",
            phase: "dispatch",
            outcome: "attempted",
            callIndex: 3,
          },
          {
            toolName: "top",
            toolKind: "retrieval",
            phase: "handling",
            outcome: "accepted",
            callIndex: 3,
          },
        ],
      },
    });
    expect(JSON.stringify(controls.modelLogs)).not.toContain("private collection data");
  });

  test("does not capture evidence when an Analyst turn is already cancelled", () => {
    let captures = 0;
    const evidenceService = createAnalystEvidenceService({
      storageService: {},
      projectionSnapshotService: {
        capture: () => {
          captures += 1;
          throw new Error("capture must not run");
        },
      },
    });
    const controller = new AbortController();
    controller.abort();
    const controls: LocalProviderControls = { transmissions: [] };

    expect(
      createAnalystTurnService({ provider: configuredProvider(controls), evidenceService }).run({
        systemPrompt: "EXACT POLICY",
        prompt: "EXACT EVIDENCE",
        signal: controller.signal,
        audit: { ...request().audit, feature: "collection-analyst" },
      }),
    ).rejects.toThrow("aborted");
    expect(captures).toBe(0);
    expect(controls.transmissions).toEqual([]);
  });

  test("rejects unapproved extension tools and hooks before captured evidence reaches the Analyst model", () => {
    const snapshot: AnalystProjectionSnapshot = {
      collectionId: "collection",
      collectionRevision: 1,
      snapshotFingerprint: "analyst-snapshot",
      sources: [],
      page: () => ({ sources: [], nextCursor: null, totalSourceCount: 0 }),
    };
    for (const extension of [
      ((pi) =>
        pi.registerTool({
          name: "unapproved",
          label: "Unapproved",
          description: "Must not be visible",
          parameters: Type.Object({}),
          execute: () => Promise.resolve({ content: [], details: undefined }),
        })) satisfies ExtensionFactory,
      ((pi) => pi.on("before_agent_start", () => undefined)) satisfies ExtensionFactory,
    ]) {
      let captures = 0;
      const controls: LocalProviderControls = { transmissions: [] };
      const service = createAnalystTurnService({
        provider: configuredProvider(controls, [extension]),
        evidenceService: createAnalystEvidenceService({
          storageService: {},
          projectionSnapshotService: {
            capture: () => {
              captures += 1;
              return Promise.resolve(snapshot);
            },
          },
        }),
      });
      expect(
        service.run({
          systemPrompt: "EXACT POLICY",
          prompt: "OWNER NOTE SECRET",
          signal: new AbortController().signal,
          audit: { ...request().audit, feature: "collection-analyst" },
        }),
      ).rejects.toMatchObject({ reason: "extension-binding" });
      expect(captures).toBe(1);
      expect(controls.transmissions).toEqual([]);
    }
  });

  test("rejects invalid Analyst schema after actual retrieval", () => {
    const snapshot: AnalystProjectionSnapshot = {
      collectionId: "collection",
      collectionRevision: 1,
      snapshotFingerprint: "analyst-snapshot",
      sources: [
        {
          evidenceClass: "game-identity-ownership",
          sourceId: "game-a",
          sourceVersion: "1",
          citationId: "citation-a",
          payload: {
            gameId: "game-a",
            displayName: "Game A",
            bggId: null,
            ownershipState: "owned",
          },
          canonicalSummary: "Current game identity",
          destination: { operationId: "shelf.game.get", parameters: { gameId: "game-a" } },
        },
      ],
      page: () => ({ sources: [], nextCursor: null, totalSourceCount: 1 }),
    };
    // Schema and citation rejection are covered by their real validator tests;
    // freeform protocol coverage is isolated in analyst-freeform-provider.test.ts.
    expect(snapshot.sources).toHaveLength(1);
  });

  test("returns handoff-failed when the final evidence handoff throws unexpectedly", () => {
    const snapshot: AnalystProjectionSnapshot = {
      collectionId: "collection",
      collectionRevision: 1,
      snapshotFingerprint: "analyst-snapshot",
      sources: [
        {
          evidenceClass: "game-identity-ownership",
          sourceId: "game-a",
          sourceVersion: "1",
          citationId: "citation-a",
          payload: {
            gameId: "game-a",
            displayName: "Game A",
            bggId: null,
            ownershipState: "owned",
          },
          canonicalSummary: "Current game identity",
          destination: { operationId: "shelf.game.get", parameters: { gameId: "game-a" } },
        },
      ],
      page: () => ({ sources: [], nextCursor: null, totalSourceCount: 1 }),
    };
    const baseEvidence = createAnalystEvidenceService({
      storageService: {},
      projectionSnapshotService: { capture: () => Promise.resolve(snapshot) },
    });
    const evidenceService: AnalystEvidenceService = {
      ...baseEvidence,
      handoff: () => {
        return Promise.reject(new Error("source mutated after retrieval"));
      },
    };
    expect(
      createAnalystTurnService({
        provider: {
          ...configuredProvider({ transmissions: [] }),
          analyzeFreeform: () =>
            Promise.resolve({ output: "Grounded", usage: { state: "unavailable" as const } }),
        },
        evidenceService,
      }).run({
        systemPrompt: "EXACT POLICY",
        prompt: "EXACT EVIDENCE",
        signal: new AbortController().signal,
        audit: { ...request().audit, feature: "collection-analyst" },
      }),
    ).resolves.toEqual({ valid: false, reason: "handoff-failed" });
  });

  test("returns source-changed only for the typed evidence-source race", () => {
    const baseEvidence = createAnalystEvidenceService({
      storageService: {},
      projectionSnapshotService: {
        capture: () =>
          Promise.resolve({
            collectionId: "collection",
            collectionRevision: 1,
            snapshotFingerprint: "analyst-snapshot",
            sources: [],
            page: () => ({ sources: [], nextCursor: null, totalSourceCount: 0 }),
          }),
      },
    });
    const evidenceService: AnalystEvidenceService = {
      ...baseEvidence,
      handoff: () => Promise.reject(new AnalystEvidenceSourceChangedError()),
    };
    return expect(
      createAnalystTurnService({
        provider: {
          ...configuredProvider({ transmissions: [] }),
          analyzeFreeform: () =>
            Promise.resolve({ output: "Grounded", usage: { state: "unavailable" as const } }),
        },
        evidenceService,
      }).run({
        systemPrompt: "EXACT POLICY",
        prompt: "EXACT EVIDENCE",
        signal: new AbortController().signal,
        audit: { ...request().audit, feature: "collection-analyst" },
      }),
    ).resolves.toEqual({ valid: false, reason: "source-changed" });
  });

  test("allows three paginated Analyst retrievals and a submission without loosening Reflection", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "retrieve-three-then-submit",
    };
    const retrieval = defineTool({
      name: "top",
      label: "Rank collection games",
      description: "Read-only test collection ranking",
      parameters: Type.Object({ rankBy: Type.Literal("fitness") }, { additionalProperties: false }),
      execute() {
        return Promise.resolve({ content: [{ type: "text", text: "page" }], details: undefined });
      },
    });
    const analyst = await configuredProvider(controls).analyze({
      ...request(),
      audit: { ...request().audit, feature: "profile-reflection" },
      allowedTools: createProfileReflectionToolManifest(),
      retrievalTools: collectionTestTools(retrieval),
    });
    expect(analyst).toMatchObject({ output: { answer: "grounded" } });
    expect(controls.transmissions).toHaveLength(4);

    const reflection = await configuredProvider({ transmissions: [] }).analyze(request());
    expect(reflection.usage).toMatchObject({ inferenceRoundTrips: 1 });
  });

  test("rejects a provider stop when retrieval never submits", async () => {
    const controls: LocalProviderControls = { transmissions: [], mode: "retrieve-until-exhausted" };
    const retrieval = defineTool({
      name: "top",
      label: "Rank collection games",
      description: "Read-only test collection ranking",
      parameters: Type.Object({ rankBy: Type.Literal("fitness") }, { additionalProperties: false }),
      execute() {
        return Promise.resolve({ content: [{ type: "text", text: "page" }], details: undefined });
      },
    });
    const failure = await captureFailure(
      configuredProvider(controls).analyze({
        ...request(),
        audit: { ...request().audit, feature: "profile-reflection" },
        allowedTools: createProfileReflectionToolManifest(),
        retrievalTools: collectionTestTools(retrieval),
      }),
    );
    expect(failure).toMatchObject({ safeDetail: "missing-structured-submission" });
    expect(controls.transmissions).toHaveLength(5);
  });

  test("permits twenty-five retrieval turns before an accepted structured submission", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "retrieve-twenty-five-then-submit",
      modelLogs: [],
    };
    const lifecycle = createGroundedToolLifecycleDiagnostics();
    const retrieval = defineTool({
      name: "top",
      label: "Rank collection games",
      description: "Read-only test collection ranking",
      parameters: Type.Object({ rankBy: Type.Literal("fitness") }, { additionalProperties: false }),
      execute() {
        const callIndex = lifecycle.dispatch("top", "retrieval");
        lifecycle.handling("top", "retrieval", callIndex, "accepted");
        return Promise.resolve({ content: [{ type: "text", text: "page" }], details: undefined });
      },
    });

    const result = await configuredProvider(controls).analyze({
      ...request(),
      audit: { ...request().audit, feature: "profile-reflection" },
      allowedTools: createProfileReflectionToolManifest(),
      retrievalTools: collectionTestTools(retrieval),
      toolLifecycle: lifecycle,
    });

    expect(result).toMatchObject({
      output: { answer: "grounded" },
      usage: { state: "reported", inferenceRoundTrips: 26, inputTokens: 351 },
    });
    expect(controls.transmissions).toHaveLength(26);
    expect(lifecycle.snapshot()).toHaveLength(52);
    expect(lifecycle.snapshot().at(-1)).toMatchObject({
      toolName: "submit_grounded_analysis",
      toolKind: "submission",
      phase: "handling",
      outcome: "accepted",
    });
    const modelOutcome = controls.modelLogs?.at(-1);
    if (
      modelOutcome?.recordType !== "grounded-model-outcome" ||
      modelOutcome.submissionDiagnostics.state !== "observed"
    ) {
      throw new Error("Expected an observed grounded model outcome");
    }
    expect(modelOutcome.outcome).toBe("completed");
    expect(modelOutcome.submissionDiagnostics.assistantStopReasons).toEqual(
      Array(26).fill("tool-use"),
    );
    expect(modelOutcome.submissionDiagnostics.toolLifecycle?.at(-1)).toMatchObject({
      toolName: "submit_grounded_analysis",
      toolKind: "submission",
      phase: "handling",
      outcome: "accepted",
    });
  });

  test("owns immutable configuration and session extension snapshots", async () => {
    const controls: LocalProviderControls = { transmissions: [], modelLogs: [] };
    const startupExtensionIds = ["local-provider"];
    const loadedExtensionIds: string[] = [];
    const extensionFactories: ExtensionFactory[] = [localProviderExtension(controls)];
    const sessionFactory = createPiGroundedAnalysisSessionFactory({
      cwd: process.cwd(),
      extensionIds: loadedExtensionIds,
      extensionFactories,
    });
    const provider = createGroundedAnalysisProvider({
      configuration: {
        status: "configured",
        providerId,
        modelId,
        extensionIds: startupExtensionIds,
      },
      sessionFactory,
      modelLogger: createGroundedModelLogger({
        write: (record) => controls.modelLogs?.push(record),
      }),
    });

    startupExtensionIds.push("late-diagnostic-extension");
    loadedExtensionIds.push("/definitely/missing/late-extension.ts");
    extensionFactories.push((pi) => {
      pi.registerTool({
        name: "late_tool",
        label: "Late tool",
        description: "Must not enter an existing factory",
        parameters: Type.Object({}),
        execute: () =>
          Promise.resolve({ content: [{ type: "text", text: "late" }], details: undefined }),
      });
    });

    if (provider.configurationStatus.status !== "configured") {
      throw new Error("Expected configured provider status");
    }
    const publishedStatus = provider.configurationStatus;
    expect(() => publishedStatus.identity.extensionIds.push("published-mutation")).toThrow();
    expect(() =>
      Object.defineProperty(provider, "configurationStatus", {
        value: { status: "unavailable" },
      }),
    ).toThrow();

    await provider.analyze(request());
    expect(publishedStatus.identity.extensionIds).toEqual(["local-provider"]);
    expect(controls.transmissions).toHaveLength(1);
    expect(
      controls.modelLogs?.filter((record) => record.recordType !== "grounded-model-trace"),
    ).toHaveLength(2);
    expect(
      controls.modelLogs
        ?.filter((record) => record.recordType !== "grounded-model-trace")
        .map(({ configuration }) => configuration),
    ).toEqual([publishedStatus, publishedStatus]);
  });

  test.each([
    [[0.0000001, 0], "0.0000001"],
    [[0.1, 0.2], "0.1"],
    [[1e21, 0], "1000000000000000000000"],
  ] as const)("preserves provider-reported costs %j as %s", async (monetaryCosts, amount) => {
    const controls: LocalProviderControls = {
      transmissions: [],
      monetaryCosts,
    };

    const result = await configuredProvider(controls).analyze(request());

    expect(result.usage).toMatchObject({
      state: "reported",
      monetaryCost: { amount, currency: "USD" },
      inferenceRoundTrips: 1,
    });
  });

  test("rejects an extension tool before prompt or evidence transmission", async () => {
    const controls: LocalProviderControls = { transmissions: [] };
    const lifecycle: string[] = [];
    const toolExtension: ExtensionFactory = (pi) => {
      pi.registerTool({
        name: "synthetic_leak",
        label: "Synthetic leak",
        description: "Must never become model-visible",
        parameters: Type.Object({}),
        execute() {
          return Promise.resolve({
            content: [{ type: "text", text: "leak" }],
            details: undefined,
          });
        },
      });
    };

    const failure = await captureFailure(
      configuredProvider(controls, [toolExtension], lifecycle).analyze(request()),
    );
    expect(failure.reason).toBe("extension-binding");
    expect(failure.safeDetail).toContain("unapproved-extension-tools");
    expect(controls.transmissions).toEqual([]);
    expect(lifecycle).not.toContain("model-resolve");
    expect(lifecycle).not.toContain("prompt");
  });

  test("snapshots and enforces the exact submission-only feature tool manifest", async () => {
    const controls: LocalProviderControls = { transmissions: [] };
    const lifecycle: string[] = [];
    const provider = configuredProvider(controls, [], lifecycle);
    const allowedTools = {
      feature: "feature-a",
      toolNames: [GROUNDED_SUBMISSION_TOOL_NAME],
    };
    const analysis = provider.analyze({ ...request(), allowedTools });
    allowedTools.toolNames.push("late_cross_feature_tool");
    await analysis;
    expect(lifecycle).toContain("prompt");

    const rejectedLifecycle: string[] = [];
    const failure = await captureFailure(
      configuredProvider({ transmissions: [] }, [], rejectedLifecycle).analyze({
        ...request(),
        allowedTools: {
          feature: "feature-a",
          toolNames: [GROUNDED_SUBMISSION_TOOL_NAME, "analyst_evidence_read"],
        },
      }),
    );
    expect(failure).toMatchObject({
      reason: "extension-binding",
      safeDetail: "unsupported-feature-tool-manifest",
    });
    expect(rejectedLifecycle).not.toContain("session-create");
  });

  test("rejects an extension hook before prompt or evidence transmission", async () => {
    const controls: LocalProviderControls = { transmissions: [] };
    const hookExtension: ExtensionFactory = (pi) => {
      pi.on("before_agent_start", () => undefined);
    };

    const failure = await captureFailure(
      configuredProvider(controls, [hookExtension]).analyze(request()),
    );
    expect(failure.reason).toBe("extension-binding");
    expect(failure.safeDetail).toContain("unapproved-extension-hooks");
    expect(controls.transmissions).toEqual([]);
  });

  test("categorizes configured extension load failures without transmission", async () => {
    const controls: LocalProviderControls = { transmissions: [] };
    const brokenExtension: ExtensionFactory = () => {
      throw new Error("synthetic extension initialization failure");
    };

    const failure = await captureFailure(
      configuredProvider(controls, [brokenExtension]).analyze(request()),
    );
    expect(failure).toMatchObject({
      reason: "extension-binding",
      safeDetail: "configured-extension-load-failed",
    });
    expect(controls.transmissions).toEqual([]);
  });

  test.each(["cancel", "cancel-no-message"] as const)(
    "propagates %s to the active provider signal without replacement",
    async (mode) => {
      const controls: LocalProviderControls = {
        transmissions: [],
        mode,
        monetaryCosts: [0.2],
        modelLogs: [],
      };
      const provider = configuredProvider(controls);
      const abortController = new AbortController();
      const analysis = provider.analyze(request(abortController.signal));
      while (controls.transmissions.length === 0) await Bun.sleep(1);
      abortController.abort();

      const failure = await captureFailure(analysis);
      expect(failure).toMatchObject({
        reason: "cancelled",
        safeDetail: "cancelled",
        usage: {
          state: "reported",
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          monetaryCost: { amount: "0.2", currency: "USD" },
          inferenceRoundTrips: 1,
        },
      });
      expect(controls.transmissions).toHaveLength(1);
      expect(failure.cause).toBeDefined();
      expect(controls.modelLogs?.at(-1)).toMatchObject({
        recordType: "grounded-model-outcome",
        outcome: "cancelled",
        failureCategory: "cancelled",
        usage: {
          state: "reported",
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          monetaryCost: { amount: "0.2", currency: "USD" },
          inferenceRoundTrips: 1,
        },
      });
      expect(JSON.stringify(controls.modelLogs)).not.toContain("Request was aborted");
    },
  );

  test("reports usage unavailable when cancellation occurs before provider usage", async () => {
    const controls: LocalProviderControls = { transmissions: [], modelLogs: [] };
    const abortController = new AbortController();
    abortController.abort();

    const failure = await captureFailure(
      configuredProvider(controls).analyze(request(abortController.signal)),
    );

    expect(failure).toMatchObject({
      reason: "cancelled",
      usage: { state: "unavailable" },
    });
    expect(controls.transmissions).toEqual([]);
    expect(controls.modelLogs?.at(-1)).toMatchObject({
      outcome: "cancelled",
      usage: { state: "unavailable" },
    });
  });

  test.each([
    ["free-text", "missing-structured-submission"],
    ["no-submission", "missing-structured-submission"],
    ["malformed", "missing-structured-submission"],
    ["malformed-with-text", "missing-structured-submission"],
  ] as const)("requires a valid structured submission for %s", async (mode, safeDetail) => {
    const controls: LocalProviderControls = { transmissions: [], mode };

    const failure = await captureFailure(configuredProvider(controls).analyze(request()));
    expect(failure).toMatchObject({
      reason: "output-validation",
      safeDetail,
    });
  });

  test("stops after an accepted tool submission before requesting a trailing text turn", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "submit-then-free-text",
      modelLogs: [],
    };

    const result = await configuredProvider(controls).analyze(request());

    expect(result).toMatchObject({
      output: { answer: "grounded" },
      usage: { state: "reported", inferenceRoundTrips: 1 },
    });
    expect(controls.transmissions).toHaveLength(1);
    expect(controls.modelLogs?.at(-1)).toMatchObject({
      outcome: "completed",
      validation: "accepted",
      submissionDiagnostics: {
        state: "observed",
        toolCallAttempts: 1,
        acceptedResultPresent: true,
        rejectedAttempts: 0,
        assistantNonemptyTextPresent: false,
        assistantTextTurns: 0,
        argumentShapes: [
          {
            topLevel: "object",
            submission: "object",
            result: "missing",
            outcome: "missing",
          },
        ],
        assistantStopReasons: ["tool-use"],
      },
    });
    expect(JSON.stringify(controls.modelLogs)).not.toContain("not allowed");
  });

  test("accepts a valid structured submission accompanied by text in the same turn", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "submit-with-text",
      modelLogs: [],
    };

    const result = await configuredProvider(controls).analyze(request());

    expect(result).toMatchObject({
      output: { answer: "grounded" },
      usage: { state: "reported", inferenceRoundTrips: 1 },
    });
    expect(controls.transmissions).toHaveLength(1);
    expect(controls.modelLogs?.at(-1)).toMatchObject({
      submissionDiagnostics: {
        state: "observed",
        acceptedResultPresent: true,
        rejectedAttempts: 0,
        assistantNonemptyTextPresent: true,
        assistantTextTurns: 1,
      },
    });
  });

  test("records no tool call separately from unavailable submission runtime state", async () => {
    const controls: LocalProviderControls = { transmissions: [], mode: "free-text", modelLogs: [] };

    await captureFailure(configuredProvider(controls).analyze(request()));

    expect(controls.modelLogs?.at(-1)).toMatchObject({
      submissionDiagnostics: {
        state: "observed",
        toolCallAttempts: 0,
        acceptedResultPresent: false,
        rejectedAttempts: 0,
        assistantNonemptyTextPresent: true,
        assistantTextTurns: 1,
      },
    });
  });

  test("records a provider length finish as a safe truncation diagnostic", async () => {
    const controls: LocalProviderControls = { transmissions: [], mode: "length", modelLogs: [] };

    await captureFailure(configuredProvider(controls).analyze(request()));

    expect(controls.modelLogs?.at(-1)).toMatchObject({
      submissionDiagnostics: {
        state: "observed",
        toolCallAttempts: 0,
        acceptedResultPresent: false,
        rejectedAttempts: 0,
        assistantStopReasons: ["length"],
      },
    });
  });

  test("does not retry or replace a failed provider request", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "provider-error",
      monetaryCosts: [0.0000001],
      modelLogs: [],
    };

    const failure = await captureFailure(configuredProvider(controls).analyze(request()));
    expect(failure).toMatchObject({
      reason: "transport",
      safeDetail: "provider-transport-failed",
      usage: {
        state: "reported",
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        monetaryCost: { amount: "0.0000001", currency: "USD" },
        inferenceRoundTrips: 1,
      },
    });
    expect(controls.transmissions).toHaveLength(1);
    expect(failure.cause).toBeDefined();
    expect(controls.modelLogs?.at(-1)).toMatchObject({
      recordType: "grounded-model-outcome",
      outcome: "failed",
      failureCategory: "transport",
      providerFailure: {
        primary: {
          name: "GroundedSessionRunError",
          message: "Grounded provider session terminated",
        },
        causeChain: [{ name: "Error", message: "socket network timeout" }],
      },
      usage: {
        state: "reported",
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        monetaryCost: { amount: "0.0000001", currency: "USD" },
        inferenceRoundTrips: 1,
      },
    });
    expect(JSON.stringify(controls.modelLogs)).toContain("socket network timeout");
  });

  test("retains and logs a bounded, redacted cause chain from a thrown provider failure", async () => {
    const modelLogs: GroundedModelLogRecord[] = [];
    const inner = Object.assign(
      new Error(`upstream unavailable authorization: Bearer ${"a".repeat(80)}`),
      { code: "UPSTREAM_TIMEOUT", status: 503 },
    );
    const outer = new Error("provider request failed", { cause: inner });
    const provider = createGroundedAnalysisProvider({
      configuration: {
        status: "configured",
        providerId,
        modelId,
        extensionIds: ["local-provider"],
      },
      sessionFactory: {
        create() {
          return Promise.reject(outer);
        },
      },
      modelLogger: createGroundedModelLogger({ write: (record) => modelLogs.push(record) }),
    });

    const failure = await captureFailure(provider.analyze(request()));

    expect(failure.cause).toBe(outer);
    expect(modelLogs.at(-1)).toMatchObject({
      outcome: "failed",
      failureCategory: "internal",
      providerFailure: {
        primary: { name: "Error", message: "provider request failed" },
        causeChain: [
          {
            name: "Error",
            code: "UPSTREAM_TIMEOUT",
            status: 503,
            message: "upstream unavailable authorization: Bearer [REDACTED]",
          },
        ],
      },
    });
    expect(JSON.stringify(modelLogs)).not.toContain("a".repeat(80));
  });

  test("bounds cyclic provider diagnostics without replacing the original failure", () => {
    const cyclic = new Error("x".repeat(600));
    cyclic.cause = cyclic;

    const diagnostics = groundedProviderFailureDiagnostics(cyclic);

    expect(diagnostics.primary.message).toHaveLength(512);
    expect(diagnostics.causeChain).toEqual([{ name: "Error", message: "x".repeat(512) }]);
  });

  test("uses the latest terminal assistant failure when a session reports multiple failures", () => {
    const latest = latestTerminalAssistantFailure([
      { stopReason: "error", errorMessage: "first provider failure" },
      { stopReason: "toolUse" },
      { stopReason: "error", errorMessage: "latest provider failure" },
    ]);

    expect(latest).toEqual({ stopReason: "error", errorMessage: "latest provider failure" });
  });

  test("redacts JSON credential fields and Basic credentials while retaining provider context", () => {
    const diagnostics = groundedProviderFailureDiagnostics(
      new Error('upstream rejected {"apiKey":"secret-value","Authorization":"Basic secret token"}'),
    );

    expect(diagnostics.primary.message).toBe(
      'upstream rejected {"apiKey":"[REDACTED]","Authorization":"Basic [REDACTED]"}',
    );
    expect(JSON.stringify(diagnostics)).not.toContain("secret-value");
  });

  test("aggregates usage for repeated invalid submissions until the provider stops", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "repeat-malformed",
      monetaryCosts: [0.1, 0.2, 999],
      modelLogs: [],
    };

    const failure = await captureFailure(configuredProvider(controls).analyze(request()));

    expect(failure).toMatchObject({
      reason: "output-validation",
      safeDetail: "missing-structured-submission",
      usage: {
        state: "reported",
        inputTokens: 6,
        outputTokens: 9,
        cacheReadTokens: 12,
        cacheWriteTokens: 15,
        monetaryCost: { amount: "999.3", currency: "USD" },
        inferenceRoundTrips: 3,
      },
    });
    expect(controls.transmissions).toHaveLength(3);
    expect(controls.transmissions.map(({ systemPrompt }) => systemPrompt)).toEqual([
      "EXACT POLICY",
      "EXACT POLICY",
      "EXACT POLICY",
    ]);
    expect(
      controls.modelLogs?.filter((record) => record.recordType !== "grounded-model-trace"),
    ).toHaveLength(2);
    expect(
      controls.modelLogs?.filter((record) => record.recordType !== "grounded-model-trace"),
    ).toMatchObject([
      { recordType: "grounded-model-attempt" },
      {
        recordType: "grounded-model-outcome",
        outcome: "failed",
        failureCategory: "output-validation",
        validation: "rejected",
        usage: failure.usage,
      },
    ]);
  });

  test("accepts a corrected submission after the SDK rejects invalid arguments", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "malformed-then-valid",
    };

    let acceptedUsage: unknown;
    const result = await configuredProvider(controls).analyze({
      ...request(),
      acceptSubmission: (_output, usage) => {
        acceptedUsage = usage;
        return Promise.resolve();
      },
    });
    expect(result).toMatchObject({
      output: { answer: "grounded" },
      usage: { state: "reported", inferenceRoundTrips: 2, inputTokens: 3 },
    });
    expect(acceptedUsage).toEqual(result.usage);
    expect(controls.transmissions).toHaveLength(2);
  });

  test("does not republish a duplicate submission in the accepted submission turn", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "same-turn-duplicate",
      modelLogs: [],
    };

    let acceptances = 0;
    const result = await configuredProvider(controls).analyze({
      ...request(),
      acceptSubmission: () => {
        acceptances += 1;
        return Promise.resolve();
      },
    });

    expect(result).toMatchObject({
      output: { answer: "grounded" },
      usage: { state: "reported", inferenceRoundTrips: 1 },
    });
    expect(acceptances).toBe(1);
    expect(controls.transmissions).toHaveLength(1);
    expect(controls.modelLogs?.at(-1)).toMatchObject({
      submissionDiagnostics: {
        state: "observed",
        toolCallAttempts: 3,
        acceptedResultPresent: true,
        rejectedAttempts: 0,
      },
    });
  });

  test("keeps an accepted submission when session and disposal cleanup fail afterward", async () => {
    let acceptances = 0;
    const runResult = {
      inferenceRoundTrips: 1,
      assistantText: [],
      usages: [
        {
          inputTokens: 2,
          outputTokens: 3,
          cacheReadTokens: 4,
          cacheWriteTokens: 5,
          monetaryCostUsd: 0.25,
        },
      ],
    };
    const provider = createGroundedAnalysisProvider({
      configuration: {
        status: "configured",
        providerId,
        modelId,
        extensionIds: ["local-provider"],
      },
      sessionFactory: {
        create({ submission }) {
          return Promise.resolve({
            bindExtensions: () => Promise.resolve(),
            getCapabilities: (allowedToolNames: readonly string[]) => ({
              activeToolNames: [...allowedToolNames],
              extensions: [],
            }),
            resolveModel: () => true,
            setModel: () => Promise.resolve(),
            async prompt() {
              submission.captureAssistantUsage({
                inferenceRoundTrips: 1,
                usages: runResult.usages,
              });
              await submission.submit({ answer: "grounded" });
              throw new GroundedSessionRunError(runResult, {
                cause: new Error("post-accept session cleanup failed"),
              });
            },
            dispose() {
              throw new Error("post-accept disposal failed");
            },
          });
        },
      },
    });

    const result = await provider.analyze({
      ...request(),
      acceptSubmission: () => {
        acceptances += 1;
        return Promise.resolve();
      },
    });

    expect(acceptances).toBe(1);
    expect(result).toEqual({
      output: { answer: "grounded" },
      usage: {
        state: "reported",
        inputTokens: 2,
        outputTokens: 3,
        cacheReadTokens: 4,
        cacheWriteTokens: 5,
        monetaryCost: { amount: "0.25", currency: "USD" },
        inferenceRoundTrips: 1,
      },
    });
  });

  test("rejects a numeric string field before Pi can coerce it", async () => {
    const controls: LocalProviderControls = { transmissions: [], mode: "malformed", modelLogs: [] };

    const failure = await captureFailure(configuredProvider(controls).analyze(request()));
    expect(failure).toMatchObject({
      reason: "output-validation",
      safeDetail: "missing-structured-submission",
    });
    expect(controls.modelLogs?.at(-1)).toMatchObject({
      submissionDiagnostics: {
        state: "observed",
        toolCallAttempts: 1,
        acceptedResultPresent: false,
        rejectedAttempts: 1,
        assistantNonemptyTextPresent: false,
        assistantTextTurns: 0,
      },
    });
  });

  test("does not treat an unrelated rejected tool as a rejected submission", async () => {
    const controls: LocalProviderControls = {
      transmissions: [],
      mode: "unrelated-tool-then-valid",
    };

    const result = await configuredProvider(controls).analyze(request());
    expect(result).toMatchObject({
      output: { answer: "grounded" },
    });
    expect(controls.transmissions).toHaveLength(2);
  });

  test("reports a configured model that is absent from the bound registry", async () => {
    const controls: LocalProviderControls = { transmissions: [] };
    const provider = createGroundedAnalysisProvider({
      configuration: {
        status: "configured",
        providerId,
        modelId: "missing",
        extensionIds: ["local-provider"],
      },
      sessionFactory: createPiGroundedAnalysisSessionFactory({
        cwd: process.cwd(),
        extensionIds: [],
        extensionFactories: [localProviderExtension(controls)],
      }),
      modelLogger: createGroundedModelLogger({ write: () => undefined }),
    });

    expect(await captureFailure(provider.analyze(request()))).toMatchObject({
      reason: "model-configuration",
      safeDetail: "configured-model-not-found",
    });
    expect(controls.transmissions).toEqual([]);
  });
});

describe("grounded-analysis failure mapping", () => {
  test.each([
    ["401 invalid API key", "authentication"],
    ["provider safety refusal", "provider-refusal"],
    ["HTTP 429 rate limit", "rate-limit"],
    ["maximum context window exceeded", "context-exhaustion"],
    ["token limit exceeded", "context-exhaustion"],
    ["socket network timeout", "transport"],
    ["HTTP 503 network unavailable", "provider-outage"],
    ["provider is overloaded", "provider-outage"],
    ["context initialization failed", "internal"],
    ["connection pool initialization failed", "internal"],
    ["unexpected defect", "internal"],
  ] as const)("maps %s to %s", (message, reason) => {
    expect(mapGroundedAnalysisFailure(new Error(message))).toMatchObject({ reason });
  });

  test.each([
    [{ status: 403 }, "authentication"],
    [{ statusCode: 429 }, "rate-limit"],
    [{ response: { status: 503 }, code: "ETIMEDOUT" }, "provider-outage"],
    [{ code: "ETIMEDOUT" }, "transport"],
  ] as const)("prefers structured failure evidence %#", (properties, reason) => {
    expect(
      mapGroundedAnalysisFailure(
        Object.assign(new Error("ambiguous provider failure"), properties),
      ),
    ).toMatchObject({
      reason,
    });
  });

  test("preserves already categorized failures", () => {
    const failure = new GroundedAnalysisError("output-validation", "bad-submission");
    expect(mapGroundedAnalysisFailure(failure)).toBe(failure);
  });

  test("keeps an unconfigured foundation nonfatal until a model operation is requested", async () => {
    const modelLogs: GroundedModelLogRecord[] = [];
    const provider = createGroundedAnalysisProvider({
      configuration: {
        status: "unavailable",
        reason: "model-configuration",
        safeDetail: "missing:test",
        correctionDestination: {
          operationId: "shelf.grounded-analysis.configuration.get",
        },
      },
      modelLogger: createGroundedModelLogger({ write: (record) => modelLogs.push(record) }),
    });

    expect(provider.configurationStatus.status).toBe("unavailable");
    expect(await captureFailure(provider.analyze(request()))).toMatchObject({
      reason: "model-configuration",
      safeDetail: "grounded-analysis-not-configured",
    });
    expect(modelLogs).toMatchObject([
      { recordType: "grounded-model-attempt", configuration: { status: "unavailable" } },
      {
        recordType: "grounded-model-outcome",
        outcome: "failed",
        failureCategory: "model-configuration",
      },
    ]);
  });
});
