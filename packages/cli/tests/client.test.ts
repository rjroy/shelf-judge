import { describe, expect, test } from "bun:test";
import {
  DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  type CollectionProfile,
} from "@shelf-judge/shared";
import { usefulProfileFixture } from "../../shared/tests/fixtures/useful-profile.js";
import { createDaemonClient } from "../src/client.js";

async function rejectionMessage(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error("Expected action to reject");
}

function clientReturning(response: unknown) {
  const fetchRequest = (): ReturnType<typeof fetch> => Promise.resolve(Response.json(response));
  const fetchFn: typeof fetch = Object.assign(fetchRequest, { preconnect: fetch.preconnect });
  return createDaemonClient({ socketPath: "/tmp/shelf-judge-test.sock", fetchFn });
}

const malformedProfileCases: ReadonlyArray<
  readonly [string, (profile: CollectionProfile) => void]
> = [
  [
    "legacy rating ordering",
    (profile) => {
      const orderings = profile.identity.classes.mechanic.orderings;
      Reflect.set(orderings, "rating", orderings.bestFit);
      Reflect.deleteProperty(orderings, "bestFit");
    },
  ],
  [
    "missing adjusted value",
    (profile) => {
      Reflect.deleteProperty(
        profile.identity.classes.mechanic.entities[0],
        "adjustedMeanCurrentFitness",
      );
    },
  ],
  [
    "forged adjusted value",
    (profile) => {
      profile.identity.classes.mechanic.entities[0].adjustedMeanCurrentFitness += 1;
    },
  ],
  [
    "wrong best-fit order",
    (profile) => {
      profile.identity.classes.mechanic.orderings.bestFit.reverse();
    },
  ],
  [
    "unsupported overview entity",
    (profile) => {
      profile.identity.classes.mechanic.overviewEntityIds = [102];
    },
  ],
];

describe("daemon profile client", () => {
  test("returns the complete useful profile response without projection", async () => {
    const response = structuredClone(usefulProfileFixture);
    expect(await clientReturning(response).getProfile()).toEqual(response);
  });

  test("returns the complete unavailable result without projection", async () => {
    const response = {
      status: "unavailable" as const,
      error: { kind: "recomputation" as const, message: "Profile source changed" },
      retryDestination: { operationId: "shelf.profile.get" as const },
    };
    expect(await clientReturning(response).getProfile()).toEqual(response);
  });

  test("validates profiles with the daemon's configured entity policy", async () => {
    const response = structuredClone(usefulProfileFixture);
    response.identity.classes.mechanic.result = "limited";
    response.identity.classes.mechanic.entities[0].support = "limited";
    response.identity.classes.mechanic.entities[1].adjustedMeanCurrentFitness = 16 / 3;
    response.identity.classes.mechanic.overviewEntityIds = [];
    const policy = {
      ...DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
      mechanic: { overviewLimit: 3, minimumSupportedGames: 4 },
    };
    response.entityPolicy = policy;

    expect(await clientReturning(response).getProfile()).toEqual(response);
  });

  test.each([
    ["projected shape", { status: "available", identity: usefulProfileFixture.identity }],
    [
      "altered aggregate",
      {
        ...structuredClone(usefulProfileFixture),
        identity: {
          ...structuredClone(usefulProfileFixture.identity),
          classes: {
            ...structuredClone(usefulProfileFixture.identity.classes),
            mechanic: {
              ...structuredClone(usefulProfileFixture.identity.classes.mechanic),
              associatedGameCount: 99,
            },
          },
        },
      },
    ],
  ])("rejects a malformed %s", async (_label, response) => {
    expect(await rejectionMessage(() => clientReturning(response).getProfile())).toContain(
      "Invalid profile response",
    );
  });

  test.each(malformedProfileCases)("rejects a profile with %s", async (_label, mutate) => {
    const response = structuredClone(usefulProfileFixture);
    mutate(response);

    expect(await rejectionMessage(() => clientReturning(response).getProfile())).toContain(
      "Invalid profile response",
    );
  });
});

