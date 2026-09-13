import { describe, expect, test } from "bun:test";
import { createGroundedStreamSchemas } from "@shelf-judge/shared";
import { Hono } from "hono";
import { z } from "zod";
import { createActiveGroundedOperationRegistry } from "../src/services/grounded-analysis/active-operation-registry.js";
import { createGroundedEvidenceRegistry } from "../src/services/grounded-analysis/evidence-registry.js";
import type {
  GroundedAnalysisProvider,
  GroundedAnalysisRequest,
  GroundedAnalysisResult,
} from "../src/services/grounded-analysis/provider.js";
import {
  createGroundedFeatureAnalyzer,
  createGroundedFeatureAnalyzerRegistry,
} from "../src/services/grounded-analysis/feature-policy.js";
import { createGroundedSubmissionOnlyToolManifest } from "../src/services/grounded-analysis/structured-submission.js";
import { createGroundedAnalysisTransportController } from "../src/services/grounded-analysis/transport-controller.js";
import {
  GroundedTransportConfigurationError,
  type GroundedTerminalEventOutcomeManifest,
  type GroundedTransportLifecycleRecord,
} from "../src/services/grounded-analysis/transport-controller.js";

const streamSchemas = createGroundedStreamSchemas([
  { type: "started", terminal: false, payload: {} },
  { type: "complete", terminal: false, payload: { answer: z.string() } },
  { type: "complete", terminal: true, payload: { answer: z.string() } },
  { type: "failed", terminal: true, payload: { reason: z.string() } },
  { type: "cancelled", terminal: true, payload: { reason: z.string() } },
] as const);
const submissionSchema = z.object({ answer: z.string() }).strict();
const capability = "a".repeat(64);

interface PendingAnalysis {
  signal: AbortSignal;
  resolve(result: GroundedAnalysisResult<{ answer: string }>): void;
  reject(error: Error): void;
}

function createDeferredCompletedWriter() {
  let markStarted: () => void = () => undefined;
  let allowWrite: () => void = () => undefined;
  let failWrite: (error: Error) => void = () => undefined;
  let markWritten: () => void = () => undefined;
  let finishWrite: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const writeAllowed = new Promise<void>((resolve, reject) => {
    allowWrite = resolve;
    failWrite = reject;
  });
  const written = new Promise<void>((resolve) => {
    markWritten = resolve;
  });
  const writeFinished = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });

  return {
    started,
    written,
    allowWrite,
    failWrite,
    finishWrite,
    async write(controller: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array) {
      if (!new TextDecoder().decode(chunk).includes('"type":"complete"')) {
        controller.enqueue(chunk);
        return;
      }
      markStarted();
      await writeAllowed;
      controller.enqueue(chunk);
      markWritten();
      await writeFinished;
    },
  };
}

