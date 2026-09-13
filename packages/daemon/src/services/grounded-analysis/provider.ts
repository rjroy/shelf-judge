import {
  GroundedProviderUsageSchema,
  GroundedUsageUnavailableSchema,
  type GroundedProviderConfigurationStatus,
  type GroundedProviderUsage,
  type GroundedUsageUnavailable,
} from "@shelf-judge/shared";
import type { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  assertGroundedSessionCapabilities,
  GroundedCapabilityError,
  snapshotGroundedAllowedToolManifest,
  type GroundedAllowedToolManifest,
} from "./capability-inspection.js";
import {
  GroundedAnalysisError,
  mapGroundedAnalysisFailure,
  type GroundedSubmissionDiagnostics,
} from "./failure-mapping.js";
import { createLogger } from "../logger.js";
import {
  createGroundedModelLogger,
  groundedProviderFailureDiagnostics,
  GroundedModelAuditContextSchema,
  type GroundedModelAuditContext,
  type GroundedModelLogger,
} from "./model-logger.js";
import { freezeGroundedSchema } from "./immutable-schema.js";
import {
  toGroundedProviderConfigurationStatus,
  type GroundedProviderStartupConfiguration,
} from "./provider-configuration.js";
import {
  createPiGroundedAnalysisSessionFactory,
  type GroundedAnalysisSessionFactory,
  GroundedSessionRunError,
  type GroundedSessionRunResult,
  type PiGroundedAnalysisSessionFactoryOptions,
} from "./session-factory.js";
import {
  COLLECTION_EVIDENCE_WITH_SUBMISSION_TOOL_NAMES,
  createGroundedStructuredSubmission,
  GROUNDED_SUBMISSION_TOOL_NAME,
  type GroundedSubmissionUsageSnapshot,
} from "./structured-submission.js";
import {
  createGroundedToolLifecycleDiagnostics,
  GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT,
  type GroundedToolLifecycleDiagnostics,
} from "./tool-lifecycle.js";

const GROUNDED_SUBMISSION_ONLY_TOOL_NAMES = Object.freeze([GROUNDED_SUBMISSION_TOOL_NAME] as const);
const COLLECTION_EVIDENCE_TOOL_NAMES = COLLECTION_EVIDENCE_WITH_SUBMISSION_TOOL_NAMES;
const MAX_ASSISTANT_STOP_REASON_SNAPSHOT = 32;

type SubmissionDiagnostics = GroundedSubmissionDiagnostics;

export interface GroundedAnalysisRequest<Output> {
  systemPrompt: string;
  prompt: string;
  submissionSchema: z.ZodType<Output>;
  signal: AbortSignal;
  audit: GroundedModelAuditContext;
  allowedTools: GroundedAllowedToolManifest;
  /** Daemon-created tools whose names must exactly match the feature manifest. */
  retrievalTools?: readonly ToolDefinition[];
  /** Internal, privacy-safe lifecycle recorder shared with daemon-created retrieval tools. */
  toolLifecycle?: GroundedToolLifecycleDiagnostics;
  /** Runs inside the submission tool before it reports success to the model. */
  acceptSubmission?(
    output: Output,
    usage: GroundedProviderUsage | GroundedUsageUnavailable,
  ): Promise<void>;
}

export interface GroundedAnalysisResult<Output> {
  output: Output;
  usage: GroundedProviderUsage | GroundedUsageUnavailable;
}

interface PerformedGroundedAnalysisResult<Output> extends GroundedAnalysisResult<Output> {
  modelInputBytes: number;
  modelInputRequests: number;
}

export interface GroundedAnalysisProvider {
  readonly configurationStatus: GroundedProviderConfigurationStatus;
  analyze<Output>(
    request: GroundedAnalysisRequest<Output>,
  ): Promise<GroundedAnalysisResult<Output>>;
  analyzeFreeform?(request: Omit<GroundedAnalysisRequest<never>, "submissionSchema">): Promise<GroundedAnalysisResult<string>>;
}

