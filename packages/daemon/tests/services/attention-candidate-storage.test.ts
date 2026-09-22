import { describe, expect, test } from "bun:test";
import {
  ATTENTION_CANDIDATE_ARTIFACT_INDEX_VERSION,
  ATTENTION_CANDIDATE_ARTIFACT_SCHEMA_VERSION,
  type AttentionCandidateArtifact,
} from "@shelf-judge/shared";
import { createStorageService } from "../../src/services/storage-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

const path = "/test/data/attention-candidates.json";
function data(): AttentionCandidateArtifact {
  return {
    schemaVersion: ATTENTION_CANDIDATE_ARTIFACT_SCHEMA_VERSION,
    indexVersion: ATTENTION_CANDIDATE_ARTIFACT_INDEX_VERSION,
    identity: {
      collectionId: "c",
      collectionSchemaVersion: 8,
      collectionRevision: 1,
      tournamentHash: "a".repeat(64),
      predictionSettingsHash: "b".repeat(64),
      redundancySettingsHash: "c".repeat(64),
      calculationVersion: 1,
      ruleCatalogVersion: 1,
      dependencyVersion: 1,
      projectionVersion: 1,
      catalogRuleVersions: [],
    },
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    rows: [],
    dueBuckets: [],
    earliestBoundary: null,
    localDependencyIndex: [],
    sourceDependencyIndex: [],
    bggIdentityIndex: [],
  };
}
function storage(files?: Record<string, string>) {
  const fileOps = createMockFileOps(files);
  return {
    fileOps,
    service: createStorageService({
      dataDir: "/test/data",
      configPath: "/test/config.json",
      fileOps,
      temporaryPathForAttempt: (file, attempt) => `${file}.${attempt}.tmp`,
    }),
  };
}

describe("attention candidate storage", () => {
  test("missing returns null and validated atomic save/load roundtrips", async () => {
    const { service } = storage();
    expect(await service.loadAttentionCandidates?.()).toBeNull();
    await service.saveAttentionCandidates?.(data());
    expect(await service.loadAttentionCandidates?.()).toEqual(data());
  });
  test("malformed and version-incompatible content is discarded", async () => {
    for (const raw of [
      "{",
      JSON.stringify({ ...data(), schemaVersion: 99 }),
      JSON.stringify({
        ...data(),
        identity: {
          ...data().identity,
          catalogRuleVersions: [
            { ruleId: "z-rule", ruleVersion: 1, scoringVersion: 1 },
            { ruleId: "a-rule", ruleVersion: 1, scoringVersion: 1 },
          ],
        },
      }),
    ]) {
      const { service, fileOps } = storage({ [path]: raw });
      expect(await service.loadAttentionCandidates?.()).toBeNull();
      expect(await fileOps.exists(path)).toBe(false);
    }
  });
  test("rename failure preserves prior artifact and cleans its unique temporary file", async () => {
    const { service, fileOps } = storage({ [path]: JSON.stringify(data()) });
    fileOps.rename = () => Promise.reject(new Error("rename failed"));
    await Promise.resolve(
      service.saveAttentionCandidates?.({
        ...data(),
        identity: { ...data().identity, collectionRevision: 2 },
      }),
    ).then(
      () => {
        throw new Error("expected rename failure");
      },
      (error: unknown) => expect(error).toHaveProperty("message", "rename failed"),
    );
    expect(await fileOps.readFile(path)).toBe(JSON.stringify(data()));
    expect(await fileOps.exists(`${path}.0.tmp`)).toBe(false);
  });
  test("source generation advances once only after relevant durable source writes", async () => {
    const { service, fileOps } = storage();
    const generation = () => service.attentionCandidateSourceGeneration?.() ?? -1;
    expect(generation()).toBe(0);
    const collection = await service.loadCollection();
    expect(generation()).toBe(1);
    await service.saveCollection(collection);
    expect(generation()).toBe(2);
    await service.loadTournament();
    expect(generation()).toBe(3);
    await service.saveTournament(await service.loadTournament());
    expect(generation()).toBe(4);
    await service.savePredictionSettings(await service.loadPredictionSettings());
    expect(generation()).toBe(5);
    await service.saveRedundancySettings(await service.loadRedundancySettings());
    expect(generation()).toBe(6);
    await service.saveConfig(await service.loadConfig());
    await service.saveAttentionCandidates?.(data());
    expect(generation()).toBe(6);

    fileOps.rename = () => Promise.reject(new Error("durable write failed"));
    let failure: Error | null = null;
    try {
      await service.saveTournament(await service.loadTournament());
    } catch (error) {
      if (error instanceof Error) failure = error;
    }
    expect(failure?.message).toBe("durable write failed");
    expect(generation()).toBe(6);
  });
});
