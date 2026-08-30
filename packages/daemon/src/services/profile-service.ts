import type {
  FitnessResult,
  CollectionProfile,
  CollectionProfileEntityPolicy,
  CollectionProfileResult,
  ProfileData,
} from "@shelf-judge/shared";
import {
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
  CollectionProfileResultSchema,
  createCollectionProfileSnapshotSchema,
} from "@shelf-judge/shared";
import { ZodError } from "zod";
import type { StorageService } from "./storage-service.js";
import type { DisplayedFitnessService } from "./displayed-fitness-service.js";
import { computeCollectionProfile } from "./collection-profile-engine.js";
import {
  profileSourceCoordinatorFor,
  profileSourceIdentity,
  sameProfileSourceIdentity,
  type ProfileSources,
} from "./profile-source-coordinator.js";

export interface ProfileService {
  getProfile(): Promise<CollectionProfileResult>;
}

export interface ProfileServiceDeps {
  storageService: StorageService;
  displayedFitnessService: DisplayedFitnessService;
  now?: () => string;
}

function unavailable(
  kind: "transport" | "validation" | "recomputation",
  error: unknown,
): CollectionProfileResult {
  return CollectionProfileResultSchema.parse({
    status: "unavailable",
    error: {
      kind,
      message: error instanceof Error ? error.message : "Profile computation failed",
    },
    retryDestination: { operationId: "shelf.profile.get" },
  });
}

function failureKind(error: unknown): "transport" | "validation" {
  return error instanceof ZodError || error instanceof SyntaxError ? "validation" : "transport";
}

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  const { storageService, displayedFitnessService } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const coordinator = profileSourceCoordinatorFor(storageService);

  return {
    getProfile(): Promise<CollectionProfileResult> {
      return coordinator.runExclusive(async () => {
        let sources: ProfileSources;
        let cache: ProfileData;
        let entityPolicy: CollectionProfileEntityPolicy;
        try {
          // Collection load may migrate storage and invalidate dependent artifacts.
          const collection = await storageService.loadCollection();
          const [config, tournament, predictionSettings, redundancySettings] = await Promise.all([
            storageService.loadConfig(),
            storageService.loadTournament(),
            storageService.loadPredictionSettings(),
            storageService.loadRedundancySettings(),
          ]);
          sources = structuredClone({
            collection,
            tournament,
            predictionSettings,
            redundancySettings,
          });
          entityPolicy = config.profileEntityPolicy;
        } catch (error) {
          return unavailable(failureKind(error), error);
        }

        const identity = profileSourceIdentity(sources);
        let stored: ProfileData | null;
        try {
          stored = await storageService.loadProfile();
        } catch (error) {
          return unavailable(failureKind(error), error);
        }
        if (stored && sameProfileSourceIdentity(stored.sourceIdentity, identity)) {
          const cachedSnapshot = createCollectionProfileSnapshotSchema(entityPolicy).safeParse({
            source: sources.collection,
            profile: stored.profile,
          });
          if (cachedSnapshot.success) return cachedSnapshot.data.profile;
          try {
            await storageService.discardProfile?.();
          } catch (error) {
            return unavailable(failureKind(error), error);
          }
        }

        try {
          if (!displayedFitnessService.listGamesFromSnapshot) {
            throw new Error("Snapshot-backed displayed fitness is not configured");
          }
          const games = await displayedFitnessService.listGamesFromSnapshot(sources, {
            includePredicted: true,
          });
          const fitnessResults = new Map<string, FitnessResult>();
          for (const entry of games) {
            if (entry.score !== null && entry.hasScoringContribution) {
              fitnessResults.set(entry.game.id, entry.score);
            }
          }

          const computedAt = now();
          const profile = computeCollectionProfile({
            collection: sources.collection,
            fitnessResults,
            computedAt,
            entityPolicy,
          });
          const validated = createCollectionProfileSnapshotSchema(entityPolicy).parse({
            source: sources.collection,
            profile,
          }).profile as CollectionProfile;
          const finalIdentity = profileSourceIdentity(sources);
          if (!sameProfileSourceIdentity(identity, finalIdentity)) {
            throw new Error("Profile source snapshot changed during computation");
          }
          cache = {
            contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
            algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
            sourceIdentity: identity,
            profile: validated,
            computedAt,
          };
        } catch (error) {
          return unavailable(error instanceof ZodError ? "validation" : "recomputation", error);
        }
        try {
          await storageService.saveProfile(cache);
          return cache.profile;
        } catch (error) {
          return unavailable(failureKind(error), error);
        }
      });
    },
  };
}
