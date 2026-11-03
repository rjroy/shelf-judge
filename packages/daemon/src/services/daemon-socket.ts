import { Database } from "bun:sqlite";
import { mkdir, lstat, unlink } from "node:fs/promises";
import { connect } from "node:net";
import { dirname } from "node:path";

/** Held for the process lifetime; SQLite releases the OS lock even after a crash. */
export async function acquireDaemonSocket(socketPath: string): Promise<() => void> {
  await mkdir(dirname(socketPath), { recursive: true });
  const db = new Database(`${socketPath}.startup.sqlite`, { create: true });
  try {
    db.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
  } catch (error) {
    db.close();
    throw new Error(`Cannot acquire daemon startup lock for ${socketPath}`, { cause: error });
  }

  try {
    let before;
    try {
      before = await lstat(socketPath, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (before) {
      if (!before.isSocket()) throw new Error(`Daemon socket path is not a socket: ${socketPath}`);
      await assertSocketRefused(socketPath);
      const after = await lstat(socketPath, { bigint: true });
      if (!after.isSocket() || before.dev !== after.dev || before.ino !== after.ino) {
        throw new Error(`Daemon socket changed during startup: ${socketPath}`);
      }
      await unlink(socketPath);
    }
    return () => db.close();
  } catch (error) {
    db.close();
    throw error;
  }
}

function assertSocketRefused(socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(`Daemon socket is already accepting connections: ${socketPath}`));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Timed out checking daemon socket: ${socketPath}`));
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve();
      else reject(error);
    });
  });
}
