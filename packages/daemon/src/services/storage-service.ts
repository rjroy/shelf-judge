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
  InvalidEvidence,
  JsonValue,
} from "@shelf-judge/shared";
import {
  AcquisitionSchema,
  CURRENT_COLLECTION_SCHEMA_VERSION,
  createFreshCollectionDerivedAxes,
  CollectionSchema,
  EntertainmentBenchmarkSchema,
  TournamentDataSchema,
  ShelfConfigurationSchema,
} from "@shelf-judge/shared";
import type { FileOps } from "./file-ops.js";
import { atomicWrite, type TemporaryPathForAttempt } from "./file-ops.js";
import { migrateTournamentData } from "./tournament-migration.js";
import {
  migrateCollection,
  type CollectionMigrationDependencies,
  type CollectionMigrationResult,
} from "./collection-migration.js";
import {
  COLLECTION_ARTIFACTS,
  createCollectionArtifactContext,
  type CollectionArtifactDescriptor,
} from "./collection-artifacts.js";
import { DEFAULT_PREDICTION_SETTINGS } from "./prediction-engine.js";
import { DEFAULT_NICHE_SETTINGS } from "./niche-engine.js";
import { DEFAULT_REDUNDANCY_SETTINGS } from "./redundancy-engine.js";
import { createLogger, type Logger } from "./logger.js";

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
  logger?: Logger;
  collectionArtifacts?: readonly CollectionArtifactDescriptor[];
  collectionMigrationDependencies?: CollectionMigrationDependencies;
  quarantinePathForAttempt?: (activePath: string, attempt: number) => string;
  temporaryPathForAttempt?: TemporaryPathForAttempt;
}

function createDefaultCollection(dependencies?: CollectionMigrationDependencies): Collection {
  const now = dependencies?.now() ?? new Date().toISOString();
  const createId = dependencies === undefined ? uuidv4 : () => dependencies.createId();
  return CollectionSchema.parse({
    schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
    id: createId(),
    name: "My Collection",
    axes: [
      ...createFreshCollectionDerivedAxes(createId, now),
      {
        id: createId(),
        name: "Tournament",
        description:
          "Derived from head-to-head tournament comparisons. Each game's score is its normalized ELO display value.",
        weight: 30,
        enabled: true,
        source: "tournament",
        createdAt: now,
        updatedAt: now,
      },
    ],
    games: [],
    entertainmentBenchmark: null,
    createdAt: now,
    updatedAt: now,
  });
}

