import { describe, expect, test } from "bun:test";
import { createInitialSemanticRedundancyState, type Collection } from "@shelf-judge/shared";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import { createSemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import type {
  CollectionPersistence,
  CollectionReader,
} from "../../src/services/storage-service.js";

const at = "2026-01-01T00:00:00.000Z";

function collection(): Collection {
  return {
    schemaVersion: 9,
    revision: 0,
    id: "collection-1",
    name: "Collection",
    axes: [],
    games: [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: createInitialSemanticRedundancyState(),
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

describe("semantic redundancy state service (v9-compatible Phase 2d2)", () => {
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

  test("does not invoke a provider or interpret legacy execution payloads", async () => {
    const initial = collection();
    initial.semanticRedundancy.disclosure = {
      id: "old-disclosure",
      manifestDigest: "a".repeat(64),
      evidenceEpoch: 0,
      consentEpoch: 0,
      pairCount: 0,
      notePairCount: 0,
      expiresAt: "2020-01-01T00:00:00.000Z",
    };
    initial.semanticRedundancy.authorization = {
      ...initial.semanticRedundancy.disclosure,
      state: "active",
    };
    const h = harness(initial);
    const accepted = await h.service.updateSettings(
      { evidenceEpoch: 0, consentEpoch: 0 },
      {
        enabled: true,
        weights: { factual: 7, description: 5, ownerNote: 3 },
        cachedOwnerNoteUse: false,
      },
    );
    expect(accepted.outcome).toBe("accepted");
    expect(h.read().semanticRedundancy.disclosure).toBeNull();
    expect(h.read().semanticRedundancy.authorization).toBeNull();
    expect(h.read().semanticRedundancy.pairJudgments).toEqual([]);
    expect(h.read().semanticRedundancy.publishedGeneration).toBeNull();
  });
});
