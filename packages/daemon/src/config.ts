import * as path from "node:path";
import * as os from "node:os";
import type { AppConfig } from "@shelf-judge/shared";

const DEFAULT_DATA_DIR = path.join(os.homedir(), ".shelf-judge", "data");
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".shelf-judge", "config.json");
const DEFAULT_SOCKET_PATH = "/tmp/shelf-judge.sock";

export interface ResolvedConfig {
  dataDir: string;
  configPath: string;
  socketPath: string;
}

export function resolveConfig(): ResolvedConfig {
  return {
    dataDir: process.env.SHELF_JUDGE_DATA_DIR ?? DEFAULT_DATA_DIR,
    configPath: process.env.SHELF_JUDGE_CONFIG ?? DEFAULT_CONFIG_PATH,
    socketPath: process.env.SHELF_JUDGE_SOCKET ?? DEFAULT_SOCKET_PATH,
  };
}

export function resolveSocketPath(appConfig: AppConfig, envConfig: ResolvedConfig): string {
  return appConfig.socketPath || envConfig.socketPath;
}
