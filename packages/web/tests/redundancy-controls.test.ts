import { describe, expect, test } from "bun:test";

describe("redundancy run controls", () => {
  test("uses preview-bound explicit runs and no obsolete manifest flow", async () => {
    const page = await Bun.file(new URL("../app/redundancy/page.tsx", import.meta.url)).text();
    expect(page).toContain("Binary factual weight");
    expect(page).toMatch(/aria-label="Binary factual weight"[\s\S]*?step="0\.01"/);
    expect(page).toContain("/api/daemon/redundancy/semantic/run-preview");
    expect(page).toContain('/api/daemon/redundancy/semantic/run"');
    expect(page).toContain("requestId: preview.requestId");
    expect(page).toContain("precondition: preview.precondition");
    expect(page).toContain("/api/daemon/redundancy/semantic/active-run");
    expect(page).toContain("/api/daemon/redundancy/semantic/cancel");
    expect(page).toContain("noteTransmissionAuthorized");
    expect(page).toContain("maxProviderAttempts");
    expect(page).toContain("reportedTokenThresholdIsBilledCeiling");
    expect(page).not.toContain("/semantic/disclosure");
    expect(page).not.toContain("acknowledge-and-start");
    expect(page).not.toContain("Complete disclosed game-pair manifest");
    expect(page).toContain("noteTransmissionAuthorized:");
    expect(page).toContain("setActiveRun({ runId: result.runId })");
    expect(page).toContain("cancel(activeRun.runId)");
    expect(page).toContain(
      "disabled={busy || !preview.withinPairLimit || preview.pairCount === 0}",
    );
    expect(page).toContain("note-based results may remain incomplete");
    expect(page).toContain("setInterval(() => void poll(), 60_000)");
    expect(page).not.toContain("setInterval(() => void poll(), 1500)");
    expect(page).toContain("if (inFlight) return;");
    expect(page).toContain("window.clearInterval(timer)");
    expect(page).not.toContain("semanticMigrationCopy");
    expect(page).not.toContain("Semantic cache storage was upgraded");
    expect(page).toContain("Allow my game notes in JEV comparisons");
    expect(page).toContain("Checking and saving this never sends your notes.");
    expect(page).toContain("makes them eligible to send to JEV during a run");
    expect(page).toContain("separately in that run&apos;s preview");
    expect(page).toContain("Turning this off deletes saved comparisons");
  });
});
