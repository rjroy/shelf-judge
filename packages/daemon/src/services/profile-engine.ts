// Pure profile computation functions. No I/O, no service dependencies.
// Implements REQ-PROFILE-1 through 17 (all algorithmic profile requirements).
// Follows the elo-engine.ts and curve-engine.ts pattern: exported functions, heavy unit tests.

import type {
  AxisDistribution,
  AxisSuggestion,
  ReportedAxisSuggestion,
  AxisWeightEntry,
  AttributeCluster,
  CollectionOutlier,
  CollectionProfile,
  TournamentDivergenceInsight,
  Axis,
  FitnessResult,
  EnabledAxis,
  Game,
  CollectionOutlierDimension,
  CollectionOutlierDriver,
  ReportedInsightEvidenceGame,
  TournamentGameStatsDisplay,
  UtilityCurveDeclaration,
  WeightRangeCluster,
} from "@shelf-judge/shared";
import {
  DERIVED_AXIS_REGISTRY,
  getAxisNativeScale,
  getDerivedSuggestionProjections,
  isEnabledScoringAxis,
  summarizeDerivedAxisConfiguration,
} from "@shelf-judge/shared";
import { checkVeto } from "./curve-engine.js";

export interface ProfileInput {
  games: Game[];
  axes: Axis[];
  fitnessResults: Map<string, FitnessResult>;
  tournamentStats: Map<string, TournamentGameStatsDisplay> | null;
  tournamentComparisonThreshold?: number;
}

const WEIGHT_RANGES: { range: string; min: number; max: number }[] = [
  { range: "Light", min: 1.0, max: 2.0 },
  { range: "Medium-Light", min: 2.0, max: 2.5 },
  { range: "Medium", min: 2.5, max: 3.0 },
  { range: "Medium-Heavy", min: 3.0, max: 3.5 },
  { range: "Heavy", min: 3.5, max: 5.0 },
];

/**
 * Main entry point. Computes a full collection profile from input data.
 */
export function computeProfile(
  input: ProfileInput,
): Omit<CollectionProfile, "computedAt" | "narration" | "narrationState"> {
  const { games, axes, fitnessResults, tournamentStats } = input;

  const enabledAxes = axes.filter(isEnabledScoringAxis);
  const axisDistributions = computeAxisDistributions(enabledAxes, fitnessResults);
  const axisWeights = computeAxisWeights(enabledAxes);
  const bggClustering = computeBggClustering(games);
  const utilityCurves = extractUtilityCurves(enabledAxes);
  const divergence =
    tournamentStats !== null
      ? computeDivergence(
          fitnessResults,
          tournamentStats,
          games,
          axes,
          input.tournamentComparisonThreshold,
        )
      : null;
  const outliers = detectOutliers(games, fitnessResults);
  const suggestions = generateSuggestions(
    games,
    enabledAxes,
    fitnessResults,
    tournamentStats,
    divergence,
    input.tournamentComparisonThreshold,
  );

  const userRatingAxisIds = new Set(
    enabledAxes.flatMap((axis) => (axis.source === "tournament" ? [] : [axis.id])),
  );
  const ratedGameCount = games.filter((game) =>
    Object.keys(game.ratings).some((axisId) => userRatingAxisIds.has(axisId)),
  ).length;

  return {
    axisDistributions,
    axisWeights,
    bggClustering,
    utilityCurves,
    divergence,
    outliers,
    suggestions,
    gameCount: games.length,
    ratedGameCount,
  };
}

/**
 * Compute mean, median, standard deviation, and range for each axis's ratings.
 * Uses population standard deviation (not sample).
 */
export function computeAxisDistributions(
  axes: EnabledAxis[],
  fitnessResults: ReadonlyMap<string, FitnessResult>,
): AxisDistribution[] {
  return axes.map((axis) => {
    const ratings: number[] = [];
    for (const result of fitnessResults.values()) {
      const effectiveRating = result.breakdown.find(
        (entry) => entry.axisId === axis.id,
      )?.effectiveRating;
      if (effectiveRating !== null && effectiveRating !== undefined) ratings.push(effectiveRating);
    }

    if (ratings.length === 0) {
      return {
        axisId: axis.id,
        axisName: axis.name,
        mean: 0,
        median: 0,
        standardDeviation: 0,
        range: { min: 0, max: 0 },
        ratedGameCount: 0,
        histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      };
    }

    const sorted = [...ratings].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean = sum / n;

    let median: number;
    if (n % 2 === 1) {
      median = sorted[Math.floor(n / 2)];
    } else {
      median = (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    }

    const varianceSum = sorted.reduce((acc, v) => acc + (v - mean) * (v - mean), 0);
    const standardDeviation = Math.sqrt(varianceSum / n);

    // Count games per rating bucket (1-10). Ratings are integers 1-10;
    // clamp to valid range defensively.
    const histogram = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const r of ratings) {
      const bucket = Math.max(0, Math.min(9, Math.round(r) - 1));
      histogram[bucket]++;
    }

    return {
      axisId: axis.id,
      axisName: axis.name,
      mean,
      median,
      standardDeviation,
      range: { min: sorted[0], max: sorted[n - 1] },
      ratedGameCount: n,
      histogram,
    };
  });
}

/**
 * Compute axis weight percentages, sorted descending by percentage.
 */
