import { describe, expect, test } from "bun:test";
import {
  AcceptedPlaySourceDataSchema,
  AcceptedPlayObservationSchema,
  acceptedPlayObservationIdentity,
  createAcceptedPlaySourceData,
  AttentionFeedbackEventSchema,
  AttentionFeedbackCommandSchema,
  AttentionFeedbackCommandReceiptSchema,
  AttentionFeedbackHistoryResultSchema,
  createOwnerAttentionFeedbackSchemas,
  canonicalizeAttentionFeedbackCommand,
  createCurrentCardFeedbackCommandSchema,
  AttentionAcceptedPlayEvidenceSchema,
  CollectionProfileResultSchema,
  type AcceptedPlayObservation,
  type AcceptedPlaySourceData,
  type AttentionFeedbackEvent,
  type AttentionAcceptedPlayEvidence,
  type RecordAttentionFeedbackCommand,
} from "../src/index";
import { usefulProfileFixture } from "./fixtures/useful-profile";

const T0 = "2026-09-20T10:00:00.000Z";
const T1 = "2026-09-20T10:00:01.000Z";
const T2 = "2026-09-20T10:00:02.000Z";
const eventId = "123e4567-e89b-42d3-a456-426614174000";
const commandId = "123e4567-e89b-42d3-a456-426614174001";
const tuple = {
  sourceId: "bgg-collection-aggregate",
  sourceVersion: 1,
  checkDefinitionId: "bgg.aggregate.total.v1",
} as const;

function stream(): AcceptedPlaySourceData {
  const data = createAcceptedPlaySourceData([{ id: "game-4", bggId: 1 }], true);
  const fields = {
    ...tuple,
    gameId: "game-4",
    observedAt: T1,
    receivedAt: T2,
    checkId: "check-1",
    count: 0,
    payloadIdentity: "a".repeat(64),
  };
  const observation: AcceptedPlayObservation = {
    ...fields,
    observationId: acceptedPlayObservationIdentity(fields),
  };
  data.observations.push(observation);
  data.checks.push({
    ...tuple,
    gameId: "game-4",
    checkId: "check-1",
    receivedAt: T2,
    outcome: "valid",
    count: 0,
    observationId: observation.observationId,
  });
  data.freshnessBoundaries.push({
    ...tuple,
    gameId: "game-4",
    checkId: "check-1",
    evaluatorId: "profile-attention",
    evaluatorVersion: 1,
    boundaryId: "boundary-1",
    refreshedAt: T0,
  });
  return data;
}
function event(): AttentionFeedbackEvent {
  return {
    feedbackEventId: eventId,
    collectionId: "collection",
    cardId: "attention:intention-1",
    family: "play-intention",
    gameId: "game-4",
    answer: "no",
    recordedAt: T2,
    reason: { category: "other", text: "Private local explanation" },
  };
}
function evidence(): AttentionAcceptedPlayEvidence {
  const data = stream();
  const observation = data.observations[0];
  if (!observation) throw new Error("fixture observation missing");
  return {
    gameId: "game-4",
    evaluatorId: "profile-attention",
    evaluatorVersion: 1,
    requiredSourceSet: [tuple],
    status: "agreement",
    count: 0,
    warning: null,
    sources: [
      {
        source: tuple,
        status: "valid",
        currentCheckId: "check-1",
        supersededCheckIds: [],
        boundary: { boundaryId: "boundary-1", checkId: "check-1", refreshedAt: T0 },
        observationId: observation.observationId,
        count: 0,
        observedAt: T1,
        receivedAt: T2,
      },
    ],
  };
}

