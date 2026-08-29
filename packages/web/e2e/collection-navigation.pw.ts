import {
  expect,
  chromium,
  test as base,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";

const CONTEXT_PREFIX = "shelf-judge-collection-navigation:v1:";
const TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const CONTEXT_KEY = "10000000-0000-4000-8000-000000000001";
const DEFAULT_ORDER = ["game-1", "game-2", "game-3", "game-7", "game-6"];
const LONG_NEXT_NAME =
  "Zephyr Mutable Target With Another Exceptionally Long Name for Full Accessible Labels";

interface NetworkEvidence {
  externalRequests: string[];
}

interface StoredContext {
  version: 1;
  key: string;
  entries: Array<{ id: string; name: string }>;
  collectionScope: { showPreviouslyOwned: boolean; missingDimensionsOnly: boolean };
  projection: {
    sort: { field: string; direction: "asc" | "desc" };
    filters: {
      search: string;
      ratedStatus: "all" | "rated" | "unrated";
      playedStatus: "all" | "played" | "unplayed";
      playerCount: number | null;
    };
    predictionsOn: boolean;
    effectivePredictionsOn: boolean;
    nichesOn: boolean;
  };
  lastAccessedAt: number;
}

const test = base.extend<{ networkEvidence: NetworkEvidence }>({
  networkEvidence: [
    async ({ page }, use) => {
      const evidence: NetworkEvidence = { externalRequests: [] };
      await guardNetwork(page.context(), evidence);
      await use(evidence);
      expect(evidence.externalRequests).toEqual([]);
    },
    { auto: true },
  ],
});

async function guardNetwork(context: BrowserContext, evidence: NetworkEvidence): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "127.0.0.1" &&
      url.hostname !== "localhost"
    ) {
      evidence.externalRequests.push(route.request().url());
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function reset(page: Page): Promise<void> {
  const response = await page.request.post("/api/daemon/test/reset", {
    data: { scenario: "collection" },
  });
  expect(response.ok()).toBe(true);
}

async function setFixtureState(page: Page, state: Record<string, unknown>): Promise<void> {
  const response = await page.request.post("/api/daemon/test/collection-state", { data: state });
  expect(response.ok()).toBe(true);
}

async function clearBrowserState(page: Page): Promise<void> {
  await page.goto("/collection");
  await expect(page.getByPlaceholder("Search games by name...")).toBeVisible();
  await expect
    .poll(() =>
      rows(page)
        .first()
        .getAttribute("href")
        .then((href) => href?.includes("collectionContext=") ?? false),
    )
    .toBe(true);
  await page.evaluate(() => localStorage.clear());
}

function rows(page: Page): Locator {
  return page.locator(".game-row[id]");
}

async function rowIds(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((elements) =>
    elements.map((element) => decodeURIComponent(element.id.replace("collection-game-", ""))),
  );
}

async function waitForHydratedRows(page: Page, expectedIds?: readonly string[]): Promise<void> {
  await expect(page.locator(".collection-restoring")).toHaveCount(0);
  if (expectedIds !== undefined) await expect.poll(() => rowIds(page)).toEqual(expectedIds);
  await expect
    .poll(async () => {
      const hrefs = await rows(page).evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("href") ?? ""),
      );
      return hrefs.length > 0 && hrefs.every((href) => href.includes("collectionContext="));
    })
    .toBe(true);
}

async function contextKeyFromRow(row: Locator): Promise<string> {
  const href = await row.getAttribute("href");
  if (href === null) throw new Error("Expected a contextual row href");
  const key = new URL(href, "http://collection.local").searchParams.get("collectionContext");
  if (key === null) throw new Error("Expected a collection context key");
  return key;
}

async function storedContexts(page: Page): Promise<StoredContext[]> {
  return page.evaluate(
    (prefix) =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .map((key) => JSON.parse(localStorage.getItem(key) ?? "null") as StoredContext),
    CONTEXT_PREFIX,
  );
}

async function selectSort(page: Page, name: string): Promise<void> {
  await page.locator(".sort-select").click();
  await page.locator(".sort-menu").getByRole("button", { name, exact: true }).click();
}

