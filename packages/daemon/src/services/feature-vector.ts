// Pure feature vector functions. No I/O, no service dependencies.
// Implements REQ-PROFILE-11 (composite distance), REQ-PRED-4 (shared module).
// Follows the elo-engine.ts and curve-engine.ts pattern.

import type { Game } from "@shelf-judge/shared";

export interface Vocabulary {
  mechanics: string[];
  categories: string[];
}

export interface FeatureVector {
  binary: number[]; // one-hot encoding of mechanics + categories
  continuous: number[]; // BGG weight, community rating, min/max players, play time
  personalAxes: number[] | null; // axis ratings normalized 0-1, null when no ratings
}

export interface ComponentWeights {
  binary: number;
  continuous: number;
  personalAxes: number;
}

export interface ComponentDistances {
  binary: number;
  continuous: number;
  personalAxes: number | null;
  composite: number;
}

export const DEFAULT_WEIGHTS: ComponentWeights = {
  binary: 0.4,
  continuous: 0.3,
  personalAxes: 0.3,
};

/**
 * Scan all games' BGG data and return sorted, deduplicated mechanic and category name lists.
 * The vocabulary defines which binary columns exist in the feature vector.
 */
export function buildVocabulary(games: Game[]): Vocabulary {
  const mechanicsSet = new Set<string>();
  const categoriesSet = new Set<string>();

  for (const game of games) {
    if (!game.bggData) continue;
    for (const m of game.bggData.mechanics) mechanicsSet.add(m.name);
    for (const c of game.bggData.categories) categoriesSet.add(c.name);
  }

  return {
    mechanics: [...mechanicsSet].sort(),
    categories: [...categoriesSet].sort(),
  };
}

/**
 * Normalize a value to [0,1] given a known min/max range.
 * Returns 0 when min === max (no spread).
 */
function normalize(value: number, min: number, max: number): number {
  if (min === max) return 0;
  return (value - min) / (max - min);
}

/**
 * Encode a single game into a feature vector.
 *
 * Binary portion: one bit per mechanic/category in the vocabulary.
 * Continuous portion: BGG weight (1-5), community rating (1-10),
 *   min players, max players, play time (normalized over observed ranges).
 * Personal axes portion: axis ratings normalized 0-1 over 1-10.
 */
export function encodeGame(
  game: Game,
  vocabulary: Vocabulary,
  axisRatings?: Record<string, number>,
): FeatureVector {
  const allTerms = [...vocabulary.mechanics, ...vocabulary.categories];
  const gameTerms = new Set<string>();
  if (game.bggData) {
    for (const m of game.bggData.mechanics) gameTerms.add(m.name);
    for (const c of game.bggData.categories) gameTerms.add(c.name);
  }

  const binary = allTerms.map((term) => (gameTerms.has(term) ? 1 : 0));

  // Continuous: weight (1-5), community rating (1-10), min players, max players, play time.
  // Null values default to midpoint of their range.
  const weight = game.bggData?.weight ?? 2.5;
  const communityRating = game.bggData?.communityRating ?? 5.5;
  const minPlayers = game.minPlayers ?? 1;
  const maxPlayers = game.maxPlayers ?? 4;
  const playingTime = game.playingTime ?? 60;

  const continuous = [
    normalize(weight, 1, 5),
    normalize(communityRating, 1, 10),
    normalize(minPlayers, 1, 10), // reasonable player count range
    normalize(maxPlayers, 1, 10),
    normalize(playingTime, 0, 300), // cap at 300 minutes for normalization
  ];

  // Clamp continuous values to [0,1]
  for (let i = 0; i < continuous.length; i++) {
    continuous[i] = Math.max(0, Math.min(1, continuous[i]));
  }

  let personalAxes: number[] | null = null;
  if (axisRatings) {
    const axisIds = Object.keys(axisRatings).sort();
    if (axisIds.length > 0) {
      personalAxes = axisIds.map((id) => {
        const rating = game.ratings[id];
        // Normalize 1-10 rating to 0-1. Unrated axes get midpoint (0.5).
        return rating != null ? normalize(rating, 1, 10) : 0.5;
      });
    }
  }

  return { binary, continuous, personalAxes };
}

