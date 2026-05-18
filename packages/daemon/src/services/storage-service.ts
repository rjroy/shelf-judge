import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type {
  Collection,
  AppConfig,
  TournamentData,
  ProfileData,
  PredictionSettings,
  NicheSettings,
  RedundancySettings,
  WishlistEntry,
  ShelfConfiguration,
} from "@shelf-judge/shared";
import { TournamentDataSchema, ShelfConfigurationSchema } from "@shelf-judge/shared";
import type { FileOps } from "./file-ops.js";
import { getTempPath } from "./file-ops.js";
import { migrateTournamentData } from "./tournament-migration.js";
import { ensureTournamentAxis } from "./collection-migration.js";
import { DEFAULT_PREDICTION_SETTINGS } from "./prediction-engine.js";
import { DEFAULT_NICHE_SETTINGS } from "./niche-engine.js";
import { DEFAULT_REDUNDANCY_SETTINGS } from "./redundancy-engine.js";

export interface StorageService {
  loadCollection(): Promise<Collection>;
  saveCollection(collection: Collection): Promise<void>;
  loadConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<void>;
  loadTournament(): Promise<TournamentData>;
  saveTournament(data: TournamentData): Promise<void>;
  loadProfile(): Promise<ProfileData | null>;
  saveProfile(data: ProfileData): Promise<void>;
  loadPredictionSettings(): Promise<PredictionSettings>;
  savePredictionSettings(settings: PredictionSettings): Promise<void>;
  loadNicheSettings(): Promise<NicheSettings>;
  saveNicheSettings(settings: NicheSettings): Promise<void>;
  loadRedundancySettings(): Promise<RedundancySettings>;
  saveRedundancySettings(settings: RedundancySettings): Promise<void>;
  loadWishlist(): Promise<WishlistEntry[]>;
  saveWishlist(entries: WishlistEntry[]): Promise<void>;
  loadShelfConfig(): Promise<ShelfConfiguration>;
  saveShelfConfig(config: ShelfConfiguration): Promise<void>;
}

export interface StorageServiceDeps {
  dataDir: string;
  configPath: string;
  fileOps: FileOps;
}

function createDefaultCollection(): Collection {
  const now = new Date().toISOString();
  // Build the base collection with the existing personal/BGG defaults, then route through
  // the same migration helper used on load so the tournament axis defaults stay in one
  // place. This guarantees fresh and migrated collections agree on the axis shape.
  const base: Collection = {
    id: uuidv4(),
    name: "My Collection",
    axes: [
      {
        id: uuidv4(),
        name: "Community Rating",
        description: "BGG community average rating",
        weight: 50,
        source: "bgg",
        bggField: "communityRating",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: uuidv4(),
        name: "Complexity",
        description: "BGG weight normalized to 1-10 scale",
        weight: 50,
        source: "bgg",
        bggField: "weight",
        createdAt: now,
        updatedAt: now,
      },
    ],
    games: [],
    createdAt: now,
    updatedAt: now,
  };
  return ensureTournamentAxis(base).data;
}

function createDefaultTournament(): TournamentData {
  return {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
    sessions: [],
    gameStats: {},
  };
}

function defaultConfig(dataDir: string): AppConfig {
  return {
    bggAuthToken: null,
    dataDir,
    username: null,
  };
}

async function atomicWrite(filePath: string, content: string, fileOps: FileOps): Promise<void> {
  const tmpPath = getTempPath(filePath);
  await fileOps.writeFile(tmpPath, content);
  await fileOps.rename(tmpPath, filePath);
}