async function configureScopedProjection(page: Page): Promise<void> {
  await page.goto("/collection?ownership=all&dimensions=missing");
  await page.getByPlaceholder("Search games by name...").fill("a");
  await page.getByRole("button", { name: /Filters/ }).click();
  await page
    .locator(".filter-group")
    .filter({ hasText: "Status" })
    .getByRole("button", { name: "Rated", exact: true })
    .click();
  await page
    .locator(".filter-group")
    .filter({ hasText: "Played" })
    .getByRole("button", { name: "Unplayed", exact: true })
    .click();
  await page.locator(".range-input").fill("2");
  await selectSort(page, "Estimated Additional Plays to Value Threshold");
  await page.locator(".sort-dir-btn").click();
  await waitForHydratedRows(page, ["game-2", "game-5", "game-1"]);
}

function seededContext(overrides: Partial<StoredContext> = {}): StoredContext {
  return {
    version: 1,
    key: CONTEXT_KEY,
    entries: [
      { id: "game-1", name: "Atlas Equal" },
      { id: "game-2", name: "Borealis" },
    ],
    collectionScope: { showPreviouslyOwned: false, missingDimensionsOnly: false },
    projection: {
      sort: { field: "name", direction: "asc" },
      filters: { search: "", ratedStatus: "all", playedStatus: "all", playerCount: null },
      predictionsOn: false,
      effectivePredictionsOn: false,
      nichesOn: false,
    },
    lastAccessedAt: Date.now(),
    ...overrides,
  };
}

async function seedContext(page: Page, context: StoredContext): Promise<void> {
  await page.evaluate(
    ({ prefix, value }) => localStorage.setItem(`${prefix}${value.key}`, JSON.stringify(value)),
    { prefix: CONTEXT_PREFIX, value: context },
  );
}

function detailUrl(gameId: string, key = CONTEXT_KEY, origin = "game-1"): string {
  return `/games/${gameId}?collectionContext=${key}&collectionOrigin=${origin}`;
}

