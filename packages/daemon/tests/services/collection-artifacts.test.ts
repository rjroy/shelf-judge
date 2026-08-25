import { describe, expect, test } from "bun:test";
import {
  COLLECTION_ARTIFACTS,
  createCollectionArtifactContext,
  type CollectionArtifactDescriptor,
} from "../../src/services/collection-artifacts.js";
import type { Logger } from "../../src/services/logger.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

const DATA_DIR = "/test/data";
const PROFILE_PATH = `${DATA_DIR}/profile.json`;
const WISHLIST_PATH = `${DATA_DIR}/wishlist.json`;

function logger(): Logger & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    log: (...args) => messages.push(args.map(String).join(" ")),
    warn: (...args) => messages.push(args.map(String).join(" ")),
    error: (...args) => messages.push(args.map(String).join(" ")),
  };
}

function descriptor(identity: string): CollectionArtifactDescriptor {
  const found = COLLECTION_ARTIFACTS.find((candidate) => candidate.identity === identity);
  if (found === undefined) throw new Error(`Missing artifact descriptor ${identity}`);
  return found;
}

function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "wish-1",
    bggId: 123,
    name: "Wanted Game",
    yearPublished: 2024,
    thumbnailUrl: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    predictedScore: 8.2,
    predictionConfidence: "strong",
    predictedBreakdown: [{ axisName: "Fun", rating: 8, confidence: "strong" }],
    nicheImpact: null,
    ...overrides,
  };
}

