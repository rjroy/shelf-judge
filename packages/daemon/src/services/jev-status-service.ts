import type { Collection, RedundancySettings } from "@shelf-judge/shared";
import type { JevRunSourceAdapter } from "./jev-run-source-adapter.js";
import type { JevPairCache, JevRunProgress } from "./jev-pair-cache-service.js";
import { computeJevPairCoverage } from "./jev-pair-coverage.js";
import { createJevPairReadService } from "./jev-pair-read-service.js";
import { projectJevPairStatus, unavailableJevPairStatus } from "./jev-pair-status.js";
import type { JevStatusResponse } from "./jev-pair-status.js";
import { profileSourceCoordinatorFor } from "./profile-source-coordinator.js";

export interface JevStatusStorage {
  loadCollection(): Promise<Collection>;
  loadRedundancySettings(): Promise<RedundancySettings>;
}

const MAX_COHERENCE_ATTEMPTS = 2;

/** Aggregate-only, inference-free status reader. */
export function createJevStatusService(options: {
  storageService: JevStatusStorage;
  sourceAdapter: JevRunSourceAdapter;
  cache: JevPairCache | null;
}) {
  const { storageService, sourceAdapter, cache } = options;
  const coordinator = profileSourceCoordinatorFor(storageService);

  function persistedProgress(): JevRunProgress | null {
    if (!cache?.available) return null;
    try {
      return cache.getRunProgress();
    } catch {
      return null;
    }
  }

  async function read(): Promise<JevStatusResponse> {
    try {
      const initial = await coordinator.runExclusive(async () => {
        const [collection, redundancySettings] = await Promise.all([
          storageService.loadCollection(),
          storageService.loadRedundancySettings(),
        ]);
        return { collection, factualEnabled: redundancySettings.enabled };
      });
      if (!initial.factualEnabled)
        return unavailableJevPairStatus("not-applicable", persistedProgress(), "disabled");
      if (initial.collection.semanticRedundancy.settings.enabled !== true)
        return unavailableJevPairStatus("not-applicable", persistedProgress(), "factual");
      if (
        initial.collection.semanticRedundancy.settings.weights.description <= 0 &&
        initial.collection.semanticRedundancy.settings.weights.ownerNote <= 0
      )
        return unavailableJevPairStatus("not-applicable", persistedProgress(), "factual");
      if (!cache?.available)
        return unavailableJevPairStatus("cache-unavailable", null, "not-ready");

      for (let attempt = 0; attempt < MAX_COHERENCE_ATTEMPTS; attempt++) {
        const revisionBefore = cache.mutationRevision();
        if (revisionBefore === null)
          return unavailableJevPairStatus("cache-unavailable", persistedProgress(), "not-ready");
        let capture;
        try {
          capture = await sourceAdapter.loadCapture();
        } catch {
          return unavailableJevPairStatus("source-unavailable", persistedProgress());
        }

        let coverage;
        let readResult;
        try {
          coverage = computeJevPairCoverage({
            collection: capture.collection,
            predictionCapture: capture.predictionCapture,
            captureIdentity: capture.captureIdentity,
            factualWeights: capture.factualWeights,
            cache,
          });
          readResult = createJevPairReadService(cache).resolve({
            collection: capture.collection,
            predictionCapture: capture.predictionCapture,
            factualWeights: capture.factualWeights,
            captureIdentity: capture.captureIdentity,
            factualEnabled: true,
          });
        } catch {
          return unavailableJevPairStatus("source-unavailable", persistedProgress());
        }
        const revisionAfter = cache.mutationRevision();
        if (revisionAfter === null)
          return unavailableJevPairStatus("cache-unavailable", persistedProgress(), "not-ready");
        if (revisionBefore !== revisionAfter) continue;

        let current;
        try {
          current = await coordinator.runExclusive(async () => {
            const [source, redundancySettings] = await Promise.all([
              sourceAdapter.readCurrent(),
              storageService.loadRedundancySettings(),
            ]);
            return {
              source,
              factualEnabled: redundancySettings.enabled,
              cacheRevision: cache.mutationRevision(),
            };
          });
        } catch {
          return unavailableJevPairStatus("source-unavailable", persistedProgress());
        }
        if (!current.factualEnabled)
          return unavailableJevPairStatus("not-applicable", persistedProgress(), "disabled");
        if (current.source.collection.semanticRedundancy.settings.enabled !== true)
          return unavailableJevPairStatus("not-applicable", persistedProgress(), "factual");
        if (
          current.source.sourceVectorIdentity !== capture.sourceVectorIdentity ||
          current.source.policyIdentity !== capture.policyIdentity
        ) {
          if (attempt + 1 < MAX_COHERENCE_ATTEMPTS) continue;
          return unavailableJevPairStatus("source-unavailable", persistedProgress());
        }
        const revisionFinal = current.cacheRevision;
        if (revisionFinal === null)
          return unavailableJevPairStatus("cache-unavailable", persistedProgress(), "not-ready");
        if (revisionFinal !== revisionBefore) {
          if (attempt + 1 < MAX_COHERENCE_ATTEMPTS) continue;
          return unavailableJevPairStatus("cache-unavailable", persistedProgress(), "not-ready");
        }
        return projectJevPairStatus({
          coverage,
          readResult,
          progress: persistedProgress(),
          cacheAvailable: true,
        });
      }
      return unavailableJevPairStatus("source-unavailable", persistedProgress());
    } catch {
      return unavailableJevPairStatus("source-unavailable", persistedProgress());
    }
  }

  return { read };
}