describe("daemon SSE client transport ownership", () => {
  test("validates each event before publication", async () => {
    const published: unknown[] = [];
    const client = createDaemonClient({
      socketPath: "/tmp/shelf-judge-test.sock",
      fetchFn: Object.assign(
        () =>
          Promise.resolve(
            new Response('event: public\ndata: {"safe":true,"private":"leak"}\n\n', {
              headers: { "Content-Type": "text/event-stream" },
            }),
          ),
        { preconnect: fetch.preconnect },
      ),
    });

    expect(
      await rejectionMessage(() =>
        client.postSSE("/api/stream", {}, (event) => published.push(event), {
          validateEvent(event) {
            const payload = JSON.parse(event.data) as Record<string, unknown>;
            if (Object.keys(payload).some((field) => field !== "safe")) {
              throw new Error("Invalid public daemon event");
            }
          },
        }),
      ),
    ).toBe("Invalid public daemon event");
    expect(published).toEqual([]);
  });

  test("does not expose daemon error bodies", async () => {
    const client = createDaemonClient({
      socketPath: "/tmp/shelf-judge-test.sock",
      fetchFn: Object.assign(
        () => Promise.resolve(new Response('{"error":"owner secret"}', { status: 500 })),
        { preconnect: fetch.preconnect },
      ),
    });
    expect(await rejectionMessage(() => client.postSSE("/api/stream", {}, () => undefined))).toBe(
      "Daemon SSE request failed with status 500",
    );
  });

  test("passes the caller abort signal through the streaming fetch", async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | null | undefined;
    const fetchRequest: typeof fetch = Object.assign(
      (_input: string | URL | Request, init?: RequestInit) => {
        capturedSignal = init?.signal;
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            init?.signal?.addEventListener(
              "abort",
              () =>
                streamController.error(new DOMException("The operation was aborted", "AbortError")),
              { once: true },
            );
          },
        });
        return Promise.resolve(
          new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
        );
      },
      { preconnect: fetch.preconnect },
    );
    const client = createDaemonClient({
      socketPath: "/tmp/shelf-judge-test.sock",
      fetchFn: fetchRequest,
    });
    const stream = client.postSSE("/api/stream", {}, () => undefined, {
      signal: controller.signal,
    });

    while (capturedSignal === undefined) await Bun.sleep(1);
    expect(capturedSignal).toBe(controller.signal);
    controller.abort();
    expect(await rejectionMessage(() => stream)).toContain("aborted");
  });

  test("cancels the response reader when event handling stops", async () => {
    let cancelled = false;
    const fetchRequest: typeof fetch = Object.assign(
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("event: progress\ndata: {}\n\n"));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
        ),
      { preconnect: fetch.preconnect },
    );
    const client = createDaemonClient({
      socketPath: "/tmp/shelf-judge-test.sock",
      fetchFn: fetchRequest,
    });

    expect(
      await rejectionMessage(() =>
        client.postSSE("/api/stream", {}, () => {
          throw new Error("stop consuming");
        }),
      ),
    ).toBe("stop consuming");
    expect(cancelled).toBe(true);
  });

  test("preserves the event name when data arrives in a later stream chunk", async () => {
    const events: Array<{ event: string; data: string }> = [];
    const fetchRequest: typeof fetch = Object.assign(
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                const encoder = new TextEncoder();
                controller.enqueue(encoder.encode("event: progress\n"));
                controller.enqueue(encoder.encode('data: {"sequence":1}\n\n'));
                controller.close();
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
        ),
      { preconnect: fetch.preconnect },
    );
    const client = createDaemonClient({
      socketPath: "/tmp/shelf-judge-test.sock",
      fetchFn: fetchRequest,
    });

    await client.postSSE("/api/stream", {}, (event) => events.push(event));

    expect(events).toEqual([{ event: "progress", data: '{"sequence":1}' }]);
  });

  test("dispatches multiline CRLF data only at a blank event boundary", async () => {
    const events: Array<{ event: string; data: string }> = [];
    const encoder = new TextEncoder();
    const chunks = [
      ": keepalive\r\nevent: complete\r",
      "\nid: 7\r\ndata: first line\r\ndata: second line\r\nretry: 1000\r\n",
      "\r\n",
    ];
    const fetchRequest: typeof fetch = Object.assign(
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
                controller.close();
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
        ),
      { preconnect: fetch.preconnect },
    );
    const client = createDaemonClient({
      socketPath: "/tmp/shelf-judge-test.sock",
      fetchFn: fetchRequest,
    });

    await client.postSSE("/api/stream", {}, (event) => events.push(event), {
      isTerminal: (event) => event.event === "complete",
    });

    expect(events).toEqual([{ event: "complete", data: "first line\nsecond line" }]);
  });

  test.each([
    ["partial", "event: complete\ndata: unfinished"],
    ["unterminated", "event: complete\ndata: unfinished\n"],
    ["unframed", '{"type":"complete"}'],
  ] as const)("rejects %s event data at EOF", async (_label, payload) => {
    const events: Array<{ event: string; data: string }> = [];
    const fetchRequest: typeof fetch = Object.assign(
      () =>
        Promise.resolve(
          new Response(payload, { headers: { "Content-Type": "text/event-stream" } }),
        ),
      { preconnect: fetch.preconnect },
    );
    const client = createDaemonClient({
      socketPath: "/tmp/shelf-judge-test.sock",
      fetchFn: fetchRequest,
    });

    expect(
      await rejectionMessage(() =>
        client.postSSE("/api/stream", {}, (event) => events.push(event), {
          isTerminal: (event) => event.event === "complete",
        }),
      ),
    ).toContain("incomplete event frame");
    expect(events).toEqual([]);
  });

  test("rejects a framed stream that ends without caller-defined terminal completion", async () => {
    const fetchRequest: typeof fetch = Object.assign(
      () =>
        Promise.resolve(
          new Response("event: progress\ndata: {}\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          }),
        ),
      { preconnect: fetch.preconnect },
    );
    const client = createDaemonClient({
      socketPath: "/tmp/shelf-judge-test.sock",
      fetchFn: fetchRequest,
    });

    expect(
      await rejectionMessage(() =>
        client.postSSE("/api/stream", {}, () => undefined, {
          isTerminal: (event) => event.event === "complete",
        }),
      ),
    ).toContain("without a valid terminal completion event");
  });
});
