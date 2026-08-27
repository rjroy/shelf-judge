import type {
  CollectionOutlier,
  CollectionProfile,
  ReportedAxisSuggestion,
  ReportedInsightEvidenceGame,
  TournamentDivergenceInsight,
} from "@shelf-judge/shared";

const currentMethod = {
  id: "directional-divergence-attribute-effect" as const,
  version: 1 as const,
  description:
    "Compares signed Tournament-versus-independent-fitness gaps for games with and without an attribute",
};

const cohort = {
  description: "Six BGG-backed games with Tournament and independent fitness data",
  eligibleGameCount: 6,
  includedGameCount: 6,
  excludedGameCount: 0,
  coveragePercent: 100,
};

function reportedSuggestion(): ReportedAxisSuggestion {
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
  if (firstEvidence === undefined) throw new Error("Missing trusted profile evidence fixture");

  return {
    contractVersion: 1,
    id: "axis-suggestion:tournament-outlier:mechanic:Area Control",
    status: "reported",
    method: currentMethod,
    cohort,
    sufficiency: [
      { criterion: "attribute-positive evaluated games", observed: 3, required: 3, met: true },
      { criterion: "attribute-negative comparator games", observed: 3, required: 3, met: true },
    ],
    evidence: [firstEvidence, ...evidence.slice(1)],
    comparator: {
      description: "Evaluated games without Area Control",
      gameIds: ["game-4", "game-5", "game-6"],
    },
    limitations: [
      "This observational association does not prove that the attribute causes preference",
      "Tournament preference reflects only the opponents compared so far",
    ],
    observation: "Area Control games average a 4.0 signed preference gap versus 0.0 without it",
    interpretation: "Could Area Control explain why Tournament preference is higher?",
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
      explanation: "The directional gap differs by at least 1.5 points",
    },
    confidence: null,
  };
}

const divergenceMethod = {
  id: "tournament-preference-divergence",
  version: 2,
  description: "Compares Tournament preference with fitness excluding Tournament axes",
};

const divergenceCohort = {
  description: "Collection games with Tournament results and non-Tournament fitness evidence",
  eligibleGameCount: 6,
  includedGameCount: 4,
  excludedGameCount: 2,
  coveragePercent: 66.7,
};

const divergence: TournamentDivergenceInsight[] = [
  {
    contractVersion: 1,
    id: "divergence:game-1",
    status: "reported",
    method: divergenceMethod,
    cohort: divergenceCohort,
    sufficiency: [
      { criterion: "comparisons for subject game", observed: 10, required: 6, met: true },
      { criterion: "normalized Tournament score available", observed: 1, required: 1, met: true },
      { criterion: "independent non-Tournament axes", observed: 1, required: 1, met: true },
    ],
    evidence: [
      {
        gameId: "game-1",
        gameName: "Game 1",
        role: "subject",
        measurements: [
          {
            key: "tournament-score",
            label: "Tournament score",
            value: 8,
            unit: "rating",
            source: "Tournament comparisons",
          },
          {
            key: "independent-fitness-score",
            label: "Independent fitness",
            value: 4,
            unit: "rating",
            source: "Non-Tournament fitness axes",
          },
          {
            key: "comparison-count",
            label: "Tournament comparisons",
            value: 10,
            unit: "comparisons",
            source: "Tournament comparisons",
          },
          {
            key: "provisional",
            label: "Provisional result",
            value: false,
            unit: null,
            source: "Tournament settings",
          },
        ],
      },
    ],
    comparator: {
      description: "Fitness recomposed from rated non-Tournament axes",
      gameIds: ["game-1"],
    },
    limitations: ["Tournament preference reflects only the opponents compared so far"],
    observation: "Tournament score is 4.0 points above independent fitness",
    interpretation:
      "Tournament choices favor this game more than the configured non-Tournament axes predict",
    details: {
      gameId: "game-1",
      gameName: "Game 1",
      independentFitnessScore: 4,
      normalizedTournamentScore: 8,
      gap: 4,
      direction: "tournament-outlier",
      comparisonCount: 10,
      provisional: false,
    },
    notability: {
      metric: "absolute score gap",
      value: 4,
      threshold: 1.5,
      direction: "above",
      explanation: "The gap exceeds the 1.5-point reporting threshold",
    },
    confidence: null,
  },
  {
    contractVersion: 1,
    id: "divergence:game-2",
    status: "insufficient",
    reason: "insufficient-sample",
    method: divergenceMethod,
    cohort: divergenceCohort,
    sufficiency: [
      { criterion: "comparisons for subject game", observed: 2, required: 6, met: false },
      { criterion: "normalized Tournament score available", observed: 1, required: 1, met: true },
      { criterion: "independent non-Tournament axes", observed: 1, required: 1, met: true },
    ],
    evidence: [
      {
        gameId: "game-2",
        gameName: "Game 2",
        role: "subject",
        measurements: [
          {
            key: "comparison-count",
            label: "Tournament comparisons",
            value: 2,
            unit: "comparisons",
            source: "Tournament comparisons",
          },
        ],
      },
    ],
    comparator: {
      description: "Fitness recomposed from rated non-Tournament axes",
      gameIds: ["game-2"],
    },
    limitations: ["Tournament preference reflects only the opponents compared so far"],
    explanation: "At least six comparisons are required before reporting divergence",
  },
];

