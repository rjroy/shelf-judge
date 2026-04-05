// Mock DaemonClient for CLI tests.
// Each test sets up canned responses per path. No real socket connection.

import type { DaemonClient, DaemonResponse, SSEEvent } from "../../src/client.js";

interface MockRoute {
  response: DaemonResponse;
}

interface MockSSERoute {
  events: SSEEvent[];
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

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<DaemonResponse<T>> {
    const route = findRoute(method, path);
    if (!route) {
      return { ok: false, status: 404, data: { error: `No mock for ${method} ${path}` } as T };
    }
    return route.response as DaemonResponse<T>;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    del: <T>(path: string) => request<T>("DELETE", path),
    async postSSE(path: string, body: unknown, onEvent: (event: SSEEvent) => void): Promise<void> {
      const route = sseRoutes[path];
      if (!route) throw new Error(`No SSE mock for ${path}`);
      for (const event of route.events) {
        onEvent(event);
      }
    },
    async isReachable(): Promise<boolean> {
      return reachable;
    },
    socketPath: "/tmp/shelf-judge-test.sock",
  };
}
