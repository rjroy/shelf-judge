import { amountSortKey, formatExactAmount } from "./amount";
import { ExactRational } from "./exact-rational";
import type {
  CalculatedUtilizationComponent,
  ExactUtilizationValue,
  FieldEvidence,
  ModeledPlayerCountValue,
  NotApplicableUtilizationComponent,
  PlayerRangeEvidence,
  PurchaseUtilizationInput,
  PurchaseUtilizationReason,
  PurchaseUtilizationResult,
  SuggestedPlayerPoll,
  UnavailableUtilizationComponent,
  UnreachableUtilizationComponent,
  UtilizationComponent,
} from "./types";

const ZERO = new ExactRational(0n);
const ONE = new ExactRational(1n);
const SIX = new ExactRational(6n);
const SIXTY = new ExactRational(60n);
const EXACT_POSITIVE_INTEGER = /^[1-9]\d*$/;
const CANONICAL_FITNESS = /^(?:[0-9]\.\d|10\.0)$/;

const LABELS = {
  costPerRecordedPlay: "Cost per recorded play",
  modeledPlayerCount: "Modeled player count",
  modeledPlayerHours: "Modeled player-hours",
  costPerModeledPlayerHour: "Cost per modeled player-hour",
  fitnessAdjustedHourlyBenchmark: "Fitness-adjusted hourly benchmark",
  valueMultiplier: "Value multiplier",
  valueRemaining: "Value remaining",
  estimatedAdditionalPlays: "Estimated additional plays to value threshold",
} as const;

function calculated<Value>(
  label: string,
  value: Value,
  display: string,
): CalculatedUtilizationComponent<Value> {
  return { label, outcome: "calculated", value, display, reasons: [] };
}

function unavailable(
  label: string,
  reasons: PurchaseUtilizationReason[],
): UnavailableUtilizationComponent {
  return { label, outcome: "unavailable", display: "Unavailable", reasons };
}

function notApplicable(label: string, display: string): NotApplicableUtilizationComponent {
  return { label, outcome: "not-applicable", display, reasons: ["no-owner-cost"] };
}

function unreachable(label: string): UnreachableUtilizationComponent {
  return {
    label,
    outcome: "unreachable",
    display: "Unreachable at current fitness",
    reasons: ["unreachable-at-current-fitness"],
  };
}

function exactValue(value: ExactRational): ExactUtilizationValue {
  return { exact: value.toJSON() };
}

