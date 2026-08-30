import {
  AxisSchema,
  CollectionProfileResultSchema,
  GameDetailWithPurchaseUtilizationSchema,
  IntentionMutationResultSchema,
  calculatePurchaseUtilization,
  type CollectionProfileResult,
  type Game,
  type GameDetailWithPurchaseUtilization,
  type GameWithPurchaseUtilization,
  type NichePosition,
  type PlayIntention,
  type PurchaseUtilizationResult,
  type ResolvedPlayIntentionHistory,
  type TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import {
  emptyUsefulProfileFixture,
  unavailableUsefulProfileFixture,
  warningUsefulProfileFixture,
} from "../../shared/tests/fixtures/useful-profile";

const socketPath = process.env.SHELF_JUDGE_SOCKET;
if (socketPath === undefined) throw new Error("SHELF_JUDGE_SOCKET is required");

const observedAt = "2026-08-28T10:00:00.000Z";
const externalObservedAt = "2026-08-28T10:05:00.000Z";
const createdAt = "2026-08-28T10:01:00.000Z";
const resolvedAt = "2026-08-28T12:00:00.000Z";
const gameId = "game-4";

type Scenario =
  | "profile"
  | "empty"
  | "unavailable"
  | "create"
  | "active"
  | "stale"
  | "collection"
  | "manual-values";

interface ManualValuesFixtureState {
  blockNextMutation: boolean;
  blockNextDetail: boolean;
  failNextMutation: boolean;
  releaseMutation: (() => void) | null;
  releaseDetail: (() => void) | null;
  mutationBodies: Record<string, unknown>[];
  activeMutations: number;
  maxActiveMutations: number;
}

interface CollectionFixtureState {
  deletedIds: Set<string>;
  previouslyOwnedIds: Set<string>;
  empty: boolean;
  axesAvailable: boolean;
  tournamentAvailable: boolean;
  predictionsAvailable: boolean;
  nichesAvailable: boolean;
  integratedRedundancy: boolean;
}

const axis = AxisSchema.parse({
  id: "axis-enjoyment",
  name: "Enjoyment",
  description: "How much I enjoy playing",
  weight: 1,
  enabled: true,
  source: "personal",
  createdAt,
  updatedAt: createdAt,
});

const profileFixture: CollectionProfileResult = (() => {
  const profile = structuredClone(warningUsefulProfileFixture);
  const mechanic = profile.identity.classes.mechanic;
  const workerPlacement = mechanic.entities.find(({ entityId }) => entityId === 101);
  if (workerPlacement === undefined) throw new Error("Expected mechanic fixture evidence");
  const generatedEntities = Array.from({ length: 167 }, (_, index) => ({
    ...structuredClone(workerPlacement),
    entityId: 1_000 + index,
    name: `Worker Placement Variant ${String(index + 1).padStart(3, "0")}`,
  }));
  mechanic.entities = [workerPlacement, ...generatedEntities];
  const productionOrder = mechanic.entities.map(({ entityId }) => entityId);
  mechanic.orderings = {
    rating: productionOrder,
    support: productionOrder,
    name: productionOrder,
  };
  mechanic.overviewEntityIds = productionOrder.slice(0, 3);
  profile.identity.axisDistributions = [
    {
      axisId: axis.id,
      axisName: axis.name,
      mean: 6,
      median: 6,
      standardDeviation: Math.sqrt(8),
      range: { min: 2, max: 10 },
      ratedGameCount: 4,
      histogram: [0, 1, 0, 0, 0, 2, 0, 0, 0, 1],
    },
  ];
  return CollectionProfileResultSchema.parse(profile);
})();

function baseGame(): Game {
  const completeEmptyMetadata = {
    state: "complete" as const,
    entities: [],
    observedAt,
    refreshFailure: null,
    correctionDestination: null,
  };
  return {
    id: gameId,
    bggId: null,
    name: "Heat: Pedal to the Metal With A Deliberately Long Fixture Name",
    yearPublished: 2022,
    minPlayers: 1,
    maxPlayers: 6,
    bestPlayers: 5,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: 0,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt },
    durationEvidence: { status: "valid", value: 60, source: "manual", observedAt },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 1, maxPlayers: 6 },
      source: "manual",
      observedAt,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    entityMetadata: {
      mechanic: completeEmptyMetadata,
      designer: completeEmptyMetadata,
      artist: completeEmptyMetadata,
    },
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: { [axis.id]: 6 },
    createdAt,
    updatedAt: createdAt,
  };
}

