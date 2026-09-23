import { expect, test as base, type Browser, type Locator, type Page } from "@playwright/test";
import { webUrl } from "./web-url";

const EXPECTED_CHROMIUM_VERSION = "151.0.7922.34";
const EXPECTED_CHROMIUM_REVISION = "chromium-1234";
const featureRoots = [".profile-page", ".intention-panel", ".intention-history"];

interface NetworkEvidence {
  externalRequests: string[];
  mutationPaths: string[];
}

const test = base.extend<{ networkEvidence: NetworkEvidence }>({
  networkEvidence: [
    async ({ page }, use) => {
      const evidence: NetworkEvidence = { externalRequests: [], mutationPaths: [] };
      await page.route("**/*", async (route) => {
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
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          request.method() !== "GET" &&
          url.pathname.startsWith("/api/daemon/") &&
          url.pathname !== "/api/daemon/test/reset"
        ) {
          evidence.mutationPaths.push(url.pathname);
        }
      });
      await use(evidence);
      expect(evidence.externalRequests).toEqual([]);
    },
    { auto: true },
  ],
});

async function reset(page: Page, scenario: string): Promise<void> {
  const response = await page.request.post("/api/daemon/test/reset", { data: { scenario } });
  expect(response.ok()).toBe(true);
}

interface AttentionFixtureTelemetry {
  profileGets: number;
  configGets: number;
  configPuts: number;
  configPutBodies: Array<Record<string, unknown>>;
  configLimit: number;
  commandBodies: Array<{ method: string; path: string; body: Record<string, unknown> }>;
  suppressedGameIds: string[];
  receipts: Array<Record<string, unknown>>;
}

async function attentionFixtureTelemetry(page: Page): Promise<AttentionFixtureTelemetry> {
  const response = await page.request.get("/api/daemon/test/attention-state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as AttentionFixtureTelemetry;
}

async function applyProjectViewport(page: Page, projectName: string): Promise<void> {
  if (projectName.includes("200-percent")) {
    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio,
      deviceWidth: window.innerWidth * window.devicePixelRatio,
      deviceHeight: window.innerHeight * window.devicePixelRatio,
      mobileReflow: matchMedia("(max-width: 760px)").matches,
      cssZoom: document.documentElement.style.zoom,
    }));
    expect(metrics).toEqual({
      innerWidth: 720,
      devicePixelRatio: 2,
      deviceWidth: 1440,
      deviceHeight: 900,
      mobileReflow: true,
      cssZoom: "",
    });
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const measurements = await page.evaluate((selectors) => {
    const elements = new Set<Element>([document.documentElement, document.body]);
    for (const selector of selectors) {
      for (const root of document.querySelectorAll(selector)) {
        for (const descendant of root.querySelectorAll("*")) {
          const style = getComputedStyle(descendant);
          // Screen-reader text is intentionally clipped; local scroll regions remain usable.
          if (
            descendant.closest(".sr-only") === null &&
            style.overflowX !== "auto" &&
            style.overflowX !== "scroll"
          ) {
            elements.add(descendant);
          }
        }
        let current: Element | null = root;
        while (current !== null) {
          elements.add(current);
          current = current.parentElement;
        }
      }
    }
    return Array.from(elements).map((element) => ({
      element:
        element === document.documentElement
          ? "html"
          : element === document.body
            ? "body"
            : `${element.tagName.toLowerCase()}.${Array.from(element.classList).join(".")}`,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
  }, featureRoots);
  expect(
    measurements.filter(({ scrollWidth, clientWidth }) => scrollWidth > clientWidth + 1),
  ).toEqual([]);
  const outOfBounds = await page.locator(featureRoots.join(", ")).evaluateAll((roots) => {
    const elements = roots.flatMap((root) => [root, ...Array.from(root.querySelectorAll("*"))]);
    return elements
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0;
      })
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > window.innerWidth + 1;
      })
      .map((element) => ({
        element: `${element.tagName.toLowerCase()}.${Array.from(element.classList).join(".")}`,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        viewportWidth: window.innerWidth,
      }));
  });
  expect(outOfBounds).toEqual([]);
}

async function expectVisibleFocus(page: Page, control: Locator): Promise<void> {
  for (
    let index = 0;
    index < 60 && !(await control.evaluate((element) => element === document.activeElement));
    index += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(control).toBeFocused();
  const focus = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(focus.style).not.toBe("none");
  expect(focus.width).toBeGreaterThanOrEqual(2);
}

async function expectHydrated(control: Locator): Promise<void> {
  await expect
    .poll(() =>
      control.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps")),
      ),
    )
    .toBe(true);
}

