import {
  calculatePurchaseUtilization,
  type PurchaseUtilizationInput,
  type PurchaseUtilizationResult,
} from "../packages/shared/src/index.js";

export const UTILIZATION_OBSERVED_AT = "2026-08-26T12:00:00.000Z";

const baseInput: PurchaseUtilizationInput = {
  acquisition: {
    state: "purchase",
    amount: { hundredths: 6000, source: "manual", confirmedAt: UTILIZATION_OBSERVED_AT },
  },
  entertainmentBenchmark: {
    state: "configured",
    amount: { hundredths: 800, source: "manual", confirmedAt: UTILIZATION_OBSERVED_AT },
  },
  playCount: {
    status: "valid",
    value: 10,
    source: "bgg-collection",
    observedAt: UTILIZATION_OBSERVED_AT,
  },
  duration: {
    status: "valid",
    value: 90,
    source: "bgg-thing",
    observedAt: UTILIZATION_OBSERVED_AT,
  },
  playerRange: {
    status: "valid",
    value: { minPlayers: 4, maxPlayers: 4 },
    source: "bgg-player-range",
    observedAt: UTILIZATION_OBSERVED_AT,
  },
  suggestedPlayerPoll: {
    status: "valid",
    state: "usable",
    buckets: [{ playerCount: "4", best: 10, recommended: 2, notRecommended: 1 }],
    source: "bgg-suggested-player-poll",
    observedAt: UTILIZATION_OBSERVED_AT,
  },
  fitness: "6.0",
};

const componentOrder = [
  "valueMultiplier",
  "valueRemaining",
  "estimatedAdditionalPlays",
  "costPerRecordedPlay",
  "modeledPlayerHours",
  "costPerModeledPlayerHour",
  "fitnessAdjustedHourlyBenchmark",
  "modeledPlayerCount",
] as const;

export interface CanonicalUtilizationCase {
  id: string;
  name: string;
  input: PurchaseUtilizationInput;
  result: PurchaseUtilizationResult;
  expected: {
    outcome: PurchaseUtilizationResult["outcome"];
    outcomeLabel: PurchaseUtilizationResult["outcomeLabel"];
    reasons: PurchaseUtilizationResult["reasons"];
    displays: string[];
    exactValues: Array<string | null>;
    valueRemainingHundredths: string | null;
    estimatedAdditionalPlays: PurchaseUtilizationResult["sort"]["estimatedAdditionalPlays"];
  };
  webTokens: string[];
}

function defineCase(
  definition: Omit<CanonicalUtilizationCase, "result">,
): CanonicalUtilizationCase {
  return {
    ...definition,
    result: calculatePurchaseUtilization(definition.input),
  };
}

function withInput(overrides: Partial<PurchaseUtilizationInput>): PurchaseUtilizationInput {
  return { ...structuredClone(baseInput), ...overrides };
}

