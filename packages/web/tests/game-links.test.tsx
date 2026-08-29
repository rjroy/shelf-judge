import { describe, test, expect } from "bun:test";
import { renderToString } from "react-dom/server";
import type {
  ReferenceGame,
  PredictionConfidence,
  FitnessBreakdownEntry,
} from "@shelf-judge/shared";
import { DeletionHistoryConflict, OwnershipMutationNotice } from "@/components/game-actions";

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

describe("Collection contextual game links", () => {
  test("parses only singular return transport and always mounts CollectionTable", async () => {
    const source = await Bun.file("packages/web/app/collection/page.tsx").text();
    expect(source).toContain('typeof value === "string" ? value : undefined');
    expect(source).toContain("params.collectionContext !== undefined");
    expect(source).toContain("params.collectionOrigin !== undefined");
    expect(source).toContain("collectionReturnAttempt={collectionReturnAttempt}");
    expect(source).not.toContain("if (games.length === 0 && previouslyOwnedCount === 0)");
  });

  test("uses a semantic stable Collection heading and neutral restore state", async () => {
    const page = await Bun.file("packages/web/app/collection/page.tsx").text();
    const table = await Bun.file("packages/web/components/collection-table.tsx").text();
    expect(page).toContain('<h1 id="collection-heading" className="topbar-title" tabIndex={-1}>');
    expect(table).toContain("Restoring collection...");
    expect(table).toContain('role="status"');
  });

  test("passes complete hrefs into rows and keeps grouped rows explicitly plain", async () => {
    const source = await Bun.file("packages/web/components/collection-table.tsx").text();
    expect(source).toContain(
      'onClick={href.includes("collectionContext=") ? preserveCollectionScrollPosition : undefined}',
    );
    expect(source).toContain("Reflect.deleteProperty(nextState, COLLECTION_SCROLL_HISTORY_KEY)");
    expect(source).toContain('window.history.replaceState(nextState, "")');
    expect(source).toContain("href={buildCollectionGameHref(gws.game.id, null)}");
    expect(source).toContain("href={buildCollectionGameHref(gws.game.id, navigationContextKey)}");
    expect(source).not.toContain("<Link href={`/games/${game.id}`}");
  });

  test("assigns stable focus IDs only at flat row call sites", async () => {
    const source = await Bun.file("packages/web/components/collection-table.tsx").text();
    expect(source.match(/focusId=\{collectionRowId\(gws\.game\.id\)\}/g)).toHaveLength(2);
    const groupedCall = source.match(
      /nicheHighlight=\{nicheEntry\?\.isChampion[\s\S]*?href=\{buildCollectionGameHref\(gws\.game\.id, null\)\}[\s\S]*?\/>/,
    )?.[0];
    expect(groupedCall).toBeDefined();
    expect(groupedCall).not.toContain("focusId=");
  });
});

describe("Game detail contextual navigation boundary", () => {
  test("parses only singular detail transport after the existing data error path", async () => {
    const source = await Bun.file("packages/web/app/games/[id]/page.tsx").text();
    expect(source).toContain('typeof detailParams.collectionContext === "string"');
    expect(source).toContain('typeof detailParams.collectionOrigin === "string"');
    expect(source.indexOf("catch (err)")).toBeLessThan(source.indexOf("await searchParams"));
    expect(source).toContain("<GameDetailCollectionNavigation");
    expect(source).toContain("<GameActions");
  });

  test("keeps unrelated detail links context-free and delegates target availability", async () => {
    const source = await Bun.file("packages/web/app/games/[id]/page.tsx").text();
    for (const href of [
      "href={`/games/${c.opponentGameId}`}",
      "href={`/games/${niche.champion.gameId}`}",
      "href={`/games/${neighbor.gameId}`}",
      "href={`/games/${n.gameId}`}",
    ]) {
      expect(source).toContain(href);
    }

    const navigation = await Bun.file(
      "packages/web/components/game-detail-collection-navigation.tsx",
    ).text();
    expect(navigation).toContain("buildGameHref(entry.id, contextKey, originId)");
    expect(navigation).not.toContain("getGame(");
    expect(navigation).not.toContain("exists");
  });
});

describe("game detail Step 11 surfaces", () => {
  test("keeps purchase utilization and redundancy while profile-specific cards remain absent", async () => {
    const source = await Bun.file("packages/web/app/games/[id]/page.tsx").text();
    expect(source).toContain("PurchaseUtilizationPanel");
    expect(source).toContain("RedundancyPanel");
    expect(source).toContain("IntentionControls");
    for (const removed of ["divergence", "outlier", "suggestion"]) {
      expect(source.toLowerCase()).not.toContain(removed);
    }
  });

  test("uses native named controls and explicit ownership/deletion outcome language", async () => {
    const controls = await Bun.file("packages/web/components/intention-controls.tsx").text();
    const actions = await Bun.file("packages/web/components/game-actions.tsx").text();
    expect(controls).toContain('name="playCount"');
    expect(controls).toContain('type="number"');
    expect(controls).toContain('type="submit"');
    expect(controls).toContain('aria-live="polite"');
    expect(actions).toContain("was retired in the same update");
    expect(actions).toContain("Previously Owned");
    expect(actions).toContain("does not offer deletion of intention history");

    const ownership = renderToString(
      <OwnershipMutationNotice
        ownership="previously-owned"
        linkedIntentionTransition={{
          intentionId: "intention-1",
          gameId: "game-1",
          kind: "first-play",
          baseline: {
            playCount: 0,
            evidenceSource: "manual",
            observedAt: "2026-08-28T09:00:00.000Z",
          },
          createdAt: "2026-08-28T10:00:00.000Z",
          version: 2,
          resolution: {
            outcome: "retired",
            source: "owner-retired",
            resolvedAt: "2026-08-28T11:00:00.000Z",
          },
        }}
      />,
    );
    expect(ownership).toContain("was retired in the same update");

    const conflict = renderToString(<DeletionHistoryConflict intentionIds={["intention-1"]} />);
    expect(conflict).toContain("Retire any active intention");
    expect(conflict).toContain("Previously Owned");
    expect(conflict).toContain("does not offer deletion of intention history");
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
