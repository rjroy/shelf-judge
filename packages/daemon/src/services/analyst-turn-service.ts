import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AnalystFinal, AnalystReadGamesField } from "@shelf-judge/shared";
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
import {
  COLLECTION_GREP_TOOL_NAME,
  COLLECTION_READ_GAMES_TOOL_NAME,
  COLLECTION_SUMMARIZE_TOOL_NAME,
  COLLECTION_TOP_TOOL_NAME,
  createCollectionAnalystToolManifest,
} from "./grounded-analysis/structured-submission.js";
import type { GroundedModelAuditContext } from "./grounded-analysis/model-logger.js";

const CursorParameters = Type.Object(
  { token: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);
const TopParameters = Type.Object(
  {
    rankBy: Type.Literal("fitness"),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(Type.Union([Type.Null(), CursorParameters])),
  },
  { additionalProperties: false },
);
const GrepParameters = Type.Object(
  {
    pattern: Type.String({ minLength: 1, maxLength: 128 }),
    allowedFields: Type.Array(
      Type.Union([
        Type.Literal("notes"),
        Type.Literal("metadata.mechanics"),
        Type.Literal("metadata.categories"),
        Type.Literal("metadata.description"),
      ]),
      { minItems: 1, maxItems: 4 },
    ),
    gameIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100 }),
    cursor: Type.Optional(Type.Union([Type.Null(), CursorParameters])),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);
const ReadGamesParameters = Type.Object(
  {
    gameIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 10 }),
    fields: Type.Array(
      Type.Union([
        Type.Literal("game-identity-ownership"),
        Type.Literal("current-scoring"),
        Type.Literal("imported-metadata"),
        Type.Literal("play-acquisition"),
        Type.Literal("collection-structure"),
        Type.Literal("owner-game-note"),
      ]),
      { minItems: 1, maxItems: 6 },
    ),
  },
  { additionalProperties: false },
);
const SummarizeParameters = Type.Object(
  {
    groupBy: Type.Union([Type.Literal("metadata.mechanics"), Type.Literal("metadata.categories")]),
    measures: Type.Array(Type.Union([Type.Literal("gameCount"), Type.Literal("averageFitness")]), {
      minItems: 1,
      maxItems: 2,
    }),
    cursor: Type.Optional(Type.Union([Type.Null(), CursorParameters])),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);

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

function toolArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Analyst tool arguments must be an object");
  return Object.fromEntries(Object.entries(value));
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
): readonly ToolDefinition[] {
  let serializedBytes = 0;
  let toolIndex = 0;
  const createTool = (
    name: string,
    label: string,
    description: string,
    parameters: ToolDefinition["parameters"],
    operation: (parameters: Record<string, unknown>) => Promise<unknown>,
  ): ToolDefinition =>
    defineTool({
      name,
      label,
      description,
      parameters,
      async execute(_toolCallId, parameters) {
        const started = Date.now();
        const callIndex = toolIndex++;
        logStage(log, audit, name, "attempt", { callIndex });
        throwIfAborted(signal);
        let result: unknown;
        try {
          result = await abortable(operation(toolArguments(parameters)), signal);
        } catch (error) {
          logStage(log, audit, name, "failed", {
            durationMs: Date.now() - started,
            failure: signal.aborted ? "cancelled" : "evidence-operation-failed",
          });
          throw error;
        }
        throwIfAborted(signal);
        const serialized = JSON.stringify(modelVisible(result));
        const bytes = new TextEncoder().encode(serialized).byteLength;
        if (
          bytes > ANALYST_TOOL_RESULT_MAX_BYTES ||
          serializedBytes + bytes > ANALYST_TOOL_TURN_MAX_BYTES
        ) {
          logStage(log, audit, name, "rejected", {
            durationMs: Date.now() - started,
            bytes,
            rejection: "context-limit",
            callIndex,
          });
          return {
            content: [{ type: "text", text: TOOL_CONTEXT_LIMIT_MESSAGE }],
            details: undefined,
          };
        }
        throwIfAborted(signal);
        serializedBytes += bytes;
        logStage(log, audit, name, "success", {
          durationMs: Date.now() - started,
          bytes,
          callIndex,
        });
        return {
          content: [{ type: "text", text: serialized }],
          details: undefined,
        };
      },
    });
  const request = (parameters: Record<string, unknown>) => ({
    ...parameters,
    snapshotFingerprint: snapshot.snapshotFingerprint,
    ...(parameters.cursor === undefined || parameters.cursor === null
      ? {}
      : { cursor: { snapshotFingerprint: snapshot.snapshotFingerprint, ...parameters.cursor } }),
  });
  return Object.freeze([
    createTool(
      COLLECTION_TOP_TOOL_NAME,
      "Rank collection games",
      "Rank owned games by fitness. Each returned entry includes compact identity and scoring evidence that may be cited directly.",
      TopParameters,
      (parameters) => evidenceService.top(snapshot, request(parameters)),
    ),
    createTool(
      COLLECTION_GREP_TOOL_NAME,
      "Search collection evidence",
      "Search selected game fields. Matches are discovery-only and are not authorized evidence: call readGames for the matching field before citing its content.",
      GrepParameters,
      (parameters) => evidenceService.grep(snapshot, request(parameters)),
    ),
    createTool(
      COLLECTION_READ_GAMES_TOOL_NAME,
      "Read selected games",
      "Read bounded evidence fields for explicitly named games.",
      ReadGamesParameters,
      (parameters) => {
        if (evidenceService.readGames === undefined)
          throw new Error("Analyst readGames is not configured");
        return evidenceService.readGames(snapshot, parameters.gameIds as readonly string[], {
          fields: parameters.fields as readonly AnalystReadGamesField[],
        });
      },
    ),
    createTool(
      COLLECTION_SUMMARIZE_TOOL_NAME,
      "Summarize collection",
      "Emit a deterministic aggregate over collection metadata.",
      SummarizeParameters,
      (parameters) => {
        if (evidenceService.summarize === undefined)
          throw new Error("Analyst summarize is not configured");
        return evidenceService.summarize(snapshot, request(parameters));
      },
    ),
  ]);
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
