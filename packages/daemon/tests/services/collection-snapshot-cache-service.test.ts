import { describe, expect, test } from "bun:test";
import type { CollectionSnapshot } from "@shelf-judge/shared";
import { createSourceVectorService } from "../../src/services/source-vector.js";
import { CollectionSnapshotUnavailableError } from "../../src/services/collection-snapshot-service.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import { createCollectionSnapshotCacheService } from "../../src/services/collection-snapshot-cache-service.js";
import type { CollectionSnapshotBuildResult } from "../../src/services/collection-snapshot-service.js";
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
    semanticRead?:
      | CollectionSnapshotBuildResult["semanticRead"]
      | Pick<
          Extract<CollectionSnapshotBuildResult["semanticRead"], { status: "unified-v2" }>,
          "status" | "proof" | "isCurrent"
        >
      | (() => CollectionSnapshotBuildResult["semanticRead"]);
    logger?: {
      debug?(...args: unknown[]): void;
      log(...args: unknown[]): void;
      warn(...args: unknown[]): void;
      error(...args: unknown[]): void;
    };
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
  let semanticEnabled = false;
  let authorityIdentity = "snapshot-source-content-1";
  let authorityAvailable = true;
  const storage = {
    sourceVector: () => vectorService.read(),
    loadCollection: () =>
      Promise.resolve({ semanticRedundancy: { settings: { enabled: semanticEnabled } } }),
    readCollectionSnapshotAuthority: () =>
      Promise.resolve({ available: authorityAvailable, identity: authorityIdentity }),
  };
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
        semanticRead: (options.semanticRead === undefined
          ? {
              status: "unified-v2" as const,
              proof: {
                version: 2 as const,
                mode: "unified-similarity" as const,
                algorithmVersion: "unified-jaccard-manhattan-jev-v1" as const,
                identity: "a".repeat(64),
                demandedPairsIdentity: "b".repeat(64),
                examinedComponentsIdentity: "c".repeat(64),
              },
              isCurrent: () => true,
              isReusable: () => true,
              validateCurrent: () => Promise.resolve(true),
            }
          : typeof options.semanticRead === "function"
            ? options.semanticRead()
            : options.semanticRead) as CollectionSnapshotBuildResult["semanticRead"],
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
    logger: options.logger,
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
    setSemanticEnabled(value: boolean) {
      if (semanticEnabled !== value) {
        const current = vectorService.read();
        authorityIdentity = `${authorityIdentity}-${value ? "enabled" : "disabled"}`;
        vectorService.publishCollection({
          id: current.collectionId ?? "collection-id",
          schemaVersion: current.collectionSchemaVersion ?? 9,
          revision: (current.collectionRevision ?? 0) + 1,
        });
      }
      semanticEnabled = value;
    },
    setAuthority(identity: string, available = true) {
      authorityIdentity = identity;
      authorityAvailable = available;
    },
  };
}

