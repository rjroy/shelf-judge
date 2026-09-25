import type {
  Collection,
  Game,
  GameWithScore,
  RedundancyAdjustment,
  RedundancySettings,
  TournamentData,
} from "@shelf-judge/shared";
import {
  buildVocabulary,
  computeContinuousRanges,
  encodeGame,
  getOrderedVectorAxes,
  getVectorAxisValues,
} from "./feature-vector.js";
import type { FeatureVector } from "./feature-vector.js";
import { computeRedundancyAdjustments } from "./redundancy-engine.js";
import { deriveDisplayStats } from "./tournament-service.js";

/** Computes only the candidate's adjustment, without persisting or adjusting collection games. */
export function computeRedundancyPreview(
  candidate: GameWithScore,
  collection: Pick<Collection, "games" | "axes">,
  tournamentData: TournamentData,
  allGames: GameWithScore[],
  settings: RedundancySettings,
): RedundancyAdjustment | null {
  if (!settings.enabled || candidate.score === null) return null;

  const gamesWithBgg = collection.games.filter((game) => game.bggData);
  const vocabulary = buildVocabulary(gamesWithBgg);
  const ranges = computeContinuousRanges(gamesWithBgg);
  const vectorAxes = getOrderedVectorAxes(collection.axes);
  const vectorCache = new Map<string, FeatureVector>();
  const getFeatureVector = (game: Game): FeatureVector => {
    const cached = vectorCache.get(game.id);
    if (cached) return cached;
    const values = getVectorAxisValues(
      game,
      vectorAxes,
      deriveDisplayStats(game.id, tournamentData).normalizedScore,
    );
    const vector = encodeGame(game, vocabulary, vectorAxes, values, ranges);
    vectorCache.set(game.id, vector);
    return vector;
  };

  // Existing scores remain pre-redundancy; only the candidate adjustment is returned.
  const adjustments = computeRedundancyAdjustments(
    [...allGames, candidate],
    settings,
    getFeatureVector,
  );
  return adjustments.get(candidate.game.id) ?? null;
}
