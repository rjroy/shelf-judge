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
  const hasRawColumn = breakdown.some(
    (e) =>
      e.scoringRawValue != null &&
      e.effectiveRating != null &&
      Math.abs(e.scoringRawValue - e.effectiveRating) > 0.05,
  );

  const headers = hasRawColumn
    ? ["Axis", "Raw", "Rating", "Weight", "Contribution", "Source"]
    : ["Axis", "Rating", "Weight", "Contribution", "Source"];

  const rows = breakdown.map((entry) => {
    const marker = entry.curveAffected ? " *" : "";
    let ratingStr = entry.effectiveRating !== null ? String(entry.effectiveRating) + marker : "---";
    if (entry.overridden && entry.sourceValue !== null) {
      ratingStr += ` (metadata: ${entry.sourceValue}${entry.unit ? ` ${entry.unit}` : ""})`;
    }

    const rawStr =
      entry.scoringRawValue != null
        ? `${entry.scoringRawValue}${entry.unit ? ` ${entry.unit}` : ""}`
        : "---";

    const row = [
      entry.axisName,
      ...(hasRawColumn ? [rawStr] : []),
      ratingStr,
      String(entry.weight),
      entry.contribution !== null ? entry.contribution.toFixed(2) : "---",
      entry.source,
    ];
    return row;
  });
  return formatTable(headers, rows);
}