export function createStorageService(deps: StorageServiceDeps): StorageService {
  const { dataDir, configPath, fileOps } = deps;
  const collectionPath = path.join(dataDir, "collection.json");
  const tournamentPath = path.join(dataDir, "tournament.json");
  const profilePath = path.join(dataDir, "profile.json");
  const wishlistPath = path.join(dataDir, "wishlist.json");

  // Per-file in-flight load promise. Serializes concurrent first-time loads so
  // two callers don't both race to write `<file>.tmp` and one ends up renaming
  // a missing tmp. Once the file exists on disk, the read path is idempotent
  // and the lock has no observable effect.
  const inFlightLoads = new Map<string, Promise<unknown>>();
  function withLoadLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const existing = inFlightLoads.get(filePath);
    if (existing) return existing as Promise<T>;
    const promise = fn().finally(() => {
      inFlightLoads.delete(filePath);
    });
    inFlightLoads.set(filePath, promise);
    return promise;
  }

  // Cache invalidation when the tournament axis is added on load (REQ-TAXIS-9).
  // Stale profile data and wishlist predictions were computed against an axis set
  // that did not include the new tournament axis; they would otherwise leak through
  // to clients. We delete the profile cache (regenerable from collection + tournament)
  // and clear only the prediction fields on wishlist entries (the user's URL/note
  // metadata is theirs to keep).
  async function invalidateCachesAfterAxisMigration(): Promise<void> {
    await fileOps.unlink(profilePath);

    const wishlistExists = await fileOps.exists(wishlistPath);
    if (!wishlistExists) return;

    const raw = await fileOps.readFile(wishlistPath);
    const entries = JSON.parse(raw) as WishlistEntry[];
    const cleared = entries.map((entry) => ({
      ...entry,
      predictedScore: null,
      predictionConfidence: null,
      predictedBreakdown: null,
      nicheImpact: null,
    }));
    await atomicWrite(wishlistPath, JSON.stringify(cleared, null, 2), fileOps);
  }

  return {
    loadCollection(): Promise<Collection> {
      return withLoadLock(collectionPath, async () => {
        const exists = await fileOps.exists(collectionPath);
        if (!exists) {
          const collection = createDefaultCollection();
          await fileOps.mkdir(dataDir);
          await atomicWrite(collectionPath, JSON.stringify(collection, null, 2), fileOps);
          return collection;
        }

        const raw = await fileOps.readFile(collectionPath);
        const collection = JSON.parse(raw) as Collection;

        // Backfill legacy data for games missing newer fields
        for (const game of collection.games) {
          if (!game.ownership) {
            game.ownership = "owned";
          }
          if (game.boxDimensions === undefined) {
            game.boxDimensions = null;
          }
        }

        // Tournament axis migration (REQ-TAXIS-4, REQ-TAXIS-9). Idempotent: a subsequent
        // load is a no-op once the axis is present.
        const { data: migrated, migrated: didMigrate } = ensureTournamentAxis(collection);
        if (didMigrate) {
          migrated.updatedAt = new Date().toISOString();
          await fileOps.mkdir(dataDir);
          await atomicWrite(collectionPath, JSON.stringify(migrated, null, 2), fileOps);
          await invalidateCachesAfterAxisMigration();
          return migrated;
        }

        return collection;
      });
    },

    async saveCollection(collection: Collection): Promise<void> {
      await fileOps.mkdir(dataDir);
      await atomicWrite(collectionPath, JSON.stringify(collection, null, 2), fileOps);
    },

    async loadConfig(): Promise<AppConfig> {
      const exists = await fileOps.exists(configPath);
      if (!exists) {
        const config = defaultConfig(dataDir);
        const configDir = path.dirname(configPath);
        await fileOps.mkdir(configDir);
        await atomicWrite(configPath, JSON.stringify(config, null, 2), fileOps);
        return config;
      }

      const raw = await fileOps.readFile(configPath);
      return JSON.parse(raw) as AppConfig;
    },

    async saveConfig(config: AppConfig): Promise<void> {
      const configDir = path.dirname(configPath);
      await fileOps.mkdir(configDir);
      await atomicWrite(configPath, JSON.stringify(config, null, 2), fileOps);
    },

    loadTournament(): Promise<TournamentData> {
      return withLoadLock(tournamentPath, async () => {
        const exists = await fileOps.exists(tournamentPath);
        if (!exists) {
          const tournament = createDefaultTournament();
          await fileOps.mkdir(dataDir);
          await atomicWrite(tournamentPath, JSON.stringify(tournament, null, 2), fileOps);
          return tournament;
        }

        const raw = await fileOps.readFile(tournamentPath);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const { data, migrated } = migrateTournamentData(parsed);
        const validated = TournamentDataSchema.parse(data);

        if (migrated) {
          await atomicWrite(tournamentPath, JSON.stringify(validated, null, 2), fileOps);
        }

        return validated;
      });
    },

    async saveTournament(data: TournamentData): Promise<void> {
      await fileOps.mkdir(dataDir);
      await atomicWrite(tournamentPath, JSON.stringify(data, null, 2), fileOps);
    },

    async loadProfile(): Promise<ProfileData | null> {
      const exists = await fileOps.exists(profilePath);
      if (!exists) return null;

      const raw = await fileOps.readFile(profilePath);
      return JSON.parse(raw) as ProfileData;
    },

    async saveProfile(data: ProfileData): Promise<void> {
      await fileOps.mkdir(dataDir);
      await atomicWrite(profilePath, JSON.stringify(data, null, 2), fileOps);
    },

    async loadPredictionSettings(): Promise<PredictionSettings> {
      const predictionSettingsPath = path.join(dataDir, "prediction-settings.json");
      const exists = await fileOps.exists(predictionSettingsPath);
      if (!exists) return { ...DEFAULT_PREDICTION_SETTINGS };

      const raw = await fileOps.readFile(predictionSettingsPath);
      return JSON.parse(raw) as PredictionSettings;
    },

    async savePredictionSettings(settings: PredictionSettings): Promise<void> {
      const predictionSettingsPath = path.join(dataDir, "prediction-settings.json");
      await fileOps.mkdir(dataDir);
      await atomicWrite(predictionSettingsPath, JSON.stringify(settings, null, 2), fileOps);
    },

    async loadNicheSettings(): Promise<NicheSettings> {
      const nicheSettingsPath = path.join(dataDir, "niche-settings.json");
      const exists = await fileOps.exists(nicheSettingsPath);
      if (!exists) return { ...DEFAULT_NICHE_SETTINGS };

      const raw = await fileOps.readFile(nicheSettingsPath);
      return JSON.parse(raw) as NicheSettings;
    },

    async saveNicheSettings(settings: NicheSettings): Promise<void> {
      const nicheSettingsPath = path.join(dataDir, "niche-settings.json");
      await fileOps.mkdir(dataDir);
      await atomicWrite(nicheSettingsPath, JSON.stringify(settings, null, 2), fileOps);
    },

    async loadRedundancySettings(): Promise<RedundancySettings> {
      const redundancySettingsPath = path.join(dataDir, "redundancy-settings.json");
      const exists = await fileOps.exists(redundancySettingsPath);
      if (!exists) return { ...DEFAULT_REDUNDANCY_SETTINGS };

      const raw = await fileOps.readFile(redundancySettingsPath);
      return JSON.parse(raw) as RedundancySettings;
    },

    async saveRedundancySettings(settings: RedundancySettings): Promise<void> {
      const redundancySettingsPath = path.join(dataDir, "redundancy-settings.json");
      await fileOps.mkdir(dataDir);
      await atomicWrite(redundancySettingsPath, JSON.stringify(settings, null, 2), fileOps);
    },

    async loadWishlist(): Promise<WishlistEntry[]> {
      const wishlistPath = path.join(dataDir, "wishlist.json");
      const exists = await fileOps.exists(wishlistPath);
      if (!exists) return [];

      const raw = await fileOps.readFile(wishlistPath);
      return JSON.parse(raw) as WishlistEntry[];
    },

    async saveWishlist(entries: WishlistEntry[]): Promise<void> {
      const wishlistPath = path.join(dataDir, "wishlist.json");
      await fileOps.mkdir(dataDir);
      await atomicWrite(wishlistPath, JSON.stringify(entries, null, 2), fileOps);
    },

    async loadShelfConfig(): Promise<ShelfConfiguration> {
      const shelfConfigPath = path.join(dataDir, "shelf-config.json");
      const exists = await fileOps.exists(shelfConfigPath);
      if (!exists) {
        const now = new Date().toISOString();
        return { units: [], createdAt: now, updatedAt: now };
      }

      const raw = await fileOps.readFile(shelfConfigPath);
      const parsed: unknown = JSON.parse(raw);
      const result = ShelfConfigurationSchema.safeParse(parsed);
      if (!result.success) {
        console.warn(`Invalid shelf-config.json: ${result.error.message}. Returning empty config.`);
        const now = new Date().toISOString();
        return { units: [], createdAt: now, updatedAt: now };
      }
      return result.data;
    },

    async saveShelfConfig(config: ShelfConfiguration): Promise<void> {
      const shelfConfigPath = path.join(dataDir, "shelf-config.json");
      await fileOps.mkdir(dataDir);
      await atomicWrite(shelfConfigPath, JSON.stringify(config, null, 2), fileOps);
    },
  };
}
