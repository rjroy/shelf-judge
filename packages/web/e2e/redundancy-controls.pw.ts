import { expect, test, type Page } from "@playwright/test";

async function installDaemon(page: Page) {
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __redundancyCalls: Array<{ url: string; method: string; body?: unknown }>;
      __releasePreview?: () => void;
    };
    target.__redundancyCalls = [];
    const original = window.fetch.bind(window);
    window.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input, location.origin);
        if (!url.pathname.startsWith("/api/daemon/redundancy/")) return original(input, init);
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined;
        target.__redundancyCalls.push({
          url: `${url.pathname}${url.search}`,
          method: init?.method ?? "GET",
          body,
        });
        let response: unknown = {};
        const status = 200;
        if (url.pathname.endsWith("/semantic-settings") && init?.method === "PATCH")
          response = { settings: body };
        else if (url.pathname.endsWith("/settings"))
          response = {
            enabled: true,
            stage: "annotation",
            similarityThreshold: 0.6,
            maxPenalty: 2,
            minNeighbors: 1,
            expectedNeighbors: 5,
            componentWeights: { binary: 4 / 7, continuous: 3 / 7 },
            semantic: {
              settings: {
                enabled: true,
                weights: { factual: 7, description: 5, ownerNote: 10 },
                cachedOwnerNoteUse: false,
              },
              status: "not-ready",
              migrationNotice: { kind: "jev-cache-v9-to-v10", discardedPairCount: 1 },
            },
          };
        else if (url.pathname.endsWith("/refresh-status")) {
          if (
            new URL(location.href).searchParams.get("status-fail") === "1" &&
            window.localStorage.getItem("run-state") === "running"
          )
            return new Response(JSON.stringify({ error: "Status temporarily unavailable" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          else {
            const stopReason = new URL(location.href).searchParams.get("stop");
            const partial = new URL(location.href).searchParams.get("partial") === "1";
            response =
              window.localStorage.getItem("run-state") === "complete"
                ? {
                    status: partial ? "partial" : "ready",
                    measurement: "current",
                    eligibleGameCount: 3,
                    pairCount: 2,
                    coverage: null,
                    progress: {
                      state: "completed",
                      pairCount: 2,
                      completedPairs: 2,
                      cacheHits: 0,
                      cacheMisses: 2,
                      failedPairs: 0,
                      ...(stopReason ? { stopReason } : {}),
                    },
                  }
                : {
                    status: partial ? "partial" : "ready",
                    measurement: "current",
                    eligibleGameCount: 3,
                    pairCount: 2,
                    coverage: null,
                    progress: partial
                      ? {
                          state: "last-known-running",
                          pairCount: 2,
                          completedPairs: 1,
                          cacheHits: 1,
                          cacheMisses: 1,
                          failedPairs: 0,
                        }
                      : null,
                  };
            if (stopReason) {
              const statusSnapshot = response as Record<string, unknown>;
              statusSnapshot.progress = {
                state: "interrupted",
                pairCount: 2,
                completedPairs: 1,
                cacheHits: 0,
                cacheMisses: 1,
                failedPairs: 0,
                stopReason,
              };
            }
          }
        } else if (url.pathname.endsWith("/run-preview")) {
          if (new URL(location.href).searchParams.get("delay-preview") === "1")
            await new Promise<void>((resolve) => {
              target.__releasePreview = resolve;
            });
          response = {
            requestId: "req-1",
            precondition: "pre-1",
            provider: "TypeSafe",
            modelId: "model-1",
            eligibleGameCount: 3,
            pairCount: 2,
            descriptionBearingPairCount: 2,
            noteBearingPairCount: 1,
            noteTransmissionPermitted: true,
            providerConfigured: new URL(location.href).searchParams.get("no-key") !== "1",
            signalScope: {
              description: true,
              ownerNotes: new URL(location.href).searchParams.get("scope") !== "C",
            },
            scoringEffect: "annotation-only",
            retentionCaveat: "Retention duration is unspecified.",
            limits: {
              maxEligiblePairs: 100,
              maxProviderAttempts: Number(url.searchParams.get("maxProviderAttempts") ?? 100),
              reportedTokenStopThreshold: Number(
                url.searchParams.get("reportedTokenStopThreshold") ?? 200000,
              ),
              maxRunDurationMs: Number(url.searchParams.get("maxRunDurationMs") ?? 30 * 60_000),
              reportedTokenThresholdIsBilledCeiling: false,
            },
            withinPairLimit: true,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          };
          target.__releasePreview = undefined;
        } else if (url.pathname.endsWith("/active-run")) {
          if (
            new URL(location.href).searchParams.get("status-fail") === "1" &&
            window.localStorage.getItem("run-state") === "running"
          )
            return new Response(JSON.stringify({ error: "Status temporarily unavailable" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          const query = new URL(location.href).searchParams;
          const runId =
            window.localStorage.getItem("replace-active") === "1"
              ? "replacement-run"
              : query.get("race") === "1"
                ? "shown-run"
                : "run-1";
          response = window.localStorage.getItem("run-state") === "running" ? { runId } : null;
        } else if (url.pathname.endsWith("/semantic/run")) {
          if (new URL(location.href).searchParams.get("stale") === "1")
            return new Response(JSON.stringify({ error: "Run precondition failed" }), {
              status: 412,
              headers: { "content-type": "application/json" },
            });
          window.localStorage.setItem("run-state", "running");
          window.localStorage.setItem("run-id", "run-1");
          response = { state: "started", runId: "run-1" };
        } else if (url.pathname.endsWith("/semantic/cancel")) {
          window.localStorage.setItem(
            "cancelled-run-id",
            typeof body?.runId === "string" ? body.runId : "",
          );
          window.localStorage.setItem("run-state", "complete");
          response = { state: "cancellation-requested" };
        }
        return new Response(JSON.stringify(response), {
          status,
          headers: { "content-type": "application/json" },
        });
      },
      { preconnect: original.preconnect },
    );
  });
}

test("aggregate Ready status does not conflict with stale settings status", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await expect(page.getByRole("heading", { name: "Similarity preferences" })).toBeVisible();
  await expect(page.locator(".redundancy-refresh-status")).toContainText("Ready");
  await expect(page.getByText(/Not ready — factual-only results are shown/)).toHaveCount(0);
});

