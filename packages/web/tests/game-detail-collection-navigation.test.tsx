import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  buildDetailCollectionContextModel,
  completeDetailCollectionNavigationRequest,
  createDetailCollectionNavigationLifecycle,
  GameDetailCollectionNavigationView,
  transitionDetailCollectionNavigationRequest,
  type DetailCollectionContextModel,
  type DetailCollectionRequestIdentity,
} from "@/components/game-detail-collection-navigation";
import type { CollectionNavigationContextV1 } from "@/lib/collection-navigation-context";

const KEY = "00000000-0000-4000-8000-000000000001";

function context(
  entries: CollectionNavigationContextV1["entries"] = [
    { id: "first", name: "First Game" },
    { id: "middle / game", name: "Middle & Complete Game Name" },
    { id: "last", name: "Last Game" },
  ],
): CollectionNavigationContextV1 {
  return {
    version: 1,
    key: KEY,
    entries,
    collectionScope: { showPreviouslyOwned: true, missingDimensionsOnly: true },
    projection: {
      sort: { field: "name", direction: "asc" },
      filters: {
        search: "",
        ratedStatus: "all",
        playedStatus: "all",
        playerCount: null,
      },
      predictionsOn: false,
      effectivePredictionsOn: false,
      nichesOn: false,
    },
    lastAccessedAt: 1_000,
  };
}

function renderModel(model: ReturnType<typeof buildDetailCollectionContextModel>): string {
  return renderToString(
    <GameDetailCollectionNavigationView
      gameName="Current Game"
      actions={<div data-actions="existing" />}
      model={model}
    />,
  );
}

function request(
  currentId: string,
  contextKey: string | undefined = KEY,
  originId: string | undefined = "first",
): DetailCollectionRequestIdentity {
  return { currentId, contextKey, originId };
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) throw new Error("Deferred promise was not initialized");
      resolvePromise(value);
    },
  };
}

describe("game detail Collection navigation model", () => {
  test("uses exact middle neighbors and preserves encoded context and initial origin", () => {
    const model = buildDetailCollectionContextModel(context(), "middle / game", "first");

    expect(model?.navigation).toEqual({
      previous: { id: "first", name: "First Game" },
      next: { id: "last", name: "Last Game" },
    });
    expect(model?.collectionHref).toBe(
      `/collection?ownership=all&dimensions=missing&collectionContext=${KEY}&collectionOrigin=first#collection-game-first`,
    );
    const html = renderModel(model);
    expect(html).toContain(`/games/first?collectionContext=${KEY}&amp;collectionOrigin=first`);
    expect(html).toContain(`/games/last?collectionContext=${KEY}&amp;collectionOrigin=first`);
    expect(html).toContain('aria-label="Previous game: First Game"');
    expect(html).toContain('aria-label="Next game: Last Game"');
    expect(html).toContain('data-actions="existing"');
  });

  test("encodes destination and preserved origin independently", () => {
    const encodedContext = context([
      { id: "origin & one", name: "Origin" },
      { id: "target / two", name: "Target" },
    ]);
    const model = buildDetailCollectionContextModel(encodedContext, "origin & one", "origin & one");
    const html = renderModel(model);

    expect(model?.collectionHref).toContain("collectionOrigin=origin+%26+one");
    expect(model?.collectionHref).toEndWith("#collection-game-origin%20%26%20one");
    expect(html).toContain(
      `/games/target%20%2F%20two?collectionContext=${KEY}&amp;collectionOrigin=origin+%26+one`,
    );
  });

  test("renders first and last boundaries as non-focusable text without wrapping", () => {
    const firstHtml = renderModel(buildDetailCollectionContextModel(context(), "first", "first"));
    expect(firstHtml).toContain("No previous game");
    expect(firstHtml).not.toContain(`/games/last?`);
    expect(firstHtml).toContain(`/games/middle%20%2F%20game?collectionContext=${KEY}`);

    const lastHtml = renderModel(buildDetailCollectionContextModel(context(), "last", "first"));
    expect(lastHtml).toContain("No next game");
    expect(lastHtml).not.toContain(`/games/first?collectionContext=${KEY}`);
    expect(lastHtml).toContain(`/games/middle%20%2F%20game?collectionContext=${KEY}`);

    for (const html of [firstHtml, lastHtml]) {
      expect(html).not.toMatch(/<a[^>]*>No (previous|next) game<\/a>/);
      expect(html).not.toMatch(/tabindex=.*No (previous|next) game/);
    }
  });

  test("supports both positions in a two-entry sequence", () => {
    const two = context([
      { id: "one", name: "One" },
      { id: "two", name: "Two" },
    ]);
    expect(buildDetailCollectionContextModel(two, "one", "one")?.navigation).toEqual({
      previous: null,
      next: { id: "two", name: "Two" },
    });
    expect(buildDetailCollectionContextModel(two, "two", "one")?.navigation).toEqual({
      previous: { id: "one", name: "One" },
      next: null,
    });
  });

  test("keeps a contextual breadcrumb but omits the strip for one entry", () => {
    const one = context([{ id: "only", name: "Only Game" }]);
    const model = buildDetailCollectionContextModel(one, "only", "only");
    const html = renderModel(model);

    expect(model?.navigation).toBeNull();
    expect(html).toContain(`/collection?ownership=all&amp;dimensions=missing`);
    expect(html).toContain(`collectionContext=${KEY}`);
    expect(html).not.toContain("detail-collection-navigation");
  });

  test("renders a plain breadcrumb and no strip without a valid model", () => {
    const html = renderModel(null);
    expect(html).toContain('href="/collection"');
    expect(html).not.toContain("collectionContext");
    expect(html).not.toContain("detail-collection-navigation");
  });

  test("omits invalid current or origin membership instead of guessing", () => {
    expect(buildDetailCollectionContextModel(context(), "missing", "first")).toBeNull();
    expect(buildDetailCollectionContextModel(context(), "first", "missing")).toBeNull();
    expect(
      buildDetailCollectionContextModel(
        context([
          { id: "duplicate", name: "One" },
          { id: "duplicate", name: "Two" },
        ]),
        "duplicate",
        "duplicate",
      ),
    ).toBeNull();
  });

  test("retains the full destination name in accessible labels", () => {
    const longName = "A destination name that is visually truncated but remains complete";
    const model = buildDetailCollectionContextModel(
      context([
        { id: "one", name: "One" },
        { id: "two", name: longName },
      ]),
      "one",
      "one",
    );
    expect(renderModel(model)).toContain(`aria-label="Next game: ${longName}"`);
  });
});