const outlierMethod = {
  id: "outlier:factual-neighborhood",
  version: 1,
  description:
    "Compares each owned game with its two nearest owned neighbors using observed composition",
};

const outlierCohort = {
  description: "Currently owned games with complete factual metadata",
  eligibleGameCount: 6,
  includedGameCount: 6,
  excludedGameCount: 0,
  coveragePercent: 100,
};

const outliers: CollectionOutlier[] = [
  {
    contractVersion: 1,
    id: "outlier:game-3",
    status: "reported",
    method: outlierMethod,
    cohort: outlierCohort,
    sufficiency: [
      { criterion: "usable-owned-games", observed: 6, required: 6, met: true },
      { criterion: "factual-metadata-coverage-percent", observed: 100, required: 60, met: true },
    ],
    evidence: [
      {
        gameId: "game-3",
        gameName: "Game 3",
        role: "subject",
        measurements: [
          {
            key: "neighborhood-distance",
            label: "Neighborhood distance",
            value: 0.8,
            unit: null,
            source: "outlier:factual-neighborhood",
          },
          {
            key: "mechanics",
            label: "Mechanics",
            value: "Area Control",
            unit: null,
            source: "BGG metadata",
          },
          {
            key: "categories",
            label: "Categories",
            value: "Wargame",
            unit: null,
            source: "BGG metadata",
          },
          {
            key: "fitness-score",
            label: "Preference fitness",
            value: 8,
            unit: "rating",
            source: "Fitness engine",
          },
        ],
      },
      {
        gameId: "game-4",
        gameName: "Game 4",
        role: "comparator",
        measurements: [
          {
            key: "subject-distance",
            label: "Distance from subject",
            value: 0.75,
            unit: null,
            source: "outlier:factual-neighborhood",
          },
          {
            key: "mechanics",
            label: "Mechanics",
            value: "Deck Building",
            unit: null,
            source: "BGG metadata",
          },
          {
            key: "categories",
            label: "Categories",
            value: "Economic",
            unit: null,
            source: "BGG metadata",
          },
          ...(
            [
              ["mechanics", 0.9],
              ["categories", 0.8],
              ["complexity", 0.7],
              ["player-count", 0.65],
              ["playing-time", 0.7],
            ] as const
          ).map(([dimension, value]) => ({
            key: `${dimension}-distance`,
            label: `${dimension} distance from subject`,
            value,
            unit: null,
            source: "outlier:factual-neighborhood",
          })),
        ],
      },
      {
        gameId: "game-5",
        gameName: "Game 5",
        role: "comparator",
        measurements: [
          {
            key: "subject-distance",
            label: "Distance from subject",
            value: 0.85,
            unit: null,
            source: "outlier:factual-neighborhood",
          },
          {
            key: "mechanics",
            label: "Mechanics",
            value: "Worker Placement",
            unit: null,
            source: "BGG metadata",
          },
          {
            key: "categories",
            label: "Categories",
            value: "Fantasy",
            unit: null,
            source: "BGG metadata",
          },
          ...(
            [
              ["mechanics", 0.9],
              ["categories", 0.9],
              ["complexity", 0.8],
              ["player-count", 0.8],
              ["playing-time", 0.85],
            ] as const
          ).map(([dimension, value]) => ({
            key: `${dimension}-distance`,
            label: `${dimension} distance from subject`,
            value,
            unit: null,
            source: "outlier:factual-neighborhood",
          })),
        ],
      },
    ],
    comparator: {
      description: "Two nearest owned games with jointly observed factual metadata",
      gameIds: ["game-4", "game-5"],
    },
    limitations: [
      "Distance thresholds are deterministic heuristics, not population significance tests",
      "Games missing any required factual dimension are excluded rather than estimated",
    ],
    observation: "Game 3 is compositionally distant from its two nearest comparison games",
    interpretation: "Separately, its current preference fitness score is 8.0",
    details: {
      gameId: "game-3",
      gameName: "Game 3",
      neighborhoodDistance: 0.8,
      nearestComparisons: [
        { gameId: "game-4", gameName: "Game 4", distance: 0.75 },
        { gameId: "game-5", gameName: "Game 5", distance: 0.85 },
      ],
      drivers: [
        {
          dimension: "mechanics",
          label: "Mechanics",
          distance: 0.9,
          subjectValue: "Area Control",
          comparatorValues: [
            { gameId: "game-4", value: "Deck Building" },
            { gameId: "game-5", value: "Worker Placement" },
          ],
          explanation: "Mechanics differ materially from both nearest comparison games",
        },
        {
          dimension: "categories",
          label: "Categories",
          distance: 0.85,
          subjectValue: "Wargame",
          comparatorValues: [
            { gameId: "game-4", value: "Economic" },
            { gameId: "game-5", value: "Fantasy" },
          ],
          explanation: "Categories differ materially from both nearest comparison games",
        },
      ],
      fitnessScore: 8,
    },
    notability: {
      metric: "mean-two-nearest-factual-distance",
      value: 0.8,
      threshold: 0.5,
      direction: "above",
      explanation: "The mean distance exceeds 0.5 with at least two material factual drivers",
    },
    confidence: null,
  },
  {
    contractVersion: 1,
    id: "outlier:collection",
    status: "insufficient",
    reason: "insufficient-coverage",
    method: outlierMethod,
    cohort: {
      ...outlierCohort,
      includedGameCount: 2,
      excludedGameCount: 4,
      coveragePercent: 33.3,
    },
    sufficiency: [
      { criterion: "factual-metadata-coverage-percent", observed: 33.3, required: 60, met: false },
      { criterion: "usable-owned-games", observed: 2, required: 6, met: false },
    ],
    evidence: [],
    comparator: null,
    limitations: ["Missing dimensions are excluded rather than estimated"],
    explanation: "At least 60% of owned games need usable factual metadata",
  },
];

