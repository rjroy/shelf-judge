import { afterEach, describe, expect, test } from "bun:test";
import { resolveConfigPath, resolveDataDir, resolveSocketPath } from "../src/paths.js";

const pathEnvironment = [
  "SHELF_JUDGE_DIR",
  "SHELF_JUDGE_DATA_DIR",
  "SHELF_JUDGE_SOCKET",
  "SHELF_JUDGE_CONFIG",
] as const;

const originalEnvironment = Object.fromEntries(
  pathEnvironment.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of pathEnvironment) {
    const original = originalEnvironment[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe("path resolution", () => {
  test("derives default paths from the configured base directory", () => {
    process.env.SHELF_JUDGE_DIR = "/shelf-judge";
    delete process.env.SHELF_JUDGE_DATA_DIR;
    delete process.env.SHELF_JUDGE_SOCKET;
    delete process.env.SHELF_JUDGE_CONFIG;

    expect(resolveDataDir()).toBe("/shelf-judge/data");
    expect(resolveSocketPath()).toBe("/shelf-judge/shelf-judge.sock");
    expect(resolveConfigPath()).toBe("/shelf-judge/config.json");
  });

  test("uses independent explicit overrides for data, socket, and config paths", () => {
    process.env.SHELF_JUDGE_DIR = "/shelf-judge";
    process.env.SHELF_JUDGE_DATA_DIR = "/data";
    process.env.SHELF_JUDGE_SOCKET = "/run/shelf-judge.sock";
    process.env.SHELF_JUDGE_CONFIG = "/settings/config.json";

    expect(resolveDataDir()).toBe("/data");
    expect(resolveSocketPath()).toBe("/run/shelf-judge.sock");
    expect(resolveConfigPath()).toBe("/settings/config.json");
  });
});
