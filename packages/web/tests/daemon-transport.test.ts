import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import http from "node:http";
import { daemonRequest } from "@/lib/daemon";
import { proxyDaemonRequest } from "@/lib/daemon-proxy";
import { proxyToDaemon } from "@/app/api/daemon/[...path]/route";
import { NextRequest } from "next/server";

const sockets = new Set<string>();

afterEach(async () => {
  await Promise.all([...sockets].map((socketPath) => rm(socketPath, { force: true })));
  sockets.clear();
});

function listen(server: http.Server): Promise<string> {
  const socketPath = `/tmp/shelf-judge-web-test-${crypto.randomUUID()}.sock`;
  sockets.add(socketPath);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(socketPath));
  });
}

function close(server: http.Server): void {
  server.closeAllConnections();
  server.close();
}

function within<Value>(promise: Promise<Value>, stage: string): Promise<Value> {
  return Promise.race([
    promise,
    Bun.sleep(1_000).then(() => {
      throw new Error(`Timed out waiting for ${stage}`);
    }),
  ]);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

function trackAbortListeners(signal: AbortSignal): () => number {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  Object.defineProperties(signal, {
    addEventListener: {
      value: (...args: Parameters<AbortSignal["addEventListener"]>) => {
        if (args[0] === "abort") listeners.add(args[1]);
        return add(...args);
      },
    },
    removeEventListener: {
      value: (...args: Parameters<AbortSignal["removeEventListener"]>) => {
        if (args[0] === "abort") listeners.delete(args[1]);
        return remove(...args);
      },
    },
  });
  return () => listeners.size;
}

describe("web daemon transport ownership", () => {
  test("production proxy forwards validated stream bytes and the exact abort signal", async () => {
    const publicBytes =
      'event: feature-complete\ndata: {"type":"feature-complete","terminal":true}\n\n';
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    const response = await proxyDaemonRequest(
      {
        path: "/api/feature/stream",
        method: "POST",
        body: { operationId: "feature-operation" },
        signal: controller.signal,
      },
      (_path, options) => {
        capturedSignal = options?.signal;
        return Promise.resolve({
          response: new Response(publicBytes, {
            headers: { "Content-Type": "text/event-stream" },
          }),
          isStream: true,
        });
      },
    );

    expect(capturedSignal).toBe(controller.signal);
    expect(await response.text()).toBe(publicBytes);
  });

  test("forwards daemon-validated public event bytes without projection", async () => {
    const publicBytes =
      'event: complete\nid: 0\ndata: {"version":1,"operationId":"public","sequence":0,"occurredAt":"2026-08-30T00:00:00.000Z","type":"complete","terminal":true,"answer":"safe"}\n\n';
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(publicBytes);
    });
    const socketPath = await listen(server);

    const { response, isStream } = await daemonRequest("/api/stream", { socketPath });

    expect(isStream).toBe(true);
    expect(await response.text()).toBe(publicBytes);
    close(server);
  });

  test("aborts an in-flight Unix socket request with the caller signal", async () => {
    let acceptRequest: (() => void) | undefined;
    let observeDisconnect: (() => void) | undefined;
    const accepted = new Promise<void>((resolve) => (acceptRequest = resolve));
    const disconnected = new Promise<void>((resolve) => (observeDisconnect = resolve));
    const server = http.createServer((request) => {
      acceptRequest?.();
      request.once("close", () => observeDisconnect?.());
    });
    const socketPath = await listen(server);
    const controller = new AbortController();
    const pending = daemonRequest("/api/stream", { socketPath, signal: controller.signal });

    await within(accepted, "daemon request acceptance");
    controller.abort();
    expect(await rejection(within(pending, "aborted client request"))).toMatchObject({
      name: "AbortError",
    });
    await within(disconnected, "daemon request disconnect");
    close(server);
  });

  test("destroys an established daemon stream when the browser signal aborts", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("event: progress\ndata: {}\n\n");
    });
    const socketPath = await listen(server);
    const controller = new AbortController();
    const { response, isStream } = await within(
      daemonRequest("/api/stream", { socketPath, signal: controller.signal }),
      "stream response",
    );
    if (!response.body) throw new Error("Expected streamed daemon response body");
    const reader = response.body.getReader();

    expect(isStream).toBe(true);
    expect(await reader.read()).toMatchObject({ done: false });
    controller.abort();
    expect(await rejection(within(reader.read(), "aborted stream reader"))).toMatchObject({
      name: "AbortError",
    });
    close(server);
  });

  test("removes request abort listeners when the forwarded response is cancelled", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("event: progress\ndata: {}\n\n");
    });
    const socketPath = await listen(server);
    const controller = new AbortController();
    const listenerCount = trackAbortListeners(controller.signal);
    const { response } = await daemonRequest("/api/stream", {
      socketPath,
      signal: controller.signal,
    });
    if (!response.body) throw new Error("Expected streamed daemon response body");
    const reader = response.body.getReader();
    await reader.read();
    expect(listenerCount()).toBeGreaterThan(0);

    await reader.cancel();

    expect(listenerCount()).toBe(0);
    close(server);
  });

  test("passes the browser request signal into the daemon proxy request", async () => {
    const controller = new AbortController();
    const request = new NextRequest("http://localhost/api/daemon/grounded/stream", {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    let capturedSignal: AbortSignal | undefined;

    await proxyToDaemon(
      request,
      Promise.resolve({ path: ["grounded", "stream"] }),
      (_path, options) => {
        capturedSignal = options?.signal;
        return Promise.resolve({ response: Response.json({ ok: true }), isStream: false });
      },
    );

    expect(capturedSignal).toBe(request.signal);
  });
});
