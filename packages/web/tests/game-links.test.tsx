import { describe, test, expect } from "bun:test";
import { renderToString } from "react-dom/server";
import type {
  ReferenceGame,
  PredictionConfidence,
  FitnessBreakdownEntry,
} from "@shelf-judge/shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReferenceGame(overrides: Partial<ReferenceGame> = {}): ReferenceGame {
  return {
    gameId: "ref-789",
    gameName: "Reference Game",
    similarity: 0.85,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Score breakdown reference game links (REQ-GLINK-3)
// ---------------------------------------------------------------------------

describe("Score breakdown reference game links", () => {
  test("ScoreBreakdown renders without error with prediction metadata", async () => {
    const { ScoreBreakdown } = await import("@/components/score-breakdown");
    const html = renderToString(
      <ScoreBreakdown
        score={{
          score: 6.5,
          ratedAxisCount: 2,
          totalAxisCount: 5,
          breakdown: [
            {
              axisId: "fun",
              axisName: "Fun",
              rating: 7,
              weight: 50,
              rawValue: 7,
              contribution: 3.35,
              source: "personal",
              sourceValue: null,
              effectiveRating: 7,
              preferenceShape: "higher-is-better",
              curveAffected: false,
              predictionConfidence: null,
              referenceGames: null,
            } satisfies FitnessBreakdownEntry,
            {
              axisId: "depth",
              axisName: "Depth",
              rating: 6,
              weight: 50,
              rawValue: 6,
              contribution: 2.8,
              source: "predicted",
              sourceValue: null,
              effectiveRating: 6,
              preferenceShape: "higher-is-better",
              curveAffected: false,
              predictionConfidence: "strong",
              referenceGames: [
                makeReferenceGame({ gameId: "ref-1", gameName: "Ref Alpha" }),
                makeReferenceGame({ gameId: "ref-2", gameName: "Ref Beta" }),
              ],
            } satisfies FitnessBreakdownEntry,
          ],
          vetoed: false,
          vetoedBy: null,
          hypotheticalScore: null,
          predictionMeta: {
            readinessStage: 2 as const,
            confidence: "strong" as PredictionConfidence,
            predictedAxisCount: 1,
            actualAxisCount: 2,
            referenceGameCount: 5,
            coveragePercent: 0.8,
          },
        }}
      />,
    );
    expect(html).toContain("predicted-row");
    expect(html).toContain("source-predicted");
  });

  test("reference game links use correct href pattern in source", async () => {
    const file = await Bun.file("packages/web/components/score-breakdown.tsx").text();
    expect(file).toContain("href={`/games/${ref.gameId}`}");
    expect(file).toContain('className="game-link ref-game-name"');
    expect(file).toContain('import Link from "next/link"');
  });
});

// ---------------------------------------------------------------------------
// Tournament recent comparison links (REQ-GLINK-4, REQ-GLINK-8)
// ---------------------------------------------------------------------------

describe("Tournament recent comparison links", () => {
  test("opponent links use correct href pattern in source", async () => {
    const file = await Bun.file("packages/web/app/games/[id]/page.tsx").text();
    expect(file).toContain("href={`/games/${c.opponentGameId}`}");
    expect(file).toContain('className="game-link"');
  });

  test("no pre-validation of opponent game existence (REQ-GLINK-8)", async () => {
    const file = await Bun.file("packages/web/app/games/[id]/page.tsx").text();
    const linkSection = file.match(/tournament-opponent-id[\s\S]*?<\/span>/)?.[0];
    expect(linkSection).toBeDefined();
    expect(linkSection).not.toContain("exists");
    expect(linkSection).not.toContain("?.href");
    expect(linkSection).toContain("<Link");
  });
});

// ---------------------------------------------------------------------------
// Wishlist BGG links (REQ-WISH-LINK)
// ---------------------------------------------------------------------------

describe("Wishlist BGG links", () => {
  test("game name links to BGG using bggId", async () => {
    const file = await Bun.file("packages/web/app/wishlist/page.tsx").text();
    expect(file).toContain("href={`https://boardgamegeek.com/boardgame/${entry.bggId}`}");
  });

  test("wishlist game name link has game-link class", async () => {
    const file = await Bun.file("packages/web/app/wishlist/page.tsx").text();
    expect(file).toContain('className="game-link"');
  });

  test("wishlist game name link opens in new tab", async () => {
    const file = await Bun.file("packages/web/app/wishlist/page.tsx").text();
    expect(file).toContain('target="_blank"');
    expect(file).toContain('rel="noopener noreferrer"');
  });
});

// ---------------------------------------------------------------------------
// Capacity page links (REQ-SHELF-30, REQ-SHELF-33)
// ---------------------------------------------------------------------------

describe("Capacity page game links", () => {
  test("assigned game rows link to /games/{gameId}", async () => {
    const file = await Bun.file("packages/web/app/capacity/page.tsx").text();
    expect(file).toContain("href={`/games/${game.gameId}`}");
  });

  test("unfittable and displaced table entries link to /games/{gameId}", async () => {
    const file = await Bun.file("packages/web/app/capacity/page.tsx").text();
    expect(file).toContain("href={`/games/${entry.gameId}`}");
  });

  test("capacity page game links carry game-link class", async () => {
    const file = await Bun.file("packages/web/app/capacity/page.tsx").text();
    expect(file).toContain('className="shelf-game-name game-link"');
    expect(file).toContain('className="game-link"');
  });

  test("no /game/{id} singular-path links remain (Thorne finding #1)", async () => {
    const file = await Bun.file("packages/web/app/capacity/page.tsx").text();
    expect(file).not.toMatch(/href=\{`\/game\/\$\{/);
  });
});

// ---------------------------------------------------------------------------
// Negative cases: surfaces that should NOT have links
// ---------------------------------------------------------------------------

describe("Surfaces that must remain unchanged", () => {
  test("tournament session cards do not have game-link class in source", async () => {
    const file = await Bun.file("packages/web/app/tournament/session/page.tsx").text();
    expect(file).not.toContain("game-link");
  });

  test("search results do not have game-link class in source", async () => {
    const file = await Bun.file("packages/web/app/search/page.tsx").text();
    expect(file).not.toContain("game-link");
  });
});

// ---------------------------------------------------------------------------
// CSS class existence
// ---------------------------------------------------------------------------

describe("game-link CSS class", () => {
  test("globals.css defines .game-link with correct styles", async () => {
    const css = await Bun.file("packages/web/app/globals.css").text();
    expect(css).toContain(".game-link {");
    expect(css).toContain("color: var(--bgg-accent)");
    expect(css).toContain("text-decoration: none");
    expect(css).toContain("font-weight: inherit");
    expect(css).toContain("font-size: inherit");
  });

  test("globals.css defines .game-link:hover with underline", async () => {
    const css = await Bun.file("packages/web/app/globals.css").text();
    expect(css).toContain(".game-link:hover");
    expect(css).toContain("text-decoration: underline");
  });
});
