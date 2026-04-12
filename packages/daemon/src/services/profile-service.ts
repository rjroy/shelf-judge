import type {
  CollectionProfile,
  FitnessResult,
  NarrationCacheState,
  ProfileData,
  ProfileNarration,
  TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import type { StorageService } from "./storage-service.js";
import type { GameService } from "./game-service.js";
import type { TournamentService } from "./tournament-service.js";
import type { NarrationService } from "./narration-service.js";
import { computeProfile } from "./profile-engine.js";
import type { ProfileInput } from "./profile-engine.js";

export interface ProfileService {
  getProfile(): Promise<CollectionProfile>;
  generateNarration(): Promise<CollectionProfile>;
}

export interface ProfileServiceDeps {
  storageService: StorageService;
  gameService: GameService;
  tournamentService: TournamentService;
  narrationService?: NarrationService;
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

export function deriveNarrationState(
  narration: ProfileNarration | null | undefined,
  narrationComputedAt: string | null | undefined,
  profileComputedAt: string,
): NarrationCacheState {
  if (!narration) return "empty";
  if (narrationComputedAt && narrationComputedAt >= profileComputedAt) return "fresh";
  return "stale";
}

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  const { storageService, gameService, tournamentService, narrationService } = deps;

  function attachNarration(
    profile: CollectionProfile,
    stored: ProfileData | null,
  ): CollectionProfile {
    const narration = stored?.narration ?? null;
    const narrationState = deriveNarrationState(
      narration,
      stored?.narrationComputedAt,
      profile.computedAt,
    );
    return { ...profile, narration, narrationState };
  }

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
          return attachNarration(stored.profile, stored);
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
      const computedProfile = computeProfile(input);
      // computeProfile doesn't set narration fields; add them as empty
      const profile: CollectionProfile = {
        ...computedProfile,
        narration: null,
        narrationState: "empty",
        computedAt: now,
      };

      const profileData: ProfileData = {
        profile,
        computedAt: now,
        narration: stored?.narration ?? null,
        narrationComputedAt: stored?.narrationComputedAt ?? null,
      };

      await storageService.saveProfile(profileData);

      return attachNarration(profile, profileData);
    },

    async generateNarration(): Promise<CollectionProfile> {
      if (!narrationService) {
        throw new Error("Narration service not configured");
      }

      // Get the current profile (recomputes if stale)
      const profile = await this.getProfile();
      const narration = await narrationService.generateNarration(profile);
      const now = new Date().toISOString();

      // Load stored data so we can write narration back
      const stored = await storageService.loadProfile();
      if (!stored) {
        throw new Error("No stored profile to attach narration to");
      }

      stored.narration = narration;
      stored.narrationComputedAt = now;
      await storageService.saveProfile(stored);

      return { ...profile, narration, narrationState: "fresh" };
    },
  };
}
