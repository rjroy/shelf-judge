import { expect, test, type Page } from "@playwright/test";

interface SearchResult {
  bggId: number;
  name: string;
  yearPublished: number | null;
  thumbnailUrl: string | null;
}

interface SearchRequest {
  id: number;
  query: string;
  aborted: boolean;
}

interface SearchTestWindow extends Window {
  __searchRequests: SearchRequest[];
  __resolveSearch: (id: number, results: SearchResult[]) => void;
  __rejectSearch: (id: number, message: string) => void;
}

async function installSearchMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const requests: Array<{
      id: number;
      query: string;
      signal?: AbortSignal;
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
    }> = [];
    let nextId = 1;
    const testWindow = window as unknown as Window & {
      __searchRequests: SearchRequest[];
      __resolveSearch: (id: number, results: SearchResult[]) => void;
      __rejectSearch: (id: number, message: string) => void;
    };
    testWindow.__searchRequests = [];
    testWindow.__resolveSearch = (id, results) => {
      const request = requests.find((entry) => entry.id === id);
      request?.resolve({ ok: true, json: () => Promise.resolve(results) } as Response);
    };
    testWindow.__rejectSearch = (id, message) => {
      requests.find((entry) => entry.id === id)?.reject(new Error(message));
    };
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input, location.origin);
      if (url.pathname === "/api/daemon/wishlist") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
      }
      if (url.pathname === "/api/daemon/games/search") {
        const id = nextId++;
        const query = url.searchParams.get("q") ?? "";
        return new Promise<Response>((resolve, reject) => {
          requests.push({ id, query, signal: init?.signal ?? undefined, resolve, reject });
          testWindow.__searchRequests.push({ id, query, aborted: false });
          init?.signal?.addEventListener("abort", () => {
            const recorded = testWindow.__searchRequests.find((entry) => entry.id === id);
            if (recorded) recorded.aborted = true;
          });
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url.pathname}`));
    }) as typeof fetch;
  });
}

async function searchRequests(page: Page): Promise<SearchRequest[]> {
  return page.evaluate(() => (window as unknown as SearchTestWindow).__searchRequests);
}

function result(bggId: number, name: string): SearchResult {
  return { bggId, name, yearPublished: null, thumbnailUrl: null };
}

test.describe("search request cancellation", () => {
  test("debounces rapid typing to the latest query", async ({ page }) => {
    await installSearchMock(page);
    await page.goto("/search");

    const input = page.getByPlaceholder("Search BoardGameGeek...");
    await input.fill("ca");
    await input.fill("cat");
    await expect.poll(async () => (await searchRequests(page)).length).toBe(1);
    await expect.poll(async () => (await searchRequests(page))[0]?.query).toBe("cat");

    const [{ id }] = await searchRequests(page);
    await page.evaluate(
      ({ id, results }) => (window as unknown as SearchTestWindow).__resolveSearch(id, results),
      { id, results: [result(1, "Cat Game")] },
    );
    await expect(page.getByText("Cat Game")).toBeVisible();
  });

  test("removes old results immediately when the query changes", async ({ page }) => {
    await installSearchMock(page);
    await page.goto("/search");
    const input = page.getByPlaceholder("Search BoardGameGeek...");

    await input.fill("previous");
    await expect.poll(async () => (await searchRequests(page)).length).toBe(1);
    const [previousRequest] = await searchRequests(page);
    if (!previousRequest) throw new Error("Expected the previous query request");
    await page.evaluate(
      ({ id, results }) => (window as unknown as SearchTestWindow).__resolveSearch(id, results),
      { id: previousRequest.id, results: [result(3, "Previous Result")] },
    );
    await expect(page.getByText("Previous Result")).toBeVisible();

    await input.fill("replacement");
    await expect(page.getByText("Previous Result")).toHaveCount(0);
    await expect(page.locator(".search-results")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Preview" })).toHaveCount(0);

    await expect.poll(async () => (await searchRequests(page)).length).toBe(2);
    const [, replacementRequest] = await searchRequests(page);
    if (!replacementRequest) throw new Error("Expected the replacement query request");
    await page.evaluate(
      ({ id, results }) => (window as unknown as SearchTestWindow).__resolveSearch(id, results),
      { id: replacementRequest.id, results: [result(4, "Replacement Result")] },
    );
    await expect(page.getByText("Replacement Result")).toBeVisible();
  });

  test("ignores an older response even when the mock ignores abort", async ({ page }) => {
    await installSearchMock(page);
    await page.goto("/search");
    const input = page.getByPlaceholder("Search BoardGameGeek...");

    await input.fill("older");
    await expect.poll(async () => (await searchRequests(page)).length).toBe(1);
    await input.fill("newer");
    await expect.poll(async () => (await searchRequests(page)).length).toBe(2);

    const requests = await searchRequests(page);
    expect(requests[0]?.aborted).toBe(true);
    const olderRequest = requests[0];
    const newerRequest = requests[1];
    if (!olderRequest || !newerRequest) throw new Error("Expected two search requests");
    await page.evaluate(
      ({ id, results }) => (window as unknown as SearchTestWindow).__resolveSearch(id, results),
      { id: newerRequest.id, results: [result(2, "Newer Result")] },
    );
    await expect(page.getByText("Newer Result")).toBeVisible();

    await page.evaluate(
      ({ id, results }) => (window as unknown as SearchTestWindow).__resolveSearch(id, results),
      { id: olderRequest.id, results: [result(1, "Older Result")] },
    );
    await expect(page.getByText("Newer Result")).toBeVisible();
    await expect(page.getByText("Older Result")).toHaveCount(0);
  });

  test("clearing an active query resets state and suppresses cancellation errors", async ({
    page,
  }) => {
    await installSearchMock(page);
    await page.goto("/search");
    const input = page.getByPlaceholder("Search BoardGameGeek...");

    await input.fill("cancel me");
    await expect.poll(async () => (await searchRequests(page)).length).toBe(1);
    const [{ id }] = await searchRequests(page);

    await input.fill("");
    await expect(page.locator(".search-status")).toHaveCount(0);
    await expect(page.locator(".error-banner")).toHaveCount(0);
    expect((await searchRequests(page))[0]?.aborted).toBe(true);

    await page.evaluate(
      ({ id, message }) => (window as unknown as SearchTestWindow).__rejectSearch(id, message),
      { id, message: "AbortError: The operation was aborted" },
    );
    await expect(page.locator(".error-banner")).toHaveCount(0);
    await expect(page.locator(".search-results")).toHaveCount(0);
  });
});
