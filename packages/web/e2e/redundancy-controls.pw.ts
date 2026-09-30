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
          const patch = body as { enabled?: boolean };
          response = {
            settings: {
              enabled: patch.enabled ?? true,
              weights: { factual: 7, description: 5, ownerNote: 10 },
              cachedOwnerNoteUse: false,
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
          if (disclosureAttempts === 3)
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
  await page.getByRole("button", { name: "Integrated" }).click();
  await page.getByRole("button", { name: "Save factual settings" }).click();
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
  await page.getByRole("button", { name: "Prepare exact pair list" }).click();
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
  await expect(page.getByLabel(/permit transmitting owner notes/)).toHaveCount(0);
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
  await page.locator(".main-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  await page.screenshot({
    path: testInfo.outputPath(`redundancy-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
  await page.getByLabel(/reviewed all 2 pairs/).check();
  await page.getByRole("button", { name: "Authorize one refresh" }).click();
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
  await page.getByLabel("Use semantic similarity in scoring").uncheck();
  await page.getByRole("button", { name: "Save similarity preferences" }).click();
  await expect(page.getByText("Semantic comparison is off")).toBeVisible();
  const semanticRevocation = await page.evaluate(() =>
    (
      window as typeof window & {
        __redundancyCalls: Array<{ url: string; method: string; body?: { enabled?: boolean } }>;
      }
    ).__redundancyCalls.find(
      (call) => call.url.endsWith("/semantic-settings") && call.method === "PATCH",
    ),
  );
  expect(semanticRevocation?.body?.enabled).toBe(false);
  await page.getByLabel("Use semantic similarity in scoring").check();
  await page.getByRole("button", { name: "Save similarity preferences" }).click();
  await page
    .getByLabel("Evidence sent for this execution")
    .selectOption("description-and-owner-notes");
  await page.getByRole("button", { name: "Prepare exact pair list" }).click();
  await expect(page.getByLabel(/permit transmitting owner notes/)).toBeVisible();
  await page.getByLabel(/permit transmitting owner notes/).check();
  await page.getByLabel(/permit use of cached note-derived judgments/).check();
  await page.getByRole("button", { name: "Prepare exact pair list" }).click();
  await expect(page.locator(".error-banner")).toContainText("Simulated disclosure interruption");
  await page.getByRole("button", { name: "Prepare exact pair list" }).click();
  await expect(page.getByLabel(/permit transmitting owner notes/)).not.toBeChecked();
  await expect(page.getByLabel(/permit use of cached note-derived judgments/)).not.toBeChecked();

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
