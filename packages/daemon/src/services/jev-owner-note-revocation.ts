import type { Logger } from "./logger.js";
import type { JevPairCache } from "./jev-pair-cache-service.js";

/** Idempotent durable-fence recovery: permission=false remains authoritative on failure. */
export function purgeRevokedOwnerNoteCache(
  cache: JevPairCache | null | undefined,
  logger: Logger,
  context: Readonly<Record<string, unknown>> = {},
): boolean {
  logger.log("JEV owner-note revocation cleanup attempt", { ...context, outcome: "attempting" });
  try {
    if (!cache || !cache.available) throw new Error("JEV pair cache is unavailable");
    const purgedRows = cache.purgeDDependent();
    cache.setActivation(null);
    logger.log("JEV owner-note revocation cleanup completed", {
      ...context,
      purgedRows,
      outcome: "cleaned",
    });
    return true;
  } catch (error) {
    logger.error("JEV owner-note revocation cleanup failed", {
      ...context,
      reason: error instanceof Error ? error.message : String(error),
      outcome: "authority-effective-cleanup-pending",
    });
    return false;
  }
}
