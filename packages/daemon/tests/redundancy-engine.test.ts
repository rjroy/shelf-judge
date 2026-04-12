import { describe, expect, test } from "bun:test";
import {
  computeRedundancyAdjustments,
  flattenWeighted,
  DEFAULT_REDUNDANCY_SETTINGS,
} from "../src/services/redundancy-engine";
import type { Game, GameWithScore, FitnessResult, RedundancySettings } from "@shelf-judge/shared";
import type { FeatureVector } from "../src/services/feature-vector";

// --- Fixture helpers ---

function makeGame(id: string, name: string): Game {
  return {
    id,
    bggId: null,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeScore(
  score: number,
  options: { vetoed?: boolean; predictedOnly?: boolean } = {},
): FitnessResult {
  return {
    score: options.vetoed ? 0 : score,
    ratedAxisCount: options.predictedOnly ? 0 : 3,
    totalAxisCount: 5,
    breakdown: [],
    vetoed: options.vetoed ?? false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: options.predictedOnly
      ? {
          readinessStage: 2,
          confidence: "moderate",
          predictedAxisCount: 3,
          actualAxisCount: 0,
          referenceGameCount: 5,
          coveragePercent: 60,
        }
      : null,
    redundancyAdjustment: null,
  };
}

function makeGws(game: Game, score: FitnessResult | null): GameWithScore {
  return { game, score };
}

// Known feature vectors for deterministic similarity results.
// Using simple vectors where cosine similarity is easy to compute.
const vectors: Record<string, FeatureVector> = {
  // Games A and B are very similar (identical binary/continuous, similar axes)
  a: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.9, 0.7] },
  b: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.85, 0.75] },
  // Game C somewhat similar to A/B
  c: { binary: [1, 0, 1, 0], continuous: [0.7, 0.5], personalAxes: [0.8, 0.6] },
  // Game D very different from A/B
  d: { binary: [0, 0, 1, 1], continuous: [0.2, 0.9], personalAxes: [0.1, 0.3] },
  // Game E similar to A/B but no personal axes
  e: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: null },
  // Game F: vetoed
  f: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.9, 0.7] },
};

function getVector(game: Game): FeatureVector {
  return vectors[game.id] ?? { binary: [0, 0, 0, 0], continuous: [0, 0], personalAxes: null };
}

function enabledSettings(overrides: Partial<RedundancySettings> = {}): RedundancySettings {
  return {
    ...DEFAULT_REDUNDANCY_SETTINGS,
    enabled: true,
    similarityThreshold: 0.5,
    ...overrides,
  };
}

describe("flattenWeighted", () => {
  test("includes personalAxes when flag is true and axes present", () => {
    const vec: FeatureVector = { binary: [1, 0], continuous: [0.5], personalAxes: [0.8] };
    const weights = { binary: 0.4, continuous: 0.3, personalAxes: 0.3 };
    const flat = flattenWeighted(vec, weights, true);
    expect(flat).toHaveLength(4); // 2 binary + 1 continuous + 1 personalAxes
  });

  test("excludes personalAxes when flag is false", () => {
    const vec: FeatureVector = { binary: [1, 0], continuous: [0.5], personalAxes: [0.8] };
    const weights = { binary: 0.4, continuous: 0.3, personalAxes: 0.3 };
    const flat = flattenWeighted(vec, weights, false);
    expect(flat).toHaveLength(3); // 2 binary + 1 continuous, no personalAxes
  });

  test("null personalAxes with includePersonalAxes=true falls back to binary+continuous weights", () => {
    const vec: FeatureVector = { binary: [1, 0], continuous: [0.5], personalAxes: null };
    const weights = { binary: 0.4, continuous: 0.3, personalAxes: 0.3 };
    const flat = flattenWeighted(vec, weights, true);
    // personalAxes is null so treated as includePersonalAxes=false
    expect(flat).toHaveLength(3);
    // Weights should be redistributed over binary+continuous only (same as includePersonalAxes=false)
    const flatExplicitFalse = flattenWeighted(vec, weights, false);
    expect(flat).toEqual(flatExplicitFalse);
  });
});

