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
import type { FeatureVector } from "./feature-vector.js";
import { cosineSimilarity } from "./feature-vector.js";
import type { RedundancyComponentWeights } from "@shelf-judge/shared";

export const DEFAULT_REDUNDANCY_SETTINGS: RedundancySettings = {
  enabled: false,
  stage: "annotation",
  similarityThreshold: 0.6,
  maxPenalty: 2.0,
  componentWeights: { binary: 4 / 7, continuous: 3 / 7 },
  minNeighbors: 1,
  expectedNeighbors: 5,
};

export type RedundancySimilarityStatus =
  | "disabled"
  | "factual"
  | "not-ready"
  | "stale"
  | "partial"
  | "ready";

/** Numeric pair judgment. Null means the enabled signal was genuinely unavailable. */
export interface RedundancyPairScore {
  gameAId: string;
  gameBId: string;
  factual: number;
  description?: number | null;
  ownerNote?: number | null;
}

export interface RedundancyPairIdentity {
  generationId: string;
  consentEpoch: string;
  settingsEpoch: string;
}

/** Caller supplies the complete factual universe and independently available semantic signals. */
export interface RedundancyPairTable {
  status: RedundancySimilarityStatus;
  identity: RedundancyPairIdentity;
  expectedIdentity: RedundancyPairIdentity;
  weights: { factual: number; description: number; ownerNote: number };
  pairs: RedundancyPairScore[];
}

export interface CandidateRedundancyGame {
  id: string;
  name: string;
}

export interface CandidateRedundancyNeighbor {
  game: Pick<Game, "id" | "name">;
  score: number;
  isPredicted: boolean;
}

export interface RedundancySimilarityInfo {
  status: RedundancySimilarityStatus;
  generationId: string | null;
}

export interface RedundancyAnalysis {
  adjustments: Map<string, RedundancyAdjustment>;
  similarityInfo: Map<string, RedundancySimilarityInfo>;
  defaultSimilarityInfo: RedundancySimilarityInfo;
}

/** Stable key for an unordered pair, safe for IDs containing punctuation. */
export function redundancyPairKey(a: string, b: string): string {
  return JSON.stringify(a < b ? [a, b] : [b, a]);
}

function sameIdentity(a: RedundancyPairIdentity, b: RedundancyPairIdentity): boolean {
  return (
    Boolean(
      a.generationId &&
      a.consentEpoch &&
      a.settingsEpoch &&
      b.generationId &&
      b.consentEpoch &&
      b.settingsEpoch,
    ) &&
    a.generationId === b.generationId &&
    a.consentEpoch === b.consentEpoch &&
    a.settingsEpoch === b.settingsEpoch
  );
}

function validatePairTable(
  table: RedundancyPairTable,
  eligibleIds: string[],
): { factualPairs: Map<string, number>; composedPairs: Map<string, number> } {
  if (!sameIdentity(table.identity, table.expectedIdentity)) {
    throw new Error("Redundancy pair table identity does not match the expected generation");
  }
  const { factual, description, ownerNote } = table.weights;
  const weights = [factual, description, ownerNote];
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new Error("Redundancy pair table weights must be finite, non-negative, and nonzero");
  }
  const expected = new Set<string>();
  for (let i = 0; i < eligibleIds.length; i++) {
    for (let j = i + 1; j < eligibleIds.length; j++) {
      expected.add(redundancyPairKey(eligibleIds[i], eligibleIds[j]));
    }
  }
  const factualPairs = new Map<string, number>();
  const composedPairs = new Map<string, number>();
  const seen = new Set<string>();
  for (const pair of table.pairs) {
    if (!pair.gameAId || !pair.gameBId || pair.gameAId === pair.gameBId) {
      throw new Error("Redundancy pair table contains an invalid pair identity");
    }
    const key = redundancyPairKey(pair.gameAId, pair.gameBId);
    if (!expected.has(key)) throw new Error("Redundancy pair table contains an extra pair");
    if (seen.has(key)) throw new Error("Redundancy pair table contains a duplicate pair");
    seen.add(key);
    if (!Number.isFinite(pair.factual) || pair.factual < 0 || pair.factual > 1) {
      throw new Error("Redundancy factual pair score must be finite and in [0, 1]");
    }
    factualPairs.set(key, pair.factual);
    const composed = composeRedundancySignals(pair, table.weights);
    if (composed !== null) composedPairs.set(key, composed);
  }
  if (seen.size !== expected.size || [...expected].some((key) => !seen.has(key)))
    throw new Error("Redundancy factual pair universe is incomplete");
  return { factualPairs, composedPairs };
}

