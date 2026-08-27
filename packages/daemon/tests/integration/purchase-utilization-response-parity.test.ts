import { describe, expect, test } from "bun:test";
import type { Collection, Game, GameWithPurchaseUtilization } from "@shelf-judge/shared";
import {
  canonicalUtilizationCases,
  componentContract,
  exactComponentContract,
  UTILIZATION_OBSERVED_AT,
} from "../../../../test-fixtures/purchase-utilization-responses.js";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";

const expectedLabels = [
  "Value multiplier",
  "Value remaining",
  "Estimated additional plays to value threshold",
  "Cost per recorded play",
  "Modeled player-hours",
  "Cost per modeled player-hour",
  "Fitness-adjusted hourly benchmark",
  "Modeled player count",
];

describe("canonical purchase utilization response parity", () => {
  test("assembles every canonical case through the daemon HTTP boundary", async () => {
    const context = createTestApp();
    const games: Game[] = canonicalUtilizationCases.map((fixture) => ({
      id: fixture.id,
      bggId: null,
      name: fixture.name,
      yearPublished: null,
      minPlayers:
        fixture.input.playerRange.status === "valid"
          ? fixture.input.playerRange.value.minPlayers
          : null,
      maxPlayers:
        fixture.input.playerRange.status === "valid"
          ? fixture.input.playerRange.value.maxPlayers
          : null,
      bestPlayers: null,
      playingTime: fixture.input.duration.status === "valid" ? fixture.input.duration.value : null,
      imageUrl: null,
      bggData: null,
      numPlays: fixture.input.playCount.status === "valid" ? fixture.input.playCount.value : null,
      acquisition: fixture.input.acquisition,
      playCountEvidence: fixture.input.playCount,
      durationEvidence: fixture.input.duration,
      playerRangeEvidence: fixture.input.playerRange,
      suggestedPlayerPoll: fixture.input.suggestedPlayerPoll,
      bestPlayersInvalidEvidence: null,
      ownership: "owned",
      boxDimensions: null,
      manualShelfId: null,
      ratings: { "parity-axis": fixture.id === "vetoed" ? 1 : 6 },
      createdAt: UTILIZATION_OBSERVED_AT,
      updatedAt: UTILIZATION_OBSERVED_AT,
    }));
    const collection: Collection = {
      schemaVersion: 3,
      id: "parity-collection",
      name: "Parity",
      axes: [
        {
          id: "parity-axis",
          name: "Parity fitness",
          description: null,
          weight: 100,
          enabled: true,
          source: "personal",
          veto: { direction: "below", threshold: 2 },
          createdAt: UTILIZATION_OBSERVED_AT,
          updatedAt: UTILIZATION_OBSERVED_AT,
        },
      ],
      games,
      entertainmentBenchmark: canonicalUtilizationCases[0].input.entertainmentBenchmark,
      createdAt: UTILIZATION_OBSERVED_AT,
      updatedAt: UTILIZATION_OBSERVED_AT,
    };
    await context.storageService.saveCollection(collection);

    const response = await jsonRequest(context.app, "GET", "/api/games");
    expect(response.status).toBe(200);
    const assembled = (await response.json()) as GameWithPurchaseUtilization[];
    expect(assembled).toHaveLength(canonicalUtilizationCases.length);
    for (const fixture of canonicalUtilizationCases) {
      const actual = assembled.find(({ game }) => game.id === fixture.id);
      expect(actual?.displayScore).toBe(fixture.input.fitness);
      expect(actual?.purchaseUtilization).toEqual(fixture.result);
    }
  });

  test.each(canonicalUtilizationCases)("locks the daemon contract for $name", (fixture) => {
    const contract = componentContract(fixture.result);

    expect(fixture.result.outcome).toBe(fixture.expected.outcome);
    expect(fixture.result.outcomeLabel).toBe(fixture.expected.outcomeLabel);
    expect(fixture.result.reasons).toEqual(fixture.expected.reasons);
    expect(contract.map(({ label }) => label)).toEqual(expectedLabels);
    expect(contract.map(({ display }) => display)).toEqual(fixture.expected.displays);
    expect(exactComponentContract(fixture.result)).toEqual(fixture.expected.exactValues);
    expect(fixture.result.sort).toEqual({
      valueRemainingHundredths: fixture.expected.valueRemainingHundredths,
      estimatedAdditionalPlays: fixture.expected.estimatedAdditionalPlays,
    });
    expect(JSON.parse(JSON.stringify(fixture.result))).toEqual(fixture.result);
    expect(fixture.result.evidence).toMatchObject({
      acquisition: fixture.input.acquisition,
      entertainmentBenchmark: fixture.input.entertainmentBenchmark,
      playCount: fixture.input.playCount,
      duration: fixture.input.duration,
      playerRange: fixture.input.playerRange,
      suggestedPlayerPoll: fixture.input.suggestedPlayerPoll,
      fitness: { source: "current-fitness", observedAt: null },
    });
  });

  test("retains component-specific reasons instead of broadening unavailable results", () => {
    const unavailable = canonicalUtilizationCases.find(({ id }) => id === "unavailable");
    if (!unavailable) throw new Error("Missing unavailable fixture");

    expect(componentContract(unavailable.result)).toEqual([
      {
        label: "Value multiplier",
        outcome: "unavailable",
        display: "Unavailable",
        reasons: ["missing-acquisition"],
      },
      {
        label: "Value remaining",
        outcome: "unavailable",
        display: "Unavailable",
        reasons: ["missing-acquisition"],
      },
      {
        label: "Estimated additional plays to value threshold",
        outcome: "unavailable",
        display: "Unavailable",
        reasons: ["missing-acquisition"],
      },
      {
        label: "Cost per recorded play",
        outcome: "unavailable",
        display: "Unavailable",
        reasons: ["missing-acquisition"],
      },
      {
        label: "Modeled player-hours",
        outcome: "calculated",
        display: "60 player-hours",
        reasons: [],
      },
      {
        label: "Cost per modeled player-hour",
        outcome: "unavailable",
        display: "Unavailable",
        reasons: ["missing-acquisition"],
      },
      {
        label: "Fitness-adjusted hourly benchmark",
        outcome: "calculated",
        display: "$8.00",
        reasons: [],
      },
      { label: "Modeled player count", outcome: "calculated", display: "4 players", reasons: [] },
    ]);
  });
});
