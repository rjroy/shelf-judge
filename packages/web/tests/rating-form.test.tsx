// Tests for RatingForm rating interpretation label integration.
//
// RatingForm is a "use client" component that depends on useRouter (Next.js).
// Full renderToString is not available without the App Router context.
// Following the established game-links.test.tsx pattern, structural label
// behavior is verified via source-code inspection. Label correctness is
// covered by packages/shared/tests/rating-labels.test.ts — these tests
// verify the wiring between the component and the label utility.

import { describe, test, expect } from "bun:test";

const RATING_FORM_PATH = "packages/web/components/rating-form.tsx";

describe("RatingForm — rating label wiring (source inspection)", () => {
  test("component imports getRatingLabel from @shelf-judge/shared", async () => {
    const src = await Bun.file(RATING_FORM_PATH).text();
    expect(src).toContain('import { getRatingLabel } from "@shelf-judge/shared"');
  });

  // When ratings[axis.id] is a valid integer string (e.g. "7"), the component
  // calls getRatingLabel and renders the result inside a .rating-label-hint div.
  test("personal axis rating field renders label inside .rating-label-hint", async () => {
    const src = await Bun.file(RATING_FORM_PATH).text();
    expect(src).toContain("rating-label-hint");
    expect(src).toContain("axisLabel");
  });

  // When the field is empty, parseInt returns NaN, getRatingLabel(NaN) returns
  // null, so axisLabel is null and the hint element is not rendered.
  test("empty field guard: label only renders when axisLabel is truthy", async () => {
    const src = await Bun.file(RATING_FORM_PATH).text();
    // axisLabel is declared with getRatingLabel before the return
    expect(src).toContain("const axisLabel = getRatingLabel(");
    // The hint div is guarded by axisLabel
    expect(src).toContain("axisLabel &&");
  });

  // BGG auto-value section: when currentRatings[axis.id] is defined, label is
  // rendered next to the numeric value.
  test("BGG auto-value section calls getRatingLabel for the current BGG value", async () => {
    const src = await Bun.file(RATING_FORM_PATH).text();
    expect(src).toContain("bgg-auto-value");
    // bggLabel is extracted before the return and used in the render
    expect(src).toContain("bggLabel");
  });

  test("prediction hint block renders label next to the predicted value", async () => {
    const src = await Bun.file(RATING_FORM_PATH).text();
    expect(src).toContain("rating-predict-hint-value");
    // hintLabel is pre-computed from getRatingLabel and spliced in inline
    expect(src).toContain("hintLabel");
  });
});

describe("RatingForm — label content correctness via getRatingLabel", () => {
  test("getRatingLabel(7) returns 'Very Good'", async () => {
    const { getRatingLabel } = await import("@shelf-judge/shared");
    expect(getRatingLabel(7)).toBe("Very Good");
  });

  test("getRatingLabel returns null for NaN (empty field guard)", async () => {
    const { getRatingLabel } = await import("@shelf-judge/shared");
    // parseInt("", 10) is NaN — empty field must not show a label
    expect(getRatingLabel(NaN)).toBeNull();
  });

  test("getRatingLabel(8) returns 'Recommended' (BGG auto-value scenario)", async () => {
    const { getRatingLabel } = await import("@shelf-judge/shared");
    expect(getRatingLabel(8)).toBe("Recommended");
  });

  test("each label string only appears for its intended rating value", async () => {
    const { getRatingLabel } = await import("@shelf-judge/shared");
    const expectedLabels: Record<number, string> = {
      1: "Offensive",
      2: "Inexplicable",
      3: "Just Bad",
      4: "Not Good",
      5: "Fine",
      6: "Good",
      7: "Very Good",
      8: "Recommended",
      9: "Definitive",
      10: "Essential",
    };
    for (const [rating, label] of Object.entries(expectedLabels)) {
      expect(getRatingLabel(Number(rating))).toBe(label);
    }
  });
});
