import { describe, expect, test } from "bun:test";
import { createTestApp, jsonRequest } from "./helpers/test-app.js";

describe("semantic production app wiring", () => {
  test("the app keeps semantic reads available while legacy inference remains quarantined", async () => {
    const { app } = createTestApp();

    const status = await jsonRequest(app, "GET", "/api/redundancy/settings");
    const statusBody = await status.text();
    expect(status.status).toBe(200);
    expect(statusBody).not.toContain("TYPESAFE_API_KEY");
    expect(statusBody).not.toContain("Bearer");

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
  });
});
