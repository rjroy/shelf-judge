import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  AxisSuggestion,
  CollectionProfile,
  ProfileData,
  ReportedInsightEvidenceGame,
} from "@shelf-judge/shared";
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

function persistedSuggestionStates(): AxisSuggestion[] {
  const cohort = {
    description: "Six BGG-backed games with Tournament and independent fitness data",
    eligibleGameCount: 6,
    includedGameCount: 6,
    excludedGameCount: 0,
    coveragePercent: 100,
  };
  const method = {
    id: "directional-divergence-attribute-effect",
    version: 1,
    description:
      "Compares signed Tournament-versus-independent-fitness gaps for games with and without an attribute",
  } as const;
  const limitations = ["This observational association does not establish causation"];
  const evidence: ReportedInsightEvidenceGame[] = Array.from({ length: 6 }, (_, index) => ({
    gameId: `g${index + 1}`,
    gameName: `Game ${index + 1}`,
    role: index < 3 ? ("subject" as const) : ("comparator" as const),
    measurements: [
      {
        key: "signed-preference-gap",
        label: "Tournament minus independent fitness",
        value: index < 3 ? 4 : 0,
        unit: "rating",
        source: "Tournament comparisons and non-Tournament fitness axes",
      },
    ],
  }));
  const firstEvidence = evidence[0];
  if (firstEvidence === undefined) throw new Error("Missing persisted suggestion evidence");

  return [
    {
      contractVersion: 1,
      id: "axis-suggestion:tournament-outlier:mechanic:Area Control",
      status: "reported",
      method,
      cohort,
      sufficiency: [
        { criterion: "attribute-positive evaluated games", observed: 3, required: 3, met: true },
        { criterion: "attribute-negative comparator games", observed: 3, required: 3, met: true },
      ],
      evidence: [firstEvidence, ...evidence.slice(1)],
      comparator: { description: "Games without Area Control", gameIds: ["g4", "g5", "g6"] },
      limitations,
      observation: "Area Control games have a larger signed preference gap",
      interpretation: "Could Area Control explain the observed preference gap?",
      details: {
        source: "divergence-repair",
        attribute: "Area Control",
        attributeType: "mechanic",
        direction: "tournament-outlier",
        supportingGameCount: 3,
        comparatorGameCount: 3,
        supportingMeanGap: 4,
        comparatorMeanGap: 0,
        effect: 4,
      },
      notability: {
        metric: "directional signed-gap effect",
        value: 4,
        threshold: 1.5,
        direction: "above",
        explanation: "The effect exceeds the reporting threshold",
      },
      confidence: null,
    },
    {
      contractVersion: 1,
      id: "axis-suggestion:insufficient",
      status: "insufficient",
      reason: "insufficient-sample",
      method,
      cohort: { ...cohort, includedGameCount: 2, excludedGameCount: 4, coveragePercent: 33.3 },
      sufficiency: [{ criterion: "evaluated games", observed: 2, required: 6, met: false }],
      evidence: [],
      comparator: null,
      limitations,
      explanation: "At least six evaluated games are required",
    },
    {
      contractVersion: 1,
      id: "axis-suggestion:suppressed:confounded",
      status: "suppressed",
      reason: "unsupported-method",
      method,
      cohort,
      sufficiency: [],
      evidence: [],
      comparator: null,
      limitations: ["Overlapping attributes prevent an independent effect interpretation"],
      explanation: "The candidate is confounded by another attribute",
    },
    {
      contractVersion: 1,
      id: "axis-suggestion:retired:concentration",
      status: "retired",
      reason: "superseded",
      method: {
        id: "unexpressed-concentration",
        version: 1,
        description: "Recommended axes from ownership concentration",
      },
      cohort,
      sufficiency: [{ criterion: "concentration percent", observed: 80, required: 80, met: true }],
      evidence: [],
      comparator: null,
      limitations: ["Ownership frequency does not establish preference"],
      explanation: "The concentration recommendation method is retired",
    },
  ];
}

