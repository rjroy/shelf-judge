import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireDaemonSocket } from "../../src/services/daemon-socket.js";

const directories: string[] = [];
async function socketPath() {
  const directory = await mkdtemp(join(tmpdir(), "shelf-judge-socket-test-"));
  directories.push(directory);
  return join(directory, "daemon.sock");
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("daemon socket startup", () => {
  test("recovers a socket left by a crashed process, even if it held the startup lock", async () => {
    const path = await socketPath();
    const modulePath = new URL("../../src/services/daemon-socket.ts", import.meta.url).pathname;
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
      import { acquireDaemonSocket } from ${JSON.stringify(modulePath)};
      import { createServer } from "node:net";
      const release = await acquireDaemonSocket(${JSON.stringify(path)});
      createServer().listen(${JSON.stringify(path)}, () => process.exit(0));
    `,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await child.exited).toBe(0);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => acquireDaemonSocket(path)),
    );
    const winners = attempts.filter((result) => result.status === "fulfilled");
    try {
      expect(winners).toHaveLength(1);
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, resolve);
      });
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    } finally {
      for (const winner of winners) winner.value();
    }
  });

  test("does not remove a live socket from an older daemon", async () => {
    const path = await socketPath();
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    try {
      expect(acquireDaemonSocket(path)).rejects.toThrow("already accepting connections");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test("does not remove a regular file at the socket path", async () => {
    const path = await socketPath();
    await writeFile(path, "keep");
    expect(acquireDaemonSocket(path)).rejects.toThrow("not a socket");
    expect(await readFile(path, "utf8")).toBe("keep");
  });

  test("only one concurrent starter can hold the lock, including before binding", async () => {
    const path = await socketPath();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => acquireDaemonSocket(path)),
    );
    const winners = results.filter((result) => result.status === "fulfilled");
    try {
      expect(winners).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(7);
    } finally {
      for (const winner of winners) winner.value();
    }
    const release = await acquireDaemonSocket(path);
    release();
  });

  test("the startup lock excludes another process and is released on close", async () => {
    const path = await socketPath();
    const modulePath = new URL("../../src/services/daemon-socket.ts", import.meta.url).pathname;
    const runStarter = async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          `
        import { acquireDaemonSocket } from ${JSON.stringify(modulePath)};
        const release = await acquireDaemonSocket(${JSON.stringify(path)});
        release();
      `,
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      return child.exited;
    };
    const release = await acquireDaemonSocket(path);
    try {
      expect(await runStarter()).not.toBe(0);
    } finally {
      release();
    }
    expect(await runStarter()).toBe(0);
  });
});
