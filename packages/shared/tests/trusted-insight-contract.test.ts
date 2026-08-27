import { describe, expect, expectTypeOf, test } from "bun:test";
import type {
  AbstainedInsight,
  AxisSuggestion,
  InsufficientInsight,
  MissingComparatorInsight,
  CurrentAxisSuggestionAbstention,
  ReportedInsight,
  ReportedAxisSuggestion,
  ReportedCollectionOutlier,
  ReportedTournamentDivergence,
  ReportedInsightEvidenceGame,
  RetiredInsight,
  SatisfiedInsightRequirement,
  TrustedInsight,
  TournamentDivergenceDetails,
  TournamentDivergenceInsight,
  CollectionOutlier,
  UnmetInsightRequirement,
} from "../src/index";
import { CollectionProfileSchema } from "../src/index";
import { trustedInsightProfileFixture } from "./fixtures/trusted-profile";

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

const currentSuggestionMethod = {
  id: "directional-divergence-attribute-effect" as const,
  version: 1 as const,
  description:
    "Compares signed Tournament-versus-independent-fitness gaps for games with and without an attribute",
};

function reportedAxisSuggestion(): ReportedAxisSuggestion {
  const evidence: ReportedInsightEvidenceGame[] = Array.from({ length: 6 }, (_, index) => ({
    gameId: `game-${index + 1}`,
    gameName: `Game ${index + 1}`,
    role: index < 3 ? "subject" : "comparator",
    measurements: [
      {
        key: "signed-preference-gap",
        label: "Tournament minus independent fitness",
        value: index < 3 ? 4 : 0,
        unit: "rating",
        source: "Tournament comparisons and non-Tournament fitness axes",
      },
      {
        key: "comparison-count",
        label: "Tournament comparisons",
        value: 10,
        unit: "comparisons",
        source: "Tournament comparisons",
      },
    ],
  }));
  const firstEvidence = evidence[0];
  if (firstEvidence === undefined) throw new Error("Missing suggestion evidence fixture");
  return {
    contractVersion: 1,
    id: "axis-suggestion:tournament-outlier:mechanic:Area Control",
    status: "reported",
    method: currentSuggestionMethod,
    cohort: {
      description: "Six evaluated games",
      eligibleGameCount: 6,
      includedGameCount: 6,
      excludedGameCount: 0,
      coveragePercent: 100,
    },
    sufficiency: [
      { criterion: "attribute-positive evaluated games", observed: 3, required: 3, met: true },
      { criterion: "attribute-negative comparator games", observed: 3, required: 3, met: true },
    ],
    evidence: [firstEvidence, ...evidence.slice(1)],
    comparator: {
      description: "Games without Area Control",
      gameIds: ["game-4", "game-5", "game-6"],
    },
    limitations: ["This observational association does not establish causation"],
    observation: "Area Control games average a 4.0 signed preference gap versus 0.0 without it",
    interpretation: "Could Area Control explain the observed preference gap?",
    details: {
      source: "divergence-repair",
      attribute: "Area Control",
      attributeType: "mechanic",
      direction: "tournament-outlier",
      supportingGameCount: 3,
      comparatorGameCount: 3,
      supportingMeanGap: 4,
      comparatorMeanGap: 0,
      effect: 4,
    },
    notability: {
      metric: "directional signed-gap effect",
      value: 4,
      threshold: 1.5,
      direction: "above",
      explanation: "The effect exceeds the reporting threshold",
    },
    confidence: null,
  };
}