describe("collection artifact manifest", () => {
  test("is ordered and owns profile deletion plus wishlist prediction clearing", async () => {
    expect(COLLECTION_ARTIFACTS.map((artifact) => artifact.identity)).toEqual([
      "collection-profile",
      "wishlist-predictions",
    ]);
    const fileOps = createMockFileOps({
      [PROFILE_PATH]: "malformed disposable profile",
      [WISHLIST_PATH]: JSON.stringify([validEntry()]),
    });
    const context = createCollectionArtifactContext(DATA_DIR, fileOps, logger());

    for (const artifact of COLLECTION_ARTIFACTS) await artifact.invalidate(context);

    expect(fileOps.files.has(PROFILE_PATH)).toBe(false);
    expect(JSON.parse(fileOps.files.get(WISHLIST_PATH) ?? "null")).toEqual([
      {
        id: "wish-1",
        bggId: 123,
        name: "Wanted Game",
        yearPublished: 2024,
        thumbnailUrl: null,
        addedAt: "2026-01-01T00:00:00.000Z",
        predictedScore: null,
        predictionConfidence: null,
        predictedBreakdown: null,
        nicheImpact: null,
      },
    ]);
  });

  test("retains valid core fields when only prediction data is malformed", async () => {
    const raw = JSON.stringify([
      validEntry({
        predictedScore: "bad cache",
        predictionConfidence: { malformed: true },
        predictedBreakdown: "bad cache",
        note: "Keep this user note",
        url: "https://example.test/wanted-game",
        futureUserField: { nested: ["preserved"] },
      }),
    ]);
    const fileOps = createMockFileOps({ [WISHLIST_PATH]: raw });
    const sink = logger();

    await descriptor("wishlist-predictions").invalidate(
      createCollectionArtifactContext(DATA_DIR, fileOps, sink),
    );

    const entries: unknown = JSON.parse(fileOps.files.get(WISHLIST_PATH) ?? "null");
    expect(entries).toEqual([
      expect.objectContaining({
        id: "wish-1",
        name: "Wanted Game",
        predictedScore: null,
        predictionConfidence: null,
        predictedBreakdown: null,
        nicheImpact: null,
        note: "Keep this user note",
        url: "https://example.test/wanted-game",
        futureUserField: { nested: ["preserved"] },
      }),
    ]);
    expect([...fileOps.files.keys()].some((name) => name.includes("quarantine"))).toBe(false);
    expect(sink.messages.some((message) => message.includes("invalidPrediction=1"))).toBe(true);
  });

  test("quarantines an untouched mixed array before atomically salvaging valid core entries", async () => {
    const raw = JSON.stringify([validEntry(), { id: "broken", name: 42 }]);
    const fileOps = createMockFileOps({
      [WISHLIST_PATH]: raw,
      [`${WISHLIST_PATH}.quarantine`]: "existing collision",
    });

    await descriptor("wishlist-predictions").invalidate(
      createCollectionArtifactContext(DATA_DIR, fileOps, logger()),
    );

    expect(fileOps.files.get(`${WISHLIST_PATH}.quarantine`)).toBe("existing collision");
    expect(fileOps.files.get(`${WISHLIST_PATH}.quarantine.1`)).toBe(raw);
    const salvaged: unknown = JSON.parse(fileOps.files.get(WISHLIST_PATH) ?? "null");
    expect(salvaged).toEqual([expect.objectContaining({ id: "wish-1", predictedScore: null })]);
  });

  test("quarantines invalid JSON before unlinking active content", async () => {
    const raw = "{ definitely not JSON";
    const fileOps = createMockFileOps({ [WISHLIST_PATH]: raw });

    await descriptor("wishlist-predictions").invalidate(
      createCollectionArtifactContext(DATA_DIR, fileOps, logger()),
    );

    expect(fileOps.files.get(`${WISHLIST_PATH}.quarantine`)).toBe(raw);
    expect(fileOps.files.has(WISHLIST_PATH)).toBe(false);
  });

  test("claims quarantine without overwriting a competing writer", async () => {
    const raw = JSON.stringify([validEntry(), { broken: true }]);
    const fileOps = createMockFileOps({ [WISHLIST_PATH]: raw });
    const originalExclusiveWrite = fileOps.writeFileExclusive.bind(fileOps);
    let competingClaim = true;
    fileOps.writeFileExclusive = async (filePath, content) => {
      if (filePath === `${WISHLIST_PATH}.quarantine` && competingClaim) {
        competingClaim = false;
        fileOps.files.set(filePath, "competing quarantine");
        return false;
      }
      return originalExclusiveWrite(filePath, content);
    };
    const sink = logger();

    await descriptor("wishlist-predictions").invalidate(
      createCollectionArtifactContext(DATA_DIR, fileOps, sink),
    );

    expect(fileOps.files.get(`${WISHLIST_PATH}.quarantine`)).toBe("competing quarantine");
    expect(fileOps.files.get(`${WISHLIST_PATH}.quarantine.1`)).toBe(raw);
    expect(sink.messages).toContain(`wishlist quarantine attempt path=${WISHLIST_PATH}.quarantine`);
    expect(sink.messages).toContain(
      `wishlist quarantine collision path=${WISHLIST_PATH}.quarantine`,
    );
  });

  test("retry after active rewrite failure preserves original then completes salvage", async () => {
    const raw = JSON.stringify([validEntry(), { broken: true }]);
    const fileOps = createMockFileOps({ [WISHLIST_PATH]: raw });
    const originalRename = fileOps.rename.bind(fileOps);
    let failActiveRewrite = true;
    fileOps.rename = async (oldPath, newPath) => {
      if (newPath === WISHLIST_PATH && failActiveRewrite) {
        failActiveRewrite = false;
        throw new Error("injected active rewrite failure");
      }
      await originalRename(oldPath, newPath);
    };
    const artifact = descriptor("wishlist-predictions");
    const context = createCollectionArtifactContext(DATA_DIR, fileOps, logger());

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(artifact.invalidate(context)).rejects.toThrow("injected active rewrite failure");
    expect(fileOps.files.get(WISHLIST_PATH)).toBe(raw);
    expect(fileOps.files.get(`${WISHLIST_PATH}.quarantine`)).toBe(raw);
    expect(fileOps.files.has(`${DATA_DIR}/.wishlist.json.0.tmp`)).toBe(false);

    await artifact.invalidate(context);
    expect(JSON.parse(fileOps.files.get(WISHLIST_PATH) ?? "null")).toEqual([
      expect.objectContaining({ id: "wish-1", predictedScore: null }),
    ]);
    expect(fileOps.files.get(`${WISHLIST_PATH}.quarantine.1`)).toBe(raw);
  });

  test("retry before quarantine copy completion leaves original active content", async () => {
    const raw = JSON.stringify([validEntry(), { broken: true }]);
    const fileOps = createMockFileOps({ [WISHLIST_PATH]: raw });
    const originalWrite = fileOps.writeFileExclusive.bind(fileOps);
    let failQuarantineWrite = true;
    fileOps.writeFileExclusive = async (filePath, content) => {
      if (filePath.includes("recovery-0") && failQuarantineWrite) {
        failQuarantineWrite = false;
        throw new Error("injected quarantine write failure");
      }
      return originalWrite(filePath, content);
    };
    const artifact = descriptor("wishlist-predictions");
    const sink = logger();
    const context = createCollectionArtifactContext(
      DATA_DIR,
      fileOps,
      sink,
      (activePath, attempt) => `${activePath}.recovery-${attempt}`,
    );

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(artifact.invalidate(context)).rejects.toThrow("injected quarantine write failure");
    expect(fileOps.files.get(WISHLIST_PATH)).toBe(raw);
    expect(fileOps.files.has(`${WISHLIST_PATH}.recovery-0`)).toBe(false);
    expect(
      sink.messages.some((message) =>
        message.includes(`wishlist quarantine failed path=${WISHLIST_PATH}.recovery-0`),
      ),
    ).toBe(true);

    await artifact.invalidate(context);
    expect(fileOps.files.get(`${WISHLIST_PATH}.recovery-0`)).toBe(raw);
    expect(JSON.parse(fileOps.files.get(WISHLIST_PATH) ?? "null")).toEqual([
      expect.objectContaining({ id: "wish-1", predictedScore: null }),
    ]);
  });

  test("retry after invalid-JSON quarantine handles unlink failure safely", async () => {
    const raw = "invalid";
    const fileOps = createMockFileOps({ [WISHLIST_PATH]: raw });
    const originalUnlink = fileOps.unlink.bind(fileOps);
    let failUnlink = true;
    fileOps.unlink = async (filePath) => {
      if (filePath === WISHLIST_PATH && failUnlink) {
        failUnlink = false;
        throw new Error("injected unlink failure");
      }
      await originalUnlink(filePath);
    };
    const artifact = descriptor("wishlist-predictions");
    const context = createCollectionArtifactContext(DATA_DIR, fileOps, logger());

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(artifact.invalidate(context)).rejects.toThrow("injected unlink failure");
    expect(fileOps.files.get(WISHLIST_PATH)).toBe(raw);
    await artifact.invalidate(context);
    expect(fileOps.files.has(WISHLIST_PATH)).toBe(false);
    expect(fileOps.files.get(`${WISHLIST_PATH}.quarantine`)).toBe(raw);
    expect(fileOps.files.get(`${WISHLIST_PATH}.quarantine.1`)).toBe(raw);
  });
});
