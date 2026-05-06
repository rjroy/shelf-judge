import { describe, expect, test } from "bun:test";
import { findKNearestForAxis } from "../../src/services/prediction-engine";
import type { ReferenceGameCandidate } from "../../src/services/prediction-engine";

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

// --- Tournament stability weighting ---

describe("tournament stability weighting in findKNearestForAxis", () => {
  test("higher tournamentStability produces higher effective similarity", () => {
    // Two candidates with identical base vectors and ratings,
    // differing only in tournamentStability.
    const target = [1, 0, 0.5];
    const candidates = [
      makeCandidate({
        gameId: "stable",
        vector: [1, 0, 0.5],
        ratings: { fun: 8 },
        tournamentStability: 1.2,
      }),
      makeCandidate({
        gameId: "unstable",
        vector: [1, 0, 0.5],
        ratings: { fun: 7 },
        tournamentStability: 1.0,
      }),
    ];

    const matches = findKNearestForAxis(target, candidates, "fun", 5, 0.0);

    expect(matches).toHaveLength(2);
    expect(matches[0].gameId).toBe("stable");
    expect(matches[0].similarity).toBeGreaterThan(matches[1].similarity);
  });

  test("tournamentStability is treated as a straight multiplier on base similarity", () => {
    // The stability factor and its capping are computed by the prediction service (Phase 4).
    // This test verifies that findKNearestForAxis treats the value as a simple multiplier.
    const target = [1, 0, 0.5];
    const candidates = [
      makeCandidate({
        gameId: "capped",
        vector: [1, 0, 0.5],
        ratings: { fun: 8 },
        tournamentStability: 1.2, // 1.0 + 0.2 boost cap
      }),
      makeCandidate({
        gameId: "default",
        vector: [1, 0, 0.5],
        ratings: { fun: 7 },
        tournamentStability: 1.0,
      }),
    ];

    const matches = findKNearestForAxis(target, candidates, "fun", 5, 0.0);

    // Effective similarity for "capped": cosine(identical) * 1.2 = 1.2
    // Effective similarity for "default": cosine(identical) * 1.0 = 1.0
    expect(matches[0].gameId).toBe("capped");
    expect(matches[0].similarity).toBeCloseTo(1.2, 5);
    expect(matches[1].similarity).toBeCloseTo(1.0, 5);
  });

  test("stability multiplier affects ordering among otherwise equal candidates", () => {
    const target = [0.8, 0.2, 0.6];
    const candidates = [
      makeCandidate({
        gameId: "low-stability",
        vector: [0.8, 0.2, 0.6],
        ratings: { fun: 6 },
        tournamentStability: 1.0,
      }),
      makeCandidate({
        gameId: "high-stability",
        vector: [0.8, 0.2, 0.6],
        ratings: { fun: 9 },
        tournamentStability: 1.15,
      }),
    ];

    const matches = findKNearestForAxis(target, candidates, "fun", 5, 0.0);

    expect(matches[0].gameId).toBe("high-stability");
  });
});