export const trustedInsightProfileFixture: CollectionProfile = {
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
  divergence,
  outliers,
  suggestions: [
    reportedSuggestion(),
    {
      contractVersion: 1,
      id: "axis-suggestion:insufficient",
      status: "insufficient",
      reason: "insufficient-sample",
      method: currentMethod,
      cohort: {
        ...cohort,
        includedGameCount: 2,
        excludedGameCount: 4,
        coveragePercent: 33.3,
      },
      sufficiency: [{ criterion: "evaluated games", observed: 2, required: 6, met: false }],
      evidence: [],
      comparator: null,
      limitations: ["Tournament preference reflects only the opponents compared so far"],
      explanation: "At least six evaluated games are required",
    },
    {
      contractVersion: 1,
      id: "axis-suggestion:suppressed:confounded",
      status: "suppressed",
      reason: "unsupported-method",
      method: currentMethod,
      cohort,
      sufficiency: [],
      evidence: [],
      comparator: null,
      limitations: ["Overlapping attributes prevent an independent effect interpretation"],
      explanation: "Area Control is confounded by another candidate attribute",
    },
    {
      contractVersion: 1,
      id: "axis-suggestion:retired:unexpressed-concentration",
      status: "retired",
      reason: "superseded",
      method: {
        id: "unexpressed-concentration",
        version: 1,
        description: "Recommended axes from common BGG attributes without preference evidence",
      },
      cohort,
      sufficiency: [
        {
          criterion: "collection attribute concentration percent",
          observed: 100,
          required: 80,
          met: true,
        },
      ],
      evidence: [],
      comparator: null,
      limitations: ["Collection concentration does not establish preference for an attribute"],
      explanation: "The concentration recommendation method is retired",
    },
  ],
  narration: null,
  narrationState: "empty",
  gameCount: 6,
  ratedGameCount: 0,
  computedAt: "2099-08-27T12:00:00.000Z",
};

export const emptyInsightProfileFixture: CollectionProfile = {
  ...trustedInsightProfileFixture,
  divergence: [],
  outliers: [],
  suggestions: [],
};
