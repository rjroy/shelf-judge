import {
  ANALYST_CONTRACT_VERSION,
  ANALYST_DISCLOSURE_VERSION,
  ANALYST_EVIDENCE_CLASSES,
  ANALYST_MANIFEST_VERSION,
  AnalystCancelRequestSchema,
  AnalystCancelResultSchema,
  AnalystCitationInspectRequestSchema,
  AnalystCitationInspectResultSchema,
  AnalystCitationInspectionRecordSchema,
  AnalystConfigurationGetRequestSchema,
  AnalystConfigurationSchema,
  AnalystDiscoveryIdsSchema,
  AnalystDiscoveryViewSchema,
  AnalystFitnessPreviewViewSchema,
  AnalystOperationResultSchema,
  AnalystStreamEventSchema,
  AnalystTurnRequestSchema,
  GroundedProviderConfigurationStatusSchema,
  type AnalystStreamEvent,
  type AnalystTurnRequest,
  type GroundedProviderConfigurationStatus,
} from "@shelf-judge/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { OperationDefinition, OperationJsonValue, RouteModule } from "../operations.js";
import type { AnalystAttestationService } from "../services/analyst-attestation-service.js";
import type { AnalystEvidenceService } from "../services/analyst-evidence-service.js";
import type { AnalystTranscriptValidator } from "../services/analyst-transcript-validator.js";
import type { ReturnTypeOfAnalystTurnService } from "../services/analyst-route-types.js";
import { createActiveGroundedOperationRegistry } from "../services/grounded-analysis/active-operation-registry.js";
import {
  createGroundedStreamWriter,
  type GroundedStreamEncoding,
} from "../services/grounded-analysis/stream-writer.js";
import { GroundedAnalysisError } from "../services/grounded-analysis/failure-mapping.js";

const INVALID_REQUEST_ID = "invalid-request";
const OPERATION_PREFIX = "shelf.analyst";
const SYSTEM_PROMPT =
  "You are Shelf Judge's Collection Analyst. Use the available read-only collection discovery tools as needed, then provide a conversational final answer.";
const MAX_RETAINED_CONVERSATION_IDENTITIES = 1_024;
const ANALYST_TURN_DEADLINE_MS = 120_000;

const operationResultSchema = {
  type: "object",
  required: ["outcome", "requestId"],
  additionalProperties: true,
  properties: { outcome: { type: "string" }, requestId: { type: "string" } },
} satisfies Record<string, OperationJsonValue>;
const configurationResponseSchema = {
  type: "object",
  required: [
    "contractVersion",
    "manifestVersion",
    "disclosureVersion",
    "configuration",
    "bgg",
    "disclosure",
  ],
  additionalProperties: false,
  properties: {
    contractVersion: { const: ANALYST_CONTRACT_VERSION },
    manifestVersion: { const: ANALYST_MANIFEST_VERSION },
    disclosureVersion: { const: ANALYST_DISCLOSURE_VERSION },
    configuration: { type: "object" },
    bgg: {
      type: "object",
      required: ["status"],
      additionalProperties: false,
      properties: { status: { enum: ["configured", "not-configured", "unauthorized"] } },
    },
    disclosure: {
      type: "object",
      required: [
        "evidenceClasses",
        "relevantOwnerNotesMayBeTransmitted",
        "selectedOwnerTitleOrBggIdsMayBeSentToBgg",
        "bggProcessingIsSeparateFromProviderProcessing",
        "localRetention",
        "providerProcessingAndRetentionFollowProviderPolicy",
        "applicationTokenCap",
        "applicationMonetaryCap",
        "cancellation",
        "maximumTranscriptMessages",
        "maximumTranscriptCharacters",
      ],
      additionalProperties: false,
      properties: {
        evidenceClasses: { type: "array", items: { type: "string" } },
        relevantOwnerNotesMayBeTransmitted: { const: true },
        selectedOwnerTitleOrBggIdsMayBeSentToBgg: { const: true },
        bggProcessingIsSeparateFromProviderProcessing: { const: true },
        localRetention: { type: "string" },
        providerProcessingAndRetentionFollowProviderPolicy: { const: true },
        applicationTokenCap: { const: null },
        applicationMonetaryCap: { const: null },
        cancellation: { type: "string" },
        maximumTranscriptMessages: { type: "integer" },
        maximumTranscriptCharacters: { type: "integer" },
      },
    },
  },
} satisfies Record<string, OperationJsonValue>;
const streamEventSchema = {
  type: "object",
  required: [
    "type",
    "terminal",
    "operationId",
    "sequence",
    "occurredAt",
    "conversationId",
    "requestId",
  ],
  additionalProperties: true,
  properties: {
    type: {
      enum: [
        "accepted",
        "evidence-status",
        "model-status",
        "validated-block",
        "provider-usage",
        "completed",
        "cancelled",
        "failed",
      ],
    },
    terminal: { type: "boolean" },
    operationId: { type: "string" },
    sequence: { type: "integer" },
    occurredAt: { type: "string", format: "date-time" },
    conversationId: { type: "string" },
    requestId: { type: "string" },
  },
} satisfies Record<string, OperationJsonValue>;
const citationInspectResponseSchema = {
  type: "object",
  required: ["state", "destination"],
  additionalProperties: false,
  properties: {
    state: { enum: ["current", "superseded", "historical"] },
    inspectedAt: { type: "string", format: "date-time" },
    view: { type: "object" },
    authenticationToken: { type: "string" },
    destination: {
      type: "object",
      required: ["operationId", "parameters"],
      additionalProperties: false,
    },
  },
} satisfies Record<string, OperationJsonValue>;