test("partial coverage benefits current pairs during and after a run", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy?partial=1");
  const status = page.locator(".redundancy-refresh-status");
  await expect(status).toContainText(
    "Partial — available semantic results already affect relevant pairs",
  );
  await expect(status).not.toContainText("factual-only");

  await page.getByRole("button", { name: "Preview one run" }).click();
  await page.getByRole("button", { name: "Run one refresh" }).click();
  await expect(status).toContainText(
    "Partial — available semantic results already affect relevant pairs",
  );
  await expect(status).toContainText("Refresh is running now.");
  await expect(status).not.toContainText("factual-only");

  await page.getByRole("button", { name: "Cancel live run" }).click();
  await expect(status).toContainText("Run completed.");
  await expect(status).toContainText(
    "Partial — available semantic results already affect relevant pairs",
  );
  await expect(status).not.toContainText("factual-only");
});

test("selected run limits bind the preview and changing them clears it", async ({
  page,
}, testInfo) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  const touchTargetHeight = await page
    .getByLabel("Maximum HTTP attempts")
    .evaluate((input) => getComputedStyle(input).minHeight);
  expect(touchTargetHeight).toBe("44px");
  await page.getByLabel("Maximum HTTP attempts").fill("1200");
  await page.getByLabel("Reported-token stop threshold").fill("245000");
  await page.getByLabel("Maximum run duration in minutes").fill("90");
  await page.getByRole("button", { name: "Preview one run" }).click();
  const preview = page.getByRole("region", { name: "Before you run" });
  await expect(preview).toContainText("1,200 HTTP attempts");
  await expect(preview).toContainText("90 minutes");
  await expect(preview).toContainText("245,000 reported tokens");
  const previewCall = await page.evaluate(() =>
    (
      window as typeof window & { __redundancyCalls: Array<{ url: string }> }
    ).__redundancyCalls.find((entry) => entry.url.includes("/semantic/run-preview?")),
  );
  expect(previewCall?.url).toContain("maxProviderAttempts=1200");
  expect(previewCall?.url).toContain("reportedTokenStopThreshold=245000");
  expect(previewCall?.url).toContain("maxRunDurationMs=5400000");
  await page.screenshot({
    path: testInfo.outputPath(`redundancy-limits-${testInfo.project.name}.png`),
  });
  await page.getByLabel("Maximum HTTP attempts").fill("1300");
  await expect(page.getByRole("region", { name: "Before you run" })).toHaveCount(0);
});

