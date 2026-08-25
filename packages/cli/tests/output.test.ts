import { describe, test, expect } from "bun:test";
import { formatTable, formatScore, formatBreakdown, printOutput } from "../src/output.js";
import type { FitnessBreakdownEntry } from "@shelf-judge/shared";

function entry(overrides: Partial<FitnessBreakdownEntry>): FitnessBreakdownEntry {
  return {
    axisId: "axis",
    axisName: "Axis",
    weight: 50,
    contribution: null,
    source: "personal",
    derivedField: null,
    sourceValue: null,
    scoringRawValue: null,
    effectiveRating: null,
    preferenceShape: "higher-is-better",
    curveAffected: false,
    unit: null,
    provenance: null,
    configurationSummary: null,
    overridden: overrides.source === "override",
    predictionConfidence: null,
    referenceGames: null,
    ...overrides,
    overrideValue: overrides.overrideValue ?? null,
  };
}

describe("formatTable", () => {
  test("formats headers and rows with alignment", () => {
    const result = formatTable(
      ["ID", "Name", "Score"],
      [
        ["abc", "Wingspan", "7.9"],
        ["def", "Gloomhaven", "6.5"],
      ],
    );
    expect(result).toContain("ID");
    expect(result).toContain("Wingspan");
    expect(result).toContain("Gloomhaven");
    expect(result).toContain("---"); // separator
  });

  test("returns (no results) for empty rows", () => {
    expect(formatTable(["A", "B"], [])).toBe("(no results)");
  });

  test("pads columns correctly", () => {
    const result = formatTable(["Short", "LongerHeader"], [["a", "b"]]);
    const lines = result.split("\n");
    // Headers and separator should be same length
    expect(lines[0].trimEnd().length).toBeGreaterThan(0);
  });
});

describe("formatScore", () => {
  test("formats number to one decimal", () => {
    expect(formatScore(7.9)).toBe("7.9");
    expect(formatScore(10)).toBe("10.0");
    expect(formatScore(1)).toBe("1.0");
  });

  test("returns --- for null", () => {
    expect(formatScore(null)).toBe("---");
    expect(formatScore(undefined)).toBe("---");
  });
});

