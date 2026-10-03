import { describe, expect, test } from "bun:test";
import { createInitialSemanticRedundancyStateV10, type Collection } from "@shelf-judge/shared";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import { createSemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import type {
  CollectionPersistence,
  CollectionReader,
} from "../../src/services/storage-service.js";

const at = "2026-01-01T00:00:00.000Z";

function collection(): Collection {
  return {
    schemaVersion: 10,
    revision: 0,
    id: "collection-1",
    name: "Collection",
    axes: [],
    games: [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: createInitialSemanticRedundancyStateV10(),
    createdAt: at,
    updatedAt: at,
  };
}

function harness(initial = collection()) {
  let stored = structuredClone(initial);
  let saves = 0;
  const storage: CollectionReader & CollectionPersistence = {
    loadCollection: () => Promise.resolve(structuredClone(stored)),
    saveCollection: (next) => {
      saves += 1;
      stored = structuredClone(next);
      return Promise.resolve();
    },
  };
  const mutations = createCollectionMutationService({ storageService: storage });
  return {
    service: createSemanticRedundancyStateService({ collectionMutationService: mutations }),
    read: () => structuredClone(stored),
    saves: () => saves,
  };
}

describe("semantic redundancy state service (V10 factual-only state)", () => {
  test("updates semantic preferences with optimistic epoch fencing", async () => {
    const h = harness();
    const service = h.service;
    const stale = await service.updateSettings(
      { evidenceEpoch: 1, consentEpoch: 0 },
      {
        enabled: true,
        weights: { factual: 7, description: 5, ownerNote: 3 },
        cachedOwnerNoteUse: false,
      },
    );
    expect(stale).toMatchObject({
      outcome: "stale",
      current: { evidenceEpoch: 0, consentEpoch: 0 },
    });
    expect(h.saves()).toBe(0);

    const accepted = await service.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 0 },
      {
        enabled: true,
        weights: { factual: 7, description: 5, ownerNote: 3 },
        cachedOwnerNoteUse: false,
      },
    );
    expect(accepted).toMatchObject({
      outcome: "accepted",
      current: { evidenceEpoch: 0, consentEpoch: 1 },
    });
    expect(h.read().semanticRedundancy).toMatchObject({
      consentEpoch: 1,
      firstOptInInitialized: true,
      settings: {
        enabled: true,
        weights: { factual: 7, description: 5, ownerNote: 3 },
        cachedOwnerNoteUse: false,
      },
    });

    const noOp = await service.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 1 },
      {
        enabled: true,
        weights: { factual: 7, description: 5, ownerNote: 3 },
        cachedOwnerNoteUse: false,
      },
    );
    expect(noOp.outcome).toBe("accepted");
    expect(h.saves()).toBe(1);
  });

  test("fences factual-weight changes with a durable fingerprint epoch", async () => {
    const h = harness();
    expect(await h.service.invalidateForFactualWeights("invalid")).toEqual({
      outcome: "invalid-state",
    });
    expect(await h.service.invalidateForFactualWeights("b".repeat(64))).toMatchObject({
      outcome: "accepted",
      current: { evidenceEpoch: 0, consentEpoch: 0 },
    });
    expect(h.read().semanticRedundancy).toMatchObject({
      factualWeightsEpoch: 1,
      factualWeightsFingerprint: "b".repeat(64),
    });
    const savedRevision = h.read().revision;
    await h.service.invalidateForFactualWeights("b".repeat(64));
    expect(h.read().revision).toBe(savedRevision);
    await h.service.invalidateForFactualWeights("a".repeat(64));
    expect(h.read().semanticRedundancy).toMatchObject({
      factualWeightsEpoch: 2,
      factualWeightsFingerprint: "a".repeat(64),
    });
  });

  test("V10 state stores preferences and epochs without legacy inference payloads", async () => {
    const h = harness();
    const accepted = await h.service.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 0 },
      {
        enabled: true,
        weights: { factual: 7, description: 5, ownerNote: 3 },
        cachedOwnerNoteUse: false,
      },
    );
    expect(accepted.outcome).toBe("accepted");
    expect(h.read().semanticRedundancy).toEqual({
      settings: {
        enabled: true,
        weights: { factual: 7, description: 5, ownerNote: 3 },
        cachedOwnerNoteUse: false,
      },
      evidenceEpoch: 0,
      consentEpoch: 1,
      ownerNoteConsentEpoch: 0,
      factualWeightsEpoch: 0,
      factualWeightsFingerprint: null,
      firstOptInInitialized: true,
    });
  });

  test("weight changes advance the broad fence but preserve note-row cache consent", async () => {
    const initial = collection();
    initial.semanticRedundancy.settings = {
      enabled: true,
      weights: { factual: 7, description: 3, ownerNote: 2 },
      cachedOwnerNoteUse: true,
    };
    initial.semanticRedundancy.consentEpoch = 4;
    initial.semanticRedundancy.ownerNoteConsentEpoch = 2;
    const h = harness(initial);

    const updated = await h.service.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 4 },
      {
        enabled: true,
        weights: { factual: 8, description: 5, ownerNote: 1 },
        cachedOwnerNoteUse: true,
      },
    );
    expect(updated).toMatchObject({ outcome: "accepted", current: { consentEpoch: 5 } });
    expect(h.read().semanticRedundancy).toMatchObject({
      consentEpoch: 5,
      ownerNoteConsentEpoch: 2,
    });
  });

  test("legacy V10 state materializes prior consent before a first mutation", async () => {
    const initial = collection();
    initial.semanticRedundancy.consentEpoch = 6;
    delete (initial.semanticRedundancy as { ownerNoteConsentEpoch?: number }).ownerNoteConsentEpoch;
    const h = harness(initial);
    const updated = await h.service.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 6 },
      {
        ...initial.semanticRedundancy.settings,
        weights: { factual: 4, description: 2, ownerNote: 0 },
      },
    );
    expect(updated).toMatchObject({ outcome: "accepted", current: { consentEpoch: 7 } });
    expect(h.read().semanticRedundancy).toMatchObject({
      consentEpoch: 7,
      ownerNoteConsentEpoch: 6,
    });
  });
});
