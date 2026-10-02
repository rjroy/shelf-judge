import { expect, test } from "bun:test";
import {
  createDisplayedFitnessService,
  type PrivateDisplayedFitnessSnapshot,
} from "../../src/services/displayed-fitness-service.js";
import type { SourceVector } from "../../src/services/source-vector.js";
import type { StorageService } from "../../src/services/storage-service.js";
import type { GameService } from "../../src/services/game-service.js";
import type { PredictionService } from "../../src/services/prediction-service.js";
import { createInitialSemanticRedundancyStateV10 } from "@shelf-judge/shared";

test("inactive private scoring proof is durable and performs no prediction or semantic read", async () => {
  let vector = {
    available: true,
    collectionId: "collection",
    collectionSchemaVersion: 10,
    collectionRevision: 3,
    processEpoch: "epoch",
    changeToken: "token",
  } as unknown as SourceVector;
  const collection = {
    id: "collection",
    name: "Collection",
    schemaVersion: 10,
    revision: 3,
    games: [],
    axes: [],
    semanticRedundancy: createInitialSemanticRedundancyStateV10(),
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const snapshot = {
    kind: "private-capture",
    collection,
    sourceVector: vector,
    tournament: {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
      sessions: [],
      gameStats: {},
    },
    predictionSettings: {},
    redundancySettings: {
      enabled: false,
      stage: "integrated",
      similarityThreshold: 0.2,
      maxPenalty: 2,
      componentWeights: { binary: 1, continuous: 0 },
      minNeighbors: 1,
      expectedNeighbors: 2,
    },
  } as unknown as PrivateDisplayedFitnessSnapshot;
  let predictionCalls = 0;
  const service = createDisplayedFitnessService({
    gameService: {} as GameService,
    predictionService: {
      listGamesWithPredictionsFromSnapshot: () => {
        predictionCalls += 1;
        return Promise.resolve([]);
      },
    } as unknown as PredictionService,
    storageService: { sourceVector: () => vector } as StorageService,
    resolveSemanticRead: () => {
      throw new Error("inactive mode must not read semantic cache");
    },
  });

  const proof = await service.getScoringInputFromSnapshot(snapshot);
  expect(proof.semanticScoringInputProof.mode).toBe("disabled");
  expect(proof.semanticScoringInputProof.identity).toMatch(/^[a-f0-9]{64}$/);
  expect(proof.isCurrent()).toBe(true);

  vector = { ...vector, processEpoch: "next-epoch", changeToken: 2 };
  snapshot.sourceVector = vector;
  const restarted = await service.getScoringInputFromSnapshot(snapshot);
  expect(restarted.semanticScoringInputProof).toEqual(proof.semanticScoringInputProof);
  expect(restarted.isCurrent()).toBe(true);

  // A staged same-revision collection has a different complete canonical content key.
  const staged = {
    ...snapshot,
    collection: { ...collection, name: "Staged collection" },
  } as unknown as PrivateDisplayedFitnessSnapshot;
  await service.getScoringInputFromSnapshot(staged);
  expect(predictionCalls).toBe(2);
});
