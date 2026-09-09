import { describe, expect, test } from "bun:test";
import {
  resolveGroundedProviderConfiguration,
  toGroundedProviderConfigurationStatus,
} from "../src/services/grounded-analysis/provider-configuration.js";
import { createStorageService } from "../src/services/storage-service.js";
import { loadStartupGroundedAnalysis } from "../src/services/grounded-analysis/startup-provider.js";
import { createMockFileOps } from "./helpers/mock-file-ops.js";

describe("grounded-analysis startup configuration", () => {
  test("requires a persisted provider identity", () => {
    const configuration = resolveGroundedProviderConfiguration(null);

    expect(configuration).toEqual({
      status: "unavailable",
      reason: "model-configuration",
      safeDetail: "missing:grounded-analysis-configuration",
      correctionDestination: {
        operationId: "shelf.grounded-analysis.configuration.get",
      },
    });
  });

  test("does not use process environment provider values", () => {
    const previous = process.env.SHELF_JUDGE_GROUNDED_PROVIDER_ID;
    process.env.SHELF_JUDGE_GROUNDED_PROVIDER_ID = "environment-provider";

    try {
      expect(resolveGroundedProviderConfiguration(null)).toMatchObject({
        status: "unavailable",
        safeDetail: "missing:grounded-analysis-configuration",
      });
    } finally {
      if (previous === undefined) delete process.env.SHELF_JUDGE_GROUNDED_PROVIDER_ID;
      else process.env.SHELF_JUDGE_GROUNDED_PROVIDER_ID = previous;
    }
  });

  test("accepts an explicitly empty installed-extension allowlist without a default", () => {
    const configuration = resolveGroundedProviderConfiguration({
      providerId: "local-provider",
      modelId: "local-model",
      extensionIds: [],
    });

    expect(configuration).toEqual({
      status: "configured",
      providerId: "local-provider",
      modelId: "local-model",
      extensionIds: [],
    });
    expect(toGroundedProviderConfigurationStatus(configuration)).toEqual({
      status: "configured",
      identity: {
        providerId: "local-provider",
        modelId: "local-model",
        extensionIds: [],
      },
    });
  });

  test.each([
    ["blank provider", { providerId: "", modelId: "local-model", extensionIds: [] }],
    ["padded model", { providerId: "local-provider", modelId: " local-model", extensionIds: [] }],
    ["duplicate allowlist", { providerId: "local-provider", modelId: "local-model", extensionIds: ["x", "x"] }],
  ])("represents %s persisted identity nonfatally", (_name, identity) => {
    expect(
      resolveGroundedProviderConfiguration(identity),
    ).toEqual({
      status: "unavailable",
      reason: "model-configuration",
      safeDetail: "invalid:grounded-analysis-configuration",
      correctionDestination: {
        operationId: "shelf.grounded-analysis.configuration.get",
      },
    });
  });

  test("loads old configs with no provider identity and persists valid identities", async () => {
    const configPath = "/test/config.json";
    const fileOps = createMockFileOps({
      [configPath]: JSON.stringify({
        bggAuthToken: null,
        username: null,
      }),
    });
    const storage = createStorageService({ dataDir: "/test/data", configPath, fileOps });

    const appConfig = await storage.loadConfig();

    expect(appConfig.groundedAnalysis).toBeNull();
    await storage.saveConfig({
      ...appConfig,
      groundedAnalysis: { providerId: "local-provider", modelId: "local-model", extensionIds: [] },
    });
    expect((await storage.loadConfig()).groundedAnalysis).toEqual({
      providerId: "local-provider",
      modelId: "local-model",
      extensionIds: [],
    });
    expect(resolveGroundedProviderConfiguration((await storage.loadConfig()).groundedAnalysis ?? null))
      .toMatchObject({
        status: "configured",
        providerId: "local-provider",
        modelId: "local-model",
      });
  });

  test("constructs the shared startup provider from the saved config identity", async () => {
    const configPath = "/test/config.json";
    const fileOps = createMockFileOps({
      [configPath]: JSON.stringify({
        bggAuthToken: null,
        username: null,
        groundedAnalysis: {
          providerId: "ollama",
          modelId: "qwen3.6:27b",
          extensionIds: [],
        },
      }),
    });
    const storageService = createStorageService({ dataDir: "/test/data", configPath, fileOps });

    const { appConfig, provider } = await loadStartupGroundedAnalysis({
      storageService,
      cwd: "/test",
    });

    expect(appConfig.groundedAnalysis).toEqual({
      providerId: "ollama",
      modelId: "qwen3.6:27b",
      extensionIds: [],
    });
    expect(provider.configurationStatus).toEqual({
      status: "configured",
      identity: { providerId: "ollama", modelId: "qwen3.6:27b", extensionIds: [] },
    });
  });
});