describe("additive accepted source contracts", () => {
  test("keeps closed tuples, ordered evaluator snapshots, and independently linked source records", () => {
    expect(AcceptedPlaySourceDataSchema.parse(stream())).toEqual(stream());
    expect(createAcceptedPlaySourceData([{ id: "unlinked", bggId: null }], true)).toMatchObject({
      evaluatorPolicies: [],
      checks: [],
      observations: [],
      freshnessBoundaries: [],
      legacyGameIds: ["unlinked"],
    });
    const multi = stream();
    multi.evaluatorPolicies = [
      {
        gameId: "game-4",
        evaluatorId: "profile-attention",
        evaluatorVersion: 2,
        requiredSourceSet: [
          tuple,
          {
            sourceId: "owner-manual-correction",
            sourceVersion: 1,
            checkDefinitionId: "owner.manual-correction.v1",
          },
        ],
      },
    ];
    multi.freshnessBoundaries = [];
    expect(AcceptedPlaySourceDataSchema.safeParse(multi).success).toBe(true);
    multi.evaluatorPolicies[0].evaluatorVersion = 1;
    expect(AcceptedPlaySourceDataSchema.safeParse(multi).success).toBe(false);
  });
  test.each([
    (d: AcceptedPlaySourceData) => {
      d.observations[0].count = -1;
    },
    (d: AcceptedPlaySourceData) => {
      d.observations[0].observedAt = "2026-09-20T10:00:01Z";
    },
    (d: AcceptedPlaySourceData) => {
      d.observations[0].observedAt = "2026-02-30T10:00:01.000Z";
    },
    (d: AcceptedPlaySourceData) => {
      d.observations[0].receivedAt = T1;
    },
    (d: AcceptedPlaySourceData) => {
      d.observations[0].checkDefinitionId = "bgg.plays.snapshot.v1";
    },
    (d: AcceptedPlaySourceData) => {
      d.observations[0].checkId = "non ASCII é";
    },
    (d: AcceptedPlaySourceData) => {
      d.observations[0].observationId = "invented";
    },
    (d: AcceptedPlaySourceData) => {
      d.observations = [];
    },
    (d: AcceptedPlaySourceData) => {
      d.checks = [];
    },
    (d: AcceptedPlaySourceData) => {
      d.checks.push({ ...d.checks[0], receivedAt: T1 });
    },
    (d: AcceptedPlaySourceData) => {
      d.observations.push({ ...d.observations[0] });
    },
    (d: AcceptedPlaySourceData) => {
      d.freshnessBoundaries[0].checkId = "absent";
    },
    (d: AcceptedPlaySourceData) => {
      d.freshnessBoundaries[0].evaluatorVersion = 2;
    },
    (d: AcceptedPlaySourceData) => {
      d.freshnessBoundaries[0].gameId = "another-game";
    },
    (d: AcceptedPlaySourceData) => {
      d.freshnessBoundaries.push({ ...d.freshnessBoundaries[0], refreshedAt: T1 });
    },
    (d: AcceptedPlaySourceData) => {
      d.registry[0].semantics = "current-count-correction";
    },
    (d: AcceptedPlaySourceData) => {
      d.legacyGameIds.push("game-4");
    },
  ])("rejects malformed or conflicting historical rows", (corrupt) => {
    const data = stream();
    // Newer checks cannot hide malformed historical records at the validation boundary.
    data.checks.push({
      ...tuple,
      gameId: "game-4",
      checkId: "check-2",
      receivedAt: T2,
      outcome: "missing",
      reason: "no-data",
    });
    corrupt(data);
    expect(AcceptedPlaySourceDataSchema.safeParse(data).success).toBe(false);
  });
  test("validates missing/invalid outcomes without treating source failure as corrupt data", () => {
    const data = stream();
    data.checks.push({
      ...tuple,
      gameId: "game-4",
      checkId: "check-2",
      receivedAt: T2,
      outcome: "invalid",
      reason: "missing-observed-at",
    });
    expect(AcceptedPlaySourceDataSchema.safeParse(data).success).toBe(true);
    expect(
      AcceptedPlaySourceDataSchema.safeParse({
        ...data,
        checks: [{ ...data.checks[1], observationId: "forbidden" }],
      }).success,
    ).toBe(false);
    const { observedAt: _time, ...withoutTime } = data.observations[0];
    void _time;
    expect(AcceptedPlayObservationSchema.safeParse(withoutTime).success).toBe(false);
  });
  test("requires complete deduplicated snapshot counts independent of legacy sessions", () => {
    const fields = {
      ...stream().observations[0],
      sourceId: "bgg-play-sessions" as const,
      checkDefinitionId: "bgg.plays.snapshot.v1" as const,
      count: 2,
      sessions: [{ playId: 1, bggId: 1, quantity: 2, playedOn: "2026-09-19" }],
    };
    const observation = { ...fields, observationId: acceptedPlayObservationIdentity(fields) };
    expect(AcceptedPlayObservationSchema.safeParse(observation).success).toBe(true);
    expect(AcceptedPlayObservationSchema.safeParse({ ...observation, count: 0 }).success).toBe(
      false,
    );
    expect(
      AcceptedPlayObservationSchema.safeParse({
        ...observation,
        count: 4,
        sessions: [...fields.sessions, ...fields.sessions],
      }).success,
    ).toBe(false);
  });
  test("validates projected freshness strictly, without selecting a card", () => {
    expect(AttentionAcceptedPlayEvidenceSchema.safeParse(evidence()).success).toBe(true);
    expect(
      AttentionAcceptedPlayEvidenceSchema.safeParse({ ...evidence(), gameId: "another-game" })
        .success,
    ).toBe(false);
    const stale = evidence();
    const source = stale.sources[0];
    if (source.status !== "valid" || !source.boundary) throw new Error("fixture status missing");
    source.boundary.refreshedAt = T1;
    expect(AttentionAcceptedPlayEvidenceSchema.safeParse(stale).success).toBe(false);
    stale.sources[0] = { ...source, status: "stale" };
    stale.status = "stale";
    stale.count = null;
    stale.warning = "A newer BGG check did not provide a valid play count.";
    expect(AttentionAcceptedPlayEvidenceSchema.safeParse(stale).success).toBe(true);
  });
});

