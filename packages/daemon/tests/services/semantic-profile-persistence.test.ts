import { afterEach, describe, expect, test } from "bun:test";
import type { Collection, DurableGame } from "@shelf-judge/shared";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BggClient } from "../../src/services/bgg-client.js";
import { createFileOps } from "../../src/services/file-ops.js";
import type { PrivateDisplayedFitnessService } from "../../src/services/displayed-fitness-service.js";
import {
  createJevPairCache,
  type JevPairJudgment,
} from "../../src/services/jev-pair-cache-service.js";
import { buildJevPairDependencies } from "../../src/services/jev-pair-identity.js";
import { JEV_JUDGMENT_CONTRACT } from "../../src/services/jev/jev-judgment-contract.js";
import { attentionCandidateStorageFor } from "../../src/services/attention-candidate-service.js";
import { createHydratedTestApp } from "../helpers/test-app.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function semanticRow(collection: Collection, a: DurableGame, b: DurableGame): JevPairJudgment {
  const source = (game: DurableGame) => ({
    gameId: game.id,
    name: game.name,
    description: game.bggData?.description ?? "",
  });
  return {
    collectionId: collection.id,
    gameAId: a.id,
    gameBId: b.id,
    signal: "C",
    dependencyKind: "C_ONLY",
    value: 0.65,
    confidence: 0.8,
    ...JEV_JUDGMENT_CONTRACT,
    completedAt: "2026-09-30T00:00:00.000Z",
    dependencies: buildJevPairDependencies("C_ONLY", source(a), source(b)),
  };
}

