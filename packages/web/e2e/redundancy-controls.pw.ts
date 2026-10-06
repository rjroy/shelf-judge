import { expect, test, type Page } from "@playwright/test";

async function installDaemon(page: Page) {
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __redundancyCalls: Array<{ url: string; method: string; body?: unknown }>;
      __releasePreview?: () => void;
      __releaseCoverage?: () => void;
      __releaseProgress?: () => void;
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
        else if (url.pathname.endsWith("/semantic/publication/retry") && init?.method === "POST") {
          if (new URL(location.href).searchParams.get("retry-fail") === "1")
            return new Response(JSON.stringify({ error: "Publication retry unavailable" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          const retryResult = new URL(location.href).searchParams.get("retry-result");
          const publication =
            retryResult === "pending"
              ? {
                  state: "pending",
                  phase: "promote",
                  outcomePersistence: "sealed",
                }
              : retryResult === "unchanged"
                ? { state: "unchanged", outcomePersistence: "finalized" }
                : retryResult === "malformed"
                  ? { state: "published" }
                  : { state: "published", outcomePersistence: "finalized" };
          if (publication.state === "pending") {
            window.localStorage.setItem("publication-state", "pending");
          } else if (publication.state === "published" || publication.state === "unchanged") {
            window.localStorage.setItem("publication-state", "published");
          }
          response = {
            runId: "retry-run-1",
            state: "failed",
            scope: "collection",
            pairCount: 2,
            completedPairs: 1,
            cacheHits: 0,
            cacheMisses: 2,
            failedPairs: 0,
            stopReason: "application-attempt-limit",
            updatedAt: "2026-10-05T00:00:00.000Z",
            publication,
          };
        } else if (url.pathname.endsWith("/refresh-progress")) {
          const runState = window.localStorage.getItem("run-state");
          const locationUrl = new URL(location.href);
          const statusRead = Number(window.localStorage.getItem("progress-read-count") ?? "0") + 1;
          window.localStorage.setItem("progress-read-count", String(statusRead));
          const activeRunId =
            window.localStorage.getItem("replace-active") === "1"
              ? "replacement-run"
              : locationUrl.searchParams.get("race") === "1"
                ? "shown-run"
                : "run-1";
          const activeScope =
            window.localStorage.getItem("legacy-activity") === "1"
              ? undefined
              : (window.localStorage.getItem("replacement-scope") ??
                window.localStorage.getItem("activity-scope") ??
                "collection");
          const failStatus =
            ((locationUrl.searchParams.get("status-fail") === "1" ||
              window.localStorage.getItem("status-fail") === "1") &&
              (runState === "running" || runState === "cancelled")) ||
            (locationUrl.searchParams.get("fail-second-status") === "1" && statusRead === 2);
          if (
            ((locationUrl.searchParams.get("hold-poll") === "1" && runState === "complete") ||
              (locationUrl.searchParams.get("hold-second-status") === "1" && statusRead === 2)) &&
            window.localStorage.getItem("hold-poll-used") !== "1"
          ) {
            window.localStorage.setItem("hold-poll-used", "1");
            await new Promise<void>((resolve) => {
              target.__releaseProgress = resolve;
            });
          }
          const stopReason =
            window.localStorage.getItem("stop-reason") ?? locationUrl.searchParams.get("stop");
          const progressCount = (key: string, fallback: number) =>
            Number(locationUrl.searchParams.get(key) ?? fallback);
          if (failStatus) {
            const failedResponse = new Response(
              JSON.stringify({ error: "Status temporarily unavailable" }),
              {
                status: 503,
                headers: { "content-type": "application/json" },
              },
            );
            if (statusRead === 2) {
              const readJson = failedResponse.json.bind(failedResponse);
              Object.defineProperty(failedResponse, "json", {
                value: async (): Promise<unknown> => {
                  const result: unknown = await readJson();
                  window.localStorage.setItem("failed-status-consumed", "2");
                  return result;
                },
              });
            }
            return failedResponse;
          }
          if (window.localStorage.getItem("activity-state") === "unavailable")
            response = {
              coverageMeasurement: "not-measured",
              activity: { state: "unavailable" },
              progress: { state: "unavailable" },
            };
          else
            response = {
              coverageMeasurement: "not-measured",
              activity:
                runState === "running"
                  ? {
                      state: "active",
                      runId: activeRunId,
                      ...(activeScope ? { scope: activeScope } : {}),
                    }
                  : { state: "idle" },
              progress:
                runState === "running"
                  ? {
                      state: "saved",
                      relation: "active-run",
                      value: {
                        ...(window.localStorage.getItem("omit-progress-scope") === "1" ||
                        !activeScope
                          ? {}
                          : { scope: activeScope }),
                        state: "last-known-running",
                        pairCount: 2,
                        completedPairs: 1,
                        cacheHits: window.localStorage.getItem("replace-active") === "1" ? 1 : 0,
                        cacheMisses: window.localStorage.getItem("replace-active") === "1" ? 0 : 1,
                        failedPairs: 0,
                      },
                    }
                  : runState === "complete" || runState === "cancelled"
                    ? {
                        state: "saved",
                        relation: "historical",
                        ...(new URL(location.href).searchParams.get("publication") === "pending" ||
                        new URL(location.href).searchParams.get("publication") === "unpersisted"
                          ? { retryRunId: "retry-run-1" }
                          : {}),
                        value: {
                          scope: window.localStorage.getItem("history-scope") ?? "collection",
                          state: runState === "complete" ? "completed" : "interrupted",
                          pairCount: 2,
                          completedPairs: runState === "complete" ? 2 : 1,
                          cacheHits: 0,
                          cacheMisses: 2,
                          failedPairs: 0,
                          publication: { state: "published", outcomePersistence: "finalized" },
                        },
                      }
                    : stopReason
                      ? {
                          state: "saved",
                          relation: "historical",
                          ...(new URL(location.href).searchParams.get("publication") ===
                            "pending" ||
                          new URL(location.href).searchParams.get("publication") === "unpersisted"
                            ? { retryRunId: "retry-run-1" }
                            : {}),
                          value: {
                            scope: window.localStorage.getItem("history-scope") ?? "collection",
                            state: "failed",
                            pairCount: 2,
                            completedPairs: progressCount("completed", 1),
                            cacheHits: progressCount("cacheHits", 1),
                            cacheMisses: 0,
                            failedPairs: progressCount("failed", 0),
                            stopReason,
                            ...(window.localStorage.getItem("publication-state") === "published"
                              ? {
                                  publication: {
                                    state: "published",
                                    outcomePersistence: "finalized",
                                  },
                                }
                              : new URL(location.href).searchParams.get("publication") ===
                                    "pending" ||
                                  window.localStorage.getItem("publication-state") === "pending"
                                ? {
                                    publication: {
                                      state: "pending",
                                      phase: "promote",
                                      outcomePersistence: "sealed",
                                    },
                                  }
                                : new URL(location.href).searchParams.get("publication") ===
                                    "unpersisted"
                                  ? {
                                      publication: {
                                        state: "pending",
                                        phase: "seal",
                                        outcomePersistence: "unpersisted",
                                      },
                                    }
                                  : {}),
                          },
                        }
                      : { state: "none" },
            };
        } else if (url.pathname.endsWith("/refresh-status")) {
          if (window.localStorage.getItem("coverage-fail") === "1")
            return new Response(JSON.stringify({ error: "Coverage temporarily unavailable" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          if (new URL(location.href).searchParams.get("hold-coverage") === "1")
            await new Promise<void>((resolve) => {
              target.__releaseCoverage = resolve;
            });
          if (
            new URL(location.href).searchParams.get("status-fail") === "1" &&
            window.localStorage.getItem("run-state") === "running"
          )
            return new Response(JSON.stringify({ error: "Status temporarily unavailable" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          else {
            const stopReason =
              window.localStorage.getItem("stop-reason") ??
              new URL(location.href).searchParams.get("stop");
            const partial = new URL(location.href).searchParams.get("partial") === "1";
            const runState = window.localStorage.getItem("run-state");
            response =
              runState === "cancelled"
                ? {
                    status: partial ? "partial" : "ready",
                    measurement: "current",
                    eligibleGameCount: 3,
                    pairCount: 2,
                    coverage: null,
                    progress: {
                      state: "interrupted",
                      pairCount: 2,
                      completedPairs: 1,
                      cacheHits: 1,
                      cacheMisses: 0,
                      failedPairs: 0,
                    },
                  }
                : runState === "complete"
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
                state: "failed",
                pairCount: 2,
                completedPairs: Number(new URL(location.href).searchParams.get("completed") ?? 1),
                cacheHits: Number(new URL(location.href).searchParams.get("cacheHits") ?? 1),
                cacheMisses: 0,
                failedPairs: Number(new URL(location.href).searchParams.get("failed") ?? 0),
                stopReason,
                ...(new URL(location.href).searchParams.get("publication") === "pending"
                  ? {
                      publication: {
                        state: "pending",
                        phase: "promote",
                        outcomePersistence: "sealed",
                      },
                    }
                  : {}),
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
            limits: {
              maxEligiblePairs: 100,
              maxProviderAttempts: Number(url.searchParams.get("maxProviderAttempts") ?? 1000),
              reportedTokenStopThreshold: Number(
                url.searchParams.get("reportedTokenStopThreshold") ?? 2000000,
              ),
              maxRunDurationMs: Number(url.searchParams.get("maxRunDurationMs") ?? 30 * 60_000),
              reportedTokenThresholdIsBilledCeiling: false,
            },
            withinPairLimit: true,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          };
          target.__releasePreview = undefined;
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
          window.localStorage.setItem("run-state", "cancelled");
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

test("initial idle page renders before comprehensive coverage finishes", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy?hold-coverage=1");
  await expect(page.getByRole("heading", { name: "Similarity preferences" })).toBeVisible();
  await expect(page.locator(".redundancy-refresh-status")).toContainText("No saved run progress");
  await expect(page.locator(".redundancy-refresh-status")).not.toContainText("Ready");
  await page.evaluate(() => {
    const target = window as typeof window & { __releaseCoverage?: () => void };
    target.__releaseCoverage?.();
  });
  await expect(page.locator(".redundancy-refresh-status")).toContainText("Ready");
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
  await page.getByRole("button", { name: "Run once" }).click();
  await expect(status).toContainText("Collection comparison is running.");
  await expect(status).toContainText("1 of 2 pairs completed; 0 reused from cache.");
  await expect(status).not.toContainText("Partial —");
  await expect(status).not.toContainText("Coverage measured across");
  await expect(status).not.toContainText("factual-only");

  await page.getByRole("button", { name: "Cancel live run" }).click();
  await expect(status).toContainText("Run stopped before completion.");
  await expect(status).not.toContainText("Run failed.");
  await expect(status).toContainText(
    "Partial — available semantic results already affect relevant pairs",
  );
  await expect(status).toContainText("Coverage measured across 2 eligible pairs.");
  await expect(status).not.toContainText("factual-only");
});

test("selected run limits bind the preview and changing them clears it", async ({
  page,
}, testInfo) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await expect(page.getByLabel("Maximum HTTP attempts")).toHaveValue("1000");
  await expect(page.getByLabel("Reported-token stop threshold")).toHaveValue("2000000");
  await expect(page.getByLabel("Maximum run duration in minutes")).toHaveValue("30");
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
  await expect(preview).toContainText("TypeSafe");
  await expect(preview).toContainText("allow owner notes to be sent to TypeSafe");
  await expect(preview).not.toContainText(/retention|may retain|unspecified/i);
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

test("default run limits are sent to the preview", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await expect(page.getByLabel("Maximum HTTP attempts")).toHaveValue("1000");
  await expect(page.getByLabel("Reported-token stop threshold")).toHaveValue("2000000");
  await page.getByRole("button", { name: "Preview one run" }).click();

  const preview = page.getByRole("region", { name: "Before you run" });
  await expect(preview).toContainText("1,000 HTTP attempts");
  await expect(preview).toContainText("2,000,000 reported tokens");
  const previewCall = await page.evaluate(() =>
    (
      window as typeof window & { __redundancyCalls: Array<{ url: string }> }
    ).__redundancyCalls.find((entry) => entry.url.includes("/semantic/run-preview?")),
  );
  expect(previewCall?.url).toContain("maxProviderAttempts=1000");
  expect(previewCall?.url).toContain("reportedTokenStopThreshold=2000000");
  expect(previewCall?.url).toContain("maxRunDurationMs=1800000");
});

test("changing a similarity weight invalidates the saved-settings preview without a provider call", async ({
  page,
}) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await page.getByRole("button", { name: "Preview one run" }).click();
  await expect(page.getByRole("region", { name: "Before you run" })).toBeVisible();
  await page.getByLabel("BoardGameGeek descriptions weight").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("region", { name: "Before you run" })).toHaveCount(0);
  const calls = await page.evaluate(
    () =>
      (window as typeof window & { __redundancyCalls: Array<{ url: string }> }).__redundancyCalls,
  );
  expect(calls.filter((call) => call.url.endsWith("/semantic/run"))).toHaveLength(0);
  expect(calls.filter((call) => call.url.includes("/run-preview"))).toHaveLength(1);
});

test("shared prediction and redundancy weights stay available when redundancy is off", async ({
  page,
}) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await page.getByRole("checkbox", { name: "Enable redundancy scoring" }).uncheck();
  await expect(
    page.getByText("These shared weights affect both prediction and redundancy."),
  ).toBeVisible();
  await expect(page.getByLabel("BoardGameGeek descriptions weight")).toBeVisible();
  await expect(page.getByLabel("Your game notes weight")).toBeVisible();
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

  const applicationStopCases = [
    {
      reason: "application-attempt-limit",
      copy: "HTTP request limit reached.",
      retry: "higher request limit",
    },
    {
      reason: "application-token-threshold",
      copy: "Reported-token stop limit reached.",
      retry: "higher token limit",
    },
    {
      reason: "application-deadline",
      copy: "Run time limit reached.",
      retry: "longer duration",
    },
  ];
  for (const { reason, copy, retry } of applicationStopCases) {
    for (const failed of [0, 1]) {
      await page.goto(`/redundancy?stop=${reason}&failed=${failed}&completed=1&cacheHits=1`);
      const status = page.locator(".redundancy-refresh-status");
      await expect(status.locator("p").nth(0)).toContainText("Ready.");
      await expect(status.locator("p").nth(0)).toContainText(
        "Coverage measured across 2 eligible pairs.",
      );
      await expect(status.locator("p").nth(1)).toContainText(`Last saved collection run: ${copy}`);
      await expect(status.locator("p").nth(1)).toContainText(
        `1 of 2 pairs completed; ${failed} failed; 1 reused from cache.`,
      );
      await expect(status.locator("p").nth(1)).toContainText(retry);
      await expect(status).not.toContainText("Run failed.");
      await expect(status.locator("p")).toHaveCount(2);
      if (reason === "application-token-threshold")
        await expect(status.locator("p").nth(1)).toContainText("This is not a billing limit.");
    }
  }

  await page.goto("/redundancy?stop=provider-limit&failed=1");
  const legacyLimit = page.locator(".redundancy-refresh-status");
  await expect(legacyLimit.locator("p").nth(0)).toContainText("Ready.");
  await expect(legacyLimit.locator("p").nth(0)).toContainText(
    "Coverage measured across 2 eligible pairs.",
  );
  await expect(legacyLimit.locator("p").nth(1)).toContainText(
    "Last saved collection run: Previous application request limit reached.",
  );
  await expect(legacyLimit.locator("p").nth(1)).toContainText(
    "1 of 2 pairs completed; 1 failed; 1 reused from cache.",
  );
  await expect(legacyLimit.locator("p").nth(1)).toContainText("higher request limit");
  await expect(legacyLimit).not.toContainText("Run failed.");
  await expect(legacyLimit.locator("p")).toHaveCount(2);

  await page.goto("/redundancy?stop=provider-rate-limited&failed=1");
  const providerFailure = page.locator(".redundancy-refresh-status");
  await expect(providerFailure).toContainText("Last saved collection run: Run failed.");
  await expect(providerFailure).toContainText(
    "1 of 2 pairs completed; 1 failed; 1 reused from cache.",
  );
  await expect(providerFailure.locator("p").nth(0)).toContainText("Ready.");
  await expect(providerFailure).toContainText("Coverage measured across 2 eligible pairs.");
  await expect(providerFailure).toContainText(
    "The provider rate-limited requests. Results may be partial.",
  );
  await expect(providerFailure.locator("p")).toHaveCount(3);

  await page.goto("/redundancy?stop=application-attempt-limit");
  const reloadedStatus = page.locator(".redundancy-refresh-status");
  await expect(reloadedStatus).toContainText("HTTP request limit reached.");
  await page.evaluate(() => window.localStorage.setItem("stop-reason", "application-deadline"));
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect(reloadedStatus).toContainText("Last saved collection run: Run time limit reached.");
  await expect(reloadedStatus).not.toContainText("HTTP request limit reached.");
});

test("note consent is opt-in and declining still runs without note text", async ({
  page,
}, testInfo) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await expect(page.getByText(/cached result for 1 game pair was discarded/)).toHaveCount(0);
  await expect(page.getByLabel("Use cached comparisons based on my notes")).toBeVisible();
  await expect(page.getByText(/Saving this never sends notes/i)).toBeVisible();
  await expect(page.getByText(/eligible for a separately confirmed run/i)).toBeVisible();
  await expect(
    page.getByText(/Turning it off deletes saved note-based comparisons/i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview one run" }).click();
  const preview = page.getByRole("region", { name: "Before you run" });
  await expect(preview).toContainText("TypeSafe");
  await expect(preview).toContainText("2 game pairs");
  await expect(preview).not.toContainText(/retention|may retain|unspecified/i);
  await expect(preview).toContainText("1,000 HTTP attempts");
  await expect(preview).toContainText(/note-based results may remain incomplete/i);
  const callsBefore = await page.evaluate(
    () =>
      (
        window as typeof window & { __redundancyCalls: Array<{ url: string }> }
      ).__redundancyCalls.filter((call) => call.url.endsWith("/semantic/run")).length,
  );
  expect(callsBefore).toBe(0);
  await expect(page.getByRole("button", { name: "Run once" })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath(`redundancy-run-${testInfo.project.name}.png`),
  });
  await page.getByRole("button", { name: "Run once" }).focus();
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
  await page.getByRole("button", { name: "Run once" }).click();
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
  await expect(page.getByRole("button", { name: "Run once" })).toBeEnabled();
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
  await page.getByRole("button", { name: "Run once" }).click();
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
  await page.getByRole("button", { name: "Run once" }).click();
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
  await expect(page.getByRole("button", { name: "Run once" })).toBeEnabled();
  await page.getByRole("button", { name: "Run once" }).click();
  await expect(
    page.getByText(/Run started\. Uncached comparisons may now be sent to the provider\./),
  ).toBeVisible();
});

test("a failed post-start status read withdraws scoped cancellation authority", async ({
  page,
}) => {
  await installDaemon(page);
  await page.goto("/redundancy?status-fail=1");
  await page.getByRole("button", { name: "Preview one run" }).click();
  await page.getByRole("button", { name: "Run once" }).click();
  await expect(
    page.getByText(/Run started\. Uncached comparisons may now be sent to the provider\./),
  ).toBeVisible();
  await expect(page.locator(".redundancy-refresh-status")).toContainText(
    /(?:The run started, but status could not be refreshed: )?Status temporarily unavailable/i,
  );
  await expect(page.getByRole("button", { name: "Cancel live run" })).toHaveCount(0);
  await expect(page.locator(".redundancy-refresh-status")).toContainText(
    "Live activity status is unavailable",
  );
  await expect(page.locator(".redundancy-refresh-status")).not.toContainText("Ready");
});

test("idle to unavailable to idle activity invalidates then measures coverage again", async ({
  page,
}) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await expect(page.locator(".redundancy-refresh-status")).toContainText("Ready");
  const coverageReads = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & { __redundancyCalls: Array<{ url: string }> }
        ).__redundancyCalls.filter((entry) => entry.url.endsWith("/refresh-status")).length,
    );
  const initialCoverageReads = await coverageReads();
  await page.evaluate(() => localStorage.setItem("activity-state", "unavailable"));
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect(page.locator(".redundancy-refresh-status")).toContainText(
    "Live activity status is unavailable",
  );
  await expect(page.locator(".redundancy-refresh-status")).not.toContainText("Ready");
  await page.evaluate(() => localStorage.removeItem("activity-state"));
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect.poll(coverageReads).toBe(initialCoverageReads + 1);
  await expect(page.locator(".redundancy-refresh-status")).toContainText("Ready");
});

test("failed terminal coverage measurement stays visible until manual retry succeeds", async ({
  page,
}) => {
  await installDaemon(page);
  await page.goto("/redundancy");
  await page.getByRole("button", { name: "Preview one run" }).click();
  await page.getByRole("button", { name: "Run once" }).click();
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("coverage-fail", "1"));
  await page.getByRole("button", { name: "Cancel live run" }).click();
  await expect(page.locator(".redundancy-refresh-status")).toContainText(
    "Coverage temporarily unavailable",
  );
  await page.evaluate(() => localStorage.removeItem("coverage-fail"));
  await page.getByRole("button", { name: "Refresh coverage" }).click();
  await expect(page.locator(".redundancy-refresh-status")).toContainText("Ready");
  await expect(page.locator(".redundancy-refresh-status")).not.toContainText(
    "Coverage temporarily unavailable",
  );
});

test("cancel submits the run id shown when the user clicked", async ({ page }) => {
  await installDaemon(page);
  await page.addInitScript(() => window.localStorage.setItem("run-state", "running"));
  await page.goto("/redundancy?race=1");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { __redundancyCalls: Array<{ url: string }> }
          ).__redundancyCalls.filter((entry) => entry.url.endsWith("/refresh-progress")).length,
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

test("reload restores matching collection scope and can cancel its authoritative run", async ({
  page,
}) => {
  await installDaemon(page);
  await page.addInitScript(() => window.localStorage.setItem("run-state", "running"));
  await page.goto("/redundancy");
  const status = page.locator(".redundancy-refresh-status");
  await expect(status).toContainText("Collection comparison is running");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel live run" }).click();
  const cancellation = await page.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; body?: Record<string, unknown> }>;
      }
    ).__redundancyCalls.find((entry) => entry.url.endsWith("/semantic/cancel")),
  );
  expect(cancellation?.body).toEqual({ runId: "run-1" });
});

