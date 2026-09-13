import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { createFileOps } from "../../src/services/file-ops.js";
import { GameHistoryConflictError } from "../../src/services/game-service.js";
import type { GroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
import { createMockBggClient, createTestApp, jsonRequest } from "../helpers/test-app.js";
import type { BggGameResult } from "../../src/services/bgg-client.js";

const fixturePath = path.join(import.meta.dir, "../fixtures/collection-schema-v5-owner-notes.json");
const bggGameId = "game-v5-prose";
const sentinel = "OWNER_NOTE_SENTINEL_current_only";
const superseded = "OWNER_NOTE_SUPERSEDED_never_retained";

const commandIds = {
  bggFirst: "51000000-0000-4000-8000-000000000001",
  bggEqual: "51000000-0000-4000-8000-000000000002",
  bggLost: "51000000-0000-4000-8000-000000000003",
  bggClear: "51000000-0000-4000-8000-000000000004",
  bggReauthor: "51000000-0000-4000-8000-000000000005",
  manual: "51000000-0000-4000-8000-000000000006",
  route: "51000000-0000-4000-8000-000000000008",
} as const;

function accepted<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected accepted note command");
  return result as Extract<T, { ok: true }>;
}

async function runCli(
  args: string[],
  socketPath: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["packages/cli/src/index.ts", ...args], {
    cwd: path.resolve(import.meta.dir, "../../../.."),
    env: { ...process.env, SHELF_JUDGE_SOCKET: socketPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = await Promise.all([readOutput(child.stdout), readOutput(child.stderr)]);
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  return { exitCode, stdout: output[0], stderr: output[1] };
}

async function readOutput(stream: Readable | null): Promise<string> {
  if (stream === null) return "";
  let output = "";
  for await (const chunk of stream) output += String(chunk);
  return output;
}

describe("owner-note persisted flow", () => {
  test("migrates a real v5 collection and preserves note lifecycle, privacy, and deletion invariants", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shelf-judge-owner-note-flow-"));
    const dataDir = path.join(root, "data");
    const configPath = path.join(root, "config.json");
    const collectionPath = path.join(dataDir, "collection.json");
    const fileOps = createFileOps();
    let bggCalls = 0;
    let successfulBggResult: BggGameResult | null = null;
    const bggClient = createMockBggClient({
      getGame: () => {
        bggCalls += 1;
        if (successfulBggResult !== null) return Promise.resolve(successfulBggResult);
        return Promise.reject(new Error("BGG must not be used by owner-note commands"));
      },
      getUserCollection: () =>
        Promise.resolve([
          { bggId: 123, name: "Refreshed BGG fixture", yearPublished: 2026, numplays: 0 },
        ]),
      getPlayCount: () =>
        Promise.resolve({
          numPlays: 0,
          observation: {
            sourceRequest: "bgg-plays",
            observedAt: "2026-09-05T13:00:00.000Z",
            state: "complete",
            fieldsReturned: ["numPlays"],
          },
        }),
    });
    let tick = 0;
    const now = () => `2026-09-05T12:00:${String(tick++).padStart(2, "0")}.000Z`;

    try {
      await fileOps.mkdir(dataDir);
      await writeFile(collectionPath, await readFile(fixturePath, "utf8"), "utf8");
      const first = createTestApp({ bggClient, configPath, dataDir, fileOps, now });
      const migrated = await first.storageService.loadCollection();
      const migratedBgg = migrated.games.find(({ id }) => id === bggGameId);
      expect(migrated.schemaVersion).toBe(6);
      expect(migratedBgg?.ownerNote).toEqual({ state: "missing", version: 0, updatedAt: null });
      expect(JSON.stringify(migratedBgg?.ownerNote)).not.toContain("description");
      if (migratedBgg?.bggData === null || migratedBgg === undefined)
        throw new Error("Expected BGG-linked fixture game with BGG data");
      successfulBggResult = {
        metadata: {
          bggId: 123,
          name: "Refreshed BGG fixture",
          yearPublished: 2026,
          minPlayers: 2,
          maxPlayers: 4,
          playingTime: 60,
          imageUrl: "https://example.test/refreshed.jpg",
          thumbnailUrl: "https://example.test/refreshed-thumb.jpg",
        },
        bggData: migratedBgg.bggData,
        metadataObservation: {
          sourceRequest: "bgg-thing",
          observedAt: "2026-09-05T13:00:00.000Z",
          state: "complete",
          fieldsReturned: ["playingTime"],
        },
        playerRangeObservation: {
          sourceRequest: "bgg-thing",
          observedAt: "2026-09-05T13:00:00.000Z",
          state: "complete",
          fieldsReturned: ["minPlayers", "maxPlayers"],
        },
        entityMetadata: migratedBgg.entityMetadata,
      };

      const firstSet = accepted(
        await first.ownerGameNoteService.set(bggGameId, {
          commandId: commandIds.bggFirst,
          expectedVersion: 0,
          text: `${sentinel}\r\nfirst line`,
        }),
      );
      const equalSet = accepted(
        await first.ownerGameNoteService.set(bggGameId, {
          commandId: commandIds.bggEqual,
          expectedVersion: 1,
          text: `${sentinel}\nfirst line`,
        }),
      );
      expect([firstSet.accepted.version, equalSet.accepted.version]).toEqual([1, 2]);

      const manual = (await first.gameService.addGame({ name: "Manual note fixture" })).game;
      accepted(
        await first.ownerGameNoteService.set(manual.id, {
          commandId: commandIds.manual,
          expectedVersion: 0,
          text: "manual note",
        }),
      );
      const manualBeforeUnrelatedChanges = structuredClone(
        (await first.storageService.loadCollection()).games.find(({ id }) => id === manual.id)
          ?.ownerNote,
      );
      await first.gameService.rateGame(manual.id, {});
      await first.gameService.setOwnership(manual.id, "previously-owned");
      await first.gameService.setOwnership(manual.id, "owned");
      expect(
        (await first.storageService.loadCollection()).games.find(({ id }) => id === manual.id)
          ?.ownerNote,
      ).toEqual(manualBeforeUnrelatedChanges);
      const profileBeforeNote = await first.profileService.getProfile();
      const profileCacheBeforeNote = await first.storageService.loadProfile();
      if (profileCacheBeforeNote === null)
        throw new Error("Expected profile cache before note mutation");

      const lostRequest = {
        commandId: commandIds.bggLost,
        expectedVersion: 2,
        text: superseded,
      };
      const lostAcceptance = accepted(await first.ownerGameNoteService.set(bggGameId, lostRequest));
      const durableAfterLostAcceptance = await first.storageService.loadCollection();
      const restarted = createTestApp({ bggClient, configPath, dataDir, fileOps, now });
      expect(
        accepted(await restarted.ownerGameNoteService.set(bggGameId, lostRequest)).accepted,
      ).toEqual({ ...lostAcceptance.accepted, replayed: true });
      expect(await restarted.storageService.loadCollection()).toEqual(durableAfterLostAcceptance);
      expect(
        await restarted.ownerGameNoteService.set(bggGameId, {
          commandId: "51000000-0000-4000-8000-000000000007",
          expectedVersion: 2,
          text: "stale draft",
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "stale-version", current: { text: superseded } },
      });

      accepted(
        await restarted.ownerGameNoteService.clear(bggGameId, {
          commandId: commandIds.bggClear,
          expectedVersion: 3,
        }),
      );
      accepted(
        await restarted.ownerGameNoteService.set(bggGameId, {
          commandId: commandIds.bggReauthor,
          expectedVersion: 4,
          text: sentinel,
        }),
      );

      const beforeBlockedDelete = await restarted.storageService.loadCollection();
      let deletionError: unknown;
      try {
        await restarted.gameService.removeGame(bggGameId);
      } catch (error) {
        deletionError = error;
      }
      expect(deletionError).toBeInstanceOf(GameHistoryConflictError);
      expect(await restarted.storageService.loadCollection()).toEqual(beforeBlockedDelete);

      const notePath = `/api/games/${bggGameId}/note`;
      const routeMutation = await jsonRequest(restarted.app, "PUT", notePath, {
        commandId: commandIds.route,
        expectedVersion: 5,
        text: `${sentinel}\nthrough daemon route`,
      });
      expect(routeMutation.status).toBe(200);
      const routeMutationText = await routeMutation.text();
      expect(routeMutationText).not.toContain(sentinel);
      expect(JSON.parse(routeMutationText)).toMatchObject({
        ok: true,
        accepted: { commandId: commandIds.route, version: 6, state: "present" },
      });
      const profileAfterNote = await restarted.profileService.getProfile();
      const profileCacheAfterNote = await restarted.storageService.loadProfile();
      if (profileCacheAfterNote === null)
        throw new Error("Expected profile cache after note mutation");
      expect({ ...profileAfterNote, computedAt: null }).toEqual({
        ...profileBeforeNote,
        computedAt: null,
      });
      expect(profileCacheAfterNote.sourceIdentity.collectionRevision).toBeGreaterThan(
        profileCacheBeforeNote.sourceIdentity.collectionRevision,
      );

      await restarted.gameService.removeGame(manual.id);
      const afterEligibleDelete = await restarted.storageService.loadCollection();
      expect(afterEligibleDelete.games.some(({ id }) => id === manual.id)).toBe(false);
      expect(
        afterEligibleDelete.commandReceipts.some(
          (receipt) => receipt.commandId === commandIds.manual,
        ),
      ).toBe(false);

      const refreshed = await restarted.gameService.refreshBggData(bggGameId);
      expect(refreshed.game.name).toBe("Refreshed BGG fixture");
      expect(await restarted.gameService.importBggCollection()).toEqual({
        imported: 0,
        skipped: 1,
        errors: [],
      });
      const wishlistAdded = await jsonRequest(restarted.app, "POST", "/api/wishlist", {
        bggId: 789,
      });
      expect(wishlistAdded.status).toBe(201);
      expect(await wishlistAdded.json()).toMatchObject({ entry: { bggId: 789 } });
      const wishlistPath = path.join(dataDir, "wishlist.json");
      const wishlistText = await readFile(wishlistPath, "utf8");
      expect(wishlistText).toContain('"bggId": 789');
      expect(JSON.parse(wishlistText)).toHaveLength(1);
      expect((await restarted.ownerGameNoteService.get(bggGameId)).note).toMatchObject({
        state: "present",
        version: 6,
        text: `${sentinel}\nthrough daemon route`,
      });

      const detail = await jsonRequest(restarted.app, "GET", `/api/games/${bggGameId}/note`);
      const list = await jsonRequest(restarted.app, "GET", "/api/games");
      const profile = await jsonRequest(restarted.app, "GET", "/api/profile");
      const operations = JSON.stringify(restarted.operations);
      const broadPayloads = [await list.text(), await profile.text(), operations];
      expect(detail.status).toBe(200);
      expect(await detail.text()).toContain(sentinel);
      for (const payload of broadPayloads) expect(payload).not.toContain(sentinel);
      const invalidWishlistRequest = await jsonRequest(restarted.app, "POST", "/api/wishlist", {
        bggId: sentinel,
      });
      const missingWishlistEntry = await jsonRequest(
        restarted.app,
        "DELETE",
        "/api/wishlist/not-found",
      );
      expect([invalidWishlistRequest.status, missingWishlistEntry.status]).toEqual([400, 404]);
      const nonAuthorizedErrors = [
        await invalidWishlistRequest.text(),
        await missingWishlistEntry.text(),
      ];
      for (const payload of nonAuthorizedErrors) {
        expect(payload).not.toContain(sentinel);
        expect(payload).not.toContain(superseded);
      }
      expect(bggCalls).toBe(2);

      const collectionText = await readFile(collectionPath, "utf8");
      expect(collectionText).toContain(sentinel);
      expect(collectionText).not.toContain(superseded);
      expect(JSON.stringify(afterEligibleDelete.commandReceipts)).not.toContain("manual note");
      const durableArtifacts = await Promise.all(
        (await readdir(dataDir))
          .filter((entry) => entry !== "collection.json")
          .map(async (entry) => readFile(path.join(dataDir, entry), "utf8")),
      );
      expect(durableArtifacts.join("\n")).not.toContain(sentinel);
      expect(durableArtifacts.join("\n")).not.toContain(superseded);
      expect((await readdir(dataDir)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("uses one production Unix daemon for CLI, web mutation contracts, and isolation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shelf-judge-owner-note-parity-"));
    const dataDir = path.join(root, "data");
    const socketPath = path.join(root, "daemon.sock");
    const configPath = path.join(root, "config.json");
    const fileOps = createFileOps();
    const transmittedBggRequests: unknown[] = [];
    const modelRequests: unknown[] = [];
    const capturedLogs: unknown[][] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => capturedLogs.push(args);
    const groundedAnalysisProvider: GroundedAnalysisProvider = {
      configurationStatus: {
        status: "configured",
        identity: { providerId: "instrumented", modelId: "instrumented", extensionIds: [] },
      },
      analyze(request) {
        modelRequests.push(request);
        return Promise.reject(new Error("owner-note flow must not invoke the model"));
      },
    };
    const bggClient = createMockBggClient({
      getGame: (id) => {
        transmittedBggRequests.push(id);
        return Promise.reject(new Error("instrumented BGG refresh failure"));
      },
    });

    try {
      await fileOps.mkdir(dataDir);
      await writeFile(
        path.join(dataDir, "collection.json"),
        await readFile(fixturePath, "utf8"),
        "utf8",
      );
      const context = createTestApp({
        bggClient,
        configPath,
        dataDir,
        fileOps,
        groundedAnalysisProvider,
      });
      await context.storageService.loadCollection();
      const server = Bun.serve({ unix: socketPath, fetch: context.app.fetch });

      try {
        const missingCli = await runCli(["game", "note", "get", bggGameId, "--json"], socketPath);
        const missingDaemon = await fetch(`http://localhost/api/games/${bggGameId}/note`, {
          unix: socketPath,
        } as BunFetchRequestInit);
        expect(missingCli.exitCode).toBe(0);
        expect(JSON.parse(missingCli.stdout)).toEqual(await missingDaemon.json());
        const cliSet = await runCli(
          [
            "game",
            "note",
            "set",
            bggGameId,
            "--expected-version",
            "0",
            "--text",
            sentinel,
            "--command-id",
            "52000000-0000-4000-8000-000000000001",
            "--json",
          ],
          socketPath,
        );
        expect(cliSet.exitCode).toBe(0);
        const cliAccepted: unknown = JSON.parse(cliSet.stdout);
        expect(cliAccepted).toMatchObject({
          accepted: { gameId: bggGameId, state: "present", version: 1, replayed: false },
        });
        expect(cliSet.stdout).not.toContain(sentinel);

        const daemonRead = await fetch(`http://localhost/api/games/${bggGameId}/note`, {
          unix: socketPath,
        } as BunFetchRequestInit);
        expect(await daemonRead.json()).toMatchObject({
          gameId: bggGameId,
          note: { state: "present", text: sentinel },
        });
        const presentCli = await runCli(["game", "note", "get", bggGameId, "--json"], socketPath);
        const presentDaemon = await fetch(`http://localhost/api/games/${bggGameId}/note`, {
          unix: socketPath,
        } as BunFetchRequestInit);
        expect(presentCli.exitCode).toBe(0);
        expect(JSON.parse(presentCli.stdout)).toEqual(await presentDaemon.json());
        const routeAccepted = await fetch(`http://localhost/api/games/${bggGameId}/note`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commandId: "52000000-0000-4000-8000-000000000002",
            expectedVersion: 1,
            text: sentinel,
          }),
          unix: socketPath,
        } as BunFetchRequestInit);
        expect(await routeAccepted.json()).toMatchObject({
          ok: true,
          accepted: { gameId: bggGameId, state: "present", version: 2, replayed: false },
        });

        const routeStale = await jsonRequest(context.app, "PUT", `/api/games/${bggGameId}/note`, {
          commandId: "52000000-0000-4000-8000-000000000003",
          expectedVersion: 1,
          text: "stale CLI draft",
        });
        const cliStale = await runCli(
          [
            "game",
            "note",
            "set",
            bggGameId,
            "--expected-version",
            "1",
            "--text",
            "stale CLI draft",
            "--command-id",
            "52000000-0000-4000-8000-000000000004",
            "--json",
          ],
          socketPath,
        );
        expect(routeStale.status).toBe(409);
        expect(cliStale.exitCode).not.toBe(0);
        expect(cliStale.stderr).toContain("stale-version");
        // A stale response is an authorized complete note read so the owner can resolve it.
        expect(cliStale.stderr).toContain(sentinel);

        const clearCommandId = "52000000-0000-4000-8000-000000000005";
        const clearCli = await runCli(
          [
            "game",
            "note",
            "clear",
            bggGameId,
            "--expected-version",
            "2",
            "--command-id",
            clearCommandId,
            "--json",
          ],
          socketPath,
        );
        expect(clearCli.exitCode).toBe(0);
        const clearReplay = await fetch(`http://localhost/api/games/${bggGameId}/note`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commandId: clearCommandId, expectedVersion: 2 }),
          unix: socketPath,
        } as BunFetchRequestInit);
        const clearReplayResult: unknown = await clearReplay.json();
        expect(clearReplayResult).toMatchObject({
          ok: true,
          accepted: {
            commandId: clearCommandId,
            gameId: bggGameId,
            state: "cleared",
            version: 3,
            replayed: true,
          },
        });
        const clearedCli = await runCli(["game", "note", "get", bggGameId, "--json"], socketPath);
        const clearedDaemon = await fetch(`http://localhost/api/games/${bggGameId}/note`, {
          unix: socketPath,
        } as BunFetchRequestInit);
        expect(JSON.parse(clearedCli.stdout)).toEqual(await clearedDaemon.json());

        const alreadyClearCli = await runCli(
          [
            "game",
            "note",
            "clear",
            bggGameId,
            "--expected-version",
            "3",
            "--command-id",
            "52000000-0000-4000-8000-000000000006",
            "--json",
          ],
          socketPath,
        );
        expect(alreadyClearCli.exitCode).toBe(0);
        expect(JSON.parse(alreadyClearCli.stdout)).toMatchObject({
          accepted: { state: "cleared", version: 3, replayed: false, alreadyClear: true },
        });

        await context.profileService.getProfile();
        await jsonRequest(context.app, "GET", "/api/games");
        await jsonRequest(context.app, "GET", "/api/profile");
        expect(transmittedBggRequests).toEqual([]);
        expect(modelRequests).toEqual([]);
        expect(() => context.gameService.refreshBggData(bggGameId)).toThrow(
          "instrumented BGG refresh failure",
        );
        expect(transmittedBggRequests).toEqual([123]);
        expect(JSON.stringify(transmittedBggRequests)).not.toContain(sentinel);
        expect(modelRequests).toEqual([]);
        expect(context.groundedAnalysisProvider.configurationStatus.status).toBe("configured");
        expect(JSON.stringify(capturedLogs)).not.toContain(sentinel);
        expect(JSON.stringify(capturedLogs)).not.toContain(superseded);
        expect(JSON.stringify(context.operations)).not.toContain(sentinel);
        expect(JSON.stringify(context.operations)).not.toContain(superseded);
      } finally {
        void server.stop(true);
      }
    } finally {
      console.log = originalConsoleLog;
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("restores an owner note and replay receipt from a complete stopped-server data backup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shelf-judge-owner-note-backup-"));
    const dataDir = path.join(root, "data");
    const backupDir = path.join(root, "complete-backup");
    const socketPath = path.join(root, "daemon.sock");
    const configPath = path.join(root, "config.json");
    const fileOps = createFileOps();
    const commandId = "53000000-0000-4000-8000-000000000001";
    const backupNote = "OWNER_NOTE_BACKUP_RESTORED";
    let server: ReturnType<typeof Bun.serve> | null = null;

    const start = () => {
      const context = createTestApp({ configPath, dataDir, fileOps });
      server = Bun.serve({ unix: socketPath, fetch: context.app.fetch });
      return context;
    };
    const stop = () => {
      if (server !== null) {
        void server.stop(true);
        server = null;
      }
    };

    try {
      await fileOps.mkdir(dataDir);
      await writeFile(
        path.join(dataDir, "collection.json"),
        await readFile(fixturePath, "utf8"),
        "utf8",
      );
      const initial = start();
      await initial.storageService.loadCollection();
      const set = accepted(
        await initial.ownerGameNoteService.set(bggGameId, {
          commandId,
          expectedVersion: 0,
          text: backupNote,
        }),
      );
      stop();
      await cp(dataDir, backupDir, { recursive: true });

      const mutated = start();
      accepted(
        await mutated.ownerGameNoteService.clear(bggGameId, {
          commandId: "53000000-0000-4000-8000-000000000002",
          expectedVersion: set.accepted.version,
        }),
      );
      expect((await mutated.ownerGameNoteService.get(bggGameId)).note.state).toBe("cleared");
      stop();
      await rm(dataDir, { recursive: true, force: true });
      await cp(backupDir, dataDir, { recursive: true });

      const restored = start();
      expect((await restored.ownerGameNoteService.get(bggGameId)).note).toMatchObject({
        state: "present",
        text: backupNote,
        version: set.accepted.version,
      });
      const beforeReplay = await readFile(path.join(dataDir, "collection.json"), "utf8");
      expect(
        accepted(
          await restored.ownerGameNoteService.set(bggGameId, {
            commandId,
            expectedVersion: 0,
            text: backupNote,
          }),
        ).accepted,
      ).toEqual({ ...set.accepted, replayed: true });
      expect(await readFile(path.join(dataDir, "collection.json"), "utf8")).toBe(beforeReplay);
    } finally {
      stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
