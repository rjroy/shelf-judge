import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionFactory,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { GroundedSessionCapabilities } from "./capability-inspection.js";
import { GroundedAnalysisError } from "./failure-mapping.js";
import type { GroundedStructuredSubmission } from "./structured-submission.js";

export type GroundedSessionLifecycleStage =
  | "resource-reload"
  | "session-create"
  | "extension-bind"
  | "model-resolve"
  | "model-set"
  | "prompt";

export interface GroundedAssistantUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  monetaryCostUsd: number;
}

export interface GroundedSessionRunResult {
  inferenceRoundTrips: number;
  assistantText: readonly string[];
  usages: readonly GroundedAssistantUsage[];
}

export const GROUNDED_MAX_INFERENCE_ROUND_TRIPS = 2;

export class GroundedSessionRunError extends Error {
  constructor(
    readonly runResult: GroundedSessionRunResult,
    options?: ErrorOptions,
  ) {
    super("Grounded provider session terminated", options);
    this.name = "GroundedSessionRunError";
  }
}

export interface GroundedAnalysisSession {
  bindExtensions(): Promise<void>;
  getCapabilities(allowedToolNames: readonly string[]): GroundedSessionCapabilities;
  resolveModel(providerId: string, modelId: string): boolean;
  setModel(): Promise<void>;
  prompt(prompt: string, signal: AbortSignal): Promise<GroundedSessionRunResult>;
  dispose(): void;
}

export interface GroundedAnalysisSessionFactory {
  create<Output>(input: {
    systemPrompt: string;
    submission: GroundedStructuredSubmission<Output>;
  }): Promise<GroundedAnalysisSession>;
}

export interface PiGroundedAnalysisSessionFactoryOptions {
  cwd: string;
  extensionIds: readonly string[];
  agentDir?: string;
  extensionFactories?: readonly ExtensionFactory[];
  onLifecycleStage?: (stage: GroundedSessionLifecycleStage) => void;
}

function isAssistantMessage(
  message: AgentMessage,
): message is Extract<AgentMessage, { role: "assistant" }> {
  return message.role === "assistant";
}

function extensionCapabilities(
  extensionsResult: LoadExtensionsResult,
  exactPromptHandler: (...args: unknown[]) => unknown,
) {
  return extensionsResult.extensions.map((extension) => ({
    extensionId: extension.path,
    toolNames: [...extension.tools.keys()].sort(),
    hookNames: [...extension.handlers.entries()]
      .filter(([, handlers]) => handlers.some((handler) => handler !== exactPromptHandler))
      .map(([hookName]) => hookName)
      .sort(),
    hasContextTransformer:
      extension.handlers.get("context")?.some((handler) => handler !== exactPromptHandler) ?? false,
  }));
}

