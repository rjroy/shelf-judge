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
  });
});
