import { describe, expect, test } from "bun:test";
import { attentionCandidateStorageFor } from "../src/services/attention-candidate-service.js";
import { createAnalystProjectionSnapshotService } from "../src/services/analyst-evidence-projections.js";
import { recoverAttentionCandidatesOnStartup } from "../src/index.js";
import { createProfileService } from "../src/services/profile-service.js";
import { createPredictionService } from "../src/services/prediction-service.js";
import { createTournamentService } from "../src/services/tournament-service.js";
import { profileSourceCoordinatorFor } from "../src/services/profile-source-coordinator.js";
import type { BggGameResult } from "../src/services/bgg-client.js";
import {
  createAttentionCandidateMaintenanceRecovery,
  createAttentionDispositionGlobalMaintenance,
} from "../src/services/attention-disposition-maintenance.js";
import { createAttentionDispositionService } from "../src/services/attention-disposition-service.js";
import {
  createAttentionCandidateOracle,
  createAttentionCandidateProductionSourceLoader,
} from "../src/services/attention-candidate-service.js";
import type { DisplayedFitnessService } from "../src/services/displayed-fitness-service.js";
import type { Collection, DurableGame } from "@shelf-judge/shared";
import { createCompleteEntityMetadata, createInitialEntityMetadata } from "@shelf-judge/shared";
import {
  canonicalUtilizationCases,
  UTILIZATION_OBSERVED_AT,
} from "../../../test-fixtures/purchase-utilization-responses.js";
import { createMockBggClient, createTestApp, jsonRequest } from "./helpers/test-app.js";

