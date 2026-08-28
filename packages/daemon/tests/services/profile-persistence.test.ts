import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  AxisSuggestion,
  BggGameData,
  CollectionProfile,
  Game,
  ProfileData,
  ProfileNarration,
  ReportedInsightEvidenceGame,
} from "@shelf-judge/shared";
import {
  CollectionProfileSchema,
  createInitialEntityMetadata,
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
} from "@shelf-judge/shared";
import { trustedInsightProfileFixture } from "../../../shared/tests/fixtures/trusted-profile.js";
import { createProfileRoutes } from "../../src/routes/profile.js";
import { createFileOps } from "../../src/services/file-ops.js";
import { createProfileService } from "../../src/services/profile-service.js";
import { computeProfile } from "../../src/services/profile-engine.js";
import { createStorageService } from "../../src/services/storage-service.js";
import type { TournamentService } from "../../src/services/tournament-service.js";
import type { DisplayedFitnessService } from "../../src/services/displayed-fitness-service.js";

const COMPUTED_AT = "2026-08-27T12:00:00.000Z";

function emptyDisplayedFitnessService(): DisplayedFitnessService {
  return { listGames: () => Promise.resolve([]) };
}

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
      {
        key: "comparison-count",
        label: "Tournament comparisons",
        value: 10,
        unit: "comparisons",
        source: "Tournament comparisons",
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
      observation: "Area Control games average a 4.0 signed preference gap versus 0.0 without it",
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

function trustedProfileData(state: "reported" | "abstained"): ProfileData {
  const profile = structuredClone(trustedInsightProfileFixture);
  profile.computedAt = COMPUTED_AT;
  profile.divergence =
    profile.divergence?.filter((insight) =>
      state === "reported" ? insight.status === "reported" : insight.status !== "reported",
    ) ?? null;
  profile.outliers = profile.outliers.filter((insight) =>
    state === "reported" ? insight.status === "reported" : insight.status !== "reported",
  );
  profile.suggestions = profile.suggestions.filter((insight) =>
    state === "reported" ? insight.status === "reported" : insight.status !== "reported",
  );
  const narration: ProfileNarration =
    state === "reported"
      ? {
          summary: [
            {
              observation:
                "Game 3 is compositionally distant from its two nearest comparison games",
              interpretation: "Separately, its current preference fitness score is 8.0",
              evidenceReferences: [{ insightId: "outlier:game-3", gameIds: ["game-3"] }],
            },
          ],
          surprises: [],
          tensions: [
            {
              observation: "Tournament score is 4.0 points above independent fitness",
              interpretation:
                "Tournament choices favor this game more than the configured non-Tournament axes predict",
              evidenceReferences: [{ insightId: "divergence:game-1", gameIds: ["game-1"] }],
            },
          ],
          abstention: null,
        }
      : {
          summary: [],
          surprises: [],
          tensions: [],
          abstention: "No reported trusted insights are available to narrate.",
        };
  return {
    contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
    algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
    tournamentSettings: currentProfileData().tournamentSettings,
    profile: { ...profile, narration: null, narrationState: "empty" },
    computedAt: COMPUTED_AT,
    narration,
    narrationComputedAt: COMPUTED_AT,
  };
}

function bggData(overrides: Partial<BggGameData>): BggGameData {
  return {
    communityRating: 7.5,
    bayesAverage: 7,
    weight: 3,
    numWeightVotes: 100,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    bestPlayerCount: null,
    fetchedAt: "2026-08-27T10:00:00.000Z",
    ...overrides,
  };
}

function profileGame(index: number, outlier = false): Game {
  return {
    id: outlier ? "war" : `euro-${index}`,
    name: outlier ? "Long Wargame" : `Economic Game ${index}`,
    bggId: null,
    entityMetadata: createInitialEntityMetadata(null),
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: outlier ? 2 : 4,
    bestPlayers: null,
    playingTime: outlier ? 300 : 90,
    imageUrl: null,
    bggData: bggData({
      weight: outlier ? 4.8 : 3,
      mechanics: [
        outlier ? { id: 2, name: "Hex-and-Counter" } : { id: 1, name: "Worker Placement" },
      ],
      categories: [outlier ? { id: 11, name: "Wargame" } : { id: 10, name: "Economic" }],
    }),
    numPlays: null,
    latestPlayCountCheck: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: {
      status: "valid",
      value: outlier ? 300 : 90,
      source: "manual",
      observedAt: "2026-08-27T10:00:00.000Z",
    },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 2, maxPlayers: outlier ? 2 : 4 },
      source: "manual",
      observedAt: "2026-08-27T10:00:00.000Z",
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
  };
}