describe("owner-local feedback contracts", () => {
  test("all answers are durable, with reasons bounded and exclusive to No", () => {
    for (const answer of ["yes", "no", "skip"] as const) {
      const { reason: _reason, ...base } = event();
      void _reason;
      expect(AttentionFeedbackEventSchema.safeParse({ ...base, answer }).success).toBe(true);
      expect(AttentionFeedbackEventSchema.safeParse({ ...event(), answer }).success).toBe(
        answer === "no",
      );
    }
    expect(
      AttentionFeedbackEventSchema.safeParse({
        ...event(),
        reason: { category: "other", text: "😀".repeat(500) },
      }).success,
    ).toBe(true);
    for (const reason of [
      { category: "unknown" },
      { category: "other", text: "😀".repeat(501) },
      { category: "other", text: " " },
      { category: "other", text: "secret\u0000" },
      { category: "other", provider: "no" },
    ])
      expect(AttentionFeedbackEventSchema.safeParse({ ...event(), reason }).success).toBe(false);
  });
  test("rejects unknown families, malformed identity/time, and suppression/provider fields", () => {
    for (const patch of [
      { family: "incomplete-rating" },
      { family: "purchase-utilization-goal" },
      { answer: "maybe" },
      { feedbackEventId: "not-uuid" },
      { cardId: "game-4" },
      { gameId: " " },
      { recordedAt: "yesterday" },
      { recordedAt: "2026-02-30T10:00:00.000Z" },
      { suppression: true },
      { provider: "external" },
      { ai: true },
    ])
      expect(AttentionFeedbackEventSchema.safeParse({ ...event(), ...patch }).success).toBe(false);
  });
  test("owner history/deletion authorize durable identity, independent of an active card", () => {
    const history = { collectionId: "collection", events: [event()] };
    const query = { collectionId: "collection", feedbackEventId: eventId };
    const deletion = { ...query, commandId, type: "delete-feedback" };
    const owner = createOwnerAttentionFeedbackSchemas({
      role: "owner",
      collectionId: "collection",
    });
    expect(owner.historyQuery.safeParse(query).success).toBe(true);
    expect(owner.historyResult.safeParse(history).success).toBe(true);
    expect(owner.command.safeParse(deletion).success).toBe(true);
    for (const access of [
      { role: "non-owner" as const, collectionId: "collection" },
      { role: "owner" as const, collectionId: "other" },
    ]) {
      const schemas = createOwnerAttentionFeedbackSchemas(access);
      expect(schemas.historyQuery.safeParse(query).success).toBe(false);
      expect(schemas.historyResult.safeParse(history).success).toBe(false);
      expect(schemas.command.safeParse(deletion).success).toBe(false);
    }
    expect(
      AttentionFeedbackHistoryResultSchema.safeParse({ ...history, events: [event(), event()] })
        .success,
    ).toBe(false);
    expect(
      AttentionFeedbackHistoryResultSchema.safeParse({
        ...history,
        events: [
          event(),
          {
            ...event(),
            feedbackEventId: commandId,
            family: "unplayed-owner-wanted",
            gameId: "other",
          },
        ],
      }).success,
    ).toBe(false);
  });
  test("command receipts support stable replay fingerprints without retaining reason text", () => {
    const command: RecordAttentionFeedbackCommand = {
      type: "record-feedback",
      commandId,
      collectionId: "collection",
      cardId: "attention:intention-1",
      gameId: "game-4",
      family: "play-intention",
      expectedIntentionVersion: 1,
      answer: "no",
      reason: { category: "other", text: "Private local explanation" },
    };
    const canonical = canonicalizeAttentionFeedbackCommand(command);
    const cardSchema = createCurrentCardFeedbackCommandSchema("collection", {
      id: command.cardId,
      decisionFamily: command.family,
      intention: { gameId: command.gameId, version: 1, resolution: null },
    });
    expect(cardSchema.safeParse(command).success).toBe(true);
    for (const patch of [
      { gameId: "other" },
      { family: "unplayed-owner-wanted" },
      { cardId: "attention:another" },
      { expectedIntentionVersion: 2 },
      { collectionId: "other" },
    ])
      expect(cardSchema.safeParse({ ...command, ...patch }).success).toBe(false);
    expect(canonicalizeAttentionFeedbackCommand({ ...command, commandId: eventId })).toBe(
      canonical,
    );
    expect(
      canonicalizeAttentionFeedbackCommand({
        ...command,
        reason: { category: "other", text: "Different" },
      }),
    ).not.toBe(canonical);
    expect(
      AttentionFeedbackCommandSchema.safeParse({ ...command, provider: "external" }).success,
    ).toBe(false);
    const receipt = {
      receiptType: "attention-feedback",
      commandId,
      collectionId: "collection",
      operation: "record-feedback",
      requestFingerprint: "b".repeat(64),
      accepted: {
        commandId,
        collectionId: "collection",
        operation: "record-feedback",
        feedbackEventId: eventId,
        collectionRevision: 1,
      },
    };
    expect(AttentionFeedbackCommandReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain(command.reason?.text ?? "missing");
    expect(
      AttentionFeedbackCommandReceiptSchema.safeParse({ ...receipt, request: command }).success,
    ).toBe(false);
    expect(
      AttentionFeedbackCommandReceiptSchema.safeParse({
        ...receipt,
        accepted: { ...receipt.accepted, commandId: eventId },
      }).success,
    ).toBe(false);
    expect(
      AttentionFeedbackCommandSchema.safeParse({
        type: "attach-feedback-reason",
        commandId,
        collectionId: "collection",
        feedbackEventId: eventId,
        reason: { category: "already-aware" },
      }).success,
    ).toBe(true);
  });
  test("public families preserve one-card identity and reject duplicate presentations", () => {
    const profile = structuredClone(usefulProfileFixture);
    const item = profile.attention.items[0];
    if (!item) throw new Error("attention fixture missing");
    item.intention.kind = "want-to-play";
    item.decisionFamily = "unplayed-owner-wanted";
    item.question = `Do you still want to play ${item.gameName} for the first time?`;
    item.whyNow =
      "You want to play this game, and current accepted play evidence records no plays.";
    item.acceptedPlayEvidence = evidence();
    item.feedbackEventIds = [eventId];
    expect(CollectionProfileResultSchema.safeParse(profile).success).toBe(true);
    profile.attention.items.push({ ...item });
    expect(CollectionProfileResultSchema.safeParse(profile).success).toBe(false);
  });
});
