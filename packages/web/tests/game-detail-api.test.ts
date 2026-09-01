import { describe, expect, test } from "bun:test";
import {
  calculatePurchaseUtilization,
  type DurableGame,
  type GameDetailWithPurchaseUtilization,
} from "@shelf-judge/shared";
import { getGame, getOwnerGameNote } from "@/lib/api";

const observedAt = "2026-08-28T10:00:00.000Z";
const createdAt = "2026-08-28T10:01:00.000Z";
const resolvedAt = "2026-08-28T10:02:00.000Z";

function game(): DurableGame {
  const completeEmptyMetadata = {
    state: "complete" as const,
    entities: [],
    observedAt,
    refreshFailure: null,
    correctionDestination: null,
  };
  return {
    id: "game-1",
    bggId: null,
    name: "Validated Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: 0,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt },
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
    entityMetadata: {
      mechanic: completeEmptyMetadata,
      designer: completeEmptyMetadata,
      artist: completeEmptyMetadata,
    },
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt,
    updatedAt: createdAt,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
  };
}

function validDetail(): GameDetailWithPurchaseUtilization {
  const detailGame = game();
  return {
    game: detailGame,
    score: {
      score: 6,
      ratedAxisCount: 1,
      totalAxisCount: 1,
      breakdown: [],
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: null,
      redundancyAdjustment: null,
    },
    bggDataStale: false,
    nichePosition: null,
    displayScore: "6.0",
    purchaseUtilization: calculatePurchaseUtilization({
      acquisition: detailGame.acquisition,
      entertainmentBenchmark: null,
      playCount: detailGame.playCountEvidence,
      duration: detailGame.durationEvidence,
      playerRange: detailGame.playerRangeEvidence,
      suggestedPlayerPoll: detailGame.suggestedPlayerPoll,
      fitness: "6.0",
    }),
    intentions: {
      activeIntention: {
        intentionId: "active-1",
        gameId: detailGame.id,
        kind: "first-play",
        baseline: { playCount: 0, evidenceSource: "manual", observedAt },
        createdAt,
        version: 1,
        resolution: null,
      },
      resolvedHistory: [
        {
          intentionId: "resolved-1",
          gameId: detailGame.id,
          gameName: detailGame.name,
          kind: "first-play",
          baseline: { playCount: 0, evidenceSource: "manual", observedAt },
          createdAt,
          version: 2,
          resolution: { outcome: "retired", source: "owner-retired", resolvedAt },
        },
      ],
    },
  };
}

function rejects(response: unknown): void {
  expect(getGame("game-1", () => Promise.resolve(response))).rejects.toBeInstanceOf(Error);
}

describe("web game-detail API boundary", () => {
  test("accepts a complete valid detail response", async () => {
    const response = validDetail();
    expect(await getGame("game-1", () => Promise.resolve(response))).toEqual(response);
  });

  test("validates dedicated note reads and exact game identity", async () => {
    const response = { gameId: "game-1", note: game().ownerNote };
    expect(await getOwnerGameNote("game-1", () => Promise.resolve(response))).toEqual(response);
    expect(
      getOwnerGameNote("game-1", () => Promise.resolve({ ...response, gameId: "game-2" })),
    ).rejects.toThrow("different game");
    expect(
      getOwnerGameNote("game-1", () =>
        Promise.resolve({ gameId: "game-1", note: { ...game().ownerNote, text: "leak" } }),
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  test("rejects an active intention belonging to another game", () => {
    const response = validDetail();
    if (response.intentions.activeIntention === null) throw new Error("Missing active fixture");
    response.intentions.activeIntention.gameId = "wrong-game";
    rejects(response);
  });

  test("rejects complete detail belonging to another route game", () => {
    const response = validDetail();
    response.game.id = "game-2";
    rejects(response);
  });

  test("rejects resolved history belonging to another game", () => {
    const response = validDetail();
    const [history] = response.intentions.resolvedHistory;
    if (history === undefined) throw new Error("Missing history fixture");
    history.gameId = "wrong-game";
    rejects(response);
  });

  test.each([
    ["game", (response: Record<string, unknown>) => (response.game = { id: "game-1" })],
    ["score", (response: Record<string, unknown>) => (response.score = { score: "invalid" })],
    [
      "purchase utilization",
      (response: Record<string, unknown>) => (response.purchaseUtilization = { outcome: "met" }),
    ],
  ])("rejects malformed outer %s fields", (_label, mutate) => {
    const response: Record<string, unknown> = structuredClone(validDetail());
    mutate(response);
    rejects(response);
  });
});
