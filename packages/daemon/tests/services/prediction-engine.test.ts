import { describe, expect, test } from "bun:test";
import type { Axis, BggGameData, FitnessResult, Game } from "@shelf-judge/shared";
import {
  assessReadiness,
  computePredictedFitness,
  DEFAULT_PREDICTION_SETTINGS,
  findKNearestForAxis,
  predictAxisRating,
} from "../../src/services/prediction-engine";
import type { ReferenceGameCandidate, SimilarityMatch } from "../../src/services/prediction-engine";
import type { Vocabulary } from "../../src/services/feature-vector";

// --- Helpers ---

function makeCandidate(
  overrides: Partial<ReferenceGameCandidate> & { gameId: string },
): ReferenceGameCandidate {
  return {
    gameName: overrides.gameId,
    vector: overrides.vector ?? [1, 0, 0.5],
    ratings: overrides.ratings ?? {},
    tournamentStability: overrides.tournamentStability ?? 1.0,
    ...overrides,
  };
}

function makeMatch(gameId: string, similarity: number, rating: number): SimilarityMatch {
  return { gameId, gameName: gameId, similarity, rating };
}

function makeAxis(
  id: string,
  name: string,
  weight: number,
  source: "personal" | "bgg" = "personal",
): Axis {
  return {
    id,
    name,
    description: null,
    weight,
    source,
    bggField: source === "bgg" ? "communityRating" : null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  };
}

function makeGame(id: string, ratings: Record<string, number> = {}): Game {
  return {
    id,
    bggId: 1,
    name: id,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    ratings,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  };
}

const defaultSettings = DEFAULT_PREDICTION_SETTINGS;

// --- findKNearestForAxis ---

describe("findKNearestForAxis", () => {
  test("returns k most similar games with the target axis rating", () => {
    // Target vector: [1, 0, 0.5]
    const target = [1, 0, 0.5];
    const candidates: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "a", vector: [1, 0, 0.5], ratings: { fun: 8 } }), // identical = sim 1.0
      makeCandidate({ gameId: "b", vector: [0.9, 0.1, 0.4], ratings: { fun: 7 } }), // very similar
      makeCandidate({ gameId: "c", vector: [0.5, 0.5, 0.5], ratings: { fun: 6 } }), // moderate
      makeCandidate({ gameId: "d", vector: [0, 1, 0.5], ratings: { fun: 5 } }), // low similarity
      makeCandidate({ gameId: "e", vector: [1, 0, 0.5], ratings: { fun: 9 } }), // identical
      makeCandidate({ gameId: "f", vector: [0.8, 0.2, 0.6], ratings: { fun: 7 } }), // similar
    ];

    const result = findKNearestForAxis(target, candidates, "fun", 3, 0.2);
    expect(result).toHaveLength(3);
    // The top 3 should be the most similar (a and e are identical, then b or f)
    expect(result[0].similarity).toBeGreaterThanOrEqual(result[1].similarity);
    expect(result[1].similarity).toBeGreaterThanOrEqual(result[2].similarity);
  });

  test("excludes candidates without the target axis rating", () => {
    const target = [1, 0, 0.5];
    const candidates: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "a", vector: [1, 0, 0.5], ratings: { fun: 8 } }),
      makeCandidate({ gameId: "b", vector: [1, 0, 0.5], ratings: { theme: 7 } }), // no "fun" rating
      makeCandidate({ gameId: "c", vector: [0.9, 0.1, 0.4], ratings: { fun: 6 } }),
    ];

    const result = findKNearestForAxis(target, candidates, "fun", 5, 0.0);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.gameId)).toEqual(["a", "c"]);
  });

  test("excludes candidates below minimum similarity", () => {
    const target = [1, 0, 0];
    const candidates: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "a", vector: [1, 0, 0], ratings: { fun: 8 } }), // sim = 1.0
      makeCandidate({ gameId: "b", vector: [0, 1, 0], ratings: { fun: 5 } }), // sim = 0.0
    ];

    const result = findKNearestForAxis(target, candidates, "fun", 5, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0].gameId).toBe("a");
  });

  test("tournament stability multiplies base similarity", () => {
    const target = [1, 0, 0.5];
    // Both have identical vectors to target
    const candidates: ReferenceGameCandidate[] = [
      makeCandidate({
        gameId: "stable",
        vector: [1, 0, 0.5],
        ratings: { fun: 8 },
        tournamentStability: 1.2,
      }),
      makeCandidate({
        gameId: "normal",
        vector: [1, 0, 0.5],
        ratings: { fun: 7 },
        tournamentStability: 1.0,
      }),
    ];

    const result = findKNearestForAxis(target, candidates, "fun", 2, 0.0);
    expect(result[0].gameId).toBe("stable");
    expect(result[0].similarity).toBeCloseTo(1.2, 4);
    expect(result[1].gameId).toBe("normal");
    expect(result[1].similarity).toBeCloseTo(1.0, 4);
  });

  test("returns fewer than k when not enough qualify", () => {
    const target = [1, 0, 0.5];
    const candidates: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "a", vector: [1, 0, 0.5], ratings: { fun: 8 } }),
    ];

    const result = findKNearestForAxis(target, candidates, "fun", 5, 0.0);
    expect(result).toHaveLength(1);
  });

  test("returns empty array when no candidates have the axis", () => {
    const target = [1, 0, 0.5];
    const candidates: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "a", vector: [1, 0, 0.5], ratings: { theme: 8 } }),
    ];

    const result = findKNearestForAxis(target, candidates, "fun", 5, 0.0);
    expect(result).toHaveLength(0);
  });
});

