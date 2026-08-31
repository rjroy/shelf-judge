import {
  GroundedProviderConfigurationStatusSchema,
  GroundedProviderUsageSchema,
  GroundedUsageUnavailableSchema,
} from "@shelf-judge/shared";
import { z } from "zod";

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
  cacheTransition: z.enum(["none", "written", "invalidated"]),
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
})
  .strict()
  .superRefine(requireUniqueEvidenceClasses);

export type GroundedModelAttemptLog = z.infer<typeof GroundedModelAttemptLogSchema>;
export type GroundedModelOutcomeLog = z.infer<typeof GroundedModelOutcomeLogSchema>;
export type GroundedModelLogRecord = GroundedModelAttemptLog | GroundedModelOutcomeLog;
export type GroundedModelAuditContext = z.infer<typeof GroundedModelAuditContextSchema>;

export interface GroundedModelLogger {
  attempt(input: unknown): GroundedModelAttemptLog;
  outcome(input: unknown): GroundedModelOutcomeLog;
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

  function lifecycleFingerprint(record: GroundedModelLogRecord): string {
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
  });
}
