import { describe, expect, test } from "bun:test";
import {
  SemanticScoringInputProofV2Schema,
  SIMILARITY_ALGORITHM_VERSION,
} from "../src/semantic-scoring-input-proof-v2.js";
import { SemanticScoringInputProofSchema as ActiveProofSchema } from "../src/semantic-scoring-input-proof.js";

const digest = "a".repeat(64);

describe("staged semantic scoring proof v2", () => {
  test("accepts only the strict privacy-safe v2 digest contract", () => {
    expect(
      SemanticScoringInputProofV2Schema.parse({
        version: 2,
        mode: "unified-similarity",
        algorithmVersion: SIMILARITY_ALGORITHM_VERSION,
        identity: digest,
        demandedPairsIdentity: "b".repeat(64),
        examinedComponentsIdentity: "c".repeat(64),
      }),
    ).toEqual({
      version: 2,
      mode: "unified-similarity",
      algorithmVersion: "unified-jaccard-manhattan-jev-v1",
      identity: digest,
      demandedPairsIdentity: "b".repeat(64),
      examinedComponentsIdentity: "c".repeat(64),
    });
  });

  test("rejects v1 proofs, unknown fields, and note-bearing payloads", () => {
    const base = {
      version: 2,
      mode: "unified-similarity",
      algorithmVersion: SIMILARITY_ALGORITHM_VERSION,
      identity: digest,
      demandedPairsIdentity: "b".repeat(64),
      examinedComponentsIdentity: "c".repeat(64),
    };
    expect(SemanticScoringInputProofV2Schema.safeParse({ ...base, version: 1 }).success).toBe(
      false,
    );
    expect(
      ActiveProofSchema.safeParse({
        version: 1,
        mode: "factual-only",
        identity: digest,
      }).success,
    ).toBe(false);
    expect(
      SemanticScoringInputProofV2Schema.safeParse({ ...base, privateNote: "secret" }).success,
    ).toBe(false);
  });
});