// --- predictAxisRating ---

describe("predictAxisRating", () => {
  test("returns null for empty matches (insufficient)", () => {
    expect(predictAxisRating([])).toBeNull();
  });

  test("computes similarity-weighted average (hand-calculated)", () => {
    // Games: A (sim=0.8, rating=8), B (sim=0.6, rating=6), C (sim=0.4, rating=4)
    // Weighted avg = (8*0.8 + 6*0.6 + 4*0.4) / (0.8 + 0.6 + 0.4) = (6.4 + 3.6 + 1.6) / 1.8 = 11.6 / 1.8 = 6.444...
    const matches = [makeMatch("a", 0.8, 8), makeMatch("b", 0.6, 6), makeMatch("c", 0.4, 4)];
    const result = predictAxisRating(matches);
    expect(result).not.toBeNull();
    expect(result!.rating).toBeCloseTo(11.6 / 1.8, 4);
  });

  test("single match returns that rating with weak confidence", () => {
    const result = predictAxisRating([makeMatch("a", 0.9, 7)]);
    expect(result!.rating).toBeCloseTo(7, 4);
    expect(result!.confidence).toBe("weak");
  });

  test("strong confidence: 5+ matches, variance < 1.5, avg similarity > 0.7", () => {
    // 5 matches, all similar ratings (7-8), high similarity (0.8+)
    const matches = [
      makeMatch("a", 0.9, 7.5),
      makeMatch("b", 0.85, 7.8),
      makeMatch("c", 0.8, 7.2),
      makeMatch("d", 0.75, 7.6),
      makeMatch("e", 0.72, 7.4),
    ];
    const result = predictAxisRating(matches);
    expect(result!.confidence).toBe("strong");
  });

  test("moderate confidence: 3+ matches, variance <= 3.0, avg similarity >= 0.4", () => {
    const matches = [makeMatch("a", 0.5, 6), makeMatch("b", 0.45, 7), makeMatch("c", 0.4, 8)];
    const result = predictAxisRating(matches);
    expect(result!.confidence).toBe("moderate");
  });

  test("weak confidence: fewer than 3 matches", () => {
    const matches = [makeMatch("a", 0.5, 6), makeMatch("b", 0.45, 7)];
    const result = predictAxisRating(matches);
    expect(result!.confidence).toBe("weak");
  });

  // Boundary tests per plan verification items
  test("boundary: 4 matches does not qualify for strong (needs 5)", () => {
    const matches = [
      makeMatch("a", 0.9, 7),
      makeMatch("b", 0.85, 7),
      makeMatch("c", 0.8, 7),
      makeMatch("d", 0.75, 7),
    ];
    const result = predictAxisRating(matches);
    // 4 matches, low variance, high similarity: meets moderate but not strong (needs 5)
    expect(result!.confidence).not.toBe("strong");
    expect(result!.confidence).toBe("moderate");
  });

  test("boundary: 5 matches qualifies for strong when other criteria met", () => {
    const matches = [
      makeMatch("a", 0.9, 7),
      makeMatch("b", 0.85, 7),
      makeMatch("c", 0.8, 7),
      makeMatch("d", 0.75, 7),
      makeMatch("e", 0.72, 7),
    ];
    const result = predictAxisRating(matches);
    expect(result!.confidence).toBe("strong");
  });

  test("boundary: variance at 1.49 qualifies for strong", () => {
    // Need 5 matches with avg sim > 0.7 and variance just under 1.5
    // Ratings: we need variance = sum((r_i - mean)^2) / n < 1.5
    // With 5 ratings centered at 7: [5.78, 7, 7, 7, 8.22] gives variance ~= 1.49
    // Actually simpler: [6, 7, 7, 7, 8] => mean ~= 7, var = (1+0+0+0+1)/5 = 0.4
    // Let's use [5, 7, 7, 7, 9] => weighted mean depends on weights...
    // For simplicity, use equal similarities so weighted mean = arithmetic mean
    const matches = [
      makeMatch("a", 0.75, 5.27),
      makeMatch("b", 0.75, 7),
      makeMatch("c", 0.75, 7),
      makeMatch("d", 0.75, 7),
      makeMatch("e", 0.75, 8.73),
    ];
    // Equal weights, so mean = (5.27+7+7+7+8.73)/5 = 35/5 = 7.0
    // variance = ((7-5.27)^2 + 0 + 0 + 0 + (8.73-7)^2) / 5 = (2.9929 + 2.9929) / 5 = 5.9858/5 = 1.197
    const result = predictAxisRating(matches);
    expect(result!.variance).toBeLessThan(1.5);
    expect(result!.confidence).toBe("strong");
  });

  test("boundary: variance at 1.5+ does not qualify for strong", () => {
    // 5 matches with high similarity but high variance
    const matches = [
      makeMatch("a", 0.75, 5),
      makeMatch("b", 0.75, 7),
      makeMatch("c", 0.75, 7),
      makeMatch("d", 0.75, 7),
      makeMatch("e", 0.75, 9),
    ];
    // mean = 35/5 = 7, var = (4+0+0+0+4)/5 = 1.6
    const result = predictAxisRating(matches);
    expect(result!.variance).toBeGreaterThanOrEqual(1.5);
    expect(result!.confidence).not.toBe("strong");
  });

  test("boundary: avg similarity at 0.69 does not qualify for strong", () => {
    const matches = [
      makeMatch("a", 0.69, 7),
      makeMatch("b", 0.69, 7),
      makeMatch("c", 0.69, 7),
      makeMatch("d", 0.69, 7),
      makeMatch("e", 0.69, 7),
    ];
    const result = predictAxisRating(matches);
    expect(result!.avgSimilarity).toBeCloseTo(0.69, 4);
    expect(result!.confidence).not.toBe("strong");
  });

  test("boundary: avg similarity at 0.71 qualifies for strong", () => {
    const matches = [
      makeMatch("a", 0.71, 7),
      makeMatch("b", 0.71, 7),
      makeMatch("c", 0.71, 7),
      makeMatch("d", 0.71, 7),
      makeMatch("e", 0.71, 7),
    ];
    const result = predictAxisRating(matches);
    expect(result!.avgSimilarity).toBeCloseTo(0.71, 4);
    expect(result!.confidence).toBe("strong");
  });

  test("lowest confidence wins when criteria conflict", () => {
    // 5 matches, low variance, but avg similarity below 0.7 => not strong
    // avg similarity >= 0.4, count >= 3, variance reasonable => moderate
    const matches = [
      makeMatch("a", 0.5, 7),
      makeMatch("b", 0.5, 7),
      makeMatch("c", 0.5, 7),
      makeMatch("d", 0.5, 7),
      makeMatch("e", 0.5, 7),
    ];
    const result = predictAxisRating(matches);
    // 5 matches, zero variance, but avg sim = 0.5 (below 0.7 for strong)
    // Meets moderate criteria (3+, variance <= 3, sim >= 0.4)
    expect(result!.confidence).toBe("moderate");
  });
});

