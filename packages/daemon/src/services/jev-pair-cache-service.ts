import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";

export type JevSignal = "C" | "D";
export type JevDependencyKind = "C_ONLY" | "D_ONLY" | "SHARED_CD";

export interface JevPairJudgment {
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
}

export interface JevRunProgress {
  runId: string;
  state: "running" | "completed" | "interrupted" | "failed";
  pairCount: number;
  completedPairs: number;
  cacheHits: number;
  cacheMisses: number;
  failedPairs: number;
  updatedAt: string;
}

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
  purgePair(gameAId: string, gameBId: string, signal?: JevSignal): number;
  purgeGame(gameId: string, signal?: JevSignal, dependencyKind?: JevDependencyKind): number;
  invalidateGame(gameId: string, dependencyKinds: readonly JevDependencyKind[]): number;
  purgeDDependent(): number;
  saveRunProgress(progress: JevRunProgress): void;
  checkpointPair(checkpoint: JevPairCheckpoint): void;
  finishRun(finish: JevRunFinish): void;
  getRunProgress(): JevRunProgress | null;
  setActivation(activation: JevAdvisoryActivation | null): void;
  getActivation(): JevAdvisoryActivation | null;
  compact(): void;
  reset(): void;
  close(): void;
}

const DATABASE_FILENAME = "jev-pair-cache.sqlite";
const SCHEMA_VERSION = 2;

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
      "updatedAt",
    ],
    "run progress",
  );
  if (!["running", "completed", "interrupted", "failed"].includes(progress.state))
    throw new Error("Invalid run state");
  for (const n of [
    progress.pairCount,
    progress.completedPairs,
    progress.cacheHits,
    progress.cacheMisses,
    progress.failedPairs,
  ])
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid progress counter");
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

function prepareStatements(db: Database) {
  return {
    get: db.query<JudgmentRow, [string, string, JevSignal]>(
      "SELECT * FROM judgments WHERE game_a=? AND game_b=? AND signal=?",
    ),
    upsert: db.query(
      "INSERT OR REPLACE INTO judgments (game_a,game_b,signal,collection_id,consent_epoch,dependency_kind,value,confidence,model_id,rubric_version,question_version,request_schema_version,score_mapping_version,semantic_policy_id,completed_at,dependencies_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ),
    deletePairSignal: db.query("DELETE FROM judgments WHERE game_a=? AND game_b=? AND signal=?"),
    deletePair: db.query("DELETE FROM judgments WHERE game_a=? AND game_b=?"),
    saveRunProgress: db.query("INSERT OR REPLACE INTO run_progress VALUES (1,?,?,?,?,?,?,?,?)"),
    getRunProgress: db.query<JevRunProgress, []>(
      "SELECT run_id as runId,state,pair_count as pairCount,completed_pairs as completedPairs,cache_hits as cacheHits,cache_misses as cacheMisses,failed_pairs as failedPairs,updated_at as updatedAt FROM run_progress WHERE singleton=1",
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
          game_a TEXT NOT NULL, game_b TEXT NOT NULL, signal TEXT NOT NULL CHECK(signal IN ('C','D')),
          collection_id TEXT NOT NULL, consent_epoch TEXT,
          dependency_kind TEXT NOT NULL CHECK(dependency_kind IN ('C_ONLY','D_ONLY','SHARED_CD')),
          value REAL NOT NULL CHECK(value >= 0 AND value <= 1), confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
          model_id TEXT NOT NULL, rubric_version TEXT NOT NULL, question_version TEXT NOT NULL,
          request_schema_version TEXT NOT NULL, score_mapping_version TEXT NOT NULL, semantic_policy_id TEXT NOT NULL,
          completed_at TEXT NOT NULL, dependencies_json TEXT NOT NULL, PRIMARY KEY(game_a, game_b, signal), CHECK(game_a < game_b)
        );
        CREATE TABLE run_progress (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1), run_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('running','completed','interrupted','failed')),
          pair_count INTEGER NOT NULL, completed_pairs INTEGER NOT NULL, cache_hits INTEGER NOT NULL,
          cache_misses INTEGER NOT NULL, failed_pairs INTEGER NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE activation (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), identity TEXT NOT NULL, activated_at TEXT NOT NULL);
        PRAGMA user_version = 2;
        COMMIT;`);
    } else if (version < 2) {
      // Earlier cache rows lack collection/consent fences and cannot be proven reusable.
      db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE judgments ADD COLUMN collection_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE judgments ADD COLUMN consent_epoch TEXT;
        DELETE FROM judgments;
        DELETE FROM activation;
        PRAGMA user_version = 2;
        COMMIT;`);
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
  const usable = (): boolean => !closed;
  const recordMutation = (): void => {
    revision = revision === null || revision >= Number.MAX_SAFE_INTEGER ? null : revision + 1;
  };
  const assertUsable = (): void => {
    if (!usable()) throw new Error("Jev pair cache closed");
  };
  const writeJudgment = (judgment: JevPairJudgment): void => {
    const [a, b] = canonicalPair(judgment.gameAId, judgment.gameBId);
    statements?.upsert.run(
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
      progress.updatedAt,
    );
  };
  return {
    available: true,
    mutationRevision() {
      return usable() ? revision : null;
    },
    lookup(key) {
      if (!usable()) return null;
      try {
        const [a, b] = canonicalPair(key.gameAId, key.gameBId);
        const row = statements.get.get(a, b, key.signal);
        if (!row) return null;
        const dependencies: unknown = JSON.parse(row.dependencies_json);
        if (!Array.isArray(dependencies)) return null;
        const judgment: JevPairJudgment = {
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
    },
    upsert(judgment) {
      assertUsable();
      validate(judgment);
      writeJudgment(judgment);
      recordMutation();
    },
    purgePair(left, right, signal) {
      assertUsable();
      const [a, b] = canonicalPair(left, right);
      const deleted = db.transaction(() => {
        statements.deleteActivation.run();
        return Number(
          (signal ? statements.deletePairSignal.run(a, b, signal) : statements.deletePair.run(a, b))
            .changes,
        );
      })();
      recordMutation();
      return deleted;
    },
    purgeGame(gameId, signal, dependencyKind) {
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
              `DELETE FROM judgments WHERE (game_a=? OR game_b=?) AND dependency_kind IN (${placeholders})${signal ? " AND signal=?" : ""}`,
            )
            .run(gameId, gameId, ...selected, ...(signal ? [signal] : [])).changes,
        );
      })();
      recordMutation();
      return deleted;
    },
    invalidateGame(gameId, dependencyKinds) {
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
              `DELETE FROM judgments WHERE (game_a=? OR game_b=?) AND dependency_kind IN (${placeholders})`,
            )
            .run(gameId, gameId, ...kinds).changes,
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
      if (
        judgments.some((judgment) => {
          const otherPair = canonicalPair(judgment.gameAId, judgment.gameBId);
          return otherPair[0] !== pair[0] || otherPair[1] !== pair[1];
        })
      )
        throw new Error("Checkpoint judgments must identify the same unordered pair");
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
      if (!usable()) return null;
      try {
        return statements.getRunProgress.get() ?? null;
      } catch {
        return null;
      }
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
