import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { BggClient, BggGameResult } from "../../src/services/bgg-client.js";
import { parseThingItems } from "../../src/services/bgg-xml-parser.js";
import { createFileOps } from "../../src/services/file-ops.js";
import { GameHistoryConflictError } from "../../src/services/game-service.js";
import { createProfileService } from "../../src/services/profile-service.js";
import {
  attentionCandidateStorageFor,
  createAttentionCandidateProductionSourceLoader,
} from "../../src/services/attention-candidate-service.js";
import { computeAttentionCandidates } from "../../src/services/attention-candidate-engine.js";
import { projectPurchaseUtilization } from "../../src/services/purchase-utilization-projection.js";
import { createAttentionDispositionService } from "../../src/services/attention-disposition-service.js";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";

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
  test("fans an integrated redundancy peer rating change into persisted purchase attention", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shelf-judge-redundancy-fanout-"));
    const dataDir = path.join(root, "data");
    const configPath = path.join(root, "config.json");
    const currentNow = "2026-08-28T11:00:00.000Z";
    const now = () => currentNow;
    const fileOps = createFileOps();
    await fileOps.mkdir(dataDir);
    const bggClient: BggClient = {
      isConfigured: () => true,
      searchGames: () => Promise.resolve([]),
      getUserCollection: () => Promise.resolve([]),
      getPlayCount: () => Promise.reject(new Error("not implemented")),
      getGame: (bggId) => Promise.resolve(result(bggId, currentNow, 1)),
      getGames: () => Promise.resolve(new Map()),
    };
    const app = createTestApp({ fileOps, dataDir, configPath, now, bggClient });
    const candidateStorage = attentionCandidateStorageFor(app.storageService);

    const recompute = async () => {
      const source = await createAttentionCandidateProductionSourceLoader(app.storageService)();
      const fitness = await app.displayedFitnessService.listGamesFromSnapshot(source, {
        includePredicted: true,
      });
      const purchaseProjectionByGameId = new Map(
        fitness.map((entry) => [
          entry.game.id,
          projectPurchaseUtilization(entry, source.collection.entertainmentBenchmark),
        ]),
      );
      const full = computeAttentionCandidates({
        collection: source.collection,
        evaluatedAt: currentNow,
        displayedFitness: fitness,
        purchaseUtilizationProjectionByGameId: purchaseProjectionByGameId,
        displayedFitnessSourceIdentity: source.identity,
      });
      const artifact = await candidateStorage.loadAttentionCandidates();
      if (artifact === null) throw new Error("Expected durable candidate artifact");
      const storedRows = artifact.rows
        .map(({ gameId, evaluation }) => [gameId, evaluation] as const)
        .sort(([left], [right]) => left.localeCompare(right));
      const expectedRows = full.evaluations
        .map(({ gameId, ...evaluation }) => [gameId, { gameId, ...evaluation }] as const)
        .sort(([left], [right]) => left.localeCompare(right));
      expect(storedRows).toEqual(expectedRows);

      const profile = await app.profileService.getProfile();
      expect(profile.status).toBe("available");
      if (profile.status !== "available") throw new Error("Expected public Profile cards");
      const cards = profile.attention.cards
        .map(
          ({ gameId, ruleId, attentionScore }) =>
            [gameId, ruleId, attentionScore.numerator, attentionScore.denominator] as const,
        )
        .sort(([left], [right]) => left.localeCompare(right));
      const expectedCards = full.evaluations
        .flatMap(({ gameId, winner }) =>
          winner === null
            ? []
            : [
                [
                  gameId,
                  winner.ruleId,
                  winner.attentionScore.numerator,
                  winner.attentionScore.denominator,
                ] as const,
              ],
        )
        .sort(([left], [right]) => left.localeCompare(right));
      expect(cards).toEqual(expectedCards);
      return { artifact, cards, fitness, full, purchaseProjectionByGameId };
    };

    try {
      const peerA = await app.gameService.addGame({ name: "Peer A", bggId: 901 });
      const targetB = await app.gameService.addGame({ name: "Target B", bggId: 902 });
      await app.gameService.refreshBggData(peerA.game.id);
      await app.gameService.refreshBggData(targetB.game.id);
      const axis = await app.axisService.createAxis({
        name: "Redundancy personal fit",
        weight: 100,
        source: "personal",
      });
      await app.gameService.rateGame(peerA.game.id, { [axis.id]: 10 });
      await app.gameService.rateGame(targetB.game.id, { [axis.id]: 6 });

      const settings = await jsonRequest(app.app, "PATCH", "/api/redundancy/settings", {
        enabled: true,
        stage: "integrated",
        similarityThreshold: 0.1,
        maxPenalty: 2,
        minNeighbors: 1,
        expectedNeighbors: 5,
      });
      expect(settings.status).toBe(200);
      const benchmark = await jsonRequest(
        app.app,
        "PUT",
        "/api/collection/entertainment-benchmark",
        {
          amount: "10.00",
        },
      );
      expect(benchmark.status).toBe(200);
      const acquisition = await jsonRequest(
        app.app,
        "PUT",
        `/api/games/${targetB.game.id}/acquisition`,
        { state: "purchase", amount: "500.00" },
      );
      expect(acquisition.status).toBe(200);

      const before = await recompute();
      const beforePeer = before.fitness.find(({ game }) => game.id === peerA.game.id);
      const beforeTarget = before.fitness.find(({ game }) => game.id === targetB.game.id);
      const beforeProjection = before.purchaseProjectionByGameId.get(targetB.game.id);
      const beforeWinner = before.full.evaluations.find(
        ({ gameId }) => gameId === targetB.game.id,
      )?.winner;
      const beforeCard = before.cards.find(([gameId]) => gameId === targetB.game.id);
      if (!beforePeer?.score || !beforeTarget?.score || beforeProjection === undefined)
        throw new Error("Expected scored redundancy peers and purchase projection");
      expect(
        beforeTarget.score.redundancyAdjustment?.nicheNeighbors.some(
          ({ gameId }) => gameId === peerA.game.id,
        ),
      ).toBe(true);
      expect(beforeWinner?.ruleId).toBe("underused-purchase");
      expect(beforeCard?.[1]).toBe("underused-purchase");

      await app.gameService.rateGame(peerA.game.id, { [axis.id]: 1 });
      const after = await recompute();
      const afterPeer = after.fitness.find(({ game }) => game.id === peerA.game.id);
      const afterTarget = after.fitness.find(({ game }) => game.id === targetB.game.id);
      const afterProjection = after.purchaseProjectionByGameId.get(targetB.game.id);
      const afterWinner = after.full.evaluations.find(
        ({ gameId }) => gameId === targetB.game.id,
      )?.winner;
      const afterCard = after.cards.find(([gameId]) => gameId === targetB.game.id);
      if (!afterPeer?.score || !afterTarget?.score || afterProjection === undefined)
        throw new Error("Expected recomputed peer scores and purchase projection");
      expect(afterPeer.score.score).not.toBe(beforePeer.score.score);
      expect(afterTarget.score.score).not.toBe(beforeTarget.score.score);
      expect(afterProjection.purchaseUtilization.components.valueMultiplier).not.toEqual(
        beforeProjection.purchaseUtilization.components.valueMultiplier,
      );
      expect(afterWinner?.ruleId).toBe("underused-purchase");
      expect(afterWinner?.attentionScore).not.toEqual(beforeWinner?.attentionScore);
      expect(afterCard?.[1]).toBe("underused-purchase");
      expect(afterCard?.slice(2)).not.toEqual(beforeCard?.slice(2));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps nonempty persisted candidates oracle-equivalent across changes, clock recovery, and corruption", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shelf-judge-candidate-flow-"));
    const dataDir = path.join(root, "data");
    const configPath = path.join(root, "config.json");
    const collectionPath = path.join(dataDir, "collection.json");
    const candidatePath = path.join(dataDir, "attention-candidates.json");
    const profilePath = path.join(dataDir, "profile.json");
    let currentNow = "2026-08-28T11:00:00.000Z";
    const now = () => currentNow;
    const fileOps = createFileOps();
    await fileOps.mkdir(dataDir);
    const bggClient: BggClient = {
      isConfigured: () => true,
      searchGames: () => Promise.resolve([]),
      getUserCollection: () => Promise.resolve([]),
      getPlayCount: () => Promise.reject(new Error("not implemented")),
      getGame: (bggId) => Promise.resolve(result(bggId, currentNow, 0)),
      getGames: () => Promise.resolve(new Map()),
    };
    const app = createTestApp({ fileOps, dataDir, configPath, now, bggClient });
    const assertOracleParity = async (context = app) => {
      const source = await createAttentionCandidateProductionSourceLoader(context.storageService)();
      const artifact = await attentionCandidateStorageFor(
        context.storageService,
      ).loadAttentionCandidates();
      if (artifact === null) throw new Error("Expected durable candidate artifact");
      const fitness = await context.displayedFitnessService.listGamesFromSnapshot(source, {
        includePredicted: true,
      });
      const recomputed = computeAttentionCandidates({
        collection: source.collection,
        evaluatedAt: currentNow,
        displayedFitness: fitness,
        purchaseUtilizationProjectionByGameId: new Map(
          fitness.map((entry) => [
            entry.game.id,
            projectPurchaseUtilization(entry, source.collection.entertainmentBenchmark),
          ]),
        ),
        displayedFitnessSourceIdentity: source.identity,
      });
      expect(artifact.rows).toHaveLength(
        source.collection.games.filter(({ ownership }) => ownership === "owned").length,
      );
      const artifactEvaluations = artifact.rows
        .map(({ gameId, evaluation }) => [gameId, evaluation] as const)
        .sort(([left], [right]) => left.localeCompare(right));
      const oracleEvaluations = recomputed.evaluations
        .map(({ gameId, ...evaluation }) => [gameId, { gameId, ...evaluation }] as const)
        .sort(([left], [right]) => left.localeCompare(right));
      expect(artifactEvaluations).toEqual(oracleEvaluations);
      const profile = await context.profileService.getProfile();
      expect(profile.status).toBe("available");
      if (profile.status !== "available") throw new Error("Expected available Profile cards");
      const expectedCards = recomputed.evaluations
        .flatMap(({ gameId, winner }) =>
          winner === null
            ? []
            : [
                [
                  gameId,
                  winner.ruleId,
                  winner.attentionScore.numerator,
                  winner.attentionScore.denominator,
                ],
              ],
        )
        .sort(([left], [right]) => String(left).localeCompare(String(right)));
      const actualCards = profile.attention.cards
        .map(({ gameId, ruleId, attentionScore }) => [
          gameId,
          ruleId,
          attentionScore.numerator,
          attentionScore.denominator,
        ])
        .sort(([left], [right]) => String(left).localeCompare(String(right)));
      expect(actualCards).toEqual(expectedCards);
      return { artifact, recomputed, fitness };
    };

    try {
      const added = await app.gameService.addGame({ name: "Persisted attention game", bggId: 987 });
      await app.gameService.refreshBggData(added.game.id);
      const initial = await assertOracleParity();
      const axis = await app.axisService.createAxis({
        name: "Changed-input evidence",
        weight: 100,
        source: "personal",
      });
      await app.gameService.rateGame(added.game.id, { [axis.id]: 10 });
      const baseline = await assertOracleParity();
      expect(baseline.fitness.some(({ score }) => score !== null)).toBe(true);
      expect(baseline.artifact.identity.collectionRevision).not.toBe(
        initial.artifact.identity.collectionRevision,
      );
      expect(baseline.artifact.rows.some(({ evaluation }) => evaluation.winner !== null)).toBe(
        true,
      );

      const mutationGame = await app.gameService.addGame({
        name: "Persisted mutation evidence",
        bggId: 988,
      });
      await app.gameService.refreshBggData(mutationGame.game.id);
      await assertOracleParity();
      const intention = await app.intentionService.execute({
        type: "create",
        commandId: "31000000-0000-4000-8000-000000000005",
        gameId: mutationGame.game.id,
        kind: "first-play",
        expectedActiveIntention: "absent",
      });
      expect(intention.ok).toBe(true);
      await assertOracleParity();
      currentNow = "2026-08-28T11:01:00.000Z";
      const playCorrection = await app.intentionService.setPlayCount(mutationGame.game.id, 1);
      expect(playCorrection.ok).toBe(true);
      await assertOracleParity();
      const acquisition = await jsonRequest(
        app.app,
        "PUT",
        `/api/games/${mutationGame.game.id}/acquisition`,
        { state: "purchase", amount: "20.00" },
      );
      expect(acquisition.status).toBe(200);
      await assertOracleParity();
      await app.tournamentService.updateSettings({ normalizationHalfWidth: 401 });
      await assertOracleParity();

      const winner = baseline.recomputed.evaluations.find(
        ({ gameId }) => gameId === added.game.id,
      )?.winner;
      if (winner === null || winner === undefined)
        throw new Error("Expected an actionable candidate");

      const dispositions = createAttentionDispositionService({
        collectionMutations: app.collectionMutationService,
        clock: { now: () => new Date(currentNow) },
        currentSelection: () => Promise.resolve({ gameId: added.game.id, ...winner }),
        maintenance: app.attentionCandidateService,
      });
      const snoozed = await dispositions.execute({
        operation: "not-now",
        commandId: "31000000-0000-4000-8000-000000000004",
        gameId: added.game.id,
        ruleId: winner.ruleId,
        ruleVersion: winner.ruleVersion,
        fingerprint: winner.fingerprint,
        expectedVersion: 0,
      });
      expect(snoozed.outcome).toBe("accepted");
      const snoozedState = await assertOracleParity();
      const persistedBeforeClockAdvance = await readFile(candidatePath, "utf8");
      const snooze = snoozedState.artifact.rows.find(({ gameId }) => gameId === added.game.id);
      expect(snooze?.evaluation.winner).toBeNull();
      expect(snooze?.evaluation.nextEvaluationBoundary).toBe("2026-09-27T11:01:00.000Z");

      currentNow = "2026-09-27T11:00:59.999Z";
      const beforeBoundary = await app.attentionCandidateService.ensureFresh();
      expect(beforeBoundary.state).toBe("available");
      if (beforeBoundary.state !== "available")
        throw new Error("Expected candidates before boundary");
      expect(
        beforeBoundary.artifact.rows.find(({ gameId }) => gameId === added.game.id)?.evaluation
          .winner,
      ).toBeNull();
      currentNow = "2026-09-27T11:01:00.000Z";
      const atBoundary = await app.attentionCandidateService.ensureFresh();
      expect(atBoundary.state).toBe("available");
      if (atBoundary.state !== "available") throw new Error("Expected candidates at boundary");
      expect(
        atBoundary.artifact.rows.find(({ gameId }) => gameId === added.game.id)?.evaluation.winner,
      ).not.toBeNull();
      await assertOracleParity();

      const beforeRead = {
        collection: await readFile(collectionPath, "utf8"),
        candidates: await readFile(candidatePath, "utf8"),
      };
      await app.profileService.getProfile();
      expect(await readFile(collectionPath, "utf8")).toBe(beforeRead.collection);
      expect(await readFile(candidatePath, "utf8")).toBe(beforeRead.candidates);
      expect(await fileOps.exists(profilePath)).toBe(true);

      currentNow = "2026-09-28T11:02:00.000Z";
      await writeFile(candidatePath, persistedBeforeClockAdvance, "utf8");
      const restarted = createTestApp({ fileOps, dataDir, configPath, now, bggClient });
      const afterDowntime = await restarted.attentionCandidateService.ensureFresh();
      expect(afterDowntime.state).toBe("available");
      if (afterDowntime.state !== "available")
        throw new Error("Expected restart candidate recovery");
      expect(afterDowntime.artifact.evaluatedAt).toBe(currentNow);
      expect(afterDowntime.artifact.rows).toHaveLength(2);
      expect(
        afterDowntime.artifact.rows.find(({ gameId }) => gameId === added.game.id)?.evaluation
          .winner,
      ).not.toBeNull();
      await assertOracleParity(restarted);

      await writeFile(candidatePath, '{"corrupt":true}', "utf8");
      const recoveredProcess = createTestApp({ fileOps, dataDir, configPath, now, bggClient });
      const repaired = await recoveredProcess.attentionCandidateService.ensureFresh();
      expect(repaired.state).toBe("available");
      if (repaired.state !== "available") throw new Error("Expected corrupt artifact rebuild");
      expect(repaired.artifact.rows).toHaveLength(2);
      expect(
        repaired.artifact.rows.find(({ gameId }) => gameId === added.game.id)?.evaluation.winner,
      ).not.toBeNull();
      expect(await readFile(candidatePath, "utf8")).not.toBe('{"corrupt":true}');
      await assertOracleParity(recoveredProcess);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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
      expect((await firstProcess.storageService.loadCollection()).schemaVersion).toBe(8);
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
      expect(warning.status).toBe("available");
      if (warning.status === "available")
        expect(warning.attention.cards.every(({ evidence }) => evidence.kind.length > 0)).toBe(
          true,
        );
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
          kind: "want-to-play",
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
          kind: "want-to-play",
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
          kind: "want-to-play",
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
        attentionCandidates: restartedProcess.attentionCandidateService,
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
        expect(migrated.schemaVersion).toBe(8);
        outputs.push(await readFile(collectionPath, "utf8"));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
    expect(outputs).toHaveLength(2);
    expect(outputs[1]).toBe(outputs[0]);
  });
});
