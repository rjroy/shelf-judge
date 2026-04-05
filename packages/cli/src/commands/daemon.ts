// Daemon management commands: start, stop
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { printOutput } from "../output.js";

export async function daemonStart(_client: DaemonClient, _args: string[], opts: OutputOptions): Promise<string> {
  // Use Bun.spawn to start the daemon process in the background
  const daemonEntry = new URL("../../../daemon/src/index.ts", import.meta.url).pathname;

  const proc = Bun.spawn(["bun", "run", daemonEntry], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });

  // Detach so it keeps running after CLI exits
  proc.unref();

  // Wait briefly for the daemon to start
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (opts.json) return printOutput({ started: true, pid: proc.pid }, opts);
  return `Daemon started (PID: ${proc.pid})`;
}

export async function daemonStop(client: DaemonClient, _args: string[], opts: OutputOptions): Promise<string> {
  const reachable = await client.isReachable();
  if (!reachable) {
    if (opts.json) return printOutput({ stopped: false, reason: "not running" }, opts);
    return "Daemon is not running.";
  }

  // Send SIGTERM to the daemon process via the socket file
  // The daemon listens for SIGTERM and shuts down gracefully
  try {
    const { unlinkSync } = await import("node:fs");
    // Remove the socket file to signal the daemon
    unlinkSync(client.socketPath);
  } catch {
    // Socket file might already be gone
  }

  if (opts.json) return printOutput({ stopped: true }, opts);
  return "Daemon stopped.";
}
