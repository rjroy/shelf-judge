/* eslint-disable @typescript-eslint/await-thenable */
import { describe, expect, test } from "bun:test";
import { createInitialEntityMetadata, type DurableGame } from "@shelf-judge/shared";
import {
  DurableSourcePostCommitError,
  type StorageService,
} from "../../src/services/storage-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import {
  canonicalSha256,
  profileSourceCoordinatorFor,
} from "../../src/services/profile-source-coordinator.js";
import { createShelfService } from "../../src/services/shelf-service.js";
import {
  createSourceVectorService,
  semanticGenerationSourceIdentity,
} from "../../src/services/source-vector.js";

const DATA_DIR = "/source-vector/data";
const CONFIG_PATH = "/source-vector/config.json";
const paths = {
  tournament: `${DATA_DIR}/tournament.json`,
  prediction: `${DATA_DIR}/prediction-settings.json`,
  niche: `${DATA_DIR}/niche-settings.json`,
  redundancy: `${DATA_DIR}/redundancy-settings.json`,
  shelf: `${DATA_DIR}/shelf-config.json`,
};

function persisted(
  fileOps: ReturnType<typeof createMockFileOps>,
  filePath: string,
): Record<string, unknown> {
  const value: unknown = JSON.parse(fileOps.files.get(filePath) ?? "null");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected persisted object at ${filePath}`);
  }
  return value as Record<string, unknown>;
}

function serviceWith(fileOps = createMockFileOps()) {
  return {
    fileOps,
    service: createStorageService({ dataDir: DATA_DIR, configPath: CONFIG_PATH, fileOps }),
  };
}

function assignedGame(shelfId: string): DurableGame {
  return {
    id: "game-1",
    bggId: null,
    entityMetadata: createInitialEntityMetadata(null),
    name: "Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    latestPlayCountCheck: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    ownership: "owned",
    boxDimensions: { width: 10, height: 10, depth: 2 },
    manualShelfId: shelfId,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    ratings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function hydrate(service: StorageService) {
  const vector = await service.hydrateSourceVector?.();
  if (!vector) throw new Error("Source vector is not available");
  return vector;
}

describe("storage source revisions", () => {
  test("persists legacy redundancy weight migration and reloads factual weights after restart", async () => {
    const fileOps = createMockFileOps();
    fileOps.files.set(
      paths.redundancy,
      JSON.stringify({
        enabled: true,
        stage: "integrated",
        similarityThreshold: 0.6,
        maxPenalty: 2,
        componentWeights: { binary: 0, continuous: 0, personalAxes: 1 },
        minNeighbors: 1,
        expectedNeighbors: 5,
        revision: 12,
      }),
    );
    const first = createStorageService({ dataDir: DATA_DIR, configPath: CONFIG_PATH, fileOps });
    const firstRead = await first.loadRedundancySettingsRead?.();
    expect(firstRead?.settings.componentWeights).toEqual({ binary: 4 / 7, continuous: 3 / 7 });
    expect(firstRead?.settings.stage).toBe("integrated");
    expect(firstRead?.migrationNotice).toContain("migrated");
    expect(persisted(fileOps, paths.redundancy)).toMatchObject({
      revision: 13,
      componentWeights: { binary: 4 / 7, continuous: 3 / 7 },
    });
    expect(persisted(fileOps, paths.redundancy).componentWeights).not.toHaveProperty(
      "personalAxes",
    );

    const restarted = createStorageService({ dataDir: DATA_DIR, configPath: CONFIG_PATH, fileOps });
    const secondRead = await restarted.loadRedundancySettingsRead?.();
    expect(secondRead?.settings.componentWeights).toEqual({ binary: 4 / 7, continuous: 3 / 7 });
    expect(secondRead?.migrationNotice).toBeNull();
  });

  test("degraded vector tokens track hidden identity changes and recovery", () => {
    const vector = createSourceVectorService();
    vector.hydrate(
      { id: "collection-1", schemaVersion: 9, revision: 0 },
      {
        tournament: 0,
        predictionSettings: 0,
        nicheSettings: 0,
        redundancySettings: 0,
        shelfConfig: 0,
      },
    );
    vector.markUnavailable("prediction-settings");
    const degraded = vector.read();
    expect(degraded.available).toBe(false);
    expect(degraded.collectionRevision).toBeNull();

    vector.publishCollection({ id: "collection-1", schemaVersion: 9, revision: 1 });
    const afterCollectionCommit = vector.read();
    expect(afterCollectionCommit.available).toBe(false);
    expect(afterCollectionCommit.collectionRevision).toBeNull();
    expect(afterCollectionCommit.changeToken).toBeGreaterThan(degraded.changeToken);
    expect(afterCollectionCommit.changeToken).not.toBe(degraded.changeToken);

    vector.publish("niche-settings", 1);
    const afterIndependentCommit = vector.read();
    expect(afterIndependentCommit.changeToken).toBe(afterCollectionCommit.changeToken + 1);
    vector.publish("niche-settings", 1);
    expect(vector.read().changeToken).toBe(afterIndependentCommit.changeToken);

    vector.publish("prediction-settings", 0);
    const recovered = vector.read();
    expect(recovered.available).toBe(true);
    expect(recovered.changeToken).toBe(afterIndependentCommit.changeToken + 1);
    expect(recovered.collectionRevision).toBe(1);
    expect(recovered.nicheSettingsRevision).toBe(1);
    vector.publish("prediction-settings", 0);
    expect(vector.read().changeToken).toBe(recovered.changeToken);
  });

  test("creates missing sources at revision zero and hydrates an IO-free vector", async () => {
    const { service, fileOps } = serviceWith();
    const vector = await hydrate(service);
    expect(vector).toMatchObject({
      available: true,
      collectionRevision: 0,
      tournamentRevision: 0,
      predictionSettingsRevision: 0,
      nicheSettingsRevision: 0,
      redundancySettingsRevision: 0,
      shelfConfigRevision: 0,
    });
    for (const filePath of Object.values(paths)) {
      expect(persisted(fileOps, filePath).revision).toBe(0);
    }
    const callsAfterHydration = fileOps.calls.length;
    expect(service.sourceVector?.()).toEqual(vector);
    expect(fileOps.calls).toHaveLength(callsAfterHydration);
  });

  test("semantic source identity excludes collection write revision and includes independent scoring revisions", async () => {
    const { service } = serviceWith();
    const initialVector = await hydrate(service);
    const initial = semanticGenerationSourceIdentity(initialVector);
    if (initial === null)
      throw new Error("Expected complete semantic identity after source hydration");
    expect(initial).toMatchObject({
      evidenceEpoch: 0,
      consentEpoch: 0,
      factualWeightsEpoch: 0,
      fencedFactualWeightsFingerprint: null,
      currentFactualWeightsFingerprint: canonicalSha256({ binary: 4 / 7, continuous: 3 / 7 }),
      tournamentRevision: 0,
      predictionSettingsRevision: 0,
    });

    const collection = await service.loadCollection();
    collection.revision += 1;
    await service.saveCollection(collection);
    expect(semanticGenerationSourceIdentity(service.sourceVector!())).toEqual(initial);

    const redundancySettings = await service.loadRedundancySettings();
    redundancySettings.stage = "integrated";
    await service.saveRedundancySettings(redundancySettings);
    expect(service.sourceVector!().redundancySettingsRevision).toBe(1);
    expect(semanticGenerationSourceIdentity(service.sourceVector!())).toEqual(initial);

    const changedWeights = await service.loadRedundancySettings();
    changedWeights.componentWeights = { binary: 0.8, continuous: 3 / 7 };
    await service.saveRedundancySettings(changedWeights);
    const afterWeightSourceEdit = semanticGenerationSourceIdentity(service.sourceVector!());
    expect(afterWeightSourceEdit?.factualWeightsEpoch).toBe(0);
    expect(afterWeightSourceEdit?.currentFactualWeightsFingerprint).not.toBe(
      initial.currentFactualWeightsFingerprint,
    );

    const tournament = await service.loadTournament();
    tournament.settings.kFactorThreshold += 1;
    await service.saveTournament(tournament);
    const afterTournament = semanticGenerationSourceIdentity(service.sourceVector!());
    expect(afterTournament?.tournamentRevision).toBe(1);
    expect(afterTournament).not.toEqual(afterWeightSourceEdit);

    const prediction = await service.loadPredictionSettings();
    prediction.defaultK += 1;
    await service.savePredictionSettings(prediction);
    const afterPrediction = semanticGenerationSourceIdentity(service.sourceVector!());
    expect(afterPrediction?.tournamentRevision).toBe(1);
    expect(afterPrediction?.predictionSettingsRevision).toBe(1);
    expect(afterPrediction).not.toEqual(afterTournament);
  });

  test("factual weight A to B to A remains fenced after storage restart", async () => {
    const fileOps = createMockFileOps();
    const first = serviceWith(fileOps).service;
    const initialVector = await hydrate(first);
    const initial = semanticGenerationSourceIdentity(initialVector);
    if (!initial) throw new Error("Expected semantic source identity");

    const settingsB = await first.loadRedundancySettings();
    settingsB.componentWeights = { binary: 0.8, continuous: 3 / 7 };
    await first.saveRedundancySettings(settingsB);
    const fingerprintB = canonicalSha256(settingsB.componentWeights);
    const toB = await first.loadCollection();
    toB.revision += 1;
    toB.semanticRedundancy.factualWeightsEpoch = 1;
    toB.semanticRedundancy.factualWeightsFingerprint = fingerprintB;
    await first.saveCollection(toB);

    const afterRestart = serviceWith(fileOps).service;
    const bIdentity = semanticGenerationSourceIdentity(await hydrate(afterRestart));
    expect(bIdentity?.factualWeightsEpoch).toBe(1);
    expect(bIdentity?.fencedFactualWeightsFingerprint).toBe(fingerprintB);
    expect(bIdentity?.currentFactualWeightsFingerprint).toBe(fingerprintB);

    const settingsA = await afterRestart.loadRedundancySettings();
    settingsA.componentWeights = { binary: 4 / 7, continuous: 3 / 7 };
    await afterRestart.saveRedundancySettings(settingsA);
    const toA = await afterRestart.loadCollection();
    toA.revision += 1;
    toA.semanticRedundancy.factualWeightsEpoch = 2;
    toA.semanticRedundancy.factualWeightsFingerprint = canonicalSha256({
      binary: 4 / 7,
      continuous: 3 / 7,
    });
    await afterRestart.saveCollection(toA);
    const finalService = serviceWith(fileOps).service;
    const aIdentity = semanticGenerationSourceIdentity(await hydrate(finalService));
    expect(aIdentity?.fencedFactualWeightsFingerprint).toBe(
      canonicalSha256({ binary: 4 / 7, continuous: 3 / 7 }),
    );
    expect(aIdentity?.factualWeightsEpoch).toBe(2);
    expect(aIdentity).not.toEqual(initial);
  });

  test("migrates legacy tournament, prediction, and shelf formats to revision zero", async () => {
    const { service, fileOps } = serviceWith(
      createMockFileOps({
        [paths.tournament]: JSON.stringify({
          settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
          sessions: [],
          comparisons: [],
          gameStats: {},
        }),
        [paths.prediction]: JSON.stringify({
          stageThresholds: [5, 15, 30],
          defaultK: 5,
          minSimilarityThreshold: 0.2,
          tournamentStabilityBoost: 0.5,
        }),
        [paths.shelf]: JSON.stringify({
          units: [
            {
              id: "unit",
              name: "Unit",
              shelves: [{ id: "shelf", name: "Shelf", width: 1, height: 2, depth: 3 }],
            },
          ],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      }),
    );
    await hydrate(service);
    expect(persisted(fileOps, paths.tournament)).toMatchObject({
      revision: 0,
      gameStats: {},
      sessions: [],
    });
    expect(persisted(fileOps, paths.prediction)).toMatchObject({
      revision: 0,
      defaultK: 5,
    });
    expect(persisted(fileOps, paths.prediction)).not.toHaveProperty("tournamentStabilityBoost");
    const shelf = persisted(fileOps, paths.shelf);
    expect(shelf.revision).toBe(0);
    const units = shelf.units;
    if (!Array.isArray(units) || typeof units[0] !== "object" || units[0] === null) {
      throw new Error("Expected migrated shelf unit");
    }
    const shelves = (units[0] as Record<string, unknown>).shelves;
    if (!Array.isArray(shelves) || typeof shelves[0] !== "object" || shelves[0] === null) {
      throw new Error("Expected migrated shelf");
    }
    expect((shelves[0] as Record<string, unknown>).dimensionless).toBe(false);
  });

  test("each source save preserves revision on no-op and advances it on change", async () => {
    const { service, fileOps } = serviceWith();
    await hydrate(service);
    await service.saveTournament(await service.loadTournament());
    await service.savePredictionSettings(await service.loadPredictionSettings());
    await service.saveNicheSettings(await service.loadNicheSettings());
    await service.saveRedundancySettings(await service.loadRedundancySettings());
    await service.saveShelfConfig(await service.loadShelfConfig());
    for (const filePath of Object.values(paths)) {
      expect(persisted(fileOps, filePath).revision).toBe(0);
    }

    const tournament = await service.loadTournament();
    tournament.settings.kFactorThreshold += 1;
    await service.saveTournament(tournament);
    const prediction = await service.loadPredictionSettings();
    prediction.defaultK += 1;
    await service.savePredictionSettings(prediction);
    const niche = await service.loadNicheSettings();
    niche.ignoredTags.push({ type: "mechanic", name: "Drafting" });
    await service.saveNicheSettings(niche);
    const redundancy = await service.loadRedundancySettings();
    redundancy.enabled = true;
    await service.saveRedundancySettings(redundancy);
    const shelf = await service.loadShelfConfig();
    shelf.updatedAt = "2026-09-27T00:00:00.000Z";
    await service.saveShelfConfig(shelf);

    for (const filePath of Object.values(paths)) {
      expect(persisted(fileOps, filePath).revision).toBe(1);
    }
    expect(service.sourceVector?.()).toMatchObject({
      available: true,
      tournamentRevision: 1,
      predictionSettingsRevision: 1,
      nicheSettingsRevision: 1,
      redundancySettingsRevision: 1,
      shelfConfigRevision: 1,
    });
  });

  test("failed writes for each source mark the vector unavailable", async () => {
    const cases: Array<{
      filePath: string;
      sourceName: string;
      mutate: (service: StorageService) => Promise<void>;
    }> = [
      {
        filePath: paths.tournament,
        sourceName: "tournament",
        mutate: async (service) => {
          const data = await service.loadTournament();
          data.settings.kFactorThreshold += 1;
          await service.saveTournament(data);
        },
      },
      {
        filePath: paths.prediction,
        sourceName: "prediction-settings",
        mutate: async (service) => {
          const data = await service.loadPredictionSettings();
          data.defaultK += 1;
          await service.savePredictionSettings(data);
        },
      },
      {
        filePath: paths.niche,
        sourceName: "niche-settings",
        mutate: async (service) => {
          const data = await service.loadNicheSettings();
          data.ignoredTags.push({ type: "category", name: "Economic" });
          await service.saveNicheSettings(data);
        },
      },
      {
        filePath: paths.redundancy,
        sourceName: "redundancy-settings",
        mutate: async (service) => {
          const data = await service.loadRedundancySettings();
          data.enabled = true;
          await service.saveRedundancySettings(data);
        },
      },
      {
        filePath: paths.shelf,
        sourceName: "shelf-config",
        mutate: async (service) => {
          const data = await service.loadShelfConfig();
          data.updatedAt = "2026-09-27T00:00:00.000Z";
          await service.saveShelfConfig(data);
        },
      },
    ];
    for (const { filePath, sourceName, mutate } of cases) {
      const { service, fileOps } = serviceWith();
      await hydrate(service);
      const originalRename = fileOps.rename.bind(fileOps);
      fileOps.rename = async (from, to) => {
        if (to === filePath) throw new Error("write failure");
        return originalRename(from, to);
      };
      const failedWrite = mutate(service);
      let failure: unknown;
      try {
        await failedWrite;
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(failure instanceof Error ? failure.message : "").toBe("write failure");
      expect(service.sourceVector?.()).toMatchObject({
        available: false,
        unavailableSources: [sourceName],
      });
      fileOps.rename = originalRename;
      await mutate(service);
      expect(service.sourceVector?.()).toMatchObject({ available: true });
    }
  });

  test("each source read failure recovers availability after authoritative file repair", async () => {
    const cases: Array<{
      filePath: string;
      load: (service: StorageService) => Promise<unknown>;
      saveChange: (service: StorageService) => Promise<void>;
    }> = [
      {
        filePath: paths.tournament,
        load: (service) => service.loadTournament(),
        saveChange: async (service) => {
          const data = await service.loadTournament();
          data.settings.kFactorThreshold += 1;
          await service.saveTournament(data);
        },
      },
      {
        filePath: paths.prediction,
        load: (service) => service.loadPredictionSettings(),
        saveChange: async (service) => {
          const data = await service.loadPredictionSettings();
          data.defaultK += 1;
          await service.savePredictionSettings(data);
        },
      },
      {
        filePath: paths.niche,
        load: (service) => service.loadNicheSettings(),
        saveChange: async (service) => {
          const data = await service.loadNicheSettings();
          data.ignoredTags.push({ type: "category", name: "Economic" });
          await service.saveNicheSettings(data);
        },
      },
      {
        filePath: paths.redundancy,
        load: (service) => service.loadRedundancySettings(),
        saveChange: async (service) => {
          const data = await service.loadRedundancySettings();
          data.enabled = true;
          await service.saveRedundancySettings(data);
        },
      },
      {
        filePath: paths.shelf,
        load: (service) => service.loadShelfConfig(),
        saveChange: async (service) => {
          const data = await service.loadShelfConfig();
          data.updatedAt = "2026-09-27T00:00:00.000Z";
          await service.saveShelfConfig(data);
        },
      },
    ];
    for (const { filePath, load, saveChange } of cases) {
      const { service, fileOps } = serviceWith();
      await hydrate(service);
      const originalRename = fileOps.rename.bind(fileOps);
      fileOps.rename = async (from, to) => {
        if (to === filePath) throw new Error("source write failure");
        return originalRename(from, to);
      };
      await expect(saveChange(service)).rejects.toThrow("source write failure");
      fileOps.rename = originalRename;
      const originalReadFile = fileOps.readFile.bind(fileOps);
      fileOps.readFile = async (readPath) => {
        if (readPath === filePath) throw new Error("source read failure");
        return originalReadFile(readPath);
      };
      await expect(load(service)).rejects.toThrow();
      expect(service.sourceVector?.()).toMatchObject({ available: false });

      fileOps.readFile = originalReadFile;
      await load(service);
      expect(service.sourceVector?.()).toMatchObject({ available: true });
    }
  });

  test("startup hydration repairs a failed source read after the file is corrected", async () => {
    const { service, fileOps } = serviceWith(createMockFileOps({ [paths.shelf]: "{" }));
    let failure: unknown;
    try {
      await service.loadShelfConfig();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(service.sourceVector?.()).toMatchObject({ available: false });

    fileOps.files.set(
      paths.shelf,
      JSON.stringify({
        units: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        revision: 4,
      }),
    );
    const hydrated = await hydrate(service);
    expect(hydrated).toMatchObject({ available: true, shelfConfigRevision: 4 });
  });

  test("collection persistence failures invalidate the vector until an authoritative reload", async () => {
    const { service, fileOps } = serviceWith();
    await hydrate(service);
    const initial = await service.loadCollection();
    const originalRename = fileOps.rename.bind(fileOps);
    const preCommit = { ...initial, name: "Pre-commit failure" };
    fileOps.rename = async (from, to) => {
      if (to === `${DATA_DIR}/collection.json`) throw new Error("pre-commit failure");
      return originalRename(from, to);
    };
    let failure: unknown;
    try {
      await service.saveCollection(preCommit);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(service.sourceVector?.()).toMatchObject({ available: false });
    fileOps.rename = originalRename;
    expect((await service.loadCollection()).name).toBe(initial.name);
    expect(service.sourceVector?.()).toMatchObject({
      available: true,
      collectionRevision: initial.revision,
    });

    const postCommit = { ...initial, name: "Post-commit rejection" };
    fileOps.rename = async (from, to) => {
      await originalRename(from, to);
      if (to === `${DATA_DIR}/collection.json`) throw new Error("post-commit rejection");
    };
    failure = undefined;
    try {
      await service.saveCollection(postCommit);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(service.sourceVector?.()).toMatchObject({ available: false });
    fileOps.rename = originalRename;
    expect((await service.loadCollection()).name).toBe(postCommit.name);
    expect(service.sourceVector?.()).toMatchObject({
      available: true,
      collectionRevision: initial.revision,
    });
  });

  test("repeated collection reads and no-op saves do not advance the vector token", async () => {
    const { service } = serviceWith();
    await hydrate(service);
    const initial = service.sourceVector?.();
    if (!initial) throw new Error("Expected source vector");
    await hydrate(service);
    const collection = await service.loadCollection();
    await service.loadCollection();
    await service.saveCollection(collection);
    const final = service.sourceVector?.();
    expect(final?.changeToken).toBe(initial.changeToken);
    expect(final?.collectionRevision).toBe(collection.revision);
  });

  test("publishes a committed revision before a secondary profile invalidation failure", async () => {
    const fileOps = createMockFileOps({ ["/source-vector/data/profile.json"]: "cached" });
    const { service } = serviceWith(fileOps);
    await hydrate(service);
    fileOps.unlink = (filePath) => {
      fileOps.calls.push({ method: "unlink", args: [filePath] });
      if (filePath.endsWith("profile.json"))
        return Promise.reject(new Error("invalidation failure"));
      fileOps.files.delete(filePath);
      return Promise.resolve();
    };
    const settings = await service.loadPredictionSettings();
    settings.defaultK += 1;
    let invalidationFailure: unknown;
    try {
      await service.savePredictionSettings(settings);
    } catch (error) {
      invalidationFailure = error;
    }
    expect(invalidationFailure instanceof Error ? invalidationFailure.message : "").toBe(
      "invalidation failure",
    );
    expect(persisted(fileOps, paths.prediction).revision).toBe(1);
    expect(service.sourceVector?.()).toMatchObject({
      available: true,
      predictionSettingsRevision: 1,
    });
  });

  test("identifies redundancy profile invalidation failure as post-commit", async () => {
    const fileOps = createMockFileOps({ ["/source-vector/data/profile.json"]: "cached" });
    const { service } = serviceWith(fileOps);
    await hydrate(service);
    fileOps.unlink = (filePath) => {
      fileOps.calls.push({ method: "unlink", args: [filePath] });
      if (filePath.endsWith("profile.json"))
        return Promise.reject(new Error("invalidation failure"));
      fileOps.files.delete(filePath);
      return Promise.resolve();
    };
    const settings = await service.loadRedundancySettings();
    settings.similarityThreshold = 0.7;
    let failure: unknown;
    try {
      await service.saveRedundancySettings(settings);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DurableSourcePostCommitError);
    expect((failure as DurableSourcePostCommitError).durable).toBe(true);
    expect(persisted(fileOps, paths.redundancy).revision).toBe(1);
    expect(service.sourceVector?.()).toMatchObject({
      available: true,
      redundancySettingsRevision: 1,
    });
  });

  test("restoring a shelf config after a committed change advances revision again", async () => {
    const { service, fileOps } = serviceWith();
    await hydrate(service);
    const previous = await service.loadShelfConfig();
    const changed = { ...previous, updatedAt: "2026-09-27T00:00:00.000Z" };
    await service.saveShelfConfig(changed);
    await service.saveShelfConfig(previous);
    expect(persisted(fileOps, paths.shelf).revision).toBe(2);
    expect(service.sourceVector?.()).toMatchObject({ available: true, shelfConfigRevision: 2 });
  });

  test("real shelf compensation advances durable revision twice and republishes collection identity", async () => {
    for (const outcome of ["pre-commit", "post-commit"] as const) {
      const initialShelf = {
        units: [
          {
            id: "unit-1",
            name: "Unit",
            shelves: [
              {
                id: "shelf-1",
                name: "Shelf",
                dimensionless: false,
                width: 20,
                height: 20,
                depth: 20,
              },
            ],
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        revision: 0,
      };
      const { service, fileOps } = serviceWith(
        createMockFileOps({ [paths.shelf]: JSON.stringify(initialShelf) }),
      );
      const collection = await service.loadCollection();
      collection.games.push(assignedGame("shelf-1"));
      await service.saveCollection(collection);
      await hydrate(service);
      const shelfService = createShelfService({ storageService: service });
      const originalRename = fileOps.rename.bind(fileOps);
      let failedCollectionWrite = false;
      fileOps.rename = async (from, to) => {
        if (to === `${DATA_DIR}/collection.json` && !failedCollectionWrite) {
          failedCollectionWrite = true;
          if (outcome === "post-commit") await originalRename(from, to);
          throw new Error(`${outcome} collection failure`);
        }
        return originalRename(from, to);
      };

      await expect(shelfService.setConfig([])).rejects.toThrow(`${outcome} collection failure`);
      fileOps.rename = originalRename;

      const durableShelf = persisted(fileOps, paths.shelf);
      expect(durableShelf.revision).toBe(2);
      expect(durableShelf.units).toEqual(initialShelf.units);
      expect(service.sourceVector?.()).toMatchObject({
        available: true,
        collectionRevision: outcome === "pre-commit" ? 0 : 1,
        shelfConfigRevision: 2,
      });
      const durableCollection = await service.loadCollection();
      expect(durableCollection.revision).toBe(outcome === "pre-commit" ? 0 : 1);
      expect(durableCollection.games[0]?.manualShelfId).toBe(
        outcome === "pre-commit" ? "shelf-1" : null,
      );
      expect(service.sourceVector?.()).toMatchObject({
        available: true,
        collectionRevision: durableCollection.revision,
        shelfConfigRevision: 2,
      });
    }
  });

  test("restarts with a new epoch and hydrates persisted revisions", async () => {
    const { service, fileOps } = serviceWith();
    await hydrate(service);
    const settings = await service.loadPredictionSettings();
    settings.defaultK += 1;
    await service.savePredictionSettings(settings);
    const first = service.sourceVector?.();
    const restarted = serviceWith(fileOps).service;
    const second = await hydrate(restarted);
    expect(second.processEpoch).not.toBe(first?.processEpoch);
    expect(second.predictionSettingsRevision).toBe(1);
    expect(second.available).toBe(true);
  });

  test("coherent source capture waits for an in-flight source commit", async () => {
    const { service, fileOps } = serviceWith();
    await hydrate(service);
    let releaseCommit: (() => void) | undefined;
    let signalRename: (() => void) | undefined;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const renameStarted = new Promise<void>((resolve) => {
      signalRename = resolve;
    });
    const originalRename = fileOps.rename.bind(fileOps);
    fileOps.rename = async (from, to) => {
      if (to === paths.prediction) {
        signalRename?.();
        await commitGate;
      }
      return originalRename(from, to);
    };

    const updated = await service.loadPredictionSettings();
    updated.defaultK += 1;
    const write = service.savePredictionSettings(updated);
    await renameStarted;
    let captured = false;
    const capture = profileSourceCoordinatorFor(service).runExclusive(async () => {
      const [
        collection,
        tournament,
        predictionSettings,
        nicheSettings,
        redundancySettings,
        shelfConfig,
      ] = await Promise.all([
        service.loadCollection(),
        service.loadTournament(),
        service.loadPredictionSettings(),
        service.loadNicheSettings(),
        service.loadRedundancySettings(),
        service.loadShelfConfig(),
      ]);
      captured = true;
      return {
        collection,
        tournament,
        predictionSettings,
        nicheSettings,
        redundancySettings,
        shelfConfig,
      };
    });
    await Promise.resolve();
    expect(captured).toBe(false);
    releaseCommit?.();
    await write;
    const sources = await capture;
    expect(captured).toBe(true);
    expect(sources.predictionSettings.defaultK).toBe(updated.defaultK);
  });

  test("an old collection read cannot publish after a newer serialized commit", async () => {
    const { service, fileOps } = serviceWith();
    await hydrate(service);
    const initial = await service.loadCollection();
    let releaseRead: (() => void) | undefined;
    let signalRead: (() => void) | undefined;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readStarted = new Promise<void>((resolve) => {
      signalRead = resolve;
    });
    const originalReadFile = fileOps.readFile.bind(fileOps);
    let shouldBlock = true;
    fileOps.readFile = async (filePath) => {
      if (filePath === `${DATA_DIR}/collection.json` && shouldBlock) {
        shouldBlock = false;
        signalRead?.();
        await readGate;
      }
      return originalReadFile(filePath);
    };

    const oldRead = service.loadCollection();
    await readStarted;
    const changed = { ...initial, name: "Newer committed collection" };
    const save = service.saveCollection(changed);
    await Promise.resolve();
    expect(fileOps.files.get(`${DATA_DIR}/collection.json`)).not.toContain(changed.name);

    releaseRead?.();
    await oldRead;
    await save;
    expect(service.sourceVector?.()).toMatchObject({
      available: true,
      collectionRevision: changed.revision,
    });
    expect((await service.loadCollection()).name).toBe(changed.name);
  });

  test("source read failure stays unavailable instead of substituting defaults", async () => {
    const { service, fileOps } = serviceWith(createMockFileOps({ [paths.shelf]: "{" }));
    let readFailure: unknown;
    try {
      await service.loadShelfConfig();
    } catch (error) {
      readFailure = error;
    }
    expect(readFailure).toBeInstanceOf(Error);
    expect(service.sourceVector?.()).toMatchObject({
      available: false,
      unavailableSources: ["shelf-config", "startup"],
    });
    expect(fileOps.files.get(paths.shelf)).toBe("{");
  });

  test("standalone shelf load keeps the empty fallback but strict hydration rejects it", async () => {
    const invalid = JSON.stringify({ units: "invalid", createdAt: "now", updatedAt: "now" });
    const { service, fileOps } = serviceWith(createMockFileOps({ [paths.shelf]: invalid }));

    expect(await service.loadShelfConfig()).toMatchObject({ units: [] });
    expect(service.sourceVector?.()).toMatchObject({
      available: false,
      unavailableSources: ["shelf-config", "startup"],
      shelfConfigRevision: null,
    });
    let hydrationFailure: unknown;
    try {
      await service.hydrateSourceVector?.();
    } catch (error) {
      hydrationFailure = error;
    }
    expect(hydrationFailure).toBeInstanceOf(Error);
    expect(service.sourceVector?.()).toMatchObject({
      available: false,
      shelfConfigRevision: null,
    });
    expect(fileOps.files.get(paths.shelf)).toBe(invalid);
  });

  test("failed versioned normalization write leaves the prior shelf file and vector uncertified", async () => {
    const versionedLegacy = {
      units: [
        {
          id: "unit",
          name: "Unit",
          shelves: [{ id: "shelf", name: "Shelf", width: 1, height: 2, depth: 3 }],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      revision: 7,
    };
    const { service, fileOps } = serviceWith(
      createMockFileOps({ [paths.shelf]: JSON.stringify(versionedLegacy) }),
    );
    const originalRename = fileOps.rename.bind(fileOps);
    fileOps.rename = async (from, to) => {
      if (to === paths.shelf) throw new Error("normalization write failure");
      return originalRename(from, to);
    };
    let normalizationFailure: unknown;
    try {
      await service.loadShelfConfig();
    } catch (error) {
      normalizationFailure = error;
    }
    expect(normalizationFailure).toBeInstanceOf(Error);
    expect(persisted(fileOps, paths.shelf)).toEqual(versionedLegacy);
    expect(service.sourceVector?.()).toMatchObject({ available: false });

    fileOps.rename = originalRename;
    const repaired = await service.loadShelfConfig();
    expect(repaired.units[0]?.shelves[0]?.dimensionless).toBe(false);
    expect(persisted(fileOps, paths.shelf).revision).toBe(8);
    const persistedState = service.sourceVector?.();
    expect(persistedState?.unavailableSources).not.toContain("shelf-config");
  });
});
