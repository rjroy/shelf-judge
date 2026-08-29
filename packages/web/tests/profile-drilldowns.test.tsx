import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EntityDrilldownContent, entitiesInSuppliedOrder } from "@/app/profile/entities/page";
import { AxisDiagnosticsContent } from "@/app/profile/axes/page";
import { ClassEvidence } from "@/components/profile/entity-evidence";
import {
  mechanicClassFixture,
  usefulProfileFixture,
} from "../../shared/tests/fixtures/useful-profile";

describe("entity drilldown", () => {
  test.each([
    ["rating" as const, [102, 101]],
    ["support" as const, [101, 102]],
    ["name" as const, [102, 101]],
  ])("selects only the daemon-supplied %s ID ordering", (ordering, ids) => {
    expect(
      entitiesInSuppliedOrder(mechanicClassFixture, ordering).map(({ entityId }) => entityId),
    ).toEqual(ids);
    const html = renderToStaticMarkup(
      <EntityDrilldownContent profile={usefulProfileFixture} ordering={ordering} />,
    );
    const positions = ids.map((id) => html.indexOf(`id="mechanic-${id}-heading"`));
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(html).toContain(`data-ordering="${ordering}"`);
  });

  test("renders every entity, sparse labels, aggregate and comparator evidence, exclusions, warnings, and valid links", () => {
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
      <EntityDrilldownContent profile={profile} ordering="rating" />,
    );

    for (const text of [
      "Worker Placement",
      "Solo",
      "Limited evidence: 1 game",
      "Population standard deviation",
      "Difference from collection",
      "Supporting games",
      "Eligible collection comparator",
      "Missing or invalid fitness",
      "Refresh warnings",
      "BGG unavailable",
      "Veto applied; displayed fitness is 0.",
    ])
      expect(html).toContain(text);
    for (const id of ["game-1", "game-2", "game-3", "game-4"])
      expect(html).toContain(`href="/games/${id}"`);
    expect(html).toContain('aria-labelledby="mechanic-102-heading"');
    expect(html).toContain('aria-label="mechanic class evidence"');
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
      <EntityDrilldownContent profile={profile} ordering="rating" />,
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
