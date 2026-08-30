import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CollectionProfileEntityClass,
  CollectionProfileEntityClassResult,
  CollectionProfileEntityPolicy,
} from "@shelf-judge/shared";
import { DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY } from "@shelf-judge/shared";
import { loadProfileOverview, ProfileOverviewContent, type ProfileOverviewState } from "@/app/page";
import { IdentitySection } from "@/components/profile/identity-section";
import { AttentionSection } from "@/components/profile/attention-section";
import {
  canonicalUsefulProfileFixtures,
  emptyUsefulProfileFixture,
  mechanicClassFixture,
  usefulProfileFixture,
} from "../../shared/tests/fixtures/useful-profile";

function emptyClass(entityClass: CollectionProfileEntityClass): CollectionProfileEntityClassResult {
  return {
    entityClass,
    result: "not-evaluated",
    metadataReadiness: {
      state: "refresh-needed",
      ownedGameCount: 0,
      completeGameCount: 0,
      refreshNeededGameCount: 0,
      unrefreshableGameCount: 0,
    },
    associatedGameCount: 0,
    comparator: { gameCount: 0, meanCurrentFitness: null, games: [] },
    exclusions: [],
    refreshWarnings: [],
    entities: [],
    overviewEntityIds: [],
    orderings: { bestFit: [], support: [], name: [] },
  };
}

function renderClass(
  result: CollectionProfileEntityClassResult,
  entityPolicy: CollectionProfileEntityPolicy = DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
): string {
  const classes = {
    mechanic: emptyClass("mechanic"),
    designer: emptyClass("designer"),
    artist: emptyClass("artist"),
    [result.entityClass]: result,
  };
  return renderToStaticMarkup(
    <IdentitySection
      identity={{ collectionState: "populated", classes, axisDistributions: [] }}
      entityPolicy={entityPolicy}
    />,
  );
}

