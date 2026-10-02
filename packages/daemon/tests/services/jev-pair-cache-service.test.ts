import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJevPairCache,
  type JevPairJudgment,
} from "../../src/services/jev-pair-cache-service.js";
import {
  buildJevPairDependencies,
  fingerprintJevSource,
} from "../../src/services/jev-pair-identity.js";

const directories: string[] = [];
async function tempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "jev-cache-test-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function record(
  kind: JevPairJudgment["dependencyKind"] = "C_ONLY",
  value = 0.7,
  fingerprint = "a".repeat(64),
): JevPairJudgment {
  return {
    collectionId: "collection-1",
    ...(kind === "C_ONLY" ? {} : { consentEpoch: "consent-epoch-1" }),
    gameAId: "stable-a",
    gameBId: "stable-b",
    signal: kind === "D_ONLY" ? "D" : "C",
    dependencyKind: kind,
    value,
    confidence: 0.4,
    modelId: "model-v1",
    rubricVersion: "rubric-v2",
    questionVersion: "question-v3",
    requestSchemaVersion: "schema-v4",
    scoreMappingVersion: "mapping-v5",
    semanticPolicyId: "policy-v6",
    completedAt: "2026-09-30T12:00:00.000Z",
    dependencies: ["stable-a", "stable-b"].map((gameId) => ({
      gameId,
      nameFingerprint: fingerprint,
      ...(kind === "D_ONLY" ? { noteFingerprint: "b".repeat(64), noteVersion: "note-v1" } : {}),
      ...(kind !== "D_ONLY" ? { descriptionFingerprint: "c".repeat(64) } : {}),
      ...(kind === "SHARED_CD" ? { noteFingerprint: "b".repeat(64), noteVersion: "note-v1" } : {}),
    })),
  };
}

function progress(state: "running" | "completed" | "interrupted" | "failed" = "running") {
  return {
    runId: "run-checkpoint",
    state,
    pairCount: 1,
    completedPairs: state === "completed" ? 1 : 0,
    cacheHits: 0,
    cacheMisses: 1,
    failedPairs: state === "failed" ? 1 : 0,
    updatedAt: "now",
  } as const;
}

