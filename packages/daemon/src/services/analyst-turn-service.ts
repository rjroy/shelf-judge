import type { AnalystFinal } from "@shelf-judge/shared";
import { z } from "zod";
import type {
  AnalystEvidenceService,
  AnalystRetrievedEvidence,
} from "./analyst-evidence-service.js";
import { AnalystEvidenceSourceChangedError } from "./analyst-evidence-service.js";
import type {
  GroundedAnalysisProvider,
  GroundedAnalysisResult,
} from "./grounded-analysis/provider.js";
import {
  validateAnalystResult,
  type AnalystValidationDiagnostic,
} from "./analyst-result-validator.js";
import { createCollectionAnalystToolManifest } from "./grounded-analysis/structured-submission.js";
import type { GroundedModelAuditContext } from "./grounded-analysis/model-logger.js";
import { createCollectionTools } from "./grounded-analysis/collection-tools.js";

// Tool responses re-enter the model context on a later round. The evidence
// service has the authoritative shared operation budget; this is an additional
// transport ceiling so a single response cannot consume the model context.
const ANALYST_TOOL_RESULT_MAX_BYTES = 64 * 1024;
const ANALYST_TOOL_TURN_MAX_BYTES = 192 * 1024;
const TOOL_CONTEXT_LIMIT_MESSAGE =
  "Evidence response is unavailable because the Analyst context limit was reached.";

type AnalystTurnLog = Readonly<Record<string, unknown>>;
type AnalystTurnLogSink = (record: AnalystTurnLog) => void;

function logStage(
  sink: AnalystTurnLogSink,
  audit: GroundedModelAuditContext,
  stage: string,
  outcome: "attempt" | "success" | "failed" | "rejected",
  details: Record<string, unknown> = {},
): void {
  sink(
    Object.freeze({
      recordType: "analyst-turn-stage",
      occurredAt: new Date().toISOString(),
      operationId: audit.operationId,
      batchId: audit.batchId,
      requestId: audit.requestId,
      feature: audit.feature,
      trigger: audit.trigger,
      stage,
      outcome,
      ...details,
    }),
  );
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Races non-abortable storage work so cancelled callers are never held by it. */
function abortable<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
  throwIfAborted(signal);
  return new Promise<Value>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error instanceof Error ? error : new Error("Analyst evidence operation failed"));
      },
    );
  });
}

function modelVisible(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(modelVisible);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      key === "snapshotFingerprint" ? [] : [[key, modelVisible(child)]],
    ),
  );
}

