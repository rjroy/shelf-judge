import type { JevPairCache } from "./jev-pair-cache-service.js";
import {
  validateWishlistCandidateCOnlyRow,
  type WishlistCandidateMembershipIndex,
  type WishlistDescriptionPairRequest,
} from "./wishlist-candidate-read-proof.js";
import type { FrozenWishlistRunPair, PreparedWishlistRun } from "./wishlist-run-preparation.js";

export type WishlistPairReadiness =
  | { state: "missing-source" }
  | { state: "current-hit"; value: number; proofRequest: WishlistDescriptionPairRequest }
  | { state: "frozen-unavailable"; proofRequest: WishlistDescriptionPairRequest }
  | { state: "frozen-not-authorized"; proofRequest: WishlistDescriptionPairRequest }
  | { state: "executable-miss"; proofRequest: WishlistDescriptionPairRequest };

/** Inspect only the frozen wishlist pair and its exact candidate-domain C_ONLY evidence. */
export function createWishlistPairReadinessInspector(
  frozen: PreparedWishlistRun,
  cache: Pick<JevPairCache, "lookup">,
): (pair: FrozenWishlistRunPair) => WishlistPairReadiness {
  const entriesById = new Map(frozen.entries.map((entry) => [entry.id, entry]));
  const ownedById = new Map(frozen.capture.collection.games.map((game) => [game.id, game]));
  const membership: WishlistCandidateMembershipIndex = {
    candidateBggIds: new Set(frozen.entries.map((entry) => entry.bggId)),
    eligibleOwnedIds: new Set(frozen.eligibleOwnedIds),
  };

  return (pair) => {
    const candidate = entriesById.get(pair.candidateEntryId);
    const ownedGame = ownedById.get(pair.ownedGameId);
    if (!candidate?.bggSource || !ownedGame?.bggData?.description)
      return { state: "missing-source" };
    const proofRequest: WishlistDescriptionPairRequest = {
      candidate: {
        bggId: candidate.bggId,
        name: candidate.name,
        bggSource: candidate.bggSource,
      },
      ownedGame: {
        id: ownedGame.id,
        bggId: ownedGame.bggId,
        name: ownedGame.name,
        description: ownedGame.bggData.description,
      },
    };
    const row = cache.lookup({
      gameAId: pair.gameAId,
      gameBId: pair.gameBId,
      signal: "C",
      pairDomain: "wishlist-candidate",
    });
    const proof = validateWishlistCandidateCOnlyRow(
      row,
      frozen.capture.collection.id,
      proofRequest,
      membership,
    );
    if (proof.valid) return { state: "current-hit", value: proof.value, proofRequest };
    if (pair.state === "unavailable") return { state: "frozen-unavailable", proofRequest };
    if (pair.state === "cached-hit") return { state: "frozen-not-authorized", proofRequest };
    return { state: "executable-miss", proofRequest };
  };
}
