import { describe, expect, test } from "bun:test";
import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import {
  createDiagnosticOpenAiCompletionsStream,
  createDiagnosticFetch,
  type NativeTransportDiagnostic,
} from "../src/services/grounded-analysis/transport-diagnostics.js";

const model = {
  id: "qwen3.6:27B",
  name: "qwen3.6:27B",
  provider: "ollama",
  api: "openai-completions",
  baseUrl: "http://user:secret@127.0.0.1:11434/v1?api_key=secret",
  reasoning: false,
  input: ["text"],
  contextWindow: 262144,
  maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} satisfies Model<Api>;

const context = { messages: [] } satisfies Context;
type BunTransportRequestInit = RequestInit & { timeout: false };

async function consume(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const event of stream) {
    // Pi's official adapter owns event parsing; diagnostics do not inspect content.
    void event;
  }
}

describe("native Pi transport diagnostics", () => {
  test("records the native cause hidden by Pi's normalized Request timed out error", async () => {
    const records: NativeTransportDiagnostic[] = [];
    const nativeCause = Object.assign(new Error("socket timed out"), {
      name: "TimeoutError",
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    const originalFetch = globalThis.fetch;
    const stream = createDiagnosticOpenAiCompletionsStream((record) => records.push(record))(
      model,
      context,
      {
        apiKey: "ollama",
        fetch: Object.assign(
          () => Promise.reject(new Error("Request timed out", { cause: nativeCause })),
          { preconnect: globalThis.fetch.preconnect },
        ),
        timeoutMs: 123,
      },
    );

    await consume(stream);

    expect(globalThis.fetch).toBe(originalFetch);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      phase: "awaiting-headers",
      outcome: "failed",
      url: "http://127.0.0.1:11434/v1",
      error: {
        primary: { message: "Request timed out" },
        causeChain: [{ name: "TimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" }],
      },
    });
  });

  test("preserves Pi callbacks, timeout and abort signal while reporting response completion", async () => {
    const records: NativeTransportDiagnostic[] = [];
    const signal = new AbortController().signal;
    let payloadCalls = 0;
    let responseCalls = 0;
    let receivedSignal: AbortSignal | null | undefined;
    let receivedTimeout: false | undefined;
    const sse =
      'data: {"id":"response-1","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const stream = createDiagnosticOpenAiCompletionsStream((record) => records.push(record))(
      model,
      context,
      {
        apiKey: "ollama",
        timeoutMs: 321,
        signal,
        onPayload: (payload) => {
          payloadCalls += 1;
          return payload;
        },
        onResponse: () => {
          responseCalls += 1;
        },
        fetch: Object.assign(
          (_input: RequestInfo | URL, init?: RequestInit) => {
            receivedSignal = init?.signal;
            receivedTimeout = (init as BunTransportRequestInit).timeout;
            return Promise.resolve(
              new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
            );
          },
          { preconnect: globalThis.fetch.preconnect },
        ),
      } satisfies SimpleStreamOptions,
    );

    await consume(stream);

    expect(payloadCalls).toBe(1);
    expect(responseCalls).toBe(1);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedTimeout).toBe(false);
    expect(records.map(({ phase, outcome }) => ({ phase, outcome }))).toEqual([
      { phase: "awaiting-headers", outcome: "headers-received" },
      { phase: "reading-body", outcome: "completed" },
    ]);
  });

  test("lets Pi's configured deadline abort headers after disabling Bun's native timeout", async () => {
    const records: NativeTransportDiagnostic[] = [];
    let receivedTimeout: false | undefined;
    let receivedSignal: AbortSignal | null | undefined;
    const stream = createDiagnosticOpenAiCompletionsStream((record) => records.push(record))(
      model,
      context,
      {
        apiKey: "ollama",
        timeoutMs: 10,
        fetch: Object.assign(
          (_input: RequestInfo | URL, init?: RequestInit) => {
            receivedTimeout = (init as BunTransportRequestInit).timeout;
            receivedSignal = init?.signal;
            return new Promise<Response>((_resolve, reject) => {
              const abort = () => {
                const reason: unknown = init?.signal?.reason;
                reject(
                  reason instanceof Error
                    ? reason
                    : new Error("Request aborted", { cause: reason }),
                );
              };
              if (init?.signal?.aborted) abort();
              else init?.signal?.addEventListener("abort", abort, { once: true });
            });
          },
          { preconnect: globalThis.fetch.preconnect },
        ),
      },
    );

    await consume(stream);

    expect(receivedTimeout).toBe(false);
    expect(receivedSignal?.aborted).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      phase: "awaiting-headers",
      outcome: "failed",
      abort: { aborted: true },
    });
  });

  test("lets a caller cancel the official Pi adapter while retaining its abort diagnostic", async () => {
    const records: NativeTransportDiagnostic[] = [];
    const controller = new AbortController();
    const reason = new Error("Pi cancellation");
    let markFetchStarted: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const stream = createDiagnosticOpenAiCompletionsStream((record) => records.push(record))(
      model,
      context,
      {
        apiKey: "ollama",
        signal: controller.signal,
        fetch: Object.assign(
          (_input: RequestInfo | URL, init?: RequestInit) => {
            markFetchStarted();
            return new Promise<Response>((_resolve, reject) => {
              const abort = () => {
                const abortReason: unknown = init?.signal?.reason;
                reject(
                  abortReason instanceof Error
                    ? abortReason
                    : new Error("Request aborted", { cause: abortReason }),
                );
              };
              if (init?.signal?.aborted) abort();
              else init?.signal?.addEventListener("abort", abort, { once: true });
            });
          },
          { preconnect: globalThis.fetch.preconnect },
        ),
      },
    );

    const consuming = consume(stream);
    await fetchStarted;
    controller.abort(reason);
    await consuming;

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      phase: "awaiting-headers",
      outcome: "failed",
      error: { primary: { name: "AbortError" } },
      abort: { aborted: true },
    });
  });

  test("reports a stream read failure after headers without replacing its error", async () => {
    const records: NativeTransportDiagnostic[] = [];
    const readFailure = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(readFailure);
      },
    });
    const stream = createDiagnosticOpenAiCompletionsStream((record) => records.push(record))(
      model,
      context,
      {
        apiKey: "ollama",
        fetch: Object.assign(() => Promise.resolve(new Response(body, { status: 200 })), {
          preconnect: globalThis.fetch.preconnect,
        }),
      },
    );

    await consume(stream);

    const failure = records.find(
      (record) => record.phase === "reading-body" && record.outcome === "failed",
    );
    expect(failure?.error).toMatchObject({
      primary: { message: "connection reset", code: "ECONNRESET" },
      causeChain: [],
    });
    expect(body.locked).toBe(false);
  });

  test("reports the live request abort state when a native body read fails", async () => {
    const records: NativeTransportDiagnostic[] = [];
    const controller = new AbortController();
    const reason = new Error("stream cancellation");
    const body = new ReadableStream<Uint8Array>({
      pull(streamController) {
        streamController.error(new Error("connection closed"));
      },
    });
    const diagnosticFetch = createDiagnosticFetch(
      Object.assign(() => Promise.resolve(new Response(body, { status: 200 })), {
        preconnect: globalThis.fetch.preconnect,
      }),
      (record) => records.push(record),
    );

    const response = await diagnosticFetch("http://127.0.0.1:11434/v1/chat/completions", {
      signal: controller.signal,
    });
    controller.abort(reason);
    try {
      await response.text();
    } catch {
      // The native stream error remains the response body's error.
    }

    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      phase: "reading-body",
      outcome: "failed",
      abort: { aborted: true, reason: { message: "stream cancellation" } },
    });
  });

  test("preserves native response metadata and releases a cancelled body reader", async () => {
    const records: NativeTransportDiagnostic[] = [];
    let cancellationReason: unknown;
    const body = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancellationReason = reason;
      },
    });
    const response = new Response(body, { status: 206, statusText: "Partial Content" });
    Object.defineProperties(response, {
      url: { value: "http://127.0.0.1:11434/v1/chat/completions", configurable: true },
      redirected: { value: true, configurable: true },
      type: { value: "basic", configurable: true },
    });
    const diagnosticFetch = createDiagnosticFetch(
      Object.assign(() => Promise.resolve(response), { preconnect: globalThis.fetch.preconnect }),
      (record) => records.push(record),
    );

    const wrapped = await diagnosticFetch("http://127.0.0.1:11434/v1/chat/completions");
    const reason = new DOMException("cancelled", "AbortError");
    await wrapped.body?.cancel(reason);

    expect({ url: wrapped.url, redirected: wrapped.redirected, type: wrapped.type }).toEqual({
      url: "http://127.0.0.1:11434/v1/chat/completions",
      redirected: true,
      type: "basic",
    });
    expect(cancellationReason).toBe(reason);
    expect(body.locked).toBe(false);
    expect(records.map(({ outcome }) => outcome)).toEqual(["headers-received", "cancelled"]);
    expect(records[1]).toMatchObject({ abort: { aborted: false } });
  });

  test("preserves native body methods and cloning on a wrapped HTTP error response", async () => {
    const response = new Response('{"message":"provider unavailable"}', {
      status: 500,
      statusText: "Provider Error",
      headers: { "content-type": "application/json", "x-request-id": "request-1" },
    });
    const diagnosticFetch = createDiagnosticFetch(
      Object.assign(() => Promise.resolve(response), { preconnect: globalThis.fetch.preconnect }),
      undefined,
    );

    const wrapped = await diagnosticFetch("http://127.0.0.1:11434/v1/chat/completions");
    const clone = wrapped.clone();

    expect(wrapped.status).toBe(500);
    expect(wrapped.statusText).toBe("Provider Error");
    expect(wrapped.headers.get("x-request-id")).toBe("request-1");
    expect(await wrapped.json()).toEqual({ message: "provider unavailable" });
    expect(await clone.text()).toBe('{"message":"provider unavailable"}');
    expect(wrapped.bodyUsed).toBe(true);
  });
});
