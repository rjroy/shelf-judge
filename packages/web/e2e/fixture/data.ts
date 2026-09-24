import {
  AxisSchema,
  CollectionProfileResultSchema,
  type Axis,
  type CollectionProfileResult,
  type CollectionProfileAttentionCard,
  type Game,
  type PlayIntention,
} from "@shelf-judge/shared";
import { createHash } from "node:crypto";
import { warningUsefulProfileFixture } from "../../../shared/tests/fixtures/useful-profile";

export const observedAt = "2026-08-28T10:00:00.000Z";
export const externalObservedAt = "2026-08-28T10:05:00.000Z";
export const createdAt = "2026-08-28T10:01:00.000Z";
export const resolvedAt = "2026-08-28T12:00:00.000Z";
export const gameId = "game-4";

export function createFixtureAxis() {
  return AxisSchema.parse({
    id: "axis-enjoyment",
    name: "Enjoyment",
    description: "How much I enjoy playing",
    weight: 1,
    enabled: true,
    source: "personal",
    createdAt,
    updatedAt: createdAt,
  });
}

export function createProfileFixture(axis: Axis): CollectionProfileResult {
  return (() => {
    const profile = structuredClone(warningUsefulProfileFixture);
    const mechanic = profile.identity.classes.mechanic;
    const workerPlacement = mechanic.entities.find(({ entityId }) => entityId === 101);
    const solo = mechanic.entities.find(({ entityId }) => entityId === 102);
    if (workerPlacement === undefined) throw new Error("Expected mechanic fixture evidence");
    if (solo === undefined) throw new Error("Expected limited mechanic fixture evidence");
    const generatedEntities = Array.from({ length: 166 }, (_, index) => ({
      ...structuredClone(workerPlacement),
      entityId: 1_000 + index,
      name: `Worker Placement Variant ${String(index + 1).padStart(3, "0")}`,
    }));
    const generatedIds = generatedEntities.map(({ entityId }) => entityId);
    mechanic.entities = [workerPlacement, solo, ...generatedEntities];
    mechanic.orderings = {
      bestFit: [solo.entityId, workerPlacement.entityId, ...generatedIds],
      support: [workerPlacement.entityId, ...generatedIds, solo.entityId],
      name: [solo.entityId, workerPlacement.entityId, ...generatedIds],
    };
    mechanic.overviewEntityIds = [workerPlacement.entityId, ...generatedIds.slice(0, 2)];
    profile.identity.axisDistributions = [
      {
        axisId: axis.id,
        axisName: axis.name,
        mean: 6,
        median: 6,
        standardDeviation: Math.sqrt(8),
        range: { min: 2, max: 10 },
        ratedGameCount: 4,
        histogram: [0, 1, 0, 0, 0, 2, 0, 0, 0, 1],
      },
    ];
    return CollectionProfileResultSchema.parse(profile);
  })();
}

const rankedAttentionGameIds = Array.from(
  { length: 6 },
  (_, index) => `55000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

export function createRankedAttentionCards(
  profileFixture: CollectionProfileResult,
): CollectionProfileAttentionCard[] {
  return (() => {
    const template =
      profileFixture.status === "available" ? profileFixture.attention.cards[0] : undefined;
    if (template === undefined) throw new Error("Expected ranked attention template card");
    const templateIntention = template.intention;
    if (templateIntention === null) throw new Error("Expected explicit intention template card");
    return rankedAttentionGameIds.map((gameId, index) => {
      const cardNumber = index + 1;
      const fingerprint = createHash("sha256")
        .update(`ranked-attention-${cardNumber}`)
        .digest("hex");
      const command = (operation: "not-now" | "intentional") => ({
        operation,
        gameId,
        ruleId: "explicit-intention",
        ruleVersion: 1,
        fingerprint,
        expectedVersion: 0,
      });
      const actions: CollectionProfileAttentionCard["actions"] = [
        {
          action: "resolve-intention",
          operationId: "shelf.game.intention.complete",
          destination: { gameId, operationId: "shelf.game.intention.complete" },
          command: null,
        },
        {
          action: "retire-intention",
          operationId: "shelf.game.intention.retire",
          destination: { gameId, operationId: "shelf.game.intention.retire" },
          command: null,
        },
        {
          action: "not-now",
          operationId: "shelf.profile.attention.not-now",
          destination: { gameId, operationId: "shelf.profile.attention.not-now" },
          command: command("not-now"),
        },
        {
          action: "intentional",
          operationId: "shelf.profile.attention.intentional",
          destination: { gameId, operationId: "shelf.profile.attention.intentional" },
          command: command("intentional"),
        },
        {
          action: "open-game",
          operationId: "shelf.game.get",
          destination: { gameId, operationId: "shelf.game.get" },
          command: null,
        },
      ];
      return {
        ...structuredClone(template),
        id: `attention:${gameId}:explicit-intention`,
        gameId,
        gameName: `Ranked decision ${cardNumber}`,
        gameImageUrl:
          cardNumber === 2
            ? null
            : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 220'%3E%3Crect width='160' height='220' fill='%232e5f8a'/%3E%3Ccircle cx='80' cy='82' r='42' fill='%23f4f1ec'/%3E%3C/svg%3E",
        question: `Question for ranked decision ${cardNumber}?`,
        reason: `Daemon-supplied reason ${cardNumber}.`,
        scoreExplanation: `Daemon-supplied score explanation ${cardNumber}.`,
        actions,
        intention: {
          ...templateIntention,
          gameId,
          intentionId: `ranked-intention-${cardNumber}`,
        },
        evidence: {
          ...template.evidence,
          intentionId: `ranked-intention-${cardNumber}`,
        },
        nonClockFingerprint: fingerprint,
      };
    });
  })();
}

export function baseGame(axis: Axis): Game {
  const completeEmptyMetadata = {
    state: "complete" as const,
    entities: [],
    observedAt,
    refreshFailure: null,
    correctionDestination: null,
  };
  return {
    id: gameId,
    bggId: null,
    name: "Heat: Pedal to the Metal With A Deliberately Long Fixture Name",
    yearPublished: 2022,
    minPlayers: 1,
    maxPlayers: 6,
    bestPlayers: 5,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: 0,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "valid", value: 0, source: "bgg-plays", observedAt },
    durationEvidence: { status: "valid", value: 60, source: "manual", observedAt },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 1, maxPlayers: 6 },
      source: "manual",
      observedAt,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    entityMetadata: {
      mechanic: completeEmptyMetadata,
      designer: completeEmptyMetadata,
      artist: completeEmptyMetadata,
    },
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: { [axis.id]: 6 },
    createdAt,
    updatedAt: createdAt,
  };
}

export function activeIntention(id = "intention-browser-1"): PlayIntention {
  return {
    intentionId: id,
    gameId,
    kind: "first-play",
    baseline: { playCount: 0, evidenceSource: "manual", observedAt },
    createdAt,
    version: 1,
    resolution: null,
  };
}
