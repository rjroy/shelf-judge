import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { streamSimple as openAiCompletionsStreamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import {
  groundedProviderFailureDiagnostics,
  type GroundedProviderFailureDiagnostics,
} from "./model-logger.js";

export type TransportPhase = "awaiting-headers" | "reading-body";

export interface NativeTransportDiagnostic {
  phase: TransportPhase;
  outcome: "headers-received" | "completed" | "failed" | "cancelled";
  url: string;
  durationMs: number;
  headersReceivedAt?: string;
  readIdleMs?: number;
  status?: number;
  error?: GroundedProviderFailureDiagnostics;
  abort?: { aborted: boolean; reason?: GroundedProviderFailureDiagnostics["primary"] };
}

export interface NativeTransportDiagnosticSink {
  (diagnostic: NativeTransportDiagnostic): void;
}

type BunTransportRequestInit = RequestInit & { timeout: false };

function redactedUrl(input: RequestInfo | URL): string {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

function failureDetail(value: unknown): GroundedProviderFailureDiagnostics["primary"] | undefined {
  if (value === undefined) return undefined;
  return groundedProviderFailureDiagnostics(value).primary;
}

function abortState(signal: AbortSignal | null | undefined): NativeTransportDiagnostic["abort"] {
  return {
    aborted: signal?.aborted ?? false,
    ...(signal?.aborted ? { reason: failureDetail(signal.reason) } : {}),
  };
}

function isOpenAiCompletionsModel(model: Model<Api>): model is Model<"openai-completions"> {
  return model.api === "openai-completions";
}

function safeReport(
  sink: NativeTransportDiagnosticSink | undefined,
  diagnostic: NativeTransportDiagnostic,
): void {
  try {
    sink?.(diagnostic);
  } catch {
    // Diagnostics must never affect Pi's request or response stream.
  }
}

function wrapBody(
  body: ReadableStream<Uint8Array>,
  report: NativeTransportDiagnosticSink | undefined,
  base: Omit<
    NativeTransportDiagnostic,
    "outcome" | "durationMs" | "readIdleMs" | "error" | "abort"
  >,
  signal: AbortSignal | null | undefined,
  nowMs: () => number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let lastReadAt = nowMs();
  let terminal = false;
  const release = () => {
    try {
      reader.releaseLock();
    } catch {
      // A completed, errored, or cancelled stream may already release its reader.
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (terminal) return;
      try {
        const result = await reader.read();
        if (terminal) return;
        const readAt = nowMs();
        const readIdleMs = Math.max(0, Math.round(readAt - lastReadAt));
        lastReadAt = readAt;
        if (result.done) {
          terminal = true;
          safeReport(report, {
            ...base,
            outcome: "completed",
            durationMs: readIdleMs,
            readIdleMs,
            abort: abortState(signal),
          });
          controller.close();
          release();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        if (terminal) return;
        terminal = true;
        const endedAt = nowMs();
        safeReport(report, {
          ...base,
          outcome: "failed",
          durationMs: Math.max(0, Math.round(endedAt - lastReadAt)),
          readIdleMs: Math.max(0, Math.round(endedAt - lastReadAt)),
          error: groundedProviderFailureDiagnostics(error),
          abort: abortState(signal),
        });
        controller.error(error);
        release();
      }
    },
    async cancel(reason) {
      if (terminal) return;
      terminal = true;
      const cancelledAt = nowMs();
      try {
        await reader.cancel(reason);
      } finally {
        safeReport(report, {
          ...base,
          outcome: "cancelled",
          durationMs: Math.max(0, Math.round(cancelledAt - lastReadAt)),
          readIdleMs: Math.max(0, Math.round(cancelledAt - lastReadAt)),
          abort: abortState(signal),
        });
        release();
      }
    },
  });
}

/**
 * Delegates all request construction and stream parsing to Pi's OpenAI adapter while
 * exposing native fetch failures before that adapter can normalize them.
 */
export function createDiagnosticOpenAiCompletionsStream(
  sink: NativeTransportDiagnosticSink | undefined,
  nowMs: () => number = () => performance.now(),
) {
  return (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    if (!isOpenAiCompletionsModel(model)) {
      throw new Error("Native transport diagnostics require the openai-completions API");
    }
    return openAiCompletionsStreamSimple(model, context, {
      ...options,
      fetch: createDiagnosticFetch(options?.fetch ?? globalThis.fetch, sink, nowMs),
    });
  };
}

/** Wraps one fetch implementation only; it never mutates global fetch. */
export function createDiagnosticFetch(
  fetchImplementation: typeof fetch,
  sink: NativeTransportDiagnosticSink | undefined,
  nowMs: () => number = () => performance.now(),
): typeof fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const startedAt = nowMs();
      const url = redactedUrl(input);
      const signal = init?.signal;
      try {
        // Bun's supported `timeout: false` disables only its native HTTP timeout.
        // Pi still provides the signal that owns cancellation and its configured deadline.
        const transportInit: BunTransportRequestInit = { ...init, timeout: false };
        const response = await fetchImplementation(input, transportInit);
        const headersAt = nowMs();
        const headersReceivedAt = new Date().toISOString();
        safeReport(sink, {
          phase: "awaiting-headers",
          outcome: "headers-received",
          url,
          durationMs: Math.max(0, Math.round(headersAt - startedAt)),
          headersReceivedAt,
          status: response.status,
          abort: abortState(signal),
        });
        if (!response.body) return response;
        const body = wrapBody(
          response.body,
          sink,
          { phase: "reading-body", url, headersReceivedAt, status: response.status },
          signal,
          nowMs,
        );
        const wrapped = new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        Object.defineProperties(wrapped, {
          url: { value: response.url, configurable: true },
          redirected: { value: response.redirected, configurable: true },
          type: { value: response.type, configurable: true },
        });
        return wrapped;
      } catch (error) {
        const endedAt = nowMs();
        safeReport(sink, {
          phase: "awaiting-headers",
          outcome: "failed",
          url,
          durationMs: Math.max(0, Math.round(endedAt - startedAt)),
          error: groundedProviderFailureDiagnostics(error),
          abort: abortState(signal),
        });
        throw error;
      }
    },
    { preconnect: fetchImplementation.preconnect },
  ) satisfies typeof fetch;
}
