import { resolveDataDir, resolveConfigPath, resolveSocketPath } from "@shelf-judge/shared";

export interface ResolvedConfig {
  dataDir: string;
  configPath: string;
  socketPath: string;
}

export function resolveConfig(): ResolvedConfig {
  return {
    dataDir: resolveDataDir(),
    configPath: resolveConfigPath(),
    socketPath: resolveSocketPath(),
  };
}
