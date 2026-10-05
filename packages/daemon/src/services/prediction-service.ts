import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  Game,
  Collection,
  FitnessResult,
  GameWithScore,
  PredictionReadiness,
  PredictionSettings,
  CollectionProfileCollectionSource,
  TournamentData,
  PredictionUnavailable,
  TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import { CollectionProfileCollectionSourceSchema, CollectionSchema } from "@shelf-judge/shared";
import { isEnabledScoringAxis } from "@shelf-judge/shared";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import type { StorageService } from "./storage-service";
import type { FitnessService } from "./fitness-service";
import type { TournamentService } from "./tournament-service";
import { deriveDisplayStats } from "./tournament-service";
import { BggClientError } from "./bgg-client";
import type {
  BggClient,
  BggGameResult,
  BoardgameFactResult,
  BoardgameScoringInput,
  BggRequestAttemptBudget,
} from "./bgg-client";
import {
  buildVocabulary,
  computeContinuousRanges,
  encodeGame,
  getOrderedVectorAxes,
  getVectorAxisValues,
} from "./feature-vector";
import type { FeatureVector } from "./feature-vector";
import { projectVerifiedBggCandidate } from "./bgg-candidate-projection.js";
import type { FactualScoringGame } from "./feature-vector.js";
import { computePredictedFitness, assessReadiness } from "./prediction-engine";
import type { ReferenceGameCandidate, ClusterMembership } from "./prediction-engine";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import type { AttentionMutationImpact } from "./attention-candidate-service.js";
import { canonicalSuggestedPlayerPoll } from "./suggested-player-poll.js";
import type { UnifiedScoringService } from "./unified-scoring-service.js";
import { isBggDataStale } from "./game-service.js";
import type { StagedPredictionRequest } from "./staged-similarity-scope.js";
import { projectProfileCollectionSource } from "./game-projection.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import { createVerifiedWishlistRefreshOverlay } from "./staged-similarity-capture.js";
import { createLogger } from "./logger.js";

export interface SnapshotDiagnosticContext {
  requestId: string;
  operationId: string;
}

function sameSnapshotPredictionSources(
  frame: import("./unified-scoring-service.js").UnifiedSourceFrame,
  collection: CollectionProfileCollectionSource,
  tournamentData: TournamentData,
  settings: PredictionSettings,
): boolean {
  const capturedProjection = CollectionProfileCollectionSourceSchema.parse(
    projectProfileCollectionSource(frame.sources.collection),
  );
  const suppliedProjection =
    "semanticRedundancy" in collection
      ? projectProfileCollectionSource(CollectionSchema.parse(collection))
      : CollectionProfileCollectionSourceSchema.parse(collection);
  return (
    canonicalSha256(capturedProjection) === canonicalSha256(suppliedProjection) &&
    canonicalSha256(frame.sources.tournament) === canonicalSha256(tournamentData) &&
    canonicalSha256(frame.sources.predictionSettings) === canonicalSha256(settings)
  );
}

export interface PredictedGameResult {
  game: Game;
  score: FitnessResult;
  /** Verified BGG Thing identity/facts used by this preview, independent of local game metadata. */
  verifiedFact?: BoardgameFactResult;
  /** Complete verified Thing source used by the preview, for daemon persistence consumers. */
  verifiedScoringInput?: BoardgameScoringInput;
  /** Private daemon-only factual projection; callers must not include it in public responses. */
  internalCandidateProjection?: FactualScoringGame;
  /** Private tags for niche preview, kept separate from the public Game projection. */
  internalCandidateTags?: {
    mechanics: readonly { name: string }[];
    categories: readonly { name: string }[];
    families: readonly { name: string }[];
  };
  predictionUnavailable: PredictionUnavailable | null;
  bggObservations?: Pick<
    BggGameResult,
    | "metadataObservation"
    | "playerRangeObservation"
    | "suggestedPlayerPoll"
    | "collectionData"
    | "entityMetadata"
  >;
  previewIdentity?: {
    calculationVersion: "bgg-fitness-preview-v2";
    source: "bgg-thing-scoring-input" | "bgg-thing-facts-fallback" | "local-unverified";
    calculatedAt: string;
    bggObservedAt: string | null;
    collectionRevision: number;
    predictionSettingsVersion: string;
    tournamentDataVersion: string;
  };
  bggVerification?:
    | { status: "verified" }
    | { status: "existing-local-unverified"; failure: string };
}

export interface PredictedBggCandidateResult extends Omit<PredictedGameResult, "score"> {
  /** Null means verified candidate facts exist but current scoring has no factual contribution. */
  score: FitnessResult | null;
}

export interface PredictionSnapshot {
  collection: Collection;
  settings: PredictionSettings;
  tournamentData: TournamentData;
}

export interface PreparedPredictionList {
  /** Computes predicted/pre-redundancy rows against the captured prediction context. */
  listGames(
    ordinaryScores?: ReadonlyMap<string, FitnessResult | null>,
    targetGameIds?: readonly string[],
  ): GameWithScore[];
  /** Unified frame's actual-only baseline, already adjusted from the same S context. */
  listActualGames?(): GameWithScore[];
  /** V2 proof and live guard for durable snapshot publication. */
  semanticScoringInputProof?: import("@shelf-judge/shared").SemanticScoringInputProof;
  isCurrent?(): boolean;
}

