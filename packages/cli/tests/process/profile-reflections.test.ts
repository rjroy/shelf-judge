import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliEntry = new URL("../../src/index.ts", import.meta.url).pathname;
const timestamp = "2026-09-05T00:00:00.000Z";
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
};

async function readOutput(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function streamEvent(type: string, payload: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function startReflectionServer(
  socketPath: string,
  mode: "success" | "malformed" | "failed" | "pending",
  { cancelResponseDelayMs = 0 }: { cancelResponseDelayMs?: number } = {},
) {
  let cancellationReceived = false;
  let cancellationResponseSent = false;
  let refreshReceived = false;
  const server = Bun.serve({
    unix: socketPath,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/api/help" || path === "/api/profile/reflections")
        return Response.json(reflectionState);
      if (path === "/api/profile/reflections/cancel") {
        cancellationReceived = true;
        await Bun.sleep(cancelResponseDelayMs);
        cancellationResponseSent = true;
        return Response.json({ outcome: "accepted", requestId: "batch" });
      }
      if (path !== "/api/profile/reflections/refresh")
        return new Response("not found", { status: 404 });
      refreshReceived = true;
      const body = (await request.json()) as {
        batchId: string;
        requestId: string;
        cancellationCapability: string;
      };
      const accepted = {
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
      const terminal = {
        version: 1,
        operationId: "operation-1",
        sequence: 1,
        occurredAt: timestamp,
        type: mode === "failed" ? "failed" : "question-completed",
        terminal: true,
        batchId: body.batchId,
        ...(mode === "failed"
          ? { reason: "provider-outage" }
          : { questionId: "repeated-values", outcome: "abstained", batchComplete: true }),
      };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(streamEvent("accepted", accepted)));
          if (mode === "malformed") {
            controller.enqueue(encoder.encode("event: question-completed\ndata: {broken}\n\n"));
            controller.close();
          } else if (mode !== "pending") {
            controller.enqueue(encoder.encode(streamEvent(terminal.type, terminal)));
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  return {
    server,
    cancellationReceived: () => cancellationReceived,
    cancellationResponseSent: () => cancellationResponseSent,
    refreshReceived: () => refreshReceived,
  };
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(5);
  }
  throw new Error(message);
}

function runRefresh(socketPath: string) {
  return Bun.spawn(
    [
      process.execPath,
      cliEntry,
      "profile",
      "reflections",
      "refresh",
      "--question",
      "repeated-values",
      "--acknowledge-disclosure",
      "--json",
    ],
    {
      cwd: new URL("../../../../", import.meta.url).pathname,
      env: { ...Bun.env, SHELF_JUDGE_SOCKET: socketPath },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

test("Reflection JSON command failures use structured stderr and nonzero exit status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shelf-judge-reflection-cli-"));
  const socketPath = join(directory, "daemon.sock");
  const server = Bun.serve({
    unix: socketPath,
    fetch() {
      return Response.json({ name: "shelf" });
    },
  });
  try {
    const child = Bun.spawn(
      [process.execPath, cliEntry, "profile", "reflections", "enable", "unknown", "--json"],
      {
        cwd: new URL("../../../../", import.meta.url).pathname,
        env: { ...Bun.env, SHELF_JUDGE_SOCKET: socketPath },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      readOutput(child.stdout),
      readOutput(child.stderr),
      child.exited,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({
      error: {
        code: "usage",
        message:
          "Question ID must be one of: repeated-values, pattern-exceptions, recurring-trade-offs",
      },
    });
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(["success", "malformed", "failed"] as const)(
  "Reflection refresh process handles %s SSE streams with live NDJSON semantics",
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), "shelf-judge-reflection-stream-"));
    const socketPath = join(directory, "daemon.sock");
    const { server } = startReflectionServer(socketPath, mode);
    try {
      const child = runRefresh(socketPath);
      const [stdout, stderr, exitCode] = await Promise.all([
        readOutput(child.stdout),
        readOutput(child.stderr),
        child.exited,
      ]);
      const lines = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string });
      expect(lines[0]?.type).toBe("accepted");
      if (mode === "success") {
        expect(exitCode).toBe(0);
        expect(lines.at(-1)?.type).toBe("question-completed");
        expect(stderr).not.toContain("Cancellation capability:");
      } else {
        expect(exitCode).toBe(1);
        expect(JSON.parse(stderr)).toMatchObject({
          error: { code: mode === "failed" ? "unavailable" : "invalid-daemon-response" },
        });
        expect(lines.at(-1)?.type).toBe(mode === "failed" ? "failed" : "accepted");
      }
    } finally {
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("Reflection refresh process settles cancellation before reporting SIGINT cancellation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shelf-judge-reflection-signal-"));
  const socketPath = join(directory, "daemon.sock");
  const { server, cancellationReceived, cancellationResponseSent, refreshReceived } =
    startReflectionServer(socketPath, "pending", { cancelResponseDelayMs: 100 });
  try {
    const child = runRefresh(socketPath);
    await waitFor(refreshReceived, "Reflection refresh did not reach the SSE server");
    await Bun.sleep(25);
    child.kill("SIGINT");
    const [stdout, stderr, exitCode] = await Promise.all([
      readOutput(child.stdout),
      readOutput(child.stderr),
      child.exited,
    ]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr)).toMatchObject({ error: { code: "cancelled" } });
    expect(stdout).toContain('"type":"accepted"');
    expect(cancellationReceived()).toBeTrue();
    expect(cancellationResponseSent()).toBeTrue();
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
