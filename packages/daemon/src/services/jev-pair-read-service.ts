import type { Collection, GameWithScore, RedundancyComponentWeights } from "@shelf-judge/shared";
import {
  computeJevPairCoverage,
  type JevPairCoverageDigest,
  type JevPredictionCaptureIdentity,
} from "./jev-pair-coverage.js";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import type { RedundancyPairTable } from "./redundancy-engine.js";

export type JevPairReadResult =
  | { status: "disabled" | "stale"; summary: string }
  | { status: "factual" | "not-ready"; summary: string; table?: RedundancyPairTable }
  | { status: "ready" | "partial"; summary: string; table: RedundancyPairTable };

export interface JevPairReadInput {
  collection: Collection;
  /** Complete, unfiltered prediction capture, including null/vetoed/nonpositive results. */
  predictionCapture: readonly GameWithScore[];
  factualWeights: RedundancyComponentWeights;
  captureIdentity: JevPredictionCaptureIdentity;
  /** The factual master switch is owned by the caller's existing redundancy settings. */
  factualEnabled?: boolean;
}

/** Source-free fence identifying the observable result of a single read snapshot. */
export type JevPairReadProof =
  | { status: "ready" | "partial" | "factual" | "not-ready"; identity: string }
  | { status: Exclude<JevPairReadResult["status"], "ready" | "partial">; summary: string };

/** A read result and a synchronous check that its captured inputs still produce the same proof. */
export interface JevPairReadProofFence {
  result: JevPairReadResult;
  proof: JevPairReadProof;
  /** True only when a healthy read is fenced by a stable cache mutation revision. */
  reusable?: boolean;
  isCurrent(): boolean;
}

type ReadCache = Pick<JevPairCache, "available" | "lookup"> & {
  mutationRevision?: () => number | null;
};

const DISABLED: JevPairReadResult = {
  status: "disabled",
  summary: "Semantic redundancy is disabled.",
};
const FACTUAL: JevPairReadResult = { status: "factual", summary: "Using factual redundancy only." };
const NOT_READY: JevPairReadResult = {
  status: "not-ready",
  summary: "Semantic redundancy is not ready.",
};

/** Purely classifies one already-computed coverage digest; callers can share this pass. */
export function classifyJevPairCoverage(input: {
  collection: Collection;
  coverage: JevPairCoverageDigest;
  factualEnabled?: boolean;
  cacheAvailable?: boolean;
}): JevPairReadResult {
  if (input.factualEnabled === false) return DISABLED;
  if (input.collection?.semanticRedundancy?.settings?.enabled !== true) return FACTUAL;
  if (input.cacheAvailable === false) return NOT_READY;
  const hasSemanticSignal = input.coverage.pairs.some(
    (pair) => pair.C.state === "covered" || pair.D.state === "covered",
  );
  const factualWeight = input.collection.semanticRedundancy.settings.weights.factual;
  const status = !hasSemanticSignal
    ? factualWeight > 0
      ? "factual"
      : "not-ready"
    : input.coverage.complete
      ? "ready"
      : "partial";
  const current = input.collection.semanticRedundancy;
  const identity = {
    generationId: input.coverage.identity,
    consentEpoch: String(current.consentEpoch),
    settingsEpoch: `${current.evidenceEpoch}:${current.factualWeightsEpoch}`,
  };
  return {
    status,
    summary:
      status === "ready"
        ? "Semantic redundancy is ready."
        : status === "partial"
          ? "Some semantic redundancy signals are not available."
          : status === "factual"
            ? "Using factual redundancy only."
            : "No enabled redundancy component is available.",
    table: {
      status,
      identity,
      expectedIdentity: { ...identity },
      weights: { ...current.settings.weights },
      pairs: input.coverage.pairs.map((pair) => ({
        gameAId: pair.gameAId,
        gameBId: pair.gameBId,
        factual: pair.factualScore,
        description: pair.C.state === "covered" ? pair.C.score : null,
        ownerNote: pair.D.state === "covered" ? pair.D.score : null,
      })),
    },
  };
}

/** Read-only adapter. It proves the whole capture and cache before exposing any semantic score. */
export function createJevPairReadService(cache: ReadCache) {
  function resolve(input: JevPairReadInput): JevPairReadResult {
    const settings = input.collection?.semanticRedundancy?.settings;
    if (input.factualEnabled === false) return DISABLED;
    if (settings?.enabled !== true) return FACTUAL;
    try {
      if (!cache.available) return NOT_READY;
      const coverage = computeJevPairCoverage({
        collection: input.collection,
        predictionCapture: input.predictionCapture,
        captureIdentity: input.captureIdentity,
        factualWeights: input.factualWeights,
        cache,
      });
      return classifyJevPairCoverage({
        collection: input.collection,
        coverage,
        factualEnabled: true,
      });
    } catch {
      // No cache/parse/capture failure may allow an earlier successful semantic table to linger.
      return NOT_READY;
    }
  }

  function proofFor(result: JevPairReadResult): JevPairReadProof {
    if (result.status === "ready" || result.status === "partial")
      return { status: result.status, identity: result.table.identity.generationId };
    if ((result.status === "factual" || result.status === "not-ready") && result.table)
      return { status: result.status, identity: result.table.identity.generationId };
    return { status: result.status, summary: result.summary };
  }

  return {
    resolve,
    resolveWithProof(input: JevPairReadInput): JevPairReadProofFence {
      // Retain an isolated complete snapshot: caller mutations after this call must not change the
      // inputs against which the fence is checked. The clone stays private in this closure.
      const captured = structuredClone(input);
      const revisionReader = cache.mutationRevision;
      let initialRevision: number | null = null;
      if (revisionReader) {
        try {
          initialRevision = revisionReader.call(cache);
        } catch {
          initialRevision = null;
        }
      }
      const result = resolve(captured);
      const proof = proofFor(result);
      const encodedProof = JSON.stringify(proof);
      let stableRevision: number | null = null;
      if (revisionReader && initialRevision !== null) {
        try {
          const afterRevision = revisionReader.call(cache);
          if (afterRevision === initialRevision) stableRevision = initialRevision;
        } catch {
          // A failed revision read cannot authorize reuse.
        }
      }
      const healthyValidatedRead =
        (result.status === "ready" || result.status === "partial" || result.status === "factual") &&
        "table" in result &&
        result.table !== undefined;
      const reusable = healthyValidatedRead && stableRevision !== null;
      return {
        result,
        proof,
        reusable,
        isCurrent(): boolean {
          try {
            if (revisionReader) {
              if (!healthyValidatedRead || stableRevision === null) return false;
              const currentRevision = revisionReader.call(cache);
              return currentRevision !== null && currentRevision === stableRevision;
            }
            // Compatibility for test/custom caches without revision support. Production caches
            // use the revision path above and never rescan pair lookups here.
            if (!("table" in result) || result.table === undefined) return false;
            return JSON.stringify(proofFor(resolve(captured))) === encodedProof;
          } catch {
            return false;
          }
        },
      };
    },
  };
}
