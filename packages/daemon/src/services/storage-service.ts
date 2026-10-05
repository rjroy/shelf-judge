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
  WishlistBggSourceSnapshotSchema,
  createInitialSemanticRedundancyStateV10,
} from "@shelf-judge/shared";
import type { FileMetadata, FileOps } from "./file-ops.js";
import { atomicWrite, type TemporaryPathForAttempt } from "./file-ops.js";
import {
  migrateCollection,
  type CollectionMigrationDependencies,
  type CollectionMigrationResult,
} from "./collection-migration.js";
import {
  COLLECTION_ARTIFACTS,
  collectionArtifactsForMigration,
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
  type CollectionSourceIdentity,
  type SourceVector,
  type SourceVectorRevisions,
} from "./source-vector.js";
import {
  advanceWishlistMutationGeneration,
  canonicalSha256,
  profileSourceCoordinatorFor,
} from "./profile-source-coordinator.js";

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
  loadRedundancySettingsRead?(): Promise<{
    settings: RedundancySettings;
    migrationNotice: string | null;
  }>;
  saveRedundancySettings(settings: RedundancySettings): Promise<void>;
  loadWishlist(): Promise<WishlistEntry[]>;
  saveWishlist(entries: WishlistEntry[]): Promise<void>;
  loadShelfConfig(): Promise<ShelfConfiguration>;
  saveShelfConfig(config: ShelfConfiguration): Promise<void>;
  sourceVector?(): SourceVector;
  hydrateSourceVector?(): Promise<SourceVector>;
  /** Fresh, metadata-coherent view for JEV source capture; returned data is caller-owned. */
  loadJevSourceSnapshot?(): Promise<JevSourceSnapshot>;
}

export interface JevSourceSnapshot {
  collection: Collection;
  tournament: TournamentData;
  predictionSettings: PredictionSettings;
  redundancySettings: RedundancySettings;
  /** Changes when any source file's filesystem identity or mutation metadata changes. */
  freshnessEpoch: string;
  /** Process-local generation for changes observed to originate outside storage writes. */
  externalEpoch: string;
}

export class DurableSourcePostCommitError extends Error {
  readonly durable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DurableSourcePostCommitError";
  }
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
    semanticRedundancy: createInitialSemanticRedundancyStateV10(),
    createdAt: now,
    updatedAt: now,
  });
}

function sourceIdentityForCollection(collection: Collection): CollectionSourceIdentity {
  const semantic = collection.semanticRedundancy;
  return {
    id: collection.id,
    schemaVersion: collection.schemaVersion,
    revision: collection.revision,
    semanticEvidenceEpoch: semantic.evidenceEpoch,
    semanticConsentEpoch: semantic.consentEpoch,
    factualWeightsEpoch: semantic.factualWeightsEpoch,
    factualWeightsFingerprint: semantic.factualWeightsFingerprint,
  };
}

