/** Internal staged collection adapter; deliberately not imported by live services. */
import {
  DERIVED_AXIS_REGISTRY,
  isEnabledScoringAxis,
  summarizeDerivedAxisConfiguration,
  type Axis,
  type FitnessBreakdownEntry,
  type FitnessResult,
  type PredictionConfidence,
  type ReferenceGame,
  type RedundancyAdjustment,
  type RedundancySettings,
} from "@shelf-judge/shared";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import type { StagedSimilarityCapture } from "./staged-similarity-capture.js";
import { createPreparedSimilarity } from "./prepared-similarity.js";
import {
  prepareStagedSimilarityScope,
  type StagedAxisPairInput,
  type FrozenStagedSimilarityRun,
  type StagedPredictionRequest,
  type StagedRunAuthorizationReader,
  type StagedRunBudget,
} from "./staged-similarity-scope.js";
import { createFitnessService } from "./fitness-service.js";
import { normalizeElo } from "./elo-engine.js";
import { computeUnifiedPrediction, unifiedConfidenceRank } from "./unified-prediction.js";
import type { StagedSimilarityPair } from "./prepared-similarity.js";

export interface UnifiedCollectionPipelineOptions {
  readonly capture: StagedSimilarityCapture;
  readonly cache: Pick<JevPairCache, "available" | "mutationRevision" | "lookup">;
  readonly request: StagedPredictionRequest;
  readonly budget: StagedRunBudget;
  readonly authorizationReader: StagedRunAuthorizationReader;
  /** Penalty policy only; it never gates unified prediction or the S table. */
  readonly redundancySettings: RedundancySettings;
  /** Local operation counters for deterministic performance tests; no persistent telemetry. */
  readonly observer?: UnifiedCollectionPipelineObserver;
}

export interface UnifiedCollectionPipelineObserver {
  onAxisPairIndexBuilt?(indexedPairCount: number): void;
  onAxisPairIndexed?(targetId: string, axisId: string): void;
  onTargetAxisPairIndexLookup?(targetId: string, relatedPairCount: number): void;
  onAxisPairConsumed?(targetId: string, axisId: string): void;
}

