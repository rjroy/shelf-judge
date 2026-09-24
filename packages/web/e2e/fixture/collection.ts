import {
  calculatePurchaseUtilization,
  type Axis,
  type Game,
  type GameWithPurchaseUtilization,
  type NichePosition,
  type PurchaseUtilizationResult,
  type TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import { baseGame, observedAt } from "./data";

export interface CollectionFixtureState {
  thumbnails: boolean;
  deletedIds: Set<string>;
  previouslyOwnedIds: Set<string>;
  empty: boolean;
  axesAvailable: boolean;
  tournamentAvailable: boolean;
  predictionsAvailable: boolean;
  nichesAvailable: boolean;
  integratedRedundancy: boolean;
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

export const collectionDefinitions: readonly CollectionDefinition[] = [
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

export function collectionGame(
  definition: CollectionDefinition,
  state: CollectionFixtureState,
  axis: Axis,
): Game {
  const game = baseGame(axis);
  const ownership =
    definition.previouslyOwned === true || state.previouslyOwnedIds.has(definition.id)
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

export function utilization(
  game: Game,
  definition: CollectionDefinition,
): PurchaseUtilizationResult {
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

export function score(definition: CollectionDefinition, predicted: boolean) {
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

export function nichePosition(definition: CollectionDefinition): NichePosition {
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
  state: CollectionFixtureState,
  axis: Axis,
  options: { predicted: boolean; niches: boolean },
): GameWithPurchaseUtilization {
  const game = collectionGame(definition, state, axis);
  const fitness = score(definition, options.predicted);
  return {
    game,
    score: fitness,
    displayScore: fitness === null ? null : fitness.score.toFixed(1),
    purchaseUtilization: utilization(game, definition),
    nichePosition: options.niches ? nichePosition(definition) : null,
  };
}

export function collectionEntries(
  state: CollectionFixtureState,
  axis: Axis,
  options: {
    predicted?: boolean;
    niches?: boolean;
  } = {},
): GameWithPurchaseUtilization[] {
  if (state.empty) return [];
  if (state.thumbnails) {
    const definition = collectionDefinitions[0];
    if (definition === undefined) throw new Error("Expected collection fixture definition");
    return Array.from({ length: 100 }, (_, index) => {
      const entry = collectionEntry(definition, state, axis, { predicted: false, niches: false });
      entry.game.id = `thumbnail-${index}`;
      entry.game.name = `Thumbnail ${String(index).padStart(3, "0")}`;
      entry.game.imageUrl = `/test-thumbnails/${index}.svg`;
      return entry;
    });
  }
  return collectionDefinitions
    .filter(({ id }) => !state.deletedIds.has(id))
    .map((definition) =>
      collectionEntry(definition, state, axis, {
        predicted: options.predicted === true,
        niches: options.niches === true,
      }),
    );
}

export function tournamentStats(definition: CollectionDefinition): TournamentGameStatsDisplay {
  const value = 4 + Number(definition.id.slice(5)) / 2;
  return {
    eloRating: 1400 + value * 20,
    comparisonCount: 8,
    normalizedScore: value,
    displayLabel: value.toFixed(1),
    wins: 4,
    losses: 4,
    recentComparisons: [],
  };
}

export function createCollectionState(): CollectionFixtureState {
  return {
    thumbnails: false,
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