async function expectNoStrip(page: Page): Promise<void> {
  await expect(page.locator(".detail-collection-navigation")).toHaveCount(0);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const measurements = await page.evaluate(() => {
    const roots = [
      document.documentElement,
      document.body,
      document.querySelector(".topbar"),
      document.querySelector(".detail-collection-navigation"),
      document.querySelector(".main-scroll"),
    ].filter((element): element is Element => element !== null);
    return roots.map((element) => ({
      name: element === document.documentElement ? "html" : element.className || element.tagName,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
  });
  expect(
    measurements.filter(({ scrollWidth, clientWidth }) => scrollWidth > clientWidth + 1),
  ).toEqual([]);
  expect(
    measurements.filter(({ overflowX }) => overflowX === "hidden" || overflowX === "clip"),
  ).toEqual([]);
}

async function historyScrollMarker(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const state: unknown = window.history.state;
    const marker: unknown =
      typeof state === "object" && state !== null
        ? Reflect.get(state, "shelfJudgeCollectionScrollTop")
        : undefined;
    return marker;
  });
}

test.beforeEach(async ({ page }) => {
  await reset(page);
  await clearBrowserState(page);
});

test.describe("Collection snapshot production and traversal", () => {
  test("snapshot IDs exactly equal flat DOM IDs and links activate atomically once", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const samples: Array<{ ids: string[]; keys: Array<string | null> }> = [];
      const sample = () => {
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".game-row[id]"));
        samples.push({
          ids: links.map((link) => link.id),
          keys: links.map((link) => new URL(link.href).searchParams.get("collectionContext")),
        });
      };
      const observer = new MutationObserver(sample);
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      Object.assign(window, { __collectionSamples: samples, __collectionObserver: observer });
    });
    await page.reload();
    await waitForHydratedRows(page, DEFAULT_ORDER);

    const contexts = await storedContexts(page);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.entries.map(({ id }) => id)).toEqual(await rowIds(page));
    const hrefKeys = await rows(page).evaluateAll((elements) =>
      elements.map((element) =>
        new URL((element as HTMLAnchorElement).href).searchParams.get("collectionContext"),
      ),
    );
    expect(new Set(hrefKeys)).toEqual(new Set([contexts[0]?.key]));

    const samples = await page.evaluate(() => {
      const state = window as typeof window & {
        __collectionSamples?: Array<{ ids: string[]; keys: Array<string | null> }>;
        __collectionObserver?: MutationObserver;
      };
      state.__collectionObserver?.disconnect();
      return state.__collectionSamples ?? [];
    });
    for (const sample of samples.filter(({ ids }) => ids.length > 0)) {
      const contextualCount = sample.keys.filter((key) => key !== null).length;
      expect([0, sample.keys.length]).toContain(contextualCount);
      expect(new Set(sample.keys.filter((key) => key !== null)).size).toBeLessThanOrEqual(1);
    }
  });

  test("filtered specialized order traverses exact immediate neighbors without wrapping", async ({
    page,
  }) => {
    await configureScopedProjection(page);
    await page.locator("#collection-game-game-5").click();

    const previous = page.getByRole("link", { name: /Previous game: Borealis/ });
    const next = page.getByRole("link", { name: "Next game: Atlas Equal" });
    await expect(previous).toBeVisible();
    await expect(next).toBeVisible();
    await previous.click();
    await expect(page.getByText("No previous game", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Next game: Distant Previously Owned/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Previous game:/ })).toHaveCount(0);

    await page.getByRole("link", { name: /Next game: Distant Previously Owned/ }).click();
    await page.getByRole("link", { name: "Next game: Atlas Equal" }).click();
    await expect(page.getByText("No next game", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Next game:/ })).toHaveCount(0);
  });

  test("one-result context keeps the return breadcrumb but grouped rows remain plain", async ({
    page,
  }) => {
    await page.goto("/collection");
    await page.getByPlaceholder("Search games by name...").fill("Isolated Beacon");
    await waitForHydratedRows(page, ["game-6"]);
    await page.locator("#collection-game-game-6").click();
    await expectNoStrip(page);
    await expect(
      page.locator(".topbar .breadcrumb").getByRole("link", { name: "Collection" }),
    ).toHaveAttribute("href", /collectionContext=.*collectionOrigin=game-6/);

    await page.goto("/collection");
    await page.getByPlaceholder("Search games by name...").fill("");
    await page.getByText("Niches", { exact: true }).click();
    await page.getByText("Group", { exact: true }).click();
    await expect(page.locator(".niche-group")).toHaveCount(2);
    const groupedHrefs = await page
      .locator(".niche-group .game-row")
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));
    expect(groupedHrefs.length).toBeGreaterThan(2);
    expect(groupedHrefs.every((href) => href !== null && !href.includes("collectionContext"))).toBe(
      true,
    );
    await page.locator(".niche-group .game-row").first().click();
    await expect(page).toHaveURL(/\/games\//);
    await expectNoStrip(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/collection$/);
    expect(await historyScrollMarker(page)).toBeUndefined();
  });

  test("failed persistence leaves every row plain and projection changes never expose an old key", async ({
    page,
  }) => {
    await page.addInitScript((prefix) => {
      const original = localStorage.setItem.bind(localStorage);
      Storage.prototype.setItem = function setItem(key: string, value: string): void {
        if (key.startsWith(prefix))
          throw new DOMException("Injected quota failure", "QuotaExceededError");
        original(key, value);
      };
    }, CONTEXT_PREFIX);
    await page.reload();
    await expect.poll(() => rowIds(page)).toEqual(DEFAULT_ORDER);
    await expect
      .poll(() =>
        rows(page).evaluateAll((elements) =>
          elements.every(
            (element) => !(element.getAttribute("href") ?? "").includes("collectionContext"),
          ),
        ),
      )
      .toBe(true);
    expect(await storedContexts(page)).toEqual([]);
    await rows(page).first().click();
    await expect(page).toHaveURL(/\/games\//);
    await page.goBack();
    await expect(page).toHaveURL(/\/collection$/);
    expect(await historyScrollMarker(page)).toBeUndefined();
  });

  test("a changed projection is plain until its new immutable key is persisted", async ({
    page,
  }) => {
    await page.goto("/collection");
    await waitForHydratedRows(page, DEFAULT_ORDER);
    const oldKey = await contextKeyFromRow(rows(page).first());
    await page.evaluate(() => {
      const observations: Array<{ ids: string[]; keys: Array<string | null> }> = [];
      const observer = new MutationObserver(() => {
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".game-row[id]"));
        observations.push({
          ids: links.map((link) => link.id),
          keys: links.map((link) => new URL(link.href).searchParams.get("collectionContext")),
        });
      });
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      Object.assign(window, {
        __projectionObservations: observations,
        __projectionObserver: observer,
      });
    });

    await page.getByPlaceholder("Search games by name...").fill("Isolated Beacon");
    await waitForHydratedRows(page, ["game-6"]);
    const newKey = await contextKeyFromRow(rows(page).first());
    expect(newKey).not.toBe(oldKey);
    const observations = await page.evaluate(() => {
      const state = window as typeof window & {
        __projectionObservations?: Array<{ ids: string[]; keys: Array<string | null> }>;
        __projectionObserver?: MutationObserver;
      };
      state.__projectionObserver?.disconnect();
      return state.__projectionObservations ?? [];
    });
    expect(
      observations.some(
        ({ ids, keys }) =>
          ids.some((id) => id.endsWith("game-6")) && keys.some((key) => key === oldKey),
      ),
    ).toBe(false);
    const contexts = await storedContexts(page);
    expect(new Set(contexts.map(({ key }) => key))).toEqual(new Set([oldKey, newKey]));
  });
});

