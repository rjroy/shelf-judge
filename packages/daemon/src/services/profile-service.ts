import type {
  CollectionProfile,
  FitnessResult,
  ProfileData,
  TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import type { GameService } from "./game-service.js";
import type { TournamentService } from "./tournament-service.js";
import { computeProfile } from "./profile-engine.js";
import type { ProfileInput } from "./profile-engine.js";

export interface ProfileService {
  getProfile(): Promise<CollectionProfile>;
}

export interface ProfileServiceDeps {
  storageService: StorageService;
  gameService: GameService;
  tournamentService: TournamentService;
}

function getLatestTournamentTimestamp(
  sessions: { updatedAt?: string; createdAt?: string }[],
  comparisons: { createdAt: string }[],
): string | null {
  let latest: string | null = null;

  for (const session of sessions) {
    const ts = session.updatedAt ?? session.createdAt;
    if (ts && (!latest || ts > latest)) {
      latest = ts;
    }
  }

  for (const comparison of comparisons) {
    if (comparison.createdAt > (latest ?? "")) {
      latest = comparison.createdAt;
    }
  }

  return latest;
}

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  const { storageService, gameService, tournamentService } = deps;

  return {
    async getProfile(): Promise<CollectionProfile> {
      const [stored, collection, tournamentData] = await Promise.all([
        storageService.loadProfile(),
        storageService.loadCollection(),
        storageService.loadTournament(),
      ]);

      // Determine if stored profile is stale
      if (stored) {
        const computedAt = stored.computedAt;
        const collectionStale = collection.updatedAt > computedAt;

        const allComparisons = tournamentData.sessions.flatMap((s) => s.comparisons ?? []);
        const tournamentTimestamp = getLatestTournamentTimestamp(
          tournamentData.sessions,
          allComparisons,
        );
        const tournamentStale = tournamentTimestamp !== null && tournamentTimestamp > computedAt;

        if (!collectionStale && !tournamentStale) {
          return stored.profile;
        }
      }

      // Recompute profile
      const gamesWithScores = await gameService.listGames();
      const games = gamesWithScores.map((gws) => gws.game);
      const fitnessResults = new Map<string, FitnessResult>();
      for (const gws of gamesWithScores) {
        if (gws.score !== null) {
          fitnessResults.set(gws.game.id, gws.score);
        }
      }

      const allStatsRecord = await tournamentService.getAllGameStats();
      let tournamentStats: Map<string, TournamentGameStatsDisplay> | null = null;
      const statsEntries = Object.entries(allStatsRecord);
      if (statsEntries.length > 0) {
        tournamentStats = new Map(statsEntries);
      }

      const input: ProfileInput = {
        games,
        axes: collection.axes,
        fitnessResults,
        tournamentStats,
      };

      const now = new Date().toISOString();
      const profile: CollectionProfile = { ...computeProfile(input), computedAt: now };

      const profileData: ProfileData = {
        profile,
        computedAt: now,
      };

      await storageService.saveProfile(profileData);

      return profile;
    },
  };
}