async function expectMinimumTargets(page: Page): Promise<void> {
  const undersized = await page
    .locator(featureRoots.map((root) => `${root} :is(a, button, input, select)`).join(", "))
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const control = element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement;
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            !control.disabled &&
            rect.width > 0 &&
            rect.height > 0 &&
            (rect.width < 44 || rect.height < 44)
          );
        })
        .map((element) => ({
          text: element.textContent?.trim(),
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })),
    );
  expect(undersized).toEqual([]);
}

async function overviewEntityNames(page: Page): Promise<string[]> {
  return page
    .locator('.profile-class[data-result="supported"] .profile-entity-summary-heading strong')
    .allTextContents();
}

async function expectUnscaledTarget(locator: Locator): Promise<void> {
  const dimensions = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      minWidth: getComputedStyle(element).minWidth,
      minHeight: getComputedStyle(element).minHeight,
    };
  });
  expect(dimensions.minWidth).toBe("44px");
  expect(dimensions.minHeight).toBe("44px");
  expect(dimensions.width).toBeGreaterThanOrEqual(44);
  expect(dimensions.height).toBe(44);
}

function expectPinnedChromium(browser: Browser): void {
  expect(browser.version()).toBe(EXPECTED_CHROMIUM_VERSION);
  expect(browser.browserType().executablePath()).toContain(EXPECTED_CHROMIUM_REVISION);
}