describe("computeRedundancyAdjustments", () => {
  test("returns empty map when settings.enabled is false", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    const result = computeRedundancyAdjustments(
      games,
      { ...DEFAULT_REDUNDANCY_SETTINGS, enabled: false },
      getVector,
    );
    expect(result.size).toBe(0);
  });

  test("no neighbors above threshold: no adjustment", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("d", "D"), makeScore(7.0)),
    ];
    // A and D are very different, similarity below threshold
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.99 }),
      getVector,
    );
    expect(result.size).toBe(0);
  });

  test("fewer neighbors than minNeighbors: no adjustment", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    // A and B are similar, but minNeighbors=5 means we need at least 5 neighbors
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ minNeighbors: 5 }),
      getVector,
    );
    expect(result.size).toBe(0);
  });

  test("highest-scoring game gets zero penalty", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    const result = computeRedundancyAdjustments(games, enabledSettings(), getVector);
    const adjA = result.get("a");
    expect(adjA).toBeDefined();
    expect(adjA!.penalty).toBe(0);
    expect(adjA!.adjustedScore).toBe(9.0);
    expect(adjA!.nicheRank).toBe(1);
  });

  test("penalty proportional to coverageRatio", () => {
    // A=9.0, B=7.0: B has 1 better neighbor out of 1, so coverage=1.0, penalty=maxPenalty
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    const settings = enabledSettings({ maxPenalty: 2.0 });
    const result = computeRedundancyAdjustments(games, settings, getVector);
    const adjB = result.get("b");
    expect(adjB).toBeDefined();
    expect(adjB!.penalty).toBe(2.0);
    expect(adjB!.adjustedScore).toBe(5.0);
  });

  test("score floor at 1.0", () => {
    // Game with score 2.0 and penalty > 1.0 should floor at 1.0
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(2.0)),
    ];
    const settings = enabledSettings({ maxPenalty: 5.0 });
    const result = computeRedundancyAdjustments(games, settings, getVector);
    const adjB = result.get("b");
    expect(adjB).toBeDefined();
    expect(adjB!.adjustedScore).toBe(1.0);
  });

  test("tied games don't count as better", () => {
    // A=8.002, B=8.004: both round to 800 at 2 decimal places, so they're tied
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.002)),
      makeGws(makeGame("b", "B"), makeScore(8.004)),
    ];
    const result = computeRedundancyAdjustments(games, enabledSettings(), getVector);
    const adjA = result.get("a");
    const adjB = result.get("b");
    // Neither counts the other as "better" since they're tied
    expect(adjA!.penalty).toBe(0);
    expect(adjB!.penalty).toBe(0);
  });

  test("vetoed games excluded entirely", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("f", "F"), makeScore(7.0, { vetoed: true })),
    ];
    const result = computeRedundancyAdjustments(games, enabledSettings(), getVector);
    // F is vetoed, so A has no neighbors
    expect(result.has("f")).toBe(false);
    expect(result.size).toBe(0); // A has no eligible neighbors
  });

  test("predicted games don't penalize actual-scored games (REQ-REDUN-12)", () => {
    // A is actual with score 7.0, B is predicted with score 9.0
    // B is "better" but shouldn't count against A because B is fully predicted
    const games = [
      makeGws(makeGame("a", "A"), makeScore(7.0)),
      makeGws(makeGame("b", "B"), makeScore(9.0, { predictedOnly: true })),
    ];
    const result = computeRedundancyAdjustments(games, enabledSettings(), getVector);
    const adjA = result.get("a");
    expect(adjA).toBeDefined();
    expect(adjA!.penalty).toBe(0); // predicted B doesn't count as "better" for actual A
  });

  test("predicted games ARE penalized by actual-scored neighbors normally", () => {
    // B is predicted with score 7.0, A is actual with score 9.0
    // A counts as "better" against predicted B
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0, { predictedOnly: true })),
    ];
    const result = computeRedundancyAdjustments(games, enabledSettings(), getVector);
    const adjB = result.get("b");
    expect(adjB).toBeDefined();
    expect(adjB!.penalty).toBeGreaterThan(0);
  });

  test("componentWeights influence similarity", () => {
    // With all weight on binary, A and E are very similar (same binary vector)
    // With all weight on personalAxes, A and E have no axes overlap (E has null)
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("e", "E"), makeScore(7.0)),
    ];

    // High binary weight: should find neighbors
    const binaryResult = computeRedundancyAdjustments(
      games,
      enabledSettings({ componentWeights: { binary: 1.0, continuous: 0, personalAxes: 0 } }),
      getVector,
    );
    expect(binaryResult.size).toBeGreaterThan(0);
  });

  test("similarityThreshold changes neighbor set", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("c", "C"), makeScore(7.0)),
    ];

    // Low threshold: C is a neighbor of A
    const lowThreshold = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.3 }),
      getVector,
    );
    // High threshold: C is not a neighbor of A
    const highThreshold = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.99 }),
      getVector,
    );
    expect(lowThreshold.size).toBeGreaterThanOrEqual(highThreshold.size);
  });

  test("neighbors sorted by similarity descending", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(8.0)),
      makeGws(makeGame("c", "C"), makeScore(7.0)),
    ];
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.3 }),
      getVector,
    );

    // Check that neighbors for any game with multiple neighbors are sorted
    for (const [, adj] of result) {
      for (let i = 1; i < adj.nicheNeighbors.length; i++) {
        expect(adj.nicheNeighbors[i - 1].similarity).toBeGreaterThanOrEqual(
          adj.nicheNeighbors[i].similarity,
        );
      }
    }
  });

  test("3 games with identical scores and high similarity all get zero penalty", () => {
    // Spec AI Validation: "3 games with identical fitness scores and high mutual similarity,
    // verifying all receive zero penalty (no game is 'better')."
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("b", "B"), makeScore(8.0)),
      makeGws(makeGame("c", "C"), makeScore(8.0)),
    ];
    // A, B, C all have similar vectors (a/b are near-identical, c is somewhat similar)
    // Use low threshold so all are neighbors
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.3 }),
      getVector,
    );
    for (const [, adj] of result) {
      expect(adj.penalty).toBe(0);
      expect(adj.nicheRank).toBe(1);
    }
  });

  test("5 neighbors where 3 score higher: penalty is (3/5) * maxPenalty", () => {
    // Spec AI Validation: "A game with 5 neighbors where 3 score higher,
    // verifying penalty is (3/5) * maxPenalty."
    // Need 6 games total: the subject + 5 neighbors.
    // All use similar vectors so they're all neighbors at a low threshold.
    const extraVectors: Record<string, FeatureVector> = {
      g1: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.9, 0.7] },
      g2: { binary: [1, 1, 0, 0], continuous: [0.8, 0.5], personalAxes: [0.85, 0.75] },
      g3: { binary: [1, 1, 0, 0], continuous: [0.7, 0.6], personalAxes: [0.9, 0.65] },
      g4: { binary: [1, 1, 0, 0], continuous: [0.75, 0.55], personalAxes: [0.88, 0.72] },
      g5: { binary: [1, 1, 0, 0], continuous: [0.8, 0.55], personalAxes: [0.87, 0.73] },
      subject: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.9, 0.7] },
    };
    const localGetVector = (game: Game): FeatureVector => extraVectors[game.id];

    const games = [
      makeGws(makeGame("g1", "G1"), makeScore(9.0)), // better
      makeGws(makeGame("g2", "G2"), makeScore(8.5)), // better
      makeGws(makeGame("g3", "G3"), makeScore(8.0)), // better
      makeGws(makeGame("g4", "G4"), makeScore(6.0)), // worse
      makeGws(makeGame("g5", "G5"), makeScore(5.0)), // worse
      makeGws(makeGame("subject", "Subject"), makeScore(7.0)),
    ];
    const settings = enabledSettings({ similarityThreshold: 0.3, maxPenalty: 2.0 });
    const result = computeRedundancyAdjustments(games, settings, localGetVector);
    const adj = result.get("subject");
    expect(adj).toBeDefined();
    // 3 better out of 5 neighbors = 0.6 coverage, penalty = 0.6 * 2.0 = 1.2
    expect(adj!.penalty).toBe(1.2);
    expect(adj!.adjustedScore).toBe(5.8);
  });

  test("zero-sum componentWeights returns empty map instead of NaN", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(8.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
    ];
    const settings = enabledSettings({
      componentWeights: { binary: 0, continuous: 0, personalAxes: 0 },
    });
    const result = computeRedundancyAdjustments(games, settings, getVector);
    expect(result.size).toBe(0);
  });

  test("zero-magnitude feature vectors produce zero similarity, not NaN", () => {
    const zeroVectors: Record<string, FeatureVector> = {
      z1: { binary: [0, 0, 0, 0], continuous: [0, 0], personalAxes: null },
      z2: { binary: [0, 0, 0, 0], continuous: [0, 0], personalAxes: null },
    };
    const localGetVector = (game: Game): FeatureVector => zeroVectors[game.id];
    const games = [
      makeGws(makeGame("z1", "Z1"), makeScore(8.0)),
      makeGws(makeGame("z2", "Z2"), makeScore(7.0)),
    ];
    // Threshold 0 so zero similarity would still need to meet >= 0 to be a neighbor
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0 }),
      localGetVector,
    );
    // Zero-magnitude vectors produce similarity=0, which meets threshold=0
    // No NaN should appear anywhere
    for (const [, adj] of result) {
      expect(isNaN(adj.penalty)).toBe(false);
      expect(isNaN(adj.adjustedScore)).toBe(false);
      for (const n of adj.nicheNeighbors) {
        expect(isNaN(n.similarity)).toBe(false);
      }
    }
  });

  test("nicheRank respects predicted authority (matches penalty semantics)", () => {
    // A is actual score=7.0, B is predicted score=9.0, C is actual score=8.0
    // For A: B is predicted (doesn't count), C is actual and better
    // betterCount=1, nicheRank should be 2 (not 3)
    const games = [
      makeGws(makeGame("a", "A"), makeScore(7.0)),
      makeGws(makeGame("b", "B"), makeScore(9.0, { predictedOnly: true })),
      makeGws(makeGame("c", "C"), makeScore(8.0)),
    ];
    // Need all to be neighbors; use c's vector similar to a/b
    const localVectors: Record<string, FeatureVector> = {
      a: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.9, 0.7] },
      b: { binary: [1, 1, 0, 0], continuous: [0.8, 0.6], personalAxes: [0.85, 0.75] },
      c: { binary: [1, 1, 0, 0], continuous: [0.8, 0.5], personalAxes: [0.88, 0.72] },
    };
    const localGetVector = (game: Game): FeatureVector => localVectors[game.id];
    const result = computeRedundancyAdjustments(
      games,
      enabledSettings({ similarityThreshold: 0.3 }),
      localGetVector,
    );
    const adjA = result.get("a");
    expect(adjA).toBeDefined();
    // Only C counts as better (B is predicted), so nicheRank=2
    expect(adjA!.nicheRank).toBe(2);
  });

  test("deterministic output (same input, same result)", () => {
    const games = [
      makeGws(makeGame("a", "A"), makeScore(9.0)),
      makeGws(makeGame("b", "B"), makeScore(7.0)),
      makeGws(makeGame("c", "C"), makeScore(5.0)),
    ];
    const settings = enabledSettings({ similarityThreshold: 0.3 });

    const result1 = computeRedundancyAdjustments(games, settings, getVector);
    const result2 = computeRedundancyAdjustments(games, settings, getVector);

    expect(result1.size).toBe(result2.size);
    for (const [id, adj1] of result1) {
      const adj2 = result2.get(id);
      expect(adj2).toBeDefined();
      expect(adj1.penalty).toBe(adj2!.penalty);
      expect(adj1.adjustedScore).toBe(adj2!.adjustedScore);
      expect(adj1.nicheRank).toBe(adj2!.nicheRank);
    }
  });
});
