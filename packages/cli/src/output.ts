// Table and JSON formatting for CLI output.

import type {
  FieldObservationSource,
  FitnessBreakdownEntry,
  GameWithPurchaseUtilization,
  PurchaseUtilizationReason,
  PurchaseUtilizationResult,
  UtilizationComponent,
} from "@shelf-judge/shared";
import { formatStoredAmount } from "@shelf-judge/shared";

export interface OutputOptions {
  json: boolean;
}

// Print data as JSON or human-readable table.
export function printOutput(data: unknown, options: OutputOptions): string {
  if (options.json) {
    return JSON.stringify(data, null, 2);
  }
  // For non-JSON, callers use specific formatters below
  return String(data);
}

export function formatTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return "(no results)";
  }

  const colWidths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] ?? "").length), 0);
    return Math.max(h.length, maxRow);
  });

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => (cell ?? "").padEnd(colWidths[i])).join("  "),
  );

  return [headerLine, separator, ...dataLines].join("\n");
}

// Format a score value for display. Returns "---" for null/undefined.
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "---";
  return score.toFixed(1);
}

export function formatDisplayScore(displayScore: string | null): string {
  return displayScore ?? "---";
}

const UTILIZATION_REASON_TEXT: Record<PurchaseUtilizationReason, string> = {
  "missing-acquisition": "Acquisition is unknown; record whether this game was a gift or purchase.",
  "invalid-acquisition": "Saved acquisition data is invalid and can be corrected.",
  "no-owner-cost": "A gift or zero-cost purchase has no owner cost to evaluate.",
  "missing-benchmark": "The collection entertainment benchmark is unknown.",
  "invalid-benchmark":
    "The saved collection entertainment benchmark is invalid and can be corrected.",
  "missing-play-count": "Recorded play count is unavailable.",
  "invalid-play-count": "Recorded play count is invalid.",
  "missing-modeled-duration": "Modeled play duration is unavailable.",
  "invalid-modeled-duration": "Modeled play duration is invalid.",
  "missing-modeled-player-count": "A modeled player count is unavailable.",
  "invalid-modeled-player-count": "Modeled player-count evidence is invalid.",
  "missing-fitness": "Current fitness is unavailable.",
  "invalid-fitness": "Current fitness is invalid.",
  "unreachable-at-current-fitness": "Additional plays are unreachable at current fitness.",
};

function componentLines(component: UtilizationComponent<unknown>): string[] {
  const lines = [`  ${component.label}: ${component.display}`];
  for (const reason of component.reasons) {
    lines.push(`    ${UTILIZATION_REASON_TEXT[reason]} [${reason}]`);
  }
  return lines;
}

function evidenceLine(
  label: string,
  status: string,
  source: FieldObservationSource,
  observedAt: string | null,
  value?: string,
): string {
  const renderedValue = value === undefined ? status : `${status}, ${value}`;
  return `  ${label}: ${renderedValue}; source=${source}; observedAt=${observedAt ?? "unknown"}`;
}

function formatEvidence(result: PurchaseUtilizationResult): string[] {
  const { evidence, components } = result;
  const lines = ["Inputs and evidence:"];
  const acquisition = evidence.acquisition;
  if (acquisition.state === "purchase") {
    lines.push(
      `  Acquisition: purchase; lifetime landed cost=${formatStoredAmount(acquisition.amount.hundredths)}; source=${acquisition.amount.source}; confirmedAt=${acquisition.amount.confirmedAt}`,
    );
  } else if (acquisition.state === "invalid") {
    lines.push(`  Acquisition: invalid; evidence=${JSON.stringify(acquisition.evidence)}`);
  } else {
    lines.push(`  Acquisition: ${acquisition.state}`);
  }

  const benchmark = evidence.entertainmentBenchmark;
  if (benchmark?.state === "configured") {
    lines.push(
      `  Entertainment benchmark: configured; amount=${formatStoredAmount(benchmark.amount.hundredths)}; source=${benchmark.amount.source}; confirmedAt=${benchmark.amount.confirmedAt}`,
    );
  } else if (benchmark?.state === "invalid") {
    lines.push(
      `  Entertainment benchmark: invalid; evidence=${JSON.stringify(benchmark.evidence)}`,
    );
  } else {
    lines.push("  Entertainment benchmark: unknown");
  }

  const fieldValue = (field: {
    status: string;
    value?: unknown;
    evidence?: unknown;
  }): string | undefined => {
    if ("value" in field) return `value=${JSON.stringify(field.value)}`;
    if ("evidence" in field) return `evidence=${JSON.stringify(field.evidence)}`;
    return undefined;
  };
  lines.push(
    evidenceLine(
      "Recorded plays",
      evidence.playCount.status,
      evidence.playCount.source,
      evidence.playCount.observedAt,
      fieldValue(evidence.playCount),
    ),
    evidenceLine(
      "Modeled duration",
      evidence.duration.status,
      evidence.duration.source,
      evidence.duration.observedAt,
      fieldValue(evidence.duration),
    ),
    evidenceLine(
      "Published player range",
      evidence.playerRange.status,
      evidence.playerRange.source,
      evidence.playerRange.observedAt,
      fieldValue(evidence.playerRange),
    ),
    evidenceLine(
      "Suggested-player poll",
      evidence.suggestedPlayerPoll.status,
      evidence.suggestedPlayerPoll.source,
      evidence.suggestedPlayerPoll.observedAt,
      JSON.stringify({
        state: evidence.suggestedPlayerPoll.state,
        buckets: evidence.suggestedPlayerPoll.buckets,
        ...(evidence.suggestedPlayerPoll.status === "invalid"
          ? { evidence: evidence.suggestedPlayerPoll.evidence }
          : {}),
      }),
    ),
    evidenceLine(
      "Current fitness",
      evidence.fitness.status,
      evidence.fitness.source,
      evidence.fitness.observedAt,
      fieldValue(evidence.fitness),
    ),
  );

  if (components.modeledPlayerCount.outcome === "calculated") {
    const modeled = components.modeledPlayerCount.value;
    lines.push(
      `  Modeled player-count resolution: ${modeled.resolution}; source=${modeled.source}; observedAt=${modeled.observedAt ?? "unknown"}; winningBestVotes=${modeled.winningBestVotes ?? "none"}; winningPlayerCounts=${modeled.winningPlayerCounts.join(",") || "none"}`,
    );
  }
  return lines;
}

