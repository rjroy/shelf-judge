import type { RedundancyAdjustment } from "@shelf-judge/shared";
import type {
  PredictionService,
  PredictedGameResult,
  PredictionSnapshot,
} from "./prediction-service.js";
import type { StorageService } from "./storage-service.js";
import type { BoardgameFactResult, BoardgameScoringInput } from "./bgg-client.js";
import type { BggRequestAttemptBudget } from "./bgg-client.js";
import { computeNicheImpact } from "./niche-engine.js";
import { computeRedundancyPreview } from "./redundancy-preview.js";

const HTTP_ATTEMPT_LIMIT = 12;

function createHttpAttemptBudget(): BggRequestAttemptBudget {
  let attempts = 0;
  return {
    tryConsume() {
      if (attempts >= HTTP_ATTEMPT_LIMIT) return false;
      attempts++;
      return true;
    },
  };
}

/** Shared calculation lane used by HTTP and internal Analyst consumers. */
export async function calculateBggFitnessPreview(
  predictionService: PredictionService,
  storageService: StorageService | undefined,
  bggId: number,
  options: {
    signal?: AbortSignal;
    verifiedFact?: BoardgameFactResult;
    verifiedScoringInput?: BoardgameScoringInput;
    attemptBudget?: BggRequestAttemptBudget;
    snapshot?: PredictionSnapshot;
  } = {},
): Promise<{
  result: PredictedGameResult;
  nicheImpact: ReturnType<typeof computeNicheImpact>;
  redundancyPreview: RedundancyAdjustment | null;
}> {
  options.signal?.throwIfAborted();
  const [snapshot, nicheSettings, redundancySettings] = await Promise.all([
    options.snapshot
      ? Promise.resolve(options.snapshot)
      : storageService
        ? Promise.all([
            storageService.loadCollection(),
            storageService.loadPredictionSettings(),
            storageService.loadTournament(),
          ]).then(([collection, settings, tournamentData]) => ({
            collection,
            settings,
            tournamentData,
          }))
        : Promise.resolve(undefined),
    storageService ? storageService.loadNicheSettings() : Promise.resolve(undefined),
    storageService ? storageService.loadRedundancySettings() : Promise.resolve(undefined),
  ]);
  const result = await predictionService.predictBggGame(bggId, {
    ...options,
    snapshot,
    attemptBudget: options.attemptBudget ?? createHttpAttemptBudget(),
  });
  options.signal?.throwIfAborted();
  const allGames =
    snapshot && predictionService.listGamesWithPredictionsFromSnapshot
      ? await predictionService.listGamesWithPredictionsFromSnapshot(
          snapshot.collection,
          snapshot.tournamentData,
          snapshot.settings,
        )
      : await predictionService.listGamesWithPredictions();
  const nicheImpact = computeNicheImpact(allGames, result.game, result.score, nicheSettings);
  let redundancyPreview: RedundancyAdjustment | null = null;
  if (storageService && redundancySettings) {
    if (redundancySettings.enabled && result.predictionUnavailable === null) {
      const [collection, tournamentData] = snapshot
        ? [snapshot.collection, snapshot.tournamentData]
        : await Promise.all([storageService.loadCollection(), storageService.loadTournament()]);
      redundancyPreview = computeRedundancyPreview(
        { game: result.game, score: result.score },
        collection,
        tournamentData,
        allGames,
        redundancySettings,
      );
    }
  }
  options.signal?.throwIfAborted();
  if (storageService && snapshot) {
    const [
      currentCollection,
      currentPredictionSettings,
      currentTournament,
      currentNicheSettings,
      currentRedundancySettings,
    ] = await Promise.all([
      storageService.loadCollection(),
      storageService.loadPredictionSettings(),
      storageService.loadTournament(),
      storageService.loadNicheSettings(),
      storageService.loadRedundancySettings(),
    ]);
    const unchanged =
      JSON.stringify(snapshot.collection) === JSON.stringify(currentCollection) &&
      JSON.stringify(snapshot.settings) === JSON.stringify(currentPredictionSettings) &&
      JSON.stringify(snapshot.tournamentData) === JSON.stringify(currentTournament) &&
      JSON.stringify(nicheSettings) === JSON.stringify(currentNicheSettings) &&
      JSON.stringify(redundancySettings) === JSON.stringify(currentRedundancySettings);
    if (!unchanged)
      throw new Error("Local preview inputs changed during calculation; retry the preview");
  }
  return { result, nicheImpact, redundancyPreview };
}
