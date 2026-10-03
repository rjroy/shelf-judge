import { expect, test, type Locator, type Page } from "@playwright/test";

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 80; count++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Control is not reachable through keyboard navigation");
}

test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/daemon/test/reset", {
    data: { scenario: "collection" },
  });
  expect(response.ok()).toBe(true);
});

test("collection rows keep scores and penalty without similarity readiness labels on desktop and mobile", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/collection");
    await expect(page.locator(".game-row").first()).toBeVisible();
    await expect(
      page.getByText(/semantic similarity|factual-only comparison|similarity data stale/i),
    ).toHaveCount(0);
    await expect(page.locator(".score-cell").first()).toBeVisible();
    await expect(page.locator(".redundancy-badge").first()).toBeVisible();
    expect(
      await page.locator("body").evaluate((element) => element.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("niche groups collapse independently and retain their state while filtering", async ({
  page,
}) => {
  await page.goto("/collection");
  await page.getByRole("button", { name: "Niches", exact: true }).click();
  await page.getByRole("button", { name: "Group", exact: true }).click();

  const shared = page.locator(".niche-group").filter({ hasText: "Shared Strategy" });
  const duplicate = page.locator(".niche-group").filter({ hasText: "Duplicate Membership" });
  const collapse = shared.getByRole("button", { name: "Collapse Shared Strategy niche" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(shared.locator(".game-row")).toHaveCount(5);
  await expect(duplicate.locator(".game-row")).toHaveCount(2);

  await tabTo(page, collapse);
  await page.keyboard.press("Enter");
  const expand = shared.getByRole("button", { name: "Expand Shared Strategy niche" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(shared.locator(".game-row")).toHaveCount(0);
  await expect(duplicate.locator(".game-row")).toHaveCount(2);
  await expect(shared.getByRole("button", { name: "Hide Shared Strategy niche" })).toBeVisible();

  const search = page.getByRole("textbox", { name: "Search games by name" });
  await search.fill("Atlas");
  await expect(shared).toHaveCount(0);
  await search.fill("");
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await expect(expand).toHaveAttribute("aria-expanded", "false");

  await expand.focus();
  await page.keyboard.press("Space");
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(shared.locator(".game-row")).toHaveCount(5);
});

test("collection toggles and sorting expose state and respond to Enter and Space", async ({
  page,
}, testInfo) => {
  await page.goto("/collection");
  const predictions = page.getByRole("button", { name: "Predictions", exact: true });
  await expect(predictions).toHaveAttribute("aria-pressed", "false");
  await tabTo(page, predictions);
  await page.keyboard.press("Enter");
  await expect(predictions).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".predictions-stat")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(predictions).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".predictions-stat")).toHaveCount(0);

  const niches = page.getByRole("button", { name: "Niches", exact: true });
  await tabTo(page, niches);
  await page.keyboard.press("Space");
  await expect(niches).toHaveAttribute("aria-pressed", "true");
  const group = page.getByRole("button", { name: "Group", exact: true });
  await tabTo(page, group);
  await page.keyboard.press("Enter");
  await expect(group).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".niche-group").first()).toBeVisible();
  await page.keyboard.press("Space");
  await expect(group).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".niche-group")).toHaveCount(0);

  const gameSort = page.getByRole("button", { name: /^Game:/ });
  if (!(await gameSort.isVisible())) {
    // Mobile presents sorting in the toolbar instead of the hidden column headers.
    const direction = page.getByTitle("Toggle sort direction");
    await tabTo(page, direction);
    const before = await page
      .locator(".game-row[id]")
      .evaluateAll((rows) => rows.map((row) => row.id));
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.locator(".game-row[id]").evaluateAll((rows) => rows.map((row) => row.id)))
      .not.toEqual(before);
    await page.keyboard.press("Space");
    await expect
      .poll(() => page.locator(".game-row[id]").evaluateAll((rows) => rows.map((row) => row.id)))
      .toEqual(before);
    await page.screenshot({ path: testInfo.outputPath("collection-controls.png") });
    return;
  }
  const initialScore = page.getByRole("button", { name: /^Score \(/ });
  await expect(initialScore).toHaveAttribute("aria-pressed", "true");
  await tabTo(page, initialScore);
  await page.keyboard.press("Enter");
  await expect(initialScore).toHaveAccessibleName(/sorted ascending$/);
  await page.keyboard.press("Space");
  await expect(initialScore).toHaveAccessibleName(/sorted descending$/);
  await tabTo(page, gameSort);
  await page.keyboard.press("Enter");
  await expect(gameSort).toHaveAccessibleName("Game: sorted ascending");
  await expect(gameSort).toHaveAttribute("aria-pressed", "true");
  const ascending = await page
    .locator(".game-row[id]")
    .evaluateAll((rows) => rows.map((row) => row.id));
  await page.keyboard.press("Space");
  await expect(gameSort).toHaveAccessibleName("Game: sorted descending");
  await expect
    .poll(() => page.locator(".game-row[id]").evaluateAll((rows) => rows.map((row) => row.id)))
    .toEqual([...ascending].reverse());

  const lastUpdated = page.getByRole("button", { name: /^Last Updated:/ });
  if (await lastUpdated.isVisible()) {
    await tabTo(page, lastUpdated);
    await page.keyboard.press("Enter");
    await expect(lastUpdated).toHaveAccessibleName("Last Updated: sorted descending");
    await page.keyboard.press("Space");
    await expect(lastUpdated).toHaveAccessibleName("Last Updated: sorted ascending");
    await expect(gameSort).toHaveAttribute("aria-pressed", "false");
  }

  const currentSort = await page
    .locator(".collection-header button[aria-pressed=true]")
    .getAttribute("aria-label");
  // The score header reverses the selected sort, including a non-score sort.
  const score = page.getByRole("button", { name: /^Score \(/ });
  await tabTo(page, score);
  await page.keyboard.press("Enter");
  await expect(page.locator(".collection-header button[aria-pressed=true]")).not.toHaveAttribute(
    "aria-label",
    currentSort ?? "",
  );
  await page.keyboard.press("Space");
  await expect(page.locator(".collection-header button[aria-pressed=true]")).toHaveAttribute(
    "aria-label",
    currentSort ?? "",
  );
  await expect(score).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("collection-controls.png") });
});