/** Existing pairwise available-weight normalization, shared with candidate scoring. */
export function composeRedundancySignals(
  pair: Pick<RedundancyPairScore, "factual" | "description" | "ownerNote">,
  weights: RedundancyPairTable["weights"],
): number | null {
  const available: [number, number][] = [];
  if (weights.factual > 0) {
    if (!Number.isFinite(pair.factual) || pair.factual < 0 || pair.factual > 1) {
      throw new Error("Redundancy factual pair score must be finite and in [0, 1]");
    }
    available.push([weights.factual, pair.factual]);
  }
  if (weights.description > 0 && pair.description != null) {
    if (!Number.isFinite(pair.description) || pair.description < 0 || pair.description > 1) {
      throw new Error("Redundancy description pair score must be finite and in [0, 1]");
    }
    available.push([weights.description, pair.description]);
  }
  if (weights.ownerNote > 0 && pair.ownerNote != null) {
    if (!Number.isFinite(pair.ownerNote) || pair.ownerNote < 0 || pair.ownerNote > 1) {
      throw new Error("Redundancy owner-note pair score must be finite and in [0, 1]");
    }
    available.push([weights.ownerNote, pair.ownerNote]);
  }
  const total = available.reduce((sum, [weight]) => sum + weight, 0);
  if (total <= 0 || !Number.isFinite(total)) return null;
  return available.reduce((sum, [weight, score]) => sum + weight * score, 0) / total;
}

/**
 * Flatten a FeatureVector into a single weighted array for cosine similarity.
 * Uses sqrt of normalized weight so the dot product reflects proportional contribution.
 * Feature-vector axes are intentionally ignored by redundancy.
 */
export function flattenWeighted(vec: FeatureVector, weights: RedundancyComponentWeights): number[] {
  const total = weights.binary + weights.continuous;
  if (!Number.isFinite(total) || total <= 0) return [];
  const bw = Math.sqrt(weights.binary / total);
  const cw = Math.sqrt(weights.continuous / total);

  const flat: number[] = [];
  for (const v of vec.binary) flat.push(v * bw);
  for (const v of vec.continuous) flat.push(v * cw);
  return flat;
}

/** Exact factual cosine similarity shared by the engine and factual context factory. */
export function factualSimilarity(
  a: FeatureVector,
  b: FeatureVector,
  weights: RedundancyComponentWeights,
): number {
  return cosineSimilarity(flattenWeighted(a, weights), flattenWeighted(b, weights));
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
  pairTable?: RedundancyPairTable,
  allowFactualFallback = true,
): Map<string, RedundancyAdjustment> {
  return computeRedundancyAnalysis(
    gamesWithScores,
    settings,
    getFeatureVector,
    pairTable,
    undefined,
    allowFactualFallback,
  ).adjustments;
}

/** Computes adjustments and independent, note-free status for every eligible game. */
export function computeRedundancyAnalysis(
  gamesWithScores: GameWithScore[],
  settings: RedundancySettings,
  getFeatureVector: (game: Game) => FeatureVector,
  pairTable?: RedundancyPairTable,
  fallbackStatus: Exclude<RedundancySimilarityStatus, "ready"> = pairTable?.status ===
    "not-ready" || pairTable?.status === "stale"
    ? pairTable.status
    : settings.enabled
      ? "factual"
      : "disabled",
  allowFactualFallback = true,
): RedundancyAnalysis {
  const result = new Map<string, RedundancyAdjustment>();
  const similarityInfo = new Map<string, RedundancySimilarityInfo>();

  const status: RedundancySimilarityStatus = pairTable?.status ?? fallbackStatus;
  const generationId =
    status === "ready" || status === "partial" ? pairTable!.identity.generationId : null;
  const defaultSimilarityInfo = { status, generationId };
  const eligible = gamesWithScores.filter(
    (gws) => gws.score !== null && !gws.score.vetoed && gws.score.score > 0,
  );
  for (const gws of eligible) similarityInfo.set(gws.game.id, { status, generationId });

  if (!settings.enabled) return { adjustments: result, similarityInfo, defaultSimilarityInfo };

  // Guard against zero-sum weights producing NaN (route validation prevents this,
  // but the engine must be safe when called directly)
  const { binary, continuous } = settings.componentWeights;
  if (!Number.isFinite(binary + continuous) || binary + continuous <= 0)
    return { adjustments: result, similarityInfo, defaultSimilarityInfo };

  // Filter to eligible games: non-vetoed, non-null score, score > 0
  if (pairTable) {
    // Compare the supplied factual layer to the current factual vectors before trusting
    // any semantic composition. This also catches pair-table/game identity drift.
    const { factualPairs, composedPairs } = validatePairTable(
      pairTable,
      eligible.map((gws) => gws.game.id),
    );
    const vectors = new Map(eligible.map((gws) => [gws.game.id, getFeatureVector(gws.game)]));
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i];
        const b = eligible[j];
        const expected = factualSimilarity(
          vectors.get(a.game.id)!,
          vectors.get(b.game.id)!,
          settings.componentWeights,
        );
        const key = redundancyPairKey(a.game.id, b.game.id);
        const supplied = factualPairs.get(key);
        if (supplied === undefined) {
          throw new Error("Redundancy factual pair table is missing a validated pair");
        }
        if (Math.abs(expected - supplied) > 1e-9) {
          throw new Error(
            "Redundancy pair table factual score does not match current feature vectors",
          );
        }
      }
    }
    if (eligible.length < 2) return { adjustments: result, similarityInfo, defaultSimilarityInfo };
    scoreNeighbors(
      eligible,
      settings,
      (a, b) => composedPairs.get(redundancyPairKey(a.game.id, b.game.id)) ?? Number.NaN,
      result,
    );
    return { adjustments: result, similarityInfo, defaultSimilarityInfo };
  }

  if (!allowFactualFallback || eligible.length < 2)
    return { adjustments: result, similarityInfo, defaultSimilarityInfo };

  // Cache feature vectors
  const vectors = new Map<string, FeatureVector>();
  for (const gws of eligible) {
    vectors.set(gws.game.id, getFeatureVector(gws.game));
  }

  // Cache pairwise similarities (symmetric)
  const similarities = new Map<string, number>();

  function getSimilarity(a: GameWithScore, b: GameWithScore): number {
    const key = redundancyPairKey(a.game.id, b.game.id);
    const cached = similarities.get(key);
    if (cached !== undefined) return cached;

    const vecA = vectors.get(a.game.id)!;
    const vecB = vectors.get(b.game.id)!;

    const sim = factualSimilarity(vecA, vecB, settings.componentWeights);
    similarities.set(key, sim);
    return sim;
  }

  scoreNeighbors(eligible, settings, getSimilarity, result);

  return { adjustments: result, similarityInfo, defaultSimilarityInfo };
}

