import { describe, expect, test } from "bun:test";
import { createTestApp, jsonRequest } from "./helpers/test-app.js";
import type {
  GroundedAnalysisProvider,
  GroundedAnalysisRequest,
} from "../src/services/grounded-analysis/provider.js";
import { createAnalystRoutes } from "../src/routes/analyst.js";
import { createAnalystAttestationService } from "../src/services/analyst-attestation-service.js";
import { createAnalystEvidenceService } from "../src/services/analyst-evidence-service.js";
import type { AnalystProjectionSnapshot } from "../src/services/analyst-evidence-projections.js";
import { createAnalystTranscriptValidator } from "../src/services/analyst-transcript-validator.js";
import type { AnalystTranscriptValidator } from "../src/services/analyst-transcript-validator.js";
import { createAnalystTurnService } from "../src/services/analyst-turn-service.js";

const capability = "a".repeat(64);

function turnRequest(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conversation-1",
    conversationCapability: capability,
    requestId: "request-1",
    turnIndex: 0,
    disclosure: { providerId: "provider", modelId: "model", acknowledged: true },
    messages: [{ role: "owner", content: "Which games are owned?" }],
    ...overrides,
  };
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function configuredProvider(
  analyze?: (request: Parameters<NonNullable<GroundedAnalysisProvider["analyzeFreeform"]>>[0]) => Promise<{ output: string; usage: { state: "unavailable" } }>,
): GroundedAnalysisProvider {
  return {
    configurationStatus: {
      status: "configured",
      identity: { providerId: "provider", modelId: "model", extensionIds: [] },
    },
    analyze: () => Promise.reject(new Error("structured analysis is not configured")),
    async analyzeFreeform(request) {
      if (analyze !== undefined) return analyze(request);
      return { output: "I need authorized evidence.", usage: { state: "unavailable" } };
    },
  };
}

function eventTypes(body: string): string[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as { type: string })
    .map((event) => event.type);
}

