import { describe, expect, test } from "bun:test";
import type { GroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
import { createTestApp } from "../helpers/test-app.js";

const ordinaryRequests = [
  ["profile", "/api/profile", undefined],
  ["collection", "/api/collection/entertainment-benchmark", undefined],
  ["games", "/api/games", undefined],
  ["config", "/api/config", undefined],
  ["help", "/api/help", undefined],
  ["axes", "/api/axes", undefined],
  ["scores", "/api/scores", undefined],
  ["wishlist", "/api/wishlist", undefined],
  ["import", "/api/import/bgg", { username: "ordinary-route-fixture" }],
] as const;

describe("ordinary route grounded-analysis isolation", () => {
  test.each(["configured", "unavailable"] as const)(
    "makes zero provider calls with a %s foundation",
    async (status) => {
      let providerCalls = 0;
      const provider: GroundedAnalysisProvider = {
        configurationStatus:
          status === "configured"
            ? {
                status: "configured",
                identity: { providerId: "test", modelId: "test", extensionIds: [] },
              }
            : {
                status: "unavailable",
                reason: "model-configuration",
                correctionDestination: {
                  operationId: "shelf.grounded-analysis.configuration.get",
                },
              },
        analyze() {
          providerCalls += 1;
          return Promise.reject(new Error("Ordinary routes must not invoke grounded analysis"));
        },
      };
      const { app, fileOps } = createTestApp({ groundedAnalysisProvider: provider });
      expect(fileOps.calls).toEqual([]);

      for (const [, path, body] of ordinaryRequests) {
        await app.request(
          new Request(`http://localhost${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: body === undefined ? undefined : { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );
      }

      expect(providerCalls).toBe(0);
      expect(
        fileOps.calls.filter(({ args }) =>
          args.some((argument) => /grounded|reflection|analyst/i.test(argument)),
        ),
      ).toEqual([]);
    },
  );
});
