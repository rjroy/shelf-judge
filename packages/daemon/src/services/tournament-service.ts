import { v4 as uuidv4 } from "uuid";
import type {
  TournamentData,
  TournamentSession,
  TournamentSettings,
  TournamentGameStatsDisplay,
  Comparison,
  SessionFilter,
  RecentComparison,
  CachedRecentComparison,
  GameWithScore,
} from "@shelf-judge/shared";
import { matchesBggTag } from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import { calculateNewRatings, normalizeElo, shouldDisplayRanking } from "./elo-engine.js";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";

export interface TournamentService {
  startSession(filters: SessionFilter[] | null, games: GameWithScore[]): Promise<TournamentSession>;
  getActiveSession(): Promise<TournamentSession | null>;
  endSession(sessionId: string): Promise<TournamentSession>;
  getNextPair(sessionId: string): Promise<{ gameA: string; gameB: string } | null>;
  submitComparison(
    sessionId: string,
    gameAId: string,
    gameBId: string,
    winnerId: string,
  ): Promise<Comparison>;
  getGameStats(gameId: string): Promise<TournamentGameStatsDisplay>;
  getAllGameStats(): Promise<Record<string, TournamentGameStatsDisplay>>;
  listSessions(): Promise<TournamentSession[]>;
  normalizeFitness(): Promise<{ normalized: number }>;
  onGameDeleted(gameId: string): Promise<void>;
  reconcileWithCollection(): Promise<TournamentReconciliationResult>;
  getSettings(): Promise<TournamentSettings>;
  updateSettings(patch: Partial<TournamentSettings>): Promise<TournamentSettings>;
}

export interface TournamentReconciliationResult {
  changed: boolean;
  gameStatsRemoved: number;
  activeSessionGameIdsRemoved: number;
  sessionsCompleted: number;
}

export interface TournamentServiceDeps {
  storageService: StorageService;
}

function applyFilters(games: GameWithScore[], filters: SessionFilter[]): GameWithScore[] {
  let result = games;

  for (const filter of filters) {
    switch (filter.type) {
      case "name":
        result = result.filter((g) =>
          g.game.name.toLowerCase().includes(filter.value.toLowerCase()),
        );
        break;

      case "minFitness": {
        const threshold = parseFloat(filter.value);
        result = result.filter((g) => g.score !== null && g.score.score >= threshold);
        break;
      }

      case "maxFitness": {
        const threshold = parseFloat(filter.value);
        result = result.filter((g) => g.score !== null && g.score.score <= threshold);
        break;
      }

      case "bggTag": {
        result = result.filter((g) => {
          const bgg = g.game.bggData;
          if (!bgg) return false;
          const tagNames = [
            ...bgg.mechanics.map((m) => m.name),
            ...bgg.categories.map((c) => c.name),
            ...bgg.families.map((f) => f.name),
          ];
          return matchesBggTag(filter.value, tagNames);
        });
        break;
      }
    }
  }

  return result;
}

function removeUnavailableGames(
  data: TournamentData,
  availableGameIds: ReadonlySet<string>,
): TournamentReconciliationResult {
  let gameStatsRemoved = 0;
  let activeSessionGameIdsRemoved = 0;
  let sessionsCompleted = 0;

  for (const gameId of Object.keys(data.gameStats)) {
    if (!availableGameIds.has(gameId)) {
      delete data.gameStats[gameId];
      gameStatsRemoved++;
    }
  }

  for (const session of data.sessions) {
    if (session.status !== "active") continue;

    const retainedGameIds = session.gameIds.filter((gameId) => availableGameIds.has(gameId));
    const removedCount = session.gameIds.length - retainedGameIds.length;
    if (removedCount === 0) continue;

    session.gameIds = retainedGameIds;
    session.updatedAt = new Date().toISOString();
    activeSessionGameIdsRemoved += removedCount;
    if (session.gameIds.length < 4) {
      session.status = "completed";
      session.comparisons = [];
      sessionsCompleted++;
    }
  }

  return {
    changed: gameStatsRemoved > 0 || activeSessionGameIdsRemoved > 0,
    gameStatsRemoved,
    activeSessionGameIdsRemoved,
    sessionsCompleted,
  };
}

