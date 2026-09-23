import { describe, expect, test } from "bun:test";
import { createProfileAttentionRoutes } from "../../src/routes/profile-attention.js";
import {
  createAttentionCandidateOracle,
  createAttentionCandidateProductionSourceLoader,
} from "../../src/services/attention-candidate-service.js";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";
import {
  canonicalUtilizationCases,
  UTILIZATION_OBSERVED_AT,
} from "../../../../test-fixtures/purchase-utilization-responses.js";
import { createInitialEntityMetadata, type DurableGame } from "@shelf-judge/shared";

const command = {
  commandId: "11111111-1111-4111-8111-111111111111",
  gameId: "22222222-2222-4222-8222-222222222222",
  ruleId: "underused-purchase",
  ruleVersion: 1,
  fingerprint: "a".repeat(64),
  expectedVersion: 0,
};

describe("profile attention routes", () => {
  test.each([
    ["not-now", "33333333-3333-4333-8333-333333333333"],
    ["intentional", "44444444-4444-4444-8444-444444444444"],
  ] as const)(
    "accepts %s through production-equivalent app wiring exactly once",
    async (operation, commandId) => {
      let now = "2026-01-01T00:00:00.000Z";
      const context = createTestApp({ now: () => now });
      const fixture = canonicalUtilizationCases.find(
        (candidate) => candidate.id === "canonical-20",
      );
      if (fixture === undefined) throw new Error("Missing underused-purchase fixture");
      const game: DurableGame = {
        id: "a0000000-0000-4000-8000-000000000020",
        bggId: null,
        entityMetadata: createInitialEntityMetadata(null),
        latestPlayCountCheck: null,
        name: `Route ${operation}`,
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
      };
      await context.storageService.saveCollection({
        schemaVersion: 8,
        revision: 0,
        id: "route-underused-fixture",
        name: "Route underused fixture",
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
      const winner = (
        await createAttentionCandidateOracle(context.displayedFitnessService).evaluate(
          await source(),
          now,
          [game.id],
        )
      ).evaluations.find((candidate) => candidate.gameId === game.id)?.winner;
      if (winner === undefined || winner === null) throw new Error("Expected route candidate");

      let maintenanceCalls = 0;
      const maintain = context.attentionCandidateService.maintainAfterCollectionCommit.bind(
        context.attentionCandidateService,
      );
      context.attentionCandidateService.maintainAfterCollectionCommit = async (impact) => {
        maintenanceCalls += 1;
        return maintain(impact);
      };
      const beforeCommand = await context.storageService.loadCollection();
      const response = await jsonRequest(
        context.app,
        "POST",
        `/api/profile/attention/${operation}`,
        {
          operation,
          commandId,
          gameId: game.id,
          ruleId: winner.ruleId,
          ruleVersion: winner.ruleVersion,
          fingerprint: winner.fingerprint,
          expectedVersion: 0,
        },
      );
      const body: unknown = await response.json();
      const collection = await context.storageService.loadCollection();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ outcome: "accepted", receipt: { operation } });
      expect(maintenanceCalls).toBe(1);
      expect(collection.attentionDispositions).toHaveLength(1);
      expect(collection.commandReceipts).toHaveLength(1);
      expect({
        ...collection,
        attentionDispositions: beforeCommand.attentionDispositions,
        commandReceipts: beforeCommand.commandReceipts,
        revision: beforeCommand.revision,
        updatedAt: beforeCommand.updatedAt,
      }).toEqual(beforeCommand);
      if (operation === "not-now") {
        expect(collection.attentionDispositions[0]).toMatchObject({
          kind: "snoozed",
          expiresAt: "2026-01-31T00:00:00.000Z",
        });
      } else {
        expect(collection.attentionDispositions[0]).toMatchObject({
          kind: "intentional",
          fingerprint: winner.fingerprint,
        });
      }

      const replacementOperations =
        operation === "not-now"
          ? (["not-now", "intentional"] as const)
          : (["intentional"] as const);
      for (const replacement of replacementOperations) {
        const beforeReplacement = await context.storageService.loadCollection();
        const rejected = await jsonRequest(
          context.app,
          "POST",
          `/api/profile/attention/${replacement}`,
          {
            operation: replacement,
            commandId:
              replacement === "not-now"
                ? "55555555-5555-4555-8555-555555555555"
                : "66666666-6666-4666-8666-666666666666",
            gameId: game.id,
            ruleId: winner.ruleId,
            ruleVersion: winner.ruleVersion,
            fingerprint: winner.fingerprint,
            expectedVersion: 1,
          },
        );
        expect(rejected.status).toBe(409);
        expect(await rejected.json()).toEqual({
          outcome: "rejected",
          error: { code: "candidate-mismatch", gameId: game.id },
        });
        expect(await context.storageService.loadCollection()).toEqual(beforeReplacement);
        expect(maintenanceCalls).toBe(1);
      }

      if (operation === "not-now") {
        now = "2026-01-31T00:00:00.000Z";
        const expiredSnoozeResponse = await jsonRequest(
          context.app,
          "POST",
          "/api/profile/attention/not-now",
          {
            operation: "not-now",
            commandId: "77777777-7777-4777-8777-777777777777",
            gameId: game.id,
            ruleId: winner.ruleId,
            ruleVersion: winner.ruleVersion,
            fingerprint: winner.fingerprint,
            expectedVersion: 1,
          },
        );
        expect(expiredSnoozeResponse.status).toBe(200);
        expect(await expiredSnoozeResponse.json()).toMatchObject({
          outcome: "accepted",
          receipt: { accepted: { version: 2 } },
        });
        expect(maintenanceCalls).toBe(2);
      }
    },
  );

  test("uses the strict route operation and exposes accepted responses", async () => {
    const received: unknown[] = [];
    const { routes, operations } = createProfileAttentionRoutes({
      attentionDispositionService: {
        execute(input) {
          received.push(input);
          return Promise.resolve({
            outcome: "accepted",
            receipt: {
              receiptType: "attention-disposition",
              ...command,
              operation: "not-now",
              requestFingerprint: "b".repeat(64),
              requestPayload: { ...command, operation: "not-now" },
              accepted: {
                gameId: command.gameId,
                kind: "snoozed",
                ruleId: command.ruleId,
                ruleVersion: 1,
                fingerprint: command.fingerprint,
                responseAt: "2026-01-01T00:00:00.000Z",
                expiresAt: "2026-01-31T00:00:00.000Z",
                version: 1,
              },
            },
          });
        },
      },
    });
    const response = await routes.request("/profile/attention/not-now", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...command, operation: "not-now" }),
    });

    expect(response.status).toBe(200);
    expect(received).toEqual([{ ...command, operation: "not-now" }]);
    expect(operations.map((operation) => operation.operationId)).toEqual([
      "shelf.profile.attention.not-now",
      "shelf.profile.attention.intentional",
    ]);
  });

  test("rejects malformed and cross-route payloads before invoking the service", async () => {
    let calls = 0;
    const { routes } = createProfileAttentionRoutes({
      attentionDispositionService: {
        execute() {
          calls += 1;
          return Promise.resolve({ outcome: "rejected", error: { code: "validation" } });
        },
      },
    });
    for (const body of [{ ...command, operation: "intentional" }, { ...command }]) {
      const response = await routes.request("/profile/attention/not-now", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ outcome: "rejected", error: { code: "validation" } });
    }
    expect(calls).toBe(0);
  });

  test.each([
    ["game-not-found", 404],
    ["ineligible-game", 422],
    ["stale-version", 409],
    ["candidate-mismatch", 409],
    ["command-reuse", 409],
    ["persistence-failure", 503],
  ] as const)("maps %s to HTTP %i without rewriting its structured error", async (code, status) => {
    const error =
      code === "game-not-found" || code === "ineligible-game" || code === "candidate-mismatch"
        ? { code, gameId: command.gameId }
        : code === "stale-version"
          ? { code, gameId: command.gameId, expectedVersion: 0 }
          : code === "command-reuse"
            ? { code, commandId: command.commandId }
            : { code };
    const { routes } = createProfileAttentionRoutes({
      attentionDispositionService: {
        execute: () => Promise.resolve({ outcome: "rejected", error }),
      },
    });
    const response = await routes.request("/profile/attention/not-now", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...command, operation: "not-now" }),
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ outcome: "rejected", error });
  });
});
