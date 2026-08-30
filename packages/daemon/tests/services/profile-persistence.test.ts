import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ProfileData } from "@shelf-judge/shared";
import {
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
} from "@shelf-judge/shared";
import { computeCollectionProfile } from "../../src/services/collection-profile-engine.js";
import { createFileOps } from "../../src/services/file-ops.js";
import {
  profileSourceIdentity,
  type ProfileSources,
} from "../../src/services/profile-source-coordinator.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { usefulProfileFixture } from "../../../shared/tests/fixtures/useful-profile.js";

async function withStorage(
  run: (context: {
    dataDir: string;
    profilePath: string;
    storage: ReturnType<typeof createStorageService>;
  }) => Promise<void>,
) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "shelf-profile-"));
  const storage = createStorageService({
    dataDir,
    configPath: path.join(dataDir, "config.json"),
    fileOps: createFileOps(),
    logger: { log() {}, warn() {}, error() {} },
  });
  try {
    await run({ dataDir, profilePath: path.join(dataDir, "profile.json"), storage });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

async function currentData(storage: ReturnType<typeof createStorageService>): Promise<ProfileData> {
  const [collection, tournament, predictionSettings, redundancySettings] = await Promise.all([
    storage.loadCollection(),
    storage.loadTournament(),
    storage.loadPredictionSettings(),
    storage.loadRedundancySettings(),
  ]);
  const sources: ProfileSources = {
    collection,
    tournament,
    predictionSettings,
    redundancySettings,
  };
  const computedAt = "2026-08-28T12:00:00.000Z";
  return {
    contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
    algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
    sourceIdentity: profileSourceIdentity(sources),
    profile: computeCollectionProfile({ collection, fitnessResults: new Map(), computedAt }),
    computedAt,
  };
}

async function currentEntityData(
  storage: ReturnType<typeof createStorageService>,
): Promise<ProfileData> {
  const data = await currentData(storage);
  const profile = structuredClone(usefulProfileFixture);
  profile.computedAt = data.computedAt;
  return { ...data, profile };
}

describe("useful profile persistence", () => {
  test("round-trips an exact current entity cache across a storage restart", async () => {
    await withStorage(async ({ dataDir, storage }) => {
      const data = await currentEntityData(storage);
      await storage.saveProfile(data);
      expect(await storage.loadProfile()).toEqual(data);
      const restarted = createStorageService({
        dataDir,
        configPath: path.join(dataDir, "config.json"),
        fileOps: createFileOps(),
        logger: { log() {}, warn() {}, error() {} },
      });
      expect(await restarted.loadProfile()).toEqual(data);
    });
  });

  test("deletes old, malformed, and non-finite caches", async () => {
    await withStorage(async ({ profilePath, storage }) => {
      const current = await currentData(storage);
      const artifacts = [
        { ...current, contractVersion: 6, algorithmVersion: 8 },
        { ...current, sourceIdentity: { ...current.sourceIdentity, tournamentHash: "bad" } },
        JSON.stringify(current).replace('"collectionRevision":0', '"collectionRevision":1e400'),
      ];

      for (const artifact of artifacts) {
        await fs.writeFile(
          profilePath,
          typeof artifact === "string" ? artifact : JSON.stringify(artifact),
          "utf8",
        );
        expect(await storage.loadProfile()).toBeNull();
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
        await expect(fs.stat(profilePath)).rejects.toThrow();
      }
    });
  });

  test("deletes outgoing, mixed-version, legacy-ordering, and malformed adjusted caches", async () => {
    await withStorage(async ({ profilePath, storage }) => {
      const current = await currentEntityData(storage);
      const serialized = JSON.stringify(current);
      const artifacts = [
        serialized
          .replace('"contractVersion":9', '"contractVersion":8')
          .replace('"algorithmVersion":11', '"algorithmVersion":10'),
        serialized.replace('"contractVersion":9', '"contractVersion":8'),
        serialized.replace('"algorithmVersion":11', '"algorithmVersion":10'),
        serialized
          .replaceAll('"bestFit":', '"rating":')
          .replace(/"adjustedMeanCurrentFitness":[^,]+,/g, ""),
        serialized.replace(/"adjustedMeanCurrentFitness":[^,]+/, '"adjustedMeanCurrentFitness":99'),
      ];

      for (const artifact of artifacts) {
        await fs.writeFile(profilePath, artifact, "utf8");
        expect(await storage.loadProfile()).toBeNull();
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
        await expect(fs.stat(profilePath)).rejects.toThrow();
      }
    });
  });

  test("validates prediction and redundancy settings on load and save", async () => {
    await withStorage(async ({ dataDir, storage }) => {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
      await expect(
        storage.savePredictionSettings({
          ...(await storage.loadPredictionSettings()),
          defaultK: 0,
        }),
      ).rejects.toThrow();
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
      await expect(
        storage.saveRedundancySettings({
          ...(await storage.loadRedundancySettings()),
          componentWeights: { binary: 0, continuous: 0, personalAxes: 0 },
        }),
      ).rejects.toThrow();

      await fs.writeFile(
        path.join(dataDir, "prediction-settings.json"),
        JSON.stringify({ ...(await storage.loadPredictionSettings()), defaultK: 0 }),
        "utf8",
      );
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
      await expect(storage.loadPredictionSettings()).rejects.toThrow();
      await fs.writeFile(
        path.join(dataDir, "redundancy-settings.json"),
        JSON.stringify({
          ...(await storage.loadRedundancySettings()),
          similarityThreshold: 2,
        }),
        "utf8",
      );
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
      await expect(storage.loadRedundancySettings()).rejects.toThrow();
    });
  });
});