test("other-scope and legacy active status never grants collection cancellation authority", async ({
  page,
}) => {
  await installDaemon(page);
  await page.addInitScript(() => {
    localStorage.setItem("run-state", "running");
    localStorage.setItem("activity-scope", "wishlist");
  });
  await page.goto("/redundancy");
  const status = page.locator(".redundancy-refresh-status");
  await expect(status).toContainText("A wishlist comparison is active");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.removeItem("activity-scope");
    localStorage.setItem("legacy-activity", "1");
  });
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect(status).toContainText("scope is unknown");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toHaveCount(0);
});

test("an authoritative replacement can change scope without an idle gap", async ({ page }) => {
  await installDaemon(page);
  await page.addInitScript(() => {
    localStorage.setItem("run-state", "running");
  });
  await page.goto("/redundancy");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("replace-active", "1");
    localStorage.setItem("replacement-scope", "wishlist");
  });
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect(page.locator(".redundancy-refresh-status")).toContainText(
    "A wishlist comparison is active",
  );
  await expect(page.getByRole("button", { name: "Cancel live run" })).toHaveCount(0);
});

test("a late older live-status response cannot replace a newer run ID", async ({ page }) => {
  await installDaemon(page);
  await page.addInitScript(() => window.localStorage.setItem("run-state", "running"));
  await page.goto("/redundancy?hold-second-status=1");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as typeof window & { __releaseProgress?: unknown }).__releaseProgress),
      ),
    )
    .toBe(true);
  await page.evaluate(() => localStorage.setItem("replace-active", "1"));
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect(page.locator(".redundancy-refresh-status")).toContainText("1 reused from cache");
  await page.evaluate(() => {
    const target = window as typeof window & { __releaseProgress?: () => void };
    target.__releaseProgress?.();
  });
  await page.getByRole("button", { name: "Cancel live run" }).click();
  const cancellation = await page.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; body?: Record<string, unknown> }>;
      }
    ).__redundancyCalls.find((entry) => entry.url.endsWith("/semantic/cancel")),
  );
  expect(cancellation?.body).toEqual({ runId: "replacement-run" });
});

