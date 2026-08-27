import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NarrationClaim } from "@/components/profile/narration-section";
import { trustedInsightProfileFixture } from "../../shared/tests/fixtures/trusted-profile";

describe("NarrationSection", () => {
  test("distinguishes observation and interpretation and links inspectable evidence", () => {
    const claim = {
      observation: "Game 3 is compositionally distant from its nearest comparisons.",
      interpretation: "It occupies an unusual position in this collection.",
      evidenceReferences: [{ insightId: "outlier:game-3", gameIds: ["game-3"] }] as [
        { insightId: string; gameIds: string[] },
      ],
    };

    const html = renderToStaticMarkup(
      <NarrationClaim claim={claim} profile={trustedInsightProfileFixture} />,
    );

    expect(html).toContain("Observation:");
    expect(html).toContain("Interpretation:");
    expect(html).toContain('href="#insight-outlier:game-3"');
    expect(html).toContain('href="/games/game-3"');
    expect(html).toContain("Game 3");
  });
});
