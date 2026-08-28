import { describe, expect, test } from "bun:test";
import { refreshBggData, setGameOwnership } from "@/lib/api";

async function rejection(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to reject");
}

describe("web mutation API boundaries", () => {
  test("rejects malformed ownership daemon responses", async () => {
    const error = await rejection(() =>
      setGameOwnership("game-1", "owned", () =>
        Promise.resolve({ game: { id: "game-1" }, linkedIntentionTransition: null }),
      ),
    );
    expect(error).toBeInstanceOf(Error);
  });

  test("rejects malformed BGG refresh daemon responses", async () => {
    const error = await rejection(() =>
      refreshBggData("game-1", () =>
        Promise.resolve({ game: { id: "game-1" }, linkedIntentionTransition: null }),
      ),
    );
    expect(error).toBeInstanceOf(Error);
  });

  test("preserves daemon request failures before response parsing", async () => {
    const daemonError = new Error("Daemon error 503: unavailable");
    expect(
      await rejection(() => setGameOwnership("game-1", "owned", () => Promise.reject(daemonError))),
    ).toBe(daemonError);
  });
});