test("a failed older status response cannot erase newer cancellation authority", async ({
  page,
}) => {
  await installDaemon(page);
  await page.addInitScript(() => window.localStorage.setItem("run-state", "running"));
  await page.goto("/redundancy?hold-second-status=1&fail-second-status=1");
  const statusPanel = page.locator(".redundancy-refresh-status");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeEnabled();
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as typeof window & { __releaseProgress?: unknown }).__releaseProgress),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    localStorage.setItem("replace-active", "1");
  });
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect(page.locator(".redundancy-refresh-status")).toContainText("1 reused from cache");
  await page.evaluate(() => {
    const target = window as typeof window & { __releaseProgress?: () => void };
    target.__releaseProgress?.();
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("failed-status-consumed")))
    .toBe("2");
  await expect(statusPanel.getByRole("alert")).toHaveCount(0);
  await expect(statusPanel).not.toContainText("Live activity status is unavailable");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel live run" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as typeof window & {
            __redundancyCalls: Array<{ url: string; method: string; body?: unknown }>;
          }
        ).__redundancyCalls.filter(
          (entry) =>
            entry.url === "/api/daemon/redundancy/semantic/cancel" && entry.method === "POST",
        );
        return calls;
      }),
    )
    .toEqual([
      {
        url: "/api/daemon/redundancy/semantic/cancel",
        method: "POST",
        body: { runId: "replacement-run" },
      },
    ]);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("cancelled-run-id")))
    .toBe("replacement-run");
  await expect(page.getByText("Cancellation requested for this run.")).toBeVisible();
});