test.describe("detail persistence and fallback", () => {
  test("reload, same-browser new tab, and another tab's preferences preserve the chain", async ({
    page,
    context,
    networkEvidence,
  }) => {
    await page.goto("/collection");
    await waitForHydratedRows(page, DEFAULT_ORDER);
    const contextualUrl = await page.locator("#collection-game-game-3").getAttribute("href");
    if (contextualUrl === null) throw new Error("Expected contextual URL");
    await page.goto(contextualUrl);
    await expect(page.getByRole("link", { name: /Previous game: Borealis/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name: /Previous game: Borealis/ })).toBeVisible();

    const newTab = await context.newPage();
    await newTab.goto(contextualUrl);
    await expect(
      newTab.getByRole("link", { name: new RegExp(`Next game: ${LONG_NEXT_NAME}`) }),
    ).toBeVisible();
    await newTab.evaluate(() => {
      localStorage.setItem(
        "shelf-judge-sort",
        JSON.stringify({ field: "name", direction: "desc" }),
      );
      localStorage.setItem(
        "shelf-judge-filters",
        JSON.stringify({
          search: "Zephyr",
          ratedStatus: "all",
          playedStatus: "all",
          playerCount: null,
        }),
      );
    });
    await page.getByRole("link", { name: new RegExp(`Next game: ${LONG_NEXT_NAME}`) }).click();
    await expect(page.getByRole("link", { name: /Previous game: Cinder Equal/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Next game: Isolated Beacon" })).toBeVisible();
    await newTab.close();
    expect(networkEvidence.externalRequests).toEqual([]);
  });

  test("modifier-click opens contextual detail without marking the Collection entry", async ({
    page,
    context,
  }) => {
    await page.goto("/collection");
    await waitForHydratedRows(page, DEFAULT_ORDER);
    const modifier = process.platform === "darwin" ? ("Meta" as const) : ("Control" as const);

    expect(await historyScrollMarker(page)).toBeUndefined();
    const [newTab] = await Promise.all([
      context.waitForEvent("page"),
      rows(page)
        .first()
        .click({ modifiers: [modifier] }),
    ]);
    await newTab.waitForLoadState("domcontentloaded");

    expect(new URL(page.url()).pathname).toBe("/collection");
    expect(await historyScrollMarker(page)).toBeUndefined();
    await expect(newTab).toHaveURL(/\/games\/game-1\?.*collectionContext=/);
    await expect(
      newTab.getByRole("navigation", { name: "Collection game navigation" }),
    ).toBeVisible();

    await newTab.close();
  });

  test("direct, malformed, expired, absent-current, and isolated contexts fall back", async ({
    page,
    browser,
  }) => {
    await page.goto("/games/game-2");
    await expectNoStrip(page);
    await page.goto(detailUrl("game-2", "malformed"));
    await expectNoStrip(page);

    const expired = seededContext({ lastAccessedAt: Date.now() - TTL_MS });
    await seedContext(page, expired);
    await page.goto(detailUrl("game-2"));
    await expectNoStrip(page);

    await seedContext(page, seededContext());
    await page.goto(detailUrl("game-3"));
    await expectNoStrip(page);

    await page.goto("/collection");
    await waitForHydratedRows(page, DEFAULT_ORDER);
    const contextualUrl = await page.locator("#collection-game-game-2").getAttribute("href");
    if (contextualUrl === null) throw new Error("Expected contextual URL");
    const isolated = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
    const isolatedEvidence: NetworkEvidence = { externalRequests: [] };
    await guardNetwork(isolated, isolatedEvidence);
    try {
      const isolatedPage = await isolated.newPage();
      await isolatedPage.goto(contextualUrl);
      await expect(isolatedPage.getByRole("heading", { name: /Borealis/ })).toBeVisible();
      await expectNoStrip(isolatedPage);
      expect(isolatedEvidence.externalRequests).toEqual([]);
    } finally {
      await isolated.close();
    }
  });

  test("deleted targets delegate to the existing missing-game result", async ({ page }) => {
    await page.goto("/collection");
    await waitForHydratedRows(page, DEFAULT_ORDER);
    await page.locator("#collection-game-game-3").click();
    await setFixtureState(page, { deletedIds: ["game-7"] });
    await page.getByRole("link", { name: new RegExp(`Next game: ${LONG_NEXT_NAME}`) }).click();
    await expect(page.getByText("Game not found: game-7")).toBeVisible();
  });
});

test.describe("contextual Collection return", () => {
  test("restores and persists scope and controls, cleans transport, and focuses the origin", async ({
    page,
  }) => {
    await configureScopedProjection(page);
    await page.locator("#collection-game-game-5").click();
    const breadcrumb = page
      .locator(".topbar .breadcrumb")
      .getByRole("link", { name: "Collection" });
    await expect(breadcrumb).toHaveAttribute("href", /ownership=all.*dimensions=missing/);
    await breadcrumb.click();

    await expect(page).toHaveURL(
      /\/collection\?ownership=all&dimensions=missing#collection-game-game-5$/,
    );
    expect(await historyScrollMarker(page)).toBeUndefined();
    await expect(page.locator("#collection-game-game-5")).toBeFocused();
    await expect(page.getByPlaceholder("Search games by name...")).toHaveValue("a");
    await expect(page.locator(".sort-select-label")).toHaveText(
      "Estimated Additional Plays to Value Threshold",
    );
    await expect(page.locator(".sort-dir-btn")).toHaveText("↑");
    await expect(page.getByText("Rated only", { exact: false })).toBeVisible();
    await expect(page.getByText("Unplayed only", { exact: false })).toBeVisible();
    await expect(page.getByText("2 players", { exact: false })).toBeVisible();
    const persisted = await page.evaluate(() => ({
      sort: localStorage.getItem("shelf-judge-sort"),
      filters: localStorage.getItem("shelf-judge-filters"),
    }));
    expect(persisted).toEqual({
      sort: JSON.stringify({ field: "estimatedAdditionalPlays", direction: "asc" }),
      filters: JSON.stringify({
        search: "a",
        ratedStatus: "rated",
        playedStatus: "unplayed",
        playerCount: 2,
      }),
    });
  });

  test("changed membership, deleted origin, and final-empty return preserve controls and focus heading", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("desktop") || testInfo.project.name.includes("200-percent"),
    );
    const cases = [
      { state: { previouslyOwnedIds: ["game-1"] }, empty: false },
      { state: { deletedIds: ["game-1"] }, empty: false },
      { state: { empty: true }, empty: true },
    ];
    for (const scenario of cases) {
      await reset(page);
      await page.goto("/collection");
      await page.getByPlaceholder("Search games by name...").fill("Atlas");
      await waitForHydratedRows(page, ["game-1"]);
      const href = await page.locator("#collection-game-game-1").getAttribute("href");
      if (href === null) throw new Error("Expected contextual URL");
      await page.goto(href);
      const returnBreadcrumb = page
        .locator(".topbar .breadcrumb")
        .getByRole("link", { name: "Collection" });
      await expect(returnBreadcrumb).toHaveAttribute("href", /collectionContext=/);
      const returnHref = await returnBreadcrumb.getAttribute("href");
      if (returnHref === null) throw new Error("Expected contextual return URL");
      await setFixtureState(page, scenario.state);
      await page.goto(returnHref);
      await expect(page.locator("#collection-heading")).toBeFocused();
      await expect(page).not.toHaveURL(/collectionContext|collectionOrigin/);
      if (scenario.empty) {
        await expect(page.getByRole("heading", { name: "No games yet" })).toBeVisible();
      } else {
        await expect(page.getByPlaceholder("Search games by name...")).toHaveValue("Atlas");
        await expect(rows(page)).toHaveCount(0);
      }
    }
  });

  test("capability mismatches use ordinary persisted state and consume transport once", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("desktop") || testInfo.project.name.includes("200-percent"),
    );
    const mismatchCases: Array<{
      projection: StoredContext["projection"];
      state: Record<string, unknown>;
    }> = [
      {
        projection: {
          ...seededContext().projection,
          sort: { field: "axis:axis-enjoyment", direction: "desc" },
        },
        state: { axesAvailable: false },
      },
      {
        projection: {
          ...seededContext().projection,
          sort: { field: "tournament", direction: "desc" },
        },
        state: { tournamentAvailable: false },
      },
      {
        projection: {
          ...seededContext().projection,
          sort: { field: "bggRating", direction: "desc" },
        },
        state: {},
      },
      {
        projection: {
          ...seededContext().projection,
          predictionsOn: true,
          effectivePredictionsOn: true,
        },
        state: { predictionsAvailable: false },
      },
      {
        projection: { ...seededContext().projection, nichesOn: true },
        state: { nichesAvailable: false },
      },
      {
        projection: { ...seededContext().projection, effectivePredictionsOn: true },
        state: { integratedRedundancy: false },
      },
    ];

    for (const mismatch of mismatchCases) {
      await reset(page);
      await page.goto("/collection");
      await waitForHydratedRows(page);
      await page.evaluate(() => {
        localStorage.setItem(
          "shelf-judge-sort",
          JSON.stringify({ field: "name", direction: "asc" }),
        );
        localStorage.setItem(
          "shelf-judge-filters",
          JSON.stringify({
            search: "Isolated",
            ratedStatus: "all",
            playedStatus: "all",
            playerCount: null,
          }),
        );
      });
      await seedContext(page, seededContext({ projection: mismatch.projection }));
      await setFixtureState(page, mismatch.state);
      await page.goto(
        `/collection?collectionContext=${CONTEXT_KEY}&collectionOrigin=game-1#collection-game-game-1`,
      );
      await expect(page.getByPlaceholder("Search games by name...")).toHaveValue("Isolated");
      await expect(page.locator(".sort-select-label")).toHaveText("Name");
      await expect(page).toHaveURL("/collection#collection-game-game-1");
      await page.reload();
      await expect(page.locator(".collection-restoring")).toHaveCount(0);
      await expect(page.getByPlaceholder("Search games by name...")).toHaveValue("Isolated");
    }
  });

  test("invalid context and origin preserve scope and fragment without repeated restoration", async ({
    page,
  }) => {
    await page.evaluate(() => {
      localStorage.setItem(
        "shelf-judge-sort",
        JSON.stringify({ field: "name", direction: "desc" }),
      );
      localStorage.setItem(
        "shelf-judge-filters",
        JSON.stringify({
          search: "Atlas",
          ratedStatus: "all",
          playedStatus: "all",
          playerCount: null,
        }),
      );
    });
    await page.goto(
      "/collection?ownership=all&dimensions=missing&collectionContext=bad&collectionOrigin=missing#kept-fragment",
    );
    await expect(page.getByPlaceholder("Search games by name...")).toHaveValue("Atlas");
    await expect(page).toHaveURL("/collection?ownership=all&dimensions=missing#kept-fragment");
    await page.reload();
    await expect(page.locator(".collection-restoring")).toHaveCount(0);
    await expect(page.getByPlaceholder("Search games by name...")).toHaveValue("Atlas");
  });

  test("ordinary Browser Back preserves the mounted projection and scroll", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-mobile",
      "The constrained mobile viewport provides real nested overflow; history behavior is project-independent",
    );
    const expectedOrder = ["game-7", "game-6", "game-3", "game-2", "game-1"];
    await page.goto("/collection");
    await page.getByPlaceholder("Search games by name...").fill("e");
    await selectSort(page, "Name");
    await page.locator(".sort-dir-btn").click();
    await waitForHydratedRows(page, expectedOrder);
    await expect(page.locator(".filter-chip.chip-search")).toBeVisible();
    await page.evaluate(() => {
      const currentState: unknown = window.history.state;
      const nextState =
        typeof currentState === "object" && currentState !== null ? { ...currentState } : {};
      window.history.replaceState({ ...nextState, p6UnrelatedState: "preserved" }, "");
      const originalReplaceState = window.history.replaceState.bind(window.history);
      window.history.replaceState = (
        data: unknown,
        unused: string,
        url?: string | URL | null,
      ): void => {
        if (typeof data === "object" && data !== null) {
          const marker: unknown = Reflect.get(data, "shelfJudgeCollectionScrollTop");
          if (typeof marker === "number") {
            Reflect.set(window, "__collectionScrollMarkerWrite", marker);
          }
        }
        originalReplaceState(data, unused, url);
      };
    });
    const scroller = page.locator(".main-scroll");
    await scroller.evaluate((element) => {
      element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight);
    });
    const before = await scroller.evaluate((element) => element.scrollTop);
    expect(before).toBeGreaterThan(0);
    await page.locator("#collection-game-game-3").click();
    await expect(page).toHaveURL(/\/games\/game-3\?/);
    await expect(page.locator(".detail-collection-navigation")).toBeVisible();
    const capturedMarker: unknown = await page.evaluate(() => {
      const marker: unknown = Reflect.get(window, "__collectionScrollMarkerWrite");
      return marker;
    });
    expect(capturedMarker).toBe(before);
    await page.goBack();
    await expect(page).toHaveURL(/\/collection$/);
    const unrelatedState: unknown = await page.evaluate(() => {
      const state: unknown = window.history.state;
      const value: unknown =
        typeof state === "object" && state !== null
          ? Reflect.get(state, "p6UnrelatedState")
          : undefined;
      return value;
    });
    expect(unrelatedState).toBe("preserved");
    await expect(page.getByPlaceholder("Search games by name...")).toHaveValue("e");
    await expect(page.locator(".filter-chip.chip-search")).toBeVisible();
    await expect(page.locator(".sort-select-label")).toHaveText("Name");
    await expect(page.locator(".sort-dir-btn")).toHaveText("↓");
    await expect.poll(() => rowIds(page)).toEqual(expectedOrder);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(before);
    await expect.poll(() => historyScrollMarker(page)).toBeUndefined();

    const laterScrollTop = Math.max(1, Math.floor(before / 2));
    await scroller.evaluate((element, top) => {
      element.scrollTop = top;
    }, laterScrollTop);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(laterScrollTop);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("navigation").getByRole("link", { name: "Profile", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/collection$/);
    await expect(page.getByPlaceholder("Search games by name...")).toHaveValue("e");
    await expect(page.locator(".filter-chip.chip-search")).toBeVisible();
    await expect(page.locator(".sort-select-label")).toHaveText("Name");
    await expect(page.locator(".sort-dir-btn")).toHaveText("↓");
    await expect.poll(() => rowIds(page)).toEqual(expectedOrder);
    expect(await historyScrollMarker(page)).toBeUndefined();
    const browserManagedScrollTop = await scroller.evaluate((element) => element.scrollTop);
    expect(browserManagedScrollTop).toBe(0);
    expect(browserManagedScrollTop).not.toBe(before);
    expect(laterScrollTop).not.toBe(before);
  });
});