function formatConcise(value: ExactRational): string {
  return value
    .formatFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

function formatMultiplier(value: ExactRational): string {
  const comparison = value.compare(ONE);
  let decimalPlaces = 2;
  let display = value.formatFixed(decimalPlaces);
  while (comparison !== 0 && display === "1." + "0".repeat(decimalPlaces)) {
    decimalPlaces += 1;
    display = value.formatFixed(decimalPlaces);
  }
  return `${display}x`;
}

function evidenceReason(
  evidence: FieldEvidence<number>,
  missing: PurchaseUtilizationReason,
  invalid: PurchaseUtilizationReason,
): PurchaseUtilizationReason | null {
  return evidence.status === "missing" ? missing : evidence.status === "invalid" ? invalid : null;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function playerCountReason(
  poll: SuggestedPlayerPoll,
  range: PlayerRangeEvidence,
): PurchaseUtilizationReason {
  return poll.status === "invalid" || range.status === "invalid"
    ? "invalid-modeled-player-count"
    : "missing-modeled-player-count";
}

export function resolveModeledPlayerCount(
  poll: SuggestedPlayerPoll,
  range: PlayerRangeEvidence,
): UtilizationComponent<ModeledPlayerCountValue> {
  if (poll.status === "valid") {
    const votesByCount = new Map<number, number>();
    for (const bucket of poll.buckets) {
      if (!EXACT_POSITIVE_INTEGER.test(bucket.playerCount) || bucket.best <= 0) continue;
      const count = Number(bucket.playerCount);
      if (!Number.isSafeInteger(count)) continue;
      votesByCount.set(count, Math.max(votesByCount.get(count) ?? 0, bucket.best));
    }

    if (votesByCount.size > 0) {
      const winningBestVotes = Math.max(...votesByCount.values());
      const winners = [...votesByCount]
        .filter(([, votes]) => votes === winningBestVotes)
        .map(([count]) => count)
        .sort((left, right) => left - right);
      const value = new ExactRational(
        winners.reduce((total, count) => total + BigInt(count), 0n),
        BigInt(winners.length),
      );
      return calculated(
        LABELS.modeledPlayerCount,
        {
          exact: value.toJSON(),
          source: poll.source,
          observedAt: poll.observedAt,
          resolution: winners.length === 1 ? "poll-winner" : "poll-tie-average",
          winningBestVotes,
          winningPlayerCounts: winners.map(String),
        },
        `${formatConcise(value)} players`,
      );
    }
  }

  if (
    range.status === "valid" &&
    isPositiveSafeInteger(range.value.minPlayers) &&
    isPositiveSafeInteger(range.value.maxPlayers) &&
    range.value.minPlayers <= range.value.maxPlayers
  ) {
    const value = new ExactRational(
      BigInt(range.value.minPlayers) + BigInt(range.value.maxPlayers),
      2n,
    );
    return calculated(
      LABELS.modeledPlayerCount,
      {
        exact: value.toJSON(),
        source: range.source,
        observedAt: range.observedAt,
        resolution: "player-range-midpoint",
        winningBestVotes: null,
        winningPlayerCounts: [],
      },
      `${formatConcise(value)} players`,
    );
  }

  return unavailable(LABELS.modeledPlayerCount, [
    range.status === "valid" ? "invalid-modeled-player-count" : playerCountReason(poll, range),
  ]);
}

function parseFitness(value: string | null) {
  if (value === null) {
    return {
      evidence: {
        status: "missing" as const,
        source: "current-fitness" as const,
        observedAt: null,
      },
      value: null,
      reason: "missing-fitness" as const,
    };
  }
  try {
    if (!CANONICAL_FITNESS.test(value)) throw new Error();
    const exact = ExactRational.fromDecimal(value);
    if (exact.compare(ZERO) < 0 || exact.compare(new ExactRational(10n)) > 0) throw new Error();
    return {
      evidence: {
        status: "valid" as const,
        value,
        source: "current-fitness" as const,
        observedAt: null,
      },
      value: exact,
      reason: null,
    };
  } catch {
    return {
      evidence: {
        status: "invalid" as const,
        value,
        source: "current-fitness" as const,
        observedAt: null,
      },
      value: null,
      reason: "invalid-fitness" as const,
    };
  }
}

export function calculatePurchaseUtilization(
  input: PurchaseUtilizationInput,
): PurchaseUtilizationResult {
  const fitness = parseFitness(input.fitness);
  const modeledPlayerCount = resolveModeledPlayerCount(
    input.suggestedPlayerPoll,
    input.playerRange,
  );
  const playCount =
    input.playCount.status === "valid" && isNonNegativeSafeInteger(input.playCount.value)
      ? input.playCount.value
      : null;
  const duration =
    input.duration.status === "valid" && isPositiveSafeInteger(input.duration.value)
      ? input.duration.value
      : null;
  const playerCountExact =
    modeledPlayerCount.outcome === "calculated"
      ? new ExactRational(
          BigInt(modeledPlayerCount.value.exact.numerator),
          BigInt(modeledPlayerCount.value.exact.denominator),
        )
      : null;
  const playReason =
    input.playCount.status === "valid" && playCount === null
      ? "invalid-play-count"
      : evidenceReason(input.playCount, "missing-play-count", "invalid-play-count");
  const durationReason =
    input.duration.status === "valid" && duration === null
      ? "invalid-modeled-duration"
      : evidenceReason(input.duration, "missing-modeled-duration", "invalid-modeled-duration");
  const modeledReasons = [
    durationReason,
    modeledPlayerCount.outcome === "unavailable" ? modeledPlayerCount.reasons[0] : null,
  ].filter((reason): reason is PurchaseUtilizationReason => reason !== null);

  let modeledPlayerHours: UtilizationComponent<ExactUtilizationValue>;
  let modeledHoursExact: ExactRational | null = null;
  if (playCount === 0) {
    modeledHoursExact = ZERO;
    modeledPlayerHours = calculated(LABELS.modeledPlayerHours, exactValue(ZERO), "0 player-hours");
  } else if (playCount !== null && duration !== null && playerCountExact !== null) {
    modeledHoursExact = new ExactRational(BigInt(playCount))
      .multiply(new ExactRational(BigInt(duration)))
      .multiply(playerCountExact)
      .divide(SIXTY);
    modeledPlayerHours = calculated(
      LABELS.modeledPlayerHours,
      exactValue(modeledHoursExact),
      `${formatConcise(modeledHoursExact)} player-hours`,
    );
  } else {
    modeledPlayerHours = unavailable(LABELS.modeledPlayerHours, [
      ...(playReason === null ? [] : [playReason]),
      ...(playCount === 0 ? [] : modeledReasons),
    ]);
  }

  const noCostDisplay =
    input.acquisition.state === "gift" ? "Gift; no owner cost." : "No owner cost.";
  const acquisitionReason =
    input.acquisition.state === "unknown"
      ? "missing-acquisition"
      : input.acquisition.state === "invalid"
        ? "invalid-acquisition"
        : null;
  const unavailableFitnessReason = fitness.reason ?? "invalid-fitness";
  const purchaseHundredths =
    input.acquisition.state === "purchase" &&
    isNonNegativeSafeInteger(input.acquisition.amount.hundredths)
      ? input.acquisition.amount.hundredths
      : null;
  const unavailableAcquisitionReason =
    input.acquisition.state === "purchase" && purchaseHundredths === null
      ? "invalid-acquisition"
      : (acquisitionReason ?? "missing-acquisition");
  const hasNoOwnerCost = input.acquisition.state === "gift" || purchaseHundredths === 0;
  const purchase =
    purchaseHundredths !== null ? new ExactRational(BigInt(purchaseHundredths)) : null;

  let costPerRecordedPlay: UtilizationComponent<ExactUtilizationValue>;
  if (hasNoOwnerCost) {
    costPerRecordedPlay = notApplicable(LABELS.costPerRecordedPlay, noCostDisplay);
  } else if (purchase === null) {
    costPerRecordedPlay = unavailable(LABELS.costPerRecordedPlay, [unavailableAcquisitionReason]);
  } else if (playCount !== null && playCount > 0) {
    const value = purchase.divide(new ExactRational(BigInt(playCount)));
    costPerRecordedPlay = calculated(
      LABELS.costPerRecordedPlay,
      exactValue(value),
      formatExactAmount(value),
    );
  } else {
    costPerRecordedPlay = unavailable(
      LABELS.costPerRecordedPlay,
      playReason === null ? [] : [playReason],
    );
  }

  let adjustedBenchmark: ExactRational | null = null;
  let fitnessAdjustedHourlyBenchmark: UtilizationComponent<ExactUtilizationValue>;
  const benchmarkHundredths =
    input.entertainmentBenchmark?.state === "configured" &&
    isPositiveSafeInteger(input.entertainmentBenchmark.amount.hundredths)
      ? input.entertainmentBenchmark.amount.hundredths
      : null;
  const benchmarkReason: PurchaseUtilizationReason | null =
    input.entertainmentBenchmark === null
      ? "missing-benchmark"
      : benchmarkHundredths === null
        ? "invalid-benchmark"
        : null;
  if (fitness.value?.compare(ZERO) === 0) {
    adjustedBenchmark = ZERO;
    fitnessAdjustedHourlyBenchmark = calculated(
      LABELS.fitnessAdjustedHourlyBenchmark,
      exactValue(ZERO),
      "$0.00",
    );
  } else if (fitness.value === null || benchmarkReason !== null || benchmarkHundredths === null) {
    fitnessAdjustedHourlyBenchmark = unavailable(LABELS.fitnessAdjustedHourlyBenchmark, [
      ...(fitness.value === null ? [unavailableFitnessReason] : []),
      ...(benchmarkReason === null ? [] : [benchmarkReason]),
    ]);
  } else {
    adjustedBenchmark = new ExactRational(BigInt(benchmarkHundredths))
      .multiply(fitness.value)
      .divide(SIX);
    fitnessAdjustedHourlyBenchmark = calculated(
      LABELS.fitnessAdjustedHourlyBenchmark,
      exactValue(adjustedBenchmark),
      formatExactAmount(adjustedBenchmark),
    );
  }

  let costPerModeledPlayerHour: UtilizationComponent<ExactUtilizationValue>;
  if (hasNoOwnerCost) {
    costPerModeledPlayerHour = notApplicable(LABELS.costPerModeledPlayerHour, noCostDisplay);
  } else if (purchase === null) {
    costPerModeledPlayerHour = unavailable(LABELS.costPerModeledPlayerHour, [
      unavailableAcquisitionReason,
    ]);
  } else if (modeledHoursExact !== null && modeledHoursExact.compare(ZERO) > 0) {
    const value = purchase.divide(modeledHoursExact);
    costPerModeledPlayerHour = calculated(
      LABELS.costPerModeledPlayerHour,
      exactValue(value),
      formatExactAmount(value),
    );
  } else {
    costPerModeledPlayerHour = unavailable(
      LABELS.costPerModeledPlayerHour,
      modeledPlayerHours.outcome === "unavailable" ? modeledPlayerHours.reasons : [],
    );
  }

  const unavailableValue = (reasons: PurchaseUtilizationReason[]) => ({
    multiplier: unavailable(LABELS.valueMultiplier, reasons),
    remaining: unavailable(LABELS.valueRemaining, reasons),
    additional: unavailable(LABELS.estimatedAdditionalPlays, reasons),
  });

  let valueMultiplier: PurchaseUtilizationResult["components"]["valueMultiplier"];
  let valueRemaining: UtilizationComponent<ExactUtilizationValue>;
  let estimatedAdditionalPlays: PurchaseUtilizationResult["components"]["estimatedAdditionalPlays"];
  let outcome: PurchaseUtilizationResult["outcome"];
  let outcomeLabel: PurchaseUtilizationResult["outcomeLabel"];
  let reasons: PurchaseUtilizationReason[] = [];

  if (hasNoOwnerCost) {
    valueMultiplier = notApplicable(LABELS.valueMultiplier, noCostDisplay);
    valueRemaining = notApplicable(LABELS.valueRemaining, noCostDisplay);
    estimatedAdditionalPlays = notApplicable(LABELS.estimatedAdditionalPlays, noCostDisplay);
    outcome = "not-applicable";
    outcomeLabel = "Purchase value not applicable";
    reasons = ["no-owner-cost"];
  } else if (purchase === null) {
    const unavailableComponents = unavailableValue([unavailableAcquisitionReason]);
    valueMultiplier = unavailableComponents.multiplier;
    valueRemaining = unavailableComponents.remaining;
    estimatedAdditionalPlays = unavailableComponents.additional;
    outcome = "unavailable";
    outcomeLabel = "Purchase value unavailable";
    reasons = [unavailableAcquisitionReason];
  } else if (fitness.value?.compare(ZERO) === 0) {
    valueMultiplier = calculated(
      LABELS.valueMultiplier,
      { ...exactValue(ZERO), status: "not-met" },
      "0.00x",
    );
    valueRemaining = calculated(
      LABELS.valueRemaining,
      exactValue(purchase),
      formatExactAmount(purchase),
    );
    estimatedAdditionalPlays = unreachable(LABELS.estimatedAdditionalPlays);
    outcome = "not-met";
    outcomeLabel = "Value threshold not yet met";
  } else if (playCount === 0) {
    valueMultiplier = calculated(
      LABELS.valueMultiplier,
      { ...exactValue(ZERO), status: "not-met" },
      "0.00x",
    );
    valueRemaining = calculated(
      LABELS.valueRemaining,
      exactValue(purchase),
      formatExactAmount(purchase),
    );
    const additionalReasons = [
      ...(fitness.value === null ? [unavailableFitnessReason] : []),
      ...(fitnessAdjustedHourlyBenchmark.outcome === "unavailable"
        ? fitnessAdjustedHourlyBenchmark.reasons.filter(
            (reason) => reason === "missing-benchmark" || reason === "invalid-benchmark",
          )
        : []),
      ...modeledReasons,
    ];
    if (
      adjustedBenchmark !== null &&
      adjustedBenchmark.compare(ZERO) > 0 &&
      duration !== null &&
      playerCountExact !== null
    ) {
      const onePlayValue = new ExactRational(BigInt(duration))
        .multiply(playerCountExact)
        .multiply(adjustedBenchmark)
        .divide(SIXTY);
      const wholePlays = purchase.divide(onePlayValue).ceiling().toString();
      estimatedAdditionalPlays = calculated(
        LABELS.estimatedAdditionalPlays,
        { wholePlays },
        wholePlays,
      );
    } else {
      estimatedAdditionalPlays = unavailable(LABELS.estimatedAdditionalPlays, additionalReasons);
    }
    outcome = "not-met";
    outcomeLabel = "Value threshold not yet met";
  } else {
    const ordinaryReasons = [
      ...new Set([
        ...(playReason === null ? [] : [playReason]),
        ...(fitness.value === null ? [unavailableFitnessReason] : []),
        ...(fitnessAdjustedHourlyBenchmark.outcome === "unavailable"
          ? fitnessAdjustedHourlyBenchmark.reasons
          : []),
        ...modeledReasons,
      ]),
    ];
    if (
      modeledHoursExact === null ||
      adjustedBenchmark === null ||
      duration === null ||
      playerCountExact === null
    ) {
      const unavailableComponents = unavailableValue(ordinaryReasons);
      valueMultiplier = unavailableComponents.multiplier;
      valueRemaining = unavailableComponents.remaining;
      estimatedAdditionalPlays = unavailableComponents.additional;
      outcome = "unavailable";
      outcomeLabel = "Purchase value unavailable";
      reasons = ordinaryReasons;
    } else {
      const deliveredValue = modeledHoursExact.multiply(adjustedBenchmark);
      const multiplier = deliveredValue.divide(purchase);
      const met = multiplier.compare(ONE) >= 0;
      const remaining = purchase.subtract(deliveredValue).max(ZERO);
      valueMultiplier = calculated(
        LABELS.valueMultiplier,
        { ...exactValue(multiplier), status: met ? "met" : "not-met" },
        formatMultiplier(multiplier),
      );
      valueRemaining = calculated(
        LABELS.valueRemaining,
        exactValue(remaining),
        formatExactAmount(remaining),
      );
      const wholePlays =
        remaining.compare(ZERO) === 0
          ? "0"
          : remaining
              .divide(
                new ExactRational(BigInt(duration))
                  .multiply(playerCountExact)
                  .multiply(adjustedBenchmark)
                  .divide(SIXTY),
              )
              .ceiling()
              .toString();
      estimatedAdditionalPlays = calculated(
        LABELS.estimatedAdditionalPlays,
        { wholePlays },
        wholePlays,
      );
      outcome = met ? "met" : "not-met";
      outcomeLabel = met ? "Value threshold met" : "Value threshold not yet met";
    }
  }

  return {
    outcome,
    outcomeLabel,
    reasons,
    components: {
      costPerRecordedPlay,
      modeledPlayerCount,
      modeledPlayerHours,
      costPerModeledPlayerHour,
      fitnessAdjustedHourlyBenchmark,
      valueMultiplier,
      valueRemaining,
      estimatedAdditionalPlays,
    },
    evidence: {
      acquisition: input.acquisition,
      entertainmentBenchmark: input.entertainmentBenchmark,
      playCount: input.playCount,
      duration: input.duration,
      playerRange: input.playerRange,
      suggestedPlayerPoll: input.suggestedPlayerPoll,
      fitness: fitness.evidence,
    },
    assumptions: {
      modeledSessions:
        "Models each recorded play at the shown duration and player count; actual sessions may differ.",
      futurePlays:
        "Estimated additional plays assumes future plays use the shown duration, player count, fitness, and entertainment benchmark.",
      fitnessAdjustment:
        "The fitness-adjusted hourly benchmark changes in direct proportion to current fitness; fitness 6 uses the collection benchmark.",
    },
    sort: {
      valueRemainingHundredths:
        valueRemaining.outcome === "calculated"
          ? amountSortKey(
              new ExactRational(
                BigInt(valueRemaining.value.exact.numerator),
                BigInt(valueRemaining.value.exact.denominator),
              ),
            )
          : null,
      estimatedAdditionalPlays:
        estimatedAdditionalPlays.outcome === "calculated"
          ? { category: "finite", wholePlays: estimatedAdditionalPlays.value.wholePlays }
          : estimatedAdditionalPlays.outcome === "unreachable"
            ? { category: "unreachable", wholePlays: null }
            : {
                category: estimatedAdditionalPlays.outcome,
                wholePlays: null,
              },
    },
  };
}
