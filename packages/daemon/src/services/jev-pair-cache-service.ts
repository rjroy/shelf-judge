import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { parseWishlistCandidateMember } from "./jev-pair-identity.js";

export type JevSignal = "C" | "D";
export type JevDependencyKind = "C_ONLY" | "D_ONLY" | "SHARED_CD";
export type JevPairDomain = "collection" | "wishlist-candidate";

export interface JevPairJudgment {
  /** Omitted for backwards-compatible collection-domain judgments. */
  pairDomain?: JevPairDomain;
  collectionId: string;
  consentEpoch?: string;
  gameAId: string;
  gameBId: string;
  signal: JevSignal;
  dependencyKind: JevDependencyKind;
  value: number;
  confidence?: number;
  modelId: string;
  rubricVersion: string;
  questionVersion: string;
  requestSchemaVersion: string;
  scoreMappingVersion: string;
  semanticPolicyId: string;
  completedAt: string;
  dependencies: JevPairDependency[];
}

export interface JevPairDependency {
  gameId: string;
  nameFingerprint: string;
  descriptionFingerprint?: string;
  noteFingerprint?: string;
  noteVersion?: string;
}

export interface JevPairKey {
  gameAId: string;
  gameBId: string;
  signal: JevSignal;
  /** Omitted keys address the existing collection domain. */
  pairDomain?: JevPairDomain;
}

export interface JevRunProgress {
  runId: string;
  state: "running" | "completed" | "interrupted" | "failed";
  pairCount: number;
  completedPairs: number;
  cacheHits: number;
  cacheMisses: number;
  failedPairs: number;
  stopReason?: JevRunStopReason;
  updatedAt: string;
}

export type JevRunProgressRead =
  | { status: "available"; progress: JevRunProgress }
  | { status: "none" | "invalid" | "unavailable" };

export type JevRunStopReason =
  | "provider-limit"
  | "provider-unconfigured"
  | "application-attempt-limit"
  | "application-token-threshold"
  | "application-deadline";

export interface JevAdvisoryActivation {
  identity: string;
  activatedAt: string;
}

export interface JevPairCheckpoint {
  judgments: [JevPairJudgment] | [JevPairJudgment, JevPairJudgment];
  progress: JevRunProgress;
}

export interface JevRunFinish {
  /** Null preserves any independently valid activation already in the cache. */
  activation: JevAdvisoryActivation | null;
  progress: JevRunProgress;
}

export interface JevPairCache {
  readonly available: boolean;
  mutationRevision(): number | null;
  lookup(key: JevPairKey): JevPairJudgment | null;
  upsert(judgment: JevPairJudgment): void;
  purgePair(
    gameAId: string,
    gameBId: string,
    signal?: JevSignal,
    pairDomain?: JevPairDomain,
  ): number;
  purgeGame(
    gameId: string,
    signal?: JevSignal,
    dependencyKind?: JevDependencyKind,
    pairDomain?: JevPairDomain,
  ): number;
  invalidateGame(
    gameId: string,
    dependencyKinds: readonly JevDependencyKind[],
    pairDomain?: JevPairDomain,
  ): number;
  /** Atomically rekeys a validated candidate C_ONLY row to raw owned local IDs. */
  transferCandidateCOnlyPair(
    candidateKey: JevPairKey,
    ownedLocalGameIds: readonly [string, string],
  ): boolean;
  purgeDDependent(): number;
  saveRunProgress(progress: JevRunProgress): void;
  checkpointPair(checkpoint: JevPairCheckpoint): void;
  finishRun(finish: JevRunFinish): void;
  getRunProgress(): JevRunProgress | null;
  getRunProgressRead(): JevRunProgressRead;
  setActivation(activation: JevAdvisoryActivation | null): void;
  getActivation(): JevAdvisoryActivation | null;
  compact(): void;
  reset(): void;
  close(): void;
}

const DATABASE_FILENAME = "jev-pair-cache.sqlite";
const SCHEMA_VERSION = 4;

function canonicalPair(left: string, right: string): [string, string] {
  if (!left || !right || left === right) throw new Error("Pair requires two distinct stable IDs");
  return left < right ? [left, right] : [right, left];
}

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireText(value: string, field: string): void {
  if (!value.trim() || value.length > 2048) throw new Error(`Invalid ${field}`);
}

function requireFingerprint(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`Invalid ${field}`);
}

function requireExactKeys(value: object, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`Unexpected ${field} properties`);
}

