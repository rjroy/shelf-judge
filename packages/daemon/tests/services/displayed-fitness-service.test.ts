import { describe, expect, test } from "bun:test";
import type {
  Collection,
  CollectionProfileCollectionSource,
  FitnessResult,
  Game,
  GameWithScore,
  PredictionSettings,
  RedundancySettings,
  TournamentData,
} from "@shelf-judge/shared";
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
    manualValues: { playingTime: null, playerCount: null },
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
  const predictionTargets: (readonly string[] | undefined)[] = [];
  const gameService = {
    listGames: () => {
      actualCalls++;
      return Promise.resolve(structuredClone(actual));
    },
  } as GameService;
  const predictionService = {
    listGamesWithPredictions: (targetGameIds) => {
      predictedCalls++;
      predictionTargets.push(targetGameIds);
      return Promise.resolve(structuredClone(predicted));
    },
  } as PredictionService;
  return {
    service: createDisplayedFitnessService({ gameService, predictionService }),
    calls: () => ({ actualCalls, predictedCalls, predictionTargets }),
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
    expect(calls()).toEqual({ actualCalls: 1, predictedCalls: 1, predictionTargets: [undefined] });
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
  test("forwards sorted unique target IDs and omits non-owned target output", async () => {
    const peer = { game: game("peer"), score: score() };
    const target = { game: game("target"), score: score() };
    const retired = {
      game: { ...game("retired"), ownership: "previously-owned" as const },
      score: score(),
    };
    const { service, calls } = services([], [peer, target, retired]);

    const result = await service.listGames({
      includePredicted: true,
      targetGameIds: ["target", "target", "retired"],
    });

    expect(result.map((entry) => entry.game.id)).toEqual(["target"]);
    expect(calls()).toEqual({
      actualCalls: 0,
      predictedCalls: 1,
      predictionTargets: [["retired", "target"]],
    });
  });
  test("snapshot target retains complete redundancy and niche peer universes", async () => {
    const bgg = {
      communityRating: 7,
      bayesAverage: 7,
      weight: 2,
      numWeightVotes: 10,
      description: null,
      mechanics: [{ id: 1, name: "Deck Building" }],
      categories: [{ id: 2, name: "Card Game" }],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    };
    const games = [
      {
        ...game("target"),
        bggData: bgg,
        ownerNote: { state: "missing" as const, version: 0 as const, updatedAt: null },
      },
      {
        ...game("peer-one"),
        bggData: bgg,
        ownerNote: { state: "missing" as const, version: 0 as const, updatedAt: null },
      },
      {
        ...game("peer-two"),
        bggData: bgg,
        ownerNote: { state: "missing" as const, version: 0 as const, updatedAt: null },
      },
    ];
    const collection: Collection = {
      schemaVersion: 8,
      revision: 1,
      id: "collection",
      name: "Collection",
      axes: [],
      games,
      intentions: [],
      attentionDispositions: [],
      commandReceipts: [],
      entertainmentBenchmark: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const scores = new Map([
      ["target", 8],
      ["peer-one", 6],
      ["peer-two", 4],
    ]);
    const entries = (source: readonly Game[], predicted = false): GameWithScore[] =>
      source.map((entry) => ({
        game: entry,
        score: score({
          score:
            predicted && entry.id === "peer-one"
              ? 9
              : predicted && entry.id === "peer-two"
                ? 1
                : (scores.get(entry.id) ?? 0),
          predictionMeta:
            predicted && entry.id === "target"
              ? {
                  readinessStage: 1,
                  confidence: "strong",
                  predictedAxisCount: 1,
                  actualAxisCount: 0,
                  referenceGameCount: 2,
                  coveragePercent: 1,
                }
              : null,
        }),
      }));
    const gameCalls: string[][] = [];
    const gameService = {
      listGames: () => Promise.resolve(entries(games)),
      getGame: (id: string) => {
        const entry = entries(games).find((candidate) => candidate.game.id === id);
        return entry === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(entry);
      },
      listGamesFromSnapshot: (source: CollectionProfileCollectionSource) => {
        gameCalls.push(source.games.map((entry) => entry.id));
        return entries(source.games);
      },
    } as unknown as GameService;
    const predictionCalls: (readonly string[] | undefined)[] = [];
    const predictionService = {
      listGamesWithPredictions: () => Promise.resolve(entries(games)),
      listGamesWithPredictionsFromSnapshot: (
        source: CollectionProfileCollectionSource,
        _tournament: TournamentData,
        _settings: PredictionSettings,
        targets?: readonly string[],
      ) => {
        predictionCalls.push(targets);
        return Promise.resolve(
          entries(
            targets === undefined
              ? source.games
              : source.games.filter((g) => targets.includes(g.id)),
            true,
          ),
        );
      },
    } as PredictionService;
    const service = createDisplayedFitnessService({ gameService, predictionService });
    const tournament: TournamentData = {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
      sessions: [],
      gameStats: {},
    };
    const predictionSettings: PredictionSettings = {
      stageThresholds: [5, 15, 30],
      defaultK: 5,
      minSimilarityThreshold: 0.2,
    };
    const redundancySettings: RedundancySettings = {
      enabled: true,
      stage: "integrated",
      similarityThreshold: 0.1,
      maxPenalty: 2,
      componentWeights: { binary: 1, continuous: 0, personalAxes: 0 },
      minNeighbors: 1,
      expectedNeighbors: 2,
    };
    const snapshot = {
      collection,
      tournament,
      predictionSettings,
      redundancySettings,
      nicheSettings: { ignoredTags: [] },
    };
    const full = await service.listGamesFromSnapshot(snapshot, {
      includePredicted: false,
      includeNiches: true,
    });
    gameCalls.length = 0;
    predictionCalls.length = 0;
    const targeted = await service.listGamesFromSnapshot(snapshot, {
      includePredicted: false,
      includeNiches: true,
      targetGameIds: ["target"],
    });
    expect(targeted).toEqual(full.filter((entry) => entry.game.id === "target"));
    expect(gameCalls).toEqual([["target"], ["target", "peer-one", "peer-two"]]);
    expect(predictionCalls).toEqual([undefined, undefined]);
    expect(targeted[0]?.score?.redundancyAdjustment?.nicheNeighbors).toHaveLength(2);
    expect(targeted[0]?.nichePosition?.niches).not.toHaveLength(0);

    predictionCalls.length = 0;
    const predictedFull = await service.listGamesFromSnapshot(snapshot, { includePredicted: true });
    predictionCalls.length = 0;
    const predictedTargeted = await service.listGamesFromSnapshot(snapshot, {
      includePredicted: true,
      targetGameIds: ["target"],
    });
    expect(predictedTargeted).toEqual(predictedFull.filter((entry) => entry.game.id === "target"));
    expect(predictedTargeted[0]?.score?.predictionMeta?.referenceGameCount).toBe(2);
    expect(predictionCalls).toEqual([["target"], undefined]);
    expect(targeted[0]?.score).not.toEqual(
      predictedFull.find((entry) => entry.game.id === "target")?.score,
    );
  });
});
