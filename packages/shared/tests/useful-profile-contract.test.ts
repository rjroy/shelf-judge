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
  CollectionProfileAttentionCardSchema,
  ProfileDataSchema,
  CURRENT_PROFILE_CONTRACT_VERSION,
  CURRENT_PROFILE_ALGORITHM_VERSION,
  intentionMutationResultMatchesCommand,
  type IntentionCommand,
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
    schemaVersion: 8,
    id: "collection",
    name: "Collection",
    axes: [],
    entertainmentBenchmark: null,
    createdAt: "2026-08-27T09:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
    revision: 1,
    games: [futureSourceGame("game-4")],
    intentions,
    attentionDispositions: [],
    commandReceipts,
  };
}

function attentionCard(
  gameId: string,
  gameName: string,
  ruleId: string,
  score: { numerator: string; denominator: string },
) {
  const card = structuredClone(usefulProfileFixture.attention.cards[0]);
  card.id = `attention:${gameId}:${ruleId}`;
  card.gameId = gameId;
  card.gameName = gameName;
  card.ruleId = ruleId;
  card.nonClockFingerprint = "b".repeat(64);
  card.signalStrength = score;
  card.categoryWeight = { numerator: "1", denominator: "1" };
  card.attentionScore = score;
  card.intention = ruleId === "explicit-intention" ? card.intention : null;
  card.evidence =
    ruleId === "explicit-intention"
      ? card.evidence
      : {
          kind: "play-count",
          value: 0,
          source: "manual",
          observedAt: "2026-08-27T10:00:00.000Z",
        };
  card.actions = [
    {
      action: "want-to-play",
      operationId: "shelf.game.intention.set",
      destination: { gameId, operationId: "shelf.game.intention.set" },
      command: null,
    },
    {
      action: "not-now",
      operationId: "shelf.profile.attention.not-now",
      destination: { gameId, operationId: "shelf.profile.attention.not-now" },
      command: {
        operation: "not-now",
        gameId,
        ruleId,
        ruleVersion: 1,
        fingerprint: "b".repeat(64),
        expectedVersion: 0,
      },
    },
    {
      action: "intentional",
      operationId: "shelf.profile.attention.intentional",
      destination: { gameId, operationId: "shelf.profile.attention.intentional" },
      command: {
        operation: "intentional",
        gameId,
        ruleId,
        ruleVersion: 1,
        fingerprint: "b".repeat(64),
        expectedVersion: 0,
      },
    },
    {
      action: "open-game",
      operationId: "shelf.game.get",
      destination: { gameId, operationId: "shelf.game.get" },
      command: null,
    },
  ];
  if (card.intention !== null) card.intention.gameId = gameId;
  return card;
}

