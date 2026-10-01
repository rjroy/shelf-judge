import { expect, test } from "@playwright/test";

test("redundancy disclosure is inspectable, C-only can be declined, and layout fits", async ({
  page,
}, testInfo) => {
  await page.context().addInitScript(() => {
    const fixtureExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const target = window as typeof window & {
      __redundancyCalls: Array<{ url: string; method: string; body?: unknown }>;
    };
    target.__redundancyCalls = [];
    let disclosureAttempts = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input, location.origin);
        if (!url.pathname.startsWith("/api/daemon/redundancy/")) return originalFetch(input, init);
        const body =
          typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
        target.__redundancyCalls.push({ url: url.pathname, method: init?.method ?? "GET", body });
        let response: unknown = {};
        if (url.pathname.endsWith("/settings") && init?.method === "PATCH") response = body;
        else if (url.pathname.endsWith("/semantic-settings")) {
          const patch = body as {
            enabled?: boolean;
            weights?: { factual: number; description: number; ownerNote: number };
            cachedOwnerNoteUse?: boolean;
          };
          response = {
            settings: {
              enabled: patch.enabled ?? true,
              weights: patch.weights ?? { factual: 7, description: 5, ownerNote: 10 },
              cachedOwnerNoteUse: patch.cachedOwnerNoteUse ?? false,
            },
          };
        } else if (url.pathname.endsWith("/settings"))
          response = {
            enabled: true,
            stage: "annotation",
            similarityThreshold: 0.6,
            maxPenalty: 2,
            componentWeights: { binary: 4 / 7, continuous: 3 / 7 },
            minNeighbors: 1,
            expectedNeighbors: 5,
            semantic: {
              settings: {
                enabled: true,
                weights: { factual: 7, description: 5, ownerNote: 10 },
                cachedOwnerNoteUse: false,
              },
              status: { status: "not-ready", publicationStatus: "not-ready" },
            },
          };
        else if (url.pathname.endsWith("/refresh-status")) {
          const state = localStorage.getItem("fixture-refresh-state");
          const id = localStorage.getItem("fixture-status-id");
          const digest = localStorage.getItem("fixture-status-digest");
          response =
            state === "running" || state === "cancelled"
              ? {
                  status: "not-ready",
                  publicationStatus: "not-ready",
                  manifest: {
                    id,
                    digest,
                    signalScope: "description-only",
                    expiresAt: fixtureExpiresAt,
                  },
                  pairCount: 2,
                  execution: {
                    commandId: id,
                    status: state,
                    attemptCount: 1,
                    completedPairCount: 0,
                    failedPairCount: 0,
                  },
                }
              : { status: "not-ready", publicationStatus: "not-ready" };
        } else if (url.pathname.endsWith("/summary")) {
          const state = localStorage.getItem("fixture-refresh-state");
          const id = localStorage.getItem("fixture-summary-id");
          const digest = localStorage.getItem("fixture-summary-digest");
          response = {
            status: "not-ready",
            generation: null,
            disclosure:
              state && id
                ? {
                    id,
                    digest,
                    pairCount: 2,
                    notePairCount: 1,
                    expiresAt: fixtureExpiresAt,
                  }
                : null,
          };
        } else if (url.pathname.endsWith("/disclosure")) {
          disclosureAttempts += 1;
          if (disclosureAttempts === 4)
            return new Response(JSON.stringify({ error: "Simulated disclosure interruption" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          response = {
            id: "manifest-1",
            digest: "digest-1",
            signalScope: (body as { signalScope: string }).signalScope,
            providerId: "jev",
            modelId: "pinned-model",
            budget: { maxRequests: 20, maxTokens: 4000, maxDurationMs: 60000 },
            expiresAt: fixtureExpiresAt,
            pairCount: 2,
            notePairCount: 1,
            pageSize: 100,
          };
        } else if (url.pathname.endsWith("/disclosure/page"))
          response = {
            manifestId: "manifest-1",
            manifestDigest: "digest-1",
            offset: (body as { offset: number }).offset,
            nextOffset: (body as { offset: number }).offset + 1,
            complete: (body as { offset: number }).offset === 1,
            pairs: [
              (body as { offset: number }).offset === 0
                ? {
                    gameA: "game-a",
                    gameB: "game-b",
                    hasDescriptionA: true,
                    hasDescriptionB: true,
                    hasOwnerNoteA: true,
                    hasOwnerNoteB: true,
                  }
                : {
                    gameA: "game-c",
                    gameB: "game-d",
                    hasDescriptionA: false,
                    hasDescriptionB: true,
                    hasOwnerNoteA: false,
                    hasOwnerNoteB: false,
                  },
            ],
            receipt: "receipt",
          };
        else if (url.pathname.endsWith("/acknowledge-and-start")) {
          localStorage.setItem("fixture-refresh-state", "running");
          localStorage.setItem("fixture-status-id", "manifest-1");
          localStorage.setItem("fixture-status-digest", "digest-1");
          localStorage.setItem("fixture-summary-id", "manifest-1");
          localStorage.setItem("fixture-summary-digest", "digest-1");
          response = {
            disposition: "REPLAYED",
            status: "running",
            commandId: "manifest-1",
            deadlineAt: fixtureExpiresAt,
          };
        } else if (url.pathname.endsWith("/cancel")) {
          localStorage.setItem("fixture-refresh-state", "cancelled");
          response = { outcome: "accepted" };
        }
        return new Response(JSON.stringify(response), {
          status: url.pathname.endsWith("/cancel")
            ? 200
            : url.pathname.endsWith("/disclosure")
              ? 201
              : url.pathname.endsWith("/acknowledge-and-start")
                ? 202
                : 200,
          headers: { "content-type": "application/json" },
        });
      },
      { preconnect: originalFetch.preconnect },
    );
  });
  await page.goto("/redundancy");
  await expect(page.getByRole("heading", { name: "Redundancy scoring" })).toBeVisible();
  await expect(page.getByText(/Not ready/)).toBeVisible();
  await expect(page.getByText(/only action that contacts JEV/i)).toBeVisible();
  await expect(page.locator(".topbar").getByRole("button")).toHaveCount(0);
  await page.getByLabel("BoardGameGeek descriptions weight").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Save similarity preferences" })).toBeEnabled();
  await page.getByRole("button", { name: "Save similarity preferences" }).click();
  await expect(page.getByRole("button", { name: "Save similarity preferences" })).toHaveCount(0);
  await expect(
    page.getByText(/Similarity preferences saved · Stored on this Shelf Judge instance/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Integrated" }).click();
  await expect(page.getByRole("button", { name: "Prepare pair list (offline)" })).toBeDisabled();
  await expect(page.getByText(/Save factual scoring settings before preparing/i)).toBeVisible();
  await page.getByRole("button", { name: "Save factual scoring settings" }).click();
  await expect(page.getByRole("button", { name: "Save factual scoring settings" })).toHaveCount(0);
  const factualPatch = await page.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; method: string; body?: Record<string, unknown> }>;
      }
    ).__redundancyCalls.find((call) => call.url.endsWith("/settings") && call.method === "PATCH"),
  );
  expect(Object.keys(factualPatch?.body ?? {}).sort()).toEqual([
    "componentWeights",
    "enabled",
    "expectedNeighbors",
    "maxPenalty",
    "minNeighbors",
    "similarityThreshold",
    "stage",
  ]);
  await page.getByLabel("Evidence sent for this execution").selectOption("description-only");
  await page.getByRole("button", { name: "Prepare pair list (offline)" }).click();
  await expect(
    page.getByRole("region", { name: "Complete disclosed game-pair manifest" }),
  ).toContainText("game-a");
  await expect(
    page.getByRole("region", { name: "Complete disclosed game-pair manifest" }),
  ).toContainText("A present");
  await expect(
    page.getByRole("region", { name: "Complete disclosed game-pair manifest" }),
  ).toContainText("game-d");
  await expect(page.getByText(/no note text is displayed/i)).toBeVisible();
  await expect(page.getByText(/BGG descriptions only: no owner-note text/i)).toBeVisible();
  await expect(page.getByLabel(/permit transmitting owner notes/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Authorize one JEV refresh" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Authorize one JEV refresh" })).toBeInViewport();
  await expect(page.getByText("Showing pairs 1–2 of 2")).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Manifest page controls" })
      .getByRole("button", { name: "Next pair page" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Complete disclosed game-pair manifest" }),
  ).toHaveCSS("max-height", "none");
  await page.getByLabel("Allow previously cached comparisons informed by my notes").check();
  await expect(page.getByRole("button", { name: "Prepare pair list (offline)" })).toBeDisabled();
  await expect(page.getByText(/Save similarity preferences before preparing/i)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Complete disclosed game-pair manifest" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save similarity preferences" }).click();
  await expect(page.getByRole("button", { name: "Prepare pair list (offline)" })).toBeEnabled();
  await page.getByRole("button", { name: "Prepare pair list (offline)" }).click();
  await expect(page.getByRole("button", { name: "Authorize one JEV refresh" })).toBeInViewport();
  const beforeDecline = await page.evaluate(
    () =>
      (
        window as typeof window & { __redundancyCalls: Array<{ url: string }> }
      ).__redundancyCalls.filter((call) => call.url.endsWith("acknowledge-and-start")).length,
  );
  expect(beforeDecline).toBe(0); // leaving the authorization unchecked declines transmission
  await expect(
    page.getByRole("region", { name: "Complete disclosed game-pair manifest" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.waitForTimeout(100);
  await page.screenshot({
    path: testInfo.outputPath(`redundancy-authorization-${testInfo.project.name}.png`),
  });
  await page.locator(".main-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: testInfo.outputPath(`redundancy-overview-${testInfo.project.name}.png`),
  });
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
  await page.getByLabel(/reviewed all 2 pairs/).check();
  await page.getByRole("button", { name: "Authorize one JEV refresh" }).click();
  await expect(page.getByText(/recognized this request as a replay/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Refresh progress" })).toBeVisible();
  await expect(page.getByText(/0 of 2 pairs complete/)).toBeVisible();
  const authorization = await page.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; body?: { noteTransmissionAuthorized?: boolean } }>;
      }
    ).__redundancyCalls.find((call) => call.url.endsWith("acknowledge-and-start")),
  );
  expect(authorization?.body?.noteTransmissionAuthorized).toBe(false);
  await page.getByRole("button", { name: "Cancel refresh" }).click();
  await expect(page.getByText(/Refresh: cancelled/)).toBeVisible();
  await page.getByLabel("Use semantic comparisons in scoring").uncheck();
  await page.getByRole("button", { name: "Save similarity preferences" }).click();
  await expect(page.getByText("Semantic comparison is off")).toBeVisible();
  const semanticRevocation = await page.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; method: string; body?: { enabled?: boolean } }>;
      }
    ).__redundancyCalls.find(
      (call) =>
        call.url.endsWith("/semantic-settings") &&
        call.method === "PATCH" &&
        call.body?.enabled === false,
    ),
  );
  expect(semanticRevocation?.body?.enabled).toBe(false);
  await page.getByLabel("Use semantic comparisons in scoring").check();
  await page.getByRole("button", { name: "Save similarity preferences" }).click();
  await page
    .getByLabel("Evidence sent for this execution")
    .selectOption("description-and-owner-notes");
  await page.getByRole("button", { name: "Prepare pair list (offline)" }).click();
  await expect(page.getByLabel(/permit transmitting owner notes/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize one JEV refresh" })).toBeDisabled();
  await page.getByLabel(/permit transmitting owner notes/).check();
  await page.getByLabel(/permit use of cached note-derived judgments/).check();
  await page.getByRole("button", { name: "Prepare pair list (offline)" }).click();
  await expect(page.locator(".error-banner")).toContainText("Simulated disclosure interruption");
  await page.getByRole("button", { name: "Prepare pair list (offline)" }).click();
  await expect(page.getByLabel(/permit transmitting owner notes/)).not.toBeChecked();
  await expect(page.getByLabel(/permit use of cached note-derived judgments/)).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Authorize one JEV refresh" })).toBeDisabled();
  await page.getByLabel("Evidence sent for this execution").selectOption("owner-notes-only");
  await page.getByRole("button", { name: "Prepare pair list (offline)" }).click();
  await expect(page.getByText(/D-only · owner notes; no descriptions/)).toBeVisible();
  await expect(page.getByLabel(/permit transmitting owner notes/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize one JEV refresh" })).toBeDisabled();

  // First request reads A from status then B from summary with colliding counts
  // and expiry. Cancellation must remain closed until the IDs and digests match.
  await page.evaluate(() => {
    localStorage.setItem("fixture-refresh-state", "running");
    localStorage.setItem("fixture-status-id", "run-a");
    localStorage.setItem("fixture-status-digest", "digest-a");
    localStorage.setItem("fixture-summary-id", "run-b");
    localStorage.setItem("fixture-summary-digest", "digest-b");
  });
  const freshPage = await page.context().newPage();
  await freshPage.goto("/redundancy");
  await expect(freshPage.getByRole("heading", { name: "Refresh progress" })).toBeVisible();
  await expect(freshPage.getByRole("button", { name: "Cancel refresh" })).toBeDisabled();
  await expect(freshPage.getByText(/does not match the current disclosure/i)).toBeVisible();
  expect(await freshPage.evaluate(() => sessionStorage.length)).toBe(0);
  await freshPage.evaluate(() =>
    sessionStorage.setItem("shelf-judge:redundancy-refresh-command", "stale-session-run"),
  );
  await page.evaluate(() => {
    localStorage.setItem("fixture-status-id", "run-b");
    localStorage.setItem("fixture-status-digest", "digest-b");
  });
  await freshPage.reload();
  const cancelButton = freshPage.getByRole("button", { name: "Cancel refresh" });
  await expect(cancelButton).toBeEnabled();
  await cancelButton.focus();
  await freshPage.keyboard.press("Enter");
  await expect(freshPage.getByText(/Refresh: cancelled/)).toBeVisible();
  const recoveredCancel = await freshPage.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; body?: { commandId?: string } }>;
      }
    ).__redundancyCalls.find((call) => call.url.endsWith("/cancel")),
  );
  expect(recoveredCancel?.body?.commandId).toBe("run-b");
});

