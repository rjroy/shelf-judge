import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJevPairCache,
  type JevPairCache,
  type JevPairJudgment,
  type JevRunProgress,
} from "../../src/services/jev-pair-cache-service.js";

const directories: string[] = [];
async function tempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "jev-staging-test-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function progress(state: JevRunProgress["state"] = "running"): JevRunProgress {
  return {
    runId: "run-staged",
    state,
    pairCount: 1,
    completedPairs: state === "completed" ? 1 : 0,
    cacheHits: 0,
    cacheMisses: 1,
    failedPairs: state === "failed" ? 1 : 0,
    ...(state === "failed" ? { stopReason: "application-attempt-limit" as const } : {}),
    updatedAt: "2026-10-05T12:00:00.000Z",
  };
}

function judgment(value = 0.7): JevPairJudgment {
  return {
    collectionId: "collection-1",
    gameAId: "game-a",
    gameBId: "game-b",
    signal: "C",
    dependencyKind: "C_ONLY",
    value,
    confidence: 0.8,
    modelId: "model-v1",
    rubricVersion: "rubric-v1",
    questionVersion: "question-v1",
    requestSchemaVersion: "schema-v1",
    scoreMappingVersion: "mapping-v1",
    semanticPolicyId: "policy-v1",
    completedAt: "2026-10-05T12:00:00.000Z",
    dependencies: ["game-a", "game-b"].map((gameId) => ({
      gameId,
      nameFingerprint: "a".repeat(64),
      descriptionFingerprint: "b".repeat(64),
    })),
  };
}

function candidateJudgment(): JevPairJudgment {
  const gameAId = '["wishlist-bgg","collection-1","123"]';
  const gameBId = '["owned-local","collection-1","local-b"]';
  return {
    pairDomain: "wishlist-candidate",
    collectionId: "collection-1",
    gameAId,
    gameBId,
    signal: "C",
    dependencyKind: "C_ONLY",
    value: 0.6,
    modelId: "model-v1",
    rubricVersion: "rubric-v1",
    questionVersion: "question-v1",
    requestSchemaVersion: "schema-v1",
    scoreMappingVersion: "mapping-v1",
    semanticPolicyId: "policy-v1",
    completedAt: "2026-10-05T12:00:00.000Z",
    dependencies: [gameAId, gameBId].map((gameId) => ({
      gameId,
      nameFingerprint: "a".repeat(64),
      descriptionFingerprint: "b".repeat(64),
    })),
  };
}

const key = { gameAId: "game-a", gameBId: "game-b", signal: "C" as const };

type StagingCache = JevPairCache &
  Required<
    Pick<
      JevPairCache,
      | "publicationToken"
      | "reserveRunBatch"
      | "checkpointStagedPair"
      | "lookupForRun"
      | "stagedSnapshot"
      | "getRunBatch"
      | "sealRunBatch"
      | "promoteRunBatch"
    >
  >;

function assertStagingApi(cache: JevPairCache): asserts cache is StagingCache {
  if (
    !cache.publicationToken ||
    !cache.reserveRunBatch ||
    !cache.checkpointStagedPair ||
    !cache.lookupForRun ||
    !cache.stagedSnapshot ||
    !cache.getRunBatch ||
    !cache.sealRunBatch ||
    !cache.promoteRunBatch
  ) {
    throw new Error("Cache does not implement the phase-1 staging API");
  }
}

function stagedRevision(cache: StagingCache, runId: string): number {
  const snapshot = cache.stagedSnapshot(runId);
  if (!snapshot) throw new Error(`No staged snapshot for ${runId}`);
  return snapshot.revision;
}

