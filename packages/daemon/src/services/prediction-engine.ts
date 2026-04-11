// Pure prediction functions. No I/O, no service dependencies.
// Implements k-NN estimation, confidence assignment, predicted fitness, and readiness.
// Follows the elo-engine.ts and curve-engine.ts pattern.

import type {
  Axis,
  BggGameData,
  FitnessBreakdownEntry,
  FitnessResult,
  Game,
  PredictionConfidence,
  PredictionMeta,
  PredictionReadiness,
  PredictionSettings,
  ReferenceGame,
  RevealedPreferenceTension,
} from "@shelf-judge/shared";
import { cosineSimilarity } from "./feature-vector";
import type { Vocabulary } from "./feature-vector";

export const DEFAULT_PREDICTION_SETTINGS: PredictionSettings = {
  stageThresholds: [5, 15, 30],
  defaultK: 5,
  minSimilarityThreshold: 0.2,
  tournamentStabilityBoost: 0.2,
};

export interface ReferenceGameCandidate {
  gameId: string;
  gameName: string;
  vector: number[];
  ratings: Record<string, number>;
  tournamentStability: number;
}

export interface SimilarityMatch {
  gameId: string;
  gameName: string;
  similarity: number; // effective similarity (cosine * stability)
  rating: number; // the rating on the target axis
}

export interface AxisPrediction {
  rating: number;
  confidence: PredictionConfidence;
  variance: number;
  avgSimilarity: number;
}

export interface PredictedFitnessResult {
  fitnessResult: FitnessResult;
  predictedAxisCount: number;
  actualAxisCount: number;
}

/**
 * Find the k most similar games that have a rating on the target axis.
 * Similarity = cosineSimilarity(target, candidate) * candidate.tournamentStability.
 * Excludes candidates below minSimilarity. Returns sorted descending by effective similarity.
 */
export function findKNearestForAxis(
  targetVector: number[],
  referenceGames: ReferenceGameCandidate[],
  axisId: string,
  k: number,
  minSimilarity: number,
): SimilarityMatch[] {
  const matches: SimilarityMatch[] = [];

  for (const candidate of referenceGames) {
    const rating = candidate.ratings[axisId];
    if (rating === undefined) continue;

    const baseSimilarity = cosineSimilarity(targetVector, candidate.vector);
    const effectiveSimilarity = baseSimilarity * candidate.tournamentStability;

    if (effectiveSimilarity < minSimilarity) continue;

    matches.push({
      gameId: candidate.gameId,
      gameName: candidate.gameName,
      similarity: effectiveSimilarity,
      rating,
    });
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, k);
}

/**
 * Compute similarity-weighted average of matches' ratings and assign confidence.
 *
 * Confidence levels (lowest wins when criteria conflict):
 * - strong: 5+ matches, variance < 1.5, avg similarity > 0.7
 * - moderate: 3+ matches, variance <= 3.0, avg similarity >= 0.4
 * - weak: at least 1 match
 * - insufficient: zero matches (returns null)
 */
