import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

void mock.module("@/lib/api", () => ({
  getGame: () =>
    Promise.resolve({
      game: {
        id: "game-1",
        name: "Responsive Game",
        ownership: "owned",
        bggId: null,
        imageUrl: null,
        yearPublished: 2026,
        minPlayers: 1,
        maxPlayers: 4,
        bestPlayers: null,
        playingTime: 90,
        numPlays: 0,
        boxDimensions: null,
        manualShelfId: null,
        bggData: null,
        ratings: {},
      },
      score: null,
      nichePosition: null,
    }),
  listAxes: () => Promise.resolve([]),
  getTournamentGameStats: () => Promise.reject(new Error("No tournament stats")),
  getProfile: () => Promise.resolve({ divergence: [], outliers: [] }),
  predictGame: () => Promise.resolve({ score: null }),
  getNicheSettings: () => Promise.resolve({ ignoredTags: [] }),
  getShelfConfig: () => Promise.resolve(null),
}));

void mock.module("@/components/score-breakdown", () => ({
  ScoreBreakdown: () => <table className="breakdown-table" />,
}));
void mock.module("@/components/rating-form", () => ({
  RatingForm: () => <form className="rating-form" />,
}));
void mock.module("@/components/game-actions", () => ({
  GameActions: () => <div />,
  OwnershipActions: () => <div />,
}));
void mock.module("@/components/niche-ignore-button", () => ({
  NicheIgnoreButton: () => <button type="button" />,
  NicheRestoreButton: () => <button type="button" />,
}));
void mock.module("@/components/box-dimensions-form", () => ({
  BoxDimensionsForm: () => <form />,
}));
void mock.module("@/components/shelf-assignment-form", () => ({
  ShelfAssignmentForm: () => <form />,
}));

const { default: GameDetailPage } = await import("@/app/games/[id]/page");

describe("responsive page structure", () => {
  test("keeps game detail content in the production responsive shell", async () => {
    const page = await GameDetailPage({ params: Promise.resolve({ id: "game-1" }) });
    const html = renderToStaticMarkup(page);

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
