import {
  AnalystAbstentionReasonSchema,
  AnalystAnswerBlockSchema,
  AnalystFinalSchema,
  AnalystCitationInspectionUnsignedRecordSchema,
  AnalystCitationInspectionViewSchema,
  ANALYST_CITATION_INSPECTION_MAX_COUNT,
  ANALYST_CITATION_INSPECTION_MAX_RECORD_BYTES,
  ANALYST_CITATION_INSPECTION_MAX_TOTAL_BYTES,
  type AnalystFinal,
} from "@shelf-judge/shared";
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
import { createCollectionAnalystToolManifest } from "./grounded-analysis/structured-submission.js";
import type { GroundedModelAuditContext } from "./grounded-analysis/model-logger.js";
import { createCollectionTools } from "./grounded-analysis/collection-tools.js";
import { createGroundedToolLifecycleDiagnostics } from "./grounded-analysis/tool-lifecycle.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import { randomBytes } from "node:crypto";
import {
  createAnalystBggTools,
  type AnalystBggEvidenceRegistry,
} from "./grounded-analysis/analyst-bgg-tools.js";
import { ANALYST_BGG_TOOL_NAMES } from "./grounded-analysis/structured-submission.js";
import type { BoardgameFactResult, BggClient, BggRequestAttemptBudget } from "./bgg-client.js";

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

function safeBggCode(
  code: string,
):
  | "MissingGame"
  | "NonBoardgame"
  | "MismatchedId"
  | "BggUnauthorized"
  | "BggThrottled"
  | "BggQueuedTimeout"
  | "BggOutage"
  | "BggParse" {
  switch (code) {
    case "MissingGame":
      return "MissingGame";
    case "NonBoardgame":
      return "NonBoardgame";
    case "MismatchedId":
      return "MismatchedId";
    case "unauthorized":
    case "BggUnauthorized":
      return "BggUnauthorized";
    case "rate-limited":
    case "BggThrottled":
      return "BggThrottled";
    case "queued":
    case "BggQueuedTimeout":
      return "BggQueuedTimeout";
    case "parse":
    case "BggParse":
      return "BggParse";
    default:
      return "BggOutage";
  }
}

