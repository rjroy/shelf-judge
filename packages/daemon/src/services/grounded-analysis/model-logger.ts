import {
  GroundedProviderConfigurationStatusSchema,
  GroundedProviderUsageSchema,
  GroundedUsageUnavailableSchema,
} from "@shelf-judge/shared";
import { z } from "zod";
import { GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT } from "./tool-lifecycle.js";

const SafeIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:/@+~-]+$/);
const TimestampSchema = z.string().datetime({ offset: true });
const EvidenceClassCountSchema = z
  .object({
    evidenceClass: SafeIdentifierSchema,
    count: z.number().int().safe().min(0),
  })
  .strict();
const SafeValidationIssueSchema = z
  .object({
    code: SafeIdentifierSchema,
    path: z.array(z.union([SafeIdentifierSchema, z.number().int().safe().min(0)])).max(16),
  })
  .strict();
const SubmissionArgumentShapeSchema = z
  .object({
    topLevel: z.enum(["object", "non-object"]),
    submission: z.enum(["missing", "object", "non-object"]),
    result: z.enum(["missing", "object", "non-object"]),
    outcome: z.enum(["missing", "answered", "abstained", "other-string", "non-string"]),
  })
  .strict();
const ToolLifecycleEventSchema = z
  .object({
    toolName: SafeIdentifierSchema,
    toolKind: z.enum(["submission", "retrieval"]),
    phase: z.enum(["dispatch", "handling"]),
    outcome: z.enum(["attempted", "accepted", "rejected", "failed"]),
    callIndex: z.number().int().safe().min(0),
  })
  .strict();

const ProviderFailureDetailSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    message: z.string().min(1).max(512).optional(),
    code: z.string().min(1).max(128).optional(),
    status: z.number().int().min(100).max(599).optional(),
  })
  .strict();
const ProviderFailureDiagnosticsSchema = z
  .object({
    primary: ProviderFailureDetailSchema,
    causeChain: z.array(ProviderFailureDetailSchema).max(4),
  })
  .strict();