describe("profile overview consumer", () => {
  test.each(canonicalUsefulProfileFixtures)(
    "loads and renders the canonical %s state without projection",
    async (_label, fixture) => {
      const state = await loadProfileOverview(() => Promise.resolve(structuredClone(fixture)));
      expect(state).toEqual({ status: "loaded", profile: fixture });
      const html = renderToStaticMarkup(<ProfileOverviewContent state={state} />);
      expect(html).toContain("Collection Profile");
      expect(html).toContain(
        fixture.status === "unavailable"
          ? 'data-profile-state="unavailable"'
          : fixture.identity.collectionState === "empty"
            ? 'data-profile-state="empty-collection"'
            : "What does my collection reveal about me?",
      );
    },
  );

  test("uses one page title followed by exactly the two approved headline questions", () => {
    const html = renderToStaticMarkup(
      <ProfileOverviewContent state={{ status: "loaded", profile: usefulProfileFixture }} />,
    );

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.match(/<h2/g)).toHaveLength(2);
    expect(html).toContain("<h1");
    expect(html).toContain("What does my collection reveal about me?");
    expect(html).toContain("What deserves my attention or a decision now?");
    expect(html.indexOf("<h1")).toBeLessThan(html.indexOf("<h2"));
  });

  test("keeps entity classes separate and renders only supplied overview IDs", () => {
    const html = renderToStaticMarkup(
      <ProfileOverviewContent state={{ status: "loaded", profile: usefulProfileFixture }} />,
    );

    for (const label of ["Mechanics", "Designers", "Artists"])
      expect(html).toContain(`>${label}</h3>`);
    expect(html).toContain("Worker Placement");
    expect(html).not.toContain(">Solo<");
    expect(html).toContain('href="/profile/entities?class=mechanic&amp;entity=101"');
    for (const entityClass of ["mechanic", "designer", "artist"])
      expect(html).toContain(`href="/profile/entities?class=${entityClass}"`);
    expect(html).toContain('href="/profile/axes"');
  });

  test("uses supplied overview membership and order when raw mean and count suggest otherwise", () => {
    const mechanic = structuredClone(mechanicClassFixture);
    const rawMeanLeader = {
      ...structuredClone(mechanic.entities[0]),
      entityId: 301,
      name: "Raw Mean Leader",
      associatedGameCount: 20,
      meanCurrentFitness: 9.8,
      adjustedMeanCurrentFitness: 9.4,
    };
    const daemonFirst = {
      ...structuredClone(mechanic.entities[0]),
      entityId: 302,
      name: "Daemon First",
      associatedGameCount: 3,
      meanCurrentFitness: 6.1,
      adjustedMeanCurrentFitness: 5.9,
    };
    mechanic.entities = [rawMeanLeader, mechanic.entities[0], daemonFirst];
    mechanic.overviewEntityIds = [302, 301];

    const html = renderClass(mechanic);
    const cards = html.match(/<article class="profile-entity-summary"[\s\S]*?<\/article>/g) ?? [];

    expect(html.indexOf("Daemon First")).toBeLessThan(html.indexOf("Raw Mean Leader"));
    expect(html).not.toContain(">Worker Placement<");
    expect(cards).toHaveLength(2);
    for (const [index, evidence] of [
      {
        name: "Daemon First",
        adjustedFit: "5.9",
        rawMean: "6.1",
        comparator: "4.7",
        associatedGames: "3",
      },
      {
        name: "Raw Mean Leader",
        adjustedFit: "9.4",
        rawMean: "9.8",
        comparator: "4.7",
        associatedGames: "20",
      },
    ].entries()) {
      expect(cards[index]).toContain(`<strong>${evidence.name}</strong>`);
      expect(cards[index]).toContain(`<strong>Adjusted fit</strong> ${evidence.adjustedFit}`);
      expect(cards[index]).toContain("<dl");
      expect(cards[index]).toContain(`<dt>Raw mean</dt><dd>${evidence.rawMean}</dd>`);
      expect(cards[index]).toContain(`<dt>Class comparator</dt><dd>${evidence.comparator}</dd>`);
      expect(cards[index]).toContain(
        `<dt>Associated games</dt><dd>${evidence.associatedGames}</dd>`,
      );
    }
  });

  test("explains the supplied class minimum as support threshold and comparator weight", () => {
    const policy = {
      ...DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
      mechanic: { overviewLimit: 3, minimumSupportedGames: 4 },
    };

    const html = renderClass(mechanicClassFixture, policy);

    expect(html).toContain(
      "The class minimum of 4 associated games is both the support threshold and the comparator weight used for adjusted fit.",
    );
    for (const forbidden of ["favorite", "preferred", "responsible", "confidence"])
      expect(html.toLowerCase()).not.toContain(forbidden);
    expect(html).not.toMatch(/(?:representation|share).{0,80}appreciation/i);
    expect(html).not.toMatch(/appreciation.{0,80}(?:representation|share)/i);
    expect(html).not.toMatch(
      /preference|responsibility|creator|causal|significance|probability|learned/i,
    );
  });

  test("renders every overview entity supplied for a class", () => {
    const mechanic = structuredClone(mechanicClassFixture);
    const additionalEntities = ["Deck Building", "Drafting", "Trading"].map((name, index) => ({
      ...structuredClone(mechanic.entities[0]),
      entityId: 201 + index,
      name,
    }));
    mechanic.entities.push(...additionalEntities);
    mechanic.overviewEntityIds = [101, ...additionalEntities.map(({ entityId }) => entityId)];

    const html = renderClass(mechanic);

    for (const name of ["Worker Placement", "Deck Building", "Drafting", "Trading"])
      expect(html).toContain(`>${name}<`);
  });

  test("distinguishes daemon and transport failures from an empty collection with retry", async () => {
    const transport = await loadProfileOverview(() => Promise.reject(new Error("Socket offline")));
    const transportHtml = renderToStaticMarkup(<ProfileOverviewContent state={transport} />);
    const daemonState: ProfileOverviewState = {
      status: "loaded",
      profile: {
        status: "unavailable",
        error: { kind: "validation", message: "Invalid cache" },
        retryDestination: { operationId: "shelf.profile.get" },
      },
    };
    const daemonHtml = renderToStaticMarkup(<ProfileOverviewContent state={daemonState} />);
    const emptyHtml = renderToStaticMarkup(
      <ProfileOverviewContent state={{ status: "loaded", profile: emptyUsefulProfileFixture }} />,
    );

    for (const html of [transportHtml, daemonHtml]) {
      expect(html).toContain('data-profile-state="unavailable"');
      expect(html.match(/<h2/g)).toHaveLength(2);
      expect(html).toContain('<form action="/" method="get">');
      expect(html).toContain(
        '<button class="btn btn-primary" type="submit">Retry profile</button>',
      );
      expect(html).not.toContain("Nothing needs attention right now");
    }
    expect(emptyHtml).toContain('data-profile-state="empty-collection"');
    expect(emptyHtml).toContain('data-attention-state="empty-collection"');
    expect(emptyHtml).not.toContain('data-profile-state="unavailable"');
  });
});

