import { describe, expect, test } from "bun:test";
import { createInitialEntityMetadata } from "@shelf-judge/shared";
import { gameList, gameValue } from "../src/commands/game.js";
import { createMockClient } from "./helpers/mock-client.js";
import {
  canonicalUtilizationCases,
  componentContract,
  UTILIZATION_OBSERVED_AT,
} from "../../../test-fixtures/purchase-utilization-responses.js";

describe("purchase utilization CLI parity", () => {
  test.each(canonicalUtilizationCases)(
    "renders and preserves the canonical daemon contract for $name",
    async (fixture) => {
      const response = {
        game: {
          id: fixture.id,
          bggId: null,
          name: fixture.name,
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
            observedAt: UTILIZATION_OBSERVED_AT,
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
          entityMetadata: createInitialEntityMetadata(null),
          latestPlayCountCheck: null,
          ownership: "owned",
          boxDimensions: null,
          manualShelfId: null,
          ratings: {},
          createdAt: UTILIZATION_OBSERVED_AT,
          updatedAt: UTILIZATION_OBSERVED_AT,
          ownerNote: { state: "missing", version: 0, updatedAt: null },
        },
        score: null,
        displayScore: fixture.input.fitness,
        purchaseUtilization: fixture.result,
        intentions: { activeIntention: null, resolvedHistory: [] },
      };
      const client = createMockClient({
        routes: {
          [`GET /api/games/${fixture.id}?includePredicted=true`]: {
            response: { ok: true, status: 200, data: response },
          },
        },
      });

      const human = await gameValue(client, [fixture.id], { json: false });
      expect(human).toContain(`Purchase utilization: ${fixture.expected.outcomeLabel}`);
      for (const component of componentContract(fixture.result)) {
        expect(human).toContain(`${component.label}: ${component.display}`);
        for (const reason of component.reasons) expect(human).toContain(`[${reason}]`);
      }
      for (const reason of fixture.expected.reasons) expect(human).toContain(`[${reason}]`);
      expect(human).toContain(`source=bgg-collection; observedAt=${UTILIZATION_OBSERVED_AT}`);
      expect(human).toContain(fixture.result.assumptions.modeledSessions);
      expect(human).toContain(fixture.result.assumptions.futurePlays);
      const { ownerNote, ...game } = response.game;
      const { intentions, ...detail } = response;
      void ownerNote;
      void intentions;
      expect(JSON.parse(await gameValue(client, [fixture.id], { json: true }))).toEqual({
        ...detail,
        game,
      });
    },
  );

  test("keeps daemon list order instead of applying web utilization sorts", async () => {
    const fitnessFirst = canonicalUtilizationCases.find(({ id }) => id === "canonical-60");
    const valueFirst = canonicalUtilizationCases.find(({ id }) => id === "canonical-20");
    const unavailable = canonicalUtilizationCases.find(({ id }) => id === "unavailable");
    if (!fitnessFirst || !valueFirst || !unavailable) throw new Error("Missing list fixtures");
    const rows = [
      {
        game: { id: "fitness-first", name: "Fitness First", yearPublished: null },
        score: null,
        displayScore: "9.0",
        purchaseUtilization: fitnessFirst.result,
      },
      {
        game: { id: "middle", name: "Unavailable Middle", yearPublished: null },
        score: null,
        displayScore: "6.0",
        purchaseUtilization: unavailable.result,
      },
      {
        game: { id: "value-first", name: "Value First", yearPublished: null },
        score: null,
        displayScore: "3.0",
        purchaseUtilization: valueFirst.result,
      },
    ];
    const client = createMockClient({
      routes: {
        "GET /api/games": { response: { ok: true, status: 200, data: rows } },
      },
    });

    const human = await gameList(client, [], { json: false });
    expect(human.indexOf("Fitness First")).toBeLessThan(human.indexOf("Unavailable Middle"));
    expect(human.indexOf("Unavailable Middle")).toBeLessThan(human.indexOf("Value First"));
    expect(JSON.parse(await gameList(client, [], { json: true }))).toEqual(rows);
  });
});
