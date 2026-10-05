import type { Collection } from "@shelf-judge/shared";
import { canonicalSha256 } from "./profile-source-coordinator.js";

/**
 * Identity of collection inputs that can affect wishlist C_ONLY scoring.
 * Owner-note data and its per-game write timestamp are the only game fields
 * omitted; ordered axes and games are preserved because scoring is order-sensitive.
 */
export function wishlistCollectionSourceIdentity(collection: Collection): string {
  return canonicalSha256({
    domain: "wishlist-collection-scoring-source-v1",
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    axes: collection.axes,
    games: collection.games.map((game) =>
      Object.fromEntries(
        Object.entries(game).filter(([key]) => key !== "ownerNote" && key !== "updatedAt"),
      ),
    ),
  });
}