describe("CollectionSnapshotCacheService", () => {
  test("renders a complete fallback without retaining or validating it", async () => {
    const f = fixture({
      semanticRead: {
        status: "unified-v2",
        proof: {
          version: 2,
          mode: "unified-similarity",
          algorithmVersion: "unified-jaccard-manhattan-jev-v1",
          identity: "a".repeat(64),
          demandedPairsIdentity: "b".repeat(64),
          examinedComponentsIdentity: "c".repeat(64),
        },
        isCurrent: () => true,
        isReusable: () => false,
        validateCurrent: () => Promise.resolve(true),
      },
    });

    const first = await f.cache.resolve();
    const second = await f.cache.resolve(first.etag);

    expect(first.status).toBe(200);
    expect(first.body).not.toBeNull();
    expect(first.cacheable).toBe(false);
    expect(first.etag).toBeNull();
    expect(second.status).toBe(200);
    expect(second.cacheable).toBe(false);
    expect(f.counts().builds).toBe(2);
  });

  test("does not retain a proof from a reader without freshness capabilities", async () => {
    const semanticRead = {
      status: "unified-v2" as const,
      proof: {
        version: 2 as const,
        mode: "unified-similarity" as const,
        algorithmVersion: "unified-jaccard-manhattan-jev-v1" as const,
        identity: "a".repeat(64),
        demandedPairsIdentity: "b".repeat(64),
        examinedComponentsIdentity: "c".repeat(64),
      },
      isCurrent: () => true,
    };
    const f = fixture({ semanticRead });

    const response = await f.cache.resolve();

    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();
    expect(response.cacheable).toBe(false);
    expect(response.etag).toBeNull();
  });

  test("emits correlated, privacy-safe request and build timings", async () => {
    const records: Array<{ level: string; message: string; fields: Record<string, unknown> }> = [];
    const record = (level: string) => (message: unknown, fields: unknown) => {
      records.push({
        level,
        message: String(message),
        fields: (fields ?? {}) as Record<string, unknown>,
      });
    };
    const logger = {
      debug: record("debug"),
      log: record("log"),
      warn: record("warn"),
      error: record("error"),
    };
    const f = fixture({ logger });
    const response = await f.route.request("/collection/snapshot");
    expect(response.status).toBe(200);
    const build = records.find(
      ({ message }) => message === "collection snapshot cache build attempt",
    );
    expect(build?.fields.requestId).toMatch(/^collection-/);
    expect(build?.fields.operationId).toMatch(/^snapshot-build-/);
    expect(build?.fields.flightId).toMatch(/^snapshot-flight-/);
    const enqueued = records.find(
      ({ message }) => message === "collection snapshot reservation enqueue",
    );
    const entered = records.find(
      ({ message }) => message === "collection snapshot reservation entered",
    );
    expect(enqueued?.fields.requestId).toBe(build?.fields.requestId);
    expect(entered?.fields.requestId).toBe(build?.fields.requestId);
    expect(entered?.fields.reservationId).toBe(enqueued?.fields.reservationId);
    expect(enqueued?.fields.candidateFlightId).toBe(build?.fields.flightId);
    expect(entered?.fields.candidateFlightId).toBe(build?.fields.flightId);
    expect(typeof entered?.fields.waitMs).toBe("number");
    const completed = records.find(
      ({ message, fields }) =>
        message === "collection snapshot cache build completed" && fields.outcome === "built",
    );
    expect(typeof completed?.fields.elapsedMs).toBe("number");
    expect(JSON.stringify(records)).not.toContain("Private");
    expect(
      records.some(
        ({ message, fields }) =>
          message === "collection snapshot resolve completed" && fields.outcome === "success",
      ),
    ).toBe(true);
  });

  test("records failed builds with correlation and safe error class only", async () => {
    const records: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const record = (message: unknown, fields: unknown) => {
      records.push({
        message: String(message),
        fields: (fields ?? {}) as Record<string, unknown>,
      });
    };
    const logger = { log: record, warn: record, error: record };
    const f = fixture({
      logger,
      build: () => Promise.reject(new Error("synthetic private description")),
    });
    const response = await f.route.request("/collection/snapshot");
    expect(response.status).toBe(500);
    const failure = records.find(
      ({ message }) => message === "collection snapshot cache build failed",
    );
    expect(failure?.fields.requestId).toMatch(/^collection-/);
    expect(failure?.fields.operationId).toMatch(/^snapshot-build-/);
    expect(failure?.fields.errorClass).toBe("Error");
    expect(JSON.stringify(records)).not.toContain("synthetic private description");
  });

  test("caches one serialized body and returns bodyless weak/strong/list/wildcard matches", async () => {
    const f = fixture();
    const first = await f.route.request("/collection/snapshot");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"cs2-/);
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

  test("semantic redundancy activation preserves the V2 proof and uses the published cache", async () => {
    const f = fixture({
      build: () => {
        const snapshot = makeSnapshot();
        snapshot.redundancyMode = "integrated";
        return Promise.resolve(snapshot);
      },
    });
    const factual = await f.route.request("/collection/snapshot");
    const factualEtag = factual.headers.get("etag")!;
    const unchanged = await f.route.request("/collection/snapshot", {
      headers: { "If-None-Match": factualEtag },
    });
    expect(unchanged.status).toBe(304);

    const token = f.vector.read().changeToken;
    f.setSemanticEnabled(true);
    const enabled = await f.route.request("/collection/snapshot", {
      headers: { "If-None-Match": factualEtag },
    });
    expect(enabled.status).toBe(200);
    expect(enabled.headers.get("cache-control")).toBe("private, no-cache");
    expect(enabled.headers.get("etag")).not.toBeNull();
    expect((JSON.parse(await enabled.text()) as { redundancyMode: string }).redundancyMode).toBe(
      "integrated",
    );
    expect(f.vector.read().changeToken).toBeGreaterThan(token);

    const enabledEtag = enabled.headers.get("etag")!;
    const enabledAgain = await f.cache.resolve(enabledEtag);
    expect(enabledAgain.status).toBe(304);
    expect(enabledAgain.cacheable).toBe(true);
    expect(enabledAgain.etag).toBe(enabledEtag);
    expect(f.counts().builds).toBe(2);

    f.setSemanticEnabled(false);
    const factualAgain = await f.cache.resolve();
    expect(factualAgain.cacheable).toBe(true);
    expect((await f.cache.resolve(factualAgain.etag)).status).toBe(304);
    expect(f.counts().builds).toBe(3);
  });

  test("an activation during an in-flight build discards the old-mode result", async () => {
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
        const snapshot = makeSnapshot();
        snapshot.redundancyMode = "integrated";
        return snapshot;
      },
    });
    const pending = f.cache.resolve();
    await f.waitForBuild();
    f.setSemanticEnabled(true);
    unblock();
    const result = await pending;
    expect(result.status).toBe(200);
    expect(result.cacheable).toBe(true);
    expect(result.etag).not.toBeNull();
    expect(f.counts().builds).toBe(2);
  });

  test("semantic read proof is checked independently for original and joined callers", async () => {
    let release!: () => void;
    let initial = true;
    let firstProofCurrent = true;
    let proofChecks = 0;
    let buildNumber = 0;
    const f = fixture({
      semanticRead: () => {
        const thisBuild = ++buildNumber;
        return {
          status: "verified",
          result: { status: "not-ready", summary: "not ready" },
          proof: { status: "not-ready", summary: "not ready" },
          isCurrent: () => {
            proofChecks += 1;
            return thisBuild > 1 || firstProofCurrent;
          },
        };
      },
      build: async () => {
        if (initial) {
          initial = false;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return makeSnapshot();
      },
    });
    f.setSemanticEnabled(true);
    const original = f.cache.resolve();
    await f.waitForBuild();
    const joined = f.cache.resolve();
    // The original build's read is stale even though the source vector is unchanged.
    firstProofCurrent = false;
    release();
    const [a, b] = await Promise.all([original, joined]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.etag).toBeNull();
    expect(b.etag).toBeNull();
    expect(a.cacheable).toBe(false);
    expect(b.cacheable).toBe(false);
    expect(proofChecks).toBeGreaterThanOrEqual(2);
    expect(f.counts().builds).toBeGreaterThanOrEqual(2);
  });

  test("semantic proof changes are bounded to unavailable instead of returning stale data", async () => {
    let checks = 0;
    const f = fixture({
      semanticRead: () => ({
        status: "verified",
        result: { status: "not-ready", summary: "not ready" },
        proof: { status: "not-ready", summary: "not ready" },
        isCurrent: () => {
          checks += 1;
          return false;
        },
      }),
    });
    f.setSemanticEnabled(true);
    await expectRejected(f.cache.resolve(), "changed repeatedly");
    expect(checks).toBe(2);
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

  test("same-revision content edits to any of the six authoritative sources invalidate the entry", async () => {
    const f = fixture();
    let prior = await f.cache.resolve();
    const sourceNames = [
      "collection",
      "tournament",
      "prediction-settings",
      "redundancy-settings",
      "niche-settings",
      "shelf-config",
    ];
    for (const [index, source] of sourceNames.entries()) {
      f.setAuthority(`same-revision-edit-${source}`);
      const refreshed = await f.cache.resolve(prior.etag);
      expect(refreshed.status).toBe(200);
      expect(refreshed.cacheable).toBe(true);
      expect(refreshed.etag).not.toBe(prior.etag);
      expect(f.vector.read().collectionRevision).toBe(1);
      expect(f.vector.read().tournamentRevision).toBe(1);
      expect(f.counts().builds).toBe(index + 2);
      prior = refreshed;
    }
  });

  test("missing established authority prevents cache reuse and validator publication", async () => {
    const f = fixture();
    const first = await f.cache.resolve();
    f.setAuthority("missing-niche-settings", false);
    await expectRejected(f.cache.resolve(first.etag), "authoritative sources");
    expect(f.counts().builds).toBeGreaterThanOrEqual(2);
    expect(f.counts().builds).toBeLessThanOrEqual(3);
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
    expect(recovered.status).toBe(304);
    expect(recovered.headers.get("etag")).toBe(etag);
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
    expect(secondResponse.cacheable).toBe(false);
    expect(builds).toBeGreaterThanOrEqual(2);
    expect(builds).toBeLessThanOrEqual(3);
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
