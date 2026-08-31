import { describe, expect, test } from "bun:test";
import {
  AddGameResultSchema,
  CollectionGameV5Schema,
  CollectionProfileCollectionSourceV6Schema,
  CollectionProfileSourceRecordsSchema,
  CollectionSchema,
  CollectionSchemaV5,
  CollectionSchemaV6,
  DurableGameSchema,
  GameDetailGameSchema,
  GameListResponseSchema,
  GameSchema,
  GameWithPurchaseUtilizationSchema,
  GameWithScoreSchema,
  OwnerGameNoteAcceptedMetadataSchema,
  OwnerGameNoteClearRequestSchema,
  OwnerGameNoteCommandReceiptSchema,
  OwnerGameNoteMutationErrorSchema,
  OwnerGameNoteMutationResultSchema,
  OwnerGameNoteReadResultSchema,
  OwnerGameNoteDetailWithPurchaseUtilizationSchema,
  OwnerGameNoteSchema,
  OwnerGameNoteSetRequestSchema,
  OwnerGameNoteTextSchema,
  PublicGameMutationResultSchema,
  PredictedGameResponseSchema,
  TournamentNextPairResponseSchema,
  canonicalizeOwnerGameNoteRequest,
  countOwnerGameNoteCodePoints,
  normalizeOwnerGameNoteText,
} from "../src/index";
import {
  canonicalAcceptedIntentionMutation,
  canonicalActiveIntention,
  canonicalIntentionCommandId,
} from "./fixtures/intention-mutation";
import {
  canonicalOwnerNoteCommandId,
  canonicalOwnerNoteReceipt,
  canonicalPublicGame,
  clearedOwnerNote,
  missingOwnerNote,
  presentOwnerNote,
} from "./fixtures/owner-game-note-mutation";
import { canonicalUtilizationCases } from "../../../test-fixtures/purchase-utilization-responses";

describe("owner note state contracts", () => {
  test.each([missingOwnerNote, presentOwnerNote, clearedOwnerNote])(
    "accepts canonical $state state",
    (note) => {
      expect(OwnerGameNoteSchema.parse(note)).toEqual(note);
    },
  );

  test.each([
    { ...missingOwnerNote, text: "unexpected" },
    { ...missingOwnerNote, version: 1 },
    { ...missingOwnerNote, updatedAt: "2026-08-30T12:00:00.000Z" },
    { state: "present", version: 0, updatedAt: "2026-08-30T12:00:00.000Z", text: "x" },
    { state: "present", version: 1, updatedAt: null, text: "x" },
    { state: "cleared", version: 1, updatedAt: "2026-08-30", text: "retained" },
    { ...clearedOwnerNote, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...clearedOwnerNote, extra: true },
  ])("rejects invalid or non-strict state %#", (note) => {
    expect(OwnerGameNoteSchema.safeParse(note).success).toBe(false);
  });

  test("requires identities on dedicated reads and the complete note state", () => {
    expect(
      OwnerGameNoteReadResultSchema.safeParse({ gameId: "game-1", note: presentOwnerNote }).success,
    ).toBe(true);
    expect(OwnerGameNoteReadResultSchema.safeParse({ gameId: "game-1" }).success).toBe(false);
    expect(
      OwnerGameNoteReadResultSchema.safeParse({
        gameId: "game-1",
        note: presentOwnerNote,
        text: "unexpected duplicate text",
      }).success,
    ).toBe(false);
  });
});

describe("owner note text contract", () => {
  test("normalizes CRLF and bare CR to LF without trimming or Unicode normalization", () => {
    const source = "  cafe\u0301\r\nsecond\rthird  ";
    const expected = "  cafe\u0301\nsecond\nthird  ";
    expect(normalizeOwnerGameNoteText(source)).toBe(expected);
    expect(OwnerGameNoteTextSchema.parse(source)).toBe(expected);
    expect(OwnerGameNoteTextSchema.parse(source)).not.toBe(expected.normalize("NFC"));
  });

  test("counts Unicode code points rather than UTF-16 code units", () => {
    expect(countOwnerGameNoteCodePoints("A😀e\u0301")).toBe(4);
    expect(OwnerGameNoteTextSchema.safeParse("😀".repeat(10_000)).success).toBe(true);
    expect(OwnerGameNoteTextSchema.safeParse("😀".repeat(10_001)).success).toBe(false);
  });

  test.each(["", " \t\n", "\u00a0\u2003", "contains\0nul", "bad\u0007control"])(
    "rejects invalid text %p",
    (text) => {
      expect(OwnerGameNoteTextSchema.safeParse(text).success).toBe(false);
    },
  );

  test.each(["\tIndented\ntext", "<script>alert(1)</script>", "[label](javascript:alert(1))"])(
    "accepts inert plain text %p",
    (text) => {
      expect(OwnerGameNoteTextSchema.parse(text)).toBe(text);
    },
  );
});

