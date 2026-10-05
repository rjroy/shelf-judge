/** Unbound CLI formatter for the staged current wishlist projection contract. */
import {
  validateWishlistEntryReadResultV2,
  type WishlistEntryReadResultV2,
} from "../../../shared/src/wishlist-current-projection-v2.js";
import { formatScore, formatTable, printOutput } from "../output.js";
import type { OutputOptions } from "../output.js";

function parseResults(values: readonly unknown[]): WishlistEntryReadResultV2[] {
  return values.map(validateWishlistEntryReadResultV2);
}

export function formatWishlistCurrentProjectionList(
  values: readonly unknown[],
  options: OutputOptions,
): string {
  const results = parseResults(values);
  if (options.json) return printOutput(results, options);
  if (results.length === 0) return "Wishlist is empty.";
  return formatTable(
    ["Name", "Year", "Current prediction", "Confidence", "Redundancy", "Added"],
    results.map(({ entry, prediction, redundancy }) => [
      entry.name,
      entry.yearPublished == null ? "---" : String(entry.yearPublished),
      prediction.availability === "available"
        ? formatScore(prediction.result.score)
        : "Current prediction unavailable",
      prediction.availability === "available"
        ? (prediction.result.predictionMeta?.confidence ?? "---")
        : prediction.reason,
      redundancy.orderingScore == null ? "---" : formatScore(redundancy.orderingScore),
      new Date(entry.addedAt).toLocaleDateString(),
    ]),
  );
}

/** Copy helper for the future activation command; it never consults saved scores. */
export function formatWishlistCurrentProjectionSavedMessage(value: unknown): string {
  const { prediction } = validateWishlistEntryReadResultV2(value);
  if (prediction.availability === "unavailable") {
    return `Factual source saved. Current prediction unavailable (${prediction.reason}).`;
  }
  return `Factual source saved. Current prediction: ${formatScore(prediction.result.score)} (${prediction.result.predictionMeta?.confidence ?? "actual"}).`;
}
