import { describe, expect, test } from "bun:test";
import {
  CollectionSchema,
  CollectionSchemaV7,
  CollectionProfileCollectionSourceSchema,
  createAcceptedPlaySourceData,
  createInitialEntityMetadata,
  type CollectionV7,
  type DurableGame,
  type Collection,
  CURRENT_PROFILE_CONTRACT_VERSION,
  CURRENT_PROFILE_ALGORITHM_VERSION,
} from "@shelf-judge/shared";
import { migrateCollection } from "../../src/services/collection-migration";
import { createStorageService } from "../../src/services/storage-service";
import { createMockFileOps } from "../helpers/mock-file-ops";
import { createCollectionMutationService } from "../../src/services/collection-mutation-service";

const T0 = "2026-09-19T10:00:00.000Z";
const T1 = "2026-09-20T10:00:00.000Z";
const game: DurableGame = {
  id: "timestamped",
  name: "Timestamped",
  bggId: 1,
  yearPublished: null,
  minPlayers: null,
  maxPlayers: null,
  bestPlayers: null,
  playingTime: null,
  imageUrl: null,
  bggData: null,
  numPlays: 0,
  acquisition: { state: "unknown" },
  playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt: T0 },
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
  entityMetadata: createInitialEntityMetadata(1),
  latestPlayCountCheck: null,
  ownerNote: { state: "missing", version: 0, updatedAt: null },
  ownership: "owned",
  boxDimensions: null,
  manualShelfId: null,
  ratings: {},
  createdAt: T0,
  updatedAt: T1,
};
function historical(): CollectionV7 {
  return CollectionSchemaV7.parse({
    schemaVersion: 7,
    revision: 6,
    id: "collection",
    name: "Historical",
    axes: [],
    createdAt: T0,
    updatedAt: T1,
    entertainmentBenchmark: null,
    commandReceipts: [],
    games: [
      game,
      {
        ...game,
        id: "timestamp-less",
        playCountEvidence: {
          status: "valid",
          value: 0,
          source: "legacy-unknown",
          observedAt: null,
        },
      },
      {
        ...game,
        id: "missing",
        numPlays: null,
        playCountEvidence: { status: "missing", source: "manual", observedAt: null },
      },
      {
        ...game,
        id: "invalid",
        numPlays: null,
        playCountEvidence: {
          status: "invalid",
          source: "manual",
          observedAt: T0,
          evidence: { presence: "present", value: -1 },
        },
      },
      { ...game, id: "unlinked", bggId: null, entityMetadata: createInitialEntityMetadata(null) },
    ],
    intentions: [
      {
        intentionId: "baseline",
        gameId: game.id,
        kind: "want-to-play",
        baseline: { playCount: 0, evidenceSource: "manual", observedAt: T0 },
        createdAt: T1,
        version: 1,
        resolution: null,
      },
      {
        intentionId: "general",
        gameId: "missing",
        kind: "want-to-play",
        baseline: null,
        createdAt: T1,
        version: 1,
        resolution: null,
      },
      {
        intentionId: "completed",
        gameId: "unlinked",
        kind: "first-play",
        baseline: { playCount: 0, evidenceSource: "manual", observedAt: T0 },
        createdAt: T0,
        version: 2,
        resolution: { outcome: "completed", source: "owner-confirmed", resolvedAt: T1 },
      },
      {
        intentionId: "retired",
        gameId: "invalid",
        kind: "want-to-play",
        baseline: null,
        createdAt: T0,
        version: 2,
        resolution: { outcome: "retired", source: "owner-retired", resolvedAt: T1 },
      },
    ],
    bggPlaySessions: [
      { playId: 1, bggId: 99, quantity: 1, playedOn: "2026-09-18", observedAt: T0 },
    ],
  });
}
const logger = { log() {}, warn() {}, error() {} };
const collectionPath = "/data/collection.json";
function service(fileOps: ReturnType<typeof createMockFileOps>) {
  return createStorageService({ dataDir: "/data", configPath: "/config.json", fileOps, logger });
}

