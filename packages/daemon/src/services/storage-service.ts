import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
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
  AttentionCandidateArtifact,
} from "@shelf-judge/shared";
import {
  AcquisitionSchema,
  CollectionProfileEntityPolicySchema,
  CURRENT_COLLECTION_SCHEMA_VERSION,
  DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  GroundedProviderIdentitySchema,
  createProfileDataSchema,
  PredictionSettingsSchema,
  RedundancySettingsSchema,
  createFreshCollectionDerivedAxes,
  CollectionSchema,
  EntertainmentBenchmarkSchema,
  TournamentDataSchema,
  ShelfConfigurationSchema,
  AttentionCandidateArtifactSchema,
} from "@shelf-judge/shared";
import type { FileOps } from "./file-ops.js";
import { atomicWrite, type TemporaryPathForAttempt } from "./file-ops.js";
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
import { createLogger, type Logger } from "./logger.js";
import {
  decodeStoredSource,
  prepareMissingStoredSource,
  prepareStoredSourceUpdate,
  type DecodedStoredSource,
  type RevisionedSourceData,
  type RevisionedSourceKind,
} from "./stored-source-revision.js";
import {
  createSourceVectorService,
  type SourceVector,
  type SourceVectorRevisions,
} from "./source-vector.js";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";

export interface CollectionReader {
  loadCollection(): Promise<Collection>;
}

export interface CollectionPersistence {
  saveCollection(collection: Collection): Promise<void>;
}

export interface StorageService extends CollectionReader, CollectionPersistence {
  loadConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<void>;
  loadTournament(): Promise<TournamentData>;
  saveTournament(data: TournamentData): Promise<void>;
  loadProfile(): Promise<ProfileData | null>;
  discardProfile?(): Promise<void>;
  saveProfile(data: ProfileData): Promise<void>;
  loadAttentionCandidates?(): Promise<AttentionCandidateArtifact | null>;
  saveAttentionCandidates?(data: AttentionCandidateArtifact): Promise<void>;
  discardAttentionCandidates?(): Promise<void>;
  /** Process-local invalidation token for candidate source inputs. */
  attentionCandidateSourceGeneration?(): number;
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
  sourceVector?(): SourceVector;
  hydrateSourceVector?(): Promise<SourceVector>;
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
    revision: 0,
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
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
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
  if (
    !isRecord(raw) ||
    (raw.schemaVersion !== 3 &&
      raw.schemaVersion !== 4 &&
      raw.schemaVersion !== 5 &&
      // V7 was current when this recovery boundary was introduced. Keep that
      // established eligibility while it is migrated sequentially to V8.
      raw.schemaVersion !== 7 &&
      raw.schemaVersion !== CURRENT_COLLECTION_SCHEMA_VERSION)
  ) {
    return { data: raw, normalized: false };
  }

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

function defaultConfig(): AppConfig {
  return {
    bggAuthToken: null,
    groundedAnalysis: null,
    profileEntityPolicy: structuredClone(DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY),
    profileAttentionCardLimit: 6,
    username: null,
  };
}

function parseConfig(value: unknown): AppConfig {
  if (typeof value !== "object" || value === null) throw new Error("Config must be an object");
  const config = value as Record<string, unknown>;
  const profileAttentionCardLimit =
    config.profileAttentionCardLimit === undefined
      ? 6
      : z.number().int().min(0).max(24).parse(config.profileAttentionCardLimit);
  return {
    bggAuthToken:
      typeof config.bggAuthToken === "string" || config.bggAuthToken === null
        ? config.bggAuthToken
        : null,
    groundedAnalysis:
      config.groundedAnalysis === undefined
        ? null
        : GroundedProviderIdentitySchema.nullable().parse(config.groundedAnalysis),
    profileEntityPolicy: CollectionProfileEntityPolicySchema.parse(
      config.profileEntityPolicy ?? DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
    ),
    profileAttentionCardLimit,
    username:
      typeof config.username === "string" || config.username === null ? config.username : null,
  };
}

export function createStorageService(deps: StorageServiceDeps): StorageService {
  const { dataDir, configPath, fileOps } = deps;
  const logger = deps.logger ?? createLogger("storage");
  const artifacts = deps.collectionArtifacts ?? COLLECTION_ARTIFACTS;
  const collectionPath = path.join(dataDir, "collection.json");
  const tournamentPath = path.join(dataDir, "tournament.json");
  const profilePath = path.join(dataDir, "profile.json");
  const attentionCandidatesPath = path.join(dataDir, "attention-candidates.json");
  const sourcePaths: Record<RevisionedSourceKind, string> = {
    tournament: tournamentPath,
    "prediction-settings": path.join(dataDir, "prediction-settings.json"),
    "niche-settings": path.join(dataDir, "niche-settings.json"),
    "redundancy-settings": path.join(dataDir, "redundancy-settings.json"),
    "shelf-config": path.join(dataDir, "shelf-config.json"),
  };
  const sourceVector = createSourceVectorService();

  // Per-file in-flight load promise. Serializes concurrent first-time loads so
  // two callers don't both race to write `<file>.tmp` and one ends up renaming
  // a missing tmp. Once the file exists on disk, the read path is idempotent
  // and the lock has no observable effect.
  const inFlightLoads = new Map<string, Promise<unknown>>();
  const sourceOperations = new Map<string, Promise<void>>();
  const sourceCache = new Map<RevisionedSourceKind, DecodedStoredSource>();
  let profileOperations: Promise<void> = Promise.resolve();
  let attentionCandidateOperations: Promise<void> = Promise.resolve();
  let attentionCandidateSourceGeneration = 0;
  const advanceAttentionCandidateSourceGeneration = () => {
    attentionCandidateSourceGeneration += 1;
  };
  function withLoadLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const existing = inFlightLoads.get(filePath);
    if (existing) return existing as Promise<T>;
    const promise = fn().finally(() => {
      inFlightLoads.delete(filePath);
    });
    inFlightLoads.set(filePath, promise);
    return promise;
  }

