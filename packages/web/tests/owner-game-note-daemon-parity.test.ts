import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { NextRequest } from "next/server";
import { proxyToDaemon } from "@/app/api/daemon/[...path]/route";
import { daemonRequest } from "@/lib/daemon";
import { createFileOps } from "../../daemon/src/services/file-ops.js";
import type { GroundedAnalysisProvider } from "../../daemon/src/services/grounded-analysis/provider.js";
import { createMockBggClient, createTestApp } from "../../daemon/tests/helpers/test-app.js";

const fixturePath = path.join(
  import.meta.dir,
  "../../daemon/tests/fixtures/collection-schema-v5-owner-notes.json",
);
const gameId = "game-v5-prose";
const sentinel = "OWNER_NOTE_SENTINEL_current_only";

const commandIds = {
  set: "53000000-0000-4000-8000-000000000001",
  stale: "53000000-0000-4000-8000-000000000002",
  clear: "53000000-0000-4000-8000-000000000003",
} as const;

const servers = new Set<ReturnType<typeof Bun.serve>>();
const roots = new Set<string>();

afterEach(async () => {
  for (const server of servers) void server.stop(true);
  servers.clear();
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

async function requestThroughWebProxyPath(
  socketPath: string,
  daemonPath: string[],
  method: "DELETE" | "GET" | "PUT",
  body?: Record<string, unknown>,
): Promise<Response> {
  const request = new NextRequest(`http://web.local/api/daemon/${daemonPath.join("/")}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
  return proxyToDaemon(request, Promise.resolve({ path: daemonPath }), (daemonPath, options) =>
    daemonRequest(daemonPath, { ...options, socketPath }),
  );
}

function requestThroughWebProxy(
  socketPath: string,
  method: "DELETE" | "GET" | "PUT",
  body?: Record<string, unknown>,
): Promise<Response> {
  return requestThroughWebProxyPath(socketPath, ["games", gameId, "note"], method, body);
}

describe("owner-game-note web daemon parity", () => {
  test("proxies persisted v5 note states, accepted metadata, stale errors, and replay", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shelf-judge-web-note-parity-"));
    roots.add(root);
    const dataDir = path.join(root, "data");
    const socketPath = path.join(root, "daemon.sock");
    const fileOps = createFileOps();
    const bggRequests: unknown[] = [];
    const modelRequests: unknown[] = [];
    const groundedAnalysisProvider: GroundedAnalysisProvider = {
      configurationStatus: {
        status: "configured",
        identity: { providerId: "instrumented", modelId: "instrumented", extensionIds: [] },
      },
      analyze(request) {
        modelRequests.push(request);
        return Promise.reject(new Error("owner-note web flow must not invoke the model"));
      },
    };
    const bggClient = createMockBggClient({
      getGame(id) {
        void id;
        bggRequests.push({ operation: "getGame" });
        return Promise.reject(new Error("owner-note web flow must not invoke BGG"));
      },
      getGames(ids) {
        void ids;
        bggRequests.push({ operation: "getGames" });
        return Promise.reject(new Error("owner-note web flow must not invoke BGG"));
      },
      getPlayCount(bggId) {
        void bggId;
        bggRequests.push({ operation: "getPlayCount" });
        return Promise.reject(new Error("owner-note web flow must not invoke BGG"));
      },
      getUserCollection(username) {
        void username;
        bggRequests.push({ operation: "getUserCollection" });
        return Promise.reject(new Error("owner-note web flow must not invoke BGG"));
      },
      searchGames(query) {
        void query;
        bggRequests.push({ operation: "searchGames" });
        return Promise.reject(new Error("owner-note web flow must not invoke BGG"));
      },
    });
    await fileOps.mkdir(dataDir);
    await writeFile(
      path.join(dataDir, "collection.json"),
      await readFile(fixturePath, "utf8"),
      "utf8",
    );
    const context = createTestApp({
      bggClient,
      configPath: path.join(root, "config.json"),
      dataDir,
      fileOps,
      groundedAnalysisProvider,
    });
    await context.storageService.loadCollection();
    servers.add(Bun.serve({ unix: socketPath, fetch: context.app.fetch }));

    const missing = await requestThroughWebProxy(socketPath, "GET");
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({
      gameId,
      note: { state: "missing", version: 0, updatedAt: null },
    });
    const profileBeforeNote = await requestThroughWebProxyPath(socketPath, ["profile"], "GET");
    const profileBeforeNoteText = await profileBeforeNote.text();
    expect(profileBeforeNote.status).toBe(200);
    expect(profileBeforeNoteText).not.toContain(sentinel);

    const setBody = { commandId: commandIds.set, expectedVersion: 0, text: sentinel };
    const set = await requestThroughWebProxy(socketPath, "PUT", setBody);
    const setPayload = await set.text();
    expect(set.status).toBe(200);
    expect(setPayload).not.toContain(sentinel);
    expect(JSON.parse(setPayload)).toMatchObject({
      ok: true,
      accepted: {
        gameId,
        commandId: commandIds.set,
        state: "present",
        version: 1,
        replayed: false,
      },
    });

    const present = await requestThroughWebProxy(socketPath, "GET");
    expect(await present.json()).toMatchObject({
      gameId,
      note: { state: "present", version: 1, text: sentinel },
    });
    const profileAfterSet = await requestThroughWebProxyPath(socketPath, ["profile"], "GET");
    const profileAfterSetText = await profileAfterSet.text();
    expect(profileAfterSet.status).toBe(200);
    expect(profileAfterSetText).not.toContain(sentinel);

    const replay = await requestThroughWebProxy(socketPath, "PUT", setBody);
    expect(await replay.json()).toMatchObject({
      ok: true,
      accepted: {
        gameId,
        commandId: commandIds.set,
        state: "present",
        version: 1,
        replayed: true,
      },
    });

    const stale = await requestThroughWebProxy(socketPath, "PUT", {
      commandId: commandIds.stale,
      expectedVersion: 0,
      text: "stale web draft",
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      ok: false,
      error: { code: "stale-version", current: { text: sentinel, version: 1 } },
    });

    const cleared = await requestThroughWebProxy(socketPath, "DELETE", {
      commandId: commandIds.clear,
      expectedVersion: 1,
    });
    const clearPayload = await cleared.text();
    expect(cleared.status).toBe(200);
    expect(clearPayload).not.toContain(sentinel);
    expect(JSON.parse(clearPayload)).toMatchObject({
      ok: true,
      accepted: { commandId: commandIds.clear, state: "cleared", version: 2, replayed: false },
    });

    const clearedRead = await requestThroughWebProxy(socketPath, "GET");
    const clearedReadPayload: unknown = await clearedRead.json();
    expect(clearedReadPayload).toMatchObject({
      gameId,
      note: { state: "cleared", version: 2 },
    });
    expect(clearedReadPayload).not.toHaveProperty("note.text");
    const profileAfterClear = await requestThroughWebProxyPath(socketPath, ["profile"], "GET");
    const profileAfterClearText = await profileAfterClear.text();
    expect(profileAfterClear.status).toBe(200);
    expect(profileAfterClearText).not.toContain(sentinel);

    await Bun.sleep(25);
    expect(bggRequests).toEqual([]);
    expect(modelRequests).toEqual([]);
    expect(JSON.stringify({ bggRequests, modelRequests })).not.toContain(sentinel);
  }, 15_000);
});
