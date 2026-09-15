/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  calculatePurchaseUtilization,
  GameListResponseSchema,
  GameWithScoreSchema,
  type Game,
  type ReflectionCitation,
} from "@shelf-judge/shared";
import { canonicalPublicGame } from "../../../shared/tests/fixtures/owner-game-note-mutation";
import {
  gameTitlesFromGamesPayload,
  presentReflectionEvidence,
} from "./reflection-evidence-presentation";

const gameCitation: ReflectionCitation = {
  citationId: "score-1",
  sourceId: "game-1:score",
  sourceVersion: "version-1",
  evidenceClass: "current-scoring",
  testimony: false,
  canonicalSummary: "Current fitness is 8",
  destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
  sourceDisplayContext: { kind: "game", gameTitle: "Atlas" },
};

describe("reflection evidence presentation", () => {
  test("presents supplied game evidence as a compact linked fitness-score item", () => {
    expect(presentReflectionEvidence([gameCitation], false)).toEqual([
      expect.objectContaining({
        citation: gameCitation,
        citationIds: ["score-1"],
        label: "Fitness Score",
        gameTitle: "Atlas",
        href: "/games/game-1",
      }),
    ]);
  });

  test("resolves a legacy citation title from the current game list", () => {
    const legacyCitation: ReflectionCitation = {
      ...gameCitation,
      sourceDisplayContext: undefined,
    };

    expect(
      presentReflectionEvidence(
        [legacyCitation],
        false,
        new Map([["game-1", "Return to Dark Tower"]]),
      ),
    ).toEqual([
      expect.objectContaining({
        label: "Fitness Score",
        gameTitle: "Return to Dark Tower",
        href: "/games/game-1",
      }),
    ]);
  });

  test("resolves legacy titles from enriched list rows rejected by the old score schema", () => {
    const game: Game = {
      ...canonicalPublicGame,
      id: "game-1",
      name: "Return to Dark Tower",
    };
    const baseRow = { game, score: null };
    const enrichedRow = {
      ...baseRow,
      displayScore: null,
      purchaseUtilization: calculatePurchaseUtilization({
        acquisition: game.acquisition,
        entertainmentBenchmark: null,
        playCount: game.playCountEvidence,
        duration: game.durationEvidence,
        playerRange: game.playerRangeEvidence,
        suggestedPlayerPoll: game.suggestedPlayerPoll,
        fitness: null,
      }),
    };
    const payload = [{ game: { id: "invalid" } }, enrichedRow];

    expect(GameWithScoreSchema.safeParse(baseRow).success).toBe(true);
    expect(GameWithScoreSchema.safeParse(enrichedRow).success).toBe(false);
    expect(GameListResponseSchema.safeParse([enrichedRow]).success).toBe(true);

    const titles = gameTitlesFromGamesPayload(payload);
    expect(titles.get("game-1")).toBe("Return to Dark Tower");
    const legacyCitation: ReflectionCitation = { ...gameCitation, sourceDisplayContext: undefined };
    expect(presentReflectionEvidence([legacyCitation], false, titles)).toEqual([
      expect.objectContaining({ gameTitle: "Return to Dark Tower", href: "/games/game-1" }),
    ]);
  });

  test("keeps unsupported current destinations unlinked without inventing a title", () => {
    const citation: ReflectionCitation = {
      ...gameCitation,
      citationId: "collection-1",
      sourceId: "collection-1",
      evidenceClass: "collection-summary",
      destination: { operationId: "shelf.collection.get", parameters: {} },
      sourceDisplayContext: { kind: "collection", label: "Collection" },
    };

    expect(presentReflectionEvidence([citation], false)[0]).toMatchObject({
      label: "Collection",
    });
    expect(presentReflectionEvidence([citation], false)[0]?.gameTitle).toBeUndefined();
    expect(presentReflectionEvidence([citation], false)[0]?.href).toBeUndefined();
  });

  test("retains stale citations as snapshots and collapses only exact immutable duplicates", () => {
    const duplicate: ReflectionCitation = {
      ...gameCitation,
      citationId: "score-duplicate",
      observedAt: "2026-09-13T11:00:00.000Z",
    };
    const differentVersion: ReflectionCitation = {
      ...gameCitation,
      citationId: "score-version-2",
      sourceVersion: "version-2",
    };

    const citations = presentReflectionEvidence([gameCitation, duplicate, differentVersion], true);

    expect(citations).toHaveLength(2);
    expect(citations?.[0]).toMatchObject({
      citationIds: ["score-1", "score-duplicate"],
      traces: [
        { citationId: "score-1", sourceVersion: "version-1" },
        {
          citationId: "score-duplicate",
          sourceVersion: "version-1",
          observedAt: "2026-09-13T11:00:00.000Z",
        },
      ],
    });
    expect(citations?.[0]?.href).toBeUndefined();
    expect(citations?.[1]).toMatchObject({ citationIds: ["score-version-2"] });
  });

  test("does not merge distinct game contexts that share a display title", () => {
    const otherGame: ReflectionCitation = {
      ...gameCitation,
      citationId: "other-score",
      sourceId: "game-2:score",
      destination: { operationId: "shelf.game.get", parameters: { gameId: "game-2" } },
    };

    const citations = presentReflectionEvidence([gameCitation, otherGame], false);

    expect(citations).toHaveLength(2);
  });
});
