import * as path from "node:path";
import * as os from "node:os";

export function resolveBaseDir(): string {
  return process.env.SHELF_JUDGE_DIR ?? path.join(os.homedir(), ".shelf-judge");
}

export function resolveSocketPath(): string {
  return process.env.SHELF_JUDGE_SOCKET ?? path.join(resolveBaseDir(), "shelf-judge.sock");
}

export function resolveDataDir(): string {
  return process.env.SHELF_JUDGE_DATA_DIR ?? path.join(resolveBaseDir(), "data");
}

export function resolveConfigPath(): string {
  return process.env.SHELF_JUDGE_CONFIG ?? path.join(resolveBaseDir(), "config.json");
}
