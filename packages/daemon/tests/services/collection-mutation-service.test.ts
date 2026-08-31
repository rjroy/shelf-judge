import { describe, expect, test } from "bun:test";
import type { Collection } from "@shelf-judge/shared";
import {
  collectionMutationServiceFor,
  createCollectionMutationService,
  collectionRevisionStrategy,
} from "../../src/services/collection-mutation-service.js";
import type { Logger } from "../../src/services/logger.js";
import type {
  CollectionPersistence,
  CollectionReader,
} from "../../src/services/storage-service.js";

const initialTime = "2026-01-01T00:00:00.000Z";

function collection(): Collection {
  return {
    schemaVersion: 6,
    revision: 0,
    id: "collection-1",
    name: "Private collection name",
    axes: [],
    games: [],
    intentions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: initialTime,
    updatedAt: initialTime,
  };
}

function controlledStorage(options: { failFirstSave?: boolean } = {}) {
  let stored = collection();
  let saveCount = 0;
  let releaseFirstSave = () => {};
  let signalFirstSaveStarted = () => {};
  const firstSaveRelease = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });
  const firstSaveStarted = new Promise<void>((resolve) => {
    signalFirstSaveStarted = resolve;
  });
  const storage: CollectionReader & CollectionPersistence = {
    loadCollection: () => Promise.resolve(structuredClone(stored)),
    saveCollection: async (next) => {
      saveCount++;
      if (saveCount === 1) {
        signalFirstSaveStarted();
        await firstSaveRelease;
        if (options.failFirstSave) throw new Error("disk unavailable");
      }
      stored = structuredClone(next);
    },
  };
  return {
    storage,
    firstSaveStarted,
    releaseFirstSave,
    saveCount: () => saveCount,
    stored: () => structuredClone(stored),
  };
}