test("progress polling waits one minute and keeps polling only cheap status after completion", async ({
  page,
}) => {
  await page.clock.pauseAt(new Date("2025-01-01T00:00:00Z"));
  await installDaemon(page);
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __pollIntervals: Array<{ id: number; startedAt: number }>;
      __pollTimerTicks: number;
    };
    target.__pollIntervals = [];
    target.__pollTimerTicks = 0;
    const setInterval = window.setInterval.bind(window);
    const clearInterval = window.clearInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      let wrappedHandler = handler;
      let startedAt: number | null = null;
      if (timeout === 60_000) {
        startedAt = Date.now();
        if (typeof handler === "function") {
          const callback = handler as (...callbackArgs: unknown[]) => void;
          wrappedHandler = (...callbackArgs: unknown[]) => {
            target.__pollTimerTicks += 1;
            callback(...callbackArgs);
          };
        }
      }
      const id = setInterval(wrappedHandler, timeout, ...args);
      if (startedAt !== null) target.__pollIntervals.push({ id, startedAt });
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      target.__pollIntervals = target.__pollIntervals.filter((interval) => interval.id !== id);
      return clearInterval(id);
    }) as typeof window.clearInterval;
  });
  await page.addInitScript(() => window.localStorage.setItem("run-state", "running"));
  await page.goto("/redundancy");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeVisible();

  const progressCalls = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & { __redundancyCalls: Array<{ url: string }> }
        ).__redundancyCalls.filter((entry) => entry.url.endsWith("/refresh-progress")).length,
    );
  const initialCount = await progressCalls();
  const activeIntervals = await page.evaluate(
    () =>
      (window as typeof window & { __pollIntervals: Array<{ id: number; startedAt: number }> })
        .__pollIntervals,
  );
  expect(activeIntervals.length).toBe(1);
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect.poll(progressCalls).toBeGreaterThan(initialCount);
  const afterManualReload = await progressCalls();
  await page.clock.fastForward(59_999);
  expect(
    await page.evaluate(
      () => (window as typeof window & { __pollTimerTicks: number }).__pollTimerTicks,
    ),
  ).toBe(0);
  await page.clock.fastForward(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __pollTimerTicks: number }).__pollTimerTicks,
      ),
    )
    .toBe(1);
  await expect.poll(progressCalls).toBeGreaterThan(afterManualReload);

  await page.evaluate(() => window.localStorage.setItem("run-state", "complete"));
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect(page.getByRole("button", { name: "Cancel live run" })).toHaveCount(0);
  const completedCount = await progressCalls();
  await page.clock.fastForward(120_000);
  await expect.poll(progressCalls).toBeGreaterThan(completedCount);
  const coverageCalls = await page.evaluate(
    () =>
      (
        window as typeof window & { __redundancyCalls: Array<{ url: string }> }
      ).__redundancyCalls.filter((entry) => entry.url.endsWith("/refresh-status")).length,
  );
  await page.clock.fastForward(120_000);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & { __redundancyCalls: Array<{ url: string }> }
        ).__redundancyCalls.filter((entry) => entry.url.endsWith("/refresh-status")).length,
    ),
  ).toBe(coverageCalls);
});

