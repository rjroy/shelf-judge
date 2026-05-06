// Tests for the score-breakdown SourceBadge helper.
//
// Covers REQ-TAXIS-11: tournament source renders cleanly with parity styling
// to existing per-game sources (no third visual category).

import { describe, test, expect } from "bun:test";
import { renderToString } from "react-dom/server";
import { SourceBadge } from "@/components/score-breakdown";

describe("SourceBadge", () => {
  test("renders 'Personal' label with source-personal class", () => {
    const html = renderToString(<SourceBadge source="personal" />);
    expect(html).toContain("Personal");
    expect(html).toContain("source-personal");
  });

  test("renders 'BGG' label with source-bgg class", () => {
    const html = renderToString(<SourceBadge source="bgg" />);
    expect(html).toContain("BGG");
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