describe("CollectionMutationService", () => {
  test("uses monotonic collection revision semantics", () => {
    const source: Collection = {
      ...collection(),
      revision: 7,
    };

    expect(collectionRevisionStrategy.identity(source)).toEqual({
      collectionId: "collection-1",
      schemaVersion: 6,
      revision: 7,
    });
    expect(collectionRevisionStrategy.advance(source, source).revision).toBe(8);
    expect(source.revision).toBe(7);
    expect(() =>
      collectionRevisionStrategy.advance(
        { ...source, revision: 0 },
        { ...source, revision: Number.MAX_SAFE_INTEGER },
      ),
    ).toThrow("safe integer range");
  });

  test("serializes different writer operations against the latest accepted collection", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });

    const gameWriter = service.mutate(
      { operation: "game.ownership.set", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        candidate.name = "Game writer accepted";
        candidate.revision = 99;
        return { changed: true, value: "game" };
      },
    );
    await ctx.firstSaveStarted;
    const axisWriter = service.mutate(
      { operation: "axis.create", trigger: "owner" },
      (candidate) => {
        candidate.entertainmentBenchmark = {
          state: "configured",
          amount: { hundredths: 800, source: "manual", confirmedAt: initialTime },
        };
        return { changed: true, value: "axis" };
      },
    );

    await Promise.resolve();
    expect(ctx.saveCount()).toBe(1);
    ctx.releaseFirstSave();
    await Promise.all([gameWriter, axisWriter]);

    expect(ctx.stored().name).toBe("Game writer accepted");
    expect(ctx.stored().entertainmentBenchmark).toMatchObject({
      state: "configured",
      amount: { hundredths: 800 },
    });
    expect(ctx.saveCount()).toBe(2);
    expect(ctx.stored().revision).toBe(2);
  });

  test("does not persist no-ops or advance the revision", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });

    const outcome = await service.mutate(
      { operation: "purchase.benchmark.clear", trigger: "owner" },
      (candidate) => ({ changed: false, value: candidate.id }),
    );

    expect(outcome).toMatchObject({
      outcome: "no-op",
      changed: false,
      value: "collection-1",
      collection: { schemaVersion: 6, revision: 0, id: "collection-1", updatedAt: initialTime },
    });
    expect(ctx.saveCount()).toBe(0);
  });

  test("isolates rejected and invalid candidates from active state", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      service.mutate({ operation: "game.rate", trigger: "owner" }, (candidate) => {
        candidate.name = "must not leak";
        throw new Error("domain rejected");
      }),
    ).rejects.toThrow("domain rejected");
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(
      service.mutate({ operation: "axis.create", trigger: "owner" }, (candidate) => {
        candidate.name = "";
        candidate.schemaVersion = 99 as 6;
        return { changed: true, value: undefined };
      }),
    ).rejects.toThrow();

    expect(ctx.stored()).toEqual(collection());
    expect(ctx.saveCount()).toBe(0);
  });

  test("releases the queue after persistence failure and retries from durable state", async () => {
    const ctx = controlledStorage({ failFirstSave: true });
    const service = createCollectionMutationService({ storageService: ctx.storage });
    const failed = service.mutate(
      { operation: "game.rate", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        candidate.name = "failed candidate";
        return { changed: true, value: undefined };
      },
    );
    await ctx.firstSaveStarted;
    const retry = service.mutate(
      { operation: "game.rate", trigger: "retry", gameIds: ["game-1"] },
      (candidate) => {
        expect(candidate.name).toBe("Private collection name");
        candidate.name = "retry accepted";
        return { changed: true, value: undefined };
      },
    );

    ctx.releaseFirstSave();
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(failed).rejects.toThrow("disk unavailable");
    await retry;
    expect(ctx.stored().name).toBe("retry accepted");
    expect(ctx.stored().revision).toBe(1);
    expect(ctx.saveCount()).toBe(2);
  });

  test("runs post-commit work after persistence and before the next mutation", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });
    const events: string[] = [];
    const first = service.mutate(
      { operation: "game.bgg.refresh", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        candidate.name = "accepted";
        return {
          changed: true,
          value: undefined,
          onPersistenceSuccess() {
            expect(ctx.stored().name).toBe("accepted");
            events.push("post-commit");
          },
        };
      },
    );
    await ctx.firstSaveStarted;
    const second = service.mutate(
      { operation: "game.bgg.refresh-failed", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        events.push("second-mutation");
        expect(candidate.name).toBe("accepted");
        return { changed: false, value: undefined };
      },
    );

    ctx.releaseFirstSave();
    await Promise.all([first, second]);

    expect(events).toEqual(["post-commit", "second-mutation"]);
  });

  test("compensates persistence failure without running post-commit work", async () => {
    const ctx = controlledStorage({ failFirstSave: true });
    const service = createCollectionMutationService({ storageService: ctx.storage });
    const events: string[] = [];
    const mutation = service.mutate(
      { operation: "game.bgg.refresh", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        candidate.name = "failed";
        return {
          changed: true,
          value: undefined,
          onPersistenceFailure() {
            events.push("compensated");
          },
          onPersistenceSuccess() {
            events.push("post-commit");
          },
        };
      },
    );
    await ctx.firstSaveStarted;
    ctx.releaseFirstSave();

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(mutation).rejects.toThrow("disk unavailable");
    expect(events).toEqual(["compensated"]);
    expect(ctx.stored()).toEqual(collection());
  });

  test("propagates post-commit failure after durable persistence and releases the queue", async () => {
    const ctx = controlledStorage();
    const service = createCollectionMutationService({ storageService: ctx.storage });
    const first = service.mutate(
      { operation: "game.bgg.refresh", trigger: "owner", gameIds: ["game-1"] },
      (candidate) => {
        candidate.name = "durably accepted";
        return {
          changed: true,
          value: undefined,
          onPersistenceSuccess() {
            throw new Error("generation update failed");
          },
        };
      },
    );
    await ctx.firstSaveStarted;
    ctx.releaseFirstSave();

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(first).rejects.toThrow("generation update failed");
    expect(ctx.stored().name).toBe("durably accepted");
    await service.mutate({ operation: "game.rate", trigger: "owner" }, (candidate) => {
      expect(candidate.name).toBe("durably accepted");
      return { changed: false, value: undefined };
    });
  });

  test("logs seam identity and affected IDs without collection contents", async () => {
    const ctx = controlledStorage();
    const entries: unknown[][] = [];
    const logger: Logger = {
      log: (...values) => entries.push(values),
      warn: (...values) => entries.push(values),
      error: (...values) => entries.push(values),
    };
    const service = createCollectionMutationService({ storageService: ctx.storage, logger });
    const operation = service.mutate(
      {
        operation: "game.bgg.refresh",
        trigger: "owner",
        gameIds: ["game-1"],
        intentionIds: ["intention-1"],
      },
      (candidate) => {
        candidate.name = "Secret replacement";
        return { changed: true, value: undefined };
      },
    );
    await ctx.firstSaveStarted;
    ctx.releaseFirstSave();
    await operation;

    const serialized = JSON.stringify(entries);
    expect(serialized).toContain("game.bgg.refresh");
    expect(serialized).toContain("game-1");
    expect(serialized).toContain("intention-1");
    expect(serialized).toContain("collection-1");
    expect(serialized).toContain("accepted");
    expect(serialized).not.toContain("Private collection name");
    expect(serialized).not.toContain("Secret replacement");
  });

  test("logs primary persistence and compensation failures", async () => {
    const ctx = controlledStorage({ failFirstSave: true });
    const entries: unknown[][] = [];
    const logger: Logger = {
      log: (...values) => entries.push(values),
      warn: (...values) => entries.push(values),
      error: (...values) => entries.push(values),
    };
    const service = createCollectionMutationService({ storageService: ctx.storage, logger });
    const mutation = service.mutate(
      { operation: "shelf.unit.remove", trigger: "owner" },
      (candidate) => {
        candidate.name = "candidate";
        return {
          changed: true,
          value: undefined,
          onPersistenceFailure() {
            throw new Error("rollback unavailable");
          },
        };
      },
    );
    await ctx.firstSaveStarted;
    ctx.releaseFirstSave();

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(mutation).rejects.toThrow("rollback unavailable");
    expect(entries.some(([message]) => message === "collection mutation persistence failed")).toBe(
      true,
    );
    expect(entries.some(([message]) => message === "collection mutation compensation failed")).toBe(
      true,
    );
  });

  test("returns one coordinator for every service sharing a storage boundary", () => {
    const ctx = controlledStorage();
    const explicit = createCollectionMutationService({ storageService: ctx.storage });
    expect(collectionMutationServiceFor(ctx.storage)).toBe(explicit);
    expect(createCollectionMutationService({ storageService: ctx.storage })).toBe(explicit);
  });
});