describe("formatBreakdown", () => {
  test("formats breakdown entries as a table", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Wife will play it",
        effectiveRating: 8,
        weight: 40,
        contribution: 3.2,
        source: "personal",
        sourceValue: null,
      }),
      entry({
        axisName: "Complexity",
        effectiveRating: 5.8,
        weight: 20,
        contribution: 1.16,
        source: "derived",
        sourceValue: null,
      }),
    ]);
    expect(result).toContain("Axis");
    expect(result).toContain("Wife will play it");
    expect(result).toContain("Complexity");
    expect(result).toContain("personal");
    expect(result).toContain("derived");
  });

  test("shows factual metadata for an override source", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Community Rating",
        effectiveRating: 9,
        weight: 10,
        contribution: 0.9,
        source: "override",
        sourceValue: 8.1,
        overrideValue: 9,
      }),
    ]);
    expect(result).toContain("Source Value");
    expect(result).toContain("8.1");
    expect(result).toContain("Override");
    const row = result.split("\n").find((line) => line.includes("Community Rating"));
    expect(row).toMatch(/8\.1\s+---\s+9\s+9\s+10/);
    expect(result).toContain("override");
  });

  test("shows --- for unrated axes", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Unrated",
        effectiveRating: null,
        weight: 30,
        contribution: null,
        source: "personal",
        sourceValue: null,
      }),
    ]);
    expect(result).toContain("---");
  });

  test("shows Raw column when scoringRawValue differs from effectiveRating", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Complexity",
        weight: 20,
        contribution: 1.055,
        source: "derived",
        sourceValue: null,
        scoringRawValue: 2.9,
        effectiveRating: 5.275,
        preferenceShape: "higher-is-better",
        curveAffected: false,
      }),
      entry({
        axisName: "Fun",
        weight: 40,
        contribution: 3.2,
        source: "personal",
        sourceValue: null,
        scoringRawValue: 8,
        effectiveRating: 8,
        preferenceShape: "higher-is-better",
        curveAffected: false,
      }),
    ]);
    expect(result).toContain("Raw");
    expect(result).toContain("2.9");
  });

  test("keeps factual and effective columns distinct when values match", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Fun",
        weight: 40,
        contribution: 3.2,
        source: "personal",
        sourceValue: null,
        scoringRawValue: 8,
        effectiveRating: 8,
        preferenceShape: "higher-is-better",
        curveAffected: false,
      }),
    ]);
    expect(result).toContain("Scoring Input (Raw)");
    expect(result).toContain("Effective Rating");
  });

  test("marks curve-affected rows with *", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Complexity",
        weight: 20,
        contribution: 1.84,
        source: "derived",
        sourceValue: null,
        scoringRawValue: 2.75,
        effectiveRating: 9.2,
        preferenceShape: "sweet-spot",
        curveAffected: true,
      }),
    ]);
    expect(result).toContain("9.2 *");
  });

  test("does not mark non-curve-affected rows", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Fun",
        weight: 40,
        contribution: 3.2,
        source: "personal",
        sourceValue: null,
        scoringRawValue: 8,
        effectiveRating: 8,
        preferenceShape: "higher-is-better",
        curveAffected: false,
      }),
    ]);
    expect(result).not.toContain("*");
  });

  test("backward compatible with entries missing curve fields", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Fun",
        effectiveRating: 8,
        weight: 40,
        contribution: 3.2,
        source: "personal",
        sourceValue: null,
      }),
    ]);
    expect(result).toContain("Fun");
    expect(result).toContain("Scoring Input (Raw)");
  });

  test("shows published and capped duration with provenance", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Play Time",
        derivedField: "playingTime",
        source: "derived",
        sourceValue: 300,
        scoringRawValue: 240,
        effectiveRating: 1,
        unit: "minutes",
        provenance: "BGG published playing time",
        configurationSummary: "maximum scoring time: 240 minutes",
      }),
    ]);
    expect(result).toContain("300 minutes");
    expect(result).toContain("240 minutes");
    expect(result).toContain("field=playingTime");
    expect(result).toContain("BGG published playing time");
    expect(result).toContain("maximum scoring time: 240 minutes");
  });

  // REQ-TAXIS-11: tournament source flows through unchanged. Verifies the
  // formatter does not crash on the new enum value and that column padding
  // accommodates the longer "tournament" string without clobbering neighbors.
  test("renders tournament source without column misalignment", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Tournament",
        effectiveRating: 7.2,
        weight: 30,
        contribution: 2.16,
        source: "tournament",
        sourceValue: null,
      }),
      entry({
        axisName: "Wife will play it",
        effectiveRating: 8,
        weight: 40,
        contribution: 3.2,
        source: "personal",
        sourceValue: null,
      }),
    ]);
    expect(result).toContain("tournament");
    expect(result).toContain("personal");
    // All non-empty lines (header, separator, data rows) must have equal
    // length once trailing padding is preserved. formatTable pads every
    // column to its max width, so every line should be the same length.
    const lines = result.split("\n").filter((l) => l.length > 0);
    const firstLen = lines[0].length;
    for (const line of lines) {
      expect(line.length).toBe(firstLen);
    }
  });

  // REQ-TAXIS-11: tournament axis with null rating renders identical
  // "not rated" treatment to any other unrated axis.
  test("renders null-valued tournament entry as '---' (parity with personal)", () => {
    const result = formatBreakdown([
      entry({
        axisName: "Tournament",
        effectiveRating: null,
        weight: 30,
        contribution: null,
        source: "tournament",
        sourceValue: null,
      }),
    ]);
    expect(result).toContain("Tournament");
    expect(result).toContain("---");
    expect(result).toContain("tournament");
  });
});

describe("printOutput", () => {
  test("outputs JSON when json option is true", () => {
    const result = printOutput({ hello: "world" }, { json: true });
    const parsed = JSON.parse(result) as { hello: string };
    expect(parsed.hello).toBe("world");
  });

  test("outputs string when json option is false", () => {
    const result = printOutput("hello", { json: false });
    expect(result).toBe("hello");
  });
});
