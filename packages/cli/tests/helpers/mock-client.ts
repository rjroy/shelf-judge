// Mock DaemonClient for CLI tests.
// Each test sets up canned responses per path. No real socket connection.

import type { DaemonClient, DaemonResponse, SSEEvent } from "../../src/client.js";

interface MockRoute {
  response: DaemonResponse | ((body: unknown) => DaemonResponse);
}

interface MockSSERoute {
  events: SSEEvent[] | ((body: unknown) => SSEEvent[]);
}

export interface MockClientConfig {
  routes?: Record<string, MockRoute>;
  sseRoutes?: Record<string, MockSSERoute>;
  reachable?: boolean;
}

export function createMockClient(config: MockClientConfig = {}): DaemonClient {
  const routes = config.routes ?? {};
  const sseRoutes = config.sseRoutes ?? {};
  const reachable = config.reachable ?? true;

  function findRoute(method: string, path: string): MockRoute | undefined {
    // Try exact match first, then method+path
    return routes[`${method} ${path}`] ?? routes[path];
  }

  function request<T>(method: string, path: string, body?: unknown): Promise<DaemonResponse<T>> {
    const route = findRoute(method, path);
    if (!route) {
      return Promise.resolve({
        ok: false,
        status: 404,
        data: { error: `No mock for ${method} ${path}` } as T,
      });
    }
    const response = typeof route.response === "function" ? route.response(body) : route.response;
    return Promise.resolve(response as DaemonResponse<T>);
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
    postSSE(path: string, body: unknown, onEvent: (event: SSEEvent) => void): Promise<void> {
      const route = sseRoutes[path];
      if (!route) throw new Error(`No SSE mock for ${path}`);
      const events = typeof route.events === "function" ? route.events(body) : route.events;
      for (const event of events) {
        onEvent(event);
      }
      return Promise.resolve();
    },
    async getProfile() {
      const res = await request<import("@shelf-judge/shared").CollectionProfileResult>(
        "GET",
        "/api/profile",
      );
      if (!res.ok) throw new Error(`Failed to get profile: ${res.status}`);
      return res.data;
    },
    isReachable(): Promise<boolean> {
      return Promise.resolve(reachable);
    },
    socketPath: "/home/user/.shelf-judge/shelf-judge-test.sock",
  };
}
