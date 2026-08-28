import type {
  CollectionProfile,
  FitnessResult,
  NarrationCacheState,
  ProfileData,
  ProfileNarration,
  TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import {
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
} from "@shelf-judge/shared";
import type { ProfileFitnessSettings, StorageService } from "./storage-service.js";
import type { DisplayedFitnessService } from "./displayed-fitness-service.js";
import type { TournamentService } from "./tournament-service.js";
import type { NarrationService } from "./narration-service.js";
import { computeProfile } from "./profile-engine.js";
import type { ProfileInput } from "./profile-engine.js";
import { createLogger } from "./logger.js";

const logger = createLogger("profile-service");

export interface ProfileService {
  getProfile(): Promise<CollectionProfile>;
  generateNarration(): Promise<CollectionProfile>;
}

export interface ProfileServiceDeps {
  storageService: StorageService;
  displayedFitnessService: DisplayedFitnessService;
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

function sameFitnessSettings(left: ProfileFitnessSettings, right: ProfileFitnessSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadFitnessSettings(
  storageService: StorageService,
): Promise<ProfileFitnessSettings> {
  if (storageService.loadProfileFitnessSettings) {
    return storageService.loadProfileFitnessSettings();
  }
  const [prediction, redundancy] = await Promise.all([
    storageService.loadPredictionSettings(),
    storageService.loadRedundancySettings(),
  ]);
  return { prediction, redundancy, revision: null };
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
  const { storageService, displayedFitnessService, tournamentService, narrationService } = deps;

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
      // Collection loading may migrate it and invalidate every dependent profile artifact.
      const collection = await storageService.loadCollection();
      const [stored, tournamentData] = await Promise.all([
        storageService.loadProfile(),
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
        const tournamentSettingsStale =
          stored.tournamentSettings.kFactorThreshold !== tournamentData.settings.kFactorThreshold ||
          stored.tournamentSettings.normalizationHalfWidth !==
            tournamentData.settings.normalizationHalfWidth ||
          stored.tournamentSettings.provisionalThreshold !==
            tournamentData.settings.provisionalThreshold;

        if (!collectionStale && !tournamentStale && !tournamentSettingsStale) {
          return attachNarration(stored.profile, stored);
        }
      }

      // Recompute profile
      let gamesWithScores;
      let fitnessSettings: ProfileFitnessSettings;
      for (;;) {
        const before = await loadFitnessSettings(storageService);
        const candidateGames = await displayedFitnessService.listGames({ includePredicted: true });
        const after = await loadFitnessSettings(storageService);
        if (sameFitnessSettings(before, after)) {
          gamesWithScores = candidateGames;
          fitnessSettings = after;
          break;
        }
      }
      const games = gamesWithScores.map((gws) => gws.game);
      const fitnessResults = new Map<string, FitnessResult>();
      for (const gws of gamesWithScores) {
        if (gws.score !== null && gws.hasScoringContribution && !gws.hasPredictedContribution) {
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
        tournamentComparisonThreshold: tournamentData.settings.provisionalThreshold,
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
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
        algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        tournamentSettings: tournamentData.settings,
        profile,
        computedAt: now,
        narration: null,
        narrationComputedAt: null,
      };

      try {
        await storageService.saveProfile(profileData, undefined, fitnessSettings);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Fitness settings changed during profile computation"
        ) {
          return this.getProfile();
        }
        throw error;
      }

      return attachNarration(profile, profileData);
    },

    async generateNarration(): Promise<CollectionProfile> {
      if (!narrationService) {
        logger.error("narration requested but narrationService is not configured");
        throw new Error("Narration service not configured");
      }

      logger.log("generating narration — fetching current profile...");
      const profile = await this.getProfile();
      logger.log(
        `profile ready: ${profile.gameCount} games, ${profile.ratedGameCount} rated — invoking narration service`,
      );
      const narration = await narrationService.generateNarration(profile);
      logger.log("narration service returned successfully");
      const now = new Date().toISOString();

      const currentProfile = await this.getProfile();
      if (currentProfile.computedAt !== profile.computedAt) {
        logger.warn("profile changed during narration generation; discarding narration");
        throw new Error("Profile changed during narration generation");
      }

      // Load stored data so we can write narration back
      const stored = await storageService.loadProfile();
      if (!stored) {
        logger.error("no stored profile to attach narration to");
        throw new Error("No stored profile to attach narration to");
      }

      stored.narration = narration;
      stored.narrationComputedAt = now;
      await storageService.saveProfile(stored, profile.computedAt);
      logger.log("narration saved to profile store");

      return { ...profile, narration, narrationState: "fresh" };
    },
  };
}
