import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  Collection,
  GameWithScore,
  PredictionSettings,
  RedundancySettings,
  TournamentData,
} from "@shelf-judge/shared";
import { createInitialSemanticRedundancyStateV10 } from "@shelf-judge/shared";
import {
  createJevRunSourceAdapter,
  JevRunSourceUnavailableError,
  type JevRunSourceStorage,
} from "../../src/services/jev-run-source-adapter.js";
import {
  canonicalSha256,
  profileSourceCoordinatorFor,
} from "../../src/services/profile-source-coordinator.js";
import type { SourceVector } from "../../src/services/source-vector.js";
import type { JevRunSnapshotPredictionService } from "../../src/services/jev-run-source-adapter.js";
import { createFileOps } from "../../src/services/file-ops.js";
import { createStorageService } from "../../src/services/storage-service.js";

interface State {
  collection: Collection;
  tournament: TournamentData;
  predictionSettings: PredictionSettings;
  redundancySettings: RedundancySettings;
  vector: SourceVector;
}

function fixture(ids = ["a", "b"]): State {
  const semantic = createInitialSemanticRedundancyStateV10();
  const collection = {
    id: "collection",
    name: "adapter test",
    schemaVersion: 10,
    revision: 1,
    games: ids.map((id) => ({ id, ownership: "owned" as const })),
    semanticRedundancy: semantic,
  } as unknown as Collection;
  const factualWeights = { binary: 0, continuous: 0 };
  const vector: SourceVector = {
    available: true,
    unavailableSources: [],
    processEpoch: "test-process",
    changeToken: 1,
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    collectionRevision: collection.revision,
    semanticEvidenceEpoch: semantic.evidenceEpoch,
    semanticConsentEpoch: semantic.consentEpoch,
    factualWeightsEpoch: semantic.factualWeightsEpoch,
    factualWeightsFingerprint: semantic.factualWeightsFingerprint,
    redundancyWeightsFingerprint: canonicalSha256(factualWeights),
    tournamentRevision: 1,
    predictionSettingsRevision: 1,
    nicheSettingsRevision: 1,
    redundancySettingsRevision: 1,
    shelfConfigRevision: 1,
    representationVersion: 1,
    algorithmVersion: 1,
  };
  return {
    collection,
    tournament: { settings: {}, sessions: [], gameStats: {} } as unknown as TournamentData,
    predictionSettings: { stageThresholds: [5, 15, 30], defaultK: 5, minSimilarityThreshold: 0.2 },
    redundancySettings: {
      enabled: false,
      stage: "annotation",
      similarityThreshold: 0.7,
      maxPenalty: 0.2,
      componentWeights: factualWeights,
      minNeighbors: 2,
      expectedNeighbors: 5,
    },
    vector,
  };
}

function sourceStorage(state: State): JevRunSourceStorage {
  return {
    loadCollection: () => Promise.resolve(structuredClone(state.collection)),
    loadTournament: () => Promise.resolve(structuredClone(state.tournament)),
    loadPredictionSettings: () => Promise.resolve(structuredClone(state.predictionSettings)),
    loadRedundancySettings: () => Promise.resolve(structuredClone(state.redundancySettings)),
    sourceVector: () => structuredClone(state.vector),
  };
}

function snapshotStorage(state: State) {
  let freshnessEpoch = "fresh-1";
  let externalEpoch = "external-1";
  let snapshotCalls = 0;
  let legacyCollectionLoads = 0;
  const storage: JevRunSourceStorage = {
    ...sourceStorage(state),
    loadCollection: () => {
      legacyCollectionLoads++;
      return Promise.resolve(structuredClone(state.collection));
    },
    loadJevSourceSnapshot: () => {
      snapshotCalls++;
      return Promise.resolve({
        collection: structuredClone(state.collection),
        tournament: structuredClone(state.tournament),
        predictionSettings: structuredClone(state.predictionSettings),
        redundancySettings: structuredClone(state.redundancySettings),
        freshnessEpoch,
        externalEpoch,
      });
    },
  };
  return {
    storage,
    setFreshness: (value: string) => (freshnessEpoch = value),
    setExternal: (value: string) => (externalEpoch = value),
    counts: () => ({ snapshotCalls, legacyCollectionLoads }),
  };
}