interface CollectionDefinition {
  readonly id: string;
  readonly name: string;
  readonly score: number | null;
  readonly plays: number;
  readonly players: readonly [number, number];
  readonly dimensions: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
  } | null;
  readonly remaining: string | null;
  readonly additional: string | null;
  readonly previouslyOwned?: boolean;
}

const collectionDefinitions: readonly CollectionDefinition[] = [
  {
    id: "game-1",
    name: "Atlas Equal",
    score: 8,
    plays: 0,
    players: [1, 2] as const,
    dimensions: null,
    remaining: "600",
    additional: "9",
  },
  {
    id: "game-2",
    name: "Borealis: A Deliberately Long Collection Game Name for Responsive Navigation Evidence",
    score: 8,
    plays: 0,
    players: [2, 4] as const,
    dimensions: null,
    remaining: "200",
    additional: "3",
  },
  {
    id: "game-3",
    name: "Cinder Equal",
    score: 8,
    plays: 2,
    players: [2, 5] as const,
    dimensions: { width: 12, height: 12, depth: 3 },
    remaining: "200",
    additional: "3",
  },
  {
    id: "game-5",
    name: "Distant Previously Owned",
    score: 7,
    plays: 0,
    players: [1, 2] as const,
    dimensions: null,
    remaining: "400",
    additional: "6",
    previouslyOwned: true,
  },
  {
    id: "game-6",
    name: "Isolated Beacon",
    score: null,
    plays: 0,
    players: [2, 2] as const,
    dimensions: null,
    remaining: null,
    additional: null,
  },
  {
    id: "game-7",
    name: "Zephyr Mutable Target With Another Exceptionally Long Name for Full Accessible Labels",
    score: 5,
    plays: 4,
    players: [3, 6] as const,
    dimensions: { width: 10, height: 10, depth: 2 },
    remaining: null,
    additional: "12",
  },
];

function collectionGame(definition: CollectionDefinition): Game {
  const game = baseGame();
  const ownership =
    definition.previouslyOwned === true || collectionState.previouslyOwnedIds.has(definition.id)
      ? "previously-owned"
      : "owned";
  return {
    ...game,
    id: definition.id,
    name: definition.name,
    yearPublished: 2010 + Number(definition.id.slice(5)),
    minPlayers: definition.players[0],
    maxPlayers: definition.players[1],
    bestPlayers: definition.players[0],
    playingTime: definition.score === null ? null : 30 + Number(definition.id.slice(5)) * 10,
    numPlays: definition.plays,
    playCountEvidence: {
      status: "valid",
      value: definition.plays,
      source: "manual",
      observedAt,
    },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: definition.players[0], maxPlayers: definition.players[1] },
      source: "manual",
      observedAt,
    },
    boxDimensions: definition.dimensions,
    ownership,
    ratings: definition.score === null ? {} : { [axis.id]: definition.score },
    updatedAt: `2026-08-${String(10 + Number(definition.id.slice(5))).padStart(2, "0")}T10:00:00.000Z`,
  };
}

function utilization(game: Game, definition: CollectionDefinition): PurchaseUtilizationResult {
  const base = calculatePurchaseUtilization({
    acquisition: game.acquisition,
    entertainmentBenchmark: null,
    playCount: game.playCountEvidence,
    duration: game.durationEvidence,
    playerRange: game.playerRangeEvidence,
    suggestedPlayerPoll: game.suggestedPlayerPoll,
    fitness: definition.score === null ? null : definition.score.toFixed(1),
  });
  const valueRemaining: PurchaseUtilizationResult["components"]["valueRemaining"] =
    definition.remaining === null
      ? { label: "Value remaining", outcome: "unavailable", display: "Unavailable", reasons: [] }
      : {
          label: "Value remaining",
          outcome: "calculated",
          value: { exact: { numerator: definition.remaining, denominator: "1" } },
          display: `$${definition.remaining}`,
          reasons: [],
        };
  const estimatedAdditionalPlays: PurchaseUtilizationResult["components"]["estimatedAdditionalPlays"] =
    definition.additional === null
      ? {
          label: "Estimated additional plays to value threshold",
          outcome: "unavailable",
          display: "Unavailable",
          reasons: [],
        }
      : {
          label: "Estimated additional plays to value threshold",
          outcome: "calculated",
          value: { wholePlays: definition.additional },
          display: definition.additional,
          reasons: [],
        };
  return {
    ...base,
    components: { ...base.components, valueRemaining, estimatedAdditionalPlays },
    sort: {
      valueRemainingHundredths: definition.remaining,
      estimatedAdditionalPlays:
        definition.additional === null
          ? { category: "unavailable", wholePlays: null }
          : { category: "finite", wholePlays: definition.additional },
    },
  };
}

