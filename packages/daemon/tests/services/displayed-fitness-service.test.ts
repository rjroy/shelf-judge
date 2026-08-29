import { describe, expect, test } from "bun:test";
import type { FitnessResult, Game, GameWithScore } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import {
  createDisplayedFitnessService,
  type DisplayedFitnessOptions,
} from "../../src/services/displayed-fitness-service.js";
import type { GameService } from "../../src/services/game-service.js";
import type { PredictionService } from "../../src/services/prediction-service.js";

function game(id: string): Game {
  return {
    id,
    bggId: null,
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    name: id,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function score(overrides: Partial<FitnessResult> = {}): FitnessResult {
  return {
    score: 7,
    ratedAxisCount: 1,
    totalAxisCount: 1,
    breakdown: [],
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: null,
    redundancyAdjustment: null,
    ...overrides,
  };
}

function scoredAxis(contribution: number): FitnessResult["breakdown"][number] {
  return {
    axisId: "fun",
    axisName: "Fun",
    weight: 100,
    contribution,
    source: "personal",
    derivedField: null,
    sourceValue: contribution,
    scoringRawValue: contribution,
    effectiveRating: contribution,
    preferenceShape: "higher-is-better",
    curveAffected: false,
    unit: null,
    provenance: null,
    configurationSummary: null,
    overridden: false,
    overrideValue: null,
    predictionConfidence: null,
    referenceGames: null,
  };
}

function services(actual: GameWithScore[], predicted: GameWithScore[]) {
  let actualCalls = 0;
  let predictedCalls = 0;
  const gameService = {
    listGames: () => {
      actualCalls++;
      return Promise.resolve(structuredClone(actual));
    },
  } as GameService;
  const predictionService = {
    listGamesWithPredictions: () => {
      predictedCalls++;
      return Promise.resolve(structuredClone(predicted));
    },
  } as PredictionService;
  return {
    service: createDisplayedFitnessService({ gameService, predictionService }),
    calls: () => ({ actualCalls, predictedCalls }),
  };
}

describe("DisplayedFitnessService", () => {
  test("selects the requested score mode and marks only contributed predictions", async () => {
    const actual = [{ game: game("actual"), score: score() }];
    const predicted = [
      {
        game: game("predicted"),
        score: score({
          predictionMeta: {
            readinessStage: 1,
            confidence: "weak",
            predictedAxisCount: 1,
            actualAxisCount: 0,
            referenceGameCount: 5,
            coveragePercent: 1,
          },
        }),
      },
      { game: game("insufficient"), score: score() },
    ];
    const { service, calls } = services(actual, predicted);

    const actualResult = await service.listGames({ includePredicted: false });
    const predictedResult = await service.listGames({ includePredicted: true });

    expect(actualResult).toMatchObject([
      { game: { id: "actual" }, hasPredictedContribution: false },
    ]);
    expect(predictedResult.map((entry) => entry.hasPredictedContribution)).toEqual([true, false]);
    expect(predictedResult.map((entry) => entry.hasScoringContribution)).toEqual([false, false]);
    expect(calls()).toEqual({ actualCalls: 1, predictedCalls: 1 });
  });

  test("preserves vetoed zero and hypothetical evidence without treating it as prediction", async () => {
    const vetoed = {
      game: game("vetoed"),
      score: score({
        score: 0,
        breakdown: [scoredAxis(8.4)],
        vetoed: true,
        hypotheticalScore: 8.4,
      }),
    };
    const { service } = services([vetoed], [vetoed]);

    const [result] = await service.listGames({
      includePredicted: true,
    } satisfies DisplayedFitnessOptions);

    expect(result.score?.score).toBe(0);
    expect(result.score?.hypotheticalScore).toBe(8.4);
    expect(result.hasPredictedContribution).toBe(false);
    expect(result.hasScoringContribution).toBe(true);
  });
});