export function projectFitnessPreview(
  raw: unknown,
  bggId: number,
  registry: AnalystBggEvidenceRegistry,
  verifiedFact?: BoardgameFactResult,
): unknown {
  const outcome = raw as {
    kind?: string;
    gameIds?: string[];
    code?: string;
    result?: import("./prediction-service.js").PredictedGameResult;
  };
  if (outcome.kind === "ambiguous")
    return {
      status: "partial",
      state: "ambiguous",
      bggId,
      collectionGameIds: (outcome.gameIds ?? []).slice(0, 10),
      code: "AmbiguousCollectionMatch",
    };
  if (outcome.kind === "failed")
    if (outcome.code === "attempt-budget" || outcome.code === "BudgetExhausted")
      return { status: "error", code: "BudgetExhausted", retryable: false };
    else
      return {
        status: "unavailable",
        state: "unavailable",
        bggId,
        code: safeBggCode(outcome.code ?? "BggOutage"),
        retryable: ["BggThrottled", "BggQueuedTimeout", "BggOutage"].includes(
          safeBggCode(outcome.code ?? "BggOutage"),
        ),
        predictionUnavailable: null,
      };
  const calculated = outcome.result;
  if (!calculated) return { status: "error", code: "PredictionUnavailable", retryable: false };
  const { game, score, previewIdentity, predictionUnavailable, bggVerification } = calculated;
  const calculatedAt = previewIdentity?.calculatedAt ?? new Date().toISOString();
  const version = previewIdentity
    ? `${previewIdentity.calculationVersion}:${canonicalSha256({ collectionRevision: previewIdentity.collectionRevision, predictionSettingsVersion: previewIdentity.predictionSettingsVersion, tournamentDataVersion: previewIdentity.tournamentDataVersion, bggObservedAt: previewIdentity.bggObservedAt })}`
    : "bgg-fitness-preview-v2:unknown";
  const isExisting = !game.id.startsWith("preview-");
  const unavailable =
    predictionUnavailable?.reason === "stage-0"
      ? {
          reason: "stage-0" as const,
          ratedGameCount: predictionUnavailable.ratedGameCount,
          gamesNeeded: predictionUnavailable.gamesNeeded,
        }
      : null;
  const axes = score.breakdown.slice(0, 20).map((axis) => ({
    axisId: axis.axisId.slice(0, 80),
    axisName: [...axis.axisName].slice(0, 160).join("") || axis.axisId,
    value: axis.effectiveRating,
    source:
      axis.source === "predicted"
        ? ("predicted" as const)
        : axis.source === "derived"
          ? ("derived" as const)
          : axis.effectiveRating === null
            ? ("missing" as const)
            : ("actual" as const),
    confidence: axis.predictionConfidence,
  }));
  const referenceGames = [
    ...new Map(
      score.breakdown
        .flatMap((axis) => axis.referenceGames ?? [])
        .map((reference) => [reference.gameId, reference]),
    ).values(),
  ]
    .slice(0, 5)
    .map(({ gameId, gameName }) => ({
      gameId,
      gameName: [...gameName].slice(0, 160).join("") || gameId,
    }));
  const label =
    game.id.startsWith("preview-") || score.predictionMeta !== null
      ? ("predicted" as const)
      : ("actual" as const);
  const previewScore = {
    value: score.score,
    label,
    readinessStage: score.predictionMeta?.readinessStage ?? 3,
    confidence:
      label === "actual"
        ? ("actual" as const)
        : (score.predictionMeta?.confidence ?? ("insufficient" as const)),
    predictionUnavailable: unavailable,
    axes,
    referenceGames,
  };
  if (!isExisting && unavailable && score.ratedAxisCount === 0)
    return {
      status: "unavailable",
      state: "unavailable",
      bggId,
      code: "PredictionUnavailable",
      retryable: false,
      predictionUnavailable: unavailable,
    };
  let factCitationId: string | undefined;
  // Existing collection records are local scoring inputs, not BGG testimony.
  // Only cite an actual verified Thing payload (or the temporary game that was
  // constructed exclusively from one), never local Game metadata.
  const actualVerifiedFact = calculated.verifiedFact ?? verifiedFact;
  const thing =
    actualVerifiedFact?.bggId === bggId
      ? actualVerifiedFact
      : isExisting || bggVerification?.status === "existing-local-unverified"
        ? undefined
        : previewIdentity?.bggObservedAt && game.name
          ? {
              bggId,
              primaryName: game.name,
              yearPublished: game.yearPublished ?? null,
              yearMissing: game.yearPublished == null,
              mechanics: game.bggData?.mechanics ?? [],
              mechanicsMissing: false,
              mechanicsComplete: true,
              warnings: [],
              observedAt: previewIdentity.bggObservedAt,
            }
          : undefined;
  if (thing) {
    const observedAt = thing.observedAt;
    factCitationId = registry.stage({
      evidenceClass: "bgg-thing-facts",
      sourceId: `bgg:${bggId}:${observedAt}`,
      observedAt,
      payload: {
        bggId,
        primaryName: thing.primaryName,
        yearPublished: thing.yearPublished,
        mechanics: thing.mechanics
          .slice(0, 20)
          .map(({ id, name }) => ({ id, name: [...name].slice(0, 80).join("") })),
        missingFields: [
          ...(thing.yearMissing ? ["year"] : []),
          ...(thing.mechanicsMissing ? ["mechanics"] : []),
        ],
        warnings: thing.warnings,
      },
      destination: `https://boardgamegeek.com/boardgame/${bggId}`,
    });
  }
  const calculationCitationId = registry.stage({
    evidenceClass: "bgg-preview-calculation",
    sourceId: `preview:${bggId}:${version}`,
    observedAt: calculatedAt,
    payload: {
      bggId,
      score: score.score,
      readinessStage: previewScore.readinessStage,
      sourceVersion: version,
    },
    destination: "calculation",
  });
  if (isExisting) {
    const collectionCitationId = registry.stage({
      evidenceClass: "current-scoring",
      sourceId: `game:${game.id}:${version}`,
      payload: { gameId: game.id, name: game.name, score: score.score, ownership: game.ownership },
      destination: `game:${game.id}`,
    });
    const ownership =
      game.ownership === "owned" || game.ownership === "previously-owned"
        ? game.ownership
        : "other";
    if (bggVerification?.status === "existing-local-unverified" || !factCitationId) {
      const code =
        bggVerification?.status === "existing-local-unverified"
          ? safeBggCode(bggVerification.failure)
          : "BggParse";
      return {
        status: "partial",
        state: "existing-local-unverified",
        bggId,
        bggLookup: {
          status: "failed",
          code,
          retryable: ["BggThrottled", "BggQueuedTimeout", "BggOutage"].includes(code),
        },
        calculatedAt,
        sourceVersion: version,
        calculationCitationId,
        collectionGameId: game.id,
        collectionName: game.name,
        ownership,
        collectionCitationId,
        score: previewScore,
      };
    }
    return {
      status: "ok",
      state: "existing",
      bggId,
      primaryName: thing!.primaryName,
      bggLookup: { status: "verified", observedAt: thing!.observedAt, factCitationId },
      calculatedAt,
      sourceVersion: version,
      calculationCitationId,
      collectionGameId: game.id,
      ownership,
      collectionCitationId,
      score: previewScore,
    };
  }
  if (!factCitationId)
    return {
      status: "unavailable",
      state: "unavailable",
      bggId,
      code: "BggParse",
      retryable: false,
      predictionUnavailable: unavailable,
    };
  return {
    status: "ok",
    state: "predicted",
    bggId,
    primaryName: thing!.primaryName,
    bggLookup: { status: "verified", observedAt: thing!.observedAt, factCitationId },
    calculatedAt,
    sourceVersion: version,
    calculationCitationId,
    score: previewScore,
  };
}

