import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type {
  AppConfig,
  Collection,
  ProfileData,
  WishlistEntry,
  JsonValue,
  DurableGame,
} from "@shelf-judge/shared";
import {
  createFreshCollectionDerivedAxes,
  createInitialEntityMetadata,
  createInitialSemanticRedundancyState,
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
  CollectionSchema,
  PredictionSettingsSchema,
  RedundancySettingsSchema,
  TournamentDataSchema,
} from "@shelf-judge/shared";
import { createStorageService } from "../../src/services/storage-service.js";
import { computeCollectionProfile } from "../../src/services/collection-profile-engine.js";
import { profileSourceIdentity } from "../../src/services/profile-source-coordinator.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import { createFileOps } from "../../src/services/file-ops.js";
import type { Logger } from "../../src/services/logger.js";

const DATA_DIR = "/test/data";
const CONFIG_PATH = "/test/config.json";
const COLLECTION_PATH = "/test/data/collection.json";
const PROFILE_PATH = "/test/data/profile.json";
const TOURNAMENT_PATH = "/test/data/tournament.json";
const WISHLIST_PATH = "/test/data/wishlist.json";
const PREDICTION_SETTINGS_PATH = "/test/data/prediction-settings.json";
const REDUNDANCY_SETTINGS_PATH = "/test/data/redundancy-settings.json";

async function expectPromiseToReject(
  promise: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) return;
    throw new Error(`Expected rejection containing: ${expectedMessage}`, { cause: error });
  }
  throw new Error(`Expected promise to reject containing: ${expectedMessage}`);
}

function makeService(initialFiles?: Record<string, string>) {
  const fileOps = createMockFileOps(initialFiles);
  const service = createStorageService({
    dataDir: DATA_DIR,
    configPath: CONFIG_PATH,
    fileOps,
  });
  return { service, fileOps };
}

function captureLogger(): { entries: string[]; logger: Logger } {
  const entries: string[] = [];
  const record = (level: string, values: unknown[]) =>
    entries.push(
      `${level} ${values.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" ")}`,
    );
  return {
    entries,
    logger: {
      log: (...values) => record("log", values),
      warn: (...values) => record("warn", values),
      error: (...values) => record("error", values),
    },
  };
}