test("an in-flight preview cannot restore limits after an edit", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy?delay-preview=1");
  await page.getByRole("button", { name: "Preview one run" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as typeof window & { __releasePreview?: () => void }).__releasePreview),
      ),
    )
    .toBe(true);
  await page.getByLabel("Maximum HTTP attempts").fill("101");
  await page.evaluate(() =>
    (window as typeof window & { __releasePreview?: () => void }).__releasePreview?.(),
  );
  await expect(page.getByRole("button", { name: "Preview one run" })).toHaveText("Preview one run");
  await expect(page.getByRole("region", { name: "Before you run" })).toHaveCount(0);
});

test("invalid run limits are explained and stop reasons stay distinct", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await page.getByLabel("Maximum HTTP attempts").fill("75001");
  await expect(page.locator(".redundancy-run-limits [role=alert]")).toContainText(
    "cannot exceed 75,000",
  );
  await expect(page.getByRole("button", { name: "Preview one run" })).toBeDisabled();

  const reasonCopy: Record<string, string> = {
    "application-attempt-limit": "application HTTP attempt limit selected for this run",
    "application-token-threshold": "application's reported-token threshold for this run",
    "application-deadline":
      "application stopped the run when its selected maximum duration elapsed",
    "provider-limit": "previous application attempt limit",
    "provider-rate-limited": "provider rate-limited requests",
  };
  for (const [reason, copy] of Object.entries(reasonCopy)) {
    await page.goto(`/redundancy?stop=${reason}`);
    await expect(page.locator(".redundancy-refresh-status")).toContainText(copy);
  }
});

test("note consent is opt-in and declining still runs without note text", async ({
  page,
}, testInfo) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await expect(page.getByText(/cached result for 1 game pair was discarded/)).toBeVisible();
  await page.getByRole("button", { name: "Preview one run" }).click();
  const preview = page.getByRole("region", { name: "Before you run" });
  await expect(preview).toContainText("TypeSafe");
  await expect(preview).toContainText("2 game pairs");
  await expect(preview).toContainText("unknown");
  await expect(preview).toContainText("100 HTTP attempts");
  await expect(preview).toContainText(/note-based results may remain incomplete/i);
  const callsBefore = await page.evaluate(
    () =>
      (
        window as typeof window & { __redundancyCalls: Array<{ url: string }> }
      ).__redundancyCalls.filter((call) => call.url.endsWith("/semantic/run")).length,
  );
  expect(callsBefore).toBe(0);
  await expect(page.getByRole("button", { name: "Run one refresh" })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath(`redundancy-run-${testInfo.project.name}.png`),
  });
  await page.getByRole("button", { name: "Run one refresh" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(/Run started\. Uncached comparisons may now be sent to the provider\./),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeVisible();
  const call = await page.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; body?: Record<string, unknown> }>;
      }
    ).__redundancyCalls.find((entry) => entry.url.endsWith("/semantic/run")),
  );
  expect(call?.body).toMatchObject({
    requestId: "req-1",
    precondition: "pre-1",
    noteTransmissionAuthorized: false,
  });
  await page.getByRole("button", { name: "Cancel live run" }).click();
});

