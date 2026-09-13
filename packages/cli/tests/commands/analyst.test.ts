import { describe, expect, test } from "bun:test";
import { ANALYST_EVIDENCE_CLASSES } from "@shelf-judge/shared";
import { analystAsk, analystChat, type AnalystIo } from "../../src/commands/analyst.js";
import { createMockClient } from "../helpers/mock-client.js";

const timestamp = "2026-09-08T00:00:00.000Z";
const configuration = {
  contractVersion: 1,
  manifestVersion: 2,
  configuration: {
    status: "configured",
    identity: { providerId: "provider", modelId: "model", extensionIds: [] },
  },
  disclosure: {
    evidenceClasses: ANALYST_EVIDENCE_CLASSES,
    relevantOwnerNotesMayBeTransmitted: true,
    localRetention: "Shelf Judge does not persist Analyst conversations.",
    providerProcessingAndRetentionFollowProviderPolicy: true,
    applicationTokenCap: null,
    applicationMonetaryCap: null,
    cancellation:
      "Cancel the active request with its exact conversation capability and request ID.",
    maximumTranscriptMessages: 32,
    maximumTranscriptCharacters: 48_000,
  },
};

function io(answers: string[] = []): { io: AnalystIo; output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    io: {
      write: (message) => output.push(message),
      writeError: (message) => errors.push(message),
      prompt: () => Promise.resolve(answers.shift() ?? "/exit"),
    },
    output,
    errors,
  };
}

function completion(body: { conversationId: string; requestId: string }) {
  return {
    version: 1,
    operationId: "analyst:operation-1",
    sequence: 1,
    occurredAt: timestamp,
    type: "completed",
    terminal: true,
    conversationId: body.conversationId,
    requestId: body.requestId,
    result: {
      outcome: "abstained",
      reason: "insufficient-evidence",
      blocks: [{ text: "I need authorized evidence.", citationIds: [] }],
      citations: [],
      usage: { state: "unavailable" },
    },
    noteDependencies: [],
    validationAttestation: "attestation",
  };
}

function cancelled(body: { conversationId: string; requestId: string }) {
  return {
    version: 1,
    operationId: "analyst:operation-1",
    sequence: 1,
    occurredAt: timestamp,
    type: "cancelled",
    terminal: true,
    conversationId: body.conversationId,
    requestId: body.requestId,
  };
}

function failed(body: { conversationId: string; requestId: string }) {
  return {
    version: 1,
    operationId: "analyst:operation-1",
    sequence: 1,
    occurredAt: timestamp,
    type: "failed",
    terminal: true,
    conversationId: body.conversationId,
    requestId: body.requestId,
    reason: "provider-outage",
  };
}

