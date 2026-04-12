import { describe, test, expect } from "bun:test";
import { deriveNarrationState } from "../src/services/profile-service.js";
import type { ProfileNarration } from "@shelf-judge/shared";

const sampleNarration: ProfileNarration = {
  summary: "Test summary",
  surprises: ["surprise 1"],
  tensions: ["tension 1"],
  blindSpots: ["blind spot 1"],
  curveInsights: ["curve insight 1"],
};

describe("deriveNarrationState", () => {
  test("returns 'empty' when narration is null", () => {
    expect(deriveNarrationState(null, null, "2026-01-01T00:00:00Z")).toBe("empty");
  });

  test("returns 'empty' when narration is undefined", () => {
    expect(deriveNarrationState(undefined, undefined, "2026-01-01T00:00:00Z")).toBe("empty");
  });

  test("returns 'fresh' when narrationComputedAt equals profileComputedAt", () => {
    const timestamp = "2026-01-01T12:00:00Z";
    expect(deriveNarrationState(sampleNarration, timestamp, timestamp)).toBe("fresh");
  });

  test("returns 'fresh' when narrationComputedAt is after profileComputedAt", () => {
    expect(
      deriveNarrationState(sampleNarration, "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z"),
    ).toBe("fresh");
  });

  test("returns 'stale' when narrationComputedAt is before profileComputedAt", () => {
    expect(
      deriveNarrationState(sampleNarration, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"),
    ).toBe("stale");
  });

  test("returns 'stale' when narration exists but narrationComputedAt is null", () => {
    expect(deriveNarrationState(sampleNarration, null, "2026-01-01T00:00:00Z")).toBe("stale");
  });
});