function score(definition: CollectionDefinition, predicted: boolean) {
  if (definition.score === null && !predicted) return null;
  const value = definition.score ?? 6.5;
  return {
    score: predicted ? value + 0.25 : value,
    ratedAxisCount: definition.score === null ? 0 : 1,
    totalAxisCount: 1,
    breakdown: [],
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: predicted
      ? {
          readinessStage: 3 as const,
          confidence: "strong" as const,
          predictedAxisCount: definition.score === null ? 1 : 0,
          actualAxisCount: definition.score === null ? 0 : 1,
          referenceGameCount: 4,
          coveragePercent: 1,
        }
      : null,
    redundancyAdjustment: {
      penalty: Number(definition.id.slice(5)) / 10,
      originalScore: value,
      adjustedScore: value - Number(definition.id.slice(5)) / 10,
      nicheNeighbors: [],
      nicheRank: 1,
      nicheSize: 2,
    },
  };
}

function neighbor(definition: CollectionDefinition) {
  return {
    gameId: definition.id,
    gameName: definition.name,
    fitnessScore: definition.score ?? 6.5,
    isPredicted: definition.score === null,
  };
}

function nichePosition(definition: CollectionDefinition): NichePosition {
  const atlas = collectionDefinitions[0];
  const borealis = collectionDefinitions[1];
  if (atlas === undefined || borealis === undefined)
    throw new Error("Collection fixture is incomplete");
  const shared = {
    type: "mechanic" as const,
    name: "Shared Strategy",
    size: 4,
    rank: Number(definition.id.slice(5)),
    isChampion: definition.id === atlas.id,
    champion: neighbor(atlas),
    above: definition.id === atlas.id ? [] : [neighbor(atlas)],
    below: definition.id === borealis.id ? [] : [neighbor(borealis)],
  };
  const niches: NichePosition["niches"] = [shared];
  if (definition.id === atlas.id || definition.id === borealis.id) {
    niches.push({ ...shared, type: "category", name: "Duplicate Membership" });
  }
  return { niches };
}

function collectionEntry(
  definition: CollectionDefinition,
  options: { predicted: boolean; niches: boolean },
): GameWithPurchaseUtilization {
  const game = collectionGame(definition);
  const fitness = score(definition, options.predicted);
  return {
    game,
    score: fitness,
    displayScore: fitness === null ? null : fitness.score.toFixed(1),
    purchaseUtilization: utilization(game, definition),
    nichePosition: options.niches ? nichePosition(definition) : null,
  };
}

function collectionEntries(
  options: {
    predicted?: boolean;
    niches?: boolean;
  } = {},
): GameWithPurchaseUtilization[] {
  if (collectionState.empty) return [];
  return collectionDefinitions
    .filter(({ id }) => !collectionState.deletedIds.has(id))
    .map((definition) =>
      collectionEntry(definition, {
        predicted: options.predicted === true,
        niches: options.niches === true,
      }),
    );
}

function tournamentStats(definition: CollectionDefinition): TournamentGameStatsDisplay {
  const value = 4 + Number(definition.id.slice(5)) / 2;
  return {
    eloRating: 1400 + value * 20,
    comparisonCount: 8,
    normalizedScore: value,
    isProvisional: false,
    displayLabel: value.toFixed(1),
    wins: 4,
    losses: 4,
    recentComparisons: [],
  };
}

function activeIntention(id = "intention-browser-1"): PlayIntention {
  return {
    intentionId: id,
    gameId,
    kind: "first-play",
    baseline: { playCount: 0, evidenceSource: "manual", observedAt },
    createdAt,
    version: 1,
    resolution: null,
  };
}

let scenario: Scenario = "profile";
let game = baseGame();
let active: PlayIntention | null = activeIntention();
let history: ResolvedPlayIntentionHistory = [];
let staleOnce = false;
let intentionSequence = 1;
let collectionState: CollectionFixtureState = createCollectionState();
let manualValuesState: ManualValuesFixtureState = createManualValuesState();

