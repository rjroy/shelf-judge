import { expect, test } from "@playwright/test";

test("collection thumbnails defer distant requests without shifting rows", async ({ page }) => {
  const reset = await page.request.post("/api/daemon/test/reset", {
    data: { scenario: "collection" },
  });
  expect(reset.ok()).toBe(true);
  const fixture = await page.request.post("/api/daemon/test/collection-state", {
    data: { thumbnails: true },
  });
  expect(fixture.ok()).toBe(true);

  const requested = new Set<string>();
  let releaseImages = () => {};
  const imagesReleased = new Promise<void>((resolve) => {
    releaseImages = resolve;
  });
  await page.route("**/test-thumbnails/*.svg", async (route) => {
    requested.add(route.request().url());
    await imagesReleased;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#1c3d5e"/></svg>',
    });
  });

  try {
    await page.goto("/collection", { waitUntil: "domcontentloaded" });
    const thumbnails = page.locator(".game-row img.game-thumb");
    await expect(thumbnails).toHaveCount(100);
    const first = thumbnails.first();
    const last = thumbnails.last();
    await expect(first).toBeInViewport();
    await expect(last).not.toBeInViewport();
    await expect.poll(() => requested.size).toBeGreaterThan(0);
    // Allow the initial browser loading window to settle while image responses are held.
    await page.waitForTimeout(500);
    console.log(`Initial thumbnail requests: ${requested.size}/100`);
    expect(requested.size).toBeLessThan(100);
    const lastPath = await last.getAttribute("src");
    expect([...requested].some((url) => new URL(url).pathname === lastPath)).toBe(false);

    const row = page.locator(".game-row").first();
    const rowBefore = await row.boundingBox();
    const imageBefore = await first.boundingBox();
    expect(imageBefore).toMatchObject({ width: 40, height: 40 });
    releaseImages();
    await expect
      .poll(() => first.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(80);
    expect(await first.boundingBox()).toEqual(imageBefore);
    expect(await row.boundingBox()).toEqual(rowBefore);
    await page.screenshot({ path: test.info().outputPath("collection-thumbnails.png") });

    await last.scrollIntoViewIfNeeded();
    await expect
      .poll(() => last.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(80);
    expect([...requested].some((url) => new URL(url).pathname === lastPath)).toBe(true);
    expect(await last.boundingBox()).toMatchObject({ width: 40, height: 40 });
  } finally {
    releaseImages();
  }
});
