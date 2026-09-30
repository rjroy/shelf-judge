import { describe, expect, test } from "bun:test";
import type { CollectionSnapshot } from "@shelf-judge/shared";
import { createSourceVectorService } from "../../src/services/source-vector.js";
import { CollectionSnapshotUnavailableError } from "../../src/services/collection-snapshot-service.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import { createCollectionSnapshotCacheService } from "../../src/services/collection-snapshot-cache-service.js";
import { createCollectionSnapshotRoutes } from "../../src/routes/collection-snapshot.js";

const BASE_TIME = Date.UTC(2026, 0, 1);

function makeSnapshot(status: "complete" | "degraded" = "complete"): CollectionSnapshot {
  return {
    representationVersion: 1,
    collectionId: "collection-id",
    serverId: "server-id",
    status,
    unavailableFeatures: status === "complete" ? [] : [{ feature: "niches", reason: "down" }],
    axes: [],
    ignoredTags: [],
    redundancyMode: "off",
    games: [],
    nichePositions:
      status === "complete"
        ? { availability: "available", positions: [] }
        : { availability: "unavailable", reason: "down" },
    capacity:
      status === "complete"
        ? { availability: "available", result: null }
        : { availability: "unavailable", reason: "down" },
    counts: { total: 0, rated: 0, predicted: 0, unavailablePredictions: 0 },
    averageScore: null,
  };
}

async function expectRejected(promise: Promise<unknown>, fragment: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toContain(fragment);
}

function fixture(
  options: {
    build?: () => Promise<CollectionSnapshot>;
    expiresAtMs?: number | null;
    serialize?: (snapshot: CollectionSnapshot) => string;
  } = {},
) {
  const vectorService = createSourceVectorService();
  vectorService.hydrate(
    { id: "collection-id", schemaVersion: 9, revision: 1 },
    {
      tournament: 1,
      predictionSettings: 1,
      nicheSettings: 1,
      redundancySettings: 1,
      shelfConfig: 1,
    },
  );
  const storage = { sourceVector: () => vectorService.read() };
  let now = BASE_TIME;
  let builds = 0;
  let serializations = 0;
  let signalBuildStarted!: () => void;
  let buildStarted = new Promise<void>((resolve) => {
    signalBuildStarted = resolve;
  });
  let nextStatus: "complete" | "degraded" = "complete";
  const builder = {
    async buildSnapshot() {
      builds += 1;
      signalBuildStarted();
      const sourceVector = vectorService.read();
      const evaluatedAtMs = now;
      const snapshot = options.build ? await options.build() : makeSnapshot(nextStatus);
      return {
        snapshot,
        sourceVector,
        evaluatedAtMs,
        expiresAtMs:
          options.expiresAtMs != null && evaluatedAtMs < options.expiresAtMs
            ? options.expiresAtMs
            : null,
      };
    },
  };
  const cache = createCollectionSnapshotCacheService({
    builder,
    storageService: storage,
    coordinator: profileSourceCoordinatorFor(storage),
    clock: { now: () => now },
    serialize(snapshot) {
      serializations += 1;
      if (options.serialize) return options.serialize(snapshot);
      return JSON.stringify(snapshot);
    },
  });
  return {
    cache,
    route: createCollectionSnapshotRoutes(cache).routes,
    vector: vectorService,
    counts: () => ({ builds, serializations }),
    async waitForBuild() {
      await buildStarted;
      buildStarted = new Promise<void>((resolve) => {
        signalBuildStarted = resolve;
      });
    },
    setNow(value: number) {
      now = value;
    },
    setStatus(value: "complete" | "degraded") {
      nextStatus = value;
    },
  };
}

