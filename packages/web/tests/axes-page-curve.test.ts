import { describe, expect, test } from "bun:test";
import type { Axis } from "@shelf-judge/shared";
import { curveStateFromAxis, curveStateToBody } from "@/lib/axis-curve-state";

const playingTimeAxis: Axis = {
  id: "time",
  name: "Play Time",
  description: "Preferred duration",
  weight: 50,
  enabled: true,
  source: "derived",
  derivedField: "playingTime",
  configuration: { maximumScoringTime: 240 },
  preferenceShape: "sweet-spot",
  idealValue: 90,
  toleranceWidth: 30,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("axes page numeric tolerance round-trip", () => {
  test("an unrelated edit preserves the existing numeric width", () => {
    const curve = curveStateFromAxis(playingTimeAxis);
    const body = { name: "Renamed Play Time", ...curveStateToBody(curve, "update") };

    expect(curve.toleranceWidth).toBe("30");
    expect(body.toleranceWidth).toBe(30);
    expect(body.tolerance).toBeNull();
  });

  test("an explicitly edited width is sent without a categorical tolerance", () => {
    const curve = { ...curveStateFromAxis(playingTimeAxis), toleranceWidth: "45" };
    const body = curveStateToBody(curve, "update");

    expect(body.toleranceWidth).toBe(45);
    expect(typeof body.tolerance).not.toBe("string");
  });
});
