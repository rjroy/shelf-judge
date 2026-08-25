import { describe, expect, test } from "bun:test";

describe("search stage-zero score label", () => {
  test("uses generic available-data terminology", async () => {
    const source = await Bun.file("packages/web/app/search/page.tsx").text();
    expect(source).toContain("Available-data score:");
    expect(source).not.toContain("BGG-derived score:");
  });

  test("obsolete BGG-derived score wording is absent from production", async () => {
    const productionRoots = [
      "packages/shared/src",
      "packages/daemon/src",
      "packages/cli/src",
      "packages/web/app",
      "packages/web/components",
      "packages/web/lib",
    ];

    for (const root of productionRoots) {
      const files = new Bun.Glob("**/*.{ts,tsx}");
      for await (const path of files.scan(root)) {
        const source = await Bun.file(`${root}/${path}`).text();
        expect(source).not.toContain("BGG-derived score");
      }
    }
  });
});
