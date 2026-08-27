import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Divergence } from "@/components/profile/divergence";
import { Outliers } from "@/components/profile/outliers";
import { Suggestions } from "@/components/profile/suggestions";
import { TrustedInsightSection } from "@/components/profile/trusted-insights";
import {
  emptyInsightProfileFixture,
  trustedInsightProfileFixture,
} from "../../shared/tests/fixtures/trusted-profile";

describe("trusted insight presentation", () => {
  test("renders reported and insufficient divergence with inspectable evidence", () => {
    const html = renderToStaticMarkup(
      <Divergence games={trustedInsightProfileFixture.divergence} />,
    );

    expect(html).toContain("Reported pattern");
    expect(html).toContain("Insufficient evidence");
    expect(html).toContain("Tournament score is 4.0 points above independent fitness");
    expect(html).toContain("Why it is notable");
    expect(html).toContain("Confidence: moderate");
    expect(html).toContain("Tournament score");
    expect(html).toContain("Independent fitness");
    expect(html).toContain("Ten Tournament comparisons meet the reporting threshold");
    expect(html).toContain("At least six comparisons are required before reporting divergence");
    expect(html).toContain("Tournament preference reflects only the opponents compared so far");
    expect(html).toContain('href="/games/game-1"');
    expect(html).toContain('href="/games/game-2"');
  });

  test("renders reported and insufficient outliers from the same contract fields", () => {
    const html = renderToStaticMarkup(
      <Outliers outliers={trustedInsightProfileFixture.outliers} />,
    );

    expect(html).toContain("Game 3 is compositionally distant");
    expect(html).toContain("The mean distance exceeds 0.5 with a material factual driver");
    expect(html).toContain("Six owned games passed factual metadata coverage gates");
    expect(html).toContain("At least 60% of owned games need usable factual metadata");
    expect(html).toContain("Games missing any required factual dimension");
    expect(html).toContain('href="/games/game-4"');
    expect(html).toContain('href="/games/game-5"');
  });

  test("frames retained suggestions as questions and distinguishes suppressed and retired states", () => {
    const html = renderToStaticMarkup(
      <Suggestions suggestions={trustedInsightProfileFixture.suggestions} />,
    );

    expect(html).toContain("Questions from Your Collection");
    expect(html).toContain("Question to consider");
    expect(html).toContain("Could Area Control explain why Tournament preference is higher?");
    expect(html).toContain("Suppressed");
    expect(html).toContain("Retired method");
    expect(html).toContain("Area Control is confounded by another candidate attribute");
    expect(html).toContain("The concentration recommendation method is retired");
    expect(html).not.toContain("Create an axis");
  });

  test("distinguishes evaluated-empty from unavailable", () => {
    const empty = renderToStaticMarkup(
      <Divergence games={emptyInsightProfileFixture.divergence} />,
    );
    const unavailable = renderToStaticMarkup(<Divergence games={null} />);

    expect(empty).toContain("Evaluated, nothing notable");
    expect(empty).not.toContain("Analysis unavailable");
    expect(unavailable).toContain("Analysis unavailable");
    expect(unavailable).toContain("Tournament preference evidence is not available yet");
  });

  test("associates abstentions and evidence-backed questions with game detail", () => {
    const divergence = renderToStaticMarkup(
      <Divergence games={trustedInsightProfileFixture.divergence} gameId="game-2" />,
    );
    const outlier = renderToStaticMarkup(
      <Outliers outliers={trustedInsightProfileFixture.outliers} gameId="game-3" />,
    );
    const questions = renderToStaticMarkup(
      <Suggestions suggestions={trustedInsightProfileFixture.suggestions} gameId="game-4" />,
    );

    expect(divergence).toContain("Insufficient evidence");
    expect(divergence).toContain("At least six comparisons are required");
    expect(outlier).toContain("Game 3 is compositionally distant");
    expect(questions).toContain("Could Area Control explain");
    expect(questions).toContain("Game 4");
  });

  test("associates an outlier abstention by its stable per-game id without details", () => {
    const insufficient = trustedInsightProfileFixture.outliers.find(
      (insight) => insight.status === "insufficient",
    );
    if (insufficient?.status !== "insufficient") {
      throw new Error("Missing insufficient outlier fixture");
    }
    const gameScoped = { ...insufficient, id: "outlier:game-6" };
    const matching = renderToStaticMarkup(<Outliers outliers={[gameScoped]} gameId="game-6" />);
    const unrelated = renderToStaticMarkup(
      <Outliers outliers={[gameScoped]} gameId="unrelated-game" />,
    );

    expect(matching).toContain("Insufficient evidence");
    expect(matching).toContain("At least 60% of owned games need usable factual metadata");
    expect(unrelated).toContain("Evaluated, nothing notable");
    expect(unrelated).not.toContain("At least 60% of owned games need usable factual metadata");
  });

  test("preserves collection and method-level abstentions on unrelated game detail", () => {
    const outlier = renderToStaticMarkup(
      <Outliers outliers={trustedInsightProfileFixture.outliers} gameId="unrelated-game" />,
    );
    const questions = renderToStaticMarkup(
      <Suggestions
        suggestions={trustedInsightProfileFixture.suggestions}
        gameId="unrelated-game"
      />,
    );

    expect(outlier).toContain('aria-labelledby="trusted-insight-outlier-collection"');
    expect(outlier).toContain("At least 60% of owned games need usable factual metadata");
    expect(outlier).not.toContain("Evaluated, nothing notable");
    expect(questions).toContain('aria-labelledby="trusted-insight-axis-suggestion-insufficient"');
    expect(questions).toContain("At least six evaluated games are required");
    expect(questions).not.toContain("Evaluated, nothing notable");
  });

  test("uses the same evidence and explanation markup on overview and game detail", () => {
    const overview = renderToStaticMarkup(
      <Divergence games={trustedInsightProfileFixture.divergence} />,
    );
    const detail = renderToStaticMarkup(
      <Divergence games={trustedInsightProfileFixture.divergence} gameId="game-1" />,
    );

    for (const text of [
      "Tournament score",
      "Independent fitness",
      "Why it is notable",
      "Tournament preference reflects only the opponents compared so far",
    ]) {
      expect(overview).toContain(text);
      expect(detail).toContain(text);
    }
  });

  test("exposes a common responsive structure for overview and game detail", async () => {
    const overview = renderToStaticMarkup(
      <TrustedInsightSection title="Evidence" insights={[]} emptyMessage="Nothing notable" />,
    );
    const detail = renderToStaticMarkup(
      <TrustedInsightSection
        title="Evidence"
        insights={[]}
        emptyMessage="Nothing notable"
        compact
      />,
    );
    const css = await Bun.file(new URL("../app/globals.css", import.meta.url)).text();

    expect(overview).toContain('data-insight-layout="responsive"');
    expect(detail).toContain("trusted-insight-section compact");
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.trusted-insight-meta-grid[\s\S]*?grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 600px\)[\s\S]*?\.trusted-insight-card[\s\S]*?padding: 12px;/,
    );
    expect(css).toMatch(/\.trusted-insight-card \{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(/\.trusted-insight-card \{[\s\S]*?overflow-wrap: anywhere;/);
  });

  test("uses semantic section and card headings with labelled relationships", () => {
    const html = renderToStaticMarkup(
      <Divergence games={trustedInsightProfileFixture.divergence} />,
    );

    expect(html).toContain(
      '<section class="section-card trusted-insight-section" data-insight-layout="responsive" aria-labelledby="trusted-insight-section-preference-divergence">',
    );
    expect(html).toContain(
      '<h2 id="trusted-insight-section-preference-divergence" class="section-title-main">Preference Divergence</h2>',
    );
    expect(html).toContain(
      'data-insight-status="reported" aria-labelledby="trusted-insight-divergence-game-1"',
    );
    expect(html).toContain(
      '<h3 id="trusted-insight-divergence-game-1" class="trusted-insight-heading">',
    );
    expect(html).toContain('href="/games/game-1"');
  });
});
