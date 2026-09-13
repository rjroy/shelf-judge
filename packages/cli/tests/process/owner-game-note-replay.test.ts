import { describe, expect, test } from "bun:test";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OwnerGameNoteMutationResultSchema,
  type OwnerGameNote,
  type OwnerGameNoteAcceptedMetadata,
} from "@shelf-judge/shared";

const cliEntry = new URL("../../src/index.ts", import.meta.url).pathname;
const daemonFixture = new URL(
  "../helpers/owner-game-note-replay-daemon-fixture.ts",
  import.meta.url,
).pathname;

interface PersistedState {
  note: OwnerGameNote;
  collectionRevision: number;
  receipt: {
    commandId: string;
    accepted: Omit<OwnerGameNoteAcceptedMetadata, "replayed">;
  } | null;
  mutationCount: number;
  requestCount: number;
  commandIdOnStderrBeforeRequest: boolean;
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
  return output + decoder.decode();
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
      NOTE_REPLAY_SOCKET_PATH: socketPath,
      NOTE_REPLAY_STATE_PATH: statePath,
      NOTE_REPLAY_CLI_STDERR_PATH: cliStderrPath,
      NOTE_REPLAY_DROP_RESPONSE: dropResponse ? "1" : "0",
      NOTE_REPLAY_REQUIRE_COMMAND_ID_BEFORE_REQUEST: requireCommandIdBeforeRequest ? "1" : "0",
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
  throw new Error("Owner-note replay daemon did not create its Unix socket");
}

async function loadState(statePath: string): Promise<PersistedState> {
  return JSON.parse(await readFile(statePath, "utf8")) as PersistedState;
}

describe("CLI owner-note process replay", () => {
  test("replays a durably accepted lost response after restart without another version or revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shelf-judge-cli-note-replay-"));
    const socketPath = join(directory, "daemon.sock");
    const statePath = join(directory, "state.json");
    const firstStderrPath = join(directory, "first-cli.stderr");
    const replayStderrPath = join(directory, "replay-cli.stderr");
    let daemon = startDaemon(socketPath, statePath, firstStderrPath, true, true);

    try {
      await waitForSocket(socketPath);
      const first = await runCli(socketPath, firstStderrPath, [
        "game",
        "note",
        "set",
        "game-1",
        "--expected-version",
        "0",
        "--text",
        "process sentinel\nsecond line",
        "--json",
      ]);
      await daemon.exited;
      const commandId = first.stderr.match(/Command ID: ([0-9a-f-]{36})/i)?.[1];
      expect(first.exitCode).not.toBe(0);
      expect(first.stdout).toBe("");
      expect(commandId).toBeDefined();

      const accepted = await loadState(statePath);
      expect(accepted).toMatchObject({
        note: { state: "present", version: 1, text: "process sentinel\nsecond line" },
        collectionRevision: 1,
        mutationCount: 1,
        requestCount: 1,
        commandIdOnStderrBeforeRequest: true,
        receipt: { commandId },
      });

      await rm(socketPath, { force: true });
      daemon = startDaemon(socketPath, statePath, replayStderrPath, false, false);
      await waitForSocket(socketPath);
      const replay = await runCli(socketPath, replayStderrPath, [
        "game",
        "note",
        "set",
        "game-1",
        "--expected-version",
        "0",
        "--text",
        "process sentinel\nsecond line",
        "--command-id",
        commandId ?? "missing-command-id",
        "--json",
      ]);

      expect(replay.exitCode).toBe(0);
      expect(replay.stderr).toBe("");
      const replayed = OwnerGameNoteMutationResultSchema.parse(JSON.parse(replay.stdout));
      expect(replayed).toMatchObject({
        ok: true,
        accepted: { commandId, version: 1, collectionRevision: 1, replayed: true },
      });
      const finalState = await loadState(statePath);
      expect(finalState).toMatchObject({
        note: { state: "present", version: 1, text: "process sentinel\nsecond line" },
        collectionRevision: 1,
        mutationCount: 1,
        requestCount: 2,
        receipt: { commandId },
      });
    } finally {
      daemon.kill();
      await daemon.exited;
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