describe("Phase 3 direct integration evidence", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const snoozeExpiresAt = "2026-01-31T00:00:00.000Z";

  const refreshedBggResult = (): BggGameResult => ({
    entityMetadata: createCompleteEntityMetadata({ mechanic: [], designer: [], artist: [] }, now),
    metadata: {
      bggId: 101,
      name: "Snooze control game",
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
      fetchedAt: now,
    },
    metadataObservation: {
      sourceRequest: "bgg-thing",
      observedAt: now,
      state: "complete",
      fieldsReturned: ["playingTime", "minPlayers", "maxPlayers", "bggData"],
    },
    playerRangeObservation: {
      sourceRequest: "bgg-thing",
      observedAt: now,
      state: "complete",
      fieldsReturned: ["minPlayers", "maxPlayers"],
    },
    suggestedPlayerPoll: {
      state: "usable",
      buckets: [{ playerCount: "2", best: 12, recommended: 3, notRecommended: 1 }],
      observation: {
        sourceRequest: "bgg-thing",
        observedAt: now,
        state: "complete",
        fieldsReturned: ["suggestedPlayerPoll"],
      },
    },
    collectionData: {
      numPlays: 0,
      observation: {
        sourceRequest: "bgg-collection",
        observedAt: now,
        state: "complete",
        fieldsReturned: ["numPlays"],
      },
    },
  });

  async function createWriterSnoozeFixture() {
    let observedAt = now;
    const context = createTestApp({
      bggClient: createMockBggClient({ getGame: () => Promise.resolve(refreshedBggResult()) }),
      now: () => observedAt,
    });
    const added = await context.gameService.addGame({ name: "Snooze control game", bggId: 101 });
    const source = createAttentionCandidateProductionSourceLoader(context.storageService);
    const oracle = createAttentionCandidateOracle(context.displayedFitnessService);
    const winner = (await oracle.evaluate(await source(), observedAt)).evaluations.find(
      (evaluation) => evaluation.gameId === added.game.id,
    )?.winner;
    if (winner === undefined || winner === null) throw new Error("Expected current candidate");

    const dispositions = createAttentionDispositionService({
      collectionMutations: context.collectionMutationService,
      clock: { now: () => new Date(observedAt) },
      currentSelection: () => Promise.resolve({ gameId: added.game.id, ...winner }),
      maintenance: context.attentionCandidateService,
    });
    expect(
      await dispositions.execute({
        operation: "not-now",
        commandId: "33333333-3333-4333-8333-333333333333",
        gameId: added.game.id,
        ruleId: winner.ruleId,
        ruleVersion: winner.ruleVersion,
        fingerprint: winner.fingerprint,
        expectedVersion: 0,
      }),
    ).toMatchObject({ outcome: "accepted", receipt: { operation: "not-now" } });
    const persisted = await context.storageService.loadCollection();
    const snooze = persisted.attentionDispositions.find((value) => value.kind === "snoozed");
    if (snooze === undefined) throw new Error("Expected durable snooze");
    expect(snooze.expiresAt).toBe(snoozeExpiresAt);
    expect(persisted.commandReceipts).toHaveLength(1);

    let maintenanceAttempts = 0;
    const maintain = context.attentionCandidateService.maintainAfterCollectionCommit.bind(
      context.attentionCandidateService,
    );
    context.attentionCandidateService.maintainAfterCollectionCommit = async (impact) => {
      maintenanceAttempts += 1;
      return maintain(impact);
    };
    observedAt = "2026-01-02T00:00:00.000Z";
    return {
      context,
      gameId: added.game.id,
      snooze: structuredClone(snooze),
      dispositions,
      winner,
      maintenanceAttempts: () => maintenanceAttempts,
    };
  }

  async function createUnderusedPurchaseFixture() {
    const context = createTestApp({
      now: () => now,
      bggClient: createMockBggClient({ getGame: () => Promise.resolve(refreshedBggResult()) }),
    });
    const fixture = canonicalUtilizationCases.find((candidate) => candidate.id === "canonical-20");
    if (fixture === undefined) throw new Error("Missing canonical-20 fixture");
    const game: DurableGame = {
      id: "a0000000-0000-4000-8000-000000000020",
      bggId: null,
      entityMetadata: createInitialEntityMetadata(null),
      latestPlayCountCheck: null,
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
      manualValues: { playingTime: null, playerCount: null },
      ownership: "owned",
      boxDimensions: null,
      manualShelfId: null,
      ownerNote: { state: "missing", version: 0, updatedAt: null },
      ratings: { "parity-axis": 6 },
      createdAt: UTILIZATION_OBSERVED_AT,
      updatedAt: UTILIZATION_OBSERVED_AT,
    };
    await context.storageService.saveCollection({
      schemaVersion: 8,
      revision: 0,
      id: "underused-fixture",
      name: "Underused fixture",
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
      games: [game],
      entertainmentBenchmark: fixture.input.entertainmentBenchmark,
      intentions: [],
      attentionDispositions: [],
      commandReceipts: [],
      createdAt: UTILIZATION_OBSERVED_AT,
      updatedAt: UTILIZATION_OBSERVED_AT,
    });
    const source = createAttentionCandidateProductionSourceLoader(context.storageService);
    const oracle = createAttentionCandidateOracle(context.displayedFitnessService);
    const winner = (await oracle.evaluate(await source(), now)).evaluations[0]?.winner;
    if (winner?.ruleId !== "underused-purchase")
      throw new Error("Expected underused-purchase winner");
    const dispositions = createAttentionDispositionService({
      collectionMutations: context.collectionMutationService,
      clock: { now: () => new Date(now) },
      currentSelection: () => Promise.resolve({ gameId: game.id, ...winner }),
      maintenance: context.attentionCandidateService,
    });
    const dispositionOutcome = await dispositions.execute({
      operation: "intentional",
      commandId: "90000000-0000-4000-8000-000000000001",
      gameId: game.id,
      ruleId: winner.ruleId,
      ruleVersion: winner.ruleVersion,
      fingerprint: winner.fingerprint,
      expectedVersion: 0,
    });
    if (dispositionOutcome.outcome === "rejected")
      throw new Error(JSON.stringify(dispositionOutcome.error));
    if (dispositionOutcome.outcome === "replayed")
      throw new Error("Expected new disposition command");
    const persisted = await context.storageService.loadCollection();
    const receipt = persisted.commandReceipts[0];
    if (receipt === undefined) throw new Error("Expected durable disposition receipt");
    return { context, gameId: game.id, winner, receipt: structuredClone(receipt), dispositions };
  }

  function productionDispositions(context: ReturnType<typeof createTestApp>, at: string) {
    const source = createAttentionCandidateProductionSourceLoader(context.storageService);
    const oracle = createAttentionCandidateOracle(context.displayedFitnessService);
    return createAttentionDispositionService({
      collectionMutations: context.collectionMutationService,
      clock: { now: () => new Date(at) },
      currentSelection: async (collection, gameId) => {
        const evaluation = (
          await oracle.evaluate({ ...(await source()), collection }, at)
        ).evaluations.find((candidate) => candidate.gameId === gameId);
        return evaluation?.winner === null || evaluation?.winner === undefined
          ? null
          : { gameId, ...evaluation.winner };
      },
      maintenance: context.attentionCandidateService,
    });
  }

  async function intentionallyDispositionCurrentCandidate(
    context: ReturnType<typeof createTestApp>,
    gameId: string,
    commandId: string,
    at: string,
  ) {
    const source = createAttentionCandidateProductionSourceLoader(context.storageService);
    const oracle = createAttentionCandidateOracle(context.displayedFitnessService);
    const winner = (await oracle.evaluate(await source(), at)).evaluations.find(
      (candidate) => candidate.gameId === gameId,
    )?.winner;
    if (winner === undefined || winner === null) throw new Error("Expected current candidate");
    const outcome = await productionDispositions(context, at).execute({
      operation: "intentional",
      commandId,
      gameId,
      ruleId: winner.ruleId,
      ruleVersion: winner.ruleVersion,
      fingerprint: winner.fingerprint,
      expectedVersion: 0,
    });
    if (outcome.outcome !== "accepted") throw new Error("Expected accepted disposition");
    return { winner, receipt: structuredClone(outcome.receipt) };
  }

  test("GB-V1 refreshBggData clears only the incompatible stored play rule via production oracle wiring", async () => {
    const thingObservedAt = "2026-08-26T10:00:00.000Z";
    const collectionObservedAt = "2026-08-26T11:00:00.000Z";
    const refreshedBggResult = (): BggGameResult => ({
      entityMetadata: createCompleteEntityMetadata(
        { mechanic: [], designer: [], artist: [] },
        thingObservedAt,
      ),
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
    });
    const context = createTestApp({
      bggClient: createMockBggClient({
        getGame: () => Promise.resolve(refreshedBggResult()),
        getPlayCount: () =>
          Promise.resolve({
            observation: {
              sourceRequest: "bgg-plays",
              observedAt: collectionObservedAt,
              state: "complete",
              fieldsReturned: ["numPlays"],
            },
            numPlays: 3,
            playRecords: [
              { id: 9001, bggId: 101, quantity: 3, dateState: "valid", playedOn: "2026-08-25" },
            ],
          }),
      }),
      now: () => "2027-01-01T00:00:00.000Z",
    });
    const affected = await context.gameService.addGame({ name: "Ordinary Purchase", bggId: 101 });
    const unrelated = await context.gameService.addGame({ name: "Unrelated", numPlays: 0 });
    const collection = await context.storageService.loadCollection();
    const affectedGame = collection.games.find((game) => game.id === affected.game.id);
    if (!affectedGame) throw new Error("Missing affected game");
    affectedGame.numPlays = 0;
    affectedGame.playCountEvidence = {
      status: "valid",
      value: 0,
      source: "manual",
      observedAt: "2026-01-01T00:00:00.000Z",
    };
    affectedGame.latestPlayCountCheck = null;
    await context.storageService.saveCollection({
      ...collection,
      attentionDispositions: [],
      commandReceipts: [],
    });
    const affectedDisposition = await intentionallyDispositionCurrentCandidate(
      context,
      affected.game.id,
      "11111111-1111-4111-8111-111111111111",
      "2027-01-01T00:00:00.000Z",
    );
    const unrelatedDisposition = await intentionallyDispositionCurrentCandidate(
      context,
      unrelated.game.id,
      "22222222-2222-4222-8222-222222222222",
      "2027-01-01T00:00:00.000Z",
    );
    let attempts = 0;
    const maintain = context.attentionCandidateService.maintainAfterCollectionCommit.bind(
      context.attentionCandidateService,
    );
    context.attentionCandidateService.maintainAfterCollectionCommit = async (impact) => {
      attempts += 1;
      return maintain(impact);
    };
    const before = await context.storageService.loadCollection();
    const writesBefore = context.fileOps.calls.filter(
      (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
    ).length;
    await context.gameService.refreshBggData(affected.game.id);
    const after = await context.storageService.loadCollection();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.attentionDispositions).toEqual([
      {
        gameId: unrelated.game.id,
        kind: "intentional",
        ruleId: unrelatedDisposition.winner.ruleId,
        ruleVersion: unrelatedDisposition.winner.ruleVersion,
        fingerprint: unrelatedDisposition.winner.fingerprint,
        version: 1,
      },
    ]);
    expect(after.commandReceipts).toEqual([
      affectedDisposition.receipt,
      unrelatedDisposition.receipt,
    ]);
    expect(after.bggPlaySessions).toEqual([
      {
        playId: 9001,
        bggId: 101,
        quantity: 3,
        playedOn: "2026-08-25",
        observedAt: collectionObservedAt,
      },
    ]);
    expect(
      context.fileOps.calls.filter(
        (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
      ).length,
    ).toBe(writesBefore + 1);
    expect(attempts).toBe(1);
  });

  for (const writer of [
    {
      name: "setPlayCount",
      write: async ({ context, gameId }: Awaited<ReturnType<typeof createWriterSnoozeFixture>>) =>
        context.intentionService.setPlayCount(gameId, 0),
    },
    {
      name: "refreshBggData",
      write: async ({ context, gameId }: Awaited<ReturnType<typeof createWriterSnoozeFixture>>) =>
        context.gameService.refreshBggData(gameId),
    },
    {
      name: "acquisition route",
      write: async ({ context, gameId }: Awaited<ReturnType<typeof createWriterSnoozeFixture>>) => {
        expect(
          (
            await jsonRequest(context.app, "PUT", `/api/games/${gameId}/acquisition`, {
              state: "gift",
            })
          ).status,
        ).toBe(200);
      },
    },
    {
      name: "intention create",
      write: async ({ context, gameId }: Awaited<ReturnType<typeof createWriterSnoozeFixture>>) => {
        expect(
          await context.intentionService.execute({
            type: "create",
            commandId: "44444444-4444-4444-8444-444444444444",
            gameId,
            kind: "want-to-play",
            expectedActiveIntention: "absent",
          }),
        ).toMatchObject({ ok: true });
      },
    },
  ]) {
    test(`GB-V1 ${writer.name} preserves a durable current-candidate snooze`, async () => {
      const fixture = await createWriterSnoozeFixture();
      const before = await fixture.context.storageService.loadCollection();
      const receiptBefore = structuredClone(before.commandReceipts);
      const writesBefore = fixture.context.fileOps.calls.filter(
        (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
      ).length;
      await writer.write(fixture);
      const after = await fixture.context.storageService.loadCollection();
      expect(after.revision).toBe(before.revision + 1);
      expect(after.attentionDispositions).toEqual([fixture.snooze]);
      expect(after.commandReceipts.slice(0, receiptBefore.length)).toEqual(receiptBefore);
      expect(
        fixture.context.fileOps.calls.filter(
          (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
        ).length,
      ).toBe(writesBefore + 1);
      expect(fixture.maintenanceAttempts()).toBe(1);
    });
  }

  test("keeps a stored underused disposition through an explicit intention and clears it with its declared play dependency", async () => {
    const context = createTestApp();
    const fixture = canonicalUtilizationCases.find((candidate) => candidate.id === "canonical-20");
    if (fixture === undefined) throw new Error("Missing canonical-20 fixture");
    const games: DurableGame[] = [
      {
        id: fixture.id,
        bggId: null,
        entityMetadata: createInitialEntityMetadata(null),
        latestPlayCountCheck: null,
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
        playingTime:
          fixture.input.duration.status === "valid" ? fixture.input.duration.value : null,
        imageUrl: null,
        bggData: null,
        numPlays: fixture.input.playCount.status === "valid" ? fixture.input.playCount.value : null,
        acquisition: fixture.input.acquisition,
        playCountEvidence: fixture.input.playCount,
        durationEvidence: fixture.input.duration,
        playerRangeEvidence: fixture.input.playerRange,
        suggestedPlayerPoll: fixture.input.suggestedPlayerPoll,
        bestPlayersInvalidEvidence: null,
        manualValues: { playingTime: null, playerCount: null },
        ownership: "owned",
        boxDimensions: null,
        manualShelfId: null,
        ownerNote: { state: "missing", version: 0, updatedAt: null },
        ratings: { "parity-axis": 6 },
        createdAt: UTILIZATION_OBSERVED_AT,
        updatedAt: UTILIZATION_OBSERVED_AT,
      },
    ];
    const collection: Collection = {
      schemaVersion: 8,
      revision: 0,
      id: "gb-1-collection",
      name: "GB-1",
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
      entertainmentBenchmark: fixture.input.entertainmentBenchmark,
      intentions: [],
      attentionDispositions: [],
      commandReceipts: [],
      createdAt: UTILIZATION_OBSERVED_AT,
      updatedAt: UTILIZATION_OBSERVED_AT,
    };
    await context.storageService.saveCollection(collection);

    const at = "2026-01-01T00:00:00.000Z";
    const oracle = createAttentionCandidateOracle(context.displayedFitnessService);
    const loadSource = createAttentionCandidateProductionSourceLoader(context.storageService);
    const baseline = await oracle.evaluate(await loadSource(), at);
    const underused = baseline.evaluations.find(
      (evaluation) => evaluation.winner?.ruleId === "underused-purchase",
    );
    if (underused === undefined || underused.winner === null)
      throw new Error("Expected an underused-purchase winner");
    const underusedWinner = underused.winner;
    const storedBefore = await oracle.evaluateStoredRules(await loadSource(), at, [
      { gameId: underused.gameId, ruleId: "underused-purchase" },
    ]);
    expect(storedBefore).toEqual([
      {
        gameId: underused.gameId,
        ruleId: "underused-purchase",
        ruleVersion: underusedWinner.ruleVersion,
        fingerprint: underusedWinner.fingerprint,
      },
    ]);

    const intentional = await context.storageService.loadCollection();
    await context.storageService.saveCollection({
      ...intentional,
      attentionDispositions: [
        {
          gameId: underused.gameId,
          kind: "intentional",
          ruleId: underusedWinner.ruleId,
          ruleVersion: underusedWinner.ruleVersion,
          fingerprint: underusedWinner.fingerprint,
          version: 1,
        },
      ],
    });

    expect(
      await context.intentionService.execute({
        type: "create",
        commandId: "00000000-0000-4000-8000-000000000001",
        gameId: underused.gameId,
        kind: "first-play",
        expectedActiveIntention: "absent",
      }),
    ).toMatchObject({ ok: true });
    const withIntention = await loadSource();
    const compatibilitySource = {
      ...withIntention,
      collection: { ...withIntention.collection, attentionDispositions: [] },
    };
    expect(
      (await oracle.evaluate(compatibilitySource, at)).evaluations.find(
        (evaluation) => evaluation.gameId === underused.gameId,
      )?.winner?.ruleId,
    ).toBe("explicit-intention");
    expect(
      await oracle.evaluateStoredRules(compatibilitySource, at, [
        { gameId: underused.gameId, ruleId: "underused-purchase" },
      ]),
    ).toEqual(storedBefore);
    expect((await context.storageService.loadCollection()).attentionDispositions).toHaveLength(1);

    const beforeCorrection = await context.storageService.loadCollection();
    await context.intentionService.setPlayCount(underused.gameId, 100);
    const afterCorrection = await context.storageService.loadCollection();
    expect(
      await oracle.evaluateStoredRules(await loadSource(), at, [
        { gameId: underused.gameId, ruleId: "underused-purchase" },
      ]),
    ).not.toEqual(storedBefore);
    expect(afterCorrection.attentionDispositions).toEqual([]);
    expect(afterCorrection.revision).toBe(beforeCorrection.revision + 1);
  });

  test("GB-V1 acquisition route atomically clears a real underused-purchase intention", async () => {
    const fixture = await createUnderusedPurchaseFixture();
    const { context } = fixture;
    const unrelated = await context.gameService.addGame({
      name: "Unrelated durable disposition",
      bggId: 101,
    });
    const unrelatedDisposition = await intentionallyDispositionCurrentCandidate(
      context,
      unrelated.game.id,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      now,
    );
    let attempts = 0;
    const maintain = context.attentionCandidateService.maintainAfterCollectionCommit.bind(
      context.attentionCandidateService,
    );
    context.attentionCandidateService.maintainAfterCollectionCommit = async (impact) => {
      attempts += 1;
      return maintain(impact);
    };
    const before = await context.storageService.loadCollection();
    const savesBefore = context.fileOps.calls.filter(
      (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
    ).length;
    expect(
      (
        await jsonRequest(context.app, "PUT", `/api/games/${fixture.gameId}/acquisition`, {
          state: "gift",
        })
      ).status,
    ).toBe(200);
    const after = await context.storageService.loadCollection();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.games[0]?.acquisition).toEqual({ state: "gift" });
    expect(after.attentionDispositions).toEqual([
      {
        gameId: unrelated.game.id,
        kind: "intentional",
        ruleId: unrelatedDisposition.winner.ruleId,
        ruleVersion: unrelatedDisposition.winner.ruleVersion,
        fingerprint: unrelatedDisposition.winner.fingerprint,
        version: 1,
      },
    ]);
    expect(after.commandReceipts).toEqual([fixture.receipt, unrelatedDisposition.receipt]);
    expect(
      context.fileOps.calls.filter(
        (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
      ).length,
    ).toBe(savesBefore + 1);
    expect(attempts).toBe(1);
  });

  for (const transition of ["complete", "retire"] as const) {
    test(`GB-V1 intention ${transition} atomically clears only its real explicit-intention disposition`, async () => {
      const context = createTestApp({
        now: () => now,
        bggClient: createMockBggClient({ getGame: () => Promise.resolve(refreshedBggResult()) }),
      });
      const target = await context.gameService.addGame({
        name: `Explicit ${transition}`,
        bggId: 101,
      });
      const unrelated = await context.gameService.addGame({
        name: `Unrelated ${transition}`,
        bggId: 102,
      });
      const created = await context.intentionService.execute({
        type: "create",
        commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        gameId: target.game.id,
        kind: "want-to-play",
        expectedActiveIntention: "absent",
      });
      if (!created.ok) throw new Error("Expected intention create");
      const targetDisposition = await intentionallyDispositionCurrentCandidate(
        context,
        target.game.id,
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        now,
      );
      expect(targetDisposition.winner.ruleId).toBe("explicit-intention");
      const unrelatedDisposition = await intentionallyDispositionCurrentCandidate(
        context,
        unrelated.game.id,
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        now,
      );
      const before = await context.storageService.loadCollection();
      const targetIntention = before.intentions.find(
        (intention) => intention.intentionId === created.intention.intentionId,
      );
      if (targetIntention === undefined) throw new Error("Expected durable intention");
      let attempts = 0;
      const maintain = context.attentionCandidateService.maintainAfterCollectionCommit.bind(
        context.attentionCandidateService,
      );
      context.attentionCandidateService.maintainAfterCollectionCommit = async (impact) => {
        attempts += 1;
        return maintain(impact);
      };
      const savesBefore = context.fileOps.calls.filter(
        (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
      ).length;
      const resolved = await context.intentionService.execute({
        type: transition,
        commandId:
          transition === "complete"
            ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
            : "ffffffff-ffff-4fff-8fff-ffffffffffff",
        gameId: target.game.id,
        intentionId: targetIntention.intentionId,
        expectedVersion: targetIntention.version,
      });
      expect(resolved).toMatchObject({ ok: true });
      const after = await context.storageService.loadCollection();
      expect(after.revision).toBe(before.revision + 1);
      expect(after.attentionDispositions).toEqual([
        {
          gameId: unrelated.game.id,
          kind: "intentional",
          ruleId: unrelatedDisposition.winner.ruleId,
          ruleVersion: unrelatedDisposition.winner.ruleVersion,
          fingerprint: unrelatedDisposition.winner.fingerprint,
          version: 1,
        },
      ]);
      expect(after.commandReceipts).toContainEqual(targetDisposition.receipt);
      expect(after.commandReceipts).toContainEqual(unrelatedDisposition.receipt);
      expect(
        context.fileOps.calls.filter(
          (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
        ).length,
      ).toBe(savesBefore + 1);
      expect(attempts).toBe(1);
    });

    test(`GB-V1 intention ${transition} preserves a real snooze receipt`, async () => {
      const context = createTestApp({
        now: () => now,
        bggClient: createMockBggClient({ getGame: () => Promise.resolve(refreshedBggResult()) }),
      });
      const target = await context.gameService.addGame({
        name: `Snoozed explicit ${transition}`,
        bggId: 101,
      });
      const created = await context.intentionService.execute({
        type: "create",
        commandId: "12121212-1212-4121-8121-121212121212",
        gameId: target.game.id,
        kind: "want-to-play",
        expectedActiveIntention: "absent",
      });
      if (!created.ok) throw new Error("Expected intention create");
      const source = createAttentionCandidateProductionSourceLoader(context.storageService);
      const oracle = createAttentionCandidateOracle(context.displayedFitnessService);
      const winner = (await oracle.evaluate(await source(), now)).evaluations.find(
        (candidate) => candidate.gameId === target.game.id,
      )?.winner;
      if (winner === undefined || winner === null)
        throw new Error("Expected explicit-intention winner");
      expect(winner.ruleId).toBe("explicit-intention");
      const snoozed = await productionDispositions(context, now).execute({
        operation: "not-now",
        commandId: "13131313-1313-4131-8131-131313131313",
        gameId: target.game.id,
        ruleId: winner.ruleId,
        ruleVersion: winner.ruleVersion,
        fingerprint: winner.fingerprint,
        expectedVersion: 0,
      });
      if (snoozed.outcome !== "accepted") throw new Error("Expected accepted snooze");
      const before = await context.storageService.loadCollection();
      const intention = before.intentions.find(
        (candidate) => candidate.intentionId === created.intention.intentionId,
      );
      if (intention === undefined) throw new Error("Expected durable intention");
      const resolved = await context.intentionService.execute({
        type: transition,
        commandId:
          transition === "complete"
            ? "14141414-1414-4141-8141-141414141414"
            : "15151515-1515-4151-8151-151515151515",
        gameId: target.game.id,
        intentionId: intention.intentionId,
        expectedVersion: intention.version,
      });
      expect(resolved).toMatchObject({ ok: true });
      const after = await context.storageService.loadCollection();
      expect(after.attentionDispositions).toEqual(before.attentionDispositions);
      expect(after.commandReceipts).toContainEqual(snoozed.receipt);
    });
  }

  for (const kind of ["intentional", "snoozed"] as const) {
    test(`GB-V1 setOwnership clears ${kind} disposition with its receipt retained`, async () => {
      const fixture =
        kind === "intentional"
          ? await createUnderusedPurchaseFixture()
          : await createWriterSnoozeFixture();
      const before = await fixture.context.storageService.loadCollection();
      const receipts = structuredClone(before.commandReceipts);
      let attempts = 0;
      const maintain = fixture.context.attentionCandidateService.maintainAfterCollectionCommit.bind(
        fixture.context.attentionCandidateService,
      );
      fixture.context.attentionCandidateService.maintainAfterCollectionCommit = async (impact) => {
        attempts += 1;
        return maintain(impact);
      };
      const savesBefore = fixture.context.fileOps.calls.filter(
        (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
      ).length;
      await fixture.context.gameService.setOwnership(fixture.gameId, "previously-owned");
      const after = await fixture.context.storageService.loadCollection();
      expect(after.revision).toBe(before.revision + 1);
      expect(after.games.find((game) => game.id === fixture.gameId)?.ownership).toBe(
        "previously-owned",
      );
      expect(after.attentionDispositions).toEqual([]);
      expect(after.commandReceipts).toEqual(receipts);
      expect(
        fixture.context.fileOps.calls.filter(
          (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
        ).length,
      ).toBe(savesBefore + 1);
      expect(attempts).toBe(1);
    });
  }

  test("permanent deletion removes a real snooze's authority and cannot replay its command", async () => {
    const fixture = await createWriterSnoozeFixture();
    const unrelated = await fixture.context.gameService.addGame({ name: "Unrelated" });
    const before = await fixture.context.storageService.loadCollection();
    const unrelatedBefore = structuredClone(
      before.games.find((game) => game.id === unrelated.game.id),
    );
    if (unrelatedBefore === undefined) throw new Error("Expected unrelated game");
    const savesBefore = fixture.context.fileOps.calls.filter(
      (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
    ).length;
    const maintenanceBefore = fixture.maintenanceAttempts();

    await fixture.context.gameService.removeGame(fixture.gameId);

    const after = await fixture.context.storageService.loadCollection();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.games).toEqual([unrelatedBefore]);
    expect(after.attentionDispositions).toEqual([]);
    expect(after.commandReceipts).toEqual([]);
    expect(
      fixture.context.fileOps.calls.filter(
        (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
      ).length,
    ).toBe(savesBefore + 1);
    expect(fixture.maintenanceAttempts()).toBe(maintenanceBefore + 1);
    expect(
      await fixture.dispositions.execute({
        operation: "not-now",
        commandId: "33333333-3333-4333-8333-333333333333",
        gameId: fixture.gameId,
        ruleId: fixture.winner.ruleId,
        ruleVersion: fixture.winner.ruleVersion,
        fingerprint: fixture.winner.fingerprint,
        expectedVersion: 0,
      }),
    ).toEqual({ outcome: "rejected", error: { code: "game-not-found", gameId: fixture.gameId } });
  });

  test("permanent deletion removes a real intentional disposition and its receipt", async () => {
    const fixture = await createUnderusedPurchaseFixture();
    const before = await fixture.context.storageService.loadCollection();
    const savesBefore = fixture.context.fileOps.calls.filter(
      (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
    ).length;

    await fixture.context.gameService.removeGame(fixture.gameId);

    const after = await fixture.context.storageService.loadCollection();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.games).toEqual([]);
    expect(after.attentionDispositions).toEqual([]);
    expect(after.commandReceipts).toEqual([]);
    expect(
      fixture.context.fileOps.calls.filter(
        (call) => call.method === "rename" && call.args[1] === "/test/data/collection.json",
      ).length,
    ).toBe(savesBefore + 1);
    expect(
      await fixture.dispositions.execute({
        operation: "intentional",
        commandId: "90000000-0000-4000-8000-000000000001",
        gameId: fixture.gameId,
        ruleId: fixture.winner.ruleId,
        ruleVersion: fixture.winner.ruleVersion,
        fingerprint: fixture.winner.fingerprint,
        expectedVersion: 0,
      }),
    ).toEqual({ outcome: "rejected", error: { code: "game-not-found", gameId: fixture.gameId } });
  });

  test("a global writer's nested maintenance reenters the coordinator and clears durably before publication", async () => {
    const fixture = await createUnderusedPurchaseFixture();
    const { context } = fixture;
    const events: string[] = [];
    let tournamentSaves = 0;
    const before = await context.storageService.loadCollection();
    const saveTournament = context.storageService.saveTournament.bind(context.storageService);
    context.storageService.saveTournament = async (data) => {
      tournamentSaves += 1;
      await saveTournament(data);
      events.push("source-saved");
    };
    const maintenance = createAttentionDispositionGlobalMaintenance({
      collectionMutations: context.collectionMutationService,
      storedRuleMatches: () => {
        events.push("durable-clear");
        return Promise.resolve([]);
      },
      maintainCandidates: () => {
        events.push("candidate-publication");
        return Promise.resolve();
      },
      invalidateCandidates: () => Promise.resolve(),
    });
    const tournament = createTournamentService({
      storageService: context.storageService,
      afterSourceSave: maintenance,
    });

    await profileSourceCoordinatorFor(context.storageService).runExclusive(async () => {
      await tournament.updateSettings({ normalizationHalfWidth: 401 });
    });

    const after = await context.storageService.loadCollection();
    expect(tournamentSaves).toBe(1);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.attentionDispositions).toEqual([]);
    expect(after.commandReceipts).toEqual([fixture.receipt]);
    expect(events).toEqual(["source-saved", "durable-clear", "candidate-publication"]);
  });

  test("global writers save before maintenance and a shared Profile read cannot interleave", async () => {
    const ctx = createTestApp();
    const events: string[] = [];
    let releaseMaintenance!: () => void;
    let maintenanceStarted!: () => void;
    const maintenanceGate = new Promise<void>((resolve) => (releaseMaintenance = resolve));
    const maintenanceStartedGate = new Promise<void>((resolve) => (maintenanceStarted = resolve));
    const saveTournament = ctx.storageService.saveTournament.bind(ctx.storageService);
    ctx.storageService.saveTournament = async (value) => {
      await saveTournament(value);
      events.push("saved");
    };
    const tournament = createTournamentService({
      storageService: ctx.storageService,
      afterSourceSave: async (impact) => {
        expect(impact).toEqual({ kind: "global", reason: "tournament" });
        events.push("maintenance");
        maintenanceStarted();
        await maintenanceGate;
      },
    });
    let profileStarted = false;
    const fitness: DisplayedFitnessService = {
      ...ctx.displayedFitnessService,
      async listGamesFromSnapshot(snapshot, options) {
        profileStarted = true;
        return ctx.displayedFitnessService.listGamesFromSnapshot(snapshot, options);
      },
    };
    const profile = createProfileService({
      storageService: ctx.storageService,
      attentionCandidates: ctx.attentionCandidateService,
      displayedFitnessService: fitness,
    });

    const write = tournament.updateSettings({ normalizationHalfWidth: 401 });
    await maintenanceStartedGate;
    const read = profile.getProfile();
    await Promise.resolve();
    expect(events).toEqual(["saved", "maintenance"]);
    expect(profileStarted).toBe(false);
    releaseMaintenance();
    await write;
    expect((await read).status).toBe("available");

    const prediction = createPredictionService({
      storageService: ctx.storageService,
      fitnessService: ctx.fitnessService,
      tournamentService: ctx.tournamentService,
      afterSourceSave: (impact) => {
        if (impact.kind === "global") events.push(impact.reason);
        return Promise.resolve();
      },
    });
    await prediction.updateSettings({ defaultK: 6 });
    expect(events).toContain("prediction");
    const maintain = ctx.attentionCandidateService.maintain.bind(ctx.attentionCandidateService);
    ctx.attentionCandidateService.maintain = (impact) => {
      events.push(impact.kind === "global" ? impact.reason : "games");
      return maintain(impact);
    };
    expect(
      (await jsonRequest(ctx.app, "PATCH", "/api/redundancy/settings", { enabled: true })).status,
    ).toBe(200);
    expect(events).toContain("redundancy");
  });

  test("failed global save never invokes its maintenance callback", async () => {
    const ctx = createTestApp();
    let maintenance = 0;
    ctx.storageService.saveTournament = () => Promise.reject(new Error("disk failed"));
    const tournament = createTournamentService({
      storageService: ctx.storageService,
      afterSourceSave: () => {
        maintenance += 1;
        return Promise.resolve();
      },
    });
    let failure: Error | null = null;
    try {
      await tournament.updateSettings({ normalizationHalfWidth: 401 });
    } catch (error) {
      if (error instanceof Error) failure = error;
    }
    expect(failure?.message).toBe("disk failed");
    expect(maintenance).toBe(0);
  });

  test("runtime recovery reconciles a committed tournament write before publishing candidates", async () => {
    const fixture = await createUnderusedPurchaseFixture();
    const { context: ctx } = fixture;
    const beforeGlobalWrite = await ctx.storageService.loadCollection();
    const events: string[] = [];
    let saves = 0;
    let calls = 0;
    const targets: Array<{ gameId: string; ruleId: string }> = [];
    const saveTournament = ctx.storageService.saveTournament.bind(ctx.storageService);
    ctx.storageService.saveTournament = async (data) => {
      saves += 1;
      await saveTournament(data);
      events.push("tournament-save");
    };
    const realOracle = createAttentionCandidateOracle(ctx.displayedFitnessService);
    const loadSource = createAttentionCandidateProductionSourceLoader(ctx.storageService);
    const maintenance = createAttentionDispositionGlobalMaintenance({
      collectionMutations: ctx.collectionMutationService,
      storedRuleMatches: async (dispositions) => {
        calls += 1;
        const requested = dispositions.map(({ gameId, ruleId }) => ({ gameId, ruleId }));
        targets.push(...requested);
        events.push(`stored-rule:${calls}`);
        if (calls === 1) throw new Error("winner oracle unavailable");
        const source = await loadSource();
        return realOracle.evaluateStoredRules(
          { ...source, collection: { ...source.collection, attentionDispositions: [] } },
          now,
          requested,
        );
      },
      maintainCandidates: async (impact) => {
        await ctx.attentionCandidateService.maintain(impact);
      },
      invalidateCandidates: () => {
        events.push("candidate-invalidated");
        return ctx.attentionCandidateService.invalidate();
      },
    });
    const recovery = createAttentionCandidateMaintenanceRecovery({
      recoverCompatibility: () => maintenance.recover(),
      ensureFresh: async () => {
        events.push("candidate-publication");
        return ctx.attentionCandidateService.ensureFresh();
      },
    });
    const tournament = createTournamentService({
      storageService: ctx.storageService,
      afterSourceSave: maintenance,
    });

    const settings = await tournament.updateSettings({ normalizationHalfWidth: 401 });
    expect(settings).toMatchObject({
      normalizationHalfWidth: 401,
    });
    expect(saves).toBe(1);
    expect(events).toEqual(["tournament-save", "stored-rule:1", "candidate-invalidated"]);
    expect((await ctx.storageService.loadTournament()).settings.normalizationHalfWidth).toBe(401);
    const unavailable = await ctx.storageService.loadCollection();
    expect(unavailable.revision).toBe(beforeGlobalWrite.revision);
    expect(unavailable.attentionDispositions).toHaveLength(1);
    expect(unavailable.commandReceipts).toHaveLength(1);
    expect(
      await attentionCandidateStorageFor(ctx.storageService).loadAttentionCandidates(),
    ).toBeNull();

    expect((await recovery.recover()).state).toBe("available");
    expect(saves).toBe(1);
    const recovered = await ctx.storageService.loadCollection();
    expect(recovered.revision).toBe(beforeGlobalWrite.revision + 1);
    expect(recovered.attentionDispositions).toEqual([]);
    expect(recovered.commandReceipts).toEqual([fixture.receipt]);
    expect(targets).toEqual([
      { gameId: fixture.gameId, ruleId: "underused-purchase" },
      { gameId: fixture.gameId, ruleId: "underused-purchase" },
    ]);
    expect(events).toEqual([
      "tournament-save",
      "stored-rule:1",
      "candidate-invalidated",
      "stored-rule:2",
      "candidate-publication",
    ]);
  });

  test("Profile reads fail closed without mutating pending durable recovery, then daemon recovery publishes", async () => {
    let attempts = 0;
    const ctx = createTestApp({
      storedRuleMatches: () => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error("oracle unavailable"));
        return Promise.resolve([]);
      },
    });
    const collectionBefore = await ctx.storageService.loadCollection();
    const candidatePath = "/test/data/attention-candidates.json";
    const candidateBytes = '{"preserved":true}';
    ctx.fileOps.files.set(candidatePath, candidateBytes);
    await ctx.tournamentService.updateSettings({ normalizationHalfWidth: 401 });
    const pending = await ctx.storageService.loadCollection();
    expect(pending.revision).toBe(collectionBefore.revision);
    const pendingCandidateBytes = ctx.fileOps.files.get(candidatePath);
    expect(pendingCandidateBytes).toBeUndefined();

    const first = await ctx.profileService.getProfile();
    const second = await ctx.profileService.getProfile();
    expect(first.status).toBe("unavailable");
    expect(second.status).toBe("unavailable");
    expect(attempts).toBe(1);
    expect(await ctx.storageService.loadCollection()).toEqual(pending);
    expect(ctx.fileOps.files.get(candidatePath)).toBe(pendingCandidateBytes);

    await ctx.tournamentService.updateSettings({ normalizationHalfWidth: 402 });
    expect(attempts).toBe(2);
    expect(ctx.attentionDispositionGlobalMaintenance.recoveryRequired()).toBe(false);
    expect((await ctx.profileService.getProfile()).status).toBe("available");

    expect((await ctx.attentionCandidateMaintenanceRecovery.recover()).state).toBe("available");
    expect(attempts).toBe(2);
    expect((await ctx.profileService.getProfile()).status).toBe("available");
  });

  test("config-only writes preserve candidate bytes, invalidate Profile, and do no candidate work", async () => {
    const ctx = createTestApp();
    const candidatePath = "/test/data/attention-candidates.json";
    const exactBytes = '{\n  "candidate": "unchanged"\n}';
    await ctx.profileService.getProfile();
    ctx.fileOps.files.set(candidatePath, exactBytes);
    let candidateLoads = 0;
    const candidateStorage = attentionCandidateStorageFor(ctx.storageService);
    const loadCandidates = () => candidateStorage.loadAttentionCandidates();
    ctx.storageService.loadAttentionCandidates = async () => {
      candidateLoads += 1;
      return loadCandidates();
    };

    const cap = await jsonRequest(ctx.app, "PUT", "/api/config", { profileAttentionCardLimit: 4 });
    expect(cap.status).toBe(200);
    expect(await ctx.storageService.loadProfile()).toBeNull();
    expect(ctx.fileOps.files.get(candidatePath)).toBe(exactBytes);
    expect(candidateLoads).toBe(0);
    const profileEntityPolicy = (await ctx.storageService.loadConfig()).profileEntityPolicy;
    const policy = await jsonRequest(ctx.app, "PUT", "/api/config", { profileEntityPolicy });
    expect(policy.status).toBe(200);
    const unrelated = await jsonRequest(ctx.app, "PUT", "/api/config", { username: "other" });
    expect(unrelated.status).toBe(200);
    expect(candidateLoads).toBe(0);
  });

  test("candidate failure after committed collection source is recoverable without replay", async () => {
    const ctx = createTestApp();
    let candidateSaveFailures = 0;
    const rename = ctx.fileOps.rename.bind(ctx.fileOps);
    ctx.fileOps.rename = async (from, to) => {
      if (to === "/test/data/attention-candidates.json" && candidateSaveFailures++ === 0)
        throw new Error("candidate disk unavailable");
      await rename(from, to);
    };
    const added = await ctx.gameService.addGame({ name: "Committed once" });
    const committed = await ctx.storageService.loadCollection();
    expect(committed.games.map((game) => game.id)).toContain(added.game.id);
    expect(
      await attentionCandidateStorageFor(ctx.storageService).loadAttentionCandidates(),
    ).toBeNull();
    expect((await ctx.attentionCandidateService.ensureFresh()).state).toBe("available");
    const recovered = await ctx.storageService.loadCollection();
    expect(recovered.revision).toBe(committed.revision);
    expect(recovered.games.filter((game) => game.id === added.game.id)).toHaveLength(1);
  });

  test("candidate unavailability gates an otherwise valid Profile cache", async () => {
    const ctx = createTestApp();
    const baseline = await ctx.profileService.getProfile();
    expect(baseline.status).toBe("available");
    let computations = 0;
    const service = createProfileService({
      storageService: ctx.storageService,
      displayedFitnessService: {
        ...ctx.displayedFitnessService,
        listGamesFromSnapshot() {
          computations += 1;
          return Promise.resolve([]);
        },
      },
      attentionCandidates: {
        ensureFresh: () => Promise.resolve({ state: "unavailable", retryable: true }),
      },
    });
    const result = await service.getProfile();
    expect(result.status).toBe("unavailable");
    expect(computations).toBe(0);
  });

  test("startup candidate recovery failure is logged while independent app construction remains available", async () => {
    const messages: string[] = [];
    await recoverAttentionCandidatesOnStartup(
      { recover: async () => Promise.reject(new Error("recovery failed")) },
      {
        log: (message: string) => messages.push(message),
        error: (message: string) => messages.push(message),
      },
    );
    expect(messages).toEqual([
      "attention candidate recovery started",
      "attention candidate recovery failed",
    ]);
    const ctx = createTestApp();
    expect((await jsonRequest(ctx.app, "GET", "/api/config")).status).toBe(200);
  });

  test("analyst projections use the injected Profile service rather than constructing an ungated one", async () => {
    const ctx = createTestApp();
    let profileReads = 0;
    const projection = createAnalystProjectionSnapshotService({
      storageService: ctx.storageService,
      displayedFitnessService: ctx.displayedFitnessService,
      profileService: {
        getProfile: async () => {
          profileReads += 1;
          return ctx.profileService.getProfile();
        },
      },
    });
    await projection.capture();
    expect(profileReads).toBe(1);
  });
});
