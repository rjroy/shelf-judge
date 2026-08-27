import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CollectionProfile, ProfileData } from "@shelf-judge/shared";
import {
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
} from "@shelf-judge/shared";
import { createFileOps } from "../../src/services/file-ops.js";
import type { GameService } from "../../src/services/game-service.js";
import { createProfileService } from "../../src/services/profile-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import type { TournamentService } from "../../src/services/tournament-service.js";

const COMPUTED_AT = "2026-08-27T12:00:00.000Z";

function emptyProfile(): CollectionProfile {
  return {
    axisDistributions: [],
    axisWeights: [],
    bggClustering: {
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      weightRanges: [],
    },
    utilityCurves: [],
    divergence: null,
    outliers: [],
    suggestions: [],
    narration: null,
    narrationState: "empty",
    gameCount: 0,
    ratedGameCount: 0,
    computedAt: COMPUTED_AT,
  };
}

function currentProfileData(): ProfileData {
  return {
    contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
    algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
    tournamentSettings: {
      kFactorThreshold: 15,
      normalizationHalfWidth: 400,
      provisionalThreshold: 6,
    },
    profile: emptyProfile(),
    computedAt: COMPUTED_AT,
    narration: null,
    narrationComputedAt: null,
  };
}

function silentLogger() {
  return { log() {}, warn() {}, error() {} };
}

function emptyGameService(): GameService {
  const unsupported = () => Promise.reject(new Error("not used by profile persistence test"));
  return {
    listGames: () => Promise.resolve([]),
    getGame: unsupported,
    addGame: unsupported,
    rateGame: unsupported,
    removeGame: unsupported,
    searchGames: unsupported,
    refreshBggData: unsupported,
    refreshAllBggData: unsupported,
    importBggCollection: unsupported,
    setOwnership: unsupported,
    setBoxDimensions: unsupported,
    setManualShelf: unsupported,
  };
}

function emptyTournamentService(): TournamentService {
  const unsupported = () => Promise.reject(new Error("not used by profile persistence test"));
  return {
    getAllGameStats: () => Promise.resolve({}),
    getGameStats: unsupported,
    startSession: unsupported,
    getActiveSession: () => Promise.resolve(null),
    endSession: unsupported,
    getNextPair: unsupported,
    submitComparison: unsupported,
    listSessions: () => Promise.resolve([]),
    normalizeFitness: unsupported,
    onGameDeleted: () => Promise.resolve(),
    getSettings: unsupported,
    updateSettings: unsupported,
  };
}

async function withStorage(
  run: (context: {
    dataDir: string;
    profilePath: string;
    createStorage: () => ReturnType<typeof createStorageService>;
  }) => Promise<void>,
): Promise<void> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "shelf-judge-profile-"));
  const profilePath = path.join(dataDir, "profile.json");
  const createStorage = () =>
    createStorageService({
      dataDir,
      configPath: path.join(dataDir, "config.json"),
      fileOps: createFileOps(),
      logger: silentLogger(),
    });

  try {
    await run({ dataDir, profilePath, createStorage });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(
    () => true,
    () => false,
  );
}

describe("persisted profile contract", () => {
  test("reloads a valid current artifact through a new storage instance", async () => {
    await withStorage(async ({ createStorage }) => {
      await createStorage().saveProfile(currentProfileData());

      expect(await createStorage().loadProfile()).toEqual(currentProfileData());
    });
  });

  test("deletes an artifact from an old algorithm version", async () => {
    await withStorage(async ({ profilePath, createStorage }) => {
      await fs.writeFile(
        profilePath,
        JSON.stringify({ ...currentProfileData(), algorithmVersion: 0 }),
        "utf8",
      );

      expect(await createStorage().loadProfile()).toBeNull();
      expect(await exists(profilePath)).toBe(false);
    });
  });

  test("deletes an artifact containing a non-finite number", async () => {
    await withStorage(async ({ profilePath, createStorage }) => {
      const raw = JSON.stringify(currentProfileData()).replace(
        '"gameCount":0',
        '"gameCount":1e400',
      );
      await fs.writeFile(profilePath, raw, "utf8");

      expect(await createStorage().loadProfile()).toBeNull();
      expect(await exists(profilePath)).toBe(false);
    });
  });

  test("recomputes an old contract without carrying its narration forward", async () => {
    await withStorage(async ({ profilePath, createStorage }) => {
      const oldNarration = {
        summary: "Obsolete profile claim",
        surprises: [],
        tensions: [],
        blindSpots: [],
        curveInsights: [],
      };
      await fs.writeFile(
        profilePath,
        JSON.stringify({
          ...currentProfileData(),
          contractVersion: 0,
          narration: oldNarration,
          narrationComputedAt: COMPUTED_AT,
        }),
        "utf8",
      );

      const storage = createStorage();
      const service = createProfileService({
        storageService: storage,
        gameService: emptyGameService(),
        tournamentService: emptyTournamentService(),
      });

      const recomputed = await service.getProfile();
      const persisted = await createStorage().loadProfile();

      expect(recomputed.narration).toBeNull();
      expect(recomputed.narrationState).toBe("empty");
      expect(persisted?.contractVersion).toBe(CURRENT_PROFILE_CONTRACT_VERSION);
      expect(persisted?.algorithmVersion).toBe(CURRENT_PROFILE_ALGORITHM_VERSION);
      expect(persisted?.narration).toBeNull();
    });
  });

  test("rejects narration when the narrated profile has been replaced", async () => {
    await withStorage(async ({ createStorage }) => {
      const storage = createStorage();
      const narrated = currentProfileData();
      await storage.saveProfile(narrated);
      const replacement: ProfileData = {
        ...currentProfileData(),
        profile: {
          ...emptyProfile(),
          computedAt: "2026-08-27T13:00:00.000Z",
        },
        computedAt: "2026-08-27T13:00:00.000Z",
      };
      await storage.saveProfile(replacement);
      narrated.narration = {
        summary: "Narration for the replaced profile",
        surprises: [],
        tensions: [],
        blindSpots: [],
        curveInsights: [],
      };
      narrated.narrationComputedAt = "2026-08-27T13:01:00.000Z";

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(storage.saveProfile(narrated, COMPUTED_AT)).rejects.toThrow(
        "Profile changed during narration generation",
      );
      expect(await createStorage().loadProfile()).toEqual(replacement);
    });
  });
});
