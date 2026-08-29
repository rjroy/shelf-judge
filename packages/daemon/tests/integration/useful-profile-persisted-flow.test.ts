import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { BggClient, BggGameResult } from "../../src/services/bgg-client.js";
import { parseThingItems } from "../../src/services/bgg-xml-parser.js";
import { createFileOps } from "../../src/services/file-ops.js";
import { GameHistoryConflictError } from "../../src/services/game-service.js";
import { createTestApp } from "../helpers/test-app.js";

const fixturePath = path.join(import.meta.dir, "../fixtures/useful-profile-schema-v3.json");
const commandIds = {
  first: "31000000-0000-4000-8000-000000000001",
  replay: "31000000-0000-4000-8000-000000000002",
  renewed: "31000000-0000-4000-8000-000000000003",
} as const;

function result(bggId: number, observedAt: string, plays: number | "missing"): BggGameResult {
  const [thing] = parseThingItems(
    `<items><item type="boardgame" id="${bggId}">
      <name type="primary" value="Game ${bggId}"/><yearpublished value="2020"/>
      <minplayers value="1"/><maxplayers value="4"/><playingtime value="60"/>
      <link type="boardgamemechanic" id="101" value="Worker Placement"/>
      <link type="boardgamemechanic" id="${1000 + bggId}" value="Limited ${bggId}"/>
      <link type="boardgamedesigner" id="201" value="Shared Designer"/>
      <link type="boardgameartist" id="301" value="Shared Artist"/>
      <statistics><ratings><average value="7"/><bayesaverage value="6.5"/>
      <averageweight value="2.5"/><numweights value="20"/></ratings></statistics>
    </item></items>`,
    observedAt,
  );
  if (thing === undefined) throw new Error("Expected parsed BGG fixture");
  return {
    ...thing,
    collectionData: {
      numPlays: plays === "missing" ? null : plays,
      observation: {
        sourceRequest: "bgg-collection",
        observedAt,
        state: "complete",
        fieldsReturned: plays === "missing" ? [] : ["numPlays"],
      },
    },
  };
}