function createSyntheticRoute(options?: {
  completedWriter?: ReturnType<typeof createDeferredCompletedWriter>;
  terminalEventOutcomes?: GroundedTerminalEventOutcomeManifest;
  swapCompletedCallback?: boolean;
  swapFailedCallback?: boolean;
  startedEvent?: unknown;
}) {
  const pending = new Map<string, PendingAnalysis>();
  let providerCalls = 0;
  const provider: GroundedAnalysisProvider = {
    configurationStatus: {
      status: "configured",
      identity: {
        providerId: "synthetic-provider",
        modelId: "synthetic-model",
        extensionIds: [],
      },
    },
    analyze<Output>(request: GroundedAnalysisRequest<Output>) {
      providerCalls += 1;
      return new Promise<GroundedAnalysisResult<Output>>((resolve, reject) => {
        const operationId = request.audit.operationId;
        const rejectCancelled = () => reject(new DOMException("aborted", "AbortError"));
        request.signal.addEventListener("abort", rejectCancelled, { once: true });
        pending.set(operationId, {
          signal: request.signal,
          resolve: (result) => resolve(result as GroundedAnalysisResult<Output>),
          reject,
        });
      });
    },
  };
  const registry = createActiveGroundedOperationRegistry();
  const analyzer = createGroundedFeatureAnalyzer<
    { evidence: string },
    { answer: string },
    {
      citationId: string;
      sourceId: string;
      sourceVersion: string;
      evidenceClass: string;
      canonicalSummary: string;
      destination: { operationId: string; parameters: { itemId: string } };
    },
    { operationId: string; parameters: { itemId: string } },
    z.infer<typeof streamSchemas.EventSchema>
  >({
    provider,
    policy: {
      featureId: "synthetic-feature",
      featureVersion: "v1",
      policyPromptVersion: "v1",
      policyPrompt: "SYNTHETIC POLICY",
      allowedTools: createGroundedSubmissionOnlyToolManifest("synthetic-feature"),
      providerPayloadSchema: z.object({ evidence: z.string() }).strict(),
      providerPayloadFields: ["evidence"],
      submissionSchema,
      publicationSchema: submissionSchema,
      publicOutputFields: ["answer"],
      evidenceManifest: {
        manifestId: "synthetic-manifest",
        manifestVersion: "v1",
        evidenceClasses: ["synthetic-evidence"],
      },
      citationSchema: z
        .object({
          citationId: z.string(),
          sourceId: z.string(),
          sourceVersion: z.string(),
          evidenceClass: z.literal("synthetic-evidence"),
          canonicalSummary: z.string(),
          destination: z
            .object({
              operationId: z.literal("shelf.synthetic.get"),
              parameters: z.object({ itemId: z.string() }).strict(),
            })
            .strict(),
        })
        .strict(),
      destinationSchema: z
        .object({
          operationId: z.literal("shelf.synthetic.get"),
          parameters: z.object({ itemId: z.string() }).strict(),
        })
        .strict(),
      publication: {
        eventSchema: streamSchemas.EventSchema,
        terminalEventOutcomes: options?.terminalEventOutcomes ?? {
          completed: [{ type: "complete", terminal: true }],
          failed: [{ type: "failed", terminal: true }],
          cancelled: [{ type: "cancelled", terminal: true }],
        },
        startedEvent: (options && Object.hasOwn(options, "startedEvent")
          ? options.startedEvent
          : { type: "started" as const, terminal: false as const }) as never,
        completedEvent: ({ output }: GroundedAnalysisResult<{ answer: string }>) =>
          options?.swapCompletedCallback
            ? { type: "failed" as const, terminal: true as const, reason: "wrong-outcome" }
            : { type: "complete" as const, terminal: true as const, answer: output.answer },
        failedEvent: () =>
          options?.swapFailedCallback
            ? { type: "complete" as const, terminal: true as const, answer: "wrong-outcome" }
            : { type: "failed" as const, terminal: true as const, reason: "analysis-failed" },
        cancelledEvent: () => ({
          type: "cancelled" as const,
          terminal: true as const,
          reason: "analysis-cancelled",
        }),
      },
    },
  });
  const evidence = createGroundedEvidenceRegistry({
    manifest: {
      manifestId: "synthetic-manifest",
      manifestVersion: "v1",
      evidence: { "synthetic-evidence": z.object({ value: z.string() }).strict() },
    },
    evidenceIdentitySchema: z
      .object({
        citationId: z.string(),
        sourceId: z.string(),
        sourceVersion: z.string(),
        evidenceClass: z.literal("synthetic-evidence"),
      })
      .strict(),
    expectedSources: [],
  }).complete();
  const completedWriter = options?.completedWriter;
  let terminalizeCalls = 0;
  let reserveCalls = 0;
  const committedOutcomes: ("completed" | "failed")[] = [];
  let cleanupCalls = 0;
  let aborts = 0;
  const lifecycle: GroundedTransportLifecycleRecord[] = [];
  const operations: typeof registry = {
    ...registry,
    start(input) {
      const operation = registry.start(input);
      operation.signal.addEventListener("abort", () => {
        aborts += 1;
      });
      return operation;
    },
    terminalize(operationId, outcome) {
      terminalizeCalls += 1;
      return registry.terminalize(operationId, outcome);
    },
    reserveTerminal(operationId) {
      reserveCalls += 1;
      return registry.reserveTerminal(operationId);
    },
    commitTerminal(reservation, outcome) {
      committedOutcomes.push(outcome);
      return registry.commitTerminal(reservation, outcome);
    },
    cleanup(operationId) {
      cleanupCalls += 1;
      return registry.cleanup(operationId);
    },
  };
  const transport = createGroundedAnalysisTransportController({
    analyzers: createGroundedFeatureAnalyzerRegistry([analyzer]),
    operations,
    now: () => "2026-08-30T00:00:00.000Z",
    writeLifecycle: (record) => lifecycle.push(record),
    writeResponseChunk: completedWriter
      ? (controller, chunk) => completedWriter.write(controller, chunk)
      : undefined,
  });
  const app = new Hono();
  app.post("/synthetic", async (context) => {
    const body = await context.req.json<{
      operationId: string;
      transportId: string;
    }>();
    try {
      return transport.createStreamResponse({
        operation: {
          operationId: body.operationId,
          batchId: `${body.operationId}-batch`,
          requestId: `${body.operationId}-request`,
          capability,
          feature: "synthetic-feature",
        },
        transportId: body.transportId,
        requestSignal: context.req.raw.signal,
        encoding: "sse",
        analysis: {
          providerPayload: { evidence: "SYNTHETIC EVIDENCE" },
          evidence,
          citations: [],
          trigger: "synthetic-route",
          evidenceIdentityHash: "b".repeat(64),
        },
      });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : "unknown" }, 409);
    }
  });

  return {
    app,
    analyzer,
    pending,
    transport,
    providerCalls: () => providerCalls,
    terminalizeCalls: () => terminalizeCalls,
    reserveCalls: () => reserveCalls,
    committedOutcomes,
    cleanupCalls: () => cleanupCalls,
    aborts: () => aborts,
    lifecycle,
  };
}

