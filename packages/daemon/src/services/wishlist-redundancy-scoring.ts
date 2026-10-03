import type {
  Collection,
  Game,
  GameWithScore,
  RedundancyAdjustment,
  RedundancySettings,
  WishlistBggSourceSnapshot,
  WishlistEntry,
  WishlistEntryReadResult,
  WishlistRedundancyProjection,
} from "@shelf-judge/shared";
import {
  computeCandidateRedundancyAdjustment,
  composeRedundancySignals,
} from "./redundancy-engine.js";
import { createRedundancyFactualContext } from "./redundancy-factual.js";
import type { FactualScoringGame } from "./feature-vector.js";

export interface WishlistDescriptionPairRequest {
  candidate: {
    bggId: number;
    name: string;
    bggSource: WishlistBggSourceSnapshot;
  };
  ownedGame: {
    id: string;
    bggId: number | null;
    name: string;
    description: string | null;
  };
}

export interface WishlistDescriptionSignalCaptureRequest {
  collectionId: string;
  candidateBggIds: readonly number[];
  eligibleOwnedIds: readonly string[];
  semanticPolicy: {
    enabled: boolean;
    weights: { factual: number; description: number };
  };
  /** Only requested candidate-to-eligible-owned pairs with usable descriptions. */
  pairs: readonly WishlistDescriptionPairRequest[];
}

/** Phase 4 supplies one proof-bound capture resolver; values align with request.pairs. */
export type WishlistDescriptionSignalResolver = (
  request: WishlistDescriptionSignalCaptureRequest,
) => Promise<readonly (number | null)[]>;

export interface WishlistRedundancyScoringObserver {
  onEligibleOwnedIndexBuilt?(eligibleOwnedCount: number): void;
  onFactualVocabularyBuilt?(): void;
  onFactualRangesBuilt?(): void;
  onFactualVectorEncoded?(gameId: string): void;
  onCandidateOwnedPair?(candidateBggId: number, ownedGameId: string): void;
}

export interface WishlistRedundancyScoringInput {
  entries: readonly WishlistEntry[];
  collection: Collection;
  scoredGames: readonly GameWithScore[];
  redundancySettings: RedundancySettings;
  resolveDescriptionSignal?: WishlistDescriptionSignalResolver;
  observer?: WishlistRedundancyScoringObserver;
}

