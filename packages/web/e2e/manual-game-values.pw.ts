import { expect, test, type Page } from "@playwright/test";

const gameId = "game-4";

interface FixtureState {
  mutationBodies: Record<string, unknown>[];
  activeMutations: number;
  maxActiveMutations: number;
}

async function controlFixture(page: Page, data: Record<string, unknown>): Promise<void> {
  const response = await page.request.post("/api/daemon/test/manual-values-state", { data });
  expect(response.ok()).toBe(true);
}

async function fixtureState(page: Page): Promise<FixtureState> {
  const response = await page.request.get("/api/daemon/test/manual-values-state");
  expect(response.ok()).toBe(true);
  return (await response.json()) as FixtureState;
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Lifecycle behavior is viewport-independent",
  );
  const response = await page.request.post("/api/daemon/test/reset", {
    data: { scenario: "manual-values" },
  });
  expect(response.ok()).toBe(true);
  await page.goto(`/games/${gameId}`);
});

test("serializes mounted controls through transition refresh and reconciles new props", async ({
  page,
}) => {
  const playingTime = page.getByLabel("Play Time (minutes)");
  const playerCount = page.getByLabel("Player Count");
  const savePlayingTime = page.getByRole("button", { name: "Save Play Time" });
  const savePlayerCount = page.getByRole("button", { name: "Save Player Count" });
  const clearPlayerCount = page.getByRole("button", { name: "Clear Player Count" });

  await expect(playingTime).toHaveValue("90");
  await expect(playerCount).toHaveValue("4");
  await expect(savePlayingTime).toBeDisabled();
  await playingTime.fill("120");
  await expect(savePlayingTime).toBeEnabled();

  await controlFixture(page, { blockNextMutation: true });
  await savePlayingTime.click();
  await expect(playingTime).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("Saving Play Time...");
  await expect(playerCount).toBeEnabled();
  await expect(savePlayerCount).toBeDisabled();
  await expect(clearPlayerCount).toBeDisabled();
  await playerCount.fill("4");
  await expect.poll(async () => (await fixtureState(page)).activeMutations).toBe(1);

  await controlFixture(page, {
    blockNextDetail: true,
    externalPlayerCount: 5,
    releaseMutation: true,
  });
  await expect(page.getByRole("status")).toHaveText("Refreshing Play Time...");
  await expect(playingTime).toBeDisabled();
  await expect(savePlayerCount).toBeDisabled();
  await expect(clearPlayerCount).toBeDisabled();
  expect((await fixtureState(page)).mutationBodies).toEqual([{ playingTime: 120 }]);

  await controlFixture(page, { releaseDetail: true });
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(playingTime).toHaveValue("120");
  await expect(playingTime).toBeEnabled();
  await expect(playerCount).toHaveValue("5");
  await expect(savePlayerCount).toBeDisabled();

  await playerCount.fill("6");
  await expect(savePlayerCount).toBeEnabled();

  await controlFixture(page, { blockNextMutation: true });
  await savePlayerCount.click();
  await expect(page.getByRole("status")).toHaveText("Saving Player Count...");
  await playingTime.fill("125");
  await controlFixture(page, { blockNextDetail: true, releaseMutation: true });
  await expect(page.getByRole("status")).toHaveText("Refreshing Player Count...");
  await expect(savePlayingTime).toBeDisabled();
  await controlFixture(page, {
    externalPlayingTime: 130,
    externalPlayerCount: 7,
    releaseDetail: true,
  });
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(playingTime).toHaveValue("125");
  await expect(playerCount).toHaveValue("6");
  await expect(savePlayingTime).toBeEnabled();
  await expect(savePlayerCount).toBeEnabled();
  expect(await fixtureState(page)).toEqual({
    mutationBodies: [{ playingTime: 120 }, { playerCount: 6 }],
    activeMutations: 0,
    maxActiveMutations: 1,
  });
});

