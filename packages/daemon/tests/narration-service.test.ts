import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createNarrationService } from "../src/services/narration-service.js";
import type { NarrationService } from "../src/services/narration-service.js";
import type { GameService } from "../src/services/game-service.js";

function createStubGameService(): GameService {
  return {
    listGames: () => Promise.resolve([]),
    getGame: () => Promise.reject(new Error("not implemented")),
    addGame: () => Promise.reject(new Error("not implemented")),
    rateGame: () => Promise.reject(new Error("not implemented")),
    removeGame: () => Promise.reject(new Error("not implemented")),
    searchGames: () => Promise.reject(new Error("not implemented")),
    refreshBggData: () => Promise.reject(new Error("not implemented")),
    refreshAllBggData: () => Promise.reject(new Error("not implemented")),
    importBggCollection: () => Promise.reject(new Error("not implemented")),
  };
}

describe("NarrationService", () => {
  let service: NarrationService;
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    service = createNarrationService({ gameService: createStubGameService() });
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test("isAvailable returns true when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(service.isAvailable()).toBe(true);
  });

  test("isAvailable returns false when ANTHROPIC_API_KEY is not set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(service.isAvailable()).toBe(false);
  });

  test("isAvailable returns false when ANTHROPIC_API_KEY is empty string", () => {
    process.env.ANTHROPIC_API_KEY = "";
    expect(service.isAvailable()).toBe(false);
  });
});