function currentProfileDataWithSuggestions(): ProfileData {
  const data = currentProfileData();
  data.profile = {
    ...data.profile,
    suggestions: persistedSuggestionStates(),
    gameCount: 6,
  };
  return data;
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

  test("reloads reported, insufficient, suppressed, and retired suggestion states", async () => {
    await withStorage(async ({ createStorage }) => {
      const data = currentProfileDataWithSuggestions();

      await createStorage().saveProfile(data);

      expect((await createStorage().loadProfile())?.profile.suggestions).toEqual(
        persistedSuggestionStates(),
      );
    });
  });

  test("deletes artifacts whose suggestion methods contradict their statuses", async () => {
    const currentMethod = '"id":"directional-divergence-attribute-effect","version":1';
    const retiredMethod = '"id":"unexpressed-concentration","version":1';
    const malformedArtifacts = [
      JSON.stringify(currentProfileDataWithSuggestions()).replace(currentMethod, retiredMethod),
      JSON.stringify(currentProfileDataWithSuggestions()).replace(retiredMethod, currentMethod),
      JSON.stringify(currentProfileDataWithSuggestions()).replace(
        currentMethod,
        '"id":"directional-divergence-attribute-effect","version":2',
      ),
      JSON.stringify(currentProfileDataWithSuggestions()).replace(
        retiredMethod,
        '"id":"unexpressed-concentration","version":2',
      ),
    ];

    for (const malformedArtifact of malformedArtifacts) {
      await withStorage(async ({ profilePath, createStorage }) => {
        await fs.writeFile(profilePath, malformedArtifact, "utf8");

        expect(await createStorage().loadProfile()).toBeNull();
        expect(await exists(profilePath)).toBe(false);
      });
    }
  });

  test("deletes artifacts with impossible insight cohorts", async () => {
    const valid = currentProfileDataWithSuggestions();
    const suggestion = valid.profile.suggestions[0];
    if (suggestion === undefined) throw new Error("Missing persisted suggestion fixture");
    const malformedCohorts = [
      { ...suggestion.cohort, includedGameCount: 5 },
      { ...suggestion.cohort, coveragePercent: 50 },
    ];

    for (const cohort of malformedCohorts) {
      await withStorage(async ({ profilePath, createStorage }) => {
        await fs.writeFile(
          profilePath,
          JSON.stringify({
            ...valid,
            profile: {
              ...valid.profile,
              suggestions: [{ ...suggestion, cohort }, ...valid.profile.suggestions.slice(1)],
            },
          }),
          "utf8",
        );

        expect(await createStorage().loadProfile()).toBeNull();
        expect(await exists(profilePath)).toBe(false);
      });
    }

    await withStorage(async ({ profilePath, createStorage }) => {
      await fs.writeFile(
        profilePath,
        JSON.stringify({ ...valid, profile: { ...valid.profile, gameCount: 5 } }),
        "utf8",
      );

      expect(await createStorage().loadProfile()).toBeNull();
      expect(await exists(profilePath)).toBe(false);
    });
  });

  test("deletes an artifact from an old algorithm version", async () => {
    await withStorage(async ({ profilePath, createStorage }) => {
      await fs.writeFile(
        profilePath,
        JSON.stringify({ ...currentProfileData(), algorithmVersion: 4 }),
        "utf8",
      );

      expect(await createStorage().loadProfile()).toBeNull();
      expect(await exists(profilePath)).toBe(false);
    });
  });

  test("deletes a current-version artifact containing a legacy unsupported suggestion", async () => {
    await withStorage(async ({ profilePath, createStorage }) => {
      const legacySuggestion = {
        source: "unexpressed-concentration",
        attribute: "Dice Rolling",
        reason: "Dice Rolling appears in 80% of the collection",
        evidence: { gameCount: 4, percentage: 80 },
      };
      await fs.writeFile(
        profilePath,
        JSON.stringify({
          ...currentProfileData(),
          profile: { ...emptyProfile(), suggestions: [legacySuggestion] },
        }),
        "utf8",
      );

      expect(await createStorage().loadProfile()).toBeNull();
      expect(await exists(profilePath)).toBe(false);
    });
  });

  test("deletes a current-version artifact containing a legacy centroid outlier", async () => {
    await withStorage(async ({ profilePath, createStorage }) => {
      const legacyOutlier = {
        gameId: "legacy-game",
        gameName: "Legacy Game",
        distances: { binary: 0.8, continuous: 0.6, personalAxes: 0.5, composite: 0.7 },
        classifications: ["lone-wolf"],
        fitnessScore: 6,
      };
      await fs.writeFile(
        profilePath,
        JSON.stringify({
          ...currentProfileData(),
          profile: { ...emptyProfile(), outliers: [legacyOutlier] },
        }),
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

  test("deletes an artifact containing non-finite insight evidence", async () => {
    await withStorage(async ({ profilePath, createStorage }) => {
      const data = currentProfileDataWithSuggestions();
      const raw = JSON.stringify(data).replace(
        '"observed":2,"required":6',
        '"observed":1e400,"required":6',
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
          contractVersion: 4,
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
