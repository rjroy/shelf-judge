import { describe, expect, test } from "bun:test";
import { REFLECTION_TRANSACTION_FILE } from "../../src/services/reflection-transaction-service.js";
import { createTestApp } from "../helpers/test-app.js";

describe("Reflection runtime composition", () => {
  test("test-app wiring uses the production-equivalent Reflection runtime", () => {
    expect(createTestApp().reflectionRuntime).toBeDefined();
  });

  test("wires startup recovery, note invalidation, and permanent deletion to one runtime", async () => {
    const context = createTestApp();
    const runtime = context.reflectionRuntime;
    await runtime.recover();

    const game = (await context.gameService.addGame({ name: "Lifecycle game" })).game;
    const beforeNote = await runtime.state.getDeletionGeneration();
    expect(
      await context.ownerGameNoteService.set(game.id, {
        commandId: "32000000-0000-4000-8000-000000000001",
        expectedVersion: 0,
        text: "private note",
      }),
    ).toMatchObject({ ok: true });
    const afterNote = await runtime.state.getDeletionGeneration();
    expect(afterNote).not.toBe(beforeNote);

    await context.gameService.removeGame(game.id);
    expect(await runtime.state.getDeletionGeneration()).not.toBe(afterNote);
    expect(
      [...context.fileOps.files.keys()].some((file) => file.endsWith(REFLECTION_TRANSACTION_FILE)),
    ).toBe(false);
  });
});