describe("owner note operation contracts", () => {
  const accepted = {
    commandId: canonicalOwnerNoteCommandId,
    gameId: "game-1",
    operation: "set" as const,
    state: "present" as const,
    version: 1,
    updatedAt: "2026-08-30T12:00:00.000Z",
    collectionRevision: 2,
    replayed: false,
    alreadyClear: false,
  };

  test("strictly parses set and clear bodies without accepting route-owned game IDs", () => {
    const set = {
      commandId: canonicalOwnerNoteCommandId,
      expectedVersion: 0,
      text: "first\r\nsecond",
    };
    expect(OwnerGameNoteSetRequestSchema.parse(set).text).toBe("first\nsecond");
    expect(OwnerGameNoteSetRequestSchema.safeParse({ ...set, gameId: "game-1" }).success).toBe(
      false,
    );
    expect(
      OwnerGameNoteClearRequestSchema.safeParse({
        commandId: canonicalOwnerNoteCommandId,
        expectedVersion: 0,
      }).success,
    ).toBe(true);
    expect(OwnerGameNoteClearRequestSchema.safeParse({ ...set, text: "x" }).success).toBe(false);
  });

  test("keeps accepted mutation results metadata-only", () => {
    expect(OwnerGameNoteAcceptedMetadataSchema.safeParse(accepted).success).toBe(true);
    expect(
      OwnerGameNoteAcceptedMetadataSchema.safeParse({ ...accepted, collectionRevision: 0 }).success,
    ).toBe(false);
    expect(
      OwnerGameNoteMutationResultSchema.safeParse({
        ok: true,
        accepted: { ...accepted, text: "x" },
      }).success,
    ).toBe(false);
    expect(
      OwnerGameNoteAcceptedMetadataSchema.safeParse({
        ...accepted,
        operation: "clear",
        state: "missing",
        version: 0,
        updatedAt: null,
        alreadyClear: true,
      }).success,
    ).toBe(true);
    expect(
      OwnerGameNoteAcceptedMetadataSchema.safeParse({
        ...accepted,
        operation: "set",
        state: "cleared",
      }).success,
    ).toBe(false);
  });

  test("validates all error identities and complete stale state", () => {
    expect(
      OwnerGameNoteMutationErrorSchema.safeParse({
        code: "stale-version",
        gameId: "game-1",
        expectedVersion: 0,
        current: presentOwnerNote,
      }).success,
    ).toBe(true);
    expect(
      OwnerGameNoteMutationErrorSchema.safeParse({
        code: "stale-version",
        gameId: "game-1",
        expectedVersion: 1,
        current: presentOwnerNote,
      }).success,
    ).toBe(false);
    expect(
      OwnerGameNoteMutationResultSchema.safeParse({
        ok: false,
        commandId: canonicalOwnerNoteCommandId,
        error: { code: "command-reuse", commandId: "55000000-0000-4000-8000-000000000001" },
      }).success,
    ).toBe(false);
  });

  test("constructs a domain-separated canonical request after LF normalization", () => {
    const first = canonicalizeOwnerGameNoteRequest({
      operation: "set",
      gameId: "game-1",
      commandId: canonicalOwnerNoteCommandId,
      expectedVersion: 2,
      text: "one\r\ntwo",
    });
    const replay = canonicalizeOwnerGameNoteRequest({
      operation: "set",
      gameId: "game-1",
      commandId: "55000000-0000-4000-8000-000000000001",
      expectedVersion: 2,
      text: "one\ntwo",
    });
    expect(first).toBe(replay);
    expect(first.startsWith("shelf-judge.owner-game-note.v1\n")).toBe(true);
    expect(first).not.toContain(canonicalOwnerNoteCommandId);
  });
});

