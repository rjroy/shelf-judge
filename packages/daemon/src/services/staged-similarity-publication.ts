import { z } from "zod";
import {
  SemanticScoringInputProofV2Schema,
  type SemanticScoringInputProofV2,
} from "../../../shared/src/semantic-scoring-input-proof-v2.js";
import type { StagedSimilarityCapture } from "./staged-similarity-capture.js";

const StagedDerivedOutputSchema = z
  .object({
    neighborIds: z.array(z.string().min(1)),
    predictedScore: z.number().finite().nullable(),
    predictionConfidence: z
      .enum(["actual", "strong", "moderate", "weak", "insufficient"])
      .nullable(),
    predictedBreakdown: z
      .array(
        z
          .object({
            axisName: z.string(),
            rating: z.number().finite(),
            confidence: z.enum(["actual", "strong", "moderate", "weak", "insufficient"]),
          })
          .strict(),
      )
      .nullable(),
    redundancyAdjustment: z.number().finite().nullable(),
    orderingScore: z.number().finite().nullable(),
  })
  .strict();

const StagedDerivedArtifactSchema = z
  .object({
    semanticScoringInputProof: SemanticScoringInputProofV2Schema,
    output: StagedDerivedOutputSchema,
  })
  .strict();

export type StagedDerivedArtifact = z.infer<typeof StagedDerivedArtifactSchema>;

export interface StagedSimilarityPublicationSource {
  readonly isSealed: boolean;
  sealProof(): SemanticScoringInputProofV2;
  isCurrent(): boolean;
  hasNoteDependentEvidence(): boolean;
}

export interface StagedSimilarityPublicationGuard {
  /** True for D and SHARED_CD-derived C evidence, even when owner-note weight is zero. */
  readonly requiresNoteFence: boolean;
  /** Durable proof identity bound by this guard's sealed resolver. */
  readonly proofIdentity: string;
  readonly proofDemandedPairsIdentity: string;
  readonly proofExaminedComponentsIdentity: string;
  readonly proofAlgorithmVersion: string;
  /** Rechecks actual captured source authority and the cache fence. */
  isCurrent(): boolean;
  /** Synchronous check immediately followed by synchronous publication; no await boundary. */
  publishIfCurrent(publish: () => void): boolean;
}

/**
 * Staged extension point for source-proof publication. Permission revocation is enforced by
 * recapturing authoritative source state through `capture.isSourceCurrent`, not a boolean passed
 * by a publication caller. This guard is independent of redundancy visibility being enabled.
 */
export function createStagedSimilarityPublicationGuard(
  capture: StagedSimilarityCapture,
  prepared: StagedSimilarityPublicationSource,
): StagedSimilarityPublicationGuard {
  if (!prepared.isSealed) {
    throw new TypeError("Staged publication requires a sealed similarity proof");
  }
  const proof = prepared.sealProof();
  const guard: StagedSimilarityPublicationGuard = {
    requiresNoteFence: prepared.hasNoteDependentEvidence(),
    proofIdentity: proof.identity,
    proofDemandedPairsIdentity: proof.demandedPairsIdentity,
    proofExaminedComponentsIdentity: proof.examinedComponentsIdentity,
    proofAlgorithmVersion: proof.algorithmVersion,
    isCurrent(): boolean {
      try {
        return capture.isSourceCurrent() && prepared.isCurrent();
      } catch {
        return false;
      }
    },
    publishIfCurrent(publish): boolean {
      if (!guard.isCurrent()) return false;
      // Keep this deliberately synchronous: caller publication is adjacent to the final fence.
      publish();
      return true;
    },
  };
  return Object.freeze(guard);
}

/** A fence-first predicate usable before best-effort cache/artifact cleanup begins. */
export function mayRetainStagedNoteDependentOutput(
  guard: StagedSimilarityPublicationGuard,
): boolean {
  // Even non-note outputs require a current source fence; note-dependent outputs use
  // this same check unconditionally, before cleanup regardless of redundancy visibility.
  return guard.isCurrent();
}

/**
 * Staged read gate for derived display artifacts. The caller supplies the proof from the
 * current sealed source/cache capture; old or malformed artifacts remain unreadable. This is
 * intentionally a narrow display projection, not a general-purpose artifact/provenance store.
 */
export function readStagedDerivedArtifact(
  raw: string,
  currentProof: SemanticScoringInputProofV2,
  guard: StagedSimilarityPublicationGuard,
): StagedDerivedArtifact | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = StagedDerivedArtifactSchema.safeParse(parsedJson);
  if (!parsed.success || !guard.isCurrent() || guard.proofIdentity !== currentProof.identity)
    return null;
  const proof = parsed.data.semanticScoringInputProof;
  if (
    proof.identity !== currentProof.identity ||
    proof.demandedPairsIdentity !== currentProof.demandedPairsIdentity ||
    proof.examinedComponentsIdentity !== currentProof.examinedComponentsIdentity ||
    proof.algorithmVersion !== currentProof.algorithmVersion ||
    guard.proofDemandedPairsIdentity !== currentProof.demandedPairsIdentity ||
    guard.proofExaminedComponentsIdentity !== currentProof.examinedComponentsIdentity ||
    guard.proofAlgorithmVersion !== currentProof.algorithmVersion
  ) {
    return null;
  }
  return Object.freeze(structuredClone(parsed.data));
}