describe("Jev pair cache staging primitives", () => {
  test("keeps staging private to the run overlay and leaves published revision unchanged", async () => {
    const cache = await createJevPairCache(await tempDir());
    assertStagingApi(cache);
    const revision = cache.mutationRevision();
    const token = cache.publicationToken();
    cache.reserveRunBatch(progress());
    cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() });

    expect(cache.lookup(key)).toBeNull();
    expect(cache.lookupForRun("run-staged", key)).toEqual(judgment());
    expect(cache.lookupForRun("some-other-run", key)).toBeNull();
    expect(cache.mutationRevision()).toBe(revision);
    expect(cache.publicationToken()).toBe(token);
    expect(cache.stagedSnapshot("run-staged")).toMatchObject({
      revision: 1,
      judgments: [judgment()],
    });
    const dir = directories.at(-1);
    if (!dir) throw new Error("Test directory was not recorded");
    const db = new Database(join(dir, "jev-pair-cache.sqlite"), { readonly: true });
    const plan = db
      .query<
        { detail: string },
        [string, string, string, string, string]
      >("EXPLAIN QUERY PLAN SELECT * FROM staged_judgments WHERE run_id=? AND pair_domain=? AND game_a=? AND game_b=? AND signal=?")
      .all("run-staged", "collection", "game-a", "game-b", "C");
    expect(plan.some((step) => step.detail.includes("SEARCH staged_judgments"))).toBe(true);
    db.close();
    cache.close();
  });

  test("enforces durable owner and unsealed state at checkpoint and seal boundaries", async () => {
    const cache = await createJevPairCache(await tempDir());
    assertStagingApi(cache);
    expect(() =>
      cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() }),
    ).toThrow("Run batch is not owned and active");
    cache.reserveRunBatch(progress());
    expect(() => cache.reserveRunBatch(progress())).toThrow("already unresolved");
    cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() });
    const sealed = progress("failed");
    cache.sealRunBatch(sealed);
    expect(cache.getRunBatch()).toMatchObject({ state: "sealed", progress: sealed });
    expect(() =>
      cache.checkpointStagedPair({ judgments: [judgment(0.9)], progress: progress() }),
    ).toThrow("Run batch is not owned and active");
    cache.close();
  });

  test("writes pending terminal publication only for the exact still-sealed owner", async () => {
    const cache = await createJevPairCache(await tempDir());
    assertStagingApi(cache);
    const sealed = progress("failed");
    cache.reserveRunBatch(progress());
    cache.sealRunBatch(sealed);
    const pending = {
      ...sealed,
      publication: {
        state: "pending" as const,
        phase: "validate" as const,
        outcomePersistence: "sealed" as const,
        reason: "publication-pending",
      },
    };
    expect(cache.saveSealedRunProgressIfOwned?.(pending)).toBe(true);
    expect(cache.getRunProgress()).toEqual(pending);
    expect(cache.saveSealedRunProgressIfOwned?.({ ...pending, runId: "different-run" })).toBe(
      false,
    );
    expect(cache.saveSealedRunProgressIfOwned?.({ ...pending, completedPairs: 1 })).toBe(false);
    cache.reset();
    expect(cache.saveSealedRunProgressIfOwned?.(pending)).toBe(false);
    expect(cache.getRunProgress()).toBeNull();
    cache.close();
  });

  test("rolls back a failed atomic promotion and keeps sealed staging recoverable", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    assertStagingApi(cache);
    cache.reserveRunBatch(progress());
    cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() });
    const terminal = progress("completed");
    // Keep the sealed progress byte-for-byte consistent with the checkpointed data contract.
    const sealedProgress = { ...terminal, completedPairs: 0 };
    cache.sealRunBatch(sealedProgress);
    const revision = stagedRevision(cache, "run-staged");
    const token = cache.publicationToken();
    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    db.exec(
      "CREATE TRIGGER fail_promotion BEFORE INSERT ON judgments BEGIN SELECT RAISE(ABORT, 'promotion fault'); END;",
    );
    db.close();

    expect(() =>
      cache.promoteRunBatch({
        runId: "run-staged",
        expectedStagingRevision: revision,
        eligibleJudgments: [judgment()],
        progress: sealedProgress,
      }),
    ).toThrow("promotion fault");
    expect(cache.lookup(key)).toBeNull();
    expect(cache.stagedSnapshot("run-staged")?.judgments).toEqual([judgment()]);
    expect(cache.getRunBatch()).toMatchObject({ state: "sealed" });
    expect(cache.getRunProgress()).toEqual({
      ...sealedProgress,
      publication: { state: "pending", phase: "validate", outcomePersistence: "sealed" },
    });
    expect(cache.publicationToken()).toBe(token);
    cache.close();
  });

  test("rolls back sealing and terminal progress together on persistence failure", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    assertStagingApi(cache);
    cache.reserveRunBatch(progress());
    cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() });
    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    db.exec(
      "CREATE TRIGGER fail_terminal_progress BEFORE INSERT ON run_progress WHEN NEW.state!='running' BEGIN SELECT RAISE(ABORT, 'seal fault'); END;",
    );
    db.close();

    expect(() => cache.sealRunBatch({ ...progress("failed"), failedPairs: 0 })).toThrow(
      "seal fault",
    );
    expect(cache.getRunBatch()).toMatchObject({ state: "active", progress: progress() });
    expect(cache.getRunProgress()).toEqual(progress());
    expect(cache.stagedSnapshot("run-staged")?.judgments).toEqual([judgment()]);
    cache.close();
  });

  test("promotes once, replays idempotently, and persists the default published view on reopen", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    assertStagingApi(cache);
    cache.reserveRunBatch(progress());
    cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() });
    const sealed = { ...progress("completed"), completedPairs: 0 };
    cache.sealRunBatch(sealed);
    const revision = stagedRevision(cache, "run-staged");
    const beforeToken = cache.publicationToken();
    const promoted = cache.promoteRunBatch({
      runId: "run-staged",
      expectedStagingRevision: revision,
      eligibleJudgments: [judgment()],
      progress: sealed,
    });
    expect(promoted?.status).toBe("published");
    expect(promoted?.publicationToken).not.toBe(beforeToken);
    expect(cache.lookup(key)).toEqual(judgment());
    expect(cache.getRunBatch()).toBeNull();
    expect(cache.stagedSnapshot("run-staged")).toBeNull();
    expect(cache.getRunProgress()).toEqual({
      ...sealed,
      publication: { state: "published", outcomePersistence: "finalized" },
    });
    expect(cacheDatabaseRowCount(dir)).toBe(0);
    expect(
      cache.promoteRunBatch({
        runId: "run-staged",
        expectedStagingRevision: revision,
        eligibleJudgments: [judgment()],
        progress: sealed,
      }),
    ).toMatchObject({ status: "already-published", publicationToken: promoted?.publicationToken });
    cache.close();

    const reopened = await createJevPairCache(dir);
    assertStagingApi(reopened);
    expect(reopened.lookup(key)).toEqual(judgment());
    expect(reopened.publicationToken()).toBe(promoted?.publicationToken);
    expect(reopened.getRunBatch()).toBeNull();
    reopened.close();
  });

  test("no-op promotion retains token and only accepts rows exactly present in the sealed delta", async () => {
    const cache = await createJevPairCache(await tempDir());
    assertStagingApi(cache);
    cache.upsert(judgment());
    const beforeToken = cache.publicationToken();
    cache.reserveRunBatch(progress());
    cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() });
    const sealed = { ...progress("completed"), completedPairs: 0 };
    cache.sealRunBatch(sealed);
    const revision = stagedRevision(cache, "run-staged");
    expect(() =>
      cache.promoteRunBatch({
        runId: "run-staged",
        expectedStagingRevision: revision,
        eligibleJudgments: [judgment(0.1)],
        progress: sealed,
      }),
    ).toThrow("not the exact staged row");
    expect(
      cache.promoteRunBatch({
        runId: "run-staged",
        expectedStagingRevision: revision,
        eligibleJudgments: [judgment()],
        progress: sealed,
      }),
    ).toMatchObject({ status: "unchanged", publicationToken: beforeToken });
    cache.close();
  });

  test("purge fences populated staging so promotion cannot resurrect it", async () => {
    const cache = await createJevPairCache(await tempDir());
    assertStagingApi(cache);
    cache.reserveRunBatch(progress());
    cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() });
    expect(cache.purgeGame("game-a")).toBe(0);
    expect(cache.stagedSnapshot("run-staged")?.judgments).toEqual([]);
    const sealed = { ...progress("completed"), completedPairs: 0 };
    cache.sealRunBatch(sealed);
    expect(() =>
      cache.promoteRunBatch({
        runId: "run-staged",
        expectedStagingRevision: stagedRevision(cache, "run-staged"),
        eligibleJudgments: [judgment()],
        progress: sealed,
      }),
    ).toThrow("not the exact staged row");
    cache.close();
  });

  test("reset removes a populated staged batch and fences later promotion", async () => {
    const cache = await createJevPairCache(await tempDir());
    assertStagingApi(cache);
    cache.reserveRunBatch(progress());
    cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() });
    cache.reset();
    expect(cache.getRunBatch()).toBeNull();
    expect(cache.stagedSnapshot("run-staged")).toBeNull();
    expect(() =>
      cache.promoteRunBatch({
        runId: "run-staged",
        expectedStagingRevision: 1,
        eligibleJudgments: [judgment()],
        progress: { ...progress("completed"), completedPairs: 0 },
      }),
    ).toThrow("No unresolved run batch");
    expect(cache.lookup(key)).toBeNull();
    cache.close();
  });

  test("candidate transfer removes matching staged candidate evidence before any later promotion", async () => {
    const cache = await createJevPairCache(await tempDir());
    assertStagingApi(cache);
    const candidate = candidateJudgment();
    cache.upsert(candidate);
    cache.reserveRunBatch(progress());
    cache.checkpointStagedPair({ judgments: [candidate], progress: progress() });
    const candidateId = candidate.gameAId;
    const ownedId = candidate.gameBId;
    expect(
      cache.transferCandidateCOnlyPair(
        { pairDomain: "wishlist-candidate", gameAId: candidateId, gameBId: ownedId, signal: "C" },
        ["local-acquired", "local-b"],
      ),
    ).toBe(true);
    expect(cache.stagedSnapshot("run-staged")?.judgments).toEqual([]);
    expect(
      cache.lookupForRun("run-staged", {
        pairDomain: "wishlist-candidate",
        gameAId: candidateId,
        gameBId: ownedId,
        signal: "C",
      }),
    ).toBeNull();
    const sealed = { ...progress("completed"), completedPairs: 0 };
    cache.sealRunBatch(sealed);
    expect(
      cache.promoteRunBatch({
        runId: "run-staged",
        expectedStagingRevision: stagedRevision(cache, "run-staged"),
        eligibleJudgments: [],
        progress: sealed,
      }),
    ).toMatchObject({ status: "unchanged" });
    expect(
      cache.lookup({ gameAId: "local-acquired", gameBId: "local-b", signal: "C" }),
    ).toMatchObject({
      value: candidate.value,
    });
    cache.close();
  });

  test("external published writes during staging invalidate revision without exposing the overlay", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    assertStagingApi(cache);
    cache.reserveRunBatch(progress());
    cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() });
    const before = cache.mutationRevision();
    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    db.query(
      "INSERT INTO judgments VALUES ('collection','game-a','game-b','C','collection-1',NULL,'C_ONLY',0.4,0.8,'model-v1','rubric-v1','question-v1','schema-v1','mapping-v1','policy-v1','2026-10-05T12:00:00.000Z',?)",
    ).run(JSON.stringify(judgment().dependencies));
    db.close();
    expect(cache.mutationRevision()).not.toBe(before);
    expect(cache.lookup(key)).toMatchObject({ value: 0.4 });
    expect(cache.lookupForRun("run-staged", key)).toEqual(judgment());
    cache.close();
  });

  test("fresh schema commits publication metadata with v7 and rejects incomplete state on reopen", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    expect(cache.available).toBe(true);
    cache.close();

    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    const version = db
      .query<{ user_version: number }, []>("PRAGMA user_version")
      .get()?.user_version;
    const count = db
      .query<{ count: number }, []>("SELECT count(*) as count FROM publication_state")
      .get()?.count;
    expect(version).toBe(7);
    expect(count).toBe(1);
    db.exec("DELETE FROM publication_state");
    db.close();

    const incomplete = await createJevPairCache(dir);
    expect(incomplete.available).toBe(false);
    assertStagingApi(incomplete);
    expect(incomplete.publicationToken()).toBeNull();
    expect(() => incomplete.upsert(judgment())).toThrow("Jev pair cache unavailable");
    incomplete.close();
  });

  test("failed schema migration leaves its version uncommitted and promotion rolls back without metadata", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    assertStagingApi(cache);
    cache.reserveRunBatch(progress());
    cache.checkpointStagedPair({ judgments: [judgment()], progress: progress() });
    const sealed = { ...progress("completed"), completedPairs: 0 };
    cache.sealRunBatch(sealed);
    cache.close();

    // Simulate an interrupted/partially applied migration by making a conflicting
    // v5 marker and removing its required publication singleton. Re-running migration
    // fails on the existing phase-1 table; the version bump must roll back with it.
    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    db.exec("DELETE FROM publication_state; PRAGMA user_version=5;");
    db.close();
    const failedMigration = await createJevPairCache(dir);
    expect(failedMigration.available).toBe(false);
    failedMigration.close();
    const check = new Database(join(dir, "jev-pair-cache.sqlite"), { readonly: true });
    expect(
      check.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version,
    ).toBe(5);
    expect(
      check.query<{ count: number }, []>("SELECT count(*) as count FROM publication_state").get()
        ?.count,
    ).toBe(0);
    check.close();

    // A live cache must also fail the final publication transaction closed if an
    // external writer removes the singleton after open.
    const live = await createJevPairCache(await tempDir());
    assertStagingApi(live);
    live.reserveRunBatch(progress());
    live.checkpointStagedPair({ judgments: [judgment()], progress: progress() });
    live.sealRunBatch(sealed);
    const liveDir = directories.at(-1);
    if (!liveDir) throw new Error("Live test directory was not recorded");
    const writer = new Database(join(liveDir, "jev-pair-cache.sqlite"));
    writer.exec("DELETE FROM publication_state;");
    writer.close();
    expect(() =>
      live.promoteRunBatch({
        runId: "run-staged",
        expectedStagingRevision: stagedRevision(live, "run-staged"),
        eligibleJudgments: [judgment()],
        progress: sealed,
      }),
    ).toThrow("publication state is unavailable");
    expect(live.lookup(key)).toBeNull();
    expect(live.stagedSnapshot("run-staged")?.judgments).toEqual([judgment()]);
    live.close();
  });
});

function cacheDatabaseRowCount(dir: string): number {
  const db = new Database(join(dir, "jev-pair-cache.sqlite"), { readonly: true });
  try {
    return (
      db.query<{ count: number }, []>("SELECT count(*) as count FROM staged_judgments").get()
        ?.count ?? 0
    );
  } finally {
    db.close();
  }
}
