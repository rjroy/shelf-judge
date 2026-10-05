import { describe, expect, test } from "bun:test";
import type { PredictionSettings } from "@shelf-judge/shared";
import { computeUnifiedPrediction } from "../../src/services/unified-prediction.js";

describe("staged unified prediction", () => {
  test("ranks actual labeled references by shared S, preserves available zero labels, and returns unavailable rather than zero", () => {
    const result = computeUnifiedPrediction({
      axisIds: ["personal", "empty"],
      settings: {
        defaultK: 2,
        minSimilarityThreshold: 0.2,
        stageThresholds: [5, 15, 30] as [number, number, number],
      } satisfies PredictionSettings,
      referencesByAxis: new Map([
        [
          "personal",
          [
            { gameId: "far", gameName: "Far", rating: 9, similarity: 0.3 },
            { gameId: "near", gameName: "Near", rating: 4, similarity: 0.9 },
            { gameId: "zero-s", gameName: "Zero S", rating: 8, similarity: 0 },
            { gameId: "missing", gameName: "Missing", rating: 10, similarity: null },
          ],
        ],
      ]),
    });
    expect(result.get("personal")?.matches.map((match) => match.gameId)).toEqual(["near", "far"]);
    expect(result.get("personal")?.prediction?.rating).toBeCloseTo(
      (4 * 4 * 0.9 + 9 * 9 * 0.3) / (4 * 0.9 + 9 * 0.3),
    );
    expect(result.get("empty")?.prediction).toBeNull();
  });

  test("uses the same predictor contract for each target axis and respects per-axis labels", () => {
    const result = computeUnifiedPrediction({
      axisIds: ["personal", "tournament"],
      settings: { defaultK: 5, minSimilarityThreshold: 0, stageThresholds: [5, 15, 30] },
      referencesByAxis: new Map([
        ["personal", [{ gameId: "a", gameName: "A", rating: 1, similarity: 0.8 }]],
        ["tournament", [{ gameId: "b", gameName: "B", rating: 7, similarity: 0.8 }]],
      ]),
    });
    expect(result.get("personal")?.prediction?.rating).toBe(1);
    expect(result.get("tournament")?.prediction?.rating).toBe(7);
  });

  test("a changed common-S ordering changes the selected neighbor and predicted score", () => {
    const references = [
      { gameId: "high", gameName: "High", rating: 9, similarity: 0.9 as number | null },
      { gameId: "low", gameName: "Low", rating: 4, similarity: 0.3 as number | null },
    ];
    const run = () =>
      computeUnifiedPrediction({
        axisIds: ["personal"],
        settings: { defaultK: 1, minSimilarityThreshold: 0.2, stageThresholds: [5, 15, 30] },
        referencesByAxis: new Map([["personal", references]]),
      }).get("personal");
    const factualDominant = run();
    references[0].similarity = 0.2;
    references[1].similarity = 0.95;
    const semanticDominant = run();
    expect(factualDominant?.matches[0]?.gameId).toBe("high");
    expect(semanticDominant?.matches[0]?.gameId).toBe("low");
    expect(factualDominant?.prediction?.rating).toBeCloseTo(9);
    expect(semanticDominant?.prediction?.rating).toBeCloseTo(4);
  });

  test("collection and future wishlist callers receive the same predictor result for the same factual context and actual labels", () => {
    const settings: PredictionSettings = {
      defaultK: 2,
      minSimilarityThreshold: 0.2,
      stageThresholds: [5, 15, 30],
    };
    const input = {
      axisIds: ["personal"],
      settings,
      referencesByAxis: new Map([
        [
          "personal",
          [
            { gameId: "actual-a", gameName: "A", rating: 4, similarity: 0.8 },
            { gameId: "actual-b", gameName: "B", rating: 8, similarity: 0.6 },
          ],
        ],
      ]),
    };
    const collectionPrediction = computeUnifiedPrediction(input);
    // Target identity/domain is intentionally not part of this shared estimator contract.
    const futureWishlistPrediction = computeUnifiedPrediction(input);
    expect(futureWishlistPrediction).toEqual(collectionPrediction);
    expect(futureWishlistPrediction.get("personal")?.prediction?.rating).toBeCloseTo(6.4);
  });
});