function events(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

function completedProviderOutput(_request: Parameters<NonNullable<GroundedAnalysisProvider["analyzeFreeform"]>>[0]) {
  void _request;
  return {
    output: "I need authorized evidence.",
    usage: { state: "unavailable" as const },
  };
}

describe("Analyst daemon routes", () => {
  test("discovers all four read-only Analyst operations without private content", () => {
    const context = createTestApp();
    const operations = context.operations.filter(({ operationId }) =>
      operationId.startsWith("shelf.analyst."),
    );

    expect(operations.map(({ operationId }) => operationId)).toEqual([
      "shelf.analyst.configuration.get",
      "shelf.analyst.turn.stream",
      "shelf.analyst.turn.cancel",
      "shelf.analyst.citation.inspect",
    ]);
    expect(JSON.stringify(operations)).not.toContain("bggAuthToken");
    expect(JSON.stringify(operations)).not.toContain(capability);
    expect(JSON.stringify(operations)).not.toContain("owner note text");
  });

  test("returns non-secret configuration and rejects malformed configuration queries", async () => {
    const context = createTestApp();
    const response = await jsonRequest(context.app, "GET", "/api/analyst/configuration");
    const configuration: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(configuration).toMatchObject({ contractVersion: 1, manifestVersion: 2 });
    expect(JSON.stringify(configuration)).not.toContain("credential");

    const invalid = await jsonRequest(
      context.app,
      "GET",
      "/api/analyst/configuration?unexpected=true",
    );
    expect(invalid.status).toBe(400);
  });

  test("strictly rejects malformed turns before any evidence or provider work", async () => {
    const context = createTestApp();
    const response = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest({ conversationCapability: "weak" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      outcome: "unavailable",
      requestId: "request-1",
      reason: "internal",
    });
  });

  test("keeps unavailable provider configuration separate from transcript validation", async () => {
    const context = createTestApp();
    const response = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      outcome: "unavailable",
      requestId: "request-1",
      reason: "model-configuration",
    });
  });

  test("streams one configured turn as SSE and NDJSON with one committed terminal event", async () => {
    const context = createTestApp({
      groundedAnalysisProvider: configuredProvider((request) => {
        expect(request.systemPrompt).toBe(
          "You are Shelf Judge's Collection Analyst. Use the available read-only collection discovery tools as needed, then provide a conversational final answer.",
        );
        return completedProviderOutput(request);
      }),
    });
    const sse = await jsonRequest(context.app, "POST", "/api/analyst/turns/stream", turnRequest());
    const sseBody = await sse.text();
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    expect(eventTypes(sseBody)).toEqual([
      "accepted",
      "evidence-status",
      "model-status",
      "evidence-status",
      "model-status",
      "validated-block",
      "provider-usage",
      "completed",
    ]);
    expect(
      eventTypes(sseBody).filter((type) => ["completed", "cancelled", "failed"].includes(type)),
    ).toHaveLength(1);

    const ndjson = await context.app.request("http://localhost/api/analyst/turns/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(
        turnRequest({ conversationId: "conversation-2", requestId: "request-2" }),
      ),
    });
    const ndjsonEvents = (await ndjson.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    expect(ndjson.headers.get("content-type")).toContain("application/x-ndjson");
    expect(ndjsonEvents.at(-1)?.type).toBe("completed");
  });

  test("accepts an authorized cancellation during provider work and rejects reuse while active", async () => {
    const started = deferred<void>();
    const context = createTestApp({
      groundedAnalysisProvider: configuredProvider(
        async (request) => {
          started.resolve();
          await new Promise<void>((_resolve, reject) =>
            request.signal.addEventListener(
              "abort",
              () => reject(new DOMException("cancelled", "AbortError")),
              { once: true },
            ),
          );
          throw new Error("provider should be cancelled");
        },
      ),
    });
    const stream = await context.app.request("http://localhost/api/analyst/turns/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(turnRequest()),
    });
    await started.promise;
    const busy = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest({ requestId: "request-2" }),
    );
    expect(await busy.json()).toMatchObject({ outcome: "busy", activeRequestId: "request-1" });
    const unauthorized = await jsonRequest(context.app, "POST", "/api/analyst/turns/cancel", {
      conversationId: "conversation-1",
      conversationCapability: "b".repeat(64),
      requestId: "request-1",
    });
    expect(unauthorized.status).toBe(403);
    const cancelled = await jsonRequest(context.app, "POST", "/api/analyst/turns/cancel", {
      conversationId: "conversation-1",
      conversationCapability: capability,
      requestId: "request-1",
    });
    expect(await cancelled.json()).toEqual({ outcome: "accepted", requestId: "request-1" });
    expect(eventTypes(await stream.text()).at(-1)).toBe("cancelled");
  });

  test("settles a disconnected stream and admits a later request", async () => {
    const started = deferred<void>();
    const disconnected = deferred<void>();
    let calls = 0;
    const context = createTestApp({
      groundedAnalysisProvider: configuredProvider(
        async (request) => {
          calls += 1;
          if (calls > 1) return completedProviderOutput(request);
          started.resolve();
          await new Promise<void>((_resolve, reject) =>
            request.signal.addEventListener(
              "abort",
              () => {
                disconnected.resolve();
                reject(new DOMException("disconnected", "AbortError"));
              },
              { once: true },
            ),
          );
          throw new Error("provider should be disconnected");
        },
      ),
    });
    const stream = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest(),
    );
    await started.promise;
    await stream.body?.cancel();
    await disconnected.promise;
    const retry = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest({ requestId: "request-2" }),
    );

    expect(eventTypes(await retry.text()).at(-1)).toBe("completed");
  });

  test("cancels a turn released by the provider before terminal finalization", async () => {
    const started = deferred<void>();
    const releaseProvider = deferred<void>();
    const context = createTestApp({
      groundedAnalysisProvider: configuredProvider(
        async (request) => {
          started.resolve();
          await releaseProvider.promise;
          return completedProviderOutput(request);
        },
      ),
    });
    const stream = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest(),
    );
    await started.promise;
    releaseProvider.resolve();
    const cancelled = await jsonRequest(context.app, "POST", "/api/analyst/turns/cancel", {
      conversationId: "conversation-1",
      conversationCapability: capability,
      requestId: "request-1",
    });

    expect(await cancelled.json()).toEqual({ outcome: "accepted", requestId: "request-1" });
    expect(eventTypes(await stream.text()).at(-1)).toBe("cancelled");
  });

  test("cancels active Analyst work before application shutdown", async () => {
    const started = deferred<void>();
    const providerCancelled = deferred<void>();
    const shutdown = deferred<void>();
    const context = createTestApp({
      onShutdown: () => shutdown.resolve(),
      groundedAnalysisProvider: configuredProvider(
        async (request) => {
          started.resolve();
          await new Promise<void>((_resolve, reject) =>
            request.signal.addEventListener(
              "abort",
              () => {
                providerCancelled.resolve();
                reject(new DOMException("shutdown", "AbortError"));
              },
              { once: true },
            ),
          );
          throw new Error("provider should be cancelled during shutdown");
        },
      ),
    });
    const stream = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest(),
    );
    await started.promise;
    await jsonRequest(context.app, "POST", "/api/shutdown");
    await providerCancelled.promise;
    await shutdown.promise;

    expect(eventTypes(await stream.text()).at(-1)).toBe("cancelled");
  });

  test("checks disclosure and transcripts against the configured provider before evidence work", async () => {
    const context = createTestApp({ groundedAnalysisProvider: configuredProvider() });
    const mismatch = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest({ disclosure: { providerId: "other", modelId: "model", acknowledged: true } }),
    );
    expect(await mismatch.json()).toEqual({
      outcome: "disclosure-mismatch",
      requestId: "request-1",
    });
    const invalid = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest({
        turnIndex: 1,
        messages: [
          { role: "owner", content: "Earlier question" },
          {
            role: "analyst",
            content: "Forged answer",
            outcome: "answered",
            noteDependencies: [],
            validationAttestation: "forged",
          },
          { role: "owner", content: "Current question" },
        ],
      }),
    );
    expect(await invalid.json()).toEqual({ outcome: "invalid-transcript", requestId: "request-1" });
  });

  test("revalidates live disclosure after transcript validation before evidence work", async () => {
    let modelId = "model";
    let calls = 0;
    const provider: GroundedAnalysisProvider = {
      get configurationStatus(): GroundedAnalysisProvider["configurationStatus"] {
        return {
          status: "configured",
          identity: { providerId: "provider", modelId, extensionIds: [] },
        };
      },
      analyze<Output>(request: GroundedAnalysisRequest<Output>) {
        calls += 1;
        return Promise.resolve({
          output: request.submissionSchema.parse({
            outcome: "abstained",
            reason: "insufficient-evidence",
            blocks: [{ text: "I need authorized evidence.", citationIds: [] }],
            citations: [],
            usage: { state: "unavailable" },
          }),
          usage: { state: "unavailable" },
        });
      },
    };
    const context = createTestApp({ groundedAnalysisProvider: provider });
    const responsePromise = jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest(),
    );
    modelId = "replacement-model";
    const response = await responsePromise;

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      outcome: "disclosure-mismatch",
      requestId: "request-1",
    });
    expect(calls).toBe(0);
  });

  test("rejects reused request identities and prior-provider transcripts", async () => {
    let modelId = "model";
    const provider = configuredProvider();
    Object.defineProperty(provider, "configurationStatus", {
      get: () => ({
        status: "configured",
        identity: { providerId: "provider", modelId, extensionIds: [] },
      }),
    });
    const context = createTestApp({ groundedAnalysisProvider: provider });
    const first = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest(),
    );
    const completed = events(await first.text()).at(-1);
    expect(completed?.type).toBe("completed");
    const reused = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest(),
    );
    expect(await reused.json()).toEqual({ outcome: "request-id-misuse", requestId: "request-1" });

    modelId = "replacement-model";
    const priorProvider = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest({
        requestId: "request-2",
        turnIndex: 1,
        disclosure: { providerId: "provider", modelId, acknowledged: true },
        messages: [
          { role: "owner", content: "Which games are owned?" },
          {
            role: "analyst",
            content: (completed?.result as { blocks: Array<{ text: string }> }).blocks[0].text,
            outcome: (completed?.result as { outcome: "answered" | "partial" | "abstained" })
              .outcome,
            noteDependencies: [],
            validationAttestation: completed?.validationAttestation,
          },
          { role: "owner", content: "What changed?" },
        ],
      }),
    );
    expect(await priorProvider.json()).toEqual({
      outcome: "disclosure-mismatch",
      requestId: "request-2",
    });
  });

  test("fails closed when identity tracking is full without forgetting prior bindings", async () => {
    const context = createTestApp({ groundedAnalysisProvider: configuredProvider() });
    for (let index = 0; index < 1_024; index += 1) {
      const response = await jsonRequest(
        context.app,
        "POST",
        "/api/analyst/turns/stream",
        turnRequest({ conversationId: `conversation-${index}`, requestId: `request-${index}` }),
      );
      expect(eventTypes(await response.text()).at(-1)).toBe("completed");
    }

    const reused = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest({ conversationId: "conversation-0", requestId: "request-0" }),
    );
    expect(await reused.json()).toEqual({ outcome: "request-id-misuse", requestId: "request-0" });

    const changedCapability = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest({
        conversationId: "conversation-0",
        conversationCapability: "b".repeat(64),
        requestId: "request-after-capacity",
      }),
    );
    expect(await changedCapability.json()).toEqual({
      outcome: "request-id-misuse",
      requestId: "request-after-capacity",
    });

    const unavailable = await jsonRequest(
      context.app,
      "POST",
      "/api/analyst/turns/stream",
      turnRequest({ conversationId: "conversation-overflow", requestId: "request-overflow" }),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      outcome: "unavailable",
      requestId: "request-overflow",
      reason: "internal",
      safeDetail: "analyst-identity-tracking-capacity-reached",
    });
  });

  test("atomically admits only the remaining identity capacity after concurrent validation", async () => {
    const provider = configuredProvider();
    const context = createTestApp({ groundedAnalysisProvider: provider });
    const attestationService = createAnalystAttestationService();
    const evidenceService = createAnalystEvidenceService({
      storageService: context.storageService,
      projectionSnapshotService: {
        capture: () =>
          Promise.resolve({
            collectionId: "collection-1",
            collectionRevision: 1,
            snapshotFingerprint: "identity-capacity-test",
            sources: [],
            page: () => {
              throw new Error("No evidence pages are requested by this provider");
            },
          } satisfies AnalystProjectionSnapshot),
      },
      ownerGameNoteService: context.ownerGameNoteService,
      ownerNoteAuthorizationScope: {
        gameIds: [],
        allowCollectionSynthesis: false,
        allowLocalTextSearch: false,
      },
      citationSecret: new Uint8Array(32).fill(4),
    });
    const validationStarted = deferred<void>();
    const releaseValidation = deferred<void>();
    let holdValidation = false;
    let racingValidations = 0;
    const transcriptValidator: AnalystTranscriptValidator = {
      async validate() {
        if (!holdValidation) return { valid: true };
        racingValidations += 1;
        if (racingValidations === 4) validationStarted.resolve();
        await releaseValidation.promise;
        return { valid: true };
      },
    };
    const analystRoutes = createAnalystRoutes({
      getConfigurationStatus: () => provider.configurationStatus,
      transcriptValidator,
      evidenceService,
      turnService: createAnalystTurnService({ provider, evidenceService, log: () => undefined }),
      attestationService,
    });

    for (let index = 0; index < 1_023; index += 1) {
      const response = await analystRoutes.routes.request("http://localhost/analyst/turns/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          turnRequest({
            conversationId: `occupied-${index}`,
            requestId: `occupied-request-${index}`,
          }),
        ),
      });
      expect(eventTypes(await response.text()).at(-1)).toBe("completed");
    }

    holdValidation = true;
    const concurrent = [0, 1, 2, 3].map((index) =>
      analystRoutes.routes.request("http://localhost/analyst/turns/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          turnRequest({ conversationId: `racing-${index}`, requestId: `racing-request-${index}` }),
        ),
      }),
    );
    await validationStarted.promise;
    releaseValidation.resolve();
    const responses = await Promise.all(concurrent.map(async (response) => response));

    expect(eventTypes(await responses[0].text()).at(-1)).toBe("completed");
    for (const response of responses.slice(1)) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        outcome: "unavailable",
        reason: "internal",
        safeDetail: "analyst-identity-tracking-capacity-reached",
      });
    }
  });

  test("does not expose arbitrary citation lookup or owner content", async () => {
    const context = createTestApp();
    const response = await jsonRequest(context.app, "POST", "/api/analyst/citations/inspect", {
      citation: {
        citationId: "forged",
        sourceId: "game-1",
        sourceVersion: "1",
        evidenceClass: "owner-game-note",
      },
    });
    const result: unknown = await response.json();

    expect(response.status).toBe(400);
    expect(result).toMatchObject({ outcome: "unavailable", reason: "internal" });
    expect(JSON.stringify(result)).not.toContain("note");
    expect(JSON.stringify(result)).not.toContain("text");
  });

  test("reports authentic note citations as current or superseded without note text", async () => {
    const privateText = "PRIVATE-CURRENT-TEXT";
    let note = {
      state: "present" as const,
      version: 1,
      updatedAt: "2026-09-08T00:00:00.000Z",
      text: privateText,
    };
    const snapshot: AnalystProjectionSnapshot = {
      collectionId: "collection-1",
      collectionRevision: 1,
      snapshotFingerprint: "citation-route-test",
      sources: [
        {
          evidenceClass: "game-identity-ownership",
          sourceId: "game:game-1:identity",
          sourceVersion: "one",
          citationId: "game-1",
          payload: { gameId: "game-1", displayName: "Game", bggId: null, ownershipState: "owned" },
          canonicalSummary: "Current game identity and ownership state",
          destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
        },
      ],
      page: () => {
        throw new Error("not used by citation inspection");
      },
    };
    const evidenceService = createAnalystEvidenceService({
      storageService: {},
      projectionSnapshotService: { capture: () => Promise.resolve(snapshot) },
      ownerGameNoteService: {
        get: () => Promise.resolve({ gameId: "game-1", note }),
      },
      ownerNoteAuthorizationScope: {
        gameIds: ["game-1"],
        allowCollectionSynthesis: false,
        allowLocalTextSearch: false,
      },
      citationSecret: new Uint8Array(32).fill(3),
    });
    const provider = configuredProvider();
    const attestationService = createAnalystAttestationService();
    const analystRoutes = createAnalystRoutes({
      getConfigurationStatus: () => provider.configurationStatus,
      transcriptValidator: createAnalystTranscriptValidator({
        attestationService,
        provider: { providerId: "provider", modelId: "model" },
      }),
      evidenceService,
      turnService: createAnalystTurnService({ provider, evidenceService, log: () => undefined }),
      attestationService,
    });
    const retrieved = await evidenceService.retrieve(snapshot, {
      snapshotFingerprint: snapshot.snapshotFingerprint,
      evidenceClasses: ["owner-game-note"],
      gameIds: ["game-1"],
    });
    const citation = retrieved.citations[0];
    if (citation === undefined) throw new Error("Expected a note citation");
    const request = {
      citation: {
        citationId: citation.citationId,
        sourceId: citation.sourceId,
        sourceVersion: citation.sourceVersion,
        evidenceClass: citation.evidenceClass,
      },
    };
    const current = await analystRoutes.routes.request(
      "http://localhost/analyst/citations/inspect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    expect(await current.json()).toEqual({
      state: "current",
      destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
    });

    note = { state: "present", version: 2, updatedAt: "2026-09-08T00:01:00.000Z", text: "NEW" };
    const superseded = await analystRoutes.routes.request(
      "http://localhost/analyst/citations/inspect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    const result: unknown = await superseded.json();
    expect(result).toEqual({
      state: "superseded",
      destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
    });
    expect(JSON.stringify(result)).not.toContain(privateText);
  });

  test("requires the exact active identity when cancelling an absent request", async () => {
    const context = createTestApp();
    const response = await jsonRequest(context.app, "POST", "/api/analyst/turns/cancel", {
      conversationId: "conversation-1",
      conversationCapability: capability,
      requestId: "request-1",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ outcome: "not-found", requestId: "request-1" });
  });
});