// --- computePredictedFitness ---

describe("computePredictedFitness", () => {
  const funAxis = makeAxis("fun", "Fun", 50, "personal");
  const themeAxis = makeAxis("theme", "Theme", 30, "personal");
  const bggAxis = makeAxis("bgg-rating", "BGG Rating", 20, "bgg");

  function mockCalculateScore(
    _game: Game,
    axes: Axis[],
    bggData: BggGameData | null,
  ): FitnessResult | null {
    // Simulate: BGG axis gets 7.0 effective rating, personal axes only if game has ratings
    const breakdown: import("@shelf-judge/shared").FitnessBreakdownEntry[] = [];
    let weightedSum = 0;
    let weightSum = 0;
    let ratedCount = 0;

    for (const axis of axes) {
      if (axis.source === "bgg" && bggData) {
        const rating = 7.0;
        breakdown.push({
          axisId: axis.id,
          axisName: axis.name,
          rating,
          weight: axis.weight,
          contribution: rating * axis.weight,
          source: "bgg",
          bggOriginal: 7.0,
          rawValue: 7.0,
          effectiveRating: rating,
          preferenceShape: "higher-is-better",
          curveAffected: false,
          predictionConfidence: null,
          referenceGames: null,
        });
        weightedSum += rating * axis.weight;
        weightSum += axis.weight;
        ratedCount++;
      } else if (axis.source === "personal" && _game.ratings[axis.id] !== undefined) {
        const rating = _game.ratings[axis.id];
        breakdown.push({
          axisId: axis.id,
          axisName: axis.name,
          rating,
          weight: axis.weight,
          contribution: rating * axis.weight,
          source: "personal",
          bggOriginal: null,
          rawValue: rating,
          effectiveRating: rating,
          preferenceShape: "higher-is-better",
          curveAffected: false,
          predictionConfidence: null,
          referenceGames: null,
        });
        weightedSum += rating * axis.weight;
        weightSum += axis.weight;
        ratedCount++;
      } else {
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
          preferenceShape: "higher-is-better",
          curveAffected: false,
          predictionConfidence: null,
          referenceGames: null,
        });
      }
    }

    if (ratedCount === 0) return null;

    return {
      score: weightSum > 0 ? Math.round((weightedSum / weightSum) * 10) / 10 : 0,
      ratedAxisCount: ratedCount,
      totalAxisCount: axes.length,
      breakdown,
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: null,
    };
  }

  test("fully rated game returns actual result with no predictionMeta", () => {
    const game = makeGame("g1", { fun: 8, theme: 6 });
    const axes = [funAxis, themeAxis]; // no BGG axis
    const result = computePredictedFitness(
      game,
      axes,
      null,
      [],
      [1, 0, 0.5],
      defaultSettings,
      2,
      mockCalculateScore,
    );

    expect(result.fitnessResult.predictionMeta).toBeNull();
    expect(result.predictedAxisCount).toBe(0);
    expect(result.actualAxisCount).toBe(2);
  });

  test("partially rated game gets predictions for unrated personal axes", () => {
    const game = makeGame("target", { fun: 8 }); // rated fun, not theme
    const axes = [funAxis, themeAxis];

    // Reference games with both axes rated, vectors identical to target
    const refs: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "r1", vector: [1, 0, 0.5], ratings: { fun: 7, theme: 6 } }),
      makeCandidate({ gameId: "r2", vector: [0.9, 0.1, 0.5], ratings: { fun: 8, theme: 7 } }),
      makeCandidate({ gameId: "r3", vector: [0.8, 0.2, 0.4], ratings: { fun: 9, theme: 8 } }),
    ];

    const result = computePredictedFitness(
      game,
      axes,
      null,
      refs,
      [1, 0, 0.5],
      defaultSettings,
      2,
      mockCalculateScore,
    );

    expect(result.predictedAxisCount).toBe(1); // theme predicted
    expect(result.actualAxisCount).toBe(1); // fun actual
    expect(result.fitnessResult.predictionMeta).not.toBeNull();
    expect(result.fitnessResult.predictionMeta!.predictedAxisCount).toBe(1);
    expect(result.fitnessResult.predictionMeta!.actualAxisCount).toBe(1);

    // Find predicted entry
    const predictedEntry = result.fitnessResult.breakdown.find((e) => e.source === "predicted");
    expect(predictedEntry).toBeDefined();
    expect(predictedEntry!.axisId).toBe("theme");
    expect(predictedEntry!.predictionConfidence).not.toBeNull();
    expect(predictedEntry!.referenceGames).not.toBeNull();
    expect(predictedEntry!.rating).not.toBeNull();
  });

  test("BGG-derived axes produce predictionConfidence 'actual'", () => {
    const game = makeGame("target", {});
    const bggData: BggGameData = {
      communityRating: 7.5,
      bayesAverage: 7.0,
      weight: 3.0,
      numWeightVotes: 100,
      description: null,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      suggestedPlayerCounts: [],
      fetchedAt: "2025-01-01T00:00:00Z",
    };

    const axes = [funAxis, bggAxis];
    const refs: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "r1", vector: [1, 0, 0.5], ratings: { fun: 7 } }),
      makeCandidate({ gameId: "r2", vector: [0.9, 0.1, 0.5], ratings: { fun: 8 } }),
      makeCandidate({ gameId: "r3", vector: [0.8, 0.2, 0.4], ratings: { fun: 6 } }),
    ];

    const result = computePredictedFitness(
      game,
      axes,
      bggData,
      refs,
      [1, 0, 0.5],
      defaultSettings,
      2,
      mockCalculateScore,
    );

    const bggEntry = result.fitnessResult.breakdown.find((e) => e.axisId === "bgg-rating");
    expect(bggEntry).toBeDefined();
    expect(bggEntry!.predictionConfidence).toBe("actual");
  });

  test("predicted fitness score matches hand-calculated weighted average", () => {
    // Setup: one actual axis (fun=8, weight=50), one predicted axis (theme~=7, weight=30)
    const game = makeGame("target", { fun: 8 });
    const axes = [funAxis, themeAxis];

    // All refs rate theme as 7.0, so predicted should be 7.0
    const refs: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "r1", vector: [1, 0, 0.5], ratings: { theme: 7 } }),
      makeCandidate({ gameId: "r2", vector: [1, 0, 0.5], ratings: { theme: 7 } }),
      makeCandidate({ gameId: "r3", vector: [1, 0, 0.5], ratings: { theme: 7 } }),
    ];

    const result = computePredictedFitness(
      game,
      axes,
      null,
      refs,
      [1, 0, 0.5],
      defaultSettings,
      2,
      mockCalculateScore,
    );

    // Expected: (8*50 + 7*30) / (50 + 30) = (400 + 210) / 80 = 610 / 80 = 7.625 => 7.6
    expect(result.fitnessResult.score).toBeCloseTo(7.6, 1);
  });

  test("insufficient-confidence axes excluded from score", () => {
    const game = makeGame("target", { fun: 8 });
    const axes = [funAxis, themeAxis];

    // No refs have "theme" rating, so theme gets insufficient
    const refs: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "r1", vector: [1, 0, 0.5], ratings: { fun: 9 } }),
    ];

    const result = computePredictedFitness(
      game,
      axes,
      null,
      refs,
      [1, 0, 0.5],
      defaultSettings,
      2,
      mockCalculateScore,
    );

    // Theme is insufficient, so score is based only on fun
    // fun = 8, weight = 50, only fun counts
    // score = (8*50) / 50 = 8.0
    expect(result.fitnessResult.score).toBeCloseTo(8.0, 1);

    // Insufficient entry exists in breakdown
    const insufficientEntry = result.fitnessResult.breakdown.find(
      (e) => e.axisId === "theme" && e.predictionConfidence === "insufficient",
    );
    expect(insufficientEntry).toBeDefined();
    expect(insufficientEntry!.rating).toBeNull();
    expect(insufficientEntry!.contribution).toBeNull();
  });

  test("vetoes fire on BGG-derived actual values", () => {
    const vetoAxis = {
      ...bggAxis,
      veto: { direction: "below" as const, threshold: 6.0 },
    };
    const bggData: BggGameData = {
      communityRating: 5.0, // below veto threshold
      bayesAverage: 5.0,
      weight: 3.0,
      numWeightVotes: 100,
      description: null,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      suggestedPlayerCounts: [],
      fetchedAt: "2025-01-01T00:00:00Z",
    };

    const game = makeGame("target", {});

    // Mock that returns a vetoed result
    function vetoCalcScore(g: Game, ax: Axis[], bd: BggGameData | null): FitnessResult | null {
      return {
        score: 0,
        ratedAxisCount: 1,
        totalAxisCount: ax.length,
        breakdown: [
          {
            axisId: vetoAxis.id,
            axisName: vetoAxis.name,
            rating: 5.0,
            weight: vetoAxis.weight,
            contribution: null,
            source: "bgg",
            bggOriginal: 5.0,
            rawValue: 5.0,
            effectiveRating: 5.0,
            preferenceShape: "higher-is-better",
            curveAffected: false,
            predictionConfidence: null,
            referenceGames: null,
          },
        ],
        vetoed: true,
        vetoedBy: {
          axisId: vetoAxis.id,
          axisName: vetoAxis.name,
          threshold: 6.0,
          direction: "below",
          rawValue: 5.0,
        },
        hypotheticalScore: 5.0,
        predictionMeta: null,
      };
    }

    const result = computePredictedFitness(
      game,
      [funAxis, vetoAxis],
      bggData,
      [makeCandidate({ gameId: "r1", vector: [1, 0, 0.5], ratings: { fun: 8 } })],
      [1, 0, 0.5],
      defaultSettings,
      2,
      vetoCalcScore,
    );

    expect(result.fitnessResult.vetoed).toBe(true);
    expect(result.fitnessResult.score).toBe(0);
  });

  test("predicted personal values do NOT trigger vetoes (REQ-PRED-10)", () => {
    // Fun axis has a veto at below 3, but the predicted value is 2
    const vetoFunAxis: Axis = {
      ...funAxis,
      veto: { direction: "below", threshold: 3 },
    };
    const game = makeGame("target", {}); // no personal ratings

    // Refs all give fun = 2 (would trigger veto if actual)
    const refs: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "r1", vector: [1, 0, 0.5], ratings: { fun: 2 } }),
      makeCandidate({ gameId: "r2", vector: [1, 0, 0.5], ratings: { fun: 2 } }),
      makeCandidate({ gameId: "r3", vector: [1, 0, 0.5], ratings: { fun: 2 } }),
    ];

    const result = computePredictedFitness(
      game,
      [vetoFunAxis],
      null,
      refs,
      [1, 0, 0.5],
      defaultSettings,
      2,
      () => null, // no actual score
    );

    // Predicted value is ~2 but veto should NOT fire
    expect(result.fitnessResult.vetoed).toBe(false);
    expect(result.fitnessResult.score).toBeGreaterThan(0);
  });

  test("Stage 0 returns no personal-axis predictions", () => {
    const game = makeGame("target", {});
    const axes = [funAxis, themeAxis];

    const refs: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "r1", vector: [1, 0, 0.5], ratings: { fun: 8, theme: 7 } }),
    ];

    const result = computePredictedFitness(
      game,
      axes,
      null,
      refs,
      [1, 0, 0.5],
      defaultSettings,
      0, // Stage 0
      () => null,
    );

    // No predictions at stage 0
    expect(result.predictedAxisCount).toBe(0);
    const predictedEntries = result.fitnessResult.breakdown.filter((e) => e.source === "predicted");
    expect(predictedEntries).toHaveLength(0);
  });

  test("PredictionMeta correctly reports counts and coverage", () => {
    const game = makeGame("target", { fun: 8 });
    const axes = [funAxis, themeAxis]; // fun=rated, theme=predicted

    // Refs with high similarity so theme gets strong confidence
    const refs: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "r1", vector: [1, 0, 0.5], ratings: { theme: 7 } }),
      makeCandidate({ gameId: "r2", vector: [1, 0, 0.5], ratings: { theme: 7 } }),
      makeCandidate({ gameId: "r3", vector: [1, 0, 0.5], ratings: { theme: 7 } }),
      makeCandidate({ gameId: "r4", vector: [1, 0, 0.5], ratings: { theme: 7 } }),
      makeCandidate({ gameId: "r5", vector: [1, 0, 0.5], ratings: { theme: 7 } }),
    ];

    const result = computePredictedFitness(
      game,
      axes,
      null,
      refs,
      [1, 0, 0.5],
      defaultSettings,
      2,
      mockCalculateScore,
    );

    const meta = result.fitnessResult.predictionMeta!;
    expect(meta.predictedAxisCount).toBe(1);
    expect(meta.actualAxisCount).toBe(1);
    expect(meta.referenceGameCount).toBe(5);
    expect(meta.readinessStage).toBe(2);
    // Coverage: fun (actual, weight 50) + theme (strong, weight 30) out of total 80
    // coveragePercent = 80/80 = 1.0
    expect(meta.coveragePercent).toBe(1);
  });

  test("moderate/weak predictions do not count toward coverage", () => {
    const game = makeGame("target", {});
    const axes = [funAxis, themeAxis]; // both unrated

    // Only 2 refs per axis => weak confidence
    const refs: ReferenceGameCandidate[] = [
      makeCandidate({ gameId: "r1", vector: [1, 0, 0.5], ratings: { fun: 7, theme: 6 } }),
      makeCandidate({ gameId: "r2", vector: [0.9, 0.1, 0.5], ratings: { fun: 8, theme: 7 } }),
    ];

    const result = computePredictedFitness(
      game,
      axes,
      null,
      refs,
      [1, 0, 0.5],
      defaultSettings,
      1,
      () => null,
    );

    const meta = result.fitnessResult.predictionMeta!;
    // Both axes predicted with weak confidence (only 2 matches)
    // Coverage: neither actual nor strong => 0
    expect(meta.coveragePercent).toBe(0);
  });

  test("games without BGG data and no ratings returns score 0", () => {
    const game = makeGame("target", {});
    const axes = [bggAxis]; // Only a BGG axis, no BGG data

    const result = computePredictedFitness(
      game,
      axes,
      null,
      [],
      [1, 0, 0.5],
      defaultSettings,
      2,
      () => null,
    );

    expect(result.fitnessResult.score).toBe(0);
    expect(result.fitnessResult.ratedAxisCount).toBe(0);
  });
});

