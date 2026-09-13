import { createLogger } from "../logger.js";
import {
  createActiveGroundedOperationRegistry,
  type GroundedActiveOperationDiscovery,
  type GroundedOperationTerminalReservation,
  type GroundedOperationTerminalOutcome,
} from "./active-operation-registry.js";
import { GroundedCapabilityError } from "./capability-inspection.js";
import {
  GroundedFeaturePolicyConfigurationError,
  isGroundedFeatureAnalyzer,
  type GroundedFeatureAnalysisRequest,
  type GroundedFeatureAnalyzerBinding,
  type GroundedFeatureAnalyzerRegistry,
} from "./feature-policy.js";
export {
  GroundedPublicationPolicyConfigurationError as GroundedTransportConfigurationError,
  type GroundedTerminalEventOutcomeManifest,
} from "./publication-policy.js";
import { createGroundedStreamWriter, type GroundedStreamEncoding } from "./stream-writer.js";

export interface GroundedTransportOperationIdentity {
  operationId: string;
  batchId: string;
  requestId: string;
  capability: string;
  feature: string;
}

export interface GroundedAnalysisStreamRequest {
  operation: GroundedTransportOperationIdentity;
  transportId: string;
  requestSignal: AbortSignal;
  encoding: GroundedStreamEncoding;
  analysis: Omit<
    GroundedFeatureAnalysisRequest,
    "signal" | "operationId" | "batchId" | "requestId"
  >;
}

export interface GroundedAnalysisTransportController {
  createStreamResponse(input: GroundedAnalysisStreamRequest): Response;
  cancel(operationId: string, capability: string): boolean;
  discover(): readonly GroundedActiveOperationDiscovery[];
}

export type GroundedTransportLifecycleRecord =
  | (Omit<GroundedTransportOperationIdentity, "capability"> & {
      recordType: "grounded-transport-attempt";
      occurredAt: string;
    })
  | (Omit<GroundedTransportOperationIdentity, "capability"> & {
      recordType: "grounded-transport-outcome";
      occurredAt: string;
      outcome: GroundedOperationTerminalOutcome;
    });

