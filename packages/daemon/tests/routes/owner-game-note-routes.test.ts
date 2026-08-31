import { describe, expect, test } from "bun:test";
import {
  NotFoundError,
  OwnerGameNoteMutationResultSchema,
  OwnerGameNoteReadResultSchema,
  type AddGameResult,
  type OwnerGameNoteMutationResult,
} from "@shelf-judge/shared";
import type { OwnerGameNoteService } from "../../src/services/owner-game-note-service.js";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";

const commandIds = {
  set: "45000000-0000-4000-8000-000000000001",
  clear: "45000000-0000-4000-8000-000000000002",
  alreadyClear: "45000000-0000-4000-8000-000000000003",
};
const updatedAt = "2026-08-31T10:00:00.000Z";
const sentinel = "PRIVATE NOTE SENTINEL\nsecond line";
const internalError = { error: "Internal server error", code: "internal_error" };

function injectedService(overrides: Partial<OwnerGameNoteService>): OwnerGameNoteService {
  return {
    get: () => Promise.reject(new Error("Unexpected get call")),
    set: () => Promise.reject(new Error("Unexpected set call")),
    clear: () => Promise.reject(new Error("Unexpected clear call")),
    ...overrides,
  };
}

function accepted(
  operation: "set" | "clear",
  overrides: Partial<Extract<OwnerGameNoteMutationResult, { ok: true }>["accepted"]> = {},
): OwnerGameNoteMutationResult {
  return {
    ok: true,
    accepted: {
      commandId: commandIds[operation],
      gameId: "game-1",
      operation,
      state: operation === "set" ? "present" : "cleared",
      version: 1,
      updatedAt,
      collectionRevision: 1,
      replayed: false,
      alreadyClear: false,
      ...overrides,
    },
  };
}

function rejected(
  commandId: string,
  error: Extract<OwnerGameNoteMutationResult, { ok: false }>["error"],
): OwnerGameNoteMutationResult {
  return { ok: false, commandId, error };
}

