import type { AppConfig } from "@shelf-judge/shared";
import type { StorageService } from "../storage-service.js";
import { createGroundedAnalysisProvider, type GroundedAnalysisProvider } from "./provider.js";
import { createProviderSessionExtensions } from "./provider-extension-factories.js";
import { resolveGroundedProviderConfiguration } from "./provider-configuration.js";

/** Builds the one provider instance supplied to both Reflections and Analyst routes. */
export async function loadStartupGroundedAnalysis(options: {
  readonly storageService: Pick<StorageService, "loadConfig">;
  readonly cwd: string;
}): Promise<{ readonly appConfig: AppConfig; readonly provider: GroundedAnalysisProvider }> {
  const appConfig = await options.storageService.loadConfig();
  const configuration = resolveGroundedProviderConfiguration(appConfig.groundedAnalysis);

  return {
    appConfig,
    provider: createGroundedAnalysisProvider({
      configuration,
      piSessionFactory: {
        cwd: options.cwd,
        ...(configuration.status === "configured"
          ? createProviderSessionExtensions(configuration)
          : {}),
      },
    }),
  };
}
