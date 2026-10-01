import type { Collection, GameWithScore, RedundancySettings } from "@shelf-judge/shared";
import type { JevPredictionCaptureIdentity } from "./jev-pair-coverage.js";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import { createJevPairReadService } from "./jev-pair-read-service.js";

/** The minimal common input supplied by the production snapshot and display adapters. */
export interface JevProductionSemanticReadInput {
  predictionCapture: readonly GameWithScore[];
  collection: Collection;
  redundancySettings: Pick<RedundancySettings, "enabled">;
  factualWeights: RedundancySettings["componentWeights"];
  captureIdentity: JevPredictionCaptureIdentity;
}

/** One read-only adapter shared by displayed fitness and collection snapshots. */
export function createJevProductionSemanticRead(cache: JevPairCache | null) {
  const readService = createJevPairReadService(
    cache ?? {
      available: false,
      lookup: () => null,
    },
  );

  return (input: JevProductionSemanticReadInput) =>
    readService.resolveWithProof({
      predictionCapture: input.predictionCapture,
      collection: input.collection,
      factualWeights: input.factualWeights,
      captureIdentity: input.captureIdentity,
      factualEnabled: input.redundancySettings.enabled,
    });
}
