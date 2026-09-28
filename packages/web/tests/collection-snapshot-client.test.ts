/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/await-thenable */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { CollectionSnapshotSchema, type CollectionSnapshot } from "@shelf-judge/shared";
import {
  createCollectionSnapshotClient,
  type SnapshotStore,
} from "@/lib/collection-snapshot-client";

function fixture(overrides: Partial<CollectionSnapshot> = {}): CollectionSnapshot {
  return CollectionSnapshotSchema.parse({
    representationVersion: 1,
    collectionId: "collection-a",
    serverId: "server-a",
    status: "complete",
    unavailableFeatures: [],
    axes: [],
    ignoredTags: [],
    redundancyMode: "off",
    games: [],
    nichePositions: { availability: "available", positions: [] },
    capacity: { availability: "available", result: null },
    counts: { total: 0, rated: 0, predicted: 0, unavailablePredictions: 0 },
    averageScore: null,
    ...overrides,
  });
}

function harness(fetcher: typeof fetch, store?: SnapshotStore) {
  const writes: unknown[] = [];
  const deletes: number[] = [];
  const memory: SnapshotStore = store ?? {
    async read() {
      return null;
    },
    async replace(record) {
      writes.push(record);
    },
    async clear() {
      deletes.push(1);
    },
  };
  const client = createCollectionSnapshotClient({ fetch: fetcher, store: memory });
  return { client, writes, deletes };
}

afterEach(() => {});

