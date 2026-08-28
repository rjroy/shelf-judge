import { describe, expect, test } from "bun:test";
import type { Collection, GameWithPurchaseUtilization } from "@shelf-judge/shared";
import type { BggGameResult } from "../../src/services/bgg-client.js";
import {
  createMockBggClient,
  createTestApp,
  jsonRequest,
  type TestAppContext,
} from "../helpers/test-app.js";

const collectionPath = "/test/data/collection.json";
const thingObservedAt = "2026-08-26T10:00:00.000Z";
const collectionObservedAt = "2026-08-26T11:00:00.000Z";

async function schemaTwoFixture(): Promise<string> {
  return Bun.file(
    new URL("../fixtures/purchase-utilization-schema-v2.json", import.meta.url),
  ).text();
}

function boot(collectionText: string, result?: BggGameResult): TestAppContext {
  const bggClient = createMockBggClient({
    getGame: () =>
      result === undefined
        ? Promise.reject(new Error("No BGG result configured"))
        : Promise.resolve(result),
  });
  const context = createTestApp({ bggClient });
  context.fileOps.files.set(collectionPath, collectionText);
  return context;
}

function refreshedBggResult(): BggGameResult {
  return {
    metadata: {
      bggId: 101,
      name: "Ordinary Purchase",
      yearPublished: 2020,
      minPlayers: 2,
      maxPlayers: 2,
      playingTime: 30,
      imageUrl: null,
      thumbnailUrl: null,
    },
    bggData: {
      communityRating: 7.6,
      bayesAverage: 7.2,
      weight: 2.6,
      numWeightVotes: 20,
      description: null,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: 2,
      fetchedAt: thingObservedAt,
    },
    metadataObservation: {
      sourceRequest: "bgg-thing",
      observedAt: thingObservedAt,
      state: "complete",
      fieldsReturned: ["playingTime", "minPlayers", "maxPlayers", "bggData"],
    },
    playerRangeObservation: {
      sourceRequest: "bgg-thing",
      observedAt: thingObservedAt,
      state: "complete",
      fieldsReturned: ["minPlayers", "maxPlayers"],
    },
    suggestedPlayerPoll: {
      state: "usable",
      buckets: [{ playerCount: "2", best: 12, recommended: 3, notRecommended: 1 }],
      observation: {
        sourceRequest: "bgg-thing",
        observedAt: thingObservedAt,
        state: "complete",
        fieldsReturned: ["suggestedPlayerPoll"],
      },
    },
    collectionData: {
      numPlays: 3,
      observation: {
        sourceRequest: "bgg-collection",
        observedAt: collectionObservedAt,
        state: "complete",
        fieldsReturned: ["numPlays"],
      },
    },
  };
}

