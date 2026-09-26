import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { RedundancyAdjustment } from "@shelf-judge/shared";
import { WishlistRedundancyPreview } from "@/app/wishlist/page";

const preview: RedundancyAdjustment = {
  originalScore: 8.4,
  adjustedScore: 7.1,
  penalty: 1.3,
  nicheRank: 1,
  nicheSize: 4,
  nicheNeighbors: [
    { gameId: "a", gameName: "Similar One", similarity: 0.91, fitnessScore: 8, isPredicted: false },
    { gameId: "b", gameName: "Similar Two", similarity: 0.82, fitnessScore: 7, isPredicted: false },
    {
      gameId: "c",
      gameName: "Similar Three",
      similarity: 0.73,
      fitnessScore: 6,
      isPredicted: false,
    },
    {
      gameId: "d",
      gameName: "Similar Four",
      similarity: 0.64,
      fitnessScore: 5,
      isPredicted: false,
    },
  ],
};

function markup(value: RedundancyAdjustment | null | undefined, predictionAvailable = true) {
  return renderToString(
    <WishlistRedundancyPreview preview={value} predictionAvailable={predictionAvailable} />,
  );
}

describe("wishlist redundancy preview", () => {
  test("shows adjusted score, penalty, and only the top three similar games", () => {
    const html = markup(preview).replaceAll("<!-- -->", "");
    expect(html).toContain("With redundancy:");
    expect(html).toContain(">7.1</strong>");
    expect(html).toContain("-1.3");
    expect(html).toContain("Similar One");
    expect(html).toContain("91%");
    expect(html).toContain("Similar Three");
    expect(html).not.toContain("Similar Four");
    expect(html).not.toContain("Snapshot from when added or last refreshed.");
  });

  test("shows the empty-neighbors message without claiming a penalty", () => {
    const html = markup({ ...preview, penalty: 0, nicheNeighbors: [] });
    expect(html).toContain("No similar games in collection.");
    expect(html).not.toContain("(-");
    expect(html).toContain("With redundancy:");
  });

  test("renders nothing when the preview is null or unavailable", () => {
    expect(markup(null)).toBe("");
    expect(markup(undefined)).toBe("");
    expect(markup(preview, false)).toBe("");
  });
});