describe("TrustedInsight contract", () => {
  test("validates narration references and canonical trusted claim text", () => {
    const profile = structuredClone(trustedInsightProfileFixture);
    profile.narration = {
      summary: [
        {
          observation: "Game 3 is compositionally distant from its two nearest comparison games",
          interpretation: "Separately, its current preference fitness score is 8.0",
          evidenceReferences: [{ insightId: "outlier:game-3", gameIds: ["game-3"] }],
        },
      ],
      surprises: [],
      tensions: [],
      abstention: null,
    };
    profile.narrationState = "fresh";

    expect(CollectionProfileSchema.safeParse(profile).success).toBe(true);

    const unsupportedText = structuredClone(profile);
    const unsupportedClaim = unsupportedText.narration?.summary[0];
    if (unsupportedClaim === undefined) throw new Error("Missing narration fixture");
    unsupportedClaim.observation = "This unrelated conclusion borrows a valid reference";
    expect(CollectionProfileSchema.safeParse(unsupportedText).success).toBe(false);

    const suppressedReference = structuredClone(profile);
    const suppressedClaim = suppressedReference.narration?.summary[0];
    if (suppressedClaim === undefined) throw new Error("Missing narration fixture");
    suppressedClaim.evidenceReferences[0].insightId = "axis-suggestion:suppressed:confounded";
    expect(CollectionProfileSchema.safeParse(suppressedReference).success).toBe(false);

    const emptyGames = structuredClone(profile);
    const emptyGameClaim = emptyGames.narration?.summary[0];
    if (emptyGameClaim === undefined) throw new Error("Missing narration fixture");
    emptyGameClaim.evidenceReferences[0].gameIds = [];
    expect(CollectionProfileSchema.safeParse(emptyGames).success).toBe(false);

    const unsupportedAbstention = structuredClone(profile);
    unsupportedAbstention.narration = {
      summary: [],
      surprises: [],
      tensions: [],
      abstention: "The evidence is inconvenient, so no claim is available.",
    };
    expect(CollectionProfileSchema.safeParse(unsupportedAbstention).success).toBe(false);

    const duplicateReference = structuredClone(profile);
    const duplicateClaim = duplicateReference.narration?.summary[0];
    if (duplicateClaim === undefined) throw new Error("Missing narration fixture");
    duplicateClaim.evidenceReferences.push(structuredClone(duplicateClaim.evidenceReferences[0]));
    expect(CollectionProfileSchema.safeParse(duplicateReference).success).toBe(false);
  });

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

  test("axis suggestions expose every trusted state and require reported questions", () => {
    expectTypeOf<
      Extract<AxisSuggestion, { status: "reported" }>
    >().toEqualTypeOf<ReportedAxisSuggestion>();
    expectTypeOf<Extract<AxisSuggestion, { status: "insufficient" }>>().toEqualTypeOf<
      Extract<CurrentAxisSuggestionAbstention, { status: "insufficient" }>
    >();
    expectTypeOf<ReportedAxisSuggestion["interpretation"]>().toEqualTypeOf<string>();
    expectTypeOf<ReportedAxisSuggestion["notability"]["threshold"]>().toEqualTypeOf<number>();
    expectTypeOf<ReportedAxisSuggestion["notability"]["direction"]>().toEqualTypeOf<"above">();
    expectTypeOf<
      ReportedAxisSuggestion["method"]["id"]
    >().toEqualTypeOf<"directional-divergence-attribute-effect">();

    const insufficient: AxisSuggestion = {
      id: "axis-suggestion:current",
      status: "insufficient",
      ...commonEvidence,
      method: currentSuggestionMethod,
      sufficiency: [{ criterion: "evaluated games", observed: 2, required: 6, met: false }],
      evidence: [],
      comparator: null,
      reason: "insufficient-sample",
      explanation: "At least six evaluated games are required",
    };
    const retired: AxisSuggestion = {
      id: "axis-suggestion:retired:concentration",
      status: "retired",
      ...commonEvidence,
      method: {
        id: "unexpressed-concentration",
        version: 1,
        description: "Recommended axes from ownership concentration",
      },
      reason: "superseded",
      explanation: "Ownership concentration does not establish preference",
    };
    const suppressed: AxisSuggestion = {
      id: "axis-suggestion:suppressed",
      status: "suppressed",
      ...commonEvidence,
      method: currentSuggestionMethod,
      reason: "unsupported-method",
      explanation: "The method cannot support an interpretation",
    };
    const profile = {
      axisDistributions: [],
      axisWeights: [],
      bggClustering: {
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        weightRanges: [],
      },
      utilityCurves: [],
      divergence: null,
      outliers: [],
      suggestions: [reportedAxisSuggestion(), insufficient, suppressed, retired],
      narration: null,
      narrationState: "empty",
      gameCount: 24,
      ratedGameCount: 0,
      computedAt: "2026-08-27T12:00:00.000Z",
    };

    expect(CollectionProfileSchema.safeParse(profile).success).toBe(true);
    expect(CollectionProfileSchema.safeParse({ ...profile, suggestions: [] }).success).toBe(true);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [
          {
            ...insufficient,
            sufficiency: [
              {
                criterion: "evaluated games",
                observed: Number.NaN,
                required: 6,
                met: false,
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [{ ...retired, reason: "insufficient-sample" }],
      }).success,
    ).toBe(false);

    const reported = reportedAxisSuggestion();
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [{ ...reported, method: retired.method }],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [{ ...insufficient, method: retired.method }],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [{ ...retired, method: currentSuggestionMethod }],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [{ ...reported, method: { ...currentSuggestionMethod, version: 2 } }],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [{ ...retired, method: { ...retired.method, version: 2 } }],
      }).success,
    ).toBe(false);
  });

  test("reported suggestion means, direction, effect, and notability remain consistent", () => {
    const reported = reportedAxisSuggestion();
    const parse = (suggestion: unknown) =>
      CollectionProfileSchema.safeParse({
        ...trustedInsightProfileFixture,
        suggestions: [suggestion],
      }).success;

    expect(parse(reported)).toBe(true);
    const withGaps = (supporting: number[], comparator: number[]) => {
      const suggestion = structuredClone(reported);
      let supportingIndex = 0;
      let comparatorIndex = 0;
      for (const game of suggestion.evidence) {
        const gap = game.measurements.find(({ key }) => key === "signed-preference-gap");
        if (gap === undefined) throw new Error("Missing signed gap evidence");
        gap.value =
          game.role === "comparator"
            ? comparator[comparatorIndex++]
            : supporting[supportingIndex++];
      }
      return suggestion;
    };
    const independentlyRounded = withGaps([1.7, 1.7, 1.8], [0.1, 0.2, 0.2]);
    expect(
      parse({
        ...independentlyRounded,
        observation: "Area Control games average a 1.7 signed preference gap versus 0.2 without it",
        details: {
          ...independentlyRounded.details,
          supportingMeanGap: 1.7,
          comparatorMeanGap: 0.2,
          effect: 1.6,
        },
        notability: { ...independentlyRounded.notability, value: 1.6 },
      }),
    ).toBe(true);
    expect(
      parse({
        ...independentlyRounded,
        details: { ...independentlyRounded.details, effect: 1.59 },
        notability: { ...independentlyRounded.notability, value: 1.59 },
      }),
    ).toBe(false);
    const thresholdCrossing = withGaps([1.7, 1.7, 1.7], [0.2, 0.2, 0.2]);
    expect(
      parse({
        ...thresholdCrossing,
        observation: "Area Control games average a 1.7 signed preference gap versus 0.2 without it",
        details: {
          ...thresholdCrossing.details,
          supportingMeanGap: 1.7,
          comparatorMeanGap: 0.2,
          effect: 1.6,
        },
        notability: { ...thresholdCrossing.notability, value: 1.6 },
      }),
    ).toBe(false);
    const oppositeDirection = structuredClone(reported);
    for (const game of oppositeDirection.evidence) {
      if (game.role === "comparator") continue;
      const gap = game.measurements.find(({ key }) => key === "signed-preference-gap");
      if (gap === undefined) throw new Error("Missing signed gap evidence");
      gap.value = -4;
    }
    expect(
      parse({
        ...oppositeDirection,
        observation:
          "Area Control games average a -4.0 signed preference gap versus 0.0 without it",
        details: {
          ...oppositeDirection.details,
          direction: "fitness-outlier",
          supportingMeanGap: -4,
          comparatorMeanGap: 0,
          effect: 4,
        },
      }),
    ).toBe(true);

    const invalid = [
      {
        label: "contradictory rounded means",
        suggestion: {
          ...reported,
          details: { ...reported.details, comparatorMeanGap: 1 },
        },
      },
      {
        label: "contradictory effect",
        suggestion: {
          ...reported,
          details: { ...reported.details, effect: 3 },
          notability: { ...reported.notability, value: 3 },
        },
      },
      {
        label: "contradictory signed direction",
        suggestion: {
          ...reported,
          details: { ...reported.details, direction: "fitness-outlier" },
        },
      },
      {
        label: "notability exactly at threshold",
        suggestion: {
          ...reported,
          notability: { ...reported.notability, threshold: 4 },
        },
      },
      {
        label: "notability below threshold",
        suggestion: {
          ...reported,
          notability: { ...reported.notability, threshold: 5 },
        },
      },
      {
        label: "wrong notability direction",
        suggestion: {
          ...reported,
          notability: { ...reported.notability, direction: "below" },
        },
      },
      {
        label: "null notability threshold",
        suggestion: {
          ...reported,
          notability: { ...reported.notability, threshold: null },
        },
      },
      {
        label: "notability value different from effect",
        suggestion: {
          ...reported,
          notability: { ...reported.notability, value: 3 },
        },
      },
    ];
    for (const { label, suggestion } of invalid) {
      expect(parse(suggestion), label).toBe(false);
    }
  });

  test("reported suggestion evidence canonically determines group arithmetic", () => {
    const parse = (suggestion: unknown) =>
      CollectionProfileSchema.safeParse({
        ...trustedInsightProfileFixture,
        suggestions: [suggestion],
      }).success;
    const measurement = (
      suggestion: ReportedAxisSuggestion,
      key: "signed-preference-gap" | "comparison-count",
    ) => {
      const value = suggestion.evidence[0].measurements.find((candidate) => candidate.key === key);
      if (value === undefined) throw new Error(`Missing ${key} fixture measurement`);
      return value;
    };
    const cases: Array<{ label: string; mutate: (value: ReportedAxisSuggestion) => void }> = [
      {
        label: "fabricated signed gap",
        mutate: (value) => (measurement(value, "signed-preference-gap").value = 3),
      },
      {
        label: "arbitrary-precision signed gap",
        mutate: (value) => (measurement(value, "signed-preference-gap").value = 4.01),
      },
      {
        label: "missing signed gap",
        mutate: (value) => {
          const measurements = value.evidence[0].measurements;
          measurements.splice(
            measurements.findIndex(({ key }) => key === "signed-preference-gap"),
            1,
          );
        },
      },
      {
        label: "wrong signed gap source",
        mutate: (value) => (measurement(value, "signed-preference-gap").source = "Fabricated"),
      },
      {
        label: "duplicate signed gap",
        mutate: (value) =>
          value.evidence[0].measurements.push(
            structuredClone(measurement(value, "signed-preference-gap")),
          ),
      },
      {
        label: "missing comparison count",
        mutate: (value) => {
          const measurements = value.evidence[0].measurements;
          measurements.splice(
            measurements.findIndex(({ key }) => key === "comparison-count"),
            1,
          );
        },
      },
      {
        label: "wrong comparison count source",
        mutate: (value) => (measurement(value, "comparison-count").source = "Fabricated"),
      },
      {
        label: "duplicate comparison count",
        mutate: (value) =>
          value.evidence[0].measurements.push(
            structuredClone(measurement(value, "comparison-count")),
          ),
      },
      {
        label: "non-integer comparison count",
        mutate: (value) => (measurement(value, "comparison-count").value = 1.5),
      },
      {
        label: "duplicate supporting game record",
        mutate: (value) => value.evidence.push(structuredClone(value.evidence[0])),
      },
      {
        label: "fabricated supporting count",
        mutate: (value) => (value.details.supportingGameCount = 4),
      },
      {
        label: "fabricated comparator count",
        mutate: (value) => (value.details.comparatorGameCount = 4),
      },
    ];

    for (const { label, mutate } of cases) {
      const suggestion = reportedAxisSuggestion();
      mutate(suggestion);
      expect(parse(suggestion), label).toBe(false);
    }
  });

  test("profile insight cohorts require possible counts and matching coverage", () => {
    const suggestion: AxisSuggestion = {
      contractVersion: 1,
      id: "axis-suggestion:insufficient",
      status: "insufficient",
      reason: "insufficient-sample",
      method: currentSuggestionMethod,
      cohort: {
        description: "Evaluated games",
        eligibleGameCount: 6,
        includedGameCount: 2,
        excludedGameCount: 4,
        coveragePercent: 33.3,
      },
      sufficiency: [{ criterion: "evaluated games", observed: 2, required: 6, met: false }],
      evidence: [],
      comparator: null,
      limitations: [],
      explanation: "At least six evaluated games are required",
    };
    const profile = {
      axisDistributions: [],
      axisWeights: [],
      bggClustering: {
        mechanics: [],
        categories: [],
        families: [],
        subdomains: [],
        weightRanges: [],
      },
      utilityCurves: [],
      divergence: null,
      outliers: [],
      suggestions: [suggestion],
      narration: null,
      narrationState: "empty",
      gameCount: 6,
      ratedGameCount: 0,
      computedAt: "2026-08-27T12:00:00.000Z",
    };

    expect(CollectionProfileSchema.safeParse(profile).success).toBe(true);
    const exactToleranceBoundaries = [
      {
        eligibleGameCount: 80,
        includedGameCount: 1,
        excludedGameCount: 79,
        coveragePercent: 1.3,
      },
      {
        eligibleGameCount: 2000,
        includedGameCount: 339,
        excludedGameCount: 1661,
        coveragePercent: 16.9,
      },
    ];
    for (const cohort of exactToleranceBoundaries) {
      const expectedCoverage = (cohort.includedGameCount / cohort.eligibleGameCount) * 100;
      const awayFromExpected = Math.sign(cohort.coveragePercent - expectedCoverage);
      expect(
        CollectionProfileSchema.safeParse({
          ...profile,
          gameCount: cohort.eligibleGameCount,
          suggestions: [{ ...suggestion, cohort: { ...suggestion.cohort, ...cohort } }],
        }).success,
      ).toBe(true);
      expect(
        CollectionProfileSchema.safeParse({
          ...profile,
          gameCount: cohort.eligibleGameCount,
          suggestions: [
            {
              ...suggestion,
              cohort: {
                ...suggestion.cohort,
                ...cohort,
                coveragePercent: cohort.coveragePercent + awayFromExpected * 1e-12,
              },
            },
          ],
        }).success,
      ).toBe(false);
    }
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [
          {
            ...suggestion,
            cohort: { ...suggestion.cohort, excludedGameCount: 3 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        suggestions: [
          {
            ...suggestion,
            cohort: { ...suggestion.cohort, coveragePercent: 50 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(CollectionProfileSchema.safeParse({ ...profile, gameCount: 5 }).success).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        gameCount: 0,
        suggestions: [
          {
            ...suggestion,
            cohort: {
              ...suggestion.cohort,
              eligibleGameCount: 0,
              includedGameCount: 0,
              excludedGameCount: 0,
              coveragePercent: 0,
            },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        gameCount: 0,
        suggestions: [
          {
            ...suggestion,
            cohort: {
              ...suggestion.cohort,
              eligibleGameCount: 0,
              includedGameCount: 0,
              excludedGameCount: 0,
              coveragePercent: 0.01,
            },
          },
        ],
      }).success,
    ).toBe(false);

    const otherFamilyInsight = {
      contractVersion: 1 as const,
      id: "insight:insufficient",
      status: "insufficient" as const,
      reason: "insufficient-sample" as const,
      method: {
        id: "family-method",
        version: 1,
        description: "Family-specific method",
      },
      cohort: {
        description: "One eligible game",
        eligibleGameCount: 1,
        includedGameCount: 0,
        excludedGameCount: 1,
        coveragePercent: 0,
      },
      sufficiency: [{ criterion: "sample", observed: 0, required: 1, met: false as const }],
      evidence: [],
      comparator: null,
      limitations: [],
      explanation: "More games are required",
    };
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        gameCount: 0,
        suggestions: [],
        divergence: [otherFamilyInsight],
      }).success,
    ).toBe(false);
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        gameCount: 0,
        suggestions: [],
        outliers: [otherFamilyInsight],
      }).success,
    ).toBe(false);
  });

  test("reported suggestion comparison counts meet the Tournament eligibility minimum", () => {
    const parse = (suggestion: ReportedAxisSuggestion) =>
      CollectionProfileSchema.safeParse({
        ...trustedInsightProfileFixture,
        suggestions: [suggestion],
      }).success;
    const withComparisonCount = (value: number) => {
      const suggestion = reportedAxisSuggestion();
      for (const game of suggestion.evidence) {
        const count = game.measurements.find(({ key }) => key === "comparison-count");
        if (count === undefined) throw new Error("Missing comparison count evidence");
        count.value = value;
      }
      return suggestion;
    };

    expect(parse(withComparisonCount(0))).toBe(false);
    expect(parse(withComparisonCount(5))).toBe(false);
    expect(parse(withComparisonCount(6))).toBe(true);
  });
});