describe("game detail Collection navigation lifecycle", () => {
  test("invalidates A through plain and B before revisiting A", () => {
    const a = request("first");
    let lifecycle = createDetailCollectionNavigationLifecycle(a);
    const modelA = buildDetailCollectionContextModel(context(), "first", "first");
    lifecycle = completeDetailCollectionNavigationRequest(lifecycle, lifecycle.generation, modelA);
    expect(lifecycle.model).toBe(modelA);

    lifecycle = transitionDetailCollectionNavigationRequest(
      lifecycle,
      request("direct", undefined, undefined),
    );
    expect(lifecycle.model).toBeNull();
    expect(lifecycle.generation).toBe(1);

    lifecycle = transitionDetailCollectionNavigationRequest(lifecycle, request("last"));
    expect(lifecycle.model).toBeNull();
    expect(lifecycle.generation).toBe(2);

    lifecycle = transitionDetailCollectionNavigationRequest(lifecycle, a);
    expect(lifecycle.model).toBeNull();
    expect(lifecycle.generation).toBe(3);

    lifecycle = completeDetailCollectionNavigationRequest(lifecycle, lifecycle.generation, null);
    expect(lifecycle.model).toBeNull();
    expect(renderModel(lifecycle.model)).toContain('href="/collection"');
  });

  test("rejects deferred out-of-order completion after revisiting the same tuple", async () => {
    const a = request("first");
    let lifecycle = createDetailCollectionNavigationLifecycle(a);
    const firstGeneration = lifecycle.generation;
    const oldCompletion = deferred<DetailCollectionContextModel | null>();
    const applyOldCompletion = oldCompletion.promise.then((model) => {
      lifecycle = completeDetailCollectionNavigationRequest(lifecycle, firstGeneration, model);
    });

    lifecycle = transitionDetailCollectionNavigationRequest(lifecycle, request("last"));
    lifecycle = transitionDetailCollectionNavigationRequest(lifecycle, a);
    const revisitedGeneration = lifecycle.generation;
    const oldModel = buildDetailCollectionContextModel(context(), "first", "first");
    oldCompletion.resolve(oldModel);
    await applyOldCompletion;

    expect(revisitedGeneration).toBe(2);
    expect(lifecycle.generation).toBe(revisitedGeneration);
    expect(lifecycle.model).toBeNull();
  });

  test("keeps expired or invalid revalidation plain and accepts only the newest success", async () => {
    let lifecycle = createDetailCollectionNavigationLifecycle(request("first"));
    const expiredGeneration = lifecycle.generation;
    const expiredCompletion = deferred<DetailCollectionContextModel | null>();
    const applyExpiredCompletion = expiredCompletion.promise.then((model) => {
      lifecycle = completeDetailCollectionNavigationRequest(lifecycle, expiredGeneration, model);
    });
    expiredCompletion.resolve(null);
    await applyExpiredCompletion;
    expect(lifecycle.model).toBeNull();

    lifecycle = transitionDetailCollectionNavigationRequest(lifecycle, request("last"));
    const supersededGeneration = lifecycle.generation;
    const supersededCompletion = deferred<DetailCollectionContextModel | null>();
    const applySupersededCompletion = supersededCompletion.promise.then((model) => {
      lifecycle = completeDetailCollectionNavigationRequest(lifecycle, supersededGeneration, model);
    });

    lifecycle = transitionDetailCollectionNavigationRequest(lifecycle, request("middle / game"));
    const newestGeneration = lifecycle.generation;
    const newestModel = buildDetailCollectionContextModel(context(), "middle / game", "first");
    lifecycle = completeDetailCollectionNavigationRequest(lifecycle, newestGeneration, newestModel);
    supersededCompletion.resolve(buildDetailCollectionContextModel(context(), "last", "first"));
    await applySupersededCompletion;

    expect(lifecycle.generation).toBe(newestGeneration);
    expect(lifecycle.model).toBe(newestModel);
  });
});
