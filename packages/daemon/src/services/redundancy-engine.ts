// Pure redundancy scoring functions. No I/O, no service dependencies.
// Implements REQ-REDUN-6 through REQ-REDUN-13.
// Follows the niche-engine.ts and prediction-engine.ts pattern.

import type {
  Game,
  GameWithScore,
  RedundancyAdjustment,
  RedundancyNeighbor,
  RedundancySettings,
} from "@shelf-judge/shared";
import type { FeatureVector, ComponentWeights } from "./feature-vector.js";
import { cosineSimilarity } from "./feature-vector.js";

export const DEFAULT_REDUNDANCY_SETTINGS: RedundancySettings = {
  enabled: false,
  stage: "annotation",
  similarityThreshold: 0.6,
  maxPenalty: 2.0,
  componentWeights: { binary: 0.4, continuous: 0.3, personalAxes: 0.3 },
  minNeighbors: 1,
  expectedNeighbors: 5,
};

/**
 * Flatten a FeatureVector into a single weighted array for cosine similarity.
 * Uses sqrt of normalized weight so the dot product reflects proportional contribution.
 * When includePersonalAxes is false, weight redistributes to binary + continuous.
 */
export function flattenWeighted(
  vec: FeatureVector,
  weights: ComponentWeights,
  includePersonalAxes: boolean,
): number[] {
  let bw: number;
  let cw: number;
  let pw: number;

  // If personalAxes is null, force includePersonalAxes=false to avoid
  // including personalAxes weight in the denominator without any dimensions
  const includePA = includePersonalAxes && vec.personalAxes !== null;

  if (includePA) {
    const total = weights.binary + weights.continuous + weights.personalAxes;
    bw = Math.sqrt(weights.binary / total);
    cw = Math.sqrt(weights.continuous / total);
    pw = Math.sqrt(weights.personalAxes / total);
  } else {
    const total = weights.binary + weights.continuous;
    bw = Math.sqrt(weights.binary / total);
    cw = Math.sqrt(weights.continuous / total);
    pw = 0;
  }

  const flat: number[] = [];
  for (const v of vec.binary) flat.push(v * bw);
  for (const v of vec.continuous) flat.push(v * cw);
  if (includePA && vec.personalAxes) {
    for (const v of vec.personalAxes) flat.push(v * pw);
  }
  return flat;
}

/**
 * Tie detection at two decimal places (REQ-REDUN-10).
 * Two scores are "tied" when they round to the same value at two decimals.
 */
function scoresAreTied(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Determine whether a game's score is fully predicted (no actual axis ratings).
 * Used for REQ-REDUN-12: predicted neighbors don't count as "better" for actual-scored games.
 */
function isFullyPredicted(gws: GameWithScore): boolean {
  return gws.score?.predictionMeta?.actualAxisCount === 0;
}

/**
 * Compute redundancy adjustments for all eligible games in a collection.
 *
 * Algorithm per REQ-REDUN-8:
 * 1. Filter to non-vetoed games with score > 0.
 * 2. Compute pairwise cosine similarity on weighted feature vectors.
 * 3. For each game, collect niche neighbors (similarity >= threshold).
 * 4. Count "better" neighbors (strictly higher score, not tied, respecting predicted authority).
 * 5. Penalty = (betterNeighbors / nicheSize) * maxPenalty.
 * 6. Adjusted score = max(1.0, originalScore - penalty).
 */
export function computeRedundancyAdjustments(
  gamesWithScores: GameWithScore[],
  settings: RedundancySettings,
  getFeatureVector: (game: Game) => FeatureVector,
): Map<string, RedundancyAdjustment> {
  const result = new Map<string, RedundancyAdjustment>();

  if (!settings.enabled) return result;

  // Guard against zero-sum weights producing NaN (route validation prevents this,
  // but the engine must be safe when called directly)
  const { binary, continuous, personalAxes } = settings.componentWeights;
  if (binary + continuous + personalAxes === 0) return result;

  // Filter to eligible games: non-vetoed, non-null score, score > 0
  const eligible = gamesWithScores.filter(
    (gws) => gws.score !== null && !gws.score.vetoed && gws.score.score > 0,
  );

  if (eligible.length < 2) return result;

  // Cache feature vectors
  const vectors = new Map<string, FeatureVector>();
  for (const gws of eligible) {
    vectors.set(gws.game.id, getFeatureVector(gws.game));
  }

  // Cache pairwise similarities (symmetric)
  const similarities = new Map<string, number>();
  function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function getSimilarity(a: GameWithScore, b: GameWithScore): number {
    const key = pairKey(a.game.id, b.game.id);
    const cached = similarities.get(key);
    if (cached !== undefined) return cached;

    const vecA = vectors.get(a.game.id)!;
    const vecB = vectors.get(b.game.id)!;

    // Include personalAxes only when both games have them
    const includePA = vecA.personalAxes !== null && vecB.personalAxes !== null;
    const flatA = flattenWeighted(vecA, settings.componentWeights, includePA);
    const flatB = flattenWeighted(vecB, settings.componentWeights, includePA);

    const raw = cosineSimilarity(flatA, flatB);
    // Zero-magnitude vectors produce NaN; treat as zero similarity
    const sim = isNaN(raw) ? 0 : raw;
    similarities.set(key, sim);
    return sim;
  }

  for (const gws of eligible) {
    const neighbors: { gws: GameWithScore; similarity: number }[] = [];

    for (const other of eligible) {
      if (other.game.id === gws.game.id) continue;
      const sim = getSimilarity(gws, other);
      if (sim >= settings.similarityThreshold) {
        neighbors.push({ gws: other, similarity: sim });
      }
    }

    if (neighbors.length < settings.minNeighbors) continue;

    // Sort neighbors by similarity descending
    neighbors.sort((a, b) => b.similarity - a.similarity);

    const gameScore = gws.score!.score;
    const gameIsActual = !isFullyPredicted(gws);

    // Count better neighbors
    let betterCount = 0;
    for (const n of neighbors) {
      const neighborScore = n.gws.score!.score;

      // Tied scores don't count as "better"
      if (scoresAreTied(gameScore, neighborScore)) continue;

      // Predicted neighbors don't count as "better" for actual-scored games (REQ-REDUN-12)
      if (gameIsActual && isFullyPredicted(n.gws)) continue;

      if (neighborScore > gameScore) {
        betterCount++;
      }
    }

    const nicheSize = neighbors.length;
    const coverageRatio = betterCount / Math.max(nicheSize, settings.expectedNeighbors);
    const penalty = coverageRatio * settings.maxPenalty;
    const adjustedScore = Math.max(1.0, gameScore - penalty);

    // Rank among niche: betterCount + 1. Uses the same predicted authority filter
    // as penalty computation so rank and penalty agree.
    const nicheRank = betterCount + 1;

    const nicheNeighbors: RedundancyNeighbor[] = neighbors.map((n) => ({
      gameId: n.gws.game.id,
      gameName: n.gws.game.name,
      similarity: Math.round(n.similarity * 1000) / 1000,
      fitnessScore: n.gws.score!.score,
      isPredicted: isFullyPredicted(n.gws),
    }));

    result.set(gws.game.id, {
      penalty: Math.round(penalty * 100) / 100,
      originalScore: gameScore,
      adjustedScore: Math.round(adjustedScore * 100) / 100,
      nicheNeighbors,
      nicheRank,
      nicheSize,
    });
  }

  return result;
}
