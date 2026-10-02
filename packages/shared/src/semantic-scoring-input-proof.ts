import { z } from "zod";

const SemanticCoverageIdentitySchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Privacy-safe proof of the semantic-scoring inputs represented by a publication. */
export const SemanticScoringInputProofSchema = z.discriminatedUnion("mode", [
  z
    .object({
      version: z.literal(1),
      mode: z.enum(["disabled", "factual-only"]),
      identity: SemanticCoverageIdentitySchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      mode: z.literal("semantic"),
      status: z.enum(["ready", "partial", "factual", "not-ready"]),
      coverageVersion: z.number().int().safe().positive(),
      identity: SemanticCoverageIdentitySchema,
    })
    .strict(),
]);

export type SemanticScoringInputProof = z.infer<typeof SemanticScoringInputProofSchema>;
