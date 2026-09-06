import { describe, expect, test } from "bun:test";
import type { AnalystFinal } from "@shelf-judge/shared";
import { z } from "zod";
import { createGroundedEvidenceRegistry } from "../src/services/grounded-analysis/evidence-registry.js";
import { createAnalystAttestationService } from "../src/services/analyst-attestation-service.js";
import { createAnalystCompletionService } from "../src/services/analyst-completion-service.js";
import { validateAnalystResult } from "../src/services/analyst-result-validator.js";

function evidence() {
  const registry = createGroundedEvidenceRegistry({
    manifest: {
      manifestId: "analyst",
      manifestVersion: "1",
      evidence: { "current-scoring": z.object({ gameId: z.string() }).strict() },
    },
    evidenceIdentitySchema: z
      .object({
        citationId: z.string(),
        sourceId: z.string(),
        sourceVersion: z.string(),
        evidenceClass: z.literal("current-scoring"),
      })
      .strict(),
    expectedSources: [{ sourceId: "game-a", sourceVersion: "1", evidenceClass: "current-scoring" }],
  });
  registry.recordExamined({
    sourceId: "game-a",
    sourceVersion: "1",
    evidenceClass: "current-scoring",
  });
  registry.add({
    citationId: "citation-a",
    sourceId: "game-a",
    sourceVersion: "1",
    evidenceClass: "current-scoring",
    payload: { gameId: "game-a" },
  });
  return registry.complete();
}

function result(): AnalystFinal {
  return {
    outcome: "answered" as const,
    blocks: [{ text: "A current score is available.", citationIds: ["citation-a"] }],
    citations: [
      {
        citationId: "citation-a",
        sourceId: "game-a",
        sourceVersion: "1",
        evidenceClass: "current-scoring" as const,
        canonicalSummary: "Current score",
        testimony: false,
        destination: { operationId: "shelf.game.get", parameters: { gameId: "game-a" } },
      },
    ],
    usage: { state: "unavailable" as const },
  };
}

describe("Analyst structured result validation", () => {
  test("rejects fabricated, cross-turn, wrong-version, and mandatory-uncertainty citations", () => {
    const snapshot = evidence();
    expect(
      validateAnalystResult({
        submission: result(),
        evidence: snapshot,
        registeredCitations: result().citations,
      }),
    ).toEqual({
      valid: true,
      result: result(),
    });
    for (const citation of [
      { ...result().citations[0], citationId: "fabricated" },
      { ...result().citations[0], sourceId: "other-game" },
      { ...result().citations[0], sourceVersion: "2" },
    ])
      expect(
        validateAnalystResult({
          submission: { ...result(), citations: [citation] },
          evidence: snapshot,
          registeredCitations: result().citations,
        }),
      ).toEqual({ valid: false });
    expect(
      validateAnalystResult({
        submission: result(),
        evidence: snapshot,
        registeredCitations: result().citations,
        mandatoryUncertaintyCitationIds: new Set(["citation-a"]),
      }),
    ).toEqual({ valid: false });
  });

  test("accepts mandatory uncertainty only when the affected block states it", () => {
    const submission = result();
    submission.blocks[0] = {
      ...submission.blocks[0],
      uncertainty: "The score is predicted, so it may change.",
    };
    expect(
      validateAnalystResult({
        submission,
        evidence: evidence(),
        registeredCitations: result().citations,
        mandatoryUncertaintyCitationIds: new Set(["citation-a"]),
      }).valid,
    ).toBe(true);
  });

  test("requires a limitation for every evidence condition marked uncertain by retrieval", () => {
    for (const condition of [
      "sparse support",
      "conflicting facts",
      "incomplete scope",
      "predicted value",
      "stale warning",
      "material confounder",
      "testimony conflict",
    ]) {
      const submission = result();
      submission.blocks[0] = {
        ...submission.blocks[0],
        uncertainty: `${condition} limits this conclusion.`,
      };
      expect(
        validateAnalystResult({
          submission,
          evidence: evidence(),
          registeredCitations: result().citations,
          mandatoryUncertaintyCitationIds: new Set(["citation-a"]),
        }).valid,
        condition,
      ).toBe(true);
    }
  });

  test("rejects forged server-owned citation presentation and never signs invalid output", () => {
    const snapshot = evidence();
    const registeredCitations = result().citations;
    for (const citation of [
      { ...registeredCitations[0], canonicalSummary: "Forged label" },
      { ...registeredCitations[0], testimony: true },
      {
        ...registeredCitations[0],
        destination: { operationId: "shelf.collection.get", parameters: {} },
      },
    ]) {
      expect(
        validateAnalystResult({
          submission: { ...result(), citations: [citation] },
          evidence: snapshot,
          registeredCitations,
        }),
      ).toEqual({ valid: false });
    }
    const completion = createAnalystCompletionService({
      attestationService: createAnalystAttestationService(new Uint8Array(32).fill(1)),
    });
    expect(
      completion.complete({
        submission: {
          ...result(),
          citations: [{ ...registeredCitations[0], canonicalSummary: "Forged" }],
        },
        evidence: snapshot,
        registeredCitations,
        mandatoryUncertaintyCitationIds: new Set(),
        conversationId: "conversation",
        turnIndex: 0,
        provider: { providerId: "provider", modelId: "model" },
        noteDependencies: [],
      }),
    ).toEqual({ valid: false });
  });
});
