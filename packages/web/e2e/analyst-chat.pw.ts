import { expect, test } from "@playwright/test";
import {
  AnalystCitationInspectRequestSchema,
  AnalystStreamEventHistorySchema,
  AnalystTurnRequestSchema,
} from "@shelf-judge/shared";

test("Collection Analyst discloses sending, streams a first question and follow-up, inspects citations, and resets without browser persistence", async ({
  page,
}) => {
  const turnBodies: Array<Record<string, unknown>> = [];
  const citationInspectBodies: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/analyst/turns/stream"))
      turnBodies.push(request.postDataJSON() as Record<string, unknown>);
    if (path.endsWith("/analyst/citations/inspect"))
      citationInspectBodies.push(request.postDataJSON() as Record<string, unknown>);
  });
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
  const firstTurn = AnalystTurnRequestSchema.parse(turnBodies[0]);
  expect(firstTurn.disclosure).toMatchObject({
    manifestVersion: 4,
    disclosureVersion: 1,
    acknowledged: true,
  });
  expect((turnBodies[0] as { conversationCapability: string }).conversationCapability).toMatch(
    /^[0-9a-f]{64}$/,
  );
  await expect(page.getByText("Atlas Equal is supported")).toBeVisible();
  await page.getByLabel("Your question").fill("What is the follow-up?");
  await page.getByRole("button", { name: "Ask Analyst" }).click();
  await page.getByRole("button", { name: "Acknowledge and send" }).click();
  await expect(page.getByText("Validated answer complete.")).toBeVisible();
  const followup = AnalystTurnRequestSchema.parse(turnBodies.at(-1));
  expect(followup.messages).toEqual([
    { role: "owner", content: "Which game should I play?" },
    {
      role: "analyst",
      content: "Atlas Equal is supported by current validated collection evidence.",
      outcome: "answered",
      noteDependencies: [{ gameId: "game-1", noteVersion: 1 }],
      validationAttestation: "fixture-attestation",
    },
    { role: "owner", content: "What is the follow-up?" },
  ]);
  expect(followup.discoveryReceipts).toEqual([]);
  expect(Object.keys(followup.messages[1] ?? {}).sort()).toEqual(
    ["content", "noteDependencies", "outcome", "role", "validationAttestation"].sort(),
  );
  await page
    .getByRole("button", { name: /Evidence: Current fitness score/ })
    .last()
    .click();
  await expect(page).toHaveURL(/\/games\/game-1$/);
  expect(citationInspectBodies).toHaveLength(1);
  const inspectionRequest = AnalystCitationInspectRequestSchema.parse(citationInspectBodies[0]);
  expect(Object.keys(inspectionRequest.citation).sort()).toEqual(
    ["citationId", "evidenceClass", "sourceId", "sourceVersion"].sort(),
  );
  await page.goto("/analyst");
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("button", { name: "Start new conversation" }).click();
  await expect(page.getByText("Nothing was saved.")).toBeVisible();
  expect(
    await page.evaluate(async () => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      cookies: document.cookie,
      indexedDb: await indexedDB.databases(),
    })),
  ).toEqual({ local: [], session: [], cookies: "", indexedDb: [] });
});

test("Collection Analyst renders response Markdown while preserving owner plaintext", async ({
  page,
}) => {
  await page.goto("/analyst");
  await page.getByLabel("Your question").fill("**owner literal**");
  await page.getByRole("button", { name: "Ask Analyst" }).click();
  await page.getByRole("button", { name: "Acknowledge and send" }).click();

  const transcript = page.getByLabel("Analyst conversation");
  await expect(transcript.locator("strong", { hasText: "bold" })).toBeVisible();
  await expect(transcript.locator("strong", { hasText: "bold" })).toHaveCSS("font-weight", "700");
  await expect(transcript.getByRole("listitem").filter({ hasText: "First" })).toBeVisible();
  await expect(transcript.getByRole("listitem").filter({ hasText: "Second" })).toBeVisible();
  await expect(transcript.getByText("**owner literal**", { exact: true })).toBeVisible();
});