describe("useful profile persisted flow", () => {
  test("migrates v3 through real atomic files and preserves exact lifecycle state across restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shelf-judge-profile-flow-"));
    const dataDir = path.join(root, "data");
    const configPath = path.join(root, "config.json");
    const collectionPath = path.join(dataDir, "collection.json");
    const profilePath = path.join(dataDir, "profile.json");
    const fileOps = createFileOps();
    await fileOps.mkdir(dataDir);
    await writeFile(collectionPath, await readFile(fixturePath, "utf8"), "utf8");
    let observation = 1;
    let missingFor: number | null = null;
    const playCounts = new Map([
      [123, 0],
      [124, 2],
      [125, 4],
      [126, 6],
    ]);
    const bggClient: BggClient = {
      isConfigured: () => true,
      searchGames: () => Promise.resolve([]),
      getUserCollection: () => Promise.resolve([]),
      getGame: (bggId) =>
        Promise.resolve(
          result(
            bggId,
            `2026-08-28T10:${String(observation++).padStart(2, "0")}:00.000Z`,
            missingFor === bggId ? "missing" : (playCounts.get(bggId) ?? 0),
          ),
        ),
      getGames: async (ids, onBatch) => {
        const results = new Map(
          ids.map((id) => [
            id,
            result(
              id,
              `2026-08-28T10:${String(observation++).padStart(2, "0")}:00.000Z`,
              playCounts.get(id) ?? 0,
            ),
          ]),
        );
        await onBatch?.({ batchIds: ids, results, failures: new Map() });
        return results;
      },
    };
    let currentNow = "2026-08-28T11:00:00.000Z";
    const now = () => currentNow;
    const intentionIds = ["intention-first", "intention-replay", "intention-renewed"];
    let intentionIdIndex = 0;
    const firstProcess = createTestApp({
      fileOps,
      dataDir,
      configPath,
      bggClient,
      now,
      createIntentionId: () => intentionIds[intentionIdIndex++] ?? "unexpected-intention",
    });

    try {
      expect((await firstProcess.storageService.loadCollection()).schemaVersion).toBe(4);
      await firstProcess.gameService.refreshBggData("bgg-game");
      const added = [];
      for (const bggId of [124, 125, 126]) {
        added.push((await firstProcess.gameService.addGame({ name: `Game ${bggId}`, bggId })).game);
      }
      const allGames = [
        (await firstProcess.storageService.loadCollection()).games.find(
          ({ id }) => id === "bgg-game",
        ),
        ...added,
      ].filter((game) => game !== undefined);
      const axis = await firstProcess.axisService.createAxis({
        name: "Personal fit",
        weight: 100,
        source: "personal",
      });
      for (const [index, game] of allGames.entries()) {
        await firstProcess.gameService.rateGame(game.id, { [axis.id]: 8 - index });
      }

      const initialProfile = await firstProcess.profileService.getProfile();
      expect(initialProfile.status).toBe("available");
      if (initialProfile.status !== "available") throw new Error("Expected available profile");
      for (const entityClass of ["mechanic", "designer", "artist"] as const) {
        expect(initialProfile.identity.classes[entityClass].result).toBe("supported");
      }
      expect(
        initialProfile.identity.classes.mechanic.entities.some(
          ({ support }) => support === "limited",
        ),
      ).toBe(true);

      const firstCommand = {
        type: "create" as const,
        commandId: commandIds.first,
        gameId: "bgg-game",
        kind: "first-play" as const,
        expectedActiveIntention: "absent" as const,
      };
      const replayGame = added[0];
      if (replayGame === undefined) throw new Error("Expected replay game");
      const replayCommand = {
        type: "create" as const,
        commandId: commandIds.replay,
        gameId: replayGame.id,
        kind: "replay" as const,
        expectedActiveIntention: "absent" as const,
      };
      const firstAccepted = await firstProcess.intentionService.execute(firstCommand);
      const replayAccepted = await firstProcess.intentionService.execute(replayCommand);
      expect(firstAccepted.ok && replayAccepted.ok).toBe(true);

      missingFor = 123;
      await firstProcess.gameService.refreshBggData("bgg-game");
      const warning = await firstProcess.profileService.getProfile();
      expect(
        warning.status === "available" && warning.attention.items[0]?.currentPlayEvidence.status,
      ).toBe("stale");
      currentNow = "2026-08-28T11:01:00.000Z";
      const correction = await firstProcess.intentionService.setPlayCount("bgg-game", 1);
      expect(correction.ok && correction.linkedIntentionTransition?.resolution?.source).toBe(
        "observed-play-increase",
      );
      let removalError: unknown;
      try {
        await firstProcess.gameService.removeGame("bgg-game");
      } catch (error) {
        removalError = error;
      }
      expect(removalError).toBeInstanceOf(GameHistoryConflictError);

      const ownership = await firstProcess.gameService.setOwnership(
        replayGame.id,
        "previously-owned",
      );
      expect(ownership.linkedIntentionTransition?.resolution?.outcome).toBe("retired");
      await firstProcess.gameService.setOwnership(replayGame.id, "owned");
      const renewedCommand = { ...replayCommand, commandId: commandIds.renewed };
      const renewed = await firstProcess.intentionService.execute(renewedCommand);
      expect(renewed.ok).toBe(true);
      if (!renewed.ok || !replayAccepted.ok || !firstAccepted.ok) {
        throw new Error("Expected accepted intentions");
      }

      const durableBeforeRestart = await firstProcess.storageService.loadCollection();
      expect(durableBeforeRestart.revision).toBe(16);
      expect(durableBeforeRestart.intentions).toEqual([
        {
          intentionId: "intention-first",
          gameId: "bgg-game",
          kind: "first-play",
          baseline: {
            playCount: 0,
            evidenceSource: "bgg-collection",
            observedAt: "2026-08-28T10:01:00.000Z",
          },
          createdAt: "2026-08-28T11:00:00.000Z",
          version: 2,
          resolution: {
            outcome: "completed",
            source: "observed-play-increase",
            resolvedAt: "2026-08-28T11:01:00.000Z",
          },
        },
        {
          intentionId: "intention-replay",
          gameId: replayGame.id,
          kind: "replay",
          baseline: {
            playCount: 2,
            evidenceSource: "bgg-collection",
            observedAt: "2026-08-28T10:02:00.000Z",
          },
          createdAt: "2026-08-28T11:00:00.000Z",
          version: 2,
          resolution: {
            outcome: "retired",
            source: "owner-retired",
            resolvedAt: "2026-08-28T11:01:00.000Z",
          },
        },
        {
          intentionId: "intention-renewed",
          gameId: replayGame.id,
          kind: "replay",
          baseline: {
            playCount: 2,
            evidenceSource: "bgg-collection",
            observedAt: "2026-08-28T10:02:00.000Z",
          },
          createdAt: "2026-08-28T11:01:00.000Z",
          version: 1,
          resolution: null,
        },
      ]);
      expect(durableBeforeRestart.commandReceipts).toEqual([
        { commandId: commandIds.first, request: firstCommand, result: firstAccepted },
        { commandId: commandIds.replay, request: replayCommand, result: replayAccepted },
        { commandId: commandIds.renewed, request: renewedCommand, result: renewed },
      ]);
      for (const game of durableBeforeRestart.games.filter(({ bggId }) => bggId !== null)) {
        const bggId = game.bggId;
        if (bggId === null) throw new Error("Expected BGG game");
        expect(game.entityMetadata).toMatchObject({
          mechanic: {
            state: "complete",
            entities: [
              { id: 101, name: "Worker Placement" },
              { id: 1000 + bggId, name: `Limited ${bggId}` },
            ],
          },
          designer: { state: "complete", entities: [{ id: 201, name: "Shared Designer" }] },
          artist: { state: "complete", entities: [{ id: 301, name: "Shared Artist" }] },
        });
      }

      await firstProcess.profileService.getProfile();
      expect(await fileOps.exists(profilePath)).toBe(true);
      const serializedBeforeRestart = await readFile(collectionPath, "utf8");
      await firstProcess.storageService.discardProfile?.();
      expect(await fileOps.exists(profilePath)).toBe(false);

      const secondProcess = createTestApp({ fileOps, dataDir, configPath, bggClient, now });
      expect(await secondProcess.storageService.loadCollection()).toEqual(durableBeforeRestart);
      expect(await readFile(collectionPath, "utf8")).toBe(serializedBeforeRestart);
      expect((await secondProcess.profileService.getProfile()).status).toBe("available");
      expect(await fileOps.exists(profilePath)).toBe(true);
      expect(await secondProcess.storageService.loadProfile()).not.toBeNull();
      expect(await secondProcess.storageService.loadCollection()).toEqual(durableBeforeRestart);
      expect(await secondProcess.intentionService.execute(firstCommand)).toEqual(firstAccepted);
      expect(await secondProcess.intentionService.execute(replayCommand)).toEqual(replayAccepted);
      expect(await secondProcess.intentionService.execute(renewedCommand)).toEqual(renewed);
      expect(await secondProcess.storageService.loadCollection()).toEqual(durableBeforeRestart);
      expect((await readdir(dataDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("produces byte-identical deterministic v4 migrations from identical original v3 bytes", async () => {
    const source = await readFile(fixturePath, "utf8");
    const outputs: string[] = [];
    for (const suffix of ["a", "b"]) {
      const root = await mkdtemp(path.join(tmpdir(), `shelf-judge-profile-migration-${suffix}-`));
      const dataDir = path.join(root, "data");
      const collectionPath = path.join(dataDir, "collection.json");
      const fileOps = createFileOps();
      try {
        await fileOps.mkdir(dataDir);
        await writeFile(collectionPath, source, "utf8");
        const process = createTestApp({
          fileOps,
          dataDir,
          configPath: path.join(root, "config.json"),
        });
        const migrated = await process.storageService.loadCollection();
        expect(migrated.schemaVersion).toBe(4);
        outputs.push(await readFile(collectionPath, "utf8"));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
    expect(outputs).toHaveLength(2);
    expect(outputs[1]).toBe(outputs[0]);
  });
});
