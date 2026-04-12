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

  function request<T>(method: string, path: string): Promise<DaemonResponse<T>> {
    const route = findRoute(method, path);
    if (!route) {
      return Promise.resolve({
        ok: false,
        status: 404,
        data: { error: `No mock for ${method} ${path}` } as T,
      });
    }
    return Promise.resolve(route.response as DaemonResponse<T>);
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string) => request<T>("POST", path),
    put: <T>(path: string) => request<T>("PUT", path),
    del: <T>(path: string) => request<T>("DELETE", path),
    postSSE(path: string, _body: unknown, onEvent: (event: SSEEvent) => void): Promise<void> {
      const route = sseRoutes[path];
      if (!route) throw new Error(`No SSE mock for ${path}`);
      for (const event of route.events) {
        onEvent(event);
      }
      return Promise.resolve();
    },
    async getProfile() {
      const res = await request<import("@shelf-judge/shared").CollectionProfile>(
        "GET",
        "/api/profile",
      );
      if (!res.ok) throw new Error(`Failed to get profile: ${res.status}`);
      return res.data;
    },
    generateNarration() {
      return request<import("@shelf-judge/shared").CollectionProfile>(
        "POST",
        "/api/profile/narrate",
      );
    },
    isReachable(): Promise<boolean> {
      return Promise.resolve(reachable);
    },
    socketPath: "/home/user/.shelf-judge/shelf-judge-test.sock",
  };
}