test("Collection Analyst works without randomUUID while retaining cryptographic capabilities", async ({
  page,
}) => {
  const turnBodies: Array<{
    conversationId: string;
    requestId: string;
    conversationCapability: string;
  }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/analyst/turns/stream")) {
      turnBodies.push(request.postDataJSON() as (typeof turnBodies)[number]);
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  });
  await page.goto("/analyst");
  await expect(page.getByText("Ask a first question")).toBeVisible();
  expect(
    await page.evaluate(() => [typeof crypto.randomUUID, typeof crypto.getRandomValues]),
  ).toEqual(["undefined", "function"]);

  for (const question of ["Which game should I play?", "What is the follow-up?"]) {
    await page.getByLabel("Your question").fill(question);
    await page.getByRole("button", { name: "Ask Analyst" }).click();
    await page.getByRole("button", { name: "Acknowledge and send" }).click();
    await expect(page.getByText("Validated answer complete.")).toBeVisible();
  }
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("button", { name: "Start new conversation" }).click();
  await expect(page.getByText("Nothing was saved.")).toBeVisible();

  expect(turnBodies).toHaveLength(2);
  for (const body of turnBodies) {
    expect(body.conversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(body.conversationCapability).toMatch(/^[0-9a-f]{64}$/);
  }
});

