import { z } from "zod";

/** Versioned algorithm identity for staged unified factual/JEV scoring. */
export const SIMILARITY_ALGORITHM_VERSION = "unified-jaccard-manhattan-jev-v1" as const;

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Staged privacy-safe proof. Only opaque digests cross the publication boundary;
 * source text, note text, cache rows and process-local freshness tokens are excluded.
 * This schema intentionally remains unexported from the shared package index until
 * the atomic production activation phase.
 */
export const SemanticScoringInputProofV2Schema = z
  .object({
    version: z.literal(2),
    mode: z.literal("unified-similarity"),
    algorithmVersion: z.literal(SIMILARITY_ALGORITHM_VERSION),
    identity: DigestSchema,
    demandedPairsIdentity: DigestSchema,
    examinedComponentsIdentity: DigestSchema,
  })
  .strict();

export type SemanticScoringInputProofV2 = z.infer<typeof SemanticScoringInputProofV2Schema>;