export function predictAxisRating(matches: SimilarityMatch[]): {
  rating: number;
  confidence: PredictionConfidence;
  variance: number;
  avgSimilarity: number;
} | null {
  if (matches.length === 0) return null;

  let weightedSum = 0;
  let weightSum = 0;
  let similaritySum = 0;

  for (const m of matches) {
    weightedSum += m.rating * m.similarity;
    weightSum += m.similarity;
    similaritySum += m.similarity;
  }

  const rating = weightSum > 0 ? weightedSum / weightSum : 0;
  const avgSimilarity = similaritySum / matches.length;

  // Compute variance of ratings (population variance around the weighted mean)
  let varianceSum = 0;
  for (const m of matches) {
    varianceSum += (m.rating - rating) ** 2;
  }
  const variance = varianceSum / matches.length;

  let confidence: PredictionConfidence = "weak";
  if (matches.length >= 5 && variance < 1.5 && avgSimilarity > 0.7) {
    confidence = "strong";
  } else if (matches.length >= 3 && variance <= 3.0 && avgSimilarity >= 0.4) {
    confidence = "moderate";
  }

  return { rating, confidence, variance, avgSimilarity };
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Core prediction entry point. Produces a FitnessResult with predicted values for unrated axes.
 *
 * 1. Calls calculateActualScore for BGG-derived axes with curves.
 * 2. For each personal axis without an actual rating, runs k-NN estimation.
 * 3. Assembles combined breakdown (actual + predicted entries).
 * 4. Computes overall score: sum(effectiveRating * weight) / sum(weights).
 * 5. Predicted values do NOT trigger vetoes (REQ-PRED-10).
 * 6. Builds PredictionMeta.
 */
export function computePredictedFitness(
  game: Game,
  axes: Axis[],
  bggData: BggGameData | null,
  referenceGames: ReferenceGameCandidate[],
  targetVector: number[],
  settings: PredictionSettings,
  readinessStage: 0 | 1 | 2 | 3,
  calculateActualScore: (
    game: Game,
    axes: Axis[],
    bggData: BggGameData | null,
  ) => FitnessResult | null,
): PredictedFitnessResult {
  const actualResult = calculateActualScore(game, axes, bggData);

  // If all axes are rated, no prediction needed
  if (actualResult && actualResult.ratedAxisCount === axes.length) {
    return {
      fitnessResult: actualResult,
      predictedAxisCount: 0,
      actualAxisCount: actualResult.ratedAxisCount,
    };
  }

  // Build combined breakdown
  const breakdown: FitnessBreakdownEntry[] = [];
  let weightedSum = 0;
  let weightSum = 0;
  let actualAxisCount = 0;
  let predictedAxisCount = 0;
  let vetoTriggered = false;
  let vetoInfo: FitnessResult["vetoedBy"] = null;
  let lowestPredictionConfidence: PredictionConfidence | null = null;
  let totalWeight = 0;
  let coveredWeight = 0;
  let totalReferenceGames = new Set<string>();

  for (const axis of axes) {
    totalWeight += axis.weight;

    // Check if actual result has this axis rated
    const actualEntry = actualResult?.breakdown.find((e) => e.axisId === axis.id);
    const hasActualRating = actualEntry && actualEntry.rating !== null;

    if (hasActualRating) {
      // Use actual entry directly
      const entry: FitnessBreakdownEntry = {
        ...actualEntry,
        predictionConfidence: "actual",
        referenceGames: null,
      };
      breakdown.push(entry);

      weightedSum += actualEntry.rating! * axis.weight;
      weightSum += axis.weight;
      actualAxisCount++;
      coveredWeight += axis.weight; // actual always counts toward coverage
    } else if (axis.source === "personal" && readinessStage > 0) {
      // Predict this axis via k-NN
      const matches = findKNearestForAxis(
        targetVector,
        referenceGames,
        axis.id,
        settings.defaultK,
        settings.minSimilarityThreshold,
      );

      const prediction = predictAxisRating(matches);

      if (prediction && prediction.confidence !== "insufficient") {
        const effectiveRating = roundToOneDecimal(prediction.rating);
        const contribution = roundToOneDecimal(effectiveRating * axis.weight);

        const refGames: ReferenceGame[] = matches.map((m) => ({
          gameId: m.gameId,
          gameName: m.gameName,
          similarity: roundToOneDecimal(m.similarity * 100) / 100,
        }));

        for (const m of matches) totalReferenceGames.add(m.gameId);

        breakdown.push({
          axisId: axis.id,
          axisName: axis.name,
          rating: effectiveRating,
          weight: axis.weight,
          contribution,
          source: "predicted",
          bggOriginal: null,
          rawValue: effectiveRating,
          effectiveRating,
          preferenceShape: axis.preferenceShape ?? "higher-is-better",
          curveAffected: false,
          predictionConfidence: prediction.confidence,
          referenceGames: refGames,
        });

        // Predicted values contribute to score but do NOT trigger vetoes (REQ-PRED-10)
        weightedSum += effectiveRating * axis.weight;
        weightSum += axis.weight;
        predictedAxisCount++;

        // Track coverage: only "strong" counts toward coverage
        if (prediction.confidence === "strong") {
          coveredWeight += axis.weight;
        }

        // Track lowest prediction confidence
        if (
          lowestPredictionConfidence === null ||
          confidenceRank(prediction.confidence) < confidenceRank(lowestPredictionConfidence)
        ) {
          lowestPredictionConfidence = prediction.confidence;
        }
      } else {
        // Insufficient: excluded from score calculation
        breakdown.push({
          axisId: axis.id,
          axisName: axis.name,
          rating: null,
          weight: axis.weight,
          contribution: null,
          source: "predicted",
          bggOriginal: null,
          rawValue: null,
          effectiveRating: null,
          preferenceShape: axis.preferenceShape ?? "higher-is-better",
          curveAffected: false,
          predictionConfidence: "insufficient",
          referenceGames: [],
        });
      }
    } else {
      // Unrated axis with no prediction (stage 0 or BGG axis without data)
      breakdown.push({
        axisId: axis.id,
        axisName: axis.name,
        rating: null,
        weight: axis.weight,
        contribution: null,
        source: axis.source === "bgg" ? "bgg" : "personal",
        bggOriginal: null,
        rawValue: null,
        effectiveRating: null,
        preferenceShape: axis.preferenceShape ?? "higher-is-better",
        curveAffected: false,
        predictionConfidence: null,
        referenceGames: null,
      });
    }
  }

  // Copy veto info from actual result (only actual vetoes fire)
  if (actualResult?.vetoed) {
    vetoTriggered = true;
    vetoInfo = actualResult.vetoedBy;
  }

  // Normalize contributions to be relative to total weight sum
  for (const entry of breakdown) {
    if (entry.contribution !== null && weightSum > 0) {
      entry.contribution = roundToOneDecimal((entry.rating! * entry.weight) / weightSum);
    }
  }

  // Sort breakdown: override, bgg, personal, predicted
  const sourceOrder: Record<string, number> = {
    override: 0,
    bgg: 1,
    personal: 2,
    predicted: 3,
  };
  breakdown.sort((a, b) => {
    if (sourceOrder[a.source] !== sourceOrder[b.source]) {
      return sourceOrder[a.source] - sourceOrder[b.source];
    }
    return (b.contribution || 0) - (a.contribution || 0);
  });

  // ratedAxisCount reflects actual axes only (REQ-PRED-35). Predicted axes do not inflate this count.
  // The score guard uses the combined count so predictions still produce a non-zero score.
  const combinedCount = actualAxisCount + predictedAxisCount;
  const score = weightSum > 0 ? roundToOneDecimal(weightedSum / weightSum) : 0;
  const hypotheticalScore = vetoTriggered ? score : null;

  const overallConfidence: PredictionConfidence =
    predictedAxisCount === 0 ? "actual" : (lowestPredictionConfidence ?? "insufficient");

  const coveragePercent =
    totalWeight > 0 ? roundToOneDecimal((coveredWeight / totalWeight) * 100) / 100 : 0;

  const predictionMeta: PredictionMeta | null =
    predictedAxisCount > 0
      ? {
          readinessStage,
          confidence: overallConfidence,
          predictedAxisCount,
          actualAxisCount,
          referenceGameCount: totalReferenceGames.size,
          coveragePercent,
        }
      : null;

  const fitnessResult: FitnessResult = vetoTriggered
    ? {
        score: 0,
        ratedAxisCount: actualAxisCount,
        totalAxisCount: axes.length,
        breakdown,
        vetoed: true,
        vetoedBy: vetoInfo,
        hypotheticalScore,
        predictionMeta,
      }
    : {
        score: combinedCount > 0 ? score : 0,
        ratedAxisCount: actualAxisCount,
        totalAxisCount: axes.length,
        breakdown,
        vetoed: false,
        vetoedBy: null,
        hypotheticalScore: null,
        predictionMeta,
      };

  return {
    fitnessResult,
    predictedAxisCount,
    actualAxisCount,
  };
}

/**
 * Rank confidence levels numerically for comparison (lower = less confident).
 */
function confidenceRank(c: PredictionConfidence): number {
  switch (c) {
    case "insufficient":
      return 0;
    case "weak":
      return 1;
    case "moderate":
      return 2;
    case "strong":
      return 3;
    case "actual":
      return 4;
  }
}

/**
 * Compute the current prediction readiness stage and suggested actions.
 *
 * Stages:
 *   0: < stageThresholds[0] rated games (no personal-axis predictions)
 *   1: >= stageThresholds[0] (experimental)
 *   2: >= stageThresholds[1] (stable)
 *   3: >= stageThresholds[2] (mature)
 */
/**
 * Pre-computed map of cluster name (mechanic or category) to the set of game IDs
 * in the collection that have that cluster. Passed by the caller so assessReadiness
 * can identify underrepresented clusters without taking a full Game[] array.
 */
export type ClusterMembership = Map<string, Set<string>>;

export function assessReadiness(
  ratedGameCount: number,
  axes: Axis[],
  gameRatings: Map<string, Record<string, number>>,
  vocabulary: Vocabulary,
  settings: PredictionSettings,
  clusterMembership: ClusterMembership = new Map(),
): PredictionReadiness {
  const [t1, t2, t3] = settings.stageThresholds;

  let stage: 0 | 1 | 2 | 3;
  let nextStageAt: number;

  if (ratedGameCount >= t3) {
    stage = 3;
    nextStageAt = t3; // already at max
  } else if (ratedGameCount >= t2) {
    stage = 2;
    nextStageAt = t3;
  } else if (ratedGameCount >= t1) {
    stage = 1;
    nextStageAt = t2;
  } else {
    stage = 0;
    nextStageAt = t1;
  }

  // Weak axes: personal axes with fewest rated games
  const personalAxes = axes.filter((a) => a.source === "personal");
  const axisCounts: { axisId: string; axisName: string; ratedCount: number }[] = [];

  for (const axis of personalAxes) {
    let count = 0;
    for (const ratings of gameRatings.values()) {
      if (ratings[axis.id] !== undefined) count++;
    }
    axisCounts.push({ axisId: axis.id, axisName: axis.name, ratedCount: count });
  }

  axisCounts.sort((a, b) => a.ratedCount - b.ratedCount);
  const weakAxes = axisCounts.filter((a) => a.ratedCount < settings.defaultK);

  // Suggested actions: identify underrepresented mechanic/category clusters
  const suggestedActions: string[] = [];

  if (stage === 0) {
    const needed = t1 - ratedGameCount;
    suggestedActions.push(
      `Rate ${needed} more game${needed === 1 ? "" : "s"} to unlock experimental predictions.`,
    );
  }

  // Identify rated game IDs for cluster coverage analysis
  const ratedGamesSet = new Set<string>();
  for (const [gameId, ratings] of gameRatings.entries()) {
    if (Object.keys(ratings).length > 0) ratedGamesSet.add(gameId);
  }

  // Find mechanic/category clusters that are common in the collection but underrepresented
  // among rated games (REQ-PRED-20)
  if (clusterMembership.size > 0) {
    const clusterCoverage: { name: string; total: number; rated: number }[] = [];
    for (const [clusterName, gameIds] of clusterMembership) {
      const total = gameIds.size;
      if (total < 3) continue; // only suggest clusters with meaningful presence
      let rated = 0;
      for (const gid of gameIds) {
        if (ratedGamesSet.has(gid)) rated++;
      }
      clusterCoverage.push({ name: clusterName, total, rated });
    }

    // Sort by coverage ratio ascending (least covered first), break ties by total descending
    clusterCoverage.sort((a, b) => {
      const ratioA = a.rated / a.total;
      const ratioB = b.rated / b.total;
      if (ratioA !== ratioB) return ratioA - ratioB;
      return b.total - a.total;
    });

    // Suggest the top underrepresented clusters (coverage < 50%, up to 2 suggestions)
    let clusterSuggestions = 0;
    for (const cluster of clusterCoverage) {
      if (clusterSuggestions >= 2) break;
      if (cluster.rated / cluster.total >= 0.5) break; // rest are well-covered
      suggestedActions.push(
        `Rate a ${cluster.name} game to improve predictions for that cluster (${cluster.rated}/${cluster.total} rated).`,
      );
      clusterSuggestions++;
    }
  }

  for (const weak of weakAxes.slice(0, 3)) {
    if (weak.ratedCount === 0) {
      suggestedActions.push(
        `Rate games on "${weak.axisName}" to enable predictions for that axis.`,
      );
    } else if (weak.ratedCount < 3) {
      suggestedActions.push(
        `Rate more games on "${weak.axisName}" (${weak.ratedCount} rated, need 3+ for moderate confidence).`,
      );
    }
  }

  return {
    stage,
    ratedGameCount,
    nextStageAt,
    weakAxes,
    suggestedActions,
  };
}

export interface TournamentRankedGame {
  gameId: string;
  gameName: string;
  vector: number[];
  normalizedScore: number;
}

/**
 * Detect tension between predicted fitness and tournament ranking among similar games.
 *
 * Finds the k nearest tournament-ranked neighbors via cosine similarity, computes
 * their average normalizedScore. Returns tension when the difference exceeds 1.0 point.
 * Returns null when no tension or no qualifying neighbors.
 */
export function detectRevealedPreferenceTension(
  predictedOverallFitness: number,
  targetVector: number[],
  tournamentRankedGames: TournamentRankedGame[],
  k: number,
  minSimilarity: number,
): RevealedPreferenceTension | null {
  if (tournamentRankedGames.length === 0) return null;

  const neighbors: { similarity: number; normalizedScore: number; gameName: string }[] = [];

  for (const game of tournamentRankedGames) {
    const similarity = cosineSimilarity(targetVector, game.vector);
    if (similarity < minSimilarity) continue;
    neighbors.push({ similarity, normalizedScore: game.normalizedScore, gameName: game.gameName });
  }

  if (neighbors.length === 0) return null;

  neighbors.sort((a, b) => b.similarity - a.similarity);
  const topK = neighbors.slice(0, k);

  let scoreSum = 0;
  for (const n of topK) {
    scoreSum += n.normalizedScore;
  }
  const tournamentClusterAverage = roundToOneDecimal(scoreSum / topK.length);

  const difference = Math.abs(predictedOverallFitness - tournamentClusterAverage);
  if (difference <= 1.0) return null;

  const direction =
    predictedOverallFitness > tournamentClusterAverage
      ? "higher than what similar tournament-ranked games suggest"
      : "lower than what similar tournament-ranked games suggest";

  return {
    predictedFitness: predictedOverallFitness,
    tournamentClusterAverage,
    note: `Predicted fitness (${predictedOverallFitness}) is ${direction} (${tournamentClusterAverage}).`,
  };
}