test("Collection Analyst can stop an active stream and retry without accepting a stale result", async ({
  page,
}) => {
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

test("Collection Analyst renders bounded discovery, receipts, and preview states without a card-open fetch", async ({
  page,
}) => {
  const turnBodies: Array<Record<string, unknown>> = [];
  const bggOrPreviewRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/analyst/turns/stream"))
      turnBodies.push(request.postDataJSON() as Record<string, unknown>);
    if (url.hostname === "boardgamegeek.com" || /predictions\/bgg/.test(url.pathname))
      bggOrPreviewRequests.push(request.url());
  });
  await page.goto("/analyst");

  const ask = async (question: string, expectedAnswer: string) => {
    await page.getByLabel("Your question").fill(question);
    await page.getByRole("button", { name: "Ask Analyst" }).click();
    const send = page.getByRole("button", { name: "Acknowledge and send" });
    if (await send.isVisible()) await send.click();
    await expect(
      page.getByLabel("Analyst conversation").getByText(expectedAnswer, { exact: true }).last(),
    ).toBeVisible();
  };

  await ask("zero-hit title", "No matches in this title search.");
  const zero = page.getByRole("region", { name: "BGG title matches" }).last();
  await expect(zero).toContainText("0 shown · 0 returned");
  await expect(zero).toContainText("No matches in this title search.");

  await ask("hot limited sample", "The checked Hot sample contains eight candidates.");
  const hot = page.getByRole("region", { name: "BGG Hot sample" }).last();
  await expect(hot).toContainText("8 shown · 8 returned");
  await expect(hot.getByRole("link", { name: /Atlas Equal · BGG 174430/ })).toBeVisible();

  await ask("truncated title candidates", "Showing a bounded sample; more results were returned.");
  const truncated = page.getByRole("region", { name: "BGG title matches" }).last();
  await expect(truncated).toContainText("10 shown · 12 returned");
  await expect(truncated).toContainText("Showing a bounded sample");

  await ask(
    "preview predicted without selecting an owner game",
    "A predicted fitness preview is available.",
  );
  const predicted = page
    .locator(".analyst-preview")
    .filter({ hasText: "Predicted fitness" })
    .last();
  await expect(predicted).toContainText("Atlas Equal");
  await predicted.getByText("Score details and sources").click();
  await expect(predicted).toContainText("Reference games: Atlas Equal (game-1)");
  expect(bggOrPreviewRequests).toEqual([]);

  for (const [question, answer, heading, detail] of [
    [
      "preview existing",
      "An existing collection score is available.",
      "Existing in collection",
      "previously-owned",
    ],
    [
      "preview local-unverified",
      "A local score is available, but BGG identity could not be verified.",
      "Existing in collection",
      "BGG lookup failed: BggOutage",
    ],
    [
      "preview stage0",
      "The profile is at readiness stage 0; personal prediction is unavailable.",
      "Predicted fitness",
      "Readiness stage 0",
    ],
    [
      "preview unavailable",
      "Fitness preview unavailable.",
      "Fitness preview unavailable",
      "PredictionUnavailable",
    ],
    [
      "preview ambiguous",
      "Several collection entries may match; no score was selected.",
      "Identity is ambiguous",
      "No score was selected",
    ],
    [
      "preview error",
      "The BGG request failed; no preview is available.",
      "Fitness preview unavailable",
      "BggOutage",
    ],
  ]) {
    await ask(question, answer);
    const card = page.locator(".analyst-tool-card").filter({ hasText: heading }).last();
    await expect(card).toContainText(detail);
  }

  expect(turnBodies[1]).toMatchObject({ discoveryReceipts: [] });
  expect(turnBodies).toHaveLength(10);
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("button", { name: "Start new conversation" }).click();
  await expect(page.getByText("Nothing was saved.")).toBeVisible();
  await expect(page.getByRole("region", { name: "BGG title matches" })).toHaveCount(0);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
]) {
  test(`Collection Analyst Hot sample and composer scroll into view at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/analyst");
    await page.getByLabel("Your question").fill("hot limited sample");
    await page.getByRole("button", { name: "Ask Analyst" }).click();
    await page.getByRole("button", { name: "Acknowledge and send" }).click();

    const hot = page.getByRole("region", { name: "BGG Hot sample" });
    const lastCandidate = hot.getByRole("link", { name: /Acquire: Long Candidate Name/ });
    const composer = page.getByLabel("Your question");
    await expect(lastCandidate).toBeVisible();
    await expect(composer).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );

    const scrollRegion = page.locator(".main-scroll");
    expect(
      await scrollRegion.evaluate((element) => element.scrollHeight > element.clientHeight),
    ).toBe(true);
    await lastCandidate.scrollIntoViewIfNeeded();
    await expect(lastCandidate).toBeInViewport();
    await composer.scrollIntoViewIfNeeded();
    await composer.focus();
    await expect(composer).toBeFocused();
    await expect(composer).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
}

test("Collection Analyst inspects current, historical, and superseded evidence with strict citation identities", async ({
  page,
}) => {
  const inspectionRequests: Array<Record<string, unknown>> = [];
  const inspect = async (name: string) => {
    const responsePromise = page.waitForResponse((response) => {
      return new URL(response.url()).pathname.endsWith("/analyst/citations/inspect");
    });
    await page
      .getByLabel("Analyst conversation")
      .getByRole("article")
      .nth(1)
      .getByRole("button", { name })
      .click();
    const response = await responsePromise;
    return (await response.json()) as Record<string, unknown>;
  };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/analyst/citations/inspect")) {
      inspectionRequests.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.goto("/analyst");
  await page.getByLabel("Your question").fill("zero-hit title");
  await page.getByRole("button", { name: "Ask Analyst" }).click();
  await page.getByRole("button", { name: "Acknowledge and send" }).click();
  await expect(page.getByText("No matches in this title search.").last()).toBeVisible();

  await page.getByLabel("Your question").fill("What did the title search observe?");
  await page.getByRole("button", { name: "Ask Analyst" }).click();
  await page.getByRole("button", { name: "Acknowledge and send" }).click();
  await expect(
    page.getByText("Atlas Equal is supported by current validated collection evidence.").last(),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "BGG title matches" })).toBeVisible();

  const originalAnswer = page.getByLabel("Analyst conversation").getByRole("article").nth(1);
  const current = await inspect("Evidence: BGG title search observation");
  expect(current.state).toBe("current");
  await expect(originalAnswer.getByText("This evidence is current.")).toBeVisible();
  await expect(page).toHaveURL(/\/analyst$/);

  const historical = await inspect("Evidence: BGG title search observation");
  expect(historical.state).toBe("historical");
  expect(historical.view).toMatchObject({
    kind: "discovery",
    result: {
      observationCitationId: "discovery-zero",
      emittedCount: 0,
      returnedCount: 0,
    },
  });
  await expect(originalAnswer.getByText(/Historical evidence · inspected/)).toBeVisible();
  await expect(
    originalAnswer.getByText(/BGG title observation · 0 shown of 0 returned/),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/analyst$/);

  const superseded = await inspect("Evidence: Superseded fitness score");
  expect(superseded.state).toBe("superseded");
  await expect(
    originalAnswer.getByText(
      "This evidence has been superseded; the record shown below is from the original answer.",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/analyst$/);

  for (const request of inspectionRequests) {
    const parsed = AnalystCitationInspectRequestSchema.parse(request);
    expect(Object.keys(parsed.citation).sort()).toEqual(
      ["citationId", "evidenceClass", "sourceId", "sourceVersion"].sort(),
    );
  }
  expect(inspectionRequests[0]?.inspection).toMatchObject({
    version: 1,
    turnIndex: 0,
    view: { kind: "discovery" },
  });
  await expect(page).toHaveURL(/\/analyst$/);
});

test("Analyst fixture rejects requests outside the strict shared contracts", async ({ page }) => {
  await page.goto("/analyst");
  const result = await page.evaluate(async () => {
    const stream = await fetch("/api/daemon/analyst/turns/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "not-a-turn" }),
    });
    const inspection = await fetch("/api/daemon/analyst/citations/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ citation: { citationId: "incomplete" } }),
    });
    const validStream = await fetch("/api/daemon/analyst/turns/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        conversationId: crypto.randomUUID(),
        conversationCapability: "a".repeat(64),
        requestId: crypto.randomUUID(),
        turnIndex: 0,
        disclosure: {
          providerId: "fixture-provider",
          modelId: "fixture-model",
          manifestVersion: 4,
          disclosureVersion: 1,
          acknowledged: true,
        },
        discoveryReceipts: [],
        messages: [{ role: "owner", content: "zero-hit title" }],
      }),
    });
    const streamText = await validStream.text();
    const events = streamText
      .split("\n\n")
      .filter((record) => record.startsWith("data:"))
      .map((record) => JSON.parse(record.slice(5).trim()) as unknown);
    return {
      invalidStatuses: [stream.status, inspection.status],
      validStatus: validStream.status,
      events,
    };
  });
  expect(result.invalidStatuses).toEqual([400, 400]);
  expect(result.validStatus).toBe(200);
  expect(AnalystStreamEventHistorySchema.parse(result.events).at(-1)?.type).toBe("completed");
});

test("Collection Analyst bounds accumulated discovery receipts to the newest twenty", async ({
  page,
}) => {
  const turnBodies: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/analyst/turns/stream")) {
      turnBodies.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.goto("/analyst");
  for (let batch = 0; batch < 6; batch += 1) {
    await page.getByLabel("Your question").fill(`receipt-batch-${batch}`);
    await page.getByRole("button", { name: "Ask Analyst" }).click();
    const acknowledge = page.getByRole("button", { name: "Acknowledge and send" });
    if (await acknowledge.isVisible()) await acknowledge.click();
    await expect(
      page.getByText("Atlas Equal is supported by current validated collection evidence.").last(),
    ).toBeVisible();
  }
  const transcript = page.getByLabel("Analyst conversation");
  for (let batch = 0; batch < 6; batch += 1) {
    await expect(transcript.getByText(`receipt-batch-${batch}`, { exact: true })).toBeVisible();
  }
  await expect(transcript.getByRole("article")).toHaveCount(12);
  const sixthTurn = AnalystTurnRequestSchema.parse(turnBodies[5]);
  expect(sixthTurn.discoveryReceipts).toHaveLength(20);
  expect(sixthTurn.discoveryReceipts?.[0]).toBe("fixture-receipt-1-0");
  expect(sixthTurn.discoveryReceipts?.at(-1)).toBe("fixture-receipt-4-4");
});

test("Collection Analyst offers retry when a stream ends before a terminal event", async ({
  page,
}) => {
  const turnBodies: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/analyst/turns/stream")) {
      turnBodies.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.goto("/analyst");
  await page.getByLabel("Your question").fill("eof without terminal");
  await page.getByRole("button", { name: "Ask Analyst" }).click();
  await page.getByRole("button", { name: "Acknowledge and send" }).click();
  await expect(page.getByRole("button", { name: "Retry question" })).toBeVisible();
  await page.getByRole("button", { name: "Retry question" }).click();
  await expect(
    page.getByText("Atlas Equal is supported by current validated collection evidence."),
  ).toBeVisible();
  expect(turnBodies).toHaveLength(2);
  expect(turnBodies[1]).toMatchObject({ turnIndex: 0, messages: [{ role: "owner" }] });
});

test("Collection Analyst explains safe failure causes, retains the question, and retries without showing an unvalidated answer", async ({
  page,
}) => {
  const cases = [
    ["authentication", /could not sign in to its provider/i],
    ["rate-limit", /too many requests/i],
    ["provider-outage", /temporarily unavailable/i],
    ["evidence-load", /collection evidence could not be prepared/i],
    ["deadline", /took too long to respond/i],
    ["output-validation", /could not be checked against collection evidence/i],
    ["unknown", /could not finish checking this response/i],
  ] as const;
  await page.goto("/analyst");
  for (const [kind, guidance] of cases) {
    const question = `failure-${kind}`;
    await page.getByLabel("Your question").fill(question);
    await page.getByRole("button", { name: "Ask Analyst" }).click();
    await page.getByRole("button", { name: "Acknowledge and send" }).click();
    await expect(page.getByRole("status")).toContainText(guidance);
    await expect(page.getByRole("status")).not.toContainText(
      /turn-deadline|upstream|internal|JSON/i,
    );
    await expect(
      page.getByLabel("Analyst conversation").getByText(question, { exact: true }),
    ).toBeVisible();
    const retainedTurn = page
      .getByLabel("Analyst conversation")
      .getByRole("article")
      .filter({ hasText: question });
    await expect(retainedTurn).toHaveCount(1);
    await expect(retainedTurn.getByText("Atlas Equal is supported", { exact: false })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Retry question" })).toBeVisible();
    await page.getByRole("button", { name: "Retry question" }).click();
    await expect(page.getByText("Validated answer complete.")).toBeVisible();
    await expect(
      page.getByText("Atlas Equal is supported by current validated collection evidence.").last(),
    ).toBeVisible();
  }
});

test("Collection Analyst keeps a BGG Hot throttle separate from provider failures and shows no fabricated results", async ({
  page,
}) => {
  await page.goto("/analyst");
  await page.getByLabel("Your question").fill("reviewBggHot");
  await page.getByRole("button", { name: "Ask Analyst" }).click();
  await page.getByRole("button", { name: "Acknowledge and send" }).click();

  const turn = page.getByLabel("Analyst conversation").getByRole("article").last();
  await expect(
    turn.getByText("The BGG Hot sample is temporarily unavailable", { exact: false }),
  ).toBeVisible();
  await expect(
    turn.getByRole("heading", { name: "BGG is temporarily limiting requests" }),
  ).toBeVisible();
  await expect(turn).toContainText("No candidates or fitness score were available.");
  await expect(turn.getByRole("list", { name: "Citations" })).toHaveCount(0);
  await expect(turn.locator(".analyst-candidates")).toHaveCount(0);
  await expect(turn.locator(".analyst-preview")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Validated answer complete.");
  await expect(page.getByRole("status")).not.toContainText(/provider|too many requests|outage/i);

  await page.getByLabel("Your question").fill("Which game should I play?");
  await page.getByRole("button", { name: "Ask Analyst" }).click();
  await page.getByRole("button", { name: "Acknowledge and send" }).click();
  await expect(page.getByText("Validated answer complete.")).toBeVisible();
  await expect(
    page.getByText("Atlas Equal is supported by current validated collection evidence.").last(),
  ).toBeVisible();
});