function createCollectionState(): CollectionFixtureState {
  return {
    deletedIds: new Set(),
    previouslyOwnedIds: new Set(),
    empty: false,
    axesAvailable: true,
    tournamentAvailable: true,
    predictionsAvailable: true,
    nichesAvailable: true,
    integratedRedundancy: false,
  };
}

function createManualValuesState(): ManualValuesFixtureState {
  return {
    blockNextMutation: false,
    blockNextDetail: false,
    failNextMutation: false,
    releaseMutation: null,
    releaseDetail: null,
    mutationBodies: [],
    activeMutations: 0,
    maxActiveMutations: 0,
  };
}

async function waitForManualValuesRelease(kind: "mutation" | "detail"): Promise<void> {
  const blockKey = kind === "mutation" ? "blockNextMutation" : "blockNextDetail";
  const releaseKey = kind === "mutation" ? "releaseMutation" : "releaseDetail";
  if (!manualValuesState[blockKey]) return;
  manualValuesState[blockKey] = false;
  await new Promise<void>((resolve) => {
    manualValuesState[releaseKey] = resolve;
  });
  manualValuesState[releaseKey] = null;
}

function reset(next: Scenario): void {
  scenario = next;
  game = baseGame();
  history = [];
  staleOnce = next === "stale";
  active = next === "active" || next === "stale" || next === "profile" ? activeIntention() : null;
  intentionSequence = 1;
  collectionState = createCollectionState();
  manualValuesState = createManualValuesState();
  if (next === "manual-values") {
    game.manualValues = {
      playingTime: { value: 90, source: "manual", confirmedAt: observedAt },
      playerCount: { value: 4, source: "manual", confirmedAt: observedAt },
    };
  }
}

