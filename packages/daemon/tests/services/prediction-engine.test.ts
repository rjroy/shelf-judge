import { describe, expect, test } from "bun:test";
import type {
  Axis,
  DerivedAxis,
  DisabledLegacyAxis,
  Game,
  PersonalAxis,
  TournamentAxis,
} from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import { createFitnessService } from "../../src/services/fitness-service.js";
import {
  assessReadiness,
  computePredictedFitness,
  DEFAULT_PREDICTION_SETTINGS,
  findKNearestForAxis,
  predictAxisRating,
  type ClusterMembership,
  type ReferenceGameCandidate,
  type SimilarityMatch,
} from "../../src/services/prediction-engine.js";
import type { Vocabulary } from "../../src/services/feature-vector.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const settings = DEFAULT_PREDICTION_SETTINGS;
const fitness = createFitnessService();

function game(overrides: Partial<Game> = {}): Game {
  const bggId = overrides.bggId === undefined ? 1 : overrides.bggId;
  return {
    id: "target",
    bggId: 1,
    name: "Target",
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
    entityMetadata: createInitialEntityMetadata(bggId),
    latestPlayCountCheck: null,
  };
}

function personal(id: string, weight = 50): PersonalAxis {
  return {
    id,
    name: id,
    description: null,
    weight,
    enabled: true,
    source: "personal",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function playingTime(
  overrides: Partial<DerivedAxis<"playingTime">> = {},
): DerivedAxis<"playingTime"> {
  return {
    id: "playing-time",
    name: "Play Time",
    description: null,
    weight: 40,
    enabled: true,
    source: "derived",
    derivedField: "playingTime",
    configuration: { maximumScoringTime: 120 },
    preferenceShape: "lower-is-better",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function disabled(weight = 100): DisabledLegacyAxis {
  return {
    id: "disabled",
    name: "Disabled",
    description: null,
    weight,
    enabled: false,
    source: "legacy",
    reason: "unknown",
    legacyField: "future",
    legacyPayload: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function references(axisId: string, rating = 7, count = 5): ReferenceGameCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    gameId: `reference-${index}`,
    gameName: `Reference ${index}`,
    vector: [1, 0.5],
    ratings: { [axisId]: rating },
    tournamentStability: 1,
  }));
}

function compute(
  target: Game,
  axes: Axis[],
  refs: ReferenceGameCandidate[] = [],
  stage: 0 | 1 | 2 | 3 = 2,
) {
  return computePredictedFitness(
    target,
    axes,
    refs,
    [1, 0.5],
    settings,
    stage,
    (actualGame, actualAxes) => fitness.calculateScore(actualGame, actualAxes),
  );
}

describe("prediction primitives", () => {
  test("finds nearest rated candidates and applies stability to ordering", () => {
    const matches = findKNearestForAxis(
      [1, 0.5],
      [
        ...references("fun", 7, 1),
        {
          gameId: "stable",
          gameName: "Stable",
          vector: [1, 0.5],
          ratings: { fun: 8 },
          tournamentStability: 1.2,
        },
        {
          gameId: "other-axis",
          gameName: "Other",
          vector: [1, 0.5],
          ratings: { theme: 10 },
          tournamentStability: 2,
        },
      ],
      "fun",
      5,
      0.2,
    );
    expect(matches.map(({ gameId }) => gameId)).toEqual(["stable", "reference-0"]);
  });

  test("assigns confidence from match count, similarity, and variance", () => {
    expect(predictAxisRating([])).toBeNull();
    expect(
      predictAxisRating(
        references("fun").map(({ gameId, gameName, ratings }) => ({
          gameId,
          gameName,
          similarity: 1,
          rating: ratings.fun,
        })),
      )?.confidence,
    ).toBe("strong");
    expect(
      predictAxisRating([{ gameId: "one", gameName: "One", similarity: 0.5, rating: 6 }])
        ?.confidence,
    ).toBe("weak");
  });
});

describe("predicted fitness", () => {
  test("uses deterministic derived values as actual inputs and never predicts them", () => {
    const derived = playingTime();
    const fun = personal("fun", 60);
    const result = compute(game({ playingTime: 60 }), [derived, fun], references(fun.id));
    const derivedRow = result.fitnessResult.breakdown.find(({ axisId }) => axisId === derived.id);

    expect(derivedRow).toMatchObject({
      source: "derived",
      sourceValue: 60,
      scoringRawValue: 60,
      effectiveRating: 5.5,
      predictionConfidence: "actual",
    });
    expect(result.actualAxisCount).toBe(1);
    expect(result.predictedAxisCount).toBe(1);
    expect(result.fitnessResult.predictionMeta).toMatchObject({
      actualAxisCount: 1,
      predictedAxisCount: 1,
      confidence: "strong",
      coveragePercent: 1,
    });
  });

  test("fully actual early return marks personal and deterministic derived rows actual", () => {
    const time = playingTime();
    const fun = personal("fun", 60);
    const result = compute(game({ playingTime: 60, ratings: { fun: 8 } }), [time, fun]);

    expect(result).toMatchObject({ predictedAxisCount: 0, actualAxisCount: 2 });
    expect(result.fitnessResult.predictionMeta).toBeNull();
    expect(result.fitnessResult.breakdown).toHaveLength(2);
    for (const row of result.fitnessResult.breakdown) {
      expect(row.predictionConfidence).toBe("actual");
      expect(row.referenceGames).toBeNull();
    }
    expect(result.fitnessResult.breakdown.find(({ axisId }) => axisId === time.id)).toMatchObject({
      source: "derived",
      derivedField: "playingTime",
      sourceValue: 60,
      scoringRawValue: 60,
      effectiveRating: 5.5,
      predictionConfidence: "actual",
    });
  });

  test("missing derived fallback rows carry the same metadata as actual scoring", () => {
    const derived = playingTime();
    const actual = fitness.calculateScore(game({ ratings: { fun: 8 } }), [
      derived,
      personal("fun"),
    ]);
    const predicted = compute(game({ playingTime: null }), [derived], [], 0).fitnessResult;
    const actualRow = actual?.breakdown.find(({ axisId }) => axisId === derived.id);
    const predictedRow = predicted.breakdown.find(({ axisId }) => axisId === derived.id);

    expect(predictedRow).toMatchObject({
      derivedField: actualRow?.derivedField,
      sourceValue: null,
      scoringRawValue: null,
      effectiveRating: null,
      unit: actualRow?.unit,
      provenance: actualRow?.provenance,
      configurationSummary: actualRow?.configurationSummary,
      overridden: false,
      predictionConfidence: null,
    });
  });

  test("excludes disabled axes from rows, score, counts, coverage, confidence, and sorting", () => {
    const fun = personal("fun", 50);
    const legacy = disabled(100);
    const result = compute(
      game({ ratings: { [legacy.id]: 1 } }),
      [legacy, fun],
      references(fun.id),
    );

    expect(result.fitnessResult.score).toBe(7);
    expect(result.fitnessResult.totalAxisCount).toBe(1);
    expect(result.actualAxisCount).toBe(0);
    expect(result.predictedAxisCount).toBe(1);
    expect(result.fitnessResult.breakdown.map(({ axisId }) => axisId)).toEqual([fun.id]);
    expect(result.fitnessResult.predictionMeta).toMatchObject({
      confidence: "strong",
      coveragePercent: 1,
      actualAxisCount: 0,
      predictedAxisCount: 1,
    });
  });

  test("disabled axes cannot prevent the fully-actual early return", () => {
    const fun = personal("fun");
    const result = compute(game({ ratings: { fun: 8, disabled: 1 } }), [fun, disabled()]);
    expect(result).toMatchObject({ predictedAxisCount: 0, actualAxisCount: 1 });
    expect(result.fitnessResult).toMatchObject({
      score: 8,
      totalAxisCount: 1,
      predictionMeta: null,
    });
    expect(result.fitnessResult.breakdown.map(({ axisId }) => axisId)).toEqual([fun.id]);
  });

  test("stage zero and insufficient predictions preserve fallback semantics", () => {
    const fun = personal("fun");
    const stageZero = compute(game(), [fun], references(fun.id), 0);
    expect(stageZero).toMatchObject({ predictedAxisCount: 0, actualAxisCount: 0 });
    expect(stageZero.fitnessResult.breakdown[0]).toMatchObject({
      source: "personal",
      effectiveRating: null,
      predictionConfidence: null,
    });

    const insufficient = compute(game(), [fun], [], 2);
    expect(insufficient.fitnessResult.breakdown[0]).toMatchObject({
      source: "predicted",
      effectiveRating: null,
      predictionConfidence: "insufficient",
      referenceGames: [],
    });
    expect(insufficient.fitnessResult.predictionMeta).toBeNull();
  });

  test("rated counts remain actual-only and weak predictions do not add coverage", () => {
    const actual = personal("actual", 70);
    const predicted = personal("predicted", 30);
    const result = compute(
      game({ ratings: { [actual.id]: 8 } }),
      [actual, predicted],
      references(predicted.id, 6, 1),
    );
    expect(result.fitnessResult.ratedAxisCount).toBe(1);
    expect(result.actualAxisCount).toBe(1);
    expect(result.predictedAxisCount).toBe(1);
    expect(result.fitnessResult.predictionMeta).toMatchObject({
      confidence: "weak",
      coveragePercent: 0.7,
    });
  });

  test("preserves Tournament prediction semantics", () => {
    const tournament: TournamentAxis = {
      id: "tournament",
      name: "Tournament",
      description: null,
      weight: 30,
      enabled: true,
      source: "tournament",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const result = compute(game(), [tournament], references(tournament.id, 8));
    expect(result.fitnessResult.breakdown[0]).toMatchObject({
      source: "predicted",
      effectiveRating: 8,
      predictionConfidence: "strong",
    });
    expect(result).toMatchObject({ actualAxisCount: 0, predictedAxisCount: 1 });
  });
});

describe("readiness", () => {
  const vocabulary: Vocabulary = { mechanics: [], categories: [] };

  test("disabled and derived axes do not appear in weak-axis counts or suggestions", () => {
    const fun = personal("fun");
    const result = assessReadiness(
      5,
      [disabled(), playingTime(), fun],
      new Map([["game", { disabled: 8, "playing-time": 7 }]]),
      vocabulary,
      settings,
    );
    expect(result.weakAxes).toEqual([{ axisId: "fun", axisName: "fun", ratedCount: 0 }]);
    expect(result.suggestedActions.some((message) => message.includes("Disabled"))).toBe(false);
    expect(result.suggestedActions.some((message) => message.includes("Play Time"))).toBe(false);
  });

  test.each([
    [4, 0, 5],
    [5, 1, 15],
    [15, 2, 30],
    [30, 3, 30],
  ] as const)("maps %p rated games to readiness stage %p", (ratedCount, stage, nextStageAt) => {
    const result = assessReadiness(ratedCount, [personal("fun")], new Map(), vocabulary, settings);
    expect(result).toMatchObject({ stage, nextStageAt, ratedGameCount: ratedCount });
  });
});

function match(gameId: string, similarity: number, rating: number): SimilarityMatch {
  return { gameId, gameName: gameId, similarity, rating };
}

describe("restored prediction primitive boundaries", () => {
  test("returns only the requested number of nearest games", () => {
    const result = findKNearestForAxis([1, 0.5], references("fun", 7, 6), "fun", 3, 0);
    expect(result).toHaveLength(3);
  });

  test("excludes candidates without the requested axis", () => {
    const result = findKNearestForAxis(
      [1, 0.5],
      [...references("fun", 7, 1), { ...references("theme", 8, 1)[0], gameId: "theme-only" }],
      "fun",
      5,
      0,
    );
    expect(result.map(({ gameId }) => gameId)).toEqual(["reference-0"]);
  });

  test("excludes candidates below minimum similarity", () => {
    const result = findKNearestForAxis(
      [1, 0],
      [
        { ...references("fun", 8, 1)[0], vector: [1, 0] },
        { ...references("fun", 5, 1)[0], gameId: "orthogonal", vector: [0, 1] },
      ],
      "fun",
      5,
      0.5,
    );
    expect(result).toHaveLength(1);
  });

  test("returns fewer than k when fewer candidates qualify", () => {
    expect(findKNearestForAxis([1, 0.5], references("fun", 7, 1), "fun", 5, 0)).toHaveLength(1);
  });

  test("returns no neighbors when no candidate rates the axis", () => {
    expect(findKNearestForAxis([1, 0.5], references("theme", 7, 2), "fun", 5, 0)).toEqual([]);
  });

  test("computes the hand-calculated similarity-weighted average", () => {
    const result = predictAxisRating([match("a", 0.8, 8), match("b", 0.6, 6), match("c", 0.4, 4)]);
    expect(result?.rating).toBeCloseTo(11.6 / 1.8, 4);
  });

  test("one match has weak confidence", () => {
    expect(predictAxisRating([match("a", 0.9, 7)])).toMatchObject({
      rating: 7,
      confidence: "weak",
    });
  });

  test("four high-quality matches cannot be strong", () => {
    expect(
      predictAxisRating([
        match("a", 0.9, 7),
        match("b", 0.85, 7),
        match("c", 0.8, 7),
        match("d", 0.75, 7),
      ])?.confidence,
    ).toBe("moderate");
  });

  test("five high-quality matches can be strong", () => {
    expect(
      predictAxisRating([0.9, 0.85, 0.8, 0.75, 0.72].map((value, i) => match(String(i), value, 7)))
        ?.confidence,
    ).toBe("strong");
  });

  test("variance below 1.5 qualifies for strong", () => {
    const ratings = [5.27, 7, 7, 7, 8.73];
    const result = predictAxisRating(ratings.map((rating, i) => match(String(i), 0.75, rating)));
    expect(result?.variance).toBeLessThan(1.5);
    expect(result?.confidence).toBe("strong");
  });

  test("variance at or above 1.5 prevents strong", () => {
    const ratings = [5, 7, 7, 7, 9];
    const result = predictAxisRating(ratings.map((rating, i) => match(String(i), 0.75, rating)));
    expect(result?.variance).toBeGreaterThanOrEqual(1.5);
    expect(result?.confidence).not.toBe("strong");
  });

  test("average similarity 0.69 prevents strong", () => {
    expect(
      predictAxisRating(Array.from({ length: 5 }, (_, i) => match(String(i), 0.69, 7)))?.confidence,
    ).not.toBe("strong");
  });

  test("average similarity 0.71 permits strong", () => {
    expect(
      predictAxisRating(Array.from({ length: 5 }, (_, i) => match(String(i), 0.71, 7)))?.confidence,
    ).toBe("strong");
  });

  test("three moderate matches produce moderate confidence", () => {
    expect(
      predictAxisRating([match("a", 0.5, 6), match("b", 0.45, 7), match("c", 0.4, 8)])?.confidence,
    ).toBe("moderate");
  });

  test("lowest met confidence criteria wins", () => {
    expect(
      predictAxisRating(Array.from({ length: 5 }, (_, i) => match(String(i), 0.5, 7)))?.confidence,
    ).toBe("moderate");
  });
});

describe("restored predicted-fitness cases", () => {
  const fun = personal("fun", 50);
  const theme = personal("theme", 30);

  test("fully rated games return the actual result early", () => {
    const result = compute(game({ ratings: { fun: 8, theme: 6 } }), [fun, theme]);
    expect(result).toMatchObject({ predictedAxisCount: 0, actualAxisCount: 2 });
    expect(result.fitnessResult.predictionMeta).toBeNull();
    expect(
      result.fitnessResult.breakdown.every((row) => row.predictionConfidence === "actual"),
    ).toBe(true);
  });

  test("partially rated games predict only missing personal axes", () => {
    const result = compute(game({ ratings: { fun: 8 } }), [fun, theme], references("theme", 7, 3));
    expect(result).toMatchObject({ predictedAxisCount: 1, actualAxisCount: 1 });
    expect(result.fitnessResult.breakdown.find(({ axisId }) => axisId === "theme")).toMatchObject({
      source: "predicted",
      effectiveRating: 7,
    });
  });

  test("predicted fitness preserves the hand-calculated weighted average", () => {
    const result = compute(game({ ratings: { fun: 8 } }), [fun, theme], references("theme", 7, 3));
    expect(result.fitnessResult.score).toBe(7.6);
  });

  test("insufficient predictions are excluded from score", () => {
    const result = compute(game({ ratings: { fun: 8 } }), [fun, theme]);
    expect(result.fitnessResult.score).toBe(8);
    expect(result.fitnessResult.breakdown.find(({ axisId }) => axisId === "theme")).toMatchObject({
      effectiveRating: null,
      contribution: null,
      predictionConfidence: "insufficient",
    });
  });

  test("predicted values never trigger personal vetoes", () => {
    const veto = personal("fun", 50);
    veto.veto = { direction: "below", threshold: 3 };
    const result = compute(game(), [veto], references("fun", 2, 3));
    expect(result.fitnessResult).toMatchObject({ score: 2, vetoed: false });
  });

  test("stage zero produces no predicted-source rows", () => {
    const result = compute(game(), [fun, theme], references("fun", 8, 3), 0);
    expect(result.predictedAxisCount).toBe(0);
    expect(result.fitnessResult.breakdown.filter(({ source }) => source === "predicted")).toEqual(
      [],
    );
  });

  test("prediction metadata reports counts reference games and coverage", () => {
    const result = compute(game({ ratings: { fun: 8 } }), [fun, theme], references("theme", 7, 5));
    expect(result.fitnessResult.predictionMeta).toMatchObject({
      predictedAxisCount: 1,
      actualAxisCount: 1,
      referenceGameCount: 5,
      readinessStage: 2,
      coveragePercent: 1,
    });
  });

  test("weak predictions do not add coverage", () => {
    const result = compute(
      game(),
      [fun, theme],
      [
        { ...references("fun", 7, 1)[0], ratings: { fun: 7, theme: 6 } },
        { ...references("fun", 8, 1)[0], gameId: "second", ratings: { fun: 8, theme: 7 } },
      ],
    );
    expect(result.fitnessResult.predictionMeta?.coveragePercent).toBe(0);
  });

  test("ratedAxisCount excludes predicted axes", () => {
    const result = compute(
      game(),
      [fun, theme],
      [
        { ...references("fun", 7, 1)[0], ratings: { fun: 7, theme: 6 } },
        { ...references("fun", 8, 1)[0], gameId: "second", ratings: { fun: 8, theme: 7 } },
        { ...references("fun", 9, 1)[0], gameId: "third", ratings: { fun: 9, theme: 8 } },
      ],
    );
    expect(result).toMatchObject({ predictedAxisCount: 2, actualAxisCount: 0 });
    expect(result.fitnessResult.ratedAxisCount).toBe(0);
  });

  test("ratedAxisCount remains actual-only for mixed results", () => {
    const result = compute(game({ ratings: { fun: 8 } }), [fun, theme], references("theme", 7, 3));
    expect(result.fitnessResult.ratedAxisCount).toBe(1);
  });

  test("overall confidence is the lowest predicted confidence", () => {
    const refs = references("fun", 7, 5).map((candidate, index) => {
      const ratings: Record<string, number> = index < 2 ? { fun: 7, theme: 6 + index } : { fun: 7 };
      return { ...candidate, ratings };
    });
    expect(compute(game(), [fun, theme], refs).fitnessResult.predictionMeta?.confidence).toBe(
      "weak",
    );
  });

  test("all insufficient predictions produce null metadata and zero score", () => {
    const result = compute(game(), [fun, theme], references("other", 7, 1));
    expect(result.predictedAxisCount).toBe(0);
    expect(result.fitnessResult).toMatchObject({ score: 0, predictionMeta: null });
  });

  test("missing deterministic derived data is never predicted", () => {
    const result = compute(
      game({ playingTime: null }),
      [playingTime()],
      references("playing-time", 9),
    );
    expect(result.predictedAxisCount).toBe(0);
    expect(result.fitnessResult.breakdown[0]).toMatchObject({
      source: "derived",
      effectiveRating: null,
      predictionConfidence: null,
    });
  });

  test("Tournament is not predicted at stage zero", () => {
    const axis: TournamentAxis = {
      id: "tournament-zero",
      name: "Tournament",
      description: null,
      weight: 30,
      enabled: true,
      source: "tournament",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const result = compute(game(), [axis], references(axis.id, 7), 0);
    expect(result.fitnessResult.breakdown[0]).toMatchObject({
      source: "tournament",
      effectiveRating: null,
      predictionConfidence: null,
    });
  });

  test("Tournament without references gets an insufficient row", () => {
    const axis: TournamentAxis = {
      id: "tournament-insufficient",
      name: "Tournament",
      description: null,
      weight: 30,
      enabled: true,
      source: "tournament",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(compute(game(), [axis]).fitnessResult.breakdown[0]).toMatchObject({
      source: "predicted",
      predictionConfidence: "insufficient",
      effectiveRating: null,
    });
  });
});

describe("restored readiness and suggestion cases", () => {
  const axes = [personal("fun", 50), personal("theme", 30), personal("replay", 20)];
  const vocabulary: Vocabulary = { mechanics: [], categories: [] };

  test("stage zero is selected below the first threshold", () => {
    expect(assessReadiness(2, axes, new Map(), vocabulary, settings)).toMatchObject({
      stage: 0,
      nextStageAt: 5,
    });
  });

  test("stage one is selected between first and second thresholds", () => {
    expect(assessReadiness(7, axes, new Map(), vocabulary, settings)).toMatchObject({
      stage: 1,
      nextStageAt: 15,
    });
  });

  test("stage two is selected between second and third thresholds", () => {
    expect(assessReadiness(20, axes, new Map(), vocabulary, settings)).toMatchObject({
      stage: 2,
      nextStageAt: 30,
    });
  });

  test("stage three is selected at maturity", () => {
    expect(assessReadiness(30, axes, new Map(), vocabulary, settings)).toMatchObject({
      stage: 3,
      nextStageAt: 30,
    });
  });

  test("weak axes are sorted by rated count", () => {
    const ratings = new Map<string, Record<string, number>>([
      ["g1", { fun: 8, theme: 7 }],
      ["g2", { fun: 7 }],
      ["g3", { fun: 6 }],
      ["g4", { fun: 5 }],
      ["g5", { fun: 4 }],
    ]);
    expect(
      assessReadiness(5, axes, ratings, vocabulary, settings).weakAxes.map(({ axisId }) => axisId),
    ).toEqual(["replay", "theme"]);
  });

  test("stage zero suggests the exact remaining game count", () => {
    expect(
      assessReadiness(3, axes, new Map(), vocabulary, settings).suggestedActions.some((value) =>
        value.includes("2 more game"),
      ),
    ).toBe(true);
  });

  test("weak axes generate rating suggestions", () => {
    const result = assessReadiness(5, axes, new Map(), vocabulary, settings);
    expect(result.suggestedActions.some((value) => value.includes("theme"))).toBe(true);
    expect(result.suggestedActions.some((value) => value.includes("replay"))).toBe(true);
  });

  test("custom readiness thresholds are respected", () => {
    const custom = { ...settings, stageThresholds: [3, 10, 20] as [number, number, number] };
    expect(assessReadiness(3, axes, new Map(), vocabulary, custom)).toMatchObject({
      stage: 1,
      nextStageAt: 10,
    });
  });

  test("threshold minus one remains stage zero", () => {
    expect(assessReadiness(4, axes, new Map(), vocabulary, settings).stage).toBe(0);
  });

  test("the exact first threshold enters stage one", () => {
    expect(assessReadiness(5, axes, new Map(), vocabulary, settings).stage).toBe(1);
  });

  test("underrepresented clusters are suggested by coverage", () => {
    const membership: ClusterMembership = new Map([
      ["Deck Building", new Set(["g1", "g6", "g7", "g8", "g9"])],
      ["Worker Placement", new Set(["g2", "g3", "g4", "g10"])],
      ["Area Control", new Set(["g11", "g12", "g13"])],
    ]);
    const ratings = new Map<string, Record<string, number>>([
      ["g1", { fun: 8 }],
      ["g2", { fun: 7 }],
      ["g3", { fun: 6 }],
      ["g4", { fun: 5 }],
      ["g5", { fun: 4 }],
    ]);
    const actions = assessReadiness(
      5,
      axes,
      ratings,
      vocabulary,
      settings,
      membership,
    ).suggestedActions;
    expect(actions.some((value) => value.includes("Area Control"))).toBe(true);
    expect(actions.some((value) => value.includes("Deck Building"))).toBe(true);
    expect(actions.some((value) => value.includes("Worker Placement"))).toBe(false);
  });

  test("cluster suggestions are capped and tiny clusters are skipped", () => {
    const membership: ClusterMembership = new Map([
      ["Tiny Cluster", new Set(["g1", "g2"])],
      ["Big A", new Set(["g3", "g4", "g5"])],
      ["Big B", new Set(["g6", "g7", "g8"])],
      ["Big C", new Set(["g9", "g10", "g11"])],
    ]);
    const actions = assessReadiness(
      1,
      axes,
      new Map(),
      vocabulary,
      settings,
      membership,
    ).suggestedActions;
    expect(actions.filter((value) => value.includes("cluster"))).toHaveLength(2);
    expect(actions.some((value) => value.includes("Tiny Cluster"))).toBe(false);
  });

  test("empty cluster membership produces no cluster suggestions", () => {
    expect(
      assessReadiness(5, axes, new Map(), vocabulary, settings).suggestedActions.filter((value) =>
        value.includes("cluster"),
      ),
    ).toEqual([]);
  });

  test("Tournament ratings participate in weak-axis counts", () => {
    const tournamentAxis: TournamentAxis = {
      id: "tournament-weak",
      name: "Tournament",
      description: null,
      weight: 30,
      enabled: true,
      source: "tournament",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const ratings = new Map<string, Record<string, number>>([
      ["g1", { fun: 8, "tournament-weak": 7 }],
      ["g2", { fun: 7, "tournament-weak": 6.5 }],
      ["g3", { fun: 6 }],
      ["g4", { fun: 5 }],
      ["g5", { fun: 4 }],
    ]);
    const result = assessReadiness(
      5,
      [personal("fun"), tournamentAxis],
      ratings,
      vocabulary,
      settings,
    );
    expect(result.weakAxes).toContainEqual({
      axisId: "tournament-weak",
      axisName: "Tournament",
      ratedCount: 2,
    });
  });
});
