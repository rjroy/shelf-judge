import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileOps } from "../../src/services/file-ops.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createUnifiedScoringService } from "../../src/services/unified-scoring-service.js";
import { profileSourceCoordinatorFor } from "../../src/services/profile-source-coordinator.js";
import type { StorageService } from "../../src/services/storage-service.js";
import type { UnifiedSourceFrame } from "../../src/services/unified-scoring-service.js";

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((res) => (resolve = res));
  return { promise, resolve };
}

async function within<Value>(promise: Promise<Value>, timeoutMs = 1_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ completed: true as const, value })),
      new Promise<{ completed: false }>((resolve) => {
        timer = setTimeout(() => resolve({ completed: false }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("unified source capture concurrency", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = null;
  });

  async function harness() {
    directory = await mkdtemp(join(tmpdir(), "unified-capture-flight-"));
    const storage = createStorageService({
      dataDir: directory,
      configPath: join(directory, "config.json"),
      fileOps: createFileOps(),
    });
    await storage.loadCollection();
    await storage.hydrateSourceVector?.();
    const baseCoordinator = profileSourceCoordinatorFor(storage);
    let coordinatorRequests = 0;
    const coordinator = {
      runExclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
        coordinatorRequests += 1;
        return baseCoordinator.runExclusive(operation);
      },
      isHeldByCurrentContext: () => baseCoordinator.isHeldByCurrentContext(),
    };
    let sourceReads = 0;
    const loadSource = storage.loadJevSourceSnapshot?.bind(storage);
    if (!loadSource) throw new Error("Unified source snapshot unavailable in test storage");
    storage.loadJevSourceSnapshot = async () => {
      sourceReads += 1;
      return loadSource();
    };
    const service = createUnifiedScoringService({
      storageService: storage,
      cache: null,
      fitnessService: createFitnessService(),
      coordinator,
    });
    return {
      storage,
      service,
      baseCoordinator,
      counts: () => ({ coordinatorRequests, sourceReads }),
      resetCounts() {
        coordinatorRequests = 0;
        sourceReads = 0;
      },
      overrideSourceLoader(loader: NonNullable<StorageService["loadJevSourceSnapshot"]>) {
        storage.loadJevSourceSnapshot = loader;
      },
      originalSourceLoader: loadSource,
    };
  }

  test("owner-local capture bypasses an external flight; queued externals still coalesce", async () => {
    const h = await harness();
    const ownerReady = deferred();
    const releaseOwner = deferred();
    const cancelOwner = deferred();
    let ownerFrame: UnifiedSourceFrame | null = null;
    const owner = h.baseCoordinator.runExclusive(async () => {
      ownerReady.resolve();
      await releaseOwner.promise;
      const local = h.service.capture();
      const result = await Promise.race([local, cancelOwner.promise.then(() => null)]);
      if (result) {
        ownerFrame = result;
        const changed = await h.storage.loadCollection();
        changed.revision += 1;
        await h.storage.saveCollection(changed);
      }
      return result;
    });
    await ownerReady.promise;

    const externalFlight = h.service.capture();
    const externalJoin = h.service.capture();
    expect(h.counts().coordinatorRequests).toBe(1);
    releaseOwner.resolve();

    const completed = await within(Promise.all([owner, externalFlight, externalJoin]));
    if (!completed.completed) {
      cancelOwner.resolve();
      await owner;
      await externalFlight;
      await externalJoin;
    }
    expect(completed.completed).toBe(true);
    if (!completed.completed) return;
    const [, externalFrame, joinedFrame] = completed.value;
    expect(ownerFrame).not.toBeNull();
    expect(externalFrame).not.toBe(ownerFrame);
    expect(joinedFrame).toBe(externalFrame);
    expect(externalFrame.sourceVector.collectionRevision).toBeGreaterThan(
      ownerFrame!.sourceVector.collectionRevision ?? -1,
    );
    expect(h.counts()).toEqual({ coordinatorRequests: 2, sourceReads: 2 });

    await h.service.capture();
    expect(h.counts().sourceReads).toBe(3);
  });

  test("owner-local capture failure releases the lock without consuming the external flight", async () => {
    const h = await harness();
    const ownerReady = deferred();
    const releaseOwner = deferred();
    const cancelOwner = deferred();
    const original = h.originalSourceLoader;
    if (!original) throw new Error("Unified source snapshot unavailable in test storage");
    let reads = 0;
    h.overrideSourceLoader(async () => {
      reads += 1;
      if (reads === 1) throw new Error("synthetic source failure");
      return original();
    });
    const owner = h.baseCoordinator.runExclusive(async () => {
      ownerReady.resolve();
      await releaseOwner.promise;
      const local = h.service.capture().then(
        () => "unexpected-success",
        () => "owner-failed",
      );
      return Promise.race([local, cancelOwner.promise.then(() => "cancelled")]);
    });
    await ownerReady.promise;
    const external = h.service.capture();
    releaseOwner.resolve();
    const completed = await within(Promise.all([owner, external]));
    if (!completed.completed) {
      cancelOwner.resolve();
      await owner;
      await external;
    }
    expect(completed.completed).toBe(true);
    if (!completed.completed) return;
    expect(completed.value[0]).toBe("owner-failed");
    expect(completed.value[1].sourceVector.available).toBe(true);
    expect(reads).toBe(2);
  });

  test("external joiners share rejection, and a later retry starts a fresh capture", async () => {
    const h = await harness();
    const original = h.originalSourceLoader;
    if (!original) throw new Error("Unified source snapshot unavailable in test storage");
    let reads = 0;
    h.overrideSourceLoader(async () => {
      reads += 1;
      if (reads === 1) throw new Error("synthetic shared failure");
      return original();
    });
    const first = h.service.capture();
    const second = h.service.capture();
    const results = await Promise.allSettled([first, second]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(reads).toBe(1);

    const retry = await h.service.capture();
    expect(retry.sourceVector.available).toBe(true);
    expect(reads).toBe(2);
  });

  test("different capture configurations use independent external flights", async () => {
    const h = await harness();
    const [ownedOnly, withWishlist] = await Promise.all([
      h.service.capture(),
      h.service.capture({ includeWishlist: true }),
    ]);
    expect(ownedOnly).not.toBe(withWishlist);
    expect(h.counts().sourceReads).toBe(2);
  });
});