describe("StorageService.loadJevSourceSnapshot", () => {
  test("validates each current collection read once and observes later disk replacements", async () => {
    const { service, fileOps } = makeService();
    const initial = await service.loadCollection();
    const writeMethods = new Set(["writeFile", "writeFileExclusive", "rename", "unlink"]);
    const writesAfterInitialLoad = fileOps.calls.filter(({ method }) =>
      writeMethods.has(method),
    ).length;
    const originalParse = CollectionSchema.parse.bind(CollectionSchema);
    const originalDescriptor = Object.getOwnPropertyDescriptor(CollectionSchema, "parse");
    if (originalDescriptor === undefined)
      throw new Error("CollectionSchema.parse descriptor missing");
    let parseCalls = 0;
    CollectionSchema.parse = (...args: Parameters<typeof CollectionSchema.parse>) => {
      parseCalls += 1;
      return originalParse(...args);
    };

    try {
      const firstDiskRead = await service.loadCollection();
      expect(parseCalls).toBe(1);
      expect(firstDiskRead).toEqual(initial);

      const replacement = JSON.parse(fileOps.files.get(COLLECTION_PATH)!) as Record<
        string,
        unknown
      >;
      replacement.name = "Externally replaced collection";
      const replacementText = JSON.stringify(replacement);
      const priorMetadata = fileOps.metadata.get(COLLECTION_PATH)!;
      fileOps.files.set(COLLECTION_PATH, replacementText);
      fileOps.metadata.set(COLLECTION_PATH, {
        ...priorMetadata,
        ino: priorMetadata.ino + 1n,
        size: BigInt(Buffer.byteLength(replacementText)),
        ctimeNs: priorMetadata.ctimeNs + 1n,
      });

      parseCalls = 0;
      const secondDiskRead = await service.loadCollection();
      expect(parseCalls).toBe(1);
      expect(secondDiskRead.name).toBe("Externally replaced collection");
      expect(fileOps.calls.filter(({ method }) => writeMethods.has(method))).toHaveLength(
        writesAfterInitialLoad,
      );
    } finally {
      Object.defineProperty(CollectionSchema, "parse", originalDescriptor);
    }
  });

  test("stats sources on every call, reuses unchanged parsed data, and protects cached values", async () => {
    const { service, fileOps } = makeService();
    const load = () => service.loadJevSourceSnapshot!();
    expect(load).toBeDefined();
    if (!load) return;

    const first = await load();
    expect(first.externalEpoch).toBe("0");
    const readsAfterFirst = fileOps.calls.filter((call) => call.method === "readFile").length;
    const statsAfterFirst = fileOps.calls.filter((call) => call.method === "stat").length;
    first.collection.name = "caller mutation";
    first.tournament.settings.kFactorThreshold = 999;
    first.predictionSettings.defaultK = 999;

    const second = await load();
    expect(second.collection.name).toBe("My Collection");
    expect(second.tournament.settings.kFactorThreshold).toBe(15);
    expect(second.predictionSettings.defaultK).toBe(5);
    expect(fileOps.calls.filter((call) => call.method === "readFile")).toHaveLength(
      readsAfterFirst,
    );
    expect(fileOps.calls.filter((call) => call.method === "stat")).toHaveLength(
      statsAfterFirst + 4,
    );
    expect(second.freshnessEpoch).toBe(first.freshnessEpoch);
  });

  test("reloads after internal writes and external replace or restored-mtime in-place edits", async () => {
    const { service, fileOps } = makeService();
    const load = () => service.loadJevSourceSnapshot!();
    const first = await load();

    await service.saveRedundancySettings({
      ...first.redundancySettings,
      componentWeights: { binary: 0.9, continuous: 0.1 },
    });
    const internallyUpdated = await load();
    expect(internallyUpdated.redundancySettings.componentWeights.binary).toBe(0.9);
    expect(internallyUpdated.freshnessEpoch).not.toBe(first.freshnessEpoch);
    expect(internallyUpdated.externalEpoch).toBe(first.externalEpoch);

    const rawTournament = TournamentDataSchema.passthrough().parse(
      JSON.parse(fileOps.files.get(TOURNAMENT_PATH)!),
    );
    rawTournament.settings.kFactorThreshold = 16;
    const replacement = JSON.stringify(rawTournament);
    const previousMetadata = fileOps.metadata.get(TOURNAMENT_PATH)!;
    fileOps.files.set(TOURNAMENT_PATH, replacement);
    fileOps.metadata.set(TOURNAMENT_PATH, {
      ...previousMetadata,
      ino: previousMetadata.ino + 1000n,
      size: BigInt(Buffer.byteLength(replacement)),
      ctimeNs: previousMetadata.ctimeNs + 1000n,
    });
    const afterReplace = await load();
    expect(afterReplace.tournament.settings.kFactorThreshold).toBe(16);
    expect(afterReplace.freshnessEpoch).not.toBe(internallyUpdated.freshnessEpoch);
    expect(afterReplace.externalEpoch).not.toBe(internallyUpdated.externalEpoch);

    const rawCollection = CollectionSchema.parse(JSON.parse(fileOps.files.get(COLLECTION_PATH)!));
    rawCollection.name = "External collection";
    const collectionReplacement = JSON.stringify(rawCollection);
    const previousCollectionMetadata = fileOps.metadata.get(COLLECTION_PATH)!;
    fileOps.files.set(COLLECTION_PATH, collectionReplacement);
    fileOps.metadata.set(COLLECTION_PATH, {
      ...previousCollectionMetadata,
      ino: previousCollectionMetadata.ino + 1001n,
      size: BigInt(Buffer.byteLength(collectionReplacement)),
      ctimeNs: previousCollectionMetadata.ctimeNs + 1001n,
    });
    const afterCollectionReplace = await load();
    expect(afterCollectionReplace.collection.name).toBe("External collection");
    expect(afterCollectionReplace.freshnessEpoch).not.toBe(afterReplace.freshnessEpoch);

    const rawPrediction = PredictionSettingsSchema.passthrough().parse(
      JSON.parse(fileOps.files.get(PREDICTION_SETTINGS_PATH)!),
    );
    rawPrediction.minSimilarityThreshold = 0.3;
    const inPlaceContent = JSON.stringify(rawPrediction);
    const previousPredictionMetadata = fileOps.metadata.get(PREDICTION_SETTINGS_PATH)!;
    fileOps.files.set(PREDICTION_SETTINGS_PATH, inPlaceContent);
    fileOps.metadata.set(PREDICTION_SETTINGS_PATH, {
      ...previousPredictionMetadata,
      size: BigInt(Buffer.byteLength(inPlaceContent)),
      mtimeNs: previousPredictionMetadata.mtimeNs,
      ctimeNs: previousPredictionMetadata.ctimeNs + 2000n,
    });
    const afterInPlaceEdit = await load();
    expect(afterInPlaceEdit.predictionSettings.minSimilarityThreshold).toBe(0.3);
    expect(afterInPlaceEdit.freshnessEpoch).not.toBe(afterCollectionReplace.freshnessEpoch);

    const rawRedundancy = RedundancySettingsSchema.passthrough().parse(
      JSON.parse(fileOps.files.get(REDUNDANCY_SETTINGS_PATH)!),
    );
    rawRedundancy.componentWeights.binary = 0.8;
    const redundancyContent = JSON.stringify(rawRedundancy);
    const previousRedundancyMetadata = fileOps.metadata.get(REDUNDANCY_SETTINGS_PATH)!;
    fileOps.files.set(REDUNDANCY_SETTINGS_PATH, redundancyContent);
    fileOps.metadata.set(REDUNDANCY_SETTINGS_PATH, {
      ...previousRedundancyMetadata,
      size: BigInt(Buffer.byteLength(redundancyContent)),
      ctimeNs: previousRedundancyMetadata.ctimeNs + 3000n,
    });
    const afterSettingsEdit = await load();
    expect(afterSettingsEdit.redundancySettings.componentWeights.binary).toBe(0.8);
    expect(afterSettingsEdit.freshnessEpoch).not.toBe(afterInPlaceEdit.freshnessEpoch);
  });

  test("retries a source change during capture and fails closed after repeated incoherence", async () => {
    const { service, fileOps } = makeService();
    const load = () => service.loadJevSourceSnapshot!();
    await load();
    const initialTournament = TournamentDataSchema.passthrough().parse(
      JSON.parse(fileOps.files.get(TOURNAMENT_PATH)!),
    );
    const initialMetadata = fileOps.metadata.get(TOURNAMENT_PATH)!;
    const changedBeforeCapture = JSON.stringify({
      ...initialTournament,
      settings: { kFactorThreshold: 18, normalizationHalfWidth: 400 },
    });
    fileOps.files.set(TOURNAMENT_PATH, changedBeforeCapture);
    fileOps.metadata.set(TOURNAMENT_PATH, {
      ...initialMetadata,
      ino: initialMetadata.ino + 400n,
      size: BigInt(Buffer.byteLength(changedBeforeCapture)),
      ctimeNs: initialMetadata.ctimeNs + 400n,
    });
    const originalRead = fileOps.readFile.bind(fileOps);
    let changedDuringRead = false;
    fileOps.readFile = async (filePath) => {
      const value = await originalRead(filePath);
      if (filePath === TOURNAMENT_PATH && !changedDuringRead) {
        changedDuringRead = true;
        const currentTournament = TournamentDataSchema.passthrough().parse(
          JSON.parse(fileOps.files.get(filePath)!),
        );
        const content = JSON.stringify({
          ...currentTournament,
          settings: { kFactorThreshold: 19, normalizationHalfWidth: 400 },
        });
        const oldMetadata = fileOps.metadata.get(filePath)!;
        fileOps.files.set(filePath, content);
        fileOps.metadata.set(filePath, {
          ...oldMetadata,
          ino: oldMetadata.ino + 500n,
          size: BigInt(Buffer.byteLength(content)),
          ctimeNs: oldMetadata.ctimeNs + 500n,
        });
      }
      return value;
    };
    const coherent = await load();
    expect(coherent.tournament.settings.kFactorThreshold).toBe(19);

    const beforeRepeatedRace = TournamentDataSchema.passthrough().parse(
      JSON.parse(fileOps.files.get(TOURNAMENT_PATH)!),
    );
    const beforeRepeatedRaceMetadata = fileOps.metadata.get(TOURNAMENT_PATH)!;
    const repeatedRaceContent = JSON.stringify({
      ...beforeRepeatedRace,
      settings: { kFactorThreshold: 20, normalizationHalfWidth: 400 },
    });
    fileOps.files.set(TOURNAMENT_PATH, repeatedRaceContent);
    fileOps.metadata.set(TOURNAMENT_PATH, {
      ...beforeRepeatedRaceMetadata,
      ino: beforeRepeatedRaceMetadata.ino + 1n,
      size: BigInt(Buffer.byteLength(repeatedRaceContent)),
      ctimeNs: beforeRepeatedRaceMetadata.ctimeNs + 1n,
    });
    fileOps.readFile = async (filePath) => {
      const value = await originalRead(filePath);
      if (filePath === TOURNAMENT_PATH) {
        const currentTournament = TournamentDataSchema.passthrough().parse(
          JSON.parse(fileOps.files.get(filePath)!),
        );
        const content = JSON.stringify({
          ...currentTournament,
          settings: {
            kFactorThreshold: currentTournament.settings.kFactorThreshold === 19 ? 20 : 19,
            normalizationHalfWidth: 400,
          },
        });
        const oldMetadata = fileOps.metadata.get(filePath)!;
        fileOps.files.set(filePath, content);
        fileOps.metadata.set(filePath, {
          ...oldMetadata,
          ino: oldMetadata.ino + 1n,
          size: BigInt(Buffer.byteLength(content)),
          ctimeNs: oldMetadata.ctimeNs + 1n,
        });
      }
      return value;
    };
    await expectPromiseToReject(load(), "changed repeatedly");
  });

  test("rejects unusable metadata and missing established files without stale fallback or recreation", async () => {
    const { service, fileOps } = makeService();
    const load = () => service.loadJevSourceSnapshot!();
    await load();

    const stat = fileOps.metadata.get(PREDICTION_SETTINGS_PATH)!;
    fileOps.metadata.set(PREDICTION_SETTINGS_PATH, { ...stat, isFile: false });
    await expectPromiseToReject(load(), "metadata is unusable");
    fileOps.metadata.set(PREDICTION_SETTINGS_PATH, stat);

    fileOps.files.delete(TOURNAMENT_PATH);
    fileOps.metadata.delete(TOURNAMENT_PATH);
    await expectPromiseToReject(load(), "established JEV source file is missing");
    expect(fileOps.files.has(TOURNAMENT_PATH)).toBe(false);
    fileOps.files.set(
      TOURNAMENT_PATH,
      JSON.stringify({
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
        sessions: [],
        gameStats: {},
        revision: 0,
      }),
    );
    fileOps.metadata.set(TOURNAMENT_PATH, {
      ...stat,
      size: BigInt(Buffer.byteLength(fileOps.files.get(TOURNAMENT_PATH)!)),
      ino: stat.ino + 800n,
    });
    expect((await load()).tournament.settings.kFactorThreshold).toBe(15);
  });

  test("attributes an external replacement before collection normalization rewrites it", async () => {
    const { service, fileOps } = makeService();
    const load = () => service.loadJevSourceSnapshot!();
    const initial = await load();
    const storedCollection = CollectionSchema.parse(
      JSON.parse(fileOps.files.get(COLLECTION_PATH)!),
    );
    const replacement = JSON.stringify({
      ...storedCollection,
      games: [{ ...currentGame(), acquisition: null }],
    });
    const metadata = fileOps.metadata.get(COLLECTION_PATH)!;
    fileOps.files.set(COLLECTION_PATH, replacement);
    fileOps.metadata.set(COLLECTION_PATH, {
      ...metadata,
      ino: metadata.ino + 900n,
      size: BigInt(Buffer.byteLength(replacement)),
      ctimeNs: metadata.ctimeNs + 900n,
    });

    const normalized = await load();
    expect(normalized.collection.games[0]?.acquisition.state).toBe("invalid");
    expect(normalized.externalEpoch).not.toBe(initial.externalEpoch);
  });

  test("does not assign internal provenance to a same-byte external rename replacement", async () => {
    const { service, fileOps } = makeService();
    const load = () => service.loadJevSourceSnapshot!();
    const initial = await load();
    const originalRename = fileOps.rename.bind(fileOps);
    fileOps.rename = async (from, to) => {
      const sameBytes = fileOps.files.get(from)!;
      await originalRename(from, to);
      if (to !== TOURNAMENT_PATH) return;
      fileOps.files.set(to, sameBytes);
      const old = fileOps.metadata.get(to)!;
      fileOps.metadata.set(to, {
        ...old,
        ino: old.ino + 901n,
        size: BigInt(Buffer.byteLength(sameBytes)),
        ctimeNs: old.ctimeNs + 901n,
      });
    };
    const tournament = await service.loadTournament();
    await expectPromiseToReject(
      service.saveTournament({
        ...tournament,
        settings: { ...tournament.settings, kFactorThreshold: 22 },
      }),
      "changed after atomic write",
    );
    const captured = await load();
    expect(captured.tournament.settings.kFactorThreshold).toBe(22);
    expect(captured.externalEpoch).not.toBe(initial.externalEpoch);
  });

  test("recovers snapshots after failed relevant writes and transient stat failures", async () => {
    const { service, fileOps } = makeService();
    const load = () => service.loadJevSourceSnapshot!();
    const initial = await load();
    const originalRename = fileOps.rename.bind(fileOps);
    fileOps.rename = () => Promise.reject(new Error("rename unavailable"));
    const settings = await service.loadPredictionSettings();
    await expectPromiseToReject(
      service.savePredictionSettings({ ...settings, defaultK: settings.defaultK + 1 }),
      "rename unavailable",
    );
    expect(service.sourceVector!().unavailableSources).toContain("prediction-settings");
    fileOps.rename = originalRename;
    const recovered = await load();
    expect(recovered.predictionSettings.defaultK).toBe(initial.predictionSettings.defaultK);
    expect(fileOps.calls.filter((call) => call.method === "readFile").length).toBeGreaterThan(0);

    const originalStat = fileOps.stat?.bind(fileOps);
    if (!originalStat) throw new Error("Mock file operations must provide stat");
    let failOnce = true;
    fileOps.stat = async (filePath) => {
      if (filePath === REDUNDANCY_SETTINGS_PATH && failOnce) {
        failOnce = false;
        throw Object.assign(new Error("temporary stat failure"), { code: "EIO" });
      }
      return originalStat(filePath);
    };
    await expectPromiseToReject(load(), "temporary stat failure");
    expect((await load()).redundancySettings).toEqual(initial.redundancySettings);
  });

  test("recovers collection source state after a failed atomic write", async () => {
    const { service, fileOps } = makeService();
    const load = () => service.loadJevSourceSnapshot!();
    const initial = await load();
    const originalRename = fileOps.rename.bind(fileOps);
    fileOps.rename = () => Promise.reject(new Error("rename unavailable"));
    await expectPromiseToReject(
      service.saveCollection({ ...initial.collection, name: "uncommitted" }),
      "rename unavailable",
    );
    expect(service.sourceVector!().unavailableSources).toContain("collection");
    fileOps.rename = originalRename;

    const recovered = await load();
    expect(recovered.collection.name).toBe(initial.collection.name);
  });

  test("allows ordinary JEV source writes when the FileOps adapter has no stat", async () => {
    const { service, fileOps } = makeService();
    await service.hydrateSourceVector!();
    fileOps.stat = undefined;

    const collection = await service.loadCollection();
    await service.saveCollection({ ...collection, name: "Saved without metadata" });
    const tournament = await service.loadTournament();
    await service.saveTournament({
      ...tournament,
      settings: { ...tournament.settings, kFactorThreshold: 17 },
    });

    expect(CollectionSchema.parse(JSON.parse(fileOps.files.get(COLLECTION_PATH)!)).name).toBe(
      "Saved without metadata",
    );
    expect(
      TournamentDataSchema.passthrough().parse(JSON.parse(fileOps.files.get(TOURNAMENT_PATH)!))
        .settings.kFactorThreshold,
    ).toBe(17);
    expect(service.sourceVector!()).toMatchObject({
      collectionRevision: collection.revision,
      tournamentRevision: 1,
    });
    await expectPromiseToReject(
      service.loadJevSourceSnapshot!(),
      "JEV source freshness metadata is unavailable",
    );
  });
});

