import { describe, test, expect } from "bun:test";
import { formatTable, formatScore, formatBreakdown, printOutput } from "../src/output.js";

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
      {
        axisName: "Wife will play it",
        rating: 8,
        weight: 40,
        contribution: 3.2,
        source: "personal",
        bggOriginal: null,
      },
      {
        axisName: "Complexity",
        rating: 5.8,
        weight: 20,
        contribution: 1.16,
        source: "bgg",
        bggOriginal: null,
      },
    ]);
    expect(result).toContain("Axis");
    expect(result).toContain("Wife will play it");
    expect(result).toContain("Complexity");
    expect(result).toContain("personal");
    expect(result).toContain("bgg");
  });

  test("shows BGG original for override source", () => {
    const result = formatBreakdown([
      {
        axisName: "Community Rating",
        rating: 9,
        weight: 10,
        contribution: 0.9,
        source: "override",
        bggOriginal: 8.1,
      },
    ]);
    expect(result).toContain("(BGG: 8.1)");
    expect(result).toContain("override");
  });

  test("shows --- for unrated axes", () => {
    const result = formatBreakdown([
      {
        axisName: "Unrated",
        rating: null,
        weight: 30,
        contribution: null,
        source: "personal",
        bggOriginal: null,
      },
    ]);
    expect(result).toContain("---");
  });

  test("shows Raw column when rawValue differs from effectiveRating", () => {
    const result = formatBreakdown([
      {
        axisName: "Complexity",
        rating: 5.275,
        weight: 20,
        contribution: 1.055,
        source: "bgg",
        bggOriginal: null,
        rawValue: 2.9,
        effectiveRating: 5.275,
        preferenceShape: "higher-is-better",
        curveAffected: false,
      },
      {
        axisName: "Fun",
        rating: 8,
        weight: 40,
        contribution: 3.2,
        source: "personal",
        bggOriginal: null,
        rawValue: 8,
        effectiveRating: 8,
        preferenceShape: "higher-is-better",
        curveAffected: false,
      },
    ]);
    expect(result).toContain("Raw");
    expect(result).toContain("2.9");
  });

  test("hides Raw column when all rawValues equal effectiveRatings", () => {
    const result = formatBreakdown([
      {
        axisName: "Fun",
        rating: 8,
        weight: 40,
        contribution: 3.2,
        source: "personal",
        bggOriginal: null,
        rawValue: 8,
        effectiveRating: 8,
        preferenceShape: "higher-is-better",
        curveAffected: false,
      },
    ]);
    expect(result).not.toContain("Raw");
  });

  test("marks curve-affected rows with *", () => {
    const result = formatBreakdown([
      {
        axisName: "Complexity",
        rating: 9.2,
        weight: 20,
        contribution: 1.84,
        source: "bgg",
        bggOriginal: null,
        rawValue: 2.75,
        effectiveRating: 9.2,
        preferenceShape: "sweet-spot",
        curveAffected: true,
      },
    ]);
    expect(result).toContain("9.2 *");
  });

  test("does not mark non-curve-affected rows", () => {
    const result = formatBreakdown([
      {
        axisName: "Fun",
        rating: 8,
        weight: 40,
        contribution: 3.2,
        source: "personal",
        bggOriginal: null,
        rawValue: 8,
        effectiveRating: 8,
        preferenceShape: "higher-is-better",
        curveAffected: false,
      },
    ]);
    expect(result).not.toContain("*");
  });

  test("backward compatible with entries missing curve fields", () => {
    const result = formatBreakdown([
      {
        axisName: "Fun",
        rating: 8,
        weight: 40,
        contribution: 3.2,
        source: "personal",
        bggOriginal: null,
      },
    ]);
    expect(result).toContain("Fun");
    expect(result).not.toContain("Raw");
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
