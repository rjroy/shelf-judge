import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";

const gameId = "game-4";
const gamePath = `/games/${gameId}`;
const hostilePrefix =
  '<img src=x onerror="window.__ownerNoteExecuted=true"><script>alert(1)</script>';

interface NetworkEvidence {
  externalRequests: string[];
  daemonRequests: string[];
}

interface FixtureState {
  notes: Record<
    string,
    { state: string; version: number; updatedAt: string | null; text?: string }
  >;
  receipts: Array<{
    commandId: string;
    gameId: string;
    operation: "set" | "clear";
    expectedVersion: number;
    requestFingerprint: string;
    accepted: {
      commandId: string;
      gameId: string;
      operation: "set" | "clear";
      version: number;
      collectionRevision: number;
    };
  }>;
  persistedState: unknown;
  collectionRevision: number;
  mutationBodies: Array<{
    method: string;
    gameId: string;
    body: Record<string, unknown>;
  }>;
  restartCount: number;
}

const test = base.extend<{ networkEvidence: NetworkEvidence }>({
  networkEvidence: [
    async ({ page }, use) => {
      const evidence: NetworkEvidence = { externalRequests: [], daemonRequests: [] };
      await guardNetwork(page.context(), evidence);
      await use(evidence);
      expect(evidence.externalRequests).toEqual([]);
      expect(evidence.daemonRequests.every((path) => path.startsWith("/api/daemon/"))).toBe(true);
    },
    { auto: true },
  ],
});

async function guardNetwork(context: BrowserContext, evidence: NetworkEvidence): Promise<void> {
  await context.route("**/*", async (route) => {
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
    if (url.pathname.includes("/api/")) evidence.daemonRequests.push(url.pathname);
    await route.continue();
  });
}

async function reset(page: Page): Promise<void> {
  const response = await page.request.post("/api/daemon/test/reset", {
    data: { scenario: "owner-notes" },
  });
  expect(response.ok()).toBe(true);
}

async function control(page: Page, data: Record<string, unknown>): Promise<void> {
  const response = await page.request.post("/api/daemon/test/owner-note-state", { data });
  expect(response.ok()).toBe(true);
}

async function fixtureState(page: Page): Promise<FixtureState> {
  const response = await page.request.get("/api/daemon/test/owner-note-state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as FixtureState;
}

async function restartFixture(page: Page): Promise<void> {
  const response = await page.request.post("/api/daemon/test/owner-note-restart");
  expect(response.ok()).toBe(true);
}

function editor(page: Page): Locator {
  return page.locator(".owner-note-panel");
}

function textarea(page: Page): Locator {
  return page.getByLabel("Owner note text");
}

function containsObjectKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsObjectKey(entry, key));
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([entryKey, entryValue]) => entryKey === key || containsObjectKey(entryValue, key),
  );
}

async function save(page: Page, text: string): Promise<void> {
  await textarea(page).fill(text);
  await page.getByRole("button", { name: "Save note" }).click();
}

async function expectSaved(page: Page, text: string): Promise<void> {
  await expect(editor(page)).toContainText("Owner note saved.");
  await expect(textarea(page)).toHaveValue(text);
  await expect(editor(page)).toBeFocused();
}

async function expectNoOverflowOrClipping(page: Page): Promise<void> {
  const failures = await page.evaluate(() => {
    const panel = document.querySelector(".owner-note-panel");
    if (panel === null) return [{ element: "missing owner note panel" }];
    const viewportWidth = document.documentElement.clientWidth;
    return [
      document.documentElement,
      document.body,
      panel,
      ...Array.from(panel.querySelectorAll("*")),
    ]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0;
      })
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          element.scrollWidth > element.clientWidth + 1 ||
          rect.left < -1 ||
          rect.right > viewportWidth + 1
        );
      })
      .map((element) => ({
        element:
          element === document.documentElement ? "html" : `${element.tagName}.${element.className}`,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        viewportWidth,
      }));
  });
  expect(failures).toEqual([]);
}

