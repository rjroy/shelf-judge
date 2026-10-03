import { createJevPairCache, type JevPairCache } from "./jev-pair-cache-service.js";
import { toErrorMessage } from "@shelf-judge/shared";
import type { Logger } from "./logger.js";

type CacheLogger = Pick<Logger, "log" | "error">;

export interface JevPairCacheLifecycle {
  readonly cache: JevPairCache | null;
  close(): void;
}

/** Opens the disposable cache without allowing its failure to block daemon startup. */
export async function openJevPairCacheLifecycle(
  dataDir: string,
  logger: CacheLogger,
  openCache: typeof createJevPairCache = createJevPairCache,
): Promise<JevPairCacheLifecycle> {
  logger.log("Jev pair cache initialization started", { trigger: "startup" });

  let cache: JevPairCache | null = null;
  try {
    cache = await openCache(dataDir);
  } catch (error) {
    logger.error("Jev pair cache initialization failed", {
      trigger: "startup",
      available: false,
      error: toErrorMessage(error),
    });
  }

  if (cache !== null) {
    if (cache.available) {
      logger.log("Jev pair cache initialized", { trigger: "startup", available: true });
    } else {
      logger.error("Jev pair cache unavailable", {
        trigger: "startup",
        available: false,
      });
    }
  }

  let closed = false;
  return {
    cache,
    close() {
      if (closed) return;
      closed = true;
      try {
        cache?.close();
        logger.log("Jev pair cache closed", { trigger: "shutdown" });
      } catch (error) {
        logger.error("Jev pair cache close failed", {
          trigger: "shutdown",
          error: toErrorMessage(error),
        });
      }
    },
  };
}
