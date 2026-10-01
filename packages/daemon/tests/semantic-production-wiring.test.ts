import { describe, expect, test } from "bun:test";
import type { SemanticRefreshRuntime } from "../src/services/semantic-refresh-runtime.js";
import { createTestApp, jsonRequest } from "./helpers/test-app.js";

describe("semantic production app wiring", () => {
  test("the app quarantines injected legacy inference runtime on reads, settings, and start routes", async () => {
    let runtimeCalls = 0;
    const runtime = {
      capture: () => {
        runtimeCalls += 1;
        return Promise.resolve({ outcome: "not-authorized" as const });
      },
      deliverPage: () => {
        runtimeCalls += 1;
        return Promise.resolve({ outcome: "not-authorized" as const });
      },
      start: () => {
        runtimeCalls += 1;
        return Promise.resolve({ outcome: "not-authorized" as const });
      },
      status: () => {
        runtimeCalls += 1;
        return Promise.resolve({ status: "not-ready" as const });
      },
      cancel: () => {
        runtimeCalls += 1;
        return Promise.resolve({ outcome: "invalid-state" as const });
      },
      recoverOrphanedRun: async () => {},
      isStartReceiptCurrentProcess: () => false,
    } satisfies SemanticRefreshRuntime;
    const { app } = createTestApp({ semanticRefreshRuntime: runtime });

    const status = await jsonRequest(app, "GET", "/api/redundancy/settings");
    const statusBody = await status.text();
    expect(status.status).toBe(200);
    expect(statusBody).not.toContain("TYPESAFE_API_KEY");
    expect(statusBody).not.toContain("Bearer");
    expect(runtimeCalls).toBe(0);

    const disclosure = await jsonRequest(app, "POST", "/api/redundancy/semantic/disclosure", {
      signalScope: "description-only",
    });
    const start = await jsonRequest(app, "POST", "/api/redundancy/semantic/acknowledge-and-start", {
      manifestId: "legacy",
    });
    expect(disclosure.status).toBe(503);
    expect(start.status).toBe(503);

    const ordinarySettings = await jsonRequest(app, "PATCH", "/api/redundancy/settings", {
      enabled: false,
    });
    expect(ordinarySettings.status).toBe(200);
    expect(runtimeCalls).toBe(0);
  });
});
