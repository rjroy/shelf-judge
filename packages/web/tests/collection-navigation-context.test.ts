import { describe, expect, test } from "bun:test";
import {
  COLLECTION_NAVIGATION_CONTEXT_PREFIX,
  COLLECTION_NAVIGATION_CONTEXT_TTL_MS,
  MAX_COLLECTION_NAVIGATION_CONTEXTS,
  createCollectionNavigationContext,
  resolveCollectionNavigationContext,
  type CollectionNavigationContextDependencies,
  type CollectionNavigationContextV1,
  type CollectionNavigationExclusiveLockRunner,
  type CollectionNavigationStorage,
  type CreateCollectionNavigationContextInput,
} from "@/lib/collection-navigation-context";

const UUIDS = Array.from(
  { length: 40 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

const immediateLock: CollectionNavigationExclusiveLockRunner = async (_name, operation) =>
  operation();

class MemoryStorage implements CollectionNavigationStorage {
  readonly values = new Map<string, string>();
  failGet = false;
  failSetCount = 0;
  failRemove = false;
  failLength = false;
  failKey = false;
  discardWrites = false;
  keyCalls = 0;
  removeCalls = 0;

  get length(): number {
    if (this.failLength) throw new Error("length unavailable");
    return this.values.size;
  }

  key(index: number): string | null {
    this.keyCalls += 1;
    if (this.failKey) throw new Error("key unavailable");
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    if (this.failGet) throw new Error("read unavailable");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failSetCount > 0) {
      this.failSetCount -= 1;
      throw new Error("quota exceeded");
    }
    if (!this.discardWrites) this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.removeCalls += 1;
    if (this.failRemove) throw new Error("remove unavailable");
    this.values.delete(key);
  }
}

function input(
  entries: CreateCollectionNavigationContextInput["entries"] = [
    { id: "game-1", name: "First Game" },
    { id: "game-2", name: "Second Game" },
  ],
): CreateCollectionNavigationContextInput {
  return {
    entries,
    collectionScope: { showPreviouslyOwned: true, missingDimensionsOnly: false },
    projection: {
      sort: { field: "fitness", direction: "desc" },
      filters: {
        search: "game",
        ratedStatus: "rated",
        playedStatus: "all",
        playerCount: 2,
      },
      predictionsOn: true,
      effectivePredictionsOn: false,
      nichesOn: true,
    },
  };
}

function context(
  key = UUIDS[0] ?? "",
  lastAccessedAt = 1_000,
  overrides: Partial<CollectionNavigationContextV1> = {},
): CollectionNavigationContextV1 {
  return {
    version: 1,
    key,
    ...input(),
    lastAccessedAt,
    ...overrides,
  };
}

function recordKey(key: string): string {
  return `${COLLECTION_NAVIGATION_CONTEXT_PREFIX}${key}`;
}

function seed(storage: MemoryStorage, value: unknown, key = UUIDS[0] ?? ""): void {
  storage.values.set(recordKey(key), JSON.stringify(value));
}

function dependencies(
  storage: CollectionNavigationStorage,
  now: number,
  keys: readonly string[] = UUIDS,
  runExclusive: CollectionNavigationExclusiveLockRunner = immediateLock,
): CollectionNavigationContextDependencies {
  let keyIndex = 0;
  return {
    storage,
    clock: () => now,
    generateKey: () => keys[keyIndex++] ?? "",
    runExclusive,
  };
}

function storedContext(storage: MemoryStorage, key: string): CollectionNavigationContextV1 {
  const raw = storage.values.get(recordKey(key));
  if (raw === undefined) throw new Error(`Missing context ${key}`);
  return JSON.parse(raw) as CollectionNavigationContextV1;
}

describe("collection navigation context store", () => {
  test("creates and resolves a complete versioned context", async () => {
    const storage = new MemoryStorage();
    const key = await createCollectionNavigationContext(input(), dependencies(storage, 10_000));

    expect(key).toBe(UUIDS[0]);
    expect(storage.values.size).toBe(1);
    expect(
      await resolveCollectionNavigationContext(key ?? "", {
        ...dependencies(storage, 12_000),
        currentId: "game-2",
        originId: "game-1",
      }),
    ).toEqual(context(key ?? "", 12_000));
  });

  test("sets creation recency and refreshes detail and return accesses", async () => {
    const storage = new MemoryStorage();
    const key = await createCollectionNavigationContext(input(), dependencies(storage, 1_000));
    expect(storedContext(storage, key ?? "").lastAccessedAt).toBe(1_000);

    await resolveCollectionNavigationContext(key ?? "", {
      ...dependencies(storage, 2_000),
      currentId: "game-1",
      originId: "game-2",
    });
    expect(storedContext(storage, key ?? "").lastAccessedAt).toBe(2_000);

    await resolveCollectionNavigationContext(key ?? "", {
      ...dependencies(storage, 3_000),
      originId: "game-2",
    });
    expect(storedContext(storage, key ?? "").lastAccessedAt).toBe(3_000);
  });

  test("rejects malformed JSON, unsupported versions, and every malformed field family", async () => {
    const valid = context();
    const malformedValues: Array<{ label: string; value: unknown }> = [
      { label: "non-object", value: [] },
      { label: "top-level extra field", value: { ...valid, extra: true } },
      { label: "unsupported version", value: { ...valid, version: 2 } },
      { label: "invalid key", value: { ...valid, key: "../sort-key" } },
      { label: "empty entries", value: { ...valid, entries: [] } },
      { label: "entry shape", value: { ...valid, entries: [{ id: "game-1" }] } },
      { label: "entry extra field", value: { ...valid, entries: [{ id: "a", name: "A", x: 1 }] } },
      { label: "empty entry ID", value: { ...valid, entries: [{ id: " ", name: "A" }] } },
      { label: "empty entry name", value: { ...valid, entries: [{ id: "a", name: "" }] } },
      {
        label: "duplicate IDs",
        value: {
          ...valid,
          entries: [
            { id: "a", name: "A" },
            { id: "a", name: "Again" },
          ],
        },
      },
      { label: "scope shape", value: { ...valid, collectionScope: { showPreviouslyOwned: true } } },
      {
        label: "scope union",
        value: {
          ...valid,
          collectionScope: { showPreviouslyOwned: "yes", missingDimensionsOnly: false },
        },
      },
      { label: "projection shape", value: { ...valid, projection: { ...valid.projection, x: 1 } } },
      {
        label: "sort shape",
        value: { ...valid, projection: { ...valid.projection, sort: { field: "fitness" } } },
      },
      {
        label: "empty sort field",
        value: {
          ...valid,
          projection: { ...valid.projection, sort: { field: " ", direction: "desc" } },
        },
      },
      {
        label: "sort direction union",
        value: {
          ...valid,
          projection: { ...valid.projection, sort: { field: "fitness", direction: "sideways" } },
        },
      },
      {
        label: "filter shape",
        value: {
          ...valid,
          projection: {
            ...valid.projection,
            filters: { ...valid.projection.filters, extra: true },
          },
        },
      },
      {
        label: "filter search",
        value: {
          ...valid,
          projection: { ...valid.projection, filters: { ...valid.projection.filters, search: 1 } },
        },
      },
      {
        label: "rated status union",
        value: {
          ...valid,
          projection: {
            ...valid.projection,
            filters: { ...valid.projection.filters, ratedStatus: "sometimes" },
          },
        },
      },
      {
        label: "played status union",
        value: {
          ...valid,
          projection: {
            ...valid.projection,
            filters: { ...valid.projection.filters, playedStatus: "sometimes" },
          },
        },
      },
      {
        label: "player count",
        value: {
          ...valid,
          projection: {
            ...valid.projection,
            filters: { ...valid.projection.filters, playerCount: "two" },
          },
        },
      },
      {
        label: "prediction toggle",
        value: { ...valid, projection: { ...valid.projection, predictionsOn: 1 } },
      },
      {
        label: "effective prediction toggle",
        value: { ...valid, projection: { ...valid.projection, effectivePredictionsOn: null } },
      },
      {
        label: "niches toggle",
        value: { ...valid, projection: { ...valid.projection, nichesOn: "yes" } },
      },
      { label: "timestamp type", value: { ...valid, lastAccessedAt: "1000" } },
    ];

    for (const malformed of malformedValues) {
      const storage = new MemoryStorage();
      seed(storage, malformed.value);
      expect(
        await resolveCollectionNavigationContext(valid.key, {
          ...dependencies(storage, 2_000),
          currentId: "game-1",
        }),
        malformed.label,
      ).toBeNull();
      expect(storage.values.has(recordKey(valid.key)), malformed.label).toBe(false);
    }

    const storage = new MemoryStorage();
    storage.values.set(recordKey(valid.key), "{not json");
    expect(
      await resolveCollectionNavigationContext(valid.key, dependencies(storage, 2_000)),
    ).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  test("rejects non-finite timestamps before JSON serialization can normalize them", async () => {
    for (const timestamp of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const storage = new MemoryStorage();
      const raw = JSON.stringify(context()).replace(
        '"lastAccessedAt":1000',
        `"lastAccessedAt":${timestamp}`,
      );
      storage.values.set(recordKey(UUIDS[0] ?? ""), raw);
      expect(
        await resolveCollectionNavigationContext(UUIDS[0] ?? "", dependencies(storage, 2_000)),
      ).toBeNull();
    }

    expect(
      await createCollectionNavigationContext(
        input(),
        dependencies(new MemoryStorage(), Number.NaN),
      ),
    ).toBeNull();
  });

  test("requires requested current and origin IDs exactly once", async () => {
    const storage = new MemoryStorage();
    seed(storage, context());
    expect(
      await resolveCollectionNavigationContext(UUIDS[0] ?? "", {
        ...dependencies(storage, 2_000),
        currentId: "missing",
      }),
    ).toBeNull();
    expect(
      await resolveCollectionNavigationContext(UUIDS[0] ?? "", {
        ...dependencies(storage, 2_000),
        originId: "missing",
      }),
    ).toBeNull();
    expect(
      await resolveCollectionNavigationContext(UUIDS[0] ?? "", {
        ...dependencies(storage, 2_000),
        currentId: " ",
      }),
    ).toBeNull();

    seed(
      storage,
      context(UUIDS[0], 1_000, {
        entries: [
          { id: "game-1", name: "A" },
          { id: "game-1", name: "B" },
        ],
      }),
    );
    expect(
      await resolveCollectionNavigationContext(UUIDS[0] ?? "", {
        ...dependencies(storage, 2_000),
        currentId: "game-1",
        originId: "game-1",
      }),
    ).toBeNull();
  });

  test("rejects a valid payload key that differs from its valid storage-key suffix", async () => {
    const storage = new MemoryStorage();
    seed(storage, context(UUIDS[1]), UUIDS[0]);

    expect(
      await resolveCollectionNavigationContext(UUIDS[0] ?? "", {
        ...dependencies(storage, 2_000),
        currentId: "game-1",
      }),
    ).toBeNull();
    expect(storage.values.has(recordKey(UUIDS[0] ?? ""))).toBe(false);
  });

  test("accepts just before seven days and rejects the exact expiration boundary", async () => {
    const beforeBoundary = new MemoryStorage();
    seed(beforeBoundary, context(UUIDS[0], 100));
    expect(
      await resolveCollectionNavigationContext(
        UUIDS[0] ?? "",
        dependencies(beforeBoundary, 100 + COLLECTION_NAVIGATION_CONTEXT_TTL_MS - 1),
      ),
    ).not.toBeNull();

    const atBoundary = new MemoryStorage();
    seed(atBoundary, context(UUIDS[0], 100));
    expect(
      await resolveCollectionNavigationContext(
        UUIDS[0] ?? "",
        dependencies(atBoundary, 100 + COLLECTION_NAVIGATION_CONTEXT_TTL_MS),
      ),
    ).toBeNull();
    expect(atBoundary.values.size).toBe(0);
  });

  test("returns the valid read without advancing recency when refresh writing fails", async () => {
    const storage = new MemoryStorage();
    seed(storage, context(UUIDS[0], 1_000));
    storage.failSetCount = 1;

    const resolved = await resolveCollectionNavigationContext(UUIDS[0] ?? "", {
      ...dependencies(storage, 5_000),
      currentId: "game-1",
    });

    expect(resolved?.lastAccessedAt).toBe(1_000);
    expect(storedContext(storage, UUIDS[0] ?? "").lastAccessedAt).toBe(1_000);
  });

  test("returns the confirmed post-refresh reread rather than the locally written object", async () => {
    class TransformingRereadStorage extends MemoryStorage {
      private refreshWritten = false;
      private readsAfterRefresh = 0;

      override setItem(key: string, value: string): void {
        super.setItem(key, value);
        if (key === recordKey(UUIDS[0] ?? "")) this.refreshWritten = true;
      }

      override getItem(key: string): string | null {
        const raw = super.getItem(key);
        if (!this.refreshWritten || key !== recordKey(UUIDS[0] ?? "") || raw === null) {
          return raw;
        }
        this.readsAfterRefresh += 1;
        if (this.readsAfterRefresh !== 2) return raw;
        const reread = JSON.parse(raw) as CollectionNavigationContextV1;
        return JSON.stringify({
          ...reread,
          entries: reread.entries.map((entry) =>
            entry.id === "game-2" ? { ...entry, name: "Second Game From Reread" } : entry,
          ),
        });
      }
    }

    const storage = new TransformingRereadStorage();
    seed(storage, context(UUIDS[0], 1_000));
    const resolved = await resolveCollectionNavigationContext(
      UUIDS[0] ?? "",
      dependencies(storage, 5_000),
    );

    expect(resolved?.lastAccessedAt).toBe(5_000);
    expect(resolved?.entries[1]?.name).toBe("Second Game From Reread");
  });

  test("keeps timestamps monotonic across serialized competing operations", async () => {
    const storage = new MemoryStorage();
    seed(storage, context(UUIDS[0], 1_000));
    let tail = Promise.resolve();
    const serializedLock: CollectionNavigationExclusiveLockRunner = <Result>(
      _name: string,
      operation: () => Promise<Result>,
    ) => {
      const result = tail.then(operation, operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };

    const newer = resolveCollectionNavigationContext(UUIDS[0] ?? "", {
      ...dependencies(storage, 5_000, UUIDS, serializedLock),
      currentId: "game-1",
    });
    const olderClock = resolveCollectionNavigationContext(UUIDS[0] ?? "", {
      ...dependencies(storage, 3_000, UUIDS, serializedLock),
      currentId: "game-1",
    });

    expect((await newer)?.lastAccessedAt).toBe(5_000);
    expect((await olderClock)?.lastAccessedAt).toBe(5_000);
    expect(storedContext(storage, UUIDS[0] ?? "").lastAccessedAt).toBe(5_000);
  });

  test("cleans malformed and expired records and retains the newest 20 deterministically", async () => {
    const storage = new MemoryStorage();
    const now = COLLECTION_NAVIGATION_CONTEXT_TTL_MS + 10_000;
    for (let index = 0; index < 22; index += 1) {
      const key = UUIDS[index] ?? "";
      seed(storage, context(key, now - index), key);
    }
    const expiredKey = UUIDS[30] ?? "";
    seed(storage, context(expiredKey, 1), expiredKey);
    storage.values.set(recordKey(UUIDS[31] ?? ""), "bad json");

    await resolveCollectionNavigationContext(UUIDS[0] ?? "", {
      ...dependencies(storage, now),
      currentId: "game-1",
    });

    expect(storage.values.size).toBe(MAX_COLLECTION_NAVIGATION_CONTEXTS);
    expect(storage.values.has(recordKey(UUIDS[0] ?? ""))).toBe(true);
    expect(storage.values.has(recordKey(UUIDS[19] ?? ""))).toBe(true);
    expect(storage.values.has(recordKey(UUIDS[20] ?? ""))).toBe(false);
    expect(storage.values.has(recordKey(expiredKey))).toBe(false);
  });

  test("refreshes before LRU and prefers the requested key when timestamps tie", async () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 21; index += 1) {
      const key = UUIDS[index] ?? "";
      seed(storage, context(key, 5_000), key);
    }
    const requestedKey = UUIDS[20] ?? "";

    expect(
      await resolveCollectionNavigationContext(requestedKey, {
        ...dependencies(storage, 5_000),
        originId: "game-1",
      }),
    ).not.toBeNull();
    expect(storage.values.size).toBe(MAX_COLLECTION_NAVIGATION_CONTEXTS);
    expect(storage.values.has(recordKey(requestedKey))).toBe(true);
  });

  test("refreshes an old requested record before LRU cleanup can evict it", async () => {
    const storage = new MemoryStorage();
    const requestedKey = UUIDS[20] ?? "";
    seed(storage, context(requestedKey, 1_000), requestedKey);
    for (let index = 0; index < 20; index += 1) {
      const key = UUIDS[index] ?? "";
      seed(storage, context(key, 5_000), key);
    }

    const resolved = await resolveCollectionNavigationContext(requestedKey, {
      ...dependencies(storage, 6_000),
      currentId: "game-1",
    });

    expect(resolved?.lastAccessedAt).toBe(6_000);
    expect(storage.values.size).toBe(MAX_COLLECTION_NAVIGATION_CONTEXTS);
    expect(storedContext(storage, requestedKey).lastAccessedAt).toBe(6_000);
  });

  test("evicts the lexically greatest non-requested key when all timestamps tie", async () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 21; index += 1) {
      const key = UUIDS[index] ?? "";
      seed(storage, context(key, 5_000), key);
    }
    const requestedKey = UUIDS[9] ?? "";

    await resolveCollectionNavigationContext(requestedKey, dependencies(storage, 5_000));

    expect(storage.values.has(recordKey(requestedKey))).toBe(true);
    expect(storage.values.has(recordKey(UUIDS[19] ?? ""))).toBe(true);
    expect(storage.values.has(recordKey(UUIDS[20] ?? ""))).toBe(false);
  });

  test("retries UUID collisions without replacing an existing record", async () => {
    const storage = new MemoryStorage();
    const existing = context(UUIDS[0], 500, { entries: [{ id: "old", name: "Old" }] });
    seed(storage, existing);

    const key = await createCollectionNavigationContext(
      input([{ id: "new", name: "New" }]),
      dependencies(storage, 1_000, [UUIDS[0] ?? "", UUIDS[1] ?? ""]),
    );

    expect(key).toBe(UUIDS[1]);
    expect(storedContext(storage, UUIDS[0] ?? "")).toEqual(existing);
    expect(storedContext(storage, UUIDS[1] ?? "").entries).toEqual([{ id: "new", name: "New" }]);
  });

  test("checks collisions and confirms the write inside the named exclusive lock", async () => {
    let lockHeld = false;
    const unlockedOperations: string[] = [];
    class LockCheckingStorage extends MemoryStorage {
      override getItem(key: string): string | null {
        if (!lockHeld) unlockedOperations.push(`get:${key}`);
        return super.getItem(key);
      }

      override setItem(key: string, value: string): void {
        if (!lockHeld) unlockedOperations.push(`set:${key}`);
        super.setItem(key, value);
      }
    }

    const storage = new LockCheckingStorage();
    seed(storage, context(UUIDS[0], 500));
    const lockNames: string[] = [];
    const lockRunner: CollectionNavigationExclusiveLockRunner = async <Result>(
      name: string,
      operation: () => Promise<Result>,
    ) => {
      lockNames.push(name);
      lockHeld = true;
      try {
        const result = await operation();
        return result;
      } finally {
        lockHeld = false;
      }
    };

    expect(
      await createCollectionNavigationContext(
        input([{ id: "new", name: "New" }]),
        dependencies(storage, 1_000, [UUIDS[0] ?? "", UUIDS[1] ?? ""], lockRunner),
      ),
    ).toBe(UUIDS[1]);
    expect(lockNames).toEqual(["shelf-judge-collection-navigation"]);
    expect(unlockedOperations).toEqual([]);
    expect(storedContext(storage, UUIDS[0] ?? "").entries).toEqual([
      { id: "game-1", name: "First Game" },
      { id: "game-2", name: "Second Game" },
    ]);
    expect(storedContext(storage, UUIDS[1] ?? "").entries).toEqual([{ id: "new", name: "New" }]);
  });

  test("requires complete write/read-back confirmation", async () => {
    const discarded = new MemoryStorage();
    discarded.discardWrites = true;
    expect(
      await createCollectionNavigationContext(input(), dependencies(discarded, 1_000)),
    ).toBeNull();

    const quotaFailure = new MemoryStorage();
    quotaFailure.failSetCount = 1;
    expect(
      await createCollectionNavigationContext(input(), dependencies(quotaFailure, 1_000)),
    ).toBeNull();
    expect(quotaFailure.values.size).toBe(0);
  });

  test("stores independent immutable records and copies caller-owned input", async () => {
    const storage = new MemoryStorage();
    const firstEntries = [{ id: "first", name: "First" }];
    const firstInput = input(firstEntries);
    const firstKey = await createCollectionNavigationContext(
      firstInput,
      dependencies(storage, 1_000, [UUIDS[0] ?? ""]),
    );
    firstEntries[0] = { id: "mutated", name: "Mutated" };
    const secondKey = await createCollectionNavigationContext(
      input([{ id: "second", name: "Second" }]),
      dependencies(storage, 2_000, [UUIDS[1] ?? ""]),
    );

    await resolveCollectionNavigationContext(firstKey ?? "", dependencies(storage, 3_000));
    expect(storedContext(storage, firstKey ?? "")).toEqual(
      context(firstKey ?? "", 3_000, { entries: [{ id: "first", name: "First" }] }),
    );
    expect(storedContext(storage, secondKey ?? "").entries).toEqual([
      { id: "second", name: "Second" },
    ]);
  });

  test("falls back to read-only resolution when locking is unavailable", async () => {
    const storage = new MemoryStorage();
    seed(storage, context(UUIDS[0], 1_000));
    storage.values.set(recordKey(UUIDS[1] ?? ""), "malformed");
    const unavailableLock: CollectionNavigationExclusiveLockRunner = () =>
      Promise.reject(new Error("locks unavailable"));

    expect(
      await createCollectionNavigationContext(
        input(),
        dependencies(storage, 2_000, [UUIDS[2] ?? ""], unavailableLock),
      ),
    ).toBeNull();
    const resolved = await resolveCollectionNavigationContext(UUIDS[0] ?? "", {
      ...dependencies(storage, 2_000, UUIDS, unavailableLock),
      currentId: "game-1",
    });
    expect(resolved?.lastAccessedAt).toBe(1_000);
    expect(storedContext(storage, UUIDS[0] ?? "").lastAccessedAt).toBe(1_000);
    expect(storage.values.has(recordKey(UUIDS[1] ?? ""))).toBe(true);
  });

  test("contains storage, clock, key generation, lock, and cleanup failures", async () => {
    const readFailure = new MemoryStorage();
    readFailure.failGet = true;
    expect(
      await createCollectionNavigationContext(input(), dependencies(readFailure, 1_000)),
    ).toBeNull();
    expect(
      await resolveCollectionNavigationContext(UUIDS[0] ?? "", dependencies(readFailure, 1_000)),
    ).toBeNull();

    const cleanupFailure = new MemoryStorage();
    seed(cleanupFailure, context());
    cleanupFailure.failLength = true;
    cleanupFailure.failRemove = true;
    expect(
      await resolveCollectionNavigationContext(UUIDS[0] ?? "", dependencies(cleanupFailure, 2_000)),
    ).not.toBeNull();

    const throwingClock = {
      ...dependencies(new MemoryStorage(), 1_000),
      clock: () => {
        throw new Error("clock failed");
      },
    };
    expect(await createCollectionNavigationContext(input(), throwingClock)).toBeNull();

    const throwingGenerator = {
      ...dependencies(new MemoryStorage(), 1_000),
      generateKey: () => {
        throw new Error("random failed");
      },
    };
    expect(await createCollectionNavigationContext(input(), throwingGenerator)).toBeNull();

    const throwingLock: CollectionNavigationExclusiveLockRunner = () => {
      throw new Error("lock failed");
    };
    expect(
      await createCollectionNavigationContext(
        input(),
        dependencies(new MemoryStorage(), 1_000, UUIDS, throwingLock),
      ),
    ).toBeNull();
  });

  test("contains invoked storage key and removal failures without losing current-page context", async () => {
    const keyFailure = new MemoryStorage();
    seed(keyFailure, context(UUIDS[0], 1_000));
    keyFailure.failKey = true;
    const keyFailureResult = await resolveCollectionNavigationContext(
      UUIDS[0] ?? "",
      dependencies(keyFailure, 2_000),
    );
    expect(keyFailure.keyCalls).toBeGreaterThan(0);
    expect(keyFailureResult?.lastAccessedAt).toBe(2_000);

    const removeFailure = new MemoryStorage();
    seed(removeFailure, context(UUIDS[0], 1_000));
    removeFailure.values.set(recordKey(UUIDS[1] ?? ""), "malformed");
    removeFailure.failRemove = true;
    const removeFailureResult = await resolveCollectionNavigationContext(
      UUIDS[0] ?? "",
      dependencies(removeFailure, 2_000),
    );
    expect(removeFailure.removeCalls).toBeGreaterThan(0);
    expect(removeFailureResult?.lastAccessedAt).toBe(2_000);
    expect(removeFailure.values.has(recordKey(UUIDS[1] ?? ""))).toBe(true);
  });

  test("contains a throwing default localStorage getter", async () => {
    const originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    let lockCalls = 0;
    const lockRunner: CollectionNavigationExclusiveLockRunner = async (_name, operation) => {
      lockCalls += 1;
      return operation();
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage is blocked", "SecurityError");
      },
    });

    try {
      const defaultDependencies = {
        clock: () => 1_000,
        generateKey: () => UUIDS[0] ?? "",
        runExclusive: lockRunner,
      };
      expect(await createCollectionNavigationContext(input(), defaultDependencies)).toBeNull();
      expect(
        await resolveCollectionNavigationContext(UUIDS[0] ?? "", defaultDependencies),
      ).toBeNull();
      expect(lockCalls).toBe(0);
    } finally {
      if (originalStorageDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "localStorage");
      } else {
        Object.defineProperty(globalThis, "localStorage", originalStorageDescriptor);
      }
    }
  });

  test("rejects invalid create inputs and opaque lookup keys without storage access", async () => {
    const storage = new MemoryStorage();
    const invalidInput = JSON.parse(
      JSON.stringify(input()),
    ) as CreateCollectionNavigationContextInput;
    Object.defineProperty(invalidInput, "entries", { value: [{ id: "", name: "Bad" }] });
    expect(
      await createCollectionNavigationContext(invalidInput, dependencies(storage, 1_000)),
    ).toBeNull();

    const extraInput = JSON.parse(
      JSON.stringify(input()),
    ) as CreateCollectionNavigationContextInput;
    Object.defineProperty(extraInput, "extra", { value: true, enumerable: true });
    expect(
      await createCollectionNavigationContext(extraInput, dependencies(storage, 1_000)),
    ).toBeNull();

    storage.failGet = true;
    expect(
      await resolveCollectionNavigationContext("shelf-judge-sort", dependencies(storage, 1_000)),
    ).toBeNull();
  });
});