describe("identity state distinctions", () => {
  test.each([
    [
      "limited",
      {
        ...mechanicClassFixture,
        result: "limited" as const,
        entities: mechanicClassFixture.entities.slice(1),
        overviewEntityIds: [],
      },
    ],
    [
      "no-eligible-ratings",
      {
        ...mechanicClassFixture,
        result: "no-eligible-ratings" as const,
        entities: [],
        overviewEntityIds: [],
      },
    ],
    [
      "evaluated-empty",
      {
        ...mechanicClassFixture,
        result: "evaluated-empty" as const,
        entities: [],
        overviewEntityIds: [],
        associatedGameCount: 0,
      },
    ],
    [
      "not-evaluated",
      {
        ...mechanicClassFixture,
        result: "not-evaluated" as const,
        entities: [],
        overviewEntityIds: [],
        associatedGameCount: 0,
        metadataReadiness: {
          ...mechanicClassFixture.metadataReadiness,
          state: "refresh-needed" as const,
          completeGameCount: 0,
          refreshNeededGameCount: 4,
        },
      },
    ],
  ])("renders %s independently", (state, result) => {
    const html = renderClass(result);
    expect(html).toContain(`data-result="${state}"`);
    if (state === "limited") {
      expect(html).toContain("Associations below the configured class minimum");
      expect(html).not.toContain("One- and two-game associations");
    }
  });

  test("shows partial and refresh-needed readiness, exclusions, and refresh warnings as metadata", () => {
    const partial: CollectionProfileEntityClassResult = {
      ...mechanicClassFixture,
      metadataReadiness: {
        ...mechanicClassFixture.metadataReadiness,
        state: "partial",
        completeGameCount: 3,
        refreshNeededGameCount: 1,
      },
      exclusions: [
        {
          gameId: "game-4",
          gameName: "Heat",
          reason: "refresh-needed-metadata",
          hasEntityAssociation: false,
          correctionDestination: { operationId: "shelf.game.bgg.refresh" },
        },
      ],
      refreshWarnings: [
        {
          gameId: "game-2",
          gameName: "Beta",
          attemptedAt: "2026-08-28T10:00:00.000Z",
          message: "BGG unavailable",
        },
      ],
    };
    const html = renderClass(partial);

    expect(html).toContain('data-readiness="partial"');
    expect(html).toContain("1 exclusions and 1 refresh warnings");
  });
});

describe("attention presentation", () => {
  test("renders the full active contract in neutral language with evidence destinations", () => {
    const html = renderToStaticMarkup(
      <AttentionSection attention={usefulProfileFixture.attention} collectionState="populated" />,
    );

    for (const text of [
      "Do you still intend to play Heat?",
      "You asked Shelf Judge to keep this intention visible.",
      "First play",
      "Created",
      "Baseline",
      "Current evidence",
      "Stable intention ID",
      "intention-1",
      "Decision family",
      "play-intention",
      "Leave it visible or prioritize the play outside Shelf Judge",
      "Mark the intention complete from personal knowledge",
      "Retire it because it is no longer an intention",
      "Correct or refresh the play evidence before deciding",
      "Only an explicit active intention qualifies.",
      "Active, with no recorded resolution.",
      "Create a new explicit intention after resolution.",
    ])
      expect(html).toContain(text);
    expect(html).toContain('aria-labelledby="attention:intention-1-evidence"');
    expect(html.match(/href="\/games\/game-4"/g)).toHaveLength(2);
    expect(html).not.toMatch(/overdue|urgent|late|neglect/i);
  });

  test("keeps an active intention visible with its exact stale warning", () => {
    const item = structuredClone(usefulProfileFixture.attention.items[0]);
    item.currentPlayEvidence = {
      status: "stale",
      playCount: 0,
      source: "bgg-collection",
      observedAt: "2026-08-27T10:00:00.000Z",
      warning: "A newer BGG check did not provide a valid play count.",
    };
    item.evidenceDestination = { gameId: "game-4", operationId: "shelf.game.bgg.refresh" };
    const html = renderToStaticMarkup(
      <AttentionSection
        attention={{ state: "active", items: [item] }}
        collectionState="populated"
      />,
    );

    expect(html).toContain(item.question);
    expect(html).toContain(`Evidence warning: ${item.currentPlayEvidence.warning}`);
    expect(html).toContain("Refresh play evidence");
  });

  test.each([
    ["missing" as const, "Current play evidence is missing." as const],
    ["invalid" as const, "Current play evidence is invalid." as const],
  ])("keeps an active intention visible with its exact %s warning", (status, warning) => {
    const item = structuredClone(usefulProfileFixture.attention.items[0]);
    item.currentPlayEvidence = { status, playCount: null, source: null, observedAt: null, warning };
    const html = renderToStaticMarkup(
      <AttentionSection
        attention={{ state: "active", items: [item] }}
        collectionState="populated"
      />,
    );
    expect(html).toContain(item.question);
    expect(html).toContain(`Evidence warning: ${warning}`);
  });

  test("renders every supplied active intention in supplied order without ranking it", () => {
    const second = structuredClone(usefulProfileFixture.attention.items[0]);
    second.id = "attention:intention-2";
    second.intention.intentionId = "intention-2";
    second.intention.gameId = "game-5";
    second.gameName = "Second Game";
    second.question = "Do you still intend to play Second Game?";
    second.destination.gameId = "game-5";
    second.evidenceDestination.gameId = "game-5";
    const items = [usefulProfileFixture.attention.items[0], second];
    const html = renderToStaticMarkup(
      <AttentionSection attention={{ state: "active", items }} collectionState="populated" />,
    );

    expect(html.indexOf("Heat?")).toBeLessThan(html.indexOf("Second Game?"));
    expect(html.match(/Active play intention/g)).toHaveLength(2);
  });

  test("renders nothing-to-decide only for an available populated profile with no items", () => {
    const html = renderToStaticMarkup(
      <AttentionSection
        attention={{ state: "nothing-to-decide", items: [] }}
        collectionState="populated"
      />,
    );
    expect(html).toContain('data-attention-state="nothing-to-decide"');
    expect(html).toContain("Nothing needs attention right now.");
    expect(html).toContain("Available profile, no active intentions");
  });
});