test("owner-note text is authorized only after the per-run opt-in", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await page.getByRole("button", { name: "Preview one run" }).click();
  await expect(page.getByLabel(/For this run only, allow owner notes/)).not.toBeChecked();
  await page.getByLabel(/For this run only, allow owner notes/).check();
  await page.getByRole("button", { name: "Run one refresh" }).click();
  const call = await page.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; body?: Record<string, unknown> }>;
      }
    ).__redundancyCalls.find((entry) => entry.url.endsWith("/semantic/run")),
  );
  expect(call?.body).toMatchObject({ noteTransmissionAuthorized: true });
});

test("unsaved settings block preview and mobile run remains discoverable", async ({
  page,
}, testInfo) => {
  await installDaemon(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/redundancy");
  await page.getByLabel("BoardGameGeek descriptions weight").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Save similarity preferences" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview one run" })).toBeDisabled();
  await expect(page.getByText(/Save similarity preferences before previewing/)).toBeVisible();
  await page.getByRole("button", { name: "Save similarity preferences" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Save similarity preferences" })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview one run" }).click();
  await expect(page.getByRole("button", { name: "Run one refresh" })).toBeEnabled();
  await expect(page.getByLabel(/For this run only, allow owner notes/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath(`redundancy-mobile-run-${testInfo.project.name}.png`),
  });
});

test("C-only preview runs without note consent or transmission", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy?scope=C");
  await page.getByRole("button", { name: "Preview one run" }).click();
  await expect(page.getByLabel(/For this run only, allow owner notes/)).toHaveCount(0);
  await page.getByRole("button", { name: "Run one refresh" }).click();
  const call = await page.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; body?: Record<string, unknown> }>;
      }
    ).__redundancyCalls.find((entry) => entry.url.endsWith("/semantic/run")),
  );
  expect(call?.body).toMatchObject({ noteTransmissionAuthorized: false });
});

test("stale preview is closed and explained without starting a run", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy?stale=1");
  await page.getByRole("button", { name: "Preview one run" }).click();
  await page.getByLabel(/For this run only, allow owner notes/).check();
  await page.getByRole("button", { name: "Run one refresh" }).click();
  await expect(page.locator(".error-banner")).toContainText(/changed after this preview/i);
  await expect(page.getByRole("region", { name: "Before you run" })).toHaveCount(0);
  const starts = await page.evaluate(
    () =>
      (
        window as typeof window & { __redundancyCalls: Array<{ url: string }> }
      ).__redundancyCalls.filter((entry) => entry.url.endsWith("/semantic/run")).length,
  );
  expect(starts).toBe(1);
});

test("no provider key still allows a cache-only run", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy?no-key=1");
  await page.getByRole("button", { name: "Preview one run" }).click();
  await expect(page.getByText(/No provider key is configured/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Run one refresh" })).toBeEnabled();
  await page.getByRole("button", { name: "Run one refresh" }).click();
  await expect(
    page.getByText(/Run started\. Uncached comparisons may now be sent to the provider\./),
  ).toBeVisible();
});

test("accepted run stays cancellable when immediate status reads fail", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy?status-fail=1");
  await page.getByRole("button", { name: "Preview one run" }).click();
  await page.getByRole("button", { name: "Run one refresh" }).click();
  await expect(
    page.getByText(/Run started\. Uncached comparisons may now be sent to the provider\./),
  ).toBeVisible();
  await expect(page.locator(".redundancy-refresh-status")).toContainText(
    /(?:The run started, but status could not be refreshed: )?Status temporarily unavailable/i,
  );
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeEnabled();
});

test("cancel submits the run id shown when the user clicked", async ({ page }) => {
  await installDaemon(page);
  await page.addInitScript(() => window.localStorage.setItem("run-state", "running"));
  await page.goto("/redundancy?race=1");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { __redundancyCalls: Array<{ url: string }> }
          ).__redundancyCalls.filter((entry) => entry.url.endsWith("/active-run")).length,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(() => localStorage.setItem("replace-active", "1"));
  await page.getByRole("button", { name: "Cancel live run" }).click();
  const cancellation = await page.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; body?: Record<string, unknown> }>;
      }
    ).__redundancyCalls.find((entry) => entry.url.endsWith("/semantic/cancel")),
  );
  expect(cancellation?.body).toEqual({ runId: "shown-run" });
});
