import { describe, expect, test } from "bun:test";
import {
  GROUNDED_PROVIDER_ENV,
  resolveGroundedProviderConfiguration,
  toGroundedProviderConfigurationStatus,
} from "../src/services/grounded-analysis/provider-configuration.js";
import { createStorageService } from "../src/services/storage-service.js";
import { createMockFileOps } from "./helpers/mock-file-ops.js";

describe("grounded-analysis startup configuration", () => {
  test("requires explicit provider, model, and extension allowlist values", () => {
    const configuration = resolveGroundedProviderConfiguration({});

    expect(configuration).toEqual({
      status: "unavailable",
      reason: "model-configuration",
      safeDetail: `missing:${GROUNDED_PROVIDER_ENV.providerId},${GROUNDED_PROVIDER_ENV.modelId},${GROUNDED_PROVIDER_ENV.extensionIds}`,
      correctionDestination: {
        operationId: "shelf.grounded-analysis.configuration.get",
      },
    });
  });

  test("accepts an explicitly empty installed-extension allowlist without a default", () => {
    const configuration = resolveGroundedProviderConfiguration({
      [GROUNDED_PROVIDER_ENV.providerId]: "local-provider",
      [GROUNDED_PROVIDER_ENV.modelId]: "local-model",
      [GROUNDED_PROVIDER_ENV.extensionIds]: "[]",
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
    ["blank provider", "", "local-model", "[]", GROUNDED_PROVIDER_ENV.providerId],
    ["padded model", "local-provider", " local-model", "[]", GROUNDED_PROVIDER_ENV.modelId],
    [
      "non-array allowlist",
      "local-provider",
      "local-model",
      "{}",
      GROUNDED_PROVIDER_ENV.extensionIds,
    ],
    [
      "duplicate allowlist",
      "local-provider",
      "local-model",
      '["x","x"]',
      GROUNDED_PROVIDER_ENV.extensionIds,
    ],
    ["invalid JSON", "local-provider", "local-model", "x", GROUNDED_PROVIDER_ENV.extensionIds],
  ])("represents %s nonfatally", (_name, providerId, modelId, extensionIds, invalidName) => {
    expect(
      resolveGroundedProviderConfiguration({
        [GROUNDED_PROVIDER_ENV.providerId]: providerId,
        [GROUNDED_PROVIDER_ENV.modelId]: modelId,
        [GROUNDED_PROVIDER_ENV.extensionIds]: extensionIds,
      }),
    ).toEqual({
      status: "unavailable",
      reason: "model-configuration",
      safeDetail: `invalid:${invalidName}`,
      correctionDestination: {
        operationId: "shelf.grounded-analysis.configuration.get",
      },
    });
  });

  test("does not admit provider configuration into durable AppConfig", async () => {
    const configPath = "/test/config.json";
    const fileOps = createMockFileOps({
      [configPath]: JSON.stringify({
        bggAuthToken: null,
        username: null,
        groundedProviderId: "must-not-persist",
        groundedModelId: "must-not-persist",
        groundedExtensionIds: ["must-not-persist"],
      }),
    });
    const storage = createStorageService({ dataDir: "/test/data", configPath, fileOps });

    const appConfig = await storage.loadConfig();

    expect(appConfig).not.toHaveProperty("groundedProviderId");
    expect(appConfig).not.toHaveProperty("groundedModelId");
    expect(appConfig).not.toHaveProperty("groundedExtensionIds");
  });
});