describe("semantic Profile persistence", () => {
  test("persists partial semantic candidate/Profile artifacts and reuses them on unchanged reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "semantic-profile-persistence-"));
    directories.push(root);
    const dataDir = join(root, "data");
    const configPath = join(root, "config.json");
    const cacheDir = join(root, "jev-cache");
    const fileOps = createFileOps();
    await fileOps.mkdir(dataDir);
    const bggClient: BggClient = {
      isConfigured: () => false,
      searchGames: () => Promise.resolve([]),
      getUserCollection: () => Promise.resolve([]),
      getPlayCount: () => Promise.reject(new Error("unexpected provider call")),
      getGame: () => Promise.reject(new Error("unexpected provider call")),
      getGames: () => Promise.resolve(new Map()),
    };
    let cache = await createJevPairCache(cacheDir);
    let app = await createHydratedTestApp({
      fileOps,
      dataDir,
      configPath,
      bggClient,
      jevPairCache: cache,
      now: () => "2026-09-30T12:00:00.000Z",
    });

    try {
      const games = [];
      for (const name of ["Semantic alpha", "Semantic beta", "Semantic gamma"]) {
        const added = await app.gameService.addGame({ name });
        games.push(added.game);
      }
      let collection = await app.storageService.loadCollection();
      collection.semanticRedundancy.settings.enabled = true;
      collection.semanticRedundancy.settings.weights = {
        factual: 0.5,
        description: 1,
        ownerNote: 0,
      };
      collection.semanticRedundancy.settings.cachedOwnerNoteUse = false;
      collection = {
        ...collection,
        games: collection.games.map((game, index) => ({
          ...game,
          ownerNote: {
            state: "present" as const,
            version: 1,
            updatedAt: "2026-01-01T00:00:00.000Z",
            text: `PRIVATE NOTE CANARY ${index}`,
          },
          bggData: {
            communityRating: 5,
            bayesAverage: 5,
            weight: null,
            numWeightVotes: 0,
            description: `SAFE DESCRIPTION ${index}`,
            mechanics: [],
            categories: [],
            families: [],
            subdomains: [],
            bestPlayerCount: null,
            fetchedAt: "2026-01-01T00:00:00.000Z",
          },
        })),
      };
      await app.storageService.saveCollection(collection);
      await app.storageService.saveRedundancySettings({
        ...(await app.storageService.loadRedundancySettings()),
        enabled: true,
      });
      await app.storageService.hydrateSourceVector?.();
      collection = await app.storageService.loadCollection();
      const [a, b, c] = collection.games;
      if (!a || !b || !c) throw new Error("Expected three fixture games");
      // One current C judgment over three pairs gives genuinely partial coverage.
      cache.upsert(semanticRow(collection, a, b));

      const candidates = attentionCandidateStorageFor(app.storageService);
      let proofFitnessCalls = 0;
      const privateFitness = app.displayedFitnessService as PrivateDisplayedFitnessService;
      const originalFitness = privateFitness.listGamesFromSnapshotWithProof.bind(privateFitness);
      privateFitness.listGamesFromSnapshotWithProof = (...args) => {
        proofFitnessCalls += 1;
        return originalFitness(...args);
      };
      const first = await app.profileService.getProfile();
      expect(first.status).toBe("available");
      const candidatePath = join(dataDir, "attention-candidates.json");
      const profilePath = join(dataDir, "profile.json");
      const candidateJson = await readFile(candidatePath, "utf8");
      const profileJson = await readFile(profilePath, "utf8");
      const candidate = await candidates.loadAttentionCandidates();
      expect(candidate).not.toBeNull();
      expect(cache.getActivation()).toBeNull();
      expect(candidate?.identity.semanticScoringInputProof).toMatchObject({
        version: 2,
        mode: "unified-similarity",
        algorithmVersion: "unified-jaccard-manhattan-jev-v1",
      });
      const persistedProfile = JSON.parse(profileJson) as {
        publicationIdentity: {
          attentionCandidates: {
            identity: { semanticScoringInputProof: { version?: number; mode?: string } };
          };
        };
      };
      expect(
        persistedProfile.publicationIdentity.attentionCandidates.identity.semanticScoringInputProof,
      ).toMatchObject({ version: 2, mode: "unified-similarity" });
      expect(candidateJson).not.toContain("SAFE DESCRIPTION");
      expect(profileJson).not.toContain("SAFE DESCRIPTION");
      expect(candidateJson).not.toContain("PRIVATE NOTE CANARY");
      expect(profileJson).not.toContain("PRIVATE NOTE CANARY");
      expect(profileJson).not.toContain("judgment");
      expect(candidateJson).not.toContain('"value":0.65');
      expect(proofFitnessCalls).toBeGreaterThan(0);

      let pairLookups = 0;
      const lookup = cache.lookup.bind(cache);
      cache.lookup = (input) => {
        pairLookups += 1;
        return lookup(input);
      };
      proofFitnessCalls = 0;
      const second = await app.profileService.getProfile();
      expect(second.status).toBe("available");
      expect(pairLookups).toBe(0);
      expect(proofFitnessCalls).toBe(0);
      expect(await readFile(candidatePath, "utf8")).toBe(candidateJson);
      expect(await readFile(profilePath, "utf8")).toBe(profileJson);

      cache.close();
      cache = await createJevPairCache(cacheDir);
      app = await createHydratedTestApp({
        fileOps,
        dataDir,
        configPath,
        bggClient,
        jevPairCache: cache,
        now: () => "2026-09-30T12:00:00.000Z",
      });
      let restartPairLookups = 0;
      const restartLookup = cache.lookup.bind(cache);
      cache.lookup = (input) => {
        restartPairLookups += 1;
        return restartLookup(input);
      };
      const restarted = await app.profileService.getProfile();
      expect(restarted.status).toBe("available");
      expect(restartPairLookups).toBe(3);
      expect(await readFile(candidatePath, "utf8")).toBe(candidateJson);
      expect(await readFile(profilePath, "utf8")).toBe(profileJson);

      const semanticJson = await readFile(profilePath, "utf8");
      const changedJudgment = semanticRow(collection, a, b);
      changedJudgment.value = 0.8;
      cache.upsert(changedJudgment);
      const judgmentChanged = await app.profileService.getProfile();
      expect(judgmentChanged.status).toBe("available");
      const afterJudgmentChange = await readFile(profilePath, "utf8");
      expect(afterJudgmentChange).not.toBe(semanticJson);
      const afterJudgmentCandidate = await readFile(candidatePath, "utf8");
      expect(afterJudgmentCandidate).not.toBe(candidateJson);

      cache.purgePair(a.id, b.id, "C");
      const invalidated = await app.profileService.getProfile();
      expect(invalidated.status).toBe("available");
      const afterPurge = await readFile(profilePath, "utf8");
      expect(afterPurge).not.toBe(afterJudgmentChange);

      cache.upsert(semanticRow(collection, a, b));
      await app.profileService.getProfile();
      const beforeReset = await readFile(profilePath, "utf8");
      cache.reset();
      const resetRead = await app.profileService.getProfile();
      expect(resetRead.status).toBe("available");
      expect(await readFile(profilePath, "utf8")).not.toBe(beforeReset);

      // A weights-only source change invalidates derived JSON while retaining the C judgment.
      cache.upsert(semanticRow(collection, a, b));
      await app.profileService.getProfile();
      const beforeWeights = await readFile(profilePath, "utf8");
      collection = await app.storageService.loadCollection();
      collection.semanticRedundancy.settings.weights.factual = 0.6;
      await app.storageService.saveCollection(collection);
      await app.storageService.hydrateSourceVector?.();
      const weightRead = await app.profileService.getProfile();
      expect(weightRead.status).toBe("available");
      expect(await readFile(profilePath, "utf8")).not.toBe(beforeWeights);
      expect(cache.lookup({ gameAId: a.id, gameBId: b.id, signal: "C" })?.value).toBe(0.65);

      // A newly created empty DB must not accept the prior semantic proof or artifacts.
      cache.close();
      await rm(cacheDir, { recursive: true, force: true });
      cache = await createJevPairCache(cacheDir);
      app = await createHydratedTestApp({
        fileOps,
        dataDir,
        configPath,
        bggClient,
        jevPairCache: cache,
        now: () => "2026-09-30T12:00:00.000Z",
      });
      const beforeEmptyDb = await readFile(profilePath, "utf8");
      const emptyDbRead = await app.profileService.getProfile();
      expect(emptyDbRead.status).toBe("available");
      expect(await readFile(profilePath, "utf8")).not.toBe(beforeEmptyDb);
      expect(cache.lookup({ gameAId: a.id, gameBId: b.id, signal: "C" })).toBeNull();

      // Persist a semantic artifact, then prove a closed handle does not reuse its
      // cache-derived proof; coherent factual scoring remains available.
      cache.upsert(semanticRow(collection, a, b));
      await app.profileService.getProfile();
      const beforeClosed = await readFile(profilePath, "utf8");
      cache.close();
      const closedRead = await app.profileService.getProfile();
      expect(closedRead.status).toBe("available");
      const afterClosed = await readFile(profilePath, "utf8");
      expect(afterClosed).not.toBe(beforeClosed);
      expect(afterClosed).not.toContain('"value":0.65');

      // A cache that cannot open must likewise avoid old semantic artifacts while
      // permitting the same coherent factual-only projection.
      const blockedPath = join(root, "cache-is-a-file");
      await Bun.write(blockedPath, "not a directory");
      cache = await createJevPairCache(blockedPath);
      expect(cache.available).toBe(false);
      app = await createHydratedTestApp({
        fileOps,
        dataDir,
        configPath,
        bggClient,
        jevPairCache: cache,
        now: () => "2026-09-30T12:00:00.000Z",
      });
      const beforeUnavailable = await readFile(profilePath, "utf8");
      const unavailableRead = await app.profileService.getProfile();
      expect(unavailableRead.status).toBe("available");
      expect(await readFile(profilePath, "utf8")).toBe(beforeUnavailable);
    } finally {
      cache.close();
    }
  });
});