function request(operationId: string, transportId: string, signal?: AbortSignal): Request {
  return new Request("http://localhost/synthetic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operationId, transportId }),
    signal,
  });
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for synthetic transport state");
}

describe("grounded-analysis production transport controller", () => {
  test("rejects a registry key that differs from the analyzer's bound feature", () => {
    const { analyzer } = createSyntheticRoute();

    expect(() =>
      createGroundedAnalysisTransportController({
        analyzers: {
          snapshot: () => [{ featureId: "substituted-feature", analyzer }],
        },
      }),
    ).toThrow("analyzer-feature-mismatch");
  });

  test("owns one Hono transport and rejects replacement before another provider call", async () => {
    const fixture = createSyntheticRoute();
    const firstResponse = await fixture.app.request(request("operation-1", "transport-1"));
    await waitFor(() => fixture.providerCalls() === 1);

    const duplicate = await fixture.app.request(request("operation-1", "transport-2"));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "Operation ID is already registered" });
    expect(fixture.providerCalls()).toBe(1);

    fixture.pending.get("operation-1")?.resolve({
      output: { answer: "grounded" },
      usage: { state: "unavailable" },
    });
    const body = await firstResponse.text();
    const events = body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => streamSchemas.EventSchema.parse(JSON.parse(line.slice(6))));
    expect(events).toMatchObject([
      { operationId: "operation-1", sequence: 0, type: "started", terminal: false },
      {
        operationId: "operation-1",
        sequence: 1,
        type: "complete",
        terminal: true,
        answer: "grounded",
      },
    ]);
    expect(events.filter(({ terminal }) => terminal)).toHaveLength(1);
    await waitFor(() => fixture.transport.discover().length === 0);
    expect(fixture.transport.cancel("operation-1", capability)).toBe(false);
    expect(fixture.terminalizeCalls()).toBe(0);
    expect(fixture.reserveCalls()).toBe(1);
    expect(fixture.committedOutcomes).toEqual(["completed"]);
    expect(fixture.cleanupCalls()).toBe(1);
    expect(fixture.lifecycle).toMatchObject([
      { recordType: "grounded-transport-attempt", operationId: "operation-1" },
      {
        recordType: "grounded-transport-outcome",
        operationId: "operation-1",
        outcome: "completed",
      },
    ]);
  });

  test("propagates Hono request disconnect to the exact provider signal and cleans up", async () => {
    const fixture = createSyntheticRoute();
    const requestController = new AbortController();
    const response = await fixture.app.request(
      request("operation-disconnect", "transport-1", requestController.signal),
    );
    await waitFor(() => fixture.pending.has("operation-disconnect"));
    const providerSignal = fixture.pending.get("operation-disconnect")?.signal;

    requestController.abort();

    expect(providerSignal?.aborted).toBe(true);
    let responseError: unknown;
    try {
      await response.text();
    } catch (error) {
      responseError = error;
    }
    expect(responseError).toMatchObject({ name: "AbortError" });
    await waitFor(() => fixture.transport.discover().length === 0);
    expect(fixture.providerCalls()).toBe(1);
    expect(fixture.cleanupCalls()).toBe(1);
    const outcomes = fixture.lifecycle.filter(
      ({ recordType }) => recordType === "grounded-transport-outcome",
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      operationId: "operation-disconnect",
      outcome: "transport-lost",
    });
  });

  test("emits one validated terminal failure without retry", async () => {
    const fixture = createSyntheticRoute();
    const response = await fixture.app.request(request("operation-failure", "transport-1"));
    await waitFor(() => fixture.pending.has("operation-failure"));
    fixture.pending.get("operation-failure")?.reject(new Error("synthetic provider failure"));

    const body = await response.text();
    const terminal = body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => streamSchemas.EventSchema.parse(JSON.parse(line.slice(6))))
      .filter(({ terminal }) => terminal);
    expect(terminal).toMatchObject([{ type: "failed", terminal: true, reason: "analysis-failed" }]);
    expect(fixture.providerCalls()).toBe(1);
    expect(fixture.terminalizeCalls()).toBe(1);
    expect(fixture.aborts()).toBe(1);
    await waitFor(() => fixture.transport.discover().length === 0);
  });

  test("never records completed when feature publication output is invalid", async () => {
    const fixture = createSyntheticRoute();
    const response = await fixture.app.request(request("operation-invalid", "transport-1"));
    await waitFor(() => fixture.pending.has("operation-invalid"));
    fixture.pending.get("operation-invalid")?.resolve({
      output: { answer: 42 as unknown as string },
      usage: { state: "unavailable" },
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected synthetic response stream");
    const decoder = new TextDecoder();
    let streamed = "";
    let streamError: unknown;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamed += decoder.decode(value, { stream: true });
      }
    } catch (error) {
      streamError = error;
    }

    expect(streamError).toBeUndefined();
    expect(streamed).toContain('"type":"failed"');
    expect(streamed).not.toContain('"type":"complete"');
    expect(fixture.lifecycle.at(-1)).toMatchObject({
      recordType: "grounded-transport-outcome",
      outcome: "failed",
    });
    expect(fixture.pending.get("operation-invalid")?.signal.aborted).toBe(true);
    expect(
      fixture.lifecycle.filter(({ recordType }) => recordType === "grounded-transport-outcome"),
    ).toHaveLength(1);
    expect(fixture.terminalizeCalls()).toBe(1);
    expect(fixture.reserveCalls()).toBe(0);
    expect(fixture.committedOutcomes).toEqual([]);
    await waitFor(() => fixture.transport.discover().length === 0);
  });

  test("never records completed when writing the completed terminal event fails", async () => {
    const completedWriter = createDeferredCompletedWriter();
    const fixture = createSyntheticRoute({ completedWriter });
    const response = await fixture.app.request(request("operation-write-failure", "transport-1"));
    await waitFor(() => fixture.pending.has("operation-write-failure"));
    fixture.pending.get("operation-write-failure")?.resolve({
      output: { answer: "grounded" },
      usage: { state: "unavailable" },
    });
    await completedWriter.started;
    completedWriter.failWrite(new Error("synthetic response writer failure"));

    let streamError: unknown;
    try {
      await response.text();
    } catch (error) {
      streamError = error;
    }
    expect(streamError).toMatchObject({ message: "synthetic response writer failure" });
    expect(fixture.lifecycle.at(-1)).toMatchObject({
      recordType: "grounded-transport-outcome",
      outcome: "failed",
    });
    expect(fixture.pending.get("operation-write-failure")?.signal.aborted).toBe(true);
    expect(
      fixture.lifecycle.filter(({ recordType }) => recordType === "grounded-transport-outcome"),
    ).toHaveLength(1);
    expect(
      fixture.lifecycle.some(
        (record) =>
          record.recordType === "grounded-transport-outcome" && record.outcome === "completed",
      ),
    ).toBe(false);
    expect(fixture.terminalizeCalls()).toBe(0);
    expect(fixture.reserveCalls()).toBe(1);
    expect(fixture.committedOutcomes).toEqual(["failed"]);
    await waitFor(() => fixture.transport.discover().length === 0);
  });

  test("lets cancellation win before provider completion without a completed event", async () => {
    const fixture = createSyntheticRoute();
    const response = await fixture.app.request(request("operation-cancel", "transport-1"));
    await waitFor(() => fixture.pending.has("operation-cancel"));

    expect(fixture.transport.cancel("operation-cancel", capability)).toBe(true);

    const body = await response.text();
    expect(body).toContain('"type":"cancelled"');
    expect(body).not.toContain('"type":"complete"');
    expect(fixture.lifecycle.at(-1)).toMatchObject({
      recordType: "grounded-transport-outcome",
      outcome: "cancelled",
    });
    expect(fixture.providerCalls()).toBe(1);
    expect(fixture.reserveCalls()).toBe(0);
    expect(fixture.committedOutcomes).toEqual([]);
    await waitFor(() => fixture.transport.discover().length === 0);
  });

  test("rejects cancellation while the completed terminal write is deferred", async () => {
    const completedWriter = createDeferredCompletedWriter();
    const fixture = createSyntheticRoute({ completedWriter });
    const response = await fixture.app.request(request("operation-during-write", "transport-1"));
    await waitFor(() => fixture.pending.has("operation-during-write"));
    fixture.pending.get("operation-during-write")?.resolve({
      output: { answer: "grounded" },
      usage: { state: "unavailable" },
    });
    await completedWriter.started;

    expect(fixture.transport.cancel("operation-during-write", capability)).toBe(false);
    completedWriter.allowWrite();
    completedWriter.finishWrite();

    const body = await response.text();
    expect(body).toContain('"type":"complete"');
    expect(body).not.toContain('"type":"failed"');
    expect(body.match(/"terminal":true/g)).toHaveLength(1);
    expect(fixture.reserveCalls()).toBe(1);
    expect(fixture.terminalizeCalls()).toBe(0);
    expect(fixture.committedOutcomes).toEqual(["completed"]);
    expect(fixture.lifecycle.at(-1)).toMatchObject({ outcome: "completed" });
    expect(
      fixture.lifecycle.filter(({ recordType }) => recordType === "grounded-transport-outcome"),
    ).toHaveLength(1);
    expect(fixture.pending.get("operation-during-write")?.signal.aborted).toBe(false);
    await waitFor(() => fixture.transport.discover().length === 0);
  });

  test("rejects cancellation after the completed bytes are written but before commit", async () => {
    const completedWriter = createDeferredCompletedWriter();
    const fixture = createSyntheticRoute({ completedWriter });
    const response = await fixture.app.request(request("operation-after-write", "transport-1"));
    await waitFor(() => fixture.pending.has("operation-after-write"));
    fixture.pending.get("operation-after-write")?.resolve({
      output: { answer: "grounded" },
      usage: { state: "unavailable" },
    });
    await completedWriter.started;
    completedWriter.allowWrite();
    await completedWriter.written;

    expect(fixture.transport.cancel("operation-after-write", capability)).toBe(false);
    completedWriter.finishWrite();

    const body = await response.text();
    expect(body).toContain('"type":"complete"');
    expect(body).not.toContain('"type":"failed"');
    expect(body.match(/"terminal":true/g)).toHaveLength(1);
    expect(fixture.reserveCalls()).toBe(1);
    expect(fixture.terminalizeCalls()).toBe(0);
    expect(fixture.committedOutcomes).toEqual(["completed"]);
    expect(fixture.lifecycle.at(-1)).toMatchObject({ outcome: "completed" });
    expect(
      fixture.lifecycle.filter(({ recordType }) => recordType === "grounded-transport-outcome"),
    ).toHaveLength(1);
    expect(fixture.pending.get("operation-after-write")?.signal.aborted).toBe(false);
    await waitFor(() => fixture.transport.discover().length === 0);
  });

  test("fails closed when the completed callback returns a failure terminal", async () => {
    const fixture = createSyntheticRoute({ swapCompletedCallback: true });
    const response = await fixture.app.request(
      request("operation-swapped-complete", "transport-1"),
    );
    await waitFor(() => fixture.pending.has("operation-swapped-complete"));
    fixture.pending.get("operation-swapped-complete")?.resolve({
      output: { answer: "grounded" },
      usage: { state: "unavailable" },
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected synthetic response stream");
    const decoder = new TextDecoder();
    let streamed = "";
    let streamError: unknown;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamed += decoder.decode(value, { stream: true });
      }
    } catch (error) {
      streamError = error;
    }

    expect(streamError).toMatchObject({
      message: "Grounded terminal event does not match completed lifecycle outcome",
    });
    expect(streamed).toContain('"type":"failed"');
    expect(streamed).not.toContain('"type":"complete"');
    expect(streamed.match(/"terminal":true/g)).toHaveLength(1);
    expect(fixture.committedOutcomes).toEqual(["failed"]);
    expect(fixture.lifecycle.at(-1)).toMatchObject({ outcome: "failed" });
    expect(fixture.pending.get("operation-swapped-complete")?.signal.aborted).toBe(true);
    await waitFor(() => fixture.transport.discover().length === 0);
  });

  test("fails closed when the failed callback returns a completion terminal", async () => {
    const fixture = createSyntheticRoute({ swapFailedCallback: true });
    const response = await fixture.app.request(request("operation-swapped-failure", "transport-1"));
    await waitFor(() => fixture.pending.has("operation-swapped-failure"));
    fixture.pending
      .get("operation-swapped-failure")
      ?.reject(new Error("synthetic provider failure"));

    let streamError: unknown;
    try {
      await response.text();
    } catch (error) {
      streamError = error;
    }
    expect(streamError).toMatchObject({
      message: "Grounded terminal event does not match failed lifecycle outcome",
    });
    expect(fixture.terminalizeCalls()).toBe(1);
    expect(fixture.committedOutcomes).toEqual([]);
    expect(fixture.lifecycle.at(-1)).toMatchObject({ outcome: "failed" });
    expect(fixture.pending.get("operation-swapped-failure")?.signal.aborted).toBe(true);
    await waitFor(() => fixture.transport.discover().length === 0);
  });

  test("snapshots terminal outcome bindings before caller mutation", async () => {
    const completed = [{ type: "complete", terminal: true as const }];
    const failed = [{ type: "failed", terminal: true as const }];
    const cancelled = [{ type: "cancelled", terminal: true as const }];
    const terminalEventOutcomes = { completed, failed, cancelled };
    const fixture = createSyntheticRoute({ terminalEventOutcomes });
    completed[0] = { type: "mutated-complete", terminal: true };
    failed[0] = { type: "complete", terminal: true };
    cancelled.push({ type: "mutated-cancelled", terminal: true });

    const response = await fixture.app.request(request("operation-snapshot", "transport-1"));
    await waitFor(() => fixture.pending.has("operation-snapshot"));
    fixture.pending.get("operation-snapshot")?.resolve({
      output: { answer: "grounded" },
      usage: { state: "unavailable" },
    });

    const body = await response.text();
    expect(body).toContain('"type":"complete"');
    expect(fixture.committedOutcomes).toEqual(["completed"]);
    expect(fixture.lifecycle.at(-1)).toMatchObject({ outcome: "completed" });
    await waitFor(() => fixture.transport.discover().length === 0);
  });

  test.each([
    [
      "empty",
      { completed: [], failed: [{ type: "failed", terminal: true }], cancelled: [] },
      "terminal-outcome-must-be-nonempty",
    ],
    [
      "overlapping",
      {
        completed: [{ type: "complete", terminal: true }],
        failed: [{ type: "complete", terminal: true }],
        cancelled: [{ type: "cancelled", terminal: true }],
      },
      "overlapping-terminal-event-binding",
    ],
    [
      "nonterminal",
      {
        completed: [{ type: "complete", terminal: false }],
        failed: [{ type: "failed", terminal: true }],
        cancelled: [{ type: "cancelled", terminal: true }],
      },
      "invalid-terminal-event-binding",
    ],
  ] as const)("rejects %s outcome bindings at construction", (_case, manifest, safeDetail) => {
    let configurationError: unknown;
    try {
      createSyntheticRoute({
        terminalEventOutcomes: manifest as unknown as GroundedTerminalEventOutcomeManifest,
      });
    } catch (error) {
      configurationError = error;
    }
    expect(configurationError).toBeInstanceOf(GroundedTransportConfigurationError);
    expect(configurationError).toMatchObject({
      code: "invalid-terminal-event-outcome-manifest",
      safeDetail,
    });
  });

  test.each([
    ["schema-valid terminal", { type: "complete", terminal: true, answer: "must-not-be-emitted" }],
    [
      "terminal-bound nonterminal",
      { type: "complete", terminal: false, answer: "must-not-be-emitted" },
    ],
    ["malformed nonterminal", { type: "started", terminal: false, leaked: "must-not-be-emitted" }],
  ] as const)(
    "rejects a casted %s started event before provider invocation",
    (_case, startedEvent) => {
      expect(() => createSyntheticRoute({ startedEvent })).toThrow();
    },
  );
});