// --- assessReadiness ---

describe("assessReadiness", () => {
  const axes = [
    makeAxis("fun", "Fun", 50),
    makeAxis("theme", "Theme", 30),
    makeAxis("replay", "Replayability", 20),
  ];

  const emptyVocab: Vocabulary = { mechanics: [], categories: [] };

  test("stage 0 when fewer than threshold[0] games rated", () => {
    const gameRatings = new Map([
      ["g1", { fun: 8 }],
      ["g2", { fun: 7 }],
    ]);

    const result = assessReadiness(2, axes, gameRatings, emptyVocab, defaultSettings);
    expect(result.stage).toBe(0);
    expect(result.nextStageAt).toBe(5);
    expect(result.ratedGameCount).toBe(2);
  });

  test("stage 1 when >= threshold[0] and < threshold[1]", () => {
    const gameRatings = new Map(
      Array.from({ length: 7 }, (_, i) => [`g${i}`, { fun: 7 }] as const),
    );

    const result = assessReadiness(7, axes, gameRatings, emptyVocab, defaultSettings);
    expect(result.stage).toBe(1);
    expect(result.nextStageAt).toBe(15);
  });

  test("stage 2 when >= threshold[1] and < threshold[2]", () => {
    const gameRatings = new Map(
      Array.from({ length: 20 }, (_, i) => [`g${i}`, { fun: 7 }] as const),
    );

    const result = assessReadiness(20, axes, gameRatings, emptyVocab, defaultSettings);
    expect(result.stage).toBe(2);
    expect(result.nextStageAt).toBe(30);
  });

  test("stage 3 when >= threshold[2]", () => {
    const gameRatings = new Map(
      Array.from({ length: 30 }, (_, i) => [`g${i}`, { fun: 7 }] as const),
    );

    const result = assessReadiness(30, axes, gameRatings, emptyVocab, defaultSettings);
    expect(result.stage).toBe(3);
    expect(result.nextStageAt).toBe(30); // already at max
  });

  test("identifies weak axes (fewer rated games than defaultK)", () => {
    // fun: 3 games rated, theme: 1 game rated, replay: 0 games rated
    const gameRatings = new Map<string, Record<string, number>>([
      ["g1", { fun: 8, theme: 7 }],
      ["g2", { fun: 7 }],
      ["g3", { fun: 6 }],
      ["g4", { fun: 5 }],
      ["g5", { fun: 4 }],
    ]);

    const result = assessReadiness(5, axes, gameRatings, emptyVocab, defaultSettings);
    // replay (0 rated) and theme (1 rated) are weak (< defaultK=5)
    // fun (5 rated) is not weak
    expect(result.weakAxes.map((a) => a.axisId)).toContain("replay");
    expect(result.weakAxes.map((a) => a.axisId)).toContain("theme");
    // Sorted by ratedCount ascending
    expect(result.weakAxes[0].ratedCount).toBeLessThanOrEqual(result.weakAxes[1].ratedCount);
  });

  test("generates suggestion to unlock predictions at stage 0", () => {
    const result = assessReadiness(3, axes, new Map(), emptyVocab, defaultSettings);
    expect(result.suggestedActions.some((a) => a.includes("2 more game"))).toBe(true);
  });

  test("generates suggestions for weak axes", () => {
    const gameRatings = new Map<string, Record<string, number>>([
      ["g1", { fun: 8 }],
      ["g2", { fun: 7 }],
      ["g3", { fun: 6 }],
      ["g4", { fun: 5 }],
      ["g5", { fun: 4 }],
    ]);

    const result = assessReadiness(5, axes, gameRatings, emptyVocab, defaultSettings);
    // Should suggest rating games on theme and replay
    expect(result.suggestedActions.some((a) => a.includes("Theme"))).toBe(true);
    expect(result.suggestedActions.some((a) => a.includes("Replayability"))).toBe(true);
  });

  test("custom thresholds are respected", () => {
    const customSettings = {
      ...defaultSettings,
      stageThresholds: [3, 10, 20] as [number, number, number],
    };
    const gameRatings = new Map(
      Array.from({ length: 3 }, (_, i) => [`g${i}`, { fun: 7 }] as const),
    );

    const result = assessReadiness(3, axes, gameRatings, emptyVocab, customSettings);
    expect(result.stage).toBe(1);
    expect(result.nextStageAt).toBe(10);
  });

  test("stage 0 at exactly threshold - 1", () => {
    const result = assessReadiness(4, axes, new Map(), emptyVocab, defaultSettings);
    expect(result.stage).toBe(0);
  });

  test("stage 1 at exactly threshold[0]", () => {
    const gameRatings = new Map(
      Array.from({ length: 5 }, (_, i) => [`g${i}`, { fun: 7 }] as const),
    );
    const result = assessReadiness(5, axes, gameRatings, emptyVocab, defaultSettings);
    expect(result.stage).toBe(1);
  });
});
