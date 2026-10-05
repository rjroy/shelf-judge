/** Internal staged wishlist projection; not wired to current wishlist routes/services. */
import type {
  FitnessResult,
  RedundancySettings,
  WishlistEntry,
  WishlistEntryReadResult,
} from "@shelf-judge/shared";
import {
  validateWishlistEntryReadResultV2,
  type CurrentPredictionProjectionV2,
  type WishlistEntryReadResultV2,
  type WishlistRedundancyProjectionV2,
} from "../../../shared/src/wishlist-current-projection-v2.js";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import { computeCandidateRedundancyAdjustment } from "./redundancy-engine.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import { computeUnifiedFitnessBatch } from "./unified-collection-pipeline.js";
import type { StagedSimilarityCapture } from "./staged-similarity-capture.js";
import type {
  StagedPredictionReadiness,
  StagedRunAuthorizationReader,
  StagedRunBudget,
  StagedSimilarityCalculation,
  FrozenStagedSimilarityRun,
  StagedScopePair,
} from "./staged-similarity-scope.js";
import type { SemanticScoringInputProofV2 } from "../../../shared/src/semantic-scoring-input-proof-v2.js";
import {
  deriveStagedActualAxisContext,
  prepareStagedSimilarityScope,
} from "./staged-similarity-scope.js";
import { createPreparedSimilarity } from "./prepared-similarity.js";
import type { PreparedSimilarityObserver } from "./prepared-similarity.js";

export interface UnifiedWishlistProjectionObserver {
  onSourceCapture?(): void;
  onWishlistPairDemand?(candidateBggId: number, ownedGameId: string): void;
  onWishlistPairResolved?(candidateBggId: number, ownedGameId: string): void;
}

export interface UnifiedWishlistProjectionCalculation {
  readonly scope: StagedSimilarityCalculation | FrozenStagedSimilarityRun;
  readonly proof: SemanticScoringInputProofV2;
  readonly pairSimilarities: ReadonlyMap<string, number | null>;
  readonly calculationDependencyPairs: readonly StagedScopePair[];
  readonly collectionFitness: ReadonlyMap<string, FitnessResult | null>;
  readonly actualFitness: ReadonlyMap<string, FitnessResult | null>;
  readonly results: readonly WishlistEntryReadResultV2[];
}

export interface UnifiedWishlistProjectionOutput {
  readonly results: readonly WishlistEntryReadResultV2[];
  readonly calculation: UnifiedWishlistProjectionCalculation | null;
}

