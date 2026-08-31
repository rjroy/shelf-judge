import {
  GroundedProviderUsageSchema,
  GroundedUsageUnavailableSchema,
  type GroundedProviderConfigurationStatus,
  type GroundedProviderUsage,
  type GroundedUsageUnavailable,
} from "@shelf-judge/shared";
import type { z } from "zod";
import {
  assertGroundedSessionCapabilities,
  GroundedCapabilityError,
  snapshotGroundedAllowedToolManifest,
  type GroundedAllowedToolManifest,
} from "./capability-inspection.js";
import { GroundedAnalysisError, mapGroundedAnalysisFailure } from "./failure-mapping.js";
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
  type GroundedAnalysisSessionFactory,
  GroundedSessionRunError,
  type GroundedSessionRunResult,
  type PiGroundedAnalysisSessionFactoryOptions,
} from "./session-factory.js";
import {
  createGroundedStructuredSubmission,
  GROUNDED_SUBMISSION_TOOL_NAME,
} from "./structured-submission.js";

export interface GroundedAnalysisRequest<Output> {
  systemPrompt: string;
  prompt: string;
  submissionSchema: z.ZodType<Output>;
  signal: AbortSignal;
  audit: GroundedModelAuditContext;
  allowedTools: GroundedAllowedToolManifest;
}

export interface GroundedAnalysisResult<Output> {
  output: Output;
  usage: GroundedProviderUsage | GroundedUsageUnavailable;
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

  async function performAnalysis<Output>(
    request: GroundedAnalysisRequest<Output>,
    allowedTools: GroundedAllowedToolManifest,
    feature: string,
  ): Promise<GroundedAnalysisResult<Output>> {
    if (!configured || !sessionFactory) {
      throw new GroundedAnalysisError("model-configuration", "grounded-analysis-not-configured");
    }
    if (
      allowedTools.feature !== feature ||
      allowedTools.toolNames.length !== 1 ||
      allowedTools.toolNames[0] !== GROUNDED_SUBMISSION_TOOL_NAME
    ) {
      throw new GroundedCapabilityError("unsupported-feature-tool-manifest");
    }

    const submissionSchema = freezeGroundedSchema(request.submissionSchema);
    const submission = createGroundedStructuredSubmission(submissionSchema);
    let session: Awaited<ReturnType<GroundedAnalysisSessionFactory["create"]>> | undefined;
    try {
      session = await sessionFactory.create({ systemPrompt: request.systemPrompt, submission });
      await session.bindExtensions();
      const capabilities = session.getCapabilities(allowedTools.toolNames);
      assertGroundedSessionCapabilities(capabilities, allowedTools);
      if (!session.resolveModel(configured.providerId, configured.modelId)) {
        throw new GroundedAnalysisError("model-configuration", "configured-model-not-found");
      }
      await session.setModel();
      const runResult = await session.prompt(request.prompt, request.signal);
      const usage = aggregateUsage(runResult);
      if (runResult.assistantText.some((text) => text.trim().length > 0)) {
        throw new GroundedAnalysisError("output-validation", "free-form-model-output", { usage });
      }
      if (submission.getAttemptState().rejectedAttempts > 0) {
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
      return { output, usage };
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
        try {
          return await performAnalysis(request, allowedTools, audit.feature);
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
          const failure =
            mapped.usage === runUsage
              ? mapped
              : new GroundedAnalysisError(mapped.reason, mapped.safeDetail, {
                  usage: runUsage,
                });
          modelLogger.outcome({
            ...logBase,
            recordType: "grounded-model-outcome",
            occurredAt: now(),
            outcome: failure.reason === "cancelled" ? "cancelled" : "failed",
            durationMs: Math.max(0, Math.round(nowMs() - startedAt)),
            usage: runUsage,
            validation: failure.reason === "output-validation" ? "rejected" : "not-reached",
            cacheTransition: "none",
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
        usage: result.usage,
        validation: "accepted",
        cacheTransition: "none",
      });
      return result;
    },
  };
  return Object.freeze(provider);
}