function contentVersion(value: unknown): string {
  return `sha256-${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export interface PredictionService {
  predictGame(gameId: string): Promise<PredictedGameResult>;
  predictBggGame(
    bggId: number,
    options?: {
      signal?: AbortSignal;
      verifiedFact?: BoardgameFactResult;
      verifiedScoringInput?: BoardgameScoringInput;
      attemptBudget?: BggRequestAttemptBudget;
      snapshot?: PredictionSnapshot;
    },
  ): Promise<PredictedGameResult>;
  /** Explicit wishlist acquisition may persist verified facts even when scoring is unavailable. */
  predictBggGameForWishlist?(
    bggId: number,
    options?: {
      signal?: AbortSignal;
      verifiedFact?: BoardgameFactResult;
      verifiedScoringInput?: BoardgameScoringInput;
      attemptBudget?: BggRequestAttemptBudget;
      snapshot?: PredictionSnapshot;
    },
  ): Promise<PredictedBggCandidateResult>;
  getReadiness(): Promise<PredictionReadiness>;
  listGamesWithPredictions(targetGameIds?: readonly string[]): Promise<GameWithScore[]>;
  listGamesWithPredictionsFromSnapshot?(
    collection: CollectionProfileCollectionSource,
    tournamentData: TournamentData,
    settings: PredictionSettings,
    targetGameIds?: readonly string[],
  ): Promise<GameWithScore[]>;
  preparePredictionListFromSnapshot?(
    collection: CollectionProfileCollectionSource,
    tournamentData: TournamentData,
    settings: PredictionSettings,
    diagnostics?: SnapshotDiagnosticContext,
  ): Promise<PreparedPredictionList>;
  getSettings(): Promise<PredictionSettings>;
  updateSettings(patch: Partial<PredictionSettings>): Promise<PredictionSettings>;
}

export interface PredictionServiceDeps {
  storageService: StorageService;
  fitnessService: FitnessService;
  tournamentService: TournamentService;
  bggClient?: BggClient;
  now?: () => string;
  afterSourceSave?: (impact: AttentionMutationImpact) => Promise<void>;
  /** Production scoring authority. Legacy estimator is retained only for isolated test callers. */
  unifiedScoringService?: UnifiedScoringService;
}

export function createPredictionService(deps: PredictionServiceDeps): PredictionService {
  const { storageService, fitnessService, bggClient } = deps;
  const unifiedScoringService = deps.unifiedScoringService;
  const profileSourceCoordinator = profileSourceCoordinatorFor(storageService);
  const logger = createLogger("prediction-service");
  let snapshotPreparationSequence = 0;
  const now = deps.now ?? (() => new Date().toISOString());

  async function calculateUnifiedCollection(
    request: StagedPredictionRequest,
    includeRedundancy = false,
  ) {
    if (!unifiedScoringService) throw new Error("Unified scoring is not configured");
    const frame = await unifiedScoringService.capture();
    const calculation = unifiedScoringService.calculate(frame, request, { includeRedundancy });
    const published = await unifiedScoringService.publishCurrent(calculation, () => {
      const games = frame.sources.collection.games;
      const scores =
        request.scope === "predict-game"
          ? calculation.targetFitness
          : calculation.collectionFitness;
      return games
        .filter((game) => {
          if (game.ownership === "previously-owned") return false;
          if (request.scope === "predict-game") return game.id === request.gameId;
          if (request.scope === "collection-targets") return request.targetIds.includes(game.id);
          return true;
        })
        .map((game) => ({
          game,
          score: scores.get(game.id) ?? null,
          bggDataStale: isBggDataStale(game),
        }))
        .sort((left, right) => {
          if (left.score !== null && right.score !== null)
            return right.score.score - left.score.score;
          return left.score === null ? (right.score === null ? 0 : 1) : -1;
        });
    });
    if (published === null) throw new Error("Unified scoring source changed before publication");
    return { frame, calculation, games: published };
  }

  async function loadPredictionContext(snapshot?: {
    collection: CollectionProfileCollectionSource;
    settings: PredictionSettings;
    tournamentData: TournamentData;
  }) {
    // Load collection, prediction settings, and tournament data in parallel.
    // Tournament settings and per-game stats are projected from the same
    // TournamentData object so we don't read tournament.json three times.
    // The raw tournament data is also needed by calculateScore so the
    // tournament axis can contribute its normalized ELO score per the cohort
    // floor (REQ-TAXIS-6/7).
    const { collection, settings, tournamentData } =
      snapshot ??
      (([collection, settings, tournamentData]) => ({ collection, settings, tournamentData }))(
        await Promise.all([
          storageService.loadCollection(),
          storageService.loadPredictionSettings(),
          storageService.loadTournament(),
        ]),
      );
    const allGameStats: Record<string, TournamentGameStatsDisplay> = {};
    for (const gameId of Object.keys(tournamentData.gameStats)) {
      allGameStats[gameId] = deriveDisplayStats(gameId, tournamentData);
    }

    const { games } = collection;
    const axes = collection.axes.filter(isEnabledScoringAxis);
    const vectorAxes = getOrderedVectorAxes(collection.axes);
    const gamesWithBgg = games.filter((g) => g.bggData !== null && g.bggData !== undefined);

    const vocabulary = buildVocabulary(gamesWithBgg);
    const ranges = computeContinuousRanges(gamesWithBgg);

    // Build game ratings map and feature vectors
    const gameRatings = new Map<string, Record<string, number>>();
    const gameVectors = new Map<string, FeatureVector>();

    for (const game of games) {
      const ratings: Record<string, number> = {};
      for (const axis of axes) {
        if (axis.source === "personal" && game.ratings?.[axis.id] !== undefined) {
          ratings[axis.id] = game.ratings[axis.id];
        } else if (axis.source === "tournament") {
          // Tournament axis values are not in game.ratings; they come from
          // deriveDisplayStats(...).normalizedScore (REQ-TAXIS-6/7).
          // null when no comparisons or cohort < 5; only populated values
          // become reference k-NN signal.
          const normalized = allGameStats[game.id]?.normalizedScore;
          if (normalized != null) {
            ratings[axis.id] = normalized;
          }
        }
      }
      if (Object.keys(ratings).length > 0) {
        gameRatings.set(game.id, ratings);
      }

      if (game.bggData) {
        const resolved = getVectorAxisValues(
          game,
          vectorAxes,
          allGameStats[game.id]?.normalizedScore,
        );
        const fv = encodeGame(game, vocabulary, vectorAxes, resolved, ranges);
        gameVectors.set(game.id, fv);
      }
    }

    // Build reference game candidates: games with at least one personal axis rating and BGG data
    const referenceGames: ReferenceGameCandidate[] = [];
    for (const game of games) {
      const ratings = gameRatings.get(game.id);
      const vector = gameVectors.get(game.id);
      if (!ratings || !vector) continue;

      referenceGames.push({
        gameId: game.id,
        gameName: game.name,
        vector,
        ratings,
      });
    }

    // Count rated games (games with at least one personal axis rating)
    const ratedGameCount = gameRatings.size;

    // Compute readiness stage
    const [t1, t2, t3] = settings.stageThresholds;
    let readinessStage: 0 | 1 | 2 | 3;
    if (ratedGameCount >= t3) readinessStage = 3;
    else if (ratedGameCount >= t2) readinessStage = 2;
    else if (ratedGameCount >= t1) readinessStage = 1;
    else readinessStage = 0;

    return {
      collectionRevision: collection.revision,
      games,
      axes,
      vectorAxes,
      vocabulary,
      ranges,
      gameRatings,
      gameVectors,
      referenceGames,
      ratedGameCount,
      readinessStage,
      settings,
      tournamentData,
    };
  }

  function listGamesWithPredictionsFromContext(
    ctx: Awaited<ReturnType<typeof loadPredictionContext>>,
    targetGameIds?: readonly string[],
    ordinaryScores?: ReadonlyMap<string, FitnessResult | null>,
  ): GameWithScore[] {
    const results: GameWithScore[] = [];
    const targets =
      targetGameIds === undefined
        ? ctx.games
        : ctx.games.filter(
            (game) => game.ownership !== "previously-owned" && new Set(targetGameIds).has(game.id),
          );
    for (const game of targets) {
      const mappedScore = ordinaryScores?.has(game.id)
        ? ordinaryScores.get(game.id)!
        : fitnessService.calculateScore(game, ctx.axes, ctx.tournamentData);
      const actualScore = mappedScore === null ? null : { ...mappedScore };
      const allRated = actualScore && actualScore.ratedAxisCount === ctx.axes.length;
      const targetVector = ctx.gameVectors.get(game.id);
      if (allRated || !game.bggData || !targetVector) {
        results.push({ game, score: actualScore });
        continue;
      }
      const { fitnessResult } = computePredictedFitness(
        game,
        ctx.axes,
        ctx.referenceGames,
        targetVector,
        ctx.settings,
        ctx.readinessStage,
        (candidate, axes) =>
          candidate.id === game.id
            ? actualScore
            : fitnessService.calculateScore(candidate, axes, ctx.tournamentData),
      );
      results.push({ game, score: fitnessResult });
    }
    return results.sort((left, right) => {
      if (left.score !== null && right.score !== null) return right.score.score - left.score.score;
      if (left.score !== null) return -1;
      if (right.score !== null) return 1;
      return 0;
    });
  }

  return {
    async predictGame(gameId: string): Promise<PredictedGameResult> {
      if (unifiedScoringService) {
        const { calculation, games } = await calculateUnifiedCollection({
          scope: "predict-game",
          gameId,
        });
        const entry = games[0];
        if (!entry) throw new Error(`Game not found or not eligible for prediction: ${gameId}`);
        if (!entry.game.bggData)
          throw new Error(
            `Game "${entry.game.name}" has no BGG data; prediction requires BGG data.`,
          );
        if (!entry.score)
          throw new Error(`Current prediction is unavailable for game "${entry.game.name}"`);
        const predictionUnavailable: PredictionUnavailable | null =
          calculation.readiness.stage === 0
            ? {
                reason: "stage-0",
                ratedGameCount: calculation.readiness.ratedGameCount,
                gamesNeeded:
                  calculation.readiness.stageThresholds[0] - calculation.readiness.ratedGameCount,
              }
            : null;
        return { game: entry.game, score: entry.score, predictionUnavailable };
      }
      const ctx = await loadPredictionContext();
      const game = ctx.games.find((g) => g.id === gameId);
      if (!game) throw new Error(`Game not found: ${gameId}`);
      if (!game.bggData)
        throw new Error(`Game "${game.name}" has no BGG data; prediction requires BGG data.`);

      const targetVector = ctx.gameVectors.get(gameId);
      if (!targetVector) {
        throw new Error(`Could not compute feature vector for game "${game.name}".`);
      }

      const { fitnessResult } = computePredictedFitness(
        game,
        ctx.axes,
        ctx.referenceGames,
        targetVector,
        ctx.settings,
        ctx.readinessStage,
        (g, a) => fitnessService.calculateScore(g, a, ctx.tournamentData),
      );

      // REQ-PRED-22: indicate when personal-axis prediction is unavailable at Stage 0
      let predictionUnavailable: PredictionUnavailable | null = null;
      if (ctx.readinessStage === 0) {
        const nextStageAt = ctx.settings.stageThresholds[0];
        predictionUnavailable = {
          reason: "stage-0",
          ratedGameCount: ctx.ratedGameCount,
          gamesNeeded: nextStageAt - ctx.ratedGameCount,
        };
      }

      return { game, score: fitnessResult, predictionUnavailable };
    },

    async predictBggGame(bggId, options = {}): Promise<PredictedGameResult> {
      const result = await this.predictBggGameForWishlist!(bggId, options);
      if (!result.score) throw new Error(`Current BGG prediction unavailable for ${bggId}`);
      return result as PredictedGameResult;
    },

    async predictBggGameForWishlist(
      bggId: number,
      options: {
        signal?: AbortSignal;
        verifiedFact?: BoardgameFactResult;
        verifiedScoringInput?: BoardgameScoringInput;
        attemptBudget?: BggRequestAttemptBudget;
        snapshot?: PredictionSnapshot;
      } = {},
    ): Promise<PredictedBggCandidateResult> {
      if (!bggClient && !options.verifiedFact && !options.verifiedScoringInput) {
        throw new Error("BGG integration is not configured. Cannot predict games by BGG ID.");
      }
      if (!Number.isSafeInteger(bggId) || bggId <= 0) throw new Error(`Invalid BGG ID: ${bggId}`);
      options.signal?.throwIfAborted();
      const ctx = await loadPredictionContext(options.snapshot);
      const matches = ctx.games.filter((game) =>
        [game.bggId, ...(game.additionalBggIds ?? [])].includes(bggId),
      );
      if (matches.length > 1) throw new Error(`Ambiguous collection match for BGG ID ${bggId}`);
      let facts: Awaited<ReturnType<NonNullable<BggClient["getBoardgameFacts"]>>> | undefined;
      let scoringInput: BoardgameScoringInput | undefined = options.verifiedScoringInput;
      let verificationFailure: string | null = null;
      // A verified fact is sufficient to establish Thing identity, but it is
      // intentionally narrower than the scoring projection. Always obtain the
      // rich scoring input before using that fact for a preview; otherwise the
      // preview would silently score placeholder player/time/category values.
      if (!scoringInput && bggClient?.getBoardgameScoringInput) {
        try {
          scoringInput = await bggClient.getBoardgameScoringInput(
            bggId,
            options.signal,
            options.attemptBudget,
          );
          if (
            scoringInput.bggId !== bggId ||
            scoringInput.type !== "boardgame" ||
            !scoringInput.primaryName
          ) {
            throw new Error("MismatchedId");
          }
        } catch (error) {
          if (options.signal?.aborted) throw error;
          verificationFailure =
            error instanceof BggClientError
              ? error.code
              : error instanceof Error && error.message === "MismatchedId"
                ? "MismatchedId"
                : ((error as { code?: string })?.code ?? "unavailable");
        }
      }
      if (!scoringInput && !options.verifiedFact) {
        try {
          facts = await bggClient?.getBoardgameFacts?.(
            [bggId],
            options.signal,
            options.attemptBudget,
          );
        } catch (error) {
          if (options.signal?.aborted) throw error;
          verificationFailure = error instanceof BggClientError ? error.code : "unavailable";
        }
      } else if (options.verifiedFact) {
        facts = { facts: [options.verifiedFact], failures: [] };
      }
      if (options.verifiedFact && !scoringInput && !verificationFailure) {
        verificationFailure = "ScoringInputUnavailable";
      }
      options.signal?.throwIfAborted();
      if (
        scoringInput &&
        (scoringInput.bggId !== bggId ||
          scoringInput.type !== "boardgame" ||
          !scoringInput.primaryName)
      ) {
        scoringInput = undefined;
        verificationFailure = "MismatchedId";
      }
      // A successful rich Thing read is the authoritative identity for the
      // preview, even when the caller supplied a narrower cached fact first.
      if (scoringInput) {
        facts = {
          facts: [
            {
              bggId,
              primaryName: scoringInput.primaryName!,
              yearPublished: scoringInput.yearPublished,
              yearMissing: scoringInput.missingFields.includes("yearPublished"),
              mechanics: scoringInput.mechanics,
              mechanicsMissing: false,
              mechanicsComplete: true,
              warnings: [],
              observedAt: scoringInput.observedAt,
            },
          ],
          failures: [],
        };
      }
      const serviceFailure = facts?.failures.find((item) => item.bggId === bggId);
      const fact = facts?.facts.find((item) => item.bggId === bggId);
      if (serviceFailure) verificationFailure = serviceFailure.code;
      if (!fact && !verificationFailure) verificationFailure = facts ? "unverified" : "unavailable";
      if (verificationFailure && !matches[0]) {
        if (verificationFailure === "MissingGame")
          throw new Error(`No game found with BGG ID ${bggId}`);
        throw new Error(`BGG Thing verification failed (${verificationFailure}) for ${bggId}`);
      }
      const previewIdentity: NonNullable<PredictedGameResult["previewIdentity"]> = {
        calculationVersion: "bgg-fitness-preview-v2",
        source: verificationFailure
          ? "local-unverified"
          : scoringInput
            ? "bgg-thing-scoring-input"
            : "bgg-thing-facts-fallback",
        calculatedAt: now(),
        bggObservedAt: fact?.observedAt ?? null,
        collectionRevision: ctx.collectionRevision,
        predictionSettingsVersion: contentVersion(ctx.settings),
        tournamentDataVersion: contentVersion(ctx.tournamentData),
      };
      if (matches[0]) {
        const game = matches[0];
        if (unifiedScoringService) {
          const { games, calculation } = await calculateUnifiedCollection({
            scope: "predict-game",
            gameId: game.id,
          });
          const current = games[0]?.score;
          if (!current) throw new Error("Current local prediction is unavailable");
          return {
            game,
            score: current,
            predictionUnavailable:
              calculation.readiness.stage === 0
                ? {
                    reason: "stage-0",
                    ratedGameCount: calculation.readiness.ratedGameCount,
                    gamesNeeded:
                      calculation.readiness.stageThresholds[0] -
                      calculation.readiness.ratedGameCount,
                  }
                : null,
            previewIdentity,
            ...(verificationFailure
              ? {
                  bggVerification: {
                    status: "existing-local-unverified" as const,
                    failure: verificationFailure,
                  },
                }
              : {
                  verifiedFact: fact,
                  verifiedScoringInput: scoringInput,
                  bggVerification: { status: "verified" as const },
                }),
          };
        }
        const score = fitnessService.calculateScore(game, ctx.axes, ctx.tournamentData);
        if (verificationFailure) {
          if (!score) throw new Error("Existing local score is unavailable");
          return {
            game,
            score,
            predictionUnavailable: null,
            previewIdentity,
            bggVerification: { status: "existing-local-unverified", failure: verificationFailure },
          };
        }
        if (score && score.ratedAxisCount === ctx.axes.length) {
          return {
            game,
            score,
            predictionUnavailable: null,
            previewIdentity,
            verifiedFact: fact,
            verifiedScoringInput: scoringInput,
            bggVerification: { status: "verified" },
          };
        }
        const targetVector = ctx.gameVectors.get(game.id);
        if (!targetVector) {
          if (!score) throw new Error("Existing local score is unavailable");
          return {
            game,
            score,
            predictionUnavailable: null,
            previewIdentity,
            verifiedFact: fact,
            verifiedScoringInput: scoringInput,
          };
        }
        const predicted = computePredictedFitness(
          game,
          ctx.axes,
          ctx.referenceGames,
          targetVector,
          ctx.settings,
          ctx.readinessStage,
          (candidate, axes) => fitnessService.calculateScore(candidate, axes, ctx.tournamentData),
        ).fitnessResult;
        const threshold = ctx.settings.stageThresholds[0];
        return {
          game,
          score: predicted,
          predictionUnavailable:
            ctx.readinessStage === 0
              ? {
                  reason: "stage-0",
                  ratedGameCount: ctx.ratedGameCount,
                  gamesNeeded: threshold - ctx.ratedGameCount,
                }
              : null,
          previewIdentity,
          verifiedFact: fact,
          verifiedScoringInput: scoringInput,
          bggVerification: { status: "verified" },
        };
      }
      if (!fact) throw new Error(`BGG Thing did not verify BGG ID ${bggId}`);
      const bggData =
        scoringInput?.communityRating == null
          ? null
          : {
              communityRating: scoringInput.communityRating,
              bayesAverage: 0,
              weight: scoringInput?.weight ?? null,
              numWeightVotes: 0,
              description: null,
              mechanics: scoringInput?.mechanics ?? fact.mechanics,
              categories: scoringInput?.categories ?? [],
              families: [],
              subdomains: [],
              bestPlayerCount: scoringInput?.bestPlayers ?? null,
              fetchedAt: fact.observedAt,
            };
      const privateProjection = projectVerifiedBggCandidate({
        id: `preview-${bggId}`,
        communityRating: scoringInput?.communityRating ?? null,
        weight: scoringInput?.weight ?? null,
        mechanics: scoringInput?.mechanics ?? fact.mechanics,
        categories: scoringInput?.categories ?? [],
        minPlayers: scoringInput?.minPlayers ?? null,
        maxPlayers: scoringInput?.maxPlayers ?? null,
        bestPlayers: scoringInput?.bestPlayers ?? null,
        playingTime: scoringInput?.playingTime ?? null,
      });
      const observedAt = now();
      const tempGame: Game = {
        id: `preview-${bggId}`,
        bggId,
        name: fact.primaryName,
        yearPublished: scoringInput?.yearPublished ?? fact.yearPublished,
        minPlayers: scoringInput?.minPlayers ?? null,
        maxPlayers: scoringInput?.maxPlayers ?? null,
        bestPlayers: null,
        playingTime: scoringInput?.playingTime ?? null,
        imageUrl: null,
        numPlays: null,
        bggData,
        acquisition: { state: "unknown" },
        playCountEvidence: { status: "missing", source: "bgg-collection", observedAt: null },
        durationEvidence:
          scoringInput?.playingTime == null
            ? { status: "missing", source: "bgg-thing", observedAt: null }
            : {
                status: "valid",
                value: scoringInput.playingTime,
                source: "bgg-thing",
                observedAt: scoringInput.observedAt,
              },
        playerRangeEvidence:
          scoringInput?.minPlayers != null && scoringInput.maxPlayers != null
            ? {
                status: "valid",
                value: { minPlayers: scoringInput.minPlayers, maxPlayers: scoringInput.maxPlayers },
                source: "bgg-thing",
                observedAt: scoringInput.observedAt,
              }
            : { status: "missing", source: "bgg-player-range", observedAt: null },
        suggestedPlayerPoll: canonicalSuggestedPlayerPoll(scoringInput?.suggestedPlayerPoll) ?? {
          status: "valid",
          state: "absent",
          buckets: [],
          source: "bgg-suggested-player-poll",
          observedAt: null,
        },
        bestPlayersInvalidEvidence: null,
        manualValues: { playingTime: null, playerCount: null },
        entityMetadata: createInitialEntityMetadata(bggId),
        latestPlayCountCheck: null,
        ownership: "owned",
        boxDimensions: null,
        manualShelfId: null,
        ratings: {},
        createdAt: observedAt,
        updatedAt: observedAt,
      };

      if (unifiedScoringService) {
        if (verificationFailure || !fact)
          throw new Error(`Unified BGG prediction requires verified scoring inputs for ${bggId}`);
        const candidate = {
          bggId,
          name: fact.primaryName,
          bggSource: {
            observedAt: scoringInput?.observedAt ?? fact.observedAt,
            description: scoringInput?.description ?? null,
            mechanics: (scoringInput?.mechanics ?? fact.mechanics).map((item) => item.name),
            categories: (scoringInput?.categories ?? []).map((item) => item.name),
            weight: scoringInput?.weight ?? null,
            communityRating: scoringInput?.communityRating ?? null,
            minPlayers: scoringInput?.minPlayers ?? null,
            maxPlayers: scoringInput?.maxPlayers ?? null,
            bestPlayers: scoringInput?.bestPlayers ?? null,
            playingTime: scoringInput?.playingTime ?? null,
          },
        };
        const frame = await unifiedScoringService.capture({
          includeWishlist: true,
          verifiedRefreshOverlays: [createVerifiedWishlistRefreshOverlay(candidate)],
        });
        const calculation = unifiedScoringService.calculate(
          frame,
          { scope: "wishlist", selectedBggIds: [bggId] },
          { includeRedundancy: true },
        );
        const current = await unifiedScoringService.publishCurrent(calculation, () =>
          calculation.wishlistResults.find((item) => item.entry.bggId === bggId),
        );
        if (!current) throw new Error("Unified BGG scoring source changed before publication");
        const prediction = current.prediction;
        return {
          game: tempGame,
          score: prediction.availability === "available" ? prediction.result : null,
          predictionUnavailable:
            prediction.availability === "available"
              ? prediction.predictionUnavailable
              : prediction.predictionUnavailable,
          previewIdentity,
          verifiedFact: fact,
          verifiedScoringInput: scoringInput,
          internalCandidateProjection: privateProjection.factualGame,
          internalCandidateTags: privateProjection.nicheTags,
          bggVerification: { status: "verified" },
        };
      }

      // Encode the temporary game using the collection's vocabulary and ranges
      const resolved = getVectorAxisValues(privateProjection.factualGame, ctx.vectorAxes, null);
      const fv = encodeGame(
        privateProjection.factualGame,
        ctx.vocabulary,
        ctx.vectorAxes,
        resolved,
        ctx.ranges,
      );
      const targetVector = fv;

      const { fitnessResult, actualAxisCount, predictedAxisCount } = computePredictedFitness(
        tempGame,
        ctx.axes,
        ctx.referenceGames,
        targetVector,
        ctx.settings,
        ctx.readinessStage,
        (g, a) =>
          fitnessService.calculateScore(privateProjection.scoringInput, a, ctx.tournamentData),
      );
      const candidateScore =
        actualAxisCount === 0 && predictedAxisCount === 0 ? null : fitnessResult;

      // REQ-PRED-22: indicate when personal-axis prediction is unavailable at Stage 0
      let predictionUnavailable: PredictionUnavailable | null = null;
      if (ctx.readinessStage === 0) {
        const nextStageAt = ctx.settings.stageThresholds[0];
        predictionUnavailable = {
          reason: "stage-0",
          ratedGameCount: ctx.ratedGameCount,
          gamesNeeded: nextStageAt - ctx.ratedGameCount,
        };
      }

      return {
        game: tempGame,
        score: candidateScore,
        predictionUnavailable,
        previewIdentity,
        verifiedFact: fact,
        verifiedScoringInput: scoringInput,
        internalCandidateProjection: privateProjection.factualGame,
        internalCandidateTags: privateProjection.nicheTags,
        bggVerification: { status: "verified" },
      };
    },

    async getReadiness(): Promise<PredictionReadiness> {
      const [collection, settings, tournamentData] = await Promise.all([
        storageService.loadCollection(),
        storageService.loadPredictionSettings(),
        storageService.loadTournament(),
      ]);

      const { games } = collection;
      const axes = collection.axes.filter(isEnabledScoringAxis);
      const gamesWithBgg = games.filter((g) => g.bggData !== null && g.bggData !== undefined);
      const vocabulary = buildVocabulary(gamesWithBgg);

      const gameRatings = new Map<string, Record<string, number>>();
      for (const game of games) {
        const ratings: Record<string, number> = {};
        for (const axis of axes) {
          if (axis.source === "personal" && game.ratings?.[axis.id] !== undefined) {
            ratings[axis.id] = game.ratings[axis.id];
          } else if (axis.source === "tournament") {
            // REQ-TAXIS-8: tournament axis ratings count toward weakAxes
            // thresholds, but the values come from tournament stats, not
            // game.ratings. null when no comparisons or cohort < 5.
            const normalized = deriveDisplayStats(game.id, tournamentData).normalizedScore;
            if (normalized !== null) {
              ratings[axis.id] = normalized;
            }
          }
        }
        if (Object.keys(ratings).length > 0) {
          gameRatings.set(game.id, ratings);
        }
      }

      // Build cluster membership for suggested actions
      const clusterMembership: ClusterMembership = new Map();
      for (const game of games) {
        if (!game.bggData) continue;
        for (const mech of game.bggData.mechanics) {
          if (!clusterMembership.has(mech.name)) {
            clusterMembership.set(mech.name, new Set());
          }
          clusterMembership.get(mech.name)!.add(game.id);
        }
        for (const cat of game.bggData.categories) {
          if (!clusterMembership.has(cat.name)) {
            clusterMembership.set(cat.name, new Set());
          }
          clusterMembership.get(cat.name)!.add(game.id);
        }
      }

      return assessReadiness(
        gameRatings.size,
        axes,
        gameRatings,
        vocabulary,
        settings,
        clusterMembership,
      );
    },

    async listGamesWithPredictions(targetGameIds): Promise<GameWithScore[]> {
      if (unifiedScoringService) {
        return (
          await calculateUnifiedCollection(
            targetGameIds === undefined
              ? { scope: "collection-all" }
              : { scope: "collection-targets", targetIds: targetGameIds },
          )
        ).games;
      }
      const ctx = await loadPredictionContext();
      return listGamesWithPredictionsFromContext(ctx, targetGameIds);
    },

    async listGamesWithPredictionsFromSnapshot(
      collection,
      tournamentData,
      settings,
      targetGameIds,
    ) {
      if (unifiedScoringService) {
        const frame = await unifiedScoringService.capture();
        if (!sameSnapshotPredictionSources(frame, collection, tournamentData, settings))
          throw new Error("Snapshot prediction sources do not match the current private capture");
        const calculation = unifiedScoringService.calculate(
          frame,
          targetGameIds === undefined
            ? { scope: "collection-all" }
            : { scope: "collection-targets", targetIds: targetGameIds },
          { includeRedundancy: false },
        );
        const published = await unifiedScoringService.publishCurrent(calculation, () => {
          const targetSet = targetGameIds ? new Set(targetGameIds) : null;
          return frame.sources.collection.games
            .filter(
              (game) =>
                game.ownership !== "previously-owned" && (!targetSet || targetSet.has(game.id)),
            )
            .map((game) => ({
              game,
              score: calculation.collectionFitness.get(game.id) ?? null,
              bggDataStale: isBggDataStale(game),
            }));
        });
        if (published === null) throw new Error("Snapshot prediction source changed");
        return published;
      }
      const ctx = await loadPredictionContext({ collection, tournamentData, settings });
      return listGamesWithPredictionsFromContext(ctx, targetGameIds);
    },

    async preparePredictionListFromSnapshot(collection, tournamentData, settings, diagnostics) {
      const callId = `snapshot-prediction-${++snapshotPreparationSequence}`;
      const context = {
        ...(diagnostics ?? { requestId: callId, operationId: callId }),
        callId,
      };
      if (unifiedScoringService) {
        const captureStartedAt = performance.now();
        logger.debug?.("snapshot prediction phase attempt", { ...context, phase: "capture" });
        let frame: Awaited<ReturnType<UnifiedScoringService["capture"]>>;
        try {
          frame = await unifiedScoringService.capture();
          logger.debug?.("snapshot prediction phase completed", {
            ...context,
            phase: "capture",
            elapsedMs: Math.max(0, performance.now() - captureStartedAt),
            outcome: "captured",
          });
        } catch (error) {
          logger.error("snapshot prediction phase failed", {
            ...context,
            phase: "capture",
            elapsedMs: Math.max(0, performance.now() - captureStartedAt),
            errorClass: error instanceof Error ? error.name : "UnknownError",
          });
          throw error;
        }
        if (!sameSnapshotPredictionSources(frame, collection, tournamentData, settings))
          throw new Error("Snapshot prediction sources do not match the current private capture");
        const calculationStartedAt = performance.now();
        logger.debug?.("snapshot prediction phase attempt", {
          ...context,
          phase: "calculation",
          gameCount: frame.sources.collection.games.length,
        });
        let calculation: ReturnType<UnifiedScoringService["calculate"]>;
        try {
          calculation = unifiedScoringService.calculate(
            frame,
            { scope: "collection-all" },
            { includeRedundancy: true },
          );
          logger.debug?.("snapshot prediction phase completed", {
            ...context,
            phase: "calculation",
            gameCount: frame.sources.collection.games.length,
            elapsedMs: Math.max(0, performance.now() - calculationStartedAt),
            outcome: "calculated",
          });
        } catch (error) {
          logger.error("snapshot prediction phase failed", {
            ...context,
            phase: "calculation",
            elapsedMs: Math.max(0, performance.now() - calculationStartedAt),
            errorClass: error instanceof Error ? error.name : "UnknownError",
          });
          throw error;
        }
        const publicationStartedAt = performance.now();
        logger.debug?.("snapshot prediction phase attempt", { ...context, phase: "publication" });
        let accepted: boolean | null;
        try {
          accepted = await unifiedScoringService.publishCurrent(calculation, () => true);
          logger.debug?.("snapshot prediction phase completed", {
            ...context,
            phase: "publication",
            elapsedMs: Math.max(0, performance.now() - publicationStartedAt),
            outcome: accepted ? "published" : "rejected",
          });
        } catch (error) {
          logger.error("snapshot prediction phase failed", {
            ...context,
            phase: "publication",
            elapsedMs: Math.max(0, performance.now() - publicationStartedAt),
            errorClass: error instanceof Error ? error.name : "UnknownError",
          });
          throw error;
        }
        if (!accepted) throw new Error("Snapshot prediction source changed before preparation");
        const entriesFor = (scores: ReadonlyMap<string, FitnessResult | null>) =>
          frame.sources.collection.games.map((game) => {
            const score = scores.get(game.id) ?? null;
            if (score === null) return { game, score, bggDataStale: isBggDataStale(game) };
            const current = structuredClone(score);
            const adjustment = calculation.redundancyAdjustments.get(game.id) ?? null;
            current.redundancyAdjustment = adjustment;
            current.redundancySimilarityInfo = {
              status: calculation.redundancySimilarityStatus(game.id),
              generationId: null,
            };
            if (adjustment && frame.redundancySettings.stage === "integrated")
              current.score = adjustment.adjustedScore;
            return { game, score: current, bggDataStale: isBggDataStale(game) };
          });
        return {
          listGames: () => entriesFor(calculation.collectionFitness),
          listActualGames: () => entriesFor(calculation.actualFitness),
          semanticScoringInputProof: calculation.proof,
          isCurrent: () => calculation.isCurrent(),
        };
      }
      const ctx = await loadPredictionContext({ collection, tournamentData, settings });
      return {
        listGames: (ordinaryScores, targetGameIds) =>
          listGamesWithPredictionsFromContext(ctx, targetGameIds, ordinaryScores),
      };
    },

    async getSettings(): Promise<PredictionSettings> {
      return storageService.loadPredictionSettings();
    },

    async updateSettings(patch: Partial<PredictionSettings>): Promise<PredictionSettings> {
      return profileSourceCoordinator.runExclusive(async () => {
        const current = await storageService.loadPredictionSettings();
        const updated: PredictionSettings = { ...current, ...patch };
        await storageService.savePredictionSettings(updated);
        await deps.afterSourceSave?.({ kind: "global", reason: "prediction" });
        return updated;
      });
    },
  };
}