type AnalystTurnService = ReturnTypeOfAnalystTurnService;
type CitationInspectionRecord = ReturnType<typeof AnalystCitationInspectionRecordSchema.parse>;
type AnalystStreamPayload = AnalystStreamEvent extends infer Event
  ? Event extends AnalystStreamEvent
    ? Omit<Event, "version" | "operationId" | "sequence" | "occurredAt">
    : never
  : never;

function requestIdFrom(body: unknown): string {
  const value = z
    .object({ requestId: z.string().min(1) })
    .passthrough()
    .safeParse(body);
  return value.success ? value.data.requestId : INVALID_REQUEST_ID;
}

async function readJson(context: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}

function encodingFor(accept: string | undefined): GroundedStreamEncoding {
  return accept?.toLowerCase().includes("application/x-ndjson") ? "ndjson" : "sse";
}

function inspectionTime(record: CitationInspectionRecord): string {
  if (record.view.kind === "discovery") {
    const result = record.view.result;
    if (result.status === "ok") return result.observedAt;
  } else if (record.view.kind === "item") {
    const result = record.view.result;
    if ("facts" in result) return result.facts[0]?.observedAt ?? new Date().toISOString();
  } else {
    const result = record.view.result;
    if ("calculatedAt" in result) return result.calculatedAt;
  }
  return new Date().toISOString();
}

function operationResult(value: unknown, requestId: string) {
  const result = AnalystOperationResultSchema.parse(value);
  if (result.requestId !== requestId) throw new Error("Analyst operation result identity mismatch");
  return result;
}

function unavailable(requestId: string, safeDetail: string) {
  return operationResult(
    { outcome: "unavailable", requestId, reason: "internal", safeDetail },
    requestId,
  );
}

function transcriptPrompt(request: AnalystTurnRequest): string {
  return JSON.stringify({
    transcript: request.messages.map((message) =>
      message.role === "analyst"
        ? {
            role: message.role,
            content: message.content,
            outcome: message.outcome,
            noteDependencies: message.noteDependencies,
          }
        : message,
    ),
  });
}

function configuration(
  status: GroundedProviderConfigurationStatus,
  bggStatus: AnalystBggConfigurationStatus,
) {
  return AnalystConfigurationSchema.parse({
    contractVersion: ANALYST_CONTRACT_VERSION,
    manifestVersion: ANALYST_MANIFEST_VERSION,
    disclosureVersion: ANALYST_DISCLOSURE_VERSION,
    configuration: status,
    bgg: { status: bggStatus },
    disclosure: {
      evidenceClasses: ANALYST_EVIDENCE_CLASSES,
      relevantOwnerNotesMayBeTransmitted: true,
      selectedOwnerTitleOrBggIdsMayBeSentToBgg: true,
      bggProcessingIsSeparateFromProviderProcessing: true,
      localRetention: "Shelf Judge does not persist Analyst conversations.",
      providerProcessingAndRetentionFollowProviderPolicy: true,
      applicationTokenCap: null,
      applicationMonetaryCap: null,
      cancellation:
        "Cancel the active request with its exact conversation capability and request ID.",
      maximumTranscriptMessages: 32,
      maximumTranscriptCharacters: 48_000,
    },
  });
}

