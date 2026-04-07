import { v4 as uuidv4 } from "uuid";
import type {
  TournamentData,
  TournamentSession,
  TournamentSettings,
  TournamentGameStatsDisplay,
  Comparison,
  SessionFilter,
  RecentComparison,
  GameWithScore,
} from "@shelf-judge/shared";
import { matchesBggTag } from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import {
  calculateNewRatings,
  normalizeElo,
  shouldDisplayRanking,
  recalculateAllRatings,
} from "./elo-engine.js";

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
  recalculate(): Promise<{ gamesUpdated: number }>;
  onGameDeleted(gameId: string): Promise<void>;
  getSettings(): Promise<TournamentSettings>;
  updateSettings(patch: Partial<TournamentSettings>): Promise<TournamentSettings>;
}

export interface TournamentServiceDeps {
  storageService: StorageService;
}

function applyFilters(
  games: GameWithScore[],
  filters: SessionFilter[],
  data: TournamentData,
): GameWithScore[] {
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
          ];
          return matchesBggTag(filter.value, tagNames);
        });
        break;
      }

      case "staleness": {
        const parsed = parseInt(filter.value, 10);
        const threshold = Number.isNaN(parsed) ? data.settings.provisionalThreshold : parsed;
        result = result.filter((g) => {
          const stats = data.gameStats[g.game.id];
          return !stats || stats.comparisonCount < threshold;
        });
        break;
      }
    }
  }

  return result;
}

function deriveDisplayStats(gameId: string, data: TournamentData): TournamentGameStatsDisplay {
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

  const isProvisional = comparisonCount < data.settings.provisionalThreshold;

  let displayLabel: string;
  if (comparisonCount === 0) {
    displayLabel = "not yet ranked";
  } else if (normalizedScore === null) {
    displayLabel = "not yet ranked";
  } else if (isProvisional) {
    displayLabel = `${normalizedScore.toFixed(1)} (provisional)`;
  } else {
    displayLabel = normalizedScore.toFixed(1);
  }

  // Derive wins/losses from comparisons
  let wins = 0;
  let losses = 0;
  const gameComparisons: {
    opponentGameId: string;
    opponentGameName: string | null;
    won: boolean;
    createdAt: string;
  }[] = [];

  for (const comp of data.comparisons) {
    if (comp.gameAId === gameId) {
      const won = comp.winnerId === gameId;
      if (won) wins++;
      else losses++;
      gameComparisons.push({
        opponentGameId: comp.gameBId,
        opponentGameName: null,
        won,
        createdAt: comp.createdAt,
      });
    } else if (comp.gameBId === gameId) {
      const won = comp.winnerId === gameId;
      if (won) wins++;
      else losses++;
      gameComparisons.push({
        opponentGameId: comp.gameAId,
        opponentGameName: null,
        won,
        createdAt: comp.createdAt,
      });
    }
  }

  // Last 5, most recent first
  gameComparisons.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const recentComparisons: RecentComparison[] = gameComparisons.slice(0, 5);

  return {
    eloRating,
    comparisonCount,
    normalizedScore,
    isProvisional,
    displayLabel,
    wins,
    losses,
    recentComparisons,
  };
}