/**
 * Derive display stats (normalized ELO score and label) for a game from
 * tournament data. Exported so fitness-service can reuse the same cohort-floor and
 * normalization logic when composing the tournament axis into fitness scores
 * (REQ-TAXIS-6, REQ-TAXIS-7). Pure function; no I/O.
 */
export function deriveDisplayStats(
  gameId: string,
  data: TournamentData,
): TournamentGameStatsDisplay {
  const cached = data.gameStats[gameId];
  const eloRating = cached?.eloRating ?? 1500;
  const comparisonCount = cached?.comparisonCount ?? 0;

  const gamesWithComparisons = Object.values(data.gameStats).filter(
    (s) => s.comparisonCount > 0,
  ).length;

  const canDisplay = shouldDisplayRanking(gamesWithComparisons);
  const normalizedScore =
    canDisplay && comparisonCount > 0
      ? normalizeElo(eloRating, data.settings.normalizationHalfWidth)
      : null;

  let displayLabel: string;
  if (comparisonCount === 0) {
    displayLabel = "not yet ranked";
  } else if (normalizedScore === null) {
    displayLabel = "not yet ranked";
  } else {
    displayLabel = normalizedScore.toFixed(1);
  }

  // Read wins, losses, and recentComparisons from cached gameStats (REQ-RTO-7)
  const wins = cached?.wins ?? 0;
  const losses = cached?.losses ?? 0;
  const recentComparisons: RecentComparison[] = (cached?.recentComparisons ?? []).map((rc) => ({
    opponentGameId: rc.opponentGameId,
    opponentGameName: null, // Enriched with game names at the route layer
    won: rc.won,
    createdAt: rc.createdAt,
  }));

  return {
    eloRating,
    comparisonCount,
    normalizedScore,
    displayLabel,
    wins,
    losses,
    recentComparisons,
  };
}

