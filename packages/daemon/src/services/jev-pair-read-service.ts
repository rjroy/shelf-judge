import type { Collection, GameWithScore, RedundancyComponentWeights } from "@shelf-judge/shared";
import { computeJevPairCoverage, type JevPredictionCaptureIdentity } from "./jev-pair-coverage.js";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import type { RedundancyPairTable } from "./redundancy-engine.js";

export type JevPairReadResult =
  | { status: "disabled" | "factual" | "not-ready" | "stale"; summary: string }
  | { status: "ready"; summary: string; table: RedundancyPairTable };

export interface JevPairReadInput {
  collection: Collection;
  /** Complete, unfiltered prediction capture, including null/vetoed/nonpositive results. */
  predictionCapture: readonly GameWithScore[];
  factualWeights: RedundancyComponentWeights;
  captureIdentity: JevPredictionCaptureIdentity;
  /** The factual master switch is owned by the caller's existing redundancy settings. */
  factualEnabled?: boolean;
}

type ReadCache = Pick<JevPairCache, "available" | "lookup" | "getActivation">;

const DISABLED: JevPairReadResult = {
  status: "disabled",
  summary: "Semantic redundancy is disabled.",
};
const FACTUAL: JevPairReadResult = { status: "factual", summary: "Using factual redundancy only." };
const NOT_READY: JevPairReadResult = {
  status: "not-ready",
  summary: "Semantic redundancy is not ready.",
};
const STALE: JevPairReadResult = { status: "stale", summary: "Semantic redundancy data is stale." };

/** Read-only adapter. It proves the whole capture and cache before exposing any semantic score. */
export function createJevPairReadService(cache: ReadCache) {
  return {
    resolve(input: JevPairReadInput): JevPairReadResult {
      const settings = input.collection?.semanticRedundancy?.settings;
      if (input.factualEnabled === false) return DISABLED;
      if (settings?.enabled !== true) return FACTUAL;
      if (settings.weights.description <= 0 && settings.weights.ownerNote <= 0) return FACTUAL;
      try {
        if (!cache.available) return NOT_READY;
        const coverage = computeJevPairCoverage({
          collection: input.collection,
          predictionCapture: input.predictionCapture,
          captureIdentity: input.captureIdentity,
          factualWeights: input.factualWeights,
          cache,
        });
        const activation = cache.getActivation();
        if (!activation) return NOT_READY;
        if (!coverage.complete) {
          if (coverage.pairs.some((pair) => pair.D.state === "blocked")) return NOT_READY;
          return coverage.pairs.some(
            (pair) => pair.C.state === "invalid-row" || pair.D.state === "invalid-row",
          )
            ? STALE
            : NOT_READY;
        }
        if (activation.identity !== coverage.identity) return STALE;
        const current = input.collection.semanticRedundancy;
        const identity = {
          // These are adapter labels, not writer-issued generations. The digest is the complete
          // deterministic capture identity; epochs below label the relevant current authority.
          generationId: activation.identity,
          consentEpoch: String(current.consentEpoch),
          settingsEpoch: `${current.evidenceEpoch}:${current.factualWeightsEpoch}`,
        };
        return {
          status: "ready",
          summary: "Semantic redundancy is ready.",
          table: {
            status: "ready",
            identity,
            expectedIdentity: { ...identity },
            weights: { ...current.settings.weights },
            pairs: coverage.pairs.map((pair) => ({
              gameAId: pair.gameAId,
              gameBId: pair.gameBId,
              factual: pair.factualScore,
              description: pair.C.state === "covered" ? pair.C.score : null,
              ownerNote: pair.D.state === "covered" ? pair.D.score : null,
            })),
          },
        };
      } catch {
        // No cache/parse/capture failure may allow an earlier successful semantic table to linger.
        return NOT_READY;
      }
    },
  };
}
