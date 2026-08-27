import { describe, expect, test } from "bun:test";
import type { ProfileNarration } from "@shelf-judge/shared";
import {
  emptyInsightProfileFixture,
  trustedInsightProfileFixture,
} from "../../shared/tests/fixtures/trusted-profile.js";
import {
  buildNarrationEvidence,
  createNarrationService,
  validateNarrationEvidence,
} from "../src/services/narration-service.js";

function groundedNarration(): ProfileNarration {
  return {
    summary: [
      {
        observation: "Game 3 is compositionally distant from its two nearest comparison games",
        interpretation: "Separately, its current preference fitness score is 8.0",
        evidenceReferences: [{ insightId: "outlier:game-3", gameIds: ["game-3"] }],
      },
    ],
    surprises: [],
    tensions: [
      {
        observation: "Tournament score is 4.0 points above independent fitness",
        interpretation:
          "Tournament choices favor this game more than the configured non-Tournament axes predict",
        evidenceReferences: [{ insightId: "divergence:game-1", gameIds: ["game-1"] }],
      },
    ],
    abstention: null,
  };
}

function firstReference(narration: ProfileNarration, section: "summary" | "tensions") {
  const reference = narration[section][0]?.evidenceReferences[0];
  if (reference === undefined) throw new Error(`Missing ${section} reference fixture`);
  return reference;
}

describe("trusted narration grounding", () => {
  test("feeds the narrator only reported insights", () => {
    const evidence = buildNarrationEvidence(trustedInsightProfileFixture);

    expect(evidence.insights.map(({ insight }) => insight.id)).toEqual([
      "divergence:game-1",
      "outlier:game-3",
      "axis-suggestion:tournament-outlier:mechanic:Area Control",
    ]);
    expect(evidence.insights.every(({ insight }) => insight.status === "reported")).toBe(true);
  });

  test("accepts claims with inspectable reported insight and game references", () => {
    const narration = groundedNarration();
    expect(validateNarrationEvidence(narration, trustedInsightProfileFixture)).toBe(narration);
  });

  test("rejects suppressed insights and games outside the referenced evidence", () => {
    const suppressed = groundedNarration();
    firstReference(suppressed, "summary").insightId = "axis-suggestion:suppressed:confounded";
    expect(() => validateNarrationEvidence(suppressed, trustedInsightProfileFixture)).toThrow(
      "unavailable insight",
    );

    const unrelatedGame = groundedNarration();
    firstReference(unrelatedGame, "summary").gameIds = ["game-1"];
    expect(() => validateNarrationEvidence(unrelatedGame, trustedInsightProfileFixture)).toThrow(
      "game outside insight",
    );
  });

  test("rejects unsupported text even when it borrows valid evidence references", () => {
    const narration = groundedNarration();
    const claim = narration.summary[0];
    if (claim === undefined) throw new Error("Missing summary claim fixture");
    claim.observation = "Game 3 proves this user dislikes deck building.";

    expect(() => validateNarrationEvidence(narration, trustedInsightProfileFixture)).toThrow(
      "text does not match its trusted evidence",
    );
  });

  test("rejects duplicate insight references within one claim", () => {
    const narration = groundedNarration();
    const reference = structuredClone(firstReference(narration, "summary"));
    narration.summary[0]?.evidenceReferences.push(reference);

    expect(() => validateNarrationEvidence(narration, trustedInsightProfileFixture)).toThrow(
      "repeats an insight reference",
    );
  });

  test("refuses to narrate a tension without reported divergence evidence", () => {
    const narration = groundedNarration();
    firstReference(narration, "tensions").insightId = "outlier:game-3";
    firstReference(narration, "tensions").gameIds = ["game-3"];
    const tension = narration.tensions[0];
    if (tension === undefined) throw new Error("Missing tension fixture");
    tension.observation = "Game 3 is compositionally distant from its two nearest comparison games";
    tension.interpretation = "Separately, its current preference fitness score is 8.0";

    expect(() => validateNarrationEvidence(narration, trustedInsightProfileFixture)).toThrow(
      "tensions require reported divergence",
    );
  });

  test("abstains deterministically when no reported evidence is available", async () => {
    const narration = await createNarrationService().generateNarration(emptyInsightProfileFixture);

    expect(narration).toEqual({
      summary: [],
      surprises: [],
      tensions: [],
      abstention: "No reported trusted insights are available to narrate.",
    });
  });
});
