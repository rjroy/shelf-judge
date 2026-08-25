// Table and JSON formatting for CLI output.

import type { FitnessBreakdownEntry } from "@shelf-judge/shared";

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
      entry.overridden ? "yes" : "no",
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