/**
 * Jaccard distance between two binary vectors: 1 - |A ∩ B| / |A ∪ B|.
 * When both sets are empty, returns 0 (no distance).
 */
export function jaccardDistance(a: number[], b: number[]): number {
  let intersection = 0;
  let union = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === 1 || bi === 1) union++;
    if (ai === 1 && bi === 1) intersection++;
  }

  if (union === 0) return 0;
  return 1 - intersection / union;
}

/**
 * Normalized Manhattan distance: sum(|a_i - b_i|) / n.
 * Each element is already [0,1] from encoding, so result is [0,1].
 * Returns 0 when vectors are empty.
 */
export function normalizedManhattanDistance(a: number[], b: number[]): number {
  if (a.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length;
}

/**
 * Composite distance combining binary (Jaccard) and continuous (Manhattan) portions.
 * When personal axes are unavailable, the weight redistributes proportionally
 * between binary and continuous.
 */
export function compositeDistance(
  a: FeatureVector,
  b: FeatureVector,
  weights: ComponentWeights = DEFAULT_WEIGHTS,
): ComponentDistances {
  const binaryDist = jaccardDistance(a.binary, b.binary);
  const continuousDist = normalizedManhattanDistance(a.continuous, b.continuous);

  let personalAxesDist: number | null = null;
  let wBinary: number;
  let wContinuous: number;
  let wPersonal: number;

  if (a.personalAxes && b.personalAxes) {
    personalAxesDist = normalizedManhattanDistance(a.personalAxes, b.personalAxes);
    wBinary = weights.binary;
    wContinuous = weights.continuous;
    wPersonal = weights.personalAxes;
  } else {
    // Redistribute personal axes weight proportionally
    const totalNonPersonal = weights.binary + weights.continuous;
    wBinary = weights.binary / totalNonPersonal;
    wContinuous = weights.continuous / totalNonPersonal;
    wPersonal = 0;
  }

  const composite =
    wBinary * binaryDist + wContinuous * continuousDist + wPersonal * (personalAxesDist ?? 0);

  return {
    binary: binaryDist,
    continuous: continuousDist,
    personalAxes: personalAxesDist,
    composite,
  };
}

/**
 * Compute the centroid of a set of feature vectors.
 * Binary portion: mean frequency (fraction of games with each attribute).
 * Continuous portion: element-wise mean.
 * Personal axes: element-wise mean of non-null vectors (null if all null).
 */
export function computeCentroid(vectors: FeatureVector[]): FeatureVector {
  if (vectors.length === 0) {
    return { binary: [], continuous: [], personalAxes: null };
  }

  const binaryLen = vectors[0].binary.length;
  const continuousLen = vectors[0].continuous.length;

  const binarySum = new Array<number>(binaryLen).fill(0);
  const continuousSum = new Array<number>(continuousLen).fill(0);

  for (const v of vectors) {
    for (let i = 0; i < binaryLen; i++) binarySum[i] += v.binary[i];
    for (let i = 0; i < continuousLen; i++) continuousSum[i] += v.continuous[i];
  }

  const n = vectors.length;
  const binary = binarySum.map((s) => s / n);
  const continuous = continuousSum.map((s) => s / n);

  // Personal axes centroid: average of non-null vectors
  const axisVectors = vectors.filter((v) => v.personalAxes !== null);
  let personalAxes: number[] | null = null;

  if (axisVectors.length > 0) {
    const axisLen = axisVectors[0].personalAxes!.length;
    const axisSum = new Array<number>(axisLen).fill(0);
    for (const v of axisVectors) {
      for (let i = 0; i < axisLen; i++) axisSum[i] += v.personalAxes![i];
    }
    personalAxes = axisSum.map((s) => s / axisVectors.length);
  }

  return { binary, continuous, personalAxes };
}

/**
 * Cosine similarity between two numeric vectors: dot(a,b) / (|a| * |b|).
 * Returns 1 for identical vectors, 0 for orthogonal.
 * Returns 0 when either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  if (denominator === 0) return 0;
  return dot / denominator;
}
