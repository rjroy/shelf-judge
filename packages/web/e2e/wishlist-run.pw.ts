import { expect, test, type Page } from "@playwright/test";

const entries = [
  {
    id: "candidate-1",
    bggId: 8123,
    name: "Sample Garden",
    yearPublished: 2020,
    thumbnailUrl: null,
    predictedScore: 7.2,
    predictionConfidence: "medium",
    predictedBreakdown: null,
    nicheImpact: null,
    redundancyPreview: null,
    addedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "candidate-2",
    bggId: 8456,
    name: "Sample Harbor",
    yearPublished: 2021,
    thumbnailUrl: null,
    predictedScore: 6.8,
    predictionConfidence: "low",
    predictedBreakdown: null,
    nicheImpact: null,
    redundancyPreview: null,
    addedAt: "2026-01-02T00:00:00.000Z",
  },
];

async function wishlistFixture(
  page: Page,
  rejectStart = false,
  activeInitially = false,
  replacementRunId?: string,
  projectionScenario = false,
  delayInitialProjection = false,
) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let active = activeInitially;
  let currentEntries = entries.map((entry) => ({ ...entry }));
  const factualRefreshedIds = new Set<string>();
  let projectionRequestCount = 0;
  await page.route("**/api/daemon/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON() as unknown;
    calls.push({ url: `${url.pathname}${url.search}`, method: request.method(), body });
    let data: unknown = {};
    let status = 200;
    let responseDelayMs = 0;
    if (url.pathname === "/api/daemon/wishlist" && request.method() === "GET")
      data = currentEntries;
    else if (url.pathname === "/api/daemon/wishlist" && request.method() === "DELETE") {
      currentEntries = [];
      data = {};
    } else if (url.pathname === "/api/daemon/wishlist/refresh" && request.method() === "POST") {
      currentEntries = currentEntries.map((entry, index) => ({
        ...entry,
        predictedScore: index === 0 ? 2 : 3,
      }));
      currentEntries.forEach((entry) => factualRefreshedIds.add(entry.id));
      data = { refreshed: currentEntries.length, errors: [] };
    } else if (
      /\/api\/daemon\/wishlist\/[^/]+\/refresh$/.test(url.pathname) &&
      request.method() === "POST"
    ) {
      currentEntries = currentEntries.map((entry) =>
        entry.id === "candidate-1" ? { ...entry, predictedScore: 2 } : entry,
      );
      factualRefreshedIds.add("candidate-1");
      data = { entry: currentEntries.find(({ id }) => id === "candidate-1") };
    } else if (url.pathname === "/api/daemon/wishlist/redundancy") {
      projectionRequestCount += 1;
      responseDelayMs = delayInitialProjection && projectionRequestCount === 1 ? 800 : 0;
      data = currentEntries.map((entry, index) => ({
        entry,
        redundancy: {
          source:
            projectionScenario && !factualRefreshedIds.has(entry.id)
              ? "current"
              : "base-prediction",
          adjustment: null,
          orderingScore:
            projectionScenario && !factualRefreshedIds.has(entry.id)
              ? index === 0
                ? 10
                : 8
              : entry.predictedScore,
        },
      }));
    } else if (url.pathname.endsWith("/refresh-progress"))
      data = {
        coverageMeasurement: "not-measured",
        activity: active
          ? { state: "active", runId: replacementRunId ?? "wishlist-run" }
          : { state: "idle" },
        progress: active
          ? {
              state: "saved",
              relation: "active-run",
              value: {
                state: "last-known-running",
                pairCount: 3,
                completedPairs: 1,
                cacheHits: 1,
                cacheMisses: 2,
                failedPairs: 0,
              },
            }
          : { state: "none" },
      };
    else if (url.pathname.endsWith("/run-preview")) {
      const selected = url.searchParams.getAll("bggId").map(Number);
      const candidates = selected.length ? selected.length : entries.length;
      data = {
        requestId: "preview-1",
        precondition: "frozen-source-1",
        provider: "TypeSafe",
        modelId: "fixture-model",
        eligibleGameCount: candidates,
        pairCount: 3,
        descriptionBearingPairCount: 3,
        noteBearingPairCount: 0,
        noteTransmissionPermitted: false,
        providerConfigured: true,
        signalScope: { description: true, ownerNotes: false },
        scoringEffect: "integrated-fitness",
        retentionCaveat: "The provider may retain submitted descriptions.",
        limits: {
          maxEligiblePairs: 500,
          maxProviderAttempts: 30,
          maxRetriesPerEvaluation: 1,
          maxRunDurationMs: 60000,
          reportedTokenStopThreshold: 5000,
          reportedTokenThresholdIsBilledCeiling: false,
        },
        withinPairLimit: true,
        expiresAt: "2026-12-31T00:00:00.000Z",
        scope: {
          scope: "wishlist",
          wishlistEntryCount: entries.length,
          selectedCandidateCount: candidates,
          unselectedEntryCount: entries.length - candidates,
          ownedOverlapCandidateCount: 0,
          requestedCandidateCount: candidates,
          eligibleCandidateCount: candidates,
          unavailableCandidateCount: 0,
          eligibleOwnedGameCount: 2,
          comparisonPairCount: 4,
          cachedHitPairCount: 1,
          sendablePairCount: 3,
        },
        selection: selected.length ? { kind: "selected", bggIds: selected } : { kind: "all" },
        unavailableCandidateBggIds: [],
      };
    } else if (url.pathname.endsWith("/semantic/run") && request.method() === "POST") {
      if (rejectStart) {
        status = 412;
        data = { error: "Run precondition failed" };
      } else {
        active = true;
        data = { state: "running", runId: "wishlist-run" };
      }
    } else if (url.pathname.endsWith("/semantic/cancel")) {
      active = false;
      data = { state: "cancelled", runId: "wishlist-run" };
    }
    if (responseDelayMs > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, responseDelayMs));
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: responseDelayMs > 0 ? { "x-e2e-projection": "delayed-initial" } : undefined,
      body: JSON.stringify(data),
    });
  });
  return calls;
}