function predictionRows(collection: Collection): GameWithScore[] {
  return collection.games.map((game) => ({
    game: { id: game.id, ownership: game.ownership },
    score: null,
  })) as unknown as GameWithScore[];
}

function adapterFor(
  state: State,
  listGamesWithPredictionsFromSnapshot: JevRunSnapshotPredictionService["listGamesWithPredictionsFromSnapshot"],
  maxCaptureRetries?: number,
) {
  const storage = sourceStorage(state);
  return {
    storage,
    adapter: createJevRunSourceAdapter({
      storageService: storage,
      predictionService: { listGamesWithPredictionsFromSnapshot },
      ...(maxCaptureRetries === undefined ? {} : { maxCaptureRetries }),
    }),
  };
}

function mutateCollection(state: State, operation: (collection: Collection) => void) {
  operation(state.collection);
  state.collection.revision++;
  state.vector = {
    ...state.vector,
    changeToken: state.vector.changeToken + 1,
    collectionRevision: state.collection.revision,
    semanticEvidenceEpoch: state.collection.semanticRedundancy.evidenceEpoch,
    semanticConsentEpoch: state.collection.semanticRedundancy.consentEpoch,
    factualWeightsEpoch: state.collection.semanticRedundancy.factualWeightsEpoch,
    factualWeightsFingerprint: state.collection.semanticRedundancy.factualWeightsFingerprint,
  };
}

async function expectUnavailable(operation: Promise<unknown>): Promise<void> {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(JevRunSourceUnavailableError);
}