test("snapshot first load, reload 304, changed response, and focus revalidation", async ({
  page,
}) => {
  const snapshotStatuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/daemon/collection/snapshot") {
      snapshotStatuses.push(response.status());
    }
  });

  await page.goto("/collection");
  await expect(page.locator(".game-row")).toHaveCount(5);
  expect(snapshotStatuses).toEqual([200]);

  await page.reload();
  await expect(page.locator(".game-row")).toHaveCount(5);
  expect(snapshotStatuses).toEqual([200, 304]);

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => snapshotStatuses.length).toBe(3);
  expect(snapshotStatuses[2]).toBe(304);

  const changedState = await page.request.post("/api/daemon/test/collection-state", {
    data: { empty: true },
  });
  expect(changedState.ok()).toBe(true);
  await page.reload();
  await expect.poll(() => snapshotStatuses.length).toBe(4);
  await expect(page.locator(".game-row")).toHaveCount(0);
  expect(snapshotStatuses[3]).toBe(200);
});

test("successful collection mutations each trigger one fresh snapshot request", async ({
  page,
}) => {
  const snapshotStatuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/daemon/collection/snapshot") {
      snapshotStatuses.push(response.status());
    }
  });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/collection");
  await expect(page.getByRole("button", { name: "Predictions", exact: true })).toBeVisible();
  await expect.poll(() => snapshotStatuses.length).toBe(1);

  const search = page.getByRole("textbox", { name: "Search games by name" });
  await search.fill("Atlas");
  await expect(page.locator(".game-row")).toHaveCount(1);
  const predictions = page.getByRole("button", { name: "Predictions", exact: true });
  await predictions.click();
  await expect(predictions).toHaveAttribute("aria-pressed", "true");
  const scoreCell = page.locator("#collection-game-game-1 .score-cell");
  const beforeRefreshScore = (await scoreCell.innerText()).trim();

  await page.getByRole("button", { name: "Refresh All BGG" }).click();
  await expect(page.getByText("Refreshed 6 game(s)")).toBeVisible();
  await expect.poll(() => snapshotStatuses.length).toBe(2);
  await expect(search).toHaveValue("Atlas");
  await expect(page.locator(".game-row")).toHaveCount(1);
  await expect(predictions).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await scoreCell.innerText()).trim()).not.toBe(beforeRefreshScore);
  const afterRefreshScore = (await scoreCell.innerText()).trim();
  await search.fill("");

  await page.getByRole("button", { name: "Normalize Fitness" }).click();
  await expect(page.getByText("Normalized fitness for 6 game(s)")).toBeVisible();
  await expect.poll(() => snapshotStatuses.length).toBe(3);
  await expect.poll(async () => (await scoreCell.innerText()).trim()).not.toBe(afterRefreshScore);

  await page.getByRole("button", { name: "Niches", exact: true }).click();
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await page.getByRole("button", { name: "Hide Shared Strategy niche" }).click();
  await expect.poll(() => snapshotStatuses.length).toBe(4);
  await expect(page.getByText("Ignored Niches")).toBeVisible();
  await page.getByRole("button", { name: "Restore Shared Strategy niche" }).click();
  await expect.poll(() => snapshotStatuses.length).toBe(5);
  await expect(page.getByText("Ignored Niches")).toHaveCount(0);

  expect(snapshotStatuses).toEqual([200, 200, 200, 200, 200]);
});

