import { describe, expect, test } from "bun:test";
import type { Axis } from "@shelf-judge/shared";
import { getAxisWeightPercentage, getEnabledAxisWeightTotal } from "@/lib/axis-weight-utils";

const timestamp = "2026-01-01T00:00:00Z";

const enabledAxis: Axis = {
  id: "enabled",
  name: "Enabled Axis",
  description: null,
  weight: 40,
  enabled: true,
  source: "personal",
  createdAt: timestamp,
  updatedAt: timestamp,
};

const disabledAxis: Axis = {
  id: "disabled",
  name: "Preserved Legacy Axis",
  description: null,
  weight: 20,
  enabled: false,
  source: "legacy",
  reason: "unknown_legacy_field",
  legacyField: "futureMetric",
  legacyPayload: { originalField: "futureMetric" },
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("axes page enabled weight semantics", () => {
  test("excludes disabled axes from totals and percentages", () => {
    const totalWeight = getEnabledAxisWeightTotal([enabledAxis, disabledAxis]);
    expect(totalWeight).toBe(40);
    expect(getAxisWeightPercentage(enabledAxis, totalWeight)).toBe(100);
    expect(getAxisWeightPercentage(disabledAxis, totalWeight)).toBe(0);
  });

  test("keeps disabled axes visible and deletable while showing exclusion", async () => {
    const source = await Bun.file("packages/web/app/axes/page.tsx").text();
    expect(source).toContain("Disabled legacy axes");
    expect(source).toContain("Excluded from total");
    expect(source).toContain("onDelete={() => void handleDelete(axis)}");
    expect(source).toContain("!isTournament && (");
    expect(source).toContain("Delete");
  });
});