test("pending publication stays explicit and can be retried without provider requests", async ({
  page,
}) => {
  await installDaemon(page);
  await page.goto("/redundancy?stop=application-attempt-limit&publication=pending");
  const status = page.locator(".redundancy-refresh-status");
  await expect(status).toContainText("not published yet");
  await expect(status).toContainText("retry publishes them without sending provider requests");
  await expect(page.getByRole("button", { name: "Retry score update" })).toBeVisible();
  const initialCoverage = await page.evaluate(
    () =>
      (
        window as typeof window & { __redundancyCalls: Array<{ url: string }> }
      ).__redundancyCalls.filter((call) => call.url.endsWith("/refresh-status")).length,
  );
  await page.getByRole("button", { name: "Retry score update" }).click();
  await expect(
    page.getByText("Saved comparisons were published. Refreshing coverage…"),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __redundancyCalls: Array<{ url: string; method: string; body?: unknown }>;
            }
          ).__redundancyCalls.filter(
            (call) =>
              call.url.endsWith("/publication/retry") &&
              call.method === "POST" &&
              (call.body as { runId?: string })?.runId === "retry-run-1",
          ).length,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { __redundancyCalls: Array<{ url: string }> }
          ).__redundancyCalls.filter((call) => call.url.endsWith("/semantic/run")).length,
      ),
    )
    .toBe(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { __redundancyCalls: Array<{ url: string }> }
          ).__redundancyCalls.filter((call) => call.url.endsWith("/refresh-status")).length,
      ),
    )
    .toBe(initialCoverage + 1);
});

