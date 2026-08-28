import { describe, expect, test } from "bun:test";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IntentionMutationResultSchema,
  type IntentionCommandReceipt,
  type PlayIntention,
} from "@shelf-judge/shared";

const cliEntry = new URL("../../src/index.ts", import.meta.url).pathname;
const daemonFixture = new URL("../helpers/replay-daemon-fixture.ts", import.meta.url).pathname;

interface PersistedState {
  intentions: PlayIntention[];
  resolutions: PlayIntention[];
  receipts: IntentionCommandReceipt[];
  mutationCount: number;
  requestCount: number;
  commandIdOnStderrBeforeRequest: boolean;
  acceptedAfterCommandIdObserved: boolean;
}

async function readOutput(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

async function runCli(
  socketPath: string,
  stderrPath: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stderrFile = await open(stderrPath, "w");
  try {
    const child = Bun.spawn([process.execPath, cliEntry, ...args], {
      cwd: new URL("../../../../", import.meta.url).pathname,
      env: { ...Bun.env, SHELF_JUDGE_SOCKET: socketPath },
      stdin: "ignore",
      stdout: "pipe",
      stderr: stderrFile.fd,
    });
    const stdout = readOutput(child.stdout);
    const exitCode = await child.exited;
    return { exitCode, stdout: await stdout, stderr: await readFile(stderrPath, "utf8") };
  } finally {
    await stderrFile.close();
  }
}

function startDaemon(
  socketPath: string,
  statePath: string,
  cliStderrPath: string,
  dropResponse: boolean,
  requireCommandIdBeforeRequest: boolean,
) {
  return Bun.spawn([process.execPath, daemonFixture], {
    env: {
      ...Bun.env,
      REPLAY_SOCKET_PATH: socketPath,
      REPLAY_STATE_PATH: statePath,
      REPLAY_CLI_STDERR_PATH: cliStderrPath,
      REPLAY_DROP_RESPONSE: dropResponse ? "1" : "0",
      REPLAY_REQUIRE_COMMAND_ID_BEFORE_REQUEST: requireCommandIdBeforeRequest ? "1" : "0",
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
}

async function waitForSocket(socketPath: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    try {
      await stat(socketPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await Bun.sleep(1);
    }
  }
  throw new Error("Fake daemon did not create its Unix socket");
}

async function loadState(statePath: string): Promise<PersistedState> {
  return JSON.parse(await readFile(statePath, "utf8")) as PersistedState;
}

describe("CLI process command replay", () => {
  test("prints the generated ID before acceptance and replays a lost response without duplicate mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shelf-judge-cli-replay-"));
    const socketPath = join(directory, "daemon.sock");
    const statePath = join(directory, "state.json");
    const firstStderrPath = join(directory, "first-cli.stderr");
    const replayStderrPath = join(directory, "replay-cli.stderr");
    let daemon = startDaemon(socketPath, statePath, firstStderrPath, true, true);

    try {
      await waitForSocket(socketPath);
      const first = await runCli(socketPath, firstStderrPath, [
        "game",
        "intention",
        "set",
        "game-1",
        "first-play",
        "--json",
      ]);
      await daemon.exited;
      const commandId = first.stderr.match(/Command ID: ([0-9a-f-]{36})/i)?.[1];
      expect(first.exitCode).not.toBe(0);
      expect(first.stdout).toBe("");
      expect(commandId).toBeDefined();
      expect(first.stderr).toContain(`Command ID: ${commandId}`);

      const accepted = await loadState(statePath);
      expect(accepted).toMatchObject({
        mutationCount: 1,
        requestCount: 1,
        commandIdOnStderrBeforeRequest: true,
        acceptedAfterCommandIdObserved: true,
        intentions: [{ intentionId: "process-intention-1", resolution: null }],
        resolutions: [],
        receipts: [{ commandId }],
      });

      await rm(socketPath, { force: true });
      daemon = startDaemon(socketPath, statePath, replayStderrPath, false, false);
      await waitForSocket(socketPath);
      const replay = await runCli(socketPath, replayStderrPath, [
        "game",
        "intention",
        "set",
        "game-1",
        "first-play",
        "--command-id",
        commandId ?? "missing-command-id",
        "--json",
      ]);

      expect(replay.exitCode).toBe(0);
      expect(replay.stderr).toBe("");
      const replayed = IntentionMutationResultSchema.parse(JSON.parse(replay.stdout));
      expect(replayed).toEqual(accepted.receipts[0]?.result);
      const finalState = await loadState(statePath);
      expect(finalState).toMatchObject({
        mutationCount: 1,
        requestCount: 2,
        intentions: [{ intentionId: "process-intention-1", resolution: null }],
        resolutions: [],
        receipts: [{ commandId }],
      });
      expect(finalState.intentions).toHaveLength(1);
      expect(finalState.receipts).toHaveLength(1);
    } finally {
      daemon.kill();
      await daemon.exited;
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