describe("collection profile source contracts", () => {
  test("accepts ranked cards and only associates explicit-intention cards", () => {
    const attention = {
      id: "attention:game-4:never-played",
      gameId: "game-4",
      gameName: "Game",
      gameImageUrl: null,
      ruleId: "never-played",
      ruleVersion: 1,
      dependencyVersion: 1,
      nonClockFingerprint: "a".repeat(64),
      reason: "You have not recorded a play of Game.",
      question: "Do you want to make a plan to play it?",
      scoreExplanation: "Signal strength 1 × category weight 0.6 = attention score 0.6.",
      actions: [
        {
          action: "want-to-play",
          operationId: "shelf.game.intention.set",
          destination: { gameId: "game-4", operationId: "shelf.game.intention.set" },
          command: null,
        },
        {
          action: "not-now",
          operationId: "shelf.profile.attention.not-now",
          destination: { gameId: "game-4", operationId: "shelf.profile.attention.not-now" },
          command: {
            operation: "not-now",
            gameId: "game-4",
            ruleId: "never-played",
            ruleVersion: 1,
            fingerprint: "a".repeat(64),
            expectedVersion: 0,
          },
        },
        {
          action: "intentional",
          operationId: "shelf.profile.attention.intentional",
          destination: { gameId: "game-4", operationId: "shelf.profile.attention.intentional" },
          command: {
            operation: "intentional",
            gameId: "game-4",
            ruleId: "never-played",
            ruleVersion: 1,
            fingerprint: "a".repeat(64),
            expectedVersion: 0,
          },
        },
        {
          action: "open-game",
          operationId: "shelf.game.get",
          destination: { gameId: "game-4", operationId: "shelf.game.get" },
          command: null,
        },
        {
          action: "correct-play-data",
          operationId: "shelf.game.plays.set",
          destination: { gameId: "game-4", operationId: "shelf.game.plays.set" },
          command: null,
        },
      ],
      evidence: {
        kind: "play-count",
        value: 0,
        source: "manual",
        observedAt: "2026-08-27T10:00:00.000Z",
      },
      intention: null,
      disposition: { state: "none", expectedVersion: 0 },
      signalStrength: { numerator: "1", denominator: "1" },
      categoryWeight: { numerator: "3", denominator: "5" },
      attentionScore: { numerator: "3", denominator: "5" },
    };

    expect(CollectionProfileAttentionCardSchema.safeParse(attention).success).toBe(true);
    for (const gameImageUrl of [null, "https://example.com/game.jpg"]) {
      const parsed = CollectionProfileAttentionCardSchema.parse({ ...attention, gameImageUrl });
      expect(parsed.gameImageUrl).toBe(gameImageUrl);
    }
    expect(
      CollectionProfileAttentionCardSchema.safeParse({
        ...attention,
        gameImageUrl: "not a URL",
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileAttentionCardSchema.safeParse(
        Object.fromEntries(Object.entries(attention).filter(([key]) => key !== "gameImageUrl")),
      ).success,
    ).toBe(false);
    expect(
      CollectionProfileAttentionCardSchema.safeParse({
        ...attention,
        intention: activeIntentionFixture,
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileAttentionCardSchema.safeParse({
        ...attention,
        signalStrength: { numerator: "2", denominator: "1" },
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileAttentionCardSchema.safeParse({
        ...attention,
        attentionScore: { numerator: "1", denominator: "2" },
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileAttentionCardSchema.safeParse({
        ...attention,
        categoryWeight: { numerator: "6", denominator: "5" },
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileAttentionCardSchema.safeParse({
        ...attention,
        evidence: { source: "unbounded" },
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileAttentionCardSchema.safeParse({
        ...attention,
        disposition: { state: "snoozed", expectedVersion: 0 },
      }).success,
    ).toBe(false);
  });
  test("accepts migrated session storage in the current profile source without leaking it into historical validation", () => {
    const source = { ...futureSourceCollection(), bggPlaySessions: [] };
    expect(CollectionProfileCollectionSourceSchema.safeParse(source).success).toBe(true);
  });
  test("validates baseline-free Want to play and matches no-kind results without accepting invented legacy context", () => {
    const intention = { ...activeIntentionFixture, kind: "want-to-play" as const, baseline: null };
    const command: IntentionCommand = {
      type: "create",
      commandId,
      gameId: intention.gameId,
      expectedActiveIntention: "absent",
    };
    const result = { ok: true as const, commandId, intention, linkedOwnershipTransition: null };
    expect(PlayIntentionSchema.safeParse(intention).success).toBe(true);
    expect(
      IntentionCommandReceiptSchema.safeParse({ commandId, request: command, result }).success,
    ).toBe(true);
    expect(intentionMutationResultMatchesCommand(command, result)).toBe(true);
    expect(
      intentionMutationResultMatchesCommand(command, {
        ...result,
        intention: activeIntentionFixture,
      }),
    ).toBe(false);
    expect(
      IntentionCommandReceiptSchema.safeParse({
        commandId,
        request: command,
        result: { ...result, intention: activeIntentionFixture },
      }).success,
    ).toBe(false);
    expect(
      PlayIntentionSchema.safeParse({
        ...intention,
        version: 2,
        resolution: {
          outcome: "completed",
          source: "observed-play-increase",
          resolvedAt: "2026-08-29T10:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });
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
          observedAt: transition.baseline?.observedAt ?? game.playCountEvidence.observedAt,
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
              baseline:
                completed.baseline === null
                  ? { playCount: 0, evidenceSource: "manual", observedAt: completed.createdAt }
                  : { ...completed.baseline, evidenceSource: "manual" },
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
  test("accepts ranked attention, successful-empty attention, and unavailable", () => {
    expect(CollectionProfileResultSchema.safeParse(usefulProfileFixture).success).toBe(true);

    const nothing = structuredClone(usefulProfileFixture);
    nothing.attention = { state: "no-winner", cardLimit: 6, cards: [] };
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

  test("rejects Profile cards that are not globally ranked by exact score and tie-breaks", () => {
    const decreasingScore = structuredClone(usefulProfileFixture);
    decreasingScore.attention.cards = [
      attentionCard("game-b", "Beta", "rule-a", { numerator: "1", denominator: "2" }),
      attentionCard("game-a", "Alpha", "rule-b", { numerator: "3", denominator: "5" }),
    ];
    expect(CollectionProfileResultSchema.safeParse(decreasingScore).success).toBe(false);

    const nameInversion = structuredClone(usefulProfileFixture);
    nameInversion.attention.cards = [
      attentionCard("game-a", "Beta", "rule-a", { numerator: "1", denominator: "2" }),
      attentionCard("game-b", "Alpha", "rule-b", { numerator: "1", denominator: "2" }),
    ];
    expect(CollectionProfileResultSchema.safeParse(nameInversion).success).toBe(false);

    const nfcGameIdInversion = structuredClone(usefulProfileFixture);
    nfcGameIdInversion.attention.cards = [
      attentionCard("game-b", "e\u0301clair", "rule-a", { numerator: "1", denominator: "2" }),
      attentionCard("game-a", "éclair", "rule-b", { numerator: "1", denominator: "2" }),
    ];
    expect(CollectionProfileResultSchema.safeParse(nfcGameIdInversion).success).toBe(false);

    const ruleInversion = structuredClone(usefulProfileFixture);
    ruleInversion.attention.cards = [
      attentionCard("same-game", "Same", "z-rule", { numerator: "1", denominator: "2" }),
      attentionCard("same-game", "Same", "a-rule", { numerator: "1", denominator: "2" }),
    ];
    expect(CollectionProfileResultSchema.safeParse(ruleInversion).success).toBe(false);
  });

  test("requires real UTC calendar dates for dormant evidence", () => {
    const dormant = attentionCard("dormant-game", "Dormant", "dormant", {
      numerator: "1",
      denominator: "2",
    });
    dormant.evidence = { kind: "dormant", lastPlayedOn: "2024-02-29", playCount: 1 };
    expect(CollectionProfileAttentionCardSchema.safeParse(dormant).success).toBe(true);

    for (const lastPlayedOn of ["2023-02-29", "2024-02-30", "2024-13-01", "2024-00-01"]) {
      expect(
        CollectionProfileAttentionCardSchema.safeParse({
          ...dormant,
          evidence: { ...dormant.evidence, lastPlayedOn },
        }).success,
      ).toBe(false);
    }
  });

  test("rejects pre-ranked Profile cache versions and identities without the presentation cap", () => {
    const cache = {
      contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
      algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
      publicationIdentity: {
        source: {
          collectionId: "collection",
          collectionSchemaVersion: 8,
          collectionRevision: 1,
          tournamentHash: "a".repeat(64),
          predictionSettingsHash: "b".repeat(64),
          redundancySettingsHash: "c".repeat(64),
        },
        profileAttentionCardLimit: 6,
        attentionCandidates: {
          schemaVersion: 1,
          indexVersion: 1,
          evaluatedAt: "2026-08-27T12:00:00.000Z",
          identity: {
            collectionId: "collection",
            collectionSchemaVersion: 8,
            collectionRevision: 1,
            tournamentHash: "a".repeat(64),
            predictionSettingsHash: "b".repeat(64),
            redundancySettingsHash: "c".repeat(64),
            calculationVersion: 1,
            ruleCatalogVersion: 1,
            dependencyVersion: 1,
            projectionVersion: 1,
            catalogRuleVersions: [
              { ruleId: "dormant", ruleVersion: 1, scoringVersion: 1 },
              { ruleId: "explicit-intention", ruleVersion: 1, scoringVersion: 1 },
              { ruleId: "never-played", ruleVersion: 1, scoringVersion: 1 },
              { ruleId: "underused-purchase", ruleVersion: 1, scoringVersion: 1 },
            ],
          },
        },
      },
      profile: usefulProfileFixture,
      computedAt: usefulProfileFixture.computedAt,
    };
    expect(ProfileDataSchema.safeParse(cache).success).toBe(true);
    expect(
      ProfileDataSchema.safeParse({
        ...cache,
        contractVersion: CURRENT_PROFILE_CONTRACT_VERSION - 1,
      }).success,
    ).toBe(false);
    const { profileAttentionCardLimit: _limit, ...oldIdentity } = cache.publicationIdentity;
    expect(_limit).toBe(6);
    expect(
      ProfileDataSchema.safeParse({ ...cache, publicationIdentity: oldIdentity }).success,
    ).toBe(false);
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

    const mismatchedCardGame = structuredClone(source);
    mismatchedCardGame.games[3].name = "Different Heat";
    expect(
      CollectionProfileSnapshotSchema.safeParse({
        source: mismatchedCardGame,
        profile: usefulProfileFixture,
      }).success,
    ).toBe(false);
  });

  test("rejects impossible attention cards and score fields", () => {
    const resolved = structuredClone(usefulProfileFixture);
    if (resolved.attention.cards[0]?.intention === null)
      throw new Error("Expected explicit-intention fixture");
    resolved.attention.cards[0].intention.resolution = {
      outcome: "completed",
      source: "owner-confirmed",
      resolvedAt: "2026-08-27T12:00:00.000Z",
    };
    expect(CollectionProfileResultSchema.safeParse(resolved).success).toBe(false);

    const urgency = structuredClone(usefulProfileFixture) as unknown as Record<string, unknown>;
    const attention = urgency.attention as { cards: Array<Record<string, unknown>> };
    attention.cards[0].urgency = "high";
    expect(CollectionProfileResultSchema.safeParse(urgency).success).toBe(false);

    const contradictoryEmpty = structuredClone(usefulProfileFixture);
    contradictoryEmpty.attention.state = "no-winner";
    contradictoryEmpty.attention.cards = [structuredClone(usefulProfileFixture.attention.cards[0])];
    expect(CollectionProfileResultSchema.safeParse(contradictoryEmpty).success).toBe(false);

    const wrongIdentity = structuredClone(usefulProfileFixture);
    wrongIdentity.attention.cards[0].ruleId = "never-played";
    wrongIdentity.attention.cards[0].intention = null;
    expect(CollectionProfileResultSchema.safeParse(wrongIdentity).success).toBe(false);

    const invalidProduct = structuredClone(usefulProfileFixture);
    invalidProduct.attention.cards[0].attentionScore = { numerator: "1", denominator: "2" };
    expect(CollectionProfileResultSchema.safeParse(invalidProduct).success).toBe(false);
  });
});