const AnalystSubmissionSchema = z
  .object({
    outcome: z.enum(["answered", "partial", "abstained"]),
    blocks: z.array(AnalystAnswerBlockSchema).min(1),
    reason: AnalystAbstentionReasonSchema.optional(),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.outcome === "abstained" && submission.reason === undefined)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"] });
    if (submission.outcome !== "abstained" && submission.reason !== undefined)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"] });
  });

function analystTools(
  evidenceService: AnalystEvidenceService,
  snapshot: Awaited<ReturnType<AnalystEvidenceService["capture"]>>,
  signal: AbortSignal,
  audit: GroundedModelAuditContext,
  log: AnalystTurnLogSink,
  toolLifecycle: ReturnType<typeof createGroundedToolLifecycleDiagnostics>,
  reserveToolInvocation: () => boolean,
): ReturnType<typeof createCollectionTools> {
  const request = (parameters: Record<string, unknown>) => ({
    ...parameters,
    snapshotFingerprint: snapshot.snapshotFingerprint,
    ...(parameters.cursor === undefined || parameters.cursor === null
      ? {}
      : { cursor: { snapshotFingerprint: snapshot.snapshotFingerprint, ...parameters.cursor } }),
  });
  const tools = createCollectionTools({
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
  return tools.map((tool) => ({
    ...tool,
    execute: async (...args: Parameters<typeof tool.execute>) => {
      if (!reserveToolInvocation())
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ status: "error", code: "BudgetExhausted", retryable: false }),
            },
          ],
          details: undefined,
        };
      return tool.execute(...args);
    },
  })) as ReturnType<typeof createCollectionTools>;
}