// This transport schema deliberately contains no shared contract schema instances:
// the provider snapshots its tool schema, while AnalystFinalSchema remains mutable
// for the authoritative post-submission validation below.
const AnalystSubmissionSchema = z
  .object({
    outcome: z.enum(["answered", "partial", "abstained"]),
    blocks: z
      .array(
        z
          .object({
            text: z.string().min(1),
            citationIds: z.array(z.string().min(1)),
            uncertainty: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(1),
    citations: z.array(
      z
        .object({
          citationId: z.string().min(1),
          sourceId: z.string().min(1),
          sourceVersion: z.string().min(1),
          evidenceClass: z.string().min(1),
          observedAt: z.string().optional(),
          canonicalSummary: z.string().min(1),
          testimony: z.boolean(),
          destination: z.object({
            operationId: z.string().min(1),
            parameters: z.object({}).passthrough(),
          }),
        })
        .strict(),
    ),
    usage: z.object({ state: z.enum(["reported", "unavailable"]) }).passthrough(),
    reason: z.string().min(1).optional(),
  })
  .strict();

function analystTools(
  evidenceService: AnalystEvidenceService,
  snapshot: Awaited<ReturnType<AnalystEvidenceService["capture"]>>,
  signal: AbortSignal,
  audit: GroundedModelAuditContext,
  log: AnalystTurnLogSink,
): ReturnType<typeof createCollectionTools> {
  const request = (parameters: Record<string, unknown>) => ({
    ...parameters,
    snapshotFingerprint: snapshot.snapshotFingerprint,
    ...(parameters.cursor === undefined || parameters.cursor === null
      ? {}
      : { cursor: { snapshotFingerprint: snapshot.snapshotFingerprint, ...parameters.cursor } }),
  });
  return createCollectionTools({
    signal,
    resultMaxBytes: ANALYST_TOOL_RESULT_MAX_BYTES,
    turnMaxBytes: ANALYST_TOOL_TURN_MAX_BYTES,
    contextLimitMessage: TOOL_CONTEXT_LIMIT_MESSAGE,
    redact: modelVisible,
    onStage: ({ name, outcome, ...details }) => logStage(log, audit, name, outcome, details),
    operations: {
      top: (parameters) => evidenceService.top(snapshot, request(parameters)),
      grep: (parameters) => evidenceService.grep(snapshot, request(parameters)),
      readGames: (parameters) => {
        if (evidenceService.readGames === undefined)
          throw new Error("Analyst readGames is not configured");
        return evidenceService.readGames(snapshot, parameters.gameIds, {
          fields: parameters.fields,
        });
      },
      summarize: (parameters) => {
        if (evidenceService.summarize === undefined)
          throw new Error("Analyst summarize is not configured");
        return evidenceService.summarize(snapshot, request(parameters));
      },
    },
  });
}

/**
 * The Analyst-only provider seam. It exposes only bounded, model-directed
 * collection operations while the evidence service retains authorization,
 * citation construction, and dependency revalidation.
 */
export function createAnalystTurnService(deps: {
  provider: GroundedAnalysisProvider;
  evidenceService: AnalystEvidenceService;
  log?: AnalystTurnLogSink;
}) {
  const log = deps.log ?? ((record) => console.info(JSON.stringify(record)));
  return Object.freeze({
    async run(input: {
      systemPrompt: string;
      prompt: string;
      signal: AbortSignal;
      audit: GroundedModelAuditContext;
      mandatoryUncertaintyCitationIds?: ReadonlySet<string>;
    }): Promise<
      | (GroundedAnalysisResult<AnalystFinal> & {
          readonly retrieved: readonly AnalystRetrievedEvidence[];
        })
      | {
          readonly valid: false;
          readonly reason: "invalid-submission" | "source-changed" | "handoff-failed";
          readonly diagnostic?: AnalystValidationDiagnostic;
        }
    > {
      throwIfAborted(input.signal);
      const captureStarted = Date.now();
      logStage(log, input.audit, "capture", "attempt");
      let snapshot: Awaited<ReturnType<AnalystEvidenceService["capture"]>>;
      try {
        snapshot = await abortable(deps.evidenceService.capture(), input.signal);
      } catch (error) {
        logStage(log, input.audit, "capture", "failed", {
          durationMs: Date.now() - captureStarted,
          failure: input.signal.aborted ? "cancelled" : "capture-failed",
        });
        throw error;
      }
      logStage(log, input.audit, "capture", "success", { durationMs: Date.now() - captureStarted });
      throwIfAborted(input.signal);
      logStage(log, input.audit, "provider", "attempt");
      let result: GroundedAnalysisResult<z.infer<typeof AnalystSubmissionSchema>>;
      try {
        result = await deps.provider.analyze({
          ...input,
          submissionSchema: AnalystSubmissionSchema,
          allowedTools: createCollectionAnalystToolManifest(),
          retrievalTools: analystTools(
            deps.evidenceService,
            snapshot,
            input.signal,
            input.audit,
            log,
          ),
        });
      } catch (error) {
        logStage(log, input.audit, "provider", "failed", {
          failure: input.signal.aborted ? "cancelled" : "provider-failed",
        });
        throw error;
      }
      logStage(log, input.audit, "provider", "success");
      throwIfAborted(input.signal);
      const submission = { ...result.output, usage: result.usage };
      let accumulated: AnalystRetrievedEvidence;
      try {
        accumulated = await abortable(
          deps.evidenceService.accumulatedEvidence(snapshot),
          input.signal,
        );
      } catch (error) {
        throwIfAborted(input.signal);
        const sourceChanged = error instanceof AnalystEvidenceSourceChangedError;
        logStage(log, input.audit, "evidence-handoff", "failed", {
          failure: sourceChanged ? "source-changed" : "accumulation-failed",
        });
        return { valid: false, reason: sourceChanged ? "source-changed" : "handoff-failed" };
      }
      const validate = () => {
        logStage(log, input.audit, "validation", "attempt");
        const validated = validateAnalystResult({
          submission,
          evidence: accumulated.evidence,
          registeredCitations: accumulated.citations,
          mandatoryUncertaintyCitationIds: input.mandatoryUncertaintyCitationIds,
        });
        logStage(
          log,
          input.audit,
          "validation",
          validated.valid ? "success" : "rejected",
          validated.valid ? {} : { diagnostic: validated.diagnostic },
        );
        return validated;
      };
      try {
        throwIfAborted(input.signal);
        logStage(log, input.audit, "evidence-handoff", "attempt", {
          evidenceSourceCount: accumulated.scope.matchingSourceCount,
        });
        const validated = await abortable(
          deps.evidenceService.handoff(snapshot, accumulated, () => {
            throwIfAborted(input.signal);
            return Promise.resolve(validate());
          }),
          input.signal,
        );
        throwIfAborted(input.signal);
        logStage(
          log,
          input.audit,
          "evidence-handoff",
          validated.valid ? "success" : "rejected",
          validated.valid ? {} : { diagnostic: validated.diagnostic },
        );
        return validated.valid && validated.result
          ? Object.freeze({
              output: validated.result,
              usage: result.usage,
              retrieved: [accumulated],
            })
          : { valid: false, reason: "invalid-submission", diagnostic: validated.diagnostic };
      } catch (error) {
        throwIfAborted(input.signal);
        const sourceChanged = error instanceof AnalystEvidenceSourceChangedError;
        logStage(log, input.audit, "evidence-handoff", "failed", {
          failure: sourceChanged ? "source-changed" : "handoff-failed",
        });
        return { valid: false, reason: sourceChanged ? "source-changed" : "handoff-failed" };
      }
    },
  });
}