export const canonicalUtilizationCases: CanonicalUtilizationCase[] = [
  defineCase({
    id: "canonical-60",
    name: "Canonical $60 example",
    input: structuredClone(baseInput),
    expected: {
      outcome: "met",
      outcomeLabel: "Value threshold met",
      reasons: [],
      displays: ["8.00x", "$0.00", "0", "$6.00", "60 player-hours", "$1.00", "$8.00", "4 players"],
      exactValues: ["8/1", "0/1", null, "600/1", "60/1", "100/1", "800/1", "4/1"],
      valueRemainingHundredths: "0",
      estimatedAdditionalPlays: { category: "finite", wholePlays: "0" },
    },
    webTokens: ["BGG collection", "BGG game data", "poll winner with 10 Best votes"],
  }),
  defineCase({
    id: "canonical-20",
    name: "Canonical $20 example",
    input: withInput({
      acquisition: {
        state: "purchase",
        amount: { hundredths: 2000, source: "manual", confirmedAt: UTILIZATION_OBSERVED_AT },
      },
      playCount: {
        status: "valid",
        value: 2,
        source: "bgg-collection",
        observedAt: UTILIZATION_OBSERVED_AT,
      },
      duration: {
        status: "valid",
        value: 30,
        source: "bgg-thing",
        observedAt: UTILIZATION_OBSERVED_AT,
      },
      playerRange: {
        status: "valid",
        value: { minPlayers: 2, maxPlayers: 2 },
        source: "bgg-player-range",
        observedAt: UTILIZATION_OBSERVED_AT,
      },
      suggestedPlayerPoll: {
        status: "valid",
        state: "usable",
        buckets: [{ playerCount: "2", best: 3, recommended: 0, notRecommended: 0 }],
        source: "bgg-suggested-player-poll",
        observedAt: UTILIZATION_OBSERVED_AT,
      },
    }),
    expected: {
      outcome: "not-met",
      outcomeLabel: "Value threshold not yet met",
      reasons: [],
      displays: ["0.80x", "$4.00", "1", "$10.00", "2 player-hours", "$10.00", "$8.00", "2 players"],
      exactValues: ["4/5", "400/1", null, "1000/1", "2/1", "1000/1", "800/1", "2/1"],
      valueRemainingHundredths: "400",
      estimatedAdditionalPlays: { category: "finite", wholePlays: "1" },
    },
    webTokens: ["BGG collection", "BGG game data", "poll winner with 3 Best votes"],
  }),
  defineCase({
    id: "zero-play",
    name: "Zero recorded plays",
    input: withInput({
      playCount: {
        status: "valid",
        value: 0,
        source: "bgg-collection",
        observedAt: UTILIZATION_OBSERVED_AT,
      },
    }),
    expected: {
      outcome: "not-met",
      outcomeLabel: "Value threshold not yet met",
      reasons: [],
      displays: [
        "0.00x",
        "$60.00",
        "2",
        "Unavailable",
        "0 player-hours",
        "Unavailable",
        "$8.00",
        "4 players",
      ],
      exactValues: ["0/1", "6000/1", null, null, "0/1", null, "800/1", "4/1"],
      valueRemainingHundredths: "6000",
      estimatedAdditionalPlays: { category: "finite", wholePlays: "2" },
    },
    webTokens: ["Recorded plays are exactly zero", "do not need fitness"],
  }),
  defineCase({
    id: "vetoed",
    name: "Vetoed paid game",
    input: withInput({ fitness: "0.0" }),
    expected: {
      outcome: "not-met",
      outcomeLabel: "Value threshold not yet met",
      reasons: [],
      displays: [
        "0.00x",
        "$60.00",
        "Unreachable at current fitness",
        "$6.00",
        "60 player-hours",
        "$1.00",
        "$0.00",
        "4 players",
      ],
      exactValues: ["0/1", "6000/1", null, "600/1", "60/1", "100/1", "0/1", "4/1"],
      valueRemainingHundredths: "6000",
      estimatedAdditionalPlays: { category: "unreachable", wholePlays: null },
    },
    webTokens: ["Current fitness is 0", "threshold is unreachable at current fitness"],
  }),
  defineCase({
    id: "unavailable",
    name: "Unknown acquisition",
    input: withInput({ acquisition: { state: "unknown" } }),
    expected: {
      outcome: "unavailable",
      outcomeLabel: "Purchase value unavailable",
      reasons: ["missing-acquisition"],
      displays: [
        "Unavailable",
        "Unavailable",
        "Unavailable",
        "Unavailable",
        "60 player-hours",
        "Unavailable",
        "$8.00",
        "4 players",
      ],
      exactValues: [null, null, null, null, "60/1", null, "800/1", "4/1"],
      valueRemainingHundredths: null,
      estimatedAdditionalPlays: { category: "unavailable", wholePlays: null },
    },
    webTokens: ["Enter whether this game was a gift or purchase"],
  }),
  defineCase({
    id: "gift",
    name: "Gift game",
    input: withInput({ acquisition: { state: "gift" } }),
    expected: {
      outcome: "not-applicable",
      outcomeLabel: "Purchase value not applicable",
      reasons: ["no-owner-cost"],
      displays: [
        "Gift; no owner cost.",
        "Gift; no owner cost.",
        "Gift; no owner cost.",
        "Gift; no owner cost.",
        "60 player-hours",
        "Gift; no owner cost.",
        "$8.00",
        "4 players",
      ],
      exactValues: [null, null, null, null, "60/1", null, "800/1", "4/1"],
      valueRemainingHundredths: null,
      estimatedAdditionalPlays: { category: "not-applicable", wholePlays: null },
    },
    webTokens: ["Gift; no owner cost", "There is no owner cost to evaluate"],
  }),
  defineCase({
    id: "zero-cost",
    name: "Zero-cost purchase",
    input: withInput({
      acquisition: {
        state: "purchase",
        amount: { hundredths: 0, source: "manual", confirmedAt: UTILIZATION_OBSERVED_AT },
      },
    }),
    expected: {
      outcome: "not-applicable",
      outcomeLabel: "Purchase value not applicable",
      reasons: ["no-owner-cost"],
      displays: [
        "No owner cost.",
        "No owner cost.",
        "No owner cost.",
        "No owner cost.",
        "60 player-hours",
        "No owner cost.",
        "$8.00",
        "4 players",
      ],
      exactValues: [null, null, null, null, "60/1", null, "800/1", "4/1"],
      valueRemainingHundredths: null,
      estimatedAdditionalPlays: { category: "not-applicable", wholePlays: null },
    },
    webTokens: ["No owner cost", "There is no owner cost to evaluate"],
  }),
];

export function componentContract(result: PurchaseUtilizationResult): Array<{
  label: string;
  outcome: string;
  display: string;
  reasons: string[];
}> {
  return componentOrder.map((key) => {
    const component = result.components[key];
    return {
      label: component.label,
      outcome: component.outcome,
      display: component.display,
      reasons: component.reasons,
    };
  });
}

export function exactComponentContract(result: PurchaseUtilizationResult): Array<string | null> {
  return componentOrder.map((key) => {
    const component = result.components[key];
    if (component.outcome !== "calculated" || !("exact" in component.value)) return null;
    return `${component.value.exact.numerator}/${component.value.exact.denominator}`;
  });
}