export function createGroundedAnalysisTransportController(options: {
  analyzers: Pick<GroundedFeatureAnalyzerRegistry, "snapshot">;
  operations?: ReturnType<typeof createActiveGroundedOperationRegistry>;
  now?: () => string;
  writeLifecycle?: (record: GroundedTransportLifecycleRecord) => void;
  writeResponseChunk?: (
    controller: ReadableStreamDefaultController<Uint8Array>,
    chunk: Uint8Array,
  ) => void | Promise<void>;
}): GroundedAnalysisTransportController {
  const analyzerByFeature = new Map<string, GroundedFeatureAnalyzerBinding["analyzer"]>();
  const analyzerBindings = [...options.analyzers.snapshot()];
  for (const binding of analyzerBindings) {
    const featureId = binding.featureId;
    const analyzer = binding.analyzer;
    if (!isGroundedFeatureAnalyzer(analyzer)) {
      throw new GroundedFeaturePolicyConfigurationError("unowned-feature-analyzer");
    }
    if (featureId !== analyzer.featureId) {
      throw new GroundedFeaturePolicyConfigurationError("analyzer-feature-mismatch");
    }
    if (analyzerByFeature.has(featureId)) {
      throw new GroundedFeaturePolicyConfigurationError("duplicate-feature-policy");
    }
    analyzerByFeature.set(featureId, analyzer);
  }
  const now = options.now ?? (() => new Date().toISOString());
  const baseLogger = createLogger("grounded-analysis-transport");
  const writeLifecycle = options.writeLifecycle ?? ((record) => baseLogger.log(record));
  const writeResponseChunk =
    options.writeResponseChunk ??
    ((controller: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array) =>
      controller.enqueue(chunk));
  const operations = options.operations ?? createActiveGroundedOperationRegistry({ now });
  function createStreamResponse(input: GroundedAnalysisStreamRequest): Response {
    if (input.requestSignal.aborted) {
      throw new DOMException("The initiating transport is already disconnected", "AbortError");
    }

    const analyzer = analyzerByFeature.get(input.operation.feature);
    if (!analyzer) throw new GroundedCapabilityError("unknown-feature-policy");
    const publication = analyzer.publication;
    let responseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const writer = createGroundedStreamWriter({
      operationId: input.operation.operationId,
      eventSchema: publication.eventSchema,
      encoding: input.encoding,
      write(serialized) {
        if (!responseController) throw new Error("Grounded response transport is unavailable");
        return writeResponseChunk(responseController, encoder.encode(serialized));
      },
      now,
    });

    const operation = operations.start(input.operation);
    const disconnect = new AbortController();
    const onRequestDisconnect = () => disconnect.abort();
    input.requestSignal.addEventListener("abort", onRequestDisconnect, { once: true });
    let transport: ReturnType<typeof operations.claimTransport>;
    try {
      transport = operations.claimTransport(
        input.operation.operationId,
        input.transportId,
        disconnect.signal,
      );
    } catch (error) {
      input.requestSignal.removeEventListener("abort", onRequestDisconnect);
      operations.terminalize(input.operation.operationId, "failed");
      operations.cleanup(input.operation.operationId);
      throw error;
    }
    const lifecycleIdentity = {
      operationId: input.operation.operationId,
      batchId: input.operation.batchId,
      requestId: input.operation.requestId,
      feature: input.operation.feature,
    };
    try {
      writeLifecycle({
        ...lifecycleIdentity,
        recordType: "grounded-transport-attempt",
        occurredAt: now(),
      });
    } catch (error) {
      input.requestSignal.removeEventListener("abort", onRequestDisconnect);
      transport.release();
      operations.cleanup(input.operation.operationId);
      throw error;
    }

    let executionStarted = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        responseController = controller;
        if (executionStarted) throw new Error("Grounded transport execution already started");
        executionStarted = true;
        void (async () => {
          let completionReservation: GroundedOperationTerminalReservation | undefined;
          try {
            if (publication.startedEvent !== undefined) {
              await writer.write(publication.startedEvent);
            }
            const result = await analyzer.analyze({
              ...input.analysis,
              operationId: input.operation.operationId,
              batchId: input.operation.batchId,
              requestId: input.operation.requestId,
              signal: operation.signal,
            });
            completionReservation = operations.reserveTerminal(input.operation.operationId);
            if (!completionReservation) {
              throw new DOMException(
                "Grounded operation ended before provider completion",
                "AbortError",
              );
            }
            const completedEvent = publication.completedEvent(result);
            await writer.write(completedEvent);
            if (!operations.commitTerminal(completionReservation, "completed")) {
              throw new Error("Grounded completion reservation could not be committed");
            }
            writer.close();
            controller.close();
          } catch (error) {
            const state = operations
              .discover()
              .find(({ operationId }) => operationId === input.operation.operationId);
            const transportLost = state?.outcome === "transport-lost";
            if (transportLost) {
              controller.error(error);
            } else {
              if (state?.outcome === "completed") {
                controller.error(error);
                return;
              }
              const wonFailure =
                completionReservation !== undefined
                  ? operations.commitTerminal(completionReservation, "failed")
                  : state?.state === "terminal"
                    ? state.outcome === "cancelled"
                    : operations.terminalize(input.operation.operationId, "failed");
              if (wonFailure) {
                if (completionReservation) {
                  try {
                    const failedEvent = publication.failedEvent(error);
                    await writer.write(failedEvent);
                    writer.close();
                  } catch {
                    // A failed terminal write permanently closes the writer to further output.
                  }
                  controller.error(error);
                } else {
                  try {
                    const terminalEvent =
                      state?.outcome === "cancelled"
                        ? publication.cancelledEvent(error)
                        : publication.failedEvent(error);
                    await writer.write(terminalEvent);
                    writer.close();
                    controller.close();
                  } catch (streamError) {
                    controller.error(streamError);
                  }
                }
              } else {
                controller.error(error);
              }
            }
          } finally {
            responseController = undefined;
            input.requestSignal.removeEventListener("abort", onRequestDisconnect);
            const terminal = operations
              .discover()
              .find(({ operationId }) => operationId === input.operation.operationId);
            try {
              if (terminal?.outcome) {
                writeLifecycle({
                  ...lifecycleIdentity,
                  recordType: "grounded-transport-outcome",
                  occurredAt: now(),
                  outcome: terminal.outcome,
                });
              }
            } finally {
              transport.release();
              operations.cleanup(input.operation.operationId);
            }
          }
        })();
      },
      cancel() {
        disconnect.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": input.encoding === "sse" ? "text/event-stream" : "application/x-ndjson",
      },
    });
  }

  return Object.freeze({
    createStreamResponse,
    cancel: (operationId: string, capability: string) => operations.cancel(operationId, capability),
    discover: () => operations.discover(),
  });
}
