import type { FitnessResult } from "@shelf-judge/shared";
import {
  validateWishlistEntryReadResultV2,
  type WishlistEntryReadResultV2,
} from "../../shared/src/wishlist-current-projection-v2";
import type { WishlistEntryView } from "../../shared/src/types";

export type CurrentWishlistRow = {
  entry: WishlistEntryView;
  prediction: FitnessResult | null;
  predictionAvailable: boolean;
  unavailableMessage: string | null;
  redundancyScore: number | null;
  redundancyAdjusted: boolean;
  redundancySource: "current" | "base-prediction" | "unavailable";
};

/** Convert only the explicit v2 current-result envelope; never revive saved derived values. */
export function toCurrentWishlistRow(result: unknown): CurrentWishlistRow | null {
  let projection: WishlistEntryReadResultV2;
  try {
    projection = validateWishlistEntryReadResultV2(result);
  } catch {
    return null;
  }

  const prediction =
    projection.prediction.availability === "available" ? projection.prediction.result : null;
  const unavailableMessage = prediction
    ? null
    : projection.prediction.availability === "unavailable" &&
        projection.prediction.reason === "missing-source"
      ? "Refresh factual details to calculate it."
      : "Current prediction unavailable.";

  return {
    entry: projection.entry,
    prediction,
    predictionAvailable: prediction !== null,
    unavailableMessage,
    redundancyScore:
      typeof projection.redundancy.orderingScore === "number" &&
      Number.isFinite(projection.redundancy.orderingScore)
        ? projection.redundancy.orderingScore
        : null,
    redundancyAdjusted:
      projection.redundancy.source === "current" && projection.redundancy.adjustment !== null,
    redundancySource: projection.redundancy.source,
  };
}

export function sortCurrentWishlistRows(
  rows: readonly CurrentWishlistRow[],
  direction: "asc" | "desc" = "desc",
  field: "score" | "redundancy" | "name" | "addedAt" = "redundancy",
): CurrentWishlistRow[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (!a.predictionAvailable && b.predictionAvailable) return 1;
    if (a.predictionAvailable && !b.predictionAvailable) return -1;
    if (field === "name") return sign * a.entry.name.localeCompare(b.entry.name);
    if (field === "addedAt")
      return sign * (Date.parse(a.entry.addedAt) - Date.parse(b.entry.addedAt));
    const aScore = field === "score" ? (a.prediction?.score ?? null) : a.redundancyScore;
    const bScore = field === "score" ? (b.prediction?.score ?? null) : b.redundancyScore;
    if (aScore === null && bScore === null) return 0;
    if (aScore === null) return 1;
    if (bScore === null) return -1;
    return sign * (aScore - bScore);
  });
}