export function createTournamentService(deps: TournamentServiceDeps): TournamentService {
  const { storageService } = deps;

  return {
    async startSession(
      filters: SessionFilter[] | null,
      games: GameWithScore[],
    ): Promise<TournamentSession> {
      const data = await storageService.loadTournament();

      // Auto-complete any active session (REQ-TOURN-15)
      const active = data.sessions.find((s) => s.status === "active");
      if (active) {
        active.status = "completed";
        active.updatedAt = new Date().toISOString();
      }

      // Apply filters
      const eligible = filters && filters.length > 0 ? applyFilters(games, filters, data) : games;

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
        session.updatedAt = new Date().toISOString();
        await storageService.saveTournament(data);
        return null;
      }

      // Start with the game with the fewest comparisons
      let selectedA: string | null = null;
      let selectedElo = 1500;
      let selectedCount = 0;
      for (let i = 0, lowestCount = Infinity; i < availableGameIds.length; i++) {
        const gameId = availableGameIds[i];
        const stats = data.gameStats[gameId];
        const count = stats?.comparisonCount ?? 0;
        if (count < lowestCount) {
          selectedA = gameId;
          lowestCount = count;
          selectedElo = stats?.eloRating ?? 1500;
          selectedCount = count;
        } if (count === lowestCount) {
          // Tiebreaker: choose the one with ELO closest to 1500
          const elo = stats?.eloRating ?? 1500;
          if (Math.abs(elo - 1500) < Math.abs(selectedElo - 1500)) {
            selectedA = gameId;
            selectedElo = elo;
            selectedCount = count;
          }
        }
      }

      if (!selectedA) {
        // This shouldn't happen since we check length above, but just in case...
        session.status = "completed";
        session.updatedAt = new Date().toISOString();
        await storageService.saveTournament(data);
        return null;
      }

      // Sort the remaining games by comparison count (fewest first), then ELO proximity to selectedA
      // But allow games with almost the same count (within 1) to be mixed together to add some variety
      // After kFactorThreshold comparisons, the count difference is no longer considered to allow more mixing
      availableGameIds.sort((a:string, b:string) => {
        const countA = Math.min(data.settings.kFactorThreshold, Math.max(0, Math.abs(data.gameStats[a]?.comparisonCount ?? 0 - selectedCount) - 1));
        const countB = Math.min(data.settings.kFactorThreshold, Math.max(0, Math.abs(data.gameStats[b]?.comparisonCount ?? 0 - selectedCount) - 1));
        if (countA !== countB) {
          return countA - countB; // games with fewer comparisons first
        }
        const eloADiff = Math.abs(selectedElo - (data.gameStats[a]?.eloRating ?? 1500));
        const eloBDiff = Math.abs(selectedElo - (data.gameStats[b]?.eloRating ?? 1500));
        return eloBDiff - eloADiff;
      });

      // Get pairs already seen in this session.
      const seenPairs = new Set<string>();
      for (const comp of data.comparisons) {
        if (comp.sessionId !== sessionId) {
          continue;
        }
        const key = [comp.gameAId, comp.gameBId].sort().join("|");
        seenPairs.add(key);
      }

      // Find the first pair that hasn't been seen before
      for (let j = 0; j < availableGameIds.length; j++) {
        const b = availableGameIds[j];
        if (b === selectedA) continue;

        const key = [selectedA, b].sort().join("|");
        if (seenPairs.has(key)) continue;

        return { gameA: selectedA, gameB: b };
      }

      // All pairs exhausted this session
      session.status = "completed";
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

      data.comparisons.push(comparison);
      session.comparisonCount++;
      session.updatedAt = now;

      // Incremental ELO update
      if (!data.gameStats[gameAId]) {
        data.gameStats[gameAId] = { eloRating: 1500, comparisonCount: 0 };
      }
      if (!data.gameStats[gameBId]) {
        data.gameStats[gameBId] = { eloRating: 1500, comparisonCount: 0 };
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

    async recalculate(): Promise<{ gamesUpdated: number }> {
      const data = await storageService.loadTournament();
      data.gameStats = recalculateAllRatings(data.comparisons, data.settings.kFactorThreshold);
      await storageService.saveTournament(data);
      return { gamesUpdated: Object.keys(data.gameStats).length };
    },

    async onGameDeleted(gameId: string): Promise<void> {
      const data = await storageService.loadTournament();

      // Remove cached ELO (REQ-TOURN-8: comparisons retained)
      delete data.gameStats[gameId];

      // Check active session (REQ-TOURN-15a)
      const active = data.sessions.find((s) => s.status === "active");
      if (active) {
        const idx = active.gameIds.indexOf(gameId);
        if (idx !== -1) {
          active.gameIds.splice(idx, 1);
          active.updatedAt = new Date().toISOString();
          // Auto-complete if fewer than 4 games remain
          if (active.gameIds.length < 4) {
            active.status = "completed";
          }
        }
      }

      await storageService.saveTournament(data);
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
}