test("publication retry errors remain visible and unpersisted seal status is explained", async ({
  page,
}) => {
  await installDaemon(page);
  await page.goto(
    "/redundancy?stop=application-attempt-limit&publication=unpersisted&retry-fail=1",
  );
  const status = page.locator(".redundancy-refresh-status");
  await expect(status).toContainText("outcome could not yet be saved");
  await page.getByRole("button", { name: "Retry score update" }).click();
  await expect(page.locator(".error-banner")).toContainText("Publication retry unavailable");
});

test("a successful retry response that is still pending does not announce or measure an update", async ({
  page,
}) => {
  await installDaemon(page);
  await page.goto(
    "/redundancy?stop=application-attempt-limit&publication=pending&retry-result=pending",
  );
  const coverageReads = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & { __redundancyCalls: Array<{ url: string }> }
        ).__redundancyCalls.filter((call) => call.url.endsWith("/refresh-status")).length,
    );
  const initialCoverageReads = await coverageReads();
  await page.getByRole("button", { name: "Retry score update" }).click();
  await expect(page.locator(".success-banner")).toContainText("Publication is still pending");
  await expect(page.locator(".success-banner")).toContainText("Scores have not been updated");
  await expect(page.getByRole("button", { name: "Retry score update" })).toBeVisible();
  expect(await coverageReads()).toBe(initialCoverageReads);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & { __redundancyCalls: Array<{ url: string }> }
        ).__redundancyCalls.filter((call) => call.url.endsWith("/semantic/run")).length,
    ),
  ).toBe(0);
});

