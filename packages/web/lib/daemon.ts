// Server-side daemon client. Talks to the daemon over Unix socket.
// Used by Next.js server components and API route handlers.
//
// Next.js runs on Node.js, not Bun, so we use Node's http module
// for Unix socket support instead of Bun's fetch({ unix }) extension.

import http from "node:http";
import { resolveSocketPath } from "@shelf-judge/shared";

const SOCKET_PATH = resolveSocketPath();

export interface DaemonFetchOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  socketPath?: string;
}

interface NodeDaemonRequest {
  response: http.IncomingMessage;
  destroy(): void;
  release(): void;
}

function makeRequest(path: string, options: DaemonFetchOptions = {}): Promise<NodeDaemonRequest> {
  const { method = "GET", body, signal, socketPath = SOCKET_PATH } = options;
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

  return new Promise<NodeDaemonRequest>((resolve, reject) => {
    let responseReceived = false;
    let request: http.ClientRequest | undefined;
    let activeResponse: http.IncomingMessage | undefined;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      signal?.removeEventListener("abort", abort);
      request?.removeListener("error", onRequestError);
      activeResponse?.removeListener("end", cleanup);
      activeResponse?.removeListener("error", cleanup);
      activeResponse?.removeListener("close", cleanup);
      request = undefined;
      activeResponse = undefined;
    };
    const destroy = () => {
      const currentRequest = request;
      const currentResponse = activeResponse;
      cleanup();
      currentResponse?.destroy();
      currentResponse?.socket?.destroy();
      currentRequest?.destroy();
    };
    const abort = () => {
      const error = new DOMException("The operation was aborted", "AbortError");
      destroy();
      if (!responseReceived) reject(error);
    };
    const onRequestError = (error: Error) => {
      cleanup();
      if (!responseReceived) reject(error);
    };
    request = http.request(
      {
        socketPath,
        path,
        method,
        headers:
          bodyStr !== undefined
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) }
            : undefined,
      },
      (response) => {
        responseReceived = true;
        activeResponse = response;
        response.once("end", cleanup);
        response.once("error", cleanup);
        response.once("close", cleanup);
        resolve({ response, destroy, release: cleanup });
      },
    );
    request.on("error", onRequestError);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (bodyStr !== undefined) {
      request.write(bodyStr);
    }
    request.end();
  });
}

function nodeHeadersToRecord(headers: http.IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      result[key] = Array.isArray(value) ? value.join(", ") : value;
    }
  }
  return result;
}

/**
 * Fetch from the daemon via Unix socket. Makes a single request and decides
 * how to deliver the response based on content-type headers (available before
 * any body is consumed). SSE responses are streamed; everything else is buffered.
 */
export async function daemonRequest(
  path: string,
  options: DaemonFetchOptions = {},
): Promise<{ response: Response; isStream: boolean }> {
  const nodeRequest = await makeRequest(path, options);
  const res = nodeRequest.response;
  const contentType = res.headers["content-type"] ?? "";
  const isStream = contentType.includes("text/event-stream");

  if (isStream) {
    let cancelUpstream = () => nodeRequest.destroy();
    const stream = new ReadableStream({
      start(controller) {
        let finished = false;
        const cleanup = (releaseNodeRequest: boolean) => {
          options.signal?.removeEventListener("abort", abort);
          res.removeListener("data", onData);
          res.removeListener("end", onEnd);
          res.removeListener("error", onError);
          res.removeListener("close", onClose);
          if (releaseNodeRequest) nodeRequest.release();
          cancelUpstream = () => undefined;
        };
        const finish = () => {
          if (finished) return false;
          finished = true;
          cleanup(true);
          return true;
        };
        const abort = () => {
          if (finished) return;
          finished = true;
          cleanup(false);
          const error = new DOMException("The operation was aborted", "AbortError");
          nodeRequest.destroy();
          controller.error(error);
        };
        const onData = (chunk: Buffer) => controller.enqueue(chunk);
        const onEnd = () => {
          if (!finish()) return;
          controller.close();
        };
        const onError = (error: Error) => {
          if (!finish()) return;
          controller.error(error);
        };
        const onClose = () => {
          if (!finish()) return;
          controller.error(new Error("Daemon stream closed before completion"));
        };
        cancelUpstream = () => {
          if (finished) return;
          finished = true;
          cleanup(false);
          nodeRequest.destroy();
        };
        options.signal?.addEventListener("abort", abort, { once: true });
        res.on("data", onData);
        res.once("end", onEnd);
        res.once("error", onError);
        res.once("close", onClose);
      },
      cancel() {
        cancelUpstream();
      },
    });

    return {
      response: new Response(stream, {
        status: res.statusCode ?? 200,
        headers: nodeHeadersToRecord(res.headers),
      }),
      isStream: true,
    };
  }

  const buffered = await new Promise<Response>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let finished = false;
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => {
      finished = true;
      const status = res.statusCode ?? 200;
      const nullBody = status === 204 || status === 205 || status === 304;
      resolve(
        new Response(nullBody ? null : Buffer.concat(chunks).toString(), {
          status,
          headers: nodeHeadersToRecord(res.headers),
        }),
      );
    });
    res.on("error", reject);
    res.on("close", () => {
      if (!finished) reject(new Error("Daemon response closed before completion"));
    });
  });

  return { response: buffered, isStream: false };
}

/**
 * Fetch JSON from the daemon. Throws on non-OK responses.
 */
export async function daemonJson<T>(path: string, options: DaemonFetchOptions = {}): Promise<T> {
  const { response } = await daemonRequest(path, options);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Daemon error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}