export function computeAxisWeights(axes: EnabledAxis[]): AxisWeightEntry[] {
  const totalWeight = axes.reduce((acc, a) => acc + a.weight, 0);
  if (totalWeight === 0) return [];

  return axes
    .map((axis) => ({
      axisId: axis.id,
      axisName: axis.name,
      weight: axis.weight,
      percentage: (axis.weight / totalWeight) * 100,
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

/**
 * Cluster games by BGG mechanics, categories, subdomains, families, and weight ranges.
 * Games without BGG data are excluded from the denominator.
 */
export function computeBggClustering(games: Game[]): CollectionProfile["bggClustering"] {
  const gamesWithBgg = games.filter((g) => g.bggData !== null);
  const totalWithBgg = gamesWithBgg.length;

  const countAttributes = (extractor: (g: Game) => { name: string }[]): AttributeCluster[] => {
    const counts = new Map<string, number>();
    for (const game of gamesWithBgg) {
      for (const name of new Set(extractor(game).map(({ name }) => name))) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({
        name,
        count,
        percentage: totalWithBgg > 0 ? (count / totalWithBgg) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  };

  const mechanics = countAttributes((g) => g.bggData!.mechanics);
  const categories = countAttributes((g) => g.bggData!.categories);
  const subdomains = countAttributes((g) => g.bggData!.subdomains ?? []);
  const families = countAttributes((g) => g.bggData!.families ?? []);
  // Weight ranges
  const gamesWithWeight = gamesWithBgg.filter((g) => g.bggData!.weight !== null);
  const totalWithWeight = gamesWithWeight.length;

  const weightRanges: WeightRangeCluster[] = WEIGHT_RANGES.map(({ range, min, max }) => {
    const isLastBucket = range === "Heavy";
    const count = gamesWithWeight.filter((g) => {
      const w = g.bggData!.weight!;
      // Inclusive lower, exclusive upper, except last bucket inclusive on both
      return isLastBucket ? w >= min && w <= max : w >= min && w < max;
    }).length;
    return {
      range,
      min,
      max,
      count,
      percentage: totalWithWeight > 0 ? (count / totalWithWeight) * 100 : 0,
    };
  });

  return { mechanics, categories, subdomains, families, weightRanges };
}

/**
 * Extract axes with non-default curve configuration.
 * An axis is "non-default" if any curve parameter is explicitly set.
 */
export function extractUtilityCurves(axes: EnabledAxis[]): UtilityCurveDeclaration[] {
  return axes
    .filter(
      (axis) =>
        axis.preferenceShape !== undefined ||
        axis.idealValue !== undefined ||
        axis.tolerance !== undefined ||
        axis.toleranceWidth !== undefined ||
        axis.leanDirection !== undefined ||
        axis.veto !== undefined,
    )
    .map((axis) => {
      const definition =
        axis.source === "derived" ? DERIVED_AXIS_REGISTRY[axis.derivedField] : null;
      return {
        axisId: axis.id,
        axisName: axis.name,
        derivedField: axis.source === "derived" ? axis.derivedField : null,
        shape: axis.preferenceShape ?? "higher-is-better",
        idealValue: axis.idealValue ?? null,
        tolerance: axis.tolerance ?? null,
        toleranceWidth: axis.toleranceWidth ?? null,
        leanDirection: axis.leanDirection ?? null,
        vetoThreshold: axis.veto ?? null,
        nativeScale: getAxisNativeScale(axis),
        unit: definition?.unit ?? "rating",
        provenance: definition?.provenance ?? null,
        configurationSummary:
          axis.source === "derived" ? summarizeDerivedAxisConfiguration(axis) : null,
      };
    });
}

/**
 * Detect tournament divergence against fitness recomposed without Tournament axes.
 * Returns null when tournament data is null or empty.
 */
export function computeDivergence(
  fitnessResults: ReadonlyMap<string, FitnessResult>,
  tournamentStats: ReadonlyMap<string, TournamentGameStatsDisplay>,
  games: Game[],
  axes: Axis[],
  comparisonThreshold = 6,
): TournamentDivergenceInsight[] | null {
  if (tournamentStats.size === 0) return null;

  const insights: TournamentDivergenceInsight[] = [];
  const gameMap = new Map(games.map((g) => [g.id, g]));
  const tournamentAxisIds = new Set(
    axes.flatMap((axis) => (axis.source === "tournament" ? [axis.id] : [])),
  );
  const includedGameCount = [...tournamentStats].filter(([gameId, stats]) => {
    const result = fitnessResults.get(gameId);
    return (
      result !== undefined &&
      independentFitnessScore(result, tournamentAxisIds, axes) !== null &&
      stats.normalizedScore !== null &&
      stats.comparisonCount >= comparisonThreshold &&
      !stats.isProvisional
    );
  }).length;
  const cohort = {
    description: "Collection games with Tournament results and non-Tournament fitness evidence",
    eligibleGameCount: tournamentStats.size,
    includedGameCount,
    excludedGameCount: Math.max(0, tournamentStats.size - includedGameCount),
    coveragePercent:
      tournamentStats.size === 0 ? 0 : (includedGameCount / tournamentStats.size) * 100,
  };
  const method = {
    id: "tournament-preference-divergence",
    version: 2,
    description: "Compares Tournament preference with fitness excluding Tournament axes",
  };
  const limitations = ["Tournament preference reflects only the opponents compared so far"];

  for (const [gameId, stats] of tournamentStats) {
    const gameName = gameMap.get(gameId)?.name ?? gameId;
    const fitness = fitnessResults.get(gameId);
    const independentScore =
      fitness === undefined ? null : independentFitnessScore(fitness, tournamentAxisIds, axes);
    const comparisonRequirement = {
      criterion: "comparisons for subject game",
      observed: stats.comparisonCount,
      required: comparisonThreshold,
      met: stats.comparisonCount >= comparisonThreshold && !stats.isProvisional,
    };
    const cohortRequirement = {
      criterion: "normalized Tournament score available",
      observed: stats.normalizedScore === null ? 0 : 1,
      required: 1,
      met: stats.normalizedScore !== null,
    };
    const comparatorRequirement = {
      criterion: "independent non-Tournament axes",
      observed: independentScore === null ? 0 : 1,
      required: 1,
      met: independentScore !== null,
    };
    const evidence: [ReportedInsightEvidenceGame] = [
      {
        gameId,
        gameName,
        role: "subject" as const,
        measurements: [
          {
            key: "tournament-score",
            label: "Tournament score",
            value: stats.normalizedScore,
            unit: "rating",
            source: "Tournament comparisons",
          },
          {
            key: "comparison-count",
            label: "Tournament comparisons",
            value: stats.comparisonCount,
            unit: "comparisons",
            source: "Tournament comparisons",
          },
          {
            key: "provisional",
            label: "Provisional result",
            value: stats.isProvisional,
            unit: null,
            source: "Tournament settings",
          },
          {
            key: "independent-fitness-score",
            label: "Independent fitness",
            value: independentScore,
            unit: "rating",
            source: "Non-Tournament fitness axes",
          },
        ],
      },
    ];
    const base = {
      contractVersion: 1 as const,
      id: `divergence:${gameId}`,
      method,
      cohort,
      evidence,
      limitations,
    };

    if (!comparisonRequirement.met) {
      insights.push({
        ...base,
        status: "insufficient",
        reason: "insufficient-sample",
        sufficiency: [
          { ...comparisonRequirement, met: false as const },
          cohortRequirement,
          comparatorRequirement,
        ],
        comparator: independentScore === null ? null : independentComparator(gameId),
        explanation: `At least ${comparisonThreshold} comparisons are required before reporting divergence`,
      });
      continue;
    }

    if (stats.normalizedScore === null) {
      insights.push({
        ...base,
        status: "insufficient",
        reason: "insufficient-coverage",
        sufficiency: [
          { ...cohortRequirement, met: false as const },
          { ...comparisonRequirement, met: true as const },
          comparatorRequirement,
        ],
        comparator: independentScore === null ? null : independentComparator(gameId),
        explanation: "The Tournament cohort is not yet sufficient to normalize scores",
      });
      continue;
    }

    if (independentScore === null) {
      insights.push({
        ...base,
        status: "insufficient",
        reason: "missing-comparator",
        sufficiency: [
          { ...comparatorRequirement, met: false as const },
          { ...comparisonRequirement, met: true as const },
          { ...cohortRequirement, met: true as const },
        ],
        comparator: null,
        explanation: "No rated non-Tournament axis is available for an independent comparison",
      });
      continue;
    }

    const tournamentScore = stats.normalizedScore;
    const gap = Math.abs(tournamentScore - independentScore);
    if (gap > 1.5) {
      const direction =
        tournamentScore > independentScore ? "tournament-outlier" : "fitness-outlier";
      insights.push({
        ...base,
        status: "reported",
        sufficiency: [
          { ...comparisonRequirement, met: true as const },
          { ...cohortRequirement, met: true as const },
          { ...comparatorRequirement, met: true as const },
        ],
        comparator: independentComparator(gameId),
        observation: `Tournament score is ${gap.toFixed(1)} points ${tournamentScore > independentScore ? "above" : "below"} independent fitness`,
        interpretation:
          direction === "tournament-outlier"
            ? "Tournament choices favor this game more than the configured non-Tournament axes predict"
            : "Configured non-Tournament axes favor this game more than Tournament choices do",
        details: {
          gameId,
          gameName,
          independentFitnessScore: independentScore,
          normalizedTournamentScore: tournamentScore,
          gap,
          direction,
          comparisonCount: stats.comparisonCount,
          provisional: stats.isProvisional,
        },
        notability: {
          metric: "absolute score gap",
          value: gap,
          threshold: 1.5,
          direction: "above",
          explanation: "The gap exceeds the 1.5-point reporting threshold",
        },
        confidence: {
          level: stats.comparisonCount >= comparisonThreshold * 2 ? "high" : "moderate",
          basis: `${stats.comparisonCount} Tournament comparisons; provisional results are suppressed`,
        },
      });
    }
  }

  return insights.sort((a, b) => {
    if (a.status !== "reported") return b.status === "reported" ? 1 : 0;
    if (b.status !== "reported") return -1;
    return b.details.gap - a.details.gap;
  });
}

function independentComparator(gameId: string) {
  return {
    description: "Fitness recomposed from rated non-Tournament axes",
    gameIds: [gameId],
  };
}

function independentFitnessScore(
  fitness: FitnessResult,
  tournamentAxisIds: ReadonlySet<string>,
  axes: Axis[],
): number | null {
  const entries = fitness.breakdown.filter(
    (entry) =>
      !tournamentAxisIds.has(entry.axisId) && entry.effectiveRating !== null && entry.weight > 0,
  );
  if (entries.length === 0) return null;

  const axisById = new Map(axes.map((axis) => [axis.id, axis]));
  const independentVeto = entries.some((entry) => {
    const axis = axisById.get(entry.axisId);
    if (axis === undefined || !isEnabledScoringAxis(axis) || entry.overridden) return false;
    const scoringValue = entry.scoringRawValue;
    return scoringValue !== null && checkVeto(scoringValue, axis.veto ?? null);
  });
  if (independentVeto) return 0;

  const weight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const weightedRating = entries.reduce(
    (sum, entry) => sum + (entry.effectiveRating ?? 0) * entry.weight,
    0,
  );
  return Math.round((weightedRating / weight) * 10) / 10;
}

const OUTLIER_MIN_SAMPLE = 6;
const OUTLIER_MIN_COVERAGE_PERCENT = 60;
const OUTLIER_NEIGHBOR_COUNT = 2;
const OUTLIER_DISTANCE_THRESHOLD = 0.5;
const OUTLIER_DRIVER_THRESHOLD = 0.35;

type OutlierFeatures = {
  game: Game;
  mechanics: Set<string>;
  categories: Set<string>;
  weight: number;
  minPlayers: number;
  maxPlayers: number;
  playingTime: number;
};

type OutlierDistance = {
  composite: number;
  dimensions: Record<CollectionOutlierDimension, number>;
};

const OUTLIER_METHOD = {
  id: "outlier:factual-neighborhood",
  version: 1,
  description:
    "Compares each owned game with its two nearest owned neighbors using observed BGG composition and collection metadata only",
} as const;

function outlierFeatures(game: Game): OutlierFeatures | null {
  if (game.bggData === null) return null;
  const mechanics = game.bggData.mechanics.map(({ name }) => name).sort();
  const categories = game.bggData.categories.map(({ name }) => name).sort();
  if (
    mechanics.length === 0 ||
    categories.length === 0 ||
    game.bggData.weight === null ||
    game.minPlayers === null ||
    game.maxPlayers === null ||
    game.playingTime === null
  ) {
    return null;
  }
  const features: OutlierFeatures = {
    game,
    mechanics: new Set(mechanics),
    categories: new Set(categories),
    weight: game.bggData.weight,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    playingTime: game.playingTime,
  };
  return features;
}

function jaccardDistance(left: Set<string>, right: Set<string>): number {
  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : 1 - intersection / union;
}

function factualDistance(left: OutlierFeatures, right: OutlierFeatures): OutlierDistance {
  const dimensions: Record<CollectionOutlierDimension, number> = {
    mechanics: jaccardDistance(left.mechanics, right.mechanics),
    categories: jaccardDistance(left.categories, right.categories),
    complexity: Math.min(Math.abs(left.weight - right.weight) / 4, 1),
    "player-count":
      (Math.min(Math.abs(left.minPlayers - right.minPlayers) / 7, 1) +
        Math.min(Math.abs(left.maxPlayers - right.maxPlayers) / 7, 1)) /
      2,
    "playing-time": Math.min(Math.abs(left.playingTime - right.playingTime) / 300, 1),
  };
  const observed = Object.values(dimensions);
  return {
    composite: observed.reduce((sum, distance) => sum + distance, 0) / observed.length,
    dimensions,
  };
}

function featureValue(features: OutlierFeatures, dimension: CollectionOutlierDimension) {
  switch (dimension) {
    case "mechanics":
      return [...features.mechanics].join(", ");
    case "categories":
      return [...features.categories].join(", ");
    case "complexity":
      return features.weight;
    case "player-count":
      return `${features.minPlayers}-${features.maxPlayers} players`;
    case "playing-time":
      return features.playingTime;
  }
}

const OUTLIER_DIMENSION_LABELS: Record<CollectionOutlierDimension, string> = {
  mechanics: "Mechanics",
  categories: "Categories",
  complexity: "Complexity weight",
  "player-count": "Player range",
  "playing-time": "Playing time",
};

function outlierEvidence(
  features: OutlierFeatures,
  role: ReportedInsightEvidenceGame["role"],
  distance: number,
): ReportedInsightEvidenceGame {
  return {
    gameId: features.game.id,
    gameName: features.game.name,
    role,
    measurements: [
      {
        key: role === "subject" ? "neighborhood-distance" : "subject-distance",
        label: role === "subject" ? "Neighborhood distance" : "Distance from subject",
        value: Math.round(distance * 1000) / 1000,
        unit: null,
        source: OUTLIER_METHOD.id,
      },
      {
        key: "mechanics",
        label: "Mechanics",
        value: featureValue(features, "mechanics"),
        unit: null,
        source: "BGG metadata",
      },
      {
        key: "categories",
        label: "Categories",
        value: featureValue(features, "categories"),
        unit: null,
        source: "BGG metadata",
      },
      {
        key: "complexity-weight",
        label: "Complexity weight",
        value: features.weight,
        unit: "BGG weight",
        source: "BGG metadata",
      },
      {
        key: "player-range",
        label: "Player range",
        value: featureValue(features, "player-count"),
        unit: null,
        source: "collection metadata",
      },
      {
        key: "playing-time",
        label: "Playing time",
        value: features.playingTime,
        unit: "minutes",
        source: "collection metadata",
      },
    ],
  };
}

/** Detect compositional outliers among currently owned games with sufficient factual coverage. */
export function detectOutliers(
  games: Game[],
  fitnessResults: Map<string, FitnessResult>,
): CollectionOutlier[] {
  const eligibleGames = games.filter(({ ownership }) => ownership === "owned");
  const included = eligibleGames.flatMap((game) => {
    const features = outlierFeatures(game);
    return features === null ? [] : [features];
  });
  const coveragePercent =
    eligibleGames.length === 0 ? 0 : (included.length / eligibleGames.length) * 100;
  const cohort = {
    description:
      "Currently owned games with complete mechanics, categories, weight, player range, and playing-time metadata",
    eligibleGameCount: eligibleGames.length,
    includedGameCount: included.length,
    excludedGameCount: eligibleGames.length - included.length,
    coveragePercent,
  };
  const sampleRequirement = {
    criterion: "usable-owned-games",
    observed: included.length,
    required: OUTLIER_MIN_SAMPLE,
    met: included.length >= OUTLIER_MIN_SAMPLE,
  };
  const coverageRequirement = {
    criterion: "factual-metadata-coverage-percent",
    observed: coveragePercent,
    required: OUTLIER_MIN_COVERAGE_PERCENT,
    met: coveragePercent >= OUTLIER_MIN_COVERAGE_PERCENT,
  };
  const abstentionBase = {
    contractVersion: 1 as const,
    id: "outlier:collection",
    method: OUTLIER_METHOD,
    cohort,
    evidence: [],
    comparator: null,
    limitations: [
      "Only currently owned games participate in detection",
      "Missing dimensions are excluded rather than estimated",
    ],
  };

  if (!sampleRequirement.met) {
    return [
      {
        ...abstentionBase,
        status: "insufficient",
        reason: "insufficient-sample",
        sufficiency: [{ ...sampleRequirement, met: false }, coverageRequirement],
        explanation: `At least ${OUTLIER_MIN_SAMPLE} owned games with usable factual metadata are required`,
      },
    ];
  }
  if (!coverageRequirement.met) {
    return [
      {
        ...abstentionBase,
        status: "insufficient",
        reason: "insufficient-coverage",
        sufficiency: [{ ...coverageRequirement, met: false }, sampleRequirement],
        explanation: `At least ${OUTLIER_MIN_COVERAGE_PERCENT}% of owned games need usable factual metadata`,
      },
    ];
  }

  const outliers: CollectionOutlier[] = [];
  for (const subject of included) {
    const neighbors = included
      .filter((candidate) => candidate.game.id !== subject.game.id)
      .map((candidate) => ({ features: candidate, distance: factualDistance(subject, candidate) }))
      .sort(
        (left, right) =>
          left.distance.composite - right.distance.composite ||
          left.features.game.id.localeCompare(right.features.game.id),
      )
      .slice(0, OUTLIER_NEIGHBOR_COUNT);
    if (neighbors.length < OUTLIER_NEIGHBOR_COUNT) continue;

    const neighborhoodDistance =
      neighbors.reduce((sum, neighbor) => sum + neighbor.distance.composite, 0) /
      OUTLIER_NEIGHBOR_COUNT;
    const dimensions = Object.keys(OUTLIER_DIMENSION_LABELS) as CollectionOutlierDimension[];
    const drivers = dimensions
      .flatMap((dimension): CollectionOutlierDriver[] => {
        const values = neighbors.map(({ features, distance }) => ({
          features,
          distance: distance.dimensions[dimension],
        }));
        if (values.some(({ distance }) => distance < OUTLIER_DRIVER_THRESHOLD)) return [];
        const distance = values.reduce((sum, value) => sum + value.distance, 0) / values.length;
        const label = OUTLIER_DIMENSION_LABELS[dimension];
        return [
          {
            dimension,
            label,
            distance,
            subjectValue: featureValue(subject, dimension),
            comparatorValues: values.map(({ features }) => ({
              gameId: features.game.id,
              value: featureValue(features, dimension),
            })),
            explanation: `${label} differs materially from both nearest comparison games`,
          },
        ];
      })
      .sort((left, right) => right.distance - left.distance);
    if (neighborhoodDistance <= OUTLIER_DISTANCE_THRESHOLD || drivers.length < 2) continue;

    const fitness = fitnessResults.get(subject.game.id);
    const nearestComparisons = neighbors.map(({ features, distance }) => ({
      gameId: features.game.id,
      gameName: features.game.name,
      distance: distance.composite,
    })) as [
      { gameId: string; gameName: string; distance: number },
      { gameId: string; gameName: string; distance: number },
    ];
    outliers.push({
      contractVersion: 1,
      id: `outlier:${subject.game.id}`,
      method: OUTLIER_METHOD,
      cohort,
      status: "reported",
      sufficiency: [
        { ...sampleRequirement, met: true },
        { ...coverageRequirement, met: true },
      ],
      evidence: [
        outlierEvidence(subject, "subject", neighborhoodDistance),
        ...neighbors.map(({ features, distance }) =>
          outlierEvidence(features, "comparator", distance.composite),
        ),
      ],
      comparator: {
        description: "Two nearest owned games with jointly observed factual metadata",
        gameIds: nearestComparisons.map(({ gameId }) => gameId),
      },
      limitations: [
        "Distance thresholds are deterministic heuristics, not population significance tests",
        "Games missing any required factual dimension are excluded rather than estimated",
      ],
      observation: `${subject.game.name} is compositionally distant from its two nearest owned comparison games`,
      interpretation:
        fitness === undefined
          ? null
          : `Separately, its current preference fitness score is ${fitness.score.toFixed(1)}${fitness.vetoed ? " and is vetoed" : ""}`,
      details: {
        gameId: subject.game.id,
        gameName: subject.game.name,
        neighborhoodDistance,
        nearestComparisons,
        drivers: drivers as [CollectionOutlierDriver, ...CollectionOutlierDriver[]],
        fitnessScore: fitness?.score ?? null,
      },
      notability: {
        metric: "mean-two-nearest-factual-distance",
        value: neighborhoodDistance,
        threshold: OUTLIER_DISTANCE_THRESHOLD,
        direction: "above",
        explanation: `The mean distance exceeds ${OUTLIER_DISTANCE_THRESHOLD} and at least two dimensions are material drivers`,
      },
      confidence: {
        level: included.length >= 12 ? "high" : "moderate",
        basis: `${included.length} owned games passed factual metadata coverage gates`,
      },
    });
  }

  return outliers;
}

type SuggestionAttribute = {
  type: "mechanic" | "category";
  name: string;
};

type PreferenceOutcome = {
  game: Game;
  independentScore: number;
  tournamentScore: number;
  comparisonCount: number;
  signedGap: number;
};

const SUGGESTION_MIN_GROUP_SIZE = 3;
const SUGGESTION_MIN_EFFECT = 1.5;
const SUGGESTION_MIN_DIRECTIONAL_CONSISTENCY = 0.8;
const SUGGESTION_MAX_ATTRIBUTE_OVERLAP = 0.75;
const LEGACY_CONCENTRATION_THRESHOLD = 80;
const LEGACY_VARIANCE_THRESHOLD = 0.5;

const SUGGESTION_METHOD = {
  id: "directional-divergence-attribute-effect",
  version: 1,
  description:
    "Compares signed Tournament-versus-independent-fitness gaps for games with and without an attribute",
} as const;

function suggestionCohort(gamesWithBgg: Game[], includedGameCount: number) {
  return {
    description:
      "BGG-backed collection games with sufficient Tournament and independent fitness data",
    eligibleGameCount: gamesWithBgg.length,
    includedGameCount,
    excludedGameCount: gamesWithBgg.length - includedGameCount,
    coveragePercent:
      gamesWithBgg.length === 0 ? 0 : (includedGameCount / gamesWithBgg.length) * 100,
  };
}

function insufficientSuggestion(
  gamesWithBgg: Game[],
  includedGameCount: number,
  reason: "insufficient-sample" | "insufficient-coverage" | "missing-comparator",
  requirement: { criterion: string; observed: number; required: number },
  explanation: string,
  id = "axis-suggestion:directional-divergence-attribute-effect",
): AxisSuggestion {
  return {
    contractVersion: 1,
    id,
    status: "insufficient",
    reason,
    method: SUGGESTION_METHOD,
    cohort: suggestionCohort(gamesWithBgg, includedGameCount),
    sufficiency: [{ ...requirement, met: false }],
    evidence: [],
    comparator: null,
    limitations: [
      "Tournament preference reflects only the opponents compared so far",
      "BGG attributes are observational labels, not causal preference measures",
    ],
    explanation,
  };
}

function suppressedSuggestion(
  gamesWithBgg: Game[],
  includedGameCount: number,
  id: string,
  explanation: string,
): AxisSuggestion {
  return {
    contractVersion: 1,
    id,
    status: "suppressed",
    reason: "unsupported-method",
    method: SUGGESTION_METHOD,
    cohort: suggestionCohort(gamesWithBgg, includedGameCount),
    sufficiency: [],
    evidence: [],
    comparator: null,
    limitations: ["Overlapping attributes prevent an independent effect interpretation"],
    explanation,
  };
}

function retiredLegacySuggestions(games: Game[], axes: EnabledAxis[]): AxisSuggestion[] {
  const gamesWithBgg = games.filter((game) => game.bggData !== null);
  const axisCovers = (term: string): boolean => {
    const lower = term.toLowerCase();
    return axes.some(
      (axis) =>
        axis.name.toLowerCase().includes(lower) ||
        (axis.description?.toLowerCase().includes(lower) ?? false),
    );
  };
  const retired: AxisSuggestion[] = [];
  const attributeCounts = new Map<string, number>();
  for (const game of gamesWithBgg) {
    for (const attribute of new Set(suggestionAttributes(game).map(({ name }) => name))) {
      attributeCounts.set(attribute, (attributeCounts.get(attribute) ?? 0) + 1);
    }
  }
  const concentrated = [...attributeCounts]
    .map(([attribute, count]) => ({
      attribute,
      percentage: gamesWithBgg.length === 0 ? 0 : (count / gamesWithBgg.length) * 100,
    }))
    .filter(
      ({ attribute, percentage }) =>
        percentage >= LEGACY_CONCENTRATION_THRESHOLD && !axisCovers(attribute),
    )
    .sort(
      (left, right) =>
        right.percentage - left.percentage || left.attribute.localeCompare(right.attribute),
    )[0];
  if (concentrated !== undefined) {
    retired.push({
      contractVersion: 1,
      id: "axis-suggestion:retired:unexpressed-concentration",
      status: "retired",
      reason: "superseded",
      method: {
        id: "unexpressed-concentration",
        version: 1,
        description: "Recommended axes from common BGG attributes without preference evidence",
      },
      cohort: {
        description: "Collection games with BGG mechanics or categories",
        eligibleGameCount: games.length,
        includedGameCount: gamesWithBgg.length,
        excludedGameCount: games.length - gamesWithBgg.length,
        coveragePercent: games.length === 0 ? 0 : (gamesWithBgg.length / games.length) * 100,
      },
      sufficiency: [
        {
          criterion: "collection attribute concentration percent",
          observed: concentrated.percentage,
          required: LEGACY_CONCENTRATION_THRESHOLD,
          met: true,
        },
      ],
      evidence: [],
      comparator: null,
      limitations: ["Collection concentration does not establish preference for an attribute"],
      explanation:
        "The concentration recommendation method is retired because ownership frequency alone does not support a preference axis",
    });
  }

  const enabledDerivedCoverage = new Set(
    axes.flatMap((axis) => (axis.source === "derived" ? [axis.derivedField] : [])),
  );
  const variable = getDerivedSuggestionProjections()
    .flatMap((projection) => {
      if (enabledDerivedCoverage.has(projection.derivedField)) return [];
      const values = games
        .map((game) => projection.projectValue(game))
        .filter((value): value is number => value !== null && Number.isFinite(value));
      if (values.length < 2) return [];
      const average = mean(values);
      if (average === 0) return [];
      const variance = mean(values.map((value) => (value - average) ** 2));
      const coefficient = Math.sqrt(variance) / Math.abs(average);
      return coefficient > LEGACY_VARIANCE_THRESHOLD
        ? [{ attribute: projection.attribute, coefficient, includedGameCount: values.length }]
        : [];
    })
    .sort(
      (left, right) =>
        right.coefficient - left.coefficient || left.attribute.localeCompare(right.attribute),
    )[0];
  if (variable !== undefined) {
    retired.push({
      contractVersion: 1,
      id: "axis-suggestion:retired:high-variance",
      status: "retired",
      reason: "superseded",
      method: {
        id: "high-variance",
        version: 1,
        description: "Recommended axes from varied factual metadata without preference evidence",
      },
      cohort: {
        description: "Collection games with values for the most variable uncovered BGG field",
        eligibleGameCount: games.length,
        includedGameCount: variable.includedGameCount,
        excludedGameCount: games.length - variable.includedGameCount,
        coveragePercent: games.length === 0 ? 0 : (variable.includedGameCount / games.length) * 100,
      },
      sufficiency: [
        {
          criterion: "coefficient of variation",
          observed: variable.coefficient,
          required: LEGACY_VARIANCE_THRESHOLD,
          met: true,
        },
      ],
      evidence: [],
      comparator: null,
      limitations: ["Factual variance does not establish that the dimension affects preference"],
      explanation:
        "The variance recommendation method is retired because spread alone does not support a preference axis",
    });
  }
  return retired;
}

/** Generate axis suggestions only when a BGG attribute predicts an independent preference gap. */
export function generateSuggestions(
  games: Game[],
  axes: EnabledAxis[],
  fitnessResults: ReadonlyMap<string, FitnessResult>,
  tournamentStats: ReadonlyMap<string, TournamentGameStatsDisplay> | null,
  divergence: TournamentDivergenceInsight[] | null,
  comparisonThreshold = 6,
): AxisSuggestion[] {
  const gamesWithBgg = games.filter((g) => g.bggData !== null);
  const retired = retiredLegacySuggestions(games, axes);
  if (gamesWithBgg.length === 0) {
    return [
      ...retired,
      insufficientSuggestion(
        gamesWithBgg,
        0,
        "insufficient-coverage",
        { criterion: "games with BGG attributes", observed: 0, required: 1 },
        "At least one game with BGG attributes is required to evaluate axis suggestions",
      ),
    ];
  }
  if (tournamentStats === null || divergence === null) {
    return [
      ...retired,
      insufficientSuggestion(
        gamesWithBgg,
        0,
        "insufficient-coverage",
        { criterion: "Tournament preference results available", observed: 0, required: 1 },
        "Tournament preference results are required to evaluate evidence-backed axis suggestions",
      ),
    ];
  }

  const axisCovers = (term: string): boolean => {
    const lower = term.toLowerCase();
    return axes.some(
      (a) =>
        a.name.toLowerCase().includes(lower) ||
        (a.description?.toLowerCase().includes(lower) ?? false),
    );
  };

  const gameById = new Map(gamesWithBgg.map((game) => [game.id, game]));
  const tournamentAxisIds = new Set(
    axes.flatMap((axis) => (axis.source === "tournament" ? [axis.id] : [])),
  );
  const outcomes = gamesWithBgg.flatMap((game): PreferenceOutcome[] => {
    const fitness = fitnessResults.get(game.id);
    const stats = tournamentStats.get(game.id);
    if (
      fitness === undefined ||
      stats === undefined ||
      stats.normalizedScore === null ||
      stats.isProvisional ||
      stats.comparisonCount < comparisonThreshold
    ) {
      return [];
    }
    const independentScore = independentFitnessScore(fitness, tournamentAxisIds, axes);
    if (independentScore === null) return [];
    return [
      {
        game,
        independentScore,
        tournamentScore: stats.normalizedScore,
        comparisonCount: stats.comparisonCount,
        signedGap: stats.normalizedScore - independentScore,
      },
    ];
  });

  if (outcomes.length < SUGGESTION_MIN_GROUP_SIZE * 2) {
    return [
      ...retired,
      insufficientSuggestion(
        gamesWithBgg,
        outcomes.length,
        "insufficient-sample",
        {
          criterion: "evaluated games for positive and comparator groups",
          observed: outcomes.length,
          required: SUGGESTION_MIN_GROUP_SIZE * 2,
        },
        `At least ${SUGGESTION_MIN_GROUP_SIZE * 2} evaluated games are required before testing axis suggestions`,
      ),
    ];
  }

  const candidateSupport = new Map<
    string,
    { attribute: SuggestionAttribute; gameIds: Set<string> }
  >();
  for (const insight of divergence) {
    if (insight.status !== "reported") continue;
    const game = gameById.get(insight.details.gameId);
    if (game === undefined) continue;
    for (const attribute of suggestionAttributes(game)) {
      const key = `${insight.details.direction}:${attribute.type}:${attribute.name}`;
      const candidate = candidateSupport.get(key) ?? { attribute, gameIds: new Set<string>() };
      candidate.gameIds.add(game.id);
      candidateSupport.set(key, candidate);
    }
  }

  const suggestions: ReportedAxisSuggestion[] = [];
  const abstained: AxisSuggestion[] = [];
  for (const [key, candidate] of candidateSupport) {
    if (axisCovers(candidate.attribute.name)) {
      continue;
    }
    if (candidate.gameIds.size < SUGGESTION_MIN_GROUP_SIZE) {
      abstained.push(
        insufficientSuggestion(
          gamesWithBgg,
          outcomes.length,
          "insufficient-sample",
          {
            criterion: `same-direction divergent games with ${candidate.attribute.name}`,
            observed: candidate.gameIds.size,
            required: SUGGESTION_MIN_GROUP_SIZE,
          },
          `At least ${SUGGESTION_MIN_GROUP_SIZE} same-direction divergent games are required to evaluate ${candidate.attribute.name}`,
          `axis-suggestion:${key}`,
        ),
      );
      continue;
    }
    const direction = key.startsWith("tournament-outlier:")
      ? "tournament-outlier"
      : "fitness-outlier";
    const membership = suggestionMembership(outcomes, candidate.attribute);
    const confoundedCandidate = [...candidateSupport.entries()].some(
      ([otherKey, other]) =>
        otherKey !== key &&
        otherKey.startsWith(`${direction}:`) &&
        other.gameIds.size >= SUGGESTION_MIN_GROUP_SIZE &&
        membershipOverlap(membership, suggestionMembership(outcomes, other.attribute)) >=
          SUGGESTION_MAX_ATTRIBUTE_OVERLAP,
    );
    if (confoundedCandidate) {
      abstained.push(
        suppressedSuggestion(
          gamesWithBgg,
          outcomes.length,
          `axis-suggestion:${key}`,
          `${candidate.attribute.name} is suppressed because another candidate has nearly identical collection membership`,
        ),
      );
      continue;
    }
    const supporting = outcomes.filter(({ game }) =>
      hasSuggestionAttribute(game, candidate.attribute),
    );
    const comparators = outcomes.filter(
      ({ game }) => !hasSuggestionAttribute(game, candidate.attribute),
    );
    if (
      supporting.length < SUGGESTION_MIN_GROUP_SIZE ||
      comparators.length < SUGGESTION_MIN_GROUP_SIZE
    ) {
      const comparatorMissing = comparators.length === 0;
      abstained.push(
        insufficientSuggestion(
          gamesWithBgg,
          outcomes.length,
          comparatorMissing ? "missing-comparator" : "insufficient-sample",
          {
            criterion: comparatorMissing
              ? `evaluated games without ${candidate.attribute.name}`
              : "evaluated games in both attribute groups",
            observed: comparatorMissing ? 0 : Math.min(supporting.length, comparators.length),
            required: SUGGESTION_MIN_GROUP_SIZE,
          },
          comparatorMissing
            ? `No evaluated comparison games without ${candidate.attribute.name} are available`
            : `At least ${SUGGESTION_MIN_GROUP_SIZE} evaluated games are required in both ${candidate.attribute.name} groups`,
          `axis-suggestion:${key}`,
        ),
      );
      continue;
    }

    const supportingMeanGap = mean(supporting.map(({ signedGap }) => signedGap));
    const comparatorMeanGap = mean(comparators.map(({ signedGap }) => signedGap));
    const directionalMean =
      direction === "tournament-outlier" ? supportingMeanGap : -supportingMeanGap;
    const effect =
      direction === "tournament-outlier"
        ? supportingMeanGap - comparatorMeanGap
        : comparatorMeanGap - supportingMeanGap;
    const roundedSupportingMean = roundToTenth(supportingMeanGap);
    const roundedComparatorMean = roundToTenth(comparatorMeanGap);
    const roundedEffect = roundToTenth(effect);
    const directionallyConsistentCount = supporting.filter(({ signedGap }) =>
      direction === "tournament-outlier" ? signedGap > 0 : signedGap < 0,
    ).length;
    const directionalConsistency = directionallyConsistentCount / supporting.length;
    const hasOppositeDivergence = supporting.some(({ signedGap }) =>
      direction === "tournament-outlier"
        ? signedGap < -SUGGESTION_MIN_EFFECT
        : signedGap > SUGGESTION_MIN_EFFECT,
    );
    if (
      hasOppositeDivergence ||
      directionalConsistency < SUGGESTION_MIN_DIRECTIONAL_CONSISTENCY ||
      directionalMean < SUGGESTION_MIN_EFFECT ||
      roundedEffect <= SUGGESTION_MIN_EFFECT
    ) {
      continue;
    }

    const evidenceGames: ReportedInsightEvidenceGame[] = [...supporting, ...comparators].map(
      (outcome) => ({
        gameId: outcome.game.id,
        gameName: outcome.game.name,
        role: hasSuggestionAttribute(outcome.game, candidate.attribute) ? "subject" : "comparator",
        measurements: [
          {
            key: "signed-preference-gap",
            label: "Tournament minus independent fitness",
            value: roundToTenth(outcome.signedGap),
            unit: "rating",
            source: "Tournament comparisons and non-Tournament fitness axes",
          },
          {
            key: "comparison-count",
            label: "Tournament comparisons",
            value: outcome.comparisonCount,
            unit: "comparisons",
            source: "Tournament comparisons",
          },
        ],
      }),
    );
    const firstEvidence = evidenceGames[0];
    if (firstEvidence === undefined) continue;
    const evidence: ReportedAxisSuggestion["evidence"] = [firstEvidence, ...evidenceGames.slice(1)];
    const directionLabel = direction === "tournament-outlier" ? "higher" : "lower";
    const sufficiency: ReportedAxisSuggestion["sufficiency"] = [
      {
        criterion: `same-direction divergent games with ${candidate.attribute.name}`,
        observed: candidate.gameIds.size,
        required: SUGGESTION_MIN_GROUP_SIZE,
        met: true as const,
      },
      {
        criterion: "attribute-positive evaluated games",
        observed: supporting.length,
        required: SUGGESTION_MIN_GROUP_SIZE,
        met: true as const,
      },
      {
        criterion: "attribute-negative comparator games",
        observed: comparators.length,
        required: SUGGESTION_MIN_GROUP_SIZE,
        met: true as const,
      },
      {
        criterion: "attribute-positive directional consistency",
        observed: roundToTenth(directionalConsistency * 100),
        required: SUGGESTION_MIN_DIRECTIONAL_CONSISTENCY * 100,
        met: true as const,
      },
      {
        criterion: "directional mean gap",
        observed: roundToTenth(directionalMean),
        required: SUGGESTION_MIN_EFFECT,
        met: true as const,
      },
      {
        criterion: "difference from attribute-negative games",
        observed: roundedEffect,
        required: SUGGESTION_MIN_EFFECT,
        met: true as const,
      },
    ];

    suggestions.push({
      contractVersion: 1,
      id: `axis-suggestion:${direction}:${candidate.attribute.type}:${candidate.attribute.name}`,
      status: "reported",
      method: SUGGESTION_METHOD,
      cohort: suggestionCohort(gamesWithBgg, outcomes.length),
      sufficiency,
      evidence,
      comparator: {
        description: `Evaluated games without ${candidate.attribute.name}`,
        gameIds: comparators.map(({ game }) => game.id),
      },
      limitations: [
        "This observational association does not prove that the attribute causes preference",
        "Tournament preference reflects only the opponents compared so far",
      ],
      observation: `${candidate.attribute.name} games average a ${roundedSupportingMean.toFixed(1)} signed preference gap versus ${roundedComparatorMean.toFixed(1)} without it`,
      interpretation: `Could ${candidate.attribute.name} explain why Tournament preference is ${directionLabel} than the configured axes predict?`,
      details: {
        source: "divergence-repair",
        attribute: candidate.attribute.name,
        attributeType: candidate.attribute.type,
        direction,
        supportingGameCount: supporting.length,
        comparatorGameCount: comparators.length,
        supportingMeanGap: roundedSupportingMean,
        comparatorMeanGap: roundedComparatorMean,
        effect: roundedEffect,
      },
      notability: {
        metric: "directional signed-gap effect",
        value: roundedEffect,
        threshold: SUGGESTION_MIN_EFFECT,
        direction: "above",
        explanation: `The directional gap differs from attribute-negative games by at least ${SUGGESTION_MIN_EFFECT.toFixed(1)} points`,
      },
      confidence: null,
    });
  }

  return [
    ...retired,
    ...abstained.sort((left, right) => left.id.localeCompare(right.id)),
    ...suggestions.sort(
      (left, right) =>
        right.details.effect - left.details.effect || left.id.localeCompare(right.id),
    ),
  ];
}

function suggestionAttributes(game: Game): SuggestionAttribute[] {
  if (game.bggData === null) return [];
  const attributes = [
    ...game.bggData.mechanics.map(({ name }) => ({ type: "mechanic" as const, name })),
    ...game.bggData.categories.map(({ name }) => ({ type: "category" as const, name })),
  ];
  return [
    ...new Map(
      attributes.map((attribute) => [`${attribute.type}:${attribute.name}`, attribute]),
    ).values(),
  ];
}

function hasSuggestionAttribute(game: Game, attribute: SuggestionAttribute): boolean {
  return suggestionAttributes(game).some(
    (candidate) => candidate.type === attribute.type && candidate.name === attribute.name,
  );
}

function suggestionMembership(
  outcomes: PreferenceOutcome[],
  attribute: SuggestionAttribute,
): Set<string> {
  return new Set(
    outcomes
      .filter(({ game }) => hasSuggestionAttribute(game, attribute))
      .map(({ game }) => game.id),
  );
}

function membershipOverlap(first: ReadonlySet<string>, second: ReadonlySet<string>): number {
  const union = new Set([...first, ...second]);
  if (union.size === 0) return 0;
  const intersectionCount = [...first].filter((gameId) => second.has(gameId)).length;
  return intersectionCount / union.size;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
