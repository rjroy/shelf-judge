import { describe, expect, test } from "bun:test";
import type { GroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";

describe("GET /api/grounded-analysis/configuration", () => {
  test("reports only configured provider identity without initiating analysis", async () => {
    let analyzeCalls = 0;
    const provider: GroundedAnalysisProvider = {
      configurationStatus: {
        status: "configured",
        identity: {
          providerId: "provider-1",
          modelId: "model-1",
          extensionIds: ["extension-1"],
        },
      },
      async analyze() {
        await Promise.resolve();
        analyzeCalls += 1;
        throw new Error("configuration discovery must not initiate pi-agent");
      },
    };
    const context = createTestApp({ groundedAnalysisProvider: provider });
    const response = await jsonRequest(context.app, "GET", "/api/grounded-analysis/configuration");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(provider.configurationStatus);
    expect(analyzeCalls).toBe(0);
  });

  test("reports the safe unavailable reason and is discoverable", async () => {
    const context = createTestApp();
    const response = await jsonRequest(context.app, "GET", "/api/grounded-analysis/configuration");
    expect(await response.json()).toEqual({
      status: "unavailable",
      reason: "model-configuration",
      safeDetail: "test-not-configured",
      correctionDestination: {
        operationId: "shelf.grounded-analysis.configuration.get",
      },
    });
    expect(
      context.operations.find(
        ({ operationId }) => operationId === "shelf.grounded-analysis.configuration.get",
      ),
    ).toMatchObject({
      invocation: { method: "GET", path: "/api/grounded-analysis/configuration" },
      idempotent: true,
    });

    const help = await jsonRequest(context.app, "GET", "/api/help/grounded-analysis");
    expect(help.status).toBe(200);
    expect(JSON.stringify(await help.json())).toContain(
      "shelf.grounded-analysis.configuration.get",
    );
  });
});