function detail(requestedGameId = gameId): GameDetailWithPurchaseUtilization {
  const definition = collectionDefinitions.find(({ id }) => id === requestedGameId);
  const detailGame = definition === undefined ? game : collectionGame(definition);
  const detailScore =
    definition === undefined
      ? {
          score: 6,
          ratedAxisCount: 1,
          totalAxisCount: 1,
          breakdown: [],
          vetoed: false,
          vetoedBy: null,
          hypotheticalScore: null,
          predictionMeta: null,
          redundancyAdjustment: null,
        }
      : score(definition, false);
  return GameDetailWithPurchaseUtilizationSchema.parse({
    game: detailGame,
    score: detailScore,
    bggDataStale: false,
    nichePosition: definition === undefined ? null : nichePosition(definition),
    displayScore: detailScore?.score.toFixed(1) ?? null,
    purchaseUtilization:
      definition === undefined
        ? calculatePurchaseUtilization({
            acquisition: detailGame.acquisition,
            entertainmentBenchmark: null,
            playCount: detailGame.playCountEvidence,
            duration: detailGame.durationEvidence,
            playerRange: detailGame.playerRangeEvidence,
            suggestedPlayerPoll: detailGame.suggestedPlayerPoll,
            fitness: "6.0",
          })
        : utilization(detailGame, definition),
    intentions: {
      activeIntention: requestedGameId === gameId ? active : null,
      resolvedHistory: requestedGameId === gameId ? history : [],
    },
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const value = (await request.json()) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function resolveIntention(
  intention: PlayIntention,
  outcome: "completed" | "retired",
): PlayIntention {
  return {
    ...intention,
    version: intention.version + 1,
    resolution:
      outcome === "completed"
        ? { outcome, source: "owner-confirmed", resolvedAt }
        : { outcome, source: "owner-retired", resolvedAt },
  };
}

function resolvedHistoryItem(intention: PlayIntention) {
  if (intention.resolution === null) throw new Error("Expected a resolved fixture intention");
  return { ...intention, gameName: game.name, resolution: intention.resolution };
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/test/reset" && request.method === "POST") {
    const requested = (await body(request)).scenario;
    if (
      requested !== "profile" &&
      requested !== "empty" &&
      requested !== "unavailable" &&
      requested !== "create" &&
      requested !== "active" &&
      requested !== "stale" &&
      requested !== "collection" &&
      requested !== "manual-values"
    ) {
      return json({ error: "Unknown fixture scenario" }, 400);
    }
    reset(requested);
    return json({ scenario });
  }

  if (path === "/api/test/manual-values-state") {
    if (request.method === "GET") {
      return json({
        mutationBodies: manualValuesState.mutationBodies,
        activeMutations: manualValuesState.activeMutations,
        maxActiveMutations: manualValuesState.maxActiveMutations,
      });
    }
    if (request.method === "POST") {
      const requested = await body(request);
      if (typeof requested.blockNextMutation === "boolean") {
        manualValuesState.blockNextMutation = requested.blockNextMutation;
      }
      if (typeof requested.blockNextDetail === "boolean") {
        manualValuesState.blockNextDetail = requested.blockNextDetail;
      }
      if (typeof requested.failNextMutation === "boolean") {
        manualValuesState.failNextMutation = requested.failNextMutation;
      }
      if (typeof requested.externalPlayingTime === "number") {
        game.manualValues.playingTime = {
          value: requested.externalPlayingTime,
          source: "manual",
          confirmedAt: externalObservedAt,
        };
      }
      if (typeof requested.externalPlayerCount === "number") {
        game.manualValues.playerCount = {
          value: requested.externalPlayerCount,
          source: "manual",
          confirmedAt: externalObservedAt,
        };
      }
      if (requested.releaseMutation === true) manualValuesState.releaseMutation?.();
      if (requested.releaseDetail === true) manualValuesState.releaseDetail?.();
      return json({ ok: true });
    }
  }

  if (path === "/api/test/collection-state" && request.method === "POST") {
    const requested = await body(request);
    if (Array.isArray(requested.deletedIds)) {
      collectionState.deletedIds = new Set(
        requested.deletedIds.filter((id): id is string => typeof id === "string"),
      );
    }
    if (Array.isArray(requested.previouslyOwnedIds)) {
      collectionState.previouslyOwnedIds = new Set(
        requested.previouslyOwnedIds.filter((id): id is string => typeof id === "string"),
      );
    }
    for (const field of [
      "empty",
      "axesAvailable",
      "tournamentAvailable",
      "predictionsAvailable",
      "nichesAvailable",
      "integratedRedundancy",
    ] as const) {
      if (typeof requested[field] === "boolean") collectionState[field] = requested[field];
    }
    return json({ ok: true });
  }

  if (path === "/api/profile" && request.method === "GET") {
    const response =
      scenario === "empty"
        ? emptyUsefulProfileFixture
        : scenario === "unavailable"
          ? unavailableUsefulProfileFixture
          : profileFixture;
    return json(CollectionProfileResultSchema.parse(response));
  }

  if (path === "/api/games" && request.method === "GET") {
    const predicted = url.searchParams.get("includePredicted") === "true";
    const niches = url.searchParams.get("includeNiches") === "true";
    if (predicted && !collectionState.predictionsAvailable)
      return json({ error: "Predictions unavailable" }, 503);
    if (niches && !collectionState.nichesAvailable)
      return json({ error: "Niches unavailable" }, 503);
    return json(collectionEntries({ predicted, niches }));
  }
  const detailMatch = path.match(/^\/api\/games\/([^/]+)$/);
  if (detailMatch !== null && request.method === "GET") {
    const requestedGameId = decodeURIComponent(detailMatch[1] ?? "");
    if (
      collectionState.deletedIds.has(requestedGameId) ||
      (scenario === "collection" && !collectionDefinitions.some(({ id }) => id === requestedGameId))
    ) {
      return json({ error: `Game not found: ${requestedGameId}` }, 404);
    }
    if (scenario === "manual-values") await waitForManualValuesRelease("detail");
    return json(detail(requestedGameId));
  }

  if (path === `/api/games/${gameId}/manual-values` && request.method === "PUT") {
    const requestBody = await body(request);
    manualValuesState.mutationBodies.push(requestBody);
    manualValuesState.activeMutations += 1;
    manualValuesState.maxActiveMutations = Math.max(
      manualValuesState.maxActiveMutations,
      manualValuesState.activeMutations,
    );
    try {
      await waitForManualValuesRelease("mutation");
      if (manualValuesState.failNextMutation) {
        manualValuesState.failNextMutation = false;
        return json({ error: "Injected manual value failure" }, 503);
      }
      if (Object.hasOwn(requestBody, "playingTime")) {
        const value = requestBody.playingTime;
        game.manualValues.playingTime =
          typeof value === "number" ? { value, source: "manual", confirmedAt: observedAt } : null;
      }
      if (Object.hasOwn(requestBody, "playerCount")) {
        const value = requestBody.playerCount;
        game.manualValues.playerCount =
          typeof value === "number" ? { value, source: "manual", confirmedAt: observedAt } : null;
      }
      return json(game);
    } finally {
      manualValuesState.activeMutations -= 1;
    }
  }
  if (path === "/api/axes" && request.method === "GET") {
    return json(collectionState.axesAvailable ? [axis] : []);
  }
  if (path === "/api/shelf/config" && request.method === "GET") {
    return json({ units: [], createdAt, updatedAt: createdAt });
  }
  if (path === "/api/niches/settings" && request.method === "GET") {
    return json({ ignoredTags: [] });
  }
  if (path === "/api/redundancy/settings" && request.method === "GET") {
    return json({
      enabled: collectionState.integratedRedundancy,
      stage: collectionState.integratedRedundancy ? "integrated" : "annotation",
      similarityThreshold: 0.8,
      maxPenalty: 2,
      componentWeights: { binary: 1, continuous: 1, personalAxes: 1 },
      minNeighbors: 1,
      expectedNeighbors: 2,
    });
  }
  if (path === "/api/shelf/capacity" && request.method === "GET") {
    return json({
      configured: true,
      totalShelfCount: 1,
      gamesWithDimensions: 2,
      gamesWithoutDimensions: 4,
      overflowing: false,
      hasPlacementProblems: false,
      assignments: [],
      assignmentConflicts: [],
      unfittableGames: [],
      overflowGames: [],
    });
  }
  if (path === "/api/tournament/stats" && request.method === "GET") {
    if (!collectionState.tournamentAvailable) return json({ error: "Tournament unavailable" }, 503);
    return json(
      collectionDefinitions.map((definition) => ({
        gameId: definition.id,
        gameName: definition.name,
        stats: tournamentStats(definition),
      })),
    );
  }
  const tournamentMatch = path.match(/^\/api\/tournament\/games\/([^/]+)\/stats$/);
  if (tournamentMatch !== null && request.method === "GET") {
    const definition = collectionDefinitions.find(({ id }) => id === tournamentMatch[1]);
    if (!collectionState.tournamentAvailable || definition === undefined) {
      return json({ error: "No tournament stats" }, 404);
    }
    return json(tournamentStats(definition));
  }
  if (path === `/api/tournament/games/${gameId}/stats` && request.method === "GET") {
    return json({ error: "No tournament stats" }, 404);
  }

  if (path === `/api/games/${gameId}/intention` && request.method === "POST") {
    const requestBody = await body(request);
    const commandId = String(requestBody.commandId);
    if (active !== null) {
      return json(
        IntentionMutationResultSchema.parse({
          ok: false,
          commandId,
          error: { code: "active-intention-conflict", gameId, current: active },
        }),
        409,
      );
    }
    intentionSequence += 1;
    active = activeIntention(`intention-browser-${intentionSequence}`);
    return json(
      IntentionMutationResultSchema.parse({
        ok: true,
        commandId,
        intention: active,
        linkedOwnershipTransition: null,
      }),
      201,
    );
  }

  const resolutionMatch = path.match(
    /^\/api\/games\/game-4\/intention\/([^/]+)\/(complete|retire)$/,
  );
  if (resolutionMatch !== null && request.method === "POST") {
    const [, intentionId, action] = resolutionMatch;
    const requestBody = await body(request);
    const commandId = String(requestBody.commandId);
    const expectedVersion = Number(requestBody.expectedVersion);
    if (active === null || active.intentionId !== intentionId) {
      return json(
        IntentionMutationResultSchema.parse({
          ok: false,
          commandId,
          error: { code: "intention-not-found", gameId, intentionId },
        }),
        404,
      );
    }
    if (staleOnce) {
      staleOnce = false;
      const current = resolveIntention(active, "completed");
      active = null;
      history = [resolvedHistoryItem(current)];
      return json(
        IntentionMutationResultSchema.parse({
          ok: false,
          commandId,
          error: { code: "stale-version", gameId, intentionId, expectedVersion, current },
        }),
        409,
      );
    }
    const resolved = resolveIntention(active, action === "complete" ? "completed" : "retired");
    active = null;
    history = [resolvedHistoryItem(resolved), ...history];
    return json(
      IntentionMutationResultSchema.parse({
        ok: true,
        commandId,
        intention: resolved,
        linkedOwnershipTransition: null,
      }),
    );
  }

  return json({ error: `No deterministic fixture route for ${request.method} ${path}` }, 404);
}

const socketServer = Bun.serve({ unix: socketPath, fetch: handle, idleTimeout: 0 as never });
const healthServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 3101,
  fetch: () => new Response("ok"),
});

function shutdown(): void {
  void socketServer.stop();
  void healthServer.stop();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
