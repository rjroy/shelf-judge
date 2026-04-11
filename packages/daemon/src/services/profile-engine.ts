// Pure profile computation functions. No I/O, no service dependencies.
// Implements REQ-PROFILE-1 through 17 (all algorithmic profile requirements).
// Follows the elo-engine.ts and curve-engine.ts pattern: exported functions, heavy unit tests.

import type {
  Axis,
  AxisDistribution,
  AxisSuggestion,
  AxisWeightEntry,
  AttributeCluster,
  CollectionOutlier,
  CollectionProfile,
  DivergentGame,
  FitnessResult,
  Game,
  OutlierClassification,
  TournamentGameStatsDisplay,
  UtilityCurveDeclaration,
  WeightRangeCluster,
} from "@shelf-judge/shared";
import { resolveAxisValues } from "@shelf-judge/shared";

import { getNativeScale } from "./curve-engine.js";
import {
  buildVocabulary,
  compositeDistance,
  computeCentroid,
  computeContinuousRanges,
  encodeGame,
} from "./feature-vector.js";

export interface ProfileInput {
  games: Game[];
  axes: Axis[];
  fitnessResults: Map<string, FitnessResult>;
  tournamentStats: Map<string, TournamentGameStatsDisplay> | null;
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
export function computeProfile(input: ProfileInput): Omit<CollectionProfile, "computedAt"> {
  const { games, axes, fitnessResults, tournamentStats } = input;

  const axisDistributions = computeAxisDistributions(games, axes);
  const axisWeights = computeAxisWeights(axes);
  const bggClustering = computeBggClustering(games);
  const utilityCurves = extractUtilityCurves(axes);
  const divergence =
    tournamentStats !== null ? computeDivergence(fitnessResults, tournamentStats, games) : null;
  const outliers = detectOutliers(games, axes, fitnessResults);
  const suggestions = generateSuggestions(games, axes, divergence);

  const ratedGameCount = games.filter((g) => Object.keys(g.ratings).length > 0).length;

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
export function computeAxisDistributions(games: Game[], axes: Axis[]): AxisDistribution[] {
  return axes.map((axis) => {
    const ratings: number[] = [];
    for (const game of games) {
      const resolved = resolveAxisValues(game, [axis]);
      const r = resolved[axis.id];
      if (r != null) ratings.push(r);
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
export function computeAxisWeights(axes: Axis[]): AxisWeightEntry[] {
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
      for (const attr of extractor(game)) {
        counts.set(attr.name, (counts.get(attr.name) ?? 0) + 1);
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
 * An axis is "non-default" if any of preferenceShape, idealValue, tolerance,
 * leanDirection, or veto is explicitly set.
 */
export function extractUtilityCurves(axes: Axis[]): UtilityCurveDeclaration[] {
  return axes
    .filter(
      (axis) =>
        axis.preferenceShape !== undefined ||
        axis.idealValue !== undefined ||
        axis.tolerance !== undefined ||
        axis.leanDirection !== undefined ||
        axis.veto !== undefined,
    )
    .map((axis) => ({
      axisId: axis.id,
      axisName: axis.name,
      shape: axis.preferenceShape ?? "higher-is-better",
      idealValue: axis.idealValue ?? null,
      tolerance: axis.tolerance ?? null,
      leanDirection: axis.leanDirection ?? null,
      vetoThreshold: axis.veto ?? null,
      nativeScale: getNativeScale(axis.source, axis.bggField),
    }));
}

/**
 * Detect tournament/fitness divergence.
 * Returns null when tournament data is null or empty.
 */
export function computeDivergence(
  fitnessResults: Map<string, FitnessResult>,
  tournamentStats: Map<string, TournamentGameStatsDisplay>,
  games: Game[],
): DivergentGame[] | null {
  if (tournamentStats.size === 0) return null;

  const divergent: DivergentGame[] = [];
  const gameMap = new Map(games.map((g) => [g.id, g]));

  for (const [gameId, stats] of tournamentStats) {
    if (stats.normalizedScore === null) continue;

    const fitness = fitnessResults.get(gameId);
    if (!fitness || fitness.score === 0) continue; // skip vetoed/missing

    const gap = Math.abs(stats.normalizedScore - fitness.score);
    if (gap > 1.5) {
      const game = gameMap.get(gameId);
      const direction: DivergentGame["direction"] =
        stats.normalizedScore > fitness.score ? "tournament-outlier" : "fitness-outlier";

      divergent.push({
        gameId,
        gameName: game?.name ?? gameId,
        fitnessScore: fitness.score,
        normalizedTournamentScore: stats.normalizedScore,
        gap,
        direction,
      });
    }
  }

  return divergent.sort((a, b) => b.gap - a.gap);
}

/**
 * Detect collection outliers via composite feature vector distance.
 * Games without BGG data are excluded.
 */
export function detectOutliers(
  games: Game[],
  axes: Axis[],
  fitnessResults: Map<string, FitnessResult>,
): CollectionOutlier[] {
  const gamesWithBgg = games.filter((g) => g.bggData !== null);
  if (gamesWithBgg.length < 3) return []; // need meaningful collection size

  const vocabulary = buildVocabulary(gamesWithBgg);
  const ranges = computeContinuousRanges(gamesWithBgg);

  const vectors = gamesWithBgg.map((game) => {
    const resolved = resolveAxisValues(game, axes);
    return encodeGame(
      game,
      vocabulary,
      Object.keys(resolved).length > 0 ? resolved : undefined,
      ranges,
      axes,
    );
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
  axes: Axis[],
  divergentGames: DivergentGame[] | null,
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

  // 2. High-variance BGG attributes
  const bggFields: {
    name: string;
    extractor: (g: Game) => number | null;
    bggField: string;
  }[] = [
    {
      name: "BGG weight",
      extractor: (g) => g.bggData?.weight ?? null,
      bggField: "weight",
    },
    {
      name: "community rating",
      extractor: (g) => g.bggData?.communityRating ?? null,
      bggField: "communityRating",
    },
    {
      name: "player count range",
      extractor: (g) =>
        g.minPlayers != null && g.maxPlayers != null ? g.maxPlayers - g.minPlayers : null,
      bggField: "playerCountRange",
    },
    {
      name: "play time",
      extractor: (g) => g.playingTime ?? null,
      bggField: "playingTime",
    },
  ];

  for (const field of bggFields) {
    const values: number[] = [];
    for (const game of games) {
      const v = field.extractor(game);
      if (v !== null) values.push(v);
    }
    if (values.length < 2) continue;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) continue;

    const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
    const stddev = Math.sqrt(variance);
    const cv = stddev / mean;

    if (cv > 0.5) {
      const axisMaps = axes.some((a) => a.source === "bgg" && a.bggField === field.bggField);
      if (!axisMaps) {
        suggestions.push({
          source: "high-variance",
          attribute: field.name,
          reason: `Your collection has high variance in ${field.name} (CV=${cv.toFixed(2)}) but no axis tracks it`,
          evidence: { variance: cv },
        });
      }
    }
  }

  // 3. Divergence repair
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