export interface UnifiedCollectionPipelineResult {
  readonly run: FrozenStagedSimilarityRun;
  /** Current pre-redundancy fitness, keyed by local collection game identity. */
  readonly fitness: ReadonlyMap<string, FitnessResult>;
  /** The common S table on the exact frozen authorized pair set. */
  readonly pairSimilarities: ReadonlyMap<string, number | null>;
  readonly redundancyAdjustments: ReadonlyMap<string, RedundancyAdjustment>;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function actualAxisValue(
  game: { readonly id: string; readonly ratings: Readonly<Record<string, number>> },
  axis: Axis,
  capture: StagedSimilarityCapture,
): number | null {
  if (axis.source === "personal") {
    const value = game.ratings[axis.id];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (axis.source === "tournament") {
    const stats = capture.sources.tournament.gameStats[game.id];
    if (!stats || stats.comparisonCount <= 0) return null;
    return normalizeElo(
      stats.eloRating ?? 1500,
      capture.sources.tournament.settings.normalizationHalfWidth,
    );
  }
  return null;
}

function assemblePredictedFitness(
  actual: FitnessResult | null,
  axes: readonly Axis[],
  readinessStage: 0 | 1 | 2 | 3,
  predictions: ReturnType<typeof computeUnifiedPrediction>,
): FitnessResult | null {
  const actualEntries = new Map((actual?.breakdown ?? []).map((entry) => [entry.axisId, entry]));
  const breakdown: FitnessBreakdownEntry[] = [];
  let weightedSum = 0;
  let weightSum = 0;
  let actualAxisCount = 0;
  let predictedAxisCount = 0;
  let coveredWeight = 0;
  let totalWeight = 0;
  let lowestConfidence: PredictionConfidence | null = null;
  const referenceIds = new Set<string>();

  for (const axis of axes) {
    totalWeight += axis.weight;
    const actualEntry = actualEntries.get(axis.id);
    if (actualEntry?.effectiveRating !== null && actualEntry !== undefined) {
      breakdown.push({ ...actualEntry, predictionConfidence: "actual", referenceGames: null });
      weightedSum += actualEntry.effectiveRating * axis.weight;
      weightSum += axis.weight;
      actualAxisCount++;
      coveredWeight += axis.weight;
      continue;
    }
    const axisResult = predictions.get(axis.id);
    const prediction = axisResult?.prediction;
    if (prediction) {
      const rating = rounded(prediction.rating);
      const referenceGames: ReferenceGame[] = axisResult.matches.map((match) => {
        referenceIds.add(match.gameId);
        return {
          gameId: match.gameId,
          gameName: match.gameName,
          similarity: rounded(match.similarity * 100) / 100,
        };
      });
      breakdown.push({
        axisId: axis.id,
        axisName: axis.name,
        weight: axis.weight,
        contribution: null,
        source: "predicted",
        derivedField: null,
        sourceValue: rating,
        scoringRawValue: rating,
        effectiveRating: rating,
        preferenceShape: axis.preferenceShape ?? "higher-is-better",
        curveAffected: false,
        unit: null,
        provenance: null,
        configurationSummary: null,
        overridden: false,
        overrideValue: null,
        predictionConfidence: prediction.confidence,
        referenceGames,
      });
      weightedSum += rating * axis.weight;
      weightSum += axis.weight;
      predictedAxisCount++;
      if (prediction.confidence === "strong") coveredWeight += axis.weight;
      if (
        lowestConfidence === null ||
        unifiedConfidenceRank(prediction.confidence) < unifiedConfidenceRank(lowestConfidence)
      ) {
        lowestConfidence = prediction.confidence;
      }
      continue;
    }
    const derived = axis.source === "derived" ? DERIVED_AXIS_REGISTRY[axis.derivedField] : null;
    breakdown.push({
      axisId: axis.id,
      axisName: axis.name,
      weight: axis.weight,
      contribution: null,
      source: axis.source === "legacy" ? "personal" : axis.source,
      derivedField: axis.source === "derived" ? axis.derivedField : null,
      sourceValue: null,
      scoringRawValue: null,
      effectiveRating: null,
      preferenceShape: axis.preferenceShape ?? "higher-is-better",
      curveAffected: false,
      unit: derived?.unit ?? null,
      provenance: derived?.provenance ?? null,
      configurationSummary:
        axis.source === "derived" ? summarizeDerivedAxisConfiguration(axis) : null,
      overridden: false,
      overrideValue: null,
      predictionConfidence:
        readinessStage > 0 && (axis.source === "personal" || axis.source === "tournament")
          ? "insufficient"
          : null,
      referenceGames:
        readinessStage > 0 && (axis.source === "personal" || axis.source === "tournament")
          ? []
          : null,
    });
  }
  if (weightSum === 0 && actualAxisCount + predictedAxisCount === 0) return actual;
  for (const entry of breakdown) {
    if (entry.effectiveRating !== null && weightSum > 0) {
      entry.contribution = rounded((entry.effectiveRating * entry.weight) / weightSum);
    }
  }
  const sourceOrder: Record<string, number> = {
    override: 0,
    derived: 1,
    tournament: 2,
    personal: 3,
    predicted: 4,
  };
  breakdown.sort(
    (a, b) =>
      sourceOrder[a.source] - sourceOrder[b.source] ||
      (b.contribution ?? 0) - (a.contribution ?? 0),
  );
  const score = weightSum > 0 ? rounded(weightedSum / weightSum) : 0;
  const vetoed = actual?.vetoed ?? false;
  const predictionMeta =
    predictedAxisCount > 0
      ? {
          readinessStage,
          confidence: lowestConfidence ?? "insufficient",
          predictedAxisCount,
          actualAxisCount,
          referenceGameCount: referenceIds.size,
          coveragePercent: totalWeight > 0 ? rounded((coveredWeight / totalWeight) * 100) / 100 : 0,
        }
      : null;
  return {
    score: vetoed ? 0 : actualAxisCount + predictedAxisCount > 0 ? score : 0,
    ratedAxisCount: actualAxisCount,
    totalAxisCount: axes.length,
    breakdown,
    vetoed,
    vetoedBy: actual?.vetoedBy ?? null,
    hypotheticalScore: vetoed ? score : null,
    predictionMeta,
    redundancyAdjustment: null,
    redundancySimilarityInfo: { status: "disabled", generationId: null },
  };
}

/** Run actual cache-only P → unified prediction/current fitness → R scope staging. */
export function prepareUnifiedCollectionPipeline(
  options: UnifiedCollectionPipelineOptions,
):
  | { readonly ok: true; readonly value: UnifiedCollectionPipelineResult }
  | { readonly ok: false; readonly reason: string } {
  const { capture } = options;
  const prepared = createPreparedSimilarity({ capture, cache: options.cache });
  const axes = capture.sources.collection.axes.filter(isEnabledScoringAxis);
  const axesById = new Map(axes.map((axis) => [axis.id, axis]));
  const gamesById = new Map(capture.sources.collection.games.map((game) => [game.id, game]));
  const fitness = new Map<string, FitnessResult>();
  const scope = prepareStagedSimilarityScope({
    capture,
    prepared,
    request: options.request,
    budget: options.budget,
    authorizationReader: options.authorizationReader,
    evaluateFitness(input) {
      const fitnessService = createFitnessService();
      const predictionsByTarget = new Map<string, ReturnType<typeof computeUnifiedPrediction>>();
      const axisPairsByTarget = new Map<string, StagedAxisPairInput[]>();
      for (const reference of input.axisPairs) {
        options.observer?.onAxisPairIndexed?.(reference.targetId, reference.axisId);
        const targetPairs = axisPairsByTarget.get(reference.targetId);
        if (targetPairs) targetPairs.push(reference);
        else axisPairsByTarget.set(reference.targetId, [reference]);
      }
      options.observer?.onAxisPairIndexBuilt?.(input.axisPairs.length);
      for (const target of input.targets) {
        const refsByAxis = new Map<
          string,
          Array<{ gameId: string; gameName: string; rating: number; similarity: number | null }>
        >();
        const targetAxisPairs = axisPairsByTarget.get(target.id) ?? [];
        options.observer?.onTargetAxisPairIndexLookup?.(target.id, targetAxisPairs.length);
        for (const reference of targetAxisPairs) {
          options.observer?.onAxisPairConsumed?.(reference.targetId, reference.axisId);
          const axis = axesById.get(reference.axisId);
          const game = gamesById.get(reference.referenceGameId);
          if (!axis || !game) continue;
          const rating = actualAxisValue(game, axis, capture);
          if (rating === null) continue;
          const list = refsByAxis.get(axis.id) ?? [];
          list.push({
            gameId: game.id,
            gameName: game.name,
            rating,
            similarity: prepared.similarity(reference.pair),
          });
          refsByAxis.set(axis.id, list);
        }
        predictionsByTarget.set(
          target.id,
          computeUnifiedPrediction({
            axisIds: input.readiness.stage > 0 ? target.missingAxisIds : [],
            referencesByAxis: refsByAxis,
            settings: capture.sources.predictionSettings,
          }),
        );
      }
      for (const game of capture.sources.collection.games) {
        const actual = fitnessService.calculateScore(
          game,
          [...capture.sources.collection.axes],
          capture.sources.tournament,
        );
        const prediction = predictionsByTarget.get(game.id);
        const result = prediction
          ? assemblePredictedFitness(actual, axes, input.readiness.stage, prediction)
          : actual;
        if (result) fitness.set(game.id, result);
      }
      return new Map(
        capture.sources.collection.games.map((game) => {
          const current = fitness.get(game.id);
          return [
            game.id,
            { score: current?.score ?? null, vetoed: current?.vetoed ?? false },
          ] as const;
        }),
      );
    },
  });
  if (!scope.ok) return scope;
  const pairSimilarities = new Map<string, number | null>();
  for (const entry of scope.run.authorizedPairs)
    pairSimilarities.set(entry.key, prepared.similarity(entry.pair));
  const redundancyAdjustments = new Map<string, RedundancyAdjustment>();
  if (options.redundancySettings.enabled) {
    const collectionGames = new Map(
      capture.sources.collection.games.map((game) => [game.id, game]),
    );
    // `targetIds` are disclosure labels; collection redundancy rows use a joined
    // display string there. Derive endpoint membership from the typed pair instead
    // of parsing that string (local IDs may themselves contain commas).
    const eligibleIds = new Set(
      scope.run.redundancyPairs.flatMap((entry) =>
        entry.pair.domain === "collection" ? [entry.pair.gameAId, entry.pair.gameBId] : [],
      ),
    );
    const neighborsByGame = new Map<string, Array<{ id: string; similarity: number }>>();
    for (const entry of scope.run.redundancyPairs) {
      if (entry.pair.domain !== "collection") continue;
      const similarity = pairSimilarities.get(entry.key);
      if (
        similarity === null ||
        similarity === undefined ||
        similarity < options.redundancySettings.similarityThreshold
      )
        continue;
      for (const [id, other] of [
        [entry.pair.gameAId, entry.pair.gameBId],
        [entry.pair.gameBId, entry.pair.gameAId],
      ]) {
        const list = neighborsByGame.get(id) ?? [];
        list.push({ id: other, similarity });
        neighborsByGame.set(id, list);
      }
    }
    for (const id of eligibleIds) {
      const target = fitness.get(id);
      if (!target || target.vetoed || target.score <= 0) continue;
      const neighbors = (neighborsByGame.get(id) ?? [])
        .map(({ id: neighborId, similarity }) => {
          const result = fitness.get(neighborId);
          const game = collectionGames.get(neighborId);
          return result && game
            ? {
                id: neighborId,
                game,
                score: result.score,
                isPredicted: result.predictionMeta?.actualAxisCount === 0,
                similarity,
              }
            : null;
        })
        .filter((value): value is NonNullable<typeof value> => value !== null)
        .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
      if (neighbors.length < options.redundancySettings.minNeighbors) {
        redundancyAdjustments.set(id, {
          penalty: 0,
          originalScore: target.score,
          adjustedScore: target.score,
          nicheNeighbors: [],
          nicheRank: 1,
          nicheSize: 0,
        });
        continue;
      }
      const targetIsFullyPredicted = target.predictionMeta?.actualAxisCount === 0;
      const better = neighbors.filter((neighbor) => {
        if (Math.round(target.score * 100) === Math.round(neighbor.score * 100)) return false;
        if (!targetIsFullyPredicted && neighbor.isPredicted) return false;
        return neighbor.score > target.score;
      }).length;
      const rawPenalty =
        (better / Math.max(neighbors.length, options.redundancySettings.expectedNeighbors)) *
        options.redundancySettings.maxPenalty;
      const penalty = Math.round(rawPenalty * 100) / 100;
      redundancyAdjustments.set(id, {
        penalty,
        originalScore: target.score,
        adjustedScore: Math.round(Math.max(1, target.score - rawPenalty) * 100) / 100,
        nicheNeighbors: neighbors.map((neighbor) => ({
          gameId: neighbor.id,
          gameName: neighbor.game.name,
          similarity: Math.round(neighbor.similarity * 1000) / 1000,
          fitnessScore: neighbor.score,
          isPredicted: neighbor.isPredicted,
        })),
        nicheRank: better + 1,
        nicheSize: neighbors.length,
      });
    }
  }
  // Keep source/policy and cache-proof currentness checks adjacent to acceptance.
  // The synchronous adapter has no await point between this fence and return.
  if (!scope.run.isAuthorized() || !scope.run.isCalculationCurrent()) {
    return { ok: false, reason: "source-or-cache-changed-before-publication" };
  }
  return {
    ok: true,
    value: Object.freeze({ run: scope.run, fitness, pairSimilarities, redundancyAdjustments }),
  };
}

/** Stable key for matching a staged pair to its recorded common-S table. */
export function unifiedCollectionPairKey(pair: StagedSimilarityPair): string {
  return pair.domain === "collection"
    ? JSON.stringify(["collection", ...[pair.gameAId, pair.gameBId].sort()])
    : JSON.stringify(["wishlist-candidate", pair.candidateBggId, pair.ownedGameId]);
}
