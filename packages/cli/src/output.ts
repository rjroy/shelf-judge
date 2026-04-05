// Table and JSON formatting for CLI output.

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

export interface BreakdownEntry {
  axisName: string;
  rating: number | null;
  weight: number;
  contribution: number | null;
  source: string;
  bggOriginal: number | null;
}

export function formatBreakdown(breakdown: BreakdownEntry[]): string {
  const headers = ["Axis", "Rating", "Weight", "Contribution", "Source"];
  const rows = breakdown.map((entry) => {
    let ratingStr = entry.rating !== null ? String(entry.rating) : "---";
    if (entry.source === "override" && entry.bggOriginal !== null) {
      ratingStr += ` (BGG: ${entry.bggOriginal})`;
    }
    return [
      entry.axisName,
      ratingStr,
      String(entry.weight),
      entry.contribution !== null ? entry.contribution.toFixed(2) : "---",
      entry.source,
    ];
  });
  return formatTable(headers, rows);
}
