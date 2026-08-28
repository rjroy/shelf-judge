import { describe, expect, test } from "bun:test";
import {
  IntentionMutationResultSchema,
  type AddGameResult,
  type IntentionMutationResult,
} from "@shelf-judge/shared";
import * as path from "node:path";
import { parseThingItems } from "../../src/services/bgg-xml-parser.js";
import type { BggGameResult } from "../../src/services/bgg-client.js";
import type { IntentionService } from "../../src/services/intention-service.js";
import { createMockBggClient, createTestApp, jsonRequest } from "../helpers/test-app.js";

const createCommandId = "20000000-0000-4000-8000-000000000001";
const resolveCommandId = "20000000-0000-4000-8000-000000000002";

describe("game intention and play routes", () => {
  test("registers exactly the four Step 6 operations with request, response, and errors", async () => {
    const context = createTestApp();
    const operations = context.operations.filter(({ operationId }) =>
      [
        "shelf.game.intention.set",
        "shelf.game.intention.complete",
        "shelf.game.intention.retire",
        "shelf.game.plays.set",
      ].includes(operationId),
    );
    expect(operations.map(({ operationId }) => operationId).sort()).toEqual([
      "shelf.game.intention.complete",
      "shelf.game.intention.retire",
      "shelf.game.intention.set",
      "shelf.game.plays.set",
    ]);
    for (const operation of operations) {
      expect(operation.requestSchema).toBeDefined();
      expect(operation.request).toBeDefined();
      expect(operation.response).toBeDefined();
      expect(operation.errors?.length).toBeGreaterThan(0);
    }
    expect(
      Object.fromEntries(
        operations.map(({ operationId, idempotent }) => [operationId, idempotent]),
      ),
    ).toEqual({
      "shelf.game.intention.set": true,
      "shelf.game.intention.complete": true,
      "shelf.game.intention.retire": true,
      "shelf.game.plays.set": false,
    });
    for (const operation of operations.filter(({ operationId }) =>
      operationId.startsWith("shelf.game.intention."),
    )) {
      expect(operation.response).toEqual({
        body: { oneOf: ["accepted-intention-mutation", "intention-mutation-error"] },
      });
      const expectedCodes =
        operation.operationId === "shelf.game.intention.set"
          ? [
              "validation",
              "game-not-found",
              "ineligible-game",
              "active-intention-conflict",
              "command-reuse",
              "persistence-failure",
            ]
          : [
              "validation",
              "game-not-found",
              "intention-not-found",
              "stale-version",
              "command-reuse",
              "persistence-failure",
            ];
      expect(operation.errors?.map(({ code }) => code)).toEqual(expectedCodes);
      for (const error of operation.errors ?? []) {
        expect(
          IntentionMutationResultSchema.safeParse(error.response).success,
          `${operation.operationId}:${error.code}`,
        ).toBe(true);
      }
    }
    const playsOperation = operations.find(
      ({ operationId }) => operationId === "shelf.game.plays.set",
    );
    expect(playsOperation?.request).toMatchObject({
      body: { additionalProperties: false, required: ["playCount"] },
    });
    expect(playsOperation?.response).toMatchObject({
      body: {
        oneOf: ["accepted-manual-play-correction", "manual-play-correction-conflict"],
      },
    });
    expect(playsOperation?.errors?.map(({ code }) => code)).toEqual([
      "validation",
      "game_not_found",
      "non-monotonic-observation",
      "persistence-failure",
    ]);
    const help = (await (await jsonRequest(context.app, "GET", "/api/help/game")).json()) as {
      children: { game: { children: Record<string, unknown> } };
    };
    expect(help.children.game.children).toHaveProperty("intention");
    expect(help.children.game.children).toHaveProperty("plays");
    expect(help.children.game.children.plays).toMatchObject({
      children: { set: { operationId: "shelf.game.plays.set", idempotent: false } },
    });
  });

  test("rejects null-time valid evidence through the service and reconstructed route", async () => {
    const original = createTestApp();
    const add = (await (
      await jsonRequest(original.app, "POST", "/api/games", { name: "Migrated Null Time" })
    ).json()) as AddGameResult;
    const source = await original.storageService.loadCollection();
    const sourceGame = source.games.find(({ id }) => id === add.game.id);
    if (sourceGame === undefined) throw new Error("Expected persisted game");
    sourceGame.numPlays = 0;
    sourceGame.playCountEvidence = {
      status: "valid",
      value: 0,
      source: "manual",
      observedAt: null,
    };
    await original.storageService.saveCollection(source);
    const restarted = createTestApp({ fileOps: original.fileOps });
    const before = await restarted.storageService.loadCollection();

    const response = await jsonRequest(
      restarted.app,
      "POST",
      `/api/games/${add.game.id}/intention`,
      {
        commandId: createCommandId,
        kind: "first-play",
        expectedActiveIntention: "absent",
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      commandId: createCommandId,
      error: {
        code: "ineligible-game",
        gameId: add.game.id,
        reason: "missing-observation-time",
      },
    });
    expect(await restarted.storageService.loadCollection()).toEqual(before);
  });

  test.each([
    [
      "create",
      "/api/games/game-1/intention",
      { commandId: createCommandId, kind: "first-play", expectedActiveIntention: "absent" },
    ],
    [
      "complete",
      "/api/games/game-1/intention/intention-1/complete",
      { commandId: resolveCommandId, expectedVersion: 1 },
    ],
    [
      "retire",
      "/api/games/game-1/intention/intention-1/retire",
      { commandId: resolveCommandId, expectedVersion: 1 },
    ],
  ])(
    "returns 500 when the %s service result violates the shared contract",
    async (_label, path, body) => {
      const malformedService = {
        execute: () => Promise.resolve({ ok: true }),
        setPlayCount: () => Promise.reject(new Error("not used")),
      } as unknown as IntentionService;
      const response = await jsonRequest(
        createTestApp({ intentionService: malformedService }).app,
        "POST",
        path,
        body,
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Internal server error",
        code: "internal_error",
      });
    },
  );

  test("rejects route-owned command smuggling and receipts preserve route identity", async () => {
    const context = createTestApp();
    const first = (await (
      await jsonRequest(context.app, "POST", "/api/games", { name: "First", numPlays: 0 })
    ).json()) as AddGameResult;
    const second = (await (
      await jsonRequest(context.app, "POST", "/api/games", { name: "Second", numPlays: 0 })
    ).json()) as AddGameResult;

    for (const body of [
      {
        commandId: createCommandId,
        kind: "first-play",
        expectedActiveIntention: "absent",
        gameId: second.game.id,
      },
      {
        commandId: createCommandId,
        kind: "first-play",
        expectedActiveIntention: "absent",
        type: "complete",
      },
    ]) {
      const response = await jsonRequest(
        context.app,
        "POST",
        `/api/games/${first.game.id}/intention`,
        body,
      );
      expect(response.status).toBe(400);
    }
    expect((await context.storageService.loadCollection()).commandReceipts).toEqual([]);

    const createdResponse = await jsonRequest(
      context.app,
      "POST",
      `/api/games/${first.game.id}/intention`,
      {
        commandId: createCommandId,
        kind: "first-play",
        expectedActiveIntention: "absent",
      },
    );
    const created = (await createdResponse.json()) as IntentionMutationResult;
    if (!created.ok) throw new Error(created.error.code);
    const smuggledResolution = await jsonRequest(
      context.app,
      "POST",
      `/api/games/${first.game.id}/intention/${created.intention.intentionId}/complete`,
      {
        commandId: resolveCommandId,
        expectedVersion: 1,
        gameId: second.game.id,
        intentionId: "other-intention",
        type: "retire",
      },
    );
    expect(smuggledResolution.status).toBe(400);

    const completed = await jsonRequest(
      context.app,
      "POST",
      `/api/games/${first.game.id}/intention/${created.intention.intentionId}/complete`,
      { commandId: resolveCommandId, expectedVersion: 1 },
    );
    expect(completed.status).toBe(200);
    const receipts = (await context.storageService.loadCollection()).commandReceipts;
    expect(receipts.map(({ request }) => request)).toEqual([
      {
        type: "create",
        commandId: createCommandId,
        gameId: first.game.id,
        kind: "first-play",
        expectedActiveIntention: "absent",
      },
      {
        type: "complete",
        commandId: resolveCommandId,
        gameId: first.game.id,
        intentionId: created.intention.intentionId,
        expectedVersion: 1,
      },
    ]);
  });

  test("real reads never mutate an active intention and reconstructed app retains history for a new baseline", async () => {
    let now = "2026-08-28T10:00:00.000Z";
    const original = createTestApp({ now: () => now });
    const add = (await (
      await jsonRequest(original.app, "POST", "/api/games", {
        name: "Durable Route Game",
        numPlays: 0,
      })
    ).json()) as AddGameResult;
    const created = (await (
      await jsonRequest(original.app, "POST", `/api/games/${add.game.id}/intention`, {
        commandId: createCommandId,
        kind: "first-play",
        expectedActiveIntention: "absent",
      })
    ).json()) as IntentionMutationResult;
    if (!created.ok) throw new Error(created.error.code);

    const collectionPath = "/test/data/collection.json";
    const durableBeforeReads = original.fileOps.files.get(collectionPath);
    const collectionWritesBeforeReads = original.fileOps.calls.filter(
      ({ method, args }) => method === "rename" && args[1] === collectionPath,
    ).length;
    now = "2126-08-28T10:00:00.000Z";
    expect((await jsonRequest(original.app, "GET", `/api/games/${add.game.id}`)).status).toBe(200);
    expect((await jsonRequest(original.app, "GET", "/api/games")).status).toBe(200);
    await original.gameService.getGame(add.game.id);
    await original.gameService.listGames();
    expect(original.fileOps.files.get(collectionPath)).toBe(durableBeforeReads);
    expect(
      original.fileOps.calls.filter(
        ({ method, args }) => method === "rename" && args[1] === collectionPath,
      ).length,
    ).toBe(collectionWritesBeforeReads);
    expect((await original.storageService.loadCollection()).intentions[0]?.resolution).toBeNull();

    const retired = (await (
      await jsonRequest(
        original.app,
        "POST",
        `/api/games/${add.game.id}/intention/${created.intention.intentionId}/retire`,
        { commandId: resolveCommandId, expectedVersion: 1 },
      )
    ).json()) as IntentionMutationResult;
    expect(retired).toMatchObject({
      ok: true,
      intention: { resolution: { outcome: "retired", source: "owner-retired" } },
    });
    if (!retired.ok) throw new Error(retired.error.code);
    expect(
      await (
        await jsonRequest(original.app, "PATCH", `/api/games/${add.game.id}/ownership`, {
          ownership: "previously-owned",
        })
      ).json(),
    ).toMatchObject({ linkedIntentionTransition: null });

    original.fileOps.files.set("/test/data/profile.json", "disposable cache");
    await original.fileOps.unlink("/test/data/profile.json");
    now = "2126-08-28T10:00:01.000Z";
    const restarted = createTestApp({ fileOps: original.fileOps, now: () => now });
    const reconstructed = await restarted.storageService.loadCollection();
    expect(reconstructed.intentions).toEqual([retired.intention]);
    expect(reconstructed.commandReceipts).toHaveLength(2);

    expect(
      await (
        await jsonRequest(restarted.app, "PATCH", `/api/games/${add.game.id}/ownership`, {
          ownership: "owned",
        })
      ).json(),
    ).toMatchObject({ linkedIntentionTransition: null });
    now = "2126-08-28T10:00:02.000Z";
    await jsonRequest(restarted.app, "PUT", `/api/games/${add.game.id}/plays`, { playCount: 3 });
    const later = (await (
      await jsonRequest(restarted.app, "POST", `/api/games/${add.game.id}/intention`, {
        commandId: "20000000-0000-4000-8000-000000000003",
        kind: "replay",
        expectedActiveIntention: "absent",
      })
    ).json()) as IntentionMutationResult;
    if (!later.ok) throw new Error(later.error.code);
    expect(later.intention.intentionId).not.toBe(created.intention.intentionId);
    expect(later.intention.baseline).toMatchObject({ playCount: 3, evidenceSource: "manual" });
    expect((await restarted.storageService.loadCollection()).intentions).toHaveLength(2);
  });

  test.each(["active", "resolved"] as const)(
    "reconstructed route rejects deletion with %s history without changing the collection",
    async (state) => {
      const original = createTestApp();
      const add = (await (
        await jsonRequest(original.app, "POST", "/api/games", {
          name: `${state} deletion game`,
          numPlays: 0,
        })
      ).json()) as AddGameResult;
      const created = (await (
        await jsonRequest(original.app, "POST", `/api/games/${add.game.id}/intention`, {
          commandId: createCommandId,
          kind: "first-play",
          expectedActiveIntention: "absent",
        })
      ).json()) as IntentionMutationResult;
      if (!created.ok) throw new Error(created.error.code);
      if (state === "resolved") {
        await jsonRequest(
          original.app,
          "POST",
          `/api/games/${add.game.id}/intention/${created.intention.intentionId}/complete`,
          { commandId: resolveCommandId, expectedVersion: 1 },
        );
      }

      const restarted = createTestApp({ fileOps: original.fileOps });
      const before = await restarted.storageService.loadCollection();
      const response = await jsonRequest(restarted.app, "DELETE", `/api/games/${add.game.id}`);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        code: "history-conflict",
        gameId: add.game.id,
        intentionIds: [created.intention.intentionId],
      });
      expect(await restarted.storageService.loadCollection()).toEqual(before);
    },
  );

  test("route still permits deletion when the game has no intention history", async () => {
    const context = createTestApp();
    const add = (await (
      await jsonRequest(context.app, "POST", "/api/games", { name: "No History" })
    ).json()) as AddGameResult;
    expect((await jsonRequest(context.app, "DELETE", `/api/games/${add.game.id}`)).status).toBe(
      204,
    );
    expect((await context.storageService.loadCollection()).games).toEqual([]);
  });

  test("creates, manually completes, replays, and blocks deletion across app restart", async () => {
    const context = createTestApp();
    const add = (await (
      await jsonRequest(context.app, "POST", "/api/games", { name: "Route Game", numPlays: 0 })
    ).json()) as AddGameResult;
    const createBody = {
      commandId: createCommandId,
      kind: "first-play",
      expectedActiveIntention: "absent",
    };
    const createdResponse = await jsonRequest(
      context.app,
      "POST",
      `/api/games/${add.game.id}/intention`,
      createBody,
    );
    expect(createdResponse.status).toBe(200);
    const created = (await createdResponse.json()) as IntentionMutationResult;
    if (!created.ok) throw new Error(created.error.code);

    const completedResponse = await jsonRequest(
      context.app,
      "POST",
      `/api/games/${add.game.id}/intention/${created.intention.intentionId}/complete`,
      { commandId: resolveCommandId, expectedVersion: 1 },
    );
    expect(completedResponse.status).toBe(200);
    const completed = (await completedResponse.json()) as IntentionMutationResult;
    expect(completed).toMatchObject({
      ok: true,
      intention: { resolution: { source: "owner-confirmed" } },
    });

    const replay = await jsonRequest(
      context.app,
      "POST",
      `/api/games/${add.game.id}/intention/${created.intention.intentionId}/complete`,
      { commandId: resolveCommandId, expectedVersion: 1 },
    );
    expect(await replay.json()).toEqual(completed);
    const deletion = await jsonRequest(context.app, "DELETE", `/api/games/${add.game.id}`);
    expect(deletion.status).toBe(409);
    expect(await deletion.json()).toEqual({
      code: "history-conflict",
      gameId: add.game.id,
      intentionIds: [created.intention.intentionId],
    });
    expect((await context.storageService.loadCollection()).games).toHaveLength(1);
  });

  test("manual plays route validates safe counts and returns automatic transition", async () => {
    const context = createTestApp();
    const add = (await (
      await jsonRequest(context.app, "POST", "/api/games", { name: "Play Game", numPlays: 0 })
    ).json()) as AddGameResult;
    await jsonRequest(context.app, "POST", `/api/games/${add.game.id}/intention`, {
      commandId: createCommandId,
      kind: "first-play",
      expectedActiveIntention: "absent",
    });
    expect(
      (
        await jsonRequest(context.app, "PUT", `/api/games/${add.game.id}/plays`, {
          playCount: -1,
        })
      ).status,
    ).toBe(400);
    const response = await jsonRequest(context.app, "PUT", `/api/games/${add.game.id}/plays`, {
      playCount: 1,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      game: { playCountEvidence: { status: "valid", value: 1, source: "manual" } },
      linkedIntentionTransition: {
        resolution: { outcome: "completed", source: "observed-play-increase" },
      },
    });
  });

  test("manual plays route rejects an equal daemon clock without writing across restart", async () => {
    const now = "2026-08-28T10:00:00.000Z";
    const original = createTestApp({ now: () => now });
    const add = (await (
      await jsonRequest(original.app, "POST", "/api/games", {
        name: "Clock Conflict",
        numPlays: 0,
      })
    ).json()) as AddGameResult;
    const before = await original.storageService.loadCollection();

    for (const context of [
      original,
      createTestApp({ fileOps: original.fileOps, now: () => now }),
    ]) {
      const response = await jsonRequest(context.app, "PUT", `/api/games/${add.game.id}/plays`, {
        playCount: 1,
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        ok: false,
        error: {
          code: "non-monotonic-observation",
          gameId: add.game.id,
          attemptedObservedAt: now,
          latestAcceptedAt: now,
        },
      });
      expect(await context.storageService.loadCollection()).toEqual(before);
    }
  });

  test("single BGG refresh route returns its validated automatic intention transition", async () => {
    const xml = await Bun.file(
      path.join(import.meta.dir, "../fixtures/thing-wingspan-266192.xml"),
    ).text();
    const parsed = parseThingItems(xml, "2026-08-28T10:00:00.000Z")[0];
    if (parsed === undefined) throw new Error("Expected BGG fixture");
    const baseline: BggGameResult = {
      ...structuredClone(parsed),
      collectionData: {
        numPlays: 1,
        observation: {
          sourceRequest: "bgg-collection",
          observedAt: "2026-08-28T10:05:00.000Z",
          state: "complete",
          fieldsReturned: ["numPlays"],
        },
      },
    };
    const increased: BggGameResult = {
      ...structuredClone(baseline),
      collectionData: {
        numPlays: 2,
        observation: {
          sourceRequest: "bgg-collection",
          observedAt: "2026-08-28T11:05:00.000Z",
          state: "complete",
          fieldsReturned: ["numPlays"],
        },
      },
    };
    const queued = [baseline, increased];
    const context = createTestApp({
      now: () => "2026-08-28T12:00:00.000Z",
      bggClient: createMockBggClient({
        getGame: () => {
          const result = queued.shift();
          return result === undefined
            ? Promise.reject(new Error("No queued BGG result"))
            : Promise.resolve(result);
        },
      }),
    });
    const add = (await (
      await jsonRequest(context.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      })
    ).json()) as AddGameResult;
    await jsonRequest(context.app, "POST", `/api/games/${add.game.id}/intention`, {
      commandId: createCommandId,
      kind: "replay",
      expectedActiveIntention: "absent",
    });

    const response = await jsonRequest(context.app, "POST", `/api/games/${add.game.id}/refresh`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      game: { id: add.game.id, playCountEvidence: { status: "valid", value: 2 } },
      linkedIntentionTransition: {
        gameId: add.game.id,
        resolution: { outcome: "completed", source: "observed-play-increase" },
      },
    });
  });

  test("newer manual correction supersedes retained valid BGG evidence across restart", async () => {
    const xml = await Bun.file(
      path.join(import.meta.dir, "../fixtures/thing-wingspan-266192.xml"),
    ).text();
    const parsed = parseThingItems(xml, "2026-08-28T10:00:00.000Z")[0];
    if (parsed === undefined) throw new Error("Expected BGG fixture");
    const bgg: BggGameResult = {
      ...structuredClone(parsed),
      collectionData: {
        numPlays: 4,
        observation: {
          sourceRequest: "bgg-collection",
          observedAt: "2026-08-28T10:05:00.000Z",
          state: "complete",
          fieldsReturned: ["numPlays"],
        },
      },
    };
    let now = "2026-08-28T11:00:00.000Z";
    const original = createTestApp({
      now: () => now,
      bggClient: createMockBggClient({ getGame: () => Promise.resolve(bgg) }),
    });
    const add = (await (
      await jsonRequest(original.app, "POST", "/api/games", {
        name: "Wingspan",
        bggId: 266192,
      })
    ).json()) as AddGameResult;
    await jsonRequest(original.app, "POST", `/api/games/${add.game.id}/intention`, {
      commandId: createCommandId,
      kind: "replay",
      expectedActiveIntention: "absent",
    });

    now = "2026-08-28T12:00:00.000Z";
    const correction = await jsonRequest(original.app, "PUT", `/api/games/${add.game.id}/plays`, {
      playCount: 3,
    });
    expect(await correction.json()).toMatchObject({
      game: {
        playCountEvidence: { status: "valid", value: 3, source: "manual", observedAt: now },
        latestPlayCountCheck: { status: "valid", value: 4, observedAt: "2026-08-28T10:05:00.000Z" },
      },
      linkedIntentionTransition: null,
    });

    now = "2026-08-28T13:00:00.000Z";
    const restarted = createTestApp({ fileOps: original.fileOps, now: () => now });
    const completion = await jsonRequest(restarted.app, "PUT", `/api/games/${add.game.id}/plays`, {
      playCount: 5,
    });
    expect(await completion.json()).toMatchObject({
      game: {
        playCountEvidence: { status: "valid", value: 5, source: "manual", observedAt: now },
        latestPlayCountCheck: { status: "valid", value: 4, observedAt: "2026-08-28T10:05:00.000Z" },
      },
      linkedIntentionTransition: {
        resolution: { outcome: "completed", source: "observed-play-increase" },
      },
    });
    expect(
      (await restarted.storageService.loadCollection()).intentions[0]?.resolution,
    ).toMatchObject({ outcome: "completed" });
  });

  test("ownership transition atomically retires active intent and re-owning creates none", async () => {
    const context = createTestApp();
    const add = (await (
      await jsonRequest(context.app, "POST", "/api/games", { name: "Owned Game", numPlays: 1 })
    ).json()) as AddGameResult;
    await jsonRequest(context.app, "POST", `/api/games/${add.game.id}/intention`, {
      commandId: createCommandId,
      kind: "replay",
      expectedActiveIntention: "absent",
    });
    const relinquished = await jsonRequest(
      context.app,
      "PATCH",
      `/api/games/${add.game.id}/ownership`,
      { ownership: "previously-owned" },
    );
    expect(await relinquished.json()).toMatchObject({
      game: { ownership: "previously-owned" },
      linkedIntentionTransition: {
        version: 2,
        resolution: { outcome: "retired", source: "owner-retired" },
      },
    });
    const reacquired = await jsonRequest(
      context.app,
      "PATCH",
      `/api/games/${add.game.id}/ownership`,
      { ownership: "owned" },
    );
    expect(await reacquired.json()).toMatchObject({
      game: { ownership: "owned" },
      linkedIntentionTransition: null,
    });
    const source = await context.storageService.loadCollection();
    expect(source.intentions).toHaveLength(1);
    expect(source.intentions[0]?.resolution?.outcome).toBe("retired");
  });

  test("play and ownership race resolves the active intention exactly once", async () => {
    const context = createTestApp();
    const add = (await (
      await jsonRequest(context.app, "POST", "/api/games", { name: "Race Game", numPlays: 0 })
    ).json()) as AddGameResult;
    await jsonRequest(context.app, "POST", `/api/games/${add.game.id}/intention`, {
      commandId: createCommandId,
      kind: "first-play",
      expectedActiveIntention: "absent",
    });
    await Promise.all([
      jsonRequest(context.app, "PUT", `/api/games/${add.game.id}/plays`, { playCount: 1 }),
      jsonRequest(context.app, "PATCH", `/api/games/${add.game.id}/ownership`, {
        ownership: "previously-owned",
      }),
    ]);
    const source = await context.storageService.loadCollection();
    expect(source.intentions).toHaveLength(1);
    expect(source.intentions[0]).toMatchObject({ version: 2 });
    expect(source.intentions[0]?.resolution).not.toBeNull();
  });

  test("complete, retire, play, and ownership race records exactly one lifecycle resolution", async () => {
    const context = createTestApp();
    const add = (await (
      await jsonRequest(context.app, "POST", "/api/games", { name: "Four-way Race", numPlays: 0 })
    ).json()) as AddGameResult;
    const created = (await (
      await jsonRequest(context.app, "POST", `/api/games/${add.game.id}/intention`, {
        commandId: createCommandId,
        kind: "first-play",
        expectedActiveIntention: "absent",
      })
    ).json()) as IntentionMutationResult;
    if (!created.ok) throw new Error(created.error.code);
    const responses = await Promise.all([
      jsonRequest(
        context.app,
        "POST",
        `/api/games/${add.game.id}/intention/${created.intention.intentionId}/complete`,
        { commandId: resolveCommandId, expectedVersion: 1 },
      ),
      jsonRequest(
        context.app,
        "POST",
        `/api/games/${add.game.id}/intention/${created.intention.intentionId}/retire`,
        { commandId: "20000000-0000-4000-8000-000000000003", expectedVersion: 1 },
      ),
      jsonRequest(context.app, "PUT", `/api/games/${add.game.id}/plays`, { playCount: 1 }),
      jsonRequest(context.app, "PATCH", `/api/games/${add.game.id}/ownership`, {
        ownership: "previously-owned",
      }),
    ]);
    expect(responses.every(({ status }) => status < 500)).toBe(true);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
      ok?: boolean;
      intention?: { resolution: unknown };
      linkedIntentionTransition?: unknown;
    }>;
    expect(
      bodies.filter(
        (body) =>
          (body.ok === true && body.intention?.resolution != null) ||
          body.linkedIntentionTransition != null,
      ),
    ).toHaveLength(1);
    const source = await context.storageService.loadCollection();
    expect(source.intentions).toHaveLength(1);
    expect(source.intentions[0]?.version).toBe(2);
    expect(source.intentions[0]?.resolution).not.toBeNull();
  });
});