async function expectEnabledTargetsAtLeast44(page: Page): Promise<void> {
  const undersized = await editor(page)
    .locator("button:enabled, textarea:enabled")
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: element.textContent || element.getAttribute("aria-label"),
            width: rect.width,
            height: rect.height,
          };
        })
        .filter(({ width, height }) => width < 44 || height < 44),
    );
  expect(undersized).toEqual([]);
}

async function expectVisibleFocus(control: Locator): Promise<void> {
  await control.focus();
  await expect(control).toBeFocused();
  const focus = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(focus.style).not.toBe("none");
  expect(focus.width).toBeGreaterThanOrEqual(2);
}

async function reachByKeyboard(page: Page, control: Locator): Promise<void> {
  await page.locator("body").focus();
  for (
    let index = 0;
    index < 100 && !(await control.evaluate((element) => element === document.activeElement));
    index += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expectVisibleFocus(control);
}

function desktopBehaviorOnly(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Lifecycle behavior is viewport-independent",
  );
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "chromium-native-page-zoom-200",
    "Native zoom has a dedicated persistent-context test",
  );
  await reset(page);
  await page.addInitScript(() => {
    Reflect.set(window, "__ownerNoteExecuted", false);
  });
});

test("create, equal save, edit, clear, failure retry, and draft validation preserve exact state", async ({
  page,
}, testInfo) => {
  desktopBehaviorOnly(testInfo);
  await page.goto(gamePath);
  await expect(editor(page)).toContainText("Never authored");
  await save(page, "Superseded receipt sentinel");
  await expectSaved(page, "Superseded receipt sentinel");
  const firstAccepted = await fixtureState(page);
  expect(firstAccepted.notes[gameId]?.version).toBe(1);
  expect(JSON.stringify(firstAccepted.receipts)).not.toContain("Superseded receipt sentinel");

  const equalResponse = await page.request.put(`/api/daemon/games/${gameId}/note`, {
    data: {
      commandId: "44000000-0000-4000-8000-000000000009",
      expectedVersion: 1,
      text: "Superseded receipt sentinel",
    },
  });
  expect(equalResponse.ok()).toBe(true);
  await page.reload();
  await expect(textarea(page)).toHaveValue("Superseded receipt sentinel");
  expect((await fixtureState(page)).notes[gameId]?.version).toBe(2);

  await control(page, { failNextMutation: true });
  await save(page, "Draft retained through persistence failure");
  await expect(editor(page).getByRole("alert")).toContainText(
    "Injected owner note persistence failure",
  );
  await expect(textarea(page)).toHaveValue("Draft retained through persistence failure");
  await page.getByRole("button", { name: "Save note" }).click();
  await expectSaved(page, "Draft retained through persistence failure");
  const superseded = await fixtureState(page);
  expect(JSON.stringify(superseded.receipts)).not.toContain("Superseded receipt sentinel");
  expect(JSON.stringify(superseded.persistedState)).not.toContain("Superseded receipt sentinel");
  expect(superseded.notes[gameId]?.text).toBe("Draft retained through persistence failure");
  await restartFixture(page);
  const reconstructedSuperseded = await fixtureState(page);
  expect(JSON.stringify(reconstructedSuperseded.receipts)).not.toContain(
    "Superseded receipt sentinel",
  );
  expect(JSON.stringify(reconstructedSuperseded.persistedState)).not.toContain(
    "Superseded receipt sentinel",
  );
  expect(reconstructedSuperseded.notes[gameId]?.text).toBe(
    "Draft retained through persistence failure",
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear note" }).click();
  await expect(editor(page)).toContainText("Owner note cleared.");
  await expect(editor(page)).toContainText("Cleared");

  await textarea(page).fill("   ");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(textarea(page)).toHaveValue("   ");
  await expect(textarea(page)).toHaveAttribute("aria-invalid", "true");
  await expect(textarea(page)).toHaveAttribute("aria-describedby", /owner-note-error/);
  await expect(page.locator("#owner-note-error")).toContainText("whitespace");
  await expect(textarea(page)).toBeFocused();
});

test("two clients expose complete conflicts and support keeping or loading either version", async ({
  page,
  context,
}, testInfo) => {
  desktopBehaviorOnly(testInfo);
  await page.goto(gamePath);
  const second = await context.newPage();
  await second.goto(gamePath);
  await save(page, "Saved by client one");
  await expectSaved(page, "Saved by client one");

  await save(second, "Complete local draft from client two");
  const conflict = editor(second).locator(".owner-note-conflict");
  await expect(conflict).toContainText("Complete local draft from client two");
  await expect(conflict).toContainText("Saved by client one");
  await expect(second.getByRole("button", { name: "Save note" })).toBeDisabled();
  await second.getByRole("button", { name: "Keep my draft" }).click();
  await expect(textarea(second)).toHaveValue("Complete local draft from client two");
  await expect(textarea(second)).toBeFocused();
  await second.getByRole("button", { name: "Save note" }).click();
  await expectSaved(second, "Complete local draft from client two");

  await reset(page);
  await page.reload();
  await second.reload();
  await save(page, "New saved choice");
  await save(second, "Draft to discard");
  second.once("dialog", (dialog) => dialog.accept());
  await second.getByRole("button", { name: "Load saved note" }).click();
  await expect(textarea(second)).toHaveValue("New saved choice");
  await expect(textarea(second)).toBeFocused();
  await expect(editor(second)).toContainText("discarded the local draft");
  await second.close();
});

test("dirty navigation warns before leaving", async ({ page }, testInfo) => {
  desktopBehaviorOnly(testInfo);
  await page.goto(gamePath);
  await textarea(page).fill("Unsaved navigation draft");
  const dialogPromise = page.waitForEvent("dialog");
  const navigation = page.goto("/").catch((error: unknown) => error);
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(page).toHaveURL(new RegExp(`${gamePath}$`));
  await navigation;
  await expect(textarea(page)).toHaveValue("Unsaved navigation draft");
});

test("ownership transition preserves editable notes and deletion disclosure is conditional", async ({
  page,
}, testInfo) => {
  desktopBehaviorOnly(testInfo);
  await page.goto(gamePath);
  const deletionDisclosure = page.locator(".danger-zone .danger-desc");
  await expect(deletionDisclosure).toHaveText(
    "Permanently removes all ratings, history, and data. This cannot be undone.",
  );
  await expect(deletionDisclosure).not.toContainText("Owner note");
  await expect(deletionDisclosure).not.toContainText("note cannot be restored");
  await save(page, "Note survives ownership changes");
  await expect(deletionDisclosure).toHaveText(
    "Permanently removes all ratings, history, data, and the current Owner note. The note cannot be restored by Shelf Judge.",
  );

  await page.getByRole("button", { name: "Mark as Previously Owned" }).click();
  await expect(page.getByText("Previously Owned", { exact: true }).first()).toBeVisible();
  await expect(textarea(page)).toHaveValue("Note survives ownership changes");
  await save(page, "Edited while previously owned");
  await expectSaved(page, "Edited while previously owned");

  await control(page, { blockDeletionGameId: gameId, intentionIds: ["intention-history-1"] });
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Owner note will also be deleted");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Remove from Collection" }).click();
  await expect(page.locator(".action-section .error-banner")).toContainText(
    "play-intention history",
  );
  await expect(textarea(page)).toHaveValue("Edited while previously owned");

  await control(page, { unblockDeletionGameId: gameId });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove from Collection" }).click();
  await expect(page).toHaveURL("/");
  const state = await fixtureState(page);
  expect(state.notes[gameId]).toBeUndefined();
  expect(state.receipts.filter((receipt) => receipt.gameId === gameId)).toEqual([]);
});

