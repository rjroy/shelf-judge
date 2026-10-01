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
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyState,
  createInitialSemanticRedundancyStateV10,
} from "@shelf-judge/shared";
import { semanticGenerationFixture } from "../helpers/semantic-redundancy-fixtures.js";
import {
  createDisplayedFitnessService,
  ownedPredictedCandidates,
  semanticFallbackStatus,
  withRedundancyAdjustments,
  type DisplayedFitnessOptions,
} from "../../src/services/displayed-fitness-service.js";
import type { GameService } from "../../src/services/game-service.js";
import type { PredictionService } from "../../src/services/prediction-service.js";
import type { StorageService } from "../../src/services/storage-service.js";
import type { RedundancyPairTable } from "../../src/services/redundancy-engine.js";
import { flattenWeighted } from "../../src/services/redundancy-engine.js";
import {
  buildVocabulary,
  computeContinuousRanges,
  encodeGame,
  getOrderedVectorAxes,
  getVectorAxisValues,
} from "../../src/services/feature-vector.js";
import { cosineSimilarity } from "../../src/services/feature-vector.js";
import { deriveDisplayStats } from "../../src/services/tournament-service.js";
import { createSourceVectorService } from "../../src/services/source-vector.js";
import { projectProfileCollectionSource } from "../../src/services/game-projection.js";

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
  test("owned predicted candidates exclude previously-owned games", () => {
    const owned = { game: game("owned"), score: score() };
    const retired = {
      game: { ...game("retired"), ownership: "previously-owned" as const },
      score: score(),
    };

    expect(ownedPredictedCandidates([owned, retired])).toEqual([owned]);
  });

  test("redundancy projections never mutate raw ordinary score objects", () => {
    const raw = { game: game("raw"), score: score({ score: 8 }) };
    const sourceScore = raw.score;
    const projected = withRedundancyAdjustments(
      [raw],
      {
        enabled: false,
        stage: "integrated",
        similarityThreshold: 0.1,
        maxPenalty: 2,
        componentWeights: { binary: 1, continuous: 0 },
        minNeighbors: 1,
        expectedNeighbors: 2,
      },
      { games: [raw.game], axes: [] },
      {
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
        sessions: [],
        gameStats: {},
      },
    );

    expect(projected[0]?.score).not.toBe(sourceScore);
    expect(raw.score).toBe(sourceScore);
    expect(sourceScore.score).toBe(8);
  });

  test("legacy v9 publication fallback is always not-ready without adjustments", () => {
    const semanticState = createInitialSemanticRedundancyState();
    semanticState.settings.enabled = true;
    expect(semanticFallbackStatus({ semanticRedundancy: semanticState }, true)).toBe("not-ready");
    semanticState.publishedGeneration = semanticGenerationFixture({
      id: "published-but-unvalidated",
      manifestDigest: "d".repeat(64),
    });
    expect(semanticFallbackStatus({ semanticRedundancy: semanticState }, true)).toBe("not-ready");
    const entries = [
      { game: game("one"), score: score({ score: 9 }) },
      { game: game("two"), score: score({ score: 7 }) },
    ];
    const settings: RedundancySettings = {
      enabled: true,
      stage: "annotation",
      similarityThreshold: 0.4,
      maxPenalty: 2,
      componentWeights: { binary: 1, continuous: 0 },
      minNeighbors: 1,
      expectedNeighbors: 2,
    };
    const collection = { games: entries.map(({ game }) => game), axes: [] };
    const tournament: TournamentData = {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
      sessions: [],
      gameStats: {},
    };
    const vocabulary = buildVocabulary(collection.games.filter((item) => item.bggData));
    const ranges = computeContinuousRanges(collection.games.filter((item) => item.bggData));
    const vectorAxes = getOrderedVectorAxes(collection.axes);
    const vectors = entries.map(({ game: item }) =>
      encodeGame(
        item,
        vocabulary,
        vectorAxes,
        getVectorAxisValues(
          item,
          vectorAxes,
          deriveDisplayStats(item.id, tournament).normalizedScore,
        ),
        ranges,
      ),
    );
    const factualScore = cosineSimilarity(
      flattenWeighted(vectors[0], settings.componentWeights),
      flattenWeighted(vectors[1], settings.componentWeights),
    );
    const table: RedundancyPairTable = {
      status: "ready",
      identity: {
        generationId: "generation-1",
        consentEpoch: "consent-1",
        settingsEpoch: "settings-1",
      },
      expectedIdentity: {
        generationId: "generation-1",
        consentEpoch: "consent-1",
        settingsEpoch: "settings-1",
      },
      weights: { factual: 7, description: 5, ownerNote: 0 },
      pairs: [
        {
          gameAId: "one",
          gameBId: "two",
          factual: factualScore,
          description: 1,
        },
      ],
    };
    const ready = withRedundancyAdjustments(
      entries,
      settings,
      collection,
      tournament,
      entries,
      table,
    );
    expect(ready[0]?.score?.redundancySimilarityInfo).toEqual({
      status: "ready",
      generationId: "generation-1",
    });
    expect(ready[0]?.score?.redundancyAdjustment?.nicheNeighbors[0]?.similarity).toBe(
      Math.round(((7 * factualScore + 5) / 12) * 1000) / 1000,
    );

    const factual = withRedundancyAdjustments(entries, settings, collection, tournament);
    expect(factual[0]?.score?.redundancySimilarityInfo).toEqual({
      status: "factual",
      generationId: null,
    });
    expect(factual[0]?.score?.redundancyAdjustment).toBeNull();
    const notReady = withRedundancyAdjustments(entries, settings, collection, tournament, entries, {
      ...table,
      status: "not-ready",
      pairs: [],
    });
    expect(notReady[0]?.score?.redundancySimilarityInfo?.status).toBe("not-ready");
    const stale = withRedundancyAdjustments(entries, settings, collection, tournament, entries, {
      ...table,
      status: "stale",
      pairs: [],
    });
    expect(stale[0]?.score?.redundancySimilarityInfo?.status).toBe("stale");
    expect(stale[0]?.score?.redundancyAdjustment).toBeNull();
  });

  test("assigns collection status to scored vetoed games without adding them to the pair universe", () => {
    const entries = [
      { game: game("eligible"), score: score({ score: 8 }) },
      { game: game("vetoed"), score: score({ score: 0, vetoed: true }) },
    ];
    const settings: RedundancySettings = {
      enabled: true,
      stage: "annotation",
      similarityThreshold: 0.5,
      maxPenalty: 2,
      componentWeights: { binary: 1, continuous: 0 },
      minNeighbors: 1,
      expectedNeighbors: 2,
    };
    const collection = { games: entries.map(({ game }) => game), axes: [] };
    const tournament: TournamentData = {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
      sessions: [],
      gameStats: {},
    };
    const projected = withRedundancyAdjustments(
      entries,
      settings,
      collection,
      tournament,
      entries,
      undefined,
      "not-ready",
    );
    const vetoed = projected.find(({ game: candidate }) => candidate.id === "vetoed");
    expect(vetoed?.score?.redundancyAdjustment).toBeNull();
    expect(vetoed?.score?.redundancySimilarityInfo).toEqual({
      status: "not-ready",
      generationId: null,
    });
  });

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
      schemaVersion: 10,
      revision: 1,
      id: "collection",
      name: "Collection",
      axes: [],
      games,
      intentions: [],
      attentionDispositions: [],
      commandReceipts: [],
      entertainmentBenchmark: null,
      semanticRedundancy: createInitialSemanticRedundancyStateV10(),
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
      componentWeights: { binary: 1, continuous: 0 },
      minNeighbors: 1,
      expectedNeighbors: 2,
    };
    const snapshot = {
      kind: "public" as const,
      collection: projectProfileCollectionSource(collection),
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

  test("private snapshot scores remain factual-only and do not expose owner notes", async () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const bggData = {
      communityRating: 8,
      bayesAverage: 7.8,
      weight: 2,
      numWeightVotes: 100,
      description: "Fictional vector fixture",
      mechanics: [{ id: 1, name: "Cards" }],
      categories: [{ id: 2, name: "Strategy" }],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: timestamp,
    };
    const games = ["target", "peer-one", "peer-two"].map((id) => ({
      ...game(id),
      bggData,
      ownerNote: {
        state: "present" as const,
        version: 1 as const,
        updatedAt: timestamp,
        text: `PRIVATE_SENTINEL_${id}`,
      },
    }));
    const collection: Collection = {
      schemaVersion: 10,
      revision: 1,
      id: "private-snapshot-fixture",
      name: "Private snapshot fixture",
      axes: [],
      games,
      intentions: [],
      attentionDispositions: [],
      commandReceipts: [],
      entertainmentBenchmark: null,
      semanticRedundancy: createInitialSemanticRedundancyStateV10(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    collection.semanticRedundancy.settings.enabled = true;
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
      similarityThreshold: 0.8,
      maxPenalty: 2,
      componentWeights: { binary: 1, continuous: 0 },
      minNeighbors: 1,
      expectedNeighbors: 2,
    };
    const vector = createSourceVectorService();
    vector.hydrate(
      { id: collection.id, schemaVersion: 10, revision: collection.revision },
      {
        tournament: 1,
        predictionSettings: 1,
        nicheSettings: 1,
        redundancySettings: 1,
        shelfConfig: 1,
      },
    );
    const ordinaryScores = new Map([
      ["target", 8],
      ["peer-one", 6],
      ["peer-two", 4],
    ]);
    const predictedScores = new Map([
      ["target", 8],
      ["peer-one", 9],
      ["peer-two", 4],
    ]);
    const scored = (source: readonly Game[], predicted: boolean): GameWithScore[] =>
      source.map((sourceGame) => ({
        game: sourceGame,
        score: score({
          score: (predicted ? predictedScores : ordinaryScores).get(sourceGame.id) ?? 0,
          predictionMeta: predicted
            ? {
                readinessStage: 1,
                confidence: "strong",
                predictedAxisCount: 1,
                actualAxisCount: 0,
                referenceGameCount: 3,
                coveragePercent: 1,
              }
            : null,
        }),
      }));
    const gameService = {
      listGames: () => Promise.resolve(scored(games, false)),
      listGamesFromSnapshot: (
        source: CollectionProfileCollectionSource,
        _tournament: TournamentData,
      ) => {
        void _tournament;
        expect("semanticRedundancy" in source).toBe(false);
        expect(source.games.every((sourceGame) => !("ownerNote" in sourceGame))).toBe(true);
        return scored(source.games, false);
      },
    } as unknown as GameService;
    const predictionService = {
      listGamesWithPredictions: () => Promise.resolve(scored(games, true)),
      listGamesWithPredictionsFromSnapshot: (
        source: CollectionProfileCollectionSource,
        _tournament: TournamentData,
        _settings: PredictionSettings,
        targetIds?: readonly string[],
      ) =>
        Promise.resolve(
          scored(
            targetIds === undefined
              ? source.games
              : source.games.filter(({ id }) => targetIds.includes(id)),
            true,
          ),
        ),
    } as unknown as PredictionService;
    const service = createDisplayedFitnessService({
      gameService,
      predictionService,
      storageService: { sourceVector: () => vector.read() } as StorageService,
    });
    const snapshot = {
      kind: "private-capture" as const,
      collection,
      sourceVector: vector.read(),
      tournament,
      predictionSettings,
      redundancySettings,
    };

    const targetScores: number[] = [];
    for (const includePredicted of [false, true]) {
      const result = await service.listGamesFromSnapshot(snapshot, {
        includePredicted,
        targetGameIds: ["target"],
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.score?.redundancySimilarityInfo).toEqual({
        status: "not-ready",
        generationId: null,
      });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
      expect(JSON.stringify(result)).not.toContain("ownerNote");
      targetScores.push(result[0]?.score?.score ?? 0);
    }
    expect(targetScores).toEqual([7, 7]);

    const racedPredictionService = {
      listGamesWithPredictionsFromSnapshot: (
        source: CollectionProfileCollectionSource,
        _tournament: TournamentData,
        _settings: PredictionSettings,
        targetIds?: readonly string[],
      ) => {
        vector.publish("prediction-settings", 2);
        return Promise.resolve(
          scored(
            targetIds === undefined
              ? source.games
              : source.games.filter(({ id }) => targetIds.includes(id)),
            true,
          ),
        );
      },
    } as unknown as PredictionService;
    const racedService = createDisplayedFitnessService({
      gameService,
      predictionService: racedPredictionService,
      storageService: { sourceVector: () => vector.read() } as StorageService,
    });
    const racedResult = await racedService.listGamesFromSnapshot(
      { ...snapshot, sourceVector: vector.read() },
      { includePredicted: true },
    );
    expect(racedResult[0]?.score?.redundancySimilarityInfo?.status).toBe("not-ready");
  });
});
