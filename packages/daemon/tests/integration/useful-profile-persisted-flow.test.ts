import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { BggClient, BggGameResult } from "../../src/services/bgg-client.js";
import { parseThingItems } from "../../src/services/bgg-xml-parser.js";
import { createFileOps } from "../../src/services/file-ops.js";
import { GameHistoryConflictError } from "../../src/services/game-service.js";
import { createProfileService } from "../../src/services/profile-service.js";
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
      ${bggId === 124 || bggId === 125 ? '<link type="boardgamemechanic" id="777" value="Two Game Mechanic"/>' : ""}
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
      getPlayCount: () => Promise.reject(new Error("not implemented")),
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
      const initialConfig = await firstProcess.storageService.loadConfig();
      await firstProcess.storageService.saveConfig({
        ...initialConfig,
        profileEntityPolicy: {
          mechanic: { overviewLimit: 3, minimumSupportedGames: 1 },
          designer: { overviewLimit: 3, minimumSupportedGames: 1 },
          artist: { overviewLimit: 3, minimumSupportedGames: 1 },
        },
      });
      expect((await firstProcess.storageService.loadCollection()).schemaVersion).toBe(6);
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
      const profileScores = [10, 9, 9, 1];
      for (const [index, game] of allGames.entries()) {
        await firstProcess.gameService.rateGame(game.id, { [axis.id]: profileScores[index] });
      }

      const initialProfile = await firstProcess.profileService.getProfile();
      expect(initialProfile.status).toBe("available");
      if (initialProfile.status !== "available") throw new Error("Expected available profile");
      for (const entityClass of ["mechanic", "designer", "artist"] as const) {
        expect(initialProfile.identity.classes[entityClass].result).toBe("supported");
      }
      expect(
        initialProfile.identity.classes.mechanic.entities.every(
          ({ support }) => support === "supported",
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
              ...(bggId === 124 || bggId === 125 ? [{ id: 777, name: "Two Game Mechanic" }] : []),
              { id: 1000 + bggId, name: `Limited ${bggId}` },
            ],
          },
          designer: { state: "complete", entities: [{ id: 201, name: "Shared Designer" }] },
          artist: { state: "complete", entities: [{ id: 301, name: "Shared Artist" }] },
        });
      }

      await firstProcess.profileService.getProfile();
      expect(await fileOps.exists(profilePath)).toBe(true);
      const cachedBeforePolicyChange = await firstProcess.storageService.loadProfile();
      if (cachedBeforePolicyChange === null) throw new Error("Expected current profile cache");
      const restartedProcess = createTestApp({ fileOps, dataDir, configPath, bggClient, now });
      let restartComputations = 0;
      const restartedProfileService = createProfileService({
        storageService: restartedProcess.storageService,
        displayedFitnessService: {
          ...restartedProcess.displayedFitnessService,
          async listGamesFromSnapshot(snapshot, options) {
            restartComputations += 1;
            return restartedProcess.displayedFitnessService.listGamesFromSnapshot(
              snapshot,
              options,
            );
          },
        },
        now,
      });
      expect(await restartedProfileService.getProfile()).toEqual(cachedBeforePolicyChange.profile);
      expect(restartComputations).toBe(0);
      const mechanicBefore = cachedBeforePolicyChange.profile.identity.classes.mechanic;
      expect(mechanicBefore.orderings.bestFit).toEqual([1123, 777, 1124, 1125, 101, 1126]);
      expect(mechanicBefore.orderings.support).toEqual([101, 777, 1123, 1124, 1125, 1126]);
      expect(mechanicBefore.overviewEntityIds).toEqual([1123, 777, 1124]);
      expect(
        mechanicBefore.entities.find(({ entityId }) => entityId === 1123)
          ?.adjustedMeanCurrentFitness,
      ).toBe(69 / 8);
      expect(
        mechanicBefore.entities.find(({ entityId }) => entityId === 777)
          ?.adjustedMeanCurrentFitness,
      ).toBe(101 / 12);
      const config = await firstProcess.storageService.loadConfig();
      await firstProcess.storageService.saveConfig({
        ...config,
        profileEntityPolicy: {
          mechanic: { overviewLimit: 3, minimumSupportedGames: 5 },
          designer: { overviewLimit: 3, minimumSupportedGames: 5 },
          artist: { overviewLimit: 3, minimumSupportedGames: 5 },
        },
      });
      expect(await firstProcess.storageService.loadProfile()).toBeNull();
      const recomputedForPolicy = await firstProcess.profileService.getProfile();
      if (recomputedForPolicy.status !== "available") {
        throw new Error("Expected profile after policy change");
      }
      for (const entityClass of ["mechanic", "designer", "artist"] as const) {
        const classResult = recomputedForPolicy.identity.classes[entityClass];
        expect(classResult.result).toBe("limited");
        expect(classResult.overviewEntityIds).toEqual([]);
      }
      const mechanicAfter = recomputedForPolicy.identity.classes.mechanic;
      expect(mechanicAfter.orderings.bestFit).toEqual([777, 1123, 1124, 1125, 101, 1126]);
      expect(mechanicAfter.orderings.support).toEqual([101, 777, 1123, 1124, 1125, 1126]);
      expect(
        mechanicAfter.entities.find(({ entityId }) => entityId === 1123)
          ?.adjustedMeanCurrentFitness,
      ).toBe(185 / 24);
      expect(
        mechanicAfter.entities.find(({ entityId }) => entityId === 777)?.adjustedMeanCurrentFitness,
      ).toBe(31 / 4);
      const policyCache = await firstProcess.storageService.loadProfile();
      expect(policyCache?.profile.entityPolicy.mechanic.minimumSupportedGames).toBe(5);
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
        expect(migrated.schemaVersion).toBe(6);
        outputs.push(await readFile(collectionPath, "utf8"));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
    expect(outputs).toHaveLength(2);
    expect(outputs[1]).toBe(outputs[0]);
  });
});