test("dropped accepted response replays after restart with the same command and revision", async ({
  page,
}, testInfo) => {
  desktopBehaviorOnly(testInfo);
  await page.goto(gamePath);
  await control(page, { dropNextAcceptedResponse: true });
  await save(page, "Accepted before transport loss");
  await expect(editor(page).getByRole("alert")).toContainText("Retry without changing the request");
  const accepted = await fixtureState(page);
  expect(accepted.notes[gameId]?.text).toBe("Accepted before transport loss");
  expect(accepted.receipts).toHaveLength(1);
  const commandId = accepted.mutationBodies[0]?.body.commandId;
  const revision = accepted.collectionRevision;
  expect(JSON.stringify(accepted.receipts)).not.toContain("Accepted before transport loss");

  await restartFixture(page);
  const reconstructed = await fixtureState(page);
  expect(reconstructed.restartCount).toBe(1);
  expect(reconstructed.mutationBodies).toEqual([]);
  expect(reconstructed.notes[gameId]?.text).toBe("Accepted before transport loss");
  expect(reconstructed.receipts).toHaveLength(1);
  expect(JSON.stringify(reconstructed.receipts)).not.toContain("Accepted before transport loss");
  expect(JSON.stringify(reconstructed.persistedState)).toContain("Accepted before transport loss");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(editor(page)).toContainText("Replayed the original accepted command.");
  const replayed = await fixtureState(page);
  expect(replayed.restartCount).toBe(1);
  expect(replayed.collectionRevision).toBe(revision);
  expect(replayed.notes[gameId]?.version).toBe(1);
  expect(replayed.mutationBodies.map(({ body }) => body.commandId)).toEqual([commandId]);
  expect(replayed.receipts[0]?.accepted.collectionRevision).toBe(revision);
});

