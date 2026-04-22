import * as path from "node:path";
import * as os from "node:os";

const DEFAULT_BASE_DIR = path.join(os.homedir(), ".shelf-judge");

export interface ResolvedConfig {
  dataDir: string;
  configPath: string;
  socketPath: string;
}

export function resolveConfig(): ResolvedConfig {
  const baseDir = process.env.SHELF_JUDGE_DIR ?? DEFAULT_BASE_DIR;
  return {
    dataDir: process.env.SHELF_JUDGE_DATA_DIR ?? path.join(baseDir, "data"),
    configPath: process.env.SHELF_JUDGE_CONFIG ?? path.join(baseDir, "config.json"),
    socketPath: process.env.SHELF_JUDGE_SOCKET ?? path.join(baseDir, "shelf-judge.sock"),
  };
}
