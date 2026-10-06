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
    expect(page).toContain("/api/daemon/redundancy/semantic/refresh-progress");
    expect(page).toContain("/api/daemon/redundancy/semantic/refresh-status");
    expect(page).toContain("Refresh coverage");
    expect(page).toContain("Refresh progress");
    expect(page).toContain(
      "wasActive.current || activityUnavailable.current || runPublicationExpected.current",
    );
    expect(page).toContain("const statusRecoveredWithoutPending =");
    expect(page).toContain("measurePending.current = true");
    expect(page).toContain("setRefresh(null)");
    expect(page).toContain("Coverage is not being presented as current");
    expect(page).toContain("/api/daemon/redundancy/semantic/cancel");
    expect(page).toContain("noteTransmissionAuthorized");
    expect(page).toContain("maxProviderAttempts");
    expect(page).toContain("reportedTokenThresholdIsBilledCeiling");
    expect(page).not.toContain("/semantic/disclosure");
    expect(page).not.toContain("acknowledge-and-start");
    expect(page).not.toContain("Complete disclosed game-pair manifest");
    expect(page).toContain("noteTransmissionAuthorized:");
    expect(page).toContain("runId: result.runId");
    expect(page).toContain("activeRunRef.current = localActivity");
    expect(page).toContain("const currentRun = activeRunRef.current");
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
    expect(page).toContain("Use cached comparisons based on my notes");
    expect(page).toContain("Saving this never sends notes.");
    expect(page).toContain("eligible for a separately confirmed run");
    expect(page).toMatch(/Turning it off deletes saved note-based\s+comparisons\./);
    expect(page).toContain("clearPreparedDisclosure();\n    setSemantic");
    expect(page).toContain("cached-result use");
    expect(page).toContain("Show separately");
    expect(page).toContain("Include in fitness");
  });
});
