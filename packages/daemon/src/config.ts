import { resolveDataDir, resolveConfigPath, resolveSocketPath } from "@shelf-judge/shared";
import type { GroundedProviderConfigurationStatus } from "@shelf-judge/shared";
import {
  resolveGroundedProviderConfiguration,
  toGroundedProviderConfigurationStatus,
  type GroundedProviderStartupConfiguration,
} from "./services/grounded-analysis/provider-configuration.js";

export interface ResolvedConfig {
  dataDir: string;
  configPath: string;
  socketPath: string;
  groundedAnalysis: GroundedProviderStartupConfiguration;
  groundedAnalysisStatus: GroundedProviderConfigurationStatus;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const groundedAnalysis = resolveGroundedProviderConfiguration(env);
  return {
    dataDir: resolveDataDir(),
    configPath: resolveConfigPath(),
    socketPath: resolveSocketPath(),
    groundedAnalysis,
    groundedAnalysisStatus: toGroundedProviderConfigurationStatus(groundedAnalysis),
  };
}