function scoreNeighbors(
  eligible: GameWithScore[],
  settings: RedundancySettings,
  getSimilarity: (a: GameWithScore, b: GameWithScore) => number,
  result: Map<string, RedundancyAdjustment>,
): void {
  for (const gws of eligible) {
    const neighbors: { gws: GameWithScore; similarity: number }[] = [];

    for (const other of eligible) {
      if (other.game.id === gws.game.id) continue;
      const sim = getSimilarity(gws, other);
      if (Number.isFinite(sim) && sim >= settings.similarityThreshold) {
        neighbors.push({ gws: other, similarity: sim });
      }
    }

    if (neighbors.length < settings.minNeighbors) continue;

    result.set(
      gws.game.id,
      buildAdjustment(
        { game: gws.game, score: gws.score!.score, isPredicted: isFullyPredicted(gws) },
        neighbors.map(({ gws: neighbor, similarity }) => ({
          game: neighbor.game,
          score: neighbor.score!.score,
          isPredicted: isFullyPredicted(neighbor),
          similarity,
        })),
        settings,
      ),
    );
  }
}

/** Candidate-to-owned scoring reuses the collection neighbor/penalty equations without
 * constructing a collection pair table or evaluating any owned-owned comparisons. */
export function computeCandidateRedundancyAdjustment(
  candidate: CandidateRedundancyGame & { score: number },
  eligibleOwned: readonly CandidateRedundancyNeighbor[],
  settings: RedundancySettings,
  similarityWithOwned: (owned: CandidateRedundancyNeighbor) => number,
): RedundancyAdjustment | null {
  if (!settings.enabled || !Number.isFinite(candidate.score)) return null;
  const neighbors = eligibleOwned.flatMap((owned) => {
    const similarity = similarityWithOwned(owned);
    return Number.isFinite(similarity) && similarity >= settings.similarityThreshold
      ? [{ ...owned, similarity }]
      : [];
  });
  if (neighbors.length < settings.minNeighbors) {
    return neighbors.length === 0 ? zeroPenaltyAdjustment(candidate.score) : null;
  }
  return buildAdjustment(
    { game: candidate, score: candidate.score, isPredicted: true },
    neighbors,
    settings,
  );
}

function buildAdjustment(
  target: CandidateRedundancyNeighbor,
  neighbors: readonly (CandidateRedundancyNeighbor & { similarity: number })[],
  settings: RedundancySettings,
): RedundancyAdjustment {
  const sortedNeighbors = [...neighbors].sort((a, b) => b.similarity - a.similarity);
  let betterCount = 0;
  for (const neighbor of sortedNeighbors) {
    if (scoresAreTied(target.score, neighbor.score)) continue;
    if (!target.isPredicted && neighbor.isPredicted) continue;
    if (neighbor.score > target.score) betterCount++;
  }
  const nicheSize = sortedNeighbors.length;
  const coverageRatio = betterCount / Math.max(nicheSize, settings.expectedNeighbors);
  const penalty = coverageRatio * settings.maxPenalty;
  const adjustedScore = Math.max(1.0, target.score - penalty);
  const nicheNeighbors: RedundancyNeighbor[] = sortedNeighbors.map((neighbor) => ({
    gameId: neighbor.game.id,
    gameName: neighbor.game.name,
    similarity: Math.round(neighbor.similarity * 1000) / 1000,
    fitnessScore: neighbor.score,
    isPredicted: neighbor.isPredicted,
  }));
  return {
    penalty: Math.round(penalty * 100) / 100,
    originalScore: target.score,
    adjustedScore: Math.round(adjustedScore * 100) / 100,
    nicheNeighbors,
    nicheRank: betterCount + 1,
    nicheSize,
  };
}

function zeroPenaltyAdjustment(score: number): RedundancyAdjustment {
  return {
    penalty: 0,
    originalScore: score,
    adjustedScore: score,
    nicheNeighbors: [],
    nicheRank: 1,
    nicheSize: 0,
  };
}
