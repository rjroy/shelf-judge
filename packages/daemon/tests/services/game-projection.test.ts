import { describe, expect, test } from "bun:test";
import type {
  CollectionV6,
  DurableGame,
  GameDetailWithPurchaseUtilization,
  GameWithPurchaseUtilization,
  PredictedGameResponse,
  TournamentNextPairResponse,
} from "@shelf-judge/shared";
import {
  createDormantGameDetailSnapshot,
  createDormantGameDetailSnapshotService,
  projectAddGameResult,
  projectGameDetailResponse,
  projectGameList,
  projectManualPlayCorrection,
  projectOwnershipMutation,
  projectPlayEvidenceMutation,
  projectPredictedGameResponse,
  projectProfileCollectionSource,
  projectPublicGame,
  projectPublicGameMutation,
  projectTournamentNextPair,
} from "../../src/services/game-projection.js";
import { profileSourceIdentity } from "../../src/services/profile-source-coordinator.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";

const SENTINEL = "OWNER-NOTE-SENTINEL-1d4.4";

describe("game projections", () => {
  test("physically removes owner notes from every broad game-bearing shape", async () => {
    const context = createTestApp({ now: () => "2026-08-31T12:00:00.000Z" });
    const addResponse = await jsonRequest(context.app, "POST", "/api/games", {
      name: "Projection Game",
    });
    const added = (await addResponse.json()) as { game: DurableGame; bggImported: boolean };
    const durableGame: DurableGame = {
      ...added.game,
      ownerNote: {
        state: "present",
        version: 1,
        updatedAt: "2026-08-31T12:01:00.000Z",
        text: SENTINEL,
      },
    };
    const listResponse = await jsonRequest(context.app, "GET", "/api/games");
    const [listEntry] = (await listResponse.json()) as GameWithPurchaseUtilization[];
    if (listEntry === undefined) throw new Error("Expected projected list fixture");
    const detailResponse = await jsonRequest(context.app, "GET", `/api/games/${durableGame.id}`);
    const detail = (await detailResponse.json()) as GameDetailWithPurchaseUtilization;
    const score = context.fitnessService.calculateScore(durableGame, [], {
      settings: {
        kFactorThreshold: 15,
        normalizationHalfWidth: 400,
        provisionalThreshold: 6,
      },
      sessions: [],
      gameStats: {},
    });
    if (score !== null) throw new Error("Expected no score without axes");

    const predicted: PredictedGameResponse = {
      game: durableGame,
      score: {
        score: 0,
        ratedAxisCount: 0,
        totalAxisCount: 0,
        breakdown: [],
        vetoed: false,
        vetoedBy: null,
        hypotheticalScore: null,
        predictionMeta: null,
        redundancyAdjustment: null,
      },
      predictionUnavailable: { reason: "stage-0", ratedGameCount: 0, gamesNeeded: 5 },
      redundancyPreview: null,
    };
    const stats = {
      eloRating: 1500,
      comparisonCount: 0,
      normalizedScore: null,
      isProvisional: true,
      displayLabel: "not yet ranked",
      wins: 0,
      losses: 0,
      recentComparisons: [],
    };
    const pair: TournamentNextPairResponse = {
      gameA: durableGame,
      gameB: { ...durableGame, id: "other-game", name: "Other Game" },
      gameAFitness: null,
      gameBFitness: null,
      gameAStats: stats,
      gameBStats: stats,
    };

    const projections = [
      projectPublicGame(durableGame),
      projectAddGameResult({ ...added, game: durableGame }),
      projectGameList([{ ...listEntry, game: durableGame }]),
      projectGameDetailResponse({ ...detail, game: durableGame }),
      projectPublicGameMutation(durableGame),
      projectPlayEvidenceMutation({ game: durableGame, linkedIntentionTransition: null }),
      projectManualPlayCorrection({
        ok: true,
        game: durableGame,
        linkedIntentionTransition: null,
      }),
      projectOwnershipMutation({ game: durableGame, linkedIntentionTransition: null }),
      projectPredictedGameResponse(predicted),
      projectTournamentNextPair(pair),
    ];

    for (const projection of projections) {
      const serialized = JSON.stringify(projection);
      expect(serialized).not.toContain("ownerNote");
      expect(serialized).not.toContain(SENTINEL);
    }
  });

  test("keeps Profile source and identity unchanged across note-only differences", async () => {
    const context = createTestApp();
    const game = (await context.gameService.addGame({ name: "Profile Game" })).game;
    const collection = await context.storageService.loadCollection();
    const withNoteA = {
      ...collection,
      games: [
        {
          ...game,
          ownerNote: {
            state: "present" as const,
            version: 1,
            updatedAt: "2026-08-31T12:01:00.000Z",
            text: SENTINEL,
          },
        },
      ],
    };
    const withNoteB = {
      ...collection,
      games: [
        {
          ...game,
          ownerNote: {
            state: "cleared" as const,
            version: 2,
            updatedAt: "2026-08-31T12:02:00.000Z",
          },
        },
      ],
    };
    const sourceA = projectProfileCollectionSource(withNoteA);
    const sourceB = projectProfileCollectionSource(withNoteB);
    const commonSources = {
      tournament: await context.storageService.loadTournament(),
      predictionSettings: await context.storageService.loadPredictionSettings(),
      redundancySettings: await context.storageService.loadRedundancySettings(),
    };

    expect(sourceA).toEqual(sourceB);
    expect(profileSourceIdentity({ collection: sourceA, ...commonSources })).toEqual(
      profileSourceIdentity({ collection: sourceB, ...commonSources }),
    );
    expect(JSON.stringify(sourceA)).not.toContain(SENTINEL);
  });

  test("prepares a complete-note detail snapshot without exposing notes to computation inputs", async () => {
    const context = createTestApp();
    const game = (await context.gameService.addGame({ name: "Detail Game" })).game;
    const collection = await context.storageService.loadCollection();
    const durable: CollectionV6 = {
      ...collection,
      schemaVersion: 6,
      games: [
        {
          ...game,
          ownerNote: {
            state: "present",
            version: 1,
            updatedAt: "2026-08-31T12:01:00.000Z",
            text: SENTINEL,
          },
        },
      ],
    };

    const snapshot = createDormantGameDetailSnapshot(durable, game.id);

    expect(snapshot.collectionRevision).toBe(collection.revision);
    expect(snapshot.game.ownerNote).toEqual(durable.games[0]?.ownerNote);
    expect(JSON.stringify(snapshot.collection)).not.toContain("ownerNote");
    expect(JSON.stringify(snapshot.collection)).not.toContain(SENTINEL);
  });

  test("captures dormant detail snapshots through the collection mutation coordinator", async () => {
    const context = createTestApp();
    const game = (await context.gameService.addGame({ name: "Serialized Detail" })).game;
    const collection = await context.storageService.loadCollection();
    const durable: CollectionV6 = {
      ...collection,
      schemaVersion: 6,
      games: [
        {
          ...game,
          ownerNote: { state: "missing", version: 0, updatedAt: null },
        },
      ],
    };
    let loads = 0;
    const reader = {
      loadCollection: () => {
        loads += 1;
        return Promise.resolve(durable);
      },
    };
    const service = createDormantGameDetailSnapshotService(reader);
    let releaseMutation!: () => void;
    const mutationBlocked = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    let mutationStarted!: () => void;
    const mutationStartedPromise = new Promise<void>((resolve) => {
      mutationStarted = resolve;
    });
    const mutation = profileSourceCoordinatorFor(reader).runExclusive(async () => {
      mutationStarted();
      await mutationBlocked;
    });
    await mutationStartedPromise;

    const capture = service.capture(game.id);
    await Promise.resolve();
    expect(loads).toBe(0);

    releaseMutation();
    await mutation;
    expect((await capture).collectionRevision).toBe(collection.revision);
    expect(loads).toBe(1);
  });
});