describe("v7 to v8 additive attention migration", () => {
  test("preserves every legacy field, including timestamp-less evidence and resolved history", () => {
    const previous = historical();
    const before = JSON.stringify(previous);
    const migrated = migrateCollection(previous).data;
    const { acceptedPlaySources, attentionFeedback, ...legacy } = migrated;
    expect({ ...legacy, schemaVersion: 7 }).toEqual(previous);
    expect(JSON.stringify(previous)).toBe(before);
    expect(attentionFeedback).toEqual([]);
    expect(acceptedPlaySources).toEqual(createAcceptedPlaySourceData(previous.games, true));
    expect(acceptedPlaySources.checks).toEqual([]);
    expect(acceptedPlaySources.observations).toEqual([]);
    expect(acceptedPlaySources.freshnessBoundaries).toEqual([]);
    expect(acceptedPlaySources.evaluatorPolicies.map((p) => p.gameId)).not.toContain("unlinked");
    expect(migrateCollection(migrated)).toMatchObject({
      migrated: false,
      sourceVersion: 8,
      data: migrated,
    });
    expect(JSON.stringify(migrateCollection(migrated).data)).toBe(JSON.stringify(migrated));
    expect(CURRENT_PROFILE_CONTRACT_VERSION).toBe(10);
    expect(CURRENT_PROFILE_ALGORITHM_VERSION).toBe(12);
  });
  test.each(["artifact", "temporary-write", "rename"] as const)(
    "%s interruption leaves validated v7 available for repeatable retry",
    async (boundary) => {
      const previous = JSON.stringify(historical());
      const files = createMockFileOps({
        [collectionPath]: previous,
        "/data/profile.json": "disposable",
      });
      const write = files.writeFileExclusive.bind(files);
      const rename = files.rename.bind(files);
      files.writeFileExclusive = (path, text) =>
        boundary === "temporary-write" && path.includes("collection.json")
          ? Promise.reject(new Error("injected write interruption"))
          : write(path, text);
      files.rename = (from, to) =>
        boundary === "rename" && to === collectionPath
          ? Promise.reject(new Error("injected rename interruption"))
          : rename(from, to);
      const interrupted = createStorageService({
        dataDir: "/data",
        configPath: "/config.json",
        fileOps: files,
        logger,
        ...(boundary === "artifact"
          ? {
              collectionArtifacts: [
                {
                  identity: "injected",
                  dependencyVersion: 1,
                  path: () => "/data/profile.json",
                  invalidate: () => Promise.reject(new Error("injected artifact interruption")),
                },
              ],
            }
          : {}),
      });
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejection assertions are thenable
      await expect(interrupted.loadCollection()).rejects.toThrow("injected");
      expect(files.files.get(collectionPath)).toBe(previous);
      expect(
        CollectionSchemaV7.safeParse(JSON.parse(files.files.get(collectionPath) ?? "null")).success,
      ).toBe(true);
      files.writeFileExclusive = write;
      files.rename = rename;
      const restarted = service(files);
      const loaded = await restarted.loadCollection();
      expect(loaded).toEqual(migrateCollection(historical()).data);
      const persisted = files.files.get(collectionPath);
      expect(await restarted.loadCollection()).toEqual(loaded);
      expect(files.files.get(collectionPath)).toBe(persisted);
    },
  );
  test("validates feedback association after resolution or retirement and permits receipt retention after event deletion", () => {
    const collection = migrateCollection(historical()).data;
    const feedbackEventId = "123e4567-e89b-42d3-a456-426614174000";
    const commandId = "123e4567-e89b-42d3-a456-426614174001";
    collection.attentionFeedback = [
      {
        collectionId: collection.id,
        feedbackEventId,
        cardId: "attention:retired",
        family: "play-intention",
        gameId: "invalid",
        recordedAt: T0,
        answer: "no",
        reason: { category: "other", text: "Owner local reason" },
      },
    ];
    collection.commandReceipts.push({
      receiptType: "attention-feedback",
      commandId,
      collectionId: collection.id,
      operation: "record-feedback",
      requestFingerprint: "a".repeat(64),
      accepted: {
        commandId,
        collectionId: collection.id,
        operation: "record-feedback",
        feedbackEventId,
        collectionRevision: collection.revision,
      },
    });
    expect(CollectionSchema.safeParse(collection).success).toBe(true);
    expect(
      CollectionSchema.safeParse({
        ...collection,
        attentionFeedback: [{ ...collection.attentionFeedback[0], gameId: "unlinked" }],
      }).success,
    ).toBe(false);
    expect(
      CollectionSchema.safeParse({
        ...collection,
        attentionFeedback: [{ ...collection.attentionFeedback[0], collectionId: "another-owner" }],
      }).success,
    ).toBe(false);
    expect(
      CollectionSchema.safeParse({
        ...collection,
        attentionFeedback: [
          { ...collection.attentionFeedback[0], family: "unplayed-owner-wanted" },
        ],
      }).success,
    ).toBe(false);
    collection.attentionFeedback = [];
    expect(CollectionSchema.safeParse(collection).success).toBe(true);
    expect(JSON.stringify(collection)).not.toContain("Owner local reason");
  });
  test("rejects malformed new data at write/load and public source boundaries without altering prior valid state", async () => {
    const collection = migrateCollection(historical()).data;
    const files = createMockFileOps({ [collectionPath]: JSON.stringify(collection) });
    const storage = service(files);
    const mutation = createCollectionMutationService({ storageService: storage, logger });
    const previous = files.files.get(collectionPath);
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejection assertions are thenable
    await expect(
      mutation.mutate({ operation: "test.corrupt", trigger: "test" }, (candidate: Collection) => {
        candidate.acceptedPlaySources.legacyGameIds.push("unknown-game");
        return { changed: true, value: undefined };
      }),
    ).rejects.toThrow();
    expect(files.files.get(collectionPath)).toBe(previous);
    const malformed = {
      ...collection,
      acceptedPlaySources: { ...collection.acceptedPlaySources, observations: [{}] },
    };
    const publicSource = {
      ...malformed,
      games: collection.games.map(({ ownerNote, ...g }) => {
        void ownerNote;
        return g;
      }),
    };
    expect(CollectionProfileCollectionSourceSchema.safeParse(publicSource).success).toBe(false);
    files.files.set(collectionPath, JSON.stringify(malformed));
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejection assertions are thenable
    await expect(service(files).loadCollection()).rejects.toThrow();
    expect(files.files.get(collectionPath)).toBe(JSON.stringify(malformed));
  });
});