describe("JevRunSourceAdapter", () => {
  test("separates full live vector identity from global policy identity", async () => {
    const state = fixture();
    const { adapter } = adapterFor(state, (collection) =>
      Promise.resolve(predictionRows(collection)),
    );
    const before = await adapter.readCurrent();
    mutateCollection(state, (collection) => {
      collection.games[0].ownerNote = { state: "cleared", version: 1, updatedAt: "changed" };
      collection.semanticRedundancy.evidenceEpoch++;
    });
    state.vector = {
      ...state.vector,
      tournamentRevision: (state.vector.tournamentRevision ?? 0) + 1,
      changeToken: state.vector.changeToken + 1,
    };
    const after = await adapter.readCurrent();
    expect(after.sourceVectorIdentity).not.toBe(before.sourceVectorIdentity);
    expect(after.policyIdentity).toBe(before.policyIdentity);

    state.collection.semanticRedundancy.settings.cachedOwnerNoteUse = true;
    state.collection.semanticRedundancy.consentEpoch++;
    state.vector = {
      ...state.vector,
      semanticConsentEpoch: (state.vector.semanticConsentEpoch ?? 0) + 1,
      changeToken: state.vector.changeToken + 1,
    };
    const allowed = await adapter.readCurrent();
    expect(allowed.canTransmitNotes).toBe(true);
    expect(allowed.policyIdentity).not.toBe(after.policyIdentity);

    state.collection.semanticRedundancy.settings.cachedOwnerNoteUse = false;
    state.collection.semanticRedundancy.consentEpoch++;
    state.vector = {
      ...state.vector,
      semanticConsentEpoch: (state.vector.semanticConsentEpoch ?? 0) + 1,
      changeToken: state.vector.changeToken + 1,
    };
    const revoked = await adapter.readCurrent();
    expect(revoked.canTransmitNotes).toBe(false);
    expect(revoked.policyIdentity).not.toBe(allowed.policyIdentity);
  });

  test("loads an untargeted complete prediction capture and durable identity", async () => {
    const state = fixture(["a", "b", "c"]);
    let callCount = 0;
    const { adapter } = adapterFor(state, (collection, _tournament, _settings, targetIds) => {
      callCount++;
      expect(targetIds).toBeUndefined();
      return Promise.resolve(predictionRows(collection));
    });
    const capture = await adapter.loadCapture();
    expect(callCount).toBe(1);
    expect(capture.predictionCapture).toHaveLength(3);
    expect(capture.captureIdentity.sourceVectorIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(capture.captureIdentity.tournamentIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(capture.captureIdentity.predictionCaptureIdentity).toMatch(/^[a-f0-9]{64}$/);
  });

  test("uses coherent storage snapshots and incorporates freshness and external epochs", async () => {
    const state = fixture();
    const source = snapshotStorage(state);
    const adapter = createJevRunSourceAdapter({
      storageService: source.storage,
      predictionService: {
        listGamesWithPredictionsFromSnapshot: (collection) =>
          Promise.resolve(predictionRows(collection)),
      },
    });

    const first = await adapter.loadCapture();
    const current = await adapter.readCurrent();
    expect(source.counts()).toEqual({ snapshotCalls: 3, legacyCollectionLoads: 0 });
    source.setFreshness("fresh-2");
    const fresh = await adapter.readCurrent();
    expect(fresh.sourceVectorIdentity).not.toBe(current.sourceVectorIdentity);
    expect(fresh.policyIdentity).toBe(current.policyIdentity);
    source.setExternal("external-2");
    const replaced = await adapter.readCurrent();
    expect(replaced.sourceVectorIdentity).toBe(fresh.sourceVectorIdentity);
    expect(replaced.policyIdentity).not.toBe(fresh.policyIdentity);

    source.setFreshness("fresh-3");
    const second = await adapter.loadCapture();
    expect(second.captureIdentity.sourceVectorIdentity).not.toBe(
      first.captureIdentity.sourceVectorIdentity,
    );
    expect(source.counts().legacyCollectionLoads).toBe(0);
  });

  test("retries capture when snapshot freshness changes during prediction and fails closed on snapshot errors", async () => {
    const state = fixture();
    const source = snapshotStorage(state);
    let calls = 0;
    const adapter = createJevRunSourceAdapter({
      storageService: source.storage,
      predictionService: {
        listGamesWithPredictionsFromSnapshot: (collection) => {
          calls++;
          if (calls === 1) source.setFreshness("fresh-during-prediction");
          return Promise.resolve(predictionRows(collection));
        },
      },
    });
    const capture = await adapter.loadCapture();
    expect(calls).toBe(2);
    expect(capture.collection.revision).toBe(state.collection.revision);

    source.storage.loadJevSourceSnapshot = () => Promise.reject(new Error("snapshot failed"));
    await expectUnavailable(adapter.readCurrent());
    await expectUnavailable(adapter.loadCapture());
  });

  test("real storage snapshots bound collection reads and fence external same-revision changes", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jev-source-adapter-"));
    const dataDir = path.join(tempDir, "data");
    const collectionPath = path.join(dataDir, "collection.json");
    const realOps = createFileOps();
    let collectionReads = 0;
    const fileOps = {
      ...realOps,
      readFile: async (filePath: string) => {
        if (filePath === collectionPath) collectionReads++;
        return realOps.readFile(filePath);
      },
    };
    try {
      const storage = createStorageService({
        dataDir,
        configPath: path.join(tempDir, "config.json"),
        fileOps,
      });
      if (!storage.hydrateSourceVector) throw new Error("Storage source hydration unavailable");
      await storage.hydrateSourceVector();
      const adapter = createJevRunSourceAdapter({
        storageService: storage,
        predictionService: {
          listGamesWithPredictionsFromSnapshot: (collection) =>
            Promise.resolve(predictionRows(collection)),
        },
      });

      await adapter.loadCapture();
      const readsAfterWarmCapture = collectionReads;
      for (let index = 0; index < 3; index++) {
        await adapter.loadCapture();
        await adapter.readCurrent();
      }
      expect(collectionReads).toBe(readsAfterWarmCapture);
      expect(readsAfterWarmCapture).toBeLessThanOrEqual(2);

      const before = await adapter.readCurrent();
      const stored = JSON.parse(await fs.readFile(collectionPath, "utf8")) as Collection;
      stored.name = "external same-revision edit";
      await fs.writeFile(collectionPath, JSON.stringify(stored), "utf8");
      const externallyChanged = await adapter.readCurrent();
      expect(externallyChanged.collection.revision).toBe(before.collection.revision);
      expect(externallyChanged.sourceVectorIdentity).not.toBe(before.sourceVectorIdentity);
      expect(externallyChanged.policyIdentity).not.toBe(before.policyIdentity);

      const noteState = JSON.parse(await fs.readFile(collectionPath, "utf8")) as Collection;
      noteState.semanticRedundancy.settings.cachedOwnerNoteUse = true;
      noteState.semanticRedundancy.consentEpoch++;
      noteState.semanticRedundancy.ownerNoteConsentEpoch =
        (noteState.semanticRedundancy.ownerNoteConsentEpoch ?? 0) + 1;
      await fs.writeFile(collectionPath, JSON.stringify(noteState), "utf8");
      const notePermissionChanged = await adapter.readCurrent();
      expect(notePermissionChanged.sourceVectorIdentity).not.toBe(
        externallyChanged.sourceVectorIdentity,
      );
      expect(notePermissionChanged.policyIdentity).not.toBe(externallyChanged.policyIdentity);
      expect(notePermissionChanged.canTransmitNotes).toBe(true);

      await fs.writeFile(collectionPath, "{invalid", "utf8");
      await expectUnavailable(adapter.readCurrent());
      await fs.unlink(collectionPath);
      await expectUnavailable(adapter.readCurrent());
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("real storage snapshot adapter recovers on a later explicit read after transient failures", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jev-source-recovery-"));
    const dataDir = path.join(tempDir, "data");
    const collectionPath = path.join(dataDir, "collection.json");
    const realOps = createFileOps();
    let failStat = false;
    let failCollectionRead = false;
    let failWrite = false;
    const fileOps = {
      ...realOps,
      stat: async (filePath: string) => {
        if (failStat && filePath === collectionPath) throw new Error("temporary stat failure");
        if (!realOps.stat) throw new Error("stat unavailable");
        return realOps.stat(filePath);
      },
      readFile: async (filePath: string) => {
        if (failCollectionRead && filePath === collectionPath) {
          failCollectionRead = false;
          throw new Error("temporary read failure");
        }
        return realOps.readFile(filePath);
      },
      writeFileExclusive: async (filePath: string, content: string) => {
        if (failWrite) {
          failWrite = false;
          throw new Error("temporary write failure");
        }
        return realOps.writeFileExclusive(filePath, content);
      },
    };
    try {
      const storage = createStorageService({
        dataDir,
        configPath: path.join(tempDir, "config.json"),
        fileOps,
      });
      if (!storage.hydrateSourceVector) throw new Error("Storage source hydration unavailable");
      await storage.hydrateSourceVector();
      const adapter = createJevRunSourceAdapter({
        storageService: storage,
        predictionService: {
          listGamesWithPredictionsFromSnapshot: (collection) =>
            Promise.resolve(predictionRows(collection)),
        },
      });
      await adapter.loadCapture();

      failStat = true;
      await expectUnavailable(adapter.readCurrent());
      failStat = false;
      expect((await adapter.readCurrent()).collection.id).toBeTruthy();

      const changed = JSON.parse(await fs.readFile(collectionPath, "utf8")) as Collection;
      changed.name = "external same-revision edit before transient read";
      await fs.writeFile(collectionPath, JSON.stringify(changed), "utf8");
      failCollectionRead = true;
      await expectUnavailable(adapter.readCurrent());
      expect((await adapter.loadCapture()).collection.name).toBe(changed.name);

      const current = await storage.loadCollection();
      current.name = "failed storage write leaves old durable source";
      failWrite = true;
      let saveError: unknown;
      try {
        await storage.saveCollection(current);
      } catch (error) {
        saveError = error;
      }
      expect(saveError).toBeDefined();
      expect((await adapter.readCurrent()).collection.name).toBe(changed.name);

      await fs.writeFile(collectionPath, "{invalid", "utf8");
      await expectUnavailable(adapter.readCurrent());
      await fs.unlink(collectionPath);
      await expectUnavailable(adapter.readCurrent());
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("mutation coordinator remains available while prediction is pending and stale capture retries", async () => {
    const state = fixture();
    const storage = sourceStorage(state);
    const coordinator = profileSourceCoordinatorFor(storage);
    let call = 0;
    let predictionStarted!: () => void;
    let releaseFirstPrediction!: () => void;
    const started = new Promise<void>((resolve) => {
      predictionStarted = resolve;
    });
    const firstPrediction = new Promise<void>((resolve) => {
      releaseFirstPrediction = resolve;
    });
    const adapter = createJevRunSourceAdapter({
      storageService: storage,
      predictionService: {
        listGamesWithPredictionsFromSnapshot: async (collection) => {
          call++;
          if (call === 1) {
            predictionStarted();
            await firstPrediction;
          }
          return predictionRows(collection);
        },
      },
    });
    const pendingCapture = adapter.loadCapture();
    await started;
    let mutationFinished = false;
    await coordinator.runExclusive(() => {
      mutateCollection(state, (collection) => {
        collection.games[0].ownerNote = { state: "cleared", version: 1, updatedAt: "mutation" };
      });
      mutationFinished = true;
      return Promise.resolve();
    });
    expect(mutationFinished).toBe(true);
    releaseFirstPrediction();
    const capture = await pendingCapture;
    expect(call).toBe(2);
    expect(capture.collection.revision).toBe(state.collection.revision);
    expect(capture.sourceVectorIdentity).toBe(canonicalSha256(state.vector));
  });

  test("readCurrent reports durable note permission and source failures fail closed", async () => {
    const state = fixture();
    state.collection.semanticRedundancy.settings.cachedOwnerNoteUse = true;
    state.collection.semanticRedundancy.consentEpoch++;
    state.vector = {
      ...state.vector,
      semanticConsentEpoch: (state.vector.semanticConsentEpoch ?? 0) + 1,
      changeToken: state.vector.changeToken + 1,
    };
    const { adapter } = adapterFor(state, (collection) =>
      Promise.resolve(predictionRows(collection)),
    );
    expect((await adapter.readCurrent()).canTransmitNotes).toBe(true);

    state.vector = { ...state.vector, available: false };
    await expectUnavailable(adapter.readCurrent());
    let predictionCalls = 0;
    const unavailable = adapterFor(
      state,
      (collection) => {
        predictionCalls++;
        return Promise.resolve(predictionRows(collection));
      },
      1,
    ).adapter;
    await expectUnavailable(unavailable.loadCapture());
    expect(predictionCalls).toBe(0);
  });

  test("capture retries are bounded when sources keep moving during prediction", async () => {
    const state = fixture();
    const storage = sourceStorage(state);
    const coordinator = profileSourceCoordinatorFor(storage);
    let calls = 0;
    const adapter = createJevRunSourceAdapter({
      storageService: storage,
      predictionService: {
        listGamesWithPredictionsFromSnapshot: async (collection) => {
          calls++;
          await coordinator.runExclusive(() => {
            mutateCollection(state, () => {});
            return Promise.resolve();
          });
          return predictionRows(collection);
        },
      },
      maxCaptureRetries: 1,
    });
    await expectUnavailable(adapter.loadCapture());
    expect(calls).toBe(2);
  });
});
