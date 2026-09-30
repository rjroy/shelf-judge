import { describe, expect, test } from "bun:test";
import type { SemanticRefreshRuntime } from "../src/services/semantic-refresh-runtime.js";
import { createTestApp, jsonRequest } from "./helpers/test-app.js";

describe("semantic production app wiring", () => {
  test("the app uses the injected runtime for status and keeps ordinary reads off the provider path", async () => {
    let statusCalls = 0;
    let captureCalls = 0;
    const runtime = {
      capture: () => {
        captureCalls += 1;
        return Promise.resolve({ outcome: "not-authorized" as const });
      },
      deliverPage: () => Promise.resolve({ outcome: "not-authorized" as const }),
      start: () => Promise.resolve({ outcome: "not-authorized" as const }),
      status: () => {
        statusCalls += 1;
        return Promise.resolve({ status: "not-ready" as const });
      },
      cancel: () => Promise.resolve({ outcome: "invalid-state" as const }),
      recoverOrphanedRun: async () => {},
      isStartReceiptCurrentProcess: () => false,
    } satisfies SemanticRefreshRuntime;
    const { app } = createTestApp({ semanticRefreshRuntime: runtime });

    const status = await jsonRequest(app, "GET", "/api/redundancy/settings");
    const statusBody = await status.text();
    expect(status.status).toBe(200);
    expect(statusBody).not.toContain("TYPESAFE_API_KEY");
    expect(statusBody).not.toContain("Bearer");
    expect(statusCalls).toBe(1);

    const ordinarySettings = await jsonRequest(app, "PATCH", "/api/redundancy/settings", {
      enabled: false,
    });
    expect(ordinarySettings.status).toBe(200);
    expect(captureCalls).toBe(0);
  });
});