function createBoundSession(
  session: AgentSession,
  extensionsResult: LoadExtensionsResult,
  lifecycle: (stage: GroundedSessionLifecycleStage) => void,
  exactPromptHandler: (...args: unknown[]) => unknown,
): GroundedAnalysisSession {
  let extensionsBound = false;
  let resolvedModel: Model<Api> | undefined;

  return {
    async bindExtensions() {
      lifecycle("extension-bind");
      try {
        await session.bindExtensions({});
      } catch (error) {
        throw new GroundedAnalysisError("extension-binding", "configured-extension-bind-failed", {
          cause: error,
        });
      }
      extensionsBound = true;
    },
    getCapabilities(allowedToolNames) {
      if (!extensionsBound)
        throw new Error("Extensions must be bound before capability inspection");
      session.setActiveToolsByName([...allowedToolNames]);
      return {
        activeToolNames: session.getActiveToolNames(),
        extensions: extensionCapabilities(extensionsResult, exactPromptHandler),
      };
    },
    resolveModel(providerId, modelId) {
      if (!extensionsBound) throw new Error("Extensions must be bound before model resolution");
      lifecycle("model-resolve");
      resolvedModel = session.modelRuntime.getModel(providerId, modelId);
      return resolvedModel !== undefined;
    },
    async setModel() {
      if (!resolvedModel) throw new Error("Configured model has not been resolved");
      lifecycle("model-set");
      await session.setModel(resolvedModel);
    },
    async prompt(prompt, signal) {
      if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
      const assistantMessages: Array<Extract<AgentMessage, { role: "assistant" }>> = [];
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "message_end" && isAssistantMessage(event.message)) {
          assistantMessages.push(event.message);
        }
      });
      const previousShouldStopAfterTurn = session.agent.shouldStopAfterTurn;
      session.agent.shouldStopAfterTurn = async (context, activeSignal) => {
        if (await previousShouldStopAfterTurn?.(context, activeSignal)) return true;
        return assistantMessages.length >= GROUNDED_MAX_INFERENCE_ROUND_TRIPS;
      };
      const abort = () => void session.abort();
      signal.addEventListener("abort", abort, { once: true });
      lifecycle("prompt");
      let promptFailure: unknown;
      try {
        await session.prompt(prompt, { expandPromptTemplates: false });
        if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
      } catch (error) {
        promptFailure = error;
      } finally {
        session.agent.shouldStopAfterTurn = previousShouldStopAfterTurn;
        signal.removeEventListener("abort", abort);
        unsubscribe();
      }

      const runResult = {
        inferenceRoundTrips: assistantMessages.length,
        assistantText: assistantMessages.flatMap((message) =>
          message.content
            .filter(
              (content): content is Extract<(typeof message.content)[number], { type: "text" }> =>
                content.type === "text",
            )
            .map(({ text }) => text),
        ),
        usages: assistantMessages.map(({ usage }) => ({
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadTokens: usage.cacheRead,
          cacheWriteTokens: usage.cacheWrite,
          monetaryCostUsd: usage.cost.total,
        })),
      };
      const failedMessage = assistantMessages.find(
        (message) => message.stopReason === "error" || message.stopReason === "aborted",
      );
      if (promptFailure !== undefined || failedMessage) {
        const cause =
          failedMessage?.stopReason === "aborted"
            ? new DOMException("The operation was aborted", "AbortError")
            : failedMessage?.errorMessage
              ? new Error(failedMessage.errorMessage)
              : promptFailure;
        throw new GroundedSessionRunError(runResult, { cause });
      }

      return runResult;
    },
    dispose() {
      session.dispose();
    },
  };
}

export function createPiGroundedAnalysisSessionFactory(
  options: PiGroundedAnalysisSessionFactoryOptions,
): GroundedAnalysisSessionFactory {
  const lifecycle = options.onLifecycleStage ?? (() => undefined);
  const cwd = options.cwd;
  const agentDir = options.agentDir ?? getAgentDir();
  const extensionIds = Object.freeze([...options.extensionIds]);
  const extensionFactories = Object.freeze([...(options.extensionFactories ?? [])]);
  return {
    async create({ systemPrompt, submission }) {
      const settingsManager = SettingsManager.inMemory({
        packages: [],
        extensions: [],
        retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
        compaction: { enabled: false },
      });
      const exactPromptHandler = () => ({ systemPrompt });
      const exactPromptExtension: ExtensionFactory = (pi) => {
        pi.on("before_agent_start", exactPromptHandler);
      };
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        additionalExtensionPaths: [...extensionIds],
        extensionFactories: [exactPromptExtension, ...extensionFactories],
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      lifecycle("resource-reload");
      try {
        await loader.reload();
      } catch (error) {
        throw new GroundedAnalysisError("extension-binding", "configured-extension-load-failed", {
          cause: error,
        });
      }
      const extensionsResult = loader.getExtensions();
      if (extensionsResult.errors.length > 0) {
        throw new GroundedAnalysisError("extension-binding", "configured-extension-load-failed");
      }

      lifecycle("session-create");
      const { session } = await createAgentSession({
        cwd,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager,
        noTools: "builtin",
        customTools: [submission.tool],
      });
      return createBoundSession(session, extensionsResult, lifecycle, exactPromptHandler);
    },
  };
}