describe("StorageService wishlist BGG source persistence", () => {
  test("round-trips observed nulls and exact description offline, and treats malformed source as legacy", async () => {
    const legacy = {
      id: "legacy",
      bggId: 10,
      name: "Legacy title",
      yearPublished: null,
      thumbnailUrl: null,
      predictedScore: 6,
      predictionConfidence: null,
      predictedBreakdown: null,
      nicheImpact: null,
      redundancyPreview: null,
      addedAt: "2026-01-01T00:00:00.000Z",
    };
    const malformed = { ...legacy, id: "malformed", bggSource: { description: 42 } };
    const { service, fileOps } = makeService({
      [WISHLIST_PATH]: JSON.stringify([
        legacy,
        malformed,
        {
          ...legacy,
          id: "observed",
          bggSource: {
            observedAt: "2026-02-01T00:00:00.000Z",
            description: "  Exact prose  ",
            mechanics: ["Deck Building"],
            categories: [],
            weight: null,
            communityRating: null,
            minPlayers: 2,
            maxPlayers: 4,
            bestPlayers: null,
            playingTime: 60,
          },
        },
        {
          ...legacy,
          id: "observed-null-description",
          bggSource: {
            observedAt: "2026-02-02T00:00:00.000Z",
            description: null,
            mechanics: [],
            categories: [],
            weight: null,
            communityRating: null,
            minPlayers: null,
            maxPlayers: null,
            bestPlayers: null,
            playingTime: null,
          },
        },
        {
          ...legacy,
          id: "observed-empty-description",
          bggSource: {
            observedAt: "2026-02-03T00:00:00.000Z",
            description: "",
            mechanics: [],
            categories: [],
            weight: null,
            communityRating: null,
            minPlayers: null,
            maxPlayers: null,
            bestPlayers: null,
            playingTime: null,
          },
        },
      ]),
    });

    const loaded = await service.loadWishlist();
    expect(loaded[0]?.bggSource).toBeUndefined();
    expect(loaded[1]).toMatchObject({ id: "malformed", predictedScore: 6 });
    expect(loaded[1]?.bggSource).toBeUndefined();
    expect(loaded[2]?.bggSource?.description).toBe("  Exact prose  ");
    expect(loaded[2]?.bggSource?.communityRating).toBeNull();
    expect(loaded[2]?.bggSource?.weight).toBeNull();
    expect(loaded[3]?.bggSource?.description).toBeNull();
    expect(loaded[4]?.bggSource?.description).toBe("");

    await service.saveWishlist(loaded);
    const restarted = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps,
    });
    expect((await restarted.loadWishlist())[2]?.bggSource).toEqual(loaded[2]?.bggSource);
    expect((await restarted.loadWishlist())[3]?.bggSource?.description).toBeNull();
    expect((await restarted.loadWishlist())[4]?.bggSource?.description).toBe("");
  });

  test("persists and reloads the compact source through real atomic file writes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wishlist-source-storage-"));
    const dataDir = path.join(root, "data");
    const wishlistPath = path.join(dataDir, "wishlist.json");
    try {
      await mkdir(dataDir, { recursive: true });
      const entry = {
        id: "disk-entry",
        bggId: 99,
        name: "Disk game",
        yearPublished: 2024,
        thumbnailUrl: null,
        predictedScore: 8,
        predictionConfidence: "strong",
        predictedBreakdown: null,
        nicheImpact: null,
        redundancyPreview: null,
        addedAt: "2026-01-01T00:00:00.000Z",
        bggSource: {
          observedAt: "2026-02-01T00:00:00.000Z",
          description: "A local snapshot",
          mechanics: ["Drafting"],
          categories: ["Strategy"],
          weight: 2.5,
          communityRating: 7.1,
          minPlayers: 1,
          maxPlayers: 4,
          bestPlayers: 2,
          playingTime: 45,
        },
      };
      await writeFile(wishlistPath, JSON.stringify([entry]));
      const firstStorage = createStorageService({
        dataDir,
        configPath: path.join(root, "config.json"),
        fileOps: createFileOps(),
      });
      const loaded = await firstStorage.loadWishlist();
      await firstStorage.saveWishlist(loaded);

      const diskJson = await readFile(wishlistPath, "utf8");
      const restartedStorage = createStorageService({
        dataDir,
        configPath: path.join(root, "config.json"),
        fileOps: createFileOps(),
      });
      expect((await restartedStorage.loadWishlist())[0]?.bggSource).toEqual(entry.bggSource);
      const parsedDisk: unknown = JSON.parse(diskJson);
      expect(Array.isArray(parsedDisk)).toBe(true);
      const diskEntries = parsedDisk as Array<Record<string, unknown>>;
      expect(diskEntries[0]?.["bggSource"]).toEqual(entry.bggSource);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function currentCollection(overrides: Partial<Collection> = {}): Collection {
  const initialSemanticState = createInitialSemanticRedundancyState();
  const semanticRedundancy = {
    settings: initialSemanticState.settings,
    evidenceEpoch: initialSemanticState.evidenceEpoch,
    consentEpoch: initialSemanticState.consentEpoch,
    factualWeightsEpoch: initialSemanticState.factualWeightsEpoch,
    factualWeightsFingerprint: initialSemanticState.factualWeightsFingerprint,
    firstOptInInitialized: initialSemanticState.firstOptInInitialized,
  };
  return {
    schemaVersion: 10,
    revision: 0,
    id: "col-1",
    name: "Test",
    axes: [],
    games: [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function currentGame(overrides: Partial<DurableGame> = {}): DurableGame {
  const bggId = overrides.bggId ?? null;
  return {
    id: "game-1",
    bggId: null,
    name: "Game",
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    ratings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
    entityMetadata: createInitialEntityMetadata(bggId),
    latestPlayCountCheck: null,
  };
}

describe("StorageService.loadCollection", () => {
  test("keeps repeated ordinary current collection loads quiet", async () => {
    const { entries, logger } = captureLogger();
    const service = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps: createMockFileOps({ [COLLECTION_PATH]: JSON.stringify(currentCollection()) }),
      logger,
    });

    await service.loadCollection();
    await service.loadCollection();

    expect(entries).toEqual([]);
  });

  test("logs concise outcomes for persisted collection migration and normalization", async () => {
    const migrationLogger = captureLogger();
    const migrationService = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps: createMockFileOps({
        [COLLECTION_PATH]: JSON.stringify(legacyCollectionWithoutTournamentAxis()),
      }),
      logger: migrationLogger.logger,
    });
    await migrationService.loadCollection();

    expect(
      migrationLogger.entries.some((entry) =>
        entry.includes(`collection migration persisted path=${COLLECTION_PATH}`),
      ),
    ).toBe(true);
    expect(
      migrationLogger.entries.some((entry) =>
        entry.includes(`collection persistence completed path=${COLLECTION_PATH}`),
      ),
    ).toBe(true);
    expect(
      migrationLogger.entries.some((entry) => entry.includes("collection migration checked")),
    ).toBe(false);
    expect(migrationLogger.entries.join(" ")).not.toContain("migration completed");

    const normalizationLogger = captureLogger();
    const normalized = {
      ...currentCollection(),
      games: [
        {
          ...currentGame(),
          acquisition: { state: "purchase", amount: { hundredths: "private-input" } },
        },
      ],
    };
    const normalizationService = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps: createMockFileOps({ [COLLECTION_PATH]: JSON.stringify(normalized) }),
      logger: normalizationLogger.logger,
    });
    await normalizationService.loadCollection();

    expect(
      normalizationLogger.entries.some(
        (entry) =>
          entry.includes(`collection migration persisted path=${COLLECTION_PATH}`) &&
          entry.includes("normalized=true") &&
          entry.includes("normalizationFields=acquisition") &&
          entry.includes("acquisitionGames=1"),
      ),
    ).toBe(true);
    expect(normalizationLogger.entries.join(" ")).not.toContain("normalization completed");
    expect(
      normalizationLogger.entries.some((entry) =>
        entry.includes(`collection persistence completed path=${COLLECTION_PATH}`),
      ),
    ).toBe(true);
    expect(normalizationLogger.entries.join(" ")).not.toContain("private-input");
  });

  test("logs safe stage and path context for collection load failures", async () => {
    const cases: Array<{
      stage: string;
      files: Record<string, string>;
    }> = [
      {
        stage: "read",
        files: { [COLLECTION_PATH]: JSON.stringify(currentCollection()) },
      },
      {
        stage: "parse",
        files: { [COLLECTION_PATH]: "{ private-note-value" },
      },
      {
        stage: "migration",
        files: { [COLLECTION_PATH]: JSON.stringify({ ...currentCollection(), schemaVersion: 11 }) },
      },
      {
        stage: "validation",
        files: {
          [COLLECTION_PATH]: JSON.stringify({
            ...currentCollection({ revision: Number.MAX_SAFE_INTEGER }),
            games: [
              {
                ...currentGame(),
                acquisition: { state: "purchase", amount: { hundredths: "private-input" } },
              },
            ],
          }),
        },
      },
    ];

    for (const testCase of cases) {
      const { entries, logger } = captureLogger();
      const fileOps = createMockFileOps(testCase.files);
      if (testCase.stage === "read") {
        fileOps.readFile = () =>
          Promise.reject(Object.assign(new Error("private-read-value"), { code: "EACCES" }));
      }
      const service = createStorageService({
        dataDir: DATA_DIR,
        configPath: CONFIG_PATH,
        fileOps,
        logger,
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
      await expect(service.loadCollection()).rejects.toThrow();

      const logs = entries.join(" ");
      expect(logs).toContain(`collection ${testCase.stage} failed path=${COLLECTION_PATH}`);
      expect(logs).not.toContain("private-");
      expect(logs).toContain("errorType");
      expect(logs).not.toContain("collection migration persisted");
      if (testCase.stage === "read") expect(logs).toContain("EACCES");
    }
  });

  test("redacts malformed schema versions from migration failure logs", async () => {
    const canary = "private-schema-version-canary";
    const { entries, logger } = captureLogger();
    const service = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps: createMockFileOps({
        [COLLECTION_PATH]: JSON.stringify({ ...currentCollection(), schemaVersion: canary }),
      }),
      logger,
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.loadCollection()).rejects.toThrow();

    const logs = entries.join(" ");
    expect(logs).toContain(`collection migration failed path=${COLLECTION_PATH}`);
    expect(logs).toContain("sourceVersion=invalid");
    expect(logs).not.toContain(canary);
  });

  test("does not report migration persistence success when collection write fails", async () => {
    const { entries, logger } = captureLogger();
    const fileOps = createMockFileOps({
      [COLLECTION_PATH]: JSON.stringify(legacyCollectionWithoutTournamentAxis()),
    });
    fileOps.rename = () => Promise.reject(new Error("private-persist-value"));
    const service = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps,
      logger,
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.loadCollection()).rejects.toThrow();

    const logs = entries.join(" ");
    expect(logs).toContain(`collection persistence failed path=${COLLECTION_PATH}`);
    expect(logs).not.toContain("private-persist-value");
    expect(logs).not.toContain("collection migration persisted");
  });

  test("returns a current collection with two derived defaults plus Tournament", async () => {
    const { service } = makeService();

    const collection = await service.loadCollection();

    expect(collection.name).toBe("My Collection");
    expect(collection.schemaVersion).toBe(10);
    expect(collection.axes).toHaveLength(3);
    expect(collection.games).toHaveLength(0);

    const communityRating = collection.axes.find((a) => a.name === "Community Rating");
    expect(communityRating).toBeDefined();
    expect(communityRating).toMatchObject({
      source: "derived",
      derivedField: "communityRating",
      configuration: {},
      enabled: true,
    });

    const complexity = collection.axes.find((a) => a.name === "Complexity");
    expect(complexity).toBeDefined();
    expect(complexity).toMatchObject({
      source: "derived",
      derivedField: "weight",
      configuration: {},
      enabled: true,
    });

    const tournament = collection.axes.find((a) => a.source === "tournament");
    expect(tournament).toBeDefined();
    expect(tournament!.name).toBe("Tournament");
    expect(tournament!.enabled).toBe(true);
  });

  test("normalizes current v4 source with a new revision and invalidates profile cache", async () => {
    const malformedGame = {
      ...currentGame(),
      acquisition: { state: "purchase", amount: { hundredths: "invalid" } },
    };
    const raw = {
      ...currentCollection({ revision: 5 }),
      games: [malformedGame],
    };
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(raw),
      [PROFILE_PATH]: "disposable profile",
    });

    const loaded = await service.loadCollection();

    expect(loaded.revision).toBe(6);
    expect(loaded.games[0]?.acquisition).toEqual({
      state: "invalid",
      evidence: {
        presence: "present",
        value: { state: "purchase", amount: { hundredths: "invalid" } },
      },
    });
    expect(fileOps.files.has(PROFILE_PATH)).toBe(false);
    expect(JSON.parse(fileOps.files.get(COLLECTION_PATH) ?? "null")).toEqual(loaded);
  });

  test("projects fresh derived axes from registry defaults without optional templates", async () => {
    const timestamp = "2026-08-24T00:00:00.000Z";
    const ids = ["collection-id", "community-axis", "weight-axis", "tournament-axis"];
    let idIndex = 0;
    const nextId = () => {
      const id = ids[idIndex++];
      if (id === undefined) throw new Error("Unexpected fresh collection ID");
      return id;
    };
    const fileOps = createMockFileOps();
    const service = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps,
      collectionMigrationDependencies: {
        createId: nextId,
        now: () => timestamp,
      },
    });

    const collection = await service.loadCollection();
    const expectedDerivedAxes = createFreshCollectionDerivedAxes(
      (() => {
        const expectedIds = ["community-axis", "weight-axis"];
        let expectedIndex = 0;
        return () => {
          const id = expectedIds[expectedIndex++];
          if (id === undefined) throw new Error("Unexpected expected derived axis");
          return id;
        };
      })(),
      timestamp,
    );

    expect(collection.axes).toEqual([
      ...expectedDerivedAxes,
      {
        id: "tournament-axis",
        name: "Tournament",
        description:
          "Derived from head-to-head tournament comparisons. Each game's score is its normalized ELO display value.",
        weight: 30,
        enabled: true,
        source: "tournament",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    expect(
      collection.axes.some(
        (axis) =>
          axis.source === "derived" &&
          (axis.derivedField === "playerCountFit" || axis.derivedField === "playingTime"),
      ),
    ).toBe(false);
  });

  test("loads collection from valid JSON file", async () => {
    const stored = {
      id: "col-1",
      name: "Test Collection",
      axes: [],
      games: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { service } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
    });

    const collection = await service.loadCollection();

    expect(collection.id).toBe("col-1");
    expect(collection.name).toBe("Test Collection");
  });

  test("throws on malformed JSON", async () => {
    const { service } = makeService({
      [COLLECTION_PATH]: "{ not valid json !!!",
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.loadCollection()).rejects.toThrow();
  });

  test("normalizes malformed v3 acquisition and benchmark only at the load boundary", async () => {
    const cases: Array<{ label: string; acquisition: JsonValue; expected: JsonValue }> = [
      { label: "explicit null", acquisition: null, expected: null },
      {
        label: "wrong discriminator",
        acquisition: { state: "other" },
        expected: { state: "other" },
      },
      {
        label: "malformed nested amount",
        acquisition: { state: "purchase", amount: { hundredths: "12345" } },
        expected: { state: "purchase", amount: { hundredths: "12345" } },
      },
    ];

    for (const testCase of cases) {
      const rawGame: Record<string, unknown> = {
        ...currentGame(),
        acquisition: testCase.acquisition,
      };
      delete rawGame.entityMetadata;
      delete rawGame.latestPlayCountCheck;
      delete rawGame.manualValues;
      delete rawGame.ownerNote;
      const rawCollection: Record<string, unknown> = {
        ...currentCollection(),
        schemaVersion: 3,
        games: [rawGame],
        entertainmentBenchmark: { state: "configured", amount: { hundredths: "12345" } },
      };
      delete rawCollection.revision;
      delete rawCollection.intentions;
      delete rawCollection.attentionDispositions;
      delete rawCollection.commandReceipts;
      delete rawCollection.semanticRedundancy;
      const entries: string[] = [];
      const fileOps = createMockFileOps({ [COLLECTION_PATH]: JSON.stringify(rawCollection) });
      const service = createStorageService({
        dataDir: DATA_DIR,
        configPath: CONFIG_PATH,
        fileOps,
        logger: {
          log: (...values) => entries.push(values.map(String).join(" ")),
          warn: (...values) => entries.push(values.map(String).join(" ")),
          error: (...values) => entries.push(values.map(String).join(" ")),
        },
      });

      const loaded = await service.loadCollection();
      expect(loaded.games[0]?.acquisition).toEqual({
        state: "invalid",
        evidence: { presence: "present", value: testCase.expected },
      });
      expect(loaded.entertainmentBenchmark).toEqual({
        state: "invalid",
        evidence: {
          presence: "present",
          value: { state: "configured", amount: { hundredths: "12345" } },
        },
      });
      expect(
        entries.some(
          (entry) =>
            entry.includes("collection migration persisted") &&
            entry.includes("normalizationFields=entertainmentBenchmark,acquisition") &&
            entry.includes("acquisitionGames=1"),
        ),
      ).toBe(true);
      expect(entries.join(" ")).not.toContain('hundredths":"12345');
    }
  });

  test("distinguishes absent fields and does not rewrap normalized invalid values", async () => {
    const rawGame: Partial<DurableGame> = currentGame();
    delete rawGame.acquisition;
    delete rawGame.entityMetadata;
    delete rawGame.latestPlayCountCheck;
    delete rawGame.manualValues;
    delete rawGame.ownerNote;
    const rawCollection: Record<string, unknown> = {
      ...currentCollection({ games: [] }),
      schemaVersion: 3,
    };
    delete rawCollection.entertainmentBenchmark;
    delete rawCollection.revision;
    delete rawCollection.intentions;
    delete rawCollection.attentionDispositions;
    delete rawCollection.commandReceipts;
    delete rawCollection.semanticRedundancy;
    expect(rawGame).not.toHaveProperty("acquisition");
    expect(rawCollection).not.toHaveProperty("entertainmentBenchmark");
    const normalizedInvalid = {
      state: "invalid" as const,
      evidence: { presence: "missing" as const },
    };
    const normalizedInvalidGame: Record<string, unknown> = {
      ...currentGame({ id: "already-invalid" }),
      acquisition: normalizedInvalid,
    };
    delete normalizedInvalidGame.entityMetadata;
    delete normalizedInvalidGame.latestPlayCountCheck;
    delete normalizedInvalidGame.manualValues;
    delete normalizedInvalidGame.ownerNote;
    const { service } = makeService({
      [COLLECTION_PATH]: JSON.stringify({
        ...rawCollection,
        games: [rawGame, normalizedInvalidGame],
      }),
    });

    const loaded = await service.loadCollection();
    expect(loaded.games[0]?.acquisition).toEqual(normalizedInvalid);
    expect(loaded.games[1]?.acquisition).toEqual(normalizedInvalid);
    expect(loaded.entertainmentBenchmark).toEqual(normalizedInvalid);
    expect(await service.loadCollection()).toEqual(loaded);
  });

  test("round-trips valid v4 amounts, observations, invalid data, and later correction", async () => {
    const invalidAcquisition = {
      state: "invalid" as const,
      evidence: {
        presence: "present" as const,
        value: { state: "purchase", amount: { hundredths: "bad" } },
      },
    };
    const game = currentGame({
      acquisition: invalidAcquisition,
      numPlays: 7,
      playingTime: 90,
      minPlayers: 1,
      maxPlayers: 5,
      playCountEvidence: {
        status: "valid",
        value: 7,
        source: "bgg-collection",
        observedAt: "2026-08-26T10:05:00Z",
      },
      durationEvidence: {
        status: "valid",
        value: 90,
        source: "bgg-thing",
        observedAt: "2026-08-26T10:00:00Z",
      },
      playerRangeEvidence: {
        status: "valid",
        value: { minPlayers: 1, maxPlayers: 5 },
        source: "bgg-player-range",
        observedAt: "2026-08-26T10:00:00Z",
      },
      suggestedPlayerPoll: {
        status: "valid",
        state: "usable",
        buckets: [{ playerCount: "3", best: 8, recommended: 2, notRecommended: 1 }],
        source: "bgg-suggested-player-poll",
        observedAt: "2026-08-26T10:00:00Z",
      },
    });
    const benchmark = {
      state: "configured" as const,
      amount: { hundredths: 800, source: "manual" as const, confirmedAt: "2026-08-26T11:00:00Z" },
    };
    const gift = currentGame({ id: "gift", acquisition: { state: "gift" } });
    const zeroPurchase = currentGame({
      id: "zero-purchase",
      acquisition: {
        state: "purchase",
        amount: { hundredths: 0, source: "manual", confirmedAt: "2026-08-26T11:30:00Z" },
      },
    });
    const positivePurchase = currentGame({
      id: "positive-purchase",
      acquisition: {
        state: "purchase",
        amount: { hundredths: 1250, source: "manual", confirmedAt: "2026-08-26T11:45:00Z" },
      },
    });
    const { service } = makeService();
    await service.saveCollection(
      currentCollection({
        games: [game, gift, zeroPurchase, positivePurchase],
        entertainmentBenchmark: benchmark,
      }),
    );

    const loaded = await service.loadCollection();
    expect(loaded.games[0]).toEqual(game);
    expect(loaded.games.slice(1).map(({ acquisition }) => acquisition)).toEqual([
      gift.acquisition,
      zeroPurchase.acquisition,
      positivePurchase.acquisition,
    ]);
    expect(loaded.entertainmentBenchmark).toEqual(benchmark);

    if (loaded.games[0] === undefined) throw new Error("Expected persisted game");
    loaded.games[0].name = "Unrelated rename";
    await service.saveCollection(loaded);
    expect((await service.loadCollection()).games[0]?.acquisition).toEqual(invalidAcquisition);

    loaded.games[0].acquisition = {
      state: "purchase",
      amount: { hundredths: 0, source: "manual", confirmedAt: "2026-08-26T12:00:00Z" },
    };
    await service.saveCollection(loaded);
    expect((await service.loadCollection()).games[0]?.acquisition).toEqual(
      loaded.games[0].acquisition,
    );
  });

  test("round-trips min-only and max-only manual range evidence", async () => {
    const minOnly = currentGame({
      id: "min-only",
      playerRangeEvidence: {
        status: "invalid",
        evidence: {
          minPlayers: { presence: "present", value: 2 },
          maxPlayers: { presence: "missing" },
        },
        source: "manual",
        observedAt: "2026-08-26T12:00:00Z",
      },
    });
    const maxOnly = currentGame({
      id: "max-only",
      playerRangeEvidence: {
        status: "invalid",
        evidence: {
          minPlayers: { presence: "missing" },
          maxPlayers: { presence: "present", value: 5 },
        },
        source: "manual",
        observedAt: "2026-08-26T12:05:00Z",
      },
    });
    const { service } = makeService();

    await service.saveCollection(currentCollection({ games: [minOnly, maxOnly] }));

    expect(
      (await service.loadCollection()).games.map(({ playerRangeEvidence }) => playerRangeEvidence),
    ).toEqual([minOnly.playerRangeEvidence, maxOnly.playerRangeEvidence]);
  });
});