describe("CollectionSnapshotCacheService", () => {
  test("caches one serialized body and returns bodyless weak/strong/list/wildcard matches", async () => {
    const f = fixture();
    const first = await f.route.request("/collection/snapshot");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"cs1-/);
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    expect(first.headers.get("content-type")).toContain("application/json");
    const body = await first.text();
    expect((JSON.parse(body) as { status: string }).status).toBe("complete");

    const second = await f.route.request("/collection/snapshot");
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(body);
    expect(second.headers.get("etag")).toBe(etag);
    const before = f.counts();
    for (const condition of [etag, etag.replace(/^W\//, ""), `"other", ${etag}`, "*"]) {
      const response = await f.route.request("/collection/snapshot", {
        headers: { "If-None-Match": condition },
      });
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("etag")).toBe(etag);
      expect(response.headers.get("cache-control")).toBe("private, no-cache");
    }
    expect(f.counts()).toEqual(before);
    for (const malformed of [`*, ${etag}`, 'W/"unfinished', "not-an-etag"]) {
      const response = await f.route.request("/collection/snapshot", {
        headers: { "If-None-Match": malformed },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(etag);
    }
    expect(f.counts()).toEqual(before);
  });

  test("source revision changes invalidate; no-op publication retains cache", async () => {
    const f = fixture();
    const first = await f.cache.resolve();
    const token = f.vector.read().changeToken;
    f.vector.publish("tournament", 1);
    expect(f.vector.read().changeToken).toBe(token);
    await f.cache.resolve(first.etag);
    expect(f.counts().builds).toBe(1);
    f.vector.publish("tournament", 2);
    const refreshed = await f.cache.resolve(first.etag);
    expect(refreshed.status).toBe(200);
    expect(f.counts().builds).toBe(2);
    expect(refreshed.etag).not.toBe(first.etag);
  });

  test("serves 200 then 304, then returns a fresh 200 after a semantic factual-weight edit", async () => {
    const f = fixture();
    const first = await f.route.request("/collection/snapshot");
    expect(first.status).toBe(200);
    const oldEtag = first.headers.get("etag")!;
    const unchanged = await f.route.request("/collection/snapshot", {
      headers: { "If-None-Match": oldEtag },
    });
    expect(unchanged.status).toBe(304);

    f.vector.publishCollection({
      id: "collection-id",
      schemaVersion: 9,
      revision: 2,
      semanticEvidenceEpoch: 0,
      semanticConsentEpoch: 0,
      factualWeightsEpoch: 1,
      factualWeightsFingerprint: "a".repeat(64),
    });
    const afterEdit = await f.route.request("/collection/snapshot", {
      headers: { "If-None-Match": oldEtag },
    });
    expect(afterEdit.status).toBe(200);
    expect(afterEdit.headers.get("etag")).not.toBe(oldEtag);
  });

  test("each revisioned source, collection identity, and a new process epoch produce a new validator", async () => {
    const f = fixture();
    let previous = await f.cache.resolve();
    const publish = [
      () => f.vector.publish("tournament", 2),
      () => f.vector.publish("prediction-settings", 2),
      () => f.vector.publish("niche-settings", 2),
      () => f.vector.publish("redundancy-settings", 2),
      () => f.vector.publish("shelf-config", 2),
      () => f.vector.publishCollection({ id: "collection-id", schemaVersion: 9, revision: 2 }),
    ];
    for (const update of publish) {
      update();
      const current = await f.cache.resolve(previous.etag);
      expect(current.status).toBe(200);
      expect(current.etag).not.toBe(previous.etag);
      previous = current;
    }
    const restarted = fixture();
    const afterRestart = await restarted.cache.resolve();
    expect(afterRestart.etag).not.toBe(previous.etag);
  });

  test("mutation after assembly but before publication discards the serialized candidate", async () => {
    const mutation = { publish: undefined as (() => void) | undefined };
    let once = true;
    const f = fixture({
      serialize(snapshot) {
        if (once) {
          once = false;
          mutation.publish?.();
        }
        return JSON.stringify(snapshot);
      },
    });
    mutation.publish = () => f.vector.publish("prediction-settings", 2);
    const refreshed = await f.cache.resolve();
    expect(refreshed.status).toBe(200);
    expect(refreshed.cacheable).toBe(true);
    const next = await f.cache.resolve();
    expect(next.status).toBe(200);
    expect(f.counts().builds).toBe(2);
  });

  test("cold concurrent callers share one build; a rejected flight is cleared", async () => {
    let unblock!: () => void;
    let fail = false;
    let firstBuild = true;
    const f = fixture({
      build: async () => {
        if (fail) throw new Error("temporary build failure");
        if (firstBuild) {
          firstBuild = false;
          await new Promise<void>((resolve) => {
            unblock = resolve;
          });
        }
        return makeSnapshot();
      },
    });
    const a = f.cache.resolve();
    const b = f.cache.resolve();
    await f.waitForBuild();
    expect(f.counts().builds).toBe(1);
    unblock();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.etag).toBe(rb.etag);
    expect(f.counts().serializations).toBe(1);

    f.vector.publish("niche-settings", 2);
    fail = true;
    await expectRejected(f.cache.resolve(), "temporary build failure");
    fail = false;
    const recovered = await f.cache.resolve();
    expect(recovered.status).toBe(200);
    expect(f.counts().builds).toBe(3);
  });

  test("source mutation during build discards the result and does not publish its ETag", async () => {
    let unblock!: () => void;
    let firstBuild = true;
    const f = fixture({
      build: async () => {
        if (firstBuild) {
          firstBuild = false;
          await new Promise<void>((resolve) => {
            unblock = resolve;
          });
        }
        return makeSnapshot();
      },
    });
    const pending = f.cache.resolve();
    await f.waitForBuild();
    const oldToken = f.vector.read().changeToken;
    f.vector.publish("shelf-config", 2);
    unblock();
    const result = await pending;
    expect(result.status).toBe(200);
    expect(result.cacheable).toBe(true);
    expect(f.counts().builds).toBe(2);
    expect(f.vector.read().changeToken).not.toBe(oldToken);
    expect((await f.cache.resolve()).etag).not.toBeNull();
  });

  test("two consecutive publication races are bounded to 503, then recover", async () => {
    const failing = { value: true, publish: undefined as (() => void) | undefined };
    const f = fixture({
      serialize(snapshot) {
        if (failing.value) failing.publish?.();
        return JSON.stringify(snapshot);
      },
    });
    failing.publish = () => {
      const revision = f.vector.read().predictionSettingsRevision;
      f.vector.publish("prediction-settings", revision! + 1);
    };
    const unavailable = await f.route.request("/collection/snapshot");
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    expect(f.counts().builds).toBe(2);
    failing.value = false;
    const recovered = await f.route.request("/collection/snapshot");
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("etag")).not.toBeNull();
    expect(f.counts().builds).toBe(3);
  });

  test("degraded bodies are no-store and never satisfy an older validator; recovery rebuilds", async () => {
    const f = fixture();
    const complete = await f.route.request("/collection/snapshot");
    const etag = complete.headers.get("etag")!;
    f.vector.markUnavailable("niche-settings");
    f.setStatus("degraded");
    const degraded = await f.route.request("/collection/snapshot", {
      headers: { "If-None-Match": etag },
    });
    expect(degraded.status).toBe(200);
    expect(degraded.headers.get("cache-control")).toBe("no-store");
    expect(degraded.headers.get("etag")).toBeNull();
    expect((JSON.parse(await degraded.text()) as { status: string }).status).toBe("degraded");
    f.vector.publish("niche-settings", 1);
    f.setStatus("complete");
    const recovered = await f.route.request("/collection/snapshot", {
      headers: { "If-None-Match": etag },
    });
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("etag")).not.toBe(etag);
  });

  test("a reader queued after degraded completion and a source mutation cannot join the old flight", async () => {
    const vector = createSourceVectorService();
    vector.hydrate(
      { id: "collection-id", schemaVersion: 9, revision: 1 },
      {
        tournament: 1,
        predictionSettings: 1,
        nicheSettings: 1,
        redundancySettings: 1,
        shelfConfig: 1,
      },
    );
    vector.markUnavailable("niche-settings");
    const storage = { sourceVector: () => vector.read() };
    const baseCoordinator = profileSourceCoordinatorFor(storage);
    let pauseCompletion = false;
    let signalPaused!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      signalPaused = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const coordinator = {
      runExclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
        return baseCoordinator.runExclusive(async () => {
          const value = await operation();
          if (pauseCompletion) {
            pauseCompletion = false;
            signalPaused();
            await release;
          }
          return value;
        });
      },
    };
    let builds = 0;
    let status: "complete" | "degraded" = "degraded";
    const cache = createCollectionSnapshotCacheService({
      builder: {
        buildSnapshot() {
          builds += 1;
          return Promise.resolve({
            snapshot: makeSnapshot(status),
            sourceVector: vector.read(),
            evaluatedAtMs: BASE_TIME,
            expiresAtMs: null,
          });
        },
      },
      storageService: storage,
      coordinator,
      clock: { now: () => BASE_TIME },
      serialize(snapshot) {
        if (builds === 1) pauseCompletion = true;
        return JSON.stringify(snapshot);
      },
    });
    const first = cache.resolve();
    await paused;
    const mutate = baseCoordinator.runExclusive(() => {
      vector.publish("niche-settings", 1);
      return Promise.resolve();
    });
    status = "complete";
    const nextReader = cache.resolve();
    resume();
    const [firstResponse, secondResponse] = await Promise.all([first, nextReader, mutate]).then(
      ([firstDecision, secondDecision]) => [firstDecision, secondDecision] as const,
    );
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.snapshotStatus).toBe("complete");
    expect(secondResponse.cacheable).toBe(true);
    expect(builds).toBe(2);
  });

  test("settled degraded snapshots are rebuilt on every later request", async () => {
    const f = fixture();
    f.setStatus("degraded");
    expect((await f.cache.resolve()).snapshotStatus).toBe("degraded");
    expect((await f.cache.resolve()).snapshotStatus).toBe("degraded");
    expect(f.counts().builds).toBe(2);
  });

  test("time deadline expires exactly, rejects backward/non-finite time, and rebuilds", async () => {
    const deadline = BASE_TIME + 100;
    const f = fixture({ expiresAtMs: deadline });
    await f.cache.resolve();
    f.setNow(deadline - 1);
    expect((await f.cache.resolve()).status).toBe(200);
    f.setNow(deadline);
    await f.cache.resolve();
    expect(f.counts().builds).toBe(2);
    f.setNow(BASE_TIME - 1);
    await f.cache.resolve();
    expect(f.counts().builds).toBe(3);
    f.setNow(Number.NaN);
    await expectRejected(f.cache.resolve(), "freshness changed before publication");
  });

  test("required build failure returns 503 with no-store", async () => {
    const f = fixture({
      build: () => Promise.reject(new CollectionSnapshotUnavailableError("required unavailable")),
    });
    const response = await f.route.request("/collection/snapshot");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
