import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GameDetailHero, GameDetailMain } from "@/app/games/[id]/page";

describe("responsive page structure", () => {
  test("keeps game detail content in the production responsive shell", () => {
    const html = renderToStaticMarkup(
      <GameDetailMain
        editors={{
          assessment: <table className="breakdown-table" />,
          ratings: <form className="rating-form" />,
          utilization: null,
          acquisition: null,
          intention: null,
          playMetadata: null,
          notes: null,
          relatedBggIds: null,
          ownership: null,
          boxDimensions: null,
          shelfAssignment: null,
        }}
      >
        <GameDetailHero>Responsive Game</GameDetailHero>
      </GameDetailMain>,
    );

    expect(html).toContain('class="main-scroll game-detail-main game-detail-chapters"');
    expect(html).toContain('class="game-hero"');
    expect(html).toContain('class="game-detail-chapter game-detail-assessment"');
    expect(html).toContain('class="game-detail-chapter game-detail-ratings"');
    expect(html).toContain('class="breakdown-table"');
    expect(html).toContain('class="rating-form"');
  });

  test("places independent collection and tournament cards after score and ratings", () => {
    const html = renderToStaticMarkup(
      <GameDetailMain
        editors={{
          assessment: <div>Score Breakdown</div>,
          ratings: <div>Your Ratings</div>,
          collectionInsights: (
            <>
              <section className="game-detail-chapter game-detail-redundancy">Redundancy</section>
              <section className="game-detail-chapter game-detail-niche-position">
                Niche Position
              </section>
            </>
          ),
          tournament: (
            <section className="game-detail-chapter game-detail-tournament">
              Tournament record
            </section>
          ),
          utilization: null,
          acquisition: null,
          intention: null,
          playMetadata: null,
          notes: null,
          relatedBggIds: null,
          ownership: null,
          boxDimensions: null,
          shelfAssignment: null,
        }}
      >
        <GameDetailHero>Core detail</GameDetailHero>
      </GameDetailMain>,
    );

    expect(html.indexOf("Score Breakdown")).toBeLessThan(html.indexOf("Your Ratings"));
    expect(html.indexOf("Your Ratings")).toBeLessThan(html.indexOf("Redundancy"));
    expect(html.indexOf("Redundancy")).toBeLessThan(html.indexOf("Niche Position"));
    expect(html.indexOf("Niche Position")).toBeLessThan(html.indexOf("Tournament record"));
    expect(html).toContain('class="game-detail-chapter game-detail-niche-position"');
    expect(html).toContain('class="game-detail-chapter game-detail-tournament"');
  });

  test("uses a native collapsed disclosure for hidden niches", async () => {
    const page = await Bun.file(new URL("../app/games/[id]/page.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../app/globals.css", import.meta.url)).text();

    expect(page).toContain('<details className="niche-ignored-section">');
    expect(page).toContain("Hidden niches ({ignoredTags.length})");
    expect(page).toContain("<NicheRestoreButton");
    expect(css).toContain(".niche-ignored-heading:focus-visible");
  });

  test("defines stacking and mobile reductions for the rendered page structures", async () => {
    const css = await Bun.file(new URL("../app/globals.css", import.meta.url)).text();

    expect(css).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.game-detail-main\.game-detail-chapters \{[\s\S]*?flex-direction: column;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 600px\)[\s\S]*?\.game-hero \{[\s\S]*?flex-wrap: wrap;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 600px\)[\s\S]*?\.breakdown-table th:nth-child\(2\)[\s\S]*?display: none;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.template-picker \{\s*grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.shelf-summary-bar \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.shelf-row-actions \{[\s\S]*?flex-basis: 100%;/,
    );
  });
});