  function withProfileLock<T>(fn: () => Promise<T>): Promise<T> {
    const operation = profileOperations.then(fn, fn);
    profileOperations = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  function withAttentionCandidateLock<T>(fn: () => Promise<T>): Promise<T> {
    const operation = attentionCandidateOperations.then(fn, fn);
    attentionCandidateOperations = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  function withSourceLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const previous = sourceOperations.get(filePath) ?? Promise.resolve();
    const operation = previous.then(fn, fn);
    sourceOperations.set(
      filePath,
      operation.then(
        () => undefined,
        () => undefined,
      ),
    );
    return operation;
  }

  function publishStoredSource(kind: RevisionedSourceKind, decoded: DecodedStoredSource): void {
    sourceCache.set(kind, decoded);
    sourceVector.publish(kind, decoded.revision);
  }

  async function readStoredSource(kind: RevisionedSourceKind): Promise<DecodedStoredSource> {
    const filePath = sourcePaths[kind];
    try {
      if (!(await fileOps.exists(filePath))) {
        const prepared = prepareMissingStoredSource(kind, new Date().toISOString());
        await fileOps.mkdir(dataDir);
        await writeAtomically(filePath, JSON.stringify(prepared.stored, null, 2));
        publishStoredSource(kind, prepared);
        advanceAttentionCandidateSourceGeneration();
        return prepared;
      }
      const decoded = decodeStoredSource(kind, JSON.parse(await fileOps.readFile(filePath)));
      if (decoded.migrated) {
        await writeAtomically(filePath, JSON.stringify(decoded.stored, null, 2));
        advanceAttentionCandidateSourceGeneration();
      }
      publishStoredSource(kind, decoded);
      return decoded;
    } catch (error) {
      sourceVector.markUnavailable(kind);
      throw error;
    }
  }

  async function loadStoredSource(kind: RevisionedSourceKind): Promise<DecodedStoredSource> {
    return withSourceLock(sourcePaths[kind], async () => {
      const cached = sourceCache.get(kind);
      const unavailable = sourceVector.read().unavailableSources.includes(kind);
      if (cached && !unavailable) return cached;
      if (unavailable) sourceCache.delete(kind);
      return readStoredSource(kind);
    });
  }

  async function saveStoredSource(
    kind: RevisionedSourceKind,
    data: RevisionedSourceData,
  ): Promise<boolean> {
    return withSourceLock(sourcePaths[kind], async () => {
      const unavailable = sourceVector.read().unavailableSources.includes(kind);
      const cached = unavailable ? undefined : sourceCache.get(kind);
      const current = cached ?? (await readStoredSource(kind));
      const updated = prepareStoredSourceUpdate(current, data);
      if (!updated.changed) return false;
      const decoded: DecodedStoredSource = {
        data: updated.data,
        stored: updated.stored,
        revision: updated.revision,
        migrated: false,
      };
      try {
        await fileOps.mkdir(dataDir);
        await writeAtomically(sourcePaths[kind], JSON.stringify(updated.stored, null, 2));
      } catch (error) {
        sourceCache.delete(kind);
        sourceVector.markUnavailable(kind);
        throw error;
      }
      // The atomic source write is authoritative. Publish before disposable invalidation.
      publishStoredSource(kind, decoded);
      advanceAttentionCandidateSourceGeneration();
      return true;
    });
  }

  async function writeAtomically(filePath: string, content: string): Promise<void> {
    await atomicWrite(filePath, content, fileOps, deps.temporaryPathForAttempt);
  }

  async function invalidateProfile(
    trigger: "prediction-settings" | "redundancy-settings",
  ): Promise<void> {
    if (!(await fileOps.exists(profilePath))) return;
    logger.log(`profile cache invalidation attempt path=${profilePath} trigger=${trigger}`);
    await fileOps.unlink(profilePath);
    logger.log(`profile cache invalidation completed path=${profilePath} trigger=${trigger}`);
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

  async function loadAppConfig(): Promise<AppConfig> {
    const exists = await fileOps.exists(configPath);
    if (!exists) {
      const config = defaultConfig();
      const configDir = path.dirname(configPath);
      await fileOps.mkdir(configDir);
      await writeAtomically(configPath, JSON.stringify(config, null, 2));
      return config;
    }

    const raw = await fileOps.readFile(configPath);
    const stored = JSON.parse(raw) as unknown;
    const config = parseConfig(stored);
    if (isRecord(stored) && Object.hasOwn(stored, "dataDir")) {
      logger.log(`config migration attempt path=${configPath} removedField=dataDir`);
      await writeAtomically(configPath, JSON.stringify(config, null, 2));
      logger.log(`config migration completed path=${configPath} removedField=dataDir`);
    }
    return config;
  }

  const storage: StorageService = {
    loadCollection(): Promise<Collection> {
      return withLoadLock(collectionPath, async () => {
        const exists = await fileOps.exists(collectionPath);
        if (!exists) {
          const collection = createDefaultCollection(deps.collectionMigrationDependencies);
          await persistCollection(collection);
          advanceAttentionCandidateSourceGeneration();
          sourceVector.publishCollection({
            id: collection.id,
            schemaVersion: collection.schemaVersion,
            revision: collection.revision,
          });
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
        const normalizedCurrent =
          decoded.normalized && migration.sourceVersion === CURRENT_COLLECTION_SCHEMA_VERSION;
        const candidate = normalizedCurrent
          ? {
              ...migration.data,
              revision: migration.data.revision + 1,
            }
          : migration.data;
        const validated = validateCollection(candidate);
        if (!migration.migrated && !decoded.normalized) {
          sourceVector.publishCollection({
            id: validated.id,
            schemaVersion: validated.schemaVersion,
            revision: validated.revision,
          });
          return validated;
        }

        if (migration.migrated || normalizedCurrent) {
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
        advanceAttentionCandidateSourceGeneration();
        sourceVector.publishCollection({
          id: validated.id,
          schemaVersion: validated.schemaVersion,
          revision: validated.revision,
        });
        return validated;
      }).catch((error: unknown) => {
        sourceVector.markUnavailable("collection");
        throw error;
      });
    },

    async saveCollection(collection: Collection): Promise<void> {
      try {
        await persistCollection(collection);
      } catch (error) {
        // Atomic replacement may have succeeded even if the operation reported a
        // later error. Do not reuse either assumed identity until a disk reload.
        sourceVector.markUnavailable("collection");
        throw error;
      }
      advanceAttentionCandidateSourceGeneration();
      sourceVector.publishCollection({
        id: collection.id,
        schemaVersion: collection.schemaVersion,
        revision: collection.revision,
      });
    },

    loadConfig: loadAppConfig,

    async saveConfig(config: AppConfig): Promise<void> {
      const validated = parseConfig(config);
      const configDir = path.dirname(configPath);
      await fileOps.mkdir(configDir);
      await writeAtomically(configPath, JSON.stringify(validated, null, 2));
    },

    loadTournament(): Promise<TournamentData> {
      return loadStoredSource("tournament").then((source) =>
        structuredClone(source.data as TournamentData),
      );
    },

    async saveTournament(data: TournamentData): Promise<void> {
      await saveStoredSource("tournament", TournamentDataSchema.parse(data));
    },

    loadProfile(): Promise<ProfileData | null> {
      return withProfileLock(async () => {
        const exists = await fileOps.exists(profilePath);
        if (!exists) return null;

        logger.log(`profile cache read attempt path=${profilePath}`);
        const raw = await fileOps.readFile(profilePath);
        logger.log(`profile cache read completed path=${profilePath} bytes=${raw.length}`);
        try {
          const config = await loadAppConfig();
          const profile = createProfileDataSchema(config.profileEntityPolicy).parse(
            JSON.parse(raw),
          );
          logger.log(
            `profile cache validation completed path=${profilePath} contractVersion=${profile.contractVersion} algorithmVersion=${profile.algorithmVersion}`,
          );
          return profile;
        } catch (error) {
          logger.warn(`profile cache invalid; discarding path=${profilePath}`, error);
          await fileOps.unlink(profilePath);
          logger.log(`profile cache discarded path=${profilePath}`);
          return null;
        }
      });
    },

    discardProfile(): Promise<void> {
      return withProfileLock(async () => {
        if (!(await fileOps.exists(profilePath))) return;
        logger.log(`profile cache discard attempt path=${profilePath}`);
        await fileOps.unlink(profilePath);
        logger.log(`profile cache discard completed path=${profilePath}`);
      });
    },

    loadAttentionCandidates(): Promise<AttentionCandidateArtifact | null> {
      return withAttentionCandidateLock(async () => {
        if (!(await fileOps.exists(attentionCandidatesPath))) return null;
        try {
          return AttentionCandidateArtifactSchema.parse(
            JSON.parse(await fileOps.readFile(attentionCandidatesPath)),
          );
        } catch (error) {
          logger.warn(
            `attention candidates invalid; discarding path=${attentionCandidatesPath}`,
            error,
          );
          await fileOps.unlink(attentionCandidatesPath);
          return null;
        }
      });
    },

    saveAttentionCandidates(data: AttentionCandidateArtifact): Promise<void> {
      return withAttentionCandidateLock(async () => {
        const validated = AttentionCandidateArtifactSchema.parse(data);
        await fileOps.mkdir(dataDir);
        await writeAtomically(attentionCandidatesPath, JSON.stringify(validated, null, 2));
      });
    },

    discardAttentionCandidates(): Promise<void> {
      return withAttentionCandidateLock(async () => {
        if (await fileOps.exists(attentionCandidatesPath))
          await fileOps.unlink(attentionCandidatesPath);
      });
    },

    attentionCandidateSourceGeneration(): number {
      return attentionCandidateSourceGeneration;
    },

    saveProfile(data: ProfileData): Promise<void> {
      return withProfileLock(async () => {
        const config = await loadAppConfig();
        const validated = createProfileDataSchema(config.profileEntityPolicy).parse(data);
        await fileOps.mkdir(dataDir);
        logger.log(
          `profile cache persistence attempt path=${profilePath} contractVersion=${validated.contractVersion} algorithmVersion=${validated.algorithmVersion}`,
        );
        await writeAtomically(profilePath, JSON.stringify(validated, null, 2));
        logger.log(`profile cache persistence completed path=${profilePath}`);
      });
    },

    async loadPredictionSettings(): Promise<PredictionSettings> {
      return structuredClone(
        (await loadStoredSource("prediction-settings")).data as PredictionSettings,
      );
    },

    async savePredictionSettings(settings: PredictionSettings): Promise<void> {
      const validated = PredictionSettingsSchema.parse(settings);
      await withProfileLock(async () => {
        const changed = await saveStoredSource("prediction-settings", validated);
        if (changed) await invalidateProfile("prediction-settings");
      });
    },

    async loadNicheSettings(): Promise<NicheSettings> {
      return structuredClone((await loadStoredSource("niche-settings")).data as NicheSettings);
    },

    async saveNicheSettings(settings: NicheSettings): Promise<void> {
      await saveStoredSource("niche-settings", settings);
    },

    async loadRedundancySettings(): Promise<RedundancySettings> {
      return structuredClone(
        (await loadStoredSource("redundancy-settings")).data as RedundancySettings,
      );
    },

    async saveRedundancySettings(settings: RedundancySettings): Promise<void> {
      const validated = RedundancySettingsSchema.parse(settings);
      await withProfileLock(async () => {
        const changed = await saveStoredSource("redundancy-settings", validated);
        if (changed) await invalidateProfile("redundancy-settings");
      });
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
      try {
        return structuredClone((await loadStoredSource("shelf-config")).data as ShelfConfiguration);
      } catch (error) {
        const isDomainSchemaFailure =
          error instanceof z.ZodError &&
          !error.issues.some((issue) => issue.path[0] === "revision");
        if (!isDomainSchemaFailure) throw error;
        return prepareMissingStoredSource("shelf-config", new Date().toISOString())
          .data as ShelfConfiguration;
      }
    },

    async saveShelfConfig(config: ShelfConfiguration): Promise<void> {
      await saveStoredSource("shelf-config", ShelfConfigurationSchema.parse(config));
    },

    sourceVector(): SourceVector {
      return sourceVector.read();
    },

    async hydrateSourceVector(): Promise<SourceVector> {
      try {
        const collection = await this.loadCollection();
        const [tournament, predictionSettings, nicheSettings, redundancySettings, shelfConfig] =
          await Promise.all([
            loadStoredSource("tournament"),
            loadStoredSource("prediction-settings"),
            loadStoredSource("niche-settings"),
            loadStoredSource("redundancy-settings"),
            loadStoredSource("shelf-config"),
          ]);
        const revisions: SourceVectorRevisions = {
          tournament: tournament.revision,
          predictionSettings: predictionSettings.revision,
          nicheSettings: nicheSettings.revision,
          redundancySettings: redundancySettings.revision,
          shelfConfig: shelfConfig.revision,
        };
        sourceVector.hydrate(
          {
            id: collection.id,
            schemaVersion: collection.schemaVersion,
            revision: collection.revision,
          },
          revisions,
        );
        return sourceVector.read();
      } catch (error) {
        sourceVector.markUnavailable("startup-hydration");
        throw error;
      }
    },
  };

  // Storage commits share the same serialization domain as coherent source captures.
  // The coordinator is re-entrant for service and route callers already holding it.
  const coordinator = profileSourceCoordinatorFor(storage);
  const coordinate = <Value>(operation: () => Promise<Value>): Promise<Value> =>
    coordinator.runExclusive(operation);
  const saveCollection = storage.saveCollection.bind(storage);
  const saveTournament = storage.saveTournament.bind(storage);
  const savePredictionSettings = storage.savePredictionSettings.bind(storage);
  const saveNicheSettings = storage.saveNicheSettings.bind(storage);
  const saveRedundancySettings = storage.saveRedundancySettings.bind(storage);
  const saveShelfConfig = storage.saveShelfConfig.bind(storage);
  const hydrateVector = storage.hydrateSourceVector?.bind(storage);
  const loadCollection = storage.loadCollection.bind(storage);
  const loadTournament = storage.loadTournament.bind(storage);
  const loadPredictionSettings = storage.loadPredictionSettings.bind(storage);
  const loadNicheSettings = storage.loadNicheSettings.bind(storage);
  const loadRedundancySettings = storage.loadRedundancySettings.bind(storage);
  const loadShelfConfig = storage.loadShelfConfig.bind(storage);
  storage.loadCollection = () => coordinate(loadCollection);
  storage.loadTournament = () => coordinate(loadTournament);
  storage.loadPredictionSettings = () => coordinate(loadPredictionSettings);
  storage.loadNicheSettings = () => coordinate(loadNicheSettings);
  storage.loadRedundancySettings = () => coordinate(loadRedundancySettings);
  storage.loadShelfConfig = () => coordinate(loadShelfConfig);
  storage.saveCollection = (collection) => coordinate(() => saveCollection(collection));
  storage.saveTournament = (data) => coordinate(() => saveTournament(data));
  storage.savePredictionSettings = (settings) => coordinate(() => savePredictionSettings(settings));
  storage.saveNicheSettings = (settings) => coordinate(() => saveNicheSettings(settings));
  storage.saveRedundancySettings = (settings) => coordinate(() => saveRedundancySettings(settings));
  storage.saveShelfConfig = (config) => coordinate(() => saveShelfConfig(config));
  if (hydrateVector) storage.hydrateSourceVector = () => coordinate(hydrateVector);
  return storage;
}
