import { describe, expect, test } from "bun:test";

describe("redundancy factual-weight controls", () => {
  test("supports migrated normalized 4:3 weights without slider step rounding", async () => {
    const page = await Bun.file(new URL("../app/redundancy/page.tsx", import.meta.url)).text();

    expect(page).toContain("componentWeights: { binary: 4 / 7, continuous: 3 / 7 }");
    expect(4 / 7).toBeGreaterThanOrEqual(0);
    expect(4 / 7).toBeLessThanOrEqual(1);
    expect(3 / 7).toBeGreaterThanOrEqual(0);
    expect(3 / 7).toBeLessThanOrEqual(1);
    expect(page).toMatch(
      /type="range"\s+min="0"\s+max="1"\s+step="any"\s+value=\{settings\.componentWeights\.binary\}/,
    );
    expect(page).toMatch(
      /type="range"\s+min="0"\s+max="1"\s+step="any"\s+value=\{settings\.componentWeights\.continuous\}/,
    );
  });
});
