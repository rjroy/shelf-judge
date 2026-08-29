import { describe, expect, test } from "bun:test";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import { createTestApp } from "../helpers/test-app.js";

const commandId = "32000000-0000-4000-8000-000000000001";

function mutationPersistenceBarrier(fileOps: ReturnType<typeof createMockFileOps>): {
  arm(): void;
  firstPersistenceStarted: Promise<void>;
  releaseFirst(): void;
  persistenceAttempts(): number;
} {
  const firstPersistence = deferredSignal();
  const release = deferredSignal();
  const rename = fileOps.rename.bind(fileOps);
  let armed = false;
  let persistenceAttempts = 0;

  fileOps.rename = async (from, to) => {
    if (armed && to === "/test/data/collection.json") {
      persistenceAttempts += 1;
      if (persistenceAttempts === 1) {
        firstPersistence.resolve();
        await release.promise;
      }
    }
    await rename(from, to);
  };

  return {
    arm() {
      armed = true;
    },
    firstPersistenceStarted: firstPersistence.promise,
    releaseFirst: () => release.resolve(),
    persistenceAttempts: () => persistenceAttempts,
  };
}

function deferredSignal(): { promise: Promise<void>; resolve(): void } {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => (resolve = complete));
  return { promise, resolve };
}

describe("intention concurrency integration", () => {
  test("creation wins an interleaving, then lost-response replay and changed reuse are unconditional", async () => {
    const now = () => "2026-08-28T12:00:00.000Z";
    const fileOps = createMockFileOps();
    const barrier = mutationPersistenceBarrier(fileOps);
    const ctx = createTestApp({
      fileOps,
      now,
      createIntentionId: () => "interleaved-intention",
    });
    const createdGame = await ctx.gameService.addGame({ name: "Interleaved", numPlays: 0 });
    barrier.arm();
    const create = {
      type: "create" as const,
      commandId,
      gameId: createdGame.game.id,
      kind: "first-play" as const,
      expectedActiveIntention: "absent" as const,
    };
    const intention = ctx.intentionService.execute(create);
    await barrier.firstPersistenceStarted;
    const ownership = ctx.gameService.setOwnership(createdGame.game.id, "previously-owned");
    await Promise.resolve();
    expect(barrier.persistenceAttempts()).toBe(1);
    barrier.releaseFirst();
    const intentionResult = await intention;
    const ownershipResult = await ownership;
    expect(intentionResult).toEqual({
      ok: true,
      commandId,
      intention: {
        intentionId: "interleaved-intention",
        gameId: createdGame.game.id,
        kind: "first-play",
        baseline: {
          playCount: 0,
          evidenceSource: "manual",
          observedAt: now(),
        },
        createdAt: now(),
        version: 1,
        resolution: null,
      },
      linkedOwnershipTransition: null,
    });
    if (!intentionResult.ok) throw new Error("Expected creation to win");
    expect(ownershipResult.linkedIntentionTransition).toEqual({
      ...intentionResult.intention,
      version: 2,
      resolution: { outcome: "retired", source: "owner-retired", resolvedAt: now() },
    });
    const retired = ownershipResult.linkedIntentionTransition;
    if (retired === null) throw new Error("Expected linked retirement");
    const afterRace = await ctx.storageService.loadCollection();
    expect(afterRace.games.find(({ id }) => id === createdGame.game.id)?.ownership).toBe(
      "previously-owned",
    );
    expect(afterRace.intentions).toEqual([retired]);
    expect(afterRace.commandReceipts).toEqual([
      { commandId, request: create, result: intentionResult },
    ]);

    // Treat the accepted response as lost, then prove the durable receipt is the response source.
    expect(await ctx.intentionService.execute(create)).toEqual(intentionResult);
    expect(await ctx.intentionService.execute({ ...create, kind: "replay" })).toEqual({
      ok: false,
      commandId,
      error: { code: "command-reuse", commandId },
    });
    expect(await ctx.storageService.loadCollection()).toEqual(afterRace);
  });

  test("ownership wins the opposite interleaving without creating history or a receipt", async () => {
    const now = () => "2026-08-28T12:00:00.000Z";
    const fileOps = createMockFileOps();
    const barrier = mutationPersistenceBarrier(fileOps);
    const ctx = createTestApp({
      fileOps,
      now,
      createIntentionId: () => "must-not-be-created",
    });
    const { game } = await ctx.gameService.addGame({ name: "Ownership first", numPlays: 0 });
    barrier.arm();
    const create = {
      type: "create" as const,
      commandId,
      gameId: game.id,
      kind: "first-play" as const,
      expectedActiveIntention: "absent" as const,
    };
    const ownership = ctx.gameService.setOwnership(game.id, "previously-owned");
    await barrier.firstPersistenceStarted;
    const intention = ctx.intentionService.execute(create);
    await Promise.resolve();
    expect(barrier.persistenceAttempts()).toBe(1);
    barrier.releaseFirst();
    const ownershipResult = await ownership;
    const intentionResult = await intention;

    expect(ownershipResult.linkedIntentionTransition).toBeNull();
    expect(intentionResult).toEqual({
      ok: false,
      commandId,
      error: { code: "ineligible-game", gameId: game.id, reason: "not-owned" },
    });
    const durable = await ctx.storageService.loadCollection();
    expect(durable.games.find(({ id }) => id === game.id)?.ownership).toBe("previously-owned");
    expect(durable.intentions).toEqual([]);
    expect(durable.commandReceipts).toEqual([]);
  });

  test("reports interrupted persistence without a receipt and accepts an exact retry", async () => {
    const fileOps = createMockFileOps();
    const ctx = createTestApp({ fileOps, now: () => "2026-08-28T12:00:00.000Z" });
    const { game } = await ctx.gameService.addGame({ name: "Interrupted", numPlays: 0 });
    const rename = fileOps.rename.bind(fileOps);
    let interrupt = true;
    fileOps.rename = (from, to) => {
      if (interrupt && to.endsWith("collection.json")) {
        interrupt = false;
        return Promise.reject(new Error("simulated rename interruption"));
      }
      return rename(from, to);
    };
    const command = {
      type: "create" as const,
      commandId,
      gameId: game.id,
      kind: "first-play" as const,
      expectedActiveIntention: "absent" as const,
    };
    expect(await ctx.intentionService.execute(command)).toMatchObject({
      ok: false,
      error: { code: "persistence-failure" },
    });
    expect((await ctx.storageService.loadCollection()).commandReceipts).toEqual([]);
    expect(await ctx.intentionService.execute(command)).toMatchObject({ ok: true });
    const accepted = await ctx.storageService.loadCollection();
    expect(accepted.intentions).toHaveLength(1);
    expect(accepted.commandReceipts).toHaveLength(1);
  });
});