function silentLogger() {
  return { log() {}, warn() {}, error() {} };
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
  test("reloads a valid current-v7 artifact through a new storage instance", async () => {
    await withStorage(async ({ createStorage }) => {
      await createStorage().saveProfile(currentProfileData());

      const reloaded = await createStorage().loadProfile();
      expect(reloaded?.algorithmVersion).toBe(CURRENT_PROFILE_ALGORITHM_VERSION);
      expect(reloaded).toEqual(currentProfileData());
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

  test("reloads complete reported and abstained trusted profiles with grounded narration", async () => {
    for (const state of ["reported", "abstained"] as const) {
      await withStorage(async ({ createStorage }) => {
        const data = trustedProfileData(state);

        await createStorage().saveProfile(data);

        const reloaded = await createStorage().loadProfile();
        expect(reloaded).toEqual(data);
        expect(
          [
            ...(reloaded?.profile.divergence ?? []),
            ...(reloaded?.profile.outliers ?? []),
            ...(reloaded?.profile.suggestions ?? []),
          ].every((insight) => insight.status !== "reported" || insight.confidence === null),
        ).toBe(true);
      });
    }
  });

  test("serves deterministic computed evidence after persistence and a fresh service reload", async () => {
    await withStorage(async ({ createStorage }) => {
      const storage = createStorage();
      const collection = await storage.loadCollection();
      const games = [
        profileGame(1),
        profileGame(2),
        profileGame(3),
        profileGame(4),
        profileGame(5),
        profileGame(6, true),
      ];
      await storage.saveCollection({
        ...collection,
        games,
        updatedAt: "2026-08-27T10:00:00.000Z",
      });
      const tournament = await storage.loadTournament();
      const computed = computeProfile({
        games,
        axes: collection.axes,
        fitnessResults: new Map(),
        tournamentStats: null,
      });
      const reportedOutlier = computed.outliers.find((insight) => insight.status === "reported");
      if (reportedOutlier?.status !== "reported") throw new Error("Expected computed outlier");
      const narration: ProfileNarration = {
        summary: [
          {
            observation: reportedOutlier.observation,
            interpretation: reportedOutlier.interpretation,
            evidenceReferences: [
              { insightId: reportedOutlier.id, gameIds: [reportedOutlier.details.gameId] },
            ],
          },
        ],
        surprises: [],
        tensions: [],
        abstention: null,
      };
      await storage.saveProfile({
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
        algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
        tournamentSettings: tournament.settings,
        profile: {
          ...computed,
          narration: null,
          narrationState: "empty",
          computedAt: COMPUTED_AT,
        },
        computedAt: COMPUTED_AT,
        narration,
        narrationComputedAt: COMPUTED_AT,
      });

      const freshStorage = createStorage();
      const freshService = createProfileService({
        storageService: freshStorage,
        displayedFitnessService: emptyDisplayedFitnessService(),
        tournamentService: emptyTournamentService(),
      });
      const app = new Hono();
      app.route("/api", createProfileRoutes({ profileService: freshService }).routes);

      const response = await app.request("http://localhost/api/profile");
      const profile = CollectionProfileSchema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(profile.outliers).toContainEqual(reportedOutlier);
      expect(
        profile.outliers
          .filter((insight) => insight.status === "reported")
          .every((insight) => insight.evidence.every((game) => game.measurements.length > 0)),
      ).toBe(true);
      expect(profile.suggestions.some((insight) => insight.status !== "reported")).toBe(true);
      expect(profile.narration).toEqual(narration);
      expect(profile.narrationState).toBe("fresh");
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

  test("deletes current-v7 artifacts that violate reported insight evidence rules", async () => {
    const valid = JSON.stringify(trustedProfileData("reported"));
    const malformedArtifacts = [
      valid.replace('"supportingMeanGap":4', '"supportingMeanGap":3'),
      valid.replace('"dimension":"categories"', '"dimension":"mechanics"'),
      valid.replaceAll(
        '"confidence":null',
        '"confidence":{"level":"moderate","basis":"Count-only confidence"}',
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

  test("discards and recomputes an algorithm-v5 artifact under current producer semantics", async () => {
    await withStorage(async ({ profilePath, createStorage }) => {
      const algorithmV5 = JSON.stringify({
        ...trustedProfileData("reported"),
        algorithmVersion: 5,
      }).replaceAll(
        '"confidence":null',
        '"confidence":{"level":"moderate","basis":"Count-derived confidence from algorithm v5"}',
      );
      await fs.writeFile(profilePath, algorithmV5, "utf8");

      const service = createProfileService({
        storageService: createStorage(),
        displayedFitnessService: emptyDisplayedFitnessService(),
        tournamentService: emptyTournamentService(),
      });
      const recomputed = await service.getProfile();
      const persisted = await createStorage().loadProfile();

      expect(recomputed.gameCount).toBe(0);
      expect(persisted?.algorithmVersion).toBe(CURRENT_PROFILE_ALGORITHM_VERSION);
      expect(persisted?.profile).toEqual(recomputed);
      expect(await exists(profilePath)).toBe(true);
    });
  });

  test("discards and recomputes an algorithm-v6 artifact under current semantics", async () => {
    await withStorage(async ({ profilePath, createStorage }) => {
      await fs.writeFile(
        profilePath,
        JSON.stringify({ ...trustedProfileData("reported"), algorithmVersion: 6 }),
        "utf8",
      );

      const service = createProfileService({
        storageService: createStorage(),
        displayedFitnessService: emptyDisplayedFitnessService(),
        tournamentService: emptyTournamentService(),
      });
      const recomputed = await service.getProfile();
      const persisted = await createStorage().loadProfile();

      expect(recomputed.gameCount).toBe(0);
      expect(persisted?.algorithmVersion).toBe(CURRENT_PROFILE_ALGORITHM_VERSION);
      expect(persisted?.profile).toEqual(recomputed);
      expect(await exists(profilePath)).toBe(true);
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

  test("deletes persisted narration that does not match its profile evidence", async () => {
    await withStorage(async ({ profilePath, createStorage }) => {
      const data = currentProfileDataWithSuggestions();
      await fs.writeFile(
        profilePath,
        JSON.stringify({
          ...data,
          narration: {
            summary: [
              {
                observation: "Unsupported claim",
                interpretation: null,
                evidenceReferences: [
                  {
                    insightId: "axis-suggestion:suppressed:confounded",
                    gameIds: ["g1"],
                  },
                ],
              },
            ],
            surprises: [],
            tensions: [],
            abstention: null,
          },
          narrationComputedAt: COMPUTED_AT,
        }),
        "utf8",
      );

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
          contractVersion: 5,
          narration: oldNarration,
          narrationComputedAt: COMPUTED_AT,
        }),
        "utf8",
      );

      const storage = createStorage();
      const service = createProfileService({
        storageService: storage,
        displayedFitnessService: emptyDisplayedFitnessService(),
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
        summary: [],
        surprises: [],
        tensions: [],
        abstention: "No reported trusted insights are available to narrate.",
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