describe("reported Tournament divergence invariants", () => {
  function fixture() {
    const profile = structuredClone(trustedInsightProfileFixture);
    const divergence = profile.divergence?.[0];
    if (divergence?.status !== "reported") {
      throw new Error("Missing reported divergence fixture");
    }
    return { profile, divergence };
  }

  test("narrows the reported union to the runtime notability contract", () => {
    expectTypeOf<
      Extract<TournamentDivergenceInsight, { status: "reported" }>
    >().toEqualTypeOf<ReportedTournamentDivergence>();
    expectTypeOf<ReportedTournamentDivergence["notability"]["threshold"]>().toEqualTypeOf<number>();
    expectTypeOf<ReportedTournamentDivergence["confidence"]>().toEqualTypeOf<null>();
    expectTypeOf<
      ReportedTournamentDivergence["notability"]["direction"]
    >().toEqualTypeOf<"above">();
    expectTypeOf<Omit<ReportedTournamentDivergence, "confidence" | "notability">>().toEqualTypeOf<
      Omit<ReportedInsight<TournamentDivergenceDetails>, "confidence" | "notability">
    >();
  });

  test("accepts the persisted transport fixture with specialized reported notability", () => {
    const parsed = CollectionProfileSchema.parse(trustedInsightProfileFixture);
    const divergence = parsed.divergence?.[0];
    if (divergence?.status !== "reported") {
      throw new Error("Missing parsed reported divergence fixture");
    }

    expect(divergence.notability.threshold).toBe(1.5);
    expect(divergence.notability.direction).toBe("above");
  });

  test("accepts arithmetic differences within the existing floating-point representation bound", () => {
    const value = fixture();
    value.divergence.details.independentFitnessScore = 0.1;
    value.divergence.details.normalizedTournamentScore = 0.3;
    value.divergence.details.gap = 0.2;
    value.divergence.details.direction = "tournament-outlier";
    value.divergence.notability.value = 0.2;
    value.divergence.notability.threshold = 0.1;
    const measurements = value.divergence.evidence[0].measurements;
    const tournamentScore = measurements.find(({ key }) => key === "tournament-score");
    const independentScore = measurements.find(({ key }) => key === "independent-fitness-score");
    if (tournamentScore === undefined || independentScore === undefined) {
      throw new Error("Missing divergence score evidence");
    }
    tournamentScore.value = 0.3;
    independentScore.value = 0.1;

    expect(CollectionProfileSchema.safeParse(value.profile).success).toBe(true);
  });

  test.each([
    [
      "equal scores",
      ({ divergence }: ReturnType<typeof fixture>) => {
        divergence.details.normalizedTournamentScore = 4;
        divergence.details.independentFitnessScore = 4;
        divergence.details.gap = 0;
        divergence.notability.value = 0;
      },
    ],
    [
      "zero gap",
      ({ divergence }: ReturnType<typeof fixture>) => {
        divergence.details.gap = 0;
        divergence.notability.value = 0;
      },
    ],
    [
      "gap exactly at the declared threshold",
      ({ divergence }: ReturnType<typeof fixture>) => {
        divergence.details.normalizedTournamentScore = 5.5;
        divergence.details.independentFitnessScore = 4;
        divergence.details.gap = 1.5;
        divergence.notability.value = 1.5;
      },
    ],
    [
      "gap below the declared threshold",
      ({ divergence }: ReturnType<typeof fixture>) => {
        divergence.details.normalizedTournamentScore = 5;
        divergence.details.independentFitnessScore = 4;
        divergence.details.gap = 1;
        divergence.notability.value = 1;
      },
    ],
  ])("rejects reported divergence with %s", (_label, mutate) => {
    const value = fixture();
    mutate(value);
    expect(CollectionProfileSchema.safeParse(value.profile).success).toBe(false);
  });

  test.each([
    [
      "stable ID",
      ({ divergence }: ReturnType<typeof fixture>) => (divergence.id = "divergence:other"),
    ],
    [
      "subject identity",
      ({ divergence }: ReturnType<typeof fixture>) => {
        const subject = divergence.evidence[0];
        if (subject === undefined) throw new Error("Missing subject evidence");
        subject.gameId = "other";
      },
    ],
    [
      "subject name",
      ({ divergence }: ReturnType<typeof fixture>) => {
        const subject = divergence.evidence[0];
        if (subject === undefined) throw new Error("Missing subject evidence");
        subject.gameName = "Wrong Game";
      },
    ],
    [
      "comparator alignment",
      ({ divergence }: ReturnType<typeof fixture>) => {
        if (divergence.comparator === null) throw new Error("Missing comparator fixture");
        divergence.comparator.gameIds = ["other"];
      },
    ],
    [
      "gap arithmetic",
      ({ divergence }: ReturnType<typeof fixture>) => (divergence.details.gap = 3),
    ],
    [
      "score direction",
      ({ divergence }: ReturnType<typeof fixture>) =>
        (divergence.details.direction = "fitness-outlier"),
    ],
    [
      "comparison count",
      ({ divergence }: ReturnType<typeof fixture>) => (divergence.details.comparisonCount = 9),
    ],
    [
      "comparison sufficiency",
      ({ divergence }: ReturnType<typeof fixture>) => {
        const requirement = divergence.sufficiency.find(
          ({ criterion }) => criterion === "comparisons for subject game",
        );
        if (requirement === undefined) throw new Error("Missing comparison requirement");
        requirement.observed = 9;
      },
    ],
    [
      "provisional status",
      ({ divergence }: ReturnType<typeof fixture>) => (divergence.details.provisional = true),
    ],
    [
      "notability value",
      ({ divergence }: ReturnType<typeof fixture>) => (divergence.notability.value = 3),
    ],
  ])("rejects mismatched %s", (_label, mutate) => {
    const value = fixture();
    mutate(value);
    expect(CollectionProfileSchema.safeParse(value.profile).success).toBe(false);
  });

  test.each([
    ["Tournament score", "tournament-score", 7],
    ["independent fitness score", "independent-fitness-score", 5],
    ["comparison count", "comparison-count", 9],
    ["provisional state", "provisional", true],
  ])("rejects mismatched %s subject evidence", (_label, key, value) => {
    const { profile, divergence } = fixture();
    const measurement = divergence.evidence[0].measurements.find(
      (candidate) => candidate.key === key,
    );
    if (measurement === undefined) throw new Error(`Missing ${key} evidence`);
    measurement.value = value;
    expect(CollectionProfileSchema.safeParse(profile).success).toBe(false);
  });

  test("rejects missing and incorrectly sourced divergence measurements", () => {
    const missing = fixture();
    missing.divergence.evidence[0].measurements =
      missing.divergence.evidence[0].measurements.filter(
        ({ key }) => key !== "comparison-count",
      ) as (typeof missing.divergence.evidence)[0]["measurements"];
    expect(CollectionProfileSchema.safeParse(missing.profile).success).toBe(false);

    const wrongSource = fixture();
    const provisional = wrongSource.divergence.evidence[0].measurements.find(
      ({ key }) => key === "provisional",
    );
    if (provisional === undefined) throw new Error("Missing provisional evidence");
    provisional.source = "Tournament comparisons";
    expect(CollectionProfileSchema.safeParse(wrongSource.profile).success).toBe(false);
  });
});

