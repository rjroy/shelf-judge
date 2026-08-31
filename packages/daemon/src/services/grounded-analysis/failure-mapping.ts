import { GroundedCapabilityError } from "./capability-inspection.js";
import type { GroundedProviderUsage, GroundedUsageUnavailable } from "@shelf-judge/shared";

export type GroundedAnalysisFailureReason =
  | "cancelled"
  | "model-configuration"
  | "extension-binding"
  | "authentication"
  | "provider-refusal"
  | "rate-limit"
  | "provider-outage"
  | "context-exhaustion"
  | "output-validation"
  | "transport"
  | "internal";

export class GroundedAnalysisError extends Error {
  readonly usage?: GroundedProviderUsage | GroundedUsageUnavailable;

  constructor(
    readonly reason: GroundedAnalysisFailureReason,
    readonly safeDetail?: string,
    options?: ErrorOptions & {
      usage?: GroundedProviderUsage | GroundedUsageUnavailable;
    },
  ) {
    super(safeDetail ?? reason, options);
    this.name = "GroundedAnalysisError";
    this.usage = options?.usage;
  }
}

interface FailureEvidence {
  name: string;
  text: string;
  code?: string;
  status?: number;
}

function numericStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function failureEvidence(error: unknown): FailureEvidence {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  let code: string | undefined;
  let status: number | undefined;

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    code = typeof record.code === "string" ? record.code.toUpperCase() : undefined;
    status = numericStatus(record.status) ?? numericStatus(record.statusCode);
    if (status === undefined && typeof record.response === "object" && record.response !== null) {
      status = numericStatus((record.response as Record<string, unknown>).status);
    }
  }

  const text = `${name} ${message}`.toLowerCase();
  const httpStatus = /\bhttp(?:\s+status)?\s*[:=]?\s*(\d{3})\b/i.exec(text)?.[1];
  return {
    name,
    text,
    code,
    status: status ?? (httpStatus === undefined ? undefined : numericStatus(Number(httpStatus))),
  };
}

export function mapGroundedAnalysisFailure(
  error: unknown,
  signal?: AbortSignal,
): GroundedAnalysisError {
  if (error instanceof GroundedAnalysisError) return error;
  const evidence = failureEvidence(error);
  if (
    signal?.aborted ||
    evidence.name === "AbortError" ||
    evidence.code === "ABORT_ERR" ||
    /\b(?:request|operation) (?:was )?aborted\b/.test(evidence.text)
  ) {
    return new GroundedAnalysisError("cancelled", "cancelled", { cause: error });
  }
  if (error instanceof GroundedCapabilityError) {
    return new GroundedAnalysisError("extension-binding", error.safeDetail, { cause: error });
  }

  if (evidence.status === 401 || evidence.status === 403) {
    return new GroundedAnalysisError("authentication", "provider-authentication-failed", {
      cause: error,
    });
  }
  if (evidence.status === 429) {
    return new GroundedAnalysisError("rate-limit", "provider-rate-limited", { cause: error });
  }
  if (evidence.status !== undefined && evidence.status >= 500) {
    return new GroundedAnalysisError("provider-outage", "provider-unavailable", { cause: error });
  }
  if (
    /\b(?:invalid|missing) api key\b|\bauthentication (?:failed|required)\b|\bunauthorized\b|\bcredentials? (?:missing|rejected|required)\b/.test(
      evidence.text,
    )
  ) {
    return new GroundedAnalysisError("authentication", "provider-authentication-failed", {
      cause: error,
    });
  }
  if (
    /\bprovider refus(?:al|ed)\b|\bcontent policy refusal\b|\bsafety refusal\b/.test(evidence.text)
  ) {
    return new GroundedAnalysisError("provider-refusal", "provider-refused", { cause: error });
  }
  if (/\brate limit(?:ed| exceeded)?\b|\btoo many requests\b/.test(evidence.text)) {
    return new GroundedAnalysisError("rate-limit", "provider-rate-limited", { cause: error });
  }
  if (
    /\b(?:maximum )?context (?:window|length)(?: limit)? (?:was )?(?:exceeded|exhausted)\b|\btoken limit (?:was )?exceeded\b|\bprompt (?:is )?too long\b/.test(
      evidence.text,
    )
  ) {
    return new GroundedAnalysisError("context-exhaustion", "provider-context-exhausted", {
      cause: error,
    });
  }
  if (
    evidence.code !== undefined &&
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ENETUNREACH",
      "ENOTFOUND",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(evidence.code)
  ) {
    return new GroundedAnalysisError("transport", "provider-transport-failed", { cause: error });
  }
  if (
    /\bfetch failed\b|\bnetwork request failed\b|\bsocket (?:closed|reset|(?:network )?timeout)\b|\bconnection (?:refused|reset|timed out)\b|\brequest timed out\b/.test(
      evidence.text,
    )
  ) {
    return new GroundedAnalysisError("transport", "provider-transport-failed", { cause: error });
  }
  if (
    /\bprovider (?:is )?(?:overloaded|unavailable)\b|\bprovider outage\b|\bservice unavailable\b/.test(
      evidence.text,
    )
  ) {
    return new GroundedAnalysisError("provider-outage", "provider-unavailable", { cause: error });
  }
  return new GroundedAnalysisError("internal", "grounded-analysis-failed", { cause: error });
}