export interface StoredCollectionDecodeResult {
  data: unknown;
  normalized: boolean;
  normalizedFields: string[];
  normalizedAcquisitionCount: number;
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

function safeErrorContext(error: unknown): Record<string, string | number | string[]> {
  const context: Record<string, string | number | string[]> = {
    errorType: error instanceof Error ? error.name : "UnknownError",
  };
  if (error instanceof z.ZodError) {
    context.issueCount = error.issues.length;
    context.issuePaths = error.issues
      .slice(0, 3)
      .map((issue) =>
        issue.path
          .map((part) =>
            typeof part === "number"
              ? "[index]"
              : typeof part === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(part)
                ? part
                : "*",
          )
          .join("."),
      );
  }
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  if (code !== undefined && /^[A-Z0-9_]+$/.test(code)) context.errorCode = code;
  return context;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function fileMetadataIdentity(metadata: FileMetadata): string {
  if (
    !metadata.isFile ||
    typeof metadata.dev !== "bigint" ||
    typeof metadata.ino !== "bigint" ||
    typeof metadata.size !== "bigint" ||
    typeof metadata.mtimeNs !== "bigint" ||
    typeof metadata.ctimeNs !== "bigint" ||
    metadata.dev < 0n ||
    metadata.ino < 0n ||
    metadata.size < 0n
  )
    throw new Error("JEV source file metadata is unusable");
  return [metadata.dev, metadata.ino, metadata.size, metadata.mtimeNs, metadata.ctimeNs].join(":");
}

function storedInvalidEvidence(value: unknown, present: boolean): InvalidEvidence {
  if (!present) return { presence: "missing" };
  if (!isJsonValue(value)) throw new Error("Malformed stored value is not JSON-safe");
  return { presence: "present", value };
}

export function decodeStoredCollection(raw: unknown): StoredCollectionDecodeResult {
  if (
    !isRecord(raw) ||
    (raw.schemaVersion !== 3 &&
      raw.schemaVersion !== 4 &&
      raw.schemaVersion !== 5 &&
      // V7 was current when this recovery boundary was introduced. Keep that
      // established eligibility while it is migrated sequentially to V10.
      raw.schemaVersion !== 7 &&
      raw.schemaVersion !== 9 &&
      raw.schemaVersion !== CURRENT_COLLECTION_SCHEMA_VERSION)
  ) {
    return { data: raw, normalized: false, normalizedFields: [], normalizedAcquisitionCount: 0 };
  }

  let normalized = false;
  const normalizedFields = new Set<string>();
  let normalizedAcquisitionCount = 0;
  const next: Record<string, unknown> = { ...raw };
  const benchmarkPresent = Object.hasOwn(raw, "entertainmentBenchmark");
  const benchmark = raw.entertainmentBenchmark;
  if (!EntertainmentBenchmarkSchema.safeParse(benchmark).success) {
    next.entertainmentBenchmark = {
      state: "invalid",
      evidence: storedInvalidEvidence(benchmark, benchmarkPresent),
    };
    normalized = true;
    normalizedFields.add("entertainmentBenchmark");
  }

  if (isUnknownArray(raw.games)) {
    next.games = raw.games.map((entry): unknown => {
      if (!isRecord(entry)) return entry;
      const acquisitionPresent = Object.hasOwn(entry, "acquisition");
      const acquisition = entry.acquisition;
      if (AcquisitionSchema.safeParse(acquisition).success) return entry;
      normalized = true;
      normalizedAcquisitionCount += 1;
      const decoded = {
        ...entry,
        acquisition: {
          state: "invalid",
          evidence: storedInvalidEvidence(acquisition, acquisitionPresent),
        },
      };
      return decoded;
    });
  }

  if (normalizedAcquisitionCount > 0) normalizedFields.add("acquisition");

  return {
    data: next,
    normalized,
    normalizedFields: [...normalizedFields],
    normalizedAcquisitionCount,
  };
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
  const jevSourcePaths = [
    collectionPath,
    tournamentPath,
    sourcePaths["prediction-settings"],
    sourcePaths["redundancy-settings"],
  ] as const;
  const establishedJevPaths = new Set<string>();
  const unavailableJevPaths = new Set<string>();
  const internalJevSignatures = new Map<string, string>();
  let lastObservedJevSignatures: readonly (string | null)[] | undefined;
  let externalJevEpoch = 0n;
  let jevSnapshotCache: { signatures: readonly string[]; snapshot: JevSourceSnapshot } | undefined;
  let collectionMustExistForJevSnapshot = false;

  // Per-file in-flight load promise. Serializes concurrent first-time loads so
  // two callers don't both race to write `<file>.tmp` and one ends up renaming
  // a missing tmp. Once the file exists on disk, the read path is idempotent
  // and the lock has no observable effect.
  const inFlightLoads = new Map<string, Promise<unknown>>();
  const sourceOperations = new Map<string, Promise<void>>();
  const sourceCache = new Map<RevisionedSourceKind, DecodedStoredSource>();
  let profileOperations: Promise<void> = Promise.resolve();
  let attentionCandidateOperations: Promise<void> = Promise.resolve();
  let jevSnapshotOperations: Promise<void> = Promise.resolve();
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

  function withJevSnapshotLock<T>(fn: () => Promise<T>): Promise<T> {
    const operation = jevSnapshotOperations.then(fn, fn);
    jevSnapshotOperations = operation.then(
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
    if (kind === "redundancy-settings") {
      sourceVector.publishRedundancyWeightsFingerprint(
        canonicalSha256((decoded.data as RedundancySettings).componentWeights),
      );
    }
  }

  async function observeJevSourceFiles(): Promise<(string | null)[]> {
    if (!fileOps.stat) throw new Error("JEV source freshness metadata is unavailable");
    return Promise.all(
      jevSourcePaths.map(async (filePath) => {
        let metadata: FileMetadata;
        try {
          metadata = await fileOps.stat!(filePath);
        } catch (error) {
          if (hasErrorCode(error, "ENOENT")) {
            invalidateJevPath(filePath);
            return null;
          }
          invalidateJevPath(filePath);
          throw error;
        }
        try {
          return fileMetadataIdentity(metadata);
        } catch (error) {
          invalidateJevPath(filePath);
          throw error;
        }
      }),
    );
  }

  async function initializeMissingJevSource(filePath: string): Promise<void> {
    if (filePath === collectionPath) {
      await storage.loadCollection();
      return;
    }
    const kind = (Object.entries(sourcePaths) as [RevisionedSourceKind, string][]).find(
      ([, candidatePath]) => candidatePath === filePath,
    )?.[0];
    if (!kind) throw new Error("Unknown JEV source file");
    await loadStoredSource(kind);
  }

  async function readJevSourceFiles(): Promise<JevSourceSnapshot> {
    collectionMustExistForJevSnapshot = true;
    let collection: Collection;
    try {
      collection = await storage.loadCollection();
    } finally {
      collectionMustExistForJevSnapshot = false;
    }
    const [tournament, predictionSettings, redundancySettings] = await Promise.all([
      withSourceLock(tournamentPath, () => readStoredSource("tournament", false)),
      withSourceLock(sourcePaths["prediction-settings"], () =>
        readStoredSource("prediction-settings", false),
      ),
      withSourceLock(sourcePaths["redundancy-settings"], () =>
        readStoredSource("redundancy-settings", false),
      ),
    ]);
    return {
      collection,
      tournament: structuredClone(tournament.data as TournamentData),
      predictionSettings: structuredClone(predictionSettings.data as PredictionSettings),
      redundancySettings: structuredClone(redundancySettings.data as RedundancySettings),
      freshnessEpoch: "",
      externalEpoch: "",
    };
  }

  function sameFileSignatures(left: readonly (string | null)[], right: readonly (string | null)[]) {
    return (
      left.length === right.length && left.every((signature, index) => signature === right[index])
    );
  }

  function publishJevExternalEpoch(signatures: readonly (string | null)[]): void {
    if (lastObservedJevSignatures) {
      signatures.forEach((signature, index) => {
        const filePath = jevSourcePaths[index];
        if (!filePath || signature === lastObservedJevSignatures?.[index]) return;
        if (signature === internalJevSignatures.get(filePath)) return;
        externalJevEpoch++;
        internalJevSignatures.delete(filePath);
      });
    }
    lastObservedJevSignatures = [...signatures];
  }

  function invalidateJevPath(filePath: string, markSourceUnavailable = true): void {
    if (!jevSourcePaths.includes(filePath)) return;
    jevSnapshotCache = undefined;
    internalJevSignatures.delete(filePath);
    unavailableJevPaths.add(filePath);
    if (!markSourceUnavailable) return;
    if (filePath === collectionPath) sourceVector.markUnavailable("collection");
    else {
      const kind = (Object.entries(sourcePaths) as [RevisionedSourceKind, string][]).find(
        ([, candidate]) => candidate === filePath,
      )?.[0];
      if (kind === "tournament" || kind === "prediction-settings" || kind === "redundancy-settings")
        sourceVector.markUnavailable(kind);
    }
  }

  async function captureJevSourceSnapshot(): Promise<JevSourceSnapshot> {
    return withJevSnapshotLock(async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const before = await observeJevSourceFiles();
          // Attribute the observed transition before a load/migration can rewrite
          // the file and make an external change look like an internal commit.
          publishJevExternalEpoch(before);
          const missing = before
            .map((signature, index) => (signature === null ? jevSourcePaths[index] : undefined))
            .filter((filePath): filePath is string => filePath !== undefined);
          if (missing.length > 0) {
            if (jevSnapshotCache || missing.some((filePath) => establishedJevPaths.has(filePath))) {
              jevSnapshotCache = undefined;
              throw new Error("An established JEV source file is missing");
            }
            for (const filePath of missing) await initializeMissingJevSource(filePath);
            continue;
          }

          if (jevSnapshotCache && sameFileSignatures(jevSnapshotCache.signatures, before))
            if (jevSourcePaths.every((filePath) => !unavailableJevPaths.has(filePath)))
              return structuredClone(jevSnapshotCache.snapshot);
          // Invalidate before reading: stale data must never be paired with a newer stat epoch.
          jevSnapshotCache = undefined;
          const snapshot = await readJevSourceFiles();
          const after = await observeJevSourceFiles();
          if (sameFileSignatures(before, after) && after.every((signature) => signature !== null)) {
            const stableSignatures = after;
            publishJevExternalEpoch(stableSignatures);
            unavailableJevPaths.clear();
            snapshot.freshnessEpoch = canonicalSha256(stableSignatures);
            snapshot.externalEpoch = externalJevEpoch.toString();
            jevSnapshotCache = { signatures: after, snapshot };
            return structuredClone(snapshot);
          }
        }
        throw new Error("JEV source files changed repeatedly during snapshot capture");
      } catch (error) {
        jevSnapshotCache = undefined;
        throw error;
      }
    });
  }