test("canonical fingerprint and normalized set/clear replay survive reconstruction without plaintext receipts", async ({
  page,
}, testInfo) => {
  desktopBehaviorOnly(testInfo);
  const setCommandId = "44000000-0000-4000-8000-000000000021";
  const clearCommandId = "44000000-0000-4000-8000-000000000022";
  const submittedText = "Cleared receipt sentinel\r\nLine two\rLine three";
  const normalizedText = "Cleared receipt sentinel\nLine two\nLine three";
  const canonicalRequest = `shelf-judge.owner-game-note.v1\n${JSON.stringify({
    operation: "set",
    gameId,
    expectedVersion: 0,
    text: normalizedText,
  })}`;
  const expectedFingerprint = createHash("sha256").update(canonicalRequest).digest("hex");

  const setResponse = await page.request.put(`/api/daemon/games/${gameId}/note`, {
    data: { commandId: setCommandId, expectedVersion: 0, text: submittedText },
  });
  expect(setResponse.ok()).toBe(true);
  const acceptedSetState = await fixtureState(page);
  const setReceipt = acceptedSetState.receipts.find(({ commandId }) => commandId === setCommandId);
  expect(setReceipt?.requestFingerprint).toBe(expectedFingerprint);
  expect(setReceipt?.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(containsObjectKey(setReceipt, "text")).toBe(false);
  expect(acceptedSetState.notes[gameId]).toMatchObject({
    state: "present",
    version: 1,
    text: normalizedText,
  });
  const setRevision = acceptedSetState.collectionRevision;

  await restartFixture(page);
  const setReplayResponse = await page.request.put(`/api/daemon/games/${gameId}/note`, {
    data: { commandId: setCommandId, expectedVersion: 0, text: normalizedText },
  });
  expect(setReplayResponse.ok()).toBe(true);
  const setReplayPayload: unknown = await setReplayResponse.json();
  expect(setReplayPayload).toMatchObject({
    ok: true,
    accepted: {
      commandId: setCommandId,
      gameId,
      operation: "set",
      version: 1,
      collectionRevision: setRevision,
      replayed: true,
    },
  });
  const replayedSetState = await fixtureState(page);
  expect(replayedSetState.collectionRevision).toBe(setRevision);
  expect(replayedSetState.notes[gameId]?.version).toBe(1);

  const clearResponse = await page.request.delete(`/api/daemon/games/${gameId}/note`, {
    data: { commandId: clearCommandId, expectedVersion: 1 },
  });
  expect(clearResponse.ok()).toBe(true);
  const clearedState = await fixtureState(page);
  const clearRevision = clearedState.collectionRevision;
  expect(clearedState.notes[gameId]).toMatchObject({ state: "cleared", version: 2 });
  expect(JSON.stringify(clearedState.receipts)).not.toContain("Cleared receipt sentinel");
  expect(JSON.stringify(clearedState.persistedState)).not.toContain("Cleared receipt sentinel");
  expect(containsObjectKey(clearedState.receipts, "text")).toBe(false);

  await restartFixture(page);
  const reconstructedClearState = await fixtureState(page);
  expect(reconstructedClearState.notes[gameId]).toMatchObject({ state: "cleared", version: 2 });
  expect(JSON.stringify(reconstructedClearState.receipts)).not.toContain(
    "Cleared receipt sentinel",
  );
  expect(JSON.stringify(reconstructedClearState.persistedState)).not.toContain(
    "Cleared receipt sentinel",
  );
  const clearReplayResponse = await page.request.delete(`/api/daemon/games/${gameId}/note`, {
    data: { commandId: clearCommandId, expectedVersion: 1 },
  });
  expect(clearReplayResponse.ok()).toBe(true);
  const clearReplayPayload: unknown = await clearReplayResponse.json();
  expect(clearReplayPayload).toMatchObject({
    ok: true,
    accepted: {
      commandId: clearCommandId,
      gameId,
      operation: "clear",
      state: "cleared",
      version: 2,
      collectionRevision: clearRevision,
      replayed: true,
    },
  });
  const replayedClearState = await fixtureState(page);
  expect(replayedClearState.collectionRevision).toBe(clearRevision);
  expect(replayedClearState.notes[gameId]).toMatchObject({ state: "cleared", version: 2 });
});

test("delayed mutation cannot overwrite a newer external note and keeps the local draft", async ({
  page,
}, testInfo) => {
  desktopBehaviorOnly(testInfo);
  await page.goto(gamePath);
  await control(page, { delayNextMutation: true });
  await save(page, "Local draft held in flight");
  await expect(textarea(page)).toBeDisabled();
  await control(page, { externalGameId: gameId, externalText: "Newer external complete text" });
  await control(page, { releaseMutation: true });
  await expect(editor(page).locator(".owner-note-conflict")).toContainText(
    "Local draft held in flight",
  );
  await expect(editor(page).locator(".owner-note-conflict")).toContainText(
    "Newer external complete text",
  );
  await expect(textarea(page)).toHaveValue("Local draft held in flight");
});

test("responsive hostile 10,000-code-point conflict is inert, complete, accessible, and unclipped", async ({
  page,
}) => {
  const local = `${hostilePrefix}${"L".repeat(10_000 - [...hostilePrefix].length)}`;
  const saved = "S".repeat(10_000);
  await page.goto(gamePath);
  await control(page, { externalGameId: gameId, externalText: saved });
  await save(page, local);

  const conflict = editor(page).locator(".owner-note-conflict");
  await expect(conflict.locator("pre").nth(0)).toHaveText(local);
  await expect(conflict.locator("pre").nth(1)).toHaveText(saved);
  await expect(editor(page).locator("img, script, a")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "__ownerNoteExecuted") === true)).toBe(
    false,
  );
  await expect(textarea(page)).toHaveAttribute(
    "aria-describedby",
    "owner-note-help owner-note-count",
  );
  await expect(editor(page).locator(".owner-note-live-status")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await expect(editor(page).getByRole("alert")).toContainText("saved note changed");
  await reachByKeyboard(page, textarea(page));
  await expectEnabledTargetsAtLeast44(page);
  await expectNoOverflowOrClipping(page);
  const wrapping = await conflict.locator("pre").evaluateAll((elements) =>
    elements.map((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      whiteSpace: getComputedStyle(element).whiteSpace,
      overflowWrap: getComputedStyle(element).overflowWrap,
    })),
  );
  expect(wrapping.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 1)).toBe(
    true,
  );
  expect(wrapping.every(({ whiteSpace }) => whiteSpace === "pre-wrap")).toBe(true);
  expect(wrapping.every(({ overflowWrap }) => overflowWrap === "anywhere")).toBe(true);
  if (page.viewportSize()?.width === 375) {
    expect(
      await textarea(page).evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  }
  await expect(conflict.getByRole("button", { name: "Keep my draft" })).toBeVisible();
  await expect(conflict.getByRole("button", { name: "Load saved note" })).toBeVisible();
  await page.keyboard.press("Tab");
  const keepDraft = conflict.getByRole("button", { name: "Keep my draft" });
  await expect(keepDraft).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(textarea(page)).toBeFocused();
  await expect(editor(page).locator(".owner-note-live-status")).toContainText(
    "Saved version adopted. Review your draft, then save it as a new command.",
  );
  await page.keyboard.press("Tab");
  const saveButton = page.getByRole("button", { name: "Save note" });
  await expect(saveButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor(page).locator(".owner-note-live-status")).toContainText("Owner note saved.");
  await expect(editor(page)).toBeFocused();
});