test("keyboard, semantics, full labels, targets, and overflow hold in every configured viewport", async ({
  page,
}, testInfo) => {
  await page.goto("/collection");
  await waitForHydratedRows(page, DEFAULT_ORDER);
  await page.locator("#collection-game-game-3").click();
  const previous = page.getByRole("link", { name: /Previous game: Borealis/ });
  const next = page.getByRole("link", { name: `Next game: ${LONG_NEXT_NAME}` });
  await expect(previous).toBeVisible();
  await expect(next).toBeVisible();
  await page.locator("body").focus();
  for (
    let index = 0;
    index < 40 && !(await previous.evaluate((element) => element === document.activeElement));
    index += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(previous).toBeFocused();
  const focusStyle = await previous.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(focusStyle.style).not.toBe("none");
  expect(focusStyle.width).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Tab");
  await expect(next).toBeFocused();
  for (const link of [previous, next]) {
    const box = await link.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expect(next).toHaveAttribute("aria-label", `Next game: ${LONG_NEXT_NAME}`);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: /Previous game: Borealis/ }).click();
  await page.getByRole("link", { name: "Previous game: Atlas Equal" }).click();
  const boundary = page.getByText("No previous game", { exact: true });
  await expect(boundary).toBeVisible();
  await expect(boundary).not.toHaveAttribute("tabindex");
  await expect(page.getByRole("link", { name: "No previous game" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name.includes("200-percent")) {
    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      visualScale: window.visualViewport?.scale ?? 1,
    }));
    expect(metrics).toEqual({
      innerWidth: 720,
      innerHeight: 450,
      devicePixelRatio: 2,
      visualScale: 1,
    });
  }
});

