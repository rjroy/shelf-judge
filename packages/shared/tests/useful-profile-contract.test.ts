import { describe, expect, expectTypeOf, test } from "bun:test";
import {
  EntityClassMetadataSchema,
  CollectionProfileCollectionSourceSchema,
  CollectionProfileSnapshotSchema,
  CollectionProfileResultSchema,
  IntentionCommandReceiptSchema,
  IntentionMutationResultSchema,
  ManualPlayCorrectionResultSchema,
  OwnershipMutationResultSchema,
  PlayEvidenceMutationResultSchema,
  PlayIntentionSchema,
  CollectionProfileEntityClassResultSchema,
  createCollectionProfileEntityClassResultSchema,
  ResolvedPlayIntentionHistorySchema,
  ResolvedPlayIntentionHistoryItemSchema,
  type CollectionProfileResult,
  type CollectionProfileGameSource,
  type IntentionMutationError,
  type IntentionMutationResult,
} from "../src/index";
import {
  activeIntentionFixture,
  canonicalUsefulProfileFixtures,
  mechanicClassFixture,
  usefulProfileFixture,
} from "./fixtures/useful-profile";

const commandId = "123e4567-e89b-42d3-a456-426614174000";

function futureSourceGame(
  id: string,
  ownership: "owned" | "previously-owned" = "owned",
  overrides: Partial<CollectionProfileGameSource> = {},
): CollectionProfileGameSource {
  const complete = {
    state: "complete" as const,
    entities: [],
    observedAt: "2026-08-27T12:00:00.000Z",
    refreshFailure: null,
    correctionDestination: null,
  };
  return {
    id,
    bggId: 1,
    name: "Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: 0,
    acquisition: { state: "unknown" },
    playCountEvidence: {
      status: "valid",
      value: 0,
      source: "manual",
      observedAt: "2026-08-27T10:00:00.000Z",
    },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    ownership,
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-08-27T09:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
    entityMetadata: { mechanic: complete, designer: complete, artist: complete },
    latestPlayCountCheck: null,
    ...overrides,
  };
}

function futureSourceCollection(
  intentions = [activeIntentionFixture],
  commandReceipts: unknown[] = [],
) {
  return {
    schemaVersion: 6,
    id: "collection",
    name: "Collection",
    axes: [],
    entertainmentBenchmark: null,
    createdAt: "2026-08-27T09:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
    revision: 1,
    games: [futureSourceGame("game-4")],
    intentions,
    commandReceipts,
  };
}

