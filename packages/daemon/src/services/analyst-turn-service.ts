import type { AnalystFinal } from "@shelf-judge/shared";
import type {
  AnalystEvidenceService,
  AnalystRetrievedEvidence,
} from "./analyst-evidence-service.js";
import { AnalystEvidenceSourceChangedError } from "./analyst-evidence-service.js";
import type {
  GroundedAnalysisProvider,
  GroundedAnalysisResult,
} from "./grounded-analysis/provider.js";
import { createCollectionAnalystToolManifest } from "./grounded-analysis/structured-submission.js";
import type { GroundedModelAuditContext } from "./grounded-analysis/model-logger.js";
import { createCollectionTools } from "./grounded-analysis/collection-tools.js";
import { createGroundedToolLifecycleDiagnostics } from "./grounded-analysis/tool-lifecycle.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";

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

function freeformFinal(text: string, usage: GroundedAnalysisResult<string>["usage"]): AnalystFinal {
  return { outcome: "answered", blocks: [{ text, citationIds: [] }], citations: [], usage };
}

function analystTools(
  evidenceService: AnalystEvidenceService,
  snapshot: Awaited<ReturnType<AnalystEvidenceService["capture"]>>,
  signal: AbortSignal,
  audit: GroundedModelAuditContext,
  log: AnalystTurnLogSink,
  toolLifecycle: ReturnType<typeof createGroundedToolLifecycleDiagnostics>,
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
    redact: modelVisible,
    onStage: ({ name, outcome, ...details }) => logStage(log, audit, name, outcome, details),
    toolLifecycle,
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
    }): Promise<
      | (GroundedAnalysisResult<AnalystFinal> & {
          readonly retrieved: readonly AnalystRetrievedEvidence[];
        })
      | {
          readonly valid: false;
          readonly reason: "source-changed" | "handoff-failed";
          /** Kept as an empty compatibility seam while free-form turns have no semantic validator. */
          readonly diagnostic?: undefined;
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
       const audit = { ...input.audit, evidenceIdentityHash: canonicalSha256({ snapshotFingerprint: snapshot.snapshotFingerprint }) };
       logStage(log, audit, "capture", "success", { durationMs: Date.now() - captureStarted });
      throwIfAborted(input.signal);
       logStage(log, audit, "provider", "attempt");
      const toolLifecycle = createGroundedToolLifecycleDiagnostics();
       let result: GroundedAnalysisResult<string>;
      try {
         if (deps.provider.analyzeFreeform === undefined)
           throw new Error("Collection Analyst provider does not support free-form execution");
         result = await deps.provider.analyzeFreeform({
           ...input,
           audit,
          allowedTools: createCollectionAnalystToolManifest(),
          retrievalTools: analystTools(
            deps.evidenceService,
            snapshot,
            input.signal,
             audit,
            log,
            toolLifecycle,
          ),
          toolLifecycle,
        });
      } catch (error) {
         logStage(log, audit, "provider", "failed", {
          failure: input.signal.aborted ? "cancelled" : "provider-failed",
        });
        throw error;
      }
       logStage(log, audit, "provider", "success");
      throwIfAborted(input.signal);
      let accumulated: AnalystRetrievedEvidence;
      try {
        accumulated = await abortable(
          deps.evidenceService.accumulatedEvidence(snapshot),
          input.signal,
        );
      } catch (error) {
        throwIfAborted(input.signal);
        const sourceChanged = error instanceof AnalystEvidenceSourceChangedError;
         logStage(log, audit, "evidence-handoff", "failed", {
          failure: sourceChanged ? "source-changed" : "accumulation-failed",
        });
        return { valid: false, reason: sourceChanged ? "source-changed" : "handoff-failed" };
      }
       try {
        throwIfAborted(input.signal);
         logStage(log, audit, "evidence-handoff", "attempt", {
          evidenceSourceCount: accumulated.scope.matchingSourceCount,
        });
        const validated = await abortable(
           deps.evidenceService.handoff(snapshot, accumulated, () => {
             throwIfAborted(input.signal);
             return Promise.resolve({ valid: true, result: result.output });
          }),
          input.signal,
        );
        throwIfAborted(input.signal);
        logStage(
          log,
           audit,
          "evidence-handoff",
           validated.valid ? "success" : "rejected",
        );
        return validated.valid && validated.result
          ? Object.freeze({
               output: freeformFinal(validated.result, result.usage),
              usage: result.usage,
              retrieved: [accumulated],
            })
           : { valid: false, reason: "handoff-failed" };
      } catch (error) {
        throwIfAborted(input.signal);
        const sourceChanged = error instanceof AnalystEvidenceSourceChangedError;
         logStage(log, audit, "evidence-handoff", "failed", {
          failure: sourceChanged ? "source-changed" : "handoff-failed",
        });
        return { valid: false, reason: sourceChanged ? "source-changed" : "handoff-failed" };
      }
    },
  });
}
