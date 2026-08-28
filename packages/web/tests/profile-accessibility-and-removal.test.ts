import { describe, expect, test } from "bun:test";

describe("profile accessibility and removed surfaces", () => {
  test("defines visible focus, semantic color tokens, wrapping, minimum widths, and native target sizing", async () => {
    const css = await Bun.file(new URL("../app/globals.css", import.meta.url)).text();
    const profileCss = css.slice(
      css.indexOf(".profile-page"),
      css.indexOf("/* ===== Prediction Design Tokens ===== */"),
    );

    expect(profileCss).toContain(":focus-visible");
    expect(profileCss).toContain("outline: 3px solid var(--action)");
    expect(profileCss).toContain("overflow-wrap: anywhere");
    expect(profileCss).toContain("min-width: 0");
    expect(profileCss).toContain("min-height: 44px");
    expect(profileCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toContain("html {\n  overflow-x: hidden;");
  });

  test("removes superseded profile components and consumers", async () => {
    for (const path of [
      "components/profile/narration-section.tsx",
      "components/profile/axis-weights.tsx",
      "components/profile/utility-curves.tsx",
      "components/profile/bgg-clustering.tsx",
      "components/profile/divergence.tsx",
      "components/profile/outliers.tsx",
      "components/profile/suggestions.tsx",
      "components/profile/trusted-insights.tsx",
    ])
      expect(await Bun.file(new URL(`../${path}`, import.meta.url)).exists()).toBe(false);

    const overview = await Bun.file(new URL("../app/page.tsx", import.meta.url)).text();
    const gameDetail = await Bun.file(
      new URL("../app/games/[id]/page.tsx", import.meta.url),
    ).text();
    const api = await Bun.file(new URL("../lib/api.ts", import.meta.url)).text();
    const removed = [
      "narration",
      "axisWeights",
      "utilityCurves",
      "bggClustering",
      "divergence",
      "outliers",
      "suggestions",
      "ratedGameCount",
    ];
    for (const term of removed) {
      expect(overview).not.toContain(term);
      expect(gameDetail).not.toContain(term);
      expect(api).not.toContain(term);
    }

    const css = await Bun.file(new URL("../app/globals.css", import.meta.url)).text();
    for (const legacyCssMarker of [
      "LLM Narration",
      "Section card (profile sections)",
      "Axis distribution rows",
      "Axis weight breakdown",
      "BGG attribute clustering",
      "Weight range histogram",
      "Utility curves",
      "Divergence section",
      "Outliers",
      "Axis suggestions",
      "Trusted profile evidence",
      "Profile page game detail additions",
      ".narration-",
      ".section-card",
      ".axis-dist-row",
      ".weight-row",
      ".bgg-attr-",
      ".wt-bucket",
      ".curve-row",
      ".divergence-row",
      ".outlier-row",
      ".suggest-card",
      ".trusted-insight-",
      ".profile-divergence-detail",
      ".profile-outlier-detail",
    ])
      expect(css).not.toContain(legacyCssMarker);
  });

  test("leaves independent purchase-utilization and redundancy destinations intact", async () => {
    const gameDetail = await Bun.file(
      new URL("../app/games/[id]/page.tsx", import.meta.url),
    ).text();
    expect(gameDetail).toContain("PurchaseUtilizationPanel");
    expect(await Bun.file(new URL("../app/redundancy/page.tsx", import.meta.url)).exists()).toBe(
      true,
    );
  });

  test("profile production code does not sort or compute aggregate order", async () => {
    const paths = [
      "app/page.tsx",
      "app/profile/entities/page.tsx",
      "components/profile/identity-section.tsx",
      "components/profile/entity-card.tsx",
      "components/profile/entity-evidence.tsx",
      "components/profile/attention-section.tsx",
    ];
    for (const path of paths) {
      const source = await Bun.file(new URL(`../${path}`, import.meta.url)).text();
      expect(source).not.toContain(".sort(");
      expect(source).not.toContain("localeCompare(");
      expect(source).not.toContain(".reduce(");
    }
  });
});
