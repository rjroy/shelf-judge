import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  CollectionSchema,
  createInitialEntityMetadata,
  createInitialSemanticRedundancyState,
  type Collection,
  type DurableGame,
} from "@shelf-judge/shared";
import { createCollectionArtifactContext } from "../../src/services/collection-artifacts.js";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service.js";
import { createOwnerGameNoteService } from "../../src/services/owner-game-note-service.js";
import { createSemanticRedundancyStateService } from "../../src/services/semantic-redundancy-state-service.js";
import { createFileOps, type FileOps } from "../../src/services/file-ops.js";
import { createStorageService } from "../../src/services/storage-service.js";

const NOW = "2026-09-30T10:00:00.000Z";
const NOTE_COMMAND_ID = "44000000-0000-4000-8000-000000000001";
const CLEAR_COMMAND_ID = "44000000-0000-4000-8000-000000000002";
const silentLogger = { log() {}, warn() {}, error() {} };

function game(): DurableGame {
  return {
    id: "game-1",
    bggId: null,
    name: "Private game name",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function initialCollection(): Collection {
  return CollectionSchema.parse({
    schemaVersion: 9,
    revision: 0,
    id: "collection-1",
    name: "Private collection",
    axes: [],
    games: [game()],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: createInitialSemanticRedundancyState(),
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function withProductionEquivalentServices(
  run: (context: {
    dataDir: string;
    storage: ReturnType<typeof createStorageService>;
    fileOps: FileOps;
    mutations: ReturnType<typeof createCollectionMutationService>;
    notes: ReturnType<typeof createOwnerGameNoteService>;
  }) => Promise<void>,
  makeFileOps: () => FileOps = createFileOps,
) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "shelf-semantic-artifacts-"));
  const fileOps = makeFileOps();
  const storage = createStorageService({
    dataDir,
    configPath: path.join(dataDir, "config.json"),
    fileOps,
    logger: silentLogger,
  });
  try {
    await storage.saveCollection(initialCollection());
    const mutations = createCollectionMutationService({
      storageService: storage,
      semanticDisplayArtifactContext: createCollectionArtifactContext(
        dataDir,
        fileOps,
        silentLogger,
      ),
    });
    const notes = createOwnerGameNoteService({
      collectionMutationService: mutations,
      now: () => "2026-09-30T11:00:00.000Z",
      logger: silentLogger,
    });
    await run({ dataDir, storage, fileOps, mutations, notes });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

describe("production semantic display artifact lifecycle", () => {
  test("accepted note edits discard profile/candidates, preserve wishlist, and stay absent after restart", async () => {
    await withProductionEquivalentServices(async ({ dataDir, storage, notes }) => {
      const profilePath = path.join(dataDir, "profile.json");
      const candidatesPath = path.join(dataDir, "attention-candidates.json");
      const wishlistPath = path.join(dataDir, "wishlist.json");
      const oldProfile = JSON.stringify({ oldDisplay: "D-derived fitness" });
      const wishlist = '{ "factualSnapshot": [1, 2, 3] }';
      await fs.writeFile(profilePath, oldProfile);
      await fs.writeFile(candidatesPath, "old attention candidates");
      await fs.writeFile(wishlistPath, wishlist);

      const result = await notes.set("game-1", {
        commandId: NOTE_COMMAND_ID,
        expectedVersion: 0,
        text: "New private owner note",
      });

      expect(result.ok).toBe(true);
      expect(
        await fs.access(profilePath).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(
        await fs.access(candidatesPath).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(await fs.readFile(wishlistPath, "utf8")).toBe(wishlist);

      const restartedStorage = createStorageService({
        dataDir,
        configPath: path.join(dataDir, "config.json"),
        fileOps: createFileOps(),
        logger: silentLogger,
      });
      expect(await restartedStorage.loadProfile()).toBeNull();
      expect(
        await fs.access(profilePath).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(await storage.loadCollection()).toMatchObject({
        games: [{ ownerNote: { state: "present", text: "New private owner note" } }],
      });

      await fs.writeFile(profilePath, oldProfile);
      await fs.writeFile(candidatesPath, "old attention candidates");
      const cleared = await notes.clear("game-1", {
        commandId: CLEAR_COMMAND_ID,
        expectedVersion: 1,
      });
      expect(cleared.ok).toBe(true);
      expect(
        await fs.access(profilePath).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(
        await fs.access(candidatesPath).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(await fs.readFile(wishlistPath, "utf8")).toBe(wishlist);
    });
  });

  test("accepted consent transition purges profile and attention candidate artifacts", async () => {
    await withProductionEquivalentServices(async ({ dataDir, storage, mutations }) => {
      const profilePath = path.join(dataDir, "profile.json");
      const candidatesPath = path.join(dataDir, "attention-candidates.json");
      await fs.writeFile(profilePath, "old profile");
      await fs.writeFile(candidatesPath, "old candidates");
      const collection = await storage.loadCollection();
      const semantic = createSemanticRedundancyStateService({
        collectionMutationService: mutations,
      });
      const result = await semantic.updateSettings(
        {
          evidenceEpoch: collection.semanticRedundancy.evidenceEpoch,
          consentEpoch: collection.semanticRedundancy.consentEpoch,
        },
        {
          enabled: true,
          weights: { factual: 7, description: 5, ownerNote: 10 },
          cachedOwnerNoteUse: false,
        },
      );

      expect(result.outcome).toBe("accepted");
      expect(
        await fs.access(profilePath).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(
        await fs.access(candidatesPath).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
    });
  });

  test("failed artifact purge rejects a note edit without changing the durable collection", async () => {
    const failingFileOps = (): FileOps => {
      const fileOps = createFileOps();
      const unlink = fileOps.unlink.bind(fileOps);
      fileOps.unlink = async (filePath) => {
        if (filePath.endsWith("profile.json")) throw new Error("profile purge unavailable");
        await unlink(filePath);
      };
      return fileOps;
    };
    await withProductionEquivalentServices(async ({ dataDir, storage, notes }) => {
      const profilePath = path.join(dataDir, "profile.json");
      const before = await storage.loadCollection();
      await fs.writeFile(profilePath, "old profile");
      const result = await notes.set("game-1", {
        commandId: NOTE_COMMAND_ID,
        expectedVersion: 0,
        text: "This edit must not persist",
      });

      expect(result).toMatchObject({ ok: false, error: { code: "persistence-failure" } });
      expect(await storage.loadCollection()).toEqual(before);
      expect(await fs.readFile(profilePath, "utf8")).toBe("old profile");
    }, failingFileOps);
  });
});
