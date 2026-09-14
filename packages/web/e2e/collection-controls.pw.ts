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

  const lastRated = page.getByRole("button", { name: /^Last Rated:/ });
  if (await lastRated.isVisible()) {
    await tabTo(page, lastRated);
    await page.keyboard.press("Enter");
    await expect(lastRated).toHaveAccessibleName("Last Rated: sorted descending");
    await page.keyboard.press("Space");
    await expect(lastRated).toHaveAccessibleName("Last Rated: sorted ascending");
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