/**
 * The Analyst-only provider seam. It exposes only bounded, model-directed
 * collection operations while the evidence service retains authorization,
 * citation construction, and dependency revalidation.
 */
export function createAnalystTurnService(deps: {
  provider: GroundedAnalysisProvider;
  evidenceService: AnalystEvidenceService;
  bggClient?: BggClient;
  previewFitness?: (
    id: number,
    options: {
      signal: AbortSignal;
      attemptBudget: BggRequestAttemptBudget;
      cachedFact?: import("./bgg-client.js").BoardgameFactResult;
    },
  ) => Promise<unknown>;
  log?: AnalystTurnLogSink;
}) {
  const log = deps.log ?? ((record) => console.info(JSON.stringify(record)));
  return Object.freeze({
    async run(input: {
      systemPrompt: string;
      prompt: string;
      signal: AbortSignal;
      audit: GroundedModelAuditContext;
      ownerMessages?: readonly (string | { index: number; content: string })[];
      acceptedDiscoveryIds?: readonly number[];
      conversationId?: string;
      turnIndex?: number;
    }): Promise<
      | (GroundedAnalysisResult<AnalystFinal> & {
          readonly retrieved: readonly AnalystRetrievedEvidence[];
          /** Unsigned, ephemeral inspection records for the route to bind and sign. */
          readonly inspectionRecords: readonly z.infer<
            typeof AnalystCitationInspectionUnsignedRecordSchema
          >[];
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
      const audit = {
        ...input.audit,
        evidenceIdentityHash: canonicalSha256({
          snapshotFingerprint: snapshot.snapshotFingerprint,
        }),
      };
      logStage(log, audit, "capture", "success", { durationMs: Date.now() - captureStarted });
      throwIfAborted(input.signal);
      logStage(log, audit, "provider", "attempt");
      const toolLifecycle = createGroundedToolLifecycleDiagnostics();
      const stagedBgg = new Map<
        string,
        {
          evidenceClass: string;
          sourceId: string;
          observedAt?: string;
          payload: unknown;
          destination: string;
        }
      >();
      const committedBgg = new Set<string>();
      const stageRegistry: AnalystBggEvidenceRegistry = {
        stage(record) {
          const id = `abgg_${randomBytes(18).toString("base64url")}`;
          stagedBgg.set(id, record);
          return id;
        },
        commit(ids) {
          ids.forEach((id) => committedBgg.add(id));
        },
        discard(ids) {
          ids.forEach((id) => {
            stagedBgg.delete(id);
            committedBgg.delete(id);
          });
        },
      };
      const discardStagedBgg = () => stageRegistry.discard([...stagedBgg.keys()]);
      const discovery: unknown[] = [];
      const fitnessPreview: unknown[] = [];
      const thingFacts: unknown[] = [];
      const emittedIds = new Set<number>();
      let invocationCount = 0;
      const reserveToolInvocation = () => {
        if (invocationCount >= 24) return false;
        invocationCount++;
        return true;
      };
      const limitedToolLifecycle = {
        ...toolLifecycle,
        dispatch(name: string, kind: "submission" | "retrieval") {
          if (kind === "submission" && !reserveToolInvocation())
            throw new Error("Analyst tool invocation budget exhausted");
          return toolLifecycle.dispatch(name, kind);
        },
      };
      let httpAttempts = 0;
      const httpAttemptBudget: BggRequestAttemptBudget = {
        tryConsume: () => {
          if (httpAttempts >= 12) return false;
          httpAttempts++;
          return true;
        },
      };
      const bggTools = createAnalystBggTools({
        signal: input.signal,
        ownerMessages: (input.ownerMessages ?? []).map((message) =>
          typeof message === "string" ? message : message.content,
        ),
        registry: stageRegistry,
        isIdAuthorized: (id) => input.acceptedDiscoveryIds?.includes(id) ?? false,
        configured: () => !!deps.bggClient?.isConfigured(),
        turnBudget: { reserveToolInvocation, reserveThingIds: () => true, httpAttemptBudget },
        transport: {
          searchTitles: (query, options) =>
            deps.bggClient?.searchBoardgameTitles?.(query, options) ??
            Promise.reject(Object.assign(new Error("Not configured"), { code: "NotConfigured" })),
          reviewHot: (options) =>
            deps.bggClient?.reviewBoardgameHot?.(options) ??
            Promise.reject(Object.assign(new Error("Not configured"), { code: "NotConfigured" })),
          readFacts: (ids, signal, budget) =>
            deps.bggClient?.getBoardgameFacts?.(ids, signal, budget) ??
            Promise.reject(Object.assign(new Error("Not configured"), { code: "NotConfigured" })),
          previewFitness: async (id, options) => {
            if (!deps.previewFitness)
              return { status: "error", code: "NotConfigured", retryable: false };
            return projectFitnessPreview(
              await deps.previewFitness(id, options),
              id,
              stageRegistry,
              options.cachedFact,
            );
          },
        },
        onAuthorizedIds: (ids) => ids.forEach((id) => emittedIds.add(id)),
        onResult: (name, value) => {
          if (name === "searchBggTitles" || name === "reviewBggHot") discovery.push(value);
          if (name === "previewBggFitness") fitnessPreview.push(value);
          if (name === "readBggFacts") thingFacts.push(value);
        },
      });
      let result: GroundedAnalysisResult<z.infer<typeof AnalystSubmissionSchema>>;
      try {
        result = await deps.provider.analyze({
          ...input,
          audit,
          submissionSchema: AnalystSubmissionSchema,
          allowedTools: createCollectionAnalystToolManifest(ANALYST_BGG_TOOL_NAMES),
          retrievalTools: [
            ...analystTools(
              deps.evidenceService,
              snapshot,
              input.signal,
              audit,
              log,
              limitedToolLifecycle,
              reserveToolInvocation,
            ),
            ...bggTools,
          ],
          toolLifecycle: limitedToolLifecycle,
        });
      } catch (error) {
        if (input.signal.aborted) discardStagedBgg();
        logStage(log, audit, "provider", "failed", {
          failure: input.signal.aborted ? "cancelled" : "provider-failed",
        });
        throw error;
      }
      logStage(log, audit, "provider", "success");
      if (input.signal.aborted) discardStagedBgg();
      throwIfAborted(input.signal);
      let accumulated: AnalystRetrievedEvidence;
      try {
        accumulated = await abortable(
          deps.evidenceService.accumulatedEvidence(snapshot),
          input.signal,
        );
      } catch (error) {
        if (input.signal.aborted) discardStagedBgg();
        throwIfAborted(input.signal);
        const sourceChanged = error instanceof AnalystEvidenceSourceChangedError;
        logStage(log, audit, "evidence-handoff", "failed", {
          failure: sourceChanged ? "source-changed" : "accumulation-failed",
        });
        return { valid: false, reason: sourceChanged ? "source-changed" : "handoff-failed" };
      }
      const citationById = new Map(
        accumulated.citations.map((citation) => [citation.citationId, citation]),
      );
      for (const id of committedBgg) {
        const record = stagedBgg.get(id);
        if (!record) continue;
        const cls = record.evidenceClass;
        const destination =
          cls === "bgg-search-observation" || cls === "bgg-hot-observation"
            ? { operationId: "shelf.analyst.discovery.get", parameters: { citationId: id } }
            : cls === "bgg-preview-calculation"
              ? { operationId: "shelf.analyst.calculation.get", parameters: { citationId: id } }
              : cls === "current-scoring"
                ? {
                    operationId: "shelf.game.get",
                    parameters: { gameId: (record.payload as { gameId: string }).gameId },
                  }
                : {
                    operationId: "shelf.bgg.item.get",
                    parameters: { bggId: Number((record.payload as { bggId?: unknown }).bggId) },
                  };
        const payloadBggId = (record.payload as { bggId?: unknown }).bggId;
        const sourceId =
          cls === "bgg-candidate-identity" ||
          cls === "bgg-thing-facts" ||
          cls === "bgg-preview-calculation"
            ? String(payloadBggId)
            : `${cls}:${record.sourceId}`;
        citationById.set(id, {
          citationId: id,
          sourceId,
          sourceVersion: `turn-${audit.requestId}`,
          evidenceClass: cls,
          ...(record.observedAt ? { observedAt: record.observedAt } : {}),
          canonicalSummary: cls.replaceAll("-", " "),
          testimony: false,
          destination,
        } as never);
      }
      const selectedIds = new Set(result.output.blocks.flatMap(({ citationIds }) => citationIds));
      if ([...selectedIds].some((citationId) => !citationById.has(citationId))) {
        logStage(log, audit, "submission", "rejected", { failure: "unknown-citation" });
        return { valid: false, reason: "handoff-failed" };
      }
      const citations = [...selectedIds].map((citationId) => citationById.get(citationId)!);
      const final = AnalystFinalSchema.parse({
        ...result.output,
        citations,
        usage: result.usage,
      });
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
        logStage(log, audit, "evidence-handoff", validated.valid ? "success" : "rejected");
        if (!validated.valid || !validated.result)
          return { valid: false, reason: "handoff-failed" };
        const inspectionRecords: Array<
          z.infer<typeof AnalystCitationInspectionUnsignedRecordSchema>
        > = [];
        if (input.conversationId !== undefined && input.turnIndex !== undefined) {
          const usedIds = new Set(selectedIds);
          // Discovery and preview cards are returned even when the model did not cite them in prose.
          for (const id of committedBgg) {
            const record = stagedBgg.get(id);
            if (
              record &&
              [
                "bgg-search-observation",
                "bgg-hot-observation",
                "bgg-candidate-identity",
                "bgg-thing-facts",
                "bgg-preview-calculation",
              ].includes(record.evidenceClass)
            )
              usedIds.add(id);
          }
          const views: Array<{
            kind: "discovery" | "calculation" | "item";
            result: unknown;
            ids: Set<string>;
          }> = [];
          for (const value of discovery) {
            const parsed = AnalystCitationInspectionViewSchema.safeParse({
              kind: "discovery",
              result: value,
            });
            if (!parsed.success) continue;
            const item = parsed.data.result;
            const ids = new Set<string>();
            if (parsed.data.kind === "discovery" && parsed.data.result.status === "ok") {
              ids.add(parsed.data.result.observationCitationId);
              parsed.data.result.candidates.forEach(({ identityCitationId }) =>
                ids.add(identityCitationId),
              );
            }
            views.push({ kind: "discovery", result: item, ids });
          }
          for (const value of fitnessPreview) {
            const parsed = AnalystCitationInspectionViewSchema.safeParse({
              kind: "calculation",
              result: value,
            });
            if (!parsed.success) continue;
            const item = parsed.data.result;
            const ids = new Set<string>();
            if (parsed.data.kind === "calculation" && "calculationCitationId" in parsed.data.result)
              ids.add(parsed.data.result.calculationCitationId);
            if (
              parsed.data.kind === "calculation" &&
              "bggLookup" in parsed.data.result &&
              parsed.data.result.bggLookup.status === "verified"
            )
              ids.add(parsed.data.result.bggLookup.factCitationId);
            views.push({ kind: "calculation", result: item, ids });
          }
          for (const value of thingFacts) {
            const parsed = AnalystCitationInspectionViewSchema.safeParse({
              kind: "item",
              result: value,
            });
            if (!parsed.success) continue;
            const item = parsed.data.result;
            const ids = new Set<string>();
            if (parsed.data.kind === "item" && parsed.data.result.status !== "error")
              parsed.data.result.facts.forEach(({ factCitationId }) => ids.add(factCitationId));
            views.push({ kind: "item", result: item, ids });
          }
          // A preview may carry the verified Thing facts it fetched internally instead of
          // exposing a separate readBggFacts tool result. Materialize that same bounded
          // finalized fact as an item view for its citation.
          for (const [id, record] of stagedBgg) {
            if (!committedBgg.has(id) || record.evidenceClass !== "bgg-thing-facts") continue;
            const payload = record.payload as {
              bggId: number;
              primaryName: string;
              yearPublished: number | null;
              mechanics: { id: number; name: string }[];
              missingFields: ("year" | "mechanics")[];
              warnings: "partial-links"[];
            };
            const fact = {
              ...payload,
              mechanicsComplete: !payload.missingFields.includes("mechanics"),
              observedAt: record.observedAt,
              factCitationId: id,
            };
            const item = {
              status: "ok",
              requestedCount: 1,
              facts: [fact],
              failures: [],
              coverage: "complete",
            };
            const parsed = AnalystCitationInspectionViewSchema.safeParse({
              kind: "item",
              result: item,
            });
            if (parsed.success)
              views.push({ kind: "item", result: parsed.data.result, ids: new Set([id]) });
          }
          for (const id of usedIds) {
            if (!committedBgg.has(id)) continue;
            const citation = citationById.get(id);
            const record = stagedBgg.get(id);
            const view = views.find(
              ({ ids, kind }) =>
                ids.has(id) &&
                (((record?.evidenceClass === "bgg-search-observation" ||
                  record?.evidenceClass === "bgg-hot-observation" ||
                  record?.evidenceClass === "bgg-candidate-identity") &&
                  kind === "discovery") ||
                  (record?.evidenceClass === "bgg-preview-calculation" && kind === "calculation") ||
                  (record?.evidenceClass === "bgg-thing-facts" && kind === "item")),
            );
            if (!citation || !view) return { valid: false, reason: "handoff-failed" };
            const candidate = {
              version: 1 as const,
              conversationId: input.conversationId,
              requestId: input.audit.requestId,
              turnIndex: input.turnIndex,
              citation,
              view: { kind: view.kind, result: view.result },
            };
            const checked = AnalystCitationInspectionUnsignedRecordSchema.safeParse(candidate);
            if (!checked.success) return { valid: false, reason: "handoff-failed" };
            inspectionRecords.push(checked.data);
          }
          // Keep this seam within the public shared bounds; no partial oversized payload escapes.
          if (inspectionRecords.length > ANALYST_CITATION_INSPECTION_MAX_COUNT)
            return { valid: false, reason: "handoff-failed" };
          let totalBytes = 0;
          for (const record of inspectionRecords) {
            const bytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
            if (
              bytes > ANALYST_CITATION_INSPECTION_MAX_RECORD_BYTES ||
              totalBytes + bytes > ANALYST_CITATION_INSPECTION_MAX_TOTAL_BYTES
            )
              return { valid: false, reason: "handoff-failed" };
            totalBytes += bytes;
          }
        }
        return Object.freeze({
          output: final,
          usage: result.usage,
          retrieved: [accumulated],
          discovery: Object.freeze(discovery),
          fitnessPreview: Object.freeze(fitnessPreview),
          inspectionRecords: Object.freeze(inspectionRecords),
          discoveryIds: Object.freeze(
            discovery
              .flatMap((item) => {
                if (
                  !item ||
                  typeof item !== "object" ||
                  !Array.isArray((item as { candidates?: unknown }).candidates)
                )
                  return [];
                const value = item as { source?: "title" | "hot"; candidates: { bggId: number }[] };
                return value.candidates.map(({ bggId }) => ({
                  bggId,
                  source: value.source === "hot" ? ("hot" as const) : ("search" as const),
                }));
              })
              .filter(
                ({ bggId }, index, all) =>
                  emittedIds.has(bggId) && all.findIndex((item) => item.bggId === bggId) === index,
              ),
          ),
        });
      } catch (error) {
        if (input.signal.aborted) discardStagedBgg();
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