describe("StorageService.saveCollection", () => {
  test("writes to temp file then renames (atomic write)", async () => {
    const { service, fileOps } = makeService();
    const collection = currentCollection();

    await service.saveCollection(collection);

    // Verify the call sequence: exclusive temp claim, then rename onto the real path.
    const writeCalls = fileOps.calls.filter(
      (c) => c.method === "writeFileExclusive" || c.method === "rename",
    );
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[0].method).toBe("writeFileExclusive");
    expect(writeCalls[0].args[0]).toContain(".tmp");
    expect(writeCalls[1].method).toBe("rename");
    expect(writeCalls[1].args[0]).toContain(".tmp");
    expect(writeCalls[1].args[1]).toBe(COLLECTION_PATH);
  });

  test("produces valid JSON that round-trips through load", async () => {
    const { service, fileOps } = makeService();
    const original = currentCollection({
      id: "col-round",
      name: "Round Trip",
      axes: [
        {
          id: "axis-1",
          name: "Fun",
          description: null,
          weight: 50,
          enabled: true,
          source: "personal",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    await service.saveCollection(original);

    // The file should now be in the mock filesystem at the collection path
    expect(fileOps.files.has(COLLECTION_PATH)).toBe(true);

    const loaded = await service.loadCollection();
    expect(loaded.id).toBe("col-round");
    expect(loaded.name).toBe("Round Trip");
    expect(loaded.axes).toHaveLength(1);
    expect(loaded.axes.find((a) => a.name === "Fun")).toBeDefined();
  });

  test("sequential saves result in last-write-wins", async () => {
    const { service } = makeService();
    const base = currentCollection({ name: "First" });

    await service.saveCollection({ ...base, name: "First" });
    await service.saveCollection({ ...base, name: "Second" });

    const loaded = await service.loadCollection();
    expect(loaded.name).toBe("Second");
  });

  test("validates current collections before writing", async () => {
    const { service, fileOps } = makeService();
    const malformed = currentCollection({ name: "" });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.saveCollection(malformed)).rejects.toThrow();
    expect(fileOps.files.has(COLLECTION_PATH)).toBe(false);
    expect(fileOps.calls.some((call) => call.method === "writeFileExclusive")).toBe(false);
  });
});

describe("StorageService.loadConfig", () => {
  test("returns default config when file doesn't exist", async () => {
    const { service } = makeService();

    const config = await service.loadConfig();

    expect(config.bggAuthToken).toBeNull();
    expect(config.groundedAnalysis).toBeNull();
    expect(config.profileEntityPolicy).toEqual({
      mechanic: { overviewLimit: 3, minimumSupportedGames: 3 },
      designer: { overviewLimit: 3, minimumSupportedGames: 3 },
      artist: { overviewLimit: 3, minimumSupportedGames: 3 },
    });
  });

  test("loads config from an existing file and ignores a legacy dataDir", async () => {
    const stored = {
      bggAuthToken: "test-token",
      dataDir: "/custom/data",
      socketPath: "/custom/sock",
    };
    const { service, fileOps } = makeService({
      [CONFIG_PATH]: JSON.stringify(stored),
    });

    const config = await service.loadConfig();

    expect(config.bggAuthToken).toBe("test-token");
    expect(config).not.toHaveProperty("dataDir");
    expect(config.profileEntityPolicy.mechanic).toEqual({
      overviewLimit: 3,
      minimumSupportedGames: 3,
    });
    expect(JSON.parse(fileOps.files.get(CONFIG_PATH) ?? "null")).not.toHaveProperty("dataDir");
  });

  test("loads legacy configs without a grounded provider and rejects invalid persisted identities", async () => {
    const { service } = makeService({
      [CONFIG_PATH]: JSON.stringify({
        bggAuthToken: null,
        groundedAnalysis: { providerId: " provider", modelId: "model", extensionIds: [] },
      }),
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.loadConfig()).rejects.toThrow();
  });

  test("rejects invalid profile entity policy values", async () => {
    const { service } = makeService({
      [CONFIG_PATH]: JSON.stringify({
        dataDir: DATA_DIR,
        profileEntityPolicy: {
          mechanic: { overviewLimit: -1, minimumSupportedGames: 3 },
          designer: { overviewLimit: 3, minimumSupportedGames: 3 },
          artist: { overviewLimit: 3, minimumSupportedGames: 0 },
        },
      }),
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(service.loadConfig()).rejects.toThrow();
  });
});

describe("StorageService.saveConfig", () => {
  test("uses atomic write for config", async () => {
    const { service, fileOps } = makeService();

    await service.saveConfig({
      bggAuthToken: "tok",
      username: null,
      groundedAnalysis: null,
      profileAttentionCardLimit: 6,
      profileEntityPolicy: {
        mechanic: { overviewLimit: 1, minimumSupportedGames: 2 },
        designer: { overviewLimit: 2, minimumSupportedGames: 3 },
        artist: { overviewLimit: 3, minimumSupportedGames: 4 },
      },
    });

    const writeCalls = fileOps.calls.filter(
      (c) => c.method === "writeFileExclusive" || c.method === "rename",
    );
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[0].method).toBe("writeFileExclusive");
    expect(writeCalls[0].args[0]).toContain(".tmp");
    expect(writeCalls[1].method).toBe("rename");
    const persisted = JSON.parse(fileOps.files.get(CONFIG_PATH) ?? "null") as AppConfig;
    expect(persisted.profileEntityPolicy).toEqual({
      mechanic: { overviewLimit: 1, minimumSupportedGames: 2 },
      designer: { overviewLimit: 2, minimumSupportedGames: 3 },
      artist: { overviewLimit: 3, minimumSupportedGames: 4 },
    });
    expect(persisted).not.toHaveProperty("dataDir");
  });

  test("persists a valid grounded provider identity", async () => {
    const { service } = makeService();
    const config = await service.loadConfig();

    await service.saveConfig({
      ...config,
      groundedAnalysis: { providerId: "local-provider", modelId: "local-model", extensionIds: [] },
    });

    expect((await service.loadConfig()).groundedAnalysis).toEqual({
      providerId: "local-provider",
      modelId: "local-model",
      extensionIds: [],
    });
  });
});

describe("StorageService.loadPredictionSettings", () => {
  test("removes the obsolete tournament stability setting from persisted data", async () => {
    const predictionSettingsPath = `${DATA_DIR}/prediction-settings.json`;
    const { service, fileOps } = makeService({
      [predictionSettingsPath]: JSON.stringify({
        stageThresholds: [5, 15, 30],
        defaultK: 5,
        minSimilarityThreshold: 0.2,
        tournamentStabilityBoost: 0.2,
      }),
    });

    expect(await service.loadPredictionSettings()).toEqual({
      stageThresholds: [5, 15, 30],
      defaultK: 5,
      minSimilarityThreshold: 0.2,
    });
    expect(JSON.parse(fileOps.files.get(predictionSettingsPath) ?? "null")).toEqual({
      stageThresholds: [5, 15, 30],
      defaultK: 5,
      minSimilarityThreshold: 0.2,
      revision: 0,
    });
  });
});

describe("StorageService.loadTournament", () => {
  test("round-trips observed normalization bounds", async () => {
    const { service } = makeService();
    const tournament = await service.loadTournament();
    tournament.settings.normalizationBounds = { minElo: 1367.11, maxElo: 1627.91 };
    await service.saveTournament(tournament);

    const reloaded = await service.loadTournament();
    expect(reloaded.settings.normalizationBounds).toEqual({ minElo: 1367.11, maxElo: 1627.91 });
  });

  test("rewrites legacy provisional settings and staleness filters", async () => {
    const { service, fileOps } = makeService({
      [TOURNAMENT_PATH]: JSON.stringify({
        settings: {
          kFactorThreshold: 15,
          normalizationHalfWidth: 400,
          provisionalThreshold: 3,
        },
        sessions: [
          {
            id: "session-1",
            filters: [
              { type: "staleness", value: "3" },
              { type: "name", value: "Keep this filter" },
            ],
            gameIds: ["game-1", "game-2"],
            comparisonCount: 0,
            status: "completed",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            comparisons: [],
          },
        ],
        gameStats: {},
      }),
    });

    const loaded = await service.loadTournament();
    const persistedJson: unknown = JSON.parse(
      fileOps.files.get(TOURNAMENT_PATH) ?? "null",
    ) as unknown;
    const persisted = z
      .object({
        settings: z.object({}).passthrough(),
        sessions: z.array(z.object({ filters: z.array(z.unknown()) }).passthrough()),
      })
      .passthrough()
      .parse(persistedJson);

    expect(loaded.settings).toEqual({ kFactorThreshold: 15, normalizationHalfWidth: 400 });
    expect(loaded.sessions[0]?.filters).toEqual([{ type: "name", value: "Keep this filter" }]);
    expect(persisted.settings).not.toHaveProperty("provisionalThreshold");
    expect(persisted.sessions[0].filters).not.toContainEqual({ type: "staleness", value: "3" });
    expect(TournamentDataSchema.parse(persisted)).toEqual(loaded);
  });
});

function makeEmptyProfileData(computedAt = "2026-01-01T00:00:00.000Z"): ProfileData {
  const collection = currentCollection();
  const tournament = {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
    sessions: [],
    gameStats: {},
  };
  const predictionSettings = {
    stageThresholds: [5, 15, 30] as [number, number, number],
    defaultK: 5,
    minSimilarityThreshold: 0.2,
  };
  const redundancySettings = {
    enabled: false,
    stage: "annotation" as const,
    similarityThreshold: 0.6,
    maxPenalty: 2,
    componentWeights: { binary: 0.4, continuous: 0.3 },
    minNeighbors: 1,
    expectedNeighbors: 5,
  };
  const source = profileSourceIdentity({
    collection,
    tournament,
    predictionSettings,
    redundancySettings,
  });
  return {
    contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
    algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
    publicationIdentity: {
      source,
      profileAttentionCardLimit: 0,
      entityPolicyFingerprint: "a".repeat(64),
      attentionCandidates: {
        schemaVersion: 2,
        indexVersion: 1,
        evaluatedAt: computedAt,
        identity: {
          ...source,
          semanticScoringInputProof: {
            version: 2,
            mode: "unified-similarity",
            algorithmVersion: "unified-jaccard-manhattan-jev-v1",
            identity: "b".repeat(64),
            demandedPairsIdentity: "c".repeat(64),
            examinedComponentsIdentity: "d".repeat(64),
          },
          calculationVersion: 1,
          ruleCatalogVersion: 1,
          dependencyVersion: 1,
          projectionVersion: 1,
          catalogRuleVersions: [],
        },
      },
    },
    profile: computeCollectionProfile({ collection, fitnessResults: new Map(), computedAt }),
    computedAt,
  };
}

describe("StorageService.loadProfile", () => {
  test("returns null when file doesn't exist", async () => {
    const { service } = makeService();
    const profile = await service.loadProfile();
    expect(profile).toBeNull();
  });

  test("loads profile from valid JSON file", async () => {
    const profileData = makeEmptyProfileData();
    const { service } = makeService({
      [PROFILE_PATH]: JSON.stringify(profileData),
    });

    const loaded = await service.loadProfile();
    expect(loaded).not.toBeNull();
    expect(loaded!.computedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(loaded!.profile.identity.collectionState).toBe("empty");
  });
});

describe("StorageService.saveProfile", () => {
  test("writes and loads correctly (round-trip)", async () => {
    const { service } = makeService();
    const profileData = makeEmptyProfileData("2026-03-15T12:00:00.000Z");

    await service.saveProfile(profileData);
    const loaded = await service.loadProfile();

    expect(loaded).not.toBeNull();
    expect(loaded!.computedAt).toBe("2026-03-15T12:00:00.000Z");
    expect(loaded!.profile.identity.collectionState).toBe("empty");
  });

  test("discards a cached profile after the configured entity policy changes", async () => {
    const { service, fileOps } = makeService();
    await service.saveProfile(makeEmptyProfileData());
    const config = await service.loadConfig();
    fileOps.files.set(
      CONFIG_PATH,
      JSON.stringify({
        ...config,
        profileEntityPolicy: {
          ...config.profileEntityPolicy,
          mechanic: { overviewLimit: 5, minimumSupportedGames: 2 },
        },
      }),
    );

    expect(await service.loadProfile()).toBeNull();
    expect(fileOps.files.has(PROFILE_PATH)).toBe(false);
  });

  for (const settingsKind of ["prediction", "redundancy"] as const) {
    test(`invalidates the profile after ${settingsKind} settings change`, async () => {
      const { service } = makeService();
      await service.saveProfile(makeEmptyProfileData());

      if (settingsKind === "prediction") {
        const settings = await service.loadPredictionSettings();
        await service.savePredictionSettings({ ...settings, defaultK: settings.defaultK + 1 });
      } else {
        const settings = await service.loadRedundancySettings();
        await service.saveRedundancySettings({ ...settings, enabled: !settings.enabled });
      }

      expect(await service.loadProfile()).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Tournament-axis migration (REQ-TAXIS-4, REQ-TAXIS-9)
// ---------------------------------------------------------------------------

function legacyCollectionWithoutTournamentAxis() {
  return {
    id: "col-legacy",
    name: "Legacy",
    axes: [
      {
        id: "axis-bgg",
        name: "Community Rating",
        description: null,
        weight: 50,
        source: "bgg",
        bggField: "communityRating",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    games: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeWishlistEntry(overrides: Partial<WishlistEntry> = {}): WishlistEntry {
  return {
    id: "wl-1",
    bggId: 12345,
    name: "Wishlisted Game",
    yearPublished: 2024,
    thumbnailUrl: null,
    predictedScore: 7.5,
    predictionConfidence: "moderate",
    predictedBreakdown: [{ axisName: "Community Rating", rating: 8, confidence: "moderate" }],
    nicheImpact: null,
    redundancyPreview: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("StorageService.loadCollection — tournament axis migration", () => {
  test("adds a tournament axis to legacy collection on load and rewrites the file", async () => {
    const stored = legacyCollectionWithoutTournamentAxis();
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
    });

    const loaded = await service.loadCollection();

    expect(loaded.axes).toHaveLength(2);
    const tournament = loaded.axes.find((a) => a.source === "tournament");
    expect(tournament).toBeDefined();
    expect(tournament!.name).toBe("Tournament");

    // The on-disk file must reflect the migrated collection.
    const onDisk = JSON.parse(fileOps.files.get(COLLECTION_PATH)!) as Collection;
    expect(onDisk.axes).toHaveLength(2);
    expect(onDisk.axes.some((a) => a.source === "tournament")).toBe(true);
  });

  test("a second loadCollection is a no-op (idempotent)", async () => {
    const stored = legacyCollectionWithoutTournamentAxis();
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
    });

    await service.loadCollection();
    const writeCallsAfterFirstLoad = fileOps.calls.filter(
      (c) => c.method === "writeFileExclusive",
    ).length;

    await service.loadCollection();
    const writeCallsAfterSecondLoad = fileOps.calls.filter(
      (c) => c.method === "writeFileExclusive",
    ).length;

    // Second load must not re-write the collection file.
    expect(writeCallsAfterSecondLoad).toBe(writeCallsAfterFirstLoad);
  });

  test("deletes profile.json when migration runs", async () => {
    const stored = legacyCollectionWithoutTournamentAxis();
    const profileData = makeEmptyProfileData();
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
      [PROFILE_PATH]: JSON.stringify(profileData),
    });

    expect(fileOps.files.has(PROFILE_PATH)).toBe(true);
    await service.loadCollection();
    expect(fileOps.files.has(PROFILE_PATH)).toBe(false);
  });

  test("is silent when profile.json is absent", async () => {
    const stored = legacyCollectionWithoutTournamentAxis();
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
    });

    expect(fileOps.files.has(PROFILE_PATH)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().resolves is thenable
    await expect(service.loadCollection()).resolves.toBeDefined();
    expect(fileOps.files.has(PROFILE_PATH)).toBe(false);
  });

  test("clears prediction fields on wishlist entries", async () => {
    const stored = legacyCollectionWithoutTournamentAxis();
    const wishlist: WishlistEntry[] = [
      makeWishlistEntry({ id: "wl-a", bggId: 1, name: "A" }),
      makeWishlistEntry({
        id: "wl-b",
        bggId: 2,
        name: "B",
        predictedScore: 6.0,
        redundancyPreview: {
          penalty: 1,
          originalScore: 6,
          adjustedScore: 5,
          nicheNeighbors: [],
          nicheRank: 2,
          nicheSize: 1,
        },
      }),
    ];
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(stored),
      [WISHLIST_PATH]: JSON.stringify(wishlist),
    });

    await service.loadCollection();

    const onDisk = JSON.parse(fileOps.files.get(WISHLIST_PATH)!) as WishlistEntry[];
    expect(onDisk).toHaveLength(2);
    for (const entry of onDisk) {
      expect(entry.predictedScore).toBeNull();
      expect(entry.predictedBreakdown).toBeNull();
      expect(entry.predictionConfidence).toBeNull();
      expect(entry.redundancyPreview).toBeNull();
    }
    // User-owned metadata is preserved.
    expect(onDisk[0].bggId).toBe(1);
    expect(onDisk[0].name).toBe("A");
    expect(onDisk[1].bggId).toBe(2);
    expect(onDisk[1].id).toBe("wl-b");
    expect(onDisk[1].addedAt).toBe(wishlist[1].addedAt);
  });

  test("does not touch wishlist when migration is a no-op", async () => {
    const legacy = legacyCollectionWithoutTournamentAxis();
    const first = makeService({ [COLLECTION_PATH]: JSON.stringify(legacy) });
    const collection = await first.service.loadCollection();
    const wishlist: WishlistEntry[] = [makeWishlistEntry({ predictedScore: 7.5 })];
    const { service, fileOps } = makeService({
      [COLLECTION_PATH]: JSON.stringify(collection),
      [WISHLIST_PATH]: JSON.stringify(wishlist),
    });

    await service.loadCollection();

    const onDisk = JSON.parse(fileOps.files.get(WISHLIST_PATH)!) as WishlistEntry[];
    expect(onDisk[0].predictedScore).toBe(7.5);
  });
});

// ---------------------------------------------------------------------------
// In-flight load lock regression (Phase 3)
//
// loadTournament/loadCollection serialize concurrent first-time loads via an
// in-flight promise map. Without the lock, two parallel callers each see the
// no-file branch, each call atomicWrite, and the writes race on the shared
// `<file>.tmp` path. The mock filesystem masks the rename ordering, but write
// counts are still observable: with the lock, exactly one exclusive temp write + one
// rename per file; without it, two of each.
//
// To make the race deterministic, we wrap the mock's exclusive write in a yield so
// both callers reliably enter their no-file branch before either side writes.
// ---------------------------------------------------------------------------

function withSlowWrite(fileOps: ReturnType<typeof createMockFileOps>) {
  const original = fileOps.writeFileExclusive.bind(fileOps);
  fileOps.writeFileExclusive = async (filePath: string, content: string): Promise<boolean> => {
    // Yield to the microtask queue so the second caller's exists() check can
    // resolve before this writeFile commits. Without this hop, both callers
    // could otherwise serialize naturally even without the lock.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return original(filePath, content);
  };
  return fileOps;
}

describe("StorageService — concurrent first-time load lock", () => {
  test("loadTournament: parallel calls produce one write, both resolve to equivalent data", async () => {
    const fileOps = withSlowWrite(createMockFileOps());
    const service = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps,
    });

    const [a, b] = await Promise.all([service.loadTournament(), service.loadTournament()]);

    expect(a).toEqual(b);
    expect(a.settings.kFactorThreshold).toBe(15);
    expect(a.sessions).toEqual([]);
    expect(a.gameStats).toEqual({});

    // Exactly one atomic write to tournament.json (one exclusive write to the tmp,
    // one rename onto the real path). Two of either means the lock is gone.
    const tournamentWrites = fileOps.calls.filter(
      (c) => c.method === "writeFileExclusive" && c.args[0].includes("tournament.json"),
    );
    const tournamentRenames = fileOps.calls.filter(
      (c) => c.method === "rename" && c.args[1] === TOURNAMENT_PATH,
    );
    expect(tournamentWrites).toHaveLength(1);
    expect(tournamentRenames).toHaveLength(1);
  });

  test("loadCollection: parallel calls produce one write, both resolve to equivalent data", async () => {
    const fileOps = withSlowWrite(createMockFileOps());
    const service = createStorageService({
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      fileOps,
    });

    const [a, b] = await Promise.all([service.loadCollection(), service.loadCollection()]);

    expect(a.name).toBe(b.name);
    expect(a.id).toBe(b.id);
    expect(a.axes.map((axis) => axis.name).sort()).toEqual(b.axes.map((axis) => axis.name).sort());

    const collectionWrites = fileOps.calls.filter(
      (c) => c.method === "writeFileExclusive" && c.args[0].includes("collection.json"),
    );
    const collectionRenames = fileOps.calls.filter(
      (c) => c.method === "rename" && c.args[1] === COLLECTION_PATH,
    );
    expect(collectionWrites).toHaveLength(1);
    expect(collectionRenames).toHaveLength(1);
  });
});

describe("StorageService collection snapshot source authority", () => {
  test("same-revision content edits change authority and fence each of the six source files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "snapshot-authority-edit-"));
    try {
      const storage = createStorageService({
        dataDir: directory,
        configPath: path.join(directory, "config.json"),
        fileOps: createFileOps(),
      });
      if (!storage.hydrateSourceVector || !storage.readCollectionSnapshotAuthority)
        throw new Error("Collection snapshot source authority is unavailable");
      await storage.hydrateSourceVector();
      let before = await storage.readCollectionSnapshotAuthority();
      expect(before.available).toBe(true);

      for (const fileName of [
        "collection.json",
        "tournament.json",
        "prediction-settings.json",
        "redundancy-settings.json",
        "niche-settings.json",
        "shelf-config.json",
      ]) {
        const filePath = path.join(directory, fileName);
        await writeFile(filePath, `${await readFile(filePath, "utf8")}\n`, "utf8");
        const changed = await storage.readCollectionSnapshotAuthority();
        expect(changed.identity).not.toBe(before.identity);
        expect(storage.sourceVector?.().available, fileName).toBe(false);
        await storage.hydrateSourceVector();
        before = await storage.readCollectionSnapshotAuthority();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("disappearance of an established source is unavailable and cannot be recreated by a loader", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "snapshot-authority-delete-"));
    try {
      const storage = createStorageService({
        dataDir: directory,
        configPath: path.join(directory, "config.json"),
        fileOps: createFileOps(),
      });
      if (!storage.hydrateSourceVector || !storage.readCollectionSnapshotAuthority)
        throw new Error("Collection snapshot source authority is unavailable");
      await storage.hydrateSourceVector();
      const shelfConfigPath = path.join(directory, "shelf-config.json");
      await rm(shelfConfigPath);

      const authority = await storage.readCollectionSnapshotAuthority();
      expect(authority.available).toBe(false);
      await expectPromiseToReject(storage.loadShelfConfig(), "disappeared");
      await expectPromiseToReject(readFile(shelfConfigPath, "utf8"), "ENOENT");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rechecks earlier sources when a later source read overlaps an external edit", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "snapshot-authority-overlap-"));
    try {
      const baseFileOps = createFileOps();
      const collectionPath = path.join(directory, "collection.json");
      const shelfPath = path.join(directory, "shelf-config.json");
      let injected = false;
      const fileOps = {
        ...baseFileOps,
        async readFile(filePath: string): Promise<string> {
          const content = await baseFileOps.readFile(filePath);
          if (!injected && filePath === shelfPath) {
            injected = true;
            await writeFile(collectionPath, `${await readFile(collectionPath, "utf8")}\n`, "utf8");
          }
          return content;
        },
      };
      const storage = createStorageService({
        dataDir: directory,
        configPath: path.join(directory, "config.json"),
        fileOps,
      });
      if (!storage.hydrateSourceVector || !storage.readCollectionSnapshotAuthority)
        throw new Error("Collection snapshot source authority is unavailable");
      await storage.hydrateSourceVector();
      const authority = await storage.readCollectionSnapshotAuthority();

      expect(injected).toBe(true);
      expect(authority.available).toBe(true);
      expect(storage.sourceVector?.().available).toBe(false);
      expect(await readFile(collectionPath, "utf8")).toEndWith("\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("final metadata fence rejects an earlier edit during the final source read", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "snapshot-authority-final-fence-"));
    try {
      const baseFileOps = createFileOps();
      const collectionPath = path.join(directory, "collection.json");
      const shelfPath = path.join(directory, "shelf-config.json");
      let shelfReads = 0;
      let injected = false;
      const fileOps = {
        ...baseFileOps,
        async readFile(filePath: string): Promise<string> {
          const content = await baseFileOps.readFile(filePath);
          if (filePath === shelfPath) {
            shelfReads++;
            if (!injected && shelfReads === 4) {
              injected = true;
              await writeFile(
                collectionPath,
                `${await readFile(collectionPath, "utf8")}\n`,
                "utf8",
              );
            }
          }
          return content;
        },
      };
      const storage = createStorageService({
        dataDir: directory,
        configPath: path.join(directory, "config.json"),
        fileOps,
      });
      if (!storage.hydrateSourceVector || !storage.readCollectionSnapshotAuthority)
        throw new Error("Collection snapshot source authority is unavailable");
      await storage.hydrateSourceVector();
      const before = await storage.readCollectionSnapshotAuthority();
      expect(before.available).toBe(true);

      const after = await storage.readCollectionSnapshotAuthority();

      expect(injected).toBe(true);
      expect(after.available).toBe(true);
      expect(after.identity).not.toBe(before.identity);
      expect(storage.sourceVector?.().available).toBe(false);
      expect(await readFile(collectionPath, "utf8")).toEndWith("\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
