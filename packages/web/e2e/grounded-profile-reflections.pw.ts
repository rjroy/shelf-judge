import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { webUrl } from "./web-url";

async function reset(page: import("@playwright/test").Page): Promise<void> {
  const response = await page.request.post("/api/daemon/test/reset", {
    data: { scenario: "profile" },
  });
  expect(response.ok()).toBe(true);
}

async function reflectionFixture(
  page: import("@playwright/test").Page,
  mode:
    | "answered"
    | "abstained"
    | "stale"
    | "purge-note"
    | "malformed"
    | "configuration-race"
    | "mutate-current",
): Promise<void> {
  const response = await page.request.post("/api/daemon/test/reflection-state", { data: { mode } });
  expect(response.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("optional reflections are nested after deterministic identity evidence and use the production proxy", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(new URL(request.url()).pathname);
  });
  await page.goto("/");
  const identity = page.locator(".profile-question").first();
  const reflections = identity.locator(".optional-reflections");
  await expect(reflections).toBeVisible();
  await expect(page.locator(".profile-question")).toHaveCount(2);
  await expect(reflections.getByRole("heading", { name: "Optional reflections" })).toBeVisible();
  await expect(reflections.getByRole("heading", { level: 4 })).toHaveCount(3);
  await expect.poll(() => requests).toContain("/api/daemon/profile/reflections");
});

test("one Profile navigation crosses the proxy once per Profile surface without passive note or refresh work", async ({
  page,
}) => {
  const requests: string[] = [];
  const requestStartedAt = new Map<import("@playwright/test").Request, number>();
  const responseDurationsMs: Record<string, number[]> = {};
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/daemon/")) return;
    requests.push(path);
    requestStartedAt.set(request, performance.now());
  });
  page.on("response", (response) => {
    const startedAt = requestStartedAt.get(response.request());
    if (startedAt === undefined) return;
    const path = new URL(response.url()).pathname;
    const durations = responseDurationsMs[path] ?? [];
    durations.push(performance.now() - startedAt);
    responseDurationsMs[path] = durations;
  });

  const navigationStartedAt = performance.now();
  await page.goto("/");
  await expect(page.locator(".optional-reflections")).toBeVisible();
  await expect.poll(() => requests).toContain("/api/daemon/profile/reflections");
  const navigationDurationMs = performance.now() - navigationStartedAt;

  const telemetryResponse = await page.request.get("/api/daemon/test/profile-navigation-telemetry");
  expect(telemetryResponse.ok()).toBe(true);
  const telemetry: unknown = await telemetryResponse.json();
  expect(telemetry).toEqual({
    profileGets: 1,
    reflectionsGets: 1,
    ownerNoteGets: 0,
    reflectionRefreshes: 0,
  });
  expect(requests.filter((path) => path === "/api/daemon/profile/reflections")).toHaveLength(1);
  expect(responseDurationsMs["/api/daemon/profile/reflections"]?.[0]).toBeGreaterThanOrEqual(0);
  console.info(
    "[profile-navigation-browser-fixture]",
    JSON.stringify({
      navigationDurationMs,
      browserRequests: requests,
      responseDurationsMs,
      daemonTelemetry: telemetry,
    }),
  );
});

test("optional reflections refresh without randomUUID while retaining a cryptographic cancellation capability", async ({
  page,
}) => {
  let refreshBody: { batchId: string; requestId: string; cancellationCapability: string } | undefined;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/profile/reflections/refresh")) {
      refreshBody = request.postDataJSON() as typeof refreshBody;
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  });
  await page.goto("/");
  expect(await page.evaluate(() => [typeof crypto.randomUUID, typeof crypto.getRandomValues])).toEqual([
    "undefined",
    "function",
  ]);
  const reflections = page.locator(".optional-reflections");
  await reflections.getByRole("button", { name: "Refresh reflections" }).click();
  await reflections.getByRole("button", { name: "Acknowledge and refresh" }).click();
  await expect(reflections.locator(".reflection-live")).toContainText("Refreshing");
  expect(refreshBody).toBeDefined();
  expect(refreshBody?.batchId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(refreshBody?.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(refreshBody?.cancellationCapability).toMatch(/^[0-9a-f]{64}$/);
});

