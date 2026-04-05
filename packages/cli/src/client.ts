// Unix socket HTTP client for communicating with the shelf-judge daemon.

const DEFAULT_SOCKET_PATH = "/tmp/shelf-judge.sock";

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
  del<T = unknown>(path: string): Promise<DaemonResponse<T>>;
  postSSE(path: string, body: unknown, onEvent: (event: SSEEvent) => void): Promise<void>;
  isReachable(): Promise<boolean>;
  socketPath: string;
}

export interface SSEEvent {
  event: string;
  data: string;
}

export function createDaemonClient(options: DaemonClientOptions = {}): DaemonClient {
  const socketPath = options.socketPath ?? process.env.SHELF_JUDGE_SOCKET ?? DEFAULT_SOCKET_PATH;
  const fetchFn = options.fetchFn ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<DaemonResponse<T>> {
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

  async function postSSE(path: string, body: unknown, onEvent: (event: SSEEvent) => void): Promise<void> {
    const url = `http://localhost${path}`;
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      unix: socketPath,
    } as RequestInit);

    if (!response.ok) {
      const text = await response.text();
      let errorMsg: string;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        errorMsg = parsed.error ?? text;
      } catch {
        errorMsg = text;
      }
      throw new Error(errorMsg);
    }

    if (!response.body) {
      throw new Error("No response body for SSE stream");
    }

    // Simplified SSE parser: handles single event/data pairs per the daemon's
    // current output format. Does not support multi-data-line events, id:, or
    // retry: fields. Sufficient for the daemon's import endpoint.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last incomplete line in buffer
      buffer = lines.pop() ?? "";

      let currentEvent = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          onEvent({ event: currentEvent, data: line.slice(6) });
          currentEvent = "";
        }
      }
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

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    del: <T>(path: string) => request<T>("DELETE", path),
    postSSE,
    isReachable,
    socketPath,
  };
}