test("a complete unchanged retry response measures coverage exactly once", async ({ page }) => {
  await installDaemon(page);
  await page.goto(
    "/redundancy?stop=application-attempt-limit&publication=pending&retry-result=unchanged",
  );
  const coverageReads = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & { __redundancyCalls: Array<{ url: string }> }
        ).__redundancyCalls.filter((call) => call.url.endsWith("/refresh-status")).length,
    );
  const initialCoverageReads = await coverageReads();
  await page.getByRole("button", { name: "Retry score update" }).click();
  await expect(page.locator(".success-banner")).toContainText("already up to date");
  await expect.poll(coverageReads).toBe(initialCoverageReads + 1);
  await page.getByRole("button", { name: "Refresh progress" }).click();
  expect(await coverageReads()).toBe(initialCoverageReads + 1);
});

test("a malformed complete retry response fails safe without refreshing coverage", async ({
  page,
}) => {
  await installDaemon(page);
  await page.goto(
    "/redundancy?stop=application-attempt-limit&publication=pending&retry-result=malformed",
  );
  const coverageReads = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & { __redundancyCalls: Array<{ url: string }> }
        ).__redundancyCalls.filter((call) => call.url.endsWith("/refresh-status")).length,
    );
  const initialCoverageReads = await coverageReads();
  await page.getByRole("button", { name: "Retry score update" }).click();
  await expect(page.locator(".error-banner")).toContainText(
    "Publication retry returned an invalid result",
  );
  expect(await coverageReads()).toBe(initialCoverageReads);
});

test("initial pending publication is tracked until a later published status", async ({ page }) => {
  await installDaemon(page);
  await page.goto("/redundancy?stop=application-attempt-limit&publication=pending");
  const coverageReads = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & { __redundancyCalls: Array<{ url: string }> }
        ).__redundancyCalls.filter((call) => call.url.endsWith("/refresh-status")).length,
    );
  expect(await coverageReads()).toBe(0);
  await page.evaluate(() => localStorage.setItem("publication-state", "published"));
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect.poll(coverageReads).toBe(1);
  await page.getByRole("button", { name: "Refresh progress" }).click();
  expect(await coverageReads()).toBe(1);
});

test("activity loss does not consume an active run's pending publication tracking", async ({
  page,
}) => {
  await installDaemon(page);
  await page.addInitScript(() => localStorage.setItem("run-state", "running"));
  await page.goto("/redundancy?stop=application-attempt-limit");
  const coverageReads = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & { __redundancyCalls: Array<{ url: string }> }
        ).__redundancyCalls.filter((call) => call.url.endsWith("/refresh-status")).length,
    );
  expect(await coverageReads()).toBe(0);
  await page.evaluate(() => localStorage.setItem("activity-state", "unavailable"));
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await page.evaluate(() => {
    localStorage.removeItem("activity-state");
    localStorage.setItem("run-state", "failed");
    localStorage.setItem("publication-state", "pending");
  });
  await page.getByRole("button", { name: "Refresh progress" }).click();
  expect(await coverageReads()).toBe(0);
  await page.evaluate(() => localStorage.setItem("publication-state", "published"));
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect.poll(coverageReads).toBe(1);
  await page.getByRole("button", { name: "Refresh progress" }).click();
  expect(await coverageReads()).toBe(1);
});

