import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoreBreakdown } from "@/components/score-breakdown";

describe("game detail utilization integration", () => {
  test("requests canonical predicted detail without a separate prediction substitution", async () => {
    const api = await Bun.file("packages/web/lib/api.ts").text();
    const page = await Bun.file("packages/web/app/games/[id]/page.tsx").text();
    expect(api).toContain("/api/games/${id}?includePredicted=true");
    expect(page).not.toContain("predictGame");
    expect(page.indexOf("<PurchaseUtilizationPanel")).toBeLessThan(
      page.indexOf("<GameDetailPanels"),
    );
  });

  test("renders daemon displayScore rather than JavaScript tie rounding", () => {
    expect((1.15).toFixed(1)).toBe("1.1");
    const html = renderToStaticMarkup(
      <ScoreBreakdown
        displayScore="1.3"
        score={{
          score: 1.15,
          ratedAxisCount: 1,
          totalAxisCount: 1,
          breakdown: [],
          vetoed: false,
          vetoedBy: null,
          hypotheticalScore: null,
          predictionMeta: null,
          redundancyAdjustment: null,
        }}
      />,
    );
    expect(html).toContain(">1.3<");
    expect(html).not.toContain(">1.1<");
  });

  test("defines responsive result hierarchy for mobile and desktop", async () => {
    const css = await Bun.file("packages/web/app/globals.css").text();
    expect(css).toMatch(
      /\.utilization-primary-values \{[\s\S]*?grid-template-columns: repeat\(3, 1fr\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 600px\)[\s\S]*?\.utilization-primary-values,[\s\S]*?grid-template-columns: 1fr/,
    );
  });
});
