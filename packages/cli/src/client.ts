// Unix socket HTTP client for communicating with the shelf-judge daemon.

import type { CollectionProfileResult } from "@shelf-judge/shared";
import {
  CollectionProfileEntityPolicySchema,
  DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  createCollectionProfileResultSchema,
  resolveSocketPath,
} from "@shelf-judge/shared";

export interface DaemonClientOptions {
  socketPath?: string;
  fetchFn?: typeof fetch;
}

export interface DaemonResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export interface DaemonClient {
  get<T = unknown>(path: string): Promise<DaemonResponse<T>>;
  post<T = unknown>(path: string, body?: unknown): Promise<DaemonResponse<T>>;
  put<T = unknown>(path: string, body?: unknown): Promise<DaemonResponse<T>>;
  patch<T = unknown>(path: string, body?: unknown): Promise<DaemonResponse<T>>;
  del<T = unknown>(path: string, body?: unknown): Promise<DaemonResponse<T>>;
  postSSE(
    path: string,
    body: unknown,
    onEvent: (event: SSEEvent) => void,
    options?: SSEStreamOptions,
  ): Promise<void>;
  getProfile(): Promise<CollectionProfileResult>;
  isReachable(): Promise<boolean>;
  socketPath: string;
}

export interface SSEEvent {
  event: string;
  data: string;
}

export interface SSEStreamOptions {
  signal?: AbortSignal;
  validateEvent?: (event: SSEEvent) => void;
  isTerminal?: (event: SSEEvent) => boolean;
  missingTerminalMessage?: string;
}

export function createDaemonClient(options: DaemonClientOptions = {}): DaemonClient {
  const socketPath = options.socketPath ?? resolveSocketPath();
  const fetchFn = options.fetchFn ?? fetch;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<DaemonResponse<T>> {
    const url = `http://localhost${path}`;
    const init: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetchFn(url, {
      ...init,
      // Bun-specific Unix socket option
      unix: socketPath,
    } as RequestInit);

    let data: T;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      data = (await response.json()) as T;
    } else if (response.status === 204) {
      data = null as T;
    } else {
      data = (await response.text()) as T;
    }

    return { ok: response.ok, status: response.status, data };
  }

  async function postSSE(
    path: string,
    body: unknown,
    onEvent: (event: SSEEvent) => void,
    streamOptions: SSEStreamOptions = {},
  ): Promise<void> {
    const url = `http://localhost${path}`;
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: streamOptions.signal,
      unix: socketPath,
    } as RequestInit);

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Daemon SSE request failed with status ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body for SSE stream");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    let eventName = "";
    let dataLines: string[] = [];
    let eventHasFields = false;
    let terminalSeen = false;

    function dispatchEvent(): void {
      if (dataLines.length === 0) {
        eventName = "";
        eventHasFields = false;
        return;
      }
      if (terminalSeen) throw new Error("SSE stream emitted an event after terminal completion");
      const event = { event: eventName, data: dataLines.join("\n") };
      streamOptions.validateEvent?.(event);
      onEvent(event);
      terminalSeen = streamOptions.isTerminal?.(event) ?? false;
      eventName = "";
      dataLines = [];
      eventHasFields = false;
    }

    function processLine(line: string): void {
      if (line.length === 0) {
        dispatchEvent();
        return;
      }
      if (line.startsWith(":")) return;
      eventHasFields = true;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      let value = separator < 0 ? "" : line.slice(separator + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") eventName = value;
      else if (field === "data") dataLines.push(value);
      // id, retry, and unknown fields do not affect Shelf Judge dispatch.
    }

    function processCompleteLines(eof: boolean): void {
      while (buffer.length > 0) {
        const lineEnd = buffer.search(/[\r\n]/);
        if (lineEnd < 0) break;
        const delimiter = buffer[lineEnd];
        if (delimiter === "\r" && lineEnd === buffer.length - 1 && !eof) break;
        const line = buffer.slice(0, lineEnd);
        const delimiterLength = delimiter === "\r" && buffer[lineEnd + 1] === "\n" ? 2 : 1;
        buffer = buffer.slice(lineEnd + delimiterLength);
        processLine(line);
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        processCompleteLines(false);
      }
      buffer += decoder.decode();
      processCompleteLines(true);
      if (buffer.length > 0 || eventHasFields || dataLines.length > 0) {
        throw new Error("SSE stream ended with an incomplete event frame");
      }
      if (streamOptions.isTerminal && !terminalSeen) {
        throw new Error(
          streamOptions.missingTerminalMessage ??
            "SSE stream ended without a valid terminal completion event",
        );
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  async function isReachable(): Promise<boolean> {
    try {
      await request("GET", "/api/help");
      return true;
    } catch {
      return false;
    }
  }

  async function getProfile(): Promise<CollectionProfileResult> {
    const res = await request<unknown>("GET", "/api/profile");
    if (!res.ok) throw new Error(`Failed to get profile: ${res.status}`);
    if (typeof res.data !== "object" || res.data === null || !("status" in res.data)) {
      throw new Error("Invalid profile response: missing status");
    }
    const entityPolicy =
      res.data.status === "available" && "entityPolicy" in res.data
        ? CollectionProfileEntityPolicySchema.parse(res.data.entityPolicy)
        : DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY;
    const parsed = createCollectionProfileResultSchema(entityPolicy).safeParse(res.data);
    if (!parsed.success) throw new Error(`Invalid profile response: ${parsed.error.message}`);
    return parsed.data;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
    postSSE,
    getProfile,
    isReachable,
    socketPath,
  };
}