type AnalystBggConfigurationStatus = "configured" | "not-configured" | "unauthorized";

export interface AnalystRoutesDeps {
  /** Read at request time; callers must acknowledge the configured provider identity. */
  readonly getConfigurationStatus: () => GroundedProviderConfigurationStatus;
  /** BGG credentials are never returned; only their non-secret availability is disclosed. */
  readonly getBggConfigurationStatus?: () => AnalystBggConfigurationStatus;
  readonly transcriptValidator: AnalystTranscriptValidator;
  readonly evidenceService: AnalystEvidenceService;
  readonly turnService: AnalystTurnService;
  readonly attestationService: AnalystAttestationService;
  readonly createOperationId?: () => string;
}

export interface AnalystRouteModule extends RouteModule {
  cancelActive(): Promise<void>;
}

/** Strict, ephemeral HTTP bridge for the daemon-owned Analyst services. */
export function createAnalystRoutes(deps: AnalystRoutesDeps): AnalystRouteModule {
  const routes = new Hono();
  const operations = createActiveGroundedOperationRegistry();
  const configurationStatus = () =>
    GroundedProviderConfigurationStatusSchema.parse(deps.getConfigurationStatus());
  const bggConfigurationStatus = () => deps.getBggConfigurationStatus?.() ?? "not-configured";
  const active = new Map<
    string,
    {
      operationId: string;
      requestId: string;
      capability: string;
      settled: Promise<void>;
    }
  >();
  const pending = new Map<string, string>();
  const conversationIdentity = new Map<
    string,
    { capability: string; providerId: string; modelId: string }
  >();
  const requestConversation = new Map<string, string>();
  const createOperationId = deps.createOperationId ?? (() => crypto.randomUUID());
  // Inspection signatures intentionally use the attestation service's process-local key.
  // They become unverifiable after restart, which safely falls back to live inspection.

  const identityTrackingUnavailable = (request: AnalystTurnRequest) =>
    (!conversationIdentity.has(request.conversationId) &&
      conversationIdentity.size >= MAX_RETAINED_CONVERSATION_IDENTITIES) ||
    (!requestConversation.has(request.requestId) &&
      requestConversation.size >= MAX_RETAINED_CONVERSATION_IDENTITIES);

  const requestMisused = (request: AnalystTurnRequest) =>
    requestConversation.has(request.requestId) ||
    (conversationIdentity.get(request.conversationId)?.capability !== undefined &&
      conversationIdentity.get(request.conversationId)?.capability !==
        request.conversationCapability);
  const disclosureMatchesLiveConfiguration = (
    request: AnalystTurnRequest,
    expectedIdentity: { providerId: string; modelId: string },
  ) => {
    const current = configurationStatus();
    if (current.status !== "configured") return { matches: false, unavailable: true } as const;
    const matches =
      current.identity.providerId === expectedIdentity.providerId &&
      current.identity.modelId === expectedIdentity.modelId &&
      request.disclosure.providerId === current.identity.providerId &&
      request.disclosure.modelId === current.identity.modelId &&
      request.disclosure.manifestVersion === ANALYST_MANIFEST_VERSION &&
      request.disclosure.disclosureVersion === ANALYST_DISCLOSURE_VERSION;
    return { matches, unavailable: false } as const;
  };

  routes.get("/analyst/configuration", (context) => {
    if (!AnalystConfigurationGetRequestSchema.safeParse(context.req.queries()).success)
      return context.json(
        unavailable(INVALID_REQUEST_ID, "invalid-analyst-configuration-request"),
        400,
      );
    return context.json(configuration(configurationStatus(), bggConfigurationStatus()));
  });

  routes.post("/analyst/citations/inspect", async (context) => {
    const body = await readJson(context);
    if (!AnalystCitationInspectRequestSchema.safeParse(body).success)
      return context.json(
        {
          outcome: "unavailable",
          reason: "internal",
          safeDetail: "invalid-analyst-citation-request",
        },
        400,
      );
    try {
      const request = AnalystCitationInspectRequestSchema.parse(body);
      if (request.inspection !== undefined) {
        const candidate = request.inspection;
        const record = deps.attestationService.verifyInspectionRecord(candidate, {
          conversationId: candidate.conversationId,
          requestId: candidate.requestId,
          turnIndex: candidate.turnIndex,
          attestationDigest: candidate.attestationDigest,
        });
        const identity = request.citation;
        if (
          record === null ||
          record.citation.citationId !== identity.citationId ||
          record.citation.sourceId !== identity.sourceId ||
          record.citation.sourceVersion !== identity.sourceVersion ||
          record.citation.evidenceClass !== identity.evidenceClass
        )
          throw new Error("Invalid citation inspection record");
        const inspectedAt = inspectionTime(record);
        return context.json(
          AnalystCitationInspectResultSchema.parse({
            state: "historical",
            destination: record.citation.destination,
            inspectedAt,
            view: record.view,
            authenticationToken: record.authenticationToken,
          }),
        );
      }
      return context.json(
        AnalystCitationInspectResultSchema.parse(await deps.evidenceService.inspectCitation(body)),
      );
    } catch {
      return context.json(
        { outcome: "unavailable", reason: "internal", safeDetail: "citation-unavailable" },
        400,
      );
    }
  });

  routes.post("/analyst/turns/cancel", async (context) => {
    const body = await readJson(context);
    const parsed = AnalystCancelRequestSchema.safeParse(body);
    if (!parsed.success)
      return context.json(unavailable(requestIdFrom(body), "invalid-analyst-cancel-request"), 400);
    const current = active.get(parsed.data.conversationId);
    const result =
      current === undefined
        ? { outcome: "not-found", requestId: parsed.data.requestId }
        : current.requestId !== parsed.data.requestId
          ? { outcome: "request-id-misuse", requestId: parsed.data.requestId }
          : !operations.cancel(current.operationId, parsed.data.conversationCapability)
            ? { outcome: "unauthorized", requestId: parsed.data.requestId }
            : { outcome: "accepted", requestId: parsed.data.requestId };
    const checked = AnalystCancelResultSchema.parse(result);
    return context.json(
      checked,
      checked.outcome === "accepted" ? 200 : checked.outcome === "not-found" ? 404 : 403,
    );
  });

  routes.post("/analyst/turns/stream", async (context) => {
    const body = await readJson(context);
    const parsed = AnalystTurnRequestSchema.safeParse(body);
    if (!parsed.success)
      return context.json(unavailable(requestIdFrom(body), "invalid-analyst-turn-request"), 400);
    const request = parsed.data;
    const providerConfiguration = configurationStatus();
    if (providerConfiguration.status !== "configured")
      return context.json(
        operationResult(
          { outcome: "unavailable", requestId: request.requestId, reason: "model-configuration" },
          request.requestId,
        ),
        503,
      );
    const identity = providerConfiguration.identity;
    if (
      request.disclosure.providerId !== identity.providerId ||
      request.disclosure.modelId !== identity.modelId ||
      request.disclosure.manifestVersion !== ANALYST_MANIFEST_VERSION ||
      request.disclosure.disclosureVersion !== ANALYST_DISCLOSURE_VERSION
    )
      return context.json(
        operationResult(
          { outcome: "disclosure-mismatch", requestId: request.requestId },
          request.requestId,
        ),
        409,
      );
    const current = active.get(request.conversationId);
    if (current !== undefined) {
      return context.json(
        operationResult(
          { outcome: "busy", requestId: request.requestId, activeRequestId: current.requestId },
          request.requestId,
        ),
        409,
      );
    }
    const pendingRequestId = pending.get(request.conversationId);
    if (pendingRequestId !== undefined) {
      return context.json(
        operationResult(
          pendingRequestId === request.requestId
            ? { outcome: "request-id-misuse", requestId: request.requestId }
            : { outcome: "busy", requestId: request.requestId, activeRequestId: pendingRequestId },
          request.requestId,
        ),
        409,
      );
    }
    if (requestMisused(request))
      return context.json(
        operationResult(
          { outcome: "request-id-misuse", requestId: request.requestId },
          request.requestId,
        ),
        409,
      );
    const priorIdentity = conversationIdentity.get(request.conversationId);
    if (
      priorIdentity !== undefined &&
      (priorIdentity.providerId !== identity.providerId ||
        priorIdentity.modelId !== identity.modelId)
    )
      return context.json(
        operationResult(
          { outcome: "disclosure-mismatch", requestId: request.requestId },
          request.requestId,
        ),
        409,
      );
    pending.set(request.conversationId, request.requestId);
    let prior: Awaited<ReturnType<AnalystTranscriptValidator["validate"]>>;
    try {
      prior = await deps.transcriptValidator.validate(request);
    } catch (error) {
      pending.delete(request.conversationId);
      throw error;
    }
    const liveConfiguration = disclosureMatchesLiveConfiguration(request, identity);
    if (!prior.valid || !liveConfiguration.matches) {
      pending.delete(request.conversationId);
      if (!prior.valid)
        return context.json(
          operationResult(
            { outcome: prior.outcome, requestId: request.requestId },
            request.requestId,
          ),
          409,
        );
      return context.json(
        operationResult(
          liveConfiguration.unavailable
            ? {
                outcome: "unavailable",
                requestId: request.requestId,
                reason: "model-configuration",
              }
            : { outcome: "disclosure-mismatch", requestId: request.requestId },
          request.requestId,
        ),
        liveConfiguration.unavailable ? 503 : 409,
      );
    }

    if (identityTrackingUnavailable(request)) {
      pending.delete(request.conversationId);
      return context.json(
        unavailable(request.requestId, "analyst-identity-tracking-capacity-reached"),
        503,
      );
    }

    const operationId = `analyst:${createOperationId()}`;
    const operation = operations.start({
      operationId,
      batchId: request.conversationId,
      requestId: request.requestId,
      capability: request.conversationCapability,
      feature: "collection-analyst",
    });
    const turnController = new AbortController();
    const abortTurn = () => turnController.abort(operation.signal.reason);
    operation.signal.addEventListener("abort", abortTurn, { once: true });
    let deadlineExpired = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let settle = () => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    active.set(request.conversationId, {
      operationId,
      requestId: request.requestId,
      capability: request.conversationCapability,
      settled,
    });
    pending.delete(request.conversationId);
    conversationIdentity.set(request.conversationId, {
      capability: request.conversationCapability,
      providerId: identity.providerId,
      modelId: identity.modelId,
    });
    requestConversation.set(request.requestId, request.conversationId);
    const transport = operations.claimTransport(
      operationId,
      `analyst-transport:${createOperationId()}`,
      context.req.raw.signal,
    );
    const encoding = encodingFor(context.req.header("Accept"));
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const writer = createGroundedStreamWriter<AnalystStreamEvent>({
      operationId,
      eventSchema: AnalystStreamEventSchema,
      encoding,
      write: (serialized) => {
        if (controller === undefined) throw new Error("Analyst response transport is unavailable");
        controller.enqueue(encoder.encode(serialized));
      },
    });
    const history: AnalystStreamEvent[] = [];
    const emit = async (value: AnalystStreamPayload) => {
      const event = await writer.write(value);
      history.push(event);
      return event;
    };
    const throwIfInterrupted = () => {
      if (deadlineExpired) throw new Error("Analyst turn deadline exceeded");
      if (operation.signal.aborted)
        throw new DOMException("Analyst turn interrupted", "AbortError");
    };
    const emitNonterminal = async (value: AnalystStreamPayload) => {
      throwIfInterrupted();
      const event = await emit(value);
      throwIfInterrupted();
      return event;
    };
    const retireActive = () => {
      if (active.get(request.conversationId)?.operationId === operationId) {
        active.delete(request.conversationId);
      }
    };
    const publishTerminal = async (
      outcome: "completed" | "failed",
      event: AnalystStreamPayload,
    ) => {
      const reservation = operations.reserveTerminal(operationId, { deferInterruption: true });
      if (!reservation) throw new DOMException("Analyst turn interrupted", "AbortError");
      try {
        await emit(event);
      } catch (error) {
        operations.releaseTerminal(reservation);
        throw error;
      }
      if (!operations.commitTerminal(reservation, outcome))
        throw new Error("Analyst terminal reservation could not be committed");
      retireActive();
    };
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        void (async () => {
          try {
            let rejectDeadline: (error: Error) => void = () => undefined;
            const deadline = new Promise<never>((_resolve, reject) => {
              rejectDeadline = reject;
            });
            void deadline.catch(() => undefined);
            deadlineTimer = setTimeout(() => {
              deadlineExpired = true;
              turnController.abort(
                new DOMException("Analyst turn deadline exceeded", "TimeoutError"),
              );
              rejectDeadline(new Error("Analyst turn deadline exceeded"));
            }, ANALYST_TURN_DEADLINE_MS);
            await emitNonterminal({
              type: "accepted",
              terminal: false,
              conversationId: request.conversationId,
              requestId: request.requestId,
              turnIndex: request.turnIndex,
            });
            await emitNonterminal({
              type: "evidence-status",
              terminal: false,
              conversationId: request.conversationId,
              requestId: request.requestId,
              status: "started",
              examinedItemCount: 0,
            });
            await emitNonterminal({
              type: "model-status",
              terminal: false,
              conversationId: request.conversationId,
              requestId: request.requestId,
              status: "started",
            });
            // Owner-message indexes are zero-based positions within this array, not transcript indexes.
            const ownerMessages = request.messages.flatMap((message) =>
              message.role === "owner" ? [message.content] : [],
            );
            const runInput = {
              systemPrompt: SYSTEM_PROMPT,
              prompt: transcriptPrompt(request),
              signal: turnController.signal,
              ownerMessages,
              acceptedDiscoveryIds: prior.discoveryIds.map(({ bggId }) => bggId),
              // TODO(analyst-turn-service): declare these route-owned identity fields on run input.
              conversationId: request.conversationId,
              turnIndex: request.turnIndex,
              audit: {
                operationId,
                batchId: request.conversationId,
                requestId: request.requestId,
                feature: "collection-analyst",
                trigger: "owner",
                evidenceManifestId: "collection-analyst",
                evidenceManifestVersion: String(ANALYST_MANIFEST_VERSION),
                evidenceClassCounts: [],
                evidenceIdentityHash: request.conversationId,
              },
            };
            const runPromise = deps.turnService.run(runInput);
            // A provider that ignores AbortSignal still cannot complete this HTTP turn late.
            void runPromise.catch(() => undefined);
            const result = await Promise.race([runPromise, deadline]);
            throwIfInterrupted();
            if (!("output" in result)) {
              const failure =
                result.reason === "source-changed"
                  ? { reason: "evidence-load" as const, safeDetail: "source-changed" }
                  : result.reason === "handoff-failed"
                    ? { reason: "internal" as const, safeDetail: "evidence-handoff-failed" }
                    : { reason: "output-validation" as const, safeDetail: "invalid-submission" };
              await publishTerminal("failed", {
                type: "failed",
                terminal: true,
                conversationId: request.conversationId,
                requestId: request.requestId,
                ...failure,
              });
            } else {
              const examinedItemCount = result.retrieved.reduce(
                (count, page) => count + page.evidence.examinedSources.length,
                0,
              );
              await emitNonterminal({
                type: "evidence-status",
                terminal: false,
                conversationId: request.conversationId,
                requestId: request.requestId,
                status: "completed",
                examinedItemCount,
              });
              await emitNonterminal({
                type: "model-status",
                terminal: false,
                conversationId: request.conversationId,
                requestId: request.requestId,
                status: "validating",
              });
              const noteDependencies = result.retrieved.flatMap((page) => page.noteDependencies);
              const uniqueDependencies = [
                ...new Map(
                  noteDependencies.map((dependency) => [dependency.gameId, dependency]),
                ).values(),
              ];
              const content = result.output.blocks.map(({ text }) => text).join("\n\n");
              if (!("discoveryIds" in result))
                throw new Error("Analyst turn result omitted finalized discovery IDs");
              const emittedIdsResult = AnalystDiscoveryIdsSchema.safeParse(result.discoveryIds);
              if (!emittedIdsResult.success) throw new Error("Analyst discovery IDs are invalid");
              const discoveryIds = emittedIdsResult.data;
              if (!("discovery" in result) || !("fitnessPreview" in result))
                throw new Error("Analyst turn result omitted finalized BGG views");
              const discovery = AnalystDiscoveryViewSchema.parse(result.discovery);
              const fitnessPreview = AnalystFitnessPreviewViewSchema.parse(result.fitnessPreview);
              const finalizedCandidates = new Map<number, "search" | "hot">();
              for (const observation of discovery) {
                if (observation.status !== "ok") continue;
                const source = observation.source === "hot" ? "hot" : "search";
                for (const candidate of observation.candidates) {
                  if (!finalizedCandidates.has(candidate.bggId))
                    finalizedCandidates.set(candidate.bggId, source);
                }
              }
              if (
                finalizedCandidates.size !== discoveryIds.length ||
                discoveryIds.some(({ bggId, source }) => finalizedCandidates.get(bggId) !== source)
              )
                throw new Error("Analyst discovery IDs do not match finalized candidates");
              const discoveryDigest = deps.attestationService.discoveryDigest(discoveryIds);
              const validationAttestation = deps.attestationService.attest({
                conversationId: request.conversationId,
                turnIndex: request.turnIndex,
                providerId: identity.providerId,
                modelId: identity.modelId,
                content,
                outcome: result.output.outcome,
                noteDependencies: uniqueDependencies,
                discoveryDigest,
              });
              const attestationDigest =
                deps.attestationService.attestationDigest(validationAttestation);
              const inspectionRecords = (
                "inspectionRecords" in result ? result.inspectionRecords : []
              ).map((candidate) => {
                const unsigned = AnalystCitationInspectionRecordSchema.innerType()
                  .omit({
                    attestationDigest: true,
                    authenticationToken: true,
                  })
                  .parse(candidate);
                return deps.attestationService.issueInspectionRecord({
                  ...unsigned,
                  attestationDigest,
                });
              });
              const discoveryReceipts = discoveryIds.map(({ bggId, source }) =>
                deps.attestationService.issueDiscoveryReceipt({
                  conversationId: request.conversationId,
                  turnIndex: request.turnIndex,
                  attestationDigest,
                  bggId,
                  source,
                }),
              );
              for (const block of result.output.blocks)
                await emitNonterminal({
                  type: "validated-block",
                  terminal: false,
                  conversationId: request.conversationId,
                  requestId: request.requestId,
                  block,
                });
              await emitNonterminal({
                type: "provider-usage",
                terminal: false,
                conversationId: request.conversationId,
                requestId: request.requestId,
                usage: result.usage,
              });
              await publishTerminal("completed", {
                type: "completed",
                terminal: true,
                conversationId: request.conversationId,
                requestId: request.requestId,
                result: result.output,
                discovery,
                fitnessPreview,
                discoveryIds,
                discoveryDigest,
                discoveryReceipts,
                citationInspections: inspectionRecords,
                noteDependencies: uniqueDependencies,
                validationAttestation,
              });
            }
          } catch (error) {
            if (!history.at(-1)?.terminal) {
              const state = operations
                .discover()
                .find((entry) => entry.operationId === operationId);
              const interrupted =
                operation.signal.aborted ||
                (error instanceof DOMException && error.name === "AbortError");
              retireActive();
              if (state?.outcome === "transport-lost") {
                try {
                  streamController.error(error);
                } catch {
                  // The consumer already detached; cleanup still runs below.
                }
              } else if (deadlineExpired) {
                try {
                  await publishTerminal("failed", {
                    type: "failed",
                    terminal: true,
                    conversationId: request.conversationId,
                    requestId: request.requestId,
                    reason: "transport",
                    safeDetail: "turn-deadline",
                  });
                } catch {
                  try {
                    streamController.error(error);
                  } catch {
                    // The consumer already detached; cleanup still runs below.
                  }
                }
              } else if (interrupted && state?.outcome === "cancelled") {
                try {
                  await emit({
                    type: "cancelled",
                    terminal: true,
                    conversationId: request.conversationId,
                    requestId: request.requestId,
                  });
                } catch {
                  // Cancellation is already terminal in the registry.
                }
              } else {
                const groundedFailure =
                  error instanceof GroundedAnalysisError && error.reason !== "cancelled"
                    ? error
                    : undefined;
                try {
                  await publishTerminal("failed", {
                    type: "failed",
                    terminal: true,
                    conversationId: request.conversationId,
                    requestId: request.requestId,
                    reason:
                      groundedFailure && groundedFailure.reason !== "cancelled"
                        ? groundedFailure.reason
                        : "internal",
                    safeDetail: groundedFailure?.safeDetail ?? "turn-failed",
                  });
                } catch {
                  try {
                    streamController.error(error);
                  } catch {
                    // The consumer already detached; cleanup still runs below.
                  }
                }
              }
            }
          } finally {
            retireActive();
            try {
              if (history.at(-1)?.terminal) {
                writer.close();
                streamController.close();
              }
            } catch {
              // A detached transport must not prevent operation settlement.
            } finally {
              if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
              operation.signal.removeEventListener("abort", abortTurn);
              controller = undefined;
              transport.release();
              operations.cleanup(operationId);
              settle();
            }
          }
        })();
      },
      cancel() {
        transport.release();
      },
    });
    return context.body(stream, 200, {
      "Content-Type": encoding === "sse" ? "text/event-stream" : "application/x-ndjson",
      "Cache-Control": "no-cache",
    });
  });

  const operationsDefinition: OperationDefinition[] = [
    {
      operationId: `${OPERATION_PREFIX}.configuration.get`,
      name: "get",
      description: "Read non-secret Analyst provider disclosure and transcript limits.",
      invocation: { method: "GET", path: "/api/analyst/configuration" },
      requestSchema: AnalystConfigurationGetRequestSchema,
      response: { body: configurationResponseSchema },
      hierarchy: { root: "shelf", feature: "analyst" },
      idempotent: true,
    },
    {
      operationId: `${OPERATION_PREFIX}.turn.stream`,
      name: "stream",
      description:
        "Submit one disclosed Analyst turn. The response is SSE by default or NDJSON when Accept is application/x-ndjson; events end in exactly one terminal event.",
      invocation: { method: "POST", path: "/api/analyst/turns/stream" },
      requestSchema: AnalystTurnRequestSchema,
      response: {
        body: operationResultSchema,
        events: {
          body: streamEventSchema,
          examples: [
            { type: "accepted", terminal: false },
            { type: "completed", terminal: true },
          ],
        },
      },
      hierarchy: { root: "shelf", feature: "analyst" },
      idempotent: false,
    },
    {
      operationId: `${OPERATION_PREFIX}.turn.cancel`,
      name: "cancel",
      description: "Cancel the exact active Analyst request using its conversation capability.",
      invocation: { method: "POST", path: "/api/analyst/turns/cancel" },
      requestSchema: AnalystCancelRequestSchema,
      response: { body: operationResultSchema },
      hierarchy: { root: "shelf", feature: "analyst" },
      idempotent: false,
    },
    {
      operationId: `${OPERATION_PREFIX}.citation.inspect`,
      name: "inspect",
      description:
        "Check a server-issued citation identity without returning evidence or owner-note text.",
      invocation: { method: "POST", path: "/api/analyst/citations/inspect" },
      requestSchema: AnalystCitationInspectRequestSchema,
      response: { body: citationInspectResponseSchema },
      hierarchy: { root: "shelf", feature: "analyst" },
      idempotent: true,
    },
  ];
  return {
    routes,
    operations: operationsDefinition,
    async cancelActive() {
      const running = [...active.values()];
      for (const { operationId, capability } of running) {
        operations.cancel(operationId, capability);
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled(running.map(({ settled }) => settled)),
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, 5_000);
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  };
}