test("disclosure focus, delayed typed progress, cancellation, settings, deletion, and unavailable streaming feedback remain keyboard accessible", async ({
  page,
}) => {
  await page.goto("/");
  const reflections = page.locator(".optional-reflections");
  await reflections.getByRole("button", { name: "Refresh reflections" }).click();
  const dialog = reflections.getByRole("dialog");
  await expect(dialog).toContainText("fixture-provider");
  await expect(dialog).toContainText("at most 6 provider inference round trips");
  await expect(dialog.getByRole("button", { name: "Leave without sending" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Acknowledge and refresh" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Leave without sending" })).toBeFocused();
  await dialog.getByRole("button", { name: "Acknowledge and refresh" }).press("Enter");
  await expect(reflections.getByRole("button", { name: "Cancel refresh" }).first()).toBeVisible();
  await expect(reflections.locator(".reflection-status").first()).toContainText(
    "Refreshing reflection",
  );
  await expect(reflections.locator(".reflection-live")).toContainText("Retrieving evidence");
  await reflections.getByRole("button", { name: "Cancel refresh" }).first().click();
  await expect(reflections.locator(".reflection-live")).toContainText("Refresh cancelled");

  await reflections.getByRole("button", { name: "Disable question" }).first().click();
  await expect(reflections.getByRole("heading", { level: 4 })).toHaveCount(2);
  const disabledQuestion = reflections.getByRole("checkbox").first();
  await expect(disabledQuestion).not.toBeChecked();
  await disabledQuestion.click();
  await expect(disabledQuestion).toBeChecked();
  await expect(reflections.getByRole("heading", { level: 4 })).toHaveCount(3);
  page.once("dialog", (dialog) => dialog.accept());
  await reflections.getByRole("button", { name: "Delete all reflections" }).click();
  await expect(reflections.locator(".reflection-live")).toContainText(
    "All reflection output was deleted",
  );
  const targets = await reflections.locator("button:enabled").evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  expect(targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
});

test("answered and abstained results render as distinct daemon-owned outcomes", async ({
  page,
}) => {
  await reflectionFixture(page, "answered");
  await page.goto("/");
  const reflections = page.locator(".optional-reflections");
  await expect(reflections).toContainText("Quick setup recurs in owner testimony");
  await expect(
    reflections.getByRole("link", { name: /Owner testimony: Owner note for Atlas Equal/ }),
  ).toHaveAttribute("href", "/games/game-1");
  await expect(
    reflections.getByRole("link", { name: /Deterministic evidence: Current fitness score/ }),
  ).toHaveAttribute("href", "/games/game-1");
  page.once("dialog", (dialog) => dialog.accept());
  await reflections.getByRole("button", { name: "Delete all reflections" }).click();
  await expect(reflections).not.toContainText("Quick setup recurs in owner testimony");

  await reset(page);
  await reflectionFixture(page, "abstained");
  await page.reload();
  await expect(reflections).toContainText("Unable to provide a reflection");
  await expect(reflections).toContainText("No current owner testimony is available");
});

test("stale output remains collapsed and exposes captured citation snapshots only after disclosure", async ({
  page,
}) => {
  await reflectionFixture(page, "stale");
  await page.goto("/");
  const card = page.locator(".reflection-card").first();
  await reflectionFixture(page, "mutate-current");
  const currentGame = await page.request.get("/api/daemon/games/game-1");
  expect(await currentGame.text()).toContain("Changed current game evidence");
  await expect(card).toContainText("Previous reflection is stale because metadata changed");
  await expect(card).not.toContainText("Quick setup recurs in owner testimony");
  await card.getByRole("button", { name: "Show previous stale reflection" }).click();
  await expect(card).toContainText("Quick setup recurs in owner testimony");
  await expect(
    card.getByRole("link", { name: /Owner testimony: Owner note for Atlas Equal/ }),
  ).toHaveAttribute("href", "#reflection-citation-note-1");
  await expect(card.locator("#reflection-citation-note-1")).toContainText(
    "Captured evidence snapshot",
  );
  await expect(card.locator("#reflection-citation-note-1")).toContainText(
    "Owner note for Atlas Equal",
  );
});

test("malformed reflection data and a configuration race stay isolated from deterministic Profile", async ({
  page,
}) => {
  await reflectionFixture(page, "malformed");
  await page.goto("/");
  await expect(page.locator(".profile-question").first()).toBeVisible();
  const reflections = page.locator(".optional-reflections");
  await expect(reflections).toContainText("Optional reflections are unavailable");
  await expect(reflections.getByRole("button", { name: "Try again" })).toBeVisible();

  await reset(page);
  await page.reload();
  await reflectionFixture(page, "configuration-race");
  await reflections.getByRole("button", { name: "Refresh reflections" }).click();
  await reflections.getByRole("button", { name: "Acknowledge and refresh" }).click();
  await expect(reflections.locator(".reflection-live")).toContainText("model-configuration");
  await expect(page.locator(".profile-question").first()).toBeVisible();
});

test("note purge and browser disconnect remove derived output while preserving deterministic Profile", async ({
  page,
}) => {
  await reflectionFixture(page, "answered");
  await page.goto("/");
  const reflections = page.locator(".optional-reflections");
  await expect(reflections).toContainText("Quick setup recurs in owner testimony");
  await reflectionFixture(page, "purge-note");
  await page.reload();
  await expect(reflections).toContainText("Previous output was removed: note-changed");
  await expect(reflections).not.toContainText("Quick setup recurs in owner testimony");

  await reset(page);
  await page.reload();
  await reflections.getByRole("button", { name: "Refresh reflections" }).click();
  await reflections.getByRole("button", { name: "Acknowledge and refresh" }).click();
  await expect(reflections.getByRole("button", { name: "Cancel refresh" }).first()).toBeVisible();
  await page.reload();
  await expect(reflections).toContainText("The last refresh was cancelled");
  await expect(page.locator(".profile-question").first()).toBeVisible();
});

test("a second refresh cannot replace the active cancellation capability", async ({ page }) => {
  const refreshRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/profile/reflections/refresh")) {
      refreshRequests.push(request.postData() ?? "");
    }
  });
  await page.goto("/");
  const reflections = page.locator(".optional-reflections");
  await reflections.getByRole("button", { name: "Refresh reflections" }).click();
  await reflections.getByRole("button", { name: "Acknowledge and refresh" }).click();
  const globalRefresh = reflections.getByRole("button", { name: "Refresh reflections" });
  await expect(globalRefresh).toBeDisabled();
  await expect(reflections.getByRole("checkbox").first()).toBeDisabled();
  expect(refreshRequests).toHaveLength(1);
  await reflections.getByRole("button", { name: "Cancel refresh" }).first().click();
  await expect(reflections).toContainText("The last refresh was cancelled");
  expect(refreshRequests).toHaveLength(1);
});

