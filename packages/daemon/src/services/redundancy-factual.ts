import type { RedundancyComponentWeights } from "@shelf-judge/shared";
import { buildVocabulary, computeContinuousRanges, encodeGame } from "./feature-vector.js";
import type { FactualScoringGame, FeatureVector } from "./feature-vector.js";
import { factualSimilarity } from "./redundancy-engine.js";

/**
 * Build factual vectors for redundancy scoring using the display engine's
 * normalization universe: games with BGG data, including noneligible games.
 */
export interface RedundancyFactualContextObserver {
  onVocabularyBuilt?(): void;
  onRangesBuilt?(): void;
  onVectorEncoded?(gameId: string): void;
}

export function createRedundancyFactualContext(
  collectionGames: readonly FactualScoringGame[],
  weights: RedundancyComponentWeights,
  observer?: RedundancyFactualContextObserver,
): {
  getFeatureVector(game: FactualScoringGame): FeatureVector;
  similarity(gameA: FactualScoringGame, gameB: FactualScoringGame): number;
} {
  const games = collectionGames.filter((game) => Boolean(game.bggData));
  const vocabulary = buildVocabulary(games);
  observer?.onVocabularyBuilt?.();
  const ranges = computeContinuousRanges(games);
  observer?.onRangesBuilt?.();
  const vectorsByGameId = new Map<string, FeatureVector>();
  const vectorsByProjection = new WeakMap<object, FeatureVector>();

  const getFeatureVector = (game: FactualScoringGame): FeatureVector => {
    let vector = game.cacheIdentity
      ? vectorsByProjection.get(game.cacheIdentity)
      : vectorsByGameId.get(game.id);
    if (!vector) {
      // Redundancy is deliberately factual-only; personal and tournament axes
      // are irrelevant to the encoded binary/continuous portions.
      vector = encodeGame(game, vocabulary, [], {}, ranges);
      if (game.cacheIdentity) vectorsByProjection.set(game.cacheIdentity, vector);
      else vectorsByGameId.set(game.id, vector);
      observer?.onVectorEncoded?.(game.id);
    }
    return vector;
  };

  return {
    getFeatureVector,
    similarity: (gameA, gameB) =>
      factualSimilarity(getFeatureVector(gameA), getFeatureVector(gameB), weights),
  };
}