test("large manifests paginate without a nested vertical scroll trap", async ({ page }) => {
  await page.addInitScript(() => {
    const fixturePairs = Array.from({ length: 51 }, (_, index) => ({
      gameA: `Game ${String(index + 1).padStart(2, "0")}`,
      gameB: `Neighbor ${String(index + 1).padStart(2, "0")}`,
      hasDescriptionA: true,
      hasDescriptionB: index % 2 === 0,
      hasOwnerNoteA: false,
      hasOwnerNoteB: false,
    }));
    const originalFetch = window.fetch.bind(window);
    window.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input, location.origin);
        if (!url.pathname.startsWith("/api/daemon/redundancy/")) return originalFetch(input, init);
        let response: unknown = {};
        let status = 200;
        if (url.pathname.endsWith("/settings"))
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
            },
          };
        else if (url.pathname.endsWith("/refresh-status"))
          response = { status: "not-ready", publicationStatus: "not-ready" };
        else if (url.pathname.endsWith("/summary")) response = { disclosure: null };
        else if (url.pathname.endsWith("/disclosure")) {
          const body = JSON.parse(String(init?.body)) as { signalScope: string };
          response = {
            id: "large-manifest",
            digest: "large-manifest-digest",
            signalScope: body.signalScope,
            providerId: "jev",
            modelId: "pinned-model",
            budget: { maxRequests: 20, maxTokens: 4000, maxDurationMs: 60000 },
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            pairCount: fixturePairs.length,
            notePairCount: 0,
            pageSize: fixturePairs.length,
          };
          status = 201;
        } else if (url.pathname.endsWith("/disclosure/page"))
          response = {
            nextOffset: fixturePairs.length,
            complete: true,
            pairs: fixturePairs,
          };
        return new Response(JSON.stringify(response), {
          status,
          headers: { "content-type": "application/json" },
        });
      },
      { preconnect: originalFetch.preconnect },
    );
  });

  await page.goto("/redundancy");
  await page.getByRole("button", { name: "Prepare pair list (offline)" }).click();
  const manifest = page.getByRole("region", { name: "Complete disclosed game-pair manifest" });
  await expect(manifest).toContainText("Game 01");
  await expect(page.getByText("Showing pairs 1–50 of 51")).toBeVisible();
  await expect(manifest.locator("tbody tr")).toHaveCount(50);
  await expect(manifest).toHaveCSS("max-height", "none");
  expect(await manifest.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  await expect(manifest).toHaveCSS("overflow-x", "auto");
  await expect(page.getByRole("button", { name: "Authorize one JEV refresh" })).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth),
  ).toBe(true);

  const next = page
    .getByRole("group", { name: "Manifest page controls", exact: true })
    .getByRole("button", { name: "Next pair page" });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Showing pairs 51–51 of 51")).toBeVisible();
  await expect(manifest.locator("tbody tr")).toHaveCount(1);
  await expect(manifest).toContainText("Game 51");
  await expect(
    page.getByRole("group", { name: "Manifest page controls after table" }).getByRole("button", {
      name: "Previous pair page",
    }),
  ).toBeEnabled();
});