test("degraded snapshots render partial rows without replacing the complete cached validator", async ({
  page,
}) => {
  const snapshotStatuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/daemon/collection/snapshot") {
      snapshotStatuses.push(response.status());
    }
  });
  await page.goto("/collection");
  await expect(page.locator(".game-row")).toHaveCount(5);

  const degraded = await page.request.post("/api/daemon/test/collection-state", {
    data: { predictionsAvailable: false },
  });
  expect(degraded.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("Some Collection details are unavailable.")).toBeVisible();
  await expect(page.locator(".game-row")).toHaveCount(5);

  await page.reload();
  await expect(page.getByText("Some Collection details are unavailable.")).toBeVisible();
  expect(snapshotStatuses.slice(0, 3)).toEqual([200, 200, 200]);

  const recovered = await page.request.post("/api/daemon/test/collection-state", {
    data: { predictionsAvailable: true },
  });
  expect(recovered.ok()).toBe(true);
  await page.reload();
  await expect(page.locator(".game-row")).toHaveCount(5);
  await expect(page.getByText("Some Collection details are unavailable.")).toHaveCount(0);
  expect(snapshotStatuses[3]).toBe(304);
});

test("network failure shows retryable error and recovery loads the current snapshot", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/daemon/collection/snapshot", async (route) => {
    requests++;
    if (requests === 1) await route.abort("failed");
    else await route.continue();
  });

  await page.goto("/collection");
  await expect(page.getByRole("heading", { name: "Your games couldn’t be loaded" })).toBeVisible();
  await page.getByRole("button", { name: "Retry loading games" }).click();
  await expect(page.locator(".game-row")).toHaveCount(5);
  expect(requests).toBe(2);
});

test("focus during a pending snapshot queues one authoritative follow-up after a second-tab edit", async ({
  page,
  context,
}) => {
  let requests = 0;
  let captured!: () => void;
  let release!: () => void;
  const firstCaptured = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const releaseFirst = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/daemon/collection/snapshot", async (route) => {
    requests++;
    if (requests === 1) {
      const response = await route.fetch();
      const body = await response.body();
      captured();
      await releaseFirst;
      await route.fulfill({ response, body });
      return;
    }
    await route.continue();
  });

  await page.goto("/collection");
  await firstCaptured;
  await expect(page.getByText("Loading your games…")).toBeVisible();
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  const changed = await otherTab.request.post("/api/daemon/test/collection-state", {
    data: { deletedIds: ["game-7"] },
  });
  expect(changed.ok()).toBe(true);
  await otherTab.close();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  release();

  await expect(page.locator("#collection-game-game-7")).toHaveCount(0);
  await expect(page.locator(".game-row")).toHaveCount(4);
  expect(requests).toBe(2);
});

test("shelf expansion is keyboard-operable without nesting rename actions", async ({
  page,
}, testInfo) => {
  await page.route("**/api/daemon/shelf/config", (route) =>
    route.fulfill({
      json: {
        units: [
          {
            id: "unit-1",
            name: "Living room",
            shelves: [
              {
                id: "shelf-1",
                name: "Top shelf",
                dimensionless: true,
                width: null,
                height: null,
                depth: null,
              },
            ],
          },
        ],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    }),
  );
  await page.goto("/shelves");
  const toggle = page.getByRole("button", { name: "Living room", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await tabTo(page, toggle);
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Top shelf", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`#${await toggle.getAttribute("aria-controls")}`)).toBeVisible();
  await expect(page.getByText("Top shelf", { exact: true })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Rename", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.locator(".shelf-rename-input")).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".shelf-rename-input")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("shelf-controls.png") });
});

test("shelf summary and controls remain visible and operable on narrow screens", async ({
  page,
}) => {
  await page.route("**/api/daemon/shelf/config", (route) =>
    route.fulfill({
      json: {
        units: [
          {
            id: "unit-1",
            name: "Living room",
            shelves: [
              {
                id: "shelf-1",
                name: "Top shelf",
                dimensionless: true,
                width: null,
                height: null,
                depth: null,
              },
            ],
          },
        ],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    }),
  );
  await page.goto("/shelves");

  expect(await page.locator("html").evaluate((element) => element.scrollWidth)).toBe(
    await page.evaluate(() => window.innerWidth),
  );
  await expect(page.getByText("dimensionless shelves", { exact: true })).toBeVisible();

  const badge = page.locator(".shelf-badge-dimensionless");
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  const duplicate = page.getByTitle("Duplicate shelf");
  await expect(badge).toBeInViewport();
  await expect(edit).toBeInViewport();
  await expect(duplicate).toBeInViewport();

  await edit.click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});
