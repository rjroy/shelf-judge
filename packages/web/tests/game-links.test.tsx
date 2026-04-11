import { describe, test, expect } from "bun:test";
import { renderToString } from "react-dom/server";
import type {
  DivergentGame,
  CollectionOutlier,
  ReferenceGame,
  PredictionConfidence,
  FitnessBreakdownEntry,
} from "@shelf-judge/shared";
import { Divergence } from "@/components/profile/divergence";
import { Outliers } from "@/components/profile/outliers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDivergentGame(overrides: Partial<DivergentGame> = {}): DivergentGame {
  return {
    gameId: "game-123",
    gameName: "Test Game",
    fitnessScore: 7.5,
    normalizedTournamentScore: 5.2,
    gap: 2.3,
    direction: "fitness-outlier",
    ...overrides,
  };
}

function makeOutlier(overrides: Partial<CollectionOutlier> = {}): CollectionOutlier {
  return {
    gameId: "outlier-456",
    gameName: "Outlier Game",
    distances: { binary: 0.8, continuous: 0.6, personalAxes: 0.5, composite: 0.7 },
    classifications: ["lone-wolf"],
    fitnessScore: 6.0,
    ...overrides,
  };
}

function makeReferenceGame(overrides: Partial<ReferenceGame> = {}): ReferenceGame {
  return {
    gameId: "ref-789",
    gameName: "Reference Game",
    similarity: 0.85,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: extract all <a> tags with their href from rendered HTML
// ---------------------------------------------------------------------------

function extractLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const regex = /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    links.push({ href: match[1], text: match[2] });
  }
  return links;
}

// ---------------------------------------------------------------------------
// Divergence links (REQ-GLINK-1)
// ---------------------------------------------------------------------------

describe("Divergence game links", () => {
  test("each game name links to /games/{gameId}", () => {
    const games = [
      makeDivergentGame({ gameId: "abc", gameName: "Alpha" }),
      makeDivergentGame({ gameId: "def", gameName: "Bravo" }),
    ];
    const html = renderToString(<Divergence games={games} />);
    const links = extractLinks(html);

    expect(links).toContainEqual({ href: "/games/abc", text: "Alpha" });
    expect(links).toContainEqual({ href: "/games/def", text: "Bravo" });
  });

  test("links have game-link class", () => {
    const html = renderToString(<Divergence games={[makeDivergentGame({ gameId: "x" })]} />);
    expect(html).toContain('class="game-link"');
  });

  test("empty games array renders nothing", () => {
    const html = renderToString(<Divergence games={[]} />);
    expect(html).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Outliers links (REQ-GLINK-2)
// ---------------------------------------------------------------------------

describe("Outliers game links", () => {
  test("each outlier name links to /games/{gameId}", () => {
    const outliers = [
      makeOutlier({ gameId: "o1", gameName: "Odd One" }),
      makeOutlier({ gameId: "o2", gameName: "Strange Pick" }),
    ];
    const html = renderToString(<Outliers outliers={outliers} />);
    const links = extractLinks(html);

    expect(links).toContainEqual({ href: "/games/o1", text: "Odd One" });
    expect(links).toContainEqual({ href: "/games/o2", text: "Strange Pick" });
  });

  test("links have game-link class", () => {
    const html = renderToString(<Outliers outliers={[makeOutlier({ gameId: "x" })]} />);
    expect(html).toContain('class="game-link"');
  });

  test("empty outliers array renders nothing", () => {
    const html = renderToString(<Outliers outliers={[]} />);
    expect(html).toBe("");
  });
});

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
              bggOriginal: null,
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
              bggOriginal: null,
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
