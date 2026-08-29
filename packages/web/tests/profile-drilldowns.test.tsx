import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EntityDrilldownContent,
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

describe("entity drilldown", () => {
  const defaultState: EntityExplorerState = {
    entityClass: "mechanic",
    entityId: null,
    ordering: "rating",
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
  });

  test.each([
    ["rating" as const, [102, 101]],
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
      "Population standard deviation",
      "Difference from collection",
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