describe("Collection Analyst CLI commands", () => {
  test("sends a disclosed one-shot turn through the daemon stream without persistence", async () => {
    let request:
      | {
          disclosure: { providerId: string; modelId: string; acknowledged: boolean };
          messages: Array<{ role: string; content: string }>;
          conversationCapability: string;
        }
      | undefined;
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: configuration },
        },
      },
      sseRoutes: {
        "/api/analyst/turns/stream": {
          events: (body) => {
            const turn = body as {
              conversationId: string;
              requestId: string;
              disclosure: { providerId: string; modelId: string; acknowledged: boolean };
              messages: Array<{ role: string; content: string }>;
              conversationCapability: string;
            };
            request = turn;
            return [{ event: "completed", data: JSON.stringify(completion(turn)) }];
          },
        },
      },
    });
    const output = io();

    await analystAsk(
      client,
      ["Which", "games", "are", "owned?", "--acknowledge-disclosure"],
      output.io,
    );

    expect(request).toMatchObject({
      disclosure: { providerId: "provider", modelId: "model", acknowledged: true },
      messages: [{ role: "owner", content: "Which games are owned?" }],
    });
    expect(request?.conversationCapability).toMatch(/^[0-9a-f]{64}$/);
    expect(output.output).toEqual([]);
  });

  test("presents the daemon evidence classes and owner-note disclosure", async () => {
    const output = io(["no"]);
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: configuration },
        },
      },
    });

    await analystAsk(client, ["--question", "Question"], output.io);

    expect(output.errors).toContain(
      `Evidence classes sent when relevant: ${ANALYST_EVIDENCE_CLASSES.join(", ")}.`,
    );
    expect(output.errors).toContain("Relevant owner notes may be transmitted: yes.");
  });

  test("emits each validated daemon event as NDJSON without human stdout", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: configuration },
        },
      },
      sseRoutes: {
        "/api/analyst/turns/stream": {
          events: (body) => [
            {
              event: "completed",
              data: JSON.stringify(
                completion(body as { conversationId: string; requestId: string }),
              ),
            },
          ],
        },
      },
    });
    const output = io();

    await analystAsk(client, ["--question", "Question", "--acknowledge-disclosure"], output.io, {
      json: true,
    });

    expect(output.output).toHaveLength(1);
    expect(JSON.parse(output.output[0])).toMatchObject({
      type: "completed",
      result: { outcome: "abstained", reason: "insufficient-evidence" },
    });
    expect(output.errors).toEqual([]);
  });

  test("requires explicit acknowledgement for JSON before a turn request", async () => {
    let turnRequested = false;
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: configuration },
        },
      },
      sseRoutes: {
        "/api/analyst/turns/stream": {
          events: () => {
            turnRequested = true;
            return [];
          },
        },
      },
    });

    let error: unknown;
    try {
      await analystAsk(client, ["--question", "Question"], io().io, { json: true });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("use --acknowledge-disclosure for JSON");
    expect(turnRequested).toBeFalse();
  });

  test("emits failed daemon events as NDJSON without a human failure line", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: configuration },
        },
      },
      sseRoutes: {
        "/api/analyst/turns/stream": {
          events: (body) => [
            {
              event: "failed",
              data: JSON.stringify(failed(body as { conversationId: string; requestId: string })),
            },
          ],
        },
      },
    });
    const output = io();

    await analystAsk(client, ["Question", "--acknowledge-disclosure"], output.io, { json: true });

    expect(output.output).toHaveLength(1);
    expect(JSON.parse(output.output[0])).toMatchObject({
      type: "failed",
      reason: "provider-outage",
    });
    expect(output.output[0]).not.toContain("The Analyst is unavailable");
  });

  test("emits chat stream events as NDJSON while keeping disclosure on stderr", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: configuration },
        },
      },
      sseRoutes: {
        "/api/analyst/turns/stream": {
          events: (body) => [
            {
              event: "completed",
              data: JSON.stringify(
                completion(body as { conversationId: string; requestId: string }),
              ),
            },
          ],
        },
      },
    });
    const output = io(["yes", "Question", "/exit"]);

    await analystChat(client, output.io, { json: true });

    expect(output.output).toHaveLength(1);
    expect(JSON.parse(output.output[0])).toMatchObject({ type: "completed" });
    expect(output.errors.join("\n")).toContain("Evidence classes sent when relevant");
  });

  test("keeps interactive turns in process memory and sends prior validated answers", async () => {
    const requests: unknown[] = [];
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: configuration },
        },
      },
      sseRoutes: {
        "/api/analyst/turns/stream": {
          events: (body) => {
            requests.push(body);
            const turn = body as { conversationId: string; requestId: string };
            return [{ event: "completed", data: JSON.stringify(completion(turn)) }];
          },
        },
      },
    });
    const output = io(["yes", "First question", "Second question", "/exit"]);

    await analystChat(client, output.io);

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      turnIndex: 1,
      messages: [
        { role: "owner", content: "First question" },
        { role: "analyst", content: "I need authorized evidence." },
        { role: "owner", content: "Second question" },
      ],
    });
    expect(output.errors.join("\n")).toContain("nothing is saved");
  });

  test("ends rather than truncating a chat that would exceed daemon transcript limits", async () => {
    const limitedConfiguration = {
      ...configuration,
      disclosure: { ...configuration.disclosure, maximumTranscriptMessages: 2 },
    };
    const requests: unknown[] = [];
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: limitedConfiguration },
        },
      },
      sseRoutes: {
        "/api/analyst/turns/stream": {
          events: (body) => {
            requests.push(body);
            return [
              {
                event: "completed",
                data: JSON.stringify(
                  completion(body as { conversationId: string; requestId: string }),
                ),
              },
            ];
          },
        },
      },
    });
    const output = io(["yes", "First question", "Second question"]);

    await analystChat(client, output.io);

    expect(requests).toHaveLength(1);
    expect(output.errors.join("\n")).toContain("would exceed the configured transcript limit");
  });

  test("rejects an oversized one-shot question before sending it", async () => {
    const limitedConfiguration = {
      ...configuration,
      disclosure: { ...configuration.disclosure, maximumTranscriptCharacters: 3 },
    };
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: limitedConfiguration },
        },
      },
    });
    let error: unknown;
    try {
      await analystAsk(client, ["--question", "long", "--acknowledge-disclosure"], io().io);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("exceeds the configured transcript limit");
  });

  test("routes Ctrl-C through exact cancellation identity, aborts locally, and handles cancellation", async () => {
    let cancellation:
      | { conversationId: string; conversationCapability: string; requestId: string }
      | undefined;
    let signal: AbortSignal | undefined;
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: configuration },
        },
        "POST /api/analyst/turns/cancel": {
          response: (body) => {
            cancellation = body as {
              conversationId: string;
              conversationCapability: string;
              requestId: string;
            };
            return { ok: true, status: 200, data: { outcome: "accepted", requestId: "unused" } };
          },
        },
      },
    });
    client.postSSE = async (_path, body, onEvent, options) => {
      const request = body as {
        conversationId: string;
        conversationCapability: string;
        requestId: string;
      };
      signal = options?.signal;
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
      onEvent({ event: "cancelled", data: JSON.stringify(cancelled(request)) });
    };
    const output = io();
    const asking = analystAsk(
      client,
      ["--question", "Question", "--acknowledge-disclosure"],
      output.io,
    );

    await Bun.sleep(0);
    process.emit("SIGINT");
    await asking;

    expect(signal?.aborted).toBeTrue();
    expect(cancellation?.conversationCapability).toMatch(/^[0-9a-f]{64}$/);
    expect(cancellation?.conversationId.length).toBeGreaterThan(0);
    expect(cancellation?.requestId.length).toBeGreaterThan(0);
    expect(output.output).toContain("The Analyst request was cancelled.");
  });

  test("settles a rejected cancellation request and warns that provider work may continue", async () => {
    let signal: AbortSignal | undefined;
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: configuration },
        },
      },
    });
    client.post = () => Promise.reject(new Error("cancel unavailable"));
    client.postSSE = async (_path, body, onEvent, options) => {
      const request = body as { conversationId: string; requestId: string };
      signal = options?.signal;
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
      onEvent({ event: "cancelled", data: JSON.stringify(cancelled(request)) });
    };
    const output = io();
    const asking = analystAsk(
      client,
      ["--question", "Question", "--acknowledge-disclosure"],
      output.io,
    );

    await Bun.sleep(0);
    process.emit("SIGINT");
    await asking;

    expect(signal?.aborted).toBeTrue();
    expect(output.output).toContain(
      "Cancellation could not be confirmed. The local stream was stopped, but provider work may continue.",
    );
    expect(output.output).toContain("The Analyst request was cancelled.");
  });

  test("propagates daemon stream errors instead of reporting a successful answer", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/analyst/configuration": {
          response: { ok: true, status: 200, data: configuration },
        },
      },
    });
    client.postSSE = () => Promise.reject(new Error("stream failed"));

    let error: unknown;
    try {
      await analystAsk(client, ["--question", "Question", "--acknowledge-disclosure"], io().io);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("stream failed");
  });

  test("does not add durable browser or collection storage to the CLI workflow", async () => {
    const source = await Bun.file(new URL("../../src/commands/analyst.ts", import.meta.url)).text();
    expect(source).not.toMatch(
      /localStorage|sessionStorage|indexedDB|document\.cookie|writeFile|storageService/,
    );
  });
});
