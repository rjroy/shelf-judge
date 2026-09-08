import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AnalystCitation, AnalystFinal } from "@shelf-judge/shared";
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
import type { GroundedEvidenceSnapshot } from "./grounded-analysis/evidence-registry.js";
import {
  validateAnalystResult,
  type AnalystValidationDiagnostic,
} from "./analyst-result-validator.js";
import {
  ANALYST_EVIDENCE_RETRIEVAL_TOOL_NAME,
  createAnalystToolManifest,
} from "./grounded-analysis/structured-submission.js";
import type { GroundedModelAuditContext } from "./grounded-analysis/model-logger.js";

const RetrievalParameters = Type.Object(
  {
    evidenceClasses: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    gameIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    noteSearch: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    cursor: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Object(
          {
            snapshotFingerprint: Type.String({ minLength: 1 }),
            token: Type.String({ format: "uuid" }),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

// Retrieval responses become model context on the next inference round. Keep an
// Analyst-specific ceiling in addition to the provider's round-trip ceiling.
const ANALYST_RETRIEVAL_RESULT_MAX_BYTES = 64 * 1024;
const ANALYST_RETRIEVAL_TURN_MAX_BYTES = 192 * 1024;
const RETRIEVAL_CONTEXT_LIMIT_MESSAGE =
  "Evidence retrieval is unavailable because the Analyst context limit was reached.";

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

function serializedRetrievalResult(retrieved: AnalystRetrievedEvidence): string {
  return JSON.stringify({
    evidence: retrieved.evidence,
    citations: retrieved.citations,
    nextCursor: retrieved.nextCursor,
    scope: retrieved.scope,
  });
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

function combinedEvidence(pages: readonly AnalystRetrievedEvidence[]): GroundedEvidenceSnapshot {
  const entries = pages.flatMap((page) => page.evidence.entries);
  const citations = new Map(entries.map((entry) => [entry.citationId, entry]));
  if (citations.size !== entries.length) throw new Error("Analyst evidence pages overlap");
  const examinedSources = pages.flatMap((page) => page.evidence.examinedSources);
  const sources = new Set(
    examinedSources.map(({ evidenceClass, sourceId, sourceVersion }) =>
      [evidenceClass, sourceId, sourceVersion].join("\u0000"),
    ),
  );
  if (sources.size !== examinedSources.length) throw new Error("Analyst evidence pages overlap");
  return Object.freeze({
    manifestId: "collection-analyst-retrieved-pages",
    manifestVersion: "1",
    evidenceClasses: Object.freeze(
      [...new Set(pages.flatMap((page) => page.evidence.evidenceClasses))].sort(),
    ),
    examinedSources: Object.freeze([...examinedSources]),
    entries: Object.freeze([...entries]),
    hasSource(source: GroundedEvidenceSnapshot["examinedSources"][number]) {
      return sources.has(
        [source.evidenceClass, source.sourceId, source.sourceVersion].join("\u0000"),
      );
    },
    resolve(citationId: string) {
      return citations.get(citationId);
    },
  });
}

function combinedCitations(pages: readonly AnalystRetrievedEvidence[]): readonly AnalystCitation[] {
  const citations = pages.flatMap((page) => page.citations);
  if (new Set(citations.map(({ citationId }) => citationId)).size !== citations.length)
    throw new Error("Analyst citation pages overlap");
  return Object.freeze(citations);
}

function retrievalTool(
  evidenceService: AnalystEvidenceService,
  snapshot: Awaited<ReturnType<AnalystEvidenceService["capture"]>>,
  signal: AbortSignal,
  onRetrieved: (retrieved: AnalystRetrievedEvidence) => void,
  audit: GroundedModelAuditContext,
  log: AnalystTurnLogSink,
): ToolDefinition {
  let serializedBytes = 0;
  let retrievalIndex = 0;
  return defineTool({
    name: ANALYST_EVIDENCE_RETRIEVAL_TOOL_NAME,
    label: "Retrieve collection evidence",
    description: "Read one authorized, paginated page of collection evidence for this turn.",
    parameters: RetrievalParameters,
    async execute(_toolCallId, parameters) {
      const started = Date.now();
      const pageIndex = retrievalIndex++;
      logStage(log, audit, "retrieval", "attempt", {
        pageIndex,
        cursorPresent: parameters.cursor !== undefined && parameters.cursor !== null,
      });
      throwIfAborted(signal);
      let retrieved: AnalystRetrievedEvidence;
      try {
        retrieved = await abortable(
          evidenceService.retrieve(snapshot, {
            ...parameters,
            snapshotFingerprint: snapshot.snapshotFingerprint,
          }),
          signal,
        );
      } catch (error) {
        logStage(log, audit, "retrieval", "failed", {
          durationMs: Date.now() - started,
          failure: signal.aborted ? "cancelled" : "retrieve-failed",
        });
        throw error;
      }
      throwIfAborted(signal);
      const serialized = serializedRetrievalResult(retrieved);
      const bytes = new TextEncoder().encode(serialized).byteLength;
      if (
        bytes > ANALYST_RETRIEVAL_RESULT_MAX_BYTES ||
        serializedBytes + bytes > ANALYST_RETRIEVAL_TURN_MAX_BYTES
      ) {
        logStage(log, audit, "retrieval", "rejected", {
          durationMs: Date.now() - started,
          bytes,
          rejection: "context-limit",
          pageIndex,
          sourceCount: retrieved.scope.matchingSourceCount,
          citationCount: retrieved.citations.length,
          cursorPresent: retrieved.nextCursor !== null,
        });
        return {
          content: [{ type: "text", text: RETRIEVAL_CONTEXT_LIMIT_MESSAGE }],
          details: undefined,
        };
      }
      throwIfAborted(signal);
      serializedBytes += bytes;
      onRetrieved(retrieved);
      logStage(log, audit, "retrieval", "success", {
        durationMs: Date.now() - started,
        bytes,
        pageIndex,
        sourceCount: retrieved.scope.matchingSourceCount,
        citationCount: retrieved.citations.length,
        cursorPresent: retrieved.nextCursor !== null,
      });
      return {
        content: [
          {
            type: "text",
            text: serialized,
          },
        ],
        details: undefined,
      };
    },
  });
}

/**
 * The Analyst-only provider seam. It owns the sole model-visible retrieval tool;
 * the evidence service retains authorization, pagination, citation construction,
 * and dependency revalidation.
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
      const retrieved: AnalystRetrievedEvidence[] = [];
      logStage(log, input.audit, "provider", "attempt");
      let result: GroundedAnalysisResult<z.infer<typeof AnalystSubmissionSchema>>;
      try {
        result = await deps.provider.analyze({
          ...input,
          submissionSchema: AnalystSubmissionSchema,
          allowedTools: createAnalystToolManifest(),
          retrievalTools: [
            retrievalTool(
              deps.evidenceService,
              snapshot,
              input.signal,
              (page) => {
                retrieved.push(page);
              },
              input.audit,
              log,
            ),
          ],
        });
      } catch (error) {
        logStage(log, input.audit, "provider", "failed", {
          failure: input.signal.aborted ? "cancelled" : "provider-failed",
        });
        throw error;
      }
      logStage(log, input.audit, "provider", "success", { retrievedPageCount: retrieved.length });
      throwIfAborted(input.signal);
      const pages = Object.freeze([...retrieved]);
      const submission = { ...result.output, usage: result.usage };
      const validate = () => {
        logStage(log, input.audit, "validation", "attempt", { retrievedPageCount: pages.length });
        const validated = validateAnalystResult({
          submission,
          evidence: combinedEvidence(pages),
          registeredCitations: combinedCitations(pages),
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
      if (pages.length === 0) {
        const validated = validate();
        return validated.valid && validated.result
          ? Object.freeze({ output: validated.result, usage: result.usage, retrieved: pages })
          : { valid: false, reason: "invalid-submission", diagnostic: validated.diagnostic };
      }
      const latest = pages.at(-1);
      if (latest === undefined) throw new Error("Expected an Analyst evidence page");
      try {
        throwIfAborted(input.signal);
        logStage(log, input.audit, "evidence-handoff", "attempt", {
          retrievedPageCount: pages.length,
        });
        const validated = await abortable(
          deps.evidenceService.handoff(snapshot, latest, () => {
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
          ? Object.freeze({ output: validated.result, usage: result.usage, retrieved: pages })
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
