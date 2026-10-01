import { describe, expect, test } from "bun:test";
import type { JevPairCache } from "../../src/services/jev-pair-cache-service.js";
import { openJevPairCacheLifecycle } from "../../src/services/jev-pair-cache-lifecycle.js";
import type { Logger } from "../../src/services/logger.js";

function fakeCache(available: boolean, onClose: () => void): JevPairCache {
  return { available, close: onClose } as JevPairCache;
}

function captureLogger() {
  const entries: Array<{ level: string; args: unknown[] }> = [];
  const logger: Logger = {
    log: (...args) => entries.push({ level: "log", args }),
    warn: (...args) => entries.push({ level: "warn", args }),
    error: (...args) => entries.push({ level: "error", args }),
  };
  return { logger, entries };
}

describe("openJevPairCacheLifecycle", () => {
  test("reports unavailable cache without failing startup", async () => {
    const { logger, entries } = captureLogger();
    const lifecycle = await openJevPairCacheLifecycle("/tmp/daemon-data", logger, () =>
      Promise.resolve(fakeCache(false, () => undefined)),
    );

    expect(lifecycle.cache?.available).toBe(false);
    expect(entries.some((entry) => entry.args[0] === "Jev pair cache unavailable")).toBe(true);
    lifecycle.close();
  });

  test("contains unexpected initialization failures and remains fail-closed", async () => {
    const { logger, entries } = captureLogger();
    const lifecycle = await openJevPairCacheLifecycle("/tmp/daemon-data", logger, () =>
      Promise.reject(new Error("database open failed")),
    );

    expect(lifecycle.cache).toBeNull();
    expect(entries.some((entry) => entry.args[0] === "Jev pair cache initialization failed")).toBe(
      true,
    );
    expect(() => lifecycle.close()).not.toThrow();
  });

  test("closes the cache once when shutdown is requested repeatedly", async () => {
    const { logger } = captureLogger();
    let closeCount = 0;
    const lifecycle = await openJevPairCacheLifecycle("/tmp/daemon-data", logger, () =>
      Promise.resolve(fakeCache(true, () => closeCount++)),
    );

    lifecycle.close();
    lifecycle.close();
    expect(closeCount).toBe(1);
  });
});