export interface UnifiedWishlistProjectionOptions {
  readonly capture: StagedSimilarityCapture | null;
  readonly cache: Pick<JevPairCache, "available" | "mutationRevision" | "lookup">;
  readonly entries: readonly WishlistEntry[];
  readonly budget: StagedRunBudget;
  readonly authorizationReader?: StagedRunAuthorizationReader;
  /** Ordinary current reads avoid creating the one-use execution authority used by Run. */
  readonly calculationOnly?: boolean;
  readonly redundancySettings: RedundancySettings;
  readonly observer?: UnifiedWishlistProjectionObserver;
  readonly preparedObserver?: PreparedSimilarityObserver;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function currentUnavailable(
  reason: Extract<CurrentPredictionProjectionV2, { availability: "unavailable" }>["reason"],
  predictionUnavailable: CurrentPredictionProjectionV2["predictionUnavailable"],
): CurrentPredictionProjectionV2 {
  return Object.freeze({
    availability: "unavailable",
    source: "current",
    result: null,
    reason,
    predictionUnavailable,
  });
}

function stageUnavailable(
  reason: string,
  entry: WishlistEntry,
  readiness: StagedPredictionReadiness | null,
): CurrentPredictionProjectionV2 {
  const predictionUnavailable =
    readiness !== null && readiness.stage === 0
      ? {
          reason: "stage-0" as const,
          ratedGameCount: readiness.ratedGameCount,
          gamesNeeded: Math.max(0, readiness.stageThresholds[0] - readiness.ratedGameCount),
        }
      : null;
  const mappedReason =
    entry.bggSource === undefined
      ? "missing-source"
      : reason.includes("changed") || reason.includes("current")
        ? "source-changed"
        : reason.includes("no-scoring")
          ? "no-scoring-contribution"
          : "source-unavailable";
  return currentUnavailable(mappedReason, predictionUnavailable);
}

function projectLegacyEntry(
  entry: WishlistEntry,
  prediction: CurrentPredictionProjectionV2,
  redundancy: WishlistRedundancyProjectionV2,
): WishlistEntryReadResult["entry"] {
  const result = prediction.availability === "available" ? prediction.result : null;
  const entryView = structuredClone(entry);
  delete entryView.bggSource;
  return {
    ...entryView,
    predictedScore: result?.score ?? null,
    predictionConfidence: result?.predictionMeta?.confidence ?? null,
    predictedBreakdown:
      result?.breakdown.flatMap((part) =>
        part.effectiveRating === null
          ? []
          : [
              {
                axisName: part.axisName,
                rating: part.effectiveRating,
                confidence: part.predictionConfidence ?? "weak",
              },
            ],
      ) ?? null,
    nicheImpact: null,
    redundancyPreview: redundancy.source === "current" ? redundancy.adjustment : null,
  };
}

function unavailableRedundancy(): WishlistRedundancyProjectionV2 {
  return Object.freeze({ source: "unavailable", adjustment: null, orderingScore: null });
}

/** Safe V2 DTOs for a source capture that could not be established at all. */
export function unavailableUnifiedWishlistProjection(
  entries: readonly WishlistEntry[],
): readonly WishlistEntryReadResultV2[] {
  return Object.freeze(
    entries.map((entry) => {
      const prediction = stageUnavailable("source-unavailable", entry, null);
      return validateWishlistEntryReadResultV2({
        entry: projectLegacyEntry(entry, prediction, unavailableRedundancy()),
        prediction,
        redundancy: unavailableRedundancy(),
      });
    }),
  );
}

function baseRedundancy(score: number): WishlistRedundancyProjectionV2 {
  return Object.freeze({ source: "base-prediction", adjustment: null, orderingScore: score });
}

function keyForWishlistPair(candidateBggId: number, ownedGameId: string): string {
  return JSON.stringify(["wishlist-candidate", candidateBggId, ownedGameId]);
}

/**
 * Build current projections from one captured source and one cache-only resolver. The scope
 * includes separate cache-only owned-fitness dependencies needed to establish current wishlist
 * redundancy eligibility; those dependencies are never exposed as run-authorized pairs.
 */
export function computeUnifiedWishlistProjection(
  options: UnifiedWishlistProjectionOptions,
): readonly WishlistEntryReadResultV2[] {
  return computeUnifiedWishlistProjectionWithCalculation(options).results;
}

export function computeUnifiedWishlistProjectionWithCalculation(
  options: UnifiedWishlistProjectionOptions,
): UnifiedWishlistProjectionOutput {
  const { capture } = options;
  options.observer?.onSourceCapture?.();
  const capturedReadiness = capture
    ? (deriveStagedActualAxisContext(capture)?.readiness ?? null)
    : null;
  if (!capture || !capture.isSourceCurrent()) {
    const failureReason = capture ? "source-changed-before-capture" : "source-unavailable";
    return {
      results: Object.freeze(
        options.entries.map((entry) => {
          const prediction = stageUnavailable(failureReason, entry, capturedReadiness);
          return validateWishlistEntryReadResultV2({
            entry: projectLegacyEntry(entry, prediction, unavailableRedundancy()),
            prediction,
            redundancy: unavailableRedundancy(),
          });
        }),
      ),
      calculation: null,
    };
  }

  const entriesByBggId = new Map(options.entries.map((entry) => [entry.bggId, entry]));
  if (entriesByBggId.size !== options.entries.length) {
    throw new TypeError("Wishlist projection received duplicate BGG IDs");
  }
  const capturedCandidates = new Map(
    (capture.sources.wishlistCandidates ?? []).map((candidate) => [candidate.bggId, candidate]),
  );
  if (
    options.entries.some((entry) => {
      const candidate = capturedCandidates.get(entry.bggId);
      if (entry.bggSource === undefined) return candidate !== undefined;
      return (
        candidate === undefined ||
        canonicalSha256({ name: candidate.name, bggSource: candidate.bggSource }) !==
          canonicalSha256({ name: entry.name, bggSource: entry.bggSource })
      );
    })
  ) {
    return {
      results: Object.freeze(
        options.entries.map((entry) => {
          const prediction = stageUnavailable(
            "source-changed-before-capture",
            entry,
            capturedReadiness,
          );
          return validateWishlistEntryReadResultV2({
            entry: projectLegacyEntry(entry, prediction, unavailableRedundancy()),
            prediction,
            redundancy: unavailableRedundancy(),
          });
        }),
      ),
      calculation: null,
    };
  }
  const prepared = createPreparedSimilarity({
    capture,
    cache: options.cache,
    observer: options.preparedObserver,
  });
  const targetFitness = new Map<string, FitnessResult | null>();
  let collectionFitness = new Map<string, FitnessResult | null>();
  let actualFitness = new Map<string, FitnessResult | null>();
  const request = {
    scope: "wishlist" as const,
    selectedBggIds: [...entriesByBggId.keys()].sort((left, right) => left - right),
  };
  const scope = prepareStagedSimilarityScope({
    capture,
    prepared,
    request,
    budget: options.budget,
    authorizationReader: options.authorizationReader,
    calculationOnly: options.calculationOnly ?? false,
    includeOwnedPredictionDependenciesForWishlist: true,
    evaluateFitness(input) {
      const batch = computeUnifiedFitnessBatch({
        capture,
        prepared,
        actualAxisContext: input.actualAxisContext,
        targets: input.targets,
        axisPairs: [
          ...input.axisPairs,
          ...input.calculationDependencyPairs.flatMap((pair) => pair.axisReferences),
        ],
        readiness: input.readiness,
        includeOwnedPredictionTargets: true,
      });
      collectionFitness = new Map(batch.collectionFitness);
      actualFitness = new Map(batch.actualFitness);
      for (const [id, result] of batch.targetFitness) targetFitness.set(id, result);
      return new Map(
        capture.sources.collection.games.map((game) => {
          const result = batch.collectionFitness.get(game.id);
          return [
            game.id,
            { score: result?.score ?? null, vetoed: result?.vetoed ?? false },
          ] as const;
        }),
      );
    },
  });
  if (!scope.ok) {
    return {
      results: Object.freeze(
        options.entries.map((entry) => {
          const prediction = stageUnavailable(scope.reason, entry, capturedReadiness);
          return validateWishlistEntryReadResultV2({
            entry: projectLegacyEntry(entry, prediction, unavailableRedundancy()),
            prediction,
            redundancy: unavailableRedundancy(),
          });
        }),
      ),
      calculation: null,
    };
  }

  const staged = "run" in scope ? scope.run : scope.calculation;

  const similarities = new Map<string, number | null>();
  for (const authorized of staged.authorizedPairs) {
    similarities.set(authorized.key, prepared.similarity(authorized.pair));
  }

  const ownedFitness = new Map<string, FitnessResult>();
  for (const game of capture.sources.collection.games) {
    const result = collectionFitness.get(game.id);
    if (result) ownedFitness.set(game.id, result);
  }
  const ownedEligible = capture.sources.collection.games.flatMap((game) => {
    const result = ownedFitness.get(game.id);
    return game.ownership === "owned" && result && !result.vetoed && result.score > 0
      ? [
          {
            game: { id: game.id, name: game.name },
            score: result.score,
            isPredicted: result.predictionMeta?.actualAxisCount === 0,
          },
        ]
      : [];
  });

  const predictionUnavailable =
    staged.readiness.stage === 0
      ? {
          reason: "stage-0" as const,
          ratedGameCount: staged.readiness.ratedGameCount,
          gamesNeeded: Math.max(
            0,
            staged.readiness.stageThresholds[0] - staged.readiness.ratedGameCount,
          ),
        }
      : null;

  const results = options.entries.map((entry) => {
    const targetId = `wishlist:${entry.bggId}`;
    const result = targetFitness.get(targetId) ?? null;
    const unavailableTarget =
      "disclosure" in staged
        ? staged.disclosure.unavailableTargetIds.includes(String(entry.bggId))
        : staged.unavailableTargetIds.includes(String(entry.bggId));
    const prediction: CurrentPredictionProjectionV2 = result
      ? Object.freeze({
          availability: "available",
          source: "current",
          result: deepFreeze(structuredClone(result)),
          predictionUnavailable,
        })
      : currentUnavailable(
          entry.bggSource === undefined || unavailableTarget
            ? "missing-source"
            : "no-scoring-contribution",
          predictionUnavailable,
        );

    let redundancy: WishlistRedundancyProjectionV2;
    if (prediction.availability === "unavailable") {
      redundancy = unavailableRedundancy();
    } else if (prediction.result.vetoed) {
      // A current factual veto is authoritative: redundancy must not apply its minimum-score
      // floor to the zero score (the collection path likewise skips vetoed targets).
      redundancy = baseRedundancy(prediction.result.score);
    } else if (!options.redundancySettings.enabled) {
      redundancy = baseRedundancy(prediction.result.score);
    } else {
      const adjustment = computeCandidateRedundancyAdjustment(
        { id: `wishlist:${entry.bggId}`, name: entry.name, score: prediction.result.score },
        ownedEligible,
        options.redundancySettings,
        (owned) => {
          options.observer?.onWishlistPairDemand?.(entry.bggId, owned.game.id);
          const value =
            similarities.get(keyForWishlistPair(entry.bggId, owned.game.id)) ?? Number.NaN;
          if (Number.isFinite(value)) {
            options.observer?.onWishlistPairResolved?.(entry.bggId, owned.game.id);
          }
          return value;
        },
      );
      redundancy = adjustment
        ? Object.freeze({
            source: "current",
            adjustment: deepFreeze(structuredClone(adjustment)),
            orderingScore: adjustment.adjustedScore,
          })
        : baseRedundancy(prediction.result.score);
    }
    return validateWishlistEntryReadResultV2({
      entry: projectLegacyEntry(entry, prediction, redundancy),
      prediction,
      redundancy,
    });
  });

  if (
    ("run" in scope && !scope.run.isAuthorized()) ||
    ("run" in scope && !scope.run.isCalculationCurrent()) ||
    ("calculation" in scope && !scope.calculation.prepared.isCurrent())
  ) {
    return {
      results: Object.freeze(
        options.entries.map((entry) => {
          const prediction = stageUnavailable(
            "source-changed-before-publication",
            entry,
            staged.readiness,
          );
          return validateWishlistEntryReadResultV2({
            entry: projectLegacyEntry(entry, prediction, unavailableRedundancy()),
            prediction,
            redundancy: unavailableRedundancy(),
          });
        }),
      ),
      calculation: null,
    };
  }
  const publishedResults = Object.freeze(results.map((result) => deepFreeze(result)));
  return {
    results: publishedResults,
    calculation: {
      scope: staged,
      proof: staged.proof,
      pairSimilarities: similarities,
      calculationDependencyPairs:
        "calculationDependencyPairs" in staged ? staged.calculationDependencyPairs : [],
      collectionFitness,
      actualFitness,
      results: publishedResults,
    },
  };
}