test("native Chromium 200 percent page zoom records reflection width evidence", async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Native zoom runs once from the desktop project",
  );
  const zoomLevel = Math.log(2) / Math.log(1.2);
  mkdirSync("/tmp/opencode", { recursive: true });
  const userDataDir = mkdtempSync("/tmp/opencode/shelf-judge-reflections-zoom-");
  let context: BrowserContext | undefined;
  try {
    mkdirSync(`${userDataDir}/Default`);
    writeFileSync(
      `${userDataDir}/Default/Preferences`,
      JSON.stringify({ partition: { default_zoom_level: { x: zoomLevel } } }),
    );
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: browser.browserType().executablePath(),
      headless: true,
      viewport: null,
      baseURL: webUrl,
      args: ["--window-size=1440,900", "--window-position=0,0"],
    });
    const settingsPage = context.pages()[0] ?? (await context.newPage());
    await settingsPage.goto("chrome://settings/?search=Page%20zoom");
    const zoomControl = settingsPage.getByRole("combobox", { name: "Page zoom" });
    await expect(zoomControl).toBeVisible();
    await expect(zoomControl.locator("option:checked")).toHaveText("200%");
    const visibleZoomSetting = (await zoomControl.inputValue()).trim();
    expect(Number(visibleZoomSetting)).toBe(2);
    await testInfo.attach("reflection-native-page-zoom-visible-setting", {
      body: await settingsPage.screenshot(),
      contentType: "image/png",
    });
    const page = await context.newPage();
    await reset(page);
    await page.goto("/");
    const metrics = await page.evaluate((visibleZoomSetting) => {
      const region = document.querySelector(".optional-reflections");
      return {
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        reflectionClientWidth: region?.clientWidth ?? 0,
        reflectionScrollWidth: region?.scrollWidth ?? 0,
        visibleZoomSetting,
        devicePixelRatio: window.devicePixelRatio,
      };
    }, visibleZoomSetting);
    expect(Number(metrics.visibleZoomSetting)).toBe(2);
    expect(metrics.outerWidth).toBe(1440);
    expect(metrics.outerHeight).toBe(900);
    expect(metrics.devicePixelRatio).toBe(2);
    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
    expect(metrics.reflectionScrollWidth).toBeLessThanOrEqual(metrics.reflectionClientWidth + 1);
    const refresh = page.getByRole("button", { name: "Refresh reflections" });
    await refresh.focus();
    await expect(refresh).toBeFocused();
    const target = await refresh.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    await refresh.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await testInfo.attach("reflection-native-page-zoom-200-percent-evidence", {
      body: JSON.stringify({ pageZoom: "200%", ...metrics }, null, 2),
      contentType: "application/json",
    });
  } finally {
    await context?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