test("strict production proxy keeps broad payloads note-free without BGG, model, or provider access", async ({
  page,
  networkEvidence,
}, testInfo) => {
  desktopBehaviorOnly(testInfo);
  await page.goto(gamePath);
  await save(page, "Broad payload privacy sentinel");
  for (const path of [
    "/api/daemon/games",
    "/api/daemon/games?includePredicted=true&includeNiches=true",
    "/api/daemon/profile",
    "/api/daemon/tournament/stats",
  ]) {
    const response = await page.request.get(path);
    expect(response.ok()).toBe(true);
    const decoded = await response.text();
    expect(decoded).not.toContain("Broad payload privacy sentinel");
    const payload: unknown = JSON.parse(decoded);
    expect(containsObjectKey(payload, "ownerNote")).toBe(false);
  }
  expect(
    networkEvidence.daemonRequests.some((path) => path.includes(`/games/${gameId}/note`)),
  ).toBe(true);
  expect(networkEvidence.externalRequests).toEqual([]);
});

test("native Chromium page zoom 200 percent records setting and complete owner-note checks", async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Run separately with the desktop project",
  );
  test.setTimeout(60_000);
  const zoomLevel = Math.log(2) / Math.log(1.2);
  mkdirSync("/tmp/opencode", { recursive: true });
  const userDataDir = mkdtempSync("/tmp/opencode/shelf-judge-owner-note-zoom-");
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
      baseURL: "http://127.0.0.1:3100",
      colorScheme: "light",
      args: ["--window-size=1440,900", "--window-position=0,0"],
    });
    const evidence: NetworkEvidence = { externalRequests: [], daemonRequests: [] };
    await guardNetwork(context, evidence);
    const settingsPage = context.pages()[0] ?? (await context.newPage());
    await settingsPage.goto("chrome://settings/?search=Page%20zoom");
    const zoomControl = settingsPage.getByRole("combobox", { name: "Page zoom" });
    const zoomLabel = settingsPage.getByText("Page zoom", { exact: true }).last();
    const zoomSetting = settingsPage.locator("#zoomLevel");
    await expect(zoomLabel).toBeVisible();
    await expect(zoomControl).toBeVisible();
    await expect(zoomControl.locator("option:checked")).toHaveText("200%");
    const visibleZoomSetting = (await zoomControl.inputValue()).trim();
    expect(Number(visibleZoomSetting)).toBe(2);
    await zoomSetting.evaluate((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("Expected the Chromium zoom control");
      Object.assign(element.style, {
        position: "fixed",
        top: "130px",
        left: "75px",
        width: "570px",
        zIndex: "10000",
        background: "white",
        boxShadow: "0 0 0 100px white",
      });
    });
    await testInfo.attach("native-page-zoom-visible-setting", {
      body: await settingsPage.screenshot(),
      contentType: "image/png",
    });
    const page = await context.newPage();
    await reset(page);
    await page.goto(gamePath);
    const secondPage = await context.newPage();
    await secondPage.goto(gamePath);
    const currentText = "S".repeat(10_000);
    const localText = "L".repeat(10_000);
    await save(page, currentText);
    await expectSaved(page, currentText);
    await save(secondPage, localText);
    const conflict = editor(secondPage).locator(".owner-note-conflict");
    await expect(conflict.locator("pre").nth(0)).toHaveText(localText);
    await expect(conflict.locator("pre").nth(1)).toHaveText(currentText);
    const metrics = await secondPage.evaluate((visibleZoomSetting) => {
      const panel = document.querySelector(".owner-note-panel");
      const text = document.querySelector("#owner-note-text");
      const conflict = document.querySelector(".owner-note-conflict");
      const conflictTexts = Array.from(document.querySelectorAll(".owner-note-conflict pre"));
      return {
        visibleZoomSetting,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        noteRegionClientWidth: panel?.clientWidth ?? null,
        noteRegionScrollWidth: panel?.scrollWidth ?? null,
        noteTextClientWidth: text?.clientWidth ?? null,
        noteTextScrollWidth: text?.scrollWidth ?? null,
        conflictClientWidth: conflict?.clientWidth ?? null,
        conflictScrollWidth: conflict?.scrollWidth ?? null,
        conflictTextWidths: conflictTexts.map((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          codePoints: [...(element.textContent ?? "")].length,
        })),
        devicePixelRatio: window.devicePixelRatio,
        visualScale: window.visualViewport?.scale ?? 1,
      };
    }, visibleZoomSetting);
    expect(Number(metrics.visibleZoomSetting)).toBe(2);
    expect(metrics.outerWidth).toBe(1440);
    expect(metrics.outerHeight).toBe(900);
    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
    expect(metrics.noteRegionScrollWidth ?? 0).toBeLessThanOrEqual(
      (metrics.noteRegionClientWidth ?? 0) + 1,
    );
    expect(metrics.noteTextScrollWidth ?? 0).toBeLessThanOrEqual(
      (metrics.noteTextClientWidth ?? 0) + 1,
    );
    expect(metrics.conflictScrollWidth ?? 0).toBeLessThanOrEqual(
      (metrics.conflictClientWidth ?? 0) + 1,
    );
    expect(metrics.conflictTextWidths).toEqual([
      expect.objectContaining({ codePoints: 10_000 }),
      expect.objectContaining({ codePoints: 10_000 }),
    ]);
    expect(
      metrics.conflictTextWidths.every(
        ({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 1,
      ),
    ).toBe(true);
    expect(metrics.devicePixelRatio).toBe(2);
    expect(metrics.visualScale).toBe(1);
    await testInfo.attach("native-page-zoom-200-percent-evidence", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    await expect(textarea(secondPage)).toHaveValue(localText);
    await expectEnabledTargetsAtLeast44(secondPage);
    await expectNoOverflowOrClipping(secondPage);
    await expectVisibleFocus(textarea(secondPage));
    await secondPage.keyboard.press("Tab");
    const keepDraft = conflict.getByRole("button", { name: "Keep my draft" });
    await expect(keepDraft).toBeFocused();
    await secondPage.keyboard.press("Enter");
    await expect(textarea(secondPage)).toBeFocused();
    await expect(editor(secondPage).locator(".owner-note-live-status")).toContainText(
      "Saved version adopted.",
    );
    await secondPage.keyboard.press("Tab");
    const saveButton = secondPage.getByRole("button", { name: "Save note" });
    await expect(saveButton).toBeFocused();
    await secondPage.keyboard.press("Enter");
    await expectSaved(secondPage, localText);
    const clearButton = secondPage.getByRole("button", { name: "Clear note" });
    await expectVisibleFocus(textarea(secondPage));
    await secondPage.keyboard.press("Tab");
    await expect(clearButton).toBeFocused();
    const clearDialogPromise = secondPage.waitForEvent("dialog");
    const clearKeyPromise = secondPage.keyboard.press("Enter");
    const clearDialog = await clearDialogPromise;
    expect(clearDialog.message()).toContain("Clear this Owner note?");
    expect(clearDialog.message()).toContain("cannot be restored by Shelf Judge");
    await clearDialog.dismiss();
    await clearKeyPromise;
    await expect(clearButton).toBeFocused();
    await expect(textarea(secondPage)).toHaveValue(localText);
    expect(evidence.externalRequests).toEqual([]);
  } finally {
    await context?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