describe("owner game note routes", () => {
  test("reads, sets, replays, clears, and records already-clear without text in mutations", async () => {
    let now = updatedAt;
    const context = createTestApp({ now: () => now });
    const add = (await (
      await jsonRequest(context.app, "POST", "/api/games", { name: "Note Route Game" })
    ).json()) as AddGameResult;
    const path = `/api/games/${add.game.id}/note`;

    const missingResponse = await jsonRequest(context.app, "GET", path);
    expect(missingResponse.status).toBe(200);
    expect(OwnerGameNoteReadResultSchema.parse(await missingResponse.json())).toEqual({
      gameId: add.game.id,
      note: { state: "missing", version: 0, updatedAt: null },
    });

    const setBody = { commandId: commandIds.set, expectedVersion: 0, text: sentinel };
    const setResponse = await jsonRequest(context.app, "PUT", path, setBody);
    expect(setResponse.status).toBe(200);
    const setResult = OwnerGameNoteMutationResultSchema.parse(await setResponse.json());
    expect(setResult).toMatchObject({
      ok: true,
      accepted: {
        commandId: commandIds.set,
        gameId: add.game.id,
        operation: "set",
        state: "present",
        version: 1,
        replayed: false,
        alreadyClear: false,
      },
    });
    expect(JSON.stringify(setResult)).not.toContain(sentinel);

    const replay = OwnerGameNoteMutationResultSchema.parse(
      await (await jsonRequest(context.app, "PUT", path, setBody)).json(),
    );
    expect(replay).toMatchObject({ ok: true, accepted: { replayed: true, version: 1 } });

    const stale = await jsonRequest(context.app, "PUT", path, {
      commandId: "45000000-0000-4000-8000-000000000004",
      expectedVersion: 0,
      text: "different draft",
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      ok: false,
      error: {
        code: "stale-version",
        gameId: add.game.id,
        expectedVersion: 0,
        current: { state: "present", version: 1, text: sentinel },
      },
    });

    now = "2026-08-31T10:01:00.000Z";
    const cleared = OwnerGameNoteMutationResultSchema.parse(
      await (
        await jsonRequest(context.app, "DELETE", path, {
          commandId: commandIds.clear,
          expectedVersion: 1,
        })
      ).json(),
    );
    expect(cleared).toMatchObject({
      ok: true,
      accepted: { operation: "clear", state: "cleared", version: 2, alreadyClear: false },
    });
    expect(JSON.stringify(cleared)).not.toContain(sentinel);

    now = "2026-08-31T10:02:00.000Z";
    const alreadyClear = OwnerGameNoteMutationResultSchema.parse(
      await (
        await jsonRequest(context.app, "DELETE", path, {
          commandId: commandIds.alreadyClear,
          expectedVersion: 2,
        })
      ).json(),
    );
    expect(alreadyClear).toMatchObject({
      ok: true,
      accepted: { state: "cleared", version: 2, alreadyClear: true, replayed: false },
    });
    const replayedAlreadyClear = OwnerGameNoteMutationResultSchema.parse(
      await (
        await jsonRequest(context.app, "DELETE", path, {
          commandId: commandIds.alreadyClear,
          expectedVersion: 2,
        })
      ).json(),
    );
    expect(replayedAlreadyClear).toMatchObject({
      ok: true,
      accepted: { alreadyClear: true, replayed: true, version: 2 },
    });
  });

  test("GET is side-effect free and returns the complete current note", async () => {
    const context = createTestApp({ now: () => updatedAt });
    const add = (await (
      await jsonRequest(context.app, "POST", "/api/games", { name: "Read Only" })
    ).json()) as AddGameResult;
    const path = `/api/games/${add.game.id}/note`;
    await jsonRequest(context.app, "PUT", path, {
      commandId: commandIds.set,
      expectedVersion: 0,
      text: sentinel,
    });
    const before = await context.storageService.loadCollection();
    const collectionPath = "/test/data/collection.json";
    const bytesBefore = context.fileOps.files.get(collectionPath);
    const writesBefore = context.fileOps.calls.filter(
      ({ method, args }) => method === "rename" && args[1] === collectionPath,
    ).length;

    const response = await jsonRequest(context.app, "GET", path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      gameId: add.game.id,
      note: { state: "present", version: 1, updatedAt, text: sentinel },
    });
    expect(await context.storageService.loadCollection()).toEqual(before);
    expect(context.fileOps.files.get(collectionPath)).toBe(bytesBefore);
    expect(
      context.fileOps.calls.filter(
        ({ method, args }) => method === "rename" && args[1] === collectionPath,
      ).length,
    ).toBe(writesBefore);
  });

  test("strict mutation bodies reject malformed JSON, route identity, and unknown fields", async () => {
    let calls = 0;
    const service = injectedService({
      set: () => {
        calls += 1;
        return Promise.resolve(accepted("set"));
      },
      clear: () => {
        calls += 1;
        return Promise.resolve(accepted("clear"));
      },
    });
    const app = createTestApp({ ownerGameNoteService: service }).app;
    const cases: Array<[string, unknown]> = [
      ["PUT", { commandId: commandIds.set, expectedVersion: 0, text: "valid", gameId: "other" }],
      ["PUT", { commandId: commandIds.set, expectedVersion: 0, text: "valid", extra: true }],
      ["DELETE", { commandId: commandIds.clear, expectedVersion: 0, gameId: "other" }],
      ["DELETE", { commandId: commandIds.clear, expectedVersion: 0, text: "not allowed" }],
    ];
    for (const [method, body] of cases) {
      const response = await jsonRequest(app, method, "/api/games/game-1/note", body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "validation" } });
    }
    const malformed = await app.request("http://localhost/api/games/game-1/note", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(calls).toBe(0);
  });

  test.each([
    [
      "validation",
      400,
      rejected(commandIds.set, {
        code: "validation",
        issues: [{ field: "text", message: "Invalid note text" }],
      }),
    ],
    ["game-not-found", 404, rejected(commandIds.set, { code: "game-not-found", gameId: "game-1" })],
    [
      "stale-version",
      409,
      rejected(commandIds.set, {
        code: "stale-version",
        gameId: "game-1",
        expectedVersion: 0,
        current: { state: "present", version: 1, updatedAt, text: sentinel },
      }),
    ],
    [
      "command-reuse",
      409,
      rejected(commandIds.set, { code: "command-reuse", commandId: commandIds.set }),
    ],
    ["note-overflow", 422, rejected(commandIds.set, { code: "version-overflow", target: "note" })],
    [
      "collection-overflow",
      422,
      rejected(commandIds.set, { code: "version-overflow", target: "collection" }),
    ],
    [
      "persistence-failure",
      500,
      rejected(commandIds.set, {
        code: "persistence-failure",
        operation: "shelf.game.note.set",
        message: "Owner game note mutation failed",
      }),
    ],
  ] as const)("maps the %s mutation result to HTTP %d", async (_label, status, result) => {
    const app = createTestApp({
      ownerGameNoteService: injectedService({
        set: () => Promise.resolve(structuredClone(result)),
      }),
    }).app;
    const response = await jsonRequest(app, "PUT", "/api/games/game-1/note", {
      commandId: commandIds.set,
      expectedVersion: 0,
      text: "valid",
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(result);
  });

  test("maps missing reads and rejects malformed or cross-game service output", async () => {
    const missing = createTestApp({
      ownerGameNoteService: injectedService({
        get: () => Promise.reject(new NotFoundError("Game not found: game-1")),
      }),
    }).app;
    const missingResponse = await jsonRequest(missing, "GET", "/api/games/game-1/note");
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({ code: "game-not-found", gameId: "game-1" });

    for (const value of [
      { gameId: "game-1", note: { state: "present", version: 1, updatedAt } },
      { gameId: "other-game", note: { state: "missing", version: 0, updatedAt: null } },
    ]) {
      const app = createTestApp({
        ownerGameNoteService: injectedService({ get: () => Promise.resolve(value as never) }),
      }).app;
      const response = await jsonRequest(app, "GET", "/api/games/game-1/note");
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual(internalError);
    }
  });

  test("rejects malformed and incoherent mutation service output", async () => {
    const outputs: unknown[] = [
      { ok: true },
      accepted("set", { version: 2 }),
      accepted("set", { gameId: "other-game" }),
      accepted("set", { commandId: "45000000-0000-4000-8000-000000000099" }),
      accepted("clear", { commandId: commandIds.set }),
      rejected(commandIds.set, { code: "game-not-found", gameId: "other-game" }),
      rejected(commandIds.set, {
        code: "stale-version",
        gameId: "game-1",
        expectedVersion: 2,
        current: { state: "present", version: 1, updatedAt, text: sentinel },
      }),
      rejected(commandIds.set, {
        code: "persistence-failure",
        operation: "shelf.game.note.clear",
        message: "failure",
      }),
    ];
    for (const output of outputs) {
      const app = createTestApp({
        ownerGameNoteService: injectedService({ set: () => Promise.resolve(output as never) }),
      }).app;
      const response = await jsonRequest(app, "PUT", "/api/games/game-1/note", {
        commandId: commandIds.set,
        expectedVersion: 0,
        text: "valid",
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual(internalError);
    }

    const incoherentAlreadyClear = createTestApp({
      ownerGameNoteService: injectedService({
        clear: () =>
          Promise.resolve(
            accepted("clear", {
              commandId: commandIds.clear,
              state: "cleared",
              version: 1,
              alreadyClear: true,
            }),
          ),
      }),
    }).app;
    const response = await jsonRequest(incoherentAlreadyClear, "DELETE", "/api/games/game-1/note", {
      commandId: commandIds.clear,
      expectedVersion: 0,
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(internalError);
  });
});

describe("owner game note operation discovery", () => {
  test("publishes stable strict operations, reachable errors, and no note prose", async () => {
    const context = createTestApp();
    const operations = context.operations.filter(({ operationId }) =>
      operationId.startsWith("shelf.game.note."),
    );
    expect(operations.map(({ operationId }) => operationId)).toEqual([
      "shelf.game.note.get",
      "shelf.game.note.set",
      "shelf.game.note.clear",
    ]);
    expect(operations.map(({ invocation }) => invocation)).toEqual([
      { method: "GET", path: "/api/games/:id/note" },
      { method: "PUT", path: "/api/games/:id/note" },
      { method: "DELETE", path: "/api/games/:id/note" },
    ]);
    expect(operations.every(({ idempotent }) => idempotent)).toBe(true);

    for (const operation of operations.slice(1)) {
      expect(operation.requestSchema).toBeDefined();
      expect(operation.request?.body).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(operation.response).toEqual({
        body: { oneOf: ["accepted-owner-game-note-metadata", "note-command-error"] },
      });
      expect(operation.errors?.map(({ status, code }) => [status, code])).toEqual([
        [400, "validation"],
        [404, "game-not-found"],
        [409, "stale-version"],
        [409, "command-reuse"],
        [422, "version-overflow"],
        [500, "persistence-failure"],
        [500, "internal_error"],
      ]);
      for (const error of operation.errors?.filter(({ code }) => code !== "internal_error") ?? []) {
        expect(OwnerGameNoteMutationResultSchema.safeParse(error.response).success).toBe(true);
      }
    }

    const helpResponse = await jsonRequest(context.app, "GET", "/api/help/game");
    const helpText = await helpResponse.text();
    expect(helpResponse.status).toBe(200);
    expect(helpText).not.toContain(sentinel);
    const help = JSON.parse(helpText) as {
      children: { game: { children: { note: { children: Record<string, unknown> } } } };
    };
    expect(Object.keys(help.children.game.children.note.children)).toEqual(["get", "set", "clear"]);
  });
});