async function detail(context: TestAppContext, id: string): Promise<GameWithPurchaseUtilization> {
  const response = await jsonRequest(context.app, "GET", `/api/games/${id}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<GameWithPurchaseUtilization>;
}

function collectionRenames(context: TestAppContext): number {
  return context.fileOps.calls.filter(
    ({ method, args }) => method === "rename" && args[1] === collectionPath,
  ).length;
}

describe("persisted purchase utilization flow", () => {
  test("migrates, refreshes, calculates, reloads, normalizes, and corrects durably", async () => {
    const initial = boot(await schemaTwoFixture(), refreshedBggResult());

    const purchase = await jsonRequest(initial.app, "PUT", "/api/games/ordinary-game/acquisition", {
      state: "purchase",
      amount: "20.00",
    });
    expect(purchase.status).toBe(200);
    expect(
      await jsonRequest(initial.app, "PUT", "/api/games/vetoed-game/acquisition", {
        state: "purchase",
        amount: "5.00",
      }),
    ).toHaveProperty("status", 200);
    expect(
      await jsonRequest(initial.app, "PUT", "/api/collection/entertainment-benchmark", {
        amount: "4.00",
      }),
    ).toHaveProperty("status", 200);

    const migrated = await initial.storageService.loadCollection();
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.games[0].playCountEvidence).toMatchObject({
      status: "valid",
      value: 1,
      source: "legacy-unknown",
      observedAt: null,
    });
    expect(migrated.games[0].suggestedPlayerPoll).toMatchObject({
      status: "valid",
      state: "usable",
      source: "legacy-unknown",
      observedAt: null,
    });
    const beforeRefresh = await detail(initial, "ordinary-game");
    expect(beforeRefresh.purchaseUtilization).toMatchObject({
      outcome: "not-met",
      components: { valueRemaining: { display: "$12.00" } },
    });

    const refresh = await jsonRequest(initial.app, "POST", "/api/games/ordinary-game/refresh");
    expect(refresh.status).toBe(200);
    const refreshed = await initial.storageService.loadCollection();
    const ordinaryRecord = refreshed.games.find(({ id }) => id === "ordinary-game");
    expect(ordinaryRecord?.playCountEvidence).toMatchObject({
      status: "valid",
      value: 3,
      source: "bgg-collection",
      observedAt: collectionObservedAt,
    });
    expect(ordinaryRecord?.durationEvidence).toMatchObject({
      status: "valid",
      value: 30,
      source: "bgg-thing",
      observedAt: thingObservedAt,
    });
    expect(ordinaryRecord?.playerRangeEvidence).toMatchObject({
      status: "valid",
      value: { minPlayers: 2, maxPlayers: 2 },
      observedAt: thingObservedAt,
    });
    expect(ordinaryRecord?.suggestedPlayerPoll).toMatchObject({
      status: "valid",
      state: "usable",
      observedAt: thingObservedAt,
    });
    expect((await detail(initial, "ordinary-game")).purchaseUtilization).toMatchObject({
      outcome: "not-met",
      components: { valueRemaining: { display: "$8.00" } },
    });
    if (!ordinaryRecord) throw new Error("Ordinary game was not persisted after refresh");
    const inputsBeforeBenchmarkChange = {
      acquisition: structuredClone(ordinaryRecord.acquisition),
      playCountEvidence: structuredClone(ordinaryRecord.playCountEvidence),
      durationEvidence: structuredClone(ordinaryRecord.durationEvidence),
      playerRangeEvidence: structuredClone(ordinaryRecord.playerRangeEvidence),
      suggestedPlayerPoll: structuredClone(ordinaryRecord.suggestedPlayerPoll),
    };
    expect(
      await jsonRequest(initial.app, "PUT", "/api/collection/entertainment-benchmark", {
        amount: "8.00",
      }),
    ).toHaveProperty("status", 200);

    const ordinary = await detail(initial, "ordinary-game");
    expect(ordinary.displayScore).toBe("6.0");
    expect(ordinary.purchaseUtilization.evidence.fitness).toMatchObject({ value: "6.0" });
    expect(ordinary.purchaseUtilization).toMatchObject({
      outcome: "met",
      components: {
        valueRemaining: { outcome: "calculated", display: "$0.00" },
        estimatedAdditionalPlays: { outcome: "calculated", display: "0" },
      },
    });
    const afterBenchmarkChange = await initial.storageService.loadCollection();
    const unchangedInputs = afterBenchmarkChange.games.find(({ id }) => id === "ordinary-game");
    expect(unchangedInputs).toMatchObject(inputsBeforeBenchmarkChange);
    const vetoed = await detail(initial, "vetoed-game");
    expect(vetoed.displayScore).toBe("0.0");
    expect(vetoed.purchaseUtilization).toMatchObject({
      outcome: "not-met",
      components: {
        valueRemaining: { outcome: "calculated", display: "$5.00" },
        estimatedAdditionalPlays: { outcome: "unreachable" },
      },
    });
    const third = await initial.gameService.addGame({ name: "Unavailable Middle" });
    expect(
      await jsonRequest(initial.app, "PUT", `/api/games/${third.game.id}/ratings`, {
        ratings: { "value-axis": 4 },
      }),
    ).toHaveProperty("status", 200);
    const daemonList = (await (
      await jsonRequest(initial.app, "GET", "/api/games")
    ).json()) as GameWithPurchaseUtilization[];
    expect(daemonList.map(({ game }) => game.id)).toEqual([
      "ordinary-game",
      third.game.id,
      "vetoed-game",
    ]);
    expect(
      daemonList.map(({ purchaseUtilization }) =>
        purchaseUtilization.components.valueRemaining.outcome === "calculated"
          ? purchaseUtilization.components.valueRemaining.display
          : null,
      ),
    ).toEqual(["$0.00", null, "$5.00"]);

    const persistedAfterRefresh = initial.fileOps.files.get(collectionPath);
    if (persistedAfterRefresh === undefined) throw new Error("Collection was not persisted");
    const reloaded = boot(persistedAfterRefresh);
    const ordinaryAfterReload = await detail(reloaded, "ordinary-game");
    expect(ordinaryAfterReload.purchaseUtilization).toEqual(ordinary.purchaseUtilization);
    expect((await reloaded.storageService.loadCollection()).games[0]).toMatchObject({
      playCountEvidence: { observedAt: collectionObservedAt },
      durationEvidence: { observedAt: thingObservedAt },
      playerRangeEvidence: { observedAt: thingObservedAt },
      suggestedPlayerPoll: { observedAt: thingObservedAt },
    });
    expect(collectionRenames(reloaded)).toBe(0);

    const malformed = JSON.parse(persistedAfterRefresh) as Record<string, unknown>;
    const malformedGames = malformed.games as Array<Record<string, unknown>>;
    malformedGames[0].acquisition = {
      state: "purchase",
      amount: { hundredths: "not-an-integer", source: "manual" },
    };
    malformed.entertainmentBenchmark = {
      state: "configured",
      amount: { hundredths: -1, source: "manual" },
    };
    const correcting = boot(JSON.stringify(malformed));
    const invalid = await detail(correcting, "ordinary-game");
    expect(invalid.purchaseUtilization.reasons).toEqual(["invalid-acquisition"]);
    const normalized = await correcting.storageService.loadCollection();
    expect(normalized.games[0].acquisition).toEqual({
      state: "invalid",
      evidence: {
        presence: "present",
        value: {
          state: "purchase",
          amount: { hundredths: "not-an-integer", source: "manual" },
        },
      },
    });
    expect(normalized.entertainmentBenchmark).toEqual({
      state: "invalid",
      evidence: {
        presence: "present",
        value: {
          state: "configured",
          amount: { hundredths: -1, source: "manual" },
        },
      },
    });
    const normalizedText = correcting.fileOps.files.get(collectionPath);
    if (normalizedText === undefined) throw new Error("Invalid collection was not normalized");
    const normalizedReload = boot(normalizedText);
    const normalizedAgain = await normalizedReload.storageService.loadCollection();
    expect(normalizedAgain.games[0].acquisition).toEqual(normalized.games[0].acquisition);
    expect(normalizedAgain.entertainmentBenchmark).toEqual(normalized.entertainmentBenchmark);
    expect(collectionRenames(normalizedReload)).toBe(0);

    expect(
      await jsonRequest(normalizedReload.app, "PUT", "/api/games/ordinary-game/acquisition", {
        state: "purchase",
        amount: "20.00",
      }),
    ).toHaveProperty("status", 200);
    expect(
      await jsonRequest(normalizedReload.app, "PUT", "/api/collection/entertainment-benchmark", {
        amount: "8.00",
      }),
    ).toHaveProperty("status", 200);
    const corrected = await normalizedReload.storageService.loadCollection();
    const confirmationTime =
      corrected.games[0].acquisition.state === "purchase"
        ? corrected.games[0].acquisition.amount.confirmedAt
        : null;
    const benchmarkTime =
      corrected.entertainmentBenchmark?.state === "configured"
        ? corrected.entertainmentBenchmark.amount.confirmedAt
        : null;
    const renamesBeforeNoOps = collectionRenames(normalizedReload);

    await jsonRequest(normalizedReload.app, "PUT", "/api/games/ordinary-game/acquisition", {
      state: "purchase",
      amount: "20.0",
    });
    await jsonRequest(normalizedReload.app, "PUT", "/api/collection/entertainment-benchmark", {
      amount: "8",
    });
    expect(collectionRenames(normalizedReload)).toBe(renamesBeforeNoOps);
    const afterNoOps = await normalizedReload.storageService.loadCollection();
    expect(afterNoOps.games[0].acquisition).toMatchObject({
      state: "purchase",
      amount: { hundredths: 2000, confirmedAt: confirmationTime },
    });
    expect(afterNoOps.entertainmentBenchmark).toMatchObject({
      state: "configured",
      amount: { hundredths: 800, confirmedAt: benchmarkTime },
    });

    const correctedText = normalizedReload.fileOps.files.get(collectionPath);
    if (correctedText === undefined) throw new Error("Corrected collection was not persisted");
    const finalReload = boot(correctedText);
    const finalCollection: Collection = await finalReload.storageService.loadCollection();
    expect(finalCollection.games[0].acquisition.state).toBe("purchase");
    expect(finalCollection.entertainmentBenchmark?.state).toBe("configured");
    expect((await detail(finalReload, "ordinary-game")).purchaseUtilization).toMatchObject({
      outcome: "met",
      components: { valueRemaining: { display: "$0.00" } },
    });
  });
});
