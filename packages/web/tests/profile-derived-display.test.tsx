import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { AxisDistributions } from "@/components/profile/axis-distributions";
import { UtilityCurves } from "@/components/profile/utility-curves";

describe("derived profile presentation", () => {
  test("labels histograms as effective 1-10 ratings", () => {
    const html = renderToString(
      <AxisDistributions
        gameCount={2}
        distributions={[
          {
            axisId: "duration",
            axisName: "Duration preference",
            mean: 7,
            median: 7,
            standardDeviation: 1,
            range: { min: 6, max: 8 },
            ratedGameCount: 2,
            histogram: [0, 0, 0, 0, 0, 1, 0, 1, 0, 0],
          },
        ]}
      />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain("Effective Rating Distributions (1-10)");
    expect(html).toContain("Effective preference rating, 1-10");
    expect(html).not.toContain('minutes</span><span class="hist-label-tick"');
  });

  test("shows native scale, unit, provenance, configuration, and numeric tolerance", () => {
    const html = renderToString(
      <UtilityCurves
        curves={[
          {
            axisId: "duration",
            axisName: "Duration preference",
            derivedField: "playingTime",
            shape: "sweet-spot",
            idealValue: 90,
            tolerance: null,
            toleranceWidth: 30,
            leanDirection: null,
            vetoThreshold: { direction: "above", threshold: 180 },
            nativeScale: { min: 1, max: 240 },
            unit: "minutes",
            provenance: "Publisher-listed duration",
            configurationSummary: "Scoring cap: 240 minutes",
          },
        ]}
      />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain("Tolerance: 30 minutes");
    expect(html).toContain("Ideal: 90 minutes");
    expect(html).toContain("Veto above 180 minutes");
    expect(html).toContain("Native scale: 1-240 minutes");
    expect(html).toContain("Publisher-listed duration");
    expect(html).toContain("Scoring cap: 240 minutes");
  });

  test("preserves unitless ideal and veto declarations", () => {
    const html = renderToString(
      <UtilityCurves
        curves={[
          {
            axisId: "personal",
            axisName: "Personal",
            derivedField: null,
            shape: "sweet-spot",
            idealValue: 7,
            tolerance: "moderate",
            toleranceWidth: null,
            leanDirection: null,
            vetoThreshold: { direction: "below", threshold: 3 },
            nativeScale: { min: 1, max: 10 },
            unit: null,
            provenance: null,
            configurationSummary: null,
          },
        ]}
      />,
    ).replaceAll("<!-- -->", "");

    expect(html).toContain("Ideal: 7");
    expect(html).toContain("Veto below 3");
    expect(html).not.toContain("Ideal: 7 native units");
    expect(html).not.toContain("Veto below 3 native units");
  });
});