describe("collection profile source contracts", () => {
  test("validates linked play-evidence transitions against the returned game", () => {
    const completedAt = "2026-08-27T12:00:00.000Z";
    const game = futureSourceGame("game-4", "owned", {
      numPlays: 1,
      updatedAt: completedAt,
      playCountEvidence: {
        status: "valid",
        value: 1,
        source: "manual",
        observedAt: completedAt,
      },
    });
    const transition = {
      ...activeIntentionFixture,
      version: 2,
      resolution: {
        outcome: "completed" as const,
        source: "observed-play-increase" as const,
        resolvedAt: completedAt,
      },
    };
    expect(
      PlayEvidenceMutationResultSchema.safeParse({
        game,
        linkedIntentionTransition: transition,
      }).success,
    ).toBe(true);
    expect(
      PlayEvidenceMutationResultSchema.safeParse({
        game: futureSourceGame("other-game"),
        linkedIntentionTransition: transition,
      }).success,
    ).toBe(false);

    const rejected = [
      activeIntentionFixture,
      { ...transition, version: 1 },
      {
        ...transition,
        resolution: { ...transition.resolution, source: "owner-confirmed" as const },
      },
      {
        ...transition,
        resolution: {
          outcome: "retired" as const,
          source: "owner-retired" as const,
          resolvedAt: completedAt,
        },
      },
    ];
    for (const linkedIntentionTransition of rejected) {
      expect(
        PlayEvidenceMutationResultSchema.safeParse({ game, linkedIntentionTransition }).success,
      ).toBe(false);
    }
    for (const invalidGame of [
      { ...game, playCountEvidence: { ...game.playCountEvidence, value: 0 } },
      {
        ...game,
        playCountEvidence: {
          ...game.playCountEvidence,
          observedAt: transition.baseline.observedAt,
        },
      },
      { ...game, updatedAt: "not-a-date" },
    ]) {
      expect(
        PlayEvidenceMutationResultSchema.safeParse({
          game: invalidGame,
          linkedIntentionTransition: transition,
        }).success,
      ).toBe(false);
    }

    const newerValidCheck = {
      ...game,
      updatedAt: "2026-08-27T12:01:00.000Z",
      latestPlayCountCheck: {
        status: "valid" as const,
        value: 2,
        observedAt: "2026-08-27T12:01:00.000Z",
      },
    };
    expect(
      PlayEvidenceMutationResultSchema.safeParse({
        game: newerValidCheck,
        linkedIntentionTransition: {
          ...transition,
          resolution: { ...transition.resolution, resolvedAt: newerValidCheck.updatedAt },
        },
      }).success,
    ).toBe(false);

    const futureEvidence = {
      ...game,
      playCountEvidence: {
        ...game.playCountEvidence,
        observedAt: "2026-08-27T12:01:00.000Z",
      },
    };
    expect(
      PlayEvidenceMutationResultSchema.safeParse({
        game: futureEvidence,
        linkedIntentionTransition: transition,
      }).success,
    ).toBe(false);
  });

  test("accepts authoritative equal-time and retained-check play evidence", () => {
    const completedAt = "2026-08-27T12:00:00.000Z";
    const transition = {
      ...activeIntentionFixture,
      version: 2,
      resolution: {
        outcome: "completed" as const,
        source: "observed-play-increase" as const,
        resolvedAt: completedAt,
      },
    };
    const bggEvidence = futureSourceGame("game-4", "owned", {
      numPlays: 1,
      updatedAt: completedAt,
      playCountEvidence: {
        status: "valid",
        value: 1,
        source: "bgg-collection",
        observedAt: completedAt,
      },
      latestPlayCountCheck: { status: "valid", value: 1, observedAt: completedAt },
    });
    expect(
      PlayEvidenceMutationResultSchema.safeParse({
        game: bggEvidence,
        linkedIntentionTransition: transition,
      }).success,
    ).toBe(true);

    const retainedOlderCheck = futureSourceGame("game-4", "owned", {
      numPlays: 5,
      updatedAt: completedAt,
      playCountEvidence: {
        status: "valid",
        value: 5,
        source: "manual",
        observedAt: completedAt,
      },
      latestPlayCountCheck: {
        status: "valid",
        value: 4,
        observedAt: "2026-08-27T11:59:59.999Z",
      },
    });
    expect(
      PlayEvidenceMutationResultSchema.safeParse({
        game: retainedOlderCheck,
        linkedIntentionTransition: transition,
      }).success,
    ).toBe(true);

    const equalConflictingCheck = {
      ...retainedOlderCheck,
      latestPlayCountCheck: {
        status: "valid" as const,
        value: 4,
        observedAt: completedAt,
      },
    };
    expect(
      PlayEvidenceMutationResultSchema.safeParse({
        game: equalConflictingCheck,
        linkedIntentionTransition: transition,
      }).success,
    ).toBe(false);

    const equalUnavailableCheck = {
      ...retainedOlderCheck,
      latestPlayCountCheck: { status: "missing" as const, observedAt: completedAt },
    };
    expect(
      PlayEvidenceMutationResultSchema.safeParse({
        game: equalUnavailableCheck,
        linkedIntentionTransition: transition,
      }).success,
    ).toBe(true);
  });

  test("validates discriminated manual play correction outcomes", () => {
    const game = futureSourceGame("game-4", "owned");
    expect(
      ManualPlayCorrectionResultSchema.safeParse({
        ok: true,
        game,
        linkedIntentionTransition: null,
      }).success,
    ).toBe(true);
    expect(
      ManualPlayCorrectionResultSchema.safeParse({
        ok: false,
        error: {
          code: "non-monotonic-observation",
          gameId: "game-4",
          attemptedObservedAt: "2026-08-27T10:00:00.000Z",
          latestAcceptedAt: "2026-08-27T10:00:00.000Z",
        },
      }).success,
    ).toBe(true);
    expect(
      ManualPlayCorrectionResultSchema.safeParse({
        ok: false,
        error: {
          code: "non-monotonic-observation",
          gameId: "game-4",
          attemptedObservedAt: "2026-08-27T10:00:00.001Z",
          latestAcceptedAt: "2026-08-27T10:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });

  test("validates linked ownership retirement and null re-ownership responses", () => {
    const resolvedAt = "2026-08-27T12:00:00.000Z";
    const retired = {
      ...activeIntentionFixture,
      version: 2,
      resolution: {
        outcome: "retired" as const,
        source: "owner-retired" as const,
        resolvedAt,
      },
    };
    expect(
      OwnershipMutationResultSchema.safeParse({
        game: futureSourceGame("game-4", "previously-owned", { updatedAt: resolvedAt }),
        linkedIntentionTransition: retired,
      }).success,
    ).toBe(true);
    expect(
      OwnershipMutationResultSchema.safeParse({
        game: futureSourceGame("game-4", "owned"),
        linkedIntentionTransition: null,
      }).success,
    ).toBe(true);
    expect(
      OwnershipMutationResultSchema.safeParse({
        game: futureSourceGame("game-4", "owned", { updatedAt: resolvedAt }),
        linkedIntentionTransition: retired,
      }).success,
    ).toBe(false);
  });

  test("keeps active collection and profile aliases separate from future contracts", () => {
    expectTypeOf<CollectionProfileResult>().not.toEqualTypeOf<
      typeof usefulProfileFixture.identity
    >();
    expect(CollectionProfileResultSchema.safeParse(usefulProfileFixture).success).toBe(true);
  });

  test.each(["axisWeights", "narration", "gameCount"])(
    "rejects retired profile field %s at the strict current boundary",
    (field) => {
      expect(
        CollectionProfileResultSchema.safeParse({ ...usefulProfileFixture, [field]: null }).success,
      ).toBe(false);
    },
  );

  test("distinguishes complete-empty, refresh-needed, and unrefreshable entity metadata", () => {
    const complete = {
      state: "complete",
      entities: [],
      observedAt: "2026-08-27T12:00:00.000Z",
      refreshFailure: null,
      correctionDestination: null,
    };
    const refreshNeeded = {
      state: "refresh-needed",
      entities: [],
      observedAt: null,
      refreshFailure: null,
      correctionDestination: { operationId: "shelf.game.bgg.refresh" },
    };
    const unrefreshable = {
      state: "unrefreshable",
      entities: [],
      observedAt: null,
      refreshFailure: null,
      correctionDestination: null,
      explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
    };

    expect(EntityClassMetadataSchema.safeParse(complete).success).toBe(true);
    expect(EntityClassMetadataSchema.safeParse(refreshNeeded).success).toBe(true);
    expect(EntityClassMetadataSchema.safeParse(unrefreshable).success).toBe(true);
    expect(
      EntityClassMetadataSchema.safeParse({
        ...complete,
        entities: [
          { id: 1, name: "Deck Building" },
          { id: 1, name: "Renamed Deck Building" },
        ],
      }).success,
    ).toBe(false);
    expect(
      EntityClassMetadataSchema.safeParse({
        ...complete,
        refreshFailure: {
          attemptedAt: "2026-08-27T11:59:00.000Z",
          message: "Failure before success is contradictory",
        },
      }).success,
    ).toBe(false);
    expect(
      EntityClassMetadataSchema.safeParse({
        ...refreshNeeded,
        entities: [{ id: 1, name: "Fabricated" }],
      }).success,
    ).toBe(false);
  });

  test("retains factual latest BGG checks when newer manual evidence is current", () => {
    const latestPlayCountCheck = {
      status: "valid" as const,
      value: 4,
      observedAt: "2026-08-27T10:00:00.000Z",
    };
    expect(
      CollectionProfileCollectionSourceSchema.safeParse({
        ...futureSourceCollection([]),
        games: [
          futureSourceGame("game-4", "owned", {
            latestPlayCountCheck,
            numPlays: 3,
            playCountEvidence: {
              status: "valid",
              value: 3,
              source: "manual",
              observedAt: "2026-08-27T11:00:00.000Z",
            },
          }),
        ],
      }).success,
    ).toBe(true);
    expect(
      CollectionProfileCollectionSourceSchema.safeParse({
        ...futureSourceCollection([]),
        games: [
          futureSourceGame("game-4", "owned", {
            latestPlayCountCheck,
            playCountEvidence: {
              status: "valid",
              value: 3,
              source: "manual",
              observedAt: latestPlayCountCheck.observedAt,
            },
          }),
        ],
      }).success,
    ).toBe(false);
  });

  test("validates intention kinds, lifecycle, and one active intention per game", () => {
    expect(PlayIntentionSchema.safeParse(activeIntentionFixture).success).toBe(true);
    expect(
      PlayIntentionSchema.safeParse({
        ...activeIntentionFixture,
        kind: "replay",
      }).success,
    ).toBe(false);
    expect(
      PlayIntentionSchema.safeParse({
        ...activeIntentionFixture,
        resolution: {
          outcome: "retired",
          source: "owner-confirmed",
          resolvedAt: "2026-08-27T12:00:00.000Z",
        },
      }).success,
    ).toBe(false);
    expect(
      PlayIntentionSchema.safeParse({
        ...activeIntentionFixture,
        baseline: {
          ...activeIntentionFixture.baseline,
          observedAt: "2026-08-27T10:02:00.000Z",
        },
      }).success,
    ).toBe(false);

    const source = futureSourceCollection();
    expect(CollectionProfileCollectionSourceSchema.safeParse(source).success).toBe(true);
    expect(
      CollectionProfileCollectionSourceSchema.safeParse({
        ...source,
        intentions: [
          activeIntentionFixture,
          { ...activeIntentionFixture, intentionId: "intention-2" },
        ],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileCollectionSourceSchema.safeParse({
        ...source,
        games: [
          futureSourceGame("game-4", "owned", {
            playCountEvidence: {
              status: "missing",
              source: "manual",
              observedAt: null,
            },
            latestPlayCountCheck: {
              status: "missing",
              observedAt: "2026-08-27T12:00:00.000Z",
            },
          }),
        ],
        intentions: [],
      }).success,
    ).toBe(false);
    const mismatchedObservation = futureSourceGame("game-4");
    const artistMetadata = mismatchedObservation.entityMetadata.artist;
    if (artistMetadata.state !== "complete") throw new Error("Expected complete artist metadata");
    mismatchedObservation.entityMetadata.artist = {
      ...artistMetadata,
      observedAt: "2026-08-27T12:01:00.000Z",
    };
    expect(
      CollectionProfileCollectionSourceSchema.safeParse({
        ...source,
        games: [mismatchedObservation],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileCollectionSourceSchema.safeParse({
        ...source,
        games: [futureSourceGame("game-4", "previously-owned")],
      }).success,
    ).toBe(false);

    const noBgg = futureSourceGame("game-4", "owned", {
      bggId: null,
      entityMetadata: {
        mechanic: {
          state: "unrefreshable",
          entities: [],
          observedAt: null,
          refreshFailure: null,
          correctionDestination: null,
          explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
        },
        designer: {
          state: "unrefreshable",
          entities: [],
          observedAt: null,
          refreshFailure: null,
          correctionDestination: null,
          explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
        },
        artist: {
          state: "unrefreshable",
          entities: [],
          observedAt: null,
          refreshFailure: null,
          correctionDestination: null,
          explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
        },
      },
    });
    expect(
      CollectionProfileCollectionSourceSchema.safeParse({
        ...source,
        games: [noBgg],
      }).success,
    ).toBe(true);
    expect(
      CollectionProfileCollectionSourceSchema.safeParse({
        ...source,
        games: [{ ...futureSourceGame("game-4"), bggId: null }],
      }).success,
    ).toBe(false);
  });

  test("validates accepted command receipts against canonical requests and results", () => {
    const completed = {
      ...activeIntentionFixture,
      version: 2,
      resolution: {
        outcome: "completed" as const,
        source: "owner-confirmed" as const,
        resolvedAt: "2026-08-27T12:00:00.000Z",
      },
    };
    const receipt = {
      commandId,
      request: {
        type: "complete" as const,
        commandId,
        gameId: "game-4",
        intentionId: "intention-1",
        expectedVersion: 1,
      },
      result: {
        ok: true as const,
        commandId,
        intention: completed,
        linkedOwnershipTransition: null,
      },
    };

    expect(IntentionCommandReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(
      CollectionProfileCollectionSourceSchema.safeParse(
        futureSourceCollection([completed], [receipt]),
      ).success,
    ).toBe(true);
    expect(
      CollectionProfileCollectionSourceSchema.safeParse(
        futureSourceCollection(
          [
            {
              ...completed,
              baseline: { ...completed.baseline, evidenceSource: "manual" },
            },
          ],
          [receipt],
        ),
      ).success,
    ).toBe(false);
    expect(
      IntentionCommandReceiptSchema.safeParse({
        ...receipt,
        request: { ...receipt.request, intentionId: "different" },
      }).success,
    ).toBe(false);

    expect(
      IntentionCommandReceiptSchema.safeParse({
        ...receipt,
        result: {
          ...receipt.result,
          intention: {
            ...completed,
            resolution: {
              outcome: "completed",
              source: "observed-play-increase",
              resolvedAt: "2026-08-27T12:00:00.000Z",
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      IntentionCommandReceiptSchema.safeParse({
        ...receipt,
        result: {
          ...receipt.result,
          intention: { ...completed, version: 3 },
        },
      }).success,
    ).toBe(false);
  });

  test("accepts every structured mutation error family and rejects malformed variants", () => {
    const errors: IntentionMutationError[] = [
      { code: "validation", issues: [{ field: "kind", message: "Invalid kind" }] },
      { code: "game-not-found", gameId: "missing" },
      { code: "intention-not-found", gameId: "game-1", intentionId: "missing" },
      { code: "ineligible-game", gameId: "game-1", reason: "not-owned" },
      { code: "active-intention-conflict", gameId: "game-4", current: activeIntentionFixture },
      {
        code: "stale-version",
        gameId: "game-4",
        intentionId: "intention-1",
        expectedVersion: 1,
        current: {
          ...activeIntentionFixture,
          version: 2,
          resolution: {
            outcome: "retired",
            source: "owner-retired",
            resolvedAt: "2026-08-27T12:00:00.000Z",
          },
        },
      },
      { code: "command-reuse", commandId },
      { code: "history-conflict", gameId: "game-4", intentionIds: ["intention-1"] },
      { code: "persistence-failure", operation: "save", message: "Disk unavailable" },
    ];

    for (const error of errors) {
      const result = { ok: false, commandId, error } satisfies IntentionMutationResult;
      expect(IntentionMutationResultSchema.safeParse(result).success, error.code).toBe(true);
    }
    expect(
      IntentionMutationResultSchema.safeParse({
        ok: false,
        commandId,
        error: { code: "stale-version", gameId: "game-4", expectedVersion: 0 },
      }).success,
    ).toBe(false);
    expect(
      IntentionMutationResultSchema.safeParse({
        ok: false,
        commandId,
        error: {
          code: "stale-version",
          gameId: "game-4",
          intentionId: "intention-1",
          expectedVersion: 1,
          current: activeIntentionFixture,
        },
      }).success,
    ).toBe(false);
    expect(
      IntentionMutationResultSchema.safeParse({
        ok: false,
        commandId,
        error: {
          code: "active-intention-conflict",
          gameId: "different-game",
          current: activeIntentionFixture,
        },
      }).success,
    ).toBe(false);
    expect(
      IntentionMutationResultSchema.safeParse({
        ok: false,
        commandId,
        error: { code: "command-reuse", commandId: "123e4567-e89b-42d3-a456-426614174001" },
      }).success,
    ).toBe(false);
  });
});

describe("collection profile identity contract", () => {
  test.each(canonicalUsefulProfileFixtures)(
    "validates the canonical %s daemon result",
    (_label, profile) => {
      const parsed: CollectionProfileResult = CollectionProfileResultSchema.parse(
        structuredClone(profile),
      );
      expect(parsed).toEqual(profile);
    },
  );

  test("reproduces supported, limited, comparator, veto, and ordering evidence", () => {
    for (const entityClass of ["mechanic", "designer", "artist"] as const) {
      expect(
        CollectionProfileEntityClassResultSchema.safeParse({
          ...mechanicClassFixture,
          entityClass,
        }).success,
        entityClass,
      ).toBe(true);
    }
    expect(CollectionProfileResultSchema.safeParse(usefulProfileFixture).success).toBe(true);
    expect(mechanicClassFixture.comparator.games.at(-1)).toEqual({
      gameId: "game-3",
      gameName: "Gamma",
      currentFitness: 0,
      vetoed: true,
    });
  });

  test.each([
    [
      "non-finite aggregate",
      (value: typeof mechanicClassFixture) => (value.entities[0].meanCurrentFitness = Number.NaN),
    ],
    [
      "altered mean",
      (value: typeof mechanicClassFixture) => (value.entities[0].meanCurrentFitness = 7),
    ],
    [
      "non-finite adjusted mean",
      (value: typeof mechanicClassFixture) =>
        (value.entities[0].adjustedMeanCurrentFitness = Number.NaN),
    ],
    [
      "forged adjusted mean",
      (value: typeof mechanicClassFixture) =>
        (value.entities[0].adjustedMeanCurrentFitness = value.entities[0].meanCurrentFitness + 1),
    ],
    [
      "rounded adjusted mean",
      (value: typeof mechanicClassFixture) =>
        (value.entities[1].adjustedMeanCurrentFitness = 5.5 + 1e-12),
    ],
    [
      "noncanonical near-equal mean",
      (value: typeof mechanicClassFixture) => (value.entities[0].meanCurrentFitness += 1e-12),
    ],
    [
      "altered deviation",
      (value: typeof mechanicClassFixture) => (value.entities[0].populationStandardDeviation = 1),
    ],
    ["altered range", (value: typeof mechanicClassFixture) => (value.entities[0].range.max = 9)],
    [
      "altered comparator",
      (value: typeof mechanicClassFixture) => (value.comparator.meanCurrentFitness = 7),
    ],
    [
      "duplicate entity ID",
      (value: typeof mechanicClassFixture) =>
        (value.entities[1].entityId = value.entities[0].entityId),
    ],
    [
      "duplicate game contribution",
      (value: typeof mechanicClassFixture) =>
        value.entities[0].games.push(value.entities[0].games[0]),
    ],
    [
      "wrong best-fit order",
      (value: typeof mechanicClassFixture) => value.orderings.bestFit.reverse(),
    ],
    [
      "duplicate best-fit ID",
      (value: typeof mechanicClassFixture) => (value.orderings.bestFit = [102, 102]),
    ],
    [
      "missing best-fit ID",
      (value: typeof mechanicClassFixture) => (value.orderings.bestFit = [102]),
    ],
    [
      "extra best-fit ID",
      (value: typeof mechanicClassFixture) => value.orderings.bestFit.push(999),
    ],
    [
      "wrong support order",
      (value: typeof mechanicClassFixture) => value.orderings.support.reverse(),
    ],
    ["wrong name order", (value: typeof mechanicClassFixture) => value.orderings.name.reverse()],
    [
      "unsupported overview entity",
      (value: typeof mechanicClassFixture) => (value.overviewEntityIds = [102]),
    ],
  ])("rejects %s", (_label, mutate) => {
    const value = structuredClone(mechanicClassFixture);
    mutate(value);
    expect(CollectionProfileEntityClassResultSchema.safeParse(value).success).toBe(false);
  });

  test("rejects a missing adjusted value and an overview copied from diagnostic support order", () => {
    const missingAdjusted = structuredClone(mechanicClassFixture);
    Reflect.deleteProperty(missingAdjusted.entities[0], "adjustedMeanCurrentFitness");
    expect(CollectionProfileEntityClassResultSchema.safeParse(missingAdjusted).success).toBe(false);

    const policy = {
      mechanic: { overviewLimit: 3, minimumSupportedGames: 1 },
      designer: { overviewLimit: 3, minimumSupportedGames: 3 },
      artist: { overviewLimit: 3, minimumSupportedGames: 3 },
    };
    const supportOrderedOverview = structuredClone(mechanicClassFixture);
    supportOrderedOverview.entities[1].support = "supported";
    supportOrderedOverview.entities[1].adjustedMeanCurrentFitness = 19 / 3;
    supportOrderedOverview.overviewEntityIds = [101, 102];

    expect(
      createCollectionProfileEntityClassResultSchema(policy).safeParse(supportOrderedOverview)
        .success,
    ).toBe(false);
  });

  test("reconstructs adjusted ordering independently when raw mean would rank first", () => {
    const evidence = (index: number, currentFitness: number) => ({
      gameId: `adjusted-${String(index).padStart(2, "0")}`,
      gameName: `Adjusted ${index}`,
      currentFitness,
      vetoed: currentFitness === 0,
    });
    const alphaGames = [evidence(0, 9), evidence(1, 9), evidence(2, 9)];
    const betaGames = Array.from({ length: 20 }, (_, index) => evidence(index + 3, 8.9));
    const comparatorGames = [
      ...alphaGames,
      ...betaGames,
      evidence(23, 5),
      ...Array.from({ length: 6 }, (_, index) => evidence(index + 24, 0)),
    ];
    const result = {
      entityClass: "mechanic" as const,
      result: "supported" as const,
      metadataReadiness: {
        state: "complete" as const,
        ownedGameCount: 30,
        completeGameCount: 30,
        refreshNeededGameCount: 0,
        unrefreshableGameCount: 0,
      },
      associatedGameCount: 23,
      comparator: { gameCount: 30, meanCurrentFitness: 7, games: comparatorGames },
      exclusions: [],
      refreshWarnings: [],
      entities: [
        {
          entityId: 100,
          name: "Alpha",
          support: "supported" as const,
          associatedGameCount: 3,
          meanCurrentFitness: 9,
          adjustedMeanCurrentFitness: 8,
          populationStandardDeviation: 0,
          range: { min: 9, max: 9 },
          comparatorMeanCurrentFitness: 7,
          differenceFromComparator: 2,
          games: alphaGames,
        },
        {
          entityId: 200,
          name: "Beta",
          support: "supported" as const,
          associatedGameCount: 20,
          meanCurrentFitness: 8.9,
          adjustedMeanCurrentFitness: 199 / 23,
          populationStandardDeviation: 0,
          range: { min: 8.9, max: 8.9 },
          comparatorMeanCurrentFitness: 7,
          differenceFromComparator: 1.9000000000000004,
          games: betaGames,
        },
      ],
      overviewEntityIds: [200, 100],
      orderings: { bestFit: [200, 100], support: [200, 100], name: [100, 200] },
    };
    expect(CollectionProfileEntityClassResultSchema.safeParse(result).success).toBe(true);

    result.orderings.bestFit = [100, 200];
    result.overviewEntityIds = [100, 200];
    expect(CollectionProfileEntityClassResultSchema.safeParse(result).success).toBe(false);
  });

  test("rejects comparator membership and exclusion contradictions", () => {
    const missingComparatorGame = structuredClone(mechanicClassFixture);
    missingComparatorGame.comparator.games.splice(0, 1);
    missingComparatorGame.comparator.gameCount = 2;
    missingComparatorGame.comparator.meanCurrentFitness = 3;
    expect(CollectionProfileEntityClassResultSchema.safeParse(missingComparatorGame).success).toBe(
      false,
    );

    const duplicateExclusion = structuredClone(mechanicClassFixture);
    duplicateExclusion.exclusions = [
      {
        gameId: "game-5",
        gameName: "Excluded",
        reason: "predicted-fitness",
        hasEntityAssociation: true,
        correctionDestination: null,
      },
      {
        gameId: "game-5",
        gameName: "Excluded",
        reason: "missing-or-invalid-fitness",
        hasEntityAssociation: true,
        correctionDestination: null,
      },
    ];
    expect(CollectionProfileEntityClassResultSchema.safeParse(duplicateExclusion).success).toBe(
      false,
    );

    const mismatchedEvidence = structuredClone(mechanicClassFixture);
    mismatchedEvidence.entities[0].games[0] = {
      ...mismatchedEvidence.entities[0].games[0],
      gameName: "Different Alpha",
    };
    expect(CollectionProfileEntityClassResultSchema.safeParse(mismatchedEvidence).success).toBe(
      false,
    );

    const unorderedEvidence = structuredClone(mechanicClassFixture);
    unorderedEvidence.comparator.games.reverse();
    expect(CollectionProfileEntityClassResultSchema.safeParse(unorderedEvidence).success).toBe(
      false,
    );
  });

  test("accepts mixed metadata readiness without erasing usable class evidence", () => {
    const mixed = structuredClone(mechanicClassFixture);
    mixed.result = "limited";
    mixed.metadataReadiness = {
      state: "partial",
      ownedGameCount: 3,
      completeGameCount: 1,
      refreshNeededGameCount: 1,
      unrefreshableGameCount: 1,
    };
    mixed.associatedGameCount = 1;
    mixed.comparator = {
      gameCount: 1,
      meanCurrentFitness: 8,
      games: [mixed.comparator.games[0]],
    };
    mixed.exclusions = [
      {
        gameId: "game-2",
        gameName: "Beta",
        reason: "refresh-needed-metadata",
        hasEntityAssociation: false,
        correctionDestination: { operationId: "shelf.game.bgg.refresh" },
      },
      {
        gameId: "game-3",
        gameName: "Gamma",
        reason: "unrefreshable-metadata",
        hasEntityAssociation: false,
        correctionDestination: null,
      },
    ];
    mixed.refreshWarnings = [
      {
        gameId: "game-1",
        gameName: "Alpha",
        attemptedAt: "2026-08-27T12:00:00.000Z",
        message: "BGG refresh failed; using the last complete observation",
      },
    ];
    mixed.entities = [
      {
        ...mixed.entities[1],
        adjustedMeanCurrentFitness: 8,
        comparatorMeanCurrentFitness: 8,
        differenceFromComparator: 0,
      },
    ];
    mixed.overviewEntityIds = [];
    mixed.orderings = { bestFit: [102], support: [102], name: [102] };

    expect(CollectionProfileEntityClassResultSchema.safeParse(mixed).success).toBe(true);
  });

  test("uses normalized Unicode code-point names and entity IDs to break ties", () => {
    const tied = structuredClone(mechanicClassFixture);
    tied.result = "limited";
    tied.associatedGameCount = 1;
    tied.metadataReadiness = {
      state: "complete",
      ownedGameCount: 1,
      completeGameCount: 1,
      refreshNeededGameCount: 0,
      unrefreshableGameCount: 0,
    };
    tied.comparator = {
      gameCount: 1,
      meanCurrentFitness: 8,
      games: [tied.comparator.games[0]],
    };
    tied.exclusions = [];
    const base = {
      ...tied.entities[1],
      adjustedMeanCurrentFitness: 8,
      comparatorMeanCurrentFitness: 8,
      differenceFromComparator: 0,
    };
    tied.entities = [
      { ...base, entityId: 202, name: "e\u0301" },
      { ...base, entityId: 201, name: "é" },
    ];
    tied.overviewEntityIds = [];
    tied.orderings = { bestFit: [201, 202], support: [201, 202], name: [201, 202] };

    expect(CollectionProfileEntityClassResultSchema.safeParse(tied).success).toBe(true);
  });

  test("requires all three classes to describe the same owned games", () => {
    const profile = structuredClone(usefulProfileFixture);
    profile.identity.classes.designer.exclusions[0].gameName = "A different game";
    expect(CollectionProfileResultSchema.safeParse(profile).success).toBe(false);
  });
});

describe("collection profile attention contract", () => {
  test("accepts active attention, resolved history, nothing-to-decide, and unavailable", () => {
    expect(CollectionProfileResultSchema.safeParse(usefulProfileFixture).success).toBe(true);

    const nothing = structuredClone(usefulProfileFixture);
    nothing.attention = { state: "nothing-to-decide", items: [] };
    expect(CollectionProfileResultSchema.safeParse(nothing).success).toBe(true);

    expect(
      CollectionProfileResultSchema.safeParse({
        status: "unavailable",
        error: { kind: "recomputation", message: "Could not compute current profile" },
        retryDestination: { operationId: "shelf.profile.get" },
      }).success,
    ).toBe(true);

    expect(
      ResolvedPlayIntentionHistoryItemSchema.safeParse({
        ...activeIntentionFixture,
        gameName: "Heat",
        version: 2,
        resolution: {
          outcome: "retired",
          source: "owner-retired",
          resolvedAt: "2026-08-27T12:00:00.000Z",
        },
      }).success,
    ).toBe(true);
  });

  test("orders resolved history by resolution time descending then intention ID", () => {
    const history = [
      {
        ...activeIntentionFixture,
        intentionId: "intention-b",
        gameName: "Heat",
        version: 2,
        resolution: {
          outcome: "completed" as const,
          source: "owner-confirmed" as const,
          resolvedAt: "2026-08-28T12:00:00.000Z",
        },
      },
      {
        ...activeIntentionFixture,
        intentionId: "intention-a",
        gameName: "Heat",
        version: 2,
        resolution: {
          outcome: "retired" as const,
          source: "owner-retired" as const,
          resolvedAt: "2026-08-27T12:00:00.000Z",
        },
      },
    ];
    expect(ResolvedPlayIntentionHistorySchema.safeParse(history).success).toBe(true);
    expect(ResolvedPlayIntentionHistorySchema.safeParse([...history].reverse()).success).toBe(
      false,
    );

    const sameTime = structuredClone(history);
    sameTime[1].resolution.resolvedAt = sameTime[0].resolution.resolvedAt;
    expect(ResolvedPlayIntentionHistorySchema.safeParse(sameTime).success).toBe(false);
    expect(ResolvedPlayIntentionHistorySchema.safeParse([...sameTime].reverse()).success).toBe(
      true,
    );
  });

  test("validates attention and canonical names against the durable source snapshot", () => {
    const metadata = (
      entities: Array<{ id: number; name: string }>,
    ): CollectionProfileGameSource["entityMetadata"] => {
      const complete = {
        state: "complete" as const,
        entities: [],
        observedAt: "2026-08-27T12:00:00.000Z",
        refreshFailure: null,
        correctionDestination: null,
      };
      return { mechanic: { ...complete, entities }, designer: complete, artist: complete };
    };
    const source = {
      ...futureSourceCollection(),
      games: [
        futureSourceGame("game-1", "owned", {
          name: "Alpha",
          entityMetadata: metadata([
            { id: 101, name: "Worker Placement" },
            { id: 102, name: "Solo" },
          ]),
        }),
        futureSourceGame("game-2", "owned", {
          name: "Beta",
          entityMetadata: metadata([{ id: 101, name: "Worker Placement" }]),
        }),
        futureSourceGame("game-3", "owned", {
          name: "Gamma",
          entityMetadata: metadata([{ id: 101, name: "Worker Placement" }]),
        }),
        futureSourceGame("game-4", "owned", {
          name: "Heat",
          playCountEvidence: {
            status: "valid",
            value: 0,
            source: "bgg-collection",
            observedAt: "2026-08-27T10:00:00.000Z",
          },
        }),
      ],
    };
    expect(
      CollectionProfileSnapshotSchema.safeParse({ source, profile: usefulProfileFixture }).success,
    ).toBe(true);

    expect(
      CollectionProfileSnapshotSchema.safeParse({
        source: { ...source, intentions: [] },
        profile: usefulProfileFixture,
      }).success,
    ).toBe(false);

    const wrongName = structuredClone(usefulProfileFixture);
    wrongName.identity.classes.mechanic.entities[0].name = "Old Worker Placement Name";
    wrongName.identity.classes.mechanic.orderings.name = [102, 101];
    expect(CollectionProfileSnapshotSchema.safeParse({ source, profile: wrongName }).success).toBe(
      false,
    );

    const missingMembership = structuredClone(source);
    const gameTwoMetadata = missingMembership.games[1].entityMetadata.mechanic;
    if (gameTwoMetadata.state !== "complete")
      throw new Error("Expected complete mechanic metadata");
    gameTwoMetadata.entities = [];
    expect(
      CollectionProfileSnapshotSchema.safeParse({
        source: missingMembership,
        profile: usefulProfileFixture,
      }).success,
    ).toBe(false);

    const mismatchedPlayEvidence = structuredClone(source);
    mismatchedPlayEvidence.games[3].playCountEvidence = {
      status: "valid",
      value: 0,
      source: "manual",
      observedAt: "2026-08-27T10:00:00.000Z",
    };
    expect(
      CollectionProfileSnapshotSchema.safeParse({
        source: mismatchedPlayEvidence,
        profile: usefulProfileFixture,
      }).success,
    ).toBe(false);
  });

  test("rejects impossible attention cards and urgency fields", () => {
    const wrongQuestion = structuredClone(usefulProfileFixture);
    wrongQuestion.attention.items[0].question = "Should you sell Heat?";
    expect(CollectionProfileResultSchema.safeParse(wrongQuestion).success).toBe(false);

    const resolved = structuredClone(usefulProfileFixture);
    resolved.attention.items[0].intention.resolution = {
      outcome: "completed",
      source: "owner-confirmed",
      resolvedAt: "2026-08-27T12:00:00.000Z",
    };
    expect(CollectionProfileResultSchema.safeParse(resolved).success).toBe(false);

    const urgency = structuredClone(usefulProfileFixture) as unknown as Record<string, unknown>;
    const attention = urgency.attention as { items: Array<Record<string, unknown>> };
    attention.items[0].urgency = "high";
    expect(CollectionProfileResultSchema.safeParse(urgency).success).toBe(false);

    const contradictoryEmpty = structuredClone(usefulProfileFixture);
    contradictoryEmpty.attention.state = "nothing-to-decide";
    expect(CollectionProfileResultSchema.safeParse(contradictoryEmpty).success).toBe(false);

    const alreadyCompletedByEvidence = structuredClone(usefulProfileFixture);
    alreadyCompletedByEvidence.attention.items[0].currentPlayEvidence.playCount = 1;
    expect(CollectionProfileResultSchema.safeParse(alreadyCompletedByEvidence).success).toBe(false);
  });
});