function validateProgress(progress: JevRunProgress): void {
  if (!isRecord(progress)) throw new Error("Invalid run progress");
  requireExactKeys(
    progress,
    [
      "runId",
      "state",
      "pairCount",
      "completedPairs",
      "cacheHits",
      "cacheMisses",
      "failedPairs",
      "stopReason",
      "updatedAt",
    ],
    "run progress",
  );
  if (!["running", "completed", "interrupted", "failed"].includes(progress.state))
    throw new Error("Invalid run state");
  if (Object.hasOwn(progress, "stopReason")) {
    if (
      ![
        "provider-limit",
        "provider-unconfigured",
        "application-attempt-limit",
        "application-token-threshold",
        "application-deadline",
      ].some((reason) => reason === progress.stopReason) ||
      progress.state !== "failed"
    )
      throw new Error("Invalid run stop reason");
  }
  for (const n of [
    progress.pairCount,
    progress.completedPairs,
    progress.cacheHits,
    progress.cacheMisses,
    progress.failedPairs,
  ])
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid progress counter");
  if (progress.completedPairs > progress.pairCount) throw new Error("Invalid completed pair count");
  requireText(progress.runId, "run ID");
  requireText(progress.updatedAt, "updatedAt");
}

function validateActivation(activation: JevAdvisoryActivation): void {
  if (!isRecord(activation)) throw new Error("Invalid activation");
  requireExactKeys(activation, ["identity", "activatedAt"], "activation");
  requireText(activation.identity, "activation identity");
  requireText(activation.activatedAt, "activation timestamp");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const judgmentKeys = [
  "pairDomain",
  "collectionId",
  "consentEpoch",
  "gameAId",
  "gameBId",
  "signal",
  "dependencyKind",
  "value",
  "confidence",
  "modelId",
  "rubricVersion",
  "questionVersion",
  "requestSchemaVersion",
  "scoreMappingVersion",
  "semanticPolicyId",
  "completedAt",
  "dependencies",
] as const;
const dependencyKeys = [
  "gameId",
  "nameFingerprint",
  "descriptionFingerprint",
  "noteFingerprint",
  "noteVersion",
] as const;

function validate(j: JevPairJudgment): void {
  if (!isRecord(j)) throw new Error("Invalid judgment");
  requireExactKeys(j, judgmentKeys, "judgment");
  const pairDomain = j.pairDomain === undefined ? "collection" : j.pairDomain;
  if (pairDomain !== "collection" && pairDomain !== "wishlist-candidate")
    throw new Error("Invalid pair domain");
  canonicalPair(j.gameAId, j.gameBId);
  requireText(j.collectionId, "collection ID");
  if (!Number.isFinite(j.value) || j.value < 0 || j.value > 1)
    throw new Error("Invalid judgment value");
  if (
    j.confidence !== undefined &&
    (!Number.isFinite(j.confidence) || j.confidence < 0 || j.confidence > 1)
  ) {
    throw new Error("Invalid confidence");
  }
  for (const [field, value] of Object.entries({
    modelId: j.modelId,
    rubricVersion: j.rubricVersion,
    questionVersion: j.questionVersion,
    requestSchemaVersion: j.requestSchemaVersion,
    scoreMappingVersion: j.scoreMappingVersion,
    semanticPolicyId: j.semanticPolicyId,
    completedAt: j.completedAt,
  })) {
    requireText(value, field);
  }
  if (
    j.dependencyKind !== "C_ONLY" &&
    j.dependencyKind !== "D_ONLY" &&
    j.dependencyKind !== "SHARED_CD"
  )
    throw new Error("Invalid dependency kind");
  if (j.signal !== "C" && j.signal !== "D") throw new Error("Invalid signal");
  if (
    (j.dependencyKind === "C_ONLY" && j.signal !== "C") ||
    (j.dependencyKind === "D_ONLY" && j.signal !== "D")
  )
    throw new Error("Signal conflicts with dependency kind");
  if (j.consentEpoch !== undefined) requireText(j.consentEpoch, "consent epoch");
  if ((j.dependencyKind === "C_ONLY") !== (j.consentEpoch === undefined)) {
    throw new Error("Consent epoch must be present only for note-dependent judgments");
  }
  if (!Array.isArray(j.dependencies) || j.dependencies.length !== 2)
    throw new Error("Exactly two dependencies are required");
  const [a, b] = canonicalPair(j.gameAId, j.gameBId);
  if (j.dependencies.some((dep) => !isRecord(dep))) throw new Error("Invalid dependency");
  const deps = [...j.dependencies].sort((x, y) => compareStableIds(x.gameId, y.gameId));
  if (deps[0]?.gameId !== a || deps[1]?.gameId !== b)
    throw new Error("Dependencies must identify both pair members");
  for (const dep of deps) {
    requireExactKeys(dep, dependencyKeys, "dependency");
    requireFingerprint(dep.nameFingerprint, "name fingerprint");
    if (j.dependencyKind !== "D_ONLY" && !dep.descriptionFingerprint)
      throw new Error("Description fingerprint required");
    if (j.dependencyKind !== "C_ONLY" && (!dep.noteFingerprint || !dep.noteVersion))
      throw new Error("Note fingerprint and version required");
    if (
      j.dependencyKind === "C_ONLY" &&
      (dep.noteFingerprint !== undefined || dep.noteVersion !== undefined)
    )
      throw new Error("C-only dependency cannot contain note metadata");
    if (j.dependencyKind === "D_ONLY" && dep.descriptionFingerprint !== undefined)
      throw new Error("D-only dependency cannot contain description metadata");
    if (dep.descriptionFingerprint !== undefined)
      requireFingerprint(dep.descriptionFingerprint, "description fingerprint");
    if (dep.noteFingerprint !== undefined)
      requireFingerprint(dep.noteFingerprint, "note fingerprint");
    if (dep.noteVersion !== undefined) requireText(dep.noteVersion, "note version");
  }
  if (pairDomain === "wishlist-candidate") {
    if (j.dependencyKind !== "C_ONLY" || j.signal !== "C")
      throw new Error("Wishlist candidate cache rows must be C_ONLY");
    const members = [a, b].map(parseWishlistCandidateMember);
    const candidate = members.find((member) => member?.kind === "wishlist-bgg");
    const owned = members.find((member) => member?.kind === "owned-local");
    if (
      members.some((member) => member === null) ||
      members.filter((member) => member?.kind === "wishlist-bgg").length !== 1 ||
      members.filter((member) => member?.kind === "owned-local").length !== 1 ||
      !candidate ||
      candidate.kind !== "wishlist-bgg" ||
      !owned ||
      owned.kind !== "owned-local" ||
      candidate.collectionId !== j.collectionId ||
      owned.collectionId !== j.collectionId
    )
      throw new Error("Invalid wishlist candidate pair members");
  }
}

function projectDependency(dep: JevPairDependency): JevPairDependency {
  return {
    gameId: dep.gameId,
    nameFingerprint: dep.nameFingerprint,
    ...(dep.descriptionFingerprint === undefined
      ? {}
      : { descriptionFingerprint: dep.descriptionFingerprint }),
    ...(dep.noteFingerprint === undefined ? {} : { noteFingerprint: dep.noteFingerprint }),
    ...(dep.noteVersion === undefined ? {} : { noteVersion: dep.noteVersion }),
  };
}

type JudgmentRow = {
  pair_domain: JevPairDomain;
  game_a: string;
  game_b: string;
  collection_id: string;
  consent_epoch: string | null;
  signal: JevSignal;
  dependency_kind: JevDependencyKind;
  value: number;
  confidence: number | null;
  model_id: string;
  rubric_version: string;
  question_version: string;
  request_schema_version: string;
  score_mapping_version: string;
  semantic_policy_id: string;
  completed_at: string;
  dependencies_json: string;
};

function projectJudgmentRow(row: JudgmentRow): JevPairJudgment | null {
  try {
    const dependencies: unknown = JSON.parse(row.dependencies_json);
    if (!Array.isArray(dependencies)) return null;
    const judgment: JevPairJudgment = {
      ...(row.pair_domain === "collection" ? {} : { pairDomain: row.pair_domain }),
      gameAId: row.game_a,
      gameBId: row.game_b,
      collectionId: row.collection_id,
      ...(row.consent_epoch === null ? {} : { consentEpoch: row.consent_epoch }),
      signal: row.signal,
      dependencyKind: row.dependency_kind,
      value: row.value,
      ...(row.confidence === null ? {} : { confidence: row.confidence }),
      modelId: row.model_id,
      rubricVersion: row.rubric_version,
      questionVersion: row.question_version,
      requestSchemaVersion: row.request_schema_version,
      scoreMappingVersion: row.score_mapping_version,
      semanticPolicyId: row.semantic_policy_id,
      completedAt: row.completed_at,
      dependencies: dependencies as JevPairDependency[],
    };
    validate(judgment);
    return judgment;
  } catch {
    return null;
  }
}

/** Canonical persisted representation; field and optional-property order is immaterial. */
function canonicalJudgmentContent(judgment: JevPairJudgment): string {
  const [gameAId, gameBId] = canonicalPair(judgment.gameAId, judgment.gameBId);
  return JSON.stringify({
    pairDomain: judgment.pairDomain ?? "collection",
    collectionId: judgment.collectionId,
    consentEpoch: judgment.consentEpoch ?? null,
    gameAId,
    gameBId,
    signal: judgment.signal,
    dependencyKind: judgment.dependencyKind,
    value: judgment.value,
    confidence: judgment.confidence ?? null,
    modelId: judgment.modelId,
    rubricVersion: judgment.rubricVersion,
    questionVersion: judgment.questionVersion,
    requestSchemaVersion: judgment.requestSchemaVersion,
    scoreMappingVersion: judgment.scoreMappingVersion,
    semanticPolicyId: judgment.semanticPolicyId,
    completedAt: judgment.completedAt,
    dependencies: [...judgment.dependencies]
      .sort((left, right) => compareStableIds(left.gameId, right.gameId))
      .map((dependency) => ({
        gameId: dependency.gameId,
        nameFingerprint: dependency.nameFingerprint,
        descriptionFingerprint: dependency.descriptionFingerprint ?? null,
        noteFingerprint: dependency.noteFingerprint ?? null,
        noteVersion: dependency.noteVersion ?? null,
      })),
  });
}

type RunProgressRow = Omit<JevRunProgress, "stopReason"> & { stopReason: string | null };

function prepareStatements(db: Database) {
  return {
    get: db.query<JudgmentRow, [JevPairDomain, string, string, JevSignal]>(
      "SELECT * FROM judgments WHERE pair_domain=? AND game_a=? AND game_b=? AND signal=?",
    ),
    upsert: db.query(
      "INSERT OR REPLACE INTO judgments (pair_domain,game_a,game_b,signal,collection_id,consent_epoch,dependency_kind,value,confidence,model_id,rubric_version,question_version,request_schema_version,score_mapping_version,semantic_policy_id,completed_at,dependencies_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ),
    deletePairSignal: db.query(
      "DELETE FROM judgments WHERE pair_domain=? AND game_a=? AND game_b=? AND signal=?",
    ),
    deletePair: db.query("DELETE FROM judgments WHERE pair_domain=? AND game_a=? AND game_b=?"),
    saveRunProgress: db.query(
      "INSERT OR REPLACE INTO run_progress (singleton,run_id,state,pair_count,completed_pairs,cache_hits,cache_misses,failed_pairs,stop_reason,updated_at) VALUES (1,?,?,?,?,?,?,?,?,?)",
    ),
    getRunProgress: db.query<RunProgressRow, []>(
      "SELECT run_id as runId,state,pair_count as pairCount,completed_pairs as completedPairs,cache_hits as cacheHits,cache_misses as cacheMisses,failed_pairs as failedPairs,stop_reason as stopReason,updated_at as updatedAt FROM run_progress WHERE singleton=1",
    ),
    setActivation: db.query("INSERT OR REPLACE INTO activation VALUES (1,?,?)"),
    getActivation: db.query<JevAdvisoryActivation, []>(
      "SELECT identity,activated_at as activatedAt FROM activation WHERE singleton=1",
    ),
    deleteActivation: db.query("DELETE FROM activation"),
  };
}

function noOpCache(): JevPairCache {
  return {
    available: false,
    mutationRevision: () => null,
    lookup: () => null,
    upsert: () => {
      throw new Error("Jev pair cache unavailable");
    },
    purgePair: () => {
      throw new Error("Jev pair cache unavailable");
    },
    purgeGame: () => {
      throw new Error("Jev pair cache unavailable");
    },
    invalidateGame: () => {
      throw new Error("Jev pair cache unavailable");
    },
    transferCandidateCOnlyPair: () => {
      throw new Error("Jev pair cache unavailable");
    },
    purgeDDependent: () => {
      throw new Error("Jev pair cache unavailable");
    },
    saveRunProgress: () => {
      throw new Error("Jev pair cache unavailable");
    },
    checkpointPair: () => {
      throw new Error("Jev pair cache unavailable");
    },
    finishRun: () => {
      throw new Error("Jev pair cache unavailable");
    },
    getRunProgress: () => null,
    getRunProgressRead: () => ({ status: "unavailable" }),
    setActivation: () => {
      throw new Error("Jev pair cache unavailable");
    },
    getActivation: () => null,
    compact: () => undefined,
    reset: () => undefined,
    close: () => undefined,
  };
}

/** Creates a disposable daemon cache at dataDir/jev-pair-cache.sqlite. WAL allows readers during short writes. */
export async function createJevPairCache(dataDir: string): Promise<JevPairCache> {
  let db: Database | undefined;
  let statements: ReturnType<typeof prepareStatements> | undefined;
  try {
    await mkdir(dataDir, { recursive: true });
    db = new Database(join(dataDir, DATABASE_FILENAME), { create: true });
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
    const version = Number(
      db.query("PRAGMA user_version").get() &&
        (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    );
    if (version > SCHEMA_VERSION) throw new Error("Unsupported cache schema version");
    if (version < 1) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE judgments (
          pair_domain TEXT NOT NULL CHECK(pair_domain IN ('collection','wishlist-candidate')),
          game_a TEXT NOT NULL, game_b TEXT NOT NULL, signal TEXT NOT NULL CHECK(signal IN ('C','D')),
          collection_id TEXT NOT NULL, consent_epoch TEXT,
          dependency_kind TEXT NOT NULL CHECK(dependency_kind IN ('C_ONLY','D_ONLY','SHARED_CD')),
          value REAL NOT NULL CHECK(value >= 0 AND value <= 1), confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
          model_id TEXT NOT NULL, rubric_version TEXT NOT NULL, question_version TEXT NOT NULL,
          request_schema_version TEXT NOT NULL, score_mapping_version TEXT NOT NULL, semantic_policy_id TEXT NOT NULL,
          completed_at TEXT NOT NULL, dependencies_json TEXT NOT NULL,
          PRIMARY KEY(pair_domain, game_a, game_b, signal), CHECK(game_a < game_b)
        );
        CREATE INDEX judgments_domain_member_a ON judgments(pair_domain, game_a);
        CREATE INDEX judgments_domain_member_b ON judgments(pair_domain, game_b);
        CREATE TABLE run_progress (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1), run_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('running','completed','interrupted','failed')),
          pair_count INTEGER NOT NULL, completed_pairs INTEGER NOT NULL, cache_hits INTEGER NOT NULL,
          cache_misses INTEGER NOT NULL, failed_pairs INTEGER NOT NULL, stop_reason TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE activation (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), identity TEXT NOT NULL, activated_at TEXT NOT NULL);
        PRAGMA user_version = 4;
        COMMIT;`);
    } else {
      if (version < 2) {
        // Earlier cache rows lack collection/consent fences and cannot be proven reusable.
        db.exec(`BEGIN IMMEDIATE;
          ALTER TABLE judgments ADD COLUMN collection_id TEXT NOT NULL DEFAULT '';
          ALTER TABLE judgments ADD COLUMN consent_epoch TEXT;
          DELETE FROM judgments;
          DELETE FROM activation;
          PRAGMA user_version = 2;
          COMMIT;`);
      }
      if (version < 3) {
        db.exec(`BEGIN IMMEDIATE;
          ALTER TABLE run_progress ADD COLUMN stop_reason TEXT;
          PRAGMA user_version = 3;
          COMMIT;`);
      }
      if (version < 4) {
        // Every pre-domain row was written by collection-only callers. Rebuild
        // the key with an explicit collection namespace without dropping rows.
        db.exec(`BEGIN IMMEDIATE;
          ALTER TABLE judgments RENAME TO judgments_v3;
          CREATE TABLE judgments (
            pair_domain TEXT NOT NULL CHECK(pair_domain IN ('collection','wishlist-candidate')),
            game_a TEXT NOT NULL, game_b TEXT NOT NULL, signal TEXT NOT NULL CHECK(signal IN ('C','D')),
            collection_id TEXT NOT NULL, consent_epoch TEXT,
            dependency_kind TEXT NOT NULL CHECK(dependency_kind IN ('C_ONLY','D_ONLY','SHARED_CD')),
            value REAL NOT NULL CHECK(value >= 0 AND value <= 1), confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
            model_id TEXT NOT NULL, rubric_version TEXT NOT NULL, question_version TEXT NOT NULL,
            request_schema_version TEXT NOT NULL, score_mapping_version TEXT NOT NULL, semantic_policy_id TEXT NOT NULL,
            completed_at TEXT NOT NULL, dependencies_json TEXT NOT NULL,
            PRIMARY KEY(pair_domain, game_a, game_b, signal), CHECK(game_a < game_b)
          );
          INSERT INTO judgments (
            pair_domain,game_a,game_b,signal,collection_id,consent_epoch,dependency_kind,value,confidence,
            model_id,rubric_version,question_version,request_schema_version,score_mapping_version,
            semantic_policy_id,completed_at,dependencies_json
          ) SELECT 'collection',game_a,game_b,signal,collection_id,consent_epoch,dependency_kind,value,confidence,
            model_id,rubric_version,question_version,request_schema_version,score_mapping_version,
            semantic_policy_id,completed_at,dependencies_json FROM judgments_v3;
          DROP TABLE judgments_v3;
          CREATE INDEX judgments_domain_member_a ON judgments(pair_domain, game_a);
          CREATE INDEX judgments_domain_member_b ON judgments(pair_domain, game_b);
          PRAGMA user_version = 4;
          COMMIT;`);
      }
    }
    statements = prepareStatements(db);
  } catch {
    try {
      db?.close();
    } catch {
      /* Initialization already failed; keep this cache unavailable. */
    }
    return noOpCache();
  }
  if (!db || !statements) return noOpCache();

  let closed = false;
  let revision: number | null = 0;
  const readDataVersion = (): number => {
    const row = db?.query<{ data_version: number }, []>("PRAGMA main.data_version").get();
    if (!row || !Number.isSafeInteger(row.data_version) || row.data_version < 0)
      throw new Error("Unable to read Jev cache data version");
    return row.data_version;
  };
  let observedDataVersion: number;
  try {
    observedDataVersion = readDataVersion();
  } catch {
    db.close();
    return noOpCache();
  }
  const usable = (): boolean => !closed;
  const recordMutation = (): void => {
    revision = revision === null || revision >= Number.MAX_SAFE_INTEGER ? null : revision + 1;
  };
  const invalidateRevision = (): void => {
    revision = null;
  };
  const assertUsable = (): void => {
    if (!usable()) throw new Error("Jev pair cache closed");
  };
  const writeJudgment = (judgment: JevPairJudgment): void => {
    const [a, b] = canonicalPair(judgment.gameAId, judgment.gameBId);
    statements?.upsert.run(
      judgment.pairDomain ?? "collection",
      a,
      b,
      judgment.signal,
      judgment.collectionId,
      judgment.consentEpoch ?? null,
      judgment.dependencyKind,
      judgment.value,
      judgment.confidence ?? null,
      judgment.modelId,
      judgment.rubricVersion,
      judgment.questionVersion,
      judgment.requestSchemaVersion,
      judgment.scoreMappingVersion,
      judgment.semanticPolicyId,
      judgment.completedAt,
      JSON.stringify(judgment.dependencies.map(projectDependency)),
    );
  };
  const writeProgress = (progress: JevRunProgress): void => {
    statements?.saveRunProgress.run(
      progress.runId,
      progress.state,
      progress.pairCount,
      progress.completedPairs,
      progress.cacheHits,
      progress.cacheMisses,
      progress.failedPairs,
      progress.stopReason ?? null,
      progress.updatedAt,
    );
  };
  const readProgress = (): JevRunProgressRead => {
    if (!usable()) return { status: "unavailable" };
    try {
      const row = statements.getRunProgress.get();
      if (!row) return { status: "none" };
      const progress: JevRunProgress = {
        runId: row.runId,
        state: row.state,
        pairCount: row.pairCount,
        completedPairs: row.completedPairs,
        cacheHits: row.cacheHits,
        cacheMisses: row.cacheMisses,
        failedPairs: row.failedPairs,
        ...(row.stopReason === null ? {} : { stopReason: row.stopReason as JevRunStopReason }),
        updatedAt: row.updatedAt,
      };
      validateProgress(progress);
      return { status: "available", progress };
    } catch {
      return { status: "invalid" };
    }
  };
  return {
    available: true,
    mutationRevision() {
      if (!usable() || revision === null) return null;
      try {
        const currentDataVersion = readDataVersion();
        if (currentDataVersion !== observedDataVersion) {
          observedDataVersion = currentDataVersion;
          recordMutation();
        }
        return revision;
      } catch {
        invalidateRevision();
        return null;
      }
    },
    lookup(key) {
      if (!usable()) return null;
      const pairDomain = key.pairDomain === undefined ? "collection" : key.pairDomain;
      if (pairDomain !== "collection" && pairDomain !== "wishlist-candidate") return null;
      let pair: [string, string];
      try {
        pair = canonicalPair(key.gameAId, key.gameBId);
      } catch {
        return null;
      }
      let row: JudgmentRow | null;
      try {
        row = statements.get.get(pairDomain, pair[0], pair[1], key.signal) ?? null;
      } catch {
        // A query/connection failure makes the cache state unreadable; callers
        // must not treat it as a trustworthy miss.
        invalidateRevision();
        return null;
      }
      if (!row) return null;

      // A malformed row is unusable in isolation. It does not make other
      // rows unreadable or invalidate the cache's mutation revision.
      return projectJudgmentRow(row);
    },
    upsert(judgment) {
      assertUsable();
      validate(judgment);
      writeJudgment(judgment);
      recordMutation();
    },
    transferCandidateCOnlyPair(candidateKey, ownedLocalGameIds) {
      assertUsable();
      if (candidateKey.pairDomain !== "wishlist-candidate" || candidateKey.signal !== "C")
        throw new Error("Candidate transfer requires wishlist-candidate domain");
      if (
        !Array.isArray(ownedLocalGameIds) ||
        ownedLocalGameIds.length !== 2 ||
        ownedLocalGameIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 2048)
      )
        throw new Error("Candidate transfer requires two owned local IDs");
      const sourcePair = canonicalPair(candidateKey.gameAId, candidateKey.gameBId);
      const sourceRow = statements.get.get("wishlist-candidate", sourcePair[0], sourcePair[1], "C");
      if (!sourceRow) return false;
      const source = projectJudgmentRow(sourceRow);
      if (!source) throw new Error("Candidate cache row is invalid");
      if (source.dependencyKind !== "C_ONLY" || source.signal !== "C")
        throw new Error("Only candidate C_ONLY rows can be transferred");
      const members = [source.gameAId, source.gameBId].map(parseWishlistCandidateMember);
      const candidate = members.find((member) => member?.kind === "wishlist-bgg");
      const priorOwned = members.find((member) => member?.kind === "owned-local");
      if (
        !candidate ||
        candidate.kind !== "wishlist-bgg" ||
        !priorOwned ||
        priorOwned.kind !== "owned-local" ||
        source.collectionId !== candidate.collectionId ||
        source.collectionId !== priorOwned.collectionId ||
        ownedLocalGameIds[1] !== priorOwned.localGameId
      )
        throw new Error("Candidate cache pair members are invalid");
      const [acquiredLocalId, otherOwnedLocalId] = ownedLocalGameIds;
      const targetPair = canonicalPair(acquiredLocalId, otherOwnedLocalId);
      const candidateMember = [source.gameAId, source.gameBId].find(
        (memberId) => parseWishlistCandidateMember(memberId)?.kind === "wishlist-bgg",
      );
      const ownedMember = [source.gameAId, source.gameBId].find(
        (memberId) => parseWishlistCandidateMember(memberId)?.kind === "owned-local",
      );
      if (!candidateMember || !ownedMember)
        throw new Error("Candidate cache pair members are invalid");
      const target: JevPairJudgment = {
        collectionId: source.collectionId,
        gameAId: targetPair[0],
        gameBId: targetPair[1],
        signal: "C",
        dependencyKind: "C_ONLY",
        value: source.value,
        ...(source.confidence === undefined ? {} : { confidence: source.confidence }),
        modelId: source.modelId,
        rubricVersion: source.rubricVersion,
        questionVersion: source.questionVersion,
        requestSchemaVersion: source.requestSchemaVersion,
        scoreMappingVersion: source.scoreMappingVersion,
        semanticPolicyId: source.semanticPolicyId,
        completedAt: source.completedAt,
        dependencies: source.dependencies
          .map((dependency) => ({
            ...dependency,
            gameId:
              dependency.gameId === candidateMember
                ? acquiredLocalId
                : dependency.gameId === ownedMember
                  ? otherOwnedLocalId
                  : dependency.gameId,
          }))
          .sort((left, right) => compareStableIds(left.gameId, right.gameId)),
      };
      validate(target);
      const targetExisting = statements.get.get("collection", targetPair[0], targetPair[1], "C");
      const existingJudgment = targetExisting ? projectJudgmentRow(targetExisting) : null;
      if (targetExisting && !existingJudgment)
        throw new Error("Existing owned cache row is invalid");
      if (
        existingJudgment &&
        canonicalJudgmentContent(existingJudgment) !== canonicalJudgmentContent(target)
      )
        throw new Error("Conflicting owned cache row prevents candidate transfer");
      db.transaction(() => {
        if (!existingJudgment) writeJudgment(target);
        statements.deletePairSignal.run("wishlist-candidate", sourcePair[0], sourcePair[1], "C");
      })();
      recordMutation();
      return true;
    },
    purgePair(left, right, signal, pairDomain = "collection") {
      assertUsable();
      const [a, b] = canonicalPair(left, right);
      const deleted = db.transaction(() => {
        statements.deleteActivation.run();
        return Number(
          (signal
            ? statements.deletePairSignal.run(pairDomain, a, b, signal)
            : statements.deletePair.run(pairDomain, a, b)
          ).changes,
        );
      })();
      recordMutation();
      return deleted;
    },
    purgeGame(gameId, signal, dependencyKind, pairDomain = "collection") {
      const allKinds: JevDependencyKind[] = ["C_ONLY", "D_ONLY", "SHARED_CD"];
      const kinds = dependencyKind ? [dependencyKind] : allKinds;
      const selected = signal
        ? kinds.filter((kind) => kind === "SHARED_CD" || (kind === "D_ONLY" ? "D" : "C") === signal)
        : kinds;
      assertUsable();
      requireText(gameId, "game ID");
      if (selected.length === 0) return 0;
      const placeholders = selected.map(() => "?").join(",");
      const deleted = db.transaction(() => {
        statements.deleteActivation.run();
        return Number(
          db
            .query(
              `DELETE FROM judgments WHERE pair_domain=? AND (game_a=? OR game_b=?) AND dependency_kind IN (${placeholders})${signal ? " AND signal=?" : ""}`,
            )
            .run(pairDomain, gameId, gameId, ...selected, ...(signal ? [signal] : [])).changes,
        );
      })();
      recordMutation();
      return deleted;
    },
    invalidateGame(gameId, dependencyKinds, pairDomain = "collection") {
      assertUsable();
      requireText(gameId, "game ID");
      const kinds = [...new Set(dependencyKinds)];
      if (kinds.length === 0) return 0;
      const placeholders = kinds.map(() => "?").join(",");
      const deleted = db.transaction(() => {
        statements.deleteActivation.run();
        return Number(
          db
            .query(
              `DELETE FROM judgments WHERE pair_domain=? AND (game_a=? OR game_b=?) AND dependency_kind IN (${placeholders})`,
            )
            .run(pairDomain, gameId, gameId, ...kinds).changes,
        );
      })();
      recordMutation();
      return deleted;
    },
    purgeDDependent() {
      assertUsable();
      const deleted = db.transaction(() => {
        statements.deleteActivation.run();
        return Number(
          db.query("DELETE FROM judgments WHERE dependency_kind IN ('D_ONLY','SHARED_CD')").run()
            .changes,
        );
      })();
      recordMutation();
      return deleted;
    },
    saveRunProgress(progress) {
      assertUsable();
      validateProgress(progress);
      writeProgress(progress);
    },
    checkpointPair(checkpoint) {
      assertUsable();
      if (!isRecord(checkpoint)) throw new Error("Invalid pair checkpoint");
      requireExactKeys(checkpoint, ["judgments", "progress"], "pair checkpoint");
      const { judgments, progress } = checkpoint;
      if (!Array.isArray(judgments) || (judgments.length !== 1 && judgments.length !== 2))
        throw new Error("A checkpoint requires one or two judgments");
      // Validate the entire bounded operation before opening its transaction.
      judgments.forEach(validate);
      const first = judgments[0];
      if (!first) throw new Error("A checkpoint requires at least one judgment");
      const pair = canonicalPair(first.gameAId, first.gameBId);
      const pairDomain = first.pairDomain === undefined ? "collection" : first.pairDomain;
      if (
        judgments.some((judgment) => {
          const otherPair = canonicalPair(judgment.gameAId, judgment.gameBId);
          return (
            otherPair[0] !== pair[0] ||
            otherPair[1] !== pair[1] ||
            (judgment.pairDomain === undefined ? "collection" : judgment.pairDomain) !==
              pairDomain ||
            judgment.collectionId !== first.collectionId
          );
        })
      )
        throw new Error("Checkpoint judgments must identify the same domain, collection, and pair");
      if (judgments.length === 2 && judgments[0]?.signal === judgments[1]?.signal)
        throw new Error("Checkpoint judgments must have distinct signals");
      validateProgress(progress);
      db.transaction(() => {
        judgments.forEach(writeJudgment);
        writeProgress(progress);
      })();
      recordMutation();
    },
    finishRun(finish) {
      assertUsable();
      if (!isRecord(finish)) throw new Error("Invalid run finish");
      requireExactKeys(finish, ["activation", "progress"], "run finish");
      const { activation, progress } = finish;
      validateProgress(progress);
      if (progress.state === "running") throw new Error("Run finish requires terminal progress");
      if (activation !== null) validateActivation(activation);
      db.transaction(() => {
        if (activation !== null)
          statements.setActivation.run(activation.identity, activation.activatedAt);
        writeProgress(progress);
      })();
      if (activation !== null) recordMutation();
    },
    getRunProgress() {
      const result = readProgress();
      return result.status === "available" ? result.progress : null;
    },
    getRunProgressRead() {
      return readProgress();
    },
    setActivation(activation) {
      assertUsable();
      if (activation === null) {
        statements.deleteActivation.run();
        recordMutation();
      } else {
        requireExactKeys(activation, ["identity", "activatedAt"], "activation");
        requireText(activation.identity, "activation identity");
        requireText(activation.activatedAt, "activation timestamp");
        statements.setActivation.run(activation.identity, activation.activatedAt);
        recordMutation();
      }
    },
    getActivation() {
      if (!usable()) return null;
      try {
        return statements.getActivation.get() ?? null;
      } catch {
        return null;
      }
    },
    compact() {
      if (usable()) {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;");
      }
    },
    reset() {
      if (usable()) {
        db.transaction(() => {
          db.exec("DELETE FROM judgments; DELETE FROM run_progress; DELETE FROM activation;");
        })();
        recordMutation();
      }
    },
    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
  };
}
