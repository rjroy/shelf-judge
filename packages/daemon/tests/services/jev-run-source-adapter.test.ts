import { describe, expect, test } from "bun:test";
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