describe("reported collection outlier notability", () => {
  function fixture() {
    const profile = structuredClone(trustedInsightProfileFixture);
    const outlier = profile.outliers.find((insight) => insight.status === "reported");
    if (outlier?.status !== "reported") throw new Error("Missing reported outlier fixture");
    profile.outliers = [outlier];
    return { profile, outlier };
  }

  test("narrows the reported union to above-threshold notability", () => {
    expectTypeOf<
      Extract<CollectionOutlier, { status: "reported" }>
    >().toEqualTypeOf<ReportedCollectionOutlier>();
    expectTypeOf<ReportedCollectionOutlier["notability"]["threshold"]>().toEqualTypeOf<number>();
    expectTypeOf<ReportedCollectionOutlier["confidence"]>().toEqualTypeOf<null>();
    expectTypeOf<ReportedCollectionOutlier["notability"]["direction"]>().toEqualTypeOf<"above">();
  });

  test("accepts fixture and floating-point-compatible reported outliers", () => {
    expect(CollectionProfileSchema.safeParse(fixture().profile).success).toBe(true);
    const floating = fixture();
    floating.outlier.details.neighborhoodDistance = 0.1 + 0.7;
    floating.outlier.notability.value = 0.8;
    floating.outlier.notability.threshold = 0.7;
    const subjectDistance = floating.outlier.evidence
      .find(({ role }) => role === "subject")
      ?.measurements.find(({ key }) => key === "neighborhood-distance");
    if (subjectDistance === undefined) throw new Error("Missing subject distance evidence");
    subjectDistance.value = 0.8;
    expect(CollectionProfileSchema.safeParse(floating.profile).success).toBe(true);
  });

  test("requires two distinct drivers that are material against both comparators", () => {
    const single = fixture();
    single.outlier.details.drivers.splice(1, 1);
    expect(CollectionProfileSchema.safeParse(single.profile).success).toBe(false);

    const duplicate = fixture();
    duplicate.outlier.details.drivers[1] = structuredClone(duplicate.outlier.details.drivers[0]);
    expect(CollectionProfileSchema.safeParse(duplicate.profile).success).toBe(false);

    const belowThreshold = fixture();
    const firstComparator = belowThreshold.outlier.evidence.find(
      ({ gameId }) => gameId === "game-4",
    );
    if (firstComparator === undefined) throw new Error("Missing first outlier comparator");
    const categoryDistance = firstComparator.measurements.find(
      ({ key }) => key === "categories-distance",
    );
    const subjectDistance = firstComparator.measurements.find(
      ({ key }) => key === "subject-distance",
    );
    const neighborhoodDistance = belowThreshold.outlier.evidence
      .find(({ role }) => role === "subject")
      ?.measurements.find(({ key }) => key === "neighborhood-distance");
    if (
      categoryDistance === undefined ||
      subjectDistance === undefined ||
      neighborhoodDistance === undefined
    ) {
      throw new Error("Missing outlier distance evidence");
    }
    categoryDistance.value = 0.3;
    subjectDistance.value = 0.65;
    neighborhoodDistance.value = 0.75;
    belowThreshold.outlier.details.nearestComparisons[0].distance = 0.65;
    belowThreshold.outlier.details.neighborhoodDistance = 0.75;
    belowThreshold.outlier.details.drivers[1].distance = 0.6;
    belowThreshold.outlier.notability.value = 0.75;
    expect(CollectionProfileSchema.safeParse(belowThreshold.profile).success).toBe(false);
  });

  test("rejects fitness context without a matching sourced subject measurement", () => {
    const missing = fixture();
    const subject = missing.outlier.evidence.find(({ role }) => role === "subject");
    if (subject === undefined) throw new Error("Missing outlier subject evidence");
    subject.measurements = subject.measurements.filter(({ key }) => key !== "fitness-score") as [
      (typeof subject.measurements)[number],
      ...(typeof subject.measurements)[number][],
    ];
    expect(CollectionProfileSchema.safeParse(missing.profile).success).toBe(false);

    const mismatched = fixture();
    const measurement = mismatched.outlier.evidence
      .find(({ role }) => role === "subject")
      ?.measurements.find(({ key }) => key === "fitness-score");
    if (measurement === undefined) throw new Error("Missing outlier fitness evidence");
    measurement.value = 7;
    expect(CollectionProfileSchema.safeParse(mismatched.profile).success).toBe(false);

    const unsupported = fixture();
    unsupported.outlier.interpretation =
      "Separately, its current preference fitness score is 8.0 and is vetoed";
    expect(CollectionProfileSchema.safeParse(unsupported.profile).success).toBe(false);
  });

  test.each([
    [
      "threshold exactly equal to value",
      ({ outlier }: ReturnType<typeof fixture>) =>
        (outlier.notability.threshold = outlier.notability.value),
    ],
    [
      "value below threshold",
      ({ outlier }: ReturnType<typeof fixture>) => (outlier.notability.threshold = 0.9),
    ],
    [
      "value inconsistent with neighborhood distance",
      ({ outlier }: ReturnType<typeof fixture>) => (outlier.notability.value = 0.7),
    ],
  ])("rejects %s", (_label, mutate) => {
    const value = fixture();
    mutate(value);
    expect(CollectionProfileSchema.safeParse(value.profile).success).toBe(false);
  });

  test.each([
    [
      "subject neighborhood distance evidence",
      ({ outlier }: ReturnType<typeof fixture>) => {
        const measurement = outlier.evidence
          .find(({ role }) => role === "subject")
          ?.measurements.find(({ key }) => key === "neighborhood-distance");
        if (measurement === undefined) throw new Error("Missing neighborhood evidence");
        measurement.value = 0.7;
      },
    ],
    [
      "nearest comparator distance evidence",
      ({ outlier }: ReturnType<typeof fixture>) => {
        const measurement = outlier.evidence
          .find(({ role }) => role === "comparator")
          ?.measurements.find(({ key }) => key === "subject-distance");
        if (measurement === undefined) throw new Error("Missing comparator distance evidence");
        measurement.value = 0.7;
      },
    ],
    [
      "driver subject value evidence",
      ({ outlier }: ReturnType<typeof fixture>) => {
        const measurement = outlier.evidence
          .find(({ role }) => role === "subject")
          ?.measurements.find(({ key }) => key === "mechanics");
        if (measurement === undefined) throw new Error("Missing subject mechanics evidence");
        measurement.value = "Deck Building";
      },
    ],
    [
      "driver comparator value evidence",
      ({ outlier }: ReturnType<typeof fixture>) => {
        const measurement = outlier.evidence
          .find(({ role }) => role === "comparator")
          ?.measurements.find(({ key }) => key === "mechanics");
        if (measurement === undefined) throw new Error("Missing comparator mechanics evidence");
        measurement.value = "Area Control";
      },
    ],
    [
      "driver distance evidence",
      ({ outlier }: ReturnType<typeof fixture>) => {
        const measurement = outlier.evidence
          .find(({ role }) => role === "comparator")
          ?.measurements.find(({ key }) => key === "mechanics-distance");
        if (measurement === undefined) throw new Error("Missing driver distance evidence");
        measurement.value = 0.8;
      },
    ],
    [
      "required dimension distance evidence",
      ({ outlier }: ReturnType<typeof fixture>) => {
        const evidence = outlier.evidence.find(({ role }) => role === "comparator");
        if (evidence === undefined) throw new Error("Missing comparator evidence");
        evidence.measurements = evidence.measurements.filter(
          ({ key }) => key !== "categories-distance",
        ) as typeof evidence.measurements;
      },
    ],
  ])("rejects mismatched or missing %s", (_label, mutate) => {
    const value = fixture();
    mutate(value);
    expect(CollectionProfileSchema.safeParse(value.profile).success).toBe(false);
  });

  test.each([
    ["wrong direction", { direction: "below", threshold: 0.5 }],
    ["null threshold", { direction: "above", threshold: null }],
  ])("rejects %s", (_label, notabilityPatch) => {
    const { profile, outlier } = fixture();
    expect(
      CollectionProfileSchema.safeParse({
        ...profile,
        outliers: [
          {
            ...outlier,
            notability: { ...outlier.notability, ...notabilityPatch },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
