import { describe, expect, test } from "bun:test";
import {
  REFLECTION_ABSTENTION_REASONS,
  REFLECTION_UNAVAILABLE_REASONS,
  ReflectionCancelRequestSchema,
  ReflectionGetResultSchema,
  ReflectionStreamEventSchema,
} from "@shelf-judge/shared";
import { profileReflectionsCommand } from "../../src/commands/profile-reflections.js";
import { createMockClient } from "../helpers/mock-client.js";

const timestamp = "2026-09-05T00:00:00.000Z";

async function rejectionOf(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject");
}

function eventType(line: string): string {
  return ReflectionStreamEventSchema.parse(JSON.parse(line)).type;
}
const reflectionState = {
  contractVersion: 1,
  configuration: {
    status: "configured",
    identity: { providerId: "provider", modelId: "model", extensionIds: ["extension"] },
  },
  settings: {
    version: 1,
    questions: [
      { questionId: "repeated-values", enabled: true },
      { questionId: "pattern-exceptions", enabled: true },
      { questionId: "recurring-trade-offs", enabled: true },
    ],
  },
  questions: [
    {
      questionId: "repeated-values",
      enabled: true,
      cache: { state: "none" },
      attempt: { state: "idle" },
    },
    {
      questionId: "pattern-exceptions",
      enabled: true,
      cache: { state: "none" },
      attempt: { state: "idle" },
    },
    {
      questionId: "recurring-trade-offs",
      enabled: true,
      cache: { state: "none" },
      attempt: { state: "idle" },
    },
  ],
} as const;

function completed(
  questionId: "repeated-values" | "pattern-exceptions" | "recurring-trade-offs",
  outcome: "answered" | "abstained",
  reason = "no-owner-testimony",
) {
  const base = {
    supportingBlocks:
      outcome === "answered"
        ? [{ text: "Supporting evidence.", citationIds: ["note-1", "note-2", "score-1"] }]
        : [],
    citations:
      outcome === "answered"
        ? [
            {
              citationId: "note-1",
              sourceId: "game-1",
              sourceVersion: "1",
              canonicalSummary: "Owner note one",
              destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
              evidenceClass: "owner-game-note",
              testimony: true,
            },
            {
              citationId: "note-2",
              sourceId: "game-2",
              sourceVersion: "1",
              canonicalSummary: "Owner note two",
              destination: { operationId: "shelf.game.get", parameters: { gameId: "game-2" } },
              evidenceClass: "owner-game-note",
              testimony: true,
            },
            {
              citationId: "score-1",
              sourceId: "game-1-score",
              sourceVersion: "1",
              canonicalSummary: "Current score",
              destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
              evidenceClass: "current-scoring",
              testimony: false,
            },
          ]
        : [],
    scope: {
      examinedPresentNoteCount: outcome === "answered" ? 2 : 0,
      totalPresentNoteCount: outcome === "answered" ? 2 : 0,
      examinedGameCount: outcome === "answered" ? 2 : 0,
      relevantEligibleGameCount: outcome === "answered" ? 2 : 0,
      excludedGameCount: 0,
      exhaustiveNotes: true,
      ...(questionId === "pattern-exceptions" ? { patternCandidateIds: [] } : {}),
    },
    evidenceIdentity: {
      manifestVersion: 2,
      questionId,
      questionVersion: 1,
      collectionId: "collection-1",
      collectionSchemaVersion: 6,
      collectionRevision: 1,
      profileContractVersion: 1,
      profileAlgorithmVersion: 1,
      providerId: "provider",
      modelId: "model",
    },
    dependencies:
      outcome === "answered"
        ? [
            { category: "note", gameId: "game-1", noteVersion: 1 },
            { category: "note", gameId: "game-2", noteVersion: 1 },
          ]
        : [],
    generatedAt: timestamp,
    usage: { state: "unavailable" },
  };
  return outcome === "answered"
    ? {
        ...base,
        outcome,
        centralSynthesis: {
          text: "A grounded synthesis.",
          citationIds: ["note-1", "note-2", "score-1"],
        },
      }
    : { ...base, outcome, reason, explanation: "A specific abstention explanation." };
}

function readState(question: unknown) {
  const data = {
    ...reflectionState,
    questions: [question, reflectionState.questions[1], reflectionState.questions[2]],
  };
  return ReflectionGetResultSchema.parse(data);
}

function acceptance(body: { batchId: string; requestId: string; cancellationCapability: string }) {
  return {
    version: 1,
    operationId: "operation-1",
    sequence: 0,
    occurredAt: timestamp,
    type: "accepted",
    terminal: false,
    batchId: body.batchId,
    requestId: body.requestId,
    cancellationCapability: body.cancellationCapability,
    questionIds: ["repeated-values"],
  };
}

