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
}

function makeRequest(
  path: string,
  options: DaemonFetchOptions = {},
): Promise<http.IncomingMessage> {
  const { method = "GET", body } = options;
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method,
        headers:
          bodyStr !== undefined
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) }
            : undefined,
      },
      resolve,
    );
    req.on("error", reject);
    if (bodyStr !== undefined) {
      req.write(bodyStr);
    }
    req.end();
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
  const res = await makeRequest(path, options);
  const contentType = res.headers["content-type"] ?? "";
  const isStream = contentType.includes("text/event-stream");

  if (isStream) {
    const stream = new ReadableStream({
      start(controller) {
        res.on("data", (chunk: Buffer) => controller.enqueue(chunk));
        res.on("end", () => controller.close());
        res.on("error", (err) => controller.error(err));
      },
      cancel() {
        res.destroy();
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
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => {
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
