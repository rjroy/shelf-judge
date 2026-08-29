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
      "components/profile/entity-explorer-focus.tsx",
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
