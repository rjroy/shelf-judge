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
  ANALYST_MAX_INFERENCE_ROUND_TRIPS,
  GROUNDED_MAX_INFERENCE_ROUND_TRIPS,
  type GroundedAnalysisSessionFactory,
  GroundedSessionRunError,
  type GroundedSessionRunResult,
  type GroundedModelInputBudget,
  type PiGroundedAnalysisSessionFactoryOptions,
} from "./session-factory.js";
import {
  ANALYST_EVIDENCE_RETRIEVAL_TOOL_NAME,
  COLLECTION_EVIDENCE_WITH_SUBMISSION_TOOL_NAMES,
  createGroundedStructuredSubmission,
  GROUNDED_SUBMISSION_TOOL_NAME,
} from "./structured-submission.js";

const GROUNDED_SUBMISSION_ONLY_TOOL_NAMES = Object.freeze([GROUNDED_SUBMISSION_TOOL_NAME] as const);
const ANALYST_TOOL_NAMES = Object.freeze([
  ANALYST_EVIDENCE_RETRIEVAL_TOOL_NAME,
  GROUNDED_SUBMISSION_TOOL_NAME,
] as const);
const COLLECTION_EVIDENCE_TOOL_NAMES = COLLECTION_EVIDENCE_WITH_SUBMISSION_TOOL_NAMES;

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
}

export interface GroundedAnalysisProviderOptions {
  configuration: GroundedProviderStartupConfiguration;
  sessionFactory?: GroundedAnalysisSessionFactory;
  piSessionFactory?: Omit<PiGroundedAnalysisSessionFactoryOptions, "extensionIds">;
  modelLogger?: GroundedModelLogger;
  now?: () => string;
  nowMs?: () => number;
  /** Optional aggregate provider-payload budget, measured after payload hooks serialize each request. */
  modelInputBudget?: GroundedModelInputBudget;
}

/**
 * Limits the complete serialized provider context across the four allowed model turns.
 * This is roughly 5.3 times the 192 KiB per-tool-response allowance: enough for a
 * prompt, repeated tool context, and submission overhead, while bounding runaway
 * context accumulation to 1 MiB.
 */
export const COLLECTION_EVIDENCE_DEFAULT_MODEL_INPUT_BUDGET: GroundedModelInputBudget =
  Object.freeze({ maxBytes: 1024 * 1024 });

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

  async function performAnalysis<Output>(
    request: GroundedAnalysisRequest<Output>,
    allowedTools: GroundedAllowedToolManifest,
    feature: string,
    recordSubmissionDiagnostics: (diagnostics: SubmissionDiagnostics) => void,
  ): Promise<PerformedGroundedAnalysisResult<Output>> {
    if (!configured || !sessionFactory) {
      throw new GroundedAnalysisError("model-configuration", "grounded-analysis-not-configured");
    }
    const retrievalTools = request.retrievalTools ?? [];
    const registeredToolNames = [
      ...retrievalTools.map(({ name }) => name),
      GROUNDED_SUBMISSION_TOOL_NAME,
    ];
    const submissionOnly =
      allowedTools.toolNames.length === GROUNDED_SUBMISSION_ONLY_TOOL_NAMES.length &&
      allowedTools.toolNames.every(
        (toolName, index) => toolName === GROUNDED_SUBMISSION_ONLY_TOOL_NAMES[index],
      );
    const legacyAnalystTools =
      allowedTools.toolNames.length === ANALYST_TOOL_NAMES.length &&
      ANALYST_TOOL_NAMES.every((toolName) => allowedTools.toolNames.includes(toolName));
    const collectionEvidenceTools =
      allowedTools.toolNames.length === COLLECTION_EVIDENCE_TOOL_NAMES.length &&
      COLLECTION_EVIDENCE_TOOL_NAMES.every((toolName) => allowedTools.toolNames.includes(toolName));
    const supportsCollectionEvidence =
      (feature === "collection-analyst" || feature === "profile-reflection") &&
      collectionEvidenceTools;
    if (
      allowedTools.feature !== feature ||
      new Set(registeredToolNames).size !== registeredToolNames.length ||
      allowedTools.toolNames.length !== registeredToolNames.length ||
      allowedTools.toolNames.some((toolName) => !registeredToolNames.includes(toolName)) ||
      (feature === "collection-analyst"
        ? !(legacyAnalystTools || supportsCollectionEvidence)
        : feature === "profile-reflection"
          ? !(submissionOnly || supportsCollectionEvidence)
          : !submissionOnly)
    ) {
      throw new GroundedCapabilityError("unsupported-feature-tool-manifest");
    }

    const submissionSchema = freezeGroundedSchema(request.submissionSchema);
    const submission = createGroundedStructuredSubmission(submissionSchema);
    const recordAttemptState = (runResult?: GroundedSessionRunResult) => {
      const attemptState = submission.getAttemptState();
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
              assistantStopReasons: [...(runResult.assistantStopReasons ?? [])].slice(0, 2),
            }),
      });
    };
    recordAttemptState();
    let session: Awaited<ReturnType<GroundedAnalysisSessionFactory["create"]>> | undefined;
    try {
      session = await sessionFactory.create({
        systemPrompt: request.systemPrompt,
        submission,
        retrievalTools,
        maxInferenceRoundTrips:
          feature === "collection-analyst" || supportsCollectionEvidence
            ? ANALYST_MAX_INFERENCE_ROUND_TRIPS
            : GROUNDED_MAX_INFERENCE_ROUND_TRIPS,
        modelInputBudget: supportsCollectionEvidence
          ? (options.modelInputBudget ?? COLLECTION_EVIDENCE_DEFAULT_MODEL_INPUT_BUDGET)
          : options.modelInputBudget,
      });
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
        if (error instanceof GroundedSessionRunError) recordAttemptState(error.runResult);
        throw error;
      }
      const usage = aggregateUsage(runResult);
      recordAttemptState(runResult);
      if (runResult.assistantText.some((text) => text.trim().length > 0)) {
        throw new GroundedAnalysisError("output-validation", "free-form-model-output", { usage });
      }
      const attemptState = submission.getAttemptState();
      if (attemptState.rejectedAttempts > 0) {
        throw new GroundedAnalysisError("output-validation", "invalid-structured-submission", {
          usage,
        });
      }
      const output = submission.getResult();
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
      session?.dispose();
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
            cacheTransition: "none",
            submissionDiagnostics,
            failureCategory: failure.reason,
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
        cacheTransition: "none",
        submissionDiagnostics: result.submissionDiagnostics,
      });
      return { output: result.result.output, usage: result.result.usage };
    },
  };
  return Object.freeze(provider);
}
