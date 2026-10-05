import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { Hono } from "hono";
import type { CollectionSnapshotResponseDecision } from "../../src/services/collection-snapshot-cache-service.js";
import { createCollectionSnapshotRoutes } from "../../src/routes/collection-snapshot.js";

const originalNodeDebug = process.env.NODE_DEBUG;
const originalPerformanceNow = performance.now.bind(performance);
const logSpy = spyOn(console, "log").mockImplementation(() => {});
const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
const errorSpy = spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  logSpy.mockReset();
  warnSpy.mockReset();
  errorSpy.mockReset();
  performance.now = originalPerformanceNow;
  if (originalNodeDebug === undefined) delete process.env.NODE_DEBUG;
  else process.env.NODE_DEBUG = originalNodeDebug;
});

function routeFor(resolve: () => Promise<CollectionSnapshotResponseDecision>) {
  const app = new Hono();
  app.route("/api", createCollectionSnapshotRoutes({ resolve }).routes);
  return app;
}

describe("collection snapshot request logging", () => {
  test("default successful requests emit one concise completion summary", async () => {
    delete process.env.NODE_DEBUG;
    const app = routeFor(() =>
      Promise.resolve({
        status: 200,
        body: "{}",
        etag: null,
        cacheable: false,
        snapshotStatus: "complete",
        gameCount: 2,
      }),
    );

    const response = await app.request("http://localhost/api/collection/snapshot");

    expect(response.status).toBe(200);
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(logSpy.mock.calls[0]?.[1]).toBe("collection snapshot request completed");
    const fields = JSON.parse(String(logSpy.mock.calls[0]?.[2])) as Record<string, unknown>;
    expect(fields).toMatchObject({ status: "complete", gameCount: 2, httpStatus: 200 });
    expect(fields).toHaveProperty("requestId");
    expect(fields).toHaveProperty("elapsedMs");
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("NODE_DEBUG restores request-boundary detail without adding a second summary", () => {
    const script = `
      const { Hono } = await import("hono");
      const { createCollectionSnapshotRoutes } = await import("./src/routes/collection-snapshot.ts");
      const app = new Hono();
      app.route("/api", createCollectionSnapshotRoutes({
        resolve: () => Promise.resolve({
          status: 200, body: "{}", etag: null, cacheable: false,
          snapshotStatus: "complete", gameCount: 2,
        }),
      }).routes);
      await app.request("http://localhost/api/collection/snapshot");
    `;
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: `${process.cwd()}/packages/daemon`,
      encoding: "utf8",
      env: { ...process.env, NODE_DEBUG: "COLLECTION-SNAPSHOT-ROUTE" },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("COLLECTION-SNAPSHOT-ROUTE");
    expect(result.stderr).toContain("collection snapshot request attempt");
    expect(result.stderr).toContain('"requestId":"collection-1"');
    expect(result.stdout.match(/collection snapshot request completed/g)).toHaveLength(1);
  });

  test("requests at the slow threshold warn once instead of also logging success", async () => {
    delete process.env.NODE_DEBUG;
    let clockRead = 0;
    performance.now = () => (clockRead++ === 0 ? 0 : 3_000);
    const app = routeFor(() =>
      Promise.resolve({
        status: 200,
        body: "{}",
        etag: null,
        cacheable: false,
        snapshotStatus: "complete",
        gameCount: 201,
      }),
    );

    const response = await app.request("http://localhost/api/collection/snapshot");

    expect(response.status).toBe(200);
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls).toHaveLength(1);
    expect(warnSpy.mock.calls[0]?.[1]).toBe("collection snapshot request completed");
    const fields = JSON.parse(String(warnSpy.mock.calls[0]?.[2])) as Record<string, unknown>;
    expect(fields).toMatchObject({ elapsedMs: 3_000, gameCount: 201, outcome: "slow-success" });
  });

  test("failed requests stay visible with correlation and a safe error class", async () => {
    delete process.env.NODE_DEBUG;
    const app = routeFor(() => Promise.reject(new Error("synthetic failure detail")));

    const response = await app.request("http://localhost/api/collection/snapshot");

    expect(response.status).toBe(500);
    expect(errorSpy.mock.calls).toHaveLength(1);
    expect(errorSpy.mock.calls[0]?.[1]).toBe("collection snapshot request failed");
    const fields = JSON.parse(String(errorSpy.mock.calls[0]?.[2])) as Record<string, unknown>;
    expect(fields).toMatchObject({ status: 500, outcome: "failed", errorClass: "Error" });
    expect(fields).toHaveProperty("requestId");
    expect(JSON.stringify(fields)).not.toContain("synthetic failure detail");
  });
});