  async function readStoredSource(
    kind: RevisionedSourceKind,
    allowCreate = true,
  ): Promise<DecodedStoredSource> {
    const filePath = sourcePaths[kind];
    try {
      if (!(await fileOps.exists(filePath))) {
        if (!allowCreate) throw new Error("A required JEV source file disappeared");
        const prepared = prepareMissingStoredSource(kind, new Date().toISOString());
        await fileOps.mkdir(dataDir);
        await writeAtomically(filePath, JSON.stringify(prepared.stored, null, 2));
        establishedJevPaths.add(filePath);
        jevSnapshotCache = undefined;
        publishStoredSource(kind, prepared);
        advanceAttentionCandidateSourceGeneration();
        return prepared;
      }
      establishedJevPaths.add(filePath);
      const decoded = decodeStoredSource(kind, JSON.parse(await fileOps.readFile(filePath)));
      if (decoded.migrated) {
        await writeAtomically(filePath, JSON.stringify(decoded.stored, null, 2));
        jevSnapshotCache = undefined;
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
        establishedJevPaths.add(sourcePaths[kind]);
        jevSnapshotCache = undefined;
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
    const relevant = jevSourcePaths.includes(filePath);
    // A write invalidates snapshot freshness, but is not itself a failed source
    // operation. Keep vector availability unchanged until the write outcome is
    // known; callers mark the source unavailable if the operation fails.
    if (relevant) invalidateJevPath(filePath, false);
    try {
      let expectedFileIdentity: string | undefined;
      await atomicWrite(
        filePath,
        content,
        fileOps,
        deps.temporaryPathForAttempt,
        relevant && fileOps.stat
          ? async (temporaryPath) => {
              const metadata = await fileOps.stat!(temporaryPath);
              fileMetadataIdentity(metadata);
              expectedFileIdentity = `${metadata.dev}:${metadata.ino}`;
            }
          : undefined,
      );
      if (!relevant) return;
      establishedJevPaths.add(filePath);
      // Only bless a signature after confirming both the exact bytes and a
      // stable identity around that read. Rename completion alone is not proof
      // that the path still names our committed file.
      // Metadata is required only for snapshot reads. Legacy/custom FileOps
      // implementations can still perform ordinary atomic writes, but cannot
      // establish internal provenance or permit a cached JEV snapshot.
      if (!fileOps.stat) return;
      const beforeMetadata = await fileOps.stat(filePath);
      const before = fileMetadataIdentity(beforeMetadata);
      const beforeFileIdentity = `${beforeMetadata.dev}:${beforeMetadata.ino}`;
      if ((await fileOps.readFile(filePath)) !== content)
        throw new Error("JEV source changed after atomic write");
      const afterMetadata = await fileOps.stat(filePath);
      const after = fileMetadataIdentity(afterMetadata);
      const afterFileIdentity = `${afterMetadata.dev}:${afterMetadata.ino}`;
      if (
        before !== after ||
        expectedFileIdentity === undefined ||
        beforeFileIdentity !== expectedFileIdentity ||
        afterFileIdentity !== expectedFileIdentity
      )
        throw new Error("JEV source changed after atomic write");
      internalJevSignatures.set(filePath, after);
      unavailableJevPaths.delete(filePath);
    } catch (error) {
      if (relevant) invalidateJevPath(filePath);
      throw error;
    }
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
    try {
      return CollectionSchema.parse(collection);
    } catch (error) {
      logger.error(`collection validation failed path=${collectionPath}`, safeErrorContext(error));
      throw error;
    }
  }

  async function persistCollection(collection: Collection): Promise<void> {
    const validated = validateCollection(collection);
    await fileOps.mkdir(dataDir);
    logger.log(`collection persistence attempt path=${collectionPath}`);
    try {
      await writeAtomically(collectionPath, JSON.stringify(validated, null, 2));
      establishedJevPaths.add(collectionPath);
      jevSnapshotCache = undefined;
      logger.log(`collection persistence completed path=${collectionPath}`);
    } catch (error) {
      logger.error(`collection persistence failed path=${collectionPath}`, safeErrorContext(error));
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
          if (collectionMustExistForJevSnapshot)
            throw new Error("An established JEV collection file disappeared");
          const collection = createDefaultCollection(deps.collectionMigrationDependencies);
          await persistCollection(collection);
          advanceAttentionCandidateSourceGeneration();
          sourceVector.publishCollection(sourceIdentityForCollection(collection));
          return collection;
        }
        establishedJevPaths.add(collectionPath);

        let rawText: string;
        try {
          rawText = await fileOps.readFile(collectionPath);
        } catch (error) {
          logger.error(`collection read failed path=${collectionPath}`, safeErrorContext(error));
          throw error;
        }

        let raw: unknown;
        try {
          raw = JSON.parse(rawText);
        } catch (error) {
          logger.error(`collection parse failed path=${collectionPath}`, safeErrorContext(error));
          throw error;
        }
        const rawSourceVersion =
          typeof raw === "object" && raw !== null && "schemaVersion" in raw ? raw.schemaVersion : 0;
        const sourceVersion =
          typeof rawSourceVersion === "number" && Number.isSafeInteger(rawSourceVersion)
            ? String(rawSourceVersion)
            : "invalid";
        let migration: CollectionMigrationResult;
        const decoded = decodeStoredCollection(raw);
        try {
          migration = migrateCollection(decoded.data, deps.collectionMigrationDependencies);
        } catch (error) {
          logger.error(
            `collection migration failed path=${collectionPath} sourceVersion=${sourceVersion} targetVersion=${CURRENT_COLLECTION_SCHEMA_VERSION}`,
            safeErrorContext(error),
          );
          throw error;
        }
        const normalizedCurrent =
          decoded.normalized && migration.sourceVersion === CURRENT_COLLECTION_SCHEMA_VERSION;
        const validated = normalizedCurrent
          ? validateCollection({
              ...migration.data,
              revision: migration.data.revision + 1,
            })
          : migration.data;
        if (!migration.migrated && !decoded.normalized) {
          sourceVector.publishCollection(sourceIdentityForCollection(validated));
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
          const migrationArtifacts = collectionArtifactsForMigration(
            migration.sourceVersion,
            validated.schemaVersion,
            artifacts,
          );
          for (const artifact of migrationArtifacts) {
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
                safeErrorContext(error),
              );
              throw error;
            }
          }
        }

        await persistCollection(validated);
        logger.log(
          `collection migration persisted path=${collectionPath} sourceVersion=${migration.sourceVersion} targetVersion=${CURRENT_COLLECTION_SCHEMA_VERSION} migrated=${migration.migrated} normalized=${normalizedCurrent} normalizationFields=${decoded.normalizedFields.join(",") || "none"} acquisitionGames=${decoded.normalizedAcquisitionCount} discardedLegacyPairCount=${migration.discardedLegacyPairCount ?? 0}`,
        );
        advanceAttentionCandidateSourceGeneration();
        sourceVector.publishCollection(sourceIdentityForCollection(validated));
        return validated;
      }).catch((error: unknown) => {
        sourceVector.markUnavailable("collection");
        throw error;
      });
    },

    loadJevSourceSnapshot(): Promise<JevSourceSnapshot> {
      return captureJevSourceSnapshot();
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
      sourceVector.publishCollection(sourceIdentityForCollection(collection));
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

    async loadRedundancySettingsRead() {
      const source = await loadStoredSource("redundancy-settings");
      return {
        settings: structuredClone(source.data as RedundancySettings),
        migrationNotice: source.redundancyWeightsMigrated
          ? "Legacy redundancy weights were migrated to factual binary/continuous weights (4:3)."
          : null,
      };
    },

    async saveRedundancySettings(settings: RedundancySettings): Promise<void> {
      const validated = RedundancySettingsSchema.parse(settings);
      await withProfileLock(async () => {
        const changed = await saveStoredSource("redundancy-settings", validated);
        if (changed) {
          try {
            await invalidateProfile("redundancy-settings");
          } catch (error) {
            throw new DurableSourcePostCommitError(
              "Factual redundancy settings were saved, but profile cache invalidation failed",
              { cause: error },
            );
          }
        }
      });
    },

    async loadWishlist(): Promise<WishlistEntry[]> {
      const wishlistPath = path.join(dataDir, "wishlist.json");
      const exists = await fileOps.exists(wishlistPath);
      if (!exists) return [];

      const raw = await fileOps.readFile(wishlistPath);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return parsed as WishlistEntry[];
      const entries: unknown[] = parsed;
      return entries.map((entry): WishlistEntry => {
        if (!isRecord(entry) || !Object.hasOwn(entry, "bggSource")) {
          return entry as WishlistEntry;
        }
        const source = WishlistBggSourceSnapshotSchema.safeParse(entry["bggSource"]);
        if (source.success) return { ...entry, bggSource: source.data } as WishlistEntry;
        const legacyEntry = { ...entry };
        delete legacyEntry["bggSource"];
        return legacyEntry as unknown as WishlistEntry;
      });
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
            semanticEvidenceEpoch: collection.semanticRedundancy.evidenceEpoch,
            semanticConsentEpoch: collection.semanticRedundancy.consentEpoch,
            factualWeightsEpoch: collection.semanticRedundancy.factualWeightsEpoch,
            factualWeightsFingerprint: collection.semanticRedundancy.factualWeightsFingerprint,
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
  const saveWishlist = storage.saveWishlist.bind(storage);
  const hydrateVector = storage.hydrateSourceVector?.bind(storage);
  const loadCollection = storage.loadCollection.bind(storage);
  const loadWishlist = storage.loadWishlist.bind(storage);
  const loadJevSourceSnapshot = storage.loadJevSourceSnapshot?.bind(storage);
  const loadTournament = storage.loadTournament.bind(storage);
  const loadPredictionSettings = storage.loadPredictionSettings.bind(storage);
  const loadNicheSettings = storage.loadNicheSettings.bind(storage);
  const loadRedundancySettings = storage.loadRedundancySettings.bind(storage);
  const loadRedundancySettingsRead = storage.loadRedundancySettingsRead?.bind(storage);
  const loadShelfConfig = storage.loadShelfConfig.bind(storage);
  storage.loadCollection = () => coordinate(loadCollection);
  storage.loadWishlist = () => coordinate(loadWishlist);
  if (loadJevSourceSnapshot)
    storage.loadJevSourceSnapshot = () => coordinate(loadJevSourceSnapshot);
  storage.loadTournament = () => coordinate(loadTournament);
  storage.loadPredictionSettings = () => coordinate(loadPredictionSettings);
  storage.loadNicheSettings = () => coordinate(loadNicheSettings);
  storage.loadRedundancySettings = () => coordinate(loadRedundancySettings);
  if (loadRedundancySettingsRead)
    storage.loadRedundancySettingsRead = () => coordinate(loadRedundancySettingsRead);
  storage.loadShelfConfig = () => coordinate(loadShelfConfig);
  storage.saveCollection = (collection) => coordinate(() => saveCollection(collection));
  storage.saveWishlist = (entries) =>
    coordinate(async () => {
      let effectiveChange = true;
      try {
        effectiveChange = canonicalSha256(await loadWishlist()) !== canonicalSha256(entries);
      } catch {
        // If prior durable state cannot be established, conservatively revoke prepared scopes.
      }
      let revoked = false;
      if (effectiveChange) {
        advanceWishlistMutationGeneration(storage);
        revoked = true;
      }
      try {
        await saveWishlist(entries);
      } catch (error) {
        // A failed atomic write may have changed durable state despite its error result.
        if (!revoked) advanceWishlistMutationGeneration(storage);
        throw error;
      }
    });
  storage.saveTournament = (data) => coordinate(() => saveTournament(data));
  storage.savePredictionSettings = (settings) => coordinate(() => savePredictionSettings(settings));
  storage.saveNicheSettings = (settings) => coordinate(() => saveNicheSettings(settings));
  storage.saveRedundancySettings = (settings) => coordinate(() => saveRedundancySettings(settings));
  storage.saveShelfConfig = (config) => coordinate(() => saveShelfConfig(config));
  if (hydrateVector) storage.hydrateSourceVector = () => coordinate(hydrateVector);
  return storage;
}
