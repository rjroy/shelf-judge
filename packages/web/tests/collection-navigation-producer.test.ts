import { describe, expect, test } from "bun:test";
import {
  collectionNavigationFingerprint,
  createCollectionNavigationEntries,
  createCollectionNavigationProducerState,
  runCollectionNavigationProducerLifecycle,
  selectCollectionNavigationKey,
  transitionCollectionNavigationProducer,
  type CollectionNavigationContextCreator,
  type CollectionNavigationFingerprintInput,
  type CollectionNavigationProducerDispatch,
  type CollectionNavigationProducerEvent,
  type CollectionNavigationProducerState,
} from "@/lib/collection-navigation-producer";

function input(): CollectionNavigationFingerprintInput {
  return {
    entries: [
      { id: "game-1", name: "First" },
      { id: "game-2", name: "Second" },
    ],
    collectionScope: { showPreviouslyOwned: false, missingDimensionsOnly: false },
    projection: {
      sort: { field: "fitness", direction: "desc" },
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
    viewMode: "flat",
  };
}

function attemptedState(
  value: CollectionNavigationFingerprintInput,
): CollectionNavigationProducerState {
  const fingerprint = collectionNavigationFingerprint(value);
  return transitionCollectionNavigationProducer(
    createCollectionNavigationProducerState(fingerprint),
    {
      type: "persistence-attempted",
      fingerprint,
    },
  );
}

function successfulState(
  value: CollectionNavigationFingerprintInput,
  key = "context-key",
): CollectionNavigationProducerState {
  const fingerprint = collectionNavigationFingerprint(value);
  return transitionCollectionNavigationProducer(attemptedState(value), {
    type: "persistence-succeeded",
    fingerprint,
    key,
  });
}

function lifecycleHarness(initialInput = input()): {
  readonly dispatch: CollectionNavigationProducerDispatch;
  readonly events: CollectionNavigationProducerEvent[];
  state: CollectionNavigationProducerState;
} {
  const harness = {
    state: createCollectionNavigationProducerState(collectionNavigationFingerprint(initialInput)),
    events: [] as CollectionNavigationProducerEvent[],
    dispatch(event: CollectionNavigationProducerEvent): CollectionNavigationProducerState {
      harness.events.push(event);
      harness.state = transitionCollectionNavigationProducer(harness.state, event);
      return harness.state;
    },
  };
  return harness;
}

function deferred<Result>(): {
  readonly promise: Promise<Result>;
  resolve(value: Result): void;
  reject(reason: unknown): void;
} {
  let resolvePromise: (value: Result) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  const promise = new Promise<Result>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

describe("collection navigation projection fingerprint", () => {
  test("has a canonical exact representation for structurally equal inputs", () => {
    const expected =
      '{"entries":[[0,"game-1","First"],[1,"game-2","Second"]],"sort":["fitness","desc"],"filters":["","all","all",null],"scope":[false,false],"predictions":[false,false],"nichesOn":false,"viewMode":"flat"}';

    expect(collectionNavigationFingerprint(input())).toBe(expected);
    expect(collectionNavigationFingerprint(input())).toBe(collectionNavigationFingerprint(input()));
  });

  const variations: ReadonlyArray<{
    label: string;
    change: (base: CollectionNavigationFingerprintInput) => CollectionNavigationFingerprintInput;
    eligible: boolean;
  }> = [
    {
      label: "entry ID",
      change: (base) => ({ ...base, entries: [{ id: "changed", name: "First" }, base.entries[1]] }),
      eligible: true,
    },
    {
      label: "entry name",
      change: (base) => ({
        ...base,
        entries: [{ id: "game-1", name: "Changed" }, base.entries[1]],
      }),
      eligible: true,
    },
    {
      label: "entry order",
      change: (base) => ({ ...base, entries: [base.entries[1], base.entries[0]] }),
      eligible: true,
    },
    {
      label: "sort field",
      change: (base) => ({
        ...base,
        projection: { ...base.projection, sort: { ...base.projection.sort, field: "name" } },
      }),
      eligible: true,
    },
    {
      label: "sort direction",
      change: (base) => ({
        ...base,
        projection: { ...base.projection, sort: { ...base.projection.sort, direction: "asc" } },
      }),
      eligible: true,
    },
    {
      label: "search",
      change: (base) => ({
        ...base,
        projection: {
          ...base.projection,
          filters: { ...base.projection.filters, search: "first" },
        },
      }),
      eligible: true,
    },
    {
      label: "rated status",
      change: (base) => ({
        ...base,
        projection: {
          ...base.projection,
          filters: { ...base.projection.filters, ratedStatus: "rated" },
        },
      }),
      eligible: true,
    },
    {
      label: "played status",
      change: (base) => ({
        ...base,
        projection: {
          ...base.projection,
          filters: { ...base.projection.filters, playedStatus: "played" },
        },
      }),
      eligible: true,
    },
    {
      label: "player count",
      change: (base) => ({
        ...base,
        projection: {
          ...base.projection,
          filters: { ...base.projection.filters, playerCount: 2 },
        },
      }),
      eligible: true,
    },
    {
      label: "ownership scope",
      change: (base) => ({
        ...base,
        collectionScope: { ...base.collectionScope, showPreviouslyOwned: true },
      }),
      eligible: true,
    },
    {
      label: "dimensions scope",
      change: (base) => ({
        ...base,
        collectionScope: { ...base.collectionScope, missingDimensionsOnly: true },
      }),
      eligible: true,
    },
    {
      label: "user prediction state",
      change: (base) => ({
        ...base,
        projection: { ...base.projection, predictionsOn: true },
      }),
      eligible: true,
    },
    {
      label: "effective prediction state",
      change: (base) => ({
        ...base,
        projection: { ...base.projection, effectivePredictionsOn: true },
      }),
      eligible: true,
    },
    {
      label: "niches state",
      change: (base) => ({
        ...base,
        projection: { ...base.projection, nichesOn: true },
      }),
      eligible: true,
    },
    {
      label: "grouped mode",
      change: (base) => ({ ...base, viewMode: "grouped" }),
      eligible: false,
    },
  ];

  for (const { label, change, eligible } of variations) {
    test(`${label} changes identity and rejects the old key`, () => {
      const original = input();
      const originalFingerprint = collectionNavigationFingerprint(original);
      const originalState = successfulState(original, "old-key");
      const changed = change(original);
      const changedFingerprint = collectionNavigationFingerprint(changed);

      expect(changedFingerprint).not.toBe(originalFingerprint);
      expect(selectCollectionNavigationKey(originalState, changed, true)).toBeNull();

      let changedState = transitionCollectionNavigationProducer(originalState, {
        type: "projection-changed",
        fingerprint: changedFingerprint,
      });
      expect(selectCollectionNavigationKey(changedState, changed, true)).toBeNull();

      if (!eligible) {
        expect(changed.viewMode).toBe("grouped");
        return;
      }

      changedState = transitionCollectionNavigationProducer(changedState, {
        type: "persistence-attempted",
        fingerprint: changedFingerprint,
      });
      expect(selectCollectionNavigationKey(changedState, changed, true)).toBeNull();
      changedState = transitionCollectionNavigationProducer(changedState, {
        type: "persistence-succeeded",
        fingerprint: changedFingerprint,
        key: `new-${label}`,
      });
      expect(selectCollectionNavigationKey(changedState, changed, true)).toBe(`new-${label}`);
      expect(selectCollectionNavigationKey(changedState, original, true)).toBeNull();
    });
  }
});

describe("collection navigation producer lifecycle", () => {
  test("does not create before hydration or for grouped and empty projections", () => {
    const cases: ReadonlyArray<{
      label: string;
      hydrated: boolean;
      value: CollectionNavigationFingerprintInput;
    }> = [
      { label: "prehydration", hydrated: false, value: input() },
      { label: "grouped", hydrated: true, value: { ...input(), viewMode: "grouped" } },
      { label: "empty", hydrated: true, value: { ...input(), entries: [] } },
    ];

    for (const { label, hydrated, value } of cases) {
      const harness = lifecycleHarness();
      let calls = 0;
      const completion = runCollectionNavigationProducerLifecycle({
        hydrated,
        fingerprintInput: value,
        dispatch: harness.dispatch,
        createContext: () => {
          calls += 1;
          return Promise.resolve(`${label}-key`);
        },
      });

      expect(completion, label).toBeNull();
      expect(calls, label).toBe(0);
      expect(harness.state.attemptedFingerprint, label).toBeNull();
      expect(selectCollectionNavigationKey(harness.state, value, hydrated), label).toBeNull();
    }
  });

  test("records an attempt synchronously and deduplicates replay before create runs", async () => {
    const projection = input();
    const fingerprint = collectionNavigationFingerprint(projection);
    const pending = deferred<string | null>();
    const harness = lifecycleHarness(projection);
    let calls = 0;
    const createContext: CollectionNavigationContextCreator = () => {
      calls += 1;
      return pending.promise;
    };

    const first = runCollectionNavigationProducerLifecycle({
      hydrated: true,
      fingerprintInput: projection,
      dispatch: harness.dispatch,
      createContext,
    });
    const replay = runCollectionNavigationProducerLifecycle({
      hydrated: true,
      fingerprintInput: projection,
      dispatch: harness.dispatch,
      createContext,
    });

    expect(first).not.toBeNull();
    expect(replay).toBeNull();
    expect(harness.state.attemptedFingerprint).toBe(fingerprint);
    expect(calls).toBe(0);

    await Promise.resolve();
    expect(calls).toBe(1);
    pending.resolve("created-key");
    await first;
    expect(selectCollectionNavigationKey(harness.state, projection, true)).toBe("created-key");
  });

  test("contains null, synchronous throw, and asynchronous rejection failures", async () => {
    const creators: ReadonlyArray<{
      label: string;
      createContext: CollectionNavigationContextCreator;
    }> = [
      { label: "null", createContext: () => Promise.resolve(null) },
      {
        label: "synchronous throw",
        createContext: () => {
          throw new Error("synchronous failure");
        },
      },
      {
        label: "asynchronous rejection",
        createContext: () => Promise.reject(new Error("asynchronous failure")),
      },
    ];

    for (const { label, createContext } of creators) {
      const projection = input();
      const harness = lifecycleHarness(projection);
      const completion = runCollectionNavigationProducerLifecycle({
        hydrated: true,
        fingerprintInput: projection,
        dispatch: harness.dispatch,
        createContext,
      });

      expect(completion, label).not.toBeNull();
      await completion;
      expect(harness.events.at(-1), label).toEqual({
        type: "persistence-failed",
        fingerprint: collectionNavigationFingerprint(projection),
      });
      expect(selectCollectionNavigationKey(harness.state, projection, true), label).toBeNull();
    }
  });

  test("a changed fingerprint creates exactly once after the prior failure", async () => {
    const first = input();
    const second = { ...first, entries: [{ id: "game-3", name: "Third" }] };
    const harness = lifecycleHarness(first);
    const calls: string[] = [];
    const createContext: CollectionNavigationContextCreator = (contextInput) => {
      calls.push(contextInput.entries[0]?.id ?? "missing");
      return Promise.resolve(calls.length === 1 ? null : "second-key");
    };

    await runCollectionNavigationProducerLifecycle({
      hydrated: true,
      fingerprintInput: first,
      dispatch: harness.dispatch,
      createContext,
    });
    const secondCompletion = runCollectionNavigationProducerLifecycle({
      hydrated: true,
      fingerprintInput: second,
      dispatch: harness.dispatch,
      createContext,
    });
    const secondReplay = runCollectionNavigationProducerLifecycle({
      hydrated: true,
      fingerprintInput: second,
      dispatch: harness.dispatch,
      createContext,
    });

    expect(secondReplay).toBeNull();
    await secondCompletion;
    expect(calls).toEqual(["game-1", "game-3"]);
    expect(selectCollectionNavigationKey(harness.state, second, true)).toBe("second-key");
  });

  test("ignores deferred stale completion after the current lifecycle changes", async () => {
    const first = input();
    const second = { ...first, entries: [{ id: "game-3", name: "Third" }] };
    const firstPending = deferred<string | null>();
    const secondPending = deferred<string | null>();
    const harness = lifecycleHarness(first);
    const createContext: CollectionNavigationContextCreator = (contextInput) =>
      contextInput.entries[0]?.id === "game-1" ? firstPending.promise : secondPending.promise;

    const firstCompletion = runCollectionNavigationProducerLifecycle({
      hydrated: true,
      fingerprintInput: first,
      dispatch: harness.dispatch,
      createContext,
    });
    const secondCompletion = runCollectionNavigationProducerLifecycle({
      hydrated: true,
      fingerprintInput: second,
      dispatch: harness.dispatch,
      createContext,
    });
    await Promise.resolve();

    firstPending.resolve("stale-key");
    await firstCompletion;
    expect(selectCollectionNavigationKey(harness.state, second, true)).toBeNull();

    secondPending.resolve("current-key");
    await secondCompletion;
    expect(selectCollectionNavigationKey(harness.state, second, true)).toBe("current-key");
  });

  test("keeps independent lifecycle attempts, calls, and keys isolated", async () => {
    const projection = input();
    const firstHarness = lifecycleHarness(projection);
    const secondHarness = lifecycleHarness(projection);
    let firstCalls = 0;
    let secondCalls = 0;

    const firstCompletion = runCollectionNavigationProducerLifecycle({
      hydrated: true,
      fingerprintInput: projection,
      dispatch: firstHarness.dispatch,
      createContext: () => {
        firstCalls += 1;
        return Promise.resolve("first-key");
      },
    });
    const secondCompletion = runCollectionNavigationProducerLifecycle({
      hydrated: true,
      fingerprintInput: projection,
      dispatch: secondHarness.dispatch,
      createContext: () => {
        secondCalls += 1;
        return Promise.resolve("second-key");
      },
    });

    await Promise.all([firstCompletion, secondCompletion]);
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);
    expect(selectCollectionNavigationKey(firstHarness.state, projection, true)).toBe("first-key");
    expect(selectCollectionNavigationKey(secondHarness.state, projection, true)).toBe("second-key");
  });
});

describe("collection navigation producer state", () => {
  test("activates all links only after hydration and successful persistence", () => {
    const projection = input();
    const attempted = attemptedState(projection);
    expect(selectCollectionNavigationKey(attempted, projection, false)).toBeNull();
    expect(selectCollectionNavigationKey(attempted, projection, true)).toBeNull();

    const successful = transitionCollectionNavigationProducer(attempted, {
      type: "persistence-succeeded",
      fingerprint: collectionNavigationFingerprint(projection),
      key: "all-links-key",
    });
    expect(selectCollectionNavigationKey(successful, projection, true)).toBe("all-links-key");
  });

  test("deduplicates replayed attempts and leaves a failed fingerprint plain", () => {
    const projection = input();
    const fingerprint = collectionNavigationFingerprint(projection);
    const attempted = attemptedState(projection);
    const replayed = transitionCollectionNavigationProducer(attempted, {
      type: "persistence-attempted",
      fingerprint,
    });
    const failed = transitionCollectionNavigationProducer(replayed, {
      type: "persistence-failed",
      fingerprint,
    });

    expect(replayed).toBe(attempted);
    expect(failed).toBe(attempted);
    expect(selectCollectionNavigationKey(failed, projection, true)).toBeNull();
    expect(
      transitionCollectionNavigationProducer(failed, {
        type: "persistence-attempted",
        fingerprint,
      }),
    ).toBe(failed);
  });

  test("a genuine next fingerprint can attempt after failure", () => {
    const first = input();
    const second = { ...first, entries: [{ id: "game-3", name: "Third" }] };
    const secondFingerprint = collectionNavigationFingerprint(second);
    let state = attemptedState(first);
    state = transitionCollectionNavigationProducer(state, {
      type: "persistence-failed",
      fingerprint: collectionNavigationFingerprint(first),
    });
    state = transitionCollectionNavigationProducer(state, {
      type: "projection-changed",
      fingerprint: secondFingerprint,
    });
    state = transitionCollectionNavigationProducer(state, {
      type: "persistence-attempted",
      fingerprint: secondFingerprint,
    });

    expect(state.attemptedFingerprint).toBe(secondFingerprint);
  });

  test("rejects the old key immediately and ignores stale late success", () => {
    const first = input();
    const second = { ...first, entries: [{ id: "game-3", name: "Third" }] };
    const firstFingerprint = collectionNavigationFingerprint(first);
    const secondFingerprint = collectionNavigationFingerprint(second);
    let state = attemptedState(first);
    state = transitionCollectionNavigationProducer(state, {
      type: "projection-changed",
      fingerprint: secondFingerprint,
    });

    expect(selectCollectionNavigationKey(state, second, true)).toBeNull();
    const afterLateSuccess = transitionCollectionNavigationProducer(state, {
      type: "persistence-succeeded",
      fingerprint: firstFingerprint,
      key: "stale-key",
    });
    expect(afterLateSuccess).toBe(state);
    expect(selectCollectionNavigationKey(afterLateSuccess, second, true)).toBeNull();
  });

  test("separate producer instances do not share attempts or keys", () => {
    const projection = input();
    const first = successfulState(projection, "first-instance");
    const second = createCollectionNavigationProducerState(
      collectionNavigationFingerprint(projection),
    );

    expect(selectCollectionNavigationKey(first, projection, true)).toBe("first-instance");
    expect(selectCollectionNavigationKey(second, projection, true)).toBeNull();
    expect(second.attemptedFingerprint).toBeNull();
  });

  test("empty and grouped projections are ineligible", () => {
    const empty = { ...input(), entries: [] };
    const grouped = { ...input(), viewMode: "grouped" as const };
    expect(selectCollectionNavigationKey(successfulState(empty), empty, true)).toBeNull();
    expect(selectCollectionNavigationKey(successfulState(grouped), grouped, true)).toBeNull();
  });
});

describe("canonical collection entries", () => {
  test("preserves exact withValue then withoutValue structural order", () => {
    const withValue = [
      { game: { id: "valued-2", name: "Valued Two" } },
      { game: { id: "valued-1", name: "Valued One" } },
    ];
    const withoutValue = [
      { game: { id: "missing-3", name: "Missing Three" } },
      { game: { id: "missing-1", name: "Missing One" } },
    ];

    expect(createCollectionNavigationEntries(withValue, withoutValue)).toEqual([
      { id: "valued-2", name: "Valued Two" },
      { id: "valued-1", name: "Valued One" },
      { id: "missing-3", name: "Missing Three" },
      { id: "missing-1", name: "Missing One" },
    ]);
  });
});
