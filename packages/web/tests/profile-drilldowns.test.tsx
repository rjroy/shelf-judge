import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  canonicalEntityExplorerUrl,
  EntityDrilldownContent,
  EntityDrilldownPage,
  entitiesInSuppliedOrder,
  entityExplorerUrl,
  filterEntityExplorerResults,
  parseEntityExplorerState,
  type EntityExplorerState,
} from "@/app/profile/entities/page";
import { AxisDiagnosticsContent } from "@/app/profile/axes/page";
import { ClassEvidence } from "@/components/profile/entity-evidence";
import {
  mechanicClassFixture,
  usefulProfileFixture,
} from "../../shared/tests/fixtures/useful-profile";

class PageRedirect extends Error {
  constructor(readonly url: string) {
    super(`Redirect to ${url}`);
  }
}

describe("entity drilldown", () => {
  const defaultState: EntityExplorerState = {
    entityClass: "mechanic",
    entityId: null,
    ordering: "bestFit",
    support: "all",
    query: "",
  };

  test("parses complete URL state and falls back for invalid or repeated values", () => {
    expect(
      parseEntityExplorerState({
        class: "artist",
        entity: "102",
        order: "support",
        support: "limited",
        q: "  Alpha  ",
      }),
    ).toEqual({
      entityClass: "artist",
      entityId: 102,
      ordering: "support",
      support: "limited",
      query: "Alpha",
    });
    expect(
      parseEntityExplorerState({
        class: ["mechanic", "artist"],
        entity: "not-an-id",
        order: "newest",
        support: "unknown",
      }),
    ).toEqual(defaultState);
  });

  test("builds canonical shareable URLs", () => {
    expect(entityExplorerUrl(defaultState)).toBe("/profile/entities?class=mechanic");
    expect(
      entityExplorerUrl(defaultState, {
        entityId: 101,
        ordering: "name",
        support: "supported",
        query: "worker placement",
      }),
    ).toBe(
      "/profile/entities?class=mechanic&entity=101&order=name&support=supported&q=worker+placement",
    );
    expect(
      entityExplorerUrl(defaultState, {
        entityId: 101,
        ordering: "bestFit",
        support: "limited",
        query: "Alpha",
      }),
    ).toBe("/profile/entities?class=mechanic&entity=101&support=limited&q=Alpha");
  });

  test.each(["rating", "bestFit", ""])(
    "canonicalizes explicit default order %p by removing only order",
    (order) => {
      const params = {
        class: "artist",
        entity: "102",
        order,
        support: "limited",
        q: "Alpha Beta",
        source: "saved-view",
        tag: ["one", "two"],
      };
      const canonical = canonicalEntityExplorerUrl(params);

      expect(canonical).toBe(
        "/profile/entities?class=artist&entity=102&support=limited&q=Alpha+Beta&source=saved-view&tag=one&tag=two",
      );
      if (canonical === null) throw new Error("Expected an explicit default order to canonicalize");
      const reloaded = new URL(canonical, "http://shelf-judge.test");
      expect(reloaded.searchParams.getAll("tag")).toEqual(["one", "two"]);
      const reloadedParams = Object.fromEntries(reloaded.searchParams.entries());
      expect(canonicalEntityExplorerUrl(reloadedParams)).toBeNull();
      expect(parseEntityExplorerState(reloadedParams)).toEqual({
        entityClass: "artist",
        entityId: 102,
        ordering: "bestFit",
        support: "limited",
        query: "Alpha Beta",
      });
    },
  );

  test.each(["support", "name"])("renders nondefault order %p directly", (order) => {
    expect(canonicalEntityExplorerUrl({ class: "mechanic", order })).toBeNull();
  });

  test("does not redirect an omitted default order", () => {
    expect(canonicalEntityExplorerUrl({ class: "mechanic", q: "Alpha" })).toBeNull();
  });

  test.each(["rating", "bestFit", ""])(
    "redirects explicit default order %p once before loading the profile",
    async (order) => {
      const loadProfile = mock(() => Promise.resolve(usefulProfileFixture));
      const redirectTo = mock((url: string): never => {
        throw new PageRedirect(url);
      });
      const params = {
        class: "artist",
        entity: "102",
        order,
        support: "limited",
        q: "Alpha Beta",
        source: "saved-view",
        tag: ["one", "two"],
      };

      try {
        await EntityDrilldownPage(
          { searchParams: Promise.resolve(params) },
          { loadProfile, redirectTo },
        );
        throw new Error("Expected page redirect");
      } catch (error) {
        if (!(error instanceof PageRedirect)) throw error;
        expect(error.url).toBe(
          "/profile/entities?class=artist&entity=102&support=limited&q=Alpha+Beta&source=saved-view&tag=one&tag=two",
        );
      }
      expect(redirectTo).toHaveBeenCalledTimes(1);
      expect(loadProfile).not.toHaveBeenCalled();
    },
  );

  test.each([undefined, "support", "name"])(
    "renders order %p directly through the page boundary",
    async (order) => {
      const loadProfile = mock(() => Promise.resolve(usefulProfileFixture));
      const redirectTo = mock((url: string): never => {
        throw new PageRedirect(url);
      });
      const page = await EntityDrilldownPage(
        {
          searchParams: Promise.resolve({
            class: "mechanic",
            ...(order === undefined ? {} : { order }),
          }),
        },
        { loadProfile, redirectTo },
      );

      expect(renderToStaticMarkup(page)).toContain("Collection Entity Evidence");
      expect(redirectTo).not.toHaveBeenCalled();
      expect(loadProfile).toHaveBeenCalledTimes(1);
    },
  );

  test("native bestFit GET submission converges, reloads, and keeps canonical selection state", async () => {
    const state = {
      ...defaultState,
      entityId: 101,
      support: "limited" as const,
      query: "Alpha",
    };
    const formHtml = renderToStaticMarkup(
      <EntityDrilldownContent profile={usefulProfileFixture} state={state} />,
    );
    const orderForm = formHtml
      .match(/<form\b[^>]*>[\s\S]*?<\/form>/g)
      ?.find((form) => form.includes('id="entity-order"'));
    expect(orderForm).toMatch(/^<form\b[^>]*\bmethod="get"[^>]*>/);
    expect(orderForm).toContain('name="class" value="mechanic"');
    expect(orderForm).toContain('name="entity" value="101"');
    expect(orderForm).toContain('name="support" value="limited"');
    expect(orderForm).toContain('name="q" value="Alpha"');
    expect(orderForm).toContain('<select id="entity-order" name="order"');
    expect(orderForm).toContain('<option value="bestFit" selected="">Adjusted fit</option>');

    const submittedParams = {
      class: "mechanic",
      entity: "101",
      support: "limited",
      q: "Alpha",
      order: "bestFit",
    };
    const initialLoad = mock(() => Promise.resolve(usefulProfileFixture));
    const redirectTo = mock((url: string): never => {
      throw new PageRedirect(url);
    });
    let canonicalUrl: string | null = null;
    try {
      await EntityDrilldownPage(
        { searchParams: Promise.resolve(submittedParams) },
        { loadProfile: initialLoad, redirectTo },
      );
    } catch (error) {
      if (!(error instanceof PageRedirect)) throw error;
      canonicalUrl = error.url;
    }
    expect(canonicalUrl).toBe(
      "/profile/entities?class=mechanic&entity=101&support=limited&q=Alpha",
    );
    expect(initialLoad).not.toHaveBeenCalled();

    if (canonicalUrl === null) throw new Error("Expected native GET submission to redirect");
    const canonicalParams = Object.fromEntries(
      new URL(canonicalUrl, "http://shelf-judge.test").searchParams.entries(),
    );
    const reloadProfile = mock(() => Promise.resolve(usefulProfileFixture));
    const reloaded = await EntityDrilldownPage(
      { searchParams: Promise.resolve(canonicalParams) },
      { loadProfile: reloadProfile, redirectTo },
    );
    const reloadHtml = renderToStaticMarkup(reloaded);
    expect(redirectTo).toHaveBeenCalledTimes(1);
    expect(reloadProfile).toHaveBeenCalledTimes(1);
    expect(reloadHtml).toContain(
      'href="/profile/entities?class=mechanic&amp;entity=102&amp;support=limited&amp;q=Alpha"',
    );
    expect(reloadHtml).not.toContain("order=bestFit");
  });

  test.each([
    ["bestFit" as const, [102, 101]],
    ["support" as const, [101, 102]],
    ["name" as const, [102, 101]],
  ])("selects only the daemon-supplied %s ID ordering", (ordering, ids) => {
    expect(
      entitiesInSuppliedOrder(mechanicClassFixture, ordering).map(({ entityId }) => entityId),
    ).toEqual(ids);
    const html = renderToStaticMarkup(
      <EntityDrilldownContent
        profile={usefulProfileFixture}
        state={{ ...defaultState, ordering }}
      />,
    );
    const positions = ids.map((id) => html.indexOf(`id="entity-${id}"`));
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(html.match(/class="entity-evidence"/g)).toHaveLength(1);
  });

  test("filters by daemon support and matches entity or eligible supporting-game names without reordering", () => {
    expect(
      filterEntityExplorerResults(mechanicClassFixture, {
        ...defaultState,
        support: "supported",
      }).map(({ entity }) => entity.entityId),
    ).toEqual([101]);
    const twoSupported = structuredClone(mechanicClassFixture);
    twoSupported.entities[1].support = "supported";
    expect(
      filterEntityExplorerResults(twoSupported, {
        ...defaultState,
        support: "supported",
      }).map(({ entity }) => entity.entityId),
    ).toEqual([102, 101]);
    expect(
      filterEntityExplorerResults(mechanicClassFixture, {
        ...defaultState,
        query: "alpha",
      }).map(({ entity, matchedGameName }) => [entity.entityId, matchedGameName]),
    ).toEqual([
      [102, "Alpha"],
      [101, "Alpha"],
    ]);
    expect(
      filterEntityExplorerResults(mechanicClassFixture, {
        ...defaultState,
        query: "worker",
      })[0]?.matchedGameName,
    ).toBeNull();

    const diagnosticResult = structuredClone(mechanicClassFixture);
    const overviewBefore = [...diagnosticResult.overviewEntityIds];
    expect(
      filterEntityExplorerResults(diagnosticResult, {
        ...defaultState,
        ordering: "support",
        query: "alpha",
      }).map(({ entity }) => entity.entityId),
    ).toEqual([101, 102]);
    expect(diagnosticResult.overviewEntityIds).toEqual(overviewBefore);
  });

  test("keeps exact supplied order when adjusted values display at the same precision", () => {
    const mechanic = structuredClone(mechanicClassFixture);
    mechanic.entities[0].adjustedMeanCurrentFitness = 5.54;
    mechanic.entities[1].adjustedMeanCurrentFitness = 5.51;
    const profile = structuredClone(usefulProfileFixture);
    profile.identity.classes.mechanic = mechanic;

    const html = renderToStaticMarkup(
      <EntityDrilldownContent profile={profile} state={defaultState} />,
    );
    expect(html.indexOf('id="entity-102"')).toBeLessThan(html.indexOf('id="entity-101"'));
    expect(html.match(/<span class="sr-only">Adjusted fit <\/span>5\.5/g)).toHaveLength(2);
    expect(html).toContain("exact unrounded values when displayed values match");
  });

  test("renders compact results, one selected dossier, and progressively disclosed class evidence", () => {
    const mechanic = {
      ...mechanicClassFixture,
      refreshWarnings: [
        {
          gameId: "game-2",
          gameName: "Beta",
          attemptedAt: "2026-08-28T10:00:00.000Z",
          message: "BGG unavailable",
        },
      ],
    };
    const profile = {
      ...usefulProfileFixture,
      identity: {
        ...usefulProfileFixture.identity,
        classes: { ...usefulProfileFixture.identity.classes, mechanic },
      },
    };
    const html = renderToStaticMarkup(
      <EntityDrilldownContent profile={profile} state={defaultState} />,
    );

    for (const text of [
      "Worker Placement",
      "Solo",
      "Limited evidence · 1 game",
      "Adjusted fit",
      "Raw mean current fitness",
      "Class comparator mean",
      "Population standard deviation",
      "Difference from collection",
      "+3.3",
      "Range",
      "Supporting games",
      "Eligible collection comparator",
      "Missing or invalid fitness",
      "Refresh warnings (1)",
      "BGG unavailable",
      "Vetoed; displayed as 0",
    ])
      expect(html).toContain(text);
    for (const id of ["game-1", "game-2", "game-3", "game-4"])
      expect(html).toContain(`href="/games/${id}"`);
    expect(html).toContain('aria-labelledby="mechanic-102-heading"');
    expect(html).toContain('aria-label="mechanic class evidence"');
    expect(html.match(/class="entity-evidence"/g)).toHaveLength(1);
    expect(html).toContain("Review class evidence");
    expect(html).toContain("Eligible games (3)");
    expect(html).toContain("configured support count of 3 associated games");
    expect(html).toContain("exact unrounded values when displayed values match");
    expect(html).toContain("Collection comparator 4.7");
    expect(html).toContain("Associated game count (diagnostic)");
    expect(html).toContain('<option value="bestFit" selected="">Adjusted fit</option>');
    expect(html).toContain('name="order"');
    expect(html).not.toContain('type="hidden" name="order"');
    expect(html).toContain('href="/profile/entities?class=mechanic&amp;entity=102"');
  });

  test("keeps a valid explicit selection outside filters and treats a cross-class ID as absent", () => {
    const outside = renderToStaticMarkup(
      <EntityDrilldownContent
        profile={usefulProfileFixture}
        state={{ ...defaultState, entityId: 101, support: "limited" }}
      />,
    );
    expect(outside).toContain("Selected entity is outside the current results");
    expect(outside).toContain("Worker Placement");
    expect(outside).toContain("Clear filters and return to Mechanics results");
    expect(outside).toContain("has-explicit-selection");

    const absent = renderToStaticMarkup(
      <EntityDrilldownContent
        profile={usefulProfileFixture}
        state={{ ...defaultState, entityId: 999 }}
      />,
    );
    expect(absent).not.toContain("has-explicit-selection");
    expect(absent).toContain('aria-labelledby="mechanic-102-heading"');
  });

  test("distinguishes excluded-game search, filtered empty, and intrinsic class states", () => {
    const excluded = renderToStaticMarkup(
      <EntityDrilldownContent
        profile={usefulProfileFixture}
        state={{ ...defaultState, query: "Heat" }}
      />,
    );
    expect(excluded).toContain("That game is excluded from this class&#x27;s entity evidence");
    expect(excluded).toContain("Clear search and filters");

    const intrinsic = renderToStaticMarkup(
      <EntityDrilldownContent
        profile={usefulProfileFixture}
        state={{ ...defaultState, entityClass: "designer", query: "Heat" }}
      />,
    );
    expect(intrinsic).toContain('data-result="evaluated-empty"');
    expect(intrinsic).toContain("Complete metadata contains no associations in this class.");
    expect(intrinsic).not.toContain("Clear search and filters");
  });

  test("does not render an action for an unrefreshable exclusion with no destination", () => {
    const result = {
      ...mechanicClassFixture,
      exclusions: [
        {
          gameId: "game-4",
          gameName: "Manual game",
          reason: "unrefreshable-metadata" as const,
          hasEntityAssociation: false,
          correctionDestination: null,
        },
      ],
    };
    const profile = {
      ...usefulProfileFixture,
      identity: {
        ...usefulProfileFixture.identity,
        classes: { ...usefulProfileFixture.identity.classes, mechanic: result },
      },
    };
    const html = renderToStaticMarkup(
      <EntityDrilldownContent profile={profile} state={defaultState} />,
    );
    const exclusion = html.match(/Manual game[\s\S]*?<\/li>/)?.[0];
    expect(exclusion).toContain("Metadata cannot be refreshed");
    expect(exclusion).not.toContain("Review available correction");
  });

  test("renders every exclusion reason and only daemon-authorized correction links", () => {
    const result = {
      ...mechanicClassFixture,
      exclusions: [
        {
          gameId: "predicted",
          gameName: "Predicted",
          reason: "predicted-fitness" as const,
          hasEntityAssociation: true,
          correctionDestination: null,
        },
        {
          gameId: "rating",
          gameName: "Needs rating",
          reason: "missing-or-invalid-fitness" as const,
          hasEntityAssociation: true,
          correctionDestination: { operationId: "shelf.game.rating.set" as const },
        },
        {
          gameId: "refresh",
          gameName: "Needs refresh",
          reason: "refresh-needed-metadata" as const,
          hasEntityAssociation: false,
          correctionDestination: { operationId: "shelf.game.bgg.refresh" as const },
        },
        {
          gameId: "manual",
          gameName: "Manual",
          reason: "unrefreshable-metadata" as const,
          hasEntityAssociation: false,
          correctionDestination: null,
        },
      ],
    };
    const html = renderToStaticMarkup(<ClassEvidence result={result} />);

    for (const label of [
      "Predicted fitness",
      "Missing or invalid fitness",
      "Metadata refresh needed",
      "Metadata cannot be refreshed",
    ])
      expect(html).toContain(label);
    expect(html.match(/Review available correction/g)).toHaveLength(2);
  });
});

describe("axis diagnostics", () => {
  test("renders supplied distributions beneath identity as diagnostics, not claims or attention", () => {
    const identity = {
      ...usefulProfileFixture.identity,
      axisDistributions: [
        {
          axisId: "fun",
          axisName: "Fun",
          mean: 7,
          median: 8,
          standardDeviation: 1.2,
          range: { min: 5, max: 9 },
          ratedGameCount: 3,
          histogram: [0, 0, 0, 0, 1, 0, 0, 1, 1, 0],
        },
      ],
    };
    const html = renderToStaticMarkup(<AxisDiagnosticsContent identity={identity} />);

    expect(html).toContain("Axis Diagnostics");
    expect(html).toContain("Diagnostic distribution, not an identity claim");
    expect(html).toContain('aria-label="Effective preference rating counts from 1 to 10"');
    expect(html).toContain('aria-label="Rating 5: 1 game"');
    expect(html).toContain('class="axis-histogram-bar" style="height:100%"');
    expect(html).toContain('class="axis-histogram-bar zero" style="height:2px"');
    expect(html).toContain("Effective preference rating, 1-10");
    expect(html).not.toContain("deserves my attention");
  });
});