test("literal Chromium 200 percent zoom preserves detail navigation", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Probe requires the 1440x900 project");
  const zoomLevel = Math.log(2) / Math.log(1.2);
  mkdirSync("/tmp/opencode", { recursive: true });
  const userDataDir = mkdtempSync("/tmp/opencode/shelf-judge-zoom-");
  let zoomContext: BrowserContext | undefined;
  let primaryFailed = false;
  let primaryError: unknown;
  let cleanupFailed = false;
  let cleanupError: unknown;
  try {
    mkdirSync(`${userDataDir}/Default`);
    writeFileSync(
      `${userDataDir}/Default/Preferences`,
      JSON.stringify({ partition: { default_zoom_level: { x: zoomLevel } } }),
    );
    zoomContext = await chromium.launchPersistentContext(userDataDir, {
      executablePath: browser.browserType().executablePath(),
      headless: true,
      viewport: null,
      baseURL: "http://127.0.0.1:3100",
      colorScheme: "light",
      args: ["--window-size=1440,900", "--window-position=0,0"],
    });
    const evidence: NetworkEvidence = { externalRequests: [] };
    await guardNetwork(zoomContext, evidence);
    const page = zoomContext.pages()[0] ?? (await zoomContext.newPage());
    await reset(page);
    await clearBrowserState(page);
    await page.goto("/collection");
    await waitForHydratedRows(page, DEFAULT_ORDER);
    await page.locator("#collection-game-game-3").click();

    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      visualScale: window.visualViewport?.scale ?? 1,
    }));
    expect(metrics).toEqual({
      innerWidth: 720,
      innerHeight: 406,
      outerWidth: 1440,
      outerHeight: 900,
      devicePixelRatio: 2,
      visualScale: 1,
    });
    const previous = page.getByRole("link", { name: /Previous game: Borealis/ });
    const next = page.getByRole("link", { name: `Next game: ${LONG_NEXT_NAME}` });
    await expect(previous).toBeVisible();
    await expect(next).toHaveAttribute("aria-label", `Next game: ${LONG_NEXT_NAME}`);
    for (const link of [previous, next]) {
      const box = await link.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);
    expect(evidence.externalRequests).toEqual([]);
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
  } finally {
    try {
      await zoomContext?.close();
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
    } finally {
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch (error) {
        if (!cleanupFailed) {
          cleanupFailed = true;
          cleanupError = error;
        }
      }
    }
  }
  if (primaryFailed) throw primaryError;
  if (cleanupFailed) throw cleanupError;
});
