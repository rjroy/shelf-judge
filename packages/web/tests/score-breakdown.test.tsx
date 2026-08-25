// Tests for the score-breakdown SourceBadge helper.
//
// Covers REQ-TAXIS-11: tournament source renders cleanly with parity styling
// to existing per-game sources (no third visual category).

import { describe, test, expect } from "bun:test";
import { renderToString } from "react-dom/server";
import { SourceBadge, ScoreBreakdown } from "@/components/score-breakdown";
import type { FitnessBreakdownEntry, FitnessResult } from "@shelf-judge/shared";

describe("SourceBadge", () => {
  test("renders 'Personal' label with source-personal class", () => {
    const html = renderToString(<SourceBadge source="personal" />);
    expect(html).toContain("Personal");
    expect(html).toContain("source-personal");
  });

  test("renders 'Derived' label with source-bgg class", () => {
    const html = renderToString(<SourceBadge source="derived" />);
    expect(html).toContain("Derived");
    expect(html).toContain("source-bgg");
  });

  test("renders 'Override' label with source-override class", () => {
    const html = renderToString(<SourceBadge source="override" />);
    expect(html).toContain("Override");
    expect(html).toContain("source-override");
  });

  test("renders 'Predicted' label with source-predicted class", () => {
    const html = renderToString(<SourceBadge source="predicted" />);
    expect(html).toContain("Predicted");
    expect(html).toContain("source-predicted");
  });

  // REQ-TAXIS-11: tournament source must render with the same visual treatment
  // as an existing source. We reuse the personal-source class because
  // tournament is also a per-game user-derived signal on a 1-10 scale, and
  // introducing a third visual category was an explicit anti-goal.
  test("renders 'Tournament' label using the personal-source class (parity)", () => {
    const html = renderToString(<SourceBadge source="tournament" />);
    expect(html).toContain("Tournament");
    expect(html).toContain("source-personal");
    // No separate tournament-specific badge class.
    expect(html).not.toContain("source-tournament");
  });

  // Defensive: an unrecognized source falls back to the personal styling
  // rather than crashing.
  test("falls back to personal styling for unknown source values", () => {
    const html = renderToString(<SourceBadge source="future-source" />);
    expect(html).toContain("source-personal");
  });
});

// Minimal FitnessBreakdownEntry builder — fills in all required fields with
// safe defaults so tests only need to specify what they care about.
function makeEntry(overrides: Partial<FitnessBreakdownEntry>): FitnessBreakdownEntry {
  return {
    axisId: "axis-1",
    axisName: "Complexity",
    weight: 10,
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
    overridden: false,
    predictionConfidence: null,
    referenceGames: null,
    ...overrides,
  };
}

function makeResult(entries: FitnessBreakdownEntry[]): FitnessResult {
  return {
    score: 7.0,
    ratedAxisCount: entries.filter((e) => e.effectiveRating !== null).length,
    totalAxisCount: entries.length,
    breakdown: entries,
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: null,
    redundancyAdjustment: null,
  };
}

describe("BreakdownRow — rating interpretation labels", () => {
  test("rated entry with rating 8 renders 'Recommended' in the row", () => {
    const entry = makeEntry({ effectiveRating: 8, contribution: 5.6 });
    const html = renderToString(<ScoreBreakdown score={makeResult([entry])} />);
    expect(html).toContain("Recommended");
  });

  test("rated entry with rating null renders em-dash and no label", () => {
    const entry = makeEntry({ effectiveRating: null });
    const html = renderToString(<ScoreBreakdown score={makeResult([entry])} />);
    // em-dash unicode entity renders as the character itself in renderToString
    expect(html).toContain("\u2014");
    // None of the label strings should appear
    const labels = [
      "Offensive",
      "Inexplicable",
      "Just Bad",
      "Not Good",
      "Fine",
      "Good",
      "Very Good",
      "Recommended",
      "Definitive",
      "Essential",
    ];
    for (const label of labels) {
      expect(html).not.toContain(label);
    }
  });

  test("override detail retains factual metadata while rating renders its label", () => {
    const entry = makeEntry({
      source: "override",
      sourceValue: 5.8,
      overridden: true,
      effectiveRating: 6,
      contribution: 4.2,
    });
    const html = renderToString(<ScoreBreakdown score={makeResult([entry])} />);
    expect(html).toContain("breakdown-override-detail");
    expect(html).toContain("5.8");
    expect(html).toContain("Good");
  });

  test("derived row with rating 7 renders 'Very Good' via the effective-rating cell", () => {
    const entry = makeEntry({
      source: "derived",
      effectiveRating: 7,
      contribution: 4.9,
    });
    const html = renderToString(<ScoreBreakdown score={makeResult([entry])} />);
    expect(html).toContain("Very Good");
  });

  test("override detail with factual value 5.4 renders effective label 'Fine'", () => {
    const entry = makeEntry({
      source: "override",
      sourceValue: 5.4,
      overridden: true,
      effectiveRating: 5,
      contribution: 3.5,
    });
    const html = renderToString(<ScoreBreakdown score={makeResult([entry])} />);
    expect(html).toContain("breakdown-override-detail");
    expect(html).toContain("5.4");
    expect(html).toContain("Fine");
  });
});
