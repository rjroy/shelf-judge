import { daemonRequest, type DaemonFetchOptions } from "./daemon";

export interface DaemonProxyRequest {
  readonly path: string;
  readonly method: string;
  readonly body?: unknown;
  readonly signal: AbortSignal;
}

export type DaemonRequest = (
  path: string,
  options?: DaemonFetchOptions,
) => Promise<{ response: Response; isStream: boolean }>;

export async function proxyDaemonRequest(
  request: DaemonProxyRequest,
  requestDaemon: DaemonRequest = daemonRequest,
): Promise<Response> {
  try {
    const { response, isStream } = await requestDaemon(request.path, {
      method: request.method,
      body: request.body,
      signal: request.signal,
    });

    if (isStream) {
      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const headers = new Headers();
    response.headers.forEach((value, key) => {
      if (!["connection", "keep-alive", "transfer-encoding"].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });
    if (response.status === 204 || response.status === 205 || response.status === 304) {
      return new Response(null, { status: response.status, headers });
    }
    if (!headers.has("content-type")) headers.set("Content-Type", "application/json");
    return new Response(await response.text(), { status: response.status, headers });
  } catch {
    return Response.json({ error: "Daemon unavailable" }, { status: 502 });
  }
}
