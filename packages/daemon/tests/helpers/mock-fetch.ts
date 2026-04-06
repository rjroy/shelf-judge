export interface MockFetchCall {
  url: string;
  headers: Record<string, string>;
}

export interface MockFetch {
  fn: typeof fetch;
  calls: MockFetchCall[];
  responses: Array<{ status: number; body: string }>;
  enqueue(status: number, body: string): void;
}

export function createMockFetch(): MockFetch {
  const calls: MockFetchCall[] = [];
  const responses: Array<{ status: number; body: string }> = [];

  const fn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = (init?.headers as Record<string, string>) ?? {};
    calls.push({ url, headers });

    const next = responses.shift();
    if (!next) {
      return Promise.reject(new Error(`No mock response configured for: ${url}`));
    }

    return Promise.resolve(
      new Response(next.body, {
        status: next.status,
        headers: { "Content-Type": "application/xml" },
      }),
    );
  };

  return {
    fn: fn as unknown as typeof fetch,
    calls,
    responses,
    enqueue(status: number, body: string) {
      responses.push({ status, body });
    },
  };
}
