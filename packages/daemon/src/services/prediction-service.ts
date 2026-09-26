import { createHash } from "node:crypto";
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
import { computePredictedFitness, assessReadiness } from "./prediction-engine";
import type { ReferenceGameCandidate, ClusterMembership } from "./prediction-engine";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import type { AttentionMutationImpact } from "./attention-candidate-service.js";
import { canonicalSuggestedPlayerPoll } from "./suggested-player-poll.js";

export interface PredictedGameResult {
  game: Game;
  score: FitnessResult;
  /** Verified BGG Thing identity/facts used by this preview, independent of local game metadata. */
  verifiedFact?: BoardgameFactResult;
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

export interface PredictionSnapshot {
  collection: Collection;
  settings: PredictionSettings;
  tournamentData: TournamentData;
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
  getReadiness(): Promise<PredictionReadiness>;
  listGamesWithPredictions(targetGameIds?: readonly string[]): Promise<GameWithScore[]>;
  listGamesWithPredictionsFromSnapshot?(
    collection: CollectionProfileCollectionSource,
    tournamentData: TournamentData,
    settings: PredictionSettings,
    targetGameIds?: readonly string[],
  ): Promise<GameWithScore[]>;
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
}

export function createPredictionService(deps: PredictionServiceDeps): PredictionService {
  const { storageService, fitnessService, bggClient } = deps;
  const profileSourceCoordinator = profileSourceCoordinatorFor(storageService);
  const now = deps.now ?? (() => new Date().toISOString());

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
  ): GameWithScore[] {
    const results: GameWithScore[] = [];
    const targets =
      targetGameIds === undefined
        ? ctx.games
        : ctx.games.filter(
            (game) => game.ownership !== "previously-owned" && new Set(targetGameIds).has(game.id),
          );
    for (const game of targets) {
      const actualScore = fitnessService.calculateScore(game, ctx.axes, ctx.tournamentData);
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
        (candidate, axes) => fitnessService.calculateScore(candidate, axes, ctx.tournamentData),
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

    async predictBggGame(
      bggId: number,
      options: {
        signal?: AbortSignal;
        verifiedFact?: BoardgameFactResult;
        verifiedScoringInput?: BoardgameScoringInput;
        attemptBudget?: BggRequestAttemptBudget;
        snapshot?: PredictionSnapshot;
      } = {},
    ): Promise<PredictedGameResult> {
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
            bggVerification: { status: "verified" },
          };
        }
        const targetVector = ctx.gameVectors.get(game.id);
        if (!targetVector) {
          if (!score) throw new Error("Existing local score is unavailable");
          return { game, score, predictionUnavailable: null, previewIdentity, verifiedFact: fact };
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
          bggVerification: { status: "verified" },
        };
      }
      if (!fact) throw new Error(`BGG Thing did not verify BGG ID ${bggId}`);
      const bggData = {
        communityRating: 0,
        bayesAverage: 0,
        weight: scoringInput?.weight ?? null,
        numWeightVotes: 0,
        description: null,
        mechanics: scoringInput?.mechanics ?? fact.mechanics,
        categories: scoringInput?.categories ?? [],
        families: [],
        subdomains: [],
        bestPlayerCount: null,
        fetchedAt: fact.observedAt,
      };
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

      // Encode the temporary game using the collection's vocabulary and ranges
      const resolved = getVectorAxisValues(tempGame, ctx.vectorAxes, null);
      const fv = encodeGame(tempGame, ctx.vocabulary, ctx.vectorAxes, resolved, ctx.ranges);
      const targetVector = fv;

      const { fitnessResult } = computePredictedFitness(
        tempGame,
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

      return {
        game: tempGame,
        score: fitnessResult,
        predictionUnavailable,
        previewIdentity,
        verifiedFact: fact,
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
      const ctx = await loadPredictionContext();
      return listGamesWithPredictionsFromContext(ctx, targetGameIds);
    },

    async listGamesWithPredictionsFromSnapshot(
      collection,
      tournamentData,
      settings,
      targetGameIds,
    ) {
      const ctx = await loadPredictionContext({ collection, tournamentData, settings });
      return listGamesWithPredictionsFromContext(ctx, targetGameIds);
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