describe("Jev pair cache", () => {
  test("checkpoints C and D judgments with progress atomically and persists after reopen", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    expect(cache.mutationRevision()).toBe(0);
    cache.checkpointPair({
      judgments: [record("C_ONLY"), record("D_ONLY")],
      progress: progress(),
    });
    expect(cache.mutationRevision()).toBe(1);
    expect(cache.getRunProgress()?.runId).toBe("run-checkpoint");
    cache.close();

    const reopened = await createJevPairCache(dir);
    expect(
      reopened.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" }),
    ).not.toBeNull();
    expect(
      reopened.lookup({ gameAId: "stable-b", gameBId: "stable-a", signal: "D" }),
    ).not.toBeNull();
    expect(reopened.getRunProgress()?.runId).toBe("run-checkpoint");
    expect(reopened.getRunProgress()).not.toHaveProperty("stopReason");
    reopened.close();
  });

  test("observes other cache handles' WAL commits once while preserving local monotonic revisions", async () => {
    const dir = await tempDir();
    const first = await createJevPairCache(dir);
    const second = await createJevPairCache(dir);
    expect(first.mutationRevision()).toBe(0);
    expect(first.mutationRevision()).toBe(0);

    second.checkpointPair({ judgments: [record()], progress: progress() });
    expect(first.mutationRevision()).toBe(1);
    expect(first.mutationRevision()).toBe(1);

    first.upsert({ ...record(), value: 0.8 });
    expect(first.mutationRevision()).toBe(2);
    second.purgePair("stable-a", "stable-b");
    expect(first.mutationRevision()).toBe(3);
    expect(first.mutationRevision()).toBe(3);

    second.reset();
    expect(first.mutationRevision()).toBe(4);
    expect(first.mutationRevision()).toBe(4);
    first.close();
    second.close();
  });

  test("persists a sanitized provider stop reason through SQLite reopen", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    cache.finishRun({
      activation: null,
      progress: { ...progress("failed"), stopReason: "provider-limit" },
    });
    expect(cache.getRunProgress()).toMatchObject({ state: "failed", stopReason: "provider-limit" });
    cache.close();

    const reopened = await createJevPairCache(dir);
    expect(reopened.getRunProgress()).toMatchObject({
      runId: "run-checkpoint",
      state: "failed",
      stopReason: "provider-limit",
    });
    reopened.close();
  });

  test("rejects malformed checkpoint inputs before writing any judgment", async () => {
    const cache = await createJevPairCache(await tempDir());
    const malformed = { ...record("D_ONLY"), value: 4 };
    expect(() =>
      cache.checkpointPair({ judgments: [record(), malformed], progress: progress() }),
    ).toThrow();
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    expect(cache.getRunProgress()).toBeNull();
    expect(() =>
      cache.checkpointPair({ judgments: [record(), record("C_ONLY", 0.8)], progress: progress() }),
    ).toThrow();
    expect(() =>
      cache.checkpointPair({ judgments: [record()], progress: { ...progress(), pairCount: -1 } }),
    ).toThrow();
    expect(() =>
      cache.saveRunProgress({ ...progress("failed"), stopReason: "raw-provider-error" as never }),
    ).toThrow();
    expect(() => cache.saveRunProgress({ ...progress(), stopReason: "provider-limit" })).toThrow();
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    cache.close();
  });

  test("rejects malformed stop reasons when reading persisted progress", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    cache.finishRun({
      activation: null,
      progress: { ...progress("failed"), stopReason: "provider-unconfigured" },
    });
    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    db.query("UPDATE run_progress SET stop_reason='raw-error' WHERE singleton=1").run();
    db.close();
    expect(cache.getRunProgress()).toBeNull();
    cache.close();
  });

  test("malformed row is unusable without poisoning valid rows or the mutation revision", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    cache.upsert(record());
    const valid = {
      ...record(),
      gameAId: "valid-a",
      gameBId: "valid-b",
      dependencies: record().dependencies.map((dependency, index) => ({
        ...dependency,
        gameId: index === 0 ? "valid-a" : "valid-b",
      })),
    };
    cache.upsert(valid);
    const revision = cache.mutationRevision();
    expect(revision).toBe(2);
    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    db.query("UPDATE judgments SET dependencies_json='not-json' WHERE game_a='stable-a'").run();
    db.close();
    expect(cache.mutationRevision()).toBe((revision ?? 0) + 1);
    const observedRevision = cache.mutationRevision();

    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    expect(cache.mutationRevision()).toBe(observedRevision);
    expect(cache.lookup({ gameAId: "valid-a", gameBId: "valid-b", signal: "C" })).toEqual(valid);
    expect(cache.mutationRevision()).toBe(observedRevision);
    cache.close();
  });

  test("SQLite lookup failure invalidates the mutation revision", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    cache.upsert(record());
    expect(cache.mutationRevision()).toBe(1);
    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    db.exec("DROP TABLE judgments");
    db.close();

    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    expect(cache.mutationRevision()).toBeNull();
    cache.close();
  });

  test("rolls back checkpoint rows and progress on SQLite failure", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    const revision = cache.mutationRevision();
    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    db.exec(
      "CREATE TRIGGER reject_progress BEFORE INSERT ON run_progress BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    db.close();
    const observedRevision = cache.mutationRevision();
    expect(observedRevision).toBe((revision ?? 0) + 1);
    expect(() =>
      cache.checkpointPair({ judgments: [record(), record("D_ONLY")], progress: progress() }),
    ).toThrow();
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "D" })).toBeNull();
    expect(cache.getRunProgress()).toBeNull();
    expect(cache.mutationRevision()).toBe(observedRevision);
    cache.close();
  });

  test("finishes run atomically and null activation preserves existing activation", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    expect(cache.mutationRevision()).toBe(0);
    cache.setActivation({ identity: "still-valid", activatedAt: "earlier" });
    expect(cache.mutationRevision()).toBe(1);
    cache.finishRun({ activation: null, progress: progress("failed") });
    expect(cache.mutationRevision()).toBe(1);
    expect(cache.getActivation()).toEqual({ identity: "still-valid", activatedAt: "earlier" });
    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    db.exec(
      "CREATE TRIGGER reject_finish BEFORE INSERT ON run_progress BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    db.close();
    const observedRevision = cache.mutationRevision();
    expect(observedRevision).toBe(2);
    expect(() =>
      cache.finishRun({
        activation: { identity: "new", activatedAt: "now" },
        progress: progress("completed"),
      }),
    ).toThrow();
    expect(cache.getActivation()?.identity).toBe("still-valid");
    expect(cache.getRunProgress()?.state).toBe("failed");
    expect(cache.mutationRevision()).toBe(observedRevision);
    cache.close();
  });
  test("canonicalizes unordered pair keys and persists after reopen with an idempotent schema", async () => {
    const dir = await tempDir();
    const first = await createJevPairCache(dir);
    expect(first.available).toBe(true);
    expect(first.mutationRevision()).toBe(0);
    first.upsert(record());
    expect(first.mutationRevision()).toBe(1);
    first.close();
    const reopened = await createJevPairCache(dir);
    expect(reopened.mutationRevision()).toBe(0);
    expect(reopened.lookup({ gameAId: "stable-b", gameBId: "stable-a", signal: "C" })?.value).toBe(
      0.7,
    );
    reopened.close();
    const again = await createJevPairCache(dir);
    expect(again.available).toBe(true);
    again.close();
  });

  test("fingerprints exact sent source and builds independent/shared dependency sets", () => {
    const base = {
      gameId: "game-a",
      name: " Name ",
      description: " description\n",
      note: { text: " note ", version: "note-v4" },
    };
    const other = { ...base, gameId: "game-b", name: "Other" };
    expect(fingerprintJevSource(" Name ")).not.toBe(fingerprintJevSource("Name"));
    const c = buildJevPairDependencies("C_ONLY", base, other);
    expect(c).toHaveLength(2);
    expect(c[0]).toHaveProperty("descriptionFingerprint");
    expect(c[0]).not.toHaveProperty("noteFingerprint");
    const d = buildJevPairDependencies("D_ONLY", base, other);
    expect(d[0]).toHaveProperty("noteVersion", "note-v4");
    expect(d[0]).not.toHaveProperty("descriptionFingerprint");
    const shared = buildJevPairDependencies("SHARED_CD", base, other);
    expect(shared[0]).toHaveProperty("descriptionFingerprint");
    expect(shared[0]).toHaveProperty("noteFingerprint");
    expect(shared[0]).toHaveProperty("noteVersion", "note-v4");
    expect(() => buildJevPairDependencies("D_ONLY", { ...base, note: undefined }, other)).toThrow();
  });

  test("canonical ordering of mixed-case IDs matches dependency ordering", async () => {
    const cache = await createJevPairCache(await tempDir());
    const value = record();
    const mixedCase = {
      ...value,
      gameAId: "A",
      gameBId: "a",
      dependencies: value.dependencies
        .map((dependency) => ({
          ...dependency,
          gameId: dependency.gameId === "stable-a" ? "A" : "a",
        }))
        .reverse(),
    };
    cache.upsert(mixedCase);
    const restored = cache.lookup({ gameAId: "a", gameBId: "A", signal: "C" });
    expect(restored?.gameAId).toBe("A");
    expect(restored?.gameBId).toBe("a");
    expect(
      restored?.dependencies
        .map((dependency) => dependency.gameId)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    ).toEqual(["A", "a"]);
    cache.close();
  });

  test("stores exact input identities and invalidates shared D but preserves independent D-only on description purge", async () => {
    const cache = await createJevPairCache(await tempDir());
    const shared = record("SHARED_CD");
    const independent = record("D_ONLY");
    cache.upsert(shared);
    cache.upsert(independent);
    expect(
      cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })?.dependencies[0]
        ?.nameFingerprint,
    ).toBe("a".repeat(64));
    expect(cache.purgeGame("stable-a", undefined, "SHARED_CD")).toBe(1);
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    expect(
      cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "D" })?.dependencyKind,
    ).toBe("D_ONLY");
    cache.close();
  });

  test("purges only the requested signal from shared rows and invalidates both on source change", async () => {
    const cache = await createJevPairCache(await tempDir());
    expect(cache.mutationRevision()).toBe(0);
    cache.upsert(record("SHARED_CD"));
    expect(cache.mutationRevision()).toBe(1);
    cache.upsert({ ...record("SHARED_CD"), signal: "D", value: 0.8 });
    cache.setActivation({ identity: "ready", activatedAt: "now" });
    expect(cache.mutationRevision()).toBe(3);

    expect(cache.purgeGame("stable-a", "C", "SHARED_CD")).toBe(1);
    expect(cache.mutationRevision()).toBe(4);
    expect(cache.getActivation()).toBeNull();
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    expect(
      cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "D" })?.dependencyKind,
    ).toBe("SHARED_CD");

    cache.upsert(record("SHARED_CD"));
    expect(cache.invalidateGame("stable-a", ["SHARED_CD"])).toBe(2);
    expect(cache.mutationRevision()).toBe(6);
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "D" })).toBeNull();
    cache.close();
  });

  test("advances revision for successful withdrawals and zero-row purges, not failed validation", async () => {
    const cache = await createJevPairCache(await tempDir());
    expect(cache.mutationRevision()).toBe(0);
    expect(() => cache.upsert({ ...record(), value: Number.NaN })).toThrow();
    expect(cache.mutationRevision()).toBe(0);

    cache.setActivation({ identity: "ready", activatedAt: "now" });
    expect(cache.mutationRevision()).toBe(1);
    cache.setActivation(null);
    expect(cache.mutationRevision()).toBe(2);

    expect(cache.purgePair("stable-a", "stable-b")).toBe(0);
    expect(cache.mutationRevision()).toBe(3);
    expect(cache.purgeDDependent()).toBe(0);
    expect(cache.mutationRevision()).toBe(4);
    cache.close();
  });

  test("atomically invalidates selected classes while retaining independent judgments and withdrawing activation", async () => {
    const cache = await createJevPairCache(await tempDir());
    cache.upsert(record("C_ONLY"));
    cache.upsert(record("D_ONLY"));
    cache.setActivation({ identity: "ready", activatedAt: "now" });
    expect(cache.invalidateGame("stable-a", ["D_ONLY", "SHARED_CD"])).toBe(1);
    expect(cache.getActivation()).toBeNull();
    expect(
      cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })?.dependencyKind,
    ).toBe("C_ONLY");
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "D" })).toBeNull();
    cache.close();
  });

  test("global note revocation purges D-dependent rows including unrelated/orphaned pair records", async () => {
    const cache = await createJevPairCache(await tempDir());
    cache.upsert(record("D_ONLY"));
    const otherPair = record("D_ONLY");
    otherPair.gameAId = "removed-a";
    otherPair.gameBId = "removed-b";
    otherPair.dependencies = otherPair.dependencies.map((dep, index) => ({
      ...dep,
      gameId: index === 0 ? "removed-a" : "removed-b",
    }));
    cache.upsert(otherPair);
    const independent = record("C_ONLY");
    cache.upsert(independent);
    cache.setActivation({ identity: "ready", activatedAt: "now" });
    expect(cache.purgeDDependent()).toBe(2);
    expect(cache.getActivation()).toBeNull();
    expect(cache.lookup({ gameAId: "removed-a", gameBId: "removed-b", signal: "D" })).toBeNull();
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).not.toBeNull();
    cache.close();
  });

  test("collection identity and consent epoch remain row policy dependencies", async () => {
    const cache = await createJevPairCache(await tempDir());
    const d = record("D_ONLY");
    cache.upsert(d);
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "D" })).toMatchObject({
      collectionId: "collection-1",
      consentEpoch: "consent-epoch-1",
    });
    expect(() => cache.upsert({ ...d, consentEpoch: undefined })).toThrow();
    expect(() => cache.upsert({ ...record("C_ONLY"), consentEpoch: "irrelevant" })).toThrow();
    cache.close();
  });

  test("replaces a judgment when sent input identity changes; unrelated rows survive scoped purge", async () => {
    const cache = await createJevPairCache(await tempDir());
    const original = record();
    cache.upsert(original);
    cache.upsert(record("C_ONLY", 0.8, "d".repeat(64)));
    const unrelated = {
      ...record(),
      gameAId: "stable-x",
      gameBId: "stable-y",
      dependencies: record().dependencies.map((dep) => ({
        ...dep,
        gameId: dep.gameId === "stable-a" ? "stable-x" : "stable-y",
      })),
    };
    cache.upsert(unrelated);
    expect(
      cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })?.dependencies[0]
        ?.nameFingerprint,
    ).toBe("d".repeat(64));
    expect(cache.purgeGame("stable-a", "C", "C_ONLY")).toBe(1);
    expect(cache.lookup({ gameAId: "stable-x", gameBId: "stable-y", signal: "C" })).not.toBeNull();
    cache.close();
  });

  test("rejects invalid scores and fingerprints, and persists only fingerprints rather than canary text", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    expect(() => cache.upsert({ ...record(), value: Number.NaN })).toThrow();
    expect(() =>
      cache.upsert({
        ...record(),
        dependencies: record().dependencies.map((dep) => ({
          ...dep,
          nameFingerprint: "NAME_CANARY",
        })),
      }),
    ).toThrow();
    const valid = record();
    cache.upsert(valid);
    cache.close();
    const db = new Database(join(dir, "jev-pair-cache.sqlite"), { readonly: true });
    const stored = JSON.stringify(db.query("SELECT * FROM judgments").all());
    db.close();
    expect(stored).not.toContain("NAME_CANARY");
    expect(stored).not.toContain("description canary");
    expect(stored).toContain("a".repeat(64));
    const contents = await readFile(join(dir, "jev-pair-cache.sqlite"));
    expect(contents.includes(Buffer.from("NAME_CANARY"))).toBe(false);
  });

  test("rejects and never persists plaintext canaries hidden in extra dependency or judgment properties", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    const valid = record("SHARED_CD");
    const pollutedDependency = {
      ...valid.dependencies[0],
      privateNote: "NOTE_CANARY",
      privateDescription: "DESCRIPTION_CANARY",
    };
    const polluted = { ...valid, dependencies: [pollutedDependency, valid.dependencies[1]] };
    expect(() => cache.upsert(polluted)).toThrow();
    expect(() =>
      cache.upsert({ ...valid, privateName: "NAME_CANARY" } as unknown as typeof valid),
    ).toThrow();
    cache.close();

    const db = new Database(join(dir, "jev-pair-cache.sqlite"), { readonly: true });
    const raw = JSON.stringify(db.query("SELECT * FROM judgments").all());
    db.close();
    expect(raw).not.toContain("NOTE_CANARY");
    expect(raw).not.toContain("DESCRIPTION_CANARY");
    expect(raw).not.toContain("NAME_CANARY");
  });

  test("rejects invalid confidence, provenance, and dependency shapes", async () => {
    const cache = await createJevPairCache(await tempDir());
    const valid = record("SHARED_CD");
    expect(() => cache.upsert({ ...valid, confidence: 1.01 })).toThrow();
    expect(() => cache.upsert({ ...valid, confidence: Number.NaN })).toThrow();
    expect(() => cache.upsert({ ...valid, rubricVersion: "" })).toThrow();
    expect(() => cache.upsert({ ...valid, dependencies: [valid.dependencies[0]] })).toThrow();
    expect(() =>
      cache.upsert({
        ...valid,
        dependencies: [valid.dependencies[0], { ...valid.dependencies[1], noteVersion: undefined }],
      }),
    ).toThrow();
    expect(() =>
      cache.upsert({
        ...valid,
        dependencies: [
          valid.dependencies[0],
          { ...valid.dependencies[1], descriptionFingerprint: "not-a-fingerprint" },
        ],
      }),
    ).toThrow();
    cache.close();
  });

  test("preserves independent name, description, note fingerprint, and note-version identity changes", async () => {
    const cache = await createJevPairCache(await tempDir());
    const original = record("SHARED_CD");
    cache.upsert(original);
    const changed = record("SHARED_CD");
    changed.dependencies[0] = {
      ...changed.dependencies[0],
      nameFingerprint: "d".repeat(64),
      descriptionFingerprint: "e".repeat(64),
      noteFingerprint: "f".repeat(64),
      noteVersion: "note-v2",
    };
    cache.upsert(changed);
    const stored = cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" });
    expect(stored?.dependencies[0]?.nameFingerprint).toBe("d".repeat(64));
    expect(stored?.dependencies[0]?.descriptionFingerprint).toBe("e".repeat(64));
    expect(stored?.dependencies[0]?.noteFingerprint).toBe("f".repeat(64));
    expect(stored?.dependencies[0]?.noteVersion).toBe("note-v2");
    cache.close();
  });

  test("stores bounded run progress and advisory activation, and resets derived state", async () => {
    const cache = await createJevPairCache(await tempDir());
    expect(cache.mutationRevision()).toBe(0);
    cache.upsert(record());
    expect(cache.mutationRevision()).toBe(1);
    cache.saveRunProgress({
      runId: "run-1",
      state: "running",
      pairCount: 5,
      completedPairs: 2,
      cacheHits: 1,
      cacheMisses: 4,
      failedPairs: 0,
      updatedAt: "now",
    });
    cache.setActivation({ identity: "scope-hash", activatedAt: "now" });
    expect(cache.mutationRevision()).toBe(2);
    expect(cache.getRunProgress()?.completedPairs).toBe(2);
    expect(cache.getActivation()?.identity).toBe("scope-hash");
    cache.reset();
    expect(cache.mutationRevision()).toBe(3);
    expect(cache.getRunProgress()).toBeNull();
    expect(cache.getActivation()).toBeNull();
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    cache.close();
  });

  test("rolls back all reset deletes and preserves the revision when a later delete fails", async () => {
    const dir = await tempDir();
    const cache = await createJevPairCache(dir);
    cache.upsert(record());
    cache.saveRunProgress(progress());
    cache.setActivation({ identity: "ready", activatedAt: "now" });
    const revision = cache.mutationRevision();

    const db = new Database(join(dir, "jev-pair-cache.sqlite"));
    db.exec(
      "CREATE TRIGGER reject_activation_delete BEFORE DELETE ON activation BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    db.close();
    const observedRevision = cache.mutationRevision();
    expect(observedRevision).toBe((revision ?? 0) + 1);

    expect(() => cache.reset()).toThrow();
    expect(cache.mutationRevision()).toBe(observedRevision);
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).not.toBeNull();
    expect(cache.getRunProgress()).toEqual(progress());
    expect(cache.getActivation()).toEqual({ identity: "ready", activatedAt: "now" });

    const cleanup = new Database(join(dir, "jev-pair-cache.sqlite"));
    cleanup.exec("DROP TRIGGER reject_activation_delete;");
    cleanup.close();
    cache.reset();
    expect(cache.mutationRevision()).toBe((observedRevision ?? 0) + 2);
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    expect(cache.getRunProgress()).toBeNull();
    expect(cache.getActivation()).toBeNull();
    cache.close();
  });

  test("fails closed for corrupt or unavailable cache storage", async () => {
    const dir = await tempDir();
    await Bun.write(join(dir, "jev-pair-cache.sqlite"), "not sqlite");
    const corrupt = await createJevPairCache(dir);
    expect(corrupt.available).toBe(false);
    expect(corrupt.mutationRevision()).toBeNull();
    expect(corrupt.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
    const blocked = join(dir, "a-file");
    await Bun.write(blocked, "not a directory");
    const unavailable = await createJevPairCache(blocked);
    expect(unavailable.available).toBe(false);
    expect(unavailable.mutationRevision()).toBeNull();
    expect(unavailable.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
    let collectionJsonChanged = false;
    expect(() => {
      unavailable.purgePair("a", "b");
      collectionJsonChanged = true;
    }).toThrow("Jev pair cache unavailable");
    expect(() => unavailable.purgeGame("a")).toThrow("Jev pair cache unavailable");
    expect(() => unavailable.upsert(record())).toThrow("Jev pair cache unavailable");
    expect(() =>
      unavailable.checkpointPair({ judgments: [record()], progress: progress() }),
    ).toThrow("Jev pair cache unavailable");
    expect(() => unavailable.finishRun({ activation: null, progress: progress("failed") })).toThrow(
      "Jev pair cache unavailable",
    );
    expect(() => unavailable.setActivation({ identity: "x", activatedAt: "now" })).toThrow(
      "Jev pair cache unavailable",
    );
    expect(collectionJsonChanged).toBe(false);

    const closed = await createJevPairCache(await tempDir());
    expect(closed.mutationRevision()).toBe(0);
    closed.close();
    expect(closed.available).toBe(true);
    expect(closed.mutationRevision()).toBeNull();
    expect(() => closed.purgePair("a", "b")).toThrow("Jev pair cache closed");
    expect(() => closed.purgeGame("a")).toThrow("Jev pair cache closed");
    expect(() => closed.upsert(record())).toThrow("Jev pair cache closed");
    expect(() => closed.checkpointPair({ judgments: [record()], progress: progress() })).toThrow(
      "Jev pair cache closed",
    );
    expect(() => closed.finishRun({ activation: null, progress: progress("failed") })).toThrow(
      "Jev pair cache closed",
    );
    expect(() => closed.setActivation({ identity: "x", activatedAt: "now" })).toThrow(
      "Jev pair cache closed",
    );
  });

  test("fails closed when schema version claims initialization but required table is missing", async () => {
    const dir = await tempDir();
    const db = new Database(join(dir, "jev-pair-cache.sqlite"), { create: true });
    db.exec("PRAGMA user_version = 1;");
    db.close();

    const cache = await createJevPairCache(dir);
    expect(cache.available).toBe(false);
    expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
    expect(() => cache.purgePair("a", "b")).toThrow("Jev pair cache unavailable");
  });

  test("upgrades the prior repository schema conservatively by discarding unfenced rows", async () => {
    const dir = await tempDir();
    const db = new Database(join(dir, "jev-pair-cache.sqlite"), { create: true });
    db.exec(`CREATE TABLE judgments (
      game_a TEXT NOT NULL, game_b TEXT NOT NULL, signal TEXT NOT NULL, dependency_kind TEXT NOT NULL,
      value REAL NOT NULL, confidence REAL, model_id TEXT NOT NULL, rubric_version TEXT NOT NULL,
      question_version TEXT NOT NULL, request_schema_version TEXT NOT NULL, score_mapping_version TEXT NOT NULL,
      semantic_policy_id TEXT NOT NULL, completed_at TEXT NOT NULL, dependencies_json TEXT NOT NULL,
      PRIMARY KEY(game_a,game_b,signal)
    );
    CREATE TABLE run_progress (singleton INTEGER PRIMARY KEY, run_id TEXT NOT NULL, state TEXT NOT NULL,
      pair_count INTEGER NOT NULL, completed_pairs INTEGER NOT NULL, cache_hits INTEGER NOT NULL,
      cache_misses INTEGER NOT NULL, failed_pairs INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE activation (singleton INTEGER PRIMARY KEY, identity TEXT NOT NULL, activated_at TEXT NOT NULL);
    INSERT INTO judgments VALUES ('a','b','C','C_ONLY',0.5,NULL,'m','r','q','s','map','p','now','[]');
    INSERT INTO activation VALUES (1,'old','now');
    INSERT INTO run_progress VALUES (1,'legacy-run','failed',1,1,0,1,1,'legacy-time');
    PRAGMA user_version = 1;`);
    db.close();

    const cache = await createJevPairCache(dir);
    expect(cache.available).toBe(true);
    expect(cache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
    expect(cache.getActivation()).toBeNull();
    expect(cache.getRunProgress()).toEqual({
      runId: "legacy-run",
      state: "failed",
      pairCount: 1,
      completedPairs: 1,
      cacheHits: 0,
      cacheMisses: 1,
      failedPairs: 1,
      updatedAt: "legacy-time",
    });
    cache.finishRun({
      activation: null,
      progress: { ...progress("failed"), stopReason: "provider-unconfigured" },
    });
    expect(cache.getRunProgress()?.stopReason).toBe("provider-unconfigured");
    cache.upsert(record());
    expect(
      cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })?.collectionId,
    ).toBe("collection-1");
    cache.close();
  });
});
