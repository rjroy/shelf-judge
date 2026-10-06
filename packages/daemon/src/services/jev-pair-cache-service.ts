import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import type { JevRunPublication, JevRunStopReason } from "@shelf-judge/shared";
export type { JevRunStopReason } from "@shelf-judge/shared";
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
  /** Absent for pre-v5 historical rows whose run scope is unknown. */
  scope?: "collection" | "wishlist";
  pairCount: number;
  completedPairs: number;
  cacheHits: number;
  cacheMisses: number;
  failedPairs: number;
  stopReason?: JevRunStopReason;
  publication?: JevRunPublication;
  updatedAt: string;
}

export type JevRunProgressRead =
  | { status: "available"; progress: JevRunProgress }
  | { status: "none" | "invalid" | "unavailable" };

export interface JevAdvisoryActivation {
  identity: string;
  activatedAt: string;
}

export interface JevPairCheckpoint {
  judgments: [JevPairJudgment] | [JevPairJudgment, JevPairJudgment];
  progress: JevRunProgress;
}

export interface JevRunBatch {
  runId: string;
  state: "active" | "sealed";
  progress: JevRunProgress;
  stagingRevision: number;
}

export interface JevStagedSnapshot {
  runId: string;
  revision: number;
  judgments: JevPairJudgment[];
}

export interface JevRunPromotionResult {
  status: "published" | "unchanged" | "already-published";
  publicationToken: string;
  progress: JevRunProgress;
}

export interface JevPairCache {
  readonly available: boolean;
  mutationRevision(): number | null;
  /** Durable fence for changes to the ordinary published evidence view. */
  publicationToken?(): string | null;
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
  /** Indexed rows for one typed candidate member; never enumerates the cache. */
  candidateCOnlyPairs(candidateMemberId: string): JevPairJudgment[];
  /** Atomically rekeys proven rows and purges the remaining rows for this candidate. */
  finalizeCandidateAcquisition(
    candidateMemberId: string,
    transfers: readonly {
      candidateKey: JevPairKey;
      ownedLocalGameIds: readonly [string, string];
    }[],
  ): number;
  purgeDDependent(): number;
  saveRunProgress(progress: JevRunProgress): void;
  /** Persist pending publication details only while the matching sealed batch still owns progress. */
  saveSealedRunProgressIfOwned?(progress: JevRunProgress): boolean;
  /** Reserve the single durable batch slot before execution. */
  reserveRunBatch?(progress: JevRunProgress): void;
  /** Atomically checkpoint numeric evidence and progress to the owned staging delta. */
  checkpointStagedPair?(checkpoint: JevPairCheckpoint): void;
  /** Published-first, run-owned overlay lookup for workers only. */
  lookupForRun?(runId: string, key: JevPairKey): JevPairJudgment | null;
  /** Indexed, run-bounded snapshot for source/permission validation outside SQLite transactions. */
  stagedSnapshot?(runId: string): JevStagedSnapshot | null;
  getRunBatch?(): JevRunBatch | null;
  /** Durably seals execution outcome. Subsequent checkpoints are rejected. */
  sealRunBatch?(progress: JevRunProgress): void;
  /** Promote only exact rows selected by the caller's source/permission validator. */
  promoteRunBatch?(input: {
    runId: string;
    expectedStagingRevision: number;
    eligibleJudgments: readonly JevPairJudgment[];
    progress: JevRunProgress;
  }): JevRunPromotionResult;
  getRunProgress(): JevRunProgress | null;
  getRunProgressRead(): JevRunProgressRead;
  setActivation(activation: JevAdvisoryActivation | null): void;
  getActivation(): JevAdvisoryActivation | null;
  compact(): void;
  reset(): void;
  close(): void;
}

const DATABASE_FILENAME = "jev-pair-cache.sqlite";
const SCHEMA_VERSION = 7;

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