describe("collection snapshot client", () => {
  test("fetches and persists a validated complete response with ETag", async () => {
    const snap = fixture();
    const { client, writes } = harness(
      async () => new Response(JSON.stringify(snap), { status: 200, headers: { ETag: '"v1"' } }),
    );
    const result = await client.load();
    expect(result.snapshot).toEqual(snap);
    expect(writes).toHaveLength(1);
  });

  test("revalidates a persisted snapshot across client recreation and replaces it on changed 200", async () => {
    let stored: { snapshot: CollectionSnapshot; etag: string } | null = null;
    const store: SnapshotStore = {
      async read() {
        return stored;
      },
      async replace(record) {
        stored = record;
      },
      async clear() {
        stored = null;
      },
    };
    const firstClient = createCollectionSnapshotClient({
      store,
      fetch: async () =>
        new Response(JSON.stringify(fixture()), { status: 200, headers: { ETag: '"v1"' } }),
    });
    await firstClient.load();

    let requestValidator: string | null = null;
    const reloadClient = createCollectionSnapshotClient({
      store,
      fetch: async (_input, init) => {
        requestValidator = new Headers(init?.headers).get("If-None-Match");
        return new Response(null, { status: 304, headers: { ETag: '"v1"' } });
      },
    });
    expect((await reloadClient.load()).source).toBe("not-modified");
    expect(requestValidator).toBe('"v1"');

    const changed = fixture({ collectionId: "collection-v2" });
    const changedClient = createCollectionSnapshotClient({
      store,
      fetch: async (_input, init) => {
        expect(new Headers(init?.headers).get("If-None-Match")).toBe('"v1"');
        return new Response(JSON.stringify(changed), { status: 200, headers: { ETag: '"v2"' } });
      },
    });
    expect((await changedClient.load()).snapshot.collectionId).toBe("collection-v2");
    expect(stored?.etag).toBe('"v2"');
  });

  test("accepts 304 only with matching valid persisted snapshot and validator", async () => {
    let requested: Headers | undefined;
    const snap = fixture();
    const store: SnapshotStore = {
      async read() {
        return { snapshot: snap, etag: '"v1"' };
      },
      async replace() {},
      async clear() {},
    };
    const { client } = harness(async (_input, init) => {
      requested = new Headers(init?.headers);
      return new Response(null, { status: 304, headers: { ETag: '"v1"' } });
    }, store);
    expect((await client.load()).snapshot).toEqual(snap);
    expect(requested?.get("If-None-Match")).toBe('"v1"');
  });

  test("reads and validates a persisted snapshot exactly once", async () => {
    let reads = 0;
    const cached = fixture();
    const store: SnapshotStore = {
      async read() {
        reads++;
        return { snapshot: cached, etag: '"v1"' };
      },
      async replace() {},
      async clear() {},
    };
    const safeParse = spyOn(CollectionSnapshotSchema, "safeParse");
    try {
      const { client } = harness(
        async () => new Response(null, { status: 304, headers: { ETag: '"v1"' } }),
        store,
      );
      expect((await client.load()).source).toBe("not-modified");
      expect(reads).toBe(1);
      expect(safeParse).toHaveBeenCalledTimes(1);
    } finally {
      safeParse.mockRestore();
    }
  });

  test("retries unconditionally when 304 lacks a valid matching body", async () => {
    const headers: Array<string | null> = [];
    const store: SnapshotStore = {
      async read() {
        return { snapshot: fixture(), etag: '"old"' };
      },
      async replace() {},
      async clear() {},
    };
    const { client } = harness(
      async (_input, init) => {
        const etag = new Headers(init?.headers).get("If-None-Match");
        headers.push(etag);
        return etag
          ? new Response(null, { status: 304 })
          : new Response(JSON.stringify(fixture()), { status: 200, headers: { ETag: '"new"' } });
      },
      {
        ...store,
        async read() {
          return { snapshot: fixture({ serverId: "bad" }), etag: '"old"' };
        },
      },
    );
    expect((await client.load()).snapshot.serverId).toBe("server-a");
    expect(headers).toEqual(['"old"', null]);
  });

  test("falls back unconditionally for an invalid raw cached object", async () => {
    let reads = 0;
    let validator: string | null = "unexpected";
    const { client } = harness(
      async (_input, init) => {
        validator = new Headers(init?.headers).get("If-None-Match");
        return new Response(JSON.stringify(fixture()), { status: 200 });
      },
      {
        async read() {
          reads++;
          return { snapshot: { invalid: true }, etag: '"stale"' };
        },
        async replace() {},
        async clear() {},
      },
    );
    expect((await client.load()).snapshot.serverId).toBe("server-a");
    expect(reads).toBe(1);
    expect(validator).toBeNull();
  });

  test("treats malformed persisted ETags as cache misses instead of failing request construction", async () => {
    const invalidEtags = [
      '"cached\nInjected: yes"',
      '"cached\rvalue"',
      '"cached\tvalue"',
      "missing-quotes",
      '"unterminated',
    ];
    for (const etag of invalidEtags) {
      let requestCount = 0;
      let validator: string | null = "unexpected";
      const { client } = harness(
        async (_input, init) => {
          requestCount++;
          validator = new Headers(init?.headers).get("If-None-Match");
          return new Response(JSON.stringify(fixture()), { status: 200 });
        },
        {
          async read() {
            return { snapshot: fixture(), etag };
          },
          async replace() {},
          async clear() {},
        },
      );

      expect((await client.load()).snapshot.serverId).toBe("server-a");
      expect(requestCount).toBe(1);
      expect(validator).toBeNull();
    }
  });

  test("does not treat a persisted degraded snapshot as a valid 304 body", async () => {
    let calls = 0;
    const degraded = fixture({
      status: "degraded",
      unavailableFeatures: [{ feature: "capacity", reason: "offline" }],
    });
    const store: SnapshotStore = {
      async read() {
        return { snapshot: degraded, etag: '"old"' };
      },
      async replace() {},
      async clear() {},
    };
    const { client } = harness(async (_input, init) => {
      calls++;
      if (new Headers(init?.headers).has("If-None-Match"))
        return new Response(null, { status: 304 });
      return new Response(JSON.stringify(fixture()), { status: 200, headers: { ETag: '"new"' } });
    }, store);
    expect((await client.load()).snapshot.status).toBe("complete");
    expect(calls).toBe(2);
  });

  test("renders degraded 200 but does not replace the last complete record", async () => {
    const degraded = fixture({
      status: "degraded",
      unavailableFeatures: [{ feature: "capacity", reason: "offline" }],
    });
    const { client, writes } = harness(
      async () =>
        new Response(JSON.stringify(degraded), {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        }),
    );
    expect((await client.load()).snapshot.status).toBe("degraded");
    expect(writes).toHaveLength(0);
  });

  test("network failure never serves stored stale data", async () => {
    const store: SnapshotStore = {
      async read() {
        return { snapshot: fixture(), etag: '"v1"' };
      },
      async replace() {},
      async clear() {},
    };
    const { client } = harness(async () => {
      throw new Error("offline");
    }, store);
    await expect(client.load()).rejects.toThrow("offline");
  });

  test("falls back to network when persistence write fails (quota)", async () => {
    const { client } = harness(
      async () =>
        new Response(JSON.stringify(fixture()), { status: 200, headers: { ETag: '"v1"' } }),
      {
        async read() {
          return null;
        },
        async replace() {
          throw new Error("quota");
        },
        async clear() {},
      },
    );
    expect((await client.load()).snapshot.status).toBe("complete");
  });

  test("replaces the single stored identity after a validated identity switch", async () => {
    let stored: { snapshot: CollectionSnapshot; etag: string } | null = {
      snapshot: fixture(),
      etag: '"a"',
    };
    const store: SnapshotStore = {
      async read() {
        return stored;
      },
      async replace(value) {
        stored = value;
      },
      async clear() {
        stored = null;
      },
    };
    const { client } = harness(
      async () =>
        new Response(JSON.stringify(fixture({ serverId: "server-b" })), {
          status: 200,
          headers: { ETag: '"b"' },
        }),
      store,
    );
    await client.load();
    expect(stored?.snapshot.serverId).toBe("server-b");
  });

  test("discards an overtaken response and forces unconditional request after mutation", async () => {
    let resolveFirst!: (response: Response) => void;
    let calls = 0;
    const { client, writes } = harness(async () => {
      calls++;
      if (calls === 1)
        return await new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      return new Response(JSON.stringify(fixture({ collectionId: "fresh" })), {
        status: 200,
        headers: { ETag: '"fresh"' },
      });
    });
    const pending = client.load();
    await Promise.resolve();
    client.onCommittedMutation();
    const fresh = await client.load();
    resolveFirst(
      new Response(JSON.stringify(fixture()), { status: 200, headers: { ETag: '"old"' } }),
    );
    await expect(pending).rejects.toThrow();
    expect(fresh.snapshot.collectionId).toBe("fresh");
    expect(writes).toHaveLength(1);
  });

  test("forced-body mutation skips stale read and retains old complete validator after degraded response", async () => {
    let stored = { snapshot: fixture(), etag: '"old"' };
    let reads = 0;
    const validators: Array<string | null> = [];
    const degraded = fixture({
      status: "degraded",
      unavailableFeatures: [{ feature: "capacity", reason: "offline" }],
    });
    const store: SnapshotStore = {
      async read() {
        reads++;
        return stored;
      },
      async replace(record) {
        stored = record;
      },
      async clear() {},
    };
    const { client } = harness(async (_input, init) => {
      const validator = new Headers(init?.headers).get("If-None-Match");
      validators.push(validator);
      if (validators.length === 1) return new Response(JSON.stringify(degraded), { status: 200 });
      return new Response(null, { status: 304, headers: { ETag: '"old"' } });
    }, store);

    client.onCommittedMutation();
    expect((await client.load()).snapshot.status).toBe("degraded");
    expect(reads).toBe(0);
    expect(validators).toEqual([null]);

    expect((await client.load()).source).toBe("not-modified");
    expect(reads).toBe(1);
    expect(validators).toEqual([null, '"old"']);
    expect(stored.etag).toBe('"old"');
  });
});
