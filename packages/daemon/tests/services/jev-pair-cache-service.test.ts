import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJevPairCache,
  type JevPairJudgment,
} from "../../src/services/jev-pair-cache-service.js";

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

describe("Jev pair cache", () => {
  test("canonicalizes unordered pair keys and persists after reopen with an idempotent schema", async () => {
    const dir = await tempDir();
    const first = await createJevPairCache(dir);
    expect(first.available).toBe(true);
    first.upsert(record());
    first.close();
    const reopened = await createJevPairCache(dir);
    expect(reopened.lookup({ gameAId: "stable-b", gameBId: "stable-a", signal: "C" })?.value).toBe(
      0.7,
    );
    reopened.close();
    const again = await createJevPairCache(dir);
    expect(again.available).toBe(true);
    again.close();
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
    cache.upsert(record());
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
    expect(cache.getRunProgress()?.completedPairs).toBe(2);
    expect(cache.getActivation()?.identity).toBe("scope-hash");
    cache.reset();
    expect(cache.getRunProgress()).toBeNull();
    expect(cache.getActivation()).toBeNull();
    expect(cache.lookup({ gameAId: "stable-a", gameBId: "stable-b", signal: "C" })).toBeNull();
    cache.close();
  });

  test("fails closed for corrupt or unavailable cache storage", async () => {
    const dir = await tempDir();
    await Bun.write(join(dir, "jev-pair-cache.sqlite"), "not sqlite");
    const corrupt = await createJevPairCache(dir);
    expect(corrupt.available).toBe(false);
    expect(corrupt.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
    const blocked = join(dir, "a-file");
    await Bun.write(blocked, "not a directory");
    const unavailable = await createJevPairCache(blocked);
    expect(unavailable.available).toBe(false);
    expect(unavailable.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toBeNull();
    let collectionJsonChanged = false;
    expect(() => {
      unavailable.purgePair("a", "b");
      collectionJsonChanged = true;
    }).toThrow("Jev pair cache unavailable");
    expect(() => unavailable.purgeGame("a")).toThrow("Jev pair cache unavailable");
    expect(collectionJsonChanged).toBe(false);

    const closed = await createJevPairCache(await tempDir());
    closed.close();
    expect(() => closed.purgePair("a", "b")).toThrow("Jev pair cache closed");
    expect(() => closed.purgeGame("a")).toThrow("Jev pair cache closed");
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
});