export interface GroundedAnalysisProviderOptions {
  configuration: GroundedProviderStartupConfiguration;
  sessionFactory?: GroundedAnalysisSessionFactory;
  piSessionFactory?: Omit<PiGroundedAnalysisSessionFactoryOptions, "extensionIds">;
  modelLogger?: GroundedModelLogger;
  now?: () => string;
  nowMs?: () => number;
  /** Opt-in because assistant text can contain user-provided material. */
  traceAssistantContent?: boolean;
}

function canonicalDecimal(value: number): string | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const formatted = String(value);
  if (!/[eE]/.test(formatted)) return formatted;

  const [coefficient, exponentText] = formatted.toLowerCase().split("e");
  if (coefficient === undefined || exponentText === undefined) return undefined;
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) return undefined;
  const [integer, fraction = ""] = coefficient.split(".");
  if (integer === undefined) return undefined;
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + exponent;
  if (decimalIndex <= 0) return `0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function sumProviderCosts(values: readonly number[]): string | undefined {
  const decimals = values.map(canonicalDecimal);
  if (decimals.some((value) => value === undefined)) return undefined;
  const parts = decimals.map((value) => {
    const [integer = "0", fraction = ""] = value?.split(".") ?? [];
    return { integer, fraction };
  });
  const scale = Math.max(0, ...parts.map(({ fraction }) => fraction.length));
  const total = parts.reduce((sum, { integer, fraction }) => {
    const digits = `${integer}${fraction.padEnd(scale, "0")}`;
    return sum + BigInt(digits);
  }, 0n);
  if (scale === 0) return total.toString();

  const digits = total.toString().padStart(scale + 1, "0");
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction.length === 0 ? digits.slice(0, -scale) : `${digits.slice(0, -scale)}.${fraction}`;
}

function aggregateUsage(
  result: GroundedSessionRunResult,
): GroundedProviderUsage | GroundedUsageUnavailable {
  const unavailable = () => GroundedUsageUnavailableSchema.parse({ state: "unavailable" });
  const isValidCount = (value: number) => Number.isSafeInteger(value) && value >= 0;
  const hasValidReportedUsage = result.usages.some(
    (usage) =>
      isValidCount(usage.inputTokens) ||
      isValidCount(usage.outputTokens) ||
      isValidCount(usage.cacheReadTokens) ||
      isValidCount(usage.cacheWriteTokens) ||
      canonicalDecimal(usage.monetaryCostUsd) !== undefined,
  );
  if (
    !Number.isSafeInteger(result.inferenceRoundTrips) ||
    result.inferenceRoundTrips < 1 ||
    !hasValidReportedUsage
  ) {
    return unavailable();
  }
  const complete = result.usages.length === result.inferenceRoundTrips;
  const usage: Record<string, unknown> = {
    state: "reported",
    inferenceRoundTrips: result.inferenceRoundTrips,
  };
  for (const field of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
  ] as const) {
    const values = result.usages.map((entry) => entry[field]);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (complete && values.every(isValidCount) && Number.isSafeInteger(total)) {
      usage[field] = total;
    }
  }
  const amount = complete
    ? sumProviderCosts(result.usages.map(({ monetaryCostUsd }) => monetaryCostUsd))
    : undefined;
  if (amount !== undefined) usage.monetaryCost = { amount, currency: "USD" };
  const parsed = GroundedProviderUsageSchema.safeParse(usage);
  if (!parsed.success) {
    return GroundedUsageUnavailableSchema.parse({ state: "unavailable" });
  }
  return parsed.data;
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function createGroundedAnalysisProvider(
  options: GroundedAnalysisProviderOptions,
): GroundedAnalysisProvider {
  const configurationStatus = deepFreeze(
    structuredClone(toGroundedProviderConfigurationStatus(options.configuration)),
  );
  const configured =
    configurationStatus.status === "configured"
      ? Object.freeze({ status: "configured" as const, ...configurationStatus.identity })
      : undefined;
  const sessionFactory =
    options.sessionFactory ??
    (configured && options.piSessionFactory
      ? createPiGroundedAnalysisSessionFactory({
          ...options.piSessionFactory,
          extensionIds: configured.extensionIds,
        })
      : undefined);
  const now = options.now ?? (() => new Date().toISOString());
  const nowMs = options.nowMs ?? (() => performance.now());
  const baseLogger = createLogger("grounded-analysis-model");
  const modelLogger =
    options.modelLogger ?? createGroundedModelLogger({ write: (record) => baseLogger.log(record) });
  const traceAssistantContent =
    options.traceAssistantContent ?? process.env.SHELF_JUDGE_MODEL_TRACE_CONTENT === "true";

  const safelyTrace = (
    audit: GroundedModelAuditContext,
    input: {
      event:
        | "model-request-start"
        | "model-response-end"
        | "provider-transport"
        | "tool-dispatch"
        | "tool-outcome"
        | "session-error";
      roundIndex?: number;
      callIndex?: number;
      toolName?: string;
      toolKind?: "submission" | "retrieval";
      outcome?: "accepted" | "rejected" | "failed";
      durationMs?: number;
      stopReason?: "stop" | "length" | "tool-use" | "error" | "aborted" | "other";
      assistantText?: string;
      assistantTextLength?: number;
      assistantTextTruncated?: boolean;
      error?: unknown;
      failure?: import("./model-logger.js").GroundedProviderFailureDiagnostics;
      transport?: Omit<
        import("./transport-diagnostics.js").NativeTransportDiagnostic,
        "durationMs" | "error"
      >;
    },
  ) => {
    try {
      const { error, failure, ...trace } = input;
      modelLogger.trace({
        ...audit,
        configuration: configurationStatus,
        recordType: "grounded-model-trace",
        occurredAt: now(),
        ...trace,
        ...(failure !== undefined
          ? { failure }
          : error === undefined
            ? {}
            : { failure: groundedProviderFailureDiagnostics(error) }),
      });
    } catch {
      // Logging must not change inference, cancellation, or submission behavior.
    }
  };

  async function performAnalysis<Output>(
    request: GroundedAnalysisRequest<Output> | Omit<GroundedAnalysisRequest<never>, "submissionSchema">,
    allowedTools: GroundedAllowedToolManifest,
    feature: string,
    recordSubmissionDiagnostics: (diagnostics: SubmissionDiagnostics) => void,
  ): Promise<PerformedGroundedAnalysisResult<Output>> {
    if (!configured || !sessionFactory) {
      throw new GroundedAnalysisError("model-configuration", "grounded-analysis-not-configured");
    }
    const retrievalTools = request.retrievalTools ?? [];
    const freeform = !("submissionSchema" in request);
    const registeredToolNames = [
      ...retrievalTools.map(({ name }) => name),
      ...(freeform ? [] : [GROUNDED_SUBMISSION_TOOL_NAME]),
    ];
    const submissionOnly =
      allowedTools.toolNames.length === GROUNDED_SUBMISSION_ONLY_TOOL_NAMES.length &&
      allowedTools.toolNames.every(
        (toolName, index) => toolName === GROUNDED_SUBMISSION_ONLY_TOOL_NAMES[index],
      );
    const collectionEvidenceTools =
      allowedTools.toolNames.length === COLLECTION_EVIDENCE_TOOL_NAMES.length &&
      COLLECTION_EVIDENCE_TOOL_NAMES.every((toolName) => allowedTools.toolNames.includes(toolName));
    const freeformCollectionTools = ["top", "grep", "readGames", "summarize"];
    const supportsFreeformCollection =
      feature === "collection-analyst" &&
      allowedTools.toolNames.length === freeformCollectionTools.length &&
      freeformCollectionTools.every((toolName) => allowedTools.toolNames.includes(toolName));
    const supportsCollectionEvidence =
      (feature === "collection-analyst" || feature === "profile-reflection") && collectionEvidenceTools;
    if (
      allowedTools.feature !== feature ||
      new Set(registeredToolNames).size !== registeredToolNames.length ||
      allowedTools.toolNames.length !== registeredToolNames.length ||
      allowedTools.toolNames.some((toolName) => !registeredToolNames.includes(toolName)) ||
       (feature === "collection-analyst"
         ? freeform ? !supportsFreeformCollection : !supportsCollectionEvidence
        : feature === "profile-reflection"
          ? !(submissionOnly || supportsCollectionEvidence)
          : !submissionOnly)
    ) {
      throw new GroundedCapabilityError("unsupported-feature-tool-manifest");
    }

    const submissionSchema = "submissionSchema" in request ? freezeGroundedSchema(request.submissionSchema) : undefined;
    let activeRoundIndex: number | undefined;
    const toolLifecycle =
      request.toolLifecycle ??
      createGroundedToolLifecycleDiagnostics({
        nowMs,
      });
    toolLifecycle.setTrace((event) =>
      safelyTrace(request.audit, {
        event: event.phase === "dispatch" ? "tool-dispatch" : "tool-outcome",
        ...(activeRoundIndex === undefined ? {} : { roundIndex: activeRoundIndex }),
        callIndex: event.callIndex,
        toolName: event.toolName,
        toolKind: event.toolKind,
        ...(event.outcome === "accepted" ||
        event.outcome === "rejected" ||
        event.outcome === "failed"
          ? { outcome: event.outcome, durationMs: event.durationMs }
          : {}),
      }),
    );
    const submissionUsage = (usage: GroundedSubmissionUsageSnapshot) =>
      aggregateUsage({
        inferenceRoundTrips: usage.inferenceRoundTrips,
        assistantText: [],
        usages: usage.usages,
      });
    const acceptSubmission = "submissionSchema" in request ? request.acceptSubmission?.bind(request) : undefined;
    const submission = submissionSchema === undefined ? undefined : createGroundedStructuredSubmission<Output>(
      submissionSchema,
      toolLifecycle,
      acceptSubmission === undefined
        ? undefined
        : (output, usage) => acceptSubmission(output, submissionUsage(usage)),
    );
    const recordAttemptState = (runResult?: GroundedSessionRunResult) => {
      const attemptState = submission?.getAttemptState();
      if (attemptState === undefined) return;
      const validationIssues = attemptState.validationIssues.map(({ code, path }) => ({
        code,
        path: [...path],
      }));
      recordSubmissionDiagnostics({
        state: "observed",
        ...attemptState,
        validationIssues,
        argumentShapes: attemptState.argumentShapes.map((argumentShape) => ({
          ...argumentShape,
        })),
        ...(runResult === undefined
          ? {}
          : {
              assistantNonemptyTextPresent: runResult.assistantText.some(
                (text) => text.trim().length > 0,
              ),
              assistantTextTurns: runResult.assistantText.length,
              assistantStopReasons: [...(runResult.assistantStopReasons ?? [])].slice(
                0,
                MAX_ASSISTANT_STOP_REASON_SNAPSHOT,
              ),
              toolLifecycle: [...toolLifecycle.snapshot()].slice(
                0,
                GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT,
              ),
            }),
      });
    };
    recordAttemptState();
    let session: Awaited<ReturnType<GroundedAnalysisSessionFactory["create"]>> | undefined;
    try {
      const sessionInput = {
        systemPrompt: request.systemPrompt,
        retrievalTools,
        trace: (event: Parameters<NonNullable<PiGroundedAnalysisSessionFactoryOptions["onTrace"]>>[0]) => {
          if (event.event === "model-response-end") activeRoundIndex = event.roundIndex;
          safelyTrace(request.audit, event);
        },
        traceAssistantContent,
      };
      if (freeform) {
        if (sessionFactory.createFreeform === undefined)
          throw new GroundedAnalysisError("internal", "freeform-session-factory-not-configured");
        session = await sessionFactory.createFreeform(sessionInput);
      } else {
        if (submission === undefined) throw new GroundedAnalysisError("internal", "structured-submission-required");
        session = await sessionFactory.create({ ...sessionInput, submission });
      }
      await session.bindExtensions();
      const capabilities = session.getCapabilities(allowedTools.toolNames);
      assertGroundedSessionCapabilities(capabilities, allowedTools);
      if (!session.resolveModel(configured.providerId, configured.modelId)) {
        throw new GroundedAnalysisError("model-configuration", "configured-model-not-found");
      }
      await session.setModel();
      let runResult: GroundedSessionRunResult;
      try {
        runResult = await session.prompt(request.prompt, request.signal);
      } catch (error) {
        if (!(error instanceof GroundedSessionRunError)) throw error;
        recordAttemptState(error.runResult);
        if (submission?.getResult() === undefined) throw error;
        // Acceptance includes the caller's durable commit. A later session or
        // transport cleanup failure cannot reclassify that committed result.
        runResult = error.runResult;
      }
      const operationalFailure = submission?.getOperationalFailure();
      if (operationalFailure !== undefined) {
        throw operationalFailure instanceof Error
          ? operationalFailure
          : new Error("grounded-submission-operational-failure");
      }
      const usage = aggregateUsage(runResult);
      recordAttemptState(runResult);
      if (freeform) {
        const finalText = runResult.finalAssistantText;
        if (finalText === undefined || finalText.trim().length === 0 || runResult.finalStopReason === "error" || runResult.finalStopReason === "aborted")
          throw new GroundedAnalysisError("output-validation", "missing-freeform-final-response", { usage });
        return { output: finalText as Output, usage, modelInputBytes: runResult.modelInputBytes ?? 0, modelInputRequests: runResult.modelInputRequests ?? 0 };
      }
      const output = submission?.getResult();
      if (output === undefined) {
        throw new GroundedAnalysisError("output-validation", "missing-structured-submission", {
          usage,
        });
      }
      return {
        output,
        usage,
        modelInputBytes: runResult.modelInputBytes ?? 0,
        modelInputRequests: runResult.modelInputRequests ?? 0,
      };
    } finally {
      try {
        session?.dispose();
      } catch {
        // A completed tool acceptance is durable; disposal must not erase it.
      }
    }
  }

  const provider: GroundedAnalysisProvider = {
    configurationStatus,
    async analyze<Output>(request: GroundedAnalysisRequest<Output>) {
      const audit = GroundedModelAuditContextSchema.parse(request.audit);
      const allowedTools = snapshotGroundedAllowedToolManifest(request.allowedTools);
      const startedAt = nowMs();
      const logBase = { ...audit, configuration: configurationStatus };
      modelLogger.attempt({
        ...logBase,
        recordType: "grounded-model-attempt",
        occurredAt: now(),
      });
      const result = await (async () => {
        let submissionDiagnostics: SubmissionDiagnostics = { state: "unavailable" };
        try {
          const result = await performAnalysis(
            request,
            allowedTools,
            audit.feature,
            (diagnostics) => {
              submissionDiagnostics = diagnostics;
            },
          );
          return { result, submissionDiagnostics };
        } catch (error) {
          const runUsage =
            error instanceof GroundedSessionRunError
              ? aggregateUsage(error.runResult)
              : error instanceof GroundedAnalysisError && error.usage
                ? error.usage
                : GroundedUsageUnavailableSchema.parse({ state: "unavailable" });
          const mapped = mapGroundedAnalysisFailure(
            error instanceof GroundedSessionRunError ? error.cause : error,
            request.signal,
          );
          const failure = new GroundedAnalysisError(mapped.reason, mapped.safeDetail, {
            usage: runUsage,
            submissionDiagnostics,
            cause: error,
          });
          modelLogger.outcome({
            ...logBase,
            recordType: "grounded-model-outcome",
            occurredAt: now(),
            outcome: failure.reason === "cancelled" ? "cancelled" : "failed",
            durationMs: Math.max(0, Math.round(nowMs() - startedAt)),
            usage: runUsage,
            modelInputBytes:
              error instanceof GroundedSessionRunError ? (error.runResult.modelInputBytes ?? 0) : 0,
            modelInputRequests:
              error instanceof GroundedSessionRunError
                ? (error.runResult.modelInputRequests ?? 0)
                : 0,
            validation: failure.reason === "output-validation" ? "rejected" : "not-reached",
            terminalReason: failure.reason,
            cacheTransition: "none",
            submissionDiagnostics,
            failureCategory: failure.reason,
            providerFailure: groundedProviderFailureDiagnostics(error),
          });
          throw failure;
        }
      })();
      modelLogger.outcome({
        ...logBase,
        recordType: "grounded-model-outcome",
        occurredAt: now(),
        outcome: "completed",
        durationMs: Math.max(0, Math.round(nowMs() - startedAt)),
        usage: result.result.usage,
        modelInputBytes: result.result.modelInputBytes,
        modelInputRequests: result.result.modelInputRequests,
        validation: "accepted",
        terminalReason: "accepted",
        cacheTransition: "none",
        submissionDiagnostics: result.submissionDiagnostics,
      });
      return { output: result.result.output, usage: result.result.usage };
    },
    async analyzeFreeform(request) {
      const audit = GroundedModelAuditContextSchema.parse(request.audit);
      const allowedTools = snapshotGroundedAllowedToolManifest(request.allowedTools);
      const startedAt = nowMs();
      const logBase = { ...audit, configuration: configurationStatus };
      modelLogger.attempt({ ...logBase, recordType: "grounded-model-attempt", occurredAt: now() });
      try {
        const result = await performAnalysis(request, allowedTools, audit.feature, () => undefined);
        modelLogger.outcome({ ...logBase, recordType: "grounded-model-outcome", occurredAt: now(), outcome: "completed", durationMs: Math.max(0, Math.round(nowMs() - startedAt)), usage: result.usage, modelInputBytes: result.modelInputBytes, modelInputRequests: result.modelInputRequests, validation: "not-reached", terminalReason: "accepted", cacheTransition: "none", submissionDiagnostics: { state: "unavailable" } });
        return { output: result.output, usage: result.usage };
      } catch (error) {
        const usage = error instanceof GroundedSessionRunError ? aggregateUsage(error.runResult) : GroundedUsageUnavailableSchema.parse({ state: "unavailable" });
        const mapped = mapGroundedAnalysisFailure(error instanceof GroundedSessionRunError ? error.cause : error, request.signal);
        modelLogger.outcome({ ...logBase, recordType: "grounded-model-outcome", occurredAt: now(), outcome: mapped.reason === "cancelled" ? "cancelled" : "failed", durationMs: Math.max(0, Math.round(nowMs() - startedAt)), usage, modelInputBytes: error instanceof GroundedSessionRunError ? (error.runResult.modelInputBytes ?? 0) : 0, modelInputRequests: error instanceof GroundedSessionRunError ? (error.runResult.modelInputRequests ?? 0) : 0, validation: "not-reached", terminalReason: mapped.reason, cacheTransition: "none", submissionDiagnostics: { state: "unavailable" }, failureCategory: mapped.reason, providerFailure: groundedProviderFailureDiagnostics(error) });
        throw new GroundedAnalysisError(mapped.reason, mapped.safeDetail, { usage, cause: error });
      }
    },
  };
  return Object.freeze(provider);
}