function hasUsableDescription(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

function ownedDescriptionSource(game: Game): WishlistDescriptionPairRequest["ownedGame"] {
  return {
    id: game.id,
    bggId: game.bggId,
    name: game.name,
    description: game.bggData?.description ?? null,
  };
}

function isValidSimilarity(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 1;
}

function factualProjection(entry: WishlistEntry): FactualScoringGame | null {
  const source = entry.bggSource;
  if (!source) return null;
  return {
    id: JSON.stringify(["wishlist-bgg", entry.bggId]),
    cacheIdentity: {},
    minPlayers: source.minPlayers,
    maxPlayers: source.maxPlayers,
    bestPlayers: source.bestPlayers,
    playingTime: source.playingTime,
    bggData: {
      weight: source.weight,
      communityRating: source.communityRating,
      mechanics: source.mechanics.map((name) => ({ name })),
      categories: source.categories.map((name) => ({ name })),
    },
  };
}

function savedProjection(entry: WishlistEntry): WishlistRedundancyProjection {
  if (entry.redundancyPreview !== null) {
    const adjustment = structuredClone(entry.redundancyPreview);
    return {
      source: "saved-factual",
      adjustment,
      orderingScore: adjustment.adjustedScore,
    };
  }
  return {
    source: "base-prediction",
    adjustment: null,
    orderingScore: entry.predictedScore,
  };
}

function safeEntryView(entry: WishlistEntry): WishlistEntryReadResult["entry"] {
  const view = structuredClone(entry);
  delete view.bggSource;
  return view;
}

function currentProjection(adjustment: RedundancyAdjustment): WishlistRedundancyProjection {
  return {
    source: "current",
    adjustment,
    orderingScore: adjustment.adjustedScore,
  };
}

function projectOwnedScore(
  collection: Collection,
  scoredGames: readonly GameWithScore[],
): GameWithScore[] {
  const scoresById = new Map(scoredGames.map((scored) => [scored.game.id, scored.score]));
  return collection.games.flatMap((game) => {
    if (game.ownership !== "owned") return [];
    const score = scoresById.get(game.id);
    if (!score || !Number.isFinite(score.score) || score.vetoed || score.score <= 0) {
      return [];
    }
    return [{ game, score }];
  });
}

/** Build separate current read results from one coherent collection/scoring capture. */
export async function computeWishlistRedundancyReadResults(
  input: WishlistRedundancyScoringInput,
): Promise<WishlistEntryReadResult[]> {
  const { entries, collection, scoredGames, redundancySettings, resolveDescriptionSignal } = input;
  const observer = input.observer;
  const ownedBggIds = new Set(
    collection.games.flatMap((game) => (game.bggId === null ? [] : [game.bggId])),
  );
  const eligibleOwned = projectOwnedScore(collection, scoredGames);
  observer?.onEligibleOwnedIndexBuilt?.(eligibleOwned.length);

  const semantic = collection.semanticRedundancy.settings;
  const factualWeight = semantic.weights.factual;
  const descriptionWeight = semantic.enabled ? semantic.weights.description : 0;
  const activeFactual = Number.isFinite(factualWeight) && factualWeight > 0;
  const activeDescription = Number.isFinite(descriptionWeight) && descriptionWeight > 0;
  const sourceCandidates = entries.filter(
    (entry) =>
      entry.bggSource !== undefined &&
      entry.predictedScore !== null &&
      Number.isFinite(entry.predictedScore) &&
      !ownedBggIds.has(entry.bggId),
  );
  const canComputeFactual = redundancySettings.enabled && activeFactual;
  const factualContext =
    canComputeFactual && sourceCandidates.length > 0
      ? createRedundancyFactualContext(collection.games, redundancySettings.componentWeights, {
          onVocabularyBuilt: () => observer?.onFactualVocabularyBuilt?.(),
          onRangesBuilt: () => observer?.onFactualRangesBuilt?.(),
          onVectorEncoded: (gameId) => observer?.onFactualVectorEncoded?.(gameId),
        })
      : null;
  const candidateFeatures = new Map<number, FactualScoringGame>();
  for (const entry of sourceCandidates) {
    const projected = factualProjection(entry);
    if (projected) candidateFeatures.set(entry.bggId, projected);
  }

  const descriptionPairs: WishlistDescriptionPairRequest[] = [];
  if (activeDescription && resolveDescriptionSignal) {
    for (const entry of sourceCandidates) {
      const source = entry.bggSource;
      if (!source || !hasUsableDescription(source.description)) continue;
      for (const owned of eligibleOwned) {
        if (!hasUsableDescription(owned.game.bggData?.description ?? null)) continue;
        descriptionPairs.push({
          candidate: { bggId: entry.bggId, name: entry.name, bggSource: source },
          ownedGame: ownedDescriptionSource(owned.game),
        });
      }
    }
  }
  descriptionPairs.sort(
    (a, b) => a.candidate.bggId - b.candidate.bggId || a.ownedGame.id.localeCompare(b.ownedGame.id),
  );
  const descriptionByPair = new Map<string, number>();
  if (descriptionPairs.length > 0 && resolveDescriptionSignal) {
    try {
      const resolved = await resolveDescriptionSignal({
        collectionId: collection.id,
        candidateBggIds: sourceCandidates.map((entry) => entry.bggId).sort((a, b) => a - b),
        eligibleOwnedIds: eligibleOwned
          .map((owned) => owned.game.id)
          .sort((a, b) => a.localeCompare(b)),
        semanticPolicy: {
          enabled: semantic.enabled,
          weights: { factual: factualWeight, description: descriptionWeight },
        },
        pairs: descriptionPairs,
      });
      if (resolved.length === descriptionPairs.length) {
        for (let index = 0; index < descriptionPairs.length; index++) {
          const score = resolved[index];
          if (isValidSimilarity(score)) {
            const pair = descriptionPairs[index];
            if (pair) {
              descriptionByPair.set(
                JSON.stringify([collection.id, pair.candidate.bggId, pair.ownedGame.id]),
                score,
              );
            }
          }
        }
      }
    } catch {
      // A failed proof/read capture yields no trusted C; factual fallback remains available.
    }
  }

  const results: WishlistEntryReadResult[] = [];
  for (const entry of entries) {
    const publicEntry = safeEntryView(entry);
    const candidate = candidateFeatures.get(entry.bggId);
    if (
      !candidate ||
      entry.predictedScore === null ||
      !Number.isFinite(entry.predictedScore) ||
      !redundancySettings.enabled ||
      (!activeFactual && !activeDescription)
    ) {
      results.push({ entry: publicEntry, redundancy: savedProjection(entry) });
      continue;
    }

    const pairSimilarities = new Map<string, number>();
    for (const owned of eligibleOwned) {
      observer?.onCandidateOwnedPair?.(entry.bggId, owned.game.id);
      const factual =
        canComputeFactual && factualContext
          ? factualContext.similarity(candidate, owned.game)
          : null;
      const description =
        descriptionByPair.get(JSON.stringify([collection.id, entry.bggId, owned.game.id])) ?? null;
      const combined = composeRedundancySignals(
        { factual: factual ?? 0, description, ownerNote: null },
        {
          factual: canComputeFactual ? factualWeight : 0,
          description: activeDescription ? descriptionWeight : 0,
          ownerNote: 0,
        },
      );
      if (combined !== null) pairSimilarities.set(owned.game.id, combined);
    }

    if (eligibleOwned.length > 0 && pairSimilarities.size === 0) {
      results.push({ entry: publicEntry, redundancy: savedProjection(entry) });
      continue;
    }
    const adjustment = computeCandidateRedundancyAdjustment(
      {
        id: JSON.stringify(["wishlist-bgg", collection.id, entry.bggId]),
        name: entry.name,
        score: entry.predictedScore,
      },
      eligibleOwned.map((owned) => ({
        game: owned.game,
        score: owned.score?.score ?? 0,
        isPredicted: owned.score?.predictionMeta?.actualAxisCount === 0,
      })),
      redundancySettings,
      (owned) => pairSimilarities.get(owned.game.id) ?? Number.NaN,
    );
    results.push({
      entry: publicEntry,
      redundancy: adjustment ? currentProjection(adjustment) : savedProjection(entry),
    });
  }
  return results;
}
