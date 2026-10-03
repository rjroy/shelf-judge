import type { Game, RedundancyComponentWeights } from "@shelf-judge/shared";
import { buildVocabulary, computeContinuousRanges, encodeGame } from "./feature-vector.js";
import type { FeatureVector } from "./feature-vector.js";
import { factualSimilarity } from "./redundancy-engine.js";

/**
 * Build factual vectors for redundancy scoring using the display engine's
 * normalization universe: games with BGG data, including noneligible games.
 */
export function createRedundancyFactualContext(
  collectionGames: readonly Game[],
  weights: RedundancyComponentWeights,
): {
  getFeatureVector(game: Game): FeatureVector;
  similarity(gameA: Game, gameB: Game): number;
} {
  const games = collectionGames.filter((game) => Boolean(game.bggData));
  const vocabulary = buildVocabulary(games);
  const ranges = computeContinuousRanges(games);
  const vectors = new Map<string, FeatureVector>();

  const getFeatureVector = (game: Game): FeatureVector => {
    let vector = vectors.get(game.id);
    if (!vector) {
      // Redundancy is deliberately factual-only; personal and tournament axes
      // are irrelevant to the encoded binary/continuous portions.
      vector = encodeGame(game, vocabulary, [], {}, ranges);
      vectors.set(game.id, vector);
    }
    return vector;
  };

  return {
    getFeatureVector,
    similarity: (gameA, gameB) =>
      factualSimilarity(getFeatureVector(gameA), getFeatureVector(gameB), weights),
  };
}
