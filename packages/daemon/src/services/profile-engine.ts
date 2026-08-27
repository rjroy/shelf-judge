// Pure profile computation functions. No I/O, no service dependencies.
// Implements REQ-PROFILE-1 through 17 (all algorithmic profile requirements).
// Follows the elo-engine.ts and curve-engine.ts pattern: exported functions, heavy unit tests.

import type {
  AxisDistribution,
  AxisSuggestion,
  AxisWeightEntry,
  AttributeCluster,
  CollectionOutlier,
  CollectionProfile,
  TournamentDivergenceInsight,
  Axis,
  FitnessResult,
  EnabledAxis,
  Game,
  OutlierClassification,
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
import {
  buildVocabulary,
  compositeDistance,
  computeCentroid,
  computeContinuousRanges,
  encodeGame,
  getOrderedVectorAxes,
  getVectorAxisValues,
} from "./feature-vector.js";
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
  const outliers = detectOutliers(games, axes, fitnessResults, tournamentStats);
  const suggestions = generateSuggestions(games, enabledAxes, divergence);

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

/**
 * Detect collection outliers via composite feature vector distance.
 * Games without BGG data are excluded.
 */
export function detectOutliers(
  games: Game[],
  axes: Axis[],
  fitnessResults: Map<string, FitnessResult>,
  tournamentStats: ReadonlyMap<string, TournamentGameStatsDisplay> | null = null,
): CollectionOutlier[] {
  const gamesWithBgg = games.filter((g) => g.bggData !== null);
  if (gamesWithBgg.length < 3) return []; // need meaningful collection size

  const vocabulary = buildVocabulary(gamesWithBgg);
  const ranges = computeContinuousRanges(gamesWithBgg);
  const vectorAxes = getOrderedVectorAxes(axes);

  const vectors = gamesWithBgg.map((game) => {
    const axisValues = getVectorAxisValues(
      game,
      vectorAxes,
      tournamentStats?.get(game.id)?.normalizedScore,
    );
    return encodeGame(game, vocabulary, vectorAxes, axisValues, ranges);
  });
  const centroid = computeCentroid(vectors);

  // Compute distances from centroid
  const distances = vectors.map((v) => compositeDistance(v, centroid));

  // Mean and stddev of composite distances
  const composites = distances.map((d) => d.composite);
  const mean = composites.reduce((acc, v) => acc + v, 0) / composites.length;
  const varianceSum = composites.reduce((acc, v) => acc + (v - mean) * (v - mean), 0);
  const stddev = Math.sqrt(varianceSum / composites.length);

  const threshold = mean + 2 * stddev;

  const outliers: CollectionOutlier[] = [];

  for (let i = 0; i < gamesWithBgg.length; i++) {
    if (distances[i].composite <= threshold) continue;

    const game = gamesWithBgg[i];
    const classifications: OutlierClassification[] = [];

    // Lone wolf: nearest neighbor composite distance > 0.5
    let nearestDist = Infinity;
    for (let j = 0; j < gamesWithBgg.length; j++) {
      if (i === j) continue;
      const d = compositeDistance(vectors[i], vectors[j]);
      if (d.composite < nearestDist) nearestDist = d.composite;
    }
    if (nearestDist > 0.5) {
      classifications.push("lone-wolf");
    }

    // Category orphan: game is in a BGG category or subdomain appearing only once
    const categoryCounts = new Map<string, number>();
    const subdomainCounts = new Map<string, number>();
    const familyCounts = new Map<string, number>();
    for (const g of gamesWithBgg) {
      if (g.bggData) {
        for (const c of g.bggData.categories)
          categoryCounts.set(c.name, (categoryCounts.get(c.name) ?? 0) + 1);
        for (const s of g.bggData.subdomains ?? [])
          subdomainCounts.set(s.name, (subdomainCounts.get(s.name) ?? 0) + 1);
        for (const f of g.bggData.families ?? [])
          familyCounts.set(f.name, (familyCounts.get(f.name) ?? 0) + 1);
      }
    }
    const isOrphan =
      (game.bggData?.categories.some((c) => (categoryCounts.get(c.name) ?? 0) === 1) ?? false) ||
      ((game.bggData?.subdomains ?? []).some((s) => (subdomainCounts.get(s.name) ?? 0) === 1) ??
        false) ||
      ((game.bggData?.families ?? []).some((f) => (familyCounts.get(f.name) ?? 0) === 1) ?? false);
    if (isOrphan) {
      classifications.push("category-orphan");
    }

    // High-fitness outlier: fitness score above scale midpoint (axes say "keep it")
    // but BGG attributes say the game doesn't fit the collection identity
    const fitness = fitnessResults.get(game.id);
    if (fitness && fitness.score >= 5.0 && !fitness.vetoed) {
      classifications.push("high-fitness-outlier");
    }

    outliers.push({
      gameId: game.id,
      gameName: game.name,
      distances: distances[i],
      classifications,
      fitnessScore: fitness?.score ?? null,
    });
  }

  return outliers;
}

/**
 * Generate axis suggestions from three sources:
 * 1. Unexpressed concentration (80%+ mechanic/category without matching axis)
 * 2. High-variance BGG attributes (CV > 0.5 without matching axis)
 * 3. Tournament divergence repair (shared attributes across divergent games)
 */
export function generateSuggestions(
  games: Game[],
  axes: EnabledAxis[],
  divergence: TournamentDivergenceInsight[] | null,
): AxisSuggestion[] {
  const suggestions: AxisSuggestion[] = [];
  const gamesWithBgg = games.filter((g) => g.bggData !== null);
  const totalWithBgg = gamesWithBgg.length;

  // Helper: check if any axis name or description references a term (case-insensitive substring)
  const axisCovers = (term: string): boolean => {
    const lower = term.toLowerCase();
    return axes.some(
      (a) =>
        a.name.toLowerCase().includes(lower) ||
        (a.description?.toLowerCase().includes(lower) ?? false),
    );
  };

  // 1. Unexpressed concentration (requires BGG data)
  if (totalWithBgg > 0) {
    const attrCounts = new Map<string, number>();
    for (const game of gamesWithBgg) {
      for (const m of game.bggData!.mechanics)
        attrCounts.set(m.name, (attrCounts.get(m.name) ?? 0) + 1);
      for (const c of game.bggData!.categories)
        attrCounts.set(c.name, (attrCounts.get(c.name) ?? 0) + 1);
    }

    for (const [name, count] of attrCounts) {
      const pct = (count / totalWithBgg) * 100;
      if (pct >= 80 && !axisCovers(name)) {
        suggestions.push({
          source: "unexpressed-concentration",
          attribute: name,
          reason: `${name} appears in ${pct.toFixed(0)}% of your collection but no axis captures it`,
          evidence: { gameCount: count, percentage: pct },
        });
      }
    }
  }

  // 2. High-variance derived attributes
  const enabledDerivedCoverage = new Set(
    axes.flatMap((axis) => (axis.source === "derived" ? [axis.derivedField] : [])),
  );
  for (const projection of getDerivedSuggestionProjections()) {
    const values: number[] = [];
    for (const game of games) {
      const v = projection.projectValue(game);
      if (v !== null) values.push(v);
    }
    if (values.length < 2) continue;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) continue;

    const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
    const stddev = Math.sqrt(variance);
    const cv = stddev / mean;

    if (cv > 0.5) {
      if (!enabledDerivedCoverage.has(projection.derivedField)) {
        suggestions.push({
          source: "high-variance",
          attribute: projection.attribute,
          reason: `Your collection has high variance in ${projection.attribute} (CV=${cv.toFixed(2)}) but no axis tracks it`,
          evidence: { variance: cv },
        });
      }
    }
  }

  // 3. Divergence repair
  const divergentGames = divergence?.flatMap((insight) =>
    insight.status === "reported" ? [insight.details] : [],
  );
  if (divergentGames && divergentGames.length >= 2) {
    const divergentIds = new Set(divergentGames.map((d) => d.gameId));
    const divergentGamesData = games.filter((g) => divergentIds.has(g.id));

    // Find mechanics/categories shared by 2+ divergent games
    const sharedAttrs = new Map<string, number>();
    for (const game of divergentGamesData) {
      if (!game.bggData) continue;
      for (const m of game.bggData.mechanics)
        sharedAttrs.set(m.name, (sharedAttrs.get(m.name) ?? 0) + 1);
      for (const c of game.bggData.categories)
        sharedAttrs.set(c.name, (sharedAttrs.get(c.name) ?? 0) + 1);
    }

    for (const [name, count] of sharedAttrs) {
      if (count >= 2 && !axisCovers(name)) {
        suggestions.push({
          source: "divergence-repair",
          attribute: name,
          reason: `${name} is shared by ${count} games where tournament and fitness scores diverge`,
          evidence: { gameCount: count },
        });
      }
    }
  }

  return suggestions;
}