function luminance([red, green, blue]: number[]): number {
  const channels = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function rgb(value: string): number[] {
  const channels = value
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (channels === undefined || channels.length !== 3)
    throw new Error(`Unsupported color ${value}`);
  return value.startsWith("color(srgb") ? channels.map((channel) => channel * 255) : channels;
}

async function expectAaContrast(page: Page, selectors: string[]): Promise<void> {
  const pairs = await page.evaluate((requestedSelectors) => {
    function opaqueBackground(element: Element): string {
      let current: Element | null = element;
      while (current !== null) {
        const background = getComputedStyle(current).backgroundColor;
        if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent") return background;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    }
    return requestedSelectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      return element === null
        ? []
        : [
            {
              selector,
              foreground: getComputedStyle(element).color,
              background: opaqueBackground(element),
            },
          ];
    });
  }, selectors);
  expect(pairs).toHaveLength(selectors.length);
  for (const pair of pairs) {
    const foreground = luminance(rgb(pair.foreground));
    const background = luminance(rgb(pair.background));
    const ratio =
      (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    expect(
      ratio,
      `${pair.selector}: ${pair.foreground} on ${pair.background}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
}

async function expectAllTextContrast(page: Page, rootSelector: string): Promise<void> {
  const pairs = await page.locator(rootSelector).evaluate((root) => {
    function opaqueBackground(element: Element): string {
      let current: Element | null = element;
      while (current !== null) {
        const background = getComputedStyle(current).backgroundColor;
        if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent") return background;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    }
    return Array.from(root.querySelectorAll("*"))
      .filter((element) => {
        const style = getComputedStyle(element);
        const hasDirectText = Array.from(element.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== "",
        );
        return hasDirectText && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          element: `${element.tagName.toLowerCase()}.${Array.from(element.classList).join(".")}: ${element.textContent?.trim().slice(0, 80)}`,
          foreground: style.color,
          background: opaqueBackground(element),
          fontSize: parseFloat(style.fontSize),
          fontWeight: parseInt(style.fontWeight, 10),
        };
      });
  });
  for (const pair of pairs) {
    const foreground = luminance(rgb(pair.foreground));
    const background = luminance(rgb(pair.background));
    const ratio =
      (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    const largeText = pair.fontSize >= 24 || (pair.fontSize >= 18.66 && pair.fontWeight >= 700);
    expect(
      ratio,
      `${pair.element}: ${pair.foreground} on ${pair.background}`,
    ).toBeGreaterThanOrEqual(largeText ? 3 : 4.5);
  }
}

test.describe("useful profile responsive release gate", () => {
  test("runs the pinned current Chromium revision", ({ browser }) => {
    expectPinnedChromium(browser);
  });

  test("overview preserves identity and attention evidence", async ({
    page,
    browser,
  }, testInfo) => {
    expectPinnedChromium(browser);
    await reset(page, "profile");
    await page.goto("/");
    await applyProjectViewport(page, testInfo.project.name);

    const settingsDisclosure = page.locator(".nav-disclosure");
    await expect(settingsDisclosure).not.toHaveAttribute("open");
    const openNavigation = page.getByRole("button", { name: "Open navigation" });
    if (await openNavigation.isVisible()) await openNavigation.click();
    await settingsDisclosure.locator("summary").click();
    await expect(settingsDisclosure).toHaveAttribute("open", "");
    await expect(settingsDisclosure.getByRole("link", { name: "General" })).toBeVisible();
    const closeNavigation = page.getByRole("button", { name: "Close navigation" });
    if (await closeNavigation.isVisible()) await closeNavigation.click();

    await expect(page.getByRole("heading", { level: 1, name: "Collection Profile" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(2);
    const attentionCards = page.locator(".attention-card");
    await expect(attentionCards).toHaveCount(1);
    await expect(page.getByText("Worker Placement", { exact: true }).first()).toBeVisible();
    expect(await overviewEntityNames(page)).toEqual([
      "Worker Placement",
      "Worker Placement Variant 001",
      "Worker Placement Variant 002",
    ]);
    await expect(page.getByText("Solo", { exact: true })).toHaveCount(0);
    const overviewCards = page.locator(
      '.profile-class[data-result="supported"] .profile-entity-summary',
    );
    await expect(overviewCards).toHaveCount(3);
    for (const card of await overviewCards.all()) {
      await expect(card.getByText("Adjusted fit", { exact: true })).toBeVisible();
      await expect(card.locator("dt")).toHaveText([
        "Raw mean",
        "Class comparator",
        "Associated games",
      ]);
    }
    await expect(page.getByRole("link", { name: "View all mechanics and evidence" })).toBeVisible();
    const telemetryBeforeView = await attentionFixtureTelemetry(page);
    const attentionEvidence = page.locator(".attention-card details");
    await expect(attentionEvidence).not.toHaveAttribute("open");
    await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Supplied actions" })).toBeHidden();
    await attentionEvidence
      .locator("summary")
      .getByText("Evidence, score, and supplied actions", { exact: true })
      .click();
    await expect(attentionEvidence).toHaveAttribute("open", "");
    await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Score explanation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Supplied actions" })).toBeVisible();
    await expect(page.locator(".attention-card details ul li")).toHaveCount(5);
    const requiredText = await page.locator(".profile-page").innerText();
    await page.locator(".attention-card").hover();
    expect(await page.locator(".profile-page").innerText()).toBe(requiredText);
    const telemetryAfterView = await attentionFixtureTelemetry(page);
    expect(telemetryAfterView.profileGets).toBe(telemetryBeforeView.profileGets);
    expect(telemetryAfterView.commandBodies).toEqual([]);
    expect(telemetryAfterView.suppressedGameIds).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await expectMinimumTargets(page);
    if (testInfo.project.name.includes("200-percent")) {
      await expectUnscaledTarget(page.locator(".profile-actions .btn").first());
    }
    await expectVisibleFocus(
      page,
      page.getByRole("link", { name: "View all mechanics and evidence" }),
    );
    await expectAaContrast(page, [
      ".profile-page",
      ".profile-status-label",
      ".profile-warning",
      ".profile-actions .btn-primary",
      ".profile-actions .btn-secondary",
    ]);
    await expectAllTextContrast(page, ".profile-page");
  });

  test("six daemon-supplied ranked cards reflow in received order across desktop and mobile widths", async ({
    page,
  }, testInfo) => {
    await reset(page, "ranked-attention");
    await page.goto("/");
    await applyProjectViewport(page, testInfo.project.name);
    const cards = page.locator(".attention-card");
    await expect(cards).toHaveCount(6);
    await expect(page.locator(".attention-game-image")).toHaveCount(5);
    await expect(page.locator(".attention-game-fallback")).toHaveCount(6);
    await expect(cards.nth(1).locator(".attention-game-art")).toBeVisible();
    await expect(cards.first().locator(".attention-game-title")).toHaveText("Ranked decision 1");
    expect(
      await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.querySelector("h3")?.textContent),
      ),
    ).toEqual(
      Array.from({ length: 6 }, (_, index) => `Question for ranked decision ${index + 1}?`),
    );
    expect(
      await cards.evaluateAll((nodes) => nodes.map((node) => node.querySelector("p")?.textContent)),
    ).toEqual(Array.from({ length: 6 }, (_, index) => `Daemon-supplied reason ${index + 1}.`));
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.id))).toEqual(
      Array.from(
        { length: 6 },
        (_, index) =>
          `attention:55000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}:explicit-intention`,
      ),
    );
    const columns = await page
      .locator(".attention-list")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(
      testInfo.project.name.includes("mobile") || testInfo.project.name.includes("200-percent")
        ? 1
        : 3,
    );
    const tops = await cards.evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
    );
    await expectNoHorizontalOverflow(page);
    await expectMinimumTargets(page);
    if (columns === 3) {
      expect(tops[0]).toBe(tops[1]);
      expect(tops[1]).toBe(tops[2]);
      expect(tops[3]).toBe(tops[4]);
      expect(tops[4]).toBe(tops[5]);
      expect(tops[3]).toBeGreaterThan(tops[0]);
    } else {
      expect(tops[1]).toBeGreaterThan(tops[0]);
    }
  });

  test("ranked intention management destination opens the matching game and control", async ({
    page,
  }) => {
    await reset(page, "ranked-attention");
    await page.goto("/");
    const firstCard = page.locator(".attention-card").first();
    const managementLink = firstCard.getByRole("link", {
      name: "resolve-intention for Ranked decision 1",
    });
    await expect(managementLink).toHaveAttribute(
      "href",
      "/games/55000000-0000-4000-8000-000000000001",
    );
    await Promise.all([
      page.waitForURL("**/games/55000000-0000-4000-8000-000000000001"),
      managementLink.click(),
    ]);
    await expect(page.getByRole("heading", { level: 1, name: "Ranked decision 1" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mark complete from personal knowledge" }),
    ).toBeVisible();
  });

  for (const operation of ["not-now", "intentional"] as const) {
    test(`relays ${operation} command and reconciles from the daemon receipt`, async ({ page }) => {
      await reset(page, "ranked-attention");
      await page.goto("/");
      const firstCard = page.locator(".attention-card").first();
      await expect(firstCard).toContainText("Ranked decision 1");
      const buttonName = operation === "not-now" ? "Not now" : "I’ll keep this in mind";
      const [commandRequest] = await Promise.all([
        page.waitForRequest(
          (request) =>
            request.method() === "POST" &&
            new URL(request.url()).pathname === `/api/daemon/profile/attention/${operation}`,
        ),
        firstCard.getByRole("button", { name: buttonName, exact: true }).click(),
      ]);
      const command = commandRequest.postDataJSON() as Record<string, unknown>;
      expect(command).toEqual({
        commandId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        operation,
        gameId: "55000000-0000-4000-8000-000000000001",
        ruleId: "explicit-intention",
        ruleVersion: 1,
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        expectedVersion: 0,
      });
      await expect(page.locator(".attention-card")).toHaveCount(5);
      await expect(page.locator(".attention-card").first()).toContainText("Ranked decision 2");
      const telemetry = await attentionFixtureTelemetry(page);
      expect(telemetry.commandBodies).toEqual([
        { method: "POST", path: `/api/profile/attention/${operation}`, body: command },
      ]);
      expect(telemetry.suppressedGameIds).toEqual(["55000000-0000-4000-8000-000000000001"]);
      expect(telemetry.profileGets).toBeGreaterThanOrEqual(2);
      expect(telemetry.receipts).toHaveLength(1);
      expect(telemetry.receipts[0]).toMatchObject({
        receiptType: "attention-disposition",
        commandId: command.commandId,
        operation,
        gameId: command.gameId,
        requestPayload: command,
        accepted: { gameId: command.gameId, ruleId: "explicit-intention", version: 1 },
      });
    });
  }

  test("settings persist the daemon-validated cap and change the visible ranked slice", async ({
    page,
  }) => {
    await reset(page, "ranked-attention");
    await page.goto("/settings");
    const limit = page.getByLabel("Profile attention cards");
    await expect(limit).toHaveValue("6");
    const telemetryBeforeSave = await attentionFixtureTelemetry(page);
    const invalidResponse = await page.request.put("/api/daemon/config", {
      data: { profileAttentionCardLimit: 25 },
    });
    expect(invalidResponse.status()).toBe(400);
    await expect(invalidResponse).not.toBeOK();
    const invalidBody = (await invalidResponse.json()) as { error: string };
    expect(invalidBody.error).toContain("integer from 0 to 24");
    await expect(limit).toHaveValue("6");
    await limit.fill("2");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Attention card limit saved.");
    const telemetryAfterSave = await attentionFixtureTelemetry(page);
    expect(telemetryAfterSave.configLimit).toBe(2);
    expect(telemetryAfterSave.configPuts - telemetryBeforeSave.configPuts).toBe(2);
    expect(
      telemetryAfterSave.configPutBodies.slice(telemetryBeforeSave.configPutBodies.length),
    ).toEqual([{ profileAttentionCardLimit: 25 }, { profileAttentionCardLimit: 2 }]);
    expect(telemetryBeforeSave.configGets).toBeGreaterThan(0);
    await page.goto("/");
    const cards = page.locator(".attention-card");
    await expect(cards).toHaveCount(2);
    expect(
      await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.textContent?.match(/Ranked decision \d+/)?.[0]),
      ),
    ).toEqual(["Ranked decision 1", "Ranked decision 2"]);
  });

  test("entity explorer and axis diagnostics remain keyboard operable", async ({
    page,
  }, testInfo) => {
    await reset(page, "profile");
    await page.goto("/profile/entities");
    await applyProjectViewport(page, testInfo.project.name);

    await expect(page.getByRole("link", { name: "Mechanics 168" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(".entity-index-row")).toHaveCount(168);
    await expect(page.locator(".entity-evidence")).toHaveCount(1);
    const order = page.getByLabel("Order", { exact: true });
    await expect(order).toHaveValue("bestFit");
    await expect(order.locator("option")).toHaveText([
      "Adjusted fit",
      "Associated game count (diagnostic)",
      "Name",
    ]);
    await expect(page.locator(".entity-index-row").first()).toContainText("Solo");
    await expect(page.locator(".entity-index-row").nth(1)).toContainText("Worker Placement");
    const soloEvidence = page.locator(".entity-evidence");
    await expect(soloEvidence.getByRole("heading", { name: "Solo", exact: true })).toBeVisible();
    await expect(soloEvidence).toHaveAttribute("data-support", "limited");
    await expect(soloEvidence.locator("dt").nth(0)).toHaveText("Adjusted fit");
    await expect(soloEvidence.locator("dt").nth(1)).toHaveText("Raw mean current fitness");
    await expect(soloEvidence.locator("dd").nth(0)).toHaveText("5.5");
    await expect(soloEvidence.locator("dd").nth(1)).toHaveText("8.0");
    await expect(soloEvidence).toContainText(
      "remains available only in the drilldown until it reaches the configured support count of 3",
    );

    const legacyUrl = new URL("/profile/entities", page.url());
    legacyUrl.searchParams.set("class", "mechanic");
    legacyUrl.searchParams.set("order", "rating");
    legacyUrl.searchParams.set("support", "limited");
    legacyUrl.searchParams.set("q", "Solo");
    legacyUrl.searchParams.append("trace", "first");
    legacyUrl.searchParams.append("trace", "second");
    await page.goto(legacyUrl.toString());
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return {
          pathname: url.pathname,
          order: url.searchParams.get("order"),
          class: url.searchParams.get("class"),
          support: url.searchParams.get("support"),
          query: url.searchParams.get("q"),
          trace: url.searchParams.getAll("trace"),
        };
      })
      .toEqual({
        pathname: "/profile/entities",
        order: null,
        class: "mechanic",
        support: "limited",
        query: "Solo",
        trace: ["first", "second"],
      });
    await expect(page.getByLabel("Order", { exact: true })).toHaveValue("bestFit");
    await page.goto("/profile/entities");

    await page.getByRole("link", { name: "Designers 0" }).click();
    await expect(page).toHaveURL(/class=designer$/);
    await expect(page.getByText("Complete metadata contains no associations")).toBeVisible();
    await page.getByRole("link", { name: "Mechanics 168" }).click();

    await page.getByLabel("Find an entity or supporting game").fill("Variant 010");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/class=mechanic&q=Variant\+010/);
    await expect(page.locator(".entity-index-row")).toHaveCount(1);
    await page.goto("/profile/entities");

    await page.getByLabel("Find an entity or supporting game").fill("No matching entity");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.locator(".entity-filtered-empty")).toContainText(
      "No entities match the current search and evidence filter.",
    );
    await page.getByRole("link", { name: "Clear search and filters" }).click();
    await expect(page.locator(".entity-index-row")).toHaveCount(168);

    await page.getByLabel("Evidence", { exact: true }).selectOption("supported");
    await page.getByRole("button", { name: "Apply evidence filter" }).click();
    await expect(page).toHaveURL(/class=mechanic&support=supported/);
    await expect(page.locator(".entity-index-row")).toHaveCount(167);

    await expectVisibleFocus(page, order);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await expect(order).toHaveValue("support");
    await page.keyboard.press("Tab");
    const applyOrder = page.getByRole("button", { name: "Apply order" });
    await expect(applyOrder).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/order=support/);
    await applyProjectViewport(page, testInfo.project.name);
    await expect(page.locator(".entity-index-row").first()).toContainText("Worker Placement");

    await Promise.all([
      page.waitForURL((url) => url.pathname === "/" && url.search === ""),
      page.getByRole("link", { name: "Back to profile" }).click(),
    ]);
    await expect(page.getByRole("heading", { level: 1, name: "Collection Profile" })).toBeVisible();
    await expect(
      page.locator('.profile-class[data-result="supported"] .profile-entity-summary'),
    ).toHaveCount(3);
    expect(await overviewEntityNames(page)).toEqual([
      "Worker Placement",
      "Worker Placement Variant 001",
      "Worker Placement Variant 002",
    ]);
    await page.getByRole("link", { name: "View all mechanics and evidence" }).click();
    await expect(page).toHaveURL(/class=mechanic$/);
    await page.getByLabel("Evidence", { exact: true }).selectOption("supported");
    await page.getByRole("button", { name: "Apply evidence filter" }).click();
    await page.getByLabel("Order", { exact: true }).selectOption("support");
    await page.getByRole("button", { name: "Apply order" }).click();

    const selected = page.getByRole("link", { name: /Worker Placement Variant 001/ });
    await selected.click();
    await expect(page).toHaveURL(/class=mechanic.*entity=1000.*order=support.*support=supported/);
    const selectedHeading = page.getByRole("heading", { name: "Worker Placement Variant 001" });
    await expect(selectedHeading).toBeVisible();
    await expect(selectedHeading).toBeFocused();
    if (
      testInfo.project.name.includes("desktop") &&
      !testInfo.project.name.includes("200-percent")
    ) {
      await expect(page.locator(".entity-index")).toBeVisible();
    } else {
      await expect(page.locator(".entity-index")).toBeHidden();
      const back = page.getByRole("link", { name: "Back to Mechanics results" });
      await expect(back).toBeVisible();
      await back.click();
      await expect(page.locator(".entity-index")).toBeVisible();
      await expect(page.locator("#entity-1000")).toBeFocused();
      await page.locator("#entity-1000").click();
      await expect(selectedHeading).toBeFocused();
    }

    const classEvidence = page.getByText("Review class evidence", { exact: true });
    await classEvidence.click();
    await expect(page.getByText("Eligible collection comparator", { exact: false })).toBeVisible();
    await expect(page.getByText("Exclusions (1)")).toBeVisible();
    await expect(page.getByText("Refresh warnings (0)")).toBeVisible();
    await expect(page.getByText("Vetoed; displayed as 0").first()).toBeHidden();
    await page.getByText("Eligible games (3)").click();
    await expect(page.getByText("Vetoed; displayed as 0").first()).toBeVisible();
    await page.evaluate(() => localStorage.setItem("shelf-judge-theme", "dark"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const entityExplorer = page.locator(".entity-explorer:visible").first();
    const entityEvidence = page.locator(".entity-evidence:visible").first();
    const explorerText = await entityExplorer.innerText();
    await entityEvidence.hover();
    expect(await entityExplorer.innerText()).toBe(explorerText);
    await expectNoHorizontalOverflow(page);
    await expectMinimumTargets(page);
    if (testInfo.project.name === "chromium-mobile") {
      expect(
        parseFloat(
          await page
            .getByLabel("Find an entity or supporting game")
            .evaluate((element) => getComputedStyle(element).fontSize),
        ),
      ).toBeGreaterThanOrEqual(16);
    }
    await expectAllTextContrast(page, ".entity-evidence");

    await page.goto("/profile/axes");
    await applyProjectViewport(page, testInfo.project.name);
    await expect(page.getByRole("heading", { name: "Enjoyment" })).toBeVisible();
    await expect(page.getByText("Diagnostic distribution, not an identity claim")).toBeVisible();
    await expect(page.locator(".axis-histogram li")).toHaveCount(10);
    const renderedBarHeights = await page
      .locator(".axis-histogram-bar")
      .evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().height));
    expect(renderedBarHeights[5]).toBeCloseTo((renderedBarHeights[1] ?? 0) * 2, 0);
    expect(renderedBarHeights[5]).toBeGreaterThan(renderedBarHeights[1] ?? 0);
    expect(renderedBarHeights[1]).toBeGreaterThan(renderedBarHeights[0] ?? 0);
    expect(renderedBarHeights[0]).toBeGreaterThanOrEqual(2);
    await expectNoHorizontalOverflow(page);
    await expectMinimumTargets(page);
  });

  test("entity explorer GET navigation works without JavaScript", async ({ browser }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-mobile",
      "One no-JavaScript project is sufficient",
    );
    const context = await browser.newContext({
      baseURL: webUrl,
      viewport: { width: 375, height: 812 },
    });
    try {
      const resetPage = await context.newPage();
      await reset(resetPage, "profile");
      await resetPage.close();
      const submitWithoutScripts = async (
        prepare: (page: Page) => Promise<void>,
        submitButton: (page: Page) => Locator,
        expected: (url: URL) => boolean,
      ): Promise<void> => {
        const page = await context.newPage();
        try {
          await page.goto("/profile/entities");
          const closeNavigation = page.getByRole("button", { name: "Close navigation" });
          if (await closeNavigation.isVisible()) await page.keyboard.press("Escape");
          await prepare(page);
          const cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
          const [request] = await Promise.all([
            page.waitForRequest(
              (request) =>
                request.isNavigationRequest() &&
                request.method() === "GET" &&
                new URL(request.url()).pathname === "/profile/entities",
            ),
            page.waitForURL((url) => expected(url)),
            submitButton(page).click(),
          ]);
          expect(request.method()).toBe("GET");
          expect(expected(new URL(page.url()))).toBe(true);
          await cdp.detach();
        } finally {
          await page.close();
        }
      };

      await submitWithoutScripts(
        async (page) => {
          await page.getByLabel("Find an entity or supporting game").fill("Variant 010");
        },
        (page) => page.locator(".entity-search-form button[type=submit]"),
        (url) =>
          url.searchParams.get("q") === "Variant 010" &&
          url.searchParams.get("class") === "mechanic",
      );
      await submitWithoutScripts(
        async (page) => {
          await page.getByLabel("Evidence", { exact: true }).selectOption("supported");
        },
        (page) => page.locator(".entity-select-form").nth(0).locator("button[type=submit]"),
        (url) =>
          url.searchParams.get("support") === "supported" &&
          url.searchParams.get("class") === "mechanic",
      );
      await submitWithoutScripts(
        async (page) => {
          await page.getByLabel("Order", { exact: true }).selectOption("name");
        },
        (page) => page.locator(".entity-select-form").nth(1).locator("button[type=submit]"),
        (url) =>
          url.searchParams.get("order") === "name" && url.searchParams.get("class") === "mechanic",
      );

      const classNavigation = await context.newPage();
      try {
        await classNavigation.goto("/profile/entities");
        const cdp = await context.newCDPSession(classNavigation);
        await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
        const designerResponse = await classNavigation.goto("/profile/entities?class=designer");
        expect(designerResponse?.status()).toBe(200);
        expect(designerResponse?.request().method()).toBe("GET");
        expect(new URL(classNavigation.url()).searchParams.get("class")).toBe("designer");
        const selectedResponse = await classNavigation.goto(
          "/profile/entities?class=mechanic&entity=102&order=name",
        );
        expect(selectedResponse?.status()).toBe(200);
        expect(selectedResponse?.request().method()).toBe("GET");
        expect(Object.fromEntries(new URL(classNavigation.url()).searchParams)).toEqual({
          class: "mechanic",
          entity: "102",
          order: "name",
        });
        await cdp.detach();
      } finally {
        await classNavigation.close();
      }
    } finally {
      await context.close();
    }
  });

  test("empty and unavailable are visibly distinct", async ({ page }, testInfo) => {
    await reset(page, "empty");
    await page.goto("/");
    await applyProjectViewport(page, testInfo.project.name);
    await expect(page.locator('[data-attention-state="empty-collection"]')).toContainText(
      "Empty collection",
    );
    await expect(page.getByText("Nothing needs attention right now.")).toHaveCount(0);

    await reset(page, "unavailable");
    await page.goto("/");
    await applyProjectViewport(page, testInfo.project.name);
    await expect(page.locator('[data-profile-state="unavailable"]').first()).toContainText(
      "Identity unavailable",
    );
    await expect(page.getByRole("button", { name: "Retry profile" })).toBeVisible();
    await expect(page.locator('[data-attention-state="empty-collection"]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("game-detail intention browser contracts", () => {
  test("overflow guard accepts the shell and detects overflowing or clipped feature content", async ({
    page,
  }) => {
    await page.setContent(
      '<style>body { margin: 0; overflow: hidden; }</style><section class="intention-panel"><p>Recorded play context</p></section>',
    );
    await expectNoHorizontalOverflow(page);
    await page.locator(".intention-panel p").evaluate((element) => {
      element.style.width = "200vw";
    });
    await expect(expectNoHorizontalOverflow(page)).rejects.toThrow();
    await page.locator(".intention-panel p").evaluate((element) => {
      element.style.width = "40px";
      element.style.whiteSpace = "nowrap";
      element.style.overflow = "hidden";
    });
    await expect(expectNoHorizontalOverflow(page)).rejects.toThrow();
  });

  test("shows neutral dated play history with its observation-relative window", async ({
    page,
  }, testInfo) => {
    await reset(page, "active");
    await page.goto(`/games/${gameId}`);
    await applyProjectViewport(page, testInfo.project.name);
    const context = page.locator(".intention-dated-context");
    await expect(context).toBeVisible();
    await expect(context).toHaveText(
      "Last dated play: 2026-08-26. Recent dated play volume: 3 plays in the 365 days ending 2026-08-28, the BGG /plays observation date.",
    );
    await expectNoHorizontalOverflow(page);
  });
  test("creates without count evidence and completes through the Next daemon proxy", async ({
    page,
    networkEvidence,
  }, testInfo) => {
    await reset(page, "create");
    await page.goto(`/games/${gameId}`);
    await applyProjectViewport(page, testInfo.project.name);

    const create = page.getByRole("button", { name: "Want to play", exact: true });
    await expectHydrated(create);
    await expectVisibleFocus(page, create);
    await create.press("Enter");
    const status = page.locator(".intention-live-status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toContainText("Want to play intention created.");
    await expect(page.locator(".intention-active")).toContainText(
      "No reliable recorded play-count baseline",
    );
    await expect(page.locator(".intention-dated-context")).toContainText(
      "No valid dated plays are available.",
    );
    await expect(status).toBeFocused();

    const complete = page.getByRole("button", { name: "Mark complete from personal knowledge" });
    await expectHydrated(complete);
    await complete.press("Enter");
    await expect(status).toContainText("Intention completed.");
    await expect(status).toBeFocused();
    await expect(page.getByRole("heading", { name: "Resolved play intentions" })).toBeVisible();
    expect(networkEvidence.mutationPaths).toEqual([
      "/api/daemon/games/game-4/intention",
      "/api/daemon/games/game-4/intention/intention-browser-2/complete",
    ]);
    await expectNoHorizontalOverflow(page);
    await expectMinimumTargets(page);
  });

  test("retires and recovers from a stale conflict without blind retry", async ({
    page,
    networkEvidence,
  }, testInfo) => {
    await reset(page, "active");
    await page.goto(`/games/${gameId}`);
    await applyProjectViewport(page, testInfo.project.name);
    const retire = page.getByRole("button", { name: "Retire intention" });
    await expectHydrated(retire);
    await retire.press("Enter");
    const retireStatus = page.locator(".intention-live-status");
    await expect(retireStatus).toHaveAttribute("aria-live", "polite");
    await expect(retireStatus).toContainText("Intention retired.");
    await expect(retireStatus).toBeFocused();
    await expect(retireStatus).toBeVisible();
    await expect(page.getByText("Owner retired")).toBeVisible();

    await reset(page, "stale");
    await page.reload();
    await applyProjectViewport(page, testInfo.project.name);
    let completionRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/complete")) completionRequests += 1;
    });
    const staleComplete = page.getByRole("button", {
      name: "Mark complete from personal knowledge",
    });
    await expectHydrated(staleComplete);
    await staleComplete.press("Enter");
    const status = page.locator(".intention-live-status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status.getByRole("status")).toBeVisible();
    await expect(status).toContainText("Refresh and review");
    await expect(status).toContainText("Shelf Judge will not retry automatically.");
    await expect(status).toBeFocused();
    expect(completionRequests).toBe(1);

    await page.reload();
    await applyProjectViewport(page, testInfo.project.name);
    await expect(page.getByText("Owner confirmed")).toBeVisible();
    const recreate = page.getByRole("button", { name: "Want to play", exact: true });
    await expectHydrated(recreate);
    await recreate.press("Enter");
    await expect(page.locator(".intention-live-status")).toContainText(
      "Want to play intention created.",
    );
    expect(networkEvidence.mutationPaths).toEqual([
      "/api/daemon/games/game-4/intention/intention-browser-1/retire",
      "/api/daemon/games/game-4/intention/intention-browser-1/complete",
      "/api/daemon/games/game-4/intention",
    ]);
    await expectNoHorizontalOverflow(page);
    await expectMinimumTargets(page);
  });

  test("associates field errors and keeps mobile form text and targets accessible", async ({
    page,
  }, testInfo) => {
    await reset(page, "create");
    await page.goto(`/games/${gameId}`);
    await applyProjectViewport(page, testInfo.project.name);
    const correct = page.getByRole("button", { name: "Correct recorded play count" });
    await expectHydrated(correct);
    await correct.press("Enter");
    const input = page.getByLabel("Recorded play count");
    await expect(input).toBeFocused();
    await input.fill("-1");
    await page.getByRole("button", { name: "Save play count" }).press("Enter");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAttribute("aria-describedby", /play-count-error/);
    await expect(page.locator("#play-count-error")).toContainText("nonnegative whole number");
    await expect(input).toBeFocused();
    expect(
      parseFloat(await input.evaluate((element) => getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    await expectMinimumTargets(page);
    await expectNoHorizontalOverflow(page);
    await expectAaContrast(page, [
      ".intention-panel",
      ".intention-warning",
      ".intention-dated-context",
      ".field-error",
      ".play-correction .btn-primary",
      ".play-correction .btn-secondary",
    ]);
    await expectAllTextContrast(page, ".intention-panel");
  });
});

const gameId = "game-4";
