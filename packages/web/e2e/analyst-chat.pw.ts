import { expect, test } from "@playwright/test";

test("Collection Analyst discloses sending, streams a first question and follow-up, inspects citations, and resets without browser persistence", async ({ page }) => {
  const turnBodies: unknown[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith("/analyst/turns/stream")) turnBodies.push(request.postDataJSON()); });
  await page.goto("/analyst");
  await expect(page.getByText("Ask a first question")).toBeVisible();
  await page.getByLabel("Your question").fill("Which game should I play?");
  await page.getByRole("button", { name: "Ask Analyst" }).click();
  const disclosure = page.getByRole("dialog", { name: "Before sending your question" });
  await expect(disclosure).toContainText("fixture-provider / fixture-model");
  await expect(disclosure.getByRole("button", { name: "Leave without sending" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(disclosure.getByRole("button", { name: "Acknowledge and send" })).toBeFocused();
  await disclosure.getByRole("button", { name: "Acknowledge and send" }).click();
  await expect(page.getByText("Validated answer complete.")).toBeVisible();
  expect((turnBodies[0] as { conversationCapability: string }).conversationCapability).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.getByText("Atlas Equal is supported")).toBeVisible();
  await page.getByLabel("Your question").fill("What is the follow-up?");
  await page.getByRole("button", { name: "Ask Analyst" }).click();
  await page.getByRole("button", { name: "Acknowledge and send" }).click();
  await expect(page.getByText("Validated answer complete.")).toBeVisible();
  expect(turnBodies.at(-1)).toMatchObject({ messages: [{ role: "owner" }, { role: "analyst", noteDependencies: [{ gameId: "game-1", noteVersion: 1 }] }, { role: "owner" }] });
  await page.getByRole("button", { name: /Evidence: Current fitness score/ }).last().click();
  await expect(page).toHaveURL(/\/games\/game-1$/);
  await page.goto("/analyst");
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("button", { name: "Start new conversation" }).click();
  await expect(page.getByText("Nothing was saved.")).toBeVisible();
  expect(await page.evaluate(async () => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookies: document.cookie, indexedDb: await indexedDB.databases() }))).toEqual({ local: [], session: [], cookies: "", indexedDb: [] });
});

test("Collection Analyst can stop an active stream and retry without accepting a stale result", async ({ page }) => {
  await page.goto("/analyst");
  await page.getByLabel("Your question").fill("cancel me");
  await page.getByRole("button", { name: "Ask Analyst" }).click();
  await page.getByRole("button", { name: "Acknowledge and send" }).click();
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(page.getByText("The Analyst request was cancelled.")).toBeVisible();
  await expect(page.getByLabel("Your question")).toBeFocused();
  await page.getByRole("button", { name: "Retry question" }).click();
  await expect(page.getByText("Validated answer complete.")).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByText("stale-fixture-attestation")).toHaveCount(0);
});
