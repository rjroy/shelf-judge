import { describe, expect, test } from "bun:test";
import type {
  BggGameData,
  Collection,
  CollectionProfileEntityPolicy,
  FitnessResult,
  EnabledAxis,
  Game,
  PersonalAxis,
} from "@shelf-judge/shared";
import {
  CollectionProfileSnapshotSchema,
  CollectionProfileResultSchema,
  createCollectionProfileSnapshotSchema,
  createCompleteEntityMetadata,
  createInitialEntityMetadata,
} from "@shelf-judge/shared";
import { computeCollectionProfile } from "../src/services/collection-profile-engine.js";
import { computeCollectionProfileAxisDistributions } from "../src/services/collection-profile-axis-distributions.js";

// --- Test helpers ---

function makeGame(overrides: Partial<Game> & { id: string; name: string }): Game {
  const game: Game = {
    bggId: null,
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
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
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
  return {
    ...game,
    entityMetadata: overrides.entityMetadata ?? createInitialEntityMetadata(game.bggId),
    latestPlayCountCheck: overrides.latestPlayCountCheck ?? null,
  };
}

function makeBggData(overrides: Partial<BggGameData> = {}): BggGameData {
  return {
    communityRating: 7.5,
    bayesAverage: 7.0,
    weight: 3.0,
    numWeightVotes: 100,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    bestPlayerCount: null,
    fetchedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAxis(overrides: Partial<PersonalAxis> & { id: string; name: string }): PersonalAxis {
  return {
    description: null,
    weight: 50,
    enabled: true,
    source: "personal",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFitness(score: number, vetoed = false): FitnessResult {
  return {
    score,
    ratedAxisCount: 1,
    totalAxisCount: 1,
    breakdown: [],
    vetoed,
    vetoedBy: null,
    hypotheticalScore: vetoed ? score : null,
    predictionMeta: null,
    redundancyAdjustment: null,
  };
}

function makeDerivedAxis(
  id: string,
  name: string,
  derivedField: "communityRating" | "weight" | "playerCountFit" | "playingTime",
): EnabledAxis {
  const base = {
    id,
    name,
    description: null,
    weight: 50,
    enabled: true as const,
    source: "derived" as const,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  switch (derivedField) {
    case "communityRating":
      return { ...base, derivedField, configuration: {} };
    case "weight":
      return { ...base, derivedField, configuration: {} };
    case "playerCountFit":
      return { ...base, derivedField, configuration: { targetPlayerCount: 4 } };
    case "playingTime":
      return { ...base, derivedField, configuration: { maximumScoringTime: 240 } };
  }
}

function makeDistributionResults(games: Game[], axes: EnabledAxis[]): Map<string, FitnessResult> {
  return new Map(
    games.map((game) => [
      game.id,
      {
        ...makeFitness(5),
        breakdown: axes.map((axis) => ({
          axisId: axis.id,
          axisName: axis.name,
          weight: axis.weight,
          contribution: null,
          source: "personal" as const,
          derivedField: axis.source === "derived" ? axis.derivedField : null,
          sourceValue: null,
          scoringRawValue: null,
          effectiveRating: game.ratings[axis.id] ?? null,
          preferenceShape: "higher-is-better" as const,
          curveAffected: false,
          unit: null,
          provenance: null,
          configurationSummary: null,
          overridden: false,
          overrideValue: null,
          predictionConfidence: null,
          referenceGames: null,
        })),
      },
    ]),
  );
}

function setEffectiveRating(
  results: Map<string, FitnessResult>,
  gameId: string,
  rating: number,
): void {
  const entry = results.get(gameId)?.breakdown[0];
  if (entry === undefined) throw new Error(`Missing distribution fixture for ${gameId}`);
  entry.effectiveRating = rating;
}

// --- Axis Distributions ---

describe("computeCollectionProfileAxisDistributions", () => {
  test("uses effective ratings from fitness breakdowns, including derived overrides", () => {
    const axis = makeDerivedAxis("time", "Play Time", "playingTime");
    const result = makeFitness(8);
    result.breakdown = [
      {
        axisId: axis.id,
        axisName: axis.name,
        weight: axis.weight,
        contribution: 8,
        source: "override",
        derivedField: "playingTime",
        sourceValue: 300,
        scoringRawValue: 240,
        effectiveRating: 8,
        preferenceShape: "sweet-spot",
        curveAffected: false,
        unit: "minutes",
        provenance: "Publisher-listed playing time imported from BoardGameGeek",
        configurationSummary: "Scoring cap: 240 minutes",
        overridden: true,
        overrideValue: 8,
        predictionConfidence: null,
        referenceGames: null,
      },
    ];

    const distributions = computeCollectionProfileAxisDistributions(
      [axis],
      new Map([["game", result]]),
    );
    expect(distributions[0].mean).toBe(8);
    expect(distributions[0].range).toEqual({ min: 8, max: 8 });
    expect(distributions[0].histogram[7]).toBe(1);
  });
  test("hand-calculated mean/median/stddev/range for a 5-game, 3-axis dataset", () => {
    const axes = [
      makeAxis({ id: "a1", name: "Fun" }),
      makeAxis({ id: "a2", name: "Strategy" }),
      makeAxis({ id: "a3", name: "Art" }),
    ];

    // Fun ratings: 2, 4, 6, 8, 10
    // Mean = 6, Median = 6, StdDev = sqrt(((4+1+0+1+4)*4)/5... let me compute
    // Variance = ((2-6)^2 + (4-6)^2 + (6-6)^2 + (8-6)^2 + (10-6)^2) / 5
    //          = (16 + 4 + 0 + 4 + 16) / 5 = 40/5 = 8
    // StdDev = sqrt(8) ≈ 2.828
    const games = [
      makeGame({ id: "g1", name: "G1", ratings: { a1: 2, a2: 5, a3: 7 } }),
      makeGame({ id: "g2", name: "G2", ratings: { a1: 4, a2: 5, a3: 8 } }),
      makeGame({ id: "g3", name: "G3", ratings: { a1: 6, a2: 5, a3: 9 } }),
      makeGame({ id: "g4", name: "G4", ratings: { a1: 8, a2: 7 } }),
      makeGame({ id: "g5", name: "G5", ratings: { a1: 10, a2: 3 } }),
    ];

    const result = computeCollectionProfileAxisDistributions(
      axes,
      makeDistributionResults(games, axes),
    );

    // Fun: [2,4,6,8,10] → mean=6, median=6, stddev=sqrt(8)
    const fun = result.find((d) => d.axisId === "a1")!;
    expect(fun.mean).toBe(6);
    expect(fun.median).toBe(6);
    expect(fun.standardDeviation).toBeCloseTo(Math.sqrt(8), 10);
    expect(fun.range).toEqual({ min: 2, max: 10 });
    expect(fun.ratedGameCount).toBe(5);
    // Histogram: bucket[1]=1(rating 2), bucket[3]=1(rating 4), bucket[5]=1(rating 6),
    //            bucket[7]=1(rating 8), bucket[9]=1(rating 10)
    expect(fun.histogram).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);

    // Strategy: [5,5,5,7,3] → mean=5, median=5
    // Variance = (0+0+0+4+4)/5 = 1.6, stddev = sqrt(1.6)
    const strategy = result.find((d) => d.axisId === "a2")!;
    expect(strategy.mean).toBe(5);
    expect(strategy.median).toBe(5);
    expect(strategy.standardDeviation).toBeCloseTo(Math.sqrt(1.6), 10);
    expect(strategy.range).toEqual({ min: 3, max: 7 });
    expect(strategy.ratedGameCount).toBe(5);
    // Histogram: bucket[2]=1(rating 3), bucket[4]=3(rating 5), bucket[6]=1(rating 7)
    expect(strategy.histogram).toEqual([0, 0, 1, 0, 3, 0, 1, 0, 0, 0]);

    // Art: [7,8,9] → mean=8, median=8
    // Variance = (1+0+1)/3 = 2/3, stddev = sqrt(2/3)
    const art = result.find((d) => d.axisId === "a3")!;
    expect(art.mean).toBe(8);
    expect(art.median).toBe(8);
    expect(art.standardDeviation).toBeCloseTo(Math.sqrt(2 / 3), 10);
    expect(art.range).toEqual({ min: 7, max: 9 });
    expect(art.ratedGameCount).toBe(3);
    // Histogram: bucket[6]=1(rating 7), bucket[7]=1(rating 8), bucket[8]=1(rating 9)
    expect(art.histogram).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 0]);
  });

  test("axis with no ratings returns zeroed distribution", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun" })];
    const games = [makeGame({ id: "g1", name: "G1" })];

    const result = computeCollectionProfileAxisDistributions(
      axes,
      makeDistributionResults(games, axes),
    );
    expect(result[0].mean).toBe(0);
    expect(result[0].median).toBe(0);
    expect(result[0].standardDeviation).toBe(0);
    expect(result[0].ratedGameCount).toBe(0);
    expect(result[0].histogram).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("median for even number of ratings averages middle two", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun" })];
    // Ratings: 3, 5, 7, 9 → median = (5+7)/2 = 6
    const games = [
      makeGame({ id: "g1", name: "G1", ratings: { a1: 3 } }),
      makeGame({ id: "g2", name: "G2", ratings: { a1: 5 } }),
      makeGame({ id: "g3", name: "G3", ratings: { a1: 7 } }),
      makeGame({ id: "g4", name: "G4", ratings: { a1: 9 } }),
    ];

    const result = computeCollectionProfileAxisDistributions(
      axes,
      makeDistributionResults(games, axes),
    );
    expect(result[0].median).toBe(6);
  });

  test("single rating returns that value for all statistics", () => {
    const axes = [makeAxis({ id: "a1", name: "Fun" })];
    const games = [makeGame({ id: "g1", name: "G1", ratings: { a1: 7 } })];

    const result = computeCollectionProfileAxisDistributions(
      axes,
      makeDistributionResults(games, axes),
    );
    expect(result[0].mean).toBe(7);
    expect(result[0].median).toBe(7);
    expect(result[0].standardDeviation).toBe(0);
    expect(result[0].range).toEqual({ min: 7, max: 7 });
  });

  test("includes BGG-sourced axis values in native scale from bggData", () => {
    const axes = [makeDerivedAxis("w", "Weight", "weight")];
    const games = [
      makeGame({ id: "g1", name: "G1", bggData: makeBggData({ weight: 2.5 }) }),
      makeGame({ id: "g2", name: "G2", bggData: makeBggData({ weight: 3.5 }) }),
      makeGame({ id: "g3", name: "G3", bggData: makeBggData({ weight: 4.0 }) }),
    ];

    const fitnessResults = makeDistributionResults(games, axes);
    setEffectiveRating(fitnessResults, "g1", 4);
    setEffectiveRating(fitnessResults, "g2", 6);
    setEffectiveRating(fitnessResults, "g3", 8);
    const result = computeCollectionProfileAxisDistributions(axes, fitnessResults);
    expect(result[0].ratedGameCount).toBe(3);
    expect(result[0].mean).toBe(6);
    expect(result[0].median).toBe(6);
    expect(result[0].range).toEqual({ min: 4, max: 8 });
  });

  test("prefers personal override for BGG axes when both exist", () => {
    const axes = [makeDerivedAxis("cr", "Rating", "communityRating")];
    const games = [
      makeGame({
        id: "g1",
        name: "G1",
        ratings: { cr: 9 },
        bggData: makeBggData({ communityRating: 7.0 }),
      }),
    ];

    const fitnessResults = makeDistributionResults(games, axes);
    setEffectiveRating(fitnessResults, "g1", 9);
    const result = computeCollectionProfileAxisDistributions(axes, fitnessResults);
    expect(result[0].ratedGameCount).toBe(1);
    expect(result[0].mean).toBe(9);
  });
});

function makeUsefulFitness(
  score: number,
  options: { vetoed?: boolean; predicted?: boolean } = {},
): FitnessResult {
  const result = makeFitness(score, options.vetoed ?? false);
  result.breakdown = [
    {
      axisId: "fun",
      axisName: "Fun",
      weight: 100,
      contribution: score,
      source: options.predicted ? "predicted" : "personal",
      derivedField: null,
      sourceValue: score,
      scoringRawValue: score,
      effectiveRating: score,
      preferenceShape: "higher-is-better",
      curveAffected: false,
      unit: "rating",
      provenance: null,
      configurationSummary: null,
      overridden: false,
      overrideValue: null,
      predictionConfidence: options.predicted ? "strong" : null,
      referenceGames: options.predicted ? [] : null,
    },
  ];
  result.predictionMeta = options.predicted
    ? {
        readinessStage: 3,
        confidence: "strong",
        predictedAxisCount: 1,
        actualAxisCount: 0,
        referenceGameCount: 3,
        coveragePercent: 100,
      }
    : null;
  return result;
}

function makeUsefulCollection(
  games: Game[],
  intentions: Collection["intentions"] = [],
): Collection {
  return {
    schemaVersion: 5,
    revision: 1,
    id: "collection",
    name: "Collection",
    axes: [makeAxis({ id: "fun", name: "Fun", weight: 100 })],
    games,
    intentions,
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

describe("computeCollectionProfile", () => {
  test("applies per-class support thresholds and overview limits", () => {
    const entityPolicy: CollectionProfileEntityPolicy = {
      mechanic: { overviewLimit: 1, minimumSupportedGames: 2 },
      designer: { overviewLimit: 2, minimumSupportedGames: 3 },
      artist: { overviewLimit: 3, minimumSupportedGames: 4 },
    };
    const links = [
      {
        mechanic: [
          { id: 101, name: "Mechanic A" },
          { id: 103, name: "Mechanic Limited" },
        ],
        designer: [
          { id: 201, name: "Designer A" },
          { id: 203, name: "Designer Limited" },
        ],
        artist: [
          { id: 301, name: "Artist A" },
          { id: 302, name: "Artist B" },
          { id: 303, name: "Artist C" },
          { id: 304, name: "Artist Limited" },
        ],
      },
      {
        mechanic: [
          { id: 101, name: "Mechanic A" },
          { id: 102, name: "Mechanic B" },
        ],
        designer: [
          { id: 201, name: "Designer A" },
          { id: 202, name: "Designer B" },
          { id: 203, name: "Designer Limited" },
        ],
        artist: [
          { id: 301, name: "Artist A" },
          { id: 302, name: "Artist B" },
          { id: 303, name: "Artist C" },
          { id: 304, name: "Artist Limited" },
        ],
      },
      {
        mechanic: [{ id: 102, name: "Mechanic B" }],
        designer: [
          { id: 201, name: "Designer A" },
          { id: 202, name: "Designer B" },
        ],
        artist: [
          { id: 301, name: "Artist A" },
          { id: 302, name: "Artist B" },
          { id: 303, name: "Artist C" },
          { id: 304, name: "Artist Limited" },
        ],
      },
      {
        mechanic: [],
        designer: [{ id: 202, name: "Designer B" }],
        artist: [
          { id: 301, name: "Artist A" },
          { id: 302, name: "Artist B" },
          { id: 303, name: "Artist C" },
        ],
      },
    ];
    const games = links.map((entities, index) =>
      makeGame({
        id: `policy-${index + 1}`,
        name: `Policy ${index + 1}`,
        bggId: index + 1,
        entityMetadata: createCompleteEntityMetadata(entities, "2026-08-29T00:00:00.000Z"),
      }),
    );
    const collection = makeUsefulCollection(games);
    const profile = computeCollectionProfile({
      collection,
      fitnessResults: new Map(games.map((game, index) => [game.id, makeUsefulFitness(9 - index)])),
      computedAt: "2026-08-29T01:00:00.000Z",
      entityPolicy,
    });

    expect(profile.identity.classes.mechanic.overviewEntityIds).toEqual([101]);
    expect(profile.identity.classes.designer.overviewEntityIds).toEqual([201, 202]);
    expect(profile.identity.classes.artist.overviewEntityIds).toEqual([301, 302, 303]);
    expect(
      profile.identity.classes.mechanic.entities.find(({ entityId }) => entityId === 103)?.support,
    ).toBe("limited");
    expect(
      profile.identity.classes.designer.entities.find(({ entityId }) => entityId === 203)?.support,
    ).toBe("limited");
    expect(
      profile.identity.classes.artist.entities.find(({ entityId }) => entityId === 304)?.support,
    ).toBe("limited");

    const snapshotSchema = createCollectionProfileSnapshotSchema(entityPolicy);
    expect(snapshotSchema.safeParse({ source: collection, profile }).success).toBe(true);
    for (const entityClass of ["mechanic", "designer", "artist"] as const) {
      const result = profile.identity.classes[entityClass];
      const inconsistentProfile = structuredClone(profile);
      inconsistentProfile.identity.classes[entityClass].overviewEntityIds.pop();
      expect(
        snapshotSchema.safeParse({ source: collection, profile: inconsistentProfile }).success,
        `${entityClass} inconsistent overview`,
      ).toBe(false);
      expect(result.result).toBe("supported");
    }
  });

  test("reproduces class arithmetic, canonical names, exclusions, and deterministic orderings", () => {
    const complete = (
      mechanic: { id: number; name: string }[],
      designer: { id: number; name: string }[],
      artist: { id: number; name: string }[],
      observedAt: string,
    ) => createCompleteEntityMetadata({ mechanic, designer, artist }, observedAt);
    const games = [
      makeGame({
        id: "g1",
        name: "Alpha",
        bggId: 1,
        entityMetadata: complete(
          [
            { id: 100, name: "Cafe\u0301" },
            { id: 400, name: "😀" },
            { id: 401, name: "Zed" },
          ],
          [{ id: 500, name: "Designer" }],
          [{ id: 600, name: "Artist A" }],
          "2026-08-25T00:00:00.000Z",
        ),
      }),
      makeGame({
        id: "g2",
        name: "Beta",
        bggId: 2,
        entityMetadata: complete(
          [{ id: 100, name: "Café" }],
          [{ id: 500, name: "Designer" }],
          [{ id: 601, name: "Artist B" }],
          "2026-08-26T00:00:00.000Z",
        ),
      }),
      makeGame({
        id: "g3",
        name: "Gamma",
        bggId: 3,
        entityMetadata: complete(
          [
            { id: 100, name: "Older Name" },
            { id: 200, name: "Veto Mechanic" },
          ],
          [{ id: 500, name: "Designer" }],
          [{ id: 600, name: "Artist A" }],
          "2026-08-24T00:00:00.000Z",
        ),
      }),
      makeGame({
        id: "g4",
        name: "Predicted",
        bggId: 4,
        entityMetadata: complete(
          [
            { id: 100, name: "Aardvark" },
            { id: 200, name: "Veto Mechanic" },
          ],
          [],
          [],
          "2026-08-26T00:00:00.000Z",
        ),
      }),
      makeGame({
        id: "g5",
        name: "Unrated",
        bggId: 5,
        entityMetadata: complete(
          [{ id: 300, name: "Unrated Mechanic" }],
          [],
          [],
          "2026-08-27T00:00:00.000Z",
        ),
      }),
      makeGame({ id: "g6", name: "Needs Refresh", bggId: 6 }),
      makeGame({ id: "g7", name: "Manual", bggId: null }),
      makeGame({
        id: "old",
        name: "Previously Owned",
        ownership: "previously-owned",
        bggId: 8,
        entityMetadata: complete(
          [{ id: 999, name: "Ignored" }],
          [{ id: 999, name: "Ignored" }],
          [{ id: 999, name: "Ignored" }],
          "2026-08-28T00:00:00.000Z",
        ),
      }),
    ];
    const collection = makeUsefulCollection(games);
    const fitnessResults = new Map<string, FitnessResult>([
      ["g1", makeUsefulFitness(8)],
      ["g2", makeUsefulFitness(6)],
      ["g3", makeUsefulFitness(0, { vetoed: true })],
      ["g4", makeUsefulFitness(7, { predicted: true })],
      ["g6", makeUsefulFitness(5)],
      ["g7", makeUsefulFitness(4)],
      ["old", makeUsefulFitness(10)],
    ]);

    const profile = computeCollectionProfile({
      collection,
      fitnessResults,
      computedAt: "2026-08-28T12:00:00.000Z",
    });
    const mechanic = profile.identity.classes.mechanic;
    expect(mechanic.metadataReadiness).toEqual({
      state: "partial",
      ownedGameCount: 7,
      completeGameCount: 5,
      refreshNeededGameCount: 1,
      unrefreshableGameCount: 1,
    });
    expect(mechanic.comparator.games.map(({ gameId }) => gameId)).toEqual(["g1", "g2", "g3"]);
    expect(mechanic.comparator.meanCurrentFitness).toBe(14 / 3);
    expect(mechanic.exclusions.map(({ reason }) => reason)).toEqual([
      "predicted-fitness",
      "missing-or-invalid-fitness",
      "refresh-needed-metadata",
      "unrefreshable-metadata",
    ]);
    expect(mechanic.associatedGameCount).toBe(5);
    const cafe = mechanic.entities.find(({ entityId }) => entityId === 100);
    expect(cafe).toMatchObject({
      name: "Aardvark",
      support: "supported",
      associatedGameCount: 3,
      meanCurrentFitness: 14 / 3,
      range: { min: 0, max: 8 },
      comparatorMeanCurrentFitness: 14 / 3,
      differenceFromComparator: 0,
    });
    expect(cafe?.populationStandardDeviation).toBe(
      Math.sqrt(((8 - 14 / 3) ** 2 + (6 - 14 / 3) ** 2 + (0 - 14 / 3) ** 2) / 3),
    );
    expect(cafe?.games.map(({ gameId }) => gameId)).toEqual(["g1", "g2", "g3"]);
    expect(cafe?.games[2]).toMatchObject({ currentFitness: 0, vetoed: true });
    expect(mechanic.orderings.name).toEqual([100, 200, 401, 400]);
    expect(mechanic.overviewEntityIds).toEqual([100]);
    expect(profile.identity.classes.designer.result).toBe("supported");
    expect(profile.identity.classes.artist.result).toBe("limited");
    expect(profile.identity.axisDistributions[0].ratedGameCount).toBe(6);
    expect(CollectionProfileResultSchema.safeParse(profile).success).toBe(true);
    const snapshot = CollectionProfileSnapshotSchema.safeParse({ source: collection, profile });
    if (!snapshot.success) throw snapshot.error;
  });

  test("defensively counts duplicate entity links from one game once", () => {
    const game = makeGame({
      id: "duplicate",
      name: "Duplicate Source",
      bggId: 1,
      entityMetadata: createCompleteEntityMetadata(
        {
          mechanic: [
            { id: 100, name: "Mechanic" },
            { id: 100, name: "Mechanic" },
          ],
          designer: [],
          artist: [],
        },
        "2026-08-27T00:00:00.000Z",
      ),
    });
    const profile = computeCollectionProfile({
      collection: makeUsefulCollection([game]),
      fitnessResults: new Map([[game.id, makeUsefulFitness(1e-7)]]),
      computedAt: "2026-08-28T00:00:00.000Z",
    });

    expect(profile.identity.classes.mechanic.entities[0]).toMatchObject({
      associatedGameCount: 1,
      games: [{ gameId: game.id }],
    });
    expect(CollectionProfileResultSchema.safeParse(profile).success).toBe(true);
  });

  test("keeps active intentions visible with exact evidence warnings and no time-based ordering", () => {
    const metadata = createCompleteEntityMetadata(
      { mechanic: [], designer: [], artist: [] },
      "2026-08-27T00:00:00.000Z",
    );
    const valid = makeGame({
      id: "valid",
      name: "😀 Game",
      bggId: 1,
      entityMetadata: metadata,
      numPlays: 0,
      playCountEvidence: {
        status: "valid",
        value: 0,
        source: "manual",
        observedAt: "2026-08-27T01:00:00.000Z",
      },
    });
    const stale = makeGame({
      id: "stale",
      name: "Zed",
      bggId: 2,
      entityMetadata: metadata,
      numPlays: 2,
      playCountEvidence: {
        status: "valid",
        value: 2,
        source: "bgg-collection",
        observedAt: "2026-08-27T01:00:00.000Z",
      },
      latestPlayCountCheck: {
        status: "missing",
        observedAt: "2026-08-27T02:00:00.000Z",
      },
    });
    const intentions: Collection["intentions"] = [
      {
        intentionId: "newer",
        gameId: valid.id,
        kind: "first-play",
        baseline: {
          playCount: 0,
          evidenceSource: "manual",
          observedAt: "2026-08-27T01:00:00.000Z",
        },
        createdAt: "2036-01-01T00:00:00.000Z",
        version: 1,
        resolution: null,
      },
      {
        intentionId: "older",
        gameId: stale.id,
        kind: "replay",
        baseline: {
          playCount: 2,
          evidenceSource: "bgg-collection",
          observedAt: "2026-08-27T01:00:00.000Z",
        },
        createdAt: "2026-08-27T01:01:00.000Z",
        version: 1,
        resolution: null,
      },
    ];
    const collection = makeUsefulCollection([valid, stale], intentions);
    const first = computeCollectionProfile({
      collection,
      fitnessResults: new Map(),
      computedAt: "2026-08-28T00:00:00.000Z",
    });
    const advanced = computeCollectionProfile({
      collection,
      fitnessResults: new Map(),
      computedAt: "2099-08-28T00:00:00.000Z",
    });

    expect(first.attention.items.map(({ gameName }) => gameName)).toEqual(["Zed", "😀 Game"]);
    expect(first.attention.items[0]).toMatchObject({
      question: "Do you still intend to replay Zed?",
      currentPlayEvidence: {
        status: "stale",
        warning: "A newer BGG check did not provide a valid play count.",
      },
      evidenceDestination: { operationId: "shelf.game.bgg.refresh" },
    });
    expect(first.attention).toEqual(advanced.attention);
    expect(first.identity).toEqual(advanced.identity);
    expect(
      CollectionProfileSnapshotSchema.safeParse({ source: collection, profile: first }).success,
    ).toBe(true);
  });

  test("distinguishes empty collection from populated nothing-to-decide", () => {
    const emptyCollection = makeUsefulCollection([
      makeGame({ id: "old", name: "Old", ownership: "previously-owned" }),
    ]);
    const empty = computeCollectionProfile({
      collection: emptyCollection,
      fitnessResults: new Map(),
      computedAt: "2026-08-28T00:00:00.000Z",
    });
    const populatedCollection = makeUsefulCollection([makeGame({ id: "owned", name: "Owned" })]);
    const populated = computeCollectionProfile({
      collection: populatedCollection,
      fitnessResults: new Map(),
      computedAt: "2026-08-28T00:00:00.000Z",
    });

    expect(empty.identity.collectionState).toBe("empty");
    expect(empty.attention.state).toBe("empty-collection");
    expect(populated.identity.collectionState).toBe("populated");
    expect(populated.attention.state).toBe("nothing-to-decide");
    expect(empty.identity.classes.mechanic.result).toBe("not-evaluated");
    expect(populated.identity.classes.mechanic.result).toBe("not-evaluated");
    expect(empty.attention.items).toEqual([]);
    expect(populated.attention.items).toEqual([]);
    expect(
      CollectionProfileSnapshotSchema.safeParse({ source: emptyCollection, profile: empty })
        .success,
    ).toBe(true);
    expect(
      CollectionProfileSnapshotSchema.safeParse({
        source: populatedCollection,
        profile: populated,
      }).success,
    ).toBe(true);
  });

  test("projects missing and invalid attention evidence without hiding intentions", () => {
    const missing = makeGame({ id: "missing", name: "Missing", bggId: null });
    const invalidEvidence = { presence: "present" as const, value: "not-a-count" };
    const invalid = makeGame({
      id: "invalid",
      name: "Invalid",
      bggId: 2,
      entityMetadata: createCompleteEntityMetadata(
        { mechanic: [], designer: [], artist: [] },
        "2026-08-27T00:00:00.000Z",
      ),
      playCountEvidence: {
        status: "invalid",
        evidence: invalidEvidence,
        source: "bgg-collection",
        observedAt: "2026-08-27T02:00:00.000Z",
      },
      latestPlayCountCheck: {
        status: "invalid",
        evidence: invalidEvidence,
        observedAt: "2026-08-27T02:00:00.000Z",
      },
    });
    const intentions: Collection["intentions"] = [
      {
        intentionId: "missing-intention",
        gameId: missing.id,
        kind: "first-play",
        baseline: {
          playCount: 0,
          evidenceSource: "manual",
          observedAt: "2026-08-27T01:00:00.000Z",
        },
        createdAt: "2026-08-27T01:01:00.000Z",
        version: 1,
        resolution: null,
      },
      {
        intentionId: "invalid-intention",
        gameId: invalid.id,
        kind: "replay",
        baseline: {
          playCount: 1,
          evidenceSource: "bgg-collection",
          observedAt: "2026-08-27T01:00:00.000Z",
        },
        createdAt: "2026-08-27T01:01:00.000Z",
        version: 1,
        resolution: null,
      },
    ];
    const collection = makeUsefulCollection([missing, invalid], intentions);
    const profile = computeCollectionProfile({
      collection,
      fitnessResults: new Map(),
      computedAt: "2026-08-28T00:00:00.000Z",
    });

    expect(profile.attention.items).toHaveLength(2);
    expect(profile.attention.items.find(({ gameName }) => gameName === "Missing")).toMatchObject({
      currentPlayEvidence: {
        status: "missing",
        warning: "Current play evidence is missing.",
      },
      evidenceDestination: { operationId: "shelf.game.plays.set" },
    });
    expect(profile.attention.items.find(({ gameName }) => gameName === "Invalid")).toMatchObject({
      currentPlayEvidence: {
        status: "invalid",
        warning: "Current play evidence is invalid.",
      },
      evidenceDestination: { operationId: "shelf.game.bgg.refresh" },
    });
    expect(CollectionProfileSnapshotSchema.safeParse({ source: collection, profile }).success).toBe(
      true,
    );
  });

  test("distinguishes complete-empty, no eligible ratings, and refresh-failed metadata", () => {
    const completeEmpty = createCompleteEntityMetadata(
      { mechanic: [], designer: [], artist: [] },
      "2026-08-27T00:00:00.000Z",
    );
    const completeAssociated = createCompleteEntityMetadata(
      {
        mechanic: [{ id: 100, name: "Known Mechanic" }],
        designer: [],
        artist: [],
      },
      "2026-08-27T00:00:00.000Z",
    );
    for (const metadata of Object.values(completeAssociated)) {
      metadata.refreshFailure = {
        attemptedAt: "2026-08-28T00:00:00.000Z",
        message: "BGG refresh failed",
      };
    }
    const games = [
      makeGame({
        id: "empty",
        name: "Complete Empty",
        bggId: 1,
        entityMetadata: completeEmpty,
      }),
      makeGame({
        id: "associated",
        name: "Associated",
        bggId: 2,
        entityMetadata: completeAssociated,
      }),
    ];
    const collection = makeUsefulCollection(games);
    const profile = computeCollectionProfile({
      collection,
      fitnessResults: new Map(),
      computedAt: "2026-08-28T01:00:00.000Z",
    });

    expect(profile.identity.classes.mechanic.result).toBe("no-eligible-ratings");
    expect(profile.identity.classes.designer.result).toBe("evaluated-empty");
    expect(profile.identity.classes.mechanic.refreshWarnings).toEqual([
      {
        gameId: "associated",
        gameName: "Associated",
        attemptedAt: "2026-08-28T00:00:00.000Z",
        message: "BGG refresh failed",
      },
    ]);
    expect(CollectionProfileSnapshotSchema.safeParse({ source: collection, profile }).success).toBe(
      true,
    );
  });

  test("uses exact means before deterministic tie-breakers", () => {
    const entries = [
      ["g1", "Zulu", 100, 0.1],
      ["g2", "Zulu", 100, 0.2],
      ["g3", "Zulu", 100, 0.3],
      ["g4", "Alpha", 200, 0.2],
      ["g5", "Alpha", 200, 0.3],
      ["g6", "Alpha", 200, 0.1],
    ] as const;
    const games = entries.map(([id, entityName, entityId]) =>
      makeGame({
        id,
        name: id,
        bggId: Number(id.slice(1)),
        entityMetadata: createCompleteEntityMetadata(
          {
            mechanic: [{ id: entityId, name: entityName }],
            designer: [],
            artist: [],
          },
          "2026-08-27T00:00:00.000Z",
        ),
      }),
    );
    const collection = makeUsefulCollection(games);
    const profile = computeCollectionProfile({
      collection,
      fitnessResults: new Map(entries.map(([id, , , score]) => [id, makeUsefulFitness(score)])),
      computedAt: "2026-08-28T00:00:00.000Z",
    });

    expect(profile.identity.classes.mechanic.orderings.rating).toEqual([200, 100]);
    expect(profile.identity.classes.mechanic.overviewEntityIds).toEqual([200, 100]);
    expect(
      profile.identity.classes.mechanic.entities.map(
        ({ meanCurrentFitness }) => meanCurrentFitness,
      ),
    ).toEqual([0.2, 0.2]);
    expect(CollectionProfileSnapshotSchema.safeParse({ source: collection, profile }).success).toBe(
      true,
    );
  });

  test("keeps aggregates finite for subnormal eligible scores", () => {
    const games = ["tiny", "ten"].map((id, index) =>
      makeGame({
        id,
        name: id,
        bggId: index + 1,
        entityMetadata: createCompleteEntityMetadata(
          {
            mechanic: [{ id: 100, name: "Mechanic" }],
            designer: [],
            artist: [],
          },
          "2026-08-27T00:00:00.000Z",
        ),
      }),
    );
    const collection = makeUsefulCollection(games);
    const profile = computeCollectionProfile({
      collection,
      fitnessResults: new Map([
        ["tiny", makeUsefulFitness(5e-324)],
        ["ten", makeUsefulFitness(10)],
      ]),
      computedAt: "2026-08-28T00:00:00.000Z",
    });

    expect(profile.identity.classes.mechanic.comparator.meanCurrentFitness).toBe(5);
    expect(profile.identity.classes.mechanic.entities[0].meanCurrentFitness).toBe(5);
    expect(CollectionProfileSnapshotSchema.safeParse({ source: collection, profile }).success).toBe(
      true,
    );
  });
});