export function formatPurchaseUtilization(game: GameWithPurchaseUtilization): string {
  const result = game.purchaseUtilization;
  const lines = [game.game.name, `Purchase utilization: ${result.outcomeLabel}`];
  for (const reason of result.reasons) {
    lines.push(`  ${UTILIZATION_REASON_TEXT[reason]} [${reason}]`);
  }
  lines.push(`Fitness: ${formatDisplayScore(game.displayScore)}`);

  lines.push("", "Result:");
  for (const component of [
    result.components.valueMultiplier,
    result.components.valueRemaining,
    result.components.estimatedAdditionalPlays,
  ]) {
    lines.push(...componentLines(component));
  }

  const isPaidPurchase =
    result.evidence.acquisition.state === "purchase" &&
    result.evidence.acquisition.amount.hundredths > 0;
  const isZeroPlay =
    result.evidence.playCount.status === "valid" && result.evidence.playCount.value === 0;
  const isFitnessZero =
    result.evidence.fitness.status === "valid" && result.evidence.fitness.value === "0.0";
  if (isPaidPurchase && isFitnessZero) {
    lines.push(
      "  Current fitness is 0. The $0.00 adjusted benchmark, zero multiplier, and full value remaining do not require a configured benchmark or modeled-use evidence.",
    );
  } else if (isPaidPurchase && isZeroPlay) {
    lines.push(
      "  Recorded plays are exactly zero. The zero multiplier and full value remaining do not require fitness, duration, player count, or a benchmark; those inputs may still support the hourly benchmark and future-play estimate.",
    );
  }

  lines.push("", "Calculation details:");
  for (const component of [
    result.components.costPerRecordedPlay,
    result.components.modeledPlayerHours,
    result.components.costPerModeledPlayerHour,
    result.components.fitnessAdjustedHourlyBenchmark,
    result.components.modeledPlayerCount,
  ]) {
    lines.push(...componentLines(component));
  }

  lines.push("", ...formatEvidence(result), "", "Assumptions:");
  lines.push(`  ${result.assumptions.modeledSessions}`);
  lines.push(`  ${result.assumptions.futurePlays}`);
  lines.push(`  ${result.assumptions.fitnessAdjustment}`);
  if (game.game.ownership === "previously-owned") {
    lines.push(
      "  This previously owned game uses its historical cost and plays with your current fitness and current entertainment benchmark. It does not estimate historical value.",
    );
  }
  return lines.join("\n");
}

export type BreakdownEntry = FitnessBreakdownEntry;

export function formatBreakdown(breakdown: BreakdownEntry[]): string {
  const rows = breakdown.map((entry) => {
    const marker = entry.curveAffected ? " *" : "";
    const value = (candidate: number | null): string =>
      candidate === null ? "---" : `${candidate}${entry.unit ? ` ${entry.unit}` : ""}`;
    const details = [
      entry.derivedField ? `field=${entry.derivedField}` : null,
      entry.configurationSummary,
      entry.provenance,
    ]
      .filter((detail): detail is string => Boolean(detail))
      .join("; ");
    return [
      entry.axisName,
      value(entry.sourceValue),
      value(entry.scoringRawValue),
      entry.effectiveRating !== null ? `${entry.effectiveRating}${marker}` : "---",
      entry.overridden ? String(entry.overrideValue ?? "yes") : "no",
      String(entry.weight),
      entry.contribution !== null ? entry.contribution.toFixed(2) : "---",
      entry.source,
      details || "---",
    ];
  });
  return formatTable(
    [
      "Axis",
      "Source Value",
      "Scoring Input (Raw)",
      "Effective Rating",
      "Override",
      "Weight",
      "Contribution",
      "Source",
      "Details",
    ],
    rows,
  );
}