test("legacy historical status recovers coverage once after activity becomes available", async ({
  page,
}) => {
  await installDaemon(page);
  await page.goto("/redundancy?stop=application-attempt-limit");
  const coverageReads = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & { __redundancyCalls: Array<{ url: string }> }
        ).__redundancyCalls.filter((call) => call.url.endsWith("/refresh-status")).length,
    );
  await expect.poll(coverageReads).toBe(1);
  await page.evaluate(() => localStorage.setItem("activity-state", "unavailable"));
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await page.evaluate(() => localStorage.removeItem("activity-state"));
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect.poll(coverageReads).toBe(2);
  await page.getByRole("button", { name: "Refresh progress" }).click();
  expect(await coverageReads()).toBe(2);
});

test("progress polling stops when the page unmounts", async ({ page }) => {
  await page.clock.pauseAt(new Date("2025-01-01T00:00:00Z"));
  await installDaemon(page);
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __pollIntervals: Array<{ id: number; startedAt: number }>;
      __pollTimerTicks: number;
      __pollTimerTicksByInterval: Record<number, number>;
    };
    target.__pollIntervals = [];
    target.__pollTimerTicks = 0;
    target.__pollTimerTicksByInterval = {};
    const setInterval = window.setInterval.bind(window);
    const clearInterval = window.clearInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      let wrappedHandler = handler;
      let startedAt: number | null = null;
      let intervalId = 0;
      if (timeout === 60_000) {
        startedAt = Date.now();
        if (typeof handler === "function") {
          const callback = handler as (...callbackArgs: unknown[]) => void;
          wrappedHandler = (...callbackArgs: unknown[]) => {
            target.__pollTimerTicks += 1;
            target.__pollTimerTicksByInterval[intervalId] =
              (target.__pollTimerTicksByInterval[intervalId] ?? 0) + 1;
            callback(...callbackArgs);
          };
        }
      }
      intervalId = setInterval(wrappedHandler, timeout, ...args);
      if (startedAt !== null) target.__pollIntervals.push({ id: intervalId, startedAt });
      return intervalId;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      target.__pollIntervals = target.__pollIntervals.filter((interval) => interval.id !== id);
      return clearInterval(id);
    }) as typeof window.clearInterval;
  });
  await page.addInitScript(() => window.localStorage.setItem("run-state", "running"));
  await page.goto("/redundancy?hold-poll=1");
  await expect(page.getByRole("button", { name: "Cancel live run" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  const outgoingIntervals = await page.evaluate(() =>
    (
      window as typeof window & { __pollIntervals: Array<{ id: number; startedAt: number }> }
    ).__pollIntervals.map(({ id }) => id),
  );
  expect(outgoingIntervals.length).toBeGreaterThan(0);
  await page.evaluate(() => window.localStorage.setItem("run-state", "complete"));
  await page.clock.fastForward(60_000);
  await expect
    .poll(() =>
      page.evaluate(
        () => !!(window as typeof window & { __releaseProgress?: () => void }).__releaseProgress,
      ),
    )
    .toBe(true);
  const coverageCallsBeforeUnmount = await page.evaluate(
    () =>
      (
        window as typeof window & { __redundancyCalls: Array<{ url: string }> }
      ).__redundancyCalls.filter((entry) => entry.url.endsWith("/refresh-status")).length,
  );
  await page.getByRole("link", { name: "Wishlist" }).click();
  await expect(page).toHaveURL(/\/wishlist/);
  await expect(page.getByRole("button", { name: "Cancel live run" })).toHaveCount(0);
  const activeIntervalsAfterUnmount = await page.evaluate(() =>
    (
      window as typeof window & { __pollIntervals: Array<{ id: number; startedAt: number }> }
    ).__pollIntervals.map(({ id }) => id),
  );
  expect(activeIntervalsAfterUnmount.some((id) => outgoingIntervals.includes(id))).toBe(false);
  await page.evaluate(() => {
    const target = window as typeof window & { __releaseProgress?: () => void };
    target.__releaseProgress?.();
    target.__releaseProgress = undefined;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { __redundancyCalls: Array<{ url: string }> }
          ).__redundancyCalls.filter((entry) => entry.url.endsWith("/refresh-status")).length,
      ),
    )
    .toBe(coverageCallsBeforeUnmount);
  const outgoingTimerTicks = await page.evaluate((ids) => {
    const counts = (
      window as typeof window & { __pollTimerTicksByInterval: Record<number, number> }
    ).__pollTimerTicksByInterval;
    return Object.fromEntries(ids.map((id) => [id, counts[id] ?? 0]));
  }, outgoingIntervals);
  await page.clock.fastForward(120_000);
  expect(
    await page.evaluate((ids) => {
      const counts = (
        window as typeof window & { __pollTimerTicksByInterval: Record<number, number> }
      ).__pollTimerTicksByInterval;
      return Object.fromEntries(ids.map((id) => [id, counts[id] ?? 0]));
    }, outgoingIntervals),
  ).toEqual(outgoingTimerTicks);
});