const ModelTraceEventSchema = z
  .object({
    recordType: z.literal("grounded-model-trace"),
    operationId: SafeIdentifierSchema,
    batchId: SafeIdentifierSchema,
    requestId: SafeIdentifierSchema,
    feature: SafeIdentifierSchema,
    trigger: SafeIdentifierSchema,
    occurredAt: TimestampSchema,
    configuration: GroundedProviderConfigurationStatusSchema,
    evidenceManifestId: SafeIdentifierSchema,
    evidenceManifestVersion: SafeIdentifierSchema,
    evidenceClassCounts: z.array(EvidenceClassCountSchema),
    evidenceIdentityHash: z.string().regex(/^[0-9a-f]{64}$/),
    event: z.enum([
      "model-request-start",
      "model-response-end",
      "provider-transport",
      "tool-dispatch",
      "tool-outcome",
      "session-error",
    ]),
    roundIndex: z.number().int().safe().min(1).optional(),
    requestPayloadBytes: z.number().int().safe().min(0).optional(),
    cumulativePayloadBytes: z.number().int().safe().min(0).optional(),
    messageCount: z.number().int().safe().min(0).optional(),
    toolCount: z.number().int().safe().min(0).optional(),
    callIndex: z.number().int().safe().min(0).optional(),
    toolName: SafeIdentifierSchema.optional(),
    toolKind: z.enum(["submission", "retrieval"]).optional(),
    outcome: z.enum(["accepted", "rejected", "failed"]).optional(),
    durationMs: z.number().int().safe().min(0).optional(),
    stopReason: z.enum(["stop", "length", "tool-use", "error", "aborted", "other"]).optional(),
    assistantText: z.string().max(16_384).optional(),
    assistantTextLength: z.number().int().safe().min(0).optional(),
    assistantTextTruncated: z.boolean().optional(),
    failure: ProviderFailureDiagnosticsSchema.optional(),
    transport: z
      .object({
        phase: z.enum(["awaiting-headers", "reading-body"]),
        outcome: z.enum(["headers-received", "completed", "failed"]),
        url: z.string().url().max(512),
        headersReceivedAt: TimestampSchema.optional(),
        readIdleMs: z.number().int().safe().min(0).optional(),
        status: z.number().int().min(100).max(599).optional(),
        abort: z
          .object({ aborted: z.boolean(), reason: ProviderFailureDetailSchema.optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type GroundedProviderFailureDiagnostics = z.infer<typeof ProviderFailureDiagnosticsSchema>;

const MAX_FAILURE_CAUSES = 4;
const REDACTED_VALUE = "[REDACTED]";
const SECRET_PATTERNS = [
  /((?:"(?:authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)"\s*:\s*")(?:(?:bearer|basic)\s+)?)[^"]+/gi,
  /\b((?:authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*["']?(?:(?:bearer|basic)\s+)?)[^,;"'}\]]+/gi,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
];

function redactFailureText(value: string, maximumLength: number): string | undefined {
  const redacted = SECRET_PATTERNS.reduce(
    (text, pattern) =>
      text.replace(pattern, (...match: unknown[]) => {
        const prefix = typeof match[1] === "string" ? match[1] : undefined;
        return prefix === undefined ? REDACTED_VALUE : `${prefix}${REDACTED_VALUE}`;
      }),
    value,
  )
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("")
    .trim();
  return redacted.length === 0 ? undefined : redacted.slice(0, maximumLength);
}

function readFailureProperty(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function failureDetail(value: unknown): {
  detail: GroundedProviderFailureDiagnostics["primary"];
  cause: unknown;
} {
  if (typeof value !== "object" || value === null) {
    return { detail: { message: redactFailureText(String(value), 512) }, cause: undefined };
  }
  const name = readFailureProperty(value, "name");
  const message = readFailureProperty(value, "message");
  const code = readFailureProperty(value, "code");
  const status = readFailureProperty(value, "status") ?? readFailureProperty(value, "statusCode");
  return {
    detail: {
      ...(typeof name === "string" ? { name: redactFailureText(name, 128) } : {}),
      ...(typeof message === "string" ? { message: redactFailureText(message, 512) } : {}),
      ...(typeof code === "string" ? { code: redactFailureText(code, 128) } : {}),
      ...(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
        ? { status }
        : {}),
    },
    cause: readFailureProperty(value, "cause"),
  };
}

/**
 * Extracts bounded, redacted diagnostics without serializing provider payloads or transcripts.
 */
export function groundedProviderFailureDiagnostics(
  failure: unknown,
): GroundedProviderFailureDiagnostics {
  const seen = new Set<object>();
  const primary = failureDetail(failure);
  const causeChain: GroundedProviderFailureDiagnostics["causeChain"] = [];
  let cause = primary.cause;
  while (causeChain.length < MAX_FAILURE_CAUSES && typeof cause === "object" && cause !== null) {
    if (seen.has(cause)) break;
    seen.add(cause);
    const next = failureDetail(cause);
    causeChain.push(next.detail);
    cause = next.cause;
  }
  return ProviderFailureDiagnosticsSchema.parse({ primary: primary.detail, causeChain });
}

function requireUniqueEvidenceClasses(
  value: { evidenceClassCounts: readonly { evidenceClass: string }[] },
  context: z.RefinementCtx,
): void {
  const classes = value.evidenceClassCounts.map(({ evidenceClass }) => evidenceClass);
  if (new Set(classes).size !== classes.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceClassCounts"],
      message: "Logged evidence classes must be unique",
    });
  }
}

export const GroundedModelAuditContextSchema = z
  .object({
    operationId: SafeIdentifierSchema,
    batchId: SafeIdentifierSchema,
    requestId: SafeIdentifierSchema,
    feature: SafeIdentifierSchema,
    trigger: SafeIdentifierSchema,
    evidenceManifestId: SafeIdentifierSchema,
    evidenceManifestVersion: SafeIdentifierSchema,
    evidenceClassCounts: z.array(EvidenceClassCountSchema),
    evidenceIdentityHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .superRefine(requireUniqueEvidenceClasses);

const BaseModelLogSchema = z.object({
  operationId: SafeIdentifierSchema,
  batchId: SafeIdentifierSchema,
  requestId: SafeIdentifierSchema,
  feature: SafeIdentifierSchema,
  trigger: SafeIdentifierSchema,
  occurredAt: TimestampSchema,
  configuration: GroundedProviderConfigurationStatusSchema,
  evidenceManifestId: SafeIdentifierSchema,
  evidenceManifestVersion: SafeIdentifierSchema,
  evidenceClassCounts: z.array(EvidenceClassCountSchema),
  evidenceIdentityHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const GroundedModelAttemptLogSchema = BaseModelLogSchema.extend({
  recordType: z.literal("grounded-model-attempt"),
})
  .strict()
  .superRefine(requireUniqueEvidenceClasses);

export const GroundedModelOutcomeLogSchema = BaseModelLogSchema.extend({
  recordType: z.literal("grounded-model-outcome"),
  outcome: z.enum(["completed", "cancelled", "failed"]),
  durationMs: z.number().int().safe().min(0),
  usage: z.union([GroundedProviderUsageSchema, GroundedUsageUnavailableSchema]),
  validation: z.enum(["accepted", "rejected", "not-reached"]),
  terminalReason: z.enum([
    "accepted",
    "cancelled",
    "model-configuration",
    "extension-binding",
    "authentication",
    "provider-refusal",
    "rate-limit",
    "provider-outage",
    "context-exhaustion",
    "output-validation",
    "transport",
    "internal",
  ]),
  cacheTransition: z.enum(["none", "written", "invalidated"]),
  modelInputBytes: z.number().int().safe().min(0),
  modelInputRequests: z.number().int().safe().min(0),
  submissionDiagnostics: z.union([
    z
      .object({
        state: z.literal("observed"),
        toolCallAttempts: z.number().int().safe().min(0),
        acceptedResultPresent: z.boolean(),
        rejectedAttempts: z.number().int().safe().min(0),
        assistantNonemptyTextPresent: z.boolean().optional(),
        assistantTextTurns: z.number().int().safe().min(0).optional(),
        validationIssues: z.array(SafeValidationIssueSchema).max(8).optional(),
        argumentShapes: z.array(SubmissionArgumentShapeSchema).max(2).optional(),
        assistantStopReasons: z
          .array(z.enum(["stop", "length", "tool-use", "error", "aborted", "other"]))
          .max(32)
          .optional(),
        toolLifecycle: z
          .array(ToolLifecycleEventSchema)
          .max(GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT)
          .optional(),
      })
      .strict(),
    z.object({ state: z.literal("unavailable") }).strict(),
  ]),
  failureCategory: z
    .enum([
      "cancelled",
      "model-configuration",
      "extension-binding",
      "authentication",
      "provider-refusal",
      "rate-limit",
      "provider-outage",
      "context-exhaustion",
      "output-validation",
      "transport",
      "internal",
    ])
    .optional(),
  providerFailure: ProviderFailureDiagnosticsSchema.optional(),
})
  .strict()
  .superRefine(requireUniqueEvidenceClasses);

export type GroundedModelAttemptLog = z.infer<typeof GroundedModelAttemptLogSchema>;
export type GroundedModelOutcomeLog = z.infer<typeof GroundedModelOutcomeLogSchema>;
export type GroundedModelTraceEvent = z.infer<typeof ModelTraceEventSchema>;
export type GroundedModelLogRecord =
  | GroundedModelAttemptLog
  | GroundedModelOutcomeLog
  | GroundedModelTraceEvent;
export type GroundedModelAuditContext = z.infer<typeof GroundedModelAuditContextSchema>;

export interface GroundedModelLogger {
  attempt(input: unknown): GroundedModelAttemptLog;
  outcome(input: unknown): GroundedModelOutcomeLog;
  trace(input: unknown): GroundedModelTraceEvent;
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

export function createGroundedModelLogger(options: {
  write: (record: GroundedModelLogRecord) => void;
}): GroundedModelLogger {
  const write = options.write;
  const lifecycle = new Map<string, { fingerprint: string; outcomeRecorded: boolean }>();

  function correlationKey(record: GroundedModelLogRecord): string {
    return `${record.operationId}\u0000${record.batchId}\u0000${record.requestId}`;
  }

  function lifecycleFingerprint(record: GroundedModelAttemptLog | GroundedModelOutcomeLog): string {
    return JSON.stringify({
      operationId: record.operationId,
      batchId: record.batchId,
      requestId: record.requestId,
      feature: record.feature,
      trigger: record.trigger,
      configuration: record.configuration,
      evidenceManifestId: record.evidenceManifestId,
      evidenceManifestVersion: record.evidenceManifestVersion,
      evidenceClassCounts: record.evidenceClassCounts,
      evidenceIdentityHash: record.evidenceIdentityHash,
    });
  }

  return Object.freeze({
    attempt(input: unknown): GroundedModelAttemptLog {
      const record = GroundedModelAttemptLogSchema.parse(input);
      const key = correlationKey(record);
      if (lifecycle.has(key)) throw new Error("Grounded model attempt is already registered");
      const frozen = structuredClone(record);
      deepFreeze(frozen);
      write(frozen);
      lifecycle.set(key, { fingerprint: lifecycleFingerprint(record), outcomeRecorded: false });
      return frozen;
    },
    outcome(input: unknown): GroundedModelOutcomeLog {
      const record = GroundedModelOutcomeLogSchema.parse(input);
      const key = correlationKey(record);
      const state = lifecycle.get(key);
      if (!state) throw new Error("Grounded model outcome requires a prior attempt");
      if (state.outcomeRecorded) throw new Error("Grounded model outcome is already registered");
      if (state.fingerprint !== lifecycleFingerprint(record)) {
        throw new Error("Grounded model outcome does not match its attempt identity");
      }
      const frozen = structuredClone(record);
      deepFreeze(frozen);
      write(frozen);
      state.outcomeRecorded = true;
      return frozen;
    },
    trace(input: unknown): GroundedModelTraceEvent {
      const record = ModelTraceEventSchema.parse(input);
      const frozen = structuredClone(record);
      deepFreeze(frozen);
      write(frozen);
      return frozen;
    },
  });
}
