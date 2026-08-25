import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GameDetailHero, GameDetailMain, GameDetailPanels } from "@/app/games/[id]/page";

describe("responsive page structure", () => {
  test("keeps game detail content in the production responsive shell", () => {
    const html = renderToStaticMarkup(
      <GameDetailMain>
        <GameDetailHero>Responsive Game</GameDetailHero>
        <GameDetailPanels
          left={<table className="breakdown-table" />}
          right={<form className="rating-form" />}
        />
      </GameDetailMain>,
    );

    expect(html).toContain('class="main-scroll"');
    expect(html).toContain('class="game-hero"');
    expect(html).toContain('class="detail-panels"');
    expect(html).toContain('class="panel-left"');
    expect(html).toContain('class="panel-right"');
    expect(html).toContain('class="breakdown-table"');
    expect(html).toContain('class="rating-form"');
  });

  test("defines stacking and mobile reductions for the rendered page structures", async () => {
    const css = await Bun.file(new URL("../app/globals.css", import.meta.url)).text();

    expect(css).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.detail-panels \{\s*grid-template-columns: 1fr;/,
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