export function createTournamentService(deps: TournamentServiceDeps): TournamentService {
  const { storageService } = deps;
  const profileSourceCoordinator = profileSourceCoordinatorFor(storageService);

  const service: TournamentService = {
    async startSession(
      filters: SessionFilter[] | null,
      games: GameWithScore[],
    ): Promise<TournamentSession> {
      const data = await storageService.loadTournament();

      // Auto-complete any active session (REQ-TOURN-15)
      const active = data.sessions.find((s) => s.status === "active");
      if (active) {
        active.status = "completed";
        active.comparisons = [];
        active.updatedAt = new Date().toISOString();
      }

      // Apply filters
      const eligible = filters && filters.length > 0 ? applyFilters(games, filters) : games;

      if (eligible.length < 4) {
        throw new Error(
          `At least 4 games are required to start a tournament session, but only ${eligible.length} matched the filters`,
        );
      }

      const now = new Date().toISOString();
      const session: TournamentSession = {
        id: uuidv4(),
        filters,
        gameIds: eligible.map((g) => g.game.id),
        comparisonCount: 0,
        status: "active",
        createdAt: now,
        updatedAt: now,
        comparisons: [],
      };

      data.sessions.push(session);
      await storageService.saveTournament(data);
      return session;
    },

    async getActiveSession(): Promise<TournamentSession | null> {
      const data = await storageService.loadTournament();
      return data.sessions.find((s) => s.status === "active") ?? null;
    },

    async endSession(sessionId: string): Promise<TournamentSession> {
      const data = await storageService.loadTournament();
      const session = data.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      if (session.status === "completed") {
        throw new Error(`Session already completed: ${sessionId}`);
      }

      session.status = "completed";
      session.comparisons = [];
      session.updatedAt = new Date().toISOString();
      await storageService.saveTournament(data);
      return session;
    },

    async getNextPair(sessionId: string): Promise<{ gameA: string; gameB: string } | null> {
      const data = await storageService.loadTournament();
      const session = data.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      if (session.status === "completed") {
        return null;
      }

      // Session gameIds are the available pool (deleted games remain in the list
      // but will have been removed by onGameDeleted, which filters gameIds)
      const availableGameIds = session.gameIds;

      if (availableGameIds.length < 4) {
        // Auto-complete if too few games remain
        session.status = "completed";
        session.comparisons = [];
        session.updatedAt = new Date().toISOString();
        await storageService.saveTournament(data);
        return null;
      }

      // Get pairs already seen in this session (REQ-RTO-8).
      const seenPairs = new Set<string>();
      for (const comp of session.comparisons) {
        const key = [comp.gameAId, comp.gameBId].sort().join("|");
        seenPairs.add(key);
      }

      // Prioritize games that have received the fewest comparisons. For a tied
      // anchor, select the unpresented opponent with the closest ELO rating.
      const eligibleAnchors = availableGameIds.filter((gameA) =>
        availableGameIds.some((gameB) => {
          const key = [gameA, gameB].sort().join("|");
          return gameA !== gameB && !seenPairs.has(key);
        }),
      );
      if (eligibleAnchors.length === 0) {
        // All pairs exhausted this session.
        session.status = "completed";
        session.comparisons = [];
        session.updatedAt = new Date().toISOString();
        await storageService.saveTournament(data);
        return null;
      }
      const fewestComparisons = Math.min(
        ...eligibleAnchors.map((gameId) => data.gameStats[gameId]?.comparisonCount ?? 0),
      );
      const leastComparedAnchors = eligibleAnchors.filter(
        (gameId) => (data.gameStats[gameId]?.comparisonCount ?? 0) === fewestComparisons,
      );
      const gameA = leastComparedAnchors[Math.floor(Math.random() * leastComparedAnchors.length)];
      const gameAElo = data.gameStats[gameA]?.eloRating ?? 1500;

      let closestOpponents: string[] = [];
      let smallestEloDifference = Infinity;
      for (const gameB of availableGameIds) {
        const key = [gameA, gameB].sort().join("|");
        if (gameA === gameB || seenPairs.has(key)) continue;

        const eloDifference = Math.abs(gameAElo - (data.gameStats[gameB]?.eloRating ?? 1500));
        if (eloDifference < smallestEloDifference) {
          smallestEloDifference = eloDifference;
          closestOpponents = [gameB];
        } else if (eloDifference === smallestEloDifference) {
          closestOpponents.push(gameB);
        }
      }

      if (closestOpponents.length > 0) {
        const gameB = closestOpponents[Math.floor(Math.random() * closestOpponents.length)];
        return { gameA, gameB };
      }

      // All pairs exhausted this session
      session.status = "completed";
      session.comparisons = [];
      session.updatedAt = new Date().toISOString();
      await storageService.saveTournament(data);
      return null;
    },

    async submitComparison(
      sessionId: string,
      gameAId: string,
      gameBId: string,
      winnerId: string,
    ): Promise<Comparison> {
      const data = await storageService.loadTournament();
      const session = data.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      if (session.status === "completed") {
        throw new Error(`Session already completed: ${sessionId}`);
      }

      // Ensure both games are in the session
      if (!session.gameIds.includes(gameAId) || !session.gameIds.includes(gameBId)) {
        throw new Error("Both games must be part of the active session");
      }

      // Validate winnerId is one of the compared games
      if (winnerId !== gameAId && winnerId !== gameBId) {
        throw new Error("winnerId must be one of the compared games");
      }

      // Create the comparison record
      const now = new Date().toISOString();
      const comparison: Comparison = {
        id: uuidv4(),
        gameAId,
        gameBId,
        winnerId,
        sessionId,
        createdAt: now,
      };

      session.comparisons.push(comparison);
      session.comparisonCount++;
      session.updatedAt = now;

      // Incremental ELO update
      if (!data.gameStats[gameAId]) {
        data.gameStats[gameAId] = {
          eloRating: 1500,
          comparisonCount: 0,
          wins: 0,
          losses: 0,
          recentComparisons: [],
        };
      }
      if (!data.gameStats[gameBId]) {
        data.gameStats[gameBId] = {
          eloRating: 1500,
          comparisonCount: 0,
          wins: 0,
          losses: 0,
          recentComparisons: [],
        };
      }

      const statsA = data.gameStats[gameAId];
      const statsB = data.gameStats[gameBId];
      const winner: "a" | "b" = winnerId === gameAId ? "a" : "b";

      const { newRatingA, newRatingB } = calculateNewRatings(
        statsA.eloRating,
        statsB.eloRating,
        winner,
        statsA.comparisonCount,
        statsB.comparisonCount,
        data.settings.kFactorThreshold,
      );

      statsA.eloRating = newRatingA;
      statsB.eloRating = newRatingB;
      statsA.comparisonCount++;
      statsB.comparisonCount++;

      // Update cached wins/losses (REQ-RTO-6)
      const loserId = winnerId === gameAId ? gameBId : gameAId;
      data.gameStats[winnerId].wins++;
      data.gameStats[loserId].losses++;

      // Update cached recentComparisons with FIFO cap at 10
      const winnerRecent: CachedRecentComparison = {
        opponentGameId: loserId,
        won: true,
        createdAt: now,
      };
      const loserRecent: CachedRecentComparison = {
        opponentGameId: winnerId,
        won: false,
        createdAt: now,
      };
      data.gameStats[winnerId].recentComparisons.unshift(winnerRecent);
      if (data.gameStats[winnerId].recentComparisons.length > 10) {
        data.gameStats[winnerId].recentComparisons.pop();
      }
      data.gameStats[loserId].recentComparisons.unshift(loserRecent);
      if (data.gameStats[loserId].recentComparisons.length > 10) {
        data.gameStats[loserId].recentComparisons.pop();
      }

      await storageService.saveTournament(data);
      return comparison;
    },

    async getGameStats(gameId: string): Promise<TournamentGameStatsDisplay> {
      const data = await storageService.loadTournament();
      return deriveDisplayStats(gameId, data);
    },

    async getAllGameStats(): Promise<Record<string, TournamentGameStatsDisplay>> {
      const data = await storageService.loadTournament();
      const result: Record<string, TournamentGameStatsDisplay> = {};
      for (const gameId of Object.keys(data.gameStats)) {
        result[gameId] = deriveDisplayStats(gameId, data);
      }
      return result;
    },

    async listSessions(): Promise<TournamentSession[]> {
      const data = await storageService.loadTournament();
      return data.sessions;
    },

    async normalizeFitness(): Promise<{ normalized: number }> {
      const data = await storageService.loadTournament();
      let minElo = Infinity;
      let maxElo = -Infinity;
      for (const stats of Object.values(data.gameStats)) {
        if (stats.eloRating < minElo) {
          minElo = stats.eloRating;
        }
        if (stats.eloRating > maxElo) {
          maxElo = stats.eloRating;
        }
      }

      // calculate the normalization half-width as the distance from 1500 to the furthest rating, or use the existing half-width if it's larger
      const halfWidth = Math.max(
        data.settings.normalizationHalfWidth,
        maxElo - 1500,
        1500 - minElo,
      );
      data.settings.normalizationHalfWidth = halfWidth;

      await storageService.saveTournament(data);
      return { normalized: Object.keys(data.gameStats).length };
    },

    async onGameDeleted(gameId: string): Promise<void> {
      const data = await storageService.loadTournament();
      const availableGameIds = new Set([
        ...Object.keys(data.gameStats),
        ...data.sessions.flatMap((session) => session.gameIds),
      ]);
      availableGameIds.delete(gameId);
      removeUnavailableGames(data, availableGameIds);
      await storageService.saveTournament(data);
    },

    async reconcileWithCollection(): Promise<TournamentReconciliationResult> {
      const collection = await storageService.loadCollection();
      const data = await storageService.loadTournament();
      const result = removeUnavailableGames(data, new Set(collection.games.map((game) => game.id)));
      if (result.changed) {
        await storageService.saveTournament(data);
      }
      return result;
    },

    async getSettings(): Promise<TournamentSettings> {
      const data = await storageService.loadTournament();
      return data.settings;
    },

    async updateSettings(patch: Partial<TournamentSettings>): Promise<TournamentSettings> {
      const data = await storageService.loadTournament();
      Object.assign(data.settings, patch);
      await storageService.saveTournament(data);
      return data.settings;
    },
  };

  const serialize =
    <Arguments extends unknown[], Result>(operation: (...args: Arguments) => Promise<Result>) =>
    (...args: Arguments): Promise<Result> =>
      profileSourceCoordinator.runExclusive(() => operation(...args));

  return {
    ...service,
    startSession: serialize(service.startSession.bind(service)),
    endSession: serialize(service.endSession.bind(service)),
    getNextPair: serialize(service.getNextPair.bind(service)),
    submitComparison: serialize(service.submitComparison.bind(service)),
    normalizeFitness: serialize(service.normalizeFitness.bind(service)),
    onGameDeleted: serialize(service.onGameDeleted.bind(service)),
    reconcileWithCollection: serialize(service.reconcileWithCollection.bind(service)),
    updateSettings: serialize(service.updateSettings.bind(service)),
  };
}
