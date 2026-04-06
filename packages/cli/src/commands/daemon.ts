// Daemon management commands: start, stop
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { printOutput } from "../output.js";

export interface DaemonSpawner {
  spawn(entryPath: string): { pid: number; unref(): void };
}

const defaultSpawner: DaemonSpawner = {
  spawn(entryPath: string) {
    const proc = Bun.spawn(["bun", "run", entryPath], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    return { pid: proc.pid, unref: () => proc.unref() };
  },
};

export function resolveDaemonEntryPath(): string {
  return new URL("../../../daemon/src/index.ts", import.meta.url).pathname;
}

export async function daemonStart(
  _client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
  spawner: DaemonSpawner = defaultSpawner,
): Promise<string> {
  const daemonEntry = resolveDaemonEntryPath();
  const handle = spawner.spawn(daemonEntry);
  handle.unref();

  // Wait briefly for the daemon to start
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (opts.json) return printOutput({ started: true, pid: handle.pid }, opts);
  return `Daemon started (PID: ${handle.pid})`;
}

export async function daemonStop(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const reachable = await client.isReachable();
  if (!reachable) {
    if (opts.json) return printOutput({ stopped: false, reason: "not running" }, opts);
    return "Daemon is not running.";
  }

  await client.post("/api/shutdown");

  if (opts.json) return printOutput({ stopped: true }, opts);
  return "Daemon stopped.";
}
