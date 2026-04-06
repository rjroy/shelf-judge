import { describe, test, expect } from "bun:test";
import { daemonStart, daemonStop, resolveDaemonEntryPath } from "../../src/commands/daemon.js";
import type { DaemonSpawner } from "../../src/commands/daemon.js";
import { createMockClient } from "../helpers/mock-client.js";

describe("daemon stop", () => {
  test("reports not running when daemon unreachable", async () => {
    const client = createMockClient({ reachable: false });
    const result = await daemonStop(client, [], { json: false });
    expect(result).toContain("not running");
  });

  test("--json outputs parseable JSON when not running", async () => {
    const client = createMockClient({ reachable: false });
    const result = await daemonStop(client, [], { json: true });
    const parsed = JSON.parse(result) as { stopped: boolean; reason: string };
    expect(parsed.stopped).toBe(false);
    expect(parsed.reason).toBe("not running");
  });

  test("sends shutdown request when daemon is running", async () => {
    const client = createMockClient({
      reachable: true,
      routes: {
        "POST /api/shutdown": {
          response: { ok: true, status: 200, data: { shutting_down: true } },
        },
      },
    });
    const result = await daemonStop(client, [], { json: false });
    expect(result).toBe("Daemon stopped.");
  });

  test("--json outputs parseable JSON when daemon is running", async () => {
    const client = createMockClient({
      reachable: true,
      routes: {
        "POST /api/shutdown": {
          response: { ok: true, status: 200, data: { shutting_down: true } },
        },
      },
    });
    const result = await daemonStop(client, [], { json: true });
    const parsed = JSON.parse(result) as { stopped: boolean };
    expect(parsed.stopped).toBe(true);
  });
});

describe("daemon start", () => {
  function createTestSpawner(): DaemonSpawner & { calls: Array<{ entryPath: string }> } {
    const calls: Array<{ entryPath: string }> = [];
    return {
      calls,
      spawn(entryPath: string) {
        calls.push({ entryPath });
        return { pid: 12345, unref() {} };
      },
    };
  }

  test("spawns daemon process and reports PID", async () => {
    const client = createMockClient({ reachable: false });
    const spawner = createTestSpawner();
    const result = await daemonStart(client, [], { json: false }, spawner);
    expect(result).toContain("PID: 12345");
    expect(spawner.calls).toHaveLength(1);
  });

  test("--json outputs parseable JSON with pid", async () => {
    const client = createMockClient({ reachable: false });
    const spawner = createTestSpawner();
    const result = await daemonStart(client, [], { json: true }, spawner);
    const parsed = JSON.parse(result) as { started: boolean; pid: number };
    expect(parsed.started).toBe(true);
    expect(parsed.pid).toBe(12345);
    expect(spawner.calls).toHaveLength(1);
  });

  test("passes resolved daemon entry path to spawner", async () => {
    const client = createMockClient({ reachable: false });
    const spawner = createTestSpawner();
    await daemonStart(client, [], { json: false }, spawner);
    expect(spawner.calls[0].entryPath).toContain("daemon/src/index.ts");
  });
});

describe("resolveDaemonEntryPath", () => {
  test("returns a path containing daemon/src/index.ts", () => {
    const path = resolveDaemonEntryPath();
    expect(path).toContain("daemon/src/index.ts");
  });
});