test("preserves a dirty clear draft on failure and exposes associated accessible feedback", async ({
  page,
}) => {
  const playingTime = page.getByLabel("Play Time (minutes)");
  const playerCount = page.getByLabel("Player Count");
  const clearPlayingTime = page.getByRole("button", { name: "Clear Play Time" });

  await playingTime.fill("125");
  await controlFixture(page, { blockNextMutation: true, failNextMutation: true });
  await clearPlayingTime.click();
  const pendingStatus = page.locator("#playing-time-status");
  await expect(pendingStatus).toHaveRole("status");
  await expect(pendingStatus).toHaveAttribute("aria-live", "polite");
  await expect(pendingStatus).toHaveText("Clearing Play Time...");
  await expect(playingTime).toBeDisabled();
  await expect(playerCount).toBeEnabled();

  await controlFixture(page, { releaseMutation: true });
  await expect(pendingStatus).toHaveRole("alert");
  await expect(pendingStatus).toHaveText("Injected manual value failure");
  await expect(playingTime).toHaveAttribute("aria-describedby", "playing-time-status");
  await expect(clearPlayingTime).toHaveAttribute("aria-describedby", "playing-time-status");
  await expect(playingTime).toHaveValue("125");
  await expect(playingTime).toBeEnabled();
  await expect(clearPlayingTime).toBeEnabled();
  expect((await fixtureState(page)).mutationBodies).toEqual([{ playingTime: null }]);
});

test("reconciles a successful save against a newer same-scalar authoritative write", async ({
  page,
}) => {
  const playingTime = page.getByLabel("Play Time (minutes)");
  const playerCount = page.getByLabel("Player Count");
  const savePlayingTime = page.getByRole("button", { name: "Save Play Time" });
  const clearPlayingTime = page.getByRole("button", { name: "Clear Play Time" });
  const savePlayerCount = page.getByRole("button", { name: "Save Player Count" });

  await playingTime.fill("120");
  await playerCount.fill("5");
  await controlFixture(page, { blockNextMutation: true, blockNextDetail: true });
  await savePlayingTime.click();
  await expect(savePlayerCount).toBeDisabled();
  await controlFixture(page, { releaseMutation: true });
  await expect(page.getByRole("status")).toHaveText("Refreshing Play Time...");

  await controlFixture(page, { externalPlayingTime: 90, releaseDetail: true });
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(playingTime).toHaveValue("120");
  await expect(savePlayingTime).toBeEnabled();
  await expect(clearPlayingTime).toBeEnabled();
  await expect(playerCount).toHaveValue("5");
  await expect(savePlayerCount).toBeEnabled();
  expect(await fixtureState(page)).toEqual({
    mutationBodies: [{ playingTime: 120 }],
    activeMutations: 0,
    maxActiveMutations: 1,
  });

  await savePlayerCount.click();
  await expect
    .poll(async () => (await fixtureState(page)).mutationBodies)
    .toEqual([{ playingTime: 120 }, { playerCount: 5 }]);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(savePlayerCount).toBeDisabled();
  await expect(playingTime).toHaveValue("120");
  await expect(savePlayingTime).toBeEnabled();
  expect(await fixtureState(page)).toEqual({
    mutationBodies: [{ playingTime: 120 }, { playerCount: 5 }],
    activeMutations: 0,
    maxActiveMutations: 1,
  });
});

test("reconciles a successful clear against a newer same-scalar authoritative write", async ({
  page,
}) => {
  const playingTime = page.getByLabel("Play Time (minutes)");
  const playerCount = page.getByLabel("Player Count");
  const savePlayingTime = page.getByRole("button", { name: "Save Play Time" });
  const clearPlayingTime = page.getByRole("button", { name: "Clear Play Time" });
  const savePlayerCount = page.getByRole("button", { name: "Save Player Count" });

  await playerCount.fill("5");
  await controlFixture(page, { blockNextMutation: true, blockNextDetail: true });
  await clearPlayingTime.click();
  await expect(savePlayerCount).toBeDisabled();
  await controlFixture(page, { releaseMutation: true });
  await expect(page.getByRole("status")).toHaveText("Refreshing Play Time...");

  await controlFixture(page, { externalPlayingTime: 90, releaseDetail: true });
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(playingTime).toHaveValue("");
  await expect(clearPlayingTime).toBeEnabled();
  await expect(playerCount).toHaveValue("5");
  await expect(savePlayerCount).toBeEnabled();
  expect(await fixtureState(page)).toEqual({
    mutationBodies: [{ playingTime: null }],
    activeMutations: 0,
    maxActiveMutations: 1,
  });

  await playingTime.fill("90");
  await expect(savePlayingTime).toBeDisabled();
  await expect(clearPlayingTime).toBeEnabled();
  await savePlayerCount.click();
  await expect
    .poll(async () => (await fixtureState(page)).mutationBodies)
    .toEqual([{ playingTime: null }, { playerCount: 5 }]);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(savePlayerCount).toBeDisabled();
  await expect(playingTime).toHaveValue("90");
  await expect(savePlayingTime).toBeDisabled();
  expect(await fixtureState(page)).toEqual({
    mutationBodies: [{ playingTime: null }, { playerCount: 5 }],
    activeMutations: 0,
    maxActiveMutations: 1,
  });
});
