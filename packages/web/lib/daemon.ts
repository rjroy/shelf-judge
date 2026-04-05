// Server-side daemon client. Talks to the daemon over Unix socket.
// Used by Next.js server components and API route handlers.
//
// Next.js runs on Node.js, not Bun, so we use Node's http module
// for Unix socket support instead of Bun's fetch({ unix }) extension.

import http from "node:http";

const SOCKET_PATH = process.env.SHELF_JUDGE_SOCKET ?? "/tmp/shelf-judge.sock";

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
        headers: bodyStr !== undefined
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
 * Fetch from the daemon via Unix socket using Node's http module.
 * Buffers the response body into a Web API Response.
 */
export async function daemonFetch(
  path: string,
  options: DaemonFetchOptions = {},
): Promise<Response> {
  const res = await makeRequest(path, options);

  return new Promise<Response>((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => {
      resolve(
        new Response(Buffer.concat(chunks).toString(), {
          status: res.statusCode ?? 200,
          headers: nodeHeadersToRecord(res.headers),
        }),
      );
    });
    res.on("error", reject);
  });
}

/**
 * Fetch from the daemon and return a streaming Web API Response.
 * Used for SSE proxying where we can't buffer the full response.
 */
export async function daemonFetchStream(
  path: string,
  options: DaemonFetchOptions = {},
): Promise<Response> {
  const res = await makeRequest(path, options);

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

  return new Response(stream, {
    status: res.statusCode ?? 200,
    headers: nodeHeadersToRecord(res.headers),
  });
}

/**
 * Fetch JSON from the daemon. Throws on non-OK responses.
 */
export async function daemonJson<T>(
  path: string,
  options: DaemonFetchOptions = {},
): Promise<T> {
  const response = await daemonFetch(path, options);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Daemon error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}
