import { describe, expect, expectTypeOf, test } from "bun:test";
import type {
  AbstainedInsight,
  InsufficientInsight,
  MissingComparatorInsight,
  ReportedInsight,
  ReportedInsightEvidenceGame,
  RetiredInsight,
  SatisfiedInsightRequirement,
  TrustedInsight,
  UnmetInsightRequirement,
} from "../src/index";

interface DivergenceDetails {
  fitnessScore: number;
  tournamentScore: number;
}

const commonEvidence = {
  contractVersion: 1 as const,
  method: {
    id: "tournament-preference-divergence",
    version: 1,
    description: "Compares independent axis fitness with tournament preference",
  },
  cohort: {
    description: "Currently owned games with independent ratings and tournament results",
    eligibleGameCount: 24,
    includedGameCount: 18,
    excludedGameCount: 6,
    coveragePercent: 75,
  },
  sufficiency: [
    {
      criterion: "comparisons for subject game",
      observed: 9,
      required: 6,
      met: true,
    },
  ] satisfies [SatisfiedInsightRequirement, ...SatisfiedInsightRequirement[]],
  evidence: [
    {
      gameId: "game-1",
      gameName: "Example Game",
      role: "subject" as const,
      measurements: [
        {
          key: "tournament-score",
          label: "Tournament score",
          value: 8.2,
          unit: "rating",
          source: "tournament comparisons",
        },
      ],
    },
  ] satisfies [ReportedInsightEvidenceGame, ...ReportedInsightEvidenceGame[]],
  comparator: {
    description: "Independent fitness excluding Tournament-source contributions",
    gameIds: ["game-1"],
  },
  limitations: ["Tournament preference reflects the opponents compared so far"],
};

describe("TrustedInsight contract", () => {
  test("reported insights separate observation, interpretation, and typed details", () => {
    const insight: ReportedInsight<DivergenceDetails> = {
      id: "divergence:game-1",
      status: "reported",
      ...commonEvidence,
      observation: "Tournament score is 2.1 points above independent fitness",
      interpretation: "This game may provide value not represented by the configured axes",
      details: { fitnessScore: 6.1, tournamentScore: 8.2 },
      notability: {
        metric: "absolute score gap",
        value: 2.1,
        threshold: 1.5,
        direction: "above",
        explanation: "The gap exceeds the configured reporting threshold",
      },
      confidence: {
        level: "moderate",
        basis: "Nine comparisons meet the minimum but cover a limited opponent set",
      },
    };

    const contract: TrustedInsight<DivergenceDetails> = insight;
    expect(contract.status).toBe("reported");
    expect(contract.evidence[0]?.gameId).toBe("game-1");
    expect(contract.sufficiency.every((requirement) => requirement.met)).toBe(true);
    expectTypeOf(contract.details).toEqualTypeOf<DivergenceDetails>();
    expectTypeOf(contract.evidence[0].measurements[0].value).toEqualTypeOf<
      string | number | boolean | null
    >();
    expectTypeOf(contract.sufficiency[0].met).toEqualTypeOf<true>();
  });

  test("abstained insights explain why no interpretation is reported", () => {
    const insight: AbstainedInsight = {
      id: "divergence:game-2",
      status: "insufficient",
      ...commonEvidence,
      sufficiency: [
        {
          criterion: "comparisons for subject game",
          observed: 2,
          required: 6,
          met: false,
        },
      ] satisfies [UnmetInsightRequirement, ...UnmetInsightRequirement[]],
      evidence: [],
      comparator: null,
      reason: "insufficient-sample",
      explanation: "At least six comparisons are required before reporting divergence",
    };

    const contract: TrustedInsight<DivergenceDetails> = insight;
    expect(contract.status).toBe("insufficient");
    expect(contract.sufficiency.some((requirement) => !requirement.met)).toBe(true);
    expect("details" in contract).toBe(false);
    expect("interpretation" in contract).toBe(false);

    type ReportedEvidenceAcceptsEmpty = [] extends ReportedInsight<DivergenceDetails>["evidence"]
      ? true
      : false;
    type ReportedSufficiencyAcceptsEmpty =
      [] extends ReportedInsight<DivergenceDetails>["sufficiency"] ? true : false;
    type InsufficientSample = Extract<InsufficientInsight, { reason: "insufficient-sample" }>;
    expectTypeOf<ReportedEvidenceAcceptsEmpty>().toEqualTypeOf<false>();
    expectTypeOf<ReportedSufficiencyAcceptsEmpty>().toEqualTypeOf<false>();
    expectTypeOf<InsufficientSample["sufficiency"][0]["met"]>().toEqualTypeOf<false>();
    expectTypeOf<MissingComparatorInsight["comparator"]>().toEqualTypeOf<null>();
  });

  test("suppressed and retired states use explicit non-sample reasons", () => {
    const statuses: AbstainedInsight[] = [
      {
        id: "suggestion:concentration",
        status: "suppressed",
        ...commonEvidence,
        reason: "unsupported-method",
        explanation: "Concentration alone does not show an effect on preference",
      },
      {
        id: "outlier:legacy-centroid",
        status: "retired",
        ...commonEvidence,
        reason: "superseded",
        explanation: "A collection-appropriate detector replaced this method",
      },
    ];

    expect(statuses.map(({ status }) => status)).toEqual(["suppressed", "retired"]);
    expectTypeOf<RetiredInsight["reason"]>().toEqualTypeOf<"superseded">();
  });
});