describe("owner note receipt and collection contracts", () => {
  const sourceGame = {
    gameId: canonicalPublicGame.id,
    entityMetadata: canonicalPublicGame.entityMetadata,
    latestPlayCountCheck: canonicalPublicGame.latestPlayCountCheck,
  };

  test("accepts text-free receipts and rejects mutation text or replay-only metadata", () => {
    expect(OwnerGameNoteCommandReceiptSchema.safeParse(canonicalOwnerNoteReceipt).success).toBe(
      true,
    );
    expect(
      OwnerGameNoteCommandReceiptSchema.safeParse({ ...canonicalOwnerNoteReceipt, text: "secret" })
        .success,
    ).toBe(false);
    expect(
      OwnerGameNoteCommandReceiptSchema.safeParse({
        ...canonicalOwnerNoteReceipt,
        accepted: { ...canonicalOwnerNoteReceipt.accepted, replayed: false },
      }).success,
    ).toBe(false);
    expect(
      OwnerGameNoteCommandReceiptSchema.safeParse({
        ...canonicalOwnerNoteReceipt,
        requestFingerprint: "A".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      OwnerGameNoteCommandReceiptSchema.safeParse({
        ...canonicalOwnerNoteReceipt,
        accepted: { ...canonicalOwnerNoteReceipt.accepted, collectionRevision: 0 },
      }).success,
    ).toBe(false);
  });

  test("rejects orphan and duplicate receipts across command families", () => {
    expect(
      CollectionProfileSourceRecordsSchema.safeParse({
        revision: 2,
        games: [sourceGame],
        intentions: [],
        commandReceipts: [canonicalOwnerNoteReceipt],
      }).success,
    ).toBe(true);
    const orphanReceipt = {
      ...canonicalOwnerNoteReceipt,
      gameId: "orphan",
      accepted: { ...canonicalOwnerNoteReceipt.accepted, gameId: "orphan" },
    };
    expect(OwnerGameNoteCommandReceiptSchema.safeParse(orphanReceipt).success).toBe(true);
    expect(
      CollectionProfileSourceRecordsSchema.safeParse({
        revision: 2,
        games: [sourceGame],
        intentions: [],
        commandReceipts: [orphanReceipt],
      }).success,
    ).toBe(false);

    const intentionReceipt = {
      commandId: canonicalIntentionCommandId,
      request: {
        type: "create" as const,
        commandId: canonicalIntentionCommandId,
        gameId: "game-1",
        kind: "first-play" as const,
        expectedActiveIntention: "absent" as const,
      },
      result: canonicalAcceptedIntentionMutation(),
    };
    const collidingNoteReceipt = {
      ...canonicalOwnerNoteReceipt,
      commandId: canonicalIntentionCommandId,
      accepted: { ...canonicalOwnerNoteReceipt.accepted, commandId: canonicalIntentionCommandId },
    };
    expect(
      CollectionProfileSourceRecordsSchema.safeParse({
        revision: 2,
        games: [sourceGame],
        intentions: [canonicalActiveIntention],
        commandReceipts: [intentionReceipt, collidingNoteReceipt],
      }).success,
    ).toBe(false);
  });

  test("freezes v5 while activating strict v6 storage and Profile source contracts", () => {
    const baseCollection = {
      schemaVersion: 5 as const,
      revision: 1,
      id: "collection-1",
      name: "Collection",
      axes: [],
      games: [canonicalPublicGame],
      intentions: [],
      commandReceipts: [],
      entertainmentBenchmark: null,
      createdAt: "2026-08-30T10:00:00.000Z",
      updatedAt: "2026-08-30T10:00:00.000Z",
    };
    expect(CollectionGameV5Schema.safeParse(canonicalPublicGame).success).toBe(true);
    expect(CollectionSchemaV5.safeParse(baseCollection).success).toBe(true);
    expect(CollectionSchema.safeParse(baseCollection).success).toBe(false);
    expect(
      CollectionSchema.safeParse({
        ...baseCollection,
        schemaVersion: 6,
        games: [{ ...canonicalPublicGame, ownerNote: missingOwnerNote }],
      }).success,
    ).toBe(true);

    const v6 = {
      ...baseCollection,
      schemaVersion: 6 as const,
      revision: 2,
      games: [{ ...canonicalPublicGame, ownerNote: presentOwnerNote }],
      commandReceipts: [canonicalOwnerNoteReceipt],
    };
    expect(CollectionSchemaV6.safeParse(v6).success).toBe(true);
    expect(
      CollectionSchemaV6.safeParse({
        ...v6,
        revision: 0,
        commandReceipts: [
          {
            ...canonicalOwnerNoteReceipt,
            accepted: { ...canonicalOwnerNoteReceipt.accepted, collectionRevision: 0 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CollectionSchemaV6.safeParse({
        ...v6,
        commandReceipts: [
          {
            ...canonicalOwnerNoteReceipt,
            accepted: { ...canonicalOwnerNoteReceipt.accepted, collectionRevision: 3 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(CollectionProfileCollectionSourceV6Schema.safeParse(v6).success).toBe(false);
    expect(
      CollectionProfileCollectionSourceV6Schema.safeParse({
        ...v6,
        games: [canonicalPublicGame],
      }).success,
    ).toBe(true);
  });
});

describe("strict public game projections", () => {
  const durableGame = { ...canonicalPublicGame, ownerNote: presentOwnerNote };
  const score = {
    score: 7,
    ratedAxisCount: 0,
    totalAxisCount: 0,
    breakdown: [],
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: null,
    redundancyAdjustment: null,
  };
  const purchaseUtilization = canonicalUtilizationCases[0]?.result;
  if (purchaseUtilization === undefined)
    throw new Error("Canonical utilization fixture is required");
  const withPurchaseUtilization = {
    game: canonicalPublicGame,
    score: null,
    displayScore: null,
    purchaseUtilization,
  };
  const tournamentStats = {
    eloRating: 1500,
    comparisonCount: 0,
    normalizedScore: null,
    isProvisional: true,
    displayLabel: "not yet ranked",
    wins: 0,
    losses: 0,
    recentComparisons: [],
  };

  test("separates note-free public, durable, and detail games", () => {
    expect(GameSchema.safeParse(canonicalPublicGame).success).toBe(true);
    expect(GameSchema.safeParse(durableGame).success).toBe(false);
    expect(DurableGameSchema.safeParse(durableGame).success).toBe(true);
    expect(DurableGameSchema.safeParse(canonicalPublicGame).success).toBe(false);
    expect(GameDetailGameSchema.safeParse(durableGame).success).toBe(true);
    expect(GameDetailGameSchema.safeParse(canonicalPublicGame).success).toBe(false);
  });

  test.each([
    [GameWithScoreSchema, { game: canonicalPublicGame, score: null }],
    [AddGameResultSchema, { game: canonicalPublicGame, bggImported: false }],
    [PublicGameMutationResultSchema, { game: canonicalPublicGame }],
  ] as const)("rejects ownerNote at broad boundary %#", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
    expect(schema.safeParse({ ...value, game: durableGame }).success).toBe(false);
  });

  test("rejects ownerNote from list and purchase-utilization responses", () => {
    expect(GameWithPurchaseUtilizationSchema.safeParse(withPurchaseUtilization).success).toBe(true);
    expect(GameListResponseSchema.safeParse([withPurchaseUtilization]).success).toBe(true);
    const leaked = { ...withPurchaseUtilization, game: durableGame };
    expect(GameWithPurchaseUtilizationSchema.safeParse(leaked).success).toBe(false);
    expect(GameListResponseSchema.safeParse([leaked]).success).toBe(false);
  });

  test("rejects ownerNote from prediction responses", () => {
    const prediction = {
      game: canonicalPublicGame,
      score,
      predictionUnavailable: null,
      redundancyPreview: null,
    };
    expect(PredictedGameResponseSchema.safeParse(prediction).success).toBe(true);
    expect(
      PredictedGameResponseSchema.safeParse({ ...prediction, game: durableGame }).success,
    ).toBe(false);
  });

  test("rejects ownerNote from Tournament responses", () => {
    const pair = {
      gameA: canonicalPublicGame,
      gameB: { ...canonicalPublicGame, id: "game-2", name: "Another Game" },
      gameAFitness: null,
      gameBFitness: 7,
      gameAStats: tournamentStats,
      gameBStats: tournamentStats,
    };
    expect(TournamentNextPairResponseSchema.safeParse(pair).success).toBe(true);
    expect(
      TournamentNextPairResponseSchema.safeParse({ ...pair, gameA: durableGame }).success,
    ).toBe(false);
  });

  test("requires ownerNote from the future detail response", () => {
    const detail = {
      ...withPurchaseUtilization,
      game: durableGame,
      intentions: { activeIntention: null, resolvedHistory: [] },
    };
    expect(OwnerGameNoteDetailWithPurchaseUtilizationSchema.safeParse(detail).success).toBe(true);
    expect(
      OwnerGameNoteDetailWithPurchaseUtilizationSchema.safeParse({
        ...detail,
        game: canonicalPublicGame,
      }).success,
    ).toBe(false);
  });
});
