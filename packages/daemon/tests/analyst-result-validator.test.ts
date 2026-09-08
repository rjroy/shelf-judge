import { describe, expect, test } from "bun:test";
import type { AnalystFinal } from "@shelf-judge/shared";
import { z } from "zod";
import { createGroundedEvidenceRegistry } from "../src/services/grounded-analysis/evidence-registry.js";
import { createAnalystAttestationService } from "../src/services/analyst-attestation-service.js";
import { createAnalystCompletionService } from "../src/services/analyst-completion-service.js";
import type { AnalystRetrievedEvidence } from "../src/services/analyst-evidence-service.js";
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

function retrieved(noteDependencies: AnalystRetrievedEvidence["noteDependencies"] = []) {
  return {
    snapshotFingerprint: "snapshot",
    evidence: evidence(),
    citations: result().citations,
    noteDependencies,
    scope: {
      totalSourceCount: 1,
      matchingSourceCount: 1,
      examinedSourceCount: 1,
      exhaustive: true,
    },
    nextCursor: null,
  } satisfies AnalystRetrievedEvidence;
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
    for (const [citation, field] of [
      [{ ...result().citations[0], citationId: "fabricated" }, "evidence"],
      [{ ...result().citations[0], sourceId: "other-game" }, "sourceId"],
      [{ ...result().citations[0], sourceVersion: "2" }, "sourceVersion"],
    ] as const) {
      const submission = { ...result(), citations: [citation] };
      if (citation.citationId === "fabricated")
        submission.blocks = [{ ...submission.blocks[0], citationIds: ["fabricated"] }];
      expect(
        validateAnalystResult({
          submission,
          evidence: snapshot,
          registeredCitations: result().citations,
        }),
      ).toEqual({
        valid: false,
        diagnostic: { reason: "citation-mismatch", citationIndex: 0, field },
      });
    }
    expect(
      validateAnalystResult({
        submission: result(),
        evidence: snapshot,
        registeredCitations: result().citations,
        mandatoryUncertaintyCitationIds: new Set(["citation-a"]),
      }),
    ).toEqual({ valid: false, diagnostic: { reason: "mandatory-uncertainty-missing" } });
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

  test("rejects forged server-owned citation presentation and never signs invalid output", async () => {
    const snapshot = evidence();
    const registeredCitations = result().citations;
    for (const [citation, field] of [
      [{ ...registeredCitations[0], canonicalSummary: "Forged label" }, "canonicalSummary"],
      [{ ...registeredCitations[0], testimony: true }, "testimony"],
      [
        {
          ...registeredCitations[0],
          destination: { operationId: "shelf.collection.get", parameters: {} },
        },
        "destination",
      ],
    ] as const) {
      expect(
        validateAnalystResult({
          submission: { ...result(), citations: [citation] },
          evidence: snapshot,
          registeredCitations,
        }),
      ).toMatchObject(
        field === "testimony"
          ? {
              valid: false,
              diagnostic: {
                reason: "schema-invalid",
                code: "custom",
                path: ["citations", 0, "testimony"],
              },
            }
          : { valid: false, diagnostic: { reason: "citation-mismatch", citationIndex: 0, field } },
      );
    }
    const completion = createAnalystCompletionService({
      attestationService: createAnalystAttestationService(new Uint8Array(32).fill(1)),
      withRetrievedEvidence: (value, operation) => operation(value),
    });
    expect(
      await completion.complete({
        submission: {
          ...result(),
          citations: [{ ...registeredCitations[0], canonicalSummary: "Forged" }],
        },
        retrieved: retrieved(),
        mandatoryUncertaintyCitationIds: new Set(),
        conversationId: "conversation",
        turnIndex: 0,
        provider: { providerId: "provider", modelId: "model" },
      }),
    ).toEqual({ valid: false });

    let attestationAttempts = 0;
    const sourceChangingCompletion = createAnalystCompletionService({
      attestationService: {
        attest() {
          attestationAttempts += 1;
          return "must-not-be-created";
        },
        verifies: () => false,
      },
      withRetrievedEvidence: () => Promise.reject(new Error("source changed")),
    });
    expect(
      await sourceChangingCompletion.complete({
        submission: result(),
        retrieved: retrieved([{ gameId: "game-1", noteVersion: 1 }]),
        mandatoryUncertaintyCitationIds: new Set(),
        conversationId: "conversation",
        turnIndex: 0,
        provider: { providerId: "provider", modelId: "model" },
      }),
    ).toEqual({ valid: false, reason: "source-changed" });
    expect(attestationAttempts).toBe(0);
  });
});