function completion(body: { batchId: string }) {
  return {
    version: 1,
    operationId: "operation-1",
    sequence: 1,
    occurredAt: timestamp,
    type: "question-completed",
    terminal: true,
    batchId: body.batchId,
    questionId: "repeated-values",
    outcome: "abstained",
    batchComplete: true,
  };
}

describe("profile reflections command", () => {
  test("renders every daemon-owned question state without model work", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/profile/reflections": {
          response: { ok: true, status: 200, data: reflectionState },
        },
      },
    });
    const output = await profileReflectionsCommand(client, "profile reflections", [], {
      json: false,
    });
    expect(output).toContain("Optional profile reflections");
    expect(output).toContain("repeated-values: enabled");
    expect(output).toContain("Cache: none");
  });

  test.each([
    [
      "current answered",
      { state: "current", result: completed("repeated-values", "answered") },
      "Outcome: answered",
    ],
    [
      "stale answered",
      {
        state: "stale",
        changedCategories: ["metadata"],
        result: completed("repeated-values", "answered"),
      },
      "Changed: metadata",
    ],
    [
      "current abstained",
      { state: "current", result: completed("repeated-values", "abstained") },
      "no-owner-testimony",
    ],
    [
      "stale abstained",
      {
        state: "stale",
        changedCategories: ["collection"],
        result: completed("repeated-values", "abstained"),
      },
      "Changed: collection",
    ],
  ] as const)("renders %s cache state in human and JSON output", async (_name, cache, expected) => {
    const state = readState({
      questionId: "repeated-values",
      enabled: true,
      cache,
      attempt: { state: "idle" },
    });
    const client = createMockClient({
      routes: {
        "GET /api/profile/reflections": { response: { ok: true, status: 200, data: state } },
      },
    });
    const human = await profileReflectionsCommand(client, "profile reflections", [], {
      json: false,
    });
    const json = await profileReflectionsCommand(client, "profile reflections", [], { json: true });
    expect(human).toContain(expected);
    expect(ReflectionGetResultSchema.parse(JSON.parse(json ?? ""))).toEqual(state);
  });

  for (const reason of REFLECTION_ABSTENTION_REASONS) {
    test(`renders abstention reason ${reason}`, async () => {
      const state =
        reason === "no-supported-pattern"
          ? ReflectionGetResultSchema.parse({
              ...reflectionState,
              questions: [
                reflectionState.questions[0],
                {
                  questionId: "pattern-exceptions",
                  enabled: true,
                  cache: {
                    state: "current",
                    result: completed("pattern-exceptions", "abstained", reason),
                  },
                  attempt: { state: "idle" },
                },
                reflectionState.questions[2],
              ],
            })
          : readState({
              questionId: "repeated-values",
              enabled: true,
              cache: {
                state: "current",
                result: completed("repeated-values", "abstained", reason),
              },
              attempt: { state: "idle" },
            });
      const client = createMockClient({
        routes: {
          "GET /api/profile/reflections": { response: { ok: true, status: 200, data: state } },
        },
      });
      expect(
        await profileReflectionsCommand(client, "profile reflections", [], { json: false }),
      ).toContain(reason);
    });
  }

  const attemptCases = [
    [
      "refreshing",
      { state: "refreshing", batchId: "batch-1", startedAt: timestamp },
      "Refresh batch: batch-1",
    ],
    ["cancelled", { state: "cancelled", occurredAt: timestamp }, "Attempt: cancelled"],
    ...REFLECTION_UNAVAILABLE_REASONS.map(
      (reason) =>
        [
          "unavailable",
          { state: "unavailable", reason, safeDetail: "safe", occurredAt: timestamp },
          `Unavailable: ${reason}`,
        ] as const,
    ),
    ...["note-changed", "game-deleted", "owner-deleted"].map(
      (reason) =>
        [
          "purged",
          { state: "purged", reason, occurredAt: timestamp },
          `Purged: ${reason}`,
        ] as const,
    ),
  ] as const;
  for (const [name, attempt, expected] of attemptCases) {
    test(`renders ${name} attempt state and reason`, async () => {
      const state = readState({
        questionId: "repeated-values",
        enabled: true,
        cache: { state: "none" },
        attempt,
      });
      const client = createMockClient({
        routes: {
          "GET /api/profile/reflections": { response: { ok: true, status: 200, data: state } },
        },
      });
      expect(
        await profileReflectionsCommand(client, "profile reflections", [], { json: false }),
      ).toContain(expected);
      const json = await profileReflectionsCommand(client, "profile reflections", [], {
        json: true,
      });
      expect(ReflectionGetResultSchema.parse(JSON.parse(json ?? ""))).toEqual(state);
    });
  }

  test("rejects unknown question IDs before daemon work", async () => {
    const client = createMockClient();
    expect(
      await rejectionOf(
        profileReflectionsCommand(client, "profile reflections enable", ["not-a-question"], {
          json: true,
        }),
      ),
    ).toMatchObject({ details: { error: { code: "usage" } } });
  });

  test("rejects malformed cancellation identities before daemon work", async () => {
    expect(
      await rejectionOf(
        profileReflectionsCommand(
          createMockClient(),
          "profile reflections cancel",
          ["", "--capability", "not-a-capability"],
          { json: true },
        ),
      ),
    ).toMatchObject({ details: { error: { code: "usage" } } });
  });

  test("sends daemon-owned settings, cancellation, and deletion requests", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const client = createMockClient({
      routes: {
        "PUT /api/profile/reflections/settings": {
          response: (body) => {
            requests.push({ method: "PUT", path: "/api/profile/reflections/settings", body });
            return {
              ok: true,
              status: 200,
              data: { outcome: "accepted", requestId: (body as { requestId: string }).requestId },
            };
          },
        },
        "POST /api/profile/reflections/cancel": {
          response: (body) => {
            requests.push({ method: "POST", path: "/api/profile/reflections/cancel", body });
            return {
              ok: true,
              status: 200,
              data: { outcome: "accepted", requestId: (body as { batchId: string }).batchId },
            };
          },
        },
        "DELETE /api/profile/reflections": {
          response: (body) => {
            requests.push({ method: "DELETE", path: "/api/profile/reflections", body });
            return {
              ok: true,
              status: 200,
              data: { outcome: "accepted", requestId: (body as { requestId: string }).requestId },
            };
          },
        },
      },
    });
    await profileReflectionsCommand(client, "profile reflections disable", ["repeated-values"], {
      json: false,
    });
    await profileReflectionsCommand(
      client,
      "profile reflections cancel",
      ["batch-1", "--capability", "a".repeat(64)],
      { json: false },
    );
    await profileReflectionsCommand(client, "profile reflections delete", ["--confirm"], {
      json: false,
    });
    expect(requests).toMatchObject([
      {
        method: "PUT",
        path: "/api/profile/reflections/settings",
        body: { questionId: "repeated-values", enabled: false },
      },
      {
        method: "POST",
        path: "/api/profile/reflections/cancel",
        body: { batchId: "batch-1", capability: "a".repeat(64) },
      },
      { method: "DELETE", path: "/api/profile/reflections", body: { confirmed: true } },
    ]);
  });

  test("requires noninteractive disclosure acknowledgement before refresh", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/profile/reflections": {
          response: { ok: true, status: 200, data: reflectionState },
        },
      },
    });
    expect(
      await rejectionOf(
        profileReflectionsCommand(
          client,
          "profile reflections refresh",
          ["--question", "repeated-values"],
          { json: true },
        ),
      ),
    ).toMatchObject({ details: { error: { code: "disclosure-required" } } });
  });

  test("writes validated JSON stream events as they arrive and returns no buffered output", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/profile/reflections": {
          response: { ok: true, status: 200, data: reflectionState },
        },
      },
      sseRoutes: {
        "/api/profile/reflections/refresh": {
          events: (body) => {
            const request = body as {
              batchId: string;
              requestId: string;
              cancellationCapability: string;
            };
            return [
              { event: "accepted", data: JSON.stringify(acceptance(request)) },
              { event: "question-completed", data: JSON.stringify(completion(request)) },
            ];
          },
        },
      },
    });
    const lines: string[] = [];
    const write = console.log;
    console.log = (value: unknown) => lines.push(String(value));
    try {
      expect(
        await profileReflectionsCommand(
          client,
          "profile reflections refresh",
          ["--question", "repeated-values", "--acknowledge-disclosure"],
          { json: true },
        ),
      ).toBeUndefined();
    } finally {
      console.log = write;
    }
    expect(lines).toHaveLength(2);
    expect(lines.map(eventType)).toEqual(["accepted", "question-completed"]);
  });

  test("routes Ctrl-C through the batch cancellation capability without reporting completion", async () => {
    let cancelPath: string | undefined;
    let cancelBody: unknown;
    const client = createMockClient({
      routes: {
        "GET /api/profile/reflections": {
          response: { ok: true, status: 200, data: reflectionState },
        },
        "POST /api/profile/reflections/cancel": {
          response: (body) => {
            cancelPath = "/api/profile/reflections/cancel";
            cancelBody = body;
            return { ok: true, status: 200, data: { outcome: "accepted", requestId: "unused" } };
          },
        },
      },
    });
    let signal: AbortSignal | undefined;
    client.postSSE = async (_path, body, onEvent, options) => {
      const request = body as {
        batchId: string;
        requestId: string;
        cancellationCapability: string;
      };
      signal = options?.signal;
      onEvent({ event: "accepted", data: JSON.stringify(acceptance(request)) });
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
      onEvent({
        event: "cancelled",
        data: JSON.stringify({
          version: 1,
          operationId: "operation-1",
          sequence: 1,
          occurredAt: timestamp,
          type: "cancelled",
          terminal: true,
          batchId: request.batchId,
        }),
      });
    };
    const refresh = profileReflectionsCommand(
      client,
      "profile reflections refresh",
      ["--question", "repeated-values", "--acknowledge-disclosure"],
      { json: true },
    );
    await Bun.sleep(0);
    process.emit("SIGINT");
    expect(await rejectionOf(refresh)).toMatchObject({ details: { error: { code: "cancelled" } } });
    expect(signal?.aborted).toBeTrue();
    expect(cancelPath).toBe("/api/profile/reflections/cancel");
    const cancellation = ReflectionCancelRequestSchema.parse(cancelBody);
    expect(cancellation.batchId.length).toBeGreaterThan(0);
    expect(cancellation.capability).toMatch(/^[0-9a-f]{64}$/);
  });

  test("reports cancellation when the cancellation request fails", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/profile/reflections": {
          response: { ok: true, status: 200, data: reflectionState },
        },
      },
    });
    client.post = () => Promise.reject(new Error("daemon unavailable"));
    client.postSSE = async (_path, body, onEvent, options) => {
      const request = body as {
        batchId: string;
        requestId: string;
        cancellationCapability: string;
      };
      onEvent({ event: "accepted", data: JSON.stringify(acceptance(request)) });
      await new Promise<void>((_resolve, reject) =>
        options?.signal?.addEventListener("abort", () => reject(new Error("stream aborted")), {
          once: true,
        }),
      );
    };
    const refresh = profileReflectionsCommand(
      client,
      "profile reflections refresh",
      ["--question", "repeated-values", "--acknowledge-disclosure"],
      { json: true },
    );
    await Bun.sleep(0);
    process.emit("SIGINT");
    expect(await rejectionOf(refresh)).toMatchObject({ details: { error: { code: "cancelled" } } });
  });

  test("prints a validated terminal failure but never reports it as completion", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/profile/reflections": {
          response: { ok: true, status: 200, data: reflectionState },
        },
      },
      sseRoutes: {
        "/api/profile/reflections/refresh": {
          events: (body) => {
            const request = body as {
              batchId: string;
              requestId: string;
              cancellationCapability: string;
            };
            return [
              { event: "accepted", data: JSON.stringify(acceptance(request)) },
              {
                event: "failed",
                data: JSON.stringify({
                  version: 1,
                  operationId: "operation-1",
                  sequence: 1,
                  occurredAt: timestamp,
                  type: "failed",
                  terminal: true,
                  batchId: request.batchId,
                  reason: "provider-outage",
                }),
              },
            ];
          },
        },
      },
    });
    const lines: string[] = [];
    const write = console.log;
    console.log = (value: unknown) => lines.push(String(value));
    try {
      expect(
        await rejectionOf(
          profileReflectionsCommand(
            client,
            "profile reflections refresh",
            ["--acknowledge-disclosure"],
            { json: true },
          ),
        ),
      ).toMatchObject({ details: { error: { code: "unavailable" } } });
    } finally {
      console.log = write;
    }
    expect(lines.map(eventType)).toEqual(["accepted", "failed"]);
    expect(lines.join("\n")).not.toContain("question-completed");
  });

  test("rejects a completion stream that has no acceptance event", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/profile/reflections": {
          response: { ok: true, status: 200, data: reflectionState },
        },
      },
      sseRoutes: {
        "/api/profile/reflections/refresh": {
          events: (body) => {
            const request = body as { batchId: string };
            return [{ event: "question-completed", data: JSON.stringify(completion(request)) }];
          },
        },
      },
    });
    expect(
      await rejectionOf(
        profileReflectionsCommand(
          client,
          "profile reflections refresh",
          ["--acknowledge-disclosure"],
          {
            json: true,
          },
        ),
      ),
    ).toMatchObject({ details: { error: { code: "invalid-daemon-response" } } });
  });
});
