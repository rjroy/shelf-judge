import { describe, expect, test } from "bun:test";
import { createStorageService } from "../src/services/storage-service";
import type { FileOps } from "../src/services/file-ops";

function createInMemoryFileOps(files: Record<string, string>): FileOps {
  return {
    readFile(filePath: string): Promise<string> {
      const content = files[filePath];
      if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
      return Promise.resolve(content);
    },
    writeFile(filePath: string, content: string): Promise<void> {
      files[filePath] = content;
      return Promise.resolve();
    },
    rename(oldPath: string, newPath: string): Promise<void> {
      files[newPath] = files[oldPath]!;
      delete files[oldPath];
      return Promise.resolve();
    },
    exists(filePath: string): Promise<boolean> {
      return Promise.resolve(filePath in files);
    },
    async mkdir(): Promise<void> {},
    unlink(filePath: string): Promise<void> {
      delete files[filePath];
      return Promise.resolve();
    },
  };
}

describe("storage backfill", () => {
  test("legacy game without boxDimensions loads as null", async () => {
    const legacyCollection = {
      id: "col-1",
      name: "Test",
      axes: [],
      games: [
        {
          id: "game-1",
          bggId: 1,
          name: "Legacy Game",
          yearPublished: 2020,
          minPlayers: 2,
          maxPlayers: 4,
          playingTime: 60,
          imageUrl: null,
          bggData: null,
          numPlays: null,
          ownership: "owned",
          ratings: {},
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          // Note: no boxDimensions field at all (legacy data)
        },
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const files: Record<string, string> = {
      "/data/collection.json": JSON.stringify(legacyCollection),
    };

    const storage = createStorageService({
      dataDir: "/data",
      configPath: "/config/config.json",
      fileOps: createInMemoryFileOps(files),
    });

    const collection = await storage.loadCollection();
    expect(collection.games[0].boxDimensions).toBeNull();
  });
});
