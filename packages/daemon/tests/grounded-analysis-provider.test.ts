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
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import {
  GroundedAnalysisError,
  mapGroundedAnalysisFailure,
} from "../src/services/grounded-analysis/failure-mapping.js";
import { createGroundedAnalysisProvider } from "../src/services/grounded-analysis/provider.js";
import {
  createGroundedModelLogger,
  type GroundedModelLogRecord,
} from "../src/services/grounded-analysis/model-logger.js";
import { createPiGroundedAnalysisSessionFactory } from "../src/services/grounded-analysis/session-factory.js";
import {
  createGroundedSubmissionOnlyToolManifest,
  GROUNDED_SUBMISSION_TOOL_NAME,
} from "../src/services/grounded-analysis/structured-submission.js";

const providerId = "shelf-judge-local";
const modelId = "deterministic-v1";
const submissionSchema = z.object({ answer: z.string() }).strict();

interface LocalProviderControls {
  transmissions: Array<{ systemPrompt: string; messages: Context["messages"] }>;
  mode?:
    | "submit"
    | "cancel"
    | "free-text"
    | "no-submission"
    | "malformed"
    | "provider-error"
    | "cancel-no-message"
    | "repeat-malformed"
    | "repeat-duplicate";
  monetaryCosts?: readonly number[];
  modelLogs?: GroundedModelLogRecord[];
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
        controls.transmissions.push({
          systemPrompt: context.systemPrompt ?? "",
          messages: structuredClone(context.messages),
        });
        void options?.onPayload?.({ context }, model);
        const roundTrip = controls.transmissions.length;
        const monetaryCostUsd = controls.monetaryCosts?.[roundTrip - 1] ?? 0;

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
          if (
            (!hasToolResult || repeatedSubmission) &&
            controls.mode !== "no-submission" &&
            controls.mode !== "free-text"
          ) {
            const toolCall: ToolCall = {
              type: "toolCall",
              id: `submission-${roundTrip}`,
              name: "submit_grounded_analysis",
              arguments: {
                submission: {
                  answer:
                    controls.mode === "malformed" || controls.mode === "repeat-malformed"
                      ? 42
                      : "grounded",
                },
              },
            };
            const message = assistantMessage(
              model,
              [toolCall],
              "toolUse",
              roundTrip,
              monetaryCostUsd,
            );
            stream.push({ type: "start", partial: message });
            stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
            stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
            stream.push({ type: "done", reason: "toolUse", message });
            stream.end();
            return;
          }

          const content =
            controls.mode === "free-text" ? [{ type: "text" as const, text: "not allowed" }] : [];
          const message = assistantMessage(model, content, "stop", roundTrip, monetaryCostUsd);
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
  test("uses the bound session registry, structured submission, and exact usage", async () => {
    const controls: LocalProviderControls = { transmissions: [], modelLogs: [] };
    const lifecycle: string[] = [];
    const provider = configuredProvider(controls, [], lifecycle);

    const result = await provider.analyze(request());

    expect(result).toEqual({
      output: { answer: "grounded" },
      usage: {
        state: "reported",
        inputTokens: 3,
        outputTokens: 5,
        cacheReadTokens: 7,
        cacheWriteTokens: 9,
        monetaryCost: { amount: "0", currency: "USD" },
        inferenceRoundTrips: 2,
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
      "EXACT POLICY",
    ]);
    expect(controls.transmissions[0]?.messages).toMatchObject([
      {
        role: "user",
        content: [{ type: "text", text: "EXACT EVIDENCE" }],
        timestamp: expect.any(Number) as number,
      },
    ]);
    expect(controls.modelLogs).toMatchObject([
      { recordType: "grounded-model-attempt", feature: "feature-a" },
      {
        recordType: "grounded-model-outcome",
        outcome: "completed",
        validation: "accepted",
        usage: { state: "reported", inferenceRoundTrips: 2 },
      },
    ]);
    expect(JSON.stringify(controls.modelLogs)).not.toContain("EXACT POLICY");
    expect(JSON.stringify(controls.modelLogs)).not.toContain("EXACT EVIDENCE");
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
    expect(controls.transmissions).toHaveLength(2);
    expect(controls.modelLogs).toHaveLength(2);
    expect(controls.modelLogs?.map(({ configuration }) => configuration)).toEqual([
      publishedStatus,
      publishedStatus,
    ]);
  });

  test.each([
    [[0.0000001, 0], "0.0000001"],
    [[0.1, 0.2], "0.3"],
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
      inferenceRoundTrips: 2,
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
      expect(failure.cause).toBeUndefined();
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
    ["free-text", "free-form-model-output"],
    ["no-submission", "missing-structured-submission"],
    ["malformed", "invalid-structured-submission"],
  ] as const)("rejects %s instead of accepting final text", async (mode, safeDetail) => {
    const controls: LocalProviderControls = { transmissions: [], mode };

    const failure = await captureFailure(configuredProvider(controls).analyze(request()));
    expect(failure).toMatchObject({
      reason: "output-validation",
      safeDetail,
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
    expect(failure.cause).toBeUndefined();
    expect(controls.modelLogs?.at(-1)).toMatchObject({
      recordType: "grounded-model-outcome",
      outcome: "failed",
      failureCategory: "transport",
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
    expect(JSON.stringify(controls.modelLogs)).not.toContain("socket network timeout");
  });

  test.each(["repeat-malformed", "repeat-duplicate"] as const)(
    "stops %s tool behavior before a third provider transmission",
    async (mode) => {
      const controls: LocalProviderControls = {
        transmissions: [],
        mode,
        monetaryCosts: [0.1, 0.2, 999],
        modelLogs: [],
      };

      const failure = await captureFailure(configuredProvider(controls).analyze(request()));
      await Bun.sleep(10);

      expect(failure).toMatchObject({
        reason: "output-validation",
        safeDetail: "invalid-structured-submission",
        usage: {
          state: "reported",
          inputTokens: 3,
          outputTokens: 5,
          cacheReadTokens: 7,
          cacheWriteTokens: 9,
          monetaryCost: { amount: "0.3", currency: "USD" },
          inferenceRoundTrips: 2,
        },
      });
      expect(controls.transmissions).toHaveLength(2);
      expect(controls.transmissions.map(({ systemPrompt }) => systemPrompt)).toEqual([
        "EXACT POLICY",
        "EXACT POLICY",
      ]);
      expect(controls.modelLogs).toHaveLength(2);
      expect(controls.modelLogs).toMatchObject([
        { recordType: "grounded-model-attempt" },
        {
          recordType: "grounded-model-outcome",
          outcome: "failed",
          failureCategory: "output-validation",
          validation: "rejected",
          usage: failure.usage,
        },
      ]);
    },
  );

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