test("prepares and starts an all-candidate wishlist run only after disclosure, then cancels", async ({
  page,
}) => {
  const calls = await wishlistFixture(page);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/wishlist");
  await expect(page.getByRole("heading", { name: "Compare wishlist descriptions" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(calls.filter((call) => call.url === "/api/daemon/wishlist/redundancy")).toHaveLength(1);
  await page.getByRole("button", { name: "Refresh status" }).click();
  expect(calls.filter((call) => call.url === "/api/daemon/wishlist/redundancy")).toHaveLength(1);
  await page.getByRole("button", { name: "Prepare comparison" }).click();
  await expect(page.getByRole("heading", { name: "Review before starting" })).toBeVisible();
  await expect(page.getByText(/3 description comparisons may be sent/)).toBeVisible();
  expect(calls.filter((call) => call.url.includes("run-preview"))).toHaveLength(1);
  expect(calls.find((call) => call.url.includes("run-preview"))?.url).toContain("scope=wishlist");
  expect(calls.some((call) => call.url.endsWith("/semantic/run"))).toBe(false);
  await page.getByRole("button", { name: "Authorize and start" }).click();
  const start = calls.find((call) => call.url.endsWith("/semantic/run"));
  expect(start?.body).toEqual({
    requestId: "preview-1",
    precondition: "frozen-source-1",
    noteTransmissionAuthorized: false,
  });
  await expect(page.getByText(/Wishlist run in progress/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel run" }).click();
  expect(calls.some((call) => call.url.endsWith("/semantic/cancel"))).toBe(true);
});

test("selected candidates are repeated in preparation query and require a fresh explicit start", async ({
  page,
}) => {
  const calls = await wishlistFixture(page);
  await page.goto("/wishlist");
  await page.getByRole("radio", { name: "Choose games" }).check();
  await page.getByRole("checkbox", { name: "Sample Harbor" }).check();
  await page.getByRole("button", { name: "Prepare comparison" }).click();
  await expect(page.getByRole("heading", { name: "Review before starting" })).toBeVisible();
  const preview = calls.find((call) => call.url.includes("run-preview"));
  expect(preview?.url).toContain("scope=wishlist");
  expect(preview?.url).toContain("bggId=8456");
  expect(preview?.url).not.toContain("bggId=8123");
  expect(calls.some((call) => call.url.endsWith("/semantic/run"))).toBe(false);
  await page.getByRole("button", { name: "Authorize and start" }).click();
  expect(calls.some((call) => call.url.endsWith("/semantic/run"))).toBe(true);
});

test("a stale preview is discarded after 412 and never starts automatically", async ({ page }) => {
  const calls = await wishlistFixture(page, true);
  await page.goto("/wishlist");
  await page.getByRole("button", { name: "Prepare comparison" }).click();
  await expect(page.getByRole("heading", { name: "Review before starting" })).toBeVisible();
  await page.getByRole("button", { name: "Authorize and start" }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    "Nothing was started; prepare a new preview",
  );
  await expect(page.getByRole("heading", { name: "Review before starting" })).toHaveCount(0);
  expect(calls.filter((call) => call.url.endsWith("/semantic/run"))).toHaveLength(1);
  expect(calls.filter((call) => call.url.includes("run-preview"))).toHaveLength(1);
});

test("does not label or offer cancellation for an active run with unknown scope", async ({
  page,
}) => {
  const calls = await wishlistFixture(page, false, true);
  await page.goto("/wishlist");
  await expect(
    page.getByText(/A redundancy run is active\. Its scope is not available here/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel run" })).toHaveCount(0);
  await expect(page.getByText(/Redundancy run progress/)).toBeVisible();
  expect(calls.filter((call) => call.url === "/api/daemon/wishlist/redundancy")).toHaveLength(1);
});

test("a different active run cannot inherit wishlist cancellation authority", async ({ page }) => {
  const calls = await wishlistFixture(page, false, false, "collection-run");
  await page.goto("/wishlist");
  await page.getByRole("button", { name: "Prepare comparison" }).click();
  await page.getByRole("button", { name: "Authorize and start" }).click();
  await expect(
    page.getByText(/A redundancy run is active\. Its scope is not available here/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel run" })).toHaveCount(0);
  await expect(page.getByText(/Wishlist run in progress/)).toHaveCount(0);
  expect(calls.some((call) => call.url.endsWith("/semantic/cancel"))).toBe(false);
});

test("an earlier projection response cannot restore scores from before factual refresh", async ({
  page,
}) => {
  const calls = await wishlistFixture(page, false, false, undefined, true, true);
  const firstProjection = page.waitForResponse(
    (response) => response.headers()["x-e2e-projection"] === "delayed-initial",
  );
  await page.goto("/wishlist");
  await expect(page.getByRole("heading", { name: "Compare wishlist descriptions" })).toBeVisible();
  const candidateOne = page.locator(".wishlist-card").filter({ hasText: "Sample Garden" });
  await candidateOne.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    candidateOne.getByText("Base prediction; no redundancy adjustment is available."),
  ).toBeVisible();
  await firstProjection;
  await expect(
    candidateOne.getByText("Base prediction; no redundancy adjustment is available."),
  ).toBeVisible();
  await expect(
    candidateOne.getByText(/Current comparison · blended available signals/),
  ).toHaveCount(0);
  expect(calls.filter((call) => call.url.includes("run-preview"))).toHaveLength(0);
  expect(calls.filter((call) => call.url.endsWith("/semantic/run"))).toHaveLength(0);
});

test("single and bulk factual refresh replace stale projections without starting comparisons", async ({
  page,
}) => {
  const calls = await wishlistFixture(page, false, false, undefined, true);
  await page.goto("/wishlist");
  const candidateOne = page.locator(".wishlist-card").filter({ hasText: "Sample Garden" });
  const candidateTwo = page.locator(".wishlist-card").filter({ hasText: "Sample Harbor" });
  await expect(
    candidateOne.getByText(/Current comparison · blended available signals/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sort Date Added" }).click();
  await page.getByRole("button", { name: "With Redundancy" }).click();
  let cards = page.locator(".wishlist-card .wc-name");
  await expect(cards.nth(0)).toContainText("Sample Garden");

  await candidateOne.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    candidateOne.getByText("Base prediction; no redundancy adjustment is available."),
  ).toBeVisible();
  await expect(
    candidateOne.getByText(/Current comparison · blended available signals/),
  ).toHaveCount(0);
  cards = page.locator(".wishlist-card .wc-name");
  await expect(cards.nth(0)).toContainText("Sample Harbor");
  await expect(
    candidateTwo.getByText(/Current comparison · blended available signals/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Refresh All" }).click();
  await expect(
    candidateTwo.getByText("Base prediction; no redundancy adjustment is available."),
  ).toBeVisible();
  await expect(
    candidateTwo.getByText(/Current comparison · blended available signals/),
  ).toHaveCount(0);
  cards = page.locator(".wishlist-card .wc-name");
  await expect(cards.nth(0)).toContainText("Sample Harbor");
  expect(calls.filter((call) => call.url.includes("run-preview"))).toHaveLength(0);
  expect(calls.filter((call) => call.url.endsWith("/semantic/run"))).toHaveLength(0);
  expect(calls.filter((call) => call.url === "/api/daemon/wishlist/redundancy")).toHaveLength(3);
});
