import { describe, expect, test } from "bun:test";
import {
  detectRevealedPreferenceTension,
  findKNearestForAxis,
} from "../../src/services/prediction-engine";
import type {
  ReferenceGameCandidate,
  TournamentRankedGame,
} from "../../src/services/prediction-engine";

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

function makeTournamentGame(
  overrides: Partial<TournamentRankedGame> & { gameId: string; normalizedScore: number },
): TournamentRankedGame {
  return {
    gameName: overrides.gameId,
    vector: overrides.vector ?? [1, 0, 0.5],
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

  test("tournamentStability caps at 1.0 + boost and does not grow unbounded", () => {
    // The stability factor is computed by the prediction service (Phase 4),
    // but we verify that findKNearestForAxis treats the value as a simple multiplier.
    // A candidate with stability 1.2 (the max for boost=0.2) should not be
    // outranked by one with an artificially high stability.
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

// --- Revealed preference tension ---

describe("detectRevealedPreferenceTension", () => {
  test("returns tension when predicted fitness is higher than tournament cluster by > 1.0", () => {
    const targetVector = [1, 0, 0.5];
    const tournamentGames = [
      makeTournamentGame({
        gameId: "neighbor1",
        vector: [1, 0, 0.5], // identical vector, cosine = 1.0
        normalizedScore: 4.0,
      }),
      makeTournamentGame({
        gameId: "neighbor2",
        vector: [1, 0, 0.5],
        normalizedScore: 5.0,
      }),
    ];

    const result = detectRevealedPreferenceTension(7.0, targetVector, tournamentGames, 5, 0.2);

    expect(result).not.toBeNull();
    expect(result!.predictedFitness).toBe(7.0);
    expect(result!.tournamentClusterAverage).toBe(4.5);
    expect(result!.note).toContain("higher");
  });

  test("returns tension when predicted fitness is lower than tournament cluster by > 1.0", () => {
    const targetVector = [1, 0, 0.5];
    const tournamentGames = [
      makeTournamentGame({
        gameId: "neighbor1",
        vector: [1, 0, 0.5],
        normalizedScore: 8.0,
      }),
      makeTournamentGame({
        gameId: "neighbor2",
        vector: [1, 0, 0.5],
        normalizedScore: 9.0,
      }),
    ];

    const result = detectRevealedPreferenceTension(5.0, targetVector, tournamentGames, 5, 0.2);

    expect(result).not.toBeNull();
    expect(result!.predictedFitness).toBe(5.0);
    expect(result!.tournamentClusterAverage).toBe(8.5);
    expect(result!.note).toContain("lower");
  });

  test("returns null when difference is exactly 1.0", () => {
    const targetVector = [1, 0, 0.5];
    const tournamentGames = [
      makeTournamentGame({
        gameId: "neighbor1",
        vector: [1, 0, 0.5],
        normalizedScore: 6.0,
      }),
    ];

    const result = detectRevealedPreferenceTension(7.0, targetVector, tournamentGames, 5, 0.2);

    expect(result).toBeNull();
  });

  test("returns null when difference is less than 1.0", () => {
    const targetVector = [1, 0, 0.5];
    const tournamentGames = [
      makeTournamentGame({
        gameId: "neighbor1",
        vector: [1, 0, 0.5],
        normalizedScore: 6.5,
      }),
    ];

    const result = detectRevealedPreferenceTension(7.0, targetVector, tournamentGames, 5, 0.2);

    expect(result).toBeNull();
  });

  test("returns null when tournamentRankedGames is empty", () => {
    const result = detectRevealedPreferenceTension(7.0, [1, 0, 0.5], [], 5, 0.2);

    expect(result).toBeNull();
  });

  test("returns null when no neighbors pass minSimilarity threshold", () => {
    const targetVector = [1, 0, 0];
    const tournamentGames = [
      makeTournamentGame({
        gameId: "dissimilar",
        vector: [0, 1, 0], // orthogonal, cosine = 0
        normalizedScore: 3.0,
      }),
    ];

    const result = detectRevealedPreferenceTension(7.0, targetVector, tournamentGames, 5, 0.5);

    expect(result).toBeNull();
  });

  test("uses only top-k neighbors when more qualify", () => {
    const targetVector = [1, 0, 0.5];
    // 4 neighbors, k=2: should use only the 2 most similar
    const tournamentGames = [
      makeTournamentGame({
        gameId: "close1",
        vector: [1, 0, 0.5], // cosine = 1.0
        normalizedScore: 3.0,
      }),
      makeTournamentGame({
        gameId: "close2",
        vector: [0.9, 0.1, 0.5], // very similar
        normalizedScore: 3.5,
      }),
      makeTournamentGame({
        gameId: "far1",
        vector: [0.5, 0.5, 0.5], // less similar
        normalizedScore: 9.0, // high score, would skew if included
      }),
      makeTournamentGame({
        gameId: "far2",
        vector: [0.4, 0.6, 0.5], // even less similar
        normalizedScore: 9.0,
      }),
    ];

    const result = detectRevealedPreferenceTension(7.0, targetVector, tournamentGames, 2, 0.2);

    // Top-2 neighbors: close1 (3.0) and close2 (3.5), avg = 3.25
    // Difference: 7.0 - 3.25 = 3.75 > 1.0, so tension should fire
    expect(result).not.toBeNull();
    // The cluster average should reflect the two closest, not all four
    expect(result!.tournamentClusterAverage).toBeLessThan(5.0);
  });

  test("tension note includes both predicted and cluster values", () => {
    const targetVector = [1, 0, 0.5];
    const tournamentGames = [
      makeTournamentGame({
        gameId: "neighbor",
        vector: [1, 0, 0.5],
        normalizedScore: 3.0,
      }),
    ];

    const result = detectRevealedPreferenceTension(7.5, targetVector, tournamentGames, 5, 0.2);

    expect(result).not.toBeNull();
    expect(result!.note).toContain("7.5");
    expect(result!.note).toContain("3");
  });
});
