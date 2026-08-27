import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  loadProfileOverview,
  ProfileInsightOverview,
  ProfileOverviewContent,
  type ProfileOverviewState,
} from "@/app/page";
import { GameProfileInsightSurface, loadGameProfileInsights } from "@/app/games/[id]/page";
import type { CollectionProfile } from "@shelf-judge/shared";
import {
  emptyInsightProfileFixture,
  trustedInsightProfileFixture,
} from "../../shared/tests/fixtures/trusted-profile";

const emptyCollectionProfile: CollectionProfile = {
  ...emptyInsightProfileFixture,
  divergence: null,
  gameCount: 0,
  ratedGameCount: 0,
};

describe("profile overview consumer", () => {
  test("distinguishes a failed profile request from an empty collection", async () => {
    const unavailable = await loadProfileOverview(() => Promise.reject(new Error("offline")));
    const unavailableHtml = renderToStaticMarkup(<ProfileOverviewContent state={unavailable} />);
    const emptyState: ProfileOverviewState = {
      status: "loaded",
      profile: emptyCollectionProfile,
    };
    const emptyHtml = renderToStaticMarkup(<ProfileOverviewContent state={emptyState} />);

    expect(unavailableHtml).toContain("Profile analysis unavailable");
    expect(unavailableHtml).toContain('data-profile-state="unavailable"');
    expect(unavailableHtml).not.toContain("Add games to your collection");
    expect(emptyHtml).toContain("No profile available");
    expect(emptyHtml).toContain("Add games to your collection");
    expect(emptyHtml).not.toContain("Profile analysis unavailable");
  });

  test("renders retained and abstained families from a controlled profile response", async () => {
    const state = await loadProfileOverview(() =>
      Promise.resolve(structuredClone(trustedInsightProfileFixture)),
    );
    if (state.status !== "loaded") throw new Error("Expected loaded profile fixture");
    const html = renderToStaticMarkup(<ProfileInsightOverview profile={state.profile} />);

    expect(html).toContain("Preference Divergence");
    expect(html).toContain("Collection Outliers");
    expect(html).toContain("Questions from Your Collection");
    expect(html).toContain("Reported pattern");
    expect(html).toContain("Insufficient evidence");
    expect(html).toContain("Suppressed");
    expect(html).toContain("Retired method");
    expect(html).toContain("Question to consider");
    expect(html).toContain('href="/games/game-1"');
  });
});

describe("game detail profile consumer", () => {
  test("renders every family as unavailable after profile load failure", async () => {
    const insights = await loadGameProfileInsights(() => Promise.reject(new Error("invalid")));
    const html = renderToStaticMarkup(
      <GameProfileInsightSurface profileInsights={insights} gameId="game-1" />,
    );

    expect(html.match(/Analysis unavailable/g)).toHaveLength(3);
    expect(html).toContain("Preference Evidence");
    expect(html).toContain("Collection Fit Evidence");
    expect(html).toContain("Questions from Profile Evidence");
    expect(html).not.toContain("Evaluated, nothing notable");
  });

  test("keeps retained evidence and family-level abstentions visible", async () => {
    const insights = await loadGameProfileInsights(() =>
      Promise.resolve(structuredClone(trustedInsightProfileFixture)),
    );
    const html = renderToStaticMarkup(
      <GameProfileInsightSurface profileInsights={insights} gameId="game-3" />,
    );

    expect(html).toContain("Game 3 is compositionally distant");
    expect(html).toContain('href="/games/game-3"');
    expect(html).toContain("At least 60% of owned games need usable factual metadata");
    expect(html).toContain("At least six evaluated games are required");
    expect(html).toContain("Suppressed");
    expect(html).toContain("Retired method");
  });

  test("renders successful empty evaluation separately from unavailable", async () => {
    const insights = await loadGameProfileInsights(() =>
      Promise.resolve(structuredClone(emptyInsightProfileFixture)),
    );
    const html = renderToStaticMarkup(
      <GameProfileInsightSurface profileInsights={insights} gameId="game-1" />,
    );

    expect(html.match(/Evaluated, nothing notable/g)).toHaveLength(3);
    expect(html).not.toContain("Analysis unavailable");
  });
});
