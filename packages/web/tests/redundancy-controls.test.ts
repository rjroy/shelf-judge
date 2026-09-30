import { describe, expect, test } from "bun:test";

describe("redundancy factual-weight controls", () => {
  test("supports migrated normalized 4:3 weights without slider step rounding", async () => {
    const page = await Bun.file(new URL("../app/redundancy/page.tsx", import.meta.url)).text();

    expect(page).toContain("Binary factual weight");
    expect(page).toContain("Continuous factual weight");
    expect(4 / 7).toBeGreaterThanOrEqual(0);
    expect(4 / 7).toBeLessThanOrEqual(1);
    expect(3 / 7).toBeGreaterThanOrEqual(0);
    expect(3 / 7).toBeLessThanOrEqual(1);
    expect(page).toMatch(/aria-label="Binary factual weight"[\s\S]*?step="0\.01"/);
    expect(page).toMatch(/aria-label="Continuous factual weight"[\s\S]*?step="0\.01"/);
    expect(page).toContain('"/api/daemon/redundancy/semantic/disclosure/page"');
    expect(page).toContain('"/api/daemon/redundancy/semantic/acknowledge-and-start"');
    expect(page).toContain("cachedOwnerNoteUseAuthorized: cachedNotes");
    expect(page).toMatch(
      /noteTransmissionAuthorized:\s*manifest\.signalScope === "description-only" \? false : noteTransmission/,
    );
    expect(page).toContain("Complete disclosed game-pair manifest");
  });
});