export interface StoredCollectionDecodeResult {
  data: unknown;
  normalized: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function storedInvalidEvidence(value: unknown, present: boolean): InvalidEvidence {
  if (!present) return { presence: "missing" };
  if (!isJsonValue(value)) throw new Error("Malformed stored value is not JSON-safe");
  return { presence: "present", value };
}

export function decodeStoredCollection(raw: unknown, logger: Logger): StoredCollectionDecodeResult {
  if (!isRecord(raw) || raw.schemaVersion !== 3) return { data: raw, normalized: false };

  let normalized = false;
  const collectionId = typeof raw.id === "string" ? raw.id : "unknown";
  const next: Record<string, unknown> = { ...raw };
  const benchmarkPresent = Object.hasOwn(raw, "entertainmentBenchmark");
  const benchmark = raw.entertainmentBenchmark;
  if (!EntertainmentBenchmarkSchema.safeParse(benchmark).success) {
    logger.log(
      `collection storage normalization attempt collectionId=${collectionId} field=entertainmentBenchmark`,
    );
    next.entertainmentBenchmark = {
      state: "invalid",
      evidence: storedInvalidEvidence(benchmark, benchmarkPresent),
    };
    normalized = true;
    logger.log(
      `collection storage normalization completed collectionId=${collectionId} field=entertainmentBenchmark`,
    );
  }

  if (isUnknownArray(raw.games)) {
    next.games = raw.games.map((entry): unknown => {
      if (!isRecord(entry)) return entry;
      const acquisitionPresent = Object.hasOwn(entry, "acquisition");
      const acquisition = entry.acquisition;
      if (AcquisitionSchema.safeParse(acquisition).success) return entry;
      const gameId = typeof entry.id === "string" ? entry.id : "unknown";
      logger.log(
        `collection storage normalization attempt collectionId=${collectionId} gameId=${gameId} field=acquisition`,
      );
      normalized = true;
      const decoded = {
        ...entry,
        acquisition: {
          state: "invalid",
          evidence: storedInvalidEvidence(acquisition, acquisitionPresent),
        },
      };
      logger.log(
        `collection storage normalization completed collectionId=${collectionId} gameId=${gameId} field=acquisition`,
      );
      return decoded;
    });
  }

  return { data: next, normalized };
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

export function createStorageService(deps: StorageServiceDeps): StorageService {
  const { dataDir, configPath, fileOps } = deps;
  const logger = deps.logger ?? createLogger("storage");
  const artifacts = deps.collectionArtifacts ?? COLLECTION_ARTIFACTS;
  const collectionPath = path.join(dataDir, "collection.json");
  const tournamentPath = path.join(dataDir, "tournament.json");
  const profilePath = path.join(dataDir, "profile.json");

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

  async function writeAtomically(filePath: string, content: string): Promise<void> {
    await atomicWrite(filePath, content, fileOps, deps.temporaryPathForAttempt);
  }

  function validateCollection(collection: unknown): Collection {
    logger.log(`collection validation attempt path=${collectionPath}`);
    try {
      const validated = CollectionSchema.parse(collection);
      logger.log(`collection validation completed path=${collectionPath}`);
      return validated;
    } catch (error) {
      logger.error(`collection validation failed path=${collectionPath}`, error);
      throw error;
    }
  }

  async function persistCollection(collection: Collection): Promise<void> {
    const validated = validateCollection(collection);
    await fileOps.mkdir(dataDir);
    logger.log(`collection persistence attempt path=${collectionPath}`);
    try {
      await writeAtomically(collectionPath, JSON.stringify(validated, null, 2));
      logger.log(`collection persistence completed path=${collectionPath}`);
    } catch (error) {
      logger.error(`collection persistence failed path=${collectionPath}`, error);
      throw error;
    }
  }

  return {
    loadCollection(): Promise<Collection> {
      return withLoadLock(collectionPath, async () => {
        const exists = await fileOps.exists(collectionPath);
        if (!exists) {
          const collection = createDefaultCollection(deps.collectionMigrationDependencies);
          await persistCollection(collection);
          return collection;
        }

        logger.log(`collection read attempt path=${collectionPath}`);
        let rawText: string;
        try {
          rawText = await fileOps.readFile(collectionPath);
          logger.log(`collection read completed path=${collectionPath} bytes=${rawText.length}`);
        } catch (error) {
          logger.error(`collection read failed path=${collectionPath}`, error);
          throw error;
        }

        logger.log(`collection parse attempt path=${collectionPath}`);
        let raw: unknown;
        try {
          raw = JSON.parse(rawText);
          logger.log(`collection parse completed path=${collectionPath}`);
        } catch (error) {
          logger.error(`collection parse failed path=${collectionPath}`, error);
          throw error;
        }
        const sourceVersion =
          typeof raw === "object" && raw !== null && "schemaVersion" in raw
            ? String(raw.schemaVersion)
            : "0";
        logger.log(
          `collection migration start sourceVersion=${sourceVersion} targetVersion=${CURRENT_COLLECTION_SCHEMA_VERSION}`,
        );
        let migration: CollectionMigrationResult;
        const decoded = decodeStoredCollection(raw, logger);
        try {
          migration = migrateCollection(decoded.data, deps.collectionMigrationDependencies);
        } catch (error) {
          logger.error(
            `collection migration failed sourceVersion=${sourceVersion} targetVersion=${CURRENT_COLLECTION_SCHEMA_VERSION}`,
            error,
          );
          throw error;
        }
        logger.log(
          `collection migration checked sourceVersion=${migration.sourceVersion} targetVersion=${CURRENT_COLLECTION_SCHEMA_VERSION} axes=${migration.data.axes.length} games=${migration.data.games.length} converted=${migration.convertedAxisCount} disabled=${migration.disabledAxisCount}`,
        );
        const validated = validateCollection(migration.data);
        if (!migration.migrated && !decoded.normalized) return validated;

        if (migration.migrated) {
          const artifactContext = createCollectionArtifactContext(
            dataDir,
            fileOps,
            logger,
            deps.quarantinePathForAttempt,
            deps.temporaryPathForAttempt,
          );
          for (const artifact of artifacts) {
            const artifactPath = artifact.path(dataDir);
            logger.log(
              `artifact invalidation attempt identity=${artifact.identity} dependencyVersion=${artifact.dependencyVersion} path=${artifactPath}`,
            );
            try {
              await artifact.invalidate(artifactContext);
              logger.log(
                `artifact invalidation completed identity=${artifact.identity} path=${artifactPath}`,
              );
            } catch (error) {
              logger.error(
                `artifact invalidation failed identity=${artifact.identity} path=${artifactPath}`,
                error,
              );
              throw error;
            }
          }
        }

        await persistCollection(validated);
        return validated;
      });
    },

    async saveCollection(collection: Collection): Promise<void> {
      await persistCollection(collection);
    },

    async loadConfig(): Promise<AppConfig> {
      const exists = await fileOps.exists(configPath);
      if (!exists) {
        const config = defaultConfig(dataDir);
        const configDir = path.dirname(configPath);
        await fileOps.mkdir(configDir);
        await writeAtomically(configPath, JSON.stringify(config, null, 2));
        return config;
      }

      const raw = await fileOps.readFile(configPath);
      return JSON.parse(raw) as AppConfig;
    },

    async saveConfig(config: AppConfig): Promise<void> {
      const configDir = path.dirname(configPath);
      await fileOps.mkdir(configDir);
      await writeAtomically(configPath, JSON.stringify(config, null, 2));
    },

    loadTournament(): Promise<TournamentData> {
      return withLoadLock(tournamentPath, async () => {
        const exists = await fileOps.exists(tournamentPath);
        if (!exists) {
          const tournament = createDefaultTournament();
          await fileOps.mkdir(dataDir);
          await writeAtomically(tournamentPath, JSON.stringify(tournament, null, 2));
          return tournament;
        }

        const raw = await fileOps.readFile(tournamentPath);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const { data, migrated } = migrateTournamentData(parsed);
        const validated = TournamentDataSchema.parse(data);

        if (migrated) {
          await writeAtomically(tournamentPath, JSON.stringify(validated, null, 2));
        }

        return validated;
      });
    },

    async saveTournament(data: TournamentData): Promise<void> {
      await fileOps.mkdir(dataDir);
      await writeAtomically(tournamentPath, JSON.stringify(data, null, 2));
    },

    async loadProfile(): Promise<ProfileData | null> {
      const exists = await fileOps.exists(profilePath);
      if (!exists) return null;

      const raw = await fileOps.readFile(profilePath);
      return JSON.parse(raw) as ProfileData;
    },

    async saveProfile(data: ProfileData): Promise<void> {
      await fileOps.mkdir(dataDir);
      await writeAtomically(profilePath, JSON.stringify(data, null, 2));
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
      await writeAtomically(predictionSettingsPath, JSON.stringify(settings, null, 2));
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
      await writeAtomically(nicheSettingsPath, JSON.stringify(settings, null, 2));
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
      await writeAtomically(redundancySettingsPath, JSON.stringify(settings, null, 2));
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
      await writeAtomically(wishlistPath, JSON.stringify(entries, null, 2));
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
      await writeAtomically(shelfConfigPath, JSON.stringify(config, null, 2));
    },
  };
}