function validateProgress(progress: unknown): asserts progress is JevRunProgress {
  if (!isRecord(progress)) throw new Error("Invalid run progress");
  requireExactKeys(
    progress,
    [
      "runId",
      "state",
      "scope",
      "pairCount",
      "completedPairs",
      "cacheHits",
      "cacheMisses",
      "failedPairs",
      "stopReason",
      "publication",
      "updatedAt",
    ],
    "run progress",
  );
  if (
    progress.state !== "running" &&
    progress.state !== "completed" &&
    progress.state !== "interrupted" &&
    progress.state !== "failed"
  )
    throw new Error("Invalid run state");
  if (
    progress.scope !== undefined &&
    progress.scope !== "collection" &&
    progress.scope !== "wishlist"
  )
    throw new Error("Invalid run scope");
  if (Object.hasOwn(progress, "stopReason")) {
    if (
      ![
        "provider-limit",
        "provider-unconfigured",
        "application-attempt-limit",
        "application-token-threshold",
        "application-deadline",
        "owner-cancelled",
      ].some((reason) => reason === progress.stopReason) ||
      (progress.stopReason === "owner-cancelled"
        ? progress.state !== "interrupted"
        : progress.state !== "failed")
    )
      throw new Error("Invalid run stop reason");
  }
  const counters = [
    progress.pairCount,
    progress.completedPairs,
    progress.cacheHits,
    progress.cacheMisses,
    progress.failedPairs,
  ];
  if (
    counters.some(
      (value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0,
    ) ||
    typeof progress.pairCount !== "number" ||
    typeof progress.completedPairs !== "number" ||
    typeof progress.cacheHits !== "number" ||
    typeof progress.cacheMisses !== "number" ||
    typeof progress.failedPairs !== "number"
  )
    throw new Error("Invalid progress counter");
  if (progress.completedPairs > progress.pairCount) throw new Error("Invalid completed pair count");
  if (typeof progress.runId !== "string" || typeof progress.updatedAt !== "string")
    throw new Error("Invalid run progress identity");
  requireText(progress.runId, "run ID");
  requireText(progress.updatedAt, "updatedAt");
  if (progress.publication !== undefined) {
    const publication = progress.publication;
    if (!isRecord(publication)) throw new Error("Invalid publication outcome");
    requireExactKeys(
      publication,
      ["state", "phase", "outcomePersistence", "reason"],
      "publication outcome",
    );
    if (
      publication.state !== "published" &&
      publication.state !== "unchanged" &&
      publication.state !== "pending"
    )
      throw new Error("Invalid publication state");
    if (
      publication.phase !== undefined &&
      publication.phase !== "seal" &&
      publication.phase !== "validate" &&
      publication.phase !== "promote"
    )
      throw new Error("Invalid publication phase");
    if (
      publication.outcomePersistence !== "sealed" &&
      publication.outcomePersistence !== "finalized" &&
      publication.outcomePersistence !== "unpersisted"
    )
      throw new Error("Invalid publication persistence state");
    if (publication.reason !== undefined) {
      if (typeof publication.reason !== "string") throw new Error("Invalid publication reason");
      requireText(publication.reason, "publication reason");
    }
    if (publication.state === "pending" && !publication.phase)
      throw new Error("Pending publication requires a phase");
  }
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

type StagedJudgmentRow = JudgmentRow & { run_id: string };
type RunBatchRow = {
  runId: string;
  state: "active" | "sealed";
  progressJson: string;
  stagingRevision: number;
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

type RunProgressRow = Omit<JevRunProgress, "stopReason" | "scope" | "publication"> & {
  stopReason: string | null;
  scope: string | null;
  publicationJson: string | null;
};

function prepareStatements(db: Database) {
  return {
    get: db.query<JudgmentRow, [JevPairDomain, string, string, JevSignal]>(
      "SELECT * FROM judgments WHERE pair_domain=? AND game_a=? AND game_b=? AND signal=?",
    ),
    candidateRowsByMember: db.query<JudgmentRow, [string, string]>(
      "SELECT * FROM judgments WHERE pair_domain='wishlist-candidate' AND signal='C' AND (game_a=? OR game_b=?)",
    ),
    upsert: db.query(
      "INSERT OR REPLACE INTO judgments (pair_domain,game_a,game_b,signal,collection_id,consent_epoch,dependency_kind,value,confidence,model_id,rubric_version,question_version,request_schema_version,score_mapping_version,semantic_policy_id,completed_at,dependencies_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ),
    deletePairSignal: db.query(
      "DELETE FROM judgments WHERE pair_domain=? AND game_a=? AND game_b=? AND signal=?",
    ),
    deletePair: db.query("DELETE FROM judgments WHERE pair_domain=? AND game_a=? AND game_b=?"),
    stagedGet: db.query<StagedJudgmentRow, [string, JevPairDomain, string, string, JevSignal]>(
      "SELECT * FROM staged_judgments WHERE run_id=? AND pair_domain=? AND game_a=? AND game_b=? AND signal=?",
    ),
    stagedByRun: db.query<StagedJudgmentRow, [string]>(
      "SELECT * FROM staged_judgments WHERE run_id=? ORDER BY pair_domain,game_a,game_b,signal",
    ),
    stagedUpsert: db.query(
      "INSERT OR REPLACE INTO staged_judgments (run_id,pair_domain,game_a,game_b,signal,collection_id,consent_epoch,dependency_kind,value,confidence,model_id,rubric_version,question_version,request_schema_version,score_mapping_version,semantic_policy_id,completed_at,dependencies_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ),
    stagedDeleteRun: db.query("DELETE FROM staged_judgments WHERE run_id=?"),
    stagedDeletePair: db.query(
      "DELETE FROM staged_judgments WHERE pair_domain=? AND game_a=? AND game_b=?",
    ),
    getRunBatch: db.query<RunBatchRow, []>(
      "SELECT run_id as runId,state,progress_json as progressJson,staging_revision as stagingRevision FROM run_batch WHERE singleton=1",
    ),
    reserveRunBatch: db.query(
      "INSERT INTO run_batch (singleton,run_id,state,progress_json,staging_revision) VALUES (1,?,'active',?,0)",
    ),
    updateRunBatch: db.query(
      "UPDATE run_batch SET state=?,progress_json=?,staging_revision=? WHERE singleton=1 AND run_id=? AND state=?",
    ),
    bumpRunBatchRevision: db.query(
      "UPDATE run_batch SET staging_revision=staging_revision+1 WHERE singleton=1",
    ),
    deleteRunBatch: db.query("DELETE FROM run_batch WHERE singleton=1 AND run_id=?"),
    getPublicationState: db.query<{ token: string; lastRunId: string | null }, []>(
      "SELECT token,last_run_id as lastRunId FROM publication_state WHERE singleton=1",
    ),
    setPublicationState: db.query(
      "UPDATE publication_state SET token=?,last_run_id=? WHERE singleton=1",
    ),
    saveRunProgress: db.query(
      "INSERT OR REPLACE INTO run_progress (singleton,run_id,state,scope_kind,pair_count,completed_pairs,cache_hits,cache_misses,failed_pairs,stop_reason,publication_json,updated_at) VALUES (1,?,?,?,?,?,?,?,?,?,?,?)",
    ),
    getRunProgress: db.query<RunProgressRow, []>(
      "SELECT run_id as runId,state,scope_kind as scope,pair_count as pairCount,completed_pairs as completedPairs,cache_hits as cacheHits,cache_misses as cacheMisses,failed_pairs as failedPairs,stop_reason as stopReason,publication_json as publicationJson,updated_at as updatedAt FROM run_progress WHERE singleton=1",
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
    publicationToken: () => null,
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
    candidateCOnlyPairs: () => {
      throw new Error("Jev pair cache unavailable");
    },
    finalizeCandidateAcquisition: () => {
      throw new Error("Jev pair cache unavailable");
    },
    purgeDDependent: () => {
      throw new Error("Jev pair cache unavailable");
    },
    saveRunProgress: () => {
      throw new Error("Jev pair cache unavailable");
    },
    saveSealedRunProgressIfOwned: () => false,
    reserveRunBatch: () => {
      throw new Error("Jev pair cache unavailable");
    },
    checkpointStagedPair: () => {
      throw new Error("Jev pair cache unavailable");
    },
    lookupForRun: () => null,
    stagedSnapshot: () => null,
    getRunBatch: () => null,
    sealRunBatch: () => {
      throw new Error("Jev pair cache unavailable");
    },
    promoteRunBatch: () => {
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
          scope_kind TEXT CHECK(scope_kind IS NULL OR scope_kind IN ('collection','wishlist')),
          pair_count INTEGER NOT NULL, completed_pairs INTEGER NOT NULL, cache_hits INTEGER NOT NULL,
          cache_misses INTEGER NOT NULL, failed_pairs INTEGER NOT NULL, stop_reason TEXT, publication_json TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE activation (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), identity TEXT NOT NULL, activated_at TEXT NOT NULL);
        CREATE TABLE staged_judgments (
          run_id TEXT NOT NULL,
          pair_domain TEXT NOT NULL CHECK(pair_domain IN ('collection','wishlist-candidate')),
          game_a TEXT NOT NULL, game_b TEXT NOT NULL, signal TEXT NOT NULL CHECK(signal IN ('C','D')),
          collection_id TEXT NOT NULL, consent_epoch TEXT,
          dependency_kind TEXT NOT NULL CHECK(dependency_kind IN ('C_ONLY','D_ONLY','SHARED_CD')),
          value REAL NOT NULL CHECK(value >= 0 AND value <= 1), confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
          model_id TEXT NOT NULL, rubric_version TEXT NOT NULL, question_version TEXT NOT NULL,
          request_schema_version TEXT NOT NULL, score_mapping_version TEXT NOT NULL, semantic_policy_id TEXT NOT NULL,
          completed_at TEXT NOT NULL, dependencies_json TEXT NOT NULL,
          PRIMARY KEY(run_id,pair_domain,game_a,game_b,signal), CHECK(game_a < game_b)
        );
        CREATE INDEX staged_judgments_run_order ON staged_judgments(run_id,pair_domain,game_a,game_b,signal);
        CREATE INDEX staged_judgments_member_a ON staged_judgments(pair_domain,game_a);
        CREATE INDEX staged_judgments_member_b ON staged_judgments(pair_domain,game_b);
        CREATE TABLE run_batch (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1), run_id TEXT NOT NULL UNIQUE,
          state TEXT NOT NULL CHECK(state IN ('active','sealed')), progress_json TEXT NOT NULL,
          staging_revision INTEGER NOT NULL CHECK(staging_revision>=0)
        );
        CREATE TABLE publication_state (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1), token TEXT NOT NULL, last_run_id TEXT
        );
        PRAGMA user_version = 7;
        `);
      db.query("INSERT INTO publication_state(singleton,token,last_run_id) VALUES (1,?,NULL)").run(
        randomUUID(),
      );
      db.exec("COMMIT;");
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
      if (version < 5) {
        db.exec(`BEGIN IMMEDIATE;
          ALTER TABLE run_progress ADD COLUMN scope_kind TEXT
            CHECK(scope_kind IS NULL OR scope_kind IN ('collection','wishlist'));
          PRAGMA user_version = 5;
          COMMIT;`);
      }
      if (version < 6) {
        db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE staged_judgments (
            run_id TEXT NOT NULL,
            pair_domain TEXT NOT NULL CHECK(pair_domain IN ('collection','wishlist-candidate')),
            game_a TEXT NOT NULL, game_b TEXT NOT NULL, signal TEXT NOT NULL CHECK(signal IN ('C','D')),
            collection_id TEXT NOT NULL, consent_epoch TEXT,
            dependency_kind TEXT NOT NULL CHECK(dependency_kind IN ('C_ONLY','D_ONLY','SHARED_CD')),
            value REAL NOT NULL CHECK(value >= 0 AND value <= 1), confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
            model_id TEXT NOT NULL, rubric_version TEXT NOT NULL, question_version TEXT NOT NULL,
            request_schema_version TEXT NOT NULL, score_mapping_version TEXT NOT NULL, semantic_policy_id TEXT NOT NULL,
            completed_at TEXT NOT NULL, dependencies_json TEXT NOT NULL,
            PRIMARY KEY(run_id,pair_domain,game_a,game_b,signal), CHECK(game_a < game_b)
          );
          CREATE INDEX staged_judgments_run_order ON staged_judgments(run_id,pair_domain,game_a,game_b,signal);
          CREATE INDEX staged_judgments_member_a ON staged_judgments(pair_domain,game_a);
          CREATE INDEX staged_judgments_member_b ON staged_judgments(pair_domain,game_b);
          CREATE TABLE run_batch (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), run_id TEXT NOT NULL UNIQUE,
            state TEXT NOT NULL CHECK(state IN ('active','sealed')), progress_json TEXT NOT NULL,
            staging_revision INTEGER NOT NULL CHECK(staging_revision>=0)
          );
          CREATE TABLE publication_state (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), token TEXT NOT NULL, last_run_id TEXT
          );
          PRAGMA user_version = 6;
          `);
        db.query(
          "INSERT INTO publication_state(singleton,token,last_run_id) VALUES (1,?,NULL)",
        ).run(randomUUID());
        db.exec("COMMIT;");
      }
      if (version < 7) {
        db.exec(`BEGIN IMMEDIATE;
          ALTER TABLE run_progress ADD COLUMN publication_json TEXT;
          PRAGMA user_version=7;
          COMMIT;`);
      }
    }
    statements = prepareStatements(db);
    const publicationState = statements.getPublicationState.get();
    if (
      !publicationState ||
      typeof publicationState.token !== "string" ||
      !publicationState.token.trim()
    )
      throw new Error("Jev cache publication state is missing or invalid");
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
  const advancePublicationToken = (lastRunId?: string | null): string => {
    const token = randomUUID();
    const committedRunId =
      lastRunId === undefined
        ? (statements?.getPublicationState.get()?.lastRunId ?? null)
        : lastRunId;
    const update = statements?.setPublicationState.run(token, committedRunId);
    if (update?.changes !== 1) throw new Error("Jev cache publication state is unavailable");
    return token;
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
  const writeStagedJudgment = (runId: string, judgment: JevPairJudgment): void => {
    const [a, b] = canonicalPair(judgment.gameAId, judgment.gameBId);
    statements?.stagedUpsert.run(
      runId,
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
      progress.scope ?? null,
      progress.pairCount,
      progress.completedPairs,
      progress.cacheHits,
      progress.cacheMisses,
      progress.failedPairs,
      progress.stopReason ?? null,
      progress.publication === undefined ? null : JSON.stringify(progress.publication),
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
        ...(row.scope === null ? {} : { scope: row.scope as JevRunProgress["scope"] }),
        pairCount: row.pairCount,
        completedPairs: row.completedPairs,
        cacheHits: row.cacheHits,
        cacheMisses: row.cacheMisses,
        failedPairs: row.failedPairs,
        ...(row.stopReason === null ? {} : { stopReason: row.stopReason as JevRunStopReason }),
        ...(row.publicationJson === null
          ? {}
          : { publication: JSON.parse(row.publicationJson) as JevRunPublication }),
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
    publicationToken() {
      if (!usable()) return null;
      try {
        return statements.getPublicationState.get()?.token ?? null;
      } catch {
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
      db.transaction(() => {
        writeJudgment(judgment);
        advancePublicationToken();
      })();
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
        const stagedDeleted = statements.stagedDeletePair.run(
          "wishlist-candidate",
          sourcePair[0],
          sourcePair[1],
        ).changes;
        if (stagedDeleted > 0) statements.bumpRunBatchRevision.run();
        advancePublicationToken();
      })();
      recordMutation();
      return true;
    },
    candidateCOnlyPairs(candidateMemberId) {
      assertUsable();
      requireText(candidateMemberId, "candidate member ID");
      const parsed = parseWishlistCandidateMember(candidateMemberId);
      if (parsed?.kind !== "wishlist-bgg") throw new Error("Invalid candidate member ID");
      return statements.candidateRowsByMember
        .all(candidateMemberId, candidateMemberId)
        .flatMap((row) => {
          const judgment = projectJudgmentRow(row);
          return judgment?.dependencyKind === "C_ONLY" ? [judgment] : [];
        });
    },
    finalizeCandidateAcquisition(candidateMemberId, transfers) {
      assertUsable();
      const candidateIdentity = parseWishlistCandidateMember(candidateMemberId);
      if (candidateIdentity?.kind !== "wishlist-bgg")
        throw new Error("Invalid candidate member ID");
      const planned: Array<{
        sourcePair: [string, string];
        sourceIdentity: string;
        target: JevPairJudgment;
      }> = [];
      for (const transfer of transfers) {
        const { candidateKey, ownedLocalGameIds } = transfer;
        if (candidateKey.pairDomain !== "wishlist-candidate" || candidateKey.signal !== "C")
          throw new Error("Candidate transfer requires wishlist-candidate domain");
        if (
          !Array.isArray(ownedLocalGameIds) ||
          ownedLocalGameIds.length !== 2 ||
          ownedLocalGameIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 2048)
        )
          throw new Error("Candidate transfer requires two owned local IDs");
        const sourcePair = canonicalPair(candidateKey.gameAId, candidateKey.gameBId);
        const sourceRow = statements.get.get(
          "wishlist-candidate",
          sourcePair[0],
          sourcePair[1],
          "C",
        );
        if (!sourceRow) continue;
        const source = projectJudgmentRow(sourceRow);
        if (!source || source.dependencyKind !== "C_ONLY")
          throw new Error("Only valid candidate C_ONLY rows can be transferred");
        const members = [source.gameAId, source.gameBId].map(parseWishlistCandidateMember);
        const candidate = members.find((member) => member?.kind === "wishlist-bgg");
        const priorOwned = members.find((member) => member?.kind === "owned-local");
        if (
          !candidate ||
          candidate.kind !== "wishlist-bgg" ||
          !priorOwned ||
          priorOwned.kind !== "owned-local" ||
          (source.gameAId !== candidateMemberId && source.gameBId !== candidateMemberId) ||
          candidate.collectionId !== source.collectionId ||
          priorOwned.collectionId !== source.collectionId ||
          ownedLocalGameIds[1] !== priorOwned.localGameId
        )
          throw new Error("Candidate cache pair does not match acquisition transfer");
        const [acquiredId, priorOwnedId] = ownedLocalGameIds;
        const [gameAId, gameBId] = canonicalPair(acquiredId, priorOwnedId);
        const candidateRawId =
          source.gameAId === candidateMemberId ? source.gameAId : source.gameBId;
        const ownedRawId = source.gameAId === candidateMemberId ? source.gameBId : source.gameAId;
        const target: JevPairJudgment = {
          collectionId: source.collectionId,
          gameAId,
          gameBId,
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
                dependency.gameId === candidateRawId
                  ? acquiredId
                  : dependency.gameId === ownedRawId
                    ? priorOwnedId
                    : dependency.gameId,
            }))
            .sort((left, right) => compareStableIds(left.gameId, right.gameId)),
        };
        validate(target);
        const existing = statements.get.get("collection", gameAId, gameBId, "C");
        const existingJudgment = existing ? projectJudgmentRow(existing) : null;
        if (existing && !existingJudgment) throw new Error("Existing owned cache row is invalid");
        if (
          existingJudgment &&
          canonicalJudgmentContent(existingJudgment) !== canonicalJudgmentContent(target)
        )
          throw new Error("Conflicting owned cache row prevents candidate transfer");
        planned.push({ sourcePair, sourceIdentity: canonicalJudgmentContent(source), target });
      }
      const result = db.transaction(() => {
        let count = 0;
        for (const { sourcePair, sourceIdentity, target } of planned) {
          const currentSourceRow = statements.get.get(
            "wishlist-candidate",
            sourcePair[0],
            sourcePair[1],
            "C",
          );
          const currentSource = currentSourceRow ? projectJudgmentRow(currentSourceRow) : null;
          if (!currentSource || canonicalJudgmentContent(currentSource) !== sourceIdentity)
            throw new Error("Candidate cache row changed during acquisition transfer");
          const existingRow = statements.get.get("collection", target.gameAId, target.gameBId, "C");
          const existing = existingRow ? projectJudgmentRow(existingRow) : null;
          if (existingRow && !existing) throw new Error("Existing owned cache row is invalid");
          if (existing && canonicalJudgmentContent(existing) !== canonicalJudgmentContent(target))
            throw new Error("Conflicting owned cache row prevents candidate transfer");
          if (!existing) writeJudgment(target);
          count += Number(
            statements.deletePairSignal.run("wishlist-candidate", sourcePair[0], sourcePair[1], "C")
              .changes,
          );
        }
        count += Number(
          db
            .query(
              "DELETE FROM judgments WHERE pair_domain='wishlist-candidate' AND (game_a=? OR game_b=?)",
            )
            .run(candidateMemberId, candidateMemberId).changes,
        );
        const stagedChanged = Number(
          db
            .query(
              "DELETE FROM staged_judgments WHERE pair_domain='wishlist-candidate' AND (game_a=? OR game_b=?)",
            )
            .run(candidateMemberId, candidateMemberId).changes,
        );
        if (stagedChanged > 0) statements.bumpRunBatchRevision.run();
        if (count > 0 || stagedChanged > 0) advancePublicationToken();
        return { changed: count, stagedChanged };
      })();
      if (result.changed > 0 || result.stagedChanged > 0) {
        recordMutation();
      }
      return result.changed;
    },
    purgePair(left, right, signal, pairDomain = "collection") {
      assertUsable();
      const [a, b] = canonicalPair(left, right);
      const deleted = db.transaction(() => {
        statements.deleteActivation.run();
        const staged = statements.stagedDeletePair.run(pairDomain, a, b).changes;
        if (staged > 0) statements.bumpRunBatchRevision.run();
        const published = Number(
          (signal
            ? statements.deletePairSignal.run(pairDomain, a, b, signal)
            : statements.deletePair.run(pairDomain, a, b)
          ).changes,
        );
        if (published > 0 || staged > 0) advancePublicationToken();
        return { published, staged };
      })();
      recordMutation();
      return deleted.published;
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
        const predicate = `pair_domain=? AND (game_a=? OR game_b=?) AND dependency_kind IN (${placeholders})${signal ? " AND signal=?" : ""}`;
        const params = [pairDomain, gameId, gameId, ...selected, ...(signal ? [signal] : [])];
        const staged = Number(
          db.query(`DELETE FROM staged_judgments WHERE ${predicate}`).run(...params).changes,
        );
        if (staged > 0) statements.bumpRunBatchRevision.run();
        const published = Number(
          db
            .query(
              `DELETE FROM judgments WHERE pair_domain=? AND (game_a=? OR game_b=?) AND dependency_kind IN (${placeholders})${signal ? " AND signal=?" : ""}`,
            )
            .run(...params).changes,
        );
        if (published > 0 || staged > 0) advancePublicationToken();
        return { published, staged };
      })();
      recordMutation();
      return deleted.published;
    },
    invalidateGame(gameId, dependencyKinds, pairDomain = "collection") {
      assertUsable();
      requireText(gameId, "game ID");
      const kinds = [...new Set(dependencyKinds)];
      if (kinds.length === 0) return 0;
      const placeholders = kinds.map(() => "?").join(",");
      const deleted = db.transaction(() => {
        statements.deleteActivation.run();
        const predicate = `pair_domain=? AND (game_a=? OR game_b=?) AND dependency_kind IN (${placeholders})`;
        const params = [pairDomain, gameId, gameId, ...kinds];
        const staged = Number(
          db.query(`DELETE FROM staged_judgments WHERE ${predicate}`).run(...params).changes,
        );
        if (staged > 0) statements.bumpRunBatchRevision.run();
        const published = Number(
          db
            .query(
              `DELETE FROM judgments WHERE pair_domain=? AND (game_a=? OR game_b=?) AND dependency_kind IN (${placeholders})`,
            )
            .run(...params).changes,
        );
        if (published > 0 || staged > 0) advancePublicationToken();
        return { published, staged };
      })();
      recordMutation();
      return deleted.published;
    },
    purgeDDependent() {
      assertUsable();
      const deleted = db.transaction(() => {
        statements.deleteActivation.run();
        const staged = Number(
          db
            .query("DELETE FROM staged_judgments WHERE dependency_kind IN ('D_ONLY','SHARED_CD')")
            .run().changes,
        );
        if (staged > 0) statements.bumpRunBatchRevision.run();
        const published = Number(
          db.query("DELETE FROM judgments WHERE dependency_kind IN ('D_ONLY','SHARED_CD')").run()
            .changes,
        );
        if (published > 0 || staged > 0) advancePublicationToken();
        return { published, staged };
      })();
      recordMutation();
      return deleted.published;
    },
    saveRunProgress(progress) {
      assertUsable();
      validateProgress(progress);
      writeProgress(progress);
    },
    saveSealedRunProgressIfOwned(progress) {
      assertUsable();
      validateProgress(progress);
      if (progress.state === "running" || progress.publication?.state !== "pending")
        throw new Error("Owned sealed progress must describe pending terminal publication");
      return db.transaction(() => {
        const batch = statements.getRunBatch.get();
        if (!batch || batch.runId !== progress.runId || batch.state !== "sealed") return false;
        const sealedProgress: unknown = JSON.parse(batch.progressJson);
        validateProgress(sealedProgress);
        const sealedExecution = { ...sealedProgress };
        const pendingExecution = { ...progress };
        delete sealedExecution.publication;
        delete pendingExecution.publication;
        if (JSON.stringify(sealedExecution) !== JSON.stringify(pendingExecution)) return false;
        writeProgress(progress);
        return true;
      })();
    },
    reserveRunBatch(progress) {
      assertUsable();
      validateProgress(progress);
      if (progress.state !== "running")
        throw new Error("Run batch reservation requires running progress");
      db.transaction(() => {
        if (statements.getRunBatch.get()) throw new Error("A Jev run batch is already unresolved");
        statements.reserveRunBatch.run(progress.runId, JSON.stringify(progress));
        writeProgress(progress);
      })();
    },
    checkpointStagedPair(checkpoint) {
      assertUsable();
      if (!isRecord(checkpoint)) throw new Error("Invalid staged pair checkpoint");
      requireExactKeys(checkpoint, ["judgments", "progress"], "staged pair checkpoint");
      const { judgments, progress } = checkpoint;
      validateProgress(progress);
      if (progress.state !== "running")
        throw new Error("Staged checkpoint requires running progress");
      if (!Array.isArray(judgments) || (judgments.length !== 1 && judgments.length !== 2))
        throw new Error("A checkpoint requires one or two judgments");
      judgments.forEach(validate);
      const first = judgments[0];
      if (!first) throw new Error("A checkpoint requires at least one judgment");
      const pair = canonicalPair(first.gameAId, first.gameBId);
      const domain = first.pairDomain ?? "collection";
      if (
        judgments.some((judgment) => {
          const otherPair = canonicalPair(judgment.gameAId, judgment.gameBId);
          return (
            otherPair[0] !== pair[0] ||
            otherPair[1] !== pair[1] ||
            (judgment.pairDomain ?? "collection") !== domain ||
            judgment.collectionId !== first.collectionId
          );
        })
      )
        throw new Error("Checkpoint judgments must identify the same domain, collection, and pair");
      if (judgments.length === 2 && judgments[0]?.signal === judgments[1]?.signal)
        throw new Error("Checkpoint judgments must have distinct signals");
      db.transaction(() => {
        const batch = statements.getRunBatch.get();
        if (!batch || batch.runId !== progress.runId || batch.state !== "active")
          throw new Error("Run batch is not owned and active");
        judgments.forEach((judgment) => writeStagedJudgment(progress.runId, judgment));
        const nextRevision = batch.stagingRevision + 1;
        statements.updateRunBatch.run(
          "active",
          JSON.stringify(progress),
          nextRevision,
          progress.runId,
          "active",
        );
        writeProgress(progress);
      })();
    },
    lookupForRun(runId, key) {
      if (!usable()) return null;
      const pairDomain = key.pairDomain ?? "collection";
      let pair: [string, string];
      try {
        pair = canonicalPair(key.gameAId, key.gameBId);
      } catch {
        return null;
      }
      const batch = statements.getRunBatch.get();
      if (batch?.runId === runId) {
        const staged = statements.stagedGet.get(runId, pairDomain, pair[0], pair[1], key.signal);
        if (staged) return projectJudgmentRow(staged);
      }
      try {
        const row = statements.get.get(pairDomain, pair[0], pair[1], key.signal);
        return row ? projectJudgmentRow(row) : null;
      } catch {
        invalidateRevision();
        return null;
      }
    },
    stagedSnapshot(runId) {
      if (!usable()) return null;
      const batch = statements.getRunBatch.get();
      if (!batch || batch.runId !== runId) return null;
      return {
        runId,
        revision: batch.stagingRevision,
        judgments: statements.stagedByRun.all(runId).flatMap((row) => {
          const judgment = projectJudgmentRow(row);
          return judgment ? [judgment] : [];
        }),
      };
    },
    getRunBatch() {
      if (!usable()) return null;
      const batch = statements.getRunBatch.get();
      if (!batch) return null;
      try {
        const progress: unknown = JSON.parse(batch.progressJson);
        validateProgress(progress);
        return {
          runId: batch.runId,
          state: batch.state,
          progress,
          stagingRevision: batch.stagingRevision,
        };
      } catch {
        return null;
      }
    },
    sealRunBatch(progress) {
      assertUsable();
      validateProgress(progress);
      if (progress.state === "running")
        throw new Error("Run batch seal requires terminal progress");
      const durableOutcome = { ...progress };
      delete durableOutcome.publication;
      db.transaction(() => {
        const batch = statements.getRunBatch.get();
        if (!batch || batch.runId !== progress.runId)
          throw new Error("Run batch ownership mismatch");
        if (batch.state === "sealed") {
          if (batch.progressJson !== JSON.stringify(durableOutcome))
            throw new Error("Run batch already sealed differently");
          return;
        }
        statements.updateRunBatch.run(
          "sealed",
          JSON.stringify(durableOutcome),
          batch.stagingRevision,
          progress.runId,
          "active",
        );
        writeProgress({
          ...durableOutcome,
          publication: {
            state: "pending",
            phase: "validate",
            outcomePersistence: "sealed",
          },
        });
      })();
    },
    promoteRunBatch(input) {
      assertUsable();
      validateProgress(input.progress);
      if (input.progress.state === "running" || input.progress.runId !== input.runId)
        throw new Error("Promotion requires matching terminal progress");
      const result = db.transaction(() => {
        const publication = statements.getPublicationState.get();
        if (!publication || typeof publication.token !== "string" || !publication.token.trim())
          throw new Error("Jev cache publication state is unavailable");
        const batch = statements.getRunBatch.get();
        if (publication?.lastRunId === input.runId) {
          const storedProgress = readProgress();
          return {
            status: "already-published" as const,
            publicationToken: publication.token,
            progress:
              storedProgress.status === "available" ? storedProgress.progress : input.progress,
          };
        }
        if (!batch) {
          throw new Error("No unresolved run batch to promote");
        }
        if (batch.runId !== input.runId || batch.state !== "sealed")
          throw new Error("Run batch is not sealed and owned");
        if (batch.stagingRevision !== input.expectedStagingRevision)
          throw new Error("Staged judgments changed before promotion");
        if (batch.progressJson !== JSON.stringify(input.progress))
          throw new Error("Promotion outcome differs from durable seal");
        const eligible = new Map<string, JevPairJudgment>();
        for (const judgment of input.eligibleJudgments) {
          validate(judgment);
          const key = `${judgment.pairDomain ?? "collection"}\u0000${canonicalPair(judgment.gameAId, judgment.gameBId).join("\u0000")}\u0000${judgment.signal}`;
          if (eligible.has(key)) throw new Error("Duplicate eligible staged judgment");
          eligible.set(key, judgment);
        }
        for (const judgment of eligible.values()) {
          const [a, b] = canonicalPair(judgment.gameAId, judgment.gameBId);
          const row = statements.stagedGet.get(
            input.runId,
            judgment.pairDomain ?? "collection",
            a,
            b,
            judgment.signal,
          );
          const staged = row ? projectJudgmentRow(row) : null;
          if (!staged || canonicalJudgmentContent(staged) !== canonicalJudgmentContent(judgment))
            throw new Error("Eligible judgment is not the exact staged row");
        }
        let changed = false;
        for (const judgment of eligible.values()) {
          const [a, b] = canonicalPair(judgment.gameAId, judgment.gameBId);
          const existingRow = statements.get.get(
            judgment.pairDomain ?? "collection",
            a,
            b,
            judgment.signal,
          );
          const existing = existingRow ? projectJudgmentRow(existingRow) : null;
          if (existingRow && !existing) throw new Error("Existing published judgment is invalid");
          if (
            !existing ||
            canonicalJudgmentContent(existing) !== canonicalJudgmentContent(judgment)
          ) {
            writeJudgment(judgment);
            changed = true;
          }
        }
        statements.stagedDeleteRun.run(input.runId);
        statements.deleteRunBatch.run(input.runId);
        statements.deleteActivation.run();
        const terminalProgress: JevRunProgress = {
          ...input.progress,
          publication: {
            state: changed ? "published" : "unchanged",
            outcomePersistence: "finalized",
          },
        };
        writeProgress(terminalProgress);
        const token = changed ? randomUUID() : publication.token;
        const publicationUpdate = statements.setPublicationState.run(token, input.runId);
        if (publicationUpdate.changes !== 1)
          throw new Error("Jev cache publication state is unavailable");
        return {
          status: changed ? ("published" as const) : ("unchanged" as const),
          publicationToken: token,
          progress: terminalProgress,
        };
      })();
      if (result.status === "published") recordMutation();
      return result;
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
        db.transaction(() => {
          statements.deleteActivation.run();
          advancePublicationToken();
        })();
        recordMutation();
      } else {
        requireExactKeys(activation, ["identity", "activatedAt"], "activation");
        requireText(activation.identity, "activation identity");
        requireText(activation.activatedAt, "activation timestamp");
        db.transaction(() => {
          statements.setActivation.run(activation.identity, activation.activatedAt);
          advancePublicationToken();
        })();
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
          db.exec(
            "DELETE FROM judgments; DELETE FROM staged_judgments; DELETE FROM run_batch; DELETE FROM run_progress; DELETE FROM activation;",
          );
          advancePublicationToken(null);
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
