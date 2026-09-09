import { describe, expect, test } from "bun:test";
import { createGroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
import { createTestApp } from "../helpers/test-app.js";

const identity = {
  providerId: "local-provider",
  modelId: "local-model",
  extensionIds: [],
};

async function configRequest(
  app: ReturnType<typeof createTestApp>["app"],
  method: "GET" | "PUT",
  body?: unknown,
) {
  return app.request("http://test/api/config", {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

describe("config routes grounded analysis", () => {
  test("GET reports the default persisted provider identity as null", async () => {
    const { app } = createTestApp();

    const response = await configRequest(app, "GET");

    expect(response.status).toBe(200);
    expect((await response.json() as { groundedAnalysis: unknown }).groundedAnalysis).toBeNull();
  });

  test("PUT stores a valid identity while preserving unrelated settings", async () => {
    const { app, storageService } = createTestApp();
    const before = await storageService.loadConfig();
    await storageService.saveConfig({ ...before, bggAuthToken: "token", username: "owner" });

    const response = await configRequest(app, "PUT", { groundedAnalysis: identity });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      bggAuthToken: "***configured***",
      username: "owner",
      groundedAnalysis: identity,
    });
    expect((await storageService.loadConfig()).bggAuthToken).toBe("token");
    expect((await storageService.loadConfig()).groundedAnalysis).toEqual(identity);
  });

  test("PUT null clears the persisted identity", async () => {
    const { app, storageService } = createTestApp();
    const config = await storageService.loadConfig();
    await storageService.saveConfig({ ...config, groundedAnalysis: identity });

    const response = await configRequest(app, "PUT", { groundedAnalysis: null });

    expect(response.status).toBe(200);
    expect((await response.json() as { groundedAnalysis: unknown }).groundedAnalysis).toBeNull();
    expect((await storageService.loadConfig()).groundedAnalysis).toBeNull();
  });

  test("rejects an invalid identity without changing the persisted configuration", async () => {
    const { app, storageService } = createTestApp();
    const config = await storageService.loadConfig();
    await storageService.saveConfig({ ...config, groundedAnalysis: identity });

    const response = await configRequest(app, "PUT", {
      groundedAnalysis: { ...identity, extensionIds: ["duplicate", "duplicate"] },
    });

    expect(response.status).toBe(400);
    expect((await storageService.loadConfig()).groundedAnalysis).toEqual(identity);
  });

  test("persists changes for the next daemon start without changing the active provider", async () => {
    const provider = createGroundedAnalysisProvider({
      configuration: { status: "configured", ...identity },
    });
    const { app, groundedAnalysisProvider, storageService } = createTestApp({
      groundedAnalysisProvider: provider,
    });

    const response = await configRequest(app, "PUT", {
      groundedAnalysis: { ...identity, modelId: "next-model" },
    });

    expect(response.status).toBe(200);
    expect((await storageService.loadConfig()).groundedAnalysis?.modelId).toBe("next-model");
    expect(groundedAnalysisProvider.configurationStatus).toMatchObject({
      status: "configured",
      identity,
    });
  });
});
